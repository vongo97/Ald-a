-- ============================================================================ 
-- Migración 0003 — Asignar dueño único + RLS estricto (script definitivo)
--
-- ESTADO PREVIO VERIFICADO (25/09/2026):
--   * 2 cuentas en auth.users: 5a64e8f6... (nunca inició sesión) y
--     8c697274-5c49-4473-ad38-7ad26d76bb7c (SÍ inició sesión → elegida).
--   * rls_tasks = true, pero había 4 políticas: las 2 permisivas antiguas dejan
--     leer a `anon` y las 2 mías de 0001 pedían user_id = auth.uid() con todas
--     las filas en NULL → anuladas. Como las políticas se combinan con OR, la
--     permisiva ganaba y la anon key seguía leyendo todo.
--   * 12 tasks y 4 projects sin user_id (el backfill de 0001/0002 se negó a
--     adivinar entre dos cuentas — correctamente).
--
-- QUÉ HACE ESTE SCRIPT:
--   1. Asigna todas las filas huérfanas a la cuenta elegida (falla si no existe).
--   2. Borra TODAS las políticas de tasks y projects (las viejas incluidas).
--   3. Deja UNA sola política estricta por tabla: user_id = auth.uid().
--   4. Verifica el resultado imprimiendo el estado final.
--
-- Es idempotente: puedes volver a ejecutarlo sin problema.
--
-- DÓNDE: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================================

begin;

-- ── A) Diagnóstico previo (una fila, fácil de leer) ─────────────────────────
select 'tareas sin dueno'                          as concepto,
       (select count(*) from public.tasks    where user_id is null)::text as valor
union all
select 'proyectos sin dueno',
       (select count(*) from public.projects where user_id is null)::text
union all
select 'politicas actuales',
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename in ('tasks','projects'))::text;

-- ── B) Arreglo completo ─────────────────────────────────────────────────────
do $$
declare
  -- ★ LA CUENTA ELEGIDA ★
  owner_id      uuid    := '8c697274-5c49-4473-ad38-7ad26d76bb7c';
  owner_email   text;
  n_tasks       int;
  n_projects    int;
  stmts         text[];
  stmt          text;
  owner_exists  boolean;
begin
  -- 0) La cuenta tiene que existir; si no, no tocamos NADA.
  select count(*) > 0, min(email)
    into owner_exists, owner_email
    from auth.users
   where id = owner_id;

  if not owner_exists then
    raise exception 'ABORTADO: no existe la cuenta % en auth.users. No se ha modificado nada.', owner_id;
  end if;

  -- 1) Entregar lo huérfano a la cuenta elegida.
  select count(*) into n_tasks    from public.tasks    where user_id is null;
  select count(*) into n_projects from public.projects where user_id is null;

  update public.tasks    set user_id = owner_id where user_id is null;
  update public.projects set user_id = owner_id where user_id is null;

  raise notice 'Dueño asignado (%): % tareas y % proyectos.', owner_email, n_tasks, n_projects;

  -- 2) Borrar TODAS las políticas, sin excepción: así desaparecen las dos
  --    permisivas antiguas que dejaban pasar a `anon` y las anuladas.
  select array_agg(format('drop policy %I on public.%I', policyname, tablename))
    into stmts
    from pg_policies
   where schemaname = 'public'
     and tablename in ('tasks', 'projects');

  if stmts is not null then
    foreach stmt in array stmts loop
      execute stmt;
    end loop;
    raise notice 'Eliminadas % politicas previas.', array_length(stmts, 1);
  end if;

  -- 3) Una sola política estricta por tabla.
  alter table public.tasks    enable row level security;
  alter table public.projects enable row level security;

  execute
    $p$create policy "tasks_owner_all" on public.tasks
         for all to authenticated
         using      (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))$p$;

  execute
    $p$create policy "projects_owner_all" on public.projects
         for all to authenticated
         using      (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))$p$;

  raise notice 'RLS estricto ACTIVADO. La anon key ya NO puede leer ni escribir tus tareas.';
end $$;

-- ── C) Verificación (esto se imprime como resultado) ────────────────────────
select tablename    as tabla,
       policyname   as politica,
       roles        as rol,
       cmd          as operacion
  from pg_policies
 where schemaname = 'public'
   and tablename in ('tasks', 'projects')
 order by tablename, policyname;

select (select count(*) from public.tasks    where user_id is null) as tareas_sin_dueno,
       (select count(*) from public.projects where user_id is null) as proyectos_sin_dueno,
       (select count(*) from public.tasks    where user_id = owner_id) as tareas_de_mi_cuenta;

commit;

-- ============================================================================
-- ESPERADO AL TERMINAR:
--   * NOTICE: "Dueño asignado (...): 12 tareas y 4 proyectos."
--   * NOTICE: "Eliminadas 4 politicas previas."
--   * NOTICE: "RLS estricto ACTIVADO..."
--   * En las tablas de resultados: 2 filas → tasks_owner_all y
--     projects_owner_all, ambas con rol `authenticated`.
--   * tareas_sin_dueno = 0, proyectos_sin_dueno = 0.
--
-- SI ALGO FALLA: la transacción se revierte entera y tu base queda EXACTAMENTE
-- igual que ahora. Nada queda a medias.
--
-- LIMPIEZA OPCIONAL — la cuenta sin usar puedes borrarla desde
-- Authentication → Users en el dashboard de Supabase:
--   5a64e8f6-5583-4363-bee6-5212edf665d3  (juanchoortiz123@gmail.com)
-- ============================================================================
