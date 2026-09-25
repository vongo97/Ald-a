import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../recurrence";
import { toISODate } from "../dateutils";

// martes 22 sep 2026
const T = new Date(2026, 8, 22, 10);

describe("nextOccurrence", () => {
  it("diaria cada 1 → mañana", () => {
    const d = nextOccurrence({ kind: "daily", every: 1 }, T);
    expect(toISODate(d)).toBe("2026-09-23");
  });

  it("diaria cada 3 → +3 días", () => {
    const d = nextOccurrence({ kind: "daily", every: 3 }, T);
    expect(toISODate(d)).toBe("2026-09-25");
  });

  it("semanal cada 1 → +7 días", () => {
    const d = nextOccurrence({ kind: "weekly", every: 1 }, T);
    expect(toISODate(d)).toBe("2026-09-29");
  });

  it("semanal con weekdays → próximo lunes", () => {
    const d = nextOccurrence({ kind: "weekly", every: 1, weekdays: [1] }, T);
    expect(toISODate(d)).toBe("2026-09-28");
  });

  it("mensual por día del mes", () => {
    const d = nextOccurrence({ kind: "monthly", every: 1, dayOfMonth: 1 }, T);
    expect(toISODate(d)).toBe("2026-10-01");
  });

  it("mensual: primer lunes del mes siguiente", () => {
    const d = nextOccurrence(
      { kind: "monthly", every: 1, nthWeekday: { nth: 1, weekday: 1 } },
      new Date(2026, 9, 5, 10), // lunes 5 oct (el primer lunes de oct)
    );
    expect(toISODate(d)).toBe("2026-11-02"); // primer lunes de noviembre
  });

  it("anual cada 1 → +1 año", () => {
    const d = nextOccurrence({ kind: "yearly", every: 1 }, T);
    expect(toISODate(d)).toBe("2027-09-23");
  });
});
