# IR-SPEC.md — contrato de la IR de Fase 1

Describe lo que **REALMENTE** implementan Gate 2 (`ir.ts`, `id.ts`, `canonico.ts`,
`cargador.ts`) y las capas que ya lo usan (Gate 3/4) — no una aspiración. Cuando algo
está diferido a una fase posterior, se dice explícitamente y se cita la sección del
brief que lo pide.

## 1. Tipos (`ir.ts`)

`Proyecto`, `Componente`, `Conexion`, `ComportamientoRegla` — ver los tipos completos
en el archivo, con su justificación campo a campo en los comentarios. Resumen de los
campos que no son obvios por su nombre:

- `Proyecto.catalogoVersion`/`catalogoHash`: el par legible-por-humanos / hash de
  contenido del catálogo vigente en el último commit exitoso (ver §6).
- `Componente.pines`: `Record<string, string | null>` — terminal → id de
  `RegistroPin` (placas.ts) o `null` = todavía no asignado. Las claves son las que
  declara `ComponenteCatalogo.terminales[].id` (Gate 3); la IR misma no valida esto
  (es trabajo de `validar-tecnico.ts`, Gate 4).
- `ComportamientoRegla.cuando.umbral.unidad`/`.magnitud`: **strings sueltos**, no los
  enums cerrados `Unidad`/`Magnitud` de `catalogo.ts`. Es a propósito: `ir.ts` es una
  hoja del árbol de dependencias y no importa `catalogo.ts` (evitaría invertir la
  dirección de dependencia que fija T_diseno_consolidado.md §1: catalogo.ts depende de
  ir.ts, nunca al revés). Que esos strings sean valores REALES de los enums lo
  confirma `validar-tecnico.ts` contra el catálogo activo — hasta entonces son
  strings sin validar. `catalogo.ts` los castea explícitamente en el límite
  (`reemplazarSensor`, ver comentario ahí) — el cast está documentado, no es un
  escape silencioso.

## 2. Ids y contador (`id.ts`)

- `Proyecto.id`: generado una vez por un `GeneradorIdProyecto` inyectable
  (`() => string`, default `crypto.randomUUID`), determinista en tests vía inyección.
- `Componente.id`/`Conexion.id`/`ComportamientoRegla.id`: `"cmp-<n>"`/`"conn-<n>"`/
  `"beh-<n>"`, un ÚNICO contador (`Proyecto.siguienteIdLocal`) para los tres — nunca
  se reusa un `n`, sin importar de qué tipo de entidad haya sido el último id
  asignado. El contador vive DENTRO de `Proyecto` (no en el motor, Gate 6) para que un
  dry-run descartado se lleve su propio incremento sin código extra — Gate 6 todavía
  no existe; esto es una decisión de tipo ya tomada en `ir.ts`, ejercida recién en
  Gate 6.
- `compararIdsLocales` (id.ts): compara por el número numérico del sufijo `-<n>`, NO
  lexicográficamente ("cmp-2" < "cmp-10" numéricamente, al revés como string). Es lo
  que usa `cargador.ts` para ordenar los tres arrays de la IR (ver §3).

## 3. Forma canónica y orden de array — LO QUE REALMENTE PASA

Dos piezas separadas, que hay que dejar de confundir (la versión anterior de este
comentario en `canonico.ts` las mezclaba, incorrectamente — corregido en el commit
que trae este documento):

1. **`canonicalizar()` (canonico.ts)** ordena las CLAVES de cada objeto,
   recursivamente, y **preserva el orden de cualquier array tal cual lo recibe**. No
   reordena `componentes[]`/`conexiones[]`/`comportamientos[]` por su cuenta.
2. **`cargarProyecto()` (cargador.ts, líneas ~172-174)** SÍ reordena esos tres
   arrays — por `compararIdsLocales` (orden numérico del id local) — ANTES de
   congelar el `Proyecto` resultante.

**Consecuencia real, y por qué "no importa":** el orden final que ve cualquier
consumidor (después de pasar por `cargarProyecto`) es el orden de id local. Como los
ids salen del contador monotónico (§2), ese orden **coincide** con el orden de
creación — nunca hay una razón para que a alguien le importe el orden de un array de
esta IR: es una consecuencia derivada de la identidad (el id), no un campo aparte con
semántica propia. **El orden de array no lleva ningún significado en Fase 1**: no hay
prioridad, no hay "el primero gana", no hay render posicional (a diferencia de
`circuito.ts`, donde `id=tipo+índice` SÍ es posicional — ver
`CURRENT-ARCHITECTURE.md` §5). Un documento con los mismos componentes/conexiones/
comportamientos en otro orden de entrada carga exactamente al mismo `Proyecto`
canónico — probado en `tests/nucleo-ir-cargador.test.mjs`
(`documento-barajado: misma forma canónica Y cada entidad conserva su contenido
intacto`, agregado junto con este documento).

### 3.1. Prioridad/conflicto entre reglas de comportamiento — DIFERIDO, no resuelto por orden

Dos `ComportamientoRegla` que apunten al MISMO `entonces.actuador` con condiciones que
podrían disparar simultáneamente (ej. una dice "encender" y otra "apagar" el mismo
LED, ambas verdaderas a la vez) **no tienen una regla de resolución en Fase 1**. En
particular: **el orden del array NO decide cuál gana** — sería inventar semántica
posicional donde el diseño consolidado explícitamente no la puso (§3, arriba). El
brief trata la composición de reglas/eventos como parte del motor de ejecución en
vivo (§27, Fase 3 — "motor de reglas", posterior a Blockly/codegen), fuera del
alcance de Fase 1 (`nucleo/` sólo modela y valida la IR, no la ejecuta). Registrado
como punto diferido en `DECISIONS.md`.

## 4. Versiones — qué campos existen y por qué (R7, OD-11)

`Proyecto.schemaVersion`: versión de la FORMA del documento persistido (la que
`cargador.ts` compara contra `SCHEMA_VERSION_SOPORTADA`). `Proyecto.catalogoVersion`/
`catalogoHash`: el catálogo vigente en el último commit exitoso.

**Lo que NO existe, a propósito:** un par separado `createdWithCatalogVersion`/
`validatedWithCatalogVersion` (o el equivalente en español,
`creadoConVersionCatalogo`/`validadoConVersionCatalogo`, mencionado en versiones
anteriores del diseño). R7 (reconciliación del orquestador) decidió que Fase 1
persiste **un solo par** `catalogoVersion`/`catalogoHash` a nivel proyecto, no dos —
agregar un registro `ultimaValidacion` separado sería una caché sin invalidación
probada, y ningún caso de Fase 1 lo ejercita. Esto queda **provisional**: OD-11 sigue
formalmente abierta para separar los dos conceptos ("con qué catálogo se creó" vs.
"contra qué catálogo se validó por última vez") si una fase posterior lo necesita de
verdad — no se cierra por adelantado sin evidencia.

## 5. Lo que NO se persiste

- **`ready`/`listo` no se persiste nunca.** `derivarReadiness()` (validar.ts, Gate 4)
  es un cálculo puro sobre `(Proyecto, motivos[])` — se recalcula en cada
  lectura/revalidación, nunca se guarda como campo del documento. Guardarlo sería
  exactamente la clase de caché-sin-invalidación que R7 (arriba) ya rechazó para el
  caso de versión de catálogo.
- **No hay modelo de "borrador" (draft) separado del `Proyecto` canónico.** Un
  dry-run (Gate 6, `proponer()`) clona el canónico, aplica operaciones sobre la
  copia, valida, y DESCARTA la copia — nunca existe un segundo tipo de dato
  "ProyectoBorrador" con su propio schema. El "borrador" es, en tiempo de ejecución,
  un `Proyecto` común clonado — no una entidad persistida ni un tipo TypeScript
  aparte.

## 6. Loader — contrato completo (`cargador.ts`, Gate 2)

Nivel 1 (estructuralmente representable): valida forma, tipos, claves top-level
(fail-closed: una clave desconocida rechaza), ids duplicados, y referencias internas
colgadas (`REFERENCIA_ROTA_AL_CARGAR`) — SIEMPRE rechazo completo, nunca un objeto
parcial (R2). **Deliberadamente NO valida catálogo**: un `Componente.tipo` que ningún
catálogo activo reconozca, o una `placa` que el catálogo activo ya no tenga, CARGAN
bien — ver §7.

**Esta garantía sólo cubre documentos que pasan por `cargarProyecto()`.** Un `Proyecto`
armado a mano (o empujado directo a `crearMotorDeProyecto({ proyectoInicial, ... })`,
Gate 6) bypasea el loader por completo — por eso el motor corre su PROPIA validación
al construirse y se niega a operar sobre un estado ya roto (hallazgo adversarial
Gate 8, item 4 — ver `OPERATIONS.md` §8 y `DECISIONS.md`). El loader es la puerta de
entrada para documentos EXTERNOS; el chequeo de construcción del motor es la puerta
de entrada para `Proyecto` que llegan por cualquier otro camino (in-memory, tests,
futuros consumidores que no pasen por disco).

### 6.1. Ampliación Phase 1.1 (remediación de hallazgos externos E1-01/E1-02)

La garantía "ids duplicados" de §6 antes SÓLO cubría `componentes[]`; se extiende
explícitamente a `conexiones[]` y `comportamientos[]` (mismo código `ID_DUPLICADO`,
categoría `estructural`) — sin esto, dos conexiones (o dos comportamientos) con el
MISMO id cargaban ambas sin problema, y `Desconectar`/`SetComportamiento` por ese id
habría operado sobre AMBAS entidades a la vez (pérdida silenciosa de intención, brief
§8.1). Decisión con evidencia sobre el alcance de esta unicidad: es exacta por STRING
sobre el conjunto combinado cmp+conn+beh, NO además una exigencia de que el NÚMERO de
sufijo sea disjunto entre tipos (`cmp-0` y `conn-0` coexistiendo no se rechaza por eso
solo) — esa lectura más estricta del "único contador compartido" de §2 rompería
fixtures de test ya establecidas y probadas (`documentoValido()` en
`tests/nucleo-ir-cargador.test.mjs`, entre otras) que usan intencionalmente cmp-0/
conn-0/beh-0 simultáneos como documento VÁLIDO.

Además, el loader (y la construcción de `crearMotorDeProyecto({ proyectoInicial })`
de arriba) ahora rechazan (`CONTADOR_ID_INCONSISTENTE`, categoría `estructural`) un
documento donde `siguienteIdLocal` no sea ESTRICTAMENTE mayor que el número más alto
ya usado entre `cmp-`/`conn-`/`beh-` combinados: sin este chequeo, un documento
"estructuralmente representable" podía dejar que la PRÓXIMA operación que genera un id
local (`AgregarComponente`/`Conectar`/`SetComportamiento`, comparten un único contador
— §2) reprodujera un id ya existente (`AgregarComponente` produciendo dos veces
`cmp-0`, con `ok:true` — hallazgo E1-01).

Ambas reglas viven en UN SOLO lugar (`id.ts`, `analizarIdsLocales`/
`validarIdsYContador`), reusado por `cargador.ts` y por la construcción del motor —
deliberadamente NO se agregaron al pipeline continuo de `validar-estructural.ts`/
`validarProyecto` (que corre también después de cada commit, Gate 4): esa validación
corre sobre cualquier `Proyecto`, incluidos fixtures de test armados a mano que no
pretenden simular el contador real (`tests/nucleo-validacion.test.mjs`) — una vez
consistente al construirse, el contador se mantiene consistente por inducción, porque
los 3 aplicadores que generan un id local sólo lo INCREMENTAN, nunca lo decrementan
(cerrado además por regresión de cobertura, hallazgo M22, en
`tests/nucleo-operaciones.test.mjs`).

### 6.2. Ampliación Phase 1.1 (remediación del hallazgo externo E1-03, CRÍTICO)

`aplicarSetComportamiento` (`operaciones.ts`, Gate 5) sólo validaba que `cuando.
capacidad` estuviera declarada en el catálogo del sensor — nunca que `umbral.
magnitud`/`unidad` coincidieran con esa capacidad real, ni que `umbral.valor` fuera
`Number.isFinite`. Y `validar-tecnico.ts` (Gate 4, corre en CADA `validarProyecto`,
incluida la revalidación tras cambio de catálogo) nunca miraba `proyecto.
comportamientos` en absoluto — un comportamiento semánticamente basura podía entrar
por el loader, por un `proyectoInicial` armado a mano, o sobrevivir a una
revalidación con otro catálogo, y quedar sin diagnóstico, incluso `listo:true`.

Dos clases de defecto, con clasificación (A/B, brief §9.1) distinta y evidencia
propia — NO se inventó acá, se leyó del contrato:

1. **Un `umbral.valor` no finito (NaN/±Infinity) — RECHAZO, nivel estructural.** Un
   valor así no es representable en el documento JSON persistido
   (`JSON.stringify(NaN)`/`JSON.stringify(Infinity)` dan `null`, `canonico.ts`):
   aceptarlo deja la memoria (con el número real) desincronizada del disco (con
   `null`) apenas se persiste una vez — exactamente la clase de problema que §9.1
   categoría B describe ("intenta un estado que el modelo no puede representar
   coherentemente"). Se cierra en TRES puertas, cada una con su propio código, mismo
   criterio de distinción momento-de-carga vs. momento-de-operación que ya usa §7 de
   abajo para `REFERENCIA_ROTA_AL_CARGAR` vs. `REFERENCIA_INEXISTENTE`:
   - `aplicarSetComportamiento` (`operaciones.ts`, Gate 5) — `UMBRAL_NO_FINITO`,
     categoría `operacion`: rechaza la operación ANTES de construir el estado nuevo.
   - `cargador.ts` (Gate 2, momento de carga) — `UMBRAL_NO_FINITO_AL_CARGAR`,
     categoría `estructural`: cierra el caso de un documento (o un `unknown` ya
     parseado, no necesariamente un string JSON real) que trae el valor directo, sin
     pasar por la operación.
   - `validar-estructural.ts` (Gate 4, SIN catálogo, `UMBRAL_NO_FINITO`, categoría
     `estructural`) — corre sobre CUALQUIER `Proyecto`: cierra el `proyectoInicial`
     armado a mano que bypasea tanto el loader como la operación (mismo criterio que
     §6 de arriba ya usa para `CONTADOR_ID_INCONSISTENTE`/`ID_DUPLICADO`). Un
     documento JSON real, parseado con `JSON.parse`, NUNCA puede producir NaN/
     Infinity (no son tokens JSON válidos) — pero `cargarProyecto(entrada: unknown)`
     acepta un objeto ya parseado directo, así que la puerta de Gate 2 sigue siendo
     necesaria como defensa en profundidad, no redundancia inútil.
2. **Capacidad/magnitud/unidad incompatible con el catálogo vigente — REPRESENTABLE,
   nivel técnico (con catálogo).** Brief §8.1 lo dice explícito: "capability
   incompatible... puede ser un error representable (§9.1, categoría A)": el
   requisito se marca incompatible, NUNCA se reinterpreta ni se borra en silencio.
   `validar-tecnico.ts` agrega un chequeo por `ComportamientoRegla` (nuevo código
   `CAPACIDAD_INEXISTENTE_EN_CATALOGO` si la `capacidad` ya no existe para ese tipo
   de sensor; reusa el código YA existente `MAGNITUD_INCOMPATIBLE` — vía
   `propagarMagnitud`, sin cambios — si `magnitud`/`unidad` no coinciden). Corre
   dentro de `validarTecnico`/`validarProyecto`, así que se ejercita igual sin
   importar la puerta de entrada, INCLUIDA la revalidación con un catálogo distinto
   al que se usó para crear el comportamiento — y esa revalidación sólo diagnostica,
   JAMÁS reescribe el comportamiento del estudiante (P8 del diseño consolidado sigue
   diferida, sin resolver acá).

`SetComportamiento` (Gate 5) NO agrega un rechazo temprano nuevo por magnitud/unidad
incompatible: son representables por contrato (arriba), así que se deja pasar y
`validarTecnico` los diagnostica después de commitear — mismo criterio que
`AsignarPin` ya usa para `PIN_OCUPADO`/`CAPACIDAD_PIN_INCOMPATIBLE` (§4 de
`OPERATIONS.md`). El código YA existente `CAPACIDAD_NO_DECLARADA` (rechazo,
categoría `operacion`, Gate 5) NO se tocó: es una decisión previa a Phase 1.1 sobre
CÓMO llega el payload a la operación (una capacidad que ni siquiera aparece en el
`payload` recibido en el momento de la operación), distinta de "el catálogo cambió
DESPUÉS" que resuelve el punto 2 de arriba.

`reemplazarSensor`/`propagarMagnitud` (`catalogo.ts`, Gate 3) NO se tocaron: sus 4
ramas ya pasaron auditoría (sin clamp). El chequeo nuevo de `validar-tecnico.ts`
REUSA `propagarMagnitud` como oráculo de compatibilidad — nunca duplica la regla, y
nunca usa el `valor` convertido que devolvería (sólo diagnostica, no muta).

### 6.3. Ampliación Phase 1.1 (remediación del hallazgo externo E2-01, CRÍTICO)

"Sin auto-conexión (self-loop) / sin conexión duplicada" NO era un invariante
estructural real de la IR — sólo existía como chequeo ad-hoc DENTRO de
`aplicarConectar` (`operaciones.ts`, Gate 5). Ni `cargarProyecto()` (Gate 2) ni
`validarProyecto()` (Gate 4) lo verificaban jamás: un documento cargado directo, o un
`proyectoInicial` armado a mano que bypasea `Conectar` por completo, llegaba a
`listo:true` con topología eléctricamente imposible y sin ningún diagnóstico
(evidencia/e2/exp1b_selfloop_listo_true.mjs — self-loop + duplicado, `motivos:[]`,
`listo:true`; evidencia/e2/exp5_motor_acepta_selfloop_inicial.mjs —
`crearMotorDeProyecto({proyectoInicial})` se construye SIN lanzar
`ErrorEstadoInicialInvalido`, falsificando textualmente este mismo §6 para esta clase
exacta de rotura).

**Definición de "misma conexión" (decisión con evidencia, NO semántica nueva).** El
tipo `Conexion`/`ExtremoConexion` (`ir.ts`) no distingue dirección eléctrica —
`desde`/`hasta` son etiquetas de posición del payload de `Conectar`, no polaridad — y
el código YA vigente ANTES de Phase 1.1 (`mismoPar`, `operaciones.ts`, más el test
explícito "conectar-duplicada-rechaza" de `tests/nucleo-operaciones.test.mjs`: "el
MISMO par, aunque en orden invertido, ya está conectado") ya trataba A→B y B→A como
la MISMA conexión. Phase 1.1 no reinterpreta ni endurece esa semántica: la extrae a
`conexion.ts` (`mismaConexion`, comparación por conjunto de 2 elementos, no por
igualdad posicional de `desde`/`hasta`) para reusarla, y fija el comportamiento con
tests explícitos en las tres puertas de abajo (además del test ya existente a nivel
operación). Cuidado con sobre-rechazo: dos conexiones DISTINTAS que comparten un
único terminal (mismo componente/terminal en UN extremo, pero el OTRO extremo
difiere) no son ni self-loop ni duplicado — `mismaConexion` compara el PAR completo
de 2 elementos, nunca un extremo aislado (test de no-regresión en las tres puertas).

**UNA sola implementación (`conexion.ts`: `esAutoconexion`, `mismaConexion`,
`analizarConexionesInvalidas`), reusada por TODAS las puertas que producen un
`Proyecto` — nunca una copia divergente:**

- `operaciones.ts` (`aplicarConectar`, Gate 5) — defensa temprana YA existente,
  reescrita para usar `esAutoconexion`/`mismaConexion` en vez de su copia local
  (`mismoPar`, eliminada): `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA`, categoría
  `operacion`, rechaza la operación ANTES de construir el estado nuevo (sin cambio de
  comportamiento — mismos códigos, misma semántica, Path A `PIN_OCUPADO` intacto).
- `cargador.ts` (Gate 2, momento de carga) — nuevos códigos
  `AUTOCONEXION_INVALIDA_AL_CARGAR`/`CONEXION_DUPLICADA_AL_CARGAR`, categoría
  `estructural`, corre DESPUÉS de `validarIdsYContador` (§6.1): un documento con ids
  duplicados que ADEMÁS forma un par eléctrico duplicado reporta primero
  `ID_DUPLICADO` — mismo orden ya establecido y probado por
  "id-duplicado-entre-conexiones-rechaza" (E1-02).
- `validar-estructural.ts` (Gate 4, SIN catálogo, corre dentro de `validarProyecto`)
  — REUSA los códigos YA existentes `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA`, acá
  con categoría `estructural` en vez de `operacion` (mismo criterio que
  `UMBRAL_NO_FINITO` de §6.2: mismo código, dos categorías según quién lo emite).
  Corre sobre CUALQUIER `Proyecto` sin importar la puerta de entrada — a diferencia de
  §6.1 (unicidad/consistencia de ids), acá SÍ se agrega al pipeline continuo de
  `validarProyecto`: el pedido explícito de Phase 1.1 para este hallazgo es que
  corra también en `validarProyecto` directo, no sólo al cargar/construir, y no hay
  fixture de test existente que dependa de un self-loop o conexión duplicada como
  estado "sano" armado a mano (a diferencia del contador de ids, que sí tenía
  fixtures así). Esto además cierra automáticamente la construcción del motor sobre
  `proyectoInicial` (`motor.ts` ya corre `validarProyecto` ahí, sin cambios propios
  en `motor.ts`) y la revalidación post-commit.

`docs/programacion-intencion/OPERATIONS.md` §3 documenta la tabla actualizada de
`Conectar` con esta ampliación; `COMPONENT-CATALOG.md` §6 agrega las filas de
clasificación correspondientes.

### 6.4. Ampliación Phase 1.1 (remediación del hallazgo externo CP-01, checkpoint de T5,
tratado como CRÍTICO)

`crearMotorDeProyecto({ proyectoInicial })` (Gate 6, `motor.ts`) corría
`validarProyecto` (Gate 4) y `validarIdsYContador` (§6.1) al construirse, pero
NINGUNA de las dos mira la FORMA/SCHEMA del `proyectoInicial` — ambas asumen un
`Proyecto` YA bien tipado (TypeScript es sólo sintaxis borrable: no hay protección
de tipos en runtime) y sólo leen `componentes`/`conexiones`/`comportamientos`/
`siguienteIdLocal`. Un `proyectoInicial` con una clave desconocida en la raíz,
`revision`/`siguienteIdLocal` con el tipo o el valor incorrecto (`-5`, `"7"`), un
`schemaVersion` no soportado, o un componente con `tipo`/`pines` de tipo basura
(`tipo:123`, `pines:"x"`) construía un motor "operable" SIN ningún diagnóstico —
exactamente el documento que `cargarProyecto()` (Gate 2) rechazaría de entrada.
Peor: con `proyectoInicial` `undefined`/`null`/`{}`/`[]` ninguna de las dos llegaba
siquiera a un `Motivo` — explotaban con un `TypeError` crudo apenas tocaban
`proyecto.componentes` (evidencia/T5/CP01_proyectoInicial_forma.txt,
evidencia/T6/CP01_repro.mjs). Esto falsificaba el principio central de este mismo
§6: "el motor corre su PROPIA validación al construirse y se niega a operar sobre
un estado ya roto" — un `proyectoInicial` es una puerta de entrada con los MISMOS
invariantes que el loader (Brief, Phase 1.1 §13/§31), nunca una vía más permisiva.

**Fix: `validarFormaProyecto` (`cargador.ts`) — la MISMA función que
`cargarProyecto()` usa tras `JSON.parse`, extraída para no copiarla — corre en la
construcción del motor.** Si la forma ya está rota, sus motivos
(`CLAVE_DESCONOCIDA`/`CAMPO_REQUERIDO_FALTANTE`/`VERSION_SCHEMA_DESCONOCIDA`/
`DOCUMENTO_MALFORMADO`, todos `clasificacion:"rechazo"`) alcanzan por sí solos para
tirar `ErrorEstadoInicialInvalido` — nunca un `TypeError`. `validarProyecto`/
`validarIdsYContador` se intentan igual en ese caso, protegidos (`try/catch`: si el
objeto es tan ajeno a un `Proyecto` que también explotan ahí, la excepción se
descarta sin propagar), para no perder — en fixtures que violan un invariante de
Gate 4 pero conservan la forma mínima que Gate 4 lee (self-loop, umbral no finito,
id duplicado, referencia colgada) — el código de Gate 4 que esos tests ya prueban:
`validarFormaProyecto` detecta ALGUNOS de esos mismos casos también, pero con su
propio código de momento-de-carga (mismo criterio que §6.1/§6.2/§6.3) — nunca se
pisan entre sí, sólo se UNEN.

### 6.5. Ampliación Phase 1.1 (RX) — hallazgo externo RX-01, CRÍTICO (revisión adversarial independiente, reabre CP-01)

§6.4 (arriba) cerró la FORMA/SCHEMA a nivel del documento completo, pero dos defectos
sobrevivieron en la MISMA puerta:

1. **El motor usaba el objeto CRUDO, no la copia saneada.** Cuando
   `validarFormaProyecto(deps.proyectoInicial)` daba `ok:true`, `crearMotorDeProyecto`
   seguía usando `deps.proyectoInicial` — nunca `resultadoForma.proyecto`, la copia
   YA VALIDADA que la misma función devuelve — tanto para `validarProyecto`/
   `validarIdsYContador` como para construir `canonico`
   (`congelarProfundo(clonarProfundo(...))`). Esto no cambiaba nada mientras las dos
   copias fueran equivalentes, pero `cargarProyecto()` SÍ hace algo más con esa copia
   antes de congelarla: reordena `componentes`/`conexiones`/`comportamientos` por id
   local (§3) y — con la ampliación de abajo — rechaza claves anidadas desconocidas.
   Usar el objeto crudo rompía la equivalencia
   `canonicalizar(cargarProyecto(doc).proyecto) === canonicalizar(crearMotorDeProyecto({proyectoInicial: doc}).getProyecto())`
   para cualquier documento cuyos arrays no llegaran ya en orden ascendente de id
   local — un `proyectoInicial` armado a mano con un `siguienteIdLocal` monotónico
   pero ids "fuera de orden" (perfectamente válido: §3 dice que el orden de array no
   lleva significado en Fase 1) construía un canónico con OTRO orden de array que el
   mismo documento cargado por `cargarProyecto()`.

2. **Ninguna lectura de `proyectoInicial` estaba protegida contra excepciones.** Un
   getter que lanza en CUALQUIER campo — declarado o no, en la raíz o anidado —
   propagaba un `Error` crudo en vez de `ErrorEstadoInicialInvalido`, falsificando el
   mismo principio que CP-01 (§6.4) ya había cerrado por otra lectura.

**Fix:** `crearMotorDeProyecto` ahora SIEMPRE construye desde `resultadoForma.proyecto`
(cuando `ok:true`) — nunca desde `deps.proyectoInicial` crudo — igual que
`cargarProyecto()`. Toda la secuencia de lectura (`validarFormaProyecto`,
`validarProyecto`/`validarIdsYContador`, y la construcción de `canonico` vía
`clonarProfundo`) corre dentro de un `try/catch`: cualquier excepción se convierte en
`ErrorEstadoInicialInvalido` con el motivo `EXCEPCION_INESPERADA_LEYENDO_PROYECTO_INICIAL`
(categoría `estructural`, rechazo siempre — `motivos.ts`), nunca un `Error` crudo.

**Además (mismo hallazgo, parte del análisis de contrato):** §6 (arriba) sólo describe
fail-closed ante claves desconocidas a nivel TOP-LEVEL del documento — no dice nada
sobre una clave desconocida DENTRO de un `Componente`/`Conexion`/`ComportamientoRegla`
anidado. Antes de este fix, `validarComponente`/`validarConexion`/
`validarComportamiento` (`cargador.ts`) sólo desestructuraban los campos que conocían
— una clave extra anidada se descartaba en silencio (nunca se rechazaba NI se
reportaba), violando la regla dura de "nunca reparar en silencio". Dado el silencio
del contrato sobre este caso específico, se aplica el MISMO criterio fail-closed que
ya rige a nivel raíz: `validarComponente`/`validarExtremoConexion`/`validarConexion`/
`validarComportamiento` (y sus sub-objetos `cuando`/`cuando.umbral`/`entonces`) ahora
rechazan también con `CLAVE_DESCONOCIDA` (categoría `estructural`) — en la MISMA
función compartida por el loader y por la construcción del motor, así que ninguna de
las dos puertas repara en silencio. `Componente.propiedades` (§1, "bolsa abierta") es
la ÚNICA excepción a propósito: sigue siendo de forma libre, nunca se valida por
clave. Se revisaron los fixtures de test existentes: ninguno usaba una clave anidada
extra como parte de un documento VÁLIDO — el único caso encontrado
(`tests/nucleo-motor.test.mjs`, tabla de CP-01, "componente basura") era un fixture ya
ROTO por otra razón (tipo/pines con tipo incorrecto) que además llevaba una clave
extra incidental (`extra: true`) sin relación con lo que ese caso decía probar; se
quitó esa clave incidental para no confundir dos causas de rechazo en un mismo caso.

Con estos dos fixes, cualquier documento — cargado por `cargarProyecto()` o empujado
directo como `proyectoInicial` — produce el MISMO `Proyecto` canónico (probado en
`tests/nucleo-motor.test.mjs::equivalencia-cargarProyecto-vs-proyectoInicial`).

### 6.6. Phase 1.1 (RX2) — frontera de datos planos

Una segunda revisión adversarial independiente (RX2, `RX2_REPORT.md`) reabrió tres
CRÍTICOS de la MISMA clase que §6.4/§6.5 ya habían tratado de cerrar — no por una
lectura sin proteger que se les hubiera escapado, sino porque el mecanismo elegido
(un `try/catch` puntual alrededor de UNA lectura) sólo puede probar que ESA lectura
no crashea, nunca que no existe una SEGUNDA lectura del mismo campo en otro lugar
del código:

- **RX2-01** — `aplicarOperacion` (`operaciones.ts`) leía `operacion.payload` DOS
  veces: una protegida (la validación de forma, dentro del `try/catch` de RX-02), y
  otra SIN proteger (el `switch` de despacho, más abajo). Un getter válido en la 1ª
  lectura que lanza en la 2ª (TOCTOU) atravesaba igual, crudo.
- **RX2-02** — `payload.propiedades` (la bolsa abierta de `AgregarComponente`, §1,
  nunca validada en forma) se incrustaba SIN copiar en el borrador. `congelarProfundo`
  (`canonico.ts`, usado en cada commit/dry-run de `motor.ts`) recorre
  `Object.values()` de cualquier objeto anidado — lo que SÍ dispara el trap `get` de
  un Proxy. Una superficie que ningún fix anterior (RX-01/RX-02) había tocado.
- **RX2-03** — `cargarProyecto(objeto)` (§6, Gate 2, acepta explícitamente un
  documento YA parseado, no sólo un string JSON) no tenía NINGÚN `try/catch` propio
  — a diferencia de `crearMotorDeProyecto`, que sí se había protegido en §6.5. Peor:
  `validarComponente` validaba `pines` con `Object.values(pines).every(...)` y LUEGO
  copiaba con un spread INDEPENDIENTE (`{...pines}`) — dos recorridos del MISMO
  objeto, un TOCTOU real que permitía colar un valor fuera de schema (`pines.anodo:
  42`, cuando el schema exige `string|null`) que la validación había aprobado leyendo
  OTRO valor. Ese documento, una vez persistido y recargado, se rechazaba — el
  round-trip que este mismo archivo (§3) exige quedaba roto.
- **RX2-04 (NOTA)** — el rechazo fail-closed de claves desconocidas
  (`clavesDesconocidasDe`/`Object.keys`) sólo mira claves ENUMERABLES: una clave extra
  definida como NO enumerable ni se rechazaba ni se colaba — quedaba simplemente
  ignorada en silencio. No explotable con JSON real (`JSON.parse` siempre produce
  propiedades enumerables), pero un límite documentable.

Ninguno de los cuatro es alcanzable por JSON real — todos requieren que el llamador
construya el objeto a mano, in-process (brief §37: un adaptador futuro, un wrapper de
test, un ORM con propiedades lazy). El denominador común: parchear la lectura que un
script de ataque encontró es whack-a-mole por diseño — cierra el ataque de hoy y deja
abierta la misma clase de grieta en el próximo lugar donde alguien agregue una lectura.

**Fix, de CLASE, no de instancia:** un módulo nuevo y único,
`opencode/nucleo/datos-planos.ts` (`materializarDatosPlanos`), que produce una copia
PROFUNDA hecha ÚNICAMENTE de datos planos compatibles con JSON, leyendo cada
propiedad EXACTAMENTE una vez, y NUNCA invocando un getter: se lee por DESCRIPTOR
(`Object.getOwnPropertyDescriptor`), nunca por acceso (`v.campo`/`v[i]`) — un
accessor (`get`/`set`) se rechaza SIN invocarlo. Efecto secundario deliberado y
correcto: un Proxy cuyo ÚNICO trap "malicioso" es `get` (el patrón exacto de
RX2-02/RX2-03) nunca dispara ese trap — la lectura por descriptor cae al
comportamiento default (el descriptor REAL del target) y el dato real se acepta
intacto. Un Proxy que miente/lanza en `ownKeys`/`getOwnPropertyDescriptor` (los
traps que el módulo SÍ invoca) sí se rechaza, siempre con un resultado estructurado
— el módulo entero corre dentro de un único `try/catch` y nunca lanza. Prototipo:
sólo `Object.prototype`/`null` (objetos) o `Array.prototype` (arrays densos, sin
huecos, sin propiedades extra fuera de índices/`length`) — cualquier otro (instancia
de clase, `Date`, `Map`) se rechaza. Claves Symbol y propiedades NO enumerables se
rechazan fail-closed (cierra RX2-04). Los numbers se copian TAL CUAL, incluidos
NaN/±Infinity/-0 — la finitud la siguen decidiendo los validadores existentes
(`UMBRAL_NO_FINITO` etc.), este módulo nunca la evalúa. `undefined` como valor de una
propiedad de OBJETO se preserva (mismo criterio que el resto del núcleo ya usa para
"ausente" — `JSON.stringify` ya lo omite al persistir, un comportamiento conocido);
como ELEMENTO DE ARRAY se rechaza (`JSON.stringify` lo convertiría en `null`
silenciosamente — un cambio de VALOR, no sólo de forma). Ciclos se rechazan; una
referencia COMPARTIDA (no cíclica) se duplica en la copia, nunca se rechaza. Límites
de profundidad y de tamaño total documentados en el propio módulo, para no reventar
la pila con una entrada adversarial anidada a propósito.

Un rechazo del módulo se envuelve con `motivoEntradaNoPlano(categoria, resultado)` en
un `Motivo` con el código único y estable `ENTRADA_NO_ES_DATO_PLANO` — mismo criterio
ya establecido en todo el núcleo (`CLAVE_DESCONOCIDA`/`AUTOCONEXION_INVALIDA`/
`UMBRAL_NO_FINITO`): un solo código, la `categoria` la decide quién lo emite
(`cargador.ts`: `"estructural"`; `operaciones.ts`: `"operacion"`; `motor.ts`:
`"motor"`).

**Aplicado en cada frontera pública, antes de cualquier otra lectura:**

- `validarFormaProyecto` (`cargador.ts`) — usada tanto por `cargarProyecto()` (Gate
  2) como por `crearMotorDeProyecto({ proyectoInicial })` (§6.4/§6.5) — materializa
  su entrada como PRIMER paso. Cierra RX2-03(a) y RX2-03(b) por construcción: el
  doble recorrido de `pines` se unificó en un único paso (`Object.entries`, valida y
  copia junto — nunca dos fuentes de verdad sobre el mismo dato).
- `aplicarOperacion` (`operaciones.ts`) materializa el sobre COMPLETO (envoltorio +
  payload anidado) antes de `analizarSobreOperacion`/`validarFormaPayload` y del
  `switch` de despacho — los tres trabajan sobre la MISMA copia, así que no existe
  una "segunda lectura" que pueda divergir de la primera (cierra RX2-01). Cierra
  también RX2-02: `payload.propiedades` llega a `aplicarAgregarComponente` como copia
  plana, nunca como el objeto vivo del llamador — `congelarProfundo` ya no puede
  toparse con un Proxy que lanza.
- `ejecutarLote` (`motor.ts`) materializa el LOTE COMPLETO de operaciones antes de
  leer siquiera el `baseRevision` de la primera — una superficie que ni RX-01 ni
  RX-02 habían tocado (un getter en el propio `baseRevision` del sobre crasheaba acá,
  antes incluso de llegar a `aplicarOperacion`).

**El `try/catch` exterior de `crearMotorDeProyecto` (§6.5, RX-01 parte b) se
eliminó.** Una mutación ronda 2 (M2, `MUTATION_RESULTS_R2.md`, hallazgo R06)
demostró que ese catch podía enmascarar una regresión sin que ningún test lo
notara: con un getter en un campo RAÍZ DECLARADO de `Proyecto` (`componentes`,
`revision`, `placa`, no uno anidado/desconocido), si `validarFormaProyecto` alguna
vez dejara de materializar, el catch exterior seguía convirtiendo la excepción en
`ErrorEstadoInicialInvalido` IGUAL — con OTRO código
(`EXCEPCION_INESPERADA_LEYENDO_PROYECTO_INICIAL`) — y la regresión pasaba
inadvertida. Con la materialización como ÚNICO mecanismo (nunca dos que compitan),
`resultadoForma.ok` sale `false` con un motivo `ENTRADA_NO_ES_DATO_PLANO`
(`clasificacion:"rechazo"`) y el camino ya existente
(`throw new ErrorEstadoInicialInvalido(rechazosIniciales)`) alcanza solo — sin
necesitar el catch exterior. El `try/catch` alrededor de
`congelarProfundo(clonarProfundo(proyectoParaConstruir))` se conserva, pero como
BACKSTOP defensivo (ese valor ya es la copia validada/plana que
`validarFormaProyecto` devuelve, nunca el objeto crudo del llamador — no compite con
la materialización de arriba, protege contra un fallo inesperado del propio
`structuredClone`, no una entrada hostil).

### 6.7. Phase 1.1 (RX3) — "__proto__" como clave rompía la propia frontera de datos planos

Una TERCERA revisión adversarial independiente (RX3, `RX3_REPORT.md`) reabrió, en
forma PEOR que RX2-01/02/03, la MISMA clase que §6.6 declaró cerrada: alcanzable con
**JSON PURO**, sin Proxies ni getters in-process.

- **RX3-01 (CRÍTICO)** — la rama objeto de `materializarDatosPlanos` construía su
  copia con `copia[clave] = valor` sobre un `Record<string, unknown> = {}` — un
  objeto PLANO que hereda el accessor `Object.prototype.__proto__` (un SETTER
  mágico, no una propiedad de datos). Con `clave === "__proto__"`, esa asignación
  por corchetes no crea una propiedad propia: dispara el setter heredado y
  reemplaza el PROTOTIPO INTERNO de la copia. Es el gotcha clásico "`JSON.parse` es
  inmune a la contaminación de prototipo, pero un bucle `obj[k]=v` sobre esas
  mismas claves NO lo es" — y esta función era exactamente ese bucle. Un documento
  JSON de texto con una clave literal `"__proto__"` en cualquier objeto anidado
  (algo que un cliente HTTP real puede enviar sin ningún truco in-process, vía
  `JSON.parse`, que produce esa clave como propiedad OWN real — nunca vía un
  literal de objeto JS `{"__proto__": x}`, que la gramática del LENGUAJE interpreta
  como prototipo en tiempo de parseo del código fuente, un mecanismo distinto)
  bypaseaba `CLAVE_DESCONOCIDA` en la raíz del documento (la clave ya no aparecía
  en `Object.keys` de la copia) y hacía desaparecer datos EN SILENCIO dentro de
  `propiedades` (bolsa abierta, forma libre a propósito) — la "reparación
  silenciosa" que el brief prohíbe. Consecuencia adicional observada: la ruta de
  operaciones (`motor.ts`/`operaciones.ts`) rechazaba el MISMO ataque, pero por una
  CASUALIDAD de la materialización redundante (§6.7.1) con un mensaje de
  diagnóstico FALSO ("instancia de clase u objeto exótico"), mientras
  `cargarProyecto()` lo aceptaba con pérdida silenciosa — inconsistencia de
  veredicto entre puertas para el MISMO ataque.

  **Fix DE RAÍZ (revisión posterior a un primer intento — ver `DECISIONS.md` para
  la historia completa y la evidencia): el defecto real es el CONTENEDOR, no el
  nombre de la clave.** Cualquier objeto plano fresco construido con asignación por
  corchetes (`obj[k] = v`) es vulnerable a un accessor heredado, sea cual sea su
  nombre — la corrección ataca ESO: todo punto del núcleo que copia una clave de
  USUARIO a un objeto fresco usa `Object.defineProperty` (semántica
  `[[DefineOwnProperty]]`), NUNCA asignación por corchetes. Se auditó
  exhaustivamente con `rg` y se corrigieron TRES sitios con la MISMA causa raíz:
  `datos-planos.ts` (el hallazgo original), `ordenarClavesProfundo` (`canonico.ts`,
  RX3-04 — con el contenedor de arriba seguro, este sitio pasó de "latente, no
  explotable" a activamente alcanzable: `propiedades.__proto__` sobrevive como dato
  legítimo y SÍ llega a `canonicalizar()` en cada `guardar()` real), y
  `validarComponente` (`cargador.ts`, `pinesCopiados[clave] = valorPin` —
  encontrado en la misma auditoría, explotable de forma independiente si
  `pines.__proto__` trae un valor STRING válido). El spread (`{...x}`) y las claves
  COMPUTADAS dentro de un OBJECT LITERAL fresco (`{ ...c.pines, [payload.terminal]:
  payload.pin }`, `operaciones.ts`) usan semántica `CreateDataProperty` — nunca
  `[[Set]]` — así que son seguros por construcción, verificado empíricamente, sin
  necesitar ningún cambio.

  **Con el contenedor seguro en los tres sitios, NINGÚN nombre de clave tiene
  efecto especial — este módulo NO rechaza ninguna clave por nombre.**
  `"__proto__"`, igual que `"constructor"`/`"prototype"`/`"toString"`/
  `"hasOwnProperty"` (ninguno de estos es un accessor real de `Object.prototype`),
  sobrevive como propiedad propia normal. El rechazo de una entidad de forma
  CERRADA (raíz del documento, `Componente`/`Conexion`/`ComportamientoRegla`, el
  SOBRE de una operación) pasa a ser el MISMO `CLAVE_DESCONOCIDA` que ya rechaza
  cualquier otra clave no declarada — sin un segundo mecanismo especial por
  nombre. Una bolsa ABIERTA (`propiedades`; `pines`, que tampoco valida nombres de
  terminal) ACEPTA esas claves como dato ordinario, preservado exacto — lo que el
  contrato de "bolsa abierta" ya prometía, sin la excepción que un primer intento
  de este fix había introducido sin necesidad (ver `DECISIONS.md` para por qué esa
  primera versión se revirtió, con evidencia de mutantes y tests de round-trip).

- **RX3-02 (MAJOR)** — en la rama `else` de `crearMotorDeProyecto` (cuando
  `validarFormaProyecto` rechaza por forma), el código corría igual
  `validarProyecto`/`validarIdsYContador` sobre `deps.proyectoInicial` CRUDO —
  invocando un getter/Proxy que la materialización YA había detectado y
  rechazado, hasta 3 veces (confirmado por stack trace,
  `RX3/scripts/06b_regresion_getter_stack.mjs`). El resultado final seguía siendo
  correcto, pero el getter SÍ se ejecutaba — reintroduciendo el patrón de
  superficie que `datos-planos.ts` existe para eliminar. Fix: después de
  intentar la materialización, NUNCA se vuelve a tocar el objeto crudo. Si la
  materialización falló, sólo se devuelven sus motivos (0 invocaciones
  adicionales). Si tuvo éxito pero la forma es inválida, los chequeos
  adicionales de Gate 4 corren sobre una materialización PROPIA e INDEPENDIENTE
  (nunca sobre el crudo).

#### 6.7.1. Nota de arquitectura — materialización redundante (RX3-03, MINOR/NOTE)

Para una operación, el dato se materializa 2-3 veces (`ejecutarLote` sobre el
LOTE completo, `aplicarOperacion` sobre el SOBRE individual, `ejecutarOperacion`
una tercera vez para el eco) — el header de `datos-planos.ts` dice "UNA sola
pasada", pero en la práctica corre repetido sobre el MISMO dato ya materializado.
Esto es lo que "protegía" accidentalmente contra RX3-01 en la ruta de
operaciones ANTES del fix (la 2ª/3ª pasada rechazaba el prototipo ya corrompido
por la 1ª, con un mensaje de diagnóstico engañoso) — no es una defensa
intencional, es una casualidad de la redundancia. Con el fix de RX3-01 aplicado,
`materializarDatosPlanos` es IDEMPOTENTE sobre datos ya planos (materializar una
copia ya plana produce una copia estructuralmente idéntica), así que la
redundancia es inocua en términos de corrección — sólo un costo de CPU
evitable. Se documenta y se ACEPTA (ver `DECISIONS.md`), sin refactor: eliminar
la redundancia "porque ya se materializó antes" reduciría por sí solo la
profundidad de defensa si un futuro fix de `datos-planos.ts` tuviera un bug —
la ronda RX3 mostró que confiar en una única pasada, sin un segundo mecanismo
independiente, es exactamente el patrón que ya falló una vez.

## 7. Referencia colgada vs. tipo de catálogo desconocido (R2) — dos problemas distintos

No son el mismo tipo de problema y por eso tienen código y momento distintos:

| | Referencia colgada | Tipo/placa de catálogo desconocido |
|---|---|---|
| Qué significa | El documento apunta a un id de OTRA ENTIDAD DE LA IR (`Componente.id`) que no existe DENTRO del mismo documento | El documento apunta a un id de CATÁLOGO (`Componente.tipo`, `Proyecto.placa`) que el catálogo ACTIVO (posiblemente actualizado desde que se guardó) ya no reconoce |
| Cuándo se detecta | Al cargar (`cargador.ts`), nivel 1, sin conocer el catálogo | Al validar (`validar-tecnico.ts`), nivel 3-4, CON el catálogo activo |
| Código | `REFERENCIA_ROTA_AL_CARGAR` | `CATALOGO_COMPONENTE_DESCONOCIDO` / `PLACA_DESCONOCIDA_EN_DOCUMENTO` |
| Clasificación | RECHAZO (nunca hay `Proyecto` parcial) | REPRESENTABLE (el componente/placa SIGUE en el proyecto, nunca se borra) |
| Escenario típico | Un documento corrupto o escrito a mano mal | *Version skew*: el catálogo cambió (se sacó un componente, ej.) después de guardar el proyecto |

## 8. `catalogoHash` — algoritmo (R4, implementado en Gate 3)

`sha256(canonicalizar(catalogoSinCampoHash))`. `canonicalizar()` es la MISMA función
de `canonico.ts` (claves ordenadas, arrays preservados — igual que §3). El hash real
(`createHash("sha256")`) vive ÚNICAMENTE en
`opencode/nucleo/adaptadores/hash-catalogo.node.ts` — único import de `node:crypto`
de todo `opencode/nucleo/` (el otro import de `node:fs` autorizado, para Gate 7, es
`almacen.ts`; ningún otro archivo del núcleo debería importar ninguno de los dos).

## 9. Límites documentados (no bugs)

- `Terminal.direccion` (Gate 3) es un campo que ningún diseño anterior a la
  implementación proponía — ver `COMPONENT-CATALOG.md` §2 para el detalle.
- El orden de rama en `reemplazarSensor` (rango antes que "misma unidad = éxito") es
  una corrección sobre la redacción original del diseño — ver `COMPONENT-CATALOG.md`
  §5.
- El fsync/atomicidad de escritura en disco (Gate 7, `almacen.ts`) y las notas de
  Windows sobre `rename` se documentan en la entrada de Gate 7 de `DECISIONS.md`
  cuando ese gate se implemente — este documento (IR-SPEC) es sobre la IR en
  memoria, no sobre persistencia en disco.
- `Almacen`/`crearAlmacen()` (Gate 7) es un PUERTO INTERNO del composition root, nunca
  una segunda autoridad de escritura (Phase 1.1, hallazgo externo E3-04b — ver
  `DECISIONS.md`, entrada "Almacen es un puerto interno del composition root").
