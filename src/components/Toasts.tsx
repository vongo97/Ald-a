import { useEffect } from "react";
import { useStore } from "@/store/useStore";

function ToastItem({ id, message, undo }: { id: string; message: string; undo?: () => void }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 5000);
    return () => clearTimeout(t);
  }, [id, dismiss]);

  return (
    <div className="card pointer-events-auto flex items-center gap-3 px-4 py-2.5 shadow-lg">
      <span className="text-sm text-slate-200 light:text-slate-800">{message}</span>
      {undo && (
        <button
          type="button"
          onClick={() => {
            void undo();
            dismiss(id);
          }}
          className="text-sm font-semibold text-sky-400 light:text-sky-600 hover:text-sky-300 hover:light:text-sky-600"
        >
          Deshacer
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(id)}
        className="ml-auto text-slate-500 hover:text-slate-300 hover:light:text-slate-700"
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  );
}

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  );
}
