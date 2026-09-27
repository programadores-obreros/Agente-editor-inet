// Validación niveles 3-4 — hardware + componente, CON catálogo. Gate 4.
//
// Reusa las reglas genéricas de `catalogo.ts` (`asignarPin`, `evaluarRequisito`) —
// nunca reimplementa el despacho por tipo/rol acá. Un componente/placa con `tipo`/id
// que el catálogo ACTIVO ya no reconoce es REPRESENTABLE (R2): nunca se borra el
// componente, nunca se rechaza la operación completa — el motivo viaja al lado.
//
// Phase 1.1 (hallazgo externo E1-03, CRÍTICO): este archivo nunca miraba
// `proyecto.comportamientos` — un `ComportamientoRegla` con una `capacidad` que el
// catálogo VIGENTE ya no reconoce para ese sensor, o con `umbral.magnitud`/`unidad`
// que no coinciden con la capacidad real, quedaba SIN diagnóstico (hasta
// `listo:true`) sin importar por qué puerta entró (loader, `proyectoInicial`,
// revalidación con otro catálogo — `validarTecnico`/`validarProyecto` corren igual
// en las tres). Brief §8.1 clasifica "capability incompatible" como REPRESENTABLE
// (categoría A, §9.1): el comportamiento NUNCA se borra ni se reescribe acá (P8
// sigue diferida, sin resolver) — sólo se diagnostica, mismo criterio que
// `PIN_OCUPADO` de más abajo. Reusa `propagarMagnitud` (ya auditada, SIN cambios)
// como el ORÁCULO de compatibilidad magnitud/unidad — la misma regla que
// `reemplazarSensor`/`CambiarComponente` ya asumían que corría acá (`catalogo.ts`,
// comentario de `reemplazarSensor` sobre el cast de `cuando.umbral`, ahora
// finalmente cierto). El `valor` convertido que `propagarMagnitud` devolvería NUNCA
// se usa acá: esta validación sólo diagnostica, no muta ni reemplaza el umbral del
// comportamiento del estudiante.

import type { Proyecto, Componente } from "./ir.ts"
import type { Catalogo, ComponenteCatalogo, Cantidad, Magnitud, Unidad } from "./catalogo.ts"
import { asignarPin, evaluarRequisito, propagarMagnitud } from "./catalogo.ts"
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

  // Phase 1.1 (hallazgo externo E1-03): capacidad/magnitud/unidad de cada
  // `ComportamientoRegla` contra el catálogo VIGENTE. Si el sensor no existe o su
  // `tipo` no tiene definición de catálogo, ya se reportó arriba (referencial /
  // `CATALOGO_COMPONENTE_DESCONOCIDO`) — acá sólo se salta, nunca se duplica.
  for (const comportamiento of proyecto.comportamientos) {
    const sensor = proyecto.componentes.find((c) => c.id === comportamiento.cuando.sensor)
    if (!sensor) continue
    const compCatalogoSensor = catalogo.obtenerComponente(sensor.tipo)
    if (!compCatalogoSensor) continue

    const capacidadReal = compCatalogoSensor.capacidades.find((cap) => cap.id === comportamiento.cuando.capacidad)
    if (!capacidadReal) {
      motivos.push({
        codigo: "CAPACIDAD_INEXISTENTE_EN_CATALOGO",
        categoria: "tecnica",
        severidad: "blocking",
        clasificacion: "representable",
        entidad: { tipo: "comportamiento", id: comportamiento.id },
        datos: { sensor: sensor.id, tipo: sensor.tipo, capacidad: comportamiento.cuando.capacidad },
      })
      continue
    }

    // Capacidades sin `magnitud`/`unidad` declaradas (ej. algunas booleanas puras)
    // no tienen nada dimensional que comparar — se usa el propio umbral como
    // "destino" en ese caso, lo que hace que `propagarMagnitud` compare consigo
    // mismo y nunca reporte incompatibilidad por un dato que el catálogo no exige.
    const magnitudDestino = (capacidadReal.magnitud ?? comportamiento.cuando.umbral.magnitud) as Magnitud
    const unidadDestino = (capacidadReal.unidad ?? comportamiento.cuando.umbral.unidad) as Unidad
    const propagacion = propagarMagnitud(comportamiento.cuando.umbral as Cantidad, magnitudDestino, unidadDestino, catalogo)
    // Sólo importa la incompatibilidad (`!ok`): un `ok:true` — aunque haya requerido
    // conversión — significa que el umbral SIGUE siendo representable contra esta
    // capacidad; el `valor`/motivo `UNIDAD_CONVERTIDA` que devolvería no aplica acá
    // (nada se está convirtiendo de verdad, sólo diagnosticando) y se descarta.
    if (!propagacion.ok) {
      motivos.push({ ...propagacion.motivo, entidad: { tipo: "comportamiento", id: comportamiento.id } })
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
