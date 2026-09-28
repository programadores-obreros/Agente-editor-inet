#!/usr/bin/env node
// Guardia estructural — Phase 2, Slice 1 (servidor HTTP, tarea 1 del writer W3): el
// ÚNICO módulo de producción autorizado a llamar `obtenerServicioDeProyecto`
// (`opencode/nucleo/composicion-raiz.ts`) es
// `opencode/servidor/servicio-con-vista.ts` — así ningún consumidor real (servidor
// HTTP, y después la tool de OpenCode, W4) puede terminar con un servicio SIN la
// vista física por llamar a la raíz de composición directo, salteándose
// `calcularVista: vistaDeProyectoConCatalogoReal`
// (docs/programacion-intencion/PHASE_2_SLICE_1_PROTOCOL.md, "Integración con la raíz
// de composición — decisión registrada").
//
// Mismo mecanismo que `scripts/guardia-composicion-raiz.mjs` (E3-04b, `crearAlmacen`)
// — fs + regex en JS puro, sin linter de boundaries nuevo. Los dos guardias son
// independientes: éste NO reemplaza al de `crearAlmacen`, cierra una frontera
// DISTINTA (uso del servicio, no construcción del Almacen).
//
// Uso:
//   node scripts/guardia-servicio-con-vista.mjs                # escanea el repo real
//   node scripts/guardia-servicio-con-vista.mjs --raiz <dir>   # escanea OTRA raíz

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_POR_DEFECTO = join(SCRIPT_DIR, "..")

export const SUBDIRECTORIOS_POR_DEFECTO = ["opencode", "scripts"]
const EXTENSIONES = new Set([".ts", ".js", ".mjs"])
const DIRECTORIOS_EXCLUIDOS = new Set(["node_modules", ".git"])

/** tests/** son fixtures aisladas, no producción (mismo criterio que
 * guardia-composicion-raiz.mjs) — `tests/phase2-helpers.mjs` y los tests de
 * integración SÍ llaman `obtenerServicioDeProyecto` directo, a propósito, para
 * probar el hook `calcularVista` en sí mismo y el resto de composicion-raiz.ts sin
 * pasar por este módulo. */
const PATRONES_EXENTOS = [/(^|\/)tests\//, /\.test\.(ts|js|mjs)$/]

/** Los DOS únicos archivos de producción autorizados a referenciar
 * `obtenerServicioDeProyecto`: quien lo DEFINE (composicion-raiz.ts, `export
 * function obtenerServicioDeProyecto`) y quien lo LLAMA a propósito
 * (servicio-con-vista.ts, este slice). Ningún otro archivo de producción. */
export const ARCHIVOS_AUTORIZADOS_POR_DEFECTO = ["opencode/nucleo/composicion-raiz.ts", "opencode/servidor/servicio-con-vista.ts"]

const PATRON_OBTENER_SERVICIO = /\bobtenerServicioDeProyecto\b/

const RUTA_PROPIA = "scripts/guardia-servicio-con-vista.mjs"

function quitarComentarios(codigo) {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

function listarArchivos(raizAbsoluta, subdirectorios) {
  const archivos = []
  function recorrer(dirAbsoluto) {
    let entradas
    try {
      entradas = readdirSync(dirAbsoluto, { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      if (DIRECTORIOS_EXCLUIDOS.has(entrada.name)) continue
      const rutaAbsoluta = join(dirAbsoluto, entrada.name)
      if (entrada.isDirectory()) {
        recorrer(rutaAbsoluta)
        continue
      }
      if (!entrada.isFile()) continue
      const punto = entrada.name.lastIndexOf(".")
      const extension = punto === -1 ? "" : entrada.name.slice(punto)
      if (!EXTENSIONES.has(extension)) continue
      archivos.push(rutaAbsoluta)
    }
  }
  for (const sub of subdirectorios) recorrer(join(raizAbsoluta, sub))
  return archivos
}

function esRutaExenta(rutaRelativaNormalizada) {
  return PATRONES_EXENTOS.some((patron) => patron.test(rutaRelativaNormalizada))
}

/**
 * Escanea `raiz` (por defecto, el repo real) y devuelve las violaciones: archivos de
 * producción, fuera de `archivosAutorizados` y de `tests/**`, que referencian
 * `obtenerServicioDeProyecto`.
 */
export function verificar(opciones = {}) {
  const raizAbsoluta = resolve(opciones.raiz ?? REPO_POR_DEFECTO)
  const subdirectorios = opciones.subdirectorios ?? SUBDIRECTORIOS_POR_DEFECTO
  const autorizados = new Set(opciones.archivosAutorizados ?? ARCHIVOS_AUTORIZADOS_POR_DEFECTO)

  const violaciones = []
  for (const rutaAbsoluta of listarArchivos(raizAbsoluta, subdirectorios)) {
    const rutaRelativa = relative(raizAbsoluta, rutaAbsoluta).split(sep).join("/")
    if (autorizados.has(rutaRelativa)) continue
    if (esRutaExenta(rutaRelativa)) continue
    if (rutaRelativa === RUTA_PROPIA) continue
    const contenidoCrudo = readFileSync(rutaAbsoluta, "utf8")
    const contenido = quitarComentarios(contenidoCrudo)
    if (PATRON_OBTENER_SERVICIO.test(contenido)) {
      violaciones.push({ archivo: rutaRelativa, motivos: ["referencia obtenerServicioDeProyecto"] })
    }
  }
  return { violaciones }
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  const indiceRaiz = process.argv.indexOf("--raiz")
  const raiz = indiceRaiz !== -1 ? process.argv[indiceRaiz + 1] : undefined
  const { violaciones } = verificar(raiz ? { raiz } : {})
  if (violaciones.length > 0) {
    console.error(`${violaciones.length} violacion(es): consumidor de produccion fuera de servicio-con-vista.ts llama obtenerServicioDeProyecto directo:`)
    for (const v of violaciones) console.error(`  - ${v.archivo}: ${v.motivos.join(", ")}`)
    process.exit(1)
  }
  console.log("OK: ningun archivo de produccion fuera de nucleo/composicion-raiz.ts y servidor/servicio-con-vista.ts referencia obtenerServicioDeProyecto.")
}
