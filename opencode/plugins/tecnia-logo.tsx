/** @jsxImportSource @opentui/solid */
// ============================================================================
// Tecnia Bot — plugin de TUI que reemplaza el logo del splash de OpenCode
// por la identidad de marca (robot + wordmark "TECNIA BOT", en violeta).
//
// Se declara en ~/.config/opencode/tui.json ("plugin": ["./plugins/tecnia-logo.tsx"]).
// Bun transpila este .tsx en runtime: NO hay que compilar ni empaquetar nada.
// Los `import type` se borran al transpilar; los tipos los resuelve el
// @opencode-ai/plugin que OpenCode auto-instala a la version del binario, asi
// que matchean la version que corre el docente.
//
// Defensivo: los colores se leen del theme activo (api.theme.current) con
// fallback al violeta de marca, para no romper si un campo cambia entre versiones.
// ============================================================================
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA, TextAttributes } from "@opentui/core"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

// Robot en arte Unicode. Solo caracteres presentes en la fuente de consola de
// Windows (Consolas): bloques █ y box-drawing ━┃┏┓┗┛┻╻. Nada de ◕/‿ (salen □).
const ROBOT = [
  "   ╻     ╻",
  " ┏━┻━━━━━┻━┓",
  " ┃ █     █ ┃",
  " ┃  ━━━━━  ┃",
  " ┗━━━━━━━━━┛",
]

// Wordmark "TECNIA BOT" en bloques (generado, filas alineadas).
const WORDMARK = [
  "█████  █████   ████  █   █  ███   ███     ████    ███   █████",
  "  █    █      █      ██  █   █   █   █    █   █  █   █    █",
  "  █    ████   █      █ █ █   █   █████    ████   █   █    █",
  "  █    █      █      █  ██   █   █   █    █   █  █   █    █",
  "  █    █████   ████  █   █  ███  █   █    ████    ███     █",
]

const FALLBACK_VIOLET = RGBA.fromInts(167, 139, 250) // #a78bfa
const FALLBACK_VIOLET_DEEP = RGBA.fromInts(139, 92, 246) // #8b5cf6
const FALLBACK_GOLD = RGBA.fromInts(255, 194, 36) // #ffc224

function pick(api: TuiPluginApi, key: string, fallback: RGBA): RGBA {
  const c = api.theme?.current as Record<string, RGBA> | undefined
  return (c && c[key]) || fallback
}

const REPO = "programadores-obreros/Agente-editor-inet"

// Versión instalada, leída del manifest que dejó el instalador.
function versionInstalada(): string | null {
  try {
    const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
    const m = join(cfg, "opencode", "tecnia-bot.manifest")
    if (!existsSync(m)) return null
    return readFileSync(m, "utf8").match(/^version=(.*)$/m)?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

// true si `b` es más nueva que `a` (compara X.Y.Z numéricamente).
function esMasNueva(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}

// Chequeo suave de versión, hecho UNA vez al cargar el plugin (la función `tui`
// es async, se espera al iniciar). Sin reactividad de solid-js (que NO resuelve
// en un plugin externo): se calcula acá y se pasa como prop simple.
// Timeout de 1.5s para no colgar el arranque si no hay internet.
async function hayVersionNueva(): Promise<string | null> {
  try {
    const inst = versionInstalada()
    if (!inst) return null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/VERSION`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const ult = (await res.text()).trim()
    return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(ult) && esMasNueva(inst, ult) ? ult : null
  } catch {
    return null // sin internet / timeout: no avisamos nada
  }
}

function Art(props: { api: TuiPluginApi; nueva: string | null }) {
  const api = props.api
  return (
    <box flexDirection="column" alignItems="center">
      {ROBOT.map((line) => (
        <text fg={pick(api, "accent", FALLBACK_VIOLET_DEEP)} selectable={false}>
          {line}
        </text>
      ))}
      <box height={1} />
      {WORDMARK.map((line) => (
        <text fg={pick(api, "primary", FALLBACK_VIOLET)} attributes={TextAttributes.BOLD} selectable={false}>
          {line}
        </text>
      ))}
      <box height={1} />
      <text fg={pick(api, "textMuted", FALLBACK_GOLD)} selectable={false}>
        un proyecto de Tecnia Lab · tecnialab.net.ar
      </text>
      {props.nueva ? (
        <text fg={pick(api, "warning", FALLBACK_GOLD)} attributes={TextAttributes.BOLD} selectable={false}>
          {`Hay una version nueva (v${props.nueva}) - escribi /actualizar`}
        </text>
      ) : null}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const nueva = await hayVersionNueva()
  api.slots.register({
    order: 100,
    slots: {
      home_logo() {
        return <Art api={api} nueva={nueva} />
      },
    },
  })
}

export default {
  id: "tecnia.logo",
  tui,
}
