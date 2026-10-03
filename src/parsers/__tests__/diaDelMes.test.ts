import { describe, it, expect } from "vitest";
import { parseCapture } from "../capture";
import { describeRecurrence, nextOccurrence } from "@/domain/recurrence";
import { toISODate } from "@/domain/dateutils";

/**
 * El tipo `dayOfMonth`, el cálculo de la próxima fecha y el texto que lo enseña
 * ya existían desde el principio. Lo que no existía era el parser: nadie
 * escribía esa recurrencia porque nadie sabía escribirla, y el fallo era en
 * silencio — "el día 15 de cada mes" se guardaba como "cada mes", que agenda el
 * día 1 y no avisa de nada.
 */
describe("el día concreto del mes", () => {
  const HOY = new Date("2026-10-02T09:00:00"); // 2 de octubre de 2026

  it("entiende el día detrás de la palabra clave", () => {
    expect(parseCapture("Pagar el alquiler el día 15 de cada mes", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 1,
      dayOfMonth: 15,
    });
    expect(parseCapture("Revisar la cuenta el 15 de cada mes", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 1,
      dayOfMonth: 15,
    });
  });

  it("entiende el día delante de la palabra clave", () => {
    expect(parseCapture("Cada mes el día 1 revisar el presupuesto", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 1,
      dayOfMonth: 1,
    });
    expect(parseCapture("Todos los meses el día 15 enviar la factura", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 1,
      dayOfMonth: 15,
    });
  });

  it("entiende cada N meses con día", () => {
    expect(parseCapture("Cada 3 meses el día 15 renovar el dominio", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 3,
      dayOfMonth: 15,
    });
  });

  it("fija la fecha en el próximo día de ese número", () => {
    // El fallo original era que acababa el día 1. Esto es lo que lo distingue.
    expect(parseCapture("Pagar el alquiler el día 15 de cada mes", { now: HOY }).dueDate).toBe("2026-10-15");
    expect(parseCapture("Cada mes el día 1 revisar el presupuesto", { now: HOY }).dueDate).toBe("2026-11-01");
  });

  it("el día que no existe en el mes se acorta, no se pierde la tarea", () => {
    // Febrero de 2027: el día 30 no existe.
    const FEB = new Date("2027-02-03T09:00:00");
    expect(parseCapture("Cobrar el día 30 de cada mes", { now: FEB }).dueDate).toBe("2027-02-28");
  });

  it("el texto del día se quita del título", () => {
    expect(parseCapture("Pagar el alquiler el día 15 de cada mes", { now: HOY }).title).toBe("Pagar el alquiler");
    expect(parseCapture("Cada mes el día 1 revisar el presupuesto", { now: HOY }).title).toBe(
      "revisar el presupuesto",
    );
  });

  it("lo que se guarda es lo que luego se cuenta", () => {
    // Extremo a extremo: parser, cálculo y texto deben decir lo mismo. Si el
    // parser dijera una cosa y `describeRecurrence` otra, la app guardaría una
    // cosa y enseñaría otra.
    const p = parseCapture("Pagar el alquiler el día 15 de cada mes", { now: HOY });
    expect(describeRecurrence(p.recurrence!)).toBe("el día 15 de cada mes");
    expect(toISODate(nextOccurrence(p.recurrence!, new Date("2026-10-20T09:00:00")))).toBe("2026-11-15");
  });

  it("NO confunde una cantidad con un día del mes", () => {
    // "todos los meses 30 euros" es un alquiler, no el día 30 de cada mes. Por
    // eso, cuando el día va detrás de la frase, se exige la palabra "día".
    const r = parseCapture("Pagar el alquiler todos los meses 30 euros", { now: HOY }).recurrence;
    expect(r).toEqual({ kind: "monthly", every: 1 });
    expect((r as { dayOfMonth?: number }).dayOfMonth).toBeUndefined();
  });

  it("no inventa un día donde no lo hay", () => {
    expect(parseCapture("Pagar el alquiler todos los meses", { now: HOY }).recurrence).toEqual({
      kind: "monthly",
      every: 1,
    });
  });
});
