// El catálogo semántico ACTIVO de este runtime — Component System Foundation #1, F1
// (Decision Freeze, D-01 condición 2: una sola instancia de catálogo por runtime).
//
// Es el ÚNICO módulo de producción que construye el catálogo real. Lo consumen la raíz
// de composición (`composicion-raiz.ts`, que no puede exportar nada más que
// `obtenerServicioDeProyecto`: guardia (a) de `tests/phase2-composicion-raiz.test.mjs`)
// y la fachada de conocimiento (`conocimiento/conocimiento-activo.ts`). La vista lo
// recibe inyectado por `calcularVista(proyecto, catalogo)`; nadie reconstruye otro.
//
// No es un singleton mutable: `construirCatalogo` devuelve un objeto profundamente
// congelado. Dos lecturas del mismo runtime ven la MISMA instancia, y nada puede
// cambiarla después de construida.

import type { Catalogo } from "./catalogo.ts"
import { construirCatalogoMinimoReal } from "./adaptadores/hash-catalogo.node.ts"

export const CATALOGO_ACTIVO: Catalogo = construirCatalogoMinimoReal()
