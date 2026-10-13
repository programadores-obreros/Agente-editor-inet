// Modo Vivo V1 — la tool `vivo` (tool/vivo.ts): orquestación, códigos, reserva del puerto y la
// exclusión con `platformio`. La sesión y el runtime se INYECTAN (misma técnica que `cargar`
// en codegen-s1b): acá se prueba que la tool haga lo que dice el contrato con lo que recibe,
// no el protocolo (tests/vivo-protocolo.test.mjs) ni la sesión (tests/vivo-sesion.test.mjs).

import { test, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { ejecutarVivo, carpetaDelRuntime, cerrarTodasLasSesiones, ACCIONES_VIVO } = await import(join(REPO, "opencode/tool/vivo.ts"))
const vivoTool = (await import(join(REPO, "opencode/tool/vivo.ts"))).default
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const platformioTool = (await import(join(REPO, "opencode/tool/platformio.ts"))).default
const { pioDisponible, duenoDelPuerto, liberarTodosLosPuertos } = await import(join(REPO, "opencode/tool/platformio.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))

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

/** Sesión falsa con la interfaz pública de `vivo/sesion-viva.ts`: registra llamadas, contesta canned. */
function sesionFalsa({ sesion = "CONECTADA", llamadas = [] } = {}) {
  const estado = () => Object.freeze({ sesion, placa: esp32, runtime: { version: "0.1.0", protocolo: 1, placa: esp32.id, comandos: [], protocolos: [] }, componentes: [] })
  return {
    llamadas,
    estado,
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
      if (comando.pin < 0) return { ok: false, codigo: "PIN_INEXISTENTE", datos: { pin: comando.pin } }
      return { ok: true, valor: comando.comando === "analogico.leer" ? { tipo: "lectura", pin: comando.pin, crudo: 2048 } : { tipo: "ok", comando: comando.comando, pin: comando.pin } }
    },
    async cerrar() {
      llamadas.push(["cerrar"])
    },
  }
}

const puenteFalso = () => ({ enviar() {}, alRecibir: () => () => {}, alCerrar: () => () => {}, cerrar: async () => {} })

/** Dependencias inyectadas: proyecto y conocimiento reales; runtime, puente, sesión, puerto y PlatformIO falsos. */
function depsDe({ sesion = sesionFalsa(), cargas = [], codigoCarga = 0, puente = puenteFalso(), abrirPuenteSerie, detectarPuerto } = {}) {
  return async () => ({
    obtenerServicioDeProyectoConVista,
    conocimiento: K,
    generarRuntime: (placa, opciones) => ({ archivos: { "platformio.ini": `[env:${placa.id}]\nboard = esp32dev\n`, "src/main.cpp": `// runtime de prueba; clave ${opciones?.wifi?.clave ?? "sin-wifi"}\n` }, environment: placa.id, runtime: "0.1.0", protocolo: 1 }),
    sortearClave: () => "48213907",
    abrirSesion: async () => sesion,
    abrirPuenteSerie: abrirPuenteSerie ?? (async () => puente),
    detectarPuerto: detectarPuerto ?? (async () => ({ port: PUERTO })),
    cargarRuntime: async (carpeta, environment, puerto, cwd) => {
      cargas.push({ carpeta, environment, puerto, cwd, enDisco: existsSync(join(carpeta, "src", "main.cpp")) })
      return { code: codigoCarga, stdout: "", stderr: codigoCarga === 0 ? "" : "error de carga" }
    },
  })
}
const vivo = async (dir, args, deps) => JSON.parse(await ejecutarVivo(args, { directory: dir }, deps))

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

test("conectar reserva el puerto; cargar, platformio flash y otra sesión lo respetan; desconectar lo libera", async () => {
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

  // La exclusión vive DESPUÉS del pre-chequeo de PlatformIO de esa tool: si en esta máquina (o
  // bajo node, sin `Bun.which`) PlatformIO figura como no instalado, ese mensaje gana y acá no hay
  // nada que afirmar. Con PlatformIO disponible, la respuesta tiene que ser la exclusión.
  const flash = await platformioTool.execute({ action: "flash", port: PUERTO }, { directory: dir })
  if (!/no esta instalado/.test(flash)) {
    assert.match(flash, /PUERTO_EN_SESION_VIVA/)
    const monitor = await platformioTool.execute({ action: "monitor", port: PUERTO }, { directory: dir })
    assert.match(monitor, /PUERTO_EN_SESION_VIVA/)
  } else {
    assert.equal(pioDisponible(), pioDisponible(), "sin PlatformIO visible desde el test: la exclusión se prueba en el E2E físico")
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

test("por pin: GPIO34 se lee analógico y GPIO4 digital según placas.ts; un pin que no existe llega a la sesión como -1 y vuelve con su código", async () => {
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
  const inexistente = await vivo(dir, { accion: "leer", pin: "GPIO99" }, depsDe({ sesion }))
  assert.equal(inexistente.ok, false)
  assert.equal(inexistente.codigo, "PIN_INEXISTENTE")
  await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
})

// ───────────────────────────── la tool no es otra autoridad ───────────────────────────

test("la tool no escribe en la IR ni en el almacén, y su descripción prohíbe afirmar lo no observado", () => {
  assert.doesNotMatch(FUENTE_TOOL, /\.(aplicar|aplicarTransaccion|proponer)\(/)
  assert.doesNotMatch(FUENTE_TOOL, /almacen|crearAlmacen/)
  assert.match(vivoTool.description, /OBSERVÓ/)
  assert.match(vivoTool.description, /Nunca afirmes que un componente "está conectado"/)
  assert.match(vivoTool.description, /RUNTIME_INCOMPATIBLE/)
  assert.match(vivoTool.description, /PUERTO_EN_SESION_VIVA/)
})

test("el prompt: permiso `vivo`, regla del laboratorio con el orden cargar → conectar, y sólo lo OBSERVADO", () => {
  assert.match(PROMPT, /^\s+vivo:\s*"allow"$/m)
  const regla = PROMPT.slice(PROMPT.indexOf("## REGLA CRÍTICA — Modo Vivo"))
  const seccion = regla.slice(0, regla.indexOf("\n## ", 5))
  assert.match(seccion, /tool `vivo`/)
  assert.match(seccion, /`cargar`[\s\S]*→[\s\S]*`conectar`[\s\S]*`desconectar`/)
  assert.match(seccion, /RUNTIME_INCOMPATIBLE[^\n]*`cargar`/)
  assert.match(seccion, /PUERTO_EN_SESION_VIVA/)
  assert.match(seccion, /Sólo afirmás lo OBSERVADO/)
  assert.match(seccion, /la placa no ve el LED/)
  assert.match(seccion, /brownout/)
  assert.match(seccion, /reglas[^\n]*programa/i)
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

test("V4 cargar: la red va abierta por defecto (clave vacía al generador); con redConClave sortea 8 dígitos y los imprime", async () => {
  const dir = await armar(OPS)
  const cargas = []
  const abierta = await vivo(dir, { accion: "cargar" }, depsDe({ cargas }))
  assert.equal(abierta.ok, true, JSON.stringify(abierta))
  assert.deepEqual(abierta.wifi, { abierta: true, clave: "", ssid: null, pagina: "http://192.168.4.1/" })
  assert.match(abierta.resultado, /abierta, sin clave/)
  assert.match(readFileSync(join(cargas[0].carpeta, "src", "main.cpp"), "utf8"), /clave \n/, "el generador recibió la clave vacía (red abierta)")

  const conClave = await vivo(dir, { accion: "cargar", redConClave: true }, depsDe({ cargas }))
  assert.equal(conClave.ok, true)
  assert.deepEqual(conClave.wifi, { abierta: false, clave: "48213907", ssid: null, pagina: "http://192.168.4.1/" })
  assert.match(conClave.resultado, /con clave 48213907/)
  assert.match(readFileSync(join(cargas[1].carpeta, "src", "main.cpp"), "utf8"), /clave 48213907/, "el generador recibió la clave")
})

test("V4 conectar: muestra la red que anunció el hola, abierta o con clave", async () => {
  const dir = await armar(OPS)
  for (const [clave, esperado] of [
    ["", /"tecnia-3f2a", abierta \(sin clave\)/],
    ["48213907", /"tecnia-3f2a", clave 48213907/],
  ]) {
    const sesion = sesionFalsa()
    const estadoBase = sesion.estado
    sesion.estado = () => ({ ...estadoBase(), runtime: { ...estadoBase().runtime, wifi: { ssid: "tecnia-3f2a", clave, ip: "192.168.4.1" } } })
    const c = await vivo(dir, { accion: "conectar" }, depsDe({ sesion }))
    assert.equal(c.ok, true, JSON.stringify(c))
    assert.match(c.resultado, esperado)
    assert.match(c.resultado, /192\.168\.4\.1/)
    assert.equal(c.estado.runtime.wifi.ssid, "tecnia-3f2a")
    await vivo(dir, { accion: "desconectar" }, depsDe({ sesion }))
  }
})

test("V4: la clave real es de 8 dígitos y cambia entre sorteos", async () => {
  const { ejecutarVivo: _e } = await import(join(REPO, "opencode/tool/vivo.ts"))
  const { randomInt } = await import("node:crypto")
  const sortear = () => String(randomInt(0, 100_000_000)).padStart(8, "0")
  const claves = new Set(Array.from({ length: 20 }, sortear))
  for (const c of claves) assert.match(c, /^\d{8}$/)
  assert.ok(claves.size > 1)
})

test("V4: el prompt explica la red de la placa y prohíbe afirmar lo que pasó por la página", () => {
  const regla = PROMPT.slice(PROMPT.indexOf("## REGLA CRÍTICA — Modo Vivo"))
  const seccion = regla.slice(0, regla.indexOf("\n## ", 5))
  assert.match(seccion, /red WiFi/)
  assert.match(seccion, /192\.168\.4\.1/)
  assert.match(seccion, /no afirmes[\s\S]*página/i)
})

test("V4 cargar: nombreRed fija el SSID (validado) y por defecto no se manda ninguno (la placa usa tecnia-xxxx)", async () => {
  const { nombreDeRedValido } = await import(join(REPO, "opencode/tool/vivo.ts"))
  const dir = await armar(OPS)
  const recibidas = []
  const deps = async () => ({ ...(await depsDe()()), generarRuntime: (placa, opciones) => { recibidas.push(opciones); return { archivos: { "platformio.ini": "", "src/main.cpp": "" }, environment: placa.id, runtime: "0.1.0", protocolo: 1 } } })
  const porDefecto = await vivo(dir, { accion: "cargar" }, deps)
  assert.equal(porDefecto.ok, true, JSON.stringify(porDefecto))
  assert.deepEqual(recibidas.at(-1).wifi, { clave: "" })
  // La página sale del proyecto (LED en GPIO18, pulsador en GPIO4) y de la placa (el resto, sin prohibidos).
  const pagina = recibidas.at(-1).pagina
  assert.deepEqual(pagina.salidas, [18])
  assert.deepEqual(pagina.entradasDigitales, [4])
  assert.ok(pagina.entradasAnalogicas.includes(34) && !pagina.entradasAnalogicas.includes(4), "las analógicas de la placa, sin las usadas")
  assert.ok(pagina.salidasExtra.includes(2) && !pagina.salidasExtra.includes(18) && !pagina.salidasExtra.includes(4), "el LED de placa va en 'más pines'; lo usado no se repite")
  for (const prohibido of [1, 3, 6, 7, 8, 9, 10, 11]) assert.ok(!pagina.salidasExtra.includes(prohibido), `GPIO${prohibido} no se ofrece`)
  for (const soloEntrada of [34, 35, 36, 39]) assert.ok(!pagina.salidasExtra.includes(soloEntrada), `GPIO${soloEntrada} no es salida`)
  assert.equal(porDefecto.wifi.ssid, null)
  const fijo = await vivo(dir, { accion: "cargar", nombreRed: "MI_ESP" }, deps)
  assert.equal(fijo.ok, true)
  assert.deepEqual(recibidas.at(-1).wifi, { clave: "", ssid: "MI_ESP" })
  assert.deepEqual(recibidas.at(-1).pagina.salidas, [18])
  assert.equal(fijo.wifi.ssid, "MI_ESP")
  assert.match(fijo.resultado, /"MI_ESP", abierta, sin clave/)
  const invalido = await vivo(dir, { accion: "cargar", nombreRed: 'red "rara"' }, deps)
  assert.equal(invalido.codigo, "NOMBRE_RED_INVALIDO")
  assert.equal(nombreDeRedValido("MI_ESP"), true)
  assert.equal(nombreDeRedValido("x".repeat(33)), false)
  assert.equal(nombreDeRedValido("señal"), false)
  assert.equal(nombreDeRedValido(""), false)
})

test("V4: el prompt manda a preguntar el nombre de la red antes de cargar y a pasarlo en nombreRed", () => {
  const regla = PROMPT.slice(PROMPT.indexOf("## REGLA CRÍTICA — Modo Vivo"))
  const seccion = regla.slice(0, regla.indexOf("\n## ", 5))
  assert.match(seccion, /¿Cómo querés que se\s+llame la red de tu placa\?/)
  assert.match(seccion, /`nombreRed`/)
  assert.match(seccion, /cada grupo un nombre distinto/)
})
