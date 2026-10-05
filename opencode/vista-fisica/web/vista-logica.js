// Vista lógica — Phase 3, vertical #2 (contrato PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md §3).
//
// PURO: ni DOM ni red ni librería de bloques. Proyecta `vista.reglas` + `vista.opcionesRegla` (lo que el
// servidor ya calculó) a un modelo para la vista lógica. No hay un segundo vocabulario: el
// valor actual sale de la MISMA función que usa la frase editable (`valorActualDe`), y las
// opciones son exactamente `opcionesRegla.slots[i].opciones` (sin el `parche`, que es del
// constructor de operaciones). Nada de slots ni clases nombrados acá: el orden y los textos
// fijos los dicta el servidor.
//
// Límite de UI = una regla: se proyecta la primera; `hayVarias` avisa de que hay más.

import { valorActualDe } from "./plan-de-pintado.js"

/**
 * @param {{ reglas?: readonly object[], opcionesRegla?: { slots?: readonly object[] } }} vista
 *   el campo `vista` del snapshot, tal cual llega serializado.
 * @returns {{ regla: null | { id: string | null, campos: readonly object[], completa: boolean,
 *   faltan: readonly string[], avanzada: boolean, aviso: string | null, motivos: readonly string[] },
 *   hayVarias: boolean }}
 */
export function proyectarModeloLogico(vista) {
  const reglas = vista?.reglas ?? []
  const slots = vista?.opcionesRegla?.slots ?? []
  const hayVarias = reglas.length > 1
  if (slots.length === 0) return { regla: null, hayVarias }

  const existente = reglas[0] ?? null
  const frase = existente ? existente.frase : {}
  // Numeric Conditions S1: si la regla trae sus propios slots (dependen de la entrada elegida), se usan ésos.
  const definiciones = (existente && existente.slots) ?? slots
  const campos = definiciones.map((definicion) => {
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
    regla: {
      id: existente ? existente.id : null,
      campos,
      completa: existente ? existente.completa === true : false,
      faltan: existente ? [...(existente.faltan ?? [])] : [],
      // El servidor avisa de una condición que la vista no sabe armar: ese aviso ES la señal.
      avanzada: avisoServidor !== null,
      aviso: avisoServidor,
      ayuda: existente ? (existente.ayuda ?? null) : null,
      motivos: existente ? existente.motivos.map((m) => m.explicacion).filter((t) => typeof t === "string" && t !== "") : [],
    },
    hayVarias,
  }
}
