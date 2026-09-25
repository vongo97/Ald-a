import { describe, expect, it } from "vitest";
import { dayCapacity, estimateDuration, formatMinutes } from "../capacity";
import type { Task } from "../types";

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

describe("dayCapacity", () => {
  it("no sobre-reservado con pocas tareas", () => {
    const r = dayCapacity(
      [makeTask({ dueDate: "2026-09-22", durationMin: 60 })],
      "2026-09-22",
      300,
    );
    expect(r.overbooked).toBe(false);
    expect(r.committedMin).toBe(60);
  });

  it("sobre-reservado cuando la suma pasa la capacidad", () => {
    const r = dayCapacity(
      [
        makeTask({ dueDate: "2026-09-22", durationMin: 200 }),
        makeTask({ dueDate: "2026-09-22", durationMin: 200 }),
      ],
      "2026-09-22",
      300,
    );
    expect(r.overbooked).toBe(true);
  });

  it("usa estimación heurística para tareas sin duración", () => {
    const r = dayCapacity(
      [makeTask({ dueDate: "2026-09-22", title: "Llamar alfontanero" })],
      "2026-09-22",
      300,
    );
    expect(r.estimatedMin).toBe(15);
  });

  it("ignora completadas, subtareas y otros días", () => {
    const r = dayCapacity(
      [
        makeTask({ dueDate: "2026-09-22", durationMin: 60, status: "done" }),
        makeTask({ dueDate: "2026-09-22", durationMin: 60, parentId: "p" }),
        makeTask({ dueDate: "2026-09-25", durationMin: 60 }),
      ],
      "2026-09-22",
      300,
    );
    expect(r.committedMin).toBe(0);
  });
});

describe("estimateDuration", () => {
  it("llamadas cortas", () => expect(estimateDuration(makeTask({ title: "Llamar al banco" }))).toBe(15));
  it("compras medias", () => expect(estimateDuration(makeTask({ title: "Comprar regalo" }))).toBe(30));
  it("informes largos", () => expect(estimateDuration(makeTask({ title: "Redactar informe trimestral" }))).toBe(90));
});

describe("formatMinutes", () => {
  it("formatea horas y minutos", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(150)).toBe("2 h 30 min");
  });
});
