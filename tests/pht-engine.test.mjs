// Phase 3 — Pre-Human-Test Hardening, HD-W0-A (docs/programacion-intencion/
// PHASE_3_PRE_HUMAN_TEST_DESIGN.md §1): un terminal que el catálogo declara
// `electrica: "riel-fijo"` rechaza `AsignarPin`, siempre — la fuente de "asignable"
// es EXCLUSIVAMENTE el catálogo, nunca el tipo/id del componente.
//
// Archivo NUEVO (no `tests/nucleo-*`, por indicación explícita del diseño §1 fila
// "Archivos esperados" y §5: "los tests nuevos van en un archivo nuevo"). Casos
// A1-A10, ver §1 fila "RED" del diseño — mismas convenciones de fixtures que
// `tests/nucleo-operaciones.test.mjs`/`tests/nucleo-motor.test.mjs`/
// `tests/nucleo-persistible-recargable.test.mjs` (únicos imports de estos módulos
// del núcleo, ningún atajo propio).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { validarProyecto } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { construirCatalogoMinimoReal, sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

const catalogo = construirCatalogoMinimoReal()

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures compartidas
// ════════════════════════════════════════════════════════════════════════════════════

let contadorOp = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `pht-op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload }
}

function proyectoBase() {
  return crearProyecto({ generadorId: () => "pht-proy-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
}

/** Proyecto con placa + un LED en "cmp-0" (ánodo sin pin), listo para AsignarPin. */
function proyectoConLed() {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const r = ejecutarOperacion(p, op("AgregarComponente", { tipo: "led" }, p.revision), catalogo)
  assert.equal(r.ok, true, `fixture: AgregarComponente(led) rechazado: ${JSON.stringify(r.motivos)}`)
  return r.proyecto
}

function crearAlmacenFalso() {
  const store = new Map()
  const llamadasGuardar = []
  return {
    llamadasGuardar,
    guardar(proyecto) {
      llamadasGuardar.push(proyecto.id)
      store.set(proyecto.id, proyecto)
      return { ok: true }
    },
    cargar(id) {
      return store.has(id) ? { ok: true, proyecto: store.get(id) } : { ok: false, motivos: [{ codigo: "PROYECTO_INEXISTENTE", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo" }] }
    },
    existe(id) {
      return store.has(id)
    },
  }
}

function crearMotorDePrueba() {
  const proyectoInicial = crearProyecto({ generadorId: () => "pht-motor-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
  return { motor, almacen }
}

// ════════════════════════════════════════════════════════════════════════════════════
// A1 — asignable intacto (no regresión)
// ════════════════════════════════════════════════════════════════════════════════════

test("A1: terminal asignable (ánodo del LED, electrica:digital) sigue aceptando AsignarPin", () => {
  const p = proyectoConLed()
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, true, `no debería rechazar un terminal asignable: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.proyecto.componentes[0].pines.anodo, "GPIO23")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A2 — no-asignable rechazado
// ════════════════════════════════════════════════════════════════════════════════════

test("A2: AsignarPin sobre terminal riel-fijo (cátodo del LED) rechaza con TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoConLed()
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, false, `terminal riel-fijo tiene que rechazar: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

test("A2(b): el rechazo aplica SIN excepción cuando pin es null (limpieza sobre terminal no-asignable)", () => {
  const p = proyectoConLed()
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: null }, p.revision), catalogo)
  assert.equal(r.ok, false, `terminal riel-fijo rechaza incluso con pin:null: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A3 — IR sin cambios (misma referencia)
// ════════════════════════════════════════════════════════════════════════════════════

test("A3: el rechazo no muta el proyecto — el Proyecto devuelto es la MISMA referencia de entrada", () => {
  const p = proyectoConLed()
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.proyecto, p, "el proyecto devuelto en el rechazo tiene que ser la MISMA referencia")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A4 — revisión sin cambios (vía motor)
// ════════════════════════════════════════════════════════════════════════════════════

test("A4: AsignarPin sobre terminal no-asignable no sube la revision (vía motor)", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  const antes = motor.getProyecto().revision
  const r = motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, antes))
  assert.equal(r.ok, false, `tiene que rechazar: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, antes)
  assert.equal(motor.getProyecto().revision, antes, "la revision del canónico no puede subir tras un rechazo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A5 — motivo estructurado (forma exacta)
// ════════════════════════════════════════════════════════════════════════════════════

test("A5: TERMINAL_NO_ASIGNABLE trae motivo estructurado completo", () => {
  const p = proyectoConLed()
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  const m = r.motivos.find((x) => x.codigo === "TERMINAL_NO_ASIGNABLE")
  assert.ok(m, `falta el motivo TERMINAL_NO_ASIGNABLE: ${JSON.stringify(r.motivos)}`)
  assert.equal(m.categoria, "operacion")
  assert.equal(m.severidad, "blocking")
  assert.equal(m.clasificacion, "rechazo")
  assert.deepEqual(m.datos, { componente: "cmp-0", terminal: "catodo", electrica: "riel-fijo" })
})

// ════════════════════════════════════════════════════════════════════════════════════
// A6 — dry-run (proponer) y aplicar coinciden
// ════════════════════════════════════════════════════════════════════════════════════

test("A6: proponer() y aplicar() coinciden en rechazar AsignarPin sobre terminal no-asignable", () => {
  const { motor: m1 } = crearMotorDePrueba()
  const { motor: m2 } = crearMotorDePrueba()
  for (const m of [m1, m2]) {
    m.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
    m.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  }
  const rProponer = m1.proponer([op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, 2)])
  const rAplicar = m2.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, 2))
  assert.equal(rProponer.ok, false, `proponer() tiene que rechazar: ${JSON.stringify(rProponer.motivos)}`)
  assert.equal(rAplicar.ok, false, `aplicar() tiene que rechazar: ${JSON.stringify(rAplicar.motivos)}`)
  assert.equal(rProponer.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
  assert.equal(rAplicar.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A7 — transacción con una op inválida → rollback atómico
// ════════════════════════════════════════════════════════════════════════════════════

test("A7: AsignarPin sobre terminal no-asignable dentro de un lote aborta el LOTE COMPLETO (atomic)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  const antes = motor.getProyecto()
  const llamadasAntes = almacen.llamadasGuardar.length
  const r = motor.aplicarTransaccion([
    op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2), // válida
    op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO5" }, 2), // no-asignable
  ])
  assert.equal(r.ok, false, `el lote tiene que rechazar completo: ${JSON.stringify(r.motivos)}`)
  assert.equal(motor.getProyecto(), antes, "nada del lote quedó aplicado, ni siquiera la 1ra op válida")
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes, "un lote rechazado nunca persiste")
})

// ════════════════════════════════════════════════════════════════════════════════════
// A8 — persistencia/carga válida no se rompe (regresión)
// ════════════════════════════════════════════════════════════════════════════════════

test("A8: guardar y recargar un proyecto válido (sin pines riel-fijo) sigue viajando igual", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  const r = motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2))
  assert.equal(r.ok, true, `fixture: no debería rechazar el pin válido: ${JSON.stringify(r.motivos)}`)
  assert.equal(motor.getProyecto().componentes[0].pines.anodo, "GPIO23")
  const motivos = validarProyecto(motor.getProyecto(), catalogo)
  assert.equal(
    motivos.some((m) => m.codigo === "TERMINAL_NO_ASIGNABLE"),
    false,
    "un proyecto válido nunca dispara este motivo en la validación continua",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// A9 — fixture histórico: documentar la carga, no migrar
// ════════════════════════════════════════════════════════════════════════════════════

test("A9: documento histórico con pin en terminal riel-fijo (resistencia) sigue cargando igual (no se migra)", () => {
  const base = crearProyecto({ generadorId: () => "pht-historico", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const proyectoHistorico = {
    ...base,
    placa: "esp32-devkit-v1",
    siguienteIdLocal: 1,
    componentes: [{ id: "cmp-0", tipo: "resistencia", pines: { a: "GPIO18" }, propiedades: {} }],
  }
  const almacen = crearAlmacenFalso()
  // No debe lanzar ErrorEstadoInicialInvalido: un documento histórico con este dato
  // (de antes de HD-W0-A) sigue siendo un estado inicial válido para el motor.
  const motor = crearMotorDeProyecto({ proyectoInicial: proyectoHistorico, catalogo, almacen })
  assert.equal(motor.getProyecto().componentes[0].pines.a, "GPIO18", "el pin histórico se preserva tal cual, sin limpiarlo")
  const motivos = validarProyecto(motor.getProyecto(), catalogo)
  assert.equal(
    motivos.some((m) => m.codigo === "TERMINAL_NO_ASIGNABLE"),
    false,
    "la validación continua no inventa un rechazo retroactivo sobre un documento ya cargado",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// A10 — el catálogo es la autoridad, nunca el id del componente
// ════════════════════════════════════════════════════════════════════════════════════

test("A10: TERMINAL_NO_ASIGNABLE despacha por catálogo (electrica), nunca por id de componente — fixture sintético", () => {
  const ZUMBADOR_SINTETICO = {
    id: "zumbador-fixture",
    nombreVisible: "Zumbador de prueba (no-producto)",
    clase: "actuador",
    terminales: [
      { id: "senal", rol: "senal", electrica: "digital", direccion: "salida" },
      { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
    ],
    capacidades: [],
    requisitos: [],
  }
  const catalogoConFixture = construirCatalogo(
    { version: VERSION_CATALOGO_MINIMO, componentes: [...COMPONENTES_CATALOGO_MINIMO, ZUMBADOR_SINTETICO], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } },
    sha256Hex,
  )
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  let r = ejecutarOperacion(p, op("AgregarComponente", { tipo: "zumbador-fixture" }, p.revision), catalogoConFixture)
  assert.equal(r.ok, true, `fixture: AgregarComponente(zumbador-fixture) rechazado: ${JSON.stringify(r.motivos)}`)
  p = r.proyecto

  r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "gnd", pin: "GPIO23" }, p.revision), catalogoConFixture)
  assert.equal(r.ok, false, `un terminal riel-fijo de un componente SINTÉTICO (nunca "resistencia") tiene que rechazar igual: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
  assert.deepEqual(r.motivos[0].datos, { componente: "cmp-0", terminal: "gnd", electrica: "riel-fijo" })

  // Y el terminal "senal" (electrica:digital) del MISMO componente sintético sigue
  // asignable — confirma que la regla mira el TERMINAL, no "banea" el componente entero.
  const r2 = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO23" }, p.revision), catalogoConFixture)
  assert.equal(r2.ok, true, `el terminal asignable del mismo componente sintético no debería rechazar: ${JSON.stringify(r2.motivos)}`)
})
