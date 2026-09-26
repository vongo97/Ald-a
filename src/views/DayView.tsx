import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { updateTask } from "@/store/actions";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { draftDayPlan } from "@/llm/tasks";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { useTimeBlockAlerts } from "@/notifications/useTimeBlockAlerts";
import type { Task } from "@/domain/types";

const START_H = 7;
const END_H = 22;
const PX_PER_H = 56;

export default function DayView() {
  const pushToast = useStore((s) => s.pushToast);
  const { settings } = useSettings();
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const [selected, setSelected] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const today = toISODate(startOfDay(new Date()));
  const tasks = useMemo(() => (allTasks ?? []).filter((t) => t.dueDate === today && t.status === "todo"), [allTasks, today]);

  const unscheduled = tasks.filter((t) => !t.timeBlock);
  const scheduled = tasks.filter((t) => t.timeBlock);

  // Programar alertas nativas para cada bloque del día
  useTimeBlockAlerts(scheduled);

  const minutesToY = (min: number) => ((min - START_H * 60) / 60) * PX_PER_H;

  const autoPlan = async () => {
    if (unscheduled.length === 0) {
      pushToast("No hay tareas sin bloquear para hoy");
      return;
    }
    if (!settings.apiKey.trim()) {
      pushToast("Configura tu clave de IA en Ajustes para planificar con IA");
      return;
    }
    setPlanning(true);
    try {
      const res = await draftDayPlan({ settings }, unscheduled);
      if (!res.ok || !res.data || res.data.length === 0) {
        pushToast(`No se pudo generar el plan: ${res.error ?? "Sin respuesta válida"}`);
        return;
      }
      let applied = 0;
      for (const item of res.data) {
        let targetId = item.taskId;
        if (!targetId || !unscheduled.some((u) => u.id === targetId)) {
          const match = unscheduled.find((u) =>
            u.title.toLowerCase().includes(item.title.toLowerCase()) ||
            item.title.toLowerCase().includes(u.title.toLowerCase()),
          );
          if (match) targetId = match.id;
        }
        if (targetId) {
          await updateTask(targetId, { timeBlock: { start: item.start, end: item.end } });
          applied++;
        }
      }
      pushToast(`Plan aplicado: ${applied} bloques horarios asignados`);
    } catch (err) {
      pushToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPlanning(false);
    }
  };

  const onGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selected) return;
    const grid = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - grid.top;
    const totalMin = START_H * 60 + (y / PX_PER_H) * 60;
    const snapped = Math.round(totalMin / 15) * 15;
    const hour = Math.floor(snapped / 60);
    const minute = snapped % 60;
    const start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const task = tasks.find((t) => t.id === selected);
    if (!task) return;
    const dur = task.durationMin ?? 45;
    const endMin = Math.min(snapped + dur, END_H * 60);
    const endHour = Math.floor(endMin / 60);
    const endMinute = endMin % 60;
    const end = `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
    void updateTask(task.id, { timeBlock: { start, end } }).then(() => {
      pushToast(`«${task.title.slice(0, 24)}…» bloqueada ${start}–${end}`);
      setSelected(null);
    });
    e.stopPropagation();
  };

  if (!allTasks || !projects) return null;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Día</h1>
          <span className="text-xs text-slate-400 light:text-slate-500">
            {selected ? "Elige la hora de inicio en la rejilla…" : "Selecciona una tarea y haz clic en la rejilla"}
          </span>
        </div>
        <button
          type="button"
          disabled={planning || unscheduled.length === 0}
          onClick={() => void autoPlan()}
          className="btn-primary text-xs"
          title="Construye un borrador de bloques horarios con IA para las tareas de hoy"
        >
          {planning ? "Planificando..." : "✨ Planificar día (IA)"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-400 light:text-slate-500">Sin bloquear</h2>
          {unscheduled.length === 0 ? (
            <p className="text-xs text-slate-500">Todo bloqueado 🎉</p>
          ) : (
            <ul className="space-y-2">
              {unscheduled.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(selected === t.id ? null : t.id)}
                    className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      selected === t.id
                        ? "border-sky-400 light:border-sky-500 bg-sky-500/10 light:bg-sky-50 text-sky-200 light:text-sky-700"
                        : "border-slate-700/60 light:border-slate-200 bg-slate-800/60 light:bg-white text-slate-200 light:text-slate-800 hover:border-slate-500 hover:light:border-slate-300"
                    }`}
                  >
                    {t.title}
                    {t.durationMin ? <span className="ml-2 text-xs text-slate-500">⏱ {t.durationMin}m</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="md:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-400 light:text-slate-500">Rejilla del día</h2>
          <div
            className="relative rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-white"
            style={{ height: (END_H - START_H) * PX_PER_H }}
            onClick={onGridClick}
            role="presentation"
          >
            {Array.from({ length: END_H - START_H }, (_, i) => (
              <div
                key={i}
                className="absolute inset-x-0 border-t border-slate-700/40 light:border-slate-200 text-[10px] text-slate-500"
                style={{ top: i * PX_PER_H }}
              >
                <span className="absolute left-1 -top-2 bg-slate-900/80 light:bg-white px-1">{String(START_H + i).padStart(2, "0")}:00</span>
              </div>
            ))}
            {scheduled.map((t) => {
              const start = t.timeBlock!.start;
              const end = t.timeBlock!.end;
              const toMin = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
              const top = minutesToY(toMin(start));
              const height = Math.max(24, ((toMin(end) - toMin(start)) / 60) * PX_PER_H);
              const proj = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined;
              const border = proj ? `${proj.color}77` : "rgba(56, 189, 248, 0.4)";
              const bg = proj ? `${proj.color}22` : "rgba(14, 165, 233, 0.15)";
              const text = proj ? proj.color : "#bae6fd";
              return (
                <div
                  key={t.id}
                  className="absolute inset-x-2 rounded-lg border px-2 py-1 text-xs transition-shadow hover:shadow-md"
                  style={{ top, height, borderColor: border, backgroundColor: bg, color: text }}
                >
                  <span className="line-clamp-2 font-medium">{t.title}</span>
                  <span className="text-[10px] opacity-80">{start}–{end}</span>
                </div>
              );
            })}
          </div>
          {scheduled.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-400 light:text-slate-500">
              {scheduled.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">• {t.title}</span>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-rose-300 hover:light:text-rose-600"
                    onClick={() => void updateTask(t.id, { timeBlock: undefined })}
                  >
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
