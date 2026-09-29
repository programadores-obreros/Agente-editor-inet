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
 * @param {{ onCambioGpio?: (evento: { componenteId: string, terminalId: string, valor: string | null }) => void }} [manejadores]
 * @returns {{ circuito: Element, cables: Element, controles: Element, motivos: Element }}
 *   Cuatro raíces NUEVAS (nunca reusa ni muta un elemento existente) — el llamador
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
    motivos: doc.createElement("ul"),
  }

  for (const instruccion of instrucciones) {
    if (instruccion.tipo === "crearElemento") {
      pintarElemento(doc, raiz.circuito, instruccion)
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
    if (instruccion.tipo === "panelMotivo") {
      pintarMotivo(doc, raiz.motivos, instruccion)
      continue
    }
    // Instrucción de un tipo que este pintor no conoce todavía — se ignora, nunca se
    // inventa un render: el mismo criterio fail-closed que `plan-de-pintado.js` ya
    // aplica para un componente sin tabla de render (se omite, no se dibuja con un
    // tag falso).
  }

  return raiz
}

function pintarElemento(doc, contenedor, instruccion) {
  const elemento = doc.createElement(instruccion.tag)
  elemento.setAttribute("data-entidad-tipo", instruccion.entidad.tipo)
  elemento.setAttribute("data-entidad-id", instruccion.entidad.id)
  for (const [clave, valor] of Object.entries(instruccion.atributos)) {
    elemento.setAttribute(clave, valor)
  }
  contenedor.appendChild(elemento)
}

function pintarCable(doc, contenedor, instruccion) {
  const fila = doc.createElement("li")
  fila.setAttribute("data-cable-id", instruccion.id)
  fila.textContent = `${instruccion.desde} → ${instruccion.hasta}`
  contenedor.appendChild(fila)
}

function pintarSelectorGpio(doc, contenedor, instruccion, manejadores) {
  const etiqueta = doc.createElement("label")
  etiqueta.setAttribute("data-componente-id", instruccion.componenteId)
  etiqueta.setAttribute("data-terminal-id", instruccion.terminalId)
  etiqueta.textContent = `${instruccion.componenteId} / ${instruccion.terminalId}: `

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

function pintarMotivo(doc, contenedor, instruccion) {
  const fila = doc.createElement("li")
  fila.setAttribute("data-motivo-codigo", instruccion.codigo)
  fila.setAttribute("data-motivo-severidad", instruccion.severidad)
  const clasificacion = instruccion.clasificacion ? ` (${instruccion.clasificacion})` : ""
  fila.textContent = `[${instruccion.severidad}] ${instruccion.codigo}${clasificacion}`
  contenedor.appendChild(fila)
}
