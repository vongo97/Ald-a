import { daysInMonth } from "./dateutils";

/**
 * Rejillas de mes para la vista Calendario.
 *
 * Convención: lunes primero (igual que la franja semanal de weekDots),
 * meses con índice estilo `Date` (0 = enero) y fechas ISO «YYYY-MM-DD».
 * Todo en horario local — mismo criterio que toISODate — para que ningún
 * huso desplace el día 1.
 */

/** Cabeceras de columna, lunes primero. */
export const WEEKDAY_HEADERS = ["L", "M", "X", "J", "V", "S", "D"] as const;

export interface MonthGrid {
  year: number;
  monthIndex: number;
  /** Filas de 7 (lunes → domingo); `null` = hueco de relleno. */
  weeks: (string | null)[][];
}

export function monthGrid(year: number, monthIndex: number): MonthGrid {
  const firstWeekday = new Date(year, monthIndex, 1).getDay(); // 0 = domingo
  const offset = (firstWeekday + 6) % 7; // lunes = 0
  const total = daysInMonth(year, monthIndex);

  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  const mm = String(monthIndex + 1).padStart(2, "0");
  for (let d = 1; d <= total; d++) {
    cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, monthIndex, weeks };
}

/** «Septiembre 2026» (Intl es-ES, sin la «de» y con mayúscula inicial). */
export function monthLabel(year: number, monthIndex: number): string {
  const raw = new Date(year, monthIndex, 1).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const clean = raw.replace(/\s+de\s+/, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
