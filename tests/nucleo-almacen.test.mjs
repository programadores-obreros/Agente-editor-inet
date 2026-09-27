// Gate 7 — persistencia (`almacen.ts`): guardar/cargar/existe contra disco.
//
// Único archivo del núcleo (además del adaptador de hash, Gate 3) que importa
// `node:fs` — inyectable (`fs: FsLike`) para poder simular fallas a mitad de
// escritura sin tocar disco real en los tests. Directorio SIEMPRE inyectado, nunca
// `~/.config/opencode/tecnia-memoria.md` (eso es memoria pedagógica de otro
// subsistema, `memoria.ts`, no del proyecto — ver DECISIONS.md).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))

const catalogo = construirCatalogoMinimoReal()

function crearFsFalso(inicial = {}) {
  const archivos = new Map(Object.entries(inicial))
  let fallarEn = null
  return {
    _archivos: archivos,
    _fallarEnProximo: (modo) => {
      fallarEn = modo
    },
    existsSync: (p) => archivos.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, data) => {
      if (fallarEn === "escribir") {
        fallarEn = null
        throw new Error("fallo simulado al escribir")
      }
      archivos.set(p, data)
    },
    renameSync: (from, to) => {
      if (fallarEn === "renombrar") {
        fallarEn = null
        throw new Error("fallo simulado al renombrar")
      }
      const contenido = archivos.get(from)
      archivos.delete(from)
      archivos.set(to, contenido)
    },
    unlinkSync: (p) => {
      archivos.delete(p)
    },
    readFileSync: (p) => {
      if (!archivos.has(p)) {
        const err = new Error("ENOENT")
        err.code = "ENOENT"
        throw err
      }
      return archivos.get(p)
    },
  }
}

function proyectoDePrueba(id = "proy-1") {
  return crearProyecto({ generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
}

// ─────────────────────── 1. guardar/cargar preserva forma canónica ───────────────────

test("guardar-cargar-preserva-forma-canonica", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const p = proyectoDePrueba()
  const rGuardar = almacen.guardar(p)
  assert.equal(rGuardar.ok, true)
  const rCargar = almacen.cargar(p.id)
  assert.equal(rCargar.ok, true)
  assert.equal(canonicalizar(rCargar.proyecto), canonicalizar(p))
})

// ────────────────────── 2. no queda .tmp huerfano tras save exitoso ──────────────────

test("no-queda-tmp-huerfano-tras-guardar-exitoso", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  almacen.guardar(proyectoDePrueba())
  const rutas = [...fs._archivos.keys()]
  assert.equal(rutas.length, 1, `sólo debe quedar el archivo final: ${rutas.join(", ")}`)
  assert.ok(!rutas[0].includes(".tmp"), "el archivo final no debe tener sufijo temporal")
})

// ───────────────────── 3. temporal en el MISMO directorio que destino ───────────────

test("temporal-en-mismo-directorio-que-destino", () => {
  const fs = crearFsFalso()
  const rutasEscritas = []
  const fsEspiado = { ...fs, writeFileSync: (p, d) => (rutasEscritas.push(p), fs.writeFileSync(p, d)) }
  const almacen = crearAlmacen({ directorio: "/proyectos", fs: fsEspiado, catalogo })
  almacen.guardar(proyectoDePrueba())
  assert.equal(rutasEscritas.length, 1)
  assert.ok(rutasEscritas[0].startsWith("/proyectos/"), "el temporal se escribe DENTRO del mismo directorio destino")
})

// ──────────── 4. falla a mitad de escritura preserva el archivo previo intacto ──────

test("falla-inyectada-al-escribir-preserva-archivo-previo-intacto", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const p1 = proyectoDePrueba("proy-1")
  almacen.guardar(p1)
  const contenidoPrevio = fs._archivos.get("/proyectos/proy-1.json")

  fs._fallarEnProximo("escribir")
  const p2 = { ...p1, placa: "arduino-uno" }
  const r = almacen.guardar(p2)
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
  assert.equal(fs._archivos.get("/proyectos/proy-1.json"), contenidoPrevio, "el archivo previo sigue intacto, byte a byte")
  assert.equal([...fs._archivos.keys()].length, 1, "no quedó ningún temporal huérfano")
})

test("falla-inyectada-al-renombrar-limpia-el-temporal", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  fs._fallarEnProximo("renombrar")
  const r = almacen.guardar(proyectoDePrueba())
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
  assert.equal([...fs._archivos.keys()].length, 0, "el temporal se limpia (unlink) cuando falla el rename")
})

// ─────── 5. dos guardados en sucesión rápida no colisionan de nombre temporal ────────

test("dos-temporales-en-sucesion-rapida-no-colisionan", () => {
  const fs = crearFsFalso()
  const rutasEscritas = []
  const fsEspiado = { ...fs, writeFileSync: (p, d) => (rutasEscritas.push(p), fs.writeFileSync(p, d)) }
  const almacen = crearAlmacen({ directorio: "/proyectos", fs: fsEspiado, catalogo })
  almacen.guardar(proyectoDePrueba("proy-1"))
  almacen.guardar({ ...proyectoDePrueba("proy-1"), placa: "arduino-uno" })
  assert.equal(rutasEscritas.length, 2)
  assert.notEqual(rutasEscritas[0], rutasEscritas[1], "cada guardado usa un nombre de temporal distinto")
})

// ────────────────── 6. existe()/cargar() reflejan disco real, no caché ──────────────

test("existe-y-cargar-reflejan-disco-real", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  assert.equal(almacen.existe("proy-1"), false)
  fs._archivos.set("/proyectos/proy-1.json", canonicalizar(proyectoDePrueba("proy-1")))
  assert.equal(almacen.existe("proy-1"), true, "escrito por fuera del almacén, pero existe() lo ve igual: no hay caché propia")
})

// ────────────────── 7. cargar usa el loader: JSON corrupto da motivos ────────────────

test("cargar-json-corrupto-da-motivos-estructurados", () => {
  const fs = crearFsFalso({ "/proyectos/proy-roto.json": "{ esto no es JSON valido" })
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const r = almacen.cargar("proy-roto")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "DOCUMENTO_MALFORMADO")
})

test("cargar-inexistente-da-motivo-estructurado", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const r = almacen.cargar("no-existe")
  assert.equal(r.ok, false)
  // Código específico, no cualquier rechazo: "no existe" y "existe pero está
  // corrupto" son dos diagnósticos distintos (el test de JSON corrupto de arriba
  // cubre el otro) — si se chequeara sólo `motivos.length > 0`, un almacén que
  // saltee el existsSync() y deje que readFileSync tire ENOENT (capturado como
  // DOCUMENTO_MALFORMADO) pasaría este test igual, sin distinguir los dos casos.
  assert.equal(r.motivos[0].codigo, "PROYECTO_INEXISTENTE")
})

// ───────────────────── 8. idempotencia load→save→load, no-op byte a byte ────────────

test("idempotencia-load-save-load-no-op-byte-a-byte", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  almacen.guardar(proyectoDePrueba())
  const r1 = almacen.cargar("proy-1")
  const contenidoTrasR1 = fs._archivos.get("/proyectos/proy-1.json")
  almacen.guardar(r1.proyecto)
  const contenidoTrasResave = fs._archivos.get("/proyectos/proy-1.json")
  assert.equal(contenidoTrasResave, contenidoTrasR1, "guardar lo recién cargado, sin tocar nada, es un no-op byte a byte")
})

// ──────────────── 9. cambio de catálogo detectado al cargar: diagnóstico, no mutación ─

test("cambio-de-catalogo-al-cargar-dispara-diagnostico-sin-mutar", () => {
  const fs = crearFsFalso()
  const catalogoViejo = construirCatalogo({ version: "0.0.1-viejo", componentes: [], placas: [], unidades: undefined }, (t) => `hash-falso-${t.length}`)
  // El proyecto se CREÓ cuando el catálogo vigente era el viejo (su catalogoHash
  // queda grabado con ese valor) — el almacén de guardado usa ese mismo catálogo
  // viejo, sólo para escribir el archivo tal cual habría quedado en ese momento.
  const p = crearProyecto({ generadorId: () => "proy-1", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogoViejo.version, catalogoHash: catalogoViejo.hash })
  const almacenConCatalogoViejo = crearAlmacen({ directorio: "/proyectos", fs, catalogo: catalogoViejo })
  almacenConCatalogoViejo.guardar(p)

  const almacenConCatalogoActual = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const r = almacenConCatalogoActual.cargar(p.id)
  assert.equal(r.ok, true)
  assert.deepEqual(r.proyecto, p, "el proyecto NO se muta por el cambio de catálogo")
  assert.ok(r.diagnostico?.some((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO"), `debe haber un diagnóstico informativo: ${JSON.stringify(r.diagnostico)}`)
})
