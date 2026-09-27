import type { Task } from "./types";

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

/**
 * Ancestro borrado más alto de una tarea (para restaurar la rama completa).
 * Si ningún ancestro está borrado devuelve la propia tarea.
 *
 * Exportada para tests.
 */
export function topmostDeleted(tasks: Task[], task: Task): Task {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let current = task;
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || !parent.deletedAt) break;
    current = parent;
  }
  return current;
}
