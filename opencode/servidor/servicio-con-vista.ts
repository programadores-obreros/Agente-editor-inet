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

import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from "node:fs"
import { hostname } from "node:os"
import { join, resolve } from "node:path"
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

// ════════════════════════════════════════════════════════════════════════════════════
// Fix de ronda única red-team, Hallazgo H5 (CRITICAL, P2-RED-A/INFORME.md, ataque 6):
// candado de propiedad por proyecto, A NIVEL PROCESO — ver el docstring largo arriba
// del archivo (encabezado) para el contrato completo. Vive ACÁ (nunca en
// `almacen.ts` ni en `composicion-raiz.ts`): los tests de Phase 1 fabrican varios
// `Almacen` sobre el mismo directorio a propósito (aislamiento de fixtures) y no se
// pueden romper; este candado sólo protege el CAMINO DE PRODUCCIÓN (este módulo).
//
// Por qué `fs.openSync(ruta, "wx")` y no el patrón de `almacen.ts`: `"wx"` es
// `O_CREAT | O_EXCL | O_WRONLY` — el sistema operativo garantiza que la creación es
// ATÓMICA (si el archivo ya existe, `open()` falla con `EEXIST`, sin ninguna ventana
// entre "leer si existe" y "escribir"), a diferencia del CAS de `almacen.ts::guardar`
// (leer disco, comparar revisión, RECIÉN DESPUÉS escribir — ahí sí hay una ventana,
// documentada como el límite de E3-07 que H5 reabrió con evidencia ejecutable).
//
// Límites documentados, NO cerrados en esta ronda:
// - Reuso de PID: si el proceso dueño original murió y el sistema operativo reasignó
//   su PID a un proceso completamente distinto ANTES de que este código chequee
//   `estaVivo(pid)`, el candado se ve "vivo" cuando en realidad pertenece a otro
//   programa — ventana angosta en la práctica (miles de PIDs entre medio en un
//   sistema típico), no eliminada.
// - Filesystems de red: `O_EXCL` es atómico garantizado en filesystems locales
//   (ext4/APFS/NTFS); versiones viejas de NFS (anteriores a NFSv3 con locking
//   correcto) documentaron históricamente a `O_EXCL` como no confiable entre hosts
//   distintos — este candado asume un filesystem local o un NFS moderno.
// - Mayúsculas/minúsculas del `hostname()`: no se normaliza (`WINDOWS_UNVERIFIED`,
//   igual criterio que el resto del slice).
// ════════════════════════════════════════════════════════════════════════════════════

interface ContenidoCandado {
  readonly pid: number
  readonly hostname: string
  readonly creado: string
}

/** Candados que ESTE proceso sostiene ahora mismo, por clave (directorio canónico +
 * idProyecto) — para (1) no volver a intentar tomar el candado en una llamada
 * repetida dentro del MISMO proceso para la misma clave (el singleton de
 * `composicion-raiz.ts` ya deduplica el servicio; acá deduplicamos el intento de
 * candado) y (2) liberarlos todos al salir del proceso. */
const candadosPropios = new Map<string, { readonly rutaLock: string; readonly contenido: ContenidoCandado }>()
const wrappersPropios = new Map<string, ServicioDeProyecto>()

let limpiezaAlSalirRegistrada = false
function asegurarLimpiezaAlSalir(): void {
  if (limpiezaAlSalirRegistrada) return
  limpiezaAlSalirRegistrada = true
  // `process.on("exit")` corre SÓLO código síncrono (Node ya está terminando) — por
  // eso todo acá abajo (leer/comparar/borrar) es síncrono, nunca una promesa.
  process.on("exit", () => {
    for (const { rutaLock, contenido } of candadosPropios.values()) liberarCandadoSiPropio(rutaLock, contenido)
  })
}

/** `process.kill(pid, 0)` no manda ninguna señal real — sólo prueba si el proceso
 * existe y si tenemos permiso para señalarlo. `ESRCH` = no existe (muerto). `EPERM`
 * = existe pero es de otro usuario (vivo, no podemos verificarlo mejor que eso —
 * tratamos "no podemos matarlo" como "está vivo", el criterio conservador). */
function estaVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const codigo = (error as NodeJS.ErrnoException).code
    if (codigo === "ESRCH") return false
    if (codigo === "EPERM") return true
    return false // cualquier otro error: no verificable -> se trata como recuperable, nunca como bloqueo eterno
  }
}

function leerCandado(rutaLock: string): ContenidoCandado | null {
  try {
    const contenido: unknown = JSON.parse(readFileSync(rutaLock, "utf8"))
    if (contenido !== null && typeof contenido === "object" && "pid" in contenido && "hostname" in contenido) return contenido as ContenidoCandado
    return null
  } catch {
    return null // no legible/no JSON -> tratado como "corrupto", se recupera (mismo criterio que un pid muerto)
  }
}

function escribirCandado(rutaLock: string, contenido: ContenidoCandado, modo: "wx" | "w"): void {
  const fd = openSync(rutaLock, modo)
  try {
    writeSync(fd, JSON.stringify(contenido))
  } finally {
    closeSync(fd)
  }
}

/** Nunca borra a ciegas: lee el candado ANTES de borrar y sólo lo hace si el
 * contenido sigue siendo EXACTAMENTE el que este proceso escribió — así `cerrar()`
 * (o la salida del proceso) nunca pisa el candado de OTRO proceso que ya lo haya
 * recuperado (ej. si este proceso murió, otro lo recuperó, y recién ahí corre esta
 * limpieza tardía). */
function liberarCandadoSiPropio(rutaLock: string, contenidoPropio: ContenidoCandado): void {
  const actual = leerCandado(rutaLock)
  if (actual && actual.pid === contenidoPropio.pid && actual.hostname === contenidoPropio.hostname && actual.creado === contenidoPropio.creado) {
    try {
      unlinkSync(rutaLock)
    } catch {
      // ya no estaba (alguien más lo borró primero) — no es un error real acá.
    }
  }
}

function tomarCandado(directorio: string, idProyecto: string): { rutaLock: string; contenido: ContenidoCandado } {
  const rutaLock = join(directorio, `${idProyecto}.lock`)
  const contenido: ContenidoCandado = { pid: process.pid, hostname: hostname(), creado: new Date().toISOString() }
  try {
    escribirCandado(rutaLock, contenido, "wx")
    return { rutaLock, contenido }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existente = leerCandado(rutaLock)
    if (existente && existente.hostname === contenido.hostname && estaVivo(existente.pid)) {
      throw new Error(
        `servicio-con-vista: el proyecto "${idProyecto}" en "${directorio}" ya está abierto en otro proceso (pid ${existente.pid}) — cerralo ahí antes de abrirlo acá.`,
      )
    }
    // Dueño anterior muerto (o candado corrupto/no legible) — se recupera: el
    // reemplazo queda registrado en el propio archivo (nuevo pid/hostname/creado).
    escribirCandado(rutaLock, contenido, "w")
    return { rutaLock, contenido }
  }
}

/**
 * Equivalente a `obtenerServicioDeProyecto(opciones)`, pero SIEMPRE con
 * `calcularVista: vistaDeProyectoConCatalogoReal` — el snapshot que devuelve
 * `.snapshot()` trae la clave `vista` desde la primera construcción del singleton
 * para ese (directorio, idProyecto), sin importar quién llame primero (servidor
 * HTTP, tool de OpenCode, o un test de integración).
 *
 * Fix H5 (ver arriba): además, toma un candado de propiedad por PROCESO para ese
 * (directorio, idProyecto) — si otro proceso de sistema operativo ya lo tiene
 * abierto, esta llamada FALLA con un error claro en vez de construir un segundo
 * motor que compita en el CAS de disco. Una llamada repetida en el MISMO proceso
 * para la MISMA clave reusa el wrapper ya construido (nunca vuelve a intentar tomar
 * el candado — ya lo tiene).
 */
export function obtenerServicioDeProyectoConVista(opciones: OpcionesServicioConVista): ServicioDeProyecto {
  const directorio = directorioCanonico(opciones.directorio)
  const clave = `${directorio}::${opciones.idProyecto}`

  const wrapperExistente = wrappersPropios.get(clave)
  if (wrapperExistente) return wrapperExistente

  const { rutaLock, contenido } = tomarCandado(directorio, opciones.idProyecto)
  asegurarLimpiezaAlSalir()
  candadosPropios.set(clave, { rutaLock, contenido })

  const base = obtenerServicioDeProyecto({ ...opciones, directorio, calcularVista: vistaDeProyectoConCatalogoReal })

  const wrapper: ServicioDeProyecto = {
    snapshot: () => base.snapshot(),
    aplicar: (sobre) => base.aplicar(sobre),
    aplicarTransaccion: (sobres) => base.aplicarTransaccion(sobres),
    proponer: (sobres) => base.proponer(sobres),
    suscribir: (listener) => base.suscribir(listener),
    cerrar() {
      base.cerrar()
      wrappersPropios.delete(clave)
      candadosPropios.delete(clave)
      liberarCandadoSiPropio(rutaLock, contenido)
    },
  }
  wrappersPropios.set(clave, wrapper)
  return wrapper
}
