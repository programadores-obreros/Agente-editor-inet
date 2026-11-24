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
// OpenCode. Hay tres finales posibles que NO son una respuesta sana:
//
// 1. SATURACIÓN (trozo de error 503 / UNAVAILABLE) o stream que se acaba sin
//    `finishReason`. Si todavía no salió nada visible, repite el mismo pedido
//    y sigue volcando la respuesta nueva en el mismo stream. Si se agotan los
//    reintentos, cierra con un aviso.
// 2. OTRO ERROR de Google a mitad de stream (429 de cuota, 400…). Repetir no lo
//    arregla y gasta cuota: no se reintenta. Cierra con un aviso que copia lo
//    que dijo Google, sin hablar de saturación.
// 3. Cualquiera de los dos cuando YA salió algo visible. No se puede repetir
//    (se duplicaría el texto, o la herramienta correría dos veces). Si lo
//    visible fue texto, agrega un aviso de respuesta cortada. Si fue una
//    llamada a herramienta, cierra sin aviso: OpenCode la va a ejecutar y el
//    turno sigue solo, así que "mandá de nuevo tu mensaje" sería falso.
//
// QUÉ DEJA PASAR SIN TOCAR: un prompt bloqueado (`promptFeedback.blockReason`)
// es una respuesta completa de Google, no un corte. Y lo que no se entiende
// como evento se reenvía tal cual en vez de tragarlo.
//
// EL AVISO ES TEXTO DEL ASISTENTE y por eso dice de entrada que no lo escribió
// el modelo: es la única forma de hablarle al docente desde acá, y un aviso
// que parece respuesta del modelo sería un OK falso. Sólo afirma lo que este
// código vio: dice "saturado" únicamente si todos los cortes fueron 503.
//
// LÍMITES CONOCIDOS (no son descuidos):
// - El pensamiento del intento cortado ya salió y se suma al del intento
//   nuevo: OpenCode ve un razonamiento más largo. Retenerlo hasta ver algo
//   visible le sacaría al docente la señal de que el bot está pensando.
// - Todo corre al abrir el stream, sin esperar a que el consumidor lea. Para
//   respuestas de un modelo el volumen es chico.
// - Una respuesta que termina BIEN pero vacía (finishReason sin texto) pasa
//   tal cual: es el mismo síntoma de bot mudo, por otra causa, y no se cubre.
// - Sólo se reintenta si el pedido se puede repetir: URL o string, y cuerpo
//   de texto. Con un `Request` o un cuerpo de un solo uso no interviene.
//
// QUÉ NO SE PROBÓ: ver el commit.
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
const QUE_HACER = "Esperá un minuto y mandá de nuevo tu mensaje."

/** Todos los intentos terminaron en un 503 de Google: ahí sí se puede decir "saturado". */
export const avisoSaturado = (intentos: number) =>
  `${MARCA} Google está saturado: en ${intentos} intentos seguidos no completó la respuesta. ${QUE_HACER}`

/** No hubo respuesta completa, y no todos los intentos fueron un 503: no se afirma la causa. */
export const avisoSinRespuesta = (intentos: number) =>
  `${MARCA} Google no completó la respuesta en ${intentos} intentos seguidos. ${QUE_HACER}`

/** Google mandó un error que repetir no arregla. Se copia lo que dijo, recortado. */
export const avisoDeError = (codigo: unknown, mensaje: unknown) =>
  `${MARCA} Google devolvió un error a mitad de la respuesta y no la terminó` +
  `${typeof codigo === "number" ? ` (código ${codigo})` : ""}` +
  `${typeof mensaje === "string" && mensaje.length > 0 ? `: «${mensaje.slice(0, 300)}»` : "."}` +
  ` Si el error habla de cuota («quota»), mandar de nuevo el mensaje ahora no lo arregla.`

export const AVISO_CORTADO = `\n\n${MARCA} La respuesta de Google se cortó acá. Lo de arriba puede estar incompleto. Mandá de nuevo tu mensaje para seguir.`

type Uso = Record<string, unknown>

/** Un trozo con la forma que manda Google, para cerrar el stream nosotros. Sin `texto`, sólo cierra. */
export function trozoDeCierre(texto: string, uso?: Uso): string {
  const cuerpo = {
    candidates: [{ content: { parts: [{ text: texto }], role: "model" }, finishReason: "STOP", index: 0 }],
    // El SDK se queda con el último conteo que ve: se repite el último real para no pisarlo con ceros.
    usageMetadata: uso ?? { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
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

/** La URL, sólo si el pedido se puede repetir: no un `Request` (su cuerpo se usa una vez). */
function direccionRepetible(input: RequestInfo | URL, init?: RequestInit): string | null {
  const cuerpo = init?.body
  if (cuerpo !== undefined && cuerpo !== null && typeof cuerpo !== "string") return null
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return null
}

type Parte = { text?: unknown; thought?: unknown; functionCall?: unknown }
type Trozo = {
  error?: { code?: unknown; status?: unknown; message?: unknown } | null
  candidates?: { finishReason?: unknown; content?: { parts?: Parte[] } }[]
  promptFeedback?: { blockReason?: unknown } | null
  usageMetadata?: Uso
}

/** Lo que trae un trozo: nada que se vea, texto, o una llamada a herramienta (u otra parte que no es texto). */
function loVisible(partes: readonly Parte[]): "nada" | "texto" | "accion" {
  let hay: "nada" | "texto" | "accion" = "nada"
  for (const p of partes) {
    if (p.thought === true) continue
    const claves = Object.keys(p).filter((k) => k !== "thoughtSignature")
    if (claves.length === 1 && claves[0] === "text") {
      if (typeof p.text === "string" && p.text.length > 0 && hay === "nada") hay = "texto"
    } else if (claves.length > 0) hay = "accion"
  }
  return hay
}

/** El JSON de un evento SSE: junta sus líneas `data:` e ignora `event:`, `id:` y comentarios. */
function datosDelEvento(evento: string): string | null {
  const lineas = evento.split(/\r?\n|\r/).filter((l) => l.startsWith("data:"))
  if (lineas.length === 0) return null
  return lineas.map((l) => l.slice("data:".length).replace(/^ /, "")).join("\n")
}

const esSaturacion = (e: NonNullable<Trozo["error"]>) => e.code === 503 || e.status === "UNAVAILABLE"

type Fin =
  | { como: "bien" }
  | { como: "saturado" }
  | { como: "sin-cierre" }
  | { como: "error"; codigo: unknown; mensaje: unknown }

const YA_ENVUELTO = Symbol.for("tecnia.resguardo.google")

export function conResguardo(base: Buscar, opciones: OpcionesDeResguardo): Buscar {
  // Si el hook `config` corre dos veces sobre la misma configuración no se apilan resguardos.
  if ((base as { [YA_ENVUELTO]?: true })[YA_ENVUELTO]) return base
  const esperar = opciones.esperar ?? esperarDeVerdad
  const resguardado: Buscar = async (input, init) => {
    const primera = await base(input, init)
    // Sólo el stream de generación, y sólo si se puede repetir. Un error HTTP se devuelve tal cual:
    // ése OpenCode lo sabe reintentar.
    const url = direccionRepetible(input, init)
    if (url === null || !url.includes(":streamGenerateContent") || !primera.ok || !primera.body) return primera

    const codificar = new TextEncoder()
    const senal = init?.signal
    let visible: "nada" | "texto" | "accion" = "nada"
    let ultimoUso: Uso | undefined
    let lectorActual: ReadableStreamDefaultReader<Uint8Array> | null = null
    let abandonado = false

    /** Vuelca una respuesta en `salida` y dice cómo terminó. */
    async function volcar(respuesta: Response, salida: ReadableStreamDefaultController<Uint8Array>): Promise<Fin> {
      const lector = respuesta.body!.getReader()
      lectorActual = lector
      const decodificar = new TextDecoder()
      let pendiente = ""
      let cerrado = false
      try {
        for (;;) {
          const { done, value } = await lector.read()
          pendiente += done ? decodificar.decode() : decodificar.decode(value, { stream: true })
          const eventos = pendiente.split(/\r?\n\r?\n/)
          pendiente = done ? "" : (eventos.pop() ?? "")
          for (const evento of eventos) {
            if (evento.trim().length === 0) continue
            const datos = datosDelEvento(evento)
            // Sin líneas `data:` no es un evento con contenido (un comentario, o el JSON suelto que
            // Google agrega después del trozo de error): no hay nada que el SDK pueda leer ahí.
            if (datos === null) continue
            let json: Trozo | null
            try {
              json = JSON.parse(datos)
            } catch {
              json = null
            }
            if (json === null || typeof json !== "object" || Array.isArray(json)) {
              // No se entiende: que lo decida el SDK, no lo tragamos.
              salida.enqueue(codificar.encode(`${evento}\r\n\r\n`))
              continue
            }
            if (json.error !== undefined && json.error !== null) {
              // Un error después de un cierre no cambia nada: la respuesta ya estaba completa.
              if (cerrado) return { como: "bien" }
              return esSaturacion(json.error)
                ? { como: "saturado" }
                : { como: "error", codigo: json.error.code, mensaje: json.error.message }
            }
            if (json.usageMetadata !== undefined) ultimoUso = json.usageMetadata
            const candidato = json.candidates?.[0]
            const hay = loVisible(candidato?.content?.parts ?? [])
            if (hay === "accion" || (hay === "texto" && visible === "nada")) visible = hay
            if (typeof candidato?.finishReason === "string") cerrado = true
            // Un prompt bloqueado es una respuesta completa de Google, no un corte.
            if (json.promptFeedback?.blockReason !== undefined && json.promptFeedback.blockReason !== null) cerrado = true
            salida.enqueue(codificar.encode(`${evento}\r\n\r\n`))
          }
          // Un stream que se acaba sin cierre es lo que OpenCode leería como "unknown".
          if (done) return cerrado ? { como: "bien" } : { como: "sin-cierre" }
        }
      } finally {
        // Salga como salga, el cuerpo de este intento no queda abierto.
        void lector.cancel().catch(() => {})
      }
    }

    const cuerpo = new ReadableStream<Uint8Array>({
      async start(salida) {
        const cerrarCon = (texto: string) => {
          salida.enqueue(codificar.encode(trozoDeCierre(texto, ultimoUso)))
          salida.close()
        }
        let respuesta: Response | null = primera
        // Cómo terminó un reintento que ni siquiera trajo un stream (error HTTP).
        let sinStream: Fin = { como: "sin-cierre" }
        let intentos = 0
        let todosSaturados = true
        try {
          for (;;) {
            const fin: Fin = respuesta === null ? sinStream : await volcar(respuesta, salida)
            if (abandonado) return
            if (fin.como === "bien") return salida.close()
            intentos++
            if (fin.como !== "saturado") todosSaturados = false
            opciones.anotar?.("Google no terminó la respuesta", {
              intentos,
              visible,
              como: fin.como,
              ...(fin.como === "error" ? { codigo: fin.codigo, mensaje: fin.mensaje } : {}),
            })
            // Ya hay una llamada a herramienta: OpenCode la ejecuta y el turno sigue. Sin aviso.
            if (visible === "accion") return cerrarCon("")
            if (visible === "texto") return cerrarCon(AVISO_CORTADO)
            if (fin.como === "error") return cerrarCon(avisoDeError(fin.codigo, fin.mensaje))
            if (intentos > opciones.reintentos) {
              return cerrarCon(todosSaturados ? avisoSaturado(intentos) : avisoSinRespuesta(intentos))
            }
            await esperar(opciones.esperaMs(intentos), senal)
            if (abandonado) return
            respuesta = await base(input, init)
            // Si el consumidor se fue mientras el reintento viajaba no hace falta un corte aparte:
            // `volcar` falla en su primer `enqueue` y su `finally` cancela este cuerpo. (Había un
            // chequeo explícito acá; por mutación se vio que ningún test lo distinguía de esto.)
            if (!respuesta.ok || !respuesta.body) {
              opciones.anotar?.("el reintento no trajo un stream", { estado: respuesta.status })
              // Un 503 por HTTP también es saturación; cualquier otro estado no.
              sinStream = respuesta.status === 503 ? { como: "saturado" } : { como: "sin-cierre" }
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
  return Object.assign(resguardado, { [YA_ENVUELTO]: true as const })
}

export type ConProveedores = {
  model?: unknown
  agent?: Record<string, { model?: unknown } | undefined>
  provider?: Record<string, { options?: Record<string, unknown> } | undefined>
}

const esDeGoogle = (modelo: unknown) => typeof modelo === "string" && modelo.startsWith("google/")

/** ¿Esta configuración ya nombra a Google? Si no, no se toca: ver el encabezado de tecnia-resguardo.ts. */
export function usaGoogle(cfg: ConProveedores): boolean {
  if (cfg.provider?.google !== undefined) return true
  if (esDeGoogle(cfg.model)) return true
  return Object.values(cfg.agent ?? {}).some((agente) => esDeGoogle(agente?.model))
}
