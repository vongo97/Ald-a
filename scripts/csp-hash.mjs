#!/usr/bin/env node
/**
 * Comprueba (o actualiza) el hash del script inline de index.html dentro del
 * Content-Security-Policy de vercel.json.
 *
 * POR QUÉ EXISTE
 *   El CSP usa `script-src 'self' 'sha256-...'` en vez de `'unsafe-inline'`
 *   para no abrir la puerta a XSS. El hash debe corresponder EXACTAMENTE a los
 *   bytes del <script> inline tal como los sirve Vite tras el build (Vite
 *   reindenta el HTML, así que NO coincide con el hash del fuente).
 *
 *   Si el hash no coincide, el navegador bloquea el script de tema que evita
 *   el parpadeo y el fallo es SILENCIOSO: la app sigue funcionando (el tema se
 *   aplica luego desde React), pero se pierde el pre-paint. Solo se ve como un
 *   error en la consola. Este script convierte esa trampa en un check.
 *
 * USO
 *   npm run build && npm run csp:hash          # verifica, sale !=0 si cambió
 *   npm run build && npm run csp:hash:write    # reescribe el hash en vercel.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "dist/index.html"), "utf8");

// Primer <script> sin atributo src = el bloque inline del tema.
const match = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
  console.error("✗ No se encontró ningún <script> inline en dist/index.html");
  process.exit(1);
}

const expected =
  "sha256-" + createHash("sha256").update(match[1], "utf8").digest("base64");

const vercelPath = resolve(root, "vercel.json");
const vercelRaw = readFileSync(vercelPath, "utf8");
const declared = vercelRaw.match(/'sha256-[A-Za-z0-9+/=]+'/)?.[0]?.slice(1, -1);

if (!declared) {
  console.error("✗ No hay ningún 'sha256-...' en el CSP de vercel.json");
  process.exit(1);
}

if (declared === expected) {
  console.log(`✓ Hash del CSP correcto: ${expected}`);
  process.exit(0);
}

if (process.argv.includes("--write")) {
  writeFileSync(vercelPath, vercelRaw.replace(declared, expected));
  console.log(`✓ Hash actualizado en vercel.json`);
  console.log(`  antes:   ${declared}`);
  console.log(`  ahora:   ${expected}`);
  process.exit(0);
}

console.error("✗ El hash del CSP NO coincide con dist/index.html");
console.error(`  declarado: ${declared}`);
console.error(`  real:      ${expected}`);
console.error("  Ejecuta:  npm run csp:hash:write");
process.exit(1);
