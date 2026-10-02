import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";

/** Relativo "hace 2 min" a partir de un timestamp en ms. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return "hace más de 1 día";
}

const DOT: Record<string, { color: string; label: string }> = {
  idle:    { color: "bg-surface-hover",     label: "Sin sincronizar" },
  syncing: { color: "bg-amber-400 animate-pulse", label: "Sincronizando…" },
  synced:  { color: "bg-emerald-400",   label: "Sincronizado" },
  error:   { color: "bg-red-400",       label: "Error de sincronización" },
  offline: { color: "bg-surface-hover",     label: "Sin conexión" },
};

/**
 * Punto de estado de sincronización en la barra de navegación.
 * Solo se muestra si hay sesión de Supabase.
 *
 * Cuando hay tareas sin subir es un BOTÓN, no un adorno: se toca y explica
 * cuántas son y por qué no han salido, y ofrece reintentar. Poner el motivo en
 * un `title` —que es lo que había— solo funciona con el ratón, y esta app se
 * usa en el móvil, donde no hay hover. Es decir: el aviso se veía pero el
 * motivo no. Un aviso que no se puede leer es medio aviso.
 */
export default function SyncIndicator() {
  const session = useStore((s) => s.session);
  const syncStatus = useStore((s) => s.syncStatus);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const syncError = useStore((s) => s.syncError);
  const pendingUpload = useStore((s) => s.pendingUpload);
  const pendingError = useStore((s) => s.pendingError);
  const syncNow = useStore((s) => s.syncNow);
  const [, forceTick] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Refresca el "hace X min" cada 30 s sin re-renderizar la app entera.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Cerrar con Escape o tocando fuera: es un panel, no un modal que secuestre
  // la pantalla.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: MouseEvent | TouchEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alPulsar);
    document.addEventListener("touchstart", alPulsar);
    document.addEventListener("keydown", alEsc);
    return () => {
      document.removeEventListener("mousedown", alPulsar);
      document.removeEventListener("touchstart", alPulsar);
      document.removeEventListener("keydown", alEsc);
    };
  }, [abierto]);

  if (!session) return null;

  // Hay trabajo que la nube no tiene. Esto TIENE que ganar al «Sin conexión»
  // en gris: ese punto dice «no hay red ahora», y es verdad; lo que no dice es
  // que tu trabajo esté a salvo. Un indicador que dice «Sin conexión» mientras
  // catorce tareas no han salido del móvil tranquiliza a quien no sabe mirar, y
  // quien lo lee se queda con la duda de si se guardó.
  //
  // También se avisa cuando no hay cifra pero sí motivo: si la nube no se pudo ni
  // leer, no se sabe cuántas filas quedan fuera, y callarse justo ahí sería
  // el silencio que este indicador viene a quitar.
  if (pendingUpload > 0 || pendingError) {
    const n = pendingUpload;
    const corto = n > 0 ? `${n} sin subir` : "Sin comprobar";
    const titulo = pendingError ? `${corto} — ${pendingError}` : corto;
    return (
      <div ref={caja} className="relative ml-auto shrink-0 pr-1">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-label={titulo}
          title={titulo}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-amber-300 hover:bg-amber-400/10 light:text-amber-700 cursor-pointer"
        >
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
          <span className="hidden sm:inline">{corto}</span>
        </button>

        {abierto && (
          <div
            role="dialog"
            aria-label="Detalle de la subida"
            className="absolute right-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-amber-500/40 bg-surface p-3 text-xs shadow-xl"
          >
            <p className="font-medium text-amber-300 light:text-amber-700">
              {n > 0
                ? `${n} ${n === 1 ? "tarea no ha salido" : "tareas no han salido"} de este dispositivo.`
                : "No se ha podido comprobar qué hay subido."}
            </p>
            <p className="mt-1 text-muted">
              Están a salvo aquí, pero no están en la nube ni en el otro dispositivo.
            </p>
            {pendingError && (
              <p className="mt-2 break-words rounded bg-surface-hover p-2 font-mono text-[11px] leading-snug">
                {pendingError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                syncNow?.();
              }}
              className="mt-3 w-full rounded bg-amber-400/20 px-2 py-1.5 font-medium text-amber-200 hover:bg-amber-400/30 light:text-amber-800 light:hover:bg-amber-200/40 cursor-pointer"
            >
              Reintentar ahora
            </button>
            <p className="mt-2 text-[11px] text-muted">
              Si sigue fallando, el motivo de arriba es lo que dice el servidor.
            </p>
          </div>
        )}
      </div>
    );
  }

  const dot = DOT[syncStatus] ?? DOT.idle;
  const tooltip =
    syncStatus === "error" && syncError
      ? `Error: ${syncError}`
      : lastSyncAt
        ? `${dot.label} · ${relativeTime(lastSyncAt)}`
        : dot.label;

  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1.5 pr-1 text-xs text-muted"
      title={tooltip}
      aria-label={tooltip}
      role="status"
    >
      <span className={`h-2 w-2 rounded-full ${dot.color}`} aria-hidden />
      <span className="hidden sm:inline">
        {syncStatus === "syncing"
          ? "Sync…"
          : lastSyncAt
            ? relativeTime(lastSyncAt)
            : ""}
      </span>
    </span>
  );
}