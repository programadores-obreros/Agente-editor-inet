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
//
// Phase 1.1 (hallazgo externo E2-01, CRÍTICO): "sin auto-conexión (self-loop) / sin
// conexión duplicada" antes SÓLO existía como chequeo ad-hoc dentro de
// `aplicarConectar` (`operaciones.ts`) — nunca llegaba a `validarProyecto`, así que un
// `proyectoInicial` armado a mano (o cualquier `Proyecto` que bypasee la operación)
// quedaba con topología eléctricamente imposible sin ningún diagnóstico, hasta
// `listo:true` (evidencia/e2/exp5_motor_acepta_selfloop_inicial.mjs). Se cierra acá
// con la MISMA implementación (`conexion.ts`, `analizarConexionesInvalidas`) que
// reusan `cargador.ts` (Gate 2, momento de carga, códigos `*_AL_CARGAR`) y
// `operaciones.ts` (defensa temprana de la operación, categoría `operacion`) — nunca
// una copia divergente. Corre acá con los mismos códigos que `operaciones.ts` ya
// usaba (`AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA`), categoría `estructural` en vez
// de `operacion`: mismo criterio que `UMBRAL_NO_FINITO` de arriba (mismo código, dos
// categorías según quién lo emite, IR-SPEC.md §6.2/§6.3).

import type { Proyecto } from "./ir.ts"
import type { Motivo } from "./motivos.ts"
import { analizarConexionesInvalidas } from "./conexion.ts"

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

  // Phase 1.1 (hallazgo externo E2-01, CRÍTICO) — ver nota de arriba: corre sobre
  // TODO el array de conexiones, no dentro del loop de referencias de arriba (una
  // conexión con referencia colgada además self-loop/duplicada reporta AMBOS motivos,
  // nunca se pisan entre sí).
  const analisisConexiones = analizarConexionesInvalidas(proyecto.conexiones)
  for (const idAutoconexion of analisisConexiones.autoconexiones) {
    motivos.push({ codigo: "AUTOCONEXION_INVALIDA", categoria: "estructural", severidad: "blocking", clasificacion: "rechazo", entidad: { tipo: "conexion", id: idAutoconexion } })
  }
  for (const idDuplicada of analisisConexiones.duplicadas) {
    motivos.push({ codigo: "CONEXION_DUPLICADA", categoria: "estructural", severidad: "blocking", clasificacion: "rechazo", entidad: { tipo: "conexion", id: idDuplicada } })
  }
  // Phase 3 (B2): una regla parcial sólo se chequea en lo que tiene presente.
  for (const b of proyecto.comportamientos) {
    const sensor = b.cuando?.sensor
    if (sensor !== undefined && !idsComponentes.has(sensor)) motivos.push(refRota("comportamiento", b.id, sensor))
    const actuador = b.entonces?.actuador
    if (actuador !== undefined && !idsComponentes.has(actuador)) motivos.push(refRota("comportamiento", b.id, actuador))
    const umbral = b.cuando?.umbral
    if (umbral !== undefined && !Number.isFinite(umbral.valor)) {
      motivos.push({
        codigo: "UMBRAL_NO_FINITO",
        categoria: "estructural",
        severidad: "blocking",
        clasificacion: "rechazo",
        entidad: { tipo: "comportamiento", id: b.id },
        datos: { valor: String(umbral.valor) },
      })
    }
  }
  return motivos
}
