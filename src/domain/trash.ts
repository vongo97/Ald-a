import type { Task } from "./types";

/**
 * Días que un elemento borrado vive en la Papelera antes de eliminarse
 * definitivamente (local + nube). Visto en `PapeleraView` y aplicado por
 * `store/purge.ts` tras cada sync.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Elementos borrados que ya han caducado (más de `days` días): candidatos
 * a purga automática. Genérico para tareas y proyectos.
 *
 * Exportada para tests.
 */
export function expiredTrash<T extends { deletedAt?: string }>(
  rows: T[],
  now = Date.now(),
  days = TRASH_RETENTION_DAYS,
): T[] {
  const cutoff = now - days * 86_400_000;
  return rows.filter((r) => {
    if (!r.deletedAt) return false;
    const t = Date.parse(r.deletedAt);
    return !Number.isNaN(t) && t < cutoff;
  });
}

/**
 * Días de vida que le quedan en la Papelera (`null` si no está borrada o
 * la fecha es ilegible). Sirve para el aviso «caduca en Xd» de cada fila.
 *
 * Exportada para tests.
 */
export function daysLeftInTrash(
  deletedAt: string | undefined,
  now = Date.now(),
  days = TRASH_RETENTION_DAYS,
): number | null {
  if (!deletedAt) return null;
  const t = Date.parse(deletedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t + days * 86_400_000 - now) / 86_400_000));
}

/**
 * Borrados con `deletedAt` agrupados por ramas: devuelve solo las raíces
 * (sin padre, huérfanas o con el padre todavía vivas).
 *
 * Así la Papelera enseña «Plan del día» UNA vez en vez de sus 10 subtareas
 * borradas en cascada, y restaurar la raíz recupera la rama entera.
 *
 * Exportada para tests.
 */
export function deletedRoots(tasks: Task[]): Task[] {
  const deleted = tasks.filter((t) => !!t.deletedAt);
  const deletedIds = new Set(deleted.map((t) => t.id));
  return deleted.filter((t) => !t.parentId || !deletedIds.has(t.parentId));
}

/** Fila de la Papelera: tarea borrada + su profundidad real en el árbol. */
export interface TrashRow {
  task: Task;
  depth: number;
}

/**
 * TODOS los borrados en lista plana, en orden jerárquico: cada raíz seguida
 * de su descendencia (por `order`), con la indentación real de la tarea en el
 * árbol — la calculo sobre el árbol completo (vivos y borrados), así que la
 * lista no «reordena» las subtareas cuando restauras una raíz a medias.
 *
 * Exportada para tests.
 */
export function deletedForest(tasks: Task[]): TrashRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deleted = tasks.filter((t) => !!t.deletedAt);
  const deletedIds = new Set(deleted.map((t) => t.id));

  const depthOf = (t: Task): number => {
    let depth = 0;
    let cur = t;
    const seen = new Set<string>();
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      depth += 1;
      cur = parent;
    }
    return depth;
  };

  // Hijos borrados agrupados por padre borrado; el resto son raíces de lista.
  const kids = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of deleted) {
    if (t.parentId && deletedIds.has(t.parentId)) {
      const arr = kids.get(t.parentId);
      if (arr) arr.push(t);
      else kids.set(t.parentId, [t]);
    } else {
      roots.push(t);
    }
  }
  for (const arr of kids.values()) arr.sort((a, b) => a.order - b.order);
  roots.sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  const out: TrashRow[] = [];
  const visited = new Set<string>();
  const walk = (t: Task): void => {
    if (visited.has(t.id)) return;
    visited.add(t.id);
    out.push({ task: t, depth: depthOf(t) });
    for (const child of kids.get(t.id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  // Datos raros (ciclos de parentId): que nadie se quede fuera de la lista.
  for (const t of deleted) if (!visited.has(t.id)) out.push({ task: t, depth: depthOf(t) });
  return out;
}

/**
 * Qué hay que restaurar al restaurar `id`:
 *
 *  1. sus ANCESTROS borrados (hacia arriba): sin el padre vivo la tarea
 *     restaurada no se ve en casi ninguna vista (las listas filtran por
 *     `parentId`), quedaría huérfana;
 *  2. la propia tarea si está borrada;
 *  3. su DESCENDENCIA borrada (hacia abajo): se deshace la cascada de
 *     `deleteTask`, igual que el «Deshacer» del toast.
 *
 * NO toca hermanas ni nada fuera de esa rama: la restauración es selectiva
 * (justo lo que pediste: no «restaurar todo»).
 *
 * Exportada para tests.
 */
export function restoreSet(tasks: Task[], id: string): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, Task>();

  // 1) hacia arriba: ancestros borrados, parando en el primer vivo.
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && cursor.deletedAt && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    out.set(cursor.id, cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  // 2) hacia abajo: descendencia borrada (los vivos solo sirven de paso).
  const kids = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const arr = kids.get(t.parentId);
    if (arr) arr.push(t);
    else kids.set(t.parentId, [t]);
  }
  const stack = [id];
  const walked = new Set<string>([id]);
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const child of kids.get(cur) ?? []) {
      if (walked.has(child.id)) continue;
      walked.add(child.id);
      if (child.deletedAt) out.set(child.id, child);
      stack.push(child.id);
    }
  }

  return Array.from(out.values());
}
