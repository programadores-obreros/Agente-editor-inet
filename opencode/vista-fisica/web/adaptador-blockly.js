// Adaptador Blockly — Phase 3, vertical #2 (contrato PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md §3-§5).
//
// Capa delgada entre el modelo lógico (`vista-logica.js`, puro) y la API de Blockly, que se
// INYECTA: este módulo nunca importa ni lee Blockly como global, así que se prueba en Node con
// una API falsa. Blockly es sólo una VISTA descartable: no se serializa nada (ni XML, ni JSON de
// workspace, ni ids de bloque), no hay generadores de código ni toolbox. Un workspace nuevo
// pintado desde el mismo modelo da exactamente los mismos campos.
//
// UN PAR POR REGLA, apilados de arriba abajo en el orden del modelo (2026-11-24; antes se dibujaba
// sólo la primera regla). Los campos de dos reglas se llaman igual (el nombre del campo es su
// slot), así que NADA se resuelve por nombre de campo suelto: cada edición se atribuye por el
// bloque que la originó (`evento.blockId`) y cada valor se pinta en el bloque de SU regla. Pintar
// por nombre recorriendo todos los bloques escribiría el valor de una regla en la otra: un OK
// falso en pantalla.
//
// Forma fija de cada par: un bloque contenedor «mientras» con UN bloque de acción encastrado, y un dropdown
// por campo del modelo (los campos se reparten por índice: la primera mitad en el contenedor y el
// resto en la acción; la forma fija de 4 campos queda 2+2). Los nombres de campo, los textos fijos y las opciones los dicta el
// modelo (que viene del servidor); acá no se nombra ninguno.

const TIPO_MIENTRAS = "tecnia_mientras"
const TIPO_HACER = "tecnia_hacer"
const SENTINELA = "__sin_valor__"
const MENSAJES = { sentinela: "— elegí —", hacer: "hacer:" }
// Lugar de los pares en el lienzo. El alto de un par lo dice Blockly después de dibujarlo; si la
// API no lo informa (la de prueba), se usa el estimado.
const MARGEN = 16
const SEPARACION = 16
const ALTO_ESTIMADO_DEL_PAR = 96

/** Las reglas a dibujar. Un modelo viejo que sólo trae `regla` vale como lista de una. */
const reglasDe = (modelo) => modelo.reglas ?? (modelo.regla ? [modelo.regla] : [])

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
    // Con varias reglas el lienzo puede no alcanzar: barra vertical y rueda para llegar a todas.
    move: { scrollbars: { horizontal: true, vertical: true }, drag: false, wheel: true },
  })

  // Blockly mide su contenedor: tras inyectar (y tras cada pintado) hay que avisarle, o queda en tamaño 0.
  const medir = () => {
    if (typeof Blockly.svgResize === "function") Blockly.svgResize(workspace)
  }
  medir()

  let destruido = false
  /** Un elemento por regla dibujada: la regla del modelo y sus dos bloques. */
  let pares = []
  let firmaActual = null
  const parDelBloque = (idBloque) => pares.find((p) => p.mientras.id === idBloque || p.hacer.id === idBloque) ?? null

  const alCambiarCampo = (evento) => {
    if (destruido || pares.length === 0) return
    if (evento.type !== Blockly.Events.BLOCK_CHANGE || evento.isUiEvent || evento.element !== "field") return
    // La regla sale del BLOQUE que cambió, nunca del nombre del campo (se repite entre reglas).
    const par = parDelBloque(evento.blockId)
    if (!par) return
    const campo = par.regla.campos.find((c) => c.slot === evento.name)
    if (!campo) return
    const valor = evento.newValue
    // Numeric Conditions S1: un campo de número manda lo que se escribió; si es lo mismo que se
    // lee (o quedó vacío), no es una edición. El controlador lo interpreta y el Engine decide.
    if (campo.tipo === "numero") {
      if (valor === (campo.etiquetaActual ?? "") || String(valor).trim() === "") return
      alEditar({ reglaId: par.regla.id, slot: campo.slot, valor })
      return
    }
    if (valor === SENTINELA) {
      // Gana el snapshot: "— elegí —" nunca es una edición. Si la regla ya tenía valor, el campo vuelve a él.
      if (campo.valor !== null) restaurar(evento.blockId, campo)
      return
    }
    if (valor === campo.valor) return
    alEditar({ reglaId: par.regla.id, slot: campo.slot, valor })
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

  /** Dibuja el par de UNA regla con su borde superior en `y`; devuelve sus bloques y su alto. */
  function construir(campos, y) {
    const contenedorBloque = workspace.newBlock(TIPO_MIENTRAS)
    const accion = workspace.newBlock(TIPO_HACER)
    // Si el servidor dice en qué bloque va cada campo (`grupo`), se respeta; si no, la forma fija
    // de siempre: la primera mitad en el «mientras» y el resto en el «hacer».
    const conGrupo = campos.every((c) => c.grupo === "cuando" || c.grupo === "entonces")
    const mitad = Math.ceil(campos.length / 2)
    const reparto = conGrupo
      ? [[contenedorBloque, campos.filter((c) => c.grupo === "cuando")], [accion, campos.filter((c) => c.grupo === "entonces")]]
      : [[contenedorBloque, campos.slice(0, mitad)], [accion, campos.slice(mitad)]]
    for (const [bloque, delBloque] of reparto) {
      const entrada = bloque.getInput("CAMPOS")
      for (const campo of delBloque) {
        // el texto fijo viene del servidor; una coma inicial (de la frase corrida) no se muestra suelta
        const prefijo = campo.prefijo.replace(/^[,\s]+/, "")
        if (prefijo !== "") entrada.appendField(new Blockly.FieldLabel(prefijo))
        if (campo.tipo === "numero") entrada.appendField(new Blockly.FieldTextInput(campo.etiquetaActual ?? ""), campo.slot)
        else entrada.appendField(new Blockly.FieldDropdown(opcionesDeCampo(campo, textos)), campo.slot)
      }
    }
    contenedorBloque.getInput("ACCION").connection.connect(accion.previousConnection)
    for (const bloque of [contenedorBloque, accion]) {
      bloque.setDeletable(false)
      bloque.setMovable(false)
      bloque.initSvg()
      bloque.render()
    }
    if (typeof contenedorBloque.moveBy === "function") contenedorBloque.moveBy(MARGEN, y)
    const medida = typeof contenedorBloque.getHeightWidth === "function" ? contenedorBloque.getHeightWidth() : null
    const alto = medida && Number.isFinite(medida.height) && medida.height > 0 ? medida.height : ALTO_ESTIMADO_DEL_PAR
    return { mientras: contenedorBloque, hacer: accion, alto }
  }

  const firmaDeCampos = (campos) => campos.map((c) => [c.slot, c.prefijo, c.tipo ?? "opciones", c.grupo ?? null, c.tipo === "numero" ? [] : opcionesDeCampo(c, textos)])

  function pintar(modelo, { deshabilitado = false } = {}) {
    if (destruido) return
    Blockly.Events.disable()
    try {
      const reglas = reglasDe(modelo)
      if (reglas.length === 0) {
        workspace.clear()
        pares = []
        firmaActual = null
        return
      }
      // La firma es la FORMA de cada par, en orden (no el id de la regla: una regla que recién
      // nace pasa de `null` a su id sin que cambie un solo bloque). Si cambia cuántas hay o la
      // forma de alguna, se redibuja todo; si no, cada par toma los valores de la regla de su lugar.
      const firma = JSON.stringify(reglas.map((r) => firmaDeCampos(r.campos)))
      if (firma !== firmaActual) {
        firmaActual = null
        pares = []
        workspace.clear()
        let y = MARGEN
        const nuevos = []
        for (const regla of reglas) {
          const par = construir(regla.campos, y)
          nuevos.push({ regla, mientras: par.mientras, hacer: par.hacer })
          y += par.alto + SEPARACION
        }
        pares = nuevos
        firmaActual = firma
      } else {
        // Mismos bloques, modelo nuevo: cada par pasa a apuntar a la regla recién llegada.
        pares = pares.map((par, i) => ({ ...par, regla: reglas[i] }))
      }
      for (const par of pares) {
        for (const campo of par.regla.campos) {
          // Sólo los dos bloques de ESTA regla: el mismo nombre de campo existe en las demás.
          for (const bloque of [par.mientras, par.hacer]) {
            const f = bloque.getField(campo.slot)
            if (!f) continue
            bloque.setFieldValue(campo.tipo === "numero" ? (campo.etiquetaActual ?? "") : (campo.valor ?? SENTINELA), campo.slot)
            if (typeof f.setEnabled === "function") f.setEnabled(!deshabilitado)
          }
        }
      }
      if (typeof workspace.resize === "function") workspace.resize()
      medir()
    } finally {
      Blockly.Events.enable()
    }
  }

  /** Quita LA regla dibujada. Con varias no elige ninguna (no hay "la" regla): eso se hace en la sección Reglas. */
  function quitar() {
    if (destruido || pares.length !== 1 || pares[0].regla.id === null) return
    alQuitar({ reglaId: pares[0].regla.id })
  }

  function destruir() {
    if (destruido) return
    destruido = true
    workspace.removeChangeListener(alCambiarCampo)
    workspace.dispose()
  }

  return { pintar, quitar, destruir }
}
