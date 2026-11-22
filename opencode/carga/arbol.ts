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
//      a colgar de init (o de un subreaper) y el vínculo se pierde. Si el hijo ya no está vivo
//      en esa primera foto, a su pid NO se le manda nada (puede ser de otro proceso).
//      Ciclo 5: al conjunto inicial se suman TODOS los procesos que tienen en su entorno la
//      marca de esta carga (`TECNIA_CARGA=<valor aleatorio>`, que `run()` le pone sólo al hijo
//      y que heredan sus descendientes), estén donde estén en el árbol.
//   2. Se CONGELA todo (SIGSTOP) y se vuelve a enumerar —descendientes y marcados— hasta un
//      punto fijo: un proceso congelado no puede lanzar otro. Si el punto fijo no llega en el
//      tope de vueltas, NO se confirma.
//   3. SIGKILL a todos, TODAVÍA CONGELADOS. Nunca se reanuda (ciclo 2, B-2): con SIGTERM +
//      SIGCONT, un proceso con handler de SIGTERM (scons lo tiene) volvía a correr y podía
//      lanzar un hijo que nadie veía. SIGKILL no necesita SIGCONT.
//   4. COMPROBACIÓN independiente del PPID, hasta que quede vacía (matar y volver a mirar):
//      ningún proceso del usuario con el cwd en la carpeta privada o que la nombre en su línea
//      de comando (ciclo 2, B-3), y ningún proceso con la marca de esta carga (ciclo 5).
//   `confirmado: true` exige TODO: el árbol muerto, cero procesos que referencien la carpeta
//   privada y cero procesos con la marca. Sin carpeta privada o sin marca (la carga heredada de
//   `platformio flash`), o sin `/proc` legible, no se confirma.
//
// LA MARCA (ciclo 5, MEDIDO en 1.18.18 sobre a4c75ee: un nieto que quedó huérfano ANTES del
// corte por doble fork, con cwd `/` y sin nombrar la carpeta, seguía vivo mientras el producto
// decía "confirmé"). Se busca la marca EXACTA en `/proc/<pid>/environ`. Fallar cerrado con
// criterio: un `environ` ilegible de un proceso del MISMO usuario es "no pude confirmar"; los
// de otro usuario se ignoran (no pueden ser de esta carga); uno que desaparece mientras se lee,
// también. Nunca se toca un proceso sin la marca exacta, ni éste ni sus ancestros.
//
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
//   - UN PROCESO QUE SE ESCAPA A PROPÓSITO SIGUE PUDIENDO ESCAPAR: si deja de ser descendiente
//     (doble fork, setsid), LIMPIA su entorno (pierde la marca) y no tiene el cwd en la carpeta
//     privada ni la nombra, no se ve por ninguna de las tres vías. Ni `pio`, ni `scons`, ni
//     `esptool` hacen eso; cerrarlo del todo pide grupos de procesos o cgroups, que no se
//     pueden probar acá. Por eso el mensaje dice lo que se comprobó, no "no quedó nada".
//
// Este módulo importa sólo `node:`.

import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs"
import { basename, isAbsolute, relative } from "node:path"

/** Cuánto se espera después de SIGKILL antes de declarar que NO se pudo confirmar. */
export const TOPE_KILL_MS = 2_000
/** Cuántas veces se vuelve a enumerar el árbol congelado buscando el punto fijo. */
const VUELTAS_PUNTO_FIJO = 5
/** Cuántas veces se barre por la carpeta privada y la marca (matar y volver a mirar). */
const VUELTAS_BARRIDO = 3
/** Cada cuánto se vuelve a mirar si quedan vivos (es una espera por condición, con tope). */
const INTERVALO_MS = 25
/** La forma de una marca de carga: la genera `cargar-programa.ts` con `randomBytes(32)`. */
export const FORMA_MARCA_DE_CARGA = /^[0-9a-f]{64}$/

export interface Proceso {
  pid: number
  ppid: number
  /** Zombi: terminó y sólo falta que lo recojan. No ejecuta nada. */
  zombi: boolean
  /** Cuándo arrancó, en ticks desde el arranque del sistema (`/proc/<pid>/stat`, campo 22). Sólo Linux. */
  inicio?: number
}

/** Cuándo arrancó `pid` (ticks desde el arranque del sistema), o `undefined` si no se puede leer. */
export function inicioDe(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const inicio = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19])
    return Number.isSafeInteger(inicio) && inicio >= 0 ? inicio : undefined
  } catch {
    return undefined
  }
}

/** Procesos con la marca, y cuántos del mismo usuario no se pudieron leer. `null` si no se pudo mirar nada. */
export interface ConMarca {
  pids: number[]
  ilegibles: number
}

/** Lo que el algoritmo necesita del sistema. Inyectable para probar los caminos raros. */
export interface Sistema {
  plataforma: NodeJS.Platform
  /** Foto de los procesos del sistema; `null` si no se pudo sacar. */
  foto(): Proceso[] | null
  /** Procesos vivos (no zombis, no éste) con el cwd adentro de `carpeta` o que la nombran en su línea de comando; `null` si no se pudo mirar. */
  referencian(carpeta: string): number[] | null
  /** Procesos vivos (no zombis, ni éste ni sus ancestros) con `TECNIA_CARGA=<marca>` exacta en su entorno. */
  conMarca(marca: string, desde?: number): ConMarca | null
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
      salida.push({ pid: Number(e), ppid: Number(resto[1]), zombi: resto[0] === "Z" || resto[0] === "X", inicio: Number(resto[19]) })
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

const dentroDe = (hijo: string, padre: string) => {
  const rel = relative(padre, hijo)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/**
 * Linux: procesos del usuario que referencian `carpeta`. Los de otros usuarios no se pueden
 * leer (`readlink` da EACCES) y se saltean: no pueden estar usando una carpeta 0700 nuestra.
 */
function referencianEnProc(carpeta: string): number[] | null {
  let entradas: string[]
  try {
    entradas = readdirSync("/proc")
  } catch {
    return null
  }
  const salida: number[] = []
  for (const e of entradas) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue
    try {
      const stat = readFileSync(`/proc/${e}/stat`, "utf8")
      const estado = stat.slice(stat.lastIndexOf(")") + 2)[0]
      if (estado === "Z" || estado === "X") continue
    } catch {
      continue
    }
    let cwd = ""
    let cmdline = ""
    try {
      cwd = readlinkSync(`/proc/${e}/cwd`)
    } catch {
      /* ajeno o ya terminó */
    }
    try {
      cmdline = readFileSync(`/proc/${e}/cmdline`, "utf8")
    } catch {
      /* ajeno o ya terminó */
    }
    if ((cwd && dentroDe(cwd, carpeta)) || cmdline.split("\0").some((a) => a.includes(carpeta))) salida.push(Number(e))
  }
  return salida
}

/** Este proceso y todos sus ancestros: con la marca o sin ella, a ellos no se les manda nada. */
function esteYSusAncestros(foto: readonly Proceso[]): Set<number> {
  const padres = new Map(foto.map((p) => [p.pid, p.ppid]))
  const salida = new Set<number>()
  for (let pid: number | undefined = process.pid; pid !== undefined && pid > 0 && !salida.has(pid); pid = padres.get(pid)) salida.add(pid)
  return salida
}

/** El código de un error de E/S, o `""`. */
const codigoDe = (error: unknown) => String((error as NodeJS.ErrnoException)?.code ?? "")
const desaparecio = (error: unknown) => ["ENOENT", "ESRCH"].includes(codigoDe(error))

/** Lo que `conMarcaEnProc` le pide a `/proc`. Inyectable: las carreras de abajo no se pueden provocar a pedido con procesos de verdad. */
export interface LectorDeProc {
  foto(): Proceso[] | null
  /** El uid dueño de `/proc/<pid>`. Tira si no se puede mirar. */
  uidDe(pid: number): number
  /** El contenido de un archivo de `/proc`. Tira si no se puede leer. */
  leer(ruta: string): string
}

const lectorReal: LectorDeProc = {
  foto: fotoDeProc,
  uidDe: (pid) => statSync(`/proc/${pid}`).uid,
  leer: (ruta) => readFileSync(ruta, "utf8"),
}

/**
 * ¿`pid` ya no puede estar ejecutando nada? Verdadero si desapareció, si es zombi, o si ya
 * soltó su memoria (`statm` empieza con «0 »: el proceso está adentro de `exit`, no vuelve a
 * correr código de usuario y no puede seguir grabando una placa).
 *
 * POR QUÉ EXISTE. `environ` de un proceso que se está muriendo da EACCES, no ENOENT: el
 * proceso todavía figura en `/proc`, pero ya no tiene memoria de la que leer el entorno.
 * Contarlo como "ilegible" hacía que el corte de una carga dijera «no pude confirmar… puede
 * que siga grabándose» cada vez que CUALQUIER programa del mismo usuario cerraba un proceso
 * en ese instante: una carga que sí se había frenado quedaba como dudosa, con el puerto
 * retenido. Medido el 2026-11-22: hasta 79 de 250 cortes con procesos de Node muriendo
 * alrededor, y era la causa de las fallas intermitentes de tests/carga-arbol.test.mjs.
 *
 * FALLA CERRADO: si no se puede leer `stat` o `statm` por algo que no sea "ya no está", la
 * respuesta es `false` y el proceso se sigue contando como ilegible. Un proceso VIVO que de
 * verdad no deja leer su entorno (no volcable) tiene memoria, así que también da `false`.
 */
export function yaNoEjecuta(pid: number, leer: (ruta: string) => string = lectorReal.leer): boolean {
  try {
    const stat = leer(`/proc/${pid}/stat`)
    const estado = stat.slice(stat.lastIndexOf(")") + 2)[0]
    if (estado === "Z" || estado === "X") return true
    return leer(`/proc/${pid}/statm`).startsWith("0 ")
  } catch (error) {
    return desaparecio(error)
  }
}

/**
 * Linux: procesos con la marca exacta en su `/proc/<pid>/environ`. Ver "LA MARCA" arriba.
 *
 * `desde`: cuándo arrancó el hijo de la carga. Un `environ` ilegible cuenta como "no pude
 * confirmar" sólo si ese proceso arrancó en ese momento o después. MEDIDO en la compu de
 * desarrollo: hay procesos del mismo usuario con `environ` ilegible que existen desde mucho
 * antes (`systemd --user`, `(sd-pam)`, procesos de contenedores): están en casi cualquier
 * escritorio Linux, y contarlos haría imposible confirmar un corte. Un proceso que arrancó
 * ANTES que la carga no puede tener la marca: es aleatoria y se crea para esta carga. Sin
 * `desde`, todos cuentan (falla cerrado).
 */
export function conMarcaEnProc(marca: string, desde?: number, lector: LectorDeProc = lectorReal): ConMarca | null {
  const foto = lector.foto()
  if (!foto) return null
  const intocables = esteYSusAncestros(foto)
  const uid = typeof process.getuid === "function" ? process.getuid() : -1
  const buscada = `TECNIA_CARGA=${marca}`
  const salida: ConMarca = { pids: [], ilegibles: 0 }
  const puedeSerDeLaCarga = (p: Proceso) => desde === undefined || p.inicio === undefined || !Number.isSafeInteger(p.inicio) || p.inicio >= desde
  for (const p of foto) {
    if (p.zombi || intocables.has(p.pid)) continue
    let suyo: boolean
    try {
      suyo = lector.uidDe(p.pid) === uid
    } catch (error) {
      if (desaparecio(error)) continue
      if (puedeSerDeLaCarga(p)) salida.ilegibles++
      continue
    }
    if (!suyo) continue // de otro usuario: no puede ser de esta carga
    let entorno: string
    try {
      entorno = lector.leer(`/proc/${p.pid}/environ`)
    } catch (error) {
      // Se vuelve a mirar ANTES de contarlo: entre la foto y esta lectura puede haberse muerto.
      if (!desaparecio(error) && puedeSerDeLaCarga(p) && !yaNoEjecuta(p.pid, lector.leer)) salida.ilegibles++
      continue
    }
    if (entorno.split("\0").includes(buscada)) salida.pids.push(p.pid)
  }
  return salida
}

export function sistemaReal(plataforma: NodeJS.Platform = process.platform): Sistema {
  return {
    plataforma,
    foto: () => (plataforma === "linux" ? (fotoDeProc() ?? fotoDePs()) : fotoDePs()),
    referencian: (carpeta) => (plataforma === "linux" ? referencianEnProc(carpeta) : null),
    conMarca: (marca, desde) => (plataforma === "linux" ? conMarcaEnProc(marca, desde) : null),
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
  /** `true` sólo si se comprobó que no queda ningún proceso del árbol vivo, ninguno que use la carpeta privada NI ninguno con la marca. */
  confirmado: boolean
  detalle: string
}

/** Una carpeta privada de carga, y no cualquier cosa: absoluta y con el prefijo de `mkdtemp`. Barrer `/` mataría todo. */
const esCarpetaPrivada = (carpeta: string | undefined): carpeta is string => typeof carpeta === "string" && isAbsolute(carpeta) && basename(carpeta).startsWith("carga-")
const esMarcaDeCarga = (marca: string | undefined): marca is string => typeof marca === "string" && FORMA_MARCA_DE_CARGA.test(marca)

/**
 * Termina `raiz` y todo su árbol (y los procesos con `marcaDeCarga`), barre por `carpetaPrivada`
 * y por la marca, y dice si lo pudo CONFIRMAR. Nunca tira. Vuelve cuando no queda nadie o cuando
 * vencieron los topes.
 */
export async function terminarArbol(raiz: number, carpetaPrivada?: string, marcaDeCarga?: string, sis: Sistema = sistemaReal(), topes: { kill: number } = { kill: TOPE_KILL_MS }, inicioDeLaCarga?: number): Promise<FinDelArbol> {
  try {
    if (!Number.isSafeInteger(raiz) || raiz <= 0) return { confirmado: false, detalle: "no sé el pid del proceso de carga" }
    if (sis.plataforma === "win32") {
      const ok = sis.taskkill(raiz)
      const quedan = vivos(new Set([raiz]), sis)
      return ok && quedan !== null && quedan.length === 0 ? { confirmado: true, detalle: "taskkill /T terminó el árbol" } : { confirmado: false, detalle: "taskkill no pudo confirmar que el árbol terminó" }
    }
    const conMarca = esMarcaDeCarga(marcaDeCarga)
    /** Los marcados ahora, o `null` si no se pudo mirar (sin marca, siempre `[]`). */
    const marcados = (): ConMarca | null => (conMarca ? sis.conMarca(marcaDeCarga, inicioDeLaCarga) : { pids: [], ilegibles: 0 })

    // 1-2. Foto, congelar, y volver a mirar hasta un punto fijo.
    const primera = sis.foto()
    if (!primera) return { confirmado: false, detalle: "no pude ver los procesos del sistema" }
    const raizViva = primera.some((p) => p.pid === raiz && !p.zombi)
    // Una raíz que ya no está (o es zombi) no tiene árbol visible y su pid puede ser de otro:
    // no se le manda nada. Lo que haya quedado colgando lo buscan la marca y la carpeta.
    const arbol = new Set(raizViva ? arbolDe(raiz, primera) : [])
    for (const pid of marcados()?.pids ?? []) arbol.add(pid)
    for (const pid of arbol) sis.senal(pid, "SIGSTOP")
    let estable = arbol.size === 0
    for (let vuelta = 0; vuelta < VUELTAS_PUNTO_FIJO && !estable; vuelta++) {
      const foto = sis.foto()
      if (!foto) break
      const nuevos = [...new Set([...[...arbol].flatMap((pid) => arbolDe(pid, foto)), ...(marcados()?.pids ?? [])])].filter((pid) => !arbol.has(pid))
      if (nuevos.length === 0) {
        estable = true
        break
      }
      for (const pid of nuevos) {
        arbol.add(pid)
        sis.senal(pid, "SIGSTOP")
      }
    }

    // 3. SIGKILL a todos, todavía congelados. Nunca SIGCONT.
    for (const pid of arbol) sis.senal(pid, "SIGKILL")
    const quedan = arbol.size > 0 ? await esperarQueMueran(arbol, sis, topes.kill) : []

    // 4. Barrido por la carpeta privada y por la marca: matar y volver a mirar.
    let referencian: number[] | null = null
    let conLaMarca: ConMarca | null = null
    if (esCarpetaPrivada(carpetaPrivada)) {
      for (let vuelta = 0; vuelta < VUELTAS_BARRIDO; vuelta++) {
        referencian = sis.referencian(carpetaPrivada)
        conLaMarca = marcados()
        if (referencian === null || conLaMarca === null) break
        const restantes = [...new Set([...referencian, ...conLaMarca.pids])]
        if (restantes.length === 0) break
        for (const pid of restantes) sis.senal(pid, "SIGSTOP")
        for (const pid of restantes) sis.senal(pid, "SIGKILL")
        await esperarQueMueran(new Set(restantes), sis, topes.kill)
      }
      if (referencian !== null && conLaMarca !== null && (referencian.length > 0 || conLaMarca.pids.length > 0)) {
        referencian = sis.referencian(carpetaPrivada)
        conLaMarca = marcados()
      }
    }

    if (!raizViva && !esCarpetaPrivada(carpetaPrivada)) return { confirmado: false, detalle: "el proceso de carga ya no estaba y no tengo con qué buscar a sus descendientes" }
    if (!estable) return { confirmado: false, detalle: "el árbol de la carga siguió cambiando mientras lo congelaba" }
    if (quedan === null) return { confirmado: false, detalle: "no pude volver a mirar los procesos después de cortarlos" }
    if (quedan.length > 0) return { confirmado: false, detalle: `quedan ${quedan.length} proceso(s) de la carga vivos` }
    if (!esCarpetaPrivada(carpetaPrivada)) return { confirmado: false, detalle: "no hay carpeta privada con la que comprobar que no quedó nada" }
    if (!conMarca) return { confirmado: false, detalle: "no hay marca de carga con la que comprobar que no quedó nada" }
    if (referencian === null) return { confirmado: false, detalle: "no pude mirar qué procesos usan la carpeta de la carga" }
    if (referencian.length > 0) return { confirmado: false, detalle: `quedan ${referencian.length} proceso(s) usando la carpeta de la carga` }
    if (conLaMarca === null) return { confirmado: false, detalle: "no pude mirar qué procesos tienen la marca de la carga" }
    if (conLaMarca.pids.length > 0) return { confirmado: false, detalle: `quedan ${conLaMarca.pids.length} proceso(s) con la marca de la carga` }
    if (conLaMarca.ilegibles > 0) return { confirmado: false, detalle: `no pude leer el entorno de ${conLaMarca.ilegibles} proceso(s) míos: no sé si son de la carga` }
    return { confirmado: true, detalle: `terminé ${arbol.size} proceso(s) de la carga y comprobé que no queda ninguno entre sus descendientes, en su carpeta ni con su marca` }
  } catch (error) {
    return { confirmado: false, detalle: `falló el corte (${error instanceof Error ? error.message : String(error)})` }
  }
}
