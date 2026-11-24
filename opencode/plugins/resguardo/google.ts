// ============================================================================
// Resguardo ante el corte de Google a mitad de respuesta.
//
// POR QUÉ EXISTE (medido el 2026-11-24 en una notebook Windows real, con
// Gemini 3.5 Flash Lite y OpenCode 1.18.18, capturando la respuesta cruda):
// cuando Google está saturado puede contestar HTTP 200, mandar uno o más trozos
// de pensamiento y, DENTRO del mismo stream, un trozo así:
//
//   data: {"error": {"code": 503,"message": "This model is currently
//          experiencing high demand. ...","status": "UNAVAILABLE"}}
//
// seguido del mismo JSON suelto, sin `data:`. No hay `finishReason`. El SDK de
// Google deja el motivo de fin en "unknown" y OpenCode 1.18.18 cierra el turno
// sin texto, sin error y sin reintento: el docente queda frente a una pantalla
// vacía. (Cuando el 503 llega como estado HTTP, OpenCode sí reintenta: el hueco
// es sólo el corte a mitad de stream.)
//
// Subir OpenCode no lo resuelve: 1.19.6 sigue el bucle con el turno vacío y
// Google contesta 400 "Requests ending with a model turn are not supported";
// la línea 2.x reintenta bien pero no carga las herramientas de esta capa.
//
// QUÉ HACE: envuelve el `fetch` del proveedor y lee el stream antes que
// OpenCode.
// - Si el stream se corta y todavía no salió nada VISIBLE (texto que no sea
//   pensamiento, o una llamada a herramienta), vuelve a hacer el mismo pedido
//   y sigue volcando la respuesta nueva en el mismo stream. Para OpenCode fue
//   una sola respuesta, más larga.
// - Si ya salió algo visible no se puede repetir (se duplicaría el texto o la
//   llamada): cierra el stream con un aviso que dice que la respuesta quedó
//   cortada.
// - Si se agotan los reintentos, cierra el stream con un aviso que dice que
//   Google está saturado.
//
// EL AVISO ES TEXTO DEL ASISTENTE y por eso dice de entrada que no lo escribió
// el modelo: es la única forma de hablarle al docente desde acá, y un aviso
// que parece respuesta del modelo sería un OK falso.
//
// QUÉ NO SE PROBÓ (ver el commit): la TUI, el corte después de contenido
// visible contra Google real, y qué hace el modelo en el turno siguiente con
// el aviso en el historial.
// ============================================================================

/** La forma de `fetch` que le pasa el SDK al proveedor. */
export type Buscar = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type OpcionesDeResguardo = {
  /** Cuántas veces se vuelve a pedir después del primer corte. */
  reintentos: number
  /** Cuánto se espera antes del reintento número `intento` (1, 2, 3…), en ms. */
  esperaMs: (intento: number) => number
  /** Espera cancelable. Se inyecta para que los tests no esperen de verdad. */
  esperar?: (ms: number, senal?: AbortSignal | null) => Promise<void>
  /** Para dejar constancia de cada corte en el registro de OpenCode. */
  anotar?: (mensaje: string, extra?: Record<string, unknown>) => void
}

export const REINTENTOS_POR_DEFECTO = 3
/** 2 s, 4 s, 8 s: 14 s de espera en total antes de rendirse. */
export const esperaPorDefecto = (intento: number) => 2000 * 2 ** (intento - 1)

const MARCA = "⚠️ Aviso de Tecnia Bot (esto no lo escribió el modelo):"

export const avisoSaturado = (cortes: number) =>
  `${MARCA} Google está saturado y cortó la respuesta ${cortes} veces seguidas. Esperá un minuto y mandá de nuevo tu mensaje.`

export const AVISO_CORTADO = `\n\n${MARCA} Google cortó la respuesta acá, por saturación. Lo de arriba puede estar incompleto. Mandá de nuevo tu mensaje para seguir.`

/** Un trozo con la forma que manda Google, para cerrar el stream con un texto nuestro. */
export function trozoDeAviso(texto: string): string {
  const cuerpo = {
    candidates: [{ content: { parts: [{ text: texto }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
  }
  return `data: ${JSON.stringify(cuerpo)}\r\n\r\n`
}

function esperarDeVerdad(ms: number, senal?: AbortSignal | null): Promise<void> {
  return new Promise((listo, falla) => {
    if (senal?.aborted) return falla(senal.reason ?? new Error("cancelado"))
    const reloj = setTimeout(() => {
      senal?.removeEventListener("abort", cortar)
      listo()
    }, ms)
    const cortar = () => {
      clearTimeout(reloj)
      falla(senal?.reason ?? new Error("cancelado"))
    }
    senal?.addEventListener("abort", cortar, { once: true })
  })
}

function direccion(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

type Parte = { text?: unknown; thought?: unknown; functionCall?: unknown }

/** ¿Este trozo le muestra algo al usuario o dispara una herramienta? El pensamiento no cuenta. */
function tieneAlgoVisible(partes: readonly Parte[]): boolean {
  return partes.some(
    (p) => p.functionCall !== undefined || (p.thought !== true && typeof p.text === "string" && p.text.length > 0),
  )
}

export function conResguardo(base: Buscar, opciones: OpcionesDeResguardo): Buscar {
  const esperar = opciones.esperar ?? esperarDeVerdad
  return async (input, init) => {
    const primera = await base(input, init)
    // Sólo el stream de generación. Un error HTTP se devuelve tal cual: ése OpenCode lo sabe reintentar.
    if (!direccion(input).includes(":streamGenerateContent") || !primera.ok || !primera.body) return primera

    const codificar = new TextEncoder()
    const senal = init?.signal
    let visible = false
    let lectorActual: ReadableStreamDefaultReader<Uint8Array> | null = null
    let abandonado = false

    /** Vuelca una respuesta en `salida`. Dice si terminó bien o si se cortó. */
    async function volcar(
      respuesta: Response,
      salida: ReadableStreamDefaultController<Uint8Array>,
    ): Promise<"bien" | "corte"> {
      const lector = respuesta.body!.getReader()
      lectorActual = lector
      const decodificar = new TextDecoder()
      let pendiente = ""
      let cerrado = false
      for (;;) {
        const { done, value } = await lector.read()
        pendiente += done ? decodificar.decode() : decodificar.decode(value, { stream: true })
        const eventos = pendiente.split(/\r?\n\r?\n/)
        pendiente = done ? "" : (eventos.pop() ?? "")
        for (const evento of eventos) {
          let json: { error?: unknown; candidates?: { finishReason?: unknown; content?: { parts?: Parte[] } }[] }
          try {
            json = JSON.parse(evento.slice("data:".length))
          } catch {
            // Lo que no es `data: {json}` no es un evento y no se reenvía. El caso real: después del
            // trozo de error Google agrega el mismo JSON suelto, sin `data:` (sin sus 5 primeras letras
            // deja de parsear). No hay un chequeo aparte de `startsWith("data:")`: sería código que
            // ningún test puede distinguir de éste (se probó por mutación y quedaba verde).
            continue
          }
          if (json.error !== undefined) {
            void lector.cancel().catch(() => {})
            return "corte"
          }
          const candidato = json.candidates?.[0]
          if (tieneAlgoVisible(candidato?.content?.parts ?? [])) visible = true
          if (candidato?.finishReason !== undefined && candidato.finishReason !== null) cerrado = true
          salida.enqueue(codificar.encode(`${evento}\r\n\r\n`))
        }
        // Un stream que se acaba sin `finishReason` también es un corte: es lo que OpenCode leería como "unknown".
        if (done) return cerrado ? "bien" : "corte"
      }
    }

    const cuerpo = new ReadableStream<Uint8Array>({
      async start(salida) {
        let respuesta: Response | null = primera
        let cortes = 0
        try {
          for (;;) {
            const fin = respuesta === null ? "corte" : await volcar(respuesta, salida)
            if (abandonado) return
            if (fin === "bien") return salida.close()
            cortes++
            opciones.anotar?.("Google cortó la respuesta a mitad de camino", { cortes, visible })
            if (visible) {
              salida.enqueue(codificar.encode(trozoDeAviso(AVISO_CORTADO)))
              return salida.close()
            }
            if (cortes > opciones.reintentos) {
              salida.enqueue(codificar.encode(trozoDeAviso(avisoSaturado(cortes))))
              return salida.close()
            }
            await esperar(opciones.esperaMs(cortes), senal)
            if (abandonado) return
            respuesta = await base(input, init)
            if (!respuesta.ok || !respuesta.body) {
              opciones.anotar?.("el reintento no trajo un stream", { estado: respuesta.status })
              void respuesta.body?.cancel().catch(() => {})
              respuesta = null
            }
          }
        } catch (error) {
          // Cancelado por el usuario o la red se cayó: que lo vea OpenCode, no lo tapamos con un aviso.
          if (!abandonado) salida.error(error)
        }
      },
      cancel(motivo) {
        abandonado = true
        return lectorActual?.cancel(motivo).catch(() => {})
      },
    })

    const encabezados = new Headers(primera.headers)
    // El cuerpo ya no es el original: su largo y su compresión dejaron de valer.
    encabezados.delete("content-length")
    encabezados.delete("content-encoding")
    return new Response(cuerpo, { status: primera.status, statusText: primera.statusText, headers: encabezados })
  }
}
