import { useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "@/store/useStore";
import { db } from "@/store/db";
import {
  APP_URL,
  buildSharePayload,
  currentThemeColors,
  renderShareCard,
} from "@/domain/shareCard";
import { startOfDay, toISODate } from "@/domain/dateutils";

interface Props {
  className?: string;
  /** Contenido personalizado; por defecto «📤 Compartir». */
  children?: ReactNode;
}

/**
 * Genera la tarjeta del día (PNG 1080×1920 con el tema activo) y la manda al
 * compartir nativo del sistema; si no hay Web Share con archivos, la descarga.
 * Lee la base en el momento del clic — siempre refleja el estado actual.
 */
export default function ShareDayButton({ className, children }: Props) {
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tasks = await db.tasks.toArray();
      const todayISO = toISODate(startOfDay(new Date()));
      const payload = buildSharePayload(tasks, todayISO);
      const blob = await renderShareCard(payload, currentThemeColors());
      const file = new File([blob], `mi-dia-${todayISO}.png`, { type: "image/png" });

      const canNativeShare =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canNativeShare) {
        try {
          await navigator.share({
            files: [file],
            text: `🔥 ${payload.streak} ${payload.streak === 1 ? "día" : "días"} seguidos con Mis Tareas — ${APP_URL}`,
          });
        } catch (err) {
          // Cancelar la hoja de compartir no es un error; el resto sí.
          if (!(err instanceof DOMException && err.name === "AbortError")) throw err;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        pushToast("Tarjeta guardada 📤");
      }
    } catch (err) {
      pushToast(
        `No se pudo generar la tarjeta: ${err instanceof Error ? err.message : "error desconocido"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className ?? "btn-ghost text-xs"}
      disabled={busy}
      onClick={() => void share()}
    >
      {children ?? "📤 Compartir"}
    </button>
  );
}
