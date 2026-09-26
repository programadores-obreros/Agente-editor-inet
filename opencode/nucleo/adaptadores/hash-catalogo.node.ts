// Único import de `node:crypto` de todo `opencode/nucleo/` (R4, T_diseno_consolidado.md §4.2).
//
// El core (`catalogo.ts`) es puro y nunca importa `node:crypto`: recibe el hasher
// INYECTADO como `(texto: string) => string`. Este archivo es el ÚNICO lugar donde se
// decide CÓMO se hashea (sha256 hex) — precedente real ya en el repo:
// `pieza-sensor-shield.test.mjs:18,341` usa `createHash("sha256")` sin agregar
// dependencia nueva.

import { createHash } from "node:crypto"
import { construirCatalogo, type Catalogo } from "../catalogo.ts"
import { COMPONENTES_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, PLACAS_CATALOGO_MINIMO, VERSION_CATALOGO_MINIMO } from "../catalogo-datos.ts"

export const sha256Hex = (texto: string): string => createHash("sha256").update(texto).digest("hex")

/** Conveniencia para consumidores reales (tests incluidos): el catálogo mínimo
 * shippeado, con el hash sha256 real ya calculado. */
export function construirCatalogoMinimoReal(): Catalogo {
  return construirCatalogo(
    {
      version: VERSION_CATALOGO_MINIMO,
      componentes: COMPONENTES_CATALOGO_MINIMO,
      placas: PLACAS_CATALOGO_MINIMO,
      unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS },
    },
    sha256Hex,
  )
}
