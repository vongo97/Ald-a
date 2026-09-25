import { useEffect, useState } from "react";

/**
 * Hook que captura el evento `beforeinstallprompt` del navegador.
 * Devuelve una función para disparar el prompt de instalación de la PWA
 * y el estado de si ya está instalada.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<Event & { prompt: () => Promise<void> } | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Si se lanzó en modo standalone, ya está instalada
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as Event & { prompt: () => Promise<void> });
    };

    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
  };

  return { canInstall: !!promptEvent && !installed, installed, install };
}
