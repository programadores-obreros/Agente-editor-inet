// `carga/esptool.ts` — qué dice la salida de la herramienta de carga, y qué se puede
// afirmar con eso (CONTRATOS-API §7, ADR-001 §10.5 «D5», decisión ND-3 del owner).
//
// LA REGLA (D5): son TRES cosas distintas y ninguna equivale a otra.
//   - `platformio`: el código de salida de `pio run`.
//   - `escritura`:  lo que la herramienta REPORTA haber escrito, región por región.
//   - `dispositivo`: que la placa haya confirmado lo escrito (esptool le pide al chip el
//     MD5 de la región recién grabada e imprime `Hash of data verified.`).
// Hay carga `ok` sólo con las tres. **Nada devuelve `ok: true` por un rc 0.**
//
// DE DÓNDE SALEN LOS PATRONES.
//   - esptool: de la salida REAL de una carga (`hardware-e2e-1b/raw/fase4/upload.log`,
//     copiada a `tests/fixtures/carga/esptool-carga-real-4-regiones.log`) y de las cadenas
//     del esptool 4.9.0 instalado (`esptool/cmds.py:709-717` y `:734`, `loader.py:366`,
//     `:742`, `:1663-1689`, `__init__.py:1361-1377`).
//   - avrdude: SÓLO de las cadenas de formato del binario instalado (`tool-avrdude
//     1.60300.200527`, `libavrdude.so.1.0.0`): `%s: %d bytes of %s written`, `%s: %d bytes
//     of %s verified`, `%s: verification error, first mismatch at byte 0x%04x`, `%s:
//     verification error; content mismatch`. NO hay una salida real de una carga a una UNO.
//
// ARDUINO UNO (ND-3). Hasta tener evidencia real de avrdude con una placa, una carga a una
// UNO da SIEMPRE `CARGA_SIN_VERIFICAR`, `ok: false`, aunque PlatformIO termine con rc 0 y
// la salida diga lo que diga. `leerSalidaAvrdude` existe como trabajo preparatorio; un
// fixture sintético no es evidencia física y no habilita un `ok`. El único punto de
// activación es `VERIFICACION_AVRDUDE_HABILITADA`, apagado.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { CODIGO_CANCELADO, CODIGO_TIMEOUT } from "./proceso.ts"

export type SintomaEsptool = "PLACA_NO_RESPONDE" | "PUERTO_NO_DISPONIBLE" | "DESCONEXION_DURANTE_CARGA" | "CABLE_O_ALIMENTACION"

export interface RegionEscrita {
  offset: number
  /** Los bytes que esptool dice haber escrito (el tamaño de la imagen, alineado a 4). */
  bytes: number
  /** Si DESPUÉS de esa región, y antes de la siguiente, apareció `Hash of data verified.` */
  hashVerificado: boolean
}

export interface ResultadoEsptool {
  /** Hubo al menos una región, todas con el hash verificado, y ningún error. NO mira el rc. */
  exito: boolean
  chip: string | null
  mac: string | null
  regiones: RegionEscrita[]
  puertoUsado: string | null
  resetFinal: boolean
  /** La línea `[SUCCESS]` de PlatformIO. Es informativa: no cuenta para `exito`. */
  marcaSuccess: boolean
  sintoma: SintomaEsptool | null
  /** El último `Writing at 0x…` que se vio: hasta dónde llegó una carga que se cortó. */
  ultimoOffset?: number
}

const lineasDe = (stdout: string, stderr: string) => `${stdout ?? ""}\n${stderr ?? ""}`.split(/\r\n|\r|\n/)

const SINTOMAS: ReadonlyArray<[RegExp, SintomaEsptool]> = [
  [/Could not open .*port is busy or doesn't exist|could not open port/i, "PUERTO_NO_DISPONIBLE"],
  [/Failed to connect to |Wrong boot mode detected|No serial data received/i, "PLACA_NO_RESPONDE"],
  [/A serial exception error occurred|Lost connection|The chip stopped responding|Packet content transfer stopped/i, "DESCONEXION_DURANTE_CARGA"],
  [/MD5 of file does not match data in flash|Invalid head of packet|Possible serial noise or corruption/i, "CABLE_O_ALIMENTACION"],
]

/**
 * Lee la salida de una carga con esptool (la que deja pasar `pio run -t upload`).
 *
 * Cada `Wrote N bytes … at 0xOFFSET` abre una región. La región queda verificada sólo si
 * la línea `Hash of data verified.` aparece después de ELLA y antes de la región que
 * sigue: un hash verificado no se le atribuye a otra región.
 */
export function leerSalidaEsptool(stdout: string, stderr: string): ResultadoEsptool {
  const r: ResultadoEsptool = { exito: false, chip: null, mac: null, regiones: [], puertoUsado: null, resetFinal: false, marcaSuccess: false, sintoma: null }
  let abierta: RegionEscrita | null = null
  let errorFatal = false
  for (const cruda of lineasDe(stdout, stderr)) {
    const linea = cruda.trim()
    if (linea === "") continue
    const escrita = linea.match(/^Wrote (\d{1,10}) bytes(?: \(\d{1,10} compressed\))? at 0x([0-9a-fA-F]{8})\b/)
    if (escrita) {
      abierta = { offset: Number.parseInt(escrita[2]!, 16), bytes: Number(escrita[1]), hashVerificado: false }
      r.regiones.push(abierta)
      continue
    }
    if (/^Hash of data verified\.$/.test(linea)) {
      if (abierta) abierta.hashVerificado = true
      // Un hash verificado vale para UNA región: la siguiente tiene que traer el suyo.
      abierta = null
      continue
    }
    const escribiendo = linea.match(/^Writing at 0x([0-9a-fA-F]{8})\.\.\./)
    if (escribiendo) {
      r.ultimoOffset = Number.parseInt(escribiendo[1]!, 16)
      // Empezó otra región: la anterior ya no puede recibir un hash.
      abierta = null
      continue
    }
    if (/^Compressed \d+ bytes to \d+\.\.\./.test(linea)) {
      abierta = null
      continue
    }
    const chip = linea.match(/^Chip is (.{1,80})$/)
    if (chip && r.chip === null) r.chip = chip[1]!
    const mac = linea.match(/^MAC: ((?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})$/)
    if (mac && r.mac === null) r.mac = mac[1]!.toLowerCase()
    const puerto = linea.match(/^Serial port (\S{1,120})$/)
    if (puerto && r.puertoUsado === null) r.puertoUsado = puerto[1]!
    if (/^Hard resetting via RTS pin\.\.\.$/.test(linea)) r.resetFinal = true
    if (/^=+ \[SUCCESS\] /.test(linea)) r.marcaSuccess = true
    if (/A fatal error occurred|A serial exception error occurred|^=+ \[FAILED\] /.test(linea)) errorFatal = true
    if (r.sintoma === null) for (const [re, sintoma] of SINTOMAS) if (re.test(linea)) {
      r.sintoma = sintoma
      break
    }
  }
  r.exito = r.regiones.length > 0 && r.regiones.every((x) => x.hashVerificado) && !errorFatal && r.sintoma === null
  return r
}

export interface ResultadoAvrdude {
  escrito: boolean
  bytesEscritos: number | null
  verificado: boolean
  bytesVerificados: number | null
  sintoma: string | null
}

/**
 * Lee la salida de avrdude. TRABAJO PREPARATORIO (ND-3): los patrones salen de las cadenas
 * de formato del binario, no de una carga real, y nada de lo que devuelve habilita un
 * `ok` mientras `VERIFICACION_AVRDUDE_HABILITADA` esté apagado.
 */
export function leerSalidaAvrdude(stdout: string, stderr: string): ResultadoAvrdude {
  const r: ResultadoAvrdude = { escrito: false, bytesEscritos: null, verificado: false, bytesVerificados: null, sintoma: null }
  let errorDeVerificacion = false
  for (const cruda of lineasDe(stdout, stderr)) {
    const linea = cruda.trim()
    const escritos = linea.match(/^avrdude(?:\.exe)?: (\d{1,10}) bytes of flash written$/)
    if (escritos) {
      r.escrito = true
      r.bytesEscritos = Number(escritos[1])
    }
    const verificados = linea.match(/^avrdude(?:\.exe)?: (\d{1,10}) bytes of flash verified$/)
    if (verificados) {
      r.verificado = true
      r.bytesVerificados = Number(verificados[1])
    }
    if (/verification error/.test(linea)) {
      errorDeVerificacion = true
      r.sintoma = "VERIFICACION_FALLIDA"
    } else if (r.sintoma === null && /not in sync|programmer is not responding|can't communicate with device/.test(linea)) r.sintoma = "PLACA_NO_RESPONDE"
    else if (r.sintoma === null && /can't open device/.test(linea)) r.sintoma = "PUERTO_NO_DISPONIBLE"
  }
  // Un error de verificación gana: aunque después aparezca un "verified", no está verificado.
  if (errorDeVerificacion) r.verificado = false
  // Verificar menos bytes de los que se escribieron no es verificar lo escrito.
  if (r.verificado && (r.bytesEscritos === null || r.bytesVerificados !== r.bytesEscritos)) r.verificado = false
  return r
}

/**
 * EL ÚNICO PUNTO DE ACTIVACIÓN de la verificación con avrdude (ND-3). Apagado: con una UNO
 * el veredicto es siempre `CARGA_SIN_VERIFICAR`. Prenderlo exige una carga real a una UNO
 * con su salida guardada como fixture y una decisión del owner; no es un interruptor de
 * configuración ni lo puede cambiar un argumento.
 */
export const VERIFICACION_AVRDUDE_HABILITADA: boolean = false

/** El texto EXACTO de ND-3 para una carga que no se pudo verificar. */
export const TEXTO_CARGA_SIN_VERIFICAR = "PlatformIO terminó correctamente, pero no pude verificar la escritura del firmware en la placa"

export interface Verificacion {
  platformio: "ok" | "fallo" | "desconocido"
  escritura: "reportada" | "no_reportada"
  dispositivo: "hash_en_chip" | "lectura_avrdude" | "sin_verificar"
}

export interface VeredictoDeCarga {
  ok: boolean
  /** Ausente sólo cuando `ok` es `true`. */
  codigo?: "CARGA_SIN_VERIFICAR" | "CARGA_FALLIDA" | "ESTADO_DESCONOCIDO"
  verificacion: Verificacion
  texto: string
  /** Por qué no es `ok`, en una línea, para el registro y el diagnóstico. */
  detalle?: string
  esptool?: ResultadoEsptool
  avrdude?: ResultadoAvrdude
}

export interface DatosDeLaCarga {
  /** Con qué herramienta carga la placa. La decide el gate por la placa, no la salida. */
  herramienta: "esptool" | "avrdude"
  /** El `code` del `RunResult` de la carga. */
  code: number
  stdout: string
  stderr: string
  /**
   * Las imágenes que se AUTORIZÓ cargar: dónde va cada una y cuánto pesa su archivo. La
   * lista la declara quien llama (cuáles son queda fuera de este módulo).
   */
  imagenes: ReadonlyArray<{ offset: number; bytes: number }>
}

const alineadoA4 = (n: number) => Math.ceil(n / 4) * 4

/**
 * Qué se puede afirmar de una carga que ya terminó. Pura.
 *
 * `ok: true` ⇔ rc 0 ∧ esptool reportó EXACTAMENTE las regiones autorizadas (mismo offset,
 * mismos bytes; esptool alinea la imagen a 4, `cmds.py:590`) ∧ cada una con su `Hash of
 * data verified.` ∧ ninguna señal de error. Una región de más, de menos o de otro tamaño
 * es `CARGA_SIN_VERIFICAR`: se grabó algo que no es lo que se autorizó.
 */
export function veredictoDeCarga(d: DatosDeLaCarga): VeredictoDeCarga {
  const platformio: Verificacion["platformio"] = d.code === 0 ? "ok" : d.code === CODIGO_TIMEOUT || d.code === CODIGO_CANCELADO ? "desconocido" : "fallo"
  const sinVerificar = (verificacion: Verificacion, detalle: string, extra: Partial<VeredictoDeCarga>): VeredictoDeCarga => {
    if (platformio === "desconocido") return { ok: false, codigo: "ESTADO_DESCONOCIDO", verificacion, texto: "La carga se cortó antes de terminar: no sé en qué estado quedó la placa", detalle, ...extra }
    if (platformio === "fallo") return { ok: false, codigo: "CARGA_FALLIDA", verificacion, texto: "La carga falló", detalle, ...extra }
    return { ok: false, codigo: "CARGA_SIN_VERIFICAR", verificacion, texto: TEXTO_CARGA_SIN_VERIFICAR, detalle, ...extra }
  }

  if (d.herramienta === "avrdude") {
    const avrdude = leerSalidaAvrdude(d.stdout, d.stderr)
    const candidata = verificacionAvrdudeSiSeHabilitara(avrdude, d.imagenes)
    if (!VERIFICACION_AVRDUDE_HABILITADA) {
      // ND-3: sin evidencia real de avrdude, lo que diga la salida no cuenta como verificación.
      return sinVerificar({ platformio, escritura: candidata.escritura, dispositivo: "sin_verificar" }, "la verificación con avrdude no está habilitada (ND-3)", { avrdude })
    }
    const verificacion: Verificacion = { platformio, ...candidata }
    if (platformio === "ok" && candidata.escritura === "reportada" && candidata.dispositivo === "lectura_avrdude") return { ok: true, verificacion, texto: "CARGADO — PlatformIO terminó bien, avrdude escribió y releyó la memoria", avrdude }
    return sinVerificar(verificacion, avrdude.sintoma ?? "avrdude no reportó la escritura y la verificación de todo el firmware", { avrdude })
  }

  if (d.herramienta !== "esptool") return sinVerificar({ platformio, escritura: "no_reportada", dispositivo: "sin_verificar" }, "herramienta de carga desconocida", {})

  const esptool = leerSalidaEsptool(d.stdout, d.stderr)
  const esperadas = [...d.imagenes].sort((a, b) => a.offset - b.offset)
  const escritas = [...esptool.regiones].sort((a, b) => a.offset - b.offset)
  const coinciden =
    esperadas.length > 0 &&
    escritas.length === esperadas.length &&
    esperadas.every((img, i) => Number.isSafeInteger(img.offset) && Number.isSafeInteger(img.bytes) && img.bytes > 0 && escritas[i]!.offset === img.offset && escritas[i]!.bytes === alineadoA4(img.bytes))
  const escritura: Verificacion["escritura"] = coinciden ? "reportada" : "no_reportada"
  const dispositivo: Verificacion["dispositivo"] = coinciden && esptool.exito ? "hash_en_chip" : "sin_verificar"
  const verificacion: Verificacion = { platformio, escritura, dispositivo }
  if (platformio === "ok" && escritura === "reportada" && dispositivo === "hash_en_chip") {
    const n = escritas.length
    return { ok: true, verificacion, texto: `CARGADO — PlatformIO terminó bien, esptool escribió ${n} ${n === 1 ? "región" : "regiones"}, la placa verificó el hash`, esptool }
  }
  const detalle = !coinciden
    ? `esptool reportó ${escritas.length} ${escritas.length === 1 ? "región" : "regiones"} y se autorizaron ${esperadas.length}, o no coinciden en lugar o tamaño`
    : esptool.sintoma ?? "falta `Hash of data verified.` en alguna región"
  return sinVerificar(verificacion, detalle, { esptool })
}

/**
 * Lo que la salida de avrdude PERMITIRÍA afirmar si la verificación estuviera habilitada.
 * No decide nada: `veredictoDeCarga` la usa sólo con `VERIFICACION_AVRDUDE_HABILITADA`
 * prendido. Está separada para poder probar la lógica sin prender el interruptor.
 */
export function verificacionAvrdudeSiSeHabilitara(a: ResultadoAvrdude, imagenes: ReadonlyArray<{ offset: number; bytes: number }>): Pick<Verificacion, "escritura" | "dispositivo"> {
  // Un .hex pesa más que lo que graba: acá no se compara contra el tamaño del archivo, sólo
  // se exige UNA imagen declarada y que avrdude diga cuánto escribió.
  const escritura = imagenes.length === 1 && a.escrito && a.bytesEscritos !== null && a.bytesEscritos > 0 ? "reportada" : "no_reportada"
  const dispositivo = escritura === "reportada" && a.verificado && a.sintoma === null ? "lectura_avrdude" : "sin_verificar"
  return { escritura, dispositivo }
}
