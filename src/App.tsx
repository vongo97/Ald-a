import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/store/useStore";
import { applyTheme } from "@/store/theme";
import { SettingsProvider } from "@/store/SettingsContext";
import Dock from "@/components/Dock";
import CaptureModal from "@/components/CaptureModal";
import Toasts from "@/components/Toasts";
import TodayView from "@/views/TodayView";
import DayView from "@/views/DayView";
import InboxView from "@/views/InboxView";
import ProjectsView from "@/views/ProjectsView";
import LabelsView from "@/views/LabelsView";
import ReviewView from "@/views/ReviewView";
import SearchView from "@/views/SearchView";
import SettingsView from "@/views/SettingsView";
import OverdueRescheduleModal from "@/components/OverdueRescheduleModal";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { pullAndSyncFromSupabase } from "@/store/sync";
import { toISODate, startOfDay } from "@/domain/dateutils";
import {
  notificationsSupported,
  notifPermission,
  alreadyAskedPermission,
  requestNotifPermission,
  updateBadge,
} from "@/notifications/notifier";

function AppInner() {
  const view = useStore((s) => s.view);
  const openCapture = useStore((s) => s.openCapture);
  const loadSession = useStore((s) => s.loadSession);
  const session = useStore((s) => s.session);
  const pushToast = useStore((s) => s.pushToast);
  const theme = useStore((s) => s.theme);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const pulledFor = useRef<string | null>(null);

  // Cargar sesión inicial de Supabase
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // El tema ya lo aplicó el script inline de index.html antes del paint;
  // aquí solo nos mantenemos al día (cambio en Ajustes o cambio del SO).
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Al conocer la sesión (login por contraseña, OAuth con Google o recarga),
  // sincroniza una sola vez. Antes esto solo ocurría en el login por contraseña,
  // así que Google dejaba los datos sin bajar.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || pulledFor.current === userId) return;
    pulledFor.current = userId;
    void (async () => {
      const summary = await pullAndSyncFromSupabase();
      // Avisos de conflictos: borrados que llegaron desde otro dispositivo.
      if (summary && summary.remoteDeletes > 0) {
        const n = summary.remoteDeletes;
        pushToast(
          n === 1
            ? "1 tarea eliminada desde otro dispositivo"
            : `${n} tareas eliminadas desde otro dispositivo`,
        );
      }
    })();
  }, [session]);

  // Tareas pendientes de hoy para el badge
  const today = toISODate(startOfDay(new Date()));
  const pendingToday = useLiveQuery(
    () => db.tasks.where("dueDate").equals(today).filter((t) => t.status === "todo").count(),
    [today],
    0,
  );

  // Actualizar badge del título y PWA
  useEffect(() => {
    updateBadge(pendingToday ?? 0);
  }, [pendingToday]);

  // Mostrar banner de permiso de notificaciones
  useEffect(() => {
    if (
      notificationsSupported() &&
      notifPermission() === "default" &&
      !alreadyAskedPermission()
    ) {
      setTimeout(() => setShowNotifBanner(true), 2000);
    }
  }, []);

  // Atajos globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      // Con un diálogo abierto los atajos globales quedan fuera: si el foco
      // está en un botón del modal, "n" abriría la captura ENCIMA.
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "/" || e.key === "n") {
        e.preventDefault();
        openCapture();
      } else if (e.key === "t") {
        useStore.getState().setView("hoy");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCapture]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* Header mínimo con marca (el dock reemplaza a la nav horizontal) */}
      <header className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-2.5">
        <span className="font-display text-lg font-semibold tracking-tight text-[var(--accent)]">
          Mis Tareas
        </span>
        <span className="text-xs text-[var(--fg)] opacity-50">
          {pendingToday ?? 0} pendiente{(pendingToday ?? 0) === 1 ? "" : "s"}
        </span>
      </header>

      {/* Banner de permiso de notificaciones */}
      {showNotifBanner && (
        <div className="mx-4 mt-2 flex items-center gap-3 rounded-xl border border-sky-500/30 light:border-sky-200 bg-sky-500/10 light:bg-sky-50 px-4 py-3 text-sm text-sky-200 light:text-sky-700">
          <span className="text-xl">🔔</span>
          <span className="flex-1">Activa las notificaciones para recibir alertas de tus bloques de tiempo.</span>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              void requestNotifPermission();
              setShowNotifBanner(false);
            }}
          >
            Activar
          </button>
          <button
            type="button"
            className="text-sky-400 light:text-sky-600 hover:text-sky-200 hover:light:text-sky-700"
            onClick={() => setShowNotifBanner(false)}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 pb-32">
        {/* Transición de vistas con Framer Motion: fade + slide-up */}
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {view === "hoy" && <TodayView />}
            {view === "dia" && <DayView />}
            {view === "bandeja" && <InboxView />}
            {view === "proyectos" && <ProjectsView />}
            {view === "etiquetas" && <LabelsView />}
            {view === "revision" && <ReviewView />}
            {view === "buscar" && <SearchView />}
            {view === "ajustes" && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <CaptureModal />
      <Toasts />
      <OverdueRescheduleModal />

      {/* Dock flotante estilo macOS: reemplaza a Nav y al botón "+" suelto */}
      <Dock />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  );
}
