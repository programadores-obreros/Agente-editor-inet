/// <reference path="../env.d.ts" />
// Tool "vivo" — Modo Vivo (protocolo v1, slices V1–V4).
// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md (§6 responsabilidades, §8 red propia,
// §9 decisiones V4-3..V4-10). Decisiones humanas: HD-08 (MODO-VIVO-PLAN.md §6) y
// DECISIONES-HUMANAS-2026-10-12.md.
//
// El laboratorio: un runtime base por placa (generado desde Component Knowledge por
// `codegen/runtime.ts`), cargado UNA vez, con el que el alumno prende, mueve y mide en vivo
// sin compilar ni cargar por cada acción. Esta tool sólo orquesta:
//
//   cargar      → genera el runtime de la placa del proyecto y lo compila y carga con PlatformIO
//   conectar    → abre el puerto serie (puente en Python con pyserial, `vivo/transporte-serie.ts`),
//                 hace el handshake y deja la sesión abierta en este proceso
//   estado      → lo que la sesión OBSERVÓ, con procedencia; nunca lo que "debería" pasar
//   accionar    → prende/apaga o PWM sobre un componente del proyecto (o un pin)
//   leer        → lee un componente del proyecto (o un pin)
//   desconectar → cierra la sesión y libera el puerto
//
// Lo que NO hace: no escribe en la IR (lo observado es otro dominio, `vivo/estado-observado.ts`),
// no corre reglas (las reglas viven en el programa generado por `programa`), no habla prosa de
// hardware (devuelve códigos; el agente los traduce con la invariante pedagógica: sólo afirma lo
// OBSERVED). El puerto es exclusivo mientras la sesión está abierta (registro de puertos en
// `platformio.ts`, que es quien carga y abre el monitor; `programa cargar` también lo respeta).
//
// Auditoría 2026-10-13 (AUDITORIA-2026-10-13.md), lo que esta tool corrige:
//   X2  `conectar` sobre una sesión que ya no está CONECTADA la cierra y reconecta (antes: OK falso).
//   X3  `salidasExtra` vacío por defecto; "más pines" sólo con `masPines` (V4-6c); los strapping van
//       aparte, con aviso; nunca un pin en dos roles de la página.
//   M2  la clave WiFi se imprime UNA vez (en `cargar`); después sólo `claveConfigurada`.
//   L-01/C-01/C-03/C-04/T-02/T-03/L-04/L-06/M-03 (A6): nombres, secciones, uniones, sin centinela -1,
//       URL del portal desde el contrato.

import { tool } from "@opencode-ai/plugin"
import { createHash, randomInt } from "node:crypto"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { Placa } from "../nucleo/placas.ts"
import type { ServicioDeProyecto } from "../nucleo/composicion-raiz.ts"
import type { Proyecto } from "../nucleo/ir.ts"
import { esSsidValido, URL_PORTAL, type Comando } from "../vivo/protocolo.ts"
import type { PaginaPortal } from "../vivo/pagina-portal.ts"
import type { EstadoObservado } from "../vivo/estado-observado.ts"
import type { Puente, SesionViva } from "../vivo/sesion-viva.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
import { CODIGO_CANCELADO, CODIGO_TIMEOUT, detectPort, duenoDelPuerto, liberarPuerto, puertoValido, recortarSalida, reservarPuerto, run, timeoutLargoMs, traducirError } from "./platformio.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Dependencias (perezosas: si falta una carpeta de la instalación, sólo esta tool se entera)
// ════════════════════════════════════════════════════════════════════════════════════

type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloConocimientoActivo = typeof import("../conocimiento/conocimiento-activo.ts")
type ModuloRuntime = typeof import("../codegen/runtime.ts")
type ModuloSesion = typeof import("../vivo/sesion-viva.ts")
type ModuloTransporte = typeof import("../vivo/transporte-serie.ts")

export interface DependenciasVivo {
  readonly obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  readonly conocimiento: ModuloConocimientoActivo["CONOCIMIENTO_ACTIVO"]
  readonly generarRuntime: ModuloRuntime["generarRuntime"]
  /** Lanza si la placa no puede tener runtime V1 (bancos que no son GPIO, p. ej. un UNO): la tool lo traduce a `PLACA_NO_SOPORTADA_EN_VIVO`. */
  readonly tablasDePines: ModuloRuntime["tablasDePines"]
  readonly abrirSesion: ModuloSesion["abrirSesion"]
  readonly abrirPuenteSerie: ModuloTransporte["abrirPuenteSerie"]
  /** Detecta el puerto de la placa (VID:PID) — el de `platformio.ts`, inyectable en tests. */
  readonly detectarPuerto: (directorio: string, senal?: AbortSignal) => Promise<{ port: string } | { error: string }>
  /** Compila y carga la carpeta del runtime en `puerto` — PlatformIO, inyectable en tests. */
  readonly cargarRuntime: (carpeta: string, environment: string, puerto: string, directorio: string, senal?: AbortSignal) => Promise<{ code: number; stdout: string; stderr: string }>
  /** V4-4: la clave WPA2 de la red de la placa, 8 dígitos; se sortea en cada carga (fija en tests). */
  readonly sortearClave: () => string
}

/** V4-4: 8 dígitos decimales con `crypto.randomInt` (uniforme), con ceros a la izquierda si hace falta. */
export function sortearClaveWifi(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0")
}

async function cargarDependencias(): Promise<DependenciasVivo> {
  try {
    const [servicio, conocimiento, runtime, sesion, transporte] = await Promise.all([
      import("../servidor/servicio-con-vista.ts"),
      import("../conocimiento/conocimiento-activo.ts"),
      import("../codegen/runtime.ts"),
      import("../vivo/sesion-viva.ts"),
      import("../vivo/transporte-serie.ts"),
    ])
    return {
      obtenerServicioDeProyectoConVista: servicio.obtenerServicioDeProyectoConVista,
      conocimiento: conocimiento.CONOCIMIENTO_ACTIVO,
      generarRuntime: runtime.generarRuntime,
      tablasDePines: runtime.tablasDePines,
      abrirSesion: sesion.abrirSesion,
      abrirPuenteSerie: transporte.abrirPuenteSerie,
      detectarPuerto: detectPort,
      cargarRuntime: (carpeta, environment, puerto, directorio, senal) => run(["pio", "run", "-d", carpeta, "-e", environment, "-t", "upload", "--upload-port", puerto], directorio, senal, timeoutLargoMs()),
      sortearClave: sortearClaveWifi,
    }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(`Falta una carpeta de Tecnia Bot ("servidor", "conocimiento", "codegen" o "vivo") junto a esta tool (no se pudo cargar: ${detalle}). Reinstalá Tecnia Bot para arreglarlo.`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Contrato de entrada / salida
// ════════════════════════════════════════════════════════════════════════════════════

export const ACCIONES_VIVO = ["cargar", "conectar", "estado", "accionar", "leer", "desconectar"] as const
type AccionVivo = (typeof ACCIONES_VIVO)[number]

export interface ArgsVivo {
  readonly accion: string
  readonly idProyecto?: string
  readonly puerto?: string
  readonly componente?: string
  readonly pin?: string
  readonly nivel?: string
  readonly porcentaje?: number
  /** V4-4, sólo para `cargar`: red con clave WPA2 de 8 dígitos sorteada. Por defecto la red va abierta. */
  readonly redConClave?: boolean
  /** V4-5, sólo para `cargar`: nombre de la red elegido por quien la usa. Por defecto `tecnia-xxxx` (único por placa). */
  readonly nombreRed?: string
  /** V4-6c, sólo para `cargar`: la página ofrece "más pines" (las salidas libres de la placa). Por defecto no. */
  readonly masPines?: boolean
}

/** Toda salida de la tool: `resultado` primero, `ok`, y si falla un `codigo` estable. */
export type SalidaVivo = { readonly resultado: string; readonly ok: true; readonly [campo: string]: unknown } | { readonly resultado: string; readonly ok: false; readonly codigo: string; readonly [campo: string]: unknown }

const json = (valor: SalidaVivo) => JSON.stringify(valor, null, 2)
const fallo = (codigo: string, resultado: string, extra: Record<string, unknown> = {}): SalidaVivo => ({ resultado, ok: false, ...extra, codigo })
const exito = (resultado: string, extra: Record<string, unknown> = {}): SalidaVivo => ({ resultado, ok: true, ...extra })

// ════════════════════════════════════════════════════════════════════════════════════
// La página del portal (V4-5b, V4-6c): qué pines ofrece, derivados del proyecto y de la placa
// ════════════════════════════════════════════════════════════════════════════════════

export interface OpcionesDePagina {
  /** V4-6c: ofrecer también las salidas libres de la placa ("más pines"). Por defecto no. */
  readonly masPines?: boolean
}

/** Pines que el runtime rechaza siempre (contrato §5): flash y UART0. No se ofrecen ni en "más pines". */
const esProhibido = (p: Placa["pines"][number]) => p.restricciones.includes("flashReservado") || p.restricciones.includes("uartUsb")
/** Strapping (H-A1, CK-CG1): deciden cómo arranca la placa; se ofrecen al final y con aviso (V4-6c). */
const esStrapping = (p: Placa["pines"][number]) => p.restricciones.includes("strapping") || p.restricciones.includes("strappingVddSdio")

/**
 * Qué pines muestra la página del portal. Salen del PROYECTO del alumno (los pines asignados a
 * terminales de salida y de entrada) y, sólo con `masPines`, de la placa (el resto de las salidas
 * posibles; las strapping aparte, con aviso). Las entradas analógicas de la placa van siempre,
 * pero nunca un pin que ya se ofrece como salida: un pin en dos roles es el OK falso de la
 * auditoría (A2-A1: tras `analogico.leer` el core deja el pin sin salida). Un pin que la placa
 * prohíbe (flash, UART0) no se ofrece ni en "más pines". Nada sale de una lista escrita a mano.
 */
export function paginaDelProyecto(placa: Placa, proyecto: Proyecto, conocimiento: DependenciasVivo["conocimiento"], opciones: OpcionesDePagina = {}): PaginaPortal {
  const numeroDe = (id: string) => placa.pines.find((p) => p.id === id)?.numero
  const salidas = new Set<number>()
  const entradasDigitales = new Set<number>()
  const entradasAnalogicas = new Set<number>()
  for (const componente of proyecto.componentes) {
    for (const terminal of conocimiento.terminales(componente.tipo)) {
      const pinId = componente.pines[terminal.id]
      const numero = pinId ? numeroDe(pinId) : undefined
      if (numero === undefined) continue
      if (terminal.electrica === "analogica") entradasAnalogicas.add(numero)
      else if (terminal.electrica === "digital" && terminal.direccion === "salida") salidas.add(numero)
      else if (terminal.electrica === "digital" && terminal.direccion === "entrada") entradasDigitales.add(numero)
    }
  }
  // Un pin, un rol: si el proyecto lo tiene como salida no se lee; si se lee digital no se lee analógico.
  for (const pin of salidas) {
    entradasDigitales.delete(pin)
    entradasAnalogicas.delete(pin)
  }
  for (const pin of entradasDigitales) entradasAnalogicas.delete(pin)

  const usados = new Set([...salidas, ...entradasDigitales, ...entradasAnalogicas])
  const libres = placa.pines.filter((p) => !esProhibido(p) && !usados.has(p.numero))
  const salidasExtra = opciones.masPines ? libres.filter((p) => p.capacidades.salidaDigital && !esStrapping(p)).map((p) => p.numero) : []
  const salidasConAviso = opciones.masPines ? libres.filter((p) => p.capacidades.salidaDigital && esStrapping(p)).map((p) => p.numero) : []
  const ofrecidosComoSalida = new Set([...salidas, ...salidasExtra, ...salidasConAviso])
  const analogicasExtra = libres.filter((p) => p.capacidades.adc && !ofrecidosComoSalida.has(p.numero)).map((p) => p.numero)
  const ordenados = (lista: Iterable<number>) => [...new Set(lista)].sort((a, b) => a - b)
  return {
    salidas: ordenados(salidas),
    salidasExtra: ordenados(salidasExtra),
    entradasDigitales: ordenados(entradasDigitales),
    entradasAnalogicas: ordenados([...entradasAnalogicas, ...analogicasExtra]),
    ...(salidasConAviso.length > 0 ? { salidasConAviso: ordenados(salidasConAviso) } : {}),
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Carpeta derivada del runtime
// ════════════════════════════════════════════════════════════════════════════════════

/** Carpeta derivada del runtime de una placa: junto a los datos, descartable, una por placa. */
export function carpetaDelRuntime(directorioActivo: string, placa: string): string {
  return join(directorioDeDatos(directorioActivo), "runtime-vivo", placa)
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")

function materializar(carpeta: string, archivos: Readonly<Record<string, string>>): void {
  mkdirSync(carpeta, { recursive: true })
  for (const entrada of readdirSync(carpeta)) if (entrada !== ".pio") rmSync(join(carpeta, entrada), { recursive: true, force: true })
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(carpeta, ruta)), { recursive: true })
    writeFileSync(join(carpeta, ruta), contenido)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Sesiones abiertas en ESTE proceso (se pierden al cerrar OpenCode, a propósito)
// ════════════════════════════════════════════════════════════════════════════════════

interface SesionAbierta {
  readonly sesion: SesionViva
  readonly puerto: string
  readonly placa: string
}
const sesiones = new Map<string, SesionAbierta>()
const idDeSesion = (directorio: string, idProyecto: string) => `${directorioDeDatos(directorio)}::${idProyecto}`

/** Saca la sesión del registro, libera el puerto y la cierra. Idempotente: la tríada vive en un solo lugar (A6 C-03). */
async function cerrarSesion(idSesion: string): Promise<SesionAbierta | undefined> {
  const abierta = sesiones.get(idSesion)
  if (!abierta) return undefined
  sesiones.delete(idSesion)
  liberarPuerto(abierta.puerto)
  await abierta.sesion.cerrar().catch(() => undefined)
  return abierta
}

/** Sólo para tests: cierra todo lo abierto. */
export async function cerrarTodasLasSesiones(): Promise<void> {
  for (const idSesion of [...sesiones.keys()]) await cerrarSesion(idSesion)
}

/**
 * El estado observado tal como lo ve el agente: igual al de la sesión, pero con `placa` reducida
 * a su id (el objeto entero era ruido en cada respuesta: E2E 2026-10-12, hallazgo 3) y sin la
 * clave WiFi (M2 de A1: se imprime una sola vez, en `cargar`; acá queda `claveConfigurada`).
 */
function estadoParaElAgente(sesion: SesionViva): Record<string, unknown> {
  const estado: EstadoObservado = sesion.estado()
  const wifi = estado.runtime?.wifi
  const runtime = estado.runtime === undefined ? undefined : wifi === undefined ? estado.runtime : { ...estado.runtime, wifi: { ssid: wifi.ssid, ip: wifi.ip, claveConfigurada: wifi.clave !== "" } }
  return { ...estado, placa: estado.placa.id, ...(runtime === undefined ? {} : { runtime }) }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Ejecución
// ════════════════════════════════════════════════════════════════════════════════════

interface Contexto {
  readonly directory: string
  readonly abort?: AbortSignal
}

/** Lo que `cargar` y `conectar` necesitan resolver antes de tocar nada: proyecto, placa y puerto. */
interface Resuelto {
  readonly deps: DependenciasVivo
  readonly servicio: ServicioDeProyecto
  readonly placa: Placa
  readonly puerto: string
}

export async function ejecutarVivo(args: ArgsVivo, ctx: Contexto, cargar: () => Promise<DependenciasVivo> = cargarDependencias): Promise<string> {
  try {
    if (!(ACCIONES_VIVO as readonly string[]).includes(args.accion)) {
      return json(fallo("ACCION_DESCONOCIDA", `NO SE HIZO NADA — acción desconocida (usá una de: ${ACCIONES_VIVO.join(", ")})`))
    }
    const accion = args.accion as AccionVivo
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT
    if (!validarIdProyecto(idProyecto)) return json(fallo("ID_PROYECTO_INVALIDO", "NO SE HIZO NADA — idProyecto inválido"))
    const idSesion = idDeSesion(ctx.directory, idProyecto)
    const abierta = sesiones.get(idSesion)
    const comun = { accion, idProyecto }

    // ── Las acciones sobre una sesión ya abierta no necesitan cargar nada. ──
    if (accion === "estado") {
      if (!abierta) return json(exito("SIN SESIÓN — no hay una sesión viva abierta para este proyecto (usá 'conectar')", { ...comun, sesion: "SIN_SESION" }))
      return json(exito(`ESTADO OBSERVADO — sesión ${abierta.sesion.estado().sesion} en ${abierta.puerto}`, { ...comun, puerto: abierta.puerto, estado: estadoParaElAgente(abierta.sesion) }))
    }
    if (accion === "desconectar") {
      const cerrada = await cerrarSesion(idSesion)
      if (!cerrada) return json(exito("SIN SESIÓN — no había nada que cerrar", { ...comun, sesion: "SIN_SESION" }))
      return json(exito(`SESIÓN CERRADA — ${cerrada.puerto} queda libre`, { ...comun, puerto: cerrada.puerto }))
    }
    if (accion === "accionar" || accion === "leer") {
      if (!abierta) return json(fallo("SIN_SESION", "NO SE HIZO NADA — no hay sesión viva (usá 'conectar')", comun))
      return json(await ejecutarSobreSesion(abierta, accion, args, idProyecto))
    }

    // ── cargar / conectar: necesitan el proyecto, su placa y el puerto. ──
    const resuelto = await resolver(args, ctx, comun, idSesion, cargar)
    if ("resultado" in resuelto) return json(resuelto)
    return json(accion === "cargar" ? await accionCargar(args, ctx, comun, idSesion, resuelto) : await accionConectar(comun, idSesion, resuelto))
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return json(fallo("ERROR_INESPERADO", `NO SE HIZO NADA — error inesperado (${mensaje})`, { mensaje }))
  }
}

async function resolver(args: ArgsVivo, ctx: Contexto, comun: Record<string, unknown>, idSesion: string, cargar: () => Promise<DependenciasVivo>): Promise<Resuelto | SalidaVivo> {
  let deps: DependenciasVivo
  try {
    deps = await cargar()
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return fallo("DEPENDENCIAS_NO_DISPONIBLES", `NO SE HIZO NADA — ${mensaje}`, { ...comun, mensaje })
  }
  let servicio: ServicioDeProyecto
  try {
    servicio = deps.obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(ctx.directory), idProyecto: String(comun["idProyecto"]) })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return fallo("PROYECTO_BLOQUEADO", `NO SE HIZO NADA — no pude acceder al proyecto físico: ${mensaje}`, { ...comun, mensaje })
  }
  const idPlaca = servicio.snapshot().proyecto.placa
  const placa = idPlaca === null ? undefined : deps.conocimiento.placa(idPlaca)
  if (idPlaca === null || !placa) return fallo("PROYECTO_SIN_PLACA", "NO SE HIZO NADA — el proyecto no tiene placa (usá `proyecto-fisico` SetPlaca primero)", comun)
  // El runtime V1 existe sólo para placas con un banco GPIO (contrato §2): un UNO no tiene Modo Vivo.
  try {
    deps.tablasDePines(placa)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return fallo("PLACA_NO_SOPORTADA_EN_VIVO", `NO SE HIZO NADA — el Modo Vivo todavía no existe para «${placa.id}» (sólo ESP32)`, { ...comun, placa: placa.id, mensaje })
  }

  if (args.puerto !== undefined && !puertoValido(args.puerto)) return fallo("PUERTO_INVALIDO", "NO SE HIZO NADA — puerto inválido", comun)
  let puerto = args.puerto
  if (!puerto) {
    const detectado = await deps.detectarPuerto(ctx.directory, ctx.abort)
    if ("error" in detectado) return fallo("PLACA_NO_DETECTADA", "NO SE HIZO NADA — no encontré la placa", { ...comun, explicacion: detectado.error })
    puerto = detectado.port
  }
  const dueno = duenoDelPuerto(puerto)
  if (dueno !== undefined && dueno !== idSesion) return fallo("PUERTO_EN_SESION_VIVA", `NO SE HIZO NADA — ${puerto} está en uso por una sesión viva de otro proyecto (cerrala con 'desconectar')`, { ...comun, puerto })
  return { deps, servicio, placa, puerto }
}

/**
 * V4: el runtime levanta su propia red (contrato §8). Por V4-4 la red va ABIERTA por defecto (en el
 * aula es lo que menos traba); con `redConClave` se sortea una de 8 dígitos (WPA2) en cada carga,
 * queda en el firmware y se imprime acá, UNA sola vez (M2). Por V4-5 el nombre lo elige quien la
 * usa (`nombreRed`); si no, la placa se llama `tecnia-xxxx` desde su MAC (V4-1) y lo anuncia en el
 * `hola`, así que se ve en 'conectar'. Un nombre fijo repetido en veinte placas confunde a los
 * celulares: por eso el default es por placa.
 */
async function accionCargar(args: ArgsVivo, ctx: Contexto, comun: Record<string, unknown>, idSesion: string, { deps, servicio, placa, puerto }: Resuelto): Promise<SalidaVivo> {
  const abierta = sesiones.get(idSesion)
  if (abierta !== undefined) {
    if (abierta.sesion.estado().sesion === "CONECTADA") return fallo("PUERTO_EN_SESION_VIVA", `NO SE HIZO NADA — hay una sesión viva abierta en ${abierta.puerto}: cerrala con 'desconectar' antes de cargar`, { ...comun, puerto: abierta.puerto })
    await cerrarSesion(idSesion) // X2: una sesión que ya se cayó no bloquea nada; se cierra y se sigue
  }
  const claveWifi = args.redConClave ? deps.sortearClave() : ""
  const nombreRed = args.nombreRed?.trim()
  if (nombreRed !== undefined && nombreRed !== "" && !esSsidValido(nombreRed)) return fallo("NOMBRE_RED_INVALIDO", "NO SE HIZO NADA — `nombreRed` inválido (1 a 32 caracteres ASCII, sin comillas)", comun)
  const pagina = paginaDelProyecto(placa, servicio.snapshot().proyecto, deps.conocimiento, { masPines: args.masPines === true })
  const generado = deps.generarRuntime(placa, { wifi: nombreRed ? { clave: claveWifi, ssid: nombreRed } : { clave: claveWifi }, pagina })
  const carpetaAbsoluta = carpetaDelRuntime(ctx.directory, placa.id)
  const archivosGenerados: Readonly<Record<string, string>> = { ...generado.archivos }
  materializar(carpetaAbsoluta, archivosGenerados)
  const carpeta = relative(ctx.directory, carpetaAbsoluta).split("\\").join("/")
  const archivos = Object.fromEntries(Object.entries(archivosGenerados).map(([ruta, contenido]) => [ruta, { sha256: sha256(contenido), bytes: Buffer.byteLength(contenido) }]))
  const base = {
    ...comun,
    placa: placa.id,
    runtime: generado.runtime,
    protocolo: generado.protocolo,
    puerto,
    carpeta,
    archivos,
    pagina,
    wifi: { abierta: claveWifi === "", clave: claveWifi, ssid: nombreRed || null, pagina: URL_PORTAL },
  }
  const corrida = await deps.cargarRuntime(carpetaAbsoluta, generado.environment, puerto, ctx.directory, ctx.abort)
  if (corrida.code === 0) {
    const red = nombreRed ? `"${nombreRed}"` : `"tecnia-xxxx" (el nombre exacto lo dice 'conectar')`
    const clave = claveWifi === "" ? "abierta, sin clave" : `con clave ${claveWifi} (anotala: no se vuelve a mostrar)`
    return exito(`RUNTIME CARGADO — ${placa.id}, runtime ${generado.runtime}, en ${puerto}. La placa levanta su red WiFi ${red}, ${clave}. Ahora 'conectar'.`, base)
  }
  const codigo = corrida.code === CODIGO_TIMEOUT ? "CARGA_TIEMPO_AGOTADO" : corrida.code === CODIGO_CANCELADO ? "CARGA_CANCELADA" : corrida.code === 127 ? "PLATFORMIO_NO_ENCONTRADO" : "CARGA_FALLIDA"
  return fallo(codigo, `NO SE CARGÓ — ${codigo}`, {
    ...base,
    exitCode: corrida.code,
    explicacion: codigo === "PLATFORMIO_NO_ENCONTRADO" ? 'PlatformIO no está instalado: usá la tool `platformio` con action "reparar".' : traducirError(corrida.stderr, corrida.stdout),
    salida: recortarSalida(corrida.stderr.trim() ? corrida.stderr : corrida.stdout),
  })
}

async function accionConectar(comun: Record<string, unknown>, idSesion: string, { deps, servicio, placa, puerto }: Resuelto): Promise<SalidaVivo> {
  const abierta = sesiones.get(idSesion)
  let anterior: Record<string, unknown> | undefined
  if (abierta !== undefined) {
    const estadoAnterior = abierta.sesion.estado()
    if (estadoAnterior.sesion === "CONECTADA") return exito(`YA CONECTADO — sesión CONECTADA en ${abierta.puerto}`, { ...comun, puerto: abierta.puerto, estado: estadoParaElAgente(abierta.sesion) })
    // X2 (A1-A2, A2-A3): una sesión registrada que ya no está CONECTADA (cable, reinicio sin hola,
    // puente caído) no es "ya conectado": se cierra, se libera el puerto y se vuelve a conectar.
    await cerrarSesion(idSesion)
    anterior = { sesion: estadoAnterior.sesion, ...(estadoAnterior.motivo === undefined ? {} : { motivo: estadoAnterior.motivo }) }
  }
  if (!reservarPuerto(puerto, idSesion)) return fallo("PUERTO_EN_SESION_VIVA", `NO SE HIZO NADA — ${puerto} está en uso`, { ...comun, puerto })
  let puente: Puente
  try {
    puente = await deps.abrirPuenteSerie({ puerto })
  } catch (error) {
    liberarPuerto(puerto)
    const mensaje = error instanceof Error ? error.message : String(error)
    return fallo("PUERTO_NO_ABIERTO", `NO SE CONECTÓ — no pude abrir ${puerto} (si hay un monitor serie abierto sobre ese puerto, cerralo)`, { ...comun, puerto, mensaje })
  }
  let sesion: SesionViva
  try {
    sesion = await deps.abrirSesion({ puente, placa, proyecto: servicio.snapshot().proyecto, conocimiento: deps.conocimiento })
  } catch (error) {
    liberarPuerto(puerto)
    await puente.cerrar().catch(() => undefined)
    const mensaje = error instanceof Error ? error.message : String(error)
    return fallo("SESION_NO_ABIERTA", `NO SE CONECTÓ — ${mensaje}`, { ...comun, puerto, mensaje })
  }
  const estado = sesion.estado()
  if (estado.sesion !== "CONECTADA") {
    // Una sesión que no llegó a CONECTADA (runtime incompatible, sin hola) no se deja abierta:
    // el puerto vuelve a estar libre y el agente puede ofrecer 'cargar'.
    liberarPuerto(puerto)
    await sesion.cerrar().catch(() => undefined)
    return fallo(estado.sesion, `NO SE CONECTÓ — ${estado.sesion}`, { ...comun, puerto, estado: estadoParaElAgente(sesion) })
  }
  const registrada: SesionAbierta = { sesion, puerto, placa: placa.id }
  sesiones.set(idSesion, registrada)
  // V4-9: si la sesión termina sola (SIN_PONG sin reconexión, puente caído, reinicio sin hola), el
  // puerto se libera acá mismo; el próximo 'conectar' reconecta sin pedir 'desconectar' antes.
  sesion.alCierre(() => {
    if (sesiones.get(idSesion) !== registrada) return
    sesiones.delete(idSesion)
    liberarPuerto(puerto)
  })
  const red = estado.runtime?.wifi
  const textoRed = red ? ` Red WiFi de la placa: "${red.ssid}", ${red.clave === "" ? "abierta (sin clave)" : "con clave (la que imprimió 'cargar')"}; la página se abre sola al conectarse (si no, http://${red.ip}/).` : ""
  const textoAnterior = anterior ? ` (la sesión anterior estaba ${String(anterior["sesion"])}; se cerró y se volvió a conectar)` : ""
  return exito(`CONECTADO — runtime ${estado.runtime?.version ?? "?"} en ${puerto}${textoAnterior}.${textoRed} El puerto queda reservado hasta 'desconectar'.`, { ...comun, puerto, ...(anterior ? { anterior } : {}), estado: estadoParaElAgente(sesion) })
}

// ════════════════════════════════════════════════════════════════════════════════════
// accionar / leer sobre la sesión
// ════════════════════════════════════════════════════════════════════════════════════

type Destino = { readonly tipo: "componente"; readonly id: string } | { readonly tipo: "pin"; readonly id: string; readonly numero: number }
type Peticion = { readonly tipo: "pwm"; readonly porcentaje: number } | { readonly tipo: "nivel"; readonly nivel: "alto" | "bajo" }

/** `componente` (id del proyecto) o `pin` (`GPIO<n>` de la placa de la sesión): uno solo, y el pin tiene que existir en la placa (sin centinela -1). */
function resolverDestino(args: ArgsVivo, placa: Placa): Destino | { readonly codigo: string; readonly resultado: string } {
  const porComponente = args.componente?.trim()
  const porPin = args.pin?.trim()
  if (!porComponente && !porPin) return { codigo: "DESTINO_FALTANTE", resultado: "NO SE HIZO NADA — falta `componente` (id del proyecto) o `pin` (GPIO<n>)" }
  if (porComponente && porPin) return { codigo: "DESTINO_AMBIGUO", resultado: "NO SE HIZO NADA — `componente` y `pin` a la vez: elegí uno" }
  if (porComponente) return { tipo: "componente", id: porComponente }
  const numero = placa.pines.find((p) => p.id === porPin)?.numero
  if (numero === undefined) return { codigo: "PIN_INEXISTENTE_EN_PLACA", resultado: `NO SE HIZO NADA — ${porPin} no es un pin de «${placa.id}» (los pines válidos los dice \`proyecto-fisico leer\`)` }
  return { tipo: "pin", id: porPin as string, numero }
}

function resolverPeticion(args: ArgsVivo): Peticion | { readonly codigo: string; readonly resultado: string } {
  const esPwm = args.porcentaje !== undefined
  if (esPwm && args.nivel !== undefined) return { codigo: "ACCION_AMBIGUA", resultado: "NO SE HIZO NADA — `nivel` y `porcentaje` a la vez: elegí uno" }
  if (esPwm) {
    const porcentaje = args.porcentaje as number
    if (!Number.isInteger(porcentaje) || porcentaje < 0 || porcentaje > 100) return { codigo: "ACCION_INVALIDA", resultado: "NO SE HIZO NADA — `porcentaje` tiene que ser un entero de 0 a 100" }
    return { tipo: "pwm", porcentaje }
  }
  if (args.nivel !== "alto" && args.nivel !== "bajo") return { codigo: "ACCION_INVALIDA", resultado: "NO SE HIZO NADA — `nivel` tiene que ser 'alto' o 'bajo' (o pasá `porcentaje` para PWM)" }
  return { tipo: "nivel", nivel: args.nivel }
}

async function ejecutarSobreSesion(abierta: SesionAbierta, accion: "accionar" | "leer", args: ArgsVivo, idProyecto: string): Promise<SalidaVivo> {
  const { sesion, puerto } = abierta
  const comun = { accion, idProyecto, puerto }
  const placa = sesion.estado().placa
  const destino = resolverDestino(args, placa)
  if ("codigo" in destino) return fallo(destino.codigo, destino.resultado, comun)
  const conEstado = (extra: Record<string, unknown>) => ({ ...comun, destino: destino.id, ...extra, estado: estadoParaElAgente(sesion) })

  if (accion === "accionar") {
    const peticion = resolverPeticion(args)
    if ("codigo" in peticion) return fallo(peticion.codigo, peticion.resultado, comun)
    const r = destino.tipo === "componente" ? await sesion.accionar(destino.id, peticion) : await sesion.comando(comandoDeEscritura(destino.numero, peticion))
    const que = peticion.tipo === "pwm" ? `PWM ${peticion.porcentaje} %` : peticion.nivel
    return r.ok ? exito(`ACCIONADO — ${destino.id}: ${que}`, conEstado({ respuesta: r.valor })) : fallo(r.codigo, `NO SE ACCIONÓ — ${r.codigo}`, conEstado({ datos: r.datos ?? null }))
  }

  const r = destino.tipo === "componente" ? await sesion.leer(destino.id) : await sesion.comando(comandoDeLectura(placa, destino.numero))
  return r.ok ? exito(`LEÍDO — ${destino.id}`, conEstado({ respuesta: r.valor })) : fallo(r.codigo, `NO SE LEYÓ — ${r.codigo}`, conEstado({ datos: r.datos ?? null }))
}

/** Comando crudo por pin: la sesión y el runtime aplican la política de la placa (prohibidos, capacidades). */
function comandoDeEscritura(pin: number, peticion: Peticion): Comando {
  return peticion.tipo === "pwm" ? { comando: "pwm.escribir", pin, porcentaje: peticion.porcentaje } : { comando: "digital.escribir", pin, nivel: peticion.nivel }
}

/** Lectura cruda por pin: analógica si el pin tiene ADC en esta placa, digital si no. */
function comandoDeLectura(placa: Placa, pin: number): Comando {
  const registro = placa.pines.find((p) => p.numero === pin)
  return registro?.capacidades.adc ? { comando: "analogico.leer", pin } : { comando: "digital.leer", pin }
}

// ════════════════════════════════════════════════════════════════════════════════════
// La tool (descripción = contrato de entrada/salida; la pedagogía vive en el prompt)
// ════════════════════════════════════════════════════════════════════════════════════

export default tool({
  description: `Modo Vivo: el LABORATORIO del proyecto físico actual (sólo ESP32). Un runtime base por placa, cargado una sola vez, con el que se prende, se mueve y se mide en vivo sin compilar ni cargar por cada acción. No corre las reglas del proyecto (eso es el programa generado por \`programa\`).

Seis \`accion\`:
- \`cargar\`: genera el runtime de la placa del proyecto y lo compila y carga por USB (una vez por placa). Pisa el programa que la placa tenía. Opciones: \`nombreRed\` (el nombre de la red WiFi de la placa; sin él, \`tecnia-xxxx\`), \`redConClave\` (sortea una clave de 8 dígitos y la imprime UNA sola vez), \`masPines\` (la página ofrece también las salidas libres de la placa; por defecto sólo los pines del proyecto). Devuelve \`wifi\` y \`pagina\` (los pines que ofrece la página).
- \`conectar\`: abre el puerto serie, hace el handshake con el runtime y deja la sesión abierta; devuelve \`estado\` con \`runtime.wifi\` (\`ssid\`, \`ip\`, \`claveConfigurada\`). El puerto queda reservado: \`platformio\` y \`programa cargar\` no lo tocan hasta \`desconectar\`. Si la sesión anterior se había caído, la cierra y reconecta (\`anterior\`).
- \`estado\`: lo que la sesión OBSERVÓ (runtime, lecturas con instante, último reinicio), con procedencia. Lo que no se observó figura sin dato.
- \`accionar\`: \`componente\` (id del proyecto) o \`pin\` (GPIO<n>) con \`nivel\` ('alto'/'bajo') o \`porcentaje\` (PWM 0–100).
- \`leer\`: \`componente\` o \`pin\`; digital o analógica según la capacidad del pin (\`crudo\` 0–4095).
- \`desconectar\`: cierra la sesión y libera el puerto.

Toda salida empieza con \`resultado\` y trae \`ok\` y, si falla, un \`codigo\` estable. De la tool: ACCION_DESCONOCIDA, ID_PROYECTO_INVALIDO, PROYECTO_SIN_PLACA, PLACA_NO_SOPORTADA_EN_VIVO, PLACA_NO_DETECTADA, PUERTO_INVALIDO, PUERTO_EN_SESION_VIVA, PUERTO_NO_ABIERTO, NOMBRE_RED_INVALIDO, CARGA_FALLIDA, PLATFORMIO_NO_ENCONTRADO, SIN_SESION, DESTINO_FALTANTE, DESTINO_AMBIGUO, PIN_INEXISTENTE_EN_PLACA, ACCION_AMBIGUA, ACCION_INVALIDA. De la sesión: RUNTIME_INCOMPATIBLE (ofrecé \`cargar\`), SESION_NO_CONECTADA, TIEMPO_AGOTADO, RESPUESTA_INVALIDA, COMPONENTE_INEXISTENTE, COMPONENTE_SIN_PIN, ACCION_NO_APLICABLE, COMANDO_NO_SOPORTADO_POR_RUNTIME, CAPACIDAD_NO_SOPORTADA_POR_PLACA. De la placa: PIN_PROHIBIDO, PIN_SIN_CAPACIDAD, PIN_INEXISTENTE. Nunca afirmes que un componente "está conectado" o "funciona" por una respuesta \`ok\`: decí exactamente qué respondió la placa y cuándo.`,
  args: {
    accion: tool.schema.enum([...ACCIONES_VIVO]).describe("cargar | conectar | estado | accionar | leer | desconectar"),
    idProyecto: tool.schema.string().optional().describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}", el mismo de \`proyecto-fisico\`, \`vista-fisica\` y \`programa\`.`),
    puerto: tool.schema.string().optional().describe("Puerto serie (COM3, /dev/ttyUSB0). Si no se indica, se detecta la placa por USB."),
    componente: tool.schema.string().optional().describe("Id de un componente del proyecto (cmp-0, cmp-1…) para accionar o leer."),
    pin: tool.schema.string().optional().describe("Pin de la placa (GPIO23) para accionar o leer sin pasar por un componente del proyecto."),
    nivel: tool.schema.enum(["alto", "bajo"]).optional().describe("Para accionar: 'alto' prende, 'bajo' apaga."),
    porcentaje: tool.schema.number().int().min(0).max(100).optional().describe("Para accionar con PWM: entero de 0 a 100."),
    redConClave: tool.schema.boolean().optional().describe("Para cargar: true pone una clave WPA2 de 8 dígitos (sorteada e impresa una sola vez) a la red de la placa. Por defecto la red va abierta, sin clave."),
    nombreRed: tool.schema.string().optional().describe("Para cargar: el nombre que eligieron para la red WiFi de su placa (hasta 32 caracteres ASCII, sin comillas). Si no eligen, omitilo y la placa se llama tecnia-xxxx, distinto en cada una."),
    masPines: tool.schema.boolean().optional().describe("Para cargar: true hace que la página del celular ofrezca también las salidas libres de la placa (detrás de 'más pines'). Por defecto sólo los pines del proyecto."),
  },
  async execute(args, ctx) {
    return ejecutarVivo(args, ctx)
  },
})
