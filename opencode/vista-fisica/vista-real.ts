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
import type { ModeloDeVista } from "./modelo-vista.ts"
import { construirCatalogoMinimoReal } from "../nucleo/adaptadores/hash-catalogo.node.ts"
import { proyectarVista } from "./snapshot-a-vista.ts"

// Igual que `composicion-raiz.ts::CATALOGO_REAL`: puro y determinista, se calcula una
// única vez por proceso — todos los llamados a `vistaDeProyectoConCatalogoReal`
// comparten el mismo catálogo (mismos datos, mismo hash).
const CATALOGO_REAL = construirCatalogoMinimoReal()

export function vistaDeProyectoConCatalogoReal(proyecto: Proyecto): ModeloDeVista {
  return proyectarVista(proyecto, CATALOGO_REAL)
}
