import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { SettingsProvider } from "@/store/SettingsContext";
import Nav from "@/components/Nav";
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
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const pulledFor = useRef<string | null>(null);

  // Cargar sesión inicial de Supabase
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Al conocer la sesión (login por contraseña, OAuth con Google o recarga),
  // sincroniza una sola vez. Antes esto solo ocurría en el login por contraseña,
  // así que Google dejaba los datos sin bajar.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || pulledFor.current === userId) return;
    pulledFor.current = userId;
    void import("@/store/sync").then((m) => m.pullAndSyncFromSupabase());
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
      <Nav />

      {/* Banner de permiso de notificaciones */}
      {showNotifBanner && (
        <div className="mx-4 mt-2 flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
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
            className="text-sky-400 hover:text-sky-200"
            onClick={() => setShowNotifBanner(false)}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 pb-24">
        {view === "hoy" && <TodayView />}
        {view === "dia" && <DayView />}
        {view === "bandeja" && <InboxView />}
        {view === "proyectos" && <ProjectsView />}
        {view === "etiquetas" && <LabelsView />}
        {view === "revision" && <ReviewView />}
        {view === "buscar" && <SearchView />}
        {view === "ajustes" && <SettingsView />}
      </main>

      <CaptureModal />
      <Toasts />
      <OverdueRescheduleModal />

      <button
        type="button"
        onClick={() => openCapture()}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-2xl font-bold text-slate-950 shadow-lg shadow-sky-500/25 transition hover:bg-sky-400"
        aria-label="Nueva tarea (tecla /)"
      >
        +
      </button>
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
