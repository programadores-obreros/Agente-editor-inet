// Generabilidad: qué placas, componentes, capacidades y acciones llegan HOY a un programa
// compilable por el camino canónico. Es una consulta de sólo lectura, para que el agente
// planifique antes de armar el proyecto.
//
// No es conocimiento nuevo ni una tabla aparte: compone, para cada placa y tipo del catálogo,
// los MISMOS pasos del gate de `generarPrograma` (`programa.ts`):
//   - paso 2: `admitirPlaca` y `admisionDeTipoEnPlaca` (la autoridad es `conocimiento/admision.ts`);
//   - paso 3: `resolverLectura` (protocolo declarado en Component Knowledge → registro de backends
//     de `protocolos.ts`, o topología) y `resolverEscritura` (complemento declarado + topología).
// Si cambia una revisión eléctrica, una lectura declarada o un backend, esto cambia solo.
//
// Es GUÍA, nunca autorización: el Project Engine, la admisión y `generarPrograma` vuelven a
// validar todo y siguen fallando cerrado. Lo que esto no mira (pines concretos, readiness del
// proyecto, Multi-Rule Safety) lo decide el gate final.
//
// Puro: sin I/O ni reloj.

import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { admitirPlaca, REVISIONES_DEL_ANEXO, type RevisionesElectricas } from "../conocimiento/admision.ts"
import type { BackendDeProtocolo } from "./protocolos.ts"
import { BACKENDS_DE_PROTOCOLO } from "./protocolos.ts"
import { admisionDeTipoEnPlaca, resolverEscritura, resolverLectura, type CodigoErrorCodegen } from "./programa.ts"

export interface OpcionesGenerabilidad {
  /** Revisiones eléctricas a consultar; por defecto, el anexo (las mismas que usa `generarPrograma`). */
  readonly revisiones?: RevisionesElectricas
  /** Backends de lectura por protocolo; por defecto, los de `protocolos.ts`. */
  readonly protocolos?: Readonly<Record<string, BackendDeProtocolo>>
}

export interface PlacaGenerable {
  readonly placa: string
  /** Admisión oficial de la placa (paso 2 del gate). */
  readonly admitida: boolean
  readonly problemas: readonly string[]
}

export interface AdmisionEnPlaca {
  readonly placa: string
  /** El tipo tiene admisión oficial Y revisión eléctrica humana para esta placa (paso 2 del gate). */
  readonly admitido: boolean
  readonly problemas: readonly string[]
}

export interface SoporteDelBackend {
  readonly soportada: boolean
  /** Si no está soportada, el mismo `CODEGEN_*` que devolvería `programa`. */
  readonly codigo: CodigoErrorCodegen | null
  readonly datos: Readonly<Record<string, unknown>> | null
}

export interface CapacidadGenerable {
  readonly capacidad: string
  /** El backend sabe leerla: `mecanismo` "protocolo" (con su `protocolo`) o "nivel" (topología). */
  readonly lectura: SoporteDelBackend & { readonly mecanismo: "protocolo" | "nivel" | null; readonly protocolo: string | null }
  /** Placas donde esta capacidad llega hoy a un programa compilable. */
  readonly generableEn: readonly string[]
}

export interface AccionGenerable {
  readonly accion: string
  readonly escritura: SoporteDelBackend
  /** Placas donde esta acción (y su reposo) llega hoy a un programa compilable. */
  readonly generableEn: readonly string[]
}

export interface ComponenteGenerable {
  readonly tipo: string
  readonly porPlaca: readonly AdmisionEnPlaca[]
  readonly capacidades: readonly CapacidadGenerable[]
  readonly acciones: readonly AccionGenerable[]
  /** Placas donde el tipo entra a un programa compilable: admitido en la placa y, si mide o actúa,
   * con al menos una capacidad o acción soportada por el backend. */
  readonly generableEn: readonly string[]
}

export interface Generabilidad {
  readonly placas: readonly PlacaGenerable[]
  readonly componentes: readonly ComponenteGenerable[]
}

const soportada = (): SoporteDelBackend => ({ soportada: true, codigo: null, datos: null })

export function generabilidad(conocimiento: ComponentKnowledge, opciones: OpcionesGenerabilidad = {}): Generabilidad {
  const revisiones = opciones.revisiones ?? REVISIONES_DEL_ANEXO
  const backends = opciones.protocolos ?? BACKENDS_DE_PROTOCOLO
  const catalogo = conocimiento.catalogo

  const placas: PlacaGenerable[] = catalogo.placas.map((p) => {
    const informe = admitirPlaca(conocimiento, p.id, revisiones)
    return { placa: p.id, admitida: informe.officiallySupported, problemas: [...informe.problemas] }
  })
  const placasAdmitidas = placas.filter((p) => p.admitida).map((p) => p.placa)

  const componentes: ComponenteGenerable[] = catalogo.componentes.map((componente) => {
    const porPlaca: AdmisionEnPlaca[] = catalogo.placas.map((p) => {
      const admision = admisionDeTipoEnPlaca(conocimiento, componente.id, p.id, revisiones)
      return { placa: p.id, admitido: admision.admitido, problemas: [...admision.problemas] }
    })
    // Placas donde el tipo pasa el paso 2 entero (la placa y el tipo en esa placa).
    const admitidoEn = porPlaca.filter((a) => a.admitido && placasAdmitidas.includes(a.placa)).map((a) => a.placa)

    const capacidades: CapacidadGenerable[] = componente.capacidades.map((capacidad) => {
      const r = resolverLectura(conocimiento, componente, capacidad, backends)
      const lectura = r.ok
        ? { ...soportada(), mecanismo: r.valor.kind, protocolo: r.valor.kind === "protocolo" ? r.valor.protocolo : null }
        : { soportada: false, codigo: r.falla.codigo, datos: r.falla.datos, mecanismo: null, protocolo: null }
      return { capacidad: capacidad.id, lectura, generableEn: lectura.soportada ? admitidoEn : [] }
    })

    const acciones: AccionGenerable[] = (componente.acciones ?? []).map((accion) => {
      const r = resolverEscritura(componente, accion)
      const escritura: SoporteDelBackend = r.ok ? soportada() : { soportada: false, codigo: r.falla.codigo, datos: r.falla.datos }
      return { accion, escritura, generableEn: escritura.soportada ? admitidoEn : [] }
    })

    // Un pasivo (sin capacidades ni acciones) entra si está admitido. Uno que mide o actúa, sólo
    // si el backend soporta algo de lo que hace.
    const hace = capacidades.length + acciones.length > 0
    const algoSoportado = capacidades.some((c) => c.lectura.soportada) || acciones.some((a) => a.escritura.soportada)
    return { tipo: componente.id, porPlaca, capacidades, acciones, generableEn: !hace || algoSoportado ? admitidoEn : [] }
  })

  return { placas, componentes }
}
