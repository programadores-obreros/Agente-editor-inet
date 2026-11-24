// La tool `proyecto-fisico`: el aviso de proyecto armado en `leer` y la acción `vaciar`.
// Corre con: node --test tests/proyecto-fisico-vaciar.test.mjs
//
// POR QUÉ EXISTE. Notebook real, 2026-11-24: con un proyecto ya armado el docente pidió otra
// cosa, con otro sensor. El agente le sumó la pieza nueva encima, quitó una regla que estorbaba
// y cerró con "quedó configurada la regla". En la vista aparecieron las piezas de tres pedidos
// distintos. No existía la idea de "empezar de nuevo", y el dato de que ya había un proyecto
// estaba en `leer` pero perdido entre el vocabulario.
//
// QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO. El Project Engine ya sabe vaciar un proyecto con las
// operaciones que existen, en UNA transacción, pero sólo en este orden: reglas, cables, piezas.
// Reglas y piezas sin desconectar antes los cables da REMOCION_CON_DEPENDIENTES. Por eso la tool
// arma el lote ella: pedírselo al modelo era pedirle que acierte el orden y los ids.
//
// LO QUE NO HACE, A PROPÓSITO: no guarda copia de lo anterior. Escribir disco desde esta tool
// está prohibido por diseño (ver el encabezado de la tool) y la copia tendría que vivir en el
// núcleo. Por eso el resultado y la descripción dicen que no hay copia.
//
// Mutaciones corridas sobre una copia fuera del repo: ver el commit.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

const llamar = async (args, dir) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
const enDisco = (c) => JSON.parse(readFileSync(join(directorioDeDatos(c.dir), `${c.idProyecto}.json`), "utf8"))

/** Un proyecto vacío, sólo con la placa. */
async function conPlaca() {
  const c = { dir: nuevoDir("vaciar"), idProyecto: nuevoIdProyecto("vaciar") }
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  return c
}

/** ESP32 + LED con su resistencia cableada + pulsador + la regla "mientras presionado, encendido". */
async function armado() {
  const c = await conPlaca()
  let r = await llamar(
    { accion: "aplicar", idProyecto: c.idProyecto, baseRevision: 1, operaciones: ["led", "resistencia", "pulsador"].map((tipo) => ({ tipo: "AgregarComponente", payload: { tipo } })) },
    c.dir,
  )
  assert.equal(r.ok, true, JSON.stringify(r))
  let lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const id = (tipo) => lectura.componentes.find((x) => x.tipo === tipo).id
  r = await llamar(
    {
      accion: "aplicar",
      idProyecto: c.idProyecto,
      baseRevision: lectura.revision,
      operaciones: [
        { tipo: "AsignarPin", payload: { componente: id("led"), terminal: "anodo", pin: "GPIO4" } },
        { tipo: "Conectar", payload: { desde: { componente: id("led"), terminal: "anodo" }, hasta: { componente: id("resistencia"), terminal: "a" } } },
        { tipo: "AsignarPin", payload: { componente: id("pulsador"), terminal: "senal", pin: "GPIO5" } },
        {
          tipo: "SetComportamiento",
          payload: {
            comportamiento: {
              cuando: { sensor: id("pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } },
              entonces: { actuador: id("led"), accion: "encender" },
            },
          },
        },
      ],
    },
    c.dir,
  )
  assert.equal(r.ok, true, JSON.stringify(r))
  lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const disco = enDisco(c)
  // El punto de partida es el que el test cree: si no, todo lo de abajo no prueba nada.
  assert.deepEqual([disco.componentes.length, disco.conexiones.length, disco.comportamientos.length], [3, 1, 1])
  return { ...c, revision: lectura.revision, lectura }
}

// ---------------------------------------------------------------------------
// leer: el aviso de proyecto armado
// ---------------------------------------------------------------------------

test("leer de un proyecto vacío NO trae el aviso: no hay nada que preguntar", async () => {
  const c = await conPlaca()
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal(lectura.componentes.length, 0)
  assert.equal("proyectoArmado" in lectura, false)
})

test("leer de un proyecto con piezas trae el aviso con los nombres de las piezas y el texto de las reglas", async () => {
  const c = await armado()
  const { proyectoArmado } = c.lectura
  assert.deepEqual(proyectoArmado.piezas, c.lectura.componentes.map((x) => x.nombre))
  assert.equal(proyectoArmado.piezas.length, 3)
  assert.deepEqual(proyectoArmado.reglas, ["Mientras el Pulsador esté presionado, el LED está encendido."])
})

test("el aviso va ARRIBA de las listas largas: antes de componentes, reglas y vocabulario", async () => {
  // El dato ya estaba en `leer` y el agente no lo usó: estaba detrás de 17.000 caracteres.
  const c = await armado()
  const crudo = await proyectoFisico.execute({ accion: "leer", idProyecto: c.idProyecto }, { directory: c.dir })
  const pos = (clave) => crudo.indexOf(`"${clave}":`)
  assert.ok(pos("proyectoArmado") > 0)
  for (const despues of ["componentes", "reglas", "motivos", "vocabulario"]) {
    assert.ok(pos("proyectoArmado") < pos(despues), `proyectoArmado tiene que ir antes de ${despues}`)
  }
})

test("el aviso dice las tres cosas: preguntar antes, que vaciar borra sin copia, y no quitar sin decirlo", async () => {
  const c = await armado()
  const { queHacer } = c.lectura.proyectoArmado
  assert.match(queHacer, /YA HAY UN PROYECTO ARMADO/)
  assert.match(queHacer, /preguntá primero/)
  assert.match(queHacer, /seguimos con este proyecto o empezamos uno nuevo/)
  assert.match(queHacer, /se borra \(no queda copia\)/)
  assert.match(queHacer, /`vaciar`/)
  assert.match(queHacer, /nunca quites una regla o una pieza sin decirlo antes/)
})

test("un proyecto con piezas pero sin reglas también avisa", async () => {
  const c = await conPlaca()
  await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: 1, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "pulsador" } }] }, c.dir)
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal(lectura.proyectoArmado.piezas.length, 1)
  assert.deepEqual(lectura.proyectoArmado.reglas, [])
})

// ---------------------------------------------------------------------------
// vaciar
// ---------------------------------------------------------------------------

test("vaciar deja el proyecto sin piezas, sin cables y sin reglas, en UNA revisión, y conserva la placa", async () => {
  const c = await armado()
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.revisionActual, c.revision + 1, "una sola transacción: una sola revisión")
  const disco = enDisco(c)
  assert.deepEqual(disco.componentes, [])
  assert.deepEqual(disco.conexiones, [])
  assert.deepEqual(disco.comportamientos, [])
  assert.equal(disco.placa, "esp32-devkit-v1")
  assert.equal(disco.revision, c.revision + 1)
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal("proyectoArmado" in lectura, false, "después de vaciar ya no hay proyecto armado que avisar")
})

test("el resultado de vaciar dice cuánto quitó, que la placa quedó y que NO hay copia", async () => {
  const c = await armado()
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  assert.equal(
    r.resultado,
    `VACIADO — revisión ${c.revision}→${c.revision + 1}: se quitaron 3 pieza(s), 1 cable(s) y 1 regla(s). La placa quedó como estaba. No se guardó copia de lo anterior.`,
  )
  assert.equal(r.accion, "vaciar")
})

test("vaciar no acepta operaciones del agente: las arma la tool, y las que le manden se ignoran", async () => {
  const c = await armado()
  const r = await llamar(
    { accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "led" } }] },
    c.dir,
  )
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(enDisco(c).componentes, [], "si hubiera usado las operaciones del agente habría quedado un LED")
})

test("vaciar sin baseRevision se rechaza y no toca nada", async () => {
  const c = await armado()
  const antes = JSON.stringify(enDisco(c))
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto }, c.dir)
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "BASE_REVISION_FALTANTE")
  assert.match(r.resultado, /^NO SE APLICÓ NADA/)
  assert.equal(JSON.stringify(enDisco(c)), antes)
})

test("vaciar con una baseRevision vieja se rechaza: no borra lo que el docente cambió después de leer", async () => {
  const c = await armado()
  const antes = JSON.stringify(enDisco(c))
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision - 1 }, c.dir)
  assert.equal(r.ok, false)
  assert.equal(r.resultado, "NO SE APLICÓ NADA — el proyecto cambió; volvé a leer")
  assert.equal(JSON.stringify(enDisco(c)), antes)
})

test("vaciar un proyecto ya vacío no hace nada, lo dice, y no sube la revisión", async () => {
  const c = await conPlaca()
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: 1 }, c.dir)
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "PROYECTO_YA_VACIO")
  assert.match(r.resultado, /^NO SE APLICÓ NADA — el proyecto ya está vacío/)
  assert.equal(enDisco(c).revision, 1)
})

test("vaciar no depende del tope de 20 operaciones del agente: un proyecto grande también se vacía", async () => {
  const c = await conPlaca()
  let revision = 1
  // 12 pulsadores con su pin: 12 piezas. Con una regla y cables serían más de 20 operaciones.
  for (let i = 0; i < 3; i++) {
    const r = await llamar(
      { accion: "aplicar", idProyecto: c.idProyecto, baseRevision: revision, operaciones: Array.from({ length: 8 }, () => ({ tipo: "AgregarComponente", payload: { tipo: "resistencia" } })) },
      c.dir,
    )
    assert.equal(r.ok, true, JSON.stringify(r))
    revision = r.revisionActual
  }
  assert.equal(enDisco(c).componentes.length, 24)
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: revision }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /se quitaron 24 pieza\(s\)/)
  assert.deepEqual(enDisco(c).componentes, [])
})

test("después de vaciar se puede armar otro proyecto encima, desde cero", async () => {
  const c = await armado()
  const v = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: v.revisionActual, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "led" } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal(lectura.componentes.length, 1)
  assert.equal(lectura.reglas.length, 0)
})

// ---------------------------------------------------------------------------
// Lo que la tool le dice al agente
// ---------------------------------------------------------------------------

test("la descripción de la tool nombra las cuatro acciones y avisa que vaciar no guarda copia", () => {
  const d = proyectoFisico.description
  assert.match(d, /Cuatro `accion`/)
  for (const accion of ["leer", "simular", "aplicar", "vaciar"]) assert.match(d, new RegExp("- `" + accion + "`:"))
  assert.match(d, /No guarda copia: lo que había se pierde/)
  assert.match(d, /SÓLO después de que la persona haya dicho que sí/)
  assert.match(d, /"VACIADO — revisión X→Y"/)
})

test("una acción desconocida se sigue rechazando, y el mensaje nombra las cuatro que existen", async () => {
  const c = await conPlaca()
  const r = await llamar({ accion: "borrar-todo", idProyecto: c.idProyecto, baseRevision: 1 }, c.dir)
  assert.equal(r.ok, false)
  assert.equal(r.resultado, "NO SE APLICÓ NADA — acción desconocida (usá 'leer', 'simular', 'aplicar' o 'vaciar')")
  assert.equal(enDisco(c).revision, 1)
})

// ---------------------------------------------------------------------------
// El prompt del agente: la sección que usa todo lo de arriba
// ---------------------------------------------------------------------------

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
function seccion(titulo) {
  const desde = PROMPT.indexOf(`### ${titulo}`)
  assert.ok(desde > 0, `falta la sección «${titulo}» en el prompt`)
  const resto = PROMPT.slice(desde + 4)
  const hasta = resto.search(/\n#{2,3} /)
  return resto.slice(0, hasta < 0 ? undefined : hasta)
}

test("el prompt tiene la sección del proyecto ya armado, dentro de la regla de proyecto físico", () => {
  const regla = PROMPT.indexOf("## REGLA CRÍTICA — proyecto físico")
  const nueva = PROMPT.indexOf("### Si ya hay un proyecto armado: preguntá antes de sumarle o de sacarle")
  const siguiente = PROMPT.indexOf("## REGLA CRÍTICA — circuitos visuales")
  assert.ok(regla > 0 && regla < nueva && nueva < siguiente)
})

test("el prompt nombra los mismos campos y la misma acción que entrega la tool", async () => {
  const s = seccion("Si ya hay un proyecto armado")
  // Si la tool cambia un nombre y el prompt no, el agente busca algo que ya no existe.
  const c = await armado()
  assert.ok("proyectoArmado" in c.lectura && "piezas" in c.lectura.proyectoArmado)
  assert.match(s, /`proyectoArmado`/)
  assert.match(s, /`proyectoArmado\.piezas`/)
  assert.match(s, /`vaciar`/)
  assert.match(s, /`baseRevision`/)
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  assert.ok(r.resultado.startsWith("VACIADO"))
  assert.match(s, /\*\*VACIADO\*\*/)
})

test("el prompt manda a preguntar antes, a avisar que no queda copia y a no quitar nada sin decirlo", () => {
  const s = seccion("Si ya hay un proyecto armado").replace(/\s+/g, " ")
  assert.match(s, /NO le sumes piezas ni le saques nada/)
  assert.match(s, /Hacé UNA pregunta/)
  assert.match(s, /¿Lo seguimos, o empiezo uno nuevo\?/)
  assert.match(s, /el actual se borra: no queda copia/)
  assert.match(s, /Seguí SÓLO después de ver \*\*VACIADO\*\*/)
  assert.match(s, /no afirmes que se vació/)
  assert.match(s, /Nunca saques una regla ni una pieza sin decirlo ANTES/)
  assert.match(s, /nombrá también lo que quitaste/)
})

test("la sección nueva no nombra piezas concretas: los nombres salen de lo que devuelve la tool", () => {
  const s = seccion("Si ya hay un proyecto armado")
  assert.doesNotMatch(s, /\b(led|pulsador|dht\d*|resistencia|servo|buzzer|ultras[oó]nico)\b/i)
})

test("el ESQUEMA de la tool acepta `vaciar`: es lo que valida OpenCode antes de llamar a execute", () => {
  // Hueco encontrado por mutación: todos los tests de arriba llaman a execute() directo. Sacando
  // `vaciar` del enum seguían verdes, y en el producto OpenCode habría rechazado la acción antes
  // de llegar a la tool.
  const { accion } = proyectoFisico.args
  for (const valida of ["leer", "simular", "aplicar", "vaciar"]) assert.equal(accion.safeParse(valida).success, true, valida)
  assert.equal(accion.safeParse("borrar-todo").success, false)
  assert.match(accion.description, /'vaciar' para empezar de nuevo \(quita todo; no guarda copia\)/)
})
