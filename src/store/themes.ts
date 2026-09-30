/**
 * Sistema de temas visuales de Ald-a.
 *
 * Cada tema define una identidad visual completa (colores, tipografía,
 * efectos) seleccionable desde Ajustes → Apariencia. Se aplica via
 * `[data-theme="id"]` en <html>, igual que el selector de kimik3.
 *
 * El "modo" (light/dark) lo determina el tema: no hay toggle separado.
 */

export type ThemeMode = "light" | "dark";

export interface ThemeDef {
  id: string;
  label: string;
  /**
   * Tono del CONTENIDO: el de las fichas donde se lee. Es lo que
   * decide la clase `.light`/`.dark`, y con ella las variantes
   * `light:text-amber-700` y compañía de Tailwind.
   *
   * No siempre coincide con el tono de la página: gabinete tiene la
   * pared verde de museo oscura y las fichas de pergamino claras, así
   * que su contenido es claro aunque el marco sea oscuro.
   */
  mode: ThemeMode;
  /**
   * Tono del MARCO (fondo de página), y solo del marco: decide
   * `color-scheme`, o sea las barras de desplazamiento y los
   * controles nativos del navegador. Por defecto, lo mismo que
   * `mode`. Only `gabinete` lo separa del modo del contenido.
   */
  chrome?: ThemeMode;
  /** Descripción corta para el selector. */
  blurb: string;
  /** Color representativo para el preview del selector. */
  swatch: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "warm-tech",
    label: "Warm Tech",
    mode: "dark",
    blurb: "Aurora terracota y dorado sobre negro cálido",
    swatch: "#1a1512",
  },
  {
    id: "editorial-calido",
    label: "Editorial",
    mode: "light",
    blurb: "Revista impresa: grano de papel y serif itálica",
    swatch: "#f7f1e6",
  },
  {
    id: "digital-craft",
    label: "Craft",
    mode: "light",
    blurb: "Hecho a mano: bordes rasgados y sellos",
    swatch: "#f4efe4",
  },
  {
    id: "cronodisco",
    label: "Cronodisco",
    mode: "dark",
    blurb: "Tu día en órbita: discos y acentos coral",
    swatch: "#141829",
  },
  {
    id: "gabinete",
    label: "Gabinete",
    // El contenido va sobre fichas de pergamino: las variantes `light:`
    // de Tailwind (texto ámbar 700, chips pastel…) son las suyas. Con
    // `mode: "dark"` salían ~15 combinaciones a 1,2:1 — ámbar claro
    // sobre crema— en rótulos, chips y avisos de tarea vencida.
    mode: "light",
    // Pero la pared es verde oscuro, así que las barras y los controles
    // nativos tienen que seguir siendo oscuros.
    chrome: "dark",
    blurb: "Museo: pergamino sobre verde botella, latón",
    swatch: "#22271f",
  },
  {
    id: "partitura",
    label: "Partitura",
    mode: "light",
    blurb: "El día se compone: pentagrama y notas",
    swatch: "#f8f4ea",
  },
  {
    id: "tinta-viva",
    label: "Tinta",
    mode: "light",
    blurb: "Cada tarea, una pincelada y un sello rojo",
    swatch: "#f5f2e9",
  },
];

export const THEME_KEY = "ald-a:style-theme";
export const DEFAULT_THEME = "warm-tech";

export function readThemeId(): string {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v;
  } catch {
    // Sin storage: tema por defecto.
  }
  return DEFAULT_THEME;
}

export function getTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function persistThemeId(id: string): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, id);
  } catch {
    // Modo privado: el tema dura esta sesión.
  }
}
