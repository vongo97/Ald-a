import { useOverdueReschedule } from "@/notifications/useOverdueReschedule";
import { useDialogA11y } from "@/hooks/useDialogA11y";

export default function OverdueRescheduleModal() {
  const { open, overdue, proposals, applySmart, moveAllToday, dismiss } =
    useOverdueReschedule();
  // Antes solo se cerraba con click en el velo: sin Escape y con el foco
  // libre para escapar del diálogo.
  const dialogRef = useDialogA11y<HTMLDivElement>(open, dismiss);

  if (!open || overdue.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        className="mx-4 mb-6 w-full max-w-md rounded-2xl border border-amber-500/30 light:border-amber-300 bg-surface p-5 shadow-2xl sm:mb-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="overdue-title"
      >
        {/* Cabecera */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">📅</span>
          <h2
            id="overdue-title"
            className="text-base font-semibold text-primary"
          >
            {overdue.length === 1
              ? "1 tarea quedó pendiente"
              : `${overdue.length} tareas quedaron pendientes`}
          </h2>
        </div>
        <p className="mb-4 text-xs text-muted">
          {overdue.length === 1
            ? "Esta tarea tenía fecha anterior a hoy. ¿La movemos?"
            : "Estas tareas tenían fecha anterior a hoy. ¿Las movemos?"}
        </p>

        {/* Lista de tareas (máx. 8 visibles) */}
        <ul className="mb-4 max-h-36 space-y-1 overflow-y-auto">
          {overdue.slice(0, 8).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-xs text-primary"
            >
              <span className="text-amber-400 light:text-amber-600">⚠</span>
              <span className="line-clamp-1">{t.title}</span>
              {t.dueDate && (
                <span className="ml-auto shrink-0 text-muted">{t.dueDate}</span>
              )}
            </li>
          ))}
          {overdue.length > 8 && (
            <li className="px-3 py-1 text-xs text-muted">
              …y {overdue.length - 8} más
            </li>
          )}
        </ul>

        {/* Acciones: misma lógica que el banner de Hoy */}
        <div className="flex flex-wrap gap-2">
          {proposals.length > 0 && (
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => void applySmart()}
            >
              Reprogramar {proposals.length} con hueco
            </button>
          )}
          <button
            type="button"
            className="btn-ghost flex-1 text-primary"
            onClick={() => void moveAllToday()}
          >
            Mover todas a hoy
          </button>
          <button
            type="button"
            className="btn-ghost w-full text-muted"
            onClick={dismiss}
          >
            Ignorar
          </button>
        </div>
      </div>
    </div>
  );
}
