// Pintar — Phase 2, Slice 1 (writer W3, tarea 3). Aplica el plan de
// `planDePintado(modeloDeVista)` (`plan-de-pintado.js`, PURO) al DOM. Este módulo SÍ
// toca `document` — pero es deliberadamente "tonto": ninguna decisión propia sobre
// QUÉ pintar (eso ya lo decidió `plan-de-pintado.js`), sólo CÓMO construir los
// elementos que cada instrucción describe.
//
// Recibe `doc` como parámetro (nunca usa el global `document` directo) — así es
// testeable en `node --test` con un "document" mínimo fabricado a mano en el test,
// sin ningún DOM real (jsdom/happy-dom no son dependencias de este repo,
// PHASE_2_SLICE_1_DESIGN.md no las suma). Sólo usa tres operaciones de un
// document/elemento real: `createElement`, `setAttribute`, `appendChild` — más
// `addEventListener` en el <select> del GPIO, guardado detrás de un chequeo de tipo
// para que un fake document que no lo implemente no rompa (el fake del test unitario
// no necesita simular eventos: eso lo verifica el orquestador en un navegador real).
//
// `manejadores.onCambioGpio({componenteId, terminalId, valor})` es la ÚNICA
// integración con el llamador (`app.js`) — este módulo nunca hace `fetch` ni decide
// qué pasa con el cambio, sólo avisa. `valor` es `null` cuando el usuario elige la
// opción "sin asignar" (AsignarPin con `pin: null` es una forma válida,
// `nucleo/operaciones.ts::validarFormaPayload`, caso `AsignarPin`).
//
// JS plano, ES module, sin build step (mismo criterio que `plan-de-pintado.js` y
// `opencode/tecniabot-web/*.js`) — nunca TypeScript acá, se sirve tal cual al
// navegador (`opencode/servidor/servidor-proyecto.ts`, lista blanca de `/assets/`).

/**
 * @param {Document} doc
 * @param {readonly object[]} instrucciones - salida de `planDePintado`.
 * @param {{ onCambioGpio?: (evento: { componenteId: string, terminalId: string, valor: string | null }) => void,
 *   onCambioRegla?: (e: { reglaId: string | null, slot: string, valor: string | null }) => void,
 *   onQuitarRegla?: (e: { reglaId: string | null }) => void, onAgregarRegla?: () => void,
 *   onAlternarTraza?: (e: { reglaId: string }) => void }} [manejadores]
 * @returns {{ circuito: Element, cables: Element, controles: Element, reglas: Element, motivos: Element }}
 *   Cinco raíces NUEVAS (nunca reusa ni muta un elemento existente) — el llamador
 *   (`app.js`) las monta donde corresponda (ej. `contenedor.replaceChildren(raiz)`).
 *   Reconstruir siempre desde cero, en vez de diffear el DOM anterior, es a
 *   propósito: la misma disciplina que el resto del slice ("nunca reconstruir
 *   estado desde algo viejo") — cada repintado sale de un snapshot autoritativo
 *   completo, nunca de un DOM parcialmente actualizado.
 */
export function pintar(doc, instrucciones, manejadores = {}) {
  const raiz = {
    circuito: doc.createElement("div"),
    cables: doc.createElement("ul"),
    controles: doc.createElement("div"),
    reglas: doc.createElement("div"),
    motivos: doc.createElement("ul"),
  }

  // Fase 2, Slice 2 (§3.4, resaltado C): `"tipo:id"` -> el elemento del circuito que
  // `pintarElemento` creó para esa entidad — SÓLO en memoria de esta llamada, nunca
  // toca el DOM para leerlo de vuelta (serían 4 operaciones más allá de las 3
  // documentadas arriba). Permite que `pintarMotivo`, más abajo en el MISMO plan,
  // marque `data-afectado` sobre el elemento ya creado sin ningún `getAttribute`.
  const elementosPorEntidad = new Map()

  // PFX-1 (RED-PHT-PHYSICAL-TRUTH F1): `componenteId` del ancla (`agrupadoCon`) ->
  // el grupo `<figure>`/fila ya creados para ESA fusión, mientras se espera la
  // instrucción del ancla misma — SÓLO en memoria de esta llamada (mismo patrón que
  // `elementosPorEntidad`, nunca se relee del DOM). El orden del plan YA garantiza
  // que la pieza fusionada llega ANTES que su ancla (servidor,
  // `snapshot-a-vista.ts::reordenarParaAdyacencia`): acá sólo se obedece ese orden.
  const gruposPendientes = new Map()

  for (const instruccion of instrucciones) {
    if (instruccion.tipo === "crearElemento") {
      pintarElemento(doc, raiz.circuito, instruccion, elementosPorEntidad, gruposPendientes)
      continue
    }
    if (instruccion.tipo === "filaCable") {
      pintarCable(doc, raiz.cables, instruccion)
      continue
    }
    if (instruccion.tipo === "selectorGpio") {
      pintarSelectorGpio(doc, raiz.controles, instruccion, manejadores)
      continue
    }
    if (instruccion.tipo === "reglaFrase") {
      pintarReglaFrase(doc, raiz.reglas, instruccion, elementosPorEntidad, manejadores)
      continue
    }
    if (instruccion.tipo === "reglaAviso") {
      const aviso = doc.createElement("p")
      aviso.setAttribute("data-aviso-reglas", "true")
      aviso.textContent = instruccion.texto
      raiz.reglas.appendChild(aviso)
      continue
    }
    if (instruccion.tipo === "reglaAgregar") {
      raiz.reglas.appendChild(crearBoton(doc, "agregar-regla", instruccion.etiqueta, instruccion.deshabilitado, () => avisar(manejadores.onAgregarRegla)))
      continue
    }
    if (instruccion.tipo === "panelMotivo") {
      pintarMotivo(doc, raiz.motivos, instruccion, elementosPorEntidad)
      continue
    }
    if (instruccion.tipo === "estadoVacio") {
      pintarEstadoVacio(doc, raiz.circuito, instruccion)
      continue
    }
    // Instrucción de un tipo que este pintor no conoce todavía — se ignora, nunca se
    // inventa un render: el mismo criterio fail-closed que `plan-de-pintado.js` ya
    // aplica para un componente sin tabla de render (se omite, no se dibuja con un
    // tag falso).
  }

  return raiz
}

// W0-8 (PHASE_3_WAVE_0_DESIGN.md): "Este proyecto todavía no tiene componentes..." —
// VISIBLE en `raiz.circuito` (no una superficie vacía). `instruccion.texto` ya viene
// resuelto por `plan-de-pintado.js`; este módulo sólo decide CÓMO construir el nodo
// (mismo criterio "tonto" del resto del archivo).
function pintarEstadoVacio(doc, contenedor, instruccion) {
  const parrafo = doc.createElement("p")
  parrafo.setAttribute("data-estado-vacio", "true")
  parrafo.textContent = instruccion.texto
  contenedor.appendChild(parrafo)
}

function pintarElemento(doc, contenedor, instruccion, elementosPorEntidad, gruposPendientes) {
  const elemento = doc.createElement(instruccion.tag)
  elemento.setAttribute("data-entidad-tipo", instruccion.entidad.tipo)
  elemento.setAttribute("data-entidad-id", instruccion.entidad.id)
  for (const [clave, valor] of Object.entries(instruccion.atributos)) {
    elemento.setAttribute(clave, valor)
  }
  if (elementosPorEntidad) elementosPorEntidad.set(`${instruccion.entidad.tipo}:${instruccion.entidad.id}`, elemento)

  // PFX-1 (RED-PHT-PHYSICAL-TRUTH F1, criterio pedagógico del diseño §2): esta pieza
  // es la RESISTENCIA de una fusión (`instruccion.agrupadoCon`, resuelto por el
  // servidor) — se dibuja en una fila DENTRO de un grupo propio, primero (a la
  // izquierda); el ancla llega después en el plan y se agrega a esta MISMA fila (ver
  // más abajo). El grupo no tiene rótulo todavía: lo pone el ancla, con SU rol.
  if (instruccion.agrupadoCon) {
    const grupo = doc.createElement("figure")
    grupo.setAttribute("data-entidad-tipo", "componente")
    grupo.setAttribute("data-entidad-id", instruccion.agrupadoCon)
    grupo.setAttribute("data-grupo-fusion", "true")
    grupo.setAttribute("style", "display:flex;flex-direction:column;align-items:flex-start;gap:4px")
    const fila = doc.createElement("span")
    fila.setAttribute("data-fila-fusion", "true")
    fila.setAttribute("style", "display:flex;flex-direction:row;align-items:center;gap:4px")
    fila.appendChild(elemento)
    grupo.appendChild(fila)
    contenedor.appendChild(grupo)
    gruposPendientes.set(instruccion.agrupadoCon, { grupo, fila })
    return elemento
  }

  // Esta pieza es el ANCLA de un grupo ya abierto por SU resistencia (arriba) — se
  // agrega a la MISMA fila (después, a la derecha) y el grupo recién ahora recibe su
  // ÚNICO rótulo: el rol del ancla (nunca el de la resistencia, que es `null`).
  const grupoPendiente = gruposPendientes?.get(instruccion.entidad.id)
  if (grupoPendiente) {
    grupoPendiente.fila.appendChild(elemento)
    if (instruccion.etiquetaRol) {
      const rotulo = doc.createElement("figcaption")
      rotulo.setAttribute("data-rol-de-componente", instruccion.entidad.id)
      rotulo.textContent = instruccion.etiquetaRol
      grupoPendiente.grupo.appendChild(rotulo)
    }
    gruposPendientes.delete(instruccion.entidad.id)
    return elemento
  }

  // Fix post-gate (Chromium real, .../s2impl/gate-vista/v2-gpio34-blocking.png): con
  // `#circuito` en `flex-wrap` (§3.5), un rótulo de rol pintado como hermano SUELTO
  // de la pieza podía terminar en OTRA línea del wrap, lejos de su componente ("El
  // rótulo 'Entrada' del pulsador se veía debajo del ESP32"). Fix: la pieza CON rol
  // va envuelta en un contenedor propio (`<figure>`, DOM/CSS mínimo, sin motor de
  // layout) que agrupa la pieza + su rótulo — flex-wrap sólo puede envolver ese
  // contenedor ENTERO, nunca separar la pieza de su texto. El contenedor repite
  // `data-entidad-tipo`/`data-entidad-id` (mismos valores que la pieza) para que
  // "mismo contenedor, misma entidad" sea trivial de verificar desde afuera.
  //
  // Sin rol (placa, componente sin rol pedagógico): la pieza sigue siendo hija
  // DIRECTA de `contenedor`, exactamente como antes de este fix — nunca se envuelve
  // sin necesidad. Un componente SIN fusión (ni `agrupadoCon` ni un grupo pendiente
  // esperándolo) cae acá EXACTAMENTE como antes de PFX-1.
  if (instruccion.etiquetaRol) {
    const contenedorPieza = doc.createElement("figure")
    contenedorPieza.setAttribute("data-entidad-tipo", instruccion.entidad.tipo)
    contenedorPieza.setAttribute("data-entidad-id", instruccion.entidad.id)
    contenedorPieza.setAttribute("data-pieza-de", instruccion.entidad.id)
    contenedorPieza.appendChild(elemento)

    const rotulo = doc.createElement("figcaption")
    rotulo.setAttribute("data-rol-de-componente", instruccion.entidad.id)
    rotulo.textContent = instruccion.etiquetaRol
    contenedorPieza.appendChild(rotulo)

    contenedor.appendChild(contenedorPieza)
  } else {
    contenedor.appendChild(elemento)
  }

  return elemento
}

function pintarCable(doc, contenedor, instruccion) {
  const fila = doc.createElement("li")
  fila.setAttribute("data-cable-id", instruccion.id)
  fila.textContent = `${instruccion.desde} → ${instruccion.hasta}`
  contenedor.appendChild(fila)
}

function pintarSelectorGpio(doc, contenedor, instruccion, manejadores) {
  // F-09 (PHASE_3_WAVE_0_DESIGN.md): el texto primario es `instruccion.etiqueta`
  // ("Pulsador — señal:"), YA resuelto por `plan-de-pintado.js` — este módulo nunca
  // arma el texto a partir de los ids crudos. `componenteId`/`terminalId` siguen acá
  // como `data-*`, metadata secundaria para quien los necesite (nunca texto primario).
  const etiqueta = doc.createElement("label")
  etiqueta.setAttribute("data-componente-id", instruccion.componenteId)
  etiqueta.setAttribute("data-terminal-id", instruccion.terminalId)
  etiqueta.textContent = instruccion.etiqueta ?? ""

  const selector = doc.createElement("select")
  selector.setAttribute("data-componente-id", instruccion.componenteId)
  selector.setAttribute("data-terminal-id", instruccion.terminalId)

  const opcionVacia = doc.createElement("option")
  opcionVacia.setAttribute("value", "")
  opcionVacia.textContent = "— sin asignar —"
  selector.appendChild(opcionVacia)

  for (const opcion of instruccion.opciones) {
    const elementoOpcion = doc.createElement("option")
    elementoOpcion.setAttribute("value", opcion.valor)
    elementoOpcion.textContent = opcion.etiqueta
    selector.appendChild(elementoOpcion)
  }

  selector.value = instruccion.valorActual ?? ""
  // Revisión post red-team (Hallazgo B2, MAJOR): sin conexión SSE viva, el selector
  // sale deshabilitado — nunca se decide acá POR QUÉ (eso es de `app.js`/
  // `plan-de-pintado.js`), sólo se aplica el dato de la instrucción.
  selector.disabled = Boolean(instruccion.deshabilitado)

  if (typeof selector.addEventListener === "function" && typeof manejadores.onCambioGpio === "function") {
    selector.addEventListener("change", () => {
      manejadores.onCambioGpio({
        componenteId: instruccion.componenteId,
        terminalId: instruccion.terminalId,
        valor: selector.value === "" ? null : selector.value,
      })
    })
  }

  etiqueta.appendChild(selector)
  contenedor.appendChild(etiqueta)
}

function pintarMotivo(doc, contenedor, instruccion, elementosPorEntidad) {
  const fila = doc.createElement("li")
  fila.setAttribute("data-motivo-codigo", instruccion.codigo)
  fila.setAttribute("data-motivo-severidad", instruccion.severidad)
  if (instruccion.clasificacion) fila.setAttribute("data-motivo-clasificacion", instruccion.clasificacion)

  // FX-3 (RED-W0-UX (a), ronda de fixes): con explicación en texto llano YA resuelta
  // del lado del servidor (`explicaciones-motivos.ts`), el alumno ve SÓLO esa
  // explicación — nunca "[blocking]"/el código crudo ("REQUISITO_INSATISFECHO")/la
  // clasificación entre paréntesis ("(representable)") como texto PRIMARIO. Esos tres
  // datos siguen disponibles como `data-*` (arriba), para quien los necesite — mismo
  // criterio que F-09 ya aplica para los ids crudos de componente/terminal
  // (`plan-de-pintado.js::etiquetaDeExtremo`).
  //
  // SIN traducción (`explicacion: null`), se mantiene el fallback crudo de SIEMPRE
  // (contrato Slice 2): un código que esta tabla no conoce todavía nunca se oculta,
  // se ve tal cual.
  if (instruccion.explicacion) {
    fila.textContent = instruccion.explicacion
  } else {
    const clasificacion = instruccion.clasificacion ? ` (${instruccion.clasificacion})` : ""
    fila.textContent = `[${instruccion.severidad}] ${instruccion.codigo}${clasificacion}`
  }

  // Fase 2, Slice 2 (§3.4, resaltado C): `data-entidad-*` en la fila — presentación
  // pura, derivada de `motivo.entidad` (que `plan-de-pintado.js` ya calculaba desde
  // Slice 1 y este pintor descartaba). Nunca inventa una entidad: sin `entidad`, no
  // se agrega ningún atributo.
  if (instruccion.entidad) {
    fila.setAttribute("data-entidad-tipo", instruccion.entidad.tipo)
    fila.setAttribute("data-entidad-id", instruccion.entidad.id)
  }

  contenedor.appendChild(fila)

  // Resaltado: el ELEMENTO del componente afectado (ya creado por `pintarElemento`,
  // antes en el mismo plan — `panelMotivo` siempre viene después de `crearElemento`
  // en `plan-de-pintado.js`) recibe `data-afectado="<severidad>"`. Un motivo sin
  // `entidad`, o cuya entidad no tiene un elemento creado (ej. una placa
  // desconocida, nunca dibujada), no marca nada — nunca se inventa un elemento.
  if (instruccion.entidad && elementosPorEntidad) {
    const afectado = elementosPorEntidad.get(`${instruccion.entidad.tipo}:${instruccion.entidad.id}`)
    if (afectado) afectado.setAttribute("data-afectado", instruccion.severidad)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3 (T5): la frase editable. Tonto a propósito: construye lo que la instrucción
// describe y avisa al llamador; nunca decide qué se manda ni qué significa un valor.
// ════════════════════════════════════════════════════════════════════════════════════

function avisar(manejador, evento) {
  if (typeof manejador === "function") manejador(evento)
}

function crearBoton(doc, accion, texto, deshabilitado, alClick) {
  const boton = doc.createElement("button")
  boton.setAttribute("type", "button")
  boton.setAttribute("data-accion", accion)
  boton.textContent = texto
  boton.disabled = Boolean(deshabilitado)
  if (typeof boton.addEventListener === "function") boton.addEventListener("click", alClick)
  return boton
}

function pintarReglaFrase(doc, contenedor, instruccion, elementosPorEntidad, manejadores) {
  const idTexto = instruccion.reglaId ?? ""
  const caja = doc.createElement("div")
  caja.setAttribute("data-regla-id", idTexto === "" ? "nueva" : idTexto)
  // Resaltado de los motivos de la regla (`panelMotivo` con entidad "comportamiento" marca
  // `data-afectado` sobre este elemento, mismo mecanismo que los componentes).
  if (instruccion.reglaId !== null) elementosPorEntidad.set(`comportamiento:${instruccion.reglaId}`, caja)

  const frase = doc.createElement("p")
  frase.setAttribute("data-frase", "true")
  for (const sel of instruccion.selectores) {
    const prefijo = doc.createElement("span")
    prefijo.textContent = `${sel.prefijo} `
    frase.appendChild(prefijo)

    const selector = doc.createElement("select")
    selector.setAttribute("data-regla-id", idTexto === "" ? "nueva" : idTexto)
    selector.setAttribute("data-slot", sel.slot)
    if (sel.placeholder !== null) {
      const vacia = doc.createElement("option")
      vacia.setAttribute("value", "")
      vacia.textContent = sel.placeholder
      selector.appendChild(vacia)
    }
    for (const opcion of sel.opciones) {
      const o = doc.createElement("option")
      o.setAttribute("value", opcion.valor)
      o.textContent = opcion.etiqueta
      selector.appendChild(o)
    }
    selector.value = sel.valorActual ?? ""
    selector.disabled = Boolean(sel.deshabilitado)
    if (typeof selector.addEventListener === "function") {
      selector.addEventListener("change", () => avisar(manejadores.onCambioRegla, { reglaId: instruccion.reglaId, slot: sel.slot, valor: selector.value === "" ? null : selector.value }))
    }
    frase.appendChild(selector)
    const espacio = doc.createElement("span")
    espacio.textContent = " "
    frase.appendChild(espacio)
  }
  const cierre = doc.createElement("span")
  cierre.textContent = instruccion.cierre
  frase.appendChild(cierre)
  caja.appendChild(frase)

  if (instruccion.aviso) {
    const aviso = doc.createElement("p")
    aviso.setAttribute("data-aviso-condicion-avanzada", "true")
    aviso.textContent = instruccion.aviso
    caja.appendChild(aviso)
  }

  if (instruccion.explicaciones.length > 0) {
    const lista = doc.createElement("ul")
    lista.setAttribute("data-regla-motivos", "true")
    for (const texto of instruccion.explicaciones) {
      const fila = doc.createElement("li")
      fila.textContent = texto
      lista.appendChild(fila)
    }
    caja.appendChild(lista)
  }

  caja.appendChild(crearBoton(doc, "quitar-regla", "Quitar regla", instruccion.deshabilitado, () => avisar(manejadores.onQuitarRegla, { reglaId: instruccion.reglaId })))
  if (instruccion.conTraza) {
    caja.appendChild(crearBoton(doc, "alternar-traza", instruccion.etiquetaTraza, instruccion.deshabilitado, () => avisar(manejadores.onAlternarTraza, { reglaId: instruccion.reglaId })))
  }
  if (instruccion.traza) {
    const traza = doc.createElement("div")
    traza.setAttribute("data-traza", "true")
    const etiqueta = doc.createElement("p")
    etiqueta.textContent = instruccion.traza.etiqueta
    traza.appendChild(etiqueta)
    const ramas = doc.createElement("ul")
    for (const texto of instruccion.traza.ramas) {
      const rama = doc.createElement("li")
      rama.textContent = texto
      ramas.appendChild(rama)
    }
    traza.appendChild(ramas)
    if (instruccion.traza.nota) {
      const nota = doc.createElement("p")
      nota.textContent = instruccion.traza.nota
      traza.appendChild(nota)
    }
    caja.appendChild(traza)
  }
  contenedor.appendChild(caja)
}
