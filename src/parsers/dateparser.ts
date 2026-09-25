import { addDays, addMonths, parseISODate, toISODate } from "@/domain/dateutils";
import type { RecurrenceSpec } from "@/domain/types";

export const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

export const MONTHS: Record<string, number> = {
  enero: 0, ene: 0,
  febrero: 1, feb: 1,
  marzo: 2, mar: 2,
  abril: 3, abr: 3,
  mayo: 4,
  junio: 5, jun: 5,
  julio: 6, jul: 6,
  agosto: 7, ago: 7,
  septiembre: 8, setiembre: 8, sep: 8, set: 8,
  octubre: 9, oct: 9,
  noviembre: 10, nov: 10,
  diciembre: 11, dic: 11,
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, catorce: 14, quince: 15,
  veinte: 20, treinta: 30,
};

function wordToNumber(w: string): number | undefined {
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return NUMBER_WORDS[w];
}

export interface DateParse {
  date?: string; // ISO
  time?: string; // "HH:mm"
  recurrence?: RecurrenceSpec;
  matched: string[]; // fragmentos consumidos
}

/**
 * Extrae fecha, hora y recurrencia de una frase en español.
 * `today` permite tests deterministas (por defecto: ahora).
 */
export function parseDate(input: string, today: Date = new Date()): DateParse {
  const text = input.toLowerCase();
  const matched: string[] = [];
  let date: Date | undefined;
  let time: string | undefined;
  let recurrence: RecurrenceSpec | undefined;

  const consume = (m: RegExpMatchArray | RegExpExecArray | null) => {
    if (m) matched.push(m[0]);
    return m;
  };

  // ---- Recurrencia -------------------------------------------------------
  let m = text.match(/\bcada (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(d[ií]as?|semanas?|mes(?:es)?|a(?:ñ|n)os?)\b/);
  if (m) {
    const n = Math.max(1, wordToNumber(m[1]) ?? 1);
    const unit = m[2].startsWith("sem") ? "weekly" : m[2].startsWith("mes") ? "monthly" : m[2].startsWith("d") ? "daily" : "yearly";
    recurrence = { kind: unit, every: n } as RecurrenceSpec;
    consume(m);
  } else if ((m = text.match(/\bcada semana\b/))) {
    recurrence = { kind: "weekly", every: 1 };
    consume(m);
  } else if ((m = text.match(/\bcada mes\b/))) {
    recurrence = { kind: "monthly", every: 1 };
    consume(m);
  } else if ((m = text.match(/\bdiario\b|\bdiariamente\b|\btodos los d[ií]as\b/))) {
    recurrence = { kind: "daily", every: 1 };
    consume(m);
  } else if ((m = text.match(/\bsemanal(?:mente)?\b|\btodas las semanas\b/))) {
    recurrence = { kind: "weekly", every: 1 };
    consume(m);
  } else if ((m = text.match(/\bmensual(?:mente)?\b|\btodos los meses\b/))) {
    recurrence = { kind: "monthly", every: 1 };
    consume(m);
  }

  // "cada lunes", "todos los lunes" → semanal con día fijo
  m = text.match(/\b(?:cada|todos los|todas las)\s+(domingos?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?)/);
  if (m) {
    recurrence = { kind: "weekly", every: 1, weekdays: [WEEKDAYS[normalizeWeekday(m[1])]] };
    consume(m);
    date = nextWeekday(today, WEEKDAYS[normalizeWeekday(m[1])]);
  }

  // "el primer lunes del mes", "el último viernes del mes" — va ANTES que los
  // relativos porque "el primer lunes" también contiene un día de semana suelto
  m = text.match(/\b(?:el\s+)?(primer|primera|segundo|tercer|tercera|cuarto|cuarta|[uú]ltimo|[uú]ltima)\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)(?:\s+del?\s+mes)?\b/);
  if (m) {
    const nth = m[1].startsWith("primer") ? 1 : m[1].startsWith("segundo") ? 2 : m[1].startsWith("tercer") || m[1].startsWith("tercera") ? 3 : m[1].startsWith("cuarto") || m[1].startsWith("cuarta") ? 4 : -1;
    const wd = WEEKDAYS[normalizeWeekday(m[2])];
    date = nthWeekdayOfMonthDate(today.getFullYear(), today.getMonth(), nth, wd);
    if (toISODate(date) <= toISODate(today)) {
      const nxt = addMonths(today, 1);
      date = nthWeekdayOfMonthDate(nxt.getFullYear(), nxt.getMonth(), nth, wd);
    }
    if (recurrence === undefined) recurrence = { kind: "monthly", every: 1, nthWeekday: { nth, weekday: wd } };
    consume(m);
  }

  // ---- Fechas relativas --------------------------------------------------
  if (!date) {
    if ((m = text.match(/\bpasado ma(?:ñ|n)ana\b/))) {
      date = addDays(today, 2);
      consume(m);
    } else if ((m = text.match(/\bma(?:ñ|n)ana\b/))) {
      date = addDays(today, 1);
      consume(m);
    } else if ((m = text.match(/\bhoy\b/))) {
      date = today;
      consume(m);
    } else if ((m = text.match(/\ben (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte)\s*(d[ií]as?|semanas?|mes(?:es)?)\b/))) {
      const n = wordToNumber(m[1]) ?? 1;
      const unit = m[2];
      date = unit.startsWith("sem") ? addDays(today, n * 7) : unit.startsWith("mes") ? addMonths(today, n) : addDays(today, n);
      consume(m);
    } else if ((m = text.match(/\beste fin de semana\b/))) {
      date = nextWeekday(today, 6); // sábado
      consume(m);
    } else if ((m = text.match(/\bpr(?:ó|o)ximos d[ií]as\b/))) {
      date = addDays(today, 3);
      consume(m);
    } else if ((m = text.match(/\bel pr(?:ó|o)ximo\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/))) {
      date = nextWeekday(today, WEEKDAYS[normalizeWeekday(m[1])]);
      if (date.getTime() <= today.getTime()) date = addDays(date, 7);
      consume(m);
    } else if ((m = text.match(/\b(el\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b(?!\s+y\b)/))) {
      date = nextWeekday(today, WEEKDAYS[normalizeWeekday(m[2])]);
      if (date.getTime() <= today.getTime()) date = addDays(date, 7);
      consume(m);
    }
  }

  // ---- Fechas absolutas --------------------------------------------------
  if (!date) {
    // "el 5 de marzo", "5 de marzo de 2027"
    m = text.match(/\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|jun|jul|ago|sep|set|oct|nov|dic)(?:\s+de\s+(\d{4}))?\b/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = MONTHS[m[2]];
      const year = m[3] ? parseInt(m[3], 10) : inferYear(today, month, day);
      date = new Date(year, month, day, 12);
      consume(m);
    }
  }
  if (!date) {
    // "el 5/3", "5/3/2027" (día/mes, formato hispano)
    m = text.match(/\b(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      let year = m[3] ? parseInt(m[3], 10) : inferYear(today, month, day);
      if (year < 100) year += 2000;
      if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
        date = new Date(year, month, day, 12);
        consume(m);
      }
    }
  }

  // ---- Hora --------------------------------------------------------------
  // "15:30", "a las 9:45pm", "a las 10", "3pm", "9 de la noche", "mediodía", "medianoche"
  m = text.match(/\b(?:a las?|@)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min <= 59) {
      time = `${String(pmAdjust(h, m[3])).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      consume(m);
    }
  }
  if (!time) {
    // Requiere prefijo ("a las 10") o sufijo ("10pm", "9 de la noche") — nunca un número suelto
    m =
      text.match(/\b(?:a las?\s+|@)(\d{1,2})\s*(am|pm|h|de la tarde|de la noche|de la ma(?:ñ|n)ana)?\b/) ??
      text.match(/\b(\d{1,2})\s*(am|pm|de la tarde|de la noche)\b/);
    if (m) {
      const h = parseInt(m[1], 10);
      if (h >= 0 && h <= 23) {
        time = `${String(pmAdjust(h, m[2])).padStart(2, "0")}:00`;
        consume(m);
      }
    }
  }
  if (!time && (m = text.match(/\bmediod[ií]a\b/))) {
    time = "12:00";
    consume(m);
  } else if (!time && (m = text.match(/\bmedianoche\b/))) {
    time = "00:00";
    consume(m);
  } else if (!time && (m = text.match(/\b(\d{1,2})\s*de la (tarde|noche|ma(?:ñ|n)ana)\b/))) {
    let h = parseInt(m[1], 10);
    if (m[2] !== "mañana" && m[2] !== "manana" && h < 12) h += 12;
    time = `${String(h).padStart(2, "0")}:00`;
    consume(m);
  }

  return {
    date: date ? toISODate(date) : undefined,
    time,
    recurrence,
    matched,
  };
}

function pmAdjust(h: number, suffix?: string): number {
  const s = suffix ?? "";
  if (s === "pm" || s.includes("tarde") || s.includes("noche")) return h < 12 ? h + 12 : h;
  if (s === "am" || s.includes("mañana") || s.includes("manana")) return h === 12 ? 0 : h;
  return h;
}

function normalizeWeekday(w: string): string {
  const t = w.toLowerCase().replace("miércoles", "miercoles").replace("sábado", "sabado");
  if (t === "domingos") return "domingo";
  if (t === "sabados") return "sabado";
  return t;
}

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  const delta = (weekday - d.getDay() + 7) % 7;
  return addDays(d, delta === 0 ? 7 : delta);
}

function nthWeekdayOfMonthDate(year: number, month: number, nth: number, weekday: number): Date {
  if (nth > 0) {
    const first = new Date(year, month, 1, 12);
    const offset = (weekday - first.getDay() + 7) % 7;
    return addDays(first, offset + (nth - 1) * 7);
  }
  const last = new Date(year, month + 1, 0, 12);
  const offset = (last.getDay() - weekday + 7) % 7;
  return addDays(last, -offset + (nth + 1) * 7);
}

function inferYear(today: Date, month: number, day: number): number {
  const thisYear = new Date(today.getFullYear(), month, day, 12);
  return thisYear.getTime() >= parseISODate(toISODate(today)).getTime() - 86400_000
    ? today.getFullYear()
    : today.getFullYear() + 1;
}
