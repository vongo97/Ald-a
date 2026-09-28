/** Momento «¡Día cumplido!»: frases y detección de la transición. */

export const CELEBRATION_PHRASES = [
  "La constancia vence lo que la suerte no logra.",
  "Un día más, una versión mejor de ti.",
  "Pequeños pasos, grandes rachas.",
  "Hecho es mejor que perfecto.",
  "Tu yo de mañana te lo agradece.",
  "Disciplina es elegir lo que quieres más de lo que quieres ahora.",
  "Hoy ganaste. Mañana se encarga.",
  "No cuentes los días, haz que los días cuenten.",
];

/** Frase aleatoria (con RNG inyectable para tests). */
export function celebrationPhrase(rand: () => number = Math.random): string {
  const i = Math.floor(rand() * CELEBRATION_PHRASES.length) % CELEBRATION_PHRASES.length;
  return CELEBRATION_PHRASES[i] ?? CELEBRATION_PHRASES[0];
}

/**
 * ¿El día se acaba de completar? Solo la transición false → true: así el
 * confetti se dispara al marcar la última tarea, nunca al abrir la app con
 * el día ya cumplido.
 */
export function dayJustCompleted(was: boolean, is: boolean): boolean {
  return !was && is;
}
