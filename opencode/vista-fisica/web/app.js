// app.js — Phase 2, Slice 1 (writer W3, tarea 3). Único módulo que habla con el
// transporte (`fetch`/`EventSource`) y decide qué hacer con la respuesta. Nunca pinta
// nada por su cuenta: siempre delega en `planDePintado` (puro) + `pintar` (tonto).
//
// Invariante central, repetido en el diseño y en el informe ARCH-B ("Comportamiento
// ante fallas"): la vista NUNCA se actualiza de forma optimista. Cada repintado sale
// de un snapshot que YA vino del servidor (el de `/api/proyecto`, o el que trae la
// propia respuesta de `POST /api/operaciones`) — jamás de lo que el usuario acaba de
// elegir en el selector. Si el POST tarda o falla, la vista se queda mostrando el
// último snapshot autoritativo recibido.

import { planDePintado } from "./plan-de-pintado.js"
import { pintar } from "./pintar.js"
import { reducirEstadoConexion, ESTADO_INICIAL } from "./estado-conexion.js"

// Fase 3, Wave 0 (F-11, PHASE_3_WAVE_0_DESIGN.md): `tests/wave0-view.test.mjs`
// importa `crearCoalescerCambiosGpio`/`elegirSelectorParaFoco` (PURAS, ver más abajo)
// SIN ejecutar el bootstrap real de este módulo (`document`/`EventSource`/`fetch`,
// inexistentes bajo `node --test`) — por eso todo lo que toca el DOM de verdad al
// cargar el módulo queda detrás de este chequeo de feature-detection. En el navegador
// real `document` SIEMPRE existe, así que el comportamiento ahí no cambia un bit; en
// Node (los tests), el módulo carga sin tocar nada, y sólo las funciones puras
// exportadas son invocables.
const enNavegador = typeof document !== "undefined"

// ════════════════════════════════════════════════════════════════════════════════════
// F-11 (PHASE_3_WAVE_0_DESIGN.md) — coalescing PURO de cambios de GPIO.
//
// Causa raíz (F-11, PHASE_2_SIMULATED_ROLE_TRIAL.md): antes, CADA evento `change` del
// `<select>` disparaba un POST propio, con `baseRevision` del snapshot vigente EN ESE
// INSTANTE. Tipear "D19" carácter por carácter mandaba un POST por "D", otro por "D1"
// y otro por "D19" — y como cada POST corre contra el servidor real, el segundo podía
// volver DESPUÉS que el tercero, pisando el valor final con uno viejo, o el servidor
// rechazaba el segundo como `BASE_REVISION_DESACTUALIZADA` ("otro cambio llegó
// primero") cuando en realidad el "otro cambio" era EL MISMO USUARIO, todavía
// escribiendo. `repintar()` además hacía `replaceChildren` de TODO el DOM en cada
// vuelta, así que el `<select>` perdía el foco a mitad de tecleo.
//
// Esta función es PURA salvo por lo que el llamador INYECTA (`programar`/
// `cancelarProgramado` — equivalentes de `setTimeout`/`clearTimeout`, para poder
// testear con un reloj FALSO, nunca un timer real; `enviar` — el POST real, inyectado
// por este mismo archivo más abajo; `obtenerValorServidor` — lee `ultimoSnapshot`, SIN
// que este módulo tenga que conocerlo). El browser SIGUE sin ser autoridad: lo único
// que esta función decide es CUÁNDO mandar un pedido, nunca si se aplica — eso lo
// sigue decidiendo el Engine, como siempre.
//
// Reglas (F-11, una x selector, identificado por `componenteId`+`terminalId`):
//  - debounce de `debounceMs` (300 por defecto): cada cambio nuevo en el MISMO
//    selector cancela el timer anterior y programa uno nuevo — sólo el ÚLTIMO valor
//    elegido llega a decidirse.
//  - a lo sumo UN POST en vuelo, GLOBAL (no por selector: el servidor tiene una sola
//    `baseRevision` para el proyecto entero, dos POST simultáneos siempre van a pisar
//    la revisión del otro). Si el debounce de CUALQUIER selector termina mientras ya
//    hay un POST en curso, el pedido se ENCOLA — pero la cola es un Map POR SELECTOR
//    (FX-1, ronda de fixes, RED-AUTH-01: antes era UNA sola variable global, y un
//    TERCER selector que terminaba su debounce pisaba, sin aviso, lo que un SEGUNDO
//    selector ya había encolado — el pedido de ese segundo selector se perdía para
//    siempre). Un pedido nuevo del MISMO selector sigue reemplazando al anterior
//    ("sólo el ÚLTIMO valor elegido" vale, por selector), pero nunca pisa el de OTRO
//    selector que también esté esperando su turno.
//  - al volver el POST en vuelo, se despacha el PRÓXIMO selector de la cola (uno por
//    vez — nunca dos POST en paralelo, sigue valiendo "a lo sumo UN POST en vuelo,
//    GLOBAL"): se re-evalúa CONTRA EL VALOR DE SERVIDOR YA ACTUALIZADO (nunca el de
//    antes del POST) — salvo que sea el MISMO selector cuyo propio POST acaba de
//    volver (FX-1, RED-AUTH-02: un "arrepentimiento" mientras el POST de ESE selector
//    sigue en vuelo comparaba contra el snapshot VIEJO, pre-POST, y se perdía — ver
//    `decidirEnvio`, más abajo).
//  - si el valor final (al vencer el debounce, o al desencolar) ya coincide con el
//    valor vigente del servidor, no se manda NADA — salvo el caso de arriba (mismo
//    selector en vuelo), donde el snapshot "vigente" todavía no refleja ESE POST.
export function crearCoalescerCambiosGpio({ debounceMs = 300, programar = (fn, ms) => setTimeout(fn, ms), cancelarProgramado = (id) => clearTimeout(id), enviar, obtenerValorServidor } = {}) {
  const timerPorSelector = new Map() // "componenteId\u0000terminalId" -> id de timer vivo
  let enVuelo = false
  // FX-1 (RED-AUTH-01): Map POR CLAVE (mismo patrón que `timerPorSelector`) — cada
  // selector tiene su propio lugar en la cola, nunca pisa el de otro.
  const pedidosEncolados = new Map() // clave -> el pedido en espera de ESE selector
  // FX-1 (RED-AUTH-02): la clave del selector cuyo POST está en vuelo AHORA MISMO (o
  // `null`) — necesaria para decidir si "ya coincide con el servidor" es un chequeo
  // válido (ver `decidirEnvio`).
  let claveEnVuelo = null

  function clave(componenteId, terminalId) {
    return `${componenteId}\u0000${terminalId}`
  }

  function registrarCambio(componenteId, terminalId, valor) {
    const k = clave(componenteId, terminalId)
    const timerPrevio = timerPorSelector.get(k)
    if (timerPrevio !== undefined) cancelarProgramado(timerPrevio)
    const id = programar(() => {
      timerPorSelector.delete(k)
      decidirEnvio(componenteId, terminalId, valor)
    }, debounceMs)
    timerPorSelector.set(k, id)
  }

  function decidirEnvio(componenteId, terminalId, valor) {
    const k = clave(componenteId, terminalId)
    // FX-1 (RED-AUTH-02): si el POST en vuelo AHORA MISMO es el de ESTE MISMO
    // selector, `obtenerValorServidor()` todavía lee el snapshot ANTERIOR a ese POST
    // (stale para este selector en particular) — compararlo contra un
    // "arrepentimiento" (volver al valor viejo) lo confundiría con un no-op y lo
    // perdería para siempre. En ese caso especial, SIEMPRE se encola, nunca se
    // compara contra el snapshot viejo.
    const esElMismoSelectorEnVuelo = enVuelo && claveEnVuelo === k
    if (!esElMismoSelectorEnVuelo && valor === obtenerValorServidor(componenteId, terminalId)) return // ya coincide: nada que mandar
    const pedido = { componenteId, terminalId, valor }
    if (enVuelo) {
      pedidosEncolados.set(k, pedido) // reemplaza el pedido ANTERIOR del MISMO selector, nunca el de otro
      return
    }
    despachar(k, pedido)
  }

  function despachar(k, pedido) {
    enVuelo = true
    claveEnVuelo = k
    Promise.resolve(enviar(pedido)).then(alVolverElPost, alVolverElPost)
  }

  function alVolverElPost() {
    enVuelo = false
    claveEnVuelo = null
    despacharSiguienteDeLaCola()
  }

  // FX-1: procesa la cola selector por selector — re-evalúa cada uno contra el valor
  // de servidor YA actualizado por el POST que acaba de volver (nunca el de antes).
  // Si `decidirEnvio` despacha un POST real, el `while` corta solo (a lo sumo UN POST
  // en vuelo, GLOBAL: el resto de la cola espera a que ÉSE vuelva). Si fue un no-op
  // (ya coincidía), sigue con el PRÓXIMO selector encolado en la MISMA vuelta —
  // ningún selector encolado se pierde por quedar "detrás" de un no-op.
  function despacharSiguienteDeLaCola() {
    while (!enVuelo && pedidosEncolados.size > 0) {
      const [k, pedido] = pedidosEncolados.entries().next().value
      pedidosEncolados.delete(k)
      decidirEnvio(pedido.componenteId, pedido.terminalId, pedido.valor)
    }
  }

  return { registrarCambio }
}

/**
 * F-11 — foco: función PURA que elige, de la lista de selectores que el repintado
 * ACABA de crear, el que es "el mismo" que tenía el foco antes de repintar (mismo
 * componente/terminal). Nunca toca el DOM ella misma — quien la llama (`restaurarFoco`,
 * más abajo) es quien de verdad hace `.focus()` sobre el elemento real.
 *
 * `disponibles`: `{componenteId, terminalId}[]` — los selectores que existen DESPUÉS
 * del repintado. `focoAnterior`: `{componenteId, terminalId} | null` — lo que tenía el
 * foco ANTES (o `null` si nada lo tenía, o si lo que tenía el foco no era un selector
 * de GPIO). Si no hay match (ej. el terminal dejó de tener selector), `null` — nunca
 * elige "cualquier cosa": fail-closed, mismo criterio que el resto de `vista-fisica/`.
 */
export function elegirSelectorParaFoco(disponibles, focoAnterior) {
  if (!focoAnterior) return null
  return disponibles.find((s) => s.componenteId === focoAnterior.componenteId && s.terminalId === focoAnterior.terminalId) ?? null
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3 (T5, contrato B7) — la FRASE editable de las reglas. Funciones PURAS (dependencias
// inyectadas, testeables sin DOM ni red). El navegador sigue sin ser autoridad: arma la
// regla ENTERA a partir de lo que el servidor proyectó (`reglas[i].forma`, `opcionesRegla`)
// y manda UN `SetComportamiento` por cambio; el Engine decide. No hay tablas de clases,
// capacidades ni estados acá: cada opción de `opcionesRegla.slots` trae su `parche`.
// ════════════════════════════════════════════════════════════════════════════════════

/** Arma la operación de UN cambio de la frase. `regla`: el elemento de `vista.reglas`, o
 * `null` para una regla nueva (nace con ese único slot y SIN id: lo asigna el Engine).
 * La opción elegida trae su `parche` (qué le agrega a la regla): acá sólo se mezcla. */
export function construirOperacionRegla({ regla, slot, valor, opcionesRegla }) {
  const forma = regla ? regla.forma : {}
  const parche = buscarOpcion(slot, valor, opcionesRegla).parche
  const cuando = forma.cuando || parche.cuando ? { ...forma.cuando, ...parche.cuando } : undefined
  const entonces = forma.entonces || parche.entonces ? { ...forma.entonces, ...parche.entonces } : undefined
  const comportamiento = { ...(regla ? { id: regla.id } : {}), ...(cuando ? { cuando } : {}), ...(entonces ? { entonces } : {}) }
  return { tipo: "SetComportamiento", payload: { comportamiento } }
}

function buscarOpcion(slot, valor, opcionesRegla) {
  const definicion = (opcionesRegla.slots ?? []).find((s) => s.slot === slot)
  return definicion?.opciones.find((o) => o.valor === valor)
}

/** Foco de la frase tras repintar: el control equivalente (misma regla y slot) o `null`. */
export function elegirControlReglaParaFoco(disponibles, focoAnterior) {
  if (!focoAnterior) return null
  return disponibles.find((c) => c.reglaId === focoAnterior.reglaId && c.slot === focoAnterior.slot) ?? null
}

function valorEsOpcion(slot, valor, opcionesRegla) {
  return valor !== null && valor !== undefined && buscarOpcion(slot, valor, opcionesRegla) !== undefined
}

/**
 * Controlador de la frase. Garantías (F-11 se mantiene): a lo sumo UNA operación en vuelo
 * (la propia o una externa, ej. un cambio de GPIO), todos los controles deshabilitados
 * mientras tanto, y un repintado SIEMPRE desde el snapshot de la respuesta (`alCambiar`
 * lo dispara el llamador). "Agregar regla" no crea nada: la regla nace con el primer selector.
 * - `obtenerSnapshot()`: el último snapshot autoritativo (`{revision, vista}`).
 * - `enviar({tipo, payload, baseRevision})`: hace el POST; resuelve con `{resultado}`.
 */
export function crearControladorReglas({ obtenerSnapshot, enviar, alCambiar }) {
  let pendiente = false
  let externa = false
  let reglaNueva = false
  const trazasAbiertas = new Set()

  const ocupado = () => pendiente || externa

  async function ejecutar(operacion) {
    pendiente = true
    alCambiar()
    let cuerpo = null
    try {
      cuerpo = await enviar({ ...operacion, baseRevision: obtenerSnapshot().revision })
    } finally {
      pendiente = false
    }
    if (cuerpo?.resultado?.ok) reglaNueva = false
    alCambiar()
    return true
  }

  return {
    opciones: () => ({ operacionPendiente: ocupado(), reglaNueva, trazasAbiertas: [...trazasAbiertas] }),
    marcarOperacionExterna(valor) {
      externa = Boolean(valor)
    },
    agregar() {
      if (ocupado()) return false
      reglaNueva = true
      alCambiar()
      return true
    },
    async cambiar({ reglaId, slot, valor }) {
      if (ocupado()) return false
      const snapshot = obtenerSnapshot()
      if (!snapshot?.vista) return false
      const { opcionesRegla } = snapshot.vista
      // Sólo valores OFRECIDOS: "condición avanzada" (no editable) y vaciar un slot no envían nada.
      if (!valorEsOpcion(slot, valor, opcionesRegla)) return false
      const regla = reglaId === null ? null : (snapshot.vista.reglas.find((r) => r.id === reglaId) ?? null)
      if (reglaId !== null && regla === null) return false
      return ejecutar(construirOperacionRegla({ regla, slot, valor, opcionesRegla }))
    },
    async quitar({ reglaId }) {
      if (ocupado()) return false
      if (reglaId === null) {
        reglaNueva = false
        alCambiar()
        return true
      }
      return ejecutar({ tipo: "QuitarComportamiento", payload: { comportamiento: reglaId } })
    },
    alternarTraza({ reglaId }) {
      if (trazasAbiertas.has(reglaId)) trazasAbiertas.delete(reglaId)
      else trazasAbiertas.add(reglaId)
      alCambiar()
    },
  }
}

let contenedores = null
let elementoRevision = null
let elementoReadiness = null
let elementoEstado = null
let elementoConexion = null

if (enNavegador) {
  contenedores = {
    circuito: document.getElementById("circuito"),
    cables: document.getElementById("cables"),
    controles: document.getElementById("controles"),
    reglas: document.getElementById("reglas"),
    motivos: document.getElementById("motivos"),
  }
  elementoRevision = document.getElementById("revision")
  elementoReadiness = document.getElementById("readiness")
  elementoEstado = document.getElementById("estado")
  elementoConexion = document.getElementById("conexion")
}

/** Último snapshot AUTORITATIVO recibido (GET /api/proyecto, POST /api/operaciones,
 * o un refetch tras el evento SSE `revision`) — nunca un estado optimista. */
let ultimoSnapshot = null
let contadorOperacion = 0

/** Revisión post red-team (Hallazgo B2, MAJOR, P2-RED-B/INFORME.md, ataque A6): si
 * el servidor se reinicia (puerto efímero nuevo, el caso normal con `listen(0)`)
 * mientras la página sigue abierta, el `EventSource` reintenta CONTRA EL PUERTO
 * MUERTO para siempre — nunca puede reconectar, porque el servidor nuevo es un
 * origin distinto. Antes, la página quedaba exactamente igual, sin ningún indicio.
 * `estadoConexion` (reductor PURO, `estado-conexion.js`) más este indicador visible
 * cierran eso: nunca inventan datos de proyecto, sólo comunican la pérdida de
 * conexión de TRANSPORTE. */
let estadoConexion = ESTADO_INICIAL

const MENSAJE_DESCONECTADO = "desconectado: la vista puede no estar actualizada. Si el servidor se reinició en otro puerto, volvé a abrir la vista física desde Tecnia Bot."

function actualizarIndicadorConexion() {
  if (!elementoConexion) return
  elementoConexion.textContent = estadoConexion === "conectado" ? "conectado" : MENSAJE_DESCONECTADO
  elementoConexion.setAttribute("data-estado-conexion", estadoConexion)
}

/** Procesa un evento NATIVO del `EventSource` (`"error"`/`"open"`) a través del
 * reductor puro, y sólo si el estado CAMBIÓ actualiza el indicador y (en una
 * reconexión real) vuelve a pedir el snapshot — nunca en la apertura inicial
 * (`estadoConexion` ya arrancó en `"conectado"`, no hay transición que atender ahí). */
function manejarEventoConexion(evento) {
  const anterior = estadoConexion
  estadoConexion = reducirEstadoConexion(estadoConexion, evento)
  if (anterior === estadoConexion) return
  actualizarIndicadorConexion()
  if (estadoConexion === "conectado") {
    // Reconexión real (mismo puerto): SIEMPRE se repinta desde un snapshot
    // autoritativo fresco, nunca desde lo que la pestaña ya tenía dibujado.
    cargarSnapshot()
  } else {
    // Desconectado: el selector se deshabilita en el PRÓXIMO repintado — repintar
    // acá mismo (sin esperar un nuevo snapshot) para que se refleje ya mismo, sin
    // inventar ningún dato nuevo de proyecto.
    repintar()
  }
}

function siguienteIdOperacion() {
  contadorOperacion += 1
  return `navegador-${Date.now()}-${contadorOperacion}`
}

function mostrarEstado(texto) {
  elementoEstado.textContent = texto ?? ""
}

/** F-11: lo que tenía el foco ANTES de repintar, si era un selector de GPIO (tiene
 * `data-componente-id`/`data-terminal-id`) — `null` en cualquier otro caso (nada
 * enfocado, o enfocado algo que no es un selector nuestro). Lee el DOM real
 * (`document.activeElement`); la DECISIÓN de qué hacer con esto es de
 * `elegirSelectorParaFoco` (pura, arriba). */
function capturarFocoActual() {
  const activo = document.activeElement
  if (!activo || typeof activo.getAttribute !== "function") return null
  const componenteId = activo.getAttribute("data-componente-id")
  const terminalId = activo.getAttribute("data-terminal-id")
  if (!componenteId || !terminalId) return null
  return { componenteId, terminalId }
}

/** F-11: tras montar la sección de controles recién pintada, re-enfoca el selector
 * EQUIVALENTE (mismo componente/terminal) al que tenía el foco antes de repintar, si
 * sigue existiendo — nunca enfoca "cualquier cosa" (ver `elegirSelectorParaFoco`). */
function restaurarFoco(raizControles, focoAnterior) {
  if (!focoAnterior || typeof raizControles.querySelectorAll !== "function") return
  const disponibles = [...raizControles.querySelectorAll("select[data-componente-id][data-terminal-id]")].map((elemento) => ({
    componenteId: elemento.getAttribute("data-componente-id"),
    terminalId: elemento.getAttribute("data-terminal-id"),
    elemento,
  }))
  const elegido = elegirSelectorParaFoco(
    disponibles.map(({ componenteId, terminalId }) => ({ componenteId, terminalId })),
    focoAnterior,
  )
  if (!elegido) return
  const match = disponibles.find((s) => s.componenteId === elegido.componenteId && s.terminalId === elegido.terminalId)
  if (match && typeof match.elemento.focus === "function") match.elemento.focus()
}

/** Repinta ÍNTEGRO desde `ultimoSnapshot` — nunca actualiza el DOM anterior a
 * pedazos. Si el snapshot no trae `vista` (no debería pasar en producción, donde
 * `servicio-con-vista.ts` siempre inyecta `calcularVista`), no rompe: sólo no dibuja
 * el circuito, deja el resto de la cabecera (revisión/readiness) al día.
 *
 * F-11: captura el foco ANTES de reemplazar el DOM y lo restaura DESPUÉS, sobre el
 * selector equivalente — el `replaceChildren` sigue siendo "repintar TODO" (ninguna
 * actualización parcial, mismo invariante de siempre), sólo que ahora no se pierde el
 * foco en el camino. */
function repintar() {
  if (!ultimoSnapshot) return
  elementoRevision.textContent = `revisión: ${ultimoSnapshot.revision}`
  const readiness = ultimoSnapshot.vista ? ultimoSnapshot.vista.readiness : ultimoSnapshot.validacion.readiness
  elementoReadiness.textContent = readiness.listo ? "listo" : readiness.invalido ? "inválido" : "incompleto"

  if (!ultimoSnapshot.vista) return
  const focoAnterior = capturarFocoActual()
  const instrucciones = planDePintado(ultimoSnapshot.vista, { conexionActiva: estadoConexion === "conectado", ...controladorReglas.opciones() })
  const secciones = pintar(document, instrucciones, {
    onCambioGpio: manejarCambioGpio,
    onCambioRegla: manejarCambioRegla,
    onQuitarRegla: (evento) => controladorReglas.quitar(evento),
    onAgregarRegla: () => controladorReglas.agregar(),
    onAlternarTraza: (evento) => controladorReglas.alternarTraza(evento),
  })
  for (const clave of Object.keys(contenedores)) {
    contenedores[clave].replaceChildren(secciones[clave])
  }
  restaurarFoco(secciones.controles, focoAnterior)
  restaurarFocoRegla(secciones.reglas)
}

async function cargarSnapshot() {
  const respuesta = await fetch("/api/proyecto")
  ultimoSnapshot = await respuesta.json()
  repintar()
}

/** Mensajes MÍNIMOS a partir de los códigos de motivo — nunca se inventa una causa
 * que `nucleo/motivos.ts` no produjo (PHASE_2_SLICE_1_DESIGN.md §2.8/§2.9). */
function descripcionDeMotivos(motivos) {
  if (!motivos || motivos.length === 0) return "rechazado"
  return motivos.map((m) => m.codigo).join(", ")
}

/** F-11: el valor que el servidor tiene HOY para (componenteId, terminalId), leído de
 * `ultimoSnapshot` — `null` si el terminal no está asignado (o no existe). Es lo que
 * `crearCoalescerCambiosGpio` usa para decidir "si el valor final coincide con el del
 * servidor, no se manda nada": siempre lee el snapshot MÁS RECIENTE en el momento en
 * que de verdad se evalúa (nunca uno capturado de antes). */
function valorServidorDe(componenteId, terminalId) {
  const componente = ultimoSnapshot?.vista?.componentes.find((c) => c.id === componenteId)
  const terminal = componente?.terminales?.[terminalId]
  return terminal && terminal.estado === "asignado" ? terminal.pinSemantico : null
}

/** El POST real — misma forma/invariantes que antes de F-11 (sobre firmado con
 * `baseRevision` del ÚLTIMO snapshot autoritativo, nunca optimista; "otro cambio
 * llegó primero" sigue siendo honesto para un conflicto REAL con otro actor — F-11
 * sólo cierra los conflictos FALSOS que generaba un POST por tecla). La diferencia:
 * ahora quien decide CUÁNDO llamar a esta función es `coalescerGpio`, nunca
 * directamente el `change` del `<select>`. */
async function enviarCambioGpio({ componenteId, terminalId, valor }) {
  if (!ultimoSnapshot) return
  const sobre = {
    idOperacion: siguienteIdOperacion(),
    actor: "navegador", // el servidor lo fuerza de todos modos (servidor-proyecto.ts)
    baseRevision: ultimoSnapshot.revision,
    tipo: "AsignarPin",
    payload: { componente: componenteId, terminal: terminalId, pin: valor },
  }

  // Una operación de GPIO en vuelo también bloquea la frase (a lo sumo UNA operación global).
  controladorReglas.marcarOperacionExterna(true)
  try {
    await enviarSobre(sobre, { repintarAhora: true })
  } finally {
    controladorReglas.marcarOperacionExterna(false)
  }
}

/** POST de un sobre + manejo común de la respuesta (GPIO y frase comparten esto). SIEMPRE se
 * repinta desde `cuerpo.snapshot` (la respuesta del servidor) — nunca desde lo que el selector
 * mostraba antes del POST. `repintarAhora: false` lo usa la frase, que repinta ella misma al
 * terminar (para no pintar dos veces seguidas con la operación todavía "pendiente"). */
async function enviarSobre(sobre, { repintarAhora }) {
  const respuesta = await fetch("/api/operaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sobre),
  })
  const cuerpo = await respuesta.json()
  ultimoSnapshot = cuerpo.snapshot

  if (cuerpo.resultado.ok) {
    // Path A (blocking representable) también cae acá con ok:true — el motivo, si lo hay, ya se
    // muestra en el panel de motivos vía `planDePintado`/`pintar`.
    mostrarEstado(null)
    if (repintarAhora) repintar()
    return cuerpo
  }

  const desactualizada = cuerpo.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA")
  if (desactualizada) {
    // Conflicto stale: "otro cambio llegó primero" — se vuelve a pedir el snapshot (nunca se asume
    // que el de la respuesta del rechazo es el más reciente) y se repinta desde ahí.
    mostrarEstado("otro cambio llegó primero — se actualizó a la revisión vigente")
    await cargarSnapshot()
    return cuerpo
  }

  // Path B: rechazo de dominio (no stale) — la vista queda en el snapshot autoritativo que ya
  // trajo la respuesta (sin cambios); sólo se muestra el motivo.
  mostrarEstado(descripcionDeMotivos(cuerpo.resultado.motivos))
  if (repintarAhora) repintar()
  return cuerpo
}

/** La frase: un `SetComportamiento`/`QuitarComportamiento` por cambio, con `baseRevision` del
 * ÚLTIMO snapshot autoritativo (nunca optimista). */
async function enviarOperacionRegla({ tipo, payload, baseRevision }) {
  return enviarSobre({ idOperacion: siguienteIdOperacion(), actor: "navegador", baseRevision, tipo, payload }, { repintarAhora: false })
}

const controladorReglas = crearControladorReglas({ obtenerSnapshot: () => ultimoSnapshot, enviar: enviarOperacionRegla, alCambiar: () => (enNavegador ? repintar() : undefined) })

/** Foco de la frase: se captura al cambiar un select y se restaura cuando la operación termina
 * (mientras está pendiente los selects están deshabilitados y no pueden tener el foco). */
let focoReglaPendiente = null

function capturarFocoRegla() {
  const activo = document.activeElement
  if (!activo || typeof activo.getAttribute !== "function") return null
  const reglaId = activo.getAttribute("data-regla-id")
  const slot = activo.getAttribute("data-slot")
  return reglaId && slot ? { reglaId, slot } : null
}

function restaurarFocoRegla(raizReglas) {
  if (!focoReglaPendiente || controladorReglas.opciones().operacionPendiente || typeof raizReglas.querySelectorAll !== "function") return
  const disponibles = [...raizReglas.querySelectorAll("select[data-regla-id][data-slot]")].map((e) => ({ reglaId: e.getAttribute("data-regla-id"), slot: e.getAttribute("data-slot"), elemento: e }))
  const elegido = elegirControlReglaParaFoco(disponibles.map(({ reglaId, slot }) => ({ reglaId, slot })), focoReglaPendiente)
  focoReglaPendiente = null
  const match = elegido && disponibles.find((c) => c.reglaId === elegido.reglaId && c.slot === elegido.slot)
  if (match && typeof match.elemento.focus === "function") match.elemento.focus()
}

function manejarCambioRegla({ reglaId, slot, valor }) {
  focoReglaPendiente = capturarFocoRegla()
  controladorReglas.cambiar({ reglaId, slot, valor })
}

/** F-11: el coalescer real de esta página — `enviar`/`obtenerValorServidor` leen
 * `ultimoSnapshot` siempre FRESCO en el momento en que de verdad se invocan (nunca
 * algo capturado al momento del `change`). `programar`/`cancelarProgramado` quedan en
 * sus valores por defecto (`setTimeout`/`clearTimeout` reales) — sólo los tests
 * (`tests/wave0-view.test.mjs`) los reemplazan por un reloj falso. */
const coalescerGpio = crearCoalescerCambiosGpio({ enviar: enviarCambioGpio, obtenerValorServidor: valorServidorDe })

/** El único manejador de `change` que `pintar.js` conoce — F-11: en vez de mandar un
 * POST directo, registra el cambio en el coalescer (debounce + "a lo sumo un POST en
 * vuelo" + "sólo el último valor"). */
function manejarCambioGpio({ componenteId, terminalId, valor }) {
  coalescerGpio.registrarCambio(componenteId, terminalId, valor)
}

// SSE: cualquier commit (de este navegador o de otro actor, ej. la tool) dispara un
// refetch íntegro — nunca se aplica el `{revision}` del evento de forma optimista.
//
// Este bootstrap sólo corre en el navegador real (ver `enNavegador` arriba) — nunca
// bajo `node --test`.
if (enNavegador) {
  const eventos = new EventSource("/api/eventos")
  eventos.addEventListener("revision", () => {
    cargarSnapshot()
  })
  // Revisión post red-team (B2): `error`/`open` son eventos NATIVOS del propio
  // `EventSource` (no algo que este módulo invente) — se procesan por el reductor
  // puro de `estado-conexion.js`, nunca acá mismo con lógica ad-hoc.
  eventos.addEventListener("error", () => manejarEventoConexion({ tipo: "error" }))
  eventos.addEventListener("open", () => manejarEventoConexion({ tipo: "open" }))

  cargarSnapshot()
}
