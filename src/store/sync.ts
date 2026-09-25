import { db } from "./db";
import { supabase } from "./supabase";
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

/** Descarga todos los datos de Supabase e inicializa la DB local. Se llama al iniciar sesión o cargar la app. */
export async function pullAndSyncFromSupabase(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return; // No hay usuario autenticado

  const { data: pData, error: pErr } = await supabase.from("projects").select("*");
  if (pErr) console.error("Error pull projects:", pErr);
  
  const { data: tData, error: tErr } = await supabase.from("tasks").select("*");
  if (tErr) console.error("Error pull tasks:", tErr);
  
  await db.transaction("rw", db.tasks, db.projects, async () => {
    // Para simplificar, en una carga completa reemplazamos lo local con la nube (fuente de verdad)
    // En una app más robusta se compararía por `updated_at`.
    if (pData) {
      await db.projects.clear();
      await db.projects.bulkAdd(pData);
    }
    if (tData) {
      await db.tasks.clear();
      await db.tasks.bulkAdd(tData);
    }
  });
}

/** Sube (Upsert) una tarea a Supabase silenciosamente en segundo plano. */
export async function autoPushTask(task: Task): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;
  
  // Le añadimos explícitamente el user_id para RLS
  const payload = { ...task, user_id: session.session.user.id };
  supabase.from("tasks").upsert(payload).then(({ error }) => {
    if (error) console.error("AutoSync error (Task):", error);
  });
}

/** Elimina una tarea de Supabase en segundo plano. */
export async function autoDeleteTask(id: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;

  supabase.from("tasks").delete().eq("id", id).then(({ error }) => {
    if (error) console.error("AutoSync delete error (Task):", error);
  });
}

/** Sube (Upsert) un proyecto a Supabase silenciosamente en segundo plano. */
export async function autoPushProject(project: Project): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;

  const payload = { ...project, user_id: session.session.user.id };
  supabase.from("projects").upsert(payload).then(({ error }) => {
    if (error) console.error("AutoSync error (Project):", error);
  });
}

/** Elimina un proyecto de Supabase en segundo plano. */
export async function autoDeleteProject(id: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;

  supabase.from("projects").delete().eq("id", id).then(({ error }) => {
    if (error) console.error("AutoSync delete error (Project):", error);
  });
}
