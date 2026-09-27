import { db } from "./db";
import { purgeRemoteRows } from "./sync";
import { expiredTrash, TRASH_RETENTION_DAYS } from "@/domain/trash";

/**
 * Purga definitiva de la Papelera (borrado suave → eliminación real).
 *
 * Dos formas de llegar aquí:
 *
 *  1. **Vaciar** (`emptyTrash`): el usuario lo pide a mano, se lleva TODO lo
 *     borrado (tareas y proyectos) sin importar antigüedad.
 *  2. **Caducidad** (`purgeExpiredTrash`): automática, lo borrado hace más de
 *     `TRASH_RETENTION_DAYS` días. Se ejecuta tras cada sync desde App.tsx —
 *     así el pull no puede volver a bajar lo recién purgado.
 *
 * En local se borran las filas Y sus tumbas; en la nube solo las filas: la
 * tumba remota queda (véase `purgeRemoteRows`) porque es la única señal de
 * «esto se borró» para el resto de dispositivos.
 */

export interface PurgeCounts {
  tasks: number;
  projects: number;
}

async function purgeRows(table: "tasks" | "projects", ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  if (table === "tasks") {
    await db.transaction("rw", db.tasks, db.tombstones, async () => {
      await db.tasks.bulkDelete(ids);
      await db.tombstones.bulkDelete(ids.map((id) => ["tasks", id] as [string, string]));
    });
  } else {
    await db.transaction("rw", db.projects, db.tombstones, async () => {
      await db.projects.bulkDelete(ids);
      await db.tombstones.bulkDelete(ids.map((id) => ["projects", id] as [string, string]));
    });
  }

  // En la nube solo se eliminan las FILAS (la tumba remota se conserva).
  await purgeRemoteRows(table, ids);
}

/** Vaciado manual: TODOS los borrados (tareas y proyectos). Definitivo. */
export async function emptyTrash(): Promise<PurgeCounts> {
  const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
  const taskIds = tasks.filter((t) => !!t.deletedAt).map((t) => t.id);
  const projectIds = projects.filter((p) => !!p.deletedAt).map((p) => p.id);

  await purgeRows("tasks", taskIds);
  await purgeRows("projects", projectIds);
  return { tasks: taskIds.length, projects: projectIds.length };
}

/** Caducidad automática: borrados con más de `days` días (30 por defecto). */
export async function purgeExpiredTrash(days = TRASH_RETENTION_DAYS): Promise<PurgeCounts> {
  const now = Date.now();
  const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
  const taskIds = expiredTrash(tasks, now, days).map((t) => t.id);
  const projectIds = expiredTrash(projects, now, days).map((p) => p.id);

  await purgeRows("tasks", taskIds);
  await purgeRows("projects", projectIds);
  return { tasks: taskIds.length, projects: projectIds.length };
}
