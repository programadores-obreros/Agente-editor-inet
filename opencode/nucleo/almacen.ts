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

/**
 * Construye el puerto de persistencia contra disco. Phase 1.1 (hallazgo externo
 * E3-04b, MAJOR — `DECISIONS.md`, entrada "Almacen es un puerto interno del
 * composition root", `motor.ts` tiene el mismo aviso sobre la interfaz `Almacen`):
 * el consumidor construye ESTE almacén UNA vez y lo inyecta a
 * `crearMotorDeProyecto({ almacen })` — no lo retiene para llamar `guardar()`/
 * `cargar()` por su cuenta. El `MotorDeProyecto` es la única autoridad de mutación
 * (brief §9.4/§10); usar esta misma instancia como una segunda vía de escritura,
 * aunque el type-checker no lo impida, es un uso NO CONTRACTUAL.
 */
export function crearAlmacen(deps: DependenciasAlmacen): Almacen {
  const fs = deps.fs ?? fsReal
  fs.mkdirSync(deps.directorio, { recursive: true })

  function rutaFinal(id: string): string {
    return join(deps.directorio, `${id}.json`)
  }

  function guardar(proyecto: Proyecto): ResultadoGuardar {
    const destino = rutaFinal(proyecto.id)
    const contenido = canonicalizar(proyecto)

    // Phase 1.1 (hallazgo externo E3-07, MAJOR, evidencia/e3/scripts/
    // e1_motor_flujo.mjs TEST 4 — resolución humana de Phase 1.1, brief §21: fix
    // mínimo con la identidad de proyecto/revisión que YA existe, sin base de datos,
    // sin locks distribuidos, sin fusión automática de escrituras concurrentes, sin
    // servidor): dos motores con el MISMO almacén y MISMO id de
    // proyecto partían de revisión 0 en memoria cada uno, y el segundo commit pisaba
    // SILENCIOSAMENTE al primero en disco — ninguno de los dos vio al otro, porque
    // `baseRevision` (E3-01) sólo se contrasta contra el CANÓNICO EN MEMORIA de CADA
    // motor, nunca contra lo que hay en disco bajo ese id.
    //
    // Compare-and-swap sobre la REVISIÓN, nunca un lock: el motor SIEMPRE commitea
    // N -> N+1 (`motor.ts`, `ejecutarLote`) — si YA existe un documento en disco bajo
    // este id, su revisión tiene que ser EXACTAMENTE `proyecto.revision - 1` (el
    // estado que ESTE llamador cree que acaba de reemplazar). Si no coincide, otro
    // escritor con un punto de partida que este llamador nunca vio ya escribió acá
    // — brief §33 ("no hay lost update silencioso"), extendido de "dentro de un
    // motor" (E3-01) a "entre motores que comparten almacén y id" (E3-07).
    //
    // Excepción deliberada: un re-guardado CANÓNICAMENTE IDÉNTICO al que ya está en
    // disco se permite igual — no hay pérdida posible, y es exactamente el caso que
    // ya cubre "idempotencia-load-save-load-no-op-byte-a-byte"
    // (`tests/nucleo-almacen.test.mjs`): cargar lo persistido y re-guardarlo sin
    // tocar nada sigue siendo un no-op, no una "colisión".
    //
    // Límite conocido, documentado (no un descuido): la detección es por REVISIÓN,
    // no por contenido — si dos documentos DISTINTOS con el mismo id coincidieran en
    // la MISMA revisión sin ser canónicamente idénticos, esto los distingue bien
    // (rechaza), pero si un escritor externo reescribiera el archivo con la MISMA
    // revisión y contenido apenas distinto de forma maliciosa, esta defensa alcanza
    // igual (revisión no coincide con la esperada O contenido no es idéntico) — el
    // único caso que esta defensa NO cubre es una modificación externa que preserve
    // tanto la revisión N esperada COMO el contenido exacto, lo cual no tiene sentido
    // como "colisión" real. Ver `DECISIONS.md` (nota agregada a las dos entradas
    // "fuera de Fase 1" — esto NO reabre `Almacen.list()` ni una detección GENERAL de
    // modificación externa: el alcance es sólo la colisión de escritura por id).
    if (fs.existsSync(destino)) {
      let contenidoExistente: string
      try {
        contenidoExistente = fs.readFileSync(destino, "utf8")
      } catch {
        return { ok: false, motivo: motivoPersistFailed("no se pudo leer el documento existente para verificar la revision (fail-closed, E3-07)") }
      }
      const resultadoExistente = cargarProyecto(contenidoExistente)
      if (!resultadoExistente.ok) {
        return { ok: false, motivo: motivoPersistFailed("el documento existente no se pudo interpretar para verificar la revision (fail-closed, E3-07)") }
      }
      const esReguardadoIdentico = canonicalizar(resultadoExistente.proyecto) === contenido
      if (!esReguardadoIdentico && resultadoExistente.proyecto.revision !== proyecto.revision - 1) {
        return {
          ok: false,
          motivo: {
            codigo: "CONFLICTO_REVISION_EN_ALMACEN",
            categoria: "almacen",
            severidad: "blocking",
            clasificacion: "rechazo",
            datos: { id: proyecto.id, revisionEnDisco: resultadoExistente.proyecto.revision, revisionEsperadaEnDisco: proyecto.revision - 1, revisionAGuardar: proyecto.revision },
          },
        }
      }
    }

    const temporal = `${destino}.tmp-${process.pid}-${contadorTemp++}-${Date.now()}`

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

    // Phase 1.1 (hallazgo externo E3-08, barato — integridad del mismo almacén, no
    // detección de modificación externa): `cargar(id)` leía el archivo `<id>.json` y
    // confiaba en que su `Proyecto.id` interno coincidiera con el `id` PEDIDO, sin
    // verificarlo — un documento escrito/movido/copiado a la ruta equivocada (un bug
    // de escritura, o un archivo tocado a mano) cargaba igual bajo una identidad que
    // no era la suya. Mismo criterio fail-closed que el resto de Gate 7: rechazo
    // estructurado ANTES de devolver el documento, nunca "repararlo" reasignando el id
    // en silencio.
    if (resultado.proyecto.id !== id) {
      return {
        ok: false,
        motivos: [{ codigo: "ID_DOCUMENTO_NO_COINCIDE", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo", datos: { idPedido: id, idDelDocumento: resultado.proyecto.id } }],
      }
    }

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
