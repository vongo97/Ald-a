import { describe, expect, it, afterEach, vi } from "vitest";
import { newId } from "../db";

/**
 * Los ids que genera la app tienen que tener forma de uuid, SIEMPRE.
 *
 * La columna de la nube es `id uuid NOT NULL`. Un id con otra forma no sube tarde:
 * no puede subir nunca. La tarea se queda en «pendiente» para siempre, sin error
 * en ninguna parte, y solo desaparece si la borras y la vuelves a crear.
 *
 * El fallo era real y se midió. El respaldo de `randomUUID` era
 * `t-<base36>-<aleatorio>`, y `crypto.randomUUID` NO existe fuera de un contexto
 * seguro, que es https o localhost y nada más. Sirviendo el build en la IP de la
 * Wi-Fi, http://192.168.20.34:4179, el navegador contesta:
 *
 *     isSecureContext: false        crypto.randomUUID: undefined
 *
 * y el id que salía era `t-murt2nzz-qn6mnx`. En http://localhost:4179 el mismo
 * navegador da `isSecureContext: true` y un uuid de verdad. En el escritorio esto
 * no lo ve nadie; en el móvil, todas las tareas nuevas eran inservibles.
 *
 * Estos tests quitan `randomUUID` a propósito para reproducir ese origen, que es
 * la única forma de que se pueda comprobar en un ordenador.
 */

/** Lo que acepta de verdad una columna `uuid` de Postgres. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Deja la app como está en `http://192.168.20.34:4179`. */
function sinRandomUUID() {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
}

/** Como el navegador, pero sin `getRandomValues` tampoco. */
function sinNadaDeCrypto() {
  vi.stubGlobal("crypto", undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newId: siempre con forma de uuid", () => {
  it("con randomUUID disponible, sale un uuid", () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it("SIN randomUUID —que es como se abre en el móvil— tambien sale un uuid", () => {
    // Este es el test que falla con el código viejo. Sin él, el resto de la suite
    // es verde en el escritorio y la app está rota en el teléfono.
    sinRandomUUID();
    expect(newId()).toMatch(UUID_V4);
  });

  it("sin NADA de crypto tampoco sale otra cosa que no sea un uuid", () => {
    // Un navegador tan viejo que no tiene ni `getRandomValues`. No es entropía
    // criptográfica y aquí no hace falta; lo que no es admisible es que el
    // identificador tenga otra forma, porque eso ya no depende de la entropía sino
    // del tipo de la columna.
    sinNadaDeCrypto();
    expect(newId()).toMatch(UUID_V4);
  });

  it("los bits de versión y de variante van puestos", () => {
    // Un hexadecimal de 32 signos con guiones NO es un uuid: Postgres lo acepta,
    // pero no lo trata como tal. Los bits del grupo 3 y del 4 son lo que lo
    // convierte en v4, y es lo que hace el patrón de arriba, no los guiones.
    sinRandomUUID();
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id[14], id).toBe("4");
      expect("89ab", id[19]).toContain(id[19]);
    }
  });

  it("no se repite: mil ids, mil distintos", () => {
    // El respaldo anterior usaba `Date.now()` en base 36 más 6 signos de
    // `Math.random`. Sin repetir dentro de una tanda.
    sinRandomUUID();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });

  it("la forma no depende de si el navegador va más rápido o más lento", () => {
    // El respaldo anterior empezaba por la hora, así que todos los ids de la
    // misma milisegunda compartían prefijo. No es un uuid, pero además delata el
    // momento exacto de creación y bunches ids contiguos.
    sinRandomUUID();
    const ids = Array.from({ length: 50 }, () => newId());
    const prefs = new Set(ids.map((i) => i.slice(0, 8)));
    expect(prefs.size).toBe(50);
  });
});