// El resumen de la ventana «vista física», sus avisos y la leyenda de cables: lo decide el servidor.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). El prototipo aprobado del rediseño armaba todo esto en el
// navegador: elegía el estado con un `if`, redactaba «Hay una regla sin terminar.», armaba el
// plural de los avisos, ponía la etiqueta de cada severidad como `content:` de CSS y traía una
// leyenda fija que decía «3,3 V» aunque la placa fuera un Arduino UNO (5 V). En este repo el
// navegador no decide ni redacta: recibe el texto hecho. Si un texto vive en dos lados, tarde o
// temprano dicen cosas distintas.
//
// QUÉ SE MIDE. Proyectos armados con operaciones REALES del motor, proyectados con el catálogo
// real. Cada expectativa de estado se escribe a mano para el escenario (no se recalcula con la
// misma cuenta que el código), y además se cruza contra el `readiness` del núcleo.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - invertir la precedencia (incompleto antes que inválido)            → «el estado sale del readiness…»
//   - `sinTerminar: false` para la regla sin texto                        → «una regla sin terminar…»
//   - devolver `[]` cuando no hay reglas                                  → «sin reglas…»
//   - `cantidad === 1` → `cantidad <= 1` en el plural                     → «el plural de los avisos…»
//   - `motivos.length` → cantidad de bloqueantes                          → «la cantidad de avisos es la de motivos»
//   - usar siempre `VLOGICA` aunque los cables vayan a otro terminal      → «la leyenda nombra los terminales en uso»
//   - leyenda con «3,3 V» fijo                                            → «la leyenda sale de la placa…»
//   - devolver la leyenda sin placa                                       → «sin placa no hay leyenda»
//   - compartir el objeto de textos entre proyecciones                    → «cada proyección trae sus propios textos»
//   - borrar la etiqueta de una severidad                                 → «toda severidad tiene etiqueta»
//
// Y DEL LADO DEL NAVEGADOR (plan puro + pintor tonto), con un documento falso:
//   - el plan elige el estado él mismo (p. ej. siempre «listo»)           → «el plan copia el resumen…»
//   - el pintor no marca `data-sin-terminar`                              → «el pintor arma el resumen…»
//   - el pintor no oculta el contador en cero                             → «el contador de avisos…»
//   - sacar la etiqueta de severidad del pintor (o dejarla como atributo) → «cada aviso lleva su severidad como TEXTO»
//   - el plan toma la etiqueta de una tabla propia                        → «cada aviso lleva su severidad como TEXTO»
//   - no emitir `sinAvisos`                                               → «sin avisos, la sección lo dice»
//   - emitir `sinAvisos` aunque haya avisos                               → «sin avisos, la sección lo dice»
//   - la muestra de la leyenda sin `data-rol-cable`                       → «la leyenda se pinta con el rol…»
//   - sacar una raíz nueva de las que monta `app.js`                      → «app.js monta todas las raíces…»
//
// Corre con: node --test tests/ventana-resumen.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { TEXTOS_DE_LA_VENTANA, textoDeCantidadDeAvisos, textoDeLeyendaDePotencia } = await import(join(REPO, "opencode/conocimiento/anexos/pedagogia-es-AR.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar, ANCLA_DE_AVISOS } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

const catalogo = CONOCIMIENTO_ACTIVO.catalogo

let n = 0
function proyecto(pasos, placa = "esp32-devkit-v1") {
  let p = { ...crearProyecto({ generadorId: () => "resumen", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash }), placa }
  for (const [tipo, payload] of pasos) {
    const r = ejecutarOperacion(p, { idOperacion: `resumen-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  }
  return p
}
const vistaDe = (pasos, placa) => proyectarVista(proyecto(pasos, placa), catalogo)

const PRESIONADO = { sensor: "cmp-0", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const PULSADOR_Y_LED = [
  ["AgregarComponente", { tipo: "pulsador" }], // cmp-0
  ["AgregarComponente", { tipo: "led" }], // cmp-1
  ["AgregarComponente", { tipo: "resistencia" }], // cmp-2
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
]
const REGLA_COMPLETA = ["SetComportamiento", { comportamiento: { cuando: PRESIONADO, entonces: { actuador: "cmp-1", accion: "encender" } } }]
const REGLA_A_MEDIAS = ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0" } } }]

test("los textos son los aprobados para la ventana", () => {
  assert.deepEqual(TEXTOS_DE_LA_VENTANA.estado, { listo: "El proyecto está completo", invalido: "Hay algo para corregir", incompleto: "Todavía le falta algo" })
  assert.equal(TEXTOS_DE_LA_VENTANA.reglaSinTerminar, "Hay una regla sin terminar.")
  assert.equal(TEXTOS_DE_LA_VENTANA.sinReglas, "Todavía no hay ninguna regla: el circuito no hace nada.")
  assert.equal(TEXTOS_DE_LA_VENTANA.sinAvisos, "No hay avisos: no encontramos nada para revisar en este proyecto.")
  assert.deepEqual(TEXTOS_DE_LA_VENTANA.severidad, { blocking: "Hay que corregir", warning: "Atención", info: "Dato" })
})

test("el estado sale del readiness del núcleo, con su clave y su texto", () => {
  const casos = [
    ["completo, con regla", [...PULSADOR_Y_LED, REGLA_COMPLETA], "esp32-devkit-v1", "listo", "El proyecto está completo"],
    ["LED sin su resistencia", [["AgregarComponente", { tipo: "led" }], ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" }]], "esp32-devkit-v1", "invalido", "Hay algo para corregir"],
    ["sensor sin pin", [["AgregarComponente", { tipo: "dht22" }]], "esp32-devkit-v1", "incompleto", "Todavía le falta algo"],
    ["sin placa", [], null, "incompleto", "Todavía le falta algo"],
    // Las dos cosas a la vez: gana «hay algo para corregir», que es lo que frena (misma precedencia de siempre).
    ["LED sin pin y sin resistencia", [["AgregarComponente", { tipo: "led" }]], "esp32-devkit-v1", "invalido", "Hay algo para corregir"],
  ]
  for (const [nombre, pasos, placa, clave, texto] of casos) {
    const vista = vistaDe(pasos, placa)
    assert.deepEqual(vista.resumen.estado, { clave, texto }, nombre)
    assert.equal(vista.readiness[clave], true, `${nombre}: la clave no coincide con el readiness del núcleo`)
  }
  const ambos = vistaDe([["AgregarComponente", { tipo: "led" }]])
  assert.deepEqual([ambos.readiness.incompleto, ambos.readiness.invalido], [true, true], "precondición: el escenario tiene que estar incompleto E inválido")
})

test("una regla completa se lee con su frase; una regla sin terminar lo dice y queda marcada", () => {
  const completa = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA])
  assert.deepEqual(completa.resumen.reglas, [{ texto: "Mientras el Pulsador esté presionado, el LED está encendido.", sinTerminar: false }])
  assert.equal(completa.resumen.reglas[0].texto, completa.reglas[0].texto, "la frase del resumen es la misma que proyecta la regla, no otra redacción")

  const aMedias = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA, REGLA_A_MEDIAS])
  assert.equal(aMedias.reglas[1].texto, null, "precondición: la segunda regla todavía no se lee como oración")
  assert.deepEqual(aMedias.resumen.reglas, [
    { texto: "Mientras el Pulsador esté presionado, el LED está encendido.", sinTerminar: false },
    { texto: "Hay una regla sin terminar.", sinTerminar: true },
  ])
})

test("sin reglas, el resumen lo dice: nunca queda la tarjeta vacía", () => {
  for (const vista of [vistaDe(PULSADOR_Y_LED), vistaDe([], null)]) {
    assert.deepEqual(vista.reglas, [], "precondición: sin reglas")
    assert.deepEqual(vista.resumen.reglas, [{ texto: "Todavía no hay ninguna regla: el circuito no hace nada.", sinTerminar: true }])
  }
})

test("el plural de los avisos lo arma el servidor", () => {
  assert.equal(textoDeCantidadDeAvisos(0), "Sin avisos.")
  assert.equal(textoDeCantidadDeAvisos(1), "Hay 1 aviso para mirar.")
  assert.equal(textoDeCantidadDeAvisos(2), "Hay 2 avisos para mirar.")
  assert.equal(textoDeCantidadDeAvisos(14), "Hay 14 avisos para mirar.")
})

test("la cantidad de avisos es la de motivos (todas las severidades), con su frase", () => {
  const ninguno = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA])
  assert.deepEqual(ninguno.resumen.avisos, { cantidad: 0, texto: "Sin avisos." })

  // Un pin de arranque: el aviso es informativo, no frena, y se cuenta igual.
  const uno = vistaDe([["AgregarComponente", { tipo: "pulsador" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO2" }]])
  assert.deepEqual(uno.motivos.map((m) => m.severidad), ["info"], "precondición: un solo aviso, y no bloqueante")
  assert.deepEqual(uno.resumen.avisos, { cantidad: 1, texto: "Hay 1 aviso para mirar." })

  const varios = vistaDe([["AgregarComponente", { tipo: "pulsador" }], ["AgregarComponente", { tipo: "led" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO2" }], REGLA_A_MEDIAS])
  assert.ok(varios.motivos.length >= 3, `precondición: esperaba tres avisos o más y hay ${varios.motivos.length}`)
  assert.ok(new Set(varios.motivos.map((m) => m.severidad)).size >= 2, "precondición: avisos de más de una severidad")
  assert.deepEqual(varios.resumen.avisos, { cantidad: varios.motivos.length, texto: `Hay ${varios.motivos.length} avisos para mirar.` })
})

test("toda severidad que el núcleo usa tiene etiqueta de texto, y viaja en la vista", () => {
  // Las severidades se leen de la fuente del núcleo, no de una lista copiada acá.
  const fuentes = ["motivos.ts", "validar.ts", "validar-tecnico.ts", "catalogo.ts", "operaciones.ts", "motor.ts"].map((f) => readFileSync(join(REPO, "opencode/nucleo", f), "utf8")).join("\n")
  const usadas = [...new Set([...fuentes.matchAll(/severidad:\s*"([a-z]+)"/g)].map((m) => m[1]))].sort()
  assert.ok(usadas.includes("blocking") && usadas.length >= 2, `no estoy leyendo las severidades del núcleo: ${usadas}`)
  const vista = vistaDe([])
  for (const severidad of usadas) assert.equal(typeof vista.textos.severidad[severidad], "string", `la severidad «${severidad}» no tiene etiqueta: el aviso saldría sin decir qué es`)
  assert.deepEqual(vista.textos.severidad, { blocking: "Hay que corregir", warning: "Atención", info: "Dato" })
  assert.equal(vista.textos.sinAvisos, "No hay avisos: no encontramos nada para revisar en este proyecto.")
})

test("la leyenda sale de la placa: 3,3 V en el ESP32 y 5 V en el Arduino UNO", () => {
  const dht = [["AgregarComponente", { tipo: "dht22" }]]
  assert.deepEqual(vistaDe(dht, "esp32-devkit-v1").leyenda, [
    { rol: "senal", texto: "señal: un color por pieza" },
    { rol: "alimentacion", texto: "3,3 V: alimentación, siempre en rojo" },
    { rol: "tierra", texto: "GND (masa): siempre en negro y punteado" },
  ])
  assert.deepEqual(vistaDe(dht, "arduino-uno").leyenda.map((l) => l.texto), ["señal: un color por pieza", "5 V: alimentación, siempre en rojo", "GND (masa): siempre en negro y punteado"])
  // Sin ningún cable a la alimentación todavía, se nombra el terminal de la tensión lógica de la placa.
  assert.equal(vistaDe([], "arduino-uno").leyenda[1].texto, "5 V: alimentación, siempre en rojo")
  assert.equal(vistaDe([], "esp32-devkit-v1").leyenda[1].texto, "3,3 V: alimentación, siempre en rojo")
})

test("la leyenda nombra los terminales en uso: los roles son los de los cables del proyecto", () => {
  const vista = vistaDe([["AgregarComponente", { tipo: "dht22" }]], "arduino-uno")
  const enCables = new Set(vista.cables.flatMap((c) => [c.desde, c.hasta]).filter((e) => e.tipo === "rielFijo").map((e) => `${e.potencia.rol}:${e.potencia.etiqueta}`))
  assert.deepEqual([...enCables].sort(), ["alimentacion:5 V", "tierra:GND (masa)"])
  // Si los cables fueran a OTRO terminal de alimentación, la leyenda nombra ése (y no el de la tensión lógica).
  assert.equal(textoDeLeyendaDePotencia("alimentacion", ["3,3 V", "VIN (entrada de alimentación)"]), "3,3 V y VIN (entrada de alimentación): alimentación, siempre en rojo")
  const trucado = { ...catalogo, placas: catalogo.placas.map((p) => (p.id === "arduino-uno" ? { ...p, destinosDeRiel: { ...p.destinosDeRiel, VLOGICA: "3V3" } } : p)) }
  const conocimientoReal = CONOCIMIENTO_ACTIVO
  const conOtraLogica = proyectarVista(proyecto([["AgregarComponente", { tipo: "dht22" }]], "arduino-uno"), trucado, conocimientoReal)
  assert.equal(conOtraLogica.leyenda[1].texto, "5 V: alimentación, siempre en rojo", "el cable va a 5 V: la leyenda no puede decir otra cosa aunque la tensión lógica de la placa fuera otra")
})

test("sin placa no hay leyenda", () => {
  assert.deepEqual(vistaDe([], null).leyenda, [])
})

test("cada proyección trae sus propios textos: mutar una no toca la siguiente", () => {
  const a = vistaDe([])
  a.textos.severidad.blocking = "pisado"
  a.resumen.reglas.length = 0
  const b = vistaDe([])
  assert.equal(b.textos.severidad.blocking, "Hay que corregir")
  assert.equal(b.resumen.reglas.length, 1)
  assert.equal(TEXTOS_DE_LA_VENTANA.severidad.blocking, "Hay que corregir")
})

test("el resumen y los textos son datos planos: sobreviven a viajar por JSON tal cual", () => {
  const vista = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA])
  for (const clave of ["resumen", "textos", "leyenda"]) assert.deepEqual(JSON.parse(JSON.stringify(vista[clave])), vista[clave], clave)
})

// ════════════════════════════════════════════════════════════════════════════════════
// El navegador: el plan copia y el pintor escribe. Ninguno decide.
// ════════════════════════════════════════════════════════════════════════════════════

function documentoFake() {
  const crear = (tag) => ({
    tagName: tag,
    atributos: {},
    hijos: [],
    textContent: "",
    setAttribute(k, v) {
      this.atributos[k] = String(v)
    },
    appendChild(h) {
      this.hijos.push(h)
      return h
    },
  })
  return { createElement: crear }
}
const todos = (nodo) => [nodo, ...(nodo.hijos ?? []).flatMap(todos)]
/** El texto que se LEE de un nodo: el suyo y el de sus hijos, como `textContent` en un DOM real. */
const textoDe = (nodo) => (nodo.hijos.length > 0 ? nodo.hijos.map(textoDe).join(" ") : nodo.textContent)
const pintarVista = (vista) => pintar(documentoFake(), planDePintado(vista))

const CON_AVISOS = [["AgregarComponente", { tipo: "pulsador" }], ["AgregarComponente", { tipo: "led" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO2" }], REGLA_A_MEDIAS]

test("el plan copia el resumen del servidor tal cual: no elige el estado, no redacta, no cuenta", () => {
  const vista = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA, REGLA_A_MEDIAS])
  const instrucciones = planDePintado(vista).filter((i) => i.tipo === "resumen")
  assert.equal(instrucciones.length, 1)
  const { tipo: _tipo, ...resumen } = instrucciones[0]
  assert.deepEqual(resumen, vista.resumen)
  assert.notEqual(instrucciones[0].reglas, vista.resumen.reglas, "el plan no devuelve referencias del modelo")

  // Con un resumen que contradice al resto del modelo, el plan repite el RESUMEN: no recalcula.
  const trucado = JSON.parse(JSON.stringify(vista))
  trucado.resumen = { estado: { clave: "listo", texto: "texto de prueba" }, reglas: [{ texto: "una sola", sinTerminar: false }], avisos: { cantidad: 99, texto: "noventa y nueve" } }
  const { tipo: _t, ...copiado } = planDePintado(trucado).find((i) => i.tipo === "resumen")
  assert.deepEqual(copiado, trucado.resumen)

  // Un modelo sin resumen (fixture viejo) no produce la instrucción: el navegador no inventa uno.
  const { resumen: _sin, ...sinResumen } = vista
  assert.equal(planDePintado(sinResumen).some((i) => i.tipo === "resumen"), false)
})

test("el pintor arma el resumen con el texto de la instrucción y marca la regla sin terminar", () => {
  const vista = vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA, REGLA_A_MEDIAS])
  const raiz = pintarVista(vista)
  assert.equal(raiz.resumen.tagName, "ol")
  assert.deepEqual(raiz.resumen.hijos.map((li) => [li.tagName, li.textContent, li.atributos["data-sin-terminar"] ?? null]), [
    ["li", "Mientras el Pulsador esté presionado, el LED está encendido.", null],
    ["li", "Hay una regla sin terminar.", "true"],
  ])
  assert.equal(raiz.resumenEstado.textContent, vista.resumen.estado.texto)
  assert.equal(raiz.resumenEstado.atributos["data-readiness"], vista.resumen.estado.clave)
  assert.equal(vista.resumen.estado.clave, "invalido", "precondición: el escenario no está listo")

  const [enlace] = raiz.resumenAvisos.hijos
  assert.equal(enlace.tagName, "a")
  assert.equal(enlace.textContent, vista.resumen.avisos.texto)
  assert.equal(enlace.atributos.href, `#${ANCLA_DE_AVISOS}`)
  assert.equal(enlace.atributos["data-cantidad"], String(vista.resumen.avisos.cantidad))
})

test("el contador de avisos de la navegación muestra el número y se oculta en cero", () => {
  const con = pintarVista(vistaDe(CON_AVISOS))
  const cantidad = vistaDe(CON_AVISOS).motivos.length
  assert.ok(cantidad >= 3, "precondición")
  assert.equal(con.contadorAvisos.textContent, String(cantidad))
  assert.ok(!("hidden" in con.contadorAvisos.atributos), "con avisos, el contador se ve")

  const sin = pintarVista(vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA]))
  assert.equal(sin.contadorAvisos.textContent, "0")
  assert.ok("hidden" in sin.contadorAvisos.atributos, "sin avisos, el contador no muestra un cero")
})

test("cada aviso lleva su severidad como TEXTO, con la etiqueta que mandó el servidor", () => {
  const vista = vistaDe(CON_AVISOS)
  assert.ok(new Set(vista.motivos.map((m) => m.severidad)).size >= 2, "precondición: más de una severidad")
  const plan = planDePintado(vista)
  assert.deepEqual(plan.filter((i) => i.tipo === "panelMotivo").map((i) => i.etiquetaSeveridad), vista.motivos.map((m) => vista.textos.severidad[m.severidad]))

  const raiz = pintar(documentoFake(), plan)
  assert.equal(raiz.motivos.hijos.length, vista.motivos.length)
  for (const [indice, fila] of raiz.motivos.hijos.entries()) {
    const motivo = vista.motivos[indice]
    const etiquetas = fila.hijos.filter((h) => "data-etiqueta-severidad" in h.atributos)
    assert.equal(etiquetas.length, 1, "la etiqueta es un elemento con texto, no un atributo ni un `content:` de CSS")
    assert.equal(etiquetas[0].textContent, vista.textos.severidad[motivo.severidad])
    assert.equal(fila.hijos.indexOf(etiquetas[0]), 0, "la etiqueta va ADELANTE: es lo primero que se lee del aviso")
    assert.equal(textoDe(fila), `${vista.textos.severidad[motivo.severidad]} ${motivo.explicacion}`)
    assert.equal(fila.atributos["data-motivo-severidad"], motivo.severidad, "el dato de la severidad sigue estando para el color")
  }

  // El plan no tiene una tabla propia: con otra etiqueta en el modelo, sale esa otra; sin ninguna, `null`.
  const trucado = JSON.parse(JSON.stringify(vista))
  trucado.textos.severidad = { blocking: "ROJO", info: "AZUL" }
  assert.deepEqual([...new Set(planDePintado(trucado).filter((i) => i.tipo === "panelMotivo").map((i) => i.etiquetaSeveridad))].sort(), ["AZUL", "ROJO"])
  const { textos: _sin, ...sinTextos } = vista
  const filasViejas = pintar(documentoFake(), planDePintado(sinTextos)).motivos.hijos
  assert.deepEqual(filasViejas.map((f) => [f.hijos.length, f.textContent]), vista.motivos.map((m) => [0, m.explicacion]), "sin etiqueta del servidor la fila queda como antes: sólo el texto")
})

test("sin avisos, la sección lo dice con el texto del servidor; con avisos, no", () => {
  const sin = pintarVista(vistaDe([...PULSADOR_Y_LED, REGLA_COMPLETA]))
  assert.deepEqual(sin.motivos.hijos.map((li) => [li.tagName, li.atributos["data-sin-avisos"], li.textContent]), [["li", "true", "No hay avisos: no encontramos nada para revisar en este proyecto."]])
  const con = pintarVista(vistaDe(CON_AVISOS))
  assert.equal(todos(con.motivos).some((x) => "data-sin-avisos" in x.atributos), false)
})

test("la leyenda se pinta con el rol de cada entrada (el mismo dato que lleva el cable) y el texto del servidor", () => {
  const vista = vistaDe([["AgregarComponente", { tipo: "dht22" }]], "arduino-uno")
  const raiz = pintarVista(vista)
  assert.deepEqual(
    raiz.leyenda.hijos.map((item) => [item.atributos["data-leyenda"], item.hijos[0].atributos["data-rol-cable"], textoDe(item).trim()]),
    vista.leyenda.map((l) => [l.rol, l.rol, l.texto]),
  )
  assert.match(textoDe(raiz.leyenda), /5 V: alimentación/)
  assert.equal(pintarVista(vistaDe([], null)).leyenda.hijos.length, 0, "sin placa no hay leyenda que pintar")
})

test("app.js monta todas las raíces que devuelve el pintor, y cada una tiene su lugar en la página", () => {
  const raices = Object.keys(pintarVista(vistaDe(PULSADOR_Y_LED))).sort()
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  const bloque = /\n  contenedores = \{\n([\s\S]*?)\n  \}\n/.exec(app)
  assert.ok(bloque, "no encontré el bloque `contenedores = { … }` de app.js")
  const montadas = [...bloque[1].matchAll(/^\s*(\w+): document\.getElementById\("([^"]+)"\),$/gm)].map((m) => ({ raiz: m[1], id: m[2] }))
  assert.deepEqual(montadas.map((m) => m.raiz).sort(), raices, "una raíz que el pintor devuelve y app.js no monta no se ve nunca; una que app.js monta y el pintor no devuelve rompe el repintado")
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  for (const { raiz, id } of montadas) assert.equal(html.split(`id="${id}"`).length, 2, `la raíz «${raiz}» se monta en #${id}, que tiene que estar una sola vez en index.html`)
})

test("el enlace «hay N avisos» lleva a una sección que existe, y es la que contiene la lista de avisos", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const seccion = new RegExp(`<section[^>]*\\bid="${ANCLA_DE_AVISOS}"[^>]*>([\\s\\S]*?)</section>`).exec(html)
  assert.ok(seccion, `index.html no tiene una <section id="${ANCLA_DE_AVISOS}">: el enlace del resumen no llevaría a ningún lado`)
  assert.match(seccion[1], /id="motivos"/, "la sección a la que lleva el enlace tiene que ser la de los avisos")
})
