// Transporte serie del Modo Vivo (protocolo v1, slices V1–V4) — MODO-VIVO-PLAN.md §10.2. ÚNICO
// módulo de `vivo/` con I/O.
//
// Lanza `puente-serie.py` con el Python del penv de PlatformIO (que ya trae pyserial) como proceso
// hijo y lo expone como un `Puente` de líneas: lo que se manda va a stdin, lo que llega de stdout se
// entrega línea por línea, y stderr trae el centinela `PUERTO_ABIERTO` o el código de la falla.
//
// El Python se busca en los MISMOS lugares que `platformio.ts::pioCandidatos` busca `pio`
// (`PLATFORMIO_CORE_DIR`, `$HOME/.platformio`, y en Windows la raíz del disco del perfil y
// `C:\.platformio` — docs/rutas-no-ascii.md), porque es el mismo penv. Inyectable para los tests.
// La búsqueda se REPLICA en vez de importarse (auditoría A6 K-05): `platformio.ts` sólo exporta las
// rutas de los binarios, no las carpetas, e importarlo desde acá metería `@opencode-ai/plugin` en
// `vivo/` e invertiría la dirección `tool/ → vivo/` (varios tests copian `platformio.ts` a un
// directorio temporal con un plugin falso justamente porque no se importa tal cual).
//
// `node:child_process` a propósito y no `Bun.spawn`: Bun lo implementa igual y así los tests corren
// con `node --test` como el resto de `tests/`.

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, win32 } from "node:path"
import { fileURLToPath } from "node:url"
import type { Puente } from "./sesion-viva.ts"

export const SCRIPT_PUENTE = join(dirname(fileURLToPath(import.meta.url)), "puente-serie.py")

/**
 * Códigos que puede traer `ErrorDePuente.codigo` o el motivo de `alCerrar`. Los que empiezan con
 * `PUERTO_` los emite `puente-serie.py` (con su código de salida): `PUERTO_NO_ABIERTO` también
 * cubre "otro proceso lo tiene abierto" (`exclusive=True`, auditoría A1 M1); `PUERTO_PERDIDO` es
 * el puerto que desapareció en el medio (Linux: EIO al leer; en Windows pyserial lo reporta de otra
 * forma y no está verificado); `ESCRITURA_VENCIDA` es una escritura que no entró en 1 s (la placa
 * dejó de drenar el UART), distinta de perder el puerto.
 */
export const CODIGOS_DE_PUENTE = Object.freeze([
  "PYTHON_NO_ENCONTRADO",
  "PUENTE_NO_LANZADO",
  "PUERTO_NO_ABIERTO",
  "PYSERIAL_AUSENTE",
  "PUERTO_PERDIDO",
  "ESCRITURA_VENCIDA",
  "PUENTE_TERMINADO",
  "PUENTE_SALIO",
] as const)

export type CodigoDePuente = (typeof CODIGOS_DE_PUENTE)[number]

function esCodigoDePuente(valor: string): valor is CodigoDePuente {
  return (CODIGOS_DE_PUENTE as readonly string[]).includes(valor)
}

// Sin "parameter properties": Node en modo strip-only (`node --test` sobre `.ts`) no las acepta.
export class ErrorDePuente extends Error {
  readonly codigo: CodigoDePuente
  constructor(codigo: CodigoDePuente, detalle: string) {
    super(`${codigo}: ${detalle}`)
    this.name = "ErrorDePuente"
    this.codigo = codigo
  }
}

function unicos(valores: (string | undefined | false)[]): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === "string" && v.length > 0))]
}

/**
 * Candidatos al Python del penv, en el orden de `pioCandidatos` (`platformio.ts`): la variable del
 * usuario gana, después el home, y en Windows la raíz del disco del perfil (`C:\.platformio`, el
 * caso de un usuario con tilde) y `C:\.platformio` fijo. Parámetros para poder probar el caso
 * Windows desde Linux.
 */
export function pythonCandidatos(home: string = homedir(), plataforma: string = process.platform, entorno: Record<string, string | undefined> = process.env): string[] {
  const core = entorno.PLATFORMIO_CORE_DIR
  if (plataforma === "win32") {
    const raiz = win32.parse(home).root
    const dirs = unicos([core, win32.join(home, ".platformio"), raiz && win32.join(raiz, ".platformio"), "C:\\.platformio"])
    return dirs.map((d) => win32.join(d, "penv", "Scripts", "python.exe"))
  }
  const dirs = unicos([core, join(home, ".platformio")])
  return dirs.flatMap((d) => ["python", "python3"].map((n) => join(d, "penv", "bin", n)))
}

/** El primer Python del penv que existe en disco, o `undefined` (no se cae al PATH: ese Python no tiene pyserial). */
export function pythonDelPenv(): string | undefined {
  return pythonCandidatos().find((c) => existsSync(c))
}

export interface OpcionesPuenteSerie {
  readonly puerto: string
  /** Contrato §1: 115200 8N1. */
  readonly baudios?: number
  /** Ruta explícita del Python con pyserial (tests, o un docente con un penv en otro lado). */
  readonly python?: string
  readonly script?: string
}

/** El primer token de una línea de stderr del puente es su código; el resto es detalle. Un token que no es un código conocido se reporta como `PUENTE_SALIO`. */
function codigoDe(linea: string): CodigoDePuente {
  const token = linea.split(" ")[0] ?? ""
  return esCodigoDePuente(token) ? token : "PUENTE_SALIO"
}

/**
 * Lanza el puente y resuelve recién cuando el puerto quedó abierto (centinela `PUERTO_ABIERTO`
 * por stderr): nunca se supone que "todavía no falló" es "abrió". Si el proceso termina antes,
 * rechaza con un `ErrorDePuente` cuyo `codigo` es el de stderr (`PUERTO_NO_ABIERTO`, …).
 */
export function abrirPuenteSerie(opciones: OpcionesPuenteSerie): Promise<Puente> {
  const python = opciones.python ?? pythonDelPenv()
  if (!python) return Promise.reject(new ErrorDePuente("PYTHON_NO_ENCONTRADO", `no hay un penv de PlatformIO en ${pythonCandidatos().join(", ")}`))
  const script = opciones.script ?? SCRIPT_PUENTE
  const baudios = opciones.baudios ?? 115200

  return new Promise<Puente>((resolver, rechazar) => {
    // `-I`: Python aislado (sin PYTHON*, sin site del usuario, sin el directorio del script en
    // sys.path); el penv sigue viendo su propio site-packages, que es donde está pyserial.
    const hijo = spawn(python, ["-I", script, "--puerto", opciones.puerto, "--baudios", String(baudios)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    const receptores = new Set<(linea: string) => void>()
    const cierres = new Set<(motivo: string) => void>()
    let abierto = false
    let cerrado = false
    let restoStdout = ""
    let restoStderr = ""
    let ultimaStderr = ""

    const entregar = (linea: string) => {
      for (const receptor of receptores) receptor(linea)
    }

    hijo.stdout.setEncoding("utf8")
    hijo.stdout.on("data", (trozo: string) => {
      restoStdout += trozo
      let fin: number
      while ((fin = restoStdout.indexOf("\n")) >= 0) {
        const linea = restoStdout.slice(0, fin).replace(/\r$/, "")
        restoStdout = restoStdout.slice(fin + 1)
        entregar(linea)
      }
    })

    hijo.stderr.setEncoding("utf8")
    hijo.stderr.on("data", (trozo: string) => {
      restoStderr += trozo
      let fin: number
      while ((fin = restoStderr.indexOf("\n")) >= 0) {
        const linea = restoStderr.slice(0, fin).replace(/\r$/, "").trim()
        restoStderr = restoStderr.slice(fin + 1)
        if (linea.length === 0) continue
        if (linea.startsWith("PUERTO_ABIERTO") && !abierto) {
          abierto = true
          resolver(puente)
        } else ultimaStderr = linea
      }
    })

    const terminar = (motivo: string) => {
      if (cerrado) return
      cerrado = true
      if (!abierto) rechazar(new ErrorDePuente(codigoDe(motivo), motivo))
      for (const cierre of cierres) cierre(codigoDe(motivo))
    }

    hijo.on("error", (error) => terminar(`PUENTE_NO_LANZADO ${error.message}`))
    hijo.on("close", (codigo, senal) => {
      if (ultimaStderr) terminar(ultimaStderr)
      else terminar(codigo === 0 ? "PUENTE_TERMINADO salida limpia" : `PUENTE_SALIO codigo=${String(codigo)} senal=${String(senal)}`)
    })
    hijo.stdin.on("error", () => {
      // Un EPIPE al escribir después de que el hijo murió: el `close` del hijo ya informa el motivo.
    })

    const puente: Puente = {
      enviar(linea) {
        if (cerrado || !hijo.stdin.writable) return
        hijo.stdin.write(`${linea}\n`)
      },
      alRecibir(cb) {
        receptores.add(cb)
        return () => void receptores.delete(cb)
      },
      alCerrar(cb) {
        cierres.add(cb)
        return () => void cierres.delete(cb)
      },
      cerrar() {
        return new Promise<void>((listo) => {
          if (cerrado) return listo()
          // Cerrar stdin es la señal de terminar para el script; si no sale solo, se lo mata.
          const limite = setTimeout(() => hijo.kill(), 2000)
          hijo.once("close", () => {
            clearTimeout(limite)
            listo()
          })
          hijo.stdin.end()
        })
      },
    }
  })
}
