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
}
