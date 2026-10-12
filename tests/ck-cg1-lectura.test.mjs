// CK-CG1 — cómo se obtiene físicamente una capacidad (DHT22 / ESP32 DevKit V1).
//
// Component Knowledge declara QUÉ hace la pieza (`Capacidad.lectura`: protocolo, intervalo mínimo,
// espera tras el encendido), nunca CÓMO lo implementa un backend. La revisión eléctrica del par
// (dht22, esp32-devkit-v1) la hizo un HUMANO (Alejandro Palestrini, 2026-10-06); estos tests la
// LEEN, no la producen: ninguno agrega datos al anexo.
//
// Contratos: 1–12 del pedido + R3 (bidireccional ⇒ entrada Y salida) + R4 (GPIO12 con pull-up
// externo) + las deudas DHT-PULLUP-01, H-01 y ESP-STRAP-05.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { admitirComponente, compatibilidadRevisada, oficialmenteSoportados, REVISIONES_DEL_ANEXO } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { REVISIONES_DE_COMPONENTE } = await import(join(REPO, "opencode/conocimiento/anexos/revision-electrica.ts"))
const { construirCatalogo, proyeccionSemanticaCatalogo, asignarPin } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { PROTOCOLOS_DE_LECTURA, MECANISMOS_DE_LECTURA, MAGNITUDES } = await import(join(REPO, "opencode/nucleo/registros/vocabulario.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { crearProyecto, cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const leer = (ruta) => readFileSync(join(REPO, ruta), "utf8")
const valor = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.valor
}
const catalogoCon = (componentes) =>
  crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
const DHT22 = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "dht22")

/** Proyecto real por las operaciones del Engine. */
function proyecto(ops, conocimiento = K) {
  let p = crearProyecto({ catalogoVersion: conocimiento.catalogo.version, catalogoHash: conocimiento.catalogo.hash, generadorId: () => "proyecto-ck-cg1", ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, conocimiento.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}
const motivosDe = (p, conocimiento = K) => validarProyecto(p, conocimiento.catalogo)
const dhtEn = (pin) => proyecto([["SetPlaca", { placa: "esp32-devkit-v1" }], ["AgregarComponente", { tipo: "dht22" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin }]])

// ════════════════════════════════════════════════════════════════════════════════════
// 1–2: el conocimiento cuantitativo existente no cambia
// ════════════════════════════════════════════════════════════════════════════════════

test("1/2 DHT22 conserva sus capacidades cuantitativas: magnitud, unidades, unidad canónica y rango (H-01 sin tocar)", () => {
  const caps = valor(K.capacidadesCuantitativas("dht22"))
  assert.deepEqual(caps.map((c) => c.capacidad), ["temperatura", "humedad"])
  const t = valor(K.capacidadCuantitativa("dht22", "temperatura"))
  assert.equal(t.magnitud, "temperatura")
  assert.equal(t.unidadCanonica, "celsius")
  assert.deepEqual(t.unidades.map((u) => u.id), ["celsius", "fahrenheit"])
  assert.deepEqual(t.rango, { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 60, unidad: "celsius", magnitud: "temperatura" } }, "H-01: el rango 0-60 °C NO se corrige en CK-CG1")
  assert.deepEqual(t.disponibilidadSemantica, { disponible: true, motivos: [] })
  const h = valor(K.capacidadCuantitativa("dht22", "humedad"))
  assert.equal(h.unidadCanonica, "porcentaje")
  assert.deepEqual(valor(K.convertirParaCapacidad("dht22", "temperatura", { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" }, "celsius")), { valor: 30, unidad: "celsius", magnitud: "temperatura" })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3–6: el contrato de lectura es estructurado, genérico y sin implementación
// ════════════════════════════════════════════════════════════════════════════════════

test("3 la lectura es estructurada: terminal asignable bidireccional, mecanismo y protocolo de vocabularios cerrados, tiempos válidos", () => {
  const esperado = {
    terminal: "senal",
    mecanismo: "protocolo",
    protocolo: "bus-unico-am2302",
    periodoMinimo: { valor: 2, unidad: "segundo", magnitud: "tiempo" },
    esperaTrasEncendido: { valor: 2, unidad: "segundo", magnitud: "tiempo" },
  }
  for (const capacidad of ["temperatura", "humedad"]) assert.deepEqual(K.lecturaDeCapacidad("dht22", capacidad), esperado, capacidad)
  const terminal = K.terminales("dht22").find((t) => t.id === "senal")
  assert.equal(terminal.asignable, true)
  assert.equal(terminal.direccion, "bidireccional")
  assert.equal(terminal.pullUpExterno, true)
  assert.ok(MECANISMOS_DE_LECTURA.includes(esperado.mecanismo))
  assert.ok(Object.hasOwn(PROTOCOLOS_DE_LECTURA, esperado.protocolo))
  assert.deepEqual(MAGNITUDES.tiempo.unidades, ["segundo"])
  // Sin `lectura`: se lee por el nivel del terminal (nada cambia para el pulsador ni el interruptor).
  for (const [tipo, capacidad] of [["pulsador", "estadoBooleano"], ["interruptor", "estadoBooleano"], ["ntc", "temperatura"]]) assert.equal(K.lecturaDeCapacidad(tipo, capacidad), undefined, tipo)
  assert.equal(K.lecturaDeCapacidad("dht22", "inexistente"), undefined)
  assert.equal(K.lecturaDeCapacidad("no-existe", "temperatura"), undefined)
})

test("3 la admisión rechaza una lectura incoherente (terminal, mecanismo, protocolo o tiempo)", () => {
  const conLectura = (lectura) => catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "dht22" ? { ...c, capacidades: c.capacidades.map((k) => ({ ...k, lectura: { ...k.lectura, ...lectura } })) } : c)))
  const casos = [
    [{ terminal: "vcc" }, /terminal inexistente o no asignable/],
    [{ terminal: "nada" }, /terminal inexistente o no asignable/],
    [{ mecanismo: "magia" }, /mecanismo de lectura desconocido/],
    [{ protocolo: "inventado" }, /protocolo de lectura desconocido/],
    [{ periodoMinimo: { valor: 2, unidad: "celsius", magnitud: "temperatura" } }, /periodoMinimo no es un tiempo válido/],
    [{ esperaTrasEncendido: { valor: -1, unidad: "segundo", magnitud: "tiempo" } }, /esperaTrasEncendido no es un tiempo válido/],
  ]
  for (const [lectura, problema] of casos) {
    const informe = admitirComponente(conLectura(lectura), "dht22")
    assert.equal(informe.flags.semantico, false, JSON.stringify(lectura))
    assert.equal(informe.officiallySupported, false)
    assert.ok(informe.problemas.some((p) => problema.test(p)), `${JSON.stringify(lectura)}: ${informe.problemas.join(" | ")}`)
  }
})

test("4 genérico: un sensor sintético con el mismo protocolo se resuelve igual, y ningún consumidor genérico nombra al DHT22", () => {
  const sintetico = { ...DHT22, id: "sensor-bus-unico-fixture" }
  const k = catalogoCon([...COMPONENTES_CATALOGO_MINIMO, sintetico])
  assert.deepEqual(k.lecturaDeCapacidad("sensor-bus-unico-fixture", "temperatura"), K.lecturaDeCapacidad("dht22", "temperatura"))
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  for (const archivo of ["opencode/nucleo/catalogo.ts", "opencode/conocimiento/admision.ts", "opencode/conocimiento/conocimiento.ts", "opencode/nucleo/registros/vocabulario.ts"]) {
    const codigo = sinComentarios(leer(archivo))
    assert.doesNotMatch(codigo, /["'`]dht22["'`]/, archivo)
    assert.doesNotMatch(codigo, /["'`]GPIO(12|3[4-9])["'`]/, archivo)
  }
  // Las reglas de pines son por dato del terminal × dato del pin, nunca por número.
  const reglas = sinComentarios(leer("opencode/nucleo/catalogo.ts"))
  assert.match(reglas, /terminal\.pullUpExterno && pin\.restricciones\.includes\("strappingVddSdio"\)/)
  assert.match(reglas, /pin\.capacidades\.entradaDigital && pin\.capacidades\.salidaDigital/)
  // Codegen S2 consume `lecturaDeCapacidad`, pero nunca nombra la pieza.
  for (const archivo of readdirSync(join(REPO, "opencode/codegen"))) assert.doesNotMatch(leer(`opencode/codegen/${archivo}`), /dht22/i, `codegen/ no nombra la pieza (${archivo})`)
})

test("5/6 el contrato no contiene C++, Arduino, librerías ni lib_deps", () => {
  const contrato = JSON.stringify({
    protocolos: PROTOCOLOS_DE_LECTURA,
    mecanismos: MECANISMOS_DE_LECTURA,
    lecturas: COMPONENTES_CATALOGO_MINIMO.flatMap((c) => c.capacidades.map((k) => k.lectura).filter(Boolean)),
  })
  for (const prohibido of [/#include/, /\.h\b/, /begin\s*\(/, /read[A-Z]\w*/, /\bDHT\b/, /lib_deps/i, /adafruit/i, /arduino/i, /platformio/i, /::/, /\(\)/]) assert.doesNotMatch(contrato, prohibido, String(prohibido))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7–9: hash, persistencia y compatibilidad
// ════════════════════════════════════════════════════════════════════════════════════

test("7 el hash refleja el conocimiento nuevo: fijado, y la lectura y el registro de protocolos son semántica", () => {
  // CK-CG2: la versión literal ("2.3.0") pasó a la fixture; este test protege que el hash ACTIVO sea
  // el fijado y que la identidad anterior (CK-CG1, 2.3.0) siga registrada como `anterior`.
  assert.equal(K.catalogo.version, CATALOGO_FIJADO.version)
  assert.equal(K.catalogo.hash, CATALOGO_FIJADO.hash)
  assert.notEqual(K.catalogo.hash, CATALOGO_FIJADO.anterior.hash)
  assert.deepEqual(CATALOGO_FIJADO.anterior, { version: "2.3.0", hash: "b20d038cc39779213f902ca313d7e4e35a40fae8a66d9f21dadeb7285b19c901" })
  const datos = { version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }
  const proyeccion = proyeccionSemanticaCatalogo(datos)
  assert.deepEqual(proyeccion.protocolosDeLectura, PROTOCOLOS_DE_LECTURA)
  assert.equal(sha256Hex(canonicalizar(proyeccion)), K.catalogo.hash)
  const sinLectura = { ...datos, componentes: COMPONENTES_CATALOGO_MINIMO.map((c) => ({ ...c, capacidades: c.capacidades.map(({ lectura, ...resto }) => resto) })) }
  assert.notEqual(sha256Hex(canonicalizar(proyeccionSemanticaCatalogo(sinLectura))), K.catalogo.hash, "quitar la lectura cambia el significado")
  assert.notEqual(sha256Hex(canonicalizar({ ...proyeccion, protocolosDeLectura: {} })), K.catalogo.hash, "el registro de protocolos entra al hash")
})

test("8/9 persistencia y recarga sin cambios; un proyecto creado con 2.2.0 sigue cargando sin reescribir su identidad", () => {
  const p = proyecto([
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "dht22" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
    ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } }],
  ])
  const documento = JSON.stringify(p)
  const recargado = cargarProyecto(documento)
  assert.equal(recargado.ok, true, JSON.stringify(recargado))
  assert.deepEqual(JSON.parse(JSON.stringify(recargado.proyecto)), JSON.parse(documento))
  assert.equal(derivarReadiness(recargado.proyecto, motivosDe(recargado.proyecto)).listo, true)

  const viejo = JSON.stringify({ ...JSON.parse(documento), catalogoVersion: "2.2.0", catalogoHash: CATALOGO_FIJADO.anterior.hash })
  const r = cargarProyecto(viejo)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.proyecto.catalogoHash, CATALOGO_FIJADO.anterior.hash, "createdWith no se reescribe")
  assert.equal(derivarReadiness(r.proyecto, motivosDe(r.proyecto)).listo, true, "con el DATA en GPIO4 sigue listo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// R3 / R4: reglas genéricas de pines
// ════════════════════════════════════════════════════════════════════════════════════

test("R3 bidireccional ⇒ entrada Y salida digital: el DATA del DHT22 no va en GPIO34-39; en GPIO4 queda listo", () => {
  for (const pin of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
    const m = motivosDe(dhtEn(pin))
    assert.ok(m.some((x) => x.codigo === "CAPACIDAD_PIN_INCOMPATIBLE" && x.severidad === "blocking" && x.clasificacion === "representable"), `${pin}: ${m.map((x) => x.codigo)}`)
  }
  assert.deepEqual(motivosDe(dhtEn("GPIO4")), [])
  // Genérico, sobre la regla misma: una entrada simple sí puede ir en un pin solo-entrada.
  const pinSoloEntrada = K.placa("esp32-devkit-v1").pines.find((p) => p.id === "GPIO34")
  const base = { id: "x", rol: "senal", electrica: "digital", asignable: true }
  assert.equal(asignarPin({ ...base, direccion: "entrada" }, pinSoloEntrada), null)
  assert.equal(asignarPin({ ...base, direccion: "bidireccional" }, pinSoloEntrada)?.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
  assert.equal(asignarPin({ ...base, direccion: "salida" }, pinSoloEntrada)?.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
})

test("R4 GPIO12 (strappingVddSdio) es bloqueante para un terminal con pull-up externo; los demás strapping y las demás piezas no cambian", () => {
  const m = motivosDe(dhtEn("GPIO12"))
  assert.ok(m.some((x) => x.codigo === "PIN_STRAPPING_PULLUP_EXTERNO" && x.severidad === "blocking" && x.clasificacion === "representable"), m.map((x) => x.codigo).join(","))
  assert.equal(derivarReadiness(dhtEn("GPIO12"), m).listo, false)
  for (const pin of ["GPIO0", "GPIO2", "GPIO15", "GPIO5"]) assert.ok(!motivosDe(dhtEn(pin)).some((x) => x.codigo === "PIN_STRAPPING_PULLUP_EXTERNO"), `${pin} conserva su política`)
  const pulsador = proyecto([["SetPlaca", { placa: "esp32-devkit-v1" }], ["AgregarComponente", { tipo: "pulsador" }], ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO12" }]])
  assert.deepEqual(motivosDe(pulsador).map((x) => [x.codigo, x.severidad]), [["PIN_STRAPPING", "warning"]], "sin pull-up externo, GPIO12 sigue como antes")
  // El dato vive en la placa: sólo GPIO12 lo tiene.
  assert.deepEqual(K.placa("esp32-devkit-v1").pines.filter((p) => p.restricciones.includes("strappingVddSdio")).map((p) => p.id), ["GPIO12"])
  assert.ok(!K.placa("arduino-uno").pines.some((p) => p.restricciones.includes("strappingVddSdio")))
  assert.match(leer("opencode/vista-fisica/explicaciones-motivos.ts"), /PIN_STRAPPING_PULLUP_EXTERNO:/, "el motivo nuevo tiene explicación para el alumno")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 10–11: la admisión sigue siendo la autoridad; la revisión humana se LEE
// ════════════════════════════════════════════════════════════════════════════════════

const OPS_DHT_LED = [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo: "dht22" }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } }],
]

test("10 sin la revisión humana del par, el DHT22 vuelve a CODEGEN_NO_ADMITIDO (nada en el codegen lo exceptúa)", () => {
  const sinDht = { placas: REVISIONES_DEL_ANEXO.placas, componentes: REVISIONES_DEL_ANEXO.componentes.filter((r) => r.tipo !== "dht22") }
  assert.equal(compatibilidadRevisada("dht22", "esp32-devkit-v1", sinDht), false)
  const r = generarPrograma(proyecto(OPS_DHT_LED), K, { revisiones: sinDht })
  assert.equal(r.ok, false)
  assert.equal(r.error.codigo, "CODEGEN_NO_ADMITIDO")
  assert.ok(r.error.datos.noAdmitidos.some((x) => x.id === "dht22" && x.problemas.some((p) => p.startsWith("electrico"))))
})

test("11 con la revisión humana del anexo, la admisión se resuelve por la autoridad existente y el codegen genera (driver por protocolo, Codegen S2)", () => {
  assert.equal(compatibilidadRevisada("dht22", "esp32-devkit-v1"), true)
  assert.equal(compatibilidadRevisada("dht22", "arduino-uno"), false, "la revisión es por PAR")
  assert.equal(admitirComponente(K, "dht22").officiallySupported, true)
  assert.ok(oficialmenteSoportados(K).includes("dht22"))
  const r = generarPrograma(proyecto(OPS_DHT_LED), K)
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null))
})

test("11 el registro persistido es el texto aprobado por el humano, sin afirmaciones no demostradas", () => {
  const registros = REVISIONES_DE_COMPONENTE.filter((r) => r.tipo === "dht22")
  assert.equal(registros.length, 1)
  const [r] = registros
  assert.equal(r.placa, "esp32-devkit-v1")
  assert.equal(r.revisadoPor, "revisión humana de Alejandro Palestrini (CK-CG1, DHT22 en ESP32 DevKit V1, 2026-10-06)")
  for (const fragmento of [
    "Modelo pedagógico aprobado en Tecnia Bot: DHT22/AM2302 representado mediante VCC, DATA y GND en ESP32 DevKit V1.",
    "esta revisión NO afirma la existencia de un pull-up incorporado; Tecnia Bot todavía no verifica la presencia ni el valor del pull-up requerido (deuda DHT-PULLUP-01).",
    "GPIO34–39 no son válidos",
    "GPIO12 (MTDI) no es válido para DATA",
    "Intervalo mínimo entre lecturas: 2 s",
    "esperar al menos 2 s antes de la primera instrucción",
    "deuda H-01",
    "615c668659e42c797e87226d7510f50c88e5b58998d2b6dc57fb747f611069bd",
    "c91441a385cdf58f5f0ae50b194f294d5d1f0faeaac9a010efacb7ecf21be448",
    "a7917e6b47528c9dcab06837a49d452e582751335797db879f1cf2d17cd29adf",
  ]) assert.ok(r.evidencia.includes(fragmento), fragmento)
  for (const prohibido of [/Modelo aprobado: DHT22\/AM2302 de 3 terminales/, /condición de montaje que Tecnia Bot no verifica/, /\b1 s\b/, /trae el pull-up|pull-up incluido|incorpora un pull-up/i]) assert.doesNotMatch(r.evidencia, prohibido, String(prohibido))
})

test("deudas registradas en el código: DHT-PULLUP-01, H-01 y ESP-STRAP-05", () => {
  const datos = leer("opencode/nucleo/catalogo-datos.ts")
  assert.match(datos, /DHT-PULLUP-01/)
  assert.match(datos, /H-01/)
  assert.match(leer("opencode/nucleo/catalogo.ts"), /DHT-PULLUP-01/)
  assert.match(leer("opencode/nucleo/placas.ts"), /ESP-STRAP-05/)
  const anexo = leer("opencode/conocimiento/anexos/revision-electrica.ts")
  for (const deuda of ["DHT-PULLUP-01", "H-01", "ESP-STRAP-05"]) assert.match(anexo, new RegExp(deuda))
  // ESP-STRAP-05 sigue abierta a propósito: GPIO5 NO se marcó como strapping en CK-CG1.
  assert.ok(!K.placa("esp32-devkit-v1").pines.find((p) => p.id === "GPIO5").restricciones.includes("strapping"))
})
