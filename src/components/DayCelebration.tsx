import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { computeStreaks } from "@/domain/streak";
import { celebrationPhrase, dayJustCompleted } from "@/domain/celebration";
import { drawSeal, sealDateLabel, sealSpec } from "@/domain/seal";
import { mulberry32, withAlpha } from "@/domain/paint";
import { currentThemeColors } from "@/domain/shareCard";
import ShareDayButton from "@/components/ShareDayButton";
import { startOfDay, toISODate } from "@/domain/dateutils";

const AUTO_CLOSE_MS = 9000;
/** Segundos: el golpe del sello. */
const T_IMPACT = 1.45;
/** Segundos: fin de la animación (fotograma final limpio). */
const T_END = 4.6;
const PARTICLES = 650;
const SPARKS = 110;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * «Acuñar el día» — celebración sin modal genérico.
 *
 * El polvo de toda la pantalla converge y se ensambla en EL SELLO DEL DÍA
 * (procedural, único por fecha + racha, con los colores del tema): a los
 * 1,45 s el sello golpea con destello, sacudida y vibración, y estalla en
 * chispas. El mismo sello viaja después en la tarjeta de compartir.
 *
 * El trigger sigue siendo de nivel app: funciona desde cualquier vista y
 * solo en la transición false → true (nunca al abrir con el día ya hecho).
 */
export default function DayCelebration() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const todayISO = useMemo(() => toISODate(startOfDay(new Date())), []);
  const { current, today } = useMemo(
    () => computeStreaks(allTasks ?? [], todayISO),
    [allTasks, todayISO],
  );

  const [show, setShow] = useState(false);
  const [phrase, setPhrase] = useState("");
  // Primer pase: solo registrar el estado inicial (sin celebrar lo ya hecho).
  const wasFulfilled = useRef<boolean | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);

  const fulfilled = today.total > 0 && today.fulfilled;
  useEffect(() => {
    if (wasFulfilled.current === null) {
      wasFulfilled.current = fulfilled;
      return;
    }
    const just = dayJustCompleted(wasFulfilled.current, fulfilled);
    wasFulfilled.current = fulfilled;
    if (!just) return;

    setPhrase(celebrationPhrase());
    setShow(true);
  }, [fulfilled]);

  // Cierre automático.
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [show]);

  // Animación del sello.
  useEffect(() => {
    if (!show) return;
    const canvas = canvasRef.current;
    const slot = slotRef.current;
    if (!canvas || !slot) return;

    let cancelled = false;
    let raf = 0;

    const boot = () => {
      if (cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.scale(dpr, dpr);

      const rect = slot.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const R = Math.min(rect.width, rect.height) / 2;

      const theme = currentThemeColors();
      const spec = sealSpec(todayISO, current);
      const dateShort = sealDateLabel(todayISO);
      const sealOpts = { streak: current, dateShort };

      // El sello en un offscreen: sus píxeles son las dianas del polvo,
      // con el color real de cada trazo.
      const targets: { x: number; y: number; color: string }[] = [];
      const off = document.createElement("canvas");
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (octx) {
        octx.scale(dpr, dpr);
        drawSeal(octx, cx, cy, R, spec, theme, sealOpts);
        const img = octx.getImageData(0, 0, off.width, off.height).data;
        for (let py = 0; py < off.height; py += 4) {
          for (let px = 0; px < off.width; px += 4) {
            const i = (py * off.width + px) * 4;
            if (img[i + 3] > 140) {
              targets.push({
                x: px / dpr,
                y: py / dpr,
                color: `rgb(${img[i]},${img[i + 1]},${img[i + 2]})`,
              });
            }
          }
        }
      }

      const rnd = mulberry32(spec.seed ^ 0x9e3779b9);
      for (let i = targets.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = targets[i];
        targets[i] = targets[j];
        targets[j] = tmp;
      }
      const pick = (i: number) => targets[i % Math.max(targets.length, 1)];

      const particles = Array.from({ length: PARTICLES }, (_, i) => {
        const t = pick(i) ?? { x: cx, y: cy, color: theme.accent };
        const sx = rnd() * w;
        const sy = rnd() * h;
        return {
          sx,
          sy,
          tx: t.x,
          ty: t.y,
          color: t.color,
          mx: (sx + t.x) / 2 + (rnd() - 0.5) * R * 1.4,
          my: (sy + t.y) / 2 + (rnd() - 0.5) * R * 1.4,
          size: 3 + rnd() * 4,
          rot: rnd() * Math.PI,
          delay: rnd() * 0.5,
          dur: 0.7 + rnd() * 0.45,
        };
      });

      const sparkColors = [theme.accent, theme.accent2, "#ffd166", "#06d6a0", "#ef476f"];
      const sparks = Array.from({ length: SPARKS }, (_, i) => {
        const a = rnd() * Math.PI * 2;
        const sp = 300 + rnd() * 540;
        return {
          x0: cx + Math.cos(a) * R * 0.9,
          y0: cy + Math.sin(a) * R * 0.9,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 140,
          life: 1 + rnd() * 1.1,
          delay: rnd() * 0.3,
          size: 2.5 + rnd() * 3,
          color: sparkColors[i % sparkColors.length],
        };
      });

      const start = performance.now();
      let vibrated = false;

      const draw = (t: number) => {
        ctx.clearRect(0, 0, w, h);

        // Sacudida en el impacto
        let shakeX = 0;
        let shakeY = 0;
        if (t >= T_IMPACT && t < T_IMPACT + 0.5) {
          const k = 1 - (t - T_IMPACT) / 0.5;
          shakeX = Math.sin((t - T_IMPACT) * 62) * 7 * k;
          shakeY = Math.cos((t - T_IMPACT) * 51) * 5 * k;
        }

        ctx.save();
        ctx.translate(shakeX, shakeY);

        // El sello se insinúa antes del golpe
        if (t > 0.7 && t < T_IMPACT) {
          ctx.globalAlpha = clamp01((t - 0.7) / 0.75) * 0.2;
          drawSeal(ctx, cx, cy, R, spec, theme, sealOpts);
          ctx.globalAlpha = 1;
        }

        // Polvo convergiendo hacia cada píxel del sello
        const dustAlpha = 1 - clamp01((t - T_IMPACT) / 0.3);
        if (dustAlpha > 0) {
          for (const p of particles) {
            const raw = clamp01((t - p.delay) / p.dur);
            if (raw <= 0) continue;
            const e = easeOutCubic(raw);
            const inv = 1 - e;
            const x = inv * inv * p.sx + 2 * inv * e * p.mx + e * e * p.tx;
            const y = inv * inv * p.sy + 2 * inv * e * p.my + e * e * p.ty;
            ctx.globalAlpha = Math.min(raw * 6, 1) * dustAlpha;
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(p.rot + t * 1.4);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        }

        if (t >= T_IMPACT) {
          if (!vibrated) {
            vibrated = true;
            try {
              navigator.vibrate?.([25, 60, 90]); // háptico en Android
            } catch {
              /* sin vibración no pasa nada */
            }
          }

          // El sello nítido
          ctx.globalAlpha = clamp01((t - T_IMPACT) / 0.12);
          drawSeal(ctx, cx, cy, R, spec, theme, sealOpts);
          ctx.globalAlpha = 1;

          // Destello del golpe
          const flash = 1 - clamp01((t - T_IMPACT) / 0.5);
          if (flash > 0) {
            ctx.fillStyle = withAlpha(theme.accent, 0.3 * flash);
            ctx.fillRect(0, 0, w, h);
          }

          // Chispas
          for (const s of sparks) {
            const age = t - T_IMPACT - s.delay;
            if (age <= 0 || age > s.life) continue;
            const x = s.x0 + s.vx * age;
            const y = s.y0 + s.vy * age + 0.5 * 1400 * age * age;
            ctx.globalAlpha = 1 - age / s.life;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.size;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - s.vx * 0.05, y - (s.vy + 1400 * age) * 0.05);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        ctx.restore();
      };

      const tick = () => {
        const t = (performance.now() - start) / 1000;
        draw(t);
        if (t < T_END) {
          raf = requestAnimationFrame(tick);
        } else {
          draw(T_END + 1); // fotograma final: solo el sello, sin polvo
        }
      };
      raf = requestAnimationFrame(tick);
    };

    void document.fonts.ready.then(boot, boot);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [show, current, todayISO]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[54] cursor-pointer overflow-hidden backdrop-blur-md"
          style={{ background: "color-mix(in srgb, var(--bg) 90%, transparent)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setShow(false)}
          role="dialog"
          aria-label="Día cumplido"
          data-testid="day-celebration"
        >
          <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
            {/* Hueco donde la animación acuña el sello */}
            <div ref={slotRef} className="aspect-square w-[min(76vw,330px)]" aria-hidden="true" />

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.55, duration: 0.55 }}
            >
              <h2 className="font-display text-primary text-2xl font-semibold">
                ¡Día cumplido!
              </h2>
              <p className="text-muted mx-auto mt-1 max-w-[17rem] text-sm italic">
                «{phrase}»
              </p>
              <ShareDayButton className="btn-primary mx-auto mt-4 flex w-full max-w-[17rem] justify-center text-sm">
                📤 Compartir mi día
              </ShareDayButton>
              <p className="mt-3 text-[10px] uppercase tracking-wide text-muted">
                toca para cerrar
              </p>
            </motion.div>
          </div>

          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
