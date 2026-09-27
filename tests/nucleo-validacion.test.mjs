// Gate 4 — validación + readiness + frontera con lint pedagógico.
//
// Capas separadas por categoría (T_diseno_consolidado.md §6): `validar-estructural.ts`
// (nivel 2, referencial, sin catálogo), `validar-tecnico.ts` (niveles 3-4, con
// catálogo), `validar.ts` (agregador + `derivarReadiness`), `lint-pedagogico.ts`
// (paralelo, nunca `blocking`, nunca gatea un commit).
//
// Los fixtures de proyecto se arman con `crearProyecto()` (Gate 2) + spread — no hace
// falta pasar por `cargarProyecto()` para estos tests: `validar-*` son funciones puras
// sobre CUALQUIER `Proyecto` bien formado, valga o no la pena, no sólo sobre uno recién
// cargado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarEstructural } = await import(join(REPO, "opencode/nucleo/validar-estructural.ts"))
const { validarTecnico } = await import(join(REPO, "opencode/nucleo/validar-tecnico.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { lintPedagogico } = await import(join(REPO, "opencode/nucleo/lint-pedagogico.ts"))
const { construirCatalogoMinimoReal, sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, LED, RESISTENCIA, PULSADOR, DHT22, NTC } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

const catalogo = construirCatalogoMinimoReal()

function proyectoBase() {
  return crearProyecto({
    generadorId: () => "proy-test",
    ahora: () => "2026-01-01T00:00:00.000Z",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
  })
}

function conLed(proyecto, { id = "cmp-0", pin = "GPIO23" } = {}) {
  // El terminal "catodo" es riel-fijo (va directo a GND, Gate 3): no se registra en
  // `pines` — sólo se registran los terminales que SÍ ocupan un pin de la placa. Si
  // se registrara como `null`, `detectarIncompleto` (validar.ts) lo leería como "falta
  // asignar", que es un falso incompleto (nunca hay nada que asignarle a un riel-fijo).
  return { ...proyecto, placa: "esp32-devkit-v1", componentes: [...proyecto.componentes, { id, tipo: "led", pines: { anodo: pin }, propiedades: {} }] }
}

function conResistencia(proyecto, { id = "cmp-1" } = {}) {
  return { ...proyecto, componentes: [...proyecto.componentes, { id, tipo: "resistencia", pines: {}, propiedades: {} }] }
}

function conConexion(proyecto, { id = "conn-0", desdeCmp, desdeTerm, hastaCmp, hastaTerm }) {
  return { ...proyecto, conexiones: [...proyecto.conexiones, { id, desde: { componente: desdeCmp, terminal: desdeTerm }, hasta: { componente: hastaCmp, terminal: hastaTerm } }] }
}

// ─────────────────────────── proyecto "sano" completo, reusado por varios tests ──────

function proyectoCompletoYValido() {
  let p = proyectoBase()
  p = conLed(p, { id: "cmp-0", pin: "GPIO23" })
  p = conResistencia(p, { id: "cmp-1" })
  p = conConexion(p, { id: "conn-0", desdeCmp: "cmp-0", desdeTerm: "anodo", hastaCmp: "cmp-1", hastaTerm: "a" })
  // el cátodo va a GND (riel-fijo, no ocupa pin) — lo dejamos null a propósito porque
  // `pines.catodo` de un terminal riel-fijo no necesita valor: derivarReadiness sólo
  // mira terminales que SÍ ocupan pin (ver conLed/conResistencia arriba, catodo:null).
  return p
}

// ───────────────────────────────── 1. pin-compatible-sin-blocking ─────────────────────

test("pin-compatible-sin-blocking", () => {
  const p = proyectoCompletoYValido()
  const motivos = validarTecnico(p, catalogo)
  assert.ok(
    motivos.every((m) => m.severidad !== "blocking"),
    `no debería haber blocking: ${JSON.stringify(motivos)}`,
  )
})

// ─────────────────────────── 2. PIN_OCUPADO representable, Camino A ──────────────────

test("pin-ocupado-representable-camino-a", () => {
  let p = proyectoCompletoYValido()
  // Un segundo LED al MISMO GPIO23 ya ocupado — la operación (en Gate 5) commitea
  // igual; acá sólo probamos que validarTecnico lo detecta.
  p = conLed(p, { id: "cmp-2", pin: "GPIO23" })
  const motivos = validarTecnico(p, catalogo)
  const pinOcupado = motivos.find((m) => m.codigo === "PIN_OCUPADO")
  assert.ok(pinOcupado, `debe aparecer PIN_OCUPADO: ${JSON.stringify(motivos)}`)
  assert.equal(pinOcupado.severidad, "blocking")
  assert.equal(pinOcupado.clasificacion, "representable")
  // Camino A: los tres componentes SIGUEN existiendo, nada se borra (led+resistencia
  // del fixture base + el segundo led en conflicto).
  assert.equal(p.componentes.length, 3)
})

// ─────────────────────── 3. catalogo-tipo-desconocido-representable ──────────────────

test("catalogo-tipo-desconocido-representable", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1", componentes: [{ id: "cmp-0", tipo: "tipo-que-el-catalogo-ya-no-reconoce", pines: {}, propiedades: {} }] }
  const motivos = validarTecnico(p, catalogo)
  const desconocido = motivos.find((m) => m.codigo === "CATALOGO_COMPONENTE_DESCONOCIDO")
  assert.ok(desconocido)
  assert.equal(desconocido.severidad, "blocking")
  assert.equal(desconocido.clasificacion, "representable")
  assert.equal(p.componentes.length, 1, "el componente NO se borra")
})

// ─────────────────────── 4. placa-desconocida-en-documento-representable ─────────────

test("placa-desconocida-en-documento-representable", () => {
  const p = { ...proyectoBase(), placa: "placa-fantasma" }
  const motivos = validarTecnico(p, catalogo)
  const desconocida = motivos.find((m) => m.codigo === "PLACA_DESCONOCIDA_EN_DOCUMENTO")
  assert.ok(desconocida)
  assert.equal(desconocida.severidad, "blocking")
  assert.equal(desconocida.clasificacion, "representable")
})

// ───────────────────────── 5. referencia-inexistente (validar-estructural) ───────────

test("referencia-inexistente-en-validar-estructural", () => {
  let p = proyectoBase()
  p = conLed(p, { id: "cmp-0" })
  p = conConexion(p, { id: "conn-0", desdeCmp: "cmp-0", desdeTerm: "anodo", hastaCmp: "cmp-no-existe", hastaTerm: "a" })
  const motivos = validarEstructural(p)
  assert.equal(motivos.length, 1)
  assert.equal(motivos[0].codigo, "REFERENCIA_INEXISTENTE")
  assert.equal(motivos[0].categoria, "referencial")
})

test("validar-estructural: proyecto sano da []", () => {
  const motivos = validarEstructural(proyectoCompletoYValido())
  assert.deepEqual(motivos, [])
})

// ═══ Phase 1.1 (hallazgo externo E1-03, CRÍTICO) — DOBLE defensa: `validar-estructural.ts`
// (SIN catálogo) rechaza un `umbral.valor` no finito para CUALQUIER `Proyecto`, sin
// importar la puerta de entrada; `validar-tecnico.ts` (CON catálogo) diagnostica
// capacidad/magnitud/unidad incompatible con el catálogo VIGENTE — representable,
// nunca rechazo, nunca reescribe el comportamiento del estudiante (P8 sigue
// diferida). Antes de este fix ninguna de las dos puertas miraba
// `proyecto.comportamientos` en absoluto (validar-tecnico.ts) o el valor del umbral
// (validar-estructural.ts): un comportamiento con capacidad inexistente, magnitud/
// unidad bogus, o un umbral NaN/Infinity quedaba SIN diagnóstico, hasta `listo:true`. ═══

function conComportamiento(proyecto, { id = "beh-0", sensor, capacidad, comparador = ">", valor, unidad, magnitud, actuador }) {
  return { ...proyecto, comportamientos: [...proyecto.comportamientos, { id, cuando: { sensor, capacidad, comparador, umbral: { valor, unidad, magnitud } }, entonces: { actuador, accion: "encender" } }] }
}

test("umbral-no-finito-rechaza-en-validar-estructural (hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: Infinity, unidad: "celsius", magnitud: "temperatura", actuador: "cmp-0" })
  const motivos = validarEstructural(p)
  const motivo = motivos.find((m) => m.codigo === "UMBRAL_NO_FINITO")
  assert.ok(motivo, `debe aparecer UMBRAL_NO_FINITO: ${JSON.stringify(motivos)}`)
  assert.equal(motivo.categoria, "estructural")
  assert.equal(motivo.severidad, "blocking")
  assert.equal(motivo.clasificacion, "rechazo")
})

test("umbral-nan-rechaza-en-validar-estructural (NaN pasa typeof === 'number', hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: NaN, unidad: "celsius", magnitud: "temperatura", actuador: "cmp-0" })
  const motivos = validarEstructural(p)
  assert.ok(motivos.some((m) => m.codigo === "UMBRAL_NO_FINITO" && m.clasificacion === "rechazo"))
})

test("capacidad-inexistente-en-catalogo-representable (hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "pulsador", pines: { senal: "GPIO4" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "capacidad-que-no-existe", valor: 1, unidad: "ninguna", magnitud: "estadoBooleano", actuador: "cmp-0" })
  const motivos = validarTecnico(p, catalogo)
  const motivo = motivos.find((m) => m.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO")
  assert.ok(motivo, `debe aparecer CAPACIDAD_INEXISTENTE_EN_CATALOGO: ${JSON.stringify(motivos)}`)
  assert.equal(motivo.severidad, "blocking")
  assert.equal(motivo.clasificacion, "representable")
  assert.equal(p.comportamientos.length, 1, "el comportamiento NO se borra")
})

test("sensor-sin-la-capacidad-requerida-representable (hallazgo externo E1-03)", () => {
  // El pulsador SOLO declara "estadoBooleano" (catalogo-datos.ts) — pedirle
  // "temperatura" es "sensor sin la capacidad requerida": mismo chequeo/código que
  // "capacidad inexistente" de arriba (buscar la capacidad DECLARADA por el tipo
  // real del sensor, no una lista de casos especiales por componente).
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "pulsador", pines: { senal: "GPIO4" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: 30, unidad: "celsius", magnitud: "temperatura", actuador: "cmp-0" })
  const motivos = validarTecnico(p, catalogo)
  const motivo = motivos.find((m) => m.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO")
  assert.ok(motivo, `debe aparecer CAPACIDAD_INEXISTENTE_EN_CATALOGO: ${JSON.stringify(motivos)}`)
  assert.equal(motivo.clasificacion, "representable")
})

test("umbral-magnitud-incompatible-representable (hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: 30, unidad: "celsius", magnitud: "magnitud-bogus", actuador: "cmp-0" })
  const motivos = validarTecnico(p, catalogo)
  const motivo = motivos.find((m) => m.codigo === "MAGNITUD_INCOMPATIBLE")
  assert.ok(motivo, `debe aparecer MAGNITUD_INCOMPATIBLE: ${JSON.stringify(motivos)}`)
  assert.equal(motivo.severidad, "blocking")
  assert.equal(motivo.clasificacion, "representable")
  assert.equal(p.comportamientos[0].cuando.umbral.magnitud, "magnitud-bogus", "el comportamiento NO se reescribe: sigue con el dato bogus, el motivo viaja al lado")
})

test("umbral-unidad-incompatible-representable (sin conversion declarada, hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: 30, unidad: "unidad-bogus", magnitud: "temperatura", actuador: "cmp-0" })
  const motivos = validarTecnico(p, catalogo)
  const motivo = motivos.find((m) => m.codigo === "MAGNITUD_INCOMPATIBLE")
  assert.ok(motivo, `debe aparecer MAGNITUD_INCOMPATIBLE (unidad sin conversion declarada): ${JSON.stringify(motivos)}`)
  assert.equal(motivo.clasificacion, "representable")
})

test("comportamiento-valido-bajo-un-catalogo-deja-de-serlo-bajo-otro: revalidacion diagnostica, NUNCA reescribe (hallazgo externo E1-03)", () => {
  let p = proyectoCompletoYValido()
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} }] }
  p = conComportamiento(p, { sensor: "cmp-2", capacidad: "temperatura", valor: 30, unidad: "celsius", magnitud: "temperatura", actuador: "cmp-0" })

  const motivosConCatalogoOriginal = validarTecnico(p, catalogo)
  assert.ok(
    !motivosConCatalogoOriginal.some((m) => m.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO" || m.codigo === "MAGNITUD_INCOMPATIBLE"),
    `bajo el catálogo real el comportamiento es compatible: ${JSON.stringify(motivosConCatalogoOriginal)}`,
  )

  // Catálogo "otro": el dht22 pierde la capacidad "temperatura" (renombrada) — misma
  // clase de version-skew que el resto de Gate 4 ya maneja para tipo/placa
  // (IR-SPEC.md §7), acá aplicada a comportamientos.
  const dht22Renombrado = { ...DHT22, capacidades: [{ id: "temperatura-v2", magnitud: "temperatura", unidad: "celsius" }] }
  const catalogoOtro = construirCatalogo(
    { version: "otro", componentes: [LED, RESISTENCIA, PULSADOR, dht22Renombrado, NTC], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } },
    sha256Hex,
  )
  const antes = p.comportamientos[0]
  const motivosConCatalogoOtro = validarTecnico(p, catalogoOtro)
  const motivo = motivosConCatalogoOtro.find((m) => m.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO")
  assert.ok(motivo, `la revalidación con OTRO catálogo debe diagnosticar: ${JSON.stringify(motivosConCatalogoOtro)}`)
  assert.equal(motivo.clasificacion, "representable")
  assert.equal(p.comportamientos[0], antes, "el comportamiento NO se reescribe: sigue siendo la MISMA referencia, pidiendo la capacidad vieja")
})

// ───────────────────────── 6. incompleto + invalido simultáneos ─────────────────────

test("incompleto-e-invalido-simultaneos", () => {
  // incompleto: placa null. invalido: dos componentes con el mismo pin (PIN_OCUPADO).
  let p = proyectoBase() // placa: null → incompleto
  p = { ...p, placa: "esp32-devkit-v1" } // hace falta placa para poder chequear PIN_OCUPADO
  p = conLed(p, { id: "cmp-0", pin: "GPIO23" })
  p = conLed(p, { id: "cmp-1", pin: "GPIO23" })
  // Pero queremos "incompleto" igual: un tercer LED sin pin asignado.
  p = { ...p, componentes: [...p.componentes, { id: "cmp-2", tipo: "led", pines: { anodo: null, catodo: null }, propiedades: {} }] }
  const motivos = validarProyecto(p, catalogo)
  const readiness = derivarReadiness(p, motivos)
  assert.equal(readiness.incompleto, true, "cmp-2 tiene un pin sin asignar")
  assert.equal(readiness.invalido, true, "PIN_OCUPADO entre cmp-0/cmp-1")
  assert.equal(readiness.listo, false)
})

// ───────────────────────── 7. ready sólo cuando ninguno aplica ───────────────────────

test("ready-solo-cuando-ninguno-aplica", () => {
  const pSano = proyectoCompletoYValido()
  const motivosSano = validarProyecto(pSano, catalogo)
  const readinessSano = derivarReadiness(pSano, motivosSano)
  assert.deepEqual(readinessSano, { incompleto: false, invalido: false, listo: true })

  const pIncompleto = proyectoBase() // placa null, sin componentes
  const readinessIncompleto = derivarReadiness(pIncompleto, validarProyecto(pIncompleto, catalogo))
  assert.equal(readinessIncompleto.incompleto, true)
  assert.equal(readinessIncompleto.listo, false)

  let pInvalido = proyectoCompletoYValido()
  pInvalido = conLed(pInvalido, { id: "cmp-2", pin: "GPIO23" }) // PIN_OCUPADO, pero completo
  const readinessInvalido = derivarReadiness(pInvalido, validarProyecto(pInvalido, catalogo))
  assert.equal(readinessInvalido.invalido, true)
  assert.equal(readinessInvalido.listo, false)
})

// ─────────────── 8. revalidación no reescribe elección válida, es idempotente ────────

test("revalidacion-no-reescribe-eleccion-valida-e-idempotente", () => {
  // GPIO16 NO está en el pool automático (circuito.ts lo saltea a propósito, Gate 1)
  // pero es una asignación MANUAL válida — exactamente el caso "elección no-default
  // del alumno" que una revalidación no tiene por qué "corregir".
  let p = proyectoBase()
  p = conLed(p, { id: "cmp-0", pin: "GPIO16" })
  p = conResistencia(p, { id: "cmp-1" })
  p = conConexion(p, { id: "conn-0", desdeCmp: "cmp-0", desdeTerm: "anodo", hastaCmp: "cmp-1", hastaTerm: "a" })

  const motivos1 = validarProyecto(p, catalogo)
  const motivos2 = validarProyecto(p, catalogo)
  assert.deepEqual(motivos1, motivos2, "revalidar debe dar EXACTAMENTE el mismo resultado (idempotente)")
  assert.equal(p.componentes[0].pines.anodo, "GPIO16", "la elección del alumno no se reescribe: sigue en GPIO16, no en un pin del pool automático")
})

// ───────────────────────────── 9. lint pedagógico nunca bloquea ──────────────────────

test("lint-pedagogico-nunca-produce-blocking", () => {
  const motivos = lintPedagogico(proyectoCompletoYValido(), catalogo)
  assert.ok(motivos.every((m) => m.severidad !== "blocking"))
  // Fase 1: passthrough vacío, documentado en el propio módulo — el invariante
  // ("nunca blocking") es lo que este test fija, no el contenido todavía.
  assert.deepEqual(motivos, [])
})

// ───────────────────────────── 10. orden de motivos determinista ────────────────────

test("orden-de-motivos-determinista", () => {
  // Combina un motivo "referencial" (validar-estructural) con uno "tecnica"
  // (validar-tecnico) en el MISMO proyecto, para probar que el agregador respeta
  // ORDEN_CATEGORIAS (estructural/referencial antes que tecnica).
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1", componentes: [{ id: "cmp-0", tipo: "tipo-desconocido", pines: {}, propiedades: {} }] }
  p = conConexion(p, { id: "conn-0", desdeCmp: "cmp-0", desdeTerm: "x", hastaCmp: "cmp-no-existe", hastaTerm: "y" })

  const motivos1 = validarProyecto(p, catalogo)
  const motivos2 = validarProyecto(p, catalogo)
  assert.deepEqual(motivos1, motivos2, "el orden tiene que ser el MISMO entre corridas")

  const idxReferencial = motivos1.findIndex((m) => m.categoria === "referencial")
  const idxTecnica = motivos1.findIndex((m) => m.categoria === "tecnica")
  assert.ok(idxReferencial !== -1 && idxTecnica !== -1, "el fixture debe producir ambas categorías")
  assert.ok(idxReferencial < idxTecnica, "referencial va antes que tecnica (ORDEN_CATEGORIAS)")
})
