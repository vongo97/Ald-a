import { db, newId } from "./db";
import type { ParsedCapture } from "@/parsers/capture";
import type { Priority, Project, Task } from "@/domain/types";
import { nextOccurrence } from "@/domain/recurrence";
import { toISODate, parseISODate } from "@/domain/dateutils";
import { autoPushTask, autoDeleteTask, autoPushProject, autoDeleteProject } from "./sync";

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
  await db.transaction("rw", db.tasks, db.projects, async () => {
    await db.tasks.where("projectId").equals(id).modify({ projectId: undefined });
    await db.projects.delete(id);
  });
  void autoDeleteProject(id);
  // Nota: Deberíamos actualizar las tareas afectadas en Supabase también, pero por simplicidad de la prueba, no lo haremos aquí.
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

export async function reorderTasks(orderedIds: string[]): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.tasks.update(orderedIds[i], { order: i });
    }
  });
}

export async function applyReprogramming(
  proposals: { taskId: string; toDate: string }[],
): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    for (const p of proposals) {
      await db.tasks.update(p.taskId, { dueDate: p.toDate });
    }
  });
}

function randomColor(): string {
  const palette = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#34d399", "#fb7185"];
  return palette[Math.floor(Math.random() * palette.length)];
}
