import { describe, expect, it } from "vitest";
import { describeRecurrence } from "../recurrence";
import type { RecurrenceSpec } from "../types";

const D = 0, L = 1, M = 2, X = 3, J = 4, V = 5, S = 6;
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

describe("describeRecurrence: decirlo en espanol", () => {
  it("semanal con un dia", () => {
    expect(describeRecurrence({ kind: "weekly", every: 1, weekdays: [V] })).toBe("cada viernes");
  });

  it("semanal sin dia: cada semana, no un interrogante", () => {
    expect(describeRecurrence({ kind: "weekly", every: 1 })).toBe("cada semana");
    expect(describeRecurrence({ kind: "weekly", every: 2 })).toBe("cada 2 semanas");
  });

  it("varios dias en orden de calendario, no como se escribieron", () => {
    expect(describeRecurrence({ kind: "weekly", every: 1, weekdays: [X, L] })).toBe(
      "cada lunes, miércoles",
    );
  });

  it("cada n semanas conserva el dia", () => {
    expect(describeRecurrence({ kind: "weekly", every: 3, weekdays: [M] })).toBe(
      "cada 3 semanas, los martes",
    );
  });

  it("sin repetir un dia que venga dos veces", () => {
    expect(describeRecurrence({ kind: "weekly", every: 1, weekdays: [L, L] })).toBe("cada lunes");
  });

  it("diaria", () => {
    expect(describeRecurrence({ kind: "daily", every: 1 })).toBe("cada día");
    expect(describeRecurrence({ kind: "daily", every: 3 })).toBe("cada 3 días");
  });

  it("mensual por dia del mes", () => {
    expect(describeRecurrence({ kind: "monthly", every: 1, dayOfMonth: 15 })).toBe(
      "el día 15 de cada mes",
    );
    expect(describeRecurrence({ kind: "monthly", every: 2, dayOfMonth: 1 })).toBe(
      "el día 1, cada 2 meses",
    );
  });

  it("mensual por semana: el ordinal se lee, no se imprime", () => {
    const casos: Array<[number, string]> = [
      [1, "primer domingo"],
      [2, "segundo martes"],
      [3, "tercer miércoles"],
      [4, "cuarto jueves"],
      [-1, "último viernes"],
    ];
    for (const [nth, esperado] of casos) {
      const [, dia] = esperado.split(" ");
      const spec: RecurrenceSpec = {
        kind: "monthly",
        every: 1,
        nthWeekday: { nth, weekday: DIA_LARGO.indexOf(dia) },
      };
      expect(describeRecurrence(spec)).toBe(`el ${esperado} de cada mes`);
    }
  });

  it("mensual sin dia del mes ni semana: cada mes", () => {
    expect(describeRecurrence({ kind: "monthly", every: 1 })).toBe("cada mes");
    expect(describeRecurrence({ kind: "monthly", every: 3 })).toBe("cada 3 meses");
  });

  it("anual", () => {
    expect(describeRecurrence({ kind: "yearly", every: 1 })).toBe("cada año");
    expect(describeRecurrence({ kind: "yearly", every: 2 })).toBe("cada 2 años");
  });

  // Lo que no puede pasar: quedarse mudo. Una recurrencia que no se describe
  // es exactamente el fallo queiaxestaba: un 🔁 sin día.
  it("ninguna recurrencia se queda sin texto", () => {
    const todas: RecurrenceSpec[] = [
      { kind: "daily", every: 1 },
      { kind: "weekly", every: 1 },
      { kind: "weekly", every: 1, weekdays: [D] },
      { kind: "weekly", every: 5, weekdays: [S, D, L, M, X, J, V] },
      { kind: "monthly", every: 1 },
      { kind: "monthly", every: 1, nthWeekday: { nth: -1, weekday: S } },
      { kind: "monthly", every: 1, dayOfMonth: 31 },
      { kind: "yearly", every: 1 },
    ];
    for (const spec of todas) {
      const texto = describeRecurrence(spec);
      expect(texto.length, `vacio para ${JSON.stringify(spec)}`).toBeGreaterThan(0);
      expect(texto, `ilegible para ${JSON.stringify(spec)}`).not.toMatch(/\?|undefined|NaN/);
    }
  });
});