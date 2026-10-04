// Phase 2, Slice 2 — W-S2-VISTA, §3.3 (rol Entrada/Salida).
// docs/programacion-intencion/PHASE_2_SLICE_2_DESIGN.md §3.3, HD-S2-7.
//
// `rol` se deriva de `ComponenteCatalogo.clase` (`nucleo/catalogo.ts:88`) del lado
// del SERVIDOR (`snapshot-a-vista.ts`) — el browser (`plan-de-pintado.js`/
// `pintar.js`) sólo capitaliza el string YA resuelto ("entrada"->"Entrada"), nunca
// mira `componente.tipo` ni ninguna clase de catálogo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, catalogo, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto, op, prepararProyectoConLed, GPIO_X } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    _textContent: "",
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
    get textContent() {
      return this._textContent
    },
    set textContent(valor) {
      this._textContent = valor
    },
  }
}
function documentoFake() {
  return { createElement: (tag) => elementoFake(tag) }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Derivación real (Engine): pulsador -> entrada, LED -> salida, resistencia -> null
// ════════════════════════════════════════════════════════════════════════════════════

test("proyectarVista real: pulsador.rol === 'entrada', led.rol === 'salida', resistencia.rol === null", () => {
  const dir = nuevoDir("s2-rol-real")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto })

  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "resistencia" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idResistencia = servicio.snapshot().proyecto.componentes[1].id
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[2].id

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const led = vista.componentes.find((c) => c.id === idLed)
  const resistencia = vista.componentes.find((c) => c.id === idResistencia)
  const pulsador = vista.componentes.find((c) => c.id === idPulsador)

  assert.equal(led.rol, "salida", "LED: clase 'actuador' -> rol 'salida'")
  assert.equal(resistencia.rol, null, "resistencia: clase 'pasivo' -> rol null")
  assert.equal(pulsador.rol, "entrada", "pulsador: clase 'entrada' -> rol 'entrada'")
})

test("proyectarVista real: un sensor (dht22, clase 'sensor') también deriva rol 'entrada'", () => {
  const dir = nuevoDir("s2-rol-sensor")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "dht22" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idDht22 = servicio.snapshot().proyecto.componentes[0].id

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const dht22 = vista.componentes.find((c) => c.id === idDht22)
  assert.equal(dht22.rol, "entrada", "clase 'sensor' -> rol 'entrada' (mismo criterio que 'entrada')")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Función pura de derivación: una clase desconocida nunca se inventa un rol
// ════════════════════════════════════════════════════════════════════════════════════

test("rolDeClase (función pura exportada): despacha por clase, nunca inventa un rol para una clase desconocida", async () => {
  const { rolDeClase } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
  assert.equal(rolDeClase("entrada"), "entrada")
  assert.equal(rolDeClase("sensor"), "entrada")
  assert.equal(rolDeClase("actuador"), "salida")
  assert.equal(rolDeClase("pasivo"), null)
  assert.equal(rolDeClase("clase-del-futuro-que-no-existe-todavia"), null, "clase futura desconocida -> null, nunca se inventa")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. planDePintado/pintar: sólo capitalizan el texto ya resuelto, junto al componente
// ════════════════════════════════════════════════════════════════════════════════════

test("planDePintado: crearElemento del pulsador trae etiquetaRol:'Entrada'; el LED trae 'Salida'; la placa no trae etiqueta", () => {
  const dir = nuevoDir("s2-rol-plan")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const instrucciones = planDePintado(vista)

  const crearPlaca = instrucciones.find((i) => i.tipo === "crearElemento" && i.entidad.tipo === "placa")
  const crearLed = instrucciones.find((i) => i.tipo === "crearElemento" && i.tag === "wokwi-led")
  const crearPulsador = instrucciones.find((i) => i.tipo === "crearElemento" && i.tag === "wokwi-pushbutton")

  assert.equal(crearPlaca.etiquetaRol, null, "la placa no tiene rol")
  assert.equal(crearLed.etiquetaRol, "Salida")
  assert.equal(crearPulsador.etiquetaRol, "Entrada")
})

test("pintar: el rótulo de rol se pinta DENTRO del MISMO contenedor que su pieza, con el texto capitalizado — nunca hermano suelto de #circuito", () => {
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-0" }, tag: "wokwi-pushbutton", atributos: { color: "green" }, etiquetaRol: "Entrada" },
  ]
  const doc = documentoFake()
  const raiz = pintar(doc, instrucciones)
  // Fix post-gate (v2-gpio34-blocking.png): la pieza CON rol va envuelta en un
  // único contenedor -- nunca un hermano suelto que flex-wrap pueda separar a otra
  // línea.
  assert.equal(raiz.circuito.hijos.length, 1, "un ÚNICO contenedor por pieza-con-rol, nunca dos hermanos sueltos")
  const contenedor = raiz.circuito.hijos[0]
  assert.notEqual(contenedor.tagName, "wokwi-pushbutton", "la pieza no es hija directa de #circuito: está envuelta")
  assert.equal(contenedor.hijos.length, 2, "el contenedor tiene adentro la pieza + su rótulo")
  const [pieza, rotulo] = contenedor.hijos
  assert.equal(pieza.tagName, "wokwi-pushbutton")
  assert.equal(rotulo.textContent, "Entrada")
  assert.equal(contenedor.atributos["data-entidad-id"], "cmp-0", "el contenedor repite el mismo data-entidad-id que la pieza")
  assert.equal(pieza.atributos["data-entidad-id"], contenedor.atributos["data-entidad-id"], "mismo data-entidad-id entre pieza y contenedor")
})

test("pintar: sin etiquetaRol (null), no se agrega ningún elemento de rol ni ningún contenedor extra", () => {
  const instrucciones = [{ tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {}, etiquetaRol: null }]
  const doc = documentoFake()
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.circuito.hijos.length, 1)
  assert.equal(raiz.circuito.hijos[0].tagName, "wokwi-esp32-devkit-v1", "sin rol, la placa sigue siendo hija DIRECTA de #circuito (sin envoltorio innecesario)")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3b. Fix post-gate (Chromium real, .../s2impl/gate-vista/v2-gpio34-blocking.png):
// "Entrada" del pulsador se veía debajo del ESP32 (otra línea del flex-wrap), lejos
// de su pieza -- porque el rótulo era un HERMANO SUELTO de #circuito, y flex-wrap
// podía separarlo de su elemento Wokwi. Reproduce el escenario completo
// (placa+LED+pulsador, por operaciones REALES del Engine) y demuestra que ya no pasa.
// ════════════════════════════════════════════════════════════════════════════════════

test("fix v2-gpio34-blocking.png: ningún rótulo de rol es hijo DIRECTO de #circuito; cada rótulo vive en el MISMO contenedor que su pieza (mismo data-entidad-id)", () => {
  const dir = nuevoDir("s2-rol-fix-contenedor")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[1].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "mismo Path A que disparó el defecto en el gate (GPIO34, PIN_SIN_PULLUP_INTERNO, blocking)")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const instrucciones = planDePintado(vista)
  const doc = documentoFake()
  const raiz = pintar(doc, instrucciones)

  // Physical View UX #1: el rol ahora lo dice la ZONA (título "Entrada"/"Salida"), y
  // cada pieza lleva su NOMBRE en el mismo contenedor. Mismo invariante que el defecto
  // original: nada suelto como hijo directo de #circuito — sólo zonas.
  const todos = (n) => [n, ...(n.hijos ?? []).flatMap(todos)]
  for (const hijo of raiz.circuito.hijos) {
    assert.ok(hijo.atributos["data-zona"], "los únicos hijos directos de #circuito son zonas (ningún rótulo ni pieza suelta)")
  }
  const zona = (rol) => raiz.circuito.hijos.find((z) => z.atributos["data-zona"] === rol)
  const tituloDe = (rol) => todos(zona(rol)).find((n) => n.atributos?.["data-zona-titulo"] === rol).textContent

  // El contenedor del pulsador tiene, adentro, la pieza Y su nombre, con el MISMO
  // data-entidad-id — y vive en la zona Entrada.
  const contenedorPulsador = todos(zona("entrada")).find((n) => n.tagName === "figure" && todos(n).some((h) => h.tagName === "wokwi-pushbutton"))
  assert.ok(contenedorPulsador, "hay un contenedor con la pieza del pulsador adentro, en la zona Entrada")
  assert.equal(tituloDe("entrada"), "Entrada")
  const piezaPulsador = todos(contenedorPulsador).find((h) => h.tagName === "wokwi-pushbutton")
  const nombrePulsador = todos(contenedorPulsador).find((h) => h.atributos?.["data-nombre-pieza"] === idPulsador)
  assert.ok(nombrePulsador, "el nombre del pulsador está en el MISMO contenedor que su pieza")
  assert.equal(nombrePulsador.textContent, "Pulsador")
  assert.equal(piezaPulsador.atributos["data-entidad-id"], idPulsador)
  assert.equal(contenedorPulsador.atributos["data-entidad-id"], idPulsador, "el contenedor repite el mismo data-entidad-id que la pieza")

  // Ídem para el LED, en la zona Salida.
  const contenedorLed = todos(zona("salida")).find((n) => n.tagName === "figure" && todos(n).some((h) => h.tagName === "wokwi-led"))
  assert.ok(contenedorLed)
  assert.equal(tituloDe("salida"), "Salida")
  const nombreLed = todos(contenedorLed).find((h) => h.atributos?.["data-nombre-pieza"] === idLed)
  assert.ok(nombreLed, "el nombre del LED está en el MISMO contenedor que su pieza")
  assert.equal(nombreLed.textContent, "LED")
  assert.equal(contenedorLed.atributos["data-entidad-id"], idLed)

  // data-afectado/el mapa en memoria NO se rompen: el motivo blocking del pulsador
  // (GPIO34) sigue marcando la PIEZA (nunca el contenedor ni ningún otro elemento).
  assert.equal(piezaPulsador.atributos["data-afectado"], "blocking")
  assert.equal(contenedorPulsador.atributos["data-afectado"], undefined, "data-afectado sigue en la pieza, no en el contenedor")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Escaneo estático: el browser JS no tiene ninguna tabla de clases/tipos (§3.3)
// ════════════════════════════════════════════════════════════════════════════════════

test("§3.3: opencode/vista-fisica/web/*.js no contiene ninguna tabla de clases/tipos/capacidades/severidades", () => {
  const dirWeb = join(REPO, "opencode/vista-fisica/web")
  const PATRONES_PROHIBIDOS = [
    /\bactuador\b/i,
    /\bpasivo\b/i,
    /\bsensor\b/i,
    /\bclase\s*:/i,
    /rolPorTipo/i,
    /ROL_POR_TIPO/i,
    /TIPO_POR_ROL/i,
    /requierePullUpInterno/i,
    /requierePwm/i,
    /\bcapacidades\s*:/i,
    /obtenerComponente/i,
  ]
  const archivos = readdirSync(dirWeb).filter((f) => f.endsWith(".js"))
  assert.ok(archivos.length > 0, "fixture: tiene que haber al menos un .js en vista-fisica/web")
  for (const archivo of archivos) {
    const contenido = readFileSync(join(dirWeb, archivo), "utf8")
    for (const patron of PATRONES_PROHIBIDOS) {
      assert.ok(!patron.test(contenido), `${archivo} no puede contener ${patron} -- ninguna tabla de clases/tipos en el browser JS (§3.3)`)
    }
  }
})
