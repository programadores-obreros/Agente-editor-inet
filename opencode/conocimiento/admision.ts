// Admisión de componentes — Component System Foundation #1, F7 (Decision Freeze, D-13 /
// D-17 / 05-COMPONENT-ADMISSION-CONTRACT.md).
//
// Suite determinista, sin UI (D-14): para cada placa y cada tipo de componente del
// catálogo calcula flags de soporte INDEPENDIENTES (no hay un enum lineal: hoy `dht22`
// se valida pero no se dibuja). `officiallySupported` se DERIVA de los flags; nunca se
// declara a mano. El único dato humano es la revisión eléctrica (`REVISION_ELECTRICA`):
// ningún flag lo aprueba la IA ni un importador.
//
// El flag `tests` del contrato es la propia suite (`tests/componentes-admision.test.mjs`)
// corriendo en `pnpm test`: no se calcula acá.
//
// Sólo lee: el catálogo (vía `ComponentKnowledge`) y los anexos. No muta nada.

import type { ComponenteCatalogo, Requisito } from "../nucleo/catalogo.ts"
import { DEFINICIONES_ACCION, TIPOS_DE_REQUISITO_CON_EVALUADOR } from "../nucleo/catalogo.ts"
import type { Placa } from "../nucleo/placas.ts"
import { nombreWokwiDePin } from "./anexos/representacion.ts"
import type { ComponentKnowledge } from "./conocimiento.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Datos humanos y golden
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Revisión eléctrica HUMANA (D-13): sin una entrada acá, `electrico` es `false` aunque
 * los checks derivados pasen. Foundation #1 sólo declara el conjunto inicial (D-17).
 */
export const REVISION_ELECTRICA: Readonly<Record<string, { readonly revisadoPor: string; readonly evidencia: string }>> = {
  "esp32-devkit-v1": {
    revisadoPor: "revisión humana del Component System Decision Freeze (2026-10-04)",
    evidencia: "nucleo/placas.ts (pines, restricciones y terminales de potencia contra circuito.ts:624-667 y docs/wokwi-pinout-dump.md)",
  },
  led: {
    revisadoPor: "revisión humana del Component System Decision Freeze (2026-10-04)",
    evidencia: "nucleo/catalogo-datos.ts::LED (circuito.ts:947-975, 220 ohm en serie)",
  },
  resistencia: {
    revisadoPor: "revisión humana del Component System Decision Freeze (2026-10-04)",
    evidencia: "nucleo/catalogo-datos.ts::RESISTENCIA (puente sin polaridad, circuito.ts:117)",
  },
  pulsador: {
    revisadoPor: "revisión humana del Component System Decision Freeze (2026-10-04)",
    evidencia: "nucleo/catalogo-datos.ts::PULSADOR (INPUT_PULLUP, circuito.ts:1089-1105)",
  },
}

/**
 * Golden de representación: los pines que el custom element Wokwi REAL expone
 * (`el.pinInfo`, leído contra el bundle del repo). Un ancla del anexo de representación
 * que no esté acá no cuenta como verificada.
 * Fuentes: docs/wokwi-pinout-dump.md (UNO :17-63, LED :79, pushbutton :82) y la cabecera
 * de `anexos/representacion.ts` (los 30 pines del ESP32 y los de `wokwi-resistor`).
 */
export const PINES_VERIFICADOS_WOKWI: Readonly<Record<string, readonly string[]>> = {
  "wokwi-led": ["A", "C"],
  "wokwi-pushbutton": ["1.l", "2.l", "1.r", "2.r"],
  "wokwi-resistor": ["1", "2"],
  "wokwi-esp32-devkit-v1": [
    "3V3", "D12", "D13", "D14", "D15", "D18", "D19", "D2", "D21", "D22", "D23", "D25", "D26", "D27", "D32", "D33",
    "D34", "D35", "D4", "D5", "EN", "GND.1", "GND.2", "RX0", "RX2", "TX0", "TX2", "VIN", "VN", "VP",
  ],
  "wokwi-arduino-uno": [
    "A5.2", "A4.2", "AREF", "GND.1", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0",
    "IOREF", "RESET", "3.3V", "5V", "GND.2", "GND.3", "VIN", "A0", "A1", "A2", "A3", "A4", "A5",
  ],
}

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
const CLASES = new Set(["sensor", "actuador", "pasivo", "entrada"])
const ROLES = new Set(["alimentacion", "tierra", "senal", "anodo", "catodo"])
const ELECTRICAS = new Set(["digital", "analogica", "riel-fijo"])
const UNIDAD_DE_MAGNITUD: Readonly<Record<string, readonly string[]>> = {
  temperatura: ["celsius", "fahrenheit"],
  distancia: ["cm"],
  humedad: ["porcentaje"],
  porcentaje: ["porcentaje"],
  estadoBooleano: ["ninguna"],
  resistencia: ["ohm"],
  tension: ["volt"],
}

function esCantidadValida(c: unknown): boolean {
  if (typeof c !== "object" || c === null) return false
  const { valor, unidad, magnitud } = c as { valor?: unknown; unidad?: unknown; magnitud?: unknown }
  return typeof valor === "number" && Number.isFinite(valor) && typeof magnitud === "string" && (UNIDAD_DE_MAGNITUD[magnitud] ?? []).includes(unidad as string)
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
    registro.revisadoPor.length > 0 &&
    registro.revisadoPor !== "auto"
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

export function admitirComponente(conocimiento: ComponentKnowledge, tipo: string): InformeDeAdmision {
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
  if (!CLASES.has(componente.clase)) fallaSemantica(`clase "${componente.clase}" inválida`)
  if (componente.terminales.length === 0) fallaSemantica("sin terminales")
  const idsTerminales = new Set<string>()
  for (const t of componente.terminales) {
    if (idsTerminales.has(t.id)) fallaSemantica(`terminal "${t.id}" duplicado`)
    idsTerminales.add(t.id)
    if (!ROLES.has(t.rol)) fallaSemantica(`terminal "${t.id}" con rol inválido`)
    if (!ELECTRICAS.has(t.electrica)) fallaSemantica(`terminal "${t.id}" con eléctrica inválida`)
    // `asignable` sólo derivado (D-04): tiene que coincidir con la regla única.
    if (t.asignable !== (t.electrica !== "riel-fijo")) fallaSemantica(`terminal "${t.id}" con asignable no derivado`)
    if (t.asignable && t.direccion === undefined) fallaSemantica(`terminal asignable "${t.id}" sin dirección`)
  }
  for (const c of componente.capacidades) {
    if (c.magnitud !== undefined && !(UNIDAD_DE_MAGNITUD[c.magnitud] ?? []).includes(c.unidad as string)) fallaSemantica(`capacidad "${c.id}" con unidad incoherente`)
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
  if (!REVISION_ELECTRICA[componente.id]) {
    problemas.push("electrico: sin revisión eléctrica humana")
    electrico = false
  }

  // ── acciones (check 8, sólo actuadores) ──
  let acciones: boolean | null = null
  if (componente.clase === "actuador") {
    const declaradas = componente.acciones ?? []
    const registradas = new Set(DEFINICIONES_ACCION.map((d) => d.id))
    acciones = declaradas.length > 0 && declaradas.every((a) => registradas.has(a))
    if (!acciones) problemas.push("acciones: el actuador no declara acciones registradas")
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

export function admitirPlaca(conocimiento: ComponentKnowledge, id: string): InformeDeAdmision {
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
  if (!REVISION_ELECTRICA[placa.id]) {
    problemas.push("electrico: sin revisión eléctrica humana")
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
export function admitirCatalogo(conocimiento: ComponentKnowledge): readonly InformeDeAdmision[] {
  return [
    ...conocimiento.catalogo.placas.map((p) => admitirPlaca(conocimiento, p.id)),
    ...conocimiento.catalogo.componentes.map((c) => admitirComponente(conocimiento, c.id)),
  ]
}

/** Ids oficialmente soportados, ordenados (para fijarlos en un test). */
export function oficialmenteSoportados(conocimiento: ComponentKnowledge): readonly string[] {
  return admitirCatalogo(conocimiento)
    .filter((i) => i.officiallySupported)
    .map((i) => i.id)
    .sort()
}
