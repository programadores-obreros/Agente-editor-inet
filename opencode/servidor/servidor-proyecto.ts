// Servidor HTTP + SSE del proyecto — Phase 2, Slice 1 (writer W3, tarea 2).
// PHASE_2_SLICE_1_DESIGN.md §2.3/§2.4, informe ARCH-B. Precedente PROBADO en este
// mismo repo: opencode/skills/archify/bin/preview.mjs (loopback + Host-header check +
// SSE + node:http puro, sin dependencias).
//
// Este módulo es un ADAPTADOR de transporte — nunca una segunda autoridad. Recibe un
// `ServicioDeProyecto` YA CONSTRUIDO (por `servicio-con-vista.ts`, el único call site
// de producción autorizado) y sólo traduce HTTP/SSE ↔ esa superficie angosta
// (`snapshot()`/`aplicar()`/`suscribir()`). Por eso importa el TIPO `ServicioDeProyecto`
// (se borra en runtime, TypeScript es sintaxis borrable) pero NUNCA
// `obtenerServicioDeProyecto` ni `composicion-raiz.ts` como valor — quien arma el
// servicio es responsabilidad de quien llama `iniciarServidor` (el test de
// integración, y después la tool de OpenCode, W4).
//
// `node:http` — funciona igual en Node (tests) y en Bun (proceso real de OpenCode),
// sin dependencias nuevas (`package.json` no gana ninguna). Vive FUERA de
// `opencode/nucleo/**`, así que la guardia 29b (`tests/nucleo-adversarial.test.mjs`,
// "node: SOLO en almacen.ts/hash-catalogo.node.ts") no aplica acá — esa guardia
// escanea únicamente `opencode/nucleo/**`.

import http from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ServicioDeProyecto } from "../nucleo/composicion-raiz.ts"

const AQUI = dirname(fileURLToPath(import.meta.url))
const DIR_VISTA_FISICA_WEB = join(AQUI, "..", "vista-fisica", "web")
const DIR_TECNIABOT_WEB = join(AQUI, "..", "tecniabot-web")

/**
 * Límite del cuerpo de `POST /api/operaciones` — un `SobreOperacion` real (Phase 1,
 * `nucleo/operaciones.ts`) es un objeto chico (unos pocos strings/números); 256 KiB
 * es generoso incluso para un payload con muchos campos y deja margen sin abrir la
 * puerta a que un cliente (o un bug del propio navegador) tire megabytes al servidor
 * loopback. Un cuerpo que excede esto se rechaza como error de TRANSPORTE (400) antes
 * de intentar `JSON.parse` — nunca se acumula sin límite en memoria.
 */
const LIMITE_BYTES_OPERACION = 256 * 1024

/**
 * Lista blanca de `/assets/<nombre>` — decisión de seguridad (briefing tarea 2): el
 * nombre pedido nunca se usa para construir una ruta de archivo (nunca
 * `join(dir, nombre)` con el valor crudo de la URL). En cambio, es la CLAVE de un
 * `Map` fijo, calculado una sola vez acá — un `nombre` como `"../../package.json"` o
 * `"..%2f..%2fpackage.json"` simplemente no matchea ninguna clave del mapa y da 404,
 * sin que el valor del atacante toque nunca el sistema de archivos. Cierra por
 * construcción cualquier path traversal, no por sanitización de la entrada.
 *
 * `wokwi-bundle.js`/`componentes-extra.js` (opencode/tecniabot-web/, el mismo bundle
 * que ya usa `circuito.ts` para el HTML estático) + los JS planos de la vista
 * física (opencode/vista-fisica/web/, PHASE_2_SLICE_1_DESIGN.md §2.6 —
 * `estado-conexion.js` se sumó en la revisión post red-team, Hallazgo B2). Slice 1
 * (ESP32+LED) no necesita `componentes-extra.js` en `index.html` (el LED sale del
 * bundle Wokwi central) — igual queda en la lista blanca, servible bajo demanda, sin
 * forzar a index.html a cargarlo si no hace falta (documentado en
 * PHASE_2_SLICE_1_PROTOCOL.md).
 */
function construirRutasDeAssets(): ReadonlyMap<string, string> {
  return new Map([
    ["wokwi-bundle.js", join(DIR_TECNIABOT_WEB, "wokwi-bundle.js")],
    ["componentes-extra.js", join(DIR_TECNIABOT_WEB, "componentes-extra.js")],
    // Phase 3 (vertical #2, contrato §11): Blockly 13.3.0 vendorizado (núcleo + mensajes es), sin medios.
    ["blockly_compressed.js", join(DIR_TECNIABOT_WEB, "blockly_compressed.js")],
    ["blockly-es.js", join(DIR_TECNIABOT_WEB, "blockly-es.js")],
    ["app.js", join(DIR_VISTA_FISICA_WEB, "app.js")],
    ["pintar.js", join(DIR_VISTA_FISICA_WEB, "pintar.js")],
    ["plan-de-pintado.js", join(DIR_VISTA_FISICA_WEB, "plan-de-pintado.js")],
    // Revisión post red-team (Hallazgo B2): `app.js` importa este módulo
    // (`import ... from "./estado-conexion.js"`) — sin agregarlo acá, el navegador
    // pediría `/assets/estado-conexion.js` y caería en el 404 genérico, rompiendo el
    // ES module de `app.js` entero (import no resuelto).
    ["estado-conexion.js", join(DIR_VISTA_FISICA_WEB, "estado-conexion.js")],
    // Phase 3 (vertical #2): módulos que importa `app.js` (cliente HTTP compartido y vista lógica).
    ["cliente-http.js", join(DIR_VISTA_FISICA_WEB, "cliente-http.js")],
    ["vista-logica.js", join(DIR_VISTA_FISICA_WEB, "vista-logica.js")],
    ["adaptador-blockly.js", join(DIR_VISTA_FISICA_WEB, "adaptador-blockly.js")],
    ["vista-logica-ui.js", join(DIR_VISTA_FISICA_WEB, "vista-logica-ui.js")],
  ])
}

/**
 * CSP restrictiva, mismo criterio que `preview.mjs:276` (default-src acotado, nunca
 * `unsafe-eval`): `script-src 'self'` — `app.js`/`pintar.js`/`plan-de-pintado.js` son
 * ES modules externos (`<script type="module" src="/assets/app.js">`), nunca inline,
 * así que ni siquiera hace falta `'unsafe-inline'` para script. `style-src
 * 'unsafe-inline'` sólo porque `index.html` trae un `<style>` embebido chico (sin
 * build step, JS/CSS planos) — nunca ejecuta código, no es el riesgo que la CSP
 * existe para frenar. Sin `frame-src`/`object-src` (`'none'` por herencia de
 * `default-src`): esta página nunca embebe nada.
 */
function cabecerasComunes(tipoContenido: string): Record<string, string> {
  return {
    "Content-Type": tipoContenido,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'",
  }
}

function responderBuffer(res: http.ServerResponse, estado: number, tipoContenido: string, cuerpo: Buffer, soloCabeceras: boolean): void {
  res.writeHead(estado, { ...cabecerasComunes(tipoContenido), "Content-Length": cuerpo.byteLength })
  if (soloCabeceras) res.end()
  else res.end(cuerpo)
}

function responderTexto(res: http.ServerResponse, estado: number, texto: string): void {
  responderBuffer(res, estado, "text/plain; charset=utf-8", Buffer.from(texto), false)
}

function responderJson(res: http.ServerResponse, estado: number, valor: unknown): void {
  responderBuffer(res, estado, "application/json; charset=utf-8", Buffer.from(JSON.stringify(valor)), false)
}

function responderMetodoNoPermitido(res: http.ServerResponse, permitidos: readonly string[]): void {
  res.writeHead(405, { ...cabecerasComunes("text/plain; charset=utf-8"), Allow: permitidos.join(", ") })
  res.end("Metodo no permitido")
}

/**
 * `sobre.actor` — decisión registrada (briefing tarea 2, "fuerza actor: 'navegador' o
 * lo valida; decidí y documentá"): este transporte es EXCLUSIVAMENTE el canal del
 * navegador (la tool de OpenCode, W4, es un actor "agente" y no pasa por acá) — se
 * FUERZA `actor: "navegador"` siempre, pisando lo que haya mandado el cliente, en vez
 * de sólo validarlo y rechazar si viene mal. Motivo: `actor` es metadata descriptiva
 * consumida por `operaciones.ts::analizarSobreOperacion` sólo para verificar que sea
 * uno de los dos valores válidos (`nucleo/operaciones.ts:196-197`) — no cambia ninguna
 * regla de negocio según su valor. Confiar en que el navegador siempre lo mande bien
 * sería un requisito extra sin beneficio (un bug del propio `app.js`, o un DevTools a
 * mano, mandaría `"agente"` y provocaría un rechazo de transporte por un campo que el
 * servidor YA SABE cuál tiene que ser, dado que llegó por ESTE endpoint). Si el valor
 * recibido no es siquiera un objeto plano (string/array/null/número), no hay nada que
 * pisar — se deja pasar tal cual a `servicio.aplicar`, que lo rechaza con
 * `SOBRE_OPERACION_INVALIDO` (motor.ts, `esObjetoPlano`) de forma estructurada, sin
 * excepción — mismo criterio "no envolver una segunda vez lo que el núcleo ya
 * distingue" que el resto del núcleo aplica.
 */
function forzarActorNavegador(valor: unknown): unknown {
  if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
    return { ...(valor as Record<string, unknown>), actor: "navegador" }
  }
  return valor
}

/**
 * Phase 3 (contrato B7): las ÚNICAS operaciones que el navegador puede pedir. El resto
 * (armar el circuito, `CambiarComponente`, ...) es del agente / de otros canales: un
 * `tipo` fuera de esta lista es un error de INTEGRACIÓN, no de dominio — se rechaza
 * acá con `OPERACION_NO_PERMITIDA_EN_NAVEGADOR` sin invocar al Engine.
 */
const OPERACIONES_PERMITIDAS_EN_NAVEGADOR: readonly string[] = ["AsignarPin", "SetComportamiento", "QuitarComportamiento"]

function leerCuerpo(req: http.IncomingMessage, limiteBytes: number): Promise<{ ok: true; texto: string } | { ok: false; motivo: "demasiado_grande" | "error_de_lectura" }> {
  return new Promise((resolve) => {
    let bytesRecibidos = 0
    let terminado = false
    const trozos: Buffer[] = []
    req.on("data", (trozo: Buffer) => {
      // Ya se decidió "demasiado grande" (o la promesa ya resolvió por otra vía) —
      // se siguen DESCARTANDO los trozos que lleguen (nunca se acumulan), pero SIN
      // destruir el socket acá: `req.destroy()` en medio de la lectura tira abajo la
      // conexión ANTES de que el handler llegue a escribir la respuesta 400, y el
      // cliente ve un "socket hang up" (ECONNRESET) en vez de una respuesta HTTP —
      // dejar que el stream termine solo (el próximo `end`) es lo que permite
      // responder 400 de verdad, con el socket todavía en pie.
      if (terminado) return
      bytesRecibidos += trozo.length
      if (bytesRecibidos > limiteBytes) {
        terminado = true
        resolve({ ok: false, motivo: "demasiado_grande" })
        return
      }
      trozos.push(trozo)
    })
    req.on("end", () => {
      if (terminado) return
      terminado = true
      resolve({ ok: true, texto: Buffer.concat(trozos).toString("utf8") })
    })
    req.on("error", () => {
      if (terminado) return
      terminado = true
      resolve({ ok: false, motivo: "error_de_lectura" })
    })
  })
}

/**
 * Fix de ronda única red-team, Hallazgo H3 (MAJOR, P2-RED-A/INFORME.md, ataque 3,
 * casos 3.9/3.12): el chequeo de `Host` (`manejarRequest`, más abajo) sólo protege
 * contra DNS-rebinding — NUNCA contra una request cross-origin DIRECTA hacia
 * `127.0.0.1:<puerto>`, porque el navegador manda el `Host` real del destino sin
 * importar el origen de la página que dispara el `fetch`. Combinado con que este
 * endpoint no validaba `Content-Type`, cualquier pestaña de OTRO origen podía, si
 * conocía/adivinaba el puerto efímero, mandar un POST "simple" (`Content-Type:
 * text/plain`, sin preflight) y ejecutar CUALQUIER operación — no sólo `AsignarPin`
 * (CSRF clásico de servidor local).
 *
 * Fix: exigir y validar DOS headers, en este orden:
 * 1. `Content-Type: application/json` (con o sin `;charset=...` detrás) — si no,
 *    415. `app.js` ya lo manda así (`fetch(..., {headers:{"Content-Type":
 *    "application/json"}}`); esto NO debilita ningún invariante existente, sólo
 *    exige un header que el cliente legítimo ya mandaba.
 * 2. `Origin` presente e IGUAL al origen propio (`http://127.0.0.1:<puerto>` o
 *    `http://localhost:<puerto>`, coherente con las dos formas de `Host` que ya
 *    acepta este servidor) — si no, 403. Un POST same-origin disparado por
 *    `fetch`/`<form>` desde un navegador real SIEMPRE manda `Origin` (no es un
 *    header que JS pueda omitir o falsificar): la página de este servidor lo manda
 *    sola, sin que `app.js` tenga que hacer nada especial.
 */
function validarOrigenYContentType(req: http.IncomingMessage, res: http.ServerResponse, origenesPermitidos: ReadonlySet<string>): boolean {
  const contentType = req.headers["content-type"]
  if (!contentType || !/^application\/json\b/i.test(contentType)) {
    responderTexto(res, 415, "Content-Type no soportado: se requiere application/json")
    return false
  }
  const origen = req.headers.origin
  if (!origen || !origenesPermitidos.has(origen)) {
    responderTexto(res, 403, "Origin no permitido")
    return false
  }
  return true
}

async function manejarOperaciones(req: http.IncomingMessage, res: http.ServerResponse, servicio: ServicioDeProyecto, origenesPermitidos: ReadonlySet<string>): Promise<void> {
  if (!validarOrigenYContentType(req, res, origenesPermitidos)) return
  const cuerpo = await leerCuerpo(req, LIMITE_BYTES_OPERACION)
  if (!cuerpo.ok) {
    // Error de TRANSPORTE (nunca de dominio) — mismo criterio que JSON inválido: 400,
    // sin tocar el motor. "demasiado_grande"/"error_de_lectura" son ambos "el cuerpo
    // de la request es inválido", categoría única desde el punto de vista HTTP.
    responderTexto(res, 400, "Cuerpo invalido")
    return
  }
  let sobreCrudo: unknown
  try {
    sobreCrudo = JSON.parse(cuerpo.texto)
  } catch {
    responderTexto(res, 400, "JSON invalido")
    return
  }
  const sobre = forzarActorNavegador(sobreCrudo)
  // Phase 3 (contrato B7): lista blanca del NAVEGADOR. Se aplica DESPUÉS de validar
  // Origin/Content-Type, leer el cuerpo y parsear el JSON, y ANTES de tocar el Engine.
  // Un cuerpo que no es un objeto plano no tiene `tipo` que filtrar: sigue al Engine,
  // que lo rechaza de forma estructurada (`SOBRE_OPERACION_INVALIDO`).
  if (sobre !== null && typeof sobre === "object" && !Array.isArray(sobre)) {
    const tipo = (sobre as Record<string, unknown>).tipo
    if (typeof tipo !== "string" || !OPERACIONES_PERMITIDAS_EN_NAVEGADOR.includes(tipo)) {
      const motivo = { codigo: "OPERACION_NO_PERMITIDA_EN_NAVEGADOR", categoria: "operacion", severidad: "blocking", clasificacion: "rechazo", datos: { tipo } }
      responderJson(res, 200, { resultado: { ok: false, rechazadoPor: "transporte", motivos: [motivo] }, snapshot: servicio.snapshot() })
      return
    }
  }
  // `servicio.aplicar` (composicion-raiz.ts → motor.ts) NUNCA lanza para un sobre mal
  // formado — `nucleo/operaciones.ts::analizarSobreOperacion`/
  // `nucleo/motor.ts::ejecutarLote` devuelven un `ResultadoTransaccion` con
  // `ok:false` y `motivos[]` estructurados para cualquier forma (objeto con
  // `baseRevision` vieja, `tipo` desconocido, `payload` con forma incorrecta, o el
  // propio sobre no siendo ni un objeto). Por eso el handler HTTP responde SIEMPRE
  // 200 acá: el Engine PROCESÓ la operación (la aceptó o la rechazó con un motivo),
  // que es distinto de "la request en sí es inválida" (JSON malformado, eso sí es
  // 400, arriba). Ver PHASE_2_SLICE_1_DESIGN.md §2.4 e informe ARCH-B, "Errores de
  // transporte (no de dominio)".
  const resultado = servicio.aplicar(sobre as Parameters<ServicioDeProyecto["aplicar"]>[0])
  responderJson(res, 200, { resultado, snapshot: servicio.snapshot() })
}

interface ClienteSSE {
  readonly res: http.ServerResponse
  readonly desuscribir: () => void
}

function manejarEventos(req: http.IncomingMessage, res: http.ServerResponse, servicio: ServicioDeProyecto, clientesSSE: Set<ClienteSSE>): void {
  res.writeHead(200, { ...cabecerasComunes("text/event-stream; charset=utf-8"), Connection: "keep-alive" })
  // Preámbulo `retry:` — mismo patrón que preview.mjs:306: EventSource ya reintenta
  // solo (protocolo nativo), esto sólo fija cuánto espera antes de reconectar. No es
  // un evento (sin `data:`), un cliente que lo parsee como bloque SSE no debe
  // contarlo como notificación de revisión.
  res.write("retry: 1000\n\n")
  const desuscribir = servicio.suscribir((evento) => {
    res.write(`event: revision\ndata: ${JSON.stringify(evento)}\n\n`)
  })
  const cliente: ClienteSSE = { res, desuscribir }
  clientesSSE.add(cliente)
  req.on("close", () => {
    clientesSSE.delete(cliente)
    desuscribir()
  })
}

export interface OpcionesServidor {
  readonly servicio: ServicioDeProyecto
  /** Default `"127.0.0.1"` — nunca `0.0.0.0` (PHASE_2_SLICE_1_DESIGN.md §2.3, ARCH-B
   * "Seguridad mínima local"). */
  readonly host?: string
  /** Default `0` (puerto efímero, el SO elige uno libre — mismo patrón que
   * preview.mjs:320-324, sin colisión posible entre dos instancias corriendo a la
   * vez). */
  readonly puerto?: number
}

export interface ServidorProyecto {
  readonly url: string
  readonly puerto: number
  /** Cierra el listener HTTP y TODAS las conexiones SSE abiertas (desuscribiéndolas
   * del servicio) — nunca deja un cliente colgado ni un listener fantasma en
   * `servicio.suscribir`. Resuelve cuando el puerto ya está liberado. */
  cerrar(): Promise<void>
}

/**
 * Arranca el servidor HTTP+SSE de un proyecto — PHASE_2_SLICE_1_DESIGN.md §2.3/§2.4.
 * `servicio` ya viene construido (por `servicio-con-vista.ts`) y con la vista física
 * inyectada: este módulo nunca decide eso, sólo lo sirve.
 */
export function iniciarServidor(opciones: OpcionesServidor): Promise<ServidorProyecto> {
  const servicio = opciones.servicio
  const host = opciones.host ?? "127.0.0.1"
  const puertoSolicitado = opciones.puerto ?? 0

  // Los assets se leen UNA vez, al arrancar — son estáticos durante la vida del
  // servidor (mismo criterio que `preview.mjs` cachea la página en `page`), evita
  // releer el bundle Wokwi (~430 KB) en cada request.
  const indiceHtml = readFileSync(join(DIR_VISTA_FISICA_WEB, "index.html"))
  const assets = new Map<string, Buffer>()
  for (const [nombre, ruta] of construirRutasDeAssets()) assets.set(nombre, readFileSync(ruta))

  const clientesSSE = new Set<ClienteSSE>()
  let puerto = 0

  const server = http.createServer((req, res) => {
    void manejarRequest(req, res)
  })

  async function manejarRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Anti DNS-rebinding: el header Host tiene que matchear EXACTO
    // `127.0.0.1:<puerto>` o `localhost:<puerto>` — mismo mecanismo que
    // preview.mjs:251-257, con las dos formas de loopback que un navegador puede
    // mandar (bind explícito a 127.0.0.1, pero algunos flujos resuelven "localhost").
    const hostsPermitidos = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`])
    if (!req.headers.host || !hostsPermitidos.has(req.headers.host)) {
      responderTexto(res, 403, "Host no permitido")
      return
    }

    let url: URL
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    } catch {
      responderTexto(res, 400, "URL invalida")
      return
    }
    const ruta = url.pathname

    if (ruta === "/") {
      if (req.method !== "GET" && req.method !== "HEAD") return responderMetodoNoPermitido(res, ["GET", "HEAD"])
      return responderBuffer(res, 200, "text/html; charset=utf-8", indiceHtml, req.method === "HEAD")
    }

    // Favicon (MINOR anotado por el orquestador en P2-T12): sin este handler, el
    // navegador pide `/favicon.ico` sola (nunca la manda `index.html`) y cae en el
    // 404 genérico — ruido en la consola sin ningún valor. 204 sin cuerpo es la
    // respuesta estándar para "no hay favicon, y está bien así" (RFC 7231 — un 204
    // nunca lleva body; distinto de 404, que un navegador sí loguea como error).
    if (ruta === "/favicon.ico") {
      if (req.method !== "GET" && req.method !== "HEAD") return responderMetodoNoPermitido(res, ["GET", "HEAD"])
      return responderBuffer(res, 204, "text/plain; charset=utf-8", Buffer.alloc(0), true) // soloCabeceras=true -> nunca escribe cuerpo, coherente con 204
    }

    if (ruta.startsWith("/assets/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return responderMetodoNoPermitido(res, ["GET", "HEAD"])
      const nombre = ruta.slice("/assets/".length)
      const asset = assets.get(nombre) // lista blanca — ver construirRutasDeAssets()
      if (!asset) return responderTexto(res, 404, "No encontrado")
      return responderBuffer(res, 200, "text/javascript; charset=utf-8", asset, req.method === "HEAD")
    }

    if (ruta === "/api/proyecto") {
      if (req.method !== "GET" && req.method !== "HEAD") return responderMetodoNoPermitido(res, ["GET", "HEAD"])
      if (req.method === "HEAD") return responderBuffer(res, 200, "application/json; charset=utf-8", Buffer.alloc(0), true)
      return responderJson(res, 200, servicio.snapshot())
    }

    if (ruta === "/api/operaciones") {
      if (req.method !== "POST") return responderMetodoNoPermitido(res, ["POST"])
      // Mismo criterio que `hostsPermitidos` arriba: las dos formas de loopback que
      // un navegador puede mandar como Origin de una página same-origin.
      const origenesPermitidos = new Set([`http://127.0.0.1:${puerto}`, `http://localhost:${puerto}`])
      return manejarOperaciones(req, res, servicio, origenesPermitidos)
    }

    if (ruta === "/api/eventos") {
      if (req.method !== "GET") return responderMetodoNoPermitido(res, ["GET"])
      return manejarEventos(req, res, servicio, clientesSSE)
    }

    responderTexto(res, 404, "No encontrado")
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(puertoSolicitado, host, () => {
      server.off("error", reject)
      const direccion = server.address()
      // `listen(puerto, host, cb)` con un host string SIEMPRE da un `AddressInfo`
      // (nunca el string crudo que devuelve para un socket Unix/pipe) — sólo TypeScript
      // no lo sabe sin este chequeo explícito.
      puerto = typeof direccion === "object" && direccion !== null ? direccion.port : 0
      const url = `http://${host}:${puerto}/`

      async function cerrar(): Promise<void> {
        for (const cliente of clientesSSE) {
          cliente.desuscribir()
          cliente.res.end()
        }
        clientesSSE.clear()
        const cerrado = new Promise<void>((resolveCierre) => server.close(() => resolveCierre()))
        // `server.close()` deja de aceptar conexiones nuevas, pero su callback NO
        // dispara hasta que TODAS las conexiones existentes terminen — incluidas
        // conexiones keep-alive ociosas que un cliente HTTP/1.1 pudo dejar abiertas
        // sin pedir nada más. Mismo mecanismo que preview.mjs:368
        // (`server.closeIdleConnections?.()`, disponible desde Node 18.2): fuerza el
        // cierre de esas conexiones ociosas para que `cerrar()` resuelva sin
        // depender de que ningún cliente decida cerrar su lado primero.
        server.closeIdleConnections?.()
        await cerrado
      }

      resolve({ url, puerto, cerrar })
    })
  })
}
