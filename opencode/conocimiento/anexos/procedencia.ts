// ANEXO DE PROCEDENCIA — Component System Foundation #1 (D-09 del Decision Freeze).
//
// Todo asset distribuido que respalda la representación de una pieza tiene un registro
// acá. Lo que no se sabe se escribe UNKNOWN; no se inventa. Un asset sin registro no
// puede respaldar el flag de soporte de ninguna pieza (D-13).

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
]

/** Qué asset respalda cada representación Wokwi: todas salen del mismo bundle. */
export function assetDeRepresentacionWokwi(): string {
  return "wokwi-elements-bundle"
}

export function procedenciaDe(assetId: string): RegistroProcedencia | undefined {
  return PROCEDENCIA.find((r) => r.assetId === assetId)
}
