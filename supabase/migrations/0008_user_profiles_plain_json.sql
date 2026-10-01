-- ============================================================================
-- Migracion 0008 - El perfil deja de fingir que esta cifrado
--
-- QUE CORRIGE:
--   La migracion 0006 creo `user_profiles(encrypted text)` y el cliente lo
--   "cifraba" con AES-GCM derivando la clave de `${user_id}:${salt}`. Pero:
--
--     * `user_id` es la CLAVE PRIMARIA de la propia tabla -> esta en el dump,
--       no es un secreto.
--     * El salt (`"ald-a-profile-v1"`) esta hardcodeado en el codigo fuente.
--
--   Resultado: cualquiera con acceso de lectura a la base podia descifrar
--   todos los perfiles. Los 100.000 iteraciones de PBKDF2 solo retrasaban el
--   script unos milisegundos. Era confidencialidad aparente, no real.
--
--   Ademas el perfil son horas de sueno, cronotipo y rutina: es MENOS
--   sensible que las tareas, que ya se guardan en texto plano bajo RLS.
--   Cifrar solo el perfil era incoherente.
--
-- QUE HACE:
--   Renombra `encrypted` -> `data` y guarda el perfil como JSON claro.
--   La frontera de confianza pasa a ser RLS (`id = auth.uid()`), igual que en
--   `tasks`, `projects` y `tombstones`. Los comentarios de 0006 quedan como
--   registro historico de lo que se hacia entonces.
--
-- EFECTO SOBRE LO YA GUARDADO:
--   Las filas antiguas contienen base64 de AES-GCM. Al no ser JSON valido, el
--   cliente las ignora y el siguiente `pushProfile` sobrescribe la fila con
--   texto plano. No hay que migrar datos a mano: el perfil es regenerable.
--
-- Es idempotente. DONDE: Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

begin;

do $$
begin
  -- Renombra solo si aun existe la columna vieja y no existe la nueva.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'user_profiles'
                and column_name = 'encrypted')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'user_profiles'
                and column_name = 'data') then
    alter table public.user_profiles rename column encrypted to data;
    raise notice 'Columna renombrada: encrypted -> data.';
  else
    raise notice 'Nada que renombrar (ya aplicado o esquema distinto).';
  end if;
end $$;

-- Enterrar la afirmacion falsa tambien en la documentacion del esquema.
comment on table public.user_profiles is
  'Perfil del usuario en JSON plano. La confidencialidad la da RLS (id = auth.uid()); el AES-GCM de 0006 era decorativo y se retiro en 0008.';

comment on column public.user_profiles.data is
  'Perfil serializado en JSON claro (texto). Legible por el dueno de la fila y por el servidor: NO meter secretos aqui.';

-- -- Verificacion ---------------------------------------------------------------
-- DESPUES del commit: si la verificacion falla, no debe revertir el rename.
commit;

select column_name as columna,
       data_type   as tipo,
       is_nullable as puede_ser_nulo
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_profiles'
 order by ordinal_position;

select policyname as politica, roles as rol, cmd as operacion
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by policyname;

-- ============================================================================
-- ESPERADO:
--   * NOTICE: "Columna renombrada: encrypted -> data."
--   * En columnas: id, data, updated_at.
--   * 4 politicas (select/insert/update/delete) con rol `authenticated`...
--     OJO: 0006 NO limito el rol. Si las politicas salen sin `to authenticated`,
--     conviene endurecerlas en una migracion aparte; hoy `auth.uid()` ya es
--     NULL para `anon`, asi que no hay fuga, pero es mas explicito.
-- ============================================================================
