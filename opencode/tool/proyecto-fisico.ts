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
import type { Componente, Proyecto } from "../nucleo/ir.ts"
import type { Catalogo } from "../nucleo/catalogo.ts"
import type { ModeloDeVista, MotivoVista } from "../vista-fisica/modelo-vista.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
// Phase 3, Wave 0 (W-W0-TOOL, F-07/F-13, PHASE_3_WAVE_0_DESIGN.md): `vocabulario.ts` es
// PURO — sólo `import type` hacia `nucleo/*` (se borran en runtime), CERO imports de
// valor. Por eso se importa ESTÁTICO acá (a diferencia de `../servidor/*` y
// `../vista-fisica/vista-real.ts`, más abajo): no puede romper el loop de carga del
// registry de tools si `servidor/` faltara, porque no toca ese árbol en absoluto.
import { descripcionPinesDeComponente, valoresValidosParaMotivos, vocabularioDesdeCatalogo } from "../vista-fisica/vocabulario.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// R-6 (reabierto, Phase 3 — DECISIONS 2531e09, contrato B7): whitelist CERRADA de
// EXACTAMENTE 8 tipos: los 6 de siempre más `SetComportamiento` y
// `QuitarComportamiento`. Las reglas (comportamientos) pasan por el MISMO Project
// Engine que todo lo demás: la tool sólo las transporta. `CambiarComponente` sigue
// afuera, igual que cualquier tipo desconocido o mal escrito.
// ════════════════════════════════════════════════════════════════════════════════════

const OPERACIONES_PERMITIDAS: readonly TipoOperacion[] = Object.freeze(["SetPlaca", "AgregarComponente", "QuitarComponente", "AsignarPin", "Conectar", "Desconectar", "SetComportamiento", "QuitarComportamiento"])

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
  /** Phase 3, Wave 0 (F-07/F-13): el MISMO catálogo real que ya usa
   * `explicarMotivosConCatalogoReal` — para derivar `vocabulario`, `valoresValidos` y
   * `descripcionPines`, sin construir una segunda instancia. */
  readonly catalogoReal: ModuloVistaReal["catalogoReal"]
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
  return {
    obtenerServicioDeProyectoConVista: modServicio.obtenerServicioDeProyectoConVista,
    explicarMotivosConCatalogoReal: modVistaReal.explicarMotivosConCatalogoReal,
    catalogoReal: modVistaReal.catalogoReal,
  }
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
  // Fix M-01 (MINOR, red team Phase 2 Slice 2, RED-S2-TOOL/INFORME.md): un `operaciones`
  // con el prototipo alterado (`Object.setPrototypeOf(arr, {length:999})`) sigue siendo
  // un Array de verdad para `Array.isArray` (el internal slot de array no cambia con el
  // prototipo) — pero pierde CUALQUIER método heredado de `Array.prototype`
  // (`.entries()`, `.map()`, `Symbol.iterator`), así que iterarlo con esos métodos
  // rompía con un `TypeError` crudo, sin capturar. `Array.isArray` primero rechaza
  // cualquier cosa que NO sea un array de verdad (un objeto array-like disfrazado, p.
  // ej. `{0:..., length:1}`, nunca se trata como lote). Después, el recorrido es por
  // ÍNDICE, con acceso `[]` PLANO (siempre propio del array, nunca heredado del
  // prototipo) sobre un largo YA ACOTADO a `MAXIMO_OPERACIONES` — nunca confía en
  // `.entries()`/`.map()`/`for...of`/`Symbol.iterator` del objeto de entrada.
  if (!Array.isArray(operacionesCrudas)) {
    return { codigo: "OPERACION_CON_FORMA_INVALIDA", motivo: "operaciones tiene que ser un array" }
  }
  if (operacionesCrudas.length > MAXIMO_OPERACIONES) {
    return { codigo: "DEMASIADAS_OPERACIONES", limite: MAXIMO_OPERACIONES, recibidas: operacionesCrudas.length }
  }
  const largoAcotado = Math.min(operacionesCrudas.length, MAXIMO_OPERACIONES)
  for (let indice = 0; indice < largoAcotado; indice++) {
    const cruda = operacionesCrudas[indice]
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

/**
 * F-13 (PHASE_3_WAVE_0_DESIGN.md): `nombre` (nombreVisible del catálogo) y
 * `descripcionPines` (texto llano, `vocabulario.ts::descripcionPinesDeComponente`) por
 * componente — derivados del IR + el catálogo REAL, nunca de una tabla hardcodeada.
 * `catalogo.obtenerComponente(componente.tipo)` puede dar `undefined` si el catálogo
 * cambió desde que se creó el componente (gap heredado, documentado): el fallback usa
 * el `tipo` crudo como nombre, nunca explota.
 */
function resumenDeComponente(componente: Componente, catalogo: Catalogo) {
  const catalogoComponente = catalogo.obtenerComponente(componente.tipo)
  return {
    id: componente.id,
    tipo: componente.tipo,
    nombre: catalogoComponente?.nombreVisible ?? componente.tipo,
    pines: componente.pines,
    descripcionPines: descripcionPinesDeComponente(componente, catalogo),
  }
}

function resumenDeLectura(idProyecto: string, snapshot: SnapshotConVista, catalogo: Catalogo) {
  const vista = snapshot.vista
  const rolPorId = new Map((vista?.componentes ?? []).map((c) => [c.id, c.rol] as const))
  const componentes = snapshot.proyecto.componentes.map((componente) => ({
    ...resumenDeComponente(componente, catalogo),
    rol: rolPorId.get(componente.id) ?? null,
  }))
  const motivos = (vista?.motivos ?? []).map(proyectarMotivoParaAgente)
  // Phase 3: las reglas salen de la MISMA proyección del servidor que usa la vista
  // (`ModeloDeVista.reglas`) — ningún segundo cálculo acá.
  const reglas = (vista?.reglas ?? []).map((r) => ({ id: r.id, texto: r.texto, completa: r.completa, faltan: r.faltan, frase: r.frase }))
  return { accion: "leer" as const, idProyecto, revision: snapshot.revision, componentes, reglas, motivos }
}

/**
 * F-06 (PHASE_3_WAVE_0_DESIGN.md): línea `resultado` inequívoca, SIEMPRE al frente de
 * la salida de `simular`/`aplicar` (ya resuelto el lote contra el Engine) — distingue,
 * sin ambigüedad, qué pasó de verdad: un dry-run nunca afirma haber cambiado algo, un
 * commit real SIEMPRE nombra la revisión antes→después, y un rechazo nunca se confunde
 * con un éxito. `stale` (BASE_REVISION_DESACTUALIZADA) tiene su propio texto fijo,
 * citado literal por el diseño ("el proyecto cambió; volvé a leer") — el resto de los
 * rechazos del Engine usan el motivo principal (ya traducido a texto llano por
 * `explicarMotivosConCatalogoReal`, o el código crudo si no hay explicación tabulada).
 */
function lineaDeResultado(accion: "simular" | "aplicar", ok: boolean, opts: { readonly baseRevision: number; readonly revisionActual: number; readonly stale: boolean; readonly motivoPrincipal?: string | null }): string {
  if (accion === "simular") {
    return ok ? "SIMULACIÓN — no se aplicó nada (resultado hipotético: ok)" : "SIMULACIÓN — no se aplicó nada (resultado hipotético: rechazo)"
  }
  if (ok) return `APLICADO — revisión ${opts.baseRevision}→${opts.revisionActual}`
  if (opts.stale) return "NO SE APLICÓ NADA — el proyecto cambió; volvé a leer"
  return `NO SE APLICÓ NADA — ${opts.motivoPrincipal ?? "rechazado por el Project Engine"}`
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

Para no adivinar ids: llamá \`leer\` primero: trae el vocabulario válido (placas, componentes, terminales, ejemplos).

Tres \`accion\`:
- \`leer\`: snapshot resumido — revisión, componentes (id/tipo/nombre/rol/pines/descripcionPines) y los motivos vigentes con su explicación en texto llano, MÁS \`vocabulario\` (placas/componentes/terminales/operaciones de ejemplo, derivados del catálogo real).
- \`simular\`: dry-run — nunca persiste, nunca sube la revisión, sólo anticipa qué pasaría.
- \`aplicar\`: commitea de verdad, todo o nada (una transacción atómica: o entran TODAS las operaciones del lote, o ninguna).

Toda salida empieza con un campo \`resultado\` (texto llano inequívoco): "SÓLO LECTURA" para \`leer\`, "SIMULACIÓN" para un \`simular\` resuelto, "APLICADO — revisión X→Y" para un \`aplicar\` que entró, o "NO SE APLICÓ NADA — <motivo>" para cualquier rechazo (de transporte, del Engine, o stale). Nunca afirmes una acción que no veas confirmada en esa línea.

\`simular\`/\`aplicar\` necesitan:
- \`baseRevision\`: la revisión que leíste con \`leer\` justo antes — si alguien más (el alumno desde el navegador, u otra llamada tuya) ya cambió el proyecto, la operación se rechaza con un motivo claro en vez de pisar ese cambio. Nunca inventes este número ni lo copies de una llamada vieja: si no lo tenés a mano, llamá \`leer\` primero.
- \`operaciones\`: de 1 a ${MAXIMO_OPERACIONES} operaciones \`{tipo, payload}\`. Sólo se aceptan estos 8 tipos (lista cerrada): ${OPERACIONES_PERMITIDAS.join(", ")}. Cualquier otro tipo (incluido CambiarComponente) se rechaza SIN tocar el proyecto. Las reglas ("mientras la entrada esté presionada, la salida está encendida") se crean con SetComportamiento y se quitan con QuitarComportamiento (por id, el que devuelve \`leer\`): pasan por el mismo Project Engine, que decide si entran. \`vocabulario.operaciones\` trae el payload EXACTO de ejemplo. Una regla de NIVEL describe un estado mientras la condición es verdadera; no es un evento ni una memoria ("cuando lo aprieto una vez", "que quede prendido" no se pueden expresar así).

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
    // Fix M-01 (MINOR, red team Phase 2 Slice 2, RED-S2-TOOL/INFORME.md): ningún error
    // inesperado puede escapar de `execute()` como excepción cruda — nunca un catch
    // vacío, nunca un "éxito" simulado: se devuelve un rechazo ESTRUCTURADO con el
    // mensaje real, mismo invariante que ya sostiene el resto del núcleo ("nunca una
    // excepción cruda, siempre un rechazo estructurado"). Los try/catch puntuales de
    // más abajo (carga de dependencias, candado) ya devuelven ANTES de llegar acá; este
    // catch envolvente es la red de seguridad para cualquier otra cosa inesperada.
    try {
      // Fix N-01 (NOTE, defensa en profundidad, mismo informe): el schema zod del
      // harness YA restringe `accion` a `leer`/`simular`/`aplicar` — este chequeo es
      // para quien invoque `execute()` directo (bypaseando zod, mismo criterio que
      // motiva la whitelist de `tipo`/R-6 más abajo): un valor desconocido se rechaza
      // EXPLÍCITO, nunca cae en el dry-run por el default implícito del ternario de
      // más abajo (`args.accion === "aplicar" ? ... : ...`).
      if (args.accion !== "leer" && args.accion !== "simular" && args.accion !== "aplicar") {
        return JSON.stringify(
          { resultado: "NO SE APLICÓ NADA — acción desconocida (usá 'leer', 'simular' o 'aplicar')", accion: args.accion, idProyecto: args.idProyecto ?? null, ok: false, rechazadoPor: "tool", codigo: "ACCION_DESCONOCIDA" },
          null,
          2,
        )
      }

      const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT

      // Fix C-01 (CRITICAL, mismo informe): `idProyecto` viajaba SIN VALIDAR hasta
      // `nucleo/almacen.ts`/`servidor/servicio-con-vista.ts` (capas PROTEGIDAS, §6), que
      // arman la ruta final con `join(directorio, \`${id}.json\`)` sin chequear
      // separadores de ruta ni "..". Un id como "../../../fuga" escribe fuera de
      // `.tecnia-vista-fisica` y hasta fuera de `ctx.directory` (reproducido,
      // confirmado). Se rechaza ACÁ, en el borde, ANTES de `directorioDeDatos`/
      // `obtenerServicioDeProyectoConVista`: nunca toca disco, nunca toma el candado.
      if (!validarIdProyecto(idProyecto)) {
        return JSON.stringify({ resultado: "NO SE APLICÓ NADA — idProyecto inválido", accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "ID_PROYECTO_INVALIDO" }, null, 2)
      }

      const directorioDatos = directorioDeDatos(ctx.directory)

      let deps: DependenciasProyectoFisico
      try {
        deps = await cargarDependencias()
      } catch (error) {
        // FX-5 (F-TRUTH-3, MAJOR, ronda de fixes): el diseño y el prompt afirman que
        // "proyecto-fisico SIEMPRE arranca su respuesta con una línea resultado" —
        // esta ruta devolvía un string PLANO (el mensaje de error tal cual), sin
        // `resultado` ni JSON, rompiendo esa promesa (`JSON.parse` del agente
        // fallaba). Mismo sobre que cualquier otro rechazo de la tool.
        const mensaje = error instanceof Error ? error.message : String(error)
        return JSON.stringify(
          { resultado: `NO SE APLICÓ NADA — ${mensaje}`, accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "DEPENDENCIAS_NO_DISPONIBLES", mensaje },
          null,
          2,
        )
      }

      let servicio: ServicioDeProyecto
      try {
        servicio = deps.obtenerServicioDeProyectoConVista({ directorio: directorioDatos, idProyecto })
      } catch (error) {
        // Candado (H5, mismo criterio que vista-fisica.ts): otro proceso ya tiene este
        // proyecto abierto — mensaje claro, nunca una excepción cruda ni una
        // escritura. FX-5 (F-TRUTH-3): mismo sobre JSON con `resultado` que cualquier
        // otro rechazo — antes esta ruta devolvía un string plano.
        const mensaje = error instanceof Error ? error.message : String(error)
        return JSON.stringify(
          { resultado: `NO SE APLICÓ NADA — no pude acceder al proyecto físico: ${mensaje}`, accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "PROYECTO_BLOQUEADO", mensaje },
          null,
          2,
        )
      }

      const catalogo = deps.catalogoReal()

      if (args.accion === "leer") {
        const snapshot = servicio.snapshot() as SnapshotConVista
        const vocabulario = vocabularioDesdeCatalogo(catalogo, OPERACIONES_PERMITIDAS)
        return JSON.stringify({ resultado: "SÓLO LECTURA — no cambió nada", ...resumenDeLectura(idProyecto, snapshot, catalogo), vocabulario }, null, 2)
      }

      // ── 'simular' / 'aplicar': baseRevision y operaciones son obligatorios. ────────
      if (args.baseRevision === undefined) {
        const snapshotActual = servicio.snapshot() as SnapshotConVista
        return JSON.stringify(
          {
            resultado: "NO SE APLICÓ NADA — falta baseRevision (llamá 'leer' primero)",
            accion: args.accion,
            idProyecto,
            ok: false,
            rechazadoPor: "tool",
            codigo: "BASE_REVISION_FALTANTE",
            baseRevision: null,
            revisionActual: snapshotActual.revision,
          },
          null,
          2,
        )
      }
      const baseRevision = args.baseRevision
      const operacionesCrudas = args.operaciones
      if (!operacionesCrudas || operacionesCrudas.length === 0) {
        const snapshotActual = servicio.snapshot() as SnapshotConVista
        return JSON.stringify(
          { resultado: "NO SE APLICÓ NADA — faltan operaciones", accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "OPERACIONES_FALTANTES", baseRevision, revisionActual: snapshotActual.revision },
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
          {
            resultado: `NO SE APLICÓ NADA — rechazado en transporte (${rechazoDeTransporte.codigo})`,
            accion: args.accion,
            idProyecto,
            ok: false,
            rechazadoPor: "tool",
            ...rechazoDeTransporte,
            baseRevision,
            revisionActual: snapshotActual.revision,
          },
          null,
          2,
        )
      }

      const sobres = construirSobres(operacionesCrudas as readonly OperacionCruda[], baseRevision)
      const resultado: ResultadoTransaccion = args.accion === "aplicar" ? servicio.aplicarTransaccion(sobres) : servicio.proponer(sobres)

      const snapshotVigente = servicio.snapshot() as SnapshotConVista
      const proyectoParaNombres = proyectoParaExplicar(resultado, snapshotVigente)
      const motivos = deps.explicarMotivosConCatalogoReal(resultado.motivos, proyectoParaNombres).map(proyectarMotivoParaAgente)
      // F-07 (continuación): ante PLACA_DESCONOCIDA/TIPO_CATALOGO_DESCONOCIDO/
      // TERMINAL_NO_DECLARADO, `valoresValidos` derivado del catálogo (y, para
      // TERMINAL_NO_DECLARADO, del `Proyecto` vigente) — sobre los motivos CRUDOS del
      // Engine (`resultado.motivos`, con `datos`), nunca sobre `motivos` ya proyectados
      // para el agente (esos pierden `datos` a propósito, ver `proyectarMotivoParaAgente`).
      const valoresValidos = valoresValidosParaMotivos(resultado.motivos, catalogo, proyectoParaNombres)

      const esStale = resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA")
      const resultadoTexto = lineaDeResultado(args.accion, resultado.ok, {
        baseRevision: resultado.baseRevision,
        revisionActual: resultado.revisionActual,
        stale: esStale,
        motivoPrincipal: motivos[0]?.explicacion ?? motivos[0]?.codigo,
      })

      return JSON.stringify(
        {
          resultado: resultadoTexto,
          accion: args.accion,
          idProyecto,
          ok: resultado.ok,
          baseRevision: resultado.baseRevision,
          revisionActual: resultado.revisionActual,
          motivos,
          ...(valoresValidos ? { valoresValidos } : {}),
        },
        null,
        2,
      )
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return JSON.stringify(
        { resultado: `NO SE APLICÓ NADA — error inesperado (${mensaje})`, accion: args.accion, idProyecto: args.idProyecto ?? null, ok: false, rechazadoPor: "tool", codigo: "ERROR_INESPERADO", mensaje },
        null,
        2,
      )
    }
  },
})
