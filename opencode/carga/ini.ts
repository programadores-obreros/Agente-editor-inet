// `carga/ini.ts` — la auditoría del `platformio.ini` (Slice 2, gate único de carga).
//
// POR QUÉ EXISTE. `pio run` no es "compilar": es ejecutar lo que el `platformio.ini` diga.
// Medido con PlatformIO Core 6.1.19 (informes H-03 y R-01 del Slice 2): `extra_scripts`,
// `build_flags = !comando` y el `library.json` de una librería corren código en la compu
// durante un `pio run` SIN `upload` en el argv, antes de cualquier cartel. Y varias opciones
// cambian qué se graba en la placa (`board_build.mcu`, `board_build.f_flash`,
// `board_upload.*`, `upload_flags`, `upload_command`). Por eso esta auditoría va ANTES de
// todo `pio run` sobre una carpeta de usuario y es independiente del cartel de carga.
//
// LA REGLA: TABLA CERRADA. Sólo pasa la opción que está escrita abajo como admitida, con
// el valor en la forma que está escrita abajo. Todo lo demás —lo peligroso conocido, lo
// desconocido y lo que este parser no entiende con certeza— se rechaza. No hay "advertir y
// seguir" para nada que pueda ejecutar código (decisión del owner sobre R-04, documento
// `02-DECISIONES-ND1-ND2-ND3.md`: gramática cerrada, rechazo por defecto).
//
// NO SE LE PREGUNTA A `pio`. Este módulo no lanza ningún proceso: no está medido si
// `pio project config` ya dispara efectos, así que no se depende de eso.
//
// ── EL PARSER ────────────────────────────────────────────────────────────────────────────
// PlatformIO lee el ini con `configparser.ConfigParser(inline_comment_prefixes=("#", ";"))`
// de Python (`platformio/project/config.py:97`). Ese lector es muy permisivo (claves con
// espacios, `:` como separador, `%(x)s`, la sección `DEFAULT`, cabeceras con sangría que
// según el contexto son una continuación...). Acá NO se lo imita: se admite un subconjunto
// estricto en el que las dos lecturas coinciden, y lo que cae afuera se rechaza.
//   - Fin de línea: `\n`, `\r\n` o `\r` suelto (Python abre el archivo con saltos
//     universales: un `\r` suelto ES un salto para PlatformIO).
//   - Comentario de línea entera: primer carácter no blanco `;` o `#`. Comentario al final:
//     `;` o `#` precedido de espacio o tab. Lo que queda después de sacar comentarios tiene
//     que ser ASCII imprimible (o tab) y no tener `%`. Fuera de un comentario no se admite
//     ni un carácter no ASCII: Python trata como blanco cosas que JS no, y al revés.
//   - Cabecera: `[platformio]`, `[env]` o `[env:nombre]`, sola en su línea y en la columna 0.
//   - Opción: `clave = valor` en la columna 0, con la clave en minúsculas.
//   - Línea con sangría: continúa el valor de la opción anterior (una línea más del valor).
//   - Sección o clave repetida: rechazo (PlatformIO también falla, pero no se depende de eso).
//
// ── INTERPOLACIONES ──────────────────────────────────────────────────────────────────────
// PlatformIO expande `${seccion.opcion}` y `${this.x}` de forma recursiva, `${sysenv.X}` con
// `os.getenv`, y deja pasar a SCons cualquier `${X}` que no reconoce (`config.py:315-379`);
// SCons evalúa `${...}` como una expresión (`SCons/Subst.py:386`). Se admite UNA forma:
// `${env.K}` escrito dentro de la opción `K` (el patrón `lib_deps = ${env.lib_deps}` de los
// proyectos con varias placas), para `lib_deps`, `build_flags` y `build_src_flags`. Se
// reemplaza por el valor de `K` en `[env]` y el resultado se vuelve a validar entero. Si
// después de expandir queda un `$`, se rechaza.
//
// ── FLAGS DE COMPILACIÓN (R-04) ──────────────────────────────────────────────────────────
// Cada línea del valor llega por separado al `ParseFlags` de SCons (`piobuild.py:191-196`),
// que la parte con `shlex.split` y, si empieza con `!`, la EJECUTA como comando
// (`SCons/Environment.py:881-882`). La especificación de lo que se admite está escrita en
// `leerFlags`, más abajo. Resumen: sólo `-D NOMBRE`, `-DNOMBRE`, `-D NOMBRE=valor` y
// `-DNOMBRE=valor`, con alfabetos cerrados. Nada más.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { puertoValido } from "./identidad.ts"

export type ModoDeAuditoria = "compilacion" | "carga"

export type MotivoIni =
  | "ARCHIVO_AUSENTE"
  | "ARCHIVO_NO_REGULAR"
  | "ARCHIVO_ILEGIBLE"
  | "ARCHIVO_DEMASIADO_GRANDE"
  | "CARACTER_NO_ADMITIDO"
  | "LINEA_NO_ENTENDIDA"
  | "SECCION_NO_ADMITIDA"
  | "SECCION_REPETIDA"
  | "CLAVE_REPETIDA"
  | "OPCION_NO_ADMITIDA"
  | "VALOR_NO_ADMITIDO"
  | "INTERPOLACION_NO_ADMITIDA"
  | "FLAG_NO_ADMITIDO"
  | "CARPETA_NO_ADMITIDA"
  | "MODO_NO_ADMITIDO"

export interface RechazoIni {
  /** `platformio`, `env`, `env:nombre`, o `""` si el problema es del archivo o de la carpeta. */
  seccion: string
  /** La opción, o lo que se rechazó (`boards/`, `platformio.ini`, `línea 12`). */
  clave: string
  motivo: MotivoIni
  detalle: string
}

/** Una macro que llega al compilador: `-DNOMBRE` (valor `null`) o `-DNOMBRE=valor`. */
export interface DefinicionDeMacro {
  nombre: string
  valor: string | null
}

export interface OpcionIni {
  clave: string
  /** El valor, una entrada por línea, ya sin comentarios ni blancos de los bordes ni líneas vacías. */
  lineas: string[]
  /** Línea del archivo (desde 1) donde empieza. */
  linea: number
}

export interface IniParseado {
  /** En orden de aparición. Claves: `platformio`, `env`, `env:nombre`. */
  secciones: Map<string, Map<string, OpcionIni>>
}

export type ResultadoAuditoriaIni =
  | {
      ok: true
      advertencias: string[]
      /** Los `[env:nombre]`, en orden. */
      environments: string[]
      /** Por environment: las macros que `build_flags` y `build_src_flags` le pasan al compilador. */
      macros: Record<string, DefinicionDeMacro[]>
      /** Por environment: los `lib_deps` efectivos (los propios o, si no tiene, los de `[env]`), ya expandidos. */
      libDeps: Record<string, string[]>
    }
  | { ok: false; codigo: "INI_NO_ADMITIDO"; claves: string[]; rechazos: RechazoIni[] }

const TAMANO_MAXIMO = 256 * 1024
const NOMBRE_DE_ENTORNO = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/
const NOMBRE_DE_CLAVE = /^([a-z][a-z0-9_.]{0,63})[ \t]*=[ \t]*(.*)$/
// Lo que no puede aparecer en NINGÚN lado del archivo, ni en un comentario: controles
// (salvo tab, \n, \r) y los separadores de línea de Unicode.
const CONTROL_PROHIBIDO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029\ufeff\ufffd]/
const ASCII_IMPRIMIBLE = /^[\t\x20-\x7e]*$/

const rechazo = (seccion: string, clave: string, motivo: MotivoIni, detalle: string): RechazoIni => ({ seccion, clave, motivo, detalle })

/** Saca el comentario de una línea, con la regla de `configparser` restringida a blancos ASCII. */
function sinComentario(linea: string): string {
  const cuerpo = linea.replace(/^[ \t]+/, "")
  if (cuerpo.startsWith(";") || cuerpo.startsWith("#")) return ""
  for (let i = 1; i < linea.length; i++) {
    const c = linea[i]
    if ((c === ";" || c === "#") && (linea[i - 1] === " " || linea[i - 1] === "\t")) return linea.slice(0, i)
  }
  return linea
}

/**
 * Lee el texto de un `platformio.ini` con el subconjunto estricto descripto arriba. No
 * interpreta opciones ni expande nada: sólo dice qué secciones y qué claves hay.
 */
export function parsearIni(texto: string): { ok: true; ini: IniParseado } | { ok: false; rechazos: RechazoIni[] } {
  const rechazos: RechazoIni[] = []
  if (typeof texto !== "string") return { ok: false, rechazos: [rechazo("", "platformio.ini", "ARCHIVO_ILEGIBLE", "no es texto")] }
  if (texto.length > TAMANO_MAXIMO) return { ok: false, rechazos: [rechazo("", "platformio.ini", "ARCHIVO_DEMASIADO_GRANDE", `más de ${TAMANO_MAXIMO} caracteres`)] }
  if (CONTROL_PROHIBIDO.test(texto)) return { ok: false, rechazos: [rechazo("", "platformio.ini", "CARACTER_NO_ADMITIDO", "tiene caracteres de control, un BOM o bytes que no son UTF-8")] }

  const secciones = new Map<string, Map<string, OpcionIni>>()
  let seccion: string | null = null
  let actual: Map<string, OpcionIni> | null = null
  let opcion: OpcionIni | null = null
  const lineas = texto.split(/\r\n|\r|\n/)
  for (let n = 0; n < lineas.length; n++) {
    const cruda = lineas[n]!
    const limpia = sinComentario(cruda).replace(/[ \t]+$/, "")
    const donde = `línea ${n + 1}`
    if (!ASCII_IMPRIMIBLE.test(limpia)) {
      rechazos.push(rechazo(seccion ?? "", donde, "CARACTER_NO_ADMITIDO", "fuera de un comentario sólo se admite ASCII imprimible"))
      continue
    }
    if (limpia.includes("%")) {
      rechazos.push(rechazo(seccion ?? "", donde, "CARACTER_NO_ADMITIDO", "`%` (el lector de Python lo interpola)"))
      continue
    }
    if (limpia.trim() === "") continue
    if (/^[ \t]/.test(limpia)) {
      // Con sangría: una línea más del valor de la opción anterior.
      if (!opcion) {
        rechazos.push(rechazo(seccion ?? "", donde, "LINEA_NO_ENTENDIDA", "línea con sangría que no continúa ninguna opción"))
        continue
      }
      opcion.lineas.push(limpia.trim())
      continue
    }
    if (limpia.startsWith("[")) {
      opcion = null
      const cab = limpia.match(/^\[([^\[\]]+)\]$/)
      const nombre = cab?.[1] ?? ""
      const admitida = nombre === "platformio" || nombre === "env" || (nombre.startsWith("env:") && NOMBRE_DE_ENTORNO.test(nombre.slice(4)))
      if (!cab || !admitida) {
        // Se deja de leer adentro de una sección que no se admite: sus líneas no se atribuyen a la anterior.
        seccion = null
        actual = null
        rechazos.push(rechazo("", donde, "SECCION_NO_ADMITIDA", `sólo se admiten [platformio], [env] y [env:nombre]; hay ${JSON.stringify(limpia.slice(0, 60))}`))
        continue
      }
      if (secciones.has(nombre)) {
        seccion = null
        actual = null
        rechazos.push(rechazo(nombre, donde, "SECCION_REPETIDA", `la sección [${nombre}] aparece dos veces`))
        continue
      }
      seccion = nombre
      actual = new Map()
      secciones.set(nombre, actual)
      continue
    }
    const kv = limpia.match(NOMBRE_DE_CLAVE)
    if (!kv || !actual || seccion === null) {
      opcion = null
      // Si ya se rechazó la sección, sus líneas no suman un rechazo cada una.
      if (kv && !actual && rechazos.length > 0) continue
      rechazos.push(rechazo(seccion ?? "", donde, "LINEA_NO_ENTENDIDA", actual ? "no es `clave = valor` con la clave en minúsculas" : "hay una opción antes de la primera sección"))
      continue
    }
    const clave = kv[1]!
    if (actual.has(clave)) {
      opcion = null
      rechazos.push(rechazo(seccion, clave, "CLAVE_REPETIDA", `la opción aparece dos veces en [${seccion}]`))
      continue
    }
    opcion = { clave, lineas: kv[2]!.trim() === "" ? [] : [kv[2]!.trim()], linea: n + 1 }
    actual.set(clave, opcion)
  }
  return rechazos.length > 0 ? { ok: false, rechazos } : { ok: true, ini: { secciones } }
}

// ── Flags de compilación ─────────────────────────────────────────────────────────────────

const ALFABETO_DE_FLAGS = /^[A-Za-z0-9_=\- \t]*$/
const NOMBRE_DE_MACRO = /^[A-Z][A-Z0-9_]{0,62}$/
const VALOR_DE_MACRO = /^(?:0|[1-9][0-9]{0,9}|0[xX][0-9A-Fa-f]{1,8}|[A-Za-z_][A-Za-z0-9_]{0,31})$/

/**
 * ESPECIFICACIÓN de los flags de compilación admitidos (`build_flags`, `build_src_flags`).
 *
 * Entrada: las líneas del valor, YA expandidas. Cada línea es un elemento aparte: así
 * llegan a SCons (`piobuild.py:194-196`, un `ParseFlags` por elemento).
 *
 *   1. ALFABETO. El elemento entero sólo puede tener letras ASCII, dígitos, `_`, `=`, `-`,
 *      espacio y tab. Con eso quedan afuera, sin mirar más: `!` (SCons ejecuta el resto
 *      como comando), `@` (archivo de respuesta del compilador), `$` (variable de SCons o
 *      interpolación), comillas y `\` (que `shlex` interpreta y cambian dónde se corta),
 *      `;`, `,`, `/`, `.`, `+`, `:`, `(`, `)` y todo carácter no ASCII.
 *   2. CORTE. El elemento se parte por espacios y tabs. Sin comillas ni `\`, `shlex.split`
 *      hace exactamente lo mismo (`SCons/Environment.py:912`).
 *   3. FORMAS. Cada palabra tiene que ser una de:
 *        `-D` seguido, EN EL MISMO elemento, de una palabra DEF
 *        `-DDEF`
 *      Un `-D` al final del elemento se rechaza: SCons no lo completa con la línea que
 *      sigue (cada elemento se parsea aparte), y la palabra de la otra línea la toma como
 *      una librería a linkear (`Environment.py:942-943`).
 *   4. DEF = NOMBRE o NOMBRE=VALOR.
 *        NOMBRE: `[A-Z][A-Z0-9_]{0,62}` — identificador de C en mayúsculas, sin `_` inicial
 *        (los que empiezan con `_` son del compilador y de las librerías).
 *        VALOR, una de:
 *          entero decimal sin ceros a la izquierda, hasta 10 dígitos (`0`, `42`)
 *          hexadecimal `0x` + 1 a 8 dígitos
 *          identificador `[A-Za-z_][A-Za-z0-9_]{0,31}`
 *      Sin ceros a la izquierda y sin punto decimal A PROPÓSITO: PlatformIO convierte a
 *      número lo que parece número antes de pasarlo (`piobuild.py:207-211`), así que `010`
 *      llegaría como `10` (en C, `010` es 8) y `1.50` como `1.5`. Con esta gramática el
 *      texto del valor llega igual a como se escribió.
 *   5. Un NOMBRE repetido en el mismo valor se rechaza (cuál gana depende del compilador).
 *
 * QUÉ LLEGA AL COMPILADOR por cada DEF admitida: UNA opción `-DNOMBRE` o `-DNOMBRE=VALOR`.
 * Sostén: lectura de `ParseFlags` (`Environment.py:885-890` y `:983-987`: va a
 * `CPPDEFINES` y a ningún otro lado) y de `processDefines` (`SCons/Defaults.py:550`), más
 * el test opt-in `tests/carga-ini-pio.test.mjs` que compila de verdad. Es ANÁLISIS
 * ESTÁTICO + una medición sobre el toolchain instalado, no una prueba general.
 */
export function leerFlags(lineas: readonly string[]): { ok: true; definiciones: DefinicionDeMacro[] } | { ok: false; flag: string; detalle: string } {
  const definiciones: DefinicionDeMacro[] = []
  const vistos = new Set<string>()
  const def = (texto: string): string | null => {
    const corte = texto.indexOf("=")
    const nombre = corte < 0 ? texto : texto.slice(0, corte)
    const valor = corte < 0 ? null : texto.slice(corte + 1)
    if (!NOMBRE_DE_MACRO.test(nombre)) return "el nombre de la macro tiene que ser MAYÚSCULAS, dígitos y `_`, empezando por una letra"
    if (valor !== null && !VALOR_DE_MACRO.test(valor)) return "el valor tiene que ser un entero sin ceros a la izquierda, un hexadecimal `0x…` o un identificador"
    if (vistos.has(nombre)) return "la macro está definida dos veces"
    vistos.add(nombre)
    definiciones.push({ nombre, valor })
    return null
  }
  for (const linea of lineas) {
    if (typeof linea !== "string" || !ALFABETO_DE_FLAGS.test(linea)) return { ok: false, flag: String(linea).slice(0, 80), detalle: "tiene un carácter fuera de letras, dígitos, `_`, `=`, `-` y espacio" }
    const palabras = linea.split(/[ \t]+/).filter((p) => p !== "")
    for (let i = 0; i < palabras.length; i++) {
      const palabra = palabras[i]!
      if (!palabra.startsWith("-D")) return { ok: false, flag: palabra, detalle: "sólo se admite `-D NOMBRE` o `-D NOMBRE=valor`" }
      let cuerpo = palabra.slice(2)
      if (cuerpo === "") {
        const siguiente = palabras[++i]
        if (siguiente === undefined) return { ok: false, flag: palabra, detalle: "`-D` sin nombre en la misma línea" }
        cuerpo = siguiente
      }
      const problema = def(cuerpo)
      if (problema) return { ok: false, flag: palabra === "-D" ? `-D ${cuerpo}` : palabra, detalle: problema }
    }
  }
  return { ok: true, definiciones }
}

// ── La tabla ─────────────────────────────────────────────────────────────────────────────

type Validador = (lineas: readonly string[]) => string | null

interface Regla {
  /** Por qué está admitida y con qué valor. */
  porque: string
  valor: Validador
  /** Si falta, se admite en los dos modos. */
  carga?: "rechazar"
  /** Texto que se agrega a `advertencias` cuando la opción está presente. */
  advertencia?: string
  /** Admite `${env.<misma clave>}`. */
  interpola?: true
}

/** Una sola línea que cumple el patrón. */
const unaLinea = (re: RegExp, que: string): Validador => (lineas) => (lineas.length === 1 && re.test(lineas[0]!) ? null : `tiene que ser ${que}, en una sola línea`)
/**
 * Los elementos de una opción múltiple, como los corta PlatformIO (`config.py:67-81`): si el
 * valor tiene varias líneas, uno por línea; si tiene una sola, separados por coma y espacio.
 */
export const elementos = (lineas: readonly string[]): string[] => (lineas.length === 1 ? lineas[0]!.split(", ") : [...lineas])
/** Una lista en la que cada elemento cumple el patrón. */
const lista = (re: RegExp, que: string): Validador => (lineas) => {
  const items = elementos(lineas)
  if (items.length === 0) return `tiene que tener al menos ${que}`
  const malo = items.find((x) => !re.test(x))
  return malo === undefined ? null : `${JSON.stringify(malo.slice(0, 60))} no es ${que}`
}
const unoDe = (...valores: string[]): Validador => unaLinea(new RegExp(`^(?:${valores.join("|")})$`), valores.map((v) => `\`${v.replace(/\\/g, "")}\``).join(" o "))

/**
 * Las plataformas que se admiten. Una plataforma es código Python que PlatformIO baja del
 * registro y ejecuta al compilar (`<plataforma>/builder/main.py`): un nombre cualquiera es
 * ejecutar código de un tercero cualquiera. Son las dos del producto (`nucleo/placas.ts`).
 */
export const PLATAFORMAS_ADMITIDAS: readonly string[] = Object.freeze(["espressif32", "atmelavr"])

/** Los filtros del monitor que trae PlatformIO o la plataforma (`device/monitor/filters/`, `<plataforma>/monitor/`). */
export const FILTROS_DE_MONITOR: readonly string[] = Object.freeze([
  "default", "direct", "debug", "colorize", "nocontrol", "printable", "hexlify", "log2file", "send_on_enter", "time", "esp32_exception_decoder",
])

/** Un `lib_deps` del registro: `dueño/Nombre de la librería`, con versión opcional `@1.2.3`, `@^1.2.3` o `@~1.2.3`. */
export const LIB_DEP = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,62})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,62}(?: [A-Za-z0-9][A-Za-z0-9_.-]{0,62}){0,7})(?:@(\^|~)?(\d{1,5}(?:\.\d{1,5}){0,2}))?$/

const libDeps: Validador = (lineas) => {
  const malo = lineas.find((l) => !LIB_DEP.test(l))
  return malo === undefined ? null : `${JSON.stringify(malo.slice(0, 60))} no es \`dueño/librería\` del registro (ni URL, ni ruta, ni nombre suelto)`
}

const flags: Validador = (lineas) => {
  const r = leerFlags(lineas)
  return r.ok ? null : `${JSON.stringify(r.flag)}: ${r.detalle}`
}

const filtroDeFuentes: Validador = (lineas) => {
  const items = lineas.flatMap((l) => l.split(/[ \t]+/)).filter((x) => x !== "")
  if (items.length === 0) return "está vacío"
  const malo = items.find((x) => !/^[+-]<[A-Za-z0-9_*.\/-]{1,80}>$/.test(x) || x.includes("..") || /^[+-]<\//.test(x))
  return malo === undefined ? null : `${JSON.stringify(malo.slice(0, 60))} no es \`+<patrón>\` o \`-<patrón>\` dentro de src/`
}

const SI_O_NO = unoDe("yes", "no", "true", "false", "0", "1")

const REGLAS_PLATFORMIO: Readonly<Record<string, Regla>> = Object.freeze({
  default_envs: { porque: "elige qué environments corre `pio run` sin `-e`; sólo nombres", valor: lista(NOMBRE_DE_ENTORNO, "un nombre de environment") },
  name: { porque: "texto descriptivo; nadie lo ejecuta", valor: unaLinea(/^[A-Za-z0-9 _.,:()\/+-]{1,120}$/, "texto ASCII corto") },
  description: { porque: "texto descriptivo; nadie lo ejecuta", valor: unaLinea(/^[A-Za-z0-9 _.,:()\/+-]{1,120}$/, "texto ASCII corto") },
})

const REGLAS_ENV: Readonly<Record<string, Regla>> = Object.freeze({
  platform: {
    porque: "sólo las plataformas del producto, con versión exacta opcional",
    valor: (lineas) => (lineas.length === 1 && new RegExp(`^(?:${PLATAFORMAS_ADMITIDAS.join("|")})(?:@\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})?$`).test(lineas[0]!) ? null : `tiene que ser ${PLATAFORMAS_ADMITIDAS.join(" o ")}, con \`@x.y.z\` opcional`),
  },
  board: { porque: "identificador de placa de la plataforma (la carpeta `boards/` del proyecto se rechaza aparte)", valor: unaLinea(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, "un identificador de placa") },
  framework: { porque: "sólo arduino (otro framework baja y ejecuta otros paquetes)", valor: unoDe("arduino") },
  monitor_speed: { porque: "velocidad del monitor serie", valor: unaLinea(/^[1-9][0-9]{1,7}$/, "un número de baudios") },
  upload_speed: { porque: "velocidad de la carga; no cambia qué se escribe (R-01, medido)", valor: unaLinea(/^[1-9][0-9]{1,7}$/, "un número de baudios") },
  upload_port: { porque: "lo pisa `--upload-port` de la línea de comandos (R-01, medido); se exige forma de puerto serie", valor: (l) => (l.length === 1 && puertoValido(l[0]!) ? null : "tiene que ser un puerto serie (`COM5`, `/dev/ttyUSB0`), no una IP ni un nombre de red") },
  monitor_port: { porque: "puerto del monitor; se exige forma de puerto serie", valor: (l) => (l.length === 1 && puertoValido(l[0]!) ? null : "tiene que ser un puerto serie (`COM5`, `/dev/ttyUSB0`)") },
  monitor_eol: { porque: "fin de línea del monitor", valor: unoDe("CR", "LF", "CRLF") },
  monitor_parity: { porque: "paridad del monitor", valor: unoDe("N", "E", "O", "S", "M") },
  monitor_raw: { porque: "monitor sin filtros", valor: SI_O_NO },
  monitor_echo: { porque: "eco local del monitor", valor: SI_O_NO },
  monitor_rts: { porque: "línea RTS del monitor", valor: unoDe("0", "1") },
  monitor_dtr: { porque: "línea DTR del monitor", valor: unoDe("0", "1") },
  monitor_filters: { porque: "sólo los filtros que trae PlatformIO o la plataforma (uno propio es Python del proyecto)", valor: lista(new RegExp(`^(?:${FILTROS_DE_MONITOR.join("|")})$`), "un filtro de monitor de PlatformIO") },
  build_type: { porque: "sólo `release`, que es el valor por defecto", valor: unoDe("release") },
  lib_deps: { porque: "sólo librerías del registro, por `dueño/nombre`; lo que traen adentro lo audita `carga/librerias.ts`", valor: libDeps, interpola: true },
  lib_ignore: { porque: "saca librerías del build; sólo nombres", valor: (lineas) => (lineas.length > 0 && lineas.every((l) => /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/.test(l)) ? null : "tiene que ser una lista de nombres de librería, uno por línea") },
  lib_ldf_mode: { porque: "modo del buscador de dependencias", valor: unoDe("off", "chain", "deep", "chain\\+", "deep\\+") },
  lib_compat_mode: { porque: "modo de compatibilidad de librerías", valor: unoDe("off", "soft", "strict") },
  lib_archive: { porque: "si las librerías se archivan antes de linkear", valor: SI_O_NO },
  build_flags: { porque: "sólo definiciones de macro `-D` con la gramática cerrada de `leerFlags`", valor: flags, interpola: true },
  build_src_flags: { porque: "igual que `build_flags`, sólo para `src/`", valor: flags, interpola: true },
  build_src_filter: {
    porque: "cambia qué archivos de `src/` se compilan: no ejecuta nada, pero el análisis de pines deja de ser completo",
    valor: filtroDeFuentes,
    carga: "rechazar",
    advertencia: "`build_src_filter` cambia qué fuentes se compilan: con eso no se puede cargar (el análisis de pines no sabe qué entra al firmware).",
  },
})

/** Lo que se sabe POR QUÉ se rechaza. Lo que no está acá ni en las reglas también se rechaza: "no está en la tabla". */
const RECHAZOS_CONOCIDOS: ReadonlyArray<[RegExp, string]> = [
  [/^extra_scripts?$/, "ejecuta Python del proyecto en cada `pio run`, también con `nobuild` (medido, R-01 c3 y H-03)"],
  [/^targets$/, "hace que un `pio run` sin `-t` corra esos targets: con `upload`, carga sin pasar por el gate"],
  [/^upload_command$/, "reemplaza el comando de carga entero (medido, R-01)"],
  [/^upload_flags$/, "se antepone al comando de carga (medido, R-01)"],
  [/^upload_protocol$/, "cambia la herramienta de carga; en espressif32, con sólo definirlo PlatformIO baja e instala otro paquete (medido, R-01)"],
  [/^upload_resetmethod$/, "cambia cómo se reinicia la placa para cargar; sin evidencia de que sea inocuo"],
  [/^platform_packages$/, "reemplaza paquetes de la plataforma (compilador, framework, cargador) por otros"],
  [/^extends$/, "hereda de otras secciones: indirección que esta auditoría no sigue"],
  [/^extra_configs$/, "suma otros archivos de configuración: esta auditoría lee uno solo"],
  [/^lib_extra_dirs$/, "suma carpetas de librerías de fuera del proyecto"],
  [/^src_filter$/, "nombre viejo de `build_src_filter`: cambia qué fuentes se compilan"],
  [/^(?:build_unflags|src_build_flags|debug_build_flags)$/, "va al mismo analizador de flags que ejecuta lo que empieza con `!`; no tiene prueba positiva que lo respalde"],
  [/^board_build\./, "cambia el binario o el comando de carga (`mcu`, `f_flash`, `flash_mode`: medido en R-01); ninguna está admitida"],
  [/^board_upload\./, "cambia qué, dónde o cómo se graba (medido, R-01)"],
  [/^board_/, "pisa datos de la placa"],
  [/^custom_/, "opción propia: sólo sirve si algo la consume, y lo que la consume es un script"],
  [/^debug_/, "opciones de depuración: lanzan servidores y comandos"],
  [/^test_/, "opciones de `pio test`: pueden correr un comando"],
  [/^check_/, "opciones de `pio check`"],
  [/^(?:core|globallib|platforms|packages|cache|build_cache|workspace|build|libdeps|include|src|lib|data|test|boards|monitor|shared)_dir$/, "redirige de dónde salen las fuentes, el artefacto, la plataforma o los paquetes"],
]

const motivoDeRechazo = (clave: string) => RECHAZOS_CONOCIDOS.find(([re]) => re.test(clave))?.[1] ?? "no está en la tabla de opciones admitidas"

const INTERPOLACION_DE_ENV = /\$\{env\.([a-z][a-z0-9_.]{0,63})\}/g

/**
 * Expande `${env.K}` dentro de la opción `K`. Devuelve las líneas resultantes (el valor
 * de `[env]` entra línea por línea, como lo arma PlatformIO con `"\n".join`) o el motivo.
 * En `[env]` mismo ningún `$` pasa: `${env.K}` ahí se refiere a sí misma, y un valor de
 * `[env]` con `$` no se expande (regla de abajo), así que tampoco hay cadenas.
 */
function expandir(ini: IniParseado, opcion: OpcionIni, admite: boolean): { ok: true; lineas: string[] } | { ok: false; detalle: string } {
  if (!opcion.lineas.some((l) => l.includes("$"))) return { ok: true, lineas: opcion.lineas }
  if (opcion.lineas.some((l) => /\$\{\s*sysenv\./.test(l))) return { ok: false, detalle: "`${sysenv.…}` mete en la configuración una variable de entorno de la compu" }
  if (!admite) return { ok: false, detalle: "esta opción no admite `${…}`" }
  const base = ini.secciones.get("env")?.get(opcion.clave)
  const salida: string[] = []
  for (const linea of opcion.lineas) {
    let expandida = ""
    let desde = 0
    for (const m of linea.matchAll(INTERPOLACION_DE_ENV)) {
      const clave = m[1]!
      if (clave !== opcion.clave) return { ok: false, detalle: `sólo se admite \`\${env.${opcion.clave}}\` dentro de \`${opcion.clave}\`` }
      if (!base) return { ok: false, detalle: `\`\${env.${clave}}\` no está definido en [env]` }
      if (base.lineas.some((l) => l.includes("$"))) return { ok: false, detalle: "el valor de [env] tiene a su vez un `$`" }
      expandida += linea.slice(desde, m.index) + base.lineas.join("\n")
      desde = m.index + m[0].length
    }
    expandida += linea.slice(desde)
    if (expandida.includes("$")) return { ok: false, detalle: "queda un `$` que no es `${env.<esta misma opción>}`" }
    for (const parte of expandida.split("\n")) if (parte.trim() !== "") salida.push(parte.trim())
  }
  return { ok: true, lineas: salida }
}

/**
 * Audita el TEXTO de un `platformio.ini`. Pura: no toca el disco. `auditarIni` le suma lo
 * que sólo se puede ver en la carpeta (`boards/`, `monitor/`, rutas que pisan un `lib_deps`).
 */
export function auditarTextoIni(texto: string, modo: ModoDeAuditoria): ResultadoAuditoriaIni {
  if (modo !== "compilacion" && modo !== "carga") return fallo([rechazo("", "modo", "MODO_NO_ADMITIDO", "el modo tiene que ser `compilacion` o `carga`")])
  const leido = parsearIni(texto)
  if (!leido.ok) return fallo(leido.rechazos)
  const { ini } = leido
  const rechazos: RechazoIni[] = []
  const advertencias: string[] = []
  const expandidas = new Map<string, string[]>()
  for (const [seccion, opciones] of ini.secciones) {
    const reglas = seccion === "platformio" ? REGLAS_PLATFORMIO : REGLAS_ENV
    for (const opcion of opciones.values()) {
      const regla = Object.hasOwn(reglas, opcion.clave) ? reglas[opcion.clave] : undefined
      if (!regla) {
        rechazos.push(rechazo(seccion, opcion.clave, "OPCION_NO_ADMITIDA", motivoDeRechazo(opcion.clave)))
        continue
      }
      if (regla.carga === "rechazar" && modo === "carga") {
        rechazos.push(rechazo(seccion, opcion.clave, "OPCION_NO_ADMITIDA", `no se admite para cargar: ${regla.porque}`))
        continue
      }
      const exp = expandir(ini, opcion, regla.interpola === true)
      if (!exp.ok) {
        rechazos.push(rechazo(seccion, opcion.clave, "INTERPOLACION_NO_ADMITIDA", exp.detalle))
        continue
      }
      const problema = regla.valor(exp.lineas)
      if (problema) {
        rechazos.push(rechazo(seccion, opcion.clave, regla.valor === flags ? "FLAG_NO_ADMITIDO" : "VALOR_NO_ADMITIDO", problema))
        continue
      }
      expandidas.set(`${seccion}\u0000${opcion.clave}`, exp.lineas)
      if (regla.advertencia && !advertencias.includes(regla.advertencia)) advertencias.push(regla.advertencia)
    }
  }
  if (rechazos.length > 0) return fallo(rechazos)
  const environments = [...ini.secciones.keys()].filter((s) => s.startsWith("env:")).map((s) => s.slice(4))
  // Lo efectivo de un environment: lo suyo o, si no lo define, lo de [env] (`config.py:170-185`).
  const efectivo = (env: string, clave: string) => expandidas.get(`env:${env}\u0000${clave}`) ?? expandidas.get(`env\u0000${clave}`) ?? []
  const macros: Record<string, DefinicionDeMacro[]> = {}
  const libs: Record<string, string[]> = {}
  for (const env of environments) {
    const todas: DefinicionDeMacro[] = []
    for (const clave of ["build_flags", "build_src_flags"]) {
      const r = leerFlags(efectivo(env, clave))
      if (r.ok) todas.push(...r.definiciones)
    }
    macros[env] = todas
    libs[env] = [...efectivo(env, "lib_deps")]
  }
  return { ok: true, advertencias, environments, macros, libDeps: libs }
}

function fallo(rechazos: RechazoIni[]): ResultadoAuditoriaIni {
  const claves = [...new Set(rechazos.map((r) => (r.seccion ? `[${r.seccion}] ${r.clave}` : r.clave)))]
  return { ok: false, codigo: "INI_NO_ADMITIDO", claves, rechazos }
}

/** `lstat` que no tira: `null` si no existe o no se puede mirar. */
function mirar(ruta: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(ruta)
  } catch {
    return null
  }
}

/**
 * Carpetas del proyecto que PlatformIO usa SIN que el ini las nombre y que cambian qué se
 * ejecuta o qué se graba. Si existen, se rechaza:
 *   - `boards/`: un `boards/<placa>.json` del proyecto gana sobre el de la plataforma y
 *     cambia velocidad, offset y flags (`build.extra_flags` va al mismo analizador de
 *     flags). Medido en R-01, caso c5.
 *   - `monitor/`: PlatformIO importa cada `filter_*.py` de ahí al abrir el monitor
 *     (`device/monitor/filters/base.py:58-97`). Leído en el código, no ejercitado.
 */
export const CARPETAS_IMPLICITAS_PROHIBIDAS: readonly string[] = Object.freeze(["boards", "monitor"])

/**
 * Audita el `platformio.ini` de `cwd`. Precondición de TODO `pio run` sobre una carpeta de
 * usuario (`compilacion`) y paso del gate antes de cargar (`carga`).
 *
 * Además del texto, mira en la carpeta: que el ini sea un archivo regular (no un enlace),
 * que no existan las carpetas implícitas prohibidas, y que ningún `lib_deps` coincida con
 * una ruta que existe en el proyecto (PlatformIO, si la ruta existe, la toma como una
 * librería LOCAL en vez de buscarla en el registro: `package/meta.py:336-343`).
 *
 * `cwd` tiene que venir ya canónico (`realpathSync`): acá no se resuelve nada.
 */
export function auditarIni(cwd: string, modo: ModoDeAuditoria): ResultadoAuditoriaIni {
  const ruta = join(cwd, "platformio.ini")
  const st = mirar(ruta)
  if (!st) return fallo([rechazo("", "platformio.ini", "ARCHIVO_AUSENTE", "no hay platformio.ini en la carpeta del proyecto")])
  if (!st.isFile()) return fallo([rechazo("", "platformio.ini", "ARCHIVO_NO_REGULAR", "platformio.ini no es un archivo común (es un enlace, una carpeta u otra cosa)")])
  if (st.size > TAMANO_MAXIMO) return fallo([rechazo("", "platformio.ini", "ARCHIVO_DEMASIADO_GRANDE", `más de ${TAMANO_MAXIMO} bytes`)])
  let texto: string
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(ruta))
  } catch {
    return fallo([rechazo("", "platformio.ini", "ARCHIVO_ILEGIBLE", "no se pudo leer como UTF-8")])
  }
  const r = auditarTextoIni(texto, modo)
  const rechazos: RechazoIni[] = r.ok ? [] : [...r.rechazos]
  for (const carpeta of CARPETAS_IMPLICITAS_PROHIBIDAS) {
    if (mirar(join(cwd, carpeta))) rechazos.push(rechazo("", `${carpeta}/`, "CARPETA_NO_ADMITIDA", `el proyecto tiene \`${carpeta}/\`: PlatformIO la usa sin que el ini la nombre`))
  }
  if (r.ok) {
    for (const [env, deps] of Object.entries(r.libDeps)) {
      for (const dep of deps) {
        const sinVersion = dep.replace(/@[^@]*$/, "")
        if (mirar(join(cwd, dep)) || mirar(join(cwd, sinVersion))) rechazos.push(rechazo(`env:${env}`, "lib_deps", "VALOR_NO_ADMITIDO", `\`${sinVersion}\` existe como ruta en el proyecto: PlatformIO la tomaría como librería local`))
      }
    }
  }
  return rechazos.length > 0 ? fallo(rechazos) : r
}

/**
 * El environment que se va a cargar: EXACTAMENTE uno, o falla (CONTRATOS-API §4, H-M4).
 * Sin `-e`, `pio run` procesa todos los `default_envs` o todos los `[env:x]`: cargar "el
 * que salga" es cargar en una placa un firmware que nadie eligió.
 */
export function entornosDeCarga(iniText: string, pedido?: string): { ok: true; environment: string } | { ok: false; codigo: "VARIOS_ENVIRONMENTS"; disponibles: string[] } {
  const leido = parsearIni(iniText)
  if (!leido.ok) return { ok: false, codigo: "VARIOS_ENVIRONMENTS", disponibles: [] }
  const disponibles = [...leido.ini.secciones.keys()].filter((s) => s.startsWith("env:")).map((s) => s.slice(4))
  const falla = { ok: false as const, codigo: "VARIOS_ENVIRONMENTS" as const, disponibles }
  if (pedido !== undefined) return disponibles.includes(pedido) ? { ok: true, environment: pedido } : falla
  const porDefecto = elementos(leido.ini.secciones.get("platformio")?.get("default_envs")?.lineas ?? [])
  if (porDefecto.length > 0) return porDefecto.length === 1 && disponibles.includes(porDefecto[0]!) ? { ok: true, environment: porDefecto[0]! } : falla
  return disponibles.length === 1 ? { ok: true, environment: disponibles[0]! } : falla
}

/**
 * La tabla, para el informe y para los tests: cada opción admitida con su porqué y cada
 * familia rechazada con el suyo. Lo que no figura se rechaza igual.
 */
export function tablaDeOpciones(): { admitidas: Array<{ seccion: "platformio" | "env"; clave: string; porque: string; soloCompilacion: boolean }>; rechazadas: Array<{ patron: string; porque: string }> } {
  const fila = (seccion: "platformio" | "env", reglas: Readonly<Record<string, Regla>>) =>
    Object.entries(reglas).map(([clave, r]) => ({ seccion, clave, porque: r.porque, soloCompilacion: r.carga === "rechazar" }))
  return { admitidas: [...fila("platformio", REGLAS_PLATFORMIO), ...fila("env", REGLAS_ENV)], rechazadas: RECHAZOS_CONOCIDOS.map(([re, porque]) => ({ patron: re.source, porque })) }
}
