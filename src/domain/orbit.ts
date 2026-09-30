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
 *  - El «despliegue en el reloj» (pintarReloj): qué tarea se pinta, con
 *    qué raíz/color y si está abierta — las raíces siempre; el desglose
 *    solo cuando su padre está desplegado.
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
/** Grosor de los arcos-hijo (el desglose desplegado en el reloj). */
export const SW_HIJO = 4;
/**
 * Zona de toque (stroke transparente) de un arco raíz. Debe ser MENOR
 * que 2× la separación entre carriles (11 px): con 24 (±12) el puntero
 * caía en el centro del carril vecino y el toque completaba la tarea
 * equivocada en los tramos donde dos carriles se solapan en el reloj.
 */
export const HIT_ARCO = 20;
/** Zona de toque de los arcos-hijo (más finos, misma razón). */
export const HIT_HIJO = 14;
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

/** ¿La tarea puede sentarse en el anillo? (bloque u hora suelta). */
export const tieneHora = (t: Pick<Task, "timeBlock" | "dueTime">): boolean =>
  !!(t.timeBlock || t.dueTime);

/**
 * Ángulos [a, b] (grados) del path del arco para el radio r.
 *
 * El stroke con puntas redondas añade (sw/2)/r radianes por extremo:
 * se resta ese ángulo (más medio pad) por cada lado para que lo visible
 * sea exactamente la duración. Si tras compensar no queda sitio, se
 * pinta un punto centrado de SPAN_MIN grados. `sw` es el grosor del
 * arco que se va a pintar (raíz SW_ARCO, hijo SW_HIJO).
 */
export function arcSpan(r: number, m1: number, m2: number, sw = SW_ARCO): { a: number; b: number } {
  const cap = ((sw / 2 / r) * 180) / Math.PI;
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

/** Nodo del reloj: una tarea ya colocada para pintar. */
export interface NodoReloj {
  task: Task;
  /** Es raíz del reloj: su padre no pinta en el anillo. */
  esRaiz: boolean;
  /** Raíz a la que pertenece (su propio id si lo es). */
  raizId: string;
  /** Índice de color = el de su raíz. */
  colorIdx: number;
  /** Tiene subtareas vivas hoy ⇒ se puede desplegar. */
  conHijos: boolean;
  /** Está desplegado en el reloj. */
  abierto: boolean;
  /** Tramo en minutos si tiene hora; null si solo lleva etiqueta. */
  tramo: [number, number] | null;
  /** Ángulo (grados) donde anclar la etiqueta. */
  ang: number;
  /** 0 para las raíces, +1… para el desglose. */
  nivel: number;
}

/**
 * El «despliegue en el reloj»: qué se pinta y con qué agrupación.
 *
 * `todas` son todas las tareas vivas de hoy (raíces y subtareas, con y
 * sin hora). Las raíces son las tareas CON hora cuyo padre no está en
 * el anillo (ausente, sin hora o de otro día); el desglose de una raíz
 * solo se pinta si su id está en `abiertas` y así sucesivamente, de
 * modo que el pliegue es recursivo y un nieto exige dos niveles abiertos.
 *
 * Hijas sin hora: no pueden sentarse en un carril, pero al desplegarlas
 * se anclan como etiqueta en el ángulo de su madre (tramo: null).
 *
 * Guardas: ninguna cadena de padres en bucle (dato corrupto) puede
 * colgar el pintado — un bucle se trata como raíz y `alcanzadas`
 * impide pintar dos veces. El orden de salida es DFS (raíz, luego su
 * desglose) para que dyParaEtiquetas apile las hijas tras su madre.
 */
export function pintarReloj(todas: Task[], abiertas: ReadonlySet<string>): NodoReloj[] {
  const byId = new Map(todas.map((t) => [t.id, t]));
  const enAnillo = new Set(todas.filter(tieneHora).map((t) => t.id));
  const hijosDe = new Map<string, Task[]>();
  for (const t of todas) {
    if (!t.parentId) continue;
    const lista = hijosDe.get(t.parentId);
    if (lista) lista.push(t);
    else hijosDe.set(t.parentId, [t]);
  }

  // Raíz = sin padre con hora en el anillo. Se mira UN nivel (el padre
  // pintará él solo); solo se recorre la cadena para detectar bucles.
  const esRaiz = (t: Task): boolean => {
    if (!t.parentId || !enAnillo.has(t.parentId)) return true;
    const visto = new Set<string>([t.id]);
    let cur: string | undefined = t.parentId;
    while (cur) {
      if (visto.has(cur)) return true; // bucle ⇒ raíz (nada se pierde)
      if (!enAnillo.has(cur)) return false; // sube hasta una raíz legítima
      visto.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    return false;
  };

  const raices = todas
    .filter((t) => tieneHora(t) && esRaiz(t))
    .sort((a, b) => tramoDe(a)[0] - tramoDe(b)[0]);

  const ordenarHijos = (hijos: Task[]): Task[] =>
    [...hijos].sort((a, b) => {
      const ha = tieneHora(a);
      const hb = tieneHora(b);
      if (ha && hb) return tramoDe(a)[0] - tramoDe(b)[0];
      if (ha !== hb) return ha ? -1 : 1; // con hora primero
      return a.order - b.order; // sin hora: orden de creación
    });

  const pintadas: NodoReloj[] = [];
  const alcanzadas = new Set<string>();

  const emitir = (
    task: Task,
    esRaizNodo: boolean,
    raizId: string,
    colorIdx: number,
    nivel: number,
    angMadre: number,
  ): void => {
    alcanzadas.add(task.id);
    const tramo = tieneHora(task) ? tramoDe(task) : null;
    const ang = tramo ? degOf((tramo[0] + tramo[1]) / 2) : angMadre;
    const hijos = hijosDe.get(task.id);
    const conHijos = !!hijos && hijos.length > 0;
    const abierto = abiertas.has(task.id);
    pintadas.push({ task, esRaiz: esRaizNodo, raizId, colorIdx, conHijos, abierto, tramo, ang, nivel });
    if (abierto && hijos) {
      for (const h of ordenarHijos(hijos)) {
        if (!alcanzadas.has(h.id)) emitir(h, false, raizId, colorIdx, nivel + 1, ang);
      }
    }
  };

  raices.forEach((r, i) => {
    if (alcanzadas.has(r.id)) return; // alcanzada como hija de un bucle
    emitir(r, true, r.id, i, 0, 0);
  });
  return pintadas;
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
