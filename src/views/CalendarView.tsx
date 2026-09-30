import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import MonthCalendar from "@/components/MonthCalendar";
import type { DayGlance } from "@/components/MonthCalendar";
import TaskItem from "@/components/TaskItem";
import DayPlanModal from "@/components/DayPlanModal";
import { dayStat, computeStreaks } from "@/domain/streak";
import { monthGrid } from "@/domain/calendar";
import { sortBySuggested } from "@/domain/priority";
import { formatLocalDate, parseISODate, startOfDay, toISODate } from "@/domain/dateutils";

/**
 * Calendario mensual: el mapa de calor de tu mes. Cada día pinta su % con
 * el acento del tema, los cumplidos llevan ✓, y al tocar cualquier día se
 * abre debajo su detalle navegable — tareas, % y la racha que termina
 * ahí — con las mismas fuentes de verdad que Hoy (dayStat/computeStreaks).
 */
export default function CalendarView() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const today = toISODate(startOfDay(new Date()));

  const [selected, setSelected] = useState(today);
  const [planOpen, setPlanOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = startOfDay(new Date());
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  });

  const grid = useMemo(() => monthGrid(month.year, month.monthIndex), [month]);

  // Estado por fecha para las casillas del mes (borradas cuentan, como en Hoy).
  const stats = useMemo(() => {
    const tasks = allTasks ?? [];
    const map = new Map<string, DayGlance>();
    for (const row of grid.weeks) {
      for (const date of row) {
        if (!date || map.has(date)) continue;
        const s = dayStat(tasks, date);
        map.set(date, {
          total: s.total,
          done: s.done,
          fulfilled: s.fulfilled,
          pct: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
        });
      }
    }
    return map;
  }, [allTasks, grid]);

  const goMonth = (delta: number) => {
    const target = new Date(month.year, month.monthIndex + delta, 1);
    const y = target.getFullYear();
    const mi = target.getMonth();
    const mm = String(mi + 1).padStart(2, "0");
    setMonth({ year: y, monthIndex: mi });
    // La selección sigue al mes: hoy si cae dentro, si no el día 1.
    setSelected(today.startsWith(`${y}-${mm}`) ? today : `${y}-${mm}-01`);
  };

  const goToday = () => {
    const d = startOfDay(new Date());
    setMonth({ year: d.getFullYear(), monthIndex: d.getMonth() });
    setSelected(today);
  };

  // Detalle del día seleccionado: raíces del día (TaskItem anida subtareas).
  const dayRoots = useMemo(
    () =>
      sortBySuggested(
        (allTasks ?? []).filter(
          (t) => !t.deletedAt && !t.parentId && t.dueDate === selected,
        ),
      ),
    [allTasks, selected],
  );
  const pending = dayRoots.filter((t) => t.status === "todo");
  const done = dayRoots
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const glance = stats.get(selected);
  // Racha que termina en el día elegido (solo mira hacia atrás: futuro no cuenta).
  const streakAt = useMemo(() => {
    if (selected > today || !allTasks) return 0;
    return computeStreaks(allTasks, selected).current;
  }, [allTasks, selected, today]);

  const dayLabel = formatLocalDate(parseISODate(selected));

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold">Calendario</h1>
          <p className="text-xs text-muted">
            Tu mes de un vistazo: el color es el % de cada día. Toca uno para verlo.
          </p>
        </div>
        {/* El planificador vivía en la vista Día (retirada): su botón se
            muda aquí, junto a los días. */}
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="btn-primary text-xs"
          title="Describe tu día en lenguaje natural y la IA propondrá horarios"
        >
          ✨ Planificar día (IA)
        </button>
      </header>

      <MonthCalendar
        year={month.year}
        monthIndex={month.monthIndex}
        todayISO={today}
        selectedISO={selected}
        stats={stats}
        onPrev={() => goMonth(-1)}
        onNext={() => goMonth(1)}
        onToday={goToday}
        onSelect={setSelected}
      />

      {/* Detalle del día seleccionado */}
      <div className="card card-panel mt-4 p-3" data-testid="day-detail">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-primary">
            {dayLabel}
            {selected === today && (
              <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                hoy
              </span>
            )}
          </h2>
          {streakAt > 0 && (
            <span className="text-xs text-muted">🔥 {streakAt} hasta aquí</span>
          )}
        </div>

        {glance && glance.total > 0 ? (
          <p className="mb-3 text-sm text-muted">
            <span className="font-semibold text-primary">
              {glance.done} de {glance.total}
            </span>{" "}
            tareas · {glance.pct}%
            {glance.fulfilled && " · día cumplido 🎉"}
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted">Sin tareas con fecha en este día.</p>
        )}

        {/* Regla divisoria: Editorial la dibuja, Gabinete le cruza un
            brillo de latón (ver ald-a-animations.css). */}
        <div className="rule mb-3 h-px bg-[var(--border)]" aria-hidden="true" />

        {pending.length > 0 && (
          <>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Pendientes
            </h3>
            <ul className="task-list mb-3 space-y-1.5">
              {pending.map((t) => (
                <li key={t.id}>
                  <TaskItem task={t} />
                </li>
              ))}
            </ul>
          </>
        )}

        {done.length > 0 && (
          <>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Completadas
            </h3>
            <ul className="task-list space-y-1.5">
              {done.map((t) => (
                <li key={t.id}>
                  <TaskItem task={t} />
                </li>
              ))}
            </ul>
          </>
        )}

        {pending.length === 0 && done.length === 0 && (
          <p className="text-xs text-muted">
            Nada por aquí. Pulsa «+» o teclea / para añadir algo a este día.
          </p>
        )}
      </div>

      <DayPlanModal open={planOpen} onClose={() => setPlanOpen(false)} />
    </section>
  );
}
