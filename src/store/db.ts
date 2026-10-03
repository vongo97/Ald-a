import Dexie, { type EntityTable } from "dexie";
import type { Project, Task } from "@/domain/types";
import { toISODate } from "@/domain/dateutils";
import { reparaIds } from "./reparaIds";

export interface Tombstone {
  id: string;
  kind: "tasks" | "projects";
  updatedAt: string;
}

export class TareasDB extends Dexie {
  tasks!: EntityTable<Task, "id">;
  projects!: EntityTable<Project, "id">;
  tombstones!: EntityTable<Tombstone, any>;

  constructor() {
    super("tareas-db");
    this.version(1).stores({
      tasks: "id, status, dueDate, projectId, parentId, order, *labels",
      projects: "id, name",
    });
    // v2: tabla de tumbas para propagar borrados offline.
    this.version(2).stores({
      tombstones: "[kind+id], updatedAt",
    });
  }
}

export const db = new TareasDB();

/** Timestamp ISO para sellar escrituras y borrados. */
export const stampNow = (): string => new Date().toISOString();

/**
 * Sella `updatedAt` en TODA escritura, sin que cada punto de llamada
 * tenga que acordárselo (esto cubre también los `put()` directos de BreakdownButton).
 *
 * Regla clave: solo sella si quien escribe no trae ya su propio `updatedAt`.
 * Así `pullAndSyncFromSupabase` conserva el timestamp real de la nube en vez
 * de pisarlo con "ahora", y la importación de un backup respeta sus fechas.
 */
db.tasks.hook("creating", (_primKey, obj) => {
  const target = obj as unknown as Task;
  if (!target.updatedAt) target.updatedAt = stampNow();
});

db.projects.hook("creating", (_primKey, obj) => {
  const target = obj as unknown as Project;
  if (!target.updatedAt) target.updatedAt = stampNow();
});

/**
 * Actualización parcial que SELLA `updatedAt`, salvo que quien llame traiga su
 * propia fecha (el pull de la nube y la importación de un backup respetan la
 * fecha del autor).
 *
 * ── Por qué esto NO es un hook ────────────────────────────────────────────
 *
 * Aquí hubo un hook `updating` con la intención de sellar la fecha sola:
 *
 *   db.tasks.hook("updating", (mods) => {
 *     if (!("updatedAt" in mods)) mods.updatedAt = stampNow();
 *   });
 *
 * Parecía funcionar, pero no lo hacía NUNCA. Dexie no entrega a ese hook solo
 * lo que el llamante pasó: le entrega las modificaciones YA combinadas con el
 * registro guardado, `updatedAt` incluido. Así que `"updatedAt" in mods` era
 * siempre true y el `if` nunca entraba. El hook se disparaba, se leía, y no
 * sellaba nada. Un fallo silencioso: no daba error, solo una fecha congelada.
 *
 * Eso era grave porque `updatedAt` es el reloj de toda la sincronización:
 * `needsPush` sube solo lo local MÁS RECIENTE, y `mergeDecision` hace ganar al
 * más reciente. Con la fecha clavada desde la creación, ni una edición ni un
 * "completar" eran más recientes que nada, así que:
 *
 *  - Una edición hecha sin conexión NO se subía al reconectar: `needsPush` ve
 *    empate y dice que no. El trabajo offline se perdía en silencio.
 *  - Dos dispositivos nunca convergían: empate para los dos, cada uno se
 *    queda con su versión, para siempre.
 *
 * `patchTask` / `patchProject` hacen el sellado explícito y en un sitio solo.
 * Un test (`db.test.ts`) impide que vuelva a colarse un `db.tasks.update()`
 * suelto por ahí.
 */
export async function patchTask(id: string, changes: Partial<Task>): Promise<void> {
  await db.tasks.update(id, "updatedAt" in changes ? changes : { ...changes, updatedAt: stampNow() });
}

export async function patchProject(id: string, changes: Partial<Project>): Promise<void> {
  await db.projects.update(id, "updatedAt" in changes ? changes : { ...changes, updatedAt: stampNow() });
}

/**
 * Un identificador con FORMA de uuid v4, siempre.
 *
 * Antes esto era `crypto.randomUUID?.() ?? \`t-<base36>-<algo>\``. El respaldo
 * era el problema, no una red de seguridad: la columna de la nube es
 * `id uuid NOT NULL`, así que un id con otra forma no es que suba tarde — es que
 * NO PUEDE subir nunca. La tarea se queda en «pendiente» para siempre, sin error
 * visible, y solo se va si la borras y la vuelves a crear.
 *
 * Y el respaldo no era una casualidad: `crypto.randomUUID` solo existe en un
 * CONTEXTO SEGURO, y un contexto seguro es https, localhost o… nada más. Abrir
 * la app en el móvil por la IP de la Wi-Fi (http://192.168.20.34:4179) es HTTP sin
 * cifrar, luego no lo es. Medido en ese origen:
 *
 *     isSecureContext: false    crypto.randomUUID: undefined
 *
 * y el id que salía era `t-murt2nzz-qn6mnx`. En `http://localhost:4179` el
 * mismo navegador da `isSecureContext: true` y un uuid de verdad. Por eso en el
 * escritorio esto no lo ha visto nadie en tres sesiones: en el escritorio nunca
 * pasa.
 *
 * La corrección es que el respaldo tenga la forma correcta. No hace falta
 * `randomUUID` para eso: `crypto.getRandomValues` sí está disponible fuera de
 * contexto seguro —también medido, `function` en el mismo origen sin cifrar— y
 * con sus 16 bytes se monta un uuid v4 sin depender de nada mas.
 *
 * Último respaldo con `Math.random`, para un navegador tan viejo que no tenga ni
 * `getRandomValues`. No es entropía criptográfica, y aquí no hace falta: son
 * identificadores de las tareas de una persona, bajo RLS, no tokens. Lo que no
 * es admisible es que tengan OTRA FORMA, porque eso ya no depende de la
 * entropía sino del tipo de la columna.
 */
function uuidV4(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Bits de versión (4) y de variante (RFC 4122), que es lo que distingue un
  // uuid de un numero hexadecimal de 32 signos con guiones puestos.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const uid = (): string =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : uuidV4();

export const newId = uid;

/**
 * Repara los ids que la app se inventó antes y que la nube no puede aceptar.
 *
 * Devuelve cuántas filas tenía el id con forma `t-…` que `uid()` producía fuera
 * de un contexto seguro, para poder avisar. Cero es lo normal desde el arreglo de
 * `uid`; un número mayor que cero significa que este dispositivo arrastra trabajo
 * hecho antes, y que sin esto seguiría en «pendiente» para siempre.
 *
 * Se ejecuta antes que `seedIfEmpty` y antes de cualquier sincronización: si no,
 * la primera subida volvería a fallar con las filas viejas y el arreglo parecería
 * que no funciona.
 */
export async function reparaIdsLocales(): Promise<number> {
  const [tareas, proyectos] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
  const { tareas: t2, proyectos: p2, cambiados, idsViejos } = reparaIds(tareas, proyectos);
  if (cambiados === 0) return 0;

  // En una transacción, y BORRANDO antes de escribir.
  //
  // El borrado no es opcional: la clave primaria está sobre `id`, así que un
  // `bulkPut` con un id distinto no actualiza la fila, AÑADE otra. Sin borrar,
  // cada tarea rota se duplicaba en la lista, la vieja seguía con su id `t-…` y
  // la reparación volvería a encontrarla en el siguiente arranque, para siempre.
  //
  // Los tests contra el Dexie de verdad lo pillaron: el primero decía
  // `expected 3 to be 2`, y el que comprobaba la idempotencia decía que la
  // segunda pasada encontraba 2 ids otra vez. Los tests de la función pura pasaban
  // los trece y aun así esto rompía.
  await db.transaction("rw", db.tasks, db.projects, async () => {
    await db.projects.bulkDelete(idsViejos);
    await db.tasks.bulkDelete(idsViejos);
    await db.projects.bulkPut(p2);
    await db.tasks.bulkPut(t2);
  });

  console.info(
    `[sync] Reparados ${cambiados} ids con formato antiguo (t-…). Esas filas no ` +
      `podían subir nunca; ahora ya pueden.`,
  );
  return cambiados;
}

export async function seedIfEmpty(): Promise<void> {
  const count = await db.tasks.count();
  if (count > 0) return;
  const now = new Date().toISOString();
  const hoy = toISODate(new Date());
  const manana = toISODate(new Date(Date.now() + 86400_000));
  const projectId = uid();
  await db.projects.bulkPut([
    { id: projectId, name: "Personal", color: "#38bdf8" },
    { id: uid(), name: "Trabajo", color: "#f472b6" },
  ]);
  await db.tasks.bulkPut([
    {
      id: uid(),
      title: "Bienvenida: pulsa / para capturar una tarea",
      labels: ["guía"],
      priority: 2,
      importance: 3,
      status: "todo",
      order: 0,
      createdAt: now,
      dueDate: hoy,
    },
    {
      id: uid(),
      title: "Prueba la captura rápida: escribe «Llamar al fontanero mañana a las 10»",
      labels: ["guía"],
      priority: 3,
      importance: 3,
      status: "todo",
      order: 1,
      createdAt: now,
      dueDate: manana,
    },
    {
      id: uid(),
      title: "Revisa la vista Revisión semanal los domingos",
      labels: ["guía"],
      priority: 3,
      importance: 2,
      recurrence: { kind: "weekly", every: 1, weekdays: [0] },
      status: "todo",
      order: 2,
      createdAt: now,
      dueDate: hoy,
    },
  ]);
}
