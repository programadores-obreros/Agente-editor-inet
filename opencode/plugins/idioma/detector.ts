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
//    espacios que no son continuación de una lista, `código inline`, y además,
//    como red de seguridad, cualquier segmento que PARECE código (`;`, `{}`,
//    `//`, `#include`, `x = y`, `digitalWrite(`). Las líneas de tabla (`|…|`)
//    y de cita (`> …`) tampoco se borran nunca.
//
// 2. Cada segmento cuenta PALABRAS FUNCIONALES (the/and/is/let's frente a
//    el/que/de/para/listo) fuera del código y de las citas. Los términos
//    técnicos ("LED", "WiFi", "upload_port", "Access Point", "Error 2") no son
//    funcionales: no vuelven inglés a un texto en español. Hacen falta 2 o más
//    funcionales inglesas Y más del doble que las españolas; con menos señal el
//    segmento es "neutro". Un segmento con una MARCA DE PLAN ("let's", "I'll",
//    "the user", "wait", "remember the rule"…) y nada de español es inglés.
//
// 3. Los DOS PUNTOS de una entrada del PLAN ceden la voz: lo que sigue a
//    "Let's tell the user:" o "The tool reported:" es del plan aunque esté en
//    español (un borrador, o la salida de la herramienta copiada). Sólo cede la
//    voz una entrada con marca de plan: "What you will need:" no se lleva la
//    lista que la sigue. La cesión dura hasta el fin de la línea si los dos
//    puntos están en el medio, o el párrafo siguiente si cierran la línea.
//    Los neutros toman el idioma del segmento anterior del mismo párrafo (o del
//    siguiente, pero nunca el inglés de más adelante en la MISMA línea).
//
// 4. Se borra SÓLO el inglés que va ANTES del primer español del texto. En los
//    61 textos del corpus real el plan siempre precede a la respuesta; lo que
//    viene después del primer español es algo que la respuesta muestra o que el
//    docente pidió (un error copiado, una traducción, un texto para la clase de
//    inglés técnico). Y sólo si en lo que se borra hay al menos una marca de
//    plan: un título como "## Getting started with the ESP32" o un error suelto
//    en inglés no tienen ninguna, y se quedan.
//
//    CASO DUDOSO, la cita en español adentro del plan (`Let's let the user
//    know kindly: "Che, parece que se desconectó…"`): se borra, porque en el
//    corpus el modelo escribe la misma respuesta de nuevo al final y dejar las
//    dos la duplica. PERO si al borrar no queda nada en español y esa cita
//    ocupaba líneas propias, se rescata: ahí el borrador ERA la respuesta
//    ("Let's answer directly and in Spanish:\n**No, ahora mismo no la veo.**…").
//    La cita en la misma línea ("Remember the rule: compilar es control de
//    calidad…") no se rescata nunca: es el modelo recitando el prompt.
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
  soloCita: boolean
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
// menos una en lo que se va a borrar, no se borra nada.
const MARCA_PLAN =
  /\b(?:let's|let me|let us|i'll|i will|i need|we need|i should|we should|i'm going to|we'll|we will|the user|remember the rule|our rules|the rules|wait|now i|okay,? so|the (?:\w+ )?tool)\b/i

// Red de seguridad: si un segmento parece código, no se borra aunque cuente como inglés.
const PARECE_CODIGO =
  /[;{}]|\/\/|\/\*|#\s*(?:include|define)\b|\b[A-Za-z_]\w*\s*(?:[=!<>]=|=(?!=))\s*[\w"'(-]|\b[a-z_]\w*[A-Z]\w*\(|\b(?:digitalWrite|digitalRead|analogWrite|analogRead|pinMode|delay|millis|Serial\.\w+)\s*\(/

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
  const inline = codigoInline(t, bloques)
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
      soloCita: false,
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
      seg.protegido = PARECE_CODIGO.test(afuera) || /^\s*[|>]/.test(lineaTexto)
      seg.marca = MARCA_PLAN.test(afuera.replace(/’/g, "'"))
      const c = contar(afuera)
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
        // Una marca de plan sin nada de español ("Ah, wait!") es inglés.
        if (seg.propio === "neutro" && seg.marca && c.es === 0) seg.propio = "en"
      }
    }
    segs.push(seg)
    linea += (texto.match(/\n/g) ?? []).length
    cursor = r.fin
  }
  return segs
}

/** Segmenta y decide qué se borra. Exportado para los tests y la evaluación del corpus. */
export function analizar(original: string): Segmento[] {
  const t = original.replace(/\r\n?/g, "\n")
  const segs = segmentar(t)
  const textos = segs.filter((s) => s.tipo === "texto")

  // Paso 3a: los dos puntos de una entrada del PLAN ceden la voz.
  let cesion: { modo: "linea" | "bloque"; linea: number; parrafo: number; parrafoCitado: number } | null = null
  for (const s of textos) {
    if (cesion) {
      const sigue =
        cesion.modo === "linea"
          ? s.linea === cesion.linea
          : s.linea > cesion.linea &&
            (cesion.parrafoCitado >= 0 ? s.parrafo === cesion.parrafoCitado : s.parrafo <= cesion.parrafo + 1)
      if (!sigue || s.propio === "en") {
        cesion = null
      } else {
        s.dueno = "en"
        s.citado = true
        s.citaEnBloque = cesion.modo === "bloque"
        if (cesion.parrafoCitado < 0) cesion.parrafoCitado = s.parrafo
        continue
      }
    }
    s.dueno = s.propio
    if (s.dosPuntos && s.dueno === "en" && s.marca) {
      cesion = { modo: s.finDeLinea ? "bloque" : "linea", linea: s.linea, parrafo: s.parrafo, parrafoCitado: -1 }
    }
  }

  // Paso 3b: los neutros heredan del vecino del mismo párrafo. Dos pasadas
  // lineales: primero el anterior; si no hay, el siguiente, salvo que sea
  // inglés en la MISMA línea ("Perfecto. The board is ready…": "Perfecto." no
  // se vuelve inglés por lo que viene después).
  const conSenal = (x: Segmento) => x.dueno !== "neutro" && !x.citado
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

  // Paso 4: sólo el inglés ANTES del primer español del texto, y nunca lo protegido.
  const primerEs = textos.findIndex((s) => s.dueno === "es")
  const candidatos = (primerEs < 0 ? textos : textos.slice(0, primerEs)).filter((s) => s.dueno === "en" && !s.protegido)
  // Sin ninguna marca de plan en lo que se borraría, no se borra nada.
  if (!candidatos.some((s) => s.marca)) return segs
  for (const s of candidatos) s.quitado = true

  // Rescate del borrador en español con líneas propias, si no queda otra cosa en español.
  const quedaEspanol = textos.some((s) => !s.quitado && s.propio === "es")
  if (!quedaEspanol) {
    const rescatables = textos.filter((s) => s.quitado && s.citado && s.citaEnBloque && s.propio !== "en")
    if (rescatables.some((s) => s.propio === "es")) for (const s of rescatables) s.quitado = false
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
export function limpiar(original: string): Resultado {
  const igual: Resultado = { texto: original, cambio: false, quitados: [] }
  if (typeof original !== "string" || !original.trim() || original.length > MAX_TEXTO) return igual
  const t = original.replace(/\r\n?/g, "\n")
  const segs = analizar(t)
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
        // Se conserva la sangría de la línea siguiente (una lista anidada sigue anidada).
        const sangria = tramo.match(/[ \t]*$/)?.[0] ?? ""
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
