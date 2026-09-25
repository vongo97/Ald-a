import type { Task } from "./types";

export interface CapacityReport {
  committedMin: number; // minutos de tareas con duración estimada
  estimatedMin: number; // + estimación heurística de las sin duración
  capacityMin: number;
  overbooked: boolean;
  ratio: number; // comprometido / capacidad
}

const DEFAULT_CAPACITY_MIN = 8 * 60; // 8 h laborables
const UNPLANNED_SHARE = 0.6; // 60% del tiempo laborable es interrupciones/meetings

export function dayCapacity(
  tasks: Task[],
  date: string, // ISO
  capacityMin: number = Math.round(DEFAULT_CAPACITY_MIN * UNPLANNED_SHARE),
): CapacityReport {
  const active = tasks.filter((t) => t.status === "todo" && t.dueDate === date && !t.parentId);
  let committedMin = 0;
  let estimatedMin = 0;
  for (const t of active) {
    if (t.durationMin) committedMin += t.durationMin;
    else estimatedMin += estimateDuration(t);
  }
  const total = committedMin + estimatedMin;
  return {
    committedMin,
    estimatedMin,
    capacityMin,
    overbooked: total > capacityMin,
    ratio: capacityMin > 0 ? total / capacityMin : 0,
  };
}

/** Heurística local de duración cuando la tarea no la declara. */
export function estimateDuration(t: Task): number {
  if (t.durationMin) return t.durationMin;
  const title = t.title.toLowerCase();
  if (/(llamar|llamada|call|revisar correo|email|mensaje)/.test(title)) return 15;
  if (/(comprar|recoger|pagar|enviar)/.test(title)) return 30;
  if (/(informe|report|presentaci|propuesta|dise)/.test(title)) return 90;
  if (/(trámite|tramite|cita|reuni)/.test(title)) return 60;
  return 45;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
