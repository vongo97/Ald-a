import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { db, newId } from "@/store/db";
import { autoPushTasks } from "@/store/sync";
import { parseDayPlan, type PlannedTask } from "@/llm/planParser";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface DayPlanModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "input" | "loading" | "review";

export default function DayPlanModal({ open, onClose }: DayPlanModalProps) {
  const pushToast = useStore((s) => s.pushToast);
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<PlannedTask[]>([]);
  const [planDate, setPlanDate] = useState<string>(toISODate(startOfDay(new Date())));
  const [warning, setWarning] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>(open, onClose);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setPhase("input");
      setText("");
      setTasks([]);
      setWarning(undefined);
      setError(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const analyze = async () => {
    if (!text.trim()) return;
    if (!settings.apiKey.trim()) {
      pushToast("Configura tu clave de IA en Ajustes para planificar con IA");
      return;
    }
    setPhase("loading");
    setError(null);
    try {
      const refDate = toISODate(startOfDay(new Date()));
      // Tareas existentes para contexto de solapamiento
      const existing = (await db.tasks.where("dueDate").equals(refDate).toArray())
        .filter((t) => !t.deletedAt && t.status === "todo");

      const res = await parseDayPlan({ settings }, text, refDate, existing);
      if (!res.ok || !res.data) {
        setError(res.error ?? "No se pudo analizar el texto");
        setPhase("input");
        return;
      }
      setTasks(res.data.tasks);
      setPlanDate(res.data.date);
      setWarning(res.data.warning);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("input");
    }
  };

  const updateTask = (index: number, changes: Partial<PlannedTask>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...changes } : t)));
  };

  const removeTask = (index: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== index));
  };

  const addTask = () => {
    setTasks((prev) => [
      ...prev,
      { title: "", start: "09:00", end: "10:00", labels: [], reason: undefined },
    ]);
  };

  const confirm = async () => {
    const valid = tasks.filter((t) => t.title.trim());
    if (valid.length === 0) {
      pushToast("No hay tareas válidas para crear");
      return;
    }

    try {
      const order = (await db.tasks.where("status").equals("todo").count()) || 0;
      const now = new Date().toISOString();
      const created = valid.map((t, i) => ({
        id: newId(),
        title: t.title.trim(),
        labels: t.labels,
        dueDate: planDate,
        priority: 3 as const,
        importance: 3 as const,
        status: "todo" as const,
        order: order + i,
        createdAt: now,
        timeBlock: { start: t.start, end: t.end },
        durationMin: timeToMin(t.end) - timeToMin(t.start),
      }));

      await db.tasks.bulkPut(created);
      void autoPushTasks(created);
      pushToast(`Plan confirmado: ${created.length} tareas creadas para el ${planDate}`);
      onClose();
    } catch (err) {
      pushToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="card w-full max-w-2xl p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Planificar día con IA"
      >
        {/* ── Header ── */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            ✨ Planificar día
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-primary text-lg leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* ── Fase 1: Input ── */}
        {phase === "input" && (
          <div>
            <p className="mb-2 text-sm text-muted">
              Describe tu día en lenguaje natural. La IA detectará actividades, horarios y etiquetas.
            </p>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Ejemplo:\nmañana voy hacer mi rutina de domingo:\npaseo a mis perros\ntrotar\nmeditar\nleer\ntrabajar en @aldia\nhacer ejercicio"}
              className="input min-h-32 resize-y text-sm"
              aria-label="Describe tu día"
            />
            {error && (
              <p className="mt-2 text-sm text-rose-400 light:text-rose-600">{error}</p>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">
                Enter para analizar · Esc para cerrar
              </span>
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={!text.trim()}
                className="btn-primary text-sm"
              >
                🔮 Analizar día
              </button>
            </div>
          </div>
        )}

        {/* ── Fase 2: Cargando ── */}
        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="text-2xl">🔮</div>
            <p className="text-sm text-muted">Analizando tu día y optimizando horarios...</p>
            <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full w-1/2 rounded-full"
                style={{
                  background: "var(--accent)",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        )}

        {/* ── Fase 3: Revisión ── */}
        {phase === "review" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted">
                📅 {planDate} · {tasks.length} actividad{tasks.length !== 1 ? "es" : ""}
              </span>
              <span className="text-xs text-muted">Edita, elimina o añade</span>
            </div>

            {warning && (
              <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 light:text-amber-700">
                ⚠️ {warning}
              </div>
            )}

            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {tasks.map((task, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-theme bg-surface px-2.5 py-2"
                >
                  {/* Hora inicio */}
                  <input
                    type="time"
                    value={task.start}
                    onChange={(e) => updateTask(i, { start: e.target.value })}
                    className="input w-24 px-1.5 py-1 text-xs"
                    aria-label="Hora inicio"
                  />
                  <span className="text-xs text-muted">—</span>
                  {/* Hora fin */}
                  <input
                    type="time"
                    value={task.end}
                    onChange={(e) => updateTask(i, { end: e.target.value })}
                    className="input w-24 px-1.5 py-1 text-xs"
                    aria-label="Hora fin"
                  />
                  {/* Título */}
                  <input
                    type="text"
                    value={task.title}
                    onChange={(e) => updateTask(i, { title: e.target.value })}
                    placeholder="Nombre de la actividad"
                    className="input flex-1 px-2 py-1 text-sm"
                    aria-label="Título"
                  />
                  {/* Labels */}
                  {task.labels.length > 0 && (
                    <span className="chip bg-surface-hover text-muted text-xs shrink-0">
                      {task.labels.map((l) => `@${l}`).join(" ")}
                    </span>
                  )}
                  {/* Razón */}
                  {task.reason && (
                    <span
                      className="text-xs text-muted italic shrink-0 max-w-24 truncate"
                      title={task.reason}
                    >
                      {task.reason}
                    </span>
                  )}
                  {/* Eliminar */}
                  <button
                    type="button"
                    onClick={() => removeTask(i)}
                    className="text-muted hover:text-rose-400 shrink-0 text-sm px-1"
                    aria-label="Eliminar"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={addTask}
                className="btn-ghost text-xs"
              >
                + Añadir actividad
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("input")}
                  className="btn-ghost text-xs"
                >
                  ← Reescribir
                </button>
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={tasks.filter((t) => t.title.trim()).length === 0}
                  className="btn-primary text-sm"
                >
                  ✅ Confirmar plan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
