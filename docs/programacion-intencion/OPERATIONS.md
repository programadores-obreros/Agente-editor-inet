# OPERATIONS.md — contrato de operaciones (Gate 5)

Implementación: `opencode/nucleo/operaciones.ts`. Tests:
`tests/nucleo-operaciones.test.mjs`. Se escribe ANTES del código (§25 del brief: el
contrato antes que el validador/aplicador que lo consume), siguiendo el mismo orden
que ya usaron `COMPONENT-CATALOG.md` (antes de Gate 4) e `IR-SPEC.md`.

## 1. Las operaciones son funciones PURAS

`aplicarOperacion(proyecto, operacion, catalogo)` nunca muta `proyecto` (ni ningún
objeto que cuelgue de él): siempre construye un `Proyecto` NUEVO, reusando por
REFERENCIA las entidades que la operación no tocó (no las clona). Esto es lo que hace
verificable el invariante de vista (§5): comparar `===` (no sólo `deepEqual`) las
entidades no tocadas entre el proyecto antes y después.

Sin I/O, sin catálogo mutable, sin acceso a un reloj/random propio (los ids nuevos
salen de `Proyecto.siguienteIdLocal`, ya en la IR desde Gate 2).

## 2. El sobre (`SobreOperacion`) y el resultado (`ResultadoOperacion`)

```ts
type SobreOperacion<P> = {
  readonly idOperacion: string
  readonly idTransaccion?: string        // opcional: sólo si forma parte de un lote (Gate 6)
  readonly actor: "agente" | "navegador"
  readonly baseRevision: number
  readonly tipo: TipoOperacion
  readonly payload: P
}

type ResultadoOperacion = {
  readonly ok: boolean
  readonly idOperacion: string
  readonly idTransaccion?: string
  readonly baseRevision: number
  readonly revisionActual: number
  readonly motivos: readonly Motivo[]
  readonly cambios?: Readonly<Record<string, unknown>>
}
```

**`revisionActual` en Gate 5:** siempre igual a `baseRevision`. Gate 5 no gestiona el
contador de revisión persistido — eso es del `MotorDeProyecto` (Gate 6), que envuelve
`ejecutarOperacion()`/`aplicarOperacion()` en su propia transacción y recién ahí decide
si sube la revisión. La `baseRevision` en sí NO se chequea acá tampoco (`BASE_REVISION_DESACTUALIZADA`
es motivo de `motor.ts`, no de `operaciones.ts` — T_diseno_consolidado.md §5.2, "Pipeline
único: baseRevision stale corta ANTES de clonar", que es responsabilidad del motor).

## 3. `CrearProyecto` NO pasa por este pipeline

`crearProyecto()` ya existe en `cargador.ts` (Gate 2) y construye un `Proyecto` desde
cero — no hay un `Proyecto` previo sobre el cual "aplicar" la operación. El motor
(Gate 6) la invoca DIRECTO como bootstrapping, no a través de
`aplicarOperacion`/`ejecutarOperacion`. Por eso el conjunto de operaciones de este
archivo (`TipoOperacion`) tiene 8 miembros, no 9: se excluye `CrearProyecto` del
dispatch (queda documentado acá para que no se lea como un olvido).

## 4. Conjunto de operaciones de Fase 1 (8, no 10) — Phase 3 suma `QuitarComportamiento` (9 en total)

Del conjunto de C+R1 del diseño consolidado (§6.1), Fase 1 implementa 8 operaciones de
mutación real sobre un proyecto existente. **`FijarPropiedad` (SetProperty) queda
FUERA de Fase 1** — decisión del orquestador: el punto abierto #1 del diseño
consolidado (§11, "`SetProperty` con valor de tipo correcto pero fuera de rango
declarado") no está clasificado A/B por nadie todavía, y escribir el validador de
rango sin esa clasificación sería improvisar sobre un contrato sin cerrar.

| Operación | Payload | Rechazo (Camino B) | Representable (Camino A, vía `validarProyecto` posterior) |
|---|---|---|---|
| `SetPlaca` | `{placa: string}` | `PLACA_DESCONOCIDA` si el catálogo no la reconoce | — |
| `AgregarComponente` | `{tipo: string; propiedades?: object}` | `TIPO_CATALOGO_DESCONOCIDO` si el catálogo no reconoce `tipo` | — |
| `QuitarComponente` | `{componente: string}` | `REFERENCIA_INEXISTENTE` si no existe · `REMOCION_CON_DEPENDIENTES` si tiene conexiones/comportamientos activos (sin cascada implícita) | — |
| `AsignarPin` | `{componente: string; terminal: string; pin: string \| null}` | `REFERENCIA_INEXISTENTE` (componente) · `TERMINAL_NO_DECLARADO` (terminal no existe en el catálogo del componente) · `PIN_INEXISTENTE_EN_PLACA` (el pin no existe en la placa activa) | `PIN_OCUPADO`, `CAPACIDAD_PIN_INCOMPATIBLE`, `PIN_FLASH_RESERVADO`, `PIN_STRAPPING`, `PIN_UART_USB`, `PIN_SIN_PULLUP_INTERNO` (gate final de hardening, D1/D2/D5/D7 — `COMPONENT-CATALOG.md` §6), `PIN_INEXISTENTE_EN_DOCUMENTO` (gate final de hardening, D10 — el pin asignado deja de existir en el registro de la placa VIGENTE, ej. tras un `SetPlaca` posterior o un documento editado a mano) (los detecta `validarProyecto`/`validar-tecnico.ts`, Gate 4 — la operación en sí NO los chequea, así que un pin ocupado, incompatible o restringido SE ASIGNA igual) |
| `Conectar` | `{desde: Extremo; hasta: Extremo}` | `REFERENCIA_INEXISTENTE` (componente) · `TERMINAL_NO_DECLARADO` (terminal) · `AUTOCONEXION_INVALIDA` (mismo componente+terminal en los dos extremos — decisión del orquestador: dos extremos DISTINTOS es invariante estructural) · `CONEXION_DUPLICADA` (el mismo par exacto ya está conectado, sin importar el orden de los extremos — decisión del orquestador: un par de terminales conectado a lo sumo una vez; Phase 1.1, hallazgo E2-01: ambos códigos se REUSAN también desde `validar-estructural.ts`, Gate 4, categoría `estructural`, así que el invariante corre en TODA puerta — loader, `proyectoInicial`/construcción del motor, post-commit, `validarProyecto` directo — no sólo dentro de esta operación) | — |
| `Desconectar` | `{conexion: string}` | `REFERENCIA_INEXISTENTE` si no existe | — |
| `SetComportamiento` | `{comportamiento: {id?; cuando?; entonces?}}` — Phase 3: acepta la regla PARCIAL (`IR-SPEC.md` §10); campos presentes se validan igual | `REFERENCIA_INEXISTENTE` (sensor/actuador no existen) · `CAPACIDAD_NO_DECLARADA` (la `capacidad` no está en el catálogo del sensor) · `UMBRAL_NO_FINITO` (Phase 1.1, hallazgo E1-03: `umbral.valor` no es `Number.isFinite` — NaN/±Infinity no son representables en el documento JSON persistido) | `CAPACIDAD_INEXISTENTE_EN_CATALOGO`, `MAGNITUD_INCOMPATIBLE` (Phase 1.1, hallazgo E1-03: los detecta `validarProyecto`/`validar-tecnico.ts`, Gate 4 — la operación en sí NO los chequea, así que un comportamiento con capacidad/magnitud/unidad ya incompatibles con el catálogo vigente SE ACEPTA igual, mismo criterio que `PIN_OCUPADO` de `AsignarPin`) |
| `QuitarComportamiento` | `{comportamiento: string}` (claves exactas; otra forma → `PAYLOAD_OPERACION_INVALIDO`) — Phase 3 | `REFERENCIA_INEXISTENTE` `{comportamiento}` si no existe | — (emite el info `COMPORTAMIENTO_QUITADO` `{comportamiento, reglaQuitada}`, sin `clasificacion`, ver §13) |
| `CambiarComponente` | `{componente: string; tipoNuevo: string}` | `REFERENCIA_INEXISTENTE` (componente) · `TIPO_CATALOGO_DESCONOCIDO` (tipoNuevo no existe) | `RANGO_INCOMPATIBLE_AL_REEMPLAZAR`, `CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR`, `UNIDAD_CONVERTIDA` (vía `reemplazarSensor`, Gate 3 — la operación SIEMPRE commitea si `tipoNuevo` existe; lo que cambia por rama es qué motivo deja) |

Dos códigos son NUEVOS en este documento (no estaban en la tabla de Gate 3/`COMPONENT-CATALOG.md`,
porque resuelven los dos puntos que el diseño consolidado dejaba explícitamente
abiertos en su §9, y que el orquestador cerró antes de este gate):

- `AUTOCONEXION_INVALIDA` — categoría `operacion`, rechazo (Phase 1.1: también
  emitido, categoría `estructural`, por `validar-estructural.ts` — ver más abajo).
- `CONEXION_DUPLICADA` — categoría `operacion`, rechazo (Phase 1.1: ídem).
- `CAPACIDAD_NO_DECLARADA` — categoría `operacion`, rechazo (el "TERMINAL_NO_DECLARADO
  equivalente para capacidad" que el diseño consolidado pedía sin darle nombre final).

Phase 1.1 (remediación del hallazgo externo E1-03, CRÍTICO — `validar-tecnico.ts`
nunca miraba `proyecto.comportamientos`, y `aplicarSetComportamiento` aceptaba un
`umbral.valor` NaN/±Infinity, ver `IR-SPEC.md` §6.2 para el detalle completo) agrega:

- `UMBRAL_NO_FINITO` — categoría `operacion` en `aplicarSetComportamiento` (rechazo,
  ANTES de construir el estado nuevo), categoría `estructural` en
  `validar-estructural.ts` (rechazo, Gate 4, defensa en profundidad para
  `proyectoInicial`/cualquier `Proyecto` que bypasee la operación). Mismo código, dos
  categorías según quién lo emite — no dos reglas distintas.
- `CAPACIDAD_INEXISTENTE_EN_CATALOGO` — categoría `tecnica`, **representable**
  (`validar-tecnico.ts`, Gate 4): la `capacidad` de un comportamiento ya no existe
  para el `tipo` del sensor en el catálogo VIGENTE (distinto de `CAPACIDAD_NO_
  DECLARADA` de arriba, que rechaza en el momento de la operación misma con el
  payload recibido — este código cubre "el catálogo cambió DESPUÉS", diagnosticado
  sin importar la puerta de entrada, incluida la revalidación).
- `MAGNITUD_INCOMPATIBLE` — código YA existente (`catalogo.ts`, `propagarMagnitud`,
  categoría `semantica`, representable), REUSADO desde `validar-tecnico.ts` para
  diagnosticar de forma continua que `umbral.magnitud`/`unidad` no coinciden con la
  capacidad real del sensor vigente (no sólo "al reemplazar" un sensor).

Phase 1.1 (remediación del hallazgo externo E2-01, CRÍTICO — "sin auto-conexión /
sin conexión duplicada" nunca era un invariante real de la IR, sólo un chequeo ad-hoc
dentro de esta misma operación; ver `IR-SPEC.md` §6.3 para el detalle completo)
agrega:

- `AUTOCONEXION_INVALIDA_AL_CARGAR`/`CONEXION_DUPLICADA_AL_CARGAR` — NUEVOS,
  categoría `estructural`, rechazo siempre, `cargador.ts` (Gate 2, momento de carga).
- `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA` — códigos YA existentes de esta tabla,
  ahora TAMBIÉN emitidos por `validar-estructural.ts` (Gate 4, SIN catálogo, corre
  dentro de `validarProyecto`) con categoría `estructural` en vez de `operacion` —
  mismo código, dos categorías según quién lo emite, mismo criterio que
  `UMBRAL_NO_FINITO`. Cierra la construcción del motor sobre `proyectoInicial` y la
  revalidación post-commit sin cambios propios en `motor.ts` (`validarProyecto` ya
  corre ahí).
- UNA sola implementación (`conexion.ts`: `esAutoconexion`, `mismaConexion`,
  `analizarConexionesInvalidas`), reusada por las tres puertas de arriba — la
  defensa temprana de esta operación se reescribió para usar las mismas funciones en
  vez de una copia local (`mismoPar`, eliminada), sin cambio de comportamiento.

## 5. Invariante de vista (punto abierto #3 de `DECISIONS.md`, cerrado acá)

**Una operación cambia SÓLO su entidad destino y los efectos derivados que las reglas
exigen.** Test explícito: fixture con 2+ componentes NO relacionados por ninguna
conexión/comportamiento; se aplica una operación sobre UNO; se verifica que el OTRO
es `===` (misma referencia, no sólo `deepEqual`) entre el proyecto antes y después. La
única operación con "efectos derivados" reales en Fase 1 es `CambiarComponente`
(reescribe los `comportamientos[]` que referencian al componente cambiado, vía
`reemplazarSensor`) — ahí el test verifica que sólo esos comportamientos cambian, y
CUALQUIER otro componente/conexión/comportamiento no relacionado sigue siendo la
MISMA referencia.

### 5.1. Ampliación Phase 1.1 (hallazgo externo E4-03)

Antes de Phase 1.1 este invariante sólo tenía test explícito para `AsignarPin` y
`CambiarComponente` — las otras 6 operaciones (`SetPlaca`/`AgregarComponente`/
`QuitarComponente`/`Conectar`/`Desconectar`/`SetComportamiento`) comparten el MISMO
contrato (todas están escritas con `.map`/`.filter`/spread que reusan por referencia
lo no tocado, nunca `structuredClone` de todo el árbol) pero no tenían regresión
propia por operación. `tests/nucleo-operaciones.test.mjs` agrega un test por
operación (mismo patrón: fixture con una entidad no relacionada, `===` entre
antes/después) — sin cambiar código de producción, porque las 8 ya cumplían el
invariante; esto es cobertura, no un fix. Confirmado con mutante ad-hoc sobre copia
temporal: `aplicarDesconectar` clonando cada conexión sobreviviente
(`.filter(...).map((cx)=>({...cx}))`) mata el test de `Desconectar` (el `m4` de la
auditoría externa); un segundo mutante sobre `aplicarSetComportamiento` (rama de alta
nueva, clonando cada comportamiento previo) mata el test de `SetComportamiento` —
evidencia en `evidencia/T7/E4-03_mutante_*.txt` de Phase 1.1.

## 6. Resultados representables NO se rechazan a nivel de operación

Un motivo `clasificacion: "representable"` NUNCA corta la operación — el ejemplo
canónico es `AsignarPin` sobre un pin ya ocupado: la operación **commitea**, el
`Proyecto` resultante queda `invalido:true` (Gate 4), y el motivo `PIN_OCUPADO`
viaja en `motivos[]`. Sólo `clasificacion: "rechazo"` corta antes de mutar — y en ese
caso el `Proyecto` devuelto es el ORIGINAL sin tocar (misma referencia), nunca un
objeto parcialmente mutado.

## 7. `ejecutarOperacion` — la pieza que combina rechazo + representable

`aplicarOperacion` sólo corre los chequeos RECHAZO propios de cada operación (tabla
§4, columna "Rechazo"). `ejecutarOperacion` (mismo archivo) es la envoltura que:

1. corre `aplicarOperacion`;
2. si algún motivo devuelto tiene `clasificacion: "rechazo"` → devuelve
   `{ok:false, proyecto original, motivos}` sin llamar a `validarProyecto`;
3. si no hay rechazo → corre `validarProyecto(proyectoNuevo, catalogo)` (Gate 4);
4. **si ESA validación post-aplicación TAMBIÉN trae un motivo `clasificacion:
   "rechazo"`** (revisión de arquitectura Gate 8, §77 — hoy sólo
   `validar-estructural.ts` puede emitir uno así) → devuelve `{ok:false, proyecto
   ORIGINAL (nunca el aplicado), motivos combinados}`, IGUAL que un rechazo de la
   operación misma;
5. si no hay rechazo en ningún punto → agrega esos motivos (los
   representables/técnicos/estructurales/semánticos del ESTADO RESULTANTE) a los
   propios de la operación, devuelve `{ok:true, proyecto nuevo, motivos
   combinados}`.

Es el punto de composición que el `MotorDeProyecto` (Gate 6) va a envolver con
revisión + persistencia — no reimplementa nada de eso, sólo junta "¿la operación en sí
es válida?" con "¿el estado resultante es válido?", que son dos preguntas distintas
(la primera decide si se aplica; la segunda decide si el resultado queda `invalido`).

**Nota (hallazgo adversarial Gate 8, item 4 + revisión de arquitectura Gate 8, §77):**
el motor (`motor.ts`) NO reusa `ejecutarOperacion` tal cual — implementa su propio
pipeline equivalente (`aplicarOperacion` por operación + `validarProyecto` una vez
por lote), porque necesita acumular motivos de VARIAS operaciones antes de decidir
si el lote entero commitea. Esa duplicación de estructura (dos lugares que combinan
"rechazo de operación" + "validación del estado resultante") es exactamente donde
aparecieron DOS bugs de la misma clase: primero en `motor.ts` (corregido, ver §8),
y después la revisión de arquitectura de Gate 8 encontró que `ejecutarOperacion`
tenía el MISMO gap — devolvía `ok:true` sin revisar `clasificacion:"rechazo"` en la
validación post-aplicación. Corregido acá también (paso 4 de la lista de arriba):
ahora los dos puntos de composición (`motor.ts` y `ejecutarOperacion`) aplican la
MISMA regla de forma independiente — no porque uno reuse al otro, sino porque cada
uno la implementa correctamente por su cuenta.

## 8. Contrato de construcción del motor (`crearMotorDeProyecto`) — hallazgo adversarial Gate 8

El motor (Gate 6, `motor.ts`) es quien realmente aplica esta regla en dos puntos:

1. **Al construirse**: `crearMotorDeProyecto(deps)` corre `validarProyecto(deps.proyectoInicial, deps.catalogo)`
   una vez. Si algún motivo devuelto tiene `clasificacion:"rechazo"`, el factory
   **lanza** `ErrorEstadoInicialInvalido` (con `.motivos` estructurado, nunca una
   excepción cruda sin datos) en vez de devolver un motor "operable". Motivo: un
   consumidor que bypasea `cargarProyecto()` (que sí rechazaría un documento roto
   con `REFERENCIA_ROTA_AL_CARGAR`) y empuja un `Proyecto` ya inconsistente directo
   como `proyectoInicial` no debe poder obtener un motor que después commitee esa
   rotura en la primera transacción trivial.
2. **En cada commit** (defensa en profundidad): después de aplicar el lote entero y
   correr `validarProyecto(borrador, catalogo)`, si CUALQUIERA de esos motivos trae
   `clasificacion:"rechazo"` (hoy sólo `validar-estructural.ts` puede emitir uno así,
   `REFERENCIA_INEXISTENTE` — `validar-tecnico.ts` nunca usa esa clasificación), el
   lote entero se descarta: sin persistencia, sin subir la revisión, canónico
   idéntico. Antes de este fix, el motor sólo miraba los motivos por-operación
   (`aplicarOperacion`) y dejaba pasar cualquier rechazo que apareciera recién en la
   validación post-lote.

No explotable hoy por las 8 operaciones públicas de este documento (todas re-chequean
existencia de referencias antes de mutar), pero sí si el estado inicial llega roto
por fuera del loader, o si una regla de validación futura gana esa clasificación de
forma alcanzable. Ambos puntos usan la MISMA función `validarProyecto` (inyectable
sólo para tests, nunca en producción) — ver `DECISIONS.md`, entrada "hallazgo
adversarial Gate 8".

## 9. Phase 1.1 — validación de FORMA en runtime (hallazgos externos E2-02/E2-03/E3-01/E3-05)

`PHASE_1_EXTERNAL_FINDINGS.md` (auditoría externa) encontró que ni el sobre
(`SobreOperacion`) ni `baseRevision` tenían ninguna validación de FORMA en runtime
antes de Phase 1.1 — los `as {...}` de `operaciones.ts` y el `??` de `motor.ts` son
sólo de compilación (TypeScript, "sintaxis borrable"): cualquier JSON crudo (agente
LLM, futuro transporte HTTP, brief §37) llega tal cual. Esta sección documenta el
contrato que cierra ambos hallazgos.

### 9.1. Forma del sobre y del payload (`aplicarOperacion`, hallazgo E2-02, CRÍTICO)

Antes del switch/dispatch, `aplicarOperacion` corre dos validaciones de forma, en
este orden, ambas ANTES de tocar `proyecto` (nunca lo mutan, nunca corren
`validarProyecto`):

1. **Forma del sobre** (`idOperacion`/`idTransaccion`/`actor`/`tipo` — NUNCA
   `baseRevision`, que sigue siendo exclusivamente responsabilidad de `motor.ts`,
   §2 de arriba):
   - `idOperacion` ausente o no es un string no vacío → `SOBRE_OPERACION_INVALIDO`.
   - `idTransaccion`, si está presente, no es un string no vacío →
     `SOBRE_OPERACION_INVALIDO`.
   - `actor` ausente o no es `"agente"`/`"navegador"` → `SOBRE_OPERACION_INVALIDO`.
   - `tipo` ausente o no es uno de los 8 tipos válidos de §4 →
     `TIPO_OPERACION_DESCONOCIDO`.
   - Una clave EXTRA desconocida en el sobre (ej. `extraField`) →
     `CLAVE_DESCONOCIDA` (hallazgo E2-03, MENOR — ver 9.2 más abajo).
2. **Forma del payload** (por `tipo`, sólo lo mínimo para que el `aplicarXxx`
   correspondiente no explote leyendo una propiedad de `null`/`undefined`/un array —
   NUNCA valida referencias contra `proyecto`/`catalogo`, eso lo sigue haciendo cada
   `aplicarXxx`; NUNCA valores de enum sintácticamente válidos pero inventados —
   `comparador`/`accion`/`pin` con un string no vacío que no es un valor real sigue
   siendo responsabilidad de la validación referencial/técnica existente, no de
   acá): payload no es un objeto (o es `null`/`undefined`/un array) para un tipo que
   espera objeto, o falta un campo requerido, o un campo requerido tiene el tipo
   incorrecto → `PAYLOAD_OPERACION_INVALIDO` (`datos.razon` describe la forma
   esperada).

Un string VACÍO **dentro** de `payload` (`componente: ""`, `terminal: ""`, etc.) NO
es "forma inválida" — sigue siendo el mismo `REFERENCIA_INEXISTENTE`/
`TERMINAL_NO_DECLARADO`/`PLACA_DESCONOCIDA` de siempre (el resto del pipeline ya lo
diagnostica bien, sin explotar); exigir no-vacío ahí sería sobre-rechazar. La
exigencia de "no vacío" es sólo para `idOperacion`/`idTransaccion` del SOBRE, donde
no hay ninguna otra defensa aguas abajo.

El `switch` de `aplicarOperacion` también suma un `default` de defensa en
profundidad (mismo criterio que E1-03/E2-01): nunca alcanzable hoy (la validación
del sobre ya rechazó cualquier `tipo` desconocido antes), pero si una regla futura
agranda `TipoOperacion` sin agregar su rama, sigue devolviendo `Motivo` estructurado
en vez de `undefined`.

Estas dos validaciones corren para las 3 puertas públicas del motor
(`proponer`/`aplicar`/`aplicarTransaccion`, que invocan `aplicarOperacion` una vez
por operación dentro del lote) y para quien invoque `aplicarOperacion`/
`ejecutarOperacion` directo — un único punto de aplicación, nunca copiado.

### 9.1.1. Phase 1.1 (RX) — un getter que explota durante la lectura de forma (hallazgo externo RX-02, CRÍTICO, reabre E2-02)

Las dos validaciones de arriba (`analizarSobreOperacion`/`validarFormaPayload`) LEEN
campos del sobre/payload que el LLAMADOR controla — el fix original de E2-02 sólo
contempló "JSON crudo" (nunca produce getters), no "cualquier valor JS que un
llamador en proceso pueda construir" (un adaptador futuro, un wrapper de test, un
ORM con propiedades lazy). Un getter que lanza en `actor`, `payload.placa`,
`payload.comportamiento.cuando.umbral.valor`, etc. propagaba una excepción cruda a
través de `aplicarOperacion` y de las 3 puertas públicas del motor — el mismo
síntoma que E2-02, por una lectura distinta.

**Fix original (RX-02, superado por RX2 — ver §9.7):** la lectura de FORMA se
envolvía en un único `try/catch` dentro de `aplicarOperacion`, convirtiendo
cualquier excepción en `EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA`. Una segunda
revisión adversarial (RX2-01) encontró que ese `try/catch` protegía la PRIMERA
lectura de `operacion.payload` (dentro de la validación de forma) pero el `switch`
de despacho, DEBAJO de ese `try/catch`, volvía a leer `operacion.payload` SIN
proteger — un getter válido en la 1ª lectura que lanza en la 2ª atravesaba igual.
Este código (`EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA`) ya no se emite — ver
§9.7 para el mecanismo que lo reemplaza.

### 9.1.2. Phase 1.1 (RX2) — el eco de `leerSeguro` reemplazado por la copia materializada

Antes, `ejecutarOperacion` (Gate 5) y `ejecutarLote` (`motor.ts`, Gate 6) leían los
campos del sobre que ecoan en el resultado (`idOperacion`/`idTransaccion`/
`baseRevision`) con un helper `leerSeguro` (`try/catch` puntual) que nunca
propagaba. Con la materialización de §9.7, esos campos se leen sobre la copia YA
plana (§9.7) — una lectura que, por construcción, no puede lanzar — así que
`leerSeguro` se eliminó (dos mecanismos protegiendo la misma lectura hubiera sido
una redundancia que compite, no defensa en profundidad real).

### 9.2. Clave extra desconocida en el sobre (hallazgo E2-03, MENOR)

El sobre rechaza fail-closed una clave extra desconocida (ej. `{..., extraField:
"sorpresa"}`) con `CLAVE_DESCONOCIDA` — el MISMO código que ya usa `cargarProyecto()`
(`cargador.ts`, Gate 2) para un documento con claves desconocidas, categoría
`operacion` acá en vez de `estructural` (mismo criterio ya establecido en este
documento para `AUTOCONEXION_INVALIDA`/`UMBRAL_NO_FINITO`: mismo código, dos
categorías según quién lo emite). Cierra la inconsistencia de filosofía fail-closed
entre las dos puertas de entrada del núcleo (antes, el sobre aceptaba cualquier
campo extra en silencio) sin inventar un código nuevo para lo mismo.

### 9.3. `baseRevision` inválido vs. desactualizado (hallazgo E3-01, CRÍTICO)

`motor.ts` exige que la **primera** operación de un lote NO VACÍO traiga un
`baseRevision` que sea un **entero no negativo** (`Number.isInteger(v) && v >= 0` —
`0` es un valor perfectamente válido, la revisión inicial real, NUNCA "falsy"/
"ausente"). Si no lo es (`null`, campo ausente, string, `NaN`, `±Infinity`,
negativo, no entero), la transacción entera rechaza con `BASE_REVISION_INVALIDA`
(categoría `motor`) **antes de clonar** — este código es DISTINTO de
`BASE_REVISION_DESACTUALIZADA` (§1 de arriba): el primero significa "el sobre no
trae un dato válido", el segundo "el dato es válido pero ya no coincide con lo
vigente" — nunca se confunden ni se fusionan en el mismo código, y `baseRevision`
inválido NUNCA se sustituye silenciosamente por la revisión actual (ese era el bug:
`operaciones[0]?.baseRevision ?? canonico.revision` trataba "sin dato" como "usá la
revisión de ahora", auto-satisfaciendo siempre el chequeo de stale write).

**Operaciones 2..n de un lote:** el contrato de `motor.ts` sólo contrasta el
`baseRevision` de la PRIMERA operación contra el canónico (§1 de arriba, "Pipeline
de `aplicarTransaccion`" — una sola `baseRevision` por transacción, no una por
operación). El `baseRevision` de las operaciones 2..n viaja en el sobre pero el
motor nunca lo compara ni lo valida — esto es intencional (no un descuido de Phase
1.1) y está testeado explícitamente en `tests/nucleo-motor.test.mjs`.

### 9.4. Lote vacío (hallazgo E3-05, MENOR, misma raíz que E3-01)

`aplicarTransaccion([])`/`proponer([])` (cero operaciones) es un **no-op explícito**:
`ok:true`, sin motivos, `revisionActual` igual a la revisión vigente (nunca sube),
sin llamar a `almacen.guardar`, sin agregar al buffer de undo. Este chequeo corre
ANTES de mirar `baseRevision` (que no tiene sentido sin una primera operación) —
separado a propósito del de 9.3, para no confundir "no hay primera operación" con
"la primera operación trae un dato inválido" (la misma confusión, con el mismo `??`,
producía tanto E3-01 como E3-05).

Ni este documento ni `IR-SPEC.md` determinan si un lote vacío debe ser rechazo o
no-op — ambas opciones son defendibles y ninguna arriesga datos (ninguna persiste ni
sube revisión). Phase 1.1 elige el no-op exitoso porque es la lectura más simple de
"pedí cero cambios, no pasó nada" y evita inventar un código de rechazo para un caso
que no es realmente un error del llamador.

### 9.5. El eco de `baseRevision` en el rechazo nunca fabrica un valor (hallazgo CP-02, MENOR)

Cuando `BASE_REVISION_INVALIDA` (§9.3) rechaza la transacción, el `ResultadoTransaccion.
baseRevision` **ecoa la revisión CANÓNICA vigente** (el mismo valor que
`revisionActual` en ese resultado) — nunca `Number.NaN`. El dato crudo e inválido que
mandó el cliente sigue viajando íntegro en `motivos[0].datos.baseRevisionRecibida`
(§9.3): el campo `baseRevision` del resultado es sólo un ECO de correlación para quien
lo lee, nunca la única fuente del dato original, así que no se pierde información al
dejar de fabricar `NaN`. `ResultadoTransaccion.baseRevision` sigue siendo `number` (§2)
— Phase 1.1 no lo amplía a `number | null` para no propagar `null` a un campo que el
resto del contrato trata como un número real, y porque el criterio de "no hay un
`baseRevision` real que ecoar" ya está establecido en §9.4 (lote vacío): ecoar la
revisión canónica vigente, igual que acá.

## 9.6. Phase 1.1 (RX) — `SetComportamiento` avisa cuando reemplaza (hallazgo externo RX-04, MENOR)

`aplicarSetComportamiento` decide "reemplazo (upsert) vs. alta nueva" mirando si
`payload.comportamiento.id` YA existe en `proyecto.comportamientos` en el momento en
que esa operación corre. Antes de este fix, el reemplazo commiteaba con
`motivos:[]` — sin ningún rastro de que la intención ANTERIOR con ese id fue
descartada (brief §12: "reasons[]... también documenta decisiones deterministas
exitosas"). Se agrega `COMPORTAMIENTO_REEMPLAZADO` (categoría `operacion`, severidad
`info`, sin `clasificacion` — es puramente informativo, nunca corta la operación):
mismo patrón YA establecido en el núcleo para una decisión determinista que SÍ
cambia algo silenciosamente (`UNIDAD_CONVERTIDA`, `catalogo.ts`, reusado también
dentro de `aplicarCambiarComponente`, Gate 5). La semántica upsert de
`SetComportamiento` NO cambia: sigue commiteando igual, `ok:true`; sólo se agrega el
motivo informativo.

**Límite conocido, no resuelto acá:** si dos operaciones `SetComportamiento` del
MISMO lote usan explícitamente el MISMO `id` (ej. adivinando el valor que el
contador va a asignar), la primera crea un comportamiento nuevo con ese id, y la
segunda — viéndolo YA existente en el borrador intermedio — lo trata como reemplazo
y sobreescribe la primera intención por completo, con `COMPORTAMIENTO_REEMPLAZADO`
en los motivos de la SEGUNDA operación pero sin ningún rastro adicional de que la
PRIMERA intención (dentro del mismo lote) fue la que se perdió. Esto requiere que el
llamador reutilice deliberadamente el mismo id explícito para dos intenciones
distintas — no corrompe la IR canónica, no rompe atomicidad ni bypassea
`baseRevision`. Registrado como deuda diferida en `DECISIONS.md` (no se inventa un
mecanismo de detección de "reemplazo intra-lote" sin evidencia de que haga falta).

## 9.7. Phase 1.1 (RX2) — el sobre se materializa en datos planos ANTES de despachar (hallazgos externos RX2-01/RX2-02, CRÍTICOS)

Una segunda revisión adversarial independiente (RX2) reabrió E2-02/RX-02 por un
ángulo que el `try/catch` puntual de §9.1.1 no cubría: `aplicarOperacion`
(`operaciones.ts`) leía `operacion.payload` DOS veces — la validación de forma
(protegida) y el `switch` de despacho, más abajo (sin proteger) — un getter válido
en la 1ª lectura que lanza en la 2ª (TOCTOU) atravesaba igual, crudo, por las 5
puertas que despachan operaciones (`aplicarOperacion`/`ejecutarOperacion` directos,
`motor.aplicar`/`aplicarTransaccion`/`proponer`). Relacionado (RX2-02):
`payload.propiedades` (la bolsa abierta de `AgregarComponente`, nunca validada en
forma — §1 de `IR-SPEC.md`) se incrustaba SIN copiar en el borrador; `congelarProfundo`
(`canonico.ts`, usado por `motor.ts` en cada commit/dry-run) recorre `Object.values()`
de cualquier objeto anidado, disparando el trap `get` de un Proxy que nunca antes
había sido protegido.

**Fix:** `aplicarOperacion` materializa el sobre COMPLETO (envoltorio + payload
anidado) en datos planos, UNA sola vez, con `opencode/nucleo/datos-planos.ts`
(`materializarDatosPlanos` — ver `IR-SPEC.md` §6.6 para el mecanismo completo),
ANTES de `analizarSobreOperacion`/`validarFormaPayload` y del `switch` de despacho
— los tres trabajan sobre la MISMA copia, así que no existe una "segunda lectura"
que pueda divergir de la primera. Un rechazo se envuelve con
`ENTRADA_NO_ES_DATO_PLANO` (categoría `operacion`) — el código
`EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA` de §9.1.1 ya no se emite: quedó
subsumido por un mecanismo que cierra la clase completa, no la instancia puntual
que RX-02 había parchado. `motor.ts` (`ejecutarLote`, Gate 6) materializa ADEMÁS
el LOTE COMPLETO de operaciones antes de leer siquiera el `baseRevision` de la
primera (categoría `motor`) — una superficie que ni RX-01 ni RX-02 habían tocado:
un getter en el propio `baseRevision` del sobre crasheaba ahí, antes incluso de
llegar a `aplicarOperacion`.

## 9.8. Phase 1.1 (RX4) — la FORMA DEL LOTE (array denso de objetos no nulos), no sólo la forma de cada sobre (hallazgo externo RX4-01, CRÍTICO)

Una cuarta revisión adversarial independiente (RX4) encontró que materializar el
lote (§9.7) sólo garantiza "es un dato plano" — `materializarDatosPlanos` acepta
legítimamente `null` (u otro dato plano no-objeto) tanto en la RAÍZ como en
cualquier ELEMENTO de un array, porque `null` es JSON perfectamente legítimo y
ese módulo no decide FORMA, sólo planitud. `ejecutarLote` (`motor.ts`) leía el
lote ya materializado asumiendo sin verificar que era un array denso de
objetos: `operaciones[0]!.baseRevision` (antes de clonar) y
`operacion.idOperacion`/`.idTransaccion`/`.baseRevision` (el eco dentro del
loop de aplicadores) explotaban con un `TypeError` crudo ante
`motor.aplicar(null)`/`aplicarTransaccion([null])`/`proponer([null])`, o ante
`aplicarTransaccion([opVálida, null])` (el crash ocurría DESPUÉS de que
`aplicarOperacion` ya había clasificado ese mismo elemento `null`
correctamente). Un lote que en sí mismo no es un array (`null`/objeto/string)
también crasheaba, por la misma razón.

**Fix:** justo después de materializar y ANTES de leer cualquier campo de
cualquier elemento, `ejecutarLote` valida que el lote sea un array
(`LOTE_OPERACIONES_INVALIDO`, categoría `motor`, si no lo es) y que CADA
elemento sea un objeto plano no nulo (reusa `SOBRE_OPERACION_INVALIDO`,
categoría `motor` — mismo código que `operaciones.ts` emite para "el sobre no
es un objeto", detectado acá una capa más arriba). Rechazo del LOTE ENTERO en
ambos casos — `resultadosOperaciones: []`, canónico/revisión/disco/undo
intactos. Ver `IR-SPEC.md` §6.8 para el detalle completo, incluida la
corrección paralela en `ejecutarOperacion` (el ECO del sobre no lee un campo de
un valor que podría no ser un objeto).

## 9.9. Phase 1.1 (RX4) — `revision`/`baseRevision`/`siguienteIdLocal` acotados a `Number.isSafeInteger` (hallazgo externo RX4-02, CRÍTICO, RECLASIFICA E1-04)

`esEnteroNoNegativo` (§9.3, reusada por `baseRevision` acá y por `revision`/
`siguienteIdLocal` en `cargador.ts`) no tenía cota superior — un `baseRevision`
o una `revision` de `1e21` pasaban sin diagnóstico, y más allá de
`Number.MAX_SAFE_INTEGER` el incremento (`+1`) deja de ser exacto
(`revision + 1 === revision`), neutralizando en silencio el compare-and-swap
optimista de §9.3/E3-01 que este mismo documento describe. **Fix:**
`esEnteroNoNegativo` usa `Number.isSafeInteger` — un `baseRevision` de `1e21`
rechaza con `BASE_REVISION_INVALIDA` (mismo código de §9.3, ahora con una cota
más estricta), igual que cualquier otro entero fuera de rango. Además, el
commit se niega a producir un incremento que ya no sea exacto
(`REVISION_EXCEDE_ENTERO_SEGURO`) y la generación de id local se niega
igual (`CONTADOR_ID_EXCEDE_ENTERO_SEGURO`) — ver `IR-SPEC.md` §6.9 para el
detalle completo, incluida la reclasificación de E1-04 (`DECISIONS.md`).

## 10. Colisión de escritura entre motores que comparten almacén (hallazgo E3-07, MAJOR — resolución humana Phase 1.1, brief §21)

`baseRevision` (§9.3) sólo protege contra un lost update DENTRO de un mismo motor:
compara contra SU PROPIO canónico en memoria. Dos motores separados construidos sobre
el MISMO `Almacen` y el MISMO id de proyecto (cada uno con su propio canónico en
memoria, ninguno viendo al otro) podían commitear cada uno su propia revisión 1, y el
segundo `guardar()` pisaba en disco al primero sin ningún diagnóstico — el
`baseRevision` de cada motor "coincidía" perfectamente con SU PROPIO estado, porque
nunca miraba el almacén compartido.

**Fix (Gate 7, `almacen.ts::guardar()`): compare-and-swap sobre la REVISIÓN, nunca un
lock.** El motor siempre commitea N → N+1 (`motor.ts`, `ejecutarLote`): antes de
escribir, si YA existe un documento en disco bajo ese id, `guardar()` lo lee y exige
que su `revision` sea EXACTAMENTE `proyecto.revision - 1` — el estado que el llamador
cree que acaba de reemplazar. Si no coincide, rechaza con
`CONFLICTO_REVISION_EN_ALMACEN` (categoría `almacen`, `clasificacion:"rechazo"`
siempre) — el motor invocante lo recibe por el Path de persistence failure YA
existente (igual que `PERSIST_FAILED`): canónico, revisión, buffer de undo y disco
previo quedan intactos, `ResultadoTransaccion` estructurado. Excepción: un
re-guardado CANÓNICAMENTE IDÉNTICO al que ya está en disco se permite igual (no hay
pérdida posible — es la idempotencia de "guardar lo recién cargado sin tocar nada",
ya cubierta antes de este hallazgo).

Si el documento existente en disco es ilegible/corrupto al momento de este chequeo,
`guardar()` falla cerrado (`PERSIST_FAILED`, nunca sobrescribe a ciegas).

**Límite conocido, deliberado (no un descuido):** la detección es por REVISIÓN, no
por contenido. Si dos documentos DISTINTOS terminaran coincidiendo en la MISMA
revisión de forma exacta (`canonicalizar()` idéntico), esto no tiene forma de
distinguirlos de un re-guardado idempotente — caso sin evidencia real y sin pérdida de
datos posible (dos documentos exactamente iguales no pueden "perderse" entre sí). Este
fix NO reabre `Almacen.list()` ni una detección GENERAL de modificación externa
(`DECISIONS.md`, Gate 1/Gate 7): el alcance es estrictamente la colisión de escritura
por id, sin base de datos, sin locks distribuidos, sin fusión automática de escrituras
concurrentes, sin servidor.

### 10.1. `cargar(id)` verifica que el documento sea el que se pidió (hallazgo E3-08, barato)

`almacen.cargar(id)` leía el archivo `<id>.json` y confiaba en que su campo
`Proyecto.id` interno coincidiera con el `id` pedido, sin verificarlo — un documento
mal escrito a mano, o movido/copiado a la ruta equivocada, cargaba igual bajo una
identidad que no era la suya. Ahora `cargar()` rechaza con
`ID_DOCUMENTO_NO_COINCIDE` (categoría `almacen`, `clasificacion:"rechazo"`) si
`proyecto.id !== id`, ANTES de devolver el documento — mismo criterio fail-closed que
el resto de Gate 7 (nunca reparar en silencio, nunca devolver un documento con una
identidad que no es la pedida). Distinto en alcance de E3-07 (que protege la
ESCRITURA): esto es una verificación de integridad sobre la LECTURA, del mismo
almacén, independiente de si hay o no otro escritor concurrente.

## 11. Phase 1.2 — invariante PERSISTIBLE ⇒ RECARGABLE (hallazgo externo REA-01, CRÍTICO)

§9.1 de arriba dice, para la forma del payload, que un valor de enum
"sintácticamente válido pero inventado" (`comparador`/`accion`/`pin` con un
string no vacío que no es un valor real) "sigue siendo responsabilidad de la
validación referencial/técnica existente, no de acá" (es decir, no de
`validarFormaPayload`). La re-auditoría externa (`PHASE_1_1_REGAUDIT_FINDINGS.md`,
REA-01, CRÍTICO) encontró que, para `comparador`/`accion` específicamente,
**esa validación referencial/técnica nunca existió** — `aplicarSetComportamiento`
(Gate 5) commiteaba `ok:true` con un `comparador`/`accion` inventado, y recién
`cargador.ts` (Gate 2, el único lugar que sí comprobaba ese dominio, con su
propio `Set` LOCAL, nunca compartido) lo rechazaba al RECARGAR. Un documento
PERSISTIBLE que dejaba de ser RECARGABLE — y, porque el compare-and-swap de
§10 (E3-07) necesita releer el documento existente para verificar la revisión
antes de escribir, TODO commit siguiente (sin relación con el comportamiento
roto) fallaba con `PERSIST_FAILED`: el proyecto entero quedaba inutilizable.

**El contrato de §9.1 sigue siendo válido para el resto de los casos que
menciona** (`pin` inventado sigue siendo `PIN_INEXISTENTE_EN_PLACA`,
representable, diagnosticado por `aplicarAsignarPin` — nunca por
`validarFormaPayload`) — Phase 1.2 sólo cierra el gap real que la
re-auditoría demostró para `comparador`/`accion`.

**Invariante nombrado:** todo `Proyecto` que una operación acepta persistir
tiene que pertenecer al MISMO dominio ESTRUCTURAL que el loader acepta al
recargarlo — **PERSISTIBLE ⇒ RECARGABLE** (ver `IR-SPEC.md` §6.11 para el
detalle completo). Nunca responde readiness, nunca convierte un motivo
representable en rechazo, nunca exige completitud — es puramente estructural,
al mismo nivel que `validarFormaProyecto` (forma, dominio de enums cerrados,
referencias sin colgar).

**Fix, en dos capas:**

1. **`SetComportamiento` rechaza el valor fuera de dominio, ANTES de crear
   estado** (`aplicarSetComportamiento`, `operaciones.ts`): `comparador`/
   `accion` se comprueban contra el dominio NORMATIVO único
   (`ir.ts::COMPARADORES`/`ACCIONES` — la MISMA constante que ahora importa
   `cargador.ts`, en vez de su `Set` local anterior) — un valor fuera de ese
   dominio rechaza con `VALOR_ENUM_DESCONOCIDO` (categoría `operacion`,
   `clasificacion:"rechazo"` siempre), mismo criterio "Camino B" que
   `UMBRAL_NO_FINITO` (§ E1-03).
2. **Barrera PERSISTIBLE ⇒ RECARGABLE en el commit** (`ejecutarLote`,
   `motor.ts`, punto 5c del pipeline — ANTES de la bifurcación dry-run/commit
   descrita al principio de este documento): reutiliza `validarFormaProyecto`
   DIRECTO sobre el `borrador`, en memoria, sin I/O — defensa en PROFUNDIDAD,
   nunca alcanzable hoy vía las 8 operaciones públicas (la capa 1 ya cierra
   el único gap real), mismo criterio que `validarIdsYContador` post-lote
   (§ RX-03) o la defensa post-lote de `REFERENCIA_INEXISTENTE`/
   `AUTOCONEXION_INVALIDA` (§ E2-01). Rechaza con `ESTADO_NO_RECARGABLE`
   (categoría `motor`, `clasificacion:"rechazo"` siempre; `datos.motivosLoader`
   conserva el/los motivos originales de `validarFormaProyecto`). **Decisión
   sobre el dry-run:** `motor.proponer()` corre esta MISMA barrera, en el
   MISMO punto de `ejecutarLote` — nunca "aprueba" (dry-run `ok:true`) un
   lote que `motor.aplicar()`/`aplicarTransaccion()` con el mismo lote
   rechazaría; los dos caminos comparten un único veredicto, nunca dos
   validaciones que puedan divergir.

Como cualquier otro rechazo de `ejecutarLote`: canónico, revisión, disco y
buffer de undo quedan intactos — el proyecto sigue operativo para el próximo
commit válido. Path A (`PIN_OCUPADO` → commit + blocking + persistido + not-ready
+ editable) y los proyectos incompletos (sin placa, con un `pin` en `null`)
siguen siendo persistibles sin cambios: ninguna de las dos capas de este fix
mira readiness ni completitud, sólo forma estructural cerrada de enum.

## 12. Phase 2 Slice 2 — tool de transporte del agente `proyecto-fisico`

`opencode/tool/proyecto-fisico.ts` (§3.1 de `PHASE_2_SLICE_2_DESIGN.md`, HD-S2-1a,
R-1/R-2/R-6 de §10, HUMAN PRODUCT OWNER) es **transporte, no autoridad**: cumple
exactamente la misma función que `POST /api/operaciones`
(`opencode/servidor/servidor-proyecto.ts:116-135`), pero para el actor `"agente"` en
vez del actor `"navegador"` — las dos vías arman un `SobreOperacion` con el actor
FORZADO (nunca el que mande el cliente) y lo pasan al MISMO Project Engine, por
`obtenerServicioDeProyectoConVista` (`opencode/servidor/servicio-con-vista.ts`); la
tool nunca escribe la IR, nunca construye un `Almacen`, nunca valida hardware por su
cuenta (`proyecto-fisico.ts:1-26`, T-AG-01).

**Tres `accion`** (`proyecto-fisico.ts:193-222`):
- `leer`: `servicio.snapshot()` resumido — revisión, componentes (id/tipo/rol/pines)
  y los motivos vigentes con su explicación en texto llano (`resumenDeLectura`,
  `proyecto-fisico.ts:171-182`).
- `simular`: `servicio.proponer(sobres)` — dry-run, nunca persiste ni sube la
  revisión ni notifica por SSE (T-AG-08).
- `aplicar`: `servicio.aplicarTransaccion(sobres)` — atómico, todo o nada: un lote
  con una sola operación inválida no aplica ninguna, ni siquiera las anteriores del
  mismo lote (T-AG-02/T-AG-04).

**Whitelist exacta e inmutable** (R-6, `OPERACIONES_PERMITIDAS`): HISTÓRICO, Phase 2 Slice 2 —
`SetPlaca`, `AgregarComponente`, `QuitarComponente`, `AsignarPin`, `Conectar`, `Desconectar`, con
`SetComportamiento` (HD-S2-10: ninguna lógica pulsador→LED) y `CambiarComponente` afuera.
> **SUPERSEDIDO (Phase 3, `DECISIONS.md` 2531e09 + `PHASE_3_VERTICAL_1_CONTRACT.md` §A, ver §13):** la
> whitelist es ahora de **8 tipos** (los 6 de arriba + `SetComportamiento` + `QuitarComportamiento`);
> `CambiarComponente` sigue afuera. Cualquier otro `tipo` se rechaza EN LA TOOL, sin invocar el Engine.
**Límite de 20 operaciones por llamada** (`MAXIMO_OPERACIONES`,
`proyecto-fisico.ts:46`), en una única transacción atómica: con más de 20 se
RECHAZA explícito — nunca se trunca, aplica parcial ni se divide en varias
transacciones (T-AG-11).

**`baseRevision` obligatorio para `simular`/`aplicar`, nunca autocompletado**
(`proyecto-fisico.ts:249-258`, T-AG-03): sin él, la tool rechaza con
`BASE_REVISION_FALTANTE` antes de tocar el Engine. La tool JAMÁS lo completa con
`servicio.snapshot().revision` — hacerlo anularía la protección contra stale que
`baseRevision` obligatorio existe para dar; un `baseRevision` con forma válida pero
desactualizado (o no entero/negativo) SÍ llega al Engine, que lo rechaza con sus
propios motivos de dominio (`BASE_REVISION_DESACTUALIZADA`/`BASE_REVISION_INVALIDA`
— no son códigos de transporte).

**Actor forzado, sobre armado por la tool** (`construirSobres`,
`proyecto-fisico.ts:150-162`): cada `SobreOperacion` se arma SÓLO con `tipo`+
`payload` del arg — `actor: "agente"` siempre (sin importar qué venga en el arg,
T-AG-06), `idOperacion` generado, un `idTransaccion` COMPARTIDO por todo el lote y
`baseRevision` = el del arg en la primera operación (leído por `motor.ts:538-548`,
igual que hace el navegador). Un elemento de `operaciones` con cualquier clave
extra (`actor`, `idOperacion`, `idTransaccion`, `baseRevision`) se rechaza entero,
EN LA TOOL — nunca se descartan sólo las claves de más (T-AG-06).

**Códigos de rechazo de transporte** (`validarLoteParaTransporte`,
`proyecto-fisico.ts:124-144`, y los chequeos previos de
`execute`) — todos con `rechazadoPor:"tool"`:

| Código | Cuándo |
|---|---|
| `ACCION_DESCONOCIDA` | `accion` no es `leer`/`simular`/`aplicar` (fix N-01, defensa en profundidad — ver más abajo) |
| `ID_PROYECTO_INVALIDO` | `idProyecto` no matchea `PATRON_ID_PROYECTO` (fix C-01 — ver más abajo) |
| `OPERACION_FUERA_DE_WHITELIST` | `tipo` no está en la whitelist exacta de R-6 |
| `DEMASIADAS_OPERACIONES` | más de 20 operaciones en el lote |
| `OPERACION_CON_FORMA_INVALIDA` | `operaciones` no es un `Array` de verdad, o un elemento del lote no es un objeto plano |
| `OPERACION_CON_CLAVES_INVALIDAS` | un elemento no tiene EXACTAMENTE `tipo`+`payload` |
| `BASE_REVISION_FALTANTE` | falta `baseRevision` para `simular`/`aplicar` |
| `OPERACIONES_FALTANTES` | falta o viene vacía la lista `operaciones` |
| `ERROR_INESPERADO` | cualquier otra excepción no anticipada, atrapada por el catch envolvente de `execute()` (fix M-01 — ver más abajo) |

Estos códigos **NO son motivos del Engine y no se persisten**: son un rechazo
de transporte, resuelto antes de invocar `servicio.aplicarTransaccion`/`proponer`
(el Engine ni se entera), y nunca viajan por `nucleo/motivos.ts` ni por el
`vista.motivos` de un snapshot — se diferencian en runtime de un rechazo de
dominio porque sólo estos últimos traen `motivos[]` del Engine (ver T-AG-03: un
`baseRevision` con forma válida pero desactualizado da
`BASE_REVISION_DESACTUALIZADA`, un motivo de dominio, sin `rechazadoPor:"tool"`).

### 12.1. Fix C-01 (CRITICAL, ronda W-S2-FIX, red team RED-S2-TOOL/INFORME.md) — `idProyecto` sin validar

`idProyecto` viajaba SIN VALIDAR desde las dos tools (`proyecto-fisico.ts`,
`vista-fisica.ts`) y desde `scripts/vista-fisica-demo.mjs` hasta
`nucleo/almacen.ts::rutaFinal` (`join(deps.directorio, \`${id}.json\`)`) y
`servidor/servicio-con-vista.ts::tomarCandado` (`join(directorio,
\`${idProyecto}.lock\`)`) — capas PROTEGIDAS (§6) que arman la ruta final sin
chequear separadores de ruta ni `..`. Con `idProyecto:"../../../fuga"` la
escritura aterrizaba fuera de `.tecnia-vista-fisica` y hasta fuera de
`ctx.directory` por completo (reproducido con una escritura real confirmada).

El fix agrega una función pura, `validarIdProyecto`
(`opencode/vista-fisica/ubicacion-proyecto.ts`, patrón `PATRON_ID_PROYECTO =
/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, alfanumérico ASCII con `-`/`_`
opcionales, 1 a 64 caracteres), y la aplica ANTES de resolver
`directorioDeDatos`/pedir el servicio en las tres superficies (las dos tools y
el launcher de demo) — nunca toca disco ni toma el candado con un id inválido.
`idProyecto` vacío o sólo espacios sigue cayendo en `ID_PROYECTO_DEFAULT`
("activo") exactamente como antes del fix — la validación corre sobre el valor
YA resuelto (default incluido), nunca antes.

### 12.2. Fix M-01 (MINOR, misma ronda) — `operaciones` con el prototipo alterado

Un `operaciones` con `Object.setPrototypeOf(arr, {length:999})` sigue siendo un
`Array` de verdad para `Array.isArray` (el internal slot no cambia con el
prototipo), pero pierde cualquier método heredado de `Array.prototype`
(`.entries()`, `Symbol.iterator`) — `validarLoteParaTransporte` iteraba con
`for...of operacionesCrudas.entries()`, que rompía con un `TypeError` crudo,
sin capturar, fuera de `execute()`. El fix: `Array.isArray` primero (rechaza
cualquier objeto array-like que no sea un array real, `OPERACION_CON_FORMA_INVALIDA`),
y después un recorrido por ÍNDICE con acceso `[]` plano (siempre propio del
array, nunca heredado del prototipo) sobre un largo ya acotado a
`MAXIMO_OPERACIONES` — nunca `.entries()`/`.map()`/`for...of` sobre el objeto
de entrada. Además, todo el cuerpo de `execute()` quedó envuelto en un
`try/catch` externo (`codigo:"ERROR_INESPERADO"`, arriba) como red de
seguridad: ningún error inesperado puede escapar como excepción cruda.

### 12.3. Fix N-01 (NOTE, defensa en profundidad, misma ronda) — `accion` desconocida

El schema zod del harness ya restringe `accion` a `leer`/`simular`/`aplicar`,
pero quien invoque `execute()` directo (bypaseando zod) encontraba que
`args.accion === "aplicar" ? aplicarTransaccion(...) : proponer(...)` trataba
cualquier otro valor como dry-run implícito — mismo criterio que ya motiva la
whitelist explícita de `tipo`/R-6 ("no confíes sólo en el schema"), que acá no
se aplicaba a `accion`. El fix agrega un chequeo explícito al principio de
`execute()`: una `accion` fuera de las tres conocidas se rechaza con
`ACCION_DESCONOCIDA`, sin invocar el Engine.

**Paralelo con el navegador:** la tool y `servidor-proyecto.ts` resuelven al MISMO
directorio de datos (`opencode/vista-fisica/ubicacion-proyecto.ts::directorioDeDatos`)
para la misma carpeta de trabajo, así que terminan en el MISMO singleton/candado de
`servicio-con-vista.ts` — una operación aplicada por la tool dispara el mismo SSE
`revision` que ve un navegador ya abierto (T-AG-07), y una asignación de pin
inválida (ej. GPIO34) da el mismo `PIN_SIN_PULLUP_INTERNO`, con la misma
explicación determinista, por los dos caminos (T-AG-05, convergencia de caminos).
La diferencia es únicamente el actor forzado (`"agente"` vs. `"navegador"`) y el
transporte (tool de OpenCode vs. `POST /api/operaciones`) — la autoridad semántica
es una sola, en los dos casos.

## 13. Phase 3 — vertical semántico #1 (regla de nivel pulsador→LED)

Fuente: `PHASE_3_VERTICAL_1_CONTRACT.md` §B2–§B7.

**`QuitarComportamiento`.** Payload `{comportamiento: id}`. No existe → rechazo `REFERENCIA_INEXISTENTE`
`{comportamiento}`. Existe → se quita, info `COMPORTAMIENTO_QUITADO` (`categoria operacion`, `severidad info`, sin
`clasificacion`, mismo patrón que `COMPORTAMIENTO_REEMPLAZADO`) con `datos {comportamiento, reglaQuitada}` (la regla
completa, para un undo futuro), revisión +1. Después, `QuitarComponente` vuelve a estar permitido.

**`QuitarComponente` (HD-P3D-4 = A).** Un componente referenciado por cualquier slot PRESENTE de una regla sigue
rechazándose con `REMOCION_CON_DEPENDIENTES`. Texto llano nuevo: "Este componente lo usa una regla. Quitá o cambiá
la regla primero."

**Motivos semánticos nuevos** (`validar.ts::validarSemantico`, una función genérica guiada por datos del catálogo, sin
nombres de tipo). Los tres son `categoria semantica`, `severidad blocking`, `clasificacion representable` (Path A: se
commitea y el proyecto queda `listo:false`; **nunca** `rechazo`), `entidad {comportamiento, id}`:
- `COMPORTAMIENTO_INCOMPLETO` — `datos {faltan}` ⊆ `["sensor","estado","actuador","salida"]`, en ese orden.
- `ACTUADOR_INVALIDO` — `entonces.actuador` con `ComponenteCatalogo.clase !== "actuador"`; `datos {componente, clase}`
  (tipo desconocido del catálogo: no se emite). Corrige el bug conocido "un pulsador se acepta como actuador". Un
  documento histórico con un actuador inválido carga igual y muestra el motivo.
- `SENSOR_INVALIDO` — `cuando.sensor` SIN triada, cuyo catálogo no declara ninguna capacidad; `datos {componente}`. Con
  la triada presente no se emite (`CAPACIDAD_NO_DECLARADA` / `CAPACIDAD_INEXISTENTE_EN_CATALOGO` ya la cubren).

**Whitelist de la tool `proyecto-fisico`: 8 tipos** (ver el HISTÓRICO superseded en §12). `leer` expone `reglas` (misma
proyección del servidor) y `vocabulario.operaciones` trae los ejemplos de `SetComportamiento` y `QuitarComportamiento`.

**Whitelist del NAVEGADOR** (`POST /api/operaciones`): `AsignarPin`, `SetComportamiento`, `QuitarComportamiento`. Se aplica
DESPUÉS de validar `Origin`/`Content-Type` y de leer/parsear el cuerpo, y ANTES del Engine. Otro `tipo` → HTTP 200
`{resultado:{ok:false, rechazadoPor:"transporte", motivos:[{codigo:"OPERACION_NO_PERMITIDA_EN_NAVEGADOR", categoria:"operacion",
severidad:"blocking", clasificacion:"rechazo", datos:{tipo}}]}, snapshot}`; el Engine no se invoca y nada se persiste. Un cuerpo que no
es un objeto plano sigue yendo al Engine. Es un error de integración, no de dominio.

### 13.1. Phase 3 — vertical #2: la vista lógica (Blockly) como tercer productor

La vista lógica (Blockly, `PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md`) es un **tercer productor** de operaciones, junto al agente y a
la frase. Usa **sólo** `SetComportamiento` y `QuitarComportamiento` por la whitelist del navegador de arriba, con el mismo
controlador que la frase (`crearControladorReglas`), la `baseRevision` del último snapshot y a lo sumo una operación en vuelo. No se
agrega ninguna operación nueva (ni mover, ni conectar, ni guardar workspace) y el Engine no cambia.

**Lista blanca de assets del servidor.** `construirRutasDeAssets` incluye ahora los cuatro módulos nuevos de `vista-fisica/web/`
(`cliente-http.js`, `vista-logica.js`, `adaptador-blockly.js`, `vista-logica-ui.js`) y los dos archivos vendorizados de Blockly 13.3.0
(`blockly_compressed.js`, `blockly-es.js`, desde `opencode/tecniabot-web/`). La CSP **no cambia**
(`script-src 'self'`, sin `unsafe-eval`); un test fija la cadena exacta.
