/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

const REPO_URL = "https://github.com/programadores-obreros/Agente-editor-inet.git"

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

// Última versión publicada, vía protocolo git (NO usa la API de GitHub, así que
// no se choca con el límite de 60 pedidos/hora por IP).
async function ultimaVersionPublicada(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "ls-remote", "--tags", REPO_URL, "v*"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    const out = await new Response(proc.stdout).text()
    const tags = [...out.matchAll(/refs\/tags\/v([0-9]+\.[0-9]+\.[0-9]+)/g)].map((m) => m[1])
    if (!tags.length) return null
    let max = tags[0]!
    for (const t of tags) if (esMasNueva(max, t)) max = t // nos quedamos con la más nueva
    return max
  } catch {
    return null
  }
}

export default tool({
  description:
    'Muestra la versión instalada de Tecnia Bot, verifica si hay una versión nueva, y/o actualiza a la última. Con verificar=true SOLO chequea (no instala nada) — usalo cuando pregunten "¿qué versión tengo?", "¿estoy actualizado?", "¿hay versión nueva?". Sin verificar (o false), ACTUALIZA de verdad — usalo cuando pidan "actualizar", "actualizate", "traer lo último".',
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
      const ultima = await ultimaVersionPublicada()
      if (!ultima) {
        return `Tenés Tecnia Bot **v${info.version}**. No pude verificar si hay una versión más nueva (revisá tu conexión a Internet).`
      }
      if (esMasNueva(info.version, ultima)) {
        return `Tenés la **v${info.version}** y hay una más nueva disponible: **v${ultima}**. Escribí \`/actualizar\` (o pedime "actualizate") para ponerte al día.`
      }
      return `Tenés Tecnia Bot **v${info.version}** — estás al día. 🎉`
    }

    // --- Modo ACTUALIZAR: baja lo nuevo y reinstala ---
    if (!info.repoDir || !existsSync(info.repoDir)) {
      return `Tenés la versión ${info.version}. No encuentro la carpeta del proyecto${info.repoDir ? ` (${info.repoDir})` : ""} para actualizar. Volvé a descargar el proyecto desde GitHub y corré el instalador.`
    }

    const win = process.platform === "win32"
    const cmd = win
      ? ["powershell", "-ExecutionPolicy", "Bypass", "-File", join(info.repoDir, "install", "update.ps1")]
      : ["bash", join(info.repoDir, "install", "update.sh")]

    const proc = Bun.spawn(cmd, { cwd: info.repoDir, stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()

    if (code !== 0) {
      return `No pude actualizar (código ${code}).\n\n${(err || out).slice(-800)}\n\nProbá correr a mano: ${cmd.join(" ")}`
    }

    const nueva = leerManifest()?.version ?? info.version
    const cambio =
      nueva === info.version
        ? `Ya estabas al día: versión ${nueva}.`
        : `¡Actualizado! De la versión ${info.version} a la ${nueva}.`
    return `${cambio}\n\n⚠️ Reiniciá OpenCode para que los cambios tomen efecto.\n\n${out.slice(-400)}`
  },
})
