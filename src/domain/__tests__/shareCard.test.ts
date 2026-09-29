import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/types";
import { buildSharePayload, SHARE_TOP_LIMIT } from "../shareCard";

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

const TODAY = "2026-09-29";

describe("buildSharePayload", () => {
  it("refleja racha, %, contadores y fecha legible", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task({ dueDate: TODAY, status: i < 7 ? "done" : "todo" }),
    );
    const p = buildSharePayload(tasks, TODAY);
    expect(p).toMatchObject({ dateISO: TODAY, streak: 1, best: 1, pct: 70, done: 7, total: 10 });
    expect(p.dateLabel).toContain("29");
  });

  it("topTitles: hojas completadas, sin contenedores ni borradas, orden por prioridad", () => {
    const tasks = [
      // Contenedor completado: NO debe listar su título ni contar en total.
      task({ id: "p1", dueDate: TODAY, status: "done", title: "proyecto" }),
      task({ id: "h1", parentId: "p1", dueDate: TODAY, status: "done", title: "urgente", priority: 1 }),
      task({ id: "h2", parentId: "p1", dueDate: TODAY, status: "done", title: "normal", priority: 3 }),
      task({
        id: "borrada",
        dueDate: TODAY,
        status: "done",
        title: "invisible",
        deletedAt: "2026-09-29T00:00:00.000Z",
      }),
      task({ id: "pendiente", dueDate: TODAY, status: "todo", title: "no aparece" }),
      task({ id: "ayer", dueDate: "2026-09-28", status: "done", title: "otro día" }),
    ];
    const p = buildSharePayload(tasks, TODAY);
    // Las borradas sí cuentan en el %, pero no se muestran.
    expect(p).toMatchObject({ done: 3, total: 4 });
    expect(p.topTitles).toEqual(["urgente", "normal"]);
    expect(p.extraTitles).toBe(0);
  });

  it("lo que supera el tope se resume en extraTitles", () => {
    const tasks = Array.from({ length: 7 }, (_, i) =>
      task({ dueDate: TODAY, status: "done", priority: 3, order: i }),
    );
    const p = buildSharePayload(tasks, TODAY);
    expect(p.topTitles).toHaveLength(SHARE_TOP_LIMIT);
    expect(p.extraTitles).toBe(2);
  });

  it("subtarea sin fecha propia: cuenta en el día del padre y su título se lista", () => {
    const tasks = [
      task({ id: "padre", dueDate: TODAY, status: "todo" }),
      task({ id: "sub", parentId: "padre", status: "done", title: "subtarea heredada" }),
    ];
    const p = buildSharePayload(tasks, TODAY);
    expect(p.total).toBe(1); // solo la hoja
    expect(p.topTitles).toContain("subtarea heredada");
  });

  it("día sin tareas: pct 0, listas vacías y racha 0", () => {
    const p = buildSharePayload([], TODAY);
    expect(p).toMatchObject({
      streak: 0,
      pct: 0,
      done: 0,
      total: 0,
      topTitles: [],
      extraTitles: 0,
    });
  });
});
