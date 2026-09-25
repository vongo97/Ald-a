import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { createTaskFromCapture } from "@/store/actions";
import { parseCapture } from "@/parsers/capture";
import { improveCapture } from "@/llm/tasks";
import type { Priority } from "@/domain/types";
import { formatLocalDate, parseISODate } from "@/domain/dateutils";

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
    await createTaskFromCapture(parseCapture(text, { projects: projects ?? [] }));
    pushToast(`Tarea creada: ${parsed.title}`);
    setText("");
    closeCapture();
  };

  const handleImprove = async () => {
    if (!text.trim() || !settings.apiKey.trim()) return;
    setImproving(true);
    try {
      const res = await improveCapture({ settings }, text);
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
    "chip bg-slate-700/70 text-slate-200";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCapture();
      }}
    >
      <div className="card w-full max-w-xl p-4 shadow-2xl" role="dialog" aria-label="Nueva tarea">
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
            onKeyDown={(e) => {
              if (e.key === "Escape") closeCapture();
            }}
            placeholder="Escribe una tarea… p. ej. Entregar informe mañana a las 3pm #trabajo @correo ~1h !1"
            className="input text-base"
            aria-label="Captura en lenguaje natural"
          />
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {parsed.dueDate && (
              <span className={`${chip} bg-sky-500/20 text-sky-300`}>
                📅 {formatLocalDate(parseISODate(parsed.dueDate))}
                {parsed.dueTime ? ` · ${parsed.dueTime}` : ""}
              </span>
            )}
            {parsed.recurrence && (
              <span className={`${chip} bg-violet-500/20 text-violet-300`}>
                🔁 recurre
              </span>
            )}
            {parsed.projectName && (
              <span className={`${chip} bg-emerald-500/20 text-emerald-300`}>
                📁 {parsed.projectName}
              </span>
            )}
            {parsed.labels.map((l) => (
              <span key={l} className={`${chip} bg-amber-500/20 text-amber-300`}>
                @{l}
              </span>
            ))}
            {parsed.durationMin && (
              <span className={`${chip} bg-slate-500/20 text-slate-300`}>
                ⏱ {parsed.durationMin} min
              </span>
            )}
            {parsed.priority && (
              <span className={`${chip} bg-rose-500/20 text-rose-300`}>
                !prioridad {parsed.priority}
              </span>
            )}
            {parsed.importance && (
              <span className={`${chip} bg-rose-500/20 text-rose-300`}>
                !importancia {parsed.importance}
              </span>
            )}
            {settings.apiKey.trim() && text.trim().length > 3 && (
              <button
                type="button"
                disabled={improving}
                onClick={() => void handleImprove()}
                className="chip bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 cursor-pointer"
                title="Pide al LLM una segunda opinión para normalizar la captura"
              >
                {improving ? "✨ Mejorando..." : "✨ Mejorar con IA"}
              </button>
            )}
            <span className="ml-auto text-slate-500">
              Enter para crear · Esc para cerrar
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
