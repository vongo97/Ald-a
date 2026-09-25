import { useState } from "react";
import { db, newId } from "@/store/db";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/SettingsContext";
import { breakdownTask, type SubtaskSuggestion } from "@/llm/tasks";
import type { LlmContext } from "@/llm/client";
import { localBreakdown } from "@/domain/templates";
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
      if (settings.apiKey.trim()) {
        const res = await breakdownTask(ctx, task);
        if (res.ok && res.data) {
          titles = res.data.map((s) => ({ title: s.title, durationMin: s.durationMin }));
        } else {
          pushToast(`IA no disponible (${res.error ?? "error"}). Usando plantilla local.`);
        }
      }
      if (titles.length === 0) {
        titles = localBreakdown(task.title).map((t) => ({ title: t }));
      }
      if (titles.length === 0) {
        pushToast("Sin sugerencias para esta tarea");
        return;
      }
      setSuggestions(titles);
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (selected: { title: string; durationMin?: number }[]) => {
    for (const s of selected) {
      await db.tasks.put({
        id: newId(),
        title: s.title,
        labels: [],
        priority: task.priority,
        importance: task.importance,
        status: "todo",
        parentId: task.id,
        order: 999, // al final; reordenable
        createdAt: new Date().toISOString(),
        ...(s.durationMin ? { durationMin: s.durationMin } : {}),
      });
    }
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

