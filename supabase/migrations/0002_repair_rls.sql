-- ============================================================================
-- Migración 0002 — Reparación de 0001 (RLS efectivo + dueño de las filas)
--
-- QUÉ FALLÓ EN 0001 (verificado con la anon key después de ejecutarla):
--   * Las columnas user_id / updated_at SÍ se crearon.
--   * Pero user_id quedó en NULL en todas las filas → el backfill no corrió
--     (o había 0 cuentas, o más de una).
--   * Y la anon key SIGUE pudiendo leer tasks y projects → RLS no está
--     teniendo efecto (falta activarlo o queda una política permisiva vieja).
--
-- POR QUÉ NO SE ACTIVA RLS A CIEGAS:
--   Si la política es  user_id = auth.uid()  y todas las filas tienen
--   user_id = NULL, entonces NULL = auth.uid() es falso → VERÍAS CERO TAREAS
--   tras iniciar sesión y los upserts fallarían el WITH CHECK. Es decir:
--   "activar RLS" sin resolver los huérfanos haría que tus datos desaparecieran.
--   Por eso este script primero asigna dueño (solo si es inequívoco) y solo
--   después activa la protección.
--
-- DÓNDE EJECUTARLO:
--   Supabase Dashboard → SQL Editor → New query → pega este archivo → Run
--
-- QUÉ IMPRIME:
--   1. El diagnóstico (estado de RLS, políticas, nº de cuentas, huérfanos).
--   2. Un NOTICE con lo que hizo, o un WARNING si no pudo terminar.
-- ============================================================================

begin;

-- ── A) Diagnóstico (esto se imprime como resultado) ─────────────────────────

select 'RLS en tasks'     as elemento,
       case when c.relrowsecurity then 'ACTIVADO' else 'NO activado' end as estado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'tasks'
union all
select 'RLS en projects',
       case when c.relrowsecurity then 'ACTIVADO' else 'NO activado' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'projects';

select tablename                                   as tabla,
       policyname                                  as politica,
       roles                                       as rol,
       cmd                                         as operacion
  from pg_policies
 where schemaname = 'public'
   and tablename in ('tasks', 'projects')
 order by tablename, policyname;

-- ¿Quién existe como cuenta? Si sale 0 filas hay que crear la cuenta en la
-- app antes de que este script pueda asignar dueño y activar RLS.
select id, email, created_at, confirmation_sent_at, banned_at
  from auth.users
 order by created_at;

select (select count(*) from public.tasks    where user_id is null)::int as tareas_sin_dueno,
       (select count(*) from public.projects where user_id is null)::int as proyectos_sin_dueno;

-- ── B) Asignar dueño + activar RLS solo si es seguro ────────────────────────

do $$
declare
  n_users    int;
  n_tasks    int;
  n_projects int;
  owner      uuid;
  stmts      text[];
  stmt       text;
begin
  select count(*) into n_users    from auth.users;
  select count(*) into n_tasks    from public.tasks    where user_id is null;
  select count(*) into n_projects from public.projects where user_id is null;

  -- 1) Resolver huérfanos SOLO cuando hay exactamente una cuenta: no hay
  --    margen para equivocarse de a quién pertenecen.
  if (n_tasks + n_projects) > 0 then
    if n_users = 1 then
      select id into owner from auth.users order by created_at asc limit 1;
      update public.tasks    set user_id = owner where user_id is null;
      update public.projects set user_id = owner where user_id is null;
      raise notice 'Backfill OK: % tareas y % proyectos asignados a la unica cuenta.', n_tasks, n_projects;
      n_tasks := 0;
      n_projects := 0;
    else
      raise warning 'HUERFANOS SIN ASIGNAR: % tareas, % proyectos y % cuentas en auth.users. RLS NO se activara para que no pierdas la vista de tus datos. Solucion: crea/elimina cuentas hasta dejar exactamente una, o asigna a mano (ver comentario final), y vuelve a ejecutar este script.',
        n_tasks, n_projects, n_users;
    end if;
  end if;

  -- 2) Proteger solo si ya no queda ninguna fila sin dueño.
  if (n_tasks + n_projects) = 0 then
    alter table public.tasks    enable row level security;
    alter table public.projects enable row level security;

    -- Borra TODA política existente: así desaparece la que está dejando
    -- pasar a `anon` y la que pueda haber duplicada.
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
  end if;
end $$;

commit;

-- ============================================================================
-- VERIFICACIÓN (ejecútala en otro query, sin este archivo):
--
--   select count(*) from public.tasks;          -- con anon, debe fallar o dar 0
--
--   Y con la app: inicia sesión → Ajustes → debe decir "Sincronización
--   automática activada" y tus tareas deben seguir ahí.
--
-- SI HAY MÁS DE UNA CUENTA y quieres asignar a mano:
--
--   select id, email, created_at from auth.users order by created_at;
--
--   update public.tasks    set user_id = '<uuid>' where user_id is null;
--   update public.projects set user_id = '<uuid>' where user_id is null;
--
--   y después vuelve a ejecutar este archivo para que active RLS.
-- ============================================================================
