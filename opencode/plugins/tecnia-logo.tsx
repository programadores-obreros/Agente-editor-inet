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

function Art(props: { api: TuiPluginApi }) {
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
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_logo() {
        return <Art api={api} />
      },
    },
  })
}

export default {
  id: "tecnia.logo",
  tui,
}
