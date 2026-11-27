// Codegen MVP, Slice 1 — generación del programa (IR → C++ Arduino + platformio.ini).
//
// Una PROYECCIÓN de la IR, igual que la vista física o Blockly: la IR dice QUÉ, este backend
// decide CÓMO. `generarPrograma` es pura: misma IR + mismo catálogo → mismos bytes. No muta el
// proyecto, no lee reloj ni disco, no compila ni carga (eso es la tool `platformio`). No la usa
// el agente todavía (Slice 1b).
//
// Gate, en este orden, y nunca archivos parciales:
//   1. el proyecto está `listo` (validarProyecto + derivarReadiness);
//   2. la placa y cada tipo de componente del proyecto tienen admisión eléctrica oficial
//      PARA ESA PLACA (la autoridad es `conocimiento/admision.ts`, no se duplica);
//   3. el backend sabe derivar cada lectura, cada escritura, cada reposo y cada pin.
// Los errores son del backend (`CODEGEN_*`), no motivos del proyecto: el Engine no conoce
// el codegen.
//
// Programa generado: cooperativo, sin `delay`. `setup` configura los pines usados y deja cada
// actuador controlado en su reposo; `loop` lee una vez cada (sensor, capacidad) y escribe cada
// actuador. Multi-Rule Safety garantiza un solo dueño por actuador en un proyecto listo, así que
// el estado de cada salida es una función de las lecturas: sin prioridades ni conflictos.
//
// Slice 2 — lecturas por PROTOCOLO. Si Component Knowledge declara cómo se obtiene la capacidad
// (`lecturaDeCapacidad`), el backend se elige por ese protocolo (`protocolos.ts`), nunca por el
// tipo de componente; si no declara nada, la lectura se deriva de la topología (Slice 1).
// - Tiempos: la primera lectura espera `esperaTrasEncendido` y entre intentos pasa al menos
//   `periodoMinimo`, ambos de Component Knowledge, con `millis()` (sin bloquear el `loop`).
// - Lectura VÁLIDA o INVÁLIDA (D3 = A): sin una lectura válida (antes de la primera o si el
//   último intento falló) la condición NO se cumple y el actuador queda en su reposo; un fallo
//   invalida la lectura anterior, que nunca se reutiliza. No es estado de la IR: es del backend.

import type { Comparador, Componente, Proyecto } from "../nucleo/ir.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import type { Cantidad, Capacidad, ComponenteCatalogo } from "../nucleo/catalogo.ts"
import type { Placa } from "../nucleo/placas.ts"
import { complementoDeAccion } from "../nucleo/catalogo.ts"
import { derivarReadiness, validarProyecto } from "../nucleo/validar.ts"
import { compararIdsLocales } from "../nucleo/id.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { admitirComponente, admitirPlaca, compatibilidadRevisada, REVISIONES_DEL_ANEXO, type RevisionesElectricas } from "../conocimiento/admision.ts"
import { derivarEscritura, derivarLectura, pinArduino, type Lectura, type NivelDigital, type PinArduino } from "./derivaciones.ts"
import {
  RechazoDeEmision,
  UINT32_MAX,
  UINT8_MAX,
  atomo,
  comentario,
  cpp,
  crearNombres,
  entero,
  expresionDeBackend,
  flotante,
  idLocal,
  lineaDeBackend,
  nombreDePin,
  numero,
  palabra,
  texto,
  unirLineas,
  type CodigoRechazoDeEmision,
  type Linea,
} from "./emision.ts"
import { renderizarPlatformioIni } from "./platformio-ini.ts"
import { BACKENDS_DE_PROTOCOLO, backendDeProtocolo, type BackendDeProtocolo, type CampoDeProtocolo } from "./protocolos.ts"

export type CodigoErrorCodegen =
  | "CODEGEN_PROYECTO_NO_LISTO"
  | "CODEGEN_NO_ADMITIDO"
  | "CODEGEN_SIN_LECTURA"
  | "CODEGEN_SIN_ESCRITURA"
  | "CODEGEN_REPOSO_NO_DECLARADO"
  | "CODEGEN_PIN_NO_DERIVABLE"
  | "CODEGEN_UMBRAL_NO_CONVERTIBLE"
  | "CODEGEN_CONVERSION_NO_MONOTONA"
  /** S2: la capacidad declara un protocolo de lectura que este backend no implementa. */
  | "CODEGEN_PROTOCOLO_SIN_BACKEND"
  /** S2: la lectura declarada no se puede cumplir tal cual (terminal, campo del protocolo o tiempos). */
  | "CODEGEN_LECTURA_INCOHERENTE"
  /**
   * H-02: un dato no se puede escribir en el programa sin cambiar lo que el programa dice
   * (`CODEGEN_IDENTIFICADOR_INVALIDO`: un id de la IR o del catálogo no forma un identificador
   * C++; `CODEGEN_DATO_NO_EMITIBLE`: un texto, un número o un valor del `.ini` no entra en su
   * clase léxica). Los emite `emision.ts`; `datos` trae `clase`, `causa`, `campo` y `valor`.
   */
  | CodigoRechazoDeEmision

export interface ErrorCodegen {
  readonly codigo: CodigoErrorCodegen
  readonly datos: Readonly<Record<string, unknown>>
}

export interface ArchivosGenerados {
  readonly "platformio.ini": string
  readonly "src/main.cpp": string
}

/** Un tramo de `src/main.cpp`: números de línea desde 1, los dos extremos incluidos. */
export interface RangoDeLineas {
  readonly desde: number
  readonly hasta: number
}

/** Una cosa que `setup` hace con UN pin. `reposo` (la acción en que arranca) sólo va en una salida. */
export interface PasoDeInicio {
  readonly papel: "entrada" | "bus" | "salida"
  readonly componente: string
  readonly pin: string
  readonly reposo?: string
  readonly lineas: RangoDeLineas
}

/**
 * Dónde quedó cada parte en `src/main.cpp` (2026-11-26). Lo usa la ventana para mostrar la
 * estructura del programa en los bloques («al iniciar» / «por siempre») y para marcar qué líneas
 * salen de qué regla.
 *
 * Los números se anotan EN LA MISMA PASADA que escribe cada línea (`renderizarMain`): no se
 * buscan después en el texto. Buscarlos sería un segundo lector del programa, que puede
 * equivocarse sin que el programa cambie (un comentario que contenga «void loop», por ejemplo).
 * Sólo trae ids y números: las palabras las pone quien lo muestra.
 */
export interface MapaDelPrograma {
  /** `void setup() {` … `}`, y lo que hace adentro, en el orden en que lo hace. */
  readonly alIniciar: { readonly lineas: RangoDeLineas; readonly pasos: readonly PasoDeInicio[] }
  /** `void loop() {` … `}`. */
  readonly porSiempre: { readonly lineas: RangoDeLineas }
  /** Por regla, las líneas de `loop` que deciden y escriben su salida (las lecturas son compartidas y no van). */
  readonly reglas: readonly { readonly regla: string; readonly lineas: RangoDeLineas }[]
}

export type ResultadoGeneracion =
  | { readonly ok: true; readonly archivos: ArchivosGenerados; readonly environment: string; readonly advertencias: readonly Motivo[]; readonly mapa: MapaDelPrograma }
  | { readonly ok: false; readonly error: ErrorCodegen }

export interface OpcionesGeneracion {
  /** Revisiones eléctricas a consultar; por defecto, el anexo de Component Knowledge. */
  readonly revisiones?: RevisionesElectricas
  /** Backends de lectura por protocolo; por defecto, los de `protocolos.ts`. */
  readonly protocolos?: Readonly<Record<string, BackendDeProtocolo>>
}

const falla = (codigo: CodigoErrorCodegen, datos: Readonly<Record<string, unknown>>): ResultadoGeneracion => ({ ok: false, error: { codigo, datos } })

// ════════════════════════════════════════════════════════════════════════════════════
// Umbral en la unidad de la lectura
// ════════════════════════════════════════════════════════════════════════════════════

export type ResultadoUmbral = { readonly ok: true; readonly valor: number; readonly unidad: string } | { readonly ok: false; readonly error: ErrorCodegen }

/**
 * El umbral de la IR expresado en la unidad en que se lee la capacidad (la que declara el
 * catálogo). La conversión es la de Component Knowledge (`convertirParaCapacidad`, normalizada),
 * en tiempo de generación: el firmware compara contra una constante, sin fórmula. La IR no
 * cambia. Guarda de monotonía: si la conversión no conserva el orden (convertir `v` y `v + 1`),
 * el comparador cambiaría de sentido, así que falla cerrado.
 */
export function umbralEnUnidadDeLectura(
  conocimiento: ComponentKnowledge,
  tipo: string,
  capacidad: Capacidad,
  umbral: { readonly valor: number; readonly unidad: string; readonly magnitud: string },
): ResultadoUmbral {
  const destino = capacidad.unidad
  if (destino === undefined || umbral.unidad === destino) return { ok: true, valor: umbral.valor, unidad: umbral.unidad }
  const datos = { tipo, capacidad: capacidad.id, unidad: umbral.unidad, unidadDestino: destino }
  const convertir = (valor: number) => conocimiento.convertirParaCapacidad(tipo, capacidad.id, { valor, unidad: umbral.unidad, magnitud: umbral.magnitud }, destino)
  const a = convertir(umbral.valor)
  if (!a.ok) return { ok: false, error: { codigo: "CODEGEN_UMBRAL_NO_CONVERTIBLE", datos: { ...datos, causa: a.error } } }
  const b = convertir(umbral.valor + 1)
  if (!b.ok || !(b.valor.valor > a.valor.valor)) return { ok: false, error: { codigo: "CODEGEN_CONVERSION_NO_MONOTONA", datos } }
  return { ok: true, valor: a.valor.valor, unidad: destino }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Plan (todo lo que el programa necesita, ya resuelto y en orden canónico)
// ════════════════════════════════════════════════════════════════════════════════════

interface PinPlan {
  readonly componente: string
  readonly tipo: string
  readonly terminal: string
  readonly pin: string
  readonly arduino: PinArduino
}

/** Lectura por el nivel del pin, derivada de la topología (Slice 1). */
interface LecturaNivelPlan {
  readonly kind: "nivel"
  readonly sensor: string
  readonly capacidad: string
  readonly pin: PinPlan
  readonly lectura: Lectura
}

/** Un bus de protocolo: un terminal de un sensor, leído por un driver, con sus tiempos. */
interface BusPlan {
  readonly componente: string
  readonly terminal: string
  readonly protocolo: string
  readonly backend: BackendDeProtocolo
  readonly pin: PinPlan
  readonly esperaMs: number
  readonly periodoMs: number
  /** Los tiempos tal como los declara Component Knowledge, en segundos (para el comentario del programa). */
  readonly declarado: { readonly espera: number; readonly periodo: number }
}

/** Lectura por protocolo (Slice 2): un campo de los datos del bus; puede ser inválida. */
interface LecturaProtocoloPlan {
  readonly kind: "protocolo"
  readonly sensor: string
  readonly capacidad: string
  readonly pin: PinPlan
  readonly bus: BusPlan
  readonly campo: CampoDeProtocolo
}

type LecturaPlan = LecturaNivelPlan | LecturaProtocoloPlan

interface SalidaPlan {
  readonly regla: string
  readonly actuador: string
  readonly pin: PinPlan
  readonly lectura: LecturaPlan
  readonly comparador: Comparador
  readonly umbral: number
  readonly unidad: string
  readonly umbralIR: { readonly valor: number; readonly unidad: string }
  readonly accion: string
  readonly reposo: string
  readonly nivelObjetivo: NivelDigital
  readonly nivelReposo: NivelDigital
}

const claveLectura = (sensor: string, capacidad: string) => `${sensor}\u0000${capacidad}`
const claveBus = (componente: string, terminal: string, protocolo: string) => `${componente}\u0000${terminal}\u0000${protocolo}`

/** Milisegundos (redondeados hacia arriba: «al menos») de un tiempo declarado en una unidad UCUM `s`. */
function milisegundos(conocimiento: ComponentKnowledge, cantidad: Cantidad | undefined): number | undefined {
  if (cantidad === undefined || cantidad.magnitud !== "tiempo" || !Number.isFinite(cantidad.valor) || cantidad.valor < 0) return undefined
  const unidad = conocimiento.unidad(cantidad.unidad)
  if (!unidad.ok || unidad.valor.ucum !== "s") return undefined
  return Math.ceil(cantidad.valor * 1000)
}
const compararPorComponente = (a: { readonly componente: string; readonly terminal: string }, b: { readonly componente: string; readonly terminal: string }) =>
  compararIdsLocales(a.componente, b.componente) || (a.terminal < b.terminal ? -1 : a.terminal > b.terminal ? 1 : 0)

function pinDe(componente: Componente, terminal: string, placa: Placa): PinPlan | undefined {
  const pin = componente.pines[terminal]
  const registro = pin === null || pin === undefined ? undefined : placa.pines.find((p) => p.id === pin)
  const arduino = registro ? pinArduino(registro) : undefined
  if (pin === null || pin === undefined || arduino === undefined) return undefined
  return { componente: componente.id, tipo: componente.tipo, terminal, pin, arduino }
}

// ════════════════════════════════════════════════════════════════════════════════════
// El gate de soporte, sin proyecto (pasos 2 y 3)
//
// Son los pasos 2 y 3 del gate de `generarPrograma` como funciones puras que no necesitan un
// proyecto. `generarPrograma` las usa tal cual, y `generabilidad.ts` las compone para que el
// agente planifique con EL MISMO criterio: hay una sola fuente de verdad y ninguna tabla aparte.
// ════════════════════════════════════════════════════════════════════════════════════

/** Por qué el backend no soporta algo. Los `datos` no traen contexto de proyecto: lo agrega quien llama. */
export interface FallaDeSoporte {
  readonly codigo: CodigoErrorCodegen
  readonly datos: Readonly<Record<string, unknown>>
}

/** Paso 2, por tipo: el tipo tiene admisión oficial Y revisión eléctrica humana PARA ESA placa. */
export function admisionDeTipoEnPlaca(
  conocimiento: ComponentKnowledge,
  tipo: string,
  placa: string,
  revisiones: RevisionesElectricas = REVISIONES_DEL_ANEXO,
): { readonly admitido: boolean; readonly problemas: readonly string[] } {
  const informe = admitirComponente(conocimiento, tipo, revisiones)
  const revisadoParaLaPlaca = compatibilidadRevisada(tipo, placa, revisiones)
  const problemas = [...informe.problemas, ...(revisadoParaLaPlaca ? [] : [`electrico: sin revisión eléctrica humana para la placa "${placa}"`])]
  return { admitido: informe.officiallySupported && revisadoParaLaPlaca, problemas }
}

/** Cómo lee el backend una capacidad, sin pines todavía: por nivel (topología) o por un bus de protocolo. */
export type LecturaResuelta =
  | { readonly kind: "nivel"; readonly terminal: string; readonly lectura: Lectura }
  | {
      readonly kind: "protocolo"
      readonly terminal: string
      readonly protocolo: string
      readonly backend: BackendDeProtocolo
      readonly campo: CampoDeProtocolo
      readonly esperaMs: number
      readonly periodoMs: number
      /** Los tiempos tal como los declara Component Knowledge (para los datos de un error). */
      readonly tiempos: { readonly esperaTrasEncendido: Cantidad; readonly periodoMinimo: Cantidad }
    }

/**
 * Paso 3, lectura: si Component Knowledge declara cómo se obtiene la capacidad, el backend se
 * elige por ese PROTOCOLO. Si no declara nada, se deriva de la topología (Slice 1).
 */
export function resolverLectura(
  conocimiento: ComponentKnowledge,
  sensor: ComponenteCatalogo,
  capacidad: Capacidad,
  backends: Readonly<Record<string, BackendDeProtocolo>> = BACKENDS_DE_PROTOCOLO,
): { readonly ok: true; readonly valor: LecturaResuelta } | { readonly ok: false; readonly falla: FallaDeSoporte } {
  const fallo = (codigo: CodigoErrorCodegen, datos: Readonly<Record<string, unknown>>) => ({ ok: false as const, falla: { codigo, datos } })
  const contexto = { tipo: sensor.id, capacidad: capacidad.id }
  const declarada = conocimiento.lecturaDeCapacidad(sensor.id, capacidad.id)
  if (declarada === undefined) {
    // Sin mecanismo declarado: por el nivel del pin, si la topología lo permite (Slice 1).
    const derivada = derivarLectura(sensor, capacidad)
    if (!derivada) return fallo("CODEGEN_SIN_LECTURA", contexto)
    return { ok: true, valor: { kind: "nivel", terminal: derivada.terminal, lectura: derivada } }
  }
  // Mecanismo declarado: el backend lo elige el PROTOCOLO, no el tipo de componente.
  if (declarada.mecanismo !== "protocolo") return fallo("CODEGEN_SIN_LECTURA", { ...contexto, mecanismo: declarada.mecanismo })
  const datosLectura = { ...contexto, protocolo: declarada.protocolo }
  const backend = backendDeProtocolo(backends, declarada.protocolo)
  if (!backend) return fallo("CODEGEN_PROTOCOLO_SIN_BACKEND", datosLectura)
  const terminal = sensor.terminales.find((t) => t.id === declarada.terminal)
  if (!terminal || !terminal.asignable || terminal.electrica !== backend.terminal.electrica || terminal.direccion !== backend.terminal.direccion)
    return fallo("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "terminal", terminal: declarada.terminal })
  const ucum = capacidad.unidad === undefined ? undefined : conocimiento.unidad(capacidad.unidad)
  const campo = ucum?.ok ? backend.campos.find((c) => c.magnitud === capacidad.magnitud && c.ucum === ucum.valor.ucum) : undefined
  if (!campo) return fallo("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "campo", magnitud: capacidad.magnitud ?? null, unidad: capacidad.unidad ?? null })
  const esperaMs = milisegundos(conocimiento, declarada.esperaTrasEncendido)
  const periodoMs = milisegundos(conocimiento, declarada.periodoMinimo)
  if (esperaMs === undefined || periodoMs === undefined || !declarada.esperaTrasEncendido || !declarada.periodoMinimo)
    return fallo("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "tiempos", esperaTrasEncendido: declarada.esperaTrasEncendido ?? null, periodoMinimo: declarada.periodoMinimo ?? null })
  const tiempos = { esperaTrasEncendido: declarada.esperaTrasEncendido, periodoMinimo: declarada.periodoMinimo }
  return { ok: true, valor: { kind: "protocolo", terminal: terminal.id, protocolo: declarada.protocolo, backend, campo, esperaMs, periodoMs, tiempos } }
}

/** Paso 3, escritura: la acción tiene complemento declarado (su reposo) y la topología da un nivel para las dos. */
export function resolverEscritura(
  actuador: ComponenteCatalogo,
  accion: string,
):
  | { readonly ok: true; readonly terminal: string; readonly reposo: string; readonly nivelObjetivo: NivelDigital; readonly nivelReposo: NivelDigital }
  | { readonly ok: false; readonly falla: FallaDeSoporte } {
  const reposo = complementoDeAccion(actuador, accion)
  if (reposo === undefined) return { ok: false, falla: { codigo: "CODEGEN_REPOSO_NO_DECLARADO", datos: { tipo: actuador.id, accion } } }
  const escritura = derivarEscritura(actuador)
  const nivelObjetivo = escritura?.nivelDe[accion]
  const nivelReposo = escritura?.nivelDe[reposo]
  if (!escritura || !nivelObjetivo || !nivelReposo) return { ok: false, falla: { codigo: "CODEGEN_SIN_ESCRITURA", datos: { tipo: actuador.id, acciones: [accion, reposo] } } }
  return { ok: true, terminal: escritura.terminal, reposo, nivelObjetivo, nivelReposo }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Generación
// ════════════════════════════════════════════════════════════════════════════════════

export function generarPrograma(proyecto: Proyecto, conocimiento: ComponentKnowledge, opciones: OpcionesGeneracion = {}): ResultadoGeneracion {
  // H-02: cualquier dato que no entre en su clase léxica corta la generación ENTERA. El rechazo
  // viaja como excepción desde `emision.ts` y acá se vuelve un error del backend, sin archivos:
  // no hay forma de devolver medio programa. Cualquier otra excepción no es un rechazo y sigue.
  try {
    return generar(proyecto, conocimiento, opciones)
  } catch (error) {
    if (error instanceof RechazoDeEmision) return falla(error.codigo, error.datos)
    throw error
  }
}

function generar(proyecto: Proyecto, conocimiento: ComponentKnowledge, opciones: OpcionesGeneracion): ResultadoGeneracion {
  const revisiones = opciones.revisiones ?? REVISIONES_DEL_ANEXO
  const catalogo = conocimiento.catalogo

  // ── 1. readiness ──
  const motivos = validarProyecto(proyecto, catalogo)
  const readiness = derivarReadiness(proyecto, motivos)
  const bloqueantes = motivos.filter((m) => m.severidad === "blocking")
  const noListo = () => falla("CODEGEN_PROYECTO_NO_LISTO", { incompleto: readiness.incompleto, invalido: readiness.invalido, motivos: bloqueantes })
  if (!readiness.listo || proyecto.placa === null) return noListo()
  const placa = conocimiento.placa(proyecto.placa)
  if (!placa) return noListo()

  // ── 1b. identidad (H-02) ──
  // Segunda capa, independiente del cargador: el codegen no supone que el proyecto entró por
  // `cargarProyecto`. TODOS los ids locales tienen que tener el formato de la IR, también los
  // de lo que el programa no nombra (una resistencia, una conexión): de un proyecto con un id
  // que no es un id no se genera nada. Va después de la readiness para que un proyecto que no
  // está listo siga diciendo por qué no está listo.
  for (const c of proyecto.componentes) idLocal("cmp", c.id, "componente.id")
  for (const cx of proyecto.conexiones) idLocal("conn", cx.id, "conexion.id")
  for (const b of proyecto.comportamientos) idLocal("beh", b.id, "comportamiento.id")

  // ── 2. admisión eléctrica ──
  const noAdmitidos: { readonly kind: "placa" | "componente"; readonly id: string; readonly problemas: readonly string[] }[] = []
  const informePlaca = admitirPlaca(conocimiento, placa.id, revisiones)
  if (!informePlaca.officiallySupported) noAdmitidos.push({ kind: "placa", id: placa.id, problemas: [...informePlaca.problemas] })
  for (const tipo of [...new Set(proyecto.componentes.map((c) => c.tipo))].sort()) {
    const admision = admisionDeTipoEnPlaca(conocimiento, tipo, placa.id, revisiones)
    if (!admision.admitido) noAdmitidos.push({ kind: "componente", id: tipo, problemas: [...admision.problemas] })
  }
  if (noAdmitidos.length > 0) return falla("CODEGEN_NO_ADMITIDO", { placa: placa.id, noAdmitidos })

  // ── 3. soporte del backend ──
  const porId = new Map(proyecto.componentes.map((c) => [c.id, c] as const))
  const lecturas = new Map<string, LecturaPlan>()
  const buses = new Map<string, BusPlan>()
  const salidas: SalidaPlan[] = []
  const backends = opciones.protocolos ?? BACKENDS_DE_PROTOCOLO
  for (const regla of [...proyecto.comportamientos].sort((a, b) => compararIdsLocales(a.id, b.id))) {
    const { cuando, entonces } = regla
    const sensor = cuando?.sensor === undefined ? undefined : porId.get(cuando.sensor)
    const actuador = entonces?.actuador === undefined ? undefined : porId.get(entonces.actuador)
    const catSensor = sensor && catalogo.obtenerComponente(sensor.tipo)
    const catActuador = actuador && catalogo.obtenerComponente(actuador.tipo)
    const capacidad = catSensor?.capacidades.find((c) => c.id === cuando?.capacidad)
    // Un proyecto listo tiene todo esto; si faltara, no se genera nada.
    if (!cuando?.comparador || !cuando.umbral || !entonces?.accion || !sensor || !actuador || !catSensor || !catActuador || !capacidad) return noListo()

    const umbral = umbralEnUnidadDeLectura(conocimiento, sensor.tipo, capacidad, cuando.umbral)
    if (!umbral.ok) return { ok: false, error: { codigo: umbral.error.codigo, datos: { comportamiento: regla.id, componente: sensor.id, ...umbral.error.datos } } }

    let lectura = lecturas.get(claveLectura(sensor.id, capacidad.id))
    if (!lectura) {
      const resuelta = resolverLectura(conocimiento, catSensor, capacidad, backends)
      if (!resuelta.ok) return falla(resuelta.falla.codigo, { comportamiento: regla.id, componente: sensor.id, ...resuelta.falla.datos })
      const r = resuelta.valor
      const pin = pinDe(sensor, r.terminal, placa)
      if (!pin) return falla("CODEGEN_PIN_NO_DERIVABLE", { componente: sensor.id, terminal: r.terminal, pin: sensor.pines[r.terminal] ?? null, placa: placa.id })
      if (r.kind === "nivel") {
        lectura = { kind: "nivel", sensor: sensor.id, capacidad: capacidad.id, pin, lectura: r.lectura }
      } else {
        const clave = claveBus(sensor.id, r.terminal, r.protocolo)
        let bus = buses.get(clave)
        if (!bus) {
          const declarado = { espera: r.tiempos.esperaTrasEncendido.valor, periodo: r.tiempos.periodoMinimo.valor }
          bus = { componente: sensor.id, terminal: r.terminal, protocolo: r.protocolo, backend: r.backend, pin, esperaMs: r.esperaMs, periodoMs: r.periodoMs, declarado }
          buses.set(clave, bus)
        } else if (bus.esperaMs !== r.esperaMs || bus.periodoMs !== r.periodoMs) {
          // Dos capacidades del mismo bus con tiempos distintos: no hay un único horario que cumpla ambas.
          return falla("CODEGEN_LECTURA_INCOHERENTE", { comportamiento: regla.id, componente: sensor.id, tipo: sensor.tipo, capacidad: capacidad.id, protocolo: r.protocolo, causa: "tiempos", ...r.tiempos })
        }
        lectura = { kind: "protocolo", sensor: sensor.id, capacidad: capacidad.id, pin, bus, campo: r.campo }
      }
      lecturas.set(claveLectura(sensor.id, capacidad.id), lectura)
    }

    const escritura = resolverEscritura(catActuador, entonces.accion)
    if (!escritura.ok) return falla(escritura.falla.codigo, { comportamiento: regla.id, componente: actuador.id, ...escritura.falla.datos })
    const { reposo, nivelObjetivo, nivelReposo } = escritura
    const pin = pinDe(actuador, escritura.terminal, placa)
    if (!pin) return falla("CODEGEN_PIN_NO_DERIVABLE", { componente: actuador.id, terminal: escritura.terminal, pin: actuador.pines[escritura.terminal] ?? null, placa: placa.id })

    salidas.push({
      regla: regla.id,
      actuador: actuador.id,
      pin,
      lectura,
      comparador: cuando.comparador,
      umbral: umbral.valor,
      unidad: umbral.unidad,
      umbralIR: { valor: cuando.umbral.valor, unidad: cuando.umbral.unidad },
      accion: entonces.accion,
      reposo,
      nivelObjetivo,
      nivelReposo,
    })
  }

  const ini = renderizarPlatformioIni(placa)
  const main = renderizarMain(proyecto, catalogo.hash, placa, [...lecturas.values()], [...buses.values()], salidas)
  return Object.freeze({
    ok: true as const,
    archivos: Object.freeze({ "platformio.ini": ini.contenido, "src/main.cpp": main.texto }),
    environment: ini.environment,
    advertencias: Object.freeze(motivos.filter((m) => m.severidad === "warning")),
    mapa: main.mapa,
  })
}

// ════════════════════════════════════════════════════════════════════════════════════
// Render (orden canónico: por id de componente y terminal, nunca por orden de entrada)
//
// H-02 (SEC-04 / BUG-04): acá NO hay plantillas de string. Cada línea se arma con `cpp` y cada
// comentario con `comentario` (`emision.ts`), que sólo aceptan fragmentos ya codificados por la
// clase léxica que les toca: un id de la IR pasa por `idLocal`, un id del catálogo por `atomo`
// (identificador) o `texto` (comentario), un número por `entero`/`nombreDePin`/`flotante`/`numero`, un
// operador o un nivel por `palabra`. Interpolar un string crudo es un rechazo, no un descuido
// posible. Antes de H-02 todo esto era `l.push(\`…${dato}…\`)`: un salto de línea en un id
// terminaba el comentario y lo que seguía era código (evidencia `inyeccion-ids.out`).
//
// El texto fijo de cada línea es byte a byte el de antes: para un proyecto válido la salida no
// cambia (test D1 de `codegen-h02-inyeccion.test.mjs` y la comparación de evidencia/H02/determinismo).
// ════════════════════════════════════════════════════════════════════════════════════

/** Tablas cerradas del backend: lo que se emite es el valor de la tabla, el dato sólo elige. */
const OPERADORES: Readonly<Record<Comparador, string>> = Object.freeze({ ">": ">", "<": "<", ">=": ">=", "<=": "<=" })
const NIVELES: Readonly<Record<NivelDigital, string>> = Object.freeze({ HIGH: "HIGH", LOW: "LOW" })
const MODOS_DE_PIN: Readonly<Record<Lectura["modo"], string>> = Object.freeze({ INPUT_PULLUP: "INPUT_PULLUP" })

const compararBuses = (a: BusPlan, b: BusPlan) => compararPorComponente(a, b) || (a.protocolo < b.protocolo ? -1 : a.protocolo > b.protocolo ? 1 : 0)

function renderizarMain(
  proyecto: Proyecto,
  catalogoHash: string,
  placa: Placa,
  lecturasSinOrden: readonly LecturaPlan[],
  busesSinOrden: readonly BusPlan[],
  salidasSinOrden: readonly SalidaPlan[],
): { readonly texto: string; readonly mapa: MapaDelPrograma } {
  const lecturas = [...lecturasSinOrden].sort((a, b) => compararIdsLocales(a.sensor, b.sensor) || (a.capacidad < b.capacidad ? -1 : a.capacidad > b.capacidad ? 1 : 0))
  const nivel = lecturas.filter((x): x is LecturaNivelPlan => x.kind === "nivel")
  const buses = [...busesSinOrden].sort(compararBuses)
  const salidas = [...salidasSinOrden].sort((a, b) => compararIdsLocales(a.actuador, b.actuador))
  const pinesPorClave = new Map<string, PinPlan>()
  for (const p of [...lecturas.map((l) => l.pin), ...salidas.map((s) => s.pin)]) pinesPorClave.set(`${p.componente}\u0000${p.terminal}`, p)
  const pines = [...pinesPorClave.values()].sort(compararPorComponente)
  const drivers = [...new Map(buses.map((b) => [b.protocolo, b.backend] as const)).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  // ── Nombres: un registro por programa; cada identificador sale de acá ──
  const nombres = crearNombres()
  const componente = (id: string) => idLocal("cmp", id, "componente.id")
  const regla = (id: string) => idLocal("beh", id, "comportamiento.id")
  const partesDePin = (p: { readonly componente: string; readonly terminal: string }) => [componente(p.componente), atomo(p.terminal, "terminal")]
  const partesDeLectura = (l: LecturaPlan) => [componente(l.sensor), atomo(l.capacidad, "capacidad")]
  const constanteDePin = (p: PinPlan) => nombres.identificador("pin", "PIN_", partesDePin(p), { mayusculas: true })
  const variableDeLectura = (l: LecturaPlan) => nombres.identificador("lectura", "", partesDeLectura(l))
  const funcionDeLectura = (l: LecturaPlan) => nombres.identificador("funcion-de-lectura", "leer_", partesDeLectura(l))
  const validezDeLectura = (l: LecturaPlan) => nombres.identificador("validez-de-lectura", "valida_", partesDeLectura(l))
  const esperaDeBus = (b: BusPlan) => nombres.identificador("espera-de-bus", "ESPERA_MS_", partesDePin(b), { mayusculas: true })
  const periodoDeBus = (b: BusPlan) => nombres.identificador("periodo-de-bus", "PERIODO_MS_", partesDePin(b), { mayusculas: true })
  const datosDeBus = (b: BusPlan) => nombres.identificador("datos-de-bus", "datos_", partesDePin(b))
  const validezDeBus = (b: BusPlan) => nombres.identificador("validez-de-bus", "valida_", partesDePin(b))
  const intentadaDeBus = (b: BusPlan) => nombres.identificador("intentada-de-bus", "intentada_", partesDePin(b))
  const ultimoIntentoDeBus = (b: BusPlan) => nombres.identificador("ultimo-intento-de-bus", "ultimo_intento_", partesDePin(b))
  const activaDeRegla = (s: SalidaPlan) => nombres.identificador("regla", "", [regla(s.regla)])

  const valorDePin = (p: PinPlan) => nombreDePin(p.arduino, "pin.numero")
  const operador = (s: SalidaPlan) => palabra(s.comparador, OPERADORES, "cuando.comparador")
  const nivelDe = (valor: NivelDigital, campo: string) => palabra(valor, NIVELES, campo)

  /** La regla, como la lee una persona; si el umbral se convirtió, también el de la IR. */
  const reglaEnComentario = (s: SalidaPlan) => {
    const id = regla(s.regla).dato
    const sensor = componente(s.lectura.sensor).dato
    const capacidad = texto(s.lectura.capacidad, "capacidad")
    const comparador = texto(operador(s).texto, "cuando.comparador")
    const umbral = numero(s.umbral, "umbral")
    const unidad = texto(s.unidad, "umbral.unidad")
    const actuador = componente(s.actuador).dato
    const accion = texto(s.accion, "entonces.accion")
    const reposo = texto(s.reposo, "reposo")
    if (s.umbralIR.unidad === s.unidad) return comentario`  ${id}: ${sensor}.${capacidad} ${comparador} ${umbral} ${unidad} -> ${actuador} ${accion} (reposo: ${reposo})`
    const umbralIR = numero(s.umbralIR.valor, "cuando.umbral.valor")
    const unidadIR = texto(s.umbralIR.unidad, "cuando.umbral.unidad")
    return comentario`  ${id}: ${sensor}.${capacidad} ${comparador} ${umbral} ${unidad} (en la IR: ${umbralIR} ${unidadIR}) -> ${actuador} ${accion} (reposo: ${reposo})`
  }

  const l: Linea[] = []
  l.push(cpp`${comentario`Generado por Tecnia Bot (codegen) desde la IR del proyecto. No editar: se regenera desde el proyecto.`}`)
  l.push(
    cpp`${comentario`proyecto: ${texto(proyecto.id, "proyecto.id")} | revision: ${numero(proyecto.revision, "proyecto.revision")} | catalogo: ${texto(catalogoHash, "catalogo.hash")} | placa: ${texto(placa.id, "placa.id")}`}`,
  )
  if (salidas.length > 0) {
    l.push(cpp`${comentario``}`)
    l.push(cpp`${comentario`Reglas de nivel: mientras la condicion vale, el actuador esta en el estado objetivo; si no, en su reposo.`}`)
    for (const s of salidas) l.push(cpp`${reglaEnComentario(s)}`)
  }
  if (buses.length > 0) {
    l.push(cpp`${comentario`Lecturas por protocolo: sin una lectura valida (antes de la primera, o si el ultimo intento fallo)`}`)
    l.push(cpp`${comentario`la condicion no se cumple y el actuador queda en su reposo.`}`)
  }
  l.push(cpp``)
  l.push(cpp`#include <Arduino.h>`)
  if (pines.length > 0) {
    l.push(cpp``)
    for (const p of pines) {
      const detalle = comentario`${componente(p.componente).dato} (${texto(p.tipo, "componente.tipo")}).${texto(p.terminal, "terminal")} -> ${texto(p.pin, "pin")}`
      l.push(cpp`static const uint8_t ${constanteDePin(p)} = ${valorDePin(p)};  ${detalle}`)
    }
  }
  for (const [protocolo, backend] of drivers) {
    l.push(cpp``)
    for (const linea of backend.driver) l.push(lineaDeBackend(linea, `backend[${protocolo}].driver`))
  }
  for (const b of buses) {
    const detalle = comentario`${componente(b.componente).dato}.${texto(b.terminal, "terminal")}: protocolo ${texto(b.protocolo, "protocolo")}. Component Knowledge: espera tras el encendido ${numero(b.declarado.espera, "esperaTrasEncendido")} s, periodo minimo ${numero(b.declarado.periodo, "periodoMinimo")} s.`
    l.push(cpp``)
    l.push(cpp`${detalle}`)
    l.push(cpp`static const uint32_t ${esperaDeBus(b)} = ${entero(b.esperaMs, "esperaTrasEncendido (ms)", { max: UINT32_MAX })};`)
    l.push(cpp`static const uint32_t ${periodoDeBus(b)} = ${entero(b.periodoMs, "periodoMinimo (ms)", { max: UINT32_MAX })};`)
    l.push(cpp`static uint8_t ${datosDeBus(b)}[${entero(b.backend.bytes, "backend.bytes", { min: 1, max: UINT8_MAX })}];`)
    l.push(cpp`static bool ${validezDeBus(b)} = false;`)
    l.push(cpp`static bool ${intentadaDeBus(b)} = false;`)
    l.push(cpp`static uint32_t ${ultimoIntentoDeBus(b)} = 0;`)
  }
  for (const lectura of nivel) {
    l.push(cpp``)
    l.push(cpp`static float ${funcionDeLectura(lectura)}() {`)
    l.push(cpp`  return digitalRead(${constanteDePin(lectura.pin)}) == ${nivelDe(lectura.lectura.nivelVerdadero, "lectura.nivelVerdadero")} ? 1.0f : 0.0f;`)
    l.push(cpp`}`)
  }
  // ── Mapa: el número de cada línea se anota al escribirla (`l.length` es el de la última). ──
  const pasos: PasoDeInicio[] = []
  const reglasEnElLoop: { regla: string; lineas: RangoDeLineas }[] = []
  l.push(cpp``)
  l.push(cpp`void setup() {`)
  const setupDesde = l.length
  for (const lectura of nivel) {
    l.push(cpp`  pinMode(${constanteDePin(lectura.pin)}, ${palabra(lectura.lectura.modo, MODOS_DE_PIN, "lectura.modo")});`)
    pasos.push({ papel: "entrada", componente: lectura.pin.componente, pin: lectura.pin.pin, lineas: { desde: l.length, hasta: l.length } })
  }
  for (const b of buses) {
    l.push(cpp`  pinMode(${constanteDePin(b.pin)}, INPUT_PULLUP);  ${comentario`${texto(b.protocolo, "protocolo")}: bus suelto (en reposo queda en alto)`}`)
    pasos.push({ papel: "bus", componente: b.pin.componente, pin: b.pin.pin, lineas: { desde: l.length, hasta: l.length } })
  }
  for (const s of salidas) {
    l.push(cpp`  pinMode(${constanteDePin(s.pin)}, OUTPUT);`)
    const desde = l.length
    l.push(cpp`  digitalWrite(${constanteDePin(s.pin)}, ${nivelDe(s.nivelReposo, "nivelReposo")});  ${comentario`${componente(s.actuador).dato} arranca en reposo (${texto(s.reposo, "reposo")})`}`)
    pasos.push({ papel: "salida", componente: s.pin.componente, pin: s.pin.pin, reposo: s.reposo, lineas: { desde, hasta: l.length } })
  }
  l.push(cpp`}`)
  const setupHasta = l.length
  l.push(cpp``)
  l.push(cpp`void loop() {`)
  const loopDesde = l.length
  if (buses.length > 0) l.push(cpp`  const uint32_t ahora = millis();`)
  for (const b of buses) {
    l.push(cpp`  ${comentario`${componente(b.componente).dato}.${texto(b.terminal, "terminal")}: el primer intento despues de la espera tras el encendido; despues, uno por periodo.`}`)
    l.push(cpp`  if (${intentadaDeBus(b)} ? ahora - ${ultimoIntentoDeBus(b)} >= ${periodoDeBus(b)} : ahora >= ${esperaDeBus(b)}) {`)
    l.push(cpp`    ${intentadaDeBus(b)} = true;`)
    l.push(cpp`    ${ultimoIntentoDeBus(b)} = ahora;`)
    l.push(cpp`    ${validezDeBus(b)} = ${nombres.deBackend(b.backend.funcion, "backend.funcion")}(${constanteDePin(b.pin)}, ${datosDeBus(b)});`)
    l.push(cpp`  }`)
  }
  for (const lectura of lecturas) {
    if (lectura.kind === "nivel") l.push(cpp`  const float ${variableDeLectura(lectura)} = ${funcionDeLectura(lectura)}();`)
    else {
      const datos = datosDeBus(lectura.bus)
      l.push(cpp`  const bool ${validezDeLectura(lectura)} = ${validezDeBus(lectura.bus)};`)
      l.push(cpp`  const float ${variableDeLectura(lectura)} = ${expresionDeBackend(lectura.campo.expresion(datos.texto), "backend.campo.expresion")};`)
    }
  }
  for (const s of salidas) {
    const activa = activaDeRegla(s)
    const umbral = flotante(s.umbral, "umbral")
    l.push(cpp``)
    l.push(cpp`  ${comentario`${regla(s.regla).dato} -> ${componente(s.actuador).dato}`}`)
    const reglaDesde = l.length
    if (s.lectura.kind === "protocolo") l.push(cpp`  const bool ${activa} = ${validezDeLectura(s.lectura)} && ${variableDeLectura(s.lectura)} ${operador(s)} ${umbral};`)
    else l.push(cpp`  const bool ${activa} = ${variableDeLectura(s.lectura)} ${operador(s)} ${umbral};`)
    l.push(cpp`  digitalWrite(${constanteDePin(s.pin)}, ${activa} ? ${nivelDe(s.nivelObjetivo, "nivelObjetivo")} : ${nivelDe(s.nivelReposo, "nivelReposo")});`)
    reglasEnElLoop.push({ regla: s.regla, lineas: { desde: reglaDesde, hasta: l.length } })
  }
  l.push(cpp`}`)
  const loopHasta = l.length
  l.push(cpp``)
  const congelar = (r: RangoDeLineas): RangoDeLineas => Object.freeze({ desde: r.desde, hasta: r.hasta })
  const mapa: MapaDelPrograma = Object.freeze({
    alIniciar: Object.freeze({ lineas: congelar({ desde: setupDesde, hasta: setupHasta }), pasos: Object.freeze(pasos.map((p) => Object.freeze({ ...p, lineas: congelar(p.lineas) }))) }),
    porSiempre: Object.freeze({ lineas: congelar({ desde: loopDesde, hasta: loopHasta }) }),
    reglas: Object.freeze(reglasEnElLoop.map((r) => Object.freeze({ regla: r.regla, lineas: congelar(r.lineas) }))),
  })
  return { texto: unirLineas(l), mapa }
}
