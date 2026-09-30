import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useStore } from "@/store/useStore";
import { computeStreaks, STREAK_MILESTONES } from "@/domain/streak";
import { startOfDay, toISODate } from "@/domain/dateutils";
import type { Task } from "@/domain/types";

/**
 * Tarjeta del panel «Hoy»: SOLO racha (días 🔥) y % del día con barra
 * animada — la semana vive en Ajustes → Perfil (`WeekStrip`), decisión del
 * usuario para dejar el panel limpio.
 */
export default function StreakCard({ tasks }: { tasks: Task[] }) {
  const pushToast = useStore((s) => s.pushToast);
  const todayISO = useMemo(() => toISODate(startOfDay(new Date())), []);
  const { current, best, today } = useMemo(
    () => computeStreaks(tasks, todayISO),
    [tasks, todayISO],
  );

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
    <div className="card card-panel mb-4 p-4" data-testid="streak-card">
      <div className="flex items-center justify-between gap-4">
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

        <div className="min-w-[45%] flex-1">
          <p className="text-right text-xs text-muted">
            <span className="font-semibold text-accent">
              {today.total === 0 ? "—" : `${pct}%`}
            </span>{" "}
            hoy
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
            <motion.div
              className="h-full rounded-full bg-[var(--accent)]"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
