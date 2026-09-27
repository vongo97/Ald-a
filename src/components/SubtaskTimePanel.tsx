import { useState } from "react";
import { updateTask } from "@/store/actions";
import { useStore } from "@/store/useStore";
import { resolveSchedule } from "@/domain/schedule";
import type { Task } from "@/domain/types";

/**
 * Panel de horario de una subtarea: duración + bloque Desde—Hasta.
 *
 * Se despliega bajo la fila desde `TaskItem` (botón 🕒 de cada subtarea).
 * Reglas de guardado en `domain/schedule.ts`; aquí solo inputs y feedback.
 */
export default function SubtaskTimePanel({
  task,
  parentDueDate,
  onClose,
}: {
  task: Task;
  /** Fecha del padre: si la subtarea no tiene, al bloquearla se la hereda
      (así el bloque aparece en la vista «Día», igual que los hijos del
      Plan del día creados por DayPlanModal). */
  parentDueDate?: string;
  onClose: () => void;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const [start, setStart] = useState(task.timeBlock?.start ?? "");
  const [end, setEnd] = useState(task.timeBlock?.end ?? "");
  const [duration, setDuration] = useState(task.durationMin ? String(task.durationMin) : "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const res = resolveSchedule({ start, end, duration });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await updateTask(task.id, {
      ...res.changes,
      // Hereda la fecha del padre solo si bloquea horario y no tiene fecha.
      ...(res.changes.timeBlock && !task.dueDate && parentDueDate
        ? { dueDate: parentDueDate }
        : {}),
    });
    pushToast("Horario de la subtarea actualizado");
    onClose();
  };

  return (
    <form
      className="mt-1 mb-1 rounded-lg bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <div>
          <label className="mb-0.5 block text-muted">Duración (min)</label>
          <input
            type="number"
            min="0"
            step="5"
            inputMode="numeric"
            value={duration}
            onChange={(e) => {
              setDuration(e.target.value);
              setError(null);
            }}
            className="input w-20 py-1 text-xs"
            placeholder="30"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-muted">Desde</label>
          <input
            type="time"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setError(null);
            }}
            className="input w-24 py-1 text-xs"
            aria-label="Hora inicio"
          />
        </div>
        <span className="pb-2 text-muted" aria-hidden>
          —
        </span>
        <div>
          <label className="mb-0.5 block text-muted">Hasta</label>
          <input
            type="time"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setError(null);
            }}
            className="input w-24 py-1 text-xs"
            aria-label="Hora fin"
          />
        </div>
        <div className="ml-auto flex gap-2 pb-0.5">
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary py-1 text-xs">
            Guardar
          </button>
        </div>
      </div>
      <p
        className={`mt-1.5 text-[11px] ${
          error ? "text-rose-400 light:text-rose-600" : "text-muted"
        }`}
        role={error ? "alert" : undefined}
      >
        {error ??
          "Con las dos horas se calcula la duración sola; sin horas, solo se guarda la duración."}
      </p>
    </form>
  );
}
