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
// Defensivo: cualquier error deja el texto como estaba. Un filtro de idioma no
// puede ser la razón de que el bot deje de contestar.
// ============================================================================
import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { limpiar, MAX_TEXTO } from "./idioma/detector.ts"

const SERVICIO = "tecnia-idioma"
const AGENTE = "tecnia-bot"

// limpiar() es barato, pero el transform recorre TODO el historial en cada paso
// de cada turno. Se recuerda el resultado por texto; con tope, para no crecer
// sin fin en una charla de horas. Los textos más largos que el tope del
// detector vuelven sin tocar y no se guardan.
const MAX_CACHE = 500
const cache = new Map<string, ReturnType<typeof limpiar>>()
function limpio(texto: string): ReturnType<typeof limpiar> {
  const hit = cache.get(texto)
  if (hit) return hit
  const r = limpiar(texto)
  if (texto.length <= MAX_TEXTO) {
    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(texto, r)
  }
  return r
}

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
        const r = limpio(antes)
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
        for (const [i, msg] of output.messages.entries()) {
          try {
            // Sólo lo que escribió tecnia-bot: nunca el docente, nunca el resumen
            // de la compactación ni otros agentes; y adentro, sólo las partes de
            // texto: nunca las tools ni sus resultados, nunca el reasoning.
            if (!msg?.info || !Array.isArray(msg.parts) || !esDeTecniaBot(msg.info as InfoMensaje)) continue
            let cambio = false
            const parts = msg.parts.map((p) => {
              if (p.type !== "text" || !p.text) return p
              const r = limpio(p.text)
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
        if (partes > 0) anotar("saqué planificación en inglés del historial que ve el modelo", { partes })
      } catch {
        // historial intacto
      }
    },
  }
  return hooks
}

export default { id: SERVICIO, server } satisfies PluginModule
