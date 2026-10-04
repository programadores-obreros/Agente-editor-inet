// `vistaDeProyectoConCatalogoReal` — conveniencia para consumidores reales (tool de
// OpenCode, servidor HTTP, tests): la MISMA vista pura de `snapshot-a-vista.ts`, pero
// ya resuelta con el catálogo de producción de Phase 1 (`construirCatalogoMinimoReal`,
// `nucleo/adaptadores/hash-catalogo.node.ts` — el MISMO que usa
// `composicion-raiz.ts::CATALOGO_REAL`).
//
// Vive en un archivo SEPARADO de `snapshot-a-vista.ts` a propósito: importar
// `hash-catalogo.node.ts` carga, transitivamente, `node:crypto` — nada prohíbe eso
// FUERA del núcleo (la guardia 29b, `tests/nucleo-adversarial.test.mjs`, sólo escanea
// `opencode/nucleo/**`), pero mantener `snapshot-a-vista.ts` sin ningún import
// impuro conserva la propiedad más fuerte: puro de verdad, no "puro porque nadie
// todavía lo probó con node:". Mismo criterio de separación que ya usa Phase 1 entre
// `catalogo.ts` (puro) y `adaptadores/hash-catalogo.node.ts` (el único que hashea).
//
// Este archivo NO se inyecta por defecto en `composicion-raiz.ts` — ver la decisión
// de integración registrada en `docs/programacion-intencion/PHASE_2_SLICE_1_PROTOCOL.md`
// ("Integración con la raíz de composición"): el núcleo (`opencode/nucleo/**`) no
// depende de `vista-fisica/**`, así que el hook `calcularVista` (ya expuesto por
// `composicion-raiz.ts`, sin tocar) es quien la conecta — cada consumidor real (tool,
// servidor, tests) pasa esta función como `calcularVista` al llamar
// `obtenerServicioDeProyecto(...)`.

import type { Proyecto } from "../nucleo/ir.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import type { Catalogo } from "../nucleo/catalogo.ts"
import type { ModeloDeVista, MotivoVista } from "./modelo-vista.ts"
import { CATALOGO_ACTIVO } from "../nucleo/catalogo-activo.ts"
import { proyectarVista, explicarMotivos } from "./snapshot-a-vista.ts"

// Component System Foundation #1, F1 (D-01 condición 2): esta vista YA NO construye su
// propio catálogo (antes había dos instancias por proceso: ésta y la de la raíz de
// composición). Usa el que le inyecta la raíz por `calcularVista(proyecto, catalogo)` y,
// para los llamados sin inyección, la MISMA instancia activa del runtime.
const CATALOGO_REAL = CATALOGO_ACTIVO

export function vistaDeProyectoConCatalogoReal(proyecto: Proyecto, catalogo: Catalogo = CATALOGO_REAL): ModeloDeVista {
  return proyectarVista(proyecto, catalogo)
}

/**
 * Fase 2, Slice 2 (W-S2-TOOL): conveniencia equivalente a
 * `vistaDeProyectoConCatalogoReal`, pero para `explicarMotivos` — la tool
 * `proyecto-fisico` la usa para explicar los `Motivo[]` que devuelve
 * `servicio.aplicarTransaccion`/`servicio.proponer` (un resultado de transacción, no
 * un snapshot completo) con el MISMO catálogo real que usa el resto de la vista
 * física, sin construir un catálogo propio (evita una segunda autoridad).
 */
export function explicarMotivosConCatalogoReal(motivos: readonly Motivo[], proyecto: Proyecto): readonly MotivoVista[] {
  return explicarMotivos(motivos, proyecto, CATALOGO_REAL)
}

/**
 * Phase 3, Wave 0 (W-W0-TOOL, F-05/F-07/F-13, PHASE_3_WAVE_0_DESIGN.md): acceso directo
 * al MISMO catálogo real que ya usa el resto de este módulo (`CATALOGO_REAL`, arriba) —
 * para que `tool/proyecto-fisico.ts` (vocabulario + valoresValidos + descripcionPines) y
 * `tool/vista-fisica.ts` (resumen del snapshot) puedan nombrar placas/componentes/
 * terminales con el MISMO catálogo, sin construir una segunda instancia ni importar
 * `hash-catalogo.node.ts` por su cuenta.
 */
export function catalogoReal(): Catalogo {
  return CATALOGO_REAL
}
