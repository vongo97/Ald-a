-- ============================================================================
-- DIAGNOSTICO SUBIDA - lee el estado real de la nube
--
-- Pega esto en Supabase -> SQL Editor -> Run y me pasas lo que salga.
--
-- POR QUE ESTE FICHERO:
-- El `upsert` de tareas falla en produccion y el motivo solo llegaba a la
-- consola del navegador. La app no lo ensenaba, asi que no habia forma de saber
-- si era una columna que no existe, un permiso, o un id con mal formato. Todo lo
-- que se puede comprobar leyendo el codigo sale bien; lo que falla es la
-- conversacion con el servidor, y esa solo se ve preguntandosela al servidor.
--
-- POR QUE ES ASCII SIN CAJAS NI ACENTOS:
-- Pegado a mano, cualquier separador largo desalinea las lineas y produce un
-- error de sintaxis que no ayuda a nadie. Esto se lee, se copia y se ejecuta.
-- ============================================================================


-- [1] COLUMNAS REALES de public.tasks, con su tipo.
-- La app manda el objeto entero: id, title, notes, projectId, labels, dueDate,
-- dueTime, recurrence, priority, importance, durationMin, status, parentId,
-- order, createdAt, completedAt, timeBlock (mas user_id, updated_at,
-- deleted_at). Si aqui falta alguna, el upsert falla ENTERO y no sube nada.
-- Compara esta lista con esa: las que falten son la causa.
select ordinal_position as pos,
       column_name,
       data_type,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'tasks'
 order by ordinal_position;


-- [2] TIPO DE LAS COLUMNAS SOSPECHOSAS.
-- id importa: si en la nube es uuid pero la app cae en el respaldo
-- `t-<fecha>-<aleatorio>` (que no es un uuid), el servidor responde
-- "invalid input syntax for type uuid". recurrence, labels y time_block
-- importan porque son objetos/arrays y necesitan jsonb o text[].
select column_name, data_type, udt_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'tasks'
   and column_name in ('id', 'recurrence', 'labels', 'time_block',
                       'importance', 'duration_min', 'order', 'project_id',
                       'parent_id', 'completed_at', 'created_at');


-- [3] POLITICAS de public.tasks.
-- Un upsert necesita SELECT + INSERT + UPDATE. Una sola politica `for all`
-- con `with check (user_id = auth.uid())` rechaza en silencio cualquier fila
-- cuya user_id no sea la de la sesion. `permissive` a false haria que una
-- politica restrictiva anulase a las demas.
select policyname,
       permissive,
       roles::text as roles,
       cmd,
       qual,
       with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'tasks';


-- [4] EL ERROR REAL, con los mismos permisos que tiene la app.
-- Esto no es una teoria sobre por que podria fallar: es el mensaje literal que
-- el servidor le da a la PWA. Se ejecuta como el rol `authenticated` (no como
-- administrador del editor, que puede permitirse cosas que la app no) y con la
-- sesion puesta a la primera cuenta real.
--
-- Si la sentencia [4] falla, el editor detiene el script y la transaccion se
-- deshace sola: no queda ninguna fila. El nombre `diagnostico` del titulo es
-- para reconocerla si alguien la ve.
begin;

select set_config(
         'request.jwt.claims',
         json_build_object(
           'sub', (select id::text from auth.users order by created_at limit 1),
           'role', 'authenticated'
         )::text,
         true
       );

set local role authenticated;

insert into public.tasks (
  id, title, notes, labels, priority, importance, status, "order",
  created_at, user_id
) values (
  'diagnostico', 'Diagnostico', null, array[]::text[], 3, 3,
  'todo', 999999, now(),
  (select id::text from auth.users order by created_at limit 1)
);

rollback;


-- [5] CUANTAS TAREAS HAY DE VERDAD, y cuantas se han movido alguna vez.
-- Si la nube esta vacia o casi vacia, el `upsert` no ha subido nunca nada, y
-- el problema no es "no se ven en el otro dispositivo" sino "no han salido".
-- Ojo: despues del `rollback` de [4], esta consulta cuenta lo real.
select count(*)                              as total,
       count(*) filter (where deleted_at is not null) as en_papelera,
       max(updated_at)                        as ultimo_cambio,
       min(created_at)                        as primera
  from public.tasks;