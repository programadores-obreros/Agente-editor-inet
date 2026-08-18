// El instalador no puede decir "instalado" sin haber mirado.
//
// POR QUÉ ESTE ARCHIVO. En una notebook real, scoop terminó con
// "ERROR 'opencode' isn't installed correctly" y el bootstrap imprimió
// "[OK] OpenCode instalado" igual, siguió hasta el final y anunció que la
// instalación estaba completa. El docente lo descubrió recién al abrir el
// acceso directo, que le dijo "No se encontró OpenCode" sin ninguna pista de
// qué había pasado ni dónde mirar.
//
// Un instalador que dice OK sin verificar es peor que uno que falla: manda a
// buscar el problema al lugar equivocado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const ps1 = readFileSync(join(REPO, "install/bootstrap.ps1"), "utf8")

/**
 * El script sin comentarios. Los comentarios de bootstrap.ps1 explican cada bug
 * citándolo, y una prohibición que mira el archivo entero se dispara contra su
 * propia explicación. Ya había pasado en urls.test.mjs.
 */
const codigo = ps1.replace(/^\s*#.*$/gm, "")

/** El bloque de texto que sigue a una instalación, hasta el "[OK]" que la cierra. */
function bloqueTrasInstalar(comando) {
  const i = ps1.indexOf(comando)
  assert.ok(i > 0, `no encontré "${comando}" en bootstrap.ps1`)
  const resto = ps1.slice(i)
  const fin = resto.indexOf("[OK]")
  assert.ok(fin > 0, `no encontré el "[OK]" que sigue a "${comando}"`)
  return resto.slice(0, fin)
}

test("después de instalar OpenCode se verifica que quedó", () => {
  const bloque = bloqueTrasInstalar("scoop install opencode")
  assert.match(bloque, /Test-OpenCode/, "se imprime [OK] sin comprobar nada")
})

test("la verificación EJECUTA opencode, no mira si el archivo está", () => {
  // La versión anterior de este test aceptaba un Test-Path, y ese es justo el
  // chequeo que no sirve: un shim que apunta a una carpeta vacía existe igual.
  // El docente descubría la diferencia recién al abrir el bot.
  const i = ps1.indexOf("function Test-OpenCode")
  assert.ok(i > 0, "no está la función que verifica OpenCode")
  const fn = ps1.slice(i, i + 500)
  assert.match(fn, /opencode --version/, "no lo ejecuta: mirar el archivo no alcanza")
  assert.match(fn, /LASTEXITCODE/, "lo ejecuta pero no mira si terminó bien")
})

test("no se verifica contra un shim que Scoop no crea", () => {
  // Encontrado midiendo la VM, no leyendo el código: Scoop crea 'opencode.exe'
  // y 'opencode.shim'. El bootstrap buscaba 'opencode.cmd', que NO EXISTE
  // NUNCA — una verificación que siempre daba falso y no verificaba nada.
  assert.doesNotMatch(codigo, /opencode\.cmd/, "ese archivo no existe; el shim es opencode.exe")
})

test("repara solo, UNA vez, sin preguntarle nada al docente", () => {
  // Una vez y no en loop: el instalador corre en escuelas con internet flojo, y
  // un reintento sin techo no es persistencia, es colgarse para siempre.
  const instalaciones = [...ps1.matchAll(/scoop install opencode/g)].length
  assert.equal(instalaciones, 2, "tiene que haber 2: el intento normal y UNA reparación")
  assert.match(ps1, /scoop uninstall opencode/, "la reparación tiene que limpiar antes")

  // Y no puede preguntarle nada: el instalador también corre en silencio
  // (/VERYSILENT), donde un prompt no espera respuesta, cuelga para siempre.
  assert.doesNotMatch(codigo, /Read-Host|\[Console\]::ReadKey|Pause\b/, "no puede preguntar nada")
})

test("si OpenCode no quedó, el instalador CORTA en vez de seguir", () => {
  // Seguir es lo que hacía antes, y por eso el error aparecía tres pasos
  // después, en el acceso directo, sin relación visible con la causa.
  const i = ps1.indexOf("OpenCode NO quedo instalado")
  assert.ok(i > 0, "no hay mensaje de fallo para OpenCode")
  assert.match(ps1.slice(i, i + 900), /exit 1/, "avisa pero sigue igual")
})

test("el mensaje de fallo dice QUÉ hacer, no sólo que falló", () => {
  // Antes este test exigía las dos líneas de scoop para copiar y pegar. Ya no:
  // el instalador las corre solo. Pedirle al docente que ejecute a mano algo
  // que la máquina ya intentó es hacerle perder el tiempo dos veces.
  //
  // Lo que sí tiene que quedar: que se intentó más de una vez (para que no
  // reintente al pedo), y a dónde ir cuando ni eso alcanzó.
  const i = ps1.indexOf("OpenCode NO quedo instalado")
  const mensaje = ps1.slice(i, i + 900)
  assert.match(mensaje, /dos veces|limpiando antes/i, "no dice que ya se reintentó solo")
  assert.match(mensaje, /issues/, "no dice a dónde pedir ayuda")
})

test("Scoop también se verifica, y corta si falta", () => {
  // Sin scoop no se puede instalar nada de lo que sigue: cortar ahí ahorra
  // tres errores en cascada que no dicen cuál fue el primero.
  const i = ps1.indexOf("Scoop NO quedo instalado")
  assert.ok(i > 0, "no se verifica que Scoop haya quedado")
  assert.match(ps1.slice(i, i + 600), /exit 1/)
})

test("PlatformIO avisa si falta, pero NO corta", () => {
  // Es distinto a los otros dos: sin PlatformIO el bot igual sirve para
  // explicar, dibujar circuitos y repartir fichas. Sólo no puede compilar.
  const i = ps1.indexOf("PlatformIO NO quedo instalado")
  assert.ok(i > 0, "no se verifica que PlatformIO haya quedado")
  const mensaje = ps1.slice(i, i + 700)
  assert.doesNotMatch(mensaje, /exit 1/, "no debería cortar por PlatformIO")
  assert.match(mensaje, /diagnostico/i, "tiene que decir cómo revisarlo después")
})

// ── El acceso directo se puede abrir ANTES de que termine la instalación ──────
//
// Inno Setup corre [Icons] antes que [Run]. Medido en una VM: el acceso directo
// queda clickeable a los 0,9 segundos, cuando la instalación recién va a empezar
// a bajar los 57 MB de OpenCode. En una notebook de escuela eso son minutos.
//
// Le pasó a una persona real: vio aparecer el ícono, lo abrió, y el lanzador le
// dijo "No se encontró OpenCode, volvé a correr el instalador" — MIENTRAS el
// instalador estaba corriendo. El consejo era peor que el error: lo empujaba a
// arrancar una segunda instalación encima de la primera.

const iss = readFileSync(join(REPO, "installer/tecnia-bot.iss"), "utf8")

/**
 * El .iss sin comentarios. Mismo motivo que `codigo` para el .ps1, y ya mordió
 * dos veces: los comentarios de este archivo nombran `ssInstall` para explicar
 * por qué está ahí, así que un test que busca "ssInstall" pasa aunque el código
 * diga otra cosa. Se sacan los `;` de línea y los `{ }` de Pascal Script.
 */
const issCodigo = iss.replace(/^\s*;.*$/gm, "").replace(/\{[^}]*\}/g, "")
const cmd = readFileSync(join(REPO, "installer/abrir-tecnia-bot.cmd"), "utf8")

test("la marca se pone al EMPEZAR la instalación, no al llegar a [Run]", () => {
  // Ponerla en [Run] no alcanzaba, y se pagó dos veces: en una máquina que YA
  // tenía Tecnia Bot, el acceso directo anterior está vivo desde el segundo cero.
  // Medido: el .cmd nuevo aparece a los 0,81 s y la marca a los 0,94 s. En una
  // notebook con antivirus escaneando 5,6 MB de archivos chicos son decenas de
  // segundos, y en esa ventana el docente abre el lanzador VIEJO.
  //
  // ssInstall se dispara al apretar "Instalar" y antes de copiar un solo archivo.
  const code = issCodigo.slice(issCodigo.indexOf("[Code]"))
  assert.match(code, /CurStepChanged/, "no hay hook de paso de instalación")
  const hook = code.slice(code.indexOf("procedure CurStepChanged"))
  assert.match(hook, /CurStep = ssInstall\b/, "la marca no se pone al EMPEZAR la instalación")
  assert.match(hook, /\.instalando/, "el hook no crea la marca")
})

test("la marca se borra al terminar, y también si se cancela", () => {
  const run = iss.slice(iss.indexOf("[Run]"), iss.indexOf("[UninstallRun]"))
  const bootstrap = run.indexOf("bootstrap.ps1")
  const borra = run.indexOf(".instalando")
  assert.ok(borra > bootstrap, "la marca no se borra después del bootstrap")
  assert.match(run.slice(borra - 120, borra + 60), /del /, "esa mención no la borra")
  // Si se cancela a mitad, sin esto la marca queda puesta y el lanzador espera
  // 20 minutos de gusto.
  const code = issCodigo.slice(issCodigo.indexOf("[Code]"))
  assert.match(code, /DeinitializeSetup/, "no hay limpieza para el caso de cancelar")
})

test("el .exe declara su versión en las propiedades del archivo", () => {
  // AppVersion sólo se ve en "Agregar o quitar programas". Sin VersionInfoVersion
  // hubo que identificar la versión de un docente CONTANDO LOS BYTES del archivo
  // contra el asset del release. Andaba, pero es una vergüenza como método.
  // Anclado a principio de línea: sin eso, renombrar la directiva a algo que la
  // contenga (XVersionInfoVersion=) pasa el test y no hace nada. Probado.
  assert.match(iss, /^VersionInfoVersion=\S/m, "el .exe no dice qué versión es")
  assert.match(iss, /^VersionInfoProductName=\S/m, "el .exe no dice de qué producto es")
})

test("el lanzador muestra la versión, incluso cuando falla", () => {
  // Una captura de pantalla del docente tiene que alcanzar para saber qué corre.
  assert.match(cmd, /set \/p VER=/, "el lanzador no lee la versión")

  // El bloque del mensaje de error, entero.
  const desde = cmd.indexOf(":verificar")
  const error = cmd.slice(desde, cmd.indexOf(")", desde))
  assert.match(error, /%VER%/, "la pantalla de error no dice la versión")

  // Y no puede mandar a reinstalar sin avisar que quizá ya se está instalando.
  assert.match(error, /esperalo|esta corriendo/i, "sigue empujando a instalar dos veces")
})

test("la marca la maneja Inno, no el bootstrap", () => {
  // Si la manejara el bootstrap, un fallo dejaría la marca puesta y el lanzador
  // esperando de gusto. Inno corre sus entradas con waituntilterminated, así que
  // el borrado pasa igual si el bootstrap termina en 0, en 1, o se cae.
  assert.doesNotMatch(ps1, /\.instalando/, "el bootstrap no tiene que tocar la marca")
})

test("el lanzador ESPERA en vez de mandar a reinstalar", () => {
  assert.match(cmd, /\.instalando/, "el lanzador no mira si hay una instalación en curso")
  // Tiene que esperar en un bucle, no salir con el mensaje de error.
  assert.match(cmd, /goto esperando/, "detecta la instalación pero no espera")
  // Y con techo: colgarse para siempre en la máquina de un docente no es opción.
  assert.match(cmd, /LSS \d+/, "espera sin límite; tiene que haber un techo")
})

test("el lanzador NO arranca apenas aparece opencode", () => {
  // OpenCode se instala en el paso 2 de 4. Arrancar ahí da un OpenCode pelado,
  // sin Tecnia Bot — que es exactamente el otro síntoma que ya se reportó.
  // Por eso la espera mira la marca, no la presencia de opencode.
  const espera = cmd.slice(cmd.indexOf(":esperando"), cmd.indexOf("LSS"))
  assert.doesNotMatch(espera, /where opencode/, "sale antes de que termine la capa educativa")
})
