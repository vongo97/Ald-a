import { useOverdueReschedule } from "@/notifications/useOverdueReschedule";

export default function OverdueRescheduleModal() {
  const { open, overdue, proposals, applySmart, moveAllToday, dismiss } =
    useOverdueReschedule();

  if (!open || overdue.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={dismiss}
    >
      <div
        className="mx-4 mb-6 w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl sm:mb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl">📅</span>
          <h2 className="text-base font-semibold text-slate-100">
            {overdue.length === 1
              ? "1 tarea quedó pendiente"
              : `${overdue.length} tareas quedaron pendientes`}
          </h2>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          {overdue.length === 1
            ? "Esta tarea tenía fecha anterior a hoy. ¿La movemos?"
            : "Estas tareas tenían fecha anterior a hoy. ¿Las movemos?"}
        </p>

        {/* Lista de tareas (máx. 8 visibles) */}
        <ul className="mb-4 max-h-36 space-y-1 overflow-y-auto">
          {overdue.slice(0, 8).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300"
            >
              <span className="text-amber-400">⚠</span>
              <span className="line-clamp-1">{t.title}</span>
              {t.dueDate && (
                <span className="ml-auto shrink-0 text-slate-500">{t.dueDate}</span>
              )}
            </li>
          ))}
          {overdue.length > 8 && (
            <li className="px-3 py-1 text-xs text-slate-500">
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
            className="btn-ghost flex-1 text-slate-300"
            onClick={() => void moveAllToday()}
          >
            Mover todas a hoy
          </button>
          <button
            type="button"
            className="btn-ghost w-full text-slate-400"
            onClick={dismiss}
          >
            Ignorar
          </button>
        </div>
      </div>
    </div>
  );
}
