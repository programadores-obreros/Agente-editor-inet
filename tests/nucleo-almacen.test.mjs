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
  // Phase 1.1 (hallazgo externo E3-07): `guardar()` ahora exige que la revision del
  // segundo commit sea exactamente N+1 respecto de lo que hay en disco (revision
  // p1.revision) — p2 con la MISMA revision que p1 pero contenido distinto ahora es,
  // correctamente, un conflicto detectado (CONFLICTO_REVISION_EN_ALMACEN) ANTES de
  // siquiera intentar escribir, lo que nunca llegaría a ejercitar la falla inyectada
  // que este test quiere probar. Se ajusta el fixture para representar el PRÓXIMO
  // commit real (revision+1), sin cambiar lo que el test verifica.
  const p2 = { ...p1, placa: "arduino-uno", revision: p1.revision + 1 }
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
  const p1 = proyectoDePrueba("proy-1")
  almacen.guardar(p1)
  // Phase 1.1 (hallazgo externo E3-07): segundo guardado con revision+1 (el PRÓXIMO
  // commit real) — con la MISMA revision que p1 sería, correctamente, un conflicto
  // detectado antes de escribir, y este test dejaría de ejercitar dos escrituras.
  almacen.guardar({ ...p1, placa: "arduino-uno", revision: p1.revision + 1 })
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

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-08 (barato, integridad del mismo almacén):
// `cargar(id)` leía el archivo `<id>.json` y confiaba en que su `Proyecto.id` interno
// coincidiera con el `id` pedido, sin verificarlo — un documento escrito/movido a la
// ruta equivocada cargaba igual bajo una identidad que no era la suya.
// ════════════════════════════════════════════════════════════════════════════════════

test("cargar-rechaza-si-el-id-del-documento-no-coincide-con-el-id-pedido (hallazgo externo E3-08)", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  // El archivo "otro-id.json" contiene, por error (o por una copia manual), un
  // Proyecto cuyo campo `id` interno es "proy-1", no "otro-id".
  const proyectoConIdDistinto = proyectoDePrueba("proy-1")
  fs._archivos.set("/proyectos/otro-id.json", canonicalizar(proyectoConIdDistinto))
  const r = almacen.cargar("otro-id")
  assert.equal(r.ok, false, "cargar() NUNCA debe devolver un documento cuyo id interno no es el pedido")
  assert.equal(r.motivos[0].codigo, "ID_DOCUMENTO_NO_COINCIDE")
  assert.equal(r.motivos[0].clasificacion, "rechazo")
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

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-07 (MAJOR, evidencia/e3/scripts/e1_motor_flujo.mjs
// TEST 4): dos motores con el MISMO almacén y MISMO id de proyecto partían de
// revisión 0 y el segundo commit pisaba SILENCIOSAMENTE al primero en disco — sin
// detección. `guardar()` ahora aplica un compare-and-swap sobre la REVISION (nunca un
// lock, resolución humana Phase 1.1, sin base de datos, locks distribuidos, ni servidor): si YA
// existe un documento en disco bajo este id, su revisión tiene que ser EXACTAMENTE
// `proyecto.revision - 1` (el estado que este llamador cree que acaba de reemplazar).
// Excepción: un re-guardado CANÓNICAMENTE IDÉNTICO al que ya está en disco se permite
// igual (no hay pérdida posible) — ver "idempotencia-load-save-load", test 8 de más
// arriba, que sigue pasando sin cambios gracias a esta excepción.
// ════════════════════════════════════════════════════════════════════════════════════

test("guardar-detecta-conflicto-cuando-el-disco-ya-avanzo-mas-alla-de-lo-que-este-llamador-vio (hallazgo externo E3-07)", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })

  // "motor A" guarda su primer commit (revision 0 -> 1).
  const pA = { ...proyectoDePrueba("proy-colision"), placa: "esp32-devkit-v1", revision: 1 }
  const rA = almacen.guardar(pA)
  assert.equal(rA.ok, true)

  // "motor B" parte del MISMO id, pero de SU PROPIA revision 0 en memoria (nunca vio
  // el commit de A) — también intenta guardar su revision 1, con contenido DISTINTO.
  const pB = { ...proyectoDePrueba("proy-colision"), componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }], revision: 1 }
  const rB = almacen.guardar(pB)
  assert.equal(rB.ok, false, "el segundo guardado con revision en conflicto debe rechazar, no pisar en silencio")
  assert.equal(rB.motivo.codigo, "CONFLICTO_REVISION_EN_ALMACEN")
  assert.equal(rB.motivo.clasificacion, "rechazo")

  const rCargar = almacen.cargar("proy-colision")
  assert.equal(rCargar.ok, true)
  assert.equal(rCargar.proyecto.placa, "esp32-devkit-v1", "el disco conserva el commit de A, intacto")
  assert.equal(rCargar.proyecto.componentes.length, 0, "el commit de B NUNCA llego a pisar el de A")
})

test("guardar-permite-avanzar-cuando-la-revision-en-disco-coincide-con-N (flujo normal, hallazgo externo E3-07)", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const p0 = proyectoDePrueba("proy-normal")
  assert.equal(almacen.guardar({ ...p0, revision: 1 }).ok, true, "primer guardado (sin archivo previo) siempre funciona")
  assert.equal(almacen.guardar({ ...p0, revision: 2, placa: "esp32-devkit-v1" }).ok, true, "revision en disco (1) == N esperado (2-1=1): avanza sin conflicto")
  assert.equal(almacen.guardar({ ...p0, revision: 3, placa: "arduino-uno" }).ok, true, "commits sucesivos siguen avanzando sin regresion")
  const r = almacen.cargar("proy-normal")
  assert.equal(r.proyecto.revision, 3)
  assert.equal(r.proyecto.placa, "arduino-uno")
})

test("guardar-fail-closed-si-el-documento-existente-esta-corrupto-al-verificar-la-revision (hallazgo externo E3-07)", () => {
  const fs = crearFsFalso({ "/proyectos/proy-corrupto.json": "{ esto no es JSON valido" })
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const r = almacen.guardar({ ...proyectoDePrueba("proy-corrupto"), revision: 1 })
  assert.equal(r.ok, false, "un documento existente ilegible/corrupto nunca se sobreescribe a ciegas")
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
  assert.equal(fs._archivos.get("/proyectos/proy-corrupto.json"), "{ esto no es JSON valido", "el archivo corrupto previo queda intacto, no se toca")
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

// ──── 10. round-trip formal con claves peligrosas dentro de "propiedades" (hallazgo
// externo RX3-01, CRÍTICO — revisión adversarial independiente #3): guardar (disco
// real, `fs` falso) → cargar (pasa por `cargarProyecto`, el MISMO `JSON.parse` +
// validación completa que un documento externo real) → IR canónica equivalente. Con
// el fix de raíz (contenedor seguro, `Object.defineProperty` en `datos-planos.ts`/
// `canonico.ts`/`cargador.ts`), "__proto__"/"constructor"/"prototype" dentro de
// `propiedades` (bolsa abierta, forma libre a propósito) sobreviven el ciclo completo
// memoria → disco → memoria como datos ORDINARIOS, sin corromper ningún prototipo ni
// perderse en silencio — exactamente lo que "IR canónica aceptada → guardar → cargar
// → canónica equivalente" exige.
test("round-trip formal (guardar en almacen real con fs falso, cargar de vuelta): '__proto__'/'constructor'/'prototype' dentro de propiedades sobreviven identicos, sin corromper el prototipo (hallazgo externo RX3-01)", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const base = proyectoDePrueba("proy-rx3-01-roundtrip")
  // IMPORTANTE: se construye via JSON.parse de un TEXTO crudo, nunca con un literal
  // de objeto JS `{ __proto__: ... }` — ese literal setea el prototipo real en
  // tiempo de parseo del CÓDIGO FUENTE (gramática Annex B del lenguaje), un
  // mecanismo distinto que NO prueba lo mismo (ver cabecera de datos-planos.ts).
  const propiedadesPeligrosas = JSON.parse('{"color":"rojo","__proto__":{"pwned":true},"constructor":{"prototype":{"pwned2":true}},"prototype":"dato-normal"}')
  assert.ok(Object.prototype.hasOwnProperty.call(propiedadesPeligrosas, "__proto__"), "control: JSON.parse produce '__proto__' como OWN key real")
  const proyectoConComponente = {
    ...base,
    siguienteIdLocal: 1,
    componentes: [{ id: "cmp-0", tipo: "led", pines: {}, propiedades: propiedadesPeligrosas }],
  }

  const rGuardar = almacen.guardar(proyectoConComponente)
  assert.equal(rGuardar.ok, true, `el guardado debe aceptar el proyecto: ${JSON.stringify(rGuardar)}`)

  const rCargar = almacen.cargar(proyectoConComponente.id)
  assert.equal(rCargar.ok, true, `la carga (via cargarProyecto, JSON.parse + validacion completa) debe aceptar: ${JSON.stringify(rCargar)}`)

  const propiedadesCargadas = rCargar.proyecto.componentes[0].propiedades
  assert.equal(Object.getPrototypeOf(propiedadesCargadas), Object.prototype, "el prototipo de 'propiedades' nunca cambia, ni tras un ciclo completo por disco")
  assert.ok(Object.prototype.hasOwnProperty.call(propiedadesCargadas, "__proto__"), "'__proto__' sobrevive como propiedad PROPIA tras el ciclo completo")
  assert.deepEqual(propiedadesCargadas.__proto__, { pwned: true })
  assert.equal(propiedadesCargadas.constructor.prototype.pwned2, true)
  assert.equal(propiedadesCargadas.prototype, "dato-normal")
  assert.equal(propiedadesCargadas.color, "rojo")

  assert.equal(canonicalizar(rCargar.proyecto), canonicalizar(proyectoConComponente), "canonica-cargada === canonica-guardada — round-trip exacto, incluidas las claves peligrosas")
  assert.equal(({}).pwned, undefined, "Object.prototype global NUNCA se contamina, ni siquiera tras pasar por disco real")
  assert.equal(({}).pwned2, undefined, "Object.prototype global NUNCA se contamina, ni siquiera tras pasar por disco real")
})

// ──── 11. round-trip formal con -0 (hallazgo RX4, NOTE): `JSON.parse("-0")` produce
// `-0` en memoria, pero `JSON.stringify(-0)` da el string `"0"` — en disco el signo
// SIEMPRE se pierde. Antes de este fix eso era una divergencia REAL memoria/disco
// (Object.is(v,-0) en memoria, "0" en disco); con la normalizacion en
// `materializarDatosPlanos`, memoria/disco/canonico coinciden siempre en
// `Object.is(v,0)`.
test("round-trip formal (guardar en almacen real con fs falso, cargar de vuelta): -0 se normaliza a 0 en memoria, en disco y en el canonico — nunca una divergencia de representacion (hallazgo RX4, NOTE)", () => {
  const fs = crearFsFalso()
  const almacen = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const base = proyectoDePrueba("proy-rx4-menos-cero-roundtrip")
  const proyectoConUmbral = {
    ...base,
    siguienteIdLocal: 2,
    componentes: [
      { id: "cmp-0", tipo: "dht22", pines: {}, propiedades: {} },
      { id: "cmp-1", tipo: "led", pines: {}, propiedades: {} },
    ],
    comportamientos: [{ id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: -0, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } }],
  }
  assert.ok(Object.is(proyectoConUmbral.comportamientos[0].cuando.umbral.valor, -0), "control: el objeto en memoria ANTES de guardar trae -0 real")

  const rGuardar = almacen.guardar(proyectoConUmbral)
  assert.equal(rGuardar.ok, true, `el guardado debe aceptar el proyecto: ${JSON.stringify(rGuardar)}`)

  const textoEnDisco = fs._archivos.get("/proyectos/" + proyectoConUmbral.id + ".json")
  assert.ok(textoEnDisco.includes('"valor":0'), "en disco nunca puede quedar -0 (JSON.stringify(-0) === '0') — control de que el texto persistido es '0'")
  assert.ok(!textoEnDisco.includes('"valor":-0'), "control negativo: el texto persistido NUNCA contiene '-0'")

  const rCargar = almacen.cargar(proyectoConUmbral.id)
  assert.equal(rCargar.ok, true, `la carga debe aceptar: ${JSON.stringify(rCargar)}`)
  const valorCargado = rCargar.proyecto.comportamientos[0].cuando.umbral.valor
  assert.ok(Object.is(valorCargado, 0), "en memoria, tras cargar de vuelta, queda 0 — nunca -0")
  assert.ok(!Object.is(valorCargado, -0))

  assert.equal(canonicalizar(rCargar.proyecto), canonicalizar(proyectoConUmbral), "canonica-cargada === canonica-guardada — round-trip identico (canonicalizar ya usaba JSON.stringify, así que esto también valía ANTES del fix; lo que cambia es que memoria ahora coincide con esa misma representación)")
})
