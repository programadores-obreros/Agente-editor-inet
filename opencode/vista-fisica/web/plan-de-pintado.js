// Plan de pintado — Phase 2, Slice 1 (PHASE_2_SLICE_1_DESIGN.md §2.6).
//
// PURO: ni DOM ni red ni `node:`. Traduce el `ModeloDeVista` (el campo `vista` del
// snapshot que sirve el servidor HTTP, `opencode/nucleo/composicion-raiz.ts::Snapshot`)
// a una lista DETERMINISTA de instrucciones de pintado. `pintar.js` (writer
// siguiente) es quien SÍ toca `document` y aplica este plan — deliberadamente tonto,
// sin decisiones propias.
//
// JS plano, ES module: se sirve TAL CUAL al navegador, sin bundler ni build step
// (mismo criterio que `opencode/tecniabot-web/*.js`) — nunca TypeScript acá. Por eso
// es testeable en `node --test` sin ningún DOM simulado: es sólo transformación de
// datos (arrays/objetos → arrays/objetos).
//
// Cero URLs externas en cualquier instrucción que produce (offline por diseño,
// PHASE_2_SLICE_1_DESIGN.md §2.9): los `tag` son nombres de custom element
// (`wokwi-esp32-devkit-v1`, `wokwi-led`), nunca una URL de asset/CDN.

/**
 * @param {import("../modelo-vista.ts").ModeloDeVista} modeloDeVista - el campo
 *   `vista` del snapshot, tal cual llega serializado por HTTP/SSE.
 * @returns {readonly object[]} instrucciones, en orden determinista y estable — el
 *   mismo `modeloDeVista` produce SIEMPRE la misma lista, en el mismo orden.
 */
export function planDePintado(modeloDeVista) {
  const instrucciones = []

  if (modeloDeVista.placa) {
    instrucciones.push({
      tipo: "crearElemento",
      entidad: { tipo: "placa", id: modeloDeVista.placa.id },
      tag: modeloDeVista.placa.elementoWokwi,
      atributos: {},
    })
  }

  for (const componente of modeloDeVista.componentes) {
    // Sin dato Wokwi para este tipo (gap documentado en `wokwi-render-datos.ts`: hoy
    // sólo "led" tiene tabla de render) — no se inventa un tag: se omite la
    // instrucción de creación para ese componente, nunca se dibuja con un tag falso.
    if (!componente.elementoWokwi) continue
    instrucciones.push({
      tipo: "crearElemento",
      entidad: { tipo: "componente", id: componente.id },
      tag: componente.elementoWokwi,
      atributos: { ...componente.atributos },
    })
  }

  for (const cable of modeloDeVista.cables) {
    instrucciones.push({
      tipo: "filaCable",
      id: cable.id,
      desde: etiquetaDeExtremo(cable.desde),
      hasta: etiquetaDeExtremo(cable.hasta),
    })
  }

  // Selector de GPIO: uno por (componente, terminal) que el modelo ofrezca —
  // `gpiosDisponibles` ya excluye los terminales riel-fijo (no tienen selector).
  for (const componente of modeloDeVista.componentes) {
    const porTerminal = modeloDeVista.gpiosDisponibles[componente.id] ?? {}
    for (const terminalId of Object.keys(porTerminal)) {
      const terminalVista = componente.terminales[terminalId]
      const valorActual = terminalVista && terminalVista.estado === "asignado" ? terminalVista.pinSemantico : null
      instrucciones.push({
        tipo: "selectorGpio",
        componenteId: componente.id,
        terminalId,
        opciones: porTerminal[terminalId].map((opcion) => ({ valor: opcion.pinSemantico, etiqueta: opcion.nombreWokwi })),
        valorActual,
      })
    }
  }

  // Panel de motivos: tal cual `modeloDeVista.motivos` (ya proyectado 1:1 desde
  // `validarProyecto()`, orden estable de `nucleo/motivos.ts::compararMotivos`) — este
  // módulo no reordena ni filtra, sólo elige qué campos mostrar.
  for (const motivo of modeloDeVista.motivos) {
    instrucciones.push({
      tipo: "panelMotivo",
      codigo: motivo.codigo,
      severidad: motivo.severidad,
      clasificacion: motivo.clasificacion ?? null,
      entidad: motivo.entidad ?? null,
    })
  }

  return instrucciones
}

function etiquetaDeExtremo(extremo) {
  if (extremo.tipo === "pinPlaca") return extremo.nombreWokwi
  if (extremo.tipo === "rielFijo") return extremo.destino
  return extremo.nombreWokwi ?? `${extremo.componente}.${extremo.terminal}`
}
