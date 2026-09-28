import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useStore } from "@/store/useStore";
import {
  computeStreaks,
  STREAK_MILESTONES,
  weekDots,
  type DotState,
} from "@/domain/streak";
import { startOfDay, toISODate } from "@/domain/dateutils";
import type { Task } from "@/domain/types";

/** Punto de la semana según su estado (color del tema activo). */
const DOT_CLASS: Record<DotState, string> = {
  done: "bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]",
  today: "border-2 border-[var(--accent)] animate-pulse",
  missed: "border border-[var(--card-border)]",
  empty: "border border-dashed border-[var(--card-border)] opacity-40",
  future: "bg-[var(--fg-muted)] opacity-20",
};

/**
 * Tarjeta de racha del panel «Hoy»: 🔥 días seguidos, % de hoy con barra
 * animada y los 7 puntos de la semana (l m x j v s d).
 */
export default function StreakCard({ tasks }: { tasks: Task[] }) {
  const pushToast = useStore((s) => s.pushToast);
  const todayISO = useMemo(() => toISODate(startOfDay(new Date())), []);
  const { current, best, today } = useMemo(
    () => computeStreaks(tasks, todayISO),
    [tasks, todayISO],
  );
  const dots = useMemo(() => weekDots(tasks, todayISO), [tasks, todayISO]);

  // Aviso de hito solo cuando la racha CRECE durante la sesión: al abrir la
  // app, el pico inicial ya es el valor guardado y no vuelve a toastear.
  const peak = useRef(current);
  useEffect(() => {
    if (current > peak.current && STREAK_MILESTONES.includes(current)) {
      pushToast(`🔥 ¡${current} días seguidos! Un hito más`);
    }
    peak.current = current;
  }, [current, pushToast]);

  const pct = today.total ? Math.round((today.done / today.total) * 100) : 0;

  return (
    <div className="card mb-4 p-4" data-testid="streak-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold leading-none text-primary">
              {current}
            </span>
            <span className="text-xl leading-none">🔥</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {current === 1 ? "día seguido" : "días seguidos"}
            {best > current && ` · mejor: ${best}`}
            {current === 0 && best === 0 && " · empieza hoy 🌱"}
          </p>
        </div>

        <div className="min-w-[50%] flex-1">
          <p className="text-right text-xs text-muted">
            Hoy · {today.done}/{today.total} ·{" "}
            <span className="font-semibold text-accent">{pct}%</span>
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
            <motion.div
              className="h-full rounded-full bg-[var(--accent)]"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
          <p className="mt-1 text-right text-[10px] text-muted">
            {today.total === 0
              ? "Añade tareas y enciende el día"
              : today.fulfilled
                ? "¡Día cumplido! ✅"
                : "Falta poco: ≥70% = día cumplido"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex justify-between" aria-label="Semana">
        {dots.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1.5">
            <span
              className={`text-[10px] ${
                d.date === todayISO ? "font-bold text-accent" : "text-muted"
              }`}
            >
              {d.label}
            </span>
            <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[d.state]}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
