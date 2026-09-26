// Generación de ids — Gate 2.
//
// Puro, sin I/O. `Proyecto.id` usa un generador INYECTABLE (default: `crypto.randomUUID`
// real, disponible en Node/Bun sin import — global `crypto`) para que los tests puedan
// ser deterministas sin mockear el runtime. Los ids locales (`cmp-<n>`, `conn-<n>`,
// `beh-<n>`) comparten un solo contador (`Proyecto.siguienteIdLocal`) para que un
// dry-run descartado (Gate 6) se lleve su propio incremento sin código extra — ver
// T_diseno_consolidado.md §2.2.

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
