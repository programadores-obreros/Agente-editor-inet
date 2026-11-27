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
// LA ESTRUCTURA DEL PROGRAMA (2026-11-26). Los pares ya no van sueltos: van adentro de un bloque
// «por siempre», y arriba hay un bloque «al iniciar» con un renglón por cada cosa que el programa
// prepara al arrancar. Es la forma de todo programa de microcontrolador (lo que se hace una vez y
// lo que se repite), y antes sólo se veía en el código. Además, «mientras» suelto se puede leer
// como una espera que frena el programa; adentro de «por siempre» se ve que es una condición que
// se vuelve a mirar en cada vuelta.
//   - Los dos bloques nuevos son de SÓLO LECTURA: no tienen campos, no se mueven ni se borran.
//   - Los renglones de «al iniciar» son texto que manda el servidor (salen del programa generado
//     para ESTA revisión). Si todavía no llegaron, el bloque lo dice; no se muestran los de antes.
//   - Tocar un bloque avisa cuál es (`alSeleccionar`) para que la página marque sus líneas en el
//     código; `marcar` hace el camino inverso. Acá no se sabe nada de líneas.
//
// Forma fija de cada par: un bloque contenedor «mientras» con UN bloque de acción encastrado, y un dropdown
// por campo del modelo (los campos se reparten por índice: la primera mitad en el contenedor y el
// resto en la acción; la forma fija de 4 campos queda 2+2). Los nombres de campo, los textos fijos y las opciones los dicta el
// modelo (que viene del servidor); acá no se nombra ninguno.

const TIPO_MIENTRAS = "tecnia_mientras"
const TIPO_HACER = "tecnia_hacer"
const TIPO_AL_INICIAR = "tecnia_al_iniciar"
const TIPO_PASO = "tecnia_paso"
const TIPO_POR_SIEMPRE = "tecnia_por_siempre"
const SENTINELA = "__sin_valor__"
/** `sinPasos` es lo que dice «al iniciar» mientras no se sabe qué prepara el programa de esta
 * revisión (no llegó, o no hay programa). Los tres textos nuevos están aprobados para la prueba por
 * el dueño (2026-11-27) y pendientes de verlos en pantalla: no es la aprobación final. */
const MENSAJES = { sentinela: "— elegí —", hacer: "hacer:", alIniciar: "al iniciar", porSiempre: "por siempre", sinPasos: "se completa cuando el programa esté listo" }

/**
 * El color de cada bloque es el de su rol en el esquema: «mientras» es la ENTRADA (lo que se lee)
 * y «hacer» es la SALIDA (lo que se maneja). Son los MISMOS valores que `--entrada` y `--salida`
 * de `index.html`; Blockly no lee variables de CSS, así que van acá como literales, en un solo
 * lugar. Que coincidan con la hoja y que el texto blanco de Blockly se lea encima (contraste
 * ≥ 4.5) lo comprueba `tests/ventana-colores-bloques.test.mjs`.
 */
export const COLORES_DE_BLOQUE = Object.freeze({ mientras: "#1d4ed8", hacer: "#0f766e" })
/**
 * Los bloques de la estructura («al iniciar», «por siempre» y los renglones) son del controlador:
 * no leen ni manejan nada, dicen cuándo pasa cada cosa. Llevan el color de la zona del controlador
 * en el esquema (`--ctrl`); el mismo test los ata a la hoja y les mide el contraste.
 */
export const COLOR_DE_ESTRUCTURA = "#334155"
// Lugar de los bloques en el lienzo: «al iniciar» arriba y «por siempre» debajo. El alto de un
// bloque lo dice Blockly después de dibujarlo; si la API no lo informa (la de prueba), se usa el
// estimado.
const MARGEN = 16
const SEPARACION = 16
const ALTO_ESTIMADO_DE_AL_INICIAR = 96
/**
 * El lienzo crece con lo que tiene adentro, entre estos dos altos; pasado el máximo, queda la barra.
 * El máximo es alto a propósito. Con 640 px, seis reglas ya no entraban (medido en Chromium: los
 * bloques pedían 716 px y la última regla quedaba cortada), y adentro del lienzo la rueda está
 * apagada: lo que no entra sólo se alcanza con la barra. Un lienzo largo no molesta, porque la
 * página se desplaza sola; uno corto esconde reglas. 1600 px son unas veinte reglas.
 */
export const ALTO_MINIMO_DEL_LIENZO = 260
export const ALTO_MAXIMO_DEL_LIENZO = 1600
/** Lo que se deja libre debajo del último bloque: el margen y el lugar de la barra horizontal de
 * Blockly, que va pegada al borde de abajo y si no tapa el cierre de «por siempre». */
export const LIBRE_BAJO_LOS_BLOQUES = 32

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
 *   alQuitar: (e: { reglaId: string }) => void, alSeleccionar?: (clave: ClaveDeBloque | null) => void,
 *   media?: string, mensajes?: Partial<typeof MENSAJES> }} config
 * @typedef {{ bloque: "alIniciar" } | { bloque: "porSiempre" } | { bloque: "paso", indice: number } | { bloque: "regla", reglaId: string }} ClaveDeBloque
 *   Qué bloque es, sin ids de Blockly: es lo único que sale de acá hacia la página.
 */
export function crearAdaptadorBlockly({ Blockly, contenedor, alEditar, alQuitar, alSeleccionar = () => {}, media = "/assets/blockly/media/", mensajes = {} }) {
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
        // Los pares se encastran uno debajo del otro adentro de «por siempre».
        previousStatement: null,
        nextStatement: null,
        colour: COLORES_DE_BLOQUE.mientras,
        tooltip: "",
      },
      {
        type: TIPO_HACER,
        message0: `${textos.hacer} %1`,
        args0: [{ type: "input_dummy", name: "CAMPOS" }],
        previousStatement: null,
        colour: COLORES_DE_BLOQUE.hacer,
        tooltip: "",
      },
      {
        type: TIPO_AL_INICIAR,
        message0: textos.alIniciar,
        message1: "%1",
        args1: [{ type: "input_statement", name: "PASOS" }],
        colour: COLOR_DE_ESTRUCTURA,
        tooltip: "",
      },
      {
        type: TIPO_PASO,
        message0: "%1",
        args0: [{ type: "input_dummy", name: "CAMPOS" }],
        previousStatement: null,
        nextStatement: null,
        colour: COLOR_DE_ESTRUCTURA,
        tooltip: "",
      },
      {
        type: TIPO_POR_SIEMPRE,
        message0: textos.porSiempre,
        message1: "%1",
        args1: [{ type: "input_statement", name: "REGLAS" }],
        colour: COLOR_DE_ESTRUCTURA,
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
    // Con varias reglas el lienzo puede no alcanzar: barra vertical para llegar a todas.
    // La RUEDA no: se habilitó el 2026-11-24 y en la notebook real, al bajar por la página con el
    // cursor sobre el lienzo, la rueda movía los bloques en vez de la página y la primera regla
    // quedaba cortada arriba, sin volver sola. Reproducido en Chromium: cuatro pasos de rueda
    // sobre el lienzo corren los bloques. Queda la barra, que no se usa sin querer.
    move: { scrollbars: { horizontal: true, vertical: true }, drag: false, wheel: false },
  })

  // Blockly mide su contenedor: tras inyectar (y tras cada pintado) hay que avisarle, o queda en tamaño 0.
  const medir = () => {
    if (typeof Blockly.svgResize === "function") Blockly.svgResize(workspace)
  }
  medir()

  // El lienzo crece con sus bloques (dentro de un mínimo y un máximo): con «al iniciar», «por
  // siempre» y dos reglas, los 260 px fijos de antes dejaban la mitad detrás de la barra.
  const ajustarAlto = () => {
    if (!contenedor?.style || typeof workspace.getBlocksBoundingBox !== "function") return
    const caja = workspace.getBlocksBoundingBox()
    if (!caja || !Number.isFinite(caja.bottom)) return
    const alto = Math.min(ALTO_MAXIMO_DEL_LIENZO, Math.max(ALTO_MINIMO_DEL_LIENZO, Math.ceil(caja.bottom + LIBRE_BAJO_LOS_BLOQUES)))
    contenedor.style.height = `${alto}px`
  }
  // Blockly termina de dibujar los bloques un instante después de `render()` (los encola). Medido
  // en Chromium el 2026-11-26: tomada en el momento, la caja de los bloques daba menos que la
  // final y el lienzo quedaba corto, con el cierre de «por siempre» detrás de la barra. Por eso se
  // mide en el momento y OTRA VEZ cuando Blockly avisa que terminó.
  const ajustarAltoAlTerminarDeDibujar = () => {
    ajustarAlto()
    const terminar = Blockly.renderManagement?.finishQueuedRenders
    if (typeof terminar !== "function") return
    Promise.resolve(terminar()).then(
      () => {
        if (destruido) return
        ajustarAlto()
        medir()
      },
      () => {},
    )
  }

  let destruido = false
  /** Un elemento por regla dibujada: la regla del modelo y sus dos bloques. */
  let pares = []
  /** Los bloques de la estructura que están dibujados. `pasos` sólo tiene los renglones que
   * vinieron del servidor: el renglón de «todavía no se sabe» no es un paso del programa. */
  let estructura = { alIniciar: null, porSiempre: null, pasos: [] }
  let firmaActual = null
  let marcados = []
  const parDelBloque = (idBloque) => pares.find((p) => p.mientras.id === idBloque || p.hacer.id === idBloque) ?? null

  /** Qué bloque es, para la página; `null` si no es ninguno que tenga algo que mostrar en el código. */
  function claveDelBloque(idBloque) {
    if (estructura.alIniciar?.id === idBloque) return { bloque: "alIniciar" }
    if (estructura.porSiempre?.id === idBloque) return { bloque: "porSiempre" }
    const indice = estructura.pasos.findIndex((b) => b.id === idBloque)
    if (indice >= 0) return { bloque: "paso", indice }
    const par = parDelBloque(idBloque)
    // Una regla que todavía no nació (sin id) no está en el programa.
    return par && par.regla.id !== null ? { bloque: "regla", reglaId: par.regla.id } : null
  }

  /** Los bloques de una clave (una regla son dos: su «mientras» y su «hacer»). */
  function bloquesDeLaClave(clave) {
    if (!clave) return []
    if (clave.bloque === "alIniciar") return estructura.alIniciar ? [estructura.alIniciar] : []
    if (clave.bloque === "porSiempre") return estructura.porSiempre ? [estructura.porSiempre] : []
    if (clave.bloque === "paso") return estructura.pasos[clave.indice] ? [estructura.pasos[clave.indice]] : []
    const par = clave.bloque === "regla" ? pares.find((p) => p.regla.id !== null && p.regla.id === clave.reglaId) : null
    return par ? [par.mientras, par.hacer] : []
  }

  const alCambiarCampo = (evento) => {
    if (destruido) return
    // Tocar un bloque es un evento de la interfaz, no un cambio.
    //
    // «Se deseleccionó» NO es «se tocó el fondo» (2026-11-27). Blockly avisa `selected` sin
    // elemento nuevo en tres casos, medidos en Chromium:
    //   - se tocó el fondo del lienzo (y además manda `click` con `targetType: "workspace"`);
    //   - se apretó el mouse FUERA del lienzo, en cualquier lado de la página;
    //   - se abrió la lista de un casillero: `selected` con el bloque y, enseguida, `selected` vacío.
    // La primera versión borraba lo marcado en los tres. Resultado, visto en la notebook del dueño:
    // el enlace «Verlo en el código» borraba las líneas que prometía mostrar (el clic en el enlace
    // es un clic fuera del lienzo), y tocar un casillero no dejaba nada marcado. Ahora sólo el
    // clic de verdad en el fondo avisa «ninguno»; una deselección sola no avisa nada.
    if (Blockly.Events.SELECTED !== undefined && evento.type === Blockly.Events.SELECTED) {
      if (evento.newElementId) alSeleccionar(claveDelBloque(evento.newElementId))
      return
    }
    if (Blockly.Events.CLICK !== undefined && evento.type === Blockly.Events.CLICK) {
      if (evento.targetType === "workspace") alSeleccionar(null)
      return
    }
    if (pares.length === 0) return
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

  const fijar = (bloque) => {
    bloque.setDeletable(false)
    bloque.setMovable(false)
    bloque.initSvg()
    bloque.render()
  }
  /** Encastra `bloques` uno debajo del otro adentro de la entrada `nombre` de `contenedorBloque`. */
  function encastrar(contenedorBloque, nombre, bloques) {
    let conexion = contenedorBloque.getInput(nombre).connection
    for (const bloque of bloques) {
      conexion.connect(bloque.previousConnection)
      conexion = bloque.nextConnection
    }
  }

  /**
   * Dibuja «al iniciar» con sus renglones. `pasos` es la lista de textos del servidor, o `null`
   * si no se sabe (ahí va un solo renglón que lo dice, y no cuenta como paso).
   */
  function construirAlIniciar(pasos) {
    const bloque = workspace.newBlock(TIPO_AL_INICIAR)
    const renglones = (pasos ?? [textos.sinPasos]).map((texto) => {
      const renglon = workspace.newBlock(TIPO_PASO)
      renglon.getInput("CAMPOS").appendField(new Blockly.FieldLabel(texto))
      return renglon
    })
    encastrar(bloque, "PASOS", renglones)
    for (const b of [bloque, ...renglones]) fijar(b)
    return { bloque, pasos: pasos === null ? [] : renglones }
  }

  /** Dibuja el par de UNA regla; devuelve sus dos bloques. */
  function construir(campos) {
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
    return { mientras: contenedorBloque, hacer: accion }
  }

  /** Los renglones de «al iniciar» del modelo: la lista de textos, o `null` si no se sabe. */
  const pasosDe = (modelo) => (Array.isArray(modelo.alIniciar?.pasos) ? modelo.alIniciar.pasos : null)

  const firmaDeCampos = (campos) => campos.map((c) => [c.slot, c.prefijo, c.tipo ?? "opciones", c.grupo ?? null, c.tipo === "numero" ? [] : opcionesDeCampo(c, textos)])

  function pintar(modelo, { deshabilitado = false } = {}) {
    if (destruido) return
    Blockly.Events.disable()
    try {
      const reglas = reglasDe(modelo)
      if (reglas.length === 0) {
        workspace.clear()
        pares = []
        estructura = { alIniciar: null, porSiempre: null, pasos: [] }
        marcados = []
        firmaActual = null
        return
      }
      const pasos = pasosDe(modelo)
      // La firma es la FORMA de cada par, en orden (no el id de la regla: una regla que recién
      // nace pasa de `null` a su id sin que cambie un solo bloque). Si cambia cuántas hay o la
      // forma de alguna, se redibuja todo; si no, cada par toma los valores de la regla de su lugar.
      // Los renglones de «al iniciar» también son forma: si cambian (o pasan de «no se sabe» a
      // sabidos), se redibuja.
      const firma = JSON.stringify([pasos, reglas.map((r) => firmaDeCampos(r.campos))])
      if (firma !== firmaActual) {
        firmaActual = null
        pares = []
        estructura = { alIniciar: null, porSiempre: null, pasos: [] }
        marcados = []
        workspace.clear()
        const alIniciar = construirAlIniciar(pasos)
        const porSiempre = workspace.newBlock(TIPO_POR_SIEMPRE)
        const nuevos = reglas.map((regla) => ({ regla, ...construir(regla.campos) }))
        encastrar(porSiempre, "REGLAS", nuevos.map((par) => par.mientras))
        // De afuera hacia adentro no: un bloque se dibuja bien cuando sus encastrados ya existen.
        for (const par of nuevos) for (const bloque of [par.mientras, par.hacer]) fijar(bloque)
        fijar(porSiempre)
        if (typeof alIniciar.bloque.moveBy === "function") alIniciar.bloque.moveBy(MARGEN, MARGEN)
        const medida = typeof alIniciar.bloque.getHeightWidth === "function" ? alIniciar.bloque.getHeightWidth() : null
        const alto = medida && Number.isFinite(medida.height) && medida.height > 0 ? medida.height : ALTO_ESTIMADO_DE_AL_INICIAR
        if (typeof porSiempre.moveBy === "function") porSiempre.moveBy(MARGEN, MARGEN + alto + SEPARACION)
        pares = nuevos
        estructura = { alIniciar: alIniciar.bloque, porSiempre, pasos: alIniciar.pasos }
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
      // Al final, con los valores ya puestos en los campos: un campo con otro texto cambia el
      // tamaño de su bloque.
      ajustarAltoAlTerminarDeDibujar()
      medir()
    } finally {
      Blockly.Events.enable()
    }
  }

  /**
   * Marca los bloques de una clave (los de una regla son dos) y desmarca los que estaban; con
   * `null` no queda ninguno. Es el camino del código hacia los bloques. No selecciona ni mueve el
   * foco: en la página, llevarse el foco al lienzo sube la ventana y saca de la vista el código
   * que el alumno estaba mirando. Devuelve si quedó algo marcado.
   */
  function marcar(clave) {
    if (destruido) return false
    for (const bloque of marcados) if (typeof bloque.setHighlighted === "function") bloque.setHighlighted(false)
    marcados = bloquesDeLaClave(clave)
    for (const bloque of marcados) if (typeof bloque.setHighlighted === "function") bloque.setHighlighted(true)
    return marcados.length > 0
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

  return { pintar, quitar, marcar, destruir }
}
