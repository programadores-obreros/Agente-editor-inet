// Fixture de MUTACIÓN — usada ÚNICAMENTE por
// `tests/phase2-vista-fisica.test.mjs` ("MUTANTE: ..."). NUNCA se importa desde
// producción.
//
// Copia deliberadamente DEFECTUOSA de la parte de `snapshot-a-vista.ts::proyectarVista`
// que arma el cable del ánodo del LED: acá el pin es un LITERAL FIJO ("GPIO4"),
// ignorando `Componente.pines.anodo` de la IR — exactamente el defecto que
// `docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md` §2.6 prohíbe ("Los cables
// esquemáticos... generados SÓLO a partir de las asignaciones y conexiones de la
// IR"). El test de mutación demuestra que la suite REAL mataría este defecto si
// alguna vez apareciera en el módulo de producción.

import type { Proyecto } from "../opencode/nucleo/ir.ts"
import type { Catalogo } from "../opencode/nucleo/catalogo.ts"
import { nombreWokwiDePin } from "../opencode/vista-fisica/wokwi-render-datos.ts"

const PIN_FIJO_HARDCODEADO = "GPIO4"

/**
 * Nombre Wokwi que el cable del ánodo del LED usaría, con el defecto de mutación:
 * SIEMPRE `PIN_FIJO_HARDCODEADO`, sin mirar `proyecto.componentes[0].pines.anodo`.
 */
export function nombreWokwiDelCableAnodoMutante(proyecto: Proyecto, catalogo: Catalogo): string {
  // El defecto: lee `proyecto.placa` (para saber QUÉ placa dibujar) pero NUNCA lee
  // `proyecto.componentes[...].pines.anodo` (el pin REALMENTE asignado en la IR) — el
  // pin del cable es el literal de arriba, siempre, pase lo que pase en la IR.
  const pinesDePlaca = proyecto.placa ? catalogo.pinesDePlaca(proyecto.placa) : undefined
  const pinReal = pinesDePlaca?.find((p) => p.id === PIN_FIJO_HARDCODEADO)
  return pinReal ? nombreWokwiDePin(pinReal) : PIN_FIJO_HARDCODEADO
}
