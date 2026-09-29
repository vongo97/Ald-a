import { describe, expect, it } from "vitest";
import { qrMatrix } from "../qr";

const ENLACE = "https://ald-a.vercel.app";

describe("qrMatrix", () => {
  const m = qrMatrix(ENLACE);

  it("es cuadrado y de tamaño de QR real (≥ 21×21)", () => {
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });

  it("lleva el patrón de búsqueda en la esquina superior izquierda", () => {
    // anillo exterior oscuro de 7×7
    expect(m[0][0]).toBe(true);
    expect(m[0][6]).toBe(true);
    expect(m[6][0]).toBe(true);
    expect(m[6][6]).toBe(true);
    // separador claro
    expect(m[1][1]).toBe(false);
    // núcleo oscuro 3×3
    expect(m[2][2]).toBe(true);
    expect(m[3][3]).toBe(true);
    expect(m[4][4]).toBe(true);
  });

  it("es determinista: mismo texto, misma matriz", () => {
    expect(qrMatrix(ENLACE)).toEqual(m);
  });

  it("otro texto produce otra matriz", () => {
    expect(qrMatrix("https://otro-ejemplo.es")).not.toEqual(m);
  });
});
