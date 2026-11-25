// Vista lógica — cableado (Phase 3, vertical #2, T4/T5). Une el modelo puro (`vista-logica.js`), el
// adaptador de Blockly y EL MISMO controlador de reglas que usa la frase (`crearControladorReglas`
// en app.js): un cambio de campo es `controlador.cambiar` (una SetComportamiento armada con
// `construirOperacionRegla`), "quitar" es `controlador.quitar`. Sin DOM propio ni red: la API de
// Blockly y el contenedor se inyectan, así que se prueba en Node.

import { crearAdaptadorBlockly } from "./adaptador-blockly.js"
import { proyectarModeloLogico } from "./vista-logica.js"
import { TEXTO_SIN_ENVIAR } from "./plan-de-pintado.js"

export const MENSAJE_NO_SE_PUDO_GUARDAR = "No se pudo guardar el cambio. Volvé a intentar."

/** Numeric Conditions S2: el borrador vive en el controlador de reglas (el mismo de la frase). */
const borradorDe = (controlador) => (typeof controlador?.borrador === "function" ? controlador.borrador() : null)

/**
 * @param {{ Blockly: object, contenedor: Element, controlador: { cambiar: Function, quitar: Function },
 *   media?: string, mensajes?: object, alError?: (error: unknown) => void }} config
 */
export function crearVistaLogica({ Blockly, contenedor, controlador, media, mensajes, alError = () => {} }) {
  // Gana el snapshot: si el controlador ignoró el cambio (false) o el envío falló, se repinta lo último autoritativo.
  let ultimo = null
  const reponer = () => {
    if (ultimo) adaptador.pintar(proyectarModeloLogico(ultimo.snapshot?.vista ?? {}, borradorDe(controlador)), { deshabilitado: ultimo.deshabilitado })
  }
  const enviar = (promesa) =>
    Promise.resolve(promesa).then(
      (resultado) => {
        if (resultado === false) reponer()
      },
      (error) => {
        reponer()
        alError(error)
      },
    )
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
      ultimo = { snapshot, deshabilitado }
      const modelo = proyectarModeloLogico(snapshot?.vista ?? {}, borradorDe(controlador))
      adaptador.pintar(modelo, { deshabilitado })
      return modelo
    },
    quitar: () => adaptador.quitar(),
    destruir: () => adaptador.destruir(),
  }
}

export const TEXTO_QUITAR_CON_VARIAS = "Hay más de una regla: para quitar una, usá su botón «Quitar regla» en la sección Reglas."

const MENSAJE_SIN_BLOCKLY = "La vista lógica no está disponible en esta página. La frase editable de arriba sigue funcionando."

/**
 * Panel de la página (T9): el contenedor de Blockly se inyecta UNA vez, de forma perezosa, en el primer
 * repintado; los textos (motivos y avisos de cada regla) y el botón "Quitar regla" salen del modelo,
 * siempre desde el snapshot autoritativo. Sin Blockly (asset ausente) muestra un mensaje llano y no
 * toca nada más. Los elementos son opacos: sólo `textContent`, `disabled` y `addEventListener`.
 */
export function crearPanelVistaLogica({ Blockly, lienzo, elementoTexto, elementoEstado, botonQuitar, controlador, media }) {
  let vista = null
  const mostrarEstado = (texto) => {
    elementoEstado.textContent = texto ?? ""
  }
  botonQuitar.addEventListener("click", () => vista?.quitar())

  return {
    repintar(snapshot, { deshabilitado = false } = {}) {
      if (!Blockly) {
        elementoTexto.textContent = MENSAJE_SIN_BLOCKLY
        botonQuitar.disabled = true
        return null
      }
      vista ??= crearVistaLogica({ Blockly, contenedor: lienzo, controlador, alError: () => mostrarEstado(MENSAJE_NO_SE_PUDO_GUARDAR), ...(media === undefined ? {} : { media }) })
      const modelo = vista.repintar(snapshot, { deshabilitado })
      // Los textos de CADA regla. Con varias, cada renglón dice de cuál es (por su lugar en el
      // lienzo, de arriba abajo): un motivo suelto no se sabría a qué bloque atribuir.
      const lineas = []
      modelo.reglas.forEach((regla, i) => {
        const propias = [...(regla.sinEnviar ? [TEXTO_SIN_ENVIAR] : []), ...regla.motivos, ...(regla.aviso ? [regla.aviso] : []), ...(regla.ayuda ? [regla.ayuda] : [])]
        for (const linea of propias) lineas.push(modelo.hayVarias ? `Regla ${i + 1}: ${linea}` : linea)
      })
      if (modelo.hayVarias) lineas.push(TEXTO_QUITAR_CON_VARIAS)
      elementoTexto.textContent = lineas.join("\n")
      // El botón quita LA regla del lienzo: con varias no hay una sola, así que no se ofrece.
      botonQuitar.disabled = deshabilitado || modelo.reglas.length !== 1 || modelo.reglas[0].id === null
      return modelo
    },
    mostrarEstado,
    destruir() {
      vista?.destruir()
      vista = null
    },
  }
}
