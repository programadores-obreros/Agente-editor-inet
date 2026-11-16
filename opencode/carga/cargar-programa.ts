// `carga/cargar-programa.ts` — grabar en la placa el programa GENERADO de un proyecto físico.
//
// Es la acción `cargar` de la tool `programa` (H1 del MVP de Programación por Intención). La
// tool abre el proyecto y genera el programa por el mismo camino que `generar`/`compilar`;
// desde ahí, todo lo que toca la placa pasa por acá, en este orden, y cada paso falla CERRADO:
//
//    1-2. quién pide (sólo el agente Tecnia Bot) y una defensa HEURÍSTICA contra la aprobación
//         automática: mira la línea de comando del propio proceso; no ve un cliente que se
//         conecta a este servidor ni otras formas de aprobar todo (Q-03)
//      4. carpeta privada nueva, fuera del proyecto, con lo generado y nada más
//      5. análisis de pines sobre lo generado (un pin que deja la placa sin arrancar frena)
//      6. la placa (`descubrir` + `elegirPuerto`) y el candado del puerto
//      7. el cartel, en CADA carga, en carrera contra la cancelación
//      8. revalidar placa, puerto y archivos justo antes de lanzar
//      9. compilar y grabar en un solo `pio run` por `lanzarCarga`
//  10-12. veredicto según la placa, registro y un texto que no afirma más de lo comprobado
//
// POR QUÉ ACÁ Y NO EN `tool/programa.ts`. Para poder probarlo sin procesos: el lanzador
// (`run`), el análisis de pines, el cartel y el chequeo del agente llegan INYECTADOS. Los
// cuatro últimos viven en `tool/platformio.ts` y este módulo no importa `tool/` (la dirección
// es una sola: tool → carga); los pasa `tool/programa.ts`.
//
// DESVÍO DECLARADO DEL CONTRATO v1.2 (CONTRATOS-API §9): el argv NO lleva `nobuild`. El owner
// decidió compilar y grabar en un solo paso, como la ruta heredada que ya funciona. Lo que se
// graba es lo que PlatformIO compila en ese mismo paso desde la carpeta privada, cuyos
// archivos se comprobaron byte a byte justo antes.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { createHash, randomUUID } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path"
import { compararHuellas, hashearArchivos, type HuellaDeArtefacto } from "./artefacto.ts"
import { argvDeCargaCompilando, lanzarCarga } from "./ejecutar.ts"
import { leerSalidaEsptool, TEXTO_CARGA_SIN_VERIFICAR, veredictoDeCarga } from "./esptool.ts"
import { descubrir, elegirPuerto, hashDePlacaFisica, mismaIdentidad, type PlacaDetectada } from "./identidad.ts"
import { CODIGO_CANCELADO, CODIGO_NO_LANZADO, CODIGO_TIMEOUT, describirDuracion, ErrorDeCarga, recortarSalida, timeoutCarga, traducirError, type Run, type RunResult } from "./proceso.ts"
import { reservarPuerto } from "./puertos.ts"
import { guardarBanco, leerBanco, leerCargasGlobal, type Banco } from "./registro.ts"

// ── Lo que llega inyectado ───────────────────────────────────────────────────────────────

/** Lo que este módulo necesita del análisis de pines de `tool/platformio.ts`. */
export interface AnalisisDePines {
  familia: "esp32" | "uno" | null
  hallazgos: ReadonlyArray<{ nivel: string; texto: string }>
  incompleto: readonly string[]
}

/** La misma forma que `PedidoChecklist` de `tool/platformio.ts`. */
export interface PedidoDeCartel {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { cambios: string[]; motivo: string }
  motivo: string
  detalle: string
}

/**
 * Lo que pone `tool/programa.ts` (en producción, las funciones reales de `tool/platformio.ts`
 * y el `run` real). Métodos y no propiedades a propósito: así se pueden pasar las funciones de
 * `platformio.ts`, que reciben su propio tipo de análisis.
 */
export interface HerramientasDeCarga {
  readonly run: Run
  readonly preguntaChecklist: string
  readonly marcaSiemprePregunta: string
  agenteQueNoPuedeCargar(ctx: unknown): string | null
  analizarProyecto(cwd: string, env?: string): AnalisisDePines | null
  bloqueoAntesDeCargar(a: AnalisisDePines | null): string | null
  preguntarChecklist(ctx: unknown, pedido: PedidoDeCartel): Promise<string | null>
}

/** Lo que se usa del `ctx` de OpenCode. `ask` no se llama desde acá: lo llama `preguntarChecklist`. */
export interface ContextoDeCarga {
  readonly directory: string
  readonly agent?: unknown
  readonly abort?: AbortSignal
  readonly ask?: unknown
}

export interface ResultadoDeCarga {
  readonly resultado: string
  readonly ok: boolean
  readonly codigo: string
  readonly [extra: string]: unknown
}

const no = (codigo: string, resultado: string, extra: Record<string, unknown> = {}): ResultadoDeCarga => ({ resultado, ok: false, codigo, ...extra })

// ── 1-2. Quién pide ──────────────────────────────────────────────────────────────────────

const BANDERAS_DE_APROBACION_AUTOMATICA = ["--auto", "--yolo", "--dangerously-skip-permissions"] as const

/**
 * ¿La línea de comando de ESTE proceso trae una bandera de aprobación automática?
 *
 * HEURÍSTICA, Y NO MÁS QUE ESO. Con una de estas banderas el cartel de OpenCode se aprobaría
 * solo, sin que nadie lo lea. Mirar `process.argv`/`process.execArgv` atrapa el caso común de
 * alguien que arrancó así OpenCode; NO prueba que haya una persona del otro lado: hay otras
 * formas de aprobar todo (una configuración, otro cliente, otra versión con otro nombre de
 * bandera) que desde acá no se ven. Es una defensa más, no la garantía.
 */
export function banderaDeAprobacionAutomatica(argv: readonly unknown[] = [...process.argv, ...(process.execArgv ?? [])]): string | null {
  for (const a of argv) {
    if (typeof a !== "string") continue
    for (const b of BANDERAS_DE_APROBACION_AUTOMATICA) if (a === b || a.startsWith(`${b}=`)) return b
  }
  return null
}

/** Pasos 1 y 2. `null` si se puede seguir. Va ANTES de abrir el proyecto. */
export function porQueNoSePuedeCargar(ctx: ContextoDeCarga, h: Pick<HerramientasDeCarga, "agenteQueNoPuedeCargar">): ResultadoDeCarga | null {
  const agente = h.agenteQueNoPuedeCargar(ctx)
  if (agente) return no("AGENTE_NO_AUTORIZADO", `NO SE CARGÓ — ${agente}`)
  const bandera = banderaDeAprobacionAutomatica()
  if (bandera) {
    return no(
      "APROBACION_AUTOMATICA",
      `NO SE CARGÓ — OpenCode está corriendo con aprobación automática (${bandera}): el cartel del checklist de seguridad se aprobaría solo, sin que nadie revise el circuito. ` +
        "Pedile al docente que cierre OpenCode y lo vuelva a abrir sin esa opción; ahí sí se puede cargar.",
    )
  }
  return null
}

// ── 4. La carpeta privada ────────────────────────────────────────────────────────────────

/**
 * Dónde se crean las carpetas privadas: una base del usuario (no del proyecto) y los tramos
 * propios de Tecnia Bot debajo.
 *   - Linux/macOS: `$XDG_CACHE_HOME` (si es absoluta) o `~/.cache`, y `tecnia-bot/cargas`.
 *   - Windows: `%LOCALAPPDATA%` (si es absoluta) o `~\AppData\Local`, y `TecniaBot\cargas`.
 */
export function baseDeCargas(entorno: NodeJS.ProcessEnv = process.env, plataforma: NodeJS.Platform = process.platform, home: string = homedir()): { base: string; tramos: string[] } {
  if (plataforma === "win32") {
    const local = entorno.LOCALAPPDATA
    return { base: local && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local"), tramos: ["TecniaBot", "cargas"] }
  }
  const cache = entorno.XDG_CACHE_HOME
  return { base: cache && isAbsolute(cache) ? cache : join(home, ".cache"), tramos: ["tecnia-bot", "cargas"] }
}

/** ¿`hijo` es `padre` o está adentro? Las dos rutas tienen que venir ya resueltas (realpath). */
function dentroDe(hijo: string, padre: string): boolean {
  const rel = relative(padre, hijo)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/** El `realpath` de `ruta`, o el de su ancestro más cercano que exista con el resto pegado. */
function realpathDeLoQueSeria(ruta: string): string {
  const faltan: string[] = []
  let actual = resolve(ruta)
  for (;;) {
    try {
      return join(realpathSync(actual), ...[...faltan].reverse())
    } catch {
      const arriba = dirname(actual)
      if (arriba === actual) return resolve(ruta)
      faltan.push(basename(actual))
      actual = arriba
    }
  }
}

type CarpetaPrivada = { ok: true; dir: string } | { ok: false; detalle: string }

/**
 * Crea una carpeta NUEVA para esta operación (`mkdtemp`) y comprueba que quedó donde se la
 * pidió. Nunca reutiliza una de antes.
 *
 * Los tramos propios (`tecnia-bot/cargas`) se crean de a uno y, si ya existen, tienen que ser
 * carpetas comunes: un enlace simbólico ahí se rechaza ANTES de crear nada (si no,
 * `mkdir -p` lo seguiría y crearía la carpeta del otro lado). Después, `realpath` de la
 * carpeta creada tiene que ser exactamente `realpath(base)/tramos/<nombre>` y no puede caer
 * adentro de la carpeta del proyecto. La base sí puede ser un enlace (hay sistemas con
 * `~/.cache` en otro disco): por eso se compara contra su `realpath` y se mira el proyecto.
 */
export function crearCarpetaPrivada(proyecto: string, entorno: NodeJS.ProcessEnv = process.env): CarpetaPrivada {
  const { base, tramos } = baseDeCargas(entorno)
  let creada: string | null = null
  try {
    // Antes de crear NADA: si la base (o lo que sería, si todavía no existe) cae adentro del
    // proyecto, no se crea ni una carpeta ahí.
    const proyectoReal = realpathSync(proyecto)
    if (dentroDe(realpathDeLoQueSeria(base), proyectoReal)) return { ok: false, detalle: "la carpeta temporal quedaría adentro de la carpeta del proyecto" }
    if (!lstatSync(base, { throwIfNoEntry: false })) mkdirSync(base, { recursive: true, mode: 0o700 })
    let actual = base
    for (const tramo of tramos) {
      actual = join(actual, tramo)
      const st = lstatSync(actual, { throwIfNoEntry: false })
      if (!st) mkdirSync(actual, { mode: 0o700 })
      else if (!st.isDirectory()) return { ok: false, detalle: `\`${tramo}\` no es una carpeta común (es un enlace u otra cosa)` }
    }
    creada = mkdtempSync(join(actual, "carga-"))
    if (process.platform !== "win32") chmodSync(creada, 0o700)
    const real = realpathSync(creada)
    const esperada = join(realpathSync(base), ...tramos, basename(creada))
    const fallo = (detalle: string): CarpetaPrivada => {
      rmSync(creada as string, { recursive: true, force: true })
      return { ok: false, detalle }
    }
    if (real !== esperada) return fallo("la carpeta temporal no quedó donde la pedí (hay un enlace simbólico en el camino)")
    if (dentroDe(real, proyectoReal)) return fallo("la carpeta temporal quedaría adentro de la carpeta del proyecto")
    const st = lstatSync(real)
    if (!st.isDirectory() || (process.platform !== "win32" && (st.mode & 0o077) !== 0)) return fallo("la carpeta temporal no quedó privada")
    return { ok: true, dir: real }
  } catch (error) {
    if (creada) rmSync(creada, { recursive: true, force: true })
    const codigo = (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.name : "error")
    return { ok: false, detalle: `no pude crear la carpeta temporal (${codigo})` }
  }
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")

/** Todos los archivos (y enlaces) de `dir`, relativos y con `/`, ordenados. */
function listar(dir: string): string[] {
  const salida: string[] = []
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const ruta = join(d, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else salida.push(relative(dir, ruta).split("\\").join("/"))
    }
  }
  recorrer(dir)
  return salida.sort()
}

/**
 * ¿Lo que hay en la carpeta privada es EXACTAMENTE lo generado? Los mismos nombres, ni uno
 * más, y cada archivo con el sha256 del texto que devolvió el generador. Devuelve la huella
 * (de `artefacto.ts`, sin seguir enlaces) o por qué no.
 */
function huellaDeLoGenerado(dir: string, archivos: Readonly<Record<string, string>>): { ok: true; huella: HuellaDeArtefacto } | { ok: false; detalle: string } {
  const esperados = Object.keys(archivos).sort()
  const presentes = listar(dir)
  if (presentes.length !== esperados.length || presentes.some((p, i) => p !== esperados[i])) return { ok: false, detalle: "en la carpeta temporal hay archivos de más o de menos" }
  const r = hashearArchivos(esperados.map((ruta) => join(dir, ruta)))
  if (!r.ok) return { ok: false, detalle: `un archivo generado no se pudo leer (${r.motivo})` }
  for (const [i, ruta] of esperados.entries()) {
    const contenido = archivos[ruta] ?? ""
    const h = r.huella.archivos[i]
    if (!h || h.sha256 !== sha256(contenido) || h.bytes !== Buffer.byteLength(contenido)) return { ok: false, detalle: "un archivo de la carpeta temporal no es el que se generó" }
  }
  return { ok: true, huella: r.huella }
}

/** Escribe lo generado y NADA más. Rutas relativas que no salen de `dir`. */
function escribirGenerado(dir: string, archivos: Readonly<Record<string, string>>): void {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = resolve(dir, ruta)
    if (isAbsolute(ruta) || !dentroDe(destino, dir) || destino === dir) throw new Error("el generador devolvió una ruta que sale de la carpeta")
    mkdirSync(dirname(destino), { recursive: true, mode: 0o700 })
    writeFileSync(destino, contenido, { flag: "wx", mode: 0o600 })
  }
}

// ── 6 y 8. La placa ──────────────────────────────────────────────────────────────────────

const POR_QUE_NO_HAY_PLACA: Record<string, string> = {
  SIN_PLACA: "No encuentro ninguna placa conectada. Conectá el Arduino o el ESP32 por USB y probá de nuevo; si está enchufada y no la veo, corré `/diagnostico`: puede faltarle el driver.",
  VARIAS_PLACAS: "Hay más de una placa conectada y no voy a elegir yo a cuál grabar. Dejá enchufada sólo la del proyecto y pedí la carga de nuevo.",
}

/**
 * Q-05: ¿la placa detectada es SEGURO de otra familia que el programa? Sólo por VID con
 * certeza: 2341/2A03 son Arduino (nunca un ESP32) y 303A es el USB nativo de Espressif (nunca
 * una UNO). Los chips USB-serie genéricos (CH340, CP2102, FTDI…) van en las dos familias: ahí
 * no se opina y se deja seguir. Devuelve qué es la placa, o `null` si no hay certeza de nada.
 */
export function familiaQueNoCoincide(familia: "esp32" | "uno", placa: Pick<PlacaDetectada, "vid">): string | null {
  const vid = placa.vid.toUpperCase()
  if (familia === "esp32" && (vid === "2341" || vid === "2A03")) return "un Arduino"
  if (familia === "uno" && vid === "303A") return "un ESP32 con USB nativo"
  return null
}

type Deteccion ={ ok: true; placa: PlacaDetectada } | { ok: false; cancelado: boolean; codigo: string; texto: string }

async function detectarPlaca(run: Run, cwd: string, signal?: AbortSignal): Promise<Deteccion> {
  const d = await descubrir(run, cwd, signal)
  if (d.fallo) {
    if (d.fallo.code === CODIGO_CANCELADO || signal?.aborted) return { ok: false, cancelado: true, codigo: "CANCELADO", texto: "se canceló mientras buscaba la placa" }
    return { ok: false, cancelado: false, codigo: "DETECCION_FALLIDA", texto: `No pude ver qué placas hay conectadas (${d.fallo.detalle}). Corré \`/diagnostico\`.` }
  }
  const e = elegirPuerto(d, { sal: "" })
  if (!e.ok) return { ok: false, cancelado: false, codigo: e.codigo, texto: POR_QUE_NO_HAY_PLACA[e.codigo] ?? `No pude elegir la placa (${e.codigo}).` }
  return { ok: true, placa: e.placa }
}

// ── 7. El cartel ─────────────────────────────────────────────────────────────────────────

/** Sin `*` ni `?` en lo que va después del prefijo: en OpenCode son comodines (ver `platformio.ts`). */
const sinComodines = (t: string) => t.replace(/\*/g, "×").replace(/\?/g, "")

export function pedidoDeCargaDelPrograma(o: { preguntaChecklist: string; marcaSiemprePregunta: string; idProyecto: string; revision: number; placa: string; chip: string; puerto: string; operacion: string }): PedidoDeCartel {
  const motivo = `Se va a grabar en la placa el programa generado desde el proyecto «${o.idProyecto}» (revisión ${o.revision}).`
  return {
    permission: `${o.preguntaChecklist} ${sinComodines(`Cargar el proyecto ${o.idProyecto} en la placa ${o.placa} por el puerto ${o.puerto}`)}${o.marcaSiemprePregunta}`,
    // Un patrón distinto en cada operación: ningún "Allow always" guardado puede coincidir.
    patterns: [`programa ${o.operacion}`],
    always: [],
    metadata: { cambios: [], motivo },
    motivo,
    detalle: `Placa ${o.placa} (chip ${sinComodines(o.chip)}) en ${o.puerto}. Cada carga del programa del proyecto se confirma con este cartel.`,
  }
}

type Respuesta = { tipo: "si" } | { tipo: "no"; texto: string } | { tipo: "cancelado" } | { tipo: "error"; detalle: string }

/**
 * El cartel, en carrera contra la cancelación. `ctx.ask` puede quedar colgado si la sesión
 * se aborta; si la señal se dispara primero, la operación queda CANCELADA para siempre: el
 * "sí" que llegue después no tiene a nadie esperándolo. Cualquier excepción es un "no".
 */
async function preguntarConCorte(h: HerramientasDeCarga, ctx: ContextoDeCarga, pedido: PedidoDeCartel, signal?: AbortSignal): Promise<Respuesta> {
  if (signal?.aborted) return { tipo: "cancelado" }
  let soltar = () => {}
  const corte = new Promise<"corte">((resolver) => {
    if (!signal) return
    const alAbortar = () => resolver("corte")
    signal.addEventListener("abort", alAbortar, { once: true })
    soltar = () => signal.removeEventListener("abort", alAbortar)
  })
  try {
    const pregunta = Promise.resolve()
      .then(() => h.preguntarChecklist(ctx, pedido))
      .then(
        (texto) => ({ texto }),
        (error: unknown) => ({ error }),
      )
    const r = await Promise.race([pregunta, corte])
    if (r === "corte" || signal?.aborted) return { tipo: "cancelado" }
    if ("error" in r) return { tipo: "error", detalle: r.error instanceof Error ? r.error.message : String(r.error) }
    return r.texto === null ? { tipo: "si" } : { tipo: "no", texto: r.texto }
  } finally {
    soltar()
  }
}

// ── 10. El veredicto ─────────────────────────────────────────────────────────────────────

/** Corte de una carga en el que NO se pudo confirmar que el árbol de procesos terminó. */
const MEDIO_GRABAR =
  "No pude confirmar que la grabación se haya frenado: puede que siga grabándose. No desconectes la placa todavía: esperá un par de minutos. " +
  "Después desenchufala y volvé a enchufarla: pudo haber quedado a medio grabar (con el programa anterior roto o sin programa). " +
  "Para volver a cargar, cerrá y volvé a abrir Tecnia Bot: hasta entonces, `programa cargar` tiene ese puerto reservado."

/** Corte de una carga en el que SÍ se comprobó que no quedó ningún proceso de grabación vivo. */
const CORTE_CONFIRMADO =
  "Confirmé que no quedó ningún proceso de la carga corriendo, pero la placa pudo haber quedado a medio grabar (con el programa anterior roto o sin programa): hay que volver a cargarla."

/** Qué decir y si retener el puerto, según si `run()` confirmó que el árbol de la carga terminó (Q-01). */
const despuesDelCorte = (corrida: RunResult) =>
  corrida.procesosDeCargaTerminados === true ? { texto: CORTE_CONFIRMADO, retenerPuerto: false } : { texto: MEDIO_GRABAR, retenerPuerto: true }

interface Veredicto {
  ok: boolean
  codigo: string
  resultado: string
  /** Si el corte pudo dejar algo corriendo: el candado del puerto NO se suelta. */
  retenerPuerto: boolean
  extra: Record<string, unknown>
}

const alineadoA4 = (n: number) => Math.ceil(n / 4) * 4

/**
 * ESP32: el firmware que PlatformIO acaba de compilar en la carpeta privada tiene que ser una
 * de las regiones que esptool dice haber escrito y verificado (mismo tamaño). Ata la salida
 * de la herramienta a ESTE programa y no a cualquier carga.
 */
function firmwareEstaEntreLasRegiones(dir: string, environment: string, regiones: ReadonlyArray<{ bytes: number; hashVerificado: boolean }>): boolean {
  const r = hashearArchivos([join(dir, ".pio", "build", environment, "firmware.bin")])
  if (!r.ok) return false
  const bytes = r.huella.archivos[0]?.bytes ?? 0
  return regiones.some((x) => x.hashVerificado && x.bytes === alineadoA4(bytes))
}

function veredicto(familia: "esp32" | "uno", corrida: RunResult, dir: string, environment: string, timeoutMs: number): Veredicto {
  const salida = () => recortarSalida(corrida.stderr.trim() ? `${corrida.stdout}\n${corrida.stderr}` : corrida.stdout)
  if (corrida.code === CODIGO_TIMEOUT) {
    const d = despuesDelCorte(corrida)
    return { ok: false, codigo: "TIEMPO_AGOTADO", resultado: `NO SÉ SI SE CARGÓ — PlatformIO no terminó en ${describirDuracion(timeoutMs)} y lo corté mientras compilaba o grababa. ${d.texto}`, retenerPuerto: d.retenerPuerto, extra: { salida: salida(), procesosDeCargaTerminados: corrida.procesosDeCargaTerminados === true } }
  }
  if (corrida.code === CODIGO_CANCELADO) {
    const d = despuesDelCorte(corrida)
    return { ok: false, codigo: "CANCELADO_DURANTE_LA_CARGA", resultado: `NO SÉ SI SE CARGÓ — se canceló mientras PlatformIO compilaba o grababa. ${d.texto}`, retenerPuerto: d.retenerPuerto, extra: { salida: salida(), procesosDeCargaTerminados: corrida.procesosDeCargaTerminados === true } }
  }
  if (corrida.code === CODIGO_NO_LANZADO) {
    return { ok: false, codigo: "PLATFORMIO_NO_ENCONTRADO", resultado: 'NO SE CARGÓ — no pude lanzar PlatformIO (no está instalado o no lo encuentro): no se grabó nada. Usá la tool `platformio` con action "reparar".', retenerPuerto: false, extra: {} }
  }
  if (familia === "uno") {
    // ND-3: sin evidencia real de avrdude, una UNO nunca da `ok`, diga lo que diga la salida.
    const v = veredictoDeCarga({ herramienta: "avrdude", code: corrida.code, stdout: corrida.stdout, stderr: corrida.stderr, imagenes: [] })
    if (corrida.code === 0) return { ok: false, codigo: "CARGA_SIN_VERIFICAR", resultado: TEXTO_CARGA_SIN_VERIFICAR, retenerPuerto: false, extra: { verificacion: v.verificacion } }
    return {
      ok: false,
      codigo: "CARGA_FALLIDA",
      resultado: "NO SE CARGÓ BIEN — PlatformIO terminó con error al compilar o al grabar. Si llegó a grabar, la placa pudo haber quedado a medio grabar.",
      retenerPuerto: false,
      extra: { verificacion: v.verificacion, exitCode: corrida.code, explicacion: traducirError(corrida.stderr, corrida.stdout), salida: salida() },
    }
  }
  const esptool = leerSalidaEsptool(corrida.stdout, corrida.stderr)
  const regiones = esptool.regiones.length
  const firmware = firmwareEstaEntreLasRegiones(dir, environment, esptool.regiones)
  const verificacion = { platformio: corrida.code === 0 ? "ok" : "fallo", regionesEscritas: regiones, regionesVerificadas: esptool.regiones.filter((x) => x.hashVerificado).length, firmwareDeEsteProgramaEntreLasRegiones: firmware }
  if (corrida.code === 0 && esptool.exito && firmware) {
    return { ok: true, codigo: "CARGADO", resultado: `CARGADO — PlatformIO compiló y grabó; esptool escribió ${regiones} ${regiones === 1 ? "región" : "regiones"} y la placa verificó el hash de cada una.`, retenerPuerto: false, extra: { verificacion } }
  }
  if (corrida.code === 0) {
    return { ok: false, codigo: "CARGA_SIN_VERIFICAR", resultado: TEXTO_CARGA_SIN_VERIFICAR, retenerPuerto: false, extra: { verificacion, sintoma: esptool.sintoma, salida: salida() } }
  }
  const empezoAGrabar = regiones > 0 || esptool.ultimoOffset !== undefined
  return {
    ok: false,
    codigo: "CARGA_FALLIDA",
    resultado: empezoAGrabar
      ? "NO SE CARGÓ BIEN — la grabación empezó y PlatformIO terminó con error: la placa pudo haber quedado a medio grabar."
      : "NO SE CARGÓ — PlatformIO terminó con error antes de que esptool escribiera en la placa.",
    retenerPuerto: false,
    extra: { verificacion, sintoma: esptool.sintoma, exitCode: corrida.code, explicacion: traducirError(corrida.stderr, corrida.stdout), salida: salida() },
  }
}

// ── 11. El registro ──────────────────────────────────────────────────────────────────────

function registrar(directorio: string, o: { codigo: string; ok: boolean; revision: number; sha256Conjunto: string; placa: PlacaDetectada; ahora: Date }): { ok: true } | { ok: false; detalle: string } {
  try {
    const fechaUtc = o.ahora.toISOString()
    const banco: Banco = { ...(leerBanco(directorio) ?? {}), ultimoIntento: { fechaUtc, codigo: o.codigo } }
    if (o.ok) {
      banco.ultimaCarga = { revision: o.revision, sha256Conjunto: o.sha256Conjunto, fechaUtc, origen: "programa" }
      banco.placaFisica = hashDePlacaFisica(leerCargasGlobal().sal, `${o.placa.vid}:${o.placa.pid}`, o.placa.serie)
    }
    const r = guardarBanco(directorio, banco)
    return r.ok ? { ok: true } : { ok: false, detalle: r.detalle }
  } catch (error) {
    return { ok: false, detalle: error instanceof Error ? error.message : String(error) }
  }
}

// ── La operación entera (pasos 4 a 12) ──────────────────────────────────────────────────

export interface ProgramaParaCargar {
  readonly idProyecto: string
  readonly revision: number
  readonly environment: string
  readonly archivos: Readonly<Record<string, string>>
  /** La revisión ACTUAL del proyecto (sincrónica). Se compara con `revision` justo antes de lanzar (Q-04). */
  readonly revisionActual?: () => number
}

export interface OpcionesDeCarga {
  readonly entorno?: NodeJS.ProcessEnv
  readonly ahora?: () => Date
}

/**
 * Graba el programa que `tool/programa.ts` acaba de generar. Supone hechos los pasos 1 a 3
 * (`porQueNoSePuedeCargar` y la generación). Nunca tira: todo termina en un `ResultadoDeCarga`,
 * y el texto que devuelve no nombra la carpeta privada.
 */
export async function cargarProgramaGenerado(p: ProgramaParaCargar, ctx: ContextoDeCarga, h: HerramientasDeCarga, o: OpcionesDeCarga = {}): Promise<ResultadoDeCarga> {
  const privada = crearCarpetaPrivada(ctx.directory, o.entorno)
  if (!privada.ok) return no("CARPETA_PRIVADA_RECHAZADA", `NO SE CARGÓ — ${privada.detalle}. No se lanzó nada.`)
  const dir = privada.dir
  let resultado: ResultadoDeCarga
  let carpetaBorrada = true
  try {
    resultado = await cargarDesde(dir, p, ctx, h, o)
  } catch (error) {
    resultado = no("ERROR_INESPERADO", `NO SÉ SI SE CARGÓ — error inesperado (${error instanceof Error ? error.message : String(error)}).`)
  } finally {
    // Se borra SIEMPRE: no se conserva para diagnóstico (la salida de PlatformIO ya va en el
    // resultado, y una carpeta vieja con un programa adentro es justo lo que no queremos).
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
    } catch {
      carpetaBorrada = false
    }
  }
  if (!carpetaBorrada) resultado = { ...resultado, aviso: "No pude borrar la carpeta temporal de esta carga; se va a pisar con la próxima limpieza del sistema." }
  return sinRutaPrivada(resultado, dir)
}

/** El resultado sin la ruta de la carpeta privada en ningún lado (12). */
function sinRutaPrivada(r: ResultadoDeCarga, dir: string): ResultadoDeCarga {
  const json = JSON.stringify(r)
  const enJson = JSON.stringify(dir).slice(1, -1)
  if (!json.includes(enJson)) return r
  return JSON.parse(json.split(enJson).join("<carpeta temporal>")) as ResultadoDeCarga
}

async function cargarDesde(dir: string, p: ProgramaParaCargar, ctx: ContextoDeCarga, h: HerramientasDeCarga, o: OpcionesDeCarga): Promise<ResultadoDeCarga> {
  const signal = ctx.abort
  const cancelado = () => no("CANCELADO", "NO SE CARGÓ — se canceló antes de grabar: no se lanzó nada.")

  // 4. Lo generado, y nada más.
  escribirGenerado(dir, p.archivos)
  const generado = huellaDeLoGenerado(dir, p.archivos)
  if (!generado.ok) return no("MATERIALIZACION_INCONSISTENTE", `NO SE CARGÓ — ${generado.detalle}. No se lanzó nada.`)

  // 5. Pines, sobre lo generado. Acá se falla cerrado también con `null` o incompleto.
  const analisis = h.analizarProyecto(dir, p.environment)
  if (!analisis) return no("ANALISIS_NO_DISPONIBLE", "NO SE CARGÓ — no pude analizar los pines del programa generado, y sin ese análisis no se graba.")
  if (analisis.incompleto.length > 0) return no("ANALISIS_INCOMPLETO", `NO SE CARGÓ — el análisis de pines del programa generado quedó incompleto (${analisis.incompleto.join(", ")}), y así no se graba.`)
  const bloqueo = h.bloqueoAntesDeCargar(analisis)
  if (bloqueo) return no("PIN_BLOQUEANTE", bloqueo)
  const familia = analisis.familia
  if (familia !== "esp32" && familia !== "uno") return no("PLACA_NO_SOPORTADA", "NO SE CARGÓ — no sé con qué herramienta se graba esta placa, así que no podría decir si la carga salió bien.")
  if (signal?.aborted) return cancelado()

  // 6. La placa y el candado del puerto.
  const antes = await detectarPlaca(h.run, dir, signal)
  if (!antes.ok) return antes.cancelado ? cancelado() : no(antes.codigo, `NO SE CARGÓ — ${antes.texto}`)
  const placa = antes.placa
  const otraFamilia = familiaQueNoCoincide(familia, placa)
  if (otraFamilia) return no("PLACA_NO_COINCIDE", `NO SE CARGÓ — el programa es para ${familia === "esp32" ? "un ESP32" : "un Arduino UNO"}, pero la placa conectada en ${placa.puerto} es ${otraFamilia}. Conectá la placa del proyecto y pedí la carga de nuevo.`)
  const operacion = randomUUID()
  const reserva = reservarPuerto(placa.puerto, `programa ${operacion}`)
  if (!reserva.ok) return no("PUERTO_OCUPADO", `NO SE CARGÓ — el puerto ${placa.puerto} está ocupado: ${reserva.detalle}`)

  let retenerPuerto = false
  try {
    if (signal?.aborted) return cancelado()

    // 7. El cartel, en CADA carga.
    const pedido = pedidoDeCargaDelPrograma({ preguntaChecklist: h.preguntaChecklist, marcaSiemprePregunta: h.marcaSiemprePregunta, idProyecto: p.idProyecto, revision: p.revision, placa: p.environment, chip: placa.chip, puerto: placa.puerto, operacion })
    const respuesta = await preguntarConCorte(h, ctx, pedido, signal)
    if (respuesta.tipo === "cancelado") return cancelado()
    if (respuesta.tipo === "error") return no("CARTEL_FALLIDO", `NO SE CARGÓ — el cartel del checklist falló (${respuesta.detalle}), y sin esa confirmación no se graba.`)
    // Sin `ctx.ask`, `preguntarChecklist` ya devuelve su "no cargué" (falla cerrado).
    if (respuesta.tipo === "no") return no(typeof ctx.ask === "function" ? "CARTEL_RECHAZADO" : "CARTEL_NO_DISPONIBLE", respuesta.texto)

    // 8. Revalidar justo antes de lanzar: la placa y el puerto que se mostraron en el cartel...
    const despues = await detectarPlaca(h.run, dir, signal)
    if (!despues.ok) {
      if (despues.cancelado) return cancelado()
      return no("IDENTIDAD_CAMBIO", `NO SE CARGÓ — la placa que aprobaste ya no está como estaba: ${despues.texto}`)
    }
    if (despues.placa.puerto !== placa.puerto || !mismaIdentidad(placa, despues.placa)) {
      return no("IDENTIDAD_CAMBIO", "NO SE CARGÓ — entre el cartel y la carga cambió la placa o el puerto: no grabo en una placa distinta de la que aprobaste. Pedí la carga de nuevo.")
    }
    // ...y los archivos. DESDE ACÁ HASTA `lanzarCarga` NO HAY NINGÚN `await`.
    if (signal?.aborted) return cancelado()
    const ahora = huellaDeLoGenerado(dir, p.archivos)
    if (!ahora.ok || !compararHuellas(generado.huella, ahora.huella).ok) {
      return no("ARCHIVOS_CAMBIARON", "NO SE CARGÓ — los archivos del programa cambiaron entre que se generaron y la carga. No se lanzó nada.")
    }
    // ...y el proyecto (Q-04): si cambió de revisión con el cartel abierto, lo aprobado ya no es
    // el proyecto actual. Se lee sin `await` (el snapshot del servicio es sincrónico).
    if (p.revisionActual) {
      let actual: number | null
      try {
        actual = p.revisionActual()
      } catch {
        actual = null
      }
      if (actual !== p.revision) {
        return no("PROYECTO_CAMBIO", `NO SE CARGÓ — el proyecto cambió (revisión ${p.revision} → ${actual ?? "desconocida"}) mientras el cartel estaba abierto: lo que aprobaste ya no es el proyecto actual. Pedí la carga de nuevo.`)
      }
    }

    // 9. Compilar y grabar, en un solo paso, desde la carpeta privada.
    const timeoutMs = timeoutCarga()
    let corrida: RunResult
    try {
      corrida = await lanzarCarga(h.run, argvDeCargaCompilando({ cwd: dir, environment: p.environment, puerto: placa.puerto }), dir, signal, timeoutMs)
    } catch (error) {
      // Un `ErrorDeCarga` es un rechazo ANTES de lanzar. Cualquier otra cosa: no se sabe.
      if (error instanceof ErrorDeCarga) return no(error.codigo, `NO SE CARGÓ — ${error.message}. No se lanzó nada.`)
      retenerPuerto = true
      return no("ERROR_INESPERADO", `NO SÉ SI SE CARGÓ — falló el lanzamiento de PlatformIO (${error instanceof Error ? error.message : String(error)}). ${MEDIO_GRABAR}`)
    }

    // 10. Qué se puede afirmar.
    const v = veredicto(familia, corrida, dir, p.environment, timeoutMs)
    retenerPuerto = v.retenerPuerto

    // 11. Registro: nunca cambia el veredicto, pero si falla, se dice.
    const registro = registrar(ctx.directory, { codigo: v.codigo, ok: v.ok, revision: p.revision, sha256Conjunto: generado.huella.sha256Conjunto, placa, ahora: (o.ahora ?? (() => new Date()))() })
    const resultado = registro.ok ? v.resultado : `${v.resultado} (Ojo: no pude anotar esta carga en el registro del proyecto: ${registro.detalle}.)`
    return { resultado, ok: v.ok, codigo: v.codigo, puerto: placa.puerto, chip: placa.chip, ...v.extra, registro: registro.ok ? { ok: true } : { ok: false, detalle: registro.detalle } }
  } finally {
    if (!retenerPuerto) reserva.liberar()
  }
}
