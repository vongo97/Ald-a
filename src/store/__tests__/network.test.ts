import { describe, expect, it } from "vitest";
import { esCaidaDeRed } from "../sync";

/**
 * Qué color pinta el puntito de la barra de navegación.
 *
 * La diferencia importa más de lo que parece. «Error de sincronización» en rojo
 * significa «algo está mal con esta app»: la gente va a Ajustes, a cerrar la
 * pestaña, a pensar que sus datos están en peligro. «Sin conexión» en gris
 * significa «estás sin internet, tus datos están aquí contigo». Es la misma
 * situación —sin red— y en una solo hay que experimentally malgastar tiempo.
 *
 * El fallo era que `offline` existía en el tipo de estado y tenía su etiqueta,
 * pero NADA lo ponía nunca: sin red se pintaba rojo de alarma.
 */
describe("esCaidaDeRed", () => {
  it("reconoce el TypeError de fetch", () => {
    // Es lo que devuelve supabase-js cuando la petición ni siquiera sale: no hay
    // respuesta, luego no hay código HTTP, solo un `TypeError` de `fetch`.
    expect(esCaidaDeRed({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(esCaidaDeRed({ message: "Failed to fetch" })).toBe(true);
  });

  it("reconoce los otros nombres de la misma cosa", () => {
    for (const msg of [
      "NetworkError when attempting to fetch resource.",
      "network request failed",
      "Load failed",
      "connect ECONNREFUSED 127.0.0.1:54321",
      "TypeError: Network request failed",
    ]) {
      expect(esCaidaDeRed({ message: msg }), msg).toBe(true);
    }
  });

  it("NO confunde un fallo de verdad con estar sin red", () => {
    // Esto es un error de la app o de la configuración, y el usuario SÍ tiene
    // que enterarse: si lo camuflamos de «sin conexión», la app parece no hacer
    // nada y nadie investiga.
    for (const msg of [
      "new row violates row-level security policy for table \"tasks\"",
      "relation \"tasks\" does not exist",
      "Invalid JWT",
      "JWT expired",
      "duplicate key value violates unique constraint",
      "permission denied for table tombstones",
    ]) {
      expect(esCaidaDeRed({ message: msg }), msg).toBe(false);
    }
  });

  it("un error sin mensaje no se inventa un diagnóstico", () => {
    expect(esCaidaDeRed(null)).toBe(false);
    expect(esCaidaDeRed(undefined)).toBe(false);
    expect(esCaidaDeRed({})).toBe(false);
  });

  it("acepta el error plano, no solo el objeto con `message`", () => {
    // El catch final de `pullAndSyncFromSupabase` recibe la excepción cruda,
    // que puede ser un string.
    expect(esCaidaDeRed("TypeError: Failed to fetch")).toBe(true);
  });
});