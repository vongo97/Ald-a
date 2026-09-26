begin;

-- 1) Anyadir deleted_at a tasks y projects
alter table public.tasks
  add column if not exists deleted_at timestamptz;

alter table public.projects
  add column if not exists deleted_at timestamptz;

-- 2) Tabla de tumbas para sincronizacion offline
create table if not exists public.tombstones (
  id text primary key,
  kind text not null,
  updated_at timestamptz not null default now()
);

alter table public.tombstones enable row level security;

drop policy if exists tombstones_owner_all on public.tombstones;
create policy tombstones_owner_all
  on public.tombstones
  for all
  to authenticated
  using (true)
  with check (true);

-- 3) Indices
create index if not exists tombstones_kind_idx on public.tombstones (kind);
create index if not exists tombstones_updated_idx on public.tombstones (updated_at);

-- 4) Trigger para updated_at en tombstones
create or replace function public.set_tombstone_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tombstones_set_updated_at on public.tombstones;
create trigger tombstones_set_updated_at
  before update on public.tombstones
  for each row
  execute function public.set_tombstone_updated_at();

-- 5) Verificacion
select
  (select count(*) from information_schema.columns
    where table_name = 'tasks' and column_name = 'deleted_at') as tasks_deleted_at,
  (select count(*) from information_schema.columns
    where table_name = 'projects' and column_name = 'deleted_at') as projects_deleted_at,
  (select count(*) from information_schema.tables
    where table_name = 'tombstones') as tombstones_exists;

commit;
