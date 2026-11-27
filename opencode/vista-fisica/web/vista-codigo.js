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

// Los dos textos que hablan del corte usan las palabras del indicador («Ventana sin conexión»,
// `estado-conexion.js`), no «la vista desconectada»: aprobados por el dueño el 2026-11-26.
export const TEXTO_ACTUALIZANDO = "Actualizando el programa…"
export const TEXTO_SIN_SECCION = "Esta instalación de Tecnia Bot no trae la parte que genera el programa, así que acá no se puede mostrar. El montaje y las reglas siguen funcionando."
export const TEXTO_NO_SE_PUDO_PEDIR = "No se pudo pedir el programa a Tecnia Bot. Si la ventana quedó sin conexión, volvé a abrirla desde Tecnia Bot."
export const TEXTO_DESCONECTADA = "La ventana está sin conexión: este programa puede no ser el actual."

const plural = (n) => (n === 1 ? "1 línea" : `${n} líneas`)

/** Pie del programa mostrado: de qué revisión es y cuánto mide. */
export function pieDelPrograma({ revision, archivo, lineas }) {
  // Lo que se afirma es lo que el código garantiza: es el texto que el generador da para esta
  // revisión (el mismo que compila la tool `programa`). NO se afirma que se cargó ni que se puede
  // cargar: la carga tiene sus propios frenos, y esto no sabe qué hay hoy en la placa.
  return `Programa de la revisión ${revision} · ${archivo} · ${plural(lineas)}. Lo genera Tecnia Bot desde este proyecto, no lo escribe el asistente: es el texto que se compila para esta revisión. No dice qué programa tiene hoy la placa.`
}

/**
 * Qué se sabe del programa de una revisión (2026-11-26), para el renglón de «Cómo está». Son tres:
 *   - `generado`: llegó el programa de ESA revisión y está a la vista;
 *   - `sinPrograma`: el servidor contestó bien (200) y dijo, para ESA revisión, que no hay programa;
 *   - `desconocido`: todo lo demás (actualizando, otra revisión, falla, 404, respuesta rara).
 * Ante la duda es `desconocido`: el renglón no afirma ni que hay ni que no hay.
 */
export const PROGRAMA_GENERADO = "generado"
export const PROGRAMA_NO_HAY = "sinPrograma"
export const PROGRAMA_DESCONOCIDO = "desconocido"

/** Lo que dice una respuesta de `/api/programa` sobre la revisión pedida. Pura. `cuerpo === null` es el 404. */
export function claveDelPrograma({ estado, cuerpo, revision }) {
  if (cuerpo === null || cuerpo === undefined || cuerpo.revision !== revision) return PROGRAMA_DESCONOCIDO
  const programa = cuerpo.programa
  if (programa && programa.ok === true && typeof programa.codigo === "string") return PROGRAMA_GENERADO
  if (estado === 200 && programa && programa.ok === false) return PROGRAMA_NO_HAY
  return PROGRAMA_DESCONOCIDO
}

/**
 * El renglón del programa en «Cómo está». Pura. `textos` es `vista.resumen.programa` (las frases
 * las manda el servidor; acá no se redacta nada). Devuelve `{ texto, llevaAlPrograma }`, o `null`
 * cuando no se sabe: sin textos, sin conexión, con lo sabido de OTRA revisión que la que se está
 * mostrando, o con la clave en `desconocido`. Misma regla dura que el panel: nada de otra revisión.
 */
export function renglonDelPrograma({ textos, estadoPrograma, revision, conectado }) {
  if (!textos || !conectado || typeof revision !== "number" || !estadoPrograma || estadoPrograma.revision !== revision) return null
  if (estadoPrograma.clave === PROGRAMA_GENERADO && typeof textos.generado === "string") return { texto: textos.generado, llevaAlPrograma: false }
  if (estadoPrograma.clave === PROGRAMA_NO_HAY && typeof textos.sinPrograma === "string") return { texto: textos.sinPrograma, llevaAlPrograma: true }
  return null
}

/**
 * La estructura que vino con el programa (2026-11-26), si se puede usar ENTERA contra ese
 * programa; si no, `null`. Pura. La usan los bloques («al iniciar») y el marcado de líneas, y los
 * dos confían en los números: un tramo que se sale del programa, o al revés, marcaría líneas que
 * no son. Ante cualquier cosa rara no hay estructura (el programa se muestra igual).
 */
export function estructuraUsable(estructura, lineas) {
  if (estructura === null || typeof estructura !== "object" || !Number.isInteger(lineas) || lineas < 1) return null
  const tramo = (r) => r !== null && typeof r === "object" && Number.isInteger(r.desde) && Number.isInteger(r.hasta) && r.desde >= 1 && r.hasta >= r.desde && r.hasta <= lineas
  const { alIniciar, porSiempre, reglas } = estructura
  if (!alIniciar || !tramo(alIniciar.lineas) || !Array.isArray(alIniciar.pasos)) return null
  if (!porSiempre || !tramo(porSiempre.lineas) || !Array.isArray(reglas)) return null
  if (!alIniciar.pasos.every((p) => p !== null && typeof p === "object" && typeof p.texto === "string" && p.texto !== "" && tramo(p.lineas))) return null
  if (!reglas.every((r) => r !== null && typeof r === "object" && typeof r.id === "string" && r.id !== "" && tramo(r.lineas))) return null
  return estructura
}

/**
 * @param {{ fetch: Function, elementoCodigo: { textContent: string, hidden: boolean },
 *   elementoAviso: { textContent: string }, alCambiarElPrograma?: Function }} dependencias
 * `alCambiarElPrograma({ clave, revision })` se llama cada vez que cambia lo que se sabe del
 * programa (incluido el paso a `desconocido` apenas cambia la revisión). Si tira, se ataja.
 */
export function crearPanelCodigo({ fetch, elementoCodigo, elementoAviso, alCambiarElPrograma }) {
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
  /** Lo que se sabe del programa, y de qué revisión (ver `claveDelPrograma`). */
  let estadoPrograma = { clave: PROGRAMA_DESCONOCIDO, revision: null }
  /** La estructura del programa que está a la vista, o `null`. Se va con el código: nunca queda una sin su programa. */
  let estructuraMostrada = null
  const avisarPrograma = (clave, revision) => {
    estadoPrograma = { clave, revision }
    try {
      alCambiarElPrograma?.(estadoPrograma)
    } catch {
      /* el renglón de «Cómo está» falló: el panel sigue igual */
    }
  }

  const escribirAviso = () => {
    elementoAviso.textContent = !conectada && revisionMostrada !== null ? `${TEXTO_DESCONECTADA}\n${aviso}` : aviso
  }
  const sinCodigo = (texto, clave = PROGRAMA_DESCONOCIDO) => {
    revisionMostrada = null
    estructuraMostrada = null
    elementoCodigo.textContent = ""
    elementoCodigo.hidden = true
    aviso = texto
    escribirAviso()
    avisarPrograma(clave, revisionPedida)
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
      return sinCodigo(typeof programa?.porQue === "string" && programa.porQue !== "" ? programa.porQue : TEXTO_NO_SE_PUDO_PEDIR, claveDelPrograma({ estado, cuerpo, revision }))
    }
    elementoCodigo.textContent = programa.codigo
    elementoCodigo.hidden = false
    revisionMostrada = revision
    // Antes de avisar que cambió el programa: quien escucha el aviso ya pregunta por la estructura.
    estructuraMostrada = estructuraUsable(programa.estructura ?? null, programa.lineas)
    aviso = pieDelPrograma({ revision, archivo: programa.archivo, lineas: programa.lineas })
    escribirAviso()
    avisarPrograma(claveDelPrograma({ estado, cuerpo, revision }), revision)
  }

  return {
    /** Lo que se sabe del programa ahora (copia: nadie de afuera lo cambia). */
    estadoDelPrograma: () => ({ ...estadoPrograma }),
    /**
     * La estructura del programa que está a la vista y de qué revisión es, o `null` si no hay
     * programa a la vista o vino sin estructura. Para un mismo programa devuelve siempre EL MISMO
     * objeto `estructura`: quien la usa se da cuenta de que cambió comparándola con la anterior.
     */
    estructuraDelPrograma: () => (revisionMostrada !== null && estructuraMostrada ? { revision: revisionMostrada, estructura: estructuraMostrada } : null),
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
