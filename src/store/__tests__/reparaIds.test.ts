import { describe, expect, it, beforeEach } from "vitest";
import type { Project, Task } from "@/domain/types";
import { cuentaIdsInvalidos, esUuid, nuevoId, reparaIds, UUID } from "../reparaIds";
import { db, reparaIdsLocales } from "../db";

/**
 * Lo que la app se inventó antes y Postgres no acepta.
 *
 * `newId` caía a `t-<base36>-<aleatorio>` cuando `crypto.randomUUID` no existía,
 * y no existe fuera de un contexto seguro: servir la app en el IP de la Wi-Fi por
 * HTTP sin cifrar es justo eso. La columna de la nube es `id uuid NOT NULL`, así
 * que esas filas no podían subir nunca. El arreglo de `newId` (7cda2df) impide
 * que vuelva a pasar, pero no toca lo que ya está en el dispositivo.
 *
 * Estos tests cubren esa segunda mitad, que es la que no se arregla con un
 * commit en `db.ts`.
 */

const tarea = (over: Partial<Task> = {}): Task =>
  ({ id: nuevoId(), title: "T", labels: [], priority: 3, importance: 3, status: "todo", order: 0, createdAt: "2026-01-01T00:00:00Z", ...over }) as Task;

const proyecto = (over: Partial<Project> = {}): Project =>
  ({ id: nuevoId(), name: "P", color: "#fff", ...over }) as Project;

describe("que cuenta como un id que la nube acepta", () => {
  it("acepta un uuid v4 con la forma y los bits correctos", () => {
    expect(esUuid(nuevoId())).toBe(true);
    expect(esUuid("f529507d-4727-4edd-acc8-487ead300a87")).toBe(true);
  });

  it("rechaza lo que el respaldo viejo producia", () => {
    // Los tres casos: la forma `t-…`, un perfil, y un hexadecimal sin versión.
    expect(esUuid("t-murt2nzz-qn6mnx")).toBe(false);
    expect(esUuid("profile-1782000000000")).toBe(false);
    expect(esUuid("f529507d47274eddec8487ead300a87")).toBe(false); // sin guiones
  });

  it("rechaza vacio, null y un uuid con la version cambiada", () => {
    expect(esUuid("")).toBe(false);
    expect(esUuid(null)).toBe(false);
    expect(esUuid(undefined)).toBe(false);
    expect(esUuid("f529507d-4727-1edd-acc8-487ead300a87")).toBe(false); // versión 1
    expect(esUuid("f529507d-4727-4edd-0cca-487ead300a87")).toBe(false); // variante inválida
  });
});

describe("reparaIds: solo toca lo que esta roto", () => {
  it("si no hay nada roto, devuelve lo mismo y no cambia nada", () => {
    const tareas = [tarea(), tarea()];
    const proyectos = [proyecto()];
    const r = reparaIds(tareas, proyectos);
    expect(r.cambiados).toBe(0);
    expect(r.tareas).toBe(tareas);
    expect(r.proyectos).toBe(proyectos);
  });

  it("sustituye el id de una tarea con id malo y deja las demas intactas", () => {
    const buena = tarea({ id: "f529507d-4727-4edd-acc8-487ead300a87" });
    const mala = tarea({ id: "t-murt2nzz-qn6mnx" });
    const r = reparaIds([buena, mala], []);
    expect(r.cambiados).toBe(1);
    expect(r.tareas[0].id).toBe(buena.id);
    expect(esUuid(r.tareas[1].id)).toBe(true);
    // Y el resto de la tarea no se toca: el título sigue siendo el que era.
    expect(r.tareas[1].title).toBe(mala.title);
  });

  it("reescribe el projectId para que la tarea no se quede apuntando al aire", () => {
    // ESTE es el fallo que hace que una reparación no sirva: se arregla el
    // proyecto y la tarea se queda apuntando al id viejo, que ya no existe.
    const p = proyecto({ id: "t-proyecto-abc123" });
    const t = tarea({ projectId: p.id });
    const r = reparaIds([t], [p]);
    expect(esUuid(r.proyectos[0].id)).toBe(true);
    expect(r.tareas[0].projectId).toBe(r.proyectos[0].id);
    expect(r.tareas[0].projectId).not.toBe(p.id);
  });

  it("reescribe el parentId entre tareas: una subtarea sigue colgada de su madre", () => {
    const madre = tarea({ id: "t-madre-xyz" });
    const hija = tarea({ id: "t-hija-abc", parentId: madre.id });
    const r = reparaIds([madre, hija], []);
    expect(r.tareas[0].id).not.toBe(madre.id);
    expect(r.tareas[1].parentId).toBe(r.tareas[0].id);
  });

  it("un id repetido en proyectos y tareas no genera dos ids distintos", () => {
    // Un solo mapa para los dos. Con dos, una fila compartida se quedaría con dos
    // identidades distintas y la referencia apuntaría a la copia muerta.
    const compartido = "t-compartido-999";
    const r = reparaIds([tarea({ id: compartido })], [proyecto({ id: compartido })]);
    expect(r.cambiados).toBe(1);
    expect(r.tareas[0].id).toBe(r.proyectos[0].id);
  });

  it("no toca una referencia que ya era un uuid válido", () => {
    const uuid = "f529507d-4727-4edd-acc8-487ead300a87";
    const r = reparaIds([tarea({ id: "t-mala-1", projectId: uuid })], []);
    expect(r.tareas[0].projectId).toBe(uuid);
  });

  it("repara una mezcla y da el total correcto", () => {
    const r = reparaIds(
      [tarea({ id: "t-1" }), tarea({ id: nuevoId() }), tarea({ id: "t-2" })],
      [proyecto({ id: "t-3" })],
    );
    expect(r.cambiados).toBe(3);
    for (const t of r.tareas) expect(esUuid(t.id)).toBe(true);
    for (const p of r.proyectos) expect(esUuid(p.id)).toBe(true);
  });

  it("el patron y lo que genera el generador no se contradicen", () => {
    // Si el patron acepta algo que el generador no produce, o al reves, el test
    // de arriba puede pasar mientras la app sigue mandando basura.
    for (let i = 0; i < 300; i++) {
      const id = nuevoId();
      expect(id, id).toMatch(UUID);
      expect(esUuid(id), id).toBe(true);
      expect(id[14], id).toBe("4");
      expect("89ab", id[19]).toContain(id[19]);
    }
  });
});

describe("cuentaIdsInvalidos: lo que se le dice a quien usa la app", () => {
  it("cuenta solo lo que no serviría, no todas las filas", () => {
    expect(cuentaIdsInvalidos([tarea(), tarea({ id: "t-1" })], [proyecto()])).toBe(1);
    expect(cuentaIdsInvalidos([], [])).toBe(0);
  });

  it("cuenta lo reparado como lo que ya no está", () => {
    const antes = cuentaIdsInvalidos([tarea({ id: "t-1" }), tarea({ id: "t-2" })], []);
    const r = reparaIds([tarea({ id: "t-1" }), tarea({ id: "t-2" })], []);
    expect(antes).toBe(2);
    expect(cuentaIdsInvalidos(r.tareas, r.proyectos)).toBe(0);
  });
});

/**
 * Lo mismo, contra el Dexie de verdad.
 *
 * Los tests de arriba comprueban la decisión. Estos comprueban que la decisión
 * llega a la base de datos, y sobre todo dos cosas que un doble no puede ver:
 *
 *  - que la escritura va dentro de una transacción, para que no se pueda quedar a
 *    medias con una tarea apuntando a un proyecto que ya no existe;
 *  - que un `bulkPut` cambia de verdad la clave primaria, en vez de añadir una
 *    fila nueva y dejar la vieja. Con la clave primaria puesta sobre `id`, un
 *    `put` con otro id NO actualiza: crea otra fila. Si la reparación cambiara el
 *    id sin borrar la vieja, cada tarea rota aparecería duplicada en la lista, y
 *    eso solo se ve mirando la base de datos.
 */
describe("reparaIdsLocales contra la base de datos de verdad", () => {
  beforeEach(async () => {
    await db.tasks.clear();
    await db.projects.clear();
    await db.tombstones.clear();
  });

  it("sustituye los ids rotos y deja las filas BUENAS sin duplicar", async () => {
    const buenaId = "f529507d-4727-4edd-acc8-487ead300a87";
    await db.projects.bulkPut([
      { id: "t-proyecto-1", name: "Roto", color: "#fff" },
      { id: buenaId, name: "Bueno", color: "#000" },
    ]);
    await db.tasks.bulkPut([
      tarea({ id: "t-tarea-1", title: "Rota", projectId: "t-proyecto-1" }),
      tarea({ id: buenaId.replace(/f/, "a"), title: "Buena", projectId: buenaId }),
    ]);

    const reparados = await reparaIdsLocales();

    expect(reparados).toBe(2);
    // Ni una fila de más: si el bulkPut no hubiera cambiado la clave primaria,
    // aquí habría 4 filas en vez de 2.
    expect(await db.tasks.count()).toBe(2);
    expect(await db.projects.count()).toBe(2);

    const ids = (await db.tasks.toArray()).map((t) => t.id);
    for (const id of ids) expect(esUuid(id), id).toBe(true);
    expect(ids).not.toContain("t-tarea-1");
    // La buena conserva su id: no se toca lo que ya funcionaba.
    expect(ids).toContain(buenaId.replace(/f/, "a"));
  });

  it("la tarea sigue apuntando a SU proyecto, no al aire", async () => {
    await db.projects.bulkPut([{ id: "t-proyecto-1", name: "Roto", color: "#fff" }]);
    await db.tasks.bulkPut([tarea({ id: "t-tarea-1", title: "Rota", projectId: "t-proyecto-1" })]);

    await reparaIdsLocales();

    const [p] = await db.projects.toArray();
    const [t] = await db.tasks.toArray();
    expect(esUuid(p.id)).toBe(true);
    expect(t.projectId).toBe(p.id);
    // Y la referencia apunta a algo que EXISTE. Esto es lo que separa una
    // reparación de una bomba: un id nuevo sin reescribir la referencia deja la
    // tarea sin proyecto, y parece que ha funcionado.
    expect(await db.projects.get(t.projectId!)).toBeTruthy();
  });

  it("la subtarea sigue colgada de su madre", async () => {
    await db.tasks.bulkPut([
      tarea({ id: "t-madre-1", title: "Madre" }),
      tarea({ id: "t-hija-1", title: "Hija", parentId: "t-madre-1" }),
    ]);

    await reparaIdsLocales();

    const madre = await db.tasks.get("t-madre-1");
    const todas = await db.tasks.toArray();
    const nuevaMadre = todas.find((t) => t.title === "Madre")!;
    const hija = todas.find((t) => t.title === "Hija")!;
    expect(madre).toBeUndefined();
    expect(esUuid(nuevaMadre.id)).toBe(true);
    expect(hija.parentId).toBe(nuevaMadre.id);
    expect(await db.tasks.get(hija.parentId!)).toBeTruthy();
  });

  it("es idempotente: llamarlo otra vez no cambia nada ni rompe referencias", async () => {
    await db.projects.bulkPut([{ id: "t-proyecto-1", name: "Roto", color: "#fff" }]);
    await db.tasks.bulkPut([tarea({ id: "t-tarea-1", projectId: "t-proyecto-1" })]);

    expect(await reparaIdsLocales()).toBe(2);
    const despues = await db.tasks.toArray();
    expect(await reparaIdsLocales()).toBe(0);
    const otra = await db.tasks.toArray();

    // Si la segunda pasada cambiara algo, sería un bucle infinito en cada
    // arranque: la app no pararía nunca de «reparar».
    expect(otra).toEqual(despues);
  });

  it("sin nada roto no toca la base de datos", async () => {
    await db.tasks.bulkPut([tarea({ id: nuevoId() })]);
    const antes = await db.tasks.toArray();
    expect(await reparaIdsLocales()).toBe(0);
    expect(await db.tasks.toArray()).toEqual(antes);
  });
});