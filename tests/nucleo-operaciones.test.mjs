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
