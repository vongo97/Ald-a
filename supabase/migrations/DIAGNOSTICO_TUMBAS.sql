-- ============================================================================
-- DIAGNOSTICO DE TUMBAS - solo lectura, no modifica nada
--
-- IMPORTANTE: este archivo NO puede mencionar tombstones.user_id, porque
-- todavia NO existe. La migracion 0007 es la que crea esa columna, y esta
-- consulta se ejecuta ANTES de correrla. Referenciarla aqui da:
--   ERROR: 42703: column t.user_id does not exist
-- (no es un fallo del diagnostico: es la columna que aun no se ha creado).
--
-- Consecuencia logica: HOY no hay ni una tumba con dueno. Las 87 son las 87
-- que hay en total. Este archivo dice de quien es cada una leyendolo de la
-- fila original en tasks/projects (el borrado es blando, columna deleted_at).
-- ============================================================================


-- [1] Las cuentas. La 0007 solo auto-resuelve lo que no puede deducir si hay
--     EXACTAMENTE una cuenta, asi que con 3 hay que revisar esto.
select u.id,
       u.email,
       u.created_at,
       u.last_sign_in_at,
       (select count(*) from public.tasks    t where t.user_id = u.id) as tareas,
       (select count(*) from public.projects p where p.user_id = u.id) as proyectos,
       (select count(*) from public.tasks    t where t.user_id = u.id and t.deleted_at is not null)
         as tareas_borradas,
       (select count(*) from public.projects p where p.user_id = u.id and p.deleted_at is not null)
         as proyectos_borrados
  from auth.users u
 order by u.created_at;


-- [2] De las 87 tumbas, cuantas se pueden deducir de tasks/projects.
--     Si no_atribuibles = 0, la 0007 nueva las resuelve sola sin intervention.
--     (hoy total_huerfanas = total de la tabla, porque ninguna tiene dueno aun)
with src as (
  select id, min(user_id::text)::uuid as user_id
    from (
      -- El cast a text: tombstones.id es text (0005) y puede que tasks.id sea
      -- uuid. Asi la union no depende de que los tipos coincidan.
      select id::text as id, user_id from public.tasks    where user_id is not null
      union all
      select id::text as id, user_id from public.projects where user_id is not null
    ) u
   group by id
  having count(distinct user_id) = 1
)
select (select count(*) from src)                                as ids_atribuibles,
       count(*) filter (where src.id is not null)                as atribuibles,
       count(*) filter (where src.id is null)                    as no_atribuibles,
       (select count(*) from public.tombstones)                 as total_en_tabla
  from public.tombstones t
  left join src on src.id = t.id;


-- [3] De que cuenta es cada tumba. Una sola fila con 87 = todas tuyas y la
--     0007 las resuelve sola. Varias filas = reparto real, tambien correcto:
--     la atribucion por evidencia separa cada una con su dueno.
with src as (
  select id, min(user_id::text)::uuid as user_id
    from (
      select id::text as id, user_id from public.tasks    where user_id is not null
      union all
      select id::text as id, user_id from public.projects where user_id is not null
    ) u
   group by id
  having count(distinct user_id) = 1
)
select coalesce(u.email, '(sin fila de origen)') as cuenta,
       count(*)                                as tumbas
  from public.tombstones t
  left join src       on src.id = t.id
  left join auth.users u on u.id = src.user_id
 group by 1
 order by 2 desc;


-- [4] Las NO atribuibles, con su causa.
--     kind='tasks' con existe_en_tasks=0 significa que la fila original se
--     borro a mano del panel de Supabase: no hay de donde leer el dueno.
--     esperada: 0 filas (o solo las de filas borradas a mano).
with src as (
  select id, min(user_id::text)::uuid as user_id
    from (
      select id::text as id, user_id from public.tasks    where user_id is not null
      union all
      select id::text as id, user_id from public.projects where user_id is not null
    ) u
   group by id
  having count(distinct user_id) = 1
)
select t.kind,
       count(*)                                                  as tumbas,
       count(*) filter (where exists (select 1 from public.tasks    where id::text = t.id)) as existe_en_tasks,
       count(*) filter (where exists (select 1 from public.projects where id::text = t.id)) as existe_en_projects,
       min(t.updated_at)                                         as mas_antigua,
       max(t.updated_at)                                         as mas_reciente
  from public.tombstones t
  left join src on src.id = t.id
 where src.id is null
 group by t.kind
 order by 2 desc;


-- [5] Ids AMBIGUOSOS: el mismo id en tasks y en projects con dos duenos
--     distintos. Solo puede pasar con UUID fabricado a mano, no con el
--     crypto.randomUUID() del cliente. La 0007 NO los toca a proposito:
--     elegir uno al azar haria visibles datos de la cuenta equivocada.
--     esperada: 0 filas.
with src as (
  select id::text as id, user_id
    from (
      select id, user_id from public.tasks    where user_id is not null
      union all
      select id, user_id from public.projects where user_id is not null
    ) u
)
select id,
       count(distinct user_id)     as duenos,
       array_agg(distinct user_id::text) as uuids
  from src
 group by id
having count(distinct user_id) > 1;


-- [6] Muestra de 10 tumbas con su fila de origen, para verificar a ojo que la
--     deduccion tiene sentido (si borrada_en no es null, la fila sigue viva).
select t.id,
       t.kind,
       t.updated_at                    as tumba_creada,
       ta.user_id                      as dueno_en_tasks,
       ta.deleted_at                   as fila_borrada_en,
       ta.title                        as titulo,
       pr.user_id                      as dueno_en_projects,
       pr.name                         as proyecto
  from public.tombstones t
  left join public.tasks    ta on ta.id::text = t.id
  left join public.projects pr on pr.id::text = t.id
 order by t.updated_at desc
 limit 10;
