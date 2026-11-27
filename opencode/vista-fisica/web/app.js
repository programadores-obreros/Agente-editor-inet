// app.js — Phase 2, Slice 1 (writer W3, tarea 3). Único módulo que habla con el
// transporte (`fetch`/`EventSource`) y decide qué hacer con la respuesta. Nunca pinta
// nada por su cuenta: siempre delega en `planDePintado` (puro) + `pintar` (tonto).
//
// Invariante central, repetido en el diseño y en el informe ARCH-B ("Comportamiento
// ante fallas"): la vista NUNCA se actualiza de forma optimista. Cada repintado sale
// de un snapshot que YA vino del servidor (el de `/api/proyecto`, o el que trae la
// propia respuesta de `POST /api/operaciones`) — jamás de lo que el usuario acaba de
// elegir en el selector. Si el POST tarda o falla, la vista se queda mostrando el
// último snapshot autoritativo recibido.

import { planDePintado, interpretarNumero, estadoDelGrupo, aplicarEleccionAlGrupo, revalidarGrupo, slotsDelGrupo } from "./plan-de-pintado.js"

// La interpretación del número vive con las funciones del grupo (plan-de-pintado.js); se re-exporta
// acá porque es parte de la API de este módulo desde S1.
export { interpretarNumero }
import { pintar, pintarRenglonDelPrograma } from "./pintar.js"
import { reducirEstadoConexion, ESTADO_INICIAL, textosDelIndicador, EXPLICACION_SIN_CONEXION } from "./estado-conexion.js"
import { crearClienteHttp, llaveDeLaSesion } from "./cliente-http.js"
import { crearPanelVistaLogica, MENSAJE_NO_SE_PUDO_GUARDAR } from "./vista-logica-ui.js"
import { TITULOS_DE_LA_ESTRUCTURA } from "./adaptador-blockly.js"
import { crearPanelCodigo, renglonDelPrograma } from "./vista-codigo.js"
import { crearCodigoPorLineas } from "./codigo-por-lineas.js"
import { crearVinculoBloquesCodigo } from "./vinculo-bloques-codigo.js"
import { nombresDelPrograma, pintarNombresDelPrograma } from "./clave-del-programa.js"
import { dibujarCableado } from "./cableado.js"
import { conectarNavegacion } from "./navegacion.js"
import { conectarTema } from "./tema.js"
import { conectarImpresion } from "./impresion.js"

// Fase 3, Wave 0 (F-11, PHASE_3_WAVE_0_DESIGN.md): `tests/wave0-view.test.mjs`
// importa `crearCoalescerCambiosGpio`/`elegirSelectorParaFoco` (PURAS, ver más abajo)
// SIN ejecutar el bootstrap real de este módulo (`document`/`EventSource`/`fetch`,
// inexistentes bajo `node --test`) — por eso todo lo que toca el DOM de verdad al
// cargar el módulo queda detrás de este chequeo de feature-detection. En el navegador
// real `document` SIEMPRE existe, así que el comportamiento ahí no cambia un bit; en
// Node (los tests), el módulo carga sin tocar nada, y sólo las funciones puras
// exportadas son invocables.
const enNavegador = typeof document !== "undefined"

// ════════════════════════════════════════════════════════════════════════════════════
// F-11 (PHASE_3_WAVE_0_DESIGN.md) — coalescing PURO de cambios de GPIO.
//
// Causa raíz (F-11, PHASE_2_SIMULATED_ROLE_TRIAL.md): antes, CADA evento `change` del
// `<select>` disparaba un POST propio, con `baseRevision` del snapshot vigente EN ESE
// INSTANTE. Tipear "D19" carácter por carácter mandaba un POST por "D", otro por "D1"
// y otro por "D19" — y como cada POST corre contra el servidor real, el segundo podía
// volver DESPUÉS que el tercero, pisando el valor final con uno viejo, o el servidor
// rechazaba el segundo como `BASE_REVISION_DESACTUALIZADA` ("otro cambio llegó
// primero") cuando en realidad el "otro cambio" era EL MISMO USUARIO, todavía
// escribiendo. `repintar()` además hacía `replaceChildren` de TODO el DOM en cada
// vuelta, así que el `<select>` perdía el foco a mitad de tecleo.
//
// Esta función es PURA salvo por lo que el llamador INYECTA (`programar`/
// `cancelarProgramado` — equivalentes de `setTimeout`/`clearTimeout`, para poder
// testear con un reloj FALSO, nunca un timer real; `enviar` — el POST real, inyectado
// por este mismo archivo más abajo; `obtenerValorServidor` — lee `ultimoSnapshot`, SIN
// que este módulo tenga que conocerlo). El browser SIGUE sin ser autoridad: lo único
// que esta función decide es CUÁNDO mandar un pedido, nunca si se aplica — eso lo
// sigue decidiendo el Engine, como siempre.
//
// Reglas (F-11, una x selector, identificado por `componenteId`+`terminalId`):
//  - debounce de `debounceMs` (300 por defecto): cada cambio nuevo en el MISMO
//    selector cancela el timer anterior y programa uno nuevo — sólo el ÚLTIMO valor
//    elegido llega a decidirse.
//  - a lo sumo UN POST en vuelo, GLOBAL (no por selector: el servidor tiene una sola
//    `baseRevision` para el proyecto entero, dos POST simultáneos siempre van a pisar
//    la revisión del otro). Si el debounce de CUALQUIER selector termina mientras ya
//    hay un POST en curso, el pedido se ENCOLA — pero la cola es un Map POR SELECTOR
//    (FX-1, ronda de fixes, RED-AUTH-01: antes era UNA sola variable global, y un
//    TERCER selector que terminaba su debounce pisaba, sin aviso, lo que un SEGUNDO
//    selector ya había encolado — el pedido de ese segundo selector se perdía para
//    siempre). Un pedido nuevo del MISMO selector sigue reemplazando al anterior
//    ("sólo el ÚLTIMO valor elegido" vale, por selector), pero nunca pisa el de OTRO
//    selector que también esté esperando su turno.
//  - al volver el POST en vuelo, se despacha el PRÓXIMO selector de la cola (uno por
//    vez — nunca dos POST en paralelo, sigue valiendo "a lo sumo UN POST en vuelo,
//    GLOBAL"): se re-evalúa CONTRA EL VALOR DE SERVIDOR YA ACTUALIZADO (nunca el de
//    antes del POST) — salvo que sea el MISMO selector cuyo propio POST acaba de
//    volver (FX-1, RED-AUTH-02: un "arrepentimiento" mientras el POST de ESE selector
//    sigue en vuelo comparaba contra el snapshot VIEJO, pre-POST, y se perdía — ver
//    `decidirEnvio`, más abajo).
//  - si el valor final (al vencer el debounce, o al desencolar) ya coincide con el
//    valor vigente del servidor, no se manda NADA — salvo el caso de arriba (mismo
//    selector en vuelo), donde el snapshot "vigente" todavía no refleja ESE POST.
export function crearCoalescerCambiosGpio({ debounceMs = 300, programar = (fn, ms) => setTimeout(fn, ms), cancelarProgramado = (id) => clearTimeout(id), enviar, obtenerValorServidor } = {}) {
  const timerPorSelector = new Map() // "componenteId\u0000terminalId" -> id de timer vivo
  let enVuelo = false
  // FX-1 (RED-AUTH-01): Map POR CLAVE (mismo patrón que `timerPorSelector`) — cada
  // selector tiene su propio lugar en la cola, nunca pisa el de otro.
  const pedidosEncolados = new Map() // clave -> el pedido en espera de ESE selector
  // FX-1 (RED-AUTH-02): la clave del selector cuyo POST está en vuelo AHORA MISMO (o
  // `null`) — necesaria para decidir si "ya coincide con el servidor" es un chequeo
  // válido (ver `decidirEnvio`).
  let claveEnVuelo = null

  function clave(componenteId, terminalId) {
    return `${componenteId}\u0000${terminalId}`
  }

  function registrarCambio(componenteId, terminalId, valor) {
    const k = clave(componenteId, terminalId)
    const timerPrevio = timerPorSelector.get(k)
    if (timerPrevio !== undefined) cancelarProgramado(timerPrevio)
    const id = programar(() => {
      timerPorSelector.delete(k)
      decidirEnvio(componenteId, terminalId, valor)
    }, debounceMs)
    timerPorSelector.set(k, id)
  }

  function decidirEnvio(componenteId, terminalId, valor) {
    const k = clave(componenteId, terminalId)
    // FX-1 (RED-AUTH-02): si el POST en vuelo AHORA MISMO es el de ESTE MISMO
    // selector, `obtenerValorServidor()` todavía lee el snapshot ANTERIOR a ese POST
    // (stale para este selector en particular) — compararlo contra un
    // "arrepentimiento" (volver al valor viejo) lo confundiría con un no-op y lo
    // perdería para siempre. En ese caso especial, SIEMPRE se encola, nunca se
    // compara contra el snapshot viejo.
    const esElMismoSelectorEnVuelo = enVuelo && claveEnVuelo === k
    if (!esElMismoSelectorEnVuelo && valor === obtenerValorServidor(componenteId, terminalId)) return // ya coincide: nada que mandar
    const pedido = { componenteId, terminalId, valor }
    if (enVuelo) {
      pedidosEncolados.set(k, pedido) // reemplaza el pedido ANTERIOR del MISMO selector, nunca el de otro
      return
    }
    despachar(k, pedido)
  }

  function despachar(k, pedido) {
    enVuelo = true
    claveEnVuelo = k
    Promise.resolve(enviar(pedido)).then(alVolverElPost, alVolverElPost)
  }

  function alVolverElPost() {
    enVuelo = false
    claveEnVuelo = null
    despacharSiguienteDeLaCola()
  }

  // FX-1: procesa la cola selector por selector — re-evalúa cada uno contra el valor
  // de servidor YA actualizado por el POST que acaba de volver (nunca el de antes).
  // Si `decidirEnvio` despacha un POST real, el `while` corta solo (a lo sumo UN POST
  // en vuelo, GLOBAL: el resto de la cola espera a que ÉSE vuelva). Si fue un no-op
  // (ya coincidía), sigue con el PRÓXIMO selector encolado en la MISMA vuelta —
  // ningún selector encolado se pierde por quedar "detrás" de un no-op.
  function despacharSiguienteDeLaCola() {
    while (!enVuelo && pedidosEncolados.size > 0) {
      const [k, pedido] = pedidosEncolados.entries().next().value
      pedidosEncolados.delete(k)
      decidirEnvio(pedido.componenteId, pedido.terminalId, pedido.valor)
    }
  }

  return { registrarCambio }
}

/**
 * F-11 — foco: función PURA que elige, de la lista de selectores que el repintado
 * ACABA de crear, el que es "el mismo" que tenía el foco antes de repintar (mismo
 * componente/terminal). Nunca toca el DOM ella misma — quien la llama (`restaurarFoco`,
 * más abajo) es quien de verdad hace `.focus()` sobre el elemento real.
 *
 * `disponibles`: `{componenteId, terminalId}[]` — los selectores que existen DESPUÉS
 * del repintado. `focoAnterior`: `{componenteId, terminalId} | null` — lo que tenía el
 * foco ANTES (o `null` si nada lo tenía, o si lo que tenía el foco no era un selector
 * de GPIO). Si no hay match (ej. el terminal dejó de tener selector), `null` — nunca
 * elige "cualquier cosa": fail-closed, mismo criterio que el resto de `vista-fisica/`.
 */
export function elegirSelectorParaFoco(disponibles, focoAnterior) {
  if (!focoAnterior) return null
  return disponibles.find((s) => s.componenteId === focoAnterior.componenteId && s.terminalId === focoAnterior.terminalId) ?? null
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3 (T5, contrato B7) — la FRASE editable de las reglas. Funciones PURAS (dependencias
// inyectadas, testeables sin DOM ni red). El navegador sigue sin ser autoridad: arma la
// regla ENTERA a partir de lo que el servidor proyectó (`reglas[i].forma`, `opcionesRegla`)
// y manda UN `SetComportamiento` por cambio; el Engine decide. No hay tablas de clases,
// capacidades ni estados acá: cada opción de `opcionesRegla.slots` trae su `parche`.
// ════════════════════════════════════════════════════════════════════════════════════

/** Arma la operación de UN cambio de la frase. `regla`: el elemento de `vista.reglas`, o
 * `null` para una regla nueva (nace con ese único slot y SIN id: lo asigna el Engine).
 * La opción elegida trae su `parche` (qué le agrega a la regla): acá sólo se mezcla. */
export function construirOperacionRegla({ regla, slot, valor, opcionesRegla }) {
  const forma = regla ? regla.forma : {}
  const definicion = definicionDeSlot(slot, regla, opcionesRegla)
  // Numeric Conditions S1: un slot "numero" no tiene opciones; el servidor dice DÓNDE va el número
  // (`destino`) y el navegador sólo lo coloca ahí. Qué significa, lo decide el Engine.
  if (definicion?.tipo === "numero") {
    const comportamiento = { ...(regla ? { id: regla.id } : {}), ...colocar(forma, definicion.destino, interpretarNumero(valor)) }
    return { tipo: "SetComportamiento", payload: { comportamiento } }
  }
  const opcion = definicion?.opciones.find((o) => o.valor === valor)
  const parche = opcion.parche
  // `reemplazaCuando` (N-10): la entrada nueva no declara la condición guardada, así que la regla
  // queda con la entrada sola (incompleta pero representable) en vez de una condición ajena.
  const cuando = opcion.reemplazaCuando ? parche.cuando : forma.cuando || parche.cuando ? mezclar(forma.cuando, parche.cuando) : undefined
  const entonces = forma.entonces || parche.entonces ? mezclar(forma.entonces, parche.entonces) : undefined
  const comportamiento = { ...(regla ? { id: regla.id } : {}), ...(cuando ? { cuando } : {}), ...(entonces ? { entonces } : {}) }
  return { tipo: "SetComportamiento", payload: { comportamiento } }
}

/** Los slots de ESA regla si el servidor los dio (dependen de la entrada elegida), si no los globales. */
function definicionDeSlot(slot, regla, opcionesRegla) {
  const slots = regla?.slots ?? opcionesRegla.slots ?? []
  return slots.find((s) => s.slot === slot)
}

function esObjetoPlano(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/** Mezcla de datos planos, campo por campo y en profundidad (sin nombres de campo). */
function mezclar(base, parche) {
  if (!esObjetoPlano(base) || !esObjetoPlano(parche)) return parche ?? base
  const salida = { ...base }
  for (const [clave, valor] of Object.entries(parche)) salida[clave] = esObjetoPlano(valor) && esObjetoPlano(base[clave]) ? mezclar(base[clave], valor) : valor
  return salida
}

/** Copia de `objeto` con `valor` en `camino` (los objetos intermedios se copian, nunca se mutan). */
function colocar(objeto, camino, valor) {
  if (camino.length === 0) return valor
  const [clave, ...resto] = camino
  const actual = esObjetoPlano(objeto) ? objeto : {}
  return { ...actual, [clave]: colocar(actual[clave], resto, valor) }
}

/** Foco de la frase tras repintar: el control equivalente (misma regla y slot) o `null`. */
export function elegirControlReglaParaFoco(disponibles, focoAnterior) {
  if (!focoAnterior) return null
  return disponibles.find((c) => c.reglaId === focoAnterior.reglaId && c.slot === focoAnterior.slot) ?? null
}

/**
 * Numeric Conditions S2: la operación que materializa un grupo COMPLETO de una regla ya
 * persistida. Misma composición que S1, con varias partes a la vez: se mezcla el `parche` de cada
 * opción elegida (en el orden de los slots) y el número va a su `destino`. UNA SetComportamiento.
 */
export function componerGrupo(regla, partes) {
  const { valores, opciones, completo } = estadoDelGrupo(regla, partes)
  if (!completo) return null
  let forma = { ...(regla.forma.cuando ? { cuando: regla.forma.cuando } : {}), ...(regla.forma.entonces ? { entonces: regla.forma.entonces } : {}) }
  for (const slot of slotsDelGrupo(regla)) {
    if (slot.tipo === "numero") {
      forma = colocar(forma, slot.destino, interpretarNumero(valores[slot.slot]))
      continue
    }
    const parche = opciones[slot.slot].find((o) => o.valor === valores[slot.slot]).parche
    forma = mezclar(forma, parche)
  }
  return { tipo: "SetComportamiento", payload: { comportamiento: { id: regla.id, ...forma } } }
}

/** ¿Es una edición real? Una opción ofrecida, o (slot "numero") un número válido distinto del guardado. */
function valorEsEdicion(slot, valor, regla, opcionesRegla) {
  if (valor === null || valor === undefined) return false
  const definicion = definicionDeSlot(slot, regla, opcionesRegla)
  if (!definicion) return false
  if (definicion.tipo === "numero") {
    const n = interpretarNumero(valor)
    return n !== null && String(n) !== regla?.frase?.[slot]?.clave
  }
  return definicion.opciones.some((o) => o.valor === valor)
}

/**
 * Controlador de la frase. Garantías (F-11 se mantiene): a lo sumo UNA operación en vuelo
 * (la propia o una externa, ej. un cambio de GPIO), todos los controles deshabilitados
 * mientras tanto, y un repintado SIEMPRE desde el snapshot de la respuesta (`alCambiar`
 * lo dispara el llamador). "Agregar regla" no crea nada: la regla nace con el primer selector.
 * - `obtenerSnapshot()`: el último snapshot autoritativo (`{revision, vista}`).
 * - `enviar({tipo, payload, baseRevision})`: hace el POST; resuelve con `{resultado}`.
 */
/** Numeric Conditions S2 (texto pendiente de aprobación): la regla cambió por otro lado mientras
 * se armaba su condición, y el borrador ya no aplica. */
export const AVISO_BORRADOR_DESCARTADO = "La regla cambió mientras armabas la condición; revisala."

export function crearControladorReglas({ obtenerSnapshot, enviar, alCambiar }) {
  let pendiente = false
  let externa = false
  let reglaNueva = false
  const trazasAbiertas = new Set()
  // Numeric Conditions S2: el ÚNICO borrador (lo comparten la frase y la vista lógica). Sólo las
  // partes del grupo atómico de UNA regla ya persistida; nunca IR, nunca estado del Engine.
  let borrador = null // { reglaId, partes }
  let avisoBorrador = null

  const reglaDelSnapshot = (reglaId) => obtenerSnapshot()?.vista?.reglas.find((r) => r.id === reglaId) ?? null

  /** El borrador revalidado contra el snapshot autoritativo vigente (OD-4): conserva sólo lo que
   * sigue ofrecido; si la regla ya no tiene grupo que armar, se descarta con un aviso. */
  function borradorVigente() {
    if (!borrador) return null
    const partes = revalidarGrupo(reglaDelSnapshot(borrador.reglaId), borrador.partes)
    if (partes === null) {
      borrador = null
      avisoBorrador = AVISO_BORRADOR_DESCARTADO
      return null
    }
    borrador = { reglaId: borrador.reglaId, partes }
    return borrador
  }

  const ocupado = () => pendiente || externa

  /** `siAcepta` corre ANTES del repintado final, sólo si el Engine aceptó (Numeric Conditions S2:
   * destruir el borrador recién con la respuesta autoritativa). */
  async function ejecutar(operacion, { siAcepta } = {}) {
    pendiente = true
    alCambiar()
    let cuerpo = null
    try {
      cuerpo = await enviar({ ...operacion, baseRevision: obtenerSnapshot().revision })
    } catch (error) {
      // El envío falló (red, respuesta que no es JSON): gana el snapshot autoritativo, nunca lo que se eligió.
      pendiente = false
      alCambiar()
      throw error
    } finally {
      pendiente = false
    }
    if (cuerpo?.resultado?.ok) {
      reglaNueva = false
      siAcepta?.()
    }
    alCambiar()
    return true
  }

  /** Una elección del grupo atómico: actualiza el borrador y, si el grupo quedó COMPLETO, manda UNA
   * operación. El borrador se destruye SÓLO si el Engine la aceptó; si la rechaza (o es stale), el
   * borrador queda para seguir editando y nunca se reenvía solo (OD-4). */
  async function cambiarEnGrupo(regla, slot, valor) {
    const vigente = borradorVigente()
    const partesPrevias = vigente && vigente.reglaId === regla.id ? vigente.partes : {}
    const partes = aplicarEleccionAlGrupo(regla, partesPrevias, slot, valor)
    borrador = { reglaId: regla.id, partes }
    avisoBorrador = null
    const operacion = componerGrupo(regla, partes)
    if (operacion === null) {
      alCambiar()
      return true
    }
    return ejecutar(operacion, {
      siAcepta: () => {
        borrador = null
      },
    })
  }

  function valorDelGrupoValido(regla, definicion, valor) {
    if (definicion.tipo === "numero") return typeof valor === "string"
    const vigente = borrador && borrador.reglaId === regla.id ? borrador.partes : {}
    return (estadoDelGrupo(regla, { ...vigente }).opciones[definicion.slot] ?? []).some((o) => o.valor === valor)
  }

  return {
    opciones: () => ({ operacionPendiente: ocupado(), reglaNueva, trazasAbiertas: [...trazasAbiertas], borrador: borradorVigente(), avisoBorrador }),
    /** Numeric Conditions S2: el borrador vigente (para la vista lógica: misma fuente que la frase). */
    borrador: () => borradorVigente(),
    /** Cancelar: descarta SÓLO el borrador; la regla incompleta ya persistida queda como está (B2/B7). */
    descartarBorrador() {
      borrador = null
      avisoBorrador = null
      alCambiar()
      return true
    },
    marcarOperacionExterna(valor) {
      externa = Boolean(valor)
    },
    agregar() {
      if (ocupado()) return false
      reglaNueva = true
      alCambiar()
      return true
    },
    async cambiar({ reglaId, slot, valor }) {
      if (ocupado()) return false
      const snapshot = obtenerSnapshot()
      if (!snapshot?.vista) return false
      const { opcionesRegla } = snapshot.vista
      const regla = reglaId === null ? null : (snapshot.vista.reglas.find((r) => r.id === reglaId) ?? null)
      if (reglaId !== null && regla === null) return false
      // Numeric Conditions S2: una parte del grupo atómico va al borrador, no al Engine.
      const definicionGrupo = regla ? definicionDeSlot(slot, regla, opcionesRegla) : undefined
      if (definicionGrupo && typeof definicionGrupo.grupoAtomico === "string") {
        if (!valorDelGrupoValido(regla, definicionGrupo, valor)) return false
        return cambiarEnGrupo(regla, slot, valor)
      }
      // Sólo valores OFRECIDOS (o un número válido nuevo): "condición avanzada" (no editable),
      // vaciar un slot o repetir el mismo número no envían nada.
      if (!valorEsEdicion(slot, valor, regla, opcionesRegla)) return false
      return ejecutar(construirOperacionRegla({ regla, slot, valor, opcionesRegla }))
    },
    async quitar({ reglaId }) {
      if (ocupado()) return false
      if (reglaId === null) {
        reglaNueva = false
        alCambiar()
        return true
      }
      return ejecutar({ tipo: "QuitarComportamiento", payload: { comportamiento: reglaId } }, { siAcepta: () => { if (borrador?.reglaId === reglaId) borrador = null } })
    },
    alternarTraza({ reglaId }) {
      if (trazasAbiertas.has(reglaId)) trazasAbiertas.delete(reglaId)
      else trazasAbiertas.add(reglaId)
      alCambiar()
    },
  }
}

let contenedores = null
let elementoRevision = null
let elementoReadiness = null
let elementoEstado = null
let elementoConexion = null
/** Panel "Vista lógica" (Phase 3, vertical #2): su contenedor NO está en `contenedores`, así que
 * `repintar()` nunca lo reemplaza; se crea una vez más abajo, con el mismo controlador de la frase. */
let panelVistaLogica = null
let panelCodigo = null
/** Bloques ↔ código (2026-11-26): el programa repartido en renglones y quién marca qué. */
let codigoPorLineas = null
let vinculoBloquesCodigo = null
/** Dónde va la clave del programa (qué pieza es `cmp-12`), o `null` fuera del navegador. */
let elementoNombresDelPrograma = null
/** El cuadro donde el panel escribe el programa (la clave mira qué está escrito ahí). */
let elementoDelPrograma = null
/** El renglón del programa en «Cómo está» (2026-11-26): fuera de `contenedores`, porque cambia
 * cuando contesta `/api/programa`, no sólo cuando llega un snapshot. */
let elementoProgramaResumen = null

if (enNavegador) {
  contenedores = {
    circuito: document.getElementById("circuito"),
    cables: document.getElementById("cables"),
    controles: document.getElementById("controles"),
    reglas: document.getElementById("reglas"),
    motivos: document.getElementById("motivos"),
    // 2026-11-26: la leyenda de cables y el resumen de arriba (raíces nuevas de `pintar.js`).
    leyenda: document.getElementById("leyenda-cables"),
    resumen: document.getElementById("resumen-reglas"),
    resumenEstado: document.getElementById("resumen-estado"),
    resumenAvisos: document.getElementById("resumen-avisos"),
    contadorAvisos: document.getElementById("contador-avisos"),
  }
  elementoRevision = document.getElementById("revision")
  elementoReadiness = document.getElementById("readiness")
  elementoEstado = document.getElementById("estado")
  elementoConexion = document.getElementById("conexion")
  elementoProgramaResumen = document.getElementById("resumen-programa")
}

/** Último snapshot AUTORITATIVO recibido (GET /api/proyecto, POST /api/operaciones,
 * o un refetch tras el evento SSE `revision`) — nunca un estado optimista. */
let ultimoSnapshot = null
let contadorOperacion = 0

/** Revisión post red-team (Hallazgo B2, MAJOR, P2-RED-B/INFORME.md, ataque A6): si
 * el servidor se reinicia (puerto efímero nuevo, el caso normal con `listen(0)`)
 * mientras la página sigue abierta, el `EventSource` reintenta CONTRA EL PUERTO
 * MUERTO para siempre — nunca puede reconectar, porque el servidor nuevo es un
 * origin distinto. Antes, la página quedaba exactamente igual, sin ningún indicio.
 * `estadoConexion` (reductor PURO, `estado-conexion.js`) más este indicador visible
 * cierran eso: nunca inventan datos de proyecto, sólo comunican la pérdida de
 * conexión de TRANSPORTE. */
let estadoConexion = ESTADO_INICIAL

/**
 * El indicador de conexión (2026-11-26). El chip dice lo corto («Ventana al día» / «Ventana sin
 * conexión», `estado-conexion.js`); la explicación larga, que antes iba entera en el chip, va en la
 * franja de estado (`#estado`, `role="status"`: también la anuncia un lector de pantalla). Al
 * reconectar se borra de la franja SÓLO si sigue siendo esa explicación: si mientras tanto la franja
 * pasó a decir otra cosa (un pedido que falló), eso no se pisa.
 *
 * Exportada y con los elementos inyectados para probarla ejecutándola.
 */
export function pintarIndicadorConexion({ estado, elementoConexion, elementoEstado }) {
  const { chip, detalle } = textosDelIndicador(estado)
  elementoConexion.textContent = chip
  elementoConexion.setAttribute("data-estado-conexion", estado)
  if (!elementoEstado) return
  if (detalle !== null) elementoEstado.textContent = detalle
  else if (elementoEstado.textContent === EXPLICACION_SIN_CONEXION) elementoEstado.textContent = ""
}

function actualizarIndicadorConexion() {
  if (!elementoConexion) return
  pintarIndicadorConexion({ estado: estadoConexion, elementoConexion, elementoEstado })
}

/** Procesa un evento NATIVO del `EventSource` (`"error"`/`"open"`) a través del
 * reductor puro, y sólo si el estado CAMBIÓ actualiza el indicador y (en una
 * reconexión real) vuelve a pedir el snapshot — nunca en la apertura inicial
 * (`estadoConexion` ya arrancó en `"conectado"`, no hay transición que atender ahí). */
function manejarEventoConexion(evento) {
  const anterior = estadoConexion
  estadoConexion = reducirEstadoConexion(estadoConexion, evento)
  if (anterior === estadoConexion) return
  actualizarIndicadorConexion()
  if (estadoConexion === "conectado") {
    // Reconexión real (mismo puerto): SIEMPRE se repinta desde un snapshot
    // autoritativo fresco, nunca desde lo que la pestaña ya tenía dibujado.
    cargarSnapshot()
  } else {
    // Desconectado: el selector se deshabilita en el PRÓXIMO repintado — repintar
    // acá mismo (sin esperar un nuevo snapshot) para que se refleje ya mismo, sin
    // inventar ningún dato nuevo de proyecto.
    repintar()
  }
}

function siguienteIdOperacion() {
  contadorOperacion += 1
  return `navegador-${Date.now()}-${contadorOperacion}`
}

function mostrarEstado(texto) {
  elementoEstado.textContent = texto ?? ""
  panelVistaLogica?.mostrarEstado(texto)
}

/** F-11: lo que tenía el foco ANTES de repintar, si era un selector de GPIO (tiene
 * `data-componente-id`/`data-terminal-id`) — `null` en cualquier otro caso (nada
 * enfocado, o enfocado algo que no es un selector nuestro). Lee el DOM real
 * (`document.activeElement`); la DECISIÓN de qué hacer con esto es de
 * `elegirSelectorParaFoco` (pura, arriba). */
function capturarFocoActual() {
  const activo = document.activeElement
  if (!activo || typeof activo.getAttribute !== "function") return null
  const componenteId = activo.getAttribute("data-componente-id")
  const terminalId = activo.getAttribute("data-terminal-id")
  if (!componenteId || !terminalId) return null
  return { componenteId, terminalId }
}

/** F-11: tras montar la sección de controles recién pintada, re-enfoca el selector
 * EQUIVALENTE (mismo componente/terminal) al que tenía el foco antes de repintar, si
 * sigue existiendo — nunca enfoca "cualquier cosa" (ver `elegirSelectorParaFoco`). */
function restaurarFoco(raizControles, focoAnterior) {
  if (!focoAnterior || typeof raizControles.querySelectorAll !== "function") return
  const disponibles = [...raizControles.querySelectorAll("select[data-componente-id][data-terminal-id]")].map((elemento) => ({
    componenteId: elemento.getAttribute("data-componente-id"),
    terminalId: elemento.getAttribute("data-terminal-id"),
    elemento,
  }))
  const elegido = elegirSelectorParaFoco(
    disponibles.map(({ componenteId, terminalId }) => ({ componenteId, terminalId })),
    focoAnterior,
  )
  if (!elegido) return
  const match = disponibles.find((s) => s.componenteId === elegido.componenteId && s.terminalId === elegido.terminalId)
  if (match && typeof match.elemento.focus === "function") match.elemento.focus()
}

/** Repinta ÍNTEGRO desde `ultimoSnapshot` — nunca actualiza el DOM anterior a
 * pedazos. Si el snapshot no trae `vista` (no debería pasar en producción, donde
 * `servicio-con-vista.ts` siempre inyecta `calcularVista`), no rompe: sólo no dibuja
 * el circuito, deja el resto de la cabecera (revisión/readiness) al día.
 *
 * F-11: captura el foco ANTES de reemplazar el DOM y lo restaura DESPUÉS, sobre el
 * selector equivalente — el `replaceChildren` sigue siendo "repintar TODO" (ninguna
 * actualización parcial, mismo invariante de siempre), sólo que ahora no se pierde el
 * foco en el camino. */
/**
 * La cabecera (revisión y estado) y, PEGADO a ella, el panel de código.
 *
 * Van juntos y primero, antes de todo lo que puede cortar el repintado (un snapshot sin vista, un
 * pintado que tira): si la revisión ya cambió en pantalla, el programa de la anterior se tiene que
 * haber ido. El código se pide al servidor por la revisión de ESTE snapshot (sólo si cambió) y
 * nunca se arma acá.
 *
 * Es una función aparte, con todo inyectado, para poder probarla EJECUTÁNDOLA: la primera prueba
 * de esto comparaba posiciones en el texto de la fuente y dejaba pasar un `if (false)` delante de
 * la llamada (segunda revisión independiente, 2026-11-26).
 *
 * Si el panel tira, se ataja: una falla de la sección «Código» no puede dejar sin pintar el
 * montaje, las reglas y los motivos.
 */
export function repintarCabecera({ snapshot, elementoRevision, elementoReadiness, panelCodigo, conectado }) {
  elementoRevision.textContent = `revisión: ${snapshot.revision}`
  // El panel de código va ACÁ, antes de cualquier otra cosa que pueda cortar o tirar.
  try {
    void panelCodigo?.actualizar(snapshot, { conectado })
  } catch {
    /* la sección «Código» falló: el resto de la página se pinta igual */
  }
  // El estado del proyecto (2026-11-26): el servidor lo manda ya decidido y en palabras
  // (`vista.resumen.estado`). Acá sólo se copia el texto y se deja la clave como dato para el
  // color. Antes este mismo lugar elegía entre «listo», «inválido» e «incompleto» con un `if`.
  // Sin resumen (un snapshot sin vista: no debería pasar en producción) no hay estado que
  // afirmar: se deja la raya, nunca el estado de un snapshot anterior.
  const estado = snapshot.vista?.resumen?.estado ?? null
  elementoReadiness.textContent = estado ? estado.texto : "—"
  if (estado) elementoReadiness.setAttribute("data-readiness", estado.clave)
  else elementoReadiness.removeAttribute("data-readiness")
}

/**
 * El renglón del programa en «Cómo está». Lo decide `renglonDelPrograma` (pura) con lo que el panel
 * de código ya sabe y los textos que mandó el servidor en `vista.resumen.programa`; acá sólo se
 * junta y se pinta. Se llama en cada repintado y cada vez que el panel cambia lo que sabe. Si tira,
 * se ataja: el renglón no puede cortar el resto de la página.
 */
function repintarRenglonDelPrograma() {
  if (!elementoProgramaResumen) return
  try {
    const renglon = renglonDelPrograma({
      textos: ultimoSnapshot?.vista?.resumen?.programa ?? null,
      estadoPrograma: panelCodigo?.estadoDelPrograma() ?? null,
      revision: ultimoSnapshot?.revision,
      conectado: estadoConexion === "conectado",
    })
    pintarRenglonDelPrograma(document, elementoProgramaResumen, renglon)
  } catch {
    /* sin renglón: no se afirma nada del programa */
  }
}

/**
 * La estructura del programa, SÓLO si es la del proyecto que se está mostrando. Pura. El panel de
 * código puede tener a la vista el programa de otra revisión por un instante (o por un corte): con
 * esa estructura los bloques dirían lo que preparaba otro programa.
 * @param {{ revision: number, estructura: object } | null | undefined} delPanel lo que dice `panelCodigo.estructuraDelPrograma()`.
 */
export function estructuraDeLaRevision(delPanel, revision) {
  return delPanel && typeof revision === "number" && delPanel.revision === revision ? delPanel.estructura : null
}

/**
 * Cuánto hay que desplazar la página para que una caja (`{ top, bottom }`, como
 * `getBoundingClientRect`) quede en el medio de lo que se ve, debajo del header fijo. Pura. Si la
 * caja ya está entera a la vista, cero: no se mueve la página sin necesidad.
 */
export function desplazamientoHasta(caja, { altoVentana, altoCabecera }) {
  if (!caja || !Number.isFinite(caja.top) || !Number.isFinite(caja.bottom)) return 0
  const desde = Math.max(0, altoCabecera)
  if (caja.top >= desde && caja.bottom <= altoVentana) return 0
  const centroDeLoVisible = desde + (altoVentana - desde) / 2
  return Math.round((caja.top + caja.bottom) / 2 - centroDeLoVisible)
}

/** Texto junto a los bloques o junto al código, con su enlace al otro lado. Sin texto, no se ve nada. */
export function pintarVinculo({ caja, texto, enlace }, dicho, { conEnlace = true } = {}) {
  texto.textContent = dicho
  caja.hidden = dicho === ""
  if (enlace) enlace.hidden = dicho === "" || !conEnlace
}

/**
 * Los bloques, los renglones del código y lo marcado, puestos de acuerdo con el último snapshot y
 * con lo que el panel de código sabe AHORA. Se llama en cada repintado y cada vez que cambia el
 * programa (que llega un instante después que el proyecto, por otro pedido).
 */
function sincronizarBloquesYCodigo() {
  if (!ultimoSnapshot?.vista) {
    // Un snapshot sin vista (no debería pasar en producción): la cabecera ya borró el programa. La
    // clave y lo marcado eran de la revisión anterior: tampoco quedan (revisión a ciegas, 2026-11-27).
    try {
      if (elementoNombresDelPrograma) pintarNombresDelPrograma(document, elementoNombresDelPrograma, null)
      vinculoBloquesCodigo?.actualizar(null, [], { hayBloques: false })
    } catch {
      /* no se pudo limpiar: el resto de la página sigue */
    }
    return
  }
  const estructura = estructuraDeLaRevision(panelCodigo?.estructuraDelPrograma?.() ?? null, ultimoSnapshot.revision)
  // La vista lógica se repinta SIEMPRE desde el snapshot autoritativo, sin tocar el DOM de arriba.
  const modeloDeLosBloques = panelVistaLogica?.repintar(ultimoSnapshot, { deshabilitado: controladorReglas.opciones().operacionPendiente || estadoConexion !== "conectado", estructura }) ?? null
  // Sin Blockly, o sin nada que armar, no hay bloques dibujados: no se invita a tocarlos.
  const hayBloques = (modeloDeLosBloques?.reglas?.length ?? 0) > 0
  try {
    // La clave sale de la MISMA estructura (la del programa de esta revisión) y de las reglas de
    // este snapshot: sin estructura no hay clave, y nunca queda la de otra revisión.
    if (elementoNombresDelPrograma) pintarNombresDelPrograma(document, elementoNombresDelPrograma, nombresDelPrograma(estructura, ultimoSnapshot.vista.reglas ?? [], elementoDelPrograma?.textContent ?? "", TITULOS_DE_LA_ESTRUCTURA))
  } catch {
    /* la clave falló: el código se sigue viendo */
  }
  try {
    codigoPorLineas?.repartir()
    vinculoBloquesCodigo?.actualizar(estructura, (ultimoSnapshot.vista.reglas ?? []).map((regla) => regla.id).filter((id) => typeof id === "string"), { hayBloques })
  } catch {
    /* el marcado falló: los bloques y el código se siguen viendo */
  }
}

function repintar() {
  if (!ultimoSnapshot) return
  repintarCabecera({ snapshot: ultimoSnapshot, elementoRevision, elementoReadiness, panelCodigo, conectado: estadoConexion === "conectado" })
  repintarRenglonDelPrograma()

  if (!ultimoSnapshot.vista) return
  const focoAnterior = capturarFocoActual()
  const instrucciones = planDePintado(ultimoSnapshot.vista, { conexionActiva: estadoConexion === "conectado", ...controladorReglas.opciones() })
  const secciones = pintar(document, instrucciones, {
    onCambioGpio: manejarCambioGpio,
    onCambioRegla: manejarCambioRegla,
    onQuitarRegla: (evento) => avisarSiFalla(controladorReglas.quitar(evento)),
    onAgregarRegla: () => controladorReglas.agregar(),
    onAlternarTraza: (evento) => controladorReglas.alternarTraza(evento),
    onDescartarBorrador: () => controladorReglas.descartarBorrador(),
  })
  for (const clave of Object.keys(contenedores)) {
    contenedores[clave].replaceChildren(secciones[clave])
  }
  // Physical View UX #1: los cables se dibujan DESPUÉS de montar (hay que medir las
  // piezas reales) y se vuelven a dibujar si cambia el tamaño (ver `programarCableado`).
  ultimoCableado = instrucciones.find((i) => i.tipo === "cableado") ?? null
  programarCableado()
  restaurarFoco(secciones.controles, focoAnterior)
  restaurarFocoRegla(secciones.reglas)
  sincronizarBloquesYCodigo()
}

/** Physical View UX #1: la instrucción `cableado` del último repintado y el redibujo
 * diferido. Las piezas Wokwi terminan de renderizar su contenido un instante después de
 * insertarse, y la ventana puede cambiar de tamaño: en los dos casos se vuelve a medir y
 * a dibujar desde la MISMA instrucción (nunca se decide nada nuevo acá). */
let ultimoCableado = null
let cableadoProgramado = false
/** Mientras se imprime, el esquema está achicado para el papel (`impresion.js`): no se vuelve a
 * medir ni a dibujar hasta que termine. */
let imprimiendo = false

function programarCableado() {
  if (!enNavegador || cableadoProgramado || imprimiendo) return
  cableadoProgramado = true
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      cableadoProgramado = false
      if (imprimiendo) return // se pidió antes de empezar a imprimir: se redibuja al terminar
      const piezas = piezasDelCircuito()
      if (piezas) dibujarCableado(document, piezas, ultimoCableado)
    }),
  )
}

function piezasDelCircuito() {
  return contenedores?.circuito?.firstElementChild ?? null
}

if (enNavegador && typeof ResizeObserver === "function") {
  new ResizeObserver(() => programarCableado()).observe(document.getElementById("circuito"))
  customElements.whenDefined("wokwi-esp32-devkit-v1").then(() => programarCableado())
}

/** El `sessionStorage` de la pestaña, o `null` si el navegador no lo deja ni nombrar (tira al leerlo). */
function almacenDeLaPestana() {
  try {
    return window.sessionStorage ?? null
  } catch {
    return null
  }
}

/** Cliente HTTP compartido (GPIO, frase): ver `cliente-http.js`. `fetch` se resuelve en cada llamada. */
const cliente = crearClienteHttp({
  fetch: (...argumentos) => fetch(...argumentos),
  aplicarSnapshot: (snapshot) => {
    ultimoSnapshot = snapshot
  },
  repintar: () => repintar(),
  mostrarEstado: (texto) => mostrarEstado(texto),
  // La llave de la sesión viene en el fragmento de la dirección y además la recuerda la pestaña:
  // un enlace del menú cambia el fragmento, y al recargar la dirección ya no la trae.
  token: enNavegador ? llaveDeLaSesion(location.hash, almacenDeLaPestana()) : null,
})
const cargarSnapshot = () => cliente.cargarSnapshot()
const enviarSobre = (sobre, opciones) => cliente.enviarSobre(sobre, opciones)

/** F-11: el valor que el servidor tiene HOY para (componenteId, terminalId), leído de
 * `ultimoSnapshot` — `null` si el terminal no está asignado (o no existe). Es lo que
 * `crearCoalescerCambiosGpio` usa para decidir "si el valor final coincide con el del
 * servidor, no se manda nada": siempre lee el snapshot MÁS RECIENTE en el momento en
 * que de verdad se evalúa (nunca uno capturado de antes). */
function valorServidorDe(componenteId, terminalId) {
  const componente = ultimoSnapshot?.vista?.componentes.find((c) => c.id === componenteId)
  const terminal = componente?.terminales?.[terminalId]
  return terminal && terminal.estado === "asignado" ? terminal.pinSemantico : null
}

/** El POST real — misma forma/invariantes que antes de F-11 (sobre firmado con
 * `baseRevision` del ÚLTIMO snapshot autoritativo, nunca optimista; "otro cambio
 * llegó primero" sigue siendo honesto para un conflicto REAL con otro actor — F-11
 * sólo cierra los conflictos FALSOS que generaba un POST por tecla). La diferencia:
 * ahora quien decide CUÁNDO llamar a esta función es `coalescerGpio`, nunca
 * directamente el `change` del `<select>`.
 *
 * Es una fábrica con todo inyectado para poder probarla EJECUTÁNDOLA (2026-11-26): si la red
 * falla, el aviso que se muestra es el que mandó el servidor en el último snapshot
 * (`vista.textos.cambioDePinNoGuardado`); el repintado desde ese snapshot lo hace
 * `cliente-http.js::enviarSobre`. La promesa se rechaza igual: el coalescer libera su turno con
 * éxito o con rechazo, y la frase queda desbloqueada por el `finally`. */
export function crearEnvioDeCambioGpio({ obtenerSnapshot, enviarSobre, siguienteIdOperacion, marcarOperacionExterna }) {
  return async function enviarCambioGpio({ componenteId, terminalId, valor }) {
    const snapshot = obtenerSnapshot()
    if (!snapshot) return
    const sobre = {
      idOperacion: siguienteIdOperacion(),
      actor: "navegador", // el servidor lo fuerza de todos modos (servidor-proyecto.ts)
      baseRevision: snapshot.revision,
      tipo: "AsignarPin",
      payload: { componente: componenteId, terminal: terminalId, pin: valor },
    }

    // Una operación de GPIO en vuelo también bloquea la frase (a lo sumo UNA operación global).
    marcarOperacionExterna(true)
    try {
      await enviarSobre(sobre, { repintarAhora: true, avisoSiFalla: snapshot.vista?.textos?.cambioDePinNoGuardado ?? MENSAJE_NO_SE_PUDO_GUARDAR })
    } finally {
      marcarOperacionExterna(false)
    }
  }
}

const enviarCambioGpio = crearEnvioDeCambioGpio({
  obtenerSnapshot: () => ultimoSnapshot,
  enviarSobre: (sobre, opciones) => enviarSobre(sobre, opciones),
  siguienteIdOperacion: () => siguienteIdOperacion(),
  marcarOperacionExterna: (valor) => controladorReglas.marcarOperacionExterna(valor),
})

/** La frase: un `SetComportamiento`/`QuitarComportamiento` por cambio, con `baseRevision` del
 * ÚLTIMO snapshot autoritativo (nunca optimista). */
async function enviarOperacionRegla({ tipo, payload, baseRevision }) {
  return enviarSobre({ idOperacion: siguienteIdOperacion(), actor: "navegador", baseRevision, tipo, payload }, { repintarAhora: false })
}

const controladorReglas = crearControladorReglas({ obtenerSnapshot: () => ultimoSnapshot, enviar: enviarOperacionRegla, alCambiar: () => (enNavegador ? repintar() : undefined) })

if (enNavegador) {
  panelVistaLogica = crearPanelVistaLogica({
    // `Blockly` es el global del <script> vendorizado; si el asset faltara, el panel lo dice y la frase sigue.
    Blockly: typeof Blockly === "undefined" ? undefined : Blockly,
    lienzo: document.getElementById("vista-logica-lienzo"),
    elementoTexto: document.getElementById("vista-logica-texto"),
    elementoEstado: document.getElementById("vista-logica-estado"),
    botonQuitar: document.getElementById("vista-logica-quitar"),
    controlador: controladorReglas,
    alSeleccionar: (clave) => {
      // Viniendo de un bloque, las flechas del código siguen desde lo que quedó marcado, no desde
      // la última línea que se había tocado antes.
      if (clave) codigoPorLineas?.soltarCursor()
      vinculoBloquesCodigo?.alTocarBloque(clave)
    },
  })
  panelCodigo = crearPanelCodigo({
    fetch: (...argumentos) => fetch(...argumentos),
    elementoCodigo: document.getElementById("vista-codigo-texto"),
    elementoAviso: document.getElementById("vista-codigo-aviso"),
    // El programa llega después que el proyecto: cuando llega (o se va), los bloques de «al
    // iniciar» y los renglones del código se ponen al día.
    alCambiarElPrograma: () => {
      repintarRenglonDelPrograma()
      sincronizarBloquesYCodigo()
    },
  })
  // El MISMO elemento en el que el panel escribe el programa: acá se reparte en renglones.
  const elementoCodigo = document.getElementById("vista-codigo-texto")
  codigoPorLineas = crearCodigoPorLineas({ doc: document, elementoCodigo })
  elementoNombresDelPrograma = document.getElementById("vista-codigo-nombres")
  elementoDelPrograma = elementoCodigo
  const vinculoDeLosBloques = { caja: document.getElementById("vista-logica-vinculo"), texto: document.getElementById("vista-logica-vinculo-texto"), enlace: document.getElementById("vista-logica-vinculo-enlace") }
  const vinculoDelCodigo = { caja: document.getElementById("vista-codigo-vinculo"), texto: document.getElementById("vista-codigo-vinculo-texto"), enlace: document.getElementById("vista-codigo-vinculo-enlace") }
  vinculoBloquesCodigo = crearVinculoBloquesCodigo({
    marcarBloques: (clave) => panelVistaLogica?.marcar(clave),
    marcarLineas: (rango) => {
      const marco = codigoPorLineas.marcar(rango)
      // Se acerca la línea marcada DENTRO del cuadro del código (que tiene su propia barra). No
      // se mueve la página: el alumno está mirando los bloques y decide él si baja.
      const renglon = codigoPorLineas.primerRenglonMarcado()
      if (marco && renglon && typeof renglon.offsetTop === "number") elementoCodigo.scrollTop = Math.max(0, renglon.offsetTop - elementoCodigo.clientHeight / 3)
      return marco
    },
    decirJuntoALosBloques: (texto, { hayLineas }) => pintarVinculo(vinculoDeLosBloques, texto, { conEnlace: hayLineas }),
    decirJuntoAlCodigo: (texto, { hayBloque }) => pintarVinculo(vinculoDelCodigo, texto, { conEnlace: hayBloque }),
  })
  elementoCodigo.addEventListener("click", (evento) => {
    // Arrastrar para seleccionar texto (y copiarlo) no es tocar una línea.
    if (window.getSelection && !window.getSelection().isCollapsed) return
    vinculoBloquesCodigo.alTocarLinea(codigoPorLineas.lineaDe(evento.target))
  })
  // Sin mouse: con el foco en el cuadro del código, las flechas recorren las líneas de a una.
  elementoCodigo.addEventListener("keydown", (evento) => {
    const paso = evento.key === "ArrowDown" ? 1 : evento.key === "ArrowUp" ? -1 : 0
    // Con Mayúsculas, las flechas extienden la selección de texto (copiar con el teclado): no se tocan.
    if (paso === 0 || evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return
    // Sin estructura, tocar una línea no marca nada: las flechas quedan para lo de siempre,
    // desplazar el cuadro. Si no, el programa no se podía recorrer con el teclado.
    if (!vinculoBloquesCodigo.hayEstructura()) return
    const numero = codigoPorLineas.vecina(paso)
    if (numero === null) return
    evento.preventDefault()
    vinculoBloquesCodigo.alTocarLinea(numero)
  })
  // Los dos enlaces del vínculo llevan la vista hasta LO MARCADO, no hasta el título de la sección
  // (con seis reglas, lo marcado quedaba fuera de la ventana). Y no cambian la dirección: un
  // enlace a `#paso-programa` pisaba la llave de la sesión (`#t=…`), y después de recargar la
  // pestaña ya no podía cambiar el proyecto. El `href` queda para quien abra la página sin esto.
  const llevarLaVistaHasta = (caja) => {
    const cabecera = document.querySelector("header")
    const cuanto = desplazamientoHasta(caja, { altoVentana: window.innerHeight, altoCabecera: cabecera ? cabecera.getBoundingClientRect().bottom : 0 })
    if (cuanto !== 0) window.scrollBy({ top: cuanto })
  }
  vinculoDeLosBloques.enlace?.addEventListener("click", (evento) => {
    evento.preventDefault()
    llevarLaVistaHasta((codigoPorLineas.primerRenglonMarcado() ?? elementoCodigo).getBoundingClientRect())
    // El foco pasa al cuadro del código: desde ahí las flechas siguen recorriendo las líneas.
    elementoCodigo.focus({ preventScroll: true })
  })
  vinculoDelCodigo.enlace?.addEventListener("click", (evento) => {
    evento.preventDefault()
    llevarLaVistaHasta(panelVistaLogica?.cajaDeLoMarcado() ?? document.getElementById("vista-logica-lienzo").getBoundingClientRect())
  })
}

/** Foco de la frase: se captura al cambiar un select y se restaura cuando la operación termina
 * (mientras está pendiente los selects están deshabilitados y no pueden tener el foco). */
let focoReglaPendiente = null

function capturarFocoRegla() {
  const activo = document.activeElement
  if (!activo || typeof activo.getAttribute !== "function") return null
  const reglaId = activo.getAttribute("data-regla-id")
  const slot = activo.getAttribute("data-slot")
  return reglaId && slot ? { reglaId, slot } : null
}

function restaurarFocoRegla(raizReglas) {
  if (!focoReglaPendiente || controladorReglas.opciones().operacionPendiente || typeof raizReglas.querySelectorAll !== "function") return
  const disponibles = [...raizReglas.querySelectorAll("select[data-regla-id][data-slot]")].map((e) => ({ reglaId: e.getAttribute("data-regla-id"), slot: e.getAttribute("data-slot"), elemento: e }))
  const elegido = elegirControlReglaParaFoco(disponibles.map(({ reglaId, slot }) => ({ reglaId, slot })), focoReglaPendiente)
  focoReglaPendiente = null
  const match = elegido && disponibles.find((c) => c.reglaId === elegido.reglaId && c.slot === elegido.slot)
  if (match && typeof match.elemento.focus === "function") match.elemento.focus()
}

function manejarCambioRegla({ reglaId, slot, valor }) {
  focoReglaPendiente = capturarFocoRegla()
  avisarSiFalla(controladorReglas.cambiar({ reglaId, slot, valor }))
}

/** Si el envío de la frase falla, el controlador ya repintó desde el snapshot; acá sólo se avisa. */
function avisarSiFalla(promesa) {
  Promise.resolve(promesa).catch(() => mostrarEstado(MENSAJE_NO_SE_PUDO_GUARDAR))
}

/** F-11: el coalescer real de esta página — `enviar`/`obtenerValorServidor` leen
 * `ultimoSnapshot` siempre FRESCO en el momento en que de verdad se invocan (nunca
 * algo capturado al momento del `change`). `programar`/`cancelarProgramado` quedan en
 * sus valores por defecto (`setTimeout`/`clearTimeout` reales) — sólo los tests
 * (`tests/wave0-view.test.mjs`) los reemplazan por un reloj falso. */
const coalescerGpio = crearCoalescerCambiosGpio({ enviar: enviarCambioGpio, obtenerValorServidor: valorServidorDe })

/** El único manejador de `change` que `pintar.js` conoce — F-11: en vez de mandar un
 * POST directo, registra el cambio en el coalescer (debounce + "a lo sumo un POST en
 * vuelo" + "sólo el último valor"). */
function manejarCambioGpio({ componenteId, terminalId, valor }) {
  coalescerGpio.registrarCambio(componenteId, terminalId, valor)
}

// La sección activa de la navegación (presentación pura: no toca el proyecto ni la red).
if (enNavegador) conectarNavegacion(document, window)
// El botón de tema claro / oscuro (el tema inicial ya lo puso `tema-inicial.js`, antes de pintar).
if (enNavegador) conectarTema(document, window)
// Imprimir / guardar como PDF: se prepara el esquema para el papel y se pausa el redibujo de los
// cables mientras dura; al terminar se vuelven a dibujar con las medidas de pantalla.
if (enNavegador) {
  conectarImpresion(document, window, {
    alEmpezar: () => {
      imprimiendo = true
    },
    alTerminar: () => {
      imprimiendo = false
      programarCableado()
    },
  })
}

// SSE: cualquier commit (de este navegador o de otro actor, ej. la tool) dispara un
// refetch íntegro — nunca se aplica el `{revision}` del evento de forma optimista.
//
// Este bootstrap sólo corre en el navegador real (ver `enNavegador` arriba) — nunca
// bajo `node --test`.
if (enNavegador) {
  const eventos = new EventSource("/api/eventos")
  eventos.addEventListener("revision", () => {
    cargarSnapshot()
  })
  // Revisión post red-team (B2): `error`/`open` son eventos NATIVOS del propio
  // `EventSource` (no algo que este módulo invente) — se procesan por el reductor
  // puro de `estado-conexion.js`, nunca acá mismo con lógica ad-hoc.
  eventos.addEventListener("error", () => manejarEventoConexion({ tipo: "error" }))
  eventos.addEventListener("open", () => manejarEventoConexion({ tipo: "open" }))

  cargarSnapshot()
}
