import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { sortBySuggested } from "@/domain/priority";
import SortableTaskList from "@/components/SortableTaskList";
import { EmptyState } from "./TodayView";

/**
 * «Activas»: todo lo que tienes abierto y sin empezar, tenga fecha o no.
 *
 * El nombre era «Bandeja», que prometía lo capturado sin clasificar pero
 * enseñaba TODO lo activo. Eso hacía que, al alternar entre esta vista y Hoy,
 * pareciera que los datos se desincronizaban: 4 tareas aquí, 2 allí, y ninguna
 * cuenta para la diferencia. El filtro siempre fue el correcto; lo que mentía
 * era la etiqueta.
 *
 * Las subtareas quedan fuera a propósito: se ven dentro de su tarea padre, en
 * su propia vista de detalle.
 */
export default function InboxView() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  const tasks = useMemo(() => {
    if (!allTasks) return [];
    return sortBySuggested(allTasks.filter((t) => t.status === "todo" && !t.parentId && !t.deletedAt));
  }, [allTasks]);

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold">Activas</h1>
        <span className="text-xs text-muted">{tasks.length} sin empezar</span>
      </header>
      {tasks.length === 0 ? (
        <EmptyState
          icon="📥"
          title="Nada activo"
          hint="Aquí sale todo lo que tienes abierto, tenga fecha o no. Las que vencen hoy están en Hoy."
        />
      ) : (
        <SortableTaskList tasks={tasks} showScore />
      )}
    </section>
  );
}
