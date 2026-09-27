import { describe, expect, it } from "vitest";
import { resolveSchedule, timeToMin } from "../schedule";

describe("timeToMin", () => {
  it("convierte HH:mm a minutos", () => {
    expect(timeToMin("09:30")).toBe(570);
    expect(timeToMin("0:05")).toBe(5);
    expect(timeToMin("23:59")).toBe(1439);
  });

  it("formatos ilegibles dan NaN", () => {
    expect(Number.isNaN(timeToMin(""))).toBe(true);
    expect(Number.isNaN(timeToMin("9h30"))).toBe(true);
    expect(Number.isNaN(timeToMin("24:00"))).toBe(true);
    expect(Number.isNaN(timeToMin("10:61"))).toBe(true);
  });
});

describe("resolveSchedule", () => {
  it("con las dos horas crea timeBlock y calcula la duración sola", () => {
    const res = resolveSchedule({ start: "10:00", end: "11:15", duration: "999" });
    expect(res).toEqual({
      ok: true,
      changes: { timeBlock: { start: "10:00", end: "11:15" }, durationMin: 75 },
    });
  });

  it("sin horas guarda solo la duración y limpia el bloque", () => {
    const res = resolveSchedule({ start: "", end: "", duration: "30" });
    expect(res).toEqual({ ok: true, changes: { timeBlock: undefined, durationMin: 30 } });
  });

  it("todo vacío limpia bloque y duración", () => {
    const res = resolveSchedule({ start: "", end: "", duration: "" });
    expect(res).toEqual({ ok: true, changes: { timeBlock: undefined, durationMin: undefined } });
  });

  it("solo una de las dos horas es un error en español", () => {
    const soloInicio = resolveSchedule({ start: "10:00", end: "", duration: "" });
    expect(soloInicio.ok).toBe(false);
    if (!soloInicio.ok) expect(soloInicio.error).toMatch(/hora inicial y la final/);

    const soloFin = resolveSchedule({ start: "", end: "11:00", duration: "" });
    expect(soloFin.ok).toBe(false);
  });

  it("final anterior o igual a inicial es un error", () => {
    const antes = resolveSchedule({ start: "11:00", end: "10:00", duration: "" });
    expect(antes.ok).toBe(false);
    if (!antes.ok) expect(antes.error).toMatch(/posterior/);

    const igual = resolveSchedule({ start: "10:00", end: "10:00", duration: "" });
    expect(igual.ok).toBe(false);
  });

  it("horas ilegibles y duración no numérica son errores", () => {
    expect(resolveSchedule({ start: "9h", end: "10h", duration: "" }).ok).toBe(false);
    const dur = resolveSchedule({ start: "", end: "", duration: "treinta" });
    expect(dur.ok).toBe(false);
    if (!dur.ok) expect(dur.error).toMatch(/minutos/);
  });
});
