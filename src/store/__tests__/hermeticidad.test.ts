import { describe, expect, it } from "vitest";

/**
 * La suite tiene que ser hermética: sus resultados no pueden depender de que en
 * esta máquina haya un `.env`.
 *
 * No es una manía. El CI estuvo trece pushes en verde sobre papel y en rojo de
 * verdad, y la causa fue exactamente esto: `supabase.ts` lee las variables de
 * entorno AL CARGAR EL MÓDULO y llama a `createClient`, que con la URL vacía
 * lanza. En local el `.env` tapaba el agujero; en el CI, donde el `.env` no está
 * porque está en `.gitignore`, el fichero moría antes de la primera aserción.
 *
 * Estos tests se escribieron DESPUÉS de arreglarlo, y por eso tienen esta forma
 * rara: importan el cliente de verdad, sin doble, para comprobar que el fichero
 * es capaz de cargarse. Un doble no serviría: el fallo estaba en el import, no
 * en usar el cliente.
 */

/**
 * Import real, no un doble. Este import ES la prueba: si `supabase.ts` no
 * pudiera construirse, el fichero entero no cargaría y esto no se vería nunca.
 */
import { supabase } from "../supabase";
// Import real de `sync.ts`, sin dobles. Esta línea ES la regresión: es lo que
// hacía `network.test.ts` y lo que lo tumbaba. `sync.ts` arrastra `supabase.ts`,
// que llama a `createClient` al cargarse.
import * as sync from "../sync";

describe("la suite no depende de que haya un .env", () => {
  it("el cliente de la nube se puede cargar sin variables de entorno", () => {
    // Si esto falla, el fichero de test no ha llegado a empezar: por eso el
    // fallo sale como «failed to load» y no como una aserción roja.
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe("function");
  });

  it("un modulo que arrastra la nube se puede cargar igual", () => {
    // Lo que reventaba de verdad: no importar el cliente, sino importar algo
    // que lo importa. Con el setup puesto, esto carga.
    expect(typeof sync.pullAndSyncFromSupabase).toBe("function");
    expect(typeof sync.esCaidaDeRed).toBe("function");
  });

  it("el setup deja las dos variables puestas", () => {
    // El arreglo está en `src/test-setup.ts`. Si alguien lo quita, esto falla
    // en el CI —donde no hay `.env`— aunque en local siga en verde.
    expect(import.meta.env.VITE_SUPABASE_URL).toBeTruthy();
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeTruthy();
  });
});