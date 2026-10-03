import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Después de index.css a propósito: en empates de especificidad gana el
// fichero de animaciones (las reglas por tema mandan sobre las base).
import "./styles/ald-a-animations.css";
import { settingsRepo } from "./store/settings";
import { seedIfEmpty, reparaIdsLocales } from "./store/db";

async function bootstrap() {
  // ANTES de sembrar y ANTES de la primera sincronización. Si fuera después, la
  // primera subida volvería a fallar con las filas viejas y el arreglo parecería
  // que no hace nada.
  const reparados = await reparaIdsLocales();
  await seedIfEmpty();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (reparados > 0) {
    // Aviso, no silencio. Cambiar identificadores es de las pocas cosas de las
    // que aquí se puede hacer sin que nadie lo note, y justamente por eso hay que
    // contarlo: si alguien tiene un respaldo en JSON de antes, sus ids ya no
    // coinciden con los del móvil, y que lo sepa es mejor que averiguarlo luego.
    console.info(`[arranque] Reparados ${reparados} ids antiguos.`);
  }
}

void bootstrap();

// PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js");
  });

  // Sin esto, tras un despliegue el usuario se queda viendo la versión
  // anterior hasta la visita siguiente: el SW nuevo hace skipWaiting y se
  // activa, pero la página ya cargó con el precache viejo. Se recarga sola.
  // El guard de `controller` evita la recarga en la primera visita (ahí aún
  // no hay controlador y el primer claim dispararía el evento), y `escribiendo`
  // evita perder lo que esté tecleando en ese momento: en ese caso se queda
  // con el comportamiento anterior (lo recoge en la próxima visita).
  if (navigator.serviceWorker.controller) {
    let refrescando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refrescando) return;
      const a = document.activeElement as HTMLElement | null;
      const escribiendo =
        !!a &&
        (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
      if (escribiendo) return;
      refrescando = true;
      window.location.reload();
    });
  }
}

// Gancho de depuración SOLO en desarrollo (el bloque se elimina en el build
// de producción): permite sembrar/inspeccionar datos desde la consola con
// `__ald.db` y generar la tarjeta con `__ald.share` para probar flujos como
// la celebración o el compartir sin ir a mano.
if (import.meta.env.DEV) {
  const w = window as unknown as { __ald?: Record<string, unknown> };
  w.__ald = {};
  void import("./store/db").then(({ db }) => {
    w.__ald!.db = db;
  });
  void import("./domain/shareCard").then((share) => {
    w.__ald!.share = share;
  });
}
