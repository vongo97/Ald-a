import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "@/domain/types";
import { db, patchProject, patchTask, stampNow } from "../db";

/**
 * `updatedAt` es el reloj de toda la sincronización: `needsPush` sube solo lo
 * local MÁS RECIENTE y `mergeDecision` hace ganar al más reciente. Si una
 * escritura deja la fecha clavada, el trabajo no se sube ni converge, y no sale
 * ningún error: solo datos que se pierden callados.
 *
 * IndexedDB real (fake-indexeddb) porque un doble no ejecutaría el código de
 * escritura, que es justo lo que hay que mirar.
 */

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

const VIEJA = "2026-01-01T00:00:00.000Z";

beforeEach(async () => {
  await db.tasks.clear();
  await db.projects.clear();
  await db.tombstones.clear();
});

describe("patchTask sella updatedAt", () => {
  it("al editar, avanza la fecha", async () => {
    await db.tasks.put(makeTask({ updatedAt: VIEJA }));
    const antes = Date.parse(stampNow());

    await patchTask("t1", { title: "Otro titulo" });

    const t = await db.tasks.get("t1");
    expect(t!.title).toBe("Otro titulo");
    expect(Date.parse(t!.updatedAt!) >= antes).toBe(true);
  });

  it("al marcar deletedAt, la fecha NO queda por detrás", async () => {
    // Lo que se vio en la app real antes del arreglo: `deleted_at` más reciente
    // que `updated_at`. La nube recibía un par incoherente y la reparación
    // automática de la fila no ocurría nunca.
    await db.tasks.put(makeTask({ updatedAt: VIEJA }));

    await patchTask("t1", { deletedAt: stampNow() });

    const t = await db.tasks.get("t1");
    expect(t!.deletedAt).toBeTruthy();
    expect(Date.parse(t!.updatedAt!) >= Date.parse(t!.deletedAt!)).toBe(true);
  });

  it("respeta la fecha que trae quien escribe", async () => {
    // El pull trae el `updated_at` REAL de la nube. Si lo pisáramos con "ahora",
    // toda fila descargada parecería recién editada y volvería a subirla en el
    // siguiente push, en bucle.
    const nube = "2025-06-01T00:00:00.000Z";
    await db.tasks.put(makeTask({ updatedAt: VIEJA }));

    await patchTask("t1", { title: "x", updatedAt: nube });

    expect((await db.tasks.get("t1"))!.updatedAt).toBe(nube);
  });

  it("dentro de una transaccion también sella", async () => {
    // `deleteTask` borra en cascada DENTRO de `db.transaction`.
    await db.tasks.bulkPut([
      makeTask({ id: "padre", updatedAt: VIEJA }),
      makeTask({ id: "hijo", parentId: "padre", updatedAt: VIEJA }),
    ]);

    const now = stampNow();
    await db.transaction("rw", db.tasks, db.tombstones, async () => {
      for (const id of ["padre", "hijo"]) {
        await patchTask(id, { deletedAt: now });
        await db.tombstones.put({ id, kind: "tasks", updatedAt: now });
      }
    });

    for (const id of ["padre", "hijo"]) {
      const t = await db.tasks.get(id);
      expect(Date.parse(t!.updatedAt!) >= Date.parse(now)).toBe(true);
    }
  });

  it("dos edits seguidos dejan la segunda por encima de la primera", async () => {
    // El caso que de verdad importa: dos escrituras tienen que ser ORDENABLES.
    // Con el bug, ambas quedaban con la fecha de creación y `needsPush` veía
    // empate en los dos sentidos, así que ninguna se subía.
    await db.tasks.put(makeTask({ updatedAt: VIEJA }));

    await patchTask("t1", { title: "primera" });
    const trasPrimera = (await db.tasks.get("t1"))!.updatedAt!;
    await new Promise((r) => setTimeout(r, 5));
    await patchTask("t1", { title: "segunda" });
    const trasSegunda = (await db.tasks.get("t1"))!.updatedAt!;

    expect(Date.parse(trasSegunda)).toBeGreaterThan(Date.parse(trasPrimera));
  });

  it("igual en proyectos", async () => {
    await db.projects.put({ id: "p1", name: "P", color: "#fff", updatedAt: VIEJA });

    await patchProject("p1", { name: "Q" });

    expect((await db.projects.get("p1"))!.updatedAt).not.toBe(VIEJA);
  });

  it("crear sin fecha también la pone", async () => {
    await db.tasks.add(makeTask());
    expect((await db.tasks.get("t1"))!.updatedAt).toBeTruthy();
  });
});

describe("guardia: nadie escribe con update() a pelo", () => {
  // El bug original fue un hook que parecía sellar la fecha y no lo hacía
  // nunca. Nada impedía que volviera a colarse un `db.tasks.update()` suelto,
  // que es exactamente el camino sin sellar. Este test mira el código: si
  // alguien usa `update()` donde debería usar `patchTask`/`patchProject`,
  // falla aquí y no tres meses después en un dispositivo sin cobertura.
  const dir = join(process.cwd(), "src");
  const ficheros = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath ?? e.path, e.name));

  it("no hay db.tasks.update( ni db.projects.update( fuera de db.ts", () => {
    const culpables: string[] = [];
    for (const f of ficheros) {
      if (f.replace(/\\/g, "/").endsWith("src/store/db.ts")) continue;
      if (f.includes("__tests__")) continue;
      const txt = readFileSync(f, "utf8");
      for (const [i, linea] of txt.split("\n").entries()) {
        if (/\bdb\.(tasks|projects)\.update\(/.test(linea)) {
          culpables.push(`${f.replace(/\\/g, "/")}:${i + 1}  ${linea.trim()}`);
        }
      }
    }
    expect(culpables).toEqual([]);
  });
});