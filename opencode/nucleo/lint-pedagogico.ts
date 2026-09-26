// Lint pedagógico — paralelo a validar.ts, NUNCA en la cadena de commit. Gate 4.
//
// Fase 1: passthrough vacío (T_diseno_consolidado.md §6: "lintPedagogico, nunca
// blocking, Fase 1 = []"). El módulo existe y se prueba desde el día uno para fijar
// el invariante que Gate 4+ no puede violar cuando le agregue reglas reales: nunca
// `severidad: "blocking"`, nunca gatea `listo`/`invalido` (eso es `validar.ts`).

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"

export function lintPedagogico(_proyecto: Proyecto, _catalogo: Catalogo): readonly Motivo[] {
  return []
}
