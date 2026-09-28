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

// ──── 4b. clave ANIDADA desconocida rechaza (hallazgo externo RX-01, CRÍTICO,
// revisión adversarial independiente, reabre CP-01): §6 de IR-SPEC.md sólo describe
// fail-closed ante claves desconocidas a nivel TOP-LEVEL del documento — el contrato
// no dice nada sobre claves desconocidas DENTRO de un Componente/Conexion/
// ComportamientoRegla. Antes de este fix, `validarComponente`/`validarConexion`/
// `validarComportamiento` (cargador.ts) sólo DESESTRUCTURABAN los campos que conocían
// — una clave extra ahí ni se rechazaba ni se reportaba, simplemente se descartaba en
// silencio (la "copia saneada" en realidad no excluía nada, sólo reconstruía con spread
// selectivo). Se cierra con el mismo criterio fail-closed que ya usa `CLAVES_PROYECTO`
// a nivel raíz — mismo código `CLAVE_DESCONOCIDA`, categoría `estructural`. `propiedades`
// (bolsa abierta, `ir.ts`) NUNCA se valida así: es a propósito una bolsa de forma libre.
test("clave-anidada-desconocida-en-componente-rechaza (hallazgo externo RX-01)", () => {
  const doc = documentoValido()
  doc.componentes[0].campoSorpresa = "dato no declarado"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
  assert.ok(r.motivos[0].datos.claves.includes("campoSorpresa"), JSON.stringify(r.motivos[0].datos))
})

test("clave-anidada-desconocida-en-conexion-rechaza (hallazgo externo RX-01)", () => {
  const doc = documentoValido()
  doc.conexiones[0].campoSorpresa = "dato no declarado"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

test("clave-anidada-desconocida-en-extremo-de-conexion-rechaza (hallazgo externo RX-01)", () => {
  const doc = documentoValido()
  doc.conexiones[0].desde.campoSorpresa = "dato no declarado"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

test("clave-anidada-desconocida-en-comportamiento-rechaza (hallazgo externo RX-01)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].campoSorpresa = "dato no declarado"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

test("clave-anidada-desconocida-en-umbral-de-comportamiento-rechaza (hallazgo externo RX-01)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.campoSorpresa = "dato no declarado"
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

// No-regresión: `propiedades` sigue siendo una bolsa ABIERTA — cualquier clave ahí
// dentro nunca es "clave desconocida" (ir.ts: "el catálogo valida forma y rango, la
// IR no").
test("propiedades-de-componente-sigue-siendo-bolsa-abierta-no-regresion-RX-01", () => {
  const doc = documentoValido()
  doc.componentes[0].propiedades = { cualquierCosa: 1, otraMas: "x" }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.deepEqual(r.proyecto.componentes.find((c) => c.id === "cmp-0").propiedades, { cualquierCosa: 1, otraMas: "x" })
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX2, hallazgo externo RX2-03, CRÍTICO — revisión adversarial
// independiente #2, RX2_REPORT.md): `cargarProyecto(unknown)` documenta que acepta
// un documento YA PARSEADO (no sólo un string JSON) — pero, antes de este fix, no
// tenía NINGÚN `try/catch` propio (a diferencia de `crearMotorDeProyecto`, que sí
// se había protegido en RX-01). Un Proxy/getter en `componentes[i].propiedades`/
// `pines` crasheaba crudo `cargarProyecto()`. Peor: `validarComponente` validaba
// `pines` con `Object.values(pines).every(...)` y LUEGO copiaba con un spread
// INDEPENDIENTE (`{...pines}`) — dos recorridos del MISMO objeto, un TOCTOU real:
// un Proxy que devuelve un string válido en la 1ª pasada y `42` en la 2ª colaba un
// valor fuera de schema, rompiendo el round-trip
// (`cargar(guardar(canonicalizar(p)))===canonicalizar(p)` que `canonico.ts` exige).
// Cerrado materializando `doc` (datos-planos.ts) UNA sola vez, dentro de
// `validarFormaProyecto`, antes de leer nada — ver `cargador.ts`.
// ════════════════════════════════════════════════════════════════════════════════════

// Un Proxy cuyo ÚNICO trap es `get` NUNCA dispara ese trap acá — la
// materialización lee por DESCRIPTOR (`getOwnPropertyDescriptor`), nunca por
// acceso (`get`); sin un trap `getOwnPropertyDescriptor` propio, la lectura cae al
// comportamiento default (el descriptor REAL del target) y el dato real se acepta
// intacto, sin ejecutar el trap malicioso. Documentado como comportamiento POR
// DISEÑO (no un crash, tampoco un rechazo espurio).
test("cargarProyecto(objetoJS) con un Proxy cuyo UNICO trap 'get' lanza nunca dispara ese trap — el dato real del target se acepta (hallazgo externo RX2-03a, defensa por diseño)", () => {
  const doc = documentoValido()
  doc.componentes[0].propiedades = new Proxy({ color: "rojo" }, { get() { throw new Error("proxy-get-boom") } })
  let r
  assert.doesNotThrow(() => {
    r = cargarProyecto(doc)
  }, "cargarProyecto NUNCA debe propagar el trap del Proxy")
  assert.equal(r.ok, true, "el trap 'get' nunca se invoca — el descriptor real del target (color:'rojo') se acepta tal cual")
  assert.deepEqual(r.proyecto.componentes[0].propiedades, { color: "rojo" })
})

// Acá sí: un Proxy que miente/lanza en `ownKeys` o `getOwnPropertyDescriptor` —
// los traps que la materialización SÍ invoca — se rechaza, nunca crashea crudo.
test("cargarProyecto(objetoJS) con un Proxy que lanza en 'ownKeys' en propiedades de un componente nunca crashea crudo, se rechaza (hallazgo externo RX2-03a)", () => {
  const doc = documentoValido()
  doc.componentes[0].propiedades = new Proxy(
    { color: "rojo" },
    {
      ownKeys() {
        throw new Error("proxy-ownKeys-boom")
      },
    },
  )
  let r
  assert.doesNotThrow(() => {
    r = cargarProyecto(doc)
  }, "cargarProyecto NUNCA debe propagar el trap del Proxy")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  assert.equal(r.motivos[0].categoria, "estructural")
  assert.equal(r.motivos[0].clasificacion, "rechazo")
})

test("cargarProyecto(objetoJS) con un Proxy que lanza en 'getOwnPropertyDescriptor' en propiedades de un componente nunca crashea crudo, se rechaza (hallazgo externo RX2-03a)", () => {
  const doc = documentoValido()
  doc.componentes[0].propiedades = new Proxy(
    { color: "rojo" },
    {
      getOwnPropertyDescriptor() {
        throw new Error("proxy-getOwnPropertyDescriptor-boom")
      },
    },
  )
  let r
  assert.doesNotThrow(() => {
    r = cargarProyecto(doc)
  }, "cargarProyecto NUNCA debe propagar el trap del Proxy")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
})

test("cargarProyecto(objetoJS) con un getter (accessor real, no Proxy) que explota en la 2a lectura de pines nunca crashea crudo (hallazgo externo RX2-03a, variante TOCTOU)", () => {
  const doc = documentoValido()
  let lecturas = 0
  const pinesConGetterTOCTOU = {}
  Object.defineProperty(pinesConGetterTOCTOU, "anodo", {
    enumerable: true,
    get() {
      lecturas++
      if (lecturas === 1) return "GPIO1"
      throw new Error("getter boom en pines, 2a lectura")
    },
  })
  doc.componentes[0].pines = pinesConGetterTOCTOU
  let r
  assert.doesNotThrow(() => {
    r = cargarProyecto(doc)
  }, "cargarProyecto NUNCA debe propagar el getter, ni siquiera si la 1a lectura fue valida")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  // La materializacion lee por DESCRIPTOR: un accessor (get/set) se rechaza SIN
  // invocarlo nunca — nunca llega a haber una "2a lectura" que pueda divergir.
  assert.equal(lecturas, 0, "el getter NUNCA debe invocarse — se rechaza por ser un accessor, sin leerlo")
})

// RX2-03(b): el TOCTOU original usaba un Proxy con SÓLO el trap `get` (nunca
// `ownKeys`/`getOwnPropertyDescriptor` propios) — la materialización lee por
// DESCRIPTOR, nunca invocando `get`, así que este Proxy en particular NUNCA
// dispara su trap malicioso: la lectura por descriptor cae al comportamiento
// default (el descriptor REAL del target), y el dato termina aceptado tal cual
// está en el target — nunca el valor "cambiado" que el trap `get` hubiera
// devuelto. Documenta el comportamiento correcto (no un crash, tampoco una
// sustitución de valor) del mecanismo elegido.
test("Proxy con 'get' que cambia de valor entre llamadas nunca contamina la copia materializada — nunca se invoca 'get' (hallazgo externo RX2-03b, defensa por diseño)", () => {
  const doc = documentoValido()
  let llamadasGet = 0
  doc.componentes[0].pines = new Proxy(
    { anodo: "GPIO1" },
    {
      get(t, p) {
        llamadasGet++
        return llamadasGet <= 1 ? "GPIO1" : 42
      },
    },
  )
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true, "un Proxy cuyo UNICO trap es 'get' nunca dispara ese trap — se acepta el dato real del target")
  assert.equal(r.proyecto.componentes[0].pines.anodo, "GPIO1")
  assert.equal(llamadasGet, 0, "la materializacion lee por descriptor, nunca invoca 'get'")
})

// Mutación ronda 2 (M2/MUTATION_RESULTS_R2.md, R06): el mismo ataque de arriba,
// pero en un campo RAÍZ DECLARADO del documento (`componentes`, no un campo
// anidado/desconocido dentro de un componente) — el gap que R06 encontró era
// específico de `proyectoInicial` (ver nucleo-motor.test.mjs), pero el mismo
// principio se verifica acá para `cargarProyecto(objeto)`: la materialización
// corre sobre el documento COMPLETO, sin importar en qué nivel esté el accessor.
test("cargarProyecto(objetoJS) con un accessor en un campo RAIZ DECLARADO del documento (componentes) nunca crashea crudo (hallazgo externo RX2-03, campo raiz)", () => {
  const doc = documentoValido()
  const componentesReales = doc.componentes
  delete doc.componentes
  Object.defineProperty(doc, "componentes", {
    enumerable: true,
    get() {
      throw new Error("getter boom en campo raiz declarado (componentes)")
    },
  })
  let r
  assert.doesNotThrow(() => {
    r = cargarProyecto(doc)
  }, "cargarProyecto NUNCA debe propagar un Error crudo por un accessor en un campo raiz declarado")
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  assert.equal(r.motivos[0].clasificacion, "rechazo")
  void componentesReales // referencia retenida sólo para dejar constancia de qué se reemplazó
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — revisión adversarial independiente
// #3, RX3_REPORT.md): reabre, en forma PEOR (alcanzable con JSON PURO, sin Proxies ni
// getters in-process), la clase que RX2 declaró cerrada. `materializarDatosPlanos`
// construía su copia con `copia[clave] = valor` sobre un objeto `{}` — hereda el setter
// mágico `Object.prototype.__proto__`. Una clave literal "__proto__" en CUALQUIER
// objeto anidado de un documento JSON VÁLIDO reemplazaba el prototipo de la copia en
// vez de crear una propiedad propia: bypaseaba `CLAVE_DESCONOCIDA` en la raíz (la
// clave ya no aparecía en `Object.keys`) y hacía desaparecer datos en silencio dentro
// de `propiedades` (bolsa abierta) — la "reparación silenciosa" que el brief prohíbe.
//
// FIX DE RAÍZ (ver DECISIONS.md, entrada RX3-01, y evidencia/RX3fix/causa.md): el
// contenedor (`copia`/`pinesCopiados`) se construye con `Object.defineProperty`, nunca
// asignación por corchetes — con eso, NINGÚN nombre de clave tiene efecto especial.
// Los tests de acá abajo demuestran las DOS mitades del contrato resultante:
// - Una entidad de forma CERRADA (raíz del documento, `Componente`/`Conexion`/
//   `ComportamientoRegla`) rechaza `"__proto__"`/`"constructor"`/`"prototype"` con
//   `CLAVE_DESCONOCIDA` — EXACTAMENTE el mismo mecanismo que rechaza cualquier otra
//   clave no declarada (`clavesDesconocidasDe`/`Object.keys` contra la lista
//   conocida), nunca un código especial por el nombre de la clave.
// - Una bolsa ABIERTA (`propiedades` de un `Componente`, y `pines` — que tampoco
//   valida nombres de terminal, sólo tipos de valor) ACEPTA esas mismas claves como
//   dato ORDINARIO: preservado exacto, sin cambiar el prototipo del objeto que las
//   contiene, indistinguible de cualquier otra clave.
//
// NOTA METODOLÓGICA (del propio RX3_REPORT): el ataque se construye como TEXTO JSON
// crudo + `JSON.parse` — NUNCA un literal de objeto JS `{"__proto__": x}`, que la
// gramática del LENGUAJE interpreta como prototipo en tiempo de parseo del código
// fuente (un mecanismo distinto). `JSON.parse` en cambio produce una propiedad OWN
// literal "__proto__" (vía `CreateDataProperty`, nunca `[[Set]]`) — exactamente lo que
// mandaría un cliente HTTP real, sin ningún truco in-process.
// ════════════════════════════════════════════════════════════════════════════════════

function conClaveInyectada(objetoBase, ancla, clave, valorJSON) {
  const json = JSON.stringify(objetoBase)
  assert.ok(json.includes(ancla), `ancla de prueba no encontrada en el JSON generado: ${ancla}`)
  return json.replace(ancla, `${ancla},${JSON.stringify(clave)}:${valorJSON}`)
}

function documentoConPropiedades() {
  const doc = documentoValido()
  doc.componentes[0].propiedades = { color: "rojo" }
  return doc
}

const CLAVES_PELIGROSAS = ["__proto__", "constructor", "prototype"]

// ── Grupo 1: forma CERRADA — rechaza con CLAVE_DESCONOCIDA, igual que cualquier otra
// clave no declarada, sin importar el nombre.
const CASOS_CERRADOS = [
  { nombre: "raiz del documento", ancla: '"id":"proy-doc-1"', doc: documentoValido },
  { nombre: "un componente", ancla: '"id":"cmp-0"', doc: documentoValido },
  { nombre: "extremo 'desde' de una conexion", ancla: '"componente":"cmp-0","terminal":"anodo"', doc: documentoValido },
  { nombre: "un comportamiento", ancla: '"id":"beh-0"', doc: documentoValido },
]

for (const caso of CASOS_CERRADOS) {
  for (const clave of CLAVES_PELIGROSAS) {
    test(`cargarProyecto(string) rechaza "${clave}" como clave en ${caso.nombre} con CLAVE_DESCONOCIDA — mismo mecanismo que cualquier clave no declarada (hallazgo externo RX3-01)`, () => {
      const jsonTexto = conClaveInyectada(caso.doc(), caso.ancla, clave, '{"pwned":true}')
      const r = cargarProyecto(jsonTexto)
      assert.equal(r.ok, false, `se esperaba rechazo para "${clave}" en ${caso.nombre}`)
      assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA", `codigo real: ${r.motivos[0].codigo} — datos: ${JSON.stringify(r.motivos[0].datos)}`)
    })

    test(`cargarProyecto(objeto ya parseado) rechaza "${clave}" en ${caso.nombre} — MISMO veredicto que la puerta string (hallazgo externo RX3-01)`, () => {
      const jsonTexto = conClaveInyectada(caso.doc(), caso.ancla, clave, '{"pwned":true}')
      const r = cargarProyecto(JSON.parse(jsonTexto))
      assert.equal(r.ok, false, `se esperaba rechazo para "${clave}" en ${caso.nombre}`)
      assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
    })
  }
}

// ── Grupo 2: bolsa ABIERTA — acepta como dato ordinario, preservado exacto, sin
// corromper el prototipo del contenedor.
const CASOS_ABIERTOS = [
  { nombre: "propiedades de un componente (bolsa abierta)", ancla: '"color":"rojo"', doc: documentoConPropiedades, nodo: (p) => p.componentes[0].propiedades, valorJSON: '{"pwned":true}', valorEsperado: { pwned: true } },
  { nombre: "pines de un componente (nombre de terminal no validado por Gate 2/4)", ancla: '"anodo":"GPIO23"', doc: documentoValido, nodo: (p) => p.componentes[0].pines, valorJSON: '"GPIO99"', valorEsperado: "GPIO99" },
]

for (const caso of CASOS_ABIERTOS) {
  for (const clave of CLAVES_PELIGROSAS) {
    test(`cargarProyecto(string) ACEPTA "${clave}" en ${caso.nombre} como dato ORDINARIO — prototipo intacto, valor preservado (hallazgo externo RX3-01, fix de raiz)`, () => {
      const jsonTexto = conClaveInyectada(caso.doc(), caso.ancla, clave, caso.valorJSON)
      const r = cargarProyecto(jsonTexto)
      assert.equal(r.ok, true, `se esperaba aceptación para "${clave}" en ${caso.nombre}: ${r.ok ? "" : JSON.stringify(r.motivos)}`)
      const nodo = caso.nodo(r.proyecto)
      assert.equal(Object.getPrototypeOf(nodo), Object.prototype, `el prototipo de ${caso.nombre} nunca puede cambiar por el nombre de una clave`)
      assert.deepEqual(nodo[clave], caso.valorEsperado, `"${clave}" debe preservarse EXACTO, nunca perderse en silencio`)
    })

    test(`cargarProyecto(objeto ya parseado) ACEPTA "${clave}" en ${caso.nombre} — MISMO veredicto que la puerta string (hallazgo externo RX3-01, fix de raiz)`, () => {
      const jsonTexto = conClaveInyectada(caso.doc(), caso.ancla, clave, caso.valorJSON)
      const objetoParseado = JSON.parse(jsonTexto)
      const r = cargarProyecto(objetoParseado)
      assert.equal(r.ok, true, `se esperaba aceptación para "${clave}" en ${caso.nombre}`)
      const nodo = caso.nodo(r.proyecto)
      assert.deepEqual(nodo[clave], caso.valorEsperado)
    })
  }
}

test("control: una clave desconocida COMUN en la raiz sigue rechazando con CLAVE_DESCONOCIDA — mismo codigo que '__proto__'/'constructor'/'prototype', sin ningun caso especial por nombre", () => {
  const doc = documentoValido()
  doc.hackeado = true
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

test("regresion (adaptado de phase1_auditoria_externa/evidencia/e1/exp_proto_pollution.mjs): '__proto__' en pines Y en propiedades (con 'constructor.prototype' anidado) se ACEPTA como dato ordinario, preservado exacto, nunca contamina Object.prototype global", () => {
  const raw =
    '{"id":"p1","schemaVersion":"' +
    SCHEMA_VERSION_SOPORTADA +
    '","catalogoVersion":"1.0.0","catalogoHash":"h","revision":0,"siguienteIdLocal":1,"placa":null,"componentes":[{"id":"cmp-0","tipo":"led","pines":{"__proto__":"GPIO1"},"propiedades":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}}],"conexiones":[],"comportamientos":[],"metadata":{"creadoEn":"x"}}'
  const r = cargarProyecto(raw)
  assert.equal(r.ok, true, `se esperaba aceptacion: ${r.ok ? "" : JSON.stringify(r.motivos)}`)
  const comp = r.proyecto.componentes[0]
  assert.equal(Object.getPrototypeOf(comp.pines), Object.prototype)
  assert.equal(Object.getPrototypeOf(comp.propiedades), Object.prototype)
  assert.equal(comp.pines.__proto__, "GPIO1", "el dato se preserva, nunca desaparece en silencio")
  assert.deepEqual(comp.propiedades.__proto__, { polluted: true })
  assert.equal(comp.propiedades.constructor.prototype.polluted2, true)
  assert.equal(({}).polluted, undefined, "Object.prototype global NUNCA se contamina")
  assert.equal(({}).polluted2, undefined, "Object.prototype global NUNCA se contamina")

  // '__proto__' como clave TOP-LEVEL del documento: rechaza con CLAVE_DESCONOCIDA,
  // el MISMO mecanismo fail-closed que cualquier otra clave de raíz no declarada —
  // antes de este fix (primera version, ver commit anterior) desaparecía de
  // Object.keys(doc) y bypaseaba esa puerta en silencio.
  const raw2 =
    '{"__proto__": {"x":1}, "id":"p1","schemaVersion":"' +
    SCHEMA_VERSION_SOPORTADA +
    '","catalogoVersion":"1.0.0","catalogoHash":"h","revision":0,"siguienteIdLocal":0,"placa":null,"componentes":[],"conexiones":[],"comportamientos":[],"metadata":{"creadoEn":"x"}}'
  const r2 = cargarProyecto(raw2)
  assert.equal(r2.ok, false, "un documento con '__proto__' como clave RAIZ se rechaza — CLAVE_DESCONOCIDA, igual que cualquier otra clave de raiz no declarada")
  assert.equal(r2.motivos[0].codigo, "CLAVE_DESCONOCIDA")
  assert.ok(r2.motivos[0].datos.claves.includes("__proto__"))
})

test("round-trip: todo lo que cargarProyecto acepta, serializado a JSON y recargado, se acepta igual y queda canonicamente identico (no-regresion round-trip, RX2-03)", () => {
  const r1 = cargarProyecto(documentoValido())
  assert.equal(r1.ok, true)
  const serializado = JSON.stringify(r1.proyecto)
  const r2 = cargarProyecto(serializado)
  assert.equal(r2.ok, true, "el mismo documento, ya cargado una vez y vuelto a serializar/cargar, debe aceptarse igual")
  assert.equal(canonicalizar(r1.proyecto), canonicalizar(r2.proyecto), "round-trip debe ser canonicamente identico")
})

// ─────────────────────────── 5. id duplicado entre componentes rechaza ───────────────

test("id-duplicado-entre-componentes-rechaza", () => {
  const doc = documentoValido()
  doc.componentes[1].id = "cmp-0" // mismo id que componentes[0]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ID_DUPLICADO")
})

// ──────── 5b. id duplicado entre conexiones/comportamientos rechaza (hallazgo externo
// E1-02 — Phase 1.1: antes de este fix, `cargador.ts` sólo comparaba ids DENTRO de
// `componentes[]`; dos conexiones (o dos comportamientos) con el MISMO id cargaban
// ambas sin problema, y `Desconectar({conexion:"conn-0"})` habría borrado las DOS de
// una — pérdida silenciosa de intención, brief §8.1) ─────────────────────────────────

test("id-duplicado-entre-conexiones-rechaza (hallazgo externo E1-02)", () => {
  const doc = documentoValido()
  doc.conexiones = [
    { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } },
    { id: "conn-0", desde: { componente: "cmp-1", terminal: "senal" }, hasta: { componente: "cmp-0", terminal: "anodo" } },
  ]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ID_DUPLICADO")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

test("id-duplicado-entre-comportamientos-rechaza (hallazgo externo E1-02)", () => {
  const doc = documentoValido()
  doc.comportamientos = [
    { id: "beh-0", cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } },
    { id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: "<", umbral: { valor: 10, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "apagar" } },
  ]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "ID_DUPLICADO")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

// ──────── 5c. contador de ids locales inconsistente rechaza (hallazgo externo E1-01 —
// Phase 1.1: antes de este fix, `cargador.ts` sólo validaba que `siguienteIdLocal`
// fuera un entero >= 0, nunca que fuera mayor que cualquier id local YA presente —
// un documento con `cmp-0` y `siguienteIdLocal:0` cargaba igual, y la PRÓXIMA
// `AgregarComponente` reproducía "cmp-0" — ver evidencia/e1/exp_contador_inconsistente.mjs) ──

test("contador-siguienteIdLocal-inconsistente-con-id-existente-rechaza (hallazgo externo E1-01)", () => {
  const doc = {
    id: "p1",
    schemaVersion: SCHEMA_VERSION_SOPORTADA,
    catalogoVersion: "1.0.0",
    catalogoHash: "h",
    revision: 0,
    siguienteIdLocal: 0, // desincronizado: cmp-0 YA existe, así que el próximo id colisionaría
    placa: null,
    componentes: [{ id: "cmp-0", tipo: "led", pines: {}, propiedades: {} }],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CONTADOR_ID_INCONSISTENTE")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

test("contador-siguienteIdLocal-igual-al-maximo-existente-rechaza (borde estricto, E1-01)", () => {
  // El máximo id local real en documentoValido() es 1 (cmp-1) — el contador tiene que
  // ser ESTRICTAMENTE mayor, no sólo "no menor".
  const doc = documentoValido()
  doc.siguienteIdLocal = 1
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CONTADOR_ID_INCONSISTENTE")
})

// ──────── 5d. self-loop / conexión duplicada al cargar rechaza (hallazgo externo
// E2-01, CRÍTICO — Phase 1.1: antes de este fix, "sin auto-conexión / sin conexión
// duplicada" sólo existía como chequeo ad-hoc DENTRO de `aplicarConectar`
// (`operaciones.ts`); un documento con self-loop o con dos conexiones que conectan el
// MISMO par de terminales cargaba SIN NINGÚN diagnóstico, llegando a `listo:true`
// — ver evidencia/e2/exp1b_selfloop_listo_true.mjs) ──────────────────────────────────

test("loader-rechaza-documento-con-selfloop (hallazgo externo E2-01)", () => {
  const doc = documentoValido()
  doc.conexiones = [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-0", terminal: "anodo" } }]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "AUTOCONEXION_INVALIDA_AL_CARGAR")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

test("loader-rechaza-documento-con-conexion-duplicada (hallazgo externo E2-01)", () => {
  const doc = documentoValido()
  doc.conexiones = [
    { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } },
    // MISMO par que conn-0, con los extremos invertidos — "misma conexión" no depende
    // del orden (decisión YA vigente antes de Phase 1.1, ver conexion.ts).
    { id: "conn-1", desde: { componente: "cmp-1", terminal: "senal" }, hasta: { componente: "cmp-0", terminal: "anodo" } },
  ]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CONEXION_DUPLICADA_AL_CARGAR")
  assert.equal("proyecto" in r, false, "un rechazo nunca trae un proyecto parcial")
})

// No-regresión (cuidado con sobre-rechazo): dos conexiones DISTINTAS que comparten un
// terminal (mismo componente/terminal en un extremo, pero el OTRO extremo difiere) no
// son ni self-loop ni duplicado — tienen que seguir cargando bien.
test("loader-dos-conexiones-que-comparten-terminal-pero-son-distintas-carga-bien (no regresión, E2-01)", () => {
  const doc = documentoValido()
  doc.componentes.push({ id: "cmp-2", tipo: "resistencia", pines: {}, propiedades: {} })
  doc.siguienteIdLocal = 4
  doc.conexiones = [
    { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } },
    { id: "conn-1", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-2", terminal: "a" } },
  ]
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true, `no debería rechazar dos conexiones distintas que comparten un terminal: ${JSON.stringify(r.ok ? null : r.motivos)}`)
  assert.equal(r.proyecto.conexiones.length, 2)
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

// ═══ Phase 1.1 (hallazgo externo E1-03, CRÍTICO) — `typeof umbral.valor !== "number"`
// NO alcanza: `typeof NaN === "number"` y `typeof Infinity === "number"` son ciertos
// los dos, así que el chequeo de forma existente los dejaba pasar. Ninguno de los
// dos es representable en el documento JSON persistido (`JSON.stringify(NaN)`/
// `JSON.stringify(Infinity)` dan `null`, `canonico.ts`) — `cargarProyecto()` acepta
// `unknown` ya parseado (no sólo un string JSON real, que jamás podría producir
// NaN/Infinity), así que esta puerta sigue siendo necesaria como defensa en
// profundidad, no redundancia inútil (ver IR-SPEC.md §6.2). ═══════════════════════

test("umbral-nan-al-cargar-rechaza (hallazgo externo E1-03)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = NaN
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "UMBRAL_NO_FINITO_AL_CARGAR")
})

test("umbral-infinito-positivo-al-cargar-rechaza (hallazgo externo E1-03)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = Infinity
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "UMBRAL_NO_FINITO_AL_CARGAR")
})

test("umbral-infinito-negativo-al-cargar-rechaza (hallazgo externo E1-03)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = -Infinity
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "UMBRAL_NO_FINITO_AL_CARGAR")
})

// No-regresión: 0 y una temperatura negativa (-40°C) son umbrales finitos y válidos
// — el documento tiene que seguir cargando bien, nunca rechazarse por esto.
test("umbral-cero-al-cargar-carga-bien (no regresión, E1-03)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = 0
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, 0)
})

test("umbral-temperatura-negativa-al-cargar-carga-bien (no regresión, E1-03)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = -40
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, -40)
})

// Phase 1.1 (RX4, NOTE): `-0` al cargar sobrevive como `Object.is(v, 0)` en memoria
// — no como `-0` (que se persiste igual como "0" en disco, así que preservar `-0` en
// memoria era una divergencia real memoria/disco). `-40` (arriba) y `0` no cambian de
// comportamiento — control expreso de que la normalizacion NO afecta ningun otro
// veredicto.
test("umbral -0 al cargar carga bien y se normaliza a 0 — Object.is(v,0), no Object.is(v,-0) (hallazgo RX4, NOTE)", () => {
  const doc = documentoValido()
  doc.comportamientos[0].cuando.umbral.valor = -0
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.ok(Object.is(r.proyecto.comportamientos[0].cuando.umbral.valor, 0), "en memoria queda 0, nunca -0")
  assert.ok(!Object.is(r.proyecto.comportamientos[0].cuando.umbral.valor, -0))
  assert.equal(canonicalizar(r.proyecto).includes('"valor":-0'), false, "el canonico nunca serializa -0")
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

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX4, hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial
// independiente, RX4_REPORT.md; RECLASIFICA E1-04, ver DECISIONS.md): `esEnteroNoNegativo`
// aceptaba enteros SIN cota superior (`Number.isInteger(1e21) === true`). Con
// `revision: 1e21`, el documento cargaba sin diagnóstico — y `1e21 + 1 === 1e21`
// (colapso de precisión IEEE-754 más allá de `Number.MAX_SAFE_INTEGER`), así que el
// próximo commit congelaba la revisión para siempre, neutralizando en silencio el
// compare-and-swap optimista (E3-01/E3-07, brief §33). El invariante ("el INCREMENTO
// de revision tiene que ser exacto") deriva la cota: `Number.isSafeInteger`, no una
// regla de producto arbitraria. Ver `nucleo-motor.test.mjs` para el comportamiento en
// el COMMIT (revision congelada en MAX_SAFE_INTEGER-1 -> MAX_SAFE_INTEGER, y el
// siguiente commit se rechaza sin cambiar nada).
// ════════════════════════════════════════════════════════════════════════════════════

test("revision mas alla de Number.MAX_SAFE_INTEGER rechaza al cargar (hallazgo externo RX4-02)", () => {
  const casos = [
    { nombre: "1e21", valor: 1e21 },
    { nombre: "2**53 (justo arriba de MAX_SAFE_INTEGER)", valor: 2 ** 53 },
    { nombre: "MAX_SAFE_INTEGER + 1", valor: Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const { nombre, valor } of casos) {
    const doc = { ...documentoValido(), revision: valor }
    const r = cargarProyecto(doc)
    assert.equal(r.ok, false, `revision=${nombre}: debe rechazar`)
    assert.equal(r.motivos[0].codigo, "CAMPO_REQUERIDO_FALTANTE", `revision=${nombre}: mismo codigo que cualquier otro valor de forma invalida para 'revision'`)
    assert.deepEqual(r.motivos[0].datos, { campo: "revision" }, `revision=${nombre}`)
  }
})

test("revision === Number.MAX_SAFE_INTEGER - 1 carga sin problema (limite exacto, no regresion RX4-02)", () => {
  const doc = { ...documentoValido(), revision: Number.MAX_SAFE_INTEGER - 1 }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.revision, Number.MAX_SAFE_INTEGER - 1)
})

test("revision === Number.MAX_SAFE_INTEGER carga sin problema (limite exacto, no regresion RX4-02)", () => {
  const doc = { ...documentoValido(), revision: Number.MAX_SAFE_INTEGER }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.revision, Number.MAX_SAFE_INTEGER)
})

test("siguienteIdLocal mas alla de Number.MAX_SAFE_INTEGER rechaza al cargar (hallazgo externo RX4-02, misma cota)", () => {
  const doc = { ...documentoValido(), siguienteIdLocal: 1e21 }
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CAMPO_REQUERIDO_FALTANTE")
  assert.deepEqual(r.motivos[0].datos, { campo: "siguienteIdLocal" })
})
