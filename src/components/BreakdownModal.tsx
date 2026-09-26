import { useState } from "react";
import type { SubtaskSuggestion } from "@/llm/tasks";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface BreakdownModalProps {
  taskTitle: string;
  initialSubtasks: SubtaskSuggestion[];
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (subtasks: { title: string; durationMin?: number }[]) => Promise<void>;
}

export default function BreakdownModal({
  taskTitle,
  initialSubtasks,
  isOpen,
  onClose,
  onConfirm,
}: BreakdownModalProps) {
  const [items, setItems] = useState<{ id: string; title: string; durationMin?: number; checked: boolean }[]>(() =>
    initialSubtasks.map((s, idx) => ({
      id: `item-${idx}-${Date.now()}`,
      title: s.title,
      durationMin: s.durationMin,
      checked: true,
    })),
  );
  const [saving, setSaving] = useState(false);
  // Este modal no tenía Escape en absoluto (solo click fuera del velo).
  const dialogRef = useDialogA11y<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const toggleCheck = (id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  };

  const updateTitle = (id: string, title: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, title } : item)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, title: "", durationMin: 15, checked: true },
    ]);
  };

  const handleConfirm = async () => {
    const selected = items.filter((i) => i.checked && i.title.trim());
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await onConfirm(selected.map((s) => ({ title: s.title.trim(), durationMin: s.durationMin })));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = items.filter((i) => i.checked && i.title.trim()).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="card w-full max-w-lg p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Revisar desglose de tarea"
      >
        <header className="mb-4">
          <h2 className="text-base font-bold text-slate-100 light:text-slate-900">Desglose sugerido</h2>
          <p className="mt-0.5 text-xs text-slate-400 light:text-slate-500">
            Revisa, edita o desmarca las subtareas para «<span className="text-slate-200 light:text-slate-800">{taskTitle}</span>» antes de crearlas.
          </p>
        </header>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-900/60 light:bg-white p-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleCheck(item.id)}
                className="h-4 w-4 rounded border-slate-600 light:border-slate-300 bg-slate-800 light:bg-slate-100 text-sky-500 light:text-sky-600 focus:ring-sky-400 focus:light:ring-sky-500 cursor-pointer"
                aria-label={`Seleccionar ${item.title}`}
              />
              <input
                type="text"
                value={item.title}
                onChange={(e) => updateTitle(item.id, e.target.value)}
                placeholder="Título de la subtarea..."
                className="input py-1 text-xs flex-1"
              />
              {item.durationMin ? (
                <span className="shrink-0 text-[10px] text-slate-400 light:text-slate-500">{item.durationMin}m</span>
              ) : null}
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="text-slate-500 hover:text-rose-400 hover:light:text-rose-600 px-1 text-sm"
                aria-label="Eliminar subtarea"
              >
                ✕
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-500">No hay subtareas en la lista.</p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-slate-700/60 light:border-slate-200 pt-3">
          <button type="button" onClick={addItem} className="btn-ghost py-1 text-xs">
            + Añadir otra
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost py-1 text-xs">
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || selectedCount === 0}
              onClick={() => void handleConfirm()}
              className="btn-primary py-1 text-xs"
            >
              {saving ? "Creando..." : `Crear ${selectedCount} subtarea${selectedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
