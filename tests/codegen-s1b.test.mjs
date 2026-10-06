// Codegen MVP, Slice 1b — integración del codegen canónico con el agente.
//
// La tool `programa` lee la IR del proyecto ACTUAL (el mismo servicio que `proyecto-fisico`),
// llama al `generarPrograma` real, materializa los archivos derivados y, para `compilar`, los
// entrega al runner existente de PlatformIO (`platformio.ts::run`). Estos tests usan el Engine,
// el codegen y la tool reales. PlatformIO se reemplaza por un `Bun.spawn` falso que registra
// el comando y lo que había en disco en el instante de compilar (la compilación real está en
// `codegen-s1b-compilacion.test.mjs`, opt-in).

import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const programaTool = (await import(join(REPO, "opencode/tool/programa.ts"))).default
const { ejecutarPrograma, carpetaDelPrograma } = await import(join(REPO, "opencode/tool/programa.ts"))
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const platformioTool = (await import(join(REPO, "opencode/tool/platformio.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const FUENTE_TOOL = readFileSync(join(REPO, "opencode/tool/programa.ts"), "utf8")

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures: todo por las tools reales, como lo haría el agente
// ════════════════════════════════════════════════════════════════════════════════════

const PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const reglaLed = { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0", ...PRESIONADO }, entonces: { actuador: "cmp-1", accion: "encender" } } } }
const opsBase = (placa = "esp32-devkit-v1", pines = ["GPIO4", "GPIO18"]) => [
  { tipo: "SetPlaca", payload: { placa } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: pines[0] } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: pines[1] } },
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
]

const fisico = async (dir, args) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
const programa = async (dir, args) => JSON.parse(await programaTool.execute(args, { directory: dir }))
const servicioDe = (dir) => obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto: "activo" })

async function aplicar(dir, operaciones) {
  const { revision } = await fisico(dir, { accion: "leer" })
  const r = await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones })
  assert.equal(r.ok, true, JSON.stringify(r))
  return r
}
async function armar(operaciones = [...opsBase(), reglaLed]) {
  const dir = nuevoDir("codegen-s1b")
  await aplicar(dir, operaciones)
  return dir
}

const carpetaAbs = (dir) => carpetaDelPrograma(dir, "activo")
function leerCarpeta(carpeta) {
  if (!existsSync(carpeta)) return {}
  const salida = {}
  const recorrer = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".pio") continue
      if (e.isDirectory()) recorrer(join(d, e.name))
      else salida[relative(carpeta, join(d, e.name))] = readFileSync(join(d, e.name), "utf8")
    }
  }
  recorrer(carpeta)
  return salida
}

/** `Bun.spawn` falso: registra comando, cwd y lo que había en la carpeta del programa al spawnear. */
function bunFalso({ codigo = 0, stdout = "", stderr = "", durante } = {}) {
  const llamadas = []
  const anterior = globalThis.Bun
  globalThis.Bun = {
    spawn(cmd, opciones) {
      const dIdx = cmd.indexOf("-d")
      llamadas.push({ cmd: [...cmd], cwd: opciones.cwd, enDisco: dIdx >= 0 ? leerCarpeta(cmd[dIdx + 1]) : null })
      durante?.()
      const cuerpo = (t) => new Response(t).body
      return { stdout: cuerpo(stdout), stderr: cuerpo(stderr), exited: Promise.resolve(codigo), kill() {} }
    },
    which: () => null,
  }
  return { llamadas, restaurar: () => (globalThis.Bun = anterior) }
}

const codegenDe = (dir, conocimiento = K) => generarPrograma(servicioDe(dir).snapshot().proyecto, conocimiento)

// ════════════════════════════════════════════════════════════════════════════════════
// 1–6: generación por la tool = generarPrograma real, sobre la revisión actual
// ════════════════════════════════════════════════════════════════════════════════════

test("1/3/4/5/6 generar: ok, revisión actual, y platformio.ini + main.cpp idénticos a generarPrograma (en la salida y en disco)", async () => {
  const dir = await armar()
  const r = await programa(dir, { accion: "generar" })
  const esperado = codegenDe(dir)
  assert.equal(esperado.ok, true)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.etapa, "generacion")
  assert.equal(r.revision, servicioDe(dir).snapshot().revision)
  assert.match(r.resultado, /^PROGRAMA GENERADO — revisión \d+ \(no se compiló\)$/)
  assert.equal(r.environment, esperado.environment)
  assert.equal(r.carpeta, ".tecnia-vista-fisica/programa/activo")
  assert.deepEqual(Object.keys(r.archivos).sort(), ["platformio.ini", "src/main.cpp"])
  for (const [ruta, contenido] of Object.entries(esperado.archivos)) {
    assert.equal(r.archivos[ruta].contenido, contenido, ruta)
    assert.equal(r.archivos[ruta].sha256, createHash("sha256").update(contenido).digest("hex"))
  }
  assert.deepEqual(leerCarpeta(carpetaAbs(dir)), esperado.archivos)
})

test("2 no hay un segundo renderer: la tool sólo orquesta el codegen", () => {
  assert.match(FUENTE_TOOL, /import\("\.\.\/codegen\/programa\.ts"\)/)
  assert.doesNotMatch(FUENTE_TOOL, /codegen\/(derivaciones|platformio-ini)/)
  for (const prohibido of ["void setup", "void loop", "pinMode(", "digitalWrite(", "digitalRead(", "[env:", "platform =", "board =", "#include"]) {
    assert.ok(!FUENTE_TOOL.includes(prohibido), `la tool contiene «${prohibido}»`)
  }
  for (const prohibido of [/validarProyecto|derivarReadiness/, /admitir(Placa|Componente)|compatibilidadRevisada/, /convertirParaCapacidad/, /complementoDeAccion/]) {
    assert.doesNotMatch(FUENTE_TOOL, prohibido)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7–10: los CODEGEN_* se propagan estructurados, sin fallback
// ════════════════════════════════════════════════════════════════════════════════════

const sinArchivosNiCpp = (r) => {
  assert.ok(!("archivos" in r), "un error de generación no trae archivos")
  assert.doesNotMatch(JSON.stringify(r), /void setup|#include|digitalWrite/, "un error de generación no trae C++")
}

test("7 CODEGEN_PROYECTO_NO_LISTO: se propaga con sus motivos y vacía la carpeta (no queda un programa viejo)", async () => {
  const dir = await armar()
  assert.equal((await programa(dir, { accion: "generar" })).ok, true)
  assert.ok(existsSync(join(carpetaAbs(dir), "src", "main.cpp")))
  await aplicar(dir, [{ tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0" } } } }])
  const r = await programa(dir, { accion: "generar" })
  assert.equal(r.ok, false)
  assert.equal(r.etapa, "generacion")
  assert.equal(r.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  assert.equal(r.revision, servicioDe(dir).snapshot().revision)
  assert.ok(r.datos.motivos.some((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO"))
  assert.deepEqual(r.datos, codegenDe(dir).error.datos, "datos tal cual los da el codegen")
  sinArchivosNiCpp(r)
  assert.deepEqual(leerCarpeta(carpetaAbs(dir)), {}, "la carpeta derivada quedó vacía")
})

test("8 CODEGEN_NO_ADMITIDO: se propaga (UNO sin revisión eléctrica)", async () => {
  const dir = await armar([...opsBase("arduino-uno", ["D2", "D3"]), reglaLed])
  const r = await programa(dir, { accion: "compilar" })
  assert.equal(r.codigo, "CODEGEN_NO_ADMITIDO")
  assert.equal(r.etapa, "generacion", "falla en generación: nunca llega a PlatformIO")
  assert.deepEqual(r.datos, codegenDe(dir).error.datos)
  sinArchivosNiCpp(r)
})

test("9 CODEGEN_SIN_LECTURA: se propaga tal cual (conocimiento de prueba inyectado)", async () => {
  // Fixture: la entrada sin pull-up interno. El catálogo real no tiene un caso admitido sin lectura.
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? { ...c, terminales: c.terminales.map((t) => (t.id === "senal" ? { ...t, requierePullUpInterno: false } : t)) } : c))
  const fixture = crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
  const dir = await armar()
  const cargar = async () => ({ obtenerServicioDeProyectoConVista, conocimiento: fixture, generarPrograma })
  const r = JSON.parse(await ejecutarPrograma({ accion: "compilar" }, { directory: dir }, cargar))
  assert.equal(r.codigo, "CODEGEN_SIN_LECTURA")
  assert.deepEqual(r.datos, codegenDe(dir, fixture).error.datos)
  sinArchivosNiCpp(r)
})

test("10 sin fallback: la descripción de la tool prohíbe escribir el programa a mano", () => {
  assert.match(programaTool.description, /NUNCA escribas el programa a mano/)
  assert.match(programaTool.description, /ni edites los archivos generados/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 11–12 + routing: el contrato del prompt
// ════════════════════════════════════════════════════════════════════════════════════

function seccion(titulo) {
  const i = PROMPT.indexOf(titulo)
  assert.ok(i >= 0, `no está «${titulo}»`)
  const fin = PROMPT.indexOf("\n## ", i + titulo.length)
  return PROMPT.slice(i, fin)
}
const REGLA = seccion("## REGLA CRÍTICA — programa del proyecto físico: se genera, no se escribe")

test("11 el prompt prohíbe el C++ manual del proyecto físico y el fallback ante CODEGEN_*", () => {
  assert.match(REGLA, /\*\*ese programa NO lo escribís vos\.\*\*/)
  assert.match(REGLA, /con la tool `programa`/)
  assert.match(REGLA, /\*\*Si la generación falla con un `CODEGEN_\*`, no hay plan B\.\*\*/)
  assert.match(REGLA, /\*\*Nunca escribas el C\+\+ ni el `platformio\.ini` a mano como\s+alternativa\*\*/)
  assert.match(REGLA, /no uses la\s+tool `platformio` para compilar ni escribas un proyecto aparte/)
  // La regla vieja (el modelo escribe y compila) queda acotada a lo que NO es el proyecto físico.
  const iRegla = PROMPT.indexOf("## REGLA CRÍTICA — programa del proyecto físico")
  const iVieja = PROMPT.indexOf("## REGLA CRÍTICA — el código se compila ANTES de mostrarlo")
  assert.ok(iRegla >= 0 && iRegla < iVieja, "la regla nueva va antes que la del código escrito a mano")
  assert.match(REGLA, /La regla de abajo es para el código que NO es del proyecto físico/)
})

test("12/13 el prompt prohíbe editar el derivado y obliga a regenerar por revisión", () => {
  assert.match(REGLA, /\*\*El código generado es derivado:\*\* no lo edites/)
  assert.match(REGLA, /se cambia el proyecto y se vuelve\s+a generar/)
  assert.match(REGLA, /\*\*El programa corresponde a una revisión del proyecto\.\*\*/)
  assert.match(REGLA, /`vigente: false`/)
  assert.match(REGLA, /Nunca digas que compiló si no ves\s+`COMPILADO`/)
})

test("routing: «mientras… encendé el LED; generá y compilá» → proyecto-fisico → programa (no código a mano)", () => {
  // El pedido de nivel se arma con proyecto-fisico (sección de comportamiento) y el pedido explícito
  // de programa va a la tool `programa`, no al procedimiento de escribir código.
  const i = PROMPT.indexOf("Pedido de COMPORTAMIENTO sin pedido de código")
  const comportamiento = PROMPT.slice(i, PROMPT.indexOf("### Regla de nivel con un número"))
  assert.match(comportamiento, /`SetComportamiento`/)
  assert.match(comportamiento, /pedíselo a la tool `programa`\s+\(`generar`, o `compilar` si quiere compilarlo\)/)
  assert.doesNotMatch(comportamiento, /corre el procedimiento de arriba/)
  const cierres = PROMPT.slice(PROMPT.indexOf("### Cierres mientras se arma el proyecto físico"), PROMPT.indexOf("## REGLA CRÍTICA — circuitos visuales"))
  assert.match(cierres, /se GENERA con la tool `programa`/)
  assert.match(PROMPT.split("---")[1], /^\s{2}programa:\s*"allow"\s*$/m)
})

test("routing ejecutado: leer → aplicar SetComportamiento → programa compilar llega a PlatformIO con lo que generó el codegen", async () => {
  const dir = nuevoDir("codegen-s1b")
  await aplicar(dir, opsBase())
  const { revision } = await fisico(dir, { accion: "leer" })
  assert.equal((await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones: [reglaLed] })).ok, true)
  const bun = bunFalso()
  try {
    const r = await programa(dir, { accion: "compilar" })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(bun.llamadas.length, 1)
    assert.deepEqual(bun.llamadas[0].enDisco, codegenDe(dir).archivos)
  } finally {
    bun.restaurar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 13–16, 24–25: regeneración, environment, frontera de entrada
// ════════════════════════════════════════════════════════════════════════════════════

test("13 después de cambiar el proyecto, generar da la revisión nueva y el programa nuevo", async () => {
  const dir = await armar()
  const a = await programa(dir, { accion: "generar" })
  assert.match(a.archivos["src/main.cpp"].contenido, /PIN_CMP_0_SENAL = 4;/)
  await aplicar(dir, [{ tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO27" } }])
  const b = await programa(dir, { accion: "generar" })
  assert.equal(b.revision, a.revision + 1)
  assert.match(b.archivos["src/main.cpp"].contenido, /PIN_CMP_0_SENAL = 27;/)
  assert.match(readFileSync(join(carpetaAbs(dir), "src", "main.cpp"), "utf8"), /PIN_CMP_0_SENAL = 27;/)
})

test("14/24/25 compilar: environment derivado, y PlatformIO recibe EXACTAMENTE lo generado aunque alguien haya editado la carpeta", async () => {
  const dir = await armar()
  await programa(dir, { accion: "generar" })
  // Alguien (el modelo, a mano) toca la carpeta derivada entre llamadas.
  writeFileSync(join(carpetaAbs(dir), "src", "main.cpp"), "void setup() {} void loop() { /* editado */ }\n")
  mkdirSync(join(carpetaAbs(dir), "lib"), { recursive: true })
  writeFileSync(join(carpetaAbs(dir), "src", "extra.cpp"), "int x;\n")
  const bun = bunFalso()
  try {
    const r = await programa(dir, { accion: "compilar" })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.etapa, "compilacion")
    assert.equal(r.vigente, true)
    assert.equal(r.revision, r.revisionActual)
    assert.match(r.resultado, /^COMPILADO — revisión \d+, environment esp32-devkit-v1$/)
    assert.equal(bun.llamadas.length, 1)
    const { cmd, cwd, enDisco } = bun.llamadas[0]
    assert.deepEqual(cmd.slice(1), ["run", "-d", carpetaAbs(dir), "-e", "esp32-devkit-v1"])
    assert.match(cmd[0], /(^|[\\/])(pio|platformio)(\.exe)?$/)
    assert.equal(cwd, dir)
    assert.deepEqual(enDisco, codegenDe(dir).archivos, "PlatformIO compila sólo los bytes de generarPrograma")
  } finally {
    bun.restaurar()
  }
})

test("compilar: un error de compilación se informa aparte (etapa, código, explicación y salida acotada)", async () => {
  const dir = await armar()
  const bun = bunFalso({ codigo: 1, stderr: "src/main.cpp:5:1: error: expected ';' before 'digitalWrite'\n" })
  try {
    const r = await programa(dir, { accion: "compilar" })
    assert.equal(r.ok, false)
    assert.equal(r.etapa, "compilacion")
    assert.equal(r.codigo, "COMPILACION_FALLIDA")
    assert.equal(r.exitCode, 1)
    assert.match(r.explicacion, /;/)
    assert.match(r.salida, /expected ';'/)
    assert.match(r.resultado, /^NO COMPILÓ — COMPILACION_FALLIDA$/)
  } finally {
    bun.restaurar()
  }
  const sinPio = bunFalso({ codigo: 127 })
  try {
    assert.equal((await programa(dir, { accion: "compilar" })).codigo, "PLATFORMIO_NO_ENCONTRADO")
  } finally {
    sinPio.restaurar()
  }
})

test("compilar: si el proyecto cambia mientras compila, el resultado lo dice (vigente: false), no afirma «tu proyecto actual»", async () => {
  const dir = await armar()
  const servicio = servicioDe(dir)
  const bun = bunFalso({
    durante: () => {
      const r = servicio.aplicar({ idOperacion: `durante-${Date.now()}`, actor: "navegador", baseRevision: servicio.snapshot().revision, tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO27" } })
      assert.equal(r.ok, true)
    },
  })
  try {
    const r = await programa(dir, { accion: "compilar" })
    assert.equal(r.ok, true)
    assert.equal(r.vigente, false)
    assert.equal(r.revisionActual, r.revision + 1)
    assert.match(r.resultado, /cambió a la revisión \d+ mientras compilaba: volvé a compilar/)
  } finally {
    bun.restaurar()
  }
})

test("15 no acepta comandos, flags, platform ni environment del agente: sólo accion e idProyecto", async () => {
  assert.deepEqual(Object.keys(programaTool.args).sort(), ["accion", "idProyecto"])
  const dir = await armar()
  const bun = bunFalso()
  try {
    const extra = { accion: "compilar", comando: "rm -rf /", flags: "-O0", environment: "uno", platform: "atmelavr", project_path: "/tmp", codigo: "void setup(){}" }
    await programa(dir, extra)
    assert.deepEqual(bun.llamadas[0].cmd.slice(1), ["run", "-d", carpetaAbs(dir), "-e", "esp32-devkit-v1"])
    assert.deepEqual(bun.llamadas[0].enDisco, codegenDe(dir).archivos, "el «codigo» del agente no llega a ningún lado")
    const r = await programa(dir, { accion: "shell" })
    assert.equal(r.codigo, "ACCION_DESCONOCIDA")
    assert.equal(bun.llamadas.length, 1, "una acción desconocida no lanza nada")
  } finally {
    bun.restaurar()
  }
})

test("16 no acepta rutas del agente: idProyecto inválido se rechaza y la carpeta siempre cuelga de los datos del proyecto", async () => {
  const dir = await armar()
  for (const id of ["../../fuera", "/etc", "a/b", ".."]) {
    const r = await programa(dir, { accion: "generar", idProyecto: id })
    assert.equal(r.codigo, "ID_PROYECTO_INVALIDO", id)
  }
  assert.ok(!existsSync(join(dir, "..", "fuera")))
  assert.equal(carpetaDelPrograma(dir, "activo"), join(directorioDeDatos(dir), "programa", "activo"))
})

test("barrera: la tool platformio no compila ni carga la carpeta derivada (no se saltea la regeneración)", async () => {
  const dir = await armar()
  await programa(dir, { accion: "generar" })
  const bun = bunFalso()
  try {
    for (const action of ["compile", "flash", "both"]) {
      const salida = await platformioTool.execute({ action, project_path: carpetaAbs(dir) }, { directory: dir })
      assert.match(salida, /DERIVADO de un proyecto físico/)
      assert.match(salida, /`programa`/)
    }
    assert.equal(bun.llamadas.length, 0, "no se lanzó PlatformIO")
  } finally {
    bun.restaurar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 17, 19: packaging (estático; el dinámico está en empaquetado-instalado) y fuente de verdad
// ════════════════════════════════════════════════════════════════════════════════════

test("17 los cuatro instaladores llevan codegen/ en sus listas de carpetas", () => {
  const leer = (f) => readFileSync(join(REPO, "install", f), "utf8")
  const installSh = leer("install.sh")
  assert.match(installSh, /mkdir -p "\$CONFIG_DIR"\/\{[^}]*\bcodegen\b[^}]*\}/)
  assert.match(installSh, /cp -r "\$SRC\/codegen\/\." "\$CONFIG_DIR\/codegen\/"/)
  assert.match(installSh, /find agent tool [^|]*\bcodegen\b -type f/)
  const installPs1 = leer("install.ps1")
  assert.equal((installPs1.match(/"conocimiento", "codegen"\)\)/g) ?? []).length, 2, "install.ps1: lista de carpetas y lista del manifest")
  assert.match(installPs1, /Copy-Item \(Join-Path \$Src "codegen\\\*"\) \(Join-Path \$ConfigDir "codegen\\"\) -Recurse -Force/)
  assert.match(leer("uninstall.ps1"), /"conocimiento", "codegen"\)\) \{/)
  assert.match(leer("uninstall.sh"), /"\$CONFIG_DIR\/codegen" -type d -empty -delete/)
  assert.doesNotMatch(installPs1 + leer("uninstall.ps1"), /[^\x00-\x7F]/, "los .ps1 siguen siendo ASCII (Windows PowerShell 5.1)")
})

test("19 generar no crea otra fuente de verdad: la IR no cambia y la tool no aplica operaciones", async () => {
  const dir = await armar()
  const json = join(directorioDeDatos(dir), "activo.json")
  const antes = readFileSync(json, "utf8")
  const revision = servicioDe(dir).snapshot().revision
  await programa(dir, { accion: "generar" })
  assert.equal(readFileSync(json, "utf8"), antes)
  assert.equal(servicioDe(dir).snapshot().revision, revision)
  assert.doesNotMatch(FUENTE_TOOL, /\.(aplicar|aplicarTransaccion|proponer)\(/)
  assert.doesNotMatch(FUENTE_TOOL, /activo\.json|\.json["'`]/, "la tool no lee ni escribe el documento del proyecto")
})
