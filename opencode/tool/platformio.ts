/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, win32 } from "node:path"

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

// PlatformIO casi nunca queda en el PATH tras instalarse (ni en Linux ni en Windows).
// Buscamos el binario en las rutas de instalación conocidas antes de caer al PATH.
//
// Solo se cachea una ruta REAL. La primera version cacheaba tambien el fallback
// "pio": si el tool arrancaba sin PlatformIO, se quedaba con "pio" para siempre y
// despues de que `reparar` lo instalara seguia sin encontrarlo (y `compile`
// fallaba hasta reiniciar OpenCode).
let pioPathCache: string | null = null

/** Saca vacíos y repetidos preservando el orden: el primero que aparece manda. */
const unicos = (xs: Array<string | undefined>): string[] => [
  ...new Set(xs.filter((x): x is string => typeof x === "string" && x.trim() !== "")),
]

/**
 * TRES LUGARES DONDE BUSCAR, NO UNO — la misma lección que el lanzador aprendió
 * buscando OpenCode (`installer/abrir-tecnia-bot.cmd`) y que este comentario, en
 * plural, prometía sobre una lista de UN elemento durante meses.
 *
 * EL CASO REAL (escuela Juana Manso, 2026-09-08). La usuaria de Windows se llama
 * `Dirección310`, con `ó`, que no es ASCII. PlatformIO Core no soporta rutas con
 * caracteres no-ASCII —sus toolchains de gcc se rompen— así que en Windows, y a
 * propósito, RELOCALIZA su core_dir a la raíz del disco. El instalador oficial
 * dejó escrito en pantalla:
 *
 *     Creating a virtual environment at C:\.platformio\penv
 *     The full path to platformio.exe is C:\.platformio\penv\Scripts\platformio.exe
 *
 * Nosotros mirábamos SOLO `$HOME\.platformio` y le dijimos a una docente durante
 * TRES SEMANAS que PlatformIO no estaba instalado. Lo tenía, y andaba: `pio.exe
 * --version` contestaba «PlatformIO Core, version 6.2.0».
 *
 * Por eso esto es una LISTA ORDENADA, no una ruta:
 *   1. `PLATFORMIO_CORE_DIR` si está seteada (lo que el usuario mandó, gana)
 *   2. `$HOME\.platformio` (la instalación normal)
 *   3. la raíz del disco de $HOME (`C:\.platformio`) <- el caso de arriba
 *   4. `C:\.platformio` fijo, por si $HOME vive en otro disco
 *   5. el PATH, que lo resuelve `pioBin()`/`pioDisponible()` al final
 *
 * En cada carpeta se miran `pio.exe` Y `platformio.exe` (en Unix `pio` y
 * `platformio`): los dos suelen existir, pero el mensaje del instalador oficial
 * nombra `platformio.exe`, y no queremos depender de que exista justo el que
 * elegimos nosotros.
 *
 * La relocalización a la raíz del disco es SOLO de Windows: en Linux/macOS las
 * rutas del home no rompen a gcc y PlatformIO no mueve nada. No la inventamos.
 *
 * ACÁ NO SE PREGUNTA `--version`, Y ES A PROPÓSITO. Este código está en el camino
 * caliente del tool y ya cachea: alcanza con quedarse con el primero que EXISTE.
 * Un pio a medio armar se manifiesta igual en el primer comando de verdad, con su
 * error real. Los scripts de instalación y el diagnóstico sí le preguntan
 * `--version` al primer candidato, porque corren una sola vez y ahí ese segundo
 * de más compra la diferencia entre "está" y "anda". Si venís a "arreglar" esta
 * asimetría: es deliberada.
 *
 * Toma home/plataforma/entorno por parámetro para poder probar el caso de
 * `Dirección310` desde Linux; sin argumentos se comporta como siempre.
 */
export function pioCandidatos(
  home: string = homedir(),
  plataforma: string = process.platform,
  entorno: Record<string, string | undefined> = process.env,
): string[] {
  const core = entorno.PLATFORMIO_CORE_DIR
  if (plataforma === "win32") {
    // win32.parse("C:\\Users\\Dirección310").root === "C:\\" — y anda también
    // corriendo bajo Linux, que es como lo prueban los tests.
    const raiz = win32.parse(home).root
    const dirs = unicos([core, win32.join(home, ".platformio"), raiz && win32.join(raiz, ".platformio"), "C:\\.platformio"])
    return dirs.flatMap((d) => ["pio.exe", "platformio.exe"].map((n) => win32.join(d, "penv", "Scripts", n)))
  }
  const dirs = unicos([core, join(home, ".platformio")])
  return dirs.flatMap((d) => ["pio", "platformio"].map((n) => join(d, "penv", "bin", n)))
}

export function resetPioCache(): void {
  pioPathCache = null
}

export function pioBin(): string {
  if (pioPathCache) return pioPathCache
  for (const candidate of pioCandidatos()) {
    if (existsSync(candidate)) {
      pioPathCache = candidate
      return candidate
    }
  }
  return "pio" // fallback: confiar en el PATH del sistema (sin cachear)
}

// Resuelve de nuevo, sin cache: hay binario en las rutas conocidas o en el PATH.
// Nunca hace existsSync("pio"): eso mira un archivo relativo al cwd, no el PATH.
export function pioDisponible(): boolean {
  resetPioCache()
  // El PATH se prueba con los DOS nombres: el instalador oficial deja los dos y
  // hubo maquinas donde el shim del PATH era `platformio` y no `pio`.
  return (
    pioCandidatos().some((c) => existsSync(c)) || Bun.which("pio") !== null || Bun.which("platformio") !== null
  )
}

/*
 * CUANTO SE ESPERA A CADA COMANDO, y por que dos numeros distintos.
 *
 * La primera vez que se compila para una placa nueva, `pio run` baja el
 * toolchain entero (cientos de MB) con una barra de progreso que por el pipe no
 * se ve: minutos de silencio total. En el aula eso se leia como "se colgo", y
 * sin timeout la unica salida era cerrar OpenCode. Con 15 minutos alcanza para
 * cualquier red que anda; si no termina, se lo decimos en vez de esperar para
 * siempre. Lo mismo vale para la carga: `tool-avrdude`/`esptool` se bajan en
 * el PRIMER upload, no en el compile.
 *
 * Los comandos de consulta (`pio --version`, `pio device list`, PowerShell)
 * tardan segundos: si a los 60 s no contestaron, algo esta roto.
 *
 * Se puede acortar por variable de entorno (la usan los tests para probar el
 * camino del timeout sin esperar 15 minutos).
 */
const TIMEOUT_CORTO_MS = 60_000
export function timeoutLargoMs(): number {
  const n = Number(process.env.TECNIA_PIO_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000
}

/** Lo que devuelve `run()` cuando el comando no termino a tiempo (mismo codigo que `timeout(1)`). */
export const CODIGO_TIMEOUT = 124
/** Lo que devuelve `run()` cuando el usuario corto la accion desde OpenCode (Ctrl+C: 128+SIGINT). */
export const CODIGO_CANCELADO = 130

/**
 * Una sola senal que se dispara si CUALQUIERA de las dos se dispara. Bun trae
 * `AbortSignal.any` en las versiones nuevas; si no esta, se compone a mano.
 */
function combinarSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const lista = signals.filter((s): s is AbortSignal => s !== undefined)
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === "function") return anyFn.call(AbortSignal, lista)
  const ctrl = new AbortController()
  for (const s of lista) {
    if (s.aborted) {
      ctrl.abort(s.reason)
      break
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true })
  }
  return ctrl.signal
}

/**
 * Corre un comando y devuelve codigo + salida, sin colgarse.
 *
 * El ORDEN importa: stdout y stderr se leen ANTES de esperar `exited`. Al reves,
 * el proceso se bloquea al llenar el buffer del pipe y el tool espera a un
 * proceso que espera al tool.
 *
 * El timeout y el `ctx.abort` de OpenCode se combinan en una sola senal: se le
 * pasa a Bun (que mata el proceso) Y se corre una carrera contra la lectura,
 * porque si el proceso ignora la senal —o quedo colgado en una descarga— los
 * pipes no se cierran nunca y `await` no vuelve.
 */
export async function run(
  cmd: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs: number = TIMEOUT_CORTO_MS,
): Promise<RunResult> {
  // Resolvemos "pio" a la ruta real del binario (PATH-independiente)
  if (cmd[0] === "pio") cmd = [pioBin(), ...cmd.slice(1)]
  const porTiempo = AbortSignal.timeout(timeoutMs)
  const corte = combinarSignals(signal, porTiempo)
  const resultadoCorte = (): RunResult =>
    porTiempo.aborted
      ? {
          code: CODIGO_TIMEOUT,
          stdout: "",
          stderr: `El comando no termino en ${describirDuracion(timeoutMs)} y se corto: ${cmd.join(" ")}`,
        }
      : { code: CODIGO_CANCELADO, stdout: "", stderr: "Cancelado por el usuario." }

  if (corte.aborted) return resultadoCorte()

  const lanzar = () => Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", signal: corte })
  let proc: ReturnType<typeof lanzar>
  try {
    proc = lanzar()
  } catch {
    return { code: 127, stdout: "", stderr: "command not found" }
  }

  const lectura = (async (): Promise<RunResult> => {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, stdout, stderr }
  })()
  // Nunca rechaza: si gana la carrera, el resultado se arma abajo.
  const cortado = new Promise<"cortado">((resolve) => corte.addEventListener("abort", () => resolve("cortado"), { once: true }))

  const ganador = await Promise.race([lectura, cortado])
  if (ganador !== "cortado") return ganador

  // Por si Bun no lo mato solo (o el mock de los tests no lo hace).
  try {
    proc.kill()
  } catch {
    /* ya estaba muerto */
  }
  // Que la lectura pendiente no quede como rechazo sin atender si el pipe revienta al matarlo.
  lectura.catch(() => {})
  return resultadoCorte()
}

function describirDuracion(ms: number): string {
  if (ms >= 60_000) {
    const min = Math.round(ms / 60_000)
    return `${min} minuto${min === 1 ? "" : "s"}`
  }
  return `${Math.max(1, Math.round(ms / 1000))} segundo${ms >= 1500 ? "s" : ""}`
}

/**
 * Lo que se le dice al docente cuando compilar o cargar no termino a tiempo.
 * La causa casi siempre es la descarga inicial del toolchain, que por el pipe
 * no muestra progreso: el segundo intento arranca con todo bajado.
 */
function mensajeTimeout(que: "compilar" | "cargar el codigo", timeoutMs: number): string {
  return (
    `No termine de ${que} en ${describirDuracion(timeoutMs)}. ` +
    "PlatformIO sigue descargando herramientas o se colgó; probá de nuevo, la segunda vez es rápido " +
    "(lo que ya se bajo queda guardado). Si vuelve a pasar, corré `/diagnostico`: puede ser la red " +
    "de la escuela bloqueando las descargas."
  )
}

/**
 * Recorta una salida larga para que llegue al modelo lo que sirve.
 *
 * POR QUE. Un `pio run` con warnings tira 3000 lineas por stderr. Todo eso iba
 * al chat, y `traducirError()` solo mira la primera linea con `error:`. El
 * modelo recibia una pared de texto para encontrar una linea.
 *
 * Que se conserva: las 15 lineas antes y despues del PRIMER `error:` (o
 * `Error`), que es donde esta el contexto del error de compilacion, y las
 * ultimas 10, que es donde PlatformIO dice como termino (`*** [upload] Error 1`,
 * `[FAILED] Took 3.21 seconds`). Lo demas se marca como omitido, con el numero,
 * para que se sepa que falta algo y cuanto.
 *
 * Es una funcion pura para poder probarla sin compilar nada. Y hay que llamar a
 * `traducirError()` con el texto COMPLETO, antes de recortar.
 */
export function recortarSalida(texto: string, maxLineas = 40): string {
  const lineas = texto.replace(/\r\n?/g, "\n").trimEnd().split("\n")
  if (lineas.length <= maxLineas) return lineas.join("\n")

  const CONTEXTO = 15
  const COLA = 10
  const n = lineas.length
  const marcar = (omitidas: number) => `… (${omitidas} línea${omitidas === 1 ? "" : "s"} omitida${omitidas === 1 ? "" : "s"})`

  const iError = lineas.findIndex((l) => /error:|Error/.test(l))
  // Rangos [desde, hasta) a conservar, en orden, sin solaparse.
  const rangos: Array<[number, number]> = []
  if (iError >= 0) rangos.push([Math.max(0, iError - CONTEXTO), Math.min(n, iError + CONTEXTO + 1)])
  else rangos.push([0, CONTEXTO])
  const cola: [number, number] = [Math.max(0, n - COLA), n]
  const ultimo = rangos[rangos.length - 1]!
  if (cola[0] <= ultimo[1]) ultimo[1] = n
  else rangos.push(cola)

  const salida: string[] = []
  let cursor = 0
  for (const [desde, hasta] of rangos) {
    if (desde > cursor) salida.push(marcar(desde - cursor))
    salida.push(...lineas.slice(desde, hasta))
    cursor = hasta
  }
  if (cursor < n) salida.push(marcar(n - cursor))
  return salida.join("\n")
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

export function traducirError(stderr: string, stdout: string): string {
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

    /*
     * EL PRIMERO QUE SE CHOCA CUALQUIERA, y no estaba traducido.
     *
     * PlatformIO no compila un archivo suelto: quiere una carpeta con
     * `platformio.ini` y el codigo en `src/main.cpp`. Si el docente abrio
     * OpenCode en su escritorio y pidio codigo, `pio run` corta con este error
     * en ingles y nadie le explica que falta armar el proyecto.
     */
    [
      /Not a PlatformIO project|NotPlatformIOProjectError|platformio\.ini.*has not been found/i,
      "**Todavia no hay un proyecto de PlatformIO en esta carpeta.** PlatformIO no compila un " +
        "archivo suelto: necesita un `platformio.ini` que diga que placa es, y el codigo en " +
        "`src/main.cpp`. Se arman los dos y se compila de nuevo — el `platformio.ini` cambia " +
        "segun la placa (`board = uno` para Arduino UNO, `board = esp32dev` para ESP32).",
    ],
    /*
     * LOS TRES DEL ESP32 QUE NO SON ERRORES DE COMPILACION.
     *
     * Salen por el monitor serial DESPUES de cargar, cuando el programa ya
     * corre, y son los que un docente pega en el chat sin saber que significan.
     * Ninguno de los tres estaba reconocido: el bot recibia el texto crudo y
     * tenia que improvisar.
     *
     * El del brownout es el mas importante de todos: es lo que escupe la placa
     * la primera vez que alguien le conecta un servo, o sea la semana dos o tres
     * de cualquier curso.
     */
    [
      /Brownout detector was triggered/,
      "**Le falta corriente a la placa.** El ESP32 se apaga solo cuando la tension le baja, " +
        "y eso pasa casi siempre al conectar un servo, un motor o un rele: el USB no da abasto. " +
        "No es un problema del codigo. Solucion: fuente externa de 5V para el componente que " +
        "consume, con el GND unido al de la placa. Si es un servo, calcula con el consumo de " +
        "BLOQUEO (unos 700 mA en un SG90), no con el de movimiento libre.",
    ],
    [
      /rst:0x[0-9a-f]+.*boot:0x/i,
      "**La placa se esta reiniciando en bucle.** Ese `rst:0x...` es el motivo del reinicio que " +
        "imprime el ESP32 al arrancar. Las dos causas mas comunes en el aula: (1) le falta " +
        "corriente — ver si tambien aparece 'Brownout'; (2) hay algo conectado a un pin de " +
        "arranque (GPIO0, GPIO2, GPIO12 o GPIO15) que lo deja en el nivel equivocado al " +
        "encender. Probá desconectando todo del circuito y encendiendo la placa sola: si asi " +
        "arranca bien, es el cableado y no el programa.",
    ],
    [
      /Guru Meditation Error/,
      "**El programa se cayo mientras corria** (no es un error de compilacion). Las causas " +
        "tipicas: usar un puntero o un objeto que todavia no se inicializo, leer de una " +
        "libreria que fallo en `begin()` sin chequear el resultado, o escribir fuera de un " +
        "arreglo. Miralo asi: el mensaje aparece DESPUES de que el programa arranco, " +
        "asi que fijate que hizo justo antes de caerse — un `Serial.print` antes de cada paso " +
        "te dice hasta donde llego.",
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

/**
 * Los códigos con los que Windows dice "esto está enchufado pero no anda".
 *
 * El 28 es EL caso que nos importa: "los controladores para este dispositivo no
 * están instalados". Es exactamente lo que pasa con un CH340 recién enchufado en
 * una Windows limpia.
 */
const ERRORES_DE_DRIVER: Record<number, string> = {
  1: "Windows no lo configuró bien",
  10: "el dispositivo no puede iniciarse",
  28: "**le falta el driver** — Windows no lo trae de fábrica",
  31: "el driver que tiene no funciona",
  37: "el driver no pudo arrancar",
  39: "el driver está dañado o falta",
  43: "Windows lo detuvo porque reportó un problema",
}

/**
 * Convierte la salida de Windows en algo que se pueda contar.
 *
 * Exportada para poder probarla con la salida real sin tener que enchufar una
 * placa sin driver, que es un escenario difícil de montar a pedido.
 */
export function leerDispositivosConProblema(
  json: string,
): Array<{ nombre: string; hwid: string; problema: string; driverWindows?: string }> {
  let filas: Array<{ Name?: string; DeviceID?: string; ConfigManagerErrorCode?: number }>
  try {
    const parsed = JSON.parse(json)
    filas = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }

  return filas
    .filter((f) => f?.DeviceID && f.ConfigManagerErrorCode)
    .map((f) => {
      const q = identificar(f.DeviceID, f.Name)
      return {
        nombre: f.Name ?? "dispositivo sin nombre",
        hwid: f.DeviceID!,
        problema: ERRORES_DE_DRIVER[f.ConfigManagerErrorCode!] ?? `código ${f.ConfigManagerErrorCode}`,
        driverWindows: q.driverWindows,
      }
    })
    .filter((d) => identificar(d.hwid).esPlaca)
}

/**
 * Busca placas que Windows VE pero no puede usar.
 *
 * POR QUÉ HACE FALTA. Sin el driver del CH340, Windows no crea ningún puerto COM
 * — así que `pio device list` no devuelve nada y el bot dice "no hay ninguna
 * placa conectada". El docente mira el cable, lo mueve, prueba otro puerto USB, y
 * la placa estuvo bien todo el tiempo.
 *
 * Windows SÍ ve el dispositivo: lo tiene en el administrador con un código de
 * error. Preguntarle a él convierte "no hay nada" en "está enchufada, le falta
 * el driver, bajalo de acá".
 *
 * Sólo Windows: en Linux y macOS el CH340 anda sin instalar nada.
 */
async function placasSinDriver(cwd: string, signal?: AbortSignal) {
  if (process.platform !== "win32") return []
  /*
   * `Get-CimInstance` y no `Get-WmiObject`: la misma clase y las mismas
   * propiedades, pero el cmdlet viejo no existe en PowerShell 7 —y en algunas
   * maquinas `powershell` resuelve a pwsh 7—, con lo que la consulta fallaba en
   * silencio y el diagnostico decia "ninguna placa" con la placa enchufada.
   *
   * Y la salida se pide en UTF-8: por defecto PowerShell escribe al pipe en la
   * pagina de codigos OEM, `run()` la decodifica como UTF-8, y un "Puerto de
   * comunicaciones" con tilde llegaba roto al chat.
   */
  const ps =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.ConfigManagerErrorCode -ne 0 } | " +
    "Select-Object Name, DeviceID, ConfigManagerErrorCode | ConvertTo-Json -Compress"
  const r = await run(["powershell", "-NoProfile", "-Command", ps], cwd, signal)
  return r.code === 0 ? leerDispositivosConProblema(r.stdout) : []
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
    const primero = otros[0]
    const detalle = primero
      ? ` Veo ${otros.length === 1 ? "un puerto serie" : `${otros.length} puertos serie`} (${otros
          .map((d) => d.port)
          .join(", ")}), pero ${otros.length === 1 ? "no es" : "ninguno es"} una placa: ${
          identificar(primero.hwid, primero.description).motivo
        }.`
      : ""
    return {
      error:
        `No encuentro ninguna placa conectada. Conectá el Arduino o el ESP32 por USB y probá de nuevo.${detalle}` +
        ` Si la placa está enchufada y sigo sin verla, corré \`/diagnostico\`: puede faltarle el driver.`,
    }
  }

  const unica = candidates[0]
  if (unica && candidates.length === 1) {
    return { port: unica.port }
  }

  const lista = candidates.map((d, i) => `${i + 1}. ${d.port}${d.description ? ` (${d.description})` : ""}`).join("\n")
  return {
    error: `Hay varios dispositivos conectados. Indicame cual es el tuyo:\n${lista}\n\nVolve a intentar con el parametro 'port' especificando el puerto que corresponde.`,
  }
}

/** Una sola forma de decir "reinstala desde cero": la misma en este tool y en /actualizar. */
const CLONAR_REPO =
  "descarga el proyecto de nuevo con `git clone https://github.com/programadores-obreros/Agente-editor-inet.git` " +
  "(o el ZIP desde esa pagina) y corre `bash install/bootstrap.sh` adentro de la carpeta."
const REINSTALAR_DESDE_CERO =
  "Baja el instalador de la ultima version publicada, " +
  "https://github.com/programadores-obreros/Agente-editor-inet/releases/latest " +
  "(`Instalar-Tecnia-Bot.exe`), y corrilo una vez: instala solo lo que falte y no borra tu trabajo. " +
  "En Linux/Mac, " + CLONAR_REPO

/**
 * Los baudios del monitor salen del `monitor_speed` del platformio.ini.
 *
 * La descripcion del tool prometia "puerto y baudios automaticos" y el codigo
 * hacia `args.baud ?? 9600`. El ini que el propio prompt genera para ESP32 dice
 * `monitor_speed = 115200`: el monitor abria a 9600 y el docente veia basura
 * en pantalla, con el dato correcto escrito a dos lineas de distancia.
 *
 * Es una funcion pura sobre el TEXTO del ini para poder probarla sin disco.
 * Prioridad: el environment pedido, despues la seccion comun `[env]`, despues
 * el primer `monitor_speed` que aparezca en cualquier `[env:*]`.
 */
export function leerMonitorSpeed(iniText: string, env?: string): number | null {
  const porSeccion = new Map<string, number>()
  const orden: string[] = []
  let seccion = ""
  for (const cruda of iniText.split(/\r?\n/)) {
    const linea = cruda.replace(/[;#].*$/, "").trim()
    const cab = linea.match(/^\[([^\]]+)\]$/)
    if (cab) {
      seccion = (cab[1] ?? "").trim()
      continue
    }
    const kv = linea.match(/^monitor_speed\s*=\s*(\d+)\s*$/)
    if (kv && seccion && !porSeccion.has(seccion)) {
      porSeccion.set(seccion, Number(kv[1] ?? 0))
      orden.push(seccion)
    }
  }
  if (env && porSeccion.has(`env:${env}`)) return porSeccion.get(`env:${env}`)!
  if (porSeccion.has("env")) return porSeccion.get("env")!
  const primero = orden.find((s) => s.startsWith("env:"))
  return primero ? porSeccion.get(primero)! : null
}

/** El monitor_speed del platformio.ini de `cwd`, o null si no hay ini o no lo declara. */
function monitorSpeedDelProyecto(cwd: string, env?: string): number | null {
  const ini = join(cwd, "platformio.ini")
  if (!existsSync(ini)) return null
  try {
    return leerMonitorSpeed(readFileSync(ini, "utf8"), env)
  } catch {
    return null
  }
}

/**
 * ESTE MENSAJE NO DA EL LINK DE LA DOCUMENTACION OFICIAL, Y ES A PROPOSITO.
 *
 * Paso en una capacitacion: de decenas de maquinas, UNA se quedo sin PlatformIO.
 * La docente corrio `/diagnostico` y el bot le contesto que instalara Visual
 * Studio Code y la extension PlatformIO IDE.
 *
 * Eso no arregla nada aca. Tecnia Bot usa PlatformIO CORE, que lo instala su
 * propio instalador. El consejo mandaba a la directora de una escuela a bajar
 * cientos de megas de otro producto para seguir sin poder compilar.
 *
 * Y el modelo no invento de la nada: la pagina oficial ofrece cinco metodos, y
 * el mas difundido en internet es el de VS Code. Le dimos un link con opciones
 * y le pedimos que eligiera. Eligio la que cualquiera hubiera elegido.
 *
 * Aca hay UNA sola forma de arreglarlo, y ya esta instalada en la maquina.
 */
function pioNoEncontrado() {
  return (
    "PlatformIO no esta instalado.\n\n" +
    "COMO SE ARREGLA (no hay que instalar nada aparte, ni VS Code, ni Python a mano):\n" +
    "  1. Instalalo VOS ahora: llama a este mismo tool con action: \"reparar\".\n" +
    "     Avisale antes al usuario que tarda unos minutos y baja unos 60 MB.\n" +
    "  2. Plan B, solo si la reparacion desde aca no pudo correr (el tool lo dice):\n" +
    "     Menu inicio -> 'Reparar Tecnia Bot'. Hace exactamente lo mismo.\n" +
    "     En Linux/Mac, el tool devuelve el comando exacto (bash install/bootstrap.sh).\n" +
    "  3. Si despues de eso sigue faltando, es la RED y no la maquina:\n" +
    "     menu inicio -> 'Diagnostico de Tecnia Bot'. Deja un .txt que dice si\n" +
    "     esta maquina llega a pypi.org, que es de donde se baja.\n\n" +
    "Mientras tanto Tecnia Bot sirve igual para explicar, dibujar circuitos y\n" +
    "repartir fichas. Lo unico que no puede es compilar y cargar a la placa."
  )
}

export default tool({
  description: `Compilar y cargar codigo Arduino/ESP32 con PlatformIO. Detecta el puerto automaticamente.

Acciones:
- compile: compilar el proyecto actual
- flash: cargar el codigo en el dispositivo
- both: compilar y cargar en un solo paso
- monitor: abre una ventana de terminal aparte con el monitor serial ya corriendo. El puerto se detecta solo (si hay varias placas, pide elegir). Los baudios: si no pasas 'baud', lee el monitor_speed del platformio.ini de la carpeta actual (del environment que indiques, o el primero que tenga uno) y si no hay ninguno usa 9600. NO requiere codigo cargado: sirve para ver los datos que manda la placa y para mandarle teclas (ej: comandar un servo desde el teclado). Cuando el usuario pida "ver el monitor serial", "abrir la terminal serial" o similar, llama a esta accion DIRECTAMENTE, sin pedir ni crear un proyecto.
- diagnostico: verificar entorno (PlatformIO instalado, dispositivos conectados)
- reparar: instala PlatformIO Core cuando falta, corriendo el instalador de Tecnia Bot (en Linux/Mac devuelve el comando exacto para hacerlo a mano). Tarda unos minutos y baja unos 60 MB: avisale antes.`,
  args: {
    action: tool.schema
      .enum(["compile", "flash", "both", "monitor", "diagnostico", "reparar"])
      .describe(
        "compile: compila el proyecto. flash: lo carga a la placa. both: las dos. " +
        "monitor: abre el monitor serie. diagnostico: informa que hay y que falta. " +
        "reparar: INSTALA PlatformIO cuando falta, corriendo el instalador de Tecnia Bot. " +
        "Usa 'reparar' apenas veas que falta PlatformIO y el usuario quiera compilar o " +
        "cargar codigo: hacelo vos. El acceso directo del menu inicio, Reparar Tecnia Bot, " +
        "es el plan B, solo si desde aca no se pudo correr. Tarda unos minutos y baja unos " +
        "60 MB, asi que avisale antes de arrancar."
      ),
    port: tool.schema
      .string()
      .optional()
      .describe("Puerto serial explicito (ej: COM3, /dev/ttyUSB0). Se detecta automaticamente si no se indica."),
    baud: tool.schema
      .number()
      .optional()
      .describe(
        "Velocidad del monitor serial en baudios. Si no se indica, se usa el monitor_speed del platformio.ini de la carpeta actual y, si no hay, 9600. Debe coincidir con el valor de Serial.begin(...) del sketch (ej: 115200 para muchos ESP32).",
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

    // Compilar y cargar son los dos comandos largos (descargan toolchain la primera vez).
    const compilar = () => run(["pio", "run", ...envFlag], cwd, signal, timeoutLargoMs())
    const cargar = (puerto: string) =>
      run(["pio", "run", "--target", "upload", "--upload-port", puerto, ...envFlag], cwd, signal, timeoutLargoMs())

    /*
     * Primero se traduce sobre el texto COMPLETO (el patron puede estar en
     * cualquier linea) y recien despues se recorta lo que se muestra: si fuera
     * al reves, un error que quedo fuera de la ventana perderia su traduccion.
     */
    const explicarFalla = (r: RunResult) => {
      const traduccion = traducirError(r.stderr, r.stdout)
      const original = recortarSalida(r.stderr.trim() ? r.stderr : r.stdout)
      return `**Que significa:**\n${traduccion}\n\n**Error original:**\n\`\`\`\n${original}\n\`\`\``
    }
    // Timeout o cancelacion no son errores de compilacion: no se traducen, se explican.
    const noTermino = (r: RunResult, que: "compilar" | "cargar el codigo"): string | null =>
      r.code === CODIGO_TIMEOUT
        ? mensajeTimeout(que, timeoutLargoMs())
        : r.code === CODIGO_CANCELADO
          ? `Se cancelo la accion antes de terminar de ${que}.`
          : null

    // `diagnostico` informa que falta, y `reparar` existe PARA cuando falta: si
    // el pre-chequeo corriera tambien para `reparar`, devolveria "anda al menu
    // inicio" y la rama de reparacion seria inalcanzable justo en el unico caso
    // para el que se escribio. Paso en la VM: /reparar no instalaba nada.
    if (args.action !== "diagnostico" && args.action !== "reparar") {
      const check = await run(["pio", "--version"], cwd, signal)
      if (check.code === 127 || check.stderr.includes("command not found") || check.stderr.includes("is not recognized")) {
        return pioNoEncontrado()
      }
    }

    switch (args.action) {
      case "reparar": {
        /*
         * POR QUE EXISTE ESTA ACCION.
         *
         * Una docente miro el reporte que le decia "anda al menu inicio y busca
         * Reparar Tecnia Bot", y contesto: "vos tenes platformio, hacelo".
         *
         * Tenia razon. Le estabamos pidiendo que fuera a buscar un acceso directo
         * para correr un script que el bot puede correr solo. Cada paso que le
         * pedimos a alguien que ya nos esta hablando es un paso donde se pierde.
         *
         * Y hay un segundo motivo, que para nosotros vale igual: el bootstrap
         * escribe POR QUE fallo, y si lo corre el bot ese texto aparece en la
         * conversacion. Estuvimos tres rondas pidiendo un log por foto.
         */
        if (process.platform !== "win32") {
          return (
            "La reparacion automatica es solo para Windows (corre el bootstrap.ps1 del instalador). " +
            "En Linux o Mac se arregla con UN comando, en una terminal, parado en la carpeta del proyecto " +
            "(la que se clono al instalar, `Agente-editor-inet`):\n\n" +
            "```\nbash install/bootstrap.sh\n```\n\n" +
            "Instala lo que falte (PlatformIO Core incluido) y no toca lo que ya esta. " +
            "Si esa carpeta ya no existe: " + CLONAR_REPO
          )
        }

        const appDir = join(process.env.LOCALAPPDATA ?? "", "TecniaBot")
        const bootstrap = join(appDir, "install", "bootstrap.ps1")
        if (!existsSync(bootstrap)) {
          return (
            "No encuentro el instalador en esta maquina (`" + bootstrap + "`).\n\n" +
            "Suele pasar cuando Tecnia Bot se instalo a mano o con una version muy vieja. " +
            REINSTALAR_DESDE_CERO
          )
        }

        /*
         * SE MIRA ANTES Y DESPUES, y no sirve mirar solo despues.
         *
         * La primera version de esto contestaba "Listo: PlatformIO quedo
         * instalado" con solo encontrarlo al final. Si el bootstrap NO llegaba a
         * arrancar -powershell fuera del PATH del proceso, una politica que lo
         * bloquea, el antivirus- y PlatformIO ya estaba de antes, el tool
         * informaba un exito por una reparacion QUE NUNCA CORRIO.
         *
         * Es exactamente el OK falso que este mismo archivo le prohibe al modelo,
         * cometido por el codigo que se lo prohibe. Un dia despues de escribir la
         * regla.
         *
         * La diferencia importa: si algo mas seguia roto, el docente se iba
         * convencido de que la reparacion se hizo.
         */
        const pioAntes = pioDisponible()

        // El bootstrap baja e instala PlatformIO: son minutos, como una compilacion.
        const result = await run(
          ["powershell", "-ExecutionPolicy", "Bypass", "-NoProfile", "-File", bootstrap],
          appDir,
          signal,
          timeoutLargoMs(),
        )

        // 127 es lo que devuelve run() cuando ni siquiera pudo lanzar el proceso.
        if (result.code === 127) {
          return (
            "NO PUDE CORRER LA REPARACION: no se pudo lanzar PowerShell desde aca.\n\n" +
            (pioAntes
              ? "Ojo: PlatformIO YA estaba instalado de antes, asi que si algo anda es por eso y no por esta reparacion.\n\n"
              : "") +
            "Se arregla igual desde afuera: menu inicio -> 'Reparar Tecnia Bot'. Hace lo mismo que esto."
          )
        }

        // Se vuelve a resolver sin cache: el chequeo inicial de `pio --version`
        // corrio cuando todavia no estaba instalado.
        const pioAhora = pioDisponible()
        // Las ultimas lineas, que es donde el bootstrap dice como le fue. El log
        // entero son cientos de lineas de descarga que no le sirven a nadie.
        const salida = (result.stdout + "\n" + result.stderr)
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0)
          .slice(-25)
          .join("\n")

        if (pioAhora) {
          // Se distingue "lo instale" de "ya estaba", porque no son lo mismo para
          // el que pregunta. Decir "listo, lo instale" cuando no se instalo nada
          // hace que la proxima vez que algo falle, la reparacion parezca hecha.
          const encabezado = pioAntes
            ? "La reparacion corrio. PlatformIO ya estaba instalado, asi que no hizo falta bajarlo de nuevo."
            : "Listo: PlatformIO quedo instalado. Ya se puede compilar y cargar codigo a la placa."
          return encabezado + "\n\n```\n" + salida + "\n```"
        }

        return (
          "La reparacion corrio pero PlatformIO sigue sin instalarse.\n\n" +
          "Esto es lo que dijo el instalador — leelo y contale al usuario que dice, con sus palabras:\n\n" +
          "```\n" + salida + "\n```\n\n" +
          "Las dos causas habituales:\n" +
          "- **El senuelo de la Microsoft Store**: si aparece 'No hay un Python usable' o " +
          "'instalar desde el Microsoft Store', se apaga en Configuracion > Aplicaciones > " +
          "Alias de ejecucion de aplicaciones, destildando python.exe y python3.exe.\n" +
          "- **La red de la escuela**: PlatformIO se baja de pypi.org, un dominio que los " +
          "filtros de contenido bloquean sin avisar. Se confirma con 'Diagnostico de Tecnia Bot' " +
          "en el menu inicio."
        )
      }

      case "compile": {
        const result = await compilar()
        if (result.code === 0) return "Compilacion exitosa. El codigo esta listo para cargar al dispositivo."
        return noTermino(result, "compilar") ?? `Hubo un error al compilar:\n\n${explicarFalla(result)}`
      }

      case "flash": {
        let puerto = args.port
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
        }
        const result = await cargar(puerto)
        if (result.code === 0) return `Codigo cargado exitosamente en ${puerto}.`
        return noTermino(result, "cargar el codigo") ?? `Error al cargar el codigo:\n\n${explicarFalla(result)}`
      }

      case "both": {
        const compile = await compilar()
        if (compile.code !== 0) {
          return noTermino(compile, "compilar") ?? `Error al compilar (no se intento cargar):\n\n${explicarFalla(compile)}`
        }
        let puerto = args.port
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
        }
        const flash = await cargar(puerto)
        if (flash.code === 0) return `Compilacion y carga exitosa en ${puerto}.`
        return (
          noTermino(flash, "cargar el codigo") ??
          `La compilacion fue bien pero hubo un error al cargar:\n\n${explicarFalla(flash)}`
        )
      }

      case "monitor": {
        const baudDelIni = args.baud ? null : monitorSpeedDelProyecto(cwd, args.environment)
        const baud = args.baud ?? baudDelIni ?? 9600
        const origenBaud = args.baud
          ? ""
          : baudDelIni
            ? " (el monitor_speed de tu platformio.ini)"
            : " (el valor por defecto: si tu sketch usa otro Serial.begin, pedime esos baudios)"

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

        const mensajeExito = `Abri una ventana nueva (negra) con el monitor serial en ${puerto} a ${baud} baudios${origenBaud}. Ahi vas a ver los datos de la placa y podes apretar teclas para comandarla. Para cerrarlo, apreta Ctrl+C en esa ventana.`

        const mensajeManual = `No pude abrir una ventana nueva automaticamente en este equipo, pero es facil hacerlo a mano:

1. Abri una terminal (en Windows busca "cmd"; en Mac/Linux busca "Terminal").
2. Copia y pega este comando, despues apreta Enter:

\`\`\`
${comandoManual}
\`\`\`

Vas a ver los datos de la placa en ${puerto} a ${baud} baudios${origenBaud}. Para cerrarlo, apreta Ctrl+C en esa ventana.`

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
          // Sin link a la documentacion oficial: ver pioNoEncontrado(). La
          // reparacion de Tecnia Bot es volver a correr SU instalador.
          estado =
            "Falta instalar PlatformIO. Se arregla con 'Reparar Tecnia Bot', en el menu " +
            "inicio: lo instala solo. NO hay que instalar VS Code " +
            "ni nada aparte. Si aun asi falta, es la red: correr 'Diagnostico de Tecnia Bot'."
        } else if (placas === 0) {
          /*
           * ANTES DE DECIR "no hay nada", PREGUNTARLE A WINDOWS.
           *
           * Sin el driver del CH340 no existe ningún puerto COM, así que
           * PlatformIO no ve nada — pero Windows sí tiene el dispositivo, con un
           * código de error. Decir "no hay ninguna placa" cuando está enchufada
           * manda al docente a revisar el cable durante media hora.
           */
          const d = (await placasSinDriver(cwd, signal))[0]
          if (d) {
            estado =
              `**Hay una placa enchufada, pero Windows no la puede usar.**\n\n` +
              `Ve un \`${d.nombre}\` y ${d.problema}.\n\n` +
              (d.driverWindows
                ? `Bajá el driver de acá: ${d.driverWindows}\n\nInstalalo, desenchufá la placa, volvé a enchufarla y corré \`/diagnostico\` de nuevo.`
                : `Revisá el administrador de dispositivos de Windows para ver qué le falta.`)
          } else {
            const ayuda =
              os === "Windows"
                ? " Si está enchufada y no la veo ni acá ni en Windows, probá otro cable: hay cables USB que sólo llevan corriente y no datos."
                : os === "Linux"
                  ? " Si está enchufada y no aparece, puede ser permiso del puerto: `sudo usermod -a -G dialout $USER` (o `uucp` en Arch/Manjaro), y volvé a iniciar sesión."
                  : ""
            estado = `**Ninguna placa conectada.** Enchufá el Arduino o el ESP32 por USB.${ayuda}`
          }
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
