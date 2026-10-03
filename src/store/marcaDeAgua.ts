/**
 * Marca de agua: hasta qué momento se han bajado cosas de la nube.
 *
 * Existe porque la bajada era `select("*")` en cada sincronización. Con 14
 * tareas da igual; con 500 son 500 filas bajadas enteras cada 30 segundos, que
 * es justo lo que pasó al subir la frecuencia de sincronización sin mirar lo que
 * costaba cada una. El gasto no es solo del móvil: es de la cuota del proyecto.
 *
 * La idea es bajarse solo lo que cambió desde la última vez. Como la nube ya
 * tiene `updated_at` en las dos tablas y es lo que decide qué versión gana en el
 * merge, se puede preguntar por ahí en vez de traerse todo.
 *
 * Por qué un módulo aparte y no una línea dentro de `sync.ts`: la lógica de
 * "qué pido" y de "cuándo avanzo la marca" es lo que hay que poder probar sin
 * una red, y `sync.ts` se importa con cliente de Supabase, base de datos y
 * tienda a la vez. Aquí no hay nada más que un reloj.
 */

/** Margen de seguridad al restar, en milisegundos. */
const MARGEN_MS = 60_000;

/**
 * Cuánto hay que restarle a la marca antes de preguntar.
 *
 * No se pregunta «mayor que mi marca» y ya. Dos motivos por los que eso no
 * basta:
 *
 *  - Dos filas pueden tener el mismo `updated_at` al segundo, que es como lo
 *    guarda Postgres. Si una se escribe con la marca exacta, `mayor que` la
 *    saltaría para siempre. Restando un minuto, esa fila vuelve a salir.
 *  - El reloj del móvil puede ir atrasado. Si la marca se guardó a las 12:00 y
 *    el dispositivo luego resuelve 11:58, la comparación se invierte.
 *
 * Bajar de más no cuesta nada: la fusión compara por `updated_at` y una fila
 * repetida se ignora sola. Perder una fila, sí.
 */
export function desdeDondeMirar(ultima: string | null): string | null {
  if (!ultima) return null;
  const t = Date.parse(ultima);
  if (Number.isNaN(t)) return null;
  // Sin `Math.max(0, …)`: un instante negativo es una fecha perfectamente válida
  // para `timestamptz` (Postgres baja hasta el 4713 a. C.), y recortarlo al
  // epoch hacía justo lo contrario de lo que se busca — quitar margen.
  return new Date(t - MARGEN_MS).toISOString();
}

/**
 * ¿Se ha avanzado la marca con este éxito?
 *
 * Solo si el pull terminó bien. Si se avanza antes de saber que la nube
 * respondió, un fallo deja la marca por delante de lo que se bajó y las filas
 * que no llegaron no se vuelven a pedir nunca: pérdida silenciosa, que es lo
 * peor que puede hacer esto.
 *
 * Se usa el reloj de la nube y no el del móvil cuando viene. `server_now` es lo
 * que dice el servidor, y si el móvil va atrasado, guardar esa hora es lo que
 * mantiene la comparación viva.
 */
export function avanzarMarca(
  actual: string | null,
  opts: { servidor?: string | null; ahora?: Date } = {},
): string {
  const ahora = opts.ahora ?? new Date();
  const servidor = opts.servidor ? Date.parse(opts.servidor) : Number.NaN;
  const marca = Number.isNaN(servidor) ? ahora.getTime() : servidor;
  // Nunca retroceder: un reloj que va atrás, o un `server_now` raro, no deben
  // hacer que la app vuelva a pedir desde el principio para siempre.
  const previa = actual ? Date.parse(actual) : 0;
  return new Date(Math.max(previa, marca)).toISOString();
}
