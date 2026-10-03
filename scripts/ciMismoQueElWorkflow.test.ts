import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Lo que corre en local y lo que corre en el CI no pueden separarse.
 *
 * El CI estuvo trece pushes en rojo y no me enteré. La causa inmediata fue un
 * test que dependía de un `.env` que existe en mi máquina y no en el CI. Pero la
 * causa de fondo era otra: yo no ejecutaba la cadena del CI. Lanzaba `tsc -b`,
 * `vite build` y `vitest` por separado, que es casi lo mismo que
 * `typecheck && test && build && audit`, pero no es lo mismo. En verde local y
 * en rojo remoto, sin que nada dijera por qué.
 *
 * `npm run ci` es ahora esa cadena, y `.githooks/pre-push` la ejecuta antes de
 * subir. Lo que este test fija es que la cadena local y el workflow sigan siendo
 * la misma cosa: si alguien añade un paso al workflow y no a `npm run ci`, esto
 * cae, y con ello el hook deja de ser una garantía y vuelve a ser un adorno.
 *
 * No se usa un parser de YAML a propósito: no hay ninguno en el proyecto, y meter
 * una dependencia para leer un fichero de configuración no compensa. Se leen las
 * líneas `run:`, que es lo único que hace falta saber. Y hay un test que
 * comprueba que el extractor sigue viendo los pasos, porque si algún día el
 * workflow se reescribe de una forma que no entiende, lo que tiene que pasar es
 * un rojo que diga «mira esto», no un verde que no comprueba nada.
 */

const raiz = new URL("../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/ci.yml", raiz), "utf8");
const hook = readFileSync(new URL(".githooks/pre-push", raiz), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("package.json", raiz), "utf8")) as {
  scripts: Record<string, string>;
};

const CADENA = "__audit__";

/** Los comandos que el workflow ejecuta de verdad, uno por paso. */
function comandosDelWorkflow(): string[] {
  return workflow
    .split(/\r?\n/)
    .filter((l) => /^\s*-?\s*run:/.test(l))
    .map((l) => l.replace(/^\s*-?\s*run:\s*/, "").replace(/\s*#.*$/, "").trim());
}

/** A qué comprobación apunta un comando, o `null` si no apunta a ninguna. */
function comprobacion(comando: string): string | null {
  const m = /^npm run ([\w:-]+)/.exec(comando);
  if (m) return m[1];
  if (/^npm test\b/.test(comando)) return "test";
  if (/^npm audit\b/.test(comando)) return CADENA;
  return null;
}

/** Las comprobaciones que `npm run ci` encadena, en su orden. */
function comprobacionesLocales(): string[] {
  const cadena = packageJson.scripts.ci ?? "";
  return [...cadena.matchAll(/npm run ([\w:-]+)|npm test\b|npm audit[^\s]*/g)].map((m) =>
    m[1] ?? (m[0].startsWith("npm test") ? "test" : CADENA),
  );
}

describe("la cadena local es la misma que la del CI", () => {
  const delWorkflow = comandosDelWorkflow();
  const locales = comprobacionesLocales();

  it("el extractor sigue viendo los pasos del workflow", () => {
    // Guarda del extractor. Sin esto, un workflow reescrito que este regex no
    // entendiera dejaría todos los tests de abajo Millan de gris sin avisar.
    expect(delWorkflow.length).toBeGreaterThanOrEqual(4);
    expect(delWorkflow).toContain("npm ci");
  });

  it("cada comprobacion del workflow esta en la cadena local", () => {
    const faltan: string[] = [];
    for (const cmd of delWorkflow) {
      const c = comprobacion(cmd);
      if (c === null) continue;
      if (!locales.includes(c)) faltan.push(`el CI hace "${cmd}" y npm run ci no`);
    }
    expect(faltan).toEqual([]);
  });

  it("cada script que llama la cadena local existe", () => {
    // Una cadena que llama a un script que ya no está pasa los dos tests
    // anteriores y no comprueba nada.
    expect(locales.length).toBeGreaterThan(0);
    for (const c of locales) {
      if (c === CADENA) continue;
      expect(packageJson.scripts[c], `npm run ci llama a "${c}", que no existe`).toBeTruthy();
    }
  });

  it("la auditoria se ejecuta igual en los dos lados, con el mismo nivel", () => {
    // Es la única comprobación del CI que no es un script propio: va con su
    // `--audit-level` en la línea. Si uno de los dos lo sube o lo quita, dejan
    // de ser lo mismo sin que se note.
    const enElWorkflow = delWorkflow.find((c) => /^npm audit/.test(c));
    expect(enElWorkflow).toBeTruthy();
    expect(packageJson.scripts.ci).toContain(enElWorkflow);
  });

  it("el pre-push llama a la cadena y no a una copia de ella", () => {
    // Si el hook tuviera los comandos escritos a mano, se separaría de
    // `npm run ci` en cuanto cambiara uno de los dos, y sería otro sitio donde
    // no se ejecuta lo que el CI ejecuta.
    expect(hook).toMatch(/npm run ci\b/);
  });

  it("el hook tiene shebang y es ejecutable", () => {
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
    // Si el bit de ejecución falta, git no lo lanza y el hook no hace nada sin
    // decir nada, que es el peor de los casos: crees que te está protegiendo.
    expect(hook).toMatch(/npm run ci/);
  });

  it("se puede instalar en un solo comando", () => {
    // El hook no se distribuye con el clon —git no lee hooks del repo salvo que
    // se le diga— así que la manera de activarlo tiene que ser una sola orden
    // que ya exista, no una instrucción suelta en un fichero que nadie abre.
    expect(packageJson.scripts["hooks:install"]).toMatch(/core\.hooksPath \.githooks/);
  });
});