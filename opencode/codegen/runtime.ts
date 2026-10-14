// Modo Vivo (protocolo v1, slices V1–V4) — generación del Tecnia Live Runtime (firmware base por placa) para la ESP32.
//
// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md (§6: este módulo es del agente A; §9: las
// decisiones V4-x que se citan por id desde acá y desde el C++). El runtime es POR PLACA, no por proyecto
// (MODO-VIVO-PLAN.md §10.1): no conoce reglas ni componentes, sólo primitivas sobre pines. Lo que sabe de
// la placa (qué pines existen, cuáles están prohibidos, cuáles sólo leen, cuáles tienen ADC, cuáles no
// tienen pull-up) lo DERIVA de `nucleo/placas.ts`, la única autoridad de pines, y lo lleva compilado
// adentro: la placa se defiende sola aunque el host se equivoque (contrato §5).
//
// Pura, como `generarPrograma`: misma placa → mismos bytes. Sin I/O, sin reloj, sin estado. El
// vocabulario del protocolo (comandos, campos, códigos, modos, niveles, causas, límite de línea)
// sale de `vivo/protocolo.ts`; las líneas C++ de `runtime-cpp.ts`.

import type { Placa } from "../nucleo/placas.ts"
import { CAMPOS_POR_COMANDO, CAUSAS_DE_REINICIO, CODIGOS_DE_ERROR, COMANDOS_V1, IP_PORTAL as IP_DEL_CONTRATO, LIMITE_LINEA_BYTES, MODOS_DE_PIN, NIVELES, VERSION_PROTOCOLO, esSsidValido } from "../vivo/protocolo.ts"
import { RUTA_COMANDO, renderizarPaginaPortal, type PaginaPortal } from "../vivo/pagina-portal.ts"
import { renderizarPlatformioIni } from "./platformio-ini.ts"
import { renderizarNucleo, renderizarPortal, renderizarTransporte, type Octetos, type RedDelRuntime, type TablasDelRuntime } from "./runtime-cpp.ts"

/** Versión del runtime, la que anuncia `hola` (contrato §3). Semver; cambia cuando cambia el firmware. */
export const VERSION_RUNTIME = "0.1.0" as const

/** Velocidad del cable (contrato, cabecera: "USB serie, 115200 8N1"). */
export const VELOCIDAD_SERIE = 115200

/**
 * V4-7: el core imprime `log_e(...)` por UART0 (prosa en el cable: Parsing.cpp:117, WiFiAP.cpp:161). Sin
 * `CORE_DEBUG_LEVEL` definido, `esp32-hal-log.h:36-37` toma `CONFIG_ARDUHAL_LOG_DEFAULT_LEVEL` (= 1, ERROR,
 * en el sdkconfig de las librerías precompiladas); con `-DCORE_DEBUG_LEVEL=0` (`esp32-hal-log.h:38-39`)
 * `log_e` queda vacío (`:168`). Sólo el runtime lleva esta flag: el ini de `generarPrograma` no cambia.
 */
export const BUILD_FLAGS_RUNTIME: readonly string[] = Object.freeze(["-DCORE_DEBUG_LEVEL=0"])

// ── V4: la red propia (contrato §8 y §9) ───────────────────────────────────────────────────

/** IP del punto de acceso (§8.1). El runtime la fija con `softAPConfig`; `hola.wifi.ip` la anuncia. */
export const IP_PORTAL: Octetos = IP_DEL_CONTRATO // una sola definición: `vivo/protocolo.ts` (A6 M-03)
export const MASCARA_PORTAL: Octetos = [255, 255, 255, 0]
/** V4-5: sin `nombreRed`, el SSID es este prefijo + los 4 últimos hex de la MAC del AP, en minúscula. */
export const PREFIJO_SSID = "tecnia-"
export const PUERTO_HTTP = 80
export const PUERTO_DNS = 53
export const RUTA_PAGINA = "/"
/**
 * V4-4: la clave es `""` (red ABIERTA, el default) u 8 dígitos decimales (WPA2, la que sortea `cargar` con
 * `redConClave`). Nada más. El SSID fijo lo valida `esSsidValido` (`vivo/protocolo.ts`).
 */
export const FORMA_DE_CLAVE_WIFI = /^(?:[0-9]{8})?$/
/** V4-3: canales 802.11 de 2,4 GHz que acepta `esp_wifi_set_channel` en la ESP32 (`esp_wifi.h:615`; 1..13 en el país por defecto). */
export const CANAL_WIFI_MINIMO = 1
export const CANAL_WIFI_MAXIMO = 13

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

export interface OpcionesDeRed {
  /** V4-4: `""` (red abierta, el default) u 8 dígitos decimales (WPA2). */
  readonly clave: string
  /** V4-5: nombre fijo (`esSsidValido`); sin él, la placa arma `tecnia-xxxx` desde su MAC. */
  readonly ssid?: string
  /**
   * V4-3: el AP arranca sin canal explícito. Esta opción es para el EXPERIMENTO pendiente de §9: si viene,
   * el runtime llama `esp_wifi_set_channel(canal, WIFI_SECOND_CHAN_NONE)` DESPUÉS de `softAP`. 1..13.
   */
  readonly canal?: number
  /**
   * Diagnóstico por serie, cada 10 s: `{"canal":N,"heapLibre":N,"stackLibre":N,"tipo":"diagnostico"}`. Está
   * FUERA del contrato (§3 no lo define): la sesión del host la va a ignorar por tipo desconocido (eso lo
   * implementa el integrador). Sin la opción, nada de esto se compila.
   */
  readonly diagnostico?: boolean
}

export interface OpcionesDelRuntime {
  /** Velocidad del serie; el contrato fija 115200 y la tool no la cambia. Queda inyectable para otra placa futura. */
  readonly velocidadSerie?: number
  /**
   * V4: compilar la red propia (punto de acceso + DNS cautivo + HTTP con la página). Sin esta opción el
   * runtime es EXACTAMENTE el de V1 (sólo serie).
   */
  readonly wifi?: OpcionesDeRed
  /**
   * V4: qué pines muestra la página (`vivo/pagina-portal.ts`). Obligatoria con `wifi`; cada número se valida
   * contra la política de la placa (existe, no prohibido, y salida o ADC según la lista). Este módulo no
   * conoce ningún número de GPIO: los decide quien llama (la tool, con el proyecto o el contrato §8.3).
   */
  readonly pagina?: PaginaPortal
}

/** Pines que el runtime rechaza SIEMPRE: flash y UART0 (contrato §5), el mismo criterio que el simulador de referencia. */
export function pinesProhibidosDe(placa: Placa): readonly number[] {
  return placa.pines.filter((p) => p.restricciones.includes("flashReservado") || p.restricciones.includes("uartUsb")).map((p) => p.numero)
}

const ordenados = (numeros: readonly number[]): number[] => [...numeros].sort((a, b) => a - b)

/** Las tablas de política (§5 y V4-6) desde el registro de la placa. Nunca escritas a mano. */
export function tablasDePines(placa: Placa): TablasDelRuntime["pines"] {
  const bancos = new Set(placa.pines.map((p) => p.banco))
  if (bancos.size !== 1 || !bancos.has("GPIO")) {
    throw new Error(`el runtime V1 identifica cada pin por su numero de GPIO (contrato §2); «${placa.id}» tiene bancos ${[...bancos].join(", ")}`)
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
    // V4-6 (A3 H4): "sólo los pines que soportan entrada Y salida tienen pull-up/pull-down integrados"
    // (driver/gpio.h:174, textual). El registro de placas no tiene una capacidad "pullUp": se deriva de las dos
    // capacidades, tal cual lo enuncia el IDF, sin nombrar ninguna restricción ni número (guardia F1 de codegen-s2).
    sinPullUp: ordenados(placa.pines.filter((p) => !(p.capacidades.entradaDigital && p.capacidades.salidaDigital)).map((p) => p.numero)),
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

/** Qué le pide la página a cada lista de pines, en términos de la política (§5): la capacidad que la placa tiene que tener. */
const ROLES_DE_LA_PAGINA: readonly { readonly lista: keyof PaginaPortal; readonly que: string; readonly permitido: (pines: TablasDelRuntime["pines"], pin: number) => boolean }[] = [
  { lista: "salidas", que: "salida", permitido: (p, pin) => !p.sinSalida.includes(pin) },
  { lista: "salidasExtra", que: "salida", permitido: (p, pin) => !p.sinSalida.includes(pin) },
  { lista: "salidasConAviso", que: "salida", permitido: (p, pin) => !p.sinSalida.includes(pin) },
  { lista: "entradasDigitales", que: "entrada digital", permitido: (p, pin) => !p.sinEntrada.includes(pin) },
  { lista: "entradasAnalogicas", que: "entrada analogica (ADC)", permitido: (p, pin) => p.conAdc.includes(pin) },
]

/**
 * Valida la POLÍTICA de la página contra la placa, de forma GENERICA (sin ningún número escrito): cada pin
 * de cada lista tiene que existir, no estar prohibido y tener la capacidad que su lista le pide. Nunca una
 * página que ofrezca lo que la placa va a rechazar. La FORMA (listas de enteros, ningún pin en dos listas)
 * la valida `renderizarPaginaPortal` (C-02: cada chequeo en un solo lugar).
 */
export function validarPaginaPortal(placa: Placa, pines: TablasDelRuntime["pines"], pagina: PaginaPortal): void {
  for (const rol of ROLES_DE_LA_PAGINA) {
    const numeros = pagina[rol.lista]
    if (numeros === undefined && rol.lista === "salidasConAviso") continue
    if (!Array.isArray(numeros)) throw new Error(`pagina.${rol.lista}: tiene que ser una lista de numeros de GPIO`)
    for (const pin of numeros) {
      if (!Number.isInteger(pin) || !pines.existentes.includes(pin)) throw new Error(`pagina.${rol.lista}: GPIO${pin} no existe en «${placa.id}»`)
      if (pines.prohibidos.includes(pin)) throw new Error(`pagina.${rol.lista}: GPIO${pin} esta prohibido en «${placa.id}» (flash o UART0)`)
      if (!rol.permitido(pines, pin)) throw new Error(`pagina.${rol.lista}: GPIO${pin} no puede ser ${rol.que} en «${placa.id}»`)
    }
  }
}

/**
 * La FRONTERA de la red propia (contrato §8 y §9): acá, y sólo acá, se validan la clave (V4-4), el SSID (V4-5),
 * el canal (V4-3) y la página (política contra la placa; la forma la valida `renderizarPaginaPortal`).
 * `runtime-cpp.ts` recibe `RedDelRuntime` ya válida y no vuelve a chequear (C-02).
 */
export function redDelRuntime(placa: Placa, pines: TablasDelRuntime["pines"], red: OpcionesDeRed, pagina: PaginaPortal | undefined): RedDelRuntime {
  if (typeof red.clave !== "string" || !FORMA_DE_CLAVE_WIFI.test(red.clave)) throw new Error('la clave WiFi es "" (red abierta) u 8 digitos decimales (V4-4)')
  if (red.ssid !== undefined && !esSsidValido(red.ssid)) throw new Error("el SSID fijo no es valido: ASCII imprimible, sin comillas ni barra invertida, hasta el largo maximo (esSsidValido, V4-5)")
  if (red.canal !== undefined && (!Number.isInteger(red.canal) || red.canal < CANAL_WIFI_MINIMO || red.canal > CANAL_WIFI_MAXIMO)) {
    throw new Error(`el canal WiFi es un entero de ${CANAL_WIFI_MINIMO} a ${CANAL_WIFI_MAXIMO} (V4-3, esp_wifi_set_channel)`)
  }
  if (red.diagnostico !== undefined && typeof red.diagnostico !== "boolean") throw new Error("wifi.diagnostico es true o false")
  if (typeof pagina !== "object" || pagina === null) throw new Error("con wifi, la pagina (PaginaPortal) es obligatoria")
  const html = renderizarPaginaPortal(pagina) // forma: lanza si una lista no es de enteros o un pin esta en dos listas
  validarPaginaPortal(placa, pines, pagina) // politica: lanza si la placa va a rechazar un pin ofrecido
  return {
    clave: red.clave,
    ip: IP_PORTAL,
    mascara: MASCARA_PORTAL,
    prefijoSsid: PREFIJO_SSID,
    ...(red.ssid !== undefined ? { ssid: red.ssid } : {}),
    ...(red.canal !== undefined ? { canal: red.canal } : {}),
    diagnostico: red.diagnostico === true,
    puertoHttp: PUERTO_HTTP,
    puertoDns: PUERTO_DNS,
    rutaPagina: RUTA_PAGINA,
    rutaComando: RUTA_COMANDO,
    pagina: html,
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
  const tablas: TablasDelRuntime = opciones.wifi ? { ...base, wifi: redDelRuntime(placa, base.pines, opciones.wifi, opciones.pagina) } : base
  const ini = renderizarPlatformioIni(placa, { buildFlags: BUILD_FLAGS_RUNTIME })
  const velocidadSerie = opciones.velocidadSerie ?? VELOCIDAD_SERIE
  if (!Number.isInteger(velocidadSerie) || velocidadSerie <= 0) throw new Error(`velocidad de serie invalida: ${velocidadSerie}`)
  const l: string[] = []
  l.push("// Generado por Tecnia Bot (codegen/runtime.ts) desde el contrato del protocolo y el registro de placas. No editar.")
  l.push(`// Tecnia Live Runtime ${VERSION_RUNTIME} | protocolo ${VERSION_PROTOCOLO} | placa: ${placa.id}${tablas.wifi ? " | red propia (V4)" : ""}`)
  l.push("// Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md (las decisiones V4-x son de su sec. 9). Referencia: opencode/vivo/protocolo.ts.")
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
    if (tablas.wifi.canal !== undefined) l.push("#include <esp_wifi.h>  // esp_wifi_set_channel (esp_wifi.h:615); WiFi.h no lo incluye (WiFiType.h:26 trae solo esp_wifi_types.h)")
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
