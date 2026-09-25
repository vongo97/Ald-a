import { useEffect, useRef } from "react";
import { sendNotification } from "./notifier";
import type { Task } from "@/domain/types";

/** Convierte "HH:mm" a minutos desde medianoche. */
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutos hasta una hora "HH:mm" desde ahora. */
function minutesUntil(hhmm: string): number {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return toMin(hhmm) - nowMin;
}

/**
 * Hook que programa alertas nativas para cada bloque de tiempo asignado hoy.
 * - Alerta 5 min antes: "⏳ En 5 min: [tarea]"
 * - Alerta al iniciar: "⏰ Ahora: [tarea]"
 */
export function useTimeBlockAlerts(scheduledTasks: Task[]): void {
  // Guardamos las IDs de timers para limpiarlos al re-renderizar
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Limpiar timers anteriores
    timers.current.forEach(clearTimeout);
    timers.current = [];

    for (const task of scheduledTasks) {
      if (!task.timeBlock) continue;
      const { start, end } = task.timeBlock;
      const label = task.title.length > 50 ? task.title.slice(0, 47) + "…" : task.title;

      // Alerta 5 min antes
      const msUntilMinus5 = (minutesUntil(start) - 5) * 60 * 1000;
      if (msUntilMinus5 > 0) {
        const t = setTimeout(() => {
          sendNotification(
            "⏳ En 5 minutos",
            `${label}  ·  ${start}–${end}`,
            `pre-${task.id}`,
          );
        }, msUntilMinus5);
        timers.current.push(t);
      }

      // Alerta al inicio del bloque
      const msUntilStart = minutesUntil(start) * 60 * 1000;
      if (msUntilStart > 0) {
        const t = setTimeout(() => {
          sendNotification(
            "⏰ Es hora de empezar",
            `${label}  ·  ${start}–${end}`,
            `start-${task.id}`,
          );
        }, msUntilStart);
        timers.current.push(t);
      }
    }

    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, [scheduledTasks]);
}
