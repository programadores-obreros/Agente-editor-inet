/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

/**
 * EL LIMITE DE LO QUE ESTA TOOL SABE, ESCRITO PARA QUE EL MODELO NO LO INVENTE.
 *
 * Un docente escribio "reparar tecnia bot", el modelo llamo a esta tool, y
 * contesto: "Revise la instalacion y ya estabas en la ultima version (v0.3.73),
 * CON PLATFORMIO Y TODO AL DIA".
 *
 * PlatformIO no estaba. Se instalo recien en el mensaje siguiente.
 *
 * La tool nunca dijo eso: devuelve la version y nada mas. El modelo tenia que
 * resumir "estas al dia" y lo estiro a "todo al dia", que suena igual y es otra
 * cosa. Donde dejamos un hueco lo llena con lo que suena bien -- es lo mismo que
 * paso con Visual Studio Code.
 *
 * Un OK falso es peor que un error: el docente se va tranquilo con el problema
 * intacto. Asi que el alcance viaja EN LA RESPUESTA, no en el prompt: el modelo
 * no puede afirmar sobre algo que la tool acaba de decirle que no miro.
 */
const LIMITE_ALCANCE =
  "\n\n_Esto mira SOLO la version de Tecnia Bot. No dice nada sobre PlatformIO, " +
  "Python ni las dependencias: para eso esta `/diagnostico`, y para instalarlas `/reparar`._"

const REPO = "programadores-obreros/Agente-editor-inet"

// Config global de OpenCode (donde vive la capa instalada y el manifest).
function configDir(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode")
}

// Lee el manifest que dejó el instalador: versión instalada + dónde está el repo.
function leerManifest(): { version: string; repoDir: string } | null {
  const m = join(configDir(), "tecnia-bot.manifest")
  if (!existsSync(m)) return null
  const txt = readFileSync(m, "utf8")
  const version = txt.match(/^version=(.*)$/m)?.[1]?.trim() ?? "desconocida"
  const repoDir = txt.match(/^repo_dir=(.*)$/m)?.[1]?.trim() ?? ""
  return { version, repoDir }
}

function partes(v: string): number[] {
  return v.split(".").map((n) => parseInt(n, 10) || 0)
}

// true si `b` es una versión MÁS NUEVA que `a` (compara X.Y.Z numéricamente).
function esMasNueva(a: string, b: string): boolean {
  const pa = partes(a)
  const pb = partes(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}

// Cuánto se espera a GitHub antes de darse por vencido. En una escuela con
// GitHub filtrado, el pedido no falla: se queda colgado, y el docente ve al bot
// "pensando" para siempre. Ocho segundos alcanzan para cualquier red que anda.
// Se puede acortar por variable de entorno (lo usan los tests).
function timeoutRedMs(): number {
  const n = Number(process.env.TECNIA_ACTUALIZAR_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 8000
}

// Cómo terminó la consulta a GitHub. "sinRed" es distinto de "no hay versión":
// el mensaje al docente tiene que decir que la RED no dejó, no que no existe.
type Consulta = { version: string | null; sinRed: boolean }

// Última versión PUBLICADA: el release que GitHub marca como "Latest" (ni draft
// ni prerelease), por la API. Es la MISMA fuente que usa install/update.{ps1,sh}
// para elegir qué bajar: si acá dijéramos "hay una nueva" leyendo el VERSION de
// la rama main (código sin publicar todavía), /actualizar contestaría "ya estás
// en la última" y el docente vería al bot contradecirse.
async function ultimaVersionPublicada(): Promise<Consulta> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "tecnia-bot-actualizar" },
      signal: AbortSignal.timeout(timeoutRedMs()),
    })
    if (!res.ok) return { version: null, sinRed: false }
    const tag = String((await res.json())?.tag_name ?? "").trim()
    const v = tag.replace(/^v/, "")
    return { version: /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v) ? v : null, sinRed: false }
  } catch {
    // Timeout, DNS que no resuelve, proxy que corta: todo es "no se llegó".
    return { version: null, sinRed: true }
  }
}

const SIN_RED =
  "No pude consultar GitHub (no respondió a tiempo). Puede ser que no haya Internet, " +
  "o que la red de la escuela bloquee GitHub: probá desde otra red, o pedile al referente técnico."

// Corre el actualizador y devuelve código + salida, sin colgarse ni reventar.
//
// El ORDEN importa: stdout y stderr se leen ANTES de esperar `exited`. Al revés
// --esperar que termine y recién ahí leer-- el proceso se bloquea cuando llena
// el buffer del pipe (unos 64 KB, que update.ps1 supera en una descarga con
// progreso), y el tool se queda esperando a un proceso que espera al tool.
// Es el mismo patrón que `run()` en platformio.ts.
async function correr(cmd: string[], cwd: string): Promise<{ code: number; out: string; err: string } | null> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, out, err }
  } catch {
    // powershell/bash fuera del PATH, bloqueado por política o por antivirus:
    // el proceso ni arrancó. No hay código de salida que mostrar.
    return null
  }
}

export default tool({
  description:
    'Muestra la versión instalada de Tecnia Bot, verifica si hay una versión nueva, y/o actualiza al último release PUBLICADO (nunca código sin publicar). Con verificar=true SOLO chequea (no instala nada) — usalo cuando pregunten "¿qué versión tengo?", "¿estoy actualizado?", "¿hay versión nueva?". Sin verificar (o false), ACTUALIZA de verdad — usalo cuando pidan "actualizar", "actualizate", "traer lo último".',
  args: {
    verificar: tool.schema
      .boolean()
      .optional()
      .describe("true = solo revisa la versión y si hay una más nueva, sin instalar nada. false u omitido = actualiza de verdad."),
  },
  async execute(args) {
    const info = leerManifest()
    if (!info) {
      return "No encontré el registro de instalación (manifest). Reinstalá Tecnia Bot con el instalador (bootstrap)."
    }

    // --- Modo VERIFICAR: solo compara versiones, no toca nada ---
    if (args.verificar) {
      const { version: ultima, sinRed } = await ultimaVersionPublicada()
      if (sinRed) {
        return `Tenés Tecnia Bot **v${info.version}**. ${SIN_RED}` + LIMITE_ALCANCE
      }
      if (!ultima) {
        return `Tenés Tecnia Bot **v${info.version}**. No pude verificar si hay una versión más nueva (GitHub respondió algo que no entiendo; probá de nuevo en un rato).` + LIMITE_ALCANCE
      }
      if (esMasNueva(info.version, ultima)) {
        return `Tenés la **v${info.version}** y hay una más nueva disponible: **v${ultima}**. Escribí \`/actualizar\` (o pedime "actualizate") para ponerte al día.` + LIMITE_ALCANCE
      }
      return `Tenés Tecnia Bot **v${info.version}** — estás al día. 🎉` + LIMITE_ALCANCE
    }

    // --- Modo ACTUALIZAR: install/update.{ps1,sh} baja el último release publicado,
    // verifica que lo bajado sea esa versión, y recién ahí reinstala. Si algo falla,
    // deja la copia instalada como estaba. ---
    if (!info.repoDir || !existsSync(info.repoDir)) {
      return `Tenés la versión ${info.version}. No encuentro la carpeta del proyecto${info.repoDir ? ` (${info.repoDir})` : ""} para actualizar. Volvé a descargar el proyecto desde GitHub y corré el instalador.` + LIMITE_ALCANCE
    }

    const win = process.platform === "win32"
    const cmd = win
      ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(info.repoDir, "install", "update.ps1")]
      : ["bash", join(info.repoDir, "install", "update.sh")]

    const r = await correr(cmd, info.repoDir)
    if (!r) {
      return (
        `No pude lanzar el actualizador (${win ? "PowerShell" : "bash"} no arrancó: puede estar fuera del PATH, ` +
        `bloqueado por una política de la escuela o por el antivirus). Tenés la versión ${info.version}, que quedó como estaba.\n\n` +
        `Probá correr a mano: ${cmd.join(" ")}` +
        LIMITE_ALCANCE
      )
    }
    const { code, out, err } = r

    if (code !== 0) {
      return `No pude actualizar (código ${code}).\n\n${(err || out).slice(-800)}\n\nProbá correr a mano: ${cmd.join(" ")}`
    }

    const nueva = leerManifest()?.version ?? info.version
    const cambio =
      nueva === info.version
        ? `Ya estabas al día: versión ${nueva}.`
        : `¡Actualizado! De la versión ${info.version} a la ${nueva} (último release publicado).`
    return `${cambio}\n\n⚠️ Reiniciá OpenCode para que los cambios tomen efecto.\n\n${out.slice(-400)}`
  },
})
