import { monthGrid, monthLabel, WEEKDAY_HEADERS } from "@/domain/calendar";

/** Estado de un día para pintarlo en la rejilla. */
export interface DayGlance {
  total: number;
  done: number;
  /** 0–100. */
  pct: number;
  fulfilled: boolean;
}

interface Props {
  year: number;
  monthIndex: number;
  todayISO: string;
  selectedISO: string;
  /** Estado por fecha; las casillas del mes consultan aquí. */
  stats: Map<string, DayGlance>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelect: (date: string) => void;
}

/**
 * Rejilla de mes estilo «mapa de calor»: el fondo de cada día es su % de
 * cumplimiento con el acento del tema; los días cumplidos van a tope con
 * un ✓, hoy y la selección llevan anillo. Lunes primero, como la franja
 * semanal del perfil y de la tarjeta.
 */
export default function MonthCalendar({
  year,
  monthIndex,
  todayISO,
  selectedISO,
  stats,
  onPrev,
  onNext,
  onToday,
  onSelect,
}: Props) {
  const grid = monthGrid(year, monthIndex);
  const label = monthLabel(year, monthIndex);
  const isCurrentMonth = todayISO.slice(0, 7) === `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  // Días cumplidos del mes, de paso para el subtítulo.
  const fulfilledCount = grid.weeks
    .flat()
    .reduce((n, d) => n + (d && stats.get(d)?.fulfilled ? 1 : 0), 0);

  return (
    <div className="card card-panel p-3" data-testid="month-calendar">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted transition-colors hover:bg-surface-hover hover:text-primary"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <div className="px-1">
            <h2 className="font-display text-base font-semibold leading-tight text-primary sm:text-lg">
              {label}
            </h2>
            {fulfilledCount > 0 && (
              <p className="text-[11px] leading-tight text-muted">
                {fulfilledCount} día{fulfilledCount === 1 ? "" : "s"} cumplido
                {fulfilledCount === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted transition-colors hover:bg-surface-hover hover:text-primary"
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>

        {!isCurrentMonth && (
          <button type="button" onClick={onToday} className="btn-ghost px-2 py-1 text-xs">
            Hoy
          </button>
        )}
      </div>

      <div
        className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium tracking-wider text-muted"
        aria-hidden
      >
        {WEEKDAY_HEADERS.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.weeks.flatMap((week, wi) =>
          week.map((date, di) => {
            if (!date) {
              return (
                <span
                  key={`relleno-${wi}-${di}`}
                  className="h-12 sm:h-14"
                  aria-hidden="true"
                />
              );
            }

            const st = stats.get(date);
            const pct = st?.pct ?? 0;
            // Un día con tareas pero a cero se ve «con trabajo» (10 % de
            // acento), no idéntico a un día vacío.
            const heat = st && st.total > 0 ? Math.max(pct, 10) : 0;
            const isToday = date === todayISO;
            const isSelected = date === selectedISO;
            const future = date > todayISO;

            const dayNum = Number(date.slice(8, 10));
            const cls = [
              "relative flex h-12 flex-col items-center justify-center rounded-xl text-sm transition-all sm:h-14",
              future ? "opacity-60" : "",
              st?.total === 0 ? "text-muted" : "text-primary",
              isSelected
                ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg)]"
                : isToday
                  ? "ring-1 ring-[var(--text-2)]"
                  : "",
              "hover:scale-105 focus-visible:scale-105",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={date}
                type="button"
                className={cls}
                style={{
                  backgroundColor:
                    heat > 0
                      ? `color-mix(in srgb, var(--accent) ${heat}%, transparent)`
                      : "var(--surface)",
                  color: pct >= 100 ? "var(--bg)" : undefined,
                }}
                onClick={() => onSelect(date)}
                aria-pressed={isSelected}
                aria-label={`${date}${st && st.total > 0 ? `: ${st.done} de ${st.total} tareas` : ": sin tareas"}`}
                data-testid={`dia-${date}`}
              >
                <span className={st?.fulfilled ? "font-semibold" : ""}>{dayNum}</span>
                {st?.fulfilled && (
                  <span
                    className="badge seal absolute bottom-0.5 right-1 text-[9px] leading-none"
                    aria-hidden
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
