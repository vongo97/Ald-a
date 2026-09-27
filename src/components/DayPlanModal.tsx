import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { db, newId } from "@/store/db";
import { autoPushTasks } from "@/store/sync";
import { parseDayPlan, type PlannedTask } from "@/llm/planParser";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { Task } from "@/domain/types";

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

  /** Actualiza una tarea por camino de índices [i] o [i, childIdx]. */
  const updateAt = (path: number[], changes: Partial<PlannedTask>) => {
    setTasks((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as PlannedTask[];
      if (path.length === 1) {
        next[path[0]] = { ...next[path[0]], ...changes };
      } else if (path.length === 2) {
        const parent = next[path[0]];
        if (parent.children) {
          parent.children[path[1]] = { ...parent.children[path[1]], ...changes };
        }
      }
      return next;
    });
  };

  const removeAt = (path: number[]) => {
    setTasks((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as PlannedTask[];
      if (path.length === 1) {
        next.splice(path[0], 1);
      } else if (path.length === 2) {
        const parent = next[path[0]];
        if (parent.children) parent.children.splice(path[1], 1);
      }
      return next;
    });
  };

  const addChild = (parentIdx: number) => {
    setTasks((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as PlannedTask[];
      if (!next[parentIdx].children) next[parentIdx].children = [];
      next[parentIdx].children!.push({
        title: "",
        start: next[parentIdx].start ?? "09:00",
        end: next[parentIdx].end ?? "10:00",
        labels: [],
      });
      return next;
    });
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

      // 1. Crear tarea padre "Plan del día" (sin timeBlock)
      const planId = newId();
      const planTask: Task = {
        id: planId,
        title: `Plan del día — ${planDate}`,
        labels: ["plan"],
        dueDate: planDate,
        priority: 3,
        importance: 3,
        status: "todo",
        order,
        createdAt: now,
      };

      // 2. Crear subtareas (cada actividad con timeBlock)
      const all: Task[] = [planTask];
      let subOrder = 0;

      for (const t of valid) {
        const subId = newId();
        const sub: Task = {
          id: subId,
          title: t.title.trim(),
          labels: t.labels,
          dueDate: planDate,
          parentId: planId,
          priority: 3,
          importance: 3,
          status: "todo",
          order: subOrder++,
          createdAt: now,
          ...(t.start && t.end
            ? {
                timeBlock: { start: t.start, end: t.end },
                durationMin: timeToMin(t.end) - timeToMin(t.start),
              }
            : {}),
        };
        all.push(sub);

        // 3. Crear sub-subtareas (children)
        if (t.children) {
          let childOrder = 0;
          for (const c of t.children) {
            if (!c.title.trim()) continue;
            all.push({
              id: newId(),
              title: c.title.trim(),
              labels: c.labels,
              dueDate: planDate,
              parentId: subId,
              priority: 3,
              importance: 3,
              status: "todo",
              order: childOrder++,
              createdAt: now,
              ...(c.start && c.end
                ? {
                    timeBlock: { start: c.start, end: c.end },
                    durationMin: timeToMin(c.end) - timeToMin(c.start),
                  }
                : {}),
            });
          }
        }
      }

      await db.tasks.bulkPut(all);
      void autoPushTasks(all);
      const count = valid.length;
      pushToast(`Plan confirmado: ${count} actividad${count !== 1 ? "es" : ""} para el ${planDate}`);
      onClose();
    } catch (err) {
      pushToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Renderiza una fila de actividad (con soporte para hijos). */
  const renderTask = (task: PlannedTask, path: number[], depth: number = 0) => {
    const isChild = depth > 0;
    return (
      <li key={path.join("-")}>
        <div
          className={`flex items-center gap-2 rounded-lg border border-theme bg-surface px-2.5 py-2 ${
            isChild ? "ml-6 border-l-2" : ""
          }`}
          style={isChild ? { borderLeftColor: "var(--accent)" } : undefined}
        >
          {task.start && task.end && (
            <>
              <input
                type="time"
                value={task.start}
                onChange={(e) => updateAt(path, { start: e.target.value })}
                className="input w-24 px-1.5 py-1 text-xs"
                aria-label="Hora inicio"
              />
              <span className="text-xs text-muted">—</span>
              <input
                type="time"
                value={task.end}
                onChange={(e) => updateAt(path, { end: e.target.value })}
                className="input w-24 px-1.5 py-1 text-xs"
                aria-label="Hora fin"
              />
            </>
          )}
          <input
            type="text"
            value={task.title}
            onChange={(e) => updateAt(path, { title: e.target.value })}
            placeholder="Nombre de la actividad"
            className={`input px-2 py-1 ${isChild ? "text-xs" : "text-sm"} flex-1`}
            aria-label="Título"
          />
          {task.labels.length > 0 && (
            <span className="chip bg-surface-hover text-muted text-xs shrink-0">
              {task.labels.map((l) => `@${l}`).join(" ")}
            </span>
          )}
          {task.reason && (
            <span
              className="text-xs text-muted italic shrink-0 max-w-24 truncate hidden sm:block"
              title={task.reason}
            >
              {task.reason}
            </span>
          )}
          {!isChild && (
            <button
              type="button"
              onClick={() => addChild(path[0])}
              className="text-muted hover:text-accent shrink-0 text-xs px-1"
              title="Añadir subtarea"
              aria-label="Añadir subtarea"
            >
              +
            </button>
          )}
          <button
            type="button"
            onClick={() => removeAt(path)}
            className="text-muted hover:text-rose-400 shrink-0 text-sm px-1"
            aria-label="Eliminar"
          >
            ×
          </button>
        </div>

        {/* Subtareas anidadas */}
        {task.children && task.children.length > 0 && (
          <ul className="mt-1 space-y-1">
            {task.children.map((child, ci) => renderTask(child, [...path, ci], depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const totalActivities = tasks.reduce((sum, t) => sum + 1 + (t.children?.length ?? 0), 0);

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
          <h2 className="font-display text-lg font-semibold">✨ Planificar día</h2>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void analyze();
                }
              }}
            />
            {error && (
              <p className="mt-2 text-sm text-rose-400 light:text-rose-600">{error}</p>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Enter para analizar · Esc para cerrar</span>
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
                style={{ background: "var(--accent)", animation: "pulse 1.5s ease-in-out infinite" }}
              />
            </div>
          </div>
        )}

        {/* ── Fase 3: Revisión ── */}
        {phase === "review" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted">
                📅 {planDate} · {totalActivities} actividad{totalActivities !== 1 ? "es" : ""}
              </span>
              <span className="text-xs text-muted">Edita, elimina o añade</span>
            </div>

            {warning && (
              <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 light:text-amber-700">
                ⚠️ {warning}
              </div>
            )}

            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {tasks.map((task, i) => renderTask(task, [i]))}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={addTask} className="btn-ghost text-xs">
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
