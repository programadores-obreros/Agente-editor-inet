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
  // Phase 3 (T5): estado de la UI de la frase, siempre un DATO de entrada (esta función sigue
  // siendo pura). `operacionPendiente`: hay una operación en vuelo; `reglaNueva`: el alumno
  // apretó "Agregar regla" (frase vacía, todavía no existe en el IR); `trazasAbiertas`: ids de
  // las reglas cuya explicación se pidió a demanda.
  const operacionPendiente = opciones.operacionPendiente ?? false
  const reglaNueva = opciones.reglaNueva ?? false
  const trazasAbiertas = opciones.trazasAbiertas ?? []
  const instrucciones = []

  // W0-8 (PHASE_3_WAVE_0_DESIGN.md): "si el proyecto no tiene placa NI componentes" —
  // ambas condiciones, nunca una superficie vacía sin ningún indicio. Va PRIMERO en
  // el plan (antes que cualquier otra cosa, aunque en este caso no haya nada más que
  // agregar) para que `pintar.js` siempre tenga una instrucción que mostrar.
  if (!modeloDeVista.placa && modeloDeVista.componentes.length === 0) {
    instrucciones.push({ tipo: "estadoVacio", texto: "Este proyecto todavía no tiene componentes. Pedile a Tecnia Bot que lo arme." })
  }

  // Physical View UX #1: con `zonas` (servidor), el circuito se arma en zonas de lectura
  // — Entrada | Controlador | Salida — y cada pieza va a la suya. Sin `zonas` (modelos
  // viejos o fixtures mínimos) todo queda exactamente como antes.
  const zonas = modeloDeVista.zonas ?? []
  const conZonas = zonas.length > 0
  for (const zona of zonas) {
    instrucciones.push({ tipo: "zonaCircuito", rol: zona.rol, titulo: zona.titulo, descripcion: zona.descripcion })
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
      ...(conZonas ? { zona: "controlador", nombre: modeloDeVista.placa.nombre, explicacion: null, camino: null } : {}),
    })
  }

  for (const componente of modeloDeVista.componentes) {
    // Sin dato Wokwi para este tipo (anexo `conocimiento/anexos/representacion.ts`: hoy
    // sólo "led"/"pulsador"/"resistencia" tienen tabla de render) — no se inventa un tag
    // ni se dibuja con un tag falso. Component System Foundation #1 (D-17): tampoco se
    // omite EN SILENCIO — la pieza existe en el proyecto, así que se avisa visiblemente
    // que todavía no tiene dibujo (no es un componente con soporte oficial).
    if (!componente.elementoWokwi) {
      instrucciones.push({
        tipo: "piezaSinRepresentacion",
        entidad: { tipo: "componente", id: componente.id },
        texto: `${componente.nombre}: todavía no tiene dibujo (no es un componente con soporte oficial).`,
        ...(conZonas ? { zona: componente.zona } : {}),
      })
      continue
    }
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
      ...(conZonas ? { zona: componente.zona, nombre: componente.nombre, explicacion: componente.explicacion, camino: componente.agrupadoCon ?? componente.id } : {}),
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
  // Physical View UX #1: los cables DIBUJADOS. Este plan sólo dice QUÉ se une con QUÉ
  // (entidad + anclas de la pieza Wokwi, ya resueltas por el servidor) y qué rótulo va
  // del lado de la placa; DÓNDE pasa cada cable lo decide `cableado.js` en el
  // navegador, midiendo las piezas reales. Un extremo sin ancla dibujable (pin sin
  // representación física, riel sin placa) no se dibuja: queda en la lista de texto.
  if (conZonas && modeloDeVista.placa) {
    const componentesPorIdEsquema = new Map(modeloDeVista.componentes.map((componente) => [componente.id, componente]))
    const cables = []
    for (const cable of modeloDeVista.cables) {
      const desde = extremoDibujable(cable.desde, modeloDeVista.placa.id)
      const hasta = extremoDibujable(cable.hasta, modeloDeVista.placa.id)
      if (!desde || !hasta) {
        // Nunca se omite en silencio: la pieza avisa que esa conexión existe pero no se
        // puede dibujar (p. ej. un GPIO válido sin pin en la pieza de la placa).
        const pieza = [cable.desde, cable.hasta].find((e) => e.tipo === "terminal")
        if (pieza) {
          instrucciones.push({
            tipo: "notaConexion",
            entidad: { tipo: "componente", id: pieza.componente },
            texto: `Conexión sin dibujo: ${etiquetaDeExtremo(cable.desde, componentesPorIdEsquema)} → ${etiquetaDeExtremo(cable.hasta, componentesPorIdEsquema)}.`,
          })
        }
        continue
      }
      cables.push({ id: cable.id, camino: cable.camino ?? null, desde, hasta })
    }
    instrucciones.push({ tipo: "cableado", cables })
  }

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
        opciones: opcionesDelSelector(porTerminal[terminalId], terminalVista),
        valorActual,
        deshabilitado: !conexionActiva, // B2 — sin conexion viva, el selector no se puede tocar
      })
    }
  }

  instrucciones.push(...instruccionesDeReglas(modeloDeVista, { deshabilitado: !conexionActiva || operacionPendiente, reglaNueva, trazasAbiertas }))

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
/** Opciones del selector de GPIO. Physical View UX #1 (red-team): si el proyecto YA
 * tiene un pin que no está entre las opciones ofrecidas (p. ej. GPIO0, válido pero sin
 * pin en la pieza de la placa), se agrega ESE valor para que el selector muestre lo que
 * la IR dice de verdad, nunca un selector en blanco. No es una opción nueva: es el
 * valor actual. */
function opcionesDelSelector(ofrecidas, terminalVista) {
  const opciones = ofrecidas.map((opcion) => ({ valor: opcion.pinSemantico, etiqueta: `${opcion.pinSemantico} (${opcion.nombreWokwi})` }))
  if (!terminalVista || terminalVista.estado !== "asignado" || opciones.some((o) => o.valor === terminalVista.pinSemantico)) return opciones
  const rotulo = terminalVista.nombreWokwiPlaca === null ? "sin pin físico en esta placa" : terminalVista.nombreWokwiPlaca
  return [...opciones, { valor: terminalVista.pinSemantico, etiqueta: `${terminalVista.pinSemantico} (${rotulo})` }]
}

function extremoDibujable(extremo, placaId) {
  if (extremo.tipo === "pinPlaca") {
    if (extremo.nombreWokwi === null) return null
    return { entidad: { tipo: "placa", id: placaId }, anclas: [extremo.nombreWokwi], etiqueta: `${extremo.pinSemantico} (${extremo.nombreWokwi})`, potencia: false }
  }
  if (extremo.tipo === "rielFijo") {
    if (!extremo.potencia || extremo.potencia.anclasWokwi.length === 0) return null
    return { entidad: { tipo: "placa", id: placaId }, anclas: [...extremo.potencia.anclasWokwi], etiqueta: extremo.potencia.etiqueta, potencia: true }
  }
  const anclas = extremo.anclasWokwi ?? (extremo.nombreWokwi ? [extremo.nombreWokwi] : [])
  if (anclas.length === 0) return null
  return { entidad: { tipo: "componente", id: extremo.componente }, anclas: [...anclas], etiqueta: null, potencia: false }
}

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
  // Physical View UX #1: si el servidor resolvió el terminal de potencia de la placa,
  // se nombra ése ("GND (masa)"); si no, el destino crudo de siempre.
  if (extremo.tipo === "rielFijo") return extremo.potencia ? extremo.potencia.etiqueta : extremo.destino
  const componente = componentesPorId.get(extremo.componente)
  const nombreComponente = componente ? componente.nombre : extremo.componente
  const etiquetaTerminal = componente?.terminales?.[extremo.terminal]?.etiqueta ?? extremo.terminal
  return `${nombreComponente} (${etiquetaTerminal})`
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3 (T5, contrato B7): la FRASE editable de cada regla. Todo viene del servidor
// (`reglas`/`opcionesRegla.slots`): acá sólo se ordena en instrucciones. Ninguna tabla de clases,
// capacidades ni estados, y ni siquiera se nombran los slots; un id sólo viaja como `valor` de una opción, nunca como texto.
// ════════════════════════════════════════════════════════════════════════════════════

const PLACEHOLDER_SLOT = "[elegí…]"

/** Opciones del slot + (si el valor actual no está entre ellas) la opción del valor actual, para
 * que el select nunca muestre otra cosa que lo que la regla tiene de verdad. */
function opcionesDelSlot(base, actual) {
  const opciones = base.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta }))
  if (!actual || opciones.some((o) => o.valor === actual.valor)) return opciones
  return [...opciones, actual]
}

/** Valor actual de un slot: `frase[slot]` ya viene del servidor ({id, etiqueta} o {clave, etiqueta}). */
export function valorActualDe(frase, slot) {
  const f = frase[slot]
  return f ? { valor: f.id ?? f.clave, etiqueta: f.etiqueta } : null
}

function instruccionDeFrase(regla, opciones, config) {
  const frase = regla ? regla.frase : {}
  // Los slots (orden, texto fijo, opciones) los dicta el servidor: acá no se nombra ninguno.
  const selectores = (opciones.slots ?? []).map((definicion) => {
    const actual = valorActualDe(frase, definicion.slot)
    return {
      slot: definicion.slot,
      prefijo: definicion.prefijo,
      opciones: opcionesDelSlot(definicion.opciones, actual),
      valorActual: actual ? actual.valor : null,
      placeholder: actual ? null : PLACEHOLDER_SLOT,
      deshabilitado: config.deshabilitado,
    }
  })
  const trazaAbierta = regla !== null && regla.traza !== undefined && config.trazasAbiertas.includes(regla.id)
  return {
    tipo: "reglaFrase",
    reglaId: regla ? regla.id : null,
    selectores,
    cierre: ".",
    explicaciones: regla ? regla.motivos.map((m) => m.explicacion).filter((t) => typeof t === "string" && t !== "") : [],
    aviso: regla ? (regla.aviso ?? null) : null,
    conTraza: regla !== null && regla.traza !== undefined,
    etiquetaTraza: "¿Qué pasaría si…?",
    traza: trazaAbierta ? regla.traza : null,
    deshabilitado: config.deshabilitado,
  }
}

function instruccionesDeReglas(modeloDeVista, config) {
  const reglas = modeloDeVista.reglas ?? []
  const opciones = modeloDeVista.opcionesRegla ?? { slots: [] }
  const salida = []
  for (const regla of reglas) salida.push(instruccionDeFrase(regla, opciones, config))
  // Multi-Rule Safety: ya no hay aviso genérico de "varias reglas". Reglas sobre salidas
  // distintas son válidas; sobre la MISMA salida, el servidor da el motivo preciso en
  // cada regla involucrada (MULTIPLES_AUTORIDADES_ACTUADOR).
  if (reglas.length === 0) {
    // Límite de UI = 1 regla: "Agregar regla" sólo aparece sin reglas, y no crea nada — sólo
    // muestra una frase vacía; la regla nace con el primer selector.
    if (config.reglaNueva) salida.push(instruccionDeFrase(null, opciones, config))
    else salida.push({ tipo: "reglaAgregar", etiqueta: "Agregar regla", deshabilitado: config.deshabilitado })
  }
  return salida
}
