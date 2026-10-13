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
import { CAMPO_MODO, CAMPO_NIVEL, CAMPO_PIN, CAMPO_PORCENTAJE, renderizarNucleo, renderizarPortal, renderizarTransporte, type Octetos, type RedDelRuntime, type TablasDelRuntime } from "./runtime-cpp.ts"
import { renderizarPagina } from "./runtime-pagina.ts"

/** Versión del runtime, la que anuncia `hola` (contrato sec. 3). Semver; cambia cuando cambia el firmware. */
export const VERSION_RUNTIME = "0.1.0" as const

/** Velocidad del cable (contrato, cabecera: "USB serie, 115200 8N1"). */
export const VELOCIDAD_SERIE = 115200

// ── V4: la red propia (contrato sec. 8) ──────────────────────────────────────────────────

/** IP del punto de acceso (sec. 8.1). El runtime la fija con `softAPConfig`; `hola.wifi.ip` la anuncia. */
export const IP_PORTAL: Octetos = [192, 168, 4, 1]
export const MASCARA_PORTAL: Octetos = [255, 255, 255, 0]
/** SSID = prefijo + los 4 últimos hex de la MAC del AP, en minúscula (sec. 8.1, decisión V4-1). */
export const PREFIJO_SSID = "tecnia-"
export const PUERTO_HTTP = 80
export const PUERTO_DNS = 53
export const RUTA_PAGINA = "/"
export const RUTA_COMANDO = "/comando"
/**
 * La clave: `""` = red ABIERTA (el default decidido por Alejandro el 2026-10-13, por chat) u 8 dígitos
 * decimales = WPA2 (sec. 8.1). Nada más.
 */
export const FORMA_DE_CLAVE_WIFI = /^(?:[0-9]{8})?$/
/** Un SSID fijo: 1..32 bytes ASCII imprimibles (`wifi_config_t.ap.ssid` mide 32), sin `"` ni `\` (sale en el JSON sin escapar). */
export const FORMA_DE_SSID = /^[\x20-\x21\x23-\x5b\x5d-\x7e]{1,32}$/
/** Lo que muestra la página V4a (sec. 8.3): salidas a la vista, lectura digital con pull-up y lectura analógica. */
export const PAGINA_V4A = Object.freeze({ salidasVisibles: [2, 18] as readonly number[], entradaDigital: 4, entradaAnalogica: 34 })
/** `crudo` 0..4095 (contrato sec. 2): sólo para decirle el rango al alumno en la página. */
export const MAXIMO_ANALOGICO = 4095

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
  /**
   * V4: compilar la red propia (punto de acceso + DNS cautivo + HTTP con la página). Sin esta opción el
   * runtime es EXACTAMENTE el de V1 (sólo serie). `clave`: `""` (red abierta, el default) u 8 dígitos
   * decimales (WPA2). `ssid`: nombre fijo (1..32 bytes ASCII imprimibles, sin `"` ni `\`); sin él, la placa
   * arma `tecnia-xxxx` desde su MAC.
   */
  readonly wifi?: { readonly clave: string; readonly ssid?: string }
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

const sin = (numeros: readonly number[], quitar: readonly number[]): number[] => numeros.filter((n) => !quitar.includes(n))

/**
 * La red propia y la página (contrato sec. 8) para una placa, desde su política de pines. Lanza si la clave
 * no tiene la forma del contrato o si los pines que la página muestra (sec. 8.3) no existen en la placa con
 * la capacidad que la página les pide: nunca una página que ofrezca lo que la placa va a rechazar.
 */
export function redDelRuntime(placa: Placa, pines: TablasDelRuntime["pines"], clave: string, ssid?: string): RedDelRuntime {
  if (typeof clave !== "string" || !FORMA_DE_CLAVE_WIFI.test(clave)) throw new Error('la clave WiFi es "" (red abierta) u 8 digitos decimales (contrato sec. 8.1)')
  if (ssid !== undefined && (typeof ssid !== "string" || !FORMA_DE_SSID.test(ssid))) throw new Error("el SSID fijo son 1 a 32 bytes ASCII imprimibles, sin comillas ni barra invertida")
  const salidasPermitidas = sin(sin(pines.existentes, pines.prohibidos), pines.sinSalida)
  const { salidasVisibles, entradaDigital, entradaAnalogica } = PAGINA_V4A
  for (const pin of salidasVisibles) if (!salidasPermitidas.includes(pin)) throw new Error(`la pagina muestra GPIO${pin} como salida, pero «${placa.id}» no lo permite`)
  if (!pines.existentes.includes(entradaDigital) || pines.prohibidos.includes(entradaDigital) || pines.sinEntrada.includes(entradaDigital)) throw new Error(`la pagina lee GPIO${entradaDigital} en digital, pero «${placa.id}» no lo permite`)
  if (!pines.conAdc.includes(entradaAnalogica) || pines.prohibidos.includes(entradaAnalogica)) throw new Error(`la pagina lee GPIO${entradaAnalogica} en analogico, pero «${placa.id}» no tiene ADC ahi`)
  // Decisión V4-A (agente A, sin fuente en el contrato): un pin que la página LEE no se ofrece también como
  // salida. Con un pulsador a GND en GPIO4 (el montaje del E2E de V1), un "Alto" escondido en "más pines"
  // pondría la salida en corto contra el pulsador. El contrato dice "cada salida que la política permite";
  // esta resta queda anotada en el reporte como desvío deliberado.
  const salidasOcultas = sin(salidasPermitidas, [...salidasVisibles, entradaDigital, entradaAnalogica])
  return {
    clave,
    ip: IP_PORTAL,
    mascara: MASCARA_PORTAL,
    prefijoSsid: PREFIJO_SSID,
    ...(ssid !== undefined ? { ssid } : {}),
    puertoHttp: PUERTO_HTTP,
    puertoDns: PUERTO_DNS,
    rutaPagina: RUTA_PAGINA,
    rutaComando: RUTA_COMANDO,
    pagina: renderizarPagina({
      rutaComando: RUTA_COMANDO,
      salidasVisibles,
      salidasOcultas,
      pinesConPwm: sin(salidasPermitidas, pines.sinPwm),
      entradaDigital,
      entradaAnalogica,
      maximoAnalogico: MAXIMO_ANALOGICO,
    }),
  }
}

/**
 * Genera `platformio.ini` + `src/main.cpp` del runtime para la placa. Lanza si la placa no cabe en
 * el modelo de V1 (un solo banco GPIO, framework Arduino): nunca un runtime "más o menos".
 * Con `opciones.wifi` (V4) agrega la tercera capa; sin ella, los bytes son los de V1.
 */
export function generarRuntime(placa: Placa, opciones: OpcionesDelRuntime = {}): RuntimeGenerado {
  if (placa.backends.platformio.framework !== "arduino") throw new Error(`el runtime V1 esta escrito sobre Arduino; «${placa.id}» compila con ${placa.backends.platformio.framework}`)
  const base = tablasDelRuntime(placa)
  const tablas: TablasDelRuntime = opciones.wifi ? { ...base, wifi: redDelRuntime(placa, base.pines, opciones.wifi.clave, opciones.wifi.ssid) } : base
  const ini = renderizarPlatformioIni(placa)
  const velocidadSerie = opciones.velocidadSerie ?? VELOCIDAD_SERIE
  if (!Number.isInteger(velocidadSerie) || velocidadSerie <= 0) throw new Error(`velocidad de serie invalida: ${velocidadSerie}`)
  const l: string[] = []
  l.push("// Generado por Tecnia Bot (codegen/runtime.ts) desde el contrato del protocolo y el registro de placas. No editar.")
  l.push(`// Tecnia Live Runtime ${VERSION_RUNTIME} | protocolo ${VERSION_PROTOCOLO} | placa: ${placa.id}${tablas.wifi ? " | red propia (V4)" : ""}`)
  l.push("// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md. Referencia: opencode/vivo/protocolo.ts.")
  l.push("//")
  if (tablas.wifi) {
    l.push("// Tres capas (MODO-VIVO-PLAN.md sec. 10.5 y contrato sec. 8): un nucleo puro, que los tests ejecutan")
    l.push("// traducido a JS y comparan byte a byte con el simulador de referencia; una capa de transporte serie")
    l.push("// sobre Arduino, que mueve lineas y cumple los pedidos de hardware del nucleo; y una capa WiFi (punto")
    l.push("// de acceso, DNS cautivo, HTTP con la pagina) que le acerca al mismo nucleo las lineas del celular.")
  } else {
    l.push("// Dos capas (MODO-VIVO-PLAN.md sec. 10.5): un nucleo puro, que los tests ejecutan traducido a JS y")
    l.push("// comparan byte a byte con el simulador de referencia, y una capa de transporte sobre Arduino que")
    l.push("// solo mueve lineas por el serie y cumple los pedidos de hardware del nucleo.")
  }
  l.push("")
  l.push("#include <Arduino.h>")
  if (tablas.wifi) {
    l.push("#include <WiFi.h>  // libraries/WiFi/src/WiFi.h:73: el objeto global WiFi")
    l.push("#include <DNSServer.h>  // libraries/DNSServer/src/DNSServer.h")
    l.push("#include <WebServer.h>  // libraries/WebServer/src/WebServer.h")
  }
  l.push("")
  l.push(...renderizarNucleo(tablas))
  l.push("")
  l.push(...renderizarTransporte(tablas, { velocidadSerie }))
  l.push("")
  if (tablas.wifi) {
    l.push(...renderizarPortal(tablas))
    l.push("")
  }
  return {
    archivos: { "platformio.ini": ini.contenido, "src/main.cpp": l.join("\n") },
    environment: ini.environment,
    runtime: VERSION_RUNTIME,
    protocolo: VERSION_PROTOCOLO,
  }
}
