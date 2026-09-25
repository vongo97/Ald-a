import { describe, expect, it } from "vitest";
import { priorityScore, sortBySuggested, todayISO } from "../priority";
import type { Task } from "../types";
import { addDays, startOfDay, toISODate } from "../dateutils";

const NOW = new Date(2026, 8, 22, 10, 0);

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "t1",
    title: "tarea",
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: new Date(2026, 8, 20, 9).toISOString(),
    ...partial,
  };
}

describe("priorityScore", () => {
  it("vencida puntúa más alto que la de hoy", () => {
    const overdue = priorityScore(makeTask({ dueDate: "2026-09-20" }), NOW);
    const today = priorityScore(makeTask({ dueDate: todayISO(NOW) }), NOW);
    expect(overdue.score).toBeGreaterThan(today.score);
  });

  it("hoy supera a la de la semana que viene", () => {
    const today = priorityScore(makeTask({ dueDate: todayISO(NOW) }), NOW);
    const future = priorityScore(makeTask({ dueDate: toISODate(addDays(startOfDay(NOW), 9)) }), NOW);
    expect(today.score).toBeGreaterThan(future.score);
  });

  it("la importancia empuja el score sin fecha", () => {
    const critical = priorityScore(makeTask({ importance: 1 }), NOW);
    const trivial = priorityScore(makeTask({ importance: 4 }), NOW);
    expect(critical.score).toBeGreaterThan(trivial.score);
  });

  it("las tareas antiguas sin fecha suben poco a poco", () => {
    const old = priorityScore(makeTask({ createdAt: new Date(2026, 7, 1).toISOString() }), NOW);
    const fresh = priorityScore(makeTask({}), NOW);
    expect(old.score).toBeGreaterThan(fresh.score);
    expect(old.reasons.some((r) => r.includes("días en la bandeja"))).toBe(true);
  });

  it("recurrente pendiente recibe impulso", () => {
    const r = priorityScore(
      makeTask({ recurrence: { kind: "daily", every: 1 }, dueDate: todayISO(NOW) }),
      NOW,
    );
    expect(r.reasons).toContain("Recurrente pendiente");
  });

  it("sortBySuggested ordena vencidas primero", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: toISODate(addDays(startOfDay(NOW), 5)) }),
      makeTask({ id: "b", dueDate: "2026-09-19" }),
      makeTask({ id: "c" }),
    ];
    const sorted = sortBySuggested(tasks, NOW);
    expect(sorted[0].id).toBe("b");
  });
});
