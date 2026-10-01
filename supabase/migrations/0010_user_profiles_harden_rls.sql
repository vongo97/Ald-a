-- ============================================================================
-- Migracion 0010 - Endurecer RLS de user_profiles (defensa en profundidad)
--
-- QUE CORRIGE:
--   0006 creo las politicas de user_profiles SIN `to authenticated` (se aplican
--   a `public`, pero auth.uid() es NULL para anon -> no pasan). Tambien usa
--   `auth.uid() = id` en lugar de `(select auth.uid())` (re-evaluacion por fila,
--   advertido por el linter de RLS de Supabase).
--
-- QUE HACE:
--   - Re-crea TODAS las politicas con `to authenticated`.
--   - Usa `(select auth.uid())` para evitar re-evaluacion por fila.
--   - Es idempotente (borra politicas existentes primero).
--
-- NO CAMBIA EL COMPORTAMIENTO (no introduce fuga): anon sigue sin poder leer
-- insert/update/delete porque auth.uid() es NULL. Solo endurece la redaccion.
-- ============================================================================
begin;

drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Users can insert own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can delete own profile" on public.user_profiles;

create policy "Users can read own profile"
  on public.user_profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on public.user_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.user_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can delete own profile"
  on public.user_profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

-- ============================================================================
-- VERIFICACION: DESPUES del commit, nunca antes.
--
-- La primera version de esta migracion hacia la verificacion dentro de la
-- transaccion, y por eso un error de typo en el select (buscaba `cmd`, que
-- existe en la vista `pg_policies` pero no en la tabla de catalogo
-- `pg_policy`, donde se llama `polcmd`) provoco:
--
--     ERROR: 42703: column "cmd" does not exist
--
-- y como el fallo aborta el bloque de transaccion, el commit final se
-- convirto en rollback: las cuatro politicas NO se aplicaron. Perder una
-- migracion por un error de lectura es el peor sitio posible para un error
-- de lectura. Por eso aqui la transaccion se cierra antes de mirar nada.
--
-- Ademas el `select` no necesita transaccion: leer pg_policy no cambia nada,
-- asi que puede ir fuera sin riesgo.
-- ============================================================================
commit;

select policyname  as politica,
       roles::text as rol,
       cmd         as operacion
  from pg_policies
 where schemaname = 'public'
   and tablename = 'user_profiles'
 order by policyname;

-- ============================================================================
-- ESPERADO: 4 filas, y las cuatro con rol {authenticated} (no {public}).
--   read -> SELECT, insert -> INSERT, update -> UPDATE, delete -> DELETE.
-- ============================================================================
