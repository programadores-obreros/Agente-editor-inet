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

// Envuelve un valor entre comillas dobles solo si contiene espacios (o esta vacio).
// Sirve tanto para cmd de Windows como para shells POSIX en rutas normales.
function quoteIfNeeded(value: string): string {
  return value === "" || /\s/.test(value) ? `"${value}"` : value
}

// Lanza un proceso de forma "detached": no esperamos su salida ni bloqueamos la tool.
// Se usa para abrir una ventana de terminal aparte (Linux/Mac) sin colgar `run()`.
function launchDetached(cmd: string[], cwd: string): boolean {
  try {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    proc.unref()
    return true
  } catch {
    return false
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

/**
 * Qué chip USB-serial hay del otro lado del cable, según su VID:PID.
 *
 * POR QUÉ IMPORTA ESTO EN UN AULA. Un docente conecta la placa y no pasa nada.
 * El problema casi nunca es la placa: es que Windows no trae el driver del chip
 * USB-serial que usan los clones baratos —el CH340— y sin driver no aparece
 * ningún puerto. Decirle "no encuentro tu Arduino" no lo ayuda; decirle "es un
 * CH340 y le falta el driver, bajalo de acá" lo desbloquea en dos minutos.
 *
 * Y HAY UN SEGUNDO PROBLEMA, más silencioso: `pio device list` devuelve TODOS
 * los puertos serie, no sólo las placas. En una máquina virtual aparece un COM1
 * emulado (`ACPI\PNP0501`) que no es nada — y el diagnóstico anterior lo contaba
 * como "dispositivo conectado". El docente veía todo en verde y la carga fallaba.
 *
 * Lo que NO se puede saber por el VID:PID es QUÉ PLACA es: un CH340 puede ser un
 * Arduino clon, un ESP32 o un ESP8266 — el chip serial es el mismo. Por eso
 * `placa` dice lo que se sabe y nada más, sin adivinar.
 */
const CHIPS_USB: Array<{
  vid: string
  pid?: string
  chip: string
  placa: string
  driverWindows?: string
}> = [
  {
    vid: "1A86",
    chip: "CH340 / CH341",
    placa: "clon de Arduino, o un ESP32/ESP8266",
    driverWindows: "https://www.wch-ic.com/downloads/CH341SER_EXE.html",
  },
  {
    vid: "10C4",
    pid: "EA60",
    chip: "CP2102 (Silicon Labs)",
    placa: "muy común en placas ESP32 DevKit",
    driverWindows: "https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers",
  },
  {
    vid: "0403",
    chip: "FTDI",
    placa: "Arduino Nano viejo, o una placa con FTDI",
    driverWindows: "https://ftdichip.com/drivers/vcp-drivers/",
  },
  { vid: "2341", chip: "el propio de Arduino", placa: "Arduino oficial" },
  { vid: "2A03", chip: "el propio de Arduino", placa: "Arduino (arduino.org)" },
  { vid: "303A", chip: "USB nativo de Espressif", placa: "ESP32-S2, S3 o C3" },
]

/** Los puertos serie que NO son una placa: los trae la máquina, no el cable. */
const NO_ES_PLACA = /ACPI\\PNP|BTHENUM|\\VIRTUAL/i

/**
 * Lee el `hwid` que devuelve PlatformIO y dice qué es.
 *
 * Exportada para poder probarla con hwids reales sin tener la placa enchufada.
 */
export function identificar(
  hwid?: string,
  descripcion?: string,
): { esPlaca: boolean; chip?: string; placa?: string; driverWindows?: string; motivo?: string } {
  const id = (hwid ?? "").toUpperCase()

  if (!id) return { esPlaca: false, motivo: "el sistema no informa qué es" }

  if (NO_ES_PLACA.test(id)) {
    return {
      esPlaca: false,
      motivo: "es un puerto serie de la propia máquina, no una placa conectada",
    }
  }

  /*
   * DOS FORMATOS, y hay que aceptar los dos.
   *
   *   Linux / pyserial   USB VID:PID=1A86:7523 LOCATION=1-1
   *   Windows crudo      USB\VID_1A86&PID_7523\5&1D2A3B4C&0&2
   *
   * El primero pone los dos números juntos después del `=`; el segundo, cada uno
   * detrás de su etiqueta. Una regex sola no cubre los dos, y quedarse con la de
   * Windows —que fue lo que hice primero— deja ciega a la mitad de las máquinas.
   */
  const junto = id.match(/VID:PID=([0-9A-F]{4}):([0-9A-F]{4})/)
  const vid = junto?.[1] ?? id.match(/VID_([0-9A-F]{4})/)?.[1]
  const pid = junto?.[2] ?? id.match(/PID_([0-9A-F]{4})/)?.[1]

  if (!vid) {
    return {
      esPlaca: false,
      motivo: "no tiene identificador USB, así que no llegó por un cable USB",
    }
  }

  const conocido = CHIPS_USB.find((c) => c.vid === vid && (!c.pid || c.pid === pid))
  if (conocido) {
    return {
      esPlaca: true,
      chip: conocido.chip,
      placa: conocido.placa,
      driverWindows: conocido.driverWindows,
    }
  }

  // USB pero de un fabricante que no está en la tabla: probablemente sirve igual.
  return {
    esPlaca: true,
    chip: `USB ${vid}${pid ? ":" + pid : ""}`,
    placa: descripcion || "no está en mi lista, pero es un dispositivo USB",
  }
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

  /*
   * SÓLO PLACAS, y nunca "lo que haya".
   *
   * Antes esto era `usbDevices.length > 0 ? usbDevices : devices`: si no había
   * ninguna placa, caía a TODOS los puertos serie y elegía el primero. En una
   * máquina virtual eso es el COM1 emulado (`ACPI\PNP0501`), que no es nada — y
   * la carga fallaba con un error de PlatformIO en vez de con un "no hay ninguna
   * placa conectada", que es la verdad y lo que el docente necesita leer.
   */
  const candidates = devices.filter((d) => identificar(d.hwid, d.description).esPlaca)

  if (candidates.length === 0) {
    const otros = devices.filter((d) => !identificar(d.hwid, d.description).esPlaca)
    const detalle =
      otros.length > 0
        ? ` Veo ${otros.length === 1 ? "un puerto serie" : `${otros.length} puertos serie`} (${otros
            .map((d) => d.port)
            .join(", ")}), pero ${otros.length === 1 ? "no es" : "ninguno es"} una placa: ${
            identificar(otros[0].hwid, otros[0].description).motivo
          }.`
        : ""
    return {
      error:
        `No encuentro ninguna placa conectada. Conectá el Arduino o el ESP32 por USB y probá de nuevo.${detalle}` +
        ` Si la placa está enchufada y sigo sin verla, corré \`/diagnostico\`: puede faltarle el driver.`,
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
- monitor: abre una ventana de terminal aparte con el monitor serial ya corriendo (puerto y baudios automaticos). NO requiere un proyecto ni codigo cargado: sirve para ver los datos que manda la placa y para mandarle teclas (ej: comandar un servo desde el teclado). Cuando el usuario pida "ver el monitor serial", "abrir la terminal serial" o similar, llama a esta accion DIRECTAMENTE, sin pedir ni crear un proyecto.
- diagnostico: verificar entorno (PlatformIO instalado, dispositivos conectados)`,
  args: {
    action: tool.schema
      .enum(["compile", "flash", "both", "monitor", "diagnostico"])
      .describe("Accion a realizar"),
    port: tool.schema
      .string()
      .optional()
      .describe("Puerto serial explicito (ej: COM3, /dev/ttyUSB0). Se detecta automaticamente si no se indica."),
    baud: tool.schema
      .number()
      .optional()
      .describe(
        "Velocidad del monitor serial en baudios (default 9600). Debe coincidir con el valor de Serial.begin(...) del sketch (ej: 115200 para muchos ESP32).",
      ),
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
        const baud = args.baud ?? 9600

        // Resolvemos el puerto automaticamente (el docente no tiene que saber que es COM3).
        let puerto = args.port
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) {
            // detected.error ya trae el mensaje completo (sin placa -> pedi conectar USB;
            // varias placas -> elegi el puerto). No lo dupliquemos.
            return `Para abrir el monitor serial primero necesito la placa.\n\n${detected.error}`
          }
          puerto = detected.port
        }

        const pioPath = pioBin()
        // Comando "pelado" listo para copiar y pegar en una terminal (fallback / instrucciones).
        const comandoManual = `${quoteIfNeeded(pioPath)} device monitor --port ${puerto} --baud ${baud}`

        const mensajeExito = `Abri una ventana nueva (negra) con el monitor serial en ${puerto} a ${baud} baudios. Ahi vas a ver los datos de la placa y podes apretar teclas para comandarla. Para cerrarlo, apreta Ctrl+C en esa ventana.`

        const mensajeManual = `No pude abrir una ventana nueva automaticamente en este equipo, pero es facil hacerlo a mano:

1. Abri una terminal (en Windows busca "cmd"; en Mac/Linux busca "Terminal").
2. Copia y pega este comando, despues apreta Enter:

\`\`\`
${comandoManual}
\`\`\`

Vas a ver los datos de la placa en ${puerto} a ${baud} baudios. Para cerrarlo, apreta Ctrl+C en esa ventana.`

        // Windows: `start` abre una ventana nueva y vuelve al instante, asi que `run()` no cuelga.
        // El primer argumento entre comillas de `start` es el TITULO de la ventana, por eso va
        // siempre un titulo antes de la ruta de pio (que puede tener espacios, ej: "Maria Jose").
        if (process.platform === "win32") {
          const titulo = `Monitor Serial - ${puerto}`
          const res = await run(
            ["cmd", "/c", "start", titulo, "cmd", "/k", pioPath, "device", "monitor", "--port", puerto, "--baud", String(baud)],
            cwd,
            signal,
          )
          return res.code === 0 ? mensajeExito : mensajeManual
        }

        // Mac: le pedimos a Terminal.app que corra el comando en una ventana nueva via AppleScript.
        if (process.platform === "darwin") {
          const shellCmd = `${quoteIfNeeded(pioPath)} device monitor --port ${quoteIfNeeded(puerto)} --baud ${baud}`
          const escapado = shellCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
          const script = `tell application "Terminal" to do script "${escapado}"`
          return launchDetached(["osascript", "-e", script], cwd) ? mensajeExito : mensajeManual
        }

        // Linux: probamos emuladores de terminal comunes en orden hasta encontrar uno instalado.
        const inner = [pioPath, "device", "monitor", "--port", puerto, "--baud", String(baud)]
        const emuladores: Array<{ bin: string; args: (cmd: string[]) => string[] }> = [
          { bin: "x-terminal-emulator", args: (c) => ["-e", ...c] },
          { bin: "gnome-terminal", args: (c) => ["--", ...c] },
          { bin: "konsole", args: (c) => ["-e", ...c] },
          { bin: "xterm", args: (c) => ["-e", ...c] },
        ]
        for (const emu of emuladores) {
          if (Bun.which(emu.bin) && launchDetached([emu.bin, ...emu.args(inner)], cwd)) {
            return mensajeExito
          }
        }
        return mensajeManual
      }

      case "diagnostico": {
        const pioVersion = await run(["pio", "--version"], cwd, signal)
        const pioOk = pioVersion.code === 0
        const pioText = pioOk ? `OK — ${pioVersion.stdout.trim()}` : "NO encontrado"

        const os = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"

        /*
         * ANTES ACÁ SE PEGABA LA SALIDA CRUDA de `pio device list`, y mentía por
         * omisión: en una máquina virtual aparece un COM1 emulado y el reporte
         * decía "dispositivos conectados: COM1". El docente leía todo en verde,
         * intentaba cargar, y fallaba sin entender por qué.
         *
         * Ahora cada puerto se clasifica: cuál es una placa, cuál es un puerto de
         * la propia máquina, y qué driver falta cuando no aparece ninguna.
         */
        let dispositivosText = "No disponible (PlatformIO no instalado)"
        let placas = 0

        if (pioOk) {
          const devResult = await run(["pio", "device", "list", "--json-output"], cwd, signal)
          let devices: Device[] = []
          try {
            devices = JSON.parse(devResult.stdout) as Device[]
          } catch {
            devices = []
          }

          if (devices.length === 0) {
            dispositivosText = "Ninguno — no hay ni siquiera un puerto serie"
          } else {
            dispositivosText = devices
              .map((d) => {
                const q = identificar(d.hwid, d.description)
                if (!q.esPlaca) return `- \`${d.port}\` — no es una placa (${q.motivo})`
                placas++
                const drv = q.driverWindows && os === "Windows" ? ` · driver: ${q.driverWindows}` : ""
                return `- \`${d.port}\` — **placa**, chip ${q.chip} (${q.placa})${drv}`
              })
              .join("\n")
          }
        }

        let estado = placas === 1 ? "Listo para usar" : `Listo — veo ${placas} placas conectadas`
        if (!pioOk) {
          estado = "Falta instalar PlatformIO — https://docs.platformio.org/en/latest/core/installation/"
        } else if (placas === 0) {
          const ayuda =
            os === "Windows"
              ? " Si está enchufada y no aparece, casi siempre falta el driver del **CH340**, el chip de los clones baratos: https://www.wch-ic.com/downloads/CH341SER_EXE.html"
              : os === "Linux"
                ? " Si está enchufada y no aparece, puede ser permiso del puerto: `sudo usermod -a -G dialout $USER` (o `uucp` en Arch/Manjaro), y volvé a iniciar sesión."
                : ""
          estado = `**Ninguna placa conectada.** Enchufá el Arduino o el ESP32 por USB.${ayuda}`
        }

        return `## Diagnóstico del entorno

**PlatformIO:** ${pioText}

**Sistema operativo:** ${os}

**Puertos que veo:**
${dispositivosText}

**Estado general:** ${estado}`
      }
    }
  },
})
