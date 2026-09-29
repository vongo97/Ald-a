import type { Task } from "./types";
import type { WeekDot } from "./streak";
import { DAY_FULFILL_RATIO, computeStreaks, dayStat, weekDots } from "./streak";
import { formatLocalDate, parseISODate } from "./dateutils";
import { drawSeal, sealDateLabel, sealSpec } from "./seal";
import { mulberry32, setTracking, withAlpha } from "./paint";
import { qrMatrix } from "./qr";

/**
 * Tarjeta «Compartir mi día» (fase visual).
 *
 * Genera un PNG 1080×1920 (formato stories/estado) en canvas puro, con los
 * colores y tipografías del tema activo, y lo pasa al compartir nativo del
 * sistema (Web Share API con archivos). Si el dispositivo no lo soporta, se
 * descarga. El centro de la tarjeta es EL SELLO DEL DÍA: la misma pieza
 * procedural que se acuña en la celebración (misma semilla = mismo sello).
 *
 * PRIVACIDAD: la tarjeta nunca lleva tareas sueltas ni títulos — solo
 * cifras (racha, %, contadores) y la franja de la semana (ritmo, no
 * contenido). En el pie, un QR generado en el propio dispositivo apunta a
 * la app para quien la reciba pueda entrar. Todo es local: la imagen no
 * sale del dispositivo hasta que el usuario la comparte.
 */

/** Enlace al que apunta el QR de la tarjeta. */
export const APP_URL = "https://ald-a.vercel.app";
/** El mismo enlace, legible para quien prefiera teclearlo. */
export const APP_DISPLAY_URL = "ald-a.vercel.app";

export interface DaySharePayload {
  /** ISO «YYYY-MM-DD» — la semilla del sello. */
  dateISO: string;
  /** Días consecutivos cumplidos que terminan hoy. */
  streak: number;
  best: number;
  /** 0–100, redondeado (la regla de cumplimiento vive en el dominio). */
  pct: number;
  done: number;
  total: number;
  /** «martes, 29 de septiembre». */
  dateLabel: string;
  /** Puntos de la semana (lunes → domingo): solo estado, jamás contenido. */
  week: WeekDot[];
  /** Días de la semana ya cumplidos. */
  weekFulfilled: number;
  /** Tareas completadas de lunes a hoy — una cifra, nada más. */
  weekDone: number;
}

export function buildSharePayload(tasks: Task[], todayISO: string): DaySharePayload {
  const { current, best, today } = computeStreaks(tasks, todayISO);
  const pct = today.total > 0 ? Math.round((today.done / today.total) * 100) : 0;

  const week = weekDots(tasks, todayISO);
  const weekFulfilled = week.filter((d) => d.state === "done").length;
  let weekDone = 0;
  for (const d of week) {
    if (d.date > todayISO) continue; // lo que aún no llega no cuenta
    weekDone += dayStat(tasks, d.date).done;
  }

  return {
    dateISO: todayISO,
    streak: current,
    best,
    pct,
    done: today.done,
    total: today.total,
    dateLabel: formatLocalDate(parseISODate(todayISO)),
    week,
    weekFulfilled,
    weekDone,
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

function roundRectPath(
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
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  roundRectPath(ctx, x, y, w, h, r);
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

/** Confeti estático en los márgenes, fuera de la zona de contenido. */
function drawDecor(ctx: CanvasRenderingContext2D, theme: ShareTheme): void {
  const rnd = mulberry32(42);
  const colors = [theme.accent, theme.accent2, theme.accent, theme.muted];
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    if (x > 140 && x < 940 && y > 300 && y < 1870) continue; // deja el centro limpio
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

/** Punto de la semana: ritmo visual, nunca hay texto privado dentro. */
function drawWeekDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  state: string,
  theme: ShareTheme,
): void {
  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (state === "done") {
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // visto en el color del fondo
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = Math.max(4, r * 0.3);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy + r * 0.04);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.38);
    ctx.lineTo(cx + r * 0.46, cy - r * 0.38);
    ctx.stroke();
  } else if (state === "today") {
    ctx.fillStyle = withAlpha(theme.accent, 0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (state === "missed") {
    ctx.strokeStyle = withAlpha(theme.muted, 0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (state === "empty") {
    ctx.strokeStyle = withAlpha(theme.muted, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // futuro: punteado, «aún no juega»
    ctx.strokeStyle = withAlpha(theme.muted, 0.3);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * QR sobre placa blanca (los códigos se leen sobre fondo claro en
 * cualquier tema). Módulos con tamaño entero para que salgan nítidos:
 * la borrosidad mata el escaneo.
 */
function drawQr(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  theme: ShareTheme,
): void {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 4; // módulos de silencio mínimos según la norma
  const cell = Math.max(1, Math.floor(size / (n + quiet * 2)));
  const qrPx = cell * n;
  const off = Math.round((size - qrPx) / 2); // margen blanco real

  roundRectPath(ctx, x, y, size, size, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = withAlpha(theme.muted, 0.45);
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#141414";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) ctx.fillRect(x + off + c * cell, y + off + r * cell, cell, cell);
    }
  }
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

  // El sello del día — misma pieza que la celebración
  drawSeal(ctx, W / 2, 615, 275, sealSpec(payload.dateISO, payload.streak), theme, {
    streak: payload.streak,
    dateShort: sealDateLabel(payload.dateISO),
  });

  if (payload.best > 0) {
    center(ctx, `mejor racha · ${payload.best}`, 950, `500 36px ${body}`, theme.muted);
  }

  // Progreso de hoy (solo cifras)
  if (payload.total > 0) {
    setTracking(ctx, 10);
    ctx.textAlign = "left";
    ctx.font = `700 42px ${body}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText("HOY", M, 1055);
    setTracking(ctx, 0);
    ctx.textAlign = "right";
    ctx.font = `700 58px ${display}`;
    ctx.fillStyle = theme.accent;
    ctx.fillText(`${payload.pct}%`, W - M, 1055);

    const barY = 1090;
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
      1210,
      `500 40px ${body}`,
      theme.muted,
    );
  } else {
    center(ctx, "☀️ día libre", 1130, `600 54px ${display}`, theme.muted);
  }

  // Divisor
  ctx.fillStyle = withAlpha(theme.muted, 0.25);
  ctx.fillRect(M, 1285, W - 2 * M, 2);

  // Franja semanal — el ritmo de la semana, nunca el contenido
  setTracking(ctx, 10);
  ctx.textAlign = "left";
  ctx.font = `700 36px ${body}`;
  ctx.fillStyle = theme.muted;
  ctx.fillText("ESTA SEMANA", M, 1335);
  setTracking(ctx, 0);

  const dotY = 1405;
  const dotR = 26;
  const startX = M + 30;
  const gap = (W - 2 * M - 60) / 6;
  payload.week.forEach((d, i) => {
    const cx = startX + i * gap;
    drawWeekDot(ctx, cx, dotY, dotR, d.state, theme);
    ctx.textAlign = "center";
    ctx.font = `700 26px ${body}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(d.label.toUpperCase(), cx, 1465);
  });

  // Cifras de la semana (se encoge si no cabe)
  const statText = `${payload.weekFulfilled} de 7 días cumplidos · ${payload.weekDone} tareas completadas`;
  ctx.textAlign = "left";
  let statPx = 40;
  ctx.font = `500 ${statPx}px ${body}`;
  const statMax = W - 2 * M;
  while (ctx.measureText(statText).width > statMax && statPx > 26) {
    statPx -= 2;
    ctx.font = `500 ${statPx}px ${body}`;
  }
  ctx.fillStyle = theme.fg;
  ctx.fillText(statText, M, 1525);

  // QR a la app + llamada a la acción (generado en el dispositivo)
  const qrSize = 300;
  drawQr(ctx, APP_URL, M, 1560, qrSize, theme);

  const tx = M + qrSize + 60;
  ctx.textAlign = "left";
  setTracking(ctx, 6);
  ctx.font = `700 36px ${body}`;
  ctx.fillStyle = theme.fg;
  ctx.fillText("ORGANIZA TU DÍA", tx, 1650);
  setTracking(ctx, 0);
  ctx.font = `500 30px ${body}`;
  ctx.fillStyle = theme.muted;
  ctx.fillText("escanea el código", tx, 1712);
  ctx.font = `700 42px ${display}`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(APP_DISPLAY_URL, tx, 1785);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no se pudo generar la imagen"))),
      "image/png",
    );
  });
}
