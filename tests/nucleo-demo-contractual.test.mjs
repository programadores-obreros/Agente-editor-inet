// Demo contractual — ESP32 + LED, Gate 8. Ver T_diseno_consolidado.md §8 (forma
// pedida por el orquestador: 6 casos).
//
// Recorre el stack COMPLETO (cargador → operaciones → motor → almacén) contra un
// directorio real en disco (os.tmpdir()), no un almacén falso — es la única prueba
// de integración de Fase 1: todo lo demás en tests/nucleo-*.test.mjs prueba un
// módulo aislado.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { rmSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIR = join(os.tmpdir(), "tecniabot-test-nucleo-demo-contractual")

const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

const catalogo = construirCatalogoMinimoReal()

before(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
})

let contadorId = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `op-${contadorId++}`, actor: "agente", baseRevision, tipo, payload }
}

function readiness(proyecto) {
  return derivarReadiness(proyecto, validarProyecto(proyecto, catalogo))
}

// Un solo proyecto recorre los 6 casos EN ORDEN (cada caso parte de donde dejó el
// anterior, igual que el demo contractual del diseño consolidado lo describe).
const proyectoInicial = crearProyecto({ generadorId: () => "demo-esp32-led", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
const almacen = crearAlmacen({ directorio: DIR, catalogo })
const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })

// ──────────────────── 1. Incompleto: se persiste y se recupera igual ────────────────

test("1. incompleto: crear + SetPlaca + AgregarComponente(led) sin conectar -> persiste y recarga igual", () => {
  const r1 = motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r1.ok, true)
  const r2 = motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  assert.equal(r2.ok, true)
  assert.equal(motor.getProyecto().componentes[0].id, "cmp-0")

  const ready = readiness(motor.getProyecto())
  assert.equal(ready.incompleto, true, "el LED todavía no tiene el ánodo asignado")
  assert.equal(ready.listo, false)

  // Cerrar y volver a abrir: un almacén NUEVO, apuntando al mismo directorio.
  const almacenReabierto = crearAlmacen({ directorio: DIR, catalogo })
  const recargado = almacenReabierto.cargar(motor.getProyecto().id)
  assert.equal(recargado.ok, true)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "recupera EXACTAMENTE el incompleto")
  assert.equal(readiness(recargado.proyecto).incompleto, true)
})

// ─────────────────────── 2. Completo: asignar pin + resistencia + conectar -> ready ──

test("2. completo: asignar GPIO23 + agregar resistencia + conectar -> listo:true", () => {
  const revision = motor.getProyecto().revision
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, revision))
  motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  const rConectar = motor.aplicar(op("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }, motor.getProyecto().revision))
  assert.equal(rConectar.ok, true)

  const ready = readiness(motor.getProyecto())
  assert.deepEqual(ready, { incompleto: false, invalido: false, listo: true }, `debería estar listo: ${JSON.stringify(ready)}`)

  const almacenReabierto = crearAlmacen({ directorio: DIR, catalogo })
  const recargado = almacenReabierto.cargar(motor.getProyecto().id)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()))
  assert.deepEqual(readiness(recargado.proyecto), { incompleto: false, invalido: false, listo: true })
})

// ──────────── 3. Error representable: segundo LED al mismo GPIO23 ya ocupado ────────

// El id local (`cmp-<n>`) sale de UN contador compartido con conexiones/
// comportamientos (Gate 2, id.ts) — no es predecible a mano contando sólo
// AgregarComponente (el Conectar del caso 2 también consumió un número para
// "conn-0"). Se captura el id real comparando antes/después, en vez de
// hardcodearlo — más robusto y más honesto sobre cómo funciona el contador.
let idSegundoLed

test("3. error representable: segundo LED al GPIO23 ocupado -> commitea, blocking, invalido, persistido", () => {
  const revisionAntes = motor.getProyecto().revision
  const idsAntes = motor.getProyecto().componentes.map((c) => c.id)
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  idSegundoLed = motor.getProyecto().componentes.find((c) => !idsAntes.includes(c.id)).id

  const r = motor.aplicar(op("AsignarPin", { componente: idSegundoLed, terminal: "anodo", pin: "GPIO23" }, motor.getProyecto().revision))
  assert.equal(r.ok, true, "PIN_OCUPADO es representable: la operación COMMITEA")
  assert.ok(r.motivos.some((m) => m.codigo === "PIN_OCUPADO" && m.severidad === "blocking"))
  assert.ok(motor.getProyecto().revision > revisionAntes, "la revisión avanzó pese a quedar inválido")

  const ready = readiness(motor.getProyecto())
  assert.equal(ready.invalido, true)
  assert.equal(ready.listo, false)

  const almacenReabierto = crearAlmacen({ directorio: DIR, catalogo })
  const recargado = almacenReabierto.cargar(motor.getProyecto().id)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "el estado inválido TAMBIÉN se persiste — un proyecto inválido sigue siendo guardable")
})

// ───────────────────────────── 4. Corregido: listo de nuevo ──────────────────────────

test("4. corregido: reasignar a un pin libre + resolver el requisito del segundo LED -> listo:true de nuevo", () => {
  const revision = motor.getProyecto().revision
  const idsAntes = motor.getProyecto().componentes.map((c) => c.id)
  const r1 = motor.aplicarTransaccion([op("AsignarPin", { componente: idSegundoLed, terminal: "anodo", pin: "GPIO25" }, revision), op("AgregarComponente", { tipo: "resistencia" }, revision)])
  assert.equal(r1.ok, true)
  const idResistenciaNueva = motor.getProyecto().componentes.find((c) => !idsAntes.includes(c.id) && c.tipo === "resistencia").id

  const r2 = motor.aplicar(op("Conectar", { desde: { componente: idSegundoLed, terminal: "anodo" }, hasta: { componente: idResistenciaNueva, terminal: "a" } }, motor.getProyecto().revision))
  assert.equal(r2.ok, true)
  assert.ok(!r2.motivos.some((m) => m.codigo === "PIN_OCUPADO"), "PIN_OCUPADO desaparece de los motivos activos")

  const ready = readiness(motor.getProyecto())
  assert.deepEqual(ready, { incompleto: false, invalido: false, listo: true }, `debería volver a estar listo: ${JSON.stringify(ready)}`)
})

// ───────────────────────── 5. Revisión obsoleta: rechazo explícito ───────────────────

test("5. revision obsoleta: operacion con baseRevision vieja rechaza, revision no cambia", () => {
  const canonicoAntes = motor.getProyecto()
  const revisionVieja = canonicoAntes.revision - 2 // la de ANTES del caso 4
  const r = motor.aplicar(op("AgregarComponente", { tipo: "pulsador" }, revisionVieja))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(motor.getProyecto(), canonicoAntes, "sin sobrescritura silenciosa: el canónico es la MISMA referencia")
})

// ──────────── 6. Transacción rechazada: sin cambios parciales, ni en disco ───────────

test("6. transaccion rechazada (2da operacion referencia un componente inexistente) -> lote entero descartado, disco identico", () => {
  const canonicoAntes = motor.getProyecto()
  const almacenLectura = crearAlmacen({ directorio: DIR, catalogo })
  const discoAntes = canonicalizar(almacenLectura.cargar(canonicoAntes.id).proyecto)

  const revision = canonicoAntes.revision
  const r = motor.aplicarTransaccion([op("AgregarComponente", { tipo: "pulsador" }, revision), op("QuitarComponente", { componente: "cmp-no-existe" }, revision), op("AgregarComponente", { tipo: "dht22" }, revision)])
  assert.equal(r.ok, false)
  assert.equal(motor.getProyecto(), canonicoAntes, "la IR persistida NO queda a mitad de mutación")

  const discoDespues = canonicalizar(crearAlmacen({ directorio: DIR, catalogo }).cargar(canonicoAntes.id).proyecto)
  assert.equal(discoDespues, discoAntes, "el disco tampoco cambió: el lote rechazado nunca llegó a persistir")
})
