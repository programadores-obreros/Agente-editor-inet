/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

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

export default tool({
  description:
    'Actualiza Tecnia Bot a la última versión: baja lo nuevo del repositorio y reinstala la capa educativa (limpiando los archivos viejos). Usalo cuando el usuario pida "actualizar", "actualizate", "traer lo último" o "¿hay versión nueva?".',
  args: {},
  async execute() {
    const info = leerManifest()
    if (!info) {
      return "No encontré el registro de instalación (manifest). Reinstalá Tecnia Bot con el instalador (bootstrap)."
    }
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
