// Único punto de producción para obtener un `ServicioDeProyecto` CON vista física —
// Phase 2, Slice 1 (PHASE_2_SLICE_1_PROTOCOL.md, "Integración con la raíz de
// composición — decisión registrada", opción 2 elegida por W2).
//
// `composicion-raiz.ts` (dentro de `opencode/nucleo/**`) expone el hook
// `calcularVista` pero DELIBERADAMENTE no lo inyecta por defecto — el núcleo no
// depende de `vista-fisica/**` (esa dependencia sólo puede ir en un sentido:
// vista-fisica → nucleo, nunca al revés, PHASE_2_SLICE_1_DESIGN.md §2.6). Este
// módulo es quien conecta las dos puntas, para que NINGÚN consumidor real (servidor
// HTTP, y después la tool de OpenCode, W4) tenga que acordarse de pasar
// `calcularVista: vistaDeProyectoConCatalogoReal` a mano cada vez que llama
// `obtenerServicioDeProyecto(...)` — un solo call site, un solo lugar para
// equivocarse.
//
// Por qué importa que sea el ÚNICO call site: `obtenerServicioDeProyecto` es un
// singleton por (directorio, idProyecto) memoizado a nivel de módulo — el hook
// `calcularVista` SÓLO se fija la PRIMERA vez que se construye el servicio para una
// clave dada (composicion-raiz.ts, docstring de `OpcionesServicioDeProyecto.
// calcularVista`); una llamada posterior que reusa el singleton lo ignora. Si el
// servidor HTTP y la tool (o dos tests distintos) llamaran a
// `obtenerServicioDeProyecto` por su cuenta, con o sin el hook según quién llegue
// primero, el snapshot resultante dependería de una carrera de arranque — exactamente
// el defecto que este módulo cierra: TODO consumidor de producción pasa por acá, así
// que TODO consumidor ve el snapshot con `vista` desde la primera construcción,
// siempre.
//
// Guardia estructural verificable: scripts/guardia-servicio-con-vista.mjs +
// tests/phase2-servicio-con-vista.test.mjs, sección (c) — ningún archivo de
// producción fuera de este módulo referencia `obtenerServicioDeProyecto` directo
// (los tests, que fabrican fixtures aislados a propósito, quedan exceptuados, mismo
// criterio que scripts/guardia-composicion-raiz.mjs para `crearAlmacen`).

import type { OpcionesServicioDeProyecto, ServicioDeProyecto } from "../nucleo/composicion-raiz.ts"
import { obtenerServicioDeProyecto } from "../nucleo/composicion-raiz.ts"
import { vistaDeProyectoConCatalogoReal } from "../vista-fisica/vista-real.ts"

/**
 * Mismas opciones que `OpcionesServicioDeProyecto`, MENOS `calcularVista` — ese
 * campo lo fija este módulo siempre, nunca el llamador (si un consumidor pudiera
 * pisarlo, volvería a abrir la carrera de arranque que este módulo existe para
 * cerrar).
 */
export type OpcionesServicioConVista = Omit<OpcionesServicioDeProyecto, "calcularVista">

/**
 * Equivalente a `obtenerServicioDeProyecto(opciones)`, pero SIEMPRE con
 * `calcularVista: vistaDeProyectoConCatalogoReal` — el snapshot que devuelve
 * `.snapshot()` trae la clave `vista` desde la primera construcción del singleton
 * para ese (directorio, idProyecto), sin importar quién llame primero (servidor
 * HTTP, tool de OpenCode, o un test de integración).
 */
export function obtenerServicioDeProyectoConVista(opciones: OpcionesServicioConVista): ServicioDeProyecto {
  return obtenerServicioDeProyecto({ ...opciones, calcularVista: vistaDeProyectoConCatalogoReal })
}
