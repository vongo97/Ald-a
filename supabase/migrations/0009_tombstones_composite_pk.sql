-- ============================================================================
-- Migración 0009 — PK compuesta de `tombstones`: (kind, id)
--
-- QUÉ CORRIGE:
--   La migración 0005 creó `tombstones` con `id text primary key`, pero el
--   cliente SIEMPRE ha tratado la clave como (kind, id):
--
--     * src/store/db.ts   → stores({ tombstones: "[kind+id], updatedAt" })
--     * src/store/sync.ts → upsert({ id, kind, ... })
--     * src/store/sync.ts → delete().in("id", ids).eq("kind", kind)
--     * src/store/sync.ts → comentario literal: «la clave de las tumbas es (kind, id)»
--
--   Con el PK en `id` a secas, una tarea y un proyecto con el MISMO id
--   comparten tumba: la segunda escritura pisa el `kind` de la primera y su
--   señal de borrado se pierde (el otro dispositivo vuelve a subir la fila).
--   Con UUID aleatorios es improbable, pero el esquema contradecía la lógica
--   del cliente y hacía el upsert no idempotente por tipo. Alinearlo es barato
--   y elimina la clase entera de fallo.
--
-- QUÉ HACE:
--   Sustituye la PK `(id)` por la compuesta `(kind, id)`. No hay pérdida de
--   datos: `id` ya era único, así que (kind, id) también lo es.
--
-- Es idempotente y localiza el nombre real del constraint (no asume `_pkey`).
-- DÓNDE: Supabase → SQL Editor → New query → Run
-- ============================================================================

begin;

do $$
declare
  pk_name text;
  pk_cols text;
begin
  -- Nombre y columnas de la PK actual, en orden de posición.
  select c.conname,
         string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
    into pk_name, pk_cols
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.tombstones'::regclass
     and c.contype = 'p'
   group by c.conname;

  if pk_cols is null then
    raise notice 'tombstones no tiene PK → creando (kind, id).';
    alter table public.tombstones
      add constraint tombstones_pkey primary key (kind, id);
  elsif pk_cols = 'kind,id' then
    raise notice 'La PK ya es (kind, id); nada que hacer.';
  else
    raise notice 'PK actual (%) → reemplazando por (kind, id).', pk_cols;
    execute format('alter table public.tombstones drop constraint %I', pk_name);
    alter table public.tombstones
      add constraint tombstones_pkey primary key (kind, id);
  end if;
end $$;

-- El índice suelto por `kind` ya lo cubre la PK compuesta (kind va primero).
drop index if exists public.tombstones_kind_idx;

-- Documentación del esquema, al día.
comment on table public.tombstones is
  'Señales de borrado para sync offline. PK = (kind, id): un mismo id puede ser tumba de tarea y de proyecto a la vez. Aislada por RLS con user_id = auth.uid().';

-- ── Verificación ─────────────────────────────────────────────────────────────
select c.conname                          as restriccion,
       a.attname                          as columna,
       array_position(c.conkey, a.attnum) as posicion
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
 where c.conrelid = 'public.tombstones'::regclass
   and c.contype = 'p'
 order by posicion;

select count(*)                                as tumbas_totales,
       count(distinct (kind, id))              as claves_distintas
  from public.tombstones;

commit;

-- ============================================================================
-- ESPERADO:
--   * NOTICE: "PK actual (id) → reemplazando por (kind, id)."
--     (o "ya es (kind, id)" si se re-ejecuta)
--   * El select de la PK devuelve 2 filas: (kind, 1) y (id, 2).
--   * tumbas_totales = claves_distintas (no se perdió ni duplicó nada).
-- ============================================================================
