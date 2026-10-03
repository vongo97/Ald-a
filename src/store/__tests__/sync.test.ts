import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Task } from "@/domain/types";

// ─── Estado compartido de los mocks (hoisted para que esté disponible en vi.mock) ───
const { mockData, mockSession, mockDb, mockFallo } = vi.hoisted(() => {
  // Almacén en memoria que hace de Supabase
  const mockData: Record<string, Record<string, unknown>[]> = {
    tasks: [],
    projects: [],
    tombstones: [],
  };
  const mockSession = { userId: "user-1" as string | null };
  /** Fallos de la nube: `select` y `upsert` se rompen por separado, porque en la
   *  app son dos fases distintas y anteproblemas distintos: si no se puede LEER
   *  se aborta antes de subir; si no se puede ESCRIBIR es cuando hay tareas
   *  pendientes de verdad. Confundirlas era justo lo que el test no pinaba. */
  const mockFallo = {
    select: {} as Record<string, string>,
    upsert: {} as Record<string, string>,
    /**
     * Falla por fila, no por lote. Es lo que hace falta para probar el reintento
     * uno a uno: si solo se puede fallar el lote entero, todos los tests dicen
     * «se cayó entero» y ninguno comprueba que se encuentre al culpable.
     *
     * Recibe el tamaño del lote porque hay un caso que solo se puede provocar
     * así: que la petición de varias filas se caiga y las de una sola pasen.
     */
    upsertFila: null as null | ((row: Record<string, unknown>, lote: number) => string | null),
    /**
     * Registro de los filtros de tiempo que se han pedido a la nube. Hace falta
     * poder afirmar que la SEGUNDA sincronización filtra y la primera no: si no
     * se registraran, el test solo vería que las dos devuelven lo mismo, que es
     * justo lo que pasa cuando el filtro no se está aplicando.
     */
    filtros: [] as { tabla: string; col: string; val: string }[],
  };

  // Almacén en memoria que hace de Dexie
  const tables = {
    tasks: new Map<string, Record<string, unknown>>(),
    projects: new Map<string, Record<string, unknown>>(),
    tombstones: new Map<string, Record<string, unknown>>(),
  };

  const makeTable = (store: Map<string, Record<string, unknown>>, keyFn: (r: Record<string, unknown>) => string) => ({
    toArray: async () => [...store.values()],
    get: async (key: string) => store.get(key),
    put: async (row: Record<string, unknown>) => {
      store.set(keyFn(row), row);
      return keyFn(row);
    },
    update: async (key: string, changes: Record<string, unknown>) => {
      const row = store.get(key);
      if (!row) return 0;
      Object.assign(row, changes);
      return 1;
    },
    clear: async () => { store.clear(); },
    bulkAdd: async (rows: Record<string, unknown>[]) => {
      for (const r of rows) store.set(keyFn(r), r);
    },
    count: async () => store.size,
  });

  const mockDb = {
    tasks: makeTable(tables.tasks, (r) => r.id as string),
    projects: makeTable(tables.projects, (r) => r.id as string),
    tombstones: makeTable(tables.tombstones, (r) => `${r.kind}+${r.id}`),
    transaction: async (_mode: string, ...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<void>;
      await fn();
    },
    _tables: tables,
  };

  return { mockData, mockSession, mockDb, mockFallo };
});

// ─── Mock de Supabase ─────────────────────────────────────────────────────────
// El builder soporta la cadena `select().eq()` y filtra por `user_id` como
// haría la política RLS del servidor (`user_id = auth.uid()`). Así los tests
// fallan si el código dejara de enviar `user_id` en las tumbas, que es
// exactamente la regresión que la migración 0007 previene.
vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSession.userId ? { user: { id: mockSession.userId } } : null,
        },
      }),
    },
    from: (table: string) => {
      const store = () => mockData[table] ?? (mockData[table] = []);
      // Filtros acumulados en la cadena, aplicados al resolver la promesa.
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const applyFilters = (rows: Record<string, unknown>[]) => {
        // RLS: cada usuario solo ve sus propias filas.
        const own = mockSession.userId
          ? rows.filter((r) => !r.user_id || r.user_id === mockSession.userId)
          : rows;
        return filters.reduce((acc, f) => acc.filter(f), own);
      };
      // thenable: `select()` y `select().eq()` devuelven SIEMPRE este mismo
      // objeto, así que `await` sobre cualquiera de los dos casos resuelve
      // a `{ data, error }` como en el cliente real de supabase-js.
      const selectResult = {
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return selectResult;
        },
        // `gt` es lo que usa el pull con marca de agua. Sin esto en el doble, el
        // filtro se perdería por el camino y los tests de la marca pasarían sin
        // comprobar nada: el punto es que NO se bajen filas viejas.
        gt: (col: string, val: string) => {
          mockFallo.filtros.push({ tabla: table, col, val });
          filters.push((r) => Date.parse(String(r[col] ?? 0)) > Date.parse(val));
          return selectResult;
        },
        then: (
          resolve: (v: { data: Record<string, unknown>[]; error: { message: string } | null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) =>
          Promise.resolve(
            mockFallo.select[table] !== undefined
              ? { data: [], error: { message: mockFallo.select[table] } }
              : { data: applyFilters(store()), error: null },
          ).then(resolve, reject),
      };
      return {
        select: (_cols?: string) => selectResult,
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          // Una fila mala tumba el lote entero, como en Postgres: por eso se
          // comprueba TODO el lote antes de guardar nada.
          if (mockFallo.upsert[table] !== undefined) {
            return Promise.resolve({ error: { message: mockFallo.upsert[table] } });
          }
          if (mockFallo.upsertFila) {
            for (const row of arr) {
              const motivo = mockFallo.upsertFila(row, arr.length);
              if (motivo) return Promise.resolve({ error: { message: motivo } });
            }
          }
          for (const row of arr) {
            const existing = store().find((r) => r.id === row.id);
            if (existing) Object.assign(existing, row);
            else store().push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

// ─── Mock de Dexie ────────────────────────────────────────────────────────────
// `patchTask`/`patchProject` reproducen la semantica de db.ts: sellan
// `updatedAt` salvo que quien escribe traiga su propia fecha. Importarlos de
// verdad metería IndexedDB real en un fichero cuyo objeto es probar QUE se
// llama a Supabase, no como se guarda.
vi.mock("../db", () => ({
  db: mockDb,
  stampNow: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  patchTask: async (id: string, changes: Record<string, unknown>) => {
    const conFecha = "updatedAt" in changes ? changes : { ...changes, updatedAt: new Date().toISOString() };
    return mockDb.tasks.update(id, conFecha);
  },
  patchProject: async (id: string, changes: Record<string, unknown>) => {
    const conFecha = "updatedAt" in changes ? changes : { ...changes, updatedAt: new Date().toISOString() };
    return mockDb.projects.update(id, conFecha);
  },
}));

// ─── Mock de useStore (zustand) ──────────────────────────────────────────────
const { mockSetSyncStatus, mockSetPendingUpload, mockEstadoSync } = vi.hoisted(() => {
  // Store con memoria: no basta con un `vi.fn()`, porque el código LEE
  // `pendingUpload` antes de escribirlo (al no poder leer la nube deja la
  // última cifra conocida, no una suposición). Un doble que siempre devuelve
  // `undefined` pasaría el test sin comprobar nada de eso.
  const estado = { pendingUpload: 0, pendingError: null as string | null };
  return {
    mockEstadoSync: estado,
    mockSetSyncStatus: vi.fn(),
    mockSetPendingUpload: vi.fn((n: number, e: string | null = null) => {
      estado.pendingUpload = n;
      estado.pendingError = e;
    }),
  };
});
vi.mock("../useStore", () => ({
  useStore: {
    getState: () => ({
      setSyncStatus: mockSetSyncStatus,
      setPendingUpload: mockSetPendingUpload,
      pendingUpload: mockEstadoSync.pendingUpload,
      pendingError: mockEstadoSync.pendingError,
    }),
  },
}));

// Importar DESPUÉS de los mocks
import { toRemote, stripRemote, needsPush, pullAndSyncFromSupabase, autoPushDeletedTasks } from "../sync";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resetAll() {
  mockData.tasks.length = 0;
  mockData.projects.length = 0;
  mockData.tombstones.length = 0;
  mockDb._tables.tasks.clear();
  mockDb._tables.projects.clear();
  mockDb._tables.tombstones.clear();
  mockSession.userId = "user-1";
  for (const k of Object.keys(mockFallo.select)) delete mockFallo.select[k];
  for (const k of Object.keys(mockFallo.upsert)) delete mockFallo.upsert[k];
  mockFallo.upsertFila = null;
  mockFallo.filtros.length = 0;
  mockEstadoSync.pendingUpload = 0;
  mockEstadoSync.pendingError = null;
  mockSetSyncStatus.mockClear();
  mockSetPendingUpload.mockClear();
}

beforeEach(resetAll);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Tarea",
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** El almacén del mock guarda filas genéricas; el dominio usa `Task`. */
function stored(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

// ─── toRemote: camelCase → snake_case ────────────────────────────────────────
describe("toRemote", () => {
  it("convierte updatedAt → updated_at y deletedAt → deleted_at", () => {
    const local = { id: "t1", title: "Hola", updatedAt: "2026-01-01T00:00:00Z", deletedAt: "2026-01-02T00:00:00Z" };
    const remote = toRemote(local);
    expect(remote).not.toHaveProperty("updatedAt");
    expect(remote).not.toHaveProperty("deletedAt");
    expect(remote.updated_at).toBe("2026-01-01T00:00:00Z");
    expect(remote.deleted_at).toBe("2026-01-02T00:00:00Z");
    expect(remote.id).toBe("t1");
    expect(remote.title).toBe("Hola");
  });

  it("sin updatedAt/deletedAt no añade las claves snake_case", () => {
    const remote = toRemote({ id: "t1", title: "Hola" });
    expect(remote).not.toHaveProperty("updated_at");
    expect(remote).not.toHaveProperty("deleted_at");
  });

  it("conserva el resto de campos camelCase (projectId, dueDate, etc.)", () => {
    const remote = toRemote({ id: "t1", projectId: "p1", dueDate: "2026-01-01" });
    expect(remote.projectId).toBe("p1");
    expect(remote.dueDate).toBe("2026-01-01");
  });
});

// ─── stripRemote: snake_case → camelCase ─────────────────────────────────────
describe("stripRemote", () => {
  it("convierte updated_at → updatedAt y deleted_at → deletedAt", () => {
    const row = { id: "t1", title: "Hola", updated_at: "2026-01-01T00:00:00Z", deleted_at: "2026-01-02T00:00:00Z" };
    const local = stripRemote<{ id: string; title: string; updatedAt?: string; deletedAt?: string }>(row);
    expect(local).not.toHaveProperty("updated_at");
    expect(local).not.toHaveProperty("deleted_at");
    expect(local.updatedAt).toBe("2026-01-01T00:00:00Z");
    expect(local.deletedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("quita user_id (columna de servidor)", () => {
    const local = stripRemote<Record<string, unknown>>({ id: "t1", user_id: "u1", updated_at: "x" });
    expect(local).not.toHaveProperty("user_id");
    expect(local.id).toBe("t1");
  });

  it("sin snake_case no añade camelCase", () => {
    const local = stripRemote<Record<string, unknown>>({ id: "t1" });
    expect(local).not.toHaveProperty("updatedAt");
    expect(local).not.toHaveProperty("deletedAt");
  });

  it("idéntico a toRemote invertido", () => {
    const original = { id: "t1", updatedAt: "2026-01-01T00:00:00Z", deletedAt: "2026-01-02T00:00:00Z" };
    const roundtrip = stripRemote<typeof original>(toRemote(original));
    expect(roundtrip).toEqual(original);
  });
});

// ─── needsPush ───────────────────────────────────────────────────────────────
describe("needsPush", () => {
  it("la nube no la conoce → sí (creada offline)", () => {
    expect(needsPush({ updatedAt: "2026-01-01T00:00:00Z" }, 0, false)).toBe(true);
  });

  it("la nube no tiene reloj pero lo local sí → sí", () => {
    expect(needsPush({ updatedAt: "2026-01-01T00:00:00Z" }, 0, true)).toBe(true);
  });

  it("lo local es más reciente → sí", () => {
    const localTime = Date.parse("2026-01-02T00:00:00Z");
    const remoteTime = Date.parse("2026-01-01T00:00:00Z");
    expect(needsPush({ updatedAt: "2026-01-02T00:00:00Z" }, remoteTime, true)).toBe(true);
    expect(localTime).toBeGreaterThan(remoteTime);
  });

  it("lo local es más viejo → no", () => {
    const remoteTime = Date.parse("2026-01-02T00:00:00Z");
    expect(needsPush({ updatedAt: "2026-01-01T00:00:00Z" }, remoteTime, true)).toBe(false);
  });

  it("lo local sin reloj no se sube (se marca en el pull)", () => {
    expect(needsPush({}, 0, true)).toBe(false);
    expect(needsPush({ updatedAt: undefined }, 0, true)).toBe(false);
  });

  it("lo local sin reloj pero la nube lo desconoce → sí (es nuevo)", () => {
    expect(needsPush({}, 0, false)).toBe(true);
  });
});

// ─── Lo que NO ha salido del móvil ────────────────────────────────────────────
// El fallo que dio origen a esto: una tarea creada sin red se quedaba solo en
// el teléfono, sin aparecer en la nube ni en el otro dispositivo, y el único
// rastro era un `console.error`. Nadie —ni la app ni quien la usa— se enteraba.
// Estos tests fijan que el motivo de Supabase llega a la interfaz.
describe("queda constancia de lo que no se ha subido", () => {
  it("el push va bien → no hay nada pendiente", async () => {
    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Creada offline", updatedAt: "2026-01-01T00:00:00Z",
    });

    await pullAndSyncFromSupabase();

    expect(mockSetPendingUpload).toHaveBeenCalledWith(0, null);
  });

  it("el upsert falla → se cuenta y se lleva el motivo de Supabase", async () => {
    // El fallo real que reportó el usuario: la columna no existe en la nube y
    // el lote entero se cae. El mensaje («column "recurrence" does not exist»)
    // es lo único que explica el fallo, así que tiene que llegar hasta el
    // indicador, no quedarse en la consola.
    mockFallo.upsert.tasks = 'column "recurrence" does not exist';
    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Creada offline", updatedAt: "2026-01-01T00:00:00Z",
    });
    mockDb._tables.tasks.set("local-2", {
      id: "local-2", title: "Otra offline", updatedAt: "2026-01-02T00:00:00Z",
    });

    await pullAndSyncFromSupabase();

    // Ahora el mensaje dice además que NO subió ninguna de las dos, que es lo
    // que el número por sí solo ya no explica.
    expect(mockSetPendingUpload).toHaveBeenCalledWith(
      2,
      'No se subió ninguna de 2: column "recurrence" does not exist',
    );
    // Y de verdad no llegaron: el punto de todo esto es no fingir.
    expect(mockData.tasks).toHaveLength(0);
  });

  it("si una sola fila está mala, se sube el resto y se nombra a la culpable", async () => {
    // ESTE es el fallo que se vio en la app: el indicador decía «14 tareas sin
    // subir» y al reintentar a mano subieron las 14 sin tocar ninguna. El lote
    // entero se cae por una fila, así que al repetirlo ya no había ninguna rota.
    //
    // Lo que faltaba era señalar cuál. Ahora, tras el fallo del lote, se va fila
    // por fila: las buenas suben y la culpable se nombra con el mensaje del
    // servidor.
    mockFallo.upsertFila = (row) =>
      row.id === "local-2" ? "invalid input syntax for type uuid" : null;

    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Creada offline", updatedAt: "2026-01-01T00:00:00Z",
    });
    mockDb._tables.tasks.set("local-2", {
      id: "local-2", title: "La que esta rota", updatedAt: "2026-01-02T00:00:00Z",
    });
    mockDb._tables.tasks.set("local-3", {
      id: "local-3", title: "Otra offline", updatedAt: "2026-01-03T00:00:00Z",
    });

    await pullAndSyncFromSupabase();

    // Una sola pendiente, NO tres: las otras dos están a salvo en la nube y
    // decir «3 sin subir» sería la misma mentira que no se inventaba la cifra,
    // solo que al revés.
    expect(mockSetPendingUpload).toHaveBeenCalledWith(
      1,
      '«La que esta rota» no se pudo subir: invalid input syntax for type uuid',
    );
    // Y de verdad: las dos buenas llegaron y la rota no. Nada de «debería».
    expect(mockData.tasks.map((t) => t.id).sort()).toEqual(["local-1", "local-3"]);
  });

  it("si el lote se cae pero cada fila va bien, no se culpa a ninguna", async () => {
    // El lote falló y por separado todo fue bien: entonces el problema era el
    // lote, no una fila. Inventar un culpable sería mentir con más detalle.
    mockFallo.upsertFila = (_row, lote) => (lote > 1 ? "row too long" : null);
    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Una", updatedAt: "2026-01-01T00:00:00Z",
    });
    mockDb._tables.tasks.set("local-2", {
      id: "local-2", title: "Dos", updatedAt: "2026-01-02T00:00:00Z",
    });

    await pullAndSyncFromSupabase();

    // Cero pendientes y sin motivo: el reintento por fila lo resolvió.
    expect(mockSetPendingUpload).toHaveBeenCalledWith(0, null);
    expect(mockData.tasks).toHaveLength(2);
  });

  it("si la nube no se puede LEER, no se inventa una cifra de pendientes", async () => {
    // Aquí no se sabe cuántas filas están solo en el móvil: no se pudo leer la
    // nube para compararlas. Decir «40 sin subir» cuando 39 están a salvo sería
    // la misma mentira al revés. La última cifra conocida se conserva y solo se
    // anota el motivo.
    mockFallo.select.tasks = "Failed to fetch";
    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Creada offline", updatedAt: "2026-01-01T00:00:00Z",
    });

    await pullAndSyncFromSupabase();

    const [cifra, motivo] = mockSetPendingUpload.mock.calls.at(-1)!;
    expect(cifra).toBe(0); // la última cifra conocida, no una suposición
    expect(String(motivo)).toContain("Failed to fetch");
    // Y en ningún caso se afirma que esté todo subido.
    expect(mockSetPendingUpload).not.toHaveBeenCalledWith(0, null);
  });
});

// ─── pullAndSyncFromSupabase: integración ────────────────────────────────────
describe("pullAndSyncFromSupabase", () => {
  it("sin sesión → devuelve null y no hace nada", async () => {
    mockSession.userId = null;
    const result = await pullAndSyncFromSupabase();
    expect(result).toBeNull();
    expect(mockSetSyncStatus).not.toHaveBeenCalled();
  });

  it("sube tareas locales que la nube no conoce", async () => {
    // Local: una tarea que la nube no tiene
    mockDb._tables.tasks.set("local-1", {
      id: "local-1", title: "Creada offline", updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    expect(result).not.toBeNull();
    expect(result!.pushedTasks).toBe(1);
    // La tarea llegó a la nube
    expect(mockData.tasks).toHaveLength(1);
    expect(mockData.tasks[0].id).toBe("local-1");
    // La nube la envía en snake_case
    expect(mockData.tasks[0]).toHaveProperty("updated_at");
    expect(mockData.tasks[0]).not.toHaveProperty("updatedAt");
  });

  it("baja tareas que solo existen en la nube", async () => {
    // Nube: una tarea que el local no tiene
    mockData.tasks.push({
      id: "cloud-1", title: "Creada en la nube",
      updated_at: "2026-01-01T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    expect(result).not.toBeNull();
    expect(result!.pulledTasks).toBe(1);
    // Local la tiene, en camelCase
    const local = mockDb._tables.tasks.get("cloud-1");
    expect(local).toBeDefined();
    expect(local).toHaveProperty("updatedAt");
    expect(local).not.toHaveProperty("updated_at");
    expect(local).not.toHaveProperty("user_id");
  });

  it("aplica borrados remotos (tombstones) → deletedAt + contador", async () => {
    // Local: tarea viva
    mockDb._tables.tasks.set("t1", { id: "t1", title: "Viva", updatedAt: "2026-01-01T00:00:00Z" });
    // Nube: tumba para esa tarea. Lleva `user_id` porque desde la
    // migración 0007 la política RLS solo deja ver las tumbas propias.
    mockData.tombstones.push({
      id: "t1",
      kind: "tasks",
      user_id: "user-1",
      updated_at: "2026-01-02T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    expect(result).not.toBeNull();
    expect(result!.remoteDeletes).toBe(1);
    const local = mockDb._tables.tasks.get("t1");
    expect(local!.deletedAt).toBe("2026-01-02T00:00:00Z");
    // La tumba también se guarda localmente
    expect(mockDb._tables.tombstones.size).toBe(1);
  });

  it("REGRESIÓN: la tumba también vale en un dispositivo que no tenía la tarea", async () => {
    // Este es el estado que dejó el protocolo de borrado a medias: la fila
    // viva en la nube y su tombstone al lado. Nada en local → dispositivo
    // limpio, el caso de un móvil nuevo.
    mockData.tasks.push({
      id: "t1",
      title: "Borrada en el otro dispositivo",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });
    mockData.tombstones.push({
      id: "t1",
      kind: "tasks",
      user_id: "user-1",
      updated_at: "2026-01-02T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    // La fila se baja (no hay de dónde sacar el contenido si no) pero tiene
    // que bajar YA marcada como borrada. Antes del arreglo se bajaba viva y
    // la tarea que habías borrado en otro teléfono aparecía como activa.
    const local = mockDb._tables.tasks.get("t1");
    expect(local).toBeDefined();
    expect(local!.deletedAt).toBe("2026-01-02T00:00:00Z");
    expect(result!.remoteDeletes).toBe(1);
  });

  it("REGRESIÓN: tampoco resucita un proyecto borrado en otro dispositivo", async () => {
    mockData.projects.push({
      id: "p1", name: "Proyecto caído", updated_at: "2026-01-01T00:00:00Z", deleted_at: null,
    });
    mockData.tombstones.push({
      id: "p1", kind: "projects", user_id: "user-1", updated_at: "2026-01-02T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    expect(mockDb._tables.projects.get("p1")!.deletedAt).toBe("2026-01-02T00:00:00Z");
    expect(result!.remoteDeletes).toBe(1);
  });

  it("una tarea sin tombstone se baja normal (el arreglo no borra de más)", async () => {
    mockData.tasks.push({ id: "t1", title: "Viva", updated_at: "2026-01-01T00:00:00Z" });

    await pullAndSyncFromSupabase();

    expect(mockDb._tables.tasks.get("t1")!.deletedAt).toBeUndefined();
  });

  it("NO aplica una tumba más vieja que el borrado local", async () => {
    // Local: ya borrada hace más tiempo
    mockDb._tables.tasks.set("t1", { id: "t1", updatedAt: "2026-01-01T00:00:00Z", deletedAt: "2026-01-03T00:00:00Z" });
    // Nube: tumba anterior
    mockData.tombstones.push({
      id: "t1",
      kind: "tasks",
      user_id: "user-1",
      updated_at: "2026-01-02T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    expect(result!.remoteDeletes).toBe(0);
    // El borrado local se conserva (más reciente)
    expect(mockDb._tables.tasks.get("t1")!.deletedAt).toBe("2026-01-03T00:00:00Z");
  });

  it("merge: gana lo más reciente (edición local posterior a la nube)", async () => {
    // Local: editada a las 12:00
    mockDb._tables.tasks.set("t1", { id: "t1", title: "Editada local", updatedAt: "2026-01-01T12:00:00Z" });
    // Nube: copia a las 10:00
    mockData.tasks.push({ id: "t1", title: "Copia nube", updated_at: "2026-01-01T10:00:00Z" });

    const result = await pullAndSyncFromSupabase();

    expect(result).not.toBeNull();
    expect(result!.pulledTasks).toBe(0); // No se bajó: lo local es más reciente
    expect(mockDb._tables.tasks.get("t1")!.title).toBe("Editada local");
  });

  it("merge: gana la nube si es más reciente", async () => {
    mockDb._tables.tasks.set("t1", { id: "t1", title: "Local vieja", updatedAt: "2026-01-01T10:00:00Z" });
    mockData.tasks.push({ id: "t1", title: "Nube nueva", updated_at: "2026-01-01T12:00:00Z" });

    const result = await pullAndSyncFromSupabase();

    expect(result!.pulledTasks).toBe(1);
    expect(mockDb._tables.tasks.get("t1")!.title).toBe("Nube nueva");
  });

  it("tombstones: NO aplica tumbas de otra cuenta (aislamiento RLS)", async () => {
    // Local: tarea viva
    mockDb._tables.tasks.set("t1", { id: "t1", title: "Viva", updatedAt: "2026-01-01T00:00:00Z" });
    // Nube: tumba ajena (misma id, distinto user_id)
    mockData.tombstones.push({
      id: "t1",
      kind: "tasks",
      user_id: "otro-usuario",
      updated_at: "2026-01-02T00:00:00Z",
    });

    const result = await pullAndSyncFromSupabase();

    // El mock ya filtra por user_id (simula RLS), así que la tumba ajena
    // no llega y NO se borra la tarea local.
    expect(result).not.toBeNull();
    expect(result!.remoteDeletes).toBe(0);
    expect(mockDb._tables.tasks.get("t1")!.deletedAt).toBeUndefined();
  });

  it("actualiza el estado del store: syncing → synced", async () => {
    await pullAndSyncFromSupabase();
    expect(mockSetSyncStatus).toHaveBeenCalledWith("syncing");
    expect(mockSetSyncStatus).toHaveBeenCalledWith("synced");
  });

  it("sin tareas ni proyectos → resumen en ceros", async () => {
    const result = await pullAndSyncFromSupabase();
    expect(result).toEqual({
      pushedTasks: 0, pushedProjects: 0,
      pulledTasks: 0, pulledProjects: 0,
      remoteDeletes: 0,
    });
  });

  it("proyectos se sincronizan igual que tareas", async () => {
    // Local: proyecto nuevo
    mockDb._tables.projects.set("p1", { id: "p1", name: "Local", updatedAt: "2026-01-01T00:00:00Z" });
    // Nube: otro proyecto
    mockData.projects.push({ id: "p2", name: "Nube", updated_at: "2026-01-01T00:00:00Z" });

    const result = await pullAndSyncFromSupabase();

    expect(result!.pushedProjects).toBe(1);
    expect(result!.pulledProjects).toBe(1);
    expect(mockData.projects).toHaveLength(2);
    expect(mockDb._tables.projects.size).toBe(2);
  });
});

// ─── La bajada solo pide lo que ha cambiado ───────────────────────────────────
//
// El pull era `select("*")` sin filtro. Al subir la frecuencia a 30 segundos eso
// pasó a ser «la tabla entera cada medio minuto»: gratis con 14 tareas, cuota del
// proyecto con unas cientos. Estos tests comprueban las dos mitas de la marca:
// que se filtra, y —lo que de verdad duele— que NO se filtra cuando no se debe.
describe("la bajada solo pide lo que ha cambiado", () => {
  /** localStorage de mentira: en `node` no existe y `leerMarca` lo captura. */
  function instalarLocalStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    return store;
  }

  let store: Map<string, string>;

  beforeEach(() => {
    store = instalarLocalStorage();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-02T12:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("la PRIMERA sincronizacion no filtra: se baja todo", async () => {
    // Si la primera bajada se filtrara, el dispositivo arrancaría sin nada y con
    // la nube «al día». Eso no da ningún error: se ve como si no hubiera tareas.
    await pullAndSyncFromSupabase();
    expect(mockFallo.filtros).toEqual([]);
  });

  it("la SEGUNDA si filtra, y por las tres tablas", async () => {
    await pullAndSyncFromSupabase();
    mockFallo.filtros.length = 0;

    await pullAndSyncFromSupabase();

    // Las tres: dejar las tumbas fuera haría que un borrado hecho en otro
    // dispositivo no se aplicara nunca, y la tarea volvería a salir aquí.
    expect(mockFallo.filtros.map((f) => f.tabla).sort()).toEqual(["projects", "tasks", "tombstones"]);
    for (const f of mockFallo.filtros) expect(f.col).toBe("updated_at");
  });

  it("el filtro lleva un minuto de margen sobre la marca, no la marca justa", async () => {
    await pullAndSyncFromSupabase();
    mockFallo.filtros.length = 0;

    await pullAndSyncFromSupabase();

    const pedido = mockFallo.filtros.find((f) => f.tabla === "tasks")!.val;
    // La marca quedó en las 12:00 (el reloj parado). Se pide desde las 11:59.
    expect(pedido).toBe("2026-10-02T11:59:00.000Z");
  });

  it("una fila vieja que aparece en la nube NO se baja", async () => {
    await pullAndSyncFromSupabase(); // marca ≈ 12:00
    // Una fila con una fecha vieja: o la app se la bajó antes y volvió a
    // aparecer por un borrado mal hecho, o alguien la escribió con reloj
    // atrasado. Con el filtro no molesta.
    mockData.tasks.push({ id: "vieja", title: "Vieja", updated_at: "2026-01-01T00:00:00Z" });

    const result = await pullAndSyncFromSupabase();

    expect(result!.pulledTasks).toBe(0);
    expect(mockDb._tables.tasks.has("vieja")).toBe(false);
  });

  it("una fila NUEVA en la nube si se baja, sin tocar nada mas", async () => {
    await pullAndSyncFromSupabase(); // marca ≈ 12:00
    mockData.tasks.push({ id: "nueva", title: "Nueva", updated_at: "2026-10-02T11:59:30Z" });

    const result = await pullAndSyncFromSupabase();

    expect(result!.pulledTasks).toBe(1);
    expect(mockDb._tables.tasks.has("nueva")).toBe(true);
  });

  it("un fallo de LECTURA no avanza la marca", async () => {
    // El fallo que da miedo. Si la marca advanced antes de saber si la nube
    // respondió, un corte de red dejaría el listón por delante de lo que se
    // bajó, y las filas que no llegaron no volverían a pedirse nunca. Nunca se
    // ve: la sincronización dice «al día» y miente.
    mockFallo.select.tasks = "Fallo de red simulado";
    await pullAndSyncFromSupabase();
    expect([...store.keys()]).not.toContain("ald-a:marca:user-1");

    mockFallo.filtros.length = 0;
    delete mockFallo.select.tasks;
    await pullAndSyncFromSupabase();

    expect(mockFallo.filtros).toEqual([]); // se bajó TODO otra vez: no se perdió nada
  });

  it("un fallo de TUMBAS tampoco avanza la marca", async () => {
    // Las tumbas son el protocolo de borrado. Si bajaran las tareas y fallaran
    // las tumbas, un borrado hecho en otro dispositivo no se aplicaría y la
    // tarea que borraste volvería a salir como activa en este.
    mockFallo.select.tombstones = "Fallo de red simulado";
    await pullAndSyncFromSupabase();

    expect([...store.keys()]).not.toContain("ald-a:marca:user-1");

    delete mockFallo.select.tombstones;
    mockFallo.filtros.length = 0;
    await pullAndSyncFromSupabase();

    // Ahora si: se recupera, se baja de nuevo y ya se puede marcar.
    expect(mockFallo.filtros).toEqual([]);
    expect(store.get("ald-a:marca:user-1")).toBeDefined();
  });

  it("la marca es POR CUENTA: cambiar de usuario no hereda la marca de otro", async () => {
    await pullAndSyncFromSupabase();
    expect(store.get("ald-a:marca:user-1")).toBeDefined();

    // Otro usuario entra en el mismo dispositivo. `ensureSyncOwner` borra lo
    // local; si la marca fuera única, el usuario nuevo heredaría el «ya lo he
    // bajado todo» del anterior y sus tareas no se pedirían jamás.
    mockSession.userId = "user-2";
    mockFallo.filtros.length = 0;

    await pullAndSyncFromSupabase();

    expect(mockFallo.filtros).toEqual([]);
    expect(store.get("ald-a:marca:user-2")).toBeDefined();
  });
});

// ─── autoPushDeletedTasks: las dos mitades del protocolo de borrado ──────────
describe("autoPushDeletedTasks", () => {
  it("sube la fila con deleted_at Y escribe la tumba", async () => {
    await autoPushDeletedTasks([makeTask({ id: "t1", title: "Borrada" })]);

    // Mitad 1: la fila existe y dice que está borrada.
    expect(mockData.tasks).toHaveLength(1);
    expect(mockData.tasks[0].id).toBe("t1");
    expect(mockData.tasks[0].deleted_at).toBeTruthy();

    // Mitad 2: la tumba. Sin ella, la fila podría perderse y el borrado
    // con ella.
    expect(mockData.tombstones).toHaveLength(1);
    expect(mockData.tombstones[0]).toMatchObject({
      id: "t1", kind: "tasks", user_id: "user-1",
    });

    // Y las dos mitades cuentan la MISMA historia, no dos fechas distintas.
    expect(mockData.tombstones[0].updated_at).toBe(mockData.tasks[0].deleted_at);
  });

  it("manda la fila entera, no un upsert parcial", async () => {
    // Un upsert con solo id+deleted_at crearía una fila sin título ni estado.
    await autoPushDeletedTasks([makeTask({ id: "t1", title: "Importa", labels: ["casa"] })]);

    expect(mockData.tasks[0].title).toBe("Importa");
    expect(mockData.tasks[0].labels).toEqual(["casa"]);
    expect(mockData.tasks[0].status).toBe("todo");
  });

  it("marca la fila con user_id propio (RLS no lo perdona si se olvida)", async () => {
    await autoPushDeletedTasks([makeTask({ id: "t1" })]);

    expect(mockData.tasks[0].user_id).toBe("user-1");
    expect(mockData.tombstones[0].user_id).toBe("user-1");
  });

  it("lote: una tumba por tarea, todas con su id", async () => {
    await autoPushDeletedTasks([
      makeTask({ id: "t1" }),
      makeTask({ id: "t2" }),
      makeTask({ id: "t3" }),
    ]);

    expect(mockData.tombstones.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(mockData.tasks).toHaveLength(3);
    for (const row of mockData.tasks) expect(row.deleted_at).toBeTruthy();
  });

  it("sin sesión no sube nada", async () => {
    mockSession.userId = null;

    await autoPushDeletedTasks([makeTask({ id: "t1" })]);

    expect(mockData.tasks).toHaveLength(0);
    expect(mockData.tombstones).toHaveLength(0);
  });

  it("lote vacío no hace nada", async () => {
    await autoPushDeletedTasks([]);

    expect(mockData.tasks).toHaveLength(0);
    expect(mockData.tombstones).toHaveLength(0);
  });

  it("el ciclo completo no resucita: borrar → nube → dispositivo limpio", async () => {
    // 1) El dispositivo A tiene una tarea y la borra.
    mockDb._tables.tasks.set("t1", stored(makeTask({ id: "t1", title: "Ciclo completo" })));
    await autoPushDeletedTasks([mockDb._tables.tasks.get("t1") as unknown as Task]);

    // 2) El dispositivo B arranca vacío y sincroniza.
    mockDb._tables.tasks.clear();
    const result = await pullAndSyncFromSupabase();

    // 3) B tiene la fila, pero borrada: no aparece como activa.
    expect(mockDb._tables.tasks.get("t1")!.deletedAt).toBeTruthy();
    // Y la tumba no tuvo nada que hacer (remoteDeletes 0): la fila ya llegó
    // diciendo «borrada». Ese es el objetivo del protocolo completo. Antes
    // el contador también era 0, pero la tarea aparecía como activa, que
    // es justo el bug.
    expect(result!.remoteDeletes).toBe(0);
  });
});
