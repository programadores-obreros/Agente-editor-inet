// Phase 1.2 — invariante PERSISTIBLE ⇒ RECARGABLE (hallazgo externo REA-01, CRÍTICO
// — re-auditoría externa, PHASE_1_1_REGAUDIT_FINDINGS.md).
//
// Recorre el stack COMPLETO (cargador → operaciones → motor → almacén) contra un
// Almacen REAL (fs real de node:fs, nunca el falso en memoria de los tests
// unitarios de motor.ts/operaciones.ts) — mismo criterio que
// `nucleo-demo-contractual.test.mjs` (la única otra prueba de integración de
// Fase 1). Ver IR-SPEC.md §6.11 y OPERATIONS.md §11 para el contrato completo.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { rmSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIR_BASE = join(os.tmpdir(), "tecniabot-test-nucleo-persistible-recargable")

const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto, cargarProyecto, SCHEMA_VERSION_SOPORTADA } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPARADORES, ACCIONES } = await import(join(REPO, "opencode/nucleo/ir.ts"))

const catalogo = construirCatalogoMinimoReal()

before(() => {
  rmSync(DIR_BASE, { recursive: true, force: true })
  mkdirSync(DIR_BASE, { recursive: true })
})

let contadorOp = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload }
}

function readiness(proyecto) {
  return derivarReadiness(proyecto, validarProyecto(proyecto, catalogo))
}

function nuevoDir(nombre) {
  const dir = join(DIR_BASE, nombre)
  mkdirSync(dir, { recursive: true })
  return dir
}

function crearMotorReal(dir, id) {
  const proyectoInicial = crearProyecto({ generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacen({ directorio: dir, catalogo })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
  return { motor, almacen }
}

function recargar(dir, id) {
  return crearAlmacen({ directorio: dir, catalogo }).cargar(id)
}

// ════════════════════════════════════════════════════════════════════════════════════
// T5 — round-trip con el Almacén REAL: operación aceptada → commit → persistencia →
// load → canónico equivalente.
// ════════════════════════════════════════════════════════════════════════════════════

test("round-trip 1: SetComportamiento VALIDO -> commit -> persiste -> recarga -> canonico equivalente", () => {
  const dir = nuevoDir("caso1-setcomportamiento-valido")
  const { motor } = crearMotorReal(dir, "rt1-setcomportamiento")
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  const r = motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }, motor.getProyecto().revision))
  assert.equal(r.ok, true)
  assert.equal(motor.getProyecto().comportamientos[0].cuando.comparador, ">")

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true, `debe recargar sin problema: ${JSON.stringify(recargado.ok ? [] : recargado.motivos)}`)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "canonico equivalente tras el round-trip")
})

test("round-trip 2: LOTE valido (aplicarTransaccion multi-operacion) -> commit -> persiste -> recarga -> canonico equivalente", () => {
  const dir = nuevoDir("caso2-lote-valido")
  const { motor } = crearMotorReal(dir, "rt2-lote")
  const r = motor.aplicarTransaccion([op("SetPlaca", { placa: "esp32-devkit-v1" }, 0), op("AgregarComponente", { tipo: "led" }, 0), op("AgregarComponente", { tipo: "resistencia" }, 0)])
  assert.equal(r.ok, true)
  const rConectar = motor.aplicar(op("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }, motor.getProyecto().revision))
  assert.equal(rConectar.ok, true)

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "canonico equivalente tras el round-trip")
})

test("round-trip 3: error representable (PIN_OCUPADO, Path A) -> COMMITEA -> blocking -> persistido -> recarga -> canonico equivalente, motivo se re-diagnostica", () => {
  const dir = nuevoDir("caso3-pin-ocupado-path-a")
  const { motor } = crearMotorReal(dir, "rt3-pinocupado")
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  const revisionAntes = motor.getProyecto().revision
  const r = motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }, motor.getProyecto().revision))
  assert.equal(r.ok, true, "PIN_OCUPADO es representable: la operación COMMITEA (Path A)")
  assert.ok(r.motivos.some((m) => m.codigo === "PIN_OCUPADO" && m.severidad === "blocking" && m.clasificacion === "representable"))
  assert.ok(motor.getProyecto().revision > revisionAntes, "la revisión avanzó pese a quedar inválido")
  assert.equal(readiness(motor.getProyecto()).listo, false)

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true, "un estado con blocking representable SIGUE siendo persistible/recargable")
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "canonico equivalente tras el round-trip")
  assert.ok(
    validarProyecto(recargado.proyecto, catalogo).some((m) => m.codigo === "PIN_OCUPADO"),
    "el PIN_OCUPADO se re-diagnostica al revalidar el proyecto recargado — nunca se pierde",
  )
})

test("round-trip 4: proyecto INCOMPLETO (sin placa, componente sin conexion, pin null) -> persiste -> recarga -> canonico equivalente", () => {
  const dir = nuevoDir("caso4-incompleto")
  const { motor } = crearMotorReal(dir, "rt4-incompleto")
  // Nunca se llama SetPlaca -> placa queda null. AgregarComponente(led) deja el pin
  // "anodo" en null (sin AsignarPin) y sin ninguna Conectar -> componente sin conexión.
  const r = motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  assert.equal(r.ok, true)
  assert.equal(motor.getProyecto().placa, null, "el schema permite placa:null — nunca se exige elegirla para persistir")
  assert.equal(motor.getProyecto().componentes[0].pines.anodo, null)
  assert.equal(motor.getProyecto().conexiones.length, 0, "componente sin ninguna conexión")
  assert.equal(readiness(motor.getProyecto()).incompleto, true)

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true, "un proyecto incompleto SIGUE siendo persistible/recargable")
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "canonico equivalente tras el round-trip")
  assert.equal(readiness(recargado.proyecto).incompleto, true)
})

// Fixture LEGACY genuino: `documentoValido()` tal como existía en
// `git show 4a0cad5:tests/nucleo-ir-cargador.test.mjs` (commit real de este mismo
// repositorio, previo a Phase 1.2 y al refactor de dominio compartido en `ir.ts`) —
// copiado literal, nunca inventado para esta tarea. Demuestra que el refactor de
// Phase 1.2 (mover COMPARADORES/ACCIONES de un Set local en cargador.ts a una
// constante compartida en ir.ts) no rompe la compatibilidad con un documento REAL
// generado por el código histórico.
function documentoLegacy4a0cad5() {
  return {
    id: "proy-legacy-4a0cad5",
    schemaVersion: SCHEMA_VERSION_SOPORTADA,
    catalogoVersion: "1.0.0",
    catalogoHash: "hash-de-prueba",
    revision: 0,
    siguienteIdLocal: 3,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} },
    ],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "senal" } }],
    comportamientos: [
      {
        id: "beh-0",
        cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } },
        entonces: { actuador: "cmp-0", accion: "encender" },
      },
    ],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
}

test("round-trip 5: fixture LEGACY genuino (git show 4a0cad5:tests/nucleo-ir-cargador.test.mjs::documentoValido) carga, opera, commitea, persiste, recarga -> canonico equivalente", () => {
  const dir = nuevoDir("caso5-legacy-4a0cad5")
  const cargaLegacy = cargarProyecto(documentoLegacy4a0cad5())
  assert.equal(cargaLegacy.ok, true, `el documento legacy sigue cargando con el codigo de Phase 1.2: ${JSON.stringify(cargaLegacy.ok ? [] : cargaLegacy.motivos)}`)
  assert.equal(cargaLegacy.proyecto.comportamientos[0].cuando.comparador, ">")

  const almacen = crearAlmacen({ directorio: dir, catalogo })
  const motor = crearMotorDeProyecto({ proyectoInicial: cargaLegacy.proyecto, catalogo, almacen })
  const r = motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  assert.equal(r.ok, true, "el motor construido sobre el proyecto legacy sigue operativo")

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()), "canonico equivalente tras el round-trip del legacy")
})

// ════════════════════════════════════════════════════════════════════════════════════
// T3 — dominio compartido: si el dominio que `cargador.ts` (loader) y `operaciones.ts`
// (Gate 5) aceptan alguna vez DIVERGIERA (dos listas separadas en vez de la MISMA
// `ir.ts::COMPARADORES`/`ACCIONES`), este test se rompe SOLO. Itera sobre la
// constante COMPARTIDA (siempre debe aceptar) y sobre valores de AFUERA del dominio
// (siempre debe rechazar) — y verifica, para cada uno, que "operación → persistir →
// recargar" acepta EXACTAMENTE el mismo conjunto que el loader acepta al cargar
// directo. Si `operaciones.ts` alguna vez aceptara un valor que `cargador.ts`
// rechaza (dominios divergentes — la clase exacta de REA-01), este test lo detecta:
// o bien el commit "acepta" algo que el reload después rechaza (PERSISTIBLE sin ser
// RECARGABLE, de nuevo), o bien el commit acepta un valor que el loader, llamado
// DIRECTO sobre el mismo documento, también rechazaría.
// ════════════════════════════════════════════════════════════════════════════════════

const VALORES_COMPARADOR_DE_AFUERA = ["mayorQue", "menorQue", "igual", "==", "", ">>", "gt"]
const VALORES_ACCION_DE_AFUERA = ["prender", "apagarr", "on", "off", "", "ENCENDER"]

function probarValorComparador(comparador, indice) {
  const dir = nuevoDir(`domcomp-comparador-${indice}`)
  const { motor } = crearMotorReal(dir, `domcomp-cmp-${indice}`)
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  const canonicoAntes = motor.getProyecto()

  const esperadoEnDominio = COMPARADORES.includes(comparador)
  const r = motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador, umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }, motor.getProyecto().revision))

  if (esperadoEnDominio) {
    assert.equal(r.ok, true, `comparador=${JSON.stringify(comparador)} está en el dominio compartido: debe commitear (${JSON.stringify(r.motivos)})`)
    const recargado = recargar(dir, motor.getProyecto().id)
    assert.equal(recargado.ok, true, `comparador=${JSON.stringify(comparador)}: lo que la operación commiteó debe seguir siendo RECARGABLE (${JSON.stringify(recargado.ok ? [] : recargado.motivos)})`)
    assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()))
  } else {
    assert.equal(r.ok, false, `comparador=${JSON.stringify(comparador)} está FUERA del dominio compartido: la operación NUNCA debe commitearlo (si commiteó, los dominios divergieron — clase REA-01)`)
    assert.equal(motor.getProyecto(), canonicoAntes, "nada cambió: el rechazo no tocó el canónico")
    // Nada nuevo que recargar (el rechazo nunca persistió) — el disco sigue
    // reflejando exactamente lo que había ANTES de este intento.
    const discoTrasIntento = recargar(dir, motor.getProyecto().id)
    assert.equal(canonicalizar(discoTrasIntento.proyecto), canonicalizar(canonicoAntes))
  }
}

function probarValorAccion(accion, indice) {
  const dir = nuevoDir(`domacc-accion-${indice}`)
  const { motor } = crearMotorReal(dir, `domacc-acc-${indice}`)
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  const canonicoAntes = motor.getProyecto()

  const esperadoEnDominio = ACCIONES.includes(accion)
  const r = motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion } } }, motor.getProyecto().revision))

  if (esperadoEnDominio) {
    assert.equal(r.ok, true, `accion=${JSON.stringify(accion)} está en el dominio compartido: debe commitear (${JSON.stringify(r.motivos)})`)
    const recargado = recargar(dir, motor.getProyecto().id)
    assert.equal(recargado.ok, true, `accion=${JSON.stringify(accion)}: lo que la operación commiteó debe seguir siendo RECARGABLE (${JSON.stringify(recargado.ok ? [] : recargado.motivos)})`)
    assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()))
  } else {
    assert.equal(r.ok, false, `accion=${JSON.stringify(accion)} está FUERA del dominio compartido: la operación NUNCA debe commitearla (si commiteó, los dominios divergieron — clase REA-01)`)
    assert.equal(motor.getProyecto(), canonicoAntes)
    const discoTrasIntento = recargar(dir, motor.getProyecto().id)
    assert.equal(canonicalizar(discoTrasIntento.proyecto), canonicalizar(canonicoAntes))
  }
}

test("T3: dominio compartido comparador — operacion->persistir->recargar acepta EXACTAMENTE el mismo conjunto que el loader (constante compartida + valores de afuera)", () => {
  const valores = [...COMPARADORES, ...VALORES_COMPARADOR_DE_AFUERA]
  valores.forEach((comparador, indice) => probarValorComparador(comparador, indice))
})

test("T3: dominio compartido accion — operacion->persistir->recargar acepta EXACTAMENTE el mismo conjunto que el loader (constante compartida + valores de afuera)", () => {
  const valores = [...ACCIONES, ...VALORES_ACCION_DE_AFUERA]
  valores.forEach((accion, indice) => probarValorAccion(accion, indice))
})

// ════════════════════════════════════════════════════════════════════════════════════
// REA-01 — regresión end-to-end contra el Almacén REAL: la secuencia completa del
// defecto original (ver evidencia/T-A2/repro_rea01_fs_real.mjs) queda cerrada.
// ════════════════════════════════════════════════════════════════════════════════════

test("REA-01: SetComportamiento con comparador fuera de dominio rechaza ANTES de persistir — canonico/revision/disco/undo intactos, y el siguiente commit valido funciona", () => {
  const dir = nuevoDir("caso-rea01-rechazo-antes-de-persistir")
  const { motor } = crearMotorReal(dir, "rea01-rechazo")
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  const canonicoAntes = motor.getProyecto()
  const bufferUndoAntes = motor.obtenerBufferUndo().length

  const r = motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: "mayorQue", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }, motor.getProyecto().revision))
  assert.equal(r.ok, false, "REA-01 queda rechazado antes de persistir")
  assert.ok(r.motivos.some((m) => m.codigo === "VALOR_ENUM_DESCONOCIDO"), `debe traer VALOR_ENUM_DESCONOCIDO: ${JSON.stringify(r.motivos)}`)
  assert.equal(motor.getProyecto(), canonicoAntes, "el canonico es la MISMA referencia: no cambio")
  assert.equal(motor.getProyecto().revision, canonicoAntes.revision, "la revision no avanza")
  assert.equal(motor.getProyecto().comportamientos.length, 0, "ningun comportamiento se creo")
  assert.equal(motor.obtenerBufferUndo().length, bufferUndoAntes, "el buffer de undo no crece con un rechazo")

  const discoTrasRechazo = recargar(dir, motor.getProyecto().id)
  assert.equal(discoTrasRechazo.ok, true, "el disco sigue siendo RECARGABLE: el rechazo nunca llegó a persistir nada roto")
  assert.equal(canonicalizar(discoTrasRechazo.proyecto), canonicalizar(canonicoAntes), "el disco tampoco cambió")
})

test("REA-01: el siguiente commit valido despues del rechazo sigue funcionando — el proyecto NUNCA queda inutilizable", () => {
  const dir = nuevoDir("caso-rea01-siguiente-commit-funciona")
  const { motor } = crearMotorReal(dir, "rea01-siguiente")
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  const rRechazo = motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: "mayorQue", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } } }, motor.getProyecto().revision))
  assert.equal(rRechazo.ok, false)

  const rSiguiente = motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  assert.equal(rSiguiente.ok, true, "el commit siguiente (normal, sin relación con el rechazo) funciona — el CAS de E3-07 puede releer el disco sin problema")

  const recargado = recargar(dir, motor.getProyecto().id)
  assert.equal(recargado.ok, true)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(motor.getProyecto()))
})

// ════════════════════════════════════════════════════════════════════════════════════
// Path B — regresión: una operación rechazada A NIVEL DE OPERACIÓN (nunca llega a
// intentar persistir) sigue comportándose igual que siempre.
// ════════════════════════════════════════════════════════════════════════════════════

test("Path B (regresion): SetPlaca con placa desconocida rechaza SIN commitear, canonico/disco intactos", () => {
  const dir = nuevoDir("caso-path-b")
  const { motor, almacen } = crearMotorReal(dir, "pathb")
  const canonicoAntes = motor.getProyecto()
  const r = motor.aplicar(op("SetPlaca", { placa: "placa-fantasma" }, motor.getProyecto().revision))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "PLACA_DESCONOCIDA"))
  assert.equal(motor.getProyecto(), canonicoAntes)
  assert.equal(almacen.existe(canonicoAntes.id), false, "un proyecto que NUNCA commiteó nada no existe en disco")
})
