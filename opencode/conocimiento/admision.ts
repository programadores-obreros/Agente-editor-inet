// Admisión de componentes — Component System Foundation #1, F7 (Decision Freeze, D-13 /
// D-17 / 05-COMPONENT-ADMISSION-CONTRACT.md).
//
// Suite determinista, sin UI (D-14): para cada placa y cada tipo de componente del
// catálogo calcula flags de soporte INDEPENDIENTES (no hay un enum lineal: un tipo puede
// estar validado sin estar dibujado). `officiallySupported` se DERIVA de los flags; nunca se
// declara a mano. El único dato humano es la revisión eléctrica
// (`anexos/revision-electrica.ts`): ningún flag lo aprueba la IA ni un importador.
//
// Component Knowledge F2a: este módulo es sólo REGLAS de admisión. No contiene datos de
// piezas: la revisión eléctrica (por par componente/placa, CK-04) y el golden de pines
// Wokwi viven en anexos, y los vocabularios válidos (clases, roles, eléctricas, unidades por
// magnitud) salen de `nucleo/registros/vocabulario.ts`, la misma fuente de la que se derivan
// los tipos del catálogo.
//
// El flag `tests` del contrato es la propia suite (`tests/componentes-admision.test.mjs`)
// corriendo en `pnpm test`: no se calcula acá.
//
// Sólo lee: el catálogo (vía `ComponentKnowledge`) y los anexos. No muta nada.

import type { ComponenteCatalogo, Requisito } from "../nucleo/catalogo.ts"
import { DEFINICIONES_ACCION, TIPOS_DE_REQUISITO_CON_EVALUADOR } from "../nucleo/catalogo.ts"
import type { Placa } from "../nucleo/placas.ts"
import { CLASES, ELECTRICAS, ROLES_DE_TERMINAL, unidadesDeMagnitud } from "../nucleo/registros/vocabulario.ts"
import { nombreWokwiDePin } from "./anexos/representacion.ts"
import { PINES_VERIFICADOS_WOKWI } from "./anexos/golden-wokwi.ts"
import { REVISIONES_DE_COMPONENTE, REVISIONES_DE_PLACA, type RevisionDeComponente, type RevisionDePlaca } from "./anexos/revision-electrica.ts"
import type { ComponentKnowledge } from "./conocimiento.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Revisión eléctrica (dato en `anexos/revision-electrica.ts`)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Marcadores que la convención del repo reserva para una revisión NO humana. `auto` es el que
 * ya documentan la procedencia ("Revisión HUMANA (nunca 'auto')") y D-13 ("ningún flag lo
 * aprueba la IA ni un importador").
 */
const MARCADORES_DE_REVISION_NO_HUMANA: ReadonlySet<string> = new Set(["auto"])

/**
 * La ÚNICA regla de "revisor humano válido" de la admisión (post-D0, cierra L-5): un texto no
 * vacío que no sea un marcador de revisión no humana, comparado sin distinguir mayúsculas ni
 * espacios alrededor. La usan la revisión eléctrica (componente, placa, par) y la procedencia.
 * Antes la revisión eléctrica sólo miraba si existía una entrada para el id, sin leer
 * `revisadoPor`. No autentica a nadie: hace cumplir la convención declarada en los anexos.
 */
export function esRevisorHumano(revisadoPor: unknown): boolean {
  if (typeof revisadoPor !== "string") return false
  const normalizado = revisadoPor.trim().toLowerCase()
  return normalizado.length > 0 && !MARCADORES_DE_REVISION_NO_HUMANA.has(normalizado)
}

/** Revisiones eléctricas que lee la admisión. Por defecto, el anexo; inyectable en tests. */
export interface RevisionesElectricas {
  readonly componentes: readonly RevisionDeComponente[]
  readonly placas: readonly RevisionDePlaca[]
}

export const REVISIONES_DEL_ANEXO: RevisionesElectricas = Object.freeze({ componentes: REVISIONES_DE_COMPONENTE, placas: REVISIONES_DE_PLACA })

type EstadoDeRevision = "valida" | "no-humana" | "ausente"

function estadoDeRevision(candidatas: readonly { readonly revisadoPor: unknown }[]): EstadoDeRevision {
  if (candidatas.length === 0) return "ausente"
  return candidatas.some((r) => esRevisorHumano(r.revisadoPor)) ? "valida" : "no-humana"
}

function revisionDeComponente(tipo: string, revisiones: RevisionesElectricas): EstadoDeRevision {
  return estadoDeRevision(revisiones.componentes.filter((r) => r.tipo === tipo))
}

function revisionDePlaca(placa: string, revisiones: RevisionesElectricas): EstadoDeRevision {
  return estadoDeRevision(revisiones.placas.filter((r) => r.placa === placa))
}

/** El problema que se reporta para una revisión eléctrica que no es válida. */
function problemaDeRevision(estado: Exclude<EstadoDeRevision, "valida">): string {
  return estado === "ausente" ? "electrico: sin revisión eléctrica humana" : "electrico: la revisión eléctrica no es humana (revisadoPor vacío o marcador de revisión automática)"
}

/**
 * CK-04: ¿hay revisión eléctrica humana VÁLIDA de `tipo` PARA `placa`? Es un reporte: no
 * entra en los flags ni en `officiallySupported` (el flag `electrico` sigue siendo "revisado
 * para alguna placa").
 */
export function compatibilidadRevisada(tipo: string, placa: string, revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO): boolean {
  return revisiones.componentes.some((r) => r.tipo === tipo && r.placa === placa && esRevisorHumano(r.revisadoPor))
}

/**
 * Vista DERIVADA por id de las revisiones (placas y componentes), con la forma que tenía antes
 * de F2a. La fuente es el anexo; esto sólo la reexpone.
 */
export const REVISION_ELECTRICA: Readonly<Record<string, { readonly revisadoPor: string; readonly evidencia: string }>> = Object.freeze(
  Object.fromEntries([
    ...REVISIONES_DE_PLACA.map((r) => [r.placa, Object.freeze({ revisadoPor: r.revisadoPor, evidencia: r.evidencia })] as const),
    ...REVISIONES_DE_COMPONENTE.map((r) => [r.tipo, Object.freeze({ revisadoPor: r.revisadoPor, evidencia: r.evidencia })] as const),
  ]),
)

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════════════════════

export type Categoria = "placa" | "pasivo" | "entrada" | "sensor" | "actuador"

export interface FlagsDeSoporte {
  readonly semantico: boolean
  readonly electrico: boolean
  readonly representacion: { readonly wokwi: boolean }
  /** `null` = no aplica (no es actuador). */
  readonly acciones: boolean | null
  readonly pedagogia: boolean
  readonly procedencia: boolean
}

export interface InformeDeAdmision {
  readonly kind: "placa" | "componente"
  readonly id: string
  readonly categoria: Categoria
  readonly flags: FlagsDeSoporte
  readonly officiallySupported: boolean
  /** Por qué falla cada flag (vacío si todo pasa). Texto de ingeniería, no pedagógico. */
  readonly problemas: readonly string[]
}

const ID_ESTABLE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CLASES_VALIDAS: ReadonlySet<string> = new Set(CLASES)
const ROLES_VALIDOS: ReadonlySet<string> = new Set(ROLES_DE_TERMINAL)
const ELECTRICAS_VALIDAS: ReadonlySet<string> = new Set(ELECTRICAS)

function esCantidadValida(c: unknown): boolean {
  if (typeof c !== "object" || c === null) return false
  const { valor, unidad, magnitud } = c as { valor?: unknown; unidad?: unknown; magnitud?: unknown }
  return typeof valor === "number" && Number.isFinite(valor) && typeof magnitud === "string" && unidadesDeMagnitud(magnitud).includes(unidad as string)
}

function derivar(flags: FlagsDeSoporte): boolean {
  return flags.semantico && flags.electrico && flags.representacion.wokwi && flags.pedagogia && flags.procedencia && flags.acciones !== false
}

function chequearProcedencia(conocimiento: ComponentKnowledge, assetId: string | undefined, problemas: string[]): boolean {
  if (assetId === undefined) return false // sin representación no hay asset que registrar
  const registro = conocimiento.procedencia(assetId)
  if (!registro) {
    problemas.push(`procedencia: el asset "${assetId}" no tiene registro`)
    return false
  }
  const completo =
    registro.fuente.nombre.length > 0 &&
    registro.fuente.version.length > 0 &&
    /^[0-9a-f]{64}$/.test(registro.fuente.sha256) &&
    registro.licencia.spdx.length > 0 &&
    esRevisorHumano(registro.revisadoPor)
  if (!completo) problemas.push(`procedencia: el registro de "${assetId}" está incompleto`)
  return completo
}

// ════════════════════════════════════════════════════════════════════════════════════
// Componentes
// ════════════════════════════════════════════════════════════════════════════════════

function chequearRequisito(componente: ComponenteCatalogo, requisito: Requisito, problemas: string[]): boolean {
  let ok = true
  if (!TIPOS_DE_REQUISITO_CON_EVALUADOR.has(requisito.tipo)) {
    // Un requisito sin evaluador no se finge validado (D-13).
    problemas.push(`electrico: el requisito "${requisito.tipo}" no tiene evaluador en el motor`)
    ok = false
  }
  if (requisito.enTerminal !== undefined && !componente.terminales.some((t) => t.id === requisito.enTerminal)) {
    problemas.push(`electrico: el requisito "${requisito.tipo}" apunta a un terminal inexistente "${requisito.enTerminal}"`)
    ok = false
  }
  if (requisito.spec.valor !== undefined && !esCantidadValida(requisito.spec.valor)) {
    problemas.push(`electrico: el valor del requisito "${requisito.tipo}" no es una Cantidad válida`)
    ok = false
  }
  return ok
}

export function admitirComponente(conocimiento: ComponentKnowledge, tipo: string, revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO): InformeDeAdmision {
  const problemas: string[] = []
  const componente = conocimiento.tipoComponente(tipo)
  if (!componente) {
    const flags = { semantico: false, electrico: false, representacion: { wokwi: false }, acciones: null, pedagogia: false, procedencia: false }
    return { kind: "componente", id: tipo, categoria: "pasivo", flags, officiallySupported: false, problemas: [`semantico: "${tipo}" no está en el catálogo`] }
  }
  const categoria = componente.clase as Categoria

  // ── semántico (checks 1-3, 6) ──
  let semantico = true
  const fallaSemantica = (texto: string) => {
    semantico = false
    problemas.push(`semantico: ${texto}`)
  }
  if (!ID_ESTABLE.test(componente.id)) fallaSemantica(`id "${componente.id}" no es kebab-case ASCII`)
  if (conocimiento.catalogo.componentes.filter((c) => c.id === componente.id).length !== 1) fallaSemantica(`id "${componente.id}" duplicado`)
  if (!CLASES_VALIDAS.has(componente.clase)) fallaSemantica(`clase "${componente.clase}" inválida`)
  if (componente.terminales.length === 0) fallaSemantica("sin terminales")
  const idsTerminales = new Set<string>()
  for (const t of componente.terminales) {
    if (idsTerminales.has(t.id)) fallaSemantica(`terminal "${t.id}" duplicado`)
    idsTerminales.add(t.id)
    if (!ROLES_VALIDOS.has(t.rol)) fallaSemantica(`terminal "${t.id}" con rol inválido`)
    if (!ELECTRICAS_VALIDAS.has(t.electrica)) fallaSemantica(`terminal "${t.id}" con eléctrica inválida`)
    // `asignable` sólo derivado (D-04): tiene que coincidir con la regla única.
    if (t.asignable !== (t.electrica !== "riel-fijo")) fallaSemantica(`terminal "${t.id}" con asignable no derivado`)
    if (t.asignable && t.direccion === undefined) fallaSemantica(`terminal asignable "${t.id}" sin dirección`)
  }
  for (const c of componente.capacidades) {
    if (c.magnitud !== undefined && !unidadesDeMagnitud(c.magnitud).includes(c.unidad as string)) fallaSemantica(`capacidad "${c.id}" con unidad incoherente`)
    if (c.rango && (!esCantidadValida(c.rango.min) || !esCantidadValida(c.rango.max) || c.rango.min.valor > c.rango.max.valor)) fallaSemantica(`capacidad "${c.id}" con rango inválido`)
  }
  const placasCompatibles = componente.compatibilidades?.placas ?? []
  for (const p of placasCompatibles) if (!conocimiento.placa(p)) fallaSemantica(`compatibilidad con placa inexistente "${p}"`)

  // ── eléctrico (checks 5, 7 + revisión humana) ──
  let electrico = semantico
  for (const t of componente.terminales) {
    if (t.asignable) continue
    if (t.destinoFijo === undefined) {
      // Sin destino = puente: sólo un pasivo puede no ir a ningún riel.
      if (componente.clase !== "pasivo") {
        problemas.push(`electrico: terminal "${t.id}" riel-fijo sin destino en un componente no pasivo`)
        electrico = false
      }
      continue
    }
    for (const p of placasCompatibles) {
      const destino = conocimiento.resolverDestino(p, t)
      if (destino.kind !== "potencia" && destino.kind !== "pin" && destino.kind !== "externo") {
        problemas.push(`electrico: terminal "${t.id}" no resuelve a un terminal de potencia en "${p}"`)
        electrico = false
      }
    }
  }
  for (const r of componente.requisitos) if (!chequearRequisito(componente, r, problemas)) electrico = false
  const revisionComponente = revisionDeComponente(componente.id, revisiones)
  if (revisionComponente !== "valida") {
    problemas.push(problemaDeRevision(revisionComponente))
    electrico = false
  }

  // ── acciones (check 8, sólo actuadores) ──
  let acciones: boolean | null = null
  if (componente.clase === "actuador") {
    const declaradas = componente.acciones ?? []
    const registradas = new Set(DEFINICIONES_ACCION.map((d) => d.id))
    acciones = declaradas.length > 0 && declaradas.every((a) => registradas.has(a))
    if (!acciones) problemas.push("acciones: el actuador no declara acciones registradas")
    // Semantic Vertical #3: un complemento declarado tiene que ser coherente (simétrico y
    // registrado); de él se deriva el reposo de una regla de nivel.
    for (const a of declaradas) {
      const complemento = DEFINICIONES_ACCION.find((d) => d.id === a)?.complementaria
      if (complemento === undefined) continue
      const vuelta = DEFINICIONES_ACCION.find((d) => d.id === complemento)?.complementaria
      if (!registradas.has(complemento) || vuelta !== a) {
        problemas.push(`acciones: el complemento de "${a}" no es simétrico o no está registrado`)
        acciones = false
      }
    }
  }

  // ── representación Wokwi (check 9) ──
  const representacion = conocimiento.representacionWokwi("componente", componente.id)
  let wokwi = representacion !== undefined
  if (!representacion) problemas.push("representacion.wokwi: sin entrada en el anexo")
  else {
    const verificados = PINES_VERIFICADOS_WOKWI[representacion.elemento] ?? []
    for (const t of componente.terminales) {
      const ancla = representacion.terminales[t.id]
      if (typeof ancla !== "string" || !verificados.includes(ancla)) {
        problemas.push(`representacion.wokwi: terminal "${t.id}" sin ancla verificada`)
        wokwi = false
      }
    }
  }

  // ── pedagogía (check 10) ──
  let pedagogia = conocimiento.nombre("componente", componente.id) !== undefined
  if (!pedagogia) problemas.push("pedagogia: sin nombre es-AR")
  for (const t of componente.terminales) {
    if (conocimiento.etiquetaDeTerminal(componente.id, t.id) === undefined) {
      problemas.push(`pedagogia: terminal "${t.id}" caería al id crudo`)
      pedagogia = false
    }
  }

  // ── procedencia (check 11) ──
  const procedencia = chequearProcedencia(conocimiento, representacion?.assetId, problemas)

  const flags: FlagsDeSoporte = { semantico, electrico, representacion: { wokwi }, acciones, pedagogia, procedencia }
  return { kind: "componente", id: componente.id, categoria, flags, officiallySupported: derivar(flags), problemas }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Placas
// ════════════════════════════════════════════════════════════════════════════════════

export function admitirPlaca(conocimiento: ComponentKnowledge, id: string, revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO): InformeDeAdmision {
  const problemas: string[] = []
  const placa: Placa | undefined = conocimiento.placa(id)
  if (!placa) {
    const flags = { semantico: false, electrico: false, representacion: { wokwi: false }, acciones: null, pedagogia: false, procedencia: false }
    return { kind: "placa", id, categoria: "placa", flags, officiallySupported: false, problemas: [`semantico: placa "${id}" no está en el catálogo`] }
  }

  // ── semántico (checks 1, 2, 4, 6) ──
  let semantico = true
  const fallaSemantica = (texto: string) => {
    semantico = false
    problemas.push(`semantico: ${texto}`)
  }
  if (!ID_ESTABLE.test(placa.id)) fallaSemantica(`id "${placa.id}" no es kebab-case ASCII`)
  if (conocimiento.catalogo.placas.filter((p) => p.id === placa.id).length !== 1) fallaSemantica(`id "${placa.id}" duplicado`)
  if (placa.pines.length === 0) fallaSemantica("sin pines")
  const idsPines = new Set(placa.pines.map((p) => p.id))
  if (idsPines.size !== placa.pines.length) fallaSemantica("pines duplicados")
  if (!idsPines.has(placa.i2c.sda) || !idsPines.has(placa.i2c.scl)) fallaSemantica("i2c apunta a pines inexistentes")
  if (!(placa.adcMax > 0)) fallaSemantica("adcMax inválido")
  const idsPotencia = new Set(placa.terminalesDePotencia.map((t) => t.id))
  if (!idsPotencia.has("GND")) fallaSemantica("sin terminal de potencia GND")
  for (const t of placa.terminalesDePotencia) {
    if (idsPines.has(t.id)) fallaSemantica(`terminal de potencia "${t.id}" también figura como pin asignable`)
    if (t.tension !== undefined && !esCantidadValida(t.tension)) fallaSemantica(`tensión de "${t.id}" no es una Cantidad válida`)
  }
  for (const [destino, terminal] of Object.entries(placa.destinosDeRiel)) {
    if (!idsPotencia.has(terminal)) fallaSemantica(`destino de riel ${destino} → "${terminal}" no es un terminal de potencia`)
  }

  // ── eléctrico (revisión humana) ──
  let electrico = semantico
  const revisionPlaca = revisionDePlaca(placa.id, revisiones)
  if (revisionPlaca !== "valida") {
    problemas.push(problemaDeRevision(revisionPlaca))
    electrico = false
  }

  // ── representación Wokwi (check 9): potencia + pines asignables con nombre real ──
  const representacion = conocimiento.representacionWokwi("placa", placa.id)
  let wokwi = representacion !== undefined
  if (!representacion) problemas.push("representacion.wokwi: sin entrada en el anexo")
  else {
    const verificados = PINES_VERIFICADOS_WOKWI[representacion.elemento] ?? []
    for (const t of placa.terminalesDePotencia) {
      const anclas = representacion.terminales[t.id]
      if (!Array.isArray(anclas) || anclas.length === 0 || !anclas.every((a) => verificados.includes(a))) {
        problemas.push(`representacion.wokwi: terminal de potencia "${t.id}" sin anclas verificadas`)
        wokwi = false
      }
    }
    for (const pin of placa.pines) {
      const nombre = nombreWokwiDePin(pin)
      // `null` = la pieza no dibuja ese GPIO (decisión de presentación documentada en el anexo).
      if (nombre !== null && !verificados.includes(nombre)) {
        problemas.push(`representacion.wokwi: pin "${pin.id}" mapea a "${nombre}", que la pieza no expone`)
        wokwi = false
      }
    }
  }

  // ── pedagogía (check 10) ──
  let pedagogia = conocimiento.nombre("placa", placa.id) !== undefined
  if (!pedagogia) problemas.push("pedagogia: sin nombre es-AR")
  for (const t of placa.terminalesDePotencia) {
    if (conocimiento.etiquetaDeTerminalDePotencia(t.id) === undefined) {
      problemas.push(`pedagogia: terminal de potencia "${t.id}" sin etiqueta`)
      pedagogia = false
    }
  }

  // ── procedencia (check 11) ──
  const procedencia = chequearProcedencia(conocimiento, representacion?.assetId, problemas)

  const flags: FlagsDeSoporte = { semantico, electrico, representacion: { wokwi }, acciones: null, pedagogia, procedencia }
  return { kind: "placa", id: placa.id, categoria: "placa", flags, officiallySupported: derivar(flags), problemas }
}

/** Informe de TODO el catálogo: placas primero, después componentes, en orden de datos. */
export function admitirCatalogo(conocimiento: ComponentKnowledge, revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO): readonly InformeDeAdmision[] {
  return [
    ...conocimiento.catalogo.placas.map((p) => admitirPlaca(conocimiento, p.id, revisiones)),
    ...conocimiento.catalogo.componentes.map((c) => admitirComponente(conocimiento, c.id, revisiones)),
  ]
}

/** Ids oficialmente soportados, ordenados (para fijarlos en un test). */
export function oficialmenteSoportados(conocimiento: ComponentKnowledge, revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO): readonly string[] {
  return admitirCatalogo(conocimiento, revisiones)
    .filter((i) => i.officiallySupported)
    .map((i) => i.id)
    .sort()
}
