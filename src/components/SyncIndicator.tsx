import { useEffect, useState } from "react";
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
 */
export default function SyncIndicator() {
  const session = useStore((s) => s.session);
  const syncStatus = useStore((s) => s.syncStatus);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const syncError = useStore((s) => s.syncError);
  const pendingUpload = useStore((s) => s.pendingUpload);
  const pendingError = useStore((s) => s.pendingError);
  const [, forceTick] = useState(0);

  // Refresca el "hace X min" cada 30 s sin re-renderizar la app entera.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  // Hay trabajo que la nube no tiene. Esto TIENE que ganar al «Sin conexión»
  // en gris: ese punto dice «no hay red ahora», y es verdad; lo que no dice es
  // que tu trabajo esté a salvo. Un indicador que dice «Sin conexión» mientras
  // tres tareas no han salido del móvil tranquiliza a quien no sabe mirar, y
  // quien lo lee se queda con la duda de si se guardó.
  if (pendingUpload > 0) {
    const n = pendingUpload;
    const motivo = pendingError ? ` — ${pendingError}` : "";
    const texto = `${n} ${n === 1 ? "tarea sin subir" : "tareas sin subir"}${motivo}`;
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-1.5 pr-1 text-xs text-amber-300 light:text-amber-700"
        title={texto}
        aria-label={texto}
        role="status"
      >
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
        <span className="hidden sm:inline">
          {n} sin subir
        </span>
      </span>
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
