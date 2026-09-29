import { parseISODate } from "./dateutils";
import { mulberry32, setTracking, withAlpha } from "./paint";

/**
 * «Sello del día» — arte procedural único por día.
 *
 * La semilla es (fecha + racha): cada día queda un sello distinto y siempre
 * el mismo, así la celebración y la tarjeta de compartir muestran la MISMA
 * pieza. Varía el número de rayos, las puntas de la estrella, los remaches,
 * el anillo (liso o discontinuo) y la inclinación — como un sello estampado
 * a mano.
 */
export interface SealSpec {
  seed: number;
  /** Rayos interiores (12–24). */
  rays: number;
  /** Puntas de la estrella tras el número (5–12). */
  starPoints: number;
  /** Inclinación del conjunto (rad, ±0.25): el golpe de mano. */
  rotation: number;
  /** Anillo exterior discontinuo (fracciones de R) o null si es liso. */
  dash: number[] | null;
  /** Remaches entre anillos (3–12). */
  dots: number;
  /** Longitud relativa de cada rayo (0.6–1). */
  rayLength: number[];
}

export interface SealPalette {
  fg: string;
  accent: string;
  accent2: string;
  muted: string;
  fontBody: string;
  fontDisplay: string;
}

export interface SealDrawOpts {
  /** Número que va en el centro. */
  streak: number;
  /** «MAR 29 SEPT» — ver `sealDateLabel`. */
  dateShort: string;
}

/** Semilla FNV-1a de (fecha, racha). */
export function sealSeed(dateISO: string, streak: number): number {
  const s = `${dateISO}#${streak}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sealSpec(dateISO: string, streak: number): SealSpec {
  const seed = sealSeed(dateISO, streak);
  const rnd = mulberry32(seed);
  const rays = 12 + Math.floor(rnd() * 13); // 12–24
  const starPoints = 5 + Math.floor(rnd() * 8); // 5–12
  const rotation = (rnd() - 0.5) * 0.5; // ±0.25 rad
  const dash = rnd() < 0.5 ? null : [0.05 + rnd() * 0.03, 0.028 + rnd() * 0.02];
  const dots = 3 + Math.floor(rnd() * 10); // 3–12
  const rayLength = Array.from({ length: rays }, () => 0.6 + rnd() * 0.4);
  return { seed, rays, starPoints, rotation, dash, dots, rayLength };
}

/** «mar, 29 sept» → «MAR 29 SEPT» (sin puntos ni comas, para el anillo). */
export function sealDateLabel(dateISO: string): string {
  return parseISODate(dateISO)
    .toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })
    .replace(/[.,]/g, "")
    .toUpperCase();
}

/**
 * Texto sobre un arco. `baseAngle` −π/2 = arriba, π/2 = abajo; en el arco
 * inferior los caracteres van de izquierda a derecha con las puntas hacia
 * dentro, como en los sellos de verdad.
 */
function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  r: number,
  baseAngle: number,
  size: number,
  font: string,
  color: string,
  mode: "top" | "bottom",
): void {
  const chars = [...text];
  const step = (size * 0.78) / r;
  const span = step * (chars.length - 1);
  ctx.save();
  ctx.font = `700 ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const off = -span / 2 + i * step; // izquierda → derecha
    const a = mode === "top" ? baseAngle + off : baseAngle - off;
    const rot = mode === "top" ? a + Math.PI / 2 : a - Math.PI / 2;
    ctx.save();
    ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
    ctx.rotate(rot);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

/** Dibuja el sello centrado en (cx, cy) con radio R. */
export function drawSeal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  spec: SealSpec,
  palette: SealPalette,
  opts: SealDrawOpts,
): void {
  const { fg, accent, accent2, muted, fontBody, fontDisplay } = palette;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spec.rotation);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Resplandor del tema
  const halo = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.5);
  halo.addColorStop(0, withAlpha(accent, 0.14));
  halo.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Anillo exterior — liso o estampado en segmentos
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, R * 0.045);
  if (spec.dash) ctx.setLineDash(spec.dash.map((f) => f * R));
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.97, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Anillo interior fino
  ctx.strokeStyle = withAlpha(muted, 0.7);
  ctx.lineWidth = Math.max(1, R * 0.016);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  ctx.stroke();

  // Remaches entre anillos
  ctx.fillStyle = accent2;
  const rivet = Math.max(2, R * 0.019);
  for (let i = 0; i < spec.dots; i++) {
    const a = (i / spec.dots) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.915, Math.sin(a) * R * 0.915, rivet, 0, Math.PI * 2);
    ctx.fill();
  }

  // Texto curvo
  arcText(ctx, "DÍA CUMPLIDO", R * 0.775, -Math.PI / 2, R * 0.1, fontBody, fg, "top");
  arcText(ctx, opts.dateShort, R * 0.775, Math.PI / 2, R * 0.09, fontBody, muted, "bottom");

  // Rayos interiores
  ctx.strokeStyle = withAlpha(accent2, 0.6);
  ctx.lineWidth = Math.max(1, R * 0.013);
  for (let i = 0; i < spec.rays; i++) {
    const a = (i / spec.rays) * Math.PI * 2;
    const len = spec.rayLength[i] ?? 0.8;
    const r1 = R * 0.55;
    const r2 = r1 + R * 0.16 * len;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.stroke();
  }

  // Estrella tras el número
  const pts = spec.starPoints * 2;
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? R * 0.56 : R * 0.34;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = withAlpha(accent, 0.1);
  ctx.fill();
  ctx.strokeStyle = withAlpha(accent2, 0.55);
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.stroke();

  // El número, el corazón del sello (se encoge si no cabe)
  let size = R * 0.58;
  ctx.font = `700 ${size}px ${fontDisplay}`;
  const num = String(opts.streak);
  const maxW = R * 1.05;
  const measured = ctx.measureText(num).width;
  if (measured > maxW) {
    size *= maxW / measured;
    ctx.font = `700 ${size}px ${fontDisplay}`;
  }
  ctx.fillStyle = fg;
  ctx.fillText(num, 0, -R * 0.05);

  // Etiqueta bajo el número
  setTracking(ctx, R * 0.035);
  ctx.font = `700 ${R * 0.1}px ${fontBody}`;
  ctx.fillStyle = muted;
  ctx.fillText(opts.streak === 1 ? "DÍA SEGUIDO" : "DÍAS SEGUIDOS", 0, R * 0.3);
  setTracking(ctx, 0);

  ctx.restore();
}
