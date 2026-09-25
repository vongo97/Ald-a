import type { Priority, RecurrenceSpec } from "@/domain/types";
import { parseDate } from "./dateparser";

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

/**
 * Convierte "Terminar informe mañana a las 3pm #trabajo @urgente !1" en una tarea.
 * El título es lo que queda tras retirar los fragmentos reconocidos.
 */
export function parseCapture(input: string, ctx: CaptureContext = {}): ParsedCapture {
  let text = input.trim();
  const matched: string[] = [];

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
  const dp = parseDate(text, ctx.now ?? new Date());
  if (dp.date) {
    // Retirar el texto de fecha consumido (case-insensitive)
    for (const frag of dp.matched) {
      const re = new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      text = text.replace(re, " ");
      matched.push(frag);
    }
  }

  // --- Limpieza -------------------------------------------------------------
  const title = text
    .replace(/\b(?:a las?|el|para|durante)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+|\s+$/g, "");

  return {
    title: title || input.trim(),
    dueDate: dp.date,
    dueTime: dp.time,
    priority,
    importance,
    projectId,
    projectName,
    labels,
    recurrence: dp.recurrence,
    durationMin,
    matched,
  };
}
