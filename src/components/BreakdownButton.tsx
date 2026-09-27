import { useState } from "react";
import { addSubtasks } from "@/store/actions";
import { loadProfile } from "@/store/profile";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { breakdownTask, type SubtaskSuggestion } from "@/llm/tasks";
import type { LlmContext } from "@/llm/client";
import { localBreakdown } from "@/domain/templates";
import { deriveEnd } from "@/domain/schedule";
import type { Task } from "@/domain/types";
import BreakdownModal from "./BreakdownModal";

export default function BreakdownButton({ task }: { task: Task }) {
  const { settings } = useSettings();
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SubtaskSuggestion[]>([]);

  const run = async () => {
    setBusy(true);
    try {
      const ctx: LlmContext = { settings };
      let titles: SubtaskSuggestion[] = [];
      // Motivo por el que la IA no aportó: al final se explica en el aviso
      // (antes una respuesta ilegible acababa en «sin sugerencias» a secas).
      let aiFail: string | null = null;
      let aiEmpty = false;
      if (settings.apiKey.trim()) {
        // Con perfil, la IA propone además horario (hora de inicio) según la
        // rutina del usuario; sin perfil, solo títulos y duración.
        const res = await breakdownTask(ctx, task, loadProfile());
        if (res.ok) {
          titles = res.data ?? [];
          aiEmpty = titles.length === 0;
        } else {
          aiFail = res.error ?? "error desconocido";
        }
      }
      if (titles.length === 0) {
        titles = localBreakdown(task.title).map((t) => ({ title: t }));
      }
      if (titles.length === 0) {
        const short = task.title.length > 30 ? `${task.title.slice(0, 30)}…` : task.title;
        pushToast(
          aiFail
            ? `Sin sugerencias: la IA falló (${aiFail}) y la plantilla local no conoce esta tarea`
            : aiEmpty
              ? `Sin sugerencias: ni la IA ni la plantilla local supieron desglosar «${short}»`
              : `Sin sugerencias: sin IA configurada la plantilla local no conoce «${short}» — actívala en Ajustes`,
        );
        return;
      }
      if (aiFail) pushToast(`IA no disponible (${aiFail}) — uso la plantilla local`);
      setSuggestions(titles);
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (selected: { title: string; durationMin?: number; start?: string; end?: string }[]) => {
    // La IA propone el inicio; la hora final se deriva de inicio + duración.
    const items = selected.map((s) =>
      s.start && !s.end && s.durationMin ? { ...s, end: deriveEnd(s.start, s.durationMin) } : s,
    );
    // Por la acción y no por un put() directo: así las subtareas suben a la nube.
    await addSubtasks(task, items);
    pushToast(`${selected.length} subtareas creadas`);
  };

  return (
    <>
      <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => void run()}>
        {busy ? "…" : settings.apiKey.trim() ? "✨ Desglosar" : "🧩 Desglosar (local)"}
      </button>

      {modalOpen && (
        <BreakdownModal
          taskTitle={task.title}
          initialSubtasks={suggestions}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

