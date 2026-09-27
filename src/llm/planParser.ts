import type { Task } from "@/domain/types";
import { chat, extractJson, type LlmContext, type LlmResult } from "./client";

/** Una tarea propuesta por el planificador natural. */
export interface PlannedTask {
  title: string;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
  labels: string[];
  /** Breve razonamiento de por qué esta hora. */
  reason?: string;
}

/** Resultado completo del análisis de un día. */
export interface DayPlanResult {
  /** Fecha detectada en el texto (ISO "YYYY-MM-DD"). */
  date: string;
  /** Tareas propuestas en orden. */
  tasks: PlannedTask[];
  /** Advertencia si el día está sobrecargado. */
  warning?: string;
}

const SYSTEM = `Eres un asistente de planificación personal experto. Analizas descripciones de días en lenguaje natural y las conviertes en horarios concretos.

REGLAS:
1. Detecta la fecha: "mañana", "hoy", "el lunes", "domingo", etc. Si no hay fecha, usa la fecha de referencia {today}.
2. Detecta actividades y ordénalas lógicamente.
3. Asigna horas de inicio y fin (formato "HH:mm" 24h) basándote en:
   - Pistas temporales del texto ("primera vez del día" = mañana temprano, "después de X" = posterior a X)
   - Sentido común (pasear perros temprano, trabajo en horario laboral, ejercicio por la mañana o tarde)
   - Duraciones razonables (caminar 30m, leer 30-45m, trabajar bloques de 1-2h, ejercicio 30-60m)
4. NO solapes actividades. Deja huecos mínimos de 10-15 min entre ellas.
5. Si el texto ya tiene horarios específicos ("a las 10"), respétalos.
6. Detecta etiquetas @nombre y asígnalas a la tarea correspondiente.
7. Si todas las actividades no caben en el día, añade un campo "warning" explicándolo.
8. Responde SOLO con JSON válido, sin markdown adicional.

Formato de respuesta:
{
  "date": "YYYY-MM-DD",
  "tasks": [
    {
      "title": "Título corto de la actividad",
      "start": "HH:mm",
      "end": "HH:mm",
      "labels": ["etiqueta"],
      "reason": "Por qué esta hora (máx 8 palabras)"
    }
  ],
  "warning": "Advertencia opcional si el día está lleno"
}`;

export async function parseDayPlan(
  ctx: LlmContext,
  input: string,
  referenceDate: string,
  existingTasks: Pick<Task, "title" | "timeBlock">[] = [],
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

  const res = await chat(ctx, {
    system,
    maxTokens: 1200,
    user: `Fecha de referencia: ${referenceDate} (${now.toLocaleDateString("es-ES", { weekday: "long" })})

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

  // Validar y limpiar cada tarea
  const tasks: PlannedTask[] = parsed.tasks
    .filter((t) => t && typeof t.title === "string" && typeof t.start === "string" && typeof t.end === "string")
    .map((t) => ({
      title: t.title.trim(),
      start: t.start,
      end: t.end,
      labels: Array.isArray(t.labels) ? t.labels.filter((l) => typeof l === "string") : [],
      reason: typeof t.reason === "string" ? t.reason : undefined,
    }));

  if (tasks.length === 0) {
    return { ok: false, error: "El modelo no devolvió tareas válidas", usedLlm: true };
  }

  return {
    ok: true,
    data: {
      date: parsed.date || referenceDate,
      tasks,
      warning: typeof parsed.warning === "string" ? parsed.warning : undefined,
    },
    usedLlm: true,
  };
}
