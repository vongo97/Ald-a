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
  idle:    { color: "bg-slate-400",     label: "Sin sincronizar" },
  syncing: { color: "bg-amber-400 animate-pulse", label: "Sincronizando…" },
  synced:  { color: "bg-emerald-400",   label: "Sincronizado" },
  error:   { color: "bg-red-400",       label: "Error de sincronización" },
  offline: { color: "bg-slate-500",     label: "Sin conexión" },
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
  const [, forceTick] = useState(0);

  // Refresca el "hace X min" cada 30 s sin re-renderizar la app entera.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  const dot = DOT[syncStatus] ?? DOT.idle;
  const tooltip =
    syncStatus === "error" && syncError
      ? `Error: ${syncError}`
      : lastSyncAt
        ? `${dot.label} · ${relativeTime(lastSyncAt)}`
        : dot.label;

  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1.5 pr-1 text-xs text-slate-400 light:text-slate-500"
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
