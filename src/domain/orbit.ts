/**
 * Geometría del reloj de 24 h de Cronodisco (DayOrbit).
 *
 * Toda la lógica pura vive aquí para poder testearla sin DOM:
 *  - Tramo de minutos que ocupa una tarea (bloque u hora suelta).
 *  - Ángulo del arco compensando el stroke-linecap:round (que sobresale
 *    strokeWidth/2 por extremo) + un padAngle: lo pintado representa la
 *    duración real; los tramos minúsculos salen como punto de 0,6°.
 *  - Reparto en carriles para horarios solapados (siempre índices
 *    válidos, aunque se pise el máximo: regresión de 6 tareas seguidas).
 *  - Antetítulo «MARTES · 29 SEP» de las cabeceras temáticas.
 *
 * Convenciones: 0° = mediodía arriba, giro horario; centro 115,115
 * (coincide con los transform-origin del CSS cd-ticks / cd-needle).
 */

import type { Task } from "@/domain/types";

/** Centro del viewBox del reloj (ojo: el CSS usa 115px 115px). */
export const CX = 115;
export const CY = 115;
/** Radio del anillo sobre el que se pintan los arcos. */
export const R_ARCO = 72;
/** Carriles disponibles para tareas solapadas (del anillo hacia dentro). */
export const CARRILES = [72, 61, 50, 39];
/** Grosor de los arcos: de él sale la compensación de puntas redondas. */
export const SW_ARCO = 10;
/** Separación entre arcos contiguos, en grados (el «padAngle»). */
export const PAD_GRADOS = 2.5;
/** Span mínimo (grados) que se pinta: por debajo se reduce a punto. */
const SPAN_MIN = 0.6;

export const toMin = (hhmm: string): number =>
  parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);

export const degOf = (m: number): number => (m / 1440) * 360;

export const polar = (r: number, deg: number): { x: number; y: number } => ({
  x: CX + r * Math.cos(((deg - 90) * Math.PI) / 180),
  y: CY + r * Math.sin(((deg - 90) * Math.PI) / 180),
});

/** Tramo [inicio, fin] en minutos que ocupa la tarea en el reloj. */
export function tramoDe(t: Pick<Task, "timeBlock" | "dueTime">): [number, number] {
  if (t.timeBlock) {
    const a = toMin(t.timeBlock.start);
    let b = toMin(t.timeBlock.end);
    if (b <= a) b = Math.min(a + 30, 1439); // bloque invertido o cruzando medianoche
    return [a, b];
  }
  // Sin bloque: un tramo cortito centrado en su hora.
  const c = t.dueTime ? toMin(t.dueTime) : 12 * 60;
  return [Math.max(0, c - 15), Math.min(1439, c + 15)];
}

/**
 * Ángulos [a, b] (grados) del path del arco para el radio r.
 *
 * El stroke con puntas redondas añade (SW_ARCO/2)/r radianes por
 * extremo: se resta ese ángulo (más medio pad) por cada lado para que
 * lo visible sea exactamente la duración. Si tras compensar no queda
 * sitio, se pinta un punto centrado de SPAN_MIN grados.
 */
export function arcSpan(r: number, m1: number, m2: number): { a: number; b: number } {
  const cap = ((SW_ARCO / 2 / r) * 180) / Math.PI;
  const margen = cap + PAD_GRADOS / 2;
  const d1 = degOf(m1);
  const d2 = degOf(m2);
  let a = d1 + margen;
  let b = d2 - margen;
  if (b - a < SPAN_MIN) {
    const mid = (d1 + d2) / 2;
    a = mid - SPAN_MIN / 2;
    b = mid + SPAN_MIN / 2;
  }
  return { a, b };
}

/**
 * Reparto de tramos en carriles (greedy: siempre el de menor índice
 * libre). Devuelve el carril de cada tramo; NUNCA un índice fuera de
 * CARRILES (aunque los tramos se pisen, se apilan en el último).
 */
export function packLanes(tramos: Array<[number, number]>, max = CARRILES.length): number[] {
  const finCarril: number[] = [];
  return tramos.map(([m1, m2]) => {
    let lane = finCarril.findIndex((fin) => fin <= m1);
    if (lane === -1) {
      if (finCarril.length < max) {
        lane = finCarril.length;
        finCarril.push(m2);
      } else {
        lane = max - 1;
        finCarril[lane] = Math.max(finCarril[lane], m2);
      }
    } else {
      finCarril[lane] = m2;
    }
    return lane;
  });
}

const fmtWeekday = new Intl.DateTimeFormat("es-ES", { weekday: "long" });
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** «MARTES · 29 SEP» — antetítulo de las cabeceras temáticas de Hoy. */
export function eyebrowDe(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${fmtWeekday.format(new Date(y, m - 1, d)).toUpperCase()} · ${d} ${MESES[m - 1]}`;
}

/**
 * Desplazamiento vertical de cada etiqueta para que ninguna se pise.
 *
 * El empujón va SIEMPRE «hacia fuera» (del centro hacia la zona
 * libre de la tarjeta): si la etiqueta está bajo el centro, hacia
 * abajo; si está sobre él, hacia arriba. Así ningún movimiento mete
 * el texto dentro del anillo, donde cruzaría los arcos pintados
 * (regresión verificada midiendo intersecciones etiqueta↔arco).
 *
 * Dos del MISMO lado (izq/der) se solapan si comparten banda
 * vertical (|Δy| < alto, con alto=13 > altura real de la línea) y
 * sus anclajes están a menos de un ancho de distancia. Se prueba en
 * greedy, en orden de pintado, las tertulias hacia fuera [0,14,28,
 * 42,56] y luego hacia dentro [−14,−28,−42,−56], descartando las que
 * se salgan de la tarjeta o bajarían el ancla por debajo del anillo
 * (radio 78: ahí el texto cruzaría los arcos). Si todo choca se
 * deja la última válida (mejor esfuerzo: tareas idénticas, >6).
 */
export function dyParaEtiquetas(
  pts: Array<{ x: number; y: number; lado: "I" | "D"; ancho: number }>,
  alto = 13,
  cy = CY,
  ymin = -14,
  ymax = 254,
  radioMin = 78,
): number[] {
  const colocadas: Array<{ x: number; y: number; lado: "I" | "D"; ancho: number }> = [];
  return pts.map((p) => {
    const signo = p.y >= cy ? 1 : -1;
    const TIERS = [0, 14, 28, 42, 56, -14, -28, -42, -56].map((v) => (v * signo) || 0);
    let dy = 0;
    let ultimoValido = 0;
    let elegido = false;
    for (const t of TIERS) {
      const y = p.y + t;
      if (y < ymin || y > ymax) continue;
      if (Math.hypot(p.x - CX, y - cy) < radioMin) continue; // ¡dentro del anillo!
      ultimoValido = t;
      const choca = colocadas.some(
        (q) =>
          q.lado === p.lado &&
          Math.abs(q.y - y) < alto &&
          Math.abs(q.x - p.x) < Math.max(q.ancho, p.ancho),
      );
      if (!choca) {
        dy = t;
        elegido = true;
        break;
      }
    }
    if (!elegido) dy = ultimoValido;
    colocadas.push({ x: p.x, y: p.y + dy, lado: p.lado, ancho: p.ancho });
    return dy;
  });
}
