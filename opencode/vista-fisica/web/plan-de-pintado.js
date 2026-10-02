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

  // W0-8 (PHASE_3_WAVE_0_DESIGN.md): "si el proyecto no tiene placa NI componentes" —
  // ambas condiciones, nunca una superficie vacía sin ningún indicio. Va PRIMERO en
  // el plan (antes que cualquier otra cosa, aunque en este caso no haya nada más que
  // agregar) para que `pintar.js` siempre tenga una instrucción que mostrar.
  if (!modeloDeVista.placa && modeloDeVista.componentes.length === 0) {
    instrucciones.push({ tipo: "estadoVacio", texto: "Este proyecto todavía no tiene componentes. Pedile a Tecnia Bot que lo arme." })
  }

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
      // PFX-1: la placa nunca es la pieza fusionada de nada — `null` explícito, mismo
      // campo que los componentes, para que `pintar.js` no tenga que distinguir
      // "placa" de "componente sin fusión".
      agrupadoCon: null,
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
      // PFX-1 (RED-PHT-PHYSICAL-TRUTH F1): `componente.agrupadoCon` YA viene
      // resuelto del servidor (`snapshot-a-vista.ts::reordenarParaAdyacencia`) — acá
      // sólo se reenvía tal cual, nunca se decide de nuevo cuál pieza fusiona con
      // cuál (eso sería la misma lógica física duplicada que PFX-2 corrigió del
      // otro lado). `pintar.js` es quien agrupa de verdad, leyendo este dato.
      agrupadoCon: componente.agrupadoCon,
    })
  }

  // F-09 (PHASE_3_WAVE_0_DESIGN.md): `componentesPorId` deja que `etiquetaDeExtremo`
  // resuelva el nombre humano de un extremo "terminal" (`ComponenteVista.nombre` +
  // `TerminalVista.etiqueta`) sin reimplementar ninguna tabla acá — los dos campos ya
  // vienen resueltos del lado del servidor (`snapshot-a-vista.ts`).
  const componentesPorId = new Map(modeloDeVista.componentes.map((componente) => [componente.id, componente]))

  for (const cable of modeloDeVista.cables) {
    instrucciones.push({
      tipo: "filaCable",
      id: cable.id,
      desde: etiquetaDeExtremo(cable.desde, componentesPorId),
      hasta: etiquetaDeExtremo(cable.hasta, componentesPorId),
    })
  }

  // Selector de GPIO: uno por (componente, terminal) que el modelo ofrezca —
  // `gpiosDisponibles` ya excluye los terminales riel-fijo (no tienen selector).
  for (const componente of modeloDeVista.componentes) {
    const porTerminal = modeloDeVista.gpiosDisponibles[componente.id] ?? {}
    for (const terminalId of Object.keys(porTerminal)) {
      const terminalVista = componente.terminales[terminalId]
      const valorActual = terminalVista && terminalVista.estado === "asignado" ? terminalVista.pinSemantico : null
      // F-09: "Pulsador — señal:" — nombre humano del componente + etiqueta de
      // presentación del terminal, YA resueltos del lado del servidor. El id crudo
      // (`componente.id`/`terminalId`) sigue viajando en la instrucción para que
      // `pintar.js` lo use como `data-*` (metadata secundaria), nunca como texto
      // primario.
      const etiquetaTerminal = terminalVista ? terminalVista.etiqueta : terminalId
      instrucciones.push({
        tipo: "selectorGpio",
        componenteId: componente.id,
        terminalId,
        etiqueta: `${componente.nombre} — ${etiquetaTerminal}:`,
        // FX-4 (RED-W0-UX (c), ronda de fixes): nombre SEMÁNTICO primero ("GPIO18",
        // lo que dice el bot/la tool `proyecto-fisico`), rótulo de la placa entre
        // paréntesis ("D18", lo que el alumno ve dibujado) — antes mostraba SÓLO el
        // rótulo de la placa, que nunca coincidía con lo que el bot decía, rompiendo
        // la sensación de "estamos mirando lo mismo" (ONE PHYSICAL TRUTH).
        opciones: porTerminal[terminalId].map((opcion) => ({ valor: opcion.pinSemantico, etiqueta: `${opcion.pinSemantico} (${opcion.nombreWokwi})` })),
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
//
// F-09 (PHASE_3_WAVE_0_DESIGN.md): un extremo "terminal" NUNCA usa `nombreWokwi`
// como texto primario — para el pulsador eso era literalmente `"1.l"`/`"2.l"` (el pin
// INTERNO del custom element Wokwi, `TERMINAL_WOKWI_POR_TIPO.pulsador`,
// `wokwi-render-datos.ts`), no un texto para un estudiante. En cambio usa
// `ComponenteVista.nombre` + `TerminalVista.etiqueta` (YA resueltos del lado del
// servidor, `snapshot-a-vista.ts`) — "Pulsador (señal)", "LED (ánodo (+))". Si el
// componente no aparece en `componentesPorId` (no debería pasar en producción: todo
// cable sale de un componente del MISMO modelo), el id crudo queda como último
// recurso, nunca se rompe el pintado — mismo criterio fail-closed del resto del
// adaptador. `nombreWokwi`/el id crudo del terminal siguen disponibles como
// metadata secundaria para quien los necesite (`cable.id`, `data-*`), nunca en el
// texto primario.
function etiquetaDeExtremo(extremo, componentesPorId) {
  if (extremo.tipo === "pinPlaca") {
    if (extremo.nombreWokwi === null) return `${extremo.pinSemantico} (sin pin físico en esta placa)`
    // FX-4 (RED-W0-UX (c)): nombre SEMÁNTICO primero ("GPIO18", lo que dice el bot),
    // rótulo de la placa entre paréntesis ("D18", lo que el alumno ve dibujado en el
    // cable) — mismo criterio que la opción del selector, más arriba.
    return `${extremo.pinSemantico} (${extremo.nombreWokwi})`
  }
  if (extremo.tipo === "rielFijo") return extremo.destino
  const componente = componentesPorId.get(extremo.componente)
  const nombreComponente = componente ? componente.nombre : extremo.componente
  const etiquetaTerminal = componente?.terminales?.[extremo.terminal]?.etiqueta ?? extremo.terminal
  return `${nombreComponente} (${etiquetaTerminal})`
}
