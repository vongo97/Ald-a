import { describe, expect, it } from "vitest";
import { sealDateLabel, sealSeed, sealSpec } from "../seal";

describe("sealSeed", () => {
  it("es determinista y cambia con fecha o racha", () => {
    expect(sealSeed("2026-09-29", 3)).toBe(sealSeed("2026-09-29", 3));
    expect(sealSeed("2026-09-29", 3)).not.toBe(sealSeed("2026-09-30", 3));
    expect(sealSeed("2026-09-29", 3)).not.toBe(sealSeed("2026-09-29", 4));
  });
});

describe("sealSpec", () => {
  it("mismo día + racha → exactamente el mismo sello", () => {
    expect(sealSpec("2026-09-29", 7)).toEqual(sealSpec("2026-09-29", 7));
  });

  it("días distintos → sello distinto (coleccionable)", () => {
    expect(sealSpec("2026-09-29", 3)).not.toEqual(sealSpec("2026-09-30", 3));
  });

  it("todos los parámetros dentro de rango", () => {
    for (const [date, streak] of [
      ["2026-01-01", 1],
      ["2026-06-15", 7],
      ["2026-09-29", 30],
      ["2026-12-31", 365],
    ] as const) {
      const s = sealSpec(date, streak);
      expect(s.rays).toBeGreaterThanOrEqual(12);
      expect(s.rays).toBeLessThanOrEqual(24);
      expect(s.starPoints).toBeGreaterThanOrEqual(5);
      expect(s.starPoints).toBeLessThanOrEqual(12);
      expect(Math.abs(s.rotation)).toBeLessThanOrEqual(0.25);
      expect(s.dots).toBeGreaterThanOrEqual(3);
      expect(s.dots).toBeLessThanOrEqual(12);
      expect(s.rayLength).toHaveLength(s.rays);
      for (const len of s.rayLength) {
        expect(len).toBeGreaterThanOrEqual(0.6);
        expect(len).toBeLessThanOrEqual(1);
      }
      if (s.dash) {
        expect(s.dash).toHaveLength(2);
        for (const f of s.dash) expect(f).toBeGreaterThan(0);
      }
    }
  });
});

describe("sealDateLabel", () => {
  it("mayúsculas, con el día, sin puntos ni comas (para el anillo)", () => {
    const label = sealDateLabel("2026-09-29");
    expect(label).toBe(label.toUpperCase());
    expect(label).toContain("29");
    expect(label).not.toContain(".");
    expect(label).not.toContain(",");
    expect(label.length).toBeGreaterThan(4);
  });
});
