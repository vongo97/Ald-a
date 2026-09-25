import type { Task } from "./types";
import { parseISODate, startOfDay, toISODate } from "./dateutils";

export interface PriorityScore {
  score: number; // 0–100
  quadrants: { urgent: boolean; important: boolean };
  reasons: string[];
}

const DAY_MS = 86400_000;

/**
 * Score sugerido (la IA propone, el usuario decide).
 * - Urgencia: proximidad de la fecha de vencimiento (vencida = máxima).
 * - Importancia: declarada por el usuario (1 crítica … 4 trivial).
 * - Edad: tareas antiguas sin fecha suben poco a poco (evita el cementerio de la bandeja).
 * - Recurrencia: las recurrentes pendientes piden ser atendidas en su día.
 */
export function priorityScore(task: Task, now: Date = new Date()): PriorityScore {
  const reasons: string[] = [];
  let urgency = 20; // base neutra
  let ageBoost = 0;
  const todayISO = toISODate(startOfDay(now));

  if (task.dueDate) {
    // Comparación por día calendario, no por timestamp
    const dueDay = startOfDay(parseISODate(task.dueDate));
    const todayDay = startOfDay(now);
    const days = Math.round((dueDay.getTime() - todayDay.getTime()) / DAY_MS);
    if (days < 0) {
      urgency = 100;
      reasons.push(`Vencida hace ${-days} día${-days === 1 ? "" : "s"}`);
    } else if (days === 0) {
      urgency = 92;
      reasons.push("Vence hoy");
    } else if (days === 1) {
      urgency = 78;
      reasons.push("Vence mañana");
    } else if (days <= 3) {
      urgency = 62;
      reasons.push("Vence esta semana");
    } else if (days <= 7) {
      urgency = 45;
      reasons.push("Vence en menos de una semana");
    } else {
      urgency = Math.max(10, 40 - days);
      reasons.push(`Vence en ${days} días`);
    }
    if (task.dueTime && days <= 0) urgency = Math.min(100, urgency + 5);
  } else {
    const created = new Date(task.createdAt);
    const ageDays = Math.max(0, Math.floor((startOfDay(now).getTime() - startOfDay(created).getTime()) / DAY_MS));
    ageBoost = Math.min(25, ageDays * 2);
    if (ageDays >= 7) reasons.push(`Lleva ${ageDays} días en la bandeja`);
  }

  const importance = task.importance ?? 3;
  let importanceScore: number;
  switch (importance) {
    case 1:
      importanceScore = 100;
      break;
    case 2:
      importanceScore = 75;
      break;
    case 3:
      importanceScore = 50;
      break;
    default:
      importanceScore = 25;
  }

  let recurrenceBoost = 0;
  if (task.recurrence) {
    recurrenceBoost = 6;
    if (task.dueDate && task.dueDate <= todayISO) {
      recurrenceBoost = 10;
      reasons.push("Recurrente pendiente");
    }
  }

  const score = Math.round(Math.min(100, urgency * 0.55 + importanceScore * 0.35 + ageBoost * 0.4 + recurrenceBoost));

  return {
    score,
    quadrants: {
      urgent: urgency >= 55 || (task.dueDate !== undefined && task.dueDate <= todayISO),
      important: importance <= 2,
    },
    reasons,
  };
}

/** Orden sugerido: score descendente; desempate por fecha, luego createdAt. */
export function sortBySuggested(tasks: Task[], now: Date = new Date()): Task[] {
  return [...tasks].sort((a, b) => {
    const da = priorityScore(a, now);
    const db = priorityScore(b, now);
    if (db.score !== da.score) return db.score - da.score;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Fecha ISO de hoy según el reloj local (helper para vistas/tests). */
export function todayISO(now: Date = new Date()): string {
  return toISODate(startOfDay(now));
}
