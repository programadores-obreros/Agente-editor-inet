/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"

// Ayuda de Tecnia Bot: muestra un resumen rapido en el chat y abre el manual
// completo (offline) en el navegador. El manual es un HTML self-contained que se
// instala con la capa (tecniabot-web/manual.html).
function manualPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  // Micro-sitio de onboarding (multi-página, offline, paths relativos → anda con file://).
  return join(cfg, "opencode", "tecniabot-web", "sitio", "index.html")
}

// Abre el manual en el navegador por defecto, sin bloquear la tool (best-effort).
function abrirEnNavegador(archivo: string): boolean {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", archivo]
        : process.platform === "darwin"
          ? ["open", archivo]
          : ["xdg-open", archivo]
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    proc.unref()
    return true
  } catch {
    return false
  }
}

const RESUMEN = `**Tecnia Bot — cómo usarlo, en 30 segundos:**

Escribime en español, con tus palabras. Podés pedirme, por ejemplo:
- *"¿cómo funciona un LED con Arduino?"* — te explico el concepto
- *"dibujame el circuito de un servo con ESP32"* — te lo abro en el navegador (sin internet)
- *"quiero armar el semáforo paso a paso"* — te guío y me acuerdo dónde quedaste
- *"cargá este código al ESP32"* — compilo y lo subo a tu placa
- *"abrí el monitor serial"* — para ver los datos de la placa
- *"dame los materiales del semáforo para imprimir"* — una hoja para el aula
- *"dame algo para repartir del LDR"* — te abro la ficha A4 lista para imprimir
- *"¿puedo prenderlo?"* — te chequeo la seguridad antes de dar corriente

Comandos: \`/diagnostico\` (revisa que todo esté listo) · \`/actualizar\` (última versión).`

export default tool({
  description: `Muestra la ayuda de Tecnia Bot: un resumen rapido de como usarlo (en el chat) y abre el manual completo en el navegador (offline). Usalo cuando el usuario pida ayuda, no sepa por donde empezar, pregunte "que podes hacer" o escriba /ayuda.`,
  args: {},
  async execute() {
    const ruta = manualPath()
    const abierto = existsSync(ruta) && abrirEnNavegador(ruta)
    const manual = abierto
      ? "\n\n📖 **Te abrí el manual completo en el navegador** (con más ejemplos y qué hacer si algo falla)."
      : `\n\n📖 El manual completo está en \`file://${ruta}\` (doble clic para abrirlo).`
    return RESUMEN + manual
  },
})
