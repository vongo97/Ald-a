import { db, newId, stampNow } from "./db";
import type { ParsedCapture } from "@/parsers/capture";
import type { Project, Task } from "@/domain/types";
import { nextOccurrence } from "@/domain/recurrence";
import { toISODate, parseISODate } from "@/domain/dateutils";
import { autoPushTask, autoPushProject, autoPushTasks, autoPushDeletedTasks, autoPushDeletedProjects, autoRestoreTasks, autoRestoreProjects } from "./sync";
import { timeToMin } from "@/domain/schedule";
import { randomColor } from "@/domain/color";
import { restoreSet } from "@/domain/trash";

export async function createProject(name: string, color: string): Promise<Project> {
  const p: Project = { id: newId(), name, color };
  await db.projects.put(p);
  void autoPushProject(p);
  return p;
}

export async function updateProject(id: string, changes: Partial<Project>): Promise<void> {
  await db.projects.update(id, changes);
  const updated = await db.projects.get(id);
  if (updated) void autoPushProject(updated);
}

export async function deleteProject(id: string): Promise<void> {
  // Recojo los ids ANTES de desengancharlos para poder re-lerlos y subirlos.
  const affectedIds = (await db.tasks.where("projectId").equals(id).toArray()).map((t) => t.id);

  await db.transaction("rw", db.tasks, db.projects, db.tombstones, async () => {
    await db.tasks.where("projectId").equals(id).modify({ projectId: undefined });
    // Borrado suave: marcamos deletedAt y creamos tumba.
    const now = stampNow();
    await db.projects.update(id, { deletedAt: now });
    await db.tombstones.put({ id, kind: "projects", updatedAt: now });
  });

  // El proyecto se sube borrado (fila + tumba). Las tareas que colgaban de él
  // se desenganchan, no se borran: van vivas, con `projectId` vacío.
  const gone = await db.projects.get(id);
  if (gone) void autoPushDeletedProjects([gone]);
  const detached: Task[] = [];
  for (const taskId of affectedIds) {
    const fresh = await db.tasks.get(taskId);
    if (fresh) detached.push(fresh);
  }
  void autoPushTasks(detached);
}

export async function createTaskFromCapture(
  parsed: ParsedCapture,
  extra: Partial<Task> = {},
): Promise<Task> {
  let projectId = parsed.projectId;
  if (!projectId && parsed.projectName) {
    const existing = await db.projects.where("name").equals(parsed.projectName).first();
    projectId = existing?.id ?? (await createProject(parsed.projectName, randomColor())).id;
  }
  const order = (await db.tasks.where("status").equals("todo").count()) || 0;
  const task: Task = {
    id: newId(),
    title: parsed.title,
    labels: parsed.labels,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    recurrence: parsed.recurrence,
    priority: parsed.priority ?? 3,
    importance: parsed.importance ?? 3,
    durationMin: parsed.durationMin,
    status: "todo",
    order,
    createdAt: new Date().toISOString(),
    ...extra,
  };
  if (projectId) task.projectId = projectId;
  await db.tasks.put(task);
  void autoPushTask(task);
  return task;
}

export async function updateTask(id: string, changes: Partial<Task>): Promise<void> {
  await db.tasks.update(id, changes);
  const updated = await db.tasks.get(id);
  if (updated) void autoPushTask(updated);
}

export async function toggleTask(task: Task): Promise<void> {
  if (task.status === "todo") {
    const changes: Partial<Task> = { status: "done", completedAt: new Date().toISOString() };
    // Recurrentes: crear la siguiente aparición
    if (task.recurrence && task.dueDate) {
      const next = nextOccurrence(task.recurrence, parseISODate(task.dueDate));
      const nextTask: Task = {
        ...task,
        id: newId(),
        dueDate: toISODate(next),
        status: "todo",
        order: task.order,
        completedAt: undefined,
        createdAt: new Date().toISOString(),
      };
      changes.recurrence = undefined; // la completada deja de ser recurrente
      await db.tasks.put(nextTask);
      void autoPushTask(nextTask);
    }
    await db.tasks.update(task.id, changes);
  } else {
    await db.tasks.update(task.id, { status: "todo", completedAt: undefined });
  }
  const updated = await db.tasks.get(task.id);
  if (updated) void autoPushTask(updated);
}

/**
 * Recojo TODA la descendencia de un id (hijos, nietos...): el plan tiene 3
 * niveles y antes solo se marcaban los hijos directos, dejando huérfanas vivas
 * a los sub-subtasks al borrar «Plan del día».
 */
async function collectDescendants(rootId: string): Promise<Task[]> {
  const out: Task[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift() as string;
    const children = await db.tasks.where("parentId").equals(parentId).toArray();
    out.push(...children);
    queue.push(...children.map((c) => c.id));
  }
  return out;
}

export async function deleteTask(id: string): Promise<void> {
  // Borrado suave en cascada: la tarea y TODA su descendencia.
  const root = await db.tasks.get(id);
  const toDelete = [...(root ? [root] : []), ...(await collectDescendants(id))];

  await db.transaction("rw", db.tasks, db.tombstones, async () => {
    const now = stampNow();
    for (const t of toDelete) {
      await db.tasks.update(t.id, { deletedAt: now });
      await db.tombstones.put({ id: t.id, kind: "tasks", updatedAt: now });
    }
  });

  // La nube se entera por las DOS vías del protocolo de borrado: la fila con
  // `deleted_at` puesto y la tumba. Subiendo solo la tumba, la fila seguía
  // «viva» en el servidor y el pull la resucitaba en un dispositivo limpio.
  // Ver `autoPushDeletedRows`.
  const deleted = (await Promise.all(toDelete.map((t) => db.tasks.get(t.id)))).filter(
    (r): r is Task => Boolean(r),
  );
  void autoPushDeletedTasks(deleted);
}

/**
 * Deshace un borrado de forma SELECTIVA: restaura la tarea, sus ancestros
 * borrados (para que sea visible bajo un padre vivo) y su descendencia
 * borrada (la cascada de `deleteTask` se deshace entera). Nunca toca
 * hermanas ni nada fuera de esa rama.
 *
 * Lo local se limpia en una transacción (quito `deletedAt` y las tumbas
 * locales) y luego se sincroniza: sin borrar las tumbas remotas y subir
 * `deleted_at: null`, el siguiente pull volvería a borrarlo todo.
 *
 * Devuelve cuántas tareas ha restaurado (para el toast de la Papelera).
 */
export async function restoreTask(id: string): Promise<number> {
  const all = await db.tasks.toArray();
  const toRestore = restoreSet(all, id);
  if (toRestore.length === 0) return 0;

  const now = stampNow();
  const restored: Task[] = [];
  await db.transaction("rw", db.tasks, db.tombstones, async () => {
    for (const t of toRestore) {
      const fresh: Task = { ...t, deletedAt: undefined, updatedAt: now };
      restored.push(fresh);
      await db.tasks.put(fresh);
      await db.tombstones.delete(["tasks", t.id]);
    }
  });

  void autoRestoreTasks(restored);
  return restored.length;
}

/**
 * Deshace el borrado de un proyecto (mismo patrón que `restoreTask`): limpia
 * `deletedAt`, quita la tumba local y luego sincroniza (tumba remota +
 * `deleted_at: null`).
 *
 * Nota: las tareas NO vuelven a engancharse — al borrar el proyecto se
 * desengancharon para siempre (`deleteProject` las deja sin proyecto); solo
 * se recupera la carpeta.
 *
 * Devuelve 1 si restaura, 0 si no había nada que restaurar.
 */
export async function restoreProject(id: string): Promise<number> {
  const project = await db.projects.get(id);
  if (!project || !project.deletedAt) return 0;

  const fresh: Project = { ...project, deletedAt: undefined, updatedAt: stampNow() };
  await db.transaction("rw", db.projects, db.tombstones, async () => {
    await db.projects.put(fresh);
    await db.tombstones.delete(["projects", id]);
  });

  void autoRestoreProjects([fresh]);
  return 1;
}

export async function addSubtask(parent: Task, title: string): Promise<Task> {
  const count = await db.tasks.where("parentId").equals(parent.id).count();
  const t: Task = {
    id: newId(),
    title,
    labels: [],
    priority: parent.priority,
    importance: parent.importance,
    status: "todo",
    parentId: parent.id,
    order: count,
    createdAt: new Date().toISOString(),
    // Hereda el día del padre: si no, al completarla no movía el % del día.
    ...(parent.dueDate ? { dueDate: parent.dueDate } : {}),
  };
  await db.tasks.put(t);
  void autoPushTask(t);
  return t;
}

/**
 * Crea varias subtareas de golpe y las sube a la nube en UNA sola llamada.
 *
 * Antes `BreakdownButton` hacía `db.tasks.put()` directo: las subtareas se
 * quedaban en local y nunca llegaban a Supabase. (El hook de Dexie sí les
 * sellaba `updatedAt`, pero nada las empujaba.)
 */
export async function addSubtasks(
  parent: Task,
  items: { title: string; durationMin?: number; start?: string; end?: string; labels?: string[] }[],
): Promise<Task[]> {
  const base = await db.tasks.where("parentId").equals(parent.id).count();
  const created: Task[] = items.map((s, i) => ({
    id: newId(),
    title: s.title,
    labels: s.labels ?? [],
    priority: parent.priority,
    importance: parent.importance,
    status: "todo",
    parentId: parent.id,
    order: base + i,
    createdAt: new Date().toISOString(),
    // SIEMPRE hereda el día del padre: si no, al completarla no movía el
    // % del día (bug de la auditoría de racha: «se llena si borro, no si
    // cumplo»). Las que llevan horario además nacen con timeBlock, misma
    // regla que sigue SubtaskTimePanel al bloquear horas.
    ...(parent.dueDate ? { dueDate: parent.dueDate } : {}),
    ...(s.start && s.end
      ? {
          timeBlock: { start: s.start, end: s.end },
          durationMin: s.durationMin ?? timeToMin(s.end) - timeToMin(s.start),
        }
      : s.durationMin
        ? { durationMin: s.durationMin }
        : {}),
  }));
  await db.tasks.bulkPut(created);
  void autoPushTasks(created);
  return created;
}

export async function reorderTasks(orderedIds: string[]): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.tasks.update(orderedIds[i], { order: i });
    }
  });
  // El orden vive en `order`, así que hay que subirlo: antes se quedaba solo en local.
  const moved: Task[] = [];
  for (const id of orderedIds) {
    const fresh = await db.tasks.get(id);
    if (fresh) moved.push(fresh);
  }
  void autoPushTasks(moved);
}

export async function applyReprogramming(
  proposals: { taskId: string; toDate: string }[],
): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    for (const p of proposals) {
      await db.tasks.update(p.taskId, { dueDate: p.toDate });
    }
  });
  // Reprogramar es un cambio de fecha: antes no llegaba nunca a la nube.
  const moved: Task[] = [];
  for (const p of proposals) {
    const fresh = await db.tasks.get(p.taskId);
    if (fresh) moved.push(fresh);
  }
  void autoPushTasks(moved);
}
