// Vocabulario del proyecto físico — Phase 3, Wave 0 (writer W-W0-TOOL,
// PHASE_3_WAVE_0_DESIGN.md, fila F-07).
//
// F-07 (PHASE_2_SIMULATED_ROLE_TRIAL.md): `leer` (`tool/proyecto-fisico.ts`) no
// exponía el vocabulario válido (ids de placa, tipos de componente, terminales, forma
// de los payloads) — el docente simulado (T1) necesitó ~16 llamadas de prueba y error
// para armar ESP32+LED+pulsador: probó `esp32`/`esp32dev`/"ESP32 DevKit" antes de
// acertar `esp32-devkit-v1`, y `boton`/`button`/`pushbutton` antes de `pulsador`.
//
// Este módulo DERIVA el vocabulario del catálogo REAL (`catalogo.componentes`/
// `catalogo.placas`, el mismo que construye `vista-real.ts`/`hash-catalogo.node.ts`)
// — nunca una lista hardcodeada en paralelo: agregar o cambiar un componente/placa en
// el catálogo (Gate 3) actualiza el vocabulario solo, sin tocar este archivo.
//
// Puro: sólo tipos de `nucleo/catalogo.ts`/`nucleo/ir.ts`/`nucleo/motivos.ts`/
// `nucleo/operaciones.ts` (`import type`, se borran en runtime) — CERO imports de
// valor. Por eso `tool/proyecto-fisico.ts` lo importa ESTÁTICO (sin el criterio D13 de
// carga perezosa de ese archivo): este módulo no puede romper el loop de carga del
// registry de tools si `servidor/` faltara, porque no toca ese árbol en absoluto.

import type { Catalogo, ComponenteCatalogo } from "../nucleo/catalogo.ts"
import type { Componente, Proyecto } from "../nucleo/ir.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import type { TipoOperacion } from "../nucleo/operaciones.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// vocabularioDesdeCatalogo — placas/componentes/terminales + ejemplos de payload
// ════════════════════════════════════════════════════════════════════════════════════

export interface PlacaVocabulario {
  readonly id: string
  readonly nombre: string
  readonly alias: readonly string[]
}

export interface TerminalVocabulario {
  readonly id: string
  /** Por ahora, el mismo id (W-W0-TOOL): la etiqueta humana ("ánodo (+)") es
   * responsabilidad de W-W0-VIEW, no de esta tool — ver PHASE_3_WAVE_0_DESIGN.md,
   * fila F-09/W-W0-VIEW. */
  readonly nombre: string
  /** `true` si el terminal acepta `AsignarPin` (no es un riel fijo:
   * `Terminal.electrica !== "riel-fijo"`, `nucleo/catalogo.ts`). */
  readonly asignable: boolean
}

export interface ComponenteVocabulario {
  readonly tipo: string
  readonly nombre: string
  readonly clase: ComponenteCatalogo["clase"]
  readonly terminales: readonly TerminalVocabulario[]
}

export interface VocabularioProyectoFisico {
  readonly placas: readonly PlacaVocabulario[]
  readonly componentes: readonly ComponenteVocabulario[]
  /** Un ejemplo de payload por tipo de la whitelist (el array que el llamador pasa en
   * `tiposPermitidos` — `proyecto-fisico.ts::OPERACIONES_PERMITIDAS`, nunca duplicada
   * acá: única fuente de verdad de "qué tipos acepta esta tool"). SIEMPRE con ids
   * reales del catálogo donde los hay (placa/tipo/terminal/pin); un id que sólo existe
   * en TIEMPO DE EJECUCIÓN (el id de un componente ya agregado, el de una conexión) se
   * deja como un placeholder legible entre `<…>`, nunca inventado como si fuera real. */
  readonly operaciones: Readonly<Partial<Record<TipoOperacion, unknown>>>
}

function terminalesVocabulario(componente: ComponenteCatalogo): readonly TerminalVocabulario[] {
  return componente.terminales.map((terminal) => ({ id: terminal.id, nombre: terminal.id, asignable: terminal.electrica !== "riel-fijo" }))
}

function primerTerminalAsignable(componente: ComponenteCatalogo): string | undefined {
  return componente.terminales.find((terminal) => terminal.electrica !== "riel-fijo")?.id
}

const PLACEHOLDER_COMPONENTE = "<id de un componente ya agregado — lo devuelve 'leer'>"
const PLACEHOLDER_TERMINAL = "<id de terminal — ver componentes[].terminales>"
const PLACEHOLDER_PIN = "<id de pin de la placa, p. ej. GPIO4>"
const PLACEHOLDER_CONEXION = "<id de conexión — lo devuelve 'leer'>"

/**
 * Deriva el vocabulario completo del catálogo REAL. `tiposPermitidos` es la whitelist
 * de R-6 — pasada por el llamador (nunca reconstruida acá) para que la tool siga
 * siendo la única fuente de verdad de "qué tipos acepta".
 */
export function vocabularioDesdeCatalogo(catalogo: Catalogo, tiposPermitidos: readonly TipoOperacion[]): VocabularioProyectoFisico {
  const placas: readonly PlacaVocabulario[] = catalogo.placas.map((placa) => ({ id: placa.id, nombre: placa.nombreVisible, alias: placa.alias }))
  const componentes: readonly ComponenteVocabulario[] = catalogo.componentes.map((componente) => ({
    tipo: componente.id,
    nombre: componente.nombreVisible,
    clase: componente.clase,
    terminales: terminalesVocabulario(componente),
  }))

  const primeraPlaca = catalogo.placas[0]
  const primerComponente = catalogo.componentes[0]
  const terminalDeEjemplo = primerComponente ? (primerTerminalAsignable(primerComponente) ?? PLACEHOLDER_TERMINAL) : PLACEHOLDER_TERMINAL
  const primerPinDeLaPlaca = primeraPlaca ? (catalogo.pinesDePlaca(primeraPlaca.id)?.[0]?.id ?? PLACEHOLDER_PIN) : PLACEHOLDER_PIN

  const ejemplos: Partial<Record<TipoOperacion, unknown>> = {}
  for (const tipo of tiposPermitidos) {
    switch (tipo) {
      case "SetPlaca":
        if (primeraPlaca) ejemplos.SetPlaca = { placa: primeraPlaca.id }
        break
      case "AgregarComponente":
        if (primerComponente) ejemplos.AgregarComponente = { tipo: primerComponente.id }
        break
      case "QuitarComponente":
        ejemplos.QuitarComponente = { componente: PLACEHOLDER_COMPONENTE }
        break
      case "AsignarPin":
        ejemplos.AsignarPin = { componente: PLACEHOLDER_COMPONENTE, terminal: terminalDeEjemplo, pin: primerPinDeLaPlaca }
        break
      case "Conectar":
        ejemplos.Conectar = {
          desde: { componente: PLACEHOLDER_COMPONENTE, terminal: terminalDeEjemplo },
          hasta: { componente: "<id de otro componente>", terminal: PLACEHOLDER_TERMINAL },
        }
        break
      case "Desconectar":
        ejemplos.Desconectar = { conexion: PLACEHOLDER_CONEXION }
        break
      default:
        // SetComportamiento/CambiarComponente nunca están en la whitelist de R-6 — si
        // algún día entraran, quedan sin ejemplo acá hasta que se declare uno a
        // propósito (nunca se inventa un payload para un tipo que la tool todavía no
        // soporta).
        break
    }
  }

  return { placas, componentes, operaciones: ejemplos }
}

// ════════════════════════════════════════════════════════════════════════════════════
// valoresValidosParaMotivos — F-07 (continuación): ante PLACA_DESCONOCIDA/
// TIPO_CATALOGO_DESCONOCIDO/TERMINAL_NO_DECLARADO, la tool agrega los valores válidos,
// DERIVADOS del catálogo (y, para TERMINAL_NO_DECLARADO, del `Proyecto` vigente — hace
// falta para saber el `tipo` del componente al que se le pidió un terminal
// inexistente).
// ════════════════════════════════════════════════════════════════════════════════════

const CODIGOS_CON_VALORES_VALIDOS: ReadonlySet<string> = new Set(["PLACA_DESCONOCIDA", "TIPO_CATALOGO_DESCONOCIDO", "TERMINAL_NO_DECLARADO"])

function idsDeTerminalesDelComponente(datosMotivo: Motivo["datos"], catalogo: Catalogo, proyecto: Proyecto): readonly string[] | undefined {
  const idComponente = datosMotivo && typeof datosMotivo.componente === "string" ? datosMotivo.componente : undefined
  if (!idComponente) return undefined
  const componente = proyecto.componentes.find((c: Componente) => c.id === idComponente)
  if (!componente) return undefined
  const catalogoComponente = catalogo.obtenerComponente(componente.tipo)
  return catalogoComponente?.terminales.map((terminal) => terminal.id)
}

/**
 * `undefined` si ningún motivo del lote pide valores válidos — el llamador omite la
 * clave `valoresValidos` del todo en ese caso, nunca la deja vacía/`null` sin motivo.
 */
export function valoresValidosParaMotivos(motivos: readonly Motivo[], catalogo: Catalogo, proyecto: Proyecto): Readonly<Record<string, unknown>> | undefined {
  let salida: Record<string, unknown> | undefined
  for (const motivo of motivos) {
    if (!CODIGOS_CON_VALORES_VALIDOS.has(motivo.codigo)) continue
    salida ??= {}
    if (motivo.codigo === "PLACA_DESCONOCIDA") {
      salida.placas = catalogo.placas.map((placa) => placa.id)
    } else if (motivo.codigo === "TIPO_CATALOGO_DESCONOCIDO") {
      salida.tipos = catalogo.componentes.map((componente) => componente.id)
    } else if (motivo.codigo === "TERMINAL_NO_DECLARADO") {
      const terminales = idsDeTerminalesDelComponente(motivo.datos, catalogo, proyecto)
      if (terminales) salida.terminales = terminales
    }
  }
  return salida
}

// ════════════════════════════════════════════════════════════════════════════════════
// descripcionPinesDeComponente — F-13: 'leer' agrega, por componente, una descripción
// en texto llano de sus terminales ("anodo → GPIO4, catodo → GND (fijo)") — derivada
// del IR (`Componente.pines`) y del catálogo (`Terminal.destinoFijo` para los rieles
// fijos), nunca de una tabla de pines hardcodeada.
// ════════════════════════════════════════════════════════════════════════════════════

function destinoLegible(destinoFijo: string | { readonly externo: string }): string {
  return typeof destinoFijo === "string" ? destinoFijo : destinoFijo.externo
}

function descripcionDeUnTerminal(idTerminal: string, catalogoComponente: ComponenteCatalogo | undefined, pinAsignado: string | null): string {
  const terminal = catalogoComponente?.terminales.find((t) => t.id === idTerminal)
  if (terminal?.electrica === "riel-fijo") {
    return terminal.destinoFijo !== undefined ? `${idTerminal} → ${destinoLegible(terminal.destinoFijo)} (fijo)` : `${idTerminal} → puente (sin destino fijo)`
  }
  return `${idTerminal} → ${pinAsignado ?? "sin asignar"}`
}

/** Un componente con un `tipo` que el catálogo vigente ya no reconoce (no debería
 * pasar para un `Proyecto` ya validado por el Engine, pero esta función es pura y no
 * asume eso) describe sus terminales por las claves que YA tiene `Componente.pines`
 * — nunca explota por catálogo ausente. */
export function descripcionPinesDeComponente(componente: Componente, catalogo: Catalogo): string {
  const catalogoComponente = catalogo.obtenerComponente(componente.tipo)
  const idsTerminales = catalogoComponente ? catalogoComponente.terminales.map((t) => t.id) : Object.keys(componente.pines)
  return idsTerminales.map((idTerminal) => descripcionDeUnTerminal(idTerminal, catalogoComponente, componente.pines[idTerminal] ?? null)).join(", ")
}
