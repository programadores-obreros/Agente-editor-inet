// ANEXO DE PROCEDENCIA — Component System Foundation #1 (D-09 del Decision Freeze).
//
// Todo asset distribuido que respalda la representación de una pieza tiene un registro
// acá. Lo que no se sabe se escribe UNKNOWN; no se inventa. Un asset sin registro no
// puede respaldar el flag de soporte de ninguna pieza (D-13).

import { ASSET_POR_ELEMENTO } from "./representacion.ts"

export interface RegistroProcedencia {
  readonly assetId: string
  readonly kind: "bundle" | "svg" | "dataset"
  readonly fuente: { readonly nombre: string; readonly url?: string; readonly version: string; readonly sha256: string }
  readonly licencia: { readonly spdx: string; readonly atribucion?: string; readonly notas?: string }
  /** Revisión HUMANA (nunca "auto"). */
  readonly revisadoPor: string
}

export const PROCEDENCIA: readonly RegistroProcedencia[] = [
  {
    assetId: "wokwi-elements-bundle",
    kind: "bundle",
    fuente: {
      nombre: "@wokwi/elements (bundle vendorizado: opencode/tecniabot-web/wokwi-bundle.js)",
      url: "https://github.com/wokwi/wokwi-elements",
      // Ver opencode/tecniabot-web/WOKWI-VERSION.md: no hay tarball, tag ni build
      // registrados. Pendiente LEGAL-PROVENANCE CHECK (ON-08 del Decision Freeze).
      version: "UNKNOWN",
      sha256: "4f860e9035b680c6f1fc73acf24be7f22877662d29558fd8fafb1f5347b1a06d",
    },
    licencia: {
      spdx: "MIT",
      atribucion: "opencode/tecniabot-web/LICENSE-wokwi-elements",
      notas: "Embebe Lit 3.3.x (BSD-3-Clause) sin LICENSE propio en el repo; pendiente (ON-08).",
    },
    revisadoPor: "revisión humana del Engineering Baseline 2026 (commit 57b6de5, WOKWI-VERSION.md)",
  },
  // CK-CG2: piezas dibujadas por Tecnia Bot (SVG propio, estilo Wokwi) para lo que el bundle no
  // trae. El sha256 es el del archivo tal como se commitea: cambiar el dibujo obliga a actualizar
  // este registro a propósito (igual que el bundle). Licencia: la del repo (package.json).
  {
    assetId: "tecnia-piezas-propias",
    kind: "svg",
    fuente: {
      nombre: "piezas propias de Tecnia Bot (opencode/tecniabot-web/piezas-tecnia.js)",
      version: "CK-CG2 (2026-10-12)",
      sha256: "95803cbcab5dd979caa873d27d1c4553617c53ca79bf0e09096c98afdd9528d7",
    },
    licencia: { spdx: "GPL-3.0-or-later", atribucion: "LICENSE (raíz del repo)" },
    revisadoPor: "revisión humana de Alejandro Palestrini (Design Gate DHT11, opción A: pieza propia <pb-dht11>, 2026-10-12)",
  },
]

/**
 * Qué asset respalda la representación de un ELEMENTO: los `wokwi-*` salen del bundle
 * vendorizado; una pieza propia (CK-CG2, `ASSET_POR_ELEMENTO` en `representacion.ts`) tiene su
 * propio registro. Sin elemento (o sin entrada), el bundle, como antes de CK-CG2.
 */
export function assetDeRepresentacionWokwi(elemento?: string): string {
  return (elemento !== undefined ? ASSET_POR_ELEMENTO[elemento] : undefined) ?? "wokwi-elements-bundle"
}

export function procedenciaDe(assetId: string): RegistroProcedencia | undefined {
  return PROCEDENCIA.find((r) => r.assetId === assetId)
}
