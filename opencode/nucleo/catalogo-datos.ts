// Contenido mínimo shippeado del catálogo — Gate 3.
//
// Puro, declarativo, sin I/O. Cada componente cita su evidencia de `circuito.ts`
// (mismo criterio que `placas.ts`, Gate 1): un dato de hardware que no está en el
// código real de hoy no se inventa acá. `REGISTRO_PLACAS` se REFERENCIA desde
// `placas.ts` (Gate 1), nunca se redefine.

import type { ComponenteDatos, ConversionUnidad, LecturaDeCapacidad } from "./catalogo.ts"
import { REGISTRO_PLACAS } from "./placas.ts"

export const PLACAS_CATALOGO_MINIMO = Object.values(REGISTRO_PLACAS)

// ── LED ────────────────────────────────────────────────────────────────────────────
// circuito.ts:947-975 (`COMPONENTES.led`): ánodo digital (con resistencia serie),
// cátodo a GND fijo. Requiere 220Ω en serie (circuito.ts:972-973, "sin la resistencia
// el LED se destruye"). Nombre visible y conceptos: anexo de pedagogía (D-10).
export const LED: ComponenteDatos = {
  id: "led",
  clase: "actuador",
  terminales: [
    { id: "anodo", rol: "anodo", electrica: "digital", direccion: "salida" },
    { id: "catodo", rol: "catodo", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [],
  requisitos: [{ tipo: "resistencia-serie", enTerminal: "anodo", spec: { tipoComponente: "resistencia", valor: { valor: 220, unidad: "ohm", magnitud: "resistencia" } } }],
  // D-11 (Decision Freeze): las acciones que ESTE actuador ofrece, como dato.
  acciones: ["encender", "apagar"],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── resistencia ────────────────────────────────────────────────────────────────────
// Pasivo auxiliar, generado por el requisito "resistencia-serie" del LED (nunca se
// agrega manualmente por su cuenta en Fase 1 — igual que hoy circuito.ts la dibuja
// "en el medio del cable", circuito.ts:117). Dos terminales sin rol fijo: es un
// puente, no tiene polaridad.
export const RESISTENCIA: ComponenteDatos = {
  id: "resistencia",
  clase: "pasivo",
  terminales: [
    { id: "a", rol: "senal", electrica: "riel-fijo" },
    { id: "b", rol: "senal", electrica: "riel-fijo" },
  ],
  capacidades: [],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── pulsador ────────────────────────────────────────────────────────────────────────
// circuito.ts:1089-1105 (`COMPONENTES.boton`): INPUT_PULLUP, sin resistencia externa
// ("no hace falta ninguna resistencia externa", circuito.ts:1104) — por eso
// `requisitos: []`. Capacidad "estadoBooleano" para que un `ComportamientoRegla`
// pueda leer "presionado"/"no presionado" (mismo id de tipo que usa `skills/` —
// T_diseno_consolidado.md §0, `pushbutton`→`pulsador`).
export const PULSADOR: ComponenteDatos = {
  id: "pulsador",
  clase: "entrada",
  terminales: [
    // requierePullUpInterno (D5/H-4=A, PHASE_2_SLICE_1_HARDENING_DESIGN.md §1-2):
    // el pulsador se cablea SIN resistencia externa porque usa el pull-up interno
    // del pin (INPUT_PULLUP, circuito.ts:1104) — un pin `soloEntrada` (GPIO34/35/
    // 36/39) NO tiene pull-up/pull-down real (circuito.ts:339-343), así que ahí el
    // pulsador nunca va a leer bien. `evaluarRestriccionesPin` (catalogo.ts) combina
    // este dato con `RegistroPin.restricciones` para emitir `PIN_SIN_PULLUP_INTERNO`.
    { id: "senal", rol: "senal", electrica: "digital", direccion: "entrada", requierePullUpInterno: true },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [{ id: "estadoBooleano", magnitud: "estadoBooleano", unidad: "ninguna" }],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── dht22 ───────────────────────────────────────────────────────────────────────────
// circuito.ts:1040-1051 (`COMPONENTES.dht22`): VCC a VLOGICA, DATA digital, GND fijo.
// Rango de temperatura OBSERVED en `SENSOR_SIM.dht22` (circuito.ts:1851): 0-60°C.
// Rango de humedad: el hardware real del DHT22 mide 0-100% RH (INFERRED — circuito.ts
// no simula humedad hoy, `SENSOR_SIM` sólo tiene la rama de temperatura; se documenta
// como inferencia razonable, no como dato leído del código).
//
// CK-CG1 (revisión eléctrica humana de Alejandro Palestrini, 2026-10-06; fuente primaria: Aosong,
// Manual AM2302 v1.1). Modelo pedagógico: DHT22/AM2302 representado por VCC, DATA y GND.
// - DATA es BIDIRECCIONAL: el microcontrolador lleva el bus a bajo ≥ 800 µs para iniciar cada
//   lectura (§7.4 paso 2), así que pide un pin con entrada Y salida digital.
// - El bus requiere un pull-up a VCC (§7.2): `pullUpExterno`. Tecnia Bot NO verifica que esté
//   montado ni su valor (deuda DHT-PULLUP-01).
// - Temperatura y humedad llegan por el mismo protocolo (`LECTURA_DHT22`): intervalo mínimo
//   2 s (§7.1 nota 3) y espera de 2 s tras el encendido (§7.4 paso 1).
// - Deuda H-01: el rango 0-60 °C de abajo (heredado de `SENSOR_SIM`) difiere del fabricante
//   (−40-80 °C); no se corrige acá.
const LECTURA_DHT22: LecturaDeCapacidad = {
  terminal: "senal",
  mecanismo: "protocolo",
  protocolo: "bus-unico-am2302",
  periodoMinimo: { valor: 2, unidad: "segundo", magnitud: "tiempo" },
  esperaTrasEncendido: { valor: 2, unidad: "segundo", magnitud: "tiempo" },
}

export const DHT22: ComponenteDatos = {
  id: "dht22",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "digital", direccion: "bidireccional", pullUpExterno: true },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 60, unidad: "celsius", magnitud: "temperatura" } },
      lectura: LECTURA_DHT22,
    },
    {
      id: "humedad",
      magnitud: "humedad",
      unidad: "porcentaje",
      rango: { min: { valor: 0, unidad: "porcentaje", magnitud: "humedad" }, max: { valor: 100, unidad: "porcentaje", magnitud: "humedad" } },
      lectura: LECTURA_DHT22,
    },
  ],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── dht11 ───────────────────────────────────────────────────────────────────────────
// CK-CG2 (revisión eléctrica humana de Alejandro Palestrini, 2026-10-12; fuentes primarias: Aosong,
// DHT11 Product Manual V1.3 (2017-03-31) y DFRobot, esquemático DFR0067 Revision V2). Modelo
// pedagógico: el MÓDULO DFRobot Gravity DHT11 de tres cables (SKU DFR0067), representado por VCC,
// DATA y GND. Mismo molde que el DHT22; lo que lo distingue es el protocolo y los números:
// - DATA es BIDIRECCIONAL: el microcontrolador lleva el bus a bajo al menos 18 ms para iniciar
//   cada lectura, así que pide un pin con entrada Y salida digital (GPIO34-39 no sirven).
// - El bus requiere un pull-up a VCC: `pullUpExterno` (el módulo trae R1 según el esquemático; el
//   Engine NO lo verifica: deuda DHT-PULLUP-02, hermana de DHT-PULLUP-01).
// - Protocolo `bus-unico-dht11` (`registros/vocabulario.ts`): no es una variante del AM2302, y
//   hasta Codegen S2b no tiene backend: el DHT11 queda NO GENERABLE (CODEGEN_PROTOCOLO_SIN_BACKEND).
// - Intervalo mínimo entre lecturas: el manual V1.3 dice «> 2 s» (estrictamente mayor). Se
//   declara 3 s, el entero más chico que lo cumple con margen; la revisión eléctrica aprobada
//   dice «2 s» y lleva un addendum explícito con esta resolución (no se corrigió en silencio).
//   Espera tras el encendido: 1 s (V1.3).
// - Rango declarado 0-50 °C / 20-90 %RH: lo que DFRobot garantiza para el módulo y el mínimo
//   común de las revisiones del chip (la V1.3 indica −20-60 °C / 5-95 %RH): deuda DHT11-RANGO-01.
//   Resolución 1 °C / 1 %RH (bytes enteros; informativa, no bloquea umbrales).
const LECTURA_DHT11: LecturaDeCapacidad = {
  terminal: "senal",
  mecanismo: "protocolo",
  protocolo: "bus-unico-dht11",
  periodoMinimo: { valor: 3, unidad: "segundo", magnitud: "tiempo" },
  esperaTrasEncendido: { valor: 1, unidad: "segundo", magnitud: "tiempo" },
}

export const DHT11: ComponenteDatos = {
  id: "dht11",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "digital", direccion: "bidireccional", pullUpExterno: true },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 50, unidad: "celsius", magnitud: "temperatura" } },
      resolucion: { valor: 1, unidad: "celsius", magnitud: "temperatura" },
      lectura: LECTURA_DHT11,
    },
    {
      id: "humedad",
      magnitud: "humedad",
      unidad: "porcentaje",
      rango: { min: { valor: 20, unidad: "porcentaje", magnitud: "humedad" }, max: { valor: 90, unidad: "porcentaje", magnitud: "humedad" } },
      resolucion: { valor: 1, unidad: "porcentaje", magnitud: "humedad" },
      lectura: LECTURA_DHT11,
    },
  ],
  requisitos: [],
  // La validez eléctrica por placa sale de la revisión por par, no de esta lista (ver `INTERRUPTOR`).
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── ntc ─────────────────────────────────────────────────────────────────────────────
// circuito.ts:1312-1320 (`COMPONENTES.ntc`): VCC a VLOGICA, salida ANALÓGICA, GND
// fijo. Rango OBSERVED en `SENSOR_SIM.ntc` (circuito.ts:1852): 0-60°C, mismo valor que
// el DHT22 — sólo mide temperatura (sin humedad): es justo lo que ejercita la rama D
// de `reemplazarSensor` (dht22→ntc pidiendo humedad → incompatible).
export const NTC: ComponenteDatos = {
  id: "ntc",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 60, unidad: "celsius", magnitud: "temperatura" } },
    },
  ],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── interruptor ─────────────────────────────────────────────────────────────────────
// Component Knowledge D0 (canario "sólo datos"): un contacto de estado MANTENIDO (queda
// abierto o cerrado hasta que lo vuelvan a mover), a diferencia del pulsador, que es
// MOMENTÁNEO. Para el núcleo los dos son la misma forma: una entrada binaria leída con el
// pull-up interno del pin. La diferencia (mantenido vs. momentáneo) es pedagógica y de
// representación: hoy ningún evaluador la consume, así que no entra al núcleo (anexo de
// pedagogía + evidencia, `component-knowledge/20_D0_IMPLEMENTATION_REPORT.md`).
//
// Modelo eléctrico (ESP32): `senal` a un GPIO configurado con pull-up interno (≈45 kΩ
// típ., ESP32 Series Datasheet v5.3, Tabla 5-3); `gnd` a la masa de la placa. Contacto
// abierto → el pull-up deja el pin en ALTO; contacto cerrado → el pin queda en BAJO. Un pin
// solo-entrada (GPIO34-39) no tiene pull-up interno (datasheet, apéndice IO_MUX), y eso lo
// diagnostica `PIN_SIN_PULLUP_INTERNO` a partir de `requierePullUpInterno`, sin ninguna
// regla nueva. Corriente por el contacto cerrado ≈ 3,3 V / 45 kΩ ≈ 73 µA (inferido), muy
// por debajo del rating típico de un interruptor deslizante (100 mA @ 12 V DC, C&K OS102011MS2QN1).
//
// Capacidad: la MISMA `estadoBooleano` del pulsador, con el mismo significado: verdadero =
// contacto cerrado. Los rótulos para el alumno ("cerrado"/"abierto") viven en el anexo de
// pedagogía; la tríada canónica es la de `estado-booleano.ts` (no se redefine acá).
export const INTERRUPTOR: ComponenteDatos = {
  id: "interruptor",
  clase: "entrada",
  terminales: [
    { id: "senal", rol: "senal", electrica: "digital", direccion: "entrada", requierePullUpInterno: true },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [{ id: "estadoBooleano", magnitud: "estadoBooleano", unidad: "ninguna" }],
  requisitos: [],
  // Placas existentes en el catálogo. La validez eléctrica por placa NO sale de esta lista:
  // sale de la revisión humana por par (componente, placa) en `conocimiento/anexos/revision-electrica.ts`.
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

export const COMPONENTES_CATALOGO_MINIMO: readonly ComponenteDatos[] = [LED, RESISTENCIA, PULSADOR, DHT22, NTC, INTERRUPTOR, DHT11]

// Sólo °C↔°F (T_diseno_consolidado.md §4.1: "unidades? ... sólo °C↔°F"). Ningún
// componente shippeado usa Fahrenheit hoy — esta conversión existe para que la rama B
// de `reemplazarSensor` sea demostrable con datos reales de conversión, aunque el
// sensor que la ejercita (`sensor-temp-f`) es un fixture de TEST, no de catálogo
// shippeado (T_diseno_consolidado.md §4.3).
export const CONVERSIONES_UNIDAD_MINIMAS: readonly ConversionUnidad[] = [
  { de: "celsius", a: "fahrenheit", magnitud: "temperatura", factor: 1.8, offset: 32 },
  { de: "fahrenheit", a: "celsius", magnitud: "temperatura", factor: 5 / 9, offset: -32 * (5 / 9) },
]

// 2.0.0 — Component System Foundation #1: cambio único y coordinado del dominio de
// identidad (hash semántico sin presentación, terminales de potencia, `asignable`
// derivado, requisito con `Cantidad`, acciones declaradas). Ver `identidad-catalogo.ts`.
// 2.1.0 — Semantic Vertical #3: `DEFINICIONES_ACCION` declara la relación complementaria
// encender ↔ apagar (de ella se deriva el reposo de una regla de nivel). Cambia el
// significado de una regla con `apagar`: los proyectos creados con 2.0.0 lo muestran con
// `CATALOGO_CAMBIO_DETECTADO` (no se migran, `createdWith` no se reescribe).
// 2.2.0 — Component Knowledge D0: se agrega `interruptor` (cambio MENOR: se suma un tipo sin
// cambiar el significado de los existentes). Los proyectos creados con 2.1.0 lo ven con
// `CATALOGO_CAMBIO_DETECTADO` (informativo; `createdWith` no se reescribe ni se migra).
// 2.3.0 — CK-CG1: `Capacidad.lectura` (cómo se obtiene la capacidad: protocolo, intervalo mínimo,
// espera tras el encendido), registro de protocolos en el hash, `pullUpExterno`, DATA del DHT22
// bidireccional y GPIO12 con `strappingVddSdio`. Cambio MENOR, mismo criterio que 2.1.0: cambia
// el significado de piezas existentes (el DHT22 en GPIO34-39 o GPIO12 deja de estar listo); los
// proyectos 2.2.0 lo ven con `CATALOGO_CAMBIO_DETECTADO` (informativo; `createdWith` no se reescribe).
// 2.4.0 — CK-CG2: se agrega `dht11` (módulo DFRobot Gravity) con el protocolo `bus-unico-dht11` en el
// registro. Cambio MENOR, mismo criterio que 2.2.0: se suma un tipo sin cambiar el significado de los
// existentes; el hash cambia porque el registro de protocolos entra al hash. Los proyectos 2.3.0 lo
// ven con `CATALOGO_CAMBIO_DETECTADO` (informativo; `createdWith` no se reescribe ni se migra).
export const VERSION_CATALOGO_MINIMO = "2.4.0"
