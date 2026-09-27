import { useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";
import SyncIndicator from "@/components/SyncIndicator";
import type { ViewId } from "@/domain/types";

const ITEMS: { id: ViewId; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "dia", label: "Día" },
  { id: "bandeja", label: "Bandeja" },
  { id: "proyectos", label: "Proyectos" },
  { id: "etiquetas", label: "Etiquetas" },
  { id: "revision", label: "Revisión" },
  { id: "buscar", label: "Buscar" },
  { id: "ajustes", label: "Ajustes" },
];

export default function Nav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Una sola fila con scroll horizontal: si la vista cambia por código
  // (atajo "t", enlace, etc.) la pestaña activa puede quedarse fuera de la
  // zona visible. Se trae sola a la vista; block:"nearest" evita que además
  // mueva la página, porque la nav siempre está arriba.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view]);

  return (
    <nav className="glass no-scrollbar sticky top-0 z-30 flex items-center gap-1 overflow-x-auto px-3 py-1 text-sm">
      {/* shrink-0 en todo: sin él flex estruja los items en vez de dejarlos
          desbordar y scrollear, que era justo el bug original (8 items
          partidos en 2 filas a 390px). La marca se oculta en móvil para
          dar sitio a la navegación. */}
      <span className="font-display mr-2 hidden shrink-0 text-base font-semibold tracking-tight text-[var(--accent)] sm:block">
        Mis Tareas
      </span>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          ref={view === it.id ? activeRef : undefined}
          type="button"
          onClick={() => setView(it.id)}
          // La vista activa se indica por color; sin esto un lector de
          // pantalla no puede saber en qué sección estás.
          aria-current={view === it.id ? "page" : undefined}
          // py-3 → 44px de alto, el objetivo táctil mínimo recomendado por
          // Apple/Material (antes 28px). El py-2 de la nav baja a py-1 para
          // que la barra no engorde: sigue midiendo 53px, muy por debajo de
          // los 77px de las 2 filas originales.
          className={`shrink-0 rounded-xl px-2.5 py-3 transition-all duration-150 ${
            view === it.id
              ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
              : "text-[var(--fg)] opacity-70 hover:opacity-100 hover:bg-[var(--card-hover)]"
          }`}
        >
          {it.label}
        </button>
      ))}
      <SyncIndicator />
    </nav>
  );
}
