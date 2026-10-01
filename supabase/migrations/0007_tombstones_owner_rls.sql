-- ============================================================================
-- Migracion 0007 - Aislamiento real de `tombstones` por usuario
--
-- EL AGUJERO QUE CORRIGE:
--   La migracion 0005 creo la politica `tombstones_owner_all` asi:
--
--       create policy tombstones_owner_all on public.tombstones
--         for all to authenticated using (true) with check (true);
--
--   El nombre promete "owner" pero el cuerpo dice `using (true)`: CUALQUIER
--   cuenta autenticada lee, inserta y borra las tumbas de TODOS los usuarios.
--   Peor: la tabla no tenia columna `user_id`, asi que la politica no podria
--   filtrar por dueno ni aunque hubiera querido. Era una brecha entre tenants
--   que las migraciones 0001-0003 ya habian cerrado en `tasks` y `projects`,
--   reintroducida dos migraciones despues en una tabla nueva.
--
--   Impacto: leer los UUID de las tareas borradas de cualquier cuenta, y
--   borrarlas para que los demas dispositivos resuciten lo que el usuario
--   borro (o, al reves, hinder el borrado legitimo).
--
-- QUE HACE:
--   1. Anade `user_id` a `tombstones` (mismo patron que 0001 en tasks/projects).
--   2. Deduce el dueno de cada tumba huerfana leyendolo de la fila original.
--   3. Deja UNA politica estricta: `user_id = auth.uid()`.
--
-- Es idempotente. Si algo falla, la transaccion se revierte entera.
--
-- DONDE: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

begin;

-- -- A) Anadir la columna ANTES de mirarla --------------------------------------
--
-- ORDEN IMPORTA: esta sentencia tiene que ir antes del `select` de abajo, no
-- dentro del bloque de reparacion. Ese `select` consulta
-- `public.tombstones.user_id` para contar las tumbas huerfanas, y si se ejecuta
-- antes de que la columna exista, PostgreSQL aborta con
--     ERROR: 42703: column "user_id" does not exist
-- y la transaccion se revierte entera: no se aplica NADA de la migracion.
-- Es idempotente, asi que repetirlo en el bloque DO de mas abajo es inocuo.

alter table public.tombstones
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- -- B) Diagnostico previo -----------------------------------------------------

select 'RLS en tombstones'                                  as concepto,
       case when c.relrowsecurity then 'ACTIVADO' else 'NO activado' end as valor
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'tombstones'

union all
select 'tumbas totales',
       (select count(*) from public.tombstones)::text

union all
select 'tumbas sin dueno',
       (select count(*) from public.tombstones where user_id is null)::text

union all
select 'cuentas en auth.users',
       (select count(*) from auth.users)::text;

-- -- C) Reparacion -------------------------------------------------------------

do $$
declare
  n_orphan  int;
  n_done    int;
  stmts     text[];
  stmt      text;
begin
  -- 0) La columna es el prerrequisito de todo lo demas (idempotente: el punto A
  --    ya la creo, pero asi la migracion no depende de su propio orden).
  alter table public.tombstones
    add column if not exists user_id uuid references auth.users (id) on delete cascade;

  -- 1) ATRIBUCION POR EVIDENCIA (no es una suposicion).
  --
  --    El `id` de una tumba es el `id` de la fila que se borro. Y el borrado de
  --    tareas y proyectos es BLANDO (columna `deleted_at`, migracion 0005): la
  --    fila sigue en la tabla con su `user_id` intacto. Una tumba no se escribe
  --    hasta que la tarea se borra, asi que la fila original existe salvo que
  --    alguien la eliminara a mano desde el panel.
  --
  --    O sea: el dueno de la tumba NO hay que adivinarlo, se lee de la fila. Por
  --    eso esto funciona con 3 cuentas, o con 3000. La version anterior de esta
  --    migracion solo resolvia huerfanos si habia exactamente una cuenta, y con
  --    tres se negaba a hacer nada.
  --
  --    `having count(distinct user_id) = 1` es la garantia de que no adivinamos:
  --    si un mismo `id` aparece en `tasks` y en `projects` con dos duenos
  --    distintos, esa fila se deja huerfana a proposito, en vez de elegir uno al
  --    azar y hacer visibles datos de la cuenta equivocada.
  with src as (
    select id, min(user_id::text)::uuid as user_id
      from (
        -- El cast a text en la union hace que esto funcione aunque `tasks.id` y
        -- `projects.id` no sean del mismo tipo: `tombstones.id` es text (0005).
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

  raise notice 'Backfill por evidencia: % tumbas con dueno deducido de tasks/projects.', n_done;

  -- 2) Lo que quede sin dueno NO se aborta: se deja con user_id = NULL.
  --
  --    Antes la migracion abortaba si quedaban huerfanas y habia mas de una
  --    cuenta. Con la atribucion por evidencia ya no hace falta, y abortar
  --    bloquea la correccion de la fuga a cambio de nada.
  --
  --    Por que NULL es una respuesta valida y no un olvido: bajo la politica
  --    `user_id = (select auth.uid())` una fila con user_id NULL no la ve
  --    NINGUNA cuenta, tampoco la que quisiera reclamarla mas adelante. Queda
  --    inerte: no se puede leer, no se puede tocar desde otro dispositivo, y no
  --    filtra nada. Es el final seguro para una tumba cuyo dueno es
  --    indemostrable.
  --
  --    Y no se borran: una tumba sin fila en tasks/projects puede seguir
  --    teniendo un dispositivo que conserve la tarea en local (se creo y se
  --    borro estando offline). Borrar la tumba seria borrar el aviso de borrado.
  if n_orphan > 0 then
    raise warning 'Quedan % tumbas sin dueno: su fila en tasks/projects ya no existe, o el id es ambiguo.', n_orphan;
    raise warning 'Se dejan con user_id = NULL: invisibles para toda cuenta bajo RLS. No es un fallo.';
    raise warning 'Para verlas: select id, kind, updated_at from public.tombstones where user_id is null;';
  else
    raise notice 'Todas las tumbas tienen dueno. Ninguna queda huerfana.';
  end if;

  -- 3) Indice para que RLS filtre rapido (mismo motivo que en 0001).
  create index if not exists tombstones_user_id_idx on public.tombstones (user_id);

  -- 4) Borrar TODA politica previa - incluida la permisiva `using (true)`.
  --    Las politicas se combinan con OR, asi que dejar una antigua anulada
  --    seguiria dejando la tabla abierta: hay que eliminarla, no superponerla.
  select array_agg(format('drop policy %I on public.%I', policyname, tablename))
    into stmts
    from pg_policies
   where schemaname = 'public'
     and tablename = 'tombstones';

  if stmts is not null then
    foreach stmt in array stmts loop
      execute stmt;
    end loop;
    raise notice 'Eliminadas % politicas previas.', array_length(stmts, 1);
  end if;

  alter table public.tombstones enable row level security;

  -- 5) Una sola politica estricta, en la forma de 0001/0003:
  --    el `(select auth.uid())` evita reevaluar auth.uid() por fila.
  create policy tombstones_owner_all
    on public.tombstones
    for all
    to authenticated
    using      (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

  raise notice 'RLS estricto ACTIVADO en tombstones. Cada usuario solo ve y toca sus propias tumbas.';
end $$;

-- -- D) Verificacion ------------------------------------------------------------
--
-- DESPUES del commit a proposito. Leer el catalogo no cambia nada, asi que
-- la verificacion no necesita transaccion; y si un typo suyo falla, no debe
-- llevarse por delante la correccion que si funciono. En la 0010 una
-- verificacion mal escrita costo una ejecucion entera por eso mismo.

commit;

select tablename  as tabla,
       policyname as politica,
       roles      as rol,
       cmd        as operacion
  from pg_policies
 where schemaname = 'public'
   and tablename = 'tombstones';

select count(*)                                    as tumbas_totales,
       count(*) filter (where user_id is null)     as tumbas_sin_dueno,
       count(*) filter (where user_id is not null) as tumbas_con_dueno
  from public.tombstones;

-- ============================================================================
-- ESPERADO AL TERMINAR:
--   * NOTICE: "Backfill por evidencia: N tumbas con dueno deducido de
--     tasks/projects."      (N = 80 en la base de datos de ald-a)
--   * NOTICE: "Eliminadas 1 politicas previas."     (la de `using (true)`)
--   * NOTICE: "RLS estricto ACTIVADO en tombstones..."
--   * En la tabla de politicas: 1 fila -> tombstones_owner_all, rol `authenticated`.
--   * tumbas_con_dueno = 80, tumbas_sin_dueno = 7.
--   * En la base de datos de ald.a hay 7 tumbas cuya fila original no existe
--     (la tarea se creo y se borro estando offline, asi que nunca llego a
--     subirse). Se quedan con user_id NULL. Es el resultado correcto, no un fallo.
--
-- COMPROBACION DE VERDAD (la que de verdad importa):
--   Abre la app, borra una tarea, y desde el panel de Supabase confirma que
--   la tumba tiene user_id = <tu uuid> y NO null.
--
--     select id, kind, user_id, updated_at from public.tombstones order by updated_at desc;
--
-- PARA VER DE QUIEN ES CADA TUMBA, POR CUENTA:
--
--     select coalesce(u.email, '(sin dueno: inerte)') as cuenta, count(*) as tumbas
--       from public.tombstones t
--       left join auth.users u on u.id = t.user_id
--      group by 1 order by 2 desc;
--
-- SI ALGUNA VEZ QUEDAN TUMBAS SIN DUENO QUE SI TE INTERESAN:
--   Su id esta en la tabla pero su fila ya no esta en tasks/projects. Si sabes de
--   quien eran, se asignan a mano. Antes de hacerlo, comprueba que el id no
--   aparece en tasks y en projects con dos duenos distintos: en ese caso es
--   ambiguedad real y hay que decidir mirando los datos, no eligiendo al azar.
--
--     select t.id, t.kind, t.updated_at, ta.user_id as en_tasks, pr.user_id as en_projects
--       from public.tombstones t
--       left join public.tasks    ta on ta.id::text = t.id
--       left join public.projects pr on pr.id::text = t.id
--      where t.user_id is null;
--
--     update public.tombstones
--        set user_id = '<uuid-de-la-cuenta-correcta>'
--      where user_id is null and id = '<id>';
--
--   Para ver los uuid de las cuentas:
--     select id, email, created_at from auth.users order by created_at;
-- ============================================================================
