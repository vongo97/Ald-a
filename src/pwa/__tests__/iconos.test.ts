import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { manifest } from "../manifest";

/**
 * Los iconos existen, y el manifest y el HTML los apuntan.
 *
 * Esto parece burocracia y es lo contrario: el icono estaba embebido como un
 * base64 dentro de `manifest.ts`. Eso no se puede editar ni ver en un diff, y
 * para colarlo en el HTML hay que acordarse de hacerlo — que es exactamente lo
 * que pasó. El `apple-touch-icon` no existía, iOS no lo busca en el manifest, y
 * el resultado era una captura de pantalla de la página en la pantalla de
 * inicio. Sin este test, el siguiente cambio de icono puede volver a romper
 * cualquiera de las cuatro piezas sin que nada se entere.
 */

const raiz = new URL("../../../", import.meta.url);
const leer = (relativo: string) => readFileSync(fileURLToPath(new URL(relativo, raiz)), "utf8");

/** El ancho y el alto están en la cabecera IHDR del PNG, bytes 16..24. */
function dimensiones(png: Buffer): { ancho: number; alto: number } {
  if (png.slice(1, 4).toString("ascii") !== "PNG") throw new Error("no es un PNG");
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

const html = leer("index.html");

describe("los iconos están y son de verdad", () => {
  const iconos = manifest.icons ?? [];

  it("el manifest declara iconos, y no vuelve a haber un base64 dentro", () => {
    // El base64 en línea era el problema: invisible en un diff e ineditable. Si
    // vuelve a aparecer, hay que volver a generar los ficheros.
    expect(iconos.length).toBeGreaterThanOrEqual(3);
    for (const i of iconos) expect(String(i.src)).not.toMatch(/^data:/);
  });

  it("Chrome puede ofrecer «Instalar»: hace falta un icono de 192", () => {
    // Chrome no muestra el aviso de instalación sin un icono de 192px como
    // mínimo. Sin este, la app no se puede instalar en Android ni en escritorio.
    expect(iconos.some((i) => i.sizes === "192x192")).toBe(true);
  });

  it("hay una variante maskable para el recorte de Android", () => {
    // Android recorta el icono a la forma del launcher. Sin `maskable`, recorta
    // el dibujo por el medio sin avisar: en este logo se comería el sol.
    expect(iconos.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("todos los ficheros del manifest existen y tienen el tamaño que se declara", () => {
    const fallos: string[] = [];
    for (const i of iconos) {
      // El `src` del manifest es una RUTA DE URL, no una ruta de disco: empieza
      // por `/` porque al desplegar, `public/` se copia en la raíz del sitio. En
      // disco el fichero vive en `public/`. Este es el contrato, y es donde se
      // cuelan los 404 de iconos: el manifest dice `/icon-512.png`, el fichero
      // está en `public/icon-512.png`, y si alguien lo sube a `src/` el sitio
      // sigue compilando pero el icono desaparece sin ningún error.
      const ruta = fileURLToPath(new URL(String(i.src).replace(/^\//, ""), new URL("public/", raiz)));
      if (!existsSync(ruta)) {
        fallos.push(`${i.src} apunta a public/${String(i.src).slice(1)} y ese fichero no existe`);
        continue;
      }
      const bytes = readFileSync(ruta);
      // El manifest declara también el SVG, que no es PNG y no tiene cabecera
      // IHDR. De él solo se comprueba que existe y que no está vacío.
      if (i.type !== "image/png") {
        if (bytes.length < 500) fallos.push(`${i.src} pesa ${bytes.length} bytes: parece vacío`);
        continue;
      }
      const { ancho, alto } = dimensiones(bytes);
      if (i.sizes === "any") continue;
      const [w, h] = String(i.sizes).split("x").map(Number);
      if (ancho !== w || alto !== h) fallos.push(`${i.src} declara ${i.sizes} y mide ${ancho}x${alto}`);
      // Un PNG de un solo color pesa muchísimo menos. Si un icono sale de 200
      // bytes, es un plano: el dibujo no se ha rasterizado.
      if (bytes.length < 1200) fallos.push(`${i.src} pesa ${bytes.length} bytes: parece un color plano`);
    }
    expect(fallos).toEqual([]);
  });
});

describe("iOS tiene su propia etiqueta, y no la busca en el manifest", () => {
  it("el HTML declara apple-touch-icon", () => {
    // iPhone NO lee el manifest para el icono de la pantalla de inicio. Sin
    // esta etiqueta hace una captura de pantalla de la página.
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"/);
    expect(html).toMatch(/rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/);
  });

  it("ese fichero existe y es cuadrado", () => {
    const png = readFileSync(fileURLToPath(new URL("public/apple-touch-icon.png", raiz)));
    const { ancho, alto } = dimensiones(png);
    expect(ancho).toBe(180);
    expect(alto).toBe(180);
  });
});

describe("el favicon de la pestaña es otro dibujo, y a propósito", () => {
  const favicon = leer("public/favicon.svg");
  const pintado = favicon.replace(/<!--[\s\S]*?-->/g, "");

  it("el HTML lo declara y ya no hay el base64 de la plantilla de Vite", () => {
    // El base64 anterior dibujaba un check azul de Vite: era el icono de la
    // pestaña de todo el mundo. Por eso, aun con el icono de la app puesto,
    // en la pestaña seguia viendo el dibujo equivocado.
    expect(html).not.toMatch(/rel="icon"[^>]*base64,/);
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
  });

  it("los tres ficheros existen y el PNG mide lo que la etiqueta declara", () => {
    const fallos: string[] = [];
    // Se parsea la etiqueta ENTERA, no solo el href. La version anterior
    // buscaba el tamano esperado en la ruta del fichero, y las rutas son
    // /favicon-16.png, no /16x16.png: asi que el tamano no se comprobaba
    // NUNCA y un PNG de 200 bytes pasaba el filtro como si fuera un icono.
    const etiquetas = [...html.matchAll(/<link[^>]+rel="icon"[^>]*>/g)].map((m) => m[0]);
    expect(etiquetas.length).toBeGreaterThanOrEqual(3);
    expect(etiquetas.some((t) => t.includes('href="/favicon.svg"'))).toBe(true);

    for (const etiqueta of etiquetas) {
      const src = etiqueta.match(/href="(\/[^"]+)"/)?.[1];
      if (!src) {
        fallos.push(`una etiqueta rel="icon" no tiene href: ${etiqueta}`);
        continue;
      }
      const ruta = fileURLToPath(new URL(String(src).slice(1), new URL("public/", raiz)));
      if (!existsSync(ruta)) {
        fallos.push(`${src} no existe`);
        continue;
      }
      const bytes = readFileSync(ruta);
      if (!src.endsWith(".png")) {
        if (bytes.length < 500) fallos.push(`${src} pesa ${bytes.length} bytes: parece vacío`);
        continue;
      }
      const declarado = etiqueta.match(/sizes="(\d+)x(\d+)"/);
      if (!declarado) {
        fallos.push(`${src} es un PNG pero su etiqueta no declara sizes`);
        continue;
      }
      const { ancho, alto } = dimensiones(bytes);
      if (ancho !== Number(declarado[1]) || alto !== Number(declarado[2])) {
        fallos.push(`${src} declara ${declarado[1]}x${declarado[2]} y mide ${ancho}x${alto}`);
      }
      // Un PNG de 16x16 que sea de un solo color pesa alrededor de 70 bytes; el
      // de verdad, 438. El umbral va holgado para no ser fragil, pero por
      // debajo de 150 es un plano y el dibujo no se ha rasterizado.
      if (bytes.length < 150) fallos.push(`${src} pesa ${bytes.length} bytes: parece un color plano`);
    }
    expect(fallos).toEqual([]);
  });

  it("no es el logo entero: el anillo y el check se quitaron a proposito", () => {
    // Este es el guard que mas importa. El logo entero MEDIDO a 16px deja 44
    // pixeles de 256 sueltos: se ve como un chisporroteo, no como una A. Si
    // alguien "simplifica" el favicon poniendo aqui el icono grande, esto
    // salta. Los tres elementos que se descartaron son los que no sobreviven
    // al encogimiento.
    expect(pintado).not.toContain("url(#gradC)");   // el anillo
    expect(pintado).not.toContain('stroke="#c1502e"'); // el check
    expect((pintado.match(/<path/g) ?? []).length).toBe(2); // las dos de la A
  });

  it("el ojo de la A sigue abierto, que es lo que hace que se lea como letra", () => {
    // Con el trazo a 72 el travesano se comia el hueco del medio y la A
    // parecia un triangulo macizo. Esto no mide el dibujo: comprueba que el
    // travesano es mas fino que las patas y que va ancho, que es lo que
    // mantiene abierto el ojo entre las dos.
    const patas = Number(favicon.match(/M150 378[\s\S]*?stroke-width="(\d+)"/)?.[1]);
    const travesano = Number(favicon.match(/M180 296[\s\S]*?stroke-width="(\d+)"/)?.[1]);
    expect(patas).toBeGreaterThan(0);
    expect(travesano).toBeGreaterThan(0);
    expect(travesano).toBeLessThan(patas);
    // Y lo bastante ancho para alcanzar las dos patas: si no, son dos rayas
    // sueltas y no una letra.
    expect(favicon).toMatch(/M1\d\d 296 L3\d\d 296/);
  });

  it("los colores son los mismos que los del icono grande", () => {
    const mio = leer("public/icon.svg").replace(/<!--[\s\S]*?-->/g, "");
    for (const c of ["#1a1512", "#c1502e", "#d9a441", "#f2c14e"]) {
      expect(pintado, `falta ${c} en el favicon`).toContain(c);
      expect(mio, `${c} no esta en el icono grande`).toContain(c);
    }
  });

  it("este lleva esquinas redondeadas y el icono grande no, a proposito", () => {
    // Aqui no hay ningun sistema que aplique su propia mascara, asi que el
    // redondeo se trae. En el icono grande ocurre lo contrario: iOS y Android
    // lo ponen, y si el PNG trajera ya las esquinas redondeadas con
    // transparencia se verian orejas.
    expect(pintado).toMatch(/<rect[^>]*rx="\d+"/);
    const grande = leer("public/icon.svg").replace(/<!--[\s\S]*?-->/g, "");
    expect(grande).not.toMatch(/<rect[^>]*id="fondo"[^>]*rx=/);
  });

  it("no hay rayas dobles en los comentarios", () => {
    // Esto es XML y las rayas dobles estan prohibidas en un comentario. Ya
    // costo una vez, cuando se escribio el nombre de una variable de CSS tal
    // cual y resvg rechazo el SVG entero.
    for (const c of favicon.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(c.slice(4, -3), "doble raya dentro de un comentario").not.toContain("--");
    }
  });
});

describe("el origen del icono se puede editar", () => {
  const svg = leer("public/icon.svg");

  it("el SVG tiene el fondo marcado, que es lo que separa el maskable", () => {
    // El generador separa el fondo de la silueta por `id="fondo"`. Sin el, el
    // maskable no se puede construir: y cuando le faltaba, el script devolvía
    // el SVG sin tocar y generaba un maskable IDÉNTICO al normal, sin error.
    expect(svg).toMatch(/<rect[^>]*id="fondo"/);
  });

  it("los colores del icono son de la paleta del proyecto", () => {
    // Se mira el SVG SIN comentarios. El comentario del propio fichero explica
    // los colores viejos que se quitaron y por qué, así que buscarlos en el
    // texto entero las encuentra y el test falla siempre. Lo que importa es lo
    // que resvg pinta, no lo que el fichero dice de sí mismo.
    const pintado = svg.replace(/<!--[\s\S]*?-->/g, "");
    expect(pintado.length).toBeGreaterThan(500);

    // Seis colores en total. Cuatro son valores exactos de index.css, uno es el
    // dorado de tu logo, y solo uno es nuevo.
    const delProyecto = ["#1a1512", "#c1502e", "#d9a441", "#8a93b8"];
    for (const c of delProyecto) expect(pintado, `falta ${c}`).toContain(c);
    // El único color que no viene de la paleta es el extremo oscuro del anillo,
    // y está porque el de antes no se veía.
    expect(pintado).not.toContain("#3a4260");
    expect(pintado).toContain("#5a6480");
  });

  it("esos cuatro colores están de verdad en la paleta del proyecto", () => {
    // La frase "son colores de la paleta" no vale nada si solo se comprueba que
    // las cadenas están en el fichero del icono. Lo que la hace verdad es que
    // esos mismos valores estén en index.css. Esto lo comprueba.
    const css = leer("src/index.css").toLowerCase();
    for (const c of ["#1a1512", "#c1502e", "#d9a441", "#8a93b8"]) {
      expect(css, `${c} no aparece en src/index.css: el icono usa un color inventado`).toContain(c);
    }
  });

  it("no hay rayas dobles dentro de los comentarios del SVG", () => {
    // El SVG es XML y ahí las rayas dobles están prohibidas. Escribir el nombre
    // de una variable de CSS tal cual hizo que resvg rechazara el SVG entero.
    const comentarios = svg.match(/<!--[\s\S]*?-->/g) ?? [];
    for (const c of comentarios) {
      expect(c.slice(4, -3), "doble raya dentro de un comentario").not.toContain("--");
    }
  });
});