import { useEffect, useRef } from "react";

/**
 * Comportamiento accesible mínimo de un diálogo modal.
 *
 * - **Escape cierra** desde cualquier parte, no solo desde dentro del input.
 *   Antes cada modal lo resolvía a su manera: el de captura lo tenía en el
 *   `onKeyDown` del input (si movías el foco dejaba de funcionar) y los otros
 *   dos no lo tenían en absoluto.
 * - **Foco atrapado**: Tab/Shift+Tab no salen del diálogo. Necesario para que
 *   `aria-modal="true"` sea cierto — si el foco se puede ir detrás del
 *   velo, el atributo miente sobre lo que experimenta quien navega con
 *   teclado.
 * - **Foco restaurado** al elemento que lo abrió al cerrar.
 *
 * Uso:
 *   const dialogRef = useDialogA11y(open, close);
 *   ...
 *   <div ref={dialogRef} role="dialog" aria-modal="true" ...>
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogA11y<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  // Quién tenía el foco antes de abrir: lo devolvemos al cerrar, o quien
  // navega con teclado se queda perdido en el principio del documento.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = (document.activeElement as HTMLElement | null) ?? null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = ref.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // visible: offsetParent es null con position:fixed, así que aceptamos
        // también al activo por si está justo ahí.
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = active !== null && root.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase: el modal de captura cierra Escape en su input y este
    // listener no debe competir con él ni con atajos globales.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const el = opener.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open, onClose]);

  return ref;
}
