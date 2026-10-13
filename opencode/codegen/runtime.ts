// Modo Vivo V1 — generación del Tecnia Live Runtime (firmware base por placa) para la ESP32.
//
// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md (sec. 6: este módulo es del agente A).
// El runtime es POR PLACA, no por proyecto (MODO-VIVO-PLAN.md sec. 10.1): no conoce reglas ni
// componentes, sólo primitivas sobre pines. Lo que sabe de la placa (qué pines existen, cuáles
// están prohibidos, cuáles sólo leen, cuáles tienen ADC) lo DERIVA de `nucleo/placas.ts`, la
// única autoridad de pines, y lo lleva compilado adentro: la placa se defiende sola aunque el
// host se equivoque (contrato sec. 5).
//
// Pura, como `generarPrograma`: misma placa → mismos bytes. Sin I/O, sin reloj, sin estado. El
// vocabulario del protocolo (comandos, campos, códigos, modos, niveles, causas, límite de línea)
// sale de `vivo/protocolo.ts`; las líneas C++ de `runtime-cpp.ts`.

import type { Placa } from "../nucleo/placas.ts"
import { CAUSAS_DE_REINICIO, CODIGOS_DE_ERROR, COMANDOS_V1, LIMITE_LINEA_BYTES, MODOS_DE_PIN, NIVELES, VERSION_PROTOCOLO, type NombreComandoV1 } from "../vivo/protocolo.ts"
import { renderizarPlatformioIni } from "./platformio-ini.ts"
import { CAMPO_MODO, CAMPO_NIVEL, CAMPO_PIN, CAMPO_PORCENTAJE, renderizarNucleo, renderizarTransporte, type TablasDelRuntime } from "./runtime-cpp.ts"

/** Versión del runtime, la que anuncia `hola` (contrato sec. 3). Semver; cambia cuando cambia el firmware. */
export const VERSION_RUNTIME = "0.1.0" as const

/** Velocidad del cable (contrato, cabecera: "USB serie, 115200 8N1"). */
export const VELOCIDAD_SERIE = 115200

/**
 * Campos obligatorios de cada comando (contrato sec. 2), en el orden en que se reclaman como faltantes.
 * Es la misma tabla que `protocolo.ts::CAMPOS_POR_COMANDO` (privada allá); el test la confronta con
 * `parsearLineaDeComando` para que no diverjan.
 */
export const CAMPOS_POR_COMANDO: Readonly<Record<NombreComandoV1, readonly string[]>> = Object.freeze({
  hola: [],
  ping: [],
  "pin.modo": [CAMPO_PIN, CAMPO_MODO],
  "digital.escribir": [CAMPO_PIN, CAMPO_NIVEL],
  "pwm.escribir": [CAMPO_PIN, CAMPO_PORCENTAJE],
  "digital.leer": [CAMPO_PIN],
  "analogico.leer": [CAMPO_PIN],
})

export interface ArchivosDelRuntime {
  readonly "platformio.ini": string
  readonly "src/main.cpp": string
}

export interface RuntimeGenerado {
  readonly archivos: ArchivosDelRuntime
  /** Nombre del `[env:...]` del platformio.ini (`pio run -e <environment>`), igual que `generarPrograma`. */
  readonly environment: string
  readonly runtime: typeof VERSION_RUNTIME
  readonly protocolo: typeof VERSION_PROTOCOLO
}

export interface OpcionesDelRuntime {
  /** Velocidad del serie; el contrato fija 115200 y la tool no la cambia. Queda inyectable para otra placa futura. */
  readonly velocidadSerie?: number
}

/** Pines que el runtime rechaza SIEMPRE: flash y UART0 (contrato sec. 5), el mismo criterio que el simulador de referencia. */
export function pinesProhibidosDe(placa: Placa): readonly number[] {
  return placa.pines.filter((p) => p.restricciones.includes("flashReservado") || p.restricciones.includes("uartUsb")).map((p) => p.numero)
}

const ordenados = (numeros: readonly number[]): number[] => [...numeros].sort((a, b) => a - b)

/** Las tablas de política (sec. 5) desde el registro de la placa. Nunca escritas a mano. */
export function tablasDePines(placa: Placa): TablasDelRuntime["pines"] {
  const bancos = new Set(placa.pines.map((p) => p.banco))
  if (bancos.size !== 1 || !bancos.has("GPIO")) {
    throw new Error(`el runtime V1 identifica cada pin por su numero de GPIO (contrato sec. 2); «${placa.id}» tiene bancos ${[...bancos].join(", ")}`)
  }
  const numeros = placa.pines.map((p) => p.numero)
  if (new Set(numeros).size !== numeros.length) throw new Error(`«${placa.id}» repite numeros de pin`)
  if (numeros.some((n) => !Number.isInteger(n) || n < 0 || n > 254)) throw new Error(`«${placa.id}» tiene un numero de pin fuera de 0..254`)
  return {
    cantidad: Math.max(...numeros) + 1,
    existentes: ordenados(numeros),
    prohibidos: ordenados(pinesProhibidosDe(placa)),
    sinEntrada: ordenados(placa.pines.filter((p) => !p.capacidades.entradaDigital).map((p) => p.numero)),
    sinSalida: ordenados(placa.pines.filter((p) => !p.capacidades.salidaDigital).map((p) => p.numero)),
    sinPwm: ordenados(placa.pines.filter((p) => !p.capacidades.pwm).map((p) => p.numero)),
    conAdc: ordenados(placa.pines.filter((p) => p.capacidades.adc).map((p) => p.numero)),
  }
}

/** Las tablas completas que el C++ necesita: contrato + placa. */
export function tablasDelRuntime(placa: Placa): TablasDelRuntime {
  return {
    placaId: placa.id,
    versionRuntime: VERSION_RUNTIME,
    versionProtocolo: VERSION_PROTOCOLO,
    limiteLineaBytes: LIMITE_LINEA_BYTES,
    comandos: [...COMANDOS_V1],
    camposPorComando: CAMPOS_POR_COMANDO,
    codigosDeError: [...CODIGOS_DE_ERROR],
    modos: [...MODOS_DE_PIN],
    niveles: [...NIVELES],
    causasDeReinicio: [...CAUSAS_DE_REINICIO],
    pines: tablasDePines(placa),
  }
}

/**
 * Genera `platformio.ini` + `src/main.cpp` del runtime para la placa. Lanza si la placa no cabe en
 * el modelo de V1 (un solo banco GPIO, framework Arduino): nunca un runtime "más o menos".
 */
export function generarRuntime(placa: Placa, opciones: OpcionesDelRuntime = {}): RuntimeGenerado {
  if (placa.backends.platformio.framework !== "arduino") throw new Error(`el runtime V1 esta escrito sobre Arduino; «${placa.id}» compila con ${placa.backends.platformio.framework}`)
  const tablas = tablasDelRuntime(placa)
  const ini = renderizarPlatformioIni(placa)
  const velocidadSerie = opciones.velocidadSerie ?? VELOCIDAD_SERIE
  if (!Number.isInteger(velocidadSerie) || velocidadSerie <= 0) throw new Error(`velocidad de serie invalida: ${velocidadSerie}`)
  const l: string[] = []
  l.push("// Generado por Tecnia Bot (codegen/runtime.ts) desde el contrato del protocolo y el registro de placas. No editar.")
  l.push(`// Tecnia Live Runtime ${VERSION_RUNTIME} | protocolo ${VERSION_PROTOCOLO} | placa: ${placa.id}`)
  l.push("// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md. Referencia: opencode/vivo/protocolo.ts.")
  l.push("//")
  l.push("// Dos capas (MODO-VIVO-PLAN.md sec. 10.5): un nucleo puro, que los tests ejecutan traducido a JS y")
  l.push("// comparan byte a byte con el simulador de referencia, y una capa de transporte sobre Arduino que")
  l.push("// solo mueve lineas por el serie y cumple los pedidos de hardware del nucleo.")
  l.push("")
  l.push("#include <Arduino.h>")
  l.push("")
  l.push(...renderizarNucleo(tablas))
  l.push("")
  l.push(...renderizarTransporte(tablas, { velocidadSerie }))
  l.push("")
  return {
    archivos: { "platformio.ini": ini.contenido, "src/main.cpp": l.join("\n") },
    environment: ini.environment,
    runtime: VERSION_RUNTIME,
    protocolo: VERSION_PROTOCOLO,
  }
}
