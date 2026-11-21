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

const PAGINA_LISTO = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Tecnia Bot</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem">
<h1>Listo</h1>
<p>Ya podés cerrar esta pestaña y volver a Tecnia Bot.</p>
</body>
</html>
`

function responder(res: http.ServerResponse, status: number, tipo: string, cuerpo: string): void {
  res.writeHead(status, {
    "Content-Type": `${tipo}; charset=utf-8`,
    "Cache-Control": "no-store",
    // El código viene en la URL: que no viaje como referente a ningún lado.
    "Referrer-Policy": "no-referrer",
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
      // `close()` deja de escuchar y corta las conexiones ociosas. Acá hubo además un
      // `closeAllConnections()`: se sacó porque ningún test lo podía poner rojo (el
      // `close()` de Node ya corta las ociosas, y los pedidos se responden en el acto).
      servidor.close()
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
