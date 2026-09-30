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
 * @param {{ conexionActiva?: boolean }} [opciones] - `conexionActiva` (default
 *   `true`, revisión post red-team, Hallazgo B2): si es `false`, cada instrucción
 *   `selectorGpio` sale con `deshabilitado: true` — nunca se decide acá SI mostrar
 *   un indicador de conexión (eso es de `app.js`), sólo si el selector puede
 *   tocarse. Sigue siendo PURO: `conexionActiva` es un dato de entrada más, nunca
 *   `app.js` toca el DOM del selector directo.
 * @returns {readonly object[]} instrucciones, en orden determinista y estable — el
 *   mismo `modeloDeVista`+`opciones` produce SIEMPRE la misma lista, en el mismo
 *   orden.
 */
export function planDePintado(modeloDeVista, opciones = {}) {
  const conexionActiva = opciones.conexionActiva ?? true
  const instrucciones = []

  if (modeloDeVista.placa) {
    instrucciones.push({
      tipo: "crearElemento",
      entidad: { tipo: "placa", id: modeloDeVista.placa.id },
      tag: modeloDeVista.placa.elementoWokwi,
      // `transform:scale()` es puramente cosmético (ModeloDeVista.placa.escala,
      // `modelo-vista.ts`: "nunca afecta ninguna regla eléctrica") — la pieza Wokwi
      // reserva su propio tamaño de layout en su Shadow DOM sin importar la escala
      // (mismo comportamiento que ya documenta circuito.ts:93-99, "El ESP32 reserva
      // 106,6px aunque se pinte a 133"): sin este estilo la placa se ve igual, sólo
      // más chica que la escala pensada para el catálogo
      // (`wokwi-render-datos.ts::ESCALA_WOKWI_POR_PLACA`, citando circuito.ts:641).
      atributos: { style: `transform:scale(${modeloDeVista.placa.escala});transform-origin:top left` },
      // La placa nunca tiene rol pedagógico Entrada/Salida (§3.3) — `null` explícito,
      // mismo campo que los componentes, para que `pintar.js` no necesite distinguir.
      etiquetaRol: null,
    })
  }

  for (const componente of modeloDeVista.componentes) {
    // Sin dato Wokwi para este tipo (gap documentado en `wokwi-render-datos.ts`: hoy
    // sólo "led"/"pulsador" tienen tabla de render) — no se inventa un tag: se omite
    // la instrucción de creación para ese componente, nunca se dibuja con un tag falso.
    if (!componente.elementoWokwi) continue
    instrucciones.push({
      tipo: "crearElemento",
      entidad: { tipo: "componente", id: componente.id },
      tag: componente.elementoWokwi,
      atributos: { ...componente.atributos },
      // Fase 2, Slice 2 (§3.3): `componente.rol` YA viene resuelto del servidor
      // (`snapshot-a-vista.ts::rolDeClase`, "entrada"|"salida"|null) — acá sólo se
      // capitaliza para mostrar ("entrada" -> "Entrada"), una transformación de
      // texto GENÉRICA, nunca una tabla de clases/tipos ni un despacho por
      // `componente.tipo`.
      etiquetaRol: etiquetaDeRol(componente.rol),
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
        deshabilitado: !conexionActiva, // B2 — sin conexion viva, el selector no se puede tocar
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
      // Fase 2, Slice 2 (§3.4): texto llano YA resuelto del lado del servidor
      // (`snapshot-a-vista.ts`, vía `explicaciones-motivos.ts`) — `null` si el
      // código no está en esa tabla; `pintar.js` muestra la fila cruda en ese caso.
      // Este módulo NUNCA calcula la explicación, sólo la pasa.
      explicacion: motivo.explicacion ?? null,
    })
  }

  return instrucciones
}

// Fase 2, Slice 2 (§3.3): capitaliza el rol YA resuelto por el servidor
// (`snapshot-a-vista.ts::rolDeClase`) para mostrarlo ("entrada" -> "Entrada") — una
// transformación de texto GENÉRICA (nunca mira `componente.tipo` ni ninguna clase de
// catálogo): el browser no tiene ninguna tabla de clases/tipos.
function etiquetaDeRol(rol) {
  if (!rol) return null
  return rol.charAt(0).toUpperCase() + rol.slice(1)
}

// Revisión post red-team (Hallazgo B1, MAJOR, P2-RED-B/INFORME.md): `nombreWokwi`
// de un extremo `pinPlaca` puede ser `null` (el pin está asignado en la IR, pero el
// renderer no tiene una pieza física para él — ej. un GPIO de flash asignado por un
// actor "agente", nunca ofrecido por el selector). Mostrar la palabra "null" o
// inventar un nombre serían las dos formas de romper el mismo contrato ("nunca
// oculta, nunca inventa") — el texto muestra el pin SEMÁNTICO real (lo que el
// Engine sabe) más una nota honesta de que no hay dónde dibujarlo.
function etiquetaDeExtremo(extremo) {
  if (extremo.tipo === "pinPlaca") return extremo.nombreWokwi ?? `${extremo.pinSemantico} (sin pin físico en esta placa)`
  if (extremo.tipo === "rielFijo") return extremo.destino
  return extremo.nombreWokwi ?? `${extremo.componente}.${extremo.terminal}`
}
