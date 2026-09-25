/**
 * Reglas de fusión de la sincronización.
 *
 * Módulo puro: sin red ni IndexedDB. Está separado de `sync.ts` a propósito:
 * es la decisión que evita perder datos, así que tiene que poder testearse
 * sin mockear Supabase.
 */

/**
 * Compara un timestamp ISO como fecha real.
 *
 * El formato de Postgres (`2026-09-23T15:03:42.33+00:00`) y el de JavaScript
 * (`2026-09-23T15:03:42.330Z`) no son comparables como texto: `"…42.33+00"` >
 * `"…42.330Z"` sería mentira según el orden de caracteres. Siempre pasamos por
 * `Date`. Devuelve 0 cuando no hay fecha o es ilegible.
 */
export function timestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface SyncRecord {
  updatedAt?: string | null;
}

export type MergeDecision =
  /** La nube manda: se baja la copia remota. */
  | "take-remote"
  /** Lo local manda: se conserva la copia del dispositivo y se sube. */
  | "keep-local";

/**
 * ¿Debe la copia remota sustituir a la local?
 *
 * 1. No existe en local → se baja (tarea creada en otro dispositivo).
 *
 * 2. A alguno de los dos le falta `updatedAt` → manda lo local. Cubre los dos
 *    casos reales de este proyecto:
 *      - filas locales de antes de este cambio (no tenían `updatedAt`), y el
 *        push estuvo roto por la columna `user_id` inexistente → lo local es
 *        la copia buena y más completa;
 *      - nube sin migrar todavía (aún no existe `updated_at`).
 *    Esto es seguro porque `pullAndSyncFromSupabase` **sube antes de bajar**:
 *    si manda lo local, esa misma subida es la que pone la nube al día.
 *
 * 3. Ambos con fecha → gana el más reciente (multi-dispositivo).
 */
export function mergeDecision(local: SyncRecord | undefined, remote: SyncRecord): MergeDecision {
  if (!local) return "take-remote";

  const localTime = timestamp(local.updatedAt);
  const remoteTime = timestamp(remote.updatedAt);

  if (localTime === 0 || remoteTime === 0) return "keep-local";
  return remoteTime > localTime ? "take-remote" : "keep-local";
}
