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
// operaciones que existen, en UNA transacción, siempre que las piezas vayan AL FINAL: quitar una
// pieza que todavía tiene una regla o un cable da REMOCION_CON_DEPENDIENTES. (La primera versión
// de este comentario decía "sólo en el orden reglas, cables, piezas"; una revisión independiente
// midió que cables→reglas→piezas también entra.) Por eso la tool arma el lote ella: pedírselo al
// modelo era pedirle que acierte el orden y los ids.
//
// QUÉ ENCONTRÓ LA REVISIÓN INDEPENDIENTE, además: 17 de 20 mutaciones suyas quedaban verdes. No
// había ni un test de un rechazo del Engine que no fuera "revisión vieja", ni de una regla
// incompleta, ni de la parte del prompt que ata cada respuesta del docente con su acción (se
// podían cruzar "seguimos" y "uno nuevo" y todo seguía verde).
//
// LO QUE NO HACE, A PROPÓSITO: no guarda copia de lo anterior. Escribir disco desde esta tool
// está prohibido por diseño (ver el encabezado de la tool) y la copia tendría que vivir en el
// núcleo. Por eso el resultado y la descripción dicen que no hay copia.
//
// Mutaciones corridas sobre una copia fuera del repo: ver el commit.

import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
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
  assert.match(queHacer, /preguntá primero, UNA sola vez, nombrando lo que hay/)
  assert.match(queHacer, /seguimos con este proyecto o empezamos uno nuevo/)
  assert.match(queHacer, /se borra \(no queda copia\)/)
  assert.match(queHacer, /`vaciar`/)
  assert.match(queHacer, /nunca quites ni pises una regla o una pieza que nadie nombró sin decirlo y preguntar antes/)
  // El consentimiento y el caso en que NO hay que preguntar también están.
  assert.match(queHacer, /con el sí, usá la acción `vaciar`/)
  assert.match(queHacer, /Si lo que te piden habla de estas piezas, o ya te dijeron en esta charla que siguen con este proyecto, seguí sobre él/)
  assert.match(queHacer, /UNA sola vez/)
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
  // 24 piezas: más operaciones que el tope de 20 que rige para lo que escribe el agente.
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

test("si el Engine rechaza el vaciado por algo que no es la revisión, no se dice VACIADO y se nombra el motivo", async () => {
  // El archivo cambió por debajo (otra herramienta, una copia restaurada a mano): el Engine lo detecta.
  const c = await armado()
  const ruta = join(directorioDeDatos(c.dir), `${c.idProyecto}.json`)
  const tocado = JSON.stringify({ ...enDisco(c), revision: c.revision + 5 })
  writeFileSync(ruta, tocado)
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  assert.equal(r.ok, false, JSON.stringify(r))
  assert.match(r.resultado, /^NO SE APLICÓ NADA — /)
  assert.doesNotMatch(r.resultado, /VACIADO/)
  assert.doesNotMatch(r.resultado, /rechazado por el Project Engine$/, "un rechazo mudo: el agente no tendría qué contar")
  assert.ok(Array.isArray(r.motivos) && r.motivos.length > 0, "los motivos viajan en la respuesta")
  assert.ok(r.motivos.some((m) => r.resultado.includes(m.explicacion ?? m.codigo)), "el resultado nombra uno de los motivos")
  assert.equal(readFileSync(ruta, "utf8"), tocado, "el disco quedó como estaba")
})

test("si no se puede guardar (carpeta de sólo lectura), el motivo que se cuenta es ÉSE y no el aviso de una regla quitada", async () => {
  // En este rechazo el Engine ya evaluó el lote: los motivos traen primero el aviso informativo
  // de cada regla quitada y después el que bloquea. El resultado tiene que nombrar el que bloquea.
  const c = await armado()
  const dir = directorioDeDatos(c.dir)
  const antes = readFileSync(join(dir, `${c.idProyecto}.json`), "utf8")
  chmodSync(dir, 0o555)
  let r
  try {
    r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: c.revision }, c.dir)
  } finally {
    chmodSync(dir, 0o755)
  }
  assert.equal(r.ok, false, JSON.stringify(r))
  assert.match(r.resultado, /^NO SE APLICÓ NADA — /)
  const bloqueante = r.motivos.find((m) => m.severidad === "blocking")
  assert.ok(bloqueante, "tiene que haber un motivo que bloquea")
  assert.ok(r.motivos.indexOf(bloqueante) > 0, "si el bloqueante es el primero este test no distingue nada")
  assert.ok(r.resultado.includes(bloqueante.explicacion ?? bloqueante.codigo), r.resultado)
  assert.doesNotMatch(r.resultado, /COMPORTAMIENTO_QUITADO/)
  assert.equal(readFileSync(join(dir, `${c.idProyecto}.json`), "utf8"), antes)
})

test("una baseRevision que no es un entero se rechaza: no se reemplaza por la revisión vigente", async () => {
  for (const mala of [2.5, -1, "3"]) {
    const c = await armado()
    const antes = JSON.stringify(enDisco(c))
    const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: mala }, c.dir)
    assert.equal(r.ok, false, `baseRevision ${JSON.stringify(mala)}: ${JSON.stringify(r)}`)
    assert.match(r.resultado, /^NO SE APLICÓ NADA — /)
    assert.equal(JSON.stringify(enDisco(c)), antes)
  }
})

test("con reglas pero sin piezas el proyecto NO está vacío: leer avisa y vaciar las quita", async () => {
  // Una regla incompleta puede existir sin ninguna pieza. El aviso y `vaciar` tienen que coincidir
  // en qué es "vacío".
  const c = await conPlaca()
  const a = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: 1, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: { entonces: { accion: "encender" } } } }] }, c.dir)
  assert.equal(a.ok, true, JSON.stringify(a))
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal(lectura.componentes.length, 0)
  assert.deepEqual(lectura.proyectoArmado.piezas, [])
  assert.equal(lectura.proyectoArmado.reglas.length, 1)
  assert.equal(typeof lectura.proyectoArmado.reglas[0], "string", "una regla incompleta igual se nombra con un texto, nunca null")
  assert.ok(lectura.proyectoArmado.reglas[0].length > 0)
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: lectura.revision }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /se quitaron 0 pieza\(s\), 0 cable\(s\) y 1 regla\(s\)/)
  assert.deepEqual(enDisco(c).comportamientos, [])
})

test("vaciar un proyecto ya vacío informa la revisión vigente y dice que se puede seguir", async () => {
  const c = await conPlaca()
  const r = await llamar({ accion: "vaciar", idProyecto: c.idProyecto, baseRevision: 1 }, c.dir)
  assert.equal(r.revisionActual, 1)
  assert.equal(r.baseRevision, 1)
  assert.match(r.resultado, /podés armar el proyecto nuevo sobre él/)
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
  assert.match(d, /las operaciones las arma la tool a partir de lo que hay, no las mandes vos/)
  assert.match(proyectoFisico.args.baseRevision.description, /'simular'\/'aplicar'\/'vaciar'/)
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
  assert.match(s, /Hacé UNA pregunta, nombrando lo que hay con las palabras de `proyectoArmado\.piezas`/)
  assert.match(s, /«Ya tenés armado un proyecto con <las piezas>\. ¿Lo seguimos, o empiezo uno nuevo\?/)
  assert.match(s, /el actual se borra: no queda copia/)
  assert.match(s, /no afirmes que se vació/)
  assert.match(s, /Nunca saques ni pises una regla o una pieza que nadie nombró sin decirlo ANTES/)
  assert.match(s, /primero decilo y preguntá: «Para eso tengo que quitar la regla "<el texto de la regla, tal cual lo trae `leer`>"\. ¿Dale\?»/)
  assert.match(s, /nombrá también lo que quitaste/)
})

test("el prompt ata cada respuesta del docente con SU acción: «seguimos» no vacía, «uno nuevo» sí", () => {
  // Hueco de la revisión: se podían cruzar las dos ramas y los tests seguían verdes.
  const s = seccion("Si ya hay un proyecto armado").replace(/\s+/g, " ")
  const sigue = s.match(/\*\*Si contesta que seguimos\*\*: ([^*]+?) - \*\*/)
  const nuevo = s.match(/\*\*Si contesta que uno nuevo\*\*: (.+?) - \*\*Esa pregunta/)
  assert.ok(sigue && nuevo, "no encuentro las dos ramas en el prompt")
  assert.match(sigue[1], /armá lo nuevo sobre lo que hay/)
  assert.doesNotMatch(sigue[1], /vaciar/)
  assert.match(nuevo[1], /`proyecto-fisico` con `vaciar` y la `baseRevision` de `leer`/)
  assert.match(nuevo[1], /Seguí SÓLO después de ver \*\*VACIADO\*\*/)
  assert.match(nuevo[1], /salvo que el motivo sea que ya estaba vacío/)
})

test("el prompt dice cuándo NO preguntar: pedido sobre ese proyecto, y una sola vez por charla", () => {
  const s = seccion("Si ya hay un proyecto armado").replace(/\s+/g, " ")
  assert.match(s, /\*\*Si el pedido es sobre ESE proyecto\*\* \(cambiar un pin, cambiar o agregar un comportamiento de algo que ya está, sumarle una pieza a lo que hay\): seguí sobre él, sin preguntar/)
  assert.match(s, /Esa pregunta se hace UNA sola vez por charla/)
  assert.match(s, /si las piezas las armaste vos en esta misma charla, no la repitas/)
  // Y cuándo no hace falta el «¿Dale?»: lo que ya pidieron con esas palabras.
  assert.match(s, /Si en cambio te pidieron con esas palabras quitar, cambiar o reemplazar ESA regla o ESA pieza, hacelo sin volver a preguntar/)
})

test("la lista de líneas `resultado` del prompt incluye VACIADO", () => {
  assert.match(PROMPT.replace(/\s+/g, " "), /`VACIADO — revisión X→Y` \(sólo para `vaciar`\)/)
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
