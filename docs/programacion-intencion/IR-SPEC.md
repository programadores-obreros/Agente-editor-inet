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
  **Phase 1.2 (hallazgo externo REA-03, MAYOR — re-auditoría externa AUD-B-01):**
  `ejecutarOperacion` (mismo archivo, combina el resultado de aplicación con la
  validación post-aplicación y el eco del sobre) materializaba una SEGUNDA copia,
  INDEPENDIENTE de la que `aplicarOperacion` ya calculaba puertas adentro, sólo para
  leer `idOperacion`/`idTransaccion`/`baseRevision` para el eco — dos pasadas sobre
  el mismo objeto de entrada, nunca "la misma copia" que el párrafo de arriba
  promete. Un sobre que es un Proxy con traps `ownKeys`/`getOwnPropertyDescriptor`
  ESTATOSOS podía hacer que esas dos pasadas divergieran: el `ResultadoOperacion`
  devuelto podía ecoar `idOperacion`/`baseRevision` que NO correspondían a la
  operación que realmente se aplicó (el `Proyecto` resultante en sí no se
  corrompía). Cerrado extrayendo un núcleo interno,
  `aplicarOperacionMaterializada`, que recibe el sobre YA MATERIALIZADO y nunca
  vuelve a materializar — `aplicarOperacion` (frontera pública) y `ejecutarOperacion`
  (que además necesita esa copia para el eco) son sus DOS únicos llamadores, cada
  uno materializa UNA vez en su propia frontera. Ver `datos-planos.ts` (cabecera) y
  la fila 15 de `INVARIANTES-ENTRYPOINTS.md`.
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

### 6.8. Phase 1.1 (RX4) — forma del LOTE de operaciones: array denso de objetos no nulos

Hallazgo externo RX4-01, CRÍTICO — cuarta revisión adversarial independiente,
`RX4_REPORT.md`. `materializarDatosPlanos` (§6.6) acepta legítimamente `null` (u
otro dato plano no-objeto) tanto en la RAÍZ como en cualquier ELEMENTO de un
array — son datos JSON perfectamente legítimos, y ese módulo nunca decide si
son la forma correcta para el consumidor, sólo si son planos. Lo que faltaba
era una tercera capa de contrato, específica del LOTE de `SobreOperacion[]`
(`motor.ts::ejecutarLote`, las 3 puertas públicas del motor): el lote
materializado tiene que ser, además, un **array DENSO DE OBJETOS NO NULOS** —
esa forma se valida UNA vez, justo después de materializar y ANTES de leer
ningún campo de ningún elemento (ni siquiera `baseRevision` de la primera
operación). Dos casos distintos, dos códigos:

- El LOTE mismo no es un array (`null`/objeto/string, más allá de lo que el
  tipo `SobreOperacion[]` promete en compilación — TypeScript es sintaxis
  borrable, sin protección en runtime): `LOTE_OPERACIONES_INVALIDO`, categoría
  `motor`, `datos: { razon }`.
- Un ELEMENTO del lote (ya materializado) no es un objeto: reusa
  `SOBRE_OPERACION_INVALIDO` — MISMO código que `operaciones.ts` emite para "el
  sobre de operación no es un objeto" (categoría `operacion`), acá con
  categoría `motor` porque lo detecta esta puerta ANTES de que el elemento
  llegue a `aplicarOperacion` — mismo criterio ya establecido por
  `CLAVE_DESCONOCIDA`/`AUTOCONEXION_INVALIDA`/`UMBRAL_NO_FINITO`/
  `ENTRADA_NO_ES_DATO_PLANO`: mismo código, distinta categoría según quién lo
  emite. `datos: { indice, razon }` — el índice del primer elemento inválido.

En ambos casos, el rechazo es del LOTE ENTERO: canónico, revisión, disco y
buffer de undo quedan intactos — `resultadosOperaciones: []`, nunca "unas
operaciones sí, otras no" (mismo contrato que `BASE_REVISION_INVALIDA`,
§6.6/E3-01).

Ver también `operaciones.ts::ejecutarOperacion` (entry point público de Gate 5,
`export function ejecutarOperacion`): el ECO de `idOperacion`/`idTransaccion`/
`baseRevision` en el `ResultadoOperacion` sólo tiene sentido si el sobre
materializado es, de hecho, un objeto plano — con un sobre `null`, el eco usa
los mismos valores por defecto que cuando la materialización falla del todo
(nunca lee `.idOperacion` de un valor que podría no ser un objeto).

### 6.9. Phase 1.1 (RX4) — cota superior de `esEnteroNoNegativo`: `Number.isSafeInteger` (RECLASIFICA E1-04)

Hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial independiente,
`RX4_REPORT.md`. `esEnteroNoNegativo` (`cargador.ts`, §2/reusada por `motor.ts`
para `baseRevision`) validaba `typeof v === "number" && Number.isInteger(v) &&
v >= 0` — sin cota superior. `Number.isInteger(1e21)` es `true` en JS
(representación IEEE-754 sin parte fraccionaria a esa magnitud), así que un
documento con `"revision": 1e21` (JSON válido, ni siquiera requiere notación
exponencial) pasaba `validarFormaProyecto` sin diagnóstico. Más allá de
`Number.MAX_SAFE_INTEGER` (`2^53-1`), la aritmética de punto flotante colapsa:
`1e21 + 1 === 1e21`. El commit (`motor.ts::ejecutarLote`) calcula `canonico.
revision + 1` — con la revisión congelada en el mismo valor aparente para
siempre, y `baseRevision !== canonico.revision` siendo la ÚNICA defensa contra
escritura concurrente/perdida (E3-01 en memoria, E3-07 contra disco, brief
§33), cualquier commit posterior con el mismo `baseRevision` "viejo" sigue
pareciendo al día indefinidamente — el compare-and-swap optimista queda
neutralizado en silencio, sin ningún motivo/diagnóstico. Alcanzable con un
único documento manipulado/importado, sin necesitar ningún estado intermedio
ni ~9×10^15 commits reales — la premisa de T7/E1-04 ("no explotable en la
práctica") era incorrecta (ver `DECISIONS.md`, entrada E1-04 reclasificada).

**Fix (deriva la cota del invariante ya existente, no inventa una regla de
producto):** el INCREMENTO de `revision`/`siguienteIdLocal` tiene que seguir
siendo exacto — eso deriva directamente `Number.isSafeInteger` como cota,
aplicada en la ÚNICA definición de `esEnteroNoNegativo` (así cubre
`revision`, `siguienteIdLocal` y `baseRevision` de una sola vez, RX-06). Dos
guardas adicionales, porque acotar el DATO DE ENTRADA no alcanza por sí solo
(el límite `revision === Number.MAX_SAFE_INTEGER` es válido a la entrada, pero
`+ 1` ya no lo es):

- `motor.ts::ejecutarLote`, en el commit: si `canonico.revision + 1 >
  Number.MAX_SAFE_INTEGER` (equivalente a `!Number.isSafeInteger(canonico.
  revision + 1)`), rechaza con `REVISION_EXCEDE_ENTERO_SEGURO` (categoría
  `motor`) ANTES de tocar disco o memoria — nunca un commit con un incremento
  inexacto.
- `operaciones.ts` (`aplicarAgregarComponente`/`aplicarConectar`/
  `aplicarSetComportamiento`, alta nueva): misma guarda para
  `siguienteIdLocal + 1`, `CONTADOR_ID_EXCEDE_ENTERO_SEGURO` (categoría
  `operacion`) — "lo mismo para el contador de ids" que para `revision`.

Con ambos fixes, el reproductor original de RX4-02 ("cargar un documento con
`revision:1e21`, luego dos commits con el mismo `baseRevision`, ambos
`ok:true`") deja de reproducir en la PRIMERA puerta: ningún documento con
`revision` fuera de rango vuelve a producir un `Proyecto` cargado ni un motor
operable — no existe ningún canónico con esa revisión sobre el cual commitear
encima.

### 6.10. Phase 1.1 (RX4, NOTE) — `-0` se normaliza a `0` en `materializarDatosPlanos`

`JSON.parse("-0")` produce `-0` en memoria (`Object.is` distingue el signo),
pero `JSON.stringify(-0)` da el string `"0"` — en disco el signo SIEMPRE se
pierde. Antes de este fix, `materializarDatosPlanos` preservaba `-0` tal cual
en memoria (mismo criterio que NaN/±Infinity: "la finitud/representación la
deciden los validadores existentes"), lo que dejaba una divergencia REAL
memoria↔disco para un valor numérico — el gate de Phase 1.1 exige que no haya
divergencia memoria/disco.

A diferencia de NaN/±Infinity (que sí tienen decisiones de negocio reales
atadas — `UMBRAL_NO_FINITO`, y siguen sin normalizarse: la finitud sigue
siendo responsabilidad exclusiva de los validadores existentes), `-0` y `0`
son el MISMO valor con `===`/`>=`/cualquier comparación aritmética — no hay
dos SIGNIFICADOS distintos que la regla dura de "nunca reparar en silencio"
pudiera estar confundiendo. Normalizar `-0` a `0` en la frontera de datos
planos es, por tanto, una normalización de REPRESENTACIÓN, no de significado.

**Fix:** `materializarDatosPlanos` normaliza cualquier `-0` (raíz, valor de
propiedad, elemento de array) a `0` (`Object.is(v, -0) ? 0 : v`), en el mismo
punto que procesa cualquier `number`. Con esto, memoria/disco/canónico
coinciden siempre en `Object.is(v, 0)` — nunca `-0` sobrevive a la
materialización. No cambia ningún veredicto ni código de rechazo existente:
`-40`/`0`/NaN/±Infinity siguen exactamente igual (`-0` y `0` ya se comportaban
idéntico en toda comparación aritmética del núcleo, antes y después de este
fix — lo único que cambia es la REPRESENTACIÓN en memoria, nunca una
decisión).

### 6.11. Phase 1.2 — invariante PERSISTIBLE ⇒ RECARGABLE (hallazgo externo REA-01, CRÍTICO)

La re-auditoría externa (`PHASE_1_1_REGAUDIT_FINDINGS.md`) encontró que
`comparador` (`">" | "<" | ">=" | "<="`) y `accion` (`"encender" | "apagar"`)
son uniones LITERALES en TypeScript, pero el cast que `operaciones.ts` usa
para despachar el payload de `SetComportamiento` es sólo de compilación
("sintaxis borrable"): en runtime, un valor SINTÁCTICAMENTE válido (un
string no vacío) pero FUERA de ese dominio — `"mayorQue"`, `"prender"` —
atravesaba la operación sin ningún chequeo. Antes de Phase 1.2, el ÚNICO
lugar que conocía el dominio REAL de esos dos campos era `cargador.ts`
(Gate 2), con dos `Set` LOCALES y privados. `operaciones.ts` (Gate 5) nunca
los comprobaba — el comentario que lo justificaba (§9.1 de `OPERATIONS.md`,
antes de este fix) asumía, sin verificarlo, que "la validación
referencial/técnica existente" cubría ese caso; esa validación nunca existió
para `comparador`/`accion`.

Consecuencia observada: `SetComportamiento` con `comparador:"mayorQue"`
commiteaba `ok:true` y se persistía en disco — un documento PERSISTIBLE. Al
recargar ese MISMO documento, `cargador.ts` lo rechazaba con
`CAMPO_REQUERIDO_FALTANTE` — dejaba de ser RECARGABLE. Peor: el
compare-and-swap de `almacen.ts::guardar()` (E3-07, §10 de `OPERATIONS.md`)
necesita LEER el documento existente en disco para verificar la revisión
antes de escribir CUALQUIER commit siguiente bajo ese mismo id — si no puede
interpretarlo, todo commit posterior (aunque sea una operación normal, sin
relación con el comportamiento roto) falla con `PERSIST_FAILED`: el proyecto
entero queda inutilizable, no sólo el comportamiento inválido.

**El invariante que faltaba, nombrado explícitamente:** todo `Proyecto` que
una puerta pública del núcleo acepta persistir (`ok:true` en un commit) tiene
que pertenecer al MISMO dominio estructural que el loader acepta al
recargarlo — **PERSISTIBLE ⇒ RECARGABLE**. Es un invariante puramente
ESTRUCTURAL (forma, dominio de enums cerrados, referencias sin colgar — el
mismo nivel que `validarFormaProyecto`, Gate 2): **nunca** responde la
pregunta de readiness (`derivarReadiness`, `validar.ts`, sigue siendo el
único dueño de esa pregunta), **nunca** convierte un motivo
`clasificacion:"representable"` (warning o `blocking` representable, ej.
`PIN_OCUPADO`) en rechazo, y **nunca** exige completitud — un proyecto
incompleto (sin placa, con un `pin` en `null`) es estructuralmente
REPRESENTABLE de sobra, y sigue siendo persistible como siempre.

**Fix, en dos capas independientes (ninguna reemplaza a la otra):**

1. **Dominio normativo único** (`ir.ts::COMPARADORES`/`ACCIONES`, con los
   tipos `Comparador`/`Accion` derivados de esas constantes) — `cargador.ts`
   y `operaciones.ts` lo IMPORTAN, ninguno de los dos vuelve a declarar su
   propia lista. `aplicarSetComportamiento` (`operaciones.ts`, Gate 5)
   rechaza con `VALOR_ENUM_DESCONOCIDO` (categoría `operacion`, rechazo) ANTES
   de tocar ningún estado si `comparador`/`accion` caen fuera de ese dominio
   — mismo criterio "Camino B" que ya usa `UMBRAL_NO_FINITO` (E1-03) para
   `umbral.valor` no finito.
2. **Barrera general, en profundidad** (`motor.ts::ejecutarLote`, punto 5c
   del pipeline, ANTES de la bifurcación dry-run/commit): reutiliza
   `validarFormaProyecto` (`cargador.ts`) DIRECTO sobre el `borrador` en
   memoria — nunca un mecanismo de "guardar y volver a cargar" como chequeo
   normal. Con las 8 operaciones públicas de Fase 1, esta barrera NUNCA es
   alcanzable hoy (la capa 1 ya cierra el único gap real, ver la auditoría
   "loader-only" de Phase 1.2) — es defensa PROSPECTIVA, mismo criterio que
   `validarIdsYContador` post-lote (RX-03, §6.1) o
   `REFERENCIA_INEXISTENTE`/`AUTOCONEXION_INVALIDA` post-lote (E2-01, §6.3):
   un aplicador futuro (Fase 2+) que rompiera la disciplina de la capa 1 se
   detiene ACÁ. Rechaza con `ESTADO_NO_RECARGABLE` (categoría `motor`,
   rechazo; `datos.motivosLoader` conserva el detalle original que
   `validarFormaProyecto` produjo). `motor.proponer()` (dry-run) y
   `motor.aplicar()`/`aplicarTransaccion()` (commit) corren la MISMA barrera,
   en el MISMO punto del pipeline — **decisión Phase 1.2 sobre el dry-run:**
   un `proponer()` nunca "aprueba" un lote que `aplicar()` con el mismo lote
   rechazaría; ambos caminos de `ejecutarLote` comparten un único veredicto.

Ver `docs/programacion-intencion/OPERATIONS.md` §11 para el contrato de
Gate 5/Gate 6 completo, y la auditoría "loader-only" de Phase 1.2 (evidencia
del ciclo, fuera de este repositorio) para el recorrido completo de todo
invariante estructural del loader contra las 8 operaciones públicas —
confirmó que `comparador`/`accion` era el ÚNICO gap real de esta clase.

### 6.12. Phase 1.2 — "umbral fuera de rango" es un WARNING derivado del ESTADO, no del camino (hallazgo externo REA-02, MAYOR)

La re-auditoría externa (`PHASE_1_1_EXTERNAL_FINDINGS.md`, REA-02, origen
AUD-C-02) encontró que un `ComportamientoRegla` con la magnitud/unidad
CORRECTA para la capacidad de su sensor, pero un `umbral.valor` físicamente
imposible para ese sensor (ej. un DHT22, rango declarado `[0,60]°C`, con un
umbral de `200°C`), no tenía NINGÚN diagnóstico — `validarProyecto()` no
devolvía ningún motivo de rango y `derivarReadiness()` daba `listo:true`. El
único lugar del núcleo que sabía comparar un valor contra `Capacidad.rango`
era `reemplazarSensor` (`catalogo.ts`, rama C de §8.1 del brief), y sólo
corría en el instante de la operación `CambiarComponente` — el MISMO estado
llegado por cualquier otra puerta (`SetComportamiento` directo,
`proyectoInicial`, una recarga desde disco) no pasaba nunca por esa función,
así que el aviso dependía del CAMINO por el que el estado se alcanzó, no del
estado en sí. Evidencia:
`reaudit/AUD-C/scripts/10_rango_sensor_deuda2.mjs` (script original de
AUD-C).

**Decisión de severidad, con fuente (decisión del orquestador,
`DECISIONS.md`):** Brief §8.1, rama C de "al cambiar un sensor por otro":
"misma cantidad física pero rango incompatible: se conserva el
umbral/intención y se advierte, según el contrato de validación aplicable
(§12.1)". Brief §12.1 define `warning` como "proyecto utilizable pero
requiere atención" y fija que sólo `blocking` "impide marcarlo `ready` o
ejecutar la operación afectada". Brief l.1856: "No convertir todos los
warnings en bloqueos. Un proyecto incompleto es un estado normal de
aprendizaje" (mismo espíritu aplicado acá: un umbral fuera de rango es una
elección del estudiante que se puede seguir editando, no un error que deba
bloquear el proyecto). En consecuencia: el umbral fuera de rango es un
**WARNING DERIVADO DEL ESTADO** — no del camino — que **nunca** afecta
`derivarReadiness` (que sólo mira `severidad === "blocking"`, `validar.ts`),
**nunca** clampa el valor y **nunca** reinterpreta la intención del
estudiante.

**Fix — de CLASE, no de instancia (mismo criterio que E1-03/§6.2 arriba):**

1. **Regla compartida** (`catalogo.ts::estaFueraDeRango`) — antes de este
   fix, la comparación `valor < rango.min.valor || valor > rango.max.valor`
   vivía DUPLICADA como una closure local (`fueraDeRango`) únicamente dentro
   de `reemplazarSensor`. Se extrajo a una función exportada, con la MISMA
   semántica exacta (límite inclusivo EN LA UNIDAD NATIVA del rango de la
   capacidad: `valor === rango.min.valor` o `valor === rango.max.valor`
   nunca es "fuera de rango" cuando `valor` ya está expresado en esa unidad;
   `rango === undefined` — capacidad sin rango declarado, ej. una capacidad
   booleana pura — nunca es "fuera de rango" por ausencia de dato). **Nota de
   precisión (corregido post-freeze de Phase 1.2, hallazgo FR-01, MINOR — ver
   más abajo, después de "Equivalencia por caminos"): esta afirmación NO es
   "SIEMPRE inclusivo" sin matices — un umbral que alcanza el límite por
   CONVERSIÓN de unidad (no en la unidad nativa) puede aterrizar en un valor
   levemente distinto del límite exacto por redondeo de punto flotante, y
   entonces sí queda fuera del límite inclusivo.** `reemplazarSensor` ahora LLAMA a
   esta función en vez de declarar su propia closure — ningún cambio de
   comportamiento, sólo se elimina la duplicación (ver
   `tests/nucleo-catalogo.test.mjs`, las 4 ramas de `reemplazarSensor` siguen
   pasando sin cambios).
2. **Validación continua** (`validar-tecnico.ts`, Gate 4, el MISMO bucle que
   ya recorre `proyecto.comportamientos` para `CAPACIDAD_INEXISTENTE_EN_CATALOGO`/
   `MAGNITUD_INCOMPATIBLE`, §6.2 arriba) — cuando `propagarMagnitud` confirma
   que magnitud/unidad son compatibles (`propagacion.ok`), se llama a
   `estaFueraDeRango(propagacion.valor.valor, capacidadReal.rango)`. El
   `valor` que se compara es el YA PROPAGADO a la unidad de la capacidad — si
   el umbral llegó en una unidad distinta con conversión EXPLÍCITA declarada
   (§8.1, "conversiones entre unidades compatibles"), se compara DESPUÉS de
   convertir, nunca comparando unidades distintas directo; si no hay
   conversión declarada, el caso ya cerró antes como `MAGNITUD_INCOMPATIBLE`
   y el chequeo de rango nunca se duplica (`continue` antes de llegar acá).
   Si está fuera de rango, se agrega `UMBRAL_FUERA_DE_RANGO` (categoría
   `tecnica`, `severidad: "warning"`, `clasificacion: "representable"`) —
   nunca se toca `comportamiento.cuando.umbral`: sólo se diagnostica, mismo
   criterio que `PIN_OCUPADO`/`MAGNITUD_INCOMPATIBLE` de este mismo archivo.
   Como corre dentro de `validarTecnico`/`validarProyecto`, se ejercita
   IGUAL sin importar la puerta de entrada (operación, `proyectoInicial`,
   recarga, revalidación con otro catálogo) — exactamente lo que cierra la
   dependencia del camino que la re-auditoría encontró.

`aplicarSetComportamiento` (`operaciones.ts`, Gate 5) NO agrega ningún
rechazo ni chequeo nuevo por rango: es representable por contrato (arriba),
así que se deja pasar y `validarTecnico` lo diagnostica después de
commitear — mismo criterio que ya usa el resto de Gate 4 para
`PIN_OCUPADO`/`MAGNITUD_INCOMPATIBLE`/`CAPACIDAD_INEXISTENTE_EN_CATALOGO`.
`reemplazarSensor` (`catalogo.ts`) tampoco cambia de comportamiento: su
motivo `RANGO_INCOMPATIBLE_AL_REEMPLAZAR` sigue siendo emitido igual, como
motivo TRANSITORIO del evento puntual de la operación `CambiarComponente`
(informativo, categoría `semantica`) — coexiste con `UMBRAL_FUERA_DE_RANGO`
sin fusionarse: el primero explica "qué pasó en ESTA operación", el segundo
es el diagnóstico CONTINUO del estado resultante, el mismo que corre
siempre, sea cual sea la puerta.

**Equivalencia por caminos, probada explícitamente:** el mismo estado final
(mismo sensor, mismo umbral, mismo rango) alcanzado por 4 puertas distintas
— A) `SetComportamiento` directo, B) `proyectoInicial`
(`crearMotorDeProyecto`), C) guardar y recargar con el Almacén real, D)
`CambiarComponente` hacia un sensor cuyo rango deja el umbral afuera (rama
C) — da la MISMA clasificación (`UMBRAL_FUERA_DE_RANGO`, `warning`,
`representable`) y la MISMA `derivarReadiness()` en los 4 casos
(`tests/nucleo-rango-umbral-caminos.test.mjs`). Regresión de las 4 ramas de
§8.1 (misma magnitud/rango compatible, unidad distinta con conversión
dentro de rango, rango incompatible, capability incompatible) y de los
casos borde (límite inclusivo en `min`/`max`, rango ausente, valores
negativos) en `tests/nucleo-validacion.test.mjs`.

**Corrección post-freeze (hallazgo FR-01, MINOR, re-auditoría focal
independiente de Phase 1.2 — `FR/PHASE_1_2_FOCUSED_REAUDIT.md`, fuera de este
repositorio): el límite NO es "SIEMPRE inclusivo" sin matices — es inclusivo
en la unidad NATIVA del rango declarado.** Los párrafos de arriba (y la
suite de tests que los verifica) afirman que `estaFueraDeRango` es "límite
SIEMPRE inclusivo" — esa afirmación es un OVERCLAIM: sólo se probó (y sólo es
literalmente cierta) para el límite alcanzado en la unidad nativa de la
capacidad (Celsius directo, en el catálogo shippeado). Cuando el umbral llega
en una unidad DISTINTA con conversión explícita declarada (`propagarMagnitud`,
`valor*factor + offset`), un valor que es, físicamente, EXACTAMENTE el límite
del sensor puede aterrizar, tras la conversión, un `epsilon` de punto
flotante por encima o por debajo del límite exacto — y entonces
`estaFueraDeRango` (comparación estricta `<`/`>`) lo marca como fuera de
rango. Caso reproducido: DHT22 (rango declarado `[0,60]°C`),
`SetComportamiento` con `umbral: { valor: 140, unidad: "fahrenheit" }` — 140°F
es el límite superior EXACTO del sensor (140°F = 60°C), pero
`propagarMagnitud` calcula `140 * (5/9) + (-32*5/9) = 60.00000000000001`
(`FR/scripts/atk4_rango_umbral_caminos.mjs`, sub-caso b, salida en
`FR/salidas/atk4.txt`), así que se emite `UMBRAL_FUERA_DE_RANGO` para un
umbral físicamente válido y exactamente en el límite documentado. Es un falso
WARNING, no un falso OK: `UMBRAL_FUERA_DE_RANGO` tiene
`severidad: "warning"`, y `derivarReadiness` (`validar.ts`) sólo mira
`severidad === "blocking"` — este falso positivo NUNCA convierte un proyecto
válido en `listo:false`, no corrompe la IR, no bloquea el commit, no afecta
atomicidad y es completamente reversible. Por eso se clasificó MINOR (no
MAJOR/CRITICAL) y, por stop rule de Phase 1.2 (alcance cerrado a REA-01/02/03),
**NO se corrige en esta fase** — queda documentado como límite conocido
(remediación sugerida por el re-auditor, no aplicada: tolerancia epsilon o
redondeo a la resolución declarada de la capacidad antes de comparar, cuando
el valor proviene de una conversión). Ver `docs/programacion-intencion/DECISIONS.md`
("Hallazgos abiertos Phase 1.2") para la clasificación completa.

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
