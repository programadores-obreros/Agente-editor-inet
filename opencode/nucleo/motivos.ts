// Vocabulario mínimo de "Motivo" para Gate 1 (identidad de placa).
//
// Esta es la porción MÍNIMA del tipo que describe T_diseno_consolidado.md §5.1: sólo el
// tipo, sin builders, sin el orden estable (categoría → entidad.id → código) y sin la
// tabla de clasificación completa — esas piezas pertenecen a los gates que las ejercitan
// de verdad (validar.ts / operaciones.ts, G4/G5). Ampliar este archivo en un gate
// posterior es válido; lo que no vale es que placas.ts (u otro módulo de Gate 1) invente
// su propio tipo de error en paralelo.
//
// Todos los identificadores en español rioplatense, siguiendo la decisión de nomenclatura
// de §0 del diseño consolidado (`docs/programacion-intencion/DECISIONS.md`, entrada OD-01).
//
// Phase 1.1 (remediación de hallazgos externos, PHASE_1_EXTERNAL_FINDINGS.md) agrega un
// código nuevo al vocabulario ya existente (`ID_DUPLICADO` se reusa, ver `id.ts`):
// `CONTADOR_ID_INCONSISTENTE` — categoria "estructural", clasificacion "rechazo" siempre
// — cuando `Proyecto.siguienteIdLocal` no es estrictamente mayor que el número más alto
// entre los ids locales (`cmp-`/`conn-`/`beh-`) ya presentes. Ver `id.ts`
// (`validarIdsYContador`) y `docs/programacion-intencion/IR-SPEC.md` §6.1.
//
// Phase 1.1 (hallazgo externo E1-03, CRÍTICO) agrega, todos con `entidad.tipo:
// "comportamiento"`, ver `docs/programacion-intencion/IR-SPEC.md` §6.2:
// - `UMBRAL_NO_FINITO_AL_CARGAR` — categoria "estructural", clasificacion "rechazo"
//   siempre — `cargador.ts` (Gate 2), momento de carga: `ComportamientoRegla.cuando.
//   umbral.valor` no es `Number.isFinite` (NaN/±Infinity pasan `typeof === "number"`
//   pero no son representables en JSON, ver `canonico.ts`).
// - `UMBRAL_NO_FINITO` — categoria "estructural", clasificacion "rechazo" siempre —
//   MISMO chequeo que el anterior pero corrido por `validar-estructural.ts` (Gate 4,
//   SIN catálogo): cubre cualquier `Proyecto` sin importar la puerta de entrada
//   (`proyectoInicial` que bypasea el loader, post-operación, revalidación). También
//   emitido por `operaciones.ts` (`aplicarSetComportamiento`, categoria "operacion")
//   como rechazo de la OPERACIÓN, antes de construir ningún estado nuevo — doble
//   defensa, mismo código, dos categorías distintas según quién lo emite.
// - `CAPACIDAD_INEXISTENTE_EN_CATALOGO` — categoria "tecnica", severidad "blocking",
//   clasificacion "representable" — `validar-tecnico.ts` (Gate 4, CON catálogo):
//   `cuando.capacidad` no está entre las capacidades que el catálogo VIGENTE declara
//   para el `tipo` del sensor. Representable (categoría A, brief §8.1/§9.1): el
//   comportamiento NUNCA se borra ni se reescribe, sólo se diagnostica — mismo
//   criterio que `PIN_OCUPADO`.
// - `MAGNITUD_INCOMPATIBLE` — código YA existente (`catalogo.ts`, `propagarMagnitud`,
//   categoria "semantica", representable) — Phase 1.1 lo REUSA desde
//   `validar-tecnico.ts` para diagnosticar, de forma continua (no sólo "al
//   reemplazar" un sensor), que `umbral.magnitud`/`unidad` no coinciden con la
//   capacidad real del sensor vigente. Ver `validar-tecnico.ts` para el detalle.
//
// Phase 1.1 (hallazgo externo E2-01, CRÍTICO) centraliza en `conexion.ts`
// (`analizarConexionesInvalidas`) el invariante "sin auto-conexión (self-loop) / sin
// conexión duplicada", todos con `entidad.tipo: "conexion"` cuando corresponde, ver
// `docs/programacion-intencion/IR-SPEC.md` §6.3:
// - `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA` — códigos YA existentes
//   (`operaciones.ts`, categoria "operacion", rechazo) — Phase 1.1 los REUSA desde
//   `validar-estructural.ts` (Gate 4, SIN catálogo, categoria "estructural") para que
//   el invariante corra en TODA puerta que produzca un `Proyecto` (post-carga,
//   `proyectoInicial`/construcción del motor, post-commit, `validarProyecto` directo)
//   y no sólo dentro de la operación `Conectar`. Mismo código, dos categorías según
//   quién lo emite — mismo criterio que `UMBRAL_NO_FINITO`.
// - `AUTOCONEXION_INVALIDA_AL_CARGAR`/`CONEXION_DUPLICADA_AL_CARGAR` — NUEVOS,
//   categoria "estructural", clasificacion "rechazo" siempre — `cargador.ts` (Gate 2),
//   momento de carga: mismo criterio de distinción momento-de-carga vs.
//   momento-de-operación que ya usa `UMBRAL_NO_FINITO_AL_CARGAR`.
//
// Phase 1.1 (hallazgo externo E2-02, CRÍTICO) agrega, todos categoria "operacion",
// clasificacion "rechazo" siempre, emitidos por `operaciones.ts` ANTES del
// switch/dispatch de `aplicarOperacion` (ver `docs/programacion-intencion/
// OPERATIONS.md` §9):
// - `SOBRE_OPERACION_INVALIDO` — el sobre (`SobreOperacion`) no es un objeto, o
//   `idOperacion`/`idTransaccion`/`actor` no tienen la forma exigida por el contrato
//   (`idOperacion`: string no vacío; `idTransaccion`, si está presente: string no
//   vacío; `actor`: "agente"|"navegador").
// - `TIPO_OPERACION_DESCONOCIDO` — `operacion.tipo` no es uno de los 8 tipos válidos
//   (`OPERATIONS.md` §4) — también lo emite el `default` del switch de
//   `aplicarOperacion`, como defensa en profundidad (nunca alcanzable hoy).
// - `PAYLOAD_OPERACION_INVALIDO` — el payload no tiene la forma mínima que el
//   `aplicarXxx` del tipo necesita (null/undefined/array en vez de objeto, campo
//   requerido ausente o de tipo incorrecto) — `datos.razon` describe la forma
//   esperada. Nunca valida REFERENCIAS (eso lo sigue haciendo cada `aplicarXxx`) ni
//   valores de enum sintácticamente válidos pero inventados.
// - `CLAVE_DESCONOCIDA` — código YA existente (`cargador.ts`, categoria
//   "estructural") REUSADO acá con categoria "operacion" (hallazgo externo E2-03,
//   MENOR): una clave extra desconocida en el sobre (ej. "extraField") se rechaza,
//   mismo criterio fail-closed que ya aplica el loader — mismo código, dos
//   categorías según quién lo emite, mismo criterio que `AUTOCONEXION_INVALIDA`/
//   `UMBRAL_NO_FINITO`.
//

// Phase 1.1 (hallazgo externo E3-01, CRÍTICO) agrega, categoria "motor",
// clasificacion "rechazo" siempre, emitido por `motor.ts` (`ejecutarLote`, ANTES de
// clonar):
// - `BASE_REVISION_INVALIDA` — la PRIMERA operación de un lote NO VACÍO trae un
//   `baseRevision` que no es un entero no negativo (null/ausente/string/NaN/
//   ±Infinity/negativo/no entero) — DISTINTO de `BASE_REVISION_DESACTUALIZADA` (que
//   es "el dato es válido pero ya no coincide con lo vigente"): acá el dato en sí
//   nunca fue válido, así que nunca se sustituye por la revisión actual (ese era el
//   bug: un `??` que trataba "sin dato" como "usá la revisión de ahora"). Ver
//   `docs/programacion-intencion/OPERATIONS.md` §9 para el detalle, incluida la
//   decisión de E3-05 (lote vacío: no-op explícito, sin motivo, `ok:true`).
//
// Phase 1.1 (hallazgo externo E3-07, MAJOR — resolución humana Phase 1.1, brief §21)
// agrega, categoria "almacen", clasificacion "rechazo" siempre, emitido por
// `almacen.ts` (`guardar()`, ANTES de escribir):
// - `CONFLICTO_REVISION_EN_ALMACEN` — ya existe un documento en disco bajo este id
//   cuya `revision` NO es exactamente `proyecto.revision - 1` (el estado que el
//   llamador cree que acaba de reemplazar) — otro motor con un punto de partida que
//   este llamador nunca vio ya escribió acá. Compare-and-swap sobre la revisión,
//   nunca un lock (`docs/programacion-intencion/OPERATIONS.md` §10 para el detalle,
//   incluida la excepción de re-guardado canónicamente idéntico y el límite conocido
//   de detección por revisión, no por contenido).
//
// Phase 1.1 (hallazgo externo E3-08, barato) agrega, categoria "almacen",
// clasificacion "rechazo" siempre, emitido por `almacen.ts` (`cargar()`):
// - `ID_DOCUMENTO_NO_COINCIDE` — el `Proyecto.id` del documento leído bajo
//   `<id>.json` NO coincide con el `id` que se pidió cargar (documento escrito/
//   movido/copiado a la ruta equivocada) — se rechaza ANTES de devolverlo, nunca se
//   "repara" reasignando el id en silencio. Ver
//   `docs/programacion-intencion/OPERATIONS.md` §10.1.

/** Categorías de motivo del núcleo completo (§5.1). Gate 1 sólo emite "operacion". */
export type CategoriaMotivo =
  | "estructural"
  | "referencial"
  | "tecnica"
  | "componente"
  | "semantica"
  | "readiness"
  | "pedagogica"
  | "operacion"
  | "motor"
  | "almacen"

/** A qué entidad de la IR se refiere el motivo, cuando corresponde. */
export type EntidadMotivo = {
  readonly tipo: "componente" | "conexion" | "comportamiento" | "placa" | "lote"
  readonly id: string
}

/**
 * Un motivo estructurado: nunca una excepción cruda, nunca una cadena de texto suelta.
 *
 * `clasificacion` viaja CON el motivo (nunca en una tabla central del motor — ver §5.1
 * del diseño consolidado): "representable" = Camino A (la operación commitea con el
 * motivo como advertencia/bloqueo post-commit), "rechazo" = Camino B (la operación no
 * se aplica). En Gate 1 sólo se usa "rechazo": una placa desconocida/ambigua/no
 * soportada nunca se "asigna igual".
 */
export type Motivo = {
  readonly codigo: string
  readonly categoria: CategoriaMotivo
  readonly severidad: "info" | "warning" | "blocking"
  readonly clasificacion?: "representable" | "rechazo"
  readonly entidad?: EntidadMotivo
  readonly datos?: Readonly<Record<string, unknown>>
}

// ════════════════════════════════════════════════════════════════════════════════════
// Orden estable — Gate 4 (validar.ts lo usa para agregar sin mezclar el orden entre
// corridas: (prioridad fija de categoría) → entidad.id (lexicográfico) → código).
// ════════════════════════════════════════════════════════════════════════════════════

/** Prioridad fija: el índice en este array ES la prioridad (0 = primero). */
export const ORDEN_CATEGORIAS: readonly CategoriaMotivo[] = [
  "estructural",
  "referencial",
  "tecnica",
  "componente",
  "semantica",
  "readiness",
  "pedagogica",
  "operacion",
  "motor",
  "almacen",
]

/** Comparador estable para `Array.prototype.sort` — nunca cambia entre corridas para
 * el mismo conjunto de motivos (determinista, sin depender de `Date.now()`/random). */
export function compararMotivos(a: Motivo, b: Motivo): number {
  const pa = ORDEN_CATEGORIAS.indexOf(a.categoria)
  const pb = ORDEN_CATEGORIAS.indexOf(b.categoria)
  if (pa !== pb) return pa - pb
  const idA = a.entidad?.id ?? ""
  const idB = b.entidad?.id ?? ""
  if (idA !== idB) return idA < idB ? -1 : 1
  if (a.codigo !== b.codigo) return a.codigo < b.codigo ? -1 : 1
  return 0
}
