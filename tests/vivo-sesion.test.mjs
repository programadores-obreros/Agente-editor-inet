// Modo Vivo V1 — la sesión viva (`opencode/vivo/sesion-viva.ts` + `estado-observado.ts`) contra el
// runtime simulado de referencia (`tests/vivo-simulador.mjs`) por un puente FALSO en memoria con la
// misma interfaz `Puente` que el serie real. Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md.
//
// Nada duerme: el reloj y el temporizador son falsos y se avanzan a mano; el puente falso entrega
// las líneas en una microtarea y los tests esperan las promesas de la sesión. El proyecto es REAL
// (raíz de composición + operaciones), en un directorio temporal propio de este archivo.
//
// Al final, si hay un Python del penv de PlatformIO (pyserial) y un pseudo-terminal, el puente
// Python real pasa una línea ida y vuelta; si no, ese test se salta y lo dice.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const P = await import(join(REPO, "opencode/vivo/protocolo.ts"))
const EO = await import(join(REPO, "opencode/vivo/estado-observado.ts"))
const { abrirSesion, TIEMPOS_POR_DEFECTO } = await import(join(REPO, "opencode/vivo/sesion-viva.ts"))
const { abrirPuenteSerie, pythonCandidatos, pythonDelPenv } = await import(join(REPO, "opencode/vivo/transporte-serie.ts"))
const { crearRuntimeSimulado } = await import(join(REPO, "tests/vivo-simulador.mjs"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { obtenerServicioDeProyecto } = await import(join(REPO, "opencode/nucleo/composicion-raiz.ts"))

const ESP32 = REGISTRO_PLACAS["esp32-devkit-v1"]

// ───────────────────────────── proyecto real ─────────────────────────────

// Directorio propio y con nombre único: `tecniabot-test-phase2` lo usan otros tests.
const DIR_BASE = join(os.tmpdir(), `tecniabot-test-vivo-sesion-${process.pid}`)
rmSync(DIR_BASE, { recursive: true, force: true })
mkdirSync(DIR_BASE, { recursive: true })

let contadorOp = 0
const op = (tipo, payload, baseRevision) => ({ idOperacion: `vivo-op-${contadorOp++}`, actor: "navegador", baseRevision, tipo, payload })

/**
 * ESP32 con: un LED en GPIO23 (`led`), un pulsador en GPIO4 (`pulsador`), un NTC en GPIO34 (`ntc`),
 * un DHT22 en GPIO16 (`dht`, bidireccional: V1 no lo lee) y un segundo LED SIN pin (`ledSinPin`).
 * Los ids reales salen del Engine; se devuelven por nombre para que los tests no cuenten "cmp-n".
 */
function prepararProyecto(nombre) {
  const dir = join(DIR_BASE, nombre)
  mkdirSync(dir, { recursive: true })
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: `vivo-${nombre}` })
  const aplicar = (tipo, payload) => {
    const r = servicio.aplicar(op(tipo, payload, servicio.snapshot().revision))
    if (!r.ok) throw new Error(`fixture: ${tipo} rechazado: ${JSON.stringify(r.motivos)}`)
  }
  const agregar = (tipo, terminal, pin) => {
    aplicar("AgregarComponente", { tipo })
    const componentes = servicio.snapshot().proyecto.componentes
    const id = componentes[componentes.length - 1].id
    if (pin) aplicar("AsignarPin", { componente: id, terminal, pin })
    return id
  }
  aplicar("SetPlaca", { placa: "esp32-devkit-v1" })
  const ids = {
    led: agregar("led", "anodo", "GPIO23"),
    pulsador: agregar("pulsador", "senal", "GPIO4"),
    ntc: agregar("ntc", "senal", "GPIO34"),
    dht: agregar("dht22", "senal", "GPIO16"),
    ledSinPin: agregar("led"),
  }
  const proyecto = servicio.snapshot().proyecto
  servicio.cerrar()
  return { proyecto, ids }
}

// ───────────────────────────── dobles: reloj, temporizador, puente ─────────────────────────────

const vaciarMicrotareas = () => new Promise((listo) => setImmediate(listo))

/** Reloj + temporizador falsos: `avanzar(ms)` dispara, en orden, lo que vence hasta ahí. */
function crearTiempoFalso() {
  let ahora = 0
  let secuencia = 0
  const programados = []
  return {
    reloj: () => ahora,
    temporizador: {
      programar(ms, cb) {
        const t = { en: ahora + ms, secuencia: secuencia++, cb, activo: true }
        programados.push(t)
        return () => {
          t.activo = false
        }
      },
    },
    async avanzar(ms) {
      const hasta = ahora + ms
      for (;;) {
        const proximo = programados.filter((t) => t.activo && t.en <= hasta).sort((a, b) => a.en - b.en || a.secuencia - b.secuencia)[0]
        if (!proximo) break
        ahora = proximo.en
        proximo.activo = false
        proximo.cb()
        await vaciarMicrotareas()
      }
      ahora = hasta
      await vaciarMicrotareas()
    },
  }
}

/**
 * Puente falso: lo que se `enviar` lo procesa el runtime simulado y sus líneas vuelven en una
 * microtarea (como llegarían por el serie, nunca dentro de `enviar`). `transformar` permite
 * falsificar el `hola`; `silenciar` deja al runtime mudo; `inyectar` mete líneas crudas.
 */
function crearPuenteFalso(runtime, { transformar = (linea) => linea } = {}) {
  const receptores = new Set()
  const cierres = new Set()
  const enviadas = []
  let silenciado = false
  let cerrado = false
  const entregar = (lineas) =>
    queueMicrotask(() => {
      for (const linea of lineas) for (const r of receptores) r(linea)
    })
  return {
    enviadas,
    silenciar: (valor) => void (silenciado = valor),
    arrancar: () => entregar(runtime.arrancar().map(transformar)),
    inyectar: (...lineas) => entregar(lineas),
    caer(motivo) {
      cerrado = true
      for (const c of cierres) c(motivo)
    },
    estaCerrado: () => cerrado,
    enviar(linea) {
      enviadas.push(linea)
      if (cerrado || silenciado) return
      entregar(runtime.procesar(linea).map(transformar))
    },
    alRecibir(cb) {
      receptores.add(cb)
      return () => receptores.delete(cb)
    },
    alCerrar(cb) {
      cierres.add(cb)
      return () => cierres.delete(cb)
    },
    async cerrar() {
      if (cerrado) return
      cerrado = true
      for (const c of cierres) c("CERRADO_POR_TEST")
    },
  }
}

/** Un `hola` canónico modificado (sin un comando, otro protocolo…). */
function holaFalsificado(cambios) {
  return (linea) => {
    const r = P.parsearRespuesta(linea)
    if (!r.ok || r.valor.tipo !== "hola") return linea
    return P.serializarRespuesta({ ...r.valor, ...cambios })
  }
}

const PROYECTO = prepararProyecto("principal")

async function abrir({ transformar, arrancar = true, tiempos } = {}) {
  const runtime = crearRuntimeSimulado()
  const puente = crearPuenteFalso(runtime, transformar ? { transformar } : {})
  const tiempo = crearTiempoFalso()
  const promesa = abrirSesion({ puente, placa: ESP32, proyecto: PROYECTO.proyecto, conocimiento: CONOCIMIENTO_ACTIVO, reloj: tiempo.reloj, temporizador: tiempo.temporizador, tiempos })
  if (arrancar) puente.arrancar()
  const sesion = await promesa
  return { sesion, puente, runtime, tiempo, ids: PROYECTO.ids }
}

const observacionDe = (sesion, id) => sesion.estado().componentes.find((c) => c.id === id)?.ultimaObservacion

// ───────────────────────────── handshake y compatibilidad ─────────────────────────────

test("handshake: reinicio + hola espontáneos dejan la sesión CONECTADA con el runtime, la placa y los componentes con su pin", async () => {
  const { sesion, ids, puente } = await abrir()
  const estado = sesion.estado()
  assert.equal(estado.sesion, "CONECTADA")
  assert.deepEqual(estado.runtime, { version: "0.1.0", protocolo: 1, placa: "esp32-devkit-v1", comandos: [...P.COMANDOS_V1], protocolos: [] })
  assert.deepEqual(estado.ultimoReinicio, { causa: "encendido", instante: 0 })
  assert.equal(estado.placa.id, "esp32-devkit-v1")
  assert.ok(estado.placa.pines.some((p) => p.id === "GPIO23"), "la placa del estado es el registro completo")
  assert.notEqual(estado.placa, ESP32, "copia propia, nunca la constante compartida")

  const porId = Object.fromEntries(estado.componentes.map((c) => [c.id, c]))
  assert.deepEqual(porId[ids.led], { id: ids.led, tipo: "led", terminal: "anodo", pin: { id: "GPIO23", numero: 23 } })
  assert.deepEqual(porId[ids.pulsador], { id: ids.pulsador, tipo: "pulsador", terminal: "senal", pin: { id: "GPIO4", numero: 4 } })
  assert.deepEqual(porId[ids.ntc], { id: ids.ntc, tipo: "ntc", terminal: "senal", pin: { id: "GPIO34", numero: 34 } })
  assert.deepEqual(porId[ids.ledSinPin], { id: ids.ledSinPin, tipo: "led", terminal: "anodo" }, "sin pin: figura, sin `pin` y sin observación")
  assert.ok(estado.componentes.every((c) => c.ultimaObservacion === undefined), "sin evidencia no hay observación (UNKNOWN)")
  assert.deepEqual(puente.enviadas, [], "con el hola espontáneo el host no manda nada")
  await sesion.cerrar()
})

test("si el hola no llega solo, se pide tras esperaHolaMs y la sesión conecta igual", async () => {
  const { sesion, puente, tiempo } = await (async () => {
    const runtime = crearRuntimeSimulado()
    const puente = crearPuenteFalso(runtime)
    const tiempo = crearTiempoFalso()
    const promesa = abrirSesion({ puente, placa: ESP32, proyecto: PROYECTO.proyecto, conocimiento: CONOCIMIENTO_ACTIVO, reloj: tiempo.reloj, temporizador: tiempo.temporizador })
    await tiempo.avanzar(TIEMPOS_POR_DEFECTO.esperaHolaMs)
    return { sesion: await promesa, puente, tiempo }
  })()
  assert.deepEqual(puente.enviadas, ["hola"])
  assert.equal(sesion.estado().sesion, "CONECTADA")
  assert.equal(sesion.estado().ultimoReinicio, undefined, "no hubo reinicio: no se inventa uno")
  await sesion.cerrar()
  void tiempo
})

test("si nadie contesta el hola pedido, la sesión queda SIN_RUNTIME con motivo SIN_HOLA", async () => {
  const runtime = crearRuntimeSimulado()
  const puente = crearPuenteFalso(runtime)
  puente.silenciar(true)
  const tiempo = crearTiempoFalso()
  const promesa = abrirSesion({ puente, placa: ESP32, proyecto: PROYECTO.proyecto, conocimiento: CONOCIMIENTO_ACTIVO, reloj: tiempo.reloj, temporizador: tiempo.temporizador })
  await tiempo.avanzar(TIEMPOS_POR_DEFECTO.esperaHolaMs + TIEMPOS_POR_DEFECTO.respuestaMs)
  const sesion = await promesa
  assert.equal(sesion.estado().sesion, "SIN_RUNTIME")
  assert.equal(sesion.estado().motivo, "SIN_HOLA")
  const r = await sesion.leer(PROYECTO.ids.pulsador)
  assert.deepEqual(r, { ok: false, codigo: "SESION_NO_CONECTADA", datos: { sesion: "SIN_RUNTIME", motivo: "SIN_HOLA" } })
  await sesion.cerrar()
})

test("hola sin pwm.escribir → RUNTIME_INCOMPATIBLE, con qué falta; todo comando se rechaza con ese código", async () => {
  const { sesion, ids } = await abrir({ transformar: holaFalsificado({ comandos: P.COMANDOS_V1.filter((c) => c !== "pwm.escribir") }) })
  const estado = sesion.estado()
  assert.equal(estado.sesion, "RUNTIME_INCOMPATIBLE")
  assert.deepEqual(estado.incompatibilidad, { protocoloRuntime: 1, protocoloHost: 1, comandosFaltantes: ["pwm.escribir"] })
  assert.ok(estado.runtime && !estado.runtime.comandos.includes("pwm.escribir"), "lo que dijo el runtime se guarda tal cual")
  const r = await sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "RUNTIME_INCOMPATIBLE")
  assert.deepEqual(r.datos.comandosFaltantes, ["pwm.escribir"])
  await sesion.cerrar()
})

test("hola con protocolo 2 → RUNTIME_INCOMPATIBLE aunque anuncie todos los comandos", async () => {
  const { sesion } = await abrir({ transformar: holaFalsificado({ protocolo: 2 }) })
  assert.equal(sesion.estado().sesion, "RUNTIME_INCOMPATIBLE")
  assert.deepEqual(sesion.estado().incompatibilidad, { protocoloRuntime: 2, protocoloHost: 1, comandosFaltantes: [] })
  await sesion.cerrar()
})

test("esCompatible/evaluarCompatibilidad: protocolo 1 + los siete comandos de V1, y nada más que eso", () => {
  const hola = { tipo: "hola", runtime: "0.1.0", protocolo: 1, placa: "esp32-devkit-v1", comandos: [...P.COMANDOS_V1], protocolos: [] }
  assert.equal(EO.esCompatible(hola), true)
  assert.equal(EO.esCompatible({ ...hola, comandos: [...P.COMANDOS_V1, "servo.angulo"] }), true, "comandos de más no molestan (plan §10.4)")
  assert.equal(EO.esCompatible({ ...hola, runtime: "9.9.9" }), true, "la versión del runtime es informativa, no decide")
  assert.equal(EO.esCompatible({ ...hola, protocolo: 0 }), false)
  assert.deepEqual(EO.evaluarCompatibilidad({ ...hola, comandos: ["hola", "ping"] }), {
    ok: false,
    protocoloRuntime: 1,
    protocoloHost: 1,
    comandosFaltantes: ["analogico.leer", "digital.escribir", "digital.leer", "pin.modo", "pwm.escribir"],
  })
})

// ───────────────────────────── accionar y leer ─────────────────────────────

test("accionar un LED: nivel alto y pwm 50 llegan al runtime y quedan OBSERVED con el instante del reloj", async () => {
  const { sesion, runtime, puente, tiempo, ids } = await abrir()
  await tiempo.avanzar(10)
  const alto = await sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  assert.deepEqual(alto, { ok: true, valor: { tipo: "ok", comando: "digital.escribir", pin: 23 } })
  assert.equal(runtime.salidaDe(23), "alto", "el runtime simulado tiene el pin en alto")
  assert.deepEqual(observacionDe(sesion, ids.led), { valor: { tipo: "nivel", nivel: "alto" }, instante: 10, procedencia: "OBSERVED" })
  assert.equal(observacionDe(sesion, ids.ledSinPin), undefined, "el otro LED sigue UNKNOWN")

  await tiempo.avanzar(5)
  const pwm = await sesion.accionar(ids.led, { tipo: "pwm", porcentaje: 50 })
  assert.equal(pwm.ok, true)
  assert.deepEqual(runtime.salidaDe(23), { pwm: 50 })
  assert.deepEqual(observacionDe(sesion, ids.led), { valor: { tipo: "pwm", porcentaje: 50 }, instante: 15, procedencia: "OBSERVED" })
  assert.deepEqual(puente.enviadas, ["digital.escribir pin=23 nivel=alto", "pwm.escribir pin=23 porcentaje=50"])

  const fuera = await sesion.accionar(ids.led, { tipo: "pwm", porcentaje: 101 })
  assert.equal(fuera.ok, false)
  assert.equal(fuera.codigo, "ACCION_NO_APLICABLE")
  assert.equal(fuera.datos.motivo, "PORCENTAJE_FUERA_DE_RANGO")
  assert.equal(puente.enviadas.length, 2, "un porcentaje inválido no viaja")
  await sesion.cerrar()
})

test("leer un pulsador: configura el pull-up interno UNA vez y después lee el nivel; leer un NTC da el crudo", async () => {
  const { sesion, runtime, puente, ids } = await abrir()
  const suelto = await sesion.leer(ids.pulsador)
  assert.deepEqual(suelto, { ok: true, valor: { tipo: "lectura", pin: 4, nivel: "alto" } }, "sin nada afuera, el pull-up deja el pin en alto")
  assert.deepEqual(puente.enviadas, ["pin.modo pin=4 modo=entradaPullUp", "digital.leer pin=4"])
  assert.equal(runtime.modoDe(4), "entradaPullUp")

  runtime.fijarEntrada(4, "bajo")
  const apretado = await sesion.leer(ids.pulsador)
  assert.deepEqual(apretado.valor, { tipo: "lectura", pin: 4, nivel: "bajo" })
  assert.equal(puente.enviadas.filter((l) => l.startsWith("pin.modo")).length, 1, "el pull-up se configura una sola vez por vida del runtime")
  assert.deepEqual(observacionDe(sesion, ids.pulsador).valor, { tipo: "nivel", nivel: "bajo" })

  runtime.fijarAnalogico(34, 2048)
  const ntc = await sesion.leer(ids.ntc)
  assert.deepEqual(ntc, { ok: true, valor: { tipo: "lectura", pin: 34, crudo: 2048 } })
  assert.deepEqual(observacionDe(sesion, ids.ntc), { valor: { tipo: "crudo", crudo: 2048 }, instante: 0, procedencia: "OBSERVED" })
  assert.equal(puente.enviadas.at(-1), "analogico.leer pin=34")
  await sesion.cerrar()
})

test("fallos de traducción: componente inexistente, sin pin, acción no aplicable (pwm a un pulsador, leer un LED, leer un DHT) — nada viaja", async () => {
  const { sesion, puente, ids } = await abrir()
  const codigo = async (promesa) => {
    const r = await promesa
    assert.equal(r.ok, false)
    return r.codigo
  }
  assert.equal(await codigo(sesion.accionar("cmp-999", { tipo: "nivel", nivel: "alto" })), "COMPONENTE_INEXISTENTE")
  assert.equal(await codigo(sesion.leer("cmp-999")), "COMPONENTE_INEXISTENTE")
  assert.equal(await codigo(sesion.accionar(ids.ledSinPin, { tipo: "nivel", nivel: "alto" })), "COMPONENTE_SIN_PIN")
  assert.equal(await codigo(sesion.accionar(ids.pulsador, { tipo: "pwm", porcentaje: 10 })), "ACCION_NO_APLICABLE")
  assert.equal(await codigo(sesion.accionar(ids.ntc, { tipo: "nivel", nivel: "alto" })), "ACCION_NO_APLICABLE")
  assert.equal(await codigo(sesion.leer(ids.led)), "ACCION_NO_APLICABLE")
  assert.equal(await codigo(sesion.leer(ids.dht)), "ACCION_NO_APLICABLE", "bidireccional: V1 no tiene sensor.leer y un nivel suelto no significa nada")
  assert.deepEqual(puente.enviadas, [])
  await sesion.cerrar()
})

test("comando() por pin cruza A (placa): salida en GPIO34, ADC en GPIO4 y un pin inexistente se frenan en el host; un error del runtime vuelve con su código", async () => {
  const { sesion, puente } = await abrir()
  const salida = await sesion.comando({ comando: "digital.escribir", pin: 34, nivel: "alto" })
  assert.deepEqual(salida, { ok: false, codigo: "CAPACIDAD_NO_SOPORTADA_POR_PLACA", datos: { placa: "esp32-devkit-v1", pin: "GPIO34", capacidad: "salidaDigital" } })
  const adc = await sesion.comando({ comando: "analogico.leer", pin: 4 })
  assert.equal(adc.codigo, "CAPACIDAD_NO_SOPORTADA_POR_PLACA")
  assert.equal(adc.datos.capacidad, "adc")
  const inexistente = await sesion.comando({ comando: "digital.leer", pin: 20 })
  assert.equal(inexistente.codigo, "CAPACIDAD_NO_SOPORTADA_POR_PLACA")
  assert.equal(inexistente.datos.motivo, "PIN_INEXISTENTE_EN_PLACA")
  assert.deepEqual(puente.enviadas, [], "lo que la placa no puede hacer no se le pide al runtime")

  // GPIO6 es flash: el registro lo tiene con salidaDigital (no es solo-entrada) y es el runtime quien lo
  // prohíbe (§5). El host no lo disfraza: devuelve el código del runtime tal cual.
  const flash = await sesion.comando({ comando: "digital.escribir", pin: 6, nivel: "alto" })
  assert.deepEqual(flash, { ok: false, codigo: "PIN_PROHIBIDO", datos: { codigo: "PIN_PROHIBIDO", comando: "digital.escribir", pin: 6 } })
  assert.deepEqual(puente.enviadas, ["digital.escribir pin=6 nivel=alto"])
  await sesion.cerrar()
})

test("comando() valida B (hola): el chequeo existe y mira la lista del hola", () => {
  // En V1 no se puede ejercitar por la API pública: la compatibilidad ya exige los siete comandos, así
  // que un runtime al que le falte uno es RUNTIME_INCOMPATIBLE antes de llegar a B. El chequeo queda
  // para cuando la compatibilidad se relaje (plan §10.4: protocolos por proyecto); acá sólo se
  // verifica que está y que lee `runtime.comandos` del estado, no una lista propia.
  const fuente = readFileSync(join(REPO, "opencode/vivo/sesion-viva.ts"), "utf8")
  assert.match(fuente, /COMANDO_NO_SOPORTADO_POR_RUNTIME/)
  assert.match(fuente, /estado\.runtime\?\.comandos/)
})

// ───────────────────────────── reinicio, latido, caídas ─────────────────────────────

test("un reinicio en medio: se registra, las observaciones se descartan, la sesión vuelve a CONECTANDO y el nuevo hola la reconecta", async () => {
  const { sesion, puente, runtime, tiempo, ids } = await abrir()
  await sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  await sesion.leer(ids.pulsador)
  assert.ok(observacionDe(sesion, ids.led))

  await tiempo.avanzar(100)
  puente.inyectar(P.serializarRespuesta({ tipo: "reinicio", causa: "brownout" }))
  await vaciarMicrotareas()
  const durante = sesion.estado()
  assert.equal(durante.sesion, "CONECTANDO")
  assert.deepEqual(durante.ultimoReinicio, { causa: "brownout", instante: 100 })
  assert.equal(observacionDe(sesion, ids.led), undefined, "lo observado antes del reinicio ya no describe la placa")
  const rechazado = await sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  assert.deepEqual(rechazado, { ok: false, codigo: "SESION_NO_CONECTADA", datos: { sesion: "CONECTANDO" } })

  puente.inyectar(runtime.procesar("hola")[0])
  await vaciarMicrotareas()
  assert.equal(sesion.estado().sesion, "CONECTADA")
  assert.deepEqual(sesion.estado().ultimoReinicio, { causa: "brownout", instante: 100 }, "el reinicio queda registrado")

  const enviadasAntes = puente.enviadas.length
  await sesion.leer(ids.pulsador)
  assert.equal(puente.enviadas[enviadasAntes], "pin.modo pin=4 modo=entradaPullUp", "tras el reinicio el pull-up se configura de nuevo")
  await sesion.cerrar()
})

test("un comando en vuelo cuando llega el reinicio falla con SESION_NO_CONECTADA y motivo REINICIO", async () => {
  const { sesion, puente, ids } = await abrir()
  puente.silenciar(true)
  const enVuelo = sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  await vaciarMicrotareas()
  puente.inyectar(P.serializarRespuesta({ tipo: "reinicio", causa: "watchdog" }))
  const r = await enVuelo
  assert.deepEqual(r, { ok: false, codigo: "SESION_NO_CONECTADA", datos: { sesion: "CONECTANDO", motivo: "REINICIO", causa: "watchdog", comando: "digital.escribir" } })
  await sesion.cerrar()
})

test("latido: ping cada 2 s; 5 s sin pong → DESCONECTADA (SIN_PONG) y los comandos se rechazan", async () => {
  const { sesion, puente, tiempo, ids } = await abrir()
  await tiempo.avanzar(2000)
  assert.deepEqual(puente.enviadas, ["ping"])
  assert.equal(sesion.estado().sesion, "CONECTADA")
  await tiempo.avanzar(2000)
  assert.deepEqual(puente.enviadas, ["ping", "ping"], "con pong, un ping por tick")

  puente.silenciar(true)
  await tiempo.avanzar(2000) // t=6000: el pong de t=4000 fue el último
  assert.equal(sesion.estado().sesion, "CONECTADA", "a los 2 s sin pong todavía no se desconecta")
  await tiempo.avanzar(2000) // t=8000: 4 s sin pong
  assert.equal(sesion.estado().sesion, "CONECTADA")
  await tiempo.avanzar(2000) // t=10000: 6 s sin pong
  assert.equal(sesion.estado().sesion, "DESCONECTADA")
  assert.equal(sesion.estado().motivo, "SIN_PONG")
  const r = await sesion.leer(ids.pulsador)
  assert.deepEqual(r, { ok: false, codigo: "SESION_NO_CONECTADA", datos: { sesion: "DESCONECTADA", motivo: "SIN_PONG" } })
  const enviadas = puente.enviadas.length
  await tiempo.avanzar(10000)
  assert.equal(puente.enviadas.length, enviadas, "desconectada, no manda más pings")
  await sesion.cerrar()
})

test("respuesta inválida del runtime (no JSON, o del tipo equivocado) → RESPUESTA_INVALIDA, nunca una excepción", async () => {
  const { sesion, puente, ids } = await abrir()
  puente.silenciar(true)
  const ping = sesion.comando({ comando: "ping" })
  await vaciarMicrotareas()
  puente.inyectar("esto no es una linea del protocolo")
  assert.deepEqual(await ping, { ok: false, codigo: "RESPUESTA_INVALIDA", datos: { comando: "ping", linea: "esto no es una linea del protocolo" } })

  const led = sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  await vaciarMicrotareas()
  puente.inyectar('{"tipo":"pong","uptimeMs":1}')
  const r = await led
  assert.equal(r.codigo, "RESPUESTA_INVALIDA", "un pong no es la respuesta a digital.escribir")
  assert.equal(observacionDe(sesion, ids.led), undefined, "una respuesta inválida no deja observación")

  const otroPin = sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  await vaciarMicrotareas()
  puente.inyectar('{"comando":"digital.escribir","pin":22,"tipo":"ok"}')
  assert.equal((await otroPin).codigo, "RESPUESTA_INVALIDA", "un ok para OTRO pin tampoco vale")
  await sesion.cerrar()
})

test("sin respuesta en respuestaMs → TIEMPO_AGOTADO y la cola sigue con el próximo comando", async () => {
  const { sesion, puente, tiempo, ids } = await abrir()
  puente.silenciar(true)
  const primero = sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  const segundo = sesion.leer(ids.ntc)
  await vaciarMicrotareas()
  assert.deepEqual(puente.enviadas, ["digital.escribir pin=23 nivel=alto"], "un comando a la vez")
  await tiempo.avanzar(TIEMPOS_POR_DEFECTO.respuestaMs)
  assert.equal((await primero).codigo, "TIEMPO_AGOTADO")
  assert.deepEqual(puente.enviadas, ["digital.escribir pin=23 nivel=alto", "analogico.leer pin=34"], "recién entonces sale el segundo")
  puente.silenciar(false)
  await tiempo.avanzar(TIEMPOS_POR_DEFECTO.respuestaMs)
  assert.equal((await segundo).codigo, "TIEMPO_AGOTADO")
  await sesion.cerrar()
})

test("el puente se cae → DESCONECTADA con el motivo del puente; cerrar() → DESCONECTADA por el host y cierra el puente", async () => {
  const caida = await abrir()
  caida.puente.caer("PUERTO_PERDIDO")
  assert.equal(caida.sesion.estado().sesion, "DESCONECTADA")
  assert.equal(caida.sesion.estado().motivo, "PUERTO_PERDIDO")
  assert.equal((await caida.sesion.accionar(caida.ids.led, { tipo: "nivel", nivel: "alto" })).codigo, "SESION_NO_CONECTADA")
  await caida.sesion.cerrar()

  const normal = await abrir()
  await normal.sesion.cerrar()
  assert.equal(normal.sesion.estado().sesion, "DESCONECTADA")
  assert.equal(normal.sesion.estado().motivo, "CERRADA_POR_HOST")
  assert.equal(normal.puente.estaCerrado(), true)
  await normal.sesion.cerrar()
})

// ───────────────────────────── estado observado: pureza y guardias ─────────────────────────────

test("el estado observado está congelado en profundidad y cada transición devuelve un estado nuevo", async () => {
  const { sesion, ids } = await abrir()
  const antes = sesion.estado()
  await sesion.accionar(ids.led, { tipo: "nivel", nivel: "alto" })
  const despues = sesion.estado()
  assert.notEqual(antes, despues)
  assert.equal(antes.componentes.find((c) => c.id === ids.led).ultimaObservacion, undefined, "el estado anterior no se mutó")
  const congelado = (v) => v === null || typeof v !== "object" || (Object.isFrozen(v) && Object.values(v).every(congelado))
  assert.ok(congelado(despues), "todo el árbol está congelado")
  assert.throws(() => {
    despues.componentes[0].ultimaObservacion = { valor: { tipo: "nivel", nivel: "bajo" }, instante: 0, procedencia: "OBSERVED" }
  }, TypeError)
  assert.throws(() => {
    despues.placa.pines.push({})
  }, TypeError)
  await sesion.cerrar()
})

test("estado-observado: un pong o un ok a pin.modo no son observaciones (misma referencia); una resistencia no entra; un pin ausente en la placa queda sin pin", () => {
  const proyecto = {
    componentes: [
      { id: "cmp-0", tipo: "resistencia", pines: {}, propiedades: {} },
      { id: "cmp-1", tipo: "led", pines: { anodo: "GPIO99" }, propiedades: {} },
      { id: "cmp-2", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
    ],
  }
  const inicial = EO.estadoInicial(proyecto, ESP32, CONOCIMIENTO_ACTIVO)
  assert.equal(inicial.sesion, "SIN_RUNTIME")
  assert.deepEqual(
    inicial.componentes.map((c) => [c.id, c.pin?.numero]),
    [
      ["cmp-1", undefined],
      ["cmp-2", 23],
    ],
  )
  const conectado = EO.aplicarHola(EO.marcarConectando(inicial), { tipo: "hola", runtime: "0.1.0", protocolo: 1, placa: "esp32-devkit-v1", comandos: [...P.COMANDOS_V1], protocolos: [] })
  assert.equal(conectado.sesion, "CONECTADA")
  assert.equal(EO.aplicarRespuesta(conectado, { comando: "ping" }, { tipo: "pong", uptimeMs: 5 }, 1), conectado)
  assert.equal(EO.aplicarRespuesta(conectado, { comando: "pin.modo", pin: 23, modo: "salida" }, { tipo: "ok", comando: "pin.modo", pin: 23 }, 1), conectado)
  assert.equal(EO.aplicarRespuesta(conectado, { comando: "digital.escribir", pin: 23, nivel: "alto" }, { tipo: "error", codigo: "PIN_PROHIBIDO", pin: 23 }, 1), conectado)
  const observado = EO.aplicarRespuesta(conectado, { comando: "digital.escribir", pin: 23, nivel: "alto" }, { tipo: "ok", comando: "digital.escribir", pin: 23 }, 7)
  assert.deepEqual(observado.componentes[1].ultimaObservacion, { valor: { tipo: "nivel", nivel: "alto" }, instante: 7, procedencia: "OBSERVED" })
  const reiniciado = EO.aplicarReinicio(observado, "software", 9)
  assert.equal(reiniciado.componentes[1].ultimaObservacion, undefined)
  assert.deepEqual(reiniciado.ultimoReinicio, { causa: "software", instante: 9 })
  assert.equal(EO.marcarDesconectada(reiniciado, "X").sesion, "DESCONECTADA")
})

test("guardia: estado-observado.ts y sesion-viva.ts no importan node:/Bun ni tocan la IR o el almacén; transporte-serie.ts es el único con I/O en vivo/", () => {
  const importaNode = /from\s+["']node:/
  const tocaPersistencia = /obtenerServicioDeProyecto|crearAlmacen|crearMotorDeProyecto|\baplicar(Transaccion)?\(|AsignarPin|writeFile|Bun\./
  // La guardia se prueba a sí misma: si estas regex no marcaran lo que dicen marcar, el test sería un adorno.
  assert.ok(importaNode.test('import { readFileSync } from "node:fs"'))
  assert.ok(tocaPersistencia.test('servicio.aplicar(op("AsignarPin"))'))
  assert.ok(tocaPersistencia.test("Bun.spawn(x)"))

  for (const archivo of ["estado-observado.ts", "sesion-viva.ts"]) {
    const fuente = readFileSync(join(REPO, "opencode/vivo", archivo), "utf8")
    assert.ok(!importaNode.test(fuente), `${archivo} importa node:`)
    assert.ok(!tocaPersistencia.test(fuente), `${archivo} toca la IR/el almacén`)
  }
  const conNode = readdirSync(join(REPO, "opencode/vivo"))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => importaNode.test(readFileSync(join(REPO, "opencode/vivo", f), "utf8")))
  assert.deepEqual(conNode, ["transporte-serie.ts"])
})

// ───────────────────────────── transporte: búsqueda del Python y puente real ─────────────────────────────

test("pythonCandidatos busca el penv donde platformio.ts busca pio, incluida la raíz del disco en Windows", () => {
  const win = pythonCandidatos("C:\\Users\\Dirección310", "win32", {})
  assert.deepEqual(win, ["C:\\Users\\Dirección310\\.platformio\\penv\\Scripts\\python.exe", "C:\\.platformio\\penv\\Scripts\\python.exe"])
  const conCore = pythonCandidatos("C:\\Users\\x", "win32", { PLATFORMIO_CORE_DIR: "D:\\pio" })
  assert.equal(conCore[0], "D:\\pio\\penv\\Scripts\\python.exe", "PLATFORMIO_CORE_DIR gana")
  const linux = pythonCandidatos("/home/docente", "linux", {})
  assert.deepEqual(linux, ["/home/docente/.platformio/penv/bin/python", "/home/docente/.platformio/penv/bin/python3"])
})

const PYTHON = pythonDelPenv()
const HAY_PTY = process.platform !== "win32" && PYTHON !== undefined
// Con timeout: si el puente real deja de entregar líneas (p. ej. una mutación del framing en Python),
// el test tiene que ponerse rojo, no colgar la suite.
const OPCIONES_PTY = { skip: HAY_PTY ? false : "sin Python del penv de PlatformIO (pyserial) o en Windows: el puente real no se prueba acá", timeout: 15000 }

// Del otro lado del cable: un pseudo-terminal cuyo esclavo abre el puente con pyserial. El maestro
// contesta cada línea con `eco:<línea>`. Sólo stdlib.
const PAR_PTY = `
import os, pty, sys
maestro, esclavo = pty.openpty()
sys.stdout.write(os.ttyname(esclavo) + "\\n")
sys.stdout.flush()
resto = b""
while True:
    try:
        datos = os.read(maestro, 1024)
    except OSError:
        break
    if not datos:
        break
    resto += datos
    while b"\\n" in resto:
        linea, resto = resto.split(b"\\n", 1)
        os.write(maestro, b"eco:" + linea + b"\\n")
`

/**
 * Espera un evento con tope. No es un sleep: es lo que garantiza que una espera que nunca llega se
 * convierta en un fallo que suelte los procesos (el `timeout` de node:test marca el fallo pero NO
 * cancela la promesa colgada, así que sin esto el `finally` no corría y los hijos sostenían al runner).
 */
function conLimite(promesa, ms, descripcion) {
  let limite
  const vencido = new Promise((_, rechazar) => {
    limite = setTimeout(() => rechazar(new Error(`${descripcion}: nada en ${ms} ms`)), ms)
  })
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(limite))
}

function lanzarParPty() {
  const hijo = spawn(PYTHON, ["-I", "-c", PAR_PTY], { stdio: ["ignore", "pipe", "inherit"] })
  const ruta = new Promise((resolver, rechazar) => {
    let acumulado = ""
    hijo.stdout.setEncoding("utf8")
    hijo.stdout.on("data", (trozo) => {
      acumulado += trozo
      const fin = acumulado.indexOf("\n")
      if (fin >= 0) resolver(acumulado.slice(0, fin))
    })
    hijo.on("error", rechazar)
    hijo.on("close", () => rechazar(new Error("el par pty terminó sin anunciar su ruta")))
  })
  const terminado = new Promise((resolver) => hijo.on("close", resolver))
  return { hijo, ruta, terminado }
}

test("puente Python real: una línea va y vuelve por un pseudo-terminal con pyserial; cerrar() termina el proceso", OPCIONES_PTY, async () => {
  // `finally` a propósito: si el puente deja de entregar líneas (lo vio la campaña de mutación: sin el
  // `\n` de salida el test vencía por timeout pero los hijos vivos sostenían al runner para siempre),
  // el test tiene que ponerse rojo y soltar los procesos.
  const par = lanzarParPty()
  let puente
  try {
    const ruta = await par.ruta
    assert.ok(existsSync(ruta), ruta)
    puente = await abrirPuenteSerie({ puerto: ruta, python: PYTHON })
    const motivos = []
    puente.alCerrar((m) => motivos.push(m))
    const eco = new Promise((resolver) => puente.alRecibir((linea) => resolver(linea)))
    puente.enviar("ping")
    assert.equal(await conLimite(eco, 10000, "eco del par pty"), "eco:ping")
    await puente.cerrar()
    assert.deepEqual(motivos, ["PUENTE_TERMINADO"], "stdin cerrado = salida limpia")
  } finally {
    par.hijo.kill()
    await par.terminado
    await puente?.cerrar()
  }
})

test("puente Python real: si el puerto desaparece, el puente avisa PUERTO_PERDIDO y termina; un puerto inexistente rechaza con PUERTO_NO_ABIERTO", OPCIONES_PTY, async () => {
  const par = lanzarParPty()
  let puente
  let ruta
  try {
    ruta = await par.ruta
    puente = await abrirPuenteSerie({ puerto: ruta, python: PYTHON })
    const cierre = new Promise((resolver) => puente.alCerrar(resolver))
    par.hijo.kill()
    await par.terminado
    // Con el maestro cerrado, el esclavo da EIO al leer: el hilo lector del puente lo reporta.
    assert.equal(await conLimite(cierre, 10000, "cierre del puente"), "PUERTO_PERDIDO")
  } finally {
    par.hijo.kill()
    await par.terminado
    await puente?.cerrar()
  }

  await assert.rejects(abrirPuenteSerie({ puerto: join(DIR_BASE, "no-es-un-puerto"), python: PYTHON }), (error) => {
    assert.equal(error.codigo, "PUERTO_NO_ABIERTO")
    return true
  })
  await assert.rejects(abrirPuenteSerie({ puerto: ruta, python: join(DIR_BASE, "python-inexistente") }), (error) => {
    assert.equal(error.codigo, "PUENTE_NO_LANZADO")
    return true
  })
})

test.after(() => rmSync(DIR_BASE, { recursive: true, force: true }))
