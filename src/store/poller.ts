/**
 * Temporizador de sincronización.
 *
 * Existe por un motivo concreto. Con solo los disparadores automáticos —abrir la
 * app, el evento `online`, volver al primer plano— los cambios que se hacían en
 * otro dispositivo llegaban, pero el caso de uso normal de dos móviles (app
 * abierta y en primer plano, creas algo en el otro, miras esta pantalla) no
 * tenía nada que lo despertara. No era lento: era indefinido.
 *
 * Por qué está fuera del componente: para poder probarlo. Un `setInterval`
 * dentro de un `useEffect` no se puede comprobar de verdad —nadie lo renderiza
 * en un entorno de test sin montar React entero—, y un temporizador que nunca se
 * ha probado es justo el tipo de cosa que se rompe en silencio y cuesta
 * batería. Aquí no hay React: hay una función con reloj, y eso sí se mide.
 */

export interface OpcionesPoller {
  /** Cada cuánto mirar la nube. */
  cadaMs: number;
  /** Una sincronización completa. Puede tardar; no se encadena. */
  sincronizar: () => Promise<unknown>;
  /** ¿Está la app a la vista? Por defecto, `document.visibilityState`. */
  visible?: () => boolean;
}

export interface Poller {
  /** Sincroniza ahora, respetando visibilidad y sin encadenar. */
  tick: () => void;
  /** Llamar al volver al primer plano: no se espera al siguiente tick. */
  alVolver: () => void;
  parar: () => void;
}

function porDefectoVisible(): boolean {
  // Sin `document` (tests en node) se considera visible, que es lo que permite
  // probar el temporizador sin DOM.
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** Crea el temporizador sin arrancarlo: el `setInterval` lo pone `arrancarPoller`. */
export function crearPoller(op: OpcionesPoller): Poller {
  const visible = op.visible ?? porDefectoVisible;
  let ocupado = false;

  const tick = () => {
    // En segundo plano no: los navegadores congelan la página y sincronizar a
    // ciegas es gastar datos sin que nadie mire. Al volver llama `alVolver`.
    if (ocupado || !visible()) return;
    ocupado = true;
    // Se libera el candado pase lo que pase, y no solo cuando la promesa se
    // resuelve. Si la sincronización revienta —o lanza de forma síncrona—, el
    // temporizador quedaría muerto para siempre y el síntoma sería «la app no
    // sincroniza», sin error ni aviso: el peor modo de fallo posible.
    try {
      // `then` con los DOS handlers, y no `finally`: `finally` devuelve una
      // promesa que vuelve a rechazar si la original rechazó, y como nadie la
      // recoge eso es un «unhandled rejection» en la consola cada 30 segundos
      // que la red falla. Escrito así el candado se libera en los dos casos y
      // el rechazo se queda atendido — de avisar ya se encarga quien
      // sincroniza, que es quien sabe qué pasó.
      void Promise.resolve(op.sincronizar()).then(
        () => {
          ocupado = false;
        },
        () => {
          ocupado = false;
        },
      );
    } catch {
      ocupado = false;
    }
  };

  return { tick, alVolver: tick, parar: () => {} };
}

/** Crea el temporizador y lo deja corriendo. */
export function arrancarPoller(op: OpcionesPoller): Poller {
  const p = crearPoller(op);
  const id = setInterval(() => p.tick(), op.cadaMs);
  return {
    tick: p.tick,
    alVolver: p.alVolver,
    parar: () => {
      clearInterval(id);
      p.parar();
    },
  };
}