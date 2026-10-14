// Modo Vivo (protocolo v1, slices V1–V4) — la tool `vivo` (tool/vivo.ts): orquestación, códigos,
// reserva del puerto y la exclusión con `platformio` y `programa cargar`. La sesión y el runtime se
// INYECTAN (misma técnica que `cargar` en codegen-s1b): acá se prueba que la tool haga lo que dice el
// contrato con lo que recibe, no el protocolo (tests/vivo-protocolo.test.mjs) ni la sesión
// (tests/vivo-sesion.test.mjs). La única excepción es la cadena V4 `hola.wifi` → sesión REAL → estado,
// que la auditoría 2026-10-13 (A2-A4) encontró sin ningún test de punta a punta.

import { test, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { ejecutarVivo, carpetaDelRuntime, cerrarTodasLasSesiones, ACCIONES_VIVO, paginaDelProyecto, sortearClaveWifi } = await import(join(REPO, "opencode/tool/vivo.ts"))
const vivoTool = (await import(join(REPO, "opencode/tool/vivo.ts"))).default
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const platformioTool = (await import(join(REPO, "opencode/tool/platformio.ts"))).default
const { pioDisponible, duenoDelPuerto, liberarTodosLosPuertos, puertoEnSesionViva } = await import(join(REPO, "opencode/tool/platformio.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const { tablasDePines } = await import(join(REPO, "opencode/codegen/runtime.ts"))
const { abrirSesion } = await import(join(REPO, "opencode/vivo/sesion-viva.ts"))
const P = await import(join(REPO, "opencode/vivo/protocolo.ts"))
const { crearRuntimeSimulado } = await import(join(REPO, "tests/vivo-simulador.mjs"))

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const FUENTE_TOOL = readFileSync(join(REPO, "opencode/tool/vivo.ts"), "utf8")
const PUERTO = "/dev/ttyUSB7"
const esp32 = REGISTRO_PLACAS["esp32-devkit-v1"]

// La tool guarda las sesiones en el proceso (como en producción): cada test arranca sin ninguna,
// así una aserción que falla en un test no deja el puerto tomado para el siguiente.
beforeEach(async () => {
  await cerrarTodasLasSesiones()
  liberarTodosLosPuertos()
})
after(async () => {
  await cerrarTodasLasSesiones()
  liberarTodosLosPuertos()
})

// ───────────────────────────── fixtures ───────────────────────────────────────────────

const fisico = async (dir, args) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
async function armar(operaciones) {
  const dir = nuevoDir("vivo-tool")
  if (operaciones.length > 0) {
    const { revision } = await fisico(dir, { accion: "leer" })
    const r = await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones })
    assert.equal(r.ok, true, JSON.stringify(r))
  }
  return dir
}
const OPS = [
  { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO4" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" } },
]

/**
 * Sesión falsa con la interfaz pública de `vivo/sesion-viva.ts`: registra llamadas, contesta canned.
 * `caer(motivo)` la pasa a DESCONECTADA y dispara `alCierre`, como hace la real (V4-9).
 */
function sesionFalsa({ sesion = "CONECTADA", llamadas = [], wifi } = {}) {
  let estadoDeSesion = sesion
  let motivo
  const cierres = new Set()
  const estado = () =>
    Object.freeze({
      sesion: estadoDeSesion,
      placa: esp32,
      runtime: { version: "0.1.0", protocolo: 1, placa: esp32.id, comandos: [], protocolos: [], ...(wifi ? { wifi } : {}) },
      componentes: [],
      ...(motivo ? { motivo } : {}),
    })
  return {
    llamadas,
    estado,
    caer(porQue) {
      estadoDeSesion = "DESCONECTADA"
      motivo = porQue
      for (const cb of cierres) cb(porQue)
    },
    alCierre(cb) {
      cierres.add(cb)
      return () => cierres.delete(cb)
    },
    async accionar(componente, accion) {
      llamadas.push(["accionar", componente, accion])
      return { ok: true, valor: { tipo: "ok", comando: accion.tipo === "pwm" ? "pwm.escribir" : "digital.escribir", pin: 18 } }
    },
    async leer(componente) {
      llamadas.push(["leer", componente])
      return { ok: true, valor: { tipo: "lectura", pin: 4, nivel: "alto" } }
    },
    async comando(comando) {
      llamadas.push(["comando", comando])
      return { ok: true, valor: comando.comando === "analogico.leer" ? { tipo: "lectura", pin: comando.pin, crudo: 2048 } : { tipo: "ok", comando: comando.comando, pin: comando.pin } }
    },
    async cerrar() {
      llamadas.push(["cerrar"])
    },
  }
}

const puenteFalso = () => ({ enviar() {}, alRecibir: () => () => {}, alCerrar: () => () => {}, cerrar: async () => {} })

/** Dependencias inyectadas: proyecto, conocimiento y tablas reales; runtime, puente, sesión, puerto y PlatformIO falsos. */
function depsDe({ sesion = sesionFalsa(), cargas = [], codigoCarga = 0, puente = puenteFalso(), abrirPuenteSerie, abrirSesion: abrir, detectarPuerto, generarRuntime } = {}) {
  return async () => ({
    obtenerServicioDeProyectoConVista,
    conocimiento: K,
    tablasDePines,
    generarRuntime:
      generarRuntime ??
      ((placa, opciones) => ({ archivos: { "platformio.ini": `[env:${placa.id}]\nboard = esp32dev\n`, "src/main.cpp": `// runtime de prueba; clave ${opciones?.wifi?.clave ?? "sin-wifi"}\n` }, environment: placa.id, runtime: "0.1.0", protocolo: 1 })),
    sortearClave: () => "48213907",
    abrirSesion: abrir ?? (async () => sesion),
    abrirPuenteSerie: abrirPuenteSerie ?? (async () => puente),
    detectarPuerto: detectarPuerto ?? (async () => ({ port: PUERTO })),
    cargarRuntime: async (carpeta, environment, puerto, cwd) => {
      cargas.push({ carpeta, environment, puerto, cwd, enDisco: existsSync(join(carpeta, "src", "main.cpp")) })
      return { code: codigoCarga, stdout: "", stderr: codigoCarga === 0 ? "" : "error de carga" }
    },
  })
}
const vivo = async (dir, args, deps) => JSON.parse(await ejecutarVivo(args, { directory: dir }, deps))

const seccionDelPrompt = () => {
  const regla = PROMPT.slice(PROMPT.indexOf("## REGLA CRÍTICA — Modo Vivo"))
  return regla.slice(0, regla.indexOf("\n## ", 5))
}

// ───────────────────────────── validaciones básicas ───────────────────────────────────

test("acción desconocida, idProyecto inválido y estado sin sesión: códigos claros, nada roto", async () => {
  const dir = await armar([])
  assert.equal((await vivo(dir, { accion: "volar" }, depsDe())).codigo, "ACCION_DESCONOCIDA")
  assert.equal((await vivo(dir, { accion: "estado", idProyecto: "../x" }, depsDe())).codigo, "ID_PROYECTO_INVALIDO")
  const estado = await vivo(dir, { accion: "estado" }, depsDe())
  assert.equal(estado.ok, true)
  assert.equal(estado.sesion, "SIN_SESION")
  assert.equal((await vivo(dir, { accion: "accionar", componente: "cmp-1", nivel: "alto" }, depsDe())).codigo, "SIN_SESION")
  assert.equal((await vivo(dir, { accion: "desconectar" }, depsDe())).sesion, "SIN_SESION")
  assert.deepEqual([...ACCIONES_VIVO], ["cargar", "conectar", "estado", "accionar", "leer", "desconectar"])
})

test("cargar / conectar sin placa en el proyecto: PROYECTO_SIN_PLACA, sin tocar el puerto", async () => {
  const dir = await armar([])
  for (const accion of ["cargar", "conectar"]) {
    const r = await vivo(dir, { accion }, depsDe())
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "PROYECTO_SIN_PLACA", accion)
  }
  assert.equal(duenoDelPuerto(PUERTO), undefined)
})

test("sólo ESP32: con un Arduino UNO, cargar y conectar devuelven PLACA_NO_SOPORTADA_EN_VIVO sin detectar ni tocar el puerto", async () => {
  const dir = await armar([{ tipo: "SetPlaca", payload: { placa: "arduino-uno" } }])
  let detecciones = 0
  const deps = depsDe({ detectarPuerto: async () => (detecciones++, { port: PUERTO }) })
  for (const accion of ["cargar", "conectar"]) {
    const r = await vivo(dir, { accion }, deps)
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "PLACA_NO_SOPORTADA_EN_VIVO", accion)
    assert.equal(r.placa, "arduino-uno")
    assert.match(r.resultado, /sólo ESP32/)
  }
  assert.equal(detecciones, 0)
  assert.equal(duenoDelPuerto(PUERTO), undefined)
})

// ───────────────────────────── cargar ─────────────────────────────────────────────────

test("cargar: materializa el runtime generado en la carpeta derivada de la placa y se lo da a PlatformIO con environment y puerto", async () => {
  const dir = await armar(OPS)
  const cargas = []
  const r = await vivo(dir, { accion: "cargar" }, depsDe({ cargas }))
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /^RUNTIME CARGADO/)
  assert.equal(r.placa, "esp32-devkit-v1")
  assert.equal(r.runtime, "0.1.0")
  assert.equal(r.puerto, PUERTO)
  assert.equal(cargas.length, 1)
  assert.equal(cargas[0].carpeta, carpetaDelRuntime(dir, "esp32-devkit-v1"))
  assert.equal(cargas[0].environment, "esp32-devkit-v1")
  assert.equal(cargas[0].puerto, PUERTO)
  assert.equal(cargas[0].enDisco, true, "el main.cpp ya estaba en disco cuando se llamó a PlatformIO")
  assert.match(readFileSync(join(cargas[0].carpeta, "src", "main.cpp"), "utf8"), /^\/\/ runtime de prueba/)
  assert.ok(r.archivos["src/main.cpp"].sha256.length === 64)
  assert.equal(duenoDelPuerto(PUERTO), undefined, "cargar no deja el puerto reservado")
})

test("cargar: si PlatformIO falla se dice con código, y 127 es PLATFORMIO_NO_ENCONTRADO", async () => {
  const dir = await armar(OPS)
  assert.equal((await vivo(dir, { accion: "cargar" }, depsDe({ codigoCarga: 1 }))).codigo, "CARGA_FALLIDA")
  assert.equal((await vivo(dir, { accion: "cargar" }, depsDe({ codigoCarga: 127 }))).codigo, "PLATFORMIO_NO_ENCONTRADO")
  const sinPlaca = await vivo(dir, { accion: "cargar" }, depsDe({ detectarPuerto: async () => ({ error: "no hay placa" }) }))
  assert.equal(sinPlaca.codigo, "PLACA_NO_DETECTADA")
  assert.equal((await vivo(dir, { accion: "cargar", puerto: "rm -rf /" }, depsDe())).codigo, "PUERTO_INVALIDO")
})

// ───────────────────────────── conectar / desconectar y el puerto ─────────────────────

test("conectar reserva el puerto; cargar, platformio flash, programa cargar y otra sesión lo respetan; desconectar lo libera", async () => {
  const dir = await armar(OPS)
  const sesion = sesionFalsa()
  const r = await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /^CONECTADO/)
  assert.equal(r.estado.sesion, "CONECTADA")
  assert.notEqual(duenoDelPuerto(PUERTO), undefined, "el puerto quedó reservado")

  assert.match((await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))).resultado, /^YA CONECTADO/)
  assert.equal((await vivo(dir, { accion: "cargar" }, depsDe({ sesion }))).codigo, "PUERTO_EN_SESION_VIVA")
  const otro = await armar(OPS)
  assert.equal((await vivo(otro, { accion: "conectar" }, depsDe())).codigo, "PUERTO_EN_SESION_VIVA", "otro proyecto no puede tomar el mismo puerto")

  // La exclusión, probada directo (A2 M3: antes sólo se afirmaba si PlatformIO estaba instalado).
  assert.match(puertoEnSesionViva(PUERTO), /^PUERTO_EN_SESION_VIVA/)
  assert.equal(puertoEnSesionViva("/dev/ttyUSB8"), null)
  // Y por las tools, cuando esta máquina tiene PlatformIO visible (si no, el pre-chequeo de esa tool gana y se salta).
  const flash = await platformioTool.execute({ action: "flash", port: PUERTO }, { directory: dir })
  if (!/no esta instalado/.test(flash)) {
    assert.match(flash, /PUERTO_EN_SESION_VIVA/)
    assert.match(await platformioTool.execute({ action: "monitor", port: PUERTO }, { directory: dir }), /PUERTO_EN_SESION_VIVA/)
  } else {
    assert.match(flash, /no esta instalado/, "sin PlatformIO visible desde el test: la exclusión por las tools se prueba en el E2E físico")
  }

  const estado = await vivo(dir, { accion: "estado" }, depsDe({ sesion }))
  assert.equal(estado.puerto, PUERTO)
  const cierre = await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
  assert.match(cierre.resultado, /^SESIÓN CERRADA/)
  assert.equal(duenoDelPuerto(PUERTO), undefined)
  assert.ok(sesion.llamadas.some((l) => l[0] === "cerrar"))
})

test("conectar con un runtime incompatible o un puente que no abre: no queda sesión ni puerto reservado", async () => {
  const dir = await armar(OPS)
  const incompatible = sesionFalsa({ sesion: "RUNTIME_INCOMPATIBLE" })
  const r = await vivo(dir, { accion: "conectar" }, depsDe({ sesion: incompatible }))
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "RUNTIME_INCOMPATIBLE")
  assert.equal(duenoDelPuerto(PUERTO), undefined)
  assert.ok(incompatible.llamadas.some((l) => l[0] === "cerrar"))
  assert.equal((await vivo(dir, { accion: "estado" }, depsDe())).sesion, "SIN_SESION")

  const sinPuerto = await vivo(dir, { accion: "conectar" }, depsDe({ abrirPuenteSerie: async () => { throw new Error("PUERTO_NO_ABIERTO: ocupado") } }))
  assert.equal(sinPuerto.codigo, "PUERTO_NO_ABIERTO")
  assert.match(sinPuerto.resultado, /monitor serie/, "la causa más común (A1 M1): otro lector del puerto")
  assert.equal(duenoDelPuerto(PUERTO), undefined)
})

test("X2: conectar sobre una sesión que ya se cayó NO es «ya conectado»: la cierra, libera el puerto y reconecta", async () => {
  // Auditoría 2026-10-13 (A1-A2, A2-A3): con la sesión DESCONECTADA (cable, hijo Python muerto) la
  // tool contestaba `ok: true` "YA CONECTADO — sesión DESCONECTADA" y dejaba el puerto reservado.
  const dir = await armar(OPS)
  const primera = sesionFalsa()
  assert.equal((await vivo(dir, { accion: "conectar" }, depsDe({ sesion: primera }))).ok, true)
  primera.caer("SIN_PONG")
  // V4-9: al caerse, la tool libera el puerto en el acto (alCierre), sin esperar un 'desconectar'.
  assert.equal(duenoDelPuerto(PUERTO), undefined, "el puerto se liberó al caer la sesión")
  const estado = await vivo(dir, { accion: "estado" }, depsDe({ sesion: primera }))
  assert.equal(estado.sesion, "SIN_SESION", "una sesión caída no figura como abierta")

  // Y aunque la sesión caída siguiera registrada (cierre sin aviso), 'conectar' la reemplaza.
  const segunda = sesionFalsa()
  const r = await vivo(dir, { accion: "conectar" }, depsDe({ sesion: segunda }))
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /^CONECTADO/)
  assert.equal(r.estado.sesion, "CONECTADA")
  assert.notEqual(duenoDelPuerto(PUERTO), undefined)

  const tercera = sesionFalsa()
  // Una sesión registrada que no está CONECTADA pero tampoco avisó: se cierra y se reconecta con `anterior`.
  await vivo(dir, { accion: "desconectar" }, depsDe())
  const deps3 = depsDe({ sesion: tercera })
  // Para registrarla hay que entrar CONECTADA; después cambia de estado sin disparar alCierre.
  const viva = sesionFalsa()
  assert.equal((await vivo(dir, { accion: "conectar" }, depsDe({ sesion: viva }))).ok, true)
  viva.estado = () => Object.freeze({ sesion: "DESCONECTADA", motivo: "SIN_PONG", placa: esp32, componentes: [] })
  const reconectada = await vivo(dir, { accion: "conectar" }, deps3)
  assert.equal(reconectada.ok, true, JSON.stringify(reconectada))
  assert.deepEqual(reconectada.anterior, { sesion: "DESCONECTADA", motivo: "SIN_PONG" })
  assert.match(reconectada.resultado, /la sesión anterior estaba DESCONECTADA; se cerró y se volvió a conectar/)
  assert.ok(viva.llamadas.some((l) => l[0] === "cerrar"), "la vieja se cerró")
  // Y cargar sobre una sesión caída tampoco se bloquea: la cierra y carga.
  viva.estado = () => Object.freeze({ sesion: "DESCONECTADA", placa: esp32, componentes: [] })
  tercera.estado = viva.estado
  const cargas = []
  const c = await vivo(dir, { accion: "cargar" }, depsDe({ cargas }))
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.equal(cargas.length, 1)
  assert.equal(duenoDelPuerto(PUERTO), undefined)
})

// ───────────────────────────── accionar / leer ────────────────────────────────────────

test("accionar y leer por componente van a la sesión con la petición traducida; las validaciones de argumentos no la tocan", async () => {
  const dir = await armar(OPS)
  const sesion = sesionFalsa()
  assert.equal((await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))).ok, true)
  const antes = sesion.llamadas.length

  for (const [args, codigo] of [
    [{}, "DESTINO_FALTANTE"],
    [{ componente: "cmp-1", pin: "GPIO18", nivel: "alto" }, "DESTINO_AMBIGUO"],
    [{ componente: "cmp-1", nivel: "alto", porcentaje: 10 }, "ACCION_AMBIGUA"],
    [{ componente: "cmp-1" }, "ACCION_INVALIDA"],
    [{ componente: "cmp-1", nivel: "encendido" }, "ACCION_INVALIDA"],
    [{ componente: "cmp-1", porcentaje: 150 }, "ACCION_INVALIDA"],
    [{ componente: "cmp-1", porcentaje: 2.5 }, "ACCION_INVALIDA"],
  ]) {
    const r = await vivo(dir, { accion: "accionar", ...args }, depsDe({ sesion }))
    assert.equal(r.codigo, codigo, JSON.stringify(args))
  }
  assert.equal(sesion.llamadas.length, antes, "ninguna validación fallida llegó a la sesión")

  const alto = await vivo(dir, { accion: "accionar", componente: "cmp-1", nivel: "alto" }, depsDe({ sesion }))
  assert.equal(alto.ok, true)
  assert.match(alto.resultado, /^ACCIONADO/)
  assert.deepEqual(sesion.llamadas.at(-1), ["accionar", "cmp-1", { tipo: "nivel", nivel: "alto" }])
  const pwm = await vivo(dir, { accion: "accionar", componente: "cmp-1", porcentaje: 0 }, depsDe({ sesion }))
  assert.equal(pwm.ok, true)
  assert.deepEqual(sesion.llamadas.at(-1), ["accionar", "cmp-1", { tipo: "pwm", porcentaje: 0 }])
  const lectura = await vivo(dir, { accion: "leer", componente: "cmp-0" }, depsDe({ sesion }))
  assert.equal(lectura.ok, true)
  assert.deepEqual(sesion.llamadas.at(-1), ["leer", "cmp-0"])
  assert.deepEqual(lectura.respuesta, { tipo: "lectura", pin: 4, nivel: "alto" })
  assert.ok(lectura.estado, "toda respuesta trae el estado observado para que el agente hable sólo de lo observado")
  assert.equal(lectura.estado.placa, "esp32-devkit-v1", "la placa va como id: el objeto entero era ruido (E2E 2026-10-12, hallazgo 3)")
  assert.equal(alto.estado.placa, "esp32-devkit-v1")
  await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
})

test("por pin: GPIO34 se lee analógico y GPIO4 digital según placas.ts; un pin que no existe en la placa se rechaza en la tool, sin centinela ni sesión", async () => {
  const dir = await armar(OPS)
  const sesion = sesionFalsa()
  assert.equal((await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))).ok, true)
  const analogica = await vivo(dir, { accion: "leer", pin: "GPIO34" }, depsDe({ sesion }))
  assert.deepEqual(sesion.llamadas.at(-1), ["comando", { comando: "analogico.leer", pin: 34 }])
  assert.equal(analogica.respuesta.crudo, 2048)
  await vivo(dir, { accion: "leer", pin: "GPIO4" }, depsDe({ sesion }))
  assert.deepEqual(sesion.llamadas.at(-1), ["comando", { comando: "digital.leer", pin: 4 }])
  await vivo(dir, { accion: "accionar", pin: "GPIO23", porcentaje: 40 }, depsDe({ sesion }))
  assert.deepEqual(sesion.llamadas.at(-1), ["comando", { comando: "pwm.escribir", pin: 23, porcentaje: 40 }])
  await vivo(dir, { accion: "accionar", pin: "GPIO23", nivel: "bajo" }, depsDe({ sesion }))
  assert.deepEqual(sesion.llamadas.at(-1), ["comando", { comando: "digital.escribir", pin: 23, nivel: "bajo" }])
  const antes = sesion.llamadas.length
  const inexistente = await vivo(dir, { accion: "leer", pin: "GPIO99" }, depsDe({ sesion }))
  assert.equal(inexistente.ok, false)
  assert.equal(inexistente.codigo, "PIN_INEXISTENTE_EN_PLACA")
  assert.equal(sesion.llamadas.length, antes, "A6 C-04: ya no viaja un -1 a la sesión")
  assert.doesNotMatch(FUENTE_TOOL, /\?\? -1/)
  await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
})

// ───────────────────────────── la tool no es otra autoridad ───────────────────────────

test("la tool no escribe en la IR ni en el almacén, y su descripción es el contrato de entrada/salida con la invariante", () => {
  assert.doesNotMatch(FUENTE_TOOL, /\.(aplicar|aplicarTransaccion|proponer)\(/)
  assert.doesNotMatch(FUENTE_TOOL, /almacen|crearAlmacen/)
  assert.match(vivoTool.description, /OBSERVÓ/)
  assert.match(vivoTool.description, /Nunca afirmes que un componente "está conectado"/)
  assert.match(vivoTool.description, /RUNTIME_INCOMPATIBLE/)
  assert.match(vivoTool.description, /PUERTO_EN_SESION_VIVA/)
  assert.match(vivoTool.description, /PLACA_NO_SOPORTADA_EN_VIVO/)
  assert.match(vivoTool.description, /`masPines`/)
  // A6 M-02: la descripción no repite la pedagogía del prompt (la pregunta del nombre vive sólo en el prompt).
  assert.doesNotMatch(vivoTool.description, /¿Cómo querés que se llame/)
})

test("el prompt: permiso `vivo`, regla del laboratorio con el orden cargar → conectar, y sólo lo OBSERVADO", () => {
  assert.match(PROMPT, /^\s+vivo:\s*"allow"$/m)
  const seccion = seccionDelPrompt()
  assert.match(seccion, /tool `vivo`/)
  assert.match(seccion, /`cargar`[\s\S]*→[\s\S]*`conectar`[\s\S]*`desconectar`/)
  assert.match(seccion, /RUNTIME_INCOMPATIBLE[^\n]*`cargar`/)
  assert.match(seccion, /PUERTO_EN_SESION_VIVA/)
  assert.match(seccion, /Sólo afirmás lo OBSERVADO/)
  assert.match(seccion, /la placa no ve el LED/)
  assert.match(seccion, /brownout/)
  assert.match(seccion, /reglas[^\n]*programa/i)
  // Auditoría 2026-10-13 (A4, A5, A1-B3/B4): lo que faltaba decir.
  assert.match(seccion, /Sólo ESP32/)
  assert.match(seccion, /PLACA_NO_SOPORTADA_EN_VIVO/)
  assert.match(seccion, /DHT[\s\S]{0,40}ultrasónico[\s\S]{0,40}DS18B20/, "dice qué sensores NO se leen en vivo")
  assert.match(seccion, /preguntá cuál antes/)
  assert.match(seccion, /borra lo que la placa\s+tenía/)
  assert.match(seccion, /sin nombres ni apellidos de personas/)
  assert.match(seccion, /una sola vez/)
  assert.match(seccion, /no sirve para un servo/)
  assert.match(seccion, /`masPines`/)
  assert.match(seccion, /`programa cargar`/)
})

test("los códigos que el prompt cita en la regla del Modo Vivo existen (A6 M-01: LECTURA_INVALIDA no existía)", () => {
  const seccion = seccionDelPrompt()
  const citados = new Set([...seccion.matchAll(/`([A-Z][A-Z_]{4,})`/g)].map((m) => m[1]))
  assert.ok(citados.size >= 10, `pocos códigos citados: ${[...citados].join(", ")}`)
  const deLaTool = [...vivoTool.description.matchAll(/\b([A-Z][A-Z_]{4,})\b/g)].map((m) => m[1])
  const deLaSesion = [...readFileSync(join(REPO, "opencode/vivo/sesion-viva.ts"), "utf8").matchAll(/"([A-Z][A-Z_]{4,})"/g)].map((m) => m[1])
  const conocidos = new Set([...deLaTool, ...deLaSesion, ...P.CODIGOS_DE_ERROR, "CONECTADA", "CONECTANDO", "DESCONECTADA", "CARGADO"])
  for (const codigo of citados) assert.ok(conocidos.has(codigo), `el prompt cita \`${codigo}\`, que no existe en la tool, la sesión ni el protocolo`)
  assert.doesNotMatch(seccion, /LECTURA_INVALIDA/)
})

test("los instaladores llevan vivo/ (hermano de tool/, nunca adentro) y la lista del manifest", () => {
  const leer = (f) => readFileSync(join(REPO, "install", f), "utf8")
  const installSh = leer("install.sh")
  assert.match(installSh, /mkdir -p "\$CONFIG_DIR"\/\{[^}]*\bvivo\b[^}]*\}/)
  assert.match(installSh, /cp -r "\$SRC\/vivo\/\." "\$CONFIG_DIR\/vivo\/"/)
  assert.match(installSh, /find agent tool [^|]*\bvivo\b[^|]* -type f/)
  const installPs1 = leer("install.ps1")
  assert.equal((installPs1.match(/"vivo", "conocimiento", "codegen"\)\)/g) ?? []).length, 2)
  assert.match(installPs1, /Copy-Item \(Join-Path \$Src "vivo\\\*"\) \(Join-Path \$ConfigDir "vivo\\"\) -Recurse -Force/)
  assert.match(leer("uninstall.ps1"), /"vivo", "conocimiento", "codegen"\)\) \{/)
  assert.match(leer("uninstall.sh"), /"\$CONFIG_DIR\/vivo" "\$CONFIG_DIR\/conocimiento" "\$CONFIG_DIR\/codegen" -type d -empty -delete/)
  assert.doesNotMatch(installPs1 + leer("uninstall.ps1"), /[^\x00-\x7F]/, "los .ps1 siguen siendo ASCII")
})

// ───────────────────────────── V4: la red propia de la placa ──────────────────────────

test("V4-4 cargar: la red va abierta por defecto (clave vacía al generador); con redConClave sortea 8 dígitos y los imprime UNA vez", async () => {
  const dir = await armar(OPS)
  const cargas = []
  const abierta = await vivo(dir, { accion: "cargar" }, depsDe({ cargas }))
  assert.equal(abierta.ok, true, JSON.stringify(abierta))
  assert.deepEqual(abierta.wifi, { abierta: true, clave: "", ssid: null, pagina: P.URL_PORTAL })
  assert.equal(P.URL_PORTAL, "http://192.168.4.1/", "A6 M-03: la URL sale del contrato")
  assert.match(abierta.resultado, /abierta, sin clave/)
  assert.match(readFileSync(join(cargas[0].carpeta, "src", "main.cpp"), "utf8"), /clave \n/, "el generador recibió la clave vacía (red abierta)")

  const conClave = await vivo(dir, { accion: "cargar", redConClave: true }, depsDe({ cargas }))
  assert.equal(conClave.ok, true)
  assert.deepEqual(conClave.wifi, { abierta: false, clave: "48213907", ssid: null, pagina: P.URL_PORTAL })
  assert.match(conClave.resultado, /con clave 48213907 \(anotala: no se vuelve a mostrar\)/)
  assert.match(readFileSync(join(cargas[1].carpeta, "src", "main.cpp"), "utf8"), /clave 48213907/, "el generador recibió la clave")
})

test("V4 conectar: muestra la red que anunció el hola; la clave NO se repite (A1 M2), sólo `claveConfigurada`", async () => {
  const dir = await armar(OPS)
  for (const [clave, esperado] of [
    ["", /"tecnia-3f2a", abierta \(sin clave\)/],
    ["48213907", /"tecnia-3f2a", con clave \(la que imprimió 'cargar'\)/],
  ]) {
    const sesion = sesionFalsa({ wifi: { ssid: "tecnia-3f2a", clave, ip: "192.168.4.1" } })
    const c = await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))
    assert.equal(c.ok, true, JSON.stringify(c))
    assert.match(c.resultado, esperado)
    assert.match(c.resultado, /192\.168\.4\.1/)
    assert.deepEqual(c.estado.runtime.wifi, { ssid: "tecnia-3f2a", ip: "192.168.4.1", claveConfigurada: clave !== "" })
    const estado = await vivo(dir, { accion: "estado" }, depsDe({ sesion }))
    assert.doesNotMatch(JSON.stringify(estado), /48213907/, "la clave no viaja en cada respuesta")
    await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
  }
})

test("V4: la clave real (sortearClaveWifi) es de 8 dígitos y cambia entre sorteos", () => {
  const claves = new Set(Array.from({ length: 20 }, sortearClaveWifi))
  for (const c of claves) assert.match(c, /^\d{8}$/)
  assert.ok(claves.size > 1)
  assert.match(FUENTE_TOOL, /sortearClave: sortearClaveWifi/, "A2 M2: la tool usa la función que se prueba, no una copia")
})

test("V4 cadena completa: hola.wifi del runtime simulado → sesión REAL → estado de la tool (A2-A4)", async () => {
  // Mutante que sobrevivía a las cinco suites: borrar el spread de `wifi` en `aplicarHola`.
  const dir = await armar(OPS)
  const wifi = { ssid: "MI_ESP", clave: "48213907", ip: "192.168.4.1" }
  const runtime = crearRuntimeSimulado({ wifi })
  const receptores = new Set()
  const cierres = new Set()
  const entregar = (lineas) => queueMicrotask(() => { for (const linea of lineas) for (const r of receptores) r(linea) })
  const puente = {
    enviar: (linea) => entregar(runtime.procesar(linea)),
    alRecibir: (cb) => (receptores.add(cb), () => receptores.delete(cb)),
    alCerrar: (cb) => (cierres.add(cb), () => cierres.delete(cb)),
    cerrar: async () => { for (const c of cierres) c("CERRADO_POR_TEST") },
  }
  const deps = depsDe({
    puente,
    abrirSesion: (opciones) => {
      const promesa = abrirSesion(opciones)
      entregar(runtime.arrancar())
      return promesa
    },
  })
  const c = await vivo(dir, { accion: "conectar" }, deps)
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.equal(c.estado.sesion, "CONECTADA")
  assert.deepEqual(c.estado.runtime.wifi, { ssid: "MI_ESP", ip: "192.168.4.1", claveConfigurada: true })
  assert.match(c.resultado, /"MI_ESP", con clave/)
  // Y un comando real de punta a punta por el mismo camino.
  const alto = await vivo(dir, { accion: "accionar", componente: "cmp-1", nivel: "alto" }, deps)
  assert.equal(alto.ok, true, JSON.stringify(alto))
  assert.deepEqual(alto.respuesta, { tipo: "ok", comando: "digital.escribir", pin: 18 })
  await vivo(dir, { accion: "desconectar" }, deps)
  assert.equal(duenoDelPuerto(PUERTO), undefined)
})

test("V4-5 cargar: nombreRed fija el SSID (validado por el contrato) y por defecto no se manda ninguno (la placa usa tecnia-xxxx)", async () => {
  const dir = await armar(OPS)
  const recibidas = []
  const deps = depsDe({ generarRuntime: (placa, opciones) => { recibidas.push(opciones); return { archivos: { "platformio.ini": "", "src/main.cpp": "" }, environment: placa.id, runtime: "0.1.0", protocolo: 1 } } })
  const porDefecto = await vivo(dir, { accion: "cargar" }, deps)
  assert.equal(porDefecto.ok, true, JSON.stringify(porDefecto))
  assert.deepEqual(recibidas.at(-1).wifi, { clave: "" })
  assert.equal(porDefecto.wifi.ssid, null)
  const fijo = await vivo(dir, { accion: "cargar", nombreRed: "MI_ESP" }, deps)
  assert.equal(fijo.ok, true)
  assert.deepEqual(recibidas.at(-1).wifi, { clave: "", ssid: "MI_ESP" })
  assert.equal(fijo.wifi.ssid, "MI_ESP")
  assert.match(fijo.resultado, /"MI_ESP", abierta, sin clave/)
  const invalido = await vivo(dir, { accion: "cargar", nombreRed: 'red "rara"' }, deps)
  assert.equal(invalido.codigo, "NOMBRE_RED_INVALIDO")
  assert.doesNotMatch(FUENTE_TOOL, /nombreDeRedValido/, "A6 L-04: sin alias de esSsidValido")
})

test("V4: el prompt explica la red de la placa, manda a preguntar el nombre y prohíbe afirmar lo que pasó por la página", () => {
  const seccion = seccionDelPrompt()
  assert.match(seccion, /red WiFi/)
  assert.match(seccion, /192\.168\.4\.1/)
  assert.match(seccion, /no\s+afirmes[\s\S]*página/i)
  assert.match(seccion, /¿Cómo querés que se\s+llame la red de tu placa\?/)
  assert.match(seccion, /`nombreRed`/)
  assert.match(seccion, /cada grupo un nombre distinto/)
})

// ───────────────────────────── V4-6c: la página, sin pines de más ─────────────────────

test("V4-6c paginaDelProyecto: por defecto SÓLO los pines del proyecto más las analógicas de la placa; sin «más pines»", async () => {
  // A1-A3: «más pines» ofrecía todas las salidas de la placa a cualquiera que se uniera a la red abierta.
  const dir = await armar(OPS)
  const recibidas = []
  const deps = depsDe({ generarRuntime: (placa, opciones) => { recibidas.push(opciones); return { archivos: { "platformio.ini": "", "src/main.cpp": "" }, environment: placa.id, runtime: "0.1.0", protocolo: 1 } } })
  const r = await vivo(dir, { accion: "cargar" }, deps)
  assert.equal(r.ok, true, JSON.stringify(r))
  const pagina = recibidas.at(-1).pagina
  assert.deepEqual(pagina.salidas, [18])
  assert.deepEqual(pagina.salidasExtra, [], "sin masPines no hay salidas de más")
  assert.equal(pagina.salidasConAviso, undefined)
  assert.deepEqual(pagina.entradasDigitales, [4])
  assert.ok(pagina.entradasAnalogicas.includes(34) && !pagina.entradasAnalogicas.includes(4), "las analógicas de la placa, sin las usadas")
  assert.deepEqual(r.pagina, pagina, "la respuesta de cargar dice qué pines ofrece la página")
})

test("V4-6c paginaDelProyecto con masPines: salidas libres sin prohibidos ni solo-entrada; strapping aparte con aviso; nunca un pin en dos roles", () => {
  const proyecto = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("vivo-pagina"), idProyecto: "activo" })
  const servicio = proyecto
  const aplicar = (tipo, payload) => {
    const r = servicio.aplicar({ idOperacion: `pag-${tipo}-${Math.random()}`, actor: "navegador", baseRevision: servicio.snapshot().revision, tipo, payload })
    assert.equal(r.ok, true, JSON.stringify(r))
  }
  aplicar("SetPlaca", { placa: "esp32-devkit-v1" })
  aplicar("AgregarComponente", { tipo: "led" })
  aplicar("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO32" }) // un LED en un pin con ADC
  const ir = servicio.snapshot().proyecto

  const sinMas = paginaDelProyecto(esp32, ir, K)
  assert.deepEqual(sinMas.salidas, [32])
  assert.ok(!sinMas.entradasAnalogicas.includes(32), "GPIO32 es salida del proyecto: no se ofrece como analógica (A2-A1)")
  assert.deepEqual(sinMas.salidasExtra, [])

  const conMas = paginaDelProyecto(esp32, ir, K, { masPines: true })
  assert.deepEqual(conMas.salidas, [32])
  for (const prohibido of [1, 3, 6, 7, 8, 9, 10, 11]) assert.ok(!conMas.salidasExtra.includes(prohibido) && !(conMas.salidasConAviso ?? []).includes(prohibido), `GPIO${prohibido} no se ofrece`)
  for (const soloEntrada of [34, 35, 36, 39]) assert.ok(!conMas.salidasExtra.includes(soloEntrada), `GPIO${soloEntrada} no es salida`)
  // Los strapping (H-A1, CK-CG1) van aparte, al final y con aviso; nunca mezclados con las salidas comunes.
  const strapping = esp32.pines.filter((p) => p.restricciones.includes("strapping") || p.restricciones.includes("strappingVddSdio")).map((p) => p.numero)
  assert.deepEqual(conMas.salidasConAviso, strapping.sort((a, b) => a - b))
  for (const s of strapping) assert.ok(!conMas.salidasExtra.includes(s), `GPIO${s} es strapping: va con aviso`)
  assert.ok(conMas.salidasExtra.includes(18) && conMas.salidasExtra.includes(23))
  // Nunca un pin en dos listas (A2-A1: tras `analogico.leer` el core deja el pin sin salida).
  const todas = [...conMas.salidas, ...conMas.salidasExtra, ...(conMas.salidasConAviso ?? []), ...conMas.entradasDigitales, ...conMas.entradasAnalogicas]
  assert.equal(new Set(todas).size, todas.length, `un pin en dos roles: ${todas.join(", ")}`)
  assert.ok(conMas.entradasAnalogicas.includes(34), "las analógicas que NO se ofrecen como salida siguen")
  assert.ok(!conMas.entradasAnalogicas.includes(33), "GPIO33 se ofrece como salida con masPines: no también como analógica")
  servicio.cerrar?.()
})
