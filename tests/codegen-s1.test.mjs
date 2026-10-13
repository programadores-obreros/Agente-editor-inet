// Codegen MVP, Slice 1 — IR → C++ determinista (Design Gate: GO_WITH_DECISIONS; OD-CG-1 = A
// ESP32, OD-CG-2 = A polaridad derivada, OD-CG-3 = A compilación opt-in).
//
// `generarPrograma(proyecto, conocimiento)` es una proyección pura de la IR. Estos tests usan
// proyectos armados con las operaciones REALES del Engine (`ejecutarOperacion`) y la fachada
// REAL de Component Knowledge. Los catálogos de prueba (construidos con el `construirCatalogo`
// real) existen sólo para formas que el catálogo real no tiene: cada uno dice por qué.
//
// La corrección no se juzga por un snapshot: el programa generado se EJECUTA (`ejecutar`, abajo)
// contra una placa simulada, y la estructura se prueba con invariantes. Hay un único golden,
// para lectura humana.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { generarPrograma, umbralEnUnidadDeLectura } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { nombreDePinArduino } = await import(join(REPO, "opencode/codegen/derivaciones.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { REVISIONES_DEL_ANEXO } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { condicionBooleanaCanonica } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════════════════════

/** Proyecto por las operaciones reales del Engine, con id y fecha fijos (determinismo). */
function construir(conocimiento, ops) {
  let p = crearProyecto({ catalogoVersion: conocimiento.catalogo.version, catalogoHash: conocimiento.catalogo.hash, generadorId: () => "proyecto-codegen", ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, conocimiento.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}

const BOOL = (valor) => condicionBooleanaCanonica("estadoBooleano", valor)
const regla = (cuando, actuador, accion, sensor = "cmp-0") => ["SetComportamiento", { comportamiento: { cuando: { sensor, ...cuando }, entonces: { actuador, accion } } }]

/** ESP32 + pulsador (cmp-0) + LED (cmp-1) + resistencia (cmp-2) en serie, y las reglas dadas. */
const opsEsp32 = (...reglas) => [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo: "pulsador" }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ...reglas,
]
/** Más un segundo LED (cmp-4) con su resistencia (cmp-5); la conexión del primero usó el id 3. */
const opsDosLeds = (...reglas) => [
  ...opsEsp32(),
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-4", terminal: "anodo", pin: "GPIO19" }],
  ["Conectar", { desde: { componente: "cmp-5", terminal: "a" }, hasta: { componente: "cmp-4", terminal: "anodo" } }],
  ...reglas,
]

const generarOk = (proyecto, conocimiento = K, opciones) => {
  const r = generarPrograma(proyecto, conocimiento, opciones)
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null))
  return r
}
const generarError = (proyecto, codigo, conocimiento = K, opciones) => {
  const r = generarPrograma(proyecto, conocimiento, opciones)
  assert.equal(r.ok, false, "debía fallar")
  assert.equal(r.error.codigo, codigo, JSON.stringify(r.error))
  assert.ok(!("archivos" in r), "un proyecto no generable nunca devuelve archivos")
  return r.error
}

/** Catálogo real con algunos tipos cambiados (fixture). */
function conocimientoCon(cambio, conversiones = CONVERSIONES_UNIDAD_MINIMAS) {
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (cambio[c.id] ? { ...c, ...cambio[c.id] } : c))
  return crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones } }, sha256Hex))
}
const PULSADOR = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
const LED = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "led")
const DHT22 = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "dht22")
/** Fixture: una entrada ya admitida (`pulsador`) que además declara la capacidad numérica de
 * temperatura del DHT22, SIN su `lectura` (CK-CG1): una capacidad numérica sin mecanismo de
 * lectura declarado, que la topología tampoco permite derivar. Las lecturas por protocolo
 * (Slice 2) se prueban en `codegen-s2.test.mjs`. */
const { lectura: _lecturaDht22, ...TEMPERATURA_SIN_LECTURA } = DHT22.capacidades.find((c) => c.id === "temperatura")
const PULSADOR_CON_TEMPERATURA = { capacidades: [...PULSADOR.capacidades, TEMPERATURA_SIN_LECTURA] }

/** Revisiones del anexo más revisiones de PRUEBA (no son datos del producto). */
const revisionesCon = ({ placas = [], componentes = [] }) => ({
  placas: [...REVISIONES_DEL_ANEXO.placas, ...placas.map((placa) => ({ placa, revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }))],
  componentes: [...REVISIONES_DEL_ANEXO.componentes, ...componentes.map(([tipo, placa]) => ({ tipo, placa, revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }))],
})

// ════════════════════════════════════════════════════════════════════════════════════
// Ejecución del programa generado contra una placa simulada
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Traduce el subconjunto de C++ que genera el backend a JS y lo corre contra una placa
 * simulada: así se prueba lo que el programa HACE, no cómo se ve. Si el generador emitiera
 * algo fuera de ese subconjunto, la traducción rompe y el test falla.
 */
function ejecutar(mainCpp) {
  const js = mainCpp
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//") && !linea.startsWith("#include"))
    .map((linea) => linea.replace(/\s*\/\/.*$/, ""))
    .join("\n")
    .replace(/static const uint8_t /g, "const ")
    .replace(/static float (\w+)\(\)/g, "function $1()")
    .replace(/void (setup|loop)\(\)/g, "function $1()")
    .replace(/const (float|bool) /g, "const ")
    .replace(/(\d)f\b/g, "$1")
  const placa = { modos: new Map(), niveles: new Map(), entradas: new Map(), lecturas: 0, escrituras: [] }
  const hw = {
    HIGH: 1,
    LOW: 0,
    INPUT_PULLUP: "INPUT_PULLUP",
    OUTPUT: "OUTPUT",
    pinMode: (pin, modo) => placa.modos.set(pin, modo),
    digitalRead: (pin) => {
      placa.lecturas++
      return placa.entradas.get(pin) ?? hw.HIGH
    },
    digitalWrite: (pin, nivel) => {
      placa.escrituras.push([pin, nivel])
      placa.niveles.set(pin, nivel)
    },
  }
  const programa = new Function("hw", `const { HIGH, LOW, INPUT_PULLUP, OUTPUT, pinMode, digitalRead, digitalWrite } = hw;\n${js}\nreturn { setup, loop };`)(hw)
  return { ...programa, placa, hw }
}

const loopDe = (mainCpp) => mainCpp.slice(mainCpp.indexOf("void loop() {"))

// ════════════════════════════════════════════════════════════════════════════════════
// Gate (1–5, 26)
// ════════════════════════════════════════════════════════════════════════════════════

test("1 proyecto no listo → CODEGEN_PROYECTO_NO_LISTO con sus motivos, sin archivos", () => {
  const sinPinDelLed = construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender")).filter(([tipo, p]) => !(tipo === "AsignarPin" && p.componente === "cmp-1")))
  const error = generarError(sinPinDelLed, "CODEGEN_PROYECTO_NO_LISTO")
  assert.equal(error.datos.incompleto, true)

  const incompleta = construir(K, opsEsp32(["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0" } } }]))
  const error2 = generarError(incompleta, "CODEGEN_PROYECTO_NO_LISTO")
  assert.ok(error2.datos.motivos.some((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO" && m.severidad === "blocking"))
})

test("2 placa / componente sin admisión eléctrica → CODEGEN_NO_ADMITIDO (la autoridad es admision.ts)", () => {
  const uno = construir(K, [
    ["SetPlaca", { placa: "arduino-uno" }],
    ["AgregarComponente", { tipo: "pulsador" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "D2" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "D3" }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
    regla(BOOL("verdadero"), "cmp-1", "encender"),
  ])
  const error = generarError(uno, "CODEGEN_NO_ADMITIDO")
  const ids = error.datos.noAdmitidos.map((x) => `${x.kind}:${x.id}`)
  assert.deepEqual(ids, ["placa:arduino-uno", "componente:led", "componente:pulsador", "componente:resistencia"])
  // Con las revisiones humanas de esa placa, el MISMO backend genera: no hay otra ruta para el UNO.
  const revisiones = revisionesCon({ placas: ["arduino-uno"], componentes: [["led", "arduino-uno"], ["pulsador", "arduino-uno"], ["resistencia", "arduino-uno"]] })
  generarOk(uno, K, { revisiones })
})

test("3 lectura que la topología no permite derivar → CODEGEN_SIN_LECTURA (fail closed)", () => {
  // Fixture: la misma entrada sin `requierePullUpInterno`: sin pull-up no hay cómo saber qué nivel es "verdadero".
  const k = conocimientoCon({ pulsador: { terminales: PULSADOR.terminales.map((t) => (t.id === "senal" ? { ...t, requierePullUpInterno: false } : t)) } })
  const error = generarError(construir(k, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))), "CODEGEN_SIN_LECTURA", k)
  assert.deepEqual(error.datos, { comportamiento: "beh-4", componente: "cmp-0", tipo: "pulsador", capacidad: "estadoBooleano" })
})

test("4 escritura que la topología no permite derivar → CODEGEN_SIN_ESCRITURA (fail closed)", () => {
  // Fixture: la salida no es un ánodo (rol `senal`): no hay nivel derivable para "encender".
  const k = conocimientoCon({ led: { terminales: LED.terminales.map((t) => (t.id === "anodo" ? { ...t, rol: "senal" } : t)) } })
  const error = generarError(construir(k, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))), "CODEGEN_SIN_ESCRITURA", k)
  assert.equal(error.datos.componente, "cmp-1")
})

test("5 acción sin complemento declarado → CODEGEN_REPOSO_NO_DECLARADO (no se inventa el reposo)", () => {
  // Fixture: el actuador sólo ofrece "encender": la regla es válida, pero su reposo no está declarado.
  const k = conocimientoCon({ led: { acciones: ["encender"] } })
  const error = generarError(construir(k, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))), "CODEGEN_REPOSO_NO_DECLARADO", k)
  assert.deepEqual(error.datos, { comportamiento: "beh-4", componente: "cmp-1", tipo: "led", accion: "encender" })
})

test("26 proyecto inválido (dos dueños del mismo LED) → rechazo sin archivos; el motivo de Multi-Rule viaja en los datos", () => {
  const p = construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"), regla(BOOL("falso"), "cmp-1", "apagar")))
  const error = generarError(p, "CODEGEN_PROYECTO_NO_LISTO")
  assert.ok(error.datos.motivos.some((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// Determinismo y pureza (6, 7)
// ════════════════════════════════════════════════════════════════════════════════════

const congelarProfundo = (x) => {
  if (x && typeof x === "object") {
    Object.values(x).forEach(congelarProfundo)
    Object.freeze(x)
  }
  return x
}

test("6 determinismo: misma IR → mismos bytes; el orden accidental de los arrays no cambia el resultado", () => {
  const p = construir(K, opsDosLeds(regla(BOOL("verdadero"), "cmp-1", "encender"), regla(BOOL("falso"), "cmp-4", "encender")))
  const a = generarOk(p)
  const b = generarOk(structuredClone(p))
  assert.deepEqual(b, a)
  const desordenado = { ...structuredClone(p), componentes: [...p.componentes].reverse(), conexiones: [...p.conexiones].reverse(), comportamientos: [...p.comportamientos].reverse() }
  assert.deepEqual(generarOk(desordenado).archivos, a.archivos)
})

test("7 no muta la IR (proyecto congelado en profundidad, igual antes y después)", () => {
  const p = construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender")))
  const antes = JSON.stringify(p)
  generarOk(congelarProfundo(structuredClone(p)))
  generarOk(p)
  assert.equal(JSON.stringify(p), antes)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Semántica ejecutada (8–16)
// ════════════════════════════════════════════════════════════════════════════════════

// Vertical #3: valor del sensor × estado objetivo. "presionado" = contacto cerrado = pin a masa.
for (const valor of ["verdadero", "falso"]) {
  for (const accion of ["encender", "apagar"]) {
    test(`8/12 regla «${valor} → ${accion}»: tabla de verdad ejecutada y estado inicial = reposo`, () => {
      const { archivos } = generarOk(construir(K, opsEsp32(regla(BOOL(valor), "cmp-1", accion))))
      const prog = ejecutar(archivos["src/main.cpp"])
      const nivel = (encendido) => (encendido ? prog.hw.HIGH : prog.hw.LOW)
      prog.setup()
      assert.equal(prog.placa.niveles.get(18), nivel(accion !== "encender"), "antes del primer loop, el LED está en su reposo")
      for (const presionado of [true, false, true]) {
        prog.placa.entradas.set(4, presionado ? prog.hw.LOW : prog.hw.HIGH)
        prog.loop()
        const condicion = (valor === "verdadero") === presionado
        assert.equal(prog.placa.niveles.get(18), nivel(condicion ? accion === "encender" : accion !== "encender"), `presionado=${presionado}`)
      }
    })
  }
}

test("9/10/11 polaridad derivada de la topología: INPUT_PULLUP, verdadero = LOW, encender = HIGH / apagar = LOW", () => {
  const { archivos } = generarOk(construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))))
  const cpp = archivos["src/main.cpp"]
  assert.match(cpp, /pinMode\(PIN_CMP_0_SENAL, INPUT_PULLUP\);/)
  assert.match(cpp, /return digitalRead\(PIN_CMP_0_SENAL\) == LOW \? 1\.0f : 0\.0f;/)
  assert.match(cpp, /pinMode\(PIN_CMP_1_ANODO, OUTPUT\);/)
  assert.match(cpp, /digitalWrite\(PIN_CMP_1_ANODO, beh_\d+ \? HIGH : LOW\);/)
  const prog = ejecutar(cpp)
  prog.setup()
  assert.equal(prog.placa.modos.get(4), "INPUT_PULLUP")
  assert.equal(prog.placa.modos.get(18), "OUTPUT")
})

test("13 sin delay(): ninguna de las cuatro reglas bloquea", () => {
  for (const valor of ["verdadero", "falso"])
    for (const accion of ["encender", "apagar"]) assert.doesNotMatch(generarOk(construir(K, opsEsp32(regla(BOOL(valor), "cmp-1", accion)))).archivos["src/main.cpp"], /\bdelay\s*\(/)
})

test("14 una sola lectura por (sensor, capacidad) por iteración, aunque dos reglas la usen", () => {
  const { archivos } = generarOk(construir(K, opsDosLeds(regla(BOOL("verdadero"), "cmp-1", "encender"), regla(BOOL("verdadero"), "cmp-4", "apagar"))))
  const cpp = archivos["src/main.cpp"]
  assert.equal(loopDe(cpp).match(/leer_cmp_0_estadoBooleano\(\)/g).length, 1)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.placa.lecturas = 0
  prog.loop()
  assert.equal(prog.placa.lecturas, 1)
})

test("15 una autoridad por actuador: cada actuador se escribe exactamente una vez por iteración", () => {
  const { archivos } = generarOk(construir(K, opsDosLeds(regla(BOOL("verdadero"), "cmp-1", "encender"), regla(BOOL("falso"), "cmp-4", "encender"))))
  const prog = ejecutar(archivos["src/main.cpp"])
  prog.setup()
  prog.placa.escrituras = []
  prog.loop()
  assert.deepEqual(prog.placa.escrituras.map(([pin]) => pin).sort((a, b) => a - b), [18, 19])
})

test("16 actuador sin regla: ni se configura ni se escribe", () => {
  const { archivos } = generarOk(construir(K, opsDosLeds(regla(BOOL("verdadero"), "cmp-1", "encender"))))
  const cpp = archivos["src/main.cpp"]
  assert.doesNotMatch(cpp, /PIN_CMP_4_ANODO/)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.loop()
  assert.ok(!prog.placa.modos.has(19) && !prog.placa.escrituras.some(([pin]) => pin === 19))
})

// ════════════════════════════════════════════════════════════════════════════════════
// Pines y PlatformIO (17–21)
// ════════════════════════════════════════════════════════════════════════════════════

const pinDelRegistro = (placa, id) => K.placa(placa).pines.find((p) => p.id === id)

test("17 banco GPIO: el número sale del registro de la placa y del pin asignado en la IR", () => {
  assert.equal(nombreDePinArduino(pinDelRegistro("esp32-devkit-v1", "GPIO4")), "4")
  const p = construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender")).map(([t, x]) => (t === "AsignarPin" && x.componente === "cmp-0" ? [t, { ...x, pin: "GPIO27" }] : [t, x])))
  assert.match(generarOk(p).archivos["src/main.cpp"], /static const uint8_t PIN_CMP_0_SENAL = 27;/)
})

test("18 banco D: el mismo backend genera para el UNO cuando sus revisiones existen (sin segunda ruta)", () => {
  assert.equal(nombreDePinArduino(pinDelRegistro("arduino-uno", "D7")), "7")
  const uno = construir(K, [
    ["SetPlaca", { placa: "arduino-uno" }],
    ["AgregarComponente", { tipo: "pulsador" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "D2" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "D7" }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
    regla(BOOL("verdadero"), "cmp-1", "encender"),
  ])
  const revisiones = revisionesCon({ placas: ["arduino-uno"], componentes: [["led", "arduino-uno"], ["pulsador", "arduino-uno"], ["resistencia", "arduino-uno"]] })
  const r = generarOk(uno, K, { revisiones })
  assert.match(r.archivos["src/main.cpp"], /PIN_CMP_0_SENAL = 2;/)
  assert.match(r.archivos["src/main.cpp"], /PIN_CMP_1_ANODO = 7;/)
  assert.equal(r.environment, "arduino-uno")
})

test("19 banco A: A<n> desde el registro real del UNO; un banco desconocido no se nombra", () => {
  assert.equal(nombreDePinArduino(pinDelRegistro("arduino-uno", "A0")), "A0")
  assert.equal(nombreDePinArduino(pinDelRegistro("arduino-uno", "A5")), "A5")
  assert.equal(nombreDePinArduino({ ...pinDelRegistro("arduino-uno", "A0"), banco: "X" }), undefined)
})

test("20/21 platformio.ini: environment y platform fijado desde backends.platformio del registro", () => {
  const r = generarOk(construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))))
  const { board, platform, framework } = K.placa("esp32-devkit-v1").backends.platformio
  assert.match(platform, /@\d+\.\d+\.\d+$/, "el registro fija la versión")
  assert.equal(r.environment, "esp32-devkit-v1")
  const lineas = r.archivos["platformio.ini"].split("\n")
  assert.ok(lineas.includes("[env:esp32-devkit-v1]"))
  assert.ok(lineas.includes(`platform = ${platform}`))
  assert.ok(lineas.includes(`board = ${board}`))
  assert.ok(lineas.includes(`framework = ${framework}`))
  assert.equal(lineas.filter((x) => x.startsWith("[env:")).length, 1)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Numéricas (22–25)
// ════════════════════════════════════════════════════════════════════════════════════

const TEMPERATURA = DHT22.capacidades.find((c) => c.id === "temperatura")

test("22/23 86 °F → 30 °C en la unidad de lectura, con Component Knowledge; la IR conserva 86 °F", () => {
  const umbral = Object.freeze({ valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
  assert.deepEqual(umbralEnUnidadDeLectura(K, "dht22", TEMPERATURA, umbral), { ok: true, valor: 30, unidad: "celsius" })
  assert.deepEqual(umbral, { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })

  const k = conocimientoCon({ pulsador: PULSADOR_CON_TEMPERATURA })
  const p = construir(k, opsEsp32(regla({ capacidad: "temperatura", comparador: ">", umbral: { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" } }, "cmp-1", "encender")))
  generarPrograma(p, k)
  assert.deepEqual(p.comportamientos[0].cuando.umbral, { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
})

test("24 capacidad numérica sin driver → CODEGEN_SIN_LECTURA (el umbral convierte, pero no hay lectura)", () => {
  const k = conocimientoCon({ pulsador: PULSADOR_CON_TEMPERATURA })
  const p = construir(k, opsEsp32(regla({ capacidad: "temperatura", comparador: ">", umbral: { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" } }, "cmp-1", "encender")))
  const error = generarError(p, "CODEGEN_SIN_LECTURA", k)
  assert.equal(error.datos.capacidad, "temperatura")
})

test("25 guarda de monotonía: una conversión que invierte el orden falla cerrado", () => {
  // Fixture: conversiones °C↔°F decrecientes (factor negativo). Ninguna conversión real es así.
  const decrecientes = [
    { de: "celsius", a: "fahrenheit", magnitud: "temperatura", factor: -1.8, offset: 32 },
    { de: "fahrenheit", a: "celsius", magnitud: "temperatura", factor: -5 / 9, offset: (32 * 5) / 9 },
  ]
  const k = conocimientoCon({ pulsador: PULSADOR_CON_TEMPERATURA }, decrecientes)
  const capacidad = k.catalogo.obtenerComponente("pulsador").capacidades.find((c) => c.id === "temperatura")
  const r = umbralEnUnidadDeLectura(k, "pulsador", capacidad, { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
  assert.equal(r.ok, false)
  assert.equal(r.error.codigo, "CODEGEN_CONVERSION_NO_MONOTONA")
  const p = construir(k, opsEsp32(regla({ capacidad: "temperatura", comparador: ">", umbral: { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" } }, "cmp-1", "encender")))
  generarError(p, "CODEGEN_CONVERSION_NO_MONOTONA", k)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Guardas estáticas (27–29)
// ════════════════════════════════════════════════════════════════════════════════════

const DIR_CODEGEN = join(REPO, "opencode/codegen")
const fuentesCodegen = readdirSync(DIR_CODEGEN).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(DIR_CODEGEN, f), "utf8")])
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

test("27 ningún id físico (tipo de componente, placa, board, plataforma o pin) escrito en codegen/", () => {
  const prohibidos = [
    ...K.catalogo.componentes.map((c) => c.id),
    ...K.catalogo.placas.flatMap((p) => [p.id, p.backends.platformio.board, p.backends.platformio.platform.split("@")[0]]),
  ]
  assert.ok(prohibidos.length > 5)
  for (const [archivo, fuente] of fuentesCodegen) {
    const codigo = sinComentarios(fuente)
    for (const id of prohibidos) assert.ok(!new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`).test(codigo), `${archivo} nombra «${id}»`)
    assert.doesNotMatch(codigo, /["'`](GPIO|D|A)\d+["'`]/, `${archivo} escribe un pin concreto`)
    assert.doesNotMatch(codigo, /\b(Date|Math\.random|performance|process\.|require\(|fetch\()/, `${archivo} no es puro`)
  }
})

test("28 nucleo/** no importa codegen/", () => {
  const dir = join(REPO, "opencode/nucleo")
  const archivos = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".ts"))
  for (const f of archivos) assert.doesNotMatch(readFileSync(join(dir, String(f)), "utf8"), /from\s+["'][^"']*codegen\//, String(f))
})

test("29 codegen/ sólo importa núcleo, Component Knowledge y su propia capa (nada de tool/agent/servidor/vista-fisica ni node:)", () => {
  for (const [archivo, fuente] of fuentesCodegen) {
    const especificadores = [...fuente.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
    // Modo Vivo V1: el generador del runtime (`runtime*.ts`) importa el CONTRATO del protocolo, que es
    // puro (tests/vivo-protocolo.test.mjs lo vigila) y vive en vivo/ porque lo comparten host y placa.
    // Es la única excepción, por archivo exacto: nada más de vivo/ (ni transporte ni sesión) entra acá.
    for (const e of especificadores) assert.match(e, /^(\.\.\/nucleo\/|\.\.\/conocimiento\/|\.\/|\.\.\/vivo\/protocolo\.ts$)/, `${archivo} importa ${e}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 30 — el único golden (lectura humana del vertical booleano)
// ════════════════════════════════════════════════════════════════════════════════════

test("30 golden: «mientras el pulsador esté presionado, el LED está encendido» en ESP32", () => {
  const r = generarOk(construir(K, opsEsp32(regla(BOOL("verdadero"), "cmp-1", "encender"))))
  assert.deepEqual(r.advertencias, [])
  assert.equal(
    r.archivos["src/main.cpp"],
    [
      "// Generado por Tecnia Bot (codegen) desde la IR del proyecto. No editar: se regenera desde el proyecto.",
      `// proyecto: proyecto-codegen | revision: 0 | catalogo: ${K.catalogo.hash} | placa: esp32-devkit-v1`,
      "//",
      "// Reglas de nivel: mientras la condicion vale, el actuador esta en el estado objetivo; si no, en su reposo.",
      "//   beh-4: cmp-0.estadoBooleano >= 1 ninguna -> cmp-1 encender (reposo: apagar)",
      "",
      "#include <Arduino.h>",
      "",
      "static const uint8_t PIN_CMP_0_SENAL = 4;  // cmp-0 (pulsador).senal -> GPIO4",
      "static const uint8_t PIN_CMP_1_ANODO = 18;  // cmp-1 (led).anodo -> GPIO18",
      "",
      "static float leer_cmp_0_estadoBooleano() {",
      "  return digitalRead(PIN_CMP_0_SENAL) == LOW ? 1.0f : 0.0f;",
      "}",
      "",
      "void setup() {",
      "  pinMode(PIN_CMP_0_SENAL, INPUT_PULLUP);",
      "  pinMode(PIN_CMP_1_ANODO, OUTPUT);",
      "  digitalWrite(PIN_CMP_1_ANODO, LOW);  // cmp-1 arranca en reposo (apagar)",
      "}",
      "",
      "void loop() {",
      "  const float cmp_0_estadoBooleano = leer_cmp_0_estadoBooleano();",
      "",
      "  // beh-4 -> cmp-1",
      "  const bool beh_4 = cmp_0_estadoBooleano >= 1.0f;",
      "  digitalWrite(PIN_CMP_1_ANODO, beh_4 ? HIGH : LOW);",
      "}",
      "",
    ].join("\n"),
  )
})
