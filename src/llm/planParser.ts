import type { Task } from "@/domain/types";
import { chat, extractJson, type LlmContext, type LlmResult } from "./client";

/** Una tarea propuesta por el planificador natural. */
export interface PlannedTask {
  title: string;
  start?: string; // "HH:mm" — opcional en subtareas
  end?: string; // "HH:mm"
  labels: string[];
  /** Breve razonamiento de por qué esta hora. */
  reason?: string;
  /** Subtareas anidadas (ej: "Trabajar" → subtareas internas). */
  children?: PlannedTask[];
}

/** Resultado completo del análisis de un día. */
export interface DayPlanResult {
  /** Fecha detectada en el texto (ISO "YYYY-MM-DD"). */
  date: string;
  /** Título corto propuesto por la IA para la tarea padre del plan. */
  planTitle?: string;
  /** Tareas propuestas en orden. */
  tasks: PlannedTask[];
  /** Advertencia si el día está sobrecargado. */
  warning?: string;
}

const SYSTEM = `Eres un asistente de planificación personal experto. Analizas descripciones de días en lenguaje natural y las conviertes en horarios concretos.

IMPORTANTE: Responde SIEMPRE en español. Todos los títulos, razones y advertencias deben estar en español.

REGLAS:
1. Detecta la fecha: "mañana", "hoy", "el lunes", "domingo", etc. Si no hay fecha, usa la fecha de referencia {today}.
2. Detecta actividades y ordénalas lógicamente. Los títulos van SIEMPRE en español (aunque el texto del usuario esté en otro idioma).
3. Asigna horas de inicio y fin (formato "HH:mm" 24h) basándote en:
   - Pistas temporales del texto ("primera vez del día" = mañana temprano, "después de X" = posterior a X)
   - Sentido común (pasear perros temprano, trabajo en horario laboral, ejercicio por la mañana o tarde)
   - Duraciones razonables (caminar 30m, leer 30-45m, trabajar bloques de 1-2h, ejercicio 30-60m)
4. NO solapes actividades. Deja huecos mínimos de 10-15 min entre ellas.
5. Si el texto ya tiene horarios específicos ("a las 10"), respétalos.
6. Detecta etiquetas @nombre y asígnalas a la tarea correspondiente.
7. Si una actividad es compleja y tiene sub-actividades naturales, usa "children" para anidarlas (ej: "Trabajar" → ["Revisar emails", "Escribir informe"]). OBLIGATORIO: cada child DEBE tener start y end propios (reparte el bloque horario del padre entre sus children, sin solapes).
8. Si todas las actividades no caben en el día, añade un campo "warning" explicándolo en español.
9. El campo "reason" (razón) SIEMPRE en español, máximo 8 palabras.
10. Añade "planTitle": un título corto y descriptivo del día completo (máx. 10 palabras, en español) que servirá de tarea padre. Ej: "Día cargado: gimnasio, teletrabajo, reunión e inglés".
11. Responde SOLO con JSON válido, sin markdown adicional.

Formato de respuesta:
{
  "date": "YYYY-MM-DD",
  "planTitle": "Título del día completo (máx. 10 palabras)",
  "tasks": [
    {
      "title": "Título corto de la actividad",
      "start": "HH:mm",
      "end": "HH:mm",
      "labels": ["etiqueta"],
      "reason": "Por qué esta hora (máx 8 palabras)",
      "children": [
        {
          "title": "Sub-actividad",
          "start": "HH:mm",
          "end": "HH:mm",
          "labels": [],
          "reason": "opcional"
        }
      ]
    }
  ],
  "warning": "Advertencia opcional si el día está lleno"
}`;

function cleanTask(raw: unknown): PlannedTask | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.title !== "string") return null;

  const children = Array.isArray(t.children)
    ? t.children.map(cleanTask).filter((c): c is PlannedTask => c !== null)
    : undefined;

  return {
    title: (t.title as string).trim(),
    start: typeof t.start === "string" ? t.start : undefined,
    end: typeof t.end === "string" ? t.end : undefined,
    labels: Array.isArray(t.labels) ? (t.labels as unknown[]).filter((l): l is string => typeof l === "string") : [],
    reason: typeof t.reason === "string" ? t.reason : undefined,
    ...(children && children.length > 0 ? { children } : {}),
  };
}

export async function parseDayPlan(
  ctx: LlmContext,
  input: string,
  referenceDate: string,
  existingTasks: Pick<Task, "title" | "timeBlock">[] = [],
  profileContext?: string,
): Promise<LlmResult<DayPlanResult>> {
  const now = new Date();
  const system = SYSTEM.replace("{today}", referenceDate);

  const existingContext =
    existingTasks.length > 0
      ? `\n\nTareas existentes YA programadas para este día (evita solaparte con ellas):\n${existingTasks
          .filter((t) => t.timeBlock)
          .map((t) => `- "${t.title}" de ${t.timeBlock!.start} a ${t.timeBlock!.end}`)
          .join("\n")}`
      : "";

  const profileSection = profileContext ? `\n\n${profileContext}` : "";

  const res = await chat(ctx, {
    system,
    maxTokens: 1500,
    user: `Fecha de referencia: ${referenceDate} (${now.toLocaleDateString("es-ES", { weekday: "long" })})${profileSection}

Describe el día que quiero planificar:
"""
${input}
"""${existingContext}`,
  });

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error, usedLlm: res.usedLlm };
  }

  const parsed = extractJson<DayPlanResult>(res.data);
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    return { ok: false, error: "No se pudieron extraer actividades del texto", usedLlm: true };
  }

  const tasks = parsed.tasks.map(cleanTask).filter((t): t is PlannedTask => t !== null);

  if (tasks.length === 0) {
    return { ok: false, error: "El modelo no devolvió tareas válidas", usedLlm: true };
  }

  const planTitle =
    typeof parsed.planTitle === "string" && parsed.planTitle.trim() ? parsed.planTitle.trim() : undefined;

  return {
    ok: true,
    data: {
      date: parsed.date || referenceDate,
      planTitle,
      tasks,
      warning: typeof parsed.warning === "string" ? parsed.warning : undefined,
    },
    usedLlm: true,
  };
}
