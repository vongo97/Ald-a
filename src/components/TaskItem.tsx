import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "@/store/useStore";
import { db } from "@/store/db";
import { toggleTask, deleteTask, addSubtask, updateTask } from "@/store/actions";
import { toggleWithUndo } from "@/store/useStore";
import { priorityScore } from "@/domain/priority";
import { formatLocalDate, parseISODate, toISODate, startOfDay } from "@/domain/dateutils";
import type { Task } from "@/domain/types";
import BreakdownButton from "./BreakdownButton";

export default function TaskItem({ task, showScore = false }: { task: Task; showScore?: boolean }) {
  const pushToast = useStoreToast();
  const [expanded, setExpanded] = useState(false);
  const [subtaskText, setSubtaskText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNotes, setEditNotes] = useState(task.notes ?? "");
  const [editDate, setEditDate] = useState(task.dueDate ?? "");
  const [editTime, setEditTime] = useState(task.dueTime ?? "");
  const [editDuration, setEditDuration] = useState<number | undefined>(task.durationMin);

  const subtasks = useLiveQuery(
    () => db.tasks.where("parentId").equals(task.id).sortBy("order"),
    [task.id],
    [],
  );

  const project = useLiveQuery(
    () => (task.projectId ? db.projects.get(task.projectId) : undefined),
    [task.projectId],
  );

  const done = task.status === "done";
  const score = showScore ? priorityScore(task) : null;
  const overdue = task.dueDate && task.status === "todo" && task.dueDate < toISODate(startOfDay(new Date()));

  const toggle = () => {
    void toggleWithUndo(task, toggleTask, pushToast);
  };

  return (
    <div className={`card px-3 py-2 ${done ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={toggle}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            done ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-500 hover:border-sky-400"
          }`}
          aria-label={done ? "Marcar como pendiente" : "Completar"}
        >
          {done && <span className="text-xs font-bold">✓</span>}
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            className={`block w-full text-left text-sm ${done ? "line-through" : ""}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {task.title}
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {task.dueDate && (
              <span className={`chip ${overdue ? "bg-rose-500/20 text-rose-300" : "bg-slate-700/70 text-slate-300"}`}>
                📅 {formatLocalDate(parseISODate(task.dueDate))}
                {task.dueTime ? ` · ${task.dueTime}` : ""}
              </span>
            )}
            {task.recurrence && <span className="chip bg-violet-500/20 text-violet-300">🔁</span>}
            {project && (
              <span className="chip" style={{ backgroundColor: `${project.color}33`, color: project.color }}>
                📁 {project.name}
              </span>
            )}
            {task.labels.map((l) => (
              <span key={l} className="chip bg-amber-500/20 text-amber-300">@{l}</span>
            ))}
            {task.durationMin && <span className="chip bg-slate-700/70 text-slate-300">⏱ {task.durationMin}m</span>}
            {score && (
              <span
                className="chip bg-sky-500/15 text-sky-300 cursor-help"
                title={score.reasons.length > 0 ? score.reasons.join(" · ") : `Score: ${score.score}`}
              >
                ★ {score.score}
              </span>
            )}
          </div>

          {expanded && (
            <div className="mt-2 border-t border-slate-700/60 pt-2">
              {score && score.reasons.length > 0 && (
                <div className="mb-2 rounded bg-sky-950/40 border border-sky-500/30 px-2 py-1 text-[11px] text-sky-300">
                  <span className="font-semibold">Motivo del score (★ {score.score}):</span>{" "}
                  {score.reasons.join(" · ")}
                </div>
              )}
              {editing ? (
                <div className="mb-3 space-y-2 rounded-lg bg-slate-900/60 p-3 text-xs">
                  <div>
                    <label className="mb-0.5 block text-slate-400">Título</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="input py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-slate-400">Notas</label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                      className="input py-1 text-xs"
                      placeholder="Notas adicionales..."
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-0.5 block text-slate-400">Fecha</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="input py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-slate-400">Hora</label>
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="input py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-slate-400">Duración (m)</label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={editDuration ?? ""}
                        onChange={(e) => setEditDuration(e.target.value ? Number(e.target.value) : undefined)}
                        className="input py-1 text-xs"
                        placeholder="min"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="btn-ghost py-1 text-xs"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateTask(task.id, {
                          title: editTitle.trim() || task.title,
                          notes: editNotes.trim() || undefined,
                          dueDate: editDate || undefined,
                          dueTime: editTime || undefined,
                          durationMin: editDuration,
                        });
                        setEditing(false);
                        pushToast("Tarea actualizada");
                      }}
                      className="btn-primary py-1 text-xs"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                task.notes && <p className="mb-2 text-xs text-slate-400">{task.notes}</p>
              )}
              {subtasks && subtasks.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {subtasks.map((st) => (
                    <li key={st.id} className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => void toggleWithUndo(st, toggleTask, pushToast)}
                        className={`h-3.5 w-3.5 rounded-full border ${st.status === "done" ? "border-emerald-400 bg-emerald-400" : "border-slate-500"}`}
                        aria-label="Completar subtarea"
                      />
                      <span className={st.status === "done" ? "line-through text-slate-500" : ""}>{st.title}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  value={subtaskText}
                  onChange={(e) => setSubtaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subtaskText.trim()) {
                      void addSubtask(task, subtaskText.trim());
                      setSubtaskText("");
                    }
                  }}
                  placeholder="Añadir subtarea + Enter"
                  className="input py-1 text-xs"
                />
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs"
                  onClick={() => {
                    setEditTitle(task.title);
                    setEditNotes(task.notes ?? "");
                    setEditDate(task.dueDate ?? "");
                    setEditTime(task.dueTime ?? "");
                    setEditDuration(task.durationMin);
                    setEditing((v) => !v);
                  }}
                >
                  {editing ? "Cerrar edición" : "✏️ Editar"}
                </button>
                <BreakdownButton task={task} />
                <button
                  type="button"
                  className="btn-danger py-1 text-xs"
                  onClick={() => {
                    void deleteTask(task.id);
                    pushToast("Tarea eliminada");
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function useStoreToast() {
  return useStore((s) => s.pushToast);
}
