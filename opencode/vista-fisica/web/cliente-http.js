// Cliente HTTP de la vista — Phase 3, vertical #2 (T6). Extraído de app.js SIN cambiar su comportamiento:
// el POST de un sobre firmado + el manejo común de la respuesta (GPIO, frase y vista lógica comparten
// este camino). Nunca es optimista: SIEMPRE repinta desde un snapshot que ya vino del servidor. Todo lo
// que toca el mundo (fetch, estado de la página, texto de estado) se INYECTA, así que se prueba en Node.

/** Mensajes MÍNIMOS a partir de los códigos de motivo — nunca se inventa una causa
 * que `nucleo/motivos.ts` no produjo (PHASE_2_SLICE_1_DESIGN.md §2.8/§2.9). */
export function descripcionDeMotivos(motivos) {
  if (!motivos || motivos.length === 0) return "rechazado"
  return motivos.map((m) => m.codigo).join(", ")
}

/**
 * @param {{ fetch: Function, aplicarSnapshot: (snapshot: object) => void, repintar: () => void,
 *   mostrarEstado: (texto: string | null) => void }} dependencias
 */
export function crearClienteHttp({ fetch, aplicarSnapshot, repintar, mostrarEstado }) {
  async function cargarSnapshot() {
    const respuesta = await fetch("/api/proyecto")
    aplicarSnapshot(await respuesta.json())
    repintar()
  }

  /** POST de un sobre + manejo común de la respuesta. SIEMPRE se repinta desde `cuerpo.snapshot` (la
   * respuesta del servidor) — nunca desde lo que el control mostraba antes del POST. `repintarAhora:
   * false` lo usan la frase y la vista lógica, que repintan ellas mismas al terminar. */
  async function enviarSobre(sobre, { repintarAhora }) {
    const respuesta = await fetch("/api/operaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sobre),
    })
    const cuerpo = await respuesta.json()
    aplicarSnapshot(cuerpo.snapshot)

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

  return { cargarSnapshot, enviarSobre }
}
