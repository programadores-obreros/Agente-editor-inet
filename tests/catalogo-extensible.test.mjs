// Guardias GENÉRICAS de extensibilidad del catálogo — Component Knowledge D0 (canario "sólo
// datos"). Ninguna nombra un componente: valen para todos los tipos del catálogo, hoy y
// después.
//
// 1. Sin ramas por id: el código de producción fuera de los DATOS declarativos (los datos del
//    catálogo y los anexos de conocimiento) no contiene literales de string iguales a un id de
//    componente (`tipo === "x"`, `case "x"`, listas de ids). Excepciones PREVIAS, con conteo
//    fijo para que no crezcan: el legado congelado `tool/circuito.ts` (D-07) y el valor por
//    defecto de `evaluarRequisito` en `nucleo/catalogo.ts` (Gate 3).
// 2. Ningún módulo de producción fuera de los datos importa una constante de componente
//    (`LED`, `PULSADOR`, …) de `nucleo/catalogo-datos.ts`.
// 3. El runner de escenarios no contiene ids de componente.
// 4. Un proyecto creado con la identidad fijada ANTERIOR del catálogo (`CATALOGO_FIJADO.anterior`)
//    recarga sin migración, conserva su `createdWith` (también después de un commit) y muestra
//    `CATALOGO_CAMBIO_DETECTADO` (info, no bloqueante).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto } from "./phase2-helpers.mjs"

const { CATALOGO_ACTIVO } = await import(join(REPO, "opencode/nucleo/catalogo-activo.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const IDS = new Set(CATALOGO_ACTIVO.componentes.map((c) => c.id))

/** Módulos de DATOS declarativos: acá los ids de componente son legítimos. */
const DATOS = [/^opencode\/nucleo\/catalogo-datos\.ts$/, /^opencode\/conocimiento\/anexos\//]
/** Excepciones previas a D0, con conteo exacto por id. */
const EXCEPCIONES = {
  "opencode/tool/circuito.ts": "legado congelado (D-07)",
  "opencode/nucleo/catalogo.ts": { resistencia: 1 }, // `evaluarRequisito`: tipo por defecto de `resistencia-serie` (Gate 3)
}

function archivosDeProduccion() {
  const salida = []
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (nombre === "node_modules" || nombre === "skills") continue
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (/\.(ts|tsx|js|mjs)$/.test(nombre) && !/wokwi-bundle\.js$|blockly/.test(nombre)) salida.push(ruta)
    }
  }
  recorrer(join(REPO, "opencode"))
  return salida.sort()
}

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")

/** Literales de string (sin comentarios) iguales a un id de componente, contados por id. */
function idsLiterales(fuente) {
  const conteo = {}
  for (const m of sinComentarios(fuente).matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (IDS.has(m[2])) conteo[m[2]] = (conteo[m[2]] ?? 0) + 1
  return conteo
}

test("extensible (estático): ningún módulo de producción fuera de los datos ramifica por id de componente", () => {
  const hallazgos = {}
  for (const ruta of archivosDeProduccion()) {
    const rel = relative(REPO, ruta)
    if (DATOS.some((r) => r.test(rel))) continue
    if (typeof EXCEPCIONES[rel] === "string") continue
    const conteo = idsLiterales(readFileSync(ruta, "utf8"))
    if (Object.keys(conteo).length > 0) hallazgos[rel] = conteo
  }
  const esperado = Object.fromEntries(Object.entries(EXCEPCIONES).filter(([, v]) => typeof v !== "string"))
  assert.deepEqual(hallazgos, esperado)
})

test("extensible (estático): ningún módulo de producción fuera de los datos importa una constante de componente", () => {
  const constantes = [...IDS].map((id) => id.toUpperCase().replace(/-/g, "_"))
  const patron = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b(${constantes.join("|")})\\b[^}]*\\}\\s*from\\s*["'][^"']*catalogo-datos`)
  const culpables = archivosDeProduccion()
    .map((ruta) => relative(REPO, ruta))
    .filter((rel) => !DATOS.some((r) => r.test(rel)) && patron.test(sinComentarios(readFileSync(join(REPO, rel), "utf8"))))
  assert.deepEqual(culpables, [])
})

test("extensible (estático): el runner genérico de escenarios no contiene ids de componente", () => {
  assert.deepEqual(idsLiterales(readFileSync(join(REPO, "tests/componentes-escenarios.test.mjs"), "utf8")), {})
})

let opId = 0
const sobre = (servicio, tipo, payload) => ({ idOperacion: `extensible-op-${opId++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })

test("extensible: un proyecto creado con la identidad ANTERIOR recarga, conserva createdWith y ve CATALOGO_CAMBIO_DETECTADO", () => {
  const { anterior } = CATALOGO_FIJADO
  assert.notEqual(anterior.hash, CATALOGO_ACTIVO.hash, "la identidad anterior es otra")
  const directorio = nuevoDir("extensible-anterior")
  const idProyecto = nuevoIdProyecto("extensible-anterior")
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  for (const [tipo, payload] of [
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: CATALOGO_ACTIVO.componentes[0].id }],
  ]) assert.equal(servicio.aplicar(sobre(servicio, tipo, payload)).ok, true, tipo)
  servicio.cerrar()
  const ruta = join(directorio, `${idProyecto}.json`)
  // Documento tal como lo habría escrito el catálogo anterior: sólo cambia createdWith.
  writeFileSync(ruta, JSON.stringify({ ...JSON.parse(readFileSync(ruta, "utf8")), catalogoVersion: anterior.version, catalogoHash: anterior.hash }))

  const recargado = obtenerServicioDeProyecto({ directorio, idProyecto })
  try {
    const s = recargado.snapshot()
    assert.equal(s.catalogoHash, anterior.hash, "createdWith se conserva al recargar")
    assert.deepEqual(s.catalogoActivo, { version: CATALOGO_ACTIVO.version, hash: CATALOGO_ACTIVO.hash })
    const aviso = s.validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.ok(aviso, JSON.stringify(s.validacion.motivos))
    assert.equal(aviso.severidad, "info")
    assert.equal(aviso.datos.catalogoHashGuardado, anterior.hash)
    assert.equal(aviso.datos.catalogoHashActivo, CATALOGO_ACTIVO.hash)
    assert.equal(recargado.aplicar(sobre(recargado, "AgregarComponente", { tipo: CATALOGO_ACTIVO.componentes[0].id })).ok, true)
    assert.equal(recargado.snapshot().catalogoHash, anterior.hash, "createdWith se conserva después de un commit")
  } finally {
    recargado.cerrar()
  }
  const enDisco = JSON.parse(readFileSync(ruta, "utf8"))
  assert.equal(enDisco.catalogoHash, anterior.hash, "sin reescritura en disco")
  assert.equal(enDisco.catalogoVersion, anterior.version, "sin migración de versión en disco")
})
