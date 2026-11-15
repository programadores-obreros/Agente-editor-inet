// `carga/identidad.ts` — qué hay del otro lado del cable, y cuál de esas placas es.
//
// DE DÓNDE SALE. `identificar`, la tabla `CHIPS_USB` y `puertoValido` vivían en
// `opencode/tool/platformio.ts` y se movieron acá sin cambiar (Slice 2 del gate único de
// carga, ADR-001 §2.1 y §2.5, CONTRATOS-API §2); `tool/platformio.ts` los re-exporta con
// los mismos nombres. Lo demás es nuevo y todavía no lo usa ninguna tool: lo cablea el
// gate (`carga/gate.ts`) en una etapa posterior.
//
// QUÉ RESUELVE LO NUEVO. La ruta de carga vieja tiene tres huecos de identidad
// (A4-IDENTIDAD-DISPOSITIVO §1.2):
//   - con un puerto explícito no se mira qué hay en ese puerto;
//   - un número de serie de fábrica repetido (`SER=0001` de los clones CP2102) cuenta
//     como identidad de UNA placa, y dos placas distintas pasan por la misma;
//   - el CH9102 recibía el link del driver del CH340, que no le sirve.
// Acá cada placa detectada lleva un NIVEL de identidad, y `elegirPuerto` decide con
// una tabla cerrada de casos. Nunca elige "la primera".
//
// Este módulo importa sólo `node:` y `./proceso.ts` — nunca `tool/` ni el plugin.

import { createHash } from "node:crypto"
import type { Run } from "./proceso.ts"

/** Un puerto tal como lo informa `pio device list --json-output`, sin interpretar. */
export interface PuertoCrudo {
  port: string
  hwid?: string
  description?: string
}

/**
 * Cuánto se puede confiar en que una placa detectada es ESA placa y no otra igual.
 *   - "fuerte": VID:PID + un número de serie que NO es genérico. Se la reconoce aunque
 *     cambie de zócalo USB o de nombre de puerto.
 *   - "posicional": VID:PID + el puerto donde está ahora. No tiene serie, o la que
 *     tiene es genérica o está repetida entre las detectadas: no se la puede distinguir
 *     de otra del mismo modelo.
 *   - "ninguna": no hay VID:PID. No es una placa a la que se pueda cargar desde el gate.
 */
export type NivelIdentidad = "fuerte" | "posicional" | "ninguna"

export interface PlacaDetectada {
  puerto: string
  vid: string
  pid: string
  /** El número de serie si es de fiar; `null` si no hay, es genérico o está repetido. */
  serie: string | null
  /** `LOCATION=` del hwid (bus y zócalo), si lo informa. Sólo informativo: no es identidad. */
  ubicacion: string | null
  chip: string
  descripcion: string
  driverWindows?: string
  /** `VID:PID#SERIE@puerto` (fuerte) o `VID:PID@puerto` (posicional). Sólo en memoria: NUNCA se guarda en disco. */
  identidad: string
  nivel: NivelIdentidad
}

export interface Descubrimiento {
  /** Lo que es una placa (USB, con VID:PID, en un puerto con forma válida). */
  placas: PlacaDetectada[]
  /** Lo que apareció y NO es una placa: el COM1 de la máquina, Bluetooth, puertos sin hwid. */
  otros: PuertoCrudo[]
  /** Todo lo que informó PlatformIO, sin tocar. */
  crudo: PuertoCrudo[]
  /**
   * Presente sólo si `pio device list` NO se pudo leer (terminó mal, se cortó por
   * timeout o cancelación, o no devolvió una lista). Ahí `placas` viene vacío: sin
   * lista no hay placa. Quien llama usa `code` para no decir "no hay ninguna placa"
   * cuando lo que pasó es que se canceló la acción.
   */
  fallo?: { code: number; detalle: string }
}

/**
 * WHITELIST de formas REALES de puerto serie, una por plataforma — falla
 * cerrada: si `puerto` no matchea NINGUNA, se rechaza. No hay un tercer caso
 * que acepte "lo que sea".
 *
 * De donde sale cada forma (no se inventan, se leen del propio repo):
 *   - Windows `COM<n>`: es el patron que ya usa `detectPort()` para leer la
 *     salida cruda de `pio device list` cuando el JSON no parsea (mas abajo,
 *     `/COM\d+/g`), y el ejemplo que da la propia descripcion del tool
 *     ("ej: COM3").
 *   - Unix `/dev/tty(USB|ACM)<n>`: el mismo fallback, rama Linux
 *     (`/\/dev\/tty(?:USB|ACM)\d+/g`).
 *   - Unix `/dev/cu.*` y `/dev/tty.*` con sufijo de nombre de chip: lo que
 *     pyserial (la libreria que usa `pio device list`) devuelve en macOS —
 *     `cu.usbserial-14140`, `cu.SLAB_USBtoUART`, `cu.Bluetooth-Incoming-Port` —
 *     por eso el sufijo permite letras, digitos, punto, guion y guion bajo (el
 *     alfabeto real de esos nombres) y nada mas: ni `$`, ni backtick, ni `;`,
 *     ni espacio, ni comillas.
 *
 * Se aplica en las dos ramas de `monitor` donde el puerto llega a un shell
 * (en `tool/platformio.ts`, adentro de `execute()`): macOS usa `puertoValido()`
 * (AppleScript -> shell POSIX) y Windows usa sólo `PUERTO_WINDOWS` (`cmd /c start
 * ... cmd /k`, y cmd.exe re-parsea su linea). Linux no valida: ahi el puerto va
 * como argv a la terminal, sin shell intermedio.
 *
 * Y EN LA CARGA (gate, Slice 2): una IP o un hostname NO son un puerto. Si llegaran
 * a `--upload-port`, PlatformIO cambia solo a carga por red (`espota`), sin que
 * nadie lo haya pedido. `elegirPuerto` los rechaza con `PUERTO_INVALIDO`. "¿Es una
 * placa?" no se contesta aca: lo decide `elegirPuerto` con el hwid.
 */
export const PUERTO_WINDOWS = /^COM\d+$/i
export const PUERTO_UNIX = /^\/dev\/(?:tty|cu)[A-Za-z0-9._-]+$/
export function puertoValido(puerto: string): boolean {
  return PUERTO_WINDOWS.test(puerto) || PUERTO_UNIX.test(puerto)
}

/**
 * Qué chip USB-serial hay del otro lado del cable, según su VID:PID.
 *
 * POR QUÉ IMPORTA ESTO EN UN AULA. Un docente conecta la placa y no pasa nada.
 * El problema casi nunca es la placa: es que Windows no trae el driver del chip
 * USB-serial que usan los clones baratos —el CH340— y sin driver no aparece
 * ningún puerto. Decirle "no encuentro tu Arduino" no lo ayuda; decirle "es un
 * CH340 y le falta el driver, bajalo de acá" lo desbloquea en dos minutos.
 *
 * Y HAY UN SEGUNDO PROBLEMA, más silencioso: `pio device list` devuelve TODOS
 * los puertos serie, no sólo las placas. En una máquina virtual aparece un COM1
 * emulado (`ACPI\PNP0501`) que no es nada — y el diagnóstico anterior lo contaba
 * como "dispositivo conectado". El docente veía todo en verde y la carga fallaba.
 *
 * Lo que NO se puede saber por el VID:PID es QUÉ PLACA es: un CH340 puede ser un
 * Arduino clon, un ESP32 o un ESP8266 — el chip serial es el mismo. Por eso
 * `placa` dice lo que se sabe y nada más, sin adivinar.
 *
 * EL ORDEN IMPORTA: `identificar` se queda con la PRIMERA fila que coincide. Una fila
 * con `pid` va siempre ANTES que la genérica de su mismo `vid`.
 */
export const CHIPS_USB: ReadonlyArray<{
  vid: string
  pid?: string
  chip: string
  placa: string
  driverWindows?: string
}> = [
  /*
   * CH9102 (1A86:55D4), ANTES de la fila genérica de WCH. Sin esta fila caía en
   * "CH340 / CH341" y, en Windows, se le daba al docente el link de CH341SER: el
   * driver del CH340, que al CH9102 no le sirve. El suyo es CH343SER (la página
   * oficial de WCH lo lista para "CH342, CH343, ..., CH9102, ..."; verificado
   * 2026-10-27, A4-IDENTIDAD-DISPOSITIVO §6). Es el chip de la ESP32 DevKit con la
   * que se hizo la prueba de hardware del proyecto.
   */
  {
    vid: "1A86",
    pid: "55D4",
    chip: "CH9102 (WCH)",
    placa: "ESP32 DevKit (variante con CH9102)",
    driverWindows: "https://www.wch-ic.com/downloads/CH343SER_EXE.html",
  },
  {
    vid: "1A86",
    chip: "CH340 / CH341",
    placa: "clon de Arduino, o un ESP32/ESP8266",
    driverWindows: "https://www.wch-ic.com/downloads/CH341SER_EXE.html",
  },
  {
    vid: "10C4",
    pid: "EA60",
    chip: "CP2102 (Silicon Labs)",
    placa: "muy común en placas ESP32 DevKit",
    driverWindows: "https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers",
  },
  {
    vid: "0403",
    chip: "FTDI",
    placa: "Arduino Nano viejo, o una placa con FTDI",
    driverWindows: "https://ftdichip.com/drivers/vcp-drivers/",
  },
  { vid: "2341", chip: "el propio de Arduino", placa: "Arduino oficial" },
  { vid: "2A03", chip: "el propio de Arduino", placa: "Arduino (arduino.org)" },
  { vid: "303A", chip: "USB nativo de Espressif", placa: "ESP32-S2, S3 o C3" },
]

/** Los puertos serie que NO son una placa: los trae la máquina, no el cable. */
const NO_ES_PLACA = /ACPI\\PNP|BTHENUM|\\VIRTUAL/i

/**
 * Lee el `hwid` que devuelve PlatformIO y dice qué es.
 *
 * Exportada para poder probarla con hwids reales sin tener la placa enchufada.
 */
export function identificar(
  hwid?: string,
  descripcion?: string,
): { esPlaca: boolean; chip?: string; placa?: string; driverWindows?: string; motivo?: string } {
  const id = (hwid ?? "").toUpperCase()

  if (!id) return { esPlaca: false, motivo: "el sistema no informa qué es" }

  if (NO_ES_PLACA.test(id)) {
    return {
      esPlaca: false,
      motivo: "es un puerto serie de la propia máquina, no una placa conectada",
    }
  }

  /*
   * DOS FORMATOS, y hay que aceptar los dos.
   *
   *   Linux / pyserial   USB VID:PID=1A86:7523 LOCATION=1-1
   *   Windows crudo      USB\VID_1A86&PID_7523\5&1D2A3B4C&0&2
   *
   * El primero pone los dos números juntos después del `=`; el segundo, cada uno
   * detrás de su etiqueta. Una regex sola no cubre los dos, y quedarse con la de
   * Windows —que fue lo que hice primero— deja ciega a la mitad de las máquinas.
   */
  const junto = id.match(/VID:PID=([0-9A-F]{4}):([0-9A-F]{4})/)
  const vid = junto?.[1] ?? id.match(/VID_([0-9A-F]{4})/)?.[1]
  const pid = junto?.[2] ?? id.match(/PID_([0-9A-F]{4})/)?.[1]

  if (!vid) {
    return {
      esPlaca: false,
      motivo: "no tiene identificador USB, así que no llegó por un cable USB",
    }
  }

  const conocido = CHIPS_USB.find((c) => c.vid === vid && (!c.pid || c.pid === pid))
  if (conocido) {
    return {
      esPlaca: true,
      chip: conocido.chip,
      placa: conocido.placa,
      driverWindows: conocido.driverWindows,
    }
  }

  // USB pero de un fabricante que no está en la tabla: probablemente sirve igual.
  return {
    esPlaca: true,
    chip: `USB ${vid}${pid ? ":" + pid : ""}`,
    placa: descripcion || "no está en mi lista, pero es un dispositivo USB",
  }
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LA IDENTIDAD DE UNA PLACA, POR NIVELES
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Las formas con que algunos sistemas escriben "no hay serie" como si fuera una. */
const SERIES_QUE_SON_AUSENCIA = new Set(["none", "null", "undefined", "n/a"])

/**
 * ¿Este número de serie NO sirve para distinguir una placa de otra?
 *
 * Sí, si: no hay (`null`, `undefined`), está vacío (el `SER=` que escribe pyserial en
 * Windows cuando no encuentra serie), es todo ceros, es `1` con ceros adelante (el
 * `0001` de fábrica de los CP2102 clonados, que se repite entre unidades), tiene menos
 * de 4 caracteres, o contiene `&` (ese "serie" lo inventa Windows con la ubicación:
 * cambia al cambiar de zócalo). También el texto de una ausencia ("None", "null").
 *
 * Lo que NO se puede saber mirando una sola serie es si está repetida entre unidades:
 * eso lo cubre `clasificarPuertos` cuando ve dos placas con la misma.
 */
export function serieEsGenerica(serie: string | null | undefined): boolean {
  if (serie === null || serie === undefined) return true
  const s = serie.trim()
  if (s === "") return true
  if (/^0+$/.test(s)) return true
  if (/^0*1$/.test(s)) return true
  if (s.length < 4) return true
  if (s.includes("&")) return true
  if (SERIES_QUE_SON_AUSENCIA.has(s.toLowerCase())) return true
  return false
}

/** VID, PID, serie tal como viene y ubicación, de los dos formatos de hwid. */
function leerHwid(hwid: string | undefined): { vid: string | null; pid: string | null; serieCruda: string | null; ubicacion: string | null } {
  if (!hwid) return { vid: null, pid: null, serieCruda: null, ubicacion: null }
  const id = hwid.toUpperCase()
  const junto = id.match(/VID:PID=([0-9A-F]{4}):([0-9A-F]{4})/)
  const vid = junto?.[1] ?? id.match(/VID_([0-9A-F]{4})/)?.[1] ?? null
  const pid = junto?.[2] ?? id.match(/PID_([0-9A-F]{4})/)?.[1] ?? null
  // `SER=` puede venir VACÍO (pyserial en Windows): por eso `\S*` y no `\S+`.
  const serieCruda = hwid.match(/\bSER=(\S*)/i)?.[1] ?? hwid.match(/^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}[^\\]*\\([^\\\s]+)$/i)?.[1] ?? null
  const ubicacion = hwid.match(/\bLOCATION=(\S+)/i)?.[1] ?? null
  return { vid, pid, serieCruda, ubicacion }
}

/**
 * Lo que un hwid dice sobre la identidad de la placa.
 *
 * `modelo` es `VID:PID` (o `null` si falta alguno de los dos). `serie` viene sólo si
 * es de fiar: una serie genérica se devuelve como `null`, igual que si no hubiera.
 * `nivel` es "ninguna" sin modelo, "fuerte" con serie de fiar y "posicional" si no.
 *
 * OJO: NO es la `identidadDePlaca` de `tool/platformio.ts`, que sigue existiendo
 * hasta que el registro de cargas se mude a `carga/registro.ts`: aquélla toma `0001`
 * como serie válida, y los hashes ya guardados en las compus dependen de eso.
 */
export function identidadDePlaca(hwid: string | undefined): { modelo: string | null; serie: string | null; nivel: NivelIdentidad } {
  const { vid, pid, serieCruda } = leerHwid(hwid)
  if (!vid || !pid) return { modelo: null, serie: null, nivel: "ninguna" }
  const serie = serieEsGenerica(serieCruda) ? null : (serieCruda as string).trim()
  return { modelo: `${vid}:${pid}`, serie, nivel: serie ? "fuerte" : "posicional" }
}

/**
 * La identidad de una placa como hash con la sal de la compu, que es lo único que se
 * guarda y se compara (ADR-001 §9.6). Mismo formato que el registro de cargas de hoy:
 * `sha256(sal | modelo | serie)`, con `sin-serie` cuando no hay serie de fiar.
 */
export function hashDePlacaFisica(sal: string, modelo: string, serie: string | null): string {
  return createHash("sha256").update(`${sal}|${modelo}|${serie ?? "sin-serie"}`).digest("hex")
}

const identidadLegible = (modelo: string, serie: string | null, puerto: string) => (serie ? `${modelo}#${serie}@${puerto}` : `${modelo}@${puerto}`)

/** En Windows `COM5` y `com5` son el mismo puerto; en Unix la ruta distingue mayúsculas. */
function mismoPuerto(a: string, b: string): boolean {
  if (PUERTO_WINDOWS.test(a) && PUERTO_WINDOWS.test(b)) return a.toUpperCase() === b.toUpperCase()
  return a === b
}

/**
 * Separa lo que informó PlatformIO en placas y todo lo demás.
 *
 * Es placa lo que `identificar` dice que es placa, tiene VID y PID, y está en un
 * puerto con la forma de `plataforma` (`COM<n>` en Windows, `/dev/tty*` o `/dev/cu*`
 * en el resto). Un nombre de puerto raro no llega nunca a un argv de carga.
 *
 * Si dos placas detectadas traen el MISMO modelo y la MISMA serie, esa serie no
 * distingue nada (clones con la serie copiada): las dos bajan a "posicional".
 */
export function clasificarPuertos(crudo: PuertoCrudo[], plataforma: NodeJS.Platform): Descubrimiento {
  const forma = plataforma === "win32" ? PUERTO_WINDOWS : PUERTO_UNIX
  const placas: PlacaDetectada[] = []
  const otros: PuertoCrudo[] = []
  for (const c of crudo) {
    const q = identificar(c.hwid, c.description)
    const { vid, pid, ubicacion } = leerHwid(c.hwid)
    const id = identidadDePlaca(c.hwid)
    if (!q.esPlaca || !vid || !pid || id.modelo === null || !forma.test(c.port)) {
      otros.push(c)
      continue
    }
    placas.push({
      puerto: c.port,
      vid,
      pid,
      serie: id.serie,
      ubicacion,
      chip: q.chip ?? `USB ${id.modelo}`,
      descripcion: c.description ?? "",
      ...(q.driverWindows ? { driverWindows: q.driverWindows } : {}),
      identidad: identidadLegible(id.modelo, id.serie, c.port),
      nivel: id.nivel,
    })
  }
  const veces = new Map<string, number>()
  for (const p of placas) {
    if (p.nivel !== "fuerte") continue
    const clave = `${p.vid}:${p.pid}#${p.serie}`
    veces.set(clave, (veces.get(clave) ?? 0) + 1)
  }
  for (const p of placas) {
    if (p.nivel === "fuerte" && (veces.get(`${p.vid}:${p.pid}#${p.serie}`) ?? 0) > 1) {
      p.serie = null
      p.nivel = "posicional"
      p.identidad = identidadLegible(`${p.vid}:${p.pid}`, null, p.puerto)
    }
  }
  return { placas, otros, crudo }
}

/**
 * Le pregunta a PlatformIO qué puertos hay y los clasifica. No abre ningún puerto.
 *
 * Si la lista no se puede leer, NO se adivina con una regex sobre la salida (eso
 * hacía la detección vieja, y daba puertos sin hwid): se devuelve sin placas y con
 * `fallo`. Sin lista no hay placa.
 */
export async function descubrir(run: Run, cwd: string, signal?: AbortSignal): Promise<Descubrimiento> {
  const r = await run(["pio", "device", "list", "--json-output"], cwd, signal)
  const sinLista = (detalle: string): Descubrimiento => ({ placas: [], otros: [], crudo: [], fallo: { code: r.code, detalle } })
  if (r.code !== 0) return sinLista("PlatformIO no pudo listar los puertos")
  let leido: unknown
  try {
    leido = JSON.parse(r.stdout)
  } catch {
    return sinLista("la lista de puertos de PlatformIO no se pudo leer")
  }
  if (!Array.isArray(leido)) return sinLista("PlatformIO no devolvió una lista de puertos")
  const crudo: PuertoCrudo[] = []
  for (const fila of leido as unknown[]) {
    if (fila === null || typeof fila !== "object") continue
    const f = fila as Record<string, unknown>
    if (typeof f.port !== "string" || f.port === "") continue
    crudo.push({
      port: f.port,
      ...(typeof f.hwid === "string" ? { hwid: f.hwid } : {}),
      ...(typeof f.description === "string" ? { description: f.description } : {}),
    })
  }
  return clasificarPuertos(crudo, process.platform)
}

export type CodigoDePuerto = "SIN_PLACA" | "VARIAS_PLACAS" | "PUERTO_NO_ESTA" | "PUERTO_NO_ES_PLACA" | "PUERTO_INVALIDO" | "PLACA_EQUIVOCADA"

export type EleccionDePuerto =
  | { ok: true; placa: PlacaDetectada }
  | { ok: false; codigo: CodigoDePuerto; candidatas: PlacaDetectada[]; otros: PuertoCrudo[] }

/**
 * Elige UNA placa, o dice por qué no puede. Nunca "la primera".
 *
 * `placaFisicaEsperada` es el hash con sal de la placa que se espera (el del registro
 * de cargas), nunca la serie en claro: acá se hashea cada candidata con `sal` y se
 * comparan hashes.
 *
 * Los casos (A4-IDENTIDAD-DISPOSITIVO §4; `tests/carga-identidad.test.mjs` los fija
 * uno por uno):
 *
 *    #  placas  puerto pedido          placa esperada              resultado
 *    1  0       —                      —                           SIN_PLACA
 *    2  0       sí                     —                           PUERTO_NO_ESTA
 *    3  1       —                      —                           ok
 *    4  1       el de la placa         —                           ok
 *    5  1       otro                   —                           PUERTO_NO_ESTA
 *    6  1       —                      coincide                    ok
 *    7  1       —                      no coincide                 PLACA_EQUIVOCADA
 *    8  ≥2      —                      —                           VARIAS_PLACAS
 *    9  ≥2      uno de la lista        —                           ok, con la pedida
 *   10  ≥2      uno que no está        —                           PUERTO_NO_ESTA
 *   11  ≥2      —                      fuerte, coincide una sola   ok, con ésa
 *   12  ≥2      —                      posicional, o coinciden ≥2  VARIAS_PLACAS
 *   13  ≥2      —                      no coincide ninguna         PLACA_EQUIVOCADA
 *
 * Además: un puerto pedido con forma inválida (una IP, un hostname, cualquier cosa
 * que no sea un puerto serie) es PUERTO_INVALIDO antes de mirar nada; un puerto
 * pedido que está en la lista pero no es una placa es PUERTO_NO_ES_PLACA; y si se
 * piden las dos cosas (puerto y placa esperada), tienen que cumplirse las dos.
 */
export function elegirPuerto(d: Descubrimiento, o: { puertoPedido?: string; placaFisicaEsperada?: string; sal: string }): EleccionDePuerto {
  const no = (codigo: CodigoDePuerto): EleccionDePuerto => ({ ok: false, codigo, candidatas: d.placas, otros: d.otros })
  const esLaEsperada = (p: PlacaDetectada) => hashDePlacaFisica(o.sal, `${p.vid}:${p.pid}`, p.serie) === o.placaFisicaEsperada

  if (o.puertoPedido !== undefined) {
    const pedido = o.puertoPedido
    if (!puertoValido(pedido)) return no("PUERTO_INVALIDO")
    const placa = d.placas.find((p) => mismoPuerto(p.puerto, pedido))
    if (!placa) return no(d.otros.some((c) => mismoPuerto(c.port, pedido)) ? "PUERTO_NO_ES_PLACA" : "PUERTO_NO_ESTA")
    if (o.placaFisicaEsperada !== undefined && !esLaEsperada(placa)) return no("PLACA_EQUIVOCADA")
    return { ok: true, placa }
  }

  if (d.placas.length === 0) return no("SIN_PLACA")

  if (o.placaFisicaEsperada !== undefined) {
    const coinciden = d.placas.filter(esLaEsperada)
    const unica = coinciden[0]
    if (!unica) return no("PLACA_EQUIVOCADA")
    if (d.placas.length === 1) return { ok: true, placa: unica }
    // Con varias enchufadas sólo desempata una identidad FUERTE que coincide una sola vez.
    if (coinciden.length === 1 && unica.nivel === "fuerte") return { ok: true, placa: unica }
    return no("VARIAS_PLACAS")
  }

  const sola = d.placas[0]
  if (sola && d.placas.length === 1) return { ok: true, placa: sola }
  return no("VARIAS_PLACAS")
}

/**
 * ¿`a` y `b` son la misma placa? Sirve para comparar lo que se vio ANTES del cartel
 * con lo que hay DESPUÉS.
 *
 *   - niveles distintos: no (si antes se la reconocía por serie y ahora no, o al
 *     revés, algo cambió);
 *   - "fuerte": mismo modelo y misma serie. El puerto NO entra: quien llama decide
 *     qué hacer si la misma placa apareció en otro puerto (el gate lo rechaza, porque
 *     el puerto autorizado ya no es el suyo — ADR-001 §9.13);
 *   - "posicional": mismo modelo y mismo puerto;
 *   - "ninguna": nunca.
 */
export function mismaIdentidad(a: PlacaDetectada, b: PlacaDetectada): boolean {
  if (a.nivel !== b.nivel) return false
  if (a.vid !== b.vid || a.pid !== b.pid) return false
  if (a.nivel === "fuerte") return a.serie !== null && a.serie === b.serie
  if (a.nivel === "posicional") return mismoPuerto(a.puerto, b.puerto)
  return false
}
