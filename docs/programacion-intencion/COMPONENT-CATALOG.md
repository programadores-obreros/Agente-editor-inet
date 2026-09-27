# COMPONENT-CATALOG.md — catálogo de componentes (Gate 3)

Implementación: `opencode/nucleo/catalogo.ts` (tipos + reglas genéricas del core) +
`opencode/nucleo/catalogo-datos.ts` (contenido declarativo) +
`opencode/nucleo/adaptadores/hash-catalogo.node.ts` (único import de `node:crypto`).
Tests: `tests/nucleo-catalogo.test.mjs`. Diseño fuente: `T_diseno_consolidado.md` §4
(agente D, reconciliaciones R1/R2/R4).

Este documento se escribe **antes** de los validadores de Gate 4 (`validar-tecnico.ts`)
a propósito — §25 del brief pide el contrato antes que el validador que lo consume, y
la tabla de clasificación de abajo es exactamente lo que Gate 4 necesita leer para
saber qué código de motivo emitir y con qué clasificación.

## 1. CONTRATO ACTUAL DE PINOUT vs. CATÁLOGO SEMÁNTICO NUEVO

Dos cosas conviven en el repo y **no se fusionan**:

| | `opencode/tecniabot-web/pinouts.json` | `opencode/nucleo/catalogo.ts` + `catalogo-datos.ts` |
|---|---|---|
| Qué es | Contrato de TEST/documentación de proyectos INET concretos (1/15 proyectos poblado: `01-semaforizacion`) | Catálogo semántico genérico: qué terminales tiene un LED, qué capacidades mide un DHT22 |
| Forma del dato | `{rol, componente, pin, tipo, nota}` por proyecto+placa+nivel — string libre, sin tipos | `ComponenteCatalogo` tipado: `terminales[]`, `capacidades[]`, `requisitos[]` |
| Quién lo consume hoy | `tests/pinouts.test.mjs`, `resistencia-led.test.mjs` (comparación de texto) | Nadie en producción todavía — Gate 4+ (validar-tecnico.ts, operaciones.ts) |
| Puede modificarse en Fase 1 | **NO** (§8.2, §18.6, §25 del brief lo prohíben expresamente) | Sí — es exactamente lo que Gate 3 introduce |
| Relación entre los dos | Ninguna programática. El único puente es el test de adaptador de Gate 1 (`adapter-pinouts-json-esp32-semaforo`, GPIO16/17/18) | — |

**Por qué no se fusionan:** `pinouts.json` describe *pines de UN proyecto concreto ya
armado*; el catálogo nuevo describe *qué necesita un tipo de componente en general,
en cualquier proyecto*. Fusionarlos inventaría una relación que ningún caso de uso
pide todavía (mismo criterio YAGNI que ya aplicó `placas.ts` en Gate 1 para
`aliases[]`).

## 2. Tipos (traducidos de D §1, sin cambios de fondo)

`Magnitud`, `Unidad`, `Cantidad{valor,unidad,magnitud}`, `Rango{min,max}`,
`Terminal{id,rol,electrica,requierePwm?,destinoFijo?,direccion?}`,
`Capacidad{id,magnitud?,unidad?,rango?,resolucion?}`,
`Requisito{tipo,enTerminal?,spec}`, `ComponenteCatalogo{id,nombreVisible,clase,
terminales,capacidades,requisitos,compatibilidades?,pedagogico?}`.

`Terminal.direccion` (`"entrada"|"salida"|"bidireccional"`, opcional) es un campo que
NINGUNO de B/C/D había propuesto explícitamente — se agregó durante la implementación
de Gate 3 porque `asignarPin` no puede distinguir "GPIO34 sirve para leer un sensor"
de "GPIO34 sirve para prender un LED" sin saber el sentido eléctrico del terminal (un
ánodo de LED siempre empuja corriente; GPIO34 del ESP32 es solo-entrada, Gate 1). Sin
este campo, `asignar-pin-capacidad-incompatible` no podía escribirse correctamente.
Documentado acá porque es una desviación real (aunque menor) del diseño consolidado.

## 3. Contenido mínimo shippeado

`led`, `resistencia` (pasivo auxiliar generado por el requisito `resistencia-serie`
del LED), `pulsador`, `dht22`, `ntc` — evidencia file:line de `circuito.ts` citada en
los comentarios de `catalogo-datos.ts`. La capacidad `humedad` del DHT22 (rango
0-100%) es **INFERRED**: `circuito.ts` no simula humedad hoy (`SENSOR_SIM` sólo tiene
temperatura), se documenta la inferencia como tal, no como dato leído del código.

`sensor-temp-f` y `sensor-temp-corto` son fixtures **sintéticos de test**
(`tests/nucleo-catalogo.test.mjs`), fuera del catálogo shippeado — existen sólo para
ejercitar la rama B (conversión de unidad) y la rama C (rango incompatible) de
`reemplazarSensor` con datos que hoy ningún componente real tiene (T_diseno_consolidado.md §4.3).

## 4. `catalogoHash` (R4)

sha256 sobre JSON canónico (claves ordenadas, sin espacios, sin incluir el propio
campo `hash`) del catálogo. `canonicalizarCatalogo()` vive en `catalogo.ts` (core,
pura, reusa `canonico.ts` de Gate 2). El hasher real (`createHash("sha256")`) vive
ÚNICAMENTE en `adaptadores/hash-catalogo.node.ts`, inyectado — el core nunca importa
`node:crypto` directo. El test `version-skew-catalogo-cambiado-detectado` demuestra
por qué el hash existe: dos catálogos con el MISMO `version` legible ("1.0.0") pero
contenido distinto dan hashes distintos — el string humano no alcanza para detectar
un catálogo que cambió sin que alguien haya bumpeado la versión a mano.

## 5. Reglas genéricas del core — SIEMPRE despachan por tipo/rol/clase, nunca por id

`evaluarRequisito`, `asignarPin`, `propagarMagnitud`, `validarConexion`,
`reemplazarSensor`. El test `catalogo-sin-cambio-de-core-al-agregar-componente` prueba
esto literalmente: un componente 100% inventado en el propio test, nunca importado de
`catalogo-datos.ts`, se procesa sin tocar ningún `.ts` del core.

`reemplazarSensor` implementa las 4 ramas de §8.1, con una corrección sobre la
redacción original del diseño: el chequeo de "misma unidad → conservar sin más" debe
ir DESPUÉS de comprobar que el umbral cae dentro del rango del sensor nuevo — dos
sensores en la MISMA unidad pero con rangos distintos (ej. DHT22 0-60°C reemplazado
por un sensor 0-25°C) son la rama C, no la rama A. La primera versión de la
implementación tenía el orden invertido y el test de rama C pasaba en falso (ver
DECISIONS.md).

## 6. Tabla de clasificación de motivos — RECHAZO vs. REPRESENTABLE (§25, R3)

Extracto de la tabla completa de `T_diseno_consolidado.md` §5.2, sólo las filas que
Gate 3/4 emiten (la tabla completa de motor/operaciones queda en `DECISIONS.md` cuando
se implemente Gate 5):

| Código | Severidad | Categoría | Clasificación | Emitido por |
|---|---|---|---|---|
| `PIN_OCUPADO` | blocking | tecnica | **REPRESENTABLE** | `validar-tecnico.ts` (Gate 4) |
| `CAPACIDAD_PIN_INCOMPATIBLE` | blocking | tecnica | **REPRESENTABLE** | `catalogo.ts` (`asignarPin`) |
| `REQUISITO_INSATISFECHO` | blocking | componente | **REPRESENTABLE** | `catalogo.ts` (`evaluarRequisito`) |
| `MAGNITUD_INCOMPATIBLE` | blocking | semantica | **REPRESENTABLE** | `catalogo.ts` (`propagarMagnitud`) |
| `UNIDAD_CONVERTIDA` | info | semantica | n/a (éxito documentado) | `catalogo.ts` (`propagarMagnitud`/`reemplazarSensor`) |
| `RANGO_INCOMPATIBLE_AL_REEMPLAZAR` | warning | semantica | **REPRESENTABLE** | `catalogo.ts` (`reemplazarSensor`, rama C) |
| `CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR` | blocking | semantica | **REPRESENTABLE** | `catalogo.ts` (`reemplazarSensor`, rama D) |
| `CATALOGO_COMPONENTE_DESCONOCIDO` | blocking | tecnica | **REPRESENTABLE** (nunca se borra el componente) | `validar-tecnico.ts` (Gate 4, R2) |
| `PLACA_DESCONOCIDA_EN_DOCUMENTO` | blocking | tecnica | **REPRESENTABLE** | `validar-tecnico.ts` (Gate 4, R2) |
| `TIPO_CATALOGO_DESCONOCIDO` (en payload de `AgregarComponente`) | — | operacion | **RECHAZO** | `operaciones.ts` (Gate 5) |
| `CAPACIDAD_INEXISTENTE_EN_CATALOGO` (Phase 1.1, E1-03) | blocking | tecnica | **REPRESENTABLE** | `validar-tecnico.ts` (Gate 4) |
| `UMBRAL_NO_FINITO` (Phase 1.1, E1-03) | blocking | estructural | **RECHAZO** | `validar-estructural.ts` (Gate 4) / `operaciones.ts` (Gate 5, categoría `operacion`) |
| `UMBRAL_NO_FINITO_AL_CARGAR` (Phase 1.1, E1-03) | blocking | estructural | **RECHAZO** | `cargador.ts` (Gate 2) |
| `AUTOCONEXION_INVALIDA` (Phase 1.1, E2-01) | blocking | estructural / operacion | **RECHAZO** | `validar-estructural.ts` (Gate 4) / `operaciones.ts` (Gate 5, categoría `operacion`) |
| `CONEXION_DUPLICADA` (Phase 1.1, E2-01) | blocking | estructural / operacion | **RECHAZO** | `validar-estructural.ts` (Gate 4) / `operaciones.ts` (Gate 5, categoría `operacion`) |
| `AUTOCONEXION_INVALIDA_AL_CARGAR` (Phase 1.1, E2-01) | blocking | estructural | **RECHAZO** | `cargador.ts` (Gate 2) |
| `CONEXION_DUPLICADA_AL_CARGAR` (Phase 1.1, E2-01) | blocking | estructural | **RECHAZO** | `cargador.ts` (Gate 2) |

**Regla general que Gate 4 tiene que respetar:** todo lo que este documento clasifica
`REPRESENTABLE` significa que la operación que lo provoca **COMMITEA** — el motivo
viaja al lado, el proyecto queda `invalido:true` si corresponde, nunca se rechaza la
operación completa por esto. Sólo lo que la tabla de arriba marca `RECHAZO` (y las
filas de `operaciones.ts`/`cargador.ts` de `DECISIONS.md`) corta la operación antes de
tocar el borrador.

## 7. Límites conocidos de Gate 3 (documentados, no bugs)

- `validarConexion` queda deliberadamente mínima (siempre `null` hoy): sin evidencia
  real todavía de una incompatibilidad eléctrica que el brief pida rechazar a este
  nivel (auto-conexión/duplicado exacto quedan para Gate 4/5, ya anotados como puntos
  abiertos en `DECISIONS.md` desde Gate 1).
- `evaluarRequisito` sólo implementa la rama `resistencia-serie` a fondo — los otros
  tres tipos de requisito (`capacidad-pin`, `resistencia-pull`, `componente-auxiliar`)
  existen en el vocabulario del tipo pero ningún componente shippeado los declara
  todavía: se implementan cuando haya un requisito real que los ejercite, no antes.
