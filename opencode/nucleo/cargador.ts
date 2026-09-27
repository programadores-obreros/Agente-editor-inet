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

function validarComponente(c: unknown): ResultadoValidacion<Componente> {
  if (!esObjeto(c)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", razon: "no es un objeto" } }
  const { id, tipo, pines, propiedades } = c
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", campo: "id" } }
  }
  if (typeof tipo !== "string" || tipo.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "tipo" } }
  }
  if (!esObjeto(pines) || !Object.values(pines).every((v) => v === null || typeof v === "string")) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "pines" } }
  }
  if (!esObjeto(propiedades)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "componente", componente: id, campo: "propiedades" } }
  }
  return { ok: true, valor: { id, tipo, pines: { ...pines } as Record<string, string | null>, propiedades: { ...propiedades } } }
}

function validarExtremoConexion(e: unknown, conexionId: string, lado: "desde" | "hasta"): ResultadoValidacion<ExtremoConexion> {
  if (!esObjeto(e) || typeof e.componente !== "string" || typeof e.terminal !== "string") {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", conexion: conexionId, campo: lado } }
  }
  return { ok: true, valor: { componente: e.componente, terminal: e.terminal } }
}

function validarConexion(cx: unknown): ResultadoValidacion<Conexion> {
  if (!esObjeto(cx)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "conexion", razon: "no es un objeto" } }
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
  const { id, cuando, entonces } = b
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", campo: "id" } }
  }
  if (!esObjeto(cuando)) return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando" } }
  const { sensor, capacidad, comparador, umbral } = cuando
  if (typeof sensor !== "string" || typeof capacidad !== "string" || typeof comparador !== "string" || !COMPARADORES.has(comparador)) {
    return { ok: false, codigo: "CAMPO_REQUERIDO_FALTANTE", datos: { entidad: "comportamiento", comportamiento: id, campo: "cuando" } }
  }
  if (!esObjeto(umbral) || typeof umbral.valor !== "number" || typeof umbral.unidad !== "string" || typeof umbral.magnitud !== "string") {
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

function esEnteroNoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0
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
