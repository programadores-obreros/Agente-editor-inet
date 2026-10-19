// ============================================================================
// Tecnia Bot — detector de "planificación en inglés" en lo que escribe el modelo.
//
// POR QUÉ EXISTE. Con Gemini 3.5 Flash Lite en OpenCode 1.18.18, en charlas
// largas y casi siempre después de que una herramienta da error, el modelo deja
// de razonar aparte (0 tokens de reasoning) y escribe su plan COMO TEXTO
// VISIBLE, en inglés: "The tool reported: ... Let's communicate this clearly
// and warmly, following our rules: ...". En una charla real filtraron 21 de 31
// textos y el docente tuvo que pedir "en español, si?". El prompt ya dice
// "Hablás siempre en español" y aun así pasa: es intermitente, y una vez que
// la fuga queda en el historial el modelo la imita. No alcanza con el prompt.
//
// Este archivo es PURO (sin OpenCode, sin I/O): recibe un texto y devuelve el
// mismo texto sin los pedazos que son planificación en inglés. Lo usa el plugin
// tecnia-idioma.ts y lo prueban los tests de tests/idioma-detector.test.mjs.
//
// Vive en una SUBCARPETA a propósito: OpenCode carga como plugin todo
// `plugins/*.{ts,js}` del config (config/plugin.ts, glob sin `**`). Si este
// archivo estuviera al lado de tecnia-idioma.ts, OpenCode lo intentaría cargar
// como plugin y fallaría por no tener `server`.
//
// CÓMO DECIDE, en cuatro pasos:
//
// 1. Corta el texto en SEGMENTOS: cada línea, y dentro de la línea cada oración
//    (". ", "! ", "? ", ": "). También corta cuando el modelo pega el plan con
//    la respuesta sin espacio ("Let's write out the response.Che, la placa…"):
//    un punto seguido de mayúscula o de ¡/¿. Los bloques ``` y el código
//    `inline` NUNCA se cortan, nunca se cuentan y nunca se borran. Las citas
//    ("…", “…”, «…») tampoco se cortan: van enteras con su oración.
//
// 2. Cada segmento cuenta PALABRAS FUNCIONALES (the/and/is/let's frente a
//    el/que/de/para) fuera del código y fuera de las citas. Los términos
//    técnicos ("LED", "WiFi", "upload_port", "Access Point", "web server",
//    "Error 2") no son palabras funcionales: no suman para ningún lado, así que
//    no vuelven inglés a un párrafo en español. El umbral es conservador: hacen
//    falta 2 o más funcionales inglesas Y más del doble que las españolas. Con
//    menos señal el segmento queda "neutro".
//
// 3. Los DOS PUNTOS ceden la voz. Lo que viene después de "Let's tell the
//    user:" es del plan aunque esté en español (es un borrador o la salida de
//    una herramienta que el modelo copia), y lo que viene después de "Te tiró
//    este error:" es de la respuesta aunque esté en inglés (es el error que se
//    le muestra al docente). La cesión dura hasta el fin de la línea si los dos
//    puntos están en el medio, o el párrafo siguiente si cierran la línea, y se
//    corta apenas aparece un segmento del idioma del que cedió la voz.
//    Los neutros toman el idioma del vecino más cercano del mismo párrafo; un
//    párrafo sin ninguna señal se deja como está.
//
// 4. Se borran los segmentos cuyo dueño es el inglés, salvo los que vienen
//    después de español en el mismo párrafo (el plan va antes de la respuesta,
//    nunca después: lo de después es algo que la respuesta muestra).
//
//    CASO DUDOSO, la cita en español adentro del plan (`Let's let the user
//    know kindly: "Che, parece que se desconectó…"`): se borra, porque en el corpus real el modelo
//    escribe la misma respuesta de nuevo al final, y dejar las dos la duplica.
//    PERO si al borrar no queda nada en español y esa cita ocupaba líneas
//    propias, se rescata: ahí el borrador ERA la respuesta (pasó así: "Let's
//    answer directly and in Spanish:\n**No, ahora mismo no la veo.**…"). La
//    cita pegada en la misma línea ("Remember the rule: compilar es control de
//    calidad…") no se rescata nunca: es el modelo recitando el prompt.
//
// Ante la duda NO se borra: un segmento con alguna palabra funcional española
// y pocas inglesas cuenta como español, y si nada se borra el texto vuelve
// idéntico, byte por byte.
// ============================================================================

export type Idioma = "en" | "es" | "neutro"

export interface Segmento {
  /** Texto original del segmento (con su código y sus citas). */
  texto: string
  inicio: number
  fin: number
  /** "codigo" = bloque ```; se conserva siempre. */
  tipo: "texto" | "codigo"
  /** Idioma por sus propias palabras funcionales. */
  propio: Idioma
  /** Idioma de quien "habla" en el segmento, después de los dos puntos y los vecinos. */
  dueno: Idioma
  /** true si el segmento se saca del texto. */
  quitado: boolean
  /** true si la voz se la cedió unos dos puntos anteriores. */
  citado: boolean
  // ---- internos ----
  linea: number
  parrafo: number
  finDeLinea: boolean
  dosPuntos: boolean
  citaEnBloque: boolean
  soloCita: boolean
}

export interface Resultado {
  /** El texto limpio. Si `cambio` es false, es el original sin tocar. */
  texto: string
  cambio: boolean
  /** Los pedazos que se sacaron, para el log. */
  quitados: string[]
}

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
    "probá usá mirá decime contame"
  ).split(" "),
)

const CIERRE_CITA: Record<string, string> = { '"': '"', "“": "”", "«": "»" }
const MAX_CITA = 2000

interface Rango {
  ini: number
  fin: number
}

/** Bloques ``` (o ~~~) completos, hasta la valla que cierra o el final del texto. */
function bloquesDeCodigo(t: string): Rango[] {
  const out: Rango[] = []
  const re = /^[ \t]{0,3}(`{3,}|~{3,})/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const valla = m[1]!
    const ini = m.index
    const finLinea = t.indexOf("\n", ini)
    if (finLinea < 0) {
      out.push({ ini, fin: t.length })
      break
    }
    const cierre = new RegExp(`^[ \\t]{0,3}${valla[0] === "`" ? "`" : "~"}{${valla.length},}[ \\t]*$`, "gm")
    cierre.lastIndex = finLinea + 1
    const c = cierre.exec(t)
    const fin = c ? c.index + c[0].length : t.length
    out.push({ ini, fin })
    re.lastIndex = fin
  }
  return out
}

/** Código `inline` (una sola línea), fuera de los bloques. */
function codigoInline(t: string, bloques: Rango[]): Rango[] {
  const out: Rango[] = []
  const re = /`[^`\n]+`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const ini = m.index
    if (bloques.some((b) => ini >= b.ini && ini < b.fin)) continue
    out.push({ ini, fin: ini + m[0].length })
  }
  return out
}

/** Citas "…", “…” y «…» fuera del código. Pueden cruzar líneas (un borrador de dos párrafos). */
function citas(t: string, bloques: Rango[], inline: Rango[]): Rango[] {
  const out: Rango[] = []
  const saltar = (i: number) => {
    for (const r of inline) if (i >= r.ini && i < r.fin) return r.fin
    for (const r of bloques) if (i >= r.ini && i < r.fin) return -1
    return i
  }
  let i = 0
  while (i < t.length) {
    const s = saltar(i)
    if (s === -1) {
      i = bloques.find((b) => i >= b.ini && i < b.fin)!.fin
      continue
    }
    if (s !== i) {
      i = s
      continue
    }
    const cierre = CIERRE_CITA[t[i]!]
    if (cierre) {
      let j = i + 1
      let fin = -1
      while (j < t.length && j - i <= MAX_CITA) {
        const sj = saltar(j)
        if (sj === -1) break // una cita no cruza un bloque de código
        if (sj !== j) {
          j = sj
          continue
        }
        if (t[j] === cierre) {
          fin = j + 1
          break
        }
        j++
      }
      if (fin > 0) {
        out.push({ ini: i, fin })
        i = fin
        continue
      }
    }
    i++
  }
  return out
}

function contar(texto: string): { en: number; es: number; palabras: number } {
  const tokens = texto.toLowerCase().replace(/[’`]/g, "'").match(/\p{L}+(?:'\p{L}+)*/gu) ?? []
  let en = 0
  let es = 0
  for (const tok of tokens) {
    if (EN.has(tok)) en++
    else if (ES.has(tok)) es++
  }
  // ¡ y ¿ sólo existen en español: cada uno vale una palabra funcional.
  es += (texto.match(/[¡¿]/g) ?? []).length
  return { en, es, palabras: tokens.length }
}

function idiomaDe(en: number, es: number): Idioma {
  if (en >= 2 && en > 2 * es) return "en"
  if (es >= 1) return "es"
  return "neutro"
}

/** Corta el texto en segmentos y les asigna idioma propio. */
function segmentar(t: string): Segmento[] {
  const bloques = bloquesDeCodigo(t)
  const inline = codigoInline(t, bloques)
  const cits = citas(t, bloques, inline)
  // Para recorrer en O(n): en cada índice, dónde termina el rango atómico que empieza ahí.
  const atomo = new Map<number, number>()
  for (const r of [...inline, ...cits]) atomo.set(r.ini, r.fin)
  const bloqueEn = new Map<number, number>()
  for (const b of bloques) bloqueEn.set(b.ini, b.fin)

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
    const fb = bloqueEn.get(i)
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
    const fa = atomo.get(i)
    if (fa !== undefined) {
      // Una cita que termina en .!? y sigue un espacio cierra la oración.
      const ultimo = t[fa - 2]
      i = fa
      if (ultimo && /[.!?…]/.test(ultimo) && cits.some((r) => r.fin === fa) && (i >= t.length || /\s/.test(t[i]!))) {
        cerrar(i)
      }
      continue
    }
    if (/[.!?…:]/.test(c)) {
      let j = i
      while (j < t.length && /[.!?…:]/.test(t[j]!)) j++
      const corrida = t.slice(i, j)
      const sig = t[j]
      const previo = t[i - 1] ?? ""
      const finOEspacio = sig === undefined || /\s/.test(sig)
      // "1." de una lista, "2.0", "192.168.4.1": un punto después de un dígito no cierra oración.
      const trasDigito = /\d/.test(previo) && corrida === "."
      let corta = false
      if (!trasDigito) {
        if (finOEspacio) corta = true
        // Pegado: "response.Che", "flash it!¡Sí!". Los dos puntos pegados no cortan (http://).
        else if (!corrida.includes(":") && /[¡¿\p{Lu}]/u.test(sig!)) corta = true
      }
      i = j
      if (corta) cerrar(i)
      continue
    }
    i++
  }
  cerrar(t.length)

  // Línea y párrafo de cada segmento.
  const segs: Segmento[] = []
  let parrafo = 0
  let linea = 0
  let cursor = 0
  for (const [k, r] of crudos.entries()) {
    const hueco = t.slice(cursor, r.ini)
    linea += (hueco.match(/\n/g) ?? []).length
    if (k > 0 && /\n[ \t]*\n/.test(hueco)) parrafo++
    const texto = t.slice(r.ini, r.fin)
    const resto = t.slice(r.fin, (t.indexOf("\n", r.fin) + 1 || t.length + 1) - 1)
    const seg: Segmento = {
      texto,
      inicio: r.ini,
      fin: r.fin,
      tipo: r.tipo,
      propio: "neutro",
      dueno: "neutro",
      quitado: false,
      citado: false,
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
      const dentro = (x: number) => inline.find((q) => x === q.ini) ?? cits.find((q) => x === q.ini)
      while (p < r.fin) {
        const q = dentro(p)
        if (q) {
          if (cits.includes(q)) adentro += " " + t.slice(q.ini + 1, q.fin - 1).replace(/`[^`\n]+`/g, " ") + " "
          afuera += " "
          p = q.fin
          continue
        }
        afuera += t[p]
        p++
      }
      const a = contar(afuera)
      if (a.palabras === 0 && adentro.trim()) {
        const b = contar(adentro)
        seg.soloCita = true
        seg.propio = idiomaDe(b.en, b.es)
      } else {
        seg.propio = idiomaDe(a.en, a.es)
        // Una entrada que cede la voz ("The tool reported:", "Remember the rule:",
        // "Let's ask a concrete question:") es corta: con UNA funcional inglesa y
        // ninguna española alcanza. "Solución:" o "Access Point:" no tienen
        // ninguna y siguen neutras.
        if (seg.propio === "neutro" && seg.dosPuntos && a.en >= 1 && a.es === 0) seg.propio = "en"
      }
    }
    segs.push(seg)
    linea += (texto.match(/\n/g) ?? []).length
    cursor = r.fin
  }
  return segs
}

/** Segmenta y decide qué se borra. Exportado para los tests y la evaluación del corpus. */
export function analizar(t: string): Segmento[] {
  const segs = segmentar(t)
  const textos = segs.filter((s) => s.tipo === "texto")

  // Paso 3a: los dos puntos ceden la voz.
  let cesion: { idioma: Idioma; modo: "linea" | "bloque"; linea: number; parrafo: number; parrafoCitado: number } | null =
    null
  for (const s of textos) {
    if (cesion) {
      const sigue =
        cesion.modo === "linea"
          ? s.linea === cesion.linea
          : s.linea > cesion.linea &&
            (cesion.parrafoCitado >= 0 ? s.parrafo === cesion.parrafoCitado : s.parrafo <= cesion.parrafo + 1)
      if (!sigue || s.propio === cesion.idioma) {
        cesion = null
      } else {
        s.dueno = cesion.idioma
        s.citado = true
        s.citaEnBloque = cesion.modo === "bloque"
        if (cesion.parrafoCitado < 0) cesion.parrafoCitado = s.parrafo
        continue
      }
    }
    s.dueno = s.propio
    if (s.dosPuntos && s.dueno !== "neutro") {
      cesion = {
        idioma: s.dueno,
        modo: s.finDeLinea ? "bloque" : "linea",
        linea: s.linea,
        parrafo: s.parrafo,
        parrafoCitado: -1,
      }
    }
  }

  // Paso 3b: los neutros toman el idioma del vecino más cercano del mismo párrafo
  // (primero en la misma línea). Sin vecinos con señal, se quedan: no se borran.
  const conSenal = (x: Segmento) => x.tipo === "texto" && x.dueno !== "neutro" && !x.citado
  const resueltos = textos.map((s, k) => {
    if (s.dueno !== "neutro" || s.citado) return s.dueno
    const mismo = (x: Segmento) => x.parrafo === s.parrafo
    const antes = textos.slice(0, k).reverse().filter(mismo)
    const despues = textos.slice(k + 1).filter(mismo)
    const v =
      antes.find((x) => x.linea === s.linea && conSenal(x)) ??
      despues.find((x) => x.linea === s.linea && conSenal(x)) ??
      antes.find(conSenal) ??
      despues.find(conSenal)
    return v ? v.dueno : "neutro"
  })
  textos.forEach((s, k) => (s.dueno = resueltos[k]!))

  // Adentro de un párrafo, sólo se saca el inglés que va ANTES del primer
  // español. En los 61 textos del corpus real el plan siempre precede a la
  // respuesta ("...following our rules.Che, la placa..."), nunca la sigue. El
  // inglés que viene DESPUÉS de español en el mismo párrafo es algo que la
  // respuesta muestra o explica ("Te aparece esto\nthe port is busy",
  // "le decimos protoboard. The breadboard is the same thing."): se queda.
  const esEspanol = (x: Segmento) => x.dueno === "es"
  for (const [k, s] of textos.entries()) {
    if (s.dueno !== "en") continue
    s.quitado = !textos.slice(0, k).some((x) => x.parrafo === s.parrafo && esEspanol(x))
  }

  // Paso 4: rescate del borrador en español con líneas propias, si no queda otra cosa en español.
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
 * Si no hay nada que sacar devuelve el MISMO texto (cambio=false).
 * Si se saca todo, devuelve "" (OpenCode no muestra partes de texto vacías).
 */
export function limpiar(t: string): Resultado {
  if (!t || !t.trim()) return { texto: t, cambio: false, quitados: [] }
  const segs = analizar(t)
  const quitados = segs.filter((s) => s.quitado)
  if (quitados.length === 0) return { texto: t, cambio: false, quitados: [] }

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
