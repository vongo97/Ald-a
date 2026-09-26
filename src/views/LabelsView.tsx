import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { updateTask } from "@/store/actions";
import TaskItem from "@/components/TaskItem";
import { EmptyState } from "./TodayView";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { autoAssignLabel } from "@/llm/tasks";

export default function LabelsView() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const pushToast = useStore((s) => s.pushToast);
  const openCapture = useStore((s) => s.openCapture);
  const { settings } = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isMagic, setIsMagic] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of allTasks ?? []) {
      if (t.status !== "todo") continue;
      for (const l of t.labels) map.set(l, (map.get(l) ?? 0) + 1);
    }
    return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
  }, [allTasks]);

  if (!allTasks) return null;

  const filtered = selected ? allTasks.filter((t) => t.status === "todo" && t.labels.includes(selected)) : [];

  const handleMagicLabel = async (label: string) => {
    if (!settings.apiKey.trim()) {
      pushToast("Configura tu clave de IA en Ajustes para la auto-asignación mágica");
      return;
    }
    setIsMagic(true);
    try {
      const candidates = allTasks.filter((t) => t.status === "todo" && !t.labels.includes(label));
      if (candidates.length === 0) {
        pushToast(`No hay tareas libres para asignar a @${label}`);
        return;
      }
      
      const res = await autoAssignLabel({ settings }, label, candidates);
      if (!res.ok) {
        pushToast(`Error de IA: ${res.error ?? "Desconocido"}`);
        return;
      }
      
      const idsToTag = res.data ?? [];
      if (idsToTag.length === 0) {
        pushToast(`La IA no encontró tareas que encajen en @${label}`);
        return;
      }
      
      let assigned = 0;
      for (const id of idsToTag) {
        const t = candidates.find(c => c.id === id);
        if (t) {
          await updateTask(id, { labels: [...t.labels, label] });
          assigned++;
        }
      }
      
      pushToast(`✨ @${label} asignada a ${assigned} tareas automáticamente`);
      setSelected(label);
    } catch (err) {
      pushToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsMagic(false);
    }
  };

  return (
    <section>
      <header className="mb-3">
        <h1 className="text-xl font-bold">Etiquetas</h1>
      </header>

      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const l = name.trim().replace(/^@/, "").toLowerCase();
          if (!l) return;
          void handleMagicLabel(l);
          setName("");
        }}
      >
        <input
          className="input flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: salud (la IA buscará tareas que coincidan)..."
          disabled={isMagic}
        />
        <button type="submit" disabled={isMagic || !name.trim()} className="btn-primary">
          {isMagic ? "✨ Buscando..." : "✨ Crear y auto-asignar"}
        </button>
      </form>

      {counts.size === 0 ? (
        <EmptyState icon="🏷️" title="Sin etiquetas" hint="Añade @etiqueta al capturar: «Renovar seguro @coche @dinero»." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {[...counts.entries()].map(([label, count]) => (
            <button
              key={label}
              type="button"
              onClick={() => setSelected(selected === label ? null : label)}
              className={`chip cursor-pointer bg-amber-500/15 light:bg-amber-100 px-3 py-1.5 text-sm text-amber-300 light:text-amber-700 ${selected === label ? "ring-2 ring-amber-400 light:ring-amber-500" : ""}`}
            >
              @{label} · {count}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-400 light:text-slate-500">Tareas con @{selected}</h2>
          <ul className="space-y-2">
            {filtered.map((t) => (
              <li key={t.id}>
                <TaskItem task={t} />
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-slate-700/60 light:border-slate-200">
            <button
              type="button"
              className="btn-ghost text-xs text-sky-400 light:text-sky-600 w-full justify-center"
              onClick={() => openCapture(`@${selected} `)}
            >
              + Nueva tarea en @{selected}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
