import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Un adorno decorativo nunca puede ocupar alto.
 *
 * Este fichero existe por un fallo concreto. El comentario del CSS, junto a la
 * regla del punto coral de Cronodisco, decía:
 *
 *     «En una fila (`.task-card`, …) el `::before` es un ítem flex y se alinea
 *       con el contenido»
 *
 * y es falso: `.task-card` es `display: block`. El punto se creaba su propia
 * línea encima del contenido. Medido en el navegador: ficha de 89px, contenido
 * 47px, padding 16px — **26px de hueco fantasma en cada ficha**. Se 首页 tenía
 * donde verse porque el tema es el único con ese adorno, y con veinte tareas
 * eran medio metro verticales de nada.
 *
 * Un comentario que describe una premisa puede quedarse viejo sin que nada se
 * queje: el CSS sigue compilando, la app sigue arrancando y la maqueta sigue
 * pareciendo bien en el escritorio con dos tareas. Lo único que lo delata es
 * medir la caja en el navegador, y eso no lo hace ningún test.
 *
 * Así que aquí se comprueba la regla, no el resultado. Es el mismo truco que
 * `scripts/ciMismoQueElWorkflow.test.ts`: si lo que está escrito y lo que hace
 * el código pueden separarse, se ata con un test.
 *
 * NO comprueba el hueco fantasma en píxeles. Eso solo se mide en un navegador de
 * verdad, y sigue sin estar automatizado. Lo que se fija aquí es que no se pueda
 * volver a meter un adorno en el flujo.
 */

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

interface Regla {
  selector: string;
  cuerpo: Record<string, string>;
}

/** Reglas de primer nivel. Los `@media` se leen por dentro, que es lo que importa. */
function reglas(texto: string): Regla[] {
  const salida: Regla[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const cuerpo: Record<string, string> = {};
    for (const trozo of m[2].split(";")) {
      const i = trozo.indexOf(":");
      if (i < 0) continue;
      cuerpo[trozo.slice(0, i).trim()] = trozo.slice(i + 1).trim();
    }
    // El selector arrastra el resto del `@media` que lo envuelve; se queda con
    // lo que va después de la última llave, que es la parte que importa.
    const selector = (m[1].trim().split("}").pop() ?? m[1]).trim().replace(/\s+/g, " ");
    salida.push({ selector, cuerpo });
  }
  return salida;
}

const todas = reglas(css);
const adornos = todas.filter((r) => /::(before|after)/.test(r.selector) && r.cuerpo.content !== undefined);
const conContenido = adornos.filter((r) => r.cuerpo.content !== "none");

describe("los adornos de los temas no ocupan sitio", () => {
  it("se ha encontrado algún adorno: si no, el test no mide nada", () => {
    // Guarda del extractor, como el del workflow. Un fallo de emparejamiento
    // dejaría todos los tests siguientes en verde sin comprobar nada.
    expect(conContenido.length).toBeGreaterThan(0);
    expect(adornos.some((r) => r.selector.includes("cronodisco"))).toBe(true);
    expect(adornos.some((r) => r.selector.includes("gabinete"))).toBe(true);
  });

  it("el punto coral de Cronodisco NO se queda en el flujo de la ficha", () => {
    // El fallo. `.task-card` es `display: block` —comprobado en el navegador—, así
    // que un `::before` sin `position: absolute` se abre su propia línea y empuja
    // el contenido: 26px de hueco fantasma en cada ficha.
    const punto = todas.find((r) => r.selector === '[data-theme="cronodisco"] .task-card::before');
    expect(punto, "no está la regla del punto coral sobre la ficha").toBeTruthy();
    expect(punto!.cuerpo.position, "el punto coral vuelve al flujo de la ficha").toBe("absolute");
    expect(punto!.cuerpo.margin, "el margen era para separarlo del texto en línea").toBeUndefined();
  });

  it("un adorno posicionado tiene siempre su ficha posicionada", () => {
    // El otro modo de fallo del que ya avisa el propio CSS: un `absolute` sin
    // ancestro posicionado se ancla al de más arriba de la página y el adorno
    // aparece en el otro extremo. Gabinete ya lo hace bien; se fija para todos.
    const problemas: string[] = [];
    for (const r of conContenido) {
      if (!/\.(task-card|card)\b/.test(r.selector)) continue;
      if (r.cuerpo.position !== "absolute" && r.cuerpo.position !== "fixed") continue;
      const base = r.selector.replace(/::(before|after)/, "").trim();
      const ancla = todas.find((o) => o.selector === base);
      if (!ancla || ancla.cuerpo.position !== "relative") problemas.push(r.selector);
    }
    expect(problemas).toEqual([]);
  });

  it("un adorno en el flujo solo puede caer sobre un contenedor flex", () => {
    // Aquí NO se puede comprobar la invariante completa, y conviene decir por
    // qué: si un `.card` es `display: flex`, su `::before` es un ítem flex y se
    // alinea con el contenido sin ocupar una línea de más — y hay varios así.
    // El CSS no sabe qué `display` va a tener cada elemento en tiempo de
    // ejecución, así que un test que lee el CSS no lo puede comprobar.
    //
    // Lo que sí se fija es lo medido: `.task-card` es `display: block` — está
    // comprobado en el navegador — y su adorno tiene que estar fuera del flujo.
    // El caso general queda sin cubrir a propósito, y anotado, para que no se
    // venda como una garantía que no es.
    const enFlujo = conContenido
      .filter((r) => /\.(task-card|card)\b/.test(r.selector))
      .filter((r) => r.cuerpo.position !== "absolute" && r.cuerpo.position !== "fixed")
      .map((r) => r.selector);
    // Las que quedan son las que están sobre un `.card` genérico y pueden ser
    // filas flex; solo `.task-card` —que sí se sabe que es bloque— no puede.
    const sobreFichaBloqueada = enFlujo.filter((s) => s.includes(".task-card"));
    expect(sobreFichaBloqueada).toEqual([]);
  });

  it("si el adorno está posicionado, la ficha está posicionada", () => {
    // El otro modo de fallo del que ya avisa el propio CSS: un `absolute` sin
    // ancestro posicionado se ancla al de más arriba de la página y el adorno
    // aparece en el otro extremo. Gabinete ya lo hace bien; se fija para todos.
    const problemas: string[] = [];
    for (const r of conContenido) {
      if (!/\.(task-card|card)\b/.test(r.selector)) continue;
      if (r.cuerpo.position !== "absolute" && r.cuerpo.position !== "fixed") continue;
      // Selector del mismo elemento sin la pseudo-clase.
      const base = r.selector.replace(/::(before|after)/, "").trim();
      const ancla = todas.find((o) => o.selector === base);
      if (!ancla || ancla.cuerpo.position !== "relative") problemas.push(r.selector);
    }
    expect(problemas).toEqual([]);
  });
});