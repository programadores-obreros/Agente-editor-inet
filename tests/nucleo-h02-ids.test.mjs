// H-02 (SEC-04 / BUG-04), capa 1 — el FORMATO de los ids se exige en la frontera (`cargador.ts`).
//
// El incidente: el cargador sólo pedía «string no vacío» para los ids. Un `activo.json` editado
// a mano con `"beh-7x\nvoid INYECTADO(){ } //"` como id de una regla cargaba, y `programa generar`
// emitía esa función como C++ fuera de comentario (ver `tests/codegen-h02-inyeccion.test.mjs`,
// que prueba la OTRA capa, la del codegen, sin pasar por acá).
//
// El formato es el de IR-SPEC.md §2: `cmp-<n>` / `conn-<n>` / `beh-<n>`. Para el id de proyecto
// la especificación no fija forma; la adoptada está en `id.ts::esIdDeProyecto`.
//
// Qué mira cada test, y por qué no alcanza con «rechaza»: todos comparan el CÓDIGO del motivo y
// la `entidad`. Sin eso un test seguía verde si el documento se rechazaba por otra razón (por
// ejemplo `CONTADOR_ID_INCONSISTENTE`, que ya frenaba `beh-07` antes de este fix por casualidad).
// Por la misma razón cada documento hostil sale de uno VÁLIDO al que se le cambia UNA cosa, y F0
// prueba primero que el válido carga.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearProyecto, cargarProyecto, validarFormaProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { esIdLocal, esIdDeProyecto, formatearIdLocal, recorteDeId } = await import(join(REPO, "opencode/nucleo/id.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════════════════════

function construir(ops, id = "activo") {
  let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}

/** ESP32 + pulsador (cmp-0) + LED (cmp-1) + resistencia (cmp-2) + conexión (conn-3) + regla (beh-4). */
const OPS = [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo: "pulsador" }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-1", accion: "encender" } } }],
]
const VALIDO = construir(OPS)
const documento = () => JSON.parse(canonicalizar(VALIDO))
/** Reemplaza un id de componente en TODO el documento (el componente y quien lo referencia). */
function renombrar(doc, viejo, nuevo) {
  Object.assign(doc, JSON.parse(JSON.stringify(doc).split(JSON.stringify(viejo)).join(JSON.stringify(nuevo))))
}

/** Cómo se le pone un id a cada entidad del documento, manteniendo las referencias coherentes. */
const PONER_ID = {
  proyecto: (d, id) => { d.id = id },
  componente: (d, id) => renombrar(d, "cmp-1", id),
  conexion: (d, id) => { d.conexiones[0].id = id },
  comportamiento: (d, id) => { d.comportamientos[0].id = id },
}
const PREFIJO = { componente: "cmp", conexion: "conn", comportamiento: "beh" }

function rechazaPorId(doc, entidad, mensaje) {
  for (const [puerta, r] of [["cargarProyecto(string)", cargarProyecto(JSON.stringify(doc))], ["validarFormaProyecto(objeto)", validarFormaProyecto(doc)]]) {
    assert.equal(r.ok, false, `${puerta} aceptó: ${mensaje}`)
    assert.ok(!("proyecto" in r), "un rechazo nunca devuelve un proyecto parcial")
    assert.deepEqual(r.motivos.map((m) => m.codigo), ["ID_MALFORMADO_AL_CARGAR"], `${puerta}: ${mensaje}`)
    const [m] = r.motivos
    assert.equal(m.categoria, "estructural")
    assert.equal(m.severidad, "blocking")
    assert.equal(m.clasificacion, "rechazo")
    assert.equal(m.datos.entidad, entidad, `${puerta}: ${mensaje}`)
    assert.equal(m.datos.campo, "id")
  }
}

// Escritos por código de carácter: como escape en el fuente, un editor los puede convertir en el
// carácter real y el test dejaría de decir lo que prueba.
const c = (...codigos) => String.fromCharCode(...codigos)
const LS = c(0x2028)
const PS = c(0x2029)
const NEL = c(0x85)
const NBSP = c(0xa0)
const BOM = c(0xfeff)
const NUL = c(0)
const DIGITO_ANCHO_COMPLETO = c(0xff11) // «１»
const DIGITO_ARABE = c(0x0663) // «٣»
const E_CIRILICA = c(0x0435) // «е», igual a la vista que la «e» latina

/** Sufijos y formas que NUNCA son un id local, se le pongan al prefijo que se le pongan. */
const hostilesDe = (p) => [
  // la reproducción del incidente y sus variantes de fin de línea
  [`${p}-7x\nvoid INYECTADO(){ }  //`, "salto de línea (la reproducción, P11)"],
  [`${p}-7\n`, "salto de línea final ($ de JS no lo perdona)"],
  [`\n${p}-7`, "salto de línea inicial"],
  [`${p}-7\r`, "retorno de carro"],
  [`${p}-7\r\nx`, "CRLF"],
  [`${p}-7${LS}x`, "U+2028"],
  [`${p}-7${PS}x`, "U+2029"],
  [`${p}-7${NEL}x`, "U+0085 (NEL)"],
  [`${p}-7\vx`, "tabulación vertical"],
  [`${p}-7\fx`, "salto de página"],
  [`${p}-7\tx`, "tabulación"],
  [`${p}-7${NUL}`, "NUL"],
  // léxico de C++
  [`${p}-7\\`, "barra invertida final (continúa la línea de un comentario)"],
  [`${p}-7 */ x /*`, "cierre de comentario de bloque"],
  [`${p}-7"`, "comilla doble"],
  [`${p}-7'`, "comilla simple"],
  [`${p}-7??/`, "trígrafo de barra invertida"],
  [`#include "/etc/passwd"`, "directiva"],
  [`${p}-7;`, "punto y coma"],
  [`${p}-7 `, "espacio final"],
  [` ${p}-7`, "espacio inicial"],
  [`${p}-7${NBSP}`, "espacio de no separación"],
  [`${BOM}${p}-7`, "BOM inicial"],
  // forma del número
  [`${p}-`, "sin número"],
  [`${p}`, "sin guion ni número"],
  [`${p}-07`, "cero a la izquierda (no es lo que escribe formatearIdLocal)"],
  [`${p}-00`, "doble cero"],
  [`${p}--7`, "doble guion"],
  [`${p}-+7`, "signo más"],
  [`${p}--1`, "negativo"],
  [`${p}-7.0`, "decimal"],
  [`${p}-7e3`, "notación exponencial"],
  [`${p}-0x7`, "hexadecimal"],
  [`${p}-7_0`, "separador de miles"],
  [`${p}-${DIGITO_ANCHO_COMPLETO}`, "dígito de ancho completo"],
  [`${p}-${DIGITO_ARABE}`, "dígito arábigo-índico"],
  [`${p}-9007199254740992`, "número que no es entero seguro"],
  [`${p}-99999999999999999999999999`, "número absurdo"],
  [`${p}-${"7".repeat(10000)}`, "diez mil dígitos"],
  // forma del prefijo
  [`${p}_7`, "guion bajo en vez de guion (choca con el identificador C++ del id real)"],
  [`${p.toUpperCase()}-7`, "mayúsculas"],
  [`x${p}-7`, "prefijo con algo antes"],
  [`${p}x-7`, "prefijo con algo después"],
  [`${p.replace("e", E_CIRILICA).replace("c", c(0x0441))}-7`, "homoglifos cirílicos"],
  // nombres que rompían la compilación o chocaban con el programa
  ["if", "palabra reservada de C++"],
  ["7", "empieza con dígito"],
  ["ahora", "variable del programa generado"],
  ["PI", "macro de Arduino"],
  ["setup", "función del programa generado"],
  ["HIGH", "macro de Arduino"],
  ["__proto__", "clave especial de JS"],
  ["constructor", "clave heredada de JS"],
  ["mi-regla-inventada", "nombre libre"],
]

// ════════════════════════════════════════════════════════════════════════════════════
// F0 — la base es válida: los tests de abajo cambian UNA cosa de un documento que carga
// ════════════════════════════════════════════════════════════════════════════════════

test("F0 el documento base carga por las dos puertas y round-trip da los mismos bytes", () => {
  const r = cargarProyecto(canonicalizar(VALIDO))
  assert.equal(r.ok, true, JSON.stringify(r.motivos ?? null))
  assert.equal(canonicalizar(r.proyecto), canonicalizar(VALIDO))
  assert.equal(validarFormaProyecto(documento()).ok, true)
  assert.deepEqual(r.proyecto.componentes.map((x) => x.id), ["cmp-0", "cmp-1", "cmp-2"])
  assert.deepEqual(r.proyecto.conexiones.map((x) => x.id), ["conn-3"])
  assert.deepEqual(r.proyecto.comportamientos.map((x) => x.id), ["beh-4"])
})

// ════════════════════════════════════════════════════════════════════════════════════
// F1 — ids locales: cada entidad, con SU prefijo
// ════════════════════════════════════════════════════════════════════════════════════

for (const entidad of ["componente", "conexion", "comportamiento"]) {
  test(`F1 ${entidad}: ningún id hostil carga (ID_MALFORMADO_AL_CARGAR, entidad ${entidad})`, () => {
    const casos = hostilesDe(PREFIJO[entidad])
    assert.ok(casos.length >= 50, "la tabla de hostiles no se vació")
    for (const [id, porque] of casos) {
      const doc = documento()
      PONER_ID[entidad](doc, id)
      rechazaPorId(doc, entidad, `${porque} — ${JSON.stringify(id).slice(0, 60)}`)
    }
  })

  test(`F2 ${entidad}: un id con el prefijo de OTRA entidad no carga`, () => {
    for (const otro of ["cmp", "conn", "beh"].filter((p) => p !== PREFIJO[entidad])) {
      const doc = documento()
      PONER_ID[entidad](doc, `${otro}-7`)
      rechazaPorId(doc, entidad, `prefijo ${otro}`)
    }
  })

  test(`F3 ${entidad}: el id bien formado SÍ carga (el rechazo es por la forma, no por tocar el id)`, () => {
    for (const n of [7, 10, 123456, Number.MAX_SAFE_INTEGER - 1]) {
      const doc = documento()
      PONER_ID[entidad](doc, `${PREFIJO[entidad]}-${n}`)
      doc.siguienteIdLocal = Math.max(doc.siguienteIdLocal, n + 1)
      const r = cargarProyecto(JSON.stringify(doc))
      assert.equal(r.ok, true, `${PREFIJO[entidad]}-${n}: ${JSON.stringify(r.motivos ?? null)}`)
    }
  })
}

test("F4 los códigos de siempre no cambian: id ausente, vacío o que no es string sigue siendo CAMPO_REQUERIDO_FALTANTE", () => {
  for (const entidad of ["componente", "conexion", "comportamiento"]) {
    for (const id of ["", 7, null, ["cmp-1"], { id: "cmp-1" }, true]) {
      const doc = documento()
      const lista = { componente: doc.componentes, conexion: doc.conexiones, comportamiento: doc.comportamientos }[entidad]
      lista[0].id = id
      const r = cargarProyecto(JSON.stringify(doc))
      assert.equal(r.ok, false)
      assert.deepEqual(r.motivos.map((m) => m.codigo), ["CAMPO_REQUERIDO_FALTANTE"], `${entidad} id=${JSON.stringify(id)}`)
    }
  }
  for (const id of ["", 7, null]) {
    const doc = documento()
    doc.id = id
    assert.deepEqual(cargarProyecto(JSON.stringify(doc)).motivos.map((m) => m.codigo), ["CAMPO_REQUERIDO_FALTANTE"])
  }
})

test("F5 una referencia a un id hostil se rechaza aunque el componente tenga un id sano (REFERENCIA_ROTA_AL_CARGAR)", () => {
  const hostil = "cmp-1\nvoid INYECTADO(){} //"
  const casos = [
    (d) => { d.comportamientos[0].cuando.sensor = hostil },
    (d) => { d.comportamientos[0].entonces.actuador = hostil },
    (d) => { d.conexiones[0].desde.componente = hostil },
    (d) => { d.conexiones[0].hasta.componente = hostil },
  ]
  for (const mutar of casos) {
    const doc = documento()
    mutar(doc)
    const r = cargarProyecto(JSON.stringify(doc))
    assert.equal(r.ok, false)
    assert.deepEqual(r.motivos.map((m) => m.codigo), ["REFERENCIA_ROTA_AL_CARGAR"])
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// F6/F7 — id de proyecto
// ════════════════════════════════════════════════════════════════════════════════════

test("F6 id de proyecto: carga todo lo que el repo produce o usa", () => {
  const validos = [
    "activo", "p1", "proy-test", "MISMO-ID", "proyecto_1", "proyecto-codegen-s2b", "proy-legacy-4a0cad5", "0", "A",
    crypto.randomUUID(), "3f2b0c9e-7d1a-4c55-9a0e-1b2c3d4e5f60", "a".repeat(64),
  ]
  for (const id of validos) {
    assert.equal(esIdDeProyecto(id), true, id)
    const doc = documento()
    doc.id = id
    const r = cargarProyecto(JSON.stringify(doc))
    assert.equal(r.ok, true, `${id}: ${JSON.stringify(r.motivos ?? null)}`)
    assert.equal(r.proyecto.id, id)
  }
})

test("F7 id de proyecto: ninguno hostil carga (ID_MALFORMADO_AL_CARGAR, entidad proyecto)", () => {
  const hostiles = [
    'activox\nvoid INYECTADO(){ system("x"); } //', "activo\n", "\nactivo", "activo\r", `activo${LS}`, `activo${PS}`, `activo${NEL}`, "activo\v", "activo\f", "activo\t", `activo${NUL}`,
    "activo\\", "activo */", 'activo"', "activo'", "activo??/", "#include <x>", "activo;", "activo ", " activo", "mi proyecto", `activo${NBSP}`, `${BOM}activo`,
    "-activo", "_activo", "activo.json", "../activo", "a/b", "a:b", "a$b", "a{b}", "proyectoñ", `activ${c(0x043e)}`, "a".repeat(65), "a".repeat(100000),
  ]
  for (const id of hostiles) {
    assert.equal(esIdDeProyecto(id), false, JSON.stringify(id).slice(0, 60))
    const doc = documento()
    doc.id = id
    rechazaPorId(doc, "proyecto", JSON.stringify(id).slice(0, 60))
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// F8 — el predicado, y que el Engine y el predicado coinciden
// ════════════════════════════════════════════════════════════════════════════════════

test("F8 esIdLocal: acepta exactamente lo que escribe formatearIdLocal, con el prefijo pedido", () => {
  for (const p of ["cmp", "conn", "beh"]) {
    for (const n of [0, 1, 9, 10, 99, 1000, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const id = formatearIdLocal(p, n)
      assert.equal(esIdLocal(p, id), true, id)
      for (const otro of ["cmp", "conn", "beh"].filter((x) => x !== p)) assert.equal(esIdLocal(otro, id), false, `${id} no es un ${otro}`)
    }
    for (const [id] of hostilesDe(p)) assert.equal(esIdLocal(p, id), false, JSON.stringify(id).slice(0, 60))
    for (const noString of [undefined, null, 7, {}, [`${p}-1`], new String(`${p}-1`)]) assert.equal(esIdLocal(p, noString), false)
  }
  // El número se compara como número, no como texto: 2^53 tiene 16 dígitos y NO es seguro; 2^53 - 1, sí.
  assert.equal(esIdLocal("cmp", "cmp-9007199254740991"), true)
  assert.equal(esIdLocal("cmp", "cmp-9007199254740992"), false)
})

test("F9 todo id que genera el Engine pasa el predicado y vuelve a cargar (proyecto largo: 40 componentes)", () => {
  const ops = [["SetPlaca", { placa: "esp32-devkit-v1" }]]
  for (let i = 0; i < 40; i++) ops.push(["AgregarComponente", { tipo: i % 2 ? "led" : "resistencia" }])
  for (let i = 0; i < 20; i++) ops.push(["Conectar", { desde: { componente: `cmp-${2 * i}`, terminal: "a" }, hasta: { componente: `cmp-${2 * i + 1}`, terminal: "anodo" } }])
  const p = construir(ops, "proy-largo")
  assert.equal(p.componentes.length, 40)
  assert.equal(p.conexiones.length, 20)
  for (const x of p.componentes) assert.equal(esIdLocal("cmp", x.id), true, x.id)
  for (const x of p.conexiones) assert.equal(esIdLocal("conn", x.id), true, x.id)
  assert.equal(esIdDeProyecto(p.id), true)
  const r = cargarProyecto(canonicalizar(p))
  assert.equal(r.ok, true, JSON.stringify(r.motivos ?? null))
  assert.equal(canonicalizar(r.proyecto), canonicalizar(p))
})

test("F10 el motivo muestra el id recortado y su largo real (un id absurdo no infla el error)", () => {
  const largo = `beh-7${"x".repeat(5000)}`
  const doc = documento()
  doc.comportamientos[0].id = largo
  const [m] = cargarProyecto(JSON.stringify(doc)).motivos
  assert.equal(m.codigo, "ID_MALFORMADO_AL_CARGAR")
  assert.equal(m.datos.largo, largo.length)
  assert.equal(m.datos.formato, "beh-<n>")
  assert.ok(m.datos.id.length <= 81, "el id del motivo va recortado")
  assert.ok(largo.startsWith(m.datos.id.slice(0, 80)))
  assert.equal(recorteDeId("beh-7"), "beh-7")
  assert.equal(recorteDeId("x".repeat(80)).length, 80)
  assert.equal(recorteDeId("x".repeat(81)).length, 81)
})

test("F11 el id hostil se rechaza sin sanearlo: ningún id del documento cambia de valor al cargar", () => {
  // Si alguien reemplazara el rechazo por un «saneo» (sacar el salto de línea, normalizar a cmp-N),
  // el documento cargaría con OTRO id. Acá se ve: o no carga, o carga con los ids intactos.
  for (const id of ["cmp-1\n", " cmp-1", "cmp-01", "CMP-1", "cmp_1"]) {
    const doc = documento()
    renombrar(doc, "cmp-1", id)
    const r = cargarProyecto(JSON.stringify(doc))
    assert.equal(r.ok, false, `cargó ${JSON.stringify(id)}`)
  }
})
