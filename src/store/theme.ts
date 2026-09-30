/**
 * Aplicación del tema visual seleccionado.
 *
 * El tema activo se guarda como ID ("warm-tech", "editorial-calido", ...)
 * y se aplica via `[data-theme]` en <html>. Además se pone la clase
 * `.dark` o `.light` según el modo del tema, para que las variantes
 * `light:`/`dark:` de Tailwind sigan funcionando.
 */
import { readThemeId, getTheme, persistThemeId, type ThemeDef } from "./themes";

// Re-exportamos por compatibilidad con el código existente.
export type { ThemeDef as ThemePref };
export { THEME_KEY } from "./themes";

/** Lee el tema guardado. */
export function readThemePref(): string {
  return readThemeId();
}

/**
 * Aplica el tema al documento.
 * Recibe el ID del tema (ej: "warm-tech").
 */
export function applyTheme(themeId: string): void {
  if (typeof document === "undefined") return;

  const theme = getTheme(themeId);
  const el = document.documentElement;

  // Tema activo
  el.setAttribute("data-theme", theme.id);

  // Clase light/dark para las variantes de Tailwind. Refleja el tono
  // del CONTENIDO (las fichas), no el de la página: en gabinete el
  // contenido es pergamino claro sobre una pared oscura.
  const isDark = theme.mode === "dark";
  el.classList.toggle("light", !isDark);
  el.classList.toggle("dark", isDark);

  // `color-scheme` es lo del MARCO: barras de desplazamiento y
  // controles nativos. Los temas bitonos (gabinete) lo separan del
  // modo del contenido con `chrome`.
  el.style.colorScheme = theme.chrome ?? theme.mode;

  // Color de la barra del navegador / PWA
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    // Usa --bg computado para que coincida con el tema
    const bg = getComputedStyle(el).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
}

export function persistTheme(themeId: string): void {
  persistThemeId(themeId);
}
