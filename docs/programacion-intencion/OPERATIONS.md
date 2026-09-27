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

## 4. Conjunto de operaciones de Fase 1 (8, no 10)

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
| `AsignarPin` | `{componente: string; terminal: string; pin: string \| null}` | `REFERENCIA_INEXISTENTE` (componente) · `TERMINAL_NO_DECLARADO` (terminal no existe en el catálogo del componente) · `PIN_INEXISTENTE_EN_PLACA` (el pin no existe en la placa activa) | `PIN_OCUPADO`, `CAPACIDAD_PIN_INCOMPATIBLE` (los detecta `validarProyecto`/`validar-tecnico.ts`, Gate 4 — la operación en sí NO los chequea, así que un pin ocupado o incompatible SE ASIGNA igual) |
| `Conectar` | `{desde: Extremo; hasta: Extremo}` | `REFERENCIA_INEXISTENTE` (componente) · `TERMINAL_NO_DECLARADO` (terminal) · `AUTOCONEXION_INVALIDA` (mismo componente+terminal en los dos extremos — decisión del orquestador: dos extremos DISTINTOS es invariante estructural) · `CONEXION_DUPLICADA` (el mismo par exacto ya está conectado, sin importar el orden de los extremos — decisión del orquestador: un par de terminales conectado a lo sumo una vez; Phase 1.1, hallazgo E2-01: ambos códigos se REUSAN también desde `validar-estructural.ts`, Gate 4, categoría `estructural`, así que el invariante corre en TODA puerta — loader, `proyectoInicial`/construcción del motor, post-commit, `validarProyecto` directo — no sólo dentro de esta operación) | — |
| `Desconectar` | `{conexion: string}` | `REFERENCIA_INEXISTENTE` si no existe | — |
| `SetComportamiento` | `{comportamiento: {id?; cuando; entonces}}` | `REFERENCIA_INEXISTENTE` (sensor/actuador no existen) · `CAPACIDAD_NO_DECLARADA` (la `capacidad` no está en el catálogo del sensor) · `UMBRAL_NO_FINITO` (Phase 1.1, hallazgo E1-03: `umbral.valor` no es `Number.isFinite` — NaN/±Infinity no son representables en el documento JSON persistido) | `CAPACIDAD_INEXISTENTE_EN_CATALOGO`, `MAGNITUD_INCOMPATIBLE` (Phase 1.1, hallazgo E1-03: los detecta `validarProyecto`/`validar-tecnico.ts`, Gate 4 — la operación en sí NO los chequea, así que un comportamiento con capacidad/magnitud/unidad ya incompatibles con el catálogo vigente SE ACEPTA igual, mismo criterio que `PIN_OCUPADO` de `AsignarPin`) |
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
