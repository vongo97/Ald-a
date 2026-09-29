import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { sortBySuggested } from "@/domain/priority";
import { dayCapacity, formatMinutes } from "@/domain/capacity";
import { useOverdue } from "@/store/useOverdue";
import { useStore } from "@/store/useStore";
import SortableTaskList from "@/components/SortableTaskList";
import StreakCard from "@/components/StreakCard";
import DayRing from "@/components/DayRing";
import ShareDayButton from "@/components/ShareDayButton";
import { toISODate, startOfDay } from "@/domain/dateutils";

export default function TodayView() {
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);

  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);

  const today = toISODate(startOfDay(new Date()));

  const todays = useMemo(() => {
    if (!allTasks) return [];
    const base = allTasks.filter((t) => t.dueDate === today && t.status === "todo" && !t.deletedAt);
    return sortBySuggested(base);
  }, [allTasks, today]);

  // Borradas de hoy (soft delete): existen, pero la vista las oculta.
  // El aviso las saca a la luz y lleva a la Papelera: ahí se restauran
  // una a una (nada de «restaurar todo»).
  const deletedToday = useMemo(
    () =>
      (allTasks ?? []).filter((t) => t.dueDate === today && t.status === "todo" && !!t.deletedAt),
    [allTasks, today],
  );

  const capacity = useMemo(() => dayCapacity(allTasks ?? [], today), [allTasks, today]);
  // La misma fuente que usa el modal: una sola definición de "vencida".
  const { overdue, proposals, applySuggestions } = useOverdue();

  if (!allTasks || !projects) return null;

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold">Hoy</h1>
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs text-muted">
            {todays.length} tarea{todays.length === 1 ? "" : "s"}
          </span>
          <ShareDayButton className="btn-ghost px-2.5 py-1 text-xs" />
        </div>
      </header>

      <StreakCard tasks={allTasks} />

      {/* Reloj de 24 h de Cronodisco (oculto en el resto de temas) */}
      <DayRing tasks={allTasks} today={today} />

      {overdue.length > 0 && (
        <div className="card mb-4 border-amber-500/40 light:border-amber-300 bg-amber-500/10 light:bg-amber-50 p-3">
          <p className="text-sm text-amber-200 light:text-amber-700">
            ⚠️ {overdue.length} tarea{overdue.length === 1 ? "" : "s"} vencida
            {overdue.length === 1 ? "" : "s"} desde antes de hoy.
          </p>
          <button
            type="button"
            className="btn-primary mt-2 text-xs"
            disabled={proposals.length === 0}
            onClick={() => {
              void applySuggestions().then(() =>
                pushToast(`${proposals.length} tareas reprogramadas`),
              );
            }}
          >
            Reprogramar sugerencia (un clic)
          </button>
          <p className="mt-1 text-xs text-amber-200/70 light:text-amber-700">
            {proposals.length > 0
              ? "Mueve las vencidas a los primeros días con hueco, respetando tu carga."
              : "No hay propuesta automática; revisa las fechas manualmente."}
          </p>
        </div>
      )}

      {capacity.overbooked && (
        <div className="card mb-4 border-rose-500/40 light:border-rose-300 bg-rose-500/10 light:bg-rose-50 p-3 text-sm text-rose-200 light:text-rose-700">
          🔋 Tu plan de hoy no cabe: {formatMinutes(capacity.committedMin + capacity.estimatedMin)} de{" "}
          {formatMinutes(capacity.capacityMin)} disponibles. Considera mover algo a mañana.
        </div>
      )}

      {deletedToday.length > 0 && (
        <div className="card mb-4 p-3">
          <p className="text-sm text-muted">
            🗑️ {deletedToday.length} tarea{deletedToday.length === 1 ? "" : "s"} de hoy en la papelera: no han
            desaparecido, están borradas.
            {todays.length === 0 && " Restáuralas desde ahí y el día vuelve a llenarse."}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary text-xs" onClick={() => setView("papelera")}>
              🗑️ Ver papelera
            </button>
            <span className="self-center text-xs text-muted">restaúralas una a una</span>
          </div>
        </div>
      )}

      {todays.length === 0 ? (
        <EmptyState
          icon="☀️"
          title="Día despejado"
          hint="Pulsa / (o el botón +) y escribe «Llamar a mamá hoy a las 18:00» para crear tu primera tarea de hoy."
        />
      ) : (
        <SortableTaskList tasks={todays} showScore />
      )}
    </section>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 p-8 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="font-semibold text-primary">{title}</p>
      <p className="max-w-sm text-sm text-muted">{hint}</p>
    </div>
  );
}
