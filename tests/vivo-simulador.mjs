// Runtime SIMULADO de referencia del Modo Vivo V1 — tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md.
//
// Es la implementación de referencia de la POLÍTICA (§5) y de las líneas canónicas (§3): el
// runtime real en C++ tiene que producir, ante las mismas líneas de entrada, exactamente las
// mismas líneas de salida (`CASOS_DORADOS`). No es "el" runtime: no tiene cable, ni reloj real,
// ni pines; los tests le fijan las entradas con `fijarEntrada`/`fijarAnalogico`.
//
// La política de pines se DERIVA del registro de placas (`nucleo/placas.ts`), que es la única
// autoridad; el runtime en C++ la lleva duplicada a propósito (la placa se defiende sola).

import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const { COMANDOS_V1, VERSION_PROTOCOLO, parsearLineaDeComando, serializarRespuesta, respuestaDeError } = await import(join(REPO, "opencode/vivo/protocolo.ts"))

export const RUNTIME_VERSION = "0.1.0"

/** Pines que el runtime rechaza SIEMPRE: flash (6–11) y UART0 (1, 3), el cable por el que habla el host. */
export function pinesProhibidos(placa) {
  return placa.pines.filter((p) => p.restricciones.includes("flashReservado") || p.restricciones.includes("uartUsb")).map((p) => p.numero)
}

/**
 * Crea un runtime simulado para `placa` (por defecto `esp32-devkit-v1`). `procesar(linea)` devuelve
 * la lista de líneas de salida (JSON canónico, sin `\n`). `arrancar()` devuelve lo que el runtime
 * emite solo al encender: `reinicio` y después `hola`.
 */
export function crearRuntimeSimulado({ placa = REGISTRO_PLACAS["esp32-devkit-v1"], causaDeReinicio = "encendido", reloj = () => 0, wifi = undefined } = {}) {
  const porNumero = new Map(placa.pines.map((p) => [p.numero, p]))
  const prohibidos = new Set(pinesProhibidos(placa))
  const modos = new Map() // pin → modo
  const salidas = new Map() // pin → "alto" | "bajo" | { pwm: porcentaje }
  const entradas = new Map() // pin → "alto" | "bajo" (lo que "hay" afuera)
  const analogicos = new Map() // pin → crudo

  const hola = () => ({ tipo: "hola", runtime: RUNTIME_VERSION, protocolo: VERSION_PROTOCOLO, placa: placa.id, comandos: [...COMANDOS_V1], protocolos: [], ...(wifi ? { wifi } : {}) })
  const error = (e) => serializarRespuesta(respuestaDeError(e))

  function validarPin(comando, pin, necesita) {
    const registro = porNumero.get(pin)
    if (!registro) return { codigo: "PIN_INEXISTENTE", comando, pin }
    if (prohibidos.has(pin)) return { codigo: "PIN_PROHIBIDO", comando, pin }
    if (necesita === "salida" && !registro.capacidades.salidaDigital) return { codigo: "PIN_SIN_CAPACIDAD", comando, pin }
    if (necesita === "pwm" && !registro.capacidades.pwm) return { codigo: "PIN_SIN_CAPACIDAD", comando, pin }
    if (necesita === "adc" && !registro.capacidades.adc) return { codigo: "PIN_SIN_CAPACIDAD", comando, pin }
    if (necesita === "entrada" && !registro.capacidades.entradaDigital) return { codigo: "PIN_SIN_CAPACIDAD", comando, pin }
    return undefined
  }

  function ejecutar(c) {
    switch (c.comando) {
      case "hola":
        return hola()
      case "ping":
        return { tipo: "pong", uptimeMs: reloj() }
      case "pin.modo": {
        const e = validarPin(c.comando, c.pin, c.modo === "salida" ? "salida" : "entrada")
        if (e) return respuestaDeError(e)
        modos.set(c.pin, c.modo)
        if (c.modo !== "salida") salidas.delete(c.pin)
        return { tipo: "ok", comando: c.comando, pin: c.pin }
      }
      case "digital.escribir": {
        const e = validarPin(c.comando, c.pin, "salida")
        if (e) return respuestaDeError(e)
        modos.set(c.pin, "salida")
        salidas.set(c.pin, c.nivel)
        return { tipo: "ok", comando: c.comando, pin: c.pin }
      }
      case "pwm.escribir": {
        const e = validarPin(c.comando, c.pin, "pwm")
        if (e) return respuestaDeError(e)
        modos.set(c.pin, "salida")
        salidas.set(c.pin, c.porcentaje === 0 ? "bajo" : c.porcentaje === 100 ? "alto" : { pwm: c.porcentaje })
        return { tipo: "ok", comando: c.comando, pin: c.pin }
      }
      case "digital.leer": {
        const e = validarPin(c.comando, c.pin, "entrada")
        if (e) return respuestaDeError(e)
        if (!modos.has(c.pin)) modos.set(c.pin, "entrada")
        const modo = modos.get(c.pin)
        // Un pin configurado como salida se lee como lo que se escribió; una entrada, como lo que hay afuera;
        // una entrada con pull-up y nada afuera, en alto; una entrada flotante sin dato, en bajo (el simulador
        // no inventa ruido: es determinista).
        const salida = salidas.get(c.pin)
        const nivel = modo === "salida" ? (typeof salida === "string" ? salida : "bajo") : (entradas.get(c.pin) ?? (modo === "entradaPullUp" ? "alto" : "bajo"))
        return { tipo: "lectura", pin: c.pin, nivel }
      }
      case "analogico.leer": {
        const e = validarPin(c.comando, c.pin, "adc")
        if (e) return respuestaDeError(e)
        return { tipo: "lectura", pin: c.pin, crudo: analogicos.get(c.pin) ?? 0 }
      }
    }
    throw new Error(`comando sin ejecutar: ${c.comando}`)
  }

  return Object.freeze({
    placa,
    arrancar: () => [serializarRespuesta({ tipo: "reinicio", causa: causaDeReinicio }), serializarRespuesta(hola())],
    procesar(linea) {
      const sinFin = linea.endsWith("\n") ? linea.slice(0, -1) : linea
      if (sinFin.replace(/\r$/, "") === "") return []
      const parseo = parsearLineaDeComando(sinFin)
      if (!parseo.ok) return [error(parseo.error)]
      return [serializarRespuesta(ejecutar(parseo.valor))]
    },
    fijarEntrada: (pin, nivel) => void entradas.set(pin, nivel),
    fijarAnalogico: (pin, crudo) => void analogicos.set(pin, crudo),
    modoDe: (pin) => modos.get(pin),
    salidaDe: (pin) => salidas.get(pin),
  })
}

/**
 * Casos dorados: línea de entrada → líneas de salida EXACTAS, sobre un runtime recién arrancado
 * y en este orden (hay estado: el `digital.leer` del final lee lo que se escribió antes). El
 * runtime en C++ tiene que reproducirlos byte a byte (tests/vivo-runtime-cpp.test.mjs); el
 * simulador los cumple por construcción (tests/vivo-protocolo.test.mjs).
 */
export const CASOS_DORADOS = Object.freeze([
  { entrada: "hola", salida: ['{"comandos":["analogico.leer","digital.escribir","digital.leer","hola","pin.modo","ping","pwm.escribir"],"placa":"esp32-devkit-v1","protocolo":1,"protocolos":[],"runtime":"0.1.0","tipo":"hola"}'] },
  { entrada: "ping", salida: ['{"tipo":"pong","uptimeMs":0}'] },
  { entrada: "pin.modo pin=23 modo=salida", salida: ['{"comando":"pin.modo","pin":23,"tipo":"ok"}'] },
  { entrada: "digital.escribir pin=23 nivel=alto", salida: ['{"comando":"digital.escribir","pin":23,"tipo":"ok"}'] },
  { entrada: "pwm.escribir pin=18 porcentaje=50", salida: ['{"comando":"pwm.escribir","pin":18,"tipo":"ok"}'] },
  { entrada: "pin.modo pin=4 modo=entradaPullUp", salida: ['{"comando":"pin.modo","pin":4,"tipo":"ok"}'] },
  { entrada: "digital.leer pin=4", salida: ['{"nivel":"alto","pin":4,"tipo":"lectura"}'] },
  { entrada: "analogico.leer pin=34", salida: ['{"crudo":0,"pin":34,"tipo":"lectura"}'] },
  { entrada: "digital.leer pin=23", salida: ['{"nivel":"alto","pin":23,"tipo":"lectura"}'] },
  { entrada: "digital.escribir pin=6 nivel=alto", salida: ['{"codigo":"PIN_PROHIBIDO","comando":"digital.escribir","pin":6,"tipo":"error"}'] },
  { entrada: "digital.escribir pin=1 nivel=bajo", salida: ['{"codigo":"PIN_PROHIBIDO","comando":"digital.escribir","pin":1,"tipo":"error"}'] },
  { entrada: "digital.escribir pin=34 nivel=alto", salida: ['{"codigo":"PIN_SIN_CAPACIDAD","comando":"digital.escribir","pin":34,"tipo":"error"}'] },
  { entrada: "analogico.leer pin=4", salida: ['{"codigo":"PIN_SIN_CAPACIDAD","comando":"analogico.leer","pin":4,"tipo":"error"}'] },
  { entrada: "digital.leer pin=20", salida: ['{"codigo":"PIN_INEXISTENTE","comando":"digital.leer","pin":20,"tipo":"error"}'] },
  { entrada: "digital.leer pin=37", salida: ['{"codigo":"PIN_INEXISTENTE","comando":"digital.leer","pin":37,"tipo":"error"}'] },
  { entrada: "servo.angulo pin=18 grados=90", salida: ['{"codigo":"COMANDO_DESCONOCIDO","comando":"servo.angulo","tipo":"error"}'] },
  { entrada: "digital.escribir pin=23", salida: ['{"campo":"nivel","codigo":"CAMPO_FALTANTE","comando":"digital.escribir","tipo":"error"}'] },
  { entrada: "digital.escribir pin=23 nivel=alto extra=1", salida: ['{"campo":"extra","codigo":"CAMPO_DESCONOCIDO","comando":"digital.escribir","tipo":"error"}'] },
  { entrada: "digital.escribir pin=23 pin=22 nivel=alto", salida: ['{"campo":"pin","codigo":"CAMPO_DUPLICADO","comando":"digital.escribir","tipo":"error"}'] },
  { entrada: "pwm.escribir pin=18 porcentaje=101", salida: ['{"campo":"porcentaje","codigo":"VALOR_INVALIDO","comando":"pwm.escribir","tipo":"error"}'] },
  { entrada: "digital.escribir pin=x nivel=alto", salida: ['{"campo":"pin","codigo":"VALOR_INVALIDO","comando":"digital.escribir","tipo":"error"}'] },
  { entrada: "pin.modo pin=23 modo=rapido", salida: ['{"campo":"modo","codigo":"VALOR_INVALIDO","comando":"pin.modo","tipo":"error"}'] },
  { entrada: "digital.escribir  pin=23 nivel=alto", salida: ['{"codigo":"LINEA_INVALIDA","tipo":"error"}'] },
  { entrada: "Hola", salida: ['{"codigo":"LINEA_INVALIDA","tipo":"error"}'] },
  { entrada: "", salida: [] },
  { entrada: `ping ${"x".repeat(200)}`, salida: ['{"codigo":"LINEA_DEMASIADO_LARGA","tipo":"error"}'] },
])
