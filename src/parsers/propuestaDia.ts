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

/**
 * Dos recurrencias dicen lo mismo si coinciden en lo que las distingue.
 *
 * Solo semanal. Un `dayOfMonth` no se compara aquí a propósito: un día del mes y
 * un día de la semana no son la misma regla, y proponer el cambio cuando el
 * título nombra el día equivocado es justo lo que este módulo existe para hacer.
 * Pero una tarea con `dayOfMonth` cuyo título dice «los viernes» tampoco puede
 * compararse por weekdays, así que si no es semanal por los dos lados, no hay
 * nada que decir: el título manda y ya lo dice.
 */
function mismoSpec(a: RecurrenceSpec | undefined, b: RecurrenceSpec): boolean {
  if (!a || a.kind !== b.kind || a.every !== b.every) return false;
  // El día del mes es parte de la regla: misma clase y mismo `every` no
  // bastan, porque "cada mes el día 15" y "cada mes el día 20" son recurrencias
  // distintas y proponer el cambio es justo lo que este módulo hace.
  if (a.kind === "monthly" && b.kind === "monthly") {
    return (a.dayOfMonth ?? null) === (b.dayOfMonth ?? null);
  }
  if (a.kind === "weekly" && b.kind === "weekly") {
    const da = [...new Set(a.weekdays ?? [])].sort((x, y) => x - y);
    const db = [...new Set(b.weekdays ?? [])].sort((x, y) => x - y);
    return da.length === db.length && da.every((d, i) => d === db[i]);
  }
  return false;
}

/**
 * Si el texto pide una recurrencia que no es la que la tarea ya tiene, devuelve
 * la propuesta. Si no hay nada que proponer, `null` — y eso incluye el caso en
 * el que el texto ya no nombra ningún día: quitar las palabras no debe borrar la
 * recurrencia que alguien puso a propósito.
 */
export function propuestaDeDia(texto: string, actual?: RecurrenceSpec): PropuestaDia | null {
  const pedido = parseDate(texto).recurrence;
  if (!pedido) return null;
  // «cada semana» sin decir qué día no propone nada, aunque la tarea sí tenga
  // un día: el texto no está diciendo cuál, así que no se puede acusar al
  // calendario de desobedecer. Solo hay algo que proponer si el texto nombra un
  // día concreto —de la semana o del mes—.
  const nombraDia =
    (pedido.kind === "weekly" && (pedido.weekdays?.length ?? 0) > 0) ||
    (pedido.kind === "monthly" && pedido.dayOfMonth !== null && pedido.dayOfMonth !== undefined);
  if (!nombraDia) return null;
  if (mismoSpec(actual, pedido)) return null;

  const weekdays = pedido.kind === "weekly" ? [...new Set(pedido.weekdays ?? [])].sort((a, b) => a - b) : [];
  return {
    weekdays,
    spec: pedido,
    texto: describeRecurrence(pedido),
    esNueva: actual === undefined,
  };
}