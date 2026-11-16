// `carga/registro.ts` — qué se anota de una carga, dónde y con qué forma (CONTRATOS-API §8).
//
// TRES ARCHIVOS:
//   - En el proyecto, `.pio/tecnia/ultima-carga.json`: la última carga que terminó BIEN Y
//     VERIFICADA. Sobrevive a que se vacíe `.pio/build`.
//   - En la compu, `<config>/opencode/tecnia-cargas.json`: una sal propia de esa compu y,
//     por placa, qué proyecto se cargó último. Mismo esquema que en 0.4.8.
//   - En los datos del proyecto físico, `.tecnia-vista-fisica/.banco.json`: última
//     compilación, última carga y último intento del banco de trabajo.
//
// QUÉ NO SE GUARDA NUNCA: la MAC, el número de serie, el `hwid`, el puerto, ninguna ruta.
// De la placa y de la MAC se guarda un hash con la sal de la compu. No es una promesa de
// buena conducta de quien llama: lo que se escribe se ARMA acá, campo por campo, y cada
// campo tiene que tener forma de hash, de fecha, de número o de código. Un campo de más
// no se copia; un campo con otra forma hace que no se escriba nada.
//
// UN REGISTRO NO CAMBIA EL RESULTADO DE UNA CARGA.
//   - Sólo se anota como "última carga" una carga verificada: `guardarUltimaCarga` rechaza
//     un registro con `verificado` distinto de `true`. Un rc 0 sin verificación no deja
//     rastro de éxito (ADR-001 §10.5, N-51).
//   - Si no se puede escribir, la función LO DICE (`ok: false`): no tira, y tampoco calla.
//     Quien llama tiene que contárselo al docente; la carga que salió bien sigue habiendo
//     salido bien, y la próxima vez se vuelve a preguntar todo (el lado seguro).
//   - Se escribe en un temporal y se renombra: un corte a mitad no deja un JSON por la
//     mitad que después se lea como un registro válido.
//   - No se escribe a través de un enlace simbólico (`.pio`, `.pio/tecnia` o el archivo).
//
// ESTADO: el módulo está listo y probado, pero `tool/platformio.ts` todavía usa su propio
// registro (versión 3). La mudanza es de la Etapa 4.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { createHash, randomBytes } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, win32 } from "node:path"
import { hashDePlacaFisica, identidadDePlaca } from "./identidad.ts"

/** De dónde vino el pedido de carga (CONTRATOS-API §6). Cuando exista `carga/autorizacion.ts`, el tipo vive ahí. */
export type OrigenDeCarga = "platformio-flash" | "platformio-both" | "programa" | "web" | "vivo"
const ORIGENES: readonly string[] = ["platformio-flash", "platformio-both", "programa", "web", "vivo"]

export interface UltimaCarga {
  version: 4
  origen: OrigenDeCarga
  /** Hash de la huella de pines del código que se cargó. */
  huella: string
  /** Hash con sal de la identidad de la placa. Nunca `VID:PID#serie` en claro. */
  placaFisica: string
  /** sha256 del conjunto de imágenes que se cargó. */
  artefactoSha256: string
  /** Siempre `true` en un registro guardado: lo no verificado no se anota. */
  verificado: boolean
  /** Hash con sal de la MAC que informó el chip, si la informó. */
  macHash?: string
  fechaUtc: string
}

/** Un registro de 0.4.8 (versiones 2 y 3): se lee para no perder el aviso de "otra placa", no se escribe más. */
export interface UltimaCargaHeredada {
  version: 2 | 3
  placa: string
  entradas: string[]
  placaFisica: string | null
  marcaSal: string | null
}

export type ResultadoDeGuardar = { ok: true } | { ok: false; codigo: "REGISTRO_NO_GUARDADO"; detalle: string }

const HASH = /^[0-9a-f]{16,64}$/
const SHA256 = /^[0-9a-f]{64}$/
const FECHA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const CODIGO = /^[A-Z][A-Z0-9_]{0,48}$/
const TAMANO_MAXIMO = 64 * 1024

const noGuardado = (detalle: string): ResultadoDeGuardar => ({ ok: false, codigo: "REGISTRO_NO_GUARDADO", detalle })
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const entero = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0
const hash16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16)

function mirar(ruta: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(ruta)
  } catch {
    return null
  }
}

/** Lee un JSON chico de un archivo regular. `null` si no está, si es un enlace, si es enorme o si no es JSON. */
function leerJson(ruta: string): unknown {
  const st = mirar(ruta)
  if (!st || !st.isFile() || st.size > TAMANO_MAXIMO) return null
  try {
    return JSON.parse(readFileSync(ruta, "utf8"))
  } catch {
    return null
  }
}

/**
 * Escribe `datos` en `ruta` sin dejar nunca un archivo a medias: temporal + rename. Crea
 * las carpetas que falten DESDE `base` (que tiene que existir) y no atraviesa enlaces.
 */
function escribirJson(base: string, tramos: readonly string[], datos: unknown): ResultadoDeGuardar {
  let dir = base
  try {
    for (const tramo of tramos.slice(0, -1)) {
      dir = join(dir, tramo)
      const st = mirar(dir)
      if (st && !st.isDirectory()) return noGuardado(`\`${tramo}\` no es una carpeta común (es un enlace u otra cosa)`)
      if (!st) mkdirSync(dir)
    }
    const ruta = join(dir, tramos[tramos.length - 1]!)
    const st = mirar(ruta)
    if (st && !st.isFile()) return noGuardado("el archivo del registro no es un archivo común (es un enlace u otra cosa)")
    const temporal = `${ruta}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
    try {
      writeFileSync(temporal, JSON.stringify(datos, null, 2), { flag: "wx" })
      renameSync(temporal, ruta)
    } catch (error) {
      rmSync(temporal, { force: true })
      throw error
    }
    return { ok: true }
  } catch (error) {
    return noGuardado(error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : "error de escritura")
  }
}

// ── La última carga del proyecto ─────────────────────────────────────────────────────────

export function rutaUltimaCarga(cwd: string): string {
  return join(cwd, ".pio", "tecnia", "ultima-carga.json")
}

/** Si `u` es un registro de versión 4 bien formado. Es lo que se exige para leer Y para escribir. */
function esUltimaCarga(u: unknown): u is UltimaCarga {
  return (
    esObjeto(u) &&
    u.version === 4 &&
    typeof u.origen === "string" && ORIGENES.includes(u.origen) &&
    typeof u.huella === "string" && HASH.test(u.huella) &&
    typeof u.placaFisica === "string" && HASH.test(u.placaFisica) &&
    typeof u.artefactoSha256 === "string" && SHA256.test(u.artefactoSha256) &&
    typeof u.verificado === "boolean" &&
    (u.macHash === undefined || (typeof u.macHash === "string" && HASH.test(u.macHash))) &&
    typeof u.fechaUtc === "string" && FECHA_UTC.test(u.fechaUtc)
  )
}

/**
 * La última carga anotada en el proyecto, o `null`. Acepta la versión 4 y las de 0.4.8
 * (2 y 3), que vuelven con SU forma: no se inventan los campos que no tenían. Un archivo
 * roto, de otra versión, o un 4 al que le falta algo → `null` (se vuelve a preguntar todo).
 */
export function leerUltimaCarga(cwd: string): UltimaCarga | UltimaCargaHeredada | null {
  const d = leerJson(rutaUltimaCarga(cwd))
  if (!esObjeto(d)) return null
  if (d.version === 4) {
    if (!esUltimaCarga(d) || d.verificado !== true) return null
    return { version: 4, origen: d.origen, huella: d.huella, placaFisica: d.placaFisica, artefactoSha256: d.artefactoSha256, verificado: true, ...(d.macHash ? { macHash: d.macHash } : {}), fechaUtc: d.fechaUtc }
  }
  if ((d.version === 2 || d.version === 3) && typeof d.placa === "string" && Array.isArray(d.entradas)) {
    return {
      version: d.version,
      placa: d.placa,
      entradas: d.entradas.filter((e): e is string => typeof e === "string"),
      placaFisica: typeof d.placaFisica === "string" ? d.placaFisica : null,
      marcaSal: typeof d.marcaSal === "string" ? d.marcaSal : null,
    }
  }
  return null
}

/**
 * Anota la carga que acaba de terminar BIEN Y VERIFICADA. Si `u.verificado` no es `true`,
 * no escribe (y lo dice). Si se pasa el `hwid` de la placa, anota además en el registro de
 * la compu que en esa placa quedó este proyecto; de ese `hwid` sólo se guarda un hash.
 *
 * Nunca tira. `ok: false` quiere decir "no quedó anotado": la carga no deja de haber
 * salido bien por eso, pero hay que avisarlo.
 */
export function guardarUltimaCarga(cwd: string, u: UltimaCarga, hwid?: string): ResultadoDeGuardar {
  if (!esUltimaCarga(u)) return noGuardado("el registro no tiene la forma esperada (algún campo no es un hash, una fecha o un origen conocido)")
  if (u.verificado !== true) return noGuardado("la carga no está verificada: no se anota como última carga")
  if (!mirar(cwd)?.isDirectory()) return noGuardado("la carpeta del proyecto no existe")
  const limpio: UltimaCarga = { version: 4, origen: u.origen, huella: u.huella, placaFisica: u.placaFisica, artefactoSha256: u.artefactoSha256, verificado: true, ...(u.macHash ? { macHash: u.macHash } : {}), fechaUtc: u.fechaUtc }
  const guardado = escribirJson(cwd, [".pio", "tecnia", "ultima-carga.json"], limpio)
  if (!guardado.ok) return guardado
  if (hwid !== undefined) {
    const ident = identidadDePlaca(hwid)
    if (ident.modelo) {
      const cargas = leerCargasGlobal()
      const placa = hashDePlacaFisica(cargas.sal, ident.modelo, ident.serie).slice(0, 16)
      cargas.placas[placa] = hash16(`${cargas.sal}|${rutaNormalizada(cwd)}`)
      const global = escribirCargasGlobal(cargas)
      if (!global.ok) return noGuardado(`se anotó en el proyecto, pero no en el registro de la compu: ${global.detalle}`)
    }
  }
  return { ok: true }
}

// ── El registro de la compu ──────────────────────────────────────────────────────────────

export interface CargasGlobal {
  sal: string
  /** hash de placa → hash de proyecto, los dos con la sal. */
  placas: Record<string, string>
}

export function rutaCargasGlobal(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "tecnia-cargas.json")
}

/** La ruta del proyecto como se compara: en Windows, en minúsculas y con `/`. Igual que en 0.4.8. */
function rutaNormalizada(cwd: string): string {
  if (/^[a-z]:[\\/]/i.test(cwd) || process.platform === "win32") return win32.resolve(cwd).replace(/\\/g, "/").toLowerCase()
  return resolve(cwd)
}

/** Sales que no se pudieron guardar: se recuerdan para este proceso, así no cambian en cada llamada. */
const salesSinGuardar = new Map<string, string>()

function escribirCargasGlobal(cargas: CargasGlobal): ResultadoDeGuardar {
  const ruta = rutaCargasGlobal()
  try {
    mkdirSync(dirname(dirname(ruta)), { recursive: true })
  } catch (error) {
    return noGuardado(error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : "error de escritura")
  }
  return escribirJson(dirname(dirname(ruta)), ["opencode", "tecnia-cargas.json"], { sal: cargas.sal, placas: cargas.placas })
}

/**
 * El registro de cargas de la compu. Si no existe o está roto, la sal nueva se crea UNA
 * vez y se guarda en el acto (si no se puede guardar, se recuerda para este proceso). Las
 * entradas de `placas` que no son hash → hash se descartan al leer.
 */
export function leerCargasGlobal(): CargasGlobal {
  const ruta = rutaCargasGlobal()
  const d = leerJson(ruta)
  if (esObjeto(d) && typeof d.sal === "string" && /^[0-9a-f]{16,128}$/.test(d.sal) && esObjeto(d.placas)) {
    const placas: Record<string, string> = {}
    for (const [k, v] of Object.entries(d.placas)) if (HASH.test(k) && typeof v === "string" && HASH.test(v)) placas[k] = v
    return { sal: d.sal, placas }
  }
  const nuevo: CargasGlobal = { sal: salesSinGuardar.get(ruta) ?? randomBytes(16).toString("hex"), placas: {} }
  if (escribirCargasGlobal(nuevo).ok) salesSinGuardar.delete(ruta)
  else salesSinGuardar.set(ruta, nuevo.sal)
  return nuevo
}

/** El hash con sal de una MAC, que es lo único de la MAC que se guarda. */
export function hashDeMac(sal: string, mac: string): string {
  return createHash("sha256").update(`${sal}|mac|${mac.trim().toLowerCase()}`).digest("hex")
}

// ── El banco de trabajo del proyecto físico ──────────────────────────────────────────────

export interface Banco {
  /** Hash con sal de la placa. Nunca `VID:PID#serie`. */
  placaFisica?: string
  ultimaCompilacion?: { revision: number; catalogoHash: string; fuentesSha256: string; sha256Conjunto: string; fechaUtc: string }
  ultimaCarga?: { revision: number; sha256Conjunto: string; fechaUtc: string; origen: OrigenDeCarga }
  ultimoIntento?: { fechaUtc: string; codigo: string }
}

export function rutaBanco(dirDatos: string): string {
  return join(dirDatos, ".tecnia-vista-fisica", ".banco.json")
}

/** Se queda sólo con los campos del contrato que tienen la forma del contrato. `null` si alguno presente está mal. */
function bancoLimpio(x: unknown): Banco | null {
  if (!esObjeto(x)) return null
  const b: Banco = {}
  if (x.placaFisica !== undefined) {
    if (typeof x.placaFisica !== "string" || !HASH.test(x.placaFisica)) return null
    b.placaFisica = x.placaFisica
  }
  if (x.ultimaCompilacion !== undefined) {
    const c = x.ultimaCompilacion
    if (!esObjeto(c) || !entero(c.revision) || typeof c.catalogoHash !== "string" || !HASH.test(c.catalogoHash) || typeof c.fuentesSha256 !== "string" || !SHA256.test(c.fuentesSha256) || typeof c.sha256Conjunto !== "string" || !SHA256.test(c.sha256Conjunto) || typeof c.fechaUtc !== "string" || !FECHA_UTC.test(c.fechaUtc)) return null
    b.ultimaCompilacion = { revision: c.revision, catalogoHash: c.catalogoHash, fuentesSha256: c.fuentesSha256, sha256Conjunto: c.sha256Conjunto, fechaUtc: c.fechaUtc }
  }
  if (x.ultimaCarga !== undefined) {
    const c = x.ultimaCarga
    if (!esObjeto(c) || !entero(c.revision) || typeof c.sha256Conjunto !== "string" || !SHA256.test(c.sha256Conjunto) || typeof c.fechaUtc !== "string" || !FECHA_UTC.test(c.fechaUtc) || typeof c.origen !== "string" || !ORIGENES.includes(c.origen)) return null
    b.ultimaCarga = { revision: c.revision, sha256Conjunto: c.sha256Conjunto, fechaUtc: c.fechaUtc, origen: c.origen as OrigenDeCarga }
  }
  if (x.ultimoIntento !== undefined) {
    const c = x.ultimoIntento
    if (!esObjeto(c) || typeof c.fechaUtc !== "string" || !FECHA_UTC.test(c.fechaUtc) || typeof c.codigo !== "string" || !CODIGO.test(c.codigo)) return null
    b.ultimoIntento = { fechaUtc: c.fechaUtc, codigo: c.codigo }
  }
  return b
}

/** El banco del proyecto, o `null` si no hay, está roto o trae un campo con otra forma. */
export function leerBanco(dirDatos: string): Banco | null {
  return bancoLimpio(leerJson(rutaBanco(dirDatos)))
}

/** Guarda el banco. Mismas reglas que `guardarUltimaCarga`: nunca tira, y si no pudo lo dice. */
export function guardarBanco(dirDatos: string, b: Banco): ResultadoDeGuardar {
  const limpio = bancoLimpio(b)
  if (!limpio) return noGuardado("el banco trae un campo que no es un hash, una fecha, un número o un código")
  if (!mirar(dirDatos)?.isDirectory()) return noGuardado("la carpeta de datos del proyecto no existe")
  return escribirJson(dirDatos, [".tecnia-vista-fisica", ".banco.json"], limpio)
}
