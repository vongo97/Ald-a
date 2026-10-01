-- ============================================================================
-- Migracion 0009 - PK compuesta de `tombstones`: (kind, id)
--
-- QUE CORRIGE:
--   La migracion 0005 creo `tombstones` con `id text primary key`, pero el
--   cliente SIEMPRE ha tratado la clave como (kind, id):
--
--     * src/store/db.ts   -> stores({ tombstones: "[kind+id], updatedAt" })
--     * src/store/sync.ts -> upsert({ id, kind, ... })
--     * src/store/sync.ts -> delete().in("id", ids).eq("kind", kind)
--     * src/store/sync.ts -> comentario literal: <la clave de las tumbas es (kind, id)>
--
--   Con el PK en `id` a secas, una tarea y un proyecto con el MISMO id
--   comparten tumba: la segunda escritura pisa el `kind` de la primera y su
--   senal de borrado se pierde (el otro dispositivo vuelve a subir la fila).
--   Con UUID aleatorios es improbable, pero el esquema contradecia la logica
--   del cliente y hacia el upsert no idempotente por tipo. Alinearlo es barato
--   y elimina la clase entera de fallo.
--
-- QUE HACE:
--   Sustituye la PK `(id)` por la compuesta `(kind, id)`. No hay perdida de
--   datos: `id` ya era unico, asi que (kind, id) tambien lo es.
--
-- Es idempotente y localiza el nombre real del constraint (no asume `_pkey`).
-- DONDE: Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

begin;

do $$
declare
  pk_name text;
  pk_cols text;
begin
  -- Nombre y columnas de la PK actual, en orden de posicion.
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
    raise notice 'tombstones no tiene PK -> creando (kind, id).';
    alter table public.tombstones
      add constraint tombstones_pkey primary key (kind, id);
  elsif pk_cols = 'kind,id' then
    raise notice 'La PK ya es (kind, id); nada que hacer.';
  else
    raise notice 'PK actual (%) -> reemplazando por (kind, id).', pk_cols;
    execute format('alter table public.tombstones drop constraint %I', pk_name);
    alter table public.tombstones
      add constraint tombstones_pkey primary key (kind, id);
  end if;
end $$;

-- El indice suelto por `kind` ya lo cubre la PK compuesta (kind va primero).
drop index if exists public.tombstones_kind_idx;

-- Documentacion del esquema, al dia.
comment on table public.tombstones is
  'Senales de borrado para sync offline. PK = (kind, id): un mismo id puede ser tumba de tarea y de proyecto a la vez. Aislada por RLS con user_id = auth.uid().';

-- -- Verificacion ---------------------------------------------------------------
-- DESPUES del commit: si la verificacion falla, la PK nueva no debe revertirse.
commit;

select c.conname                          as restriccion,
       a.attname                          as columna,
       array_position(c.conkey, a.attnum) as posicion
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
 where c.conrelid = 'public.tombstones'::regclass
   and c.contype = 'p'
 order by posicion;

select count(*)                   as tumbas_totales,
       count(distinct (kind, id)) as claves_distintas
  from public.tombstones;

-- ============================================================================
-- ESPERADO:
--   * NOTICE: "PK actual (id) -> reemplazando por (kind, id)."
--     (o "ya es (kind, id)" si se re-ejecuta)
--   * El select de la PK devuelve 2 filas: (kind, 1) y (id, 2).
--   * tumbas_totales = claves_distintas (no se perdio ni duplico nada).
-- ============================================================================
