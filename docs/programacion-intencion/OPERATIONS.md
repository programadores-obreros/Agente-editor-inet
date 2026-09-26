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
| `Conectar` | `{desde: Extremo; hasta: Extremo}` | `REFERENCIA_INEXISTENTE` (componente) · `TERMINAL_NO_DECLARADO` (terminal) · `AUTOCONEXION_INVALIDA` (mismo componente+terminal en los dos extremos — decisión del orquestador: dos extremos DISTINTOS es invariante estructural) · `CONEXION_DUPLICADA` (el mismo par exacto ya está conectado — decisión del orquestador: un par de terminales conectado a lo sumo una vez) | — |
| `Desconectar` | `{conexion: string}` | `REFERENCIA_INEXISTENTE` si no existe | — |
| `SetComportamiento` | `{comportamiento: {id?; cuando; entonces}}` | `REFERENCIA_INEXISTENTE` (sensor/actuador no existen) · `CAPACIDAD_NO_DECLARADA` (la `capacidad` no está en el catálogo del sensor) | — |
| `CambiarComponente` | `{componente: string; tipoNuevo: string}` | `REFERENCIA_INEXISTENTE` (componente) · `TIPO_CATALOGO_DESCONOCIDO` (tipoNuevo no existe) | `RANGO_INCOMPATIBLE_AL_REEMPLAZAR`, `CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR`, `UNIDAD_CONVERTIDA` (vía `reemplazarSensor`, Gate 3 — la operación SIEMPRE commitea si `tipoNuevo` existe; lo que cambia por rama es qué motivo deja) |

Dos códigos son NUEVOS en este documento (no estaban en la tabla de Gate 3/`COMPONENT-CATALOG.md`,
porque resuelven los dos puntos que el diseño consolidado dejaba explícitamente
abiertos en su §9, y que el orquestador cerró antes de este gate):

- `AUTOCONEXION_INVALIDA` — categoría `operacion`, rechazo.
- `CONEXION_DUPLICADA` — categoría `operacion`, rechazo.
- `CAPACIDAD_NO_DECLARADA` — categoría `operacion`, rechazo (el "TERMINAL_NO_DECLARADO
  equivalente para capacidad" que el diseño consolidado pedía sin darle nombre final).

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
3. si no hay rechazo → corre `validarProyecto(proyectoNuevo, catalogo)` (Gate 4) y
   agrega esos motivos (los representables/técnicos/estructurales/semánticos del
   ESTADO RESULTANTE) a los propios de la operación, devuelve `{ok:true, proyecto
   nuevo, motivos combinados}`.

Es el punto de composición que el `MotorDeProyecto` (Gate 6) va a envolver con
revisión + persistencia — no reimplementa nada de eso, sólo junta "¿la operación en sí
es válida?" con "¿el estado resultante es válido?", que son dos preguntas distintas
(la primera decide si se aplica; la segunda decide si el resultado queda `invalido`).
