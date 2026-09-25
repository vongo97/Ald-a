import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { sortBySuggested } from "@/domain/priority";
import SortableTaskList from "@/components/SortableTaskList";
import { EmptyState } from "./TodayView";

export default function InboxView() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  const tasks = useMemo(() => {
    if (!allTasks) return [];
    return sortBySuggested(allTasks.filter((t) => t.status === "todo" && !t.parentId));
  }, [allTasks]);

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">Bandeja</h1>
        <span className="text-xs text-slate-400">{tasks.length} activas</span>
      </header>
      {tasks.length === 0 ? (
        <EmptyState
          icon="📥"
          title="Bandeja vacía"
          hint="Captura tareas con / sin pensar en fechas. Aquí aparece todo lo activo, ordenado por sugerencia."
        />
      ) : (
        <SortableTaskList tasks={tasks} showScore />
      )}
    </section>
  );
}
