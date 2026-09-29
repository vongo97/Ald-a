import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { toggleWithUndo } from "@/store/useStore";
import { toggleTask } from "@/store/actions";
import { priorityScore } from "@/domain/priority";
import type { Task } from "@/domain/types";

/**
 * Día en órbita — la pieza de Cronodisco.
 *
 * «La lista desaparece: tu día es un reloj astronómico.» Cada tarea con
 * hora es un arco sobre las 24 h del anillo, con su etiqueta fuera del
 * círculo; la aguja marca la hora real (—needle-rot, la interpola la
 * transición de cd-needle) y las marcas giran lenta (cd-ticks = un día).
 *
 * Tocar un arco (o su etiqueta) completa la tarea. Las tareas SIN hora
 * no caben en el reloj: se quedan en la lista «Sin hora» de TodayView,
 * así que nada se pierde.
 *
 * El viewBox (-92 -34 410 306) sigue teniendo el centro en 115,115:
 * coincide con los transform-origin del CSS (cd-ticks / cd-needle).
 * Los arcos se apilan en carriles (92 → 59 px) cuando los horarios se
 * solapan, y la etiqueta alterna radio para no pisarse.
 */

interface Props {
  tasks: Task[];
  today: string;
}

const CX = 115;
const CY = 115;
const R_ARCO = 92;
const CARRILES = [92, 81, 70, 59];
const R_LABEL = 104;
const TRUNC = 13;

/** Paleta de arcos: ámbar del tema, teal, oro y coral. */
const COLORES = ["var(--accent)", "#5fa8a0", "#d9b45a", "var(--accent-2)"];

const toMin = (hhmm: string) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);
const degOf = (m: number) => (m / 1440) * 360;
const polar = (r: number, deg: number) => ({
  x: CX + r * Math.cos(((deg - 90) * Math.PI) / 180),
  y: CY + r * Math.sin(((deg - 90) * Math.PI) / 180),
});

/** Tramo [inicio, fin] en minutos que ocupa la tarea en el reloj. */
function tramo(t: Task): [number, number] {
  if (t.timeBlock) {
    const a = toMin(t.timeBlock.start);
    let b = toMin(t.timeBlock.end);
    if (b <= a) b = Math.min(a + 30, 1439);
    return [a, b];
  }
  // Sin bloque: un tramo cortito centrado en su hora.
  const c = t.dueTime ? toMin(t.dueTime) : 12 * 60;
  return [Math.max(0, c - 15), Math.min(1439, c + 15)];
}

function arcoPath(r: number, m1: number, m2: number): string {
  const p1 = polar(r, degOf(m1));
  const p2 = polar(r, degOf(m2));
  const large = degOf(m2) - degOf(m1) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

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
  const arcos = [...tasks]
    .map((t) => ({ t, tramo: tramo(t) }))
    .sort((a, b) => a.tramo[0] - b.tramo[0]);
  const finCarril: number[] = [];
  const pintados = arcos.map(({ t, tramo: [m1, m2] }, i) => {
    let lane = finCarril.findIndex((fin) => fin <= m1);
    if (lane === -1) {
      lane = finCarril.length < CARRILES.length ? finCarril.length : CARRILES.length - 1;
      finCarril.push(m2);
    } else {
      finCarril[lane] = m2;
    }
    return { t, m1, m2, lane, color: COLORES[i % COLORES.length] };
  });

  const completar = (t: Task) => void toggleWithUndo(t, toggleTask, pushToast);

  return (
    <svg
      viewBox="-92 -34 410 306"
      className="day-orbit mx-auto mb-4 w-full max-w-lg"
      data-testid="day-orbit"
      role="img"
      aria-label={`Reloj de 24 horas con ${pintados.length} tareas con hora`}
    >
      {/* Anillo de marcas: una vuelta = un día */}
      <g className="cd-ticks" stroke="var(--text-2)">
        {Array.from({ length: 24 }, (_, i) => {
          const major = i % 6 === 0;
          const p1 = polar(major ? 93 : 97, i * 15);
          const p2 = polar(104, i * 15);
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              strokeWidth={major ? 2 : 1}
              strokeLinecap="round"
              opacity={major ? 0.9 : 0.45}
            />
          );
        })}
      </g>

      {/* Círculo base */}
      <circle cx={CX} cy={CY} r={R_ARCO} fill="none" stroke="var(--border)" strokeWidth={1} />

      {/* Arco + etiqueta por tarea (toca el grupo = completas) */}
      {pintados.map(({ t, m1, m2, lane, color }, i) => {
        const r = CARRILES[lane];
        const mid = (m1 + m2) / 2;
        const ang = degOf(mid);
        const rLabel = R_LABEL + (lane % 2) * 16;
        const lp = polar(rLabel, ang);
        const anchor = Math.cos(((ang - 90) * Math.PI) / 180) >= 0 ? "start" : "end";
        const score = priorityScore(t).score;
        const titulo =
          t.title.length > TRUNC ? `${t.title.slice(0, TRUNC - 1)}…` : t.title;
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
              d={arcoPath(r, m1, m2)}
              fill="none"
              stroke={color}
              strokeWidth={8}
              strokeLinecap="round"
              style={{ animationDelay: `${(i % 3)}s` }}
            />
            {/* Zona de toque generosa (el arco fino es difícil de pillar) */}
            <path
              d={arcoPath(r, m1, m2)}
              fill="none"
              stroke="transparent"
              strokeWidth={22}
              strokeLinecap="round"
              pointerEvents="stroke"
            />
            <text
              x={lp.x}
              y={lp.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--text)"
            >
              {titulo} <tspan fill="var(--text-2)" fontSize={9.5}>★{score}</tspan>
            </text>
          </g>
        );
      })}

      {/* Aguja de la hora actual (rotación real vía --needle-rot) */}
      <g
        className="cd-needle"
        style={{ ["--needle-rot" as string]: `${(minutes / 1440) * 360}deg` } as React.CSSProperties}
      >
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - 76}
          stroke="var(--text)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY - 76} r={3.5} fill="var(--text)" />
      </g>
      <circle cx={CX} cy={CY} r={2.5} fill="var(--text-2)" />

      {/* Letrero del anillo */}
      <text
        x={CX}
        y={226}
        textAnchor="middle"
        fill="var(--text-2)"
        fontSize={9}
        letterSpacing={3}
      >
        24 h
      </text>
    </svg>
  );
}
