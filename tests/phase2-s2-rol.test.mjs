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

test("pintar: el rótulo de rol se pinta como un elemento propio, con el texto capitalizado, dentro de raiz.circuito", () => {
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-0" }, tag: "wokwi-pushbutton", atributos: { color: "green" }, etiquetaRol: "Entrada" },
  ]
  const doc = documentoFake()
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.circuito.hijos.length, 2, "el elemento wokwi + su rótulo de rol")
  const [pieza, rotulo] = raiz.circuito.hijos
  assert.equal(pieza.tagName, "wokwi-pushbutton")
  assert.equal(rotulo.textContent, "Entrada")
})

test("pintar: sin etiquetaRol (null), no se agrega ningún elemento de rol", () => {
  const instrucciones = [{ tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {}, etiquetaRol: null }]
  const doc = documentoFake()
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.circuito.hijos.length, 1)
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
