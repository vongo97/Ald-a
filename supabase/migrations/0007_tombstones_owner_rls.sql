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
  n_done    int;
  owner     uuid;
  stmts     text[];
  stmt      text;
begin
  -- 0) La columna es el prerrequisito de todo lo demás (idempotente: el punto A
  --    ya la creó, pero así la migración no depende de su propio orden).
  alter table public.tombstones
    add column if not exists user_id uuid references auth.users (id) on delete cascade;

  select count(*) into n_users  from auth.users;

  -- 1) ATRIBUCIÓN POR EVIDENCIA (no es una suposición).
  --
  --    El `id` de una tumba es el `id` de la fila que se borró. Y el borrado
  --    de tareas y proyectos es BLANDO (columna `deleted_at`, migración 0005):
  --    la fila sigue en la tabla con su `user_id` intacto. Una tumba no aparece
  --    en `tombstones` hasta que la tarea se borra, así que la fila original
  --    existe salvo que alguien la borrara a mano desde el panel.
  --
  --    O sea: el dueño de la tumba NO hay que adivinarlo, se lee de la fila.
  --    Por eso esto funciona aunque haya 3, 30 o 3000 cuentas.
  --
  --    `having count(distinct user_id) = 1` es la garantía de que no adivinamos:
  --    si un mismo `id` aparece en `tasks` y en `projects` con dos dueños
  --    distintos, ese id se deja huérfano a propósito y se reporta abajo, en vez
  --    de elegir uno al azar y hacer visibles datos de la cuenta equivocada.
  with src as (
    select id, min(user_id::text)::uuid as user_id
      from (
        -- El cast a text en la unión hace que esto funcione aunque `tasks.id`
        -- y `projects.id` no sean del mismo tipo: `tombstones.id` es text (0005).
        select id::text as id, user_id from public.tasks    where user_id is not null
        union all
        select id::text as id, user_id from public.projects where user_id is not null
      ) u
     group by id
    having count(distinct user_id) = 1
  ), attributed as (
    update public.tombstones t
       set user_id = s.user_id
      from src s
     where t.user_id is null
       and t.id = s.id
    returning t.id
  )
  select (select count(*) from attributed),
         (select count(*) from public.tombstones where user_id is null)
    into n_done, n_orphan;

  raise notice 'Backfill por evidencia: % tumbas con dueño deducido de tasks/projects.', n_done;

  -- 2) Lo que quede sin dueño SOLO se resuelve cuando es inequívoco: una cuenta.
  --    Con varias cuentas no se adivina a quién pertenece cada tumba, y una mala
  --    atribución haría visibles datos ajenos. Se aborta y lo hace el usuario a
  --    mano (instrucciones al final del archivo).
  if n_orphan > 0 then
    if n_users = 1 then
      select id into owner from auth.users order by created_at asc limit 1;
      update public.tombstones set user_id = owner where user_id is null;
      raise notice 'Backfill OK: % tumbas huérfanas asignadas a la única cuenta.', n_orphan;
    else
      raise exception 'ABORTADO: % tumbas sin dueño irreducibles (su fila en tasks/projects ya no existe, o el id es ambiguo) y % cuentas en auth.users. No se puede atribuar sin adivinar. La nota del final del archivo explica qué hacer con estas.', n_orphan, n_users;
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
--   * NOTICE: "Backfill por evidencia: N tumbas con dueño deducido de tasks/projects."
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
-- PARA VER DE QUIÉN ES CADA TUMBA, POR CUENTA:
--
--     select u.email, count(*) as tumbas
--       from public.tombstones t join auth.users u on u.id = t.user_id
--      group by u.email order by 2 desc;
--
-- SI SALTA EL EXCEPTION:
--   Significa que quedan tumbas huérfanas que NO se pudieron deducir de
--   tasks/projects, y hay más de una cuenta. Nada se ha modificado (todo va en
--   una transacción). Son dos casos, y se distinguen mirando `kind`:
--
--   a) kind = 'tasks' o 'projects' y NO sale ninguna fila al buscar ese id:
--      la fila original se borró a mano del panel. La señal de borrado ya no
--      tiene a quién avisar: se puede eliminar sin riesgo, porque sin la fila
--      ni la tumba el "borrado" ya ocurrió.
--
--        select id, kind from public.tombstones t
--         where user_id is null
--           and not exists (select 1 from public.tasks    where id::text = t.id)
--           and not exists (select 1 from public.projects where id::text = t.id);
--        -- revisarlos y, si son de una cuenta tuya:
--        delete from public.tombstones where user_id is null and id in (...);
--
--   b) El id aparece en tasks y en projects con dos `user_id` distintos:
--      eso solo puede pasar con UUID fabricationados a mano, no con los
--      `crypto.randomUUID()` del cliente. Se resuelve a mano:
--
--        select id, kind, user_id from public.tombstones where user_id is null;
--
--        update public.tombstones
--           set user_id = '<uuid-de-la-cuenta-correcta>'
--         where user_id is null and id = '<id>';
--
--   Para ver los uuid de las cuentas:
--     select id, email, created_at from auth.users order by created_at;
-- ============================================================================
