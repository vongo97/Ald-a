-- Migración 0006: tabla de perfiles de usuario
-- Ejecutar en el SQL Editor de Supabase
--
-- Almacena el perfil del usuario CIFRADO con AES-GCM.
-- Supabase solo ve texto cifrado — nunca los datos en claro.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  encrypted text not null,
  updated_at timestamptz not null default now()
);

-- RLS: cada usuario solo ve su propio perfil
alter table public.user_profiles enable row level security;

create policy "Users can read own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can delete own profile"
  on public.user_profiles for delete
  using (auth.uid() = id);
