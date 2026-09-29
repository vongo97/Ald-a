import { useEffect, useState } from "react";
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
  degOf,
  polar,
  tramoDe,
  arcSpan,
  packLanes,
  dyParaEtiquetas,
} from "@/domain/orbit";
import type { Task } from "@/domain/types";

/**
 * Día en órbita — Cronodisco (v2, rediseñada contra el mockup).
 *
 * «La lista desaparece: tu día es un reloj astronómico.» Cada tarea con
 * hora es un arco sobre las 24 h del anillo; la etiqueta cae fuera del
 * círculo junto al punto medio del arco (la misma idea que el
 * `centroid()` de d3-shape/arc) y la aguja marca la hora real vía
 * `--needle-rot`.
 *
 * La geometría pura (tramos, compensación de puntas redondas, carriles,
 * antetítulo) vive en src/domain/orbit.ts con sus tests.
 *
 * TodayView lo monta dentro de un bloque `aspect-square` con el título
 * dentro, arriba a la izquierda; el svg va `absolute inset-0` con
 * `overflow: visible` para que las etiquetas nunca se recorten.
 *
 * Tocar un arco (o su etiqueta) completa la tarea. Las tareas sin hora
 * no caben en el reloj: se quedan en la lista «Sin hora».
 */

interface Props {
  tasks: Task[];
  today: string;
}

const R_LABEL = 84;
const TRUNC = 13;

/** Paleta de arcos: ámbar del tema, teal, oro y coral. */
const COLORES = ["var(--accent)", "#5fa8a0", "#d9b45a", "var(--accent-2)"];

export default function DayOrbit({ tasks, today }: Props) {
  // La hora se refresca cada 30 s; la aguja interpola con su transición.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const pushToast = useStore((s) => s.pushToast);

  const minutes = now.getHours() * 60 + now.getMinutes();

  // Los arcos, en orden de hora; carril para los horarios solapados.
  const ordenados = [...tasks]
    .map((t) => ({ t, tramo: tramoDe(t) }))
    .sort((a, b) => a.tramo[0] - b.tramo[0]);
  const carriles = packLanes(ordenados.map((o) => o.tramo));
  const pintados = ordenados.map(({ t, tramo: [m1, m2] }, i) => ({
    t,
    m1,
    m2,
    lane: carriles[i],
    color: COLORES[i % COLORES.length],
  }));

  const completar = (t: Task) => void toggleWithUndo(t, toggleTask, pushToast);

  // Posición de cada etiqueta + desplazamiento vertical anti-solape
  // (greedy en dominio, en orden de pintado).
  const etiquetas = pintados.map(({ t, m1, m2 }) => {
    const ang = degOf((m1 + m2) / 2);
    const cos = Math.cos(((ang - 90) * Math.PI) / 180);
    const lp = polar(R_LABEL, ang);
    const score = priorityScore(t).score;
    const titulo = t.title.length > TRUNC ? `${t.title.slice(0, TRUNC - 1)}…` : t.title;
    return {
      x: lp.x,
      y: lp.y,
      lado: (cos >= 0 ? "D" : "I") as "D" | "I",
      titulo,
      score,
      ancho: (titulo.length + 4) * 4.9, // «★nn» ≈ 4 caracteres más
    };
  });
  const dyps = dyParaEtiquetas(etiquetas);

  return (
    <svg
      viewBox="-35 -20 300 270"
      className="day-orbit absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
      data-testid="day-orbit"
      role="group"
      aria-label={`Reloj de 24 horas del ${today} con ${pintados.length} tareas con hora`}
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

      {/* Anillo de marcas: una vuelta = un día */}
      <g className="cd-ticks" stroke="var(--text-2)">
        {Array.from({ length: 24 }, (_, i) => {
          const major = i % 6 === 0;
          const p1 = polar(75, i * 15);
          const p2 = polar(major ? 84 : 80, i * 15);
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              strokeWidth={major ? 1.6 : 0.8}
              strokeLinecap="round"
              opacity={major ? 0.7 : 0.35}
            />
          );
        })}
      </g>

      {/* Círculo base */}
      <circle cx={CX} cy={CY} r={R_ARCO} fill="none" stroke="var(--border)" strokeWidth={1} />

      {/* Arco + etiqueta por tarea (toca el grupo = completas) */}
      {pintados.map(({ t, m1, m2, lane, color }, i) => {
        const r = CARRILES[lane];
        const { a, b } = arcSpan(r, m1, m2);
        const p1 = polar(r, a);
        const p2 = polar(r, b);
        const d = `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
        const et = etiquetas[i];
        return (
          <g
            key={t.id}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`Completar ${t.title}`}
            onClick={() => completar(t)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                completar(t);
              }
            }}
          >
            <path
              className="cd-arc"
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={SW_ARCO}
              strokeLinecap="round"
              style={{ animationDelay: `${i % 3}s` }}
            />
            {/* Zona de toque generosa (el arco fino es difícil de pillar) */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={24}
              strokeLinecap="round"
              pointerEvents="stroke"
            />
            <text
              x={et.x}
              y={et.y + dyps[i]}
              textAnchor={et.lado === "D" ? "start" : "end"}
              dominantBaseline="middle"
              fontSize={9}
              fill="var(--text)"
            >
              {et.titulo} <tspan fill="var(--text-2)" fontSize={8}>★{et.score}</tspan>
            </text>
          </g>
        );
      })}

      {/* Aguja de la hora actual (rotación real vía --needle-rot) */}
      <g
        className="cd-needle"
        style={{ ["--needle-rot" as string]: `${(minutes / 1440) * 360}deg` } as CSSProperties}
      >
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
      </g>
      <circle cx={CX} cy={CY} r={2.5} fill="var(--text-2)" />

      {/* Letrero del anillo */}
      <text x={CX} y={200} textAnchor="middle" fill="var(--text-2)" fontSize={8.5} letterSpacing={3}>
        24 h
      </text>
    </svg>
  );
}
