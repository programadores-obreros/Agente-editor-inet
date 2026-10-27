// ============================================================================
// Tecnia Bot — caché LRU chica para el plugin tecnia-idioma.
//
// El transform del plugin recorre TODO el historial en cada paso de cada
// turno, así que el mismo texto se limpia decenas de veces. Esta caché guarda
// el resultado con dos topes: cantidad de entradas y caracteres en total (una
// charla de horas no puede hacer crecer la memoria sin fin). Al llenarse se va
// la entrada usada hace MÁS tiempo, no toda la caché: vaciarla entera hacía
// que cada paso después del tope volviera a calcular todo.
//
// Vive en idioma/ (y no en tecnia-idioma.ts) para poder probarla sola: el
// archivo del plugin sólo puede exportar `default` (ver su encabezado).
// ============================================================================

export interface CacheLRU<V> {
  get(clave: string): V | undefined
  set(clave: string, valor: V, peso: number): void
  readonly size: number
  readonly peso: number
}

export function crearCache<V>(maxEntradas: number, maxPeso: number): CacheLRU<V> {
  const m = new Map<string, { v: V; peso: number }>()
  let total = 0
  return {
    get(clave) {
      const hit = m.get(clave)
      if (!hit) return undefined
      // Al final del Map = usada hace poco.
      m.delete(clave)
      m.set(clave, hit)
      return hit.v
    },
    set(clave, valor, peso) {
      const previo = m.get(clave)
      if (previo) {
        m.delete(clave)
        total -= previo.peso
      }
      if (peso > maxPeso) return
      while (m.size > 0 && (m.size >= maxEntradas || total + peso > maxPeso)) {
        const [vieja, v] = m.entries().next().value!
        m.delete(vieja)
        total -= v.peso
      }
      m.set(clave, { v: valor, peso })
      total += peso
    },
    get size() {
      return m.size
    },
    get peso() {
      return total
    },
  }
}
