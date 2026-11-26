// El skill `paginas` contra la tool `pagina`: lo que el skill enseña tiene que ser lo
// que la tool acepta, exactamente.
//
// POR QUÉ ESTE ARCHIVO. El skill es lo que el modelo lee antes de llamar a la tool. Si
// el catálogo del skill nombra un tipo que la tool no tiene, o le pide a un tipo un
// campo que la tool rechaza, el modelo copia el error en cada página, la tool la
// rechaza, y el docente ve «no pude». Si el catálogo se olvida de un tipo, el modelo
// nunca lo usa. Nada de eso rompe un proceso: un texto desactualizado no se pone rojo
// solo. Por eso acá se lee la verdad de la tool (sus listas exportadas y la tabla `USO`
// de su fuente) y se la compara con lo que dice el skill, en las dos direcciones.
//
// Y el ejemplo completo del skill se pasa por `validarPagina` de verdad: es lo que el
// modelo va a copiar, así que tiene que ser válido, y sus pines tienen que ser los de
// la ficha del proyecto que dice citar (el skill le pide al bot no inventar pines; el
// ejemplo no puede ser el primero en inventarlos).
//
// MUTACIONES probadas con el trabajo commiteado: sacar una fila del catálogo, sumar
// un tipo que no existe, cambiar un campo exigido, sacar una severidad, romper el
// ejemplo (un bloque sin su campo, un JSON mal cerrado), cambiar un pin del ejemplo,
// y poner un tipo inventado en una receta. Todas ponen rojo un test de acá.
//
// Corre con: node --test tests/paginas-skill.test.mjs

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-paginas-skill-test")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")
const SKILL = leer("opencode/skills/paginas/SKILL.md")
const FUENTE = leer("opencode/tool/pagina.ts")

let P

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, "tool"), { recursive: true })
  writeFileSync(
    join(OUT, "tool/mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = FUENTE.replace('/// <reference path="../env.d.ts" />', "").replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  assert.notEqual(src, FUENTE, "no reemplacé el import del plugin: estaría cargando otra cosa")
  writeFileSync(join(OUT, "tool/pagina.ts"), src)
  P = await import(join(OUT, "tool/pagina.ts"))
})

/** El tramo del skill entre un título y el siguiente del mismo nivel o superior. */
function tramo(titulo) {
  const i = SKILL.indexOf(titulo)
  assert.ok(i >= 0, `el skill no tiene «${titulo}»`)
  const nivel = /^#+/.exec(titulo)[0]
  const siguiente = new RegExp(`\\n#{1,${nivel.length}} `, "g")
  siguiente.lastIndex = i + titulo.length
  const m = siguiente.exec(SKILL)
  return SKILL.slice(i, m ? m.index : undefined)
}
/** Las filas de datos de una tabla markdown: celdas sin los bordes, sin encabezado ni separador. */
function filas(texto) {
  return texto
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.slice(1, -1).split("|").map((c) => c.trim()))
    .slice(2)
}
const enComillas = (celda) => [...celda.matchAll(/`([a-z]+)`/g)].map((m) => m[1])

/** La tabla USO de la tool, leída de su fuente: no está exportada, y es la verdad. */
function usoDeLaTool() {
  const uso = {}
  for (const m of FUENTE.matchAll(/^ {2}(\w+): \{ exige: \[([^\]]*)\], admite: \[([^\]]*)\] \},$/gm)) {
    const lista = (s) => [...s.matchAll(/"(\w+)"/g)].map((x) => x[1])
    uso[m[1]] = { exige: lista(m[2]), admite: lista(m[3]) }
  }
  return uso
}

test("el frontmatter nombra los pedidos típicos y para qué NO es", () => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(SKILL)
  assert.ok(fm, "el skill no tiene frontmatter")
  assert.match(fm[1], /^name: paginas$/m)
  const descripcion = /^description: (.*)$/m.exec(fm[1])[1]
  for (const pedido of ["guía de clase", "apunte", "explicación para los alumnos", "resumen de la clase", "consigna de un trabajo práctico", "instructivo"]) {
    assert.ok(descripcion.includes(pedido), `la description no nombra «${pedido}»: es lo que decide cuándo se activa`)
  }
  for (const otra of ["`vista-fisica`", "`circuito`", "`ficha`", "`imprimible`", "chat"]) {
    assert.ok(descripcion.includes(otra), `la description no dice que no es para ${otra}`)
  }
})

test("la tabla USO de la tool se leyó entera (si no, el test de abajo compara contra nada)", () => {
  const uso = usoDeLaTool()
  assert.deepEqual(Object.keys(uso).sort(), [...P.TIPOS].sort(), "no pude leer la tabla USO de pagina.ts: ¿cambió de forma?")
  // Y lo leído es la verdad de la tool: un bloque con sólo lo que exige pasa.
  for (const [tipo, { exige, admite }] of Object.entries(uso)) {
    const bloque = { tipo }
    for (const campo of exige) bloque[campo] = campo === "items" || campo === "columnas" ? ["a", "b"] : campo === "filas" ? [["1", "2"]] : campo === "severidad" ? "info" : "x"
    if (tipo === "plegable") bloque.texto = "x"
    const v = P.validarPagina({ titulo: "Prueba", bloques: [bloque] })
    assert.equal(v.ok, true, `${tipo}: ${v.ok ? "" : v.errores.join(" | ")}`)
    for (const campo of exige) {
      const sin = { ...bloque }
      delete sin[campo]
      assert.equal(P.validarPagina({ titulo: "Prueba", bloques: [sin] }).ok, false, `${tipo} sin ${campo} pasó: la tabla leída no es la que valida`)
    }
    assert.ok(Array.isArray(admite))
  }
})

test("el catálogo del skill tiene EXACTAMENTE los tipos de la tool, con sus campos", () => {
  const uso = usoDeLaTool()
  const catalogo = filas(tramo("## Catálogo de bloques").split("### ")[0])
  const tipos = catalogo.map((c) => enComillas(c[0])[0])
  assert.deepEqual([...tipos].sort(), [...P.TIPOS].sort(), "el catálogo del skill y los tipos de la tool no coinciden")
  assert.equal(new Set(tipos).size, tipos.length, "un tipo aparece dos veces en el catálogo")
  for (const c of catalogo) {
    const tipo = enComillas(c[0])[0]
    assert.equal(c.length, 5, `la fila de ${tipo} no tiene sus cinco columnas`)
    assert.deepEqual(enComillas(c[1]).sort(), [...uso[tipo].exige].sort(), `${tipo}: lo que el skill dice que exige no es lo que exige la tool`)
    assert.deepEqual(enComillas(c[2]).sort(), [...uso[tipo].admite].sort(), `${tipo}: lo que el skill dice que admite no es lo que admite la tool`)
    assert.ok(c[3].length > 10 && c[4].length > 10, `${tipo}: falta «usalo cuando» o «no lo uses para»`)
  }
})

test("las severidades del skill son EXACTAMENTE las de la tool, con su etiqueta, y `error` sólo para riesgo real", () => {
  const tabla = filas(tramo("### Severidades del aviso"))
  const severidades = tabla.map((c) => enComillas(c[0])[0])
  assert.deepEqual([...severidades].sort(), [...P.SEVERIDADES].sort())
  for (const c of tabla) {
    const s = enComillas(c[0])[0]
    assert.equal(c[1], P.ETIQUETAS[s], `la etiqueta de ${s} en el skill no es la que pone la página`)
  }
  const error = tabla.find((c) => c[0] === "`error`")
  assert.match(error[2], /sólo riesgo real/)
  assert.match(error[2], /220 V/)
  assert.match(error[2], /quemar la placa/)
})

test("el ejemplo completo pasa validarPagina sin errores, y no abre solo", () => {
  const bloque = /```json\n([\s\S]*?)\n```/.exec(tramo("## Ejemplo completo"))
  assert.ok(bloque, "el skill no trae el ejemplo completo en un bloque json")
  const args = JSON.parse(bloque[1])
  const v = P.validarPagina(args)
  assert.equal(v.ok, true, `el ejemplo que el modelo va a copiar no valida: ${v.ok ? "" : v.errores.join(" | ")}`)
  assert.equal(v.abrir, false, "el ejemplo no puede pedir abrir: la regla es ofrecerlo")
  // Que sea un ejemplo COMPLETO de verdad: usa secciones, tabla, pasos y aviso.
  const usados = new Set(args.bloques.map((b) => b.tipo))
  for (const t of ["seccion", "tabla", "pasos", "aviso"]) assert.ok(usados.has(t), `el ejemplo no usa ${t}`)
})

test("los pines del ejemplo son los de la ficha que cita, no inventados", () => {
  const args = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(tramo("## Ejemplo completo"))[1])
  const ficha = leer("opencode/skills/proyectos-inet/proyectos/01-semaforizacion.md")
  assert.match(tramo("## Ejemplo completo"), /`01-semaforizacion`/, "el ejemplo no dice de qué ficha salen sus pines")
  const tabla = args.bloques.find((b) => b.tipo === "tabla")
  assert.ok(tabla.filas.length >= 3)
  for (const [led, pin] of tabla.filas) {
    const color = led.toLowerCase()
    const gpio = /GPIO (\d+)/.exec(pin)[1]
    assert.match(ficha, new RegExp(`\\| Semáforo 1 · ${color} \\| pin \\d+ \\| GPIO ${gpio} \\|`), `el ejemplo pone el ${color} en GPIO ${gpio} y la ficha dice otra cosa`)
  }
})

test("las recetas cubren los cuatro pedidos y sólo nombran tipos que existen", () => {
  const recetas = tramo("## Recetas por pedido")
  for (const pedido of ["**Guía de clase**", "**Apunte**", "**Consigna de trabajo práctico**", "**Resumen de la clase**"]) {
    assert.ok(recetas.includes(pedido), `falta la receta ${pedido}`)
  }
  const nombrados = new Set(enComillas(recetas))
  assert.ok(nombrados.size >= 6, "las recetas casi no nombran bloques")
  const validos = new Set([...P.TIPOS, ...P.SEVERIDADES])
  const ajenos = [...nombrados].filter((t) => !validos.has(t))
  assert.deepEqual(ajenos, [], `las recetas nombran bloques que la tool no tiene: ${ajenos.join(", ")}`)
})

test("las reglas de contenido: fuentes de pines y código, rioplatense, sin nombres de alumnos", () => {
  const reglas = tramo("## De dónde sale cada cosa").replace(/\s+/g, " ")
  assert.match(reglas, /Nada de la página sale de tu memoria/)
  assert.match(reglas, /de `proyecto-fisico leer` si es el proyecto del alumno/)
  assert.match(reglas, /de la tabla que devolvió el `circuito` que generaste/)
  assert.match(reglas, /skill `proyectos-inet`/)
  assert.match(reglas, /la página va sin conexiones/)
  assert.match(reglas, /\*\*Código del proyecto físico\*\*: no va/)
  assert.match(reglas, /sección «Código»/)
  assert.match(reglas, /sólo del skill `diseno-curricular`/)
  assert.match(reglas, /español rioplatense/)
  assert.match(reglas, /sin nombres de alumnos/)
})

test("los skills vecinos ya no mandan una guía o un TP a un .md ni a una ficha", () => {
  const diagramas = leer("opencode/skills/diagramas-conexion/SKILL.md")
  assert.doesNotMatch(diagramas, /archivo `\.md` \(guía, TP\)|archivo \.md \(guía\/TP\)|\(una guía, un TP\)/, "diagramas-conexion sigue mandando la guía o el TP a un .md")
  assert.match(diagramas, /tool `pagina` \(skill `paginas`\)/)
  const fichas = leer("opencode/skills/fichas/SKILL.md")
  assert.doesNotMatch(fichas, /pida material para el aula, algo para repartir,/, "la description de fichas sigue agarrando cualquier material para repartir")
  assert.match(/^description: (.*)$/m.exec(fichas)[1], /no son fichas \(eso es el skill `paginas`\)/)
})
