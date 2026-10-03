// Vista lógica — cableado (Phase 3, vertical #2, T4/T5). Une el modelo puro (`vista-logica.js`), el
// adaptador de Blockly y EL MISMO controlador de reglas que usa la frase (`crearControladorReglas`
// en app.js): un cambio de campo es `controlador.cambiar` (una SetComportamiento armada con
// `construirOperacionRegla`), "quitar" es `controlador.quitar`. Sin DOM propio ni red: la API de
// Blockly y el contenedor se inyectan, así que se prueba en Node.

import { crearAdaptadorBlockly } from "./adaptador-blockly.js"
import { proyectarModeloLogico } from "./vista-logica.js"

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
