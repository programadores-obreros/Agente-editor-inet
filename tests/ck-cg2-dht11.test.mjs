// CK-CG2 — el DHT11 (módulo DFRobot Gravity de 3 cables) entra a Component Knowledge.
//
// Qué protege este archivo (Design Gate DHT11, 2026-10-12, veredicto externo APPROVE_WITH_LIMITATIONS):
// - L3: `bus-unico-dht11` es OTRO protocolo, separado del AM2302; la IR no cambia.
// - L4: `dht11` queda DISPONIBLE y ADMITIDO en ESP32, pero NO GENERABLE con un motivo estructurado
//   (`CODEGEN_PROTOCOLO_SIN_BACKEND`) hasta Codegen S2b. Ningún backend se registra acá.
// - L5: el DHT22 conserva su comportamiento: el programa generado para la IR de HARDWARE E2E #1 es
//   byte a byte el mismo salvo la cabecera con el hash del catálogo (que sube a 2.4.0).
// - Observación del revisor: el manual dice «> 2 s»; Component Knowledge declara 3 s y lo dice.
// - Representación propia `pb-dht11` con `pinInfo` real (leído también en Chromium: evidencia del
//   track) y procedencia propia; el renderer no necesita cambios.
//
// La revisión eléctrica del par (dht11, esp32-devkit-v1) la hizo un HUMANO (Alejandro Palestrini,
// 2026-10-12); estos tests la LEEN, no la producen.

import { test } from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { admitirComponente, compatibilidadRevisada, oficialmenteSoportados, REVISIONES_DEL_ANEXO } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { REVISIONES_DE_COMPONENTE } = await import(join(REPO, "opencode/conocimiento/anexos/revision-electrica.ts"))
const { PINES_VERIFICADOS_WOKWI } = await import(join(REPO, "opencode/conocimiento/anexos/golden-wokwi.ts"))
const { ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO, ASSET_POR_ELEMENTO } = await import(join(REPO, "opencode/conocimiento/anexos/representacion.ts"))
const { procedenciaDe, assetDeRepresentacionWokwi } = await import(join(REPO, "opencode/conocimiento/anexos/procedencia.ts"))
const { PROTOCOLOS_DE_LECTURA } = await import(join(REPO, "opencode/nucleo/registros/vocabulario.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { generabilidad } = await import(join(REPO, "opencode/codegen/generabilidad.ts"))
const { BACKENDS_DE_PROTOCOLO } = await import(join(REPO, "opencode/codegen/protocolos.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const leer = (ruta) => readFileSync(join(REPO, ruta), "utf8")
const valor = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.valor
}

/** Proyecto real por las operaciones del Engine (ids y fecha fijos: determinismo). */
function proyecto(ops, { aceptarRechazo = false } = {}) {
  let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => "proyecto-ck-cg2", ahora: () => "2026-01-01T00:00:00.000Z" })
  const rechazos = []
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
    if (r.ok) p = r.proyecto
    else if (aceptarRechazo) rechazos.push({ tipo, payload, motivos: r.motivos })
    else assert.fail(`${tipo}: ${JSON.stringify(r.motivos)}`)
  })
  return aceptarRechazo ? { proyecto: p, rechazos } : p
}
const C = (valor, unidad = "celsius", magnitud = "temperatura") => ({ valor, unidad, magnitud })
const regla = (sensor, capacidad, comparador, umbral, actuador, accion = "encender") => ["SetComportamiento", { comportamiento: { cuando: { sensor, capacidad, comparador, umbral }, entonces: { actuador, accion } } }]

/** ESP32 + DHT11 (cmp-0, DATA en `pin`) + LED (cmp-1, GPIO18) + resistencia (cmp-2) + reglas. */
const opsDht11 = (pin = "GPIO4", ...reglas) => [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo: "dht11" }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ...reglas,
]
const MAYOR_30 = regla("cmp-0", "temperatura", ">", C(30), "cmp-1")
const readinessDe = (p) => derivarReadiness(p, validarProyecto(p, K.catalogo))

// ════════════════════════════════════════════════════════════════════════════════════
// Catálogo
// ════════════════════════════════════════════════════════════════════════════════════

test("CAT-1 dht11 existe: sensor con vcc/senal/gnd, DATA digital bidireccional con pull-up externo declarado", () => {
  const c = K.tipoComponente("dht11")
  assert.ok(c, "dht11 no está en el catálogo")
  assert.equal(c.clase, "sensor")
  assert.deepEqual(c.terminales.map((t) => t.id), ["vcc", "senal", "gnd"])
  const senal = c.terminales.find((t) => t.id === "senal")
  assert.equal(senal.electrica, "digital")
  assert.equal(senal.direccion, "bidireccional")
  assert.equal(senal.pullUpExterno, true)
  assert.equal(senal.asignable, true)
  assert.equal(c.terminales.find((t) => t.id === "vcc").destinoFijo, "VLOGICA")
  assert.equal(c.terminales.find((t) => t.id === "gnd").destinoFijo, "GND")
  assert.deepEqual(K.resolverDestino("esp32-devkit-v1", c.terminales.find((t) => t.id === "vcc")), { kind: "potencia", id: "3V3" })
})

test("CAT-2 capacidades cuantitativas: temperatura 0–50 °C y humedad 20–90 %, resolución 1, disponibles, con la lectura declarada por protocolo", () => {
  const caps = valor(K.capacidadesCuantitativas("dht11"))
  assert.deepEqual(caps.map((c) => c.capacidad), ["temperatura", "humedad"])
  const [t, h] = caps
  assert.equal(t.unidadCanonica, "celsius")
  assert.deepEqual([t.rango.min.valor, t.rango.max.valor], [0, 50])
  assert.equal(t.resolucion.valor, 1)
  assert.equal(h.unidadCanonica, "porcentaje")
  assert.deepEqual([h.rango.min.valor, h.rango.max.valor], [20, 90])
  assert.equal(h.resolucion.valor, 1)
  for (const c of caps) assert.equal(c.disponibilidadSemantica.disponible, true, c.capacidad)
  for (const capacidad of ["temperatura", "humedad"]) {
    const l = K.lecturaDeCapacidad("dht11", capacidad)
    assert.deepEqual({ terminal: l.terminal, mecanismo: l.mecanismo, protocolo: l.protocolo }, { terminal: "senal", mecanismo: "protocolo", protocolo: "bus-unico-dht11" })
  }
})

test("CAT-3 unidades ofrecidas: °C y °F para la temperatura (conversión declarada), sólo % para la humedad; 86 °F = 30 °C", () => {
  const [t, h] = valor(K.capacidadesCuantitativas("dht11"))
  assert.deepEqual(t.unidades.map((u) => u.id).sort(), ["celsius", "fahrenheit"])
  assert.deepEqual(h.unidades.map((u) => u.id), ["porcentaje"])
  const conv = valor(K.convertirParaCapacidad("dht11", "temperatura", { valor: 86, unidad: "fahrenheit", magnitud: "temperatura" }, "celsius"))
  assert.equal(conv.valor, 30)
})

test("CAT-4 el protocolo del DHT11 es OTRO registro, separado del AM2302, en la misma familia (L3)", () => {
  assert.deepEqual(Object.keys(PROTOCOLOS_DE_LECTURA).sort(), ["bus-unico-am2302", "bus-unico-dht11"])
  assert.deepEqual(PROTOCOLOS_DE_LECTURA["bus-unico-dht11"], { familia: "bus-unico" })
  assert.ok(Object.isFrozen(PROTOCOLOS_DE_LECTURA))
  assert.equal(K.lecturaDeCapacidad("dht22", "temperatura").protocolo, "bus-unico-am2302", "el DHT22 no cambió de protocolo")
})

test("CAT-5 identidad: 2.4.0 con hash nuevo fijado; la anterior (2.3.0, CK-CG1) queda registrada; quitar el dht11 o su protocolo cambia el hash", async () => {
  const { proyeccionSemanticaCatalogo, canonicalizarCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
  const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
  const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
  assert.equal(K.catalogo.version, "2.4.0")
  assert.equal(CATALOGO_FIJADO.version, "2.4.0")
  assert.equal(K.catalogo.hash, CATALOGO_FIJADO.hash)
  assert.equal(CATALOGO_FIJADO.anterior.version, "2.3.0")
  assert.equal(CATALOGO_FIJADO.anterior.hash, "b20d038cc39779213f902ca313d7e4e35a40fae8a66d9f21dadeb7285b19c901")
  const datos = { version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }
  assert.equal(sha256Hex(canonicalizarCatalogo(datos)), K.catalogo.hash)
  const sinDht11 = { ...datos, componentes: COMPONENTES_CATALOGO_MINIMO.filter((c) => c.id !== "dht11") }
  assert.notEqual(sha256Hex(canonicalizarCatalogo(sinDht11)), K.catalogo.hash, "sumar el dht11 cambia el significado")
  const proyeccion = proyeccionSemanticaCatalogo(datos)
  const sinProtocolo = { ...proyeccion, protocolosDeLectura: { "bus-unico-am2302": PROTOCOLOS_DE_LECTURA["bus-unico-am2302"] } }
  assert.notEqual(sha256Hex(canonicalizar(sinProtocolo)), K.catalogo.hash, "el registro de protocolos entra al hash")
  assert.deepEqual(CATALOGO_FIJADO.componentesShippeados, [...K.catalogo.componentes.map((c) => c.id)].sort())
})

test("CAT-6 oficiales: dht11 entra como resultado DERIVADO de la admisión (todos los flags verdaderos, sin problemas)", () => {
  const informe = admitirComponente(K, "dht11")
  assert.deepEqual(informe.flags, { semantico: true, electrico: true, representacion: { wokwi: true }, acciones: null, pedagogia: true, procedencia: true })
  assert.deepEqual(informe.problemas, [])
  assert.equal(informe.officiallySupported, true)
  assert.deepEqual(oficialmenteSoportados(K), CATALOGO_FIJADO.oficiales)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Validación (Engine + readiness): sin ninguna regla nueva
// ════════════════════════════════════════════════════════════════════════════════════

test("VAL-1/2 el Engine acepta el dht11; con DATA en GPIO4, LED, resistencia y la regla > 30 °C el proyecto queda LISTO", () => {
  const p = proyecto(opsDht11("GPIO4", MAYOR_30))
  assert.deepEqual(readinessDe(p), { incompleto: false, invalido: false, listo: true })
  assert.equal(p.catalogoHash, K.catalogo.hash)
})

test("VAL-3/4 DATA en GPIO34–39 (solo entrada) deja el proyecto inválido por la dirección; GPIO12 (strapping VDD_SDIO) por el pull-up externo; sin regla nueva", () => {
  // Igual que CK-CG1 R3/R4 para el DHT22: el Engine registra el pin y la validación lo marca
  // bloqueante (representable), así que el proyecto no queda listo y el codegen no genera.
  const motivosCon = (pin) => {
    const r = proyecto(opsDht11(pin), { aceptarRechazo: true })
    return [...r.rechazos.flatMap((x) => x.motivos), ...validarProyecto(r.proyecto, K.catalogo)]
  }
  for (const pin of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
    const m = motivosCon(pin)
    assert.ok(m.some((x) => x.codigo === "CAPACIDAD_PIN_INCOMPATIBLE" && x.severidad === "blocking"), `${pin}: ${m.map((x) => x.codigo)}`)
  }
  const m12 = motivosCon("GPIO12")
  assert.ok(m12.some((x) => x.codigo === "PIN_STRAPPING_PULLUP_EXTERNO" && x.severidad === "blocking"), JSON.stringify(m12.map((x) => x.codigo)))
  assert.equal(readinessDe(proyecto(opsDht11("GPIO12"), { aceptarRechazo: true }).proyecto).listo, false)
  assert.equal(generarPrograma(proyecto(opsDht11("GPIO12", MAYOR_30), { aceptarRechazo: true }).proyecto, K).error?.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  // Los mismos resultados que el DHT22 (CK-CG1 R3/R4): el dato del terminal es el mismo.
  assert.deepEqual(
    K.pinesPermitidos("esp32-devkit-v1", "dht11", "senal").map((p) => p.id),
    K.pinesPermitidos("esp32-devkit-v1", "dht22", "senal").map((p) => p.id),
  )
})

test("VAL-5 pinesPermitidos del DATA: incluye GPIO4 como recomendado; excluye GPIO12 y GPIO34–39", () => {
  const pines = K.pinesPermitidos("esp32-devkit-v1", "dht11", "senal")
  const ids = pines.map((p) => p.id)
  assert.ok(pines.find((p) => p.id === "GPIO4")?.recomendado, "GPIO4 recomendado")
  for (const prohibido of ["GPIO12", "GPIO34", "GPIO35", "GPIO36", "GPIO39"]) assert.ok(!ids.includes(prohibido), prohibido)
})

test("VAL-7/8 umbrales contra el rango del catálogo: 30 °C y 86 °F pasan; 55 °C y 95 % de humedad dan UMBRAL_FUERA_DE_RANGO con el rango del DHT11, igual que un DHT22 fuera de su rango", () => {
  const motivosDe = (reglaDada) => {
    const r = proyecto(opsDht11("GPIO4", reglaDada), { aceptarRechazo: true })
    return r.rechazos.length > 0 ? r.rechazos.flatMap((x) => x.motivos) : validarProyecto(r.proyecto, K.catalogo)
  }
  assert.ok(!motivosDe(MAYOR_30).some((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO"))
  assert.ok(!motivosDe(regla("cmp-0", "temperatura", ">", C(86, "fahrenheit"), "cmp-1")).some((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO"))
  // La severidad es la que ya tiene el motivo en el núcleo (no se redefine acá): la misma que recibe
  // un DHT22 con 200 °C. Lo que este test fija es que el rango comparado es el del DHT11.
  const dht22 = validarProyecto(
    proyecto([["SetPlaca", { placa: "esp32-devkit-v1" }], ["AgregarComponente", { tipo: "dht22" }], ["AgregarComponente", { tipo: "led" }], ["AgregarComponente", { tipo: "resistencia" }],
      ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }], ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
      ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }], regla("cmp-0", "temperatura", ">", C(200), "cmp-1")], { aceptarRechazo: true }).proyecto,
    K.catalogo,
  ).find((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO")
  assert.ok(dht22, "referencia: el DHT22 con 200 °C sí da el motivo")
  for (const [capacidad, umbral, rango] of [["temperatura", C(55), [0, 50]], ["humedad", C(95, "porcentaje", "humedad"), [20, 90]]]) {
    const m = motivosDe(regla("cmp-0", capacidad, ">", umbral, "cmp-1")).find((x) => x.codigo === "UMBRAL_FUERA_DE_RANGO")
    assert.ok(m, capacidad)
    assert.equal(m.severidad, dht22.severidad)
    assert.deepEqual([m.datos.rango.min.valor, m.datos.rango.max.valor], rango)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Generabilidad: DISPONIBLE y ADMITIDO, NO GENERABLE (L4). Sin backend, sin excepciones.
// ════════════════════════════════════════════════════════════════════════════════════

test("GEN-1 admisión por placa: esp32-devkit-v1 sí; arduino-uno no (sin revisión del par), igual que el resto", () => {
  assert.equal(compatibilidadRevisada("dht11", "esp32-devkit-v1"), true)
  assert.equal(compatibilidadRevisada("dht11", "arduino-uno"), false)
  const g = generabilidad(K).componentes.find((c) => c.tipo === "dht11")
  assert.ok(g)
  assert.deepEqual(g.porPlaca.find((p) => p.placa === "esp32-devkit-v1"), { placa: "esp32-devkit-v1", admitido: true, problemas: [] })
  const uno = g.porPlaca.find((p) => p.placa === "arduino-uno")
  assert.equal(uno.admitido, false)
  assert.ok(uno.problemas.some((p) => p.includes("sin revisión eléctrica humana para la placa")))
})

test("GEN-2 sin backend: cada capacidad informa CODEGEN_PROTOCOLO_SIN_BACKEND con datos estructurados y generableEn vacío (ninguna falsa promesa)", () => {
  assert.ok(!Object.hasOwn(BACKENDS_DE_PROTOCOLO, "bus-unico-dht11"), "CK-CG2 no registra ningún backend: eso es S2b")
  const g = generabilidad(K).componentes.find((c) => c.tipo === "dht11")
  assert.deepEqual(g.generableEn, [])
  for (const capacidad of ["temperatura", "humedad"]) {
    const c = g.capacidades.find((x) => x.capacidad === capacidad)
    assert.deepEqual(c.lectura, { soportada: false, codigo: "CODEGEN_PROTOCOLO_SIN_BACKEND", datos: { tipo: "dht11", capacidad, protocolo: "bus-unico-dht11" }, mecanismo: null, protocolo: null })
    assert.deepEqual(c.generableEn, [])
  }
})

test("GEN-3 generarPrograma de un proyecto dht11 LISTO falla cerrado con CODEGEN_PROTOCOLO_SIN_BACKEND y sin archivos", () => {
  const p = proyecto(opsDht11("GPIO4", MAYOR_30))
  assert.equal(readinessDe(p).listo, true)
  const r = generarPrograma(p, K)
  assert.equal(r.ok, false)
  assert.equal(r.error.codigo, "CODEGEN_PROTOCOLO_SIN_BACKEND")
  assert.deepEqual(r.error.datos, { comportamiento: "beh-4", componente: "cmp-0", tipo: "dht11", capacidad: "temperatura", protocolo: "bus-unico-dht11" })
  assert.ok(!("archivos" in r))
})

test("GEN-3b sin la revisión humana del par, el dht11 cae antes, en NO_ADMITIDO (la autoridad eléctrica no se saltea)", () => {
  const sinDht11 = { placas: REVISIONES_DEL_ANEXO.placas, componentes: REVISIONES_DEL_ANEXO.componentes.filter((r) => r.tipo !== "dht11") }
  const r = generarPrograma(proyecto(opsDht11("GPIO4", MAYOR_30)), K, { revisiones: sinDht11 })
  assert.equal(r.ok, false)
  assert.equal(r.error.codigo, "CODEGEN_NO_ADMITIDO")
  assert.ok(r.error.datos.noAdmitidos.some((x) => x.id === "dht11"))
})

test("GEN-6 la proyección para el agente (proyecto-fisico leer) lista el dht11 en condicionesNumericas.catalogo[] con sus capacidades disponibles", async () => {
  const { nuevoDir, nuevoIdProyecto } = await import("./phase2-helpers.mjs")
  const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
  const ctx = { directory: nuevoDir("ck-cg2-leer") }
  const r = JSON.parse(await proyectoFisico.execute({ accion: "leer", idProyecto: nuevoIdProyecto("ck-cg2") }, ctx))
  const entrada = r.condicionesNumericas.catalogo.find((t) => t.tipo === "dht11")
  assert.ok(entrada, JSON.stringify(r.condicionesNumericas.catalogo.map((t) => t.tipo)))
  assert.equal(entrada.nombre, "DHT11 (módulo Gravity)")
  assert.deepEqual(entrada.capacidades.map((c) => [c.capacidad, c.etiqueta, c.disponible]), [["temperatura", "temperatura", true], ["humedad", "humedad relativa", true]])
  const g = r.generabilidad.componentes.find((c) => c.tipo === "dht11")
  assert.deepEqual(g.generableEn, [])
  assert.equal(g.capacidades[0].lectura.codigo, "CODEGEN_PROTOCOLO_SIN_BACKEND")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Revisión eléctrica: el texto aprobado, literal, y la observación del revisor resuelta a la vista
// ════════════════════════════════════════════════════════════════════════════════════

test("REV-1 el registro persistido es el texto aprobado por el humano el 2026-10-12, con sus fuentes y sin afirmaciones no demostradas", () => {
  const registros = REVISIONES_DE_COMPONENTE.filter((r) => r.tipo === "dht11")
  assert.equal(registros.length, 1)
  const [r] = registros
  assert.equal(r.placa, "esp32-devkit-v1")
  assert.equal(r.revisadoPor, "revisión humana de Alejandro Palestrini (CK-CG2, DHT11 DFRobot Gravity DFR0067 en ESP32 DevKit V1, 2026-10-12)")
  for (const fragmento of [
    "módulo DFRobot Gravity DHT11 (SKU DFR0067, placa V2)",
    "VCC al 3V3 del ESP32, nunca a VIN/5 V",
    "contradicción documental resuelta a favor de 3,3 V",
    "pin 1 DATA, pin 2 VCC, pin 3 GND",
    "nunca por el color del cable",
    "al menos 18 ms (máximo 30 ms)",
    "GPIO34–39 no son válidos; GPIO12 (MTDI) no es válido para DATA",
    "GPIO4 es I/O y no es pin de strapping",
    "Rango declarado: 0–50 °C ±2 °C y 20–90 %RH ±5 %RH, resolución 1 °C / 1 %RH",
    "1b7391fafd7fee7170be4c574dc609d7353f064043f2ea27cdbdf41d172f56fe",
    "43010677fa259acd63b82464f6552db8616bb04ce19a186f321863451925afa7",
    "a7917e6b47528c9dcab06837a49d452e582751335797db879f1cf2d17cd29adf",
  ]) assert.ok(r.evidencia.includes(fragmento), fragmento)
  for (const prohibido of [/4 patas/, /DHT22\/AM2302 representado/, /sin pull-up|no trae pull-up/i, /5 V al módulo/]) assert.doesNotMatch(r.evidencia, prohibido, String(prohibido))
})

test("REV-2 observación del revisor («> 2 s»): el texto aprobado dice 2 s y NO se alteró; Component Knowledge declara 3 s y el addendum lo dice", () => {
  const [r] = REVISIONES_DE_COMPONENTE.filter((x) => x.tipo === "dht11")
  assert.ok(r.evidencia.includes("intervalo mínimo entre lecturas: 2 s"), "el texto aprobado se conserva literal")
  assert.ok(r.evidencia.includes("Addendum CK-CG2"), "la resolución es explícita, no silenciosa")
  assert.ok(r.evidencia.includes("periodoMinimo = 3 s"))
  const lectura = K.lecturaDeCapacidad("dht11", "temperatura")
  assert.deepEqual(lectura.periodoMinimo, { valor: 3, unidad: "segundo", magnitud: "tiempo" })
  assert.ok(lectura.periodoMinimo.valor > 2, "estrictamente mayor que 2 s, como pide el manual")
  assert.deepEqual(lectura.esperaTrasEncendido, { valor: 1, unidad: "segundo", magnitud: "tiempo" })
  assert.deepEqual(K.lecturaDeCapacidad("dht11", "humedad"), lectura, "las dos capacidades comparten la misma lectura")
  assert.equal(K.lecturaDeCapacidad("dht22", "temperatura").periodoMinimo.valor, 2, "el DHT22 no cambia")
})

test("REV-3 deudas registradas en el código: DHT-PULLUP-02 y DHT11-RANGO-01; CK-CG2 no toca admision.ts, codegen/ ni la IR", () => {
  const datos = leer("opencode/nucleo/catalogo-datos.ts")
  assert.match(datos, /DHT-PULLUP-02/)
  assert.match(datos, /DHT11-RANGO-01/)
  const anexo = leer("opencode/conocimiento/anexos/revision-electrica.ts")
  for (const deuda of ["DHT-PULLUP-02", "DHT11-RANGO-01"]) assert.match(anexo, new RegExp(deuda))
  for (const archivo of ["opencode/codegen/protocolos.ts", "opencode/codegen/programa.ts", "opencode/codegen/generabilidad.ts", "opencode/conocimiento/admision.ts", "opencode/nucleo/ir.ts", "opencode/nucleo/operaciones.ts", "opencode/nucleo/validar-tecnico.ts"]) {
    assert.doesNotMatch(leer(archivo), /dht11|DHT11/, `${archivo} nombra al DHT11`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Representación propia `pb-dht11` (L2): pinInfo real, anclas verificadas, procedencia propia
// ════════════════════════════════════════════════════════════════════════════════════

/** Corre piezas-tecnia.js con un customElements postizo y devuelve la clase de `pb-dht11`. */
function piezaPropia() {
  const registro = new Map()
  const contexto = { customElements: { get: (n) => registro.get(n), define: (n, c) => registro.set(n, c) }, HTMLElement: class {} }
  vm.createContext(contexto)
  vm.runInContext(leer("opencode/tecniabot-web/piezas-tecnia.js"), contexto, { filename: "piezas-tecnia.js" })
  return registro.get("pb-dht11")
}

test("REP-1 dht11 → pb-dht11 (pieza propia, no wokwi-dht22); anclas vcc/senal/gnd = VCC/DATA/GND, todas verificadas en el golden", () => {
  assert.equal(ELEMENTO_WOKWI_POR_TIPO.dht11, "pb-dht11")
  assert.notEqual(ELEMENTO_WOKWI_POR_TIPO.dht11, ELEMENTO_WOKWI_POR_TIPO.dht22, "decisión de producto: no se dibuja un DHT22 rotulado DHT11")
  assert.deepEqual(TERMINAL_WOKWI_POR_TIPO.dht11, { vcc: "VCC", senal: "DATA", gnd: "GND" })
  assert.deepEqual(PINES_VERIFICADOS_WOKWI["pb-dht11"], ["DATA", "VCC", "GND"])
  const rep = K.representacionWokwi("componente", "dht11")
  assert.deepEqual(rep, { elemento: "pb-dht11", terminales: { vcc: "VCC", senal: "DATA", gnd: "GND" }, atributos: {}, assetId: "tecnia-piezas-propias" })
})

test("REP-2 el pinInfo del archivo coincide con el golden (mismos nombres, mismo orden) y cada pin cae sobre el conector dibujado", () => {
  const Pieza = piezaPropia()
  assert.ok(Pieza, "piezas-tecnia.js no define pb-dht11")
  const el = new Pieza()
  el.style = {}
  el.connectedCallback()
  assert.deepEqual(Array.from(el.pinInfo, (p) => p.name), PINES_VERIFICADOS_WOKWI["pb-dht11"])
  const svg = el.innerHTML
  assert.match(svg, /<svg width="90" height="120" viewBox="0 0 90 120"/, "SVG 1:1: pinInfo en píxeles desde el borde")
  for (const p of el.pinInfo) {
    const circulo = new RegExp(`<circle cx="${p.x}" cy="${p.y}" r="3"`)
    assert.match(svg, circulo, `el pin ${p.name} (${p.x},${p.y}) no es el centro de un borne dibujado`)
  }
  assert.ok(el.pinInfo.find((p) => p.name === "VCC").signals.some((s) => s.type === "power" && s.signal === "VCC"))
  assert.ok(el.pinInfo.find((p) => p.name === "GND").signals.some((s) => s.type === "power" && s.signal === "GND"))
  assert.match(svg, /DHT11/, "la pieza se rotula DHT11")
  assert.doesNotMatch(svg, /DHT22/)
})

test("REP-3 el pinInfo que leyó Chromium real queda fijado acá y coincide con el archivo (evidencia del track, 2026-10-12)", () => {
  // Leído con `chromium --headless=new --dump-dom` contra una página que carga piezas-tecnia.js y
  // vuelca `el.pinInfo` (component-knowledge-ck-cg2-dht11/renderer/pininfo-chromium.json). Si el
  // dibujo cambia, este literal tiene que volver a leerse en el navegador, no editarse a mano.
  const leidoEnChromium = [
    { name: "DATA", x: 27, y: 95, signals: [] },
    { name: "VCC", x: 45, y: 95, signals: [{ type: "power", signal: "VCC" }] },
    { name: "GND", x: 63, y: 95, signals: [{ type: "power", signal: "GND" }] },
  ]
  const el = new (piezaPropia())()
  assert.deepEqual(JSON.parse(JSON.stringify(el.pinInfo)), leidoEnChromium)
})

test("REP-4 procedencia propia: registro completo con el sha256 REAL del archivo, revisor humano; el bundle sigue respaldando a las wokwi-*", () => {
  assert.deepEqual(ASSET_POR_ELEMENTO, { "pb-dht11": "tecnia-piezas-propias" })
  assert.equal(assetDeRepresentacionWokwi("pb-dht11"), "tecnia-piezas-propias")
  assert.equal(assetDeRepresentacionWokwi("wokwi-dht22"), "wokwi-elements-bundle")
  assert.equal(assetDeRepresentacionWokwi(), "wokwi-elements-bundle")
  const registro = procedenciaDe("tecnia-piezas-propias")
  assert.ok(registro)
  assert.equal(registro.kind, "svg")
  assert.equal(registro.fuente.sha256, sha256Hex(leer("opencode/tecniabot-web/piezas-tecnia.js")), "el sha256 registrado es el del archivo commiteado")
  assert.equal(registro.licencia.spdx, "GPL-3.0-or-later")
  assert.match(registro.revisadoPor, /revisión humana de Alejandro Palestrini/)
  assert.equal(K.representacionWokwi("componente", "dht22").assetId, "wokwi-elements-bundle")
  assert.equal(K.representacionWokwi("placa", "esp32-devkit-v1").assetId, "wokwi-elements-bundle")
})

test("REP-5 la vista física carga el script y el servidor lo sirve: index.html referencia /assets/piezas-tecnia.js y la lista blanca lo mapea al archivo", () => {
  assert.match(leer("opencode/vista-fisica/web/index.html"), /<script src="\/assets\/piezas-tecnia\.js"><\/script>/)
  assert.match(leer("opencode/servidor/servidor-proyecto.ts"), /\["piezas-tecnia\.js", join\(DIR_TECNIABOT_WEB, "piezas-tecnia\.js"\)\]/)
  // El renderer no cambia: consume `elementoWokwi` y `pinInfo` de forma genérica.
  for (const archivo of ["opencode/vista-fisica/web/plan-de-pintado.js", "opencode/vista-fisica/web/pintar.js", "opencode/vista-fisica/web/cableado.js", "opencode/vista-fisica/snapshot-a-vista.ts"]) {
    assert.doesNotMatch(leer(archivo), /pb-dht11|dht11/, `${archivo} nombra a la pieza`)
  }
})

test("REP-6 la vista proyecta el dht11 con su elemento propio y sin aviso de «todavía no tiene dibujo»", async () => {
  const { nuevoDir, nuevoIdProyecto } = await import("./phase2-helpers.mjs")
  const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
  const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("ck-cg2-vista"), idProyecto: nuevoIdProyecto("ck-cg2-vista") })
  try {
    for (const [tipo, payload] of opsDht11("GPIO4", MAYOR_30)) {
      const r = servicio.aplicar({ idOperacion: `v-${tipo}-${Math.random()}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
      assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    }
    const vista = servicio.snapshot().vista
    const pieza = vista.componentes.find((c) => c.tipo === "dht11")
    assert.equal(pieza.elementoWokwi, "pb-dht11")
    assert.equal(pieza.nombre, "DHT11 (módulo Gravity)")
    const plan = planDePintado(vista)
    assert.ok(plan.some((i) => i.tipo === "crearElemento" && i.tag === "pb-dht11"))
    assert.ok(!plan.some((i) => i.tipo === "piezaSinRepresentacion" && i.entidad.id === pieza.id))
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Regresión DHT22 (L5): mismo programa salvo la cabecera con el hash del catálogo
// ════════════════════════════════════════════════════════════════════════════════════

test("REG-3 la IR de HARDWARE E2E #1 (DHT22) genera el MISMO main.cpp salvo la línea de cabecera, y el mismo platformio.ini", () => {
  // Mismas operaciones, en el mismo orden, que la IR rev3 del experimento (cmp-0 led, cmp-1 dht22,
  // cmp-2 resistencia, conn-3, beh-4). Golden: sha256 de digital/main.cpp del experimento sin su
  // línea `// proyecto: …` (8c7fd0f8…) y de su platformio.ini entero (b4ea2df4…), tomados en 6b560d7.
  const p = proyecto([
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "dht22" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" }],
    ["AsignarPin", { componente: "cmp-1", terminal: "senal", pin: "GPIO4" }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } }],
    regla("cmp-1", "temperatura", ">", C(30), "cmp-0"),
  ])
  const r = generarPrograma(p, K)
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null))
  const cabecera = r.archivos["src/main.cpp"].split("\n").find((l) => l.startsWith("// proyecto: "))
  assert.match(cabecera, new RegExp(`catalogo: ${K.catalogo.hash}`), "la cabecera lleva el hash del catálogo (único cambio esperado)")
  const cuerpo = r.archivos["src/main.cpp"].split("\n").filter((l) => !l.startsWith("// proyecto: ")).join("\n")
  assert.equal(sha256Hex(cuerpo), "8c7fd0f86b153d1b26a876540820b74456ac477620f9ed75c3f22e729c0aba1d")
  assert.equal(sha256Hex(r.archivos["platformio.ini"]), "b4ea2df4fc2401ec488b0254ff714176119e561447817a99631de64da7321fde")
})

test("REG-4 el NTC sigue igual: sin lectura ejecutable, no admitido, no generable; el DHT22 sigue generable sólo en ESP32", () => {
  const g = generabilidad(K)
  const ntc = g.componentes.find((c) => c.tipo === "ntc")
  assert.deepEqual(ntc.generableEn, [])
  assert.equal(ntc.capacidades[0].lectura.codigo, "CODEGEN_SIN_LECTURA")
  const dht22 = g.componentes.find((c) => c.tipo === "dht22")
  assert.deepEqual(dht22.generableEn, ["esp32-devkit-v1"])
  for (const c of dht22.capacidades) assert.equal(c.lectura.protocolo, "bus-unico-am2302")
})

test("REG-7 un proyecto creado con 2.3.0 (identidad anterior) recarga, conserva createdWith y ve CATALOGO_CAMBIO_DETECTADO como info", async () => {
  const { nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto } = await import("./phase2-helpers.mjs")
  const { writeFileSync } = await import("node:fs")
  const directorio = nuevoDir("ck-cg2-anterior")
  const idProyecto = nuevoIdProyecto("ck-cg2-anterior")
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  for (const [tipo, payload] of [["SetPlaca", { placa: "esp32-devkit-v1" }], ["AgregarComponente", { tipo: "dht22" }]]) {
    assert.equal(servicio.aplicar({ idOperacion: `a-${tipo}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload }).ok, true)
  }
  servicio.cerrar()
  const ruta = join(directorio, `${idProyecto}.json`)
  writeFileSync(ruta, JSON.stringify({ ...JSON.parse(readFileSync(ruta, "utf8")), catalogoVersion: "2.3.0", catalogoHash: CATALOGO_FIJADO.anterior.hash }))
  const recargado = obtenerServicioDeProyecto({ directorio, idProyecto })
  try {
    const s = recargado.snapshot()
    assert.equal(s.catalogoHash, CATALOGO_FIJADO.anterior.hash)
    const aviso = s.validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.equal(aviso?.severidad, "info")
    assert.equal(recargado.aplicar({ idOperacion: "a-dht11", actor: "agente", baseRevision: s.revision, tipo: "AgregarComponente", payload: { tipo: "dht11" } }).ok, true, "un proyecto viejo puede sumar la pieza nueva")
    assert.equal(recargado.snapshot().catalogoHash, CATALOGO_FIJADO.anterior.hash, "createdWith no se reescribe")
  } finally {
    recargado.cerrar()
  }
})
