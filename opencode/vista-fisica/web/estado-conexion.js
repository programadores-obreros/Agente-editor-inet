// Estado de conexión SSE — Phase 2, Slice 1, revisión post red-team (Hallazgo B2,
// MAJOR, P2-RED-B/INFORME.md, ataque A6): si el servidor se reinicia (o cambia de
// puerto, el caso normal con `listen(0)`) mientras la página sigue abierta, antes NO
// había NINGÚN indicio visible — `#estado`/`#revision`/`<select>` quedaban
// exactamente iguales, como si la conexión siguiera vigente, contradiciendo
// literalmente `PHASE_2_SLICE_1_DESIGN.md:87` ("vuelve a pedir el snapshot al
// reconectar" — falso si el puerto cambió: nunca puede reconectar, es un origin
// distinto).
//
// PURO: sin DOM, sin `EventSource`, sin `node:` — testeable en `node --test` sin
// ningún navegador real (mismo criterio que `plan-de-pintado.js`). `app.js` (el
// único módulo que SÍ toca `EventSource`/`document`) es quien llama a esta función
// con cada evento nativo (`"error"`/`"open"` del propio `EventSource`) y aplica el
// resultado al DOM.
//
// JS plano, ES module, sin build step — se sirve tal cual al navegador (lista blanca
// de `opencode/servidor/servidor-proyecto.ts`).

/** Estado optimista al cargar la página — la primera carga ya usa `fetch()` (no
 * SSE) para pedir el snapshot; `EventSource` recién se conecta después. */
export const ESTADO_INICIAL = "conectado"

/**
 * Reductor puro: `estado` es `"conectado"` o `"desconectado"`; `evento` es
 * `{tipo:"error"}` (el propio `EventSource` no logró conectar/perdió la conexión) o
 * `{tipo:"open"}` (el propio `EventSource` conectó — la primera vez, o al
 * reconectar). Cualquier otro `evento.tipo` deja el estado sin cambios (nunca lanza:
 * un evento desconocido no debe romper la página).
 */
export function reducirEstadoConexion(estado, evento) {
  if (evento.tipo === "error") return "desconectado"
  if (evento.tipo === "open") return "conectado"
  return estado
}

// ── Lo que dice el indicador (2026-11-26) ─────────────────────────────────────────────────────
// Decía «conectado», y el dueño lo leyó como «la placa está conectada». Lo que mide es el enlace
// de ESTA página con Tecnia Bot. Textos aprobados por el dueño: «Ventana al día» / «Ventana sin
// conexión». Los VALORES `conectado`/`desconectado` no cambian: son identificadores (atributo
// `data-estado-conexion`, CSS, tests), no texto para el alumno.
export const TEXTO_VENTANA_AL_DIA = "Ventana al día"
export const TEXTO_VENTANA_SIN_CONEXION = "Ventana sin conexión"
/** La explicación que antes iba entera en el chip («desconectado: la vista puede…»). Ahora el chip
 * dice lo corto y esto va en la franja de estado (`#estado`), con el mismo contenido. */
export const EXPLICACION_SIN_CONEXION = "La vista puede no estar actualizada. Si el servidor se reinició en otro puerto, volvé a abrir la vista física desde Tecnia Bot."

/** Qué dice el indicador en cada estado. Pura. `detalle` es `null` cuando no hay nada que explicar. */
export function textosDelIndicador(estado) {
  if (estado === "conectado") return { chip: TEXTO_VENTANA_AL_DIA, detalle: null }
  return { chip: TEXTO_VENTANA_SIN_CONEXION, detalle: EXPLICACION_SIN_CONEXION }
}
