// Modo Vivo V1 — las líneas C++ del Tecnia Live Runtime, en dos capas (MODO-VIVO-PLAN.md sec. 10.5).
//
// Capa 1, NUCLEO PURO: parser del formato plano, despacho de los comandos, política de pines y
// serialización JSON canónica. Escrito en el subconjunto de C++ más chico que se pudo (enteros,
// arreglos de `char`, `for`/`while`, sin punteros aritméticos, sin `String`, sin STL, sin heap, sin
// `snprintf`): así el traductor de `tests/vivo-runtime-cpp.test.mjs` lo ejecuta en JS y reproduce
// `CASOS_DORADOS` byte a byte. Los enteros se emiten dígito a dígito por eso mismo: `snprintf` con
// aritmética de punteros queda fuera del subconjunto traducible.
//
// Capa 2, TRANSPORTE: lo único que toca Arduino (serie, pines, LEDC, ADC, reloj, causa de reinicio).
// Cada hecho de hardware lleva su cita a las fuentes instaladas de arduino-esp32 2.0.17, que es el
// core que trae `espressif32@6.12.0` (~/.platformio/packages/framework-arduinoespressif32,
// `cores/esp32/esp_arduino_version.h:22-26`).
//
// Capa 3, TRANSPORTE WIFI (V4, contrato sec. 8; sólo si `tablas.wifi` existe): el runtime levanta su
// propia red (punto de acceso), un DNS cautivo y un servidor HTTP con la página de sec. 8.3 y
// `POST /comando`. Las líneas que llegan por HTTP pasan por EL MISMO núcleo que las del serie. Sin
// `tablas.wifi`, ni una línea del runtime cambia: el runtime de sólo serie de V1 sigue byte a byte.
//
// Este módulo es PURO: recibe tablas ya derivadas (`runtime.ts`) y devuelve líneas. No decide
// política: la política está en las tablas, y las tablas salen del contrato y de `placas.ts`.
// Los comentarios del C++ generado van sin acentos: el programa generado es ASCII.

/** Todo lo que el C++ necesita saber, ya derivado del contrato (`vivo/protocolo.ts`) y de la placa. */
import { CAMPOS, CAUSAS_DE_REINICIO, MODOS_DE_PIN, NIVELES } from "../vivo/protocolo.ts"

export type Octetos = readonly [number, number, number, number]

/** La red propia del runtime (V4, contrato sec. 8.1 y 8.2), ya decidida por `runtime.ts`. */
export interface RedDelRuntime {
  /** `""` = red abierta (el default) u 8 dígitos decimales = WPA2 (sec. 8.1). Queda en el firmware y se anuncia en el `hola`. */
  readonly clave: string
  /** IP del punto de acceso (sec. 8.1: 192.168.4.1). El runtime la FIJA con `softAPConfig`, no la supone. */
  readonly ip: Octetos
  readonly mascara: Octetos
  /** `tecnia-`: el SSID es el prefijo + los 4 últimos hex de la MAC del AP en minúscula (sec. 8.1), salvo `ssid` fijo. */
  readonly prefijoSsid: string
  /** SSID fijado al generar (decisión de Alejandro, 2026-10-13): 1..32 bytes ASCII imprimibles sin `"` ni `\`. Sin él, el de la MAC. */
  readonly ssid?: string
  /** Canales 2,4 GHz entre los que reparte la MAC (sec. 8.1: 1, 6 u 11). */
  readonly canales: readonly number[]
  readonly puertoHttp: number
  readonly puertoDns: number
  readonly rutaPagina: string
  readonly rutaComando: string
  /** La página de sec. 8.3, ASCII, ya renderizada (`runtime-pagina.ts`). */
  readonly pagina: string
}

export interface TablasDelRuntime {
  readonly placaId: string
  readonly versionRuntime: string
  readonly versionProtocolo: number
  readonly limiteLineaBytes: number
  /** Comandos de V1 en el orden en que los anuncia `hola` (alfabético). */
  readonly comandos: readonly string[]
  /** Campos obligatorios de cada comando, en el orden en que se reclaman como faltantes (sec. 2 del contrato). */
  readonly camposPorComando: Readonly<Record<string, readonly string[]>>
  readonly codigosDeError: readonly string[]
  readonly modos: readonly string[]
  readonly niveles: readonly string[]
  readonly causasDeReinicio: readonly string[]
  readonly pines: {
    /** Tamaño de las tablas por pin: el número de GPIO más alto + 1. */
    readonly cantidad: number
    readonly existentes: readonly number[]
    readonly prohibidos: readonly number[]
    readonly sinEntrada: readonly number[]
    readonly sinSalida: readonly number[]
    readonly sinPwm: readonly number[]
    readonly conAdc: readonly number[]
  }
  /** V4: presente sólo cuando el runtime se compila con red propia. */
  readonly wifi?: RedDelRuntime
}

export interface OpcionesDeTransporte {
  readonly velocidadSerie: number
}

// Los nombres semánticos que el despacho necesita distinguir (son valores del contrato, sec. 2).
export const MODO_SALIDA: string = MODOS_DE_PIN[2]
export const MODO_ENTRADA: string = MODOS_DE_PIN[0]
export const MODO_ENTRADA_PULL_UP: string = MODOS_DE_PIN[1]
export const NIVEL_ALTO: string = NIVELES[0]
export const NIVEL_BAJO: string = NIVELES[1]
export const CAMPO_PIN: string = CAMPOS.pin
export const CAMPO_MODO: string = CAMPOS.modo
export const CAMPO_NIVEL: string = CAMPOS.nivel
export const CAMPO_PORCENTAJE: string = CAMPOS.porcentaje
export const CAUSA_ENCENDIDO: string = CAUSAS_DE_REINICIO[0]
export const CAUSA_SOFTWARE: string = CAUSAS_DE_REINICIO[1]
export const CAUSA_BROWNOUT: string = CAUSAS_DE_REINICIO[2]
export const CAUSA_WATCHDOG: string = CAUSAS_DE_REINICIO[3]
export const CAUSA_OTRO: string = CAUSAS_DE_REINICIO[4]

/**
 * Códigos ASCII de los caracteres de la gramática (sec. 1). Van como números con la letra en el
 * comentario porque `tests/codegen-s2b-dht11.test.mjs` (A3) prohíbe que un archivo de `codegen/`
 * nombre entre comillas un id del catálogo, y dos terminales del catálogo se llaman como letras.
 */
const ASCII = Object.freeze({
  minusculaA: 97, // 'a'
  minusculaZ: 122, // 'z'
  mayusculaA: 65, // 'A'
  mayusculaZ: 90, // 'Z'
  cero: 48, // '0'
  nueve: 57, // '9'
})

/** Identificador C++ (MAYUSCULAS) desde un nombre del contrato: `digital.escribir` → `DIGITAL_ESCRIBIR`. */
export const identificador = (texto: string): string => texto.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()

const literalTexto = (texto: string): string => {
  if (!/^[\x20-\x7e]*$/.test(texto) || texto.includes('"') || texto.includes("\\")) throw new Error(`texto no representable en el runtime (ASCII sin comillas): ${texto}`)
  return `"${texto}"`
}

const indiceDe = (lista: readonly string[], valor: string, que: string): number => {
  const i = lista.indexOf(valor)
  if (i < 0) throw new Error(`el contrato no define ${que} «${valor}»`)
  return i
}

const SIN_INDICE = "SIN_INDICE"

/** Tamaño del buffer del SSID: `wifi_config_t.ap.ssid` es `uint8_t[32]` (esp_wifi_types.h:260) más el 0 final. */
const TAMANO_BUFFER_SSID = 33

/**
 * La página como literal de C++ en `.rodata`: una línea del HTML por literal adyacente, cada una con su
 * `\n`. En la ESP32 `PROGMEM` no hace nada (pgmspace.h:32: `#define PROGMEM`) y `strlen_P` es `strlen`
 * (:81): `send_P` sirve el arreglo tal cual. Sólo se escapan `"` y `\`; la página ya es ASCII.
 */
function literalDePagina(nombre: string, pagina: string): string[] {
  if (!/^[\x0a\x20-\x7e]*$/.test(pagina)) throw new Error("la pagina tiene que ser ASCII")
  const lineas = pagina.split("\n")
  return [`static const char ${nombre}[] PROGMEM =`, ...lineas.map((linea, i) => `  "${linea.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\\n"${i === lineas.length - 1 ? ";" : ""}`)]
}

// ════════════════════════════════════════════════════════════════════════════════════
// Capa 1 — núcleo puro
// ════════════════════════════════════════════════════════════════════════════════════

/** Una tabla de pines como arreglo C++ con su cantidad, o un predicado constante si está vacía. */
function predicadoDeTabla(nombreFuncion: string, nombreTabla: string, numeros: readonly number[], que: string): string[] {
  if (numeros.length === 0) {
    return [`// ${que}: ningun pin de esta placa. La tabla esta vacia, asi que el predicado es constante.`, `static bool ${nombreFuncion}(uint32_t pin) {`, "  return false;", "}"]
  }
  return [
    `static const uint8_t ${nombreTabla}[] = {${numeros.join(", ")}};  // ${que}`,
    `static const uint8_t CANTIDAD_${nombreTabla} = ${numeros.length};`,
    `static bool ${nombreFuncion}(uint32_t pin) {`,
    `  return nucleo_enTabla(${nombreTabla}, CANTIDAD_${nombreTabla}, pin);`,
    "}",
  ]
}

/** `if` encadenados que devuelven el índice de la constante cuyo texto coincide con el tramo de la línea. */
function buscadorPorTexto(nombreFuncion: string, prefijo: string, valores: readonly string[]): string[] {
  return [
    `static uint8_t ${nombreFuncion}(uint8_t inicio, uint8_t largo) {`,
    ...valores.map((v) => `  if (nucleo_tramoEs(inicio, largo, TEXTO_${prefijo}_${identificador(v)})) return ${prefijo}_${identificador(v)};`),
    `  return ${SIN_INDICE};`,
    "}",
  ]
}

/** `if` encadenados que emiten el texto de la constante con ese índice. */
function emisorPorIndice(nombreFuncion: string, prefijo: string, valores: readonly string[]): string[] {
  return [
    `static void ${nombreFuncion}(uint8_t indice) {`,
    ...valores.map((v) => `  if (indice == ${prefijo}_${identificador(v)}) nucleo_emitirTexto(TEXTO_${prefijo}_${identificador(v)});`),
    "}",
  ]
}

interface ClaveDeRespuesta {
  readonly clave: string
  /** Líneas que emiten el valor (ya con sangría de 2). Si `condicion` existe, van adentro de un `if`. */
  readonly valor: readonly string[]
  readonly condicion?: string
}

/**
 * Un emisor de respuesta con las claves en ORDEN ALFABETICO (sec. 1: JSON canónico). El orden lo decide
 * este `sort`, no quien describe la respuesta: así el C++ y `serializarRespuesta` coinciden byte a byte.
 */
function emisorDeRespuesta(firma: string, claves: readonly ClaveDeRespuesta[]): string[] {
  const ordenadas = [...claves].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
  const l: string[] = [`${firma} {`, "  nucleo_abrirObjeto();"]
  for (const c of ordenadas) {
    const cuerpo = [`nucleo_clave(TEXTO_CLAVE_${identificador(c.clave)});`, ...c.valor]
    if (c.condicion === undefined) l.push(...cuerpo.map((x) => `  ${x}`))
    else l.push(`  if (${c.condicion}) {`, ...cuerpo.map((x) => `    ${x}`), "  }")
  }
  l.push("  nucleo_cerrarObjeto();", "  return g_largoSalida;", "}")
  return l
}

/**
 * Las líneas que emiten un objeto anidado `{...}` con sus claves en ORDEN ALFABETICO (sec. 1), sin pasar
 * por `nucleo_abrirObjeto` (que reinicia la salida): para el `wifi` del `hola` (sec. 8.1).
 */
function objetoAnidado(claves: readonly { readonly clave: string; readonly valor: string }[]): string[] {
  const ordenadas = [...claves].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
  const l: string[] = ["nucleo_emitirByte('{');"]
  ordenadas.forEach((c, i) => {
    if (i > 0) l.push("nucleo_emitirByte(',');")
    l.push(`nucleo_emitirTextoEntreComillas(TEXTO_CLAVE_${identificador(c.clave)});`, "nucleo_emitirByte(':');", c.valor)
  })
  l.push("nucleo_emitirByte('}');")
  return l
}

export function renderizarNucleo(t: TablasDelRuntime): string[] {
  const campos = [...new Set(Object.values(t.camposPorComando).flat())].sort()
  const tipos = ["hola", "pong", "ok", "lectura", "error", "reinicio"]
  const claves = ["campo", "causa", "codigo", "comando", "comandos", "crudo", "nivel", "pin", "placa", "protocolo", "protocolos", "runtime", "tipo", "uptimeMs", ...(t.wifi ? ["clave", "ip", "ssid", "wifi"] : [])]
  const wifi = t.wifi
  if (wifi && !/^(?:[0-9]{8})?$/.test(wifi.clave)) throw new Error('la clave WiFi es "" (red abierta) u 8 digitos decimales (contrato sec. 8.1)')
  const C = (nombre: string) => `COMANDO_${identificador(nombre)}`
  const F = (nombre: string) => `CAMPO_${identificador(nombre)}`
  const E = (nombre: string) => `ERROR_${identificador(nombre)}`
  for (const nombre of [CAMPO_PIN, CAMPO_MODO, CAMPO_NIVEL, CAMPO_PORCENTAJE]) indiceDe(campos, nombre, "el campo")
  for (const nombre of [MODO_SALIDA, MODO_ENTRADA, MODO_ENTRADA_PULL_UP]) indiceDe(t.modos, nombre, "el modo")
  for (const nombre of [NIVEL_ALTO, NIVEL_BAJO]) indiceDe(t.niveles, nombre, "el nivel")
  for (const nombre of ["LINEA_DEMASIADO_LARGA", "LINEA_INVALIDA", "COMANDO_DESCONOCIDO", "CAMPO_FALTANTE", "CAMPO_DESCONOCIDO", "CAMPO_DUPLICADO", "VALOR_INVALIDO", "PIN_INEXISTENTE", "PIN_PROHIBIDO", "PIN_SIN_CAPACIDAD"]) indiceDe(t.codigosDeError, nombre, "el codigo de error")
  const comandosConDespacho = ["hola", "ping", "pin.modo", "digital.escribir", "pwm.escribir", "digital.leer", "analogico.leer"]
  for (const nombre of comandosConDespacho) indiceDe(t.comandos, nombre, "el comando")
  if (t.comandos.length !== comandosConDespacho.length) throw new Error("el nucleo despacha exactamente los 7 comandos de V1; un comando nuevo necesita su despacho")
  // Peor caso de salida: CAMPO_DESCONOCIDO con un comando de 1 byte y un campo que ocupa el resto de la
  // linea (limite - 1 - 1 - 2 bytes) mas el armazon JSON (69 bytes). 128 de margen lo cubre con holgura.
  const tamanoSalida = t.limiteLineaBytes + 128
  // Cada campo ocupa al menos 4 bytes (" k=v") despues del comando de 1 byte y antes del '\n'.
  const maximoCampos = Math.floor((t.limiteLineaBytes - 2) / 4)

  const l: string[] = []
  l.push("// ============================================================================")
  l.push("// CAPA 1: NUCLEO PURO. Sin Arduino, sin reloj, sin puertos: solo enteros y arreglos.")
  l.push("// Parser del formato plano (contrato sec. 1 y sec. 4, mismo orden de errores que vivo/protocolo.ts),")
  l.push("// despacho de los comandos (sec. 2), politica de pines (sec. 5, tablas derivadas de nucleo/placas.ts)")
  l.push("// y salida JSON canonica (sec. 3: claves en orden alfabetico, sin espacios, ASCII).")
  l.push("// Lo que el nucleo necesita del hardware lo pide por las funciones hw_* que define la capa 2.")
  l.push("// ============================================================================")
  l.push("")
  l.push("// --- Contrato ---")
  l.push(`static const uint16_t LIMITE_LINEA_BYTES = ${t.limiteLineaBytes};  // sec. 1: maximo por linea host -> runtime, incluido el '\\n'`)
  l.push(`static const uint16_t TAMANO_SALIDA = ${tamanoSalida};  // peor caso: CAMPO_DESCONOCIDO con un campo que ocupa casi toda la linea`)
  l.push(`static const uint8_t MAXIMO_CAMPOS = ${maximoCampos};  // (limite - 2) / 4: cada campo ocupa al menos " k=v"`)
  l.push(`static const uint8_t ${SIN_INDICE} = 255;`)
  l.push(`static const char TEXTO_PLACA[] = ${literalTexto(t.placaId)};`)
  l.push(`static const char TEXTO_RUNTIME[] = ${literalTexto(t.versionRuntime)};`)
  l.push(`static const uint32_t VERSION_PROTOCOLO = ${t.versionProtocolo};`)
  if (wifi) {
    l.push("")
    l.push("// V4 (sec. 8.1): la red propia que anuncia `hola`. La clave y la IP se deciden al generar; el SSID lo")
    l.push("// arma la capa 3 desde la MAC del punto de acceso y lo deja aca con nucleo_fijarSsid.")
    l.push(`static const char TEXTO_WIFI_CLAVE[] = ${literalTexto(wifi.clave)};  // ${wifi.clave === "" ? '"" = red abierta' : "8 digitos decimales, WPA2"}; el hola la anuncia tal cual`)
    l.push(`static const char TEXTO_WIFI_IP[] = ${literalTexto(wifi.ip.join("."))};  // la IP del punto de acceso, fija`)
    l.push(`static const uint8_t TAMANO_BUFFER_SSID = ${TAMANO_BUFFER_SSID};  // wifi_config_t.ap.ssid es uint8_t[32] (esp_wifi_types.h:260) + el 0 final`)
  }
  l.push("")
  l.push("// Comandos de V1, en el orden en que los anuncia `hola` (sec. 2).")
  t.comandos.forEach((c, i) => l.push(`static const uint8_t ${C(c)} = ${i};`))
  for (const c of t.comandos) l.push(`static const char TEXTO_${C(c)}[] = ${literalTexto(c)};`)
  l.push("")
  l.push("// Campos que aceptan los comandos (sec. 2).")
  campos.forEach((c, i) => l.push(`static const uint8_t ${F(c)} = ${i};`))
  for (const c of campos) l.push(`static const char TEXTO_${F(c)}[] = ${literalTexto(c)};`)
  l.push("")
  l.push("// Codigos de error, estables (sec. 4).")
  t.codigosDeError.forEach((c, i) => l.push(`static const uint8_t ${E(c)} = ${i};`))
  for (const c of t.codigosDeError) l.push(`static const char TEXTO_${E(c)}[] = ${literalTexto(c)};`)
  l.push("")
  l.push("// Modos de pin (sec. 2). 0 es \"sin configurar\"; cada modo vale su indice + 1.")
  l.push("static const uint8_t MODO_SIN_CONFIGURAR = 0;")
  t.modos.forEach((m, i) => l.push(`static const uint8_t MODO_${identificador(m)} = ${i + 1};`))
  for (const m of t.modos) l.push(`static const char TEXTO_MODO_${identificador(m)}[] = ${literalTexto(m)};`)
  l.push("")
  l.push("// Niveles (sec. 2): el nivel electrico es 1 = alto, 0 = bajo.")
  l.push(`static const uint8_t NIVEL_${identificador(NIVEL_BAJO)} = 0;`)
  l.push(`static const uint8_t NIVEL_${identificador(NIVEL_ALTO)} = 1;`)
  for (const n of t.niveles) l.push(`static const char TEXTO_NIVEL_${identificador(n)}[] = ${literalTexto(n)};`)
  l.push("")
  l.push("// Causas de reinicio (sec. 3, evento `reinicio`).")
  t.causasDeReinicio.forEach((c, i) => l.push(`static const uint8_t CAUSA_${identificador(c)} = ${i};`))
  for (const c of t.causasDeReinicio) l.push(`static const char TEXTO_CAUSA_${identificador(c)}[] = ${literalTexto(c)};`)
  l.push("")
  l.push("// Tipos de respuesta y claves JSON (sec. 3).")
  for (const x of tipos) l.push(`static const char TEXTO_TIPO_${identificador(x)}[] = ${literalTexto(x)};`)
  for (const x of claves) l.push(`static const char TEXTO_CLAVE_${identificador(x)}[] = ${literalTexto(x)};`)
  l.push("")
  l.push("// Caracteres de la gramatica (sec. 1), por su codigo ASCII.")
  l.push(`static const char CARACTER_A_MINUSCULA = ${ASCII.minusculaA};`)
  l.push(`static const char CARACTER_Z_MINUSCULA = ${ASCII.minusculaZ};`)
  l.push(`static const char CARACTER_A_MAYUSCULA = ${ASCII.mayusculaA};`)
  l.push(`static const char CARACTER_Z_MAYUSCULA = ${ASCII.mayusculaZ};`)
  l.push(`static const char CARACTER_CERO = ${ASCII.cero};`)
  l.push(`static const char CARACTER_NUEVE = ${ASCII.nueve};`)
  l.push("")
  l.push("// --- Politica de pines (sec. 5), derivada de nucleo/placas.ts para esta placa ---")
  l.push(`static const uint8_t CANTIDAD_DE_PINES = ${t.pines.cantidad};  // GPIO mas alto + 1: tamano de las tablas por pin`)
  l.push("")
  l.push("static bool nucleo_enTabla(const uint8_t tabla[], uint8_t cantidad, uint32_t pin) {")
  l.push("  for (uint8_t i = 0; i < cantidad; i++) {")
  l.push("    if (tabla[i] == pin) return true;")
  l.push("  }")
  l.push("  return false;")
  l.push("}")
  l.push(...predicadoDeTabla("nucleo_pinExiste", "PINES_EXISTENTES", t.pines.existentes, "existen en la placa (incluidos los flash, que se rechazan por prohibidos)"))
  l.push(...predicadoDeTabla("nucleo_pinProhibido", "PINES_PROHIBIDOS", t.pines.prohibidos, "flash y UART0: el runtime los rechaza siempre"))
  l.push(...predicadoDeTabla("nucleo_pinSinEntrada", "PINES_SIN_ENTRADA", t.pines.sinEntrada, "sin entrada digital"))
  l.push(...predicadoDeTabla("nucleo_pinSinSalida", "PINES_SIN_SALIDA", t.pines.sinSalida, "solo entrada: ni salida digital"))
  l.push(...predicadoDeTabla("nucleo_pinSinPwm", "PINES_SIN_PWM", t.pines.sinPwm, "sin PWM"))
  l.push(...predicadoDeTabla("nucleo_pinConAdc", "PINES_CON_ADC", t.pines.conAdc, "ADC permitido (ADC1 en la ESP32)"))
  l.push("")
  l.push("static const uint8_t NECESITA_ENTRADA = 0;")
  l.push("static const uint8_t NECESITA_SALIDA = 1;")
  l.push("static const uint8_t NECESITA_PWM = 2;")
  l.push("static const uint8_t NECESITA_ADC = 3;")
  l.push("")
  l.push("// Orden de la politica, igual que el simulador de referencia: existe -> prohibido -> capacidad.")
  l.push("static uint8_t nucleo_validarPin(uint32_t pin, uint8_t necesita) {")
  l.push(`  if (!nucleo_pinExiste(pin)) return ${E("PIN_INEXISTENTE")};`)
  l.push(`  if (nucleo_pinProhibido(pin)) return ${E("PIN_PROHIBIDO")};`)
  l.push(`  if (necesita == NECESITA_SALIDA && nucleo_pinSinSalida(pin)) return ${E("PIN_SIN_CAPACIDAD")};`)
  l.push(`  if (necesita == NECESITA_PWM && nucleo_pinSinPwm(pin)) return ${E("PIN_SIN_CAPACIDAD")};`)
  l.push(`  if (necesita == NECESITA_ADC && !nucleo_pinConAdc(pin)) return ${E("PIN_SIN_CAPACIDAD")};`)
  l.push(`  if (necesita == NECESITA_ENTRADA && nucleo_pinSinEntrada(pin)) return ${E("PIN_SIN_CAPACIDAD")};`)
  l.push(`  return ${SIN_INDICE};`)
  l.push("}")
  l.push("")
  l.push("// --- Lo que el nucleo le pide al hardware (lo define la capa 2) ---")
  l.push("static void hw_pinModo(uint8_t pin, uint8_t modo);")
  l.push("static void hw_escribirDigital(uint8_t pin, uint8_t nivel);")
  l.push("static bool hw_escribirPwm(uint8_t pin, uint8_t porcentaje);")
  l.push("static uint8_t hw_leerDigital(uint8_t pin);")
  l.push("static uint32_t hw_leerAnalogico(uint8_t pin);")
  l.push("static uint32_t hw_millis();")
  l.push("")
  l.push("// --- Estado del nucleo: buffers fijos, sin heap ---")
  l.push("static char g_linea[LIMITE_LINEA_BYTES + 1];  // la linea recibida, sin el '\\n' (la llena la capa 2)")
  l.push("static char g_salida[TAMANO_SALIDA];  // la respuesta, terminada en 0, sin el '\\n'")
  l.push("static uint16_t g_largoSalida = 0;")
  l.push("static bool g_primeraClave = true;")
  l.push("static uint8_t g_modo[CANTIDAD_DE_PINES];  // modo de cada pin: MODO_SIN_CONFIGURAR al arrancar")
  l.push("static uint8_t g_claveInicio[MAXIMO_CAMPOS];")
  l.push("static uint8_t g_claveLargo[MAXIMO_CAMPOS];")
  l.push("static uint8_t g_valorInicio[MAXIMO_CAMPOS];")
  l.push("static uint8_t g_valorLargo[MAXIMO_CAMPOS];")
  l.push("static uint8_t g_cantidadCampos = 0;")
  l.push("static uint8_t g_largoComando = 0;")
  l.push("static uint32_t g_enteroLeido = 0;")
  if (wifi) {
    l.push("static char g_ssid[TAMANO_BUFFER_SSID];  // el SSID que levanto la capa 3; vacio = la red no esta levantada")
    l.push("static uint8_t g_largoSsid = 0;  // 0 hasta que la capa 3 fija el SSID: `hola` solo anuncia la red si existe")
  }
  l.push("")
  l.push("// --- Salida JSON canonica (sec. 3): sin espacios, claves en orden alfabetico, solo ASCII ---")
  l.push("// Los textos que salen (nombres de comando y de campo tomados de la linea) vienen de la gramatica")
  l.push("// de sec. 1, que no admite comillas ni barras: no hace falta escapar nada.")
  l.push("static void nucleo_emitirByte(char c) {")
  l.push("  if (g_largoSalida + 1 < TAMANO_SALIDA) {")
  l.push("    g_salida[g_largoSalida] = c;")
  l.push("    g_largoSalida++;")
  l.push("  }")
  l.push("}")
  l.push("static void nucleo_emitirTexto(const char texto[]) {")
  l.push("  for (uint16_t i = 0; texto[i] != '\\0'; i++) {")
  l.push("    nucleo_emitirByte(texto[i]);")
  l.push("  }")
  l.push("}")
  l.push("static void nucleo_emitirTramo(uint8_t inicio, uint8_t largo) {")
  l.push("  for (uint8_t i = 0; i < largo; i++) {")
  l.push("    nucleo_emitirByte(g_linea[inicio + i]);")
  l.push("  }")
  l.push("}")
  l.push("static void nucleo_emitirEntero(uint32_t valor) {")
  l.push("  char digitos[10];  // 4294967295 tiene 10 digitos")
  l.push("  uint8_t cantidad = 0;")
  l.push("  if (valor == 0) {")
  l.push("    nucleo_emitirByte(CARACTER_CERO);")
  l.push("    return;")
  l.push("  }")
  l.push("  while (valor > 0) {")
  l.push("    digitos[cantidad] = (char)(CARACTER_CERO + valor % 10);")
  l.push("    cantidad++;")
  l.push("    valor = valor / 10;")
  l.push("  }")
  l.push("  while (cantidad > 0) {")
  l.push("    cantidad--;")
  l.push("    nucleo_emitirByte(digitos[cantidad]);")
  l.push("  }")
  l.push("}")
  l.push("static void nucleo_emitirTextoEntreComillas(const char texto[]) {")
  l.push("  nucleo_emitirByte('\"');")
  l.push("  nucleo_emitirTexto(texto);")
  l.push("  nucleo_emitirByte('\"');")
  l.push("}")
  l.push("static void nucleo_abrirObjeto() {")
  l.push("  g_largoSalida = 0;")
  l.push("  g_primeraClave = true;")
  l.push("  nucleo_emitirByte('{');")
  l.push("}")
  l.push("static void nucleo_clave(const char nombre[]) {")
  l.push("  if (!g_primeraClave) nucleo_emitirByte(',');")
  l.push("  g_primeraClave = false;")
  l.push("  nucleo_emitirTextoEntreComillas(nombre);")
  l.push("  nucleo_emitirByte(':');")
  l.push("}")
  l.push("static void nucleo_cerrarObjeto() {")
  l.push("  nucleo_emitirByte('}');")
  l.push("  g_salida[g_largoSalida] = '\\0';")
  l.push("}")
  l.push(...emisorPorIndice("nucleo_emitirComando", "COMANDO", t.comandos))
  l.push(...emisorPorIndice("nucleo_emitirCampo", "CAMPO", campos))
  l.push(...emisorPorIndice("nucleo_emitirCodigoDeError", "ERROR", t.codigosDeError))
  l.push(...emisorPorIndice("nucleo_emitirCausa", "CAUSA", t.causasDeReinicio))
  l.push("static void nucleo_emitirNivel(uint8_t nivel) {")
  l.push(`  if (nivel == NIVEL_${identificador(NIVEL_ALTO)}) nucleo_emitirTextoEntreComillas(TEXTO_NIVEL_${identificador(NIVEL_ALTO)});`)
  l.push(`  else nucleo_emitirTextoEntreComillas(TEXTO_NIVEL_${identificador(NIVEL_BAJO)});`)
  l.push("}")
  l.push("")
  l.push("// Respuestas (sec. 3). Cada una deja la linea en g_salida y devuelve su largo. El orden de las claves")
  l.push("// lo fijo el generador ordenandolas alfabeticamente; no lo decide quien escribe la respuesta.")
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderHola()", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_HOLA);"] },
      { clave: "runtime", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_RUNTIME);"] },
      { clave: "protocolo", valor: ["nucleo_emitirEntero(VERSION_PROTOCOLO);"] },
      { clave: "placa", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_PLACA);"] },
      {
        clave: "comandos",
        valor: ["nucleo_emitirByte('[');", ...t.comandos.flatMap((c, i) => [...(i > 0 ? ["nucleo_emitirByte(',');"] : []), `nucleo_emitirTextoEntreComillas(TEXTO_${C(c)});`]), "nucleo_emitirByte(']');"],
      },
      { clave: "protocolos", valor: ["nucleo_emitirByte('[');  // V1 no implementa protocolos de sensor (sec. 3)", "nucleo_emitirByte(']');"] },
      ...(wifi
        ? [
            {
              clave: "wifi",
              // Un OK falso es peor que un error: si el punto de acceso no levanto, `hola` no anuncia ninguna red.
              condicion: "g_largoSsid > 0",
              valor: objetoAnidado([
                { clave: "ssid", valor: "nucleo_emitirTextoEntreComillas(g_ssid);" },
                { clave: "clave", valor: "nucleo_emitirTextoEntreComillas(TEXTO_WIFI_CLAVE);" },
                { clave: "ip", valor: "nucleo_emitirTextoEntreComillas(TEXTO_WIFI_IP);" },
              ]),
            },
          ]
        : []),
    ]),
  )
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderPong(uint32_t uptimeMs)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_PONG);"] },
      { clave: "uptimeMs", valor: ["nucleo_emitirEntero(uptimeMs);"] },
    ]),
  )
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderOk(uint8_t comando, uint32_t pin)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_OK);"] },
      { clave: "comando", valor: ["nucleo_emitirByte('\"');", "nucleo_emitirComando(comando);", "nucleo_emitirByte('\"');"] },
      { clave: "pin", valor: ["nucleo_emitirEntero(pin);"] },
    ]),
  )
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderLecturaNivel(uint32_t pin, uint8_t nivel)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_LECTURA);"] },
      { clave: "pin", valor: ["nucleo_emitirEntero(pin);"] },
      { clave: "nivel", valor: ["nucleo_emitirNivel(nivel);"] },
    ]),
  )
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderLecturaCrudo(uint32_t pin, uint32_t crudo)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_LECTURA);"] },
      { clave: "pin", valor: ["nucleo_emitirEntero(pin);"] },
      { clave: "crudo", valor: ["nucleo_emitirEntero(crudo);"] },
    ]),
  )
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderReinicio(uint8_t causa)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_REINICIO);"] },
      { clave: "causa", valor: ["nucleo_emitirByte('\"');", "nucleo_emitirCausa(causa);", "nucleo_emitirByte('\"');"] },
    ]),
  )
  l.push("// `error` (sec. 4): `comando` es siempre el primer tramo de la linea (largo 0 = sin comando); el campo")
  l.push("// es un tramo de la linea (desconocido o duplicado) o un campo de la tabla (faltante o invalido).")
  l.push(
    ...emisorDeRespuesta("static uint16_t nucleo_responderError(uint8_t codigo, uint8_t largoComando, uint8_t campoInicio, uint8_t campoLargo, uint8_t campoIndice, bool conPin, uint32_t pin)", [
      { clave: "tipo", valor: ["nucleo_emitirTextoEntreComillas(TEXTO_TIPO_ERROR);"] },
      { clave: "codigo", valor: ["nucleo_emitirByte('\"');", "nucleo_emitirCodigoDeError(codigo);", "nucleo_emitirByte('\"');"] },
      { clave: "comando", condicion: "largoComando > 0", valor: ["nucleo_emitirByte('\"');", "nucleo_emitirTramo(0, largoComando);", "nucleo_emitirByte('\"');"] },
      {
        clave: "campo",
        condicion: `campoLargo > 0 || campoIndice != ${SIN_INDICE}`,
        valor: ["nucleo_emitirByte('\"');", "if (campoLargo > 0) nucleo_emitirTramo(campoInicio, campoLargo);", "else nucleo_emitirCampo(campoIndice);", "nucleo_emitirByte('\"');"],
      },
      { clave: "pin", condicion: "conPin", valor: ["nucleo_emitirEntero(pin);"] },
    ]),
  )
  l.push("static uint16_t nucleo_errorDeLinea(uint8_t codigo) {")
  l.push(`  return nucleo_responderError(codigo, 0, 0, 0, ${SIN_INDICE}, false, 0);`)
  l.push("}")
  l.push("static uint16_t nucleo_errorDeCampoEnLinea(uint8_t codigo, uint8_t campoInicio, uint8_t campoLargo) {")
  l.push(`  return nucleo_responderError(codigo, g_largoComando, campoInicio, campoLargo, ${SIN_INDICE}, false, 0);`)
  l.push("}")
  l.push("static uint16_t nucleo_errorDeCampo(uint8_t codigo, uint8_t campo) {")
  l.push("  return nucleo_responderError(codigo, g_largoComando, 0, 0, campo, false, 0);")
  l.push("}")
  l.push("static uint16_t nucleo_errorDePin(uint8_t codigo, uint32_t pin) {")
  l.push(`  return nucleo_responderError(codigo, g_largoComando, 0, 0, ${SIN_INDICE}, true, pin);`)
  l.push("}")
  l.push("")
  l.push("// --- Gramatica (sec. 1): nombres [a-z][a-z0-9.]*, valores [A-Za-z0-9_.-]+, enteros decimales sin signo ---")
  l.push("static bool nucleo_esMinuscula(char c) {")
  l.push("  return c >= CARACTER_A_MINUSCULA && c <= CARACTER_Z_MINUSCULA;")
  l.push("}")
  l.push("static bool nucleo_esMayuscula(char c) {")
  l.push("  return c >= CARACTER_A_MAYUSCULA && c <= CARACTER_Z_MAYUSCULA;")
  l.push("}")
  l.push("static bool nucleo_esDigito(char c) {")
  l.push("  return c >= CARACTER_CERO && c <= CARACTER_NUEVE;")
  l.push("}")
  l.push("// El `\\s` ASCII de JS (la referencia usa trim() y /\\s\\s/): espacio, tab, salto, vertical, form feed, retorno.")
  l.push("static bool nucleo_esBlanco(char c) {")
  l.push("  return c == ' ' || c == '\\t' || c == '\\n' || c == '\\v' || c == '\\f' || c == '\\r';")
  l.push("}")
  l.push("static bool nucleo_esNombre(uint8_t inicio, uint8_t largo) {")
  l.push("  if (largo == 0 || !nucleo_esMinuscula(g_linea[inicio])) return false;")
  l.push("  for (uint8_t i = 1; i < largo; i++) {")
  l.push("    char c = g_linea[inicio + i];")
  l.push("    if (!nucleo_esMinuscula(c) && !nucleo_esDigito(c) && c != '.') return false;")
  l.push("  }")
  l.push("  return true;")
  l.push("}")
  l.push("static bool nucleo_esValor(uint8_t inicio, uint8_t largo) {")
  l.push("  if (largo == 0) return false;")
  l.push("  for (uint8_t i = 0; i < largo; i++) {")
  l.push("    char c = g_linea[inicio + i];")
  l.push("    if (!nucleo_esMinuscula(c) && !nucleo_esMayuscula(c) && !nucleo_esDigito(c) && c != '_' && c != '.' && c != '-') return false;")
  l.push("  }")
  l.push("  return true;")
  l.push("}")
  l.push("// Entero decimal sin signo, sin ceros a la izquierda (^(0|[1-9][0-9]*)$). Deja el valor en g_enteroLeido.")
  l.push("// Un valor que no entra en 32 bits se rechaza como invalido: el contrato no acota el largo, pero un pin o")
  l.push("// un porcentaje de mas de 4294967295 no significa nada en esta placa.")
  l.push("static bool nucleo_leerEntero(uint8_t inicio, uint8_t largo) {")
  l.push("  if (largo == 0 || largo > 10) return false;")
  l.push("  if (largo > 1 && g_linea[inicio] == CARACTER_CERO) return false;")
  l.push("  uint32_t valor = 0;")
  l.push("  for (uint8_t i = 0; i < largo; i++) {")
  l.push("    char c = g_linea[inicio + i];")
  l.push("    if (!nucleo_esDigito(c)) return false;")
  l.push("    uint32_t digito = c - CARACTER_CERO;")
  l.push("    if (valor > 429496729 || (valor == 429496729 && digito > 5)) return false;")
  l.push("    valor = valor * 10 + digito;")
  l.push("  }")
  l.push("  g_enteroLeido = valor;")
  l.push("  return true;")
  l.push("}")
  l.push("static bool nucleo_tramoEs(uint8_t inicio, uint8_t largo, const char texto[]) {")
  l.push("  for (uint8_t i = 0; i < largo; i++) {")
  l.push("    if (texto[i] == '\\0' || texto[i] != g_linea[inicio + i]) return false;")
  l.push("  }")
  l.push("  return texto[largo] == '\\0';")
  l.push("}")
  l.push("static bool nucleo_tramosIguales(uint8_t inicioA, uint8_t largoA, uint8_t inicioB, uint8_t largoB) {")
  l.push("  if (largoA != largoB) return false;")
  l.push("  for (uint8_t i = 0; i < largoA; i++) {")
  l.push("    if (g_linea[inicioA + i] != g_linea[inicioB + i]) return false;")
  l.push("  }")
  l.push("  return true;")
  l.push("}")
  if (wifi) {
    l.push("// V4: el SSID que la capa 3 dejo (armado desde la MAC o fijado al generar). Se acepta solo si cabe y es ASCII")
    l.push("// imprimible sin comillas ni barra invertida, porque sale en el JSON sin escapar; si no, la red no se anuncia.")
    l.push("static bool nucleo_esCaracterDeSsid(char c) {")
    l.push("  return c >= ' ' && c <= '~' && c != '\"' && c != '\\\\';")
    l.push("}")
    l.push("static void nucleo_fijarSsid(const char texto[]) {")
    l.push("  uint8_t largo = 0;")
    l.push("  g_largoSsid = 0;")
    l.push("  while (texto[largo] != '\\0') {")
    l.push("    if (largo + 1 >= TAMANO_BUFFER_SSID || !nucleo_esCaracterDeSsid(texto[largo])) return;")
    l.push("    g_ssid[largo] = texto[largo];")
    l.push("    largo++;")
    l.push("  }")
    l.push("  g_ssid[largo] = '\\0';")
    l.push("  g_largoSsid = largo;")
    l.push("}")
  }
  l.push(...buscadorPorTexto("nucleo_indiceDeComando", "COMANDO", t.comandos))
  l.push(...buscadorPorTexto("nucleo_indiceDeCampo", "CAMPO", campos))
  l.push(...buscadorPorTexto("nucleo_indiceDeModo", "MODO", t.modos))
  l.push(...buscadorPorTexto("nucleo_indiceDeNivel", "NIVEL", t.niveles))
  l.push("")
  l.push("// --- Campos por comando (sec. 2) ---")
  l.push("static bool nucleo_comandoAceptaCampo(uint8_t comando, uint8_t campo) {")
  for (const c of t.comandos) {
    const esperados = t.camposPorComando[c] ?? []
    l.push(`  if (comando == ${C(c)}) return ${esperados.length === 0 ? "false" : esperados.map((f) => `campo == ${F(f)}`).join(" || ")};`)
  }
  l.push("  return false;")
  l.push("}")
  l.push("static uint8_t nucleo_cantidadDeCamposEsperados(uint8_t comando) {")
  for (const c of t.comandos) l.push(`  if (comando == ${C(c)}) return ${(t.camposPorComando[c] ?? []).length};`)
  l.push("  return 0;")
  l.push("}")
  l.push("// El campo esperado en cada posicion: el orden en que se reclaman como faltantes.")
  l.push("static uint8_t nucleo_campoEsperado(uint8_t comando, uint8_t posicion) {")
  for (const c of t.comandos) (t.camposPorComando[c] ?? []).forEach((f, i) => l.push(`  if (comando == ${C(c)} && posicion == ${i}) return ${F(f)};`))
  l.push(`  return ${SIN_INDICE};`)
  l.push("}")
  l.push("// Posicion (en la linea) del campo con ese indice, o SIN_INDICE si no vino.")
  l.push("static uint8_t nucleo_posicionDeCampo(uint8_t campo) {")
  l.push("  for (uint8_t i = 0; i < g_cantidadCampos; i++) {")
  l.push("    if (nucleo_indiceDeCampo(g_claveInicio[i], g_claveLargo[i]) == campo) return i;")
  l.push("  }")
  l.push(`  return ${SIN_INDICE};`)
  l.push("}")
  l.push("")
  l.push("// --- Despacho (sec. 2) ---")
  l.push("static void nucleo_asegurarModo(uint8_t pin, uint8_t modo) {")
  l.push("  if (g_modo[pin] != modo) {")
  l.push("    hw_pinModo(pin, modo);")
  l.push("    g_modo[pin] = modo;")
  l.push("  }")
  l.push("}")
  l.push("static uint16_t nucleo_ejecutarPinModo(uint32_t pin) {")
  l.push(`  uint8_t posicion = nucleo_posicionDeCampo(${F(CAMPO_MODO)});`)
  l.push("  uint8_t modo = nucleo_indiceDeModo(g_valorInicio[posicion], g_valorLargo[posicion]);")
  l.push(`  if (modo == ${SIN_INDICE}) return nucleo_errorDeCampo(${E("VALOR_INVALIDO")}, ${F(CAMPO_MODO)});`)
  l.push(`  uint8_t error = nucleo_validarPin(pin, modo == MODO_${identificador(MODO_SALIDA)} ? NECESITA_SALIDA : NECESITA_ENTRADA);`)
  l.push(`  if (error != ${SIN_INDICE}) return nucleo_errorDePin(error, pin);`)
  l.push("  hw_pinModo((uint8_t)pin, modo);")
  l.push("  g_modo[pin] = modo;")
  l.push(`  return nucleo_responderOk(${C("pin.modo")}, pin);`)
  l.push("}")
  l.push("static uint16_t nucleo_ejecutarDigitalEscribir(uint32_t pin) {")
  l.push(`  uint8_t posicion = nucleo_posicionDeCampo(${F(CAMPO_NIVEL)});`)
  l.push("  uint8_t nivel = nucleo_indiceDeNivel(g_valorInicio[posicion], g_valorLargo[posicion]);")
  l.push(`  if (nivel == ${SIN_INDICE}) return nucleo_errorDeCampo(${E("VALOR_INVALIDO")}, ${F(CAMPO_NIVEL)});`)
  l.push("  uint8_t error = nucleo_validarPin(pin, NECESITA_SALIDA);")
  l.push(`  if (error != ${SIN_INDICE}) return nucleo_errorDePin(error, pin);`)
  l.push(`  nucleo_asegurarModo((uint8_t)pin, MODO_${identificador(MODO_SALIDA)});  // sec. 2: configura el pin como salida si hace falta`)
  l.push(`  hw_escribirDigital((uint8_t)pin, nivel == NIVEL_${identificador(NIVEL_ALTO)} ? NIVEL_${identificador(NIVEL_ALTO)} : NIVEL_${identificador(NIVEL_BAJO)});`)
  l.push(`  return nucleo_responderOk(${C("digital.escribir")}, pin);`)
  l.push("}")
  l.push("static uint16_t nucleo_ejecutarPwmEscribir(uint32_t pin) {")
  l.push(`  uint8_t posicion = nucleo_posicionDeCampo(${F(CAMPO_PORCENTAJE)});`)
  l.push(`  if (!nucleo_leerEntero(g_valorInicio[posicion], g_valorLargo[posicion]) || g_enteroLeido > 100) return nucleo_errorDeCampo(${E("VALOR_INVALIDO")}, ${F(CAMPO_PORCENTAJE)});`)
  l.push("  uint8_t porcentaje = (uint8_t)g_enteroLeido;")
  l.push("  uint8_t error = nucleo_validarPin(pin, NECESITA_PWM);")
  l.push(`  if (error != ${SIN_INDICE}) return nucleo_errorDePin(error, pin);`)
  l.push("  // La capa 2 configura el pin como salida al enganchar el PWM; si se quedo sin canales, el pin no")
  l.push("  // puede hacer PWM ahora: se informa como PIN_SIN_CAPACIDAD antes que responder un `ok` falso.")
  l.push(`  if (!hw_escribirPwm((uint8_t)pin, porcentaje)) return nucleo_errorDePin(${E("PIN_SIN_CAPACIDAD")}, pin);`)
  l.push(`  g_modo[pin] = MODO_${identificador(MODO_SALIDA)};`)
  l.push(`  return nucleo_responderOk(${C("pwm.escribir")}, pin);`)
  l.push("}")
  l.push("static uint16_t nucleo_ejecutarDigitalLeer(uint32_t pin) {")
  l.push("  uint8_t error = nucleo_validarPin(pin, NECESITA_ENTRADA);")
  l.push(`  if (error != ${SIN_INDICE}) return nucleo_errorDePin(error, pin);`)
  l.push(`  if (g_modo[pin] == MODO_SIN_CONFIGURAR) nucleo_asegurarModo((uint8_t)pin, MODO_${identificador(MODO_ENTRADA)});  // sec. 2: sin configurar -> entrada`)
  l.push("  return nucleo_responderLecturaNivel(pin, hw_leerDigital((uint8_t)pin));")
  l.push("}")
  l.push("static uint16_t nucleo_ejecutarAnalogicoLeer(uint32_t pin) {")
  l.push("  uint8_t error = nucleo_validarPin(pin, NECESITA_ADC);")
  l.push(`  if (error != ${SIN_INDICE}) return nucleo_errorDePin(error, pin);`)
  l.push("  return nucleo_responderLecturaCrudo(pin, hw_leerAnalogico((uint8_t)pin));")
  l.push("}")
  l.push("static uint16_t nucleo_ejecutar(uint8_t comando) {")
  l.push(`  if (comando == ${C("hola")}) return nucleo_responderHola();`)
  l.push(`  if (comando == ${C("ping")}) return nucleo_responderPong(hw_millis());`)
  l.push("  // Todos los demas llevan `pin`: se valida primero, igual que la referencia.")
  l.push(`  uint8_t posicionPin = nucleo_posicionDeCampo(${F(CAMPO_PIN)});`)
  l.push(`  if (!nucleo_leerEntero(g_valorInicio[posicionPin], g_valorLargo[posicionPin])) return nucleo_errorDeCampo(${E("VALOR_INVALIDO")}, ${F(CAMPO_PIN)});`)
  l.push("  uint32_t pin = g_enteroLeido;")
  l.push(`  if (comando == ${C("pin.modo")}) return nucleo_ejecutarPinModo(pin);`)
  l.push(`  if (comando == ${C("digital.escribir")}) return nucleo_ejecutarDigitalEscribir(pin);`)
  l.push(`  if (comando == ${C("pwm.escribir")}) return nucleo_ejecutarPwmEscribir(pin);`)
  l.push(`  if (comando == ${C("digital.leer")}) return nucleo_ejecutarDigitalLeer(pin);`)
  l.push(`  return nucleo_ejecutarAnalogicoLeer(pin);`)
  l.push("}")
  l.push("")
  l.push("// --- Parser (sec. 1 y sec. 4), en el MISMO orden que vivo/protocolo.ts::parsearLineaDeComando ---")
  l.push("// largo -> forma (bordes y blancos dobles, nombre del comando, cada campo en orden: forma y duplicado)")
  l.push("// -> comando conocido -> campos desconocidos (en orden) -> faltantes (en orden) -> valores (pin primero).")
  l.push("// Procesa la linea que la capa 2 dejo en g_linea (sin el '\\n'); `largo` mayor al limite significa")
  l.push("// que la capa 2 ya la descarto por larga. Devuelve el largo de g_salida, 0 si no hay nada que responder.")
  l.push("static uint16_t nucleo_procesar(uint16_t largo) {")
  l.push("  if (largo > 0 && largo <= LIMITE_LINEA_BYTES && g_linea[largo - 1] == '\\r') largo--;  // sec. 1: se acepta \\r\\n")
  l.push(`  if (largo + 1 > LIMITE_LINEA_BYTES) return nucleo_errorDeLinea(${E("LINEA_DEMASIADO_LARGA")});`)
  l.push("  if (largo == 0) return 0;  // sec. 1: una linea vacia se ignora")
  l.push(`  if (nucleo_esBlanco(g_linea[0]) || nucleo_esBlanco(g_linea[largo - 1])) return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});`)
  l.push("  for (uint16_t i = 1; i < largo; i++) {")
  l.push(`    if (nucleo_esBlanco(g_linea[i - 1]) && nucleo_esBlanco(g_linea[i])) return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});`)
  l.push("  }")
  l.push("  uint8_t i = 0;")
  l.push("  while (i < largo && g_linea[i] != ' ') i++;")
  l.push("  g_largoComando = i;")
  l.push(`  if (!nucleo_esNombre(0, g_largoComando)) return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});`)
  l.push("  g_cantidadCampos = 0;")
  l.push("  while (i < largo) {")
  l.push("    i++;  // el espacio")
  l.push("    uint8_t claveInicio = i;")
  l.push("    while (i < largo && g_linea[i] != ' ' && g_linea[i] != '=') i++;")
  l.push(`    if (i >= largo || g_linea[i] != '=') return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});`)
  l.push("    uint8_t claveLargo = i - claveInicio;")
  l.push("    i++;  // el '='")
  l.push("    uint8_t valorInicio = i;")
  l.push("    while (i < largo && g_linea[i] != ' ') i++;")
  l.push("    uint8_t valorLargo = i - valorInicio;")
  l.push(`    if (!nucleo_esNombre(claveInicio, claveLargo) || !nucleo_esValor(valorInicio, valorLargo)) return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});`)
  l.push("    for (uint8_t k = 0; k < g_cantidadCampos; k++) {")
  l.push(`      if (nucleo_tramosIguales(g_claveInicio[k], g_claveLargo[k], claveInicio, claveLargo)) return nucleo_errorDeCampoEnLinea(${E("CAMPO_DUPLICADO")}, claveInicio, claveLargo);`)
  l.push("    }")
  l.push(`    if (g_cantidadCampos >= MAXIMO_CAMPOS) return nucleo_errorDeLinea(${E("LINEA_INVALIDA")});  // inalcanzable con el limite de linea; guarda el arreglo`)
  l.push("    g_claveInicio[g_cantidadCampos] = claveInicio;")
  l.push("    g_claveLargo[g_cantidadCampos] = claveLargo;")
  l.push("    g_valorInicio[g_cantidadCampos] = valorInicio;")
  l.push("    g_valorLargo[g_cantidadCampos] = valorLargo;")
  l.push("    g_cantidadCampos++;")
  l.push("  }")
  l.push("  uint8_t comando = nucleo_indiceDeComando(0, g_largoComando);")
  l.push(`  if (comando == ${SIN_INDICE}) return nucleo_responderError(${E("COMANDO_DESCONOCIDO")}, g_largoComando, 0, 0, ${SIN_INDICE}, false, 0);`)
  l.push("  for (uint8_t k = 0; k < g_cantidadCampos; k++) {")
  l.push("    uint8_t campo = nucleo_indiceDeCampo(g_claveInicio[k], g_claveLargo[k]);")
  l.push(`    if (campo == ${SIN_INDICE} || !nucleo_comandoAceptaCampo(comando, campo)) return nucleo_errorDeCampoEnLinea(${E("CAMPO_DESCONOCIDO")}, g_claveInicio[k], g_claveLargo[k]);`)
  l.push("  }")
  l.push("  uint8_t esperados = nucleo_cantidadDeCamposEsperados(comando);")
  l.push("  for (uint8_t k = 0; k < esperados; k++) {")
  l.push("    uint8_t campo = nucleo_campoEsperado(comando, k);")
  l.push(`    if (nucleo_posicionDeCampo(campo) == ${SIN_INDICE}) return nucleo_errorDeCampo(${E("CAMPO_FALTANTE")}, campo);`)
  l.push("  }")
  l.push("  return nucleo_ejecutar(comando);")
  l.push("}")
  return l
}

// ════════════════════════════════════════════════════════════════════════════════════
// Capa 2 — transporte serie sobre Arduino (arduino-esp32 2.0.17)
// ════════════════════════════════════════════════════════════════════════════════════

export function renderizarTransporte(t: TablasDelRuntime, opciones: OpcionesDeTransporte): string[] {
  const modo = (nombre: string) => `MODO_${identificador(nombre)}`
  const causa = (nombre: string) => `CAUSA_${identificador(nombre)}`
  for (const nombre of [CAUSA_ENCENDIDO, CAUSA_SOFTWARE, CAUSA_BROWNOUT, CAUSA_WATCHDOG, CAUSA_OTRO]) indiceDe(t.causasDeReinicio, nombre, "la causa de reinicio")
  const l: string[] = []
  l.push("// ============================================================================")
  l.push("// CAPA 2: TRANSPORTE SERIE. Lo unico que toca Arduino: mueve lineas y cumple los pedidos hw_*.")
  l.push("// Citas: fuentes instaladas de arduino-esp32 2.0.17 (framework-arduinoespressif32 de espressif32@6.12.0).")
  l.push("// ============================================================================")
  l.push("")
  l.push(`static const uint32_t VELOCIDAD_SERIE = ${opciones.velocidadSerie};  // contrato: USB serie, 115200 8N1 (SERIAL_8N1 es el config por defecto de begin, HardwareSerial.h:230)`)
  l.push("static uint16_t g_largoRecibido = 0;")
  l.push("static bool g_descartando = false;  // la linea supero el limite: se descarta hasta el '\\n' y se responde LINEA_DEMASIADO_LARGA")
  l.push("")
  l.push("// LEDC (PWM): un canal por pin, a 5 kHz y 8 bits (contrato sec. 2). El core trae 16 canales en la ESP32:")
  l.push("// LEDC_CHANNELS = SOC_LEDC_CHANNEL_NUM << 1 con SOC_LEDC_SUPPORT_HS_MODE (esp32-hal-ledc.c:19-21;")
  l.push("// soc_caps.h:175-176). API: ledcSetup(canal, hz, bits) devuelve 0 si fallo (esp32-hal-ledc.c:57-80),")
  l.push("// ledcAttachPin(pin, canal) (esp32-hal-ledc.c:163-181), ledcWrite(canal, duty) (:82), ledcDetachPin(pin) (:183-186).")
  l.push("static const uint8_t CANTIDAD_CANALES_LEDC = 16;")
  l.push("static const uint32_t PWM_FRECUENCIA_HZ = 5000;")
  l.push("static const uint8_t PWM_BITS = 8;")
  l.push("static const uint32_t PWM_DUTY_MAXIMO = 255;  // 2^8 - 1")
  l.push("static const uint8_t SIN_CANAL = 255;")
  l.push("static uint8_t g_canalDePin[CANTIDAD_DE_PINES];  // SIN_CANAL si el pin no tiene PWM enganchado")
  l.push("static bool g_canalOcupado[CANTIDAD_CANALES_LEDC];")
  l.push("")
  l.push("// Suelta el PWM del pin y lo deja como salida digital comun. ledcDetachPin solo reenruta la matriz de salida")
  l.push("// al registro GPIO (esp32-hal-matrix.c:43-46) y ledcAttachPin nunca paso por pinMode: el pinMode(OUTPUT) de")
  l.push("// aca deja la entrada habilitada (OUTPUT = 0x03 incluye INPUT, esp32-hal-gpio.h:45-48), asi digitalRead relee el pin.")
  l.push("static void hw_soltarPwm(uint8_t pin) {")
  l.push("  uint8_t canal = g_canalDePin[pin];")
  l.push("  if (canal == SIN_CANAL) return;")
  l.push("  ledcDetachPin(pin);")
  l.push("  g_canalOcupado[canal] = false;")
  l.push("  g_canalDePin[pin] = SIN_CANAL;")
  l.push("  pinMode(pin, OUTPUT);")
  l.push("}")
  l.push("")
  l.push("// pinMode(pin, INPUT | INPUT_PULLUP | OUTPUT): esp32-hal-gpio.h:45-50 (INPUT 0x01, OUTPUT 0x03, INPUT_PULLUP 0x05);")
  l.push("// __pinMode configura direccion y pull-up con gpio_config (esp32-hal-gpio.c:231 y el cuerpo de __pinMode).")
  l.push("static void hw_pinModo(uint8_t pin, uint8_t modo) {")
  l.push("  hw_soltarPwm(pin);")
  l.push(`  if (modo == ${modo(MODO_SALIDA)}) pinMode(pin, OUTPUT);`)
  l.push(`  else if (modo == ${modo(MODO_ENTRADA_PULL_UP)}) pinMode(pin, INPUT_PULLUP);`)
  l.push("  else pinMode(pin, INPUT);")
  l.push("}")
  l.push("")
  l.push("// digitalWrite(pin, HIGH | LOW): esp32-hal-gpio.h:41-42 (LOW 0, HIGH 1), :75. El nucleo ya dejo el pin como salida.")
  l.push("static void hw_escribirDigital(uint8_t pin, uint8_t nivel) {")
  l.push("  hw_soltarPwm(pin);")
  l.push(`  digitalWrite(pin, nivel == NIVEL_${identificador(NIVEL_ALTO)} ? HIGH : LOW);`)
  l.push("}")
  l.push("")
  l.push("// 0 y 100 % son niveles fijos (contrato sec. 2): se suelta el PWM y se escribe el nivel. El resto va por LEDC;")
  l.push("// el duty se redondea al entero mas cercano de 0..255. Devuelve false si no quedan canales libres.")
  l.push("static bool hw_escribirPwm(uint8_t pin, uint8_t porcentaje) {")
  l.push("  if (porcentaje == 0 || porcentaje == 100) {")
  l.push("    hw_soltarPwm(pin);")
  l.push("    pinMode(pin, OUTPUT);")
  l.push("    digitalWrite(pin, porcentaje == 100 ? HIGH : LOW);")
  l.push("    return true;")
  l.push("  }")
  l.push("  uint8_t canal = g_canalDePin[pin];")
  l.push("  if (canal == SIN_CANAL) {")
  l.push("    for (uint8_t c = 0; c < CANTIDAD_CANALES_LEDC; c++) {")
  l.push("      if (!g_canalOcupado[c]) {")
  l.push("        canal = c;")
  l.push("        break;")
  l.push("      }")
  l.push("    }")
  l.push("    if (canal == SIN_CANAL) return false;")
  l.push("    if (ledcSetup(canal, PWM_FRECUENCIA_HZ, PWM_BITS) == 0) return false;")
  l.push("    ledcAttachPin(pin, canal);")
  l.push("    g_canalOcupado[canal] = true;")
  l.push("    g_canalDePin[pin] = canal;")
  l.push("  }")
  l.push("  ledcWrite(canal, (porcentaje * PWM_DUTY_MAXIMO + 50) / 100);")
  l.push("  return true;")
  l.push("}")
  l.push("")
  l.push("// digitalRead: esp32-hal-gpio.h:76; lee el nivel real del pin (gpio_get_level), tambien en una salida.")
  l.push("static uint8_t hw_leerDigital(uint8_t pin) {")
  l.push(`  return digitalRead(pin) == HIGH ? NIVEL_${identificador(NIVEL_ALTO)} : NIVEL_${identificador(NIVEL_BAJO)};`)
  l.push("}")
  l.push("")
  l.push("// analogRead devuelve 12 bits (0..4095) por defecto en la ESP32: __analogReturnedWidth = SOC_ADC_MAX_BITWIDTH")
  l.push("// (esp32-hal-adc.c:29, soc_caps.h:100), atenuacion 11 dB por defecto (esp32-hal-adc.c:27).")
  l.push("static uint32_t hw_leerAnalogico(uint8_t pin) {")
  l.push("  return analogRead(pin);")
  l.push("}")
  l.push("")
  l.push("// millis(): esp32-hal.h:137; milisegundos desde el arranque (uptimeMs del `pong`).")
  l.push("static uint32_t hw_millis() {")
  l.push("  return millis();")
  l.push("}")
  l.push("")
  l.push("// Causa del ultimo reinicio (MODO-VIVO-PLAN.md sec. 10.6): esp_reset_reason() (esp_system.h:98) y sus valores")
  l.push("// esp_reset_reason_t (esp_system.h:42-52). POWERON -> encendido; SW (esp_restart) -> software; BROWNOUT ->")
  l.push("// brownout; INT_WDT, TASK_WDT y WDT -> watchdog; el resto (UNKNOWN, EXT, PANIC, DEEPSLEEP, SDIO) -> otro.")
  l.push("static uint8_t hw_causaDeReinicio() {")
  l.push("  esp_reset_reason_t razon = esp_reset_reason();")
  l.push(`  if (razon == ESP_RST_POWERON) return ${causa(CAUSA_ENCENDIDO)};`)
  l.push(`  if (razon == ESP_RST_SW) return ${causa(CAUSA_SOFTWARE)};`)
  l.push(`  if (razon == ESP_RST_BROWNOUT) return ${causa(CAUSA_BROWNOUT)};`)
  l.push(`  if (razon == ESP_RST_INT_WDT || razon == ESP_RST_TASK_WDT || razon == ESP_RST_WDT) return ${causa(CAUSA_WATCHDOG)};`)
  l.push(`  return ${causa(CAUSA_OTRO)};`)
  l.push("}")
  l.push("")
  l.push("// Una linea de salida: el JSON de g_salida y un '\\n' solo (sin '\\r': sec. 1 pide un objeto por linea).")
  l.push("// Serial.print(const char[]) y Serial.print(char): Print.h:83-84.")
  l.push("static void transporte_emitir(uint16_t largo) {")
  l.push("  if (largo == 0) return;")
  l.push("  Serial.print(g_salida);")
  l.push("  Serial.print('\\n');")
  l.push("}")
  l.push("")
  if (t.wifi) {
    l.push("// La capa 3 (mas abajo) levanta la red en setup() y atiende DNS y HTTP en cada loop().")
    l.push("static void portal_iniciar();")
    l.push("static void portal_atender();")
    l.push("")
  }
  l.push("void setup() {")
  l.push("  for (uint8_t pin = 0; pin < CANTIDAD_DE_PINES; pin++) {")
  l.push("    g_canalDePin[pin] = SIN_CANAL;")
  l.push("  }")
  l.push("  Serial.begin(VELOCIDAD_SERIE);  // HardwareSerial.h:230; buffer de recepcion de 256 bytes por defecto (HardwareSerial.cpp:72)")
  if (t.wifi) l.push("  portal_iniciar();  // antes del `hola` inicial: el hola anuncia la red solo si levanto")
  l.push("  transporte_emitir(nucleo_responderReinicio(hw_causaDeReinicio()));  // sec. 3: `reinicio` una vez, ANTES del `hola` inicial")
  l.push("  transporte_emitir(nucleo_responderHola());")
  l.push("}")
  l.push("")
  l.push("// Lee lo que haya (Serial.available/read: HardwareSerial.h:233,236) y procesa cada linea completa.")
  l.push("// Hasta LIMITE_LINEA_BYTES bytes antes del '\\n' entran al buffer (el nucleo decide, descontando un '\\r' final);")
  l.push("// un byte mas sin '\\n' es LINEA_DEMASIADO_LARGA y el resto de esa linea se descarta.")
  l.push("void loop() {")
  l.push("  while (Serial.available() > 0) {")
  l.push("    int leido = Serial.read();")
  l.push("    if (leido < 0) break;")
  l.push("    char c = (char)leido;")
  l.push("    if (c == '\\n') {")
  l.push("      transporte_emitir(nucleo_procesar(g_descartando ? LIMITE_LINEA_BYTES + 1 : g_largoRecibido));")
  l.push("      g_largoRecibido = 0;")
  l.push("      g_descartando = false;")
  l.push("    } else if (g_descartando) {")
  l.push("      continue;")
  l.push("    } else if (g_largoRecibido >= LIMITE_LINEA_BYTES) {")
  l.push("      g_descartando = true;")
  l.push("    } else {")
  l.push("      g_linea[g_largoRecibido] = c;")
  l.push("      g_largoRecibido++;")
  l.push("    }")
  l.push("  }")
  if (t.wifi) l.push("  portal_atender();")
  l.push("}")
  return l
}

// ════════════════════════════════════════════════════════════════════════════════════
// Capa 3 — red propia, DNS cautivo y HTTP (V4, contrato sec. 8) sobre arduino-esp32 2.0.17
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * La capa 3 sólo mueve líneas: entre el `WebServer` y el núcleo. Librerías del core, sin `lib_deps`:
 * `WiFi`, `DNSServer`, `WebServer` (MODO-VIVO-PLAN.md sec. 10.3). `String` aparece SOLO acá, porque es lo
 * que devuelven `WebServer::arg` y `WebServer::hostHeader` (WebServer.h:117, :131); el núcleo sigue sin.
 */
export function renderizarPortal(t: TablasDelRuntime): string[] {
  const w = t.wifi
  if (!w) throw new Error("renderizarPortal necesita tablas.wifi")
  if (!/^[a-z][a-z0-9-]*$/.test(w.prefijoSsid)) throw new Error(`prefijo de SSID invalido: ${w.prefijoSsid}`)
  if (w.canales.length === 0 || w.canales.some((c) => !Number.isInteger(c) || c < 1 || c > 13)) throw new Error("los canales WiFi van de 1 a 13 (WiFiAP.cpp:132)")
  for (const octetos of [w.ip, w.mascara]) if (octetos.length !== 4 || octetos.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) throw new Error("una IP son 4 octetos 0..255")
  // "tecnia-" + 4 hex + el 0 final.
  const tamanoSsid = w.prefijoSsid.length + 4 + 1
  if (tamanoSsid > TAMANO_BUFFER_SSID) throw new Error("el SSID no entra en los 32 bytes de wifi_config_t.ap.ssid")
  if (w.ssid !== undefined && (!/^[\x20-\x7e]{1,32}$/.test(w.ssid) || w.ssid.includes('"') || w.ssid.includes("\\"))) throw new Error("el SSID fijo son 1 a 32 bytes ASCII imprimibles, sin comillas ni barra invertida")
  const ipTexto = w.ip.join(".")
  const l: string[] = []
  l.push("// ============================================================================")
  l.push("// CAPA 3: TRANSPORTE WIFI. Punto de acceso propio, DNS cautivo y HTTP (contrato sec. 8).")
  l.push("// Librerias del core (sin lib_deps): WiFi, DNSServer y WebServer. Citas: fuentes instaladas de")
  l.push("// arduino-esp32 2.0.17 (libraries/WiFi/src, libraries/DNSServer/src, libraries/WebServer/src).")
  l.push("// `String` aparece SOLO en esta capa: es lo que devuelven WebServer::arg (WebServer.h:117) y")
  l.push("// WebServer::hostHeader (:131). El nucleo (capa 1) y el serie (capa 2) siguen sin String.")
  l.push("// Las lineas que llegan por HTTP pasan por EL MISMO nucleo_procesar que las del serie (sec. 8.2):")
  l.push("// no hay un segundo camino. Un cliente a la vez: el WebServer del core es sincrono (sec. 8.2).")
  l.push("// V4-2: lo que se hace desde el celular no se refleja en la sesion serie.")
  l.push("// ============================================================================")
  l.push("")
  l.push("// --- Constantes de la red (sec. 8.1 y 8.2) ---")
  if (w.ssid !== undefined) {
    l.push(`static const char SSID_FIJO[] = ${literalTexto(w.ssid)};  // nombre de red fijado al generar (opcion wifi.ssid); cabe en wifi_config_t.ap.ssid (32)`)
  } else {
    l.push(`static const char PREFIJO_SSID[] = ${literalTexto(w.prefijoSsid)};  // + los 4 ultimos hex de la MAC del AP, en minuscula`)
    l.push(`static const uint8_t TAMANO_SSID = ${tamanoSsid};  // prefijo + 4 hex + el 0 final`)
    l.push('static const char DIGITOS_HEX[] = "0123456789abcdef";')
  }
  l.push(`static const uint8_t CANALES_WIFI[] = {${w.canales.join(", ")}};  // la MAC reparte las placas del aula entre estos canales (MODO-VIVO-PLAN.md sec. 10.8)`)
  l.push(`static const uint8_t CANTIDAD_CANALES_WIFI = ${w.canales.length};`)
  l.push(`static const uint16_t PUERTO_HTTP = ${w.puertoHttp};`)
  l.push(`static const uint16_t PUERTO_DNS = ${w.puertoDns};  // el puerto del DNS, como en el ejemplo del core (DNSServer/examples/CaptivePortal:4,21)`)
  l.push(`static const char TEXTO_DOMINIO_TODOS[] = "*";  // DNSServer.cpp:116: con "*" contesta TODA consulta con la IP dada`)
  l.push(`static const char TEXTO_RUTA_PAGINA[] = ${literalTexto(w.rutaPagina)};`)
  l.push(`static const char TEXTO_RUTA_COMANDO[] = ${literalTexto(w.rutaComando)};`)
  l.push(`static const char TEXTO_HOST_CON_PUERTO[] = ${literalTexto(`${ipTexto}:${w.puertoHttp}`)};  // el Host puede venir con el puerto explicito`)
  l.push(`static const char TEXTO_URL_PORTAL[] = ${literalTexto(`http://${ipTexto}/`)};  // adonde manda el 302 (sec. 8.2)`)
  l.push('static const char TEXTO_ENCABEZADO_LOCATION[] = "Location";')
  l.push('static const char TEXTO_ARGUMENTO_CUERPO[] = "plain";  // Parsing.cpp:213-217: un POST que no es formulario queda entero en el argumento "plain"')
  l.push('static const char TEXTO_TIPO_HTML[] = "text/html; charset=utf-8";')
  l.push('static const char TEXTO_TIPO_JSON[] = "application/json";')
  l.push('static const char TEXTO_TIPO_TEXTO_PLANO[] = "text/plain";')
  l.push('static const char TEXTO_REDIRIGIENDO[] = "redirigiendo al portal";')
  l.push(`static const char TEXTO_CUERPO_INVALIDO[] = ${literalTexto(`cuerpo vacio o de mas de ${t.limiteLineaBytes} bytes`)};`)
  l.push("")
  l.push("// La pagina (sec. 8.3), en .rodata. PROGMEM no hace nada en la ESP32 (pgmspace.h:32) y strlen_P es strlen (:81).")
  l.push(...literalDePagina("PAGINA", w.pagina))
  l.push("")
  l.push("// IPAddress(a, b, c, d): IPAddress.h:49. La IP del AP se FIJA con softAPConfig (abajo), no se supone la de ESP-IDF.")
  l.push(`static IPAddress IP_PORTAL(${w.ip.join(", ")});`)
  l.push(`static IPAddress MASCARA_PORTAL(${w.mascara.join(", ")});`)
  l.push("static DNSServer dnsServer;  // DNSServer.h:75-89: start(puerto, dominio, ip), processNextRequest()")
  l.push("static WebServer server(PUERTO_HTTP);  // WebServer.h:88: WebServer(int port)")
  l.push("static uint8_t g_canalWifi = 0;")
  l.push("")
  l.push("// 302 al portal para cualquier ruta u host que no sea el nuestro (sec. 8.2): cubre /generate_204 (Android),")
  l.push("// /hotspot-detect.html (iOS/macOS), /connecttest.txt y /ncsi.txt (Windows) y cualquier dominio, porque el DNS")
  l.push("// cautivo los trae a todos aca. sendHeader(nombre, valor, primero): WebServer.cpp:355-367; send(codigo, tipo,")
  l.push("// contenido): WebServer.h:140; _prepareHeader agrega Content-Length y Connection: close (WebServer.cpp:385-417).")
  l.push("static void portal_redirigir() {")
  l.push("  server.sendHeader(TEXTO_ENCABEZADO_LOCATION, TEXTO_URL_PORTAL, true);")
  l.push("  server.send(302, TEXTO_TIPO_TEXTO_PLANO, TEXTO_REDIRIGIENDO);")
  l.push("}")
  l.push("")
  l.push("// El Host del pedido (Parsing.cpp:171-172 lo guarda; WebServer.cpp:623-625 lo devuelve). Un pedido a otro host")
  l.push("// (el chequeo de conectividad del celular, por ejemplo) no es para la pagina: va al 302, aunque la ruta sea /.")
  l.push("static bool portal_hostEsElPortal() {")
  l.push("  String host = server.hostHeader();")
  l.push("  return host.equals(TEXTO_WIFI_IP) || host.equals(TEXTO_HOST_CON_PUERTO);  // String::equals(const char*): WString.h:204")
  l.push("}")
  l.push("")
  l.push("// GET /: la pagina, con Content-Type text/html; charset=utf-8. send_P(codigo, tipo, contenido): WebServer.h:142,")
  l.push("// WebServer.cpp:450-463 (strlen_P para el Content-Length; copia el tipo a un char[64], el nuestro mide 24).")
  l.push("static void portal_pagina() {")
  l.push("  if (!portal_hostEsElPortal()) {")
  l.push("    portal_redirigir();")
  l.push("    return;")
  l.push("  }")
  l.push("  server.send_P(200, TEXTO_TIPO_HTML, PAGINA);")
  l.push("}")
  l.push("")
  l.push("// POST /comando (sec. 8.2): el cuerpo es UNA linea del formato plano; se recorta un '\\n' final si vino. Pasa por")
  l.push("// nucleo_procesar igual que una linea del serie (el nucleo descuenta un '\\r' final, sec. 1) y vuelve la linea JSON")
  l.push("// con 200, tambien cuando es un `error` del protocolo. 400 SOLO con cuerpo vacio o de mas de LIMITE_LINEA_BYTES.")
  l.push("// El cuerpo llega como argumento \"plain\" cuando el Content-Type no es de formulario (Parsing.cpp:199-221): fetch()")
  l.push("// con un string manda text/plain. Con application/x-www-form-urlencoded (curl -d sin -H) el core lo parte en")
  l.push("// pares clave=valor y no hay \"plain\": se responde 400, no se adivina. arg(nombre): WebServer.cpp:539-549.")
  l.push("static void portal_comando() {")
  l.push("  if (!portal_hostEsElPortal()) {")
  l.push("    portal_redirigir();")
  l.push("    return;")
  l.push("  }")
  l.push("  String cuerpo = server.arg(TEXTO_ARGUMENTO_CUERPO);")
  l.push("  uint32_t largo = cuerpo.length();  // WString.h:87")
  l.push("  if (largo > 0 && cuerpo.charAt(largo - 1) == '\\n') largo--;  // WString.h:240")
  l.push("  // Se mide como el nucleo (sec. 1): un '\\r' final no cuenta. Asi, 200 bytes + \"\\r\\n\" es por HTTP lo mismo que")
  l.push("  // por el serie (LINEA_DEMASIADO_LARGA con 200); 400 recien con mas de LIMITE_LINEA_BYTES de carga util.")
  l.push("  uint32_t largoUtil = largo;")
  l.push("  if (largoUtil > 0 && cuerpo.charAt(largoUtil - 1) == '\\r') largoUtil--;")
  l.push("  if (largo == 0 || largoUtil > LIMITE_LINEA_BYTES) {")
  l.push("    server.send(400, TEXTO_TIPO_TEXTO_PLANO, TEXTO_CUERPO_INVALIDO);")
  l.push("    return;")
  l.push("  }")
  l.push("  // Entra entero en g_linea (LIMITE_LINEA_BYTES + 1 bytes): a lo sumo LIMITE_LINEA_BYTES de carga util mas el '\\r'.")
  l.push("  for (uint32_t i = 0; i < largo; i++) {")
  l.push("    g_linea[i] = cuerpo.charAt(i);")
  l.push("  }")
  l.push("  uint16_t largoSalida = nucleo_procesar((uint16_t)largo);")
  l.push("  if (largoSalida == 0) {")
  l.push("    // El nucleo no responde a una linea vacia (sec. 1); por HTTP eso es un cuerpo vacio (solo un '\\r').")
  l.push("    server.send(400, TEXTO_TIPO_TEXTO_PLANO, TEXTO_CUERPO_INVALIDO);")
  l.push("    return;")
  l.push("  }")
  l.push("  server.send(200, TEXTO_TIPO_JSON, g_salida);")
  l.push("}")
  l.push("")
  l.push("// Levanta la red. WiFi.mode(WIFI_AP): WiFiGeneric.h:176, WIFI_AP = WIFI_MODE_AP (WiFiType.h:34); hace falta antes de")
  l.push("// leer la MAC: softAPmacAddress(mac) (WiFiAP.cpp:337-343) llama a esp_wifi_get_mac(WIFI_IF_AP, mac) (esp_wifi.h:709)")
  l.push("// solo si el modo no es NULL. softAP(ssid, clave, canal): WiFiAP.h:40 (passphrase = NULL por defecto), WiFiAP.cpp:136-175")
  l.push("// (rechaza claves de 1 a 7 bytes, :145); con clave NULL la red queda ABIERTA (wifi_softap_config, WiFiAP.cpp:107 y")
  l.push("// :115-119: WIFI_AUTH_OPEN salvo que haya clave; con clave, WPA2 + CCMP). softAPConfig(ip, gateway, mascara):")
  l.push("// WiFiAP.cpp:199-210, despues de softAP como en el")
  l.push("// ejemplo del core (DNSServer/examples/CaptivePortal:15-17). Si algo falla, no se fija el SSID: `hola` no anuncia")
  l.push("// red y no se levantan DNS ni HTTP; el serie sigue. Un OK falso es peor que un error.")
  const ssid = w.ssid !== undefined ? "SSID_FIJO" : "ssid"
  l.push("static void portal_iniciar() {")
  l.push("  WiFi.mode(WIFI_AP);")
  l.push("  uint8_t mac[6];")
  l.push("  WiFi.softAPmacAddress(mac);")
  if (w.ssid === undefined) {
    l.push("  char ssid[TAMANO_SSID];")
    l.push("  uint8_t largo = 0;")
    l.push("  for (uint8_t i = 0; PREFIJO_SSID[i] != '\\0'; i++) {")
    l.push("    ssid[largo] = PREFIJO_SSID[i];")
    l.push("    largo++;")
    l.push("  }")
    l.push("  // Los 4 ultimos hex de la MAC (sec. 8.1): los dos ultimos bytes, nibble alto primero, en minuscula.")
    l.push("  ssid[largo] = DIGITOS_HEX[mac[4] >> 4];")
    l.push("  largo++;")
    l.push("  ssid[largo] = DIGITOS_HEX[mac[4] & 15];")
    l.push("  largo++;")
    l.push("  ssid[largo] = DIGITOS_HEX[mac[5] >> 4];")
    l.push("  largo++;")
    l.push("  ssid[largo] = DIGITOS_HEX[mac[5] & 15];")
    l.push("  largo++;")
    l.push("  ssid[largo] = '\\0';")
  } else {
    l.push("  // El nombre viene fijado al generar (SSID_FIJO); la MAC solo decide el canal.")
  }
  l.push("  g_canalWifi = CANALES_WIFI[mac[5] % CANTIDAD_CANALES_WIFI];")
  if (w.clave === "") l.push(`  if (!WiFi.softAP(${ssid}, NULL, g_canalWifi)) return;  // red abierta: sin clave (decision de Alejandro, 2026-10-13)`)
  else l.push(`  if (!WiFi.softAP(${ssid}, TEXTO_WIFI_CLAVE, g_canalWifi)) return;`)
  l.push("  if (!WiFi.softAPConfig(IP_PORTAL, IP_PORTAL, MASCARA_PORTAL)) return;")
  l.push(`  nucleo_fijarSsid(${ssid});`)
  l.push("  dnsServer.start(PUERTO_DNS, TEXTO_DOMINIO_TODOS, IP_PORTAL);  // DNSServer.cpp:39-51")
  l.push("  server.on(TEXTO_RUTA_PAGINA, HTTP_GET, portal_pagina);  // WebServer.h:103; HTTP_GET/HTTP_POST: http_parser.h:96,98")
  l.push("  server.on(TEXTO_RUTA_COMANDO, HTTP_POST, portal_comando);")
  l.push("  server.onNotFound(portal_redirigir);  // WebServer.h:107; tambien GET /comando y cualquier otro metodo")
  l.push("  server.begin();  // WebServer.h:91")
  l.push("}")
  l.push("")
  l.push("// En cada loop(): una consulta DNS (DNSServer.cpp:76) y un cliente HTTP (WebServer.cpp:275-342). Sin clientes,")
  l.push("// handleClient espera 1 ms (un delay de 1, WebServer.cpp:279-281, enableDelay por defecto): 1 ms de latencia para el serie,")
  l.push("// que ya vacio su buffer antes de llegar aca. Se deja el comportamiento por defecto del core.")
  l.push("static void portal_atender() {")
  l.push("  dnsServer.processNextRequest();")
  l.push("  server.handleClient();")
  l.push("}")
  return l
}
