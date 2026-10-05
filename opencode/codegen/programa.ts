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

import type { Comparador, Componente, Proyecto } from "../nucleo/ir.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import type { Capacidad } from "../nucleo/catalogo.ts"
import type { Placa } from "../nucleo/placas.ts"
import { complementoDeAccion } from "../nucleo/catalogo.ts"
import { derivarReadiness, validarProyecto } from "../nucleo/validar.ts"
import { compararIdsLocales } from "../nucleo/id.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { admitirComponente, admitirPlaca, compatibilidadRevisada, REVISIONES_DEL_ANEXO, type RevisionesElectricas } from "../conocimiento/admision.ts"
import { derivarEscritura, derivarLectura, nombreDePinArduino, type Lectura, type NivelDigital } from "./derivaciones.ts"
import { renderizarPlatformioIni } from "./platformio-ini.ts"

export type CodigoErrorCodegen =
  | "CODEGEN_PROYECTO_NO_LISTO"
  | "CODEGEN_NO_ADMITIDO"
  | "CODEGEN_SIN_LECTURA"
  | "CODEGEN_SIN_ESCRITURA"
  | "CODEGEN_REPOSO_NO_DECLARADO"
  | "CODEGEN_PIN_NO_DERIVABLE"
  | "CODEGEN_UMBRAL_NO_CONVERTIBLE"
  | "CODEGEN_CONVERSION_NO_MONOTONA"

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

interface LecturaPlan {
  readonly sensor: string
  readonly capacidad: string
  readonly pin: PinPlan
  readonly lectura: Lectura
}

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
  const salidas: SalidaPlan[] = []
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
      const derivada = derivarLectura(catSensor, capacidad)
      if (!derivada) return falla("CODEGEN_SIN_LECTURA", { comportamiento: regla.id, componente: sensor.id, tipo: sensor.tipo, capacidad: capacidad.id })
      const pin = pinDe(sensor, derivada.terminal, placa)
      if (!pin) return falla("CODEGEN_PIN_NO_DERIVABLE", { componente: sensor.id, terminal: derivada.terminal, pin: sensor.pines[derivada.terminal] ?? null, placa: placa.id })
      lectura = { sensor: sensor.id, capacidad: capacidad.id, pin, lectura: derivada }
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
  const mainCpp = renderizarMain(proyecto, catalogo.hash, placa, [...lecturas.values()], salidas)
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

function renderizarMain(proyecto: Proyecto, catalogoHash: string, placa: Placa, lecturasSinOrden: readonly LecturaPlan[], salidasSinOrden: readonly SalidaPlan[]): string {
  const lecturas = [...lecturasSinOrden].sort((a, b) => compararIdsLocales(a.sensor, b.sensor) || (a.capacidad < b.capacidad ? -1 : a.capacidad > b.capacidad ? 1 : 0))
  const salidas = [...salidasSinOrden].sort((a, b) => compararIdsLocales(a.actuador, b.actuador))
  const pinesPorClave = new Map<string, PinPlan>()
  for (const p of [...lecturas.map((l) => l.pin), ...salidas.map((s) => s.pin)]) pinesPorClave.set(`${p.componente}\u0000${p.terminal}`, p)
  const pines = [...pinesPorClave.values()].sort(compararPorComponente)

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
  l.push("")
  l.push("#include <Arduino.h>")
  if (pines.length > 0) {
    l.push("")
    for (const p of pines) l.push(`static const uint8_t ${constanteDePin(p)} = ${p.nombreArduino};  // ${p.componente} (${p.tipo}).${p.terminal} -> ${p.pin}`)
  }
  for (const lectura of lecturas) {
    l.push("")
    l.push(`static float ${funcionDeLectura(lectura)}() {`)
    l.push(`  return digitalRead(${constanteDePin(lectura.pin)}) == ${lectura.lectura.nivelVerdadero} ? 1.0f : 0.0f;`)
    l.push("}")
  }
  l.push("")
  l.push("void setup() {")
  for (const lectura of lecturas) l.push(`  pinMode(${constanteDePin(lectura.pin)}, ${lectura.lectura.modo});`)
  for (const s of salidas) {
    l.push(`  pinMode(${constanteDePin(s.pin)}, OUTPUT);`)
    l.push(`  digitalWrite(${constanteDePin(s.pin)}, ${s.nivelReposo});  // ${s.actuador} arranca en reposo (${s.reposo})`)
  }
  l.push("}")
  l.push("")
  l.push("void loop() {")
  for (const lectura of lecturas) l.push(`  const float ${variableDeLectura(lectura)} = ${funcionDeLectura(lectura)}();`)
  for (const s of salidas) {
    const activa = identificador(s.regla)
    l.push("")
    l.push(`  // ${s.regla} -> ${s.actuador}`)
    l.push(`  const bool ${activa} = ${variableDeLectura(s.lectura)} ${s.comparador} ${literalFloat(s.umbral)};`)
    l.push(`  digitalWrite(${constanteDePin(s.pin)}, ${activa} ? ${s.nivelObjetivo} : ${s.nivelReposo});`)
  }
  l.push("}")
  l.push("")
  return l.join("\n")
}
