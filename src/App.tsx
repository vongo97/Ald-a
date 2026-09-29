import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/store/useStore";
import { applyTheme } from "@/store/theme";
import { SettingsProvider } from "@/store/SettingsContext";
import Dock from "@/components/Dock";
import CaptureModal from "@/components/CaptureModal";
import Toasts from "@/components/Toasts";
import DayCelebration from "@/components/DayCelebration";
import TodayView from "@/views/TodayView";
import CalendarView from "@/views/CalendarView";
import InboxView from "@/views/InboxView";
import ProjectsView from "@/views/ProjectsView";
import LabelsView from "@/views/LabelsView";
import ReviewView from "@/views/ReviewView";
import PapeleraView from "@/views/PapeleraView";
import SearchView from "@/views/SearchView";
import SettingsView from "@/views/SettingsView";
import OverdueRescheduleModal from "@/components/OverdueRescheduleModal";
import ProfileQuestionnaire from "@/components/ProfileQuestionnaire";
import { loadProfile } from "@/store/profile";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { pullAndSyncFromSupabase } from "@/store/sync";
import { purgeExpiredTrash } from "@/store/purge";
import { autoBreakdownBlobs } from "@/store/autoBreakdown";
import { settingsRepo } from "@/store/settings";
import { toISODate, startOfDay } from "@/domain/dateutils";
import { useTimeBlockAlerts } from "@/notifications/useTimeBlockAlerts";
import { startAnimBridge } from "@/anim/bridge";
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
  const [showProfile, setShowProfile] = useState(false);
  const pulledFor = useRef<string | null>(null);

  // Mostrar cuestionario de perfil si no existe (primer uso)
  useEffect(() => {
    if (!loadProfile()) {
      setShowProfile(true);
    }
  }, []);

  // Cargar sesión inicial de Supabase
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // El tema ya lo aplicó el script inline de index.html antes del paint;
  // aquí solo nos mantenemos al día (cambio en Ajustes).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Al conocer la sesión (login por contraseña, OAuth con Google o recarga),
  // sincroniza una sola vez. Antes esto solo ocurría en el login por contraseña,
  // así que Google dejaba los datos sin bajar.
  //
  // La purga de la Papelera (caducidad de 30 días) se ejecuta SIEMPRE después
  // del pull —o al cargar sin cuenta—: si va antes, el pull vuelve a bajar de
  // la nube las filas que acabamos de purgar.
  useEffect(() => {
    const userId = session?.user?.id;
    if (userId && pulledFor.current === userId) return;
    if (userId) pulledFor.current = userId;

    void (async () => {
      if (userId) {
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
      }

      const purged = await purgeExpiredTrash();
      const total = purged.tasks + purged.projects;
      if (total > 0) {
        pushToast(
          `🗑️ Papelera: ${total} ${total === 1 ? "elemento" : "elementos"} eliminado${total === 1 ? "" : "s"} tras 30 días`,
        );
      }
    })();
  }, [session]);

  // Desglose automático: las capturas que quedaron como bloque de texto
  // (título gigante) se estructuran solas al arrancar — título corto +
  // subtareas — sin pulsar «Desglosar». Acotado y sin repetir: véase
  // autoBreakdown. Si la IA falla, se reintenta en el próximo arranque.
  useEffect(() => {
    void autoBreakdownBlobs(settingsRepo.load()).then((r) => {
      if (!r) return;
      if (r.fixed > 0) {
        pushToast(
          r.subtasks > 0
            ? `✨ Desglose automático: ${r.fixed} tarea${r.fixed !== 1 ? "s" : ""} estructurada${r.fixed !== 1 ? "s" : ""} · +${r.subtasks} subtareas`
            : `✨ Desglose automático: ${r.fixed} título${r.fixed !== 1 ? "s" : ""} largo${r.fixed !== 1 ? "s" : ""} acortado`,
        );
      } else {
        pushToast(`⚠️ Desglose automático: ${r.error ?? "la IA no respondió"} — se reintentará en el próximo arranque`);
      }
    });
  }, [pushToast]);

  // Tareas pendientes de hoy para el badge.
  // IMPORTANTE: excluir borradas (deletedAt) — igual que TodayView, si no
  // el badge muestra pendientes que en la vista Hoy no aparecen.
  const today = toISODate(startOfDay(new Date()));
  const pendingToday = useLiveQuery(
    () =>
      db.tasks
        .where("dueDate")
        .equals(today)
        .filter((t) => t.status === "todo" && !t.deletedAt)
        .count(),
    [today],
    0,
  );

  // Actualizar badge del título y PWA
  useEffect(() => {
    updateBadge(pendingToday ?? 0);
  }, [pendingToday]);

  // Alertas nativas de los bloques de tiempo de hoy.
  // Vivían en la vista Día (retirada: el Calendario la subsume); aquí
  // siguen funcionando esté donde estés. Memo para no reprogramar los
  // timers en cada render de App (el hook depende de la identidad).
  const todayTasks = useLiveQuery(
    () => db.tasks.where("dueDate").equals(today).toArray(),
    [today],
    [],
  );
  const scheduledToday = useMemo(
    () => (todayTasks ?? []).filter((t) => t.status === "todo" && !t.deletedAt && !!t.timeBlock),
    [todayTasks],
  );
  useTimeBlockAlerts(scheduledToday);

  // Puente de animaciones por tema (ald-a-animations.css): --d escalonado
  // y pathLength de los trazos de tinta. useLayoutEffect para estampar los
  // primeros retardos antes del primer paint; el observer cubre las
  // cards que lleguen al navegar.
  useLayoutEffect(() => startAnimBridge(), []);

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
        <span className="brand relative font-display text-lg font-semibold tracking-tight text-[var(--accent)]">
          Mis Tareas
          {/* Pincelada de tinta: solo la muestra Tinta viva
              (visibilidad en ald-a-animations.css; pathLength lo asegura
              el puente, y aquí ya va de serie). */}
          <svg
            className="ink-stroke pointer-events-none absolute -bottom-1.5 left-0 h-1.5 w-full"
            viewBox="0 0 120 8"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M2 5.5 C 30 1.5, 66 7, 118 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              pathLength={100}
            />
          </svg>
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
            {view === "calendario" && <CalendarView />}
            {view === "bandeja" && <InboxView />}
            {view === "proyectos" && <ProjectsView />}
            {view === "etiquetas" && <LabelsView />}
            {view === "revision" && <ReviewView />}
            {view === "papelera" && <PapeleraView />}
            {view === "buscar" && <SearchView />}
            {view === "ajustes" && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <CaptureModal />
      <Toasts />
      <DayCelebration />
      <OverdueRescheduleModal />

      {/* Cuestionario de perfil — primer uso */}
      {showProfile && (
        <ProfileQuestionnaire onComplete={() => setShowProfile(false)} />
      )}

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
