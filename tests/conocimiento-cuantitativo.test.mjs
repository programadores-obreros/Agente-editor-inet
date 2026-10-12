// CK-REQ-N1 — contrato de capacidades cuantitativas de Component Knowledge.
// Matriz A–J del gate (`component-knowledge/CK_REQ_N1_IMPLEMENTED_CONTRACT.md`). Todo contra
// la fachada REAL (`CONOCIMIENTO_ACTIVO`) y, cuando hace falta un caso que el catálogo real no
// tiene, contra un catálogo sintético construido con la misma `construirCatalogo` (nunca
// mutando el catálogo real).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { CONOCIMIENTO_ACTIVO: k } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { CIFRAS_SIGNIFICATIVAS_DE_ESCALA, normalizarResultado } = await import(join(REPO, "opencode/conocimiento/cuantitativo.ts"))
const { admitirComponente, oficialmenteSoportados } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { construirCatalogo, proyeccionSemanticaCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { UNIDADES, MAGNITUDES, unidadesDeMagnitud } = await import(join(REPO, "opencode/nucleo/registros/vocabulario.ts"))
const { MAGNITUD_BOOLEANA } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const catalogo = k.catalogo
const valorDe = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.valor
}
const codigoDe = (r) => {
  assert.equal(r.ok, false, JSON.stringify(r))
  return r.error.codigo
}
const cantidad = (valor, unidad, magnitud) => ({ valor, unidad, magnitud })

/** Fachada sobre un catálogo sintético: el real + `extras`, con `conversiones` a elección. */
function conocimientoCon(extras = [], conversiones = CONVERSIONES_UNIDAD_MINIMAS) {
  return crearConocimiento(construirCatalogo({ version: "0.0.0-fixture", componentes: [...COMPONENTES_CATALOGO_MINIMO, ...extras], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones } }, sha256Hex))
}
const sensorSintetico = (id, capacidades) => ({ id, clase: "sensor", terminales: [{ id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" }], capacidades, requisitos: [] })

// ════════════════════════════════════════════════════════════════════════════════════
// A. Descubrimiento genérico
// ════════════════════════════════════════════════════════════════════════════════════

test("A: para TODO tipo del catálogo, las cuantitativas son exactamente las capacidades de magnitud registrada no booleana", () => {
  for (const c of catalogo.componentes) {
    const esperadas = c.capacidades.filter((x) => x.magnitud !== undefined && Object.hasOwn(MAGNITUDES, x.magnitud) && x.magnitud !== MAGNITUD_BOOLEANA).map((x) => x.id)
    assert.deepEqual(valorDe(k.capacidadesCuantitativas(c.id)).map((x) => x.capacidad), esperadas, c.id)
  }
})

test("A: datos reales — dht22 expone temperatura y humedad; ntc, temperatura; las entradas booleanas, ninguna", () => {
  assert.deepEqual(valorDe(k.capacidadesCuantitativas("dht22")).map((x) => [x.capacidad, x.magnitud, x.unidadCanonica]), [["temperatura", "temperatura", "celsius"], ["humedad", "humedad", "porcentaje"]])
  assert.deepEqual(valorDe(k.capacidadesCuantitativas("ntc")).map((x) => x.capacidad), ["temperatura"])
  for (const tipo of ["pulsador", "interruptor", "led", "resistencia"]) assert.deepEqual(valorDe(k.capacidadesCuantitativas(tipo)), [], tipo)
})

test("A: errores estructurados de consulta (sin prosa)", () => {
  assert.equal(codigoDe(k.capacidadesCuantitativas("no-existe")), "COMPONENTE_INEXISTENTE")
  assert.equal(codigoDe(k.capacidadCuantitativa("no-existe", "temperatura")), "COMPONENTE_INEXISTENTE")
  assert.equal(codigoDe(k.capacidadCuantitativa("dht22", "presion")), "CAPACIDAD_INEXISTENTE")
  assert.equal(codigoDe(k.capacidadCuantitativa("pulsador", "estadoBooleano")), "CAPACIDAD_NO_CUANTITATIVA")
  assert.equal(codigoDe(k.unidad("kelvin")), "UNIDAD_DESCONOCIDA")
})

test("A: todo lo que devuelve la fachada está congelado y es determinista", () => {
  const a = k.capacidadesCuantitativas("dht22")
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.valor) && a.valor.every((c) => Object.isFrozen(c) && Object.isFrozen(c.unidades)))
  assert.deepEqual(k.capacidadesCuantitativas("dht22"), a)
  const conv = k.convertirCantidad(cantidad(30, "celsius", "temperatura"), "fahrenheit")
  assert.ok(Object.isFrozen(conv) && Object.isFrozen(conv.valor))
})

// ════════════════════════════════════════════════════════════════════════════════════
// B. Magnitud / unidad
// ════════════════════════════════════════════════════════════════════════════════════

test("B: unidad canónica y unidades ofrecidas son válidas para la magnitud; símbolo y UCUM salen del registro", () => {
  for (const c of catalogo.componentes) {
    for (const q of valorDe(k.capacidadesCuantitativas(c.id))) {
      assert.ok(unidadesDeMagnitud(q.magnitud).includes(q.unidadCanonica), `${c.id}.${q.capacidad}`)
      assert.equal(q.unidades[0].id, q.unidadCanonica)
      assert.equal(q.unidades[0].canonica, true)
      assert.equal(new Set(q.unidades.map((u) => u.id)).size, q.unidades.length)
      for (const u of q.unidades) {
        assert.ok(unidadesDeMagnitud(q.magnitud).includes(u.id), `${c.id}.${q.capacidad}: ${u.id}`)
        assert.equal(u.simbolo, UNIDADES[u.id].simbolo)
        assert.equal(u.ucum, UNIDADES[u.id].ucum)
      }
    }
  }
  assert.deepEqual(valorDe(k.unidad("celsius")), { id: "celsius", simbolo: UNIDADES.celsius.simbolo, ucum: UNIDADES.celsius.ucum })
})

test("B: sólo se ofrece una unidad alternativa si la conversión está declarada en los DOS sentidos", () => {
  const temp = valorDe(k.capacidadCuantitativa("dht22", "temperatura"))
  assert.deepEqual(temp.unidades.map((u) => [u.id, u.canonica]), [["celsius", true], ["fahrenheit", false]])
  const soloIda = conocimientoCon([], CONVERSIONES_UNIDAD_MINIMAS.filter((c) => c.de === "celsius"))
  assert.deepEqual(valorDe(soloIda.capacidadCuantitativa("dht22", "temperatura")).unidades.map((u) => u.id), ["celsius"])
  const sinConversiones = conocimientoCon([], [])
  assert.deepEqual(valorDe(sinConversiones.capacidadCuantitativa("dht22", "temperatura")).unidades.map((u) => u.id), ["celsius"])
})

// ════════════════════════════════════════════════════════════════════════════════════
// C. Disponibilidad semántica ≠ officiallySupported (N-4)
// ════════════════════════════════════════════════════════════════════════════════════

test("C: disponibilidad semántica explícita e independiente de officiallySupported", () => {
  const oficiales = new Set(oficialmenteSoportados(k))
  // CK-CG1: el DHT22 es oficial y el NTC no; los dos tienen la MISMA disponibilidad semántica.
  for (const [tipo, oficial] of [["dht22", true], ["ntc", false]]) {
    assert.equal(admitirComponente(k, tipo).officiallySupported, oficial, `${tipo}: oficial = ${oficial}`)
    for (const q of valorDe(k.capacidadesCuantitativas(tipo))) assert.deepEqual(q.disponibilidadSemantica, { disponible: true, motivos: [] }, `${tipo}.${q.capacidad}`)
  }
  assert.ok(oficiales.has("dht22") && !oficiales.has("ntc"))
  // y al revés: oficial no implica tener capacidades cuantitativas disponibles
  assert.ok(oficiales.has("interruptor"))
  assert.deepEqual(valorDe(k.capacidadesCuantitativas("interruptor")), [])
})

test("C: la disponibilidad depende de la coherencia del conocimiento de la capacidad, con motivos estables", () => {
  const malo = conocimientoCon([
    sensorSintetico("sensor-unidad-equivocada-fixture", [{ id: "temperatura", magnitud: "temperatura", unidad: "porcentaje" }]),
    sensorSintetico("sensor-rango-invertido-fixture", [{ id: "temperatura", magnitud: "temperatura", unidad: "celsius", rango: { min: { valor: 50, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 10, unidad: "celsius", magnitud: "temperatura" } } }]),
    sensorSintetico("sensor-resolucion-cero-fixture", [{ id: "temperatura", magnitud: "temperatura", unidad: "celsius", resolucion: { valor: 0, unidad: "celsius", magnitud: "temperatura" } }]),
  ])
  const motivos = (tipo) => valorDe(malo.capacidadCuantitativa(tipo, "temperatura")).disponibilidadSemantica
  assert.deepEqual(motivos("sensor-unidad-equivocada-fixture"), { disponible: false, motivos: ["UNIDAD_INCOMPATIBLE_CON_MAGNITUD"] })
  assert.deepEqual(motivos("sensor-rango-invertido-fixture"), { disponible: false, motivos: ["RANGO_INVALIDO"] })
  assert.deepEqual(motivos("sensor-resolucion-cero-fixture"), { disponible: false, motivos: ["RESOLUCION_INVALIDA"] })
  assert.equal(codigoDe(malo.convertirParaCapacidad("sensor-rango-invertido-fixture", "temperatura", cantidad(20, "celsius", "temperatura"), "fahrenheit")), "CAPACIDAD_NO_DISPONIBLE")
})

// ════════════════════════════════════════════════════════════════════════════════════
// D. Conversión (N-3) y normalización
// ════════════════════════════════════════════════════════════════════════════════════

test("D: 30 °C → 86 °F y 86 °F → 30 °C (se conserva la cantidad física, no el número)", () => {
  assert.deepEqual(valorDe(k.convertirCantidad(cantidad(30, "celsius", "temperatura"), "fahrenheit")), { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
  assert.deepEqual(valorDe(k.convertirCantidad(cantidad(86, "fahrenheit", "temperatura"), "celsius")), { valor: 30, unidad: "celsius", magnitud: "temperatura" })
  assert.deepEqual(valorDe(k.convertirParaCapacidad("dht22", "temperatura", cantidad(30, "celsius", "temperatura"), "fahrenheit")), { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
})

test("D: decimales representativos sin basura binaria visible (los casos del diseño de Claude A incluidos)", () => {
  const casos = [
    [18, 64.4], [37.7, 99.86], [0.1, 32.18], [-40, -40], [-273.15, -459.67], [36.6, 97.88], [100, 212], [-17.8, -0.04], [25.5, 77.9], [0, 32], [1e-6, 32.0000018],
  ]
  for (const [c, f] of casos) {
    assert.equal(valorDe(k.convertirCantidad(cantidad(c, "celsius", "temperatura"), "fahrenheit")).valor, f, `${c} °C`)
    assert.equal(valorDe(k.convertirCantidad(cantidad(f, "fahrenheit", "temperatura"), "celsius")).valor, c, `${f} °F`)
  }
})

const aF = (v) => valorDe(k.convertirCantidad(cantidad(v, "celsius", "temperatura"), "fahrenheit")).valor
const aC = (v) => valorDe(k.convertirCantidad(cantidad(v, "fahrenheit", "temperatura"), "celsius")).valor

test("D: ida y vuelta EXACTA cuando el valor intermedio tiene decimal finito: todo °C con 2 decimales entre -273,15 y 1000", () => {
  for (let i = -27315; i <= 100000; i++) {
    const v = i / 100
    assert.equal(aC(aF(v)), v, `${v} °C`)
  }
})

test("D: si el intermedio es periódico (°F → °C, factor 5/9): error ≤ 1 cuanto por ida y vuelta, y SIN deriva en ciclos repetidos", () => {
  // cuanto = 10^(E − 11), con E el exponente decimal de la escala de la cuenta
  const cuantoDe = (escala) => Number(`1e${Number(escala.toExponential().split("e")[1]) - (CIFRAS_SIGNIFICATIVAS_DE_ESCALA - 1)}`)
  let inexactas = 0
  for (let i = -4597; i <= 18320; i++) {
    const v = i / 10
    const c = aC(v)
    const vuelta = aF(c)
    const cuanto = cuantoDe(Math.max(Math.abs(v), Math.abs(c) * 1.8, 32, Math.abs(vuelta)))
    // margen de 0,1 % del cuanto: es el ruido de la RESTA del test (ulps de ~459), no de la política
    assert.ok(Math.abs(vuelta - v) <= cuanto * 1.001, `${v} °F → ${c} °C → ${vuelta} °F`)
    if (vuelta !== v) inexactas++
    // ciclos repetidos: el desvío no crece (acotado por un cuanto) y la secuencia se estabiliza
    let x = vuelta
    for (let n = 0; n < 20; n++) x = aF(aC(x))
    assert.ok(Math.abs(x - v) <= cuanto * 1.001, `deriva desde ${v} °F: ${x}`)
    const siguiente = aF(aC(x))
    assert.ok(siguiente === x || aF(aC(siguiente)) === x, `${v} °F termina en punto fijo o período 2`)
  }
  assert.ok(inexactas > 0, "el caso periódico existe de verdad (si no, este test no prueba nada)")
})

test("D: la normalización es un redondeo a la escala de la cuenta: nunca -0, sub-cuanto a 0, determinista", () => {
  assert.equal(CIFRAS_SIGNIFICATIVAS_DE_ESCALA, 12)
  assert.ok(Object.is(normalizarResultado(-0, 1), 0))
  assert.equal(normalizarResultado(18.000000000000007, 64.4), 18)
  assert.equal(normalizarResultado(1.4210854715202004e-14, 32), 0, "ruido de cancelación cerca de cero")
  assert.equal(normalizarResultado(123456789.123456789, 123456789.123456789), 123456789.123)
  assert.equal(normalizarResultado(0.000123456789012345, 0.000123456789012345), 0.000123456789012)
  for (let i = 0; i < 3; i++) assert.equal(normalizarResultado(99.86000000000001, 99.86000000000001), 99.86)
})

test("D: fallas de conversión estructuradas", () => {
  assert.equal(codigoDe(k.convertirCantidad(cantidad(Number.NaN, "celsius", "temperatura"), "fahrenheit")), "VALOR_NO_FINITO")
  assert.equal(codigoDe(k.convertirCantidad(cantidad(Number.POSITIVE_INFINITY, "celsius", "temperatura"), "fahrenheit")), "VALOR_NO_FINITO")
  assert.equal(codigoDe(k.convertirCantidad(cantidad("30", "celsius", "temperatura"), "fahrenheit")), "VALOR_NO_FINITO")
  assert.equal(codigoDe(k.convertirCantidad(cantidad(1e308, "celsius", "temperatura"), "fahrenheit")), "RESULTADO_NO_FINITO")
  assert.equal(codigoDe(k.convertirCantidad(cantidad(1, "celsius", "presion"), "fahrenheit")), "MAGNITUD_DESCONOCIDA")
  assert.equal(codigoDe(k.convertirCantidad(cantidad(1, "kelvin", "temperatura"), "celsius")), "UNIDAD_DESCONOCIDA")
  assert.equal(codigoDe(k.convertirCantidad(cantidad(50, "porcentaje", "humedad"), "celsius")), "UNIDAD_INCOMPATIBLE_CON_MAGNITUD")
  assert.equal(codigoDe(conocimientoCon([], []).convertirCantidad(cantidad(30, "celsius", "temperatura"), "fahrenheit")), "CONVERSION_NO_DECLARADA")
  assert.equal(codigoDe(k.convertirParaCapacidad("dht22", "humedad", cantidad(50, "porcentaje", "humedad"), "fahrenheit")), "UNIDAD_NO_OFRECIDA_POR_LA_CAPACIDAD")
  assert.equal(codigoDe(k.convertirParaCapacidad("dht22", "temperatura", cantidad(50, "porcentaje", "humedad"), "celsius")), "MAGNITUD_DISTINTA_DE_LA_CAPACIDAD")
  assert.equal(codigoDe(k.convertirParaCapacidad("pulsador", "estadoBooleano", cantidad(1, "ninguna", "estadoBooleano"), "ninguna")), "CAPACIDAD_NO_CUANTITATIVA")
  // misma unidad: el mismo valor, normalizado
  assert.deepEqual(valorDe(k.convertirCantidad(cantidad(18.000000000000007, "celsius", "temperatura"), "celsius")), { valor: 18, unidad: "celsius", magnitud: "temperatura" })
})

// ════════════════════════════════════════════════════════════════════════════════════
// E / F. Rango y resolución: sólo lo declarado
// ════════════════════════════════════════════════════════════════════════════════════

test("E: el rango expuesto es EXACTAMENTE el declarado en el catálogo; sin rango declarado, null", () => {
  for (const c of catalogo.componentes) {
    for (const q of valorDe(k.capacidadesCuantitativas(c.id))) assert.deepEqual(q.rango, c.capacidades.find((x) => x.id === q.capacidad).rango ?? null, `${c.id}.${q.capacidad}`)
  }
  const sinRango = conocimientoCon([sensorSintetico("sensor-sin-rango-fixture", [{ id: "temperatura", magnitud: "temperatura", unidad: "celsius" }])])
  assert.equal(valorDe(sinRango.capacidadCuantitativa("sensor-sin-rango-fixture", "temperatura")).rango, null)
})

test("F: la resolución sólo aparece si está declarada (es el dato del catálogo tal cual, o null)", () => {
  // Hasta CK-CG2 ninguna capacidad real la declaraba y el test exigía null para todas. El DHT11
  // (CK-CG2) declara 1 °C / 1 %RH, así que lo que se protege ahora es la regla, no el conteo:
  // la fachada devuelve exactamente la resolución declarada por el catálogo, y null si no hay.
  for (const c of catalogo.componentes) {
    for (const q of valorDe(k.capacidadesCuantitativas(c.id))) {
      const declarada = c.capacidades.find((x) => x.id === q.capacidad).resolucion ?? null
      assert.deepEqual(q.resolucion, declarada, `${c.id}.${q.capacidad}`)
    }
  }
  assert.ok(catalogo.componentes.some((c) => c.capacidades.some((x) => x.resolucion !== undefined)), "al menos una capacidad real la declara (dht11)")
  assert.ok(catalogo.componentes.some((c) => c.capacidades.some((x) => x.resolucion === undefined && x.magnitud !== undefined)), "y al menos una real no la declara")
  const res = { valor: 0.1, unidad: "celsius", magnitud: "temperatura" }
  const conRes = conocimientoCon([sensorSintetico("sensor-con-resolucion-fixture", [{ id: "temperatura", magnitud: "temperatura", unidad: "celsius", resolucion: res }])])
  assert.deepEqual(valorDe(conRes.capacidadCuantitativa("sensor-con-resolucion-fixture", "temperatura")).resolucion, res)
})

// ════════════════════════════════════════════════════════════════════════════════════
// G. Genericidad
// ════════════════════════════════════════════════════════════════════════════════════

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
function literales(ruta) {
  return [...sinComentarios(readFileSync(join(REPO, ruta), "utf8")).matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2])
}

test("G (estático): la fachada cuantitativa no nombra ningún componente, placa, capacidad, magnitud ni unidad", () => {
  const prohibidos = new Set([
    ...catalogo.componentes.map((c) => c.id),
    ...catalogo.placas.map((p) => p.id),
    ...catalogo.componentes.flatMap((c) => c.capacidades.map((x) => x.id)),
    ...Object.keys(MAGNITUDES),
    ...Object.keys(UNIDADES),
    ...Object.values(UNIDADES).map((u) => u.simbolo).filter((s) => s.length > 0),
  ])
  for (const ruta of ["opencode/conocimiento/cuantitativo.ts", "opencode/conocimiento/conocimiento.ts"]) {
    assert.deepEqual(literales(ruta).filter((l) => prohibidos.has(l)), [], ruta)
    assert.doesNotMatch(sinComentarios(readFileSync(join(REPO, ruta), "utf8")), /\b1\.8\b|\b32\b|5\s*\/\s*9/, `${ruta}: ninguna fórmula física en código`)
  }
})

test("G: un tipo nuevo con una magnitud registrada que ningún componente usa se descubre sólo con datos", () => {
  const conDistancia = conocimientoCon([sensorSintetico("sensor-distancia-fixture", [{ id: "distancia", magnitud: "distancia", unidad: "cm", rango: { min: { valor: 2, unidad: "cm", magnitud: "distancia" }, max: { valor: 400, unidad: "cm", magnitud: "distancia" } } }])])
  const q = valorDe(conDistancia.capacidadCuantitativa("sensor-distancia-fixture", "distancia"))
  assert.equal(q.magnitud, "distancia")
  assert.deepEqual(q.unidades.map((u) => [u.id, u.simbolo]), [["cm", UNIDADES.cm.simbolo]])
  assert.equal(q.disponibilidadSemantica.disponible, true)
  assert.equal(q.etiqueta, null, "sin rótulo en el anexo: null, nunca un texto inventado")
})

// ════════════════════════════════════════════════════════════════════════════════════
// H. Regresión
// ════════════════════════════════════════════════════════════════════════════════════

test("H: el conocimiento booleano y el interruptor no cambian", () => {
  assert.deepEqual(k.estadosDeEntrada("interruptor").map((e) => [e.etiqueta, e.valor]), [["cerrado", "verdadero"], ["abierto", "falso"]])
  assert.deepEqual(k.estadosDeEntrada("pulsador").map((e) => [e.etiqueta, e.valor]), [["presionado", "verdadero"], ["suelto", "falso"]])
  assert.equal(admitirComponente(k, "interruptor").officiallySupported, true)
  assert.deepEqual(oficialmenteSoportados(k), CATALOGO_FIJADO.oficiales)
})

test("H: todas las capacidades cuantitativas reales tienen rótulo pedagógico", () => {
  for (const c of catalogo.componentes) for (const q of valorDe(k.capacidadesCuantitativas(c.id))) assert.equal(typeof q.etiqueta, "string", `${c.id}.${q.capacidad}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// I. Identidad del catálogo
// ════════════════════════════════════════════════════════════════════════════════════

test("I: CK-REQ-N1 no cambia la identidad semántica (proyección canónica = identidad fijada)", () => {
  const datos = { version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }
  assert.equal(sha256Hex(canonicalizar(proyeccionSemanticaCatalogo(datos))), CATALOGO_FIJADO.hash)
  assert.equal(catalogo.hash, CATALOGO_FIJADO.hash)
  assert.equal(catalogo.version, CATALOGO_FIJADO.version)
})

test("I: las conversiones declaradas SÍ son semánticas (cambian el hash); los rótulos y la normalización no viven en el catálogo", () => {
  const base = conocimientoCon().catalogo.hash
  assert.notEqual(conocimientoCon([], []).catalogo.hash, base, "quitar las conversiones cambia el significado")
  assert.equal(JSON.stringify(proyeccionSemanticaCatalogo({ version: "x", componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } })).includes("humedad relativa"), false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// J. Un consumidor genérico puede armar "temperatura > 30 °C" sin saber física
// ════════════════════════════════════════════════════════════════════════════════════

/** Consumidor de ejemplo: no conoce componentes, símbolos ni fórmulas; sólo la fachada. */
function describirUmbral(conocimiento, tipo, capacidad, valor, unidadElegida) {
  const q = valorDe(conocimiento.capacidadCuantitativa(tipo, capacidad))
  if (!q.disponibilidadSemantica.disponible) return null
  const enCanonica = { valor, unidad: q.unidadCanonica, magnitud: q.magnitud }
  const umbral = unidadElegida === undefined ? enCanonica : valorDe(conocimiento.convertirParaCapacidad(tipo, capacidad, enCanonica, unidadElegida))
  const simbolo = q.unidades.find((u) => u.id === umbral.unidad).simbolo
  return { umbral, texto: `${q.etiqueta} > ${umbral.valor} ${simbolo}` }
}

test("J: el consumidor genérico arma la condición con conocimiento puro, y cambiar de unidad conserva la cantidad", () => {
  const enC = describirUmbral(k, "dht22", "temperatura", 30)
  assert.equal(enC.texto, "temperatura > 30 °C")
  assert.deepEqual(enC.umbral, { valor: 30, unidad: "celsius", magnitud: "temperatura" }, "forma de Cantidad persistible: valor + unidad + magnitud")
  assert.equal(describirUmbral(k, "dht22", "temperatura", 30, "fahrenheit").texto, "temperatura > 86 °F")
  assert.equal(describirUmbral(k, "ntc", "temperatura", 30).texto, "temperatura > 30 °C")
  assert.equal(describirUmbral(k, "dht22", "humedad", 70).texto, "humedad relativa > 70 %")
})
