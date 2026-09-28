import { describe, expect, it } from "vitest";
import {
  CELEBRATION_PHRASES,
  celebrationPhrase,
  dayJustCompleted,
} from "../celebration";

describe("dayJustCompleted", () => {
  it("solo la transición false → true dispara la celebración", () => {
    expect(dayJustCompleted(false, true)).toBe(true);
    expect(dayJustCompleted(true, true)).toBe(false); // ya cumplido: nada al abrir
    expect(dayJustCompleted(true, false)).toBe(false); // deshacer no celebra
    expect(dayJustCompleted(false, false)).toBe(false);
  });
});

describe("celebrationPhrase", () => {
  it("devuelve una frase de la lista", () => {
    expect(CELEBRATION_PHRASES).toContain(celebrationPhrase());
  });

  it("con RNG inyectable es determinista (0 → primera)", () => {
    expect(celebrationPhrase(() => 0)).toBe(CELEBRATION_PHRASES[0]);
    expect(celebrationPhrase(() => 0.99)).toBe(
      CELEBRATION_PHRASES[CELEBRATION_PHRASES.length - 1],
    );
  });

  it("ninguna frase vacía", () => {
    for (const p of CELEBRATION_PHRASES) expect(p.trim().length).toBeGreaterThan(0);
  });
});
