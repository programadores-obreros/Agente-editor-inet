// Almacén — Gate 7. Implementa la interfaz `Almacen` de `motor.ts` (Gate 6 va antes
// en el orden de gates; esa interfaz se definió ahí para que el motor no dependiera
// de este archivo).
//
// Único archivo del núcleo, además de `adaptadores/hash-catalogo.node.ts` (Gate 3),
// que importa `node:fs` — y sólo como DEFAULT inyectable (`fs: FsLike`), nunca
// directo en la lógica: los tests inyectan un `fs` falso para simular fallas a mitad
// de escritura sin tocar disco real.
//
// El directorio SIEMPRE se inyecta (`DependenciasAlmacen.directorio`) — nunca
// `~/.config/opencode/tecnia-memoria.md` ni ninguna ruta fija: ese archivo es de
// `memoria.ts` (progreso pedagógico, otro subsistema, `CURRENT-ARCHITECTURE.md` §9),
// no del proyecto de "Programación por Intención".
//
// LÍMITES DOCUMENTADOS (no bugs, ver IR-SPEC.md/DECISIONS.md):
// - Sin `fsync`/`fdatasync`: la durabilidad ante corte de luz depende del FS/OS, igual
//   que el patrón ya existente en `memoria.ts`/`perfil.ts`/`clave.ts` (mismo criterio,
//   `CURRENT-ARCHITECTURE.md` §9).
// - `renameSync` en Windows sobre un archivo destino YA EXISTENTE puede fallar
//   distinto que en POSIX según el filesystem/permisos — no probado en este gate
//   (CI corre sólo Linux para `tests/*.test.mjs`, igual que el resto del repo).
// - Sin locks/mutex: modelo single-writer, igual criterio que `memoria.ts`.
// - `Almacen.list()` y detección de modificación externa quedan FUERA de Fase 1
//   (decisión del orquestador ya registrada en `DECISIONS.md`, Gate 1).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import type { Almacen, ResultadoCargaAlmacen, ResultadoGuardar } from "./motor.ts"
import { cargarProyecto } from "./cargador.ts"
import { canonicalizar } from "./canonico.ts"

export interface FsLike {
  existsSync(ruta: string): boolean
  mkdirSync(ruta: string, opciones?: { recursive?: boolean }): void
  writeFileSync(ruta: string, datos: string): void
  renameSync(desde: string, hasta: string): void
  unlinkSync(ruta: string): void
  readFileSync(ruta: string, codificacion: "utf8"): string
}

const fsReal: FsLike = { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync: (r) => readFileSync(r, "utf8") }

export interface DependenciasAlmacen {
  readonly directorio: string
  readonly catalogo: Catalogo
  readonly fs?: FsLike
}

let contadorTemp = 0

export function crearAlmacen(deps: DependenciasAlmacen): Almacen {
  const fs = deps.fs ?? fsReal
  fs.mkdirSync(deps.directorio, { recursive: true })

  function rutaFinal(id: string): string {
    return join(deps.directorio, `${id}.json`)
  }

  function guardar(proyecto: Proyecto): ResultadoGuardar {
    const destino = rutaFinal(proyecto.id)
    const temporal = `${destino}.tmp-${process.pid}-${contadorTemp++}-${Date.now()}`
    const contenido = canonicalizar(proyecto)

    try {
      fs.writeFileSync(temporal, contenido)
    } catch {
      return { ok: false, motivo: motivoPersistFailed("fallo al escribir el temporal") }
    }

    try {
      fs.renameSync(temporal, destino)
    } catch {
      try {
        fs.unlinkSync(temporal)
      } catch {
        // best-effort: si ni siquiera se puede limpiar el temporal, no hay más que
        // intentar acá — el archivo destino previo (si había uno) sigue intacto de
        // todas formas, porque el rename nunca llegó a tocarlo.
      }
      return { ok: false, motivo: motivoPersistFailed("fallo al renombrar el temporal al destino") }
    }

    return { ok: true }
  }

  function cargar(id: string): ResultadoCargaAlmacen {
    const ruta = rutaFinal(id)
    if (!fs.existsSync(ruta)) {
      return { ok: false, motivos: [{ codigo: "PROYECTO_INEXISTENTE", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo", datos: { id } }] }
    }
    let contenido: string
    try {
      contenido = fs.readFileSync(ruta, "utf8")
    } catch {
      return { ok: false, motivos: [{ codigo: "DOCUMENTO_MALFORMADO", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo", datos: { razon: "no se pudo leer el archivo" } }] }
    }

    const resultado = cargarProyecto(contenido)
    if (!resultado.ok) return resultado

    // Version-skew (R11/R2): el catálogo activo cambió desde que se guardó — se
    // AVISA, nunca se muta el proyecto ni se rechaza la carga.
    if (resultado.proyecto.catalogoHash !== deps.catalogo.hash) {
      const diagnostico: Motivo[] = [
        {
          codigo: "CATALOGO_CAMBIO_DETECTADO",
          categoria: "almacen",
          severidad: "info",
          datos: { catalogoHashGuardado: resultado.proyecto.catalogoHash, catalogoHashActivo: deps.catalogo.hash },
        },
      ]
      return { ok: true, proyecto: resultado.proyecto, diagnostico }
    }
    return resultado
  }

  function existeProyecto(id: string): boolean {
    return fs.existsSync(rutaFinal(id))
  }

  return { guardar, cargar, existe: existeProyecto }
}

function motivoPersistFailed(razon: string): Motivo {
  return { codigo: "PERSIST_FAILED", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo", datos: { razon } }
}
