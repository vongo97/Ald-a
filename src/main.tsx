import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { settingsRepo } from "./store/settings";
import { seedIfEmpty } from "./store/db";

async function bootstrap() {
  await seedIfEmpty();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
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
