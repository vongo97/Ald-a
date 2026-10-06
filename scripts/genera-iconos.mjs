/**
 * Genera los PNG del icono a partir de `public/icon.svg`.
 *
 *   npm run iconos
 *
 * Por qué un script y no los PNG a mano: el icono estaba dentro de
 * `manifest.ts` como un base64 de 512 caracteres. Eso no se puede editar, no sale
 * en un diff, y nadie lo ha revisado nunca. Como fuente de verdad, el SVG sí se
 * lee, sí se commitea y sí se revisa; y los PNG son un artefacto, igual que el
 * hash del CSP que genera `scripts/csp-hash.mjs`.
 *
 * SALIDAS, y quién las lee:
 *
 *   icon-192.png            manifest. Chrome NO ofrece «Instalar» sin un icono de
 *                           192px como mínimo.
 *   icon-512.png            manifest. Icono grande al instalar y en escritorio.
 *   icon-maskable-512.png   manifest, `purpose: "maskable"`. Android recorta el
 *                           icono a la forma del launcher (círculo, cuadrado
 *                           redondeado, gota). Por eso esta variante lleva la
 *                           silueta escalada al 95% y el fondo a sangre: lo que
 *                           quede fuera del círculo central, Android lo quita.
 *   apple-touch-icon.png    una etiqueta `<link>` del HTML, NO el manifest.
 *                           iOS no lee el manifest para el icono de la pantalla
 *                           de inicio, y sin esta etiqueta hace una captura de
 *                           pantalla de la página. Ese era el bug.
 *
 * El rasterizador es `@resvg/resvg-js` (devDependency). Se instaló porque no hay
 * ninguno en el proyecto, y `npm audit fix` lo dejó en 0 vulnerabilidades: la
 * cadena `npm run ci` incluye `npm audit --audit-level=high` y el paquete traía
 * una alta por `source-map-js`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const publicDir = join(raiz, "public");

/** Cuánto se encoge la silueta en la variante maskable. */
const ESCALA_MASKABLE = 0.95;

/**
 * Envuelve la silueta (todo menos el fondo) en una escala alrededor del centro.
 * El fondo se queda a sangre porque Android pone su propia máscara encima: si
 * el PNG trajera esquinas redondeadas se verían «orejas» al recortar. Y si el
 * fondo se escalara también, quedaría una orla transparente de 12px.
 *
 * El fondo se localiza por su `id="fondo"`, no por «el primer rect». La versión
 * anterior lo buscaba con un `replace` encadenado sobre el texto entero, y
 * fallaba SIN DAR ERROR: devolvía el SVG de antes sin tocar y los dos PNG
 * salían idénticos. Un `maskable` igual al normal es un recorte de Android que
 * se come el sol sin avisar a nadie, y se colaba porque el script se limitaba a
 * comprobar el tamaño de cada fichero, que era el mismo.
 */
function comoMaskable(svg) {
  const FONDO = /<rect[^>]*\bid="fondo"[^>]*\/>/;
  if (!FONDO.test(svg)) {
    throw new Error('el SVG no tiene <rect id="fondo">; no se puede separar el fondo de la silueta');
  }
  const cabecera = svg.match(/<svg[^>]*>/);
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/);
  const fondo = svg.match(FONDO);
  if (!cabecera || !defs || !fondo) throw new Error("el SVG no tiene la forma que se espera");

  // Todo lo de entre `</defs>` y `</svg>` es la silueta. Se recorta por posición
  // y no buscando: los dos intentos anteriores de esto, con `replace`
  // encadenados fallaron, y el primero en silencio. Recortar por posición no
  // puede fallar en silencio de esa manera.
  const desde = svg.indexOf("</defs>") + "</defs>".length;
  const hasta = svg.lastIndexOf("</svg>");
  if (desde <= 0 || hasta <= desde) throw new Error("no se puede recortar el interior del SVG");
  const silueta = svg.slice(desde, hasta).replace(fondo[0], "");

  return (
    `${cabecera[0]}\n${defs[0]}\n\n  ${fondo[0]}\n\n` +
    `  <g transform="translate(256 256) scale(${ESCALA_MASKABLE}) translate(-256 -256)">` +
    silueta +
    `  </g>\n</svg>\n`
  );
}

/** Lee el ancho y el alto de la cabecera IHDR de un PNG. */
function dimensiones(png) {
  if (png.slice(1, 4).toString("ascii") !== "PNG") throw new Error("lo generado no es un PNG");
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

function pngDe(svg, lado) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: lado } }).render().asPng();
  const { ancho, alto } = dimensiones(png);
  if (ancho !== lado || alto !== lado) {
    throw new Error(`pedidos ${lado}px y salieron ${ancho}x${alto}`);
  }
  return png;
}

const svg = readFileSync(join(publicDir, "icon.svg"), "utf8");
const maskable = comoMaskable(svg);

// El favicon es OTRO dibujo, no el mismo encogido: vive a 16-32px y el logo
// entero ahi no se lee. Sale de public/favicon.svg, que es una version
// simplificada a proposito.
const favicon = readFileSync(join(publicDir, "favicon.svg"), "utf8");

const salidas = [
  ["icon-192.png", pngDe(svg, 192)],
  ["icon-512.png", pngDe(svg, 512)],
  ["icon-maskable-512.png", pngDe(maskable, 512)],
  ["apple-touch-icon.png", pngDe(svg, 180)],
  // Los PNG del favicon no son un adorno: Safari no aplica el SVG de un
  // `<link rel="icon">` en la pestaña de forma fiable, asi que hace falta un
  // respaldo en PNG para que la pestana no se quede con el icono que hubiera
  // cacheado.
  ["favicon-32.png", pngDe(favicon, 32)],
  ["favicon-16.png", pngDe(favicon, 16)],
];

console.log(`Generados ${salidas.length} PNG desde public/icon.svg y public/favicon.svg:`);
for (const [nombre, png] of salidas) {
  writeFileSync(join(publicDir, nombre), png);
  console.log(`  ${nombre.padEnd(24)} ${String(dimensiones(png).ancho).padStart(4)}px  ${(png.length / 1024).toFixed(1)} kB`);
}

// El `maskable` TIENE que ser distinto del normal. Si coinciden, es que la
// silueta no se ha escalado y Android recortará el dibujo sin avisar. Es
// exactamente lo que pasó con la primera versión de este script: fallaba en
// silencio y solo se vio porque los dos ficheros pesaban lo mismo.
const plano = salidas.find(([n]) => n === "icon-512.png")[1];
const maskablePng = salidas.find(([n]) => n === "icon-maskable-512.png")[1];
if (plano.equals(maskablePng)) {
  console.error("");
  console.error("ERROR: icon-maskable-512.png es idéntico a icon-512.png.");
  console.error("La silueta no se ha escalado: Android recortaría el dibujo y no se vería.");
  process.exit(1);
}
console.log("");
console.log(`El maskable es distinto del normal (${plano.length} vs ${maskablePng.length} bytes): la silueta sí está escalada.`);

// Comprobación de que el maskable no se sale de la zona segura. El círculo útil
// de Android es el 80% central: radio 204,8 sobre 512. El punto más lejano de la
// silueta original es el borde exterior del sol: √(168² + 76²) + 26 = 210,4.
// Escalada al 95% son 199,9, que ya caben. Si alguien cambia el SVG y mueve el
// sol, esto avisa en vez de que lo descubra un móvil.
const MAS_LEJOS = 210.4;
const trasEscalar = MAS_LEJOS * ESCALA_MASKABLE;
console.log("");
if (trasEscalar > 204.8) {
  console.error(
    `AVISO: la silueta escalada llega a ${trasEscalar.toFixed(1)} y la zona segura acaba en 204,8. ` +
      `Con este recorte se perdería parte del dibujo en Android.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Zona segura de Android: la silueta llega a ${trasEscalar.toFixed(1)} px y el círculo útil acaba en 204,8. Cabe.`,
  );
}