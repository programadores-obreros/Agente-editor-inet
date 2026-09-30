// Modelo de vista física — Phase 2, Slice 1 (ARCH-C, adaptador IR → vista).
//
// Tipos PUROS, sin DOM, sin `node:`, sin dependencia de Wokwi en runtime: son datos
// planos y serializables (JSON), construidos por `snapshot-a-vista.ts` a partir de
// `Proyecto` (IR, `nucleo/ir.ts`) + `Catalogo` (`nucleo/catalogo.ts`). Éste es el ÚNICO
// punto de dependencia hacia el núcleo desde `vista-fisica/` — nunca al revés: el
// núcleo (`opencode/nucleo/**`) no importa nada de acá (ver PHASE_2_SLICE_1_DESIGN.md
// §2.6 y la decisión de integración registrada en PHASE_2_SLICE_1_PROTOCOL.md).
//
// `Motivo`/`Readiness` se REUSAN tal cual del núcleo — la vista nunca inventa su
// propio vocabulario de error ni su propia noción de "listo".

import type { Motivo } from "../nucleo/motivos.ts"
import type { Readiness } from "../nucleo/validar.ts"

export interface PlacaVista {
  /** `Placa.id` (nucleo/placas.ts) — identidad semántica, NUNCA el tag de Wokwi. */
  readonly id: string
  /** `Placa.backends.wokwi.elemento` — dato OPACO de render (BOARD-CONTRACT §4/§6),
   * nunca una segunda identidad. */
  readonly elementoWokwi: string
  /** Cosmético (`wokwi-render-datos.ts`, portado de `circuito.ts`) — nunca afecta
   * ninguna regla eléctrica. */
  readonly escala: number
}

/**
 * Estado de UN terminal de UN componente, proyectado desde la IR + el catálogo —
 * nunca inventado. Las cuatro variantes existen porque el catálogo real (Fase 1) las
 * distingue de verdad:
 * - `asignado`: terminal `electrica: "digital"|"analogica"` CON un pin de placa
 *   asignado (`Componente.pines[terminal.id]`, `nucleo/ir.ts`). `nombreWokwiPlaca`
 *   es `null` (revisión post red-team, B1) cuando el pin asignado NO tiene
 *   representación física en el custom element Wokwi de la placa (ej. un GPIO de
 *   flash/reservado que un actor "agente" asignó directo, sin pasar por el
 *   selector) — la vista lo muestra HONESTAMENTE (el `pinSemantico` real sigue
 *   presente, nunca se oculta la asignación), nunca inventa un nombre de pin que
 *   no existe (`wokwi-render-datos.ts::nombreWokwiDePin`).
 * - `sinAsignar`: mismo tipo de terminal, sin pin todavía (`null` en la IR).
 * - `rielFijo`: terminal `electrica: "riel-fijo"` CON `Terminal.destinoFijo`
 *   declarado (ej. el cátodo del LED, GND — `catalogo-datos.ts:23`).
 * - `puente`: terminal `electrica: "riel-fijo"` SIN `destinoFijo` (ej. los dos
 *   terminales de la resistencia, `catalogo-datos.ts:40-43`: "es un puente, no tiene
 *   polaridad") — su cableado sale ÚNICAMENTE de `Proyecto.conexiones`, nunca de un
 *   destino fijo que no existe.
 */
export type TerminalVista =
  | { readonly estado: "asignado"; readonly pinSemantico: string; readonly nombreWokwiPlaca: string | null; readonly nombreWokwiPieza: string | null }
  | { readonly estado: "sinAsignar"; readonly nombreWokwiPieza: string | null }
  | { readonly estado: "rielFijo"; readonly destino: string; readonly nombreWokwiPieza: string | null }
  | { readonly estado: "puente"; readonly nombreWokwiPieza: string | null }

export interface ComponenteVista {
  /** `Componente.id` ("cmp-0", nucleo/ir.ts). */
  readonly id: string
  /** `Componente.tipo` — id de catálogo ("led"), un dato, nunca una rama de TS acá. */
  readonly tipo: string
  /** `wokwi-render-datos.ts` — `null` si el tipo no tiene tabla de render todavía
   * (gap documentado: hoy sólo "led" la tiene; agregar un componente nuevo con
   * render es sumar una entrada a esa tabla, nunca tocar este módulo). */
  readonly elementoWokwi: string | null
  /** Presentación pura (ej. `{color:"red"}`) — Fase 1 no modela color como dato
   * semántico; ver `wokwi-render-datos.ts`. */
  readonly atributos: Readonly<Record<string, string>>
  /** Fase 2, Slice 2 (§3.3, HD-S2-7): "entrada" | "salida" | `null`, derivado de
   * `ComponenteCatalogo.clase` (`nucleo/catalogo.ts:88`) por una función PURA del
   * lado del servidor (`snapshot-a-vista.ts::rolDeClase`) — aditivo, nunca afecta
   * ninguna regla eléctrica ni de validación. `null` para `clase: "pasivo"` (la
   * resistencia) y para cualquier `clase` que la función no reconozca todavía: el
   * browser (`plan-de-pintado.js`/`pintar.js`) sólo capitaliza este texto YA
   * resuelto, nunca mira `tipo` ni ninguna clase de catálogo por su cuenta. */
  readonly rol: "entrada" | "salida" | null
  /** `terminal.id` (catálogo) → su estado proyectado. Incluye SIEMPRE los terminales
   * riel-fijo del catálogo (el cátodo del LED nunca falta acá, aunque
   * `Componente.pines` ni siquiera tenga esa clave — `operaciones.ts`,
   * `terminalesNoRielFijo`). */
  readonly terminales: Readonly<Record<string, TerminalVista>>
}

/** Un extremo de un cable esquemático — nunca un punto geométrico (eso queda fuera
 * del slice, PHASE_2_SLICE_1_DESIGN.md §2.6/§3.4 de ARCH-C). `nombreWokwi` de
 * `pinPlaca` es `string | null` (revisión post red-team, B1) por el mismo motivo que
 * `TerminalVista.asignado.nombreWokwiPlaca` — ver esa nota. */
export type ExtremoCableVista =
  | { readonly tipo: "pinPlaca"; readonly pinSemantico: string; readonly nombreWokwi: string | null }
  | { readonly tipo: "terminal"; readonly componente: string; readonly terminal: string; readonly nombreWokwi: string | null }
  | { readonly tipo: "rielFijo"; readonly destino: string }

export interface CableVista {
  readonly id: string
  readonly desde: ExtremoCableVista
  readonly hasta: ExtremoCableVista
}

export interface OpcionGpioVista {
  /** `RegistroPin.id` ("GPIO5") — lo que entiende el motor/la IR. */
  readonly pinSemantico: string
  /** Nombre real del pin en el custom element Wokwi de la PLACA ("D5") — SIEMPRE un
   * pin que existe de verdad en el renderer (revisión post red-team, B1:
   * `snapshot-a-vista.ts::gpiosCandidatosPara` sólo ofrece un GPIO si, ADEMÁS de
   * pasar `asignarPin()`, `wokwi-render-datos.ts::nombreWokwiDePin` le da un nombre
   * real, no `null`) — nunca `string | null` acá: un candidato SIN representación
   * física simplemente no aparece en esta lista. */
  readonly nombreWokwi: string
}

/**
 * Salida de `proyectarVista`/`vistaDeProyectoConCatalogoReal` — todo dato plano,
 * determinista, serializable. Nunca referencias compartidas con el `Proyecto`/
 * `Catalogo` de entrada (los consumidores pueden mutarla sin que le vuelva al
 * canónico del motor).
 */
export interface ModeloDeVista {
  /** `null` = todavía no se eligió placa (`Proyecto.placa === null`). */
  readonly placa: PlacaVista | null
  readonly componentes: readonly ComponenteVista[]
  /** Generados SÓLO a partir de asignaciones (pin↔terminal) y de
   * `Proyecto.conexiones` (terminal↔terminal) — nunca de un pin/riel hardcodeado. */
  readonly cables: readonly CableVista[]
  /** `componente.id` → `terminal.id` → candidatos, sólo para terminales que NO son
   * riel-fijo. Cada candidato ya pasó `asignarPin()` (`nucleo/catalogo.ts`) — la
   * vista consulta esa única regla, nunca la reimplementa (ver el límite conocido en
   * `wokwi-render-datos.ts`/`snapshot-a-vista.ts` sobre `RegistroPin.restricciones`).
   * Revisión post red-team (B1): además, sólo quedan los candidatos con un nombre
   * Wokwi REAL confirmado — la intersección Engine∩pin-físico-del-renderer, nunca
   * una regla eléctrica nueva (es que NO SE PUEDE DIBUJAR un cable a un pin que no
   * existe en la pieza, una restricción de presentación). */
  readonly gpiosDisponibles: Readonly<Record<string, Readonly<Record<string, readonly OpcionGpioVista[]>>>>
  /** Tal cual `validarProyecto()` los produjo (mismo orden estable,
   * `nucleo/motivos.ts::compararMotivos`) — la vista NUNCA inventa una causa nueva ni
   * reclasifica severidad/clasificación. */
  readonly motivos: readonly Motivo[]
  /** Tal cual `derivarReadiness()` — la vista nunca decide por su cuenta si el
   * proyecto está "listo". */
  readonly readiness: Readiness
}
