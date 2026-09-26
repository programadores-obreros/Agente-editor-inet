// Forma canónica — Gate 2.
//
// Puro, sin I/O. `canonicalizar()` es la única fuente de verdad de "forma canónica":
// JSON con las claves de cada objeto ordenadas alfabéticamente y sin espacios — el
// mismo criterio que usa `catalogoHash` (Gate 3, R4) y que exige el round-trip
// `canonicalize(cargar(guardar(canonicalize(p))))===canonicalize(p)` (T_diseno_consolidado.md §7, G2).
//
// `canonicalizar()` en sí misma NO reordena arrays: sólo ordena las CLAVES de cada
// objeto, recursivamente, y preserva el orden de cualquier array tal como lo recibe.
//
// Eso es distinto de decir "el orden de entrada nunca cambia" — SÍ cambia, pero en
// `cargador.ts`, no acá: `cargarProyecto()` (cargador.ts:172-174) ordena
// `componentes`/`conexiones`/`comportamientos` por id local (`compararIdsLocales`,
// id.ts) ANTES de pasarle el `Proyecto` a `congelarProfundo`. El test
// "orden de array no afecta forma canónica" (G2) pasa por ESE reordenamiento
// explícito del loader, no porque `canonicalizar()` sea insensible al orden de
// array — si se le da la MISMA entrada con un array reordenado sin pasar por el
// loader, la forma canónica sale distinta, como corresponde a una función que
// preserva orden.

export function canonicalizar(valor: unknown): string {
  return JSON.stringify(ordenarClavesProfundo(valor))
}

function ordenarClavesProfundo(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClavesProfundo)
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const salida: Record<string, unknown> = {}
    for (const [clave, val] of entradas) salida[clave] = ordenarClavesProfundo(val)
    return salida
  }
  return valor
}

/** Copia estructurada profunda, independiente de `deepFreeze` — para que un consumidor
 * externo no pueda mutar el canónico en memoria del motor (Gate 6) a través de una
 * referencia compartida. */
export function clonarProfundo<T>(valor: T): T {
  return structuredClone(valor)
}

/** `Object.freeze` recursivo. Sobre un valor ya clonado (`clonarProfundo`) para que
 * congelar el borrador de un consumidor no congele, por referencia compartida, al
 * canónico real del motor. */
export function congelarProfundo<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const v of Object.values(valor as Record<string, unknown>)) congelarProfundo(v)
  }
  return valor
}
