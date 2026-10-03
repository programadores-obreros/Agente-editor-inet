// Vista lógica — cableado (Phase 3, vertical #2, T4/T5). Une el modelo puro (`vista-logica.js`), el
// adaptador de Blockly y EL MISMO controlador de reglas que usa la frase (`crearControladorReglas`
// en app.js): un cambio de campo es `controlador.cambiar` (una SetComportamiento armada con
// `construirOperacionRegla`), "quitar" es `controlador.quitar`. Sin DOM propio ni red: la API de
// Blockly y el contenedor se inyectan, así que se prueba en Node.

import { crearAdaptadorBlockly } from "./adaptador-blockly.js"
import { proyectarModeloLogico } from "./vista-logica.js"
import { AVISO_VARIAS_REGLAS } from "./plan-de-pintado.js"

/**
 * @param {{ Blockly: object, contenedor: Element, controlador: { cambiar: Function, quitar: Function },
 *   media?: string, mensajes?: object, alError?: (error: unknown) => void }} config
 */
export function crearVistaLogica({ Blockly, contenedor, controlador, media, mensajes, alError = () => {} }) {
  const enviar = (promesa) => Promise.resolve(promesa).catch(alError)
  const adaptador = crearAdaptadorBlockly({
    Blockly,
    contenedor,
    ...(media === undefined ? {} : { media }),
    ...(mensajes === undefined ? {} : { mensajes }),
    alEditar: (evento) => void enviar(controlador.cambiar(evento)),
    alQuitar: (evento) => void enviar(controlador.quitar(evento)),
  })
  return {
    /** Pinta SIEMPRE desde el snapshot autoritativo; devuelve el modelo (para textos junto al bloque). */
    repintar(snapshot, { deshabilitado = false } = {}) {
      const modelo = proyectarModeloLogico(snapshot?.vista ?? {})
      adaptador.pintar(modelo, { deshabilitado })
      return modelo
    },
    quitar: () => adaptador.quitar(),
    destruir: () => adaptador.destruir(),
  }
}

const MENSAJE_SIN_BLOCKLY = "La vista lógica no está disponible en esta página. La frase editable de arriba sigue funcionando."

/**
 * Panel de la página (T9): el contenedor de Blockly se inyecta UNA vez, de forma perezosa, en el primer
 * repintado; los textos (motivos, aviso, "varias reglas") y el botón "Quitar regla" salen del modelo,
 * siempre desde el snapshot autoritativo. Sin Blockly (asset ausente) muestra un mensaje llano y no
 * toca nada más. Los elementos son opacos: sólo `textContent`, `disabled` y `addEventListener`.
 */
export function crearPanelVistaLogica({ Blockly, lienzo, elementoTexto, elementoEstado, botonQuitar, controlador, media }) {
  let vista = null
  botonQuitar.addEventListener("click", () => vista?.quitar())

  return {
    repintar(snapshot, { deshabilitado = false } = {}) {
      if (!Blockly) {
        elementoTexto.textContent = MENSAJE_SIN_BLOCKLY
        botonQuitar.disabled = true
        return null
      }
      vista ??= crearVistaLogica({ Blockly, contenedor: lienzo, controlador, ...(media === undefined ? {} : { media }) })
      const modelo = vista.repintar(snapshot, { deshabilitado })
      const lineas = modelo.regla ? [...modelo.regla.motivos, ...(modelo.regla.aviso ? [modelo.regla.aviso] : [])] : []
      if (modelo.hayVarias) lineas.push(`Se muestra la primera regla. ${AVISO_VARIAS_REGLAS}`)
      elementoTexto.textContent = lineas.join("\n")
      botonQuitar.disabled = deshabilitado || !modelo.regla || modelo.regla.id === null
      return modelo
    },
    mostrarEstado(texto) {
      elementoEstado.textContent = texto ?? ""
    },
    destruir() {
      vista?.destruir()
      vista = null
    },
  }
}
