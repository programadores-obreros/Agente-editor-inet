// ComponentKnowledge — Component System Foundation #1, F5 (Decision Freeze, D-01 /
// 03-COMPONENT-KNOWLEDGE-CONTRACT.md).
//
// Fachada de SÓLO LECTURA sobre la MISMA instancia del catálogo semántico más los anexos
// (representación, pedagogía es-AR, procedencia). Responde preguntas deterministas sobre
// placas y componentes para la vista, las tools y el agente.
//
// Lo que NO es: no muta proyectos ni la IR, no tiene instancias de proyecto ni revisiones,
// no hace commits, no guarda estado de UI, no tiene prompts, no le pregunta nada a un LLM
// y no es un segundo catálogo: no declara ningún hecho eléctrico propio, todo lo semántico
// sale de `catalogo` (núcleo). Vive fuera de `nucleo/` y de `vista-fisica/`; `nucleo/`
// nunca importa este directorio.

import type { Catalogo, ComponenteCatalogo, DefinicionAccion, Terminal } from "../nucleo/catalogo.ts"
import type { Placa, RegistroPin, TerminalPotencia } from "../nucleo/placas.ts"
import { asignarPin, evaluarRestriccionesPin, DEFINICIONES_ACCION } from "../nucleo/catalogo.ts"
import { congelarProfundo } from "../nucleo/canonico.ts"
import { ATRIBUTOS_POR_TIPO, ELEMENTO_WOKWI_POR_PLACA, ELEMENTO_WOKWI_POR_TIPO, ESCALA_WOKWI_POR_PLACA, POTENCIA_WOKWI_POR_PLACA, TERMINAL_WOKWI_POR_TIPO } from "./anexos/representacion.ts"
import { CONCEPTOS_DE_COMPONENTE, ETIQUETA_DE_TERMINAL_DE_POTENCIA, ETIQUETA_POR_TIPO_Y_TERMINAL, etiquetaDeTerminal, nombreDeComponente, nombreDePlaca } from "./anexos/pedagogia-es-AR.ts"
import { assetDeRepresentacionWokwi, procedenciaDe, type RegistroProcedencia } from "./anexos/procedencia.ts"

export type TipoEntidad = "componente" | "placa"

/** A qué va físicamente un terminal `riel-fijo` en una placa dada. */
export type DestinoResuelto =
  | { readonly kind: "potencia"; readonly id: TerminalPotencia["id"] }
  | { readonly kind: "pin"; readonly id: string }
  | { readonly kind: "externo"; readonly nombre: string }
  | { readonly kind: "puente" }
  | { readonly kind: "sin-resolver"; readonly destino: string }

export interface TerminalDePotenciaConocido extends TerminalPotencia {
  /** D-05: se puede conectar físicamente… */
  readonly conectable: true
  /** …pero no es un GPIO lógico: no se ofrece ni acepta `AsignarPin`. */
  readonly asignable: false
}

export interface PinPermitido {
  readonly id: string
  readonly etiquetas: readonly string[]
  /** Está en el pool automático de la placa para la eléctrica del terminal. */
  readonly recomendado: boolean
  /** Códigos de motivos NO bloqueantes que trae ese pin para este terminal (strapping,
   * UART…). Un pin con un motivo bloqueante (flash, pull-up imposible) no se ofrece. */
  readonly avisos: readonly string[]
}

export interface RepresentacionWokwi {
  readonly elemento: string
  /** Componente: terminal semántico → pin de la pieza. Placa: terminal de potencia →
   * pines de la pieza. */
  readonly terminales: Readonly<Record<string, string | readonly string[]>>
  readonly atributos: Readonly<Record<string, string>>
  readonly escala?: number
  /** Asset que la respalda (anexo de procedencia). */
  readonly assetId: string
}

export interface ComponentKnowledge {
  /** La MISMA instancia del catálogo (congelada). No se construye otra. */
  readonly catalogo: Catalogo
  identidad(): { readonly version: string; readonly hash: string }
  tipoComponente(tipo: string): ComponenteCatalogo | undefined
  placa(id: string): Placa | undefined
  terminales(tipo: string): readonly Terminal[]
  resolverDestino(placa: string, terminal: Terminal): DestinoResuelto
  terminalesDePotencia(placa: string): readonly TerminalDePotenciaConocido[]
  pinesPermitidos(placa: string, tipo: string, terminalId: string): readonly PinPermitido[]
  acciones(tipo: string): readonly DefinicionAccion[]
  representacionWokwi(kind: TipoEntidad, id: string): RepresentacionWokwi | undefined
  nombre(kind: TipoEntidad, id: string): string | undefined
  etiquetaDeTerminal(tipo: string, terminalId: string): string | undefined
  etiquetaDeTerminalDePotencia(id: string): string | undefined
  conceptos(tipo: string): readonly string[]
  procedencia(assetId: string): RegistroProcedencia | undefined
}

function ordenarPines(a: { readonly recomendado: boolean; readonly numero: number }, b: { readonly recomendado: boolean; readonly numero: number }): number {
  if (a.recomendado !== b.recomendado) return a.recomendado ? -1 : 1
  return a.numero - b.numero
}

function recomendadoPara(terminal: Terminal, pin: RegistroPin): boolean {
  return terminal.electrica === "analogica" ? pin.enPoolAutomatico.analogico : pin.enPoolAutomatico.digital
}

export function crearConocimiento(catalogo: Catalogo): ComponentKnowledge {
  const placaPorId = new Map(catalogo.placas.map((p) => [p.id, p]))

  const conocimiento: ComponentKnowledge = {
    catalogo,
    identidad: () => ({ version: catalogo.version, hash: catalogo.hash }),
    tipoComponente: (tipo) => catalogo.obtenerComponente(tipo),
    placa: (id) => placaPorId.get(id),
    terminales: (tipo) => catalogo.obtenerComponente(tipo)?.terminales ?? [],

    resolverDestino(idPlaca, terminal) {
      if (terminal.asignable) return { kind: "sin-resolver", destino: "asignable: va a un GPIO, no a un riel" }
      const destino = terminal.destinoFijo
      if (destino === undefined) return { kind: "puente" }
      if (typeof destino !== "string") return { kind: "externo", nombre: destino.externo }
      const placa = placaPorId.get(idPlaca)
      if (!placa) return { kind: "sin-resolver", destino }
      if (destino === "SDA") return { kind: "pin", id: placa.i2c.sda }
      if (destino === "SCL") return { kind: "pin", id: placa.i2c.scl }
      const id = placa.destinosDeRiel?.[destino]
      return id !== undefined && placa.terminalesDePotencia.some((t) => t.id === id) ? { kind: "potencia", id } : { kind: "sin-resolver", destino }
    },

    terminalesDePotencia: (idPlaca) =>
      congelarProfundo((placaPorId.get(idPlaca)?.terminalesDePotencia ?? []).map((t) => ({ ...t, conectable: true as const, asignable: false as const }))),

    pinesPermitidos(idPlaca, tipo, terminalId) {
      const placa = placaPorId.get(idPlaca)
      const terminal = catalogo.obtenerComponente(tipo)?.terminales.find((t) => t.id === terminalId)
      if (!placa || !terminal || !terminal.asignable) return []
      const candidatos: { readonly pin: PinPermitido; readonly recomendado: boolean; readonly numero: number }[] = []
      for (const pin of placa.pines) {
        if (asignarPin(terminal, pin) !== null) continue // eléctricamente incompatible
        const motivos = evaluarRestriccionesPin(terminal, pin)
        if (motivos.some((m) => m.severidad === "blocking")) continue
        const recomendado = recomendadoPara(terminal, pin)
        candidatos.push({ pin: { id: pin.id, etiquetas: pin.etiquetas, recomendado, avisos: motivos.map((m) => m.codigo) }, recomendado, numero: pin.numero })
      }
      return congelarProfundo(candidatos.sort(ordenarPines).map((c) => c.pin))
    },

    acciones(tipo) {
      const declaradas = catalogo.obtenerComponente(tipo)?.acciones ?? []
      return DEFINICIONES_ACCION.filter((d) => declaradas.includes(d.id))
    },

    representacionWokwi(kind, id) {
      if (kind === "componente") {
        const elemento = ELEMENTO_WOKWI_POR_TIPO[id]
        if (!elemento) return undefined
        return congelarProfundo({ elemento, terminales: TERMINAL_WOKWI_POR_TIPO[id] ?? {}, atributos: ATRIBUTOS_POR_TIPO[id] ?? {}, assetId: assetDeRepresentacionWokwi() })
      }
      const elemento = ELEMENTO_WOKWI_POR_PLACA[id]
      if (!elemento) return undefined
      return congelarProfundo({ elemento, terminales: POTENCIA_WOKWI_POR_PLACA[id] ?? {}, atributos: {}, escala: ESCALA_WOKWI_POR_PLACA[id] ?? 1, assetId: assetDeRepresentacionWokwi() })
    },

    nombre: (kind, id) => (kind === "componente" ? nombreDeComponente(id) : nombreDePlaca(id)),
    etiquetaDeTerminal: (tipo, terminalId) => ETIQUETA_POR_TIPO_Y_TERMINAL[tipo]?.[terminalId] ?? (etiquetaDeTerminal(terminalId) !== terminalId ? etiquetaDeTerminal(terminalId) : undefined),
    etiquetaDeTerminalDePotencia: (id) => ETIQUETA_DE_TERMINAL_DE_POTENCIA[id],
    conceptos: (tipo) => CONCEPTOS_DE_COMPONENTE[tipo] ?? [],
    procedencia: (assetId) => procedenciaDe(assetId),
  }
  return Object.freeze(conocimiento)
}
