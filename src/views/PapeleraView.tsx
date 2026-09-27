import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { restoreTask } from "@/store/actions";
import { deletedForest } from "@/domain/trash";
import { useStore } from "@/store/useStore";

/**
 * Papelera: apartado propio (en el dock) para VER todo lo que borraste y
 * restaurarlo uno a uno. Sin «Restaurar todo»: cada fila decide por sí sola.
 *
 * La lista es jerárquica (raíz + sus subtareas indentadas) y se recalcula en
 * vivo: al restaurar, lo recuperado desaparece de aquí y vuelve a las vistas.
 */
export default function PapeleraView() {
  const pushToast = useStore((s) => s.pushToast);

  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const rows = useMemo(() => deletedForest(allTasks ?? []), [allTasks]);

  const restore = (id: string) => {
    void restoreTask(id).then((n) =>
      pushToast(
        n === 0
          ? "Nada que restaurar"
          : n === 1
            ? "Tarea restaurada"
            : `${n} tareas restauradas`,
      ),
    );
  };

  if (!allTasks) return null;

  return (
    <section>
      <header className="mb-3">
        <h1 className="font-display text-2xl font-semibold">🗑️ Papelera</h1>
        <p className="text-xs text-muted">
          Todo lo que borraste, aquí a la vista. Restaura solo lo que quieras
          volver a ver: nada se elimina ni se recupera solo.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-4 text-sm text-muted">
          🎉 Papelera vacía: no has borrado nada (o ya lo restauraste).
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ task, depth }, i) => {
            // Cuántas filas de más abajo forman parte de esta rama (para que
            // restaurar la raíz se entienda de un vistazo).
            let below = 0;
            for (let j = i + 1; j < rows.length && rows[j].depth > depth; j += 1) below += 1;
            return (
              <li
                key={task.id}
                className="card flex items-center gap-3 px-3 py-2"
                style={{ marginLeft: depth * 14 }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-primary">{task.title}</p>
                  <p className="text-xs text-muted">
                    borrada {(task.deletedAt ?? "").slice(0, 10)}
                    {depth > 0 ? " · subtarea" : ""}
                    {below > 0 ? ` · +${below} en su rama` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary shrink-0 text-xs"
                  onClick={() => restore(task.id)}
                >
                  ♻️ Restaurar
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
