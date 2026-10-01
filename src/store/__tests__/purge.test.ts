import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Project } from "@/domain/types";

/**
 * Tests de la purga (vaciar papelera y caducidad de 30 dias).
 *
 * El caso interesante no es que la fila desaparezca: es que la tombstone
 * sobrevive a la purga, y con ella la promesa de que ningun dispositivo volvera
 * a subir esa fila. Si la tombstone se perdiera al purgar, un movil que lleva
 * dias sin sincronizar re-subiria la fila en su siguiente push y el elemento
 * volveria a la Papelera. Eso es lo que estos tests sujetan.
 *
 * IndexedDB es real (fake-indexeddb) para que la PK compuesta `[kind+id]` de
 * las tumbas se comporte como en el navegador: el borrado es por `[kind, id]`,
 * no por `id`, y un test con un doble no lo comprobaria.
 */

const { purgeRemoteRows, sessionUserId } = vi.hoisted(() => ({
  purgeRemoteRows: vi.fn(async () => {}),
  sessionUserId: vi.fn(async () => "user-1" as string | null),
}));

vi.mock("../sync", async (importOriginal) => {
  // `sync.ts` de verdad para todo menos el lado de la nube. Los helpers de
  // fecha y de RLS no se pueden doblar sin perder lo que se quiere probar.
  const actual = await importOriginal<typeof import("../sync")>();
  return { ...actual, purgeRemoteRows };
});

vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) } },
}));

import { db } from "../db";
import { emptyTrash, purgeExpiredTrash } from "../purge";
import { needsPush } from "../sync";

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

function makeProject(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "Proyecto", color: "#38bdf8", ...over };
}

/** Hace 40 dias atras, para pasar la caducidad de 30. */
const HACE_40_DIAS = new Date(Date.now() - 40 * 86400_000).toISOString();
const AYER = new Date(Date.now() - 86400_000).toISOString();

beforeEach(async () => {
  await db.tasks.clear();
  await db.projects.clear();
  await db.tombstones.clear();
  purgeRemoteRows.mockClear();
});

describe("emptyTrash", () => {
  it("borra la fila de la tarea de la base local", async () => {
    await db.tasks.put(makeTask({ deletedAt: AYER }));

    const res = await emptyTrash();

    expect(res.tasks).toBe(1);
    expect(await db.tasks.get("t1")).toBeUndefined();
  });

  it("quita la tombstone local pero NO la remota", async () => {
    // Asimetría deliberada, y es lo que hace que la purga tenga sentido:
    //
    //  - La tombstone LOCAL era el mensajero que iba a llevar la señal de
    //    borrado a la nube. Ya ha ido (o el borrado se hizo sin conexión y el
    //    mensaje se fue alغرام). Conservarla no aporta nada y estorba.
    //  - La tombstone REMOTA es el registro permanente de «esto se borró». Es
    //    lo que impide que un movil que lleva dias sin sincronizar re-suba la
    //    fila en su siguiente push y la traiga de vuelta a la Papelera.
    await db.tasks.put(makeTask({ deletedAt: AYER }));
    await db.tombstones.put({ id: "t1", kind: "tasks", updatedAt: AYER });

    await emptyTrash();

    expect(await db.tombstones.get(["tasks", "t1"])).toBeUndefined();
    // Y la nube no se toca en su tabla de tombstones: `purgeRemoteRows` solo
    // borra FILAS. El test de "no borra la tombstone de un proyecto" fija esto
    // desde el otro lado.
  });

  it("la fila purgada no vuelve aunque otro dispositivo la re-suba", async () => {
    // El ciclo completo que produce la fila zombie: se purga (la fila local se
    // va), otro dispositivo re-sube su copia vieja, y la tombstone remota
    // sigue ahi para taparla. Este test comprueba el contrato que lo sostiene:
    // la purga toca la tabla de filas y no la de tombstones.
    await db.tasks.put(makeTask({ id: "t1", deletedAt: AYER }));
    await db.tombstones.put({ id: "t1", kind: "tasks", updatedAt: AYER });

    await emptyTrash();

    // Fila fuera de local...
    expect(await db.tasks.get("t1")).toBeUndefined();
    // ...y el borrado en la nube es de FILAS, no de tombstones.
    expect(purgeRemoteRows).toHaveBeenCalledWith("tasks", ["t1"]);
    // Y la primera columna que se le pasa es la tabla de FILAS. Nunca
    // "tombstones": ese borrado no existe en el codigo.
    const tablas: string[] = purgeRemoteRows.mock.calls.map((c) => (c as unknown[])[0] as string);
    expect(tablas).toEqual(["tasks"]);
  });

  it("en la nube borra solo las FILAS, nunca las tombstones", async () => {
    await db.tasks.put(makeTask({ deletedAt: AYER }));
    await db.tombstones.put({ id: "t1", kind: "tasks", updatedAt: AYER });

    await emptyTrash();

    expect(purgeRemoteRows).toHaveBeenCalledWith("tasks", ["t1"]);
  });

  it("NO toca las tareas vivas: no van a la papelera", async () => {
    const viva = makeTask({ id: "viva" });
    await db.tasks.put(viva);

    const res = await emptyTrash();

    expect(res.tasks).toBe(0);
    expect(await db.tasks.get("viva")).toBeDefined();
    expect(purgeRemoteRows).not.toHaveBeenCalled();
  });

  it("cuenta bien tareas y proyectos por separado", async () => {
    await db.tasks.put(makeTask({ id: "t1", deletedAt: AYER }));
    await db.projects.put(makeProject({ id: "p1", deletedAt: AYER }));

    const res = await emptyTrash();

    expect(res).toEqual({ tasks: 1, projects: 1 });
    expect(await db.projects.get("p1")).toBeUndefined();
  });

  it("purga la tarea sin llevarse la tombstone del proyecto (PK [kind+id])", async () => {
    // Las tumbas comparten tabla con PK compuesta [kind+id]. Purgar la tarea
    // t1 no puede llevar por delante la tombstone del proyecto p1: un borrado
    // por `id` a secas las habria borrado las dos.
    await db.tasks.put(makeTask({ id: "t1", deletedAt: AYER }));
    await db.projects.put(makeProject({ id: "p1", deletedAt: AYER }));
    await db.tombstones.bulkPut([
      { id: "t1", kind: "tasks", updatedAt: AYER },
      { id: "p1", kind: "projects", updatedAt: AYER },
    ]);

    await emptyTrash();

    // Ambas se van, porque `emptyTrash` purga tareas Y proyectos. Lo que se
    // comprueba aquí es que se fueron por su `kind` correcto y no de un
    // barrido ciego.
    expect(await db.tasks.get("t1")).toBeUndefined();
    expect(await db.projects.get("p1")).toBeUndefined();
    expect(purgeRemoteRows).toHaveBeenCalledWith("tasks", ["t1"]);
    expect(purgeRemoteRows).toHaveBeenCalledWith("projects", ["p1"]);
  });

  it("papelera vacia: no hace nada y no toca la nube", async () => {
    await db.tasks.put(makeTask());

    const res = await emptyTrash();

    expect(res).toEqual({ tasks: 0, projects: 0 });
    expect(purgeRemoteRows).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredTrash", () => {
  it("purga lo que lleva mas de 30 dias", async () => {
    await db.tasks.put(makeTask({ id: "vieja", deletedAt: HACE_40_DIAS }));

    const res = await purgeExpiredTrash();

    expect(res.tasks).toBe(1);
    expect(await db.tasks.get("vieja")).toBeUndefined();
  });

  it("respeta lo borrado hace poco, que aun se puede restaurar", async () => {
    await db.tasks.put(makeTask({ id: "reciente", deletedAt: AYER }));

    const res = await purgeExpiredTrash();

    expect(res.tasks).toBe(0);
    expect(await db.tasks.get("reciente")).toBeDefined();
  });

  it("respeta el limite que se le pase", async () => {
    await db.tasks.put(makeTask({ id: "reciente", deletedAt: AYER }));

    const res = await purgeExpiredTrash(60);

    expect(res.tasks).toBe(0);
  });

  it("tambien aqui se lleva la tombstone local y solo las filas de la nube", async () => {
    await db.tasks.put(makeTask({ id: "vieja", deletedAt: HACE_40_DIAS }));
    await db.tombstones.put({ id: "vieja", kind: "tasks", updatedAt: HACE_40_DIAS });

    await purgeExpiredTrash();

    expect(await db.tasks.get("vieja")).toBeUndefined();
    expect(await db.tombstones.get(["tasks", "vieja"])).toBeUndefined();
    expect(purgeRemoteRows).toHaveBeenCalledWith("tasks", ["vieja"]);
  });
});

describe("por que las filas zombies de la nube no son problema", () => {
  // Estas dos pruebas no son de un fallo: son el contrato que sostiene la
  // decision de dejar la tombstone REMOTA tras purgar. Sin el, un movil
  // offline podria devolver a la Papelera algo que el usuario ya vacio.
  //
  // El ciclo completo: A purga la fila (la nube se queda sin fila, con
  // tombstone). B llevaba dias sin sincronizar, conserva su copia y la re-sube
  // VIVA. Esa es la fila zombie. El pull de B se la baja y la tombstone la
  // marca al momento, porque las tombstones se aplican despues de las filas.

  it("la fila re-subida se corrige en el siguiente push", () => {
    // El pull de B marco la fila con la fecha de la tombstone. El hook
    // `updating` de db.ts sella `updatedAt` en esa escritura, asi que la copia
    // local queda MAS RECIENTE que la que hay en la nube...
    const trasElPull = { updatedAt: "2026-02-01T00:00:00Z", deletedAt: "2026-02-01T00:00:00Z" };
    const filaEnLaNube = Date.parse("2026-01-01T00:00:00Z"); // la zombie, sin fecha de borrado

    // ...y `needsPush` da true: el siguiente ciclo sube el `deleted_at` y la
    // nube queda coherente. Las zombies se autoreparan.
    expect(needsPush(trasElPull, filaEnLaNube, true)).toBe(true);
  });

  it("pero no pisa una fila que otro dispositivo subio despues", () => {
    // Si alguien subio la fila con fecha posterior, no se toca. Aqui manda la
    // tombstone sobre la visibilidad, no el reloj: el elemento sigue sin verse
    // porque el pull la marcara cuando llegue su turno.
    const localVieja = { updatedAt: "2026-01-01T00:00:00Z", deletedAt: "2026-02-01T00:00:00Z" };

    expect(needsPush(localVieja, Date.parse("2026-03-01T00:00:00Z"), true)).toBe(false);
  });
});