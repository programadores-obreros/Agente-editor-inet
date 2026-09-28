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

const contenedores = {
  circuito: document.getElementById("circuito"),
  cables: document.getElementById("cables"),
  controles: document.getElementById("controles"),
  motivos: document.getElementById("motivos"),
}
const elementoRevision = document.getElementById("revision")
const elementoReadiness = document.getElementById("readiness")
const elementoEstado = document.getElementById("estado")

/** Último snapshot AUTORITATIVO recibido (GET /api/proyecto, POST /api/operaciones,
 * o un refetch tras el evento SSE `revision`) — nunca un estado optimista. */
let ultimoSnapshot = null
let contadorOperacion = 0

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
  const instrucciones = planDePintado(ultimoSnapshot.vista)
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

cargarSnapshot()
