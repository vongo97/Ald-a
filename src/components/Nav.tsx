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

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-slate-700/60 px-3 py-2 text-sm">
      <span className="mr-2 font-bold tracking-tight text-sky-400">Mis Tareas</span>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => setView(it.id)}
          className={`rounded-lg px-2.5 py-1 transition-colors ${
            view === it.id
              ? "bg-sky-500/15 font-semibold text-sky-300"
              : "text-slate-300 hover:bg-slate-700/50"
          }`}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
