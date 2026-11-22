// Servidor de vuelta — el oído local que espera al navegador después del vínculo.
//
// Cuando el docente confirma en la plataforma, el navegador es redirigido a
// `http://127.0.0.1:<puerto>/callback?code=…&state=…`. Este archivo levanta ese
// puerto, espera UNA vuelta válida y se apaga. No es un servidor que quede
// corriendo: vive lo que dura un intento de vínculo.
//
// A ESE PUERTO LE PUEDE ESCRIBIR CUALQUIERA. Cualquier página que el docente
// tenga abierta puede hacerle un pedido a 127.0.0.1. Por eso:
//
// - Escucha sólo en 127.0.0.1, nunca en todas las interfaces: en la red de la
//   escuela no puede quedar un puerto abierto hacia las otras compus.
// - Sólo atiende GET a la ruta exacta, con el `Host` propio (misma defensa que
//   `servidor/servidor-proyecto.ts` contra el rebinding de DNS).
// - Un pedido con la marca equivocada se rechaza y se SIGUE ESPERANDO. Si
//   cortara ahí, cualquier página podría cancelarle el vínculo al docente.
// - Lo que responde es texto fijo. Nada de lo que llega en la URL vuelve a la
//   página: no hay nada que inyectar.
//
// LO QUE ESTE ARCHIVO TODAVÍA NO PROBÓ: un navegador de verdad viniendo desde la
// plataforma. Los tests le hablan con `fetch` al puerto real, que prueba el
// servidor pero no que el navegador deje pasar una redirección de https a http
// sobre 127.0.0.1.

import http from "node:http"
import type { AddressInfo } from "node:net"
import { leerCallback } from "./vinculo.ts"
import type { Intento } from "./vinculo.ts"

export type ResultadoVuelta = { estado: "ok"; code: string } | { estado: "sin-respuesta" } | { estado: "cancelada" }

export interface ServidorDeVuelta {
  /** Puerto real en el que quedó escuchando. */
  puerto: number
  /** Se resuelve con la primera vuelta válida, al vencer la espera o al cancelar. */
  vuelta: Promise<ResultadoVuelta>
  /** Deja de esperar y libera el puerto. */
  cancelar(): void
}

export type ResultadoAbrir = { estado: "escuchando"; servidor: ServidorDeVuelta } | { estado: "no-pude-escuchar" }

const ESPERA_MS = 5 * 60_000

// La página que ve el docente cuando el navegador vuelve a la compu.
//
// DOS REGLAS, y las dos tienen test:
// - NO DICE QUE QUEDÓ VINCULADO. Cuando se muestra, el bot recién recibió el
//   código: todavía falta canjearlo con la plataforma, y eso puede fallar. Lo
//   único que sabe esta página es que el navegador volvió. Por eso manda al chat
//   a preguntar, que es donde `estado` lo confirma.
// - NO PIDE NADA DE AFUERA. Sin fuentes, imágenes ni hojas de estilo de otro
//   sitio: se sirve desde 127.0.0.1 con el código del vínculo en la barra, y
//   cualquier pedido a otro lado es un lugar por donde se puede filtrar.
export const PAGINA_LISTO = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tecnia Bot</title>
<style>
  :root { color-scheme: dark light; --fondo: #1a1c18; --tarjeta: #22251f; --borde: #3a3f35; --texto: #f2f1ea; --suave: #b9bcae; --acento: #9ad1a3; }
  @media (prefers-color-scheme: light) {
    :root { --fondo: #f5f4ee; --tarjeta: #ffffff; --borde: #d9d8cd; --texto: #1c1e19; --suave: #55594d; --acento: #2f7d43; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
         background: var(--fondo); color: var(--texto); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
  main { width: 100%; max-width: 30rem; background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 14px; padding: 2rem; }
  .marca { font-size: .8rem; letter-spacing: .14em; text-transform: uppercase; color: var(--suave); margin: 0 0 1.25rem; }
  .tilde { width: 3rem; height: 3rem; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--acento); color: var(--acento); font-size: 1.6rem; margin-bottom: 1rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .75rem; }
  .suave { color: var(--suave); font-size: .95rem; margin: 0; }
</style>
</head>
<body>
<main>
<p class="marca">Tecnia Bot</p>
<div class="tilde" aria-hidden="true">&#10003;</div>
<h1>Recibido</h1>
<p>Ya podés cerrar esta pestaña y volver a Tecnia Bot.</p>
<p class="suave">Tecnia Bot está terminando de conectar esta compu con tu cuenta. Preguntale en el chat si ya quedó.</p>
</main>
</body>
</html>
`

function responder(res: http.ServerResponse, status: number, tipo: string, cuerpo: string): void {
  res.writeHead(status, {
    "Content-Type": `${tipo}; charset=utf-8`,
    "Cache-Control": "no-store",
    // El código viene en la URL: que no viaje como referente a ningún lado.
    "Referrer-Policy": "no-referrer",
    // La página no carga nada de ningún lado y no corre scripts. Esto hace que el
    // navegador lo exija, por si alguien edita la página sin leer su comentario.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    Connection: "close",
  })
  res.end(cuerpo)
}

/**
 * Levanta el servidor de vuelta para un intento.
 *
 * El puerto lo elige el sistema (puerto 0): uno fijo choca con lo que haya en la
 * compu y deja de andar sin que se entienda por qué.
 */
export function abrirServidorDeVuelta(intento: Intento, esperaMs: number = ESPERA_MS): Promise<ResultadoAbrir> {
  return new Promise((resolverAbrir) => {
    let terminar: (r: ResultadoVuelta) => void = () => {}
    const vuelta = new Promise<ResultadoVuelta>((resolver) => {
      terminar = resolver
    })
    let puerto = 0
    let terminado = false

    const servidor = http.createServer((req, res) => {
      const host = req.headers.host ?? ""
      if (host !== `127.0.0.1:${puerto}` && host !== `localhost:${puerto}`) {
        return responder(res, 403, "text/plain", "Pedido rechazado.")
      }
      if (req.method !== "GET") return responder(res, 405, "text/plain", "Método no permitido.")

      const leido = leerCallback(req.url ?? "", intento)
      if (leido.estado === "ruta-desconocida") return responder(res, 404, "text/plain", "No encontrado.")
      if (leido.estado !== "ok") return responder(res, 400, "text/plain", "Este enlace no corresponde al vínculo en curso.")

      responder(res, 200, "text/html", PAGINA_LISTO)
      cerrar({ estado: "ok", code: leido.code })
    })

    const reloj = setTimeout(() => cerrar({ estado: "sin-respuesta" }), esperaMs)

    function cerrar(resultado: ResultadoVuelta): void {
      if (terminado) return
      terminado = true
      clearTimeout(reloj)
      // `close()` deja de escuchar. `closeAllConnections()` corta las conexiones que
      // quedaron abiertas sin pedir nada (un navegador abre de más y las deja).
      //
      // HISTORIA, para que nadie lo vuelva a sacar: `closeAllConnections()` estuvo, y
      // se sacó «porque ningún test lo podía poner rojo»: con Node 26 el `close()`
      // solo ya corta esas conexiones. Con Node 22 y 24 NO las corta, y el test
      // «al terminar corta también las conexiones…» falla. Se vio el 21/11/2026, la
      // primera vez que esta rama corrió en el CI, que usa Node 24. La conclusión
      // «no hace falta» valía para UNA versión de Node, la de la compu donde se probó.
      // El bot además corre sobre Bun, no sobre Node: otra razón para pedirlo
      // explícito en vez de depender de lo que haga `close()`.
      servidor.close()
      servidor.closeAllConnections?.()
      terminar(resultado)
    }

    servidor.once("error", () => {
      clearTimeout(reloj)
      terminado = true
      resolverAbrir({ estado: "no-pude-escuchar" })
    })
    servidor.listen(0, "127.0.0.1", () => {
      puerto = (servidor.address() as AddressInfo).port
      resolverAbrir({ estado: "escuchando", servidor: { puerto, vuelta, cancelar: () => cerrar({ estado: "cancelada" }) } })
    })
  })
}
