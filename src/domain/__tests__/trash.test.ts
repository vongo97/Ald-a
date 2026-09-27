import { describe, expect, it } from "vitest";
import { deletedRoots, topmostDeleted } from "../trash";
import type { Task } from "../types";

const DEL = "2026-09-21T10:00:00.000Z";

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

describe("topmostDeleted", () => {
  it("sube hasta la raíz borrada de la rama", () => {
    const tasks = [
      makeTask({ id: "plan", deletedAt: DEL }),
      makeTask({ id: "hija", parentId: "plan", deletedAt: DEL }),
      makeTask({ id: "nieta", parentId: "hija", deletedAt: DEL }),
    ];
    expect(topmostDeleted(tasks, tasks[2]).id).toBe("plan");
  });

  it("con el padre vivo devuelve la propia tarea", () => {
    const tasks = [
      makeTask({ id: "padre" }),
      makeTask({ id: "hija", parentId: "padre", deletedAt: DEL }),
    ];
    expect(topmostDeleted(tasks, tasks[1]).id).toBe("hija");
  });

  it("sin padres ni huérfanos vivos no se sale de la tarea", () => {
    const tasks = [makeTask({ id: "sola", deletedAt: DEL })];
    expect(topmostDeleted(tasks, tasks[0]).id).toBe("sola");
  });
});
