import { useSettings } from "@/store/SettingsContext";
import { useBreakdown } from "@/hooks/useBreakdown";
import type { Task } from "@/domain/types";
import BreakdownModal from "./BreakdownModal";

/**
 * «✨ Desglosar» de la ficha de tarea: el flujo completo (IA o plantilla
 * local → modal → addSubtasks) vive en useBreakdown, compartido con el
 * reloj de Cronodisco.
 */
export default function BreakdownButton({ task }: { task: Task }) {
  const { settings } = useSettings();
  const { busy, propuesto, desglosar, confirmar, cerrar } = useBreakdown();

  return (
    <>
      <button
        type="button"
        className="btn-ghost py-1 text-xs"
        disabled={busy}
        onClick={() => void desglosar(task)}
      >
        {busy ? "…" : settings.apiKey.trim() ? "✨ Desglosar" : "🧩 Desglosar (local)"}
      </button>

      {propuesto && (
        <BreakdownModal
          taskTitle={propuesto.task.title}
          initialSubtasks={propuesto.sugerencias}
          isOpen={propuesto !== null}
          onClose={cerrar}
          onConfirm={async (sel) => {
            await confirmar(sel);
          }}
        />
      )}
    </>
  );
}
