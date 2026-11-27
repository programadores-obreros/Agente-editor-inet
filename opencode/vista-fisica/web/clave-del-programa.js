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
//     dibujadas («regla 2» es la segunda de arriba abajo, igual que en los bloques).
// Acá no se escribe ningún nombre ni se busca nada en el texto del programa.
//
// Nada de otra revisión: quien llama pasa la estructura sólo si es la del proyecto que se muestra
// (`app.js::estructuraDeLaRevision`). Sin estructura, o sin piezas en ella, no hay clave.
//
// TEXTOS PENDIENTES DE APROBACIÓN DEL DUEÑO: los de `TEXTOS_DE_LOS_NOMBRES`.

export const TEXTOS_DE_LOS_NOMBRES = Object.freeze({
  titulo: "Cómo se llaman las piezas y las reglas en este programa:",
  pieza: "es «{nombre}»",
  regla: "es la regla {numero}",
  unicaRegla: "es la regla",
  // El id de una pieza aparece escrito de otras dos maneras; se dice una vez, con la primera de
  // ejemplo. Sólo de las piezas: una regla nunca aparece en mayúsculas.
  variantes: "En el programa, el nombre de una pieza aparece también como {conGuionBajo} y {enMayusculas}.",
})

const esTexto = (v) => typeof v === "string" && v !== ""

/**
 * Lo que dice la clave, o `null` si no hay nada que decir. Pura.
 * @param {object | null} estructura la del programa que se está mostrando, o `null`.
 * @param {readonly { id?: unknown, texto?: unknown }[]} reglasDeLaVista `vista.reglas` del snapshot.
 * @returns {null | { piezas: { id: string, nombre: string }[], reglas: { id: string, numero: number | null, texto: string | null }[] }}
 */
export function nombresDelPrograma(estructura, reglasDeLaVista = []) {
  const piezas = estructura?.piezas
  if (!Array.isArray(piezas) || !Array.isArray(estructura.reglas)) return null
  if (!piezas.every((p) => p && esTexto(p.id) && esTexto(p.nombre))) return null
  const enElPrograma = new Set(estructura.reglas.map((r) => r?.id).filter(esTexto))
  const dibujadas = (Array.isArray(reglasDeLaVista) ? reglasDeLaVista : []).filter((r) => r && esTexto(r.id))
  // Sólo las reglas que el programa tiene, en el orden del lienzo. El número es su lugar entre
  // TODAS las dibujadas (el mismo que dicen los bloques), no entre las que entraron al programa.
  const reglas = dibujadas
    .map((regla, i) => ({ id: regla.id, numero: dibujadas.length > 1 ? i + 1 : null, texto: esTexto(regla.texto) ? regla.texto : null }))
    .filter((regla) => enElPrograma.has(regla.id))
  if (piezas.length === 0 && reglas.length === 0) return null
  return { piezas: piezas.map((p) => ({ id: p.id, nombre: p.nombre })), reglas }
}

/** Un id como lo escribe el programa en un identificador: `cmp-12` → `cmp_12`. */
const conGuionBajo = (id) => id.replaceAll("-", "_")

/**
 * Pinta la clave en `elemento` (o lo deja oculto y vacío si `nombres` es `null`). Todo va con
 * `textContent`: un nombre de pieza es un dato, nunca marcado.
 */
export function pintarNombresDelPrograma(doc, elemento, nombres) {
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
  const renglon = (id, dicho, detalle) => {
    const li = crear("li")
    li.appendChild(crear("code", id))
    li.appendChild(crear("span", ` ${dicho}`))
    if (detalle) li.appendChild(crear("span", `: ${detalle}`))
    return li
  }
  const lista = crear("ul")
  for (const pieza of nombres.piezas) lista.appendChild(renglon(pieza.id, TEXTOS_DE_LOS_NOMBRES.pieza.replace("{nombre}", () => pieza.nombre)))
  for (const regla of nombres.reglas) {
    const dicho = regla.numero === null ? TEXTOS_DE_LOS_NOMBRES.unicaRegla : TEXTOS_DE_LOS_NOMBRES.regla.replace("{numero}", String(regla.numero))
    lista.appendChild(renglon(regla.id, dicho, regla.texto))
  }
  const partes = [crear("p", TEXTOS_DE_LOS_NOMBRES.titulo), lista]
  const ejemplo = nombres.piezas[0]?.id
  if (ejemplo) {
    const guion = conGuionBajo(ejemplo)
    partes.push(crear("p", TEXTOS_DE_LOS_NOMBRES.variantes.replace("{conGuionBajo}", guion).replace("{enMayusculas}", guion.toUpperCase())))
  }
  elemento.replaceChildren(...partes)
  elemento.hidden = false
}
