import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "@/store/useStore";
import { db } from "@/store/db";
import { toggleTask, deleteTask, restoreTask, addSubtask, updateTask } from "@/store/actions";
import { toggleWithUndo } from "@/store/useStore";
import { priorityScore } from "@/domain/priority";
import { describeRecurrence } from "@/domain/recurrence";
import { propuestaDeDia } from "@/parsers/propuestaDia";
import { formatLocalDate, parseISODate, toISODate, startOfDay } from "@/domain/dateutils";
import type { RecurrenceSpec, Task } from "@/domain/types";
import BreakdownButton from "./BreakdownButton";
import SubtaskTimePanel from "./SubtaskTimePanel";

export default function TaskItem({ task, showScore = false }: { task: Task; showScore?: boolean }) {
  const pushToast = useStore((s) => s.pushToast);
  const [expanded, setExpanded] = useState(false);
  const [subtaskText, setSubtaskText] = useState("");
  // Id de la subtarea con el panel de horario abierto (una a la vez).
  const [timePanel, setTimePanel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNotes, setEditNotes] = useState(task.notes ?? "");
  const [editDate, setEditDate] = useState(task.dueDate ?? "");
  const [editTime, setEditTime] = useState(task.dueTime ?? "");
  const [editDuration, setEditDuration] = useState<number | undefined>(task.durationMin);
  // La recurrencia que se GUARDARÁ, no la que hay. Empieza siendo la misma, y
  // solo se separa si quien edita acepta el día que pide el título (abajo).
  const [editRecurrence, setEditRecurrence] = useState<RecurrenceSpec | undefined>(task.recurrence);

  // El título manda sobre el día… pero no a lo bruto. Si el texto nombra un día
  // que no es el de la tarea, se ofrece; no se aplica solo, porque corregir una
  // errata movería la fecha sin que nadie lo hubiera pedido.
  const propuesta = useMemo(
    () => (editing ? propuestaDeDia(editTitle, editRecurrence) : null),
    [editing, editTitle, editRecurrence],
  );
  const recurrenceCambiada =
    JSON.stringify(editRecurrence) !== JSON.stringify(task.recurrence);

  /**
   * Guardar y cerrar, en un sitio solo.
   *
   * Estaba en el `onClick` del botón y se ha movido aquí porque ahora también lo
   * llama el teclado. Dos copias de la misma escritura —con la lista de campos
   * dentro— son dos sitios donde se puede olvidar uno: el botón guardaría cinco
   * campos y Enter solo el título, sin que nadie lo viera hasta que una tarea
   * perdiera la fecha.
   */
  const guardar = async () => {
    await updateTask(task.id, {
      title: editTitle.trim() || task.title,
      notes: editNotes.trim() || undefined,
      dueDate: editDate || undefined,
      dueTime: editTime || undefined,
      durationMin: editDuration,
      recurrence: editRecurrence,
    });
    setEditing(false);
    pushToast("Tarea actualizada");
  };

  const subtasks = useLiveQuery(
    () =>
      db.tasks
        .where("parentId")
        .equals(task.id)
        .filter((s) => !s.deletedAt)
        .sortBy("order"),
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

  // Dispara la animación de partículas solo al completar (no en re-renders)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = useState(false);

  const toggle = () => {
    if (!done) {
      setBurst(true);
      if (burstTimer.current) clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(() => setBurst(false), 600);
    }
    void toggleWithUndo(task, toggleTask, pushToast);
  };

  return (
    <div className={`card task-card px-3 py-2 ${done ? "opacity-50 done" : ""}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={toggle}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
            burst ? "check-burst " : ""
          }${
            done
              ? "check-pop border-emerald-400 light:border-emerald-300 bg-emerald-400 text-slate-950 light:text-white"
              : "border-[var(--card-border)] hover:border-[var(--accent)] hover:scale-110"
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
              <span className={`chip ${overdue ? "bg-rose-500/20 light:bg-rose-100 text-rose-300 light:text-rose-600" : "bg-surface-hover text-primary"}`}>
                📅 {formatLocalDate(parseISODate(task.dueDate))}
                {task.dueTime ? ` · ${task.dueTime}` : ""}
              </span>
            )}
            {task.recurrence && (
              <span
                className="chip bg-violet-500/20 light:bg-violet-100 text-violet-300 light:text-violet-600"
                /* El icono solo era un «esto se repite» sin decir CUÁNDO, así
                   que renombrar la tarea a «los viernes» dejaba el calendario
                   diciendo otra cosa sin que nadie se enterara. El día es lo
                   que hay que poder ver para poder cambiarlo. */
                title={`Se repite: ${describeRecurrence(task.recurrence)}`}
              >
                🔁 {describeRecurrence(task.recurrence)}
              </span>
            )}
            {project && (
              <span className="chip" style={{ backgroundColor: `${project.color}33`, color: project.color }}>
                📁 {project.name}
              </span>
            )}
            {task.labels.map((l) => (
              <span key={l} className="chip bg-amber-500/20 light:bg-amber-100 text-amber-300 light:text-amber-700">@{l}</span>
            ))}
            {task.durationMin && <span className="chip bg-surface-hover text-primary">⏱ {task.durationMin}m</span>}
            {score && (
              <span
                /* `light:text-sky-600` sobre `light:bg-sky-50` se quedaba en
                   3,77:1. El 700 sube a 5,6:1 — el mismo remedy que
                   usan las demás chips semánticas. */
                className="chip bg-sky-500/15 light:bg-sky-50 text-sky-300 light:text-sky-700 cursor-help"
                title={score.reasons.length > 0 ? score.reasons.join(" · ") : `Score: ${score.score}`}
              >
                ★ {score.score}
              </span>
            )}
          </div>

          {expanded && (
            <div className="mt-2 border-t border-theme pt-2">
              {score && score.reasons.length > 0 && (
                <div className="mb-2 rounded bg-sky-950/40 light:bg-sky-50 border border-sky-500/30 light:border-sky-200 px-2 py-1 text-[11px] text-sky-300 light:text-sky-600">
                  <span className="font-semibold">Motivo del score (★ {score.score}):</span>{" "}
                  {score.reasons.join(" · ")}
                </div>
              )}
              {editing ? (
                <div
                  className="mb-3 space-y-2 rounded-lg bg-surface p-3 text-xs"
                  onKeyDown={(e) => {
                    // Escape cierra y descarta, como en CaptureModal,
                    // BreakdownModal, OverdueRescheduleModal, SyncIndicator y
                    // ProfileQuestionnaire. Son cinco contra uno: este panel era
                    // el único sitio de la app donde la tecla no hacía nada.
                    //
                    // Va en el contenedor y no en cada campo para que salga igual
                    // desde el título, las notas, la fecha, la hora o la duración,
                    // que es lo que hace un diálogo. Aquí es lo contrario: es
                    // edición EN DIRECTO, no una puerta que cruzar, y por eso
                    // guardar es Enter y cerrar es Escape —las dos cosas que ya
                    // se esperaban, una en cada tecla.
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(false);
                    }
                  }}
                >
                  <div>
                    <label htmlFor="edit-titulo" className="mb-0.5 block text-muted">Título</label>
                    <input
                      id="edit-titulo"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        // Solo aquí, y no en el panel entero: las notas son un
                        // `textarea`, y ahí Enter tiene que seguir siendo un
                        // salto de línea. Ponerlo en el contenedor habría hecho
                        // que no se pudiera escribir una nota de dos líneas.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void guardar();
                        }
                      }}
                      className="input py-1 text-xs"
                    />
                    {propuesta && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-violet-500/40 light:border-violet-300 bg-violet-500/10 light:bg-violet-50 px-2 py-1 text-[11px] text-violet-200 light:text-violet-700">
                        <span>
                          Has escrito <strong className="font-semibold">{propuesta.texto}</strong>
                          {propuesta.esNueva
                            ? " y esta tarea no se repite."
                            : ` y ahora se repite ${describeRecurrence(task.recurrence!)}.`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditRecurrence(propuesta.spec)}
                          className="chip shrink-0 bg-violet-500/30 light:bg-violet-200 light:text-violet-900 hover:opacity-80"
                        >
                          {/* Con `weekdays` vacíos (un día del mes) el texto del botón
                              era «Cambiar a » a secas. Se usa lo que dice el propio
                              título, que es lo que se va a guardar. */}
                          {propuesta.esNueva
                            ? "Hacerla recurrente"
                            : `Cambiar a ${propuesta.texto}`}
                        </button>
                      </div>
                    )}
                    {!propuesta && recurrenceCambiada && editRecurrence && (
                      <p className="mt-1 text-[11px] text-muted">
                        🔁 Se repetirá {describeRecurrence(editRecurrence)}.
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="edit-notas" className="mb-0.5 block text-muted">Notas</label>
                    <textarea
                      id="edit-notas"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                      className="input py-1 text-xs"
                      placeholder="Notas adicionales..."
                    />
                  </div>
                  {/* 2 columnas en móvil: con 3, cada una quedaba en 81.6px y
                      el input de fecha se cortaba mostrando solo "26/09/". */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <label htmlFor="edit-fecha" className="mb-0.5 block text-muted">Fecha</label>
                      <input
                        id="edit-fecha"
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="input py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-hora" className="mb-0.5 block text-muted">Hora</label>
                      <input
                        id="edit-hora"
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="input py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-duracion" className="mb-0.5 block text-muted">Duración (m)</label>
                      <input
                        id="edit-duracion"
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
                      onClick={() => void guardar()}
                      className="btn-primary py-1 text-xs"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                task.notes && <p className="mb-2 text-xs text-muted">{task.notes}</p>
              )}
              {subtasks && subtasks.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {subtasks.map((st) => (
                    <li key={st.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleWithUndo(st, toggleTask, pushToast)}
                          className={`h-3.5 w-3.5 shrink-0 rounded-full border ${st.status === "done" ? "border-emerald-400 light:border-emerald-300 bg-emerald-400" : "border-theme"}`}
                          aria-label="Completar subtarea"
                        />
                        <span
                          className={`min-w-0 flex-1 truncate ${st.status === "done" ? "line-through text-muted" : ""}`}
                        >
                          {st.title}
                        </span>
                        {/* Panel de horario: duración y bloque de cada subtarea */}
                        <button
                          type="button"
                          onClick={() => setTimePanel((v) => (v === st.id ? null : st.id))}
                          className="chip shrink-0 bg-surface-hover text-primary hover:opacity-75"
                          title="Editar horario de la subtarea"
                          aria-label="Editar horario de la subtarea"
                          aria-expanded={timePanel === st.id}
                        >
                          {st.timeBlock
                            ? `🕒 ${st.timeBlock.start}–${st.timeBlock.end}`
                            : st.durationMin
                              ? `⏱ ${st.durationMin}m`
                              : "🕒 Horario"}
                        </button>
                      </div>
                      {timePanel === st.id && (
                        <SubtaskTimePanel
                          task={st}
                          parentDueDate={task.dueDate}
                          onClose={() => setTimePanel(null)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {/* flex-wrap: con nowrap los 4 hijos se estrujaban en pantallas
                  de 390px (el input quedaba en 55px mostrando solo "Añà" y los
                  botones saltaban a 4 líneas con 58px de alto). En móvil el
                  input ocupa su propia línea y los 3 botones caben en la
                  siguiente; desde sm comparten fila como antes. */}
              <div className="flex flex-wrap gap-2">
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
                  className="input w-full py-1 text-xs sm:w-auto sm:flex-1"
                />
                {/* Mientras el panel está abierto, este botón no existe.
                    *
                    * Antes era un interruptor: decía «Cerrar edición» y cerraba
                    * tirando lo escrito, sin preguntar. Con el panel abierto encima
                    * y su «Cancelar» a treinta píxeles, era la única forma de
                    * perder trabajo de un toque sin haber mirado los dos botones
                    * que lo hacen a propósito. En el móvil, que es donde se
                    * edita de verdad, es un tap en la fila equivocada.
                    *
                    * No se sustituye por una ventana de «¿descartar?». Un
                    * diálogo en el botón de cerrar enseña a descartar sin leer, y
                    * ese hábito es lo que vuelve peligroso un diálogo el día que
                    * sí importa, como borrar una tarea de verdad.
                    *
                    * De paso, en móvil quedan tres hijos en la fila de botones en
                    * vez de cuatro, que es lo que ya decía el comentario
                    * de arriba del div. */}
                {!editing && (
                  <button
                    type="button"
                    className="btn-ghost py-1 text-xs"
                    onClick={() => {
                      setEditTitle(task.title);
                      setEditNotes(task.notes ?? "");
                      setEditDate(task.dueDate ?? "");
                      setEditTime(task.dueTime ?? "");
                      setEditDuration(task.durationMin);
                      setEditRecurrence(task.recurrence);
                      setEditing(true);
                    }}
                  >
                    ✏️ Editar
                  </button>
                )}
                <BreakdownButton task={task} />
                <button
                  type="button"
                  className="btn-danger py-1 text-xs"
                  onClick={() => {
                    void deleteTask(task.id);
                    // Con deshacer: recupera la tarea y sus subtareas de golpe.
                    pushToast("Tarea eliminada", () => {
                      void restoreTask(task.id);
                    });
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
