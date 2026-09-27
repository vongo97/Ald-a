import type { Task } from "@/domain/types";
import type { UserProfile } from "@/domain/profile";
import { profileToPrompt } from "@/domain/profile";
import { chat, extractJson, llmStatus, type LlmContext, type LlmResult } from "./client";

export interface SubtaskSuggestion {
  title: string;
  notes?: string;
  durationMin?: number;
  /** "HH:mm" — solo si el perfil permite proponer horarios. */
  start?: string;
  end?: string;
}

const SYSTEM_JSON = `Eres un asistente de productividad. Respondes SOLO con JSON válido, sin explicaciones ni markdown adicional.
IMPORTANTE: respondes SIEMPRE en español. Todos los textos, títulos, nombres y descripciones que devuelves van en español, aunque el texto del usuario esté en otro idioma.
Fecha de referencia: {today}.`;

function withToday(system: string, now: Date): string {
  return system.replace("{today}", now.toISOString().slice(0, 10));
}

/**
 * Contexto de rutina para los prompts.
 *
 * Con perfil, la IA propone horarios siguiendo la rutina del usuario (se
 * levanta a las X → la primera actividad es a las X). Sin perfil se mantiene
 * la regla conservadora: horas solo si el texto las trae.
 */
function routineContext(profile: UserProfile | null | undefined): { timeRule: string; routine: string } {
  if (!profile) {
    return {
      timeRule: "solo si el texto las indica (si no las indica, déjalas fuera)",
      routine: "",
    };
  }
  return {
    timeRule:
      'tomando las del texto si las indica; si una actividad no tiene hora, propón "start"/"end" siguiendo la rutina del usuario (más abajo)',
    routine: `
CONTEXTO DEL USUARIO:
${profileToPrompt(profile)}
Propón horarios así: la primera actividad del día empieza a su hora de despertar; lo laboral va dentro de su horario de trabajo; encadena las actividades con ${profile.breakMin} min de descanso entre ellas; nada entre su hora de dormir y su despertar. Duración por actividad: la del texto; si no aparece, 45 min (o la que deduzcas). Devuelve SIEMPRE "start" y "end" juntos ("HH:mm").`,
  };
}

/** Desglosa una tarea vaga en pasos accionables. */
export async function breakdownTask(
  ctx: LlmContext,
  task: Pick<Task, "title" | "notes" | "durationMin">,
  profile?: UserProfile | null,
): Promise<LlmResult<SubtaskSuggestion[]>> {
  const { routine } = routineContext(profile);
  const now = new Date();
  const res = await chat(ctx, {
    system: withToday(SYSTEM_JSON, now),
    maxTokens: profile ? 1000 : 800,
    user: `Desglosa esta tarea en entre 3 y 6 subtareas concretas y accionables.
Tarea: "${task.title}"
${task.notes ? `Notas: ${task.notes}` : ""}
Devuelve: {"subtasks":[{"title":"...","durationMin":30${profile ? ',"start":"HH:mm","end":"HH:mm"' : ""}]}
"duracionMin" en minutos (opcional). Los "title" van SIEMPRE en español. Si no es posible desglosarla, devuelve una lista vacía.${routine}`,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error, usedLlm: res.usedLlm };
  // Respuesta sin JSON (o sin ninguna lista) → error VISIBLE, no una lista
  // vacía silenciosa que acaba en «sin sugerencias» sin motivo.
  const parsed = extractJson<unknown>(res.data);
  if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
    return { ok: false, error: "Respuesta del modelo no interpretable", usedLlm: true };
  }
  const raw = (Array.isArray(parsed) ? {} : parsed) as Record<string, unknown>;
  const list: unknown = Array.isArray(parsed)
    ? parsed
    : [raw.subtasks, raw.pasos, raw.actividades, raw.steps].find((c) => Array.isArray(c));
  if (!Array.isArray(list)) {
    return { ok: false, error: "Respuesta del modelo no interpretable", usedLlm: true };
  }
  const subtasks: SubtaskSuggestion[] = [];
  for (const s of list) {
    const title = pickSubtaskTitle(s);
    if (!title) continue;
    const o = (s ?? {}) as Record<string, unknown>;
    const dur =
      typeof o.durationMin === "number"
        ? o.durationMin
        : typeof o.durationMin === "string" && /^\d+$/.test(o.durationMin)
          ? Number(o.durationMin)
          : undefined;
    subtasks.push({
      title,
      ...(dur && dur > 0 ? { durationMin: dur } : {}),
      start: hhmm(o.start),
      end: hhmm(o.end),
    });
  }
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

/** Título de una subtarea: tolera "title"/"título"/"titulo" o un string suelto. */
function pickSubtaskTitle(s: unknown): string {
  if (typeof s === "string") return s.trim();
  const o = (s ?? {}) as Record<string, unknown>;
  const v = [o.title, o["título"], o.titulo].find((x) => typeof x === "string" && x.trim());
  return typeof v === "string" ? v.trim() : "";
}

/** Segunda opinión del LLM para una captura ambigua.
 *
 * Si la captura es un párrafo (p. ej. un día descrito completo), devuelve
 * además `subtasks` con cada actividad y sus horas: la captura se crea entonces
 * como tarea padre con título corto + subtareas, de una sola vez.
 *
 * Con `profile` (rutina del usuario), las horas que no estén en el texto se
 * PROponen a partir de su rutina en vez de dejarse fuera. */
export async function improveCapture(
  ctx: LlmContext,
  input: string,
  profile?: UserProfile | null,
): Promise<LlmResult<CaptureImprovement>> {
  const { timeRule, routine } = routineContext(profile);
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
Si describe VARIAS actividades o un día completo, pon en "title" un resumen corto (máx. 10 palabras) de todo el día, y devuelve cada actividad en "subtasks" con sus horas "start"/"end" ${timeRule}. Los títulos van SIEMPRE en español.${routine}`,
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
  // Subtareas: títulos no vacíos (claves "title"/"título"/"titulo" o string
  // suelto); horas validadas a HH:mm.
  const rawSubs = Array.isArray(raw.subtasks) ? (raw.subtasks as unknown[]) : [];
  const subtasks: CaptureSubtask[] = [];
  for (const s of rawSubs) {
    const title = pickSubtaskTitle(s);
    if (!title) continue;
    const o = (s ?? {}) as Record<string, unknown>;
    subtasks.push({ title, start: hhmm(o.start), end: hhmm(o.end) });
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
