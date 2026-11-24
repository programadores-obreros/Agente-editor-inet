// `carga/procesos-windows.ts` — lo que en Linux sale de `/proc` y en Windows hay que
// preguntárselo al sistema: qué procesos hay, quién abrió a quién y con qué línea de comando.
//
// POR QUÉ EXISTE. La carga del programa generado (`cargar-programa.ts`) exige saber CÓMO SE
// LANZÓ OpenCode antes de tocar la placa, y eso estaba escrito sólo para Linux. En la primera
// prueba en una notebook Windows real (2026-11-23) el camino nuevo armó el proyecto, lo dibujó,
// generó y compiló… y se frenó ahí: `programa cargar` contestaba "sólo en Linux" y `platformio`
// se niega a cargar la carpeta del programa generado. Las dos puertas cerradas en el sistema
// que usan las escuelas.
//
// MEDIDO en esa notebook (Windows 10 19045, PowerShell 5.1, OpenCode 1.18.18 abierto desde el
// ícono del escritorio), con `Get-CimInstance Win32_Process`:
//
//     10680 <- 9240  opencode.exe  "C:\Users\<u>\scoop\apps\opencode\current\opencode.exe"
//      9240 <- 5232  cmd.exe       "C:\Windows\system32\cmd.exe" /C ""C:\Users\<u>\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""
//
// La consulta tardó 112 ms para un proceso y 287 ms para todos (adentro de PowerShell; el
// arranque de PowerShell va aparte).
//
// LO QUE WINDOWS NO DA, y por eso acá la prueba del lanzador es OTRA que en Linux: no hay una
// forma simple de leer el ENTORNO con el que arrancó otro proceso (en Linux es
// `/proc/<pid>/environ`). Y `cmd` no hace `exec`: el lanzador queda como PADRE de OpenCode en
// vez de transformarse en él. Entonces en Windows no se prueba "el ancestro arrancó con la marca
// apuntándose a sí mismo" sino "un ancestro ES el lanzador instalado": `cmd.exe` corriendo
// exactamente `abrir-tecnia-bot.cmd` de la carpeta del producto, y nada más en esa línea.
//
// LO QUE ESTO NO ES, igual que en Linux: una barrera contra alguien que lanza procesos como el
// usuario. Quien arme a mano un `cmd /c` con esa misma línea la falsifica. Protege contra el
// caso real: abrir OpenCode sin pasar por la revisión previa del lanzador.
//
// PIDs REUSADOS. Windows guarda en cada proceso el pid de su padre y no lo actualiza cuando el
// padre muere; ese número puede tocarle después a un proceso cualquiera. Un "padre" que arrancó
// DESPUÉS que su hijo no es su padre: ahí se corta la cadena (`ancestrosEnWindows`).
//
// Este módulo importa sólo `node:`.

import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { win32 } from "node:path"

export interface ProcesoWindows {
  readonly pid: number
  readonly ppid: number
  /** El nombre de la imagen, como lo da Windows (`cmd.exe`). */
  readonly nombre: string
  /** La ruta REAL del ejecutable (`ExecutablePath`); `null` si Windows no la entrega. No sale de la línea de comando, que la escribe quien lanza. */
  readonly ruta: string | null
  /** La línea de comando entera; `null` si Windows no la entrega (procesos del sistema o de otro usuario). */
  readonly linea: string | null
  /** Cuándo arrancó (FILETIME en UTC); `null` si Windows no lo entrega. */
  readonly creado: bigint | null
}

/**
 * Lo que se le pide a PowerShell. Sale por `ConvertTo-Json` en UTF-8 (por defecto PowerShell
 * escribe al pipe en la página de códigos de la consola y un usuario con ñ llega roto). La
 * fecha va como TEXTO: un FILETIME no entra en un número de JavaScript sin perder precisión.
 * `@(...)` fuerza una lista aunque hubiera un solo proceso.
 */
export const CONSULTA_DE_PROCESOS = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$p = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [string]$_.ProcessId; ppid = [string]$_.ParentProcessId; nombre = [string]$_.Name; ruta = $_.ExecutablePath; linea = $_.CommandLine; creado = $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { $null }) } })",
  "ConvertTo-Json -InputObject $p -Compress -Depth 2",
].join("\n")

const enteroDePid = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{1,10}$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * La salida de `CONSULTA_DE_PROCESOS` → la lista. `null` si no es lo que se esperaba: una
 * lista de procesos con UNA entrada mal formada no se usa a medias (el que falta podría ser
 * justo el ancestro que se busca). Pura.
 */
export function interpretarProcesos(texto: string): ProcesoWindows[] | null {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto.replace(/^\uFEFF/, ""))
  } catch {
    return null
  }
  if (!Array.isArray(crudo) || crudo.length === 0) return null
  const salida: ProcesoWindows[] = []
  for (const x of crudo) {
    if (typeof x !== "object" || x === null) return null
    const o = x as Record<string, unknown>
    const pid = enteroDePid(o.pid)
    const ppid = enteroDePid(o.ppid)
    if (pid === null || ppid === null || typeof o.nombre !== "string") return null
    if (o.linea !== null && typeof o.linea !== "string") return null
    if (o.ruta !== null && typeof o.ruta !== "string") return null
    let creado: bigint | null = null
    if (o.creado !== null) {
      if (typeof o.creado !== "string" || !/^\d{1,20}$/.test(o.creado)) return null
      creado = BigInt(o.creado)
    }
    salida.push({ pid, ppid, nombre: o.nombre, ruta: o.ruta as string | null, linea: o.linea as string | null, creado })
  }
  return salida
}

/** Cómo se corre PowerShell. Inyectable para probar sin Windows. */
export type CorrerPowerShell = (ejecutable: string, args: string[]) => { status: number | null; stdout: string }

/** La carpeta de Windows según el entorno (`SystemRoot`), o `C:\Windows` si no es una ruta. */
export function raizDeWindows(entorno: NodeJS.ProcessEnv = process.env): string {
  const raiz = entorno.SystemRoot ?? entorno.SYSTEMROOT ?? entorno.windir
  return raiz && win32.isAbsolute(raiz) ? raiz : "C:\\Windows"
}

/**
 * El PowerShell de Windows por su ruta ENTERA (`%SystemRoot%\System32\WindowsPowerShell\v1.0`),
 * no por el PATH: de esta consulta depende que se permita cargar, y un `powershell.exe` puesto
 * antes en el PATH (o en la carpeta de proyectos) contestaría lo que quisiera.
 *
 * LO QUE ESTO NO CUBRE, dicho como es: `SystemRoot` y `LOCALAPPDATA` también son variables
 * heredadas. Quien abra OpenCode con esas variables cambiadas a propósito elige qué PowerShell
 * contesta y qué `.cmd` cuenta como lanzador. En Linux `/proc` no depende del entorno: acá la
 * garantía es más débil en ese punto. Cubre el accidente (un PATH raro), no al que lo arma.
 */
export function rutaDePowerShell(entorno: NodeJS.ProcessEnv = process.env): string {
  return win32.join(raizDeWindows(entorno), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

const correrDeVerdad: CorrerPowerShell = (ejecutable, args) => {
  const r = spawnSync(ejecutable, args, { encoding: "utf8", timeout: 20_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "" }
}

/**
 * Los procesos del sistema, ahora. `null` si no se pudo saber (PowerShell no arrancó, lo frenó
 * una política, tardó de más, contestó otra cosa): quien llama tiene que fallar cerrado.
 * La consulta va con `-EncodedCommand` para no depender de cómo cada shell trata las comillas.
 */
export function leerProcesosDeWindows(correr: CorrerPowerShell = correrDeVerdad, entorno: NodeJS.ProcessEnv = process.env): ProcesoWindows[] | null {
  try {
    const codificada = Buffer.from(CONSULTA_DE_PROCESOS, "utf16le").toString("base64")
    const r = correr(rutaDePowerShell(entorno), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", codificada])
    if (r.status !== 0) return null
    return interpretarProcesos(r.stdout)
  } catch {
    return null
  }
}

/**
 * Los ancestros de `pid` (padre, abuelo, …) según la foto. `null` si `pid` no está en la foto
 * o si no se sabe cuándo arrancó (sin eso no se puede distinguir un padre de un pid reusado).
 * La cadena se corta, sin error, donde el "padre" ya no existe o arrancó después que su hijo.
 */
export function ancestrosEnWindows(pid: number, procesos: readonly ProcesoWindows[]): ProcesoWindows[] | null {
  const porPid = new Map<number, ProcesoWindows>()
  for (const p of procesos) {
    if (porPid.has(p.pid)) return null // dos procesos con el mismo pid en una foto: no es una foto confiable
    porPid.set(p.pid, p)
  }
  let actual = porPid.get(pid)
  if (!actual || actual.creado === null) return null
  const salida: ProcesoWindows[] = []
  const vistos = new Set<number>([pid])
  for (let i = 0; i < 64; i++) {
    const padre = porPid.get(actual.ppid)
    if (!padre || vistos.has(padre.pid)) return salida
    if (padre.creado === null || actual.creado === null || padre.creado > actual.creado) return salida
    salida.push(padre)
    vistos.add(padre.pid)
    actual = padre
  }
  return salida
}

/** Dónde deja el instalador el lanzador: `{localappdata}\TecniaBot` (el `.iss` no deja elegir carpeta). */
export function rutaDelLanzadorEnWindows(entorno: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const local = entorno.LOCALAPPDATA
  return win32.join(local && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local"), "TecniaBot", "abrir-tecnia-bot.cmd")
}

/** Parte una línea en su primer elemento (el programa) y el resto, con la regla de Windows para el programa: hasta la comilla que cierra, o hasta el primer blanco. */
export function programaYResto(linea: string): { programa: string; resto: string } {
  const t = linea.replace(/^[ \t]+/, "")
  if (t.startsWith('"')) {
    const cierre = t.indexOf('"', 1)
    return cierre < 0 ? { programa: t.slice(1), resto: "" } : { programa: t.slice(1, cierre), resto: t.slice(cierre + 1) }
  }
  const m = t.match(/^[^ \t]*/)!
  return { programa: m[0], resto: t.slice(m[0].length) }
}

/** Caracteres que `cmd` trata como algo más que texto cuando NO van entre comillas. */
const ESPECIAL_PARA_CMD = /[\s&()^%!,;=|<>"]/

/**
 * ¿Este proceso es el `cmd.exe` de Windows corriendo EXACTAMENTE el lanzador instalado, y nada más?
 *
 * Tres cosas, las tres:
 *   1. la imagen REAL del proceso (`ExecutablePath`, no lo que diga su línea) es
 *      `%SystemRoot%\System32\cmd.exe` (o el de `SysWOW64`, que es el mismo `cmd` lanzado por un
 *      programa de 32 bits). Un `cmd.exe` de otra carpeta no cuenta;
 *   2. después del programa viene `/c` y nada antes (ni `/k`, ni `/v:on`, ni `/d`);
 *   3. lo que sigue a `/c` es la ruta del lanzador y NADA más, en una de las formas en que `cmd`
 *      corre una sola ruta: `""ruta""` (la medida: acceso directo del escritorio y del menú
 *      inicio), `"ruta"`, o `ruta` sin comillas SÓLO si no tiene espacios ni caracteres que
 *      `cmd` interprete. Con un usuario «Juan Perez» o «Tom&Jerry», la forma sin comillas no
 *      corre el lanzador (cmd correría `C:\Users\Juan` o `C:\Users\Tom`), y por eso no se acepta.
 *
 * La primera versión de esta función le sacaba TODAS las comillas a la línea y miraba el final.
 * La revisión independiente mostró que así pasaban `C:\Temp\cmd.exe /c …`, `cmd.exe -x \cmd /c …`
 * y las formas sin comillas con espacios. Ninguna es un accidente, pero la función decía
 * «exactamente» y no lo era.
 */
export function esElLanzadorInstalado(p: Pick<ProcesoWindows, "nombre" | "ruta" | "linea">, rutaDelLanzador: string, entorno: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof p.linea !== "string" || typeof p.ruta !== "string") return false
  const raiz = raizDeWindows(entorno)
  const imagen = p.ruta.toLowerCase()
  if (imagen !== win32.join(raiz, "System32", "cmd.exe").toLowerCase() && imagen !== win32.join(raiz, "SysWOW64", "cmd.exe").toLowerCase()) return false
  const m = programaYResto(p.linea).resto.match(/^[ \t]+\/c[ \t]+(.*)$/i)
  if (!m) return false
  const cola = m[1]!.replace(/[ \t]+$/, "")
  let ruta: string
  if (cola.length >= 4 && cola.startsWith('""') && cola.endsWith('""')) ruta = cola.slice(2, -2)
  else if (cola.length >= 2 && cola.startsWith('"') && cola.endsWith('"')) ruta = cola.slice(1, -1)
  else if (!ESPECIAL_PARA_CMD.test(cola)) ruta = cola
  else return false
  // Una comilla que haya quedado adentro no necesita un chequeo aparte: la ruta del lanzador no
  // tiene comillas (Windows no las admite en nombres de archivo), así que nunca va a ser igual.
  return ruta.toLowerCase() === rutaDelLanzador.toLowerCase()
}

/** El valor que `abrir-tecnia-bot.cmd` le pone a `TECNIA_LANZADOR` cuando su revisión dio limpio. */
export const MARCA_DEL_LANZADOR_EN_WINDOWS = "lanzador-cmd"

/**
 * Por qué el lanzador NO dejó la marca, según él mismo (`TECNIA_SIN_MARCA`). Sirve sólo para
 * elegir el texto: sin esto, a un docente sin Node se le contestaba «abrilo desde el acceso
 * directo», que es de donde lo abrió, y no tenía cómo salir (hallazgo de la revisión
 * independiente). No habilita nada: un valor que no esté en esta lista se ignora.
 */
export function consejoSegunElLanzador(motivo: string | undefined): string | null {
  if (motivo === "sin-node") return "El lanzador de Tecnia Bot no encontró Node, que es con lo que revisa la carpeta antes de abrir. Hay que abrir «Reparar Tecnia Bot» desde el menú inicio y, cuando termine, volver a abrir Tecnia Bot."
  if (motivo === "sin-revision") return "A la instalación de Tecnia Bot le falta el archivo con el que revisa la carpeta antes de abrir. Hay que abrir «Reparar Tecnia Bot» desde el menú inicio y, cuando termine, volver a abrir Tecnia Bot."
  return null
}

export interface LanzamientoEnWindows {
  /** `TECNIA_LANZADOR` de este proceso. */
  readonly marca: string | undefined
  readonly pid: number
  /** La foto de procesos, o `null` si no se pudo sacar. */
  readonly procesos: readonly ProcesoWindows[] | null
  readonly rutaDelLanzador: string
  /** De dónde sale `SystemRoot` para ubicar el `cmd.exe` verdadero. Por defecto, `process.env`. */
  readonly entorno?: NodeJS.ProcessEnv
}

/**
 * `null` si este OpenCode viene del lanzador de Windows y su revisión previa dio limpio; si
 * no, por qué no. Hacen falta LAS DOS cosas: la marca (la revisión dio limpio: el lanzador la
 * borra al empezar y la pone sólo en ese caso) y que un ancestro sea el lanzador instalado (la
 * marca la puso él, y no quedó de otra ventana ni la escribió alguien antes de abrir OpenCode
 * a mano).
 */
export function porQueNoVieneDelLanzadorEnWindows(l: LanzamientoEnWindows): string | null {
  if (l.marca !== MARCA_DEL_LANZADOR_EN_WINDOWS) return "OpenCode no se abrió con el acceso directo de Tecnia Bot, o la revisión de la carpeta no dio limpio"
  if (l.procesos === null) return "no pude comprobar cómo se abrió OpenCode"
  const ancestros = ancestrosEnWindows(l.pid, l.procesos)
  if (ancestros === null) return "no pude comprobar cómo se abrió OpenCode"
  return ancestros.some((a) => esElLanzadorInstalado(a, l.rutaDelLanzador, l.entorno)) ? null : "OpenCode no se abrió con el acceso directo de Tecnia Bot"
}

/**
 * La línea de comando de OpenCode en Windows: el programa y NADA más.
 *
 * POR QUÉ TAN ESTRICTO. En Linux `/proc/self/cmdline` entrega los argumentos YA partidos, tal
 * cual los ve el programa. En Windows un proceso tiene una sola cadena y cada programa la parte
 * con sus reglas. La primera versión de este módulo traía un partidor con las reglas del
 * runtime de C y le pasaba el resultado a `porQueElLanzamientoNoPermiteCargar`. La revisión
 * independiente encontró el agujero: con `--prompt "a"" --port=4096"` ese partidor veía UN
 * valor de `--prompt`, y con la regla de `CommandLineToArgvW` el programa vería `--port=4096`
 * aparte. Cuál de las dos usa el binario de OpenCode no se midió. Un control que depende de
 * adivinar cómo parte la línea otro programa no es un control.
 *
 * El lanzador abre OpenCode SIN argumentos (`"%OC%"`, medido: la línea es sólo la ruta entre
 * comillas). Entonces en Windows no se interpreta nada: si después del programa hay algo que
 * no sea espacio, no se carga. Es más estricto que Linux (que admite `--agent`, `--model`…),
 * y es a propósito.
 *
 * Devuelve el programa, o `null` si la línea trae algo más (o está vacía).
 */
export function soloElPrograma(linea: string): string | null {
  const { programa, resto } = programaYResto(linea)
  if (programa === "" || !/^[ \t]*$/.test(resto)) return null
  return programa
}
