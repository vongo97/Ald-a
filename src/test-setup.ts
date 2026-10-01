/**
 * IndexedDB en memoria para los tests.
 *
 * `store/db.ts` es un Dexie de verdad, con hooks que sellan `updatedAt` en cada
 * escritura y una clave primaria compuesta `[kind+id]` en las tumbas. Un doble
 * escrito a mano se saltaria justo lo que queremos comprobar: que
 * `db.tombstones.put({id, kind})` de verdad sobrescribe por la compuesta y no
 * duplica filas, que el hook de `updating` sella la fecha, que la cascada de
 * borrado recorre el arbol. Con una implementacion real, los tests escriben y
 * leen de verdad.
 *
 * `fake-indexeddb/auto` instala en `globalThis` lo que Dexie necesita
 * (`indexedDB`, `IDBKeyRange`, ...). Funciona con `environment: "node"`: no
 * hace falta jsdom para esto.
 *
 * Va como setupFile y no dentro de los tests porque el orden de los imports
 * importa: Dexie abre la base al construirse el modulo, y para entonces el
 * global tiene que existir ya.
 */
import "fake-indexeddb/auto";