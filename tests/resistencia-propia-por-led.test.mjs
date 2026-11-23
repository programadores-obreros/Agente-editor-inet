// Cada LED lleva SU resistencia: compartida o puenteada no cuenta.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El requisito «resistencia en serie» del LED se daba
// por cumplido con que hubiera CUALQUIER resistencia conectada al ánodo. La auditoría
// de código del 2026-11-22 (NUC-03, reproducido por QA) armó cuatro proyectos que
// quedaban «listo» y generaban programa:
//
//   - una sola resistencia con una pata en el ánodo de un LED y la otra en el de otro;
//   - la misma pata de una resistencia en los ánodos de dos LEDs;
//   - una resistencia con las dos patas en el mismo ánodo (no limita nada);
//   - una resistencia con sus dos patas unidas entre sí.
//
// Un LED sin su resistencia se quema o daña el pin. El 2026-11-23 el owner decidió
// que el núcleo exija una resistencia en serie POR LED para dar «listo».
//
// CÓMO SE MODELA «EN SERIE» ACÁ. En la IR la resistencia va «en el medio del cable»:
// el pin se asigna al ánodo del LED y la resistencia se conecta a ese ánodo. No hay
// un segundo extremo que mirar. Por eso la regla es sobre la PIEZA: una resistencia
// cumple el requisito de un LED si está conectada a su ánodo, no está conectada al
// ánodo de otro LED, y no está puenteada.
//
// QUÉ NO PRUEBA, a propósito:
//   - el VALOR de la resistencia. El catálogo pide 220 ohm, pero la IR no tiene un
//     campo declarado para el valor de una pieza (`propiedades` es una bolsa libre),
//     así que no hay qué comparar. El owner decidió que el valor avise y no bloquee;
//     ese aviso NO está hecho.
//   - adónde va el otro extremo de la resistencia si alguien lo conecta a otra pieza
//     (un pulsador, un sensor). Eso es `validarConexion`, deuda declarada en
//     COMPONENT-CATALOG.md.
//
// MUTACIONES que ponen rojo este archivo (ver el commit):
//   - sacar la llamada a la regla nueva en validarTecnico      → rojos los de compartida y puenteada
//   - que «compartida» no mire el ánodo del otro LED           → rojos los dos de compartida
//   - que «compartida» cuente CUALQUIER terminal del otro LED  → rojo «sólo por el terminal que pide»
//   - que la regla no excluya al propio LED                    → rojos los controles
//   - que «puenteada» no mire las dos patas en el mismo ánodo  → rojo ese caso
//   - que «puenteada» no mire la conexión entre sus patas      → rojo ese caso
//   - exigir que TODAS las resistencias del LED sean propias   → rojo «una propia alcanza»
//   - emitir el motivo aunque no haya ninguna resistencia      → rojo «sin resistencia: un solo motivo»
//   - `severidad: "warning"` en vez de `"blocking"`            → rojos los que miran `listo`
//
// Corre con: node --test tests/resistencia-propia-por-led.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))

const catalogo = construirCatalogoMinimoReal()
let n = 0

/** Un proyecto en disco propio, con ESP32. Devuelve ayudas para armar el circuito. */
function proyectoNuevo() {
  const directorio = mkdtempSync(join(os.tmpdir(), "tecniabot-resistencia-propia-"))
  const proyectoInicial = crearProyecto({ generadorId: () => `resistencia-propia-${n++}`, ahora: () => "2026-11-23T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacen({ directorio, catalogo }) })
  const aplicar = (tipo, payload) => {
    const r = motor.aplicar({ idOperacion: `op-${n++}`, actor: "agente", baseRevision: motor.getProyecto().revision, tipo, payload })
    assert.equal(r.ok, true, `${tipo} ${JSON.stringify(payload)} fue rechazada: ${JSON.stringify(r.motivos ?? r)}`)
  }
  aplicar("SetPlaca", { placa: "esp32-devkit-v1" })
  const agregar = (tipo) => {
    const antes = new Set(motor.getProyecto().componentes.map((c) => c.id))
    aplicar("AgregarComponente", { tipo })
    return motor.getProyecto().componentes.find((c) => !antes.has(c.id)).id
  }
  return {
    motor,
    led: (pin) => {
      const id = agregar("led")
      aplicar("AsignarPin", { componente: id, terminal: "anodo", pin })
      return id
    },
    resistencia: () => agregar("resistencia"),
    conectar: (a, terminalA, b, terminalB) => aplicar("Conectar", { desde: { componente: a, terminal: terminalA }, hasta: { componente: b, terminal: terminalB } }),
    motivos: () => validarProyecto(motor.getProyecto(), catalogo),
    listo: () => derivarReadiness(motor.getProyecto(), validarProyecto(motor.getProyecto(), catalogo)).listo,
  }
}

const deRequisito = (motivos, componente) => motivos.filter((m) => m.codigo === "REQUISITO_INSATISFECHO" && m.entidad?.id === componente)

test("control: un LED con su propia resistencia queda listo, sin motivos de requisito", () => {
  const p = proyectoNuevo()
  const led = p.led("GPIO23")
  p.conectar(led, "anodo", p.resistencia(), "a")
  assert.deepEqual(deRequisito(p.motivos(), led), [])
  assert.equal(p.listo(), true)
})

test("control: dos LEDs, cada uno con la suya, quedan listos", () => {
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  p.conectar(led1, "anodo", p.resistencia(), "a")
  p.conectar(led2, "anodo", p.resistencia(), "b")
  assert.deepEqual(p.motivos().filter((m) => m.codigo === "REQUISITO_INSATISFECHO"), [])
  assert.equal(p.listo(), true)
})

test("una resistencia con una pata en cada LED: ninguno de los dos queda listo", () => {
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  const r = p.resistencia()
  p.conectar(led1, "anodo", r, "a")
  p.conectar(led2, "anodo", r, "b")
  for (const [led, otro] of [[led1, led2], [led2, led1]]) {
    const m = deRequisito(p.motivos(), led)
    assert.equal(m.length, 1, `esperaba un motivo para ${led}: ${JSON.stringify(m)}`)
    assert.equal(m[0].severidad, "blocking")
    assert.equal(m[0].datos.causa, "compartida")
    assert.equal(m[0].datos.pieza, r)
    assert.equal(m[0].datos.compartidaCon, otro)
    // Los campos de siempre siguen estando: los leen la vista y la tool.
    assert.equal(m[0].datos.componente, "led")
    assert.equal(m[0].datos.requisito, "resistencia-serie")
    assert.equal(m[0].datos.terminal, "anodo")
  }
  assert.equal(p.listo(), false)
})

test("la MISMA pata de una resistencia en dos LEDs: tampoco", () => {
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  const r = p.resistencia()
  p.conectar(led1, "anodo", r, "a")
  p.conectar(led2, "anodo", r, "a")
  assert.equal(deRequisito(p.motivos(), led1)[0]?.datos.causa, "compartida")
  assert.equal(deRequisito(p.motivos(), led2)[0]?.datos.causa, "compartida")
  assert.equal(p.listo(), false)
})

test("una resistencia con las dos patas en el mismo ánodo no limita nada: no cuenta", () => {
  const p = proyectoNuevo()
  const led = p.led("GPIO23")
  const r = p.resistencia()
  p.conectar(led, "anodo", r, "a")
  p.conectar(led, "anodo", r, "b")
  const m = deRequisito(p.motivos(), led)
  assert.equal(m.length, 1, JSON.stringify(m))
  assert.equal(m[0].datos.causa, "puenteada")
  assert.equal(m[0].datos.pieza, r)
  assert.equal(p.listo(), false)
})

test("una resistencia con sus dos patas unidas entre sí: no cuenta", () => {
  const p = proyectoNuevo()
  const led = p.led("GPIO23")
  const r = p.resistencia()
  p.conectar(led, "anodo", r, "a")
  p.conectar(r, "a", r, "b")
  assert.equal(deRequisito(p.motivos(), led)[0]?.datos.causa, "puenteada")
  assert.equal(p.listo(), false)
})

test("una propia alcanza: el LED que además toca una compartida queda bien, el otro no", () => {
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  const compartida = p.resistencia()
  p.conectar(led1, "anodo", compartida, "a")
  p.conectar(led2, "anodo", compartida, "b")
  p.conectar(led1, "anodo", p.resistencia(), "a")
  assert.deepEqual(deRequisito(p.motivos(), led1), [], "led1 tiene una resistencia que es sólo suya")
  assert.equal(deRequisito(p.motivos(), led2).length, 1)
  assert.equal(p.listo(), false)
})

test("«compartida» es sólo por el terminal que PIDE la resistencia, no por cualquier otro", () => {
  // La otra pata de la resistencia toca el cátodo de otro LED, que no pide nada ahí.
  // Es un cableado raro, pero la resistencia sigue siendo de un solo LED: decir
  // «compartida» sería un motivo falso. (Si ese cableado tiene sentido eléctrico es
  // asunto de validarConexion, que hoy no existe.)
  // Mi primera versión no tenía este caso, y sacar `r.enTerminal === alla.terminal`
  // de la regla dejaba todo en verde.
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  const r = p.resistencia()
  p.conectar(led1, "anodo", r, "a")
  p.conectar(led2, "catodo", r, "b")
  p.conectar(led2, "anodo", p.resistencia(), "a")
  assert.deepEqual(p.motivos().filter((m) => m.codigo === "REQUISITO_INSATISFECHO"), [])
})

test("sin resistencia: un solo motivo, el de siempre, sin causa", () => {
  // La regla nueva no puede sumar un segundo motivo a un LED que no tiene ninguna
  // resistencia: ese caso ya lo dice evaluarRequisito.
  const p = proyectoNuevo()
  const led = p.led("GPIO23")
  const m = deRequisito(p.motivos(), led)
  assert.equal(m.length, 1, JSON.stringify(m))
  assert.equal(m[0].datos.causa, undefined)
  assert.equal(p.listo(), false)
})

test("la misma conexión repetida no es un puente", () => {
  // Dos veces la misma pata al mismo ánodo es un cable de más, no un corto.
  const p = proyectoNuevo()
  const led = p.led("GPIO23")
  const r = p.resistencia()
  p.conectar(led, "anodo", r, "a")
  const repetida = p.motor.aplicar({ idOperacion: `op-${n++}`, actor: "agente", baseRevision: p.motor.getProyecto().revision, tipo: "Conectar", payload: { desde: { componente: r, terminal: "a" }, hasta: { componente: led, terminal: "anodo" } } })
  // Si el motor la rechaza por duplicada, mejor; si la acepta, no puede volver «no listo».
  assert.deepEqual(deRequisito(p.motivos(), led), [], `repetida.ok=${repetida.ok}`)
  assert.equal(p.listo(), true)
})

test("lo que lee el alumno dice qué pasa y nombra a la otra pieza, sin ids crudos", () => {
  const p = proyectoNuevo()
  const led1 = p.led("GPIO23")
  const led2 = p.led("GPIO22")
  const r = p.resistencia()
  p.conectar(led1, "anodo", r, "a")
  p.conectar(led2, "anodo", r, "b")
  const vista = proyectarVista(p.motor.getProyecto(), catalogo)
  const textos = vista.motivos.filter((m) => m.codigo === "REQUISITO_INSATISFECHO").map((m) => m.explicacion)
  assert.equal(textos.length, 2)
  for (const t of textos) {
    assert.match(t, /su propia resistencia/i, t)
    assert.match(t, /compart/i, t)
    assert.doesNotMatch(t, /cmp-\d|resistencia-serie|compartidaCon|causa/, `el texto muestra un dato interno: ${t}`)
  }

  const q = proyectoNuevo()
  const led = q.led("GPIO23")
  const rq = q.resistencia()
  q.conectar(led, "anodo", rq, "a")
  q.conectar(led, "anodo", rq, "b")
  const texto = proyectarVista(q.motor.getProyecto(), catalogo).motivos.find((m) => m.codigo === "REQUISITO_INSATISFECHO").explicacion
  assert.match(texto, /dos patas/i, texto)
  assert.doesNotMatch(texto, /cmp-\d|resistencia-serie|causa/, texto)
})
