-- ============================================================================
-- Migración 0001 — Sincronización multi-dispositivo correcta
--
-- Problemas que resuelve (detectados el 25/09/2026 inspeccionando el esquema):
--   1. src/store/sync.ts envía `user_id` en cada upsert, pero la columna no
--      existe → PostgREST devuelve 42703 y el push a la nube FALLA SIEMPRE
--      con sesión iniciada (fallo silencioso, solo en consola).
--   2. No existe `updated_at` → no se puede hacer merge "último en escribir
--      gana", que es lo que pide el comentario de sync.ts:65.
--   3. No hay RLS → cualquiera con la anon key leía/borraba todas las tareas
--      sin autenticarse (verificado: se leyeron 12 tareas con anon key).
--
-- DÓNDE EJECUTARLO:
--   Supabase Dashboard → SQL Editor → New query → pega este archivo → Run
--
-- VERIFICACIÓN POST-EJECUCIÓN (debe devolver ambas líneas sin error):
--   select column_name from information_schema.columns
--    where table_name in ('tasks','projects')
--      and column_name in ('user_id','updated_at');
--   → 4 filas (2 por tabla)
-- ============================================================================

begin;

-- ── 1) Columnas que el código ya asume ──────────────────────────────────────
alter table public.tasks
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.projects
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.tasks
  add column if not exists updated_at timestamptz not null default now();

alter table public.projects
  add column if not exists updated_at timestamptz not null default now();

-- ── 2) El servidor mantiene updated_at en cada UPDATE ───────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

-- ── 3) Índices para que RLS filtre rápido ───────────────────────────────────
create index if not exists tasks_user_id_idx    on public.tasks (user_id);
create index if not exists projects_user_id_idx on public.projects (user_id);

-- ── 4) Adoptar las 12 tareas y 1 proyecto huérfanos ─────────────────────────
-- Si existe EXACTAMENTE una cuenta, se la atribuye a esa. Si tienes varias,
-- este bloque no hace nada y tendrás que asignarlas a mano (ver nota al final).
do $$
declare
  owner uuid;
begin
  if (select count(*) from auth.users) = 1 then
    select id into owner from auth.users order by created_at asc limit 1;
    if owner is not null then
      update public.tasks    set user_id = owner where user_id is null;
      update public.projects set user_id = owner where user_id is null;
    end if;
  end if;
end $$;

-- ── 5) RLS: cada usuario solo ve y toca lo suyo ─────────────────────────────
-- Sin políticas para `anon` → la anon key ya NO puede leer tus datos.
alter table public.tasks    enable row level security;
alter table public.projects enable row level security;

drop policy if exists "tasks_owner_all" on public.tasks;
create policy "tasks_owner_all"
  on public.tasks
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all"
  on public.projects
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;

-- ============================================================================
-- NOTA — si tienes MÁS DE UNA CUENTA:
--   Las filas con user_id = null quedan invisibles para todos bajo RLS.
--   Comprueba qué quedó huérfano y asígnalo:
--
--     select id, title, user_id from public.tasks where user_id is null;
--
--   Y asígnalo a la cuenta que corresponda:
--
--     update public.tasks
--        set user_id = '<uuid-del-usuario>'
--      where user_id is null;
--     update public.projects
--        set user_id = '<uuid-del-usuario>'
--      where user_id is null;
--
--   Busca tus uuid con:
--     select id, email, created_at from auth.users order by created_at;
-- ============================================================================
