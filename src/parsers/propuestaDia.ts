import { parseDate } from "./dateparser";
import { describeRecurrence } from "@/domain/recurrence";
import type { RecurrenceSpec } from "@/domain/types";

/**
 * Lo que el TEXTO de una tarea pide, para compararlo con lo que la tarea
 * HACE.
 *
 * Existe por un motivo concreto: al renombrar «Revisión semanal los
 * domingos» a «Revisión semanal los viernes», el título nuevo dice viernes y
 * el calendario sigue diciendo domingo. Son dos verdades en la misma fila y
 * nada avisa de que se contradigan.
 *
 * No se arregla reescribiendo la recurrencia en cada guardado. Corregir una
 * errata («Revisión seminanal los viernes») movería la fecha de la tarea sin
 * que nadie lo pidiera, y eso es peor que la contradicción. Por eso esto solo
 * *detecta* y la decisión es de quien edita, a un toque y dentro del mismo
 * guardado: si cancela, no ha pasado nada.
 */

export interface PropuestaDia {
  /** Días que nombra el texto, ordenados. */
  weekdays: number[];
  /** La recurrencia completa que se deduciría del texto. */
  spec: RecurrenceSpec;
  /** Cómo se dice en voz alta: «cada viernes». */
  texto: string;
  /** `true` si la tarea no se repetía y el texto propone que sí. */
  esNueva: boolean;
}

/** Días de la semana nombrados por un texto, o `null` si no nombra ninguno. */
export function diasEnTexto(texto: string): number[] | null {
  const spec = parseDate(texto).recurrence;
  if (spec?.kind !== "weekly") return null;
  const dias = [...new Set(spec.weekdays ?? [])].sort((a, b) => a - b);
  return dias.length > 0 ? dias : null;
}

function mismosDias(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/**
 * Si el texto pide un día que no es el que la tarea ya tiene, devuelve la
 * propuesta. Si no hay nada que proponer, `null` — y eso incluye el caso en el
 * que el texto ya no nombra ningún día: quitar las palabras no debe borrar la
 * recurrencia que alguien puso a propósito.
 */
export function propuestaDeDia(texto: string, actual?: RecurrenceSpec): PropuestaDia | null {
  const pedido = diasEnTexto(texto);
  if (pedido === null) return null;

  const actuales = actual?.kind === "weekly" ? [...new Set(actual.weekdays ?? [])].sort((a, b) => a - b) : [];
  if (mismosDias(pedido, actuales)) return null;

  const spec: RecurrenceSpec = { kind: "weekly", every: 1, weekdays: pedido };
  return { weekdays: pedido, spec, texto: describeRecurrence(spec), esNueva: actual === undefined };
}