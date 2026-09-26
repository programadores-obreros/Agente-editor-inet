// Validación nivel 2 — referencial, IR-interna, SIN catálogo. Gate 4.
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
  }
  return motivos
}
