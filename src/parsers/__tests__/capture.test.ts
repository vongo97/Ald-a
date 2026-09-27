import { describe, expect, it } from "vitest";
import { parseCapture, stripDayCommands, isDayCommandWord } from "../capture";

const T = new Date(2026, 8, 22); // martes

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

describe("comandos @día", () => {
  it("@lunes = rutina de los lunes (recurrencia semanal), no etiqueta ni proyecto", () => {
    const r = parseCapture("Gimnasio temprano @lunes", { now: T });
    expect(r.title).toBe("Gimnasio temprano");
    expect(r.labels).toEqual([]);
    expect(r.projectName).toBeUndefined();
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1] });
    expect(r.dueDate).toBe("2026-09-28"); // próximo lunes (martes → +6)
  });

  it("varios @día acumulan: la fecha es el próximo de ellos", () => {
    const r = parseCapture("Estudiar @lunes @miércoles", { now: T });
    expect(r.labels).toEqual([]);
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1, 3] });
    expect(r.dueDate).toBe("2026-09-23"); // miércoles es antes que lunes
  });

  it("los plurales valen: @sabados", () => {
    const r = parseCapture("Mercado @sabados", { now: T });
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [6] });
    expect(r.dueDate).toBe("2026-09-26"); // sábado
  });

  it("si el texto trae otra fecha, la fecha del texto manda", () => {
    const r = parseCapture("Pagar recibo el jueves @lunes", { now: T });
    expect(r.dueDate).toBe("2026-09-24"); // jueves, del dateparser
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1] });
  });

  it("fusiona con la recurrencia semanal del texto: «todos los lunes @miércoles»", () => {
    const r = parseCapture("Todos los lunes @miércoles", { now: T });
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1, 3] });
    expect(r.dueDate).toBe("2026-09-28"); // la del texto
  });

  it("otra recurrencia del texto manda sobre los @día", () => {
    const r = parseCapture("Cada mes revisión @lunes", { now: T });
    expect(r.recurrence).toEqual({ kind: "monthly", every: 1 });
    expect(r.dueDate).toBe("2026-09-28"); // la próxima ocurrencia del @lunes
  });

  it("@hoy y @mañana son fechas, no etiquetas", () => {
    expect(parseCapture("Sacar basura @mañana", { now: T })).toMatchObject({
      dueDate: "2026-09-23",
      labels: [],
      recurrence: undefined,
    });
    expect(parseCapture("Sacar basura @hoy", { now: T })).toMatchObject({
      dueDate: "2026-09-22",
      labels: [],
    });
  });

  it("las etiquetas normales siguen intactas", () => {
    const r = parseCapture("Llamar a Ana @trabajo @urgente", { now: T });
    expect(r.labels).toEqual(["trabajo", "urgente"]);
    expect(r.recurrence).toBeUndefined();
  });

  it("stripDayCommands limpia el texto para la IA", () => {
    expect(stripDayCommands("Gimnasio @lunes y @mañana temprano")).toBe("Gimnasio y temprano");
    expect(stripDayCommands("@miércoles")).toBe("");
  });

  it("isDayCommandWord distingue comandos de etiquetas reales", () => {
    expect(isDayCommandWord("Miércoles")).toBe(true);
    expect(isDayCommandWord("sabados")).toBe(true);
    expect(isDayCommandWord("mañana")).toBe(true);
    expect(isDayCommandWord("urgente")).toBe(false);
    expect(isDayCommandWord("salud")).toBe(false);
  });
});
