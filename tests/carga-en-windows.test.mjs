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
// verdad esa foto, y que `abrir-tecnia-bot.cmd` deje la marca al correr en un Windows real.
// Eso no se puede correr en Linux: el `.cmd` se revisa acá sólo como texto. Las dos cosas se
// corrieron A MANO en la notebook del owner, en una carpeta aparte (ver el commit); adentro de
// OpenCode y con la placa, la prueba es la del owner.
//
// LA PRIMERA VERSIÓN DE ESTE ARCHIVO TENÍA HUECOS, y los encontró una revisión independiente
// mutando sobre una copia: un padre sin fecha de arranque no cortaba la cadena y nada lo
// notaba; comparar la ruta del lanzador con «termina en» en vez de «es igual» quedaba verde;
// el test del `.cmd` comprobaba que estuvieran las líneas esperadas y no que faltaran otras
// (una línea `set "REVISADO=1"` agregada al final dejaba la marca siempre, y verde). Por eso
// ahora el tramo del `.cmd` se compara ENTERO, línea por línea, y hay un caso por cada hueco.
//
// POR QUÉ LOS CASOS DE «NO PASA» IMPORTAN MÁS QUE EL DE «PASA». Esto es un control de
// seguridad: el cartel de «¿revisaste el circuito?» tiene que verlo una persona. Un test que
// sólo mostrara que la notebook del owner pasa quedaría verde también si la función devolviera
// siempre `null`. Cada rechazo de abajo es una forma concreta de abrir OpenCode sin la revisión
// previa, o con algo que aprueba el cartel solo.
//
//
// MUTACIONES. 35, corridas sobre una copia fuera del repo (reemplazo de texto + `node --test`),
// las 35 en rojo. Por grupo:
//   - el lanzador: no exigir la marca; no revisarlo; comparar la ruta con «termina en» o no
//     compararla; no mirar la imagen real, o aceptar la que termina en / empieza con `cmd`;
//     aceptar `/K`; admitir algo entre el programa y `/c`; aceptar sin comillas una ruta con
//     espacios o `&`; mirar sólo el padre directo;
//   - los ancestros: no cortar en un pid reusado; contar un padre sin fecha; ignorar un pid
//     duplicado; dejar pasar una foto que no se pudo sacar;
//   - la línea de OpenCode: dejar pasar una línea con opciones; tratar `\"` como escape en el
//     nombre del programa; no leer la línea en Windows;
//   - la foto: saltear una entrada mal formada; aceptar una ruta de otro tipo; PowerShell por
//     el PATH; usar la salida aunque terminó con error; `fotoDeWindows` siempre `null`;
//   - los mensajes: no nombrar la causa de la carpeta; no decir que falta Node; dar el consejo
//     de «Reparar» también con la marca falsificada;
//   - el `.cmd`: marcar sin mirar la revisión; no borrar la marca; no limpiar las OPENCODE_*;
//     una línea de más que marca siempre; otra que apaga la segunda capa; un `cd` después de
//     revisar; `node` a secas; `&&` por `&`; abrir con argumentos.
// UNA mutación quedó verde y sacó a la luz código muerto: un chequeo de «comillas adentro de
// la ruta» que no podía cambiar ningún resultado (esa ruta nunca es igual a la del lanzador).
// Se borró la línea en vez de inventarle un test.
// OJO: «no exigir la marca» NO pone rojo «abierto a mano, sin la marca», porque sin marca
// tampoco se saca la foto y el rechazo llega igual. La atrapa «la marca de Linux».
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
const { fotoDeWindows, sistemaReal } = await import(join(REPO, "opencode/carga/arbol.ts"))

// ── La foto MEDIDA (notebook del owner, 2026-11-23), con el usuario cambiado ──────────────
const ENTORNO = { SystemRoot: String.raw`C:\Windows` }
const CMD = String.raw`C:\Windows\System32\cmd.exe`
const LANZADOR = String.raw`C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd`
const LINEA_CMD = String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`
const OPENCODE = String.raw`C:\Users\docente\scoop\apps\opencode\current\opencode.exe`
const LINEA_OPENCODE = `"${OPENCODE}"`
const PID_OPENCODE = 10680
const PID_CMD = 9240
const PID_EXPLORER = 5232

/** La foto de la notebook: explorer → cmd (el lanzador) → opencode. Cada caso cambia una cosa. */
function foto(cambios = {}) {
  const base = {
    explorer: { pid: PID_EXPLORER, ppid: 700, nombre: "explorer.exe", ruta: String.raw`C:\Windows\explorer.exe`, linea: String.raw`C:\Windows\Explorer.EXE`, creado: 1000n },
    cmd: { pid: PID_CMD, ppid: PID_EXPLORER, nombre: "cmd.exe", ruta: CMD, linea: LINEA_CMD, creado: 2000n },
    opencode: { pid: PID_OPENCODE, ppid: PID_CMD, nombre: "opencode.exe", ruta: OPENCODE, linea: LINEA_OPENCODE, creado: 3000n },
    otro: { pid: 4, ppid: 0, nombre: "System", ruta: null, linea: null, creado: null },
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
  const { carpeta = VACIA, espia, sinMarcaPor } = opciones
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
    entornoDelLanzador: { ...ENTORNO, ...(sinMarcaPor ? { TECNIA_SIN_MARCA: sinMarcaPor } : {}) },
  }
}
const esLanzador = (linea, { nombre = "cmd.exe", ruta = CMD, lanzador = LANZADOR } = {}) => W.esElLanzadorInstalado({ nombre, ruta, linea }, lanzador, ENTORNO)

// ── El caso que tiene que andar ───────────────────────────────────────────────────────────

test("la notebook del owner, abierta desde el ícono y con la carpeta limpia: el gate deja seguir", () => {
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas()), null)
})

test("con el shim de Scoop en el medio (opencode ← shim ← lanzador) también: se miran todos los ancestros, no sólo el padre", () => {
  // Es el plan B real de abrir-tecnia-bot.cmd cuando no encuentra el binario: `scoop\shims\opencode.exe`.
  const procesos = [
    ...foto({ opencode: { ppid: 777 } }),
    { pid: 777, ppid: PID_CMD, nombre: "opencode.exe", ruta: String.raw`C:\Users\docente\scoop\shims\opencode.exe`, linea: String.raw`"C:\Users\docente\scoop\shims\opencode.exe"`, creado: 2500n },
  ]
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos })), null)
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

test("otro .cmd, aunque se llame igual, parecido o esté en otra carpeta: no es el lanzador instalado", () => {
  for (const linea of [
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\Desktop\abrir-tecnia-bot.cmd""`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd.bak""`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Users\docente\AppData\Local\TecniaBot\otro.cmd""`,
    // Termina igual que el lanzador, pero es otra carpeta: «es igual», no «termina en».
    String.raw`"C:\Windows\system32\cmd.exe" /C ""D:\x\C:\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""C:\Otra\Users\docente\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd""`,
  ]) {
    assert.equal(esLanzador(linea), false, linea)
    assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ cmd: { linea } }) }))?.codigo, "SIN_LANZADOR", linea)
  }
})

test("el lanzador con algo más en la línea (antes, en el medio o después): no pasa", () => {
  const L = LANZADOR
  for (const linea of [
    String.raw`"C:\Windows\system32\cmd.exe" /C ""${L}" & calc"`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""${L}" --algo"`,
    String.raw`"C:\Windows\system32\cmd.exe" /C ""${L}"" & calc`,
    String.raw`"C:\Windows\system32\cmd.exe" /K ""${L}""`,
    String.raw`"C:\Windows\system32\cmd.exe" /V:ON /C ""${L}""`,
    String.raw`"C:\Windows\system32\cmd.exe" /D /C ""${L}""`,
    // Algo entre el /c y la ruta: con «termina en» estas pasaban.
    String.raw`"C:\Windows\system32\cmd.exe" /C calc & "${L}"`,
    String.raw`"C:\Windows\system32\cmd.exe" /C start "" "${L}"`,
    String.raw`"C:\Windows\system32\cmd.exe" /C call "${L}"`,
    // Algo entre el programa y el /c (encontrado por la revisión: pasaba al sacar todas las comillas).
    String.raw`C:\Windows\system32\cmd.exe -x \cmd /c ${L}`,
    String.raw`"C:\Windows\system32\cmd.exe" x /c ""${L}""`,
  ]) {
    assert.equal(esLanzador(linea), false, linea)
  }
})

test("sin comillas sólo vale si la ruta no tiene nada que cmd interprete: con «Juan Perez» o «Tom&Jerry» cmd correría otra cosa", () => {
  const juan = String.raw`C:\Users\Juan Perez\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd`
  const tom = String.raw`C:\Users\Tom&Jerry\AppData\Local\TecniaBot\abrir-tecnia-bot.cmd`
  assert.equal(esLanzador(String.raw`C:\Windows\system32\cmd.exe /c ${juan}`, { lanzador: juan }), false)
  assert.equal(esLanzador(String.raw`C:\Windows\system32\cmd.exe /c ${tom}`, { lanzador: tom }), false)
  // Con comillas, las mismas rutas SÍ son el lanzador: es como las abre el acceso directo.
  assert.equal(esLanzador(String.raw`"C:\Windows\system32\cmd.exe" /C ""${juan}""`, { lanzador: juan }), true)
  assert.equal(esLanzador(String.raw`"C:\Windows\system32\cmd.exe" /C ""${tom}""`, { lanzador: tom }), true)
  assert.equal(esLanzador(String.raw`C:\Windows\system32\cmd.exe /c "${juan}"`, { lanzador: juan }), true)
})

test("tiene que ser el cmd.exe de Windows por su ruta REAL, no por lo que diga la línea ni por el nombre", () => {
  // Un cmd.exe de otra carpeta con la línea perfecta.
  assert.equal(esLanzador(LINEA_CMD, { ruta: String.raw`C:\Temp\cmd.exe` }), false)
  assert.equal(esLanzador(LINEA_CMD, { ruta: String.raw`C:\Windows\System32\cmdx.exe`, nombre: "cmdx.exe" }), false)
  assert.equal(esLanzador(LINEA_CMD, { ruta: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, nombre: "powershell.exe" }), false)
  // Windows no entregó la ruta o la línea: no se sabe qué es, no cuenta.
  assert.equal(esLanzador(LINEA_CMD, { ruta: null }), false)
  assert.equal(esLanzador(null), false)
  // La línea puede decir cualquier cosa de sí misma; lo que vale es la imagen real.
  assert.equal(esLanzador(String.raw`"C:\Temp\cmd.exe" /C ""${LANZADOR}""`), true, "la imagen real es el cmd de Windows")
  // El cmd de 32 bits es el mismo cmd de Windows; con otra carpeta de Windows, se sigue a SystemRoot.
  assert.equal(esLanzador(LINEA_CMD, { ruta: String.raw`C:\WINDOWS\SysWOW64\cmd.exe` }), true)
  assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", ruta: String.raw`D:\Win\System32\cmd.exe`, linea: LINEA_CMD }, LANZADOR, { SystemRoot: String.raw`D:\Win` }), true)
  assert.equal(W.esElLanzadorInstalado({ nombre: "cmd.exe", ruta: CMD, linea: LINEA_CMD }, LANZADOR, { SystemRoot: String.raw`D:\Win` }), false)
})

test("las formas reales del lanzador sí se reconocen: la medida, la de PowerShell, mayúsculas distintas", () => {
  assert.equal(esLanzador(LINEA_CMD), true)
  // Así lo lanza PowerShell (`& "…\abrir-tecnia-bot.cmd"`), y Windows no distingue mayúsculas.
  assert.equal(esLanzador(String.raw`C:\WINDOWS\system32\cmd.exe /c ""C:\USERS\DOCENTE\appdata\local\tecniabot\ABRIR-TECNIA-BOT.CMD""`, { ruta: String.raw`C:\WINDOWS\system32\cmd.exe` }), true)
  assert.equal(esLanzador(String.raw`cmd /c ${LANZADOR}`), true, "sin comillas y sin nada raro en la ruta")
})

test("pid reusado: un 'padre' que arrancó después que su hijo no es su padre", () => {
  // El lanzador verdadero murió y su pid le tocó a otro cmd que corre el lanzador para OTRA ventana.
  const procesos = foto({ cmd: { creado: 9000n } })
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, procesos), [])
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos }))?.codigo, "SIN_LANZADOR")
})

test("un 'padre' del que no se sabe cuándo arrancó tampoco cuenta: sin la fecha no se lo distingue de un pid reusado", () => {
  const procesos = foto({ cmd: { creado: null } })
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, procesos), [])
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ procesos }))?.codigo, "SIN_LANZADOR")
})

test("la cadena de ancestros: en orden, se corta donde el padre no está, y no se queda girando en un ciclo", () => {
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, foto()).map((p) => p.pid), [PID_CMD, PID_EXPLORER])
  assert.deepEqual(W.ancestrosEnWindows(PID_OPENCODE, foto({ explorer: null })).map((p) => p.pid), [PID_CMD])
  // Un ciclo no puede pasar con fechas coherentes; con fechas iguales sí se podría armar uno.
  const ciclo = [
    { pid: 1, ppid: 2, nombre: "a.exe", ruta: "a", linea: "a", creado: 5n },
    { pid: 2, ppid: 1, nombre: "b.exe", ruta: "b", linea: "b", creado: 5n },
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

test("desde el lanzador pero con CUALQUIER cosa después del programa: no carga. En Windows la línea no se interpreta", () => {
  for (const cola of [
    " --port 4096",
    " --hostname=0.0.0.0",
    " --dangerously-skip-permissions",
    " run hola",
    " serve",
    // En Linux estas dos se admiten; acá no, porque el lanzador nunca las pasa.
    " --agent tecnia-bot",
    " --continue",
    // El escondite que encontró la revisión: según quién parta la línea, `--port` es un
    // argumento aparte o es parte del valor de `--prompt`. No se adivina: se rechaza.
    String.raw` --prompt "a"" --port=4096"`,
    String.raw` "--po"rt=1`,
    ' ""',
    " x",
  ]) {
    const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: LINEA_OPENCODE + cola } }) }))
    assert.equal(r?.codigo, "LINEA_CON_OPCIONES", `${cola} → ${r?.codigo}: ${r?.resultado}`)
    assert.match(r.resultado, /^NO SE CARGÓ/)
  }
})

test("el programa solo, con o sin comillas y con espacios alrededor, es lo único que pasa", () => {
  assert.equal(W.soloElPrograma(LINEA_OPENCODE), OPENCODE)
  assert.equal(W.soloElPrograma(`  ${LINEA_OPENCODE} \t `), OPENCODE)
  assert.equal(W.soloElPrograma("opencode"), "opencode")
  assert.equal(W.soloElPrograma(String.raw`"C:\con espacio\opencode.exe"`), String.raw`C:\con espacio\opencode.exe`)
  // Sin comillas, un espacio corta el programa: lo que sigue es "algo más".
  assert.equal(W.soloElPrograma(String.raw`C:\con espacio\opencode.exe`), null)
  // Una barra antes de la comilla que cierra NO la escapa en el nombre del programa: `--port`
  // queda afuera, a la vista. (Tratándola como escape, quedaría escondido adentro del nombre.)
  assert.equal(W.soloElPrograma(String.raw`"C:\x\" --port 1`), null)
  assert.deepEqual(W.programaYResto(String.raw`"C:\x\" --port 1`), { programa: String.raw`C:\x` + "\\", resto: " --port 1" })
  assert.equal(W.soloElPrograma(""), null)
  assert.equal(W.soloElPrograma("   "), null)
  assert.equal(W.soloElPrograma('""'), null)
})

test("Windows no entrega la línea de este proceso: no se pudo comprobar, no carga", () => {
  const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: foto({ opencode: { linea: null } }) }))
  assert.equal(r?.codigo, "LINEA_DE_COMANDO_ILEGIBLE", r?.resultado)
  assert.equal(lineaDeComandoEnWindows(null, 1).ok, false)
  assert.equal(lineaDeComandoEnWindows(foto({ opencode: { linea: "   " } }), PID_OPENCODE).ok, false)
  assert.deepEqual(lineaDeComandoEnWindows(foto(), PID_OPENCODE), { ok: true, argv: [OPENCODE] })
})

// ── La carpeta, y por qué no hay marca ────────────────────────────────────────────────────

test("carpeta con configuración de OpenCode: sin la marca nombra la causa, en vez de mandar a abrir de nuevo desde el ícono", () => {
  const sucia = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-windows-sucia-"))
  writeFileSync(join(sucia, "opencode.json"), "{}")
  const r = porQueNoSePuedeCargar({ directory: sucia, agent: "tecnia-bot" }, herramientas({ marca: undefined, carpeta: sucia, sinMarcaPor: "carpeta" }))
  assert.equal(r?.codigo, "CONFIGURACION_DE_PROYECTO", r?.resultado)
  assert.match(r.resultado, /opencode\.json/)
  // Segunda capa: aunque la marca y el lanzador estén bien, esa carpeta no carga.
  const r2 = porQueNoSePuedeCargar({ directory: sucia, agent: "tecnia-bot" }, herramientas({ carpeta: sucia }))
  assert.equal(r2?.codigo, "CONFIGURACION_DE_PROYECTO", r2?.resultado)
})

test("el lanzador no pudo revisar porque falta Node o falta el archivo: se dice ESO, y se manda a Reparar, no a abrir de nuevo", () => {
  for (const [motivo, palabra] of [["sin-node", /Node/], ["sin-revision", /archivo/]]) {
    const r = porQueNoSePuedeCargar(ctx, herramientas({ marca: undefined, sinMarcaPor: motivo }))
    assert.equal(r?.codigo, "SIN_LANZADOR", r?.resultado)
    assert.match(r.resultado, /^NO SE CARGÓ/)
    assert.match(r.resultado, palabra, r.resultado)
    assert.match(r.resultado, /Reparar Tecnia Bot/, r.resultado)
    assert.doesNotMatch(r.resultado, /abrí Tecnia Bot desde su acceso directo/, `lo abrió desde ahí:\n${r.resultado}`)
  }
})

test("TECNIA_SIN_MARCA es sólo un texto: no habilita nada, y un valor que no se conoce se ignora", () => {
  // Con la marca falsificada y sin lanzador, decir «sin-node» no cambia el veredicto ni el consejo.
  const sinLanzador = foto({ cmd: { linea: String.raw`"C:\Windows\system32\cmd.exe"` } })
  const r = porQueNoSePuedeCargar(ctx, herramientas({ procesos: sinLanzador, sinMarcaPor: "sin-node" }))
  assert.equal(r?.codigo, "SIN_LANZADOR")
  assert.match(r.resultado, /acceso directo/)
  assert.equal(W.consejoSegunElLanzador("cualquier cosa"), null)
  assert.equal(W.consejoSegunElLanzador(undefined), null)
  assert.equal(W.consejoSegunElLanzador("carpeta"), null)
  const r2 = porQueNoSePuedeCargar(ctx, herramientas({ marca: undefined, sinMarcaPor: "permitido" }))
  assert.equal(r2?.codigo, "SIN_LANZADOR")
  assert.match(r2.resultado, /acceso directo/)
})

// ── Leer la foto ──────────────────────────────────────────────────────────────────────────

const JSON_BUENO = JSON.stringify([
  { pid: "10680", ppid: "9240", nombre: "opencode.exe", ruta: OPENCODE, linea: LINEA_OPENCODE, creado: "134084927400000000" },
  { pid: "4", ppid: "0", nombre: "System", ruta: null, linea: null, creado: null },
])

test("interpretar la foto: la fecha no pierde precisión, el BOM no molesta", () => {
  const r = W.interpretarProcesos("\uFEFF" + JSON_BUENO)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { pid: 10680, ppid: 9240, nombre: "opencode.exe", ruta: OPENCODE, linea: LINEA_OPENCODE, creado: 134084927400000000n })
  assert.deepEqual(r[1], { pid: 4, ppid: 0, nombre: "System", ruta: null, linea: null, creado: null })
})

test("una foto con una entrada mal formada no se usa a medias: es como no tener foto", () => {
  const buena = JSON.parse(JSON_BUENO)
  for (const mala of [{ ...buena[0], pid: "-1" }, { ...buena[0], pid: 10680 }, { ...buena[0], ppid: "abc" }, { ...buena[0], nombre: 7 }, { ...buena[0], linea: 5 }, { ...buena[0], ruta: 5 }, { ...buena[0], creado: "ayer" }, null, "texto"]) {
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

test("la consulta pide lo que se usa: pid, padre, nombre, ruta real, línea y fecha como texto", () => {
  for (const pedazo of ["Win32_Process", "ProcessId", "ParentProcessId", "ExecutablePath", "CommandLine", "ToFileTimeUtc", "ConvertTo-Json", "UTF8"]) assert.ok(W.CONSULTA_DE_PROCESOS.includes(pedazo), pedazo)
})

test("dónde está el lanzador: en LOCALAPPDATA si es una ruta, si no en el perfil", () => {
  assert.equal(W.rutaDelLanzadorEnWindows({ LOCALAPPDATA: String.raw`C:\Users\docente\AppData\Local` }, "x"), LANZADOR)
  assert.equal(W.rutaDelLanzadorEnWindows({}, String.raw`C:\Users\docente`), LANZADOR)
  assert.equal(W.rutaDelLanzadorEnWindows({ LOCALAPPDATA: "relativa" }, String.raw`C:\Users\docente`), LANZADOR)
})

test("cancelar una carga en Windows: la foto sale de la misma consulta, y si no se puede sacar es `null`", () => {
  // Con «siempre null» (como era antes: se pedía con `ps`) una carga cancelada no se confirmaba nunca.
  assert.deepEqual(
    fotoDeWindows(() => foto()).map((p) => [p.pid, p.ppid, p.zombi]),
    foto().map((p) => [p.pid, p.ppid, false]),
  )
  assert.equal(fotoDeWindows(() => null), null)
  // En esta máquina (Linux) no hay PowerShell de Windows: es el caso real de «no se pudo».
  if (process.platform !== "win32") assert.equal(sistemaReal("win32").foto(), null)
})

// ── El lanzador, como texto ───────────────────────────────────────────────────────────────

test("el .cmd: el tramo de la revisión previa es EXACTAMENTE éste, línea por línea", () => {
  const cmd = readFileSync(join(REPO, "installer/abrir-tecnia-bot.cmd"), "latin1")
  const desde = cmd.indexOf("rem -- LA REVISION PREVIA A LA CARGA A LA PLACA")
  const hasta = cmd.indexOf("echo   Abriendo...")
  assert.ok(desde > 0 && hasta > desde, "no encontré el tramo de la revisión previa antes de abrir")
  const tramo = cmd
    .slice(desde, hasta)
    .split("\r\n")
    .filter((l) => l !== "" && !/^rem\b/i.test(l))

  // Se compara ENTERO. La primera versión de este test buscaba las líneas esperadas y su orden;
  // una línea de más (`set "REVISADO=1"` al final, un `cd`, un `set OPENCODE_PERMISSION=…`)
  // quedaba verde y dejaba la marca siempre. Cada línea tiene su porqué:
  const esperado = [
    // 1. Nada heredado vale: ni la marca, ni el motivo, ni variables de OpenCode.
    String.raw`set "TECNIA_LANZADOR="`,
    String.raw`set "TECNIA_SIN_MARCA="`,
    String.raw`for /f "tokens=1 delims==" %%V in ('set OPENCODE_ 2^>nul') do if /i not "%%V"=="OPENCODE_DISABLE_CLAUDE_CODE" set "%%V="`,
    String.raw`set "OPENCODE_DISABLE_PROJECT_CONFIG=1"`,
    // 2. La revisión es la del producto instalado; Node, por su ruta y nunca por su nombre a secas.
    String.raw`set "REVISION=%OCCFG%\carga\revisar-lanzamiento.ts"`,
    String.raw`set "NODO="`,
    String.raw`if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe" set "NODO=%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe"`,
    String.raw`if not defined NODO for %%I in (node.exe) do set "NODO=%%~$PATH:I"`,
    String.raw`set "REVISADO="`,
    String.raw`set "NODE_NO_WARNINGS=1"`,
    String.raw`if defined NODO if exist "%REVISION%" "%NODO%" "%REVISION%" >nul 2>nul && set "REVISADO=1"`,
    String.raw`set "NODE_NO_WARNINGS="`,
    // 3. La marca, sólo si la revisión corrió y dio limpio. Si no, el motivo (el más grave gana).
    `if defined REVISADO set "TECNIA_LANZADOR=${W.MARCA_DEL_LANZADOR_EN_WINDOWS}"`,
    String.raw`if not defined REVISADO set "TECNIA_SIN_MARCA=carpeta"`,
    String.raw`if not exist "%REVISION%" set "TECNIA_SIN_MARCA=sin-revision"`,
    String.raw`if not defined NODO set "TECNIA_SIN_MARCA=sin-node"`,
    String.raw`if "%TECNIA_SIN_MARCA%"=="carpeta" echo   Aviso: en esta carpeta la carga a la placa queda deshabilitada. El resto funciona.`,
    String.raw`if "%TECNIA_SIN_MARCA%"=="sin-revision" echo   Aviso: falta un archivo de Tecnia Bot y la carga a la placa queda deshabilitada. Abri "Reparar Tecnia Bot" en el menu inicio.`,
    String.raw`if "%TECNIA_SIN_MARCA%"=="sin-node" echo   Aviso: no se encontro Node y la carga a la placa queda deshabilitada. Abri "Reparar Tecnia Bot" en el menu inicio.`,
  ]
  assert.deepEqual(tramo, esperado)
  // Los motivos que escribe el lanzador son los que la tool sabe leer.
  assert.ok(W.consejoSegunElLanzador("sin-node") && W.consejoSegunElLanzador("sin-revision"))
  // Está DESPUÉS de entrar a la carpeta de proyectos (la revisión mira la carpeta actual)…
  assert.ok(cmd.indexOf(":enproyectos") < desde)
  // …y de ahí a abrir no hay nada más que el cartel: ni otro `set`, ni un `cd`, ni un salto.
  const final = cmd.slice(hasta).split("\r\n")
  assert.deepEqual(final.slice(0, 3), ["echo   Abriendo... (cuando cargue, elegi el agente 'tecnia-bot' con Tab si no aparece solo)", "echo.", '"%OC%"'])
})
