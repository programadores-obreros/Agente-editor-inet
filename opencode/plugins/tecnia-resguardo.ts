// ============================================================================
// Tecnia Bot — plugin de servidor que pone el resguardo ante el corte de Google
// a mitad de respuesta (ver resguardo/google.ts: el porqué, lo medido y cómo
// decide).
//
// CÓMO SE ENGANCHA (medido en OpenCode 1.18.18, Linux y Windows, 2026-11-24):
// el hook `config` recibe la configuración ya unida, y lo que se deja en
// `provider.google.options.fetch` es el `fetch` que usa el SDK de Google para
// TODOS sus pedidos (el del título de la charla y el principal). OpenCode
// acepta una función ahí: la configuración no se serializa entre este hook y
// el proveedor.
//
// Se carga solo, igual que tecnia-idioma.ts: OpenCode levanta `plugins/*.ts`
// del config y exige `export default { id, server }`. La lógica vive en la
// subcarpeta resguardo/ porque ese glob no baja a subcarpetas.
//
// Si ya había un `fetch` puesto (otro plugin, o el docente), se lo envuelve en
// vez de pisarlo.
//
// SÓLO SI SE USA GOOGLE. Medido en 1.18.18: crear `provider.google` en la
// configuración de alguien que no tiene key de Google hace que `opencode models`
// le liste 25 modelos de Google como disponibles (sin el plugin: ninguno). Por
// eso el resguardo se pone únicamente si la configuración ya nombra a Google:
// una sección `provider.google`, o un `model` que empieza con `google/` (el del
// agente o el general; el instalador lo escribe cuando hay key). Lo que queda
// afuera: quien no tiene nada de eso y elige un modelo de Google a mano desde
// la TUI en esa sesión.
//
// El resguardo sólo mira los pedidos `:streamGenerateContent`; el resto pasa
// sin tocar.
//
// De este archivo sólo sale el `default`: un export suelto que sea función lo
// tomaría el cargador viejo de OpenCode por otro plugin. Por eso `usaGoogle`
// vive en resguardo/google.ts.
// ============================================================================
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import {
  conResguardo,
  esperaPorDefecto,
  REINTENTOS_POR_DEFECTO,
  usaGoogle,
  type Buscar,
  type ConProveedores,
} from "./resguardo/google.ts"

const SERVICIO = "tecnia-resguardo"

const server: Plugin = async ({ client }) => {
  const anotar = (message: string, extra?: Record<string, unknown>) => {
    // Un registro que falla no puede voltear la respuesta: se descarta el fallo, también si es síncrono.
    try {
      void client.app.log({ body: { service: SERVICIO, level: "warn", message, extra } }).catch(() => {})
    } catch {}
  }
  return {
    config: async (config) => {
      const cfg = config as ConProveedores
      if (!usaGoogle(cfg)) return
      cfg.provider ??= {}
      const google = (cfg.provider.google ??= {})
      const opciones = (google.options ??= {})
      const previo = typeof opciones.fetch === "function" ? (opciones.fetch as Buscar) : (fetch as Buscar)
      opciones.fetch = conResguardo(previo, {
        reintentos: REINTENTOS_POR_DEFECTO,
        esperaMs: esperaPorDefecto,
        anotar,
      })
    },
  }
}

export default { id: SERVICIO, server } satisfies PluginModule
