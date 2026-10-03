// Adaptador Blockly — Phase 3, vertical #2 (contrato PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md §3-§5).
//
// Capa delgada entre el modelo lógico (`vista-logica.js`, puro) y la API de Blockly, que se
// INYECTA: este módulo nunca importa ni lee Blockly como global, así que se prueba en Node con
// una API falsa. Blockly es sólo una VISTA descartable: no se serializa nada (ni XML, ni JSON de
// workspace, ni ids de bloque), no hay generadores de código ni toolbox. Un workspace nuevo
// pintado desde el mismo modelo da exactamente los mismos campos.
//
// Forma fija: un bloque contenedor «mientras» con UN bloque de acción encastrado, y un dropdown
// por campo del modelo (los campos se reparten por índice: la primera mitad en el contenedor y el
// resto en la acción; la forma fija de 4 campos queda 2+2). Los nombres de campo, los textos fijos y las opciones los dicta el
// modelo (que viene del servidor); acá no se nombra ninguno.

const TIPO_MIENTRAS = "tecnia_mientras"
const TIPO_HACER = "tecnia_hacer"
const SENTINELA = "__sin_valor__"
const MENSAJES = { sentinela: "— elegí —", hacer: "hacer:" }

/** Opciones del dropdown: centinela primero, luego las del servidor y, si el valor actual no es
 * una de ellas (p. ej. una condición que la vista no sabe armar), el valor actual con su etiqueta. */
function opcionesDeCampo(campo, mensajes) {
  const opciones = [[mensajes.sentinela, SENTINELA], ...campo.opciones.map((o) => [o.etiqueta, o.valor])]
  if (campo.valor !== null && !campo.opciones.some((o) => o.valor === campo.valor)) opciones.push([campo.etiquetaActual ?? "", campo.valor])
  return opciones
}

/**
 * @param {{ Blockly: object, contenedor: Element, alEditar: (e: { reglaId: string | null, slot: string, valor: string }) => void,
 *   alQuitar: (e: { reglaId: string }) => void, media?: string, mensajes?: Partial<typeof MENSAJES> }} config
 */
export function crearAdaptadorBlockly({ Blockly, contenedor, alEditar, alQuitar, media = "/assets/blockly/media/", mensajes = {} }) {
  if (!Blockly) throw new Error("crearAdaptadorBlockly: hay que inyectar la API de Blockly")
  const textos = { ...MENSAJES, ...mensajes }

  if (!Blockly.Blocks[TIPO_MIENTRAS]) {
    Blockly.defineBlocksWithJsonArray([
      {
        type: TIPO_MIENTRAS,
        message0: "%1",
        args0: [{ type: "input_dummy", name: "CAMPOS" }],
        message1: "%1",
        args1: [{ type: "input_statement", name: "ACCION" }],
        colour: 210,
        tooltip: "",
      },
      {
        type: TIPO_HACER,
        message0: `${textos.hacer} %1`,
        args0: [{ type: "input_dummy", name: "CAMPOS" }],
        previousStatement: null,
        colour: 120,
        tooltip: "",
      },
    ])
  }

  const workspace = Blockly.inject(contenedor, {
    sounds: false,
    media,
    readOnly: false,
    trashcan: false,
    zoom: { controls: false, wheel: false, pinch: false },
    move: { scrollbars: { horizontal: true, vertical: false }, drag: false, wheel: false },
  })

  // Blockly mide su contenedor: tras inyectar (y tras cada pintado) hay que avisarle, o queda en tamaño 0.
  const medir = () => {
    if (typeof Blockly.svgResize === "function") Blockly.svgResize(workspace)
  }
  medir()

  let destruido = false
  let modeloActual = null
  let firmaActual = null

  const alCambiarCampo = (evento) => {
    if (destruido || modeloActual === null) return
    if (evento.type !== Blockly.Events.BLOCK_CHANGE || evento.isUiEvent || evento.element !== "field") return
    const campo = modeloActual.regla.campos.find((c) => c.slot === evento.name)
    if (!campo) return
    const valor = evento.newValue
    if (valor === SENTINELA) {
      // Gana el snapshot: "— elegí —" nunca es una edición. Si la regla ya tenía valor, el campo vuelve a él.
      if (campo.valor !== null) restaurar(evento.blockId, campo)
      return
    }
    if (valor === campo.valor) return
    alEditar({ reglaId: modeloActual.regla.id, slot: campo.slot, valor })
  }
  workspace.addChangeListener(alCambiarCampo)

  function restaurar(idBloque, campo) {
    const bloque = workspace.getBlockById(idBloque)
    if (!bloque) return
    Blockly.Events.disable()
    try {
      bloque.setFieldValue(campo.valor, campo.slot)
    } finally {
      Blockly.Events.enable()
    }
  }

  function construir(campos) {
    const mitad = Math.ceil(campos.length / 2)
    const contenedorBloque = workspace.newBlock(TIPO_MIENTRAS)
    const accion = workspace.newBlock(TIPO_HACER)
    const reparto = [[contenedorBloque, campos.slice(0, mitad)], [accion, campos.slice(mitad)]]
    for (const [bloque, delBloque] of reparto) {
      const entrada = bloque.getInput("CAMPOS")
      for (const campo of delBloque) {
        // el texto fijo viene del servidor; una coma inicial (de la frase corrida) no se muestra suelta
        entrada.appendField(new Blockly.FieldLabel(campo.prefijo.replace(/^[,\s]+/, "")))
        entrada.appendField(new Blockly.FieldDropdown(opcionesDeCampo(campo, textos)), campo.slot)
      }
    }
    contenedorBloque.getInput("ACCION").connection.connect(accion.previousConnection)
    for (const bloque of [contenedorBloque, accion]) {
      bloque.setDeletable(false)
      bloque.setMovable(false)
      bloque.initSvg()
      bloque.render()
    }
    if (typeof contenedorBloque.moveBy === "function") contenedorBloque.moveBy(16, 16)
  }

  function pintar(modelo, { deshabilitado = false } = {}) {
    if (destruido) return
    Blockly.Events.disable()
    try {
      modeloActual = modelo.regla ? modelo : null
      if (!modelo.regla) {
        workspace.clear()
        firmaActual = null
        return
      }
      const campos = modelo.regla.campos
      const firma = JSON.stringify(campos.map((c) => [c.slot, c.prefijo, opcionesDeCampo(c, textos)]))
      if (firma !== firmaActual) {
        firmaActual = null
        workspace.clear()
        construir(campos)
        firmaActual = firma
      }
      const bloques = workspace.getAllBlocks()
      for (const campo of campos) {
        for (const bloque of bloques) {
          const f = bloque.getField(campo.slot)
          if (!f) continue
          bloque.setFieldValue(campo.valor ?? SENTINELA, campo.slot)
          if (typeof f.setEnabled === "function") f.setEnabled(!deshabilitado)
        }
      }
      if (typeof workspace.resize === "function") workspace.resize()
      medir()
    } finally {
      Blockly.Events.enable()
    }
  }

  function quitar() {
    if (destruido || modeloActual === null || modeloActual.regla.id === null) return
    alQuitar({ reglaId: modeloActual.regla.id })
  }

  function destruir() {
    if (destruido) return
    destruido = true
    workspace.removeChangeListener(alCambiarCampo)
    workspace.dispose()
  }

  return { pintar, quitar, destruir }
}
