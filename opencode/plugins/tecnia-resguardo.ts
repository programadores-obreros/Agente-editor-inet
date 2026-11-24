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
// ============================================================================
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { conResguardo, esperaPorDefecto, REINTENTOS_POR_DEFECTO, type Buscar } from "./resguardo/google.ts"

const SERVICIO = "tecnia-resguardo"

type ConProveedores = { provider?: Record<string, { options?: Record<string, unknown> } | undefined> }

const server: Plugin = async ({ client }) => {
  const anotar = (message: string, extra?: Record<string, unknown>) => {
    void client.app.log({ body: { service: SERVICIO, level: "warn", message, extra } }).catch(() => {})
  }
  return {
    config: async (config) => {
      const cfg = config as ConProveedores
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
