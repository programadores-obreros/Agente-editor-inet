// Vista lógica — Phase 3, vertical #2 (contrato PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md §3).
//
// PURO: ni DOM ni red ni librería de bloques. Proyecta `vista.reglas` + `vista.opcionesRegla` (lo que el
// servidor ya calculó) a un modelo para la vista lógica. No hay un segundo vocabulario: el
// valor actual sale de la MISMA función que usa la frase editable (`valorActualDe`), y las
// opciones son exactamente `opcionesRegla.slots[i].opciones` (sin el `parche`, que es del
// constructor de operaciones). Nada de slots ni clases nombrados acá: el orden y los textos
// fijos los dicta el servidor.
//
// SE PROYECTAN TODAS LAS REGLAS (2026-11-24). Antes el límite de UI era una: se proyectaba
// `reglas[0]` y un renglón avisaba "se muestra la primera". En la notebook real eso mostró la
// regla VIEJA mientras el docente acababa de pedir otra (el pedido nuevo va al final de la lista),
// o sea que los bloques decían una cosa y el proyecto otra. El dueño levantó el límite (decisión
// D4 / OD-3, ver DECISIONS.md). `regla` queda como la PRIMERA de `reglas`, para quien mira una
// sola (proyecto sin reglas o con una); el adaptador y el panel recorren `reglas`.

import { valorActualDe, estadoDelGrupo } from "./plan-de-pintado.js"

/**
 * @param {{ reglas?: readonly object[], opcionesRegla?: { slots?: readonly object[] } }} vista
 *   el campo `vista` del snapshot, tal cual llega serializado.
 * @returns {{ reglas: readonly ReglaLogica[], regla: null | ReglaLogica, hayVarias: boolean }}
 *   `reglas`: una por regla del proyecto, en su orden; sin ninguna, UNA vacía (`id: null`) para
 *   armar la primera. `regla` es `reglas[0] ?? null`.
 * @typedef {{ id: string | null, campos: readonly object[], completa: boolean,
 *   faltan: readonly string[], avanzada: boolean, aviso: string | null, motivos: readonly string[] }} ReglaLogica
 */
export function proyectarModeloLogico(vista, borrador = null) {
  const existentes = vista?.reglas ?? []
  const slots = vista?.opcionesRegla?.slots ?? []
  const hayVarias = existentes.length > 1
  if (slots.length === 0) return { reglas: [], regla: null, hayVarias }
  const reglas = existentes.length > 0 ? existentes.map((existente) => proyectarRegla(existente, slots, borrador)) : [proyectarRegla(null, slots, borrador)]
  return { reglas, regla: reglas[0], hayVarias }
}

function proyectarRegla(existente, slots, borrador) {
  const frase = existente ? existente.frase : {}
  // Numeric Conditions S1: si la regla trae sus propios slots (dependen de la entrada elegida), se usan ésos.
  const definiciones = (existente && existente.slots) ?? slots
  // Numeric Conditions S2: el borrador del grupo atómico (el MISMO del controlador que usa la frase)
  // se superpone a los slots del grupo; el workspace nunca lo guarda.
  const partes = existente && borrador?.reglaId === existente.id ? borrador.partes : {}
  const grupo = existente ? estadoDelGrupo(existente, partes) : { valores: {}, opciones: {} }
  const campos = definiciones.map((definicion) => {
    if (typeof definicion.grupoAtomico === "string") {
      const valor = grupo.valores[definicion.slot]
      const opcionesGrupo = (grupo.opciones[definicion.slot] ?? []).map((o) => ({ valor: o.valor, etiqueta: o.etiqueta }))
      const numero = definicion.tipo === "numero"
      return {
        slot: definicion.slot,
        prefijo: definicion.prefijo,
        valor: numero ? (valor === "" ? null : valor) : (valor ?? null),
        etiquetaActual: numero ? (valor ?? "") : (opcionesGrupo.find((o) => o.valor === valor)?.etiqueta ?? null),
        opciones: opcionesGrupo,
        ...(numero ? { tipo: "numero" } : {}),
        ...(definicion.grupo ? { grupo: definicion.grupo } : {}),
      }
    }
    const actual = valorActualDe(frase, definicion.slot)
    return {
      slot: definicion.slot,
      prefijo: definicion.prefijo,
      valor: actual ? actual.valor : null,
      etiquetaActual: actual ? actual.etiqueta : null,
      opciones: definicion.opciones.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })),
      // "numero" = un valor que se escribe (sin opciones); `grupo` dice en qué bloque va.
      ...(definicion.tipo === "numero" ? { tipo: "numero" } : {}),
      ...(definicion.grupo ? { grupo: definicion.grupo } : {}),
    }
  })
  const avisoServidor = existente ? (existente.aviso ?? null) : null
  return {
    id: existente ? existente.id : null,
    campos,
    completa: existente ? existente.completa === true : false,
    faltan: existente ? [...(existente.faltan ?? [])] : [],
    // El servidor avisa de una condición que la vista no sabe armar: ese aviso ES la señal.
    avanzada: avisoServidor !== null,
    aviso: avisoServidor,
    ayuda: existente ? (existente.ayuda ?? null) : null,
    // Numeric Conditions S2: hay partes elegidas que todavía no se guardaron.
    sinEnviar: Object.keys(partes).length > 0,
    motivos: existente ? existente.motivos.map((m) => m.explicacion).filter((t) => typeof t === "string" && t !== "") : [],
  }
}
