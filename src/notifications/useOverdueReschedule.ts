import { useEffect, useState } from "react";
import { db } from "@/store/db";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { updateTask } from "@/store/actions";
import type { Task } from "@/domain/types";

interface OverdueModalState {
  open: boolean;
  tasks: Task[];
}

/**
 * Hook que detecta tareas atrasadas (dueDate < hoy, status: "todo")
 * y expone el estado del modal + acciones para moverlas a hoy.
 */
export function useOverdueReschedule() {
  const [state, setState] = useState<OverdueModalState>({ open: false, tasks: [] });

  useEffect(() => {
    const today = toISODate(startOfDay(new Date()));

    void (async () => {
      const all = await db.tasks.toArray();
      const overdue = all.filter(
        (t) => t.status === "todo" && t.dueDate && t.dueDate < today,
      );
      if (overdue.length > 0) {
        // Pequeño delay para que la app cargue primero
        setTimeout(() => setState({ open: true, tasks: overdue }), 1200);
      }
    })();
  }, []);

  const moveAllToday = async () => {
    const today = toISODate(startOfDay(new Date()));
    for (const task of state.tasks) {
      await updateTask(task.id, { dueDate: today });
    }
    setState({ open: false, tasks: [] });
  };

  const dismiss = () => setState({ open: false, tasks: [] });

  return { ...state, moveAllToday, dismiss };
}
