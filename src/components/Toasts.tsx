import { useEffect } from "react";
import { useStore } from "@/store/useStore";

function ToastItem({ id, message, undo }: { id: string; message: string; undo?: () => void }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 5000);
    return () => clearTimeout(t);
  }, [id, dismiss]);

  return (
    <div className="modal-card pointer-events-auto flex items-center gap-3 px-4 py-2.5 shadow-lg">
      <span className="text-sm text-primary">{message}</span>
      {undo && (
        <button
          type="button"
          onClick={() => {
            void undo();
            dismiss(id);
          }}
          className="text-sm font-semibold text-sky-400 light:text-sky-600 hover:text-sky-300 hover:light:text-sky-600"
        >
          Deshacer
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(id)}
        className="ml-auto text-muted hover:text-primary "
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  );
}

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    // Contenedor vivo: los avisos ("Tarea creada · Deshacer") son
    // transitorios y de nada sirven si el lector de pantalla no los anuncia.
    // atomic=false para que solo se anuncie el aviso nuevo, no todos.
    //
    // ARRIBA, y no abajo como estaba. Abajo ya vive el dock de navegación, que
    // es `fixed bottom-4` con 59px de alto; el aviso era `fixed bottom-5` con 62.
    // Veinte contra dieciseis: las dos cajas ocupaban la misma banda y se
    // solapaban 416 x 55 px. Medido en el navegador. El dock, que es `glass` al
    // 78 %, tapaba el aviso y se transparenta encima de el, así que el aviso se
    // leía como una caja gris apagada encima de la lista de tareas.
    //
    // No se ha resuelto calculando el alto del dock y subirlos lo justo: ese alto
    // depende de los iconos y de la fuente, así que el día que se añada uno, o
    // que la fuente cargue distinta, vuelven a cruzarse sin que nada se entere.
    // Arriba no hay nada con quien cruzarse. `top-14` son 56px, y la cabecera
    // `sticky` mide 49: el aviso queda debajo de ella y por delante en z-50.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed top-14 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  );
}
