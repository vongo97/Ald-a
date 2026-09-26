import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import TaskItem from "@/components/TaskItem";
import { overdueTasks } from "@/domain/deviation";
import { dayCapacity, formatMinutes } from "@/domain/capacity";
import { addDays, toISODate, startOfDay } from "@/domain/dateutils";

export default function ReviewView() {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);

  const today = toISODate(startOfDay(new Date()));
  const in7 = toISODate(addDays(startOfDay(new Date()), 7));

  const data = useMemo(() => {
    const tasks = allTasks ?? [];
    const done = tasks
      .filter((t) => t.status === "done" && t.completedAt && t.completedAt >= new Date(Date.now() - 7 * 86400_000).toISOString())
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    const overdue = overdueTasks(tasks);
    const noDate = tasks.filter((t) => t.status === "todo" && !t.dueDate && !t.parentId);
    const weekLoad = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === "todo" && t.dueDate && t.dueDate >= today && t.dueDate <= in7 && !t.parentId) {
        weekLoad.set(t.dueDate, (weekLoad.get(t.dueDate) ?? 0) + (t.durationMin ?? 45));
      }
    }
    return { done, overdue, noDate, weekLoad };
  }, [allTasks, today, in7]);

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3">
        <h1 className="text-xl font-bold">Revisión semanal</h1>
        <p className="text-xs text-slate-400 light:text-slate-500">Ritual de 10 minutos: despeja lo vencido, da fechas a lo sin fecha y mira la semana.</p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-300 light:text-emerald-600">✅ Completadas (7 días)</h2>
          <p className="text-2xl font-bold">{data.done.length}</p>
          <p className="text-xs text-slate-400 light:text-slate-500">Celebra el progreso.</p>
        </div>
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-rose-300 light:text-rose-600">⚠️ Vencidas</h2>
          <p className="text-2xl font-bold">{data.overdue.length}</p>
          <p className="text-xs text-slate-400 light:text-slate-500">Reprograma o elimina sin piedad.</p>
        </div>
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-sky-300 light:text-sky-600">📥 Sin fecha</h2>
          <p className="text-2xl font-bold">{data.noDate.length}</p>
          <p className="text-xs text-slate-400 light:text-slate-500">Dales fecha o suéltalas.</p>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-400 light:text-slate-500">Carga de los próximos 7 días</h2>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, i) => {
          const d = toISODate(addDays(startOfDay(new Date()), i));
          const min = data.weekLoad.get(d) ?? 0;
          const pct = Math.min(100, Math.round((min / 300) * 100));
          return (
            <div key={d} className="card flex-1 p-2 text-center" style={{ minWidth: 80 }}>
              <p className="text-[10px] text-slate-500">{d.slice(5)}</p>
              <div className="mx-auto mt-1 h-12 w-2.5 rounded-full bg-slate-700 light:bg-slate-200">
                <div className="w-full rounded-full bg-sky-400" style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-slate-400 light:text-slate-500">{formatMinutes(min)}</p>
            </div>
          );
        })}
      </div>

      {data.overdue.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-400 light:text-slate-500">Vencidas</h2>
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
          <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-400 light:text-slate-500">Sin fecha</h2>
          <ul className="space-y-2">
            {data.noDate.map((t) => (
              <li key={t.id}>
                <TaskItem task={t} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
