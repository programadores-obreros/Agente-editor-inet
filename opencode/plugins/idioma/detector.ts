// ============================================================================
// Tecnia Bot — detector de "planificación en inglés" en lo que escribe el modelo.
//
// POR QUÉ EXISTE. Con Gemini 3.5 Flash Lite en OpenCode 1.18.18, en charlas
// largas y casi siempre después de que una herramienta da error, el modelo deja
// de razonar aparte (0 tokens de reasoning) y escribe su plan COMO TEXTO
// VISIBLE, en inglés: "The tool reported: ... Let's communicate this clearly
// and warmly, following our rules: ...". En una charla real filtraron 22 de 31
// textos y el docente tuvo que pedir "en español, si?". El prompt ya dice
// "Hablás siempre en español" y aun así pasa: es intermitente, y una vez que
// la fuga queda en el historial el modelo la imita. No alcanza con el prompt.
//
// Este archivo es PURO (sin OpenCode, sin I/O): recibe un texto y devuelve el
// mismo texto sin los pedazos que son planificación en inglés. Lo usa el plugin
// tecnia-idioma.ts y lo prueban tests/idioma-detector.test.mjs.
//
// Vive en una SUBCARPETA a propósito: OpenCode carga como plugin todo
// `plugins/*.{ts,js}` del config (config/plugin.ts, glob sin `**`). Si este
// archivo estuviera al lado de tecnia-idioma.ts, OpenCode lo intentaría cargar
// como plugin y fallaría por no tener `server`.
//
// LA REGLA DE ORO: borrar español, código o algo que el docente pidió es mucho
// peor que dejar pasar una fuga. Por eso cada paso de abajo, ante la duda, NO
// borra; y si al final no se borra nada, el texto vuelve idéntico byte por byte.
//
// CÓMO DECIDE:
//
// 1. Corta el texto en SEGMENTOS: cada línea, y dentro de la línea cada oración
//    (". ", "! ", "? ", ": "). También corta cuando el modelo pega el plan con
//    la respuesta sin espacio ("…the response.Che, la placa…"): un punto
//    seguido de mayúscula o de ¡/¿. Las citas ("…", “…”, «…») no se cortan.
//    El CÓDIGO no se cuenta ni se borra nunca: bloques ``` (con cualquier
//    sangría, también adentro de una cita `>`), bloques sangrados con 4
//    espacios que no son continuación de una lista, `código inline`, `{…}` y
//    `[…]` de una línea (un JSON copiado no se corta en sus ": "), y, como red
//    de seguridad, un segmento SIN marca de plan con forma real de código (`;`
//    al final, una línea `{`/`}`, `//`, `#include`, `llamada(…);`). Las líneas
//    de tabla (`|…|`), de cita (`> …`), los títulos (`# …`) y las líneas de
//    error (`Error: …`) tampoco se borran nunca. Si en una línea hay algo que
//    se borra y algo protegido por la red de código, va la línea entera (si
//    tiene marca de plan) o nada: nunca queda un pedazo colgando.
//
// 2. Cada segmento cuenta PALABRAS FUNCIONALES (the/and/is/let's frente a
//    el/que/de/para/listo) fuera del código y de las citas. Los términos
//    técnicos ("LED", "WiFi", "upload_port", "Access Point", "Error 2") no son
//    funcionales: no vuelven inglés a un texto en español. Hacen falta 2 o más
//    funcionales inglesas Y más del doble que las españolas; con menos señal el
//    segmento es "neutro". Un segmento con una MARCA DE PLAN ("let's", "I'll",
//    "the user", "wait,", "remember the rule", un andamio como "Response
//    structure:" o "1. Enthusiastic confirmation:") y no más español que
//    inglés, es inglés.
//
// 3. Los DOS PUNTOS de una entrada del PLAN ceden la voz: lo que sigue a
//    "Let's tell the user:" es del plan aunque esté en español. Una entrada
//    inglesa SIN marca ("The tool description says:") sólo cede una cita
//    entera, nunca una lista ("What you will need:" no se lleva la lista).
//    La cesión dura hasta el fin de la línea si los dos puntos están en el
//    medio, o el párrafo siguiente si cierran la línea. Los neutros toman el
//    idioma del segmento anterior del mismo párrafo (o del siguiente, pero
//    nunca el inglés de más adelante en la MISMA línea, y nunca de una entrada
//    con dos puntos).
//
// 4. Se borra SÓLO el inglés que va ANTES del primer español del texto (el
//    "ancla"). Una cita entera o una línea `>` no es ancla: el modelo a veces
//    repite entre comillas el mensaje del docente y después contesta en
//    inglés. En los 61 textos del corpus real el plan siempre precede a la
//    respuesta; lo que viene después del ancla es algo que la respuesta
//    muestra o que el docente pidió. Y sólo si en lo que se borra hay una
//    marca de plan (o el eco del mensaje del docente). Dos excepciones:
//    - Una RESPUESTA ENTERA EN INGLÉS al principio (párrafos con 8+
//      funcionales inglesas y más del triple que españolas, que no parecen un
//      error ni los presenta una entrada no inglesa) se borra sin marca.
//    - Una interjección sola como texto entero ("Aha!", "Okay.") se borra.
//    Si el docente pidió inglés o una traducción (Opciones.ultimoUsuario),
//    no se toca nada.
//
//    CASO DUDOSO, lo que una entrada del plan presenta en español en líneas
//    propias ("Let's answer directly and in Spanish:\n**No, ahora mismo no la
//    veo.**…") o detrás de una etiqueta de andamio: se RESCATA, salvo que
//    repita (40 % o más de sus palabras) lo que ya queda; ahí era un borrador
//    de la respuesta que viene después y dejarlo la duplicaría. La cita en la
//    misma línea ("Remember the rule: compilar es control de calidad…") no se
//    rescata nunca: es el modelo recitando el prompt.
//
// Textos de más de MAX_TEXTO caracteres vuelven sin tocar: ninguna fuga real
// es tan larga, y un filtro no puede demorar la respuesta.
// ============================================================================

export type Idioma = "en" | "es" | "neutro"

export interface Segmento {
  /** Texto del segmento (con su código y sus citas), sobre el texto con saltos `\n`. */
  texto: string
  inicio: number
  fin: number
  /** "codigo" = bloque de código; se conserva siempre. */
  tipo: "texto" | "codigo"
  /** Idioma por sus propias palabras funcionales. */
  propio: Idioma
  /** Idioma de quien "habla" en el segmento, después de los dos puntos y los vecinos. */
  dueno: Idioma
  /** true si el segmento se saca del texto. */
  quitado: boolean
  /** true si la voz se la cedió una entrada del plan con dos puntos. */
  citado: boolean
  /** true si nunca se borra (parece código, línea de tabla o de cita `>`). */
  protegido: boolean
  /** true si tiene una marca de plan ("let's", "the user", "wait"…). */
  marca: boolean
  // ---- internos ----
  linea: number
  parrafo: number
  finDeLinea: boolean
  dosPuntos: boolean
  citaEnBloque: boolean
  /** La voz se la cedió una etiqueta de andamio ("1. Enthusiastic confirmation:"). */
  citaDeAndamio: boolean
  soloCita: boolean
  lineaDeCita: boolean
  en: number
  es: number
  lineaTexto: string
}

export interface Resultado {
  /** El texto limpio. Si `cambio` es false, es el original sin tocar (mismos bytes). */
  texto: string
  cambio: boolean
  /** Los pedazos que se sacaron, para el log. */
  quitados: string[]
}

/** Más largo que esto vuelve sin tocar. */
export const MAX_TEXTO = 20_000

// Palabras funcionales. Quedan AFUERA a propósito las que existen en los dos
// idiomas o aparecen en respuestas en español: "a", "no", "me", "on" (ON/OFF),
// "he", "solo", "ok".
const EN = new Set(
  (
    "the and is are was were be been being it its it's this that these those to of for with at by from into " +
    "about in we we're we'll we've us our let's let i i'm i'll i've you you're your they they're them their " +
    "he's she his her will would should can can't could do does did don't doesn't didn't not if then than so " +
    "but or an as what what's which who whom why how when where while has have had there there's here now " +
    "just also because still yet wait after before again all any some each both only very too out up over " +
    "under since until maybe might must may really already instead either whether same such own more most " +
    "isn't aren't wasn't won't that's"
  ).split(" "),
)
const ES = new Set(
  (
    "de la que el en y los las del se por con una un para es está están lo como más pero sus su le les ya o " +
    "este esta esto estos estas ese esa eso sí si porque entre cuando muy sin sobre también hasta hay donde " +
    "desde todo toda todos todas nos ni otro otra otros otras qué cómo cuándo dónde cuál yo vos tu tus te ti " +
    "mi mis tenés querés podés sos estás fijate dale che al son ser fue va vamos vas acá ahí ahora después " +
    "antes todavía tiene tengo hace hacer puede algo nada cada cual así aunque mientras luego entonces " +
    "probá usá mirá decime contame listo lista perfecto claro hola bueno genial bien"
  ).split(" "),
)

// Marcas de PLAN: frases con las que el modelo se habla a sí mismo. Sin al
// menos una en lo que se va a borrar, no se borra nada (salvo la respuesta
// entera en inglés del paso 4b). "wait" cuenta sólo como interjección
// ("Wait,", "Ah, wait!"): "Wait 2 seconds" es una instrucción. "the tool"
// cuenta sólo con un verbo de informe: "the soldering tool is hot" no es plan.
const MARCA_PLAN = new RegExp(
  String.raw`\b(?:let's|let me|let us|i'll|i will|i am going to|i'm going to|i need|we need|i must|i have to|` +
    String.raw`i should|we should|we'll|we will|my plan|the user|the teacher|thinking about|remember the rule|` +
    String.raw`our rules|the rules|now i|okay,? so|` +
    String.raw`the (?:\w+ )?tool (?:reported|returned|says|said|shows|showed|output|tells|told|confirms|confirmed|gave))\b|` +
    String.raw`\bwait\b(?=\s*(?:[,!.:…]|$))`,
  "i",
)

// Andamios del plan: el modelo arma el esqueleto de la respuesta en inglés
// ("Response structure:", "Tone:", "1. Enthusiastic confirmation: ¡Obvio…!").
const ANDAMIO =
  /^\s*(?:[-*]\s+|\d+[.)]\s*)?(?:\*\*)?(?:response structure|structure|plan|draft|response|answer|final answer|my response|reply|outline|steps|tone|key points)(?:\*\*)?\s*:/i
// Ítem con una etiqueta en inglés y dos puntos: "1. Enthusiastic confirmation:", "- Explain how it works:".
const ITEM_ETIQUETA = /^\s*(?:\d+[.)]|[-*])\s+(?:\*\*)?([A-Za-z][A-Za-z' -]{1,60}?)(?:\*\*)?\s*:\s*$/
const SUFIJO_INGLES = /(?:tion|sion|ing|ment|ness|ity|ive|ic|ance|ence|ure|ly)$/
const VERBO_ETIQUETA = new Set(
  "explain confirm ask offer give mention close end summary example question greeting closing wrap recap next call show tell answer".split(
    " ",
  ),
)
/** ¿La etiqueta de un ítem está en inglés? Sin funcionales españolas ni tildes, y con forma inglesa. */
function etiquetaInglesa(segmento: string): boolean {
  const m = segmento.match(ITEM_ETIQUETA)
  if (!m) return false
  const palabras = m[1]!.toLowerCase().split(/[\s-]+/).filter(Boolean)
  if (palabras.some((w) => ES.has(w) || /[áéíóúñü]/.test(w))) return false
  return palabras.some((w) => EN.has(w) || VERBO_ETIQUETA.has(w) || SUFIJO_INGLES.test(w))
}

// Interjecciones en inglés que a veces quedan SOLAS como texto entre tools.
const INTERJECCION = /^\s*(?:aha|oh|hmm+|okay|sure|got it|perfect|great|alright|all right|understood)\s*[.!…]*\s*$/i

// Una línea de error/aviso no se borra nunca: es lo que la respuesta muestra.
const LINEA_ERROR = /^\s*(?:\*\*)?(?:error|warning|fatal)\b/i
// Un párrafo que parece un error o un log (para la regla de respuesta entera en inglés).
const PARECE_ERROR = /^\s*(?:\*\*)?(?:error|warning|fatal|exception|traceback)\b|error occurred|failed to (?:connect|open|upload|read|write)|\berrno\b|exit status/i

// Red de seguridad: un segmento con FORMA real de código no se borra aunque
// cuente como inglés. Sólo formas inequívocas: `;` al final, una línea que es
// sólo `{` o `}`, `//` al empezar, `#include`, una llamada terminada en `;`.
// (Un `x = y` o un `;` en el medio de una oración no alcanzan: "The upload
// failed; let's tell the user…" es una fuga.) Y nunca si el segmento tiene una
// marca de plan.
const PARECE_CODIGO = /;\s*$|^\s*[{}]\s*$|^\s*(?:\/\/|\/\*)|#\s*(?:include|define)\b|\b\w+\s*\([^()]*\)\s*;/

// Un pedido de inglés o de traducción del docente: ese turno no se filtra.
export const PIDE_INGLES = /ingl[eé]s|english|traduc/i

const CIERRE_CITA: Record<string, string> = { '"': '"', "“": "”", "«": "»" }
const MAX_CITA = 2000

interface Rango {
  ini: number
  fin: number
}

/** Índice del primer rango con ini >= x (los rangos vienen ordenados). */
function primeroDesde(rs: Rango[], x: number): number {
  let lo = 0
  let hi = rs.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (rs[m]!.ini < x) lo = m + 1
    else hi = m
  }
  return lo
}

/** El rango que contiene x, o undefined. */
function rangoQueContiene(rs: Rango[], x: number): Rango | undefined {
  const k = primeroDesde(rs, x + 1) - 1
  const r = rs[k]
  return r && x >= r.ini && x < r.fin ? r : undefined
}

interface Linea {
  ini: number
  fin: number // sin el \n
  texto: string
}

function lineasDe(t: string): Linea[] {
  const out: Linea[] = []
  let ini = 0
  while (ini <= t.length) {
    const nl = t.indexOf("\n", ini)
    const fin = nl < 0 ? t.length : nl
    out.push({ ini, fin, texto: t.slice(ini, fin) })
    if (nl < 0) break
    ini = nl + 1
  }
  return out
}

const sangria = (l: string) => {
  let n = 0
  for (const c of l) {
    if (c === " ") n++
    else if (c === "\t") n += 4
    else break
  }
  return n
}
const ITEM_LISTA = /^\s*(?:[-*+]|\d+[.)])\s/

/**
 * Bloques de código: vallas ``` / ~~~ con cualquier sangría y con prefijo `>`
 * (una cita de markdown), hasta la valla que cierra o el final del texto; y
 * bloques sangrados con 4+ espacios que NO son continuación de una lista.
 */
function bloquesDeCodigo(lineas: Linea[], largo: number): Rango[] {
  const out: Rango[] = []
  const VALLA = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/
  let k = 0
  while (k < lineas.length) {
    const m = lineas[k]!.texto.match(VALLA)
    if (!m) {
      k++
      continue
    }
    const valla = m[1]!
    const cierre = new RegExp(`^[ \\t]*(?:>[ \\t]*)*\\${valla[0]}{${valla.length},}[ \\t]*$`)
    let j = k + 1
    while (j < lineas.length && !cierre.test(lineas[j]!.texto)) j++
    const fin = j < lineas.length ? lineas[j]!.fin : largo
    out.push({ ini: lineas[k]!.ini, fin })
    k = j + 1
  }

  // Sangrado: un párrafo cuyas líneas tienen TODAS 4+ espacios, después de una
  // línea en blanco, y cuya línea anterior con texto no es un ítem de lista ni
  // otra línea sangrada (eso sería la continuación de la lista).
  const enValla = (x: number) => rangoQueContiene(out, x) !== undefined
  const sangrados: Rango[] = []
  let anteriorConTexto: Linea | undefined
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]!
    if (enValla(l.ini) || !l.texto.trim()) {
      if (l.texto.trim()) anteriorConTexto = l
      i++
      continue
    }
    const trasBlanco = i === 0 || !lineas[i - 1]!.texto.trim()
    if (sangria(l.texto) >= 4 && trasBlanco) {
      let j = i
      while (j < lineas.length && lineas[j]!.texto.trim() && sangria(lineas[j]!.texto) >= 4 && !enValla(lineas[j]!.ini)) j++
      // El párrafo entero tiene que estar sangrado: termina en blanco, en una valla o al final.
      const terminaBien = j >= lineas.length || !lineas[j]!.texto.trim() || enValla(lineas[j]!.ini)
      const continuacion =
        anteriorConTexto !== undefined && (ITEM_LISTA.test(anteriorConTexto.texto) || sangria(anteriorConTexto.texto) >= 2)
      if (terminaBien && !continuacion) sangrados.push({ ini: l.ini, fin: lineas[j - 1]!.fin })
      anteriorConTexto = lineas[j - 1]!
      i = j
      continue
    }
    anteriorConTexto = l
    i++
  }
  return [...out, ...sangrados].sort((a, b) => a.ini - b.ini)
}

/** Código `inline` (una sola línea), fuera de los bloques. */
function codigoInline(t: string, bloques: Rango[]): Rango[] {
  const out: Rango[] = []
  const re = /`[^`\n]+`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const b = rangoQueContiene(bloques, m.index)
    if (b) {
      re.lastIndex = b.fin
      continue
    }
    out.push({ ini: m.index, fin: m.index + m[0].length })
  }
  return out
}

/** `{…}` y `[…]` sin anidar y de una sola línea, fuera de los bloques. */
function llaves(t: string, bloques: Rango[]): Rango[] {
  const out: Rango[] = []
  const re = /\{[^{}\n]*\}|\[[^[\]\n]*\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const b = rangoQueContiene(bloques, m.index)
    if (b) {
      re.lastIndex = b.fin
      continue
    }
    out.push({ ini: m.index, fin: m.index + m[0].length })
  }
  return out
}

/** Citas "…", “…” y «…» fuera del código. Pueden cruzar líneas (un borrador de dos párrafos). */
function citas(t: string, bloques: Rango[], inline: Rango[]): Rango[] {
  const out: Rango[] = []
  const finInline = new Map(inline.map((r) => [r.ini, r.fin]))
  const finBloque = new Map(bloques.map((r) => [r.ini, r.fin]))
  // Posiciones de cada cierre, para buscar el próximo por bisección: con
  // indexOf, 7000 “ sin cerrar costaban 200 ms (cada una recorría hasta el final).
  const posiciones = new Map<string, Rango[]>()
  for (const c of new Set(Object.values(CIERRE_CITA))) posiciones.set(c, [])
  for (let p = 0; p < t.length; p++) posiciones.get(t[p]!)?.push({ ini: p, fin: p + 1 })
  let i = 0
  while (i < t.length) {
    const salto = finInline.get(i) ?? finBloque.get(i)
    if (salto !== undefined) {
      i = salto
      continue
    }
    const cierre = CIERRE_CITA[t[i]!]
    if (cierre) {
      // El próximo cierre que no esté adentro de código inline; la cita no cruza un bloque.
      const bloqueSig = bloques[primeroDesde(bloques, i + 1)]
      const tope = Math.min(i + MAX_CITA, bloqueSig ? bloqueSig.ini : t.length)
      const pos = posiciones.get(cierre)!
      let q = primeroDesde(pos, i + 1)
      while (q < pos.length && pos[q]!.ini < tope && rangoQueContiene(inline, pos[q]!.ini)) q++
      const k = q < pos.length ? pos[q]!.ini : -1
      if (k >= 0 && k < tope) {
        out.push({ ini: i, fin: k + 1 })
        i = k + 1
        continue
      }
    }
    i++
  }
  return out
}

function contar(texto: string): { en: number; es: number; palabras: number } {
  const tokens = texto.toLowerCase().replace(/[’`]/g, "'").match(/[\p{L}\p{N}_]+(?:'[\p{L}\p{N}_]+)*/gu) ?? []
  let en = 0
  let es = 0
  let palabras = 0
  for (const tok of tokens) {
    // Un identificador (is_the_led_on, upload_port) no es una palabra de nadie.
    if (tok.includes("_")) continue
    palabras++
    if (EN.has(tok)) en++
    else if (ES.has(tok)) es++
  }
  // ¡ y ¿ sólo existen en español: cada uno vale una palabra funcional.
  es += (texto.match(/[¡¿]/g) ?? []).length
  return { en, es, palabras }
}

function idiomaDe(en: number, es: number): Idioma {
  if (en >= 2 && en > 2 * es) return "en"
  if (es >= 1) return "es"
  return "neutro"
}

/** Corta el texto (ya con saltos `\n`) en segmentos y les asigna idioma propio. */
function segmentar(t: string): Segmento[] {
  const lineas = lineasDe(t)
  const bloques = bloquesDeCodigo(lineas, t.length)
  // `{…}` y `[…]` de una línea van como código inline: no se cuentan y no se
  // cortan en sus ": " (un JSON copiado de una tool no se puede mutilar).
  const inline = [...codigoInline(t, bloques), ...llaves(t, bloques)]
    .sort((x, y) => x.ini - y.ini)
    .filter((r, k, rs) => k === 0 || r.ini >= rs[k - 1]!.fin)
  const cits = citas(t, bloques, inline)
  // Rangos atómicos de primer nivel (el inline adentro de una cita va con la cita).
  const atomos = [...cits, ...inline.filter((r) => !rangoQueContiene(cits, r.ini))].sort((a, b) => a.ini - b.ini)
  const finAtomo = new Map(atomos.map((r) => [r.ini, r.fin]))
  const finCita = new Set(cits.map((r) => r.fin))
  const finBloque = new Map(bloques.map((b) => [b.ini, b.fin]))

  const crudos: { ini: number; fin: number; tipo: "texto" | "codigo" }[] = []
  let ini = -1
  const cerrar = (fin: number) => {
    if (ini < 0) return
    let f = fin
    while (f > ini && /\s/.test(t[f - 1]!)) f--
    if (f > ini) crudos.push({ ini, fin: f, tipo: "texto" })
    ini = -1
  }

  let i = 0
  while (i < t.length) {
    const fb = finBloque.get(i)
    if (fb !== undefined) {
      cerrar(i)
      crudos.push({ ini: i, fin: fb, tipo: "codigo" })
      i = fb
      continue
    }
    const c = t[i]!
    if (c === "\n") {
      cerrar(i)
      i++
      continue
    }
    if (ini < 0 && /\s/.test(c)) {
      i++
      continue
    }
    if (ini < 0) ini = i
    const fa = finAtomo.get(i)
    if (fa !== undefined) {
      // Una cita que termina en .!? y sigue un espacio cierra la oración.
      const ultimo = t[fa - 2]
      i = fa
      if (ultimo && /[.!?…]/.test(ultimo) && finCita.has(fa) && (i >= t.length || /\s/.test(t[i]!))) cerrar(i)
      continue
    }
    if (/[.!?…:]/.test(c)) {
      let j = i
      while (j < t.length && /[.!?…:]/.test(t[j]!)) j++
      const corrida = t.slice(i, j)
      const sig = t[j]
      const previo = t[i - 1] ?? ""
      // "1." de una lista, "2.0", "192.168.4.1": un punto después de un dígito no cierra oración.
      const trasDigito = /\d/.test(previo) && corrida === "."
      let corta = false
      if (!trasDigito) {
        if (sig === undefined || /\s/.test(sig)) corta = true
        // Pegado: "response.Che", "flash it!¡Sí!". Los dos puntos pegados no cortan (http://).
        else if (!corrida.includes(":") && /[¡¿\p{Lu}]/u.test(sig)) corta = true
      }
      i = j
      if (corta) cerrar(i)
      continue
    }
    i++
  }
  cerrar(t.length)

  // Línea, párrafo y conteo de cada segmento. Todo en una pasada.
  const segs: Segmento[] = []
  let parrafo = 0
  let linea = 0
  let cursor = 0
  let a = 0 // puntero en `atomos`
  for (const [k, r] of crudos.entries()) {
    const hueco = t.slice(cursor, r.ini)
    linea += (hueco.match(/\n/g) ?? []).length
    if (k > 0 && /\n[ \t]*\n/.test(hueco)) parrafo++
    const texto = t.slice(r.ini, r.fin)
    const nl = t.indexOf("\n", r.fin)
    const resto = t.slice(r.fin, nl < 0 ? t.length : nl)
    const inicioLinea = t.lastIndexOf("\n", r.ini - 1) + 1
    const seg: Segmento = {
      texto,
      inicio: r.ini,
      fin: r.fin,
      tipo: r.tipo,
      propio: "neutro",
      dueno: "neutro",
      quitado: false,
      citado: false,
      protegido: r.tipo === "codigo",
      marca: false,
      linea,
      parrafo,
      finDeLinea: resto.trim() === "",
      dosPuntos: /:\**\s*$/.test(texto),
      citaEnBloque: false,
      citaDeAndamio: false,
      soloCita: false,
      lineaDeCita: false,
      en: 0,
      es: 0,
      lineaTexto: "",
    }
    if (r.tipo === "texto") {
      // Afuera: sin código ni citas. Adentro: lo citado (sin código).
      let afuera = ""
      let adentro = ""
      let p = r.ini
      while (a < atomos.length && atomos[a]!.fin <= r.ini) a++
      for (let q = a; q < atomos.length && atomos[q]!.ini < r.fin; q++) {
        const at = atomos[q]!
        afuera += t.slice(p, at.ini) + " "
        if (finCita.has(at.fin) && CIERRE_CITA[t[at.ini]!]) adentro += " " + t.slice(at.ini + 1, at.fin - 1).replace(/`[^`\n]+`/g, " ") + " "
        p = at.fin
      }
      afuera += t.slice(p, r.fin)
      const lineaTexto = t.slice(inicioLinea, nl < 0 ? t.length : nl)
      const sinApostrofo = afuera.replace(/’/g, "'")
      seg.lineaTexto = lineaTexto
      seg.lineaDeCita = /^\s*>/.test(lineaTexto)
      seg.marca = MARCA_PLAN.test(sinApostrofo) || ANDAMIO.test(texto) || etiquetaInglesa(texto)
      // Nunca se borran: forma real de código (sin marca de plan), tablas,
      // citas `>`, títulos `#` y líneas de error.
      seg.protegido =
        (!seg.marca && PARECE_CODIGO.test(afuera)) ||
        /^\s*(?:[|>]|#{1,6}\s)/.test(lineaTexto) ||
        LINEA_ERROR.test(lineaTexto)
      const c = contar(afuera)
      seg.en = c.en
      seg.es = c.es
      if (c.palabras === 0 && adentro.trim()) {
        const b = contar(adentro)
        seg.soloCita = true
        seg.propio = idiomaDe(b.en, b.es)
      } else {
        seg.propio = idiomaDe(c.en, c.es)
        // Una entrada que cede la voz ("The tool reported:", "Remember the rule:",
        // "Let's ask a concrete question:") es corta: con UNA funcional inglesa y
        // ninguna española alcanza. "Solución:" o "Access Point:" siguen neutras.
        if (seg.propio === "neutro" && seg.dosPuntos && c.en >= 1 && c.es === 0) seg.propio = "en"
        // Una marca de plan con tanto o más inglés que español ("Ah, wait!",
        // "Let's check la placa first.", "Response structure:") es inglés.
        if (seg.propio !== "en" && seg.marca && c.en >= c.es) seg.propio = "en"
      }
    }
    segs.push(seg)
    linea += (texto.match(/\n/g) ?? []).length
    cursor = r.fin
  }
  return segs
}

export interface Opciones {
  /**
   * El último mensaje del docente, si se sabe. Sirve para dos cosas: si pidió
   * inglés o una traducción, ese turno no se filtra (PIDE_INGLES); y si el
   * modelo lo repite entre comillas, esa repetición es eco del plan.
   */
  ultimoUsuario?: string
}

const normalizar = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
const palabrasDe = (x: string) => new Set(x.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])

/** ¿El segmento es sólo una cita igual (o casi) al último mensaje del docente? */
function esEco(s: Segmento, usuario: string | undefined): boolean {
  if (!usuario || !s.soloCita) return false
  const q = normalizar(s.texto)
  const u = normalizar(usuario)
  if (q.length < 8 || u.length < 8) return false
  if (q === u) return true
  const [corto, largo] = q.length <= u.length ? [q, u] : [u, q]
  return largo.includes(corto) && corto.length / largo.length >= 0.8
}

/** Segmenta y decide qué se borra. Exportado para los tests y la evaluación del corpus. */
export function analizar(original: string, opciones: Opciones = {}): Segmento[] {
  const t = original.replace(/\r\n?/g, "\n")
  const segs = segmentar(t)
  const textos = segs.filter((s) => s.tipo === "texto")

  // Paso 3a: los dos puntos de una entrada del PLAN ceden la voz.
  let cesion: {
    modo: "linea" | "bloque"
    linea: number
    parrafo: number
    parrafoCitado: number
    andamio: boolean
    soloCitas: boolean
  } | null = null
  for (const s of textos) {
    if (cesion) {
      const sigue =
        cesion.modo === "linea"
          ? s.linea === cesion.linea
          : s.linea > cesion.linea &&
            (cesion.parrafoCitado >= 0 ? s.parrafo === cesion.parrafoCitado : s.parrafo <= cesion.parrafo + 1)
      if (!sigue || s.propio === "en" || (cesion.soloCitas && !s.soloCita)) {
        cesion = null
      } else {
        s.dueno = "en"
        s.citado = true
        s.citaEnBloque = cesion.modo === "bloque"
        s.citaDeAndamio = cesion.andamio
        if (cesion.parrafoCitado < 0) cesion.parrafoCitado = s.parrafo
        continue
      }
    }
    s.dueno = s.propio
    // Con marca de plan cede todo lo que sigue; sin marca ("The tool
    // description says:") sólo cede una cita entera, nunca una lista.
    if (s.dosPuntos && s.dueno === "en") {
      cesion = {
        soloCitas: !s.marca,
        modo: s.finDeLinea ? "bloque" : "linea",
        linea: s.linea,
        parrafo: s.parrafo,
        parrafoCitado: -1,
        andamio: ANDAMIO.test(s.texto) || etiquetaInglesa(s.texto),
      }
    }
  }

  // Paso 3b: los neutros heredan del vecino del mismo párrafo. Dos pasadas
  // lineales: primero el anterior; si no hay, el siguiente, salvo que sea
  // inglés en la MISMA línea ("OK. The board is ready…": "OK." no se vuelve
  // inglés por lo que viene después). Una entrada con dos puntos no contagia
  // lo que presenta: "Here's what you will need:" no se lleva "- 3 LEDs".
  const conSenal = (x: Segmento) => x.dueno !== "neutro" && !x.citado && !x.dosPuntos
  const anterior: (Segmento | undefined)[] = []
  let ultimo: Segmento | undefined
  for (const [k, s] of textos.entries()) {
    if (k > 0 && textos[k - 1]!.parrafo !== s.parrafo) ultimo = undefined
    anterior[k] = ultimo
    if (conSenal(s)) ultimo = s
  }
  const siguiente: (Segmento | undefined)[] = []
  ultimo = undefined
  for (let k = textos.length - 1; k >= 0; k--) {
    const s = textos[k]!
    if (k < textos.length - 1 && textos[k + 1]!.parrafo !== s.parrafo) ultimo = undefined
    siguiente[k] = ultimo
    if (conSenal(s)) ultimo = s
  }
  for (const [k, s] of textos.entries()) {
    if (s.dueno !== "neutro" || s.citado) continue
    const ant = anterior[k]
    const sig = siguiente[k]
    if (ant) s.dueno = ant.dueno
    else if (sig && !(sig.linea === s.linea && sig.dueno === "en")) s.dueno = sig.dueno
  }

  // Interjección sola como texto entero ("Aha!", "Okay.", "Sure!"): se va.
  if (textos.length > 0 && INTERJECCION.test(t)) {
    for (const s of textos) s.quitado = true
    return segs
  }

  // Paso 4a: el ancla es el primer español que NO es una cita entera ni una
  // línea `>`: el eco del mensaje del docente entre comillas no cuenta.
  const eco = new Set(textos.filter((s) => esEco(s, opciones.ultimoUsuario)))
  const primerEs = textos.findIndex((s) => s.dueno === "es" && !s.soloCita && !s.lineaDeCita)
  const antes = primerEs < 0 ? textos : textos.slice(0, primerEs)
  const candidatos = antes.filter((s) => eco.has(s) || (s.dueno === "en" && !s.protegido))
  const borrar = new Set<Segmento>()
  // Sin ninguna marca de plan (o eco) en lo que se borraría, no se borra nada.
  if (candidatos.some((s) => s.marca || eco.has(s))) for (const s of candidatos) borrar.add(s)

  // Paso 4b: RESPUESTA ENTERA EN INGLÉS al principio, aunque no tenga marca.
  // Párrafos antes del ancla con 8+ funcionales inglesas y más del triple que
  // españolas, que no parecen un error/log ni los presenta una entrada con
  // dos puntos que no es inglesa ("ESP32-S3 DevKitC-1:\nThe board is not
  // responding…"). Se va el párrafo entero, salvo lo protegido.
  const parrafoAncla = primerEs < 0 ? Infinity : textos[primerEs]!.parrafo
  const porParrafo = new Map<number, Segmento[]>()
  for (const s of textos) {
    if (s.parrafo >= parrafoAncla) break
    const g = porParrafo.get(s.parrafo)
    if (g) g.push(s)
    else porParrafo.set(s.parrafo, [s])
  }
  for (const grupo of porParrafo.values()) {
    const propios = grupo.filter((s) => !s.soloCita && !s.protegido)
    const en = propios.reduce((n, s) => n + s.en, 0)
    const es = propios.reduce((n, s) => n + s.es, 0)
    let entrada = false
    let presentado = false
    for (const s of grupo) {
      if (entrada && s.dueno === "en") presentado = true
      if (s.dosPuntos && s.propio !== "en") entrada = true
    }
    const texto = grupo.map((s) => s.texto).join("\n")
    if (en >= 8 && en > 3 * es && !presentado && !PARECE_ERROR.test(texto)) for (const s of propios) borrar.add(s)
  }
  for (const s of borrar) s.quitado = true

  // Si de lo que queda sólo hay citas enteras (el eco del docente cuando no se
  // sabe cuál fue su mensaje, o la salida de una tool), eran parte de la fuga.
  if (borrar.size > 0) {
    const quedan = textos.filter((s) => !s.quitado)
    if (quedan.length > 0 && quedan.every((s) => s.soloCita && !s.protegido)) for (const s of quedan) s.quitado = true
  }

  // Paso 4c: una línea no se corta alrededor de algo que parece código. Si en
  // la línea hay algo que se borra y algo protegido por la red de código, se
  // borra la línea entera si tiene marca de plan, o no se borra nada de ella.
  const porLinea = new Map<number, Segmento[]>()
  for (const s of textos) {
    const g = porLinea.get(s.linea)
    if (g) g.push(s)
    else porLinea.set(s.linea, [s])
  }
  for (const grupo of porLinea.values()) {
    if (!grupo.some((s) => s.quitado)) continue
    const lineaFija = /^\s*(?:[|>]|#{1,6}\s)/.test(grupo[0]!.lineaTexto) || LINEA_ERROR.test(grupo[0]!.lineaTexto)
    if (lineaFija || !grupo.some((s) => s.protegido)) continue
    const todo = grupo.some((s) => s.marca)
    for (const s of grupo) s.quitado = todo
  }

  // Paso 4d: rescate de lo que una entrada del plan presentó en español en
  // líneas propias (o una etiqueta de andamio en su misma línea), salvo que
  // repita lo que ya queda: ahí era un borrador de la respuesta que sigue.
  const rescatables = textos.filter(
    (s) => s.quitado && s.citado && (s.citaEnBloque || s.citaDeAndamio) && s.propio !== "en" && !eco.has(s),
  )
  if (rescatables.some((s) => s.propio === "es")) {
    const queda = palabrasDe(
      textos
        .filter((s) => !s.quitado)
        .map((s) => s.texto)
        .join(" "),
    )
    const repite = (s: Segmento) => {
      const p = [...palabrasDe(s.texto)]
      return p.length > 0 && p.filter((w) => queda.has(w)).length / p.length >= 0.4
    }
    if (!rescatables.some((s) => s.propio === "es" && repite(s))) for (const s of rescatables) s.quitado = false
  }
  return segs
}

/** Saca la cita que envuelve un segmento rescatado ("Che, …" -> Che, …). */
function sinComillas(s: Segmento): string {
  if (!s.soloCita || !s.citado) return s.texto
  const m = s.texto.match(/^(\s*)(["“«])([\s\S]*)(["”»])(\s*)$/)
  if (m && CIERRE_CITA[m[2]!] === m[4]) return m[1]! + m[3]! + m[5]!
  return s.texto
}

/**
 * Saca la planificación en inglés de un texto del modelo.
 * Si no hay nada que sacar devuelve el MISMO texto (cambio=false), con sus
 * mismos bytes (también los `\r\n`). Si se saca todo, devuelve "" (OpenCode no
 * muestra partes de texto vacías).
 */
export function limpiar(original: string, opciones: Opciones = {}): Resultado {
  const igual: Resultado = { texto: original, cambio: false, quitados: [] }
  if (typeof original !== "string" || !original.trim() || original.length > MAX_TEXTO) return igual
  // El docente pidió inglés o una traducción: ese turno no se toca.
  if (opciones.ultimoUsuario && PIDE_INGLES.test(opciones.ultimoUsuario)) return igual
  const t = original.replace(/\r\n?/g, "\n")
  const segs = analizar(t, opciones)
  const quitados = segs.filter((s) => s.quitado)
  if (quitados.length === 0) return igual

  // Reconstrucción: los segmentos que quedan, unidos por el hueco original si
  // eran vecinos, o por un salto de línea (o de párrafo) si en el medio se sacó algo.
  let out = ""
  let previo: Segmento | null = null
  let saltado = false
  for (const s of segs) {
    if (s.quitado) {
      saltado = true
      continue
    }
    if (previo) {
      const tramo = t.slice(previo.fin, s.inicio)
      if (!saltado) out += tramo
      else {
        // Se conserva la sangría de la línea siguiente (una lista anidada sigue
        // anidada), pero sólo si el segmento empieza la línea: si antes había una
        // etiqueta borrada ("2. Explain how it works: Se usa…"), no queda espacio.
        const sangria = tramo.slice(tramo.lastIndexOf("\n") + 1).match(/^[ \t]*$/)?.[0] ?? ""
        if (/\n[ \t]*\n/.test(tramo)) out += "\n\n" + sangria
        else if (tramo.includes("\n")) out += "\n" + sangria
        else out += " "
      }
    }
    out += s.citado ? sinComillas(s) : s.texto
    previo = s
    saltado = false
  }
  return { texto: out.trim() ? out : "", cambio: true, quitados: quitados.map((s) => s.texto) }
}
