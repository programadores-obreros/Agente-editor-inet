// Adaptador IR → vista física — Phase 2, Slice 1 (ARCH-C, PHASE_2_SLICE_1_DESIGN.md
// §2.6). PURO: sin DOM, sin `node:`, sin I/O. `proyectarVista(proyecto, catalogo)`
// recibe la IR (`nucleo/ir.ts::Proyecto`) + el catálogo (`nucleo/catalogo.ts`) y
// devuelve un `ModeloDeVista` (`modelo-vista.ts`) — datos planos, serializables,
// deterministas.
//
// Reglas duras (BOARD-CONTRACT, PHASE_2_SLICE_1_DESIGN.md §2.6):
// - NUNCA reimplementa una regla eléctrica: los GPIO ofrecidos salen ÚNICAMENTE de
//   `asignarPin()` (`nucleo/catalogo.ts`), pin por pin — la MISMA función que usa el
//   Engine, nunca una copia.
// - Los backend ids (el tag de Wokwi) son datos OPACOS de render, nunca identidad —
//   se leen tal cual de `Placa.backends.wokwi.elemento`/`wokwi-render-datos.ts`.
// - Los motivos se proyectan TAL CUAL de `validarProyecto()`/`derivarReadiness()` —
//   la vista nunca inventa una causa ni reclasifica severidad.
// - `circuito.ts` NO se importa (prohibido en Fase 1) — sólo se reusan tablas de
//   datos ya PORTADAS en `wokwi-render-datos.ts`, con cita de origen.
// - `pinouts.json` NO es una fuente acá — no es un catálogo de placa (BOARD-CONTRACT
//   §5).
//
// Límite conocido, heredado y NO resuelto por este módulo (informe ARCH-C §7.1,
// diseño §2.6): `asignarPin()` filtra por `RegistroPin.capacidades`
// (salidaDigital/entradaDigital/pwm/adc) — eso SÍ excluye los pines `soloEntrada`
// (su `capacidades.salidaDigital` es `false`, `nucleo/placas.ts::crearPinEsp32`).
// Pero `asignarPin()` NUNCA mira `RegistroPin.restricciones`
// (flashReservado/strapping/uartUsb): ningún validador de Fase 1 consume ese campo
// hoy (verificado: `rg restriccion -i` sobre `validar-tecnico.ts`/`catalogo.ts` da
// cero resultados). Esta vista NO cierra ese gap por su cuenta — mostraría como
// "disponible para el ánodo" un GPIO reservado a flash (6-11) o de arranque
// (strapping: 0/2/12/15) si el catálogo lo acepta. Cerrarlo es una decisión de
// producto sobre `nucleo/catalogo.ts`, no de este adaptador.

import type { Proyecto, Componente } from "../nucleo/ir.ts"
import type { Catalogo, Terminal } from "../nucleo/catalogo.ts"
import type { RegistroPin, Placa } from "../nucleo/placas.ts"
import { asignarPin } from "../nucleo/catalogo.ts"
import { validarProyecto, derivarReadiness } from "../nucleo/validar.ts"
import { nombreWokwiDePin, ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO, ATRIBUTOS_POR_TIPO, ESCALA_WOKWI_POR_PLACA } from "./wokwi-render-datos.ts"
import type { ModeloDeVista, ComponenteVista, TerminalVista, CableVista, ExtremoCableVista, OpcionGpioVista, PlacaVista } from "./modelo-vista.ts"

/**
 * Candidatos de GPIO para UN terminal — consulta `asignarPin()` (`nucleo/catalogo.ts`)
 * pin por pin sobre TODOS los pines de la placa vigente. Nunca reimplementa la regla:
 * un pin queda afuera si y sólo si `asignarPin(terminal, pin) !== null` (rechazo
 * técnico), exactamente el mismo criterio que usa `validarTecnico()` para diagnosticar
 * `CAPACIDAD_PIN_INCOMPATIBLE` post-commit.
 *
 * Revisión post red-team (Hallazgo B1, MAJOR, P2-RED-B/INFORME.md): ADEMÁS, un pin
 * sólo se ofrece si `nombreWokwiDePin()` le da un nombre REAL (no `null`) — la
 * intersección entre "el Engine/catálogo lo acepta" y "el renderer lo puede
 * dibujar". Es una restricción de PRESENTACIÓN (no se puede dibujar un cable a un
 * pin que no existe en la pieza Wokwi), nunca una regla eléctrica nueva: el gap de
 * `asignarPin()` no filtrando `RegistroPin.restricciones` sigue siendo el mismo,
 * documentado y NO cerrado acá (`DECISIONS.md`, backlog de Fase 1).
 *
 * `placaId === null` (proyecto sin placa elegida) da SIEMPRE `[]` — no hay pines que
 * ofrecer todavía (mismo criterio que `detectarIncompleto`, `nucleo/validar.ts`).
 */
export function gpiosCandidatosPara(catalogo: Catalogo, placaId: string | null, terminal: Terminal): readonly OpcionGpioVista[] {
  if (placaId === null) return []
  const pines = catalogo.pinesDePlaca(placaId)
  if (!pines) return []
  const candidatos: OpcionGpioVista[] = []
  for (const pin of pines) {
    if (asignarPin(terminal, pin) !== null) continue // rechazo técnico del catálogo
    const nombreWokwi = nombreWokwiDePin(pin)
    if (nombreWokwi === null) continue // sin pin fisico real en el renderer — no se puede ofrecer
    candidatos.push({ pinSemantico: pin.id, nombreWokwi })
  }
  return candidatos
}

function resolverDestinoFijo(terminal: Terminal): string | undefined {
  if (terminal.destinoFijo === undefined) return undefined
  return typeof terminal.destinoFijo === "string" ? terminal.destinoFijo : terminal.destinoFijo.externo
}

/** Estado de UN terminal, proyectado desde la IR (`componente.pines`) + el catálogo
 * (`terminal.electrica`/`terminal.destinoFijo`) + la placa vigente (para resolver el
 * nombre Wokwi del pin asignado). Nunca inventa un pin/destino: si la IR no tiene el
 * dato, el estado es `sinAsignar`/`puente`. */
function resolverTerminal(componente: Componente, terminal: Terminal, pinesDePlaca: readonly RegistroPin[], nombreWokwiPieza: string | null): TerminalVista {
  if (terminal.electrica === "riel-fijo") {
    const destino = resolverDestinoFijo(terminal)
    if (destino === undefined) return { estado: "puente", nombreWokwiPieza }
    return { estado: "rielFijo", destino, nombreWokwiPieza }
  }
  const pinAsignado = componente.pines[terminal.id] ?? null
  if (pinAsignado === null) return { estado: "sinAsignar", nombreWokwiPieza }
  const pinReal = pinesDePlaca.find((p) => p.id === pinAsignado)
  // Si el pin asignado no está en la placa vigente (documento viejo tras un cambio de
  // placa, por ejemplo) no hay `RegistroPin` real que traducir — se muestra el propio
  // id semántico como último recurso, nunca se inventa un nombre Wokwi de la nada.
  const nombreWokwiPlaca = pinReal ? nombreWokwiDePin(pinReal) : pinAsignado
  return { estado: "asignado", pinSemantico: pinAsignado, nombreWokwiPlaca, nombreWokwiPieza }
}

// Las CUATRO variantes de `TerminalVista` (`modelo-vista.ts`) comparten el campo
// `nombreWokwiPieza` — accesible sin narrowing previo.
function extremoDeTerminal(componenteId: string, terminalId: string, terminalVista: TerminalVista): ExtremoCableVista {
  return { tipo: "terminal", componente: componenteId, terminal: terminalId, nombreWokwi: terminalVista.nombreWokwiPieza }
}

export function proyectarVista(proyecto: Proyecto, catalogo: Catalogo): ModeloDeVista {
  const placaId = proyecto.placa
  const placaCatalogo: Placa | undefined = placaId !== null ? catalogo.placas.find((p) => p.id === placaId) : undefined
  const placa: PlacaVista | null = placaCatalogo
    ? { id: placaCatalogo.id, elementoWokwi: placaCatalogo.backends.wokwi.elemento, escala: ESCALA_WOKWI_POR_PLACA[placaCatalogo.id] ?? 1 }
    : null
  const pinesDePlaca: readonly RegistroPin[] = (placaId !== null ? catalogo.pinesDePlaca(placaId) : undefined) ?? []

  const componentes: ComponenteVista[] = proyecto.componentes.map((componente) => {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    const elementoWokwi = ELEMENTO_WOKWI_POR_TIPO[componente.tipo] ?? null
    const atributos = ATRIBUTOS_POR_TIPO[componente.tipo] ?? {}
    const terminales: Record<string, TerminalVista> = {}
    if (compCatalogo) {
      const tablaPieza = TERMINAL_WOKWI_POR_TIPO[componente.tipo]
      for (const terminal of compCatalogo.terminales) {
        const nombreWokwiPieza = tablaPieza?.[terminal.id] ?? null
        terminales[terminal.id] = resolverTerminal(componente, terminal, pinesDePlaca, nombreWokwiPieza)
      }
    }
    return { id: componente.id, tipo: componente.tipo, elementoWokwi, atributos, terminales }
  })

  function terminalesDe(componenteId: string): Readonly<Record<string, TerminalVista>> {
    return componentes.find((c) => c.id === componenteId)?.terminales ?? {}
  }

  // Cables: de asignaciones (pin↔terminal, incluido el riel fijo del catálogo) +
  // conexiones de la IR (terminal↔terminal) — nunca de un pin/riel hardcodeado.
  const cables: CableVista[] = []
  for (const componente of proyecto.componentes) {
    for (const [terminalId, terminalVista] of Object.entries(terminalesDe(componente.id))) {
      const extremoTerminal = extremoDeTerminal(componente.id, terminalId, terminalVista)
      if (terminalVista.estado === "asignado") {
        const extremoPin: ExtremoCableVista = { tipo: "pinPlaca", pinSemantico: terminalVista.pinSemantico, nombreWokwi: terminalVista.nombreWokwiPlaca }
        cables.push({ id: `cable-pin-${componente.id}-${terminalId}`, desde: extremoPin, hasta: extremoTerminal })
      } else if (terminalVista.estado === "rielFijo") {
        cables.push({ id: `cable-riel-${componente.id}-${terminalId}`, desde: extremoTerminal, hasta: { tipo: "rielFijo", destino: terminalVista.destino } })
      }
      // "sinAsignar"/"puente": sin cable propio — un puente sólo se cablea si la IR
      // trae una `Conexion` real (bucle de abajo); inventar un cable para un terminal
      // sin dato sería mostrar una conexión que el estudiante nunca hizo.
    }
  }
  for (const conexion of proyecto.conexiones) {
    const desde = extremoDeTerminal(conexion.desde.componente, conexion.desde.terminal, terminalesDe(conexion.desde.componente)[conexion.desde.terminal] ?? { estado: "puente", nombreWokwiPieza: null })
    const hasta = extremoDeTerminal(conexion.hasta.componente, conexion.hasta.terminal, terminalesDe(conexion.hasta.componente)[conexion.hasta.terminal] ?? { estado: "puente", nombreWokwiPieza: null })
    cables.push({ id: `cable-conexion-${conexion.id}`, desde, hasta })
  }

  // GPIO ofrecidos: sólo para terminales que NO son riel-fijo (el catálogo declara
  // cuáles) — un terminal riel-fijo/puente nunca ofrece un selector, no tiene pin que
  // elegir.
  const gpiosDisponibles: Record<string, Record<string, readonly OpcionGpioVista[]>> = {}
  for (const componente of proyecto.componentes) {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    if (!compCatalogo) continue
    const porTerminal: Record<string, readonly OpcionGpioVista[]> = {}
    for (const terminal of compCatalogo.terminales) {
      if (terminal.electrica === "riel-fijo") continue
      porTerminal[terminal.id] = gpiosCandidatosPara(catalogo, placaId, terminal)
    }
    gpiosDisponibles[componente.id] = porTerminal
  }

  const motivos = validarProyecto(proyecto, catalogo)
  const readiness = derivarReadiness(proyecto, motivos)

  return { placa, componentes, cables, gpiosDisponibles, motivos, readiness }
}
