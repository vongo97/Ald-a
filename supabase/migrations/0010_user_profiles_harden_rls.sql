-- ============================================================================
-- Migración 0010 — Endurecer RLS de user_profiles (defensa en profundidad)
--
-- QUÉ CORRIGE:
--   0006 creó las políticas de user_profiles SIN `to authenticated` (se aplican
--   a `public`, pero auth.uid() es NULL para anon → no pasan). También usa
--   `auth.uid() = id` en lugar de `(select auth.uid())` (re-evaluación por fila,
--   advertido por el linter de RLS de Supabase).
--
-- QUÉ HACE:
--   - Re-crea TODAS las políticas con `to authenticated`.
--   - Usa `(select auth.uid())` para evitar re-evaluación por fila.
--   - Es idempotente (borra políticas existentes primero).
--
-- NO CAMBIA EL COMPORTAMIENTO (no introduce fuga): anon sigue sin poder leer
-- insert/update/delete porque auth.uid() es NULL. Solo endurece la redacción.
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

-- Verificación
select polname, polroles::text as roles, cmd
  from pg_policy
 where polrelid = 'public.user_profiles'::regclass
 order by polname;

commit;
-- ============================================================================
-- ESPERADO: 4 políticas con roles como '{authenticated}' (o 'authenticated').
-- ============================================================================
