import type { Task } from "./types";
import { DAY_FULFILL_RATIO, computeStreaks, leafTasksOfDay } from "./streak";
import { formatLocalDate, parseISODate } from "./dateutils";

/**
 * Tarjeta «Compartir mi día» (fase visual).
 *
 * Genera un PNG 1080×1920 (formato stories/estado) en canvas puro, con los
 * colores y tipografías del tema activo, y lo pasa al compartir nativo del
 * sistema (Web Share API con archivos). Si el dispositivo no lo soporta, se
 * descarga. Todo es local: la imagen no sale del dispositivo hasta que el
 * usuario la comparte.
 */

/** Títulos que entran en la tarjeta; el resto se resume con «+N más». */
export const SHARE_TOP_LIMIT = 5;

export interface DaySharePayload {
  /** Días consecutivos cumplidos que terminan hoy. */
  streak: number;
  best: number;
  /** 0–100, redondeado (la regla de cumplimiento vive en el dominio). */
  pct: number;
  done: number;
  total: number;
  /** «martes, 29 de septiembre». */
  dateLabel: string;
  /** Primeras tareas completadas (hojas, no borradas), por prioridad. */
  topTitles: string[];
  /** Completadas que no caben y se resumen con «+N más». */
  extraTitles: number;
}

export function buildSharePayload(tasks: Task[], todayISO: string): DaySharePayload {
  const { current, best, today } = computeStreaks(tasks, todayISO);
  const pct = today.total > 0 ? Math.round((today.done / today.total) * 100) : 0;

  const completed = leafTasksOfDay(tasks, todayISO)
    .filter((t) => t.status === "done" && !t.deletedAt && t.title.trim().length > 0)
    .sort((a, b) => a.priority - b.priority || a.order - b.order);
  const topTitles = completed.slice(0, SHARE_TOP_LIMIT).map((t) => t.title.trim());

  return {
    streak: current,
    best,
    pct,
    done: today.done,
    total: today.total,
    dateLabel: formatLocalDate(parseISODate(todayISO)),
    topTitles,
    extraTitles: Math.max(0, completed.length - topTitles.length),
  };
}

/* ------------------------------------------------------------------ */
/* Lienzo                                                             */
/* ------------------------------------------------------------------ */

const W = 1080;
const H = 1920;
const M = 160; // margen lateral

export interface ShareTheme {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  fontBody: string;
  fontDisplay: string;
}

/** Colores y tipografía del tema activo ([data-theme] en <html>). */
export function currentThemeColors(): ShareTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#1a1512"),
    fg: v("--text", "#f2e8dc"),
    muted: v("--text-2", "#9c8b74"),
    accent: v("--accent", "#d9a441"),
    accent2: v("--accent-2", "#c1502e"),
    fontBody: v("--font-body", "system-ui, sans-serif"),
    fontDisplay: v("--font-display", "Georgia, serif"),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 3 && h.length !== 6) return hex;
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
): void {
  if (!color.startsWith("#")) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Generador determinista: la decoración sale idéntica en cada render. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Confeti estático en los márgenes, fuera de la zona de contenido. */
function drawDecor(ctx: CanvasRenderingContext2D, theme: ShareTheme): void {
  const rnd = mulberry32(42);
  const colors = [theme.accent, theme.accent2, theme.accent, theme.muted];
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    if (x > 140 && x < 940 && y > 300 && y < 1840) continue; // deja el centro limpio
    const w = 14 + rnd() * 18;
    const h = 10 + rnd() * 10;
    ctx.save();
    ctx.globalAlpha = 0.3 + rnd() * 0.4;
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = colors[i % colors.length];
    fillRoundRect(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.restore();
  }
}

type SpacedCtx = CanvasRenderingContext2D & { letterSpacing: string };

function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  // Sin soporte (Safari antiguo) es una propiedad sin efecto: no rompe.
  (ctx as SpacedCtx).letterSpacing = `${px}px`;
}

function center(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  color: string,
): void {
  ctx.textAlign = "center";
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function renderShareCard(
  payload: DaySharePayload,
  theme: ShareTheme,
): Promise<Blob> {
  try {
    await document.fonts.ready; // Fraunces u otra tipografía del tema
  } catch {
    /* seguimos con la de respaldo */
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el lienzo");
  ctx.textBaseline = "alphabetic";

  // Fondo + destellos del tema
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W / 2, H * 0.14, 760, theme.accent, 0.16);
  glow(ctx, W / 2, H * 0.94, 700, theme.accent2, 0.14);
  drawDecor(ctx, theme);

  const body = theme.fontBody;
  const display = theme.fontDisplay;

  // Cabecera
  setTracking(ctx, 14);
  center(ctx, "MIS TAREAS", 165, `700 40px ${body}`, theme.accent);
  setTracking(ctx, 0);
  center(ctx, payload.dateLabel, 232, `500 42px ${body}`, theme.muted);

  // Racha
  center(ctx, "🔥", 445, `140px ${body}`, theme.fg);
  center(ctx, String(payload.streak), 775, `700 300px ${display}`, theme.fg);
  setTracking(ctx, 8);
  center(
    ctx,
    payload.streak === 1 ? "día seguido" : "días seguidos",
    850,
    `600 46px ${body}`,
    theme.muted,
  );
  setTracking(ctx, 0);
  if (payload.best > 0) {
    center(ctx, `mejor racha · ${payload.best}`, 915, `500 36px ${body}`, theme.muted);
  }

  // Progreso de hoy
  if (payload.total > 0) {
    setTracking(ctx, 10);
    ctx.textAlign = "left";
    ctx.font = `700 42px ${body}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText("HOY", M, 1045);
    setTracking(ctx, 0);
    ctx.textAlign = "right";
    ctx.font = `700 58px ${display}`;
    ctx.fillStyle = theme.accent;
    ctx.fillText(`${payload.pct}%`, W - M, 1045);

    const barY = 1080;
    const barH = 46;
    const barW = W - 2 * M;
    ctx.textAlign = "left";
    ctx.fillStyle = withAlpha(theme.accent, 0.18);
    fillRoundRect(ctx, M, barY, barW, barH, barH / 2);
    const filled = Math.round((barW * Math.min(payload.pct, 100)) / 100);
    if (filled > 0) {
      ctx.fillStyle = theme.accent;
      fillRoundRect(ctx, M, barY, filled, barH, barH / 2);
    }

    const fulfilled = payload.done / payload.total >= DAY_FULFILL_RATIO;
    center(
      ctx,
      `${payload.done} de ${payload.total} tareas · ${fulfilled ? "día cumplido 🎉" : "en camino 💪"}`,
      1200,
      `500 40px ${body}`,
      theme.muted,
    );
  } else {
    center(ctx, "☀️ día libre", 1120, `600 54px ${display}`, theme.muted);
  }

  // Divisor
  ctx.fillStyle = withAlpha(theme.muted, 0.25);
  ctx.fillRect(M, 1280, W - 2 * M, 2);

  // Lo que completaste
  const showTitles =
    payload.extraTitles > 0 ? payload.topTitles.slice(0, SHARE_TOP_LIMIT - 1) : payload.topTitles;
  const hidden = payload.topTitles.length - showTitles.length + payload.extraTitles;

  ctx.textAlign = "left";
  if (showTitles.length > 0) {
    ctx.font = `600 46px ${display}`;
    ctx.fillStyle = theme.fg;
    ctx.fillText("Completaste hoy ✅", M, 1375);
    const maxW = W - 2 * M - 60;
    showTitles.forEach((title, i) => {
      const y = 1465 + i * 82;
      ctx.font = `700 44px ${body}`;
      ctx.fillStyle = theme.accent;
      ctx.fillText("✓", M, y);
      ctx.font = `500 44px ${body}`;
      ctx.fillStyle = theme.fg;
      ctx.fillText(ellipsize(ctx, title, maxW), M + 60, y);
    });
    if (hidden > 0) {
      ctx.font = `500 40px ${body}`;
      ctx.fillStyle = theme.muted;
      ctx.fillText(`+${hidden} más`, M + 60, 1465 + showTitles.length * 82);
    }
  } else {
    ctx.font = `600 46px ${display}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(payload.total > 0 ? "Aún nada cerrado 💪" : "Día despejado ☀️", M, 1375);
  }

  // Pie
  setTracking(ctx, 4);
  center(ctx, "Organiza tu día con Mis Tareas", 1875, `600 34px ${body}`, theme.muted);
  setTracking(ctx, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no se pudo generar la imagen"))),
      "image/png",
    );
  });
}
