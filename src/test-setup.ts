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
 * global tiene que existir ya. Por el mismo motivo, lo de las variables de
 * entorno de Supabase va aqui y no dentro de cada test: `supabase.ts` las lee
 * AL CARGAR EL MODULO, y los imports se evaluan antes de que ningun `it` empiece.
 */
import "fake-indexeddb/auto";

/**
 * Variables de Supabase de mentira para los tests, solo si no hay de verdad.
 *
 * El `.env` esta en `.gitignore` —no puede ser de otra forma, ahi viven las
 * claves—, asi que en el CI no existe. Y `supabase.ts` hace esto al cargarse:
 *
 *     export const supabase = createClient(supabaseUrl || "", ...)
 *
 * que con la URL vacia lanza `supabaseUrl is required` y tumba el fichero de
 * test entero antes de ejecutar una sola asercion. Por eso la suite fallo trece
 * pushes seguidos en el CI mientras en local estaba en verde.
 *
 * Que sea un setupFile y no un paso del workflow es lo importante. Poner las
 * variables en `ci.yml` habria puesto el CI en verde y habria dejado el mismo
 * troulo para el siguiente test que importe algo de la nube: en mi maqueta, con
 * el `.env` delante, no se ve. Aqui se arregla para todo el mundo, y en todas las
 * maquinas.
 *
 * De mentira y solo si faltan: si hay un `.env` de verdad, manda el de verdad.
 * Que ningún test hable con la nube no se decide aqui — se decide con que no
 * haya llamadas de red en los tests, y un test que las haga se caera al
 * pedirle `https://placeholder.invalid`.
 */
import.meta.env.VITE_SUPABASE_URL ||= "https://placeholder.invalid";
import.meta.env.VITE_SUPABASE_ANON_KEY ||= "placeholder";