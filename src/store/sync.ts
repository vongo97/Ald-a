import { db } from "./db";
import { supabase } from "./supabase";
import { mergeDecision, timestamp, type SyncRecord } from "./merge";
import type { Task, Project } from "@/domain/types";

/** Fase A: Exportar datos a JSON */
export async function exportDataToJSON(): Promise<void> {
  const tasks = await db.tasks.toArray();
  const projects = await db.projects.toArray();
  
  const data = { tasks, projects, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tareas-backup-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Fase A: Importar datos desde JSON (Sobrescribe DB actual) */
export async function importDataFromJSON(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) {
          throw new Error("El archivo no tiene el formato correcto.");
        }
        
        await db.transaction("rw", db.tasks, db.projects, async () => {
          await db.tasks.clear();
          await db.projects.clear();
          if (data.tasks.length > 0) await db.tasks.bulkAdd(data.tasks);
          if (data.projects.length > 0) await db.projects.bulkAdd(data.projects);
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ─── SINCRONIZACIÓN AUTOMÁTICA (FASE B) ──────────────────────────────────────
//
// Orden garantizado: PRIMERO se sube lo local, DESPUÉS se baja la nube.
// Así nunca se pierde trabajo hecho offline. El merge es por `updatedAt`
// (último en escribir gana) y jamás hace `clear()` sobre la DB local.

/** ID del usuario autenticado, o null si no hay sesión. */
async function sessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

const stampNow = (): string => new Date().toISOString();

/** Quita columnas de servidor que no pertenecen al modelo local. */
function stripRemote<T>(row: T): T {
  if (row && typeof row === "object" && "user_id" in row) {
    delete (row as { user_id?: unknown }).user_id;
  }
  return row;
}

/** Sube un lote de tareas (upsert por id). Silencioso si no hay sesión. */
export async function autoPushTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  const { error } = await supabase.from("tasks").upsert(tasks.map((t) => ({ ...t, user_id: userId })));
  if (error) console.error("AutoSync error (tasks bulk):", error);
}

/** Sube un lote de proyectos (upsert por id). Silencioso si no hay sesión. */
export async function autoPushProjects(projects: Project[]): Promise<void> {
  if (projects.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  const { error } = await supabase.from("projects").upsert(projects.map((p) => ({ ...p, user_id: userId })));
  if (error) console.error("AutoSync error (projects bulk):", error);
}

/** ¿Debe subirse esta fila local?
 *  - la nube no la conoce → sí (creada offline);
 *  - la nube no tiene reloj pero lo local sí → sí (lo local es lo que manda);
 *  - solo subimos si lo local es más reciente. Lo local sin reloj no se sube
 *    aquí: `pullAndSyncFromSupabase` le pone marcaje y se subirá la sync
 *    siguiente, así evitamos repetir el mismo upsert para siempre. */
function needsPush(local: SyncRecord, remoteTime: number, remoteKnown: boolean): boolean {
  if (!remoteKnown) return true;
  const localTime = timestamp(local.updatedAt);
  if (localTime === 0) return false;
  return remoteTime === 0 || localTime > remoteTime;
}

/**
 * Fase de subida: lleva a la nube todo lo que existe solo en local o cuya
 * copia local es más reciente que la remota. Devuelve cuánto se subió.
 *
 * Es el paso PREVIO al pull, y el que garantiza que no se pierda trabajo
 * hecho sin conexión.
 */
export async function pushLocalChanges(): Promise<{ tasks: number; projects: number }> {
  const userId = await sessionUserId();
  if (!userId) return { tasks: 0, projects: 0 };

  const [remoteTasks, remoteProjects] = await Promise.all([
    supabase.from("tasks").select("id, updatedAt"),
    supabase.from("projects").select("id, updatedAt"),
  ]);

  // Si la nube no responde no asumimos "todo es local": abortar el push es lo
  // que impide pisar una edición hecha en otro dispositivo.
  if (remoteTasks.error || remoteProjects.error) {
    console.error("Push cancelado, la nube no respondió:", remoteTasks.error ?? remoteProjects.error);
    return { tasks: 0, projects: 0 };
  }

  const remoteTaskTime = new Map<string, number>(
    (remoteTasks.data ?? []).map((r) => [r.id, timestamp(r.updatedAt)]),
  );
  const remoteProjectTime = new Map<string, number>(
    (remoteProjects.data ?? []).map((r) => [r.id, timestamp(r.updatedAt)]),
  );

  const [localTasks, localProjects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);

  const tasksToPush = localTasks.filter((t) => needsPush(t, remoteTaskTime.get(t.id) ?? 0, remoteTaskTime.has(t.id)));
  const projectsToPush = localProjects.filter((p) => needsPush(p, remoteProjectTime.get(p.id) ?? 0, remoteProjectTime.has(p.id)));

  await Promise.all([autoPushTasks(tasksToPush), autoPushProjects(projectsToPush)]);
  return { tasks: tasksToPush.length, projects: projectsToPush.length };
}

/**
 * Descarga la nube y la fusiona con lo local. Nunca hace `clear()`:
 *
 *  - existe solo en la nube → se baja;
 *  - existe solo en local  → ya se subió en el paso anterior;
 *  - existe en ambos       → manda `mergeDecision` (último en escribir gana,
 *    y si a falta un reloj manda lo local).
 *
 * Si la nube falla en cualquier punto, lo local queda intacto.
 */
export async function pullAndSyncFromSupabase(): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) return; // Sin cuenta no hay nube: todo sigue siendo local.

  // 1) Subir primero. Este paso es el que evita perder datos offline.
  await pushLocalChanges();

  // 2) Bajar.
  const [{ data: pData, error: pErr }, { data: tData, error: tErr }] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("tasks").select("*"),
  ]);
  if (pErr || tErr) {
    console.error("Pull abortado (la nube falló, lo local se conserva):", pErr ?? tErr);
    return;
  }

  // 3) Fusionar dentro de una transacción.
  await db.transaction("rw", db.tasks, db.projects, async () => {
    for (const raw of pData ?? []) {
      const remote = stripRemote(raw);
      const local = await db.projects.get(remote.id);
      if (mergeDecision(local, remote) === "take-remote") {
        await db.projects.put(remote);
      } else if (local && !local.updatedAt) {
        // Fila de antes de la migración: le damos reloj para que en la
        // próxima sincronización se suba y las dos copas converjan.
        await db.projects.update(local.id, { updatedAt: stampNow() });
      }
    }
    for (const raw of tData ?? []) {
      const remote = stripRemote(raw);
      const local = await db.tasks.get(remote.id);
      if (mergeDecision(local, remote) === "take-remote") {
        await db.tasks.put(remote);
      } else if (local && !local.updatedAt) {
        await db.tasks.update(local.id, { updatedAt: stampNow() });
      }
    }
  });
}

/** Sube (Upsert) una tarea a Supabase silenciosamente en segundo plano. */
export async function autoPushTask(task: Task): Promise<void> {
  await autoPushTasks([task]);
}

/** Elimina una tarea de Supabase en segundo plano. */
export async function autoDeleteTask(id: string): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) return;

  supabase.from("tasks").delete().eq("id", id).then(({ error }) => {
    if (error) console.error("AutoSync delete error (Task):", error);
  });
}

/** Sube (Upsert) un proyecto a Supabase silenciosamente en segundo plano. */
export async function autoPushProject(project: Project): Promise<void> {
  await autoPushProjects([project]);
}

/** Elimina un proyecto de Supabase en segundo plano. */
export async function autoDeleteProject(id: string): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) return;

  supabase.from("projects").delete().eq("id", id).then(({ error }) => {
    if (error) console.error("AutoSync delete error (Project):", error);
  });
}
