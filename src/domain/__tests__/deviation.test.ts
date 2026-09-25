import { describe, expect, it } from "vitest";
import { overdueTasks, proposeReprogramming } from "../deviation";
import type { Task } from "../types";

const NOW = new Date(2026, 8, 22, 9); // martes

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

describe("overdueTasks", () => {
  it("detecta vencidas y excluye hoy/futuras/completadas", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: "2026-09-21" }),
      makeTask({ id: "b", dueDate: "2026-09-22" }),
      makeTask({ id: "c", dueDate: "2026-09-23" }),
      makeTask({ id: "d", dueDate: "2026-09-20", status: "done" }),
    ];
    const overdue = overdueTasks(tasks, NOW);
    expect(overdue.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("proposeReprogramming", () => {
  it("mueve vencidas a hoy y siguientes días respetando el límite", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: "2026-09-21", durationMin: 200 }),
      makeTask({ id: "b", dueDate: "2026-09-19", durationMin: 200 }),
      makeTask({ id: "c", dueDate: "2026-09-18", durationMin: 60 }),
    ];
    const proposals = proposeReprogramming(tasks, NOW);
    const byTask = new Map(proposals.map((p) => [p.taskId, p]));
    // a → hoy (22), b → mañana (23) porque hoy se llena, c → pasado (24)
    expect(byTask.get("a")?.toDate).toBe("2026-09-22");
    expect(byTask.get("b")?.toDate).toBe("2026-09-23");
    expect(byTask.get("c")?.toDate).toBe("2026-09-24");
  });

  it("sin vencidas no propone nada", () => {
    expect(proposeReprogramming([makeTask({ dueDate: "2026-09-22" })], NOW)).toEqual([]);
  });
});
