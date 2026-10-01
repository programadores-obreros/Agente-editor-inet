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
//    hay un POST en curso, el pedido se ENCOLA — reemplazando cualquier pedido que ya
//    estuviera encolado: "sólo el ÚLTIMO valor elegido" vale también acá.
//  - al volver el POST en vuelo, si hay un pedido encolado, se re-evalúa CONTRA EL
//    VALOR DE SERVIDOR YA ACTUALIZADO (nunca el de antes del POST): si ya coincide, no
//    se manda nada; si no, se manda con la `baseRevision` fresca (que lee `enviar` de
//    `ultimoSnapshot` en el momento en que de verdad se invoca, nunca antes).
//  - si el valor final (al vencer el debounce, o al desencolar) ya coincide con el
//    valor vigente del servidor, no se manda NADA.
export function crearCoalescerCambiosGpio({ debounceMs = 300, programar = (fn, ms) => setTimeout(fn, ms), cancelarProgramado = (id) => clearTimeout(id), enviar, obtenerValorServidor } = {}) {
  const timerPorSelector = new Map() // "componenteId\u0000terminalId" -> id de timer vivo
  let enVuelo = false
  let pedidoEncolado = null // el UNICO pedido en espera mientras hay un POST en vuelo

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
    if (valor === obtenerValorServidor(componenteId, terminalId)) return // ya coincide: nada que mandar
    const pedido = { componenteId, terminalId, valor }
    if (enVuelo) {
      pedidoEncolado = pedido // pisa cualquier pedido encolado anterior: sólo el ÚLTIMO importa
      return
    }
    despachar(pedido)
  }

  function despachar(pedido) {
    enVuelo = true
    Promise.resolve(enviar(pedido)).then(alVolverElPost, alVolverElPost)
  }

  function alVolverElPost() {
    enVuelo = false
    if (!pedidoEncolado) return
    const proximo = pedidoEncolado
    pedidoEncolado = null
    // Re-chequea contra el valor de servidor YA actualizado por el POST que acaba de
    // volver — si mientras tanto ya quedó igual, el pedido encolado no aporta nada.
    decidirEnvio(proximo.componenteId, proximo.terminalId, proximo.valor)
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
  const instrucciones = planDePintado(ultimoSnapshot.vista, { conexionActiva: estadoConexion === "conectado" })
  const secciones = pintar(document, instrucciones, { onCambioGpio: manejarCambioGpio })
  for (const clave of Object.keys(contenedores)) {
    contenedores[clave].replaceChildren(secciones[clave])
  }
  restaurarFoco(secciones.controles, focoAnterior)
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

  const respuesta = await fetch("/api/operaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sobre),
  })
  const cuerpo = await respuesta.json()
  // SIEMPRE se repinta desde `cuerpo.snapshot` (la respuesta del servidor) — nunca
  // desde lo que el selector mostraba antes del POST.
  ultimoSnapshot = cuerpo.snapshot

  if (cuerpo.resultado.ok) {
    // Path A (blocking representable) también cae acá con ok:true — el motivo, si lo
    // hay, ya se muestra en el panel de motivos vía `planDePintado`/`pintar`; no hace
    // falta un mensaje transitorio aparte.
    mostrarEstado(null)
    repintar()
    return
  }

  const desactualizada = cuerpo.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA")
  if (desactualizada) {
    // Conflicto stale: "otro cambio llegó primero" — se vuelve a pedir el snapshot
    // (nunca se asume que el que ya vino en la respuesta del rechazo es el más
    // reciente) y se repinta desde ahí.
    mostrarEstado("otro cambio llegó primero — se actualizó a la revisión vigente")
    await cargarSnapshot()
    return
  }

  // Path B: rechazo de dominio (no stale) — la vista se queda en el snapshot
  // autoritativo que ya trajo la respuesta (sin cambios, porque el Engine rechazó);
  // sólo se muestra el motivo.
  mostrarEstado(descripcionDeMotivos(cuerpo.resultado.motivos))
  repintar()
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
