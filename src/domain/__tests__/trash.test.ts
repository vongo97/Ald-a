import { describe, expect, it } from "vitest";
import { deletedRoots, deletedForest, restoreSet } from "../trash";
import type { Task } from "../types";

const DEL = "2026-09-21T10:00:00.000Z";
const DEL2 = "2026-09-22T10:00:00.000Z";

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "t1",
    title: "tarea",
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: new Date(2026, 8, 20).toISOString(),
    ...partial,
  };
}

describe("deletedRoots", () => {
  it("las hijas borradas en cascada no aparecen: solo la raíz", () => {
    const tasks = [
      makeTask({ id: "plan", deletedAt: DEL }),
      makeTask({ id: "hija", parentId: "plan", deletedAt: DEL }),
      makeTask({ id: "nieta", parentId: "hija", deletedAt: DEL }),
    ];
    expect(deletedRoots(tasks).map((t) => t.id)).toEqual(["plan"]);
  });

  it("una hija borrada con el padre vivo SÍ es su propia raíz", () => {
    const tasks = [
      makeTask({ id: "padre" }),
      makeTask({ id: "hija", parentId: "padre", deletedAt: DEL }),
    ];
    expect(deletedRoots(tasks).map((t) => t.id)).toEqual(["hija"]);
  });

  it("ignora las que no están borradas y las huérfanas cuentan como raíz", () => {
    const tasks = [
      makeTask({ id: "viva" }),
      makeTask({ id: "huerfana", parentId: "no-existe", deletedAt: DEL }),
    ];
    expect(deletedRoots(tasks).map((t) => t.id)).toEqual(["huerfana"]);
  });
});

describe("deletedForest", () => {
  it("lista TODAS las borradas en orden jerárquico con profundidad real", () => {
    const tasks = [
      makeTask({ id: "plan", deletedAt: DEL }),
      makeTask({ id: "hija", parentId: "plan", deletedAt: DEL, order: 1 }),
      makeTask({ id: "hija2", parentId: "plan", deletedAt: DEL, order: 0 }),
      makeTask({ id: "nieta", parentId: "hija", deletedAt: DEL }),
      makeTask({ id: "viva" }),
    ];
    const rows = deletedForest(tasks);
    expect(rows.map((r) => [r.task.id, r.depth])).toEqual([
      ["plan", 0],
      ["hija2", 1],
      ["hija", 1],
      ["nieta", 2],
    ]);
  });

  it("la profundidad cuenta también a los padres VIVOS (lista estable)", () => {
    const tasks = [
      makeTask({ id: "padre" }), // vivo
      makeTask({ id: "hija", parentId: "padre", deletedAt: DEL }),
    ];
    const rows = deletedForest(tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].task.id).toBe("hija");
    expect(rows[0].depth).toBe(1); // sigue indentada aunque el padre no esté borrado
  });

  it("ordena las raíces por lo más recientemente borrado", () => {
    const tasks = [
      makeTask({ id: "vieja", deletedAt: DEL }),
      makeTask({ id: "nueva", deletedAt: DEL2 }),
    ];
    expect(deletedForest(tasks).map((r) => r.task.id)).toEqual(["nueva", "vieja"]);
  });

  it("con un ciclo de parentId nadie se queda fuera de la lista", () => {
    const tasks = [
      makeTask({ id: "a", parentId: "b", deletedAt: DEL }),
      makeTask({ id: "b", parentId: "a", deletedAt: DEL }),
    ];
    expect(deletedForest(tasks).map((r) => r.task.id).sort()).toEqual(["a", "b"]);
  });
});

describe("restoreSet", () => {
  it("restaurar la raíz recupera su rama completa (ancestros + descendencia)", () => {
    const tasks = [
      makeTask({ id: "plan", deletedAt: DEL }),
      makeTask({ id: "hija", parentId: "plan", deletedAt: DEL }),
      makeTask({ id: "nieta", parentId: "hija", deletedAt: DEL }),
      makeTask({ id: "otra", parentId: "plan" }), // viva: no se toca
    ];
    expect(restoreSet(tasks, "plan").map((t) => t.id).sort()).toEqual(["hija", "nieta", "plan"]);
  });

  it("restaurar una subtarea sube a su padre borrado, sin hermanas", () => {
    const tasks = [
      makeTask({ id: "plan", deletedAt: DEL }),
      makeTask({ id: "hija1", parentId: "plan", deletedAt: DEL }),
      makeTask({ id: "hija2", parentId: "plan", deletedAt: DEL }),
    ];
    expect(restoreSet(tasks, "hija1").map((t) => t.id).sort()).toEqual(["hija1", "plan"]);
  });

  it("con el padre vivo solo se restaura la propia tarea", () => {
    const tasks = [
      makeTask({ id: "padre" }),
      makeTask({ id: "hija", parentId: "padre", deletedAt: DEL }),
    ];
    expect(restoreSet(tasks, "hija").map((t) => t.id)).toEqual(["hija"]);
  });

  it("nada borrado devuelve vacío (no reescribe tareas vivas)", () => {
    const tasks = [makeTask({ id: "viva" })];
    expect(restoreSet(tasks, "viva")).toEqual([]);
  });

  it("no sale de la rama: hermanas y tijeras de otros padres quedan borradas", () => {
    const tasks = [
      makeTask({ id: "raiz", deletedAt: DEL }),
      makeTask({ id: "ramaA", parentId: "raiz", deletedAt: DEL }),
      makeTask({ id: "ramaB", parentId: "raiz", deletedAt: DEL }),
      makeTask({ id: "otro", deletedAt: DEL }),
    ];
    expect(restoreSet(tasks, "ramaA").map((t) => t.id).sort()).toEqual(["raiz", "ramaA"]);
  });
});
