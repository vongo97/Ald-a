-- ============================================================================
-- Migración 0007 — Aislamiento real de `tombstones` por usuario
--
-- EL AGUERO QUE CORRIGE:
--   La migración 0005 creó la política `tombstones_owner_all` así:
--
--       create policy tombstones_owner_all on public.tombstones
--         for all to authenticated using (true) with check (true);
--
--   El nombre promete "owner" pero el cuerpo dice `using (true)`: CUALQUIER
--   cuenta autenticada lee, inserta y borra las tumbas de TODOS los usuarios.
--   Peor: la tabla no tenía columna `user_id`, así que la política no podría
--   filtrar por dueño ni aunque hubiera querido. Era una brecha entre tenants
--   que las migraciones 0001-0003 ya habían cerrado en `tasks` y `projects`,
--   reintroducida dos migraciones después en una tabla nueva.
--
--   Impacto: leer los UUID de las tareas borradas de cualquier cuenta, y
--   borrarlas para que los demás dispositivos resuciten lo que el usuario
--   borró (o, al revés, hinder el borrado legítimo).
--
-- QUÉ HACE:
--   1. Añade `user_id` a `tombstones` (mismo patrón que 0001 en tasks/projects).
--   2. Adopta las tumbas huérfanas SOLO si hay exactamente una cuenta.
--   3. Deja UNA política estricta: `user_id = auth.uid()`.
--
-- Es idempotente. Si algo falla, la transacción se revierte entera.
--
-- DÓNDE: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================================

begin;

-- ── A) Añadir la columna ANTES de mirarla ──────────────────────────────────────
--
-- ORDEN IMPORTA: esta sentencia tiene que ir antes del `select` de abajo,
-- no dentro del bloque de reparación. Ese `select` consulta
-- `public.tombstones.user_id` para contar las tumbas huérfanas, y si se
-- ejecuta antes de que la columna exista, PostgreSQL aborta con
--     ERROR: 42703: column "user_id" does not exist
-- y la transacción se revierte entera: no se aplica NADA de la migración.
-- Es idempotente, así que repetirlo en el bloque DO de más abajo es inocuo.

alter table public.tombstones
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- ── B) Diagnóstico previo ─────────────────────────────────────────────────────

select 'RLS en tombstones'                                  as concepto,
       case when c.relrowsecurity then 'ACTIVADO' else 'NO activado' end as valor
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'tombstones'

union all
select 'tumbas totales',
       (select count(*) from public.tombstones)::text

union all
select 'tumbas sin dueño',
       (select count(*) from public.tombstones where user_id is null)::text

union all
select 'cuentas en auth.users',
       (select count(*) from auth.users)::text;

-- ── C) Reparación ─────────────────────────────────────────────────────────────

do $$
declare
  n_users   int;
  n_orphan  int;
  owner     uuid;
  stmts     text[];
  stmt      text;
begin
  -- 0) La columna es el prerrequisito de todo lo demás.
  alter table public.tombstones
    add column if not exists user_id uuid references auth.users (id) on delete cascade;

  select count(*) into n_users  from auth.users;
  select count(*) into n_orphan from public.tombstones where user_id is null;

  -- 1) Resolver huérfanos SOLO cuando es inequívoco: exactamente una cuenta.
  --    Con varias cuentas no se adivina a quién pertenece cada tumba, y una
  --    mala atribución haría visibles datos ajenos. Se aborta y lo hace el
  --    usuario a mano (nota al final del archivo).
  if n_orphan > 0 then
    if n_users = 1 then
      select id into owner from auth.users order by created_at asc limit 1;
      update public.tombstones set user_id = owner where user_id is null;
      raise notice 'Backfill OK: % tumbas huérfanas asignadas a la única cuenta.', n_orphan;
    else
      raise exception 'ABORTADO: hay % tumbas sin dueño y % cuentas en auth.users. No se puede atribuir sin adivinar. Asigna a mano (ver el final del archivo) y vuelve a ejecutar esta migración.', n_orphan, n_users;
    end if;
  end if;

  -- 2) Índice para que RLS filtre rápido (mismo motivo que en 0001).
  create index if not exists tombstones_user_id_idx on public.tombstones (user_id);

  -- 3) Borrar TODA política previa — incluida la permisiva `using (true)`.
  --    Las políticas se combinan con OR, así que dejar una antigua anulada
  --    seguiría dejando la tabla abierta: hay que eliminarla, no superponerla.
  select array_agg(format('drop policy %I on public.%I', policyname, tablename))
    into stmts
    from pg_policies
   where schemaname = 'public'
     and tablename = 'tombstones';

  if stmts is not null then
    foreach stmt in array stmts loop
      execute stmt;
    end loop;
    raise notice 'Eliminadas % políticas previas.', array_length(stmts, 1);
  end if;

  alter table public.tombstones enable row level security;

  -- 4) Una sola política estricta, en la forma de 0001/0003:
  --    el `(select auth.uid())` evita reevaluar auth.uid() por fila.
  create policy tombstones_owner_all
    on public.tombstones
    for all
    to authenticated
    using      (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

  raise notice 'RLS estricto ACTIVADO en tombstones. Cada usuario solo ve y toca sus propias tumbas.';
end $$;

-- ── D) Verificación ───────────────────────────────────────────────────────────

select tablename  as tabla,
       policyname as politica,
       roles      as rol,
       cmd        as operacion
  from pg_policies
 where schemaname = 'public'
   and tablename = 'tombstones';

select count(*)                                     as tumbas_totales,
       count(*) filter (where user_id is null)      as tumbas_sin_dueno,
       count(*) filter (where user_id is not null)  as tumbas_con_dueno
  from public.tombstones;

commit;

-- ============================================================================
-- ESPERADO AL TERMINAR:
--   * NOTICE: "Backfill OK: N tumbas huérfanas asignadas a la única cuenta."
--   * NOTICE: "Eliminadas 1 políticas previas."   (la de `using (true)`)
--   * NOTICE: "RLS estricto ACTIVADO en tombstones..."
--   * En la tabla de políticas: 1 fila → tombstones_owner_all, rol `authenticated`.
--   * tumbas_sin_dueno = 0.
--
-- COMPROBACIÓN DE VERDAD (la que de verdad importa):
--   Abre la app, borra una tarea, y desde el panel de Supabase confirma que
--   la tumba tiene user_id = <tu uuid> y NO null.
--
--     select id, kind, user_id, updated_at from public.tombstones order by updated_at desc;
--
-- SI SALTA EL EXCEPTION (varias cuentas + tumbas huérfanas):
--   Nada se ha modificado. Elige a mano a qué cuenta pertenece cada tumba y
--   vuelve a ejecutar este archivo:
--
--     select id, kind, user_id from public.tombstones where user_id is null;
--
--     update public.tombstones
--        set user_id = '<uuid-del-usuario>'
--      where user_id is null;
--
--   Para ver los uuid de las cuentas:
--     select id, email, created_at from auth.users order by created_at;
-- ============================================================================
