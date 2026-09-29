/**
 * Puente DOM de ald-a-animations.js para la app React.
 *
 * En React no enlazamos clics para marcar `.done` (el estado manda:
 * TaskItem añade la clase según task.status). Aquí quedan las dos
 * piezas que sí necesitan tocar el DOM después del render:
 *
 *  1) Entrada escalonada: asigna `--d` a cada `.task-card` según su
 *     índice dentro de `.task-list / main / [data-stagger]`, y añade la
 *     clase base `.anim-in`. Los temas usan calc(var(--d) * Xms) como
 *     retardo.
 *  2) Trazos de tinta-viva: prepara pathLength="100" en `.ink-stroke path`
 *     para que stroke-dashoffset dibuje la pincelada.
 *
 * Detalles de integración:
 *  · `useLayoutEffect` en App + ejecución síncrona inicial: los primeros
 *    `--d` se asignan antes del primer paint (sin parpadeo de retardo 0).
 *  · MutationObserver + rAF: las cards que llegan con navegación reciben
 *    su retardo antes del siguiente paint.
 *  · Se procesa una sola vez por elemento (data-staggered) para no
 *    reiniciar animaciones en curso en cada mutación.
 *  · `--d` se acota a MAX_D: en una lista larga la última card no debe
 *    esperar cuatro segundos.
 */

const MAX_D = 9;

function stampCards(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".task-list, main, [data-stagger]").forEach((box) => {
    box.querySelectorAll<HTMLElement>(":scope .task-card").forEach((card, i) => {
      if (card.dataset.staggered) return;
      card.dataset.staggered = "1";
      card.style.setProperty("--d", String(Math.min(i, MAX_D)));
      card.classList.add("anim-in");
    });
  });
}

function prepInkStrokes(root: ParentNode): void {
  root.querySelectorAll(".ink-stroke path").forEach((p) => {
    p.setAttribute("pathLength", "100");
  });
}

/** Arranca el puente. Devuelve la función de limpieza. */
export function startAnimBridge(): () => void {
  let raf = 0;

  const run = () => {
    raf = 0;
    stampCards(document);
    prepInkStrokes(document);
  };

  // rAF: el callback corre antes del paint del mismo frame, así que las
  // mutaciones vistas por el observer se estampan sin parpadear.
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run);
  };

  run(); // estado inicial (antes del primer paint, vía useLayoutEffect)
  const obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true });

  return () => {
    obs.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}
