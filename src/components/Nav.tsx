import { useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";
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
    <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-slate-700/60 light:border-slate-200 px-3 py-2 text-sm">
      {/* shrink-0 en todo: sin él flex estruja los items en vez de dejarlos
          desbordar y scrollear, que era justo el bug original (8 items
          partidos en 2 filas a 390px). La marca se oculta en móvil para
          dar sitio a la navegación. */}
      <span className="mr-2 hidden shrink-0 font-bold tracking-tight text-sky-400 light:text-sky-600 sm:block">
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
          className={`shrink-0 rounded-lg px-2.5 py-1 transition-colors ${
            view === it.id
              ? "bg-sky-500/15 light:bg-sky-50 font-semibold text-sky-300 light:text-sky-600"
              : "text-slate-300 light:text-slate-700 hover:bg-slate-700/50 hover:light:bg-slate-100"
          }`}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
