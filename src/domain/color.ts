/** Paleta de colores que puede tomar un proyecto nuevo. */
const PALETTE = [
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#fbbf24",
  "#c084fc",
  "#34d399",
  "#fb7185",
] as const;

/**
 * Color aleatorio para un proyecto recién creado.
 *
 * Existía una copia idéntica en `store/actions.ts` y en `views/ProjectsView.tsx`;
 * este es el único origen.
 */
export function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}
