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
