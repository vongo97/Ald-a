import type { Project, Task } from "@/domain/types";

/**
 * Reparación de los ids que la app se inventó y Postgres no acepta.
 *
 * `newId` usaba `crypto.randomUUID?.() ?? \`t-…\``, y `crypto.randomUUID` solo
 * existe en un contexto seguro. Abriendo la app en el móvil por la IP de la
 * Wi-Fi (http://192.168.x.x:4173) el identificador salía con la forma `t-…`, y
 * la columna de la nube es `id uuid NOT NULL`. Esas filas no subiendo «más tarde»:
 * no pueden subir nunca. Se quedan en «pendiente» para siempre, sin error visible.
 *
 * El arreglo de `newId` (commit 7cda2df) impide que volver a pasar. NO arregla
 * lo que ya está en el dispositivo, que vive en el IndexedDB de cada móvil y al
 * que ninguna migración de SQL llega. Eso es lo que hace esto.
 *
 * Por qué solo se cambian los ids malos y no todos: un id que ya es un uuid
 * válido puede estar sincronizado con la nube, con otro dispositivo y con un
 * respaldo en JSON. Tocar uno sería tirar esa coherencia por la ventana sin
 * motivo. Los `t-…`, en cambio, no existen en ningún sitio más.
 *
 * Por qué hay que reescribir las referencias y no solo los ids: una tarea puede
 * apuntar a un proyecto (`projectId`) y a su tarea madre (`parentId`). Si se
 * cambia el id del proyecto y no su referencia, la tarea se queda apuntando al
 * aire y aparece sin proyecto. Es el fallo que hace «funciona» una reparación que
 * no lo es.
 */

/** Un uuid, el formato que acepta de verdad una columna `uuid` de Postgres. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Genera un uuid válido, sin depender de que exista `crypto.randomUUID`. */
export function nuevoId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface Reparacion {
  tareas: Task[];
  proyectos: Project[];
  /** Cuántos ids han cambiado. 0 significa que no había nada que arreglar. */
  cambiados: number;
  /**
   * Los ids que se quedan sin usar y hay que BORRAR antes de escribir los
   * nuevos.
   *
   * No es opcional, y no es un detalle: `bulkPut` no actualiza por clave primaria
   * cuando la clave cambia, AÑADE otra fila. Sin borrar antes, cada tarea rota
   * aparecería dos veces en la lista, y como la vieja seguía con el id `t-…` la
   * reparación volvería a encontrarla en el siguiente arranque, indefinidamente.
   * Se comprobó con el Dexie de verdad, no supuesto: el test que mira el número
   * de filas falla con `expected 3 to be 2`.
   */
  idsViejos: string[];
}

/**
 * Devuelve las mismas tareas y proyectos con los ids inválidos sustituidos, y
 * las referencias reescritas. No toca la base de datos: solo decide, para que la
 * decisión se pueda probar sin una base de datos delante.
 *
 * Si nada está roto devuelve los mismos objetos, sin copias ni cambios, y
 * `cambiados` a cero.
 */
export function reparaIds(tareas: Task[], proyectos: Project[]): Reparacion {
  // Un solo mapa para proyectos y tareas: las referencias cruzan los dos, y un
  // id repetido en un mapa y en el otro daría dos ids nuevos para la misma fila.
  const mapa = new Map<string, string>();
  const anotar = (id: unknown) => {
    // Un id vacío tampoco sirve, pero tampoco es algo que se pueda «arreglar»
    // adivinando a qué fila pertenecía, así que se deja como estaba: es un dato
    // que ya no se sabe, no un formato.
    if (typeof id !== "string" || id === "" || esUuid(id) || mapa.has(id)) return;
    mapa.set(id, nuevoId());
  };

  for (const p of proyectos) anotar(p.id);
  for (const t of tareas) anotar(t.id);

  if (mapa.size === 0) return { tareas, proyectos, cambiados: 0, idsViejos: [] };

  const seguir = (ref: unknown) => (typeof ref === "string" ? mapa.get(ref) : undefined);

  return {
    cambiados: mapa.size,
    idsViejos: [...mapa.keys()],
    proyectos: proyectos.map((p) => ({ ...p, id: mapa.get(p.id) ?? p.id })),
    tareas: tareas.map((t) => {
      const id = mapa.get(t.id) ?? t.id;
      const projectId = seguir(t.projectId) ?? t.projectId;
      const parentId = seguir(t.parentId) ?? t.parentId;
      return { ...t, id, projectId, parentId };
    }),
  };
}

/** Cuántas filas tienen un id que no serviría en la nube. Solo para el aviso. */
export function cuentaIdsInvalidos(tareas: Task[], proyectos: Project[]): number {
  const malos = (filas: { id?: unknown }[]) => filas.filter((f) => !esUuid(f.id)).length;
  return malos(tareas) + malos(proyectos);
}