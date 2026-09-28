import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/types";
import { computeStreaks, dayStat, weekDots } from "../streak";

let seq = 0;
function task(over: Partial<Task>): Task {
  seq++;
  return {
    id: over.id ?? `t${seq}`,
    title: "t",
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

/** N tareas en `date`, las `doneCount` primeras completadas. */
function day(date: string, total: number, doneCount: number): Task[] {
  return Array.from({ length: total }, (_, i) =>
    task({ dueDate: date, status: i < doneCount ? "done" : "todo" }),
  );
}

describe("dayStat", () => {
  it("día cumplido con exactamente el 70 % (la frontera cuenta)", () => {
    const ok = dayStat(day("2026-09-28", 10, 7), "2026-09-28");
    expect(ok).toMatchObject({ total: 10, done: 7, fulfilled: true });

    const ko = dayStat(day("2026-09-28", 10, 6), "2026-09-28");
    expect(ko.fulfilled).toBe(false);
  });

  it("los contenedores no cuentan: padre sin marcar no arrastra", () => {
    const tasks = [
      task({ id: "padre", dueDate: "2026-09-28", status: "todo" }),
      task({ id: "h1", dueDate: "2026-09-28", status: "done", parentId: "padre" }),
      task({ id: "h2", dueDate: "2026-09-28", status: "done", parentId: "padre" }),
      task({ id: "h3", dueDate: "2026-09-28", status: "done", parentId: "padre" }),
    ];
    const st = dayStat(tasks, "2026-09-28");
    expect(st).toMatchObject({ total: 3, done: 3, fulfilled: true });
  });

  it("las borradas quedan fuera y un día sin tareas no cumple", () => {
    const tasks = [
      ...day("2026-09-28", 2, 2),
      task({ dueDate: "2026-09-28", status: "todo", deletedAt: "2026-09-28T10:00:00.000Z" }),
    ];
    expect(dayStat(tasks, "2026-09-28")).toMatchObject({ total: 2, done: 2, fulfilled: true });
    expect(dayStat(tasks, "2026-09-29").fulfilled).toBe(false);
  });
});

describe("computeStreaks", () => {
  const T = "2026-09-28"; // lunes

  it("racha consecutiva incluyendo hoy", () => {
    const tasks = [...day("2026-09-26", 2, 2), ...day("2026-09-27", 2, 2), ...day(T, 2, 2)];
    expect(computeStreaks(tasks, T)).toMatchObject({ current: 3, best: 3 });
  });

  it("hoy en curso no rompe: se cuenta desde ayer", () => {
    const tasks = [...day("2026-09-27", 3, 3), ...day(T, 3, 0)];
    const s = computeStreaks(tasks, T);
    expect(s.current).toBe(1);
    expect(s.today.fulfilled).toBe(false);
  });

  it("hoy sin tareas tampoco rompe (aún no hay día)", () => {
    const tasks = [...day("2026-09-27", 2, 2)];
    expect(computeStreaks(tasks, T).current).toBe(1);
  });

  it("un día incumplido corta la racha", () => {
    const tasks = [
      ...day("2026-09-26", 2, 2),
      ...day("2026-09-27", 4, 1), // 25 % < 70 %
      ...day(T, 2, 2),
    ];
    expect(computeStreaks(tasks, T)).toMatchObject({ current: 1, best: 1 });
  });

  it("un hueco (día sin tareas) también corta, pero el mejor conserva la historia", () => {
    const tasks = [
      // Racha vieja de 3
      ...day("2026-09-10", 2, 2),
      ...day("2026-09-11", 2, 2),
      ...day("2026-09-12", 2, 2),
      // Hueco y racha reciente de 2
      ...day("2026-09-26", 2, 2),
      ...day("2026-09-27", 2, 2),
      ...day(T, 2, 2),
    ];
    const s = computeStreaks(tasks, T);
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });

  it("mejor racha histórica supera a la actual", () => {
    const tasks = [
      ...day("2026-09-01", 2, 2),
      ...day("2026-09-02", 2, 2),
      ...day("2026-09-03", 2, 2),
      ...day("2026-09-04", 2, 2),
      ...day("2026-09-05", 2, 2), // racha de 5
      ...day("2026-09-27", 2, 2),
      ...day(T, 2, 2), // racha actual de 2
    ];
    expect(computeStreaks(tasks, T)).toMatchObject({ current: 2, best: 5 });
  });
});

describe("weekDots", () => {
  // 2026-09-30 es miércoles: la semana va del lun 28 al dom 4.
  const T = "2026-09-30";

  it("labels de lunes a domingo (x = miércoles)", () => {
    const dots = weekDots([], T);
    expect(dots.map((d) => d.label)).toEqual(["l", "m", "x", "j", "v", "s", "d"]);
    expect(dots[0].date).toBe("2026-09-28");
    expect(dots[6].date).toBe("2026-10-04");
  });

  it("estados: cumplido, hoy, vacío y futuro", () => {
    const tasks = [
      ...day("2026-09-28", 2, 2), // lunes cumplido
      ...day(T, 2, 1), // hoy, en curso
    ];
    const dots = weekDots(tasks, T);
    expect(dots[0].state).toBe("done");
    expect(dots[1].state).toBe("empty"); // martes sin tareas
    expect(dots[2].state).toBe("today"); // hoy, aún sin cumplir
    expect(dots[3].state).toBe("future");
  });
});
