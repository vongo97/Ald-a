import { create } from "zustand";
import type { Task, ViewId } from "@/domain/types";
import type { Session } from "@supabase/supabase-js";
import { db } from "./db";
import { applyTheme, persistTheme, readThemePref, type ThemePref } from "./theme";

export interface Toast {
  id: string;
  message: string;
  undo?: () => void;
}

interface StoreState {
  view: ViewId;
  searchQuery: string;
  captureOpen: boolean;
  captureDraft: string;
  toasts: Toast[];
  showDeviation: boolean;
  selectedProjectId?: string;
  session: Session | null;
  /** Preferencia de tema: light | dark | system. */
  theme: ThemePref;

  setView: (v: ViewId) => void;
  setSearchQuery: (q: string) => void;
  openCapture: (draft?: string) => void;
  closeCapture: () => void;
  setCaptureDraft: (s: string) => void;
  pushToast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  setShowDeviation: (v: boolean) => void;
  selectProject: (id?: string) => void;
  setTheme: (t: ThemePref) => void;
  loadSession: () => Promise<void>;
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
  loadSession: async () => {
    try {
      const { supabase } = await import("./supabase");
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
