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
import type { CapacidadCuantitativa } from "../conocimiento/cuantitativo.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"
// Component System Foundation #1 (F6): el vocabulario y el conocimiento de componentes
// salen de `../conocimiento/` (ComponentKnowledge), ya no de la vista. Como ahora el
// vocabulario importa VALORES (la fachada, el núcleo), se carga perezoso igual que
// `../servidor/*` (criterio D13, abajo) — nunca estático en el top-level.
type ModuloVocabulario = typeof import("../conocimiento/vocabulario.ts")
type ModuloConocimientoActivo = typeof import("../conocimiento/conocimiento-activo.ts")
// Numeric Conditions S3 (OD-S3-1 = B): el criterio de "se puede ofrecer para crear" y los
// rótulos de los comparadores son los de S1 (`vista-fisica/condicion-numerica.ts`), nunca
// una copia. Importa el núcleo como valor (`COMPARADORES`): perezoso, mismo criterio D13.
type ModuloCondicionNumerica = typeof import("../vista-fisica/condicion-numerica.ts")

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
  /** Sólo TEXTO: la explicación en lenguaje llano de los motivos (presentación de la
   * vista). Ningún hecho de componente sale de acá. */
  readonly explicarMotivosConCatalogoReal: ModuloVistaReal["explicarMotivosConCatalogoReal"]
  /** F6 (D-01 condición 3): el ComponentKnowledge del runtime — la MISMA instancia de
   * catálogo que usa la raíz de composición. De acá salen `vocabulario`,
   * `valoresValidos`, `descripcionPines` y los nombres. */
  readonly conocimiento: ModuloConocimientoActivo["CONOCIMIENTO_ACTIVO"]
  readonly vocabularioDesdeCatalogo: ModuloVocabulario["vocabularioDesdeCatalogo"]
  readonly valoresValidosParaMotivos: ModuloVocabulario["valoresValidosParaMotivos"]
  readonly descripcionPinesDeComponente: ModuloVocabulario["descripcionPinesDeComponente"]
  readonly disponibleParaCrear: ModuloCondicionNumerica["disponibleParaCrear"]
  readonly rotuloComparador: ModuloCondicionNumerica["ROTULO_COMPARADOR"]
}

async function cargarDependencias(): Promise<DependenciasProyectoFisico> {
  let modServicio: ModuloServicioConVista
  let modVistaReal: ModuloVistaReal
  let modVocabulario: ModuloVocabulario
  let modConocimiento: ModuloConocimientoActivo
  let modCondicionNumerica: ModuloCondicionNumerica
  try {
    ;[modServicio, modVistaReal, modVocabulario, modConocimiento, modCondicionNumerica] = await Promise.all([
      import("../servidor/servicio-con-vista.ts"),
      import("../vista-fisica/vista-real.ts"),
      import("../conocimiento/vocabulario.ts"),
      import("../conocimiento/conocimiento-activo.ts"),
      import("../vista-fisica/condicion-numerica.ts"),
    ])
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Falta una carpeta de Tecnia Bot ("servidor", "vista-fisica" o "conocimiento") junto a esta tool (no se pudo cargar: ${detalle}). ` +
        `Esto pasa con una instalación incompleta o interrumpida a mitad de una actualización. Reinstalá ` +
        `Tecnia Bot (o corré "Reparar Tecnia Bot" desde el menú inicio en Windows) para arreglarlo.`,
    )
  }
  return {
    obtenerServicioDeProyectoConVista: modServicio.obtenerServicioDeProyectoConVista,
    explicarMotivosConCatalogoReal: modVistaReal.explicarMotivosConCatalogoReal,
    conocimiento: modConocimiento.CONOCIMIENTO_ACTIVO,
    vocabularioDesdeCatalogo: modVocabulario.vocabularioDesdeCatalogo,
    valoresValidosParaMotivos: modVocabulario.valoresValidosParaMotivos,
    descripcionPinesDeComponente: modVocabulario.descripcionPinesDeComponente,
    disponibleParaCrear: modCondicionNumerica.disponibleParaCrear,
    rotuloComparador: modCondicionNumerica.ROTULO_COMPARADOR,
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
 * F-13 (PHASE_3_WAVE_0_DESIGN.md): `nombre` (anexo de pedagogía, vía ComponentKnowledge) y
 * `descripcionPines` (texto llano, `vocabulario.ts::descripcionPinesDeComponente`) por
 * componente — derivados del IR + el catálogo REAL, nunca de una tabla hardcodeada.
 * `catalogo.obtenerComponente(componente.tipo)` puede dar `undefined` si el catálogo
 * cambió desde que se creó el componente (gap heredado, documentado): el fallback usa
 * el `tipo` crudo como nombre, nunca explota.
 */
function resumenDeComponente(componente: Componente, deps: DependenciasProyectoFisico) {
  const catalogo: Catalogo = deps.conocimiento.catalogo
  return {
    id: componente.id,
    tipo: componente.tipo,
    nombre: (catalogo.obtenerComponente(componente.tipo) ? deps.conocimiento.nombre("componente", componente.tipo) : undefined) ?? componente.tipo,
    pines: componente.pines,
    descripcionPines: deps.descripcionPinesDeComponente(componente, catalogo),
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Numeric Conditions S3 (OD-S3-1 = B): proyección cuantitativa PARA EL AGENTE. No es
// conocimiento nuevo: cada capacidad sale tal cual de `capacidadesCuantitativas(tipo)` de
// la fachada (CK-REQ-N1), y `disponible` es el criterio de creación de S1
// (`disponibleParaCrear`). Acá no hay ningún tipo, capacidad, unidad, símbolo, rango ni
// umbral escrito: sólo se elige qué campos ve el agente para resolver una frase.
// ════════════════════════════════════════════════════════════════════════════════════

function capacidadParaAgente(capacidad: CapacidadCuantitativa, deps: DependenciasProyectoFisico) {
  return {
    capacidad: capacidad.capacidad,
    etiqueta: capacidad.etiqueta,
    magnitud: capacidad.magnitud,
    unidadCanonica: capacidad.unidadCanonica,
    unidades: capacidad.unidades.map((u) => ({ id: u.id, simbolo: u.simbolo })),
    rango: capacidad.rango,
    disponible: deps.disponibleParaCrear(capacidad),
  }
}

function capacidadesParaAgente(tipo: string, deps: DependenciasProyectoFisico) {
  const r = deps.conocimiento.capacidadesCuantitativas(tipo)
  return r.ok ? r.valor.map((c) => capacidadParaAgente(c, deps)) : []
}

/** Marcadores del ejemplo: dicen de qué campo de esta misma proyección sale cada valor;
 * nunca un id, una capacidad o una unidad reales. */
const EJEMPLO_CONDICION_NUMERICA = Object.freeze({
  comportamiento: {
    cuando: {
      sensor: "<id del sensor — condicionesNumericas.sensores[].id>",
      capacidad: "<capacidades[].capacidad de ese sensor>",
      comparador: "<uno de condicionesNumericas.comparadores[].comparador>",
      umbral: { valor: "<el número que dijo el alumno, como número>", unidad: "<capacidades[].unidades[].id; sin unidad clara, unidadCanonica>", magnitud: "<capacidades[].magnitud>" },
    },
    entonces: { actuador: "<id del actuador>", accion: "<vocabulario.componentes[].estadosDeSalida[].accion>" },
  },
})

function condicionesNumericasParaAgente(proyecto: Proyecto, deps: DependenciasProyectoFisico) {
  const nombreDeTipo = (tipo: string) => deps.conocimiento.nombre("componente", tipo) ?? tipo
  const sensores = proyecto.componentes
    .map((componente) => ({ id: componente.id, tipo: componente.tipo, nombre: nombreDeTipo(componente.tipo), capacidades: capacidadesParaAgente(componente.tipo, deps) }))
    .filter((s) => s.capacidades.length > 0)
  const catalogo = deps.conocimiento.catalogo.componentes
    .map((componente) => ({ tipo: componente.id, nombre: nombreDeTipo(componente.id), capacidades: capacidadesParaAgente(componente.id, deps) }))
    .filter((t) => t.capacidades.length > 0)
  const comparadores = (Object.keys(deps.rotuloComparador) as (keyof typeof deps.rotuloComparador)[]).map((comparador) => ({ comparador, significado: deps.rotuloComparador[comparador] }))
  return { comparadores, sensores, catalogo, ejemplo: { SetComportamiento: EJEMPLO_CONDICION_NUMERICA } }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Generabilidad (guía para planificar): qué placas, componentes, capacidades y acciones
// llegan HOY a un programa compilable. Sale tal cual de `codegen/generabilidad.ts`, que compone
// el MISMO gate de `generarPrograma` (admisión eléctrica + soporte del backend). Acá no hay
// ninguna placa, tipo ni protocolo escrito: sólo se agregan los nombres para mostrar.
// Import perezoso y protegido (mismo criterio D13): si falta `codegen/`, `leer` sigue andando.
// ════════════════════════════════════════════════════════════════════════════════════

type ModuloGenerabilidad = typeof import("../codegen/generabilidad.ts")

const NOTA_GENERABILIDAD =
  "Guía para PLANIFICAR, no autorización: dice qué placa, componente, capacidad y acción llegan hoy a un programa compilable con la tool `programa` " +
  "(`generableEn` = placas donde sí). `disponible` de condicionesNumericas es otra cosa (que se pueda armar la regla). " +
  "El Project Engine y `programa` vuelven a validar todo igual."

async function generabilidadParaAgente(deps: DependenciasProyectoFisico) {
  let modulo: ModuloGenerabilidad
  try {
    modulo = await import("../codegen/generabilidad.ts")
  } catch {
    return { nota: "No se pudo consultar la generabilidad: falta la carpeta codegen de Tecnia Bot (instalación incompleta).", placas: null, componentes: null }
  }
  const g = modulo.generabilidad(deps.conocimiento)
  const nombreDe = (kind: "componente" | "placa", id: string) => deps.conocimiento.nombre(kind, id) ?? id
  return {
    nota: NOTA_GENERABILIDAD,
    placas: g.placas.map((p) => ({ ...p, nombre: nombreDe("placa", p.placa) })),
    componentes: g.componentes.map((c) => ({ ...c, nombre: nombreDe("componente", c.tipo) })),
  }
}

function resumenDeLectura(idProyecto: string, snapshot: SnapshotConVista, deps: DependenciasProyectoFisico) {
  const vista = snapshot.vista
  const rolPorId = new Map((vista?.componentes ?? []).map((c) => [c.id, c.rol] as const))
  const componentes = snapshot.proyecto.componentes.map((componente) => ({
    ...resumenDeComponente(componente, deps),
    rol: rolPorId.get(componente.id) ?? null,
  }))
  const motivos = (vista?.motivos ?? []).map(proyectarMotivoParaAgente)
  // Phase 3: las reglas salen de la MISMA proyección del servidor que usa la vista
  // (`ModeloDeVista.reglas`) — ningún segundo cálculo acá.
  const reglas = (vista?.reglas ?? []).map((r) => ({ id: r.id, texto: r.texto, completa: r.completa, faltan: r.faltan, frase: r.frase }))
  return { accion: "leer" as const, idProyecto, revision: snapshot.revision, ...avisoDeProyectoArmado(componentes, reglas), componentes, reglas, motivos }
}

/**
 * Si el proyecto ya tiene piezas, `leer` lo dice ARRIBA de todo, con sus nombres.
 *
 * Por qué existe (notebook real, 2026-11-24): con un proyecto ya armado el docente pidió otra
 * cosa, con otro sensor, y el agente le sumó la pieza nueva encima y quitó una regla que
 * estorbaba, sin decir nada. El prompt no hablaba del caso y el dato estaba, pero perdido entre
 * 17.000 caracteres de vocabulario. Un proyecto sin piezas ni reglas no agrega el campo: no hay
 * nada que preguntar. (Este archivo no nombra piezas concretas: lo custodia un test.)
 */
function avisoDeProyectoArmado(componentes: readonly { readonly nombre: string }[], reglas: readonly { readonly texto: string | null }[]) {
  // "Vacío" es lo mismo acá que en `vaciar`: sin piezas Y sin reglas (una regla incompleta puede
  // existir sin ninguna pieza).
  if (componentes.length === 0 && reglas.length === 0) return {}
  return {
    proyectoArmado: {
      piezas: componentes.map((c) => c.nombre),
      reglas: reglas.map((r) => r.texto ?? "(una regla incompleta)"),
      queHacer:
        "YA HAY UN PROYECTO ARMADO. Si lo que te piden habla de estas piezas, o ya te dijeron en esta charla que siguen con este proyecto, seguí sobre él. " +
        "Si es OTRO proyecto, NO le sumes piezas ni le quites nada todavía: preguntá primero, UNA sola vez, nombrando lo que hay, si seguimos con este proyecto o empezamos uno nuevo. " +
        "Para empezar de nuevo: avisá que el actual se borra (no queda copia) y, con el sí, usá la acción `vaciar`. " +
        "Y nunca quites ni pises una regla o una pieza que nadie nombró sin decirlo y preguntar antes.",
    },
  }
}

/** Por qué el Engine rechazó el vaciado, en palabras si las hay y si no con su código: nunca un
 * "rechazado" mudo (el prompt le pide al agente que cuente el motivo). Se mira primero lo que
 * bloquea: un lote de vaciado siempre trae avisos informativos de cada regla quitada. */
function motivoDelRechazo(motivos: readonly { readonly severidad?: string; readonly explicacion?: string | null; readonly codigo: string }[]): string {
  const principal = motivos.find((m) => m.severidad === "blocking") ?? motivos[0]
  return principal?.explicacion ?? principal?.codigo ?? "rechazado por el Project Engine"
}

/** Las operaciones que dejan el proyecto sin reglas, sin cables y sin piezas, en UNA transacción.
 * Lo único que el Project Engine exige es que las piezas vayan AL FINAL: una pieza con una regla o
 * con un cable no se puede quitar (REMOCION_CON_DEPENDIENTES). Entre reglas y cables el orden da
 * igual (medido las dos veces). La placa no se toca. */
function operacionesParaVaciar(proyecto: Proyecto): readonly OperacionCruda[] {
  return [
    ...proyecto.comportamientos.map((c) => ({ tipo: "QuitarComportamiento", payload: { comportamiento: c.id } })),
    ...proyecto.conexiones.map((c) => ({ tipo: "Desconectar", payload: { conexion: c.id } })),
    ...proyecto.componentes.map((c) => ({ tipo: "QuitarComponente", payload: { componente: c.id } })),
  ]
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

Cuatro \`accion\`:
- \`leer\`: snapshot resumido — revisión, componentes (id/tipo/nombre/rol/pines/descripcionPines) y los motivos vigentes con su explicación en texto llano, MÁS \`vocabulario\` (placas/componentes/terminales/operaciones de ejemplo, derivados del catálogo real) y \`condicionesNumericas\` (los comparadores, y para cada sensor del proyecto y cada tipo del catálogo sus capacidades medibles con etiqueta, magnitud, unidades, unidad canónica, rango y si se pueden usar: los datos para armar una regla con un número, nunca escritos a mano), y \`generabilidad\` (por placa, componente, capacidad y acción: si llega hoy a un programa compilable con \`programa\`, en qué placas —\`generableEn\`— y, si no, el \`CODEGEN_*\` o el problema de admisión que lo impide).
- \`simular\`: dry-run — nunca persiste, nunca sube la revisión, sólo anticipa qué pasaría.
- \`aplicar\`: commitea de verdad, todo o nada (una transacción atómica: o entran TODAS las operaciones del lote, o ninguna).
- \`vaciar\`: EMPEZAR DE NUEVO. Quita TODAS las reglas, los cables y las piezas del proyecto en una sola transacción (todo o nada) y deja la placa como estaba. Sólo pide \`baseRevision\`; las operaciones las arma la tool a partir de lo que hay, no las mandes vos. **No guarda copia: lo que había se pierde.** Usala SÓLO después de que la persona haya dicho que sí a empezar de nuevo, habiéndole avisado que el proyecto actual se borra.

Toda salida empieza con un campo \`resultado\` (texto llano inequívoco): "SÓLO LECTURA" para \`leer\`, "VACIADO — revisión X→Y" para un \`vaciar\` que entró, "SIMULACIÓN" para un \`simular\` resuelto, "APLICADO — revisión X→Y" para un \`aplicar\` que entró, o "NO SE APLICÓ NADA — <motivo>" para cualquier rechazo (de transporte, del Engine, o stale). Nunca afirmes una acción que no veas confirmada en esa línea.

\`simular\`/\`aplicar\` necesitan:
- \`baseRevision\`: la revisión que leíste con \`leer\` justo antes — si alguien más (el alumno desde el navegador, u otra llamada tuya) ya cambió el proyecto, la operación se rechaza con un motivo claro en vez de pisar ese cambio. Nunca inventes este número ni lo copies de una llamada vieja: si no lo tenés a mano, llamá \`leer\` primero.
- \`operaciones\`: de 1 a ${MAXIMO_OPERACIONES} operaciones \`{tipo, payload}\`. Sólo se aceptan estos 8 tipos (lista cerrada): ${OPERACIONES_PERMITIDAS.join(", ")}. Cualquier otro tipo (incluido CambiarComponente) se rechaza SIN tocar el proyecto. Las reglas ("mientras la entrada esté presionada, la salida está encendida") se crean con SetComportamiento y se quitan con QuitarComportamiento (por id, el que devuelve \`leer\`): pasan por el mismo Project Engine, que decide si entran. \`vocabulario.operaciones\` trae el payload EXACTO de ejemplo. Una regla de NIVEL describe un estado mientras la condición es verdadera; no es un evento ni una memoria ("cuando lo aprieto una vez", "que quede prendido" no se pueden expresar así).

Si otra sesión ya tiene este proyecto abierto, la tool te lo va a decir en vez de pisarlo.`,
  args: {
    accion: tool.schema.enum(["leer", "simular", "aplicar", "vaciar"]).describe("'leer' para ver el estado actual; 'simular' para un dry-run (no persiste); 'aplicar' para commitear de verdad; 'vaciar' para empezar de nuevo (quita todo; no guarda copia)."),
    baseRevision: tool.schema
      .number()
      .optional()
      .describe("Obligatorio para 'simular'/'aplicar'/'vaciar': la revisión que leíste con 'leer' justo antes. Nunca la inventes ni la completes vos — si no la tenés, llamá 'leer' primero."),
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
      // harness YA restringe `accion` a `leer`/`simular`/`aplicar`/`vaciar` — este chequeo es
      // para quien invoque `execute()` directo (bypaseando zod, mismo criterio que
      // motiva la whitelist de `tipo`/R-6 más abajo): un valor desconocido se rechaza
      // EXPLÍCITO, nunca cae en el dry-run por el default implícito del ternario de
      // más abajo (`args.accion === "aplicar" ? ... : ...`).
      if (args.accion !== "leer" && args.accion !== "simular" && args.accion !== "aplicar" && args.accion !== "vaciar") {
        return JSON.stringify(
          { resultado: "NO SE APLICÓ NADA — acción desconocida (usá 'leer', 'simular', 'aplicar' o 'vaciar')", accion: args.accion, idProyecto: args.idProyecto ?? null, ok: false, rechazadoPor: "tool", codigo: "ACCION_DESCONOCIDA" },
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
        return JSON.stringify({ resultado: "NO SE APLICÓ NADA — idProyecto inválido", accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "ID_PROYECTO_INVALIDO" })
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

      const catalogo = deps.conocimiento.catalogo

      if (args.accion === "leer") {
        const snapshot = servicio.snapshot() as SnapshotConVista
        const vocabulario = deps.vocabularioDesdeCatalogo(catalogo, OPERACIONES_PERMITIDAS, deps.conocimiento)
        const condicionesNumericas = condicionesNumericasParaAgente(snapshot.proyecto, deps)
        const generabilidad = await generabilidadParaAgente(deps)
        // SIN SANGRÍA (2026-11-27). Medido en la notebook real: `leer` salía con `null, 2` y pesaba
        // 36 mil caracteres por llamada; la mitad eran espacios. En una charla de cinco lecturas eso
        // fue más de la mitad de todo lo que devolvieron las tools, y OpenCode tuvo que resumir la charla.
        // El modelo lee igual el JSON compacto; las claves y su orden no cambian.
        return JSON.stringify({ resultado: "SÓLO LECTURA — no cambió nada", ...resumenDeLectura(idProyecto, snapshot, deps), vocabulario, condicionesNumericas, generabilidad })
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

      // ── 'vaciar': empezar de nuevo. Las operaciones NO vienen del agente: salen del proyecto
      // vigente. Sigue siendo transporte: son operaciones existentes, por el mismo Engine, en UNA
      // transacción; si `baseRevision` quedó vieja, el Engine la rechaza como a cualquier otra.
      // No pasa por el tope de MAXIMO_OPERACIONES: ese tope es para lo que escribe el agente. ──
      if (args.accion === "vaciar") {
        const antes = servicio.snapshot() as SnapshotConVista
        const paraVaciar = operacionesParaVaciar(antes.proyecto)
        if (paraVaciar.length === 0) {
          return JSON.stringify(
            { resultado: "NO SE APLICÓ NADA — el proyecto ya está vacío, no hay nada que quitar (podés armar el proyecto nuevo sobre él)", accion: args.accion, idProyecto, ok: false, rechazadoPor: "tool", codigo: "PROYECTO_YA_VACIO", baseRevision, revisionActual: antes.revision },
            null,
            2,
          )
        }
        const vaciado = servicio.aplicarTransaccion(construirSobres(paraVaciar, baseRevision))
        const despues = servicio.snapshot() as SnapshotConVista
        const motivosDelVaciado = deps.explicarMotivosConCatalogoReal(vaciado.motivos, proyectoParaExplicar(vaciado, despues)).map(proyectarMotivoParaAgente)
        // Se afirma lo que se VE después, no lo que se pidió: el proyecto releído tiene que estar vacío.
        // Este chequeo NO tiene test: el Engine es todo o nada y no encontré forma de que acepte el
        // lote y deje algo (una revisión independiente tampoco). Queda como cinturón: si un día el
        // Engine cambia, acá no se dice VACIADO de más.
        const quedoVacio = despues.proyecto.componentes.length === 0 && despues.proyecto.conexiones.length === 0 && despues.proyecto.comportamientos.length === 0
        const stale = vaciado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA")
        const resultadoDelVaciado =
          vaciado.ok && quedoVacio
            ? `VACIADO — revisión ${vaciado.baseRevision}→${vaciado.revisionActual}: se quitaron ${antes.proyecto.componentes.length} pieza(s), ${antes.proyecto.conexiones.length} cable(s) y ${antes.proyecto.comportamientos.length} regla(s). La placa quedó como estaba. No se guardó copia de lo anterior.`
            : stale
              ? "NO SE APLICÓ NADA — el proyecto cambió; volvé a leer"
              : `NO SE APLICÓ NADA — ${vaciado.ok ? "el proyecto no quedó vacío después de vaciarlo (releé con 'leer' y contá lo que hay)" : motivoDelRechazo(motivosDelVaciado)}`
        return JSON.stringify(
          { resultado: resultadoDelVaciado, accion: args.accion, idProyecto, ok: vaciado.ok && quedoVacio, baseRevision: vaciado.baseRevision, revisionActual: vaciado.revisionActual, motivos: motivosDelVaciado },
          null,
          2,
        )
      }

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
      const valoresValidos = deps.valoresValidosParaMotivos(resultado.motivos, catalogo, proyectoParaNombres)

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
