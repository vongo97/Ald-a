import type { Task } from "@/domain/types";
import { chat, extractJson, llmStatus, type LlmContext, type LlmResult } from "./client";

export interface SubtaskSuggestion {
  title: string;
  notes?: string;
  durationMin?: number;
}

const SYSTEM_JSON = `Eres un asistente de productividad. Respondes SOLO con JSON válido, sin explicaciones ni markdown adicional.
IMPORTANTE: respondes SIEMPRE en español. Todos los textos, títulos, nombres y descripciones que devuelves van en español, aunque el texto del usuario esté en otro idioma.
Fecha de referencia: {today}.`;

function withToday(system: string, now: Date): string {
  return system.replace("{today}", now.toISOString().slice(0, 10));
}

/** Desglosa una tarea vaga en pasos accionables. */
export async function breakdownTask(
  ctx: LlmContext,
  task: Pick<Task, "title" | "notes" | "durationMin">,
): Promise<LlmResult<SubtaskSuggestion[]>> {
  const now = new Date();
  const res = await chat(ctx, {
    system: withToday(SYSTEM_JSON, now),
    maxTokens: 800,
    user: `Desglosa esta tarea en entre 3 y 6 subtareas concretas y accionables.
Tarea: "${task.title}"
${task.notes ? `Notas: ${task.notes}` : ""}
Devuelve: {"subtasks":[{"title":"...","durationMin":30}]}
"duracionMin" en minutos (opcional). Los "title" van SIEMPRE en español. Si no es posible desglosarla, devuelve una lista vacía.`,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error, usedLlm: res.usedLlm };
  const parsed = extractJson<{ subtasks?: SubtaskSuggestion[] }>(res.data);
  const subtasks = Array.isArray(parsed?.subtasks) ? parsed!.subtasks!.filter((s) => s && typeof s.title === "string") : [];
  return { ok: true, data: subtasks, usedLlm: true };
}

export interface DayPlanItem {
  taskId?: string;
  title: string;
  start: string; // "HH:mm"
  end: string;
  reason?: string;
}

/** Borrador del plan del día (time-blocking) a partir de las tareas de hoy. */
export async function draftDayPlan(
  ctx: LlmContext,
  tasks: Pick<Task, "id" | "title" | "durationMin" | "priority" | "dueTime" | "labels">[],
  dayStart = "08:00",
  dayEnd = "18:00",
): Promise<LlmResult<DayPlanItem[]>> {
  const now = new Date();
  const res = await chat(ctx, {
    system: withToday(SYSTEM_JSON, now),
    maxTokens: 900,
    user: `Construye un borrador de plan del día (time-blocking) para estas tareas, ordenadas por prioridad declarada:
${tasks.map((t) => `- id=${t.id} :: ${t.title}${t.dueTime ? ` (hora límite ${t.dueTime})` : ""}${t.durationMin ? ` (${t.durationMin} min)` : ""}`).join("\n") || "(sin tareas)"}
Jornada: ${dayStart} a ${dayEnd}. Respeta duraciones estimadas (45 min si no aparece). Deja huecos de descanso de 10 min entre bloques.
Devuelve: {"items":[{"taskId":"...","title":"...","start":"HH:mm","end":"HH:mm"}]}`,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error, usedLlm: res.usedLlm };
  const parsed = extractJson<{ items?: DayPlanItem[] }>(res.data);
  const items = Array.isArray(parsed?.items) ? parsed!.items!.filter((i) => i && typeof i.title === "string") : [];
  return { ok: true, data: items, usedLlm: true };
}

export interface CaptureSubtask {
  title: string;
  /** "HH:mm" solo si el texto del usuario lo indica. */
  start?: string;
  end?: string;
}

export interface CaptureImprovement {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: number;
  labels?: string[];
  notes?: string;
  /** Varias actividades en el texto (día descrito): se crean como subtareas. */
  subtasks?: CaptureSubtask[];
}

/** "HH:mm" válido o undefined (lo demás se descarta). */
function hhmm(v: unknown): string | undefined {
  return typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : undefined;
}

/** Segunda opinión del LLM para una captura ambigua.
 *
 * Si la captura es un párrafo (p. ej. un día descrito completo), devuelve
 * además `subtasks` con cada actividad y sus horas: la captura se crea entonces
 * como tarea padre con título corto + subtareas, de una sola vez. */
export async function improveCapture(ctx: LlmContext, input: string): Promise<LlmResult<CaptureImprovement>> {
  const now = new Date();
  const res = await chat(ctx, {
    system: withToday(
      `${SYSTEM_JSON}\nDevuelve SOLO el objeto JSON crudo, sin explicaciones, sin markdown, sin código.`,
      now,
    ),
    // Holgura para que el JSON (título + subtareas con horario) no se corte
    // con textos de muchos actividades.
    maxTokens: 1400,
    user: `Interpreta esta captura de tarea escrita en español y normalízala.
Captura: "${input}"
Responde exactamente con este objeto JSON (y ningún otro texto):
{"title":"título limpio","dueDate":"YYYY-MM-DD" o "" para hoy/mañana si se infiere, "dueTime":"HH:mm" o "", "priority":1,"labels":[""],"notes":"","subtasks":[{"title":"actividad","start":"HH:mm","end":"HH:mm"}]}
Usa "" para lo que no se pueda inferir. priority 1=urgente e importante, 4=trivial.
Si el texto describe UNA sola tarea, "subtasks" debe ser [].
Si describe VARIAS actividades o un día completo, pon en "title" un resumen corto (máx. 10 palabras) de todo el día, y devuelve cada actividad en "subtasks" con sus horas "start"/"end" solo si el texto las indica (si no las indica, déjalas fuera). Los títulos van SIEMPRE en español.`,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error, usedLlm: res.usedLlm };
  const parsed = extractJson<CaptureImprovement>(res.data);
  // Tolerancia a claves alternativas ("título"/"titulo")
  const raw = (parsed ?? {}) as unknown as Record<string, unknown>;
  const title =
    (typeof raw.title === "string" && raw.title) ||
    (typeof raw["título"] === "string" && raw["título"]) ||
    (typeof raw.titulo === "string" && raw.titulo) ||
    null;
  if (!title) {
    return { ok: false, error: "Respuesta del modelo no interpretable", usedLlm: true };
  }
  // Subtareas: solo títulos no vacíos; horas validadas a HH:mm.
  const rawSubs = Array.isArray(raw.subtasks) ? (raw.subtasks as unknown[]) : [];
  const subtasks: CaptureSubtask[] = [];
  for (const s of rawSubs) {
    const o = (s ?? {}) as Record<string, unknown>;
    if (typeof o.title !== "string" || !o.title.trim()) continue;
    subtasks.push({ title: o.title.trim(), start: hhmm(o.start), end: hhmm(o.end) });
  }
  return { ok: true, data: { ...parsed, title, subtasks: subtasks.length ? subtasks : undefined }, usedLlm: true };
}

/** Estado rápido para la UI. */
export function aiEnabled(ctx: LlmContext): boolean {
  return llmStatus(ctx.settings) === "active";
}

/** 
 * Dada una etiqueta nueva, pide al LLM que encuentre qué tareas existentes 
 * (que aún no la tienen) deberían llevarla basándose en semántica.
 */
export async function autoAssignLabel(
  ctx: LlmContext,
  label: string,
  tasks: Pick<Task, "id" | "title" | "notes">[],
): Promise<LlmResult<string[]>> {
  const now = new Date();
  const res = await chat(ctx, {
    system: withToday(SYSTEM_JSON, now),
    maxTokens: 500,
    user: `He creado una nueva etiqueta o categoría: "@${label}".
Analiza esta lista de tareas y devuelve los IDs de las que encajan claramente en esta categoría por su semántica.
Tareas:
${tasks.map((t) => `- id="${t.id}" :: ${t.title}`).join("\n") || "(sin tareas)"}

Devuelve SOLO un array JSON de strings con los IDs que encajan, sin nada más.
Ejemplo de salida: ["id-1", "id-4"]
Si ninguna encaja, devuelve: []`,
  });

  if (!res.ok || !res.data) return { ok: false, error: res.error, usedLlm: res.usedLlm };
  
  const parsed = extractJson<string[]>(res.data);
  return { ok: true, data: Array.isArray(parsed) ? parsed : [], usedLlm: true };
}
