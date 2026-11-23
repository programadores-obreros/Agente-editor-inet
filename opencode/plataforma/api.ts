// API del bot en la plataforma Tecnia Lab — el transporte, y nada más.
//
// El bot NUNCA tiene una sesión de Firebase. Lo que tiene es un token opaco que
// la plataforma le dio al vincularse, y que sirve para una sola cosa: hablar con
// esta API. No abre el perfil del docente, ni su DNI, ni sus inscripciones. Esa
// es la razón de que exista esta API en vez de hablarle directo a Firestore:
// con una sesión de Firebase el bot llegaba a todo lo que llega la web.
//
// Este archivo arma el pedido, pone el token y le da nombre a las fallas que son
// iguales para todas las rutas. Lo que significa cada respuesta lo decide quien
// llama (`memoria-remota.ts`, `vinculo.ts`).
//
// DOS REGLAS DE ESTE ARCHIVO:
//
// 1. EL TOKEN NO SE IMPRIME NUNCA. Ni en un detalle de error, ni en un mensaje.
//    Lo que devuelven estas funciones termina en el chat, que el docente copia y
//    pega cuando pide ayuda. Es la misma regla que tiene `clave.ts` con la key.
//
// 2. EL TEXTO LIBRE DEL SERVIDOR TAMPOCO. De una respuesta de error se usa el
//    código (`error`), que es un vocabulario cerrado, y el número HTTP. Un cuerpo
//    que no es el de la plataforma —el portal cautivo de la escuela, un proxy—
//    no se copia a ningún lado.

/** El mínimo de `fetch` que se usa acá, para poder inyectar uno falso. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>

export interface DependenciasApi {
  fetch: FetchLike
  /** URL base de la API del bot, sin barra final. */
  base: string
  /** Tope de espera por pedido, en milisegundos. */
  esperaMs?: number
}

export interface DependenciasConSesion extends DependenciasApi {
  /** Devuelve el token de la sesión vinculada. Dónde se guarda es asunto de quien lo inyecta. */
  token: () => Promise<string>
}

/** Fallas que pueden salir de cualquier ruta. */
export type Falla =
  | { estado: "sin-conexion"; detalle: string }
  | { estado: "sesion-invalida" }
  | { estado: "demasiados-pedidos" }
  | { estado: "respuesta-invalida"; detalle: string }
  | { estado: "error"; http: number; detalle: string }

export interface RespuestaHttp {
  status: number
  /** El cuerpo parseado, o `undefined` si no era JSON. */
  json: unknown
  /** El campo `error` del cuerpo si es un string; si no, vacío. */
  codigo: string
}

export type Respuesta = { tipo: "http"; respuesta: RespuestaHttp } | { tipo: "falla"; falla: Falla }

const ESPERA_MS = 10_000

export function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

async function enviar(
  deps: DependenciasApi,
  metodo: string,
  ruta: string,
  headers: Record<string, string>,
  cuerpo: unknown,
): Promise<Respuesta> {
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json"
  let status: number
  let texto: string
  try {
    const res = await deps.fetch(`${deps.base}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(deps.esperaMs ?? ESPERA_MS),
    })
    status = res.status
    texto = await res.text()
  } catch (e) {
    // El error crudo no se propaga: puede traer la URL o el token adentro.
    const nombre = e instanceof Error ? e.name : ""
    const detalle = nombre === "TimeoutError" || nombre === "AbortError" ? "la plataforma no respondió a tiempo" : "no se pudo conectar"
    return { tipo: "falla", falla: { estado: "sin-conexion", detalle } }
  }
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    json = undefined
  }
  const codigo = esObjeto(json) && typeof json.error === "string" ? json.error : ""
  return { tipo: "http", respuesta: { status, json, codigo } }
}

/** Pedido sin token. Sólo lo usa el canje del vínculo, que es cuando todavía no hay sesión. */
export function pedirSinSesion(deps: DependenciasApi, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  return enviar(deps, metodo, ruta, {}, cuerpo)
}

/** Pedido con el token de la sesión. Sin token no sale nada. */
export async function pedir(deps: DependenciasConSesion, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  let token: string
  try {
    token = await deps.token()
  } catch {
    return { tipo: "falla", falla: { estado: "sesion-invalida" } }
  }
  if (!token) return { tipo: "falla", falla: { estado: "sesion-invalida" } }
  return enviar(deps, metodo, ruta, { Authorization: `Bearer ${token}` }, cuerpo)
}

/**
 * Le pone nombre a una respuesta que la ruta no reconoció como propia.
 *
 * Un 200 que llega hasta acá es un 200 con un cuerpo que no es el del contrato:
 * eso es `respuesta-invalida`, nunca un éxito.
 */
export function fallaComun(r: RespuestaHttp): Falla {
  if (r.status === 401) return { estado: "sesion-invalida" }
  if (r.status === 429) return { estado: "demasiados-pedidos" }
  if (r.status >= 200 && r.status < 300) {
    return { estado: "respuesta-invalida", detalle: "la plataforma respondió bien pero con un cuerpo que no es el esperado" }
  }
  return { estado: "error", http: r.status, detalle: r.codigo || `HTTP ${r.status}` }
}
