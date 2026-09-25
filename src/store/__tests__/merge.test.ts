import { describe, expect, it } from "vitest";
import { mergeDecision, timestamp } from "../merge";

const L = "2026-09-25T10:00:00.000Z"; // lo que escribe el navegador (formato Z)
const R = "2026-09-25T12:00:00.33+00:00"; // lo que devuelve Postgres (formato +00:00)

describe("timestamp", () => {
  it("entiende el formato de Postgres y el de JavaScript por igual", () => {
    expect(timestamp("2026-09-25T12:00:00.33+00:00")).toBe(
      Date.parse("2026-09-25T12:00:00.330Z"),
    );
    expect(timestamp("2026-09-25T12:00:00.330Z")).toBe(Date.parse("2026-09-25T12:00:00.330Z"));
  });

  it("NO compara los dos formatos como texto (el bug que buscábamos evitar)", () => {
    const fromBrowser = "2026-09-25T12:00:00.330Z";
    const fromPostgres = "2026-09-25T12:00:00.33+00:00";

    // Son el mismo instante…
    expect(timestamp(fromPostgres)).toBe(timestamp(fromBrowser));

    // …pero como texto Postgres ordena ANTES que el navegador ('+' < '0'),
    // lo que haría que la nube pareciera más vieja siempre. Por eso
    // comparamos fechas, no cadenas.
    expect(fromPostgres < fromBrowser).toBe(true);
  });

  it("ausente o ilegible → 0", () => {
    expect(timestamp(undefined)).toBe(0);
    expect(timestamp(null)).toBe(0);
    expect(timestamp("")).toBe(0);
    expect(timestamp("no-es-fecha")).toBe(0);
  });
});

describe("mergeDecision", () => {
  it("lo que solo existe en la nube se baja", () => {
    expect(mergeDecision(undefined, { updatedAt: R })).toBe("take-remote");
  });

  it("gana lo más reciente cuando ambos tienen reloj", () => {
    expect(mergeDecision({ updatedAt: "2026-09-25T10:00:00Z" }, { updatedAt: "2026-09-25T11:00:00Z" })).toBe(
      "take-remote",
    );
    expect(mergeDecision({ updatedAt: "2026-09-25T12:00:00Z" }, { updatedAt: "2026-09-25T11:00:00Z" })).toBe(
      "keep-local",
    );
  });

  it("con la misma marca no se pisa nada", () => {
    expect(mergeDecision({ updatedAt: L }, { updatedAt: L })).toBe("keep-local");
  });

  // ── La propiedad de seguridad de este refactor ──────────────────────────
  it("una fila local de antes de la migración (sin updatedAt) NUNCA se pierde", () => {
    // Este es el caso real: el push estuvo roto por la columna user_id
    // inexistente, así que la nube está desactualizada y lo local es la
    // copia buena. Aunque la nube tenga fecha y lo local no, manda lo local.
    expect(mergeDecision({}, { updatedAt: R })).toBe("keep-local");
    expect(mergeDecision({ updatedAt: undefined }, { updatedAt: R })).toBe("keep-local");
  });

  it("lo local se conserva si la nube aún no está migrada (sin updated_at)", () => {
    expect(mergeDecision({ updatedAt: L }, {})).toBe("keep-local");
    expect(mergeDecision({ updatedAt: L }, { updatedAt: undefined })).toBe("keep-local");
  });

  it("si falta el reloj en los dos lados, se queda lo que había", () => {
    expect(mergeDecision({}, {})).toBe("keep-local");
  });
});
