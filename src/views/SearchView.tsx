import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { useStore } from "@/store/useStore";
import TaskItem from "@/components/TaskItem";
import { EmptyState } from "./TodayView";

export default function SearchView() {
  const query = useStore((s) => s.searchQuery);
  const setQuery = useStore((s) => s.setSearchQuery);
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (allTasks ?? []).filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.notes?.toLowerCase().includes(q) ?? false) ||
        t.labels.some((l) => l.includes(q)),
    );
  }, [allTasks, query]);

  return (
    <section>
      <header className="mb-3">
        <h1 className="text-xl font-bold">Buscar</h1>
      </header>
      <input
        className="input mb-4"
        placeholder="Buscar en todas las tareas…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {query.trim() === "" ? (
        <EmptyState icon="🔍" title="Escribe para buscar" hint="Busca en títulos, notas y etiquetas, incluidas las completadas." />
      ) : results.length === 0 ? (
        <EmptyState icon="🤷" title="Sin resultados" hint={`Nada coincide con «${query}».`} />
      ) : (
        <ul className="space-y-2">
          {results.map((t) => (
            <li key={t.id}>
              <TaskItem task={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
