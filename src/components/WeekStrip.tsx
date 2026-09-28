import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { weekDots, type DotState } from "@/domain/streak";
import { startOfDay, toISODate } from "@/domain/dateutils";

/** Punto de la semana según su estado (color del tema activo). */
const DOT_CLASS: Record<DotState, string> = {
  done: "bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]",
  today: "border-2 border-[var(--accent)] animate-pulse",
  missed: "border border-[var(--card-border)]",
  empty: "border border-dashed border-[var(--card-border)] opacity-40",
  future: "bg-[var(--fg-muted)] opacity-20",
};

/**
 * Tira de la semana actual (l m x j v s d) para el perfil de usuario:
 * cada punto con su día del mes. Sale de aquí del panel «Hoy» a petición
 * del usuario, para dejar la pantalla de entrada limpia.
 */
export default function WeekStrip() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const todayISO = useMemo(() => toISODate(startOfDay(new Date())), []);
  const dots = useMemo(() => weekDots(tasks ?? [], todayISO), [tasks, todayISO]);

  return (
    <div className="rounded-lg bg-surface-hover p-3" data-testid="week-strip">
      <p className="mb-2 text-xs text-muted">📅 Esta semana</p>
      <div className="flex justify-between">
        {dots.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <span
              className={`text-[10px] ${
                d.date === todayISO ? "font-bold text-accent" : "text-muted"
              }`}
            >
              {d.label}
            </span>
            <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[d.state]}`} />
            <span className="text-[9px] text-muted">{Number(d.date.slice(8))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
