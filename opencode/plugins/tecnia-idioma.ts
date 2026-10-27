// ============================================================================
// Tecnia Bot — plugin de servidor que saca la "planificación en inglés" que el
// modelo a veces escribe como texto visible (ver idioma/detector.ts: el porqué,
// el corpus real y cómo decide).
//
// CÓMO LO CARGA OPENCODE (1.18.18, verificado en el fuente del tag):
// - config/plugin.ts escanea `{plugin,plugins}/*.{ts,js}` en cada carpeta de
//   config, empezando por ~/.config/opencode. Los instaladores copian
//   opencode/plugins/ ahí, así que este archivo se carga SOLO: no hay que
//   declararlo en opencode.json. El glob no baja a subcarpetas, por eso el
//   detector vive en idioma/ y no se carga como plugin.
// - Un plugin de archivo tiene que exportar por default `{ id, server }`
//   (plugin/shared.ts: readV1Plugin + resolvePluginId exige `id` en los de
//   archivo). Nada más se exporta: con un export suelto que no sea función,
//   el cargador viejo (getLegacyPlugins) tiraría "Plugin export is not a function".
// - tecnia-logo.tsx es OTRA cosa: plugin de TUI, se declara en tui.json y el
//   glob de acá no lo toca (es .tsx).
//
// LOS DOS HOOKS:
// - "experimental.text.complete": session/processor.ts lo llama en `text-end`,
//   cuando termina cada parte de texto. Lo que quede en output.text es lo que
//   se guarda y lo que la TUI deja en pantalla. Mientras el texto llega, la TUI
//   ya lo fue mostrando delta a delta: el inglés puede verse unos segundos y
//   desaparece al cerrar la parte. Si se saca todo, queda "" y la TUI no dibuja
//   nada (routes/session/index.tsx: <Show when={part.text.trim()}>).
// - "experimental.chat.messages.transform": session/prompt.ts lo llama en cada
//   paso, antes de convertir el historial para el modelo. Corta el contagio:
//   el modelo ya no ve sus fugas viejas (de charlas anteriores al plugin, o de
//   una parte cortada a mitad de camino, que no pasa por text-end).
//   `msgs` se relee de la base en cada vuelta del loop (filterCompactedEffect),
//   así que tocarlo no persiste nada; igual no se mutan las partes: se
//   reemplaza el mensaje en el MISMO arreglo, porque prompt.ts no usa el valor
//   devuelto por el hook sino su propia variable `msgs`.
//
// SÓLO EL AGENTE tecnia-bot, Y NUNCA LA COMPACTACIÓN. Cuando la charla se
// llena, OpenCode la resume (session/compaction.ts de 1.18.18): crea un mensaje
// con `agent: "compaction"` y `summary: true` (:399-401) y lo genera con el
// MISMO SessionProcessor (:420-425), así que su texto pasa por text.complete.
// Ese resumen se escribe en inglés a propósito ("## Goal…", "The user
// wants…"): si el filtro lo vaciara, la charla perdería su memoria. Para saber
// de qué agente es cada parte, se escucha el evento `message.updated`, que
// llega cuando se crea el mensaje del asistente, ANTES de que el modelo
// escriba (session.ts:631-633, publicado sincrónico a los plugins en
// plugin/index.ts:253-258). Si por algo no llegó, el respaldo es
// `experimental.session.compacting` (compaction.ts:373), que marca la sesión
// hasta `session.compacted` (:554) o hasta el próximo mensaje normal.
// Y al revés: compaction.ts:379 también llama a messages.transform sobre una
// copia (structuredClone, :378) de la charla que va a resumir. Ahí limpiar
// los mensajes de tecnia-bot está bien: el resumen no hereda la fuga.
//
// EL ÚLTIMO MENSAJE DEL DOCENTE. Sirve para dos cosas (ver detector.ts,
// Opciones): si el modelo lo repite entre comillas antes de una fuga, esa
// repetición es eco del plan; y si el docente PIDIÓ inglés o una traducción
// ("escribime en inglés…", "traducime esto"), no se filtra. Se aprende de
// `chat.message` (cada mensaje nuevo) y se rehace desde el historial que llega
// al transform. Un turno sin texto (sólo una imagen) deja el mensaje en "".
//
// CUÁNTO DURA EL PEDIDO DE INGLÉS: el turno del pedido y los 2 siguientes
// (3 turnos), o hasta que el docente pida español ("en español, si?"), lo
// que pase primero. Así "agregale una oración más" o "hacelo más corto",
// después de pedir el texto en inglés, siguen sin filtrarse; y una charla no
// queda sin filtro para siempre por un pedido de hace una hora.
//
// NO SE FILTRAN los subagentes de `task` (agente "general" u otros): sus
// mensajes no son de tecnia-bot. Tecnia Bot hoy no delega en subagentes; si
// algún día lo hace, hay que sumar sus nombres a AGENTE.
//
// Defensivo: cualquier error deja el texto como estaba. Un filtro de idioma no
// puede ser la razón de que el bot deje de contestar.
// ============================================================================
import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { crearCache } from "./idioma/cache.ts"
import { desenvolver, limpiar, MAX_ECO, MAX_TEXTO, pideEspanol, pideIngles, type Opciones } from "./idioma/detector.ts"

const SERVICIO = "tecnia-idioma"
const AGENTE = "tecnia-bot"

// limpiar() es barato, pero el transform recorre TODO el historial en cada paso
// de cada turno. Se recuerda el resultado por texto (y por el mensaje del
// docente, que cambia la decisión). Tope por cantidad y por caracteres: al
// llenarse se va la entrada MÁS VIEJA, no toda la caché. Los textos más largos
// que el tope del detector vuelven sin tocar y no se guardan.
const cache = crearCache<ReturnType<typeof limpiar>>(500, 2_000_000)
/** La clave de la caché: el texto, el mensaje del docente si puede ser eco, y la señal de inglés pedido. */
function claveDe(texto: string, opciones: Opciones): string {
  // No lleva el mensaje del docente entero (puede ser un log de 100 KB): sólo
  // si puede ser eco (hasta MAX_ECO caracteres); si no, su largo alcanza,
  // porque el resultado ya no depende de él. Más la señal de inglés pedido.
  const u = opciones.ultimoUsuario ?? ""
  // Con el largo adelante, ningún texto puede hacerse pasar por separador:
  // "E12:<mensaje de 12>texto" o, si el mensaje no puede ser eco, "EL5000:texto".
  return (opciones.exento ? "E" : "-") + (u.length <= MAX_ECO ? `${u.length}:${u}` : `L${u.length}:`) + texto
}
function limpio(texto: string, opciones: Opciones = {}): ReturnType<typeof limpiar> {
  const clave = claveDe(texto, opciones)
  const hit = cache.get(clave)
  if (hit) return hit
  const r = limpiar(texto, opciones)
  if (texto.length <= MAX_TEXTO) {
    const peso = clave.length + (r.cambio ? r.texto.length + r.quitados.reduce((n, q) => n + q.length, 0) : 0)
    cache.set(clave, r, peso)
  }
  return r
}

/**
 * El texto de un mensaje del docente: sus partes de texto (no sintéticas),
 * juntas y desenvueltas. "" si no tiene texto (una imagen sola); undefined si
 * no es un turno del docente: todas sus partes son sintéticas, o es el mensaje
 * que crea la compactación (una parte `compaction` y ningún texto).
 */
function textoDeUsuario(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return ""
  if (parts.length > 0 && parts.every((p) => p && p.synthetic)) return undefined
  if (parts.some((p) => p && p.type === "compaction") && !parts.some((p) => p && p.type === "text")) return undefined
  return desenvolver(
    parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string" && !p.synthetic)
      .map((p) => p.text as string)
      .join("\n")
      .trim(),
  )
}

/** Lo que se sabe del docente en una sesión: su último mensaje y cuántos turnos más vale un pedido de inglés. */
type Docente = { mensaje: string; restan: number }
const DOCENTE_INICIAL: Docente = { mensaje: "", restan: 0 }
const TURNOS_DE_INGLES = 3
function avanzarTurno(antes: Docente, mensaje: string): Docente {
  // El pedido de inglés gana: "pasame la consigna en inglés y abajo
  // explicámela en español" pide las dos cosas, y el inglés no se puede borrar.
  if (pideIngles(mensaje)) return { mensaje, restan: TURNOS_DE_INGLES }
  if (pideEspanol(mensaje)) return { mensaje, restan: 0 }
  return { mensaje, restan: Math.max(0, antes.restan - 1) }
}
const opcionesDe = (d: Docente): Opciones => ({ ultimoUsuario: d.mensaje || undefined, exento: d.restan > 0 })

type InfoMensaje = { id?: string; sessionID?: string; role?: string; agent?: string; mode?: string; summary?: boolean }
/** El agente de un mensaje: 1.18.18 guarda `agent` y `mode` con el mismo nombre (prompt.ts:1190-1191). */
const agenteDe = (info: InfoMensaje) => info.agent ?? info.mode
const esDeTecniaBot = (info: InfoMensaje) =>
  info.role === "assistant" && info.summary !== true && agenteDe(info) === AGENTE

const server: Plugin = async ({ client }) => {
  // Deja rastro en el log de OpenCode (`opencode run --print-logs` lo muestra
  // por stderr). Sin await: el log nunca demora ni rompe la respuesta.
  const anotar = (message: string, extra: Record<string, unknown>) => {
    try {
      void client.app.log({ body: { service: SERVICIO, level: "info", message, extra } }).catch(() => {})
    } catch {
      // sin log, sigue igual
    }
  }

  // messageID -> info del mensaje del asistente (de los eventos message.updated).
  const MAX_MENSAJES = 2000
  const mensajes = new Map<string, InfoMensaje>()
  // Sesiones compactando ahora (respaldo por si el evento del mensaje no llegó).
  const compactando = new Set<string>()
  // sessionID -> lo que se sabe del docente (con tope, igual que `mensajes`).
  const docentes = new Map<string, Docente>()
  const recordarDocente = (sessionID: string | undefined, d: Docente) => {
    if (!sessionID) return
    docentes.delete(sessionID)
    if (docentes.size >= MAX_MENSAJES) docentes.delete(docentes.keys().next().value!)
    docentes.set(sessionID, d)
  }

  const hooks: Hooks = {
    event: async ({ event }) => {
      try {
        const e = event as { type?: string; properties?: { info?: InfoMensaje; sessionID?: string } }
        if (e.type === "message.updated") {
          const info = e.properties?.info
          if (!info?.id || info.role !== "assistant") return
          if (mensajes.size >= MAX_MENSAJES) mensajes.clear()
          mensajes.set(info.id, info)
          // Un mensaje normal en la sesión: si había una compactación marcada, ya terminó.
          if (info.sessionID && info.summary !== true && agenteDe(info) !== "compaction") compactando.delete(info.sessionID)
        } else if (e.type === "session.compacted" && e.properties?.sessionID) {
          compactando.delete(e.properties.sessionID)
        }
      } catch {
        // sin datos, text.complete usa el respaldo
      }
    },

    "chat.message": async (input, output) => {
      try {
        const mensaje = textoDeUsuario(output.parts)
        if (mensaje === undefined) return
        recordarDocente(input.sessionID, avanzarTurno(docentes.get(input.sessionID) ?? DOCENTE_INICIAL, mensaje))
      } catch {
        // sin el mensaje, el detector funciona igual
      }
    },

    "experimental.session.compacting": async (input) => {
      try {
        compactando.add(input.sessionID)
      } catch {
        // nada
      }
    },

    "experimental.text.complete": async (input, output) => {
      try {
        const info = mensajes.get(input.messageID)
        if (info ? !esDeTecniaBot(info) : compactando.has(input.sessionID)) return
        const antes = output.text
        const r = limpio(antes, opcionesDe(docentes.get(input.sessionID) ?? DOCENTE_INICIAL))
        if (!r.cambio) return
        output.text = r.texto
        anotar("saqué planificación en inglés de un texto del modelo", {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
          quitados: r.quitados.length,
          quedo_vacio: r.texto === "",
          caracteres_antes: antes.length,
          caracteres_despues: r.texto.length,
        })
      } catch {
        // texto intacto
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        let partes = 0
        // El docente se rehace turno a turno desde el historial: cada respuesta
        // se juzga con lo que había pedido hasta ese momento.
        let docente = DOCENTE_INICIAL
        let sesion: string | undefined
        // Después de una compactación el historial empieza en el resumen: los
        // turnos de antes (y un pedido de inglés reciente) ya no están en él.
        const primerUsuario = output.messages.find((m) => m?.info?.role === "user")
        const empiezaCompactado =
          Array.isArray(primerUsuario?.parts) && primerUsuario.parts.some((p) => p && p.type === "compaction")
        for (const [i, msg] of output.messages.entries()) {
          try {
            if (msg?.info?.role === "user") {
              const t = textoDeUsuario(msg.parts)
              if (t !== undefined) docente = avanzarTurno(docente, t)
              sesion = (msg.info as InfoMensaje).sessionID ?? sesion
              continue
            }
            // Sólo lo que escribió tecnia-bot: nunca el docente, nunca el resumen
            // de la compactación ni otros agentes; y adentro, sólo las partes de
            // texto: nunca las tools ni sus resultados, nunca el reasoning.
            if (!msg?.info || !Array.isArray(msg.parts) || !esDeTecniaBot(msg.info as InfoMensaje)) continue
            let cambio = false
            const parts = msg.parts.map((p) => {
              if (p.type !== "text" || !p.text) return p
              const r = limpio(p.text, opcionesDe(docente))
              if (!r.cambio) return p
              cambio = true
              partes++
              // Se deja la parte con "" en vez de sacarla: es la misma forma que
              // deja text.complete, y el proveedor de Gemini (@ai-sdk/google)
              // descarta solo las partes de texto vacías. Sacar la parte movería
              // de lugar el reasoning firmado de otros proveedores. Probado en la
              // VM (2026-10-19, Gemini 3.5 flash-lite, OpenCode 1.18.18): un
              // historial de ~60 mensajes con 6 a 11 textos vaciados, incluso
              // mensajes del asistente que quedaron sin nada, no dio ningún 400.
              // Por eso no se pone texto de relleno: el modelo lo podría imitar.
              return { ...p, text: r.texto }
            })
            if (cambio) output.messages[i] = { ...msg, parts }
          } catch {
            // ese mensaje queda como estaba; los demás se siguen limpiando
          }
        }
        // El historial (que ya trae el turno actual) es la mejor fuente: si el
        // plugin arrancó a mitad de charla (`opencode run -s`, OpenCode
        // reiniciado), chat.message sólo vio el último mensaje y no sabe que
        // dos turnos atrás el docente pidió inglés. Vale lo rehecho acá.
        // Dos excepciones: mientras compacta, el transform corre sobre una copia
        // parcial (compaction.ts:378-379) y no debe pisar nada; y si el
        // historial empieza compactado, un pedido de inglés de antes del resumen
        // sólo lo sabe lo guardado: vale el mayor de los dos.
        if (sesion && !compactando.has(sesion)) {
          const guardado = docentes.get(sesion)
          if (empiezaCompactado && guardado) docente = { ...docente, restan: Math.max(docente.restan, guardado.restan) }
          recordarDocente(sesion, docente)
        }
        if (partes > 0) anotar("saqué planificación en inglés del historial que ve el modelo", { partes })
      } catch {
        // historial intacto
      }
    },
  }
  return hooks
}

export default { id: SERVICIO, server } satisfies PluginModule
