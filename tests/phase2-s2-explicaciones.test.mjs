// Phase 2, Slice 2 — W-S2-VISTA, §3.4 (explicación de motivos + resaltado).
// docs/programacion-intencion/PHASE_2_SLICE_2_DESIGN.md §3.4, HD-S2-8 (A + C
// acotado), R-4 (textos APROBADOS por el humano).
//
// Cubre, en orden:
//  1. Los 8 códigos de la tabla, con `datos` REALES producidos por el Engine (nunca
//     fabricados a mano) -> el texto exacto de §3.4.
//  2. Un código desconocido -> `explicacion: null`, la fila se muestra cruda.
//  3. Determinismo: dos proyecciones de la MISMA IR dan el mismo texto.
//  4. Resaltado: `data-entidad-tipo`/`data-entidad-id` en la fila de motivo, y
//     `data-afectado="<severidad>"` en el elemento del componente afectado.
//
// Demuestra, en conjunto (briefing, punto 7): el browser NUNCA calcula la
// explicación — llega resuelta en el snapshot (`vista.motivos[].explicacion`); ver
// también `phase2-s2-rol.test.mjs` (sin tabla de clases/tipos) y
// `phase2-s2-sin-logica.test.mjs` (sin lógica pulsador->LED).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, catalogo, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto, op } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const { explicacionDeMotivo } = await import(join(REPO, "opencode/vista-fisica/explicaciones-motivos.ts"))
const { LED, PULSADOR } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// "document" fake — MISMO patrón que tests/phase2-pintar.test.mjs (createElement/
// setAttribute/appendChild, textContent como propiedad plana).
// ════════════════════════════════════════════════════════════════════════════════════

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

/** Busca, recursivamente, un descendiente por `tagName` — necesario desde el fix
 * post-gate (v2-gpio34-blocking.png, `phase2-s2-rol.test.mjs`): una pieza CON rol ya
 * no es hija directa de `raiz.circuito`, está envuelta en su propio contenedor
 * (`<figure>`) junto con su rótulo. */
function buscarPieza(nodo, tag) {
  for (const hijo of nodo.hijos ?? []) {
    if (hijo.tagName === tag) return hijo
    const enHijo = buscarPieza(hijo, tag)
    if (enHijo) return enHijo
  }
  return undefined
}

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures — un proyecto real por código, por operaciones REALES del Engine.
// ════════════════════════════════════════════════════════════════════════════════════

function nuevoServicio(nombre) {
  const dir = nuevoDir(nombre)
  const idProyecto = nuevoIdProyecto()
  return obtenerServicioDeProyecto({ directorio: dir, idProyecto })
}

function motivoDe(vista, codigo) {
  const motivo = vista.motivos.find((m) => m.codigo === codigo)
  assert.ok(motivo, `fixture: se esperaba encontrar el motivo ${codigo}`)
  return motivo
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Los 8 códigos, con datos REALES del Engine -> el texto exacto de §3.4
// ════════════════════════════════════════════════════════════════════════════════════

test("PIN_SIN_PULLUP_INTERNO: pulsador.senal en GPIO34 (solo-entrada)", () => {
  const servicio = nuevoServicio("s2-expl-pullup")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "D11: representable, la operación sigue aceptando")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_SIN_PULLUP_INTERNO")
  assert.deepEqual(motivo.datos, { pin: "GPIO34", terminal: "senal", restriccion: "soloEntrada" })
  assert.equal(motivo.entidad.id, idPulsador)
  assert.equal(
    motivo.explicacion,
    `El ${PULSADOR.nombreVisible} necesita la resistencia interna (pull-up) del pin, y GPIO34 no la tiene: es sólo de entrada. Elegí otro pin.`,
  )
})

test("PIN_OCUPADO: LED.anodo y pulsador.senal en el MISMO pin (GPIO4)", () => {
  const servicio = nuevoServicio("s2-expl-ocupado")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: "GPIO4" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[1].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO4" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "D11: PIN_OCUPADO es representable, no rechaza")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_OCUPADO")
  assert.deepEqual(motivo.datos, { pin: "GPIO4", ocupadoPor: idLed })
  assert.equal(motivo.entidad.id, idPulsador)
  assert.equal(motivo.explicacion, `GPIO4 ya lo está usando otro componente (${LED.nombreVisible}). Cada pin puede tener una sola conexión de señal.`)
})

test("REQUISITO_INSATISFECHO: LED sin resistencia en serie conectada al ánodo", () => {
  const servicio = nuevoServicio("s2-expl-requisito")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: "GPIO4" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "REQUISITO_INSATISFECHO")
  assert.deepEqual(motivo.datos, { componente: "led", requisito: "resistencia-serie", terminal: "anodo", esperado: "resistencia" })
  assert.equal(motivo.entidad.id, idLed)
  assert.equal(motivo.explicacion, `Al ${LED.nombreVisible} le falta algo que necesita para funcionar sin riesgo (resistencia-serie en anodo).`)
})

test("PIN_STRAPPING: pulsador.senal en GPIO2 (severidad info, resto de la clase)", () => {
  const servicio = nuevoServicio("s2-expl-strapping")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO2" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_STRAPPING")
  assert.equal(motivo.severidad, "info")
  assert.deepEqual(motivo.datos, { pin: "GPIO2", terminal: "senal", restriccion: "strapping" })
  assert.equal(motivo.explicacion, "GPIO2 participa del arranque de la placa: puede molestar al encenderla.")
})

test("PIN_UART_USB: pulsador.senal en GPIO1", () => {
  const servicio = nuevoServicio("s2-expl-uart")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_UART_USB")
  assert.deepEqual(motivo.datos, { pin: "GPIO1", terminal: "senal", restriccion: "uartUsb", impacto: "carga del programa y Monitor Serie" })
  assert.equal(motivo.explicacion, "GPIO1 lo usa el USB: puede interferir con la carga del programa y con el Monitor Serie.")
})

test("PIN_FLASH_RESERVADO: pulsador.senal en GPIO6", () => {
  const servicio = nuevoServicio("s2-expl-flash")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO6" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_FLASH_RESERVADO")
  assert.deepEqual(motivo.datos, { pin: "GPIO6", terminal: "senal", restriccion: "flashReservado" })
  assert.equal(motivo.explicacion, "GPIO6 está conectado a la memoria interna de la placa: no se puede usar.")
})

test("CAPACIDAD_PIN_INCOMPATIBLE: LED.anodo (salida) en GPIO34 (solo-entrada, sin salidaDigital)", () => {
  const servicio = nuevoServicio("s2-expl-capacidad")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "D11: la operación ASIGNA igual, la incompatibilidad es representable")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "CAPACIDAD_PIN_INCOMPATIBLE")
  assert.deepEqual(motivo.datos, { terminal: "anodo", pin: "GPIO34", requierePwm: false })
  assert.equal(motivo.entidad.id, idLed)
  assert.equal(motivo.explicacion, `GPIO34 no puede hacer lo que necesita el ${LED.nombreVisible} en anodo.`)
})

test("PIN_INEXISTENTE_EN_DOCUMENTO: pulsador.senal asignado en ESP32 (GPIO4), después SetPlaca a arduino-uno", () => {
  const servicio = nuevoServicio("s2-expl-inexistente")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO4" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("SetPlaca", { placa: "arduino-uno" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "cambiar de placa no re-valida ni limpia las asignaciones viejas")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const motivo = motivoDe(vista, "PIN_INEXISTENTE_EN_DOCUMENTO")
  assert.deepEqual(motivo.datos, { pin: "GPIO4", terminal: "senal", placa: "arduino-uno" })
  assert.equal(motivo.entidad.id, idPulsador)
  assert.equal(motivo.explicacion, "GPIO4 no existe en esta placa. Elegí otro pin.")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Código desconocido -> null, fila cruda
// ════════════════════════════════════════════════════════════════════════════════════

test("explicacionDeMotivo: un código que no está en la tabla da null (nunca inventa texto)", () => {
  assert.equal(explicacionDeMotivo("CODIGO_QUE_NO_EXISTE_TODAVIA", { algo: 1 }, () => "x"), null)
  assert.equal(explicacionDeMotivo("CODIGO_QUE_NO_EXISTE_TODAVIA", undefined, () => "x"), null)
})

test("planDePintado + pintar: explicacion:null -> la fila muestra sólo el crudo '[severidad] codigo (clasificacion)'", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "panelMotivo", codigo: "CODIGO_DESCONOCIDO", severidad: "warning", clasificacion: "representable", entidad: null, explicacion: null }]
  const raiz = pintar(doc, instrucciones)
  const fila = raiz.motivos.hijos[0]
  assert.equal(fila.textContent, "[warning] CODIGO_DESCONOCIDO (representable)")
  assert.equal(fila.hijos.length, 0, "sin explicacion, ningun hijo extra en la fila")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. Determinismo
// ════════════════════════════════════════════════════════════════════════════════════

test("proyectarVista es determinista: el mismo proyecto proyectado dos veces da EXACTAMENTE la misma explicacion", () => {
  const servicio = nuevoServicio("s2-expl-determinismo")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const proyecto = servicio.snapshot().proyecto
  const vista1 = proyectarVista(proyecto, catalogo)
  const vista2 = proyectarVista(proyecto, catalogo)
  assert.deepEqual(vista1.motivos, vista2.motivos)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Resaltado: data-entidad-*/data-afectado
// ════════════════════════════════════════════════════════════════════════════════════

test("pintarMotivo: la fila lleva data-entidad-tipo/data-entidad-id cuando el motivo tiene entidad", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "panelMotivo", codigo: "PIN_OCUPADO", severidad: "blocking", clasificacion: "representable", entidad: { tipo: "componente", id: "cmp-1" }, explicacion: "texto" },
  ]
  const raiz = pintar(doc, instrucciones)
  const fila = raiz.motivos.hijos[0]
  assert.equal(fila.atributos["data-entidad-tipo"], "componente")
  assert.equal(fila.atributos["data-entidad-id"], "cmp-1")
})

test("pintar: el elemento del componente afectado recibe data-afectado=<severidad>", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {}, etiquetaRol: null },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-1" }, tag: "wokwi-pushbutton", atributos: { color: "green" }, etiquetaRol: "Entrada" },
    { tipo: "panelMotivo", codigo: "PIN_SIN_PULLUP_INTERNO", severidad: "blocking", clasificacion: "representable", entidad: { tipo: "componente", id: "cmp-1" }, explicacion: "texto" },
  ]
  const raiz = pintar(doc, instrucciones)
  const pulsador = buscarPieza(raiz.circuito, "wokwi-pushbutton")
  assert.equal(pulsador.atributos["data-afectado"], "blocking")
  const placaElemento = buscarPieza(raiz.circuito, "wokwi-esp32-devkit-v1")
  assert.equal(placaElemento.atributos["data-afectado"], undefined, "la placa no tiene ningun motivo, no se marca")
})

test("pintar: un motivo sin entidad no marca ningun elemento (nunca inventa una entidad)", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-1" }, tag: "wokwi-led", atributos: { color: "red" }, etiquetaRol: "Salida" },
    { tipo: "panelMotivo", codigo: "X", severidad: "info", clasificacion: null, entidad: null, explicacion: null },
  ]
  const raiz = pintar(doc, instrucciones)
  const led = buscarPieza(raiz.circuito, "wokwi-led")
  assert.equal(led.atributos["data-afectado"], undefined)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. Integración: planDePintado ya trae `explicacion` desde la vista real
// ════════════════════════════════════════════════════════════════════════════════════

test("planDePintado: la instruccion panelMotivo trae la explicacion tal cual vino de proyectarVista", () => {
  const servicio = nuevoServicio("s2-expl-plan")
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const instrucciones = planDePintado(vista)
  const panel = instrucciones.find((i) => i.tipo === "panelMotivo" && i.codigo === "PIN_SIN_PULLUP_INTERNO")
  assert.ok(panel)
  assert.equal(panel.explicacion, vista.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO").explicacion)
  assert.ok(panel.explicacion.includes("pull-up"))
})
