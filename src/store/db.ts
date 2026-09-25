import Dexie, { type EntityTable } from "dexie";
import type { Project, Task } from "@/domain/types";
import { toISODate } from "@/domain/dateutils";

export class TareasDB extends Dexie {
  tasks!: EntityTable<Task, "id">;
  projects!: EntityTable<Project, "id">;

  constructor() {
    super("tareas-db");
    this.version(1).stores({
      tasks: "id, status, dueDate, projectId, parentId, order, *labels",
      projects: "id, name",
    });
  }
}

export const db = new TareasDB();

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

