/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

cleanupOutdatedCaches();

const handler = createHandlerBoundToURL("index.html");
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/sw\.js$/],
});
registerRoute(navigationRoute);

registerRoute(
  ({ request }) => request.destination === "font" || request.destination === "style" || request.destination === "script",
  new StaleWhileRevalidate({ cacheName: "assets-v1" }),
);

// ⚠️ El origen de Supabase queda EXPRESAMENTE FUERA del caché.
//
// Este route cachea por defecto toda GET a terceros, y eso incluía
// `*.supabase.co`: las respuestas de `/rest/v1/...` viajan en la cabecera
// Authorization y SON los datos del usuario. Cachearlas tiene dos efectos:
//
//   1. Sin red, la app sigue pintando tareas desde el caché, en claro.
//   2. La caché del service worker sobrevive al cierre de sesión (y al
//      cierre del navegador), así que en un dispositivo compartido las
//      respuestas quedan ahí, legibles desde DevTools.
//
// Sync ya tolera los fallos: `pushLocalChanges` aborta si la nube no
// responde y el pull deja lo local intacto. Perder el cacheo de la API no
// rompe nada; solo se pierde algo de velocidad sin conexión.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin !== self.location.origin &&
    !url.hostname.endsWith(".supabase.co"),
  new NetworkFirst({
    cacheName: "api-v1",
    networkTimeoutSeconds: 5,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Con registerType autoUpdate, activa el nuevo SW en cuanto esté listo
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
