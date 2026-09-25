import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { sortBySuggested } from "@/domain/priority";
import { dayCapacity, formatMinutes } from "@/domain/capacity";
import { overdueTasks, proposeReprogramming } from "@/domain/deviation";
import { applyReprogramming } from "@/store/actions";
import { useStore } from "@/store/useStore";
import SortableTaskList from "@/components/SortableTaskList";
import { toISODate, startOfDay } from "@/domain/dateutils";

export default function TodayView() {
  const pushToast = useStore((s) => s.pushToast);

  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);

  const today = toISODate(startOfDay(new Date()));

  const todays = useMemo(() => {
    if (!allTasks) return [];
    const base = allTasks.filter((t) => t.dueDate === today && t.status === "todo");
    return sortBySuggested(base);
  }, [allTasks, today]);

  const capacity = useMemo(() => dayCapacity(allTasks ?? [], today), [allTasks, today]);
  const overdue = useMemo(() => overdueTasks(allTasks ?? []), [allTasks]);
  const proposals = useMemo(() => proposeReprogramming(allTasks ?? []), [allTasks]);

  if (!allTasks || !projects) return null;

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">Hoy</h1>
        <span className="text-xs text-slate-400">
          {todays.length} tarea{todays.length === 1 ? "" : "s"}
        </span>
      </header>

      {overdue.length > 0 && (
        <div className="card mb-4 border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">
            ⚠️ {overdue.length} tarea{overdue.length === 1 ? "" : "s"} vencida
            {overdue.length === 1 ? "" : "s"} desde antes de hoy.
          </p>
          <button
            type="button"
            className="btn-primary mt-2 text-xs"
            onClick={() => {
              void applyReprogramming(proposals).then(() =>
                pushToast(`${proposals.length} tareas reprogramadas`),
              );
            }}
          >
            Reprogramar sugerencia (un clic)
          </button>
          <p className="mt-1 text-xs text-amber-200/70">
            {proposals.length > 0
              ? "Mueve las vencidas a los primeros días con hueco, respetando tu carga."
              : "No hay propuesta automática; revisa las fechas manualmente."}
          </p>
        </div>
      )}

      {capacity.overbooked && (
        <div className="card mb-4 border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          🔋 Tu plan de hoy no cabe: {formatMinutes(capacity.committedMin + capacity.estimatedMin)} de{" "}
          {formatMinutes(capacity.capacityMin)} disponibles. Considera mover algo a mañana.
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
      <p className="font-semibold text-slate-200">{title}</p>
      <p className="max-w-sm text-sm text-slate-400">{hint}</p>
    </div>
  );
}
