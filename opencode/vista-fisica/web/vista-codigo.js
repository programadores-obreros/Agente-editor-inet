// Sección «Código» de la vista (2026-11-24).
//
// Muestra el programa que el SERVIDOR generó desde el proyecto. Acá no se genera, no se arma ni se
// recorta nada: el texto llega como dato y se pone tal cual con `textContent`. El asistente no
// interviene: es la misma idea que el montaje, que tampoco lo dibuja él.
//
// LA REGLA QUE IMPORTA: nunca queda a la vista un programa de OTRA revisión. La página tiene dos
// pedidos (el proyecto y el programa), así que son dos estados que pueden desfasarse. Por eso:
//   - apenas cambia la revisión del proyecto, el código que estaba se BORRA antes de pedir el nuevo;
//   - una respuesta sólo se pinta si su revisión es la del proyecto que se está mostrando AHORA;
//   - una respuesta que llega tarde (de un pedido viejo) se descarta.
//
// Todo lo que toca el mundo (fetch y los elementos) se inyecta: se prueba en Node, sin navegador.

export const TEXTO_ACTUALIZANDO = "Actualizando el programa…"
export const TEXTO_SIN_SECCION = "Esta instalación de Tecnia Bot no trae la parte que genera el programa, así que acá no se puede mostrar. El montaje y las reglas siguen funcionando."
export const TEXTO_NO_SE_PUDO_PEDIR = "No se pudo pedir el programa a Tecnia Bot. Si la vista quedó desconectada, volvé a abrirla desde Tecnia Bot."
export const TEXTO_DESCONECTADA = "La vista está desconectada: este programa puede no ser el actual."

const plural = (n) => (n === 1 ? "1 línea" : `${n} líneas`)

/** Pie del programa mostrado: de qué revisión es y cuánto mide. */
export function pieDelPrograma({ revision, archivo, lineas }) {
  // Lo que se afirma es lo que el código garantiza: es el texto que el generador da para esta
  // revisión (el mismo que compila la tool `programa`). NO se afirma que se cargó ni que se puede
  // cargar: la carga tiene sus propios frenos, y esto no sabe qué hay hoy en la placa.
  return `Programa de la revisión ${revision} · ${archivo} · ${plural(lineas)}. Lo genera Tecnia Bot desde este proyecto, no lo escribe el asistente: es el texto que se compila para esta revisión. No dice qué programa tiene hoy la placa.`
}

/**
 * @param {{ fetch: Function, elementoCodigo: { textContent: string, hidden: boolean },
 *   elementoAviso: { textContent: string } }} dependencias
 */
export function crearPanelCodigo({ fetch, elementoCodigo, elementoAviso }) {
  /** La revisión del proyecto que la página está mostrando. */
  let revisionPedida = null
  /** La revisión del programa que está a la vista, o null si no hay código en pantalla. */
  let revisionMostrada = null
  /** Lo último que se dijo debajo del código (sin el agregado de "desconectada"). */
  let aviso = ""
  let conectada = true
  let turno = 0
  /** El último pedido no terminó en un programa ni en un "no hay programa" firme: el próximo repintado reintenta. */
  let reintentar = false

  const escribirAviso = () => {
    elementoAviso.textContent = !conectada && revisionMostrada !== null ? `${TEXTO_DESCONECTADA}\n${aviso}` : aviso
  }
  const sinCodigo = (texto) => {
    revisionMostrada = null
    elementoCodigo.textContent = ""
    elementoCodigo.hidden = true
    aviso = texto
    escribirAviso()
  }

  async function pedir(revision, miTurno) {
    let cuerpo
    let estado
    try {
      const respuesta = await fetch("/api/programa")
      estado = respuesta.status
      if (estado === 404) cuerpo = null
      else cuerpo = await respuesta.json()
    } catch {
      if (miTurno === turno) {
        reintentar = true
        sinCodigo(TEXTO_NO_SE_PUDO_PEDIR)
      }
      return
    }
    // Llegó tarde: ya se pidió otra cosa después.
    if (miTurno !== turno) return
    if (cuerpo === null) return sinCodigo(TEXTO_SIN_SECCION)
    const programa = cuerpo?.programa
    // No es el programa de lo que se está mostrando: no se pinta. Si el proyecto avanzó, el
    // próximo snapshot vuelve a pedir; mientras tanto queda dicho que se está actualizando.
    if (cuerpo?.revision !== revision) {
      reintentar = true
      return sinCodigo(TEXTO_ACTUALIZANDO)
    }
    if (!programa || programa.ok !== true || typeof programa.codigo !== "string") {
      // Una falla de Tecnia Bot (no un "no hay programa" del proyecto) se vuelve a intentar.
      if (estado !== 200) reintentar = true
      return sinCodigo(typeof programa?.porQue === "string" && programa.porQue !== "" ? programa.porQue : TEXTO_NO_SE_PUDO_PEDIR)
    }
    elementoCodigo.textContent = programa.codigo
    elementoCodigo.hidden = false
    revisionMostrada = revision
    aviso = pieDelPrograma({ revision, archivo: programa.archivo, lineas: programa.lineas })
    escribirAviso()
  }

  return {
    /** Se llama en cada repintado, con el snapshot autoritativo. Sólo pide si cambió la revisión. */
    actualizar(snapshot, { conectado = true } = {}) {
      conectada = conectado
      const revision = snapshot?.revision
      if (typeof revision !== "number") return Promise.resolve()
      if (revision === revisionPedida && !reintentar) {
        escribirAviso()
        return Promise.resolve()
      }
      revisionPedida = revision
      reintentar = false
      // Primero se borra lo que había: un programa de la revisión anterior no puede quedar a la vista.
      sinCodigo(TEXTO_ACTUALIZANDO)
      turno += 1
      return pedir(revision, turno)
    },
  }
}
