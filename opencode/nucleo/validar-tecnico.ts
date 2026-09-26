// Validación niveles 3-4 — hardware + componente, CON catálogo. Gate 4.
//
// Reusa las reglas genéricas de `catalogo.ts` (`asignarPin`, `evaluarRequisito`) —
// nunca reimplementa el despacho por tipo/rol acá. Un componente/placa con `tipo`/id
// que el catálogo ACTIVO ya no reconoce es REPRESENTABLE (R2): nunca se borra el
// componente, nunca se rechaza la operación completa — el motivo viaja al lado.

import type { Proyecto, Componente } from "./ir.ts"
import type { Catalogo, ComponenteCatalogo } from "./catalogo.ts"
import { asignarPin, evaluarRequisito } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"

export function validarTecnico(proyecto: Proyecto, catalogo: Catalogo): readonly Motivo[] {
  const motivos: Motivo[] = []

  if (proyecto.placa !== null && !catalogo.tienePlaca(proyecto.placa)) {
    motivos.push({
      codigo: "PLACA_DESCONOCIDA_EN_DOCUMENTO",
      categoria: "tecnica",
      severidad: "blocking",
      clasificacion: "representable",
      entidad: { tipo: "placa", id: proyecto.placa },
      datos: { placa: proyecto.placa },
    })
  }

  const pinesDePlaca = proyecto.placa ? catalogo.pinesDePlaca(proyecto.placa) : undefined
  const ocupacionPines = new Map<string, string>() // pinId → primer componente.id que lo tomó

  for (const componente of proyecto.componentes) {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    if (!compCatalogo) {
      motivos.push({
        codigo: "CATALOGO_COMPONENTE_DESCONOCIDO",
        categoria: "tecnica",
        severidad: "blocking",
        clasificacion: "representable",
        entidad: { tipo: "componente", id: componente.id },
        datos: { tipo: componente.tipo },
      })
      continue // sin definición de catálogo no hay terminales/requisitos que chequear
    }

    for (const terminal of compCatalogo.terminales) {
      const pinId = componente.pines[terminal.id]
      if (pinId === null || pinId === undefined) continue // incompleto — eso es readiness, no acá
      if (terminal.electrica === "riel-fijo") continue // no ocupa un pin de la placa

      const yaOcupadoPor = ocupacionPines.get(pinId)
      if (yaOcupadoPor !== undefined && yaOcupadoPor !== componente.id) {
        motivos.push({
          codigo: "PIN_OCUPADO",
          categoria: "tecnica",
          severidad: "blocking",
          clasificacion: "representable",
          entidad: { tipo: "componente", id: componente.id },
          datos: { pin: pinId, ocupadoPor: yaOcupadoPor },
        })
      } else {
        ocupacionPines.set(pinId, componente.id)
      }

      const pinReal = pinesDePlaca?.find((p) => p.id === pinId)
      if (pinReal) {
        const incompatible = asignarPin(terminal, pinReal)
        if (incompatible) motivos.push({ ...incompatible, entidad: { tipo: "componente", id: componente.id } })
      }
    }

    const conectadosPorTerminal = resolverConectadosPorTerminal(proyecto, componente, compCatalogo)
    for (const m of evaluarRequisito(compCatalogo, conectadosPorTerminal)) {
      motivos.push(m.entidad ? m : { ...m, entidad: { tipo: "componente", id: componente.id } })
    }
  }

  return motivos
}

/** Para cada terminal de `componente`, qué TIPOS de catálogo tiene conectados
 * (`evaluarRequisito` es una regla pura que no camina la IR — esto es lo que le arma
 * el insumo). */
function resolverConectadosPorTerminal(proyecto: Proyecto, componente: Componente, _compCatalogo: ComponenteCatalogo): Readonly<Record<string, readonly string[]>> {
  const resultado: Record<string, string[]> = {}
  const agregar = (terminal: string, otroComponenteId: string) => {
    const otro = proyecto.componentes.find((c) => c.id === otroComponenteId)
    if (!otro) return
    ;(resultado[terminal] ??= []).push(otro.tipo)
  }
  for (const cx of proyecto.conexiones) {
    if (cx.desde.componente === componente.id) agregar(cx.desde.terminal, cx.hasta.componente)
    if (cx.hasta.componente === componente.id) agregar(cx.hasta.terminal, cx.desde.componente)
  }
  return resultado
}
