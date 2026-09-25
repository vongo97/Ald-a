import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { overdueTasks, proposeReprogramming } from "@/domain/deviation";
import { applyReprogramming } from "@/store/actions";

/**
 * Única fuente de verdad de "tareas vencidas".
 *
 * Antes convivían dos definiciones y dos remedios distintos:
 *   - `useOverdueReschedule` filtraba a mano (`dueDate < hoy`) y las movía
 *     todas a hoy con un `updateTask` por tarea → N subidas a la nube;
 *   - el banner de Hoy usaba `overdueTasks()` + `proposeReprogramming()`,
 *     que respeta tu capacidad → una sola subida.
 *
 * Aquí se comparten las dos cosas, y de paso pasa a ser reactivo (live query)
 * en vez de leerse una sola vez al montar el componente.
 */
export function useOverdue() {
  const all = useLiveQuery(() => db.tasks.toArray(), [], []);

  const overdue = useMemo(() => overdueTasks(all ?? []), [all]);
  const proposals = useMemo(() => proposeReprogramming(all ?? []), [all]);

  /** Reprograma según capacidad y orden: una transacción y una sola subida. */
  const applySuggestions = (): Promise<void> => applyReprogramming(proposals);

  return { overdue, proposals, applySuggestions };
}
