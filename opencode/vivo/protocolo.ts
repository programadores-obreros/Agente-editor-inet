// Tecnia Live Protocol v1 — el contrato entre el host (Tecnia Bot) y el runtime cargado en la
// placa (Modo Vivo V1). Contrato completo: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md.
//
// Host → runtime: una línea en formato PLANO (`comando campo=valor campo=valor`), sin JSON,
// porque el runtime en C++ no trae parser de JSON (el core de arduino-esp32 no incluye uno y
// el repo no agrega librerías). Runtime → host: un objeto JSON por línea, en forma CANÓNICA
// (claves ordenadas, sin espacios): así el runtime real y el simulador de los tests producen
// las mismas líneas byte a byte.
//
// Este módulo es PURO: sin I/O, sin reloj, sin puertos, sin estado. Lo usan el simulador de
// runtime (tests), la sesión viva (host) y la tool `vivo`. El parser de líneas de comando es
// además la REFERENCIA del parser en C++ del runtime: misma gramática, mismos códigos.
//
// Los códigos de error son estables y nunca prosa: el host los traduce para el alumno.

export const VERSION_PROTOCOLO = 1 as const

/** Límite de una línea host → runtime, en bytes, incluido el `\n`. */
export const LIMITE_LINEA_BYTES = 200

/** Comandos que V1 implementa, en orden alfabético (así los anuncia `hola`). */
export const COMANDOS_V1 = Object.freeze(["analogico.leer", "digital.escribir", "digital.leer", "hola", "pin.modo", "ping", "pwm.escribir"] as const)

/** Reservados para slices posteriores: el runtime V1 responde COMANDO_DESCONOCIDO y el host no los ofrece. */
export const COMANDOS_RESERVADOS = Object.freeze(["proyecto.cargar", "sensor.leer", "servo.angulo", "suscribir"] as const)

export const MODOS_DE_PIN = Object.freeze(["entrada", "entradaPullUp", "salida"] as const)
export const NIVELES = Object.freeze(["alto", "bajo"] as const)
export const CAUSAS_DE_REINICIO = Object.freeze(["encendido", "software", "brownout", "watchdog", "otro"] as const)

/**
 * Los mismos valores, como objetos nombrados (auditoría A6, T-04): quien necesita UN modo, nivel o
 * causa lo toma por nombre (`MODO.salida`) y no por índice en la lista (`MODOS_DE_PIN[2]`). Las
 * listas siguen siendo la fuente del orden y de la validación.
 */
export const MODO = Object.freeze({ entrada: "entrada", entradaPullUp: "entradaPullUp", salida: "salida" } as const)
export const NIVEL = Object.freeze({ alto: "alto", bajo: "bajo" } as const)
export const CAUSA = Object.freeze({ encendido: "encendido", software: "software", brownout: "brownout", watchdog: "watchdog", otro: "otro" } as const)

/**
 * Nombres de los campos del formato plano, como vocabulario exportado: el generador del runtime
 * (`codegen/runtime-cpp.ts`) los toma de acá y no los escribe como literales. Importa, porque
 * `porcentaje` también es un id de unidad del catálogo y la guardia C2 de `codegen-s2.test.mjs`
 * prohíbe ids de unidades escritos a mano dentro de `codegen/`: el único lugar donde la palabra
 * existe como texto es este contrato.
 */
export const CAMPOS = Object.freeze({ pin: "pin", modo: "modo", nivel: "nivel", porcentaje: "porcentaje" } as const)

export type NombreComandoV1 = (typeof COMANDOS_V1)[number]
export type ModoDePin = (typeof MODOS_DE_PIN)[number]
export type Nivel = (typeof NIVELES)[number]
export type CausaDeReinicio = (typeof CAUSAS_DE_REINICIO)[number]

export type Comando =
  | { readonly comando: "hola" }
  | { readonly comando: "ping" }
  | { readonly comando: "pin.modo"; readonly pin: number; readonly modo: ModoDePin }
  | { readonly comando: "digital.escribir"; readonly pin: number; readonly nivel: Nivel }
  | { readonly comando: "pwm.escribir"; readonly pin: number; readonly porcentaje: number }
  | { readonly comando: "digital.leer"; readonly pin: number }
  | { readonly comando: "analogico.leer"; readonly pin: number }

export const CODIGOS_DE_ERROR = Object.freeze([
  "LINEA_DEMASIADO_LARGA",
  "LINEA_INVALIDA",
  "COMANDO_DESCONOCIDO",
  "CAMPO_FALTANTE",
  "CAMPO_DESCONOCIDO",
  "CAMPO_DUPLICADO",
  "VALOR_INVALIDO",
  "PIN_INEXISTENTE",
  "PIN_PROHIBIDO",
  "PIN_SIN_CAPACIDAD",
] as const)
export type CodigoDeError = (typeof CODIGOS_DE_ERROR)[number]

export interface ErrorDeProtocolo {
  readonly codigo: CodigoDeError
  readonly comando?: string
  readonly campo?: string
  readonly pin?: number
}

/** V4: la red propia que levanta el runtime (punto de acceso), anunciada en el `hola` cuando el runtime la compila. */
export interface RedWifi {
  readonly ssid: string
  readonly clave: string
  readonly ip: string
}

/** Largo máximo de un SSID en bytes (802.11; `wifi_config_t.ap.ssid` en la ESP32 mide exactamente eso). */
export const LARGO_MAXIMO_SSID = 32

/**
 * Un SSID válido para el runtime: 1..`LARGO_MAXIMO_SSID` bytes ASCII imprimibles, sin `"` ni `\`
 * (sale en el `hola` sin escapar, sec. 1: strings ASCII).
 */
export function esSsidValido(nombre: string): boolean {
  if (typeof nombre !== "string" || nombre.length < 1 || nombre.length > LARGO_MAXIMO_SSID) return false
  return /^[\x20-\x7e]*$/.test(nombre) && !nombre.includes('"') && !nombre.includes("\\")
}

export type Respuesta =
  | {
      readonly tipo: "hola"
      readonly runtime: string
      readonly protocolo: number
      readonly placa: string
      readonly comandos: readonly string[]
      readonly protocolos: readonly string[]
      /** Presente sólo si el runtime trae WiFi (V4). Ausente en el runtime V1 de sólo serie. */
      readonly wifi?: RedWifi
    }
  | { readonly tipo: "pong"; readonly uptimeMs: number }
  | { readonly tipo: "ok"; readonly comando: string; readonly pin: number }
  | { readonly tipo: "lectura"; readonly pin: number; readonly nivel: Nivel }
  | { readonly tipo: "lectura"; readonly pin: number; readonly crudo: number }
  | ({ readonly tipo: "error" } & ErrorDeProtocolo)
  | { readonly tipo: "reinicio"; readonly causa: CausaDeReinicio }

export type ResultadoDeParseo<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: ErrorDeProtocolo }

// ════════════════════════════════════════════════════════════════════════════════════
// Host → runtime
// ════════════════════════════════════════════════════════════════════════════════════

/** Campos obligatorios de cada comando, en el orden en que se reclaman los faltantes. Exportado para el generador del runtime (una sola tabla). */
export const CAMPOS_POR_COMANDO: Readonly<Record<NombreComandoV1, readonly string[]>> = Object.freeze({
  hola: [],
  ping: [],
  "pin.modo": [CAMPOS.pin, CAMPOS.modo],
  "digital.escribir": [CAMPOS.pin, CAMPOS.nivel],
  "pwm.escribir": [CAMPOS.pin, CAMPOS.porcentaje],
  "digital.leer": [CAMPOS.pin],
  "analogico.leer": [CAMPOS.pin],
})

const RE_NOMBRE = /^[a-z][a-z0-9.]*$/
const RE_VALOR = /^[A-Za-z0-9_.-]+$/
const RE_ENTERO = /^(0|[1-9][0-9]*)$/

function esComandoV1(nombre: string): nombre is NombreComandoV1 {
  return (COMANDOS_V1 as readonly string[]).includes(nombre)
}

/** La línea que viaja por el cable para un comando (sin el `\n`). Inversa exacta de `parsearLineaDeComando`. */
export function serializarComando(comando: Comando): string {
  switch (comando.comando) {
    case "hola":
    case "ping":
      return comando.comando
    case "pin.modo":
      return `pin.modo pin=${comando.pin} modo=${comando.modo}`
    case "digital.escribir":
      return `digital.escribir pin=${comando.pin} nivel=${comando.nivel}`
    case "pwm.escribir":
      return `pwm.escribir pin=${comando.pin} porcentaje=${comando.porcentaje}`
    case "digital.leer":
      return `digital.leer pin=${comando.pin}`
    case "analogico.leer":
      return `analogico.leer pin=${comando.pin}`
  }
}

function entero(valor: string): number | undefined {
  return RE_ENTERO.test(valor) ? Number(valor) : undefined
}

/**
 * Gramática de §1 del contrato, aplicada en el mismo orden que el runtime en C++ (así los dos
 * dan el MISMO primer error ante la misma línea): largo → forma → comando conocido → campos
 * duplicados/desconocidos → faltantes → valores. La validez del PIN contra la placa NO es de
 * acá: es política del runtime (y del simulador), que la aplica después del parseo.
 */
export function parsearLineaDeComando(linea: string): ResultadoDeParseo<Comando> {
  const sinFin = linea.endsWith("\r") ? linea.slice(0, -1) : linea
  if (new TextEncoder().encode(sinFin).length + 1 > LIMITE_LINEA_BYTES) return { ok: false, error: { codigo: "LINEA_DEMASIADO_LARGA" } }
  if (sinFin.length === 0 || sinFin !== sinFin.trim() || /\s\s/.test(sinFin)) return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
  const partes = sinFin.split(" ")
  const nombre = partes[0] ?? ""
  if (!RE_NOMBRE.test(nombre)) return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
  const campos = new Map<string, string>()
  for (const parte of partes.slice(1)) {
    const igual = parte.indexOf("=")
    if (igual <= 0) return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
    const clave = parte.slice(0, igual)
    const valor = parte.slice(igual + 1)
    if (!RE_NOMBRE.test(clave) || !RE_VALOR.test(valor)) return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
    if (campos.has(clave)) return { ok: false, error: { codigo: "CAMPO_DUPLICADO", comando: nombre, campo: clave } }
    campos.set(clave, valor)
  }
  if (!esComandoV1(nombre)) return { ok: false, error: { codigo: "COMANDO_DESCONOCIDO", comando: nombre } }
  const esperados = CAMPOS_POR_COMANDO[nombre]
  for (const clave of campos.keys()) if (!esperados.includes(clave)) return { ok: false, error: { codigo: "CAMPO_DESCONOCIDO", comando: nombre, campo: clave } }
  for (const clave of esperados) if (!campos.has(clave)) return { ok: false, error: { codigo: "CAMPO_FALTANTE", comando: nombre, campo: clave } }
  const invalido = (campo: string): ResultadoDeParseo<Comando> => ({ ok: false, error: { codigo: "VALOR_INVALIDO", comando: nombre, campo } })

  if (nombre === "hola" || nombre === "ping") return { ok: true, valor: { comando: nombre } }
  const pin = entero(campos.get("pin") ?? "")
  if (pin === undefined) return invalido("pin")
  switch (nombre) {
    case "pin.modo": {
      const modo = campos.get("modo") ?? ""
      if (!(MODOS_DE_PIN as readonly string[]).includes(modo)) return invalido("modo")
      return { ok: true, valor: { comando: nombre, pin, modo: modo as ModoDePin } }
    }
    case "digital.escribir": {
      const nivel = campos.get("nivel") ?? ""
      if (!(NIVELES as readonly string[]).includes(nivel)) return invalido("nivel")
      return { ok: true, valor: { comando: nombre, pin, nivel: nivel as Nivel } }
    }
    case "pwm.escribir": {
      const porcentaje = entero(campos.get("porcentaje") ?? "")
      if (porcentaje === undefined || porcentaje > 100) return invalido("porcentaje")
      return { ok: true, valor: { comando: nombre, pin, porcentaje } }
    }
    case "digital.leer":
    case "analogico.leer":
      return { ok: true, valor: { comando: nombre, pin } }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Runtime → host
// ════════════════════════════════════════════════════════════════════════════════════

/** JSON canónico: claves en orden alfabético, sin espacios, listas en el orden dado. Es lo que el C++ emite con snprintf. */
export function serializarRespuesta(respuesta: Respuesta): string {
  const claves = Object.keys(respuesta).sort()
  const partes = claves.map((clave) => {
    const valor = (respuesta as Record<string, unknown>)[clave]
    return `${JSON.stringify(clave)}:${serializarValor(valor)}`
  })
  return `{${partes.join(",")}}`
}

function serializarValor(valor: unknown): string {
  if (typeof valor === "number") {
    if (!Number.isInteger(valor) || valor < 0) throw new Error(`el protocolo sólo lleva enteros no negativos: ${valor}`)
    return String(valor)
  }
  if (typeof valor === "string") {
    if (!/^[\x20-\x7e]*$/.test(valor) || valor.includes('"') || valor.includes("\\")) throw new Error(`string fuera del ASCII imprimible sin comillas: ${valor}`)
    return `"${valor}"`
  }
  if (Array.isArray(valor)) return `[${valor.map(serializarValor).join(",")}]`
  if (typeof valor === "object" && valor !== null) {
    // V4: objetos anidados (`wifi`), con la misma regla: claves ordenadas, sin espacios.
    const o = valor as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${serializarValor(o[k])}`)
      .join(",")}}`
  }
  throw new Error(`valor no representable en el protocolo: ${String(valor)}`)
}

const esEnteroNoNegativo = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0
const esTexto = (v: unknown): v is string => typeof v === "string"
const esListaDeTexto = (v: unknown): v is string[] => Array.isArray(v) && v.every(esTexto)

/**
 * Lee una línea del runtime. Estricto: una línea que no es exactamente uno de los tipos del
 * contrato es LINEA_INVALIDA, nunca se interpreta "más o menos" (un OK falso es peor que un
 * error). Las claves extra también invalidan: el contrato es cerrado.
 */
export function parsearRespuesta(linea: string): ResultadoDeParseo<Respuesta> {
  let crudo: unknown
  try {
    crudo = JSON.parse(linea)
  } catch {
    return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
  }
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) return { ok: false, error: { codigo: "LINEA_INVALIDA" } }
  const objeto = crudo as Record<string, unknown>
  const claves = Object.keys(objeto).sort()
  const exacto = (...esperadas: string[]) => claves.join(",") === [...esperadas].sort().join(",")
  const invalida: ResultadoDeParseo<Respuesta> = { ok: false, error: { codigo: "LINEA_INVALIDA" } }

  switch (objeto["tipo"]) {
    case "hola": {
      const conWifi = exacto("tipo", "runtime", "protocolo", "placa", "comandos", "protocolos", "wifi")
      if (!conWifi && !exacto("tipo", "runtime", "protocolo", "placa", "comandos", "protocolos")) return invalida
      const { runtime, protocolo, placa, comandos, protocolos } = objeto
      if (!esTexto(runtime) || !esEnteroNoNegativo(protocolo) || !esTexto(placa) || !esListaDeTexto(comandos) || !esListaDeTexto(protocolos)) return invalida
      if (!conWifi) return { ok: true, valor: { tipo: "hola", runtime, protocolo, placa, comandos, protocolos } }
      // V4: `wifi` es un objeto cerrado {clave, ip, ssid}; cualquier otra forma invalida la línea entera.
      const wifi = objeto["wifi"]
      if (typeof wifi !== "object" || wifi === null || Array.isArray(wifi)) return invalida
      const w = wifi as Record<string, unknown>
      if (Object.keys(w).sort().join(",") !== "clave,ip,ssid" || !esTexto(w["ssid"]) || !esTexto(w["clave"]) || !esTexto(w["ip"])) return invalida
      return { ok: true, valor: { tipo: "hola", runtime, protocolo, placa, comandos, protocolos, wifi: { ssid: w["ssid"], clave: w["clave"], ip: w["ip"] } } }
    }
    case "pong": {
      if (!exacto("tipo", "uptimeMs") || !esEnteroNoNegativo(objeto["uptimeMs"])) return invalida
      return { ok: true, valor: { tipo: "pong", uptimeMs: objeto["uptimeMs"] } }
    }
    case "ok": {
      if (!exacto("tipo", "comando", "pin") || !esTexto(objeto["comando"]) || !esEnteroNoNegativo(objeto["pin"])) return invalida
      return { ok: true, valor: { tipo: "ok", comando: objeto["comando"], pin: objeto["pin"] } }
    }
    case "lectura": {
      if (!esEnteroNoNegativo(objeto["pin"])) return invalida
      if (exacto("tipo", "pin", "nivel")) {
        const nivel = objeto["nivel"]
        if (nivel !== "alto" && nivel !== "bajo") return invalida
        return { ok: true, valor: { tipo: "lectura", pin: objeto["pin"], nivel } }
      }
      if (exacto("tipo", "pin", "crudo") && esEnteroNoNegativo(objeto["crudo"])) return { ok: true, valor: { tipo: "lectura", pin: objeto["pin"], crudo: objeto["crudo"] } }
      return invalida
    }
    case "error": {
      const codigo = objeto["codigo"]
      if (!esTexto(codigo) || !(CODIGOS_DE_ERROR as readonly string[]).includes(codigo)) return invalida
      const permitidas = ["tipo", "codigo", "comando", "campo", "pin"]
      if (!claves.every((c) => permitidas.includes(c))) return invalida
      const error: { -readonly [K in keyof ErrorDeProtocolo]: ErrorDeProtocolo[K] } = { codigo: codigo as CodigoDeError }
      if ("comando" in objeto) {
        if (!esTexto(objeto["comando"])) return invalida
        error.comando = objeto["comando"]
      }
      if ("campo" in objeto) {
        if (!esTexto(objeto["campo"])) return invalida
        error.campo = objeto["campo"]
      }
      if ("pin" in objeto) {
        if (!esEnteroNoNegativo(objeto["pin"])) return invalida
        error.pin = objeto["pin"]
      }
      return { ok: true, valor: { tipo: "error", ...error } }
    }
    case "reinicio": {
      const causa = objeto["causa"]
      if (!exacto("tipo", "causa") || !esTexto(causa) || !(CAUSAS_DE_REINICIO as readonly string[]).includes(causa)) return invalida
      return { ok: true, valor: { tipo: "reinicio", causa: causa as CausaDeReinicio } }
    }
    default:
      return invalida
  }
}

/** La respuesta `error` canónica para un error de parseo o de política (sin claves `undefined`). */
export function respuestaDeError(error: ErrorDeProtocolo): Respuesta {
  const r: { -readonly [K in keyof ErrorDeProtocolo]: ErrorDeProtocolo[K] } & { tipo: "error" } = { tipo: "error", codigo: error.codigo }
  if (error.comando !== undefined) r.comando = error.comando
  if (error.campo !== undefined) r.campo = error.campo
  if (error.pin !== undefined) r.pin = error.pin
  return r
}
