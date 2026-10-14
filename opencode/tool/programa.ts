// Tool "programa" — Codegen MVP, Slice 1b.
//
// Para un proyecto físico (el del Project Engine), el programa de la placa NO lo escribe el
// modelo: se GENERA desde la IR con el backend determinista (`codegen/programa.ts`). Esta tool
// sólo orquesta, sobre el proyecto ACTUAL:
//
//   IR (el mismo servicio y candado que `proyecto-fisico`) → generarPrograma → archivos
//   derivados en una carpeta descartable → (compilar) el runner de PlatformIO existente.
//
// No es un segundo generador: no hay acá readiness, admisión, derivaciones, pines ni render.
// No recibe código, comandos, rutas ni flags del agente: sólo la acción, opcional el id del
// proyecto (validado) y, para `cargar`, opcional el puerto serie (validado contra una lista
// cerrada de formas). El environment sale del proyecto vía el codegen. `compilar` y `cargar`
// regeneran SIEMPRE antes y compilan exactamente esos bytes (los releen y comparan), así nadie
// puede editar el C++ entre la generación y PlatformIO. La carpeta derivada nunca es fuente
// de verdad: se borra y se vuelve a escribir en cada llamada (y se vacía si la generación falla,
// para que no quede un programa viejo que parezca el actual).
//
// `cargar` (auditoría 2026-10-13, A4 "el bot no puede cargar el programa generado"): el mismo
// `pio run --target upload` que la tool `platformio` usa para el código escrito a mano, sobre la
// carpeta derivada. Respeta la exclusión del Modo Vivo: si el puerto está en una sesión viva
// devuelve `PUERTO_EN_SESION_VIVA` (hay que `vivo desconectar` primero). Cargar el programa pisa
// el runtime del Modo Vivo que tuviera la placa; volver al laboratorio es `vivo cargar`.
//
// Si el codegen no soporta el proyecto devuelve su error `CODEGEN_*` tal cual: no hay plan B.

import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { ServicioDeProyecto, Snapshot } from "../nucleo/composicion-raiz.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
import { CODIGO_CANCELADO, CODIGO_TIMEOUT, detectPort, duenoDelPuerto, puertoValido, recortarSalida, run, timeoutLargoMs, traducirError } from "./platformio.ts"

// Import perezoso (criterio D13, igual que `proyecto-fisico.ts`): si falta una carpeta de la
// instalación, sólo esta tool se entera, y recién cuando se usa.
type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloConocimientoActivo = typeof import("../conocimiento/conocimiento-activo.ts")
type ModuloCodegen = typeof import("../codegen/programa.ts")

export interface DependenciasPrograma {
  readonly obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  readonly conocimiento: ModuloConocimientoActivo["CONOCIMIENTO_ACTIVO"]
  readonly generarPrograma: ModuloCodegen["generarPrograma"]
  /** Para `cargar` sin `puerto`: detecta la placa por USB (VID:PID). El de `platformio.ts`; inyectable en tests. */
  readonly detectarPuerto?: (cwd: string, signal?: AbortSignal) => Promise<{ port: string } | { error: string }>
}

export const ACCIONES_PROGRAMA = ["generar", "compilar", "cargar"] as const
type AccionPrograma = (typeof ACCIONES_PROGRAMA)[number]

async function cargarDependencias(): Promise<DependenciasPrograma> {
  try {
    const [servicio, conocimiento, codegen] = await Promise.all([
      import("../servidor/servicio-con-vista.ts"),
      import("../conocimiento/conocimiento-activo.ts"),
      import("../codegen/programa.ts"),
    ])
    return { obtenerServicioDeProyectoConVista: servicio.obtenerServicioDeProyectoConVista, conocimiento: conocimiento.CONOCIMIENTO_ACTIVO, generarPrograma: codegen.generarPrograma }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Falta una carpeta de Tecnia Bot ("servidor", "conocimiento" o "codegen") junto a esta tool (no se pudo cargar: ${detalle}). ` +
        `Reinstalá Tecnia Bot (o corré "Reparar Tecnia Bot" desde el menú inicio en Windows) para arreglarlo.`,
    )
  }
}

/** Carpeta derivada del programa de un proyecto: junto a los datos del proyecto, descartable. */
export function carpetaDelPrograma(directorioActivo: string, idProyecto: string): string {
  return join(directorioDeDatos(directorioActivo), "programa", idProyecto)
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")

/** Vacía `carpeta` salvo la caché `.pio` de PlatformIO. */
function vaciar(carpeta: string): void {
  if (!existsSync(carpeta)) return
  for (const entrada of readdirSync(carpeta)) if (entrada !== ".pio") rmSync(join(carpeta, entrada), { recursive: true, force: true })
}

/** Deja en `carpeta` SÓLO los archivos generados. */
function materializar(carpeta: string, archivos: Readonly<Record<string, string>>): void {
  mkdirSync(carpeta, { recursive: true })
  vaciar(carpeta)
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(carpeta, ruta)), { recursive: true })
    writeFileSync(join(carpeta, ruta), contenido)
  }
}

/** ¿Lo que hay en disco es exactamente lo generado? (nada agregado, nada cambiado) */
function coincideConLoGenerado(carpeta: string, archivos: Readonly<Record<string, string>>): boolean {
  const enDisco = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === ".pio" && dir === carpeta ? [] : e.isDirectory() ? enDisco(join(dir, e.name)) : [relative(carpeta, join(dir, e.name)).split("\\").join("/")]))
  const presentes = enDisco(carpeta).sort()
  const esperados = Object.keys(archivos).sort()
  if (presentes.length !== esperados.length || presentes.some((p, i) => p !== esperados[i])) return false
  return esperados.every((ruta) => readFileSync(join(carpeta, ruta), "utf8") === archivos[ruta])
}

const json = (valor: unknown) => JSON.stringify(valor, null, 2)

/**
 * La ejecución de la tool. `cargar` existe para que los tests inyecten un conocimiento de prueba
 * (mismo patrón que `revisiones` en el codegen); en producción son los módulos reales.
 */
export async function ejecutarPrograma(
  args: { readonly accion: string; readonly idProyecto?: string; readonly puerto?: string },
  ctx: { readonly directory: string; readonly abort?: AbortSignal },
  cargar: () => Promise<DependenciasPrograma> = cargarDependencias,
): Promise<string> {
  try {
    if (!(ACCIONES_PROGRAMA as readonly string[]).includes(args.accion)) {
      return json({ resultado: `NO SE HIZO NADA — acción desconocida (usá una de: ${ACCIONES_PROGRAMA.join(", ")})`, ok: false, codigo: "ACCION_DESCONOCIDA" })
    }
    const accion = args.accion as AccionPrograma
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT
    if (!validarIdProyecto(idProyecto)) return json({ resultado: "NO SE HIZO NADA — idProyecto inválido", ok: false, codigo: "ID_PROYECTO_INVALIDO" })
    if (args.puerto !== undefined && !puertoValido(args.puerto)) return json({ resultado: "NO SE HIZO NADA — puerto inválido", ok: false, codigo: "PUERTO_INVALIDO" })

    let deps: DependenciasPrograma
    try {
      deps = await cargar()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE HIZO NADA — ${mensaje}`, ok: false, codigo: "DEPENDENCIAS_NO_DISPONIBLES", mensaje })
    }

    let servicio: ServicioDeProyecto
    try {
      servicio = deps.obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(ctx.directory), idProyecto })
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return json({ resultado: `NO SE HIZO NADA — no pude acceder al proyecto físico: ${mensaje}`, ok: false, codigo: "PROYECTO_BLOQUEADO", mensaje })
    }

    // ── Generación: desde la IR canónica de ESTA revisión. ──
    const snapshot: Snapshot = servicio.snapshot()
    const revision = snapshot.revision
    const carpetaAbsoluta = carpetaDelPrograma(ctx.directory, idProyecto)
    const generado = deps.generarPrograma(snapshot.proyecto, deps.conocimiento)
    if (!generado.ok) {
      vaciar(carpetaAbsoluta)
      return json({
        resultado: `NO SE GENERÓ EL PROGRAMA — ${generado.error.codigo}`,
        etapa: "generacion",
        ok: false,
        idProyecto,
        revision,
        codigo: generado.error.codigo,
        datos: generado.error.datos,
      })
    }

    const archivosGenerados: Readonly<Record<string, string>> = { ...generado.archivos }
    materializar(carpetaAbsoluta, archivosGenerados)
    const carpeta = relative(ctx.directory, carpetaAbsoluta).split("\\").join("/")
    const archivos = Object.fromEntries(Object.entries(archivosGenerados).map(([ruta, contenido]) => [ruta, { sha256: sha256(contenido), contenido }]))
    const base = { idProyecto, revision, environment: generado.environment, carpeta, advertencias: generado.advertencias }

    if (accion === "generar") {
      return json({ resultado: `PROGRAMA GENERADO — revisión ${revision} (no se compiló)`, etapa: "generacion", ok: true, ...base, archivos })
    }

    // ── Compilación / carga: exactamente lo generado. ──
    const etapa = accion === "cargar" ? "carga" : "compilacion"
    if (!coincideConLoGenerado(carpetaAbsoluta, archivosGenerados)) {
      return json({ resultado: `NO SE ${accion === "cargar" ? "CARGÓ" : "COMPILÓ"} — la carpeta derivada no coincide con lo generado`, etapa, ok: false, ...base, codigo: "MATERIALIZACION_INCONSISTENTE" })
    }

    if (accion === "cargar") {
      // El puerto: el que dijeron (ya validado) o la placa detectada por USB. Y la exclusión con el
      // Modo Vivo: un puerto con sesión viva no se toca (el mismo criterio que `platformio flash`).
      let puerto = args.puerto
      if (!puerto) {
        const detectado = await (deps.detectarPuerto ?? detectPort)(ctx.directory, ctx.abort)
        if ("error" in detectado) return json({ resultado: "NO SE CARGÓ — no encontré la placa", etapa, ok: false, ...base, codigo: "PLACA_NO_DETECTADA", explicacion: detectado.error })
        puerto = detectado.port
      }
      if (duenoDelPuerto(puerto) !== undefined) {
        return json({ resultado: `NO SE CARGÓ — ${puerto} está abierto por una sesión del Modo Vivo: cerrala con la tool \`vivo\` (accion "desconectar") y volvé a cargar`, etapa, ok: false, ...base, puerto, codigo: "PUERTO_EN_SESION_VIVA" })
      }
      const corrida = await run(["pio", "run", "-d", carpetaAbsoluta, "-e", generado.environment, "--target", "upload", "--upload-port", puerto], ctx.directory, ctx.abort, timeoutLargoMs())
      const revisionAlTerminar = servicio.snapshot().revision
      const vigente = revisionAlTerminar === revision
      const sobreRevision = { ...base, puerto, revisionActual: revisionAlTerminar, vigente }
      if (corrida.code === 0) {
        return json({
          resultado: vigente
            ? `CARGADO — revisión ${revision}, environment ${generado.environment}, en ${puerto}. La placa ya corre este programa (si tenía el runtime del Modo Vivo, quedó reemplazado: para volver al laboratorio, \`vivo\` cargar).`
            : `CARGADO — revisión ${revision} en ${puerto}, pero el proyecto cambió a la revisión ${revisionAlTerminar} mientras cargaba: la placa corre la revisión ${revision}, volvé a cargar`,
          etapa,
          ok: true,
          ...sobreRevision,
        })
      }
      const codigo = corrida.code === CODIGO_TIMEOUT ? "CARGA_TIEMPO_AGOTADO" : corrida.code === CODIGO_CANCELADO ? "CARGA_CANCELADA" : corrida.code === 127 ? "PLATFORMIO_NO_ENCONTRADO" : "CARGA_FALLIDA"
      return json({
        resultado: `NO SE CARGÓ — ${codigo}`,
        etapa,
        ok: false,
        ...sobreRevision,
        codigo,
        exitCode: corrida.code,
        explicacion: codigo === "PLATFORMIO_NO_ENCONTRADO" ? 'PlatformIO no está instalado: usá la tool `platformio` con action "reparar".' : traducirError(corrida.stderr, corrida.stdout),
        salida: recortarSalida(corrida.stderr.trim() ? corrida.stderr : corrida.stdout),
      })
    }

    const corrida = await run(["pio", "run", "-d", carpetaAbsoluta, "-e", generado.environment], ctx.directory, ctx.abort, timeoutLargoMs())
    const revisionAlTerminar = servicio.snapshot().revision
    const vigente = revisionAlTerminar === revision
    const sobreRevision = { ...base, revisionActual: revisionAlTerminar, vigente }

    if (corrida.code === 0) {
      const build = join(carpetaAbsoluta, ".pio", "build", generado.environment)
      const firmware = ["firmware.bin", "firmware.hex"].find((f) => existsSync(join(build, f)))
      return json({
        resultado: vigente
          ? `COMPILADO — revisión ${revision}, environment ${generado.environment}`
          : `COMPILADO — revisión ${revision}, pero el proyecto cambió a la revisión ${revisionAlTerminar} mientras compilaba: volvé a compilar`,
        etapa: "compilacion",
        ok: true,
        ...sobreRevision,
        firmware: firmware ? { archivo: firmware, bytes: statSync(join(build, firmware)).size } : null,
      })
    }
    const codigo =
      corrida.code === CODIGO_TIMEOUT ? "COMPILACION_TIEMPO_AGOTADO" : corrida.code === CODIGO_CANCELADO ? "COMPILACION_CANCELADA" : corrida.code === 127 ? "PLATFORMIO_NO_ENCONTRADO" : "COMPILACION_FALLIDA"
    return json({
      resultado: `NO COMPILÓ — ${codigo}`,
      etapa: "compilacion",
      ok: false,
      ...sobreRevision,
      codigo,
      exitCode: corrida.code,
      explicacion: codigo === "PLATFORMIO_NO_ENCONTRADO" ? 'PlatformIO no está instalado: usá la tool `platformio` con action "reparar".' : traducirError(corrida.stderr, corrida.stdout),
      salida: recortarSalida(corrida.stderr.trim() ? corrida.stderr : corrida.stdout),
    })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return json({ resultado: `NO SE HIZO NADA — error inesperado (${mensaje})`, ok: false, codigo: "ERROR_INESPERADO", mensaje })
  }
}

export default tool({
  description: `Genera y compila el PROGRAMA del proyecto físico actual (el de \`proyecto-fisico\`). El C++ no lo escribís vos: lo deriva el backend determinista desde el proyecto (componentes, pines y reglas), y esta tool lo entrega a PlatformIO tal cual.

Tres \`accion\`:
- \`generar\`: arma \`platformio.ini\` y \`src/main.cpp\` desde la revisión actual del proyecto y los deja en una carpeta derivada. No compila.
- \`compilar\`: vuelve a generar desde la revisión actual y compila EXACTAMENTE esos archivos con PlatformIO (environment derivado de la placa del proyecto). No carga.
- \`cargar\`: vuelve a generar, compila y CARGA el programa en la placa por USB (puerto detectado, o \`puerto\`). Sólo cuando lo pidieron explícitamente y después del checklist de seguridad. Reemplaza lo que la placa tenía, incluido el runtime del Modo Vivo (para volver al laboratorio: \`vivo\` cargar). Si el puerto está en una sesión viva devuelve \`PUERTO_EN_SESION_VIVA\`: hay que \`vivo\` desconectar primero.

Toda salida empieza con \`resultado\` y trae \`etapa\` (generacion | compilacion | carga), \`ok\` y la \`revision\` del proyecto usada. Si la generación falla, \`codigo\` es un \`CODEGEN_*\` con sus \`datos\`: explicalo, pedí la corrección del proyecto o decí que ese caso todavía no está soportado. NUNCA escribas el programa a mano como alternativa ni edites los archivos generados (se pisan en cada llamada). Después de cambiar el proyecto, volvé a generar/compilar/cargar: el programa corresponde a una revisión. Nunca digas que está en la placa si no ves \`CARGADO\`.`,
  args: {
    accion: tool.schema.enum([...ACCIONES_PROGRAMA]).describe("'generar' arma el programa desde el proyecto actual; 'compilar' lo regenera y lo compila con PlatformIO; 'cargar' lo regenera, compila y carga en la placa por USB."),
    idProyecto: tool.schema
      .string()
      .optional()
      .describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}" — el mismo de \`proyecto-fisico\` y \`vista-fisica\` en esta carpeta.`),
    puerto: tool.schema.string().optional().describe("Sólo para cargar: puerto serie de la placa (COM3, /dev/ttyUSB0). Si no se indica, se detecta la placa por USB."),
  },
  async execute(args, ctx) {
    return ejecutarPrograma(args, ctx)
  },
})
