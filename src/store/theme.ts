/**
 * Preferencia de tema: "light" | "dark" | "system".
 *
 * La aplicación real de la clase `.dark` al <html> ocurre en DOS sitios:
 *   1. Un script inline en `index.html`, ANTES del primer paint, para que no
 *      haya parpadeo (la app arranca oscura y no debe "destello" en claro).
 *   2. `App.tsx`, para reaccionar a cambios posteriores y al del sistema.
 *
 * El `@custom-variant dark (&:where(.dark, .dark *))` de `src/index.css`
 * hace el resto: todo lo marcado con `dark:` solo aplica bajo `.dark`.
 */
export type ThemePref = "light" | "dark" | "system";

export const THEME_KEY = "ald-a:theme";

function systemIsDark(): boolean {
  // Sin matchMedia (tests, entornos raros) asumimos oscuro: es el aspecto actual.
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return !window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Lee la preferencia guardada. Cualquier valor desconocido cae en "system". */
export function readThemePref(): ThemePref {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Sin storage accesible seguimos con la preferencia por defecto.
  }
  // Oscuro por defecto: es como ha venido viéndose la app, así abrir la
  // versión con tema claro no cambia nada de golpe. "Sistema" y "Claro"
  // son opt-in desde Ajustes → Apariencia.
  return "dark";
}

/**
 * Aplica la preferencia al documento y devuelve si acabamos en oscuro.
 *
 * Además de la clase `.dark`, sincroniza dos cosas que Tailwind no toca:
 * `color-scheme` (scrollbars, controles nativos, autofill) y el
 * `meta[name=theme-color]` de la barra del navegador / PWA.
 */
export function applyTheme(pref: ThemePref): boolean {
  if (typeof document === "undefined") return false;

  const dark = pref === "system" ? systemIsDark() : pref === "dark";
  const el = document.documentElement;

  // `.light` es lo que dispara la variante `light:` de index.css; `.dark` y
  // `color-scheme` solo sirven para que la UI nativa del navegador siga el
  // mismo tema.
  el.classList.toggle("light", !dark);
  el.classList.toggle("dark", dark);
  el.style.colorScheme = dark ? "dark" : "light";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0f172a" : "#f8fafc");

  return dark;
}

export function persistTheme(pref: ThemePref): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, pref);
  } catch {
    // Modo privado sin storage: la preferencia dura esta sesión.
  }
}
