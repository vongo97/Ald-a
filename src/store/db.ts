import Dexie, { type EntityTable } from "dexie";
import type { Project, Task } from "@/domain/types";
import { toISODate } from "@/domain/dateutils";

export interface Tombstone {
  id: string;
  kind: "tasks" | "projects";
  updatedAt: string;
}

export class TareasDB extends Dexie {
  tasks!: EntityTable<Task, "id">;
  projects!: EntityTable<Project, "id">;
  tombstones!: EntityTable<Tombstone, any>;

  constructor() {
    super("tareas-db");
    this.version(1).stores({
      tasks: "id, status, dueDate, projectId, parentId, order, *labels",
      projects: "id, name",
    });
    // v2: tabla de tumbas para propagar borrados offline.
    this.version(2).stores({
      tombstones: "[kind+id], updatedAt",
    });
  }
}

export const db = new TareasDB();

/** Timestamp ISO para sellar escrituras y borrados. */
export const stampNow = (): string => new Date().toISOString();

/**
 * Sella `updatedAt` en TODA escritura, sin que cada punto de llamada
 * tenga que acordárselo (esto cubre también los `put()` directos de BreakdownButton).
 *
 * Regla clave: solo sella si quien escribe no trae ya su propio `updatedAt`.
 * Así `pullAndSyncFromSupabase` conserva el timestamp real de la nube en vez
 * de pisarlo con "ahora", y la importación de un backup respeta sus fechas.
 */
db.tasks.hook("creating", (_primKey, obj) => {
  const target = obj as unknown as Task;
  if (!target.updatedAt) target.updatedAt = stampNow();
});

db.projects.hook("creating", (_primKey, obj) => {
  const target = obj as unknown as Project;
  if (!target.updatedAt) target.updatedAt = stampNow();
});

/**
 * Actualización parcial que SELLA `updatedAt`, salvo que quien llame traiga su
 * propia fecha (el pull de la nube y la importación de un backup respetan la
 * fecha del autor).
 *
 * ── Por qué esto NO es un hook ────────────────────────────────────────────
 *
 * Aquí hubo un hook `updating` con la intención de sellar la fecha sola:
 *
 *   db.tasks.hook("updating", (mods) => {
 *     if (!("updatedAt" in mods)) mods.updatedAt = stampNow();
 *   });
 *
 * Parecía funcionar, pero no lo hacía NUNCA. Dexie no entrega a ese hook solo
 * lo que el llamante pasó: le entrega las modificaciones YA combinadas con el
 * registro guardado, `updatedAt` incluido. Así que `"updatedAt" in mods` era
 * siempre true y el `if` nunca entraba. El hook se disparaba, se leía, y no
 * sellaba nada. Un fallo silencioso: no daba error, solo una fecha congelada.
 *
 * Eso era grave porque `updatedAt` es el reloj de toda la sincronización:
 * `needsPush` sube solo lo local MÁS RECIENTE, y `mergeDecision` hace ganar al
 * más reciente. Con la fecha clavada desde la creación, ni una edición ni un
 * "completar" eran más recientes que nada, así que:
 *
 *  - Una edición hecha sin conexión NO se subía al reconectar: `needsPush` ve
 *    empate y dice que no. El trabajo offline se perdía en silencio.
 *  - Dos dispositivos nunca convergían: empate para los dos, cada uno se
 *    queda con su versión, para siempre.
 *
 * `patchTask` / `patchProject` hacen el sellado explícito y en un sitio solo.
 * Un test (`db.test.ts`) impide que vuelva a colarse un `db.tasks.update()`
 * suelto por ahí.
 */
export async function patchTask(id: string, changes: Partial<Task>): Promise<void> {
  await db.tasks.update(id, "updatedAt" in changes ? changes : { ...changes, updatedAt: stampNow() });
}

export async function patchProject(id: string, changes: Partial<Project>): Promise<void> {
  await db.projects.update(id, "updatedAt" in changes ? changes : { ...changes, updatedAt: stampNow() });
}

const uid = (): string =>
  crypto.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const newId = uid;

export async function seedIfEmpty(): Promise<void> {
  const count = await db.tasks.count();
  if (count > 0) return;
  const now = new Date().toISOString();
  const hoy = toISODate(new Date());
  const manana = toISODate(new Date(Date.now() + 86400_000));
  const projectId = uid();
  await db.projects.bulkPut([
    { id: projectId, name: "Personal", color: "#38bdf8" },
    { id: uid(), name: "Trabajo", color: "#f472b6" },
  ]);
  await db.tasks.bulkPut([
    {
      id: uid(),
      title: "Bienvenida: pulsa / para capturar una tarea",
      labels: ["guía"],
      priority: 2,
      importance: 3,
      status: "todo",
      order: 0,
      createdAt: now,
      dueDate: hoy,
    },
    {
      id: uid(),
      title: "Prueba la captura rápida: escribe «Llamar al fontanero mañana a las 10»",
      labels: ["guía"],
      priority: 3,
      importance: 3,
      status: "todo",
      order: 1,
      createdAt: now,
      dueDate: manana,
    },
    {
      id: uid(),
      title: "Revisa la vista Revisión semanal los domingos",
      labels: ["guía"],
      priority: 3,
      importance: 2,
      recurrence: { kind: "weekly", every: 1, weekdays: [0] },
      status: "todo",
      order: 2,
      createdAt: now,
      dueDate: hoy,
    },
  ]);
}
