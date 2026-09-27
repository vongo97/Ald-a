import type { Priority, RecurrenceSpec } from "@/domain/types";
import { addDays, toISODate } from "@/domain/dateutils";
import { parseDate, WEEKDAYS, normalizeWeekday } from "./dateparser";

export interface ParsedCapture {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  importance?: Priority;
  projectId?: string;
  projectName?: string;
  labels: string[];
  recurrence?: RecurrenceSpec;
  durationMin?: number;
  matched: string[];
}

export interface CaptureContext {
  /** Proyectos existentes, para resolver "#nombre" (case-insensitive). */
  projects?: { id: string; name: string }[];
  /** Fecha base para interpretar fechas relativas (útil en tests). */
  now?: Date;
}

/** "@lunes", "@miércoles"… — también plurales ("@sábados"). */
const DAY_TOKEN_RE = /(?:^|\s)@(domingos?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?)/gi;
/** "@hoy" y "@mañana" como fecha. */
const DATE_TOKEN_RE = /(?:^|\s)@(hoy|ma(?:ñ|n)ana)\b/gi;

/**
 * Quita los comandos "@día" del texto (para pasárselo a la IA ya limpio:
 * el parser local es quien manda en recurrencia y fecha).
 */
export function stripDayCommands(input: string): string {
  return input.replace(DAY_TOKEN_RE, " ").replace(DATE_TOKEN_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * ¿Es esta palabra un comando de día disfrazado de etiqueta? (La IA no debería
 * devolver "@lunes" como etiqueta; si lo hace, se descarta en la mezcla.)
 */
export function isDayCommandWord(word: string): boolean {
  const w = word.trim().toLowerCase();
  if (w === "hoy" || /^ma(?:ñ|n)ana$/.test(w)) return true;
  return normalizeWeekday(w) in WEEKDAYS;
}

/**
 * Convierte "Terminar informe mañana a las 3pm #trabajo @urgente !1" en una tarea.
 * El título es lo que queda tras retirar los fragmentos reconocidos.
 */
export function parseCapture(input: string, ctx: CaptureContext = {}): ParsedCapture {
  let text = input.trim();
  const matched: string[] = [];
  const now = ctx.now ?? new Date();

  // --- Comandos @día (ANTES que las etiquetas: no son etiquetas) ----------
  // "@lunes" = rutina de todos los lunes (recurrencia semanal), no una
  // etiqueta ni un proyecto. "@hoy" / "@mañana" = fecha.
  const weekdays: number[] = [];
  text = text.replace(DAY_TOKEN_RE, (_all, word: string) => {
    const wd = WEEKDAYS[normalizeWeekday(word.toLowerCase())];
    if (wd !== undefined && !weekdays.includes(wd)) weekdays.push(wd);
    matched.push(`@${word}`);
    return " ";
  });
  let cmdDate: string | undefined;
  text = text.replace(DATE_TOKEN_RE, (_all, word: string) => {
    cmdDate = toISODate(word.toLowerCase().startsWith("m") ? addDays(now, 1) : now);
    matched.push(`@${word}`);
    return " ";
  });

  // --- Etiquetas @ --------------------------------------------------------
  const labels: string[] = [];
  text = text.replace(/(?:^|\s)@([\wáéíóúñü-]+)/gi, (_all, label: string) => {
    labels.push(label.toLowerCase());
    return " ";
  });

  // --- Proyecto # ---------------------------------------------------------
  let projectId: string | undefined;
  let projectName: string | undefined;
  text = text.replace(/(?:^|\s)#([\wáéíóúñü-]+)/gi, (_all, name: string) => {
    projectName = name;
    const found = ctx.projects?.find((p) => p.name.toLowerCase() === name.toLowerCase());
    projectId = found?.id;
    return " ";
  });

  // --- Prioridad/importancia !1..!4 (también !i2 / !p3) ---------------------
  let priority: Priority | undefined;
  let importance: Priority | undefined;
  const setQualifier = (qualifier: string | undefined, value: Priority) => {
    if (qualifier?.toLowerCase() === "i") importance = value;
    else priority = value;
  };
  text = text.replace(/(?:^|\s)!([1-4])([pi]?)\b/gi, (_all, digit: string, qualifier: string) => {
    setQualifier(qualifier, Number(digit) as Priority);
    return " ";
  });
  text = text.replace(/(?:^|\s)!([pi])([1-4])\b/gi, (_all, qualifier: string, digit: string) => {
    setQualifier(qualifier, Number(digit) as Priority);
    return " ";
  });
  // Palabras de urgencia: @urgente ya cubre etiqueta; "!!!", "importante", "urgente"
  if (priority === undefined && /(?:^|\s)(urgente|¡¡¡|!!!)/i.test(text)) {
    priority = 1;
  }
  if (importance === undefined && /(?:^|\s)(importante)\b/i.test(text)) {
    importance = 2;
    text = text.replace(/(?:^|\s)importante\b/i, " ");
  }

  // --- Duración "~2h", "~30min", "dura 90 minutos" --------------------------
  let durationMin: number | undefined;
  text = text.replace(/~\s*(\d{1,3})\s*(h|hora|horas|min|m)\b/i, (_all, n: string, unit: string) => {
    durationMin = parseInt(n, 10) * (unit.toLowerCase().startsWith("h") ? 60 : 1);
    return " ";
  });
  if (durationMin === undefined) {
    text = text.replace(/(?:^|\s)(?:dura|duración|duracion)\s+(\d{1,3})\s*(h|hora|horas|min|minutos|mins|m)\b/i, (_all, n: string, unit: string) => {
      durationMin = parseInt(n, 10) * (unit.toLowerCase().startsWith("h") ? 60 : 1);
      return " ";
    });
  }

  // --- Fecha / hora / recurrencia ------------------------------------------
  const dp = parseDate(text, now);
  if (dp.date) {
    // Retirar el texto de fecha consumido (case-insensitive)
    for (const frag of dp.matched) {
      const re = new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      text = text.replace(re, " ");
      matched.push(frag);
    }
  }

  // --- Recurrencia y fecha desde los comandos @día -------------------------
  let recurrence = dp.recurrence;
  if (weekdays.length > 0) {
    const days = [...weekdays].sort((a, b) => a - b);
    if (!recurrence) {
      recurrence = { kind: "weekly", every: 1, weekdays: days };
    } else if (recurrence.kind === "weekly") {
      // "todos los lunes @miércoles" → semanal con los dos días.
      recurrence = {
        ...recurrence,
        weekdays: [...new Set([...(recurrence.weekdays ?? []), ...days])].sort((a, b) => a - b),
      };
    }
    // (diaria/mensual: lo que ponga el texto manda; los @días solo fechan)
  }
  // Próxima aparición de los días marcados — misma regla que "cada lunes"
  // del dateparser: si toca hoy, se apunta al próximo (nunca a hoy).
  let weekdayDate: string | undefined;
  if (!dp.date && weekdays.length > 0) {
    const today = now.getDay();
    const delta = Math.min(...weekdays.map((w) => ((w - today + 7) % 7) || 7));
    weekdayDate = toISODate(addDays(now, delta));
  }
  const dueDate = dp.date ?? cmdDate ?? weekdayDate;

  // --- Limpieza -------------------------------------------------------------
  const title = text
    .replace(/\b(?:a las?|el|para|durante)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+|\s+$/g, "");

  return {
    // Si se consumió todo, el título es lo que quede… sin los comandos @día
    // (por si la captura es solo "@lunes").
    title: title || stripDayCommands(input).trim() || input.trim(),
    dueDate,
    dueTime: dp.time,
    priority,
    importance,
    projectId,
    projectName,
    labels,
    recurrence,
    durationMin,
    matched,
  };
}
