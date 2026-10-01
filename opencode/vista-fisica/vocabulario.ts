// Vocabulario del proyecto físico — Phase 3, Wave 0 (writer W-W0-TOOL,
// PHASE_3_WAVE_0_DESIGN.md, fila F-07).
//
// STUB deliberado (RED genuino, TEST-FIRST obligatorio del briefing de la Wave 0):
// este archivo todavía NO implementa nada — sólo exporta la forma mínima para que
// `tests/wave0-tool.test.mjs` pueda importar y FALLE por una aserción semántica (no
// por "módulo no encontrado"). La implementación real llega en el commit GREEN
// inmediato siguiente al commit `test(...): RED ...`.

import type { Catalogo } from "../nucleo/catalogo.ts"
import type { Componente, Proyecto } from "../nucleo/ir.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import type { TipoOperacion } from "../nucleo/operaciones.ts"

export interface PlacaVocabulario {
  readonly id: string
  readonly nombre: string
  readonly alias: readonly string[]
}

export interface TerminalVocabulario {
  readonly id: string
  readonly nombre: string
  readonly asignable: boolean
}

export interface ComponenteVocabulario {
  readonly tipo: string
  readonly nombre: string
  readonly clase: string
  readonly terminales: readonly TerminalVocabulario[]
}

export interface VocabularioProyectoFisico {
  readonly placas: readonly PlacaVocabulario[]
  readonly componentes: readonly ComponenteVocabulario[]
  readonly operaciones: Readonly<Partial<Record<TipoOperacion, unknown>>>
}

export function vocabularioDesdeCatalogo(_catalogo: Catalogo, _tiposPermitidos: readonly TipoOperacion[]): VocabularioProyectoFisico {
  return { placas: [], componentes: [], operaciones: {} }
}

export function valoresValidosParaMotivos(_motivos: readonly Motivo[], _catalogo: Catalogo, _proyecto: Proyecto): Readonly<Record<string, unknown>> | undefined {
  return undefined
}

export function descripcionPinesDeComponente(_componente: Componente, _catalogo: Catalogo): string {
  return ""
}
