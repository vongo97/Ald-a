import { describe, expect, it } from "vitest";
import { mulberry32, withAlpha } from "../paint";

describe("withAlpha", () => {
  it("convierte hex a rgba con el alfa pedido", () => {
    expect(withAlpha("#d9a441", 0.5)).toBe("rgba(217, 164, 65, 0.5)");
    expect(withAlpha("#abc", 1)).toBe("rgba(170, 187, 204, 1)");
  });

  it("si no es hex, lo devuelve tal cual (nunca rompe el dibujo)", () => {
    expect(withAlpha("rgb(1, 2, 3)", 0.3)).toBe("rgb(1, 2, 3)");
    expect(withAlpha("", 0.3)).toBe("");
  });
});

describe("mulberry32", () => {
  it("misma semilla → misma cadena", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("valores en [0, 1) y semillas distintas divergen", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });
});
