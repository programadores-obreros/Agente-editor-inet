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
