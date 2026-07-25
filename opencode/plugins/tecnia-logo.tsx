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

// Tips propios de Tecnia Bot: en español, pensados para un docente que recién
// arranca. Reemplazan al tip por defecto de OpenCode ("Run /connect...") que
// confunde: aparece SIEMPRE porque el modelo gratis de OpenCode Zen cuenta como
// "sin proveedor", y le pide al docente conectar algo que ya viene listo.
const TIPS: string[] = [
  'Escribí "hola" y dejate guiar paso a paso',
  'Probá: "¿cómo prendo un LED con Arduino?"',
  'Pedí "armame el circuito de riego" y te lo dibuja',
  'Escribí "mostrame cómo funciona el protoboard"',
  'Escribí /diagnostico para revisar que todo esté listo',
  'Escribí /actualizar para traer la última versión',
]

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

function Art(props: { api: TuiPluginApi; nueva: string | null; version: string | null }) {
  const api = props.api
  // La versión va SIEMPRE presente bajo la marca: ayuda al docente y al soporte
  // ("¿qué versión tenés?" se ve de una). Fallback a la firma sola si no se pudo leer.
  const firma = props.version
    ? `un proyecto de Tecnia Lab · tecnialab.net.ar · v${props.version}`
    : "un proyecto de Tecnia Lab · tecnialab.net.ar"
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
        {firma}
      </text>
      {props.nueva ? (
        <text fg={pick(api, "warning", FALLBACK_GOLD)} attributes={TextAttributes.BOLD} selectable={false}>
          {`Hay una version nueva (v${props.nueva}) - escribi /actualizar`}
        </text>
      ) : null}
    </box>
  )
}

// Un solo tip propio (elegido al azar al cargar), con el mismo look que el tip
// nativo de OpenCode: viñeta en color de acento + texto legible.
function TipLine(props: { api: TuiPluginApi; tip: string }) {
  const api = props.api
  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={3}>
      <box flexDirection="row" maxWidth="100%">
        <text flexShrink={0} fg={pick(api, "warning", FALLBACK_GOLD)} selectable={false}>
          {"● Tip "}
        </text>
        <text flexShrink={1} wrapMode="word" fg={pick(api, "textMuted", FALLBACK_VIOLET)} selectable={false}>
          {props.tip}
        </text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  // Desactivamos el tip por defecto de OpenCode (`internal:home-tips`): con el
  // modelo gratis de Zen queda clavado en "Run /connect..." y confunde al docente.
  // Defensivo: si la API cambia entre versiones, no rompemos el arranque.
  try {
    await (api as { plugins?: { deactivate?: (id: string) => unknown } }).plugins?.deactivate?.("internal:home-tips")
  } catch {
    // sin drama: si no se pudo, en el peor caso convive el tip nativo
  }

  const version = versionInstalada()
  // Elegimos UN tip al azar por arranque (sin reactividad de solid, igual que la versión nueva).
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)] ?? TIPS[0]
  const nueva = await hayVersionNueva()

  api.slots.register({
    order: 100,
    slots: {
      home_logo() {
        return <Art api={api} nueva={nueva} version={version} />
      },
      home_bottom() {
        return <TipLine api={api} tip={tip} />
      },
    },
  })
}

export default {
  id: "tecnia.logo",
  tui,
}
