// Codegen MVP, Slice 2 — primera vertical numérica ejecutable: «mientras la temperatura del
// DHT22 sea mayor a 30 °C, el LED está encendido» (ESP32), sobre CK-CG1.
//
// El backend de lectura se elige por el PROTOCOLO que declara Component Knowledge
// (`lecturaDeCapacidad`), nunca por el tipo de componente. Los proyectos se arman con las
// operaciones REALES del Engine y la fachada REAL de Component Knowledge; los catálogos de
// prueba existen sólo para formas que el real no tiene, y cada uno dice por qué.
//
// La corrección no se juzga por un snapshot: el programa generado se EJECUTA (`ejecutar`, abajo)
// contra una placa simulada con un sensor AM2302 simulado a nivel de forma de onda del bus (pulso
// de inicio, respuesta, 40 bits, suma de control). Así se prueba lo que el firmware HACE: cuándo
// lee, qué decodifica y qué hace el LED ante una lectura válida o inválida.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { BACKENDS_DE_PROTOCOLO } = await import(join(REPO, "opencode/codegen/protocolos.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════════════════════

/** Proyecto por las operaciones reales del Engine, con id y fecha fijos (determinismo). */
function construir(conocimiento, ops) {
  let p = crearProyecto({ catalogoVersion: conocimiento.catalogo.version, catalogoHash: conocimiento.catalogo.hash, generadorId: () => "proyecto-codegen-s2", ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, conocimiento.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}

const C = (valor) => ({ valor, unidad: "celsius", magnitud: "temperatura" })
const regla = (capacidad, comparador, umbral, actuador = "cmp-1", accion = "encender") => ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad, comparador, umbral }, entonces: { actuador, accion } } }]
const MAYOR_30 = regla("temperatura", ">", C(30))

/** ESP32 + sensor (cmp-0, DATA en GPIO4) + LED (cmp-1) + resistencia (cmp-2), y las reglas dadas. */
const opsSensor = (tipo, pin, ...reglas) => [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ...reglas,
]
const opsDht = (...reglas) => opsSensor("dht22", "GPIO4", ...reglas)
/** Más un segundo LED (cmp-4) con su resistencia (cmp-5); la conexión del primero usó el id 3. */
const opsDhtDosLeds = (...reglas) => [
  ...opsDht(),
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

const DHT22 = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "dht22")
const PULSADOR = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
const LECTURA_DHT22 = DHT22.capacidades.find((c) => c.id === "temperatura").lectura

/** Catálogo real con algunos tipos cambiados (fixture). */
function conocimientoCon(cambio) {
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (cambio[c.id] ? { ...c, ...cambio[c.id] } : c))
  return crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
}
/** Fixture: las capacidades del DHT22 con su `lectura` cambiada (sólo para formas que el catálogo real no tiene). */
const dhtConLectura = (cambio, capacidades = ["temperatura", "humedad"]) =>
  conocimientoCon({ dht22: { capacidades: DHT22.capacidades.map((c) => (capacidades.includes(c.id) ? { ...c, lectura: { ...c.lectura, ...cambio } } : c)) } })

// ════════════════════════════════════════════════════════════════════════════════════
// Ejecución del programa generado: placa simulada + sensor AM2302 simulado
// ════════════════════════════════════════════════════════════════════════════════════

/** Bytes del protocolo para una lectura (humedad ×0,1 %, temperatura ×0,1 °C con bit de signo). */
function bytesAm2302(humedad, temperatura) {
  const h = Math.round(humedad * 10)
  const t = Math.round(Math.abs(temperatura) * 10) | (temperatura < 0 ? 0x8000 : 0)
  const b = [h >> 8, h & 0xff, t >> 8, t & 0xff]
  return [...b, (b[0] + b[1] + b[2] + b[3]) & 0xff]
}

/** La forma de onda que manda el sensor después de que el host suelta el bus (µs por tramo). */
function ondaAm2302(bytes) {
  const tramos = [[1, 30], [0, 80], [1, 80]]
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) tramos.push([0, 50], [1, (byte >> bit) & 1 ? 70 : 27])
  tramos.push([0, 50])
  return tramos
}

/**
 * Traduce el subconjunto de C++ que genera el backend a JS y lo corre contra una placa simulada.
 * El reloj es simulado (µs): cada `digitalRead` cuesta 1 µs, `delayMicroseconds` avanza el
 * reloj y el test avanza el tiempo entre `loop()`s. El sensor responde sólo a un pulso de inicio
 * de al menos 800 µs (§7.4) y según su `estado`: `{ humedad, temperatura }`, `"muerto"` (no
 * responde) o `"checksum"` (manda datos con la suma de control mal).
 */
function ejecutar(mainCpp, busPin = 4) {
  const parametros = (lista) => lista.split(",").map((p) => p.trim().replace(/\[\]$/, "").split(/\s+/).pop()).filter(Boolean).join(", ")
  const js = mainCpp
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//") && !linea.startsWith("#include"))
    .map((linea) => linea.replace(/\s*\/\/.*$/, ""))
    .join("\n")
    .replace(/static const (?:uint8_t|uint32_t) /g, "const ")
    .replace(/static uint8_t (\w+)\[(\d+)\];/g, "let $1 = new Array($2).fill(0);")
    .replace(/^static (?:bool|float|uint32_t|void) (\w+)\(([^)]*)\) \{/gm, (_, nombre, lista) => `function ${nombre}(${parametros(lista)}) {`)
    .replace(/^static (?:bool|float|uint8_t|uint32_t) (\w+) =/gm, "let $1 =")
    .replace(/void (setup|loop)\(\)/g, "function $1()")
    .replace(/\bconst (?:float|bool|uint8_t|uint32_t|int) /g, "const ")
    .replace(/^(\s*)(?:bool|float|int|uint32_t) (\w+) =/gm, "$1let $2 =")
    .replace(/for \(int /g, "for (let ")
    .replace(/(\d)f\b/g, "$1")

  const placa = { t: 0, modos: new Map(), niveles: new Map(), historialLed: [], inicios: [], interrupcionesOff: 0 }
  const sensor = { estado: { humedad: 50, temperatura: 25 }, bajoDesde: null, onda: null }
  const nivelBus = () => {
    if (placa.modos.get(busPin) === "OUTPUT") return placa.niveles.get(busPin) ?? 1
    if (!sensor.onda) return 1
    let t = placa.t - sensor.onda.desde
    for (const [nivel, dur] of sensor.onda.tramos) {
      if (t < dur) return nivel
      t -= dur
    }
    sensor.onda = null
    return 1
  }
  const hw = {
    HIGH: 1,
    LOW: 0,
    INPUT_PULLUP: "INPUT_PULLUP",
    OUTPUT: "OUTPUT",
    millis: () => Math.floor(placa.t / 1000),
    micros: () => placa.t,
    delayMicroseconds: (us) => {
      placa.t += us
    },
    noInterrupts: () => {
      placa.interrupcionesOff++
    },
    interrupts: () => {},
    pinMode: (pin, modo) => {
      const antes = placa.modos.get(pin)
      placa.modos.set(pin, modo)
      if (pin !== busPin) return
      if (antes === "OUTPUT" && modo !== "OUTPUT" && sensor.bajoDesde !== null) {
        const bajo = placa.t - sensor.bajoDesde
        sensor.bajoDesde = null
        const e = sensor.estado
        if (bajo >= 800 && e !== "muerto") {
          const bytes = e === "checksum" ? bytesAm2302(50, 35).map((b, i) => (i === 4 ? (b + 1) & 0xff : b)) : bytesAm2302(e.humedad, e.temperatura)
          sensor.onda = { desde: placa.t, tramos: ondaAm2302(bytes) }
        }
      }
    },
    digitalRead: (pin) => {
      placa.t += 1
      return pin === busPin ? nivelBus() : 1
    },
    digitalWrite: (pin, nivel) => {
      placa.niveles.set(pin, nivel)
      if (pin === busPin && nivel === 0 && placa.modos.get(pin) === "OUTPUT") {
        sensor.bajoDesde = placa.t
        placa.inicios.push(placa.t / 1000)
      }
      if (pin !== busPin) placa.historialLed.push([placa.t / 1000, pin, nivel])
    },
  }
  const nombres = Object.keys(hw)
  const programa = new Function("hw", `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { setup, loop };`)(hw)
  /** Corre `loop()` cada `pasoMs` hasta `hastaMs` (tiempo absoluto). */
  const correrHasta = (hastaMs, pasoMs = 10) => {
    while (placa.t < hastaMs * 1000) {
      placa.t = Math.min(hastaMs * 1000, placa.t + pasoMs * 1000)
      programa.loop()
    }
  }
  return { ...programa, placa, sensor, hw, correrHasta, led: (pin = 18) => placa.niveles.get(pin) }
}

const mainDe = (ops, conocimiento = K, opciones) => generarOk(construir(conocimiento, ops), conocimiento, opciones).archivos["src/main.cpp"]
const loopDe = (cpp) => cpp.slice(cpp.indexOf("void loop() {"))

// ════════════════════════════════════════════════════════════════════════════════════
// B — la vertical numérica, ejecutada
// ════════════════════════════════════════════════════════════════════════════════════

test("B1 vertical: DHT22 temperatura > 30 °C → LED; ejecutado contra el sensor simulado", () => {
  const prog = ejecutar(mainDe(opsDht(MAYOR_30)))
  prog.setup()
  assert.equal(prog.led(), 0, "arranca en reposo")
  prog.sensor.estado = { humedad: 40, temperatura: 35.2 }
  prog.correrHasta(1990)
  assert.equal(prog.led(), 0, "antes de la primera lectura válida: reposo")
  prog.correrHasta(2010)
  assert.equal(prog.placa.inicios.length, 1)
  assert.equal(prog.led(), 1, "35,2 °C > 30 °C → encendido")
  prog.sensor.estado = { humedad: 40, temperatura: 29.8 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0, "29,8 °C → reposo")
  prog.sensor.estado = { humedad: 40, temperatura: 30 }
  prog.correrHasta(6010)
  assert.equal(prog.led(), 0, "30 °C no es > 30 °C")
  prog.sensor.estado = { humedad: 40, temperatura: 30.1 }
  prog.correrHasta(8010)
  assert.equal(prog.led(), 1)
})

test("B2 los cuatro comparadores de la IR, en el borde y a cada lado; temperaturas negativas decodificadas", () => {
  const casos = [
    [">", 30, [[29.9, 0], [30, 0], [30.1, 1]]],
    [">=", 30, [[29.9, 0], [30, 1], [30.1, 1]]],
    ["<", 30, [[29.9, 1], [30, 0], [30.1, 0]]],
    ["<=", 30, [[29.9, 1], [30, 1], [30.1, 0]]],
    ["<", 0, [[-5.5, 1], [0, 0], [0.5, 0]]],
    [">", -10, [[-10.5, 0], [-9.9, 1]]],
  ]
  for (const [comparador, umbral, muestras] of casos) {
    const prog = ejecutar(mainDe(opsDht(regla("temperatura", comparador, C(umbral)))))
    prog.setup()
    muestras.forEach(([temperatura, esperado], i) => {
      prog.sensor.estado = { humedad: 50, temperatura }
      prog.correrHasta(2010 + i * 2000)
      assert.equal(prog.led(), esperado, `${temperatura} ${comparador} ${umbral}`)
    })
  }
})

test("B3 determinismo: misma IR + catálogo → mismos bytes (main.cpp y platformio.ini); el orden de los arrays no cambia nada", () => {
  const p = construir(K, opsDhtDosLeds(MAYOR_30, regla("humedad", ">", { valor: 80, unidad: "porcentaje", magnitud: "humedad" }, "cmp-4")))
  const a = generarOk(p)
  assert.deepEqual(generarOk(structuredClone(p)), a)
  const desordenado = { ...structuredClone(p), componentes: [...p.componentes].reverse(), conexiones: [...p.conexiones].reverse(), comportamientos: [...p.comportamientos].reverse() }
  assert.deepEqual(generarOk(desordenado).archivos, a.archivos)
  assert.deepEqual(Object.keys(a.archivos).sort(), ["platformio.ini", "src/main.cpp"])
})

test("B4 dos capacidades del mismo sensor comparten UNA lectura del bus por período (temperatura → LED 1, humedad → LED 2)", () => {
  const cpp = mainDe(opsDhtDosLeds(MAYOR_30, regla("humedad", ">", { valor: 80, unidad: "porcentaje", magnitud: "humedad" }, "cmp-4")))
  assert.equal(loopDe(cpp).match(/am2302_leer\(/g).length, 1)
  assert.equal(cpp.match(/^static bool am2302_leer\(/gm).length, 1, "el driver se emite una sola vez")
  const prog = ejecutar(cpp)
  prog.setup()
  prog.sensor.estado = { humedad: 85.5, temperatura: 22 }
  prog.correrHasta(2010)
  assert.deepEqual([prog.led(18), prog.led(19)], [0, 1])
  prog.sensor.estado = { humedad: 60, temperatura: 31 }
  prog.correrHasta(4010)
  assert.deepEqual([prog.led(18), prog.led(19)], [1, 0])
  assert.equal(prog.placa.inicios.length, 2, "un pulso de inicio por período, no uno por capacidad")
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — tiempos de Component Knowledge, sin bloquear
// ════════════════════════════════════════════════════════════════════════════════════

test("D1 la primera lectura espera esperaTrasEncendido y entre intentos pasa al menos periodoMinimo (CK: 2 s y 2 s)", () => {
  const prog = ejecutar(mainDe(opsDht(MAYOR_30)))
  prog.setup()
  prog.correrHasta(20000, 7)
  const inicios = prog.placa.inicios
  assert.ok(inicios.length >= 8, `intentos: ${inicios.length}`)
  assert.ok(inicios[0] >= 2000 && inicios[0] < 2010, `primer intento a los ${inicios[0]} ms`)
  // Resolución de millis(): 1 ms.
  for (let i = 1; i < inicios.length; i++) assert.ok(inicios[i] - inicios[i - 1] >= 2000 - 1, `intervalo ${inicios[i] - inicios[i - 1]} ms`)
})

test("D2 los tiempos SALEN de Component Knowledge: con otros valores declarados cambia el programa y el comportamiento", () => {
  const k = dhtConLectura({ esperaTrasEncendido: { valor: 5, unidad: "segundo", magnitud: "tiempo" }, periodoMinimo: { valor: 3.5, unidad: "segundo", magnitud: "tiempo" } })
  const cpp = mainDe(opsDht(MAYOR_30), k)
  assert.match(cpp, /static const uint32_t ESPERA_MS_CMP_0_SENAL = 5000;/)
  assert.match(cpp, /static const uint32_t PERIODO_MS_CMP_0_SENAL = 3500;/)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.correrHasta(20000, 7)
  assert.ok(prog.placa.inicios[0] >= 5000)
  for (let i = 1; i < prog.placa.inicios.length; i++) assert.ok(prog.placa.inicios[i] - prog.placa.inicios[i - 1] >= 3500 - 1)
  // Con el catálogo real, los milisegundos salen de los 2 s declarados (no de una constante del backend).
  assert.deepEqual([LECTURA_DHT22.esperaTrasEncendido, LECTURA_DHT22.periodoMinimo].map((c) => [c.valor, c.unidad]), [[2, "segundo"], [2, "segundo"]])
  const real = mainDe(opsDht(MAYOR_30))
  assert.match(real, /ESPERA_MS_CMP_0_SENAL = 2000;/)
  assert.match(real, /PERIODO_MS_CMP_0_SENAL = 2000;/)
})

test("D3 sin bloqueo: ni delay() ni esperas de segundos; un loop sin lectura cuesta microsegundos", () => {
  const cpp = mainDe(opsDht(MAYOR_30))
  assert.doesNotMatch(cpp, /\bdelay\s*\(/)
  for (const m of cpp.matchAll(/delayMicroseconds\((\d+)\)/g)) assert.ok(Number(m[1]) < 2000, `delayMicroseconds(${m[1]})`)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.placa.t = 500_000
  const antes = prog.placa.t
  prog.loop()
  assert.ok(prog.placa.t - antes < 100, "un loop sin lectura no espera")
  prog.placa.t = 2_000_000
  const antesLectura = prog.placa.t
  prog.loop()
  assert.ok(prog.placa.t - antesLectura < 10_000, `una lectura completa tarda ${prog.placa.t - antesLectura} µs (< 10 ms)`)
  assert.equal(prog.placa.interrupcionesOff, 1)
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — lectura inválida: a prueba de fallos (D3 = A)
// ════════════════════════════════════════════════════════════════════════════════════

// Con «<» también: un sensor muerto deja los bytes en 0, y 0 < 30; sólo la validez lo distingue.
for (const falla of ["muerto", "checksum"]) {
  for (const [comparador, buena] of [[">", 40], ["<", 20]]) {
    test(`E1 lectura inválida («${falla}», regla «${comparador} 30»): no reutiliza el valor anterior y el LED vuelve a su reposo`, () => {
      const prog = ejecutar(mainDe(opsDht(regla("temperatura", comparador, C(30)))))
      prog.setup()
      prog.sensor.estado = { humedad: 40, temperatura: buena }
      prog.correrHasta(2010)
      assert.equal(prog.led(), 1)
      prog.sensor.estado = falla
      prog.correrHasta(3990)
      assert.equal(prog.led(), 1, "hasta el siguiente intento se usa la lectura válida vigente")
      prog.correrHasta(4010)
      assert.equal(prog.placa.inicios.length, 2)
      assert.equal(prog.led(), 0, `el intento falló: la lectura anterior (${buena} °C) ya no vale`)
      prog.correrHasta(5990)
      assert.equal(prog.led(), 0, "sigue en reposo mientras no haya otra lectura válida")
      prog.sensor.estado = { humedad: 40, temperatura: buena }
      prog.correrHasta(6010)
      assert.equal(prog.led(), 1, "una lectura válida nueva vuelve a contar")
    })
  }
}

test("E2 sensor que nunca responde: el LED nunca se enciende, aunque la regla sea «menor que» (una lectura inválida no es 0)", () => {
  for (const [comparador, umbral] of [[">", 30], ["<", 30], ["<=", 0], [">=", -40]]) {
    const prog = ejecutar(mainDe(opsDht(regla("temperatura", comparador, C(umbral)))))
    prog.setup()
    prog.sensor.estado = "muerto"
    prog.correrHasta(10000)
    assert.ok(prog.placa.inicios.length >= 4)
    assert.ok(prog.placa.historialLed.every(([, , nivel]) => nivel === 0), `${comparador} ${umbral}: el LED nunca se encendió`)
  }
})

test("E3 la acción «apagar»: sin lectura válida queda en SU reposo (encendido), no «apagado» por defecto", () => {
  const prog = ejecutar(mainDe(opsDht(regla("temperatura", ">", C(30), "cmp-1", "apagar"))))
  prog.setup()
  assert.equal(prog.led(), 1, "el reposo de «apagar» es «encender»")
  prog.sensor.estado = { humedad: 40, temperatura: 35 }
  prog.correrHasta(2010)
  assert.equal(prog.led(), 0)
  prog.sensor.estado = "muerto"
  prog.correrHasta(4010)
  assert.equal(prog.led(), 1)
})

test("E4 el driver exige el pulso de inicio de ≥ 800 µs y decide cada bit por su propio bajo (sensor simulado estricto)", () => {
  const cpp = mainDe(opsDht(MAYOR_30))
  const corto = cpp.replace("delayMicroseconds(1100);", "delayMicroseconds(500);")
  const prog = ejecutar(corto)
  prog.setup()
  prog.sensor.estado = { humedad: 40, temperatura: 40 }
  prog.correrHasta(2010)
  assert.equal(prog.led(), 0, "con un pulso de inicio corto el sensor no responde: lectura inválida")
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — unidades: la conversión es de Component Knowledge
// ════════════════════════════════════════════════════════════════════════════════════

test("C1 86 °F significa lo mismo que 30 °C: misma constante en el firmware y mismo comportamiento; la IR no cambia", () => {
  const fahrenheit = construir(K, opsDht(regla("temperatura", ">", { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })))
  const cppF = generarOk(fahrenheit).archivos["src/main.cpp"]
  const cppC = mainDe(opsDht(MAYOR_30))
  assert.match(cppF, /const bool beh_4 = valida_cmp_0_temperatura && cmp_0_temperatura > 30\.0f;/)
  assert.equal(loopDe(cppF), loopDe(cppC))
  assert.deepEqual(fahrenheit.comportamientos[0].cuando.umbral, { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" })
  for (const cpp of [cppF, cppC]) {
    const prog = ejecutar(cpp)
    prog.setup()
    prog.sensor.estado = { humedad: 40, temperatura: 30.1 }
    prog.correrHasta(2010)
    assert.equal(prog.led(), 1)
  }
})

const DIR_CODEGEN = join(REPO, "opencode/codegen")
const fuentesCodegen = readdirSync(DIR_CODEGEN).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(DIR_CODEGEN, f), "utf8")])
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

test("C2 codegen/ no tiene fórmulas de conversión física ni ids de unidades del catálogo (usa convertirParaCapacidad y UCUM)", () => {
  for (const [archivo, fuente] of fuentesCodegen) {
    const codigo = sinComentarios(fuente)
    assert.doesNotMatch(codigo, /\b1\.8\b|\b273\.15\b|5\s*\/\s*9|9\s*\/\s*5|\b32\b/, `${archivo} tiene una fórmula de conversión`)
    assert.doesNotMatch(codigo, /["'`](celsius|fahrenheit|porcentaje|segundo)["'`]/, `${archivo} nombra un id de unidad`)
  }
  assert.match(sinComentarios(fuentesCodegen.find(([f]) => f === "programa.ts")[1]), /conocimiento\.convertirParaCapacidad\(/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// A — el backend se elige por el PROTOCOLO
// ════════════════════════════════════════════════════════════════════════════════════

test("A1 el codegen consume lecturaDeCapacidad y elige el backend por el protocolo, desde el registro", () => {
  const programa = sinComentarios(fuentesCodegen.find(([f]) => f === "programa.ts")[1])
  assert.match(programa, /conocimiento\.lecturaDeCapacidad\(sensor\.tipo, capacidad\.id\)/)
  assert.match(programa, /backendDeProtocolo\(backends, declarada\.protocolo\)/)
  assert.deepEqual(Object.keys(BACKENDS_DE_PROTOCOLO), ["bus-unico-am2302"])
  // Un backend espía registrado para el MISMO protocolo es el que se usa: no hay otra ruta.
  const espia = { ...BACKENDS_DE_PROTOCOLO["bus-unico-am2302"], funcion: "espia_leer", driver: ["static bool espia_leer(uint8_t pin, uint8_t datos[]) {", "  return false;", "}"] }
  const cpp = mainDe(opsDht(MAYOR_30), K, { protocolos: { "bus-unico-am2302": espia } })
  assert.match(cpp, /valida_cmp_0_senal = espia_leer\(PIN_CMP_0_SENAL, datos_cmp_0_senal\);/)
  assert.doesNotMatch(cpp, /am2302_leer/)
})

test("A2 otra pieza que declara el MISMO protocolo llega al mismo backend, sin una rama por componente", () => {
  // Fixture: el pulsador (ya admitido) con DATA bidireccional y la temperatura leída por bus-unico-am2302.
  const k = conocimientoCon({
    pulsador: {
      terminales: PULSADOR.terminales.map((t) => (t.id === "senal" ? { id: "senal", rol: "senal", electrica: "digital", direccion: "bidireccional", pullUpExterno: true } : t)),
      capacidades: [...PULSADOR.capacidades, DHT22.capacidades.find((c) => c.id === "temperatura")],
    },
  })
  const cppPulsador = mainDe(opsSensor("pulsador", "GPIO4", MAYOR_30), k)
  const cppDht = mainDe(opsDht(MAYOR_30))
  const sinCabecera = (cpp) => cpp.split("\n").filter((x) => !x.startsWith("// proyecto:") && !x.startsWith("static const uint8_t PIN_CMP_0_SENAL")).join("\n")
  assert.equal(sinCabecera(cppPulsador), sinCabecera(cppDht), "mismo protocolo → mismo programa")
  const prog = ejecutar(cppPulsador)
  prog.setup()
  prog.sensor.estado = { humedad: 40, temperatura: 31 }
  prog.correrHasta(2010)
  assert.equal(prog.led(), 1)
})

test("A3 ningún id de componente ni lista de pines en codegen/ (el test 27 de S1 cubre ahora también protocolos.ts)", () => {
  assert.ok(fuentesCodegen.some(([f]) => f === "protocolos.ts"))
  for (const [archivo, fuente] of fuentesCodegen) {
    const codigo = sinComentarios(fuente)
    for (const c of K.catalogo.componentes) assert.ok(!new RegExp(`["'\`]${c.id}["'\`]`).test(codigo), `${archivo} nombra «${c.id}»`)
    assert.doesNotMatch(codigo, /\.tipo\s*===/, `${archivo} decide por el tipo de componente`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// F — la autoridad eléctrica sigue siendo la del Engine y Component Knowledge
// ════════════════════════════════════════════════════════════════════════════════════

test("F1 DATA en GPIO34 o GPIO12: el proyecto no está listo y el codegen no genera (no reimplementa la regla)", () => {
  for (const [pin, codigo] of [["GPIO34", "CAPACIDAD_PIN_INCOMPATIBLE"], ["GPIO12", "PIN_STRAPPING_PULLUP_EXTERNO"]]) {
    const error = generarError(construir(K, opsSensor("dht22", pin, MAYOR_30)), "CODEGEN_PROYECTO_NO_LISTO")
    assert.ok(error.datos.motivos.some((m) => m.codigo === codigo), `${pin}: ${error.datos.motivos.map((m) => m.codigo)}`)
  }
  for (const [archivo, fuente] of fuentesCodegen) {
    const codigo = sinComentarios(fuente)
    assert.doesNotMatch(codigo, /soloEntrada|strapping|pullUpExterno|requierePullUpInterno.*bidireccional|\b(?:12|3[4-9])\b(?!\d)/, `${archivo} tiene reglas o pines físicos`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// G — una sola fuente de verdad
// ════════════════════════════════════════════════════════════════════════════════════

test("G1 nada del driver en la IR ni en Component Knowledge; sin lib_deps; generar no muta el proyecto", () => {
  const p = construir(K, opsDht(MAYOR_30))
  const antes = JSON.stringify(p)
  const r = generarOk(p)
  assert.equal(JSON.stringify(p), antes)
  for (const prohibido of [/am2302_/, /#include/, /lib_deps/, /Arduino/, /micros|millis/]) {
    assert.doesNotMatch(antes, prohibido, `IR: ${prohibido}`)
    assert.doesNotMatch(JSON.stringify(K.lecturaDeCapacidad("dht22", "temperatura")), prohibido, `CK: ${prohibido}`)
  }
  assert.doesNotMatch(r.archivos["platformio.ini"], /lib_deps/)
  assert.deepEqual(r.archivos["src/main.cpp"].match(/^#include .*$/gm), ["#include <Arduino.h>"], "sin librerías externas")
})

// ════════════════════════════════════════════════════════════════════════════════════
// H — fail closed
// ════════════════════════════════════════════════════════════════════════════════════

test("H1 protocolo sin backend → CODEGEN_PROTOCOLO_SIN_BACKEND, sin archivos", () => {
  const error = generarError(construir(K, opsDht(MAYOR_30)), "CODEGEN_PROTOCOLO_SIN_BACKEND", K, { protocolos: {} })
  assert.deepEqual(error.datos, { comportamiento: "beh-4", componente: "cmp-0", tipo: "dht22", capacidad: "temperatura", protocolo: "bus-unico-am2302" })
})

test("H2 lectura declarada que el backend no puede cumplir tal cual → CODEGEN_LECTURA_INCOHERENTE (terminal, campo, tiempos)", () => {
  // Fixture: DATA declarada sólo de entrada (el driver necesita manejar el bus).
  const kTerminal = conocimientoCon({ dht22: { terminales: DHT22.terminales.map((t) => (t.id === "senal" ? { ...t, direccion: "entrada" } : t)) } })
  assert.equal(generarError(construir(kTerminal, opsDht(MAYOR_30)), "CODEGEN_LECTURA_INCOHERENTE", kTerminal).datos.causa, "terminal")
  // Fixture: la temperatura declarada en °F, que el protocolo no entrega (el backend no convierte).
  const kCampo = conocimientoCon({
    dht22: { capacidades: DHT22.capacidades.map((c) => (c.id === "temperatura" ? { ...c, unidad: "fahrenheit", rango: { min: { valor: 32, unidad: "fahrenheit", magnitud: "temperatura" }, max: { valor: 140, unidad: "fahrenheit", magnitud: "temperatura" } } } : c)) },
  })
  assert.equal(generarError(construir(kCampo, opsDht(MAYOR_30)), "CODEGEN_LECTURA_INCOHERENTE", kCampo).datos.causa, "campo")
  // Fixture: sin período mínimo declarado (no se inventa uno).
  const kTiempo = conocimientoCon({ dht22: { capacidades: DHT22.capacidades.map((c) => ({ ...c, lectura: { ...c.lectura, periodoMinimo: undefined } })) } })
  assert.equal(generarError(construir(kTiempo, opsDht(MAYOR_30)), "CODEGEN_LECTURA_INCOHERENTE", kTiempo).datos.causa, "tiempos")
  // Fixture: dos capacidades del mismo bus con períodos distintos: no hay un horario que cumpla ambas.
  const kDispar = dhtConLectura({ periodoMinimo: { valor: 3, unidad: "segundo", magnitud: "tiempo" } }, ["humedad"])
  const p = construir(kDispar, opsDhtDosLeds(MAYOR_30, regla("humedad", ">", { valor: 80, unidad: "porcentaje", magnitud: "humedad" }, "cmp-4")))
  assert.equal(generarError(p, "CODEGEN_LECTURA_INCOHERENTE", kDispar).datos.causa, "tiempos")
})

test("H3 sin revisión eléctrica del par, NO_ADMITIDO antes de llegar al backend", () => {
  const sinDht = { placas: [], componentes: [] }
  generarError(construir(K, opsDht(MAYOR_30)), "CODEGEN_NO_ADMITIDO", K, { revisiones: sinDht })
})

// ════════════════════════════════════════════════════════════════════════════════════
// I — el camino del agente: la tool programa usa el mismo generador
// ════════════════════════════════════════════════════════════════════════════════════

test("I1 tool programa (generar): el proyecto armado por proyecto-fisico produce exactamente lo que da generarPrograma", async () => {
  const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
  const programaTool = (await import(join(REPO, "opencode/tool/programa.ts"))).default
  const { carpetaDelPrograma } = await import(join(REPO, "opencode/tool/programa.ts"))
  const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
  const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
  const dir = nuevoDir("codegen-s2")
  const ctx = { directory: dir }
  const operaciones = opsDht(MAYOR_30).map(([tipo, payload]) => ({ tipo, payload }))
  const aplicado = JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: 0, operaciones }, ctx))
  assert.equal(aplicado.ok, true, JSON.stringify(aplicado))
  const salida = JSON.parse(await programaTool.execute({ accion: "generar" }, ctx))
  assert.equal(salida.ok, true, JSON.stringify(salida))
  const proyecto = obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto: "activo" }).snapshot().proyecto
  const esperado = generarPrograma(proyecto, K)
  for (const [ruta, contenido] of Object.entries(esperado.archivos)) assert.equal(readFileSync(join(carpetaDelPrograma(dir, "activo"), ruta), "utf8"), contenido, ruta)
})
