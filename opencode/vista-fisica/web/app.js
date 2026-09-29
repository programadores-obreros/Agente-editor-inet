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

const contenedores = {
  circuito: document.getElementById("circuito"),
  cables: document.getElementById("cables"),
  controles: document.getElementById("controles"),
  motivos: document.getElementById("motivos"),
}
const elementoRevision = document.getElementById("revision")
const elementoReadiness = document.getElementById("readiness")
const elementoEstado = document.getElementById("estado")
const elementoConexion = document.getElementById("conexion")

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

/** Repinta ÍNTEGRO desde `ultimoSnapshot` — nunca actualiza el DOM anterior a
 * pedazos. Si el snapshot no trae `vista` (no debería pasar en producción, donde
 * `servicio-con-vista.ts` siempre inyecta `calcularVista`), no rompe: sólo no dibuja
 * el circuito, deja el resto de la cabecera (revisión/readiness) al día. */
function repintar() {
  if (!ultimoSnapshot) return
  elementoRevision.textContent = `revisión: ${ultimoSnapshot.revision}`
  const readiness = ultimoSnapshot.vista ? ultimoSnapshot.vista.readiness : ultimoSnapshot.validacion.readiness
  elementoReadiness.textContent = readiness.listo ? "listo" : readiness.invalido ? "inválido" : "incompleto"

  if (!ultimoSnapshot.vista) return
  const instrucciones = planDePintado(ultimoSnapshot.vista, { conexionActiva: estadoConexion === "conectado" })
  const secciones = pintar(document, instrucciones, { onCambioGpio: manejarCambioGpio })
  for (const clave of Object.keys(contenedores)) {
    contenedores[clave].replaceChildren(secciones[clave])
  }
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

async function manejarCambioGpio({ componenteId, terminalId, valor }) {
  if (!ultimoSnapshot) return
  // `baseRevision` sale del ÚLTIMO snapshot AUTORITATIVO — nunca de un contador local
  // ni de lo que el usuario cree que está viendo (PHASE_2_SLICE_1_PROTOCOL.md,
  // briefing tarea 3).
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

// SSE: cualquier commit (de este navegador o de otro actor, ej. la tool) dispara un
// refetch íntegro — nunca se aplica el `{revision}` del evento de forma optimista.
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
