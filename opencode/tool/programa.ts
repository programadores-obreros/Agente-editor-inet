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
// No recibe código, comandos, rutas ni flags del agente: sólo la acción y, opcional, el id del
// proyecto (validado). El environment sale del proyecto vía el codegen. `compilar` regenera
// SIEMPRE antes de compilar y compila exactamente esos bytes (los relee y compara), así nadie
// puede editar el C++ entre la generación y PlatformIO. La carpeta derivada nunca es fuente
// de verdad: se borra y se vuelve a escribir en cada llamada (y se vacía si la generación falla,
// para que no quede un programa viejo que parezca el actual).
//
// Si el codegen no soporta el proyecto devuelve su error `CODEGEN_*` tal cual: no hay plan B.

import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { ServicioDeProyecto, Snapshot } from "../nucleo/composicion-raiz.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
import { CODIGO_CANCELADO, CODIGO_TIMEOUT, recortarSalida, run, timeoutLargoMs, traducirError } from "./platformio.ts"

// Import perezoso (criterio D13, igual que `proyecto-fisico.ts`): si falta una carpeta de la
// instalación, sólo esta tool se entera, y recién cuando se usa.
type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloConocimientoActivo = typeof import("../conocimiento/conocimiento-activo.ts")
type ModuloCodegen = typeof import("../codegen/programa.ts")

export interface DependenciasPrograma {
  readonly obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  readonly conocimiento: ModuloConocimientoActivo["CONOCIMIENTO_ACTIVO"]
  readonly generarPrograma: ModuloCodegen["generarPrograma"]
}

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
  args: { readonly accion: string; readonly idProyecto?: string },
  ctx: { readonly directory: string; readonly abort?: AbortSignal },
  cargar: () => Promise<DependenciasPrograma> = cargarDependencias,
): Promise<string> {
  try {
    if (args.accion !== "generar" && args.accion !== "compilar") {
      return json({ resultado: "NO SE HIZO NADA — acción desconocida (usá 'generar' o 'compilar')", ok: false, codigo: "ACCION_DESCONOCIDA" })
    }
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT
    if (!validarIdProyecto(idProyecto)) return json({ resultado: "NO SE HIZO NADA — idProyecto inválido", ok: false, codigo: "ID_PROYECTO_INVALIDO" })

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

    if (args.accion === "generar") {
      return json({ resultado: `PROGRAMA GENERADO — revisión ${revision} (no se compiló)`, etapa: "generacion", ok: true, ...base, archivos })
    }

    // ── Compilación: exactamente lo generado. ──
    if (!coincideConLoGenerado(carpetaAbsoluta, archivosGenerados)) {
      return json({ resultado: "NO SE COMPILÓ — la carpeta derivada no coincide con lo generado", etapa: "compilacion", ok: false, ...base, codigo: "MATERIALIZACION_INCONSISTENTE" })
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

Dos \`accion\`:
- \`generar\`: arma \`platformio.ini\` y \`src/main.cpp\` desde la revisión actual del proyecto y los deja en una carpeta derivada. No compila.
- \`compilar\`: vuelve a generar desde la revisión actual y compila EXACTAMENTE esos archivos con PlatformIO (environment derivado de la placa del proyecto).

Toda salida empieza con \`resultado\` y trae \`etapa\` (generacion | compilacion), \`ok\` y la \`revision\` del proyecto usada. Si la generación falla, \`codigo\` es un \`CODEGEN_*\` con sus \`datos\`: explicalo, pedí la corrección del proyecto o decí que ese caso todavía no está soportado. NUNCA escribas el programa a mano como alternativa ni edites los archivos generados (se pisan en cada llamada). Después de cambiar el proyecto, volvé a generar/compilar: el programa corresponde a una revisión.`,
  args: {
    accion: tool.schema.enum(["generar", "compilar"]).describe("'generar' arma el programa desde el proyecto actual; 'compilar' lo regenera y lo compila con PlatformIO."),
    idProyecto: tool.schema
      .string()
      .optional()
      .describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}" — el mismo de \`proyecto-fisico\` y \`vista-fisica\` en esta carpeta.`),
  },
  async execute(args, ctx) {
    return ejecutarPrograma(args, ctx)
  },
})
