import type { RecurrenceSpec } from "./types";
import { addDays, addMonths, addYears, daysInMonth, toISODate } from "./dateutils";

/**
 * Calcula la siguiente aparición de una recurrencia, estrictamente posterior a `from`.
 * `from` puede llevar hora; el resultado siempre cae a las 12:00 local.
 */
export function nextOccurrence(spec: RecurrenceSpec, from: Date): Date {
  switch (spec.kind) {
    case "daily": {
      return addDays(from, spec.every);
    }
    case "weekly": {
      if (spec.weekdays && spec.weekdays.length > 0) {
        // Próximo día cuyo weekday esté en la lista (ciclos >1 semana: por índice de semana)
        let d = nextDay(from);
        for (let i = 0; i < 400; i++) {
          if (spec.weekdays.includes(d.getDay()) && matchesWeekCycle(spec, from, d)) return d;
          d = nextDay(d);
        }
        return d;
      }
      return addDays(from, 7 * spec.every);
    }
    case "monthly": {
      if (spec.nthWeekday) {
        return nextNthWeekday(from, spec.nthWeekday.nth, spec.nthWeekday.weekday, spec.every);
      }
      if (spec.dayOfMonth && spec.dayOfMonth >= 1) {
        // ¿Este mes aún toca ese día? (comparación por día calendario)
        const day = Math.min(spec.dayOfMonth, daysInMonth(from.getFullYear(), from.getMonth()));
        const thisMonth = new Date(from.getFullYear(), from.getMonth(), day, 12, 0, 0, 0);
        if (toISODate(thisMonth) > toISODate(from)) return thisMonth;
        return nextNthDayOfMonth(from, spec.dayOfMonth, spec.every);
      }
      return addMonths(nextDay(from), spec.every);
    }
    case "yearly": {
      return addYears(nextDay(from), spec.every);
    }
  }
}

function nextDay(d: Date): Date {
  return addDays(d, 1);
}

const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const ORDINAL_MES: Record<number, string> = {
  1: "primer", 2: "segundo", 3: "tercer", 4: "cuarto",
  [-1]: "último", [-2]: "penúltimo",
};

/**
 * Cómo se dice una recurrencia en español, para enseñarla.
 *
 * Existe porque un `🔁` a secas es un dato que no se puede respetar: si no
 * sabes que la tarea se repite los domingos, no hay forma de que se te ocurra
 * cambiarlo. Y si dos pantallas lo cuentan de dos maneras, un día una mente.
 */
export function describeRecurrence(spec: RecurrenceSpec): string {
  const n = spec.every;
  switch (spec.kind) {
    case "daily":
      return n === 1 ? "cada día" : `cada ${n} días`;
    case "weekly": {
      // Sin `uniq`: un `weekdays` con 1,1 se lee «cada lunes, lunes». El
      // parser ya deduplica, pero esto muestra lo que hay en la base, y ahí
      // un import puede haber dejado cualquier cosa.
      const dias = [...new Set(spec.weekdays ?? [])]
        .sort((a, b) => a - b)
        .map((d) => DIA_LARGO[d] ?? "?");
      if (dias.length === 0) return n === 1 ? "cada semana" : `cada ${n} semanas`;
      if (n === 1) return `cada ${dias.join(", ")}`;
      return `cada ${n} semanas, los ${dias.join(", ")}`;
    }
    case "monthly": {
      if (spec.nthWeekday) {
        const ord = ORDINAL_MES[spec.nthWeekday.nth] ?? `día ${spec.nthWeekday.nth}`;
        const dia = DIA_LARGO[spec.nthWeekday.weekday] ?? "?";
        return n === 1 ? `el ${ord} ${dia} de cada mes` : `el ${ord} ${dia}, cada ${n} meses`;
      }
      if (spec.dayOfMonth) {
        if (n === 1) return `el día ${spec.dayOfMonth} de cada mes`;
        return `el día ${spec.dayOfMonth}, cada ${n} meses`;
      }
      return n === 1 ? "cada mes" : `cada ${n} meses`;
    }
    case "yearly":
      return n === 1 ? "cada año" : `cada ${n} años`;
  }
}

/** ¿El candidato cae en el mismo ciclo semanal que `from`, respetando every? */
function matchesWeekCycle(spec: Extract<RecurrenceSpec, { kind: "weekly" }>, from: Date, candidate: Date): boolean {
  if (spec.every === 1) return true;
  const weekOf = (d: Date) => Math.floor(startOfDayLocal(d).getTime() / (7 * 86400_000));
  const diff = weekOf(candidate) - weekOf(startOfDayLocal(from));
  return diff % spec.every === 0;
}

function startOfDayLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextNthWeekday(from: Date, nth: number, weekday: number, every: number): Date {
  let month = from.getMonth();
  let year = from.getFullYear();
  for (let guard = 0; guard < 48; guard++) {
    const d = nthWeekdayOfMonth(year, month, nth, weekday);
    if (d && toISODate(d) > toISODate(from)) return d;
    month += every;
    while (month > 11) {
      month -= 12;
      year += 1;
    }
  }
  return addMonths(from, every);
}

function nextNthDayOfMonth(from: Date, dayOfMonth: number, every: number): Date {
  let month = from.getMonth() + every;
  let year = from.getFullYear();
  while (month > 11) {
    month -= 12;
    year += 1;
  }
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return new Date(year, month, day, 12, 0, 0, 0);
}

/** Devuelve el n-ésimo día de semana (nth: 1..5, negativo = desde el final) de un mes, o null si no existe. */
export function nthWeekdayOfMonth(year: number, monthIndex: number, nth: number, weekday: number): Date | null {
  const days = daysInMonth(year, monthIndex);
  if (nth > 0) {
    let count = 0;
    for (let day = 1; day <= days; day++) {
      const d = new Date(year, monthIndex, day, 12);
      if (d.getDay() === weekday) {
        count++;
        if (count === nth) return d;
      }
    }
    return null;
  }
  let count = 0;
  for (let day = days; day >= 1; day--) {
    const d = new Date(year, monthIndex, day, 12);
    if (d.getDay() === weekday) {
      count++;
      if (count === -nth) return d;
    }
  }
  return null;
}
