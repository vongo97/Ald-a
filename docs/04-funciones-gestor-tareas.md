# Funciones del gestor de tareas inteligente — Investigación

> Documento de diseño para la app **Mis Tareas** (PWA local-first). Prioriza funciones por fase y
> deja constancia de las decisiones que separan un gestor mediocre de uno excelente.

## Principios rectores

1. **La IA quita trabajo, no lo mueve de sitio.** Toda función inteligente debe eliminar pasos
   (escribir menos, decidir menos, recordar menos). Si una función "inteligente" exige revisar,
   corregir y re-hacer, es tecnología por tecnología, no un ahorro.
2. **Los scores y sugerencias son borradores.** El sistema *propone* un orden; nunca reordena sin
   que el usuario pueda verlo, entenderlo (por qué: razones legibles junto al score) y revertirlo.
3. **Offline primero.** Todo lo esencial funciona sin red y sin cuenta: captura, vistas,
   recurrencias, desgloses por plantilla. La IA en la nube es una mejora opcional, no una dependencia.
4. **Un solo lugar por decisión.** "¿Qué hago ahora?" vive en *Hoy*; "¿qué se me acumuló?" en
   *Bandeja*; "¿mi plan es realista?" en *Revisión*. Sin duplicación de listas que derivan.

## Qué separa una app mediocre de una excelente

| Dimensión | Mediocre | Excelente (objetivo de esta app) |
|---|---|---|
| Captura | Formulario de 8 campos | Una línea en español: fecha, hora, proyecto, etiqueta, duración y prioridad se inferían solas |
| Fecha en español | Solo inglés (tomorrow, next monday) | "mañana", "pasado mañana", "el jueves", "en 3 días", "el 5 de marzo", "el primer lunes del mes", "cada 2 semanas" |
| Listas | Una lista infinita que se convierte en cementerio | *Hoy* es una lista corta y honesta; la edad de las tareas sin fecha empuja hacia arriba para que nadie quede olvidado |
| Plan vs. realidad | Ignora la sobrecarga | Avisa "tu plan de hoy no cabe" con minutos comprometidos vs. capacidad, y propone reprogramación en un clic |
| Desviación | Las vencidas se pudren en rojo | Banner de desviación + propuesta que respeta la carga de los próximos días |
| Recurrencias | Se pierden al completar | Al completar, nace la siguiente aparición; la completada deja de ser recurrente |
| IA | Caja negra que reordena | Desgloses y planes *revisables*: aceptar, editar o descartar pieza a pieza |
| Coste/fricción IA | Cuenta obligatoria, suscripción | Trae tu propia clave (BYOK), se guarda en `localStorage`, sin backend |

## Fase 1 — Base sólida (implementada)

- **Modelo de datos:** `Task` (título, notas, proyecto, etiquetas, fecha/hora, recurrencia,
  prioridad 1–4, importancia 1–4, duración, estado, subtareas por `parentId`, orden,
  `createdAt`/`completedAt`, bloque horario opcional), `Project` (nombre, color).
- **Captura en lenguaje natural (español):** parser propio en `src/parsers/`.
  Soporta: hoy / mañana / pasado mañana / días de semana ("el jueves") / "en N días|semanas|meses" /
  "este fin de semana" / fechas absolutas ("el 5 de marzo", "5/10") / horas ("15:30", "3pm",
  "a las 10", "9 de la noche", "mediodía") / recurrencias ("cada 2 semanas", "diario",
  "todos los lunes", "el primer lunes del mes"). Sintaxis extra: `#proyecto`, `@etiqueta`,
  `~90min`/`~2h`, `!1..!4` (prioridad) y `!i1..!i4` (importancia).
  Accesible con `/` o `n` desde cualquier vista y con botón flotante.
- **Vistas:** Hoy (orden sugerido + capacidad + desviación), Día (time-blocking), Bandeja,
  Proyectos (colores, creación desde `#`), Etiquetas, Revisión semanal, Búsqueda, Ajustes.
- **Subtareas** anidadas con progreso, **toast de deshacer** al completar (re-lee la entidad de la
  base para no deshacer sobre estado obsoleto), atajos `/`, `n`, `t`, `Esc`.
- **Persistencia:** IndexedDB vía Dexie; seed de bienvenida que enseña el uso.
- **PWA:** manifest en español, icono SVG inline, service worker con precache
  (network-first para navegación, stale-while-revalidate para assets) y `autoUpdate`.

## Fase 2 — Inteligencia local, gratis y offline (implementada)

- **Score tipo Eisenhower (`src/domain/priority.ts`):** combina urgencia (días hasta vencer,
  comparación por día calendario), importancia declarada, edad en bandeja (las huérfanas sin
  fecha suben 2 pts/día hasta +25) y recurrencia pendiente (+10). Devuelve `score` 0–100,
  cuadrante urgente/importante y **razones legibles** ("Vence mañana", "Lleva 12 días en la
  bandeja"). Es *orden sugerido*: el usuario siempre puede reordenar.
- **Capacidad del día (`src/domain/capacity.ts`):** suma duraciones declaradas + heurística para
  las que no la traen (llamadas 15m, compras 30m, trámites 60m, informes 90m, default 45m) contra
  una capacidad planificable conservadora (≈60 % de 8 h). Aviso explícito de sobrecarga.
- **Detección de desviación (`src/domain/deviation.ts`):** tareas vencidas y días sobre-reservados.
  La reprogramación en un clic distribuye lo vencido en los próximos días con hueco (tope de
  absorción 4 h/día) en lugar de apilar todo en hoy.
- **Plantillas de desglose locales (`src/domain/templates.ts`):** reembolsos, viajes, trámites,
  informes, mudanzas y citas médicas; se ofrecen cuando no hay IA configurada.

## Fase 3 — IA híbrida opcional (implementada)

- **Ajustes (BYOK):** proveedor OpenAI-compatible o Anthropic, clave, modelo y URL base
  (para proxys). Estado visible en todo momento: "IA activa" vs "IA desactivada (modo local)".
- **Adaptador (`src/llm/client.ts`):** timeout de 20 s, 2 reintentos con backoff exponencial,
  errores legibles y extracción de JSON tolerante a fences y preámbulos. Sin clave → ni un byte
  a la red.
- **Funciones:** desglose de tareas vagas en subtareas (`breakdownTask`), borrador de plan del día
  con bloques (`draftDayPlan`, integrable con la vista Día) y segunda opinión de captura
  (`improveCapture`). Toda salida llega como *propuesta revisable*; nada se aplica sin confirmación.

### Advertencias sobre la IA

- **Si la IA añade pasos, es un fracaso.** Un desglose con 5 pasos genéricos que el usuario tenía
  claros le roba tiempo. Por eso los desgloses llegan como borrador editable y las plantillas
  locales cubren los casos comunes sin red.
- **Los scores nunca deciden solos.** Un modelo que reordena tu lista y no te deja ver por qué
  destruye la confianza. Razones en texto siempre visibles.
- **Privacidad:** las tareas salen del dispositivo solo si el usuario configura una clave y lanza
  una acción de IA explícita. Nunca hay envío de fondo.
- **Coste:** BYOK significa que el usuario ve lo que gasta en su proveedor; la app no interpone
  margen ni requiere suscripción.

## Fase 4 — Calendario y pulido (parcial)

- **Time-blocking (implementado):** vista Día con rejilla 07:00–22:00; seleccionar tarea y clic en
  la rejilla crea un bloque redondeado a 15 min usando la duración estimada; los bloques se quitan
  con un clic. Colores por proyecto pendiente de aplicar a los bloques.
- **Pendiente:** animaciones de completado, transiciones entre vistas, auditoría de contraste/ARIA
  completa y conmutador de tema claro/oscuro (hoy el tema es oscuro por diseño).

## Verificación (estado actual)

- `npm run typecheck` (tsc -b) sin errores.
- `npm test` (Vitest): 59 tests de parser de fechas/recurrencia en español, parser de captura,
  score de prioridad, capacidad, desviación, recurrencias y adaptador LLM con `fetch` simulado
  (éxito OpenAI/Anthropic, reintentos ante 500, degradación sin clave, extracción JSON).
- `npm run build` (vite build + PWA) exitoso; revisión visual de Hoy, Día, Bandeja, Revisión,
  captura en vivo y flujo completar/deshacer hecha en navegador.
