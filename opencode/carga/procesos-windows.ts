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
  "$p = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [string]$_.ProcessId; ppid = [string]$_.ParentProcessId; nombre = [string]$_.Name; linea = $_.CommandLine; creado = $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { $null }) } })",
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
    let creado: bigint | null = null
    if (o.creado !== null) {
      if (typeof o.creado !== "string" || !/^\d{1,20}$/.test(o.creado)) return null
      creado = BigInt(o.creado)
    }
    salida.push({ pid, ppid, nombre: o.nombre, linea: o.linea as string | null, creado })
  }
  return salida
}

/** Cómo se corre PowerShell. Inyectable para probar sin Windows. */
export type CorrerPowerShell = (ejecutable: string, args: string[]) => { status: number | null; stdout: string }

/**
 * El PowerShell de Windows por su ruta ENTERA (`%SystemRoot%\System32\WindowsPowerShell\v1.0`),
 * no por el PATH: de esta consulta depende que se permita cargar, y un `powershell.exe` puesto
 * antes en el PATH contestaría lo que quisiera.
 */
export function rutaDePowerShell(entorno: NodeJS.ProcessEnv = process.env): string {
  const raiz = entorno.SystemRoot ?? entorno.SYSTEMROOT ?? entorno.windir
  return win32.join(raiz && win32.isAbsolute(raiz) ? raiz : "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
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

/**
 * ¿Esta línea de comando es `cmd.exe` corriendo EXACTAMENTE el lanzador instalado, y nada más?
 *
 * La forma medida (acceso directo del escritorio y del menú inicio) es
 * `"C:\Windows\system32\cmd.exe" /C ""<ruta>\abrir-tecnia-bot.cmd""`. `cmd` no parte su línea
 * como un programa común, así que no se la interpreta: se le sacan las comillas y tiene que
 * quedar `…cmd.exe /c <ruta del lanzador>`, sin nada antes, en el medio ni después. Una línea
 * con `&`, con otra opción o con argumentos para el lanzador no pasa. Comillas adentro de una
 * ruta no puede haber: Windows no las admite en nombres de archivo.
 */
export function esElLanzadorInstalado(p: Pick<ProcesoWindows, "nombre" | "linea">, rutaDelLanzador: string): boolean {
  if (p.nombre.toLowerCase() !== "cmd.exe" || typeof p.linea !== "string") return false
  const limpia = p.linea.replace(/"/g, "").trim()
  const m = limpia.match(/^(?:[a-z]:\\(?:[^\\/:*?<>|\r\n]+\\)*)?cmd(?:\.exe)?\s+\/c\s+(.+)$/i)
  if (!m) return false
  return m[1]!.trim().toLowerCase() === rutaDelLanzador.toLowerCase()
}

/** El valor que `abrir-tecnia-bot.cmd` le pone a `TECNIA_LANZADOR` cuando su revisión dio limpio. */
export const MARCA_DEL_LANZADOR_EN_WINDOWS = "lanzador-cmd"

export interface LanzamientoEnWindows {
  /** `TECNIA_LANZADOR` de este proceso. */
  readonly marca: string | undefined
  readonly pid: number
  /** La foto de procesos, o `null` si no se pudo sacar. */
  readonly procesos: readonly ProcesoWindows[] | null
  readonly rutaDelLanzador: string
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
  return ancestros.some((a) => esElLanzadorInstalado(a, l.rutaDelLanzador)) ? null : "OpenCode no se abrió con el acceso directo de Tecnia Bot"
}

/**
 * Parte una línea de comando de Windows en sus argumentos, con las reglas de
 * `CommandLineToArgvW` (las que usa un programa común para armar su `argv`):
 *   - el PRIMER elemento (el programa) va hasta la comilla que cierra si empieza con comilla,
 *     o hasta el primer espacio si no; ahí las barras invertidas no escapan nada;
 *   - en el resto, espacios y tabs separan salvo entre comillas; `2n` barras antes de una
 *     comilla son `n` barras y la comilla abre o cierra; `2n+1` barras son `n` barras y una
 *     comilla literal; barras que no van antes de una comilla son literales; dos comillas
 *     seguidas adentro de comillas son una comilla literal.
 * Pura. La usa `porQueElLanzamientoNoPermiteCargar`, que rechaza todo lo que no reconoce: un
 * caso raro mal partido termina en un rechazo, no en un permiso.
 */
export function partirLineaDeComandoWindows(linea: string): string[] {
  const salida: string[] = []
  let i = 0
  const n = linea.length
  const esBlanco = (c: string | undefined) => c === " " || c === "\t"
  while (i < n && esBlanco(linea[i])) i++
  if (i >= n) return salida
  // El programa.
  let programa = ""
  if (linea[i] === '"') {
    i++
    while (i < n && linea[i] !== '"') programa += linea[i++]
    if (i < n) i++
  } else {
    while (i < n && !esBlanco(linea[i])) programa += linea[i++]
  }
  salida.push(programa)
  // Los argumentos.
  for (;;) {
    while (i < n && esBlanco(linea[i])) i++
    if (i >= n) break
    let actual = ""
    let entreComillas = false
    for (;;) {
      if (i >= n) break
      const c = linea[i]!
      if (!entreComillas && esBlanco(c)) break
      if (c === "\\") {
        let barras = 0
        while (i < n && linea[i] === "\\") {
          barras++
          i++
        }
        if (i < n && linea[i] === '"') {
          actual += "\\".repeat(Math.floor(barras / 2))
          if (barras % 2 === 1) {
            actual += '"'
            i++
          }
          // con barras pares la comilla queda sin consumir: la trata la vuelta que sigue
        } else {
          actual += "\\".repeat(barras)
        }
        continue
      }
      if (c === '"') {
        if (entreComillas && linea[i + 1] === '"') {
          actual += '"'
          i += 2
          continue
        }
        entreComillas = !entreComillas
        i++
        continue
      }
      actual += c
      i++
    }
    salida.push(actual)
  }
  return salida
}
