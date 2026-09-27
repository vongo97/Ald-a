import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import TaskItem from "@/components/TaskItem";
import { overdueTasks } from "@/domain/deviation";
import { dayCapacity, formatMinutes } from "@/domain/capacity";
import { deletedRoots } from "@/domain/trash";
import { addDays, toISODate, startOfDay } from "@/domain/dateutils";
import { restoreTask } from "@/store/actions";
import { useStore } from "@/store/useStore";
import type { Task } from "@/domain/types";

export default function ReviewView() {
  const pushToast = useStore((s) => s.pushToast);
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  const today = toISODate(startOfDay(new Date()));
  const in7 = toISODate(addDays(startOfDay(new Date()), 7));

  const data = useMemo(() => {
    const tasks = (allTasks ?? []).filter((t) => !t.deletedAt);
    const done = tasks
      .filter((t) => t.status === "done" && t.completedAt && t.completedAt >= new Date(Date.now() - 7 * 86400_000).toISOString())
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    const overdue = overdueTasks(tasks);
    const noDate = tasks.filter((t) => t.status === "todo" && !t.dueDate && !t.parentId);
    const weekLoad = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === "todo" && t.dueDate && t.dueDate >= today && t.dueDate <= in7 && !t.parentId && !t.deletedAt) {
        weekLoad.set(t.dueDate, (weekLoad.get(t.dueDate) ?? 0) + (t.durationMin ?? 45));
      }
    }
    return { done, overdue, noDate, weekLoad };
  }, [allTasks, today, in7]);

  // 🗑️ Papelera: borradas (soft delete), agrupadas por rama y con su recuento
  // de subtareas borradas para que restaurar una raíz se entienda de un vistazo.
  const trash = useMemo(() => {
    const all = allTasks ?? [];
    const kids = new Map<string, Task[]>();
    for (const t of all) {
      if (!t.parentId) continue;
      const arr = kids.get(t.parentId);
      if (arr) arr.push(t);
      else kids.set(t.parentId, [t]);
    }
    const countDeletedDesc = (id: string): number => {
      let n = 0;
      for (const c of kids.get(id) ?? []) {
        if (c.deletedAt) n += 1 + countDeletedDesc(c.id);
      }
      return n;
    };
    return deletedRoots(all)
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
      .map((task) => ({ task, subtasks: countDeletedDesc(task.id) }));
  }, [allTasks]);

  const restoreOne = (id: string) => {
    void restoreTask(id).then(() => pushToast("Tarea restaurada"));
  };

  const restoreAll = () => {
    void (async () => {
      for (const { task } of trash) await restoreTask(task.id);
      pushToast(
        `${trash.length} elemento${trash.length === 1 ? "" : "s"} restaurado${trash.length === 1 ? "" : "s"}`,
      );
    })();
  };

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3">
        <h1 className="font-display text-2xl font-semibold">Revisión semanal</h1>
        <p className="text-xs text-muted">Ritual de 10 minutos: despeja lo vencido, da fechas a lo sin fecha y mira la semana.</p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-300 light:text-emerald-600">✅ Completadas (7 días)</h2>
          <p className="text-2xl font-bold">{data.done.length}</p>
          <p className="text-xs text-muted">Celebra el progreso.</p>
        </div>
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-rose-300 light:text-rose-600">⚠️ Vencidas</h2>
          <p className="text-2xl font-bold">{data.overdue.length}</p>
          <p className="text-xs text-muted">Reprograma o elimina sin piedad.</p>
        </div>
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-sky-300 light:text-sky-600">📥 Sin fecha</h2>
          <p className="text-2xl font-bold">{data.noDate.length}</p>
          <p className="text-xs text-muted">Dales fecha o suéltalas.</p>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-muted">Carga de los próximos 7 días</h2>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, i) => {
          const d = toISODate(addDays(startOfDay(new Date()), i));
          const min = data.weekLoad.get(d) ?? 0;
          const pct = Math.min(100, Math.round((min / 300) * 100));
          return (
            <div key={d} className="card flex-1 p-2 text-center" style={{ minWidth: 80 }}>
              <p className="text-xs text-muted">{d.slice(5)}</p>
              <div className="mx-auto mt-1 h-12 w-2.5 rounded-full bg-surface-hover">
                <div className="w-full rounded-full bg-sky-400" style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{formatMinutes(min)}</p>
            </div>
          );
        })}
      </div>

      {data.overdue.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-sm font-semibold text-muted">Vencidas</h2>
          <ul className="space-y-2">
            {data.overdue.map((t) => (
              <li key={t.id}>
                <TaskItem task={t} />
              </li>
            ))}
          </ul>
        </>
      )}

      {data.noDate.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-sm font-semibold text-muted">Sin fecha</h2>
          <ul className="space-y-2">
            {data.noDate.map((t) => (
              <li key={t.id}>
                <TaskItem task={t} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mb-2 mt-6 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">🗑️ Papelera</h2>
        {trash.length > 1 && (
          <button type="button" className="btn-ghost text-xs" onClick={restoreAll}>
            ♻️ Restaurar todo
          </button>
        )}
      </div>
      {trash.length === 0 ? (
        <p className="text-xs text-muted">Vacía: no has borrado nada (o ya lo restauraste).</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            Borradas con borrado suave: siguen aquí y se pueden recuperar. Restaurar una rama devuelve también sus
            subtareas.
          </p>
          <ul className="space-y-2">
            {trash.map(({ task, subtasks }) => (
              <li key={task.id} className="card flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-primary">{task.title}</p>
                  <p className="text-xs text-muted">
                    borrada {(task.deletedAt ?? "").slice(0, 10)}
                    {subtasks > 0 ? ` · +${subtasks} subtarea${subtasks === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary shrink-0 text-xs"
                  onClick={() => restoreOne(task.id)}
                >
                  ♻️ Restaurar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
