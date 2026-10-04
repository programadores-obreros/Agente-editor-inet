// DR-03 (Engineering Baseline 2026) — contrato de identidad de catálogo. Nació ROJO A
// PROPÓSITO (preservado fuera del repo, SHA-256 7350c15b…aa63, en el baseline 4c22c23)
// y volvió VERDE con Component System Foundation #1 (D-03 del Decision Freeze). Las
// aserciones son las mismas del rojo original; sólo cambiaron este encabezado y el
// nombre del test.
//
// EL INVARIANTE (lo único que este archivo decide):
//   Un cambio de catálogo nunca puede reinterpretar en silencio un proyecto existente.
//   Si el proyecto se guardó con un catálogo y se reabre con otro, ese desfase tiene que
//   quedar OBSERVABLE en la frontera pública (el snapshot del servicio).
//
// QUÉ NO DECIDE (queda para el Decision Freeze): qué entra en el hash, si los anexos de
// representación/pedagogía lo afectan, createdWith vs validatedWith, cuándo se
// refresca, migración vs revalidación, el texto de la UI, qué hace el agente, ni la
// forma exacta de la señal (motivo, flag, metadato, readiness...). Por eso la aserción
// roja no exige ningún código ni campo: sólo que la identidad del catálogo ACTIVO
// aparezca en algún lado del snapshot, porque sin ella el desfase no se puede ver.
//
// POR QUÉ ERA ROJO. `almacen.ts` SÍ detectaba el desfase y devolvía
// `CATALOGO_CAMBIO_DETECTADO` con los dos hashes; `composicion-raiz.ts`
// (`construirProyectoInicial`) devolvía `cargado.proyecto` y descartaba
// `cargado.diagnostico`; el `Snapshot` sólo exponía el hash GUARDADO. Hoy el diagnóstico
// llega a `validacion.motivos` y el snapshot expone `catalogoActivo`. En la auditoría
// del baseline, además, escribir un hash falso al crear el proyecto no rompía ningún
// test (`phase2-snapshot.test.mjs` sólo pide que sea un string).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

const CATALOGO_ACTIVO = construirCatalogoMinimoReal()
// Un hash que no es el del catálogo activo: representa "este proyecto se guardó con
// OTRO catálogo". Es un fixture controlado (mismo formato que un sha256), no un
// documento roto: el cargador lo acepta y el resto del proyecto es válido.
const HASH_DE_OTRO_CATALOGO = "0".repeat(64)

/** Crea un proyecto real por el camino de producción, lo persiste con una operación y
 * lo cierra. Si `hashGuardado` es distinto del activo, reescribe SÓLO ese campo en el
 * documento guardado, como si se hubiera creado con otro catálogo. */
function proyectoGuardadoCon(hashGuardado) {
  const directorio = nuevoDir("dr03-catalogo-hash")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  const r = servicio.aplicar({ idOperacion: "dr03-op", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
  assert.equal(r.ok, true, `fixture: la operación tiene que persistir el proyecto: ${JSON.stringify(r)}`)
  servicio.cerrar()

  const ruta = join(directorio, `${idProyecto}.json`)
  const documento = JSON.parse(readFileSync(ruta, "utf8"))
  assert.equal(documento.catalogoHash, CATALOGO_ACTIVO.hash, "fixture: un proyecto nuevo se guarda con el hash del catálogo activo")
  if (hashGuardado !== CATALOGO_ACTIVO.hash) writeFileSync(ruta, JSON.stringify({ ...documento, catalogoHash: hashGuardado }))
  return { directorio, idProyecto }
}

test("DR-03 control: la capa de persistencia SÍ detecta que el proyecto se guardó con otro catálogo", () => {
  const { directorio, idProyecto } = proyectoGuardadoCon(HASH_DE_OTRO_CATALOGO)
  const cargado = crearAlmacen({ directorio, catalogo: CATALOGO_ACTIVO }).cargar(idProyecto)

  assert.equal(cargado.ok, true, "un desfase de catálogo se avisa; nunca rechaza la carga ni muta el proyecto")
  const aviso = cargado.diagnostico?.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
  assert.ok(aviso, `almacen.cargar tiene que avisar el desfase: ${JSON.stringify(cargado.diagnostico)}`)
  assert.equal(aviso.datos.catalogoHashGuardado, HASH_DE_OTRO_CATALOGO)
  assert.equal(aviso.datos.catalogoHashActivo, CATALOGO_ACTIVO.hash)
})

test("DR-03 (contrato): al reabrir un proyecto guardado con OTRO catálogo, el desfase sigue siendo observable en el snapshot", () => {
  const { directorio, idProyecto } = proyectoGuardadoCon(HASH_DE_OTRO_CATALOGO)
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const snapshot = servicio.snapshot()
    assert.equal(snapshot.catalogoHash, HASH_DE_OTRO_CATALOGO, "fixture: el proyecto reabierto conserva el hash con el que se guardó (no se muta en silencio)")
    assert.ok(
      JSON.stringify(snapshot).includes(CATALOGO_ACTIVO.hash),
      "DR-03: el proyecto se guardó con otro catálogo y se reabrió con el activo, pero el snapshot no dice contra qué catálogo se está interpretando: " +
        "la identidad del catálogo activo no aparece en ningún lado, así que el desfase que almacen.cargar detectó se perdió en la composición " +
        "(composicion-raiz.ts::construirProyectoInicial descarta `cargado.diagnostico`).",
    )
  } finally {
    servicio.cerrar()
  }
})
