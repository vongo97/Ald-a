import type { Task } from "./types";
import { addDays, parseISODate, toISODate } from "./dateutils";

/**
 * Racha del panel «Hoy».
 *
 * Regla de día cumplido (elegida por el usuario): ≥ 70 % de las tareas de
 * ese día terminadas. En la auditoría posterior el usuario detectó dos
 * bugs de dinámica, ya corregidos:
 *
 *  - **Borrar no cambia el %**: las filas borradas cuentan tal cual estaban
 *    (hechas siguen sumando, pendientes siguen restando). Antes, borrar
 *    pendientes inflaba la barra sin cumplir nada.
 *  - **La fecha efectiva sube por la cadena de padres**: subtareas creadas
 *    sin `dueDate` (alta manual o desglose sin horario) cuentan en el día de
 *    su progenitor; antes, completarlas no movía la barra.
 *
 * Y las reglas de siempre: solo cuentan las tareas HOJA (los contenedores
 * no entran en el %), los días sin tareas no cumplen y hoy en curso nunca
 * rompe la racha (se cuenta desde ayer). Todo se deriva de las tareas:
 * cero migraciones y funciona offline.
 *
 * OJO: la purga de la papelera (30 días) borra filas físicamente y podría
 * alterar el histórico muy antiguo — se asume por ahora; una tabla de
 * resumen diario lo resolverá en la fase de estadísticas.
 */
export const DAY_FULFILL_RATIO = 0.7;

/** Rachas que merecen un aviso especial al alcanzarlas. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 365];

export interface DayStat {
  date: string; // ISO "YYYY-MM-DD"
  total: number; // tareas hoja atribuibles a ese día
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

interface TaskIndex {
  byId: Map<string, Task>;
  /** Tareas que son padre de alguna otra: contenedores, fuera del %. */
  parents: Set<string>;
}

function buildIndex(tasks: Task[]): TaskIndex {
  const byId = new Map<string, Task>();
  const parents = new Set<string>();
  for (const t of tasks) {
    byId.set(t.id, t);
    if (t.parentId) parents.add(t.parentId);
  }
  return { byId, parents };
}

/** Día al que pertenece la tarea: la propia fecha o, si no la tiene, la del padre. */
function effectiveDate(t: Task, byId: Map<string, Task>): string | undefined {
  let cur = t;
  for (let hop = 0; hop < 12 && !cur.dueDate; hop++) {
    if (!cur.parentId) break;
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.dueDate;
}

function statFor(index: TaskIndex, date: string): DayStat {
  let total = 0;
  let done = 0;
  for (const t of index.byId.values()) {
    if (index.parents.has(t.id)) continue;
    if (effectiveDate(t, index.byId) !== date) continue;
    total++;
    if (t.status === "done") done++;
  }
  return { date, total, done, fulfilled: total > 0 && done / total >= DAY_FULFILL_RATIO };
}

/** Estadística de un día concreto. Las borradas cuentan tal cual estaban. */
export function dayStat(tasks: Task[], date: string): DayStat {
  return statFor(buildIndex(tasks), date);
}

export interface Streaks {
  /** Días consecutivos cumplidos que terminan hoy (o ayer si hoy falta). */
  current: number;
  /** Mejor racha de toda la historia. */
  best: number;
  today: DayStat;
}

export function computeStreaks(tasks: Task[], todayISO: string): Streaks {
  const index = buildIndex(tasks);

  // Días con tareas (fecha efectiva) → estadística una sola vez.
  const dates = new Set<string>();
  for (const t of index.byId.values()) {
    const d = effectiveDate(t, index.byId);
    if (d) dates.add(d);
  }
  const stats = new Map<string, DayStat>();
  for (const d of dates) stats.set(d, statFor(index, d));
  const statAt = (iso: string): DayStat => stats.get(iso) ?? statFor(index, iso);

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

/** Puntos de la semana actual (lunes → domingo) — vive en el perfil. */
export function weekDots(tasks: Task[], todayISO: string): WeekDot[] {
  const index = buildIndex(tasks);
  const today = parseISODate(todayISO);
  const monday = addDays(today, -((today.getDay() + 6) % 7));

  const out: WeekDot[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const iso = toISODate(d);
    const st = statFor(index, iso);
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
