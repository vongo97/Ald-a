import { create } from "zustand";
import type { Task, ViewId } from "@/domain/types";
import type { Session } from "@supabase/supabase-js";
import { db } from "./db";
import { supabase } from "./supabase";
import { applyTheme, persistTheme, readThemePref } from "./theme";

export interface Toast {
  id: string;
  message: string;
  undo?: () => void;
}

/** Estado visual de la sincronización con la nube. */
export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

interface StoreState {
  view: ViewId;
  searchQuery: string;
  captureOpen: boolean;
  captureDraft: string;
  toasts: Toast[];
  showDeviation: boolean;
  selectedProjectId?: string;
  session: Session | null;
  /** Tema visual activo (ID: "warm-tech", "editorial-calido", ...). */
  theme: string;
  /** Estado de la última sincronización con Supabase. */
  syncStatus: SyncStatus;
  /** Timestamp (ms) de la última sync exitosa. */
  lastSyncAt: number | null;
  /** Mensaje de error de la última sync fallida. */
  syncError: string | null;

  setView: (v: ViewId) => void;
  setSearchQuery: (q: string) => void;
  openCapture: (draft?: string) => void;
  closeCapture: () => void;
  setCaptureDraft: (s: string) => void;
  pushToast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  setShowDeviation: (v: boolean) => void;
  selectProject: (id?: string) => void;
  setTheme: (t: string) => void;
  loadSession: () => Promise<void>;
  /** Actualiza el estado de sync (llamado desde sync.ts). */
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
}

let toastSeq = 0;

export const useStore = create<StoreState>((set) => ({
  view: "hoy",
  searchQuery: "",
  captureOpen: false,
  captureDraft: "",
  toasts: [],
  showDeviation: false,
  selectedProjectId: undefined,
  session: null,
  theme: readThemePref(),
  syncStatus: "idle",
  lastSyncAt: null,
  syncError: null,

  setView: (view) => set({ view, showDeviation: false }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  openCapture: (draft = "") => set({ captureOpen: true, captureDraft: draft }),
  closeCapture: () => set({ captureOpen: false, captureDraft: "" }),
  setCaptureDraft: (captureDraft) => set({ captureDraft }),
  pushToast: (message, undo) =>
    set((s) => ({ toasts: [...s.toasts, { id: `toast-${++toastSeq}`, message, undo }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setShowDeviation: (showDeviation) => set({ showDeviation }),
  selectProject: (selectedProjectId) => set({ selectedProjectId, view: "proyectos" }),
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  setSyncStatus: (syncStatus, error = null) =>
    set((s) => ({
      syncStatus,
      syncError: syncStatus === "error" ? error : null,
      lastSyncAt: syncStatus === "synced" ? Date.now() : s.lastSyncAt,
    })),
  loadSession: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session });
    } catch {
      set({ session: null });
    }
  }
}));

/** Helper para alternar el estado de una tarea con toast de deshacer. */
export function toggleWithUndo(
  task: Task,
  toggleFn: (t: Task) => Promise<void>,
  pushToast: StoreState["pushToast"],
): void {
  const wasDone = task.status === "done";
  void toggleFn(task);
  pushToast(
    wasDone ? "Tarea reabierta" : `«${truncate(task.title)}» completada`,
    async () => {
      // Re-leer la entidad: el objeto capturado quedó obsoleto tras el primer toggle
      const fresh = await db.tasks.get(task.id);
      if (fresh) await toggleFn(fresh);
    },
  );
}

function truncate(s: string, max = 32): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
