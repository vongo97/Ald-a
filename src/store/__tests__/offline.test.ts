import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "@/domain/types";

/**
 * QuÃ© hace la sincronizaciÃ³n cuando NO HAY RED, con una sesiÃ³n iniciada.
 *
 * â”€â”€ Por quÃ© este fichero existe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Ya se probÃ³ el CRUD sin red, y resultÃ³ ser una prueba vacÃ­a. Sin sesiÃ³n de
 * Supabase, `pullAndSyncFromSupabase` hace
 *
 *   const userId = await sessionUserId();
 *   if (!userId) return null;      // sin cuenta no hay nube
 *
 * y se va ANTES de tocar la red. La app hacÃ­a CERO peticiones durante toda la
 * prueba. Matar `fetch` en ese escenario no prueba nada: no habÃ­a nada que matar.
 *
 * AquÃ­ el escenario es el que de verdad importa: sesiÃ³n presente y la nube sin
 * responder.
 *
 * â”€â”€ QuÃ© NO se prueba aquÃ­, y por quÃ© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Que el transporte HTTP real lance la excepciÃ³n. En tests `supabase-js` usa los
 * mÃ³dulos `http`/`https` de Node, no `fetch` (por eso sustituir `globalThis.fetch`
 * no intercepta nada: la peticiÃ³n se sale a internet de verdad y el test se
 * queda esperando). Interceptar `https.request` serÃ­a un doble frÃ¡gil que
 * comprobarÃ­a la biblioteca, no nuestra app.
 *
 * Lo que sÃ­ se prueba, y es lo nuestro: el cliente devuelve un error de red y
 * la app (a) entra en sincronizaciÃ³n, (b) conserva los datos locales, (c) dice
 * Â«sin conexiÃ³nÂ» en vez de Â«errorÂ», y (d) al volver la red sube el trabajo
 * hecho mientras tanto.
 */

// â”€â”€ SesiÃ³n presente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SESION = {
  access_token: "token-falso",
  refresh_token: "refresh-falso",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "user-1", email: "prueba@example.com", aud: "authenticated" },
};

/** Operaciones que la sincronizaciÃ³n hace contra la nube. */
interface Traza {
  tablas: string[];
  upserts: { tabla: string; filas: unknown[] }[];
  deletes: string[];
  error: { message: string } | null;
}

let traza: Traza;

/**
 * Constructor de cadenas: `supabase.from(x).select().eq()` encadena, y al
 * esperarse devuelve `{ data, error }`. Registra lo que se le pide para poder
 * comprobar despuÃ©s quÃ© se intentÃ³ subir.
 */
function cadena(tabla: string) {
  // El encadenado (`from().select().eq()`) tiene que devolver el PROXY, no el
  // objeto vacío de detrás: si no, `.eq` sería `undefined` y reventaría.
  let proxy: Record<string, unknown>;
  const objetivo: Record<string, unknown> = {};
  proxy = new Proxy(objetivo, {
    get(_o, propiedad: string) {
      if (propiedad === "then") {
        return (resolver: (v: { data: unknown[]; error: unknown }) => void) =>
          resolver({ data: [], error: traza.error });
      }
      return (...args: unknown[]) => {
        if (propiedad === "upsert") traza.upserts.push({ tabla, filas: args[0] as unknown[] });
        else if (propiedad === "delete") traza.deletes.push(tabla);
        else if (FILTROS.has(propiedad)) traza.tablas.push(`${tabla}.${propiedad}`);
        return proxy;
      };
    },
  });
  return proxy;
}

/** Cadenas que solo filtran: cuentan como "he preguntado a la nube". */
const FILTROS = new Set(["select", "eq", "gte", "lte", "order", "limit", "is", "in"]);

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: SESION }, error: null }),
      getUser: async () => ({ data: { user: SESION.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (tabla: string) => cadena(tabla),
  },
}));

const { setSyncStatus, setPendingUpload } = vi.hoisted(() => ({
  setSyncStatus: vi.fn(),
  setPendingUpload: vi.fn(),
}));
vi.mock("../useStore", () => ({
  useStore: { getState: () => ({ setSyncStatus, setPendingUpload, pendingUpload: 0 }) },
}));

import { db } from "../db";
import { needsPush, pullAndSyncFromSupabase } from "../sync";

// â”€â”€ localStorage: `ensureSyncOwner` lo usa y el entorno de tests es "node" â”€â”€â”€â”€â”€
// Sin esto, `localStorage.getItem` lanza ReferenceError y la comprobaciÃ³n de
// "cuenta dueÃ±a" se salta siempre. Con esto se ejercita de verdad, incluida la
// limpieza al cambiar de cuenta.
const almacen = new Map<string, string>();
beforeEach(() => {
  almacen.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
    clear: () => almacen.clear(),
  });
  traza = { tablas: [], upserts: [], deletes: [], error: { message: "TypeError: Failed to fetch" } };
  setSyncStatus.mockClear();
  setPendingUpload.mockClear();
  errores.length = 0;
  consola.error = (...a: unknown[]) => void errores.push(a.map(String).join(" ").slice(0, 200));
  consola.warn = () => {};
});

/** Todo lo que la app registra por consola.error durante el test. */
const errores: string[] = [];
const consola = console;

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Tarea con datos",
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("sin red, con sesion iniciada", () => {
  it("no revienta: devuelve null en vez de lanzar", async () => {
    await db.tasks.put(makeTask());

    await expect(pullAndSyncFromSupabase()).resolves.toBeNull();
  });

  it("ENTRA en la sincronizacion (esto es lo que no se probaba antes)", async () => {
    // Si esto fallara, el resto del fichero seguirÃ­a dando verde mientras mide
    // un escenario que en la vida real no ocurre: sin sesiÃ³n, la app no toca la
    // nube. Se comprueba que la nube se consulta de verdad.
    await db.tasks.put(makeTask());

    await pullAndSyncFromSupabase();

    expect(traza.tablas.length).toBeGreaterThan(0);
    expect(setSyncStatus).toHaveBeenCalledWith("syncing");
  });

  it("conserva los datos locales intactos", async () => {
    // Lo Ãºnico que un fallo de red no puede hacer es perder trabajo.
    await db.tasks.put(makeTask({ title: "Mi trabajo sin conexion" }));

    await pullAndSyncFromSupabase();

    const t = await db.tasks.get("t1");
    expect(t).toBeDefined();
    expect(t!.title).toBe("Mi trabajo sin conexion");
    expect(t!.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("pone 'offline', NO 'error'", async () => {
    // La diferencia que ve la persona: gris tranquilo frente a rojo de alarma.
    await db.tasks.put(makeTask());

    await pullAndSyncFromSupabase();

    const estados = setSyncStatus.mock.calls.map((c) => c[0]);
    expect(estados).toContain("syncing");
    expect(estados).toContain("offline");
    expect(estados).not.toContain("error");
    // Y se deja constancia en consola de lo que pasó, sin perder nada.
    expect(errores.join(" | ")).toContain("la nube");
  });

  it("un fallo de verdad (permisos) sigue siendo 'error'", async () => {
    // Lo contrario del test anterior, y no por simetrÃ­a: si un fallo de RLS se
    // camuflase de Â«sin conexiÃ³nÂ», la app parecerÃ­a no hacer nada y nadie lo
    // investigarÃ­a jamÃ¡s.
    traza.error = { message: 'new row violates row-level security policy for table "tasks"' };
    await db.tasks.put(makeTask());

    await pullAndSyncFromSupabase();

    const estados = setSyncStatus.mock.calls.map((c) => c[0]);
    expect(estados).toContain("error");
    expect(estados).not.toContain("offline");
  });
});

describe("el ciclo completo: editar sin red, reconectar y subir", () => {
  it("la edicion offline se sube al volver la red", async () => {
    // Este es el caso que el usuario pidiÃ³ comprobar y que la app perdÃ­a.
    const NUBE = "2026-06-01T10:00:00.000Z";

    // 1) La tarea ya estÃ¡ en la nube con esta fecha, y aquÃ­ tambiÃ©n.
    await db.tasks.put(makeTask({ updatedAt: NUBE }));
    expect(await db.tasks.get("t1")).toBeDefined();

    // 2) Se edita sin red. El `autoPushTask` inmediato no puede salir: se
    // dispara con `void` (dispara y olvida), asÃ­ que hay que dejar correr el
    // bucle antes de mirar quÃ© se intentÃ³ hacer.
    const { updateTask } = await import("../actions");
    await updateTask("t1", { title: "Editada offline" });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(traza.upserts.length).toBeGreaterThan(0); // se intentÃ³, fallÃ³

    // 3) Al volver la red, la fila local tiene que ser mÃ¡s reciente que la nube.
    const local = (await db.tasks.get("t1"))!;
    expect(needsPush(local, Date.parse(NUBE), true)).toBe(true);

    // 4) Vuelve la red: el push del ciclo tiene que llevÃ¡rsela.
    traza = { tablas: [], upserts: [], deletes: [], error: null };
    await pullAndSyncFromSupabase();

    const subidas = JSON.stringify(traza.upserts);
    expect(subidas).toContain("Editada offline");
    // Y la nube manda: la sincronizaciÃ³n termina en verde, sin conflictos.
    expect(setSyncStatus.mock.calls.map((c) => c[0])).toContain("synced");
  });

  it("el fallo NO se Â«comeÂ» el estado: al reconectar queda en 'synced'", async () => {
    await db.tasks.put(makeTask());
    await pullAndSyncFromSupabase();
    expect(setSyncStatus.mock.calls.map((c) => c[0])).toContain("offline");

    traza = { tablas: [], upserts: [], deletes: [], error: null };
    await pullAndSyncFromSupabase();
    expect(setSyncStatus.mock.calls.map((c) => c[0]).at(-1)).toBe("synced");
  });
});

describe("cambio de cuenta", () => {
  it("limpia lo local para no mezclar datos de dos cuentas", async () => {
    // Sin esto, lo del usuario anterior se subirÃ­a con el `user_id` nuevo y las
    // cuentas quedarÃ­an mezcladas. El dato del anterior sigue a salvo en SU
    // cuenta, en la nube; lo que se borra es la copia local.
    almacen.set("ald-a:sync-owner", "otro-usuario");
    await db.tasks.put(makeTask({ title: "De la cuenta anterior" }));

    await pullAndSyncFromSupabase();

    expect(await db.tasks.get("t1")).toBeUndefined();
  });

  it("la primera cuenta del dispositivo se queda con lo local", async () => {
    // MigraciÃ³n natural: lo no sincronizado se le sube a esa cuenta.
    await db.tasks.put(makeTask({ title: "Sin sincronizar nunca" }));

    await pullAndSyncFromSupabase();

    expect((await db.tasks.get("t1"))!.title).toBe("Sin sincronizar nunca");
  });
});
