import type { Task } from "./types";

/**
 * Lógica del panel de horario de las subtareas (TaskItem).
 *
 * Módulo puro: recoge el borrador de los inputs y decide qué se guarda —
 * la validación y los mensajes van en español y se testean sin React.
 */

/** Convierte "HH:mm" a minutos desde medianoche; `NaN` si no es legible. */
export function timeToMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/** Borrador crudo de los tres inputs del panel (strings vacíos permitidos). */
export interface ScheduleDraft {
  start: string; // "HH:mm" | ""
  end: string; // "HH:mm" | ""
  duration: string; // minutos en texto | ""
}

export type ScheduleResolution =
  | { ok: true; changes: Pick<Partial<Task>, "timeBlock" | "durationMin"> }
  | { ok: false; error: string };

/**
 * Reglas (igual que DayPlanModal: sin las dos horas no hay bloque):
 *
 *  - hora inicial y final → `timeBlock` + `durationMin` derivado de la resta;
 *  - solo una de las dos → error (un bloque a medias no es un horario);
 *  - ninguna hora → se guarda solo `durationMin` (o se limpia todo si está vacío).
 */
export function resolveSchedule(draft: ScheduleDraft): ScheduleResolution {
  const start = draft.start.trim();
  const end = draft.end.trim();
  const hasStart = start.length > 0;
  const hasEnd = end.length > 0;

  if (hasStart !== hasEnd) {
    return { ok: false, error: "Para bloquear el horario pon la hora inicial y la final." };
  }

  if (hasStart && hasEnd) {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (Number.isNaN(s) || Number.isNaN(e)) {
      return { ok: false, error: "Horas no válidas: usa el formato HH:mm." };
    }
    if (e <= s) {
      return { ok: false, error: "La hora final debe ser posterior a la inicial." };
    }
    return { ok: true, changes: { timeBlock: { start, end }, durationMin: e - s } };
  }

  // Sin horas: solo duración (o limpieza si no queda nada).
  const raw = draft.duration.trim();
  if (!raw) return { ok: true, changes: { timeBlock: undefined, durationMin: undefined } };

  const dur = Number(raw);
  if (!Number.isFinite(dur) || dur < 0) {
    return { ok: false, error: "Duración no válida: escribe minutos (ej: 30)." };
  }
  return { ok: true, changes: { timeBlock: undefined, durationMin: Math.round(dur) } };
}
