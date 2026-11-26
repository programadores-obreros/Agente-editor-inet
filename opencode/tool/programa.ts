// Tool "programa" — Codegen MVP, Slice 1b.
//
// Para un proyecto físico (el del Project Engine), el programa de la placa NO lo escribe el
// modelo: se GENERA desde la IR con el backend determinista (`codegen/programa.ts`). Esta tool
// sólo orquesta, sobre el proyecto ACTUAL:
//
//   IR (el mismo servicio y candado que `proyecto-fisico`) → generarPrograma → archivos
//   derivados en una carpeta descartable → (compilar) el runner de PlatformIO existente.
//
// EL CÓDIGO NO LE LLEGA AL MODELO (2026-11-26). Antes `generar` devolvía el texto del programa y
// las dos acciones devolvían la carpeta donde quedaba. En la notebook real el asistente leyó ese
// archivo y lo REESCRIBIÓ en el chat con una regla menos, diciendo que era el generado; la regla
// «mostralo tal cual» ya estaba en sus instrucciones. Ahora:
//   - la salida no trae el C++ ni ninguna ruta: trae las reglas en palabras, cuántas líneas son y
//     dónde se ve (la sección «Código» de la ventana, que lo pinta el servidor);
//   - la carpeta derivada vive FUERA de la carpeta de trabajo, en una carpeta del usuario. Medido
//     en OpenCode 1.18.18: con los permisos del agente (`"*": "deny"`), `read`, `grep` y `glob`
//     quedan bloqueados fuera de la carpeta de trabajo; adentro, `read` y `grep` devuelven el
//     archivo aunque se le niegue `read` por patrón.
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
//
// `cargar` (H1 del MVP): graba en la placa el programa del proyecto. Abre el proyecto y genera
// por el mismo camino que `generar`/`compilar`, pero NO usa la carpeta derivada ni nada que ya
// estuviera en disco: lo generado va a una carpeta privada nueva, fuera del proyecto, y desde
// ahí se compila y graba en un solo paso. Todo lo que toca la placa (agente, aprobación
// automática, pines, placa, candado, cartel, revalidación, lanzamiento, veredicto y registro)
// vive en `carga/cargar-programa.ts`; acá sólo se le pasan las piezas de `platformio.ts`.

import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { baseDeCargas, cargarProgramaGenerado, porQueNoSePuedeCargar, type ContextoDeCarga, type HerramientasDeCarga, type OpcionesDeCarga, type ResultadoDeCarga } from "../carga/cargar-programa.ts"
import type { ServicioDeProyecto, Snapshot } from "../nucleo/composicion-raiz.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
import {
  agenteQueNoPuedeCargar,
  analizarProyecto,
  bloqueoAntesDeCargar,
  CODIGO_CANCELADO,
  CODIGO_TIMEOUT,
  MARCA_SIEMPRE_PREGUNTA,
  PREGUNTA_CHECKLIST,
  preguntarChecklist,
  recortarSalida,
  run,
  timeoutLargoMs,
  traducirError,
} from "./platformio.ts"

// Import perezoso (criterio D13, igual que `proyecto-fisico.ts`): si falta una carpeta de la
// instalación, sólo esta tool se entera, y recién cuando se usa.
/** `Snapshot` no declara `vista` en su tipo; el servicio con vista la trae. De ahí sólo se usan las frases. */
type SnapshotConReglas = Snapshot & { readonly vista?: { readonly reglas?: readonly { readonly texto?: string | null }[] } }

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

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")

/**
 * Carpeta derivada del programa de un proyecto. Descartable: se pisa en cada llamada.
 *
 * Vive FUERA de la carpeta de trabajo, en la misma base del usuario que usa `cargar` para sus
 * carpetas privadas (`~/.cache/tecnia-bot` o `%LOCALAPPDATA%\TecniaBot`), en `programas/<clave>/<id>`.
 * La clave sale de la carpeta de trabajo: dos proyectos en carpetas distintas no se pisan, y el
 * mismo proyecto vuelve siempre a la misma carpeta (así PlatformIO reusa su caché `.pio`).
 *
 * Por qué afuera: es lo único que impide que el asistente lea el programa y lo reescriba en el
 * chat (ver el encabezado). Si alguien abre Tecnia Bot en su carpeta personal, esta carpeta queda
 * ADENTRO de la carpeta de trabajo y esa barrera no vale: `programaALaVistaDelAgente` lo detecta
 * y la salida lo dice, en vez de darlo por protegido.
 */
export function carpetaDelPrograma(directorioActivo: string, idProyecto: string, entorno: NodeJS.ProcessEnv = process.env): string {
  const { base, tramos } = baseDeCargas(entorno)
  const propia = resolve(directorioActivo)
  // En Windows las rutas no distinguen mayúsculas: la misma carpeta escrita distinto es la misma clave.
  const clave = sha256(sep === "\\" ? propia.toLowerCase() : propia).slice(0, 16)
  return join(base, tramos[0]!, "programas", clave, idProyecto)
}

/** Donde estaba la carpeta derivada antes del 2026-11-26: dentro de la carpeta de trabajo. */
export function carpetaViejaDelPrograma(directorioActivo: string, idProyecto: string): string {
  return join(directorioDeDatos(directorioActivo), "programa", idProyecto)
}

/** ¿La carpeta derivada cae dentro de la carpeta de trabajo (y entonces el agente la puede leer)? */
export function programaALaVistaDelAgente(directorioActivo: string, carpeta: string): boolean {
  const rel = relative(resolve(directorioActivo), resolve(carpeta))
  return rel === "" || (!rel.startsWith("..") && !/^([A-Za-z]:)?[\\/]/.test(rel))
}

/** Dónde se ve el programa. Es lo ÚNICO que la tool dice sobre el código. */
export const DONDE_VERLO = "El código completo está en la ventana de la vista física, en la sección «Código» (abrila con la tool `vista-fisica`). No lo escribas ni lo resumas en el chat."

const cuantas = (n: number, uno: string, varias: string) => (n === 1 ? `1 ${uno}` : `${n} ${varias}`)
const lineasDe = (texto: string) => (texto === "" ? 0 : texto.replace(/\n$/, "").split("\n").length)

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
 * Las piezas de `platformio.ts` (y el `run` real) que usa `cargar`. Son las MISMAS funciones que
 * usan `flash`/`both`: el chequeo del agente, el análisis de pines, el bloqueo y el cartel.
 */
export const HERRAMIENTAS_DE_CARGA: HerramientasDeCarga = {
  run,
  preguntaChecklist: PREGUNTA_CHECKLIST,
  marcaSiemprePregunta: MARCA_SIEMPRE_PREGUNTA,
  agenteQueNoPuedeCargar,
  analizarProyecto,
  bloqueoAntesDeCargar,
  preguntarChecklist,
}

/** El resultado de `cargar` en la forma de la tool: siempre empieza con `resultado` y trae `etapa`. */
const comoCarga = (r: ResultadoDeCarga, base: Record<string, unknown> = {}) => {
  const { resultado, ok, codigo, ...resto } = r
  return json({ resultado, etapa: "carga", ok, codigo, ...base, ...resto })
}

/**
 * La ejecución de la tool. `cargar` existe para que los tests inyecten un conocimiento de prueba
 * (mismo patrón que `revisiones` en el codegen); en producción son los módulos reales.
 * `herramientas` y `opciones` son para los tests de la acción `cargar` (el lanzador espía, el
 * cartel, el entorno): en producción, las de `platformio.ts` y el `run` real.
 */
export async function ejecutarPrograma(
  args: { readonly accion: string; readonly idProyecto?: string },
  ctx: ContextoDeCarga,
  cargar: () => Promise<DependenciasPrograma> = cargarDependencias,
  herramientas: HerramientasDeCarga = HERRAMIENTAS_DE_CARGA,
  opciones: OpcionesDeCarga = {},
): Promise<string> {
  try {
    if (args.accion !== "generar" && args.accion !== "compilar" && args.accion !== "cargar") {
      return json({ resultado: "NO SE HIZO NADA — acción desconocida (usá 'generar', 'compilar' o 'cargar')", ok: false, codigo: "ACCION_DESCONOCIDA" })
    }
    // `cargar`, pasos 1 y 2 (agente y aprobación automática): antes de abrir nada.
    if (args.accion === "cargar") {
      const noSePuede = porQueNoSePuedeCargar(ctx, herramientas)
      if (noSePuede) return comoCarga(noSePuede)
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
    const carpetaAbsoluta = carpetaDelPrograma(ctx.directory, idProyecto, opciones.entorno)
    // El programa que una versión anterior dejó DENTRO de la carpeta de trabajo se borra: si
    // quedara, el asistente podría leer ese (viejo) creyendo que es el actual. `cargar` no lo toca.
    if (args.accion !== "cargar") rmSync(carpetaViejaDelPrograma(ctx.directory, idProyecto), { recursive: true, force: true })
    if (args.accion === "cargar") {
      // Paso 3: con un motivo bloqueante no se graba (el generador también lo rechazaría; esto no depende de él).
      const bloqueantes = snapshot.validacion.motivos.filter((m) => m.severidad === "blocking")
      if (bloqueantes.length > 0) {
        return comoCarga(
          { resultado: "NO SE CARGÓ — el proyecto tiene motivos bloqueantes: corregilos con `proyecto-fisico` antes de cargar.", ok: false, codigo: "PROYECTO_CON_MOTIVOS_BLOQUEANTES", motivos: bloqueantes },
          { idProyecto, revision },
        )
      }
    }
    const generado = deps.generarPrograma(snapshot.proyecto, deps.conocimiento)
    if (!generado.ok) {
      // `cargar` no toca la carpeta derivada: ni la lee ni la vacía.
      if (args.accion === "cargar") {
        return json({ resultado: `NO SE CARGÓ — no se pudo generar el programa (${generado.error.codigo})`, etapa: "generacion", ok: false, idProyecto, revision, codigo: generado.error.codigo, datos: generado.error.datos })
      }
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

    // ── Carga: desde una carpeta privada nueva, nunca desde la derivada. ──
    if (args.accion === "cargar") {
      const r = await cargarProgramaGenerado({ idProyecto, revision, environment: generado.environment, archivos: archivosGenerados, revisionActual: () => servicio.snapshot().revision }, ctx, herramientas, opciones)
      return comoCarga(r, { idProyecto, revision, environment: generado.environment })
    }

    materializar(carpetaAbsoluta, archivosGenerados)
    // Lo que se le cuenta al modelo: de cada archivo, su huella y su tamaño; del programa, sus
    // reglas EN PALABRAS (las mismas frases que muestra la ventana) y dónde se ve. Nunca el texto
    // del programa ni la ruta de la carpeta.
    const archivos = Object.fromEntries(Object.entries(archivosGenerados).map(([ruta, contenido]) => [ruta, { sha256: sha256(contenido), lineas: lineasDe(contenido) }]))
    // Un proyecto que se pudo generar tiene todas sus reglas completas, así que todas traen su
    // frase (había acá un reemplazo para "regla incompleta": por mutación se vio que no se puede
    // alcanzar, y se sacó).
    const reglas = ((snapshot as SnapshotConReglas).vista?.reglas ?? []).map((r) => r.texto)
    const lineas = lineasDe(archivosGenerados["src/main.cpp"] ?? "")
    const programa = {
      reglas,
      lineas,
      resumen: `El programa de la revisión ${revision} tiene ${cuantas(reglas.length, "regla", "reglas")} y ${cuantas(lineas, "línea", "líneas")}.`,
      dondeVerlo: DONDE_VERLO,
      // Sólo si la barrera no vale (Tecnia Bot abierto en la carpeta personal): se dice, no se calla.
      ...(programaALaVistaDelAgente(ctx.directory, carpetaAbsoluta) ? { aviso: "La carpeta del programa quedó dentro de la carpeta de trabajo. No la leas: el código se mira en la ventana." } : {}),
    }
    const base = { idProyecto, revision, environment: generado.environment, advertencias: generado.advertencias, programa }

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
  description: `Genera, compila y carga el PROGRAMA del proyecto físico actual (el de \`proyecto-fisico\`). El C++ no lo escribís vos: lo deriva el backend determinista desde el proyecto (componentes, pines y reglas), y esta tool lo entrega a PlatformIO tal cual.

Tres \`accion\`:
- \`generar\`: arma \`platformio.ini\` y \`src/main.cpp\` desde la revisión actual del proyecto. No compila.
- \`compilar\`: vuelve a generar desde la revisión actual y compila EXACTAMENTE esos archivos con PlatformIO (environment derivado de la placa del proyecto).
- \`cargar\`: vuelve a generar desde la revisión actual y lo compila y graba en la placa conectada, en un solo paso. Sólo con el agente Tecnia Bot. Frena si un pin deja la placa sin arrancar. Muestra SIEMPRE un cartel de OpenCode que contesta el docente (botones en inglés: Allow once si ya revisó el circuito, Reject si todavía no): antes de llamarla, repasá con él el checklist de seguridad y avisale del cartel. Si contesta Reject, no reintentes hasta que te lo pida. Sólo decí que quedó cargado si \`resultado\` empieza con \`CARGADO\`; \`CARGA_SIN_VERIFICAR\` NO es "cargado".

EL CÓDIGO NO VIENE EN LA SALIDA y no lo mostrás vos: \`programa.reglas\` trae las reglas en palabras, \`programa.resumen\` cuántas son y cuántas líneas tiene, y \`programa.dondeVerlo\` dónde se ve (la sección «Código» de la ventana de \`vista-fisica\`). Cuando pidan ver el código: contá eso y abrí la ventana. Nunca escribas, copies ni resumas código del programa en el chat.

Toda salida empieza con \`resultado\` y trae \`etapa\` (generacion | compilacion | carga), \`ok\` y la \`revision\` del proyecto usada. Si la generación falla, \`codigo\` es un \`CODEGEN_*\` con sus \`datos\`: explicalo, pedí la corrección del proyecto o decí que ese caso todavía no está soportado. NUNCA escribas el programa a mano como alternativa ni edites los archivos generados (se pisan en cada llamada). Después de cambiar el proyecto, volvé a generar/compilar: el programa corresponde a una revisión.`,
  args: {
    accion: tool.schema
      .enum(["generar", "compilar", "cargar"])
      .describe("'generar' arma el programa desde el proyecto actual; 'compilar' lo regenera y lo compila con PlatformIO; 'cargar' lo regenera, lo compila y lo graba en la placa (con el cartel del checklist)."),
    idProyecto: tool.schema
      .string()
      .optional()
      .describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}" — el mismo de \`proyecto-fisico\` y \`vista-fisica\` en esta carpeta.`),
  },
  async execute(args, ctx) {
    return ejecutarPrograma(args, ctx)
  },
})
