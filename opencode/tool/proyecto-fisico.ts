// Tool "proyecto físico" — Fase 2, Slice 2 (writer W-S2-TOOL,
// PHASE_2_SLICE_2_DESIGN.md §3.1, HD-S2-1a, decisiones R-1/R-2/R-6 de §10).
//
// R-1 (TOOL SEPARADA): `vista-fisica` presenta/abre la vista en el navegador;
// ÉSTA emite operaciones existentes hacia el Project Engine, para el actor
// "agente" — misma función que el `POST /api/operaciones` del navegador
// (`servidor/servidor-proyecto.ts`), pero para el agente. Es TRANSPORTE, no
// autoridad: nunca valida hardware por su cuenta, nunca decide un motivo,
// nunca construye la IR — todo eso lo hace el MISMO Project Engine que usa el
// navegador (`servicio.aplicarTransaccion`/`servicio.proponer`/
// `servicio.snapshot()`).
//
// Acceso al servicio: SIEMPRE por `obtenerServicioDeProyectoConVista`
// (`servidor/servicio-con-vista.ts`, el ÚNICO call site de producción
// autorizado a `obtenerServicioDeProyecto` — guardia de W3), con import
// perezoso (D13, igual patrón que `vista-fisica.ts::cargarServidor`), sobre el
// MISMO directorio de datos que `vista-fisica` (`ubicacion-proyecto.ts`,
// `<ctx.directory>/.tecnia-vista-fisica/`) — así las dos tools terminan en el
// MISMO singleton y el MISMO candado de `servicio-con-vista.ts`, y cualquier
// operación de esta tool dispara el mismo evento SSE que ve un navegador ya
// abierto.
//
// Prohibido en este archivo (§3.1 del diseño): importar `nucleo/almacen.ts`,
// `crearAlmacen`, `obtenerServicioDeProyecto`, `node:fs` para escribir, o
// construir la IR a mano. Esta tool NUNCA escribe disco directo, NUNCA levanta
// un segundo motor.
import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ServicioDeProyecto, Snapshot } from "../nucleo/composicion-raiz.ts"
import type { SobreOperacion, TipoOperacion } from "../nucleo/operaciones.ts"
import type { ResultadoTransaccion } from "../nucleo/motor.ts"
import type { Proyecto } from "../nucleo/ir.ts"
import type { ModeloDeVista, MotivoVista } from "../vista-fisica/modelo-vista.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT } from "../vista-fisica/ubicacion-proyecto.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// R-6: whitelist EXACTA e inmutable — SetComportamiento (HD-S2-10: nada de
// lógica) y CambiarComponente (fuera del recorrido de este slice) quedan
// afuera a propósito, igual que cualquier tipo desconocido/mal escrito.
// ════════════════════════════════════════════════════════════════════════════════════

const OPERACIONES_PERMITIDAS: readonly TipoOperacion[] = Object.freeze(["SetPlaca", "AgregarComponente", "QuitarComponente", "AsignarPin", "Conectar", "Desconectar"])

/** Máximo de operaciones por llamada (R-6) — con más, se rechaza EXPLÍCITO, nunca se
 * trunca, aplica parcial ni se divide en varias transacciones (§3.1 del diseño). */
const MAXIMO_OPERACIONES = 20

// ════════════════════════════════════════════════════════════════════════════════════
// Import perezoso de `../servidor/*` y `../vista-fisica/vista-real.ts` — mismo
// criterio D13 que `vista-fisica.ts::cargarServidor`: el registry de tools de
// OpenCode importa cada `tool/*.ts` en un loop SIN catch por archivo. Si este
// módulo importara cualquiera de los dos como valor en el top-level y esa
// pieza faltara (instalación a medio copiar), el `import()` de ESTA tool
// rechazaría durante la carga del REGISTRO ENTERO. Con la carga acá adentro,
// el import ESTÁTICO de `tool/proyecto-fisico.ts` no toca esas piezas en
// absoluto — sólo la PRIMERA vez que el agente use la tool, y sólo ESTA tool
// se ve afectada si falta. `vista-real.ts` (peso: construye el catálogo real,
// `hash-catalogo.node.ts`) se difiere por el mismo motivo de costo que ya
// evita `vista-fisica.ts`: nunca se paga esa construcción en cada arranque de
// sesión si el agente no usa esta tool.
// ════════════════════════════════════════════════════════════════════════════════════

type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloVistaReal = typeof import("../vista-fisica/vista-real.ts")

interface DependenciasProyectoFisico {
  readonly obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  readonly explicarMotivosConCatalogoReal: ModuloVistaReal["explicarMotivosConCatalogoReal"]
}

async function cargarDependencias(): Promise<DependenciasProyectoFisico> {
  let modServicio: ModuloServicioConVista
  let modVistaReal: ModuloVistaReal
  try {
    ;[modServicio, modVistaReal] = await Promise.all([import("../servidor/servicio-con-vista.ts"), import("../vista-fisica/vista-real.ts")])
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Falta la carpeta "servidor" de Tecnia Bot (no se pudo cargar ../servidor/ junto a esta tool: ${detalle}). ` +
        `Esto pasa con una instalación incompleta o interrumpida a mitad de una actualización. Reinstalá ` +
        `Tecnia Bot (o corré "Reparar Tecnia Bot" desde el menú inicio en Windows) para arreglarlo.`,
    )
  }
  return { obtenerServicioDeProyectoConVista: modServicio.obtenerServicioDeProyectoConVista, explicarMotivosConCatalogoReal: modVistaReal.explicarMotivosConCatalogoReal }
}

/** `Snapshot` (composicion-raiz.ts) NUNCA declara `vista` en su tipo — la clave la
 * agrega `snapshot()` en runtime (con un `as Snapshot`) sólo cuando alguien inyectó
 * `calcularVista` (composicion-raiz.ts:263-264). `obtenerServicioDeProyectoConVista`
 * SIEMPRE la inyecta, así que en la práctica `vista` está siempre — este tipo local
 * sólo lo hace visible para TypeScript, nunca cambia el runtime real. */
type SnapshotConVista = Snapshot & { readonly vista?: ModeloDeVista }

// ════════════════════════════════════════════════════════════════════════════════════
// Forma cruda de un elemento de `operaciones` — DELIBERADAMENTE `unknown` en el
// schema de zod (`args` más abajo): "Validá esto en la tool aunque el schema también
// lo restrinja: el schema del LLM no es una garantía" (§3.1 del diseño). Si
// declarásemos un `z.object({tipo, payload})` de zod, zod por defecto DESCARTA
// claves extra en vez de rechazar el elemento entero — exactamente el agujero que
// T-AG-06 (claves extra: actor/idOperacion/idTransaccion/baseRevision) prueba que no
// puede pasar. Por eso la forma se valida acá, a mano, sobre el dato crudo.
// ════════════════════════════════════════════════════════════════════════════════════

type OperacionCruda = Readonly<Record<string, unknown>>

function esObjetoPlanoSimple(valor: unknown): valor is OperacionCruda {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/** Rechazo estructurado de LA TOOL (nunca del Engine) — `rechazadoPor:"tool"` distingue
 * esto de un rechazo de dominio (que trae `motivos[]` del Engine). */
interface RechazoDeLaTool {
  readonly codigo: string
  readonly [dato: string]: unknown
}

/**
 * Valida el LOTE completo ANTES de tocar el Engine (§3.1/§4, T-AG-02/06/11): tamaño,
 * forma exacta de cada elemento (SÓLO `tipo`+`payload`, ninguna clave más) y
 * pertenencia a la whitelist EXACTA de R-6. Devuelve el primer rechazo encontrado (en
 * orden), o `null` si el lote entero es válido para transporte — nunca "unas sí, otras
 * no": un solo elemento fuera de forma/whitelist rechaza el lote COMPLETO.
 */
function validarLoteParaTransporte(operacionesCrudas: readonly unknown[]): RechazoDeLaTool | null {
  if (operacionesCrudas.length > MAXIMO_OPERACIONES) {
    return { codigo: "DEMASIADAS_OPERACIONES", limite: MAXIMO_OPERACIONES, recibidas: operacionesCrudas.length }
  }
  for (const [indice, cruda] of operacionesCrudas.entries()) {
    if (!esObjetoPlanoSimple(cruda)) {
      return { codigo: "OPERACION_CON_FORMA_INVALIDA", indice, motivo: "cada elemento tiene que ser un objeto con exactamente `tipo` y `payload`" }
    }
    const claves = Object.keys(cruda).sort()
    if (claves.length !== 2 || claves[0] !== "payload" || claves[1] !== "tipo") {
      return { codigo: "OPERACION_CON_CLAVES_INVALIDAS", indice, claves, esperadas: ["payload", "tipo"] }
    }
    const tipo = cruda.tipo
    if (typeof tipo !== "string" || !OPERACIONES_PERMITIDAS.includes(tipo as TipoOperacion)) {
      // Cita textual del diseño (§3.1): "el resultado es
      // { ok:false, rechazadoPor:"tool", codigo:"OPERACION_FUERA_DE_WHITELIST", tipo }".
      return { codigo: "OPERACION_FUERA_DE_WHITELIST", tipo }
    }
  }
  return null
}

/** Arma cada `SobreOperacion` SÓLO con `tipo`+`payload` del arg — `actor` forzado
 * ("agente"), `idOperacion` generado, un `idTransaccion` COMPARTIDO para todo el lote
 * y `baseRevision` = el del arg (nunca `servicio.snapshot().revision`: completar acá
 * anularía la protección contra stale que exige `baseRevision` obligatorio, §3.1). */
function construirSobres(operacionesCrudas: readonly OperacionCruda[], baseRevision: number): readonly SobreOperacion[] {
  const idTransaccion = randomUUID()
  return operacionesCrudas.map(
    (cruda, indice): SobreOperacion => ({
      idOperacion: `${idTransaccion}-${indice}`,
      idTransaccion,
      actor: "agente",
      baseRevision,
      tipo: cruda.tipo as TipoOperacion,
      payload: cruda.payload,
    }),
  )
}

/** Proyección del motivo para el agente (§3.1): código, severidad, clasificación,
 * entidad y la explicación determinista — NUNCA `datos` crudo (el agente explica con
 * el texto de `explicacion`, no infiere causas del dato interno). */
function proyectarMotivoParaAgente(motivo: MotivoVista) {
  return { codigo: motivo.codigo, severidad: motivo.severidad, clasificacion: motivo.clasificacion ?? null, entidad: motivo.entidad ?? null, explicacion: motivo.explicacion }
}

function resumenDeLectura(idProyecto: string, snapshot: SnapshotConVista) {
  const vista = snapshot.vista
  const rolPorId = new Map((vista?.componentes ?? []).map((c) => [c.id, c.rol] as const))
  const componentes = snapshot.proyecto.componentes.map((componente) => ({
    id: componente.id,
    tipo: componente.tipo,
    rol: rolPorId.get(componente.id) ?? null,
    pines: componente.pines,
  }))
  const motivos = (vista?.motivos ?? []).map(proyectarMotivoParaAgente)
  return { accion: "leer" as const, idProyecto, revision: snapshot.revision, componentes, motivos }
}

/** El `Proyecto` contra el que se resuelven `{componente}`/`{ocupadoPor}` en las
 * explicaciones (§3.4): el de la ÚLTIMA operación evaluada del lote (incluye
 * componentes creados EN el mismo lote — ver `motor.ts::ejecutarLote`), o el
 * canónico vigente si el lote se rechazó ANTES de evaluar ninguna operación
 * (stale/forma/tamaño de transporte previos al motor). */
function proyectoParaExplicar(resultado: ResultadoTransaccion, snapshotVigente: SnapshotConVista): Proyecto {
  return resultado.resultadosOperaciones.at(-1)?.proyecto ?? snapshotVigente.proyecto
}

export default tool({
  description: `Emite operaciones EXISTENTES del Project Engine sobre el proyecto físico activo (el mismo proyecto que \`vista-fisica\` abre en el navegador), actuando como el actor "agente". Es TRANSPORTE, no autoridad: nunca valida hardware por su cuenta ni inventa un motivo — todo pasa por el MISMO Project Engine que usa el navegador, así que una operación tuya se ve en vivo si el alumno ya tiene la vista abierta.

Tres \`accion\`:
- \`leer\`: snapshot resumido — revisión, componentes (id/tipo/rol/pines) y los motivos vigentes con su explicación en texto llano.
- \`simular\`: dry-run — nunca persiste, nunca sube la revisión, sólo anticipa qué pasaría.
- \`aplicar\`: commitea de verdad, todo o nada (una transacción atómica: o entran TODAS las operaciones del lote, o ninguna).

\`simular\`/\`aplicar\` necesitan:
- \`baseRevision\`: la revisión que leíste con \`leer\` justo antes — si alguien más (el alumno desde el navegador, u otra llamada tuya) ya cambió el proyecto, la operación se rechaza con un motivo claro en vez de pisar ese cambio. Nunca inventes este número ni lo copies de una llamada vieja: si no lo tenés a mano, llamá \`leer\` primero.
- \`operaciones\`: de 1 a ${MAXIMO_OPERACIONES} operaciones \`{tipo, payload}\`. Sólo se aceptan estos 6 tipos: ${OPERACIONES_PERMITIDAS.join(", ")}. Cualquier otro tipo (incluida cualquier forma de "comportamiento" o lógica condicional) se rechaza SIN tocar el proyecto — este slice no modela pulsador→LED ni ninguna otra regla, sólo arma piezas y cablea pines.

Si otra sesión ya tiene este proyecto abierto, la tool te lo va a decir en vez de pisarlo.`,
  args: {
    accion: tool.schema.enum(["leer", "simular", "aplicar"]).describe("'leer' para ver el estado actual; 'simular' para un dry-run (no persiste); 'aplicar' para commitear de verdad."),
    baseRevision: tool.schema
      .number()
      .optional()
      .describe("Obligatorio para 'simular'/'aplicar': la revisión que leíste con 'leer' justo antes. Nunca la inventes ni la completes vos — si no la tenés, llamá 'leer' primero."),
    operaciones: tool.schema
      .array(tool.schema.unknown())
      .optional()
      .describe(
        `Obligatorio para 'simular'/'aplicar': lista de 1 a ${MAXIMO_OPERACIONES} objetos { tipo, payload } (EXACTAMENTE esas dos claves cada uno). 'tipo' tiene que ser uno de: ${OPERACIONES_PERMITIDAS.join(", ")}. 'payload' son los datos propios de esa operación (los mismos que ya usa el proyecto físico).`,
      ),
    idProyecto: tool.schema
      .string()
      .optional()
      .describe(`Id del proyecto físico. Por defecto "${ID_PROYECTO_DEFAULT}" — el mismo proyecto que abre \`vista-fisica\` en esta carpeta de trabajo.`),
  },
  async execute(args, ctx) {
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT
    const directorioDatos = directorioDeDatos(ctx.directory)

    let deps: DependenciasProyectoFisico
    try {
      deps = await cargarDependencias()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }

    let servicio: ServicioDeProyecto
    try {
      servicio = deps.obtenerServicioDeProyectoConVista({ directorio: directorioDatos, idProyecto })
    } catch (error) {
      // Candado (H5, mismo criterio que vista-fisica.ts): otro proceso ya tiene este
      // proyecto abierto — mensaje claro, nunca una excepción cruda ni una escritura.
      const mensaje = error instanceof Error ? error.message : String(error)
      return `No pude acceder al proyecto físico: ${mensaje}`
    }

    if (args.accion === "leer") {
      const snapshot = servicio.snapshot() as SnapshotConVista
      return JSON.stringify(resumenDeLectura(idProyecto, snapshot), null, 2)
    }

    // ── 'simular' / 'aplicar': baseRevision y operaciones son obligatorios. ────────
    if (args.baseRevision === undefined) {
      const snapshotActual = servicio.snapshot() as SnapshotConVista
      return JSON.stringify(
        { accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "BASE_REVISION_FALTANTE", baseRevision: null, revisionActual: snapshotActual.revision },
        null,
        2,
      )
    }
    const baseRevision = args.baseRevision
    const operacionesCrudas = args.operaciones
    if (!operacionesCrudas || operacionesCrudas.length === 0) {
      const snapshotActual = servicio.snapshot() as SnapshotConVista
      return JSON.stringify(
        { accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "OPERACIONES_FALTANTES", baseRevision, revisionActual: snapshotActual.revision },
        null,
        2,
      )
    }

    // ── Whitelist, forma exacta y tamaño — TODO en la tool, ANTES del Engine
    // (§3.1/§4: "sin invocar el Engine" para un lote rechazado en transporte). ─────
    const rechazoDeTransporte = validarLoteParaTransporte(operacionesCrudas)
    if (rechazoDeTransporte) {
      const snapshotActual = servicio.snapshot() as SnapshotConVista
      return JSON.stringify(
        { accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", ...rechazoDeTransporte, baseRevision, revisionActual: snapshotActual.revision },
        null,
        2,
      )
    }

    const sobres = construirSobres(operacionesCrudas as readonly OperacionCruda[], baseRevision)
    const resultado: ResultadoTransaccion = args.accion === "aplicar" ? servicio.aplicarTransaccion(sobres) : servicio.proponer(sobres)

    const snapshotVigente = servicio.snapshot() as SnapshotConVista
    const proyectoParaNombres = proyectoParaExplicar(resultado, snapshotVigente)
    const motivos = deps.explicarMotivosConCatalogoReal(resultado.motivos, proyectoParaNombres).map(proyectarMotivoParaAgente)

    return JSON.stringify(
      { accion: args.accion, idProyecto, ok: resultado.ok, baseRevision: resultado.baseRevision, revisionActual: resultado.revisionActual, motivos },
      null,
      2,
    )
  },
})
