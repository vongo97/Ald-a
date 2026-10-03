/**
 * ¿Este error es «no hay red» y no «la app ha fallado»?
 *
 * Un fallo de red llega como un `TypeError` de `fetch` envuelto, sin código
 * HTTP: nunca hubo respuesta. Un fallo de verdad (RLS, SQL, tabla que no
 * existe) llega con su código y su mensaje. La app no tiene por qué poner un
 * punto rojo de alarma al usuario que está en modo avión con todo su trabajo
 * a salvo en el dispositivo.
 *
 * Vive aquí, y no en `sync.ts`, por una razón concreta: no depende de nada. Ni
 * de la nube, ni de Dexie, ni de la tienda, ni del reloj.
 *
 * Estaba en `sync.ts`, y el test que la comprobaba la pedía desde ahí. Eso
 * arrastraba `supabase.ts`, que llama a `createClient` AL CARGAR EL MÓDULO, y
 * `createClient` sin `VITE_SUPABASE_URL` lanza `supabaseUrl is required`. En la
 * máquina de quien programa hay un `.env` y no se ve nada; en el CI, donde el
 * `.env` no está (está en `.gitignore`), el proceso moría antes de empezar.
 *
 * Es decir: un test que solo quería comparar cadenas de texto depended del
 * entorno. Así es como se rompe una suite en Linux sin haber roto nunca en
 * Windows, y por eso el CI llevaba trece pushes en rojo sin que nadie supiera
 * por qué.
 */

/** Lo que dice la red cuando no hay red. Todo en minúsculas para comparar. */
const SINTOMAS_DE_CAIDA =
  /typeerror|failed to fetch|networkerror|network request failed|econnrefused|err_internet_disconnected|load failed/;

export function esCaidaDeRed(err: unknown): boolean {
  if (!err) return false;
  const msg = String((err as { message?: unknown })?.message ?? err).toLowerCase();
  if (SINTOMAS_DE_CAIDA.test(msg)) return true;
  // `navigator.onLine === false` es una señal débil y a veces falsa, pero cuando
  // dice que no hay red, es que no hay red.
  return typeof navigator !== "undefined" && navigator.onLine === false;
}