import type { ManifestOptions } from "vite-plugin-pwa";

/**
 * Iconos como ficheros, no como base64 dentro de este fichero.
 *
 * Antes había un `data:image/svg+xml;base64,…` de 512 caracteres pegado aquí.
 * Eso no se puede editar, no sale en un diff y nadie lo ha revisado nunca. El
 * origen es ahora `public/icon.svg`, y los PNG los genera `npm run iconos`.
 *
 * Las cuatro piezas y quién las lee:
 *
 *   icon-512           este manifest. Icono grande al instalar y en escritorio.
 *   icon-192           este manifest. Chrome NO ofrece «Instalar» sin uno de 192.
 *   icon-maskable-512  este manifest, `purpose: "maskable"`. Android recorta el
 *                      icono a la forma del launcher; esta variante lleva la
 *                      silueta escalada al 95% para que el recorte no se coma
 *                      el sol.
 *   apple-touch-icon   una etiqueta `<link>` del HTML, en index.html. NO es el
 *                      manifest: iOS no lo lee para el icono de la pantalla de
 *                      inicio, y sin esa etiqueta hace una captura de pantalla.
 *
 * El SVG se declara aparte, para los navegadores que lo saben usar.
 */
export const manifest: Partial<ManifestOptions> = {
  id: "/",
  name: "Mis Tareas",
  short_name: "Tareas",
  description: "Gestor de tareas con captura en lenguaje natural, planes de día e IA opcional.",
  lang: "es",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#1a1512",
  theme_color: "#1a1512",
  icons: [
    {
      src: "/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};
