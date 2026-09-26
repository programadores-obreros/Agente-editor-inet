// Gate 2 — IR mínima + schema + loader de "Programación por Intención".
//
// POR QUÉ EXISTE. `opencode/nucleo/cargador.ts` es el único punto de entrada para
// convertir un documento persistido (o recién creado) en un `Proyecto` de la IR. Nivel
// 1 (§ estructuralmente representable, T_diseno_consolidado.md §1/§6): nunca conoce el
// catálogo (eso es Gate 3/4), sólo la FORMA del documento — campos, tipos, ids únicos,
// referencias internas sin colgar. Un documento corrupto o no interpretable se
// RECHAZA completo: nunca un objeto parcial (R2, cierra el "Riesgo #3" que el diseño
// de C había dejado abierto).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { cargarProyecto, crearProyecto, SCHEMA_VERSION_SOPORTADA } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

// ─────────────────────────────────── fixtures ─────────────────────────────────────────

// Generador de id determinista para no depender de crypto.randomUUID en los tests.
let contadorIdProyecto = 0
const generadorIdDeterminista = () => `proy-test-${contadorIdProyecto++}`
const ahoraFijo = () => "2026-01-01T00:00:00.000Z"

function proyectoValidoBase() {
  return crearProyecto({
    generadorId: generadorIdDeterminista,
    ahora: ahoraFijo,
    catalogoVersion: "1.0.0",
    catalogoHash: "hash-de-prueba",
  })
}

// Documento crudo (plain object, como si viniera de JSON.parse) con 2 componentes,
// 1 conexión y 1 comportamiento, todo referenciando ids que SÍ existen — la base
// "sana" que cada test de rechazo desvía en UN solo punto.
function documentoValido() {
  return {
    id: "proy-doc-1",
    schemaVersion: SCHEMA_VERSION_SOPORTADA,
    catalogoVersion: "1.0.0",
    catalogoHash: "hash-de-prueba",
    revision: 0,
    siguienteIdLocal: 3,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} },
    ],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } }],
    comportamientos: [
      {
        id: "beh-0",
        cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } },
        entonces: { actuador: "cmp-0", accion: "encender" },
      },
    ],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
}

// ─────────────────────────────────── 1. schemaVersion soportada ───────────────────────

test("schemaVersion-soportada-carga", () => {
  const r = cargarProyecto(documentoValido())
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.schemaVersion, SCHEMA_VERSION_SOPORTADA)
  assert.equal(r.proyecto.componentes.length, 2)
})

// ─────────────────────────────── 2. schemaVersion futura rechaza ──────────────────────

test("schemaVersion-futura-rechaza-sin-proyecto-parcial", () => {
  const doc = { ...documentoValido(), schemaVersion: "2.0.0" }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "VERSION_SCHEMA_DESCONOCIDA")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

// ────────────────────────────── 3. falta campo requerido rechaza ─────────────────────

test("falta-campo-requerido-rechaza", () => {
  const doc = documentoValido()
  delete doc.revision
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CAMPO_REQUERIDO_FALTANTE")
  assert.ok(r.motivos[0].datos.campos.includes("revision"))
})

// ───────────────────────── 4. clave top-level desconocida rechaza (fail-closed) ───────

test("clave-top-level-desconocida-rechaza", () => {
  const doc = { ...documentoValido(), campoInventado: 42 }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
  assert.ok(r.motivos[0].datos.claves.includes("campoInventado"))
})

// ─────────────────────────── 5. id duplicado entre componentes rechaza ───────────────

test("id-duplicado-entre-componentes-rechaza", () => {
  const doc = documentoValido()
  doc.componentes[1].id = "cmp-0" // mismo id que componentes[0]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ID_DUPLICADO")
})

// ─────────────────── 6. referencia colgada (conexión/comportamiento) rechaza ─────────

test("referencia-colgada-en-conexion-rechaza", () => {
  const doc = documentoValido()
  doc.conexiones[0].hasta.componente = "cmp-no-existe"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_ROTA_AL_CARGAR")
})

test("referencia-colgada-en-comportamiento-rechaza", () => {
  // Extendido a comportamientos[] por R1 — ni B ni D lo habían cubierto porque C
  // excluía comportamientos de Fase 1; R1 lo reintroduce (T_diseno_consolidado.md §2.4).
  const doc = documentoValido()
  doc.comportamientos[0].entonces.actuador = "cmp-no-existe"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_ROTA_AL_CARGAR")
})

// ────────────────────────── 7. orden de array no afecta forma canónica ───────────────

test("orden-de-array-no-afecta-forma-canonica", () => {
  const docOrdenA = documentoValido()
  const docOrdenB = {
    ...docOrdenA,
    componentes: [...docOrdenA.componentes].reverse(),
  }
  const rA = cargarProyecto(docOrdenA)
  const rB = cargarProyecto(docOrdenB)
  assert.equal(rA.ok, true)
  assert.equal(rB.ok, true)
  assert.equal(canonicalizar(rA.proyecto), canonicalizar(rB.proyecto), "el orden de entrada del array no debe cambiar la forma canónica cargada")
})

test("documento-barajado: misma forma canónica Y cada entidad conserva su contenido intacto", () => {
  // Fixture con 3 componentes, 2 conexiones, 2 comportamientos — con 1 elemento por
  // array "orden-de-array-no-afecta-forma-canonica" ya alcanza, pero acá hace falta
  // más de uno por array para que "barajar" signifique algo real, y comportamientos
  // con umbral+unidad para probar que el CONTENIDO (no sólo el id) sobrevive intacto.
  const docOrdenado = {
    id: "proy-barajado",
    schemaVersion: SCHEMA_VERSION_SOPORTADA,
    catalogoVersion: "1.0.0",
    catalogoHash: "hash-de-prueba",
    revision: 0,
    siguienteIdLocal: 5,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} },
      { id: "cmp-2", tipo: "ntc", pines: { senal: "GPIO34" }, propiedades: { nota: "segundo sensor" } },
    ],
    conexiones: [
      { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } },
      { id: "conn-1", desde: { componente: "cmp-1", terminal: "senal" }, hasta: { componente: "cmp-2", terminal: "senal" } },
    ],
    comportamientos: [
      { id: "beh-0", cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } },
      { id: "beh-1", cuando: { sensor: "cmp-2", capacidad: "temperatura", comparador: "<=", umbral: { valor: 10.5, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "apagar" } },
    ],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const docBarajado = {
    ...docOrdenado,
    componentes: [docOrdenado.componentes[2], docOrdenado.componentes[0], docOrdenado.componentes[1]],
    conexiones: [docOrdenado.conexiones[1], docOrdenado.conexiones[0]],
    comportamientos: [docOrdenado.comportamientos[1], docOrdenado.comportamientos[0]],
  }

  const rOrdenado = cargarProyecto(docOrdenado)
  const rBarajado = cargarProyecto(docBarajado)
  assert.equal(rOrdenado.ok, true)
  assert.equal(rBarajado.ok, true)

  // 1. Misma forma canónica pase lo que pase el orden de entrada.
  assert.equal(canonicalizar(rOrdenado.proyecto), canonicalizar(rBarajado.proyecto))

  // 2. Cada entidad conserva su CONTENIDO exacto (no sólo el conjunto de ids): se
  // busca por id (no por posición) y se compara campo a campo, incluida la unidad
  // del umbral de comportamiento — lo que "orden de array no afecta forma canónica"
  // por sí solo no prueba (esa forma canónica podría coincidir por casualidad si
  // algo se mezclara mal entre entidades).
  const porId = (arr, id) => arr.find((x) => x.id === id)
  for (const id of ["cmp-0", "cmp-1", "cmp-2"]) {
    assert.deepEqual(porId(rBarajado.proyecto.componentes, id), porId(rOrdenado.proyecto.componentes, id), `componente ${id} debe conservar su contenido exacto`)
  }
  for (const id of ["conn-0", "conn-1"]) {
    assert.deepEqual(porId(rBarajado.proyecto.conexiones, id), porId(rOrdenado.proyecto.conexiones, id), `conexion ${id} debe conservar su contenido exacto`)
  }
  for (const id of ["beh-0", "beh-1"]) {
    const original = porId(rOrdenado.proyecto.comportamientos, id)
    const barajado = porId(rBarajado.proyecto.comportamientos, id)
    assert.deepEqual(barajado, original, `comportamiento ${id} debe conservar su contenido exacto`)
    assert.equal(barajado.cuando.umbral.unidad, original.cuando.umbral.unidad, "la unidad del umbral no se pierde ni se reinterpreta al reordenar")
  }
})

// ───────────────────────────────── 8. round-trip literal ─────────────────────────────

test("round-trip: canonicalizar(cargar(canonicalizar(p))) === canonicalizar(p)", () => {
  const p = proyectoValidoBase()
  const cadena1 = canonicalizar(p)
  const r = cargarProyecto(cadena1) // cargarProyecto acepta un string JSON directamente
  assert.equal(r.ok, true)
  const cadena2 = canonicalizar(r.proyecto)
  assert.equal(cadena2, cadena1)
})

test("load→save→load sin ninguna operación de por medio es un no-op real", () => {
  const doc = documentoValido()
  const r1 = cargarProyecto(doc)
  assert.equal(r1.ok, true)
  const cadena = canonicalizar(r1.proyecto)
  const r2 = cargarProyecto(cadena)
  assert.equal(r2.ok, true)
  assert.equal(canonicalizar(r2.proyecto), cadena)
})

// ─────────────────────────── extra: proyecto incompleto carga igual ──────────────────

test("proyecto-incompleto-carga", () => {
  const doc = {
    ...documentoValido(),
    placa: null,
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }],
    conexiones: [],
    comportamientos: [],
  }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true, "un proyecto incompleto (placa null, pin sin asignar) carga sin problema — la incompletitud es cosa de Gate 4")
  assert.equal(r.proyecto.placa, null)
})

// ─────────────────────────────── extra: JSON corrupto rechaza ───────────────────────

test("json-corrupto-rechaza", () => {
  const r = cargarProyecto("{ esto no es JSON valido ]")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "DOCUMENTO_MALFORMADO")
})

test("documento-no-es-un-objeto-rechaza", () => {
  for (const entrada of [null, 42, "texto plano", ["a", "b"]]) {
    const r = cargarProyecto(entrada)
    assert.equal(r.ok, false, `entrada ${JSON.stringify(entrada)} debe rechazar`)
    assert.equal(r.motivos[0].codigo, "DOCUMENTO_MALFORMADO")
  }
})

// ──────────────────── extra: tipo de catálogo desconocido NO es cosa del loader ──────

test("tipo-de-catalogo-desconocido-no-lo-rechaza-el-loader", () => {
  const doc = documentoValido()
  doc.componentes[0].tipo = "tipo-que-ningun-catalogo-reconoce"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true, "el loader no conoce el catálogo — CATALOGO_COMPONENTE_DESCONOCIDO es de validar-tecnico.ts (Gate 4)")
})

// ────────────────────── extra: deep-freeze / copias estructuradas ────────────────────

test("deep-freeze: el consumidor no puede mutar el proyecto cargado ni el recién creado", () => {
  const r = cargarProyecto(documentoValido())
  assert.equal(r.ok, true)
  assert.ok(Object.isFrozen(r.proyecto))
  assert.ok(Object.isFrozen(r.proyecto.componentes))
  assert.ok(Object.isFrozen(r.proyecto.componentes[0]))
  assert.throws(() => {
    "use strict"
    r.proyecto.revision = 999
  })

  const creado = proyectoValidoBase()
  assert.ok(Object.isFrozen(creado))
  assert.ok(Object.isFrozen(creado.componentes))
})

// ───────────────────────────────── extra: crearProyecto ──────────────────────────────

test("crearProyecto: estado inicial correcto", () => {
  const p = proyectoValidoBase()
  assert.equal(p.revision, 0)
  assert.equal(p.siguienteIdLocal, 0)
  assert.equal(p.placa, null)
  assert.deepEqual(p.componentes, [])
  assert.deepEqual(p.conexiones, [])
  assert.deepEqual(p.comportamientos, [])
  assert.equal(p.schemaVersion, SCHEMA_VERSION_SOPORTADA)
  assert.equal(p.metadata.creadoEn, "2026-01-01T00:00:00.000Z")
})
