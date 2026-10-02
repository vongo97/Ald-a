import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { createTaskFromCapture, addSubtasks } from "@/store/actions";
import { loadProfile } from "@/store/profile";
import { parseCapture, stripDayCommands, isDayCommandWord, type ParsedCapture } from "@/parsers/capture";
import { improveCapture, type CaptureSubtask } from "@/llm/tasks";
import type { Priority } from "@/domain/types";
import { describeRecurrence } from "@/domain/recurrence";
import { formatLocalDate, parseISODate } from "@/domain/dateutils";
import { useDialogA11y } from "@/hooks/useDialogA11y";

/**
 * Por encima de este tamaño la captura no es «una tarea» sino un texto largo
 * (un día descrito, un párrafo): al enviarla la IA propone título corto +
 * subtareas con horario y se crean de una sola vez. Por debajo, todo sigue
 * siendo local e instantáneo (sin coste de IA).
 */
const STRUCTURE_MIN_CHARS = 120;

export default function CaptureModal() {
  const open = useStore((s) => s.captureOpen);
  const draft = useStore((s) => s.captureDraft);
  const closeCapture = useStore((s) => s.closeCapture);
  const pushToast = useStore((s) => s.pushToast);
  const setDraft = useStore((s) => s.setCaptureDraft);
  const { settings } = useSettings();
  const [text, setText] = useState(draft);
  const [improving, setImproving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape desde cualquier parte, foco atrapado dentro del diálogo y foco
  // devuelto a quien lo abrió. Antes el Escape vivía en el onKeyDown del
  // input, así que dejaba de funcionar en cuanto el foco se movía.
  const dialogRef = useDialogA11y<HTMLDivElement>(open, closeCapture);

  useEffect(() => {
    if (open) {
      setText(draft);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, draft]);

  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const parsed = useMemo(
    () => parseCapture(text, { projects: projects ?? [] }),
    [text, projects],
  );

  if (!open) return null;

  const submit = async () => {
    if (!text.trim()) return closeCapture();
    const parsedNow = parseCapture(text, { projects: projects ?? [] });
    const long = text.trim().length >= STRUCTURE_MIN_CHARS;
    // Motivo del último intento fallido (para no fallar en silencio).
    let failMsg: string | null = null;

    // Texto largo + IA disponible → estructurar de una vez: la IA propone un
    // título corto (¡no el párrafo entero!) y las subtareas que contiene el
    // texto, con sus horas si las trae. Si la IA falla, se crea tal cual y se
    // avisa (antes el fallo era invisible y parecía que la IA no hacía nada).
    if (long && settings.apiKey.trim()) {
      setImproving(true);
      let structured: { parsed: ParsedCapture; subtasks: CaptureSubtask[] } | null = null;
      try {
        // "@lunes" no se le pasa a la IA: quien manda en recurrencia y fecha
        // es el parser local (y así no lo devuelve como etiqueta).
        const res = await improveCapture({ settings }, stripDayCommands(text), loadProfile());
        if (res.ok && res.data?.title.trim() && res.data.title.trim().length <= 160) {
          const imp = res.data;
          const prio: Priority | undefined =
            typeof imp.priority === "number" && imp.priority >= 1 && imp.priority <= 4
              ? (imp.priority as Priority)
              : undefined;
          structured = {
            parsed: {
              ...parsedNow,
              // El título lo propone la IA; el parser local manda en lo que
              // ya detecta bien (#proyecto, recurrencia, fechas relativas).
              title: imp.title.trim(),
              dueDate: parsedNow.dueDate || imp.dueDate || undefined,
              dueTime: parsedNow.dueTime || imp.dueTime || undefined,
              priority: parsedNow.priority ?? prio,
              // La IA puede devolver "lunes" como etiqueta: ya es un comando
              // de día, no una etiqueta.
              labels: [...new Set([...parsedNow.labels, ...(imp.labels ?? [])])].filter(
                (l) => !isDayCommandWord(l),
              ),
            },
            subtasks: imp.subtasks ?? [],
          };
        } else {
          failMsg = (!res.ok
            ? (res.error ?? "error desconocido")
            : "la IA devolvió el texto entero como título"
          ).slice(0, 90);
        }
      } catch (err) {
        failMsg = (err instanceof Error ? err.message : String(err)).slice(0, 90);
      }
      setImproving(false);

      if (structured) {
        // El párrafo original se conserva en `notes` si la IA lo acortó.
        const original = text.trim();
        const parent = await createTaskFromCapture(
          structured.parsed,
          original !== structured.parsed.title ? { notes: original } : {},
        );
        const n = structured.subtasks.length;
        if (n > 0) await addSubtasks(parent, structured.subtasks);
        pushToast(
          n > 0
            ? `✨ «${parent.title}» + ${n} subtareas`
            : `✨ «${parent.title}» creada — la IA no propuso subtareas`,
        );
        setText("");
        closeCapture();
        return;
      }
    }

    const parent = await createTaskFromCapture(parsedNow);
    pushToast(
      failMsg
        ? `⚠️ No se pudo estructurar: ${failMsg}. Tarea creada tal cual.`
        : long && !settings.apiKey.trim()
          ? "Tarea creada — configura la IA en Ajustes y los textos largos se dividirán en subtareas"
          : `Tarea creada: ${parent.title}`,
    );
    setText("");
    closeCapture();
  };

  const handleImprove = async () => {
    if (!text.trim() || !settings.apiKey.trim()) return;
    setImproving(true);
    try {
      const res = await improveCapture({ settings }, stripDayCommands(text), loadProfile());
      if (res.ok && res.data) {
        const imp = res.data;
        let reconstructed = imp.title;
        if (imp.dueDate) reconstructed += ` el ${imp.dueDate}`;
        if (imp.dueTime) reconstructed += ` a las ${imp.dueTime}`;
        if (imp.priority) reconstructed += ` !${imp.priority}`;
        if (imp.labels && imp.labels.length) reconstructed += ` ${imp.labels.map((l) => `@${l}`).join(" ")}`;
        setText(reconstructed);
        pushToast("Captura normalizada con IA");
      } else {
        pushToast(`No se pudo estructurar: ${res.error ?? "error"}`);
      }
    } catch (err) {
      pushToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImproving(false);
    }
  };

  const chip =
    "chip bg-surface-hover text-primary";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCapture();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card w-full max-w-xl p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Nueva tarea"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe una tarea… p. ej. Llamar al proveedor mañana #trabajo @urgente ~1h · @lunes = cada lunes"
            className="input text-base"
            aria-label="Captura en lenguaje natural"
          />
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {parsed.dueDate && (
              <span className={`${chip} bg-sky-500/20 light:bg-sky-100 text-sky-300 light:text-sky-600`}>
                📅 {formatLocalDate(parseISODate(parsed.dueDate))}
                {parsed.dueTime ? ` · ${parsed.dueTime}` : ""}
              </span>
            )}
            {parsed.recurrence && (
              <span className={`${chip} bg-violet-500/20 light:bg-violet-100 text-violet-300 light:text-violet-600`}>
                🔁 {describeRecurrence(parsed.recurrence)}
              </span>
            )}
            {parsed.projectName && (
              <span className={`${chip} bg-emerald-500/20 light:bg-emerald-100 text-emerald-300 light:text-emerald-600`}>
                📁 {parsed.projectName}
              </span>
            )}
            {parsed.labels.map((l) => (
              <span key={l} className={`${chip} bg-amber-500/20 light:bg-amber-100 text-amber-300 light:text-amber-700`}>
                @{l}
              </span>
            ))}
            {parsed.durationMin && (
              <span className={`${chip} bg-surface-hover text-primary`}>
                ⏱ {parsed.durationMin} min
              </span>
            )}
            {parsed.priority && (
              <span className={`${chip} bg-rose-500/20 light:bg-rose-100 text-rose-300 light:text-rose-600`}>
                !prioridad {parsed.priority}
              </span>
            )}
            {parsed.importance && (
              <span className={`${chip} bg-rose-500/20 light:bg-rose-100 text-rose-300 light:text-rose-600`}>
                !importancia {parsed.importance}
              </span>
            )}
            {settings.apiKey.trim() && text.trim().length > 3 && (
              <button
                type="button"
                disabled={improving}
                onClick={() => void handleImprove()}
                className="chip bg-sky-500/20 light:bg-sky-100 text-sky-300 light:text-sky-600 hover:bg-sky-500/30 hover:light:bg-sky-100 cursor-pointer"
                title="Pide al LLM una segunda opinión para normalizar la captura"
              >
                {improving ? "✨ Mejorando..." : "✨ Mejorar con IA"}
              </button>
            )}
            <span className="ml-auto text-muted">
              Enter para crear · Esc para cerrar
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
