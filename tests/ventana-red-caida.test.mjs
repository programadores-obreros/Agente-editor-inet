// La ventana «vista física» cuando el cambio de un pin NO LLEGA al servidor.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). Al revisar el rediseño de la ventana se encontró que, si
// Tecnia Bot se cerraba (o se cortaba la red) justo cuando el alumno cambiaba un pin, la página
// no decía nada y el selector quedaba mostrando el pin elegido, que nunca se había guardado: el
// `fetch` rechazaba, `enviarCambioGpio` no tenía `catch`, y el coalescer de GPIO usa el mismo
// manejador para éxito y rechazo, así que el error se perdía sin dejar rastro. Un selector que
// muestra un pin que el proyecto no tiene es un OK falso: el alumno cablea lo que ve.
//
// QUÉ SE MIDE. No el texto de la fuente: se EJECUTA el camino real (`crearClienteHttp` +
// `crearEnvioDeCambioGpio` + el coalescer + `planDePintado` + `pintar`) con un `fetch` que
// rechaza, y se mira lo que queda pintado y lo que quedó dicho.
//
// MUTACIONES que ponen rojo este archivo (probadas con el arreglo ya commiteado):
//   - sacar el `repintar()` del `catch` de `cliente-http.js::enviarSobre`   → los tres primeros tests
//   - sacar el `mostrarEstado(avisoSiFalla)` de ese mismo `catch`           → «avisa con el texto del servidor»
//   - no pasar `avisoSiFalla` desde `app.js::crearEnvioDeCambioGpio`        → «avisa con el texto del servidor»
//   - sacar el `finally` que desbloquea la frase                            → «la frase queda desbloqueada»
//   - cambiar el texto del anexo de pedagogía                               → «el texto es el aprobado»
//
// Corre con: node --test tests/ventana-red-caida.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { crearClienteHttp } = await import(join(REPO, "opencode/vista-fisica/web/cliente-http.js"))
const { crearEnvioDeCambioGpio, crearCoalescerCambiosGpio } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const { TEXTOS_DE_LA_VENTANA } = await import(join(REPO, "opencode/conocimiento/anexos/pedagogia-es-AR.ts"))

// ── Un documento mínimo: lo que `pintar.js` usa, más `value` y los manejadores de `change` ──
function documentoFake() {
  const crear = (tag) => ({
    tagName: tag,
    atributos: {},
    hijos: [],
    textContent: "",
    value: "",
    manejadores: {},
    setAttribute(k, v) {
      this.atributos[k] = String(v)
    },
    appendChild(h) {
      this.hijos.push(h)
      return h
    },
    addEventListener(tipo, fn) {
      ;(this.manejadores[tipo] ??= []).push(fn)
    },
    disparar(tipo) {
      for (const fn of this.manejadores[tipo] ?? []) fn()
    },
  })
  return { createElement: crear }
}
const todos = (nodo) => [nodo, ...(nodo.hijos ?? []).flatMap(todos)]

let n = 0
/** Proyecto real (motor + vista de producción): ESP32 + LED con el ánodo en GPIO_X. */
function proyectoConLed() {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("ventana-red"), idProyecto: nuevoIdProyecto("red") })
  for (const [tipo, payload] of [
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: GPIO_X }],
  ]) {
    const r = servicio.aplicar({ idOperacion: `red-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
  }
  return servicio
}

/**
 * La página, sin navegador: el mismo cableado que `app.js` (cliente → envío de GPIO → coalescer →
 * plan → pintor), con `fetch` inyectado. `selector()` es el <select> del ánodo en lo que está
 * pintado AHORA.
 */
function pagina(servicio, fetchFalso) {
  const p = { snapshot: JSON.parse(JSON.stringify(servicio.snapshot())), estados: [], repintadas: 0, raiz: null, externa: [], timers: [] }
  const repintar = () => {
    p.repintadas++
    p.raiz = pintar(documentoFake(), planDePintado(p.snapshot.vista), { onCambioGpio: (e) => coalescer.registrarCambio(e.componenteId, e.terminalId, e.valor) })
  }
  const cliente = crearClienteHttp({ fetch: fetchFalso, aplicarSnapshot: (s) => (p.snapshot = s), repintar, mostrarEstado: (t) => p.estados.push(t), token: "x" })
  const enviar = crearEnvioDeCambioGpio({
    obtenerSnapshot: () => p.snapshot,
    enviarSobre: (sobre, opciones) => cliente.enviarSobre(sobre, opciones),
    siguienteIdOperacion: () => `red-nav-${n++}`,
    marcarOperacionExterna: (v) => p.externa.push(v),
  })
  const coalescer = crearCoalescerCambiosGpio({
    programar: (fn) => p.timers.push(fn),
    cancelarProgramado: () => {},
    enviar,
    obtenerValorServidor: (c, t) => {
      const terminal = p.snapshot.vista.componentes.find((x) => x.id === c)?.terminales[t]
      return terminal?.estado === "asignado" ? terminal.pinSemantico : null
    },
  })
  p.selector = () => todos(p.raiz.controles).find((x) => x.tagName === "select" && x.atributos["data-terminal-id"] === "anodo")
  /** El alumno elige `pin` en el selector y vence el debounce. */
  p.elegir = (pin) => {
    const selector = p.selector()
    selector.value = pin
    selector.disparar("change")
    for (const fn of p.timers.splice(0)) fn()
  }
  p.enviar = enviar
  p.cliente = cliente
  repintar()
  p.repintadas = 0
  return p
}

const asentar = () => new Promise((resolve) => setImmediate(resolve))
const redCaida = () => Promise.reject(new TypeError("fetch failed"))

test("red caída al cambiar un pin: el selector vuelve al pin GUARDADO, no queda mostrando el que se eligió", async () => {
  const servicio = proyectoConLed()
  try {
    const p = pagina(servicio, redCaida)
    assert.equal(p.selector().value, GPIO_X, "precondición: el selector arranca en el pin del proyecto")
    const viejo = p.selector()
    p.elegir(GPIO_Y)
    assert.equal(viejo.value, GPIO_Y, "precondición: el selector que tocó el alumno muestra lo que eligió")
    await asentar()
    assert.notEqual(p.selector(), viejo, "la página no se repintó: sigue en pantalla el selector con el pin que no se guardó")
    assert.equal(p.selector().value, GPIO_X, "tras la falla, lo pintado es el pin que el servidor tiene")
    assert.equal(p.repintadas, 1)
    assert.equal(servicio.snapshot().proyecto.componentes[0].pines.anodo, GPIO_X, "el proyecto no cambió")
  } finally {
    servicio.cerrar()
  }
})

test("red caída al cambiar un pin: avisa con el texto que mandó el servidor", async () => {
  const servicio = proyectoConLed()
  try {
    const p = pagina(servicio, redCaida)
    p.elegir(GPIO_Y)
    await asentar()
    assert.deepEqual(p.estados, [servicio.snapshot().vista.textos.cambioDePinNoGuardado], "el aviso sale del snapshot, no de un texto escrito en el navegador")
    assert.equal(p.estados[0], TEXTOS_DE_LA_VENTANA.cambioDePinNoGuardado)
  } finally {
    servicio.cerrar()
  }
})

test("el texto es el aprobado para este caso", () => {
  assert.equal(TEXTOS_DE_LA_VENTANA.cambioDePinNoGuardado, "No se pudo guardar el cambio: se cortó la conexión con Tecnia Bot. El pin quedó como estaba.")
})

test("una respuesta que no se puede leer cuenta como falla: avisa, repinta y no pisa el snapshot", async () => {
  const servicio = proyectoConLed()
  try {
    const cortada = () => Promise.resolve({ status: 200, json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")) })
    const p = pagina(servicio, cortada)
    const antes = p.snapshot
    p.elegir(GPIO_Y)
    await asentar()
    assert.equal(p.selector().value, GPIO_X)
    assert.equal(p.estados.length, 1)
    assert.equal(p.snapshot, antes, "sin respuesta legible no hay snapshot nuevo que aplicar")
  } finally {
    servicio.cerrar()
  }
})

test("red caída: el error se relanza, la frase queda desbloqueada y el próximo cambio se puede mandar", async () => {
  const servicio = proyectoConLed()
  try {
    let pedidos = 0
    const p = pagina(servicio, () => {
      pedidos++
      return redCaida()
    })
    await assert.rejects(p.enviar({ componenteId: "cmp-0", terminalId: "anodo", valor: GPIO_Y }), /fetch failed/, "quien llama tiene que enterarse de que no se guardó")
    assert.deepEqual(p.externa, [true, false], "la frase de reglas no puede quedar bloqueada para siempre por un pedido que falló")
    // El coalescer libera su turno con rechazo igual que con éxito: el intento siguiente sale.
    p.elegir(GPIO_Y)
    await asentar()
    p.elegir(GPIO_Y)
    await asentar()
    assert.equal(pedidos, 3, "después de una falla, un cambio nuevo tiene que volver a intentarse")
  } finally {
    servicio.cerrar()
  }
})

test("la frase y los bloques (repintarAhora: false) también vuelven al snapshot si la red falla, sin aviso de pin", async () => {
  const estados = []
  let repintadas = 0
  const cliente = crearClienteHttp({ fetch: redCaida, aplicarSnapshot: () => assert.fail("no hay snapshot que aplicar"), repintar: () => repintadas++, mostrarEstado: (t) => estados.push(t) })
  await assert.rejects(cliente.enviarSobre({ tipo: "SetComportamiento" }, { repintarAhora: false }), /fetch failed/)
  assert.equal(repintadas, 1)
  assert.deepEqual(estados, [], "el aviso de las reglas lo pone quien llamó (su texto es otro): acá no se inventa uno")
})
