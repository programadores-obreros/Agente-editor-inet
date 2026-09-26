// Forma canónica — Gate 2.
//
// Puro, sin I/O. `canonicalizar()` es la única fuente de verdad de "forma canónica":
// JSON con las claves de cada objeto ordenadas alfabéticamente y sin espacios — el
// mismo criterio que usa `catalogoHash` (Gate 3, R4) y que exige el round-trip
// `canonicalize(cargar(guardar(canonicalize(p))))===canonicalize(p)` (T_diseno_consolidado.md §7, G2).
//
// El ORDEN de un array (`componentes[]`, `conexiones[]`, etc.) NO se reordena acá: la
// forma canónica ordena CLAVES de objeto, nunca reordena arrays — el test
// "orden de array no afecta forma canónica" (G2) se satisface porque el motor/loader
// nunca reordena los arrays de entrada por su cuenta (la IR ya sale en el orden que el
// documento trae), no porque canonicalizar() los reordene.

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
