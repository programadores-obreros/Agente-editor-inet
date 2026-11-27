// Blockly FALSO compartido por los tests de la vista lógica (T3..T9). Mismos nombres de método que
// la API real 13.3.0; mismo comportamiento relevante: con los eventos deshabilitados no se dispara nada.
//
// 2026-11-26 — bloques de estructura («al iniciar», «por siempre»). Lo que se agregó acá se midió
// antes contra el Blockly real, en Chromium, con bloques anidados que no se mueven ni se borran:
//   - tocar un bloque dispara un evento `selected` con `newElementId` e `isUiEvent: true`; tocar el
//     fondo, el mismo evento con `newElementId` vacío (`ws.tocar(id | null)` hace eso);
//   - un bloque se encastra en una entrada con `getInput(n).connection.connect(previousConnection)`
//     y debajo de otro con `nextConnection.connect(previousConnection)`;
//   - `getTopBlocks()` son los que no están encastrados en nada (antes este falso devolvía los
//     «mientras»: con los pares adentro de «por siempre» eso dejó de ser cierto; para los pares
//     están `reg.mientras()` y `reg.deRegla()`);
//   - `setHighlighted(bool)` marca un bloque sin seleccionarlo ni mover el foco;
//   - `getBlocksBoundingBox()` da `{ top, bottom, left, right }`. Acá existe sólo si el test pone
//     `reg.cajaDeBloques`, igual que `getHeightWidth` con `reg.altoDeBloque`.

export function fabricarBlockly() {
  const reg = { svgResizes: [], inyecciones: [], definiciones: [], bloquesCreados: 0, disposes: 0, nivelEventos: 0, ws: null, fallarNewBlock: false, altoDeBloque: null, cajaDeBloques: null, usosDeDescartados: 0 }
  const TIPOS_DE_REGLA = ["tecnia_mientras", "tecnia_hacer"]
  /** Los bloques de las reglas, en el orden en que se crearon (sin los de la estructura). */
  reg.deRegla = () => (reg.ws ? reg.ws.bloques.filter((b) => TIPOS_DE_REGLA.includes(b.type)) : [])
  reg.mientras = () => reg.deRegla().filter((b) => b.type === "tecnia_mientras")
  reg.deTipo = (tipo) => (reg.ws ? reg.ws.bloques.filter((b) => b.type === tipo) : [])
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
  // Numeric Conditions S1: campo de texto libre (mismo nombre que la API real); acepta cualquier texto.
  class FieldTextInput {
    constructor(texto) { this.valor = texto; this.habilitado = true }
    getValue() { return this.valor }
    setValue(v) {
      const antes = this.valor
      this.valor = v
      if (antes !== v && this.bloque) this.bloque.workspace.disparar({ type: "change", element: "field", name: this.nombre, newValue: v, oldValue: antes, blockId: this.bloque.id, isUiEvent: false })
    }
    setEnabled(h) { this.habilitado = h }
  }
  const Blockly = {
    Blocks: {},
    FieldDropdown,
    FieldLabel,
    FieldTextInput,
    Events: {
      BLOCK_CHANGE: "change",
      SELECTED: "selected",
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
          const b = { id: `b${reg.bloquesCreados}`, type: tipo, workspace: ws, campos: {}, etiquetas: [], deletable: true, movable: true, hijo: null, svg: false, renderizado: false, encastrados: {}, siguiente: null, dentroDe: null, resaltado: false }
          // Encastrar: el primero de una entrada queda en `encastrados[nombre]`; los que siguen, en `siguiente`.
          const entrada = (nombre) => ({ nombre, connection: { connect: (otra) => { b.encastrados[nombre] = otra.bloque; otra.bloque.dentroDe = b; if (nombre === "ACCION") b.hijo = otra.bloque; return true } }, appendField(campo, nombreCampo) {
            if (campo instanceof FieldLabel) b.etiquetas.push(campo.texto)
            else { campo.nombre = nombreCampo; campo.bloque = b; b.campos[nombreCampo] = campo }
            return this
          } })
          const entradas = {}
          b.getInput = (n) => (entradas[n] ??= entrada(n))
          b.previousConnection = { bloque: b }
          b.nextConnection = { connect: (otra) => { b.siguiente = otra.bloque; otra.bloque.dentroDe = b; return true } }
          // Un bloque que `clear()` ya sacó del lienzo no se debería volver a tocar: acá no rompe
          // (no se midió qué hace el Blockly real), pero queda contado en `reg.usosDeDescartados`.
          b.setHighlighted = (v) => { if (b.descartado) reg.usosDeDescartados++; b.resaltado = v }
          /** Los bloques encastrados en una entrada, de arriba abajo. */
          b.pila = (nombre) => { const fila = []; for (let x = b.encastrados[nombre] ?? null; x; x = x.siguiente) fila.push(x); return fila }
          b.getField = (n) => b.campos[n] ?? null
          b.getFieldValue = (n) => (b.campos[n] ? b.campos[n].getValue() : null)
          b.setFieldValue = (v, n) => b.campos[n].setValue(v)
          b.setDeletable = (v) => { b.deletable = v }
          b.setMovable = (v) => { b.movable = v }
          // Varias reglas (2026-11-24): se anota dónde se ubicó cada bloque, y con `reg.altoDeBloque`
          // el bloque informa su alto como la API real (`getHeightWidth`); sin eso no existe el método.
          b.movimientos = []
          b.moveBy = (x, y) => { b.movimientos.push([x, y]) }
          if (reg.altoDeBloque !== null) b.getHeightWidth = () => ({ height: reg.altoDeBloque, width: 300 })
          b.initSvg = () => { b.svg = true }
          b.render = () => { b.renderizado = true }
          bloques.push(b)
          return b
        },
        getTopBlocks() { return bloques.filter((b) => b.dentroDe === null) },
        /** Lo que hace el alumno al tocar un bloque (o el fondo, con `null`). */
        tocar(id) { ws.disparar({ type: "selected", newElementId: id ?? undefined, oldElementId: undefined, isUiEvent: true }) },
        getAllBlocks() { return [...bloques] },
        getBlockById(id) { return bloques.find((b) => b.id === id) ?? null },
        clear() { for (const b of bloques) b.descartado = true; bloques.length = 0 },
        addChangeListener(f) { oyentes.push(f); return f },
        removeChangeListener(f) { const i = oyentes.indexOf(f); if (i >= 0) oyentes.splice(i, 1) },
        disparar(e) { if (!Blockly.Events.isEnabled()) return; for (const f of [...oyentes]) f(e) },
        resize() {},
        dispose() { reg.disposes++; bloques.length = 0 },
      }
      if (reg.cajaDeBloques !== null) ws.getBlocksBoundingBox = () => reg.cajaDeBloques
      reg.ws = ws
      return ws
    },
  }
  return { Blockly, reg }
}

