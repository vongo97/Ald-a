import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/types";
import { buildSharePayload } from "../shareCard";

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

// Martes: la semana actual va del lunes 28 al domingo 4 de octubre.
const TODAY = "2026-09-29";
const LUN = "2026-09-28";

describe("buildSharePayload", () => {
  it("refleja racha, %, contadores y fecha legible", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task({ dueDate: TODAY, status: i < 7 ? "done" : "todo" }),
    );
    const p = buildSharePayload(tasks, TODAY);
    expect(p).toMatchObject({ dateISO: TODAY, streak: 1, best: 1, pct: 70, done: 7, total: 10 });
    expect(p.dateLabel).toContain("29");
    expect(p.week).toHaveLength(7);
    expect(p.week[0].label).toBe("l");
    expect(p.week[6].label).toBe("d");
  });

  it("PRIVACIDAD: ningún título de tarea llega a la tarjeta", () => {
    const tareas = [
      task({ dueDate: TODAY, status: "done", title: "reunión con la psicóloga" }),
      task({ dueDate: TODAY, status: "done", title: "comprar regalo de mamá" }),
      task({ dueDate: TODAY, status: "todo", title: "llamar al banco" }),
      task({ dueDate: LUN, status: "done", title: "mi experto privado" }),
    ];
    const p = buildSharePayload(tareas, TODAY);
    const json = JSON.stringify(p);
    for (const t of tareas) expect(json).not.toContain(t.title);
    // ni siquiera como campos vacíos: la forma ya no existe
    expect(p).not.toHaveProperty("topTitles");
    expect(p).not.toHaveProperty("extraTitles");
  });

  it("la semana resume en cifras: días cumplidos y tareas (lunes → hoy)", () => {
    const tasks = [
      // lunes incumplido: 1 de 4 → «missed»
      ...Array.from({ length: 4 }, (_, i) =>
        task({ dueDate: LUN, status: i === 0 ? "done" : "todo" }),
      ),
      // hoy cumplido: 3 de 3 → «done»
      ...Array.from({ length: 3 }, () => task({ dueDate: TODAY, status: "done" })),
      // futuro: no suma
      task({ dueDate: "2026-09-30", status: "done" }),
    ];
    const p = buildSharePayload(tasks, TODAY);
    expect(p.week[0]).toMatchObject({ date: LUN, state: "missed" });
    expect(p.week[1]).toMatchObject({ date: TODAY, state: "done" });
    expect(p.week[2].state).toBe("future");
    expect(p.weekFulfilled).toBe(1); // solo hoy (el lunes no se cumplió)
    expect(p.weekDone).toBe(4); // 1 del lunes + 3 de hoy; el futuro no cuenta
  });

  it("subtarea sin fecha propia: cuenta en el día del padre y sin título", () => {
    const tasks = [
      task({ id: "padre", dueDate: TODAY, status: "todo" }),
      task({ id: "sub", parentId: "padre", status: "done", title: "subtarea heredada" }),
    ];
    const p = buildSharePayload(tasks, TODAY);
    expect(p.total).toBe(1); // solo la hoja
    expect(p.done).toBe(1);
    expect(JSON.stringify(p)).not.toContain("subtarea heredada");
  });

  it("día sin tareas: pct 0, racha 0 y semana en cero", () => {
    const p = buildSharePayload([], TODAY);
    expect(p).toMatchObject({
      streak: 0,
      pct: 0,
      done: 0,
      total: 0,
      weekFulfilled: 0,
      weekDone: 0,
    });
    expect(p.week).toHaveLength(7);
  });
});
