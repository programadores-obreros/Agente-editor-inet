// Validación nivel 2 — referencial + forma numérica IR-interna, SIN catálogo. Gate 4.
//
// Distinto de las comprobaciones de `cargador.ts` (Gate 2, nivel 1: rechaza AL
// CARGAR, "REFERENCIA_ROTA_AL_CARGAR", nunca deja pasar un documento con esta forma
// de problema): esta función es una segunda línea de defensa, PURA, sobre cualquier
// `Proyecto` bien tipado — la va a reusar `motor.ts` (Gate 6) después de aplicar una
// operación, para confirmar que el aplicador no dejó una referencia colgando antes de
// pasar a `validar-tecnico.ts`. Código distinto a propósito
// (`REFERENCIA_INEXISTENTE`, no `REFERENCIA_ROTA_AL_CARGAR`): son dos momentos
// distintos según T_diseno_consolidado.md §5.2 ("distinción operación-tiempo vs.
// carga-tiempo").
//
// Phase 1.1 (hallazgo externo E1-03, CRÍTICO): además de referencias colgadas, esta
// función ahora también rechaza un `ComportamientoRegla.cuando.umbral.valor` que no
// sea `Number.isFinite` (NaN/±Infinity) — mismo criterio "segunda línea de defensa,
// SIN catálogo" que la parte referencial de arriba: corre sobre CUALQUIER `Proyecto`
// sin importar la puerta de entrada (loader, `proyectoInicial` armado a mano que
// bypasea `cargador.ts`, post-operación, revalidación). Código distinto a propósito
// del que usa `cargador.ts` (`UMBRAL_NO_FINITO_AL_CARGAR`), mismo criterio de
// distinción momento-de-carga vs. momento-de-operación que ya fija el párrafo de
// arriba para las referencias colgadas. Es RECHAZO, no representable: un valor no
// finito no es representable en el documento JSON persistido
// (`JSON.stringify(NaN)`/`JSON.stringify(Infinity)` → `null`, `canonico.ts`) — a
// diferencia de una capacidad/magnitud/unidad incompatible con el catálogo vigente
// (eso SÍ es representable, ver `validar-tecnico.ts`, categoría A del brief §8.1/§9.1).

import type { Proyecto } from "./ir.ts"
import type { Motivo } from "./motivos.ts"

export function validarEstructural(proyecto: Proyecto): readonly Motivo[] {
  const motivos: Motivo[] = []
  const idsComponentes = new Set(proyecto.componentes.map((c) => c.id))

  const refRota = (entidadTipo: "conexion" | "comportamiento", entidadId: string, componenteFaltante: string): Motivo => ({
    codigo: "REFERENCIA_INEXISTENTE",
    categoria: "referencial",
    severidad: "blocking",
    clasificacion: "rechazo",
    entidad: { tipo: entidadTipo, id: entidadId },
    datos: { componente: componenteFaltante },
  })

  for (const cx of proyecto.conexiones) {
    if (!idsComponentes.has(cx.desde.componente)) motivos.push(refRota("conexion", cx.id, cx.desde.componente))
    if (!idsComponentes.has(cx.hasta.componente)) motivos.push(refRota("conexion", cx.id, cx.hasta.componente))
  }
  for (const b of proyecto.comportamientos) {
    if (!idsComponentes.has(b.cuando.sensor)) motivos.push(refRota("comportamiento", b.id, b.cuando.sensor))
    if (!idsComponentes.has(b.entonces.actuador)) motivos.push(refRota("comportamiento", b.id, b.entonces.actuador))
    if (!Number.isFinite(b.cuando.umbral.valor)) {
      motivos.push({
        codigo: "UMBRAL_NO_FINITO",
        categoria: "estructural",
        severidad: "blocking",
        clasificacion: "rechazo",
        entidad: { tipo: "comportamiento", id: b.id },
        datos: { valor: String(b.cuando.umbral.valor) },
      })
    }
  }
  return motivos
}
