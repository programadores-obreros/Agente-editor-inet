// Invariantes estructurales de `Conexion` — Phase 1.1, hallazgo externo E2-01 (CRÍTICO,
// PHASE_1_EXTERNAL_FINDINGS.md).
//
// "Sin auto-conexión (self-loop) / sin conexión duplicada" NO era un invariante
// estructural real de la IR — sólo existía como chequeo ad-hoc DENTRO de
// `aplicarConectar` (`operaciones.ts`). Ni `cargarProyecto()` ni `validarProyecto()`
// lo verificaban jamás: un documento con self-loop y/o conexión duplicada, cargado
// directo o empujado como `proyectoInicial` (bypaseando `Conectar` por completo),
// llegaba a `listo:true` sin ningún diagnóstico — topología eléctricamente imposible,
// sin motivo (evidencia/e2/exp1b_selfloop_listo_true.mjs,
// exp5_motor_acepta_selfloop_inicial.mjs).
//
// Definición de "misma conexión" (decisión con evidencia, NO semántica nueva): el tipo
// `Conexion`/`ExtremoConexion` (`ir.ts`) no distingue dirección — `desde`/`hasta` son
// etiquetas de posición del payload, no polaridad eléctrica — y el código YA vigente
// ANTES de Phase 1.1 (`mismoPar` en `operaciones.ts`, más el test explícito
// "conectar-duplicada-rechaza" — "el MISMO par, aunque en orden invertido, ya está
// conectado", `tests/nucleo-operaciones.test.mjs`) ya trataba A→B y B→A como la MISMA
// conexión. Las funciones de acá EXTRAEN esa regla para reusarla en todas las puertas
// de entrada, nunca la reinventan ni la endurecen.
//
// UNA sola implementación, reusada por `operaciones.ts` (defensa temprana de la
// operación, categoría `operacion`), `cargador.ts` (Gate 2, momento de carga,
// `*_AL_CARGAR`) y `validar-estructural.ts` (Gate 4, SIN catálogo — corre en
// `validarProyecto`, así que se ejercita en TODA puerta que produzca un `Proyecto`:
// loader, `proyectoInicial`/construcción del motor, post-commit, revalidación) — nunca
// una copia divergente. Mismo criterio que `id.ts` (`analizarIdsLocales`) ya establece
// para el hallazgo E1-01/E1-02: acá se expone el ANÁLISIS puro (ids afectados), cada
// puerta arma su propio `Motivo` con el código que le corresponde por contrato (ver
// `docs/programacion-intencion/IR-SPEC.md` §6.3).

import type { Conexion, ExtremoConexion } from "./ir.ts"

/** Mismo componente Y mismo terminal en los dos extremos: un terminal no puede
 * conectarse consigo mismo (eléctricamente imposible). */
export function esAutoconexion(desde: ExtremoConexion, hasta: ExtremoConexion): boolean {
  return desde.componente === hasta.componente && desde.terminal === hasta.terminal
}

interface ParDeExtremos {
  readonly desde: ExtremoConexion
  readonly hasta: ExtremoConexion
}

/** Mismo PAR de extremos sin importar el orden — A→B y B→A son la MISMA conexión (ver
 * nota de alcance arriba: decisión YA vigente, sólo extraída acá). Comparación por
 * conjunto de 2 elementos, no por igualdad posicional de `desde`/`hasta`. */
export function mismaConexion(a: ParDeExtremos, b: ParDeExtremos): boolean {
  const clave = (e: ExtremoConexion) => `${e.componente}:${e.terminal}`
  const parA = new Set([clave(a.desde), clave(a.hasta)])
  const parB = new Set([clave(b.desde), clave(b.hasta)])
  if (parA.size !== parB.size) return false
  for (const x of parA) if (!parB.has(x)) return false
  return true
}

export interface AnalisisConexiones {
  /** ids de conexiones que son self-loop (mismo componente+terminal en ambos extremos). */
  readonly autoconexiones: readonly string[]
  /** ids de conexiones que son duplicado exacto (mismo par, sin importar orden) de OTRA
   * conexión que aparece ANTES en el array recibido — la primera aparición de un par
   * nunca se reporta a sí misma, sólo las repeticiones posteriores. */
  readonly duplicadas: readonly string[]
}

/**
 * Analiza un array de `Conexion` (ya validadas en forma/referencia por quien llama) y
 * devuelve qué ids son self-loop y cuáles son duplicado de una conexión anterior. Pura
 * — no construye `Motivo`: cada puerta (`cargador.ts`/`validar-estructural.ts`) usa su
 * propio código según el momento (mismo criterio que `REFERENCIA_ROTA_AL_CARGAR` vs.
 * `REFERENCIA_INEXISTENTE`, `IR-SPEC.md` §7).
 */
export function analizarConexionesInvalidas(conexiones: readonly Conexion[]): AnalisisConexiones {
  const autoconexiones: string[] = []
  const duplicadas: string[] = []
  const vistas: Conexion[] = []
  for (const cx of conexiones) {
    if (esAutoconexion(cx.desde, cx.hasta)) autoconexiones.push(cx.id)
    if (vistas.some((v) => mismaConexion(v, cx))) duplicadas.push(cx.id)
    vistas.push(cx)
  }
  return { autoconexiones, duplicadas }
}
