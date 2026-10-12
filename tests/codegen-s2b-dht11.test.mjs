// Codegen S2b — backend `bus-unico-dht11`: «mientras la temperatura del DHT11 sea mayor a 30 °C,
// el LED está encendido» llega a C++ canónico por el mismo camino que el DHT22.
//
// Qué protege este archivo (Design Gate DHT11; veredicto externo APPROVE_WITH_LIMITATIONS):
// - selección por PROTOCOLO desde el registro canónico (sin rama por componente, sin registro paralelo);
// - handshake y trama del DHT11: pulso de inicio de 20 ms (el sensor exige ≥ 18 ms), bytes
//   entero/decimal, signo en el bit 7 del decimal de temperatura, suma de control, timeout;
// - política ante fallas (D3 = A): inválida ≠ falso, el actuador vuelve a su reposo;
// - tiempos de Component Knowledge: espera 1 s, período 3 s;
// - bloqueo acotado y declarado (≤ 20 ms por lectura), determinismo;
// - NO GENERABLE → GENERABLE verificable; placas y protocolos no soportados siguen bloqueados;
// - regresión DHT22: el driver AM2302 es byte a byte el del baseline 4f53b65 (hash fijado).
//
// El simulador es el de `codegen-s2.test.mjs` parametrizado para el DHT11 (onda, bytes y pulso
// mínimo propios): traduce el subconjunto de C++ que emite el backend a JS y lo corre con reloj simulado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { generabilidad } = await import(join(REPO, "opencode/codegen/generabilidad.ts"))
const { BACKENDS_DE_PROTOCOLO, prefijoDeProtocolo } = await import(join(REPO, "opencode/codegen/protocolos.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

const sha = (s) => createHash("sha256").update(s).digest("hex")

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════════════════════

function construir(conocimiento, ops) {
  let p = crearProyecto({ catalogoVersion: conocimiento.catalogo.version, catalogoHash: conocimiento.catalogo.hash, generadorId: () => "proyecto-codegen-s2b", ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, conocimiento.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}
const C = (valor, unidad = "celsius", magnitud = "temperatura") => ({ valor, unidad, magnitud })
const regla = (capacidad, comparador, umbral, actuador = "cmp-1", accion = "encender") => ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad, comparador, umbral }, entonces: { actuador, accion } } }]
const MAYOR_30 = regla("temperatura", ">", C(30))

/** ESP32 + sensor (cmp-0, DATA en `pin`) + LED (cmp-1, GPIO18) + resistencia (cmp-2), y las reglas dadas. */
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
const opsDht11 = (...reglas) => opsSensor("dht11", "GPIO4", ...reglas)

const generarOk = (proyecto, conocimiento = K, opciones) => {
  const r = generarPrograma(proyecto, conocimiento, opciones)
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null))
  return r
}
const mainDe = (ops, conocimiento = K, opciones) => generarOk(construir(conocimiento, ops), conocimiento, opciones).archivos["src/main.cpp"]
const readinessDe = (p) => derivarReadiness(p, validarProyecto(p, K.catalogo))

function conocimientoCon(cambio) {
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (cambio[c.id] ? { ...c, ...cambio[c.id] } : c))
  return crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
}
const DHT11 = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "dht11")
const DHT22 = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "dht22")
const PULSADOR = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
const LECTURA_DHT11 = DHT11.capacidades[0].lectura

// ── sensor DHT11 simulado ─────────────────────────────────────────────────────────────

/** Bytes del protocolo DHT11: humedad entera y decimal, temperatura entera y decimal (bit 7 = signo), suma. */
function bytesDht11(humedad, temperatura) {
  const h = [Math.trunc(humedad), Math.round((humedad - Math.trunc(humedad)) * 10)]
  const abs = Math.abs(temperatura)
  const t = [Math.trunc(abs), Math.round((abs - Math.trunc(abs)) * 10) | (temperatura < 0 ? 0x80 : 0)]
  const b = [...h, ...t]
  return [...b, (b[0] + b[1] + b[2] + b[3]) & 0xff]
}

/** Forma de onda del DHT11 después de que el host suelta el bus (µs por tramo; V1.3: 83/87, 54, 24/71, 54). */
function ondaDht11(bytes) {
  const tramos = [[1, 13], [0, 83], [1, 87]]
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) tramos.push([0, 54], [1, (byte >> bit) & 1 ? 71 : 24])
  tramos.push([0, 54])
  return tramos
}

/**
 * Traduce el C++ generado a JS y lo corre contra una placa simulada con un DHT11 en `busPin`. El
 * sensor responde sólo a un pulso de inicio de al menos `pulsoMinimoUs` (18 000 según V1.3) y
 * según su `estado`: `{ humedad, temperatura }`, `"muerto"` (no responde) o `"checksum"`.
 */
function ejecutar(mainCpp, { busPin = 4, pulsoMinimoUs = 18_000 } = {}) {
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

  const placa = { t: 0, modos: new Map(), niveles: new Map(), inicios: [], interrupcionesOff: 0, pulsos: [] }
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
        placa.pulsos.push(bajo)
        const e = sensor.estado
        if (bajo >= pulsoMinimoUs && e !== "muerto") {
          const bytes = e === "checksum" ? bytesDht11(50, 35).map((b, i) => (i === 4 ? (b + 1) & 0xff : b)) : bytesDht11(e.humedad, e.temperatura)
          const tramos = ondaDht11(bytes)
          // `sensor.truncarBits`: el sensor corta la trama después de esos bits (lectura incompleta).
          sensor.onda = { desde: placa.t, tramos: sensor.truncarBits === undefined ? tramos : tramos.slice(0, 3 + sensor.truncarBits * 2) }
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
    },
  }
  const nombres = Object.keys(hw)
  const programa = new Function("hw", `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { setup, loop };`)(hw)
  const correrHasta = (hastaMs, pasoMs = 10) => {
    while (placa.t < hastaMs * 1000) {
      placa.t = Math.min(hastaMs * 1000, placa.t + pasoMs * 1000)
      programa.loop()
    }
  }
  return { ...programa, placa, sensor, hw, correrHasta, led: (pin = 18) => placa.niveles.get(pin) }
}

// ════════════════════════════════════════════════════════════════════════════════════
// A — selección por protocolo, desde el registro canónico
// ════════════════════════════════════════════════════════════════════════════════════

test("A1 el registro canónico tiene los dos protocolos; el DHT11 llega a dht11_leer y nunca a am2302_", () => {
  assert.deepEqual(Object.keys(BACKENDS_DE_PROTOCOLO), ["bus-unico-am2302", "bus-unico-dht11"])
  assert.equal(BACKENDS_DE_PROTOCOLO["bus-unico-dht11"].funcion, "dht11_leer")
  assert.equal(prefijoDeProtocolo("bus-unico-dht11"), "dht11")
  const cpp = mainDe(opsDht11(MAYOR_30))
  assert.match(cpp, /valida_cmp_0_senal = dht11_leer\(PIN_CMP_0_SENAL, datos_cmp_0_senal\);/)
  assert.doesNotMatch(cpp, /am2302_/)
  assert.equal(cpp.match(/^static bool dht11_leer\(/gm).length, 1, "el driver se emite una sola vez")
  // Un backend espía registrado para el MISMO protocolo es el que se usa: no hay otra ruta.
  const espia = { ...BACKENDS_DE_PROTOCOLO["bus-unico-dht11"], funcion: "espia_leer", driver: ["static bool espia_leer(uint8_t pin, uint8_t datos[]) {", "  return false;", "}"] }
  const conEspia = mainDe(opsDht11(MAYOR_30), K, { protocolos: { ...BACKENDS_DE_PROTOCOLO, "bus-unico-dht11": espia } })
  assert.match(conEspia, /valida_cmp_0_senal = espia_leer\(/)
  assert.doesNotMatch(conEspia, /dht11_leer/)
})

test("A2 otra pieza que declara el MISMO protocolo llega al mismo backend y al mismo programa (sin rama por componente)", () => {
  const k = conocimientoCon({
    pulsador: {
      terminales: PULSADOR.terminales.map((t) => (t.id === "senal" ? { id: "senal", rol: "senal", electrica: "digital", direccion: "bidireccional", pullUpExterno: true } : t)),
      capacidades: [...PULSADOR.capacidades, DHT11.capacidades.find((c) => c.id === "temperatura")],
    },
  })
  const cppPulsador = mainDe(opsSensor("pulsador", "GPIO4", MAYOR_30), k)
  const cppDht11 = mainDe(opsDht11(MAYOR_30))
  const sinCabecera = (cpp) => cpp.split("\n").filter((x) => !x.startsWith("// proyecto:") && !x.startsWith("static const uint8_t PIN_CMP_0_SENAL")).join("\n")
  assert.equal(sinCabecera(cppPulsador), sinCabecera(cppDht11), "mismo protocolo → mismo programa")
})

const fuentesCodegen = readdirSync(join(REPO, "opencode/codegen")).map((f) => [f, readFileSync(join(REPO, "opencode/codegen", f), "utf8")])
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

test("A3 codegen/ no nombra al dht11 ni al dht22 entre comillas ni decide por el tipo de componente; el prefijo sale del id del protocolo", () => {
  for (const [archivo, fuente] of fuentesCodegen) {
    const codigo = sinComentarios(fuente)
    for (const c of K.catalogo.componentes) assert.ok(!new RegExp(`["'\`]${c.id}["'\`]`).test(codigo), `${archivo} nombra «${c.id}»`)
    assert.doesNotMatch(codigo, /\.tipo\s*===/, `${archivo} decide por el tipo de componente`)
  }
  assert.equal(prefijoDeProtocolo("bus-unico-am2302"), "am2302")
})

// ════════════════════════════════════════════════════════════════════════════════════
// B — la vertical: temperatura > 30 °C → LED, ejecutada contra el sensor simulado
// ════════════════════════════════════════════════════════════════════════════════════

test("B1 vertical: 31 °C → LED encendido; 25 °C → apagado; 30 °C → apagado (> estricto); humedad por el mismo bus", () => {
  const prog = ejecutar(mainDe(opsDht11(MAYOR_30)))
  prog.setup()
  assert.equal(prog.led(), 0, "arranca en reposo")
  prog.sensor.estado = { humedad: 55, temperatura: 31 }
  prog.correrHasta(1010)
  assert.equal(prog.placa.inicios.length, 1)
  assert.equal(prog.led(), 1)
  prog.sensor.estado = { humedad: 55, temperatura: 25 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0)
  prog.sensor.estado = { humedad: 55, temperatura: 30 }
  prog.correrHasta(7010)
  assert.equal(prog.led(), 0, "30 no es > 30")
  // Humedad: entero + decimal por el mismo bus y la misma lectura.
  const progH = ejecutar(mainDe(opsDht11(regla("humedad", ">", C(60, "porcentaje", "humedad")))))
  progH.setup()
  progH.sensor.estado = { humedad: 65, temperatura: 25 }
  progH.correrHasta(1010)
  assert.equal(progH.led(), 1)
  progH.sensor.estado = { humedad: 55, temperatura: 25 }
  progH.correrHasta(4010)
  assert.equal(progH.led(), 0)
})

test("B2 los cuatro comparadores de la IR, en el borde y a cada lado", () => {
  for (const [comparador, casos] of [[">", [[29, 0], [30, 0], [31, 1]]], [">=", [[29, 0], [30, 1], [31, 1]]], ["<", [[29, 1], [30, 0], [31, 0]]], ["<=", [[29, 1], [30, 1], [31, 0]]]]) {
    const prog = ejecutar(mainDe(opsDht11(regla("temperatura", comparador, C(30)))))
    prog.setup()
    let t = 1010
    for (const [temperatura, esperado] of casos) {
      prog.sensor.estado = { humedad: 50, temperatura }
      prog.correrHasta(t)
      assert.equal(prog.led(), esperado, `${temperatura} ${comparador} 30`)
      t += 3000
    }
  }
})

test("B3 determinismo: misma IR + catálogo → mismos bytes; el orden de las operaciones no cambia nada", () => {
  const a = generarOk(construir(K, opsDht11(MAYOR_30)))
  const b = generarOk(construir(K, opsDht11(MAYOR_30)))
  assert.deepEqual(a.archivos, b.archivos)
  assert.equal(a.environment, "esp32-devkit-v1")
  assert.doesNotMatch(a.archivos["platformio.ini"], /lib_deps/)
  assert.doesNotMatch(a.archivos["src/main.cpp"], /\d{4}-\d{2}-\d{2}T/, "sin marcas temporales")
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — trama: entero/decimal y signo (lo que distingue al DHT11 del AM2302)
// ════════════════════════════════════════════════════════════════════════════════════

test("C1 decimales: 25,4 °C se decodifica como 25,4 (no como 254 ni como 640); la humedad también suma su decimal", () => {
  const prog = ejecutar(mainDe(opsDht11(regla("temperatura", ">", C(25.2)))))
  prog.setup()
  prog.sensor.estado = { humedad: 50, temperatura: 25.4 }
  prog.correrHasta(1010)
  assert.equal(prog.led(), 1, "25,4 > 25,2")
  prog.sensor.estado = { humedad: 50, temperatura: 25.0 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0, "25,0 no es > 25,2")
  // Comprobación directa de las expresiones del backend, sin pasar por el programa.
  const d = BACKENDS_DE_PROTOCOLO["bus-unico-dht11"]
  const evaluar = (expr, bytes) => new Function("datos", `return ${expr.replace(/(\d)f\b/g, "$1")};`)(bytes)
  assert.equal(evaluar(d.campos[1].expresion("datos"), bytesDht11(50, 25.4)), 25.4)
  assert.equal(evaluar(d.campos[0].expresion("datos"), bytesDht11(55.5, 25)), 55.5)
  // El decodificador del AM2302 leería estos bytes como 640 °C: por eso son dos protocolos.
  assert.equal(evaluar(BACKENDS_DE_PROTOCOLO["bus-unico-am2302"].campos[1].expresion("datos"), bytesDht11(50, 25)), 640)
})

test("C2 signo: el bit 7 del byte decimal de temperatura marca negativo (V1.3); una regla «< 0 °C» ve −5,3 °C", () => {
  const d = BACKENDS_DE_PROTOCOLO["bus-unico-dht11"]
  const evaluar = (expr, bytes) => new Function("datos", `return ${expr.replace(/(\d)f\b/g, "$1")};`)(bytes)
  assert.equal(evaluar(d.campos[1].expresion("datos"), bytesDht11(50, -5.3)), -5.3)
  assert.deepEqual(bytesDht11(50, -5.3).slice(2, 4), [5, 0x83])
  // Un umbral de −1 °C queda fuera del rango del catálogo (0–50 °C): UMBRAL_FUERA_DE_RANGO es un aviso,
  // no un bloqueo, así que el programa se genera y la lectura negativa se interpreta bien igual.
  const p = construir(K, opsDht11(regla("temperatura", "<", C(-1))))
  assert.ok(validarProyecto(p, K.catalogo).some((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO"))
  assert.equal(readinessDe(p).listo, true)
  const prog = ejecutar(generarOk(p).archivos["src/main.cpp"])
  prog.setup()
  prog.sensor.estado = { humedad: 50, temperatura: -5.3 }
  prog.correrHasta(1010)
  assert.equal(prog.led(), 1)
  prog.sensor.estado = { humedad: 50, temperatura: 5 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0)
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — tiempos: espera y período salen de Component Knowledge; bloqueo acotado y declarado
// ════════════════════════════════════════════════════════════════════════════════════

test("D1 la primera lectura espera 1 s y entre intentos pasan al menos 3 s (Component Knowledge del DHT11)", () => {
  assert.deepEqual([LECTURA_DHT11.esperaTrasEncendido, LECTURA_DHT11.periodoMinimo].map((c) => [c.valor, c.unidad]), [[1, "segundo"], [3, "segundo"]])
  const cpp = mainDe(opsDht11(MAYOR_30))
  assert.match(cpp, /static const uint32_t ESPERA_MS_CMP_0_SENAL = 1000;/)
  assert.match(cpp, /static const uint32_t PERIODO_MS_CMP_0_SENAL = 3000;/)
  assert.match(cpp, /Component Knowledge: espera tras el encendido 1 s, periodo minimo 3 s\./)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.correrHasta(30000, 7)
  const inicios = prog.placa.inicios
  assert.ok(inicios.length >= 9, `intentos: ${inicios.length}`)
  assert.ok(inicios[0] >= 1000 && inicios[0] < 1010, `primer intento a los ${inicios[0]} ms`)
  for (let i = 1; i < inicios.length; i++) assert.ok(inicios[i] - inicios[i - 1] >= 3000 - 1, `intervalo ${inicios[i] - inicios[i - 1]} ms`)
  assert.ok(inicios.length <= 11, "sin lecturas excesivas: una por período")
})

test("D2 los tiempos SALEN del catálogo: con otros valores declarados cambia el programa y el comportamiento", () => {
  const k = conocimientoCon({ dht11: { capacidades: DHT11.capacidades.map((c) => ({ ...c, lectura: { ...c.lectura, esperaTrasEncendido: { valor: 4, unidad: "segundo", magnitud: "tiempo" }, periodoMinimo: { valor: 5, unidad: "segundo", magnitud: "tiempo" } } })) } })
  const cpp = mainDe(opsDht11(MAYOR_30), k)
  assert.match(cpp, /ESPERA_MS_CMP_0_SENAL = 4000;/)
  assert.match(cpp, /PERIODO_MS_CMP_0_SENAL = 5000;/)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.correrHasta(30000, 7)
  assert.ok(prog.placa.inicios[0] >= 4000)
  for (let i = 1; i < prog.placa.inicios.length; i++) assert.ok(prog.placa.inicios[i] - prog.placa.inicios[i - 1] >= 5000 - 1)
})

test("D3 bloqueo declarado y acotado: un solo delayMicroseconds de 20 000, sin delay(); lectura completa < 25 ms; loop sin lectura cuesta microsegundos", () => {
  const cpp = mainDe(opsDht11(MAYOR_30))
  assert.doesNotMatch(cpp, /\bdelay\s*\(/)
  const esperas = [...cpp.matchAll(/delayMicroseconds\((\d+)\)/g)].map((m) => Number(m[1]))
  assert.deepEqual(esperas, [20000])
  assert.match(cpp, /20 ms, bloqueantes, una vez por periodo/)
  const prog = ejecutar(cpp)
  prog.setup()
  prog.placa.t = 500_000
  const antes = prog.placa.t
  prog.loop()
  assert.ok(prog.placa.t - antes < 100, "un loop sin lectura no espera")
  prog.placa.t = 1_000_000
  const antesLectura = prog.placa.t
  prog.loop()
  const duracion = prog.placa.t - antesLectura
  assert.ok(duracion >= 20_000 && duracion < 25_000, `una lectura completa tarda ${duracion} µs`)
  assert.equal(prog.placa.interrupcionesOff, 1, "las interrupciones se cortan sólo durante los bits, no durante el pulso")
  assert.ok(prog.placa.pulsos[0] >= 18_000 && prog.placa.pulsos[0] <= 30_000, `pulso de inicio de ${prog.placa.pulsos[0]} µs`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — política ante fallas (D3 = A): inválida ≠ falso; el actuador vuelve a su reposo
// ════════════════════════════════════════════════════════════════════════════════════

for (const falla of ["muerto", "checksum"]) {
  for (const [comparador, buena] of [[">", 40], ["<", 20]]) {
    test(`E1 lectura inválida («${falla}», regla «${comparador} 30»): no reutiliza el valor anterior y el LED vuelve a su reposo`, () => {
      const prog = ejecutar(mainDe(opsDht11(regla("temperatura", comparador, C(30)))))
      prog.setup()
      prog.sensor.estado = { humedad: 40, temperatura: buena }
      prog.correrHasta(1010)
      assert.equal(prog.led(), 1)
      prog.sensor.estado = falla
      prog.correrHasta(3990)
      assert.equal(prog.led(), 1, "hasta el siguiente intento se usa la lectura válida vigente")
      prog.correrHasta(4010)
      assert.equal(prog.placa.inicios.length, 2)
      assert.equal(prog.led(), 0, `el intento falló: la lectura anterior (${buena} °C) ya no vale`)
      prog.correrHasta(6990)
      assert.equal(prog.led(), 0, "sigue en reposo mientras no haya otra lectura válida")
      prog.sensor.estado = { humedad: 40, temperatura: buena }
      prog.correrHasta(7010)
      assert.equal(prog.led(), 1, "una lectura válida nueva vuelve a contar")
    })
  }
}

test("E2 sensor desconectado (nunca responde): el LED nunca se enciende aunque la regla sea «menor que»; el timeout corta la lectura", () => {
  const prog = ejecutar(mainDe(opsDht11(regla("temperatura", "<", C(30)))))
  prog.setup()
  prog.sensor.estado = "muerto"
  const antes = prog.placa.t
  prog.correrHasta(10000)
  assert.equal(prog.led(), 0)
  assert.ok(prog.placa.inicios.length >= 3)
  // Sin respuesta el driver devuelve en el primer timeout (250 µs) después del pulso: nunca cuelga.
  prog.placa.t = 13_000_000
  const t0 = prog.placa.t
  prog.loop()
  assert.ok(prog.placa.t - t0 < 21_000, `lectura fallida tarda ${prog.placa.t - t0} µs`)
  assert.ok(antes <= prog.placa.t)
})

test("E3 la acción «apagar»: sin lectura válida queda en SU reposo (encendido), no «apagado» por defecto", () => {
  const prog = ejecutar(mainDe(opsDht11(regla("temperatura", ">", C(30), "cmp-1", "apagar"))))
  prog.setup()
  assert.equal(prog.led(), 1, "reposo de «apagar» es encendido")
  prog.sensor.estado = "muerto"
  prog.correrHasta(5000)
  assert.equal(prog.led(), 1)
  prog.sensor.estado = { humedad: 40, temperatura: 35 }
  prog.correrHasta(7010)
  assert.equal(prog.led(), 0, "con la condición válida y cierta, apaga")
})

test("E4 handshake: con el pulso del AM2302 (1100 µs) el DHT11 simulado no responde; con el pulso generado (20 ms) sí", () => {
  const cpp = mainDe(opsDht11(MAYOR_30))
  const corto = cpp.replace("delayMicroseconds(20000);", "delayMicroseconds(1100);")
  assert.notEqual(corto, cpp)
  const prog = ejecutar(corto)
  prog.setup()
  prog.sensor.estado = { humedad: 40, temperatura: 40 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0, "con un pulso de inicio corto el sensor no responde: lectura inválida")
  const bien = ejecutar(cpp)
  bien.setup()
  bien.sensor.estado = { humedad: 40, temperatura: 40 }
  bien.correrHasta(1010)
  assert.equal(bien.led(), 1)
})

test("E5 lectura incompleta: si el sensor corta la trama a mitad, la lectura es inválida (timeout de bit) y el LED queda en reposo", () => {
  const prog = ejecutar(mainDe(opsDht11(MAYOR_30)))
  prog.setup()
  // La trama del sensor se recorta a 20 bits: el driver vence el timeout del bit 21 y devuelve false.
  prog.sensor.truncarBits = 20
  prog.sensor.estado = { humedad: 40, temperatura: 40 }
  prog.correrHasta(4010)
  assert.equal(prog.led(), 0)
  assert.equal(prog.placa.inicios.length, 2)
  // Con la trama completa, la misma lectura vale.
  prog.sensor.truncarBits = undefined
  prog.correrHasta(7010)
  assert.equal(prog.led(), 1)
})

// ════════════════════════════════════════════════════════════════════════════════════
// G — generabilidad: NO GENERABLE → GENERABLE, verificable; lo no soportado sigue bloqueado
// ════════════════════════════════════════════════════════════════════════════════════

test("G1 con el backend registrado, el DHT11 es GENERABLE sólo en esp32-devkit-v1; sin él, CODEGEN_PROTOCOLO_SIN_BACKEND (mismo resolver)", () => {
  const con = generabilidad(K).componentes.find((c) => c.tipo === "dht11")
  assert.deepEqual(con.generableEn, ["esp32-devkit-v1"])
  for (const c of con.capacidades) {
    assert.deepEqual(c.lectura, { soportada: true, codigo: null, datos: null, mecanismo: "protocolo", protocolo: "bus-unico-dht11" })
    assert.deepEqual(c.generableEn, ["esp32-devkit-v1"])
  }
  const sinBackend = Object.fromEntries(Object.entries(BACKENDS_DE_PROTOCOLO).filter(([p]) => p !== "bus-unico-dht11"))
  const sin = generabilidad(K, { protocolos: sinBackend }).componentes.find((c) => c.tipo === "dht11")
  assert.deepEqual(sin.generableEn, [])
  assert.equal(sin.capacidades[0].lectura.codigo, "CODEGEN_PROTOCOLO_SIN_BACKEND")
  // La admisión eléctrica es independiente: igual con o sin backend.
  assert.deepEqual(sin.porPlaca, con.porPlaca)
  assert.equal(generarPrograma(construir(K, opsDht11(MAYOR_30)), K, { protocolos: sinBackend }).error.codigo, "CODEGEN_PROTOCOLO_SIN_BACKEND")
})

test("G2 lo no soportado sigue bloqueado: arduino-uno NO_ADMITIDO, NTC sin lectura, GPIO12 no listo, sin revisión del par NO_ADMITIDO", () => {
  const g = generabilidad(K)
  const dht11 = g.componentes.find((c) => c.tipo === "dht11")
  assert.equal(dht11.porPlaca.find((p) => p.placa === "arduino-uno").admitido, false)
  assert.ok(!dht11.generableEn.includes("arduino-uno"))
  const ntc = g.componentes.find((c) => c.tipo === "ntc")
  assert.deepEqual(ntc.generableEn, [])
  assert.equal(ntc.capacidades[0].lectura.codigo, "CODEGEN_SIN_LECTURA")
  const enUno = generarPrograma(construir(K, [["SetPlaca", { placa: "arduino-uno" }], ["AgregarComponente", { tipo: "dht11" }], ["AgregarComponente", { tipo: "led" }], ["AgregarComponente", { tipo: "resistencia" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "D2" }], ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "D13" }], ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }], MAYOR_30]), K)
  assert.equal(enUno.ok, false)
  assert.equal(enUno.error.codigo, "CODEGEN_NO_ADMITIDO")
  // GPIO12: readiness manda antes que el backend.
  let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => "p12", ahora: () => "2026-01-01T00:00:00.000Z" })
  for (const [i, [tipo, payload]] of opsSensor("dht11", "GPIO12", MAYOR_30).entries()) {
    const r = ejecutarOperacion(p, { idOperacion: `g-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
    if (r.ok) p = r.proyecto
  }
  assert.equal(readinessDe(p).listo, false)
  assert.equal(generarPrograma(p, K).error.codigo, "CODEGEN_PROYECTO_NO_LISTO")
})

test("G3 dos protocolos en un mismo proyecto (DHT22 y DHT11): dos drivers con prefijos distintos, sin redefinir ninguna función", () => {
  const cpp = mainDe([
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "dht22" }],
    ["AgregarComponente", { tipo: "dht11" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "senal", pin: "GPIO5" }],
    ["AsignarPin", { componente: "cmp-2", terminal: "anodo", pin: "GPIO18" }],
    ["AsignarPin", { componente: "cmp-4", terminal: "anodo", pin: "GPIO19" }],
    ["Conectar", { desde: { componente: "cmp-3", terminal: "a" }, hasta: { componente: "cmp-2", terminal: "anodo" } }],
    ["Conectar", { desde: { componente: "cmp-5", terminal: "a" }, hasta: { componente: "cmp-4", terminal: "anodo" } }],
    ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: C(30) }, entonces: { actuador: "cmp-2", accion: "encender" } } }],
    ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: C(30) }, entonces: { actuador: "cmp-4", accion: "encender" } } }],
  ])
  assert.match(cpp, /valida_cmp_0_senal = am2302_leer\(PIN_CMP_0_SENAL/)
  assert.match(cpp, /valida_cmp_1_senal = dht11_leer\(PIN_CMP_1_SENAL/)
  const definiciones = [...cpp.matchAll(/^static (?:bool|uint32_t|float) (\w+)\(/gm)].map((m) => m[1])
  assert.deepEqual(definiciones.filter((n, i) => definiciones.indexOf(n) !== i), [], "ninguna función se define dos veces")
  assert.deepEqual(definiciones.filter((n) => /_esperar$|_leer$/.test(n)).sort(), ["am2302_esperar", "am2302_leer", "dht11_esperar", "dht11_leer"])
  assert.match(cpp, /ESPERA_MS_CMP_0_SENAL = 2000;[\s\S]*PERIODO_MS_CMP_0_SENAL = 2000;[\s\S]*ESPERA_MS_CMP_1_SENAL = 1000;[\s\S]*PERIODO_MS_CMP_1_SENAL = 3000;/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// R — regresión DHT22: el backend AM2302 no cambió ni un byte
// ════════════════════════════════════════════════════════════════════════════════════

test("REG-2 el driver AM2302 es byte a byte el del baseline 4f53b65 (antes del generador compartido), y sus campos tampoco cambiaron", () => {
  const d = BACKENDS_DE_PROTOCOLO["bus-unico-am2302"]
  assert.equal(d.driver.length, 36)
  assert.equal(sha(d.driver.join("\n")), "b5662ee8840f544bdb0f1bce2eac9118154dac0e8e6786de34a05987ea6113a3")
  assert.equal(d.funcion, "am2302_leer")
  assert.equal(d.campos[0].expresion("d"), "((d[0] << 8) | d[1]) * 0.1f")
  assert.equal(d.campos[1].expresion("d"), "(((d[2] & 0x7F) << 8) | d[3]) * ((d[2] & 0x80) ? -0.1f : 0.1f)")
  assert.match(d.driver.join("\n"), /delayMicroseconds\(1100\);/)
  assert.deepEqual(DHT22.capacidades.map((c) => [c.lectura.periodoMinimo.valor, c.lectura.esperaTrasEncendido.valor]), [[2, 2], [2, 2]])
})

test("REG-3 la IR de HARDWARE E2E #1 (DHT22) sigue generando el mismo cuerpo de main.cpp (sha fijado en CK-CG2) y el mismo platformio.ini", () => {
  const p = construir(K, [
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "dht22" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "senal", pin: "GPIO4" }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } }],
    ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: C(30) }, entonces: { actuador: "cmp-0", accion: "encender" } } }],
  ])
  const r = generarOk(p)
  const cuerpo = r.archivos["src/main.cpp"].split("\n").filter((l) => !l.startsWith("// proyecto: ")).join("\n")
  assert.equal(sha(cuerpo), "8c7fd0f86b153d1b26a876540820b74456ac477620f9ed75c3f22e729c0aba1d")
  assert.equal(sha(r.archivos["platformio.ini"]), "b4ea2df4fc2401ec488b0254ff714176119e561447817a99631de64da7321fde")
})
