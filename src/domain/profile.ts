/**
 * Perfil de usuario — lo que la app "sabe" de ti.
 *
 * Se construye con un cuestionario obligatorio de 6 preguntas al primer
 * uso (o desde Ajustes). La IA lo lee como contexto en cada planificación
 * para dar recomendaciones personalizadas.
 *
 * Privacidad: el perfil se sincroniza en TEXTO PLANO a Supabase, protegido
 * por RLS (cada fila solo la ve su dueño). NO se cifra a propósito: el
 * AES-GCM anterior derivaba la clave de un dato público y no protegía nada
 * (ver src/store/profile.ts).
 */

export type Chronotype = "matutino" | "nocturno" | "flexible";

export interface UserProfile {
  /** ID único del perfil. */
  id: string;
  /** Hora de despertar "HH:mm". */
  wakeTime: string;
  /** Hora de dormir "HH:mm". */
  sleepTime: string;
  /** Cronotipo. */
  chronotype: Chronotype;
  /** Hora inicio laboral "HH:mm". */
  workStart: string;
  /** Hora fin laboral "HH:mm". */
  workEnd: string;
  /** Actividades recurrentes que el usuario hace. */
  activities: string[];
  /** Descanso entre actividades (minutos). */
  breakMin: number;
  /** Notas libres del usuario (opcional). */
  notes?: string;
  /** Última modificación ISO. */
  updatedAt: string;
}

/** Preguntas del cuestionario (6, obligatorio). */
export const PROFILE_QUESTIONS = [
  {
    key: "wakeTime" as const,
    emoji: "☀️",
    question: "¿A qué hora te despiertas normalmente?",
    type: "time" as const,
    default: "07:00",
  },
  {
    key: "sleepTime" as const,
    emoji: "🌙",
    question: "¿A qué hora te acostumbres a dormir?",
    type: "time" as const,
    default: "22:30",
  },
  {
    key: "chronotype" as const,
    emoji: "🧠",
    question: "¿Eres persona matutina o nocturna?",
    type: "choice" as const,
    options: [
      { value: "matutino", label: "🌅 Matutino — rindo mejor por la mañana" },
      { value: "nocturno", label: "🦉 Nocturno — rindo mejor por la noche" },
      { value: "flexible", label: "🌊 Flexible — me adapto a cualquier horario" },
    ],
  },
  {
    key: "workHours" as const,
    emoji: "💼",
    question: "¿Cuándo es tu horario de trabajo?",
    type: "range" as const,
    defaultStart: "09:00",
    defaultEnd: "18:00",
  },
  {
    key: "activities" as const,
    emoji: "🏃",
    question: "¿Qué actividades recurrentes haces?",
    type: "multi" as const,
    options: [
      "Ejercicio",
      "Leer",
      "Meditar",
      "Cocinar",
      "Caminar",
      "Estudiar",
      "Trabajar",
      "Descansar",
    ],
  },
  {
    key: "breakMin" as const,
    emoji: "☕",
    question: "¿Cuánto descansas entre actividades?",
    type: "number" as const,
    default: 10,
    suffix: "min",
  },
] as const;

/** Respuestas del cuestionario (before converting to UserProfile). */
export interface ProfileAnswers {
  wakeTime: string;
  sleepTime: string;
  chronotype: Chronotype;
  workStart: string;
  workEnd: string;
  activities: string[];
  breakMin: number;
}

/** Convierte respuestas en un UserProfile completo. */
export function answersToProfile(answers: ProfileAnswers): UserProfile {
  return {
    id: crypto.randomUUID?.() ?? `profile-${Date.now()}`,
    wakeTime: answers.wakeTime,
    sleepTime: answers.sleepTime,
    chronotype: answers.chronotype,
    workStart: answers.workStart,
    workEnd: answers.workEnd,
    activities: answers.activities,
    breakMin: answers.breakMin,
    updatedAt: new Date().toISOString(),
  };
}

/** Serializa el perfil como contexto para la IA. */
export function profileToPrompt(profile: UserProfile): string {
  return `CONTEXTO DEL USUARIO (úsalo para personalizar recomendaciones):
- Se despierta a las ${profile.wakeTime}
- Se duerme a las ${profile.sleepTime}
- Cronotipo: ${profile.chronotype}
- Trabaja de ${profile.workStart} a ${profile.workEnd}
- Actividades recurrentes: ${profile.activities.join(", ") || "ninguna especificada"}
- Descanso preferido entre actividades: ${profile.breakMin} minutos${profile.notes ? `\n- Notas: ${profile.notes}` : ""}`;
}
