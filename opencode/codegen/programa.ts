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
import type { Cantidad, Capacidad } from "../nucleo/catalogo.ts"
import type { Placa } from "../nucleo/placas.ts"
import { complementoDeAccion } from "../nucleo/catalogo.ts"
import { derivarReadiness, validarProyecto } from "../nucleo/validar.ts"
import { compararIdsLocales } from "../nucleo/id.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { admitirComponente, admitirPlaca, compatibilidadRevisada, REVISIONES_DEL_ANEXO, type RevisionesElectricas } from "../conocimiento/admision.ts"
import { derivarEscritura, derivarLectura, nombreDePinArduino, type Lectura, type NivelDigital } from "./derivaciones.ts"
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

export interface ErrorCodegen {
  readonly codigo: CodigoErrorCodegen
  readonly datos: Readonly<Record<string, unknown>>
}

export interface ArchivosGenerados {
  readonly "platformio.ini": string
  readonly "src/main.cpp": string
}

export type ResultadoGeneracion =
  | { readonly ok: true; readonly archivos: ArchivosGenerados; readonly environment: string; readonly advertencias: readonly Motivo[] }
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
  readonly nombreArduino: string
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
  /** Los tiempos tal como los declara Component Knowledge, en UCUM (para el comentario del programa). */
  readonly declarado: { readonly espera: string; readonly periodo: string }
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
  const nombreArduino = registro ? nombreDePinArduino(registro) : undefined
  if (pin === null || pin === undefined || nombreArduino === undefined) return undefined
  return { componente: componente.id, tipo: componente.tipo, terminal, pin, nombreArduino }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Generación
// ════════════════════════════════════════════════════════════════════════════════════

export function generarPrograma(proyecto: Proyecto, conocimiento: ComponentKnowledge, opciones: OpcionesGeneracion = {}): ResultadoGeneracion {
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

  // ── 2. admisión eléctrica ──
  const noAdmitidos: { readonly kind: "placa" | "componente"; readonly id: string; readonly problemas: readonly string[] }[] = []
  const informePlaca = admitirPlaca(conocimiento, placa.id, revisiones)
  if (!informePlaca.officiallySupported) noAdmitidos.push({ kind: "placa", id: placa.id, problemas: [...informePlaca.problemas] })
  for (const tipo of [...new Set(proyecto.componentes.map((c) => c.tipo))].sort()) {
    const informe = admitirComponente(conocimiento, tipo, revisiones)
    const revisadoParaLaPlaca = compatibilidadRevisada(tipo, placa.id, revisiones)
    const problemas = [...informe.problemas, ...(revisadoParaLaPlaca ? [] : [`electrico: sin revisión eléctrica humana para la placa "${placa.id}"`])]
    if (!informe.officiallySupported || !revisadoParaLaPlaca) noAdmitidos.push({ kind: "componente", id: tipo, problemas })
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
      const contexto = { comportamiento: regla.id, componente: sensor.id, tipo: sensor.tipo, capacidad: capacidad.id }
      const declarada = conocimiento.lecturaDeCapacidad(sensor.tipo, capacidad.id)
      if (declarada === undefined) {
        // Sin mecanismo declarado: por el nivel del pin, si la topología lo permite (Slice 1).
        const derivada = derivarLectura(catSensor, capacidad)
        if (!derivada) return falla("CODEGEN_SIN_LECTURA", contexto)
        const pin = pinDe(sensor, derivada.terminal, placa)
        if (!pin) return falla("CODEGEN_PIN_NO_DERIVABLE", { componente: sensor.id, terminal: derivada.terminal, pin: sensor.pines[derivada.terminal] ?? null, placa: placa.id })
        lectura = { kind: "nivel", sensor: sensor.id, capacidad: capacidad.id, pin, lectura: derivada }
      } else {
        // Mecanismo declarado: el backend lo elige el PROTOCOLO, no el tipo de componente.
        if (declarada.mecanismo !== "protocolo") return falla("CODEGEN_SIN_LECTURA", { ...contexto, mecanismo: declarada.mecanismo })
        const datosLectura = { ...contexto, protocolo: declarada.protocolo }
        const backend = backendDeProtocolo(backends, declarada.protocolo)
        if (!backend) return falla("CODEGEN_PROTOCOLO_SIN_BACKEND", datosLectura)
        const terminal = catSensor.terminales.find((t) => t.id === declarada.terminal)
        if (!terminal || !terminal.asignable || terminal.electrica !== backend.terminal.electrica || terminal.direccion !== backend.terminal.direccion)
          return falla("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "terminal", terminal: declarada.terminal })
        const ucum = capacidad.unidad === undefined ? undefined : conocimiento.unidad(capacidad.unidad)
        const campo = ucum?.ok ? backend.campos.find((c) => c.magnitud === capacidad.magnitud && c.ucum === ucum.valor.ucum) : undefined
        if (!campo) return falla("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "campo", magnitud: capacidad.magnitud ?? null, unidad: capacidad.unidad ?? null })
        const esperaMs = milisegundos(conocimiento, declarada.esperaTrasEncendido)
        const periodoMs = milisegundos(conocimiento, declarada.periodoMinimo)
        if (esperaMs === undefined || periodoMs === undefined || !declarada.esperaTrasEncendido || !declarada.periodoMinimo)
          return falla("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "tiempos", esperaTrasEncendido: declarada.esperaTrasEncendido ?? null, periodoMinimo: declarada.periodoMinimo ?? null })
        const pin = pinDe(sensor, terminal.id, placa)
        if (!pin) return falla("CODEGEN_PIN_NO_DERIVABLE", { componente: sensor.id, terminal: terminal.id, pin: sensor.pines[terminal.id] ?? null, placa: placa.id })
        const clave = claveBus(sensor.id, terminal.id, declarada.protocolo)
        let bus = buses.get(clave)
        if (!bus) {
          const declarado = { espera: `${declarada.esperaTrasEncendido.valor} s`, periodo: `${declarada.periodoMinimo.valor} s` }
          bus = { componente: sensor.id, terminal: terminal.id, protocolo: declarada.protocolo, backend, pin, esperaMs, periodoMs, declarado }
          buses.set(clave, bus)
        } else if (bus.esperaMs !== esperaMs || bus.periodoMs !== periodoMs) {
          // Dos capacidades del mismo bus con tiempos distintos: no hay un único horario que cumpla ambas.
          return falla("CODEGEN_LECTURA_INCOHERENTE", { ...datosLectura, causa: "tiempos", esperaTrasEncendido: declarada.esperaTrasEncendido, periodoMinimo: declarada.periodoMinimo })
        }
        lectura = { kind: "protocolo", sensor: sensor.id, capacidad: capacidad.id, pin, bus, campo }
      }
      lecturas.set(claveLectura(sensor.id, capacidad.id), lectura)
    }

    const reposo = complementoDeAccion(catActuador, entonces.accion)
    if (reposo === undefined) return falla("CODEGEN_REPOSO_NO_DECLARADO", { comportamiento: regla.id, componente: actuador.id, tipo: actuador.tipo, accion: entonces.accion })

    const escritura = derivarEscritura(catActuador)
    const nivelObjetivo = escritura?.nivelDe[entonces.accion]
    const nivelReposo = escritura?.nivelDe[reposo]
    if (!escritura || !nivelObjetivo || !nivelReposo) return falla("CODEGEN_SIN_ESCRITURA", { comportamiento: regla.id, componente: actuador.id, tipo: actuador.tipo, acciones: [entonces.accion, reposo] })
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
  const mainCpp = renderizarMain(proyecto, catalogo.hash, placa, [...lecturas.values()], [...buses.values()], salidas)
  return Object.freeze({
    ok: true as const,
    archivos: Object.freeze({ "platformio.ini": ini.contenido, "src/main.cpp": mainCpp }),
    environment: ini.environment,
    advertencias: Object.freeze(motivos.filter((m) => m.severidad === "warning")),
  })
}

// ════════════════════════════════════════════════════════════════════════════════════
// Render (orden canónico: por id de componente y terminal, nunca por orden de entrada)
// ════════════════════════════════════════════════════════════════════════════════════

const identificador = (texto: string) => texto.replace(/[^A-Za-z0-9]/g, "_")
const constanteDePin = (p: PinPlan) => `PIN_${identificador(p.componente)}_${identificador(p.terminal)}`.toUpperCase()
const variableDeLectura = (l: LecturaPlan) => `${identificador(l.sensor)}_${identificador(l.capacidad)}`
const funcionDeLectura = (l: LecturaPlan) => `leer_${variableDeLectura(l)}`

/** Literal `float` de C++ para un número finito (la IR ya rechaza los no finitos). */
function literalFloat(valor: number): string {
  const texto = String(valor)
  return /[.e]/.test(texto) ? `${texto}f` : `${texto}.0f`
}

const sufijoDeBus = (b: BusPlan) => `${identificador(b.componente)}_${identificador(b.terminal)}`
const compararBuses = (a: BusPlan, b: BusPlan) => compararPorComponente(a, b) || (a.protocolo < b.protocolo ? -1 : a.protocolo > b.protocolo ? 1 : 0)

function renderizarMain(
  proyecto: Proyecto,
  catalogoHash: string,
  placa: Placa,
  lecturasSinOrden: readonly LecturaPlan[],
  busesSinOrden: readonly BusPlan[],
  salidasSinOrden: readonly SalidaPlan[],
): string {
  const lecturas = [...lecturasSinOrden].sort((a, b) => compararIdsLocales(a.sensor, b.sensor) || (a.capacidad < b.capacidad ? -1 : a.capacidad > b.capacidad ? 1 : 0))
  const nivel = lecturas.filter((x): x is LecturaNivelPlan => x.kind === "nivel")
  const buses = [...busesSinOrden].sort(compararBuses)
  const salidas = [...salidasSinOrden].sort((a, b) => compararIdsLocales(a.actuador, b.actuador))
  const pinesPorClave = new Map<string, PinPlan>()
  for (const p of [...lecturas.map((l) => l.pin), ...salidas.map((s) => s.pin)]) pinesPorClave.set(`${p.componente}\u0000${p.terminal}`, p)
  const pines = [...pinesPorClave.values()].sort(compararPorComponente)
  const drivers = [...new Map(buses.map((b) => [b.protocolo, b.backend] as const)).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const condicion = (s: SalidaPlan) => {
    const conversion = s.umbralIR.unidad === s.unidad ? "" : ` (en la IR: ${s.umbralIR.valor} ${s.umbralIR.unidad})`
    return `${s.lectura.sensor}.${s.lectura.capacidad} ${s.comparador} ${s.umbral} ${s.unidad}${conversion}`
  }
  const l: string[] = []
  l.push("// Generado por Tecnia Bot (codegen) desde la IR del proyecto. No editar: se regenera desde el proyecto.")
  l.push(`// proyecto: ${proyecto.id} | revision: ${proyecto.revision} | catalogo: ${catalogoHash} | placa: ${placa.id}`)
  if (salidas.length > 0) {
    l.push("//")
    l.push("// Reglas de nivel: mientras la condicion vale, el actuador esta en el estado objetivo; si no, en su reposo.")
    for (const s of salidas) l.push(`//   ${s.regla}: ${condicion(s)} -> ${s.actuador} ${s.accion} (reposo: ${s.reposo})`)
  }
  if (buses.length > 0) {
    l.push("// Lecturas por protocolo: sin una lectura valida (antes de la primera, o si el ultimo intento fallo)")
    l.push("// la condicion no se cumple y el actuador queda en su reposo.")
  }
  l.push("")
  l.push("#include <Arduino.h>")
  if (pines.length > 0) {
    l.push("")
    for (const p of pines) l.push(`static const uint8_t ${constanteDePin(p)} = ${p.nombreArduino};  // ${p.componente} (${p.tipo}).${p.terminal} -> ${p.pin}`)
  }
  for (const [, backend] of drivers) {
    l.push("")
    l.push(...backend.driver)
  }
  for (const b of buses) {
    const x = sufijoDeBus(b)
    l.push("")
    l.push(`// ${b.componente}.${b.terminal}: protocolo ${b.protocolo}. Component Knowledge: espera tras el encendido ${b.declarado.espera}, periodo minimo ${b.declarado.periodo}.`)
    l.push(`static const uint32_t ESPERA_MS_${x.toUpperCase()} = ${b.esperaMs};`)
    l.push(`static const uint32_t PERIODO_MS_${x.toUpperCase()} = ${b.periodoMs};`)
    l.push(`static uint8_t datos_${x}[${b.backend.bytes}];`)
    l.push(`static bool valida_${x} = false;`)
    l.push(`static bool intentada_${x} = false;`)
    l.push(`static uint32_t ultimo_intento_${x} = 0;`)
  }
  for (const lectura of nivel) {
    l.push("")
    l.push(`static float ${funcionDeLectura(lectura)}() {`)
    l.push(`  return digitalRead(${constanteDePin(lectura.pin)}) == ${lectura.lectura.nivelVerdadero} ? 1.0f : 0.0f;`)
    l.push("}")
  }
  l.push("")
  l.push("void setup() {")
  for (const lectura of nivel) l.push(`  pinMode(${constanteDePin(lectura.pin)}, ${lectura.lectura.modo});`)
  for (const b of buses) l.push(`  pinMode(${constanteDePin(b.pin)}, INPUT_PULLUP);  // ${b.protocolo}: bus suelto (en reposo queda en alto)`)
  for (const s of salidas) {
    l.push(`  pinMode(${constanteDePin(s.pin)}, OUTPUT);`)
    l.push(`  digitalWrite(${constanteDePin(s.pin)}, ${s.nivelReposo});  // ${s.actuador} arranca en reposo (${s.reposo})`)
  }
  l.push("}")
  l.push("")
  l.push("void loop() {")
  if (buses.length > 0) l.push("  const uint32_t ahora = millis();")
  for (const b of buses) {
    const x = sufijoDeBus(b)
    l.push(`  // ${b.componente}.${b.terminal}: el primer intento despues de la espera tras el encendido; despues, uno por periodo.`)
    l.push(`  if (intentada_${x} ? ahora - ultimo_intento_${x} >= PERIODO_MS_${x.toUpperCase()} : ahora >= ESPERA_MS_${x.toUpperCase()}) {`)
    l.push(`    intentada_${x} = true;`)
    l.push(`    ultimo_intento_${x} = ahora;`)
    l.push(`    valida_${x} = ${b.backend.funcion}(${constanteDePin(b.pin)}, datos_${x});`)
    l.push("  }")
  }
  for (const lectura of lecturas) {
    if (lectura.kind === "nivel") l.push(`  const float ${variableDeLectura(lectura)} = ${funcionDeLectura(lectura)}();`)
    else {
      const x = sufijoDeBus(lectura.bus)
      l.push(`  const bool valida_${variableDeLectura(lectura)} = valida_${x};`)
      l.push(`  const float ${variableDeLectura(lectura)} = ${lectura.campo.expresion(`datos_${x}`)};`)
    }
  }
  for (const s of salidas) {
    const activa = identificador(s.regla)
    const valida = s.lectura.kind === "protocolo" ? `valida_${variableDeLectura(s.lectura)} && ` : ""
    l.push("")
    l.push(`  // ${s.regla} -> ${s.actuador}`)
    l.push(`  const bool ${activa} = ${valida}${variableDeLectura(s.lectura)} ${s.comparador} ${literalFloat(s.umbral)};`)
    l.push(`  digitalWrite(${constanteDePin(s.pin)}, ${activa} ? ${s.nivelObjetivo} : ${s.nivelReposo});`)
  }
  l.push("}")
  l.push("")
  return l.join("\n")
}
