-- ============================================================================
-- DIAGNOSTICO SUBIDA - lee el estado real de la nube
--
-- COPIA Y EJECUTA UN BLOQUE POR VEZ. Uno solo cada vez.
--
-- No pegues el fichero entero: el editor manda las cinco sentencias juntas y
-- con que una se rompa no ves ninguna. Asi cada bloque va solo y el que falle
-- se ve claro.
--
-- POR QUE ES ASCII SIN ACENTOS:
-- Pegado a mano, cualquier separador largo desalinea las lineas y produce un
-- error de sintaxis que no ayuda a nadie. Esto se lee, se copia y se ejecuta.
--
-- LO QUE YA ESTA PROBADO Y NO HAY QUE VOLVER A MIRAR:
-- Las columnas existen. Se comprobo contra la API real del proyecto: pedir una
-- columna que no existe da error 400 y pedir una que existe da 200, y todas las
-- que manda la app respondieron 200. La teoria de "falta una columna" esta
-- muerta; no hay que escribir migracion por eso.
--
-- LO QUE FALTA SON ESTOS TRES, Y SOLO EL SERVIDOR PUEDE CONTESTARLOS:
--   [1] el tipo de cada columna sospechosa
--   [2] las politicas de RLS
--   [3] el error literal del insert con los mismos permisos que tiene la app
-- ============================================================================


-- ============================================================================
-- BLOQUE [1] - TODAS LAS COLUMNAS DE TASKS, SIN FILTRO.  Ejecuta esto solo.
-- ============================================================================
-- SIN FILTRO A PROPOSITO. La primera version de este bloque filtraba por
-- `column_name in ('due_date', 'due_time', ...)`, y salio diciendo que esas ocho
-- columnas no existen. No existen asi: existen en camelCase (`dueDate`,
-- `projectId`, `durationMin`...). El filtro las escondia y y yo lei de "faltan
-- ocho columnas", que es justo la theory que se murio antes. Un filtro de
-- nombres en un Diagnostico es una trampa: no dice lo que hay, dice lo que uno
--rumpio a preguntar.
--
-- Los tipos que de verdad pueden romper un insert, si los hay:
--   id          uuid      -> si la app manda `t-<base36>-<aleatorio>`, revienta
--   recurrence  jsonb     -> objeto o null
--   labels       jsonb     -> array o null
--   order        float8    -> la app manda entero, entra bien
--   priority     int2      -> la app manda 1-4, entra bien
select column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'tasks'
 order by ordinal_position;


-- ============================================================================
-- BLOQUE [2] - LAS POLITICAS DE RLS.  Ejecuta esto solo.
-- ============================================================================
-- Un upsert necesita SELECT + INSERT + UPDATE. Una sola politica `for all`
-- con `with check (user_id = auth.uid())` rechaza cualquier fila cuya user_id
-- no sea la de la sesion, y lo hace callado: la app solo ve "error" sin texto.
-- Si `permissive` sale a false, una politica restrictiva anula a las demas.
select policyname,
       permissive,
       roles::text as roles,
       cmd,
       qual,
       with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'tasks';


-- ============================================================================
-- BLOQUE [3] - EL ERROR LITERAL.  Dos pasos, en orden.
--
-- PASO 3a. Copia el id que te salga y lo pegas en el paso 3b donde pone
--   PEGAR_AQUI. Se hace aparte a proposito: despues de cambiar el rol a
--   `authenticated`, ese rol ya no puede leer auth.users, y si el id se
--   buscara con un select dentro del insert, el fallo seria "no puedo leer
--   auth.users" y no el de la app. Es decir: mediria un fallo mio, no el tuyo.
-- ============================================================================

select id::text as PEGAR_AQUI
  from auth.users
 order by created_at
 limit 1;


-- ============================================================================
-- PASO 3b. Sustituye PEGAR_AQUI por el id del paso 3a y ejecuta esto solo.
--
-- No es una teoria sobre por que podria fallar: es el mismo insert que hace la
-- app, con el mismo rol y con una sesion real. Lo que diga aqui es lo que
-- dice el servidor.
--
-- El `begin` y el `rollback` existen para que no quede ninguna fila. Si el
-- insert falla, la transaccion se deshace sola igual. El id `diagnostico` es
-- para reconocerla si alguien la ve.
-- ============================================================================

begin;

select set_config(
         'request.jwt.claims',
         json_build_object(
           'sub', 'PEGAR_AQUI',
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
  'PEGAR_AQUI'
);

rollback;


-- ============================================================================
-- BLOQUE [4] - CUANTAS TAREAS HAY DE VERDAD.  Ejecuta esto solo, al final.
-- ============================================================================
-- Si esto sale en cero o casi cero, el problema no es "no se ven en el otro
-- dispositivo" sino que no han salido nunca, y por donde hay que mirar es
-- distinto. Ojo: despues del rollback del paso 3b, esto cuenta lo real.
select count(*)                                        as total,
       count(*) filter (where deleted_at is not null)   as en_papelera,
       max(updated_at)                                  as ultimo_cambio,
       min(created_at)                                  as primera
  from public.tasks;
