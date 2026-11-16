// `carga/arbol.ts` — cortar una carga de verdad: el hijo Y TODOS SUS DESCENDIENTES.
//
// POR QUÉ (Q-01 del QA de H1). `pio` no graba: lanza `scons`, y `scons` lanza `esptool`
// (o `avrdude`). Matar sólo al hijo directo deja a `esptool` vivo, reparentado, escribiendo
// la placa DESPUÉS de que Tecnia Bot dijo "cancelado". Eso es una operación de carga activa
// después de cancelarse, y el owner lo definió como bloqueante.
//
// CÓMO (opción A del pedido: lo que se puede probar acá, sin depender de opciones de
// `Bun.spawn` que no hay forma de verificar sin Bun):
//   1. Se enumera el árbol del hijo ANTES de matar a nadie: muerto el padre, los nietos pasan
//      a colgar de init (o de un subreaper) y el vínculo se pierde.
//   2. Se CONGELA todo el árbol (SIGSTOP) y se vuelve a enumerar hasta que no aparezca nadie
//      nuevo: un proceso congelado no puede lanzar otro entre la foto y la señal.
//   3. SIGTERM a todos y SIGCONT (para que lo reciban), espera con tope, SIGKILL a los que
//      queden, espera con tope, y se comprueba que no quede ninguno vivo.
// En Linux la foto sale de `/proc/*/stat` (sin lanzar nada); en otros Unix de
// `ps -A -o pid=,ppid=,stat=`; en Windows se usa `taskkill /PID <pid> /T /F`. Los comandos
// auxiliares van con argv FIJO (sólo el pid, que es un número), por `spawnSync` de Node y
// NUNCA por `run()`: no son una carga y no pasan por la guardia.
//
// LÍMITES QUE NO SE ESCONDEN.
//   - Un zombi (`Z`) cuenta como muerto: ya no ejecuta nada.
//   - Reuso de PID: entre la foto y la señal pasan milisegundos; si en ese lapso un PID del
//     árbol muriera y el sistema lo diera a otro proceso, la señal le llegaría a ése. No se
//     puede descartar del todo sin pidfd; se acepta por la ventana chica.
//   - Windows: NO VERIFICADO. `taskkill /T` mata el árbol que conoce Windows; "confirmado"
//     ahí es "taskkill terminó bien y el hijo ya no existe", no una enumeración propia.
//   - Un descendiente que se escapó a otra sesión con doble fork ANTES de la foto sigue
//     siendo descendiente por PPID sólo si su padre vivía en la foto; si no, no se ve. Ni
//     `pio` ni `scons` ni `esptool` hacen eso.
//
// Este módulo importa sólo `node:`.

import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"

/** Cuánto se espera a que el árbol termine después de SIGTERM antes de pasar a SIGKILL. */
export const TOPE_TERM_MS = 2_000
/** Cuánto se espera después de SIGKILL antes de declarar que NO se pudo confirmar. */
export const TOPE_KILL_MS = 2_000
/** Cada cuánto se vuelve a mirar si quedan vivos (es una espera por condición, con tope). */
const INTERVALO_MS = 25

export interface Proceso {
  pid: number
  ppid: number
  /** Zombi: terminó y sólo falta que lo recojan. No ejecuta nada. */
  zombi: boolean
}

/** Lo que el algoritmo necesita del sistema. Inyectable para probar los caminos raros. */
export interface Sistema {
  plataforma: NodeJS.Platform
  /** Foto de los procesos del sistema; `null` si no se pudo sacar. */
  foto(): Proceso[] | null
  senal(pid: number, senal: NodeJS.Signals): void
  /** Sólo Windows. `true` si `taskkill /T /F` terminó bien. */
  taskkill(pid: number): boolean
}

/** Linux: `/proc/<pid>/stat`. El nombre va entre paréntesis y puede tener espacios: se corta en el último `)`. */
function fotoDeProc(): Proceso[] | null {
  let entradas: string[]
  try {
    entradas = readdirSync("/proc")
  } catch {
    return null
  }
  const salida: Proceso[] = []
  for (const e of entradas) {
    if (!/^\d+$/.test(e)) continue
    try {
      const stat = readFileSync(`/proc/${e}/stat`, "utf8")
      const resto = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      salida.push({ pid: Number(e), ppid: Number(resto[1]), zombi: resto[0] === "Z" || resto[0] === "X" })
    } catch {
      // terminó mientras se leía: no está
    }
  }
  return salida
}

/** Otros Unix: `ps`, con argv fijo y sin shell. */
function fotoDePs(): Proceso[] | null {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid=,stat="], { encoding: "utf8", timeout: 5_000 })
  if (r.status !== 0 || typeof r.stdout !== "string") return null
  const salida: Proceso[] = []
  for (const linea of r.stdout.split("\n")) {
    const m = linea.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/)
    if (m) salida.push({ pid: Number(m[1]), ppid: Number(m[2]), zombi: m[3]!.startsWith("Z") })
  }
  return salida
}

export function sistemaReal(plataforma: NodeJS.Platform = process.platform): Sistema {
  return {
    plataforma,
    foto: () => (plataforma === "linux" ? (fotoDeProc() ?? fotoDePs()) : fotoDePs()),
    senal: (pid, senal) => {
      try {
        process.kill(pid, senal)
      } catch {
        // ya no existe (ESRCH) o no es nuestro (EPERM): lo dirá la comprobación final
      }
    },
    taskkill: (pid) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 10_000 }).status === 0,
  }
}

/** `raiz` y todos sus descendientes según la foto (por PPID). */
export function arbolDe(raiz: number, foto: readonly Proceso[]): number[] {
  const hijos = new Map<number, number[]>()
  for (const p of foto) hijos.set(p.ppid, [...(hijos.get(p.ppid) ?? []), p.pid])
  const arbol: number[] = []
  const pendientes = [raiz]
  const vistos = new Set<number>()
  while (pendientes.length > 0) {
    const pid = pendientes.shift()!
    if (vistos.has(pid)) continue
    vistos.add(pid)
    arbol.push(pid)
    pendientes.push(...(hijos.get(pid) ?? []))
  }
  return arbol
}

/** Los de `pids` que siguen vivos (presentes y no zombis), o `null` si no se pudo mirar. */
function vivos(pids: ReadonlySet<number>, sis: Sistema): number[] | null {
  const foto = sis.foto()
  if (!foto) return null
  return foto.filter((p) => pids.has(p.pid) && !p.zombi).map((p) => p.pid)
}

async function esperarQueMueran(pids: ReadonlySet<number>, sis: Sistema, topeMs: number): Promise<number[] | null> {
  const fin = Date.now() + topeMs
  for (;;) {
    const quedan = vivos(pids, sis)
    if (quedan === null || quedan.length === 0 || Date.now() >= fin) return quedan
    await new Promise((listo) => setTimeout(listo, INTERVALO_MS))
  }
}

export interface FinDelArbol {
  /** `true` sólo si se comprobó que no queda ningún proceso del árbol vivo. */
  confirmado: boolean
  detalle: string
}

/**
 * Termina `raiz` y todo su árbol, y dice si lo pudo CONFIRMAR. Nunca tira. Vuelve cuando no
 * queda nadie o cuando vencieron los topes (`TOPE_TERM_MS` + `TOPE_KILL_MS`).
 */
export async function terminarArbol(raiz: number, sis: Sistema = sistemaReal(), topes: { term: number; kill: number } = { term: TOPE_TERM_MS, kill: TOPE_KILL_MS }): Promise<FinDelArbol> {
  try {
    if (!Number.isSafeInteger(raiz) || raiz <= 0) return { confirmado: false, detalle: "no sé el pid del proceso de carga" }
    if (sis.plataforma === "win32") {
      const ok = sis.taskkill(raiz)
      const quedan = vivos(new Set([raiz]), sis)
      return ok && quedan !== null && quedan.length === 0 ? { confirmado: true, detalle: "taskkill /T terminó el árbol" } : { confirmado: false, detalle: "taskkill no pudo confirmar que el árbol terminó" }
    }

    // 1-2. Foto, congelar, y volver a mirar hasta que no aparezca nadie nuevo.
    const primera = sis.foto()
    if (!primera) {
      sis.senal(raiz, "SIGKILL")
      return { confirmado: false, detalle: "no pude ver los procesos del sistema" }
    }
    const arbol = new Set(arbolDe(raiz, primera))
    for (const pid of arbol) sis.senal(pid, "SIGSTOP")
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const foto = sis.foto()
      if (!foto) break
      const nuevos = [...arbol].flatMap((pid) => arbolDe(pid, foto)).filter((pid) => !arbol.has(pid))
      if (nuevos.length === 0) break
      for (const pid of nuevos) {
        arbol.add(pid)
        sis.senal(pid, "SIGSTOP")
      }
    }

    // 3. TERM (y CONT para que lo reciban), espera, KILL a los que queden, espera.
    for (const pid of arbol) sis.senal(pid, "SIGTERM")
    for (const pid of arbol) sis.senal(pid, "SIGCONT")
    let quedan = await esperarQueMueran(arbol, sis, topes.term)
    if (quedan === null || quedan.length > 0) {
      for (const pid of quedan ?? arbol) sis.senal(pid, "SIGKILL")
      quedan = await esperarQueMueran(arbol, sis, topes.kill)
    }
    if (quedan === null) return { confirmado: false, detalle: "no pude volver a mirar los procesos después de cortarlos" }
    if (quedan.length > 0) return { confirmado: false, detalle: `quedan ${quedan.length} proceso(s) de la carga vivos` }
    return { confirmado: true, detalle: `terminé ${arbol.size} proceso(s) de la carga y comprobé que no queda ninguno` }
  } catch (error) {
    return { confirmado: false, detalle: `falló el corte (${error instanceof Error ? error.message : String(error)})` }
  }
}
