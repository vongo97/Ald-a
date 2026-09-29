import { describe, expect, it } from "vitest";
import { monthGrid, monthLabel, WEEKDAY_HEADERS } from "../calendar";

describe("monthGrid", () => {
  it("septiembre 2026 empieza en martes y tiene 30 días", () => {
    const g = monthGrid(2026, 8);
    expect(g.weeks[0][0]).toBeNull(); // lunes 31 de agosto: relleno
    expect(g.weeks[0][1]).toBe("2026-09-01");
    const fechas = g.weeks.flat().filter((d): d is string => d !== null);
    expect(fechas).toHaveLength(30);
    expect(fechas[0]).toBe("2026-09-01");
    expect(fechas[29]).toBe("2026-09-30");
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("enero 2026 empieza en jueves", () => {
    const g = monthGrid(2026, 0);
    expect(g.weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(g.weeks[0][3]).toBe("2026-01-01");
  });

  it("febrero bisiesto: 29 días (2028)", () => {
    const g = monthGrid(2028, 1);
    const dias = g.weeks.flat().filter((d): d is string => d !== null);
    expect(dias).toHaveLength(29);
    expect(dias[28]).toBe("2028-02-29");
  });

  it("el relleno solo completa la última semana", () => {
    const g = monthGrid(2026, 8);
    expect(g.weeks.length).toBeLessThanOrEqual(6);
    const flat = g.weeks.flat();
    // índice de la última fecha real (hay relleno inicial, no basta contar)
    const ultimaPos = flat.reduce((acc, c, i) => (c !== null ? i : acc), -1);
    expect(ultimaPos).toBeGreaterThan(0);
    expect(flat.slice(ultimaPos + 1).every((c) => c === null)).toBe(true);
  });
});

describe("monthLabel", () => {
  it("en español, capitalizado y con el año", () => {
    const l = monthLabel(2026, 8);
    expect(l).toMatch(/septiembre/i);
    expect(l).toContain("2026");
    expect(l.startsWith("S")).toBe(true);
    expect(l).not.toMatch(/\sde\s/); // «Septiembre 2026», no «… de 2026»
  });
});

describe("WEEKDAY_HEADERS", () => {
  it("7 letras empezando por lunes", () => {
    expect([...WEEKDAY_HEADERS]).toHaveLength(7);
    expect(WEEKDAY_HEADERS[0]).toBe("L");
    expect(WEEKDAY_HEADERS[6]).toBe("D");
  });
});
