import { useStore } from "@/store/useStore";
import SyncIndicator from "@/components/SyncIndicator";
import type { ViewId } from "@/domain/types";

/**
 * Dock flotante estilo macOS (inspiración Magic UI).
 *
 * Sustituye a la nav horizontal: iconos con magnificación al pasar el cursor
 * (el ítem crece y sus vecinos crecen un poco menos, como el dock real),
 * fondo frosted-glass y el botón "+" integrado como acción central.
 *
 * El efecto de magnificación es CSS puro (`:hover` + `:has()` para vecinos),
 * sin JavaScript por frame — más barato que replicarlo con JS.
 */
const ITEMS: { id: ViewId; icon: string; label: string }[] = [
  { id: "hoy", icon: "☀️", label: "Hoy" },
  { id: "dia", icon: "📅", label: "Día" },
  { id: "bandeja", icon: "📥", label: "Bandeja" },
  { id: "proyectos", icon: "📁", label: "Proyectos" },
  { id: "etiquetas", icon: "🏷️", label: "Etiquetas" },
  { id: "revision", icon: "📊", label: "Revisión" },
  { id: "buscar", icon: "🔍", label: "Buscar" },
  { id: "ajustes", icon: "⚙️", label: "Ajustes" },
];

export default function Dock() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openCapture = useStore((s) => s.openCapture);

  return (
    <>
      {/* Indicador de sync: se muestra encima del dock */}
      <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 sm:bottom-20">
        <SyncIndicator />
      </div>

      <nav
        className="dock glass fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-end gap-1 rounded-2xl px-2 py-1.5 sm:gap-2 sm:px-3"
        aria-label="Navegación principal"
      >
        {ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setView(it.id)}
            className={`dock-item group relative flex flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 transition-all duration-200 ease-out sm:px-2 ${
              view === it.id
                ? "text-[var(--accent)]"
                : "text-[var(--fg)] opacity-60 hover:opacity-100"
            }`}
            aria-current={view === it.id ? "page" : undefined}
            aria-label={it.label}
            title={it.label}
          >
            <span className="text-lg leading-none sm:text-xl" aria-hidden>
              {it.icon}
            </span>
            {/* Etiqueta: solo visible en desktop (sm+) o al hacer hover */}
            <span className="hidden text-[10px] font-medium leading-tight sm:block">
              {it.label}
            </span>
            {/* Punto indicador de vista activa */}
            {view === it.id && (
              <span
                className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent)]"
                aria-hidden
              />
            )}
          </button>
        ))}

        {/* Botón "+" integrado: acción central, más prominente */}
        <button
          type="button"
          onClick={() => openCapture()}
          className="dock-item flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-white shadow-lg shadow-[var(--accent)]/30 transition-all duration-200 sm:h-11 sm:w-11"
          aria-label="Nueva tarea"
        >
          +
        </button>
      </nav>
    </>
  );
}
