import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Project } from "@/domain/types";

/**
 * Tests de las acciones que tocan la nube.
 *
 * Por que este fichero existe: el bug de resurreccion (una tarea borrada
 * reaparecia como activa en un dispositivo limpio) vivia aqui, en
 * `deleteTask`/`deleteProject`, y no habia ni un solo test sobre este modulo.
 * Estos tests atacan la mitad del protocolo que faltaba — que el borrado
 * suba la fila y no solo la tombstone — y la cascada, que es donde un error
 * destructa mas.
 *
 * `sync.ts` va doblado por completo: aqui no se prueba la red (eso es cosa de
 * sync.test.ts), sino QUE se llama y CON QUE datos. IndexedDB si es real, con
 * fake-indexeddb (ver src/test-setup.ts), para que los hooks de `updatedAt` y
 * la clave compuesta `[kind+id]` de las tumbas se comporten de verdad.
 */

// ─── Doble de sync.ts: registra las llamadas, no hace red ────────────────────
const {
  pushDeletedTasks,
  pushDeletedProjects,
  pushTasks,
  pushTask,
  pushProject,
  restoreTasks,
  restoreProjects,
} = vi.hoisted(() => ({
  pushDeletedTasks: vi.fn(async () => {}),
  pushDeletedProjects: vi.fn(async () => {}),
  pushTasks: vi.fn(async () => {}),
  pushTask: vi.fn(async () => {}),
  pushProject: vi.fn(async () => {}),
  restoreTasks: vi.fn(async () => {}),
  restoreProjects: vi.fn(async () => {}),
}));

vi.mock("../sync", () => ({
  autoPushDeletedTasks: pushDeletedTasks,
  autoPushDeletedProjects: pushDeletedProjects,
  autoPushTasks: pushTasks,
  autoPushTask: pushTask,
  autoPushProject: pushProject,
  autoRestoreTasks: restoreTasks,
  autoRestoreProjects: restoreProjects,
}));

import { db } from "../db";
import {
  deleteTask,
  deleteProject,
  restoreTask,
  restoreProject,
  createProject,
  createTaskFromCapture,
  updateTask,
} from "../actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────
let seq = 0;

function makeTask(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Tarea ${seq}`,
    labels: [],
    priority: 3,
    importance: 3,
    status: "todo",
    order: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

async function seed(...tasks: Task[]): Promise<void> {
  await db.tasks.bulkPut(tasks);
}

/**
 * Los ids que recibió la última llamada a un push.
 *
 * Acepta por lotes (`autoPushTasks([t1, t2])`) y por fila suelta
 * (`autoPushTask(t)`), que es como el código real los usa.
 */
function idsOf(call: ReturnType<typeof vi.fn>): string[] {
  const args: unknown[] = call.mock.calls.at(-1) ?? [];
  // Un lote (`[t1, t2]`) o una fila suelta (`t`). Un `[]` es un lote vacío.
  const rows = (args.length === 1 && !Array.isArray(args[0]) ? [args[0]] : args[0] ?? []) as Array<{
    id: string;
  }>;
  return rows.map((r) => r.id);
}

/** Las filas (no solo los ids) del último push, para aserciones de contenido. */
function rowsOf<T>(call: ReturnType<typeof vi.fn>): T[] {
  const args: unknown[] = call.mock.calls.at(-1) ?? [];
  const rows = (args.length === 1 && !Array.isArray(args[0]) ? [args[0]] : args[0] ?? []) as T[];
  return rows;
}

beforeEach(async () => {
  await db.tasks.clear();
  await db.projects.clear();
  await db.tombstones.clear();
  for (const m of [
    pushDeletedTasks, pushDeletedProjects, pushTasks,
    pushTask, pushProject, restoreTasks, restoreProjects,
  ]) m.mockClear();
});

// ─── deleteTask: la fila sube marcada, no solo la tombstone ─────────────────
describe("deleteTask", () => {
  it("marca la tarea como borrada en local", async () => {
    const t = makeTask({ title: "Se va" });
    await seed(t);

    await deleteTask(t.id);

    const after = await db.tasks.get(t.id);
    expect(after!.deletedAt).toBeTruthy();
  });

  it("sube la fila con autoPushDeletedTasks (no solo la tombstone)", async () => {
    const t = makeTask();
    await seed(t);

    await deleteTask(t.id);

    // Esta es la asercion que habria atrapado el bug de resurreccion: si
    // `deleteTask` volviera a subir unicamente la tombstone, esta llamada
    // seria de autoPushDeleteTask y el test fallaria.
    expect(pushDeletedTasks).toHaveBeenCalledTimes(1);
    const rows = rowsOf<Task>(pushDeletedTasks);
    expect(rows.map((r) => r.id)).toEqual([t.id]);
    expect(rows[0].deletedAt).toBeTruthy();
  });

  it("NO sube la fila por la vía de las vivas (autoPushTasks)", async () => {
    const t = makeTask();
    await seed(t);

    await deleteTask(t.id);

    // Una tarea borrada no puede viajar por el camino de las vivas: ahi no
    // lleva `deleted_at` y el servidor la daria por buena.
    expect(pushTasks).not.toHaveBeenCalled();
    expect(pushTask).not.toHaveBeenCalled();
  });

  it("escribe la tombstone local con kind 'tasks'", async () => {
    const t = makeTask();
    await seed(t);

    await deleteTask(t.id);

    const tomb = await db.tombstones.get(["tasks", t.id]);
    expect(tomb).toBeDefined();
    expect(tomb!.id).toBe(t.id);
  });

  it("la cascada marca TODA la descendencia, hasta los nietos", async () => {
    const root = makeTask({ title: "Padre" });
    const child = makeTask({ title: "Hijo", parentId: root.id });
    const grandchild = makeTask({ title: "Nieto", parentId: child.id });
    await seed(root, child, grandchild);

    await deleteTask(root.id);

    for (const t of [root, child, grandchild]) {
      expect((await db.tasks.get(t.id))!.deletedAt).toBeTruthy();
      expect(await db.tombstones.get(["tasks", t.id])).toBeDefined();
    }
    // Y los tres en una sola llamada, para que la nube los sepa de una vez.
    expect(idsOf(pushDeletedTasks).sort()).toEqual([root.id, child.id, grandchild.id].sort());
  });

  it("la cascada NO toca a las hermanas", async () => {
    const root = makeTask();
    const childA = makeTask({ parentId: root.id, title: "A" });
    const childB = makeTask({ parentId: root.id, title: "B" });
    const sister = makeTask({ title: "Hermana del padre", parentId: root.parentId });
    await seed(root, childA, childB, sister);

    await deleteTask(root.id);

    expect((await db.tasks.get(sister.id))!.deletedAt).toBeUndefined();
    expect(await db.tombstones.get(["tasks", sister.id])).toBeUndefined();
  });

  it("un id inexistente no revienta ni sube nada", async () => {
    await seed(makeTask());

    await expect(deleteTask("no-existe")).resolves.toBeUndefined();

    // Se llama al push, pero con el lote vacio: `autoPushDeletedRows` corta
    // antes de tocar la red. Lo que importa es que no salga ninguna fila.
    expect(pushDeletedTasks).toHaveBeenCalledTimes(1);
    expect(idsOf(pushDeletedTasks)).toEqual([]);
    expect(idsOf(pushTasks)).toEqual([]);
  });

  it("dos ids pueden compartir tombstone sin pisarse (PK [kind+id])", async () => {
    // La PK de las tumbas es compuesta. Un `delete` por `id` a secas habria
    // borrado las de las dos; por eso el test usa `[kind, id]`.
    const a = makeTask();
    const b = makeTask();
    await seed(a, b);
    await db.tombstones.bulkPut([
      { id: a.id, kind: "tasks" as const, updatedAt: "2026-01-01T00:00:00Z" },
      { id: b.id, kind: "tasks" as const, updatedAt: "2026-01-01T00:00:00Z" },
    ]);

    await deleteTask(a.id);

    expect((await db.tasks.get(a.id))!.deletedAt).toBeTruthy();
    // La otra sigue viva, con su tombstone intacta.
    expect((await db.tasks.get(b.id))!.deletedAt).toBeUndefined();
    expect(await db.tombstones.get(["tasks", b.id])).toBeDefined();
  });
});

// ─── deleteProject: el proyecto se borra, las tareas se desenganchan ─────────
describe("deleteProject", () => {
  async function seedProjectWith(...tasks: Task[]): Promise<Project> {
    const p = await createProject("Trabajo", "#38bdf8");
    await seed(...tasks.map((t) => ({ ...t, projectId: p.id })));
    return p;
  }

  it("marca el proyecto como borrado en local", async () => {
    const p = await seedProjectWith();

    await deleteProject(p.id);

    expect((await db.projects.get(p.id))!.deletedAt).toBeTruthy();
  });

  it("sube el proyecto con autoPushDeletedProjects", async () => {
    const p = await seedProjectWith();

    await deleteProject(p.id);

    expect(pushDeletedProjects).toHaveBeenCalledTimes(1);
    const rows = rowsOf<Project>(pushDeletedProjects);
    expect(rows[0].id).toBe(p.id);
    expect(rows[0].deletedAt).toBeTruthy();
  });

  it("desengancha las tareas y las sube VIVAS, no borradas", async () => {
    const p = await seedProjectWith(makeTask({ title: "Dentro" }), makeTask({ title: "Otra" }));

    await deleteProject(p.id);

    // Las tareas no se borran, pierden el proyecto. Si se subieran por la vía
    // de las borradas desaparecerian de la Papelera sin que nadie las metiera.
    const rows = rowsOf<Task>(pushTasks);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.projectId).toBeUndefined();
      expect(r.deletedAt).toBeUndefined();
    }
    for (const r of await db.tasks.toArray()) {
      expect(r.projectId).toBeUndefined();
      expect(r.deletedAt).toBeUndefined();
    }
  });

  it("no sube por la vía de borradas las tareas desenganchadas", async () => {
    const p = await seedProjectWith(makeTask());

    await deleteProject(p.id);

    const ids = idsOf(pushDeletedProjects);
    expect(ids).not.toContain((await db.tasks.toArray())[0].id);
  });
});

// ─── restoreTask: el espejo del borrado ─────────────────────────────────────
describe("restoreTask", () => {
  it("quita deletedAt y sube la fila restaurada", async () => {
    const t = makeTask();
    await seed(t);
    await deleteTask(t.id);

    const n = await restoreTask(t.id);

    expect(n).toBe(1);
    expect((await db.tasks.get(t.id))!.deletedAt).toBeUndefined();
    expect(restoreTasks).toHaveBeenCalledTimes(1);
    const rows = rowsOf<Task>(restoreTasks);
    expect(rows[0].id).toBe(t.id);
    expect(rows[0].deletedAt).toBeUndefined();
  });

  it("borra la tombstone local: si se queda, el pull re-borra", async () => {
    const t = makeTask();
    await seed(t);
    await deleteTask(t.id);
    expect(await db.tombstones.get(["tasks", t.id])).toBeDefined();

    await restoreTask(t.id);

    expect(await db.tombstones.get(["tasks", t.id])).toBeUndefined();
  });

  it("restaura la cascada entera, y nada mas", async () => {
    const root = makeTask();
    const child = makeTask({ parentId: root.id });
    const sister = makeTask();
    await seed(root, child, sister);
    await deleteTask(root.id);

    await restoreTask(root.id);

    expect((await db.tasks.get(root.id))!.deletedAt).toBeUndefined();
    expect((await db.tasks.get(child.id))!.deletedAt).toBeUndefined();
    expect((await db.tasks.get(sister.id))!.deletedAt).toBeUndefined();
  });

  it("restaurar algo vivo no hace nada", async () => {
    const t = makeTask();
    await seed(t);

    expect(await restoreTask(t.id)).toBe(0);
    expect(restoreTasks).not.toHaveBeenCalled();
  });
});

// ─── restoreProject ──────────────────────────────────────────────────────────
describe("restoreProject", () => {
  it("restaura el proyecto y lo sube con autoRestoreProjects", async () => {
    const p = await createProject("Trabajo", "#38bdf8");
    await deleteProject(p.id);

    const n = await restoreProject(p.id);

    expect(n).toBe(1);
    expect((await db.projects.get(p.id))!.deletedAt).toBeUndefined();
    expect(await db.tombstones.get(["projects", p.id])).toBeUndefined();
    expect(restoreProjects).toHaveBeenCalledTimes(1);
  });

  it("restaurar un proyecto vivo no hace nada", async () => {
    const p = await createProject("Trabajo", "#38bdf8");

    expect(await restoreProject(p.id)).toBe(0);
    expect(restoreProjects).not.toHaveBeenCalled();
  });
});

// ─── updateTask: el sello de updatedAt ───────────────────────────────────────
describe("updateTask", () => {
  it("sella updatedAt al editar y sube la fila", async () => {
    const t = makeTask({ title: "Antes" });
    await seed(t);

    await updateTask(t.id, { title: "Despues" });

    const after = await db.tasks.get(t.id);
    expect(after!.title).toBe("Despues");
    // El hook `updating` de db.ts sella la fecha; sin esto, `needsPush` no
    // reconoceria el cambio como mas reciente que la nube.
    expect(Date.parse(after!.updatedAt!)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
    expect(idsOf(pushTask)).toEqual([t.id]);
  });

  it("no sella una fecha que el llamante ya traia", async () => {
    // Importar un backup trae sus propias fechas: respetarlas evita que una
    // restauracion parezca recien editada.
    const t = makeTask();
    await seed(t);

    await updateTask(t.id, { updatedAt: "2020-06-01T00:00:00Z" });

    expect((await db.tasks.get(t.id))!.updatedAt).toBe("2020-06-01T00:00:00Z");
  });
});

// ─── createTaskFromCapture: el camino que nace de la captura rapida ──────────
describe("createTaskFromCapture", () => {
  // `ParsedCapture` es la salida del parser, no la entrada cruda: las fechas
  // ya vienen resueltas a ISO. Aqui se prueba el ensamblado de la tarea, que es
  // lo que vive en actions.ts; el parser tiene sus propios tests en
  // parsers/__tests__/capture.test.ts.

  it("crea la tarea en local y la sube", async () => {
    const created = await createTaskFromCapture({
      title: "Llamar al fontanero",
      dueDate: "2026-01-02",
      dueTime: "10:00",
      labels: [],
      matched: [],
    });

    expect(created.title).toBe("Llamar al fontanero");
    expect(created.dueDate).toBe("2026-01-02");
    expect(created.dueTime).toBe("10:00");
    expect(await db.tasks.get(created.id)).toBeDefined();
    expect(idsOf(pushTask)).toEqual([created.id]);
  });

  it("crea el proyecto si la captura lo menciona", async () => {
    const created = await createTaskFromCapture({
      title: "Firmar contrato",
      projectName: "Trabajo",
      labels: [],
      matched: [],
    });

    expect(created.projectId).toBeTruthy();
    expect(await db.projects.get(created.projectId!)).toBeDefined();
  });

  it("reutiliza el proyecto si ya existe con ese nombre", async () => {
    const existing = await createProject("Trabajo", "#38bdf8");

    const created = await createTaskFromCapture({
      title: "Otra cosa",
      projectName: "Trabajo",
      labels: [],
      matched: [],
    });

    expect(created.projectId).toBe(existing.id);
    // No se crea un segundo proyecto con el mismo nombre.
    expect(await db.projects.count()).toBe(1);
  });

  it("respeta los defaults y numera el orden", async () => {
    const first = await createTaskFromCapture({ title: "Una", labels: [], matched: [] });
    const second = await createTaskFromCapture({ title: "Dos", labels: [], matched: [] });

    expect(first.priority).toBe(3);
    expect(first.importance).toBe(3);
    expect(first.status).toBe("todo");
    expect(second.order).toBe(first.order + 1);
  });

  it("los `extra` del llamante ganan sobre lo calculado", async () => {
    // El breakdown manda subtareas ya con su parentId: no puede pisarse con el
    // orden calculado a partir de las tareas sueltas.
    const created = await createTaskFromCapture(
      { title: "Paso", labels: [], matched: [] },
      { parentId: "raiz-1", order: 7 },
    );

    expect(created.parentId).toBe("raiz-1");
    expect(created.order).toBe(7);
  });
});