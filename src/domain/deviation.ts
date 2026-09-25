import type { Task } from "./types";
import { addDays, startOfDay, toISODate } from "./dateutils";

export interface ReprogramProposal {
  taskId: string;
  fromDate: string;
  toDate: string;
}

/** Tareas activas cuya fecha ya pasó. */
export function overdueTasks(tasks: Task[], now: Date = new Date()): Task[] {
  const today = toISODate(startOfDay(now));
  return tasks.filter((t) => t.status === "todo" && t.dueDate && t.dueDate < today);
}

/** Propone mover tareas vencidas a hoy y siguientes días libres (en orden de prioridad declarada). */
export function proposeReprogramming(tasks: Task[], now: Date = new Date()): ReprogramProposal[] {
  const overdue = overdueTasks(tasks, now);
  if (overdue.length === 0) return [];

  const today = startOfDay(now);
  const load = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === "todo" && t.dueDate && !t.parentId) {
      load.set(t.dueDate, (load.get(t.dueDate) ?? 0) + (t.durationMin ?? 45));
    }
  }
  const CAP = 240; // 4 h de foco real por día para absorber retrasos
  const proposals: ReprogramProposal[] = [];
  for (const t of overdue) {
    const dur = t.durationMin ?? 45;
    for (let i = 0; i < 14; i++) {
      const date = toISODate(addDays(today, i));
      if ((load.get(date) ?? 0) + dur <= CAP) {
        if (date !== t.dueDate) proposals.push({ taskId: t.id, fromDate: t.dueDate!, toDate: date });
        load.set(date, (load.get(date) ?? 0) + dur);
        break;
      }
    }
  }
  return proposals;
}
