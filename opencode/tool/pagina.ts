/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Páginas con diseño: el modelo pasa el CONTENIDO en bloques y esta tool pone el HTML.
//
// POR QUÉ EXISTE. El bot no escribe HTML (el agente tiene denegado editar y escribir
// .html). Hasta acá las únicas páginas que podía producir eran las de `imprimible` y
// `circuito`, cada una con su CSS adentro. Cuando un docente pedía «armame una guía» o
// «pasame esto en limpio», no había con qué. Esta tool es ese camino, y usa la hoja de
// estilos compartida (`tecniabot-web/diseno/sistema.css`) en vez de traer una tercera.
//
// TRES PARTES, EN ESTE ORDEN:
//   1. `validarPagina`    — pura. Junta TODOS los errores y dice cómo corregir cada uno.
//   2. `renderizarPagina` — pura. Datos ya validados + CSS → un HTML autocontenido.
//   3. la tool            — lee el CSS, escribe, RELEE lo escrito y recién ahí informa.
//
// LO QUE NO SE NEGOCIA:
//   - Con un solo error de validación no se escribe nada.
//   - Todo texto que viene del modelo pasa por `esc`, y nunca va a un atributo ni a un id.
//   - Sin la hoja de estilos no hay página: no se escribe una sin diseño.
//   - Nunca se afirma que el navegador mostró algo. Se pidió, o falló el pedido.
//
// Autocontenida a propósito: los tools de este repo no se importan entre sí. `comoUrl`
// es la misma de `imprimible.ts`/`ficha.ts`/`ayuda.ts`/`circuito.ts`, y el pedido al
// navegador sigue el criterio de `vista-fisica.ts::abrirEnNavegador`.

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Validación
// ════════════════════════════════════════════════════════════════════════════════════

export const TIPOS = ["seccion", "texto", "lista", "pasos", "tabla", "codigo", "aviso", "plegable"] as const
export const SEVERIDADES = ["info", "ok", "aviso", "error"] as const
export const TEMAS = ["claro", "oscuro"] as const

export type Tipo = (typeof TIPOS)[number]
export type Severidad = (typeof SEVERIDADES)[number]
export type Tema = (typeof TEMAS)[number]

/** Los topes, en un solo lugar: los usan la validación, las descripciones y los tests. */
export const LIMITES = {
  tituloMin: 3,
  tituloMax: 120,
  resumenMax: 600,
  placaMax: 60,
  bloquesMax: 40,
  seccionesMax: 8,
  tituloDeBloqueMax: 120,
  textoMax: 2000,
  codigoMax: 20000,
  itemsMax: 40,
  itemMax: 300,
  columnasMin: 2,
  columnasMax: 6,
  filasMax: 60,
  celdaMax: 200,
} as const

const CAMPOS = ["titulo", "texto", "items", "columnas", "filas", "severidad"] as const
type Campo = (typeof CAMPOS)[number]

/**
 * Qué campos EXIGE y cuáles ADMITE cada tipo. Un campo que no está en ninguna de las dos
 * listas es un error: si el modelo mandó `items` en un bloque «texto», quiso decir algo
 * que la página no iba a mostrar, y descartarlo en silencio es perder contenido.
 */
const USO: Record<Tipo, { exige: readonly Campo[]; admite: readonly Campo[] }> = {
  seccion: { exige: ["titulo"], admite: ["texto"] },
  texto: { exige: ["texto"], admite: ["titulo"] },
  lista: { exige: ["items"], admite: ["titulo"] },
  pasos: { exige: ["items"], admite: ["titulo"] },
  tabla: { exige: ["columnas", "filas"], admite: ["titulo"] },
  codigo: { exige: ["texto"], admite: ["titulo"] },
  aviso: { exige: ["texto", "severidad"], admite: ["titulo"] },
  plegable: { exige: ["titulo"], admite: ["texto", "items"] },
}

/** Cómo pedir cada campo cuando falta, por tipo. */
const COMO_PASARLO: Record<Campo, string> = {
  titulo: "Pasá `titulo` con un texto corto.",
  texto: "Pasá `texto` con el contenido.",
  items: "Pasá `items` con un renglón por elemento.",
  columnas: "Pasá `columnas` con los encabezados (de 2 a 6).",
  filas: "Pasá `filas`: una lista por fila, con una celda por columna.",
  severidad: 'Pasá `severidad`: "info", "ok", "aviso" o "error".',
}

export type Bloque = {
  tipo: Tipo
  titulo?: string
  texto?: string
  items?: string[]
  columnas?: string[]
  filas?: string[][]
  severidad?: Severidad
}

export type Pagina = {
  titulo: string
  resumen?: string
  placa?: string
  tema: Tema
  bloques: Bloque[]
}

export type Validacion = { ok: true; pagina: Pagina; abrir: boolean } | { ok: false; errores: string[] }

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

/**
 * «No vino»: ausente, null, un texto en blanco o una lista vacía. Los modelos chicos
 * rellenan los opcionales con "" y []: tratarlos como ausentes no descarta nada, porque
 * no traen nada. Un campo CON contenido que el tipo no usa sí es error.
 */
function noVino(x: unknown): boolean {
  return x === undefined || x === null || (typeof x === "string" && x.trim() === "") || (Array.isArray(x) && x.length === 0)
}

/** Saca los caracteres de control que no son salto de línea ni tabulación, y unifica los saltos. */
function limpiar(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

const comillas = (x: unknown): string => {
  const texto = typeof x === "string" ? x : JSON.stringify(x) ?? String(x)
  return `«${texto.length > 40 ? texto.slice(0, 40) + "…" : texto}»`
}

/**
 * Valida los argumentos de la tool. PURA: no lee ni escribe nada.
 *
 * No corta en el primer error: un modelo que recibe un error por vez necesita una
 * llamada por error, y con seis errores abandona. Cada mensaje nombra el lugar
 * (`bloques[3]`), dice qué está mal con los números a la vista y cómo se corrige.
 */
export function validarPagina(args: unknown): Validacion {
  const errores: string[] = []
  if (!esObjeto(args)) {
    return { ok: false, errores: ["Los argumentos tienen que ser un objeto con `titulo` y `bloques`."] }
  }

  /** Un texto de la raíz: devuelve el valor limpio, o undefined si no vino o está mal. */
  const textoDeRaiz = (campo: "titulo" | "resumen" | "placa", maximo: number): string | undefined => {
    const valor = args[campo]
    if (noVino(valor)) return undefined
    if (typeof valor !== "string") {
      errores.push(`\`${campo}\`: tiene que ser un texto. Pasalo entre comillas.`)
      return undefined
    }
    const limpio = limpiar(valor).trim()
    if (limpio.length > maximo) {
      errores.push(`\`${campo}\`: tiene ${limpio.length} caracteres y el máximo es ${maximo}. Acortalo.`)
      return undefined
    }
    return limpio
  }

  let titulo = ""
  if (noVino(args.titulo)) {
    errores.push(`\`titulo\`: falta. Pasá el título de la página, de ${LIMITES.tituloMin} a ${LIMITES.tituloMax} caracteres.`)
  } else {
    const leido = textoDeRaiz("titulo", LIMITES.tituloMax)
    if (leido !== undefined) {
      if (leido.length < LIMITES.tituloMin) {
        errores.push(`\`titulo\`: tiene ${leido.length} caracteres y el mínimo es ${LIMITES.tituloMin}. Poné un título que diga de qué es la página.`)
      } else titulo = leido
    }
  }
  const resumen = textoDeRaiz("resumen", LIMITES.resumenMax)
  const placa = textoDeRaiz("placa", LIMITES.placaMax)

  let tema: Tema = "claro"
  if (!noVino(args.tema)) {
    if ((TEMAS as readonly unknown[]).includes(args.tema)) tema = args.tema as Tema
    else errores.push(`\`tema\`: ${comillas(args.tema)} no existe. Usá "claro" u "oscuro", o no lo pases.`)
  }

  let abrir = false
  if (args.abrir !== undefined && args.abrir !== null) {
    if (typeof args.abrir === "boolean") abrir = args.abrir
    else errores.push("`abrir`: tiene que ser true o false, sin comillas.")
  }

  const bloques: Bloque[] = []
  const crudos = args.bloques
  if (!Array.isArray(crudos) || crudos.length === 0) {
    errores.push('`bloques`: falta. Pasá de 1 a 40 bloques; el más simple es {"tipo":"texto","texto":"…"}.')
  } else {
    if (crudos.length > LIMITES.bloquesMax) {
      errores.push(`\`bloques\`: hay ${crudos.length} y el máximo es ${LIMITES.bloquesMax}. Juntá contenido en menos bloques o armá dos páginas.`)
    }
    crudos.forEach((crudo, i) => {
      const bloque = validarBloque(crudo, i, errores)
      if (bloque) bloques.push(bloque)
    })
    const secciones = crudos.filter((b) => esObjeto(b) && b.tipo === "seccion").length
    if (secciones > LIMITES.seccionesMax) {
      errores.push(`\`bloques\`: hay ${secciones} secciones y el máximo es ${LIMITES.seccionesMax}. Juntá secciones o armá dos páginas.`)
    }
  }

  if (errores.length > 0) return { ok: false, errores }
  const pagina: Pagina = { titulo, tema, bloques }
  if (resumen !== undefined) pagina.resumen = resumen
  if (placa !== undefined) pagina.placa = placa
  return { ok: true, pagina, abrir }
}

function validarBloque(crudo: unknown, i: number, errores: string[]): Bloque | null {
  const antes = errores.length
  if (!esObjeto(crudo)) {
    errores.push(`\`bloques[${i}]\`: tiene que ser un objeto con \`tipo\`. Ejemplo: {"tipo":"texto","texto":"…"}.`)
    return null
  }
  if (!(TIPOS as readonly unknown[]).includes(crudo.tipo)) {
    const dicho = noVino(crudo.tipo) ? "falta `tipo`" : `el tipo ${comillas(crudo.tipo)} no existe`
    errores.push(`\`bloques[${i}]\`: ${dicho}. Usá uno de: ${TIPOS.join(", ")}.`)
    return null
  }
  const tipo = crudo.tipo as Tipo
  const donde = `\`bloques[${i}]\` (${tipo})`
  const { exige, admite } = USO[tipo]

  for (const clave of Object.keys(crudo)) {
    if (clave === "tipo" || (CAMPOS as readonly string[]).includes(clave)) continue
    errores.push(`${donde}: \`${clave}\` no es un campo de esta tool. Los campos de un bloque son: tipo, ${CAMPOS.join(", ")}.`)
  }
  for (const campo of CAMPOS) {
    const vino = !noVino(crudo[campo])
    if (exige.includes(campo) && !vino) errores.push(`${donde}: falta \`${campo}\`. ${COMO_PASARLO[campo]}`)
    if (vino && !exige.includes(campo) && !admite.includes(campo)) {
      errores.push(`${donde}: \`${campo}\` no se usa en un bloque «${tipo}» (usa: ${[...exige, ...admite].join(", ")}). Sacalo, o ponelo en otro bloque que sí lo use.`)
    }
  }
  if (tipo === "plegable" && noVino(crudo.texto) && noVino(crudo.items)) {
    errores.push(`${donde}: falta el contenido. Pasá \`texto\`, \`items\`, o los dos.`)
  }

  const usa = (campo: Campo): boolean => (exige.includes(campo) || admite.includes(campo)) && !noVino(crudo[campo])
  const bloque: Bloque = { tipo }

  const texto = (campo: "titulo" | "texto", maximo: number): string | undefined => {
    const valor = crudo[campo]
    if (typeof valor !== "string") {
      errores.push(`${donde}: \`${campo}\` tiene que ser un texto. Pasalo entre comillas.`)
      return undefined
    }
    const limpio = campo === "texto" && tipo === "codigo" ? limpiar(valor).replace(/^\n+|\s+$/g, "") : limpiar(valor).trim()
    if (limpio.length > maximo) {
      errores.push(`${donde}: \`${campo}\` tiene ${limpio.length} caracteres y el máximo es ${maximo}. Acortalo o repartilo en más bloques.`)
      return undefined
    }
    return limpio
  }

  /** Una lista de textos: cada uno con contenido y hasta `largo` caracteres. */
  const textos = (valor: unknown, nombre: string, cuantosMax: number, largo: number, admiteVacios: boolean): string[] | undefined => {
    if (!Array.isArray(valor)) {
      errores.push(`${donde}: ${nombre} tiene que ser una lista de textos, por ejemplo ["uno","dos"].`)
      return undefined
    }
    if (valor.length > cuantosMax) {
      errores.push(`${donde}: ${nombre} tiene ${valor.length} elementos y el máximo es ${cuantosMax}. Repartilos en más bloques.`)
    }
    const salida: string[] = []
    valor.forEach((elemento, n) => {
      if (typeof elemento !== "string") {
        errores.push(`${donde}: el elemento ${n + 1} de ${nombre} tiene que ser un texto. Pasalo entre comillas.`)
        return
      }
      const limpio = limpiar(elemento).trim()
      if (!admiteVacios && limpio === "") {
        errores.push(`${donde}: el elemento ${n + 1} de ${nombre} está vacío. Sacalo o escribile algo.`)
      } else if (limpio.length > largo) {
        errores.push(`${donde}: el elemento ${n + 1} de ${nombre} tiene ${limpio.length} caracteres y el máximo es ${largo}. Acortalo.`)
      } else salida.push(limpio)
    })
    return salida
  }

  if (usa("titulo")) {
    const leido = texto("titulo", LIMITES.tituloDeBloqueMax)
    if (leido !== undefined) bloque.titulo = leido
  }
  if (usa("texto")) {
    const leido = texto("texto", tipo === "codigo" ? LIMITES.codigoMax : LIMITES.textoMax)
    if (leido !== undefined) bloque.texto = leido
  }
  if (usa("items")) {
    const leidos = textos(crudo.items, "`items`", LIMITES.itemsMax, LIMITES.itemMax, false)
    if (leidos !== undefined) bloque.items = leidos
  }
  if (usa("severidad")) {
    if ((SEVERIDADES as readonly unknown[]).includes(crudo.severidad)) bloque.severidad = crudo.severidad as Severidad
    else errores.push(`${donde}: la severidad ${comillas(crudo.severidad)} no existe. Usá "info", "ok", "aviso" o "error".`)
  }
  if (tipo === "tabla") {
    let columnas: string[] | undefined
    if (usa("columnas")) {
      if (Array.isArray(crudo.columnas) && (crudo.columnas.length < LIMITES.columnasMin || crudo.columnas.length > LIMITES.columnasMax)) {
        errores.push(`${donde}: hay ${crudo.columnas.length} columnas y tienen que ser de ${LIMITES.columnasMin} a ${LIMITES.columnasMax}. ${crudo.columnas.length < LIMITES.columnasMin ? "Para una sola columna usá un bloque «lista»." : "Partí la tabla en dos."}`)
      } else {
        columnas = textos(crudo.columnas, "`columnas`", LIMITES.columnasMax, LIMITES.celdaMax, false)
        if (columnas !== undefined) bloque.columnas = columnas
      }
    }
    if (usa("filas")) {
      const filas = crudo.filas
      if (!Array.isArray(filas)) {
        errores.push(`${donde}: \`filas\` tiene que ser una lista de filas, y cada fila una lista de textos. Ejemplo: [["LED","GPIO18"]].`)
      } else {
        if (filas.length > LIMITES.filasMax) {
          errores.push(`${donde}: hay ${filas.length} filas y el máximo es ${LIMITES.filasMax}. Partí la tabla en dos bloques.`)
        }
        const leidas: string[][] = []
        filas.forEach((fila, n) => {
          if (!Array.isArray(fila)) {
            errores.push(`${donde}: la fila ${n + 1} tiene que ser una lista de textos, una celda por columna.`)
            return
          }
          if (Array.isArray(crudo.columnas) && columnas !== undefined && fila.length !== crudo.columnas.length) {
            const c = crudo.columnas.length
            errores.push(`${donde}: la fila ${n + 1} tiene ${fila.length} ${fila.length === 1 ? "celda" : "celdas"} y hay ${c} columnas. Pasá ${c} celdas por fila.`)
            return
          }
          const celdas = textos(fila, `la fila ${n + 1}`, LIMITES.columnasMax, LIMITES.celdaMax, true)
          if (celdas !== undefined) leidas.push(celdas)
        })
        bloque.filas = leidas
      }
    }
  }
  return errores.length === antes ? bloque : null
}

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Render
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * LA ÚNICA puerta por la que un texto del modelo entra al HTML. Escapa los cinco
 * caracteres que pueden abrir una etiqueta, cerrar un atributo o empezar una entidad.
 * No hay una segunda función «para atributos»: ningún texto del modelo va a un atributo.
 */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export const GENERADOR = "tecnia-bot pagina"
/** La marca que distingue una página de esta tool de un archivo ajeno con el mismo nombre. */
export const MARCA_GENERADOR = `<meta name="generator" content="${GENERADOR}">`

/** Lo que dice la etiqueta de cada severidad: el aviso se LEE, no depende del color. */
export const ETIQUETAS: Record<Severidad, string> = {
  info: "Dato",
  ok: "Bien",
  aviso: "Atención",
  error: "Hay que corregir",
}

/**
 * El único script de la página, FIJO: no lleva ningún dato del modelo. La política de
 * seguridad de la página autoriza exactamente este texto por su hash, así que si un
 * escapado fallara y entrara un `<script>` ajeno, el navegador no lo corre.
 *
 * Qué hace: recuerda el tema elegido (si el navegador deja guardar; abierto desde el
 * disco a veces no deja, por eso el try/catch), imprime, y despliega los plegables
 * mientras se imprime para que el papel no pierda contenido.
 */
export const SCRIPT_PAGINA = `(function () {
  var raiz = document.documentElement
  var CLAVE = "tecnia-bot-tema"
  var botonTema = document.getElementById("boton-tema")
  var botonImprimir = document.getElementById("boton-imprimir")
  function poner(tema) {
    if (tema === "dark") raiz.setAttribute("data-theme", "dark")
    else raiz.removeAttribute("data-theme")
    if (botonTema) {
      botonTema.setAttribute("aria-pressed", tema === "dark" ? "true" : "false")
      botonTema.textContent = tema === "dark" ? "Modo claro" : "Modo oscuro"
    }
  }
  var guardado = null
  try { guardado = window.localStorage.getItem(CLAVE) } catch (e) { guardado = null }
  var actual = guardado === "dark" || guardado === "light" ? guardado : (raiz.getAttribute("data-theme") === "dark" ? "dark" : "light")
  poner(actual)
  if (botonTema) botonTema.addEventListener("click", function () {
    actual = actual === "dark" ? "light" : "dark"
    poner(actual)
    try { window.localStorage.setItem(CLAVE, actual) } catch (e) { /* sin permiso para guardar: vale sólo para esta vez */ }
  })
  if (botonImprimir) botonImprimir.addEventListener("click", function () { window.print() })
  var plegados = []
  window.addEventListener("beforeprint", function () {
    plegados = Array.prototype.slice.call(document.querySelectorAll("details:not([open])"))
    plegados.forEach(function (d) { d.setAttribute("open", "") })
  })
  window.addEventListener("afterprint", function () {
    plegados.forEach(function (d) { d.removeAttribute("open") })
    plegados = []
  })
})()`

/** El hash del script, como lo pide la política de seguridad: sha256 en base64. */
export function hashDelScript(script: string = SCRIPT_PAGINA): string {
  return createHash("sha256").update(script, "utf8").digest("base64")
}

/** El papel es de la página, no de la hoja compartida: otra página puede ir apaisada. */
const CSS_DE_PAPEL = "@page { size: A4 portrait; margin: 1.4cm; }"

const LOGO =
  '<svg class="tb-marca__logo" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"></rect><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"></path></svg>'

/** Párrafos: los separa una línea en blanco. Un salto simple se conserva adentro del párrafo. */
function parrafos(texto: string): string {
  return texto
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p class="tb-texto">${esc(p)}</p>`)
    .join("\n")
}

const subtitulo = (titulo: string | undefined): string => (titulo ? `<h3 class="tb-subtitulo">${esc(titulo)}</h3>\n` : "")
const renglones = (items: readonly string[]): string => items.map((item) => `<li>${esc(item)}</li>`).join("")

function renderizarBloque(b: Bloque): string {
  switch (b.tipo) {
    case "texto":
      return `<div class="tb-bloque">${subtitulo(b.titulo)}${parrafos(b.texto ?? "")}</div>`
    case "lista":
      return `<div class="tb-bloque">${subtitulo(b.titulo)}<ul class="tb-lista">${renglones(b.items ?? [])}</ul></div>`
    case "pasos":
      return `<div class="tb-bloque">${subtitulo(b.titulo)}<ol class="tb-lista tb-lista--numerada">${renglones(b.items ?? [])}</ol></div>`
    case "tabla": {
      const titulo = b.titulo ? `<caption>${esc(b.titulo)}</caption>` : ""
      const cabecera = (b.columnas ?? []).map((c) => `<th scope="col">${esc(c)}</th>`).join("")
      const cuerpo = (b.filas ?? []).map((fila) => `<tr>${fila.map((celda) => `<td>${esc(celda)}</td>`).join("")}</tr>`).join("\n")
      return `<div class="tb-tabla-marco"><table class="tb-tabla">${titulo}<thead><tr>${cabecera}</tr></thead>\n<tbody>${cuerpo}</tbody></table></div>`
    }
    case "codigo": {
      const rotulo = b.titulo ? `<div class="tb-codigo__rotulo">${esc(b.titulo)}</div>` : ""
      return `<div class="tb-codigo">${rotulo}<pre class="tb-codigo__texto"><code>${esc(b.texto ?? "")}</code></pre></div>`
    }
    case "aviso": {
      const severidad = b.severidad ?? "info"
      const titulo = b.titulo ? `<p class="tb-aviso__titulo">${esc(b.titulo)}</p>` : ""
      return `<div class="tb-aviso tb-aviso--${severidad}" role="note"><span class="tb-aviso__etiqueta">${ETIQUETAS[severidad]}</span><div class="tb-aviso__cuerpo">${titulo}${parrafos(b.texto ?? "")}</div></div>`
    }
    case "plegable": {
      const lista = b.items && b.items.length > 0 ? `<ul class="tb-lista">${renglones(b.items)}</ul>` : ""
      return `<details class="tb-plegable"><summary>${esc(b.titulo ?? "")}</summary><div class="tb-plegable__cuerpo">${b.texto ? parrafos(b.texto) : ""}${lista}</div></details>`
    }
    case "seccion":
      return ""
  }
}

type Tramo = { seccion: Bloque | null; numero: number; contenido: Bloque[] }

/** Agrupa los bloques: cada «seccion» abre un tramo y se lleva los que siguen. */
function tramosDe(bloques: readonly Bloque[]): Tramo[] {
  const tramos: Tramo[] = []
  let numero = 0
  for (const b of bloques) {
    if (b.tipo === "seccion") {
      numero++
      tramos.push({ seccion: b, numero, contenido: [] })
      continue
    }
    let ultimo = tramos[tramos.length - 1]
    if (!ultimo) {
      ultimo = { seccion: null, numero: 0, contenido: [] }
      tramos.push(ultimo)
    }
    ultimo.contenido.push(b)
  }
  return tramos
}

/** Cuántas secciones y cuántos bloques de contenido tiene la página (para contarlo sin mentir). */
export function contar(pagina: Pagina): { secciones: number; bloques: number } {
  const secciones = pagina.bloques.filter((b) => b.tipo === "seccion").length
  return { secciones, bloques: pagina.bloques.length - secciones }
}

/**
 * Arma la página. PURA: los mismos datos y el mismo CSS dan los mismos bytes.
 *
 * Recibe datos YA VALIDADOS (lo que devuelve `validarPagina`). Devuelve un HTML
 * autocontenido: el CSS va adentro, no pide nada a la red, funciona abierto desde el disco.
 *
 * Los ids salen del NÚMERO de la sección (`seccion-1`), nunca del título: un texto del
 * modelo no llega a ningún atributo. Por eso tampoco hay enlaces armados con sus datos:
 * una dirección escrita en el texto se ve como texto.
 */
export function renderizarPagina(pagina: Pagina, css: string): string {
  const tramos = tramosDe(pagina.bloques)
  const secciones = tramos.filter((t) => t.seccion !== null)

  const navegacion =
    secciones.length >= 2
      ? `<nav class="tb-nav" aria-label="Secciones"><ol class="tb-nav__lista">\n${secciones
          .map((t) => `<li><a class="tb-nav__enlace" href="#seccion-${t.numero}"><span class="tb-nav__numero" aria-hidden="true">${t.numero}</span>${esc(t.seccion?.titulo ?? "")}</a></li>`)
          .join("\n")}\n</ol></nav>`
      : ""

  const resumen = pagina.resumen
    ? `<section class="tb-tarjeta tb-resumen" aria-labelledby="t-resumen"><h2 class="tb-rotulo" id="t-resumen">En resumen</h2>\n${parrafos(pagina.resumen)}</section>`
    : ""

  const tarjetas = tramos
    .map((t) => {
      const contenido = t.contenido.map(renderizarBloque).join("\n")
      if (t.seccion === null) return `<section class="tb-tarjeta">\n${contenido}\n</section>`
      const bajada = t.seccion.texto ? `<p class="tb-paso__bajada">${esc(t.seccion.texto)}</p>` : ""
      const cabecera = `<div class="tb-paso"><span class="tb-paso__numero" aria-hidden="true">${t.numero}</span><div class="tb-paso__textos"><h2 class="tb-paso__titulo" id="t-seccion-${t.numero}">${esc(t.seccion.titulo ?? "")}</h2>${bajada}</div></div>`
      return `<section class="tb-tarjeta" id="seccion-${t.numero}" aria-labelledby="t-seccion-${t.numero}">\n${cabecera}\n${contenido}\n</section>`
    })
    .join("\n")

  const placa = pagina.placa ? `<span class="tb-chip">${esc(pagina.placa)}</span>` : ""
  const politica = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hashDelScript()}'`

  return `<!doctype html>
<html lang="es"${pagina.tema === "oscuro" ? ' data-theme="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${politica}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${MARCA_GENERADOR}
<title>${esc(pagina.titulo)} — Tecnia Bot</title>
<style>
${css}
</style>
<style>${CSS_DE_PAPEL}</style>
</head>
<body class="tb-lectura">
<header class="tb-header"><div class="tb-header__fila">
<div class="tb-marca">${LOGO}<div class="tb-marca__textos"><span class="tb-marca__nombre">Tecnia Bot</span><h1 class="tb-marca__titulo">${esc(pagina.titulo)}</h1></div></div>
<div class="tb-acciones">${placa}<button type="button" class="tb-boton" id="boton-tema" aria-pressed="${pagina.tema === "oscuro" ? "true" : "false"}">${pagina.tema === "oscuro" ? "Modo claro" : "Modo oscuro"}</button><button type="button" class="tb-boton" id="boton-imprimir">Imprimir / PDF</button></div>
</div></header>
${navegacion}
<main class="tb-pagina">
${resumen}
${tarjetas}
</main>
<footer class="tb-pie">Armada con Tecnia Bot, un asistente con IA, para escuelas técnicas. Antes de conectar nada, compará pines y conexiones con el circuito del proyecto.</footer>
<script>${SCRIPT_PAGINA}</script>
</body>
</html>
`
}

// ════════════════════════════════════════════════════════════════════════════════════
// 3. La tool: leer el CSS, escribir, releer, pedir que se abra
// ════════════════════════════════════════════════════════════════════════════════════

/** Dónde está la hoja de estilos: al lado de `tool/`, igual en el repo que instalada. */
export function rutaDelSistemaCss(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "tecniabot-web", "diseno", "sistema.css")
}

export type CssLeido = { ok: true; css: string } | { ok: false; error: string }

/**
 * Lee la hoja de estilos, o explica por qué no hay página.
 *
 * Sin la hoja NO se arma nada: una página sin estilo «funciona» y es justo el resultado
 * que nadie pidió. Un archivo de 0 bytes o cortado cuenta como que falta (mismo criterio
 * que `circuito.ts` con su biblioteca de piezas): por eso se miran un token y un componente.
 */
export function leerSistemaCss(ruta: string = rutaDelSistemaCss()): CssLeido {
  const falta = (que: string): CssLeido => ({
    ok: false,
    error: `No armé la página: ${que} la hoja de estilos de Tecnia Bot (\`${ruta}\`). La instalación quedó incompleta. Decile al docente que reinstale Tecnia Bot con el instalador. No escribí ningún archivo.`,
  })
  let css: string
  try {
    css = readFileSync(ruta, "utf8")
  } catch {
    return falta("no encontré")
  }
  if (!css.includes("--marca:") || !css.includes(".tb-tarjeta") || /<\/style/i.test(css)) return falta("está vacía o dañada")
  return { ok: true, css }
}

/** `pagina-<slug>`: sólo [a-z0-9-], sin acentos, con el slug cortado en 60 caracteres. */
export function nombreSeguro(titulo: string): string {
  const slug = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return `pagina-${slug || "sin-titulo"}`
}

/** La ruta del archivo como URL `file://` bien formada. Ver la explicación en `imprimible.ts`. */
export function comoUrl(archivo: string): string {
  const barras = archivo.replace(/\\/g, "/")
  return "file://" + (barras.startsWith("/") ? "" : "/") + encodeURI(barras).replace(/#/g, "%23")
}

type Ocupacion = "libre" | "propio" | "ajeno"

/** Qué hay en esa ruta: nada, una página de esta tool, o algo que no hicimos nosotros. */
function ocupacion(archivo: string): Ocupacion {
  try {
    return readFileSync(archivo, "utf8").includes(MARCA_GENERADOR) ? "propio" : "ajeno"
  } catch (e) {
    // Sólo «no existe» deja el nombre libre. Si no se puede leer (permisos, es una
    // carpeta), no sabemos qué es: no se pisa.
    return (e as { code?: string } | null)?.code === "ENOENT" ? "libre" : "ajeno"
  }
}

const INTENTOS_DE_NOMBRE = 50

/**
 * Elige dónde guardar sin pisar nada ajeno.
 *
 * Una página anterior de esta tool con el mismo título se reemplaza: es la misma página,
 * corregida. Cualquier otro archivo con ese nombre se respeta: se prueba con `-2`, `-3`…
 * y se avisa. `imprimible` pisa sin mirar (anotado en el manifiesto de calidad); acá no.
 */
export function elegirDestino(directorio: string, base: string): { archivo: string; esquivo: string | null } | null {
  let esquivo: string | null = null
  for (let n = 1; n <= INTENTOS_DE_NOMBRE; n++) {
    const archivo = join(directorio, `${base}${n === 1 ? "" : `-${n}`}.html`)
    if (ocupacion(archivo) !== "ajeno") return { archivo, esquivo }
    esquivo ??= archivo
  }
  return null
}

/** Lo que se puede saber de un pedido al navegador. NO existe «abierta». */
export type Apertura = "pedida" | "fallo"

/** Cuánto se espera al lanzador para ver si termina con error. */
export const ESPERA_DEL_LANZADOR_MS = 1_500

type ProcesoLanzado = { exited: Promise<number>; unref?: () => void }

/**
 * Le pide al sistema que abra el archivo en el navegador por defecto.
 *
 * Que el lanzador arranque no prueba que haya aparecido una ventana, así que el mejor
 * resultado posible es «pedida». Se espera un momento: si `xdg-open` termina con error
 * (sin navegador por defecto, sesión sin escritorio), es «fallo». Mismo criterio que
 * `vista-fisica.ts::abrirEnNavegador` (auditoría del 2026-11-22, VIS-03).
 */
export async function pedirAlNavegador(
  archivo: string,
  lanzar: (cmd: string[]) => ProcesoLanzado = (cmd) => Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
  esperaMs: number = ESPERA_DEL_LANZADOR_MS,
): Promise<Apertura> {
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", archivo]
      : process.platform === "darwin"
        ? ["open", archivo]
        : ["xdg-open", archivo]
  let proc: ProcesoLanzado
  try {
    proc = lanzar(cmd)
  } catch {
    return "fallo"
  }
  let reloj: ReturnType<typeof setTimeout> | undefined
  const pasoLaEspera = new Promise<"sigue">((listo) => {
    reloj = setTimeout(() => listo("sigue"), esperaMs)
  })
  let como: number | "sigue"
  try {
    como = await Promise.race([proc.exited, pasoLaEspera])
  } catch {
    return "fallo"
  } finally {
    if (reloj !== undefined) clearTimeout(reloj)
    try {
      proc.unref?.()
    } catch {
      /* ya terminó */
    }
  }
  return como === "sigue" || como === 0 ? "pedida" : "fallo"
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`

const EJEMPLO = '{"titulo":"Cómo cuidar la placa","bloques":[{"tipo":"texto","texto":"Desconectá el USB antes de tocar los cables."}]}'

export default tool({
  description: `Arma una PÁGINA con diseño para leer en el navegador o imprimir en A4: una guía, un instructivo, un resumen de clase, una comparación en tabla. Vos pasás el CONTENIDO en bloques y la tool pone el diseño; nunca escribas HTML. NO dibuja circuitos (eso es \`circuito\`), NO muestra el proyecto del alumno (eso es \`vista-fisica\`) y la hoja de materiales, conexiones y código para el aula es \`imprimible\`. Pines y conexiones nunca se inventan: copialos tal cual de lo que devolvió \`circuito\` o \`proyecto-fisico\`. Si un argumento está mal, no escribe nada y te dice qué corregir. Ejemplo mínimo: ${EJEMPLO}`,
  args: {
    titulo: tool.schema.string().describe(`Título de la página, de ${LIMITES.tituloMin} a ${LIMITES.tituloMax} caracteres. De acá sale el nombre del archivo.`),
    resumen: tool.schema.string().optional().describe(`Opcional. De qué trata, en una o dos frases (hasta ${LIMITES.resumenMax} caracteres). Va destacado arriba.`),
    placa: tool.schema.string().optional().describe("Opcional. La placa, como la nombra el skill `placas` (ej: 'ESP32 DevKit'). Va como etiqueta en el encabezado."),
    tema: tool.schema.enum(TEMAS).optional().describe('Opcional. "claro" (por defecto) u "oscuro". Al imprimir sale siempre en claro.'),
    abrir: tool.schema.boolean().optional().describe("Opcional. true para pedirle al navegador que la abra. Por defecto false: se guarda y te devuelve la ruta."),
    bloques: tool.schema
      .array(
        tool.schema.object({
          tipo: tool.schema
            .enum(TIPOS)
            .describe(
              "Qué es el bloque. seccion: abre una parte numerada (usa titulo; hasta 8). texto: párrafos (usa texto). lista: viñetas (usa items). pasos: lista numerada (usa items). tabla: usa columnas y filas. codigo: usa texto. aviso: usa texto y severidad. plegable: usa titulo y texto o items.",
            ),
          titulo: tool.schema.string().optional().describe(`Obligatorio en seccion y plegable; opcional en los demás (subtítulo). Hasta ${LIMITES.tituloDeBloqueMax} caracteres.`),
          texto: tool.schema.string().optional().describe(`El contenido de texto, codigo, aviso y plegable (y la bajada de una seccion). Párrafos separados por una línea en blanco. Hasta ${LIMITES.textoMax} caracteres (${LIMITES.codigoMax} en codigo).`),
          items: tool.schema.array(tool.schema.string()).optional().describe(`Los renglones de lista, pasos o plegable: uno por elemento, hasta ${LIMITES.itemsMax}, cada uno de hasta ${LIMITES.itemMax} caracteres.`),
          columnas: tool.schema.array(tool.schema.string()).optional().describe(`Sólo en tabla: los encabezados, de ${LIMITES.columnasMin} a ${LIMITES.columnasMax}. Ej: ["Pieza","Pin"].`),
          filas: tool.schema.array(tool.schema.array(tool.schema.string())).optional().describe(`Sólo en tabla: una lista por fila, con una celda por columna. Hasta ${LIMITES.filasMax} filas. Ej: [["LED rojo","GPIO18"]].`),
          severidad: tool.schema.enum(SEVERIDADES).optional().describe('Sólo en aviso: "info" (dato), "ok" (está bien), "aviso" (atención) o "error" (hay que corregir).'),
        }),
      )
      .describe(`El contenido, en orden: de 1 a ${LIMITES.bloquesMax} bloques. Cada uno es un objeto con "tipo" y sólo los campos que ese tipo usa. Un campo de más es un error.`),
  },
  async execute(args, ctx) {
    const validacion = validarPagina(args)
    if (!validacion.ok) {
      const n = validacion.errores.length
      return `No armé la página y no escribí ningún archivo: hay ${plural(n, "cosa", "cosas")} para corregir en los argumentos.\n${validacion.errores.map((e) => `- ${e}`).join("\n")}\nCorregí eso y volvé a llamar a la tool.`
    }
    const { pagina, abrir } = validacion

    const hoja = leerSistemaCss()
    if (!hoja.ok) return hoja.error

    const html = renderizarPagina(pagina, hoja.css)
    const destino = elegirDestino(ctx.directory, nombreSeguro(pagina.titulo))
    if (!destino) {
      return `No guardé la página: en \`${ctx.directory}\` ya hay ${INTENTOS_DE_NOMBRE} archivos con ese nombre que no hice yo. Probá con otro título.`
    }
    const { archivo, esquivo } = destino

    try {
      await Bun.write(archivo, html)
    } catch (e) {
      return `No pude guardar la página en \`${archivo}\` (${e instanceof Error ? e.message : "error"}). No hay nada para mostrarle al docente.`
    }
    // RELECTURA. Que la escritura no tire una excepción no prueba que el archivo esté
    // entero (disco lleno, carpeta sincronizada que lo pisa, antivirus). Se vuelve a leer
    // del disco y se compara byte a byte con lo que se armó: recién ahí se informa.
    let releido: string | null = null
    try {
      releido = readFileSync(archivo, "utf8")
    } catch {
      releido = null
    }
    if (releido !== html) {
      return `No pude confirmar que la página quedó bien guardada: lo que hay en \`${archivo}\` no coincide con lo que armé. No se la ofrezcas al docente; probá de nuevo.`
    }

    const { secciones, bloques } = contar(pagina)
    const que = `Armé la página **${pagina.titulo}** (${plural(secciones, "sección", "secciones")}, ${plural(bloques, "bloque", "bloques")} de contenido). La guardé y la volví a leer del disco para comprobarla: \`${comoUrl(archivo)}\``
    const aviso = esquivo ? ` Ya había un archivo \`${esquivo}\` que no hice yo: no lo toqué y guardé la página con otro nombre.` : ""
    let apertura: string
    if (!abrir) {
      apertura = " No le pedí al navegador que la abra: pasale esa ruta al docente, u ofrecele abrirla (llamá de nuevo con abrir: true)."
    } else if ((await pedirAlNavegador(archivo)) === "pedida") {
      apertura = " Le pedí al navegador que la abra; no puedo comprobar que la ventana haya aparecido. Si no la ve, que pegue esa ruta en el navegador."
    } else {
      apertura = " Le pedí al navegador que la abra y el pedido falló. Decile al docente que la abra con doble clic o pegando esa ruta en el navegador."
    }
    return `${que}.${aviso}${apertura} Para imprimirla o guardarla como PDF está el botón «Imprimir / PDF» de la página.`
  },
})
