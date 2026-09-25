-- ============================================================================
-- Migración 0004 — Pasar los datos a la cuenta de Google y limpiar del todo
--
-- ⚠️  ORDEN CRÍTICO ⚠️
--   La FK de user_id en tasks/projects es  ON DELETE CASCADE  sobre auth.users.
--   Eso significa que SI BORRAS LA CUENTA ANTES DE MIGRAR, SE BORRAN SUS
--   12 TAREAS Y 4 PROYECTOS. Primero se migra, luego se borra.
--   Este script lo hace en ese orden y dentro de una transacción: si algo
--   falla, se revierte TODO (tampoco se borra ninguna cuenta).
--
-- QUÉ HACE:
--   1. Busca la cuenta de Google por correo (falla si no existe).
--   2. Mueve las 12 tareas y 4 proyectos a esa cuenta.
--   3. Comprueba que NO queda ninguna fila en las cuentas viejas.
--   4. Recién entonces borra las 2 cuentas de contraseña.
--
-- CÓMO USARLO:
--   1. Entra a la app con Google:  https://ald-a.vercel.app  → Ajustes
--   2. Pon el correo de AHÍ en  nueva_email  abajo.
--   3. Pega este archivo entero en el SQL Editor de Supabase y dale Run.
-- ============================================================================

begin;

do $$
declare
  -- ★★★ PEGA AQUÍ EL CORREO CON EL QUE ENTRASTE POR GOOGLE ★★★
  nueva_email  text    := 'PEGA_TU_CORREO_GOOGLE@gmail.com';

  vieja_cuenta uuid    := '8c697274-5c49-4473-ad38-7ad26d76bb7c'; -- juanddavidvo03 (dueña actual)
  vieja_dummy  uuid    := '5a64e8f6-5583-4363-bee6-5212edf665d3'; -- juanchoortiz123 (sin usar)

  nueva        uuid;
  n_t          int;
  n_p          int;
  n_viejas     int;
  borradas     int;
begin
  -- 1) La cuenta de Google tiene que existir YA (es decir: haber entrado antes).
  select id into nueva
    from auth.users
   where lower(email) = lower(nueva_email)
   limit 1;

  if nueva is null then
    raise exception 'No existe ninguna cuenta con el correo "%". Primero entra a la app con Google y luego vuelve a pegar este script con el correo correcto.', nueva_email;
  end if;

  if nueva in (vieja_cuenta, vieja_dummy) then
    raise exception 'El correo "%" corresponde a una cuenta de CONTRASEÑA, no a la de Google. Abortado.', nueva_email;
  end if;

  -- 2) MIGRAR ANTES DE BORRAR (aquí está lo del cascade).
  update public.tasks    set user_id = nueva where user_id in (vieja_cuenta, vieja_dummy);
  update public.projects set user_id = nueva where user_id in (vieja_cuenta, vieja_dummy);

  -- 3) Comprobación dura: si queda algo en las viejas, NO se borra nada.
  select count(*) into n_viejas from (
    select user_id from public.tasks    where user_id in (vieja_cuenta, vieja_dummy)
    union all
    select user_id from public.projects where user_id in (vieja_cuenta, vieja_dummy)
  ) x;

  if n_viejas > 0 then
    raise exception 'MIGRACIÓN INCOMPLETA: quedan % filas en las cuentas viejas. Abortado — NO se ha borrado ninguna cuenta.', n_viejas;
  end if;

  select count(*) into n_t from public.tasks    where user_id = nueva;
  select count(*) into n_p from public.projects where user_id = nueva;

  raise notice 'Migradas % tareas y % proyectos a %.', n_t, n_p, nueva_email;

  -- 4) Ahora sí, y solo ahora, eliminar las cuentas de contraseña.
  delete from auth.users
   where id in (vieja_cuenta, vieja_dummy)
     and id <> nueva;

  get diagnostics borradas = row_count;
  raise notice 'Cuentas de contraseña eliminadas: %.', borradas;
end $$;

-- ── Verificación final ──────────────────────────────────────────────────────
select (select count(*) from auth.users)                          as cuentas_restantes,
       (select count(*) from public.tasks    where user_id is null) as tareas_huerfanas,
       (select count(*) from public.projects where user_id is null) as proyectos_huerfanos,
       (select count(*) from public.tasks)                         as tareas_totales,
       (select count(*) from public.projects)                      as proyectos_totales;

select u.email,
       (select count(*) from public.tasks    t where t.user_id = u.id)::text as tareas,
       (select count(*) from public.projects p where p.user_id = u.id)::text as proyectos
  from auth.users u;

commit;

-- ============================================================================
-- ESPERADO:
--   NOTICE:  Migradas 12 tareas y 4 proyectos a <tu correo>.
--   NOTICE:  Cuentas de contraseña eliminadas: 2.
--   Y en Results: cuentas_restantes = 1, tareas_totales = 12,
--   proyectos_totales = 4, huerfanas = 0.
--
-- SI SALE UN EXCEPTION: no se borra NADA, tu base queda igual. Pégame el
-- mensaje y lo ajusto.
--
-- DESPUÉS (esto es del dashboard, no del SQL):
--   Supabase → Authentication → Providers → Email → Disable
--   Eso cierra la última vía de registro. Es lo que impide que cualquiera
--   pueda crear cuentas nuevas por correo.
-- ============================================================================
