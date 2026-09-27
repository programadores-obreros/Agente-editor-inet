// Generación de ids — Gate 2.
//
// Puro, sin I/O. `Proyecto.id` usa un generador INYECTABLE (default: `crypto.randomUUID`
// real, disponible en Node/Bun sin import — global `crypto`) para que los tests puedan
// ser deterministas sin mockear el runtime. Los ids locales (`cmp-<n>`, `conn-<n>`,
// `beh-<n>`) comparten un solo contador (`Proyecto.siguienteIdLocal`) para que un
// dry-run descartado (Gate 6) se lleve su propio incremento sin código extra — ver
// T_diseno_consolidado.md §2.2.

import type { ComportamientoRegla, Componente, Conexion } from "./ir.ts"
import type { Motivo } from "./motivos.ts"

export type GeneradorIdProyecto = () => string

/** Default de producción: UUID real. Los tests inyectan uno determinista. */
export const generarIdProyectoAleatorio: GeneradorIdProyecto = () => crypto.randomUUID()

export type PrefijoIdLocal = "cmp" | "conn" | "beh"

/** Formato puro: "cmp-3", "conn-0", "beh-12". Nunca decide EL número — sólo lo formatea. */
export function formatearIdLocal(prefijo: PrefijoIdLocal, n: number): string {
  return `${prefijo}-${n}`
}

/**
 * Orden ESTABLE de ids locales por su número (no por orden de aparición ni
 * lexicográfico puro: "cmp-2" < "cmp-10" numéricamente, aunque "cmp-10" < "cmp-2"
 * como string). Ningún id de la IR tiene identidad posicional (a diferencia de
 * `circuito.ts`, donde `id=tipo+índice` SÍ es posicional) — por eso el loader
 * (Gate 2) puede reordenar por esto sin cambiar el significado del proyecto.
 */
export function compararIdsLocales(a: string, b: string): number {
  const na = extraerNumeroFinal(a)
  const nb = extraerNumeroFinal(b)
  if (na !== null && nb !== null && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

function extraerNumeroFinal(id: string): number | null {
  const m = /-(\d+)$/.exec(id)
  if (!m) return null
  const grupo = m[1]
  return grupo === undefined ? null : Number(grupo)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgos externos E1-01/E1-02 (PHASE_1_EXTERNAL_FINDINGS.md).
//
// `cargarProyecto()` (Gate 2) validaba que `siguienteIdLocal` fuera un entero >= 0,
// pero nunca que fuera MAYOR que cualquier id local ya presente en el documento — y
// sólo comparaba ids duplicados DENTRO de `componentes[]`, nunca entre `conexiones[]`
// ni `comportamientos[]`. Las dos reglas de abajo son la ÚNICA implementación de
// ambos chequeos — reusada por `cargador.ts` (Gate 2) y por la construcción de
// `crearMotorDeProyecto` (Gate 6, `motor.ts`), nunca copiada.
//
// Nota de alcance (decisión Phase 1.1, con evidencia): la unicidad de id acá es
// exacta por STRING sobre el conjunto combinado cmp+conn+beh — no exige además que el
// NÚMERO de sufijo sea disjunto entre tipos (ej. "cmp-0" y "conn-0" coexistiendo no se
// rechaza por sí solo). Aunque `id.ts`/IR-SPEC.md §2 describen un único contador
// compartido, docenas de fixtures de test YA establecidas (`documentoValido()` en
// `tests/nucleo-ir-cargador.test.mjs`, entre otras) usan intencionalmente cmp-0/
// conn-0/beh-0 simultáneos como documento VÁLIDO — ese es el estado real y probado
// del contrato, no una aspiración. La colisión de STRING exacto (imposible entre
// prefijos distintos) y la consistencia del CONTADOR (que sí exige ser mayor al
// máximo número entre TODOS los tipos combinados, sin importar cuál building lo emitió
// — ver `contadorEsConsistente` abajo) alcanzan para cerrar los dos hallazgos sin
// romper esa convención ya establecida.
export interface AnalisisIdsLocales {
  /** ids que aparecen 2+ veces en el conjunto combinado (string exacto). */
  readonly duplicados: readonly string[]
  /** mayor número de sufijo "-<n>" encontrado entre TODOS los ids combinados, o
   * `null` si el conjunto está vacío o ninguno matchea el patrón. */
  readonly maximoNumero: number | null
}

export function analizarIdsLocales(ids: readonly string[]): AnalisisIdsLocales {
  const vistos = new Set<string>()
  const duplicados = new Set<string>()
  let maximoNumero: number | null = null
  for (const id of ids) {
    if (vistos.has(id)) duplicados.add(id)
    vistos.add(id)
    const n = extraerNumeroFinal(id)
    if (n !== null) maximoNumero = maximoNumero === null ? n : Math.max(maximoNumero, n)
  }
  return { duplicados: [...duplicados], maximoNumero }
}

/**
 * El contador nunca puede dejar que la PRÓXIMA generación de id local (cualquiera de
 * los 3 aplicadores que lo usan — `AgregarComponente`/`Conectar`/`SetComportamiento`,
 * `operaciones.ts`) reproduzca un id ya asignado: tiene que ser ESTRICTAMENTE mayor
 * que el número más alto ya usado, sin importar de qué tipo de entidad era ese id
 * (comparten un único contador — IR-SPEC.md §2). `maximoNumero: null` (sin ids
 * numerados todavía) es trivialmente consistente.
 */
export function contadorEsConsistente(siguienteIdLocal: number, maximoNumero: number | null): boolean {
  return maximoNumero === null || siguienteIdLocal > maximoNumero
}

interface ProyectoConIds {
  readonly componentes: readonly Componente[]
  readonly conexiones: readonly Conexion[]
  readonly comportamientos: readonly ComportamientoRegla[]
  readonly siguienteIdLocal: number
}

/**
 * Regla compartida de Phase 1.1: `cargarProyecto()` (Gate 2, documentos externos) y
 * `crearMotorDeProyecto({ proyectoInicial })` (Gate 6, cualquier otro camino que
 * bypasee el loader — IR-SPEC.md §6) la corren IGUAL, un solo lugar. Deliberadamente
 * NO se agrega al pipeline continuo de `validar-estructural.ts`/`validarProyecto`
 * (que corre también después de cada commit, Gate 4): esa validación corre sobre
 * CUALQUIER `Proyecto`, incluidos fixtures de test armados a mano que no pretenden
 * simular el contador real (`tests/nucleo-validacion.test.mjs`) — una vez consistente
 * al construirse, el contador se mantiene consistente por inducción, porque los 3
 * aplicadores que generan un id local sólo lo INCREMENTAN, nunca lo decrementan (ver
 * M22, regresión en `tests/nucleo-operaciones.test.mjs`).
 */
export function validarIdsYContador(proyecto: ProyectoConIds): readonly Motivo[] {
  const motivos: Motivo[] = []
  const todosLosIds = [...proyecto.componentes.map((c) => c.id), ...proyecto.conexiones.map((cx) => cx.id), ...proyecto.comportamientos.map((b) => b.id)]
  const analisis = analizarIdsLocales(todosLosIds)

  if (analisis.duplicados.length > 0) {
    motivos.push({ codigo: "ID_DUPLICADO", categoria: "estructural", severidad: "blocking", clasificacion: "rechazo", datos: { ids: analisis.duplicados } })
  }
  if (!contadorEsConsistente(proyecto.siguienteIdLocal, analisis.maximoNumero)) {
    motivos.push({
      codigo: "CONTADOR_ID_INCONSISTENTE",
      categoria: "estructural",
      severidad: "blocking",
      clasificacion: "rechazo",
      datos: { siguienteIdLocal: proyecto.siguienteIdLocal, maximoNumeroExistente: analisis.maximoNumero },
    })
  }
  return motivos
}
