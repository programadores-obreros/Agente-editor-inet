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
