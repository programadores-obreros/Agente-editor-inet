// Loader — Gate 2, nivel 1 (ESTRUCTURALMENTE REPRESENTABLE).
//
// Convierte un documento crudo (string JSON o `unknown` ya parseado) en un `Proyecto`
// congelado, o rechaza COMPLETO con motivos estructurados — nunca un objeto parcial
// (R2). Este módulo NO conoce el catálogo (Gate 3/4): un `tipo` de componente que
// ningún catálogo reconoce hoy carga sin problema (`CATALOGO_COMPONENTE_DESCONOCIDO`
// es responsabilidad de `validar-tecnico.ts`, Gate 4) — sólo la FORMA del documento
// importa acá.
//
// Sin I/O (`node:fs` vive únicamente en `almacen.ts`, Gate 7): este archivo recibe el
// documento ya leído (o su string JSON) y no toca disco.

import type { ComportamientoRegla, Componente, Conexion, ExtremoConexion, Proyecto } from "./ir.ts"
import type { Motivo } from "./motivos.ts"
import { canonicalizar, congelarProfundo } from "./canonico.ts"
import { analizarIdsLocales, compararIdsLocales, generarIdProyectoAleatorio, validarIdsYContador, type GeneradorIdProyecto } from "./id.ts"
import { analizarConexionesInvalidas } from "./conexion.ts"
import { materializarDatosPlanos, motivoEntradaNoPlano } from "./datos-planos.ts"

export const SCHEMA_VERSION_SOPORTADA = "1.0.0"

const CLAVES_PROYECTO = [
  "id",
  "schemaVersion",
  "catalogoVersion",
  "catalogoHash",
  "revision",
  "siguienteIdLocal",
  "placa",
  "componentes",
  "conexiones",
  "comportamientos",
  "metadata",
] as const

export type ResultadoCarga = { readonly ok: true; readonly proyecto: Proyecto } | { readonly ok: false; readonly motivos: readonly Motivo[] }

// ════════════════════════════════════════════════════════════════════════════════════
// crearProyecto — IR fresca, mismo módulo que la carga (ambas "producen un Proyecto válido")
// ════════════════════════════════════════════════════════════════════════════════════

export interface DependenciasCrearProyecto {
  readonly generadorId?: GeneradorIdProyecto
  readonly ahora?: () => string
  readonly catalogoVersion: string
  readonly catalogoHash: string
}

export function crearProyecto(deps: DependenciasCrearProyecto): Proyecto {
  const generar = deps.generadorId ?? generarIdProyectoAleatorio
  const ahora = deps.ahora ?? (() => new Date().toISOString())
  const proyecto: Proyecto = {
    id: generar(),
    schemaVersion: SCHEMA_VERSION_SOPORTADA,
    catalogoVersion: deps.catalogoVersion,
    catalogoHash: deps.catalogoHash,
    revision: 0,
    siguienteIdLocal: 0,
    placa: null,
    componentes: [],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: ahora() },
  }
  return congelarProfundo(proyecto)
}

// ════════════════════════════════════════════════════════════════════════════════════
// cargarProyecto
// ════════════════════════════════════════════════════════════════════════════════════

export function cargarProyecto(entrada: unknown): ResultadoCarga {
  let doc: unknown = entrada
  if (typeof entrada === "string") {
    try {
      doc = JSON.parse(entrada)
    } catch {
      return rechazo("DOCUMENTO_MALFORMADO", { razon: "el string no es JSON válido" })
    }
  }
  return validarFormaProyecto(doc)
}

// ════════════════════════════════════════════════════════════════════════════════════
// validarFormaProyecto — Phase 1.1, hallazgo externo CP-01 (checkpoint de T5, tratado
// como CRÍTICO, evidencia/T5/CP01_proyectoInicial_forma.txt).
//
// Ésta es la MISMA validación de forma/schema que `cargarProyecto()` aplica tras
// `JSON.parse` — extraída a su propia función exportada para que `crearMotorDeProyecto`
// (`motor.ts`, Gate 6) la reuse contra `proyectoInicial` sin copiarla. Antes de este
// fix, `crearMotorDeProyecto({ proyectoInicial })` construía un motor "operable" sobre
// un objeto que este mismo módulo rechazaría de entrada si llegara como documento: una
// clave desconocida en la raíz, `revision`/`siguienteIdLocal` con el tipo o el valor
// incorrecto (`-5`, `"7"`), un `schemaVersion` no soportado, o un componente con
// `tipo`/`pines` de tipo basura (`tipo:123`, `pines:"x"`) — ninguno de estos lo mira
// `validarProyecto`/`validarIdsYContador` (Gate 4, `validar.ts`/`id.ts`: ambos asumen
// un `Proyecto` YA bien tipado, TypeScript es sólo sintaxis borrable, sin protección en
// runtime). Peor: con `proyectoInicial` `undefined`/`null`/`{}`/`[]` esas dos funciones
// ni siquiera llegan a un `Motivo` — explotan con un `TypeError` crudo apenas tocan
// `proyecto.componentes`. IR-SPEC.md §6 exige que "el motor corre su PROPIA validación
// al construirse y se niega a operar sobre un estado ya roto" — un `proyectoInicial`
// es una puerta de entrada con los MISMOS invariantes que el loader (Brief, Phase 1.1
// §13/§31), nunca una vía más permisiva.
//
// Recibe un documento YA PARSEADO (`unknown`, nunca un string JSON — eso es
// responsabilidad exclusiva de `cargarProyecto`, que hace el `JSON.parse` y delega
// acá). Devuelve el mismo `ResultadoCarga` de siempre.
//
// Phase 1.1 (RX2, hallazgo externo RX2-03, CRÍTICO — revisión adversarial
// independiente #2): ésta es la ÚNICA puerta de entrada de un `Proyecto` no
// confiable — la usan tanto `cargarProyecto()` (Gate 2, documento externo) como
// `crearMotorDeProyecto({ proyectoInicial })` (Gate 6, motor.ts) — así que
// materializar ACÁ, una sola vez, ANTES de leer nada más, protege las dos puertas
// con un único mecanismo (nunca una copia por puerta). Antes de este fix,
// `cargarProyecto(objetoJS)` no tenía NINGÚN try/catch propio (a diferencia de
// `crearMotorDeProyecto`, que sí se había protegido en RX-01/6822c5a): un Proxy/
// getter en `componentes[i].propiedades`/`pines` crasheaba crudo. Peor, el doble
// recorrido de `pines` más abajo (`validarComponente`: `Object.values(...).every`
// para validar, `{...pines}` independiente para copiar) era un TOCTOU real — un
// Proxy que devuelve un string válido en la 1ª pasada y `42` en la 2ª colaba un
// valor fuera de schema que rompía el round-trip (`cargar(guardar(...))` volvía a
// rechazar el MISMO documento). Con `doc` ya materializado acá, todo el resto de
// esta función trabaja sobre una copia PLANA, congelable, leída una única vez —
// ninguna lectura posterior puede divergir de otra, así que el TOCTOU desaparece
// por construcción (ver `opencode/nucleo/datos-planos.ts` para el detalle
// completo). Ver `docs/programacion-intencion/IR-SPEC.md` §6.6.
// ════════════════════════════════════════════════════════════════════════════════════

export function validarFormaProyecto(docCrudo: unknown): ResultadoCarga {
  const materializado = materializarDatosPlanos<unknown>(docCrudo, "proyecto")
  if (!materializado.ok) {
    return { ok: false, motivos: [motivoEntradaNoPlano("estructural", materializado)] }
  }
  const doc = materializado.valor

  if (!esObjeto(doc)) {
    return rechazo("DOCUMENTO_MALFORMADO", { razon: "el documento no es un objeto" })
  }

  const clavesDoc = Object.keys(doc)
  const clavesConocidas: readonly string[] = CLAVES_PROYECTO
  const desconocidas = clavesDoc.filter((k) => !clavesConocidas.includes(k))
  if (desconocidas.length > 0) {
    return rechazo("CLAVE_DESCONOCIDA", { claves: desconocidas })
  }

  const faltantes = CLAVES_PROYECTO.filter((k) => !(k in doc))
  if (faltantes.length > 0) {
    return rechazo("CAMPO_REQUERIDO_FALTANTE", { campos: faltantes })
  }

  const { id, schemaVersion, catalogoVersion, catalogoHash, revision, siguienteIdLocal, placa, componentes, conexiones, comportamientos, metadata } = doc

  if (typeof id !== "string" || id.length === 0) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "id" })

  // Único chequeo de schemaVersion: "más nueva que la soportada" (`compararVersiones`
  // fail-closed: una versión no parseable cuenta como "más nueva", nunca se asume
  // compatible algo que no se entiende). Deliberadamente SIN un segundo chequeo de
  // igualdad estricta como red de seguridad: con dos checks, invertir este operador
  // (mutación de Gate 2) quedaría enmascarado por el segundo y el test no lo
  // detectaría — ver docs/programacion-intencion/DECISIONS.md, entrada de Gate 2.
  // Límite conocido: una versión bien formada pero MÁS VIEJA que "1.0.0" (que hoy no
  // existe — Fase 1 nace en 1.0.0) pasaría este único chequeo sin rechazar; se
  // documenta como límite aceptado de Gate 2, no como bug.
  if (typeof schemaVersion !== "string" || compararVersiones(schemaVersion, SCHEMA_VERSION_SOPORTADA) > 0) {
    return rechazo("VERSION_SCHEMA_DESCONOCIDA", { recibida: schemaVersion })
  }

  if (typeof catalogoVersion !== "string") return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "catalogoVersion" })
  if (typeof catalogoHash !== "string") return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "catalogoHash" })
  if (!esEnteroNoNegativo(revision)) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "revision" })
  if (!esEnteroNoNegativo(siguienteIdLocal)) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "siguienteIdLocal" })
  if (placa !== null && typeof placa !== "string") return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "placa" })
  if (!esObjeto(metadata) || typeof metadata.creadoEn !== "string") {
    return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "metadata.creadoEn" })
  }
  if (!Array.isArray(componentes)) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "componentes" })
  if (!Array.isArray(conexiones)) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "conexiones" })
  if (!Array.isArray(comportamientos)) return rechazo("CAMPO_REQUERIDO_FALTANTE", { campo: "comportamientos" })

  const componentesValidados: Componente[] = []
  for (const c of componentes) {
    const r = validarComponente(c)
    if (!r.ok) return rechazo(r.codigo, r.datos)
    componentesValidados.push(r.valor)
  }

  // Duplicados DENTRO de componentes se chequean ACÁ, antes de construir el Set de
  // referencia para conexiones/comportamientos: si dos componentes comparten id, el
  // Set los pisaría uno al otro y dejaría pasar una referencia a un id que en
  // realidad NO identifica a una única entidad (`analizarIdsLocales`, id.ts — misma
  // función que el chequeo combinado de más abajo, no una copia).
  const analisisComponentes = analizarIdsLocales(componentesValidados.map((c) => c.id))
  if (analisisComponentes.duplicados.length > 0) {
    return rechazo("ID_DUPLICADO", { ids: analisisComponentes.duplicados })
  }

  const idsComponentes = new Set<string>(componentesValidados.map((c) => c.id))

  const conexionesValidadas: Conexion[] = []
  for (const cx of conexiones) {
    const r = validarConexion(cx)
    if (!r.ok) return rechazo(r.codigo, r.datos)
    conexionesValidadas.push(r.valor)
  }
  for (const cx of conexionesValidadas) {
    if (!idsComponentes.has(cx.desde.componente)) {
      return rechazo("REFERENCIA_ROTA_AL_CARGAR", { conexion: cx.id, componente: cx.desde.componente })
    }
    if (!idsComponentes.has(cx.hasta.componente)) {
      return rechazo("REFERENCIA_ROTA_AL_CARGAR", { conexion: cx.id, componente: cx.hasta.componente })
    }
  }

  const comportamientosValidados: ComportamientoRegla[] = []
  for (const b of comportamientos) {
    const r = validarComportamiento(b)
    if (!r.ok) return rechazo(r.codigo, r.datos)
    comportamientosValidados.push(r.valor)
  }
  for (const b of comportamientosValidados) {
    if (!idsComponentes.has(b.cuando.sensor)) {
      return rechazo("REFERENCIA_ROTA_AL_CARGAR", { comportamiento: b.id, componente: b.cuando.sensor })
    }
    if (!idsComponentes.has(b.entonces.actuador)) {
      return rechazo("REFERENCIA_ROTA_AL_CARGAR", { comportamiento: b.id, componente: b.entonces.actuador })
    }
  }

  // Unicidad de ids MÁS ALLÁ de componentes + consistencia del contador (Phase 1.1,
  // hallazgos externos E1-01/E1-02 — PHASE_1_EXTERNAL_FINDINGS.md, regla completa en
  // `id.ts`, `validarIdsYContador`): un documento puede ser referencialmente sano y
  // aun así traer ids repetidos entre conexiones/comportamientos, o un
  // `siguienteIdLocal` que dejaría a la PRÓXIMA operación que genera un id local
  // (`AgregarComponente`/`Conectar`/`SetComportamiento`, comparten un único contador,
  // `id.ts`) reproducir un id que ya existe. La MISMA regla corre también al construir
  // `crearMotorDeProyecto` (motor.ts) para la puerta de un `Proyecto` que bypasea este
  // loader (IR-SPEC.md §6) — un solo lugar, nunca copiada.
  const motivosIds = validarIdsYContador({ componentes: componentesValidados, conexiones: conexionesValidadas, comportamientos: comportamientosValidados, siguienteIdLocal })
  if (motivosIds.length > 0) return { ok: false, motivos: motivosIds }

  // Phase 1.1 (hallazgo externo E2-01, CRÍTICO — PHASE_1_EXTERNAL_FINDINGS.md): "sin
  // auto-conexión (self-loop) / sin conexión duplicada" antes SÓLO existía como
  // chequeo ad-hoc dentro de `aplicarConectar` (`operaciones.ts`) — un documento con
  // self-loop o con dos conexiones que conectan el MISMO par de terminales (sin
  // importar el orden, ver `conexion.ts`) cargaba SIN ningún diagnóstico
  // (evidencia/e2/exp1b_selfloop_listo_true.mjs). `analizarConexionesInvalidas`
  // (`conexion.ts`) es la MISMA función que reusa `validar-estructural.ts` (Gate 4,
  // IR-SPEC.md §6.3) para cerrar esta puerta también en `proyectoInicial`/
  // `validarProyecto` — acá con su propio código, momento de carga (mismo criterio que
  // `REFERENCIA_ROTA_AL_CARGAR` frente a `REFERENCIA_INEXISTENTE`). Corre DESPUÉS de
  // `validarIdsYContador`: un documento con ids duplicados (`conn-0` repetido dos
  // veces, aunque también forme un par eléctrico duplicado) reporta primero
  // `ID_DUPLICADO` — mismo orden ya establecido y probado por
  // "id-duplicado-entre-conexiones-rechaza" (E1-02).
  const analisisConexiones = analizarConexionesInvalidas(conexionesValidadas)
  if (analisisConexiones.autoconexiones.length > 0) {
    return rechazo("AUTOCONEXION_INVALIDA_AL_CARGAR", { conexiones: analisisConexiones.autoconexiones })
  }
  if (analisisConexiones.duplicadas.length > 0) {
    return rechazo("CONEXION_DUPLICADA_AL_CARGAR", { conexiones: analisisConexiones.duplicadas })
  }

  // El orden de entrada del array NUNCA afecta la forma canónica cargada: se ordena
  // por id local (numérico sobre el sufijo "-<n>"), no por orden de aparición en el
  // documento — dos documentos con los mismos componentes en distinto orden cargan al
  // MISMO Proyecto (test "orden-de-array-no-afecta-forma-canonica").
  componentesValidados.sort((a, b) => compararIdsLocales(a.id, b.id))
  conexionesValidadas.sort((a, b) => compararIdsLocales(a.id, b.id))
  comportamientosValidados.sort((a, b) => compararIdsLocales(a.id, b.id))

  const proyecto: Proyecto = {
    id,
    schemaVersion,
    catalogoVersion,
    catalogoHash,
    revision,
    siguienteIdLocal,
    placa,
    componentes: componentesValidados,
    conexiones: conexionesValidadas,
    comportamientos: comportamientosValidados,
    metadata: { creadoEn: metadata.creadoEn },
  }
  return { ok: true, proyecto: congelarProfundo(proyecto) }
}

// ════════════════════════════════════════════════════════════════════════════════════
// helpers de validación de forma
// ════════════════════════════════════════════════════════════════════════════════════

type ResultadoValidacion<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly codigo: string; readonly datos?: Record<string, unknown> }

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX) — hallazgo externo RX-01, CRÍTICO (revisión adversarial independiente,
// reabre CP-01): §6 de IR-SPEC.md sólo describe fail-closed ante claves desconocidas a
// nivel TOP-LEVEL del documento ("claves top-level... fail-closed: una clave
// desconocida rechaza") — el contrato NO dice nada sobre una clave desconocida DENTRO
// de un `Componente`/`Conexion`/`ComportamientoRegla` anidado. Antes de este fix,
// `validarComponente`/`validarConexion`/`validarComportamiento` (de acá abajo) sólo
// DESESTRUCTURABAN los campos que conocían — una clave extra en el objeto anidado ni se
// rechazaba ni se reportaba, se descartaba en silencio (la "copia saneada" que
// devuelven en realidad nunca excluía nada: sólo reconstruía por spread selectivo
// desde los campos que sabía leer). Dado el silencio del contrato, se aplica el MISMO
// criterio fail-closed que ya rige a nivel raíz (mismo código `CLAVE_DESCONOCIDA`,
// categoría `estructural`) — nunca reparar en silencio (regla dura del brief).
// `propiedades` (`Componente`, `ir.ts`: "Bolsa abierta; el catálogo valida forma y
// rango, la IR no") es la ÚNICA excepción a propósito: es de forma libre por diseño,
// nunca se valida así.
// ════════════════════════════════════════════════════════════════════════════════════

const CLAVES_COMPONENTE = ["id", "tipo", "pines", "propiedades"] as const
const CLAVES_CONEXION = ["id", "desde", "hasta"] as const
const CLAVES_EXTREMO_CONEXION = ["componente", "terminal"] as const
const CLAVES_COMPORTAMIENTO = ["id", "cuando", "entonces"] as const
const CLAVES_CUANDO_COMPORTAMIENTO = ["sensor", "capacidad", "comparador", "umbral"] as const
const CLAVES_UMBRAL_COMPORTAMIENTO = ["valor", "unidad", "magnitud"] as const
const CLAVES_ENTONCES_COMPORTAMIENTO = ["actuador", "accion"] as const

function clavesDesconocidasDe(obj: Record<string, unknown>, conocidas: readonly string[]): readonly string[] {
  return Object.keys(obj).filter((k) => !conocidas.includes(k))
}

function validarComponente(c: unknown): ResultadoValidacion<Componente> {
  if (!esObjeto(c)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", razon: "no es un objeto" } }
  const clavesDesconocidas = clavesDesconocidasDe(c, CLAVES_COMPONENTE)
  if (clavesDesconocidas.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "componente", claves: clavesDesconocidas } }
  }
  const { id, tipo, pines, propiedades } = c
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", campo: "id" } }
  }
  if (typeof tipo !== "string" || tipo.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "tipo" } }
  }
  if (!esObjeto(pines)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "pines" } }
  }
  // Phase 1.1 (RX2, hallazgo externo RX2-03b): un ÚNICO recorrido — antes había dos
  // (`Object.values(pines).every(...)` para validar, `{...pines}` independiente
  // para copiar), un TOCTOU real sobre un objeto vivo. Con `doc` ya materializado
  // (plano, leído una sola vez) el TOCTOU ya no es alcanzable, pero dos pasadas
  // sobre el MISMO dato siguen siendo dos fuentes de verdad — se valida y se copia
  // en el mismo paso, nunca por separado.
  //
  // Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — ver `datos-planos.ts` para
  // el detalle completo): `pinesCopiados` es un objeto plano `{}` — asignar por
  // corchetes (`pinesCopiados[clave] = valorPin`) sobre una clave de USUARIO
  // (`clave` viene de `Object.entries(pines)`, un pin-name arbitrario del
  // documento) dispara el setter heredado `Object.prototype.__proto__` si
  // `clave === "__proto__"`, EXACTAMENTE el mismo bug de clase que
  // `materializarDatosPlanos` tenía. `pines` ya llegó acá materializado de forma
  // segura (por eso `doc` nunca puede traer un `__proto__` corrompiendo SU
  // prototipo), pero este bucle propio construye un objeto NUEVO con el mismo
  // patrón vulnerable — `Object.defineProperty` (semántica
  // `[[DefineOwnProperty]]`, nunca `[[Set]]`) es inmune a cualquier setter
  // heredado, conocido o futuro.
  const pinesCopiados: Record<string, string | null> = {}
  for (const [clave, valorPin] of Object.entries(pines)) {
    if (valorPin !== null && typeof valorPin !== "string") {
      return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "pines" } }
    }
    Object.defineProperty(pinesCopiados, clave, { value: valorPin, enumerable: true, writable: true, configurable: true })
  }
  if (!esObjeto(propiedades)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "propiedades" } }
  }
  return { ok: true, valor: { id, tipo, pines: pinesCopiados, propiedades: { ...propiedades } } }
}

function validarExtremoConexion(e: unknown, conexionId: string, lado: "desde" | "hasta"): ResultadoValidacion<ExtremoConexion> {
  if (!esObjeto(e)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", conexion: conexionId, campo: lado } }
  const clavesDesconocidas = clavesDesconocidasDe(e, CLAVES_EXTREMO_CONEXION)
  if (clavesDesconocidas.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "conexion", conexion: conexionId, campo: lado, claves: clavesDesconocidas } }
  }
  if (typeof e.componente !== "string" || typeof e.terminal !== "string") {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", conexion: conexionId, campo: lado } }
  }
  return { ok: true, valor: { componente: e.componente, terminal: e.terminal } }
}

function validarConexion(cx: unknown): ResultadoValidacion<Conexion> {
  if (!esObjeto(cx)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", razon: "no es un objeto" } }
  const clavesDesconocidas = clavesDesconocidasDe(cx, CLAVES_CONEXION)
  if (clavesDesconocidas.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "conexion", claves: clavesDesconocidas } }
  }
  const { id, desde, hasta } = cx
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", campo: "id" } }
  }
  const rDesde = validarExtremoConexion(desde, id, "desde")
  if (!rDesde.ok) return rDesde
  const rHasta = validarExtremoConexion(hasta, id, "hasta")
  if (!rHasta.ok) return rHasta
  return { ok: true, valor: { id, desde: rDesde.valor, hasta: rHasta.valor } }
}

const COMPARADORES = new Set([">", "<", ">=", "<="])
const ACCIONES = new Set(["encender", "apagar"])

function validarComportamiento(b: unknown): ResultadoValidacion<ComportamientoRegla> {
  if (!esObjeto(b)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", razon: "no es un objeto" } }
  const clavesDesconocidasRaiz = clavesDesconocidasDe(b, CLAVES_COMPORTAMIENTO)
  if (clavesDesconocidasRaiz.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "comportamiento", claves: clavesDesconocidasRaiz } }
  }
  const { id, cuando, entonces } = b
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", campo: "id" } }
  }
  if (!esObjeto(cuando)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando" } }
  const clavesDesconocidasCuando = clavesDesconocidasDe(cuando, CLAVES_CUANDO_COMPORTAMIENTO)
  if (clavesDesconocidasCuando.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando", claves: clavesDesconocidasCuando } }
  }
  const { sensor, capacidad, comparador, umbral } = cuando
  if (typeof sensor !== "string" || typeof capacidad !== "string" || typeof comparador !== "string" || !COMPARADORES.has(comparador)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando" } }
  }
  if (!esObjeto(umbral)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando.umbral" } }
  const clavesDesconocidasUmbral = clavesDesconocidasDe(umbral, CLAVES_UMBRAL_COMPORTAMIENTO)
  if (clavesDesconocidasUmbral.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando.umbral", claves: clavesDesconocidasUmbral } }
  }
  if (typeof umbral.valor !== "number" || typeof umbral.unidad !== "string" || typeof umbral.magnitud !== "string") {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando.umbral" } }
  }
  // Phase 1.1 (hallazgo externo E1-03): `typeof umbral.valor !== "number"` NO alcanza
  // — `typeof NaN === "number"` y `typeof Infinity === "number"` son ciertos los dos,
  // así que el chequeo de arriba solo los deja pasar. Ninguno de los dos es
  // representable en el documento JSON persistido (`JSON.stringify(NaN)` y
  // `JSON.stringify(Infinity)` dan `null`, ver `canonico.ts`): aceptar acá dejaría a
  // la memoria (con el número real) desincronizada del disco (con `null`) apenas se
  // persistiera una vez — rechazo ESTRUCTURAL de forma, no un problema
  // técnico/semántico de catálogo (eso es `validar-tecnico.ts`, representable).
  // Código distinto del que usa la segunda línea de defensa de Gate 4
  // (`UMBRAL_NO_FINITO`, `validar-estructural.ts`) — mismo criterio de distinción
  // momento-de-carga vs. momento-de-operación que ya usa `REFERENCIA_ROTA_AL_CARGAR`
  // frente a `REFERENCIA_INEXISTENTE` más abajo en este mismo archivo.
  if (!Number.isFinite(umbral.valor)) {
    return { ok: false, codigo: "UMBRAL_NO_FINITO_AL_CARGAR", datos: { entidad: "comportamiento", comportamiento: id, valor: String(umbral.valor) } }
  }
  if (!esObjeto(entonces)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "entonces" } }
  const clavesDesconocidasEntonces = clavesDesconocidasDe(entonces, CLAVES_ENTONCES_COMPORTAMIENTO)
  if (clavesDesconocidasEntonces.length > 0) {
    return { ok: false, codigo: "CLAVE_DESCONOCIDA", datos: { entidad: "comportamiento", comportamiento: id, campo: "entonces", claves: clavesDesconocidasEntonces } }
  }
  const { actuador, accion } = entonces
  if (typeof actuador !== "string" || typeof accion !== "string" || !ACCIONES.has(accion)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "entonces" } }
  }
  return {
    ok: true,
    valor: {
      id,
      cuando: { sensor, capacidad, comparador: comparador as ComportamientoRegla["cuando"]["comparador"], umbral: { valor: umbral.valor, unidad: umbral.unidad, magnitud: umbral.magnitud } },
      entonces: { actuador, accion: accion as ComportamientoRegla["entonces"]["accion"] },
    },
  }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/** Phase 1.1 (hallazgo externo RX-06, NOTA): única definición — antes duplicada
 * verbatim en `motor.ts` (`baseRevision`) y acá (`revision`/`siguienteIdLocal`). No
 * divergía (mismo comportamiento en ambos, incluida la aceptación de `-0`), pero
 * dos copias de la MISMA regla es una violación de DRY que arriesga que una futura
 * edición cambie una y no la otra. `motor.ts` la importa de acá.
 *
 * Phase 1.1 (RX4, hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial
 * independiente, RX4_REPORT.md; RECLASIFICA E1-04, ver DECISIONS.md): antes de
 * este fix, `Number.isInteger(v)` no tenía cota superior — `Number.isInteger(1e21)`
 * es `true` en JS (representación IEEE-754 sin parte fraccionaria a esa magnitud),
 * así que un documento con `"revision": 1e21` pasaba sin diagnóstico. El
 * invariante que esta función existe para sostener es que `revision`/
 * `siguienteIdLocal`/`baseRevision` son enteros cuyo INCREMENTO (`+1`, `motor.ts`/
 * `operaciones.ts`) tiene que seguir siendo exacto — ese invariante deriva
 * directamente la cota: `Number.isSafeInteger` (`Math.abs(v) <=
 * Number.MAX_SAFE_INTEGER`, además de `Number.isInteger`), nunca una regla de
 * producto arbitraria. Más allá de `Number.MAX_SAFE_INTEGER`, `v + 1 === v`
 * (colapso de precisión IEEE-754): con `revision` congelada en un valor aparente
 * para siempre, el compare-and-swap optimista (`baseRevision !== canonico.
 * revision`, E3-01/E3-07, brief §33) queda neutralizado en silencio — el mismo
 * `baseRevision` "viejo" sigue pareciendo al día indefinidamente. Ver
 * `motor.ts::ejecutarLote` (guarda adicional: el COMMIT se niega a producir un
 * incremento que ya no sea exacto, incluso si `revision` entró siendo un entero
 * seguro) y `operaciones.ts` (guarda equivalente para `siguienteIdLocal`). */
export function esEnteroNoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0
}

function rechazo(codigo: string, datos?: Record<string, unknown>): { readonly ok: false; readonly motivos: readonly Motivo[] } {
  return {
    ok: false,
    motivos: [{ codigo, categoria: "estructural", severidad: "blocking", clasificacion: "rechazo", datos }],
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// comparación de schemaVersion (semver "major.minor.patch" simplificado)
// ════════════════════════════════════════════════════════════════════════════════════

function parsearVersion(v: string): readonly [number, number, number] | null {
  const partes = v.split(".")
  if (partes.length !== 3) return null
  const numeros = partes.map(Number)
  if (numeros.some((n) => Number.isNaN(n))) return null
  const [mayor, menor, parche] = numeros
  if (mayor === undefined || menor === undefined || parche === undefined) return null
  return [mayor, menor, parche]
}

/** > 0 si `a` es más nueva que `b`. Fail-closed: si no se puede parsear, se trata como
 * "más nueva" (1) — nunca se asume compatible algo que no se entiende. */
function compararVersiones(a: string, b: string): number {
  const pa = parsearVersion(a)
  const pb = parsearVersion(b)
  if (!pa || !pb) return 1
  const [a0, a1, a2] = pa
  const [b0, b1, b2] = pb
  if (a0 !== b0) return a0 > b0 ? 1 : -1
  if (a1 !== b1) return a1 > b1 ? 1 : -1
  if (a2 !== b2) return a2 > b2 ? 1 : -1
  return 0
}

// re-export sólo para que el test de round-trip pueda usar la misma canonicalización.
export { canonicalizar }
