import { describe, expect, it } from "vitest";
import { parseCapture } from "../capture";

const T = new Date(2026, 8, 22);

describe("parseCapture", () => {
  it("extrae proyecto y etiqueta", () => {
    const r = parseCapture("Terminar informe #trabajo @correo", { projects: [{ id: "p1", name: "Trabajo" }] });
    expect(r.title).toBe("Terminar informe");
    expect(r.projectId).toBe("p1");
    expect(r.labels).toContain("correo");
  });

  it("crea proyecto nuevo si no existe", () => {
    const r = parseCapture("comprar pan #casa");
    expect(r.projectId).toBeUndefined();
    expect(r.projectName).toBe("casa");
  });

  it("prioridad !1 e importancia !2", () => {
    const r = parseCapture("entregar impuestos !1 !i2");
    expect(r.priority).toBe(1);
    expect(r.importance).toBe(2);
  });

  it("duración ~90min y ~1h", () => {
    expect(parseCapture("pintar salón ~90min").durationMin).toBe(90);
    expect(parseCapture("escribir capítulo ~2h").durationMin).toBe(120);
  });

  it("captura completa con fecha y hora", () => {
    const r = parseCapture("Llamar al proveedor mañana a las 10 #trabajo @urgente", {
      projects: [{ id: "p1", name: "trabajo" }],
      now: T,
    });
    expect(r.title).toBe("Llamar al proveedor");
    expect(r.dueDate).toBe("2026-09-23");
    expect(r.dueTime).toBe("10:00");
    expect(r.projectId).toBe("p1");
    expect(r.labels).toEqual(["urgente"]);
  });

  it("deja el título intacto si no reconoce nada", () => {
    const r = parseCapture("Regar plantas");
    expect(r.title).toBe("Regar plantas");
    expect(r.dueDate).toBeUndefined();
  });

  it("palabra urgente sube prioridad sin @", () => {
    const r = parseCapture("apagar incendio urgente");
    expect(r.priority).toBe(1);
  });
});
