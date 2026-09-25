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

registerRoute(
  ({ url, request }) => request.method === "GET" && url.origin !== self.location.origin,
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
