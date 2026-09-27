import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { restoreTask, restoreProject } from "@/store/actions";
import { emptyTrash } from "@/store/purge";
import { deletedForest, daysLeftInTrash, TRASH_RETENTION_DAYS } from "@/domain/trash";
import type { Project } from "@/domain/types";
import { useStore } from "@/store/useStore";

/**
 * Papelera: apartado propio (en el dock) para VER todo lo que borraste y
 * restaurarlo uno a uno. Sin «Restaurar todo»: cada fila decide por sí sola.
 *
 * La lista es jerárquica (raíz + sus subtareas indentadas) y se recalcula en
 * vivo: al restaurar, lo recuperado desaparece de aquí y vuelve a las vistas.
 *
 * Política de retención: lo que no restaures se elimina DEFINITIVAMENTE a
 * los 30 días (automático, tras cada sync) y también con «Vaciar» a mano.
 * Cada fila enseña «caduca en Xd» cuando le quedan 7 días o menos.
 */
export default function PapeleraView() {
  const pushToast = useStore((s) => s.pushToast);

  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const allProjects = useLiveQuery(() => db.projects.toArray(), [], []);
  const rows = useMemo(() => deletedForest(allTasks ?? []), [allTasks]);
  const deletedProjects = useMemo(
    () =>
      (allProjects ?? [])
        .filter((p) => !!p.deletedAt)
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [allProjects],
  );

  const total = rows.length + deletedProjects.length;

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

  const restoreProj = (id: string) => {
    void restoreProject(id).then((n) =>
      pushToast(n === 0 ? "Nada que restaurar" : "Proyecto restaurado (las tareas no vuelven a su proyecto)"),
    );
  };

  const empty = () => {
    if (
      !window.confirm(
        `¿Vaciar la papelera? Se eliminarán definitivamente ${total} ${
          total === 1 ? "elemento" : "elementos"
        } (también de la nube). No se puede deshacer.`,
      )
    )
      return;
    void emptyTrash().then(({ tasks, projects }) => {
      const n = tasks + projects;
      pushToast(
        n === 0
          ? "La papelera ya estaba vacía"
          : `🧹 ${n} ${n === 1 ? "elemento" : "elementos"} eliminado${n === 1 ? "" : "s"} definitivamente`,
      );
    });
  };

  /** Aviso «caduca en Xd»: solo cuando quedan 7 días o menos. */
  const expiryHint = (deletedAt?: string) => {
    const left = daysLeftInTrash(deletedAt);
    if (left === null || left > 7) return null;
    return (
      <span className="text-rose-400 light:text-rose-600">
        {" · "}
        ⏱ caduca {left === 0 ? "hoy" : `en ${left}d`}
      </span>
    );
  };

  if (!allTasks || !allProjects) return null;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">🗑️ Papelera</h1>
          <p className="text-xs text-muted">
            Todo lo que borraste, aquí a la vista. Restaura lo que quieras
            volver a ver; lo que no restaures se elimina definitivamente a los{" "}
            {TRASH_RETENTION_DAYS} días (también de la nube).
          </p>
        </div>
        {total > 0 && (
          <button
            type="button"
            className="btn-danger shrink-0 text-xs"
            onClick={empty}
          >
            🧹 Vaciar papelera
          </button>
        )}
      </header>

      {deletedProjects.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            📁 Proyectos ({deletedProjects.length})
          </p>
          <ul className="space-y-2">
            {deletedProjects.map((p: Project) => (
              <li key={p.id} className="card flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: p.color }}>
                    📁 {p.name}
                  </p>
                  <p className="text-xs text-muted">
                    borrado {(p.deletedAt ?? "").slice(0, 10)} · sus tareas
                    quedaron sin proyecto{expiryHint(p.deletedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary shrink-0 text-xs"
                  onClick={() => restoreProj(p.id)}
                >
                  ♻️ Restaurar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        ✅ Tareas ({rows.length})
      </p>

      {rows.length === 0 ? (
        <div className="card p-4 text-sm text-muted">
          🎉 Papelera de tareas vacía: no has borrado nada (o ya lo restauraste).
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
                    {expiryHint(task.deletedAt)}
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
