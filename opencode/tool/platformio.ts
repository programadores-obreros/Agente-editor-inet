/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

// PlatformIO casi nunca queda en el PATH tras instalarse (ni en Linux ni en Windows).
// Buscamos el binario en las rutas de instalación conocidas antes de caer al PATH.
let pioPathCache: string | null = null
function pioBin(): string {
  if (pioPathCache) return pioPathCache
  const home = homedir()
  const candidates =
    process.platform === "win32"
      ? [join(home, ".platformio", "penv", "Scripts", "pio.exe")]
      : [join(home, ".platformio", "penv", "bin", "pio")]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      pioPathCache = candidate
      return candidate
    }
  }
  pioPathCache = "pio" // fallback: confiar en el PATH del sistema
  return "pio"
}

async function run(cmd: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
  // Resolvemos "pio" a la ruta real del binario (PATH-independiente)
  if (cmd[0] === "pio") cmd = [pioBin(), ...cmd.slice(1)]
  try {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      ...(signal ? { signal } : {}),
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, stdout, stderr }
  } catch {
    return { code: 127, stdout: "", stderr: "command not found" }
  }
}

function traducirError(stderr: string, stdout: string): string {
  const texto = stderr + "\n" + stdout
  type Patron = [RegExp, string | ((m: RegExpMatchArray) => string)]
  const patrones: Patron[] = [
    [
      /'(.+?)' was not declared in this scope/,
      (m) =>
        `Usaste la variable o funcion '${m[1]}' pero no la declaraste antes. Revisa si esta bien escrita o si le falta declarar el tipo (ej: 'int ${m[1]}').`,
    ],
    [/expected ';' before/, "Falta un punto y coma `;` antes de esa linea. En Arduino/C++ cada instruccion termina con `;`."],
    [
      /fatal error:.*\.h: No such file or directory/,
      "No se encontro el archivo de la libreria. En `platformio.ini` agregala en `lib_deps`.",
    ],
    [
      /Please specify upload_port|Could not find serial port/,
      "No pude detectar el puerto del Arduino/ESP32. Desconectalo y volvelo a conectar, o ejecuta `/diagnostico` para ver los puertos disponibles.",
    ],
    [
      /command not found|is not recognized as an internal|exit code 127/,
      "PlatformIO no esta instalado o no esta en el PATH. Ejecuta `/diagnostico` para mas informacion.",
    ],
    [
      /Permission denied:.*\/dev\/tty/,
      "Sin permiso para usar el puerto serial. En Linux agregate al grupo del puerto (el nombre cambia segun la distro): en Debian/Ubuntu `sudo usermod -a -G dialout $USER`, en Arch/Manjaro `sudo usermod -a -G uucp $USER`. Despues cerra sesion y volve a entrar.",
    ],
    [
      /avrdude|not in sync|programmer is not responding/,
      "Problema al subir el codigo al Arduino. Verifica que el cable USB este bien conectado y que no haya otro programa usando el puerto.",
    ],
    [
      /Failed to connect to ESP32|Timed out waiting for packet header/,
      "El ESP32 no respondio. Apreta el boton BOOT mientras empieza la carga, soltalo cuando aparezca 'Connecting...'.",
    ],
    [
      /expected '}'|expected unqualified-id/,
      "Falta cerrar una llave `}` o hay un bloque mal cerrado. Revisa que cada `{` tenga su `}` correspondiente.",
    ],
    [
      /invalid conversion from|undefined reference to/,
      "Problema de tipos o funcion no definida. Verifica los tipos de tus variables y que todas las funciones esten implementadas.",
    ],
  ]

  for (const [patron, mensaje] of patrones) {
    const match = texto.match(patron)
    if (match) return typeof mensaje === "function" ? mensaje(match) : mensaje
  }

  const primeraLinea = texto.split("\n").find((l) => l.includes("error:")) ?? stderr.split("\n")[0] ?? ""
  return `Error de compilacion: ${primeraLinea}\n\nConsulta el skill 'errores-comunes' para mas ayuda.`
}

interface Device {
  port: string
  hwid?: string
  description?: string
}

async function detectPort(cwd: string, signal?: AbortSignal): Promise<{ port: string } | { error: string }> {
  const result = await run(["pio", "device", "list", "--json-output"], cwd, signal)

  let devices: Device[] = []
  try {
    devices = JSON.parse(result.stdout) as Device[]
  } catch {
    const isWindows = process.platform === "win32"
    const pattern = isWindows ? /COM\d+/g : /\/dev\/tty(?:USB|ACM)\d+/g
    const matches = result.stdout.match(pattern) ?? []
    devices = matches.map((port) => ({ port }))
  }

  const usbDevices = devices.filter((d) => /USB|VID|PID/i.test(d.hwid ?? ""))
  const candidates = usbDevices.length > 0 ? usbDevices : devices

  if (candidates.length === 0) {
    return {
      error: "No encontre ningun dispositivo conectado. Conecta el Arduino/ESP32 por USB y volve a intentar.",
    }
  }

  if (candidates.length === 1) {
    return { port: candidates[0].port }
  }

  const lista = candidates.map((d, i) => `${i + 1}. ${d.port}${d.description ? ` (${d.description})` : ""}`).join("\n")
  return {
    error: `Hay varios dispositivos conectados. Indicame cual es el tuyo:\n${lista}\n\nVolve a intentar con el parametro 'port' especificando el puerto que corresponde.`,
  }
}

function pioNoEncontrado() {
  return "PlatformIO no esta instalado o no se encuentra en el PATH.\n\nPara instalarlo: https://docs.platformio.org/en/latest/core/installation/"
}

export default tool({
  description: `Compilar y cargar codigo Arduino/ESP32 con PlatformIO. Detecta el puerto automaticamente.

Acciones:
- compile: compilar el proyecto actual
- flash: cargar el codigo en el dispositivo
- both: compilar y cargar en un solo paso
- monitor: instrucciones para abrir el monitor serial
- diagnostico: verificar entorno (PlatformIO instalado, dispositivos conectados)`,
  args: {
    action: tool.schema
      .enum(["compile", "flash", "both", "monitor", "diagnostico"])
      .describe("Accion a realizar"),
    port: tool.schema
      .string()
      .optional()
      .describe("Puerto serial explicito (ej: COM3, /dev/ttyUSB0). Se detecta automaticamente si no se indica."),
    environment: tool.schema
      .string()
      .optional()
      .describe("Environment del platformio.ini (ej: uno, esp32dev). Opcional."),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Ruta al proyecto PlatformIO. Por defecto usa el directorio actual."),
  },
  async execute(args, ctx) {
    const cwd = args.project_path ?? ctx.directory
    const signal = ctx.abort
    const envFlag = args.environment ? ["-e", args.environment] : []

    if (args.action !== "diagnostico") {
      const check = await run(["pio", "--version"], cwd, signal)
      if (check.code === 127 || check.stderr.includes("command not found") || check.stderr.includes("is not recognized")) {
        return pioNoEncontrado()
      }
    }

    switch (args.action) {
      case "compile": {
        const result = await run(["pio", "run", ...envFlag], cwd, signal)
        if (result.code === 0) return "Compilacion exitosa. El codigo esta listo para cargar al dispositivo."
        const traduccion = traducirError(result.stderr, result.stdout)
        return `Hubo un error al compilar:\n\n**Que significa:**\n${traduccion}\n\n**Error original:**\n\`\`\`\n${result.stderr.trim()}\n\`\`\``
      }

      case "flash": {
        let puerto = args.port
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
        }
        const result = await run(["pio", "run", "--target", "upload", "--upload-port", puerto, ...envFlag], cwd, signal)
        if (result.code === 0) return `Codigo cargado exitosamente en ${puerto}.`
        const traduccion = traducirError(result.stderr, result.stdout)
        return `Error al cargar el codigo:\n\n**Que significa:**\n${traduccion}\n\n**Error original:**\n\`\`\`\n${result.stderr.trim()}\n\`\`\``
      }

      case "both": {
        const compile = await run(["pio", "run", ...envFlag], cwd, signal)
        if (compile.code !== 0) {
          const traduccion = traducirError(compile.stderr, compile.stdout)
          return `Error al compilar (no se intento cargar):\n\n**Que significa:**\n${traduccion}\n\n**Error original:**\n\`\`\`\n${compile.stderr.trim()}\n\`\`\``
        }
        let puerto = args.port
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
        }
        const flash = await run(["pio", "run", "--target", "upload", "--upload-port", puerto, ...envFlag], cwd, signal)
        if (flash.code === 0) return `Compilacion y carga exitosa en ${puerto}.`
        const traduccion = traducirError(flash.stderr, flash.stdout)
        return `La compilacion fue bien pero hubo un error al cargar:\n\n**Que significa:**\n${traduccion}\n\n**Error original:**\n\`\`\`\n${flash.stderr.trim()}\n\`\`\``
      }

      case "monitor": {
        const portStr = args.port ? ` --port ${args.port}` : ""
        return `Para abrir el monitor serial, ejecuta este comando en tu terminal:\n\n\`\`\`\npio device monitor${portStr} --baud 9600\n\`\`\`\n\nSi no sabes el puerto, ejecuta \`/diagnostico\` primero.`
      }

      case "diagnostico": {
        const pioVersion = await run(["pio", "--version"], cwd, signal)
        const pioOk = pioVersion.code === 0
        const pioText = pioOk ? `OK — ${pioVersion.stdout.trim()}` : "NO encontrado"

        const os = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"

        let dispositivosText = "No disponible (PlatformIO no instalado)"
        if (pioOk) {
          const devResult = await run(["pio", "device", "list"], cwd, signal)
          dispositivosText = devResult.stdout.trim() || "Ninguno detectado"
        }

        let estado = "Listo para usar"
        if (!pioOk) {
          estado = "Falta instalar PlatformIO — https://docs.platformio.org/en/latest/core/installation/"
        } else if (dispositivosText === "Ninguno detectado") {
          estado = "Sin dispositivos conectados — conecta el Arduino/ESP32 por USB"
        }

        return `## Diagnostico del entorno

**PlatformIO:** ${pioText}

**Sistema operativo:** ${os}

**Dispositivos conectados:**
${dispositivosText}

**Estado general:** ${estado}`
      }
    }
  },
})
