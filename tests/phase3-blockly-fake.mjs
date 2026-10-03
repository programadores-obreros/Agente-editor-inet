// Blockly FALSO compartido por los tests de la vista lógica (T3..T9). Mismos nombres de método que
// la API real 13.3.0; mismo comportamiento relevante: con los eventos deshabilitados no se dispara nada.

export function fabricarBlockly() {
  const reg = { svgResizes: [], inyecciones: [], definiciones: [], bloquesCreados: 0, disposes: 0, nivelEventos: 0, ws: null, fallarNewBlock: false }
  class FieldDropdown {
    constructor(opciones) { this.opciones = opciones; this.valor = opciones[0][1]; this.habilitado = true }
    getValue() { return this.valor }
    setValue(v) {
      if (!this.opciones.some((o) => o[1] === v)) return
      const antes = this.valor
      this.valor = v
      if (antes !== v && this.bloque) this.bloque.workspace.disparar({ type: "change", element: "field", name: this.nombre, newValue: v, oldValue: antes, blockId: this.bloque.id, isUiEvent: false })
    }
    setEnabled(h) { this.habilitado = h }
  }
  class FieldLabel { constructor(texto) { this.texto = texto } }
  const Blockly = {
    Blocks: {},
    FieldDropdown,
    FieldLabel,
    Events: {
      BLOCK_CHANGE: "change",
      disable() { reg.nivelEventos++ },
      enable() { reg.nivelEventos-- },
      isEnabled() { return reg.nivelEventos === 0 },
    },
    svgResize(ws) { reg.svgResizes.push(ws) },
    defineBlocksWithJsonArray(arr) { for (const d of arr) { reg.definiciones.push(d); Blockly.Blocks[d.type] = d } },
    inject(contenedor, opciones) {
      reg.inyecciones.push({ contenedor, opciones })
      const oyentes = []
      const bloques = []
      const ws = {
        id: "ws-1",
        bloques,
        oyentes,
        newBlock(tipo) {
          if (reg.fallarNewBlock) throw new Error("falla simulada")
          reg.bloquesCreados++
          const b = { id: `b${reg.bloquesCreados}`, type: tipo, workspace: ws, campos: {}, etiquetas: [], deletable: true, movable: true, hijo: null, svg: false, renderizado: false }
          const entrada = (nombre) => ({ nombre, connection: { conectar: (otra) => { b.hijo = otra.bloque; return true } }, appendField(campo, nombreCampo) {
            if (campo instanceof FieldLabel) b.etiquetas.push(campo.texto)
            else { campo.nombre = nombreCampo; campo.bloque = b; b.campos[nombreCampo] = campo }
            return this
          } })
          const entradas = {}
          b.getInput = (n) => (entradas[n] ??= entrada(n))
          b.previousConnection = { bloque: b }
          b.getInput("ACCION").connection.connect = (otra) => { b.hijo = otra.bloque; return true }
          b.getField = (n) => b.campos[n] ?? null
          b.getFieldValue = (n) => (b.campos[n] ? b.campos[n].getValue() : null)
          b.setFieldValue = (v, n) => b.campos[n].setValue(v)
          b.setDeletable = (v) => { b.deletable = v }
          b.setMovable = (v) => { b.movable = v }
          b.moveBy = () => {}
          b.initSvg = () => { b.svg = true }
          b.render = () => { b.renderizado = true }
          bloques.push(b)
          return b
        },
        getTopBlocks() { return bloques.filter((b) => b.type === "tecnia_mientras") },
        getAllBlocks() { return [...bloques] },
        getBlockById(id) { return bloques.find((b) => b.id === id) ?? null },
        clear() { bloques.length = 0 },
        addChangeListener(f) { oyentes.push(f); return f },
        removeChangeListener(f) { const i = oyentes.indexOf(f); if (i >= 0) oyentes.splice(i, 1) },
        disparar(e) { if (!Blockly.Events.isEnabled()) return; for (const f of [...oyentes]) f(e) },
        resize() {},
        dispose() { reg.disposes++; bloques.length = 0 },
      }
      reg.ws = ws
      return ws
    },
  }
  return { Blockly, reg }
}

