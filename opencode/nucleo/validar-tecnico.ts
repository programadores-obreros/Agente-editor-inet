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
// finalmente cierto). El `valor` convertido que `propagarMagnitud` devolvería nunca
// REEMPLAZA el umbral del comportamiento del estudiante — esta validación sólo
// diagnostica, nunca muta ni reescribe nada en la IR (Phase 1.2 SÍ lo LEE, ver abajo,
// exclusivamente para comparar contra el rango — nunca para persistirlo).
//
// Phase 1.2 (hallazgo externo REA-02, MAYOR — re-auditoría externa AUD-C-02): un
// umbral con magnitud/unidad COMPATIBLE puede seguir siendo físicamente imposible
// para el sensor vigente (DHT22, rango [0,60]°C, umbral de 200°C) — antes de este
// fix, sólo `reemplazarSensor` (`catalogo.ts`, rama C, corrida ÚNICAMENTE durante
// `CambiarComponente`) lo diagnosticaba; el MISMO estado llegado por cualquier otra
// puerta (`SetComportamiento` directo, `proyectoInicial`, recarga) no tenía ningún
// aviso. Se cierra acá, en el mismo bucle continuo, reusando `estaFueraDeRango`
// (`catalogo.ts`) — el mismo chequeo que `reemplazarSensor` ya usaba, nunca una
// segunda regla divergente. WARNING (nunca `blocking`): Brief §8.1 ("se conserva el
// umbral/intención y se advierte") + §12.1 (`warning` no impide `ready`) — no afecta
// `derivarReadiness`. Ver `docs/programacion-intencion/IR-SPEC.md` §6.12.

import type { Proyecto, Componente } from "./ir.ts"
import type { Catalogo, ComponenteCatalogo, Cantidad, Magnitud, Unidad } from "./catalogo.ts"
import { asignarPin, evaluarRequisito, evaluarRestriccionesPin, propagarMagnitud, estaFueraDeRango } from "./catalogo.ts"
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
        // D1/D2/D3/D5/D7 (PHASE_2_SLICE_1_HARDENING_DESIGN.md §1-2): restricciones de
        // GPIO del pin ASIGNADO — mismo llamador que `asignarPin`, nunca la reemplaza
        // (la operación sigue sin rechazarse por esto, D11). `evaluarRestriccionesPin`
        // es terminal-aware por dato (`requierePullUpInterno`), nunca por `if GPIO<n>`.
        for (const restriccion of evaluarRestriccionesPin(terminal, pinReal)) {
          motivos.push({ ...restriccion, entidad: { tipo: "componente", id: componente.id } })
        }
      } else if (pinesDePlaca !== undefined) {
        // D10 (PIN_INEXISTENTE_EN_DOCUMENTO): la placa SÍ se reconoce (si no fuera
        // así, ya se reportó `PLACA_DESCONOCIDA_EN_DOCUMENTO` arriba y `pinesDePlaca`
        // sería `undefined`), pero este pin no existe en SU registro — por cualquier
        // camino (`SetPlaca` a otra placa con el pin ya asignado, o un documento
        // editado a mano en disco con un GPIO fuera del registro). Antes de este fix
        // este caso se salteaba en silencio (`if (pinReal)`, sin más) — mismo patrón
        // que `PLACA_DESCONOCIDA_EN_DOCUMENTO`: blocking, representable, el
        // componente NUNCA se borra, el proyecto carga, queda not-ready y editable.
        motivos.push({
          codigo: "PIN_INEXISTENTE_EN_DOCUMENTO",
          categoria: "tecnica",
          severidad: "blocking",
          clasificacion: "representable",
          entidad: { tipo: "componente", id: componente.id },
          datos: { pin: pinId, terminal: terminal.id, placa: proyecto.placa },
        })
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
      continue
    }

    // Phase 1.2 (hallazgo externo REA-02, MAYOR — re-auditoría externa AUD-C-02,
    // `PHASE_1_1_EXTERNAL_FINDINGS.md`): un `umbral` con la MISMA magnitud física y
    // una unidad compatible (`propagacion.ok`, arriba) puede seguir siendo
    // FÍSICAMENTE imposible para el sensor vigente — ej. un DHT22 (rango [0,60]°C)
    // con un umbral de 200°C. Antes de este fix, `reemplazarSensor` (`catalogo.ts`)
    // era el ÚNICO lugar que chequeaba esto (rama C, §8.1 del brief), y sólo en el
    // instante de la operación `CambiarComponente` — el mismo estado (mismo sensor,
    // mismo umbral, mismo rango) llegado por CUALQUIER OTRA puerta (`SetComportamiento`
    // directo, `proyectoInicial`, recarga desde disco) validaba SIN ningún aviso,
    // hasta `listo:true` (evidencia:
    // `reaudit/AUD-C/scripts/10_rango_sensor_deuda2.mjs`). Brief §8.1 ("rango
    // incompatible: se conserva el umbral/intención y se advierte, según el contrato
    // de validación aplicable, §12.1") y §12.1 (`warning` = "proyecto utilizable pero
    // requiere atención"; sólo `blocking` impide `ready`) — decisión del orquestador,
    // `DECISIONS.md`: esto es un WARNING DERIVADO DEL ESTADO, no del camino, y NUNCA
    // afecta `derivarReadiness` (que sólo mira `severidad === "blocking"`,
    // `validar.ts`). Reusa `estaFueraDeRango` (`catalogo.ts`) — el MISMO chequeo que
    // `reemplazarSensor` ya usaba, nunca una segunda regla — contra el `valor` YA
    // propagado a la unidad de la capacidad (`propagacion.valor`, la conversión
    // EXPLÍCITA que ya corrió arriba): si la unidad difiere, se compara DESPUÉS de
    // convertir, nunca comparando unidades distintas directo. El umbral del
    // comportamiento del estudiante NUNCA se toca (ni se clampa, ni se reinterpreta):
    // sólo se diagnostica, mismo criterio que `PIN_OCUPADO`/`MAGNITUD_INCOMPATIBLE`
    // de este mismo archivo.
    if (estaFueraDeRango(propagacion.valor.valor, capacidadReal.rango)) {
      motivos.push({
        codigo: "UMBRAL_FUERA_DE_RANGO",
        categoria: "tecnica",
        severidad: "warning",
        clasificacion: "representable",
        entidad: { tipo: "comportamiento", id: comportamiento.id },
        datos: { umbral: comportamiento.cuando.umbral.valor, unidad: comportamiento.cuando.umbral.unidad, rango: capacidadReal.rango },
      })
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
