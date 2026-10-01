-- ============================================================================
-- DIAGNOSTICO DE TUMBAS - solo lectura, no modifica nada
--
-- Que hay 87 tumbas sin dueno y 3 cuentas en auth.users, asi que la 0007
-- aborta a proposito: no adivina a quien pertenece cada tumba.
--
-- PERO SI SE PUEDE DEDUCIR SIN ADIVINAR. El borrado de tareas y proyectos
-- es blando (columna deleted_at, migracion 0005), asi que la fila original
-- de cada tumba sigue en tasks/projects CON SU user_id. El dueno de la tumba
-- se lee de ahi, no se supone.
--
-- Este archivo comprueba si eso cubre las 87 y de que cuentas son.
-- ============================================================================


-- [1] Las cuentas. La 0007 resuelve solo si hay exactamente una.
--     Con 3, todo lo que no se deduzca queda pendiente de decision.
select id,
       email,
       created_at,
       last_sign_in_at,
       (select count(*) from public.tasks    t where t.user_id = u.id) as tareas,
       (select count(*) from public.projects p where p.user_id = u.id) as proyectos,
       (select count(*) from public.tasks    t where t.user_id = u.id and t.deleted_at is not null)
         as tareas_borradas
  from auth.users u
 order by created_at;


-- [2] LAS 87 TUMBAS: cuantas se pueden deducir de tasks/projects.
--     atribuibles + no_atribuibles = total (las huerfanas son 87).
--     Si no_atribuibles = 0, la 0007 va a funcionar sin intervention.
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
select count(*) filter (where src.id is not null) as atribuibles,
       count(*) filter (where src.id is null)     as no_atribuibles,
       count(*)                                   as total_huerfanas
  from public.tombstones t
  left join src on src.id = t.id
 where t.user_id is null;


-- [3] De que cuenta es cada tumba deducible. Si una sola fila con 87, todas
--     son tuyas y la 0007 las resuelve sola.
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
select coalesce(u.email, '(sin cuenta)') as cuenta,
       count(distinct t.id)              as tumbas
  from public.tombstones t
  left join src  on src.id = t.id
  left join auth.users u on u.id = src.user_id
 where t.user_id is null
 group by 1
 order by 2 desc;


-- [4] Las NO atribuibles, con su causa. kind='tasks' pero no esta en tasks
--     significa que la fila se borro a mano del panel.
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
       count(*)                                          as tumbas,
       count(*) filter (where exists (select 1 from public.tasks    where id::text = t.id)) as existe_en_tasks,
       count(*) filter (where exists (select 1 from public.projects where id::text = t.id)) as existe_en_projects,
       min(t.updated_at)                                 as mas_antigua,
       max(t.updated_at)                                 as mas_reciente
  from public.tombstones t
  left join src on src.id = t.id
 where t.user_id is null and src.id is null
 group by t.kind
 order by 2 desc;


-- [5] Ids AMBIGUOSOS: el mismo id en tasks y projects con dos duenos
--     distintos. Solo pasa con UUID fabricados a mano, no con el
--     crypto.randomUUID() del cliente. Estos la 0007 NO los toca.
with src as (
  select id::text as id, user_id
    from (
      select id, user_id from public.tasks    where user_id is not null
      union all
      select id, user_id from public.projects where user_id is not null
    ) u
)
select id, count(distinct user_id) as duenos,
       array_agg(distinct user_id::text) as uuids
  from src
 group by id
having count(distinct user_id) > 1;


-- [6] Comprobacion de que el tombstone.id really es el id de una fila real.
--     Muestreo de 10 tumbas huerfanas con su fila de origen, si existe.
select t.id, t.kind, t.updated_at,
       ta.user_id as dueno_en_tasks,
       pr.user_id as dueno_en_projects,
       ta.deleted_at as borrada_en,
       pr.deleted_at as borrada_en_projects
  from public.tombstones t
  left join public.tasks    ta on ta.id::text = t.id
  left join public.projects pr on pr.id::text = t.id
 where t.user_id is null
 order by t.updated_at desc
 limit 10;
