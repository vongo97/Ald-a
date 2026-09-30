import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useStore, toggleWithUndo } from "@/store/useStore";
import { toggleTask } from "@/store/actions";
import { priorityScore } from "@/domain/priority";
import {
  CX,
  CY,
  R_ARCO,
  CARRILES,
  SW_ARCO,
  SW_HIJO,
  SW_DIA,
  HIT_ARCO,
  HIT_HIJO,
  HORAS_LECTURA,
  degOf,
  polar,
  arcPath,
  arcSpan,
  arcoDelDia,
  minutosDeHoy,
  desenrollar,
  packLanes,
  dyParaEtiquetas,
  pintarReloj,
} from "@/domain/orbit";
import type { NodoReloj } from "@/domain/orbit";
import type { Task } from "@/domain/types";
import { useBreakdown } from "@/hooks/useBreakdown";
import BreakdownModal from "./BreakdownModal";

/**
 * Día en órbita — Cronodisco (v4: despliegue + reloj que sí marca).
 *
 * «La lista desaparece: tu día es un reloj astronómico.» Cada tarea con
 * hora es un arco sobre las 24 h del anillo; la etiqueta cae fuera del
 * círculo junto al punto medio del arco (la misma idea que el
 * `centroid()` de d3-shape/arc).
 *
 * El disco está QUIETO y es correcto que lo esté: las tareas están
 * ancladas a su hora, así que las marcas de hora también. Lo que se
 * mueve es el día — la aguja real (`--needle-rot`) y el arco interior
 * 0:00→ahora —, y ambos viven en `<RelojVivo>` para que el segundero no
 * arrastre al resto del reloj. Cifras 00/06/12/18 en el interior: sin
 * ellas el disco no se puede leer.
 *
 * Tocar el reloj NO completa: es el despliegue (regla del usuario,
 * «Despliegue en el reloj»). El recorrido vive en el dominio
 * (`pintarReloj`) y aquí solo se enruta el toque:
 *  - arco con subtareas  → pliega/despliega su desglose (arcos finos
 *    con el color de la familia; las hijas sin hora, etiqueta anclada
 *    en el ángulo de la madre);
 *  - arco raíz sin subtareas → abre el flujo de desglose (IA o
 *    plantilla local → BreakdownModal) — se desglosa, no se cumple;
 *  - hija sin subtareas → toggle con deshacer;
 *  - completar → la casilla de la etiqueta (raíz o nodo con hijos).
 *
 * TodayView pasa TODAS las tareas de hoy (raíces y subtareas); aquí se
 * filtra por hora dentro de `pintarReloj`. Las tareas sin hora que no
 * son hija de nadie no caben en el anillo: se quedan en «Sin hora».
 * El svg va `absolute inset-0` con `overflow: visible` para que las
 * etiquetas nunca se recorten.
 */

interface Props {
  tasks: Task[];
  today: string;
}

const R_LABEL = 84;

/**
 * Presupuesto radial del centro hacia fuera. Los números no se pueden
 * poner donde se quiera: el carril más profundo de tareas ocupa
 * 34–44 y el anillo del día necesita su hueco, así que entre ambos solo
 * queda la franja 21–33 para las cifras.
 *   17–19  anillo del día (trazo 2)   R_DIA
 *   21–30  cifras 00/06/12/18         R_NUM (fontSize 7)
 *   34–44  carril 3 de tareas
 *   39–49  carril 2 · 50–60 carril 1 · 67–77 carril 0
 *   75–80  marcas de hora · 84+ etiquetas
 */
const R_DIA = 18;
const R_NUM = 27;
const FS_NUM = 7;
/**
 * Truncado de las etiquetas. Las que llevan casilla van más cortas:
 * al sumar el cuadradito por fuera, el conjunto no debe salirse de la
 * tarjeta (el ancho REAL se mide con getComputedTextLength, abajo).
 */
const TRUNC = 10;
const TRUNC_LARGO = 13;

/** Paleta de arcos: ámbar del tema, teal, oro y coral. */
const COLORES = ["var(--accent)", "#5fa8a0", "#d9b45a", "var(--accent-2)"];

interface Etiqueta {
  x: number;
  y: number;
  lado: "I" | "D";
  texto: string;
  /** Ancho del texto solo (para situar la casilla tras él). */
  anchoTexto: number;
  /** Ancho ocupado en la tertulia (texto + casilla si la hay). */
  ancho: number;
  conCheck: boolean;
  score: number | null;
}

/**
 * Aguja + arco del día: lo único del disco que se mueve.
 *
 * Vive en su propio componente (y su propio intervalo de 1 s) para que
 * el avance del tiempo NO re-renderice el resto del reloj: las etiquetas
 * ya midieron su texto con getComputedTextLength y no hay que repetir la
 * medida 60 veces por minuto. El segundero sale de los segundos reales
 * (`minutosDeHoy`) y la transición CSS de 1 s lo interpola, así que
 * avanza continuo en vez de dar un salto cada minuto.
 *
 * El disco NO gira: las tareas están fijas en su hora y las marcas de
 * hora también, o el reloj mentiría. Lo que avanza es el día — de ahí
 * el arco 0:00→ahora, la «lógica que gira» de verdad.
 */
function RelojVivo() {
  // `rotacion` lleva los minutos DESENROLLADOS, para que a las 00:00 la
  // aguja no salte hacia atrás una vuelta entera (`desenrollar`).
  const [rotacion, setRotacion] = useState(() => minutosDeHoy(new Date()));
  const previo = useRef(rotacion);
  useEffect(() => {
    const id = setInterval(() => {
      const m = minutosDeHoy(new Date());
      setRotacion(desenrollar(previo.current, m));
      previo.current = m;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // La aguja usa la rotación desenrollada; el anillo del día, los
  // minutos del día de verdad (mod 1440 deshace el cruce de medianoche).
  const deg = degOf(rotacion);
  const dia = arcoDelDia(R_DIA, rotacion % 1440, SW_DIA);

  return (
    <g aria-hidden="true">
      {/* Anillo del día: la pista son las 24 h enteras, el relleno lo que
          lleva vividas. Los extremos van exactos (linecap butt) para que
          la punta sea de verdad la hora actual y el arranque las 0:00. */}
      <circle className="cd-dia-pista" cx={CX} cy={CY} r={R_DIA} fill="none" strokeWidth={SW_DIA} />
      {dia && (
        <path className="cd-dia" d={arcPath(R_DIA, dia.a, dia.b)} fill="none" strokeWidth={SW_DIA} />
      )}

      {/* Aguja: rotación real vía --needle-rot, interpolada por CSS */}
      <g className="cd-needle" style={{ ["--needle-rot" as string]: `${deg}deg` } as CSSProperties}>
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - 62}
          stroke="var(--text)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY - 62} r={3} fill="var(--text)" />
        <circle cx={CX} cy={CY} r={2.5} fill="var(--text-2)" />
      </g>
    </g>
  );
}

export default function DayOrbit({ tasks, today }: Props) {
  const pushToast = useStore((s) => s.pushToast);
  const desglose = useBreakdown();

  /** Nodos desplegados (Set: el anidado permite varios a la vez). */
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  /** Id de la tarea que se está desglosando ahora (feedback «⋯»). */
  const [desglosando, setDesglosando] = useState<string | null>(null);

  const nodos = useMemo(() => pintarReloj(tasks, abiertas), [tasks, abiertas]);

  // Carriles: primero las raíces ordenadas por hora, después el
  // desglose. packLanes es secuencial, así que los primeros N carriles
  // salen idénticos a los de «solo raíces»: desplegar NUNCA mueve un
  // arco de su carril.
  const laneDe = useMemo(() => {
    const conHora = nodos.filter(
      (n): n is NodoReloj & { tramo: [number, number] } => n.tramo !== null,
    );
    const raices = conHora.filter((n) => n.esRaiz).sort((a, b) => a.tramo[0] - b.tramo[0]);
    const hijos = conHora.filter((n) => !n.esRaiz).sort((a, b) => a.tramo[0] - b.tramo[0]);
    const enPack = [...raices, ...hijos];
    const carriles = packLanes(enPack.map((n) => n.tramo));
    return new Map(enPack.map((n, i) => [n.task.id, carriles[i]]));
  }, [nodos]);

  const completar = (t: Task) => void toggleWithUndo(t, toggleTask, pushToast);

  const alternar = (id: string, abrir: boolean) =>
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (abrir) s.add(id);
      else s.delete(id);
      return s;
    });

  /** El toque nunca completa: enruta (plegar/desplegar/desglosar/completar-hija). */
  const tocar = (n: NodoReloj) => {
    if (n.abierto) {
      alternar(n.task.id, false);
      return;
    }
    if (n.conHijos) {
      alternar(n.task.id, true);
      return;
    }
    if (n.esRaiz) {
      if (desglose.busy || desglosando) return; // ya hay un desglose en vuelo
      setDesglosando(n.task.id);
      void desglose.desglosar(n.task).finally(() => setDesglosando(null));
      return;
    }
    completar(n.task);
  };

  const ariaDe = (n: NodoReloj): string =>
    n.abierto
      ? `Plegar ${n.task.title}`
      : n.conHijos
        ? `Desplegar ${n.task.title}`
        : n.esRaiz
          ? `Desglosar ${n.task.title}`
          : `Completar ${n.task.title}`;

  // Medida real de cada etiqueta: la estimación por caracteres (fuente
  // proporcional) sobreestimaba el ancho y la casilla quedaba flotando
  // a 56 px del texto. La corrección corre en useLayoutEffect, antes del
  // primer pintado, y solo guarda lo que cambia (sin bucles).
  const textRefs = useRef(new Map<string, SVGTextElement | null>());
  const [medidos, setMedidos] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const nuevos: Record<string, number> = {};
    for (const [id, el] of textRefs.current) {
      if (!el) continue;
      const w = el.getComputedTextLength();
      if (w > 0 && Math.abs((medidos[id] ?? -1) - w) > 0.5) nuevos[id] = w;
    }
    if (Object.keys(nuevos).length > 0) setMedidos((p) => ({ ...p, ...nuevos }));
  });

  // La primera medida puede salir con la fuente de respaldo (ancha):
  // cuando la webfont termina de cargar, se re-mide (nuevo objeto ⇒
  // re-render ⇒ el efecto de arriba vuelve a calcular).
  useEffect(() => {
    document.fonts?.ready.then(() => setMedidos((p) => ({ ...p })));
  }, []);

  // Posición de cada etiqueta + desplazamiento vertical anti-solape
  // (greedy en dominio, en orden de pintado: madre primero, hijas después).
  const etiquetas: Etiqueta[] = nodos.map((n) => {
    const conCheck = n.esRaiz || n.conHijos;
    const truncMax = conCheck ? TRUNC : TRUNC_LARGO;
    const trunc =
      n.task.title.length > truncMax ? `${n.task.title.slice(0, truncMax - 1)}…` : n.task.title;
    const prefijo = n.esRaiz
      ? desglosando === n.task.id
        ? "⋯ "
        : n.conHijos
          ? n.abierto
            ? "▾ "
            : "▸ "
          : ""
      : "· ";
    const texto = `${prefijo}${trunc}`;
    const lp = polar(R_LABEL, n.ang);
    // Estimación de arranque solo hasta que llega la medida real; las
    // raíces suman «★nn» (fs 7) dentro del mismo <text>.
    const anchoEst = n.esRaiz ? texto.length * 3.8 + 13 : texto.length * 3.8;
    const anchoTexto = medidos[n.task.id] ?? anchoEst;
    return {
      x: lp.x,
      y: lp.y,
      lado: (Math.cos(((n.ang - 90) * Math.PI) / 180) >= 0 ? "D" : "I") as "D" | "I",
      texto,
      anchoTexto,
      ancho: anchoTexto + (conCheck ? 13 : 0), // la casilla ocupa su hueco
      conCheck,
      score: n.esRaiz ? priorityScore(n.task).score : null,
    };
  });
  const dyps = dyParaEtiquetas(etiquetas);

  const conHoraCount = nodos.filter((n) => n.tramo !== null).length;

  return (
    <>
      <svg
        viewBox="-35 -20 300 270"
        className="day-orbit absolute inset-0 h-full w-full"
        style={{ overflow: "visible" }}
        data-testid="day-orbit"
        role="group"
        aria-label={`Reloj de 24 horas del ${today} con ${conHoraCount} tareas con hora`}
      >
        {/* Anillo interior punteado: la textura del mockup */}
        <circle
          cx={CX}
          cy={CY}
          r={44}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="1 5"
          opacity={0.7}
        />

        {/* Anillo de marcas: 24 horas QUIETAS. Antes giraba en bucle de
            240 s y las horas se desalineaban de las tareas en minutos:
            si las tareas están ancladas a su hora, las marcas también. */}
        <g className="cd-ticks" stroke="var(--text-2)">
          {Array.from({ length: 24 }, (_, i) => {
            if (HORAS_LECTURA.includes(i as (typeof HORAS_LECTURA)[number])) return null;
            const p1 = polar(75, i * 15);
            const p2 = polar(80, i * 15);
            return (
              <line
                key={i}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                strokeWidth={0.8}
                strokeLinecap="round"
                opacity={0.35}
              />
            );
          })}
        </g>

        {/* Cifras de la esfera: sin ellas el disco no se puede leer. En
            00/06/12/18 la cifra sustituye a la marca mayor. */}
        <g className="cd-cifras" aria-hidden="true">
          {HORAS_LECTURA.map((h) => {
            const p = polar(R_NUM, degOf(h * 60));
            return (
              <text
                key={h}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={FS_NUM}
                letterSpacing={0.3}
              >
                {String(h).padStart(2, "0")}
              </text>
            );
          })}
        </g>

        {/* Círculo base */}
        <circle cx={CX} cy={CY} r={R_ARCO} fill="none" stroke="var(--border)" strokeWidth={1} />

        {/* Arco (o solo etiqueta) + toque por nodo */}
        {nodos.map((n, i) => {
          const et = etiquetas[i];
          const dy = dyps[i];
          const color = COLORES[n.colorIdx % COLORES.length];
          const sw = n.esRaiz ? SW_ARCO : SW_HIJO;
          const checkX = et.lado === "D" ? et.x + et.anchoTexto + 6 : et.x - et.anchoTexto - 6;
          const checkY = et.y + dy;
          const aria = ariaDe(n);
          let d: string | null = null;
          if (n.tramo) {
            const r = CARRILES[laneDe.get(n.task.id) ?? 0];
            const { a, b } = arcSpan(r, n.tramo[0], n.tramo[1], sw);
            d = arcPath(r, a, b);
          }
          return (
            <g key={n.task.id}>
              <g
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={aria}
                onClick={() => tocar(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    tocar(n);
                  }
                }}
              >
                <title>{aria}</title>
                {d && (
                  <path
                    className="cd-arc"
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeLinecap="round"
                    style={{ animationDelay: `${i % 3}s` }}
                  />
                )}
                {d && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={n.esRaiz ? HIT_ARCO : HIT_HIJO}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                  />
                )}
                <text
                  ref={(el) => {
                    if (el) textRefs.current.set(n.task.id, el);
                    else textRefs.current.delete(n.task.id);
                  }}
                  x={et.x}
                  y={et.y + dy}
                  textAnchor={et.lado === "D" ? "start" : "end"}
                  dominantBaseline="middle"
                  fontSize={8}
                  fill={n.esRaiz ? "var(--text)" : "var(--text-2)"}
                >
                  {et.texto}
                  {et.score !== null && (
                    <tspan fill="var(--text-2)" fontSize={7}> ★{et.score}</tspan>
                  )}
                </text>
              </g>

              {/* Casilla en el extremo de la etiqueta: el ÚNICO modo de completar
                  desde el reloj (el toque despliega o desglosa). Sibling del grupo
                  de toque: ningún click puede caer en los dos. */}
              {et.conCheck && (
                <g
                  className="cd-check-g cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={`Completar ${n.task.title}`}
                  onClick={() => completar(n.task)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      completar(n.task);
                    }
                  }}
                >
                  <title>{`Completar ${n.task.title}`}</title>
                  <rect
                    x={checkX - 7}
                    y={checkY - 7}
                    width={14}
                    height={14}
                    fill="transparent"
                    pointerEvents="all"
                  />
                  <rect
                    className="cd-check"
                    x={checkX - 3.5}
                    y={checkY - 3.5}
                    width={7}
                    height={7}
                    rx={2}
                    fill="none"
                    stroke="var(--text-2)"
                    strokeWidth={1.2}
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* El único trozo del disco que se mueve: aguja real + arco del
            día transcurrido. Va último para que la aguja quede por encima
            de los arcos, y en su propio componente para que el segundero
            no re-mida las etiquetas. */}
        <RelojVivo />
      </svg>

      {/* Desglose al tocar un arco sin subtareas: se propone, se revisa, se crea. */}
      {desglose.propuesto && (
        <BreakdownModal
          taskTitle={desglose.propuesto.task.title}
          initialSubtasks={desglose.propuesto.sugerencias}
          isOpen={desglose.propuesto !== null}
          onClose={desglose.cerrar}
          onConfirm={async (sel) => {
            const id = await desglose.confirmar(sel);
            // Tras crear, el reloj se despliega solo para ver el desglose.
            if (id) setAbiertas((prev) => new Set(prev).add(id));
          }}
        />
      )}
    </>
  );
}
