// Component System Foundation #1 — F7: suite de admisión (Decision Freeze, D-13/D-17,
// 05-COMPONENT-ADMISSION-CONTRACT.md). Determinista, sin UI, sin IA.
//
// 1. La LISTA de oficialmente soportados está fijada: entrar o salir es un cambio
//    explícito y revisado.
// 2. Cada oficialmente soportado tiene todos sus flags (y ningún problema).
// 3. dht22/ntc siguen en el catálogo pero NO están oficialmente soportados, y la razón
//    queda a la vista.
// 4. Casos dorados de validación sin IA por tipo (check 12): requisito insatisfecho,
//    pin incompatible, terminal no asignable, terminal de potencia.
// 5. Los datos fuente no declaran `asignable` (sólo derivado, D-04).
// 6. Sensibilidad: romper un dato de un anexo apaga el flag que corresponde.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { admitirCatalogo, admitirComponente, admitirPlaca, oficialmenteSoportados, REVISION_ELECTRICA } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo, asignarPin, evaluarRequisito, evaluarRestriccionesPin } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const conocimiento = CONOCIMIENTO_ACTIVO
const catalogo = conocimiento.catalogo

const OFICIALES = CATALOGO_FIJADO.oficiales

// ════════════════════════════════════════════════════════════════════════════════════
// 1-3. Lista fijada y flags
// ════════════════════════════════════════════════════════════════════════════════════

test("F7: la lista de oficialmente soportados es EXACTAMENTE ESP32 + LED + resistencia + pulsador (D-17)", () => {
  assert.deepEqual(oficialmenteSoportados(conocimiento), OFICIALES)
})

test("F7: la suite recorre TODO el catálogo (cada placa y cada tipo tiene informe)", () => {
  const ids = admitirCatalogo(conocimiento).map((i) => i.id)
  assert.deepEqual(ids, [...catalogo.placas.map((p) => p.id), ...catalogo.componentes.map((c) => c.id)])
})

for (const id of OFICIALES) {
  test(`F7: ${id} pasa todos los flags de admisión, sin problemas`, () => {
    const informe = id === "esp32-devkit-v1" ? admitirPlaca(conocimiento, id) : admitirComponente(conocimiento, id)
    assert.deepEqual(informe.problemas, [])
    assert.equal(informe.flags.semantico, true)
    assert.equal(informe.flags.electrico, true)
    assert.equal(informe.flags.representacion.wokwi, true)
    assert.equal(informe.flags.pedagogia, true)
    assert.equal(informe.flags.procedencia, true)
    assert.notEqual(informe.flags.acciones, false)
    assert.equal(informe.officiallySupported, true)
  })
}

test("F7: el LED es actuador y su flag de acciones es true (no 'no aplica')", () => {
  assert.equal(admitirComponente(conocimiento, "led").flags.acciones, true)
  assert.equal(admitirComponente(conocimiento, "pulsador").flags.acciones, null)
})

for (const id of ["dht22", "ntc"]) {
  test(`F7: ${id} sigue en el catálogo pero NO está oficialmente soportado, con la razón a la vista`, () => {
    assert.ok(catalogo.obtenerComponente(id), "no se borra del catálogo (proyectos y tests lo usan)")
    const informe = admitirComponente(conocimiento, id)
    assert.equal(informe.officiallySupported, false)
    assert.equal(informe.flags.semantico, true, "el significado sí está completo")
    assert.equal(informe.flags.representacion.wokwi, false)
    assert.equal(informe.flags.electrico, false, "sin revisión eléctrica humana")
    assert.ok(informe.problemas.some((p) => p.startsWith("representacion.wokwi")))
  })
}

test("F7: el Arduino UNO tiene representación pero no revisión eléctrica: no es oficial en Foundation #1", () => {
  const informe = admitirPlaca(conocimiento, "arduino-uno")
  assert.equal(informe.flags.representacion.wokwi, true)
  assert.equal(informe.flags.electrico, false)
  assert.equal(informe.officiallySupported, false)
})

test("F7: la revisión eléctrica humana sólo existe para el conjunto inicial", () => {
  assert.deepEqual(Object.keys(REVISION_ELECTRICA).sort(), OFICIALES)
})

test("F7: un tipo inexistente no se admite (y no tira)", () => {
  const informe = admitirComponente(conocimiento, "servo")
  assert.equal(informe.officiallySupported, false)
  assert.equal(informe.flags.semantico, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Casos dorados de validación sin IA (check 12)
// ════════════════════════════════════════════════════════════════════════════════════

let contadorOp = 0
const op = (tipo, payload, baseRevision) => ({ idOperacion: `adm-op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload })

function proyectoCon(tipo) {
  let p = crearProyecto({ generadorId: () => "adm-proy", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  p = { ...p, placa: "esp32-devkit-v1" }
  const r = ejecutarOperacion(p, op("AgregarComponente", { tipo }, p.revision), catalogo)
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  return r.proyecto
}

const pin = (id) => catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === id)
const terminal = (tipo, id) => catalogo.obtenerComponente(tipo).terminales.find((t) => t.id === id)

test("F7 dorado LED: sin resistencia en serie → REQUISITO_INSATISFECHO; con resistencia → nada", () => {
  const led = catalogo.obtenerComponente("led")
  assert.deepEqual(evaluarRequisito(led, {}).map((m) => m.codigo), ["REQUISITO_INSATISFECHO"])
  assert.deepEqual(evaluarRequisito(led, { anodo: ["resistencia"] }), [])
})

test("F7 dorado LED: el ánodo (salida) no va a GPIO34 (sólo entrada) → CAPACIDAD_PIN_INCOMPATIBLE", () => {
  assert.equal(asignarPin(terminal("led", "anodo"), pin("GPIO34"))?.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
  assert.equal(asignarPin(terminal("led", "anodo"), pin("GPIO23")), null)
})

test("F7 dorado LED: el cátodo no es asignable → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("led")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

test("F7 dorado pulsador: en GPIO34 (sin pull-up interno) → PIN_SIN_PULLUP_INTERNO bloqueante", () => {
  const motivos = evaluarRestriccionesPin(terminal("pulsador", "senal"), pin("GPIO34"))
  assert.ok(motivos.some((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO" && m.severidad === "blocking"))
})

test("F7 dorado pulsador: su gnd no es asignable → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("pulsador")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "gnd", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

test("F7 dorado resistencia: ninguna pata es asignable (es un puente) → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("resistencia")
  for (const t of ["a", "b"]) {
    const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: t, pin: "GPIO23" }, p.revision), catalogo)
    assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE", t)
  }
  assert.equal(conocimiento.resolverDestino("esp32-devkit-v1", terminal("resistencia", "a")).kind, "puente")
})

test("F7 dorado ESP32: GND es conectable pero no asignable → TERMINAL_NO_ASIGNABLE {terminalDePotencia}", () => {
  const p = proyectoCon("led")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GND" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
  assert.equal(r.motivos[0].datos.terminalDePotencia, true)
})

test("F7 dorado ESP32: un pin de flash es bloqueante (PIN_FLASH_RESERVADO) y no se ofrece", () => {
  const motivos = evaluarRestriccionesPin(terminal("led", "anodo"), pin("GPIO6"))
  assert.ok(motivos.some((m) => m.codigo === "PIN_FLASH_RESERVADO" && m.severidad === "blocking"))
  assert.ok(!conocimiento.pinesPermitidos("esp32-devkit-v1", "led", "anodo").some((p) => p.id === "GPIO6"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. `asignable` nunca es dato fuente
// ════════════════════════════════════════════════════════════════════════════════════

test("F7/D-04: ningún terminal de los datos fuente declara `asignable`; el catálogo construido sí lo trae", () => {
  for (const c of COMPONENTES_CATALOGO_MINIMO) for (const t of c.terminales) assert.equal(Object.hasOwn(t, "asignable"), false, `${c.id}.${t.id}`)
  for (const c of catalogo.componentes) for (const t of c.terminales) assert.equal(typeof t.asignable, "boolean", `${c.id}.${t.id}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. Sensibilidad de los flags
// ════════════════════════════════════════════════════════════════════════════════════

function catalogoCon(componentes) {
  return construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
}

test("F7 sensibilidad: un requisito sin evaluador apaga `electrico` (no se finge validación)", () => {
  const led = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "led")
  const ledConPull = { ...led, requisitos: [...led.requisitos, { tipo: "resistencia-pull", enTerminal: "anodo", spec: {} }] }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "led" ? ledConPull : c))))
  const informe = admitirComponente(otro, "led")
  assert.equal(informe.flags.electrico, false)
  assert.equal(informe.officiallySupported, false)
  assert.ok(informe.problemas.some((p) => p.includes("no tiene evaluador")))
})

test("F7 sensibilidad: un actuador con una acción no registrada apaga `acciones`", () => {
  const led = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "led")
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "led" ? { ...led, acciones: ["encender", "parpadear"] } : c))))
  const informe = admitirComponente(otro, "led")
  assert.equal(informe.flags.acciones, false)
  assert.equal(informe.officiallySupported, false)
})

test("F7 sensibilidad: un terminal nuevo sin ancla ni etiqueta apaga representación y pedagogía", () => {
  const pulsador = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
  const conVcc = { ...pulsador, terminales: [...pulsador.terminales, { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" }] }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? conVcc : c))))
  const informe = admitirComponente(otro, "pulsador")
  assert.equal(informe.flags.representacion.wokwi, false)
  assert.equal(informe.flags.pedagogia, false)
  assert.equal(informe.flags.electrico, true, "VLOGICA sí resuelve a un terminal de potencia")
})

test("F7 sensibilidad: un riel-fijo sin destino en un componente NO pasivo apaga `electrico`", () => {
  const pulsador = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
  const sinDestino = { ...pulsador, terminales: pulsador.terminales.map((t) => (t.id === "gnd" ? { id: "gnd", rol: "tierra", electrica: "riel-fijo" } : t)) }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? sinDestino : c))))
  assert.equal(admitirComponente(otro, "pulsador").flags.electrico, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7. Component Knowledge F2a — invariantes generativos (S2), snapshot de admisión (S9) y
//    admisión sin datos de piezas (`component-knowledge/18_F2A_SCOPE.md` §2, §6).
// ════════════════════════════════════════════════════════════════════════════════════

const { readFileSync } = await import("node:fs")
const { UNIDADES, MAGNITUDES, ROLES_DE_TERMINAL, ELECTRICAS, DIRECCIONES, CLASES, unidadesDeMagnitud } = await import(join(REPO, "opencode/nucleo/registros/vocabulario.ts"))
const { DEFINICIONES_ACCION } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { REVISIONES_DE_COMPONENTE, REVISIONES_DE_PLACA } = await import(join(REPO, "opencode/conocimiento/anexos/revision-electrica.ts"))
const { PINES_VERIFICADOS_WOKWI } = await import(join(REPO, "opencode/conocimiento/anexos/golden-wokwi.ts"))
const { compatibilidadRevisada } = await import(join(REPO, "opencode/conocimiento/admision.ts"))

const unicos = (xs) => new Set(xs).size === xs.length
const esCantidadDe = (c, magnitud, unidad) => typeof c?.valor === "number" && Number.isFinite(c.valor) && c.magnitud === magnitud && c.unidad === unidad

test("F2a/S2: los registros son coherentes entre sí y están congelados", () => {
  for (const [m, def] of Object.entries(MAGNITUDES)) for (const u of def.unidades) assert.ok(Object.hasOwn(UNIDADES, u), `${m} usa la unidad no registrada ${u}`)
  for (const [u, def] of Object.entries(UNIDADES)) assert.equal(typeof def.ucum, "string", u)
  for (const r of [UNIDADES, MAGNITUDES, ROLES_DE_TERMINAL, ELECTRICAS, DIRECCIONES, CLASES]) assert.ok(Object.isFrozen(r))
  assert.deepEqual(unidadesDeMagnitud("no-existe"), [])
  assert.deepEqual(unidadesDeMagnitud("toString"), [], "sólo claves propias del registro")
})

test("F2a/S2: todo componente del catálogo usa sólo vocabulario registrado y referencias que resuelven", () => {
  const acciones = new Set(DEFINICIONES_ACCION.map((d) => d.id))
  assert.ok(unicos(catalogo.componentes.map((c) => c.id)), "ids de componente únicos")
  for (const c of catalogo.componentes) {
    assert.ok(CLASES.includes(c.clase), `${c.id}: clase`)
    assert.ok(unicos(c.terminales.map((t) => t.id)), `${c.id}: terminales únicos`)
    for (const t of c.terminales) {
      assert.ok(ROLES_DE_TERMINAL.includes(t.rol), `${c.id}.${t.id}: rol`)
      assert.ok(ELECTRICAS.includes(t.electrica), `${c.id}.${t.id}: eléctrica`)
      if (t.direccion !== undefined) assert.ok(DIRECCIONES.includes(t.direccion), `${c.id}.${t.id}: dirección`)
    }
    assert.ok(unicos(c.capacidades.map((k) => k.id)), `${c.id}: capacidades únicas`)
    for (const k of c.capacidades) {
      if (k.magnitud === undefined) continue
      assert.ok(unidadesDeMagnitud(k.magnitud).includes(k.unidad), `${c.id}.${k.id}: unidad de su magnitud`)
      if (k.rango) {
        assert.ok(esCantidadDe(k.rango.min, k.magnitud, k.unidad) && esCantidadDe(k.rango.max, k.magnitud, k.unidad), `${c.id}.${k.id}: rango en la unidad de la capacidad`)
        assert.ok(k.rango.min.valor <= k.rango.max.valor, `${c.id}.${k.id}: min ≤ max`)
      }
    }
    for (const r of c.requisitos) {
      if (r.enTerminal !== undefined) assert.ok(c.terminales.some((t) => t.id === r.enTerminal), `${c.id}: requisito ${r.tipo} apunta a un terminal real`)
      if (r.spec.valor !== undefined) assert.ok(unidadesDeMagnitud(r.spec.valor.magnitud).includes(r.spec.valor.unidad), `${c.id}: valor del requisito ${r.tipo}`)
    }
    for (const a of c.acciones ?? []) assert.ok(acciones.has(a), `${c.id}: acción ${a} registrada`)
    for (const p of c.compatibilidades?.placas ?? []) assert.ok(catalogo.tienePlaca(p), `${c.id}: placa compatible ${p}`)
  }
  for (const conv of catalogo.unidades?.conversiones ?? []) {
    assert.ok(unidadesDeMagnitud(conv.magnitud).includes(conv.de) && unidadesDeMagnitud(conv.magnitud).includes(conv.a), `conversión ${conv.de}→${conv.a}`)
  }
  for (const placa of catalogo.placas) {
    assert.ok(unicos(placa.pines.map((p) => p.id)), `${placa.id}: pines únicos`)
    for (const t of placa.terminalesDePotencia) if (t.tension !== undefined) assert.ok(esCantidadDe(t.tension, "tension", "volt"), `${placa.id}.${t.id}: tensión`)
  }
})

test("F2a/S2: cobertura cruzada de los anexos de admisión (revisión eléctrica y golden Wokwi)", () => {
  for (const r of REVISIONES_DE_COMPONENTE) {
    assert.ok(catalogo.obtenerComponente(r.tipo), `revisión de un tipo inexistente: ${r.tipo}`)
    assert.ok(catalogo.tienePlaca(r.placa), `revisión para una placa inexistente: ${r.placa}`)
    assert.ok(r.revisadoPor.length > 0 && r.revisadoPor !== "auto", `${r.tipo}: revisión humana`)
  }
  for (const r of REVISIONES_DE_PLACA) assert.ok(catalogo.tienePlaca(r.placa), `revisión de una placa inexistente: ${r.placa}`)
  assert.ok(unicos(REVISIONES_DE_COMPONENTE.map((r) => `${r.tipo}@${r.placa}`)), "una revisión por par")
  const elementosUsados = new Set([
    ...catalogo.componentes.map((c) => conocimiento.representacionWokwi("componente", c.id)?.elemento),
    ...catalogo.placas.map((p) => conocimiento.representacionWokwi("placa", p.id)?.elemento),
  ])
  for (const elemento of Object.keys(PINES_VERIFICADOS_WOKWI)) assert.ok(elementosUsados.has(elemento), `golden de un elemento que nadie usa: ${elemento}`)
})

test("F2a/CK-04: la revisión eléctrica es por par (componente, placa)", () => {
  assert.equal(compatibilidadRevisada("led", "esp32-devkit-v1"), true)
  assert.equal(compatibilidadRevisada("led", "arduino-uno"), false, "el UNO no tiene revisión eléctrica todavía")
  assert.equal(compatibilidadRevisada("dht22", "esp32-devkit-v1"), false)
})

test("F2a/S9: admitirCatalogo es IDÉNTICO al snapshot fijado antes de F2a", () => {
  const snapshot = JSON.parse(readFileSync(join(REPO, "tests/fixtures/admision-snapshot.json"), "utf8"))
  assert.deepEqual(JSON.parse(JSON.stringify(admitirCatalogo(conocimiento))), snapshot)
})

test("F2a (estático): conocimiento/admision.ts no contiene ningún id de componente ni de placa", () => {
  const ids = new Set([...catalogo.componentes.map((c) => c.id), ...catalogo.placas.map((p) => p.id)])
  const fuente = readFileSync(join(REPO, "opencode/conocimiento/admision.ts"), "utf8")
  const encontrados = [...new Set(fuente.split(/[^a-z0-9-]+/).filter((token) => ids.has(token)))]
  assert.deepEqual(encontrados, [])
})
