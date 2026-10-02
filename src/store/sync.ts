import { db, patchProject, patchTask, stampNow } from "./db";
import { supabase } from "./supabase";
import { mergeDecision, timestamp, type SyncRecord } from "./merge";
import { useStore } from "./useStore";
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
  const id = data.session?.user?.id ?? null;
  if (id) await ensureSyncOwner(id);
  return id;
}

/** Cuenta dueña de los datos locales (evita mezclar cuentas en un dispositivo). */
const SYNC_OWNER_KEY = "ald-a:sync-owner";

/**
 * Asegura que los datos locales pertenecen a `userId` ANTES de cualquier
 * subida o bajada (todos los caminos pasan por `sessionUserId`).
 *
 *  - Primera cuenta del dispositivo → se conserva lo local: es la
 *    migración natural (lo no sincronizado se sube a esa cuenta).
 *  - Cambio de cuenta → se limpia tasks/projects/tombstones. Sin esto, lo
 *    del usuario anterior se subiría con el `user_id` nuevo y las cuentas
 *    se mezclarían; su dato sigue a salvo en SU cuenta.
 *
 * Best-effort: cualquier fallo (p. ej. sin localStorage en tests) no debe
 * romper la sincronización.
 */
async function ensureSyncOwner(userId: string): Promise<void> {
  try {
    const owner = localStorage.getItem(SYNC_OWNER_KEY);
    if (owner === userId) return;
    if (owner !== null) {
      console.info("[sync] Cambio de cuenta: se limpia lo local para no mezclar datos.");
      await db.transaction("rw", db.tasks, db.projects, db.tombstones, async () => {
        await db.tasks.clear();
        await db.projects.clear();
        await db.tombstones.clear();
      });
    }
    localStorage.setItem(SYNC_OWNER_KEY, userId);
  } catch (err) {
    console.warn("[sync] No se pudo verificar la cuenta dueña de los datos:", err);
  }
}

/**
 * Quita columnas de servidor y normaliza el caso.
 *
 * El modelo local usa camelCase (`updatedAt`, `deletedAt`) pero Supabase
 * tiene `updated_at`/`deleted_at` (snake_case, añadidos por las migraciones
 * 0001 y 0005). Sin este mapeo, cualquier `select`/`upsert` con `updatedAt`
 * devuelve 400 y la sync entera se aborta.
 *
 * Exportada para tests.
 */
export function stripRemote<T>(row: Record<string, unknown>): T {
  const { user_id: _userId, updated_at, deleted_at, ...rest } = row;
  return {
    ...rest,
    ...(updated_at !== undefined ? { updatedAt: updated_at } : {}),
    ...(deleted_at !== undefined ? { deletedAt: deleted_at } : {}),
  } as T;
}

/** Convierte el modelo local (camelCase) a las columnas reales de Supabase. Exportada para tests. */
export function toRemote(row: Record<string, unknown>): Record<string, unknown> {
  const { updatedAt, deletedAt, ...rest } = row;
  return {
    ...rest,
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
    ...(deletedAt !== undefined ? { deleted_at: deletedAt } : {}),
  };
}

/** Sube un lote de tareas (upsert por id). Silencioso si no hay sesión. */
export async function autoPushTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  const { error } = await supabase
    .from("tasks")
    .upsert(tasks.map((t) => ({ ...toRemote(t as unknown as Record<string, unknown>), user_id: userId })));
  if (error) console.error("AutoSync error (tasks bulk):", error);
}

/** Sube un lote de proyectos (upsert por id). Silencioso si no hay sesión. */
export async function autoPushProjects(projects: Project[]): Promise<void> {
  if (projects.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  const { error } = await supabase
    .from("projects")
    .upsert(projects.map((p) => ({ ...toRemote(p as unknown as Record<string, unknown>), user_id: userId })));
  if (error) console.error("AutoSync error (projects bulk):", error);
}

/** ¿Debe subirse esta fila local?
 *  - la nube no la conoce → sí (creada offline);
 *  - la nube no tiene reloj pero lo local sí → sí (lo local es lo que manda);
 *  - solo subimos si lo local es más reciente. Lo local sin reloj no se sube
 *    aquí: `pullAndSyncFromSupabase` le pone marcaje y se subirá la sync
 *    siguiente, así evitamos repetir el mismo upsert para siempre.
 *
 * Exportada para tests. */
export function needsPush(local: SyncRecord, remoteTime: number, remoteKnown: boolean): boolean {
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
/** Solo se usa dentro de `pullAndSyncFromSupabase`: no se exporta. */
async function pushLocalChanges(): Promise<{ tasks: number; projects: number }> {
  const userId = await sessionUserId();
  if (!userId) return { tasks: 0, projects: 0 };

  const [remoteTasks, remoteProjects] = await Promise.all([
    supabase.from("tasks").select("id, updated_at"),
    supabase.from("projects").select("id, updated_at"),
  ]);

  // Si la nube no responde no asumimos "todo es local": abortar el push es lo
  // que impide pisar una edición hecha en otro dispositivo.
  if (remoteTasks.error || remoteProjects.error) {
    console.error("Push cancelado, la nube no respondió:", remoteTasks.error ?? remoteProjects.error);
    return { tasks: 0, projects: 0 };
  }

  const remoteTaskTime = new Map<string, number>(
    (remoteTasks.data ?? []).map((r) => [r.id, timestamp((r as { updated_at?: string }).updated_at)]),
  );
  const remoteProjectTime = new Map<string, number>(
    (remoteProjects.data ?? []).map((r) => [r.id, timestamp((r as { updated_at?: string }).updated_at)]),
  );

  const [localTasks, localProjects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);

  const tasksToPush = localTasks.filter((t) => needsPush(t, remoteTaskTime.get(t.id) ?? 0, remoteTaskTime.has(t.id)));
  const projectsToPush = localProjects.filter((p) => needsPush(p, remoteProjectTime.get(p.id) ?? 0, remoteProjectTime.has(p.id)));

  await Promise.all([autoPushTasks(tasksToPush), autoPushProjects(projectsToPush)]);
  return { tasks: tasksToPush.length, projects: projectsToPush.length };
}

/** Resumen de una pasada de sync, para el indicador de estado y avisos. */
export interface SyncSummary {
  pushedTasks: number;
  pushedProjects: number;
  pulledTasks: number;
  pulledProjects: number;
  remoteDeletes: number;
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
 * Devuelve un `SyncSummary` con lo que hizo; `null` si no hay sesión.
 */
export async function pullAndSyncFromSupabase(): Promise<SyncSummary | null> {
  const userId = await sessionUserId();
  if (!userId) return null; // Sin cuenta no hay nube: todo sigue siendo local.

  useStore.getState().setSyncStatus("syncing");
  try {
    // 1) Subir primero. Este paso es el que evita perder datos offline.
    const pushed = await pushLocalChanges();

    // 2) Bajar tareas y proyectos.
    const [{ data: pData, error: pErr }, { data: tData, error: tErr }] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
    ]);
    if (pErr || tErr) {
      console.error("Pull abortado (la nube falló, lo local se conserva):", pErr ?? tErr);
      useStore.getState().setSyncStatus("error", (pErr ?? tErr)?.message ?? "Error desconocido");
      return null;
    }

    // 3) Bajar tumbas para aplicar borrados remotos.
    //    El `.eq("user_id", userId)` es redundante con RLS, pero deja la
    //    intención explícita y protege si la política llegara a relajarse.
    const [{ data: tombData, error: tombErr }] = await Promise.all([
      supabase.from("tombstones").select("id, kind, updated_at").eq("user_id", userId),
    ]);
    if (tombErr) console.error("Pull de tumbas falló:", tombErr);

    let remoteDeletes = 0;
    let pulledTasks = 0;
    let pulledProjects = 0;

    // 4) Fusionar dentro de una transacción.
    await db.transaction("rw", db.tasks, db.projects, db.tombstones, async () => {
      for (const raw of pData ?? []) {
        const remote = stripRemote<Project>(raw as Record<string, unknown>);
        const local = await db.projects.get(remote.id);
        if (mergeDecision(local, remote) === "take-remote") {
          await db.projects.put(remote);
          pulledProjects++;
        } else if (local && !local.updatedAt) {
          await patchProject(local.id, { updatedAt: stampNow() });
        }
      }
      for (const raw of tData ?? []) {
        const remote = stripRemote<Task>(raw as Record<string, unknown>);
        const local = await db.tasks.get(remote.id);
        if (mergeDecision(local, remote) === "take-remote") {
          await db.tasks.put(remote);
          pulledTasks++;
        } else if (local && !local.updatedAt) {
          await patchTask(local.id, { updatedAt: stampNow() });
        }
      }

      // Las tumbas van DESPUÉS de las filas, no antes.
      //
      // Antes se aplicaban primero, detrás de una guarda `if (local && …)`. En
      // un dispositivo limpio no hay `local`, así que la guarda no se cumplía
      // y el borrado se descartaba entero; acto seguido la fila llegaba viva
      // y `mergeDecision(undefined, remote)` la daba por buena. Resultado: la
      // tarea que habías borrado en otro teléfono reaparecía como activa.
      //
      // Con este orden, cuando llega la fila ya está en local y la tumba sí
      // puede marcarla. También repara sola las filas que quedaron con
      // `deleted_at = null` en la nube mientras el protocolo estaba a medias:
      // su tumba sigue ahí y ahora sí llega a tiempo.
      for (const raw of (tombData ?? []) as { id: string; kind: string; updated_at: string }[]) {
        const remoteTime = timestamp(raw.updated_at);
        if (raw.kind === "tasks") {
          const local = await db.tasks.get(raw.id);
          if (local && (!local.deletedAt || timestamp(local.deletedAt) < remoteTime)) {
            // `updatedAt` va con la fecha de la tumba a propósito. La fila acaba
            // de cambiar de estado AHORA, y su reloj tiene que reflejarlo:
            //
            //  - Deja la copia local MÁS RECIENTE que la que quedó en la nube
            //    (que puede venir con `deleted_at = null` de cuando el protocolo
            //    de borrado estaba a medias). Así el siguiente push sube el
            //    `deleted_at` y esa fila se repara sola.
            //  - Si el `updatedAt` se dejara clavado, `needsPush` vería empate y
            //    no subiría nada: la reparación nunca ocurriría.
            await patchTask(raw.id, { deletedAt: raw.updated_at, updatedAt: raw.updated_at });
            remoteDeletes++;
          }
        } else if (raw.kind === "projects") {
          const local = await db.projects.get(raw.id);
          if (local && (!local.deletedAt || timestamp(local.deletedAt) < remoteTime)) {
            await patchProject(raw.id, { deletedAt: raw.updated_at, updatedAt: raw.updated_at });
            remoteDeletes++;
          }
        }
        // Guardamos la tumba local para que el próximo push la re-envíe si hace falta.
        await db.tombstones.put({ id: raw.id, kind: raw.kind as "tasks" | "projects", updatedAt: raw.updated_at });
      }
    });

    useStore.getState().setSyncStatus("synced");
    return {
      pushedTasks: pushed.tasks,
      pushedProjects: pushed.projects,
      pulledTasks,
      pulledProjects,
      remoteDeletes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Sync falló (lo local se conserva):", err);
    useStore.getState().setSyncStatus("error", msg);
    return null;
  }
}

/** Sube (Upsert) una tarea a Supabase silenciosamente en segundo plano. */
export async function autoPushTask(task: Task): Promise<void> {
  await autoPushTasks([task]);
}

/**
 * Protocolo de borrado en la nube: SUBE LA FILA con `deleted_at` Y ESCRIBE LA
 * TUMBA. Son las dos mitades, y el motivo es el espejo exacto del que ya
 * documenta `autoRestoreRows`:
 *
 *  - Solo la tumba, que es lo que pasaba antes: la fila seguía diciendo «viva»
 *    en la nube. Un dispositivo que aún no tenía la tarea se la bajaba tal
 *    cual, `mergeDecision` veía `local === undefined` y devolvía
 *    `take-remote`, así que la tarea borrada en otro dispositivo reaparecía
 *    como activa. La tombstone no cumplía su función porque el pull la aplicaba
 *    antes de que existiera la fila que pretendía marcar.
 *  - Solo la fila: si la nube pierde la fila, el borrado no deja ni rastro.
 *
 * Aquí se mandan las filas enteras a propósito. Un upsert con solo `id` y
 * `deleted_at` crearía la fila con el resto de columnas nulas, y una tarea sin
 * título ni fecha es peor que una tarea que no existe.
 *
 * Silenciosa si no hay sesión: lo local ya quedó borrado.
 */
async function autoPushDeletedRows(
  table: "tasks" | "projects",
  kind: "tasks" | "projects",
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  // Una sola fecha para las dos mitades: fila y tumba tienen que contar la
  // misma historia. Con fechas distintas, el pull podría aplicar el borrado
  // desde una y luego dejar que la otra lo revirtiera.
  const now = stampNow();
  const [{ error: rowErr }, { error: tombErr }] = await Promise.all([
    supabase
      .from(table)
      .upsert(rows.map((r) => ({ ...toRemote(r), deleted_at: now, user_id: userId }))),
    supabase
      .from("tombstones")
      .upsert(
        rows.map((r) => ({ id: r.id as string, kind, user_id: userId, updated_at: now })),
        // onConflict explícito: la PK es compuesta (kind, id) desde la 0009.
        { onConflict: "id,kind" },
      ),
  ]);
  if (rowErr) console.error(`AutoSync delete error (${table} rows):`, rowErr);
  if (tombErr) console.error(`AutoSync delete error (${kind} tombstones):`, tombErr);
}

/** Marca el borrado de un lote de tareas en la nube (fila + tumba). */
export async function autoPushDeletedTasks(tasks: Task[]): Promise<void> {
  await autoPushDeletedRows("tasks", "tasks", tasks as unknown as Array<Record<string, unknown>>);
}

/** Marca el borrado de un proyecto en la nube (fila + tumba). */
export async function autoPushDeletedProjects(projects: Project[]): Promise<void> {
  await autoPushDeletedRows("projects", "projects", projects as unknown as Array<Record<string, unknown>>);
}

/** Sube (Upsert) un proyecto a Supabase silenciosamente en segundo plano. */
export async function autoPushProject(project: Project): Promise<void> {
  await autoPushProjects([project]);
}

/**
 * Deshace un borrado en la nube (genérico: tasks/projects): borra la tumba
 * remota Y sube las filas con `deleted_at: null`. Hace falta hacer AMBAS cosas:
 *
 *  - si queda la tumba, el próximo pull la re-aplica y vuelve a borrar;
 *  - `toRemote` omite `deleted_at` cuando `deletedAt` es `undefined`, así que
 *    un upsert normal no limpiaría la columna y `mergeDecision` ganaría el
 *    borrado remoto (la parte borrada gana), revirtiendo la restauración.
 *
 * Silenciosa si no hay sesión: lo local ya quedó restaurado.
 */
async function autoRestoreRows(
  table: "tasks" | "projects",
  kind: "tasks" | "projects",
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  // El filtro de `kind` importa: la clave de las tumbas es (kind, id), así
  // que un mismo id puede existir como tumba de tarea y de proyecto.
  // El `user_id` es redundante (la política RLS ya filtra por `auth.uid()`),
  // pero se deja explícito: si algún día la política se relaja, el borrado
  // sigue siendo del usuario y no de otra cuenta.
  const ids = rows.map((r) => r.id as string);
  const [{ error: tombErr }, { error }] = await Promise.all([
    supabase.from("tombstones").delete().in("id", ids).eq("kind", kind).eq("user_id", userId),
    supabase
      .from(table)
      .upsert(
        rows.map((r) => ({
          ...toRemote(r),
          deleted_at: null,
          user_id: userId,
        })),
      ),
  ]);
  if (tombErr) console.error(`AutoSync restore error (${table} tombstones):`, tombErr);
  if (error) console.error(`AutoSync restore error (${table} bulk):`, error);
}

export async function autoRestoreTasks(tasks: Task[]): Promise<void> {
  await autoRestoreRows("tasks", "tasks", tasks as unknown as Array<Record<string, unknown>>);
}

export async function autoRestoreProjects(projects: Project[]): Promise<void> {
  await autoRestoreRows("projects", "projects", projects as unknown as Array<Record<string, unknown>>);
}

/**
 * Borrado DEFINITIVO en la nube: elimina las filas de `tasks` o `projects`.
 *
 * Las tumbas remotas se conservan a propósito: son la única señal que le
 * dice a otros dispositivos «esto se borró». Sin ellas, quien tenga una copia
 * offline re-subiría la fila en su próximo push y resucitaría el elemento.
 * (Un dispositivo muy viejo genera un ida y vuelta corto: al abrir, su propia
 * caducidad de 30 días purga su copia y deja de re-subir.)
 *
 * Silenciosa si no hay sesión (nada que borrar en la nube).
 */
export async function purgeRemoteRows(
  table: "tasks" | "projects",
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const userId = await sessionUserId();
  if (!userId) return;
  const { error } = await supabase.from(table).delete().in("id", ids).eq("user_id", userId);
  if (error) console.error(`Purge error (${table}):`, error);
}
