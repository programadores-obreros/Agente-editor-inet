// Dos bordes del almacén que la auditoría de código del 2026-11-22 encontró
// ejecutándolo (NUC-07 y NUC-08; los dos reproducidos por QA).
//
// ── NUC-07 · EL TEMPORAL A MEDIO ESCRIBIR QUEDABA TIRADO ─────────────────────
//
// `guardar()` escribe un temporal y después lo renombra al destino. Si fallaba el
// RENAME, borraba el temporal. Si fallaba la ESCRITURA —el disco se llena a mitad—
// devolvía PERSIST_FAILED y dejaba `<id>.json.tmp-<pid>-<n>-<fecha>` en la carpeta de
// proyectos, para siempre: ni la falla siguiente ni un reintento que saliera bien lo
// limpiaban. El proyecto no se corrompía (el destino nunca se toca), pero la carpeta
// del docente juntaba basura cada vez que el disco se llenaba.
//
// POR QUÉ NO LO VEÍA tests/nucleo-almacen.test.mjs: su sistema de archivos falso, cuando
// «falla al escribir», no escribe NADA. Un disco que se llena escribe una parte y falla.
// El de acá hace eso.
//
// ── NUC-08 · UN COMENTARIO PROMETÍA UNA DEFENSA QUE EL CÓDIGO NO TIENE ───────
//
// El comentario largo de `guardar()` decía que si un escritor externo reescribía el
// archivo «con la MISMA revisión y contenido apenas distinto… esta defensa alcanza
// igual». No alcanza: la condición sólo rechaza cuando la REVISIÓN en disco no es la
// esperada. Con la revisión conservada, el commit siguiente pisa la edición externa
// sin avisar. El encabezado del archivo ya decía bien que detectar una modificación
// externa está fuera de Fase 1; el que mentía era el comentario. Se corrigió el
// COMENTARIO, no el comportamiento: cambiarlo es una decisión de diseño, no un arreglo.
// El test de abajo deja escrito lo que el código hace hoy, de los dos lados.
//
// CAPA PROTEGIDA. `opencode/nucleo/` es capa protegida en los documentos de esta línea.
// El owner la habilitó el 2026-11-22 para estos dos arreglos. Por eso este archivo es
// nuevo y no toca tests/nucleo-almacen.test.mjs, que también está protegido.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - sacar el `unlinkSync(temporal)` nuevo del catch de la escritura → rojo «no queda el temporal»
//   - dejar que una falla al limpiar se escape                        → rojo «si tampoco se puede borrar»
//   - volver a escribir «esta defensa alcanza igual» en el comentario → rojo «el comentario dice lo que hace»
//   - rechazar por contenido además de por revisión                   → rojo «misma revisión» (y avisa que cambió el diseño)
//
// LÍMITE HONESTO: el disco lleno es simulado (un fs que escribe 20 bytes y tira). No se
// provocó un ENOSPC real.
//
// Corre con: node --test tests/almacen-temporal-y-edicion-externa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const catalogo = construirCatalogoMinimoReal()

const proyecto = (id, revision = 0) => ({
  ...crearProyecto({ generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash }),
  revision,
})

/**
 * Un disco en memoria. `discoLleno`: la próxima escritura deja 20 bytes y tira, como un
 * disco que se queda sin lugar a mitad. `noSePuedeBorrar`: unlink tira.
 */
function disco() {
  const archivos = new Map()
  const d = {
    archivos,
    discoLleno: false,
    noSePuedeBorrar: false,
    existsSync: (p) => archivos.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, data) => {
      if (d.discoLleno) {
        archivos.set(p, String(data).slice(0, 20))
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })
      }
      archivos.set(p, data)
    },
    renameSync: (de, a) => {
      archivos.set(a, archivos.get(de))
      archivos.delete(de)
    },
    unlinkSync: (p) => {
      if (d.noSePuedeBorrar) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
      archivos.delete(p)
    },
    readFileSync: (p) => {
      if (!archivos.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      return archivos.get(p)
    },
  }
  return d
}
const temporales = (d) => [...d.archivos.keys()].filter((p) => p.includes(".tmp-"))

test("NUC-07: si la escritura falla a mitad, no queda el temporal parcial y el proyecto sigue intacto", () => {
  const d = disco()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs: d, catalogo })
  assert.equal(almacen.guardar(proyecto("p1", 0)).ok, true)
  const antes = d.archivos.get("/proyectos/p1.json")

  d.discoLleno = true
  const r = almacen.guardar(proyecto("p1", 1))
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
  assert.deepEqual(temporales(d), [], "quedó un temporal a medio escribir en la carpeta de proyectos")
  assert.equal(d.archivos.get("/proyectos/p1.json"), antes, "una escritura fallida tocó el proyecto guardado")

  // Contrapeso: con lugar de nuevo, guarda, y tampoco deja nada.
  d.discoLleno = false
  assert.equal(almacen.guardar(proyecto("p1", 1)).ok, true)
  assert.deepEqual(temporales(d), [])
  assert.deepEqual([...d.archivos.keys()], ["/proyectos/p1.json"])
})

test("NUC-07: si tampoco se puede borrar el temporal, igual contesta PERSIST_FAILED y no revienta", () => {
  const d = disco()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs: d, catalogo })
  d.discoLleno = true
  d.noSePuedeBorrar = true
  let r
  assert.doesNotThrow(() => { r = almacen.guardar(proyecto("p2", 0)) }, "una falla al limpiar se escapó: el motor recibiría una excepción en vez de un rechazo")
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
})

test("NUC-08: lo que el almacén detecta de una edición externa, y lo que no (y el comentario dice eso)", () => {
  // Lo que SÍ detecta: alguien cambió la revisión en disco.
  const d = disco()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs: d, catalogo })
  assert.equal(almacen.guardar(proyecto("p3", 0)).ok, true)
  assert.equal(almacen.guardar(proyecto("p3", 1)).ok, true)
  const enDisco = JSON.parse(d.archivos.get("/proyectos/p3.json"))
  d.archivos.set("/proyectos/p3.json", JSON.stringify({ ...enDisco, revision: 7 }))
  const conflicto = almacen.guardar(proyecto("p3", 2))
  assert.equal(conflicto.ok, false)
  assert.equal(conflicto.motivo.codigo, "CONFLICTO_REVISION_EN_ALMACEN", "una edición externa que cambia la revisión tiene que rechazarse")

  // Lo que NO detecta: misma revisión, otro contenido. El commit siguiente la pisa.
  const d2 = disco()
  const almacen2 = crearAlmacen({ directorio: "/proyectos", fs: d2, catalogo })
  assert.equal(almacen2.guardar(proyecto("p4", 0)).ok, true)
  assert.equal(almacen2.guardar(proyecto("p4", 1)).ok, true)
  const doc = JSON.parse(d2.archivos.get("/proyectos/p4.json"))
  assert.equal(doc.placa, null)
  d2.archivos.set("/proyectos/p4.json", JSON.stringify({ ...doc, placa: "esp32-devkit-v1" })) // a mano, misma revisión 1
  const pisa = almacen2.guardar(proyecto("p4", 2))
  assert.equal(pisa.ok, true,
    "el almacén empezó a rechazar una edición externa con la misma revisión: eso es un cambio de diseño (Fase 1 lo deja afuera). Si fue a propósito, actualizá este test y el comentario de guardar()")
  assert.equal(JSON.parse(d2.archivos.get("/proyectos/p4.json")).placa, null, "la edición externa sobrevivió: no es lo que hace hoy")

  // Y el comentario no promete lo contrario.
  const fuente = readFileSync(join(REPO, "opencode/nucleo/almacen.ts"), "utf8")
  assert.doesNotMatch(fuente, /esta defensa alcanza\s*(?:\n\s*\/\/\s*)?igual/, "el comentario de guardar() vuelve a decir que la defensa alcanza para una edición externa con la misma revisión")
  assert.match(fuente, /MISMA revisi[oó]n[\s\S]{0,400}NO (?:la|lo) detecta/, "el comentario ya no dice, con todas las letras, que una edición externa con la misma revisión no se detecta")
})
