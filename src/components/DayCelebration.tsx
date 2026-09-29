import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { computeStreaks } from "@/domain/streak";
import { celebrationPhrase, dayJustCompleted } from "@/domain/celebration";
import ShareDayButton from "@/components/ShareDayButton";
import { startOfDay, toISODate } from "@/domain/dateutils";

const AUTO_CLOSE_MS = 7000;

/**
 * Confetti en canvas puro (sin librerías): explosión radial detrás de la
 * tarjeta, colores del tema activo + toques festivos. Se para solo cuando
 * todas las piezas han caído.
 */
function ConfettiCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#d9a441";
    const accent2 = css.getPropertyValue("--accent-2").trim() || "#c1502e";
    const colors = [accent, accent2, "#ffd166", "#06d6a0", "#ef476f"];

    const N = 140;
    const parts = Array.from({ length: N }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 10;
      return {
        x: w / 2,
        y: h / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[i % colors.length],
        life: 1,
        decay: 0.007 + Math.random() * 0.01,
      };
    });

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18; // gravedad
        p.vx *= 0.99;
        p.rot += p.vr;
        p.life -= p.decay;
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (alive > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[55]" />;
}

/**
 * Celebración «¡Día cumplido!»: watch de nivel app — se dispara al cruzar el
 * ≥70 % de HOY esté donde estés (Hoy, Día, Captura…), con confetti, la racha
 * y una frase. Clic para cerrar o se cierra sola.
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
    try {
      navigator.vibrate?.([40, 70, 40]); // háptico en Android
    } catch {
      // Sin vibración no pasa nada.
    }
  }, [fulfilled]);

  // Cierre automático.
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[54] flex cursor-pointer items-center justify-center bg-black/40 px-6 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShow(false)}
          role="dialog"
          aria-label="Día cumplido"
          data-testid="day-celebration"
        >
          <ConfettiCanvas />
          <motion.div
            className="card w-full max-w-xs p-6 text-center"
            initial={{ scale: 0.8, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-5xl">🎉</span>
            <h2 className="font-display mt-2 text-2xl font-semibold text-primary">
              ¡Día cumplido!
            </h2>
            <p className="mt-1 text-sm font-medium text-accent">
              🔥 {current} {current === 1 ? "día seguido" : "días seguidos"}
            </p>
            <p className="mt-3 text-sm italic text-muted">«{phrase}»</p>
            <ShareDayButton className="btn-primary mt-4 w-full justify-center text-sm">
              📤 Compartir mi día
            </ShareDayButton>
            <p className="mt-3 text-[10px] uppercase tracking-wide text-muted">
              toca para cerrar
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
