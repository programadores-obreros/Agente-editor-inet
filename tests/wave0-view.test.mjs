// Phase 3, Wave 0 — writer W-W0-VIEW (PHASE_3_WAVE_0_DESIGN.md, filas F-11/F-09/
// "vista vacía" W0-8). Insumo: PHASE_2_SIMULATED_ROLE_TRIAL.md.
//
// Causas mapeadas (ver el mapa de hallazgos del diseño):
// - app.js:111-158 — un POST por cada `change`, sin estado pendiente (F-11).
// - app.js:84-96 `repintar()` hace `replaceChildren` de TODO el DOM (pierde el foco).
// - pintar.js:132 arma la etiqueta `"${componenteId} / ${terminalId}: "`; pintar.js:124
//   arma el cable `"${desde} → ${hasta}"` con el nombre Wokwi crudo del terminal — para
//   el pulsador eso es literalmente `"1.l"`/`"2.l"` (`TERMINAL_WOKWI_POR_TIPO.pulsador`,
//   `wokwi-render-datos.ts`), el pin INTERNO que usa el custom element Wokwi, no un
//   texto para un estudiante.
// - `ModeloDeVista` no tenía `nombreVisible` ni una etiqueta humana por terminal.
//
// Cubre, en orden:
//  1. `etiquetas-terminales.ts` (tabla de PRESENTACIÓN nueva): anodo/catodo/senal/gnd/
//     a/b + fallback al propio id para un terminal desconocido.
//  2. `snapshot-a-vista.ts`: `ComponenteVista.nombre` (nombreVisible + ordinal estable
//     si hay duplicados) y `TerminalVista.etiqueta`, contra el catálogo REAL, vía el
//     composition root real (mismo patrón que `phase2-vista-fisica.test.mjs`).
//  3. `plan-de-pintado.js` + `pintar.js`, con la vista REAL de un pulsador cableado:
//     el texto del control ("Pulsador — señal:"), el texto de los cables ("Pulsador
//     (señal)"/"Pulsador (GND)"/"GND") y que NINGÚN texto primario pintado contiene
//     `cmp-N`, `senal` ni `1.l`/`2.l` (el escaneo recorre TODO el árbol fake, no sólo
//     una fila).
//  4. Lo mismo con dos LED (mismo tipo): el ordinal ("LED"/"LED 2") tiene que
//     distinguirse en el texto de los cables, nunca colapsar a "LED" para ambos.
//  5. W0-8: `estadoVacio` — `planDePintado` lo agrega SÓLO si no hay placa NI
//     componentes, y `pintar.js` lo dibuja visible (nunca una superficie vacía).
//  6. F-11, coalescing puro (`crearCoalescerCambiosGpio`, `opencode/vista-fisica/
//     web/app.js`): el módulo es PURO salvo los `programar`/`cancelarProgramado`/
//     `enviar`/`obtenerValorServidor` que el llamador inyecta (reloj falso en este
//     archivo — nunca un `setTimeout` real, mismo criterio "sin sleep" que ya usa
//     `estado-conexion.js`/`plan-de-pintado.js` para ser testeables sin reloj real).
//  7. F-11, foco: `elegirSelectorParaFoco` (función PURA) — el "document fake, o una
//     función pura que elija el elemento a enfocar" que pide el briefing.
//
// NOTA (por qué `crearCoalescerCambiosGpio`/`elegirSelectorParaFoco` necesitan un stub
// mínimo antes del commit RED y el resto NO): `app.js` ya existe pero no exporta estos
// dos nombres todavía — importar un export inexistente de un módulo ES ya cargado es
// un error de LINK (no una aserción), así que antes del commit RED se agrega un stub
// mínimo, deliberadamente incompleto, que hace que el import funcione y cada test
// falle por ASERCIÓN semántica (ver el commit RED para el detalle exacto del stub).
// `proyectarVista`/`planDePintado`/`pintar` YA EXISTEN y ya exportan lo que hace falta
// — ahí no hace falta ningún stub: fallan solos, por aserción, contra el código real.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, catalogo, nuevoDir, nuevoIdProyecto, op, obtenerServicioDeProyecto, GPIO_Z } from "./phase2-helpers.mjs"

const { etiquetaDeTerminal } = await import(join(REPO, "opencode/vista-fisica/etiquetas-terminales.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const { crearCoalescerCambiosGpio, elegirSelectorParaFoco } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures locales — document fake (MISMO criterio que tests/phase2-pintar.test.mjs:
// sólo createElement/setAttribute/appendChild/addEventListener, nada de DOM real).
// ════════════════════════════════════════════════════════════════════════════════════

function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    _textContent: "",
    _listeners: {},
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
    addEventListener(tipo, manejador) {
      this._listeners[tipo] = this._listeners[tipo] ?? []
      this._listeners[tipo].push(manejador)
    },
    get textContent() {
      return this._textContent
    },
    set textContent(valor) {
      this._textContent = valor
    },
    get value() {
      return this._value ?? ""
    },
    set value(valor) {
      this._value = valor
    },
  }
}

function documentoFake() {
  return {
    createElement(tag) {
      return elementoFake(tag)
    },
  }
}

/** Recorre TODO el árbol (no sólo una fila) juntando cada `textContent` no vacío —
 * así "ningún texto primario contiene X" se puede verificar sobre el plan COMPLETO
 * pintado (circuito + cables + controles + motivos), nunca sobre un fragmento elegido
 * a mano que podría esconder una fuga en otro lado. */
function recolectarTextos(elemento) {
  const propio = elemento.textContent ?? ""
  const deHijos = (elemento.hijos ?? []).flatMap((hijo) => recolectarTextos(hijo))
  return propio ? [propio, ...deHijos] : deHijos
}

function pintarCompleto(vista, opciones) {
  const plan = planDePintado(vista, opciones)
  const raiz = pintar(documentoFake(), plan)
  const textos = [raiz.circuito, raiz.cables, raiz.controles, raiz.motivos].flatMap(recolectarTextos)
  return { plan, raiz, textos }
}

/** Arma, vía el composition root REAL, un proyecto ESP32 + un pulsador con `senal`
 * asignado a GPIO_Z — mismo estilo que `phase2-helpers.mjs::prepararProyectoConLed`,
 * pero para el fixture de este writer (nunca se edita `phase2-helpers.mjs`: es
 * compartido con otros writers de la Wave 0). */
function prepararProyectoConPulsador(directorio, idProyecto) {
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  const idPulsador = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: GPIO_Z }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AsignarPin rechazado: ${JSON.stringify(r.motivos)}`)
  return { servicio, idPulsador }
}

function prepararProyectoConDosLed(directorio, idProyecto) {
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
  for (let i = 0; i < 2; i += 1) {
    r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
    if (!r.ok) throw new Error(`fixture: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  }
  return { servicio }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. etiquetas-terminales.ts — tabla de PRESENTACIÓN
// ════════════════════════════════════════════════════════════════════════════════════

test("etiquetaDeTerminal: anodo/catodo/senal/gnd/a/b tienen su etiqueta humana (catalogo-datos.ts: LED, Pulsador, Resistencia)", () => {
  assert.equal(etiquetaDeTerminal("anodo"), "ánodo (+)")
  assert.equal(etiquetaDeTerminal("catodo"), "cátodo (−)")
  assert.equal(etiquetaDeTerminal("senal"), "señal")
  assert.equal(etiquetaDeTerminal("gnd"), "GND")
  assert.equal(etiquetaDeTerminal("a"), "pata A")
  assert.equal(etiquetaDeTerminal("b"), "pata B")
})

test("etiquetaDeTerminal: un terminal que la tabla no conoce todavia usa su propio id (fail-closed, nunca inventa un texto)", () => {
  assert.equal(etiquetaDeTerminal("terminal-futuro-no-mapeado"), "terminal-futuro-no-mapeado")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. snapshot-a-vista.ts — ComponenteVista.nombre (+ ordinal) y TerminalVista.etiqueta
// ════════════════════════════════════════════════════════════════════════════════════

test("proyectarVista: un LED solo se proyecta con nombre 'LED' (nombreVisible del catalogo, sin ordinal)", () => {
  const dir = nuevoDir("wave0-view-nombre-unico")
  const { servicio } = (() => {
    const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto() })
    let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
    assert.equal(r.ok, true)
    r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
    assert.equal(r.ok, true)
    return { servicio }
  })()

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  assert.equal(vista.componentes.length, 1)
  assert.equal(vista.componentes[0].nombre, "LED", "nombreVisible del catalogo real (catalogo-datos.ts), sin ordinal: es el unico LED")
  assert.equal(vista.componentes[0].terminales.anodo.etiqueta, "ánodo (+)")
  assert.equal(vista.componentes[0].terminales.catodo.etiqueta, "cátodo (−)")

  servicio.cerrar()
})

test("proyectarVista: DOS LED en el mismo proyecto se distinguen con un ordinal estable ('LED', 'LED 2'), en el orden de Proyecto.componentes", () => {
  const dir = nuevoDir("wave0-view-nombre-duplicado")
  const { servicio } = prepararProyectoConDosLed(dir, nuevoIdProyecto())

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  assert.equal(vista.componentes.length, 2)
  assert.equal(vista.componentes[0].nombre, "LED", "el PRIMER LED no lleva ordinal")
  assert.equal(vista.componentes[1].nombre, "LED 2", "el SEGUNDO LED del MISMO tipo sí lleva ordinal")

  servicio.cerrar()
})

test("proyectarVista: el Pulsador proyecta terminales.senal.etiqueta='señal' y terminales.gnd.etiqueta='GND'", () => {
  const dir = nuevoDir("wave0-view-pulsador-etiquetas")
  const { servicio } = prepararProyectoConPulsador(dir, nuevoIdProyecto())

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  assert.equal(vista.componentes[0].nombre, "Pulsador")
  assert.equal(vista.componentes[0].terminales.senal.etiqueta, "señal")
  assert.equal(vista.componentes[0].terminales.gnd.etiqueta, "GND")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. plan-de-pintado.js + pintar.js — Pulsador real: controles, cables, SIN fuga de ids
// ════════════════════════════════════════════════════════════════════════════════════

test("F-09: el control del Pulsador se titula 'Pulsador — señal:' (nunca 'cmp-0 / senal: ')", () => {
  const dir = nuevoDir("wave0-view-control-pulsador")
  const { servicio, idPulsador } = prepararProyectoConPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const { plan } = pintarCompleto(vista)
  const selector = plan.find((i) => i.tipo === "selectorGpio" && i.componenteId === idPulsador && i.terminalId === "senal")
  assert.ok(selector, "tiene que haber un selector de GPIO para pulsador.senal")
  assert.equal(selector.etiqueta, "Pulsador — señal:")

  servicio.cerrar()
})

test("F-09: los cables del Pulsador muestran 'Pulsador (señal)' y 'Pulsador (GND)' -> 'GND' (nunca el nombre Wokwi interno '1.l'/'2.l')", () => {
  const dir = nuevoDir("wave0-view-cables-pulsador")
  const { servicio } = prepararProyectoConPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const { plan } = pintarCompleto(vista)
  const filasCable = plan.filter((i) => i.tipo === "filaCable")
  assert.equal(filasCable.length, 2, "cable de senal (al pin asignado) + cable de gnd (riel fijo)")

  const cableSenal = filasCable.find((f) => f.desde === "Pulsador (señal)" || f.hasta === "Pulsador (señal)")
  assert.ok(cableSenal, `ningun cable muestra 'Pulsador (señal)': ${JSON.stringify(filasCable)}`)

  // Physical View UX #1: el destino es el terminal de potencia de la placa, "GND (masa)".
  const cableGnd = filasCable.find((f) => f.desde === "Pulsador (GND)" && f.hasta === "GND (masa)")
  assert.ok(cableGnd, `el cable del GND tiene que ser 'Pulsador (GND) -> GND (masa)': ${JSON.stringify(filasCable)}`)

  servicio.cerrar()
})

test("F-09: NINGUN texto primario pintado (circuito+cables+controles+motivos) contiene 'cmp-', 'senal' ni '1.l'/'2.l'", () => {
  const dir = nuevoDir("wave0-view-sin-fuga-ids")
  const { servicio } = prepararProyectoConPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const { textos } = pintarCompleto(vista)
  const textoCompleto = textos.join(" | ")

  assert.ok(!textoCompleto.includes("cmp-"), `fuga de id crudo de componente: ${textoCompleto}`)
  assert.ok(!textoCompleto.includes("senal"), `fuga del id crudo del terminal: ${textoCompleto}`)
  assert.ok(!textoCompleto.includes("1.l"), `fuga del nombre Wokwi interno del pulsador: ${textoCompleto}`)
  assert.ok(!textoCompleto.includes("2.l"), `fuga del nombre Wokwi interno del pulsador: ${textoCompleto}`)

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. plan-de-pintado.js + pintar.js — dos LED: el ordinal se distingue en el texto
// ════════════════════════════════════════════════════════════════════════════════════

test("F-09: con DOS LED, los cables del catodo distinguen 'LED (cátodo (−))' de 'LED 2 (cátodo (−))' (nunca colapsan al mismo texto)", () => {
  const dir = nuevoDir("wave0-view-dos-led-cables")
  const { servicio } = prepararProyectoConDosLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const { plan } = pintarCompleto(vista)
  const filasCable = plan.filter((i) => i.tipo === "filaCable")

  const cableUno = filasCable.find((f) => f.desde === "LED (cátodo (−))" && f.hasta === "GND (masa)")
  const cableDos = filasCable.find((f) => f.desde === "LED 2 (cátodo (−))" && f.hasta === "GND (masa)")
  assert.ok(cableUno, `falta el cable del primer LED, sin ordinal: ${JSON.stringify(filasCable)}`)
  assert.ok(cableDos, `falta el cable del segundo LED, CON ordinal: ${JSON.stringify(filasCable)}`)

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. W0-8 — estadoVacio
// ════════════════════════════════════════════════════════════════════════════════════

const VISTA_VACIA = Object.freeze({ placa: null, componentes: [], cables: [], gpiosDisponibles: {}, motivos: [], readiness: { listo: false, invalido: false, incompleto: true } })

test("W0-8: planDePintado(vista SIN placa ni componentes) agrega una instruccion 'estadoVacio' con el texto exacto", () => {
  const plan = planDePintado(VISTA_VACIA)
  const instruccion = plan.find((i) => i.tipo === "estadoVacio")
  assert.ok(instruccion, `el plan de una vista vacia tiene que traer 'estadoVacio': ${JSON.stringify(plan)}`)
  assert.equal(instruccion.texto, "Este proyecto todavía no tiene componentes. Pedile a Tecnia Bot que lo arme.")
})

test("W0-8: planDePintado(vista CON placa/componentes) NUNCA agrega 'estadoVacio'", () => {
  const dir = nuevoDir("wave0-view-estado-no-vacio")
  const { servicio } = prepararProyectoConPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const plan = planDePintado(vista)
  assert.equal(
    plan.filter((i) => i.tipo === "estadoVacio").length,
    0,
    "un proyecto armado nunca muestra el estado vacio",
  )
  servicio.cerrar()
})

test("W0-8: pintar() dibuja el estado vacio VISIBLE (un nodo con ese texto, no una superficie vacia)", () => {
  const { textos } = pintarCompleto(VISTA_VACIA)
  assert.ok(
    textos.includes("Este proyecto todavía no tiene componentes. Pedile a Tecnia Bot que lo arme."),
    `el arbol pintado tiene que mostrar el texto del estado vacio: ${JSON.stringify(textos)}`,
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. F-11 — coalescing puro de cambios de GPIO (`crearCoalescerCambiosGpio`, app.js)
// ════════════════════════════════════════════════════════════════════════════════════

/** Reloj FALSO — nunca `setTimeout` real (mismo criterio "sin sleep" que ya aplica el
 * resto de `vista-fisica/web/`): `programar` registra el callback sin ejecutarlo,
 * `cancelar` lo descarta, `avanzar()` ejecuta TODO lo que siga vivo en ese instante
 * (simula "pasaron los 300ms" para cada timer que no fue cancelado antes). */
function crearRelojFalso() {
  let siguienteId = 0
  const pendientes = new Map()
  return {
    programar(fn) {
      const id = (siguienteId += 1)
      pendientes.set(id, fn)
      return id
    },
    cancelar(id) {
      pendientes.delete(id)
    },
    avanzar() {
      const fns = [...pendientes.values()]
      pendientes.clear()
      for (const fn of fns) fn()
    },
    pendientesVivos() {
      return pendientes.size
    },
  }
}

/** `enviar` FALSO — nunca hace `fetch` real: registra cada pedido y devuelve una
 * promesa que el test resuelve a mano (`resolverUltimoEnvio`), para controlar
 * exactamente cuándo "vuelve" el POST en vuelo. */
function crearEnviarControlable() {
  const llamadas = []
  let resolverPendiente = null
  function enviar(pedido) {
    llamadas.push(pedido)
    return new Promise((resolve) => {
      resolverPendiente = resolve
    })
  }
  function resolverUltimoEnvio() {
    const r = resolverPendiente
    resolverPendiente = null
    assert.ok(r, "resolverUltimoEnvio: no hay ningun envio pendiente para resolver")
    r()
  }
  return { enviar, llamadas, resolverUltimoEnvio }
}

test("F-11 coalescing: una rafaga D, D1, D19 en el MISMO selector dentro del debounce produce UN SOLO envio, con D19", () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas } = crearEnviarControlable()
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => null })

  coalescer.registrarCambio("cmp-0", "anodo", "D")
  coalescer.registrarCambio("cmp-0", "anodo", "D1")
  coalescer.registrarCambio("cmp-0", "anodo", "D19")

  assert.equal(reloj.pendientesVivos(), 1, "los dos primeros timers se cancelaron al llegar el cambio siguiente: sólo queda vivo el de D19")
  reloj.avanzar()

  assert.equal(llamadas.length, 1, "nunca se manda un POST por 'D' ni por 'D1' — ningun valor intermedio se aplica")
  assert.deepEqual(llamadas[0], { componenteId: "cmp-0", terminalId: "anodo", valor: "D19" })
})

test("F-11 coalescing: selectores DISTINTOS tienen debounce INDEPENDIENTE (uno no cancela el timer del otro) — pero el envio sigue siendo 'a lo sumo UN POST en vuelo', GLOBAL", () => {
  // CORRECCIÓN post-RED (ver el commit GREEN): la primera versión de este test
  // esperaba `llamadas.length === 2` tras `avanzar()`, asumiendo que dos selectores
  // distintos podían tener dos POST EN VUELO al mismo tiempo. Eso contradice la
  // propia regla de F-11 que este archivo ya documenta más abajo ("a lo sumo UN POST
  // en vuelo", GLOBAL — el servidor tiene una sola `baseRevision` por proyecto, dos
  // POST simultáneos se pisarían la revisión entre sí). Lo que SÍ es independiente
  // por selector es el DEBOUNCE (ningún timer cancela al del otro) — eso es lo que
  // este test verifica ahora: ambos timers siguen vivos hasta que cada uno vence, pero
  // sólo el PRIMERO en vencer despacha un POST; el segundo se ENCOLA (mismo camino que
  // "a lo sumo un POST en vuelo" ya prueba con un solo selector, acá con dos).
  const reloj = crearRelojFalso()
  const { enviar, llamadas } = crearEnviarControlable()
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => null })

  coalescer.registrarCambio("cmp-0", "anodo", "GPIO4")
  coalescer.registrarCambio("cmp-1", "senal", "GPIO18")

  assert.equal(reloj.pendientesVivos(), 2, "dos selectores distintos: DOS timers de debounce vivos, ninguno cancela al otro")
  reloj.avanzar()
  assert.equal(llamadas.length, 1, "el PRIMERO en vencer despacha; el segundo se encola (a lo sumo un POST en vuelo, GLOBAL — nunca dos en paralelo)")
})

test("F-11 coalescing: a lo sumo UN POST en vuelo — un cambio que llega mientras hay uno en curso se encola y se envia SOLO al volver, con el valor de servidor ya actualizado", async () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas, resolverUltimoEnvio } = crearEnviarControlable()
  let valorServidor = null
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => valorServidor })

  coalescer.registrarCambio("cmp-0", "anodo", "GPIO4")
  reloj.avanzar() // dispara el debounce: nada en vuelo todavia -> sale YA
  assert.equal(llamadas.length, 1)

  // Llega OTRO cambio en el MISMO selector mientras el primer POST sigue sin resolver.
  coalescer.registrarCambio("cmp-0", "anodo", "GPIO16")
  reloj.avanzar() // su debounce termina ANTES de que el primer POST resuelva

  assert.equal(llamadas.length, 1, "con un POST en vuelo, el cambio se ENCOLA — nunca se manda un segundo POST todavia")

  // El servidor, al aplicar el primer POST, queda en GPIO4 (coincide con lo que se mando).
  valorServidor = "GPIO4"
  resolverUltimoEnvio()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(llamadas.length, 2, "al volver el POST en vuelo, se envia el PEDIDO ENCOLADO (GPIO16), con el snapshot ya actualizado")
  assert.deepEqual(llamadas[1], { componenteId: "cmp-0", terminalId: "anodo", valor: "GPIO16" })
})

test("F-11 coalescing: si el valor final coincide con el valor vigente del servidor, no se envia nada", () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas } = crearEnviarControlable()
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => "GPIO4" })

  coalescer.registrarCambio("cmp-0", "anodo", "GPIO4")
  reloj.avanzar()

  assert.equal(llamadas.length, 0, "el valor elegido ya es el que tiene el servidor: no hace falta ningun POST")
})

test("F-11 coalescing: el pedido ENCOLADO tambien se descarta si, al volver, ya coincide con el servidor (nunca un POST de mas)", async () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas, resolverUltimoEnvio } = crearEnviarControlable()
  let valorServidor = null
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => valorServidor })

  coalescer.registrarCambio("cmp-0", "anodo", "GPIO4")
  reloj.avanzar()
  assert.equal(llamadas.length, 1)

  coalescer.registrarCambio("cmp-0", "anodo", "GPIO16")
  reloj.avanzar()
  assert.equal(llamadas.length, 1, "encolado, no enviado todavia")

  // El servidor, por otra via (ej. otro actor), ya quedo en GPIO16 cuando el primer
  // POST vuelve: el pedido encolado ya no tiene nada que aportar.
  valorServidor = "GPIO16"
  resolverUltimoEnvio()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(llamadas.length, 1, "el pedido encolado coincidia con el servidor al volver: se descarta, nunca se manda")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6b. FX-1 (RED-AUTH-01/02, triage de la ronda de fixes) — el "pedido encolado" es un
// Map POR SELECTOR, nunca una variable global, y el arrepentimiento del PROPIO
// selector en vuelo nunca se pierde.
// ════════════════════════════════════════════════════════════════════════════════════

test("FX-1 (RED-AUTH-01): TRES selectores distintos durante un POST en vuelo -- NINGUNO se pierde (cola por selector, nunca un pedido global)", async () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas, resolverUltimoEnvio } = crearEnviarControlable()
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => null })

  // A despacha de una (nada en vuelo todavia).
  coalescer.registrarCambio("cmp-A", "x", "GPIO4")
  reloj.avanzar()
  assert.equal(llamadas.length, 1, "A sale de una")

  // Mientras A sigue en vuelo, B Y C (dos selectores MAS, distintos entre si) terminan
  // su debounce -- los DOS tienen que quedar encolados, ninguno pisa al otro (la
  // version con un solo "pedidoEncolado" global hacia que C pisara a B acá mismo).
  coalescer.registrarCambio("cmp-B", "y", "GPIO16")
  coalescer.registrarCambio("cmp-C", "z", "GPIO18")
  reloj.avanzar()
  assert.equal(llamadas.length, 1, "con A en vuelo, B y C se ENCOLAN -- todavia ningun POST nuevo")

  // Vuelve A: se despacha el PRIMERO de la cola (B) -- C sigue esperando, pero nunca
  // se perdio.
  resolverUltimoEnvio()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(llamadas.length, 2, "al volver A, se despacha B")
  assert.deepEqual(llamadas[1], { componenteId: "cmp-B", terminalId: "y", valor: "GPIO16" })

  // Vuelve B: se despacha C -- exactamente el que la variable global perdia.
  resolverUltimoEnvio()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(llamadas.length, 3, "al volver B, se despacha C -- los TRES valores finales llegaron, de a uno")
  assert.deepEqual(llamadas[2], { componenteId: "cmp-C", terminalId: "z", valor: "GPIO18" })
})

test("FX-1 (RED-AUTH-02): arrepentimiento -- el alumno vuelve al valor ANTERIOR mientras su PROPIO POST sigue en vuelo, y el valor final queda en el servidor", async () => {
  const reloj = crearRelojFalso()
  const { enviar, llamadas, resolverUltimoEnvio } = crearEnviarControlable()
  let valorServidor = "GPIO4" // valor YA aplicado antes de este escenario
  const coalescer = crearCoalescerCambiosGpio({ programar: reloj.programar, cancelarProgramado: reloj.cancelar, enviar, obtenerValorServidor: () => valorServidor })

  // El alumno cambia GPIO4 -> GPIO16: despacha YA (nada en vuelo todavia).
  coalescer.registrarCambio("cmp-0", "anodo", "GPIO16")
  reloj.avanzar()
  assert.equal(llamadas.length, 1)

  // Mientras ESE POST sigue sin resolver, el alumno se ARREPIENTE y vuelve a GPIO4 --
  // el MISMO valor que el servidor todavia tiene en su snapshot (stale, pre-POST). La
  // version con el bug comparaba contra ESE snapshot viejo, veia "ya coincide" y no
  // encolaba nada: el arrepentimiento se perdia para siempre.
  coalescer.registrarCambio("cmp-0", "anodo", "GPIO4")
  reloj.avanzar()
  assert.equal(llamadas.length, 1, "todavia no se manda nada nuevo -- pero TIENE que quedar encolado, aunque 'parezca' coincidir con el snapshot viejo")

  // El POST en vuelo resuelve: el servidor queda en GPIO16 (lo que se mando).
  valorServidor = "GPIO16"
  resolverUltimoEnvio()
  await Promise.resolve()
  await Promise.resolve()

  // El pedido encolado (GPIO4, el arrepentimiento) se re-evalua contra el servidor YA
  // actualizado (GPIO16) -- difieren, asi que se manda: el valor final en el servidor
  // tiene que ser el que el alumno de verdad queria.
  assert.equal(llamadas.length, 2, "el arrepentimiento SI se manda -- nunca se pierde por comparar contra el snapshot pre-POST")
  assert.deepEqual(llamadas[1], { componenteId: "cmp-0", terminalId: "anodo", valor: "GPIO4" })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7. F-11 — foco: elegirSelectorParaFoco (funcion PURA)
// ════════════════════════════════════════════════════════════════════════════════════

test("F-11 foco: elegirSelectorParaFoco devuelve el selector EQUIVALENTE (mismo componente/terminal) tras un repintado simulado", () => {
  const disponiblesTrasRepintar = [
    { componenteId: "cmp-0", terminalId: "anodo" },
    { componenteId: "cmp-1", terminalId: "senal" },
  ]
  const elegido = elegirSelectorParaFoco(disponiblesTrasRepintar, { componenteId: "cmp-1", terminalId: "senal" })
  assert.deepEqual(elegido, { componenteId: "cmp-1", terminalId: "senal" })
})

test("F-11 foco: sin foco anterior (null), no elige nada", () => {
  const disponibles = [{ componenteId: "cmp-0", terminalId: "anodo" }]
  assert.equal(elegirSelectorParaFoco(disponibles, null), null)
})

test("F-11 foco: si el selector que tenia el foco ya no existe tras el repintado, no elige nada (fail-closed, nunca enfoca cualquier cosa)", () => {
  const disponibles = [{ componenteId: "cmp-0", terminalId: "catodo" }]
  const elegido = elegirSelectorParaFoco(disponibles, { componenteId: "cmp-0", terminalId: "anodo" })
  assert.equal(elegido, null)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 8. FX-3 (RED-W0-UX (a), triage de la ronda de fixes) — panel de MOTIVOS: con
// explicación en texto llano, se ve SÓLO esa explicación -- nunca "[blocking]"/el
// código crudo/"(representable)" como texto primario (quedan en data-*).
// ════════════════════════════════════════════════════════════════════════════════════

test("FX-3: panelMotivo CON explicación muestra SÓLO el texto llano -- nunca '[severidad] codigo (clasificacion)' crudo", () => {
  const doc = documentoFake()
  const instrucciones = [
    {
      tipo: "panelMotivo",
      codigo: "REQUISITO_INSATISFECHO",
      severidad: "blocking",
      clasificacion: "representable",
      entidad: { tipo: "componente", id: "cmp-0" },
      explicacion: "Al LED le falta algo que necesita para funcionar sin riesgo (resistencia-serie en anodo).",
    },
  ]
  const raiz = pintar(doc, instrucciones)
  const fila = raiz.motivos.hijos[0]
  assert.equal(fila.textContent, "Al LED le falta algo que necesita para funcionar sin riesgo (resistencia-serie en anodo).")
  assert.doesNotMatch(fila.textContent, /\[blocking\]/, "no puede quedar el corchete de severidad crudo en el texto primario")
  assert.doesNotMatch(fila.textContent, /REQUISITO_INSATISFECHO/, "el codigo crudo no puede ser texto PRIMARIO -- sigue disponible en data-motivo-codigo")
  assert.doesNotMatch(fila.textContent, /\(representable\)/, "la clasificacion cruda no puede ser texto PRIMARIO -- sigue disponible en data-*")
  // El código/severidad/clasificación SIGUEN disponibles como data-*, para quien los necesite.
  assert.equal(fila.atributos["data-motivo-codigo"], "REQUISITO_INSATISFECHO")
  assert.equal(fila.atributos["data-motivo-severidad"], "blocking")
  assert.equal(fila.atributos["data-motivo-clasificacion"], "representable")
})

test("FX-3: panelMotivo SIN explicación (null) mantiene el fallback crudo de siempre (contrato Slice 2: nunca se oculta un código sin traducir)", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "panelMotivo", codigo: "CODIGO_SIN_TRADUCIR", severidad: "warning", clasificacion: null, entidad: null, explicacion: null }]
  const raiz = pintar(doc, instrucciones)
  const fila = raiz.motivos.hijos[0]
  assert.equal(fila.textContent, "[warning] CODIGO_SIN_TRADUCIR")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 9. FX-4 (RED-W0-UX (c), triage) — la vista nombra el pin con su nombre SEMÁNTICO
// (lo que dice el bot, "GPIO18") más el rótulo de la placa entre paréntesis (lo que el
// alumno ve dibujado, "D18") -- en las opciones del selector y en los cables.
// ════════════════════════════════════════════════════════════════════════════════════

test("FX-4: el selector de GPIO y el cable muestran 'GPIO18 (D18)' (nombre semántico primero, rótulo de la placa entre paréntesis) -- nunca sólo 'D18'", () => {
  const dir = nuevoDir("wave0-fx4-nombre-semantico")
  const { servicio, idPulsador } = prepararProyectoConPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const { plan } = pintarCompleto(vista)
  const selector = plan.find((i) => i.tipo === "selectorGpio" && i.componenteId === idPulsador && i.terminalId === "senal")
  assert.ok(selector)
  const opcionGpio18 = selector.opciones.find((o) => o.valor === "GPIO18")
  assert.ok(opcionGpio18, `tiene que ofrecer GPIO18: ${JSON.stringify(selector.opciones)}`)
  assert.equal(opcionGpio18.etiqueta, "GPIO18 (D18)", "nombre SEMÁNTICO (lo que dice el bot) primero, rótulo de la placa (lo que el alumno ve dibujado) entre paréntesis")

  const filasCable = plan.filter((i) => i.tipo === "filaCable")
  const cableSenal = filasCable.find((f) => f.desde === "GPIO18 (D18)" || f.hasta === "GPIO18 (D18)")
  assert.ok(cableSenal, `el cable del pin tiene que mostrar 'GPIO18 (D18)': ${JSON.stringify(filasCable)}`)

  servicio.cerrar()
})
