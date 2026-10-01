-- ============================================================================
-- DIAGNOSTICO PREVIO - solo lectura, no modifica nada
--
-- Pega esto en Supabase -> SQL Editor -> Run. Solo son SELECT.
-- If one query fails, the others still run: they are independent.
--
-- WHY THIS FILE IS PLAIN ASCII WITH NO BOX DRAWING: the previous version
-- mixed long dash separators and accented characters, and after pasting by
-- hand any misalignment produced a syntax error that helped nobody.
-- SQL does not need decoration to tell the truth.
-- ============================================================================


-- [1] RLS y politicas por tabla.
-- politicas_permisivas > 0 significa que hay un USING (true): fuga entre cuentas.
select c.relname as tabla,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as politicas,
       (select count(*)
          from pg_policy p2
          join pg_class c2 on c2.oid = p2.polrelid
          join pg_namespace n2 on n2.oid = c2.relnamespace
         where n2.nspname = 'public'
           and c2.relname = c.relname
           and pg_get_expr(p2.polqual, p2.polrelid) = 'true') as politicas_permisivas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;


-- [2] Columnas por tabla. Dice que migraciones ya se aplicaron:
--     tasks/projects con user_id y updated_at -> 0001-0003 aplicadas
--     tombstones con user_id                  -> 0007 aplicada
--     user_profiles con data (no encrypted)   -> 0008 aplicada
--     (Si aparece 'encrypted', la 0008 NO se ha aplicado todavia.)
select table_name as tabla,
       string_agg(column_name, ', ' order by column_name) as columnas
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('tasks','projects','tombstones','user_profiles')
 group by table_name
 order by table_name;


-- [3] Clave primaria de tombstones.
--     id       -> falta la 0009
--     kind, id -> 0009 ya aplicada
select c.conname as restriccion,
       string_agg(a.attname, ', '
                  order by array_position(c.conkey, a.attnum)) as columnas_pk
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
 where c.conrelid = 'public.tombstones'::regclass and c.contype = 'p'
 group by c.conname;


-- [4] Todas las politicas, con su rol y su USING.
select tablename as tabla, policyname as politica, roles::text as rol, cmd as operacion,
       coalesce(qual, '(sin USING)') as usando,
       coalesce(with_check, '(sin CHECK)') as check
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;


-- [5] Cuentas y filas. La 0007 necesita esto para el backfill.
--     NO se consulta tombstones.user_id: esa columna todavia no existe (la
--     crea la 0007). Referenciarla aqui da error 42703.
--     La atribucion de tumbas por dueno esta en DIAGNOSTICO_TUMBAS.sql.
select 'cuentas en auth.users' as concepto, count(*)::text as valor from auth.users
union all select 'tareas', count(*)::text from public.tasks
union all select 'tareas borradas (soft)', count(*)::text from public.tasks where deleted_at is not null
union all select 'proyectos', count(*)::text from public.projects
union all select 'tumbas', count(*)::text from public.tombstones
union all select 'perfiles', count(*)::text from public.user_profiles;


-- [6] Rol real de las politicas de user_profiles.
--     rol = {public} -> 0006 no limito el rol, falta la 0010.
--     No es fuga: auth.uid() es NULL para anon, asi que anon ya queda fuera.
select policyname as politica, roles::text as rol, cmd as operacion
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by policyname;