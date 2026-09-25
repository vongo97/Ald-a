import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { createProject, updateProject, deleteProject } from "@/store/actions";
import TaskItem from "@/components/TaskItem";
import { useStore } from "@/store/useStore";
import { EmptyState } from "./TodayView";
import { sortBySuggested } from "@/domain/priority";
import type { Task } from "@/domain/types";

export default function ProjectsView() {
  const pushToast = useStore((s) => s.pushToast);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const openCapture = useStore((s) => s.openCapture);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const [name, setName] = useState("");

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks ?? []) {
      if (t.status !== "todo" || t.parentId) continue;
      const key = t.projectId ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [allTasks]);

  if (!projects || !allTasks) return null;

  const selected = projects.find((p) => p.id === selectedProjectId);

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">Proyectos</h1>
      </header>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          void createProject(n, randomColor()).then(() => {
            pushToast(`Proyecto «${n}» creado`);
            setName("");
          });
        }}
      >
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nuevo proyecto…"
        />
        <button type="submit" className="btn-primary">Crear</button>
      </form>

      {projects.length === 0 ? (
        <EmptyState icon="📁" title="Sin proyectos" hint="Crea uno arriba. También se crean solos al capturar «comprar pan #casa»." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => {
            const count = (tasksByProject.get(p.id) ?? []).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProject(p.id === selectedProjectId ? undefined : p.id)}
                className={`chip cursor-pointer px-3 py-1.5 text-sm ${p.id === selectedProjectId ? "ring-2 ring-sky-400" : ""}`}
                style={{ backgroundColor: `${p.color}22`, color: p.color }}
              >
                📁 {p.name} · {count}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="mt-5 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={selected.name}
                onChange={(e) => void updateProject(selected.id, { name: e.target.value })}
                className="input py-1 text-sm font-semibold max-w-xs"
              />
              <div className="flex items-center gap-1">
                {["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#34d399", "#fb7185"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void updateProject(selected.id, { color: c })}
                    className={`h-5 w-5 rounded-full border transition-transform ${selected.color === c ? "scale-125 border-white ring-1 ring-white" : "border-transparent hover:scale-110"}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn-danger py-1 text-xs"
              onClick={() => {
                if (window.confirm(`¿Eliminar proyecto «${selected.name}»? Las tareas pasarán a no tener proyecto.`)) {
                  void deleteProject(selected.id);
                  selectProject(undefined);
                  pushToast(`Proyecto «${selected.name}» eliminado`);
                }
              }}
            >
              Eliminar proyecto
            </button>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-slate-400">Tareas de «{selected.name}»</h2>
          {(tasksByProject.get(selected.id) ?? []).length === 0 ? (
            <p className="py-2 text-xs text-slate-500">No hay tareas en este proyecto.</p>
          ) : (
            <ul className="space-y-2">
              {sortBySuggested(tasksByProject.get(selected.id) ?? []).map((t) => (
                <li key={t.id}>
                  <TaskItem task={t} showScore />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 pt-3 border-t border-slate-700/60">
            <button
              type="button"
              className="btn-ghost text-xs text-sky-400 w-full justify-center"
              onClick={() => openCapture(`#${selected.name.replace(/\s+/g, "-")} `)}
            >
              + Nueva tarea en {selected.name}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function randomColor(): string {
  const palette = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#34d399", "#fb7185"];
  return palette[Math.floor(Math.random() * palette.length)];
}
