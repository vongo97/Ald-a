import { db } from "./db";
import { addSubtasks, updateTask } from "./actions";
import { loadProfile } from "./profile";
import { improveCapture } from "@/llm/tasks";
import { friendlyLlmError } from "@/llm/client";
import type { Settings } from "@/domain/types";

/**
 * Desglose automático de capturas que quedaron como un bloque de texto.
 *
 * El flujo de captura ya estructura los textos largos al crearlos, pero si
 * la IA falló (o la captura es anterior a esa función) la tarea se queda con
 * el párrafo entero como título. Al arrancar la app se buscan esos bloques y
 * se estructuran solos, sin que nadie pulse «Desglosar»: título corto (el
 * original va a `notes`, nunca se pierde) + subtareas con horario.
 *
 * Coste acotado: a lo sumo `MAX_PER_RUN` por arranque, y las que ya se
 * arreglaron se recuerdan en localStorage. Un fallo NO se marca como hecho:
 * se reintenta en el próximo arranque (por si estaba sin red).
 */

const MIN_TITLE_CHARS = 150;
const MAX_PER_RUN = 3;
const DONE_KEY = "ald-a:auto-desglosado";

/** Evita dobles ejecuciones (StrictMode monta los efectos dos veces). */
let running = false;

function doneIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markDone(id: string): void {
  try {
    const ids = doneIds();
    ids.add(id);
    localStorage.setItem(DONE_KEY, JSON.stringify([...ids]));
  } catch {
    // sin localStorage: se reintentará en el próximo arranque (inofensivo)
  }
}

export interface AutoBreakdownResult {
  /** Bloques estructurados con éxito. */
  fixed: number;
  /** Subtareas creadas en total. */
  subtasks: number;
  /** Intentos fallidos (se reintentan en el próximo arranque). */
  failed: number;
  /** Primer motivo de fallo, para el aviso. */
  error?: string;
}

/**
 * Estructura con IA las tareas con título gigante. Devuelve el recuento o
 * `null` si no hay nada que hacer (sin clave, sin bloques o ya procesadas).
 * Los fallos quedan en `failed`/`error` para que la UI avise: nunca en
 * silencio.
 */
export async function autoBreakdownBlobs(
  settings: Settings,
): Promise<AutoBreakdownResult | null> {
  if (running || !settings.apiKey.trim()) return null;
  running = true;
  try {
    const done = doneIds();
    const blobs = (await db.tasks.toArray()).filter(
      (t) =>
        t.status === "todo" &&
        !t.deletedAt &&
        !t.parentId &&
        t.title.length >= MIN_TITLE_CHARS &&
        !done.has(t.id),
    );
    if (blobs.length === 0) return null;

    const result: AutoBreakdownResult = { fixed: 0, subtasks: 0, failed: 0 };

    for (const task of blobs.slice(0, MAX_PER_RUN)) {
      // Un bloque que ya tiene subtareas está (medianamente) estructurado.
      const children = await db.tasks.where("parentId").equals(task.id).count();
      if (children > 0) {
        markDone(task.id);
        continue;
      }
      try {
        // Con el perfil, la IA propone además horarios según la rutina.
        const res = await improveCapture({ settings }, task.title, loadProfile());
        const title = res.ok ? res.data?.title.trim() : undefined;
        if (!title || title.length > 160) {
          // Respuesta no usable (o el párrafo entero devuelto): no se toca
          // nada, no se marca y se reintenta en el próximo arranque.
          result.failed += 1;
          result.error ??= res.error ?? "la IA devolvió el texto entero";
          continue;
        }

        // El párrafo original se conserva en `notes` (nunca se pierde).
        await updateTask(task.id, { title, notes: task.notes ?? task.title });
        const subs = res.data?.subtasks ?? [];
        if (subs.length > 0) await addSubtasks(task, subs);
        result.fixed += 1;
        result.subtasks += subs.length;
        markDone(task.id);
      } catch (err) {
        // sin red ahora: se reintenta en el próximo arranque
        result.failed += 1;
        result.error ??= friendlyLlmError((err instanceof Error ? err.message : String(err)).slice(0, 300));
      }
    }

    return result.fixed > 0 || result.failed > 0 ? result : null;
  } finally {
    running = false;
  }
}
