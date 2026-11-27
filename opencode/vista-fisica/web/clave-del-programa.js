// La clave del programa (2026-11-27): qué pieza es `cmp-12` y qué regla es `beh-28`.
//
// POR QUÉ EXISTE (hallazgo W38, notebook real del dueño). El programa generado nombra las piezas
// y las reglas por su id interno: `PIN_CMP_18_ANODO`, `// beh-28 -> cmp-16`. El alumno lo leía y
// no sabía qué pieza era cmp-18 ni cuál de los cuatro LED. Arriba, en la misma ventana, cada
// pieza tiene su nombre («LED 3») y cada regla está en palabras.
//
// El programa NO cambia: es ASCII por diseño y lo que se compila es exactamente lo que se ve. Lo
// que se agrega es una clave arriba del código, armada con datos que ya están en la página:
//   - las piezas, de la `estructura` que el servidor manda con el programa de ESA revisión
//     (`piezas`: id y nombre; el nombre es el del esquema);
//   - las reglas, de las reglas del snapshot que se está mostrando, en el orden en que están
//     dibujadas («regla 2» es la segunda de arriba abajo, igual que en los bloques);
//   - cómo se llaman en el código «al iniciar» y «por siempre», de la misma `estructura` (lo
//     comprueba el servidor contra la línea donde empieza cada uno);
//   - las otras formas en que aparece un nombre (`cmp_3`, `CMP_3`, `beh_4`), MIRANDO EL CÓDIGO que
//     está a la vista: sólo se dice lo que de verdad está escrito ahí.
// Acá no se escribe ningún nombre de pieza.
//
// Nada de otra revisión: quien llama pasa la estructura sólo si es la del proyecto que se muestra
// (`app.js::estructuraDeLaRevision`). Sin estructura, o sin piezas en ella, no hay clave.
//
// SEGUNDA VERSIÓN, el mismo día, después de verla en la notebook y de dos revisiones:
//   - eran 13 renglones antes del código: ahora es un plegable que arranca cerrado, con un título
//     que hace la pregunta del alumno («¿Qué es cmp-3?»). Es material de consulta;
//   - las piezas salían en el orden de «al iniciar» (14, 15, 12, 13, 16…): ahora van por número,
//     que es como se buscan viniendo del código;
//   - cada regla repetía su oración entera, que ya está dos veces en la ventana: ahora dice sólo
//     «es la regla 3»;
//   - decía «el nombre de una pieza aparece también como cmp_3 y CMP_3», con el ejemplo armado a
//     mano. La revisión independiente contó en programas generados: una salida nunca aparece como
//     `cmp_N` (sólo `CMP_N`), y las reglas sí aparecen con guion bajo (`beh_4`) y no se decía.
//     Ahora cada ejemplo se busca en el código y sólo se muestra si está;
//   - se suman `setup` y `loop`: el alumno que después abra el Arduino IDE los va a encontrar el
//     primer día, y ésta es la única pantalla donde ve las dos cosas juntas.
//
// TEXTOS PENDIENTES DE QUE EL DUEÑO LOS VEA EN PANTALLA: los de `TEXTOS_DE_LOS_NOMBRES`.

export const TEXTOS_DE_LOS_NOMBRES = Object.freeze({
  titulo: "¿Qué es {ejemplo}? Los nombres que usa el código",
  tituloSinEjemplo: "Los nombres que usa el código",
  parte: "es «{bloque}»",
  pieza: "es «{nombre}»",
  regla: "es la regla {numero}",
  unicaRegla: "es la regla",
  formas: "En el código vas a ver estos nombres también con guion bajo o en mayúsculas, pegados a otras palabras: por ejemplo {ejemplos}. Es lo mismo.",
})

const esTexto = (v) => typeof v === "string" && v !== ""
/** El número de un id (`cmp-12` → 12), para ordenar como números y no como texto (10 después de 9). */
const numeroDe = (id) => {
  const hallado = /(\d+)$/.exec(id)
  return hallado ? Number(hallado[1]) : Number.MAX_SAFE_INTEGER
}
const conGuionBajo = (id) => id.replaceAll("-", "_")
/**
 * ¿Está `nombre` (`cmp_3`, `CMP_3`, `beh_4`) escrito en el código, suelto o pegado a otras palabras
 * con `_` (`PIN_CMP_3_SENAL`, `cmp_3_temperatura`)? Se mira palabra por palabra y tramo por tramo:
 * `cmp_3` NO está en `cmp_30_senal` ni en `xcmp_3`.
 */
function aparece(codigo, nombre) {
  const buscado = nombre.split("_")
  for (const palabra of codigo.match(/[A-Za-z0-9_]+/g) ?? []) {
    const tramos = palabra.split("_")
    for (let i = 0; i + buscado.length <= tramos.length; i++) {
      if (buscado.every((tramo, k) => tramos[i + k] === tramo)) return true
    }
  }
  return false
}

/**
 * Lo que dice la clave, o `null` si no hay nada que decir. Pura.
 * @param {object | null} estructura la del programa que se está mostrando, o `null`.
 * @param {readonly { id?: unknown }[]} reglasDeLaVista `vista.reglas` del snapshot.
 * @param {string} codigo el programa que está a la vista (para las otras formas de un nombre).
 * @param {{ alIniciar: string, porSiempre: string }} titulos cómo se llaman los dos bloques de estructura.
 */
export function nombresDelPrograma(estructura, reglasDeLaVista = [], codigo = "", titulos = { alIniciar: "", porSiempre: "" }) {
  const piezasDeLaEstructura = estructura?.piezas
  if (!Array.isArray(piezasDeLaEstructura) || !Array.isArray(estructura.reglas)) return null
  if (!piezasDeLaEstructura.every((p) => p && esTexto(p.id) && esTexto(p.nombre))) return null
  const piezas = piezasDeLaEstructura.map((p) => ({ id: p.id, nombre: p.nombre })).sort((a, b) => numeroDe(a.id) - numeroDe(b.id))
  const enElPrograma = new Set(estructura.reglas.map((r) => r?.id).filter(esTexto))
  const dibujadas = (Array.isArray(reglasDeLaVista) ? reglasDeLaVista : []).filter((r) => r && esTexto(r.id))
  // Sólo las reglas que el programa tiene, en el orden del lienzo. El número es su lugar entre
  // TODAS las dibujadas (el mismo que dicen los bloques), no entre las que entraron al programa.
  const reglas = dibujadas.map((regla, i) => ({ id: regla.id, numero: dibujadas.length > 1 ? i + 1 : null })).filter((regla) => enElPrograma.has(regla.id))
  if (piezas.length === 0 && reglas.length === 0) return null

  const texto = typeof codigo === "string" ? codigo : ""
  // Cómo se llama cada parte en el código lo dice el servidor (`enElCodigo`), y sólo si lo comprobó
  // contra la línea donde empieza. Acá no hay código de placa escrito: se usa lo que viene.
  const partes = []
  if (esTexto(titulos?.alIniciar) && esTexto(estructura.alIniciar?.enElCodigo)) partes.push({ nombre: estructura.alIniciar.enElCodigo, bloque: titulos.alIniciar })
  if (esTexto(titulos?.porSiempre) && esTexto(estructura.porSiempre?.enElCodigo)) partes.push({ nombre: estructura.porSiempre.enElCodigo, bloque: titulos.porSiempre })

  // Las otras formas de un nombre, cada una sólo si está escrita en el código: la primera pieza
  // que aparece con guion bajo, la primera que aparece en mayúsculas y la primera regla con guion bajo.
  const primera = (candidatos) => candidatos.find((nombre) => aparece(texto, nombre))
  const formas = [primera(piezas.map((p) => conGuionBajo(p.id))), primera(piezas.map((p) => conGuionBajo(p.id).toUpperCase())), primera(reglas.map((r) => conGuionBajo(r.id)))].filter(esTexto)

  return { ejemplo: piezas[0]?.id ?? reglas[0]?.id ?? null, partes, piezas, reglas, formas }
}

/** «a», «a y b», «a, b y c». */
const enumerar = (cosas) => (cosas.length <= 1 ? (cosas[0] ?? "") : `${cosas.slice(0, -1).join(", ")} y ${cosas.at(-1)}`)

/**
 * Pinta la clave en `elemento` (o lo deja oculto y vacío si `nombres` es `null`). Es un plegable
 * que arranca cerrado; si el alumno ya lo abrió, un repintado lo deja abierto. Todo va con
 * `textContent`: un nombre de pieza es un dato, nunca marcado.
 */
export function pintarNombresDelPrograma(doc, elemento, nombres) {
  const estabaAbierto = elemento.firstElementChild?.open === true
  if (!nombres) {
    elemento.replaceChildren()
    elemento.hidden = true
    return
  }
  const crear = (tag, texto) => {
    const e = doc.createElement(tag)
    if (texto !== undefined) e.textContent = texto
    return e
  }
  const renglon = (nombre, dicho) => {
    const li = crear("li")
    li.appendChild(crear("code", nombre))
    li.appendChild(crear("span", ` ${dicho}`))
    return li
  }
  const lista = crear("ul")
  for (const parte of nombres.partes) lista.appendChild(renglon(parte.nombre, TEXTOS_DE_LOS_NOMBRES.parte.replace("{bloque}", () => parte.bloque)))
  for (const pieza of nombres.piezas) lista.appendChild(renglon(pieza.id, TEXTOS_DE_LOS_NOMBRES.pieza.replace("{nombre}", () => pieza.nombre)))
  for (const regla of nombres.reglas) lista.appendChild(renglon(regla.id, regla.numero === null ? TEXTOS_DE_LOS_NOMBRES.unicaRegla : TEXTOS_DE_LOS_NOMBRES.regla.replace("{numero}", String(regla.numero))))

  const plegable = crear("details")
  plegable.open = estabaAbierto
  plegable.appendChild(crear("summary", nombres.ejemplo ? TEXTOS_DE_LOS_NOMBRES.titulo.replace("{ejemplo}", () => nombres.ejemplo) : TEXTOS_DE_LOS_NOMBRES.tituloSinEjemplo))
  plegable.appendChild(lista)
  if (nombres.formas.length > 0) plegable.appendChild(crear("p", TEXTOS_DE_LOS_NOMBRES.formas.replace("{ejemplos}", () => enumerar(nombres.formas))))
  elemento.replaceChildren(plegable)
  elemento.hidden = false
}
