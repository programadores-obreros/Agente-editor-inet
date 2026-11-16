// `carga/artefacto.ts` — SÓLO LAS PRIMITIVAS de la huella de un artefacto.
//
// QUÉ HAY ACÁ: hashear una lista de archivos que declara quien llama, y comparar dos
// huellas. Nada más.
//
// QUÉ NO HAY, A PROPÓSITO. CONTRATOS-API §5 (v1.2) dice que el artefacto de un ESP32 son
// cuatro imágenes de `.pio/build/<env>/`. Eso está cuestionado por lo medido en R-01/R-02
// (`boot_app0.bin` no vive ahí; con `-t nobuild -t upload` se graba una sola región) y
// espera una decisión del owner: una región o cuatro, y desde qué carpeta. Hasta que esa
// decisión exista, este módulo NO decide qué archivos componen el artefacto, ni dónde se
// buscan, ni en qué offset va cada uno. `leerArtefacto`, `releerArtefacto`, `Imagen.offset`
// y `cruzarConIR` del contrato quedan sin implementar.
//
// SIN SEGUIR ENLACES. Un archivo que es un enlace simbólico se rechaza: el que aprueba
// una huella aprueba esos bytes, no "lo que haya detrás de ese nombre". Sólo se mira el
// último tramo de la ruta: que las carpetas de arriba no sean enlaces es cosa de quien
// llama (que pasa rutas canónicas).
//
// LÍMITE QUE NO SE ESCONDE. Hashear no cierra la carrera: entre que se hashea y que la
// herramienta de carga abre el archivo, otro proceso del mismo usuario lo puede cambiar
// (R-01). Estas primitivas detectan un cambio que PERSISTE; no prueban que no hubo uno.
//
// Este módulo importa sólo `node:`.

import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs"
import { isAbsolute } from "node:path"

export interface HuellaDeArchivo {
  /** La ruta tal como la declaró quien llama. */
  ruta: string
  bytes: number
  sha256: string
}

export interface HuellaDeArtefacto {
  /** En el orden declarado. */
  archivos: HuellaDeArchivo[]
  /** sha256 de la lista ordenada como se declaró: posición, tamaño y hash de cada archivo. No incluye las rutas. */
  sha256Conjunto: string
}

export type MotivoDeArchivo = "LISTA_VACIA" | "RUTA_NO_ABSOLUTA" | "RUTA_REPETIDA" | "FALTA" | "ES_ENLACE" | "NO_ES_ARCHIVO_REGULAR" | "VACIO" | "ILEGIBLE" | "CAMBIO_MIENTRAS_SE_LEIA"

export type ResultadoDeHashear =
  | { ok: true; huella: HuellaDeArtefacto }
  | { ok: false; codigo: "ARTEFACTO_AUSENTE"; ruta: string; motivo: MotivoDeArchivo }

const BLOQUE = 1024 * 1024

/** El hash del conjunto: depende del orden, del tamaño y del contenido de cada archivo, y de cuántos son. */
export function sha256DelConjunto(archivos: ReadonlyArray<{ bytes: number; sha256: string }>): string {
  const h = createHash("sha256")
  h.update(`tecnia-artefacto-v1\n${archivos.length}\n`)
  archivos.forEach((a, i) => h.update(`${i}\t${a.bytes}\t${a.sha256}\n`))
  return h.digest("hex")
}

function hashearUno(ruta: string): { ok: true; huella: HuellaDeArchivo } | { ok: false; motivo: MotivoDeArchivo } {
  let antes: ReturnType<typeof lstatSync>
  try {
    antes = lstatSync(ruta)
  } catch {
    return { ok: false, motivo: "FALTA" }
  }
  if (antes.isSymbolicLink()) return { ok: false, motivo: "ES_ENLACE" }
  if (!antes.isFile()) return { ok: false, motivo: "NO_ES_ARCHIVO_REGULAR" }
  let fd: number
  try {
    // O_NOFOLLOW: si entre el `lstat` y el `open` lo cambiaron por un enlace, el `open` falla.
    // En Windows la constante no existe y queda sólo la comparación de abajo.
    fd = openSync(ruta, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    return { ok: false, motivo: "ILEGIBLE" }
  }
  try {
    const abierto = fstatSync(fd)
    // Lo que se abrió tiene que ser lo mismo que se miró.
    if (!abierto.isFile() || abierto.ino !== antes.ino || abierto.dev !== antes.dev || abierto.size !== antes.size) return { ok: false, motivo: "CAMBIO_MIENTRAS_SE_LEIA" }
    if (abierto.size === 0) return { ok: false, motivo: "VACIO" }
    const h = createHash("sha256")
    const bloque = Buffer.allocUnsafe(BLOQUE)
    let total = 0
    for (;;) {
      const n = readSync(fd, bloque, 0, BLOQUE, null)
      if (n === 0) break
      h.update(bloque.subarray(0, n))
      total += n
    }
    // Si creció o se achicó mientras se leía, el hash no es de ningún estado conocido del archivo.
    if (total !== abierto.size || fstatSync(fd).size !== abierto.size) return { ok: false, motivo: "CAMBIO_MIENTRAS_SE_LEIA" }
    return { ok: true, huella: { ruta, bytes: total, sha256: h.digest("hex") } }
  } catch {
    return { ok: false, motivo: "ILEGIBLE" }
  } finally {
    closeSync(fd)
  }
}

/**
 * Hashea, en orden, los archivos que declara quien llama. O están TODOS y son archivos
 * comunes con contenido, o no hay huella: ante el primero que falla devuelve cuál y por qué.
 */
export function hashearArchivos(rutas: readonly string[]): ResultadoDeHashear {
  if (!Array.isArray(rutas) || rutas.length === 0) return { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta: "", motivo: "LISTA_VACIA" }
  const vistas = new Set<string>()
  const archivos: HuellaDeArchivo[] = []
  for (const ruta of rutas) {
    if (typeof ruta !== "string" || !isAbsolute(ruta)) return { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta: String(ruta), motivo: "RUTA_NO_ABSOLUTA" }
    if (vistas.has(ruta)) return { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta, motivo: "RUTA_REPETIDA" }
    vistas.add(ruta)
    const r = hashearUno(ruta)
    if (!r.ok) return { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta, motivo: r.motivo }
    archivos.push(r.huella)
  }
  return { ok: true, huella: { archivos, sha256Conjunto: sha256DelConjunto(archivos) } }
}

export type CambioDeArchivo = { ruta: string; cambio: "FALTA" | "SOBRA" | "ORDEN" | "TAMANO" | "CONTENIDO" }

export type ResultadoDeComparar =
  | { ok: true }
  | { ok: false; codigo: "FIRMWARE_CAMBIO"; cambios: CambioDeArchivo[] }

/**
 * Compara la huella que se aprobó con la que hay ahora. `ok` sólo si son los mismos
 * archivos, en el mismo orden, con el mismo tamaño y el mismo contenido. No confía en
 * el `sha256Conjunto` que traigan: compara archivo por archivo.
 */
export function compararHuellas(aprobada: HuellaDeArtefacto, actual: HuellaDeArtefacto): ResultadoDeComparar {
  const cambios: CambioDeArchivo[] = []
  const deAhora = new Map(actual.archivos.map((a, i) => [a.ruta, { a, i }]))
  const deAntes = new Set(aprobada.archivos.map((a) => a.ruta))
  aprobada.archivos.forEach((antes, i) => {
    const ahora = deAhora.get(antes.ruta)
    if (!ahora) cambios.push({ ruta: antes.ruta, cambio: "FALTA" })
    else if (ahora.a.bytes !== antes.bytes) cambios.push({ ruta: antes.ruta, cambio: "TAMANO" })
    else if (ahora.a.sha256 !== antes.sha256) cambios.push({ ruta: antes.ruta, cambio: "CONTENIDO" })
    else if (ahora.i !== i) cambios.push({ ruta: antes.ruta, cambio: "ORDEN" })
  })
  for (const a of actual.archivos) if (!deAntes.has(a.ruta)) cambios.push({ ruta: a.ruta, cambio: "SOBRA" })
  return cambios.length === 0 ? { ok: true } : { ok: false, codigo: "FIRMWARE_CAMBIO", cambios }
}
