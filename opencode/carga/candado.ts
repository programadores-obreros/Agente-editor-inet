// Candado en disco ENTRE PROCESOS — el mecanismo, sin dueño de negocio.
//
// DE DÓNDE SALE. Es, sin cambio de comportamiento, el candado de propiedad por proyecto
// que vivía entero en `opencode/servidor/servicio-con-vista.ts` (fix H5, endurecido por
// DR-53 y DR-54). Se sacó a un módulo propio porque la carga de firmware necesita
// exactamente la misma garantía sobre el puerto serie (ADR-001 §10.4, decisión D4 del
// owner): dos procesos de OpenCode no pueden cargar a la vez en la misma placa.
// `servicio-con-vista.ts` lo importa de acá y conserva sus textos; `carga/puertos.ts` lo
// usa con la ruta del candado del puerto. Los tests que ya lo cubrían siguen siendo los
// de siempre (`tests/phase2-candado-*.test.mjs`), y `tests/carga-candado.test.mjs` lo
// prueba directo.
//
// POR QUÉ VIVE EN `carga/` Y NO EN `nucleo/` (DESVIACIÓN respecto de ADR-001 §10.4 y
// CONTRATOS-API §3, que lo nombran `opencode/nucleo/candado.ts`). El núcleo tiene un
// guard que este archivo no puede cumplir: `tests/nucleo-adversarial.test.mjs`, test 29b,
// sólo admite `node:` en `almacen.ts` y `adaptadores/hash-catalogo.node.ts`. Un candado
// en disco es `node:fs` por definición. Entre ensanchar la lista de un guard existente y
// cambiar la carpeta de un archivo nuevo, se eligió lo segundo: mover este archivo a
// `nucleo/` más adelante es un `git mv` y una línea en esa lista, y es decisión del
// owner, no de quien implementa.
//
// QUÉ GARANTIZA.
//   - Un solo dueño: la creación es EXCLUSIVA y atómica (`link()` desde un temporal ya
//     escrito; `"wx"` sólo donde no hay hard links).
//   - Un candado que existe pero no se puede leer NO está libre: nunca se pisa (DR-53).
//   - Un candado de un dueño muerto se recupera, pero sólo quien gana el reclamo
//     `<candado>.recuperando` y sólo si el candado sigue siendo EXACTAMENTE el que
//     inspeccionó (DR-54).
//   - Liberar borra únicamente si el contenido sigue siendo el propio.
//
// LÍMITES HEREDADOS, declarados y NO cerrados:
//   - Reuso de PID: si el dueño murió y el sistema le dio su PID a otro programa antes
//     de que alguien mire, el candado se ve "vivo". Ventana angosta, no eliminada.
//   - Filesystems de red viejos: `O_EXCL`/`link()` se asumen atómicos (ext4, APFS, NTFS,
//     NFS moderno).
//   - `hostname()` no se normaliza: un candado de OTRO host se trata como vencido.
//   - Windows: NO VERIFICADO (va a la QA en la VM).

import { closeSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { hostname } from "node:os"

export interface ContenidoCandado {
  readonly pid: number
  readonly hostname: string
  readonly creado: string
}

/** `process.kill(pid, 0)` no manda ninguna señal real — sólo prueba si el proceso
 * existe y si tenemos permiso para señalarlo. `ESRCH` = no existe (muerto). `EPERM`
 * = existe pero es de otro usuario (vivo, no podemos verificarlo mejor que eso —
 * tratamos "no podemos matarlo" como "está vivo", el criterio conservador). */
export function estaVivo(pid: number): boolean {
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

/** `null` = el candado existe pero no se puede interpretar (vacío, cortado, JSON sin
 * los campos del dueño, o ilegible). Eso NO es "libre": puede ser un dueño vivo a
 * mitad de publicar (DR-53) — quien llama decide, y nunca lo trata como permiso. */
export function leerCandado(rutaLock: string): ContenidoCandado | null {
  try {
    const contenido: unknown = JSON.parse(readFileSync(rutaLock, "utf8"))
    if (contenido !== null && typeof contenido === "object" && "pid" in contenido && "hostname" in contenido) return contenido as ContenidoCandado
    return null
  } catch {
    return null
  }
}

// Errores de `link()` que significan "este filesystem no tiene hard links" (FAT/exFAT,
// algunos montajes de red) — ahí, y SÓLO ahí, se cae al camino `"wx"`.
const SIN_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"])

/** Escribe el contenido COMPLETO en un temporal único del mismo directorio y recién
 * después lo hace visible bajo `rutaLock`. Nadie puede ver jamás el candado vacío o
 * a medias (DR-53).
 *   - "crear": `link(temporal, rutaLock)` — crea SÓLO si no existe (`EEXIST` si no),
 *     igual que `"wx"`, pero ya con el contenido adentro. Ese `link` es el punto en el
 *     que el candado pasa a tener dueño: el sistema operativo garantiza un solo
 *     ganador. Sin hard links se usa `"wx"` + escritura: el archivo puede quedar
 *     vacío un instante, y por eso `tomarCandado` nunca pisa un candado ilegible.
 *   - "reemplazar" (recuperar un candado de un dueño muerto): `rename(temporal,
 *     rutaLock)` — reemplazo atómico, nunca hay una ventana con el archivo vacío. */
export function publicarCandado(rutaLock: string, contenido: ContenidoCandado, modo: "crear" | "reemplazar"): void {
  const temporal = `${rutaLock}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  writeFileSync(temporal, JSON.stringify(contenido), { flag: "wx" })
  try {
    if (modo === "reemplazar") {
      renameSync(temporal, rutaLock)
      return
    }
    try {
      linkSync(temporal, rutaLock)
    } catch (error) {
      if (!SIN_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? "")) throw error
      const fd = openSync(rutaLock, "wx")
      try {
        writeSync(fd, JSON.stringify(contenido))
      } finally {
        closeSync(fd)
      }
    }
  } finally {
    try {
      unlinkSync(temporal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error // ENOENT: el rename ya lo movió
    }
  }
}

/** Nunca borra a ciegas: lee el candado ANTES de borrar y sólo lo hace si el
 * contenido sigue siendo EXACTAMENTE el que este proceso escribió — así una
 * liberación tardía (o la salida del proceso) nunca pisa el candado de OTRO proceso
 * que ya lo haya recuperado (ej. si este proceso murió, otro lo recuperó, y recién
 * ahí corre esta limpieza). */
export function liberarCandadoSiPropio(rutaLock: string, contenidoPropio: ContenidoCandado): void {
  const actual = leerCandado(rutaLock)
  if (actual && actual.pid === contenidoPropio.pid && actual.hostname === contenidoPropio.hostname && actual.creado === contenidoPropio.creado) {
    try {
      unlinkSync(rutaLock)
    } catch {
      // ya no estaba (alguien más lo borró primero) — no es un error real acá.
    }
  }
}

/**
 * Por qué NO se tomó el candado. Cada motivo es un rechazo: ninguno da permiso.
 *   - "ilegible": existe pero no se puede interpretar. Puede ser otro proceso a mitad de
 *     publicarlo (DR-53). El archivo queda intacto.
 *   - "ocupado": lo tiene un proceso VIVO de esta misma máquina (`existente.pid`).
 *   - "recuperando": el dueño murió, pero otro proceso ya tiene el reclamo
 *     `rutaReclamo` para recuperarlo (DR-54).
 *   - "cambio": el dueño murió y este proceso ganó el reclamo, pero el candado ya no
 *     era el que había inspeccionado: otro lo tomó primero.
 */
export type CandadoNegado =
  | { readonly ok: false; readonly motivo: "ilegible"; readonly rutaLock: string }
  | { readonly ok: false; readonly motivo: "ocupado"; readonly rutaLock: string; readonly existente: ContenidoCandado }
  | { readonly ok: false; readonly motivo: "recuperando"; readonly rutaLock: string; readonly rutaReclamo: string }
  | { readonly ok: false; readonly motivo: "cambio"; readonly rutaLock: string }

export type ResultadoCandado = { readonly ok: true; readonly rutaLock: string; readonly contenido: ContenidoCandado } | CandadoNegado

export interface OpcionesCandado {
  /**
   * Criterio EXTRA de legibilidad, sólo para endurecer: si devuelve `false` sobre un
   * candado existente, se lo trata como "ilegible" (se rechaza, no se toca). Sin esta
   * opción el comportamiento es el histórico de `servicio-con-vista.ts`: alcanza con
   * que el JSON traiga `pid` y `hostname`, sin mirar de qué tipo son.
   */
  readonly esLegible?: (existente: ContenidoCandado) => boolean
}

/**
 * Toma el candado `rutaLock` para ESTE proceso, o dice por qué no.
 *
 * Los rechazos previstos vuelven como valor (`ok: false`), para que cada dueño de
 * negocio los cuente con sus palabras. Un error de E/S que no sea "ya existe" (el
 * directorio no está, no hay permiso, disco lleno) se LANZA tal cual, como siempre:
 * quien llama decide si eso es un error o un rechazo. Nunca se interpreta como "libre".
 */
export function tomarCandado(rutaLock: string, opciones: OpcionesCandado = {}): ResultadoCandado {
  const contenido: ContenidoCandado = { pid: process.pid, hostname: hostname(), creado: new Date().toISOString() }
  try {
    publicarCandado(rutaLock, contenido, "crear")
    return { ok: true, rutaLock, contenido }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existente = leerCandado(rutaLock)
    if (!existente || (opciones.esLegible && !opciones.esLegible(existente))) {
      // DR-53: existe pero no se puede leer. NO prueba que esté libre: puede ser otro
      // proceso a mitad de publicarlo. Pisarlo era exactamente el doble dueño. Se
      // rechaza y el archivo queda intacto.
      return { ok: false, motivo: "ilegible", rutaLock }
    }
    if (existente.hostname === contenido.hostname && estaVivo(existente.pid)) {
      return { ok: false, motivo: "ocupado", rutaLock, existente }
    }
    // Dueño anterior muerto — se recupera. DR-54: el `rename` de "reemplazar" es atómico
    // pero NO condicional; si dos procesos leían el mismo candado vencido, el segundo
    // pisaba al primero, que ya era dueño vivo. Por eso sólo recupera quien gana el
    // RECLAMO `<candado>.recuperando` (creación exclusiva, como el candado), y con el
    // reclamo en mano reemplaza únicamente si el candado sigue siendo EXACTAMENTE el
    // vencido que inspeccionó. Nadie más reemplaza mientras exista el reclamo.
    const rutaReclamo = `${rutaLock}.recuperando`
    try {
      publicarCandado(rutaReclamo, contenido, "crear")
    } catch (errorReclamo) {
      if ((errorReclamo as NodeJS.ErrnoException).code !== "EEXIST") throw errorReclamo
      return { ok: false, motivo: "recuperando", rutaLock, rutaReclamo }
    }
    try {
      const actual = leerCandado(rutaLock)
      if (!actual || actual.pid !== existente.pid || actual.hostname !== existente.hostname || actual.creado !== existente.creado) {
        return { ok: false, motivo: "cambio", rutaLock }
      }
      publicarCandado(rutaLock, contenido, "reemplazar")
    } finally {
      liberarCandadoSiPropio(rutaReclamo, contenido)
    }
    return { ok: true, rutaLock, contenido }
  }
}
