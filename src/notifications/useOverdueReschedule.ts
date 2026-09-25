import { useEffect, useState } from "react";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { applyReprogramming } from "@/store/actions";
import { useOverdue } from "@/store/useOverdue";

/** "Ya te lo dije hoy": hace que "Ignorar" sobreviva a una recarga. */
const DISMISS_KEY = "ald-a:overdue-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Estado del modal de vencidas.
 *
 * Se abre solo pasados 1,2 s (para que la app dé tiempo a cargar) y "Ignorar"
 * deja de molestar durante el resto del día: antes el estado vivía solo en
 * memoria, así que **cada recarga volvía a enseñarlo**.
 *
 * Al aplicar cualquier acción el modal se cierra solo, porque `overdue` deja
 * de estar vacío… y si queda algo sin reprogramar, lo sigue enseñando el
 * banner de Hoy en lugar de bloquear la pantalla.
 */
export function useOverdueReschedule() {
  const { overdue, proposals, applySuggestions } = useOverdue();
  const [armed, setArmed] = useState(false);
  const [dismissedOn, setDismissedOn] = useState<string | null>(readDismissed);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const today = toISODate(startOfDay(new Date()));
  const open = armed && overdue.length > 0 && dismissedOn !== today;

  const dismiss = (): void => {
    try {
      sessionStorage.setItem(DISMISS_KEY, today);
    } catch {
      // Sin sessionStorage seguimos funcionando, solo que volverá a salir.
    }
    setDismissedOn(today);
  };

  /** La sugerencia que respeta tu capacidad. */
  const applySmart = async (): Promise<void> => {
    await applySuggestions();
    dismiss();
  };

  /** Todo a hoy sin mirar capacidad (lo que hacía el modal antes). */
  const moveAllToday = async (): Promise<void> => {
    await applyReprogramming(overdue.map((t) => ({ taskId: t.id, toDate: today })));
    dismiss();
  };

  return { open, overdue, proposals, applySmart, moveAllToday, dismiss };
}
