/** @jsxImportSource @opentui/solid */
// ============================================================================
// Tecnia Bot — plugin de TUI que reemplaza el logo del splash de OpenCode
// por la identidad de marca (el robot del ícono + wordmark "TECNIA BOT"), y pone
// en castellano los ejemplos del cuadro de texto.
//
// Se declara en ~/.config/opencode/tui.json ("plugin": ["./plugins/tecnia-logo.tsx"]).
// Bun transpila este .tsx en runtime: NO hay que compilar ni empaquetar nada.
// Los `import type` se borran al transpilar; los tipos los resuelve el
// @opencode-ai/plugin que OpenCode auto-instala a la version del binario, asi
// que matchean la version que corre el docente.
//
// Defensivo: los colores se leen del theme activo (api.theme.current) con
// fallback al violeta de marca, para no romper si un campo cambia entre versiones.
// ============================================================================
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA, TextAttributes } from "@opentui/core"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"

// ----------------------------------------------------------------------------
// EL LOGO SE DIBUJA CON PÍXELES, Y SÓLO CON CARACTERES QUE CUALQUIER CONSOLA TIENE
//
// Por qué: en una notebook real con Windows 10 el robot anterior salía hecho de
// signos de pregunta. Estaba dibujado con box-drawing de trazo grueso (┏━┓┃┗┛┻╻)
// y la viñeta del tip era ●. Ninguno de esos existe en las tablas OEM de Windows
// (CP437/CP850), y esa consola mostraba «?» por cada uno. El wordmark, hecho con
// █, salía perfecto: █ sí está en las dos tablas. El comentario viejo afirmaba que
// los caracteres estaban en Consolas; nadie lo había mirado en la consola real.
//
// La regla ahora: fuera de los comentarios, este archivo sólo usa caracteres que
// están en CP437 Y en CP850. La lista y el guardián viven en
// tests/estetica-tui.test.mjs.
//
// NO VERIFICADO: por qué esa consola convierte a la tabla OEM (la hipótesis es una
// fuente de mapa de bits). El dibujo nuevo no depende de la respuesta: con estos
// caracteres sale bien en los dos casos.
//
// Cada celda de la terminal son dos píxeles, uno arriba del otro: ▀ pinta el de
// arriba, ▄ el de abajo, █ los dos. Con color de frente y de fondo, una celda
// puede llevar dos colores. Así el logo es el ícono del escritorio (la baldosa
// violeta con su degradé, el robot blanco, la antena dorada) y no un dibujo de
// palitos.
// ----------------------------------------------------------------------------

// Tintas: V baldosa · H cabeza · E ojos · M boca · G antena · T «TECNIA» · B «BOT»
// · . vacío. Es el ícono del escritorio (installer/branding/icono.svg) llevado a
// 14x14 píxeles: la baldosa violeta redondeada con el robot adentro.
const ROBOT_PX = [
  "..VVVVVVVVVV..",
  ".VVVVVGGVVVVV.",
  "VVVVVVGGVVVVVV",
  "VVVVVVHHVVVVVV",
  "VVVHHHHHHHHVVV",
  "VVHHHHHHHHHHVV",
  "VVHHEEHHEEHHVV",
  "VVHHEEHHEEHHVV",
  "VVHHHHHHHHHHVV",
  "VVHHHMMMMHHHVV",
  "VVVHHHHHHHHVVV",
  "VVVVVVVVVVVVVV",
  ".VVVVVVVVVVVV.",
  "..VVVVVVVVVV..",
]

// Letras de 6 píxeles de alto (3 renglones), de trazo grueso: los palos miden dos
// columnas. Con palos de una sola columna el wordmark quedaba flaco al lado del
// robot.
const LETRAS: Record<string, string[]> = {
  T: ["######", "..##..", "..##..", "..##..", "..##..", "..##.."],
  E: ["######", "##....", "#####.", "##....", "##....", "######"],
  C: [".#####", "##....", "##....", "##....", "##....", ".#####"],
  N: ["##...##", "###..##", "####.##", "##.####", "##..###", "##...##"],
  I: ["##", "##", "##", "##", "##", "##"],
  A: [".####.", "##..##", "##..##", "######", "##..##", "##..##"],
  B: ["#####.", "##..##", "#####.", "##..##", "##..##", "#####."],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
}

// Arma el mapa de píxeles de «TECNIA BOT»: cada palabra con su tinta.
function wordmarkPx(): string[] {
  const filas = ["", "", "", "", "", ""]
  const palabras: Array<[string, string]> = [
    ["TECNIA", "T"],
    ["BOT", "B"],
  ]
  palabras.forEach(([palabra, tinta], p) => {
    if (p > 0) for (let f = 0; f < 6; f++) filas[f] += "...."
    palabra.split("").forEach((letra, i) => {
      const forma = LETRAS[letra] ?? []
      for (let f = 0; f < 6; f++) {
        filas[f] += (i > 0 ? ".." : "") + (forma[f] ?? "").replace(/#/g, tinta)
      }
    })
  })
  return filas
}

type Tramo = { texto: string; fg?: RGBA; bg?: RGBA }

// Convierte un mapa de píxeles en renglones de tramos del mismo color. Dos filas
// de píxeles hacen un renglón de terminal.
function pintar(mapa: string[], tinta: (c: string, fila: number) => RGBA | undefined): Tramo[][] {
  const renglones: Tramo[][] = []
  for (let f = 0; f < mapa.length; f += 2) {
    const arriba = mapa[f] ?? ""
    const abajo = mapa[f + 1] ?? ""
    const tramos: Tramo[] = []
    const ancho = Math.max(arriba.length, abajo.length)
    for (let x = 0; x < ancho; x++) {
      const a = arriba[x] ?? "."
      const b = abajo[x] ?? "."
      let celda: Tramo
      if (a === "." && b === ".") celda = { texto: " " }
      else if (b === ".") celda = { texto: "▀", fg: tinta(a, f) }
      else if (a === ".") celda = { texto: "▄", fg: tinta(b, f + 1) }
      else if (tinta(a, f) === tinta(b, f + 1)) celda = { texto: "█", fg: tinta(a, f) }
      else celda = { texto: "▀", fg: tinta(a, f), bg: tinta(b, f + 1) }
      const ultimo = tramos[tramos.length - 1]
      if (ultimo && ultimo.fg === celda.fg && ultimo.bg === celda.bg) ultimo.texto += celda.texto
      else tramos.push(celda)
    }
    renglones.push(tramos)
  }
  return renglones
}

const FALLBACK_VIOLET = RGBA.fromInts(167, 139, 250) // #a78bfa
const FALLBACK_VIOLET_DEEP = RGBA.fromInts(139, 92, 246) // #8b5cf6
const FALLBACK_GOLD = RGBA.fromInts(255, 194, 36) // #ffc224
const FALLBACK_CLARO = RGBA.fromInts(236, 231, 245) // #ece7f5

// Ejemplos que rotan en el cuadro de texto vacío. Cosas que el bot sabe hacer hoy.
const EJEMPLOS = [
  "¿Cómo prendo un LED con Arduino?",
  "Armame el circuito de un semáforo",
  "¿Para qué sirve una resistencia?",
  "Quiero medir la temperatura con un DHT11",
]

// Los colores del ícono no salen del theme: son la marca, y tienen que ser los
// mismos con tema oscuro o claro (igual que el .ico del escritorio).
const MARCA_BLANCO = RGBA.fromInts(255, 255, 255)
const MARCA_VIOLETA_ARRIBA = [139, 92, 246] // #8b5cf6
const MARCA_VIOLETA_ABAJO_RGB = [109, 40, 217] // #6d28d9
const MARCA_VIOLETA_ABAJO = RGBA.fromInts(109, 40, 217)
const MARCA_BOCA = RGBA.fromInts(139, 92, 246) // #8b5cf6
const FILAS_ROBOT = ROBOT_PX.length
const DEGRADE: RGBA[] = Array.from({ length: FILAS_ROBOT }, (_, i) => {
  const k = i / (FILAS_ROBOT - 1)
  const mezcla = (j: number) =>
    Math.round((MARCA_VIOLETA_ARRIBA[j] ?? 0) + ((MARCA_VIOLETA_ABAJO_RGB[j] ?? 0) - (MARCA_VIOLETA_ARRIBA[j] ?? 0)) * k)
  return RGBA.fromInts(mezcla(0), mezcla(1), mezcla(2))
})

const LEMA = "Arduino y ESP32 para la escuela técnica"

// Tips propios de Tecnia Bot: en español, pensados para un docente que recién
// arranca. Reemplazan al tip por defecto de OpenCode ("Run /connect...") que
// confunde: aparece SIEMPRE porque el modelo gratis de OpenCode Zen cuenta como
// "sin proveedor", y le pide al docente conectar algo que ya viene listo.
const TIPS: string[] = [
  'Escribí "hola" y dejate guiar paso a paso',
  'Probá: "¿cómo prendo un LED con Arduino?"',
  'Pedí "armame el circuito de riego" y te lo dibuja',
  'Escribí "mostrame cómo funciona el protoboard"',
  'Escribí /ayuda para abrir el manual con ejemplos',
  'Escribí /diagnostico para revisar que todo esté listo',
  'Escribí /actualizar para traer la última versión',
]

// La key compartida que traian install.ps1/install.sh hasta la v0.3.75 (ver
// CHANGELOG [0.3.36] por la decision original) se elimino del codigo y se roto:
// en las maquinas que la tienen guardada es una credencial MUERTA. Se la reconoce
// por su SHA-256 -- el literal no vuelve a este repo, y un test lo verifica.
const HASH_KEY_VIEJA = "121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"

type EstadoKey = "sin-key" | "fallback" | "propia"

// Lee ~/.local/share/opencode/auth.json (respeta XDG_DATA_HOME, igual que
// install.sh) para saber si hay una key de Google propia, la compartida vieja
// (muerta), o ninguna. Sincrono y defensivo: si algo falla, se asume "sin-key",
// que es el estado que no rompe nada (el agente corre en Big Pickle).
function estadoDeLaKey(): EstadoKey {
  try {
    const dataDir = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
    const authFile = join(dataDir, "opencode", "auth.json")
    if (!existsSync(authFile)) return "sin-key"
    const data = JSON.parse(readFileSync(authFile, "utf8")) as { google?: { key?: string } }
    const key = data?.google?.key
    if (!key) return "sin-key"
    const hash = createHash("sha256").update(String(key), "utf8").digest("hex")
    return hash === HASH_KEY_VIEJA ? "fallback" : "propia"
  } catch {
    return "sin-key"
  }
}

function pick(api: TuiPluginApi, key: string, fallback: RGBA): RGBA {
  // TuiThemeCurrent trae campos no-RGBA (p. ej. thinkingOpacity: number), por eso
  // el cast pasa primero por unknown: es un lookup defensivo por clave, no una
  // promesa de que TODO el theme sea RGBA.
  const c = api.theme?.current as unknown as Record<string, RGBA> | undefined
  return (c && c[key]) || fallback
}

const REPO = "programadores-obreros/Agente-editor-inet"

// Versión instalada, leída del manifest que dejó el instalador.
function versionInstalada(): string | null {
  try {
    const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
    const m = join(cfg, "opencode", "tecnia-bot.manifest")
    if (!existsSync(m)) return null
    return readFileSync(m, "utf8").match(/^version=(.*)$/m)?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

// true si `b` es más nueva que `a` (compara X.Y.Z numéricamente).
function esMasNueva(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}

// Chequeo suave de versión, hecho UNA vez al cargar el plugin (la función `tui`
// es async, se espera al iniciar). Sin reactividad de solid-js (que NO resuelve
// en un plugin externo): se calcula acá y se pasa como prop simple.
// Timeout de 1.5s para no colgar el arranque si no hay internet.
async function hayVersionNueva(): Promise<string | null> {
  try {
    const inst = versionInstalada()
    if (!inst) return null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/VERSION`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const ult = (await res.text()).trim()
    return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(ult) && esMasNueva(inst, ult) ? ult : null
  } catch {
    return null // sin internet / timeout: no avisamos nada
  }
}

function Pixeles(props: { renglones: Tramo[][] }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      {props.renglones.map((tramos) => (
        <box flexDirection="row" flexShrink={0}>
          {tramos.map((t) => (
            <text fg={t.fg} bg={t.bg} selectable={false}>
              {t.texto}
            </text>
          ))}
        </box>
      ))}
    </box>
  )
}

function Art(props: { api: TuiPluginApi; nueva: string | null; version: string | null }) {
  const api = props.api
  const cabeza = pick(api, "text", FALLBACK_CLARO)
  const violeta = pick(api, "primary", FALLBACK_VIOLET)
  const colores: Record<string, RGBA> = {
    H: MARCA_BLANCO,
    E: MARCA_VIOLETA_ABAJO,
    M: MARCA_BOCA,
    G: FALLBACK_GOLD,
    T: cabeza,
    B: violeta,
  }
  // La baldosa lleva el degradé del ícono: un violeta por fila de píxeles.
  const tinta = (c: string, fila: number) => (c === "V" ? DEGRADE[fila] : colores[c])
  const apagado = pick(api, "textMuted", FALLBACK_VIOLET)
  // La versión va SIEMPRE presente bajo la marca: ayuda al docente y al soporte
  // ("¿qué versión tenés?" se ve de una). Fallback a la firma sola si no se pudo leer.
  const firma = props.version
    ? `un proyecto de Tecnia Lab · tecnialab.net.ar · v${props.version}`
    : "un proyecto de Tecnia Lab · tecnialab.net.ar"
  // Ícono y wordmark van lado a lado, como un logo horizontal: ocupan 7 renglones
  // en vez de los 11 del logo anterior, y eso es lo que le deja lugar al aviso de
  // abajo (en una ventana de 26 renglones el aviso de la key salía cortado).
  // Lado a lado mide 87 columnas: en una ventana más angosta que eso se apilan.
  // El ancho se mira una sola vez, al cargar (acá no hay reactividad de solid-js).
  let ancho = 120
  try {
    ancho = api.renderer?.width ?? 120
  } catch {
    // sin drama: se asume una ventana normal
  }
  const apilado = ancho < 94
  return (
    <box flexDirection="column" alignItems="center">
      <box flexDirection={apilado ? "column" : "row"} alignItems={apilado ? "center" : "flex-start"} flexShrink={0}>
        <Pixeles renglones={pintar(ROBOT_PX, tinta)} />
        <box width={4} flexShrink={0} />
        <box flexDirection="column" alignItems={apilado ? "center" : "flex-start"} flexShrink={0}>
          <box height={1} />
          <Pixeles renglones={pintar(wordmarkPx(), tinta)} />
          <box height={1} />
          <text fg={apagado} selectable={false}>
            {LEMA}
          </text>
        </box>
      </box>
      <box height={1} />
      <text fg={apagado} selectable={false}>
        {firma}
      </text>
      {props.nueva ? (
        <text fg={pick(api, "warning", FALLBACK_GOLD)} attributes={TextAttributes.BOLD} selectable={false}>
          {`Hay una versión nueva (v${props.nueva}) · escribí /actualizar`}
        </text>
      ) : null}
    </box>
  )
}

// Un solo tip propio (elegido al azar al cargar, o el aviso de la key si
// corresponde). La viñeta es ■ y no ●: ● no está en las tablas OEM de Windows
// y en la consola de una notebook real salía «?».
function TipLine(props: { api: TuiPluginApi; tip: string; label?: string }) {
  const api = props.api
  return (
    <box width="100%" maxWidth={75} paddingTop={1}>
      <text wrapMode="word" fg={pick(api, "textMuted", FALLBACK_VIOLET)} selectable={false}>
        <span style={{ fg: pick(api, "warning", FALLBACK_GOLD), bold: true }}>{`■ ${props.label ?? "Tip"}  `}</span>
        {props.tip}
      </text>
    </box>
  )
}

// ----------------------------------------------------------------------------
// LIMITACIÓN CONOCIDA: no se puede traducir el diálogo de permisos ni /help.
//
// LA SALIDA QUE SÍ HAY (0.4.8): el tool platformio usa ese mismo diálogo como el
// cartel del checklist de seguridad. La PREGUNTA sí es nuestra (va en español,
// empieza con PREGUNTA_CHECKLIST); los botones siguen en inglés. Para que el
// docente sepa qué apretar, la leyenda de abajo se muestra en el slot
// `app_bottom` —que queda justo debajo del cartel; probado en la VM con 1.18.18—
// solo mientras haya un permiso pendiente que empiece con esa pregunta.
//
// El truco de más abajo (`plugins.deactivate("internal:home-tips")` + slots
// `home_logo`/`home_bottom`) funciona porque OpenCode expone esos dos ganchos
// A PROPÓSITO para branding de la pantalla de inicio. NO generaliza: la lista
// completa de slots (`TuiHostSlotMap`) no incluye nada para el diálogo de
// permisos ("Allow once / Allow always / Reject") ni para la salida de /help,
// que están hardcodeados en el core/binario y se renderizan con el subsistema
// nativo de diálogos (`ui.dialog` / `AlertConfirm`), sin extension points.
//
// El único hook relacionado con permisos es `permission.ask`, y solo permite
// cambiar la decisión (`ask`/`deny`/`allow`), no el texto mostrado.
//
// Ya se investigó y quedó en claro que no hay approach vía plugin API: hay un
// patrón consistente de rechazo upstream a i18n nativo (3 issues cerrados
// `not_planned`: opencode#32514, #21084, #15800). Ver el hallazgo completo en
// programadores-obreros/Agente-editor-inet#1. Antes de reintentar esto, leer
// ese hilo para no reinvestigar lo mismo.
// ----------------------------------------------------------------------------

// El mismo prefijo que `PREGUNTA_CHECKLIST` de opencode/tool/platformio.ts (los
// plugins y las tools no se importan entre sí: un test compara los dos textos).
const PREGUNTA_CHECKLIST = "¿Revisaste el circuito?"
// Igual que `MARCA_SIEMPRE_PREGUNTA` del tool: la pregunta termina asi cuando
// "Allow always" no se puede guardar (analisis incompleto, placa sin identificar).
const MARCA_SIEMPRE_PREGUNTA = " · se pregunta cada vez"
const LEYENDA_CHECKLIST =
  "Checklist: Allow once = Sí, lo revisé, cargá · Reject = Todavía no, no cargues · Allow always = no volver a preguntar por este cambio en esta placa"
const LEYENDA_SIEMPRE =
  "Checklist: Allow once = Sí, lo revisé, cargá · Reject = Todavía no, no cargues · Allow always = igual vuelve a preguntar la próxima vez"

// ¿Hay un cartel del checklist abierto en la sesión que se está viendo? Devuelve
// la leyenda que corresponde, o null. Defensivo: cualquier cambio de API entre
// versiones da "no hay", nunca un error.
function leyendaDelCartel(api: TuiPluginApi): string | null {
  try {
    const ruta = (api as unknown as { route?: { current?: { name?: string; params?: { sessionID?: string } } } }).route?.current
    if (ruta?.name !== "session" || !ruta.params?.sessionID) return null
    const estado = (api as unknown as { state?: { session?: { permission?: (id: string) => Array<{ permission?: string }> } } }).state
    const pendientes = estado?.session?.permission?.(ruta.params.sessionID) ?? []
    const cartel = pendientes.find((p) => typeof p?.permission === "string" && p.permission.startsWith(PREGUNTA_CHECKLIST))
    if (!cartel?.permission) return null
    return cartel.permission.endsWith(MARCA_SIEMPRE_PREGUNTA) ? LEYENDA_SIEMPRE : LEYENDA_CHECKLIST
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// EL VIGILANTE DE LA FUENTE (sólo Windows)
//
// Por qué existe. En Windows, OpenCode lanza PowerShell para cosas de todos los
// días: copiar al portapapeles, pegar, abrir el navegador. Ese PowerShell queda
// pegado a la consola del bot, y Windows PowerShell 5.1, cuando arranca en una
// consola que está en UTF-8, le cambia la fuente a una de mapa de bits. Con esa
// fuente la consola convierte todo a la tabla vieja: el borde del cuadro de
// texto y las marcas de las herramientas pasan a ser signos de pregunta, el
// título de la ventana queda en «Windows PowerShell» y el dibujo se achica.
//
// Sacar el `chcp 65001` del lanzador arregló el ARRANQUE (hallazgo W33), pero en
// la notebook real los «?» volvieron a mitad de sesión, después de copiar un
// texto. Reproducido en la VM win10 el 2026-11-27: alcanza con un Ctrl+V.
//
// No se puede evitar que OpenCode lance PowerShell, así que se repara después:
// este plugin corre DENTRO de OpenCode, recuerda la fuente con que arrancó la
// ventana y, si la encuentra cambiada a una de mapa de bits, la vuelve a poner.
// Llama a kernel32 directamente (bun:ffi). Lanzar PowerShell para arreglar lo
// que rompe PowerShell sería volver a romperlo.
//
// Sólo devuelve lo que había: si la ventana arrancó en mapa de bits, no toca
// nada. Y no puede romper el bot: cualquier error apaga el vigilante y listo.
// ----------------------------------------------------------------------------

// CONSOLE_FONT_INFOEX (wincon.h), 84 bytes:
//   0 cbSize u32 · 4 nFont u32 · 8 ancho i16 · 10 alto i16 · 12 FontFamily u32 ·
//   16 FontWeight u32 · 20 FaceName, 32 caracteres UTF-16.
const TAMANIO_FUENTE = 84
const DESDE_FAMILIA = 12
// TMPF_TRUETYPE: el bit de FontFamily que distingue TrueType de mapa de bits.
const BIT_TRUETYPE = 4
const CADA_MS = 300
// Si la fuente no vuelve después de pedirlo tantas veces seguidas, no se insiste.
const INTENTOS_SEGUIDOS = 5

async function vigilarLaFuente(): Promise<void> {
  if (process.platform !== "win32") return
  try {
    const { dlopen } = await import("bun:ffi")
    const { symbols: k } = dlopen("kernel32.dll", {
      GetStdHandle: { args: ["i32"], returns: "ptr" },
      GetCurrentConsoleFontEx: { args: ["ptr", "i32", "ptr"], returns: "i32" },
      SetCurrentConsoleFontEx: { args: ["ptr", "i32", "ptr"], returns: "i32" },
      SetConsoleTitleW: { args: ["ptr"], returns: "i32" },
    })
    // -11 = STD_OUTPUT_HANDLE.
    const salida = k.GetStdHandle(-11)
    if (!salida) return

    const leer = (): Uint8Array | null => {
      const b = new Uint8Array(TAMANIO_FUENTE)
      new DataView(b.buffer).setUint32(0, TAMANIO_FUENTE, true)
      return k.GetCurrentConsoleFontEx(salida, 0, b) ? b : null
    }
    const esTrueType = (b: Uint8Array) => (new DataView(b.buffer).getUint32(DESDE_FAMILIA, true) & BIT_TRUETYPE) !== 0

    const buena = leer()
    // Si no se pudo leer, o la ventana ya arrancó en mapa de bits, no hay nada
    // que devolver: esa fuente la eligió alguien.
    if (!buena || !esTrueType(buena)) return

    // "Tecnia Bot" en UTF-16 terminado en cero, que es lo que pide la API.
    const TITULO = Buffer.from("Tecnia Bot\0", "utf16le")
    let fallidos = 0
    const reloj = setInterval(() => {
      try {
        const ahora = leer()
        if (!ahora || esTrueType(ahora)) {
          fallidos = 0
          return
        }
        k.SetCurrentConsoleFontEx(salida, 0, buena.slice())
        // Que la llamada conteste «ok» no alcanza: se vuelve a leer la ventana.
        const despues = leer()
        fallidos = despues && esTrueType(despues) ? 0 : fallidos + 1
        // El mismo PowerShell deja el título en «Windows PowerShell». OpenCode lo
        // vuelve a escribir cuando cambia de pantalla; mientras tanto, que diga
        // de quién es la ventana.
        k.SetConsoleTitleW(TITULO)
        if (fallidos >= INTENTOS_SEGUIDOS) clearInterval(reloj)
      } catch {
        clearInterval(reloj)
      }
    }, CADA_MS)
    // Que el reloj no impida cerrar OpenCode.
    ;(reloj as { unref?: () => void }).unref?.()
  } catch {
    // Sin bun:ffi o sin consola: el bot anda igual, sólo que sin vigilante.
  }
}

const tui: TuiPlugin = async (api) => {
  // No se espera: si tarda o falla, el splash se dibuja igual.
  void vigilarLaFuente()

  // Desactivamos el tip por defecto de OpenCode (`internal:home-tips`): con el
  // modelo gratis de Zen queda clavado en "Run /connect..." y confunde al docente.
  // Defensivo: si la API cambia entre versiones, no rompemos el arranque.
  try {
    await (api as { plugins?: { deactivate?: (id: string) => unknown } }).plugins?.deactivate?.("internal:home-tips")
  } catch {
    // sin drama: si no se pudo, en el peor caso convive el tip nativo
  }

  const version = versionInstalada()
  const nueva = await hayVersionNueva()

  // Sin key propia el agente corre en Big Pickle (gratis por tiempo limitado; las
  // conversaciones pueden usarse para mejorar el modelo): eso se dice SIEMPRE,
  // pisando el tip aleatorio, porque este producto lo usan menores. Si la key
  // guardada es la compartida vieja, esta muerta: se manda a Reparar, que la quita.
  // Con key propia ya puesta, no molestamos: tip normal, al azar.
  const estadoKey = estadoDeLaKey()
  const avisoKey =
    estadoKey === "sin-key"
      ? "Usás Big Pickle, el modelo gratuito de OpenCode (por tiempo limitado; el chat puede usarse para mejorar el modelo). Para Gemini: key gratis en aistudio.google.com/apikey y 'Reparar Tecnia Bot'"
      : estadoKey === "fallback"
        ? "La key compartida guardada ya no es válida: corré 'Reparar Tecnia Bot' (menú inicio) o /actualizar para quitarla y seguir con Big Pickle"
        : null
  // Con noUncheckedIndexedAccess, TIPS[i] es "string | undefined": el fallback
  // final es defensivo por si TIPS quedara vacío alguna vez.
  const tip =
    avisoKey ?? TIPS[Math.floor(Math.random() * TIPS.length)] ?? TIPS[0] ?? "Escribí \"hola\" y dejate guiar paso a paso"
  const label = avisoKey ? "Importante" : "Tip"

  api.slots.register({
    order: 100,
    slots: {
      home_logo() {
        return <Art api={api} nueva={nueva} version={version} />
      },
      // El cuadro de texto es EL MISMO que arma OpenCode por defecto (mismo `ref`,
      // mismo slot `home_prompt_right`): lo único que cambia son los ejemplos que
      // muestra vacío. Los de fábrica ("Fix broken tests", "What is the tech stack
      // of this project?") están en inglés y hablan de otro oficio.
      home_prompt(_ctx, props) {
        return (
          <api.ui.Prompt
            ref={props.ref}
            right={<api.ui.Slot name="home_prompt_right" />}
            placeholders={{ normal: EJEMPLOS, shell: ["dir", "pio --version", "cd .."] }}
          />
        )
      },
      home_bottom() {
        return <TipLine api={api} tip={tip} label={label} />
      },
    },
  })

  // La leyenda del cartel del checklist, aparte: si una versión no tiene el slot
  // `app_bottom`, se pierde la leyenda y no el logo.
  try {
    api.slots.register({
      order: 100,
      slots: {
        app_bottom() {
          // Una condicion en el JSX y no `<Show>`: el compilador de Solid la vuelve
          // reactiva igual, y asi el plugin no importa solid-js (ver el comentario
          // de `hayVersionNueva` sobre solid-js en un plugin externo). La prueba de
          // la VM se hizo con `<Show>`: esta forma queda por verificar ahi.
          return (
            <>
              {leyendaDelCartel(api) ? (
                <box paddingLeft={2} paddingRight={2}>
                  <text fg={pick(api, "warning", FALLBACK_GOLD)} wrapMode="word" selectable={false}>
                    {leyendaDelCartel(api)}
                  </text>
                </box>
              ) : null}
            </>
          )
        },
      },
    } as Parameters<TuiPluginApi["slots"]["register"]>[0])
  } catch {
    // sin leyenda: el cartel igual aparece, y el bot ya avisó qué botón es cuál
  }
}

export default {
  id: "tecnia.logo",
  tui,
}
