// En Windows, `programa cargar` exige lo MISMO que en Linux, averiguado como Windows lo permite.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El 2026-11-23 el owner instaló el build de la rama de intención
// en su notebook (Windows 10, venía con la 0.4.8 andando) y recorrió el camino nuevo como un
// docente: el bot armó el circuito, lo dibujó en el navegador, generó el programa y lo compiló.
// Cuando pidió cargarlo, contestó «sólo está habilitado en Linux». Y la carga de siempre no
// sirve de plan B: `platformio` se niega a tocar la carpeta del programa generado. Su pregunta
// fue la correcta: «si antes andaba, ¿por qué en esta versión no lo tiene?». Porque la carga
// nueva exige comprobar cómo se abrió OpenCode y esa comprobación estaba escrita sólo con
// `/proc`. No se aflojó: se escribió para Windows (`opencode/carga/procesos-windows.ts`).
//
// LO QUE SE PRUEBA ACÁ es la lógica, con la foto de procesos MEDIDA en esa notebook como dato
// de entrada. LO QUE ESTE ARCHIVO NO PRUEBA, y hay que decirlo: que PowerShell conteste de
// verdad esa foto desde adentro de OpenCode, y que `abrir-tecnia-bot.cmd` deje la marca al
// correr en un Windows real. Eso no se puede correr en Linux: el `.cmd` se revisa acá sólo
// como texto. La prueba real es la del owner con su placa.
//
// POR QUÉ LOS CASOS DE «NO PASA» IMPORTAN MÁS QUE EL DE «PASA». Esto es un control de
// seguridad: el cartel de «¿revisaste el circuito?» tiene que verlo una persona. Un test que
// sólo mostrara que la notebook del owner pasa quedaría verde también si la función devolviera
// siempre `null`. Cada rechazo de abajo es una forma concreta de abrir OpenCode sin la revisión
// previa, o con algo que aprueba el cartel solo.
//
// MUTACIONES que ponen rojo este archivo. Las 18 se corrieron sobre una copia fuera del repo
// (reemplazo de texto + `node --test`), y las 18 dieron rojo:
//   - no exigir la marca en Windows                          → rojo «la marca de Linux»
//   - no revisar el lanzador en Windows                      → rojo 7 casos
//   - aceptar cualquier `cmd.exe` como lanzador              → rojo «otro .cmd», «con algo más»
//   - no mirar que el proceso se llame `cmd.exe`             → rojo «con algo más»
//   - aceptar `/K` además de `/C`                            → rojo «con algo más»
//   - no cortar la cadena en un pid reusado                  → rojo «pid reusado»
//   - una foto que no se pudo sacar deja pasar               → rojo «no se pudo sacar»
//   - dos procesos con el mismo pid no importan              → rojo «no se pudo sacar»
//   - partir la línea por espacios a secas                   → rojo «comillas en el medio», «partir»
//   - no leer la línea de comando en Windows                 → rojo «opciones de servidor» y dos más
//   - saltear una entrada mal formada de la foto             → rojo «entrada mal formada»
//   - buscar PowerShell por el PATH                          → rojo «la consulta»
//   - usar la salida aunque PowerShell terminó con error     → rojo «la consulta»
//   - no nombrar la causa cuando la carpeta está sucia       → rojo «carpeta con configuración»
//   - el .cmd marca sin mirar la revisión                    → rojo «el .cmd»
//   - el .cmd no borra la marca al empezar                   → rojo «el .cmd»
//   - el .cmd no limpia las OPENCODE_*                       → rojo «el .cmd»
//   - el .cmd da por hecha la revisión sin correrla          → rojo «el .cmd»
// OJO con una que parece cubierta y no lo está por el caso obvio: «no exigir la marca» NO pone
// rojo «abierto a mano, sin la marca», porque sin marca tampoco se saca la foto y el rechazo
// llega igual por «no pude comprobar». La atrapa el caso de la marca con forma de pid.
//
// Corre con: node --test tests/carga-en-windows.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const W = await import(join(REPO, "opencode/carga/procesos-windows.ts"))
const { porQueNoSePuedeCargar, lineaDeComandoEnWindows } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))
const { sistemaReal } = await import(join(REPO, "opencode/carga/arbol.ts"))

// ── La foto MEDIDA (notebook del owner, 2026-11-23), con el usuario cambiado ──────────────
const LANZADOR = String.raw`C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd`
const LINEA_CMD = String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`
const LINEA_OPENCODE = String.raw`"C:\Users\docente\scoop\apps\opencode\current\opencode.exe"`
const PID_OPENCODE = 10680
const PID_CMD = 9240
const PID_EXPLORER = 5232

/** La foto de la notebook: explorer → cmd (el lanzador) → opencode. Cada caso cambia una cosa. */
function foto(cambios = {}) {
  const base = {
    explorer: { pid: PID_EXPLORER, ppid: 700, nombre: "explorer.exe", linea: String.raw`C:\Windows\Explorer.EXE`, creado: 1000n },
    cmd: { pid: PID_CMD, ppid: PID_EXPLORER, nombre: "cmd.exe", linea: LINEA_CMD, creado: 2000n },
    opencode: { pid: PID_OPENCODE, ppid: PID_CMD, nombre: "opencode.exe", linea: LINEA_OPENCODE, creado: 3000n },
    otro: { pid: 4, ppid: 0, nombre: "System", linea: null, creado: null },
  }
  for (const [k, v] of Object.entries(cambios)) base[k] = v === null ? undefined : { ...base[k], ...v }
  return Object.values(base).filter(Boolean)
}

const VACIA = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-windows-"))
const ctx = { directory: VACIA, agent: "tecnia-bot" }

/** El gate como corre en Windows: sin inyectar la línea de comando (sale de la foto). */
function herramientas(opciones = {}) {
  // `marca: undefined` y `procesos: null` son CASOS, no "usá el valor por defecto": por eso se
  // mira si la clave está, y no se usan valores por defecto en la firma (la primera versión de
  // este helper los usaba y el caso «sin la marca» corría, sin avisar, CON la marca).
  const marca = "marca" in opciones ? opciones.marca : W.MARCA_DEL_LANZADOR_EN_WINDOWS
  const procesos = "procesos" in opciones ? opciones.procesos : foto()
  const { carpeta = VACIA, espia } = opciones
  return {
    plataforma: "win32",
    agenteQueNoPuedeCargar: () => null,
    configuracion: { cwd: () => carpeta, home: VACIA, entorno: {} },
    lanzador: { marca, pid: PID_OPENCODE, ancestros: () => null, marcaCon: () => null },
    procesosDeWindows: () => {
      if (espia) espia.veces++
      return procesos
    },
    rutaDelLanzadorEnWindows: LANZADOR,
  }
}

// ── El caso que tiene que andar ───────────────────────────────────────────────────────────

test("la notebook del owner, abierta desde el ícono y con la carpeta limpia: el gate deja seguir", () => {
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas()), null)
})

// ── Las formas de abrir que NO pasan ──────────────────────────────────────────────────────

test("abierto a mano, sin la marca: no carga, manda al acceso directo y ni siquiera arranca PowerShell", () => {
  const espia = { veces: 0 }
  const r = porQueNoSePuedeCargar(ctx, herramientas({ marca: undefined, espia }))
  assert.equal(r?.codigo, "SIN_LANZADOR", r?.resultado)
  assert.match(r.resultado, /^NO SE CARGÓ/)
  assert.match(r.resultado, /acceso directo/)
  // En Windows no existe el comando `tecnia-bot`: no se manda a escribirlo.
  assert.doesNotMatch(r.resultado, /escribiendo `tecnia-bot`/)
  assert.equal(espia.veces, 0, "sin marca no hace falta sacar la foto de procesos")
})

test("la marca de Linux (un pid) no vale en Windows", () => {
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ marca: String(PID_CMD) }))?.codigo, "SIN_LANZADOR")
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ marca: "" }))?.codigo, "SIN_LANZADOR")
})

test("abierto a mano con la marca escrita: sin el lanzador entre los ancestros, no carga", () => {
  // Alguien escribió `set TECNIA_LANZADOR=lanzador-cmd` y después `opencode` en una consola.
  const procesos = foto({ cmd: { linea: String.raw`"C:\Windows\system32\cmd.exe"` } })
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos }))?.codigo, "SIN_LANZADOR")
})

test("otro .cmd, aunque se llame parecido o esté en otra carpeta: no es el lanzador instalado", () => {
  for (const linea of [
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\Desktop\abrir-tecnia-bot.cmd""`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd.bak""`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\otro.cmd""`,
  ]) {
    assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ cmd: { linea } }) }))?.codigo, "SIN_LANZADOR", linea)
  }
})

test("el lanzador con algo más en la línea (otro comando, argumentos, otra opción): no pasa", () => {
  for (const linea of [
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd" & calc"`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd" --algo"`,
    String.raw`"C:\Windows\system32\cmd.exe" /K ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`,
    String.raw`"C:\Windows\system32\cmd.exe" /V:ON /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`,
    String.raw`calc & "C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`,
  ]) {
    assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", linea }, LANZADOR), false, linea)
  }
  // Y que el proceso se LLAME cmd.exe: otro programa con esa misma línea no es el lanzador.
  assert.equal(W.esElLanzadorInstalado({ nombre: "powershell.exe", linea: LINEA_CMD }, LANZADOR), false)
  assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", linea: null }, LANZADOR), false)
})

test("las formas reales del lanzador sí se reconocen: mayúsculas distintas, sin comillas, usuario con espacio", () => {
  assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", linea: LINEA_CMD }, LANZADOR), true)
  // Así lo lanza PowerShell (`& "…\abrir-tecnia-bot.cmd"`), y Windows no distingue mayúsculas.
  assert.equal(W.esElLanzadorInstalado({ nombre: "CMD.EXE", linea: String.raw`C:\WINDOWS\system32\cmd.exe /c ""C:\USERS\DOCENTE\appdata\local\tecniabot\ABRIR-TECNIA-BOT.CMD""` }, LANZADOR), true)
  const conEspacio = String.raw`C:\Users\Juan Pérez\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd`
  assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", linea: String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\Juan Pérez\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""` }, conEspacio), true)
})

test("pid reusado: un 'padre' que arrancó después que su hijo no es su padre", () => {
  // El lanzador verdadero murió y su pid le tocó a otro cmd que corre el lanzador para OTRA ventana.
  const procesos = foto({ cmd: { creado: 9000n } })
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, procesos), [])
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos }))?.codigo, "SIN_LANZADOR")
})

test("la cadena de ancestros: en orden, se corta donde el padre no está, y no se queda girando en un ciclo", () => {
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, foto()).map((p) => p.pid), [PID_CMD, PID_EXPLORER])
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, foto({ explorer: null })).map((p) => p.pid), [PID_CMD])
  // Un ciclo no puede pasar con fechas coherentes; con fechas iguales sí se podría armar uno.
  const ciclo = [
    { pid: 1, ppid: 2, nombre: "a.exe", linea: "a", creado: 5n },
    { pid: 2, ppid: 1, nombre: "b.exe", linea: "b", creado: 5n },
  ]
  assert.deepEqual(W.ancestrosEnWindows(1, ciclo).map((p) => p.pid), [2])
})

test("la foto no se pudo sacar, no trae este proceso o no dice cuándo arrancó: no se pudo comprobar, no carga", () => {
  for (const procesos of [null, foto({ opencode: null }), foto({ opencode: { creado: null } }), [...foto(), ...foto().slice(0, 1)]]) {
    const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos }))
    assert.equal(r?.codigo, "SIN_LANZADOR")
    assert.match(r.resultado, /no pude comprobar cómo se abrió OpenCode/)
  }
})

// ── La línea de comando de OpenCode ───────────────────────────────────────────────────────

test("desde el lanzador pero con opciones de servidor, aprobación automática o un subcomando: no carga", () => {
  const exe = LINEA_OPENCODE
  for (const [cola, codigo] of [
    [" --port 4096", "SERVIDOR_EXPUESTO"],
    [" --hostname=0.0.0.0", "SERVIDOR_EXPUESTO"],
    [" --dangerously-skip-permissions", "APROBACION_AUTOMATICA"],
    [" run hola", "MODO_NO_PERMITIDO"],
    [" serve", "MODO_NO_PERMITIDO"],
    [" --cualquiera", "OPCION_DESCONOCIDA"],
  ]) {
    const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: exe + cola } }) }))
    assert.equal(r?.codigo, codigo, `${cola} → ${r?.codigo}: ${r?.resultado}`)
  }
})

test("comillas en el medio de una opción: Windows las pega, y la opción escondida se ve igual", () => {
  // `"--po"rt=1` es, para el programa, `--port=1`. Partiendo por espacios quedaría `"--po"rt=1`,
  // que no empieza con `-` y se leería como un subcomando cualquiera, sin nombrar el servidor.
  assert.deepEqual(W.partirLineaDeComandoWindows(String.raw`opencode "--po"rt=1`), ["opencode", "--port=1"])
  const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: LINEA_OPENCODE + String.raw` "--po"rt=1` } }) }))
  assert.equal(r?.codigo, "SERVIDOR_EXPUESTO", r?.resultado)
  const r2 = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: LINEA_OPENCODE + String.raw` --dangerously-skip-"permissions"` } }) }))
  assert.equal(r2?.codigo, "APROBACION_AUTOMATICA", r2?.resultado)
})

test("partir una línea de comando de Windows: los ejemplos de la documentación de Microsoft", () => {
  const p = W.partirLineaDeComandoWindows
  assert.deepEqual(p(LINEA_OPENCODE), [String.raw`C:\Users\docente\scoop\apps\opencode\current\opencode.exe`])
  assert.deepEqual(p(String.raw`x "abc" d e`), ["x", "abc", "d", "e"])
  assert.deepEqual(p(String.raw`x a\\\b d"e f"g h`), ["x", String.raw`a\\\b`, "de fg", "h"])
  assert.deepEqual(p(String.raw`x a\\\"b c d`), ["x", String.raw`a\"b`, "c", "d"])
  assert.deepEqual(p(String.raw`x a\\\\"b c" d e`), ["x", String.raw`a\\b c`, "d", "e"])
  assert.deepEqual(p('x "a ""b"" c"'), ["x", 'a "b" c'])
  assert.deepEqual(p("x\ta\t \tb"), ["x", "a", "b"])
  assert.deepEqual(p(String.raw`"C:\con espacio\opencode.exe" --agent "tecnia bot"`), [String.raw`C:\con espacio\opencode.exe`, "--agent", "tecnia bot"])
  assert.deepEqual(p('x ""'), ["x", ""])
  assert.deepEqual(p(""), [])
  assert.deepEqual(p("   "), [])
})

test("Windows no entrega la línea de este proceso: no se pudo comprobar, no carga", () => {
  const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: null } }) }))
  assert.equal(r?.codigo, "LINEA_DE_COMANDO_ILEGIBLE", r?.resultado)
  assert.equal(lineaDeComandoEnWindows(null, 1).ok, false)
  assert.equal(lineaDeComandoEnWindows(foto({ opencode: { linea: "   " } }), PID_OPENCODE).ok, false)
})

// ── La carpeta ────────────────────────────────────────────────────────────────────────────

test("carpeta con configuración de OpenCode: sin la marca nombra la causa, en vez de mandar a abrir de nuevo desde el ícono", () => {
  const sucia = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-windows-sucia-"))
  writeFileSync(join(sucia, "opencode.json"), "{}")
  const r = porQueNoSePuedeCargar({ directory: sucia, agent: "tecnia-bot" }, herramientas({ marca: undefined, carpeta: sucia }))
  assert.equal(r?.codigo, "CONFIGURACION_DE_PROYECTO", r?.resultado)
  assert.match(r.resultado, /opencode\.json/)
  // Segunda capa: aunque la marca y el lanzador estén bien, esa carpeta no carga.
  const r2 = porQueNoSePuedeCargar({ directory: sucia, agent: "tecnia-bot" }, herramientas({ carpeta: sucia }))
  assert.equal(r2?.codigo, "CONFIGURACION_DE_PROYECTO", r2?.resultado)
})

// ── Leer la foto ──────────────────────────────────────────────────────────────────────────

const JSON_BUENO = JSON.stringify([
  { pid: "10680", ppid: "9240", nombre: "opencode.exe", linea: LINEA_OPENCODE, creado: "134084927400000000" },
  { pid: "4", ppid: "0", nombre: "System", linea: null, creado: null },
])

test("interpretar la foto: la fecha no pierde precisión, el BOM no molesta", () => {
  const r = W.interpretarProcesos("\uFEFF" + JSON_BUENO)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { pid: 10680, ppid: 9240, nombre: "opencode.exe", linea: LINEA_OPENCODE, creado: 134084927400000000n })
  assert.deepEqual(r[1], { pid: 4, ppid: 0, nombre: "System", linea: null, creado: null })
})

test("una foto con una entrada mal formada no se usa a medias: es como no tener foto", () => {
  const buena = JSON.parse(JSON_BUENO)
  for (const mala of [{ ...buena[0], pid: "-1" }, { ...buena[0], pid: 10680 }, { ...buena[0], ppid: "abc" }, { ...buena[0], nombre: 7 }, { ...buena[0], linea: 5 }, { ...buena[0], creado: "ayer" }, null, "texto"]) {
    assert.equal(W.interpretarProcesos(JSON.stringify([buena[1], mala])), null, JSON.stringify(mala))
  }
  for (const texto of ["", "no es json", "{}", "[]", '{"pid":"1"}']) assert.equal(W.interpretarProcesos(texto), null, texto)
})

test("la consulta: PowerShell por su ruta entera, no por el PATH, y lo que no salió bien es `null`", () => {
  const llamadas = []
  const correr = (ejecutable, args) => {
    llamadas.push({ ejecutable, args })
    return { status: 0, stdout: JSON_BUENO }
  }
  const r = W.leerProcesosDeWindows(correr, { SystemRoot: String.raw`D:\Win` })
  assert.equal(r.length, 2)
  assert.equal(llamadas[0].ejecutable, String.raw`D:\Win\System32\WindowsPowerShell\v1.0\powershell.exe`)
  // Lo que se le manda es la consulta, entera, codificada como la espera `-EncodedCommand`.
  const i = llamadas[0].args.indexOf("-EncodedCommand")
  assert.ok(i >= 0)
  assert.equal(Buffer.from(llamadas[0].args[i + 1], "base64").toString("utf16le"), W.CONSULTA_DE_PROCESOS)
  assert.ok(llamadas[0].args.includes("-NoProfile") && llamadas[0].args.includes("-NonInteractive"))
  // Sin SystemRoot, o con uno que no es una ruta: la carpeta de Windows de siempre, nunca un nombre suelto.
  assert.equal(W.rutaDePowerShell({}), String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
  assert.equal(W.rutaDePowerShell({ SystemRoot: "relativa" }), String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)

  assert.equal(W.leerProcesosDeWindows(() => ({ status: 1, stdout: JSON_BUENO }), {}), null, "salió con error")
  assert.equal(W.leerProcesosDeWindows(() => ({ status: null, stdout: JSON_BUENO }), {}), null, "lo cortó el tiempo")
  assert.equal(W.leerProcesosDeWindows(() => ({ status: 0, stdout: "basura" }), {}), null, "contestó otra cosa")
  assert.equal(
    W.leerProcesosDeWindows(() => {
      throw new Error("no arrancó")
    }, {}),
    null,
    "no arrancó",
  )
})

test("la consulta pide lo que se usa: pid, padre, nombre, línea y fecha como texto", () => {
  for (const pedazo of ["Win32_Process", "ProcessId", "ParentProcessId", "CommandLine", "ToFileTimeUtc", "ConvertTo-Json", "UTF8"]) assert.ok(W.CONSULTA_DE_PROCESOS.includes(pedazo), pedazo)
})

test("dónde está el lanzador: en LOCALAPPDATA si es una ruta, si no en el perfil", () => {
  assert.equal(W.rutaDelLanzadorEnWindows({ LOCALAPPDATA: String.raw`C:\Users\docente\AppData\Local` }, "x"), LANZADOR)
  assert.equal(W.rutaDelLanzadorEnWindows({}, String.raw`C:\Users\docente`), LANZADOR)
  assert.equal(W.rutaDelLanzadorEnWindows({ LOCALAPPDATA: "relativa" }, String.raw`C:\Users\docente`), LANZADOR)
})

test("cancelar una carga en Windows: si la foto no se puede sacar, es `null` y no una excepción", () => {
  // En esta máquina (Linux) no hay PowerShell de Windows: es el caso de «no se pudo».
  if (process.platform !== "win32") assert.equal(sistemaReal("win32").foto(), null)
})

// ── El lanzador, como texto ───────────────────────────────────────────────────────────────

test("el .cmd: borra la marca al empezar, la pone sólo si la revisión dio limpio, y nunca frena la apertura", () => {
  const cmd = readFileSync(join(REPO, "installer/abrir-tecnia-bot.cmd"), "latin1")
  const desde = cmd.indexOf("rem -- LA REVISION PREVIA A LA CARGA A LA PLACA")
  const hasta = cmd.indexOf("echo   Abriendo...")
  assert.ok(desde > 0 && hasta > desde, "no encontré el tramo de la revisión previa antes de abrir")
  const tramo = cmd
    .slice(desde, hasta)
    .split("\r\n")
    .filter((l) => l !== "" && !/^rem\b/i.test(l))
  const linea = (re) => tramo.findIndex((l) => re.test(l))

  const borra = linea(/^set "TECNIA_LANZADOR="$/)
  const limpia = linea(/^for \/f "tokens=1 delims==" %%V in \('set OPENCODE_ 2\^>nul'\) do if \/i not "%%V"=="OPENCODE_DISABLE_CLAUDE_CODE" set "%%V="$/)
  const fija = linea(/^set "OPENCODE_DISABLE_PROJECT_CONFIG=1"$/)
  const revisa = linea(/^if exist "%REVISION%" node "%REVISION%" >nul 2>nul && set "REVISADO=1"$/)
  const reinicia = linea(/^set "REVISADO="$/)
  const marca = linea(new RegExp(`^if defined REVISADO set "TECNIA_LANZADOR=${W.MARCA_DEL_LANZADOR_EN_WINDOWS}"$`))
  for (const [nombre, i] of Object.entries({ borra, limpia, fija, revisa, reinicia, marca })) assert.ok(i >= 0, `falta la línea que ${nombre}:\n${tramo.join("\n")}`)
  assert.ok(borra < revisa && reinicia < revisa && limpia < revisa && fija < revisa && revisa < marca, "el orden importa: limpiar y borrar, revisar, y recién ahí marcar")
  // La marca se escribe en UN solo lugar, y condicionada.
  assert.equal(tramo.filter((l) => /TECNIA_LANZADOR=[^"]/.test(l)).length, 1, tramo.join("\n"))
  // La revisión es la del producto instalado, la misma que usa la tool.
  assert.ok(tramo.includes(String.raw`set "REVISION=%OCCFG%\carga\revisar-lanzamiento.ts"`))
  // No es un portero: en el tramo no hay nada que impida llegar a abrir.
  for (const l of tramo) assert.doesNotMatch(l, /\b(?:goto|exit)\b/i, l)
  // Y está DESPUÉS de entrar a la carpeta de proyectos (la revisión mira la carpeta actual) y antes de abrir.
  assert.ok(cmd.indexOf(":enproyectos") < desde && hasta < cmd.indexOf('"%OC%"\r\nrem Sin este pause'))
  // Entre la marca y la apertura nada vuelve a tocar el entorno de OpenCode.
  assert.doesNotMatch(cmd.slice(hasta), /set "?(?:TECNIA_LANZADOR|OPENCODE_)/)
})
