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