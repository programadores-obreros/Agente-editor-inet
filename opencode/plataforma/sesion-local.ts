// Sesión local — dónde queda guardado, en esta compu, el vínculo con la plataforma.
//
// Guarda tres cosas en `~/.config/opencode/tecnia-sesion.json`: el token que dio
// la plataforma, de qué cuenta es (nombre y email) y contra qué URL se obtuvo.
//
// POR QUÉ UN ARCHIVO APARTE. La memoria de la compu (`tecnia-memoria.md`) y el
// perfil (`tecnia-perfil.md`) se cargan en el contexto de cada sesión vía
// `instructions` de `opencode.json`: lo que hay ahí lo lee el modelo. El token
// no puede ir a ninguno de los dos. Este archivo no se carga en ningún contexto.
//
// TRES REGLAS DE ESTE ARCHIVO:
//
// 1. EL TOKEN NO SE IMPRIME NUNCA. Ningún resultado de acá lo trae en un mensaje.
//    Sale sólo por `token` en la lectura, para quien lo necesita para un pedido.
//
// 2. BORRAR ES COMPROBAR QUE YA NO ESTÁ. `borrarSesionGuardada` vuelve a mirar el
//    disco después de borrar y sólo entonces dice que no hay sesión. Es la misma
//    regla de `uninstall.ps1`: se afirma lo que se comprobó.
//
// 3. UN ARCHIVO QUE NO SE ENTIENDE NO ES «NO HAY SESIÓN». Si está pero no se puede
//    leer o no tiene la forma esperada, se dice `ilegible`. Tratarlo como ausente
//    dejaría un token vivo en disco con el bot diciendo que no hay nada.
//
// LÍMITES CONOCIDOS, no bugs:
// - El permiso 0600 protege en Linux y macOS. En Windows `chmod` no restringe la
//   lectura: el archivo queda protegido sólo por el perfil del usuario, igual que
//   `auth.json` con la key de Google.
// - El token va en texto plano. No se usa el llavero del sistema: sumaría una
//   dependencia nativa por plataforma, y el token se puede revocar desde la web.
// - Los dos desinstaladores (`install/uninstall.sh` y `install/uninstall.ps1`) ofrecen
//   borrar este archivo y avisan que en la plataforma la sesión sigue abierta: no
//   hablan con la red, así que no la pueden cerrar del otro lado.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface SesionGuardada {
  token: string
  cuenta: { nombre: string; email: string }
  /** URL base de la API contra la que se vinculó. Un token no sirve contra otra. */
  base: string
}

export type ResultadoLeerSesion =
  | { estado: "ok"; sesion: SesionGuardada }
  | { estado: "sin-sesion" }
  | { estado: "ilegible"; ruta: string }

export type ResultadoGuardarSesion = { estado: "guardada"; ruta: string } | { estado: "no-pude-guardar"; ruta: string }
export type ResultadoBorrarSesion = { estado: "sin-sesion" } | { estado: "no-pude-borrar"; ruta: string }

const ARCHIVO = "tecnia-sesion.json"

/** Carpeta de configuración de OpenCode, la misma que usan `memoria.ts` y `perfil.ts`. */
export function carpetaPorDefecto(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode")
}

export function rutaSesion(carpeta: string = carpetaPorDefecto()): string {
  return join(carpeta, ARCHIVO)
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

function comoSesion(x: unknown): SesionGuardada | null {
  if (!esObjeto(x) || typeof x.token !== "string" || !x.token) return null
  if (typeof x.base !== "string" || !x.base) return null
  if (!esObjeto(x.cuenta) || typeof x.cuenta.nombre !== "string" || typeof x.cuenta.email !== "string" || !x.cuenta.email) return null
  return { token: x.token, cuenta: { nombre: x.cuenta.nombre, email: x.cuenta.email }, base: x.base }
}

/** Lee la sesión guardada en esta compu. */
export function leerSesionGuardada(carpeta: string = carpetaPorDefecto()): ResultadoLeerSesion {
  const ruta = rutaSesion(carpeta)
  if (!existsSync(ruta)) return { estado: "sin-sesion" }
  let sesion: SesionGuardada | null = null
  try {
    sesion = comoSesion(JSON.parse(readFileSync(ruta, "utf8")))
  } catch {
    // No se pudo leer o no es JSON: cae en `ilegible`, igual que una forma rara.
  }
  return sesion ? { estado: "ok", sesion } : { estado: "ilegible", ruta }
}

/**
 * Guarda la sesión, de forma atómica y legible sólo por el usuario.
 *
 * El temporal nace ya con permiso 0600 y va al lado del destino: así el token
 * nunca está en disco con permisos abiertos, ni siquiera un instante, y el
 * `rename` no cruza sistemas de archivos (ver `escribirArchivoAtomico` en
 * `memoria.ts`, que explica el porqué del temporal vecino).
 */
export function guardarSesionLocal(sesion: SesionGuardada, carpeta: string = carpetaPorDefecto()): ResultadoGuardarSesion {
  const ruta = rutaSesion(carpeta)
  const temp = `${ruta}.${process.pid}.tmp`
  const limpia = comoSesion(sesion)
  if (!limpia) return { estado: "no-pude-guardar", ruta }
  try {
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(temp, `${JSON.stringify(limpia, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    // `mode` sólo vale al crear: si quedó un temporal viejo con otro permiso, se corrige.
    chmodSync(temp, 0o600)
    renameSync(temp, ruta)
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // El temporal no llegó a crearse o ya no está.
    }
    return { estado: "no-pude-guardar", ruta }
  }
  // Acá NO se relee el archivo, a propósito. Hubo una relectura y se sacó: con
  // `node:fs` síncrono cualquier falla ya tiró y cayó en el `catch`, así que la
  // relectura no podía fallar nunca, y ningún test la podía poner roja. Un guard
  // que no puede fallar da falsa tranquilidad; borrar sí relee, porque ahí la
  // falla se traga a propósito.
  return { estado: "guardada", ruta }
}

/**
 * Borra la sesión de esta compu.
 *
 * Esto NO cierra la sesión en la plataforma: para eso está `cerrarSesion` en
 * `vinculo.ts`. Quien llama decide qué decirle al docente si una salió bien y la
 * otra no.
 */
export function borrarSesionGuardada(carpeta: string = carpetaPorDefecto()): ResultadoBorrarSesion {
  const ruta = rutaSesion(carpeta)
  try {
    unlinkSync(ruta)
  } catch {
    // Puede que no existiera, o que no se pudiera borrar: lo decide la relectura.
  }
  return existsSync(ruta) ? { estado: "no-pude-borrar", ruta } : { estado: "sin-sesion" }
}
