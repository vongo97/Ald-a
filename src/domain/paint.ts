/** Utilidades de pintura compartidas por el sello, la tarjeta y la celebración. */

/**
 * Hex → rgba con alfa. Si el color no es hex (var rara, nombrado), se
 * devuelve tal cual para no romper el dibujo.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 3 && h.length !== 6) return hex;
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** RNG determinista (mulberry32): la misma semilla, el mismo dibujo. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SpacedCtx = CanvasRenderingContext2D & { letterSpacing: string };

/** Tracking del lienzo (sin soporte es una propiedad inofensiva). */
export function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  (ctx as SpacedCtx).letterSpacing = `${px}px`;
}
