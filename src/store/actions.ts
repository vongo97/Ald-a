import { db, newId } from "./db";
import type { ParsedCapture } from "@/parsers/capture";
import type { Priority, Project, Task } from "@/domain/types";
import { nextOccurrence } from "@/domain/recurrence";
import { toISODate, parseISODate } from "@/domain/dateutils";
import { autoPushTask, autoDeleteTask, autoPushProject, autoDeleteProject, autoPushTasks } from "./sync";
import { randomColor } from "@/domain/color";

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

  await db.transaction("rw", db.tasks, db.projects, async () => {
    await db.tasks.where("projectId").equals(id).modify({ projectId: undefined });
    await db.projects.delete(id);
  });

  // La nube también se entera: el proyecto desaparece y sus tareas quedan huérfanas.
  void autoDeleteProject(id);
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

export async function deleteTask(id: string): Promise<void> {
  // Elimina también subtareas
  const subtasks = await db.tasks.where("parentId").equals(id).toArray();
  
  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.where("parentId").equals(id).delete();
    await db.tasks.delete(id);
  });
  
  void autoDeleteTask(id);
  subtasks.forEach(st => void autoDeleteTask(st.id));
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
  items: { title: string; durationMin?: number }[],
): Promise<Task[]> {
  const base = await db.tasks.where("parentId").equals(parent.id).count();
  const created: Task[] = items.map((s, i) => ({
    id: newId(),
    title: s.title,
    labels: [],
    priority: parent.priority,
    importance: parent.importance,
    status: "todo",
    parentId: parent.id,
    // Al final y sin empates: el `order: 999` fijo repetía el valor en cada desglose.
    order: base + i,
    createdAt: new Date().toISOString(),
    ...(s.durationMin ? { durationMin: s.durationMin } : {}),
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
