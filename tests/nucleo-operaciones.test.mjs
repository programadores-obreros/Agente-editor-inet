// Gate 5 — operaciones + resultados estructurados.
//
// Ver docs/programacion-intencion/OPERATIONS.md para el contrato completo (escrito
// ANTES de este código). Las operaciones son funciones PURAS: nunca mutan el
// `Proyecto` de entrada, siempre devuelven uno nuevo reusando por REFERENCIA lo que
// no tocaron — eso es lo que hace verificable el invariante de vista (§5 del
// contrato).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { aplicarOperacion, ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

const catalogo = construirCatalogoMinimoReal()

// Catálogo de prueba con un componente sintético (sensor-temp-f, sólo para las ramas
// B/C de CambiarComponente) — igual criterio que Gate 3: fixture de test, no-producto.
const SENSOR_TEMP_F = {
  id: "sensor-temp-f-fixture",
  nombreVisible: "Sensor de prueba en Fahrenheit (no-producto)",
  clase: "sensor",
  terminales: [{ id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" }],
  capacidades: [{ id: "temperatura", magnitud: "temperatura", unidad: "fahrenheit" }],
  requisitos: [],
}
const catalogoConFixtureF = construirCatalogo(
  { version: VERSION_CATALOGO_MINIMO, componentes: [...COMPONENTES_CATALOGO_MINIMO, SENSOR_TEMP_F], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } },
  sha256Hex,
)

let contador = 0
function nuevaOperacion(tipo, payload, overrides = {}) {
  return { idOperacion: `op-${contador++}`, actor: "agente", baseRevision: 0, tipo, payload, ...overrides }
}

function proyectoBase() {
  return crearProyecto({ generadorId: () => "proy-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
}

function conLed(proyecto, id, pin) {
  return { ...proyecto, placa: "esp32-devkit-v1", componentes: [...proyecto.componentes, { id, tipo: "led", pines: { anodo: pin }, propiedades: {} }] }
}

// ──────────────────────────── 1/2. SetPlaca válida/inválida ─────────────────────────

test("setplaca-valida-commitea-sin-rechazo", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.placa, "esp32-devkit-v1")
  assert.ok(!r.motivos.some((m) => m.clasificacion === "rechazo"))
})

test("setplaca-invalida-camino-b-no-muta-nada", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("SetPlaca", { placa: "placa-fantasma" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.proyecto, p, "el proyecto devuelto debe ser la MISMA referencia: nada se mutó")
  assert.equal(r.motivos.find((m) => m.codigo === "PLACA_DESCONOCIDA")?.clasificacion, "rechazo")
})

// ─────────────────────── 3/4. AgregarComponente tipo desconocido/válido ─────────────

test("agregarcomponente-tipo-desconocido-rechaza", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("AgregarComponente", { tipo: "tipo-que-no-existe" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.proyecto, p)
  assert.equal(r.motivos[0].codigo, "TIPO_CATALOGO_DESCONOCIDO")
})

test("agregarcomponente-tipo-valido-commitea-con-id-nuevo", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("AgregarComponente", { tipo: "led" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.length, 1)
  assert.equal(r.proyecto.componentes[0].id, "cmp-0")
  assert.equal(r.proyecto.componentes[0].pines.anodo, null, "el terminal digital arranca sin pin asignado")
  assert.equal("catodo" in r.proyecto.componentes[0].pines, false, "el terminal riel-fijo no se registra en pines")
  assert.equal(r.proyecto.siguienteIdLocal, 1)
})

// ──────────────────────── 5/6. QuitarComponente con/sin dependientes ────────────────

test("quitarcomponente-con-dependientes-rechaza-sin-cascada", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  p = { ...p, conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }] }
  const r = ejecutarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "cmp-0" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.proyecto, p)
  assert.equal(r.motivos[0].codigo, "REMOCION_CON_DEPENDIENTES")
  assert.equal(p.componentes.length, 2, "nada se borró, ni siquiera el que se pidió quitar")
})

test("quitarcomponente-sin-dependientes-commitea", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const r = ejecutarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "cmp-0" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.length, 0)
})

test("quitarcomponente-inexistente-rechaza", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "cmp-no-existe" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_INEXISTENTE")
})

// ──── mutante M22: el contador de ids locales NUNCA retrocede al quitar un componente
// (PHASE_1_EXTERNAL_FINDINGS.md — mutante sobre `aplicarQuitarComponente` que
// decrementara `siguienteIdLocal` sobrevivía sin este test: Agregar → cmp-0, Quitar,
// Agregar de nuevo → sin esta regresión nada probaba que el segundo `AgregarComponente`
// no reutilizara "cmp-0"). ──────────────────────────────────────────────────────────

test("quitar-luego-agregar: el contador nunca retrocede, el nuevo id nunca reusa uno ya usado (M22)", () => {
  let p = proyectoBase()

  let r = ejecutarOperacion(p, nuevaOperacion("AgregarComponente", { tipo: "led" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes[0].id, "cmp-0")
  assert.equal(r.proyecto.siguienteIdLocal, 1)
  p = r.proyecto

  r = ejecutarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "cmp-0" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.length, 0)
  assert.equal(r.proyecto.siguienteIdLocal, 1, "el contador NO retrocede al quitar un componente")
  p = r.proyecto

  r = ejecutarOperacion(p, nuevaOperacion("AgregarComponente", { tipo: "led" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes[0].id, "cmp-1", "el nuevo id NUNCA coincide con uno ya usado (cmp-0)")
  assert.equal(r.proyecto.siguienteIdLocal, 2)
})

// ───────────────────── 7/8/9. AsignarPin — rechazo y representable ──────────────────

test("asignarpin-terminal-no-declarado-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", null)
  const r = ejecutarOperacion(p, nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "terminal-inventado", pin: "GPIO23" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_DECLARADO")
})

test("asignarpin-pin-inexistente-en-placa-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", null)
  const r = ejecutarOperacion(p, nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO999" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "PIN_INEXISTENTE_EN_PLACA")
})

test("asignarpin-sobre-pin-ocupado-commitea-con-blocking (representable, NO se rechaza a nivel de operacion)", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "led", pines: { anodo: null }, propiedades: {} }] }
  const r = ejecutarOperacion(p, nuevaOperacion("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }), catalogo)
  assert.equal(r.ok, true, "un pin ocupado es REPRESENTABLE: la operación commitea igual")
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-1").pines.anodo, "GPIO23", "el pin SE ASIGNA aunque esté ocupado")
  const pinOcupado = r.motivos.find((m) => m.codigo === "PIN_OCUPADO")
  assert.ok(pinOcupado, `debe aparecer PIN_OCUPADO en los motivos: ${JSON.stringify(r.motivos)}`)
  assert.equal(pinOcupado.severidad, "blocking")
  assert.equal(pinOcupado.clasificacion, "representable")
})

// ───────────────────── 10/11/12. Conectar — autoconexión/duplicada/válida ───────────

test("conectar-autoconexion-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const r = ejecutarOperacion(p, nuevaOperacion("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-0", terminal: "anodo" } }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "AUTOCONEXION_INVALIDA")
})

test("conectar-duplicada-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  p = { ...p, conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }] }
  const r = ejecutarOperacion(p, nuevaOperacion("Conectar", { desde: { componente: "cmp-1", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } }), catalogo)
  assert.equal(r.ok, false, "el MISMO par, aunque en orden invertido, ya está conectado")
  assert.equal(r.motivos[0].codigo, "CONEXION_DUPLICADA")
})

test("conectar-valida-commitea", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  const r = ejecutarOperacion(p, nuevaOperacion("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.conexiones.length, 1)
  assert.equal(r.proyecto.conexiones[0].id, "conn-0")
})

// ───────────────────────────── 13. Desconectar inexistente ──────────────────────────

test("desconectar-inexistente-rechaza", () => {
  const p = proyectoBase()
  const r = ejecutarOperacion(p, nuevaOperacion("Desconectar", { conexion: "conn-no-existe" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_INEXISTENTE")
})

// ────────────────── 14/15/16. SetComportamiento — rechazo y válido ──────────────────

test("setcomportamiento-sensor-inexistente-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-no-existe", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_INEXISTENTE")
})

test("setcomportamiento-capacidad-no-declarada-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "capacidad-inventada", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "CAPACIDAD_NO_DECLARADA")
})

test("setcomportamiento-regla-valida-commitea", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos.length, 1)
  assert.equal(r.proyecto.comportamientos[0].id, "beh-0")
})

// Phase 1.1 (hallazgo externo RX-04, MENOR — revisión adversarial independiente):
// `aplicarSetComportamiento` decide "reemplazo vs. alta nueva" mirando si
// `payload.comportamiento.id` YA existe — pero el reemplazo (upsert) commiteaba con
// `motivos:[]`, sin ningún rastro de que la intención ANTERIOR con ese id fue
// descartada (brief §12: "reasons[]... también documenta decisiones deterministas
// exitosas"). Ya existe un patrón establecido de motivo informativo de éxito para
// una decisión determinista que SÍ cambia algo silenciosamente (`UNIDAD_CONVERTIDA`,
// `catalogo.ts`/`reemplazarSensor`, severidad `info`, sin `clasificacion` — reusado
// también dentro de `aplicarCambiarComponente`, Gate 5) — mismo criterio: "rama A"
// (nada cambia) no emite motivo, pero una decisión que SÍ reemplaza algo, sí. La
// semántica upsert de `SetComportamiento` no cambia — sigue commiteando igual,
// `ok:true`, sólo se agrega el motivo informativo.
test("setcomportamiento-reemplazo-con-id-existente-emite-motivo-informativo-COMPORTAMIENTO_REEMPLAZADO (hallazgo externo RX-04)", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  const comportamientoOriginal = { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } }
  const rAlta = ejecutarOperacion(p, nuevaOperacion("SetComportamiento", { comportamiento: comportamientoOriginal }), catalogo)
  assert.equal(rAlta.ok, true)
  assert.equal(rAlta.proyecto.comportamientos.length, 1)
  assert.ok(!rAlta.motivos.some((m) => m.codigo === "COMPORTAMIENTO_REEMPLAZADO"), "la ALTA nueva (sin id existente) nunca emite el motivo de reemplazo")

  const comportamientoReemplazo = { id: "beh-0", cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: "<", umbral: { valor: 10, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "apagar" } }
  const rReemplazo = ejecutarOperacion(rAlta.proyecto, nuevaOperacion("SetComportamiento", { comportamiento: comportamientoReemplazo }), catalogo)
  assert.equal(rReemplazo.ok, true, "el reemplazo sigue commiteando igual — la semantica upsert no cambia")
  assert.equal(rReemplazo.proyecto.comportamientos.length, 1, "sigue siendo un upsert: no se agrega una segunda entidad")
  assert.equal(rReemplazo.proyecto.comportamientos[0].cuando.comparador, "<", "el contenido SI se reemplazo")
  const motivoReemplazo = rReemplazo.motivos.find((m) => m.codigo === "COMPORTAMIENTO_REEMPLAZADO")
  assert.ok(motivoReemplazo, `debe traer COMPORTAMIENTO_REEMPLAZADO: ${JSON.stringify(rReemplazo.motivos)}`)
  assert.equal(motivoReemplazo.categoria, "operacion")
  assert.equal(motivoReemplazo.severidad, "info")
  assert.notEqual(motivoReemplazo.clasificacion, "rechazo", "es informativo — nunca corta la operacion")
})

// ═══ Phase 1.1 (hallazgo externo E1-03, CRÍTICO) — SetComportamiento aceptaba un
// `umbral.valor` NaN/±Infinity con `ok:true` y lo commiteaba: ninguno de los tres es
// representable en el documento JSON persistido (`JSON.stringify(NaN)` y
// `JSON.stringify(Infinity)` dan `null`, ver `canonico.ts`) — la memoria (con el
// número real) quedaba desincronizada del disco (con `null`) apenas se persistía una
// vez. Se rechaza ACÁ, ANTES de crear ningún estado nuevo (Camino B, §9.1) — a
// diferencia de una capacidad/magnitud/unidad incompatible con el catálogo, que SÍ
// es representable (ver tests/nucleo-validacion.test.mjs). ═══════════════════════

function proyectoConSensorPulsador() {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "pulsador", pines: { senal: "GPIO4" }, propiedades: {} }] }
  return p
}

test("setcomportamiento-umbral-nan-rechaza EN LA OPERACIÓN MISMA, antes de validarProyecto (hallazgo externo E1-03)", () => {
  const p = proyectoConSensorPulsador()
  const payload = { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "estadoBooleano", comparador: ">", umbral: { valor: NaN, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }
  // `aplicarOperacion` (sin `ejecutarOperacion` alrededor) sólo corre los chequeos
  // PROPIOS de la operación — NUNCA `validarProyecto` (Gate 4). Si esto rechaza, es
  // la operación misma (Camino A del brief, "rechaza ANTES de construir el
  // estado"), no la defensa en profundidad de Gate 4.
  const directo = aplicarOperacion(p, nuevaOperacion("SetComportamiento", payload), catalogo)
  assert.equal(directo.proyecto, p, "nada se muta: el rechazo corre ANTES de tocar el estado")
  assert.equal(directo.motivos[0].codigo, "UMBRAL_NO_FINITO")
  assert.equal(directo.motivos[0].categoria, "operacion", "lo rechaza la OPERACIÓN misma, no la validación post-aplicación")
  assert.equal(directo.motivos[0].clasificacion, "rechazo")

  const r = ejecutarOperacion(p, nuevaOperacion("SetComportamiento", payload), catalogo)
  assert.equal(r.ok, false, "NaN pasa typeof === 'number', pero Number.isFinite(NaN) === false: se rechaza igual")
  assert.equal(r.proyecto, p)
})

test("setcomportamiento-umbral-infinito-positivo-rechaza EN LA OPERACIÓN MISMA (hallazgo externo E1-03)", () => {
  const p = proyectoConSensorPulsador()
  // Capacidad REAL ("estadoBooleano" del pulsador) — el bug original aceptaba esto
  // con ok:true incluso con magnitud/unidad bogus además de Infinity.
  const payload = { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "estadoBooleano", comparador: ">", umbral: { valor: Infinity, unidad: "unidad-bogus", magnitud: "magnitud-bogus" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }
  const directo = aplicarOperacion(p, nuevaOperacion("SetComportamiento", payload), catalogo)
  assert.equal(directo.proyecto, p)
  assert.equal(directo.motivos[0].codigo, "UMBRAL_NO_FINITO")
  assert.equal(directo.motivos[0].categoria, "operacion")

  const r = ejecutarOperacion(p, nuevaOperacion("SetComportamiento", payload), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.proyecto, p)
})

test("setcomportamiento-umbral-infinito-negativo-rechaza (hallazgo externo E1-03)", () => {
  const p = proyectoConSensorPulsador()
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "estadoBooleano", comparador: "<", umbral: { valor: -Infinity, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "UMBRAL_NO_FINITO")
})

// No-regresión: un umbral 0 (falsy en JS, pero un número finito perfectamente
// válido) NUNCA se puede confundir con "faltante" ni rechazarse por esto.
test("setcomportamiento-umbral-cero-commitea (no regresión, E1-03)", () => {
  const p = proyectoConSensorPulsador()
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 0, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, true, "0 es un umbral valido: Number.isFinite(0) === true")
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, 0)
})

// No-regresión: temperatura negativa (ej. -40°C) es un umbral físicamente válido —
// finito y con magnitud/unidad reales del catálogo — nunca se rechaza ni se marca
// blocking por esto.
test("setcomportamiento-temperatura-negativa-commitea (no regresión, E1-03)", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: "<", umbral: { valor: -40, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, true, "-40 es finito y coincide con magnitud/unidad reales del dht22: nunca se rechaza")
  assert.ok(!r.motivos.some((m) => m.codigo === "UMBRAL_NO_FINITO" || m.codigo === "MAGNITUD_INCOMPATIBLE" || m.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO"), `no debe aparecer ningun motivo de E1-03 por esto: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, -40)
})

// ─────────────────── 17-21. CambiarComponente — inexistente + ramas A-D ─────────────

test("cambiarcomponente-tipo-nuevo-inexistente-rechaza", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const r = ejecutarOperacion(p, nuevaOperacion("CambiarComponente", { componente: "cmp-0", tipoNuevo: "tipo-que-no-existe" }), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TIPO_CATALOGO_DESCONOCIDO")
})

function proyectoConSensorYComportamiento(tipoSensor, umbralUnidad = "celsius", umbralValor = 30, cat = catalogo) {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: tipoSensor, pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = {
    ...p,
    comportamientos: [{ id: "beh-0", cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: umbralValor, unidad: umbralUnidad, magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } }],
  }
  return p
}

test("cambiarcomponente-rama-a-preserva-umbral (a traves de la operacion)", () => {
  const p = proyectoConSensorYComportamiento("dht22")
  const r = ejecutarOperacion(p, nuevaOperacion("CambiarComponente", { componente: "cmp-1", tipoNuevo: "ntc" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-1").tipo, "ntc")
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, 30)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.unidad, "celsius")
})

test("cambiarcomponente-rama-b-convierte-unidad (a traves de la operacion)", () => {
  const p = proyectoConSensorYComportamiento("dht22")
  const r = ejecutarOperacion(p, nuevaOperacion("CambiarComponente", { componente: "cmp-1", tipoNuevo: "sensor-temp-f-fixture" }), catalogoConFixtureF)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.unidad, "fahrenheit")
  assert.ok(Math.abs(r.proyecto.comportamientos[0].cuando.umbral.valor - 86) < 0.01)
  assert.ok(r.motivos.some((m) => m.codigo === "UNIDAD_CONVERTIDA"))
})

test("cambiarcomponente-rama-c-rango-incompatible-no-recorta (a traves de la operacion)", () => {
  // umbral 55°C, dentro del rango del dht22 (0-60) pero fuera del rango del NTC del
  // catálogo real (también 0-60 en este set mínimo) — para forzar rama C hace falta
  // un sensor con rango más angosto; se usa el mismo fixture sintético de Gate 3
  // (sensor-temp-corto) agregado a un catálogo de prueba propio de este test.
  const sensorCorto = { id: "sensor-temp-corto-fixture", nombreVisible: "corto", clase: "sensor", terminales: [{ id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" }], capacidades: [{ id: "temperatura", magnitud: "temperatura", unidad: "celsius", rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 25, unidad: "celsius", magnitud: "temperatura" } } }], requisitos: [] }
  const catalogoConCorto = construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes: [...COMPONENTES_CATALOGO_MINIMO, sensorCorto], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
  const p = proyectoConSensorYComportamiento("dht22", "celsius", 30)
  const r = ejecutarOperacion(p, nuevaOperacion("CambiarComponente", { componente: "cmp-1", tipoNuevo: "sensor-temp-corto-fixture" }), catalogoConCorto)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos[0].cuando.umbral.valor, 30, "el umbral NO se recorta al maximo del rango nuevo")
  assert.ok(r.motivos.some((m) => m.codigo === "RANGO_INCOMPATIBLE_AL_REEMPLAZAR" && m.severidad === "warning"))
})

test("cambiarcomponente-rama-d-incompatible-commitea-con-blocking (a traves de la operacion)", () => {
  const p = proyectoConSensorYComportamiento("dht22", "porcentaje", 70)
  // ojo: el comportamiento de este fixture pide capacidad "temperatura" — para
  // ejercitar rama D hace falta que la capacidad NO exista en el sensor nuevo. Se
  // arma el comportamiento pidiendo "humedad" (que sí declara el dht22) y se cambia a
  // ntc (que NO tiene humedad) — commitea igual, con blocking.
  const p2 = { ...p, comportamientos: [{ ...p.comportamientos[0], cuando: { ...p.comportamientos[0].cuando, capacidad: "humedad", umbral: { valor: 70, unidad: "porcentaje", magnitud: "humedad" } } }] }
  const r = ejecutarOperacion(p2, nuevaOperacion("CambiarComponente", { componente: "cmp-1", tipoNuevo: "ntc" }), catalogo)
  assert.equal(r.ok, true, "la operacion SIEMPRE commitea si tipoNuevo existe (R1) — nunca se rechaza por una rama D")
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-1").tipo, "ntc")
  const incompatible = r.motivos.find((m) => m.codigo === "CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR")
  assert.ok(incompatible, `debe aparecer CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR: ${JSON.stringify(r.motivos)}`)
  assert.equal(incompatible.severidad, "blocking")
  assert.deepEqual(r.proyecto.comportamientos[0].cuando, p2.comportamientos[0].cuando, "el comportamiento no se borra ni se reinterpreta: queda igual, con el motivo blocking al lado")
})

// ───────────────────────────── 22/23. Invariante de vista ───────────────────────────

test("invariante-de-vista: AsignarPin solo toca su componente, otro no relacionado queda === ", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", null)
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  const cmp1Antes = p.componentes.find((c) => c.id === "cmp-1")
  const r = ejecutarOperacion(p, nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }), catalogo)
  assert.equal(r.ok, true)
  const cmp1Despues = r.proyecto.componentes.find((c) => c.id === "cmp-1")
  assert.equal(cmp1Despues, cmp1Antes, "el componente NO tocado debe ser la MISMA referencia, no sólo deepEqual")
})

test("invariante-de-vista: CambiarComponente solo reescribe los comportamientos que referencian al componente cambiado", () => {
  let p = proyectoConSensorYComportamiento("dht22")
  // Un componente y una conexión totalmente ajenos al cambio.
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "pulsador", pines: { senal: "GPIO4" }, propiedades: {} }] }
  const cmp2Antes = p.componentes.find((c) => c.id === "cmp-2")
  const cmpLedAntes = p.componentes.find((c) => c.id === "cmp-0")
  const r = ejecutarOperacion(p, nuevaOperacion("CambiarComponente", { componente: "cmp-1", tipoNuevo: "ntc" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-2"), cmp2Antes, "cmp-2 no participa del cambio: misma referencia")
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-0"), cmpLedAntes, "cmp-0 (el actuador, no el sensor cambiado) tampoco se toca")
})

// Phase 1.1 (hallazgo externo E4-03): antes de acá el invariante de vista (OPERATIONS.md
// §5) sólo se ejercitaba con test explícito para AsignarPin y CambiarComponente — las
// otras 6 operaciones mutantes (SetPlaca/AgregarComponente/QuitarComponente/Conectar/
// Desconectar/SetComportamiento) no tenían regresión propia, aunque el contrato ("una
// operación cambia SÓLO su entidad destino y los efectos derivados que las reglas
// exigen") es el MISMO para las 8. Se agrega un test por operación, siguiendo el mismo
// patrón de los 2 tests de arriba: fixture con una entidad NO relacionada, `===` (no
// `deepEqual`) entre el proyecto antes y después.

test("invariante-de-vista: SetPlaca no toca ninguna entidad — todo el arbol de componentes/conexiones/comportamientos queda === ", () => {
  let p = proyectoBase()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  p = { ...p, conexiones: [...p.conexiones, { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }] }
  const componentesAntes = p.componentes
  const conexionesAntes = p.conexiones
  const comportamientosAntes = p.comportamientos
  const r = ejecutarOperacion(p, nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.placa, "esp32-devkit-v1")
  assert.equal(r.proyecto.componentes, componentesAntes, "SetPlaca sólo toca el campo placa: el array de componentes entero debe seguir siendo la MISMA referencia")
  assert.equal(r.proyecto.conexiones, conexionesAntes, "idem para conexiones")
  assert.equal(r.proyecto.comportamientos, comportamientosAntes, "idem para comportamientos")
})

test("invariante-de-vista: AgregarComponente solo agrega, el componente existente no relacionado queda === ", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const cmp0Antes = p.componentes.find((c) => c.id === "cmp-0")
  const conexionesAntes = p.conexiones
  const comportamientosAntes = p.comportamientos
  const r = ejecutarOperacion(p, nuevaOperacion("AgregarComponente", { tipo: "resistencia" }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-0"), cmp0Antes, "el componente ya existente, no relacionado con el alta, debe ser la MISMA referencia")
  assert.equal(r.proyecto.conexiones, conexionesAntes, "AgregarComponente no toca conexiones: misma referencia de array")
  assert.equal(r.proyecto.comportamientos, comportamientosAntes, "AgregarComponente no toca comportamientos: misma referencia de array")
})

test("invariante-de-vista: QuitarComponente solo remueve el suyo, el componente no relacionado queda === ", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  p = { ...p, componentes: [...p.componentes, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }] }
  const cmp1Antes = p.componentes.find((c) => c.id === "cmp-1")
  const conexionesAntes = p.conexiones
  const comportamientosAntes = p.comportamientos
  const r = ejecutarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "cmp-0" }), catalogo)
  assert.equal(r.ok, true)
  assert.ok(!r.proyecto.componentes.some((c) => c.id === "cmp-0"), "cmp-0 debe haber sido removido")
  assert.equal(r.proyecto.componentes.find((c) => c.id === "cmp-1"), cmp1Antes, "cmp-1, no relacionado con la baja, debe ser la MISMA referencia")
  assert.equal(r.proyecto.conexiones, conexionesAntes, "QuitarComponente sin dependientes no toca conexiones: misma referencia de array")
  assert.equal(r.proyecto.comportamientos, comportamientosAntes, "idem para comportamientos")
})

test("invariante-de-vista: Conectar solo agrega una conexion, la existente no relacionada y los componentes quedan === ", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1", componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }, { id: "cmp-2", tipo: "pulsador", pines: { senal: null }, propiedades: {} }] }
  p = { ...p, conexiones: [{ id: "conn-0", desde: { componente: "cmp-1", terminal: "a" }, hasta: { componente: "cmp-2", terminal: "senal" } }], siguienteIdLocal: 3 }
  const conn0Antes = p.conexiones.find((cx) => cx.id === "conn-0")
  const componentesAntes = p.componentes
  const comportamientosAntes = p.comportamientos
  const r = ejecutarOperacion(p, nuevaOperacion("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "b" } }), catalogo)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.conexiones.find((cx) => cx.id === "conn-0"), conn0Antes, "conn-0, no relacionada con la conexion nueva, debe ser la MISMA referencia")
  assert.equal(r.proyecto.componentes, componentesAntes, "Conectar no toca componentes: misma referencia de array")
  assert.equal(r.proyecto.comportamientos, comportamientosAntes, "idem para comportamientos")
})

test("invariante-de-vista: Desconectar solo remueve la suya, la conexion no relacionada queda === (hallazgo E4-03, mutante m4)", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1", componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }, { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} }, { id: "cmp-2", tipo: "pulsador", pines: { senal: null }, propiedades: {} }] }
  p = {
    ...p,
    conexiones: [
      { id: "conn-0", desde: { componente: "cmp-1", terminal: "a" }, hasta: { componente: "cmp-2", terminal: "senal" } },
      { id: "conn-1", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "b" } },
    ],
    siguienteIdLocal: 3,
  }
  const conn0Antes = p.conexiones.find((cx) => cx.id === "conn-0")
  const componentesAntes = p.componentes
  const comportamientosAntes = p.comportamientos
  const r = ejecutarOperacion(p, nuevaOperacion("Desconectar", { conexion: "conn-1" }), catalogo)
  assert.equal(r.ok, true)
  assert.ok(!r.proyecto.conexiones.some((cx) => cx.id === "conn-1"), "conn-1 debe haber sido removida")
  assert.equal(r.proyecto.conexiones.find((cx) => cx.id === "conn-0"), conn0Antes, "conn-0, no relacionada con la baja, debe ser la MISMA referencia — no una copia deepEqual")
  assert.equal(r.proyecto.componentes, componentesAntes, "Desconectar no toca componentes: misma referencia de array")
  assert.equal(r.proyecto.comportamientos, comportamientosAntes, "idem para comportamientos")
})

test("invariante-de-vista: SetComportamiento (alta nueva) no toca el comportamiento existente no relacionado, que queda === ", () => {
  let p = proyectoConSensorYComportamiento("dht22") // ya trae beh-0: sensor cmp-1, actuador cmp-0
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "pulsador", pines: { senal: "GPIO4" }, propiedades: {} }] }
  const beh0Antes = p.comportamientos.find((b) => b.id === "beh-0")
  const componentesAntes = p.componentes
  const conexionesAntes = p.conexiones
  const r = ejecutarOperacion(
    p,
    nuevaOperacion("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 50, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-2", accion: "encender" } } }),
    catalogo,
  )
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.comportamientos.length, 2, "debe haber agregado un beh-1 nuevo, sin tocar beh-0")
  assert.equal(r.proyecto.comportamientos.find((b) => b.id === "beh-0"), beh0Antes, "beh-0, no relacionado con el alta nueva, debe ser la MISMA referencia")
  assert.equal(r.proyecto.componentes, componentesAntes, "SetComportamiento no toca componentes: misma referencia de array")
  assert.equal(r.proyecto.conexiones, conexionesAntes, "idem para conexiones")
})

// ──────────────────── extra: aplicarOperacion es pura (misma entrada, mismo resultado)

test("aplicarOperacion es pura: misma entrada da el mismo resultado dos veces", () => {
  let p = proyectoBase()
  p = conLed(p, "cmp-0", "GPIO23")
  const op = nuevaOperacion("QuitarComponente", { componente: "cmp-0" })
  const r1 = aplicarOperacion(p, op, catalogo)
  const r2 = aplicarOperacion(p, op, catalogo)
  assert.deepEqual(r1.motivos, r2.motivos)
  assert.deepEqual(r1.proyecto, r2.proyecto)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Revisión de arquitectura Gate 8 (§77, PASS_WITH_NOTE): `ejecutarOperacion` tenía la
// MISMA clase de gap que motor.ts antes de su fix — devolvía `ok:true` sin revisar si
// `motivosValidacion` (validarProyecto post-aplicación) traía un motivo
// `clasificacion:"rechazo"` (sólo miraba `motivosPropios`). No explotable hoy vía las 8
// operaciones públicas (todas re-chequean referencias antes de mutar), pero es una
// trampa latente si un futuro consumidor llama `ejecutarOperacion` creyendo que
// replica el contrato completo del motor. Repro: `proyecto` de entrada YA roto
// (bypaseando `cargarProyecto`) + una operación trivial no relacionada.
// ════════════════════════════════════════════════════════════════════════════════════

test("ejecutarOperacion rechaza si la validacion post-aplicacion trae un motivo clasificacion=rechazo (hallazgo revision arquitectura Gate 8, §77)", () => {
  const base = proyectoBase()
  const roto = {
    ...base,
    placa: "esp32-devkit-v1",
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-NO-EXISTE", terminal: "a" } }],
    siguienteIdLocal: 1,
  }
  const r = ejecutarOperacion(roto, nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 0), catalogo)
  assert.equal(r.ok, false, "un rechazo en la validacion post-aplicacion debe tumbar el resultado, aunque la operacion en si misma fuera valida")
  assert.ok(
    r.motivos.some((m) => m.codigo === "REFERENCIA_INEXISTENTE" && m.clasificacion === "rechazo"),
    `debe traer el motivo de rechazo real: ${JSON.stringify(r.motivos)}`,
  )
  assert.equal(r.proyecto, roto, "el proyecto devuelto debe ser el ORIGINAL (sin el componente agregado) — nunca un resultado aceptado a medias")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E2-02 (CRÍTICO, PHASE_1_EXTERNAL_FINDINGS.md): el
// `switch` de `aplicarOperacion` no tenía `default`, y no existía ninguna validación
// de FORMA en runtime del sobre (`SobreOperacion`) ni del `payload` antes del
// despacho — el cast `operacion.payload as {...}` de cada rama es sólo de
// compilación. Un `tipo` desconocido, un `payload` null/undefined/con forma
// incorrecta, o un `actor`/`idOperacion`/`idTransaccion` inválidos hacían explotar un
// `TypeError` crudo (nunca un `Motivo` estructurado — brief §12), que se propagaba
// SIN capturar hasta `motor.aplicar()`. Reproducción original:
// evidencia/e2/exp2_malformed_operations.mjs, exp2b_motor_crash_propagation.mjs. Ver
// docs/programacion-intencion/OPERATIONS.md §9 para el contrato completo (sobre +
// códigos nuevos).
// ════════════════════════════════════════════════════════════════════════════════════

test("aplicarOperacion/ejecutarOperacion NUNCA lanzan una excepcion cruda ante un sobre/payload malformado — siempre un Motivo estructurado (hallazgo externo E2-02)", () => {
  const p = proyectoBase()
  const casos = [
    { nombre: "tipo desconocido (string arbitrario)", operacion: { idOperacion: "op-a", actor: "agente", baseRevision: 0, tipo: "TipoQueNoExiste", payload: {} }, codigoEsperado: "TIPO_OPERACION_DESCONOCIDO" },
    { nombre: "tipo es null", operacion: { idOperacion: "op-b", actor: "agente", baseRevision: 0, tipo: null, payload: {} }, codigoEsperado: "TIPO_OPERACION_DESCONOCIDO" },
    { nombre: "payload null en SetPlaca", operacion: { idOperacion: "op-c", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: null }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "payload undefined en AgregarComponente", operacion: { idOperacion: "op-d", actor: "agente", baseRevision: 0, tipo: "AgregarComponente", payload: undefined }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "Conectar con payload {} (sin desde/hasta)", operacion: { idOperacion: "op-e", actor: "agente", baseRevision: 0, tipo: "Conectar", payload: {} }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "Conectar con desde=null", operacion: { idOperacion: "op-f", actor: "agente", baseRevision: 0, tipo: "Conectar", payload: { desde: null, hasta: { componente: "x", terminal: "y" } } }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "Conectar con payload array en vez de objeto", operacion: { idOperacion: "op-g", actor: "agente", baseRevision: 0, tipo: "Conectar", payload: [] }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "actor faltante (campo requerido ausente)", operacion: { idOperacion: "op-h", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
    { nombre: "actor con valor invalido", operacion: { idOperacion: "op-i", actor: "hacker", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
    { nombre: "idOperacion faltante", operacion: { actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
    { nombre: "idOperacion vacio", operacion: { idOperacion: "", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
    { nombre: "idTransaccion invalido (numero en vez de string)", operacion: { idOperacion: "op-j", idTransaccion: 123, actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
    { nombre: "QuitarComponente payload null", operacion: { idOperacion: "op-k", actor: "agente", baseRevision: 0, tipo: "QuitarComponente", payload: null }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "Desconectar payload undefined", operacion: { idOperacion: "op-l", actor: "agente", baseRevision: 0, tipo: "Desconectar", payload: undefined }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "SetComportamiento payload {}", operacion: { idOperacion: "op-m", actor: "agente", baseRevision: 0, tipo: "SetComportamiento", payload: {} }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "SetComportamiento comportamiento sin cuando/entonces", operacion: { idOperacion: "op-n", actor: "agente", baseRevision: 0, tipo: "SetComportamiento", payload: { comportamiento: {} } }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "CambiarComponente payload {}", operacion: { idOperacion: "op-o", actor: "agente", baseRevision: 0, tipo: "CambiarComponente", payload: {} }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    { nombre: "AsignarPin payload {} (sin componente/terminal)", operacion: { idOperacion: "op-p", actor: "agente", baseRevision: 0, tipo: "AsignarPin", payload: {} }, codigoEsperado: "PAYLOAD_OPERACION_INVALIDO" },
    // Phase 1.1 (RX4, hallazgo externo RX4-01, CRITICO — cuarta revision adversarial
    // independiente): el SOBRE ENTERO es `null` (no un campo interno malformado
    // dentro de un objeto, como los 17 casos de arriba). `aplicarOperacion` ya lo
    // manejaba bien (`SOBRE_OPERACION_INVALIDO`, `null` nunca invoca ningun getter
    // porque no hay ninguno) — el defecto real vivia en `ejecutarOperacion`
    // (`operaciones.ts:480`): el eco de `idOperacion`/`idTransaccion`/`baseRevision`
    // materializaba su PROPIA copia del sobre crudo y leia `.idOperacion` de ella sin
    // verificar primero que fuera un objeto — con `operacion === null`, `materializado.
    // valor === null` (null es un dato plano legitimo, `materializarDatosPlanos` lo
    // acepta) y `null.idOperacion` explotaba con un TypeError crudo, DESPUES de que
    // `aplicarOperacion` ya habia clasificado ese mismo `null` correctamente.
    { nombre: "operacion === null (sobre entero, no un campo interno)", operacion: null, codigoEsperado: "SOBRE_OPERACION_INVALIDO" },
  ]
  for (const { nombre, operacion, codigoEsperado } of casos) {
    let directo
    assert.doesNotThrow(() => {
      directo = aplicarOperacion(p, operacion, catalogo)
    }, `aplicarOperacion NUNCA debe lanzar una excepcion cruda — caso "${nombre}"`)
    assert.equal(directo.proyecto, p, `caso "${nombre}": el proyecto devuelto debe ser la MISMA referencia — nada se mutó`)
    assert.equal(directo.motivos.length, 1, `caso "${nombre}": debe traer exactamente un motivo`)
    assert.equal(directo.motivos[0].codigo, codigoEsperado, `caso "${nombre}": codigo esperado ${codigoEsperado}, recibido ${directo.motivos[0].codigo}`)
    assert.equal(directo.motivos[0].clasificacion, "rechazo", `caso "${nombre}": debe ser clasificacion rechazo`)

    let viaEjecutar
    assert.doesNotThrow(() => {
      viaEjecutar = ejecutarOperacion(p, operacion, catalogo)
    }, `ejecutarOperacion NUNCA debe lanzar una excepcion cruda — caso "${nombre}"`)
    assert.equal(viaEjecutar.ok, false, `caso "${nombre}": ejecutarOperacion debe rechazar`)
    assert.equal(viaEjecutar.proyecto, p, `caso "${nombre}": el proyecto devuelto por ejecutarOperacion debe ser la MISMA referencia`)
  }
})

// Phase 1.1 — hallazgo externo E2-03 (MENOR): el sobre aceptaba campos extra
// desconocidos sin rechazo, a diferencia de `cargarProyecto()` (fail-closed ante
// `CLAVE_DESCONOCIDA`). Mismo código, categoría `operacion` en vez de `estructural`.
test("el sobre de operacion rechaza una clave extra desconocida con CLAVE_DESCONOCIDA (hallazgo externo E2-03)", () => {
  const p = proyectoBase()
  const operacion = { idOperacion: "op-extra", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" }, extraField: "sorpresa" }
  const r = aplicarOperacion(p, operacion, catalogo)
  assert.equal(r.proyecto, p)
  assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
  assert.equal(r.motivos[0].categoria, "operacion")
  assert.equal(r.motivos[0].clasificacion, "rechazo")
  assert.deepEqual(r.motivos[0].datos.claves, ["extraField"])
})

// Phase 1.1 (hallazgo externo RX-02, CRÍTICO — reabre E2-02; REABIERTO a su vez por
// RX2-01, revisión adversarial independiente #2): `analizarSobreOperacion`/
// `validarFormaPayload` LEEN campos del sobre/payload (`operacion.actor`,
// `payload.placa`, `payload.comportamiento.cuando.umbral.valor`, etc.) — un getter
// que lanza en cualquiera de esos campos (algo que ningún JSON real puede producir,
// pero que un llamador en proceso — un futuro adaptador, un wrapper de test, un ORM
// con propiedades lazy — sí puede construir) propagaba una excepción cruda. El fix
// de RX-02 (`try/catch` puntual alrededor de UNA lectura) no alcanzaba: RX2-01
// encontró que el `switch` de despacho, más abajo, volvía a leer `operacion.payload`
// SIN proteger — una SEGUNDA lectura. El fix de esta ronda (RX2) materializa el
// sobre COMPLETO en datos planos, UNA sola vez, antes de leer nada — no hay una
// "segunda lectura" que pueda divergir, así que el código de rechazo pasa a ser el
// único y estable `ENTRADA_NO_ES_DATO_PLANO` (`datos-planos.ts`), no
// `EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA` (código que esta ronda deja de
// emitir — ver `operaciones.ts`). Los 5 casos de acá son los que reprodujo RX
// (T9/scripts/03_e2_getter_via_motor.mjs): getter en el SOBRE (`actor`), en el
// PAYLOAD de primer nivel (`placa`), y en un campo MÁS anidado del payload
// (`comportamiento.cuando.umbral.valor`) — más dos casos adicionales para cubrir
// `idOperacion` (sobre) y un extremo de `Conectar` (payload anidado en otra operación).
test("aplicarOperacion/ejecutarOperacion NUNCA propagan un getter-que-explota del sobre/payload — siempre un Motivo estructurado (hallazgo externo RX-02/RX2-01)", () => {
  const p = proyectoBase()

  function conGetterQueExplota(objetoBase, campo, mensaje) {
    const objeto = { ...objetoBase }
    delete objeto[campo]
    Object.defineProperty(objeto, campo, {
      enumerable: true,
      get() {
        throw new Error(mensaje)
      },
    })
    return objeto
  }

  const casos = [
    {
      nombre: "getter en operacion.actor (sobre)",
      operacion: conGetterQueExplota({ idOperacion: "op-rx02-1", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, "actor", "getter boom en actor"),
    },
    {
      nombre: "getter en operacion.idOperacion (sobre)",
      operacion: conGetterQueExplota({ idOperacion: "op-rx02-2", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "arduino-uno" } }, "idOperacion", "getter boom en idOperacion"),
    },
    {
      nombre: "getter en payload.placa (SetPlaca)",
      operacion: { idOperacion: "op-rx02-3", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: conGetterQueExplota({}, "placa", "getter boom en placa") },
    },
    {
      nombre: "getter en payload.comportamiento.cuando.umbral.valor (SetComportamiento, anidado)",
      operacion: {
        idOperacion: "op-rx02-4",
        actor: "agente",
        baseRevision: 0,
        tipo: "SetComportamiento",
        payload: {
          comportamiento: {
            cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: conGetterQueExplota({ unidad: "celsius", magnitud: "temperatura" }, "valor", "getter boom en umbral.valor") },
            entonces: { actuador: "cmp-1", accion: "encender" },
          },
        },
      },
    },
    {
      nombre: "getter en payload.desde (Conectar, extremo completo)",
      operacion: {
        idOperacion: "op-rx02-5",
        actor: "agente",
        baseRevision: 0,
        tipo: "Conectar",
        payload: conGetterQueExplota({ hasta: { componente: "cmp-1", terminal: "a" } }, "desde", "getter boom en desde"),
      },
    },
  ]

  for (const { nombre, operacion } of casos) {
    let directo
    assert.doesNotThrow(() => {
      directo = aplicarOperacion(p, operacion, catalogo)
    }, `aplicarOperacion NUNCA debe propagar el getter — caso "${nombre}"`)
    assert.equal(directo.proyecto, p, `caso "${nombre}": el proyecto devuelto debe ser la MISMA referencia`)
    assert.equal(directo.motivos.length, 1, `caso "${nombre}": debe traer exactamente un motivo`)
    assert.equal(directo.motivos[0].clasificacion, "rechazo", `caso "${nombre}": debe ser clasificacion rechazo`)
    assert.equal(directo.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO", `caso "${nombre}": codigo esperado ENTRADA_NO_ES_DATO_PLANO, recibido ${directo.motivos[0].codigo}`)
    assert.equal(directo.motivos[0].categoria, "operacion", `caso "${nombre}": categoria esperada operacion`)

    let viaEjecutar
    assert.doesNotThrow(() => {
      viaEjecutar = ejecutarOperacion(p, operacion, catalogo)
    }, `ejecutarOperacion NUNCA debe propagar el getter — caso "${nombre}"`)
    assert.equal(viaEjecutar.ok, false, `caso "${nombre}": ejecutarOperacion debe rechazar`)
    assert.equal(viaEjecutar.proyecto, p, `caso "${nombre}": el proyecto devuelto por ejecutarOperacion debe ser la MISMA referencia`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — revisión adversarial independiente
// #3, RX3_REPORT.md): "__proto__" como clave literal, alcanzable con JSON PURO (vía
// JSON.parse — NUNCA un literal de objeto JS, que la gramática del lenguaje interpreta
// como prototipo en tiempo de parseo del código fuente), corrompía el prototipo de la
// copia materializada. Acá, en `aplicarOperacion` (Gate 5), la MISMA forma de ataque en
// `payload.propiedades` (la bolsa abierta de `AgregarComponente`).
//
// FIX DE RAÍZ (ver DECISIONS.md/causa.md): con el contenedor seguro
// (`Object.defineProperty`), "__proto__" — y, por la misma razón técnica,
// "constructor"/"prototype" — ya NO tienen ningún efecto especial. `propiedades` es
// una bolsa ABIERTA por contrato (`ir.ts`): estas claves se ACEPTAN como dato
// ordinario, preservado exacto, sin corromper el prototipo del objeto que las
// contiene — nunca se rechazan por su nombre.
// ════════════════════════════════════════════════════════════════════════════════════

test("aplicarOperacion ACEPTA '__proto__'/'constructor'/'prototype' como clave en payload.propiedades (AgregarComponente, bolsa abierta) como dato ORDINARIO — JSON puro via JSON.parse, prototipo intacto, valor preservado (hallazgo externo RX3-01, fix de raiz)", () => {
  for (const clave of ["__proto__", "constructor", "prototype"]) {
    const p = proyectoBase()
    const payload = JSON.parse(`{"tipo":"led","propiedades":{"color":"rojo",${JSON.stringify(clave)}:{"pwned":true,"secreto":"dato-normal"}}}`)
    assert.ok(Object.prototype.hasOwnProperty.call(payload.propiedades, clave), `control: JSON.parse produce "${clave}" como OWN key`)
    const r = aplicarOperacion(p, nuevaOperacion("AgregarComponente", payload), catalogo)
    assert.notEqual(r.proyecto, p, `clave "${clave}": una operacion ACEPTADA siempre devuelve un proyecto NUEVO`)
    assert.equal(r.motivos.filter((m) => m.clasificacion === "rechazo").length, 0, `clave "${clave}": no debe haber ningun motivo de rechazo: ${JSON.stringify(r.motivos)}`)
    const propiedades = r.proyecto.componentes[0].propiedades
    assert.equal(Object.getPrototypeOf(propiedades), Object.prototype, `clave "${clave}": el prototipo de propiedades nunca cambia`)
    assert.deepEqual(propiedades[clave], { pwned: true, secreto: "dato-normal" }, `clave "${clave}": el dato debe preservarse EXACTO, nunca perderse en silencio`)
    assert.equal(propiedades.color, "rojo")
  }
})

// No-regresión: un string VACÍO DENTRO de `payload` (no en el sobre) nunca es "forma
// inválida" — sigue siendo el mismo REFERENCIA_INEXISTENTE de siempre (mismo criterio
// que ya fija tests/nucleo-adversarial.test.mjs contra el motor real, acá fijado
// directo contra `aplicarOperacion`).
test("un string vacio DENTRO de payload no es forma invalida — sigue siendo REFERENCIA_INEXISTENTE, no PAYLOAD_OPERACION_INVALIDO (no regresion, E2-02)", () => {
  const p = proyectoBase()
  const r = aplicarOperacion(p, nuevaOperacion("QuitarComponente", { componente: "" }), catalogo)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_INEXISTENTE")
})
