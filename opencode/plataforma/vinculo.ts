// Vínculo — cómo el bot queda unido a la cuenta del docente en la plataforma.
//
// EL RECORRIDO. El docente no escribe su contraseña en el bot, nunca: lo que se
// escribe en el chat viaja al modelo. En cambio:
//
//   1. El bot arma un intento: un secreto (`verifier`), su huella (`challenge`),
//      una marca (`state`) y un código de seis dígitos (`codigo`).
//   2. Abre el navegador en la plataforma con la huella, la marca y el puerto
//      donde va a escuchar. Nada de eso sirve por sí solo para entrar. El código
//      de seis dígitos NO va en el enlace: se le muestra al docente en el chat.
//   3. El docente entra como siempre (contraseña o Google), ve con qué cuenta va
//      a vincular, ESCRIBE el código que le mostró el bot y confirma.
//   4. La plataforma manda al navegador de vuelta a esta compu con un código de
//      canje (`code`, que no es el de seis dígitos).
//   5. El bot canjea ese `code` presentando el secreto y el código de seis
//      dígitos. Recibe un token que sólo sirve para la API del bot.
//
// Quien intercepte el `code` no puede canjearlo sin el secreto, y la vuelta va a
// la compu de quien confirmó: mandarle el enlace a otro docente no sirve.
//
// PARA QUÉ ESTÁ EL CÓDIGO DE SEIS DÍGITOS. El secreto y la marca los pone quien
// arma el enlace. Otro programa corriendo en la misma compu (la del aula la usan
// muchos) puede armar SU enlace, con SU secreto y SU puerto, y esperar a que un
// docente con la sesión abierta apriete «Sí, vincular»: quedaría vinculado el
// programa ajeno, no el bot. Lo encontró la revisión independiente de la
// plataforma del 2026-11-19, antes de publicar nada. Con el código, la página
// pide algo que sólo sabe quien está mirando ESTE chat: el programa ajeno no
// sabe qué escribió el docente, y la plataforma le rechaza el canje. Por eso el
// código no viaja en el enlace ni la página lo muestra: si lo hiciera, lo
// tendría también quien armó el enlace.
//
// QUÉ NO HACE ESTE ARCHIVO. No levanta el servidor local que recibe la vuelta,
// no abre el navegador y no guarda el token en disco. Acá están las piezas que
// se pueden probar sin red ni disco; lo demás las usa.
//
// LO QUE ESTE ARCHIVO TODAVÍA NO PROBÓ: el recorrido entero contra la
// plataforma, que del otro lado todavía no existe. Los tests ejercitan estas
// piezas sueltas contra un `fetch` falso.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { esObjeto, fallaComun, pedir, pedirSinSesion } from "./api.ts"
import type { DependenciasApi, DependenciasConSesion, Falla } from "./api.ts"

export const RUTA_CALLBACK = "/callback"
export const MAX_ETIQUETA = 80
const PUERTO_MINIMO = 1024
const PUERTO_MAXIMO = 65535

export interface Intento {
  /** El secreto. No sale de esta compu hasta el canje, y sólo va a la API. */
  verifier: string
  /** SHA-256 del secreto. Es lo que viaja en la URL del navegador. */
  challenge: string
  /** Marca para reconocer que la vuelta es la de ESTE intento. */
  state: string
  /**
   * Seis dígitos que el docente lee en el chat y escribe en la página. No va en
   * la URL: sólo sale de acá por la pantalla y, en el canje, hacia la API.
   */
  codigo: string
}

export interface Cuenta {
  nombre: string
  email: string
}

export type ResultadoCallback =
  | { estado: "ok"; code: string }
  | { estado: "ruta-desconocida" }
  | { estado: "state-distinto" }
  | { estado: "sin-codigo" }

export type ResultadoCanje = { estado: "vinculado"; token: string; cuenta: Cuenta } | { estado: "codigo-invalido" } | Falla
export type ResultadoSesion = { estado: "ok"; cuenta: Cuenta } | Falla
export type ResultadoCierre = { estado: "cerrada" } | Falla

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

/** La huella del secreto, como la define S256 de RFC 7636. */
export function challengeDe(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url")
}

export const LARGO_CODIGO = 6
const CODIGOS_POSIBLES = 10 ** LARGO_CODIGO
/** Primer número de 32 bits que ya no entra en una cantidad entera de vueltas de códigos. */
const TOPE_PAREJO = Math.floor(2 ** 32 / CODIGOS_POSIBLES) * CODIGOS_POSIBLES

/**
 * Seis dígitos, todos los códigos con la misma probabilidad.
 *
 * Tomar cuatro bytes y quedarse con el resto de dividir por un millón haría un
 * poco más probables los códigos bajos (2^32 no es múltiplo de un millón). Los
 * números que caen en ese sobrante se descartan y se pide azar de nuevo.
 */
function codigoAlAzar(azar: (n: number) => Uint8Array): string {
  for (;;) {
    const n = Buffer.from(azar(4)).readUInt32BE(0)
    if (n < TOPE_PAREJO) return String(n % CODIGOS_POSIBLES).padStart(LARGO_CODIGO, "0")
  }
}

/** El código como se le muestra al docente: «482 715». La página acepta el espacio. */
export function codigoParaMostrar(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`
}

/** Arma un intento nuevo. El azar se inyecta sólo para poder probarlo. */
export function crearIntento(azar: (n: number) => Uint8Array = randomBytes): Intento {
  const verifier = base64url(azar(32))
  return { verifier, challenge: challengeDe(verifier), state: base64url(azar(16)), codigo: codigoAlAzar(azar) }
}

/**
 * La URL que se abre en el navegador. `null` si el puerto no es uno válido.
 *
 * El código de seis dígitos no se agrega acá, y no es un olvido: ver el encabezado.
 */
export function urlDeVinculo(basePlataforma: string, intento: Intento, puerto: number): string | null {
  if (!Number.isInteger(puerto) || puerto < PUERTO_MINIMO || puerto > PUERTO_MAXIMO) return null
  const url = new URL("/vincular-bot", basePlataforma)
  url.searchParams.set("challenge", intento.challenge)
  url.searchParams.set("port", String(puerto))
  url.searchParams.set("state", intento.state)
  return url.toString()
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Lee el pedido que llega al servidor local cuando el navegador vuelve.
 *
 * A ese puerto le puede escribir cualquier página que el docente tenga abierta.
 * Por eso sólo se acepta la ruta exacta y la marca de ESTE intento; con otra
 * marca no se devuelve ningún código, aunque venga uno.
 */
export function leerCallback(rutaConQuery: string, intento: Intento): ResultadoCallback {
  let url: URL
  try {
    url = new URL(rutaConQuery, "http://127.0.0.1")
  } catch {
    return { estado: "ruta-desconocida" }
  }
  if (url.pathname !== RUTA_CALLBACK) return { estado: "ruta-desconocida" }
  if (!igual(url.searchParams.get("state") ?? "", intento.state)) return { estado: "state-distinto" }
  const code = url.searchParams.get("code") ?? ""
  if (!code) return { estado: "sin-codigo" }
  return { estado: "ok", code }
}

function leerCuenta(x: unknown): Cuenta | null {
  if (!esObjeto(x) || typeof x.nombre !== "string" || typeof x.email !== "string" || !x.email) return null
  // Sólo nombre y email, aunque la plataforma mande más: lo que sale de acá puede
  // terminar en el chat.
  return { nombre: x.nombre, email: x.email }
}

/**
 * Canjea el código por el token de la sesión.
 *
 * Un `code` inexistente, usado, vencido, con un secreto que no coincide o con un
 * código de seis dígitos distinto del que escribió el docente da el mismo
 * resultado. Es a propósito, y viene así de la plataforma: no hay que darle
 * pistas a quien prueba códigos. Después de un rechazo el `code` queda quemado:
 * hay que vincular de nuevo.
 */
export async function canjearVinculo(
  deps: DependenciasApi,
  code: string,
  intento: Intento,
  etiqueta: string,
): Promise<ResultadoCanje> {
  const res = await pedirSinSesion(deps, "POST", "/vinculos/canje", {
    code,
    verifier: intento.verifier,
    codigo: intento.codigo,
    etiqueta: etiqueta.slice(0, MAX_ETIQUETA),
  })
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  if (r.status === 400 && r.codigo === "codigo-invalido") return { estado: "codigo-invalido" }
  if (r.status !== 200) return fallaComun(r)
  const json = esObjeto(r.json) ? r.json : {}
  const cuenta = leerCuenta(json.cuenta)
  if (typeof json.token !== "string" || !json.token || !cuenta) return fallaComun(r)
  return { estado: "vinculado", token: json.token, cuenta }
}

/** Pregunta a la plataforma de quién es la sesión. Sirve para decir «sesión de Fulano» sin suponerlo. */
export async function leerSesion(deps: DependenciasConSesion): Promise<ResultadoSesion> {
  const res = await pedir(deps, "GET", "/sesion")
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  const cuenta = r.status === 200 && esObjeto(r.json) ? leerCuenta(r.json.cuenta) : null
  return cuenta ? { estado: "ok", cuenta } : fallaComun(r)
}

/**
 * Cierra ESTA sesión en la plataforma.
 *
 * Sólo dice `cerrada` si la plataforma lo confirmó. Si no hubo conexión, el
 * token sigue vivo del otro lado aunque se borre de esta compu, y eso hay que
 * poder decírselo al docente.
 */
export async function cerrarSesion(deps: DependenciasConSesion): Promise<ResultadoCierre> {
  const res = await pedir(deps, "DELETE", "/sesion")
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  if (r.status === 200 && esObjeto(r.json) && r.json.cerrada === true) return { estado: "cerrada" }
  return fallaComun(r)
}
