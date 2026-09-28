import type { Task } from "./types";
import { addDays, parseISODate, toISODate } from "./dateutils";

/**
 * Racha del panel «Hoy».
 *
 * Regla de día cumplido (elegida por el usuario): ≥ 70 % de las tareas de ese
 * día terminadas. Detalles importantes:
 *  - Cuentan solo las tareas HOJA: los contenedores (padres de subtareas) no
 *    entran en el %, así marcar las 5 subtareas de un plan no lo arrastraba
 *    un padre sin marcar.
 *  - Los días sin tareas NO cumplen (rompen la racha).
 *  - Hoy todavía en curso nunca rompe la racha: si aún no llega al 70 %, se
 *    empieza a contar desde ayer.
 *  - Todo se deriva de las tareas existentes: cero migraciones, funciona
 *    offline y comparte datos con la futura tarjeta de compartir.
 */
export const DAY_FULFILL_RATIO = 0.7;

/** Rachas que merecen un aviso especial al alcanzarlas. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 365];

export interface DayStat {
  date: string; // ISO "YYYY-MM-DD"
  total: number; // tareas hoja con fecha ese día (no borradas)
  done: number;
  fulfilled: boolean;
}

export type DotState = "done" | "today" | "missed" | "empty" | "future";

export interface WeekDot {
  date: string;
  /** l m x j v s d (x = miércoles) */
  label: string;
  state: DotState;
}

/** Tareas que son padre de alguna otra viva: los contenedores no cuentan. */
function parentIds(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) if (t.parentId && !t.deletedAt) ids.add(t.parentId);
  return ids;
}

function statFor(active: Task[], parents: Set<string>, date: string): DayStat {
  let total = 0;
  let done = 0;
  for (const t of active) {
    if (t.dueDate !== date || parents.has(t.id)) continue;
    total++;
    if (t.status === "done") done++;
  }
  return { date, total, done, fulfilled: total > 0 && done / total >= DAY_FULFILL_RATIO };
}

/** Estadística de un día concreto (las borradas quedan fuera). */
export function dayStat(tasks: Task[], date: string): DayStat {
  const active = tasks.filter((t) => !t.deletedAt);
  return statFor(active, parentIds(active), date);
}

export interface Streaks {
  /** Días consecutivos cumplidos que terminan hoy (o ayer si hoy falta). */
  current: number;
  /** Mejor racha de toda la historia. */
  best: number;
  today: DayStat;
}

export function computeStreaks(tasks: Task[], todayISO: string): Streaks {
  const active = tasks.filter((t) => !t.deletedAt);
  const parents = parentIds(active);

  // Días con tareas → estadística una sola vez (la historia es acotada).
  const dates = new Set<string>();
  for (const t of active) if (t.dueDate) dates.add(t.dueDate);
  const stats = new Map<string, DayStat>();
  for (const d of dates) stats.set(d, statFor(active, parents, d));
  const statAt = (iso: string): DayStat => stats.get(iso) ?? statFor(active, parents, iso);

  const today = statAt(todayISO);

  // Racha actual: si hoy ya está cumplido cuenta desde hoy; si no, desde
  // ayer (hoy sigue en curso y todavía no puede romper nada).
  let current = 0;
  let cursor = today.fulfilled ? parseISODate(todayISO) : addDays(parseISODate(todayISO), -1);
  for (;;) {
    const st = statAt(toISODate(cursor));
    if (!st.fulfilled) break;
    current++;
    cursor = addDays(cursor, -1);
  }

  // Mejor racha histórica: fechas con tareas ordenadas; cualquier hueco
  // (día sin tareas) o día incumplido corta la racha.
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...dates].sort()) {
    const consecutive = prev !== null && toISODate(addDays(parseISODate(prev), 1)) === d;
    run = stats.get(d)!.fulfilled ? (consecutive ? run + 1 : 1) : 0;
    if (run > best) best = run;
    prev = d;
  }

  return { current, best: Math.max(best, current), today };
}

const DOT_LABELS = ["d", "l", "m", "x", "j", "v", "s"]; // x = miércoles

/** Puntos de la semana actual (lunes → domingo) para la tarjeta. */
export function weekDots(tasks: Task[], todayISO: string): WeekDot[] {
  const active = tasks.filter((t) => !t.deletedAt);
  const parents = parentIds(active);
  const today = parseISODate(todayISO);
  const monday = addDays(today, -((today.getDay() + 6) % 7));

  const out: WeekDot[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const iso = toISODate(d);
    const st = statFor(active, parents, iso);
    const state: DotState =
      iso > todayISO
        ? "future"
        : st.fulfilled
          ? "done"
          : iso === todayISO
            ? "today"
            : st.total > 0
              ? "missed"
              : "empty";
    out.push({ date: iso, label: DOT_LABELS[d.getDay()], state });
  }
  return out;
}
