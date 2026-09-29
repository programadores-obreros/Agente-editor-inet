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

import { mkdirSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
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
 * Fix de ronda única red-team, Hallazgo H1 (CRITICAL, P2-RED-A/INFORME.md, ataque
 * 1), mitad (a) — la raíz de composición (`composicion-raiz.ts`, núcleo, sin
 * `node:`) RECHAZA rutas no absolutas (mitad (b) del mismo fix) pero no puede
 * resolver equivalencias de ruta por su cuenta. Este módulo SÍ puede: vive fuera de
 * `opencode/nucleo/**`, así que `node:fs`/`node:path` están permitidos acá (la
 * guardia 29b de `tests/nucleo-adversarial.test.mjs` sólo escanea el núcleo).
 *
 * `fs.mkdirSync(dir, {recursive:true})` asegura que el directorio exista ANTES de
 * `fs.realpathSync` (que lanza `ENOENT` sobre un directorio inexistente) — mismo
 * efecto que ya hacía `crearAlmacen` internamente, sólo que acá hace falta ANTES,
 * para poder canonicalizar. `fs.realpathSync(path.resolve(dir))` resuelve relativo
 * contra `process.cwd()` EN EL MOMENTO DE ESTA LLAMADA (nunca más tarde — cierra
 * también el problema que ataque 1/caso B señaló: una ruta relativa que se
 * resolvía contra el `process.cwd()` de CADA operación de disco, no contra el del
 * momento de construcción) y resuelve symlinks — así "dir", "dir//", una ruta
 * relativa a la misma carpeta real, y un symlink a esa carpeta, dan la MISMA
 * cadena canónica y por lo tanto la MISMA clave en el singleton de
 * `composicion-raiz.ts` (`tests/phase2-directorio-canonico.test.mjs`).
 *
 * Límite documentado, no cerrado en esta ronda: en un filesystem
 * case-insensitive (Windows/macOS default), dos rutas que sólo difieren en
 * mayúsculas/minúsculas siguen dando dos cadenas canónicas DISTINTAS acá (ninguna
 * de las dos funciones normaliza case) aunque el FS real las resuelva al mismo
 * archivo — mismo estado `WINDOWS_UNVERIFIED` que el resto del slice.
 */
function directorioCanonico(directorio: string): string {
  mkdirSync(directorio, { recursive: true })
  return realpathSync(resolve(directorio))
}

/**
 * Equivalente a `obtenerServicioDeProyecto(opciones)`, pero SIEMPRE con
 * `calcularVista: vistaDeProyectoConCatalogoReal` — el snapshot que devuelve
 * `.snapshot()` trae la clave `vista` desde la primera construcción del singleton
 * para ese (directorio, idProyecto), sin importar quién llame primero (servidor
 * HTTP, tool de OpenCode, o un test de integración).
 */
export function obtenerServicioDeProyectoConVista(opciones: OpcionesServicioConVista): ServicioDeProyecto {
  const directorio = directorioCanonico(opciones.directorio)
  return obtenerServicioDeProyecto({ ...opciones, directorio, calcularVista: vistaDeProyectoConCatalogoReal })
}
