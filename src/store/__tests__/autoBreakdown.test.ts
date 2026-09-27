import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoBreakdownBlobs } from "../autoBreakdown";
import { improveCapture } from "@/llm/tasks";
import { addSubtasks, updateTask } from "../actions";
import type { Settings } from "@/domain/types";

// ─── Estado compartido de los mocks (hoisted para vi.mock) ───
const { state } = vi.hoisted(() => ({
  state: {
    tasks: [] as Array<Record<string, unknown>>,
    updated: [] as Array<[string, Record<string, unknown>]>,
    added: [] as Array<Array<{ title: string }>>,
  },
}));

vi.mock("../db", () => ({
  db: {
    tasks: {
      toArray: async () => state.tasks.map((t) => ({ ...t })),
      where: (field: string) => ({
        equals: (val: unknown) => ({
          count: async () => state.tasks.filter((t) => t[field] === val).length,
        }),
      }),
    },
  },
}));

vi.mock("../actions", () => ({
  updateTask: vi.fn(async (id: string, changes: Record<string, unknown>) => {
    state.updated.push([id, changes]);
  }),
  addSubtasks: vi.fn(async (_parent: unknown, items: Array<{ title: string }>) => {
    state.added.push(items);
    return [];
  }),
}));

vi.mock("@/llm/tasks", () => ({ improveCapture: vi.fn() }));

const settings: Settings = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-test",
  baseUrl: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
};

/** Texto largo de verdad (> MIN_TITLE_CHARS = 150). */
const BLOB = "tengo un día bastante cargado con el gimnasio temprano. ".repeat(4);

function blobTask(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "b1", title: BLOB, status: "todo", order: 0, labels: [], priority: 3, importance: 3, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.tasks = [];
  state.updated = [];
  state.added = [];
  // localStorage en memoria: el entorno de test no lo trae y autoBreakdown
  // lo usa para recordar lo ya desglosado.
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as Storage;
});

describe("autoBreakdownBlobs", () => {
  it("estructura un bloque: título corto (original a notes) + subtareas", async () => {
    state.tasks = [blobTask()];
    vi.mocked(improveCapture).mockResolvedValue({
      ok: true,
      usedLlm: true,
      data: {
        title: "Día cargado: gimnasio y teletrabajo",
        subtasks: [
          { title: "Gimnasio", start: "08:00", end: "09:30" },
          { title: "Teletrabajo" },
        ],
      },
    });

    const res = await autoBreakdownBlobs(settings);

    expect(res).toMatchObject({ fixed: 1, subtasks: 2, failed: 0 });
    expect(state.updated[0][0]).toBe("b1");
    expect(state.updated[0][1].title).toBe("Día cargado: gimnasio y teletrabajo");
    // El párrafo original nunca se pierde: queda en notes.
    expect(state.updated[0][1].notes).toBe(BLOB);
    expect(state.added[0]).toHaveLength(2);
  });

  it("sin clave de IA → null y sin llamadas", async () => {
    state.tasks = [blobTask()];
    const res = await autoBreakdownBlobs({ ...settings, apiKey: "  " });
    expect(res).toBeNull();
    expect(improveCapture).not.toHaveBeenCalled();
  });

  it("ignora tareas cortas, borradas, completadas o con subtareas", async () => {
    state.tasks = [
      { id: "corta", title: "Comprar pan", status: "todo" },
      { id: "borrada", title: BLOB, status: "todo", deletedAt: "2026-09-01" },
      { id: "hecha", title: BLOB, status: "done" },
      { id: "sub", title: BLOB, status: "todo", parentId: "otra" },
      blobTask({ id: "con-hijas" }),
      blobTask({ id: "hija", parentId: "con-hijas" }),
    ];

    const res = await autoBreakdownBlobs(settings);

    expect(res).toBeNull();
    expect(improveCapture).not.toHaveBeenCalled();
  });

  it("si la IA devuelve el párrafo entero (>160) no toca nada ni se marca", async () => {
    state.tasks = [blobTask()];
    vi.mocked(improveCapture).mockResolvedValue({
      ok: true,
      usedLlm: true,
      data: { title: BLOB.slice(0, 170) },
    });

    const res = await autoBreakdownBlobs(settings);

    expect(res).toMatchObject({ fixed: 0, failed: 1 });
    expect(res?.error).toBeTruthy();
    expect(state.updated).toHaveLength(0);
    // No se marcó como hecho → se reintenta en el próximo arranque.
    expect(localStorage.getItem("ald-a:auto-desglosado")).toBeNull();
  });

  it("un fallo de la IA queda en failed/error (nunca silencioso)", async () => {
    state.tasks = [blobTask()];
    vi.mocked(improveCapture).mockResolvedValue({
      ok: false,
      usedLlm: false,
      error: "Respuesta del modelo no interpretable",
    });

    const res = await autoBreakdownBlobs(settings);

    expect(res).toMatchObject({ fixed: 0, failed: 1, error: "Respuesta del modelo no interpretable" });
    expect(state.updated).toHaveLength(0);
    expect(localStorage.getItem("ald-a:auto-desglosado")).toBeNull();
  });

  it("recuerda las ya desglosadas: no repite en el siguiente arranque", async () => {
    state.tasks = [blobTask()];
    vi.mocked(improveCapture).mockResolvedValue({
      ok: true,
      usedLlm: true,
      data: { title: "Corto" },
    });

    const first = await autoBreakdownBlobs(settings);
    expect(first).toMatchObject({ fixed: 1, subtasks: 0 });
    expect(improveCapture).toHaveBeenCalledTimes(1);

    const second = await autoBreakdownBlobs(settings);
    expect(second).toBeNull();
    expect(improveCapture).toHaveBeenCalledTimes(1);
  });
});
