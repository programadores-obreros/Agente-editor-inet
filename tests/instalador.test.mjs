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

/**
 * El bloque que sigue a una instalación, hasta el "[OK]" que la cierra.
 *
 * SOBRE `codigo` Y NO SOBRE `ps1`, y esta es la TERCERA vez que muerde en este
 * repo. Los comentarios de bootstrap.ps1 citan los comandos para explicar los
 * bugs —«`scoop install opencode` elevado sin la variable: Scoop lo RECHAZA»— y
 * un indexOf sobre el archivo entero encuentra la CITA, no el comando. El test
 * termina midiendo un pedazo de prosa.
 */
function bloqueTrasInstalar(comando) {
  const i = codigo.indexOf(comando)
  assert.ok(i > 0, `no encontré "${comando}" en bootstrap.ps1`)
  const resto = codigo.slice(i)
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
  const fn = ps1.slice(i, i + 1800)
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
  // Se cuentan las reinstalaciones con scoop, que son las caras. El fallback de
  // CPU sin AVX2 no cuenta: no reinstala, baja OTRO binario — y existe
  // justamente porque reinstalar el mismo no converge nunca.
  // Se cuentan COMANDOS, no las líneas que le IMPRIMEN la instrucción al docente:
  // el aviso final le sugiere correr `scoop install opencode` a mano, y eso es
  // texto, no una tercera reinstalación.
  const instalaciones = codigo
    .split("\n")
    .filter((l) => /scoop install opencode/.test(l) && !/Write-Host/.test(l)).length
  assert.ok(
    instalaciones <= 2,
    `hay ${instalaciones} reinstalaciones con scoop; el techo es 2 (el intento normal y UNA reparación)`,
  )
  // EL INSTALADOR NO PUEDE DESINSTALAR NADA. NUNCA.
  //
  // Había un `scoop uninstall opencode` antes de reinstalar, y era la única
  // operación de todo el instalador capaz de dejar la máquina PEOR de como
  // estaba. Con un falso negativo de Test-OpenCode desinstalaba un OpenCode
  // sano, y si la reinstalación fallaba por red, el docente se quedaba sin nada.
  //
  // Pasó de verdad: una notebook que andaba quedó sin OpenCode DESPUÉS de correr
  // el instalador.
  //
  // Y era innecesario: `scoop install` ya purga solo las instalaciones fallidas
  // ("Purging previous failed installation"), pero sólo cuando de verdad hace
  // falta. Nosotros lo hacíamos siempre, a ciegas.
  //
  // La regla: EL INSTALADOR PUEDE FALLAR, PERO NO PUEDE ROMPER.
  const comandos = codigo.split("\n").filter((l) => !/Write-Host/.test(l))
  const destructivos = comandos.filter((l) => /scoop uninstall|Remove-Item.*scoop|rm .*scoop/i.test(l))
  assert.deepEqual(
    destructivos.map((l) => l.trim()),
    [],
    "el instalador desinstala o borra algo: puede dejar la máquina peor de como estaba",
  )

  // Y no puede preguntarle nada: el instalador también corre en silencio
  // (/VERYSILENT), donde un prompt no espera respuesta, cuelga para siempre.
  assert.doesNotMatch(codigo, /Read-Host|\[Console\]::ReadKey|Pause\b/, "no puede preguntar nada")
})

test("si OpenCode falla, la capa educativa SE INSTALA IGUAL", () => {
  // ESTE TEST ESTABA AL REVES, Y PROTEGIA UNA REGRESION.
  //
  // Exigia que el instalador CORTARA cuando OpenCode fallaba. El argumento era
  // bueno —"decir OK sin verificar es peor que fallar"— pero se aplico mal:
  // convirtio "avisar" en "abandonar".
  //
  // Hasta la v0.3.19 este script no tenia un solo `exit`, y esa version se
  // instalaba sin problemas. Con el corte, una notebook real quedo con OpenCode
  // a medias Y SIN agente, sin skills y sin fichas: dos problemas en vez de uno.
  //
  // La capa NO depende de OpenCode para instalarse: es copia de archivos, sin
  // red. El dia que OpenCode se arregle, el bot ya tiene que estar ahi.
  const paso2 = codigo.indexOf("scoop install opencode")
  const paso4 = codigo.indexOf("install.ps1")
  assert.ok(paso2 > 0 && paso4 > paso2, "no encontré los pasos en orden")

  // Entre que falla OpenCode y que se instala la capa NO puede haber un exit.
  const entre = codigo.slice(paso2, paso4)
  assert.doesNotMatch(
    entre,
    /exit 1/,
    "el instalador aborta antes de instalar la capa: es la regresión de la v0.3.19",
  )
})

test("el mensaje de fallo dice QUÉ hacer, no sólo que falló", () => {
  // Antes este test exigía las dos líneas de scoop para copiar y pegar. Ya no:
  // el instalador las corre solo. Pedirle al docente que ejecute a mano algo
  // que la máquina ya intentó es hacerle perder el tiempo dos veces.
  //
  // Lo que sí tiene que quedar: que se intentó más de una vez (para que no
  // reintente al pedo), y a dónde ir cuando ni eso alcanzó.
  const i = codigo.indexOf("OPENCODE NO ARRANCA")
  assert.ok(i > 0, "no hay aviso final para el caso de OpenCode caído")
  // Alrededor y no sólo hacia adelante: "la capa quedó instalada" está en la
  // MISMA línea, antes de "OPENCODE NO ARRANCA". Cortar hacia adelante lo perdía.
  const mensaje = codigo.slice(Math.max(0, i - 300), i + 900)
  assert.match(mensaje, /Diagnostico/i, "no manda al diagnóstico, que es lo que dice la causa")
  assert.match(mensaje, /quedo instalada|capa/i, "no aclara que la capa SÍ quedó puesta")
  // Y NO puede culpar a la conexión: cuando el hash da OK la descarga está
  // perfecta, y ese mensaje mandaba a mirar el lugar equivocado.
  assert.doesNotMatch(mensaje, /descarga se corte|mejor conexion/i, "vuelve a culpar a la conexión")
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

  // TODAS las pantallas de error del lanzador, no una sola.
  //
  // Antes este test miraba el trozo entre `:verificar` y el primer parentesis, y
  // eso dejo de ser el mensaje cuando el lanzador creció: ahora distingue tres
  // fallas distintas —no está, está pero no arranca, y falta la capa educativa—
  // y cada una tiene su bloque. Un test atado a la forma del código se rompe
  // cuando el código mejora.
  const errores = [...cmd.matchAll(/echo\s+Tecnia Bot v%VER% -- ([^\r\n]+)/g)].map((m) => m[1])
  assert.ok(errores.length >= 2, `sólo ${errores.length} pantalla(s) de error llevan la versión`)

  // La de "no se encontró" no puede mandar a reinstalar sin avisar que quizá el
  // instalador está corriendo justo ahora: ese consejo rompió una máquina real.
  const sinOpenCode = cmd.slice(cmd.indexOf(":sinopencode"))
  assert.match(sinOpenCode, /esperalo|esta corriendo/i, "sigue empujando a instalar dos veces")

  // Y la de "no arranca" tiene que mandar al diagnóstico, que es lo único que
  // distingue antivirus de procesador viejo.
  assert.match(cmd, /NO ARRANCA[\s\S]{0,400}Diagnostico/i, "no manda al diagnóstico")
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

// ── Los archivos que lee un runtime de JavaScript NO pueden llevar BOM ────────
//
// POR QUÉ ESTE TEST, y es el bug más caro que encontró la auditoría.
//
// `Set-Content -Encoding UTF8` en PowerShell 5.1 —el que trae Windows 10— escribe
// UTF-8 CON BOM. OpenCode lee su configuración con JSON.parse, que revienta con
// BOM, y en el caso de las credenciales SE TRAGA EL ERROR: se queda sin
// credencial y no avisa nada.
//
// El docente veía la instalación perfecta, el bot abría con su logo y su agente,
// y al primer mensaje: error de proveedor. Sin una sola pista.
//
// Lo peor: el repo YA SABÍA esto. Cuatro escrituras de install.ps1 usan
// WriteAllText con UTF8Encoding($false) y lo explican en sus comentarios. La
// única que quedó afuera fue, justamente, la de las credenciales.
//
// Este test no existía. Comprobado por mutación: devolviendo esa línea a
// Set-Content, los 107 tests seguían pasando en verde.

const instalarPs1 = readFileSync(join(REPO, "install/install.ps1"), "utf8")

test("ningún archivo JSON se escribe con Set-Content (que mete BOM)", () => {
  /*
   * `Set-Content -Encoding UTF8` está permitido sólo para archivos que lee
   * PowerShell, donde el BOM no molesta. Hoy eso es únicamente el manifest.
   * Cualquier otro destino tiene que ir por WriteAllText.
   */
  const PERMITIDOS = ["$Manifest"]

  const culpables = []
  for (const m of instalarPs1.matchAll(/Set-Content\s+-Path\s+(\$\w+)[^\r\n]*-Encoding\s+UTF8/g)) {
    if (!PERMITIDOS.includes(m[1])) culpables.push(m[1])
  }
  assert.deepEqual(
    culpables,
    [],
    "estos archivos van a salir con BOM y JSON.parse los va a rechazar en silencio: " +
      culpables.join(", ") +
      " — usá [System.IO.File]::WriteAllText(..., (New-Object System.Text.UTF8Encoding $false))",
  )
})

test("el archivo de credenciales se escribe sin BOM", () => {
  // El caso concreto, nombrado. Si alguien renombra la variable, el test de
  // arriba sigue cubriendo la regla; éste cubre el archivo que más duele.
  const i = instalarPs1.indexOf("$AuthFile")
  assert.ok(i > 0, "no encontré dónde se escribe el archivo de credenciales")
  const escrituras = [...instalarPs1.matchAll(/([^\r\n]*\$AuthFile[^\r\n]*)/g)]
    .map((m) => m[1])
    .filter((l) => /Set-Content|WriteAllText/.test(l))
  assert.ok(escrituras.length > 0, "no se escribe el archivo de credenciales")
  for (const l of escrituras) {
    assert.match(l, /WriteAllText/, `las credenciales se escriben con BOM:\n  ${l.trim()}`)
  }
})

test("el instalador CURA un auth.json que ya venía con BOM", () => {
  // El bug que dejaba máquinas muertas para siempre.
  //
  // PowerShell saca el BOM al leer; JSON.parse de OpenCode no. Entonces el
  // instalador leía un archivo envenenado, le parecía sano, y decidía no tocarlo.
  // Reinstalar no servía. Actualizar tampoco. Cada intento confirmaba que estaba
  // todo bien mientras el bot fallaba al primer mensaje.
  //
  // Arreglar la ESCRITURA no alcanzaba: las máquinas ya infectadas seguían
  // infectadas. Hay que mirar los bytes, que es lo único que ve OpenCode.
  const i = instalarPs1.indexOf("$AuthFile")
  const bloque = instalarPs1.slice(0, instalarPs1.indexOf("$authData = $null"))
  assert.match(bloque, /ReadAllBytes/, "lee el archivo como texto: así el BOM es invisible")
  assert.match(bloque, /0xEF.*0xBB.*0xBF/s, "no busca la firma del BOM")
  assert.match(bloque, /WriteAllText/, "detecta el BOM pero no lo saca")
  assert.ok(i > 0)
})
