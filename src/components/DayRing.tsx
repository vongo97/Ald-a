import { useEffect, useState } from "react";
import type { Task } from "@/domain/types";

/**
 * Reloj de 24 h — pieza insignia del tema Cronodisco.
 *
 * Un instrumento vivo: el anillo de ticks gira (una vuelta = «un día»),
 * la aguja marca la hora real (DayRing la pasa por --needle-rot; la
 * transición la interpola cada minuto), los bloques de tiempo laten como
 * arcos (cd-arc) y las tareas con hora hacen blip de radar (cd-dot).
 *
 * Solo se muestra con [data-theme="cronodisco"] — la visibilidad la pone
 * ald-a-animations.css (.day-ring). El viewBox es 230×230 con centro en
 * 115,115: coincide con los transform-origin del CSS.
 */

interface Props {
  tasks: Task[];
  today: string;
}

const CX = 115;
const CY = 115;

const toMin = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
const degOf = (m: number) => (m / 1440) * 360;
const polar = (r: number, deg: number) => ({
  x: CX + r * Math.cos(((deg - 90) * Math.PI) / 180),
  y: CY + r * Math.sin(((deg - 90) * Math.PI) / 180),
});

function arcPath(r: number, m1: number, m2: number): string {
  const p1 = polar(r, degOf(m1));
  const p2 = polar(r, degOf(m2));
  const large = degOf(m2) - degOf(m1) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

export default function DayRing({ tasks, today }: Props) {
  // La hora se refresca cada 30 s; la aguja interpola con transición.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const mine = tasks.filter((t) => !t.deletedAt && t.dueDate === today);
  const blocks = mine.filter((t) => t.timeBlock && toMin(t.timeBlock.end) > toMin(t.timeBlock.start));
  const timed = mine.filter((t) => !t.timeBlock && t.dueTime).slice(0, 12);

  return (
    <div className="day-ring card mb-4 gap-4 p-4" data-testid="day-ring">
      <svg
        viewBox="0 0 230 230"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={`Reloj de 24 horas, ${hhmm}`}
      >
        {/* Anillo de ticks: una vuelta = un día */}
        <g className="cd-ticks" stroke="var(--text-2)">
          {Array.from({ length: 24 }, (_, i) => {
            const major = i % 6 === 0;
            const p1 = polar(major ? 94 : 101, i * 15);
            const p2 = polar(108, i * 15);
            return (
              <line
                key={i}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                strokeWidth={major ? 2.5 : 1.2}
                strokeLinecap="round"
                opacity={major ? 0.9 : 0.5}
              />
            );
          })}
        </g>

        {/* Arcos de los bloques de tiempo: laten en secuencia */}
        {blocks.map((t) => (
          <path
            key={t.id}
            className="cd-arc"
            d={arcPath(70, toMin(t.timeBlock!.start), toMin(t.timeBlock!.end))}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={7}
            strokeLinecap="round"
          />
        ))}

        {/* Blip de radar: tareas con hora pero sin bloque */}
        {timed.map((t, i) => {
          const p = polar(46, degOf(toMin(t.dueTime!)));
          return (
            <circle
              key={t.id}
              className="cd-dot"
              cx={p.x}
              cy={p.y}
              r={4}
              fill="var(--accent-2)"
              style={{ ["--d" as string]: i } as React.CSSProperties}
            />
          );
        })}

        {/* Aguja de la hora actual (rotación real vía --needle-rot) */}
        <g className="cd-needle" style={{ ["--needle-rot" as string]: `${(minutes / 1440) * 360}deg` } as React.CSSProperties}>
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - 85}
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY - 85} r={3.5} fill="var(--accent)" />
        </g>

        {/* Esfera central */}
        <text
          x={CX}
          y={118}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text)"
          fontSize={24}
          style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}
        >
          {hhmm}
        </text>
        <text
          x={CX}
          y={142}
          textAnchor="middle"
          fill="var(--text-2)"
          fontSize={9}
          letterSpacing={3}
        >
          HOY
        </text>
      </svg>

      <div className="min-w-0">
        <h2 className="font-display text-sm font-semibold text-primary">Reloj del día</h2>
        <p className="mt-1 text-xs text-muted">
          {blocks.length > 0
            ? `${blocks.length} bloque${blocks.length === 1 ? "" : "s"} de tiempo`
            : "Sin bloques hoy"}
          {timed.length > 0 && ` · ${timed.length} a hora fija`}
        </p>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Los arcos laten cuando empiezan; la aguja marca tu hora real.
        </p>
      </div>
    </div>
  );
}
