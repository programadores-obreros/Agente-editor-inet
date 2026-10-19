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
// Defensivo: cualquier error deja el texto como estaba. Un filtro de idioma no
// puede ser la razón de que el bot deje de contestar.
// ============================================================================
import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { limpiar } from "./idioma/detector.ts"

const SERVICIO = "tecnia-idioma"

// limpiar() es barato, pero el transform recorre TODO el historial en cada paso
// de cada turno. Se recuerda el resultado por texto; con tope, para no crecer
// sin fin en una charla de horas.
const MAX_CACHE = 500
const cache = new Map<string, string>()
function limpio(texto: string): string {
  const hit = cache.get(texto)
  if (hit !== undefined) return hit
  const r = limpiar(texto).texto
  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(texto, r)
  return r
}

const server: Plugin = async ({ client }) => {
  // Deja rastro en el log de OpenCode (`opencode run --print-logs` lo muestra
  // por stderr). Sin await: el log nunca demora ni rompe la respuesta.
  const anotar = (message: string, extra: Record<string, unknown>) => {
    try {
      void client.app
        .log({ body: { service: SERVICIO, level: "info", message, extra } })
        .catch(() => {})
    } catch {
      // sin log, sigue igual
    }
  }

  const hooks: Hooks = {
    "experimental.text.complete": async (input, output) => {
      try {
        const r = limpiar(output.text)
        if (!r.cambio) return
        const antes = output.text.length
        output.text = r.texto
        anotar("saqué planificación en inglés de un texto del modelo", {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
          quitados: r.quitados.length,
          quedo_vacio: r.texto === "",
          caracteres_antes: antes,
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
          // Sólo lo que escribió el asistente: nunca el docente, nunca las tools
          // ni sus resultados (son partes "tool"), nunca el reasoning.
          // (Con `?.`: un mensaje raro se saltea, no corta la limpieza del resto.)
          if (msg?.info?.role !== "assistant" || !Array.isArray(msg.parts)) continue
          let cambio = false
          const parts = msg.parts.map((p) => {
            if (p.type !== "text" || !p.text) return p
            const texto = limpio(p.text)
            if (texto === p.text) return p
            cambio = true
            partes++
            // Se deja la parte con "" en vez de sacarla: es la misma forma que
            // deja text.complete, y el proveedor de Gemini (@ai-sdk/google)
            // descarta solo las partes de texto vacías. Sacar la parte movería
            // de lugar el reasoning firmado de otros proveedores.
            return { ...p, text: texto }
          })
          if (cambio) output.messages[i] = { ...msg, parts }
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
