/// <reference path="../env.d.ts" />
// Tool "vivo" — Modo Vivo V1 (tecnia-bot-docs/esp32-completo/MODO-VIVO-PLAN.md, decisiones HD-08).
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
// `platformio.ts`, que es quien carga y abre el monitor).

import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { Placa } from "../nucleo/placas.ts"
import type { ServicioDeProyecto } from "../nucleo/composicion-raiz.ts"
import type { Comando } from "../vivo/protocolo.ts"
import type { Puente, SesionViva } from "../vivo/sesion-viva.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
import { CODIGO_CANCELADO, CODIGO_TIMEOUT, detectPort, duenoDelPuerto, liberarPuerto, puertoValido, recortarSalida, reservarPuerto, run, timeoutLargoMs, traducirError } from "./platformio.ts"

type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloConocimientoActivo = typeof import("../conocimiento/conocimiento-activo.ts")
type ModuloRuntime = typeof import("../codegen/runtime.ts")
type ModuloSesion = typeof import("../vivo/sesion-viva.ts")
type ModuloTransporte = typeof import("../vivo/transporte-serie.ts")

export interface DependenciasVivo {
  readonly obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  readonly conocimiento: ModuloConocimientoActivo["CONOCIMIENTO_ACTIVO"]
  readonly generarRuntime: ModuloRuntime["generarRuntime"]
  readonly abrirSesion: ModuloSesion["abrirSesion"]
  readonly abrirPuenteSerie: ModuloTransporte["abrirPuenteSerie"]
  /** Detecta el puerto de la placa (VID:PID) — el de `platformio.ts`, inyectable en tests. */
  readonly detectarPuerto: (cwd: string, signal?: AbortSignal) => Promise<{ port: string } | { error: string }>
  /** Compila y carga la carpeta del runtime en `puerto` — PlatformIO, inyectable en tests. */
  readonly cargarRuntime: (carpeta: string, environment: string, puerto: string, cwd: string, signal?: AbortSignal) => Promise<{ code: number; stdout: string; stderr: string }>
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
      abrirSesion: sesion.abrirSesion,
      abrirPuenteSerie: transporte.abrirPuenteSerie,
      detectarPuerto: detectPort,
      cargarRuntime: (carpeta, environment, puerto, cwd, signal) => run(["pio", "run", "-d", carpeta, "-e", environment, "-t", "upload", "--upload-port", puerto], cwd, signal, timeoutLargoMs()),
    }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(`Falta una carpeta de Tecnia Bot ("servidor", "conocimiento", "codegen" o "vivo") junto a esta tool (no se pudo cargar: ${detalle}). Reinstalá Tecnia Bot para arreglarlo.`)
  }
}

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
}

/** Carpeta derivada del runtime de una placa: junto a los datos, descartable, una por placa. */
export function carpetaDelRuntime(directorioActivo: string, placa: string): string {
  return join(directorioDeDatos(directorioActivo), "runtime-vivo", placa)
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")
const json = (valor: unknown) => JSON.stringify(valor, null, 2)

function materializar(carpeta: string, archivos: Readonly<Record<string, string>>): void {
  mkdirSync(carpeta, { recursive: true })
  for (const entrada of readdirSync(carpeta)) if (entrada !== ".pio") rmSync(join(carpeta, entrada), { recursive: true, force: true })
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(carpeta, ruta)), { recursive: true })
    writeFileSync(join(carpeta, ruta), contenido)
  }
}

/** Sesiones abiertas en ESTE proceso, por proyecto. Se pierden al cerrar OpenCode, a propósito. */
interface SesionAbierta {
  readonly sesion: SesionViva
  readonly puerto: string
  readonly placa: string
}
const sesiones = new Map<string, SesionAbierta>()
const claveDe = (directorio: string, idProyecto: string) => `${directorioDeDatos(directorio)}::${idProyecto}`

/** Sólo para tests: cierra todo lo abierto. */
export async function cerrarTodasLasSesiones(): Promise<void> {
  for (const [clave, abierta] of sesiones) {
    sesiones.delete(clave)
    liberarPuerto(abierta.puerto)
    await abierta.sesion.cerrar().catch(() => undefined)
  }
}

/** `GPIO<n>` → n, validado contra la placa. */
function numeroDePin(placa: Placa, id: string): number | undefined {
  return placa.pines.find((p) => p.id === id)?.numero
}

export async function ejecutarVivo(args: ArgsVivo, ctx: { readonly directory: string; readonly abort?: AbortSignal }, cargar: () => Promise<DependenciasVivo> = cargarDependencias): Promise<string> {
  try {
    if (!(ACCIONES_VIVO as readonly string[]).includes(args.accion)) {
      return json({ resultado: `NO SE HIZO NADA — acción desconocida (usá una de: ${ACCIONES_VIVO.join(", ")})`, ok: false, codigo: "ACCION_DESCONOCIDA" })
    }
    const accion = args.accion as AccionVivo
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT
    if (!validarIdProyecto(idProyecto)) return json({ resultado: "NO SE HIZO NADA — idProyecto inválido", ok: false, codigo: "ID_PROYECTO_INVALIDO" })
    const clave = claveDe(ctx.directory, idProyecto)
    const abierta = sesiones.get(clave)

    // ── Las acciones sobre una sesión ya abierta no necesitan cargar nada. ──
    if (accion === "estado") {
      if (!abierta) return json({ resultado: "SIN SESIÓN — no hay una sesión viva abierta para este proyecto (usá 'conectar')", ok: true, accion, idProyecto, sesion: "SIN_SESION" })
      return json({ resultado: `ESTADO OBSERVADO — sesión ${abierta.sesion.estado().sesion} en ${abierta.puerto}`, ok: true, accion, idProyecto, puerto: abierta.puerto, estado: abierta.sesion.estado() })
    }
    if (accion === "desconectar") {
      if (!abierta) return json({ resultado: "SIN SESIÓN — no había nada que cerrar", ok: true, accion, idProyecto, sesion: "SIN_SESION" })
      sesiones.delete(clave)
      liberarPuerto(abierta.puerto)
      await abierta.sesion.cerrar()
      return json({ resultado: `SESIÓN CERRADA — ${abierta.puerto} queda libre`, ok: true, accion, idProyecto, puerto: abierta.puerto })
    }
    if (accion === "accionar" || accion === "leer") {
      if (!abierta) return json({ resultado: "NO SE HIZO NADA — no hay sesión viva (usá 'conectar')", ok: false, accion, idProyecto, codigo: "SIN_SESION" })
      const resultado = await ejecutarSobreSesion(abierta, accion, args, idProyecto)
      return json(resultado)
    }

    // ── cargar / conectar: necesitan el proyecto, su placa y el puerto. ──
    let deps: DependenciasVivo
    try {
      deps = await cargar()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE HIZO NADA — ${mensaje}`, ok: false, accion, codigo: "DEPENDENCIAS_NO_DISPONIBLES", mensaje })
    }
    let servicio: ServicioDeProyecto
    try {
      servicio = deps.obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(ctx.directory), idProyecto })
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE HIZO NADA — no pude acceder al proyecto físico: ${mensaje}`, ok: false, accion, codigo: "PROYECTO_BLOQUEADO", mensaje })
    }
    const snapshot = servicio.snapshot()
    const idPlaca = snapshot.proyecto.placa
    const placa = idPlaca === null ? undefined : deps.conocimiento.placa(idPlaca)
    if (idPlaca === null || !placa) return json({ resultado: "NO SE HIZO NADA — el proyecto no tiene placa (usá `proyecto-fisico` SetPlaca primero)", ok: false, accion, idProyecto, codigo: "PROYECTO_SIN_PLACA" })

    if (args.puerto !== undefined && !puertoValido(args.puerto)) return json({ resultado: "NO SE HIZO NADA — puerto inválido", ok: false, accion, idProyecto, codigo: "PUERTO_INVALIDO" })
    let puerto = args.puerto
    if (!puerto) {
      const detectado = await deps.detectarPuerto(ctx.directory, ctx.abort)
      if ("error" in detectado) return json({ resultado: "NO SE HIZO NADA — no encontré la placa", ok: false, accion, idProyecto, codigo: "PLACA_NO_DETECTADA", explicacion: detectado.error })
      puerto = detectado.port
    }
    const dueno = duenoDelPuerto(puerto)
    if (dueno !== undefined && dueno !== clave) return json({ resultado: `NO SE HIZO NADA — ${puerto} está en uso por una sesión viva de otro proyecto (cerrala con 'desconectar')`, ok: false, accion, idProyecto, puerto, codigo: "PUERTO_EN_SESION_VIVA" })

    if (accion === "cargar") {
      if (abierta) return json({ resultado: `NO SE HIZO NADA — hay una sesión viva abierta en ${abierta.puerto}: cerrala con 'desconectar' antes de cargar`, ok: false, accion, idProyecto, puerto: abierta.puerto, codigo: "PUERTO_EN_SESION_VIVA" })
      const generado = deps.generarRuntime(placa)
      const carpetaAbsoluta = carpetaDelRuntime(ctx.directory, placa.id)
      const archivosGenerados: Readonly<Record<string, string>> = { ...generado.archivos }
      materializar(carpetaAbsoluta, archivosGenerados)
      const carpeta = relative(ctx.directory, carpetaAbsoluta).split("\\").join("/")
      const archivos = Object.fromEntries(Object.entries(archivosGenerados).map(([ruta, contenido]) => [ruta, { sha256: sha256(contenido), bytes: Buffer.byteLength(contenido) }]))
      const base = { accion, idProyecto, placa: placa.id, runtime: generado.runtime, protocolo: generado.protocolo, puerto, carpeta, archivos }
      const corrida = await deps.cargarRuntime(carpetaAbsoluta, generado.environment, puerto, ctx.directory, ctx.abort)
      if (corrida.code === 0) return json({ resultado: `RUNTIME CARGADO — ${placa.id}, runtime ${generado.runtime}, en ${puerto}. Ahora 'conectar'.`, ok: true, ...base })
      const codigo = corrida.code === CODIGO_TIMEOUT ? "CARGA_TIEMPO_AGOTADO" : corrida.code === CODIGO_CANCELADO ? "CARGA_CANCELADA" : corrida.code === 127 ? "PLATFORMIO_NO_ENCONTRADO" : "CARGA_FALLIDA"
      return json({
        resultado: `NO SE CARGÓ — ${codigo}`,
        ok: false,
        ...base,
        codigo,
        exitCode: corrida.code,
        explicacion: codigo === "PLATFORMIO_NO_ENCONTRADO" ? 'PlatformIO no está instalado: usá la tool `platformio` con action "reparar".' : traducirError(corrida.stderr, corrida.stdout),
        salida: recortarSalida(corrida.stderr.trim() ? corrida.stderr : corrida.stdout),
      })
    }

    // accion === "conectar"
    if (abierta) return json({ resultado: `YA CONECTADO — sesión ${abierta.sesion.estado().sesion} en ${abierta.puerto}`, ok: true, accion, idProyecto, puerto: abierta.puerto, estado: abierta.sesion.estado() })
    if (!reservarPuerto(puerto, clave)) return json({ resultado: `NO SE HIZO NADA — ${puerto} está en uso`, ok: false, accion, idProyecto, puerto, codigo: "PUERTO_EN_SESION_VIVA" })
    let puente: Puente
    try {
      puente = await deps.abrirPuenteSerie({ puerto })
    } catch (error) {
      liberarPuerto(puerto)
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE CONECTÓ — no pude abrir ${puerto}`, ok: false, accion, idProyecto, puerto, codigo: "PUERTO_NO_ABIERTO", mensaje })
    }
    let sesion: SesionViva
    try {
      sesion = await deps.abrirSesion({ puente, placa, proyecto: snapshot.proyecto, conocimiento: deps.conocimiento })
    } catch (error) {
      liberarPuerto(puerto)
      await puente.cerrar().catch(() => undefined)
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE CONECTÓ — ${mensaje}`, ok: false, accion, idProyecto, puerto, codigo: "SESION_NO_ABIERTA", mensaje })
    }
    const estado = sesion.estado()
    if (estado.sesion !== "CONECTADA") {
      // Una sesión que no llegó a CONECTADA (runtime incompatible, sin hola) no se deja abierta:
      // el puerto vuelve a estar libre y el agente puede ofrecer 'cargar'.
      sesiones.delete(clave)
      liberarPuerto(puerto)
      await sesion.cerrar().catch(() => undefined)
      return json({ resultado: `NO SE CONECTÓ — ${estado.sesion}`, ok: false, accion, idProyecto, puerto, codigo: estado.sesion, estado })
    }
    sesiones.set(clave, { sesion, puerto, placa: placa.id })
    return json({ resultado: `CONECTADO — runtime ${estado.runtime?.version ?? "?"} en ${puerto}. El puerto queda reservado hasta 'desconectar'.`, ok: true, accion, idProyecto, puerto, estado })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return json({ resultado: `NO SE HIZO NADA — error inesperado (${mensaje})`, ok: false, codigo: "ERROR_INESPERADO", mensaje })
  }
}

async function ejecutarSobreSesion(abierta: SesionAbierta, accion: "accionar" | "leer", args: ArgsVivo, idProyecto: string): Promise<Record<string, unknown>> {
  const { sesion, puerto } = abierta
  const comun = { accion, idProyecto, puerto }
  const porComponente = args.componente?.trim()
  const porPin = args.pin?.trim()
  if (!porComponente && !porPin) return { resultado: "NO SE HIZO NADA — falta `componente` (id del proyecto) o `pin` (GPIO<n>)", ok: false, ...comun, codigo: "DESTINO_FALTANTE" }
  if (porComponente && porPin) return { resultado: "NO SE HIZO NADA — `componente` y `pin` a la vez: elegí uno", ok: false, ...comun, codigo: "DESTINO_AMBIGUO" }

  if (accion === "accionar") {
    const esPwm = args.porcentaje !== undefined
    if (esPwm && args.nivel !== undefined) return { resultado: "NO SE HIZO NADA — `nivel` y `porcentaje` a la vez: elegí uno", ok: false, ...comun, codigo: "ACCION_AMBIGUA" }
    if (!esPwm && args.nivel !== "alto" && args.nivel !== "bajo") return { resultado: "NO SE HIZO NADA — `nivel` tiene que ser 'alto' o 'bajo' (o pasá `porcentaje` para PWM)", ok: false, ...comun, codigo: "ACCION_INVALIDA" }
    if (esPwm && (!Number.isInteger(args.porcentaje) || (args.porcentaje as number) < 0 || (args.porcentaje as number) > 100)) return { resultado: "NO SE HIZO NADA — `porcentaje` tiene que ser un entero de 0 a 100", ok: false, ...comun, codigo: "ACCION_INVALIDA" }
    const peticion = esPwm ? ({ tipo: "pwm", porcentaje: args.porcentaje as number } as const) : ({ tipo: "nivel", nivel: args.nivel as "alto" | "bajo" } as const)
    const r = porComponente ? await sesion.accionar(porComponente, peticion) : await sesion.comando(comandoDePin(abierta, porPin as string, peticion))
    return r.ok
      ? { resultado: `ACCIONADO — ${porComponente ?? porPin}: ${esPwm ? `PWM ${args.porcentaje} %` : args.nivel}`, ok: true, ...comun, destino: porComponente ?? porPin, respuesta: r.valor, estado: sesion.estado() }
      : { resultado: `NO SE ACCIONÓ — ${r.codigo}`, ok: false, ...comun, destino: porComponente ?? porPin, codigo: r.codigo, datos: r.datos ?? null, estado: sesion.estado() }
  }

  const r = porComponente ? await sesion.leer(porComponente) : await sesion.comando(comandoDeLectura(abierta, porPin as string))
  return r.ok
    ? { resultado: `LEÍDO — ${porComponente ?? porPin}`, ok: true, ...comun, destino: porComponente ?? porPin, respuesta: r.valor, estado: sesion.estado() }
    : { resultado: `NO SE LEYÓ — ${r.codigo}`, ok: false, ...comun, destino: porComponente ?? porPin, codigo: r.codigo, datos: r.datos ?? null, estado: sesion.estado() }
}

/** Comando crudo por pin (`GPIO<n>`): un pin que la placa no tiene va igual a la sesión, que lo rechaza con su código (A). */
function comandoDePin(abierta: SesionAbierta, pinId: string, peticion: { tipo: "pwm"; porcentaje: number } | { tipo: "nivel"; nivel: "alto" | "bajo" }): Comando {
  const pin = numeroDePin(abierta.sesion.estado().placa, pinId) ?? -1
  return peticion.tipo === "pwm" ? { comando: "pwm.escribir", pin, porcentaje: peticion.porcentaje } : { comando: "digital.escribir", pin, nivel: peticion.nivel }
}

/** Lectura cruda por pin: analógica si el pin tiene ADC en esta placa, digital si no. */
function comandoDeLectura(abierta: SesionAbierta, pinId: string): Comando {
  const placa = abierta.sesion.estado().placa
  const registro = placa.pines.find((p) => p.id === pinId)
  const pin = registro?.numero ?? -1
  return registro?.capacidades.adc ? { comando: "analogico.leer", pin } : { comando: "digital.leer", pin }
}

export default tool({
  description: `Modo Vivo: el LABORATORIO del proyecto físico actual. Un runtime base por placa, cargado una sola vez, con el que se prende, se mueve y se mide en vivo sin compilar ni cargar por cada acción. No corre las reglas del proyecto (eso es el programa generado por \`programa\`): sirve para probar los componentes antes de programar.

Seis \`accion\`:
- \`cargar\`: genera el runtime de la placa del proyecto y lo compila y carga por USB (una vez por placa; después no hace falta repetirlo).
- \`conectar\`: abre el puerto serie, hace el handshake con el runtime y deja la sesión abierta. El puerto queda reservado: \`platformio\` no carga ni abre el monitor hasta \`desconectar\`.
- \`estado\`: lo que la sesión OBSERVÓ (runtime, lecturas, último reinicio), con procedencia. Lo que no se observó figura sin dato: NO lo inventes.
- \`accionar\`: \`componente\` (id del proyecto) o \`pin\` (GPIO<n>) con \`nivel\` ('alto'/'bajo') o \`porcentaje\` (PWM 0–100).
- \`leer\`: \`componente\` o \`pin\`; digital o analógica según la capacidad del pin.
- \`desconectar\`: cierra la sesión y libera el puerto.

Toda salida empieza con \`resultado\` y trae \`ok\` y, si falla, un \`codigo\` estable. Si la respuesta es \`RUNTIME_INCOMPATIBLE\` ofrecé \`cargar\`. Si es \`PUERTO_EN_SESION_VIVA\`, hay que \`desconectar\` primero. Nunca afirmes que un componente "está conectado" o "funciona" por una respuesta \`ok\`: decí exactamente qué respondió la placa y cuándo.`,
  args: {
    accion: tool.schema.enum([...ACCIONES_VIVO]).describe("cargar | conectar | estado | accionar | leer | desconectar"),
    idProyecto: tool.schema.string().optional().describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}", el mismo de \`proyecto-fisico\`, \`vista-fisica\` y \`programa\`.`),
    puerto: tool.schema.string().optional().describe("Puerto serie (COM3, /dev/ttyUSB0). Si no se indica, se detecta la placa por USB."),
    componente: tool.schema.string().optional().describe("Id de un componente del proyecto (cmp-0, cmp-1…) para accionar o leer."),
    pin: tool.schema.string().optional().describe("Pin de la placa (GPIO23) para accionar o leer sin pasar por un componente del proyecto."),
    nivel: tool.schema.enum(["alto", "bajo"]).optional().describe("Para accionar: 'alto' prende, 'bajo' apaga."),
    porcentaje: tool.schema.number().optional().describe("Para accionar con PWM: 0 a 100."),
  },
  async execute(args, ctx) {
    return ejecutarVivo(args, ctx)
  },
})
