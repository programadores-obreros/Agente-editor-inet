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
/**
 * El cuerpo de una funcion de PowerShell, contando llaves.
 *
 * Reemplaza a `slice(i, i + 1800)`. Una ventana fija mide lo que le toca, no lo
 * que se quiere: de más se lleva la función siguiente y da falsos verdes, de
 * menos corta la que importa y da falsos rojos. Las dos formas enseñan a
 * desconfiar del resultado.
 */
function funcion(nombre) {
  // Con la llave: `function Test-OpenCode` es PREFIJO de `function Test-OpenCodeScoop`,
  // que se define antes, y sin la llave este helper devolvía la función equivocada
  // y dos tests de acá se pusieron rojos midiendo otra cosa.
  const i = codigo.indexOf(`function ${nombre} {`)
  assert.ok(i > 0, `no está la función ${nombre} en bootstrap.ps1`)
  const abre = codigo.indexOf("{", i)
  assert.ok(abre > 0, `la función ${nombre} no abre llave`)
  let nivel = 0
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === "{") nivel++
    else if (codigo[j] === "}" && --nivel === 0) return codigo.slice(i, j + 1)
  }
  assert.fail(`la función ${nombre} no cierra llave`)
}

/** Desde `i` hasta el próximo corte estructural, en vez de N caracteres a ojo. */
function hasta(texto, i, corte) {
  const resto = texto.slice(i)
  const m = resto.slice(1).match(corte)
  return m ? resto.slice(0, m.index + 1) : resto
}

// ── Recortar por una marca que NO ESTÁ no puede pasar en silencio ─────────────
//
// POR QUÉ EXISTEN `desdeMarca` Y `entreMarcas`. `texto.slice(texto.indexOf(X))` no
// falla cuando X no está: `indexOf` da -1 y `slice` hace OTRA cosa sin avisar.
//
//   slice(-1)      → el último carácter del archivo
//   slice(i, -1)   → desde i hasta el final (menos un carácter): el resto del archivo
//   slice(0, -1)   → el archivo entero
//
// Las tres mordieron acá. Un test recortaba la sección `[Run]` hasta
// `indexOf("[UninstallRun]")`, sección que ya no existía: medía el resto del
// archivo y pasaba por casualidad. El de la cura del BOM recortaba hasta
// `indexOf("$authData = $null")`, texto que tampoco existía: medía install.ps1
// entero. Y un `doesNotMatch` sobre un recorte así es peor todavía, porque un
// recorte de un carácter no contiene nada prohibido: pasa siempre.
//
// Al revisar el resto del archivo (2026-11-15) quedaban nueve recortes con el
// `indexOf` metido adentro del `slice`, sin nada que mirara el -1. Hoy las nueve
// marcas existen (medido con una precarga que anota cada `slice` que recibe -1:
// en este archivo, cero), así que ninguno estaba midiendo mal; pero el día que una
// marca se renombre, cada uno iba a seguir de largo. Ahora explotan nombrando la
// marca. Mutaciones del producto que lo prueban, anotadas arriba de cada test.

/**
 * Dónde está `marca` (un texto o una expresión regular) en `texto`, buscando desde
 * `desde`. Si no está, el test explota: nunca devuelve -1.
 */
function posicion(texto, marca, desde = 0) {
  let i
  if (marca instanceof RegExp) {
    const rel = texto.slice(desde).search(marca)
    i = rel < 0 ? -1 : desde + rel
  } else {
    i = texto.indexOf(marca, desde)
  }
  assert.ok(i >= 0, `no encontré la marca «${marca}»: el test no puede recortar a ciegas (¿se renombró?)`)
  return i
}

/**
 * Una etiqueta de un .cmd, ENTERA y sola en su renglón.
 *
 * Buscar el texto ":esperando" encuentra también ":esperandox": lo probó la
 * mutación que renombra la etiqueta, que con la primera versión de estos helpers
 * (un `indexOf` del texto) seguía dando exit code 0.
 */
const etiqueta = (nombre) => new RegExp(`^:${nombre}[ \\t]*\\r?$`, "m")

/** `texto` desde `marca` hasta el final. */
function desdeMarca(texto, marca) {
  return texto.slice(posicion(texto, marca))
}

/** `texto` desde `inicio` hasta `fin` (sin incluirlo). `fin` se busca DESPUÉS de `inicio`. */
function entreMarcas(texto, inicio, fin) {
  const i = posicion(texto, inicio)
  return texto.slice(i, posicion(texto, fin, i + 1))
}

function bloqueTrasInstalar(comando) {
  const i = codigo.indexOf(comando)
  assert.ok(i > 0, `no encontré "${comando}" en bootstrap.ps1`)
  const resto = codigo.slice(i)
  const fin = resto.indexOf("[OK]")
  assert.ok(fin > 0, `no encontré el "[OK]" que sigue a "${comando}"`)
  return resto.slice(0, fin)
}

test("después de instalar OpenCode se verifica que quedó", () => {
  const bloque = bloqueTrasInstalar("scoop install $ManifiestoOpenCode")
  assert.match(bloque, /Test-OpenCode/, "se imprime [OK] sin comprobar nada")
})

test("la verificación EJECUTA opencode, no mira si el archivo está", () => {
  // La versión anterior de este test aceptaba un Test-Path, y ese es justo el
  // chequeo que no sirve: un shim que apunta a una carpeta vacía existe igual.
  // El docente descubría la diferencia recién al abrir el bot.
  const fn = funcion("Test-OpenCode")

  assert.match(fn, /opencode --version/, "no lo ejecuta: mirar el archivo no alcanza")

  // Y ACÁ ESTABA EL TEATRO: pedía que apareciera `LASTEXITCODE` en algún lado de
  // la función. Que la palabra esté no dice NADA sobre lo que la función contesta.
  // Se podía leer el código de salida, guardarlo, y devolver $true siempre — que
  // es exactamente el defecto original: el instalador diciendo OK sin mirar.
  //
  // Lo que importa es que el VALOR DE RETORNO salga del código de salida.
  // Acepta las dos formas de escribirlo: `return ($LASTEXITCODE -eq 0)` y el
  // `if ($LASTEXITCODE -eq 0) { return $true }` del reintento. La primera versión
  // pedía la forma literal y se puso roja cuando la función pasó a intentar dos
  // veces — sin que cambiara en nada lo que se quería medir.
  //
  // Lo que se mide es que el SÍ salga del código de salida, no que aparezca la
  // palabra `LASTEXITCODE` en algún lado.
  assert.match(
    fn,
    /return\s*\(?\s*\$LASTEXITCODE\s*-eq\s*0\s*\)?|if\s*\(\s*\$LASTEXITCODE\s*-eq\s*0[^{]*\)\s*\{\s*return\s+\$true/,
    "la función mira $LASTEXITCODE pero no devuelve eso: puede contestar que sí igual",
  )

  // Y que no haya un `return $true` suelto, sin el código de salida delante:
  // eso es el defecto original —el instalador diciendo OK sin mirar— escrito de
  // otra manera.
  for (const linea of fn.split("\n")) {
    if (!/return\s+\$true/.test(linea)) continue
    assert.match(linea, /LASTEXITCODE/,
      `hay un \`return $true\` que no depende del código de salida: ${linea.trim()}`)
  }
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
    .filter((l) => /scoop install \$ManifiestoOpenCode/.test(l) && !/Write-Host/.test(l)).length
  // El TECHO, que es lo que este test vino a poner.
  // Tres ramas, cada una corre a lo sumo UNA vez por corrida: el intento normal, UNA
  // reparación, y el cambio a la versión fijada cuando en el disco hay otra (Scoop la
  // instala al lado, no reinstala la misma). Ninguna se llama a sí misma.
  assert.ok(
    instalaciones <= 3,
    `hay ${instalaciones} instalaciones con scoop; el techo es 3 (intento normal, UNA reparación, UN cambio a la versión fijada)`,
  )
  // Y EL PISO, que faltaba. Sin él, `instalaciones === 0` —o sea, un instalador
  // que no instala OpenCode en ningún lado— cumplía «<= 2» y pasaba en verde.
  // No es hipotético: ese fue exactamente el estado de la v0.3.48, que publicó un
  // instalador que no instalaba nada.
  assert.ok(
    instalaciones >= 1,
    "el bootstrap no instala OpenCode en ningún lado",
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
  //
  // LA 0.4.11 VUELVE A SACAR UN OPENCODE, Y ESTE GUARD CAMBIA DE FORMA, NO DE REGLA.
  // Con un OpenCode 2.x puesto por el docente, Scoop contesta "already installed" a
  // nuestro manifest y Tecnia Bot quedaba sobre el 2.x. Se decidió sacarlo (2026-11-21).
  // Lo que hace que NO sea el incidente de arriba es el ORDEN, y eso es lo que se exige:
  //
  //   1. hay UN solo `scoop uninstall`, y está dentro de Quitar-OpenCodeAjeno;
  //   2. antes, en esa función, se bajó la versión fijada (`scoop download`) y se
  //      comprobó EN EL DISCO que el zip está y que su sha256 es el del manifest;
  //      si no, la función vuelve sin sacar nada;
  //   3. tampoco se saca con OpenCode abierto.
  //
  // Medido en la VM: con el zip en el cache, sacar e instalar anda con la red cortada.
  const destructivos = comandos.filter((l) => /scoop uninstall|Remove-Item.*scoop|rm .*scoop/i.test(l))
  assert.deepEqual(
    destructivos.map((l) => l.trim()),
    ["try { scoop uninstall opencode *>&1 | Out-Null } catch { }"],
    "el instalador desinstala o borra algo fuera del único lugar permitido",
  )
  const iq = codigo.indexOf("function Quitar-OpenCodeAjeno {")
  const quitar = codigo.slice(iq, codigo.indexOf("\n}", iq))
  assert.ok(iq > 0 && quitar.includes("scoop uninstall opencode"), "el único uninstall no está en Quitar-OpenCodeAjeno")
  const pos = (t) => quitar.indexOf(t)
  const abierto = pos("if (@(Get-OpenCodeAbiertos).Count -gt 0) {")
  const baja = pos("scoop download $ManifiestoOpenCode")
  const comprueba = pos("if (-not (Test-OpenCodeFijadoEnCache)) {")
  const saca = pos("scoop uninstall opencode")
  assert.ok(abierto > 0 && baja > abierto && comprueba > baja && saca > comprueba, "el orden no es: nadie lo usa → bajar → comprobar en el disco → sacar")
  // Entre la comprobación y el uninstall hay un `return $false`: si el zip no está, no se saca nada.
  assert.match(quitar.slice(comprueba, saca), /return \$false/, "si la fijada no quedó bajada, igual saca el OpenCode que había")
  assert.match(quitar.slice(abierto, baja), /return \$false/, "saca un OpenCode que está abierto")
  // EL SERVICIO DE FONDO DEL 2.x (`opencode serve --service`) no cuenta como abierto: queda
  // vivo mucho después de cerrar el programa y el cambio no se haría nunca. Pero se cierra
  // DESPUÉS de comprobar la descarga (si no se va a cambiar, no se le toca nada al docente)
  // y antes de sacar se vuelve a mirar que no quede NINGÚN opencode vivo.
  const cierra = pos("foreach ($p in @(Get-OpenCodeAbiertos -Servicio)) {")
  const remira = pos("if ($quedan -gt 0) {")
  assert.ok(cierra > comprueba && remira > cierra && saca > remira, "el orden no es: comprobar la descarga → cerrar el servicio de fondo → volver a mirar → sacar")
  assert.match(quitar.slice(remira, saca), /return \$false/, "saca aunque quedó un OpenCode vivo")
  assert.match(quitar, /\$quedan = @\(Get-Process opencode -ErrorAction SilentlyContinue\)\.Count/, "la segunda mirada no cuenta todos los procesos de OpenCode")
  const ia = codigo.indexOf("function Get-OpenCodeAbiertos {")
  const abiertos = codigo.slice(ia, codigo.indexOf("\n}", ia))
  assert.match(abiertos, /if \(\$Servicio\) \{ return @\(\$todos \| Where-Object \{ \$_\.CommandLine -match 'serve\\s\+--service' \}\) \}/, "no reconoce el servicio de fondo por su línea de comando")
  assert.match(abiertos, /return @\(\$todos \| Where-Object \{ \$_\.CommandLine -notmatch 'serve\\s\+--service' \}\)/, "trata como servicio de fondo a una ventana que alguien está usando")
  // La comprobación mira el archivo y su hash; no le cree al exit de Scoop.
  const ic = codigo.indexOf("function Test-OpenCodeFijadoEnCache {")
  const cache = codigo.slice(ic, codigo.indexOf("\n}", ic))
  assert.match(cache, /Get-FileHash -LiteralPath \$f\.FullName -Algorithm SHA256/, "no calcula el sha256 del zip bajado")
  assert.match(cache, /if \(\$hashes -contains \$h\) \{ return \$true \}/, "da por bueno un zip cuyo hash no es el del manifest")
  assert.match(cache, /-Filter "opencode#\$OpenCodeVersion#\*"/, "no busca el zip de la versión fijada")
  assert.match(cache, /return \$false\s*$/, "si no encontró el zip, no devuelve falso")

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
  const paso2 = codigo.indexOf("scoop install $ManifiestoOpenCode")
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
  // Sobre `codigo`: bootstrap.ps1 explica en comentarios por qué NO hay `exit 1`
  // antes de instalar la capa, así que buscarlo en el archivo crudo lo encuentra
  // en la explicación. Un test que se satisface con un comentario no prueba nada.
  const i = codigo.indexOf("Scoop NO quedo instalado")
  assert.ok(i > 0, "no se verifica que Scoop haya quedado")
  assert.match(hasta(codigo, i, /\n\s*(?:function|if|Write-Host \[)/), /exit 1/,
    "avisa que falta Scoop pero sigue de largo")
})

test("PlatformIO avisa si falta, pero NO corta", () => {
  // Es distinto a los otros dos: sin PlatformIO el bot igual sirve para
  // explicar, dibujar circuitos y repartir fichas. Sólo no puede compilar.
  const i = codigo.indexOf("PlatformIO NO quedo instalado")
  assert.ok(i > 0, "no se verifica que PlatformIO haya quedado")
  const mensaje = hasta(codigo, i, /\n\s*(?:function|if|Write-Host \[)/)
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

/**
 * El .iss sin comentarios PERO CON las llaves.
 *
 * `issCodigo` borra los `{...}` para que las constantes de Inno no ensucien las
 * comparaciones, y eso se lleva puesto `{autoprograms}` — que es justo lo que
 * identifica un acceso directo del menú inicio. Un test que buscara eso ahí
 * encontraba cero, siempre, dijera lo que dijera el archivo.
 */
const issAtajos = iss.replace(/^\s*;.*$/gm, "")
const cmd = readFileSync(join(REPO, "installer/abrir-tecnia-bot.cmd"), "utf8")

/**
 * El .cmd sin comentarios. CUARTA vez que esto muerde en el repo: los comentarios
 * citan rutas y comandos para explicar los bugs, y un indexOf sobre el archivo
 * entero encuentra la CITA, no el código. Ya pasó con `opencode.cmd`, con
 * `ssInstall`, con `scoop install opencode`, y ahora con la ruta del binario.
 */
const cmdCodigo = cmd.replace(/^\s*rem\b.*$/gim, "")

test("la marca se pone al EMPEZAR la instalación, no al llegar a [Run]", () => {
  // Ponerla en [Run] no alcanzaba, y se pagó dos veces: en una máquina que YA
  // tenía Tecnia Bot, el acceso directo anterior está vivo desde el segundo cero.
  // Medido: el .cmd nuevo aparece a los 0,81 s y la marca a los 0,94 s. En una
  // notebook con antivirus escaneando 5,6 MB de archivos chicos son decenas de
  // segundos, y en esa ventana el docente abre el lanzador VIEJO.
  //
  // ssInstall se dispara al apretar "Instalar" y antes de copiar un solo archivo.
  const code = desdeMarca(issCodigo, "[Code]")
  assert.match(code, /CurStepChanged/, "no hay hook de paso de instalación")
  const hook = desdeMarca(code, "procedure CurStepChanged")
  assert.match(hook, /CurStep = ssInstall\b/, "la marca no se pone al EMPEZAR la instalación")
  assert.match(hook, /\.instalando/, "el hook no crea la marca")
})

test("la marca se borra al terminar, y también si se cancela", () => {
  // Sobre `issCodigo` y no sobre `iss`: los comentarios del .iss citan la marca
  // para explicar por qué existe, y un indexOf sobre el archivo crudo encuentra la
  // CITA. Es la misma trampa que ya mordió en bootstrap.ps1 y en urls.test.mjs.
  //
  // ESTE TEST MIRABA LA FORMA VIEJA, y se reescribió cuando el bootstrap se mudó.
  // Antes buscaba, dentro de [Run], una entrada con `bootstrap.ps1` seguida de un
  // `cmd /c del ...\.instalando`. Las dos entradas se fueron de [Run]: el bootstrap
  // ahora lo lanza [Code] con Exec (para poder LEER su código de salida, que una
  // entrada con `waituntilterminated` espera pero no mira), y el borrado de la marca
  // se mudó con él. Lo que se quería medir no cambió —que la marca se borre DESPUÉS
  // del bootstrap y pase lo que pase—; cambió dónde vive.
  //
  // De paso, el recorte viejo terminaba en `indexOf("[UninstallRun]")`, sección que
  // ya no existe: daba -1 y `slice(i, -1)` devolvía el resto del archivo. Pasaba por
  // casualidad.
  //
  // Y el recorte nuevo tenía el mismo defecto que el viejo, un renglón más abajo:
  // terminaba en `code.indexOf("procedure CurPageChanged")` sin mirar el -1. Si esa
  // rutina se renombra, `slice(i, -1)` vuelve a ser «el resto del archivo».
  // Mutación: renombrar `procedure CurPageChanged` en el .iss → antes exit 0, ahora 1.
  const code = desdeMarca(issCodigo, "[Code]")
  const hook = entreMarcas(code, "procedure CurStepChanged", "procedure CurPageChanged")
  const post = desdeMarca(hook, "CurStep = ssPostInstall")
  // try / bootstrap / finally / borrar la marca: en ESE orden, y adentro del finally.
  assert.match(post, /try\s+CorrerElBootstrap;\s+finally\s+if MarcaInstalando <> '' then\s+DeleteFile\(MarcaInstalando\);\s+end;/,
    "la marca no se borra en un `finally` después del bootstrap: si el bootstrap falla, queda puesta")
  // Y que la marca que se borra sea la misma que se puso.
  assert.match(hook, /MarcaInstalando := ExpandConstant\('\\\.instalando'\)/, "MarcaInstalando no apunta a la marca .instalando")
  // Si se cancela a mitad, sin esto la marca queda puesta y el lanzador espera
  // 20 minutos de gusto.
  assert.match(code, /procedure DeinitializeSetup[\s\S]*?DeleteFile\(MarcaInstalando\)/, "no hay limpieza para el caso de cancelar")
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
  const sinOpenCode = desdeMarca(cmd, etiqueta("sinopencode"))
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
  //
  // ESTE ERA EL RECORTE MÁS PELIGROSO DEL ARCHIVO: un `doesNotMatch` sobre
  // `cmd.slice(cmd.indexOf(":esperando"), cmd.indexOf("LSS"))`. Si cualquiera de las
  // dos marcas falta, el recorte queda vacío (o de un carácter), y un texto vacío no
  // contiene nada prohibido: el test pasa SIEMPRE. Ahora las dos marcas tienen que
  // estar (la etiqueta, a principio de línea) y el recorte tiene un piso.
  // Mutación: renombrar la etiqueta `:esperando` a `:esperandox` en el .cmd → antes
  // exit 0, ahora 1 (y con la primera versión del arreglo, que buscaba el texto de la
  // etiqueta con `indexOf`, seguía en 0: por eso `etiqueta()` pide el renglón entero).
  const espera = entreMarcas(cmdCodigo, etiqueta("esperando"), "LSS")
  // El piso: el bucle de espera tiene que estar entero adentro del recorte.
  assert.match(espera, /\.instalando|%MARCA%/, "el recorte de la espera no contiene la marca que mira: no es el bucle")
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

// ── POR QUÉ SE REESCRIBIERON LOS TRES TESTS DE ABAJO: ERAN HUECOS ─────────────
//
// Los tres existían y los tres daban verde con el bug adentro. Medido por
// mutación sobre install/install.ps1 antes de tocarlos (exit code de
// `node --test tests/instalador.test.mjs`, sin pipe):
//
//   (a) la cura del BOM con `[System.Text.Encoding]::UTF8` (que EMITE BOM) en vez
//       de `(New-Object System.Text.UTF8Encoding $false)`             → 0, VERDE
//   (a') lo mismo en la escritura del temporal de Escribir-TextoAtomico, que es
//       por donde hoy se guarda la key                                → 0, VERDE
//   (b) esa escritura del temporal cambiada por
//       `$texto | Out-File -FilePath $temporal -Encoding utf8`        → 0, VERDE
//   (b') el guardado de la key cambiado por
//       `... | Out-File -FilePath $AuthFile -Encoding utf8`           → 0, VERDE
//
// Por qué eran huecos, uno por uno:
//
//   1. «ningún JSON se escribe con Set-Content» buscaba UN verbo con UNA forma de
//      escribirlo (`Set-Content -Path $var ... -Encoding UTF8`). `Out-File`,
//      `Add-Content`, o el mismo Set-Content con `-LiteralPath`, pasaban de largo.
//      Prohibía una manera de equivocarse, no el error.
//   2. «las credenciales se escriben sin BOM» pedía que la línea dijera
//      `WriteAllText`. WriteAllText con `[System.Text.Encoding]::UTF8` ES
//      WriteAllText y mete BOM igual: lo que decide es el TERCER argumento, y
//      nadie lo miraba. Además filtraba por líneas que nombraran `$AuthFile`, y la
//      key hoy se escribe por Escribir-TextoAtomico, que escribe en `$temporal`:
//      la escritura que más importa había quedado fuera del test.
//   3. «CURA un auth.json con BOM» recortaba hasta `indexOf("$authData = $null")`,
//      texto que ya no existe en install.ps1: daba -1 y `slice(0, -1)` devolvía EL
//      ARCHIVO ENTERO. Los tres `assert.match` se cumplían con cualquier
//      ReadAllBytes / 0xEF…0xBF / WriteAllText de cualquier parte del script. Y el
//      `assert.ok(i > 0)` que estaba al final no protegía ese recorte: miraba otro
//      índice.
//
// Ahora se enumeran TODAS las primitivas de escritura del script (no una), se mira
// el argumento de codificación (no el nombre del método), y la cura se recorta por
// llaves balanceadas con un assert que explota si la cabecera no está.
//
// Mutaciones que ahora dan ROJO (exit code 1 en este archivo; cada una se aplicó
// con un script que hace assert de que el texto a reemplazar existe, y se comprobó
// con `git diff --stat` antes de correr): (a), (a'), (b), (b'), y además
//   (b'') la cura cambiada por `$texto | Out-File -FilePath $AuthFile -Encoding utf8`
//   (c)  borrar la línea que reescribe el archivo en la cura
//   (c') neutralizar la detección con `if ($false) {`
//   (d)  que la cura decodifique desde el byte 0 (`GetString($bytes, 0, ...)`): el
//        U+FEFF queda adentro del texto y se vuelve a escribir como EF BB BF.
//
// LÍMITE HONESTO: esto es forma, no conducta. En esta máquina no hay PowerShell,
// así que ninguno de estos tests EJECUTA install.ps1. Que el archivo salga sin BOM
// de verdad sólo se puede medir en Windows (CI, job `windows`).

/** install.ps1 sin comentarios: los comentarios citan `Set-Content` para explicar el bug. */
const instalarCodigo = instalarPs1.replace(/^\s*#.*$/gm, "")

/** El único tercer argumento aceptado para escribir algo que lee un runtime de JS. */
const SIN_BOM = "(New-Object System.Text.UTF8Encoding $false)"

/** Toda forma que tiene PowerShell de dejar bytes en un archivo. */
const PRIMITIVA_DE_ESCRITURA =
  /\b(?:Set-Content|Add-Content|Out-File|Tee-Object|Export-Clixml|Export-Csv)\b|\b(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines|OpenWrite|CreateText)\s*\(|StreamWriter|FileStream/

/** Las líneas de install.ps1 (sin comentarios) que escriben un archivo. */
function lineasQueEscriben() {
  return instalarCodigo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => PRIMITIVA_DE_ESCRITURA.test(l))
}

/** Un bloque `cabecera ... }` de PowerShell, contando llaves. Explota si no está. */
function bloquePs(texto, cabecera) {
  const i = texto.indexOf(cabecera)
  assert.ok(i >= 0, `install.ps1 ya no tiene «${cabecera}»: el test no puede recortar a ciegas`)
  const abre = texto.indexOf("{", i)
  assert.ok(abre >= 0, `«${cabecera}» no abre llave`)
  let nivel = 0
  for (let j = abre; j < texto.length; j++) {
    if (texto[j] === "{") nivel++
    else if (texto[j] === "}" && --nivel === 0) return texto.slice(i, j + 1)
  }
  assert.fail(`«${cabecera}» no cierra llave`)
}

test("ningún archivo JSON se escribe con BOM: se miran TODAS las escrituras y su codificación", () => {
  /*
   * Lo único que puede escribir con otra cosa que UTF-8 sin BOM es lo que NO lee un
   * runtime de JavaScript. Hoy son dos líneas, y van enteras: si mañana cambia el
   * destino o la codificación de alguna, alguien tiene que mirarla y decidir.
   *   - el manifest lo lee PowerShell, que saca el BOM solo;
   *   - el platformio.ini de precalentado es ASCII puro y lo lee PlatformIO.
   */
  const PERMITIDAS = [
    "Set-Content -Path $Manifest -Value $manifestLines -Encoding UTF8",
    'Set-Content -Path (Join-Path $proj "platformio.ini") -Value $IniPlacas -Encoding ASCII',
  ]
  const escrituras = lineasQueEscriben()
  // El piso: si el filtro deja de encontrar escrituras, el test no puede quedar verde
  // por no haber mirado nada.
  assert.ok(escrituras.length >= 6, `sólo encontré ${escrituras.length} escrituras en install.ps1: el filtro dejó de ver`)
  for (const permitida of PERMITIDAS) {
    assert.ok(escrituras.includes(permitida), `la excepción «${permitida}» ya no existe tal cual: revisá la lista`)
  }
  const culpables = escrituras.filter((l) => {
    if (PERMITIDAS.includes(l)) return false
    // Tiene que ser WriteAllText(<destino>, <texto>, SIN_BOM) y nada más en la línea.
    return !(l.startsWith("[System.IO.File]::WriteAllText(") && l.endsWith(", " + SIN_BOM + ")"))
  })
  assert.deepEqual(
    culpables,
    [],
    "estas escrituras pueden salir con BOM (o no declaran la codificación) y JSON.parse las rechaza en silencio — " +
      "usá [System.IO.File]::WriteAllText(..., " + SIN_BOM + ")",
  )
  // Y la redirección, que también escribe (en PowerShell 5.1, en UTF-16 con BOM).
  const redirecciones = instalarCodigo
    .split(/\r?\n/)
    .filter((l) => !/Write-Host/.test(l) && /(?:^|[^-=<>2&|])>{1,2}\s*["$(]/.test(l))
    .map((l) => l.trim())
  assert.deepEqual(redirecciones, [], "hay una redirección a archivo: en PowerShell 5.1 escribe UTF-16 con BOM")
})

test("el archivo de credenciales se escribe sin BOM, por los DOS caminos que lo escriben", () => {
  const escrituras = lineasQueEscriben()
  // Camino 1: la única escritura directa sobre auth.json es la cura.
  const directas = escrituras.filter((l) => l.includes("$AuthFile"))
  assert.deepEqual(
    directas,
    ["[System.IO.File]::WriteAllText($AuthFile, $texto, " + SIN_BOM + ")"],
    "cambió la escritura directa de auth.json (tiene que ser sólo la cura, y sin BOM)",
  )
  // Camino 2: todo lo demás va por Escribir-TextoAtomico, y ESA función escribe sin BOM.
  const fn = bloquePs(instalarCodigo, "function Escribir-TextoAtomico(")
  const escriturasFn = fn.split(/\r?\n/).map((l) => l.trim()).filter((l) => PRIMITIVA_DE_ESCRITURA.test(l))
  assert.deepEqual(
    escriturasFn,
    ["[System.IO.File]::WriteAllText($temporal, $texto, " + SIN_BOM + ")"],
    "Escribir-TextoAtomico ya no escribe el temporal en UTF-8 sin BOM: por ahí pasa la key",
  )
  // Y que la key de verdad pase por ahí: si el guardado dejara de usarla, lo de
  // arriba mediría una función que nadie llama.
  const usos = instalarCodigo.split(/\r?\n/).filter((l) => /^\s*(?:try \{ )?Escribir-TextoAtomico \$AuthFile /.test(l))
  assert.ok(usos.length >= 2, `esperaba al menos dos escrituras de auth.json por Escribir-TextoAtomico (purga y guardado) y hay ${usos.length}`)
  assert.ok(usos.some((l) => l.includes("$candidato")), "el guardado de la key ya no pasa por Escribir-TextoAtomico")
  // Ninguna línea le pasa auth.json por un pipe o por una redirección a otra cosa.
  const raras = instalarCodigo
    .split(/\r?\n/)
    .filter((l) => /\|\s*[\w-]+[^|]*\$AuthFile/.test(l) || />\s*\$AuthFile/.test(l))
    .map((l) => l.trim())
  assert.deepEqual(raras, [], "auth.json recibe la salida de un pipe o de una redirección")
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
  const cura = bloquePs(instalarCodigo, "if (Test-Path $AuthFile) {")
  assert.match(cura, /\$bytes = \[System\.IO\.File\]::ReadAllBytes\(\$AuthFile\)/,
    "lee el archivo como texto: así el BOM es invisible")
  // La detección, entera: los tres bytes de la firma y que el archivo los tenga.
  const deteccion = "if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {"
  const conBom = bloquePs(cura, deteccion)
  // Se decodifica SALTEANDO los tres bytes: desde 0, el U+FEFF queda en el texto y
  // WriteAllText lo vuelve a escribir como EF BB BF, con cualquier codificación.
  assert.match(conBom, /\$texto = \[System\.Text\.Encoding\]::UTF8\.GetString\(\$bytes, 3, \$bytes\.Length - 3\)/,
    "no saltea los tres bytes del BOM al decodificar")
  // Y se REESCRIBE, adentro de la rama que detectó el BOM y sin BOM.
  const reescritura = "[System.IO.File]::WriteAllText($AuthFile, $texto, " + SIN_BOM + ")"
  assert.ok(conBom.includes(reescritura), "detecta el BOM pero no reescribe el archivo sin BOM")
  assert.ok(conBom.indexOf(reescritura) > conBom.indexOf("GetString($bytes, 3"),
    "reescribe antes de haber sacado el BOM del texto")
  // La cura va ANTES de leer las credenciales: si no, la decisión de «ya está
  // configurado» se toma sobre el archivo envenenado.
  const iCura = instalarCodigo.indexOf(cura)
  const iLectura = instalarCodigo.indexOf("$lecturaAuth = Leer-AuthJson $AuthFile")
  assert.ok(iLectura >= 0, "install.ps1 ya no lee las credenciales con `$lecturaAuth = Leer-AuthJson $AuthFile`")
  assert.ok(iCura >= 0 && iCura < iLectura, "la cura del BOM corre después de leer las credenciales")
})

test("el lanzador COMPLETA la instalación si quedó a medias", () => {
  // Una notebook real quedó así: el instalador mostró su pantalla verde y no
  // había instalado nada — el paso automático murió en 2,4 segundos. El MISMO
  // script, corrido a mano dos minutos después, instaló todo perfecto.
  //
  // O sea que el script está bien y falla el contexto en que Inno lo lanza. El
  // docente no tiene por qué saber eso ni tipear un comando de PowerShell: el
  // lanzador lo hace solo en el primer doble clic.
  assert.match(cmd, /:reparar/, "no hay camino de reparación")
  const rep = entreMarcas(cmd, etiqueta("reparar"), etiqueta("completo"))
  assert.match(rep, /bootstrap\.ps1/, "no completa la instalación")

  // UNA vez, no en bucle: reintentar para siempre en la máquina de alguien es
  // peor que fallar.
  assert.match(rep, /YAREPARE/, "puede quedar reintentando en bucle")
})

test("el lanzador encuentra OpenCode aunque falte el shim", () => {
  // El binario pesa 180 MB y el shim 20 KB. Scoop puede dejar el primero y
  // abortar antes del segundo: quedaba todo menos esa pieza, y el lanzador —que
  // buscaba sólo por el shim— decía "No se encontró OpenCode".
  assert.match(cmdCodigo, /apps\\opencode\\current\\opencode\.exe/, "no busca el binario directo")
  // Orden nuevo (2026-09-06): el binario real primero. El shim de Scoop fallo en la VM y en
  // una notebook ("Shim: Could not determine if target is a GUI app") con opencode.exe sano;
  // current\ es el enlace que Scoop mantiene. Despues el shim, y el PATH al final.
  const orden = ["current\\opencode.exe", "shims\\opencode.exe", "if not errorlevel 1 set \"OC=opencode\""]
  let pos = -1
  for (const o of orden) {
    const i = cmdCodigo.indexOf(o)
    assert.ok(i > pos, `"${o}" no está, o está fuera de orden`)
    pos = i
  }
})

test("tampoco se le SUGIERE al docente un comando destructivo", () => {
  // La regla "el instalador puede fallar, pero no puede romper" se aplicó al
  // código y se olvidó en la pantalla: `scoop uninstall opencode` se sacó del
  // script y quedó impreso en amarillo, como recomendación.
  //
  // Un docente que lo copia con la red del aula saturada se queda sin OpenCode:
  // el uninstall siempre funciona, la descarga de 57 MB no. Y se mostraba también
  // cuando la causa es una CPU sin AVX2, donde reinstalar no converge nunca.
  const impresos = ps1
    .split("\n")
    .filter((l) => /Write-Host/.test(l) && /scoop uninstall|Remove-Item/i.test(l))
  assert.deepEqual(
    impresos.map((l) => l.trim()),
    [],
    "le imprime al docente un comando que puede dejarlo peor:\n" + impresos.join("\n"),
  )
})

test("el lanzador NO repara mientras hay una instalación en curso", () => {
  // La regresión más peligrosa de la noche, y sólo aparece con muchas máquinas.
  //
  // El techo de la espera desembocaba en :reparar, que lanzaba un SEGUNDO
  // bootstrap EN PARALELO con el que corre Inno: dos `scoop install opencode`
  // sobre los mismos archivos. Es el bug de las instalaciones simultáneas que el
  // SetupMutex arregla — pero el mutex sólo bloquea un segundo Setup.exe, no un
  // bootstrap lanzado desde el .cmd.
  //
  // Con 20 máquinas compartiendo la red, pasar el techo no es raro: es lo normal.
  // Mutación: que `:reparar` ya no lance bootstrap.ps1 → antes este recorte era
  // «toda la sección menos un carácter» y los dos asserts de abajo se cumplían con
  // texto de cualquier parte; ahora explota nombrando la marca que falta.
  const antesDeLanzar = entreMarcas(cmdCodigo, etiqueta("reparar"), "bootstrap.ps1")
  assert.match(antesDeLanzar, /if exist "%MARCA%"/,
    "entra a reparar sin mirar si hay una instalación corriendo")
  assert.match(antesDeLanzar, /exit \/b/,
    "detecta la instalación en curso pero no se detiene")
})

test("no se acepta el python falso de la Microsoft Store", () => {
  // ASÍ FALLÓ EN UNA MÁQUINA REAL (capacitación del 20/08, equipo de Dirección).
  //
  // Windows deja un `python.exe` en %LOCALAPPDATA%\Microsoft\WindowsApps que no
  // es Python: abre la tienda. Y esa carpeta suele ir ANTES que los shims de
  // Scoop en el PATH, así que `python` a secas se lo lleva puesto.
  //
  // El código tenía `if (-not (Test-Path $shim)) { $PyExe = "python" }`. Ese
  // fallback no era una red de seguridad: GARANTIZABA el modo de falla, porque
  // si se llegaba ahí era justamente cuando no había otro python en el PATH.
  //
  // El log de esa máquina lo dice con todas las letras: "no se encontro Python;
  // ejecutar sin argumentos para instalar desde el Microsoft Store".
  const fn = funcion("Buscar-Python")

  assert.match(fn, /WindowsApps/, "no descarta el señuelo de la Microsoft Store")
  assert.match(fn, /Python\\s\*\+?3|Python\\\\s\+3|Python/, "no verifica que el candidato sea Python de verdad")

  // Y que le PREGUNTE, en vez de suponerlo por dónde vive el archivo: un
  // `Test-Path` pasa contra el señuelo igual que contra el bueno.
  assert.match(fn, /--version/, "no ejecuta el candidato: mirar que el archivo esté no alcanza")
  assert.match(fn, /LASTEXITCODE/, "lo ejecuta pero no mira si terminó bien")

  // El fallback venenoso no puede volver.
  assert.doesNotMatch(codigo, /\$PyExe\s*=\s*"python"/,
    'volvió el fallback a `python` pelado, que en Windows moderno es el señuelo de la Store')
})

test("si no hay Python, se dice cómo apagar el alias -- no sólo que falta", () => {
  // El mensaje de Windows ya explica el arreglo, pero aparece en medio de
  // cincuenta líneas de instalación y nadie lo lee. Se lo repite donde se ve.
  const i = codigo.indexOf("No hay un Python usable")
  assert.ok(i > 0, "no avisa cuando no encuentra Python")
  const bloque = hasta(codigo, i, /\n\s*\} else \{/)

  // SE MIDE EL TEXTO COMO LO LEE LA DOCENTE, no como está escrito.
  //
  // La primera versión buscaba "Alias de ejecucion" en el código y daba rojo:
  // la frase estaba, pero partida entre dos `Write-Host` —"Alias de" cerraba una
  // línea y "ejecucion de aplicaciones" abría la siguiente—. En pantalla se lee
  // igual; en el archivo hay comillas y un `Write-Host` en el medio.
  //
  // Un mensaje se prueba por lo que dice, no por en cuántas líneas se escribió.
  const enPantalla = [...bloque.matchAll(/Write-Host\s+"([^"]*)"/g)]
    .map((m) => m[1])
    .join(" ")
    .replace(/\s+/g, " ")

  assert.match(enPantalla, /Alias de ejecucion de aplicaciones/i,
    "no dice dónde se apaga el señuelo, que es el único paso que arregla esto")
  assert.match(enPantalla, /volve a correr este instalador/i,
    "dice cuál es el problema pero no qué hacer después de arreglarlo")
  assert.doesNotMatch(bloque, /exit 1/,
    "sin PlatformIO el bot sirve igual para explicar y repartir fichas: no puede cortar acá")
})

test("OpenCode no se declara muerto en el primer intento", () => {
  // El antivirus escanea los 200 MB recién bajados y el shim de Scoop no puede
  // leer el encabezado del ejecutable. Eso dio "OpenCode no arranca" en una
  // máquina donde el bot ANDA -- lo usó la docente ese mismo día.
  //
  // Es, muy probablemente, el misterio del bootstrap que moría a los 2,4
  // segundos y andaba corrido a mano dos minutos después: lo único distinto
  // entre las dos corridas era el tiempo.
  const fn = funcion("Test-OpenCode")
  assert.match(fn, /foreach|for\s*\(|do\s*\{/, "no reintenta: un falso negativo cuesta una reinstalación entera")
  assert.match(fn, /Start-Sleep/, "reintenta sin esperar, así que reintenta contra el mismo instante")
})

test("todo acceso directo que el bot menciona EXISTE de verdad", () => {
  // ESTE TEST NACIÓ DE UN CONSEJO IMPOSIBLE.
  //
  // En una máquina de la capacitación faltó PlatformIO, y el bot le dijo a la
  // docente: «volvé a correr el instalador de Tecnia Bot desde el menú inicio».
  // Fue a buscarlo y no existía. Los accesos eran abrir, diagnosticar y
  // desinstalar — ninguno reinstala.
  //
  // Eso es peor que no decir nada: la persona busca, no encuentra, y concluye
  // que el error es suyo.
  //
  // Se contrasta el TEXTO QUE LEE EL DOCENTE contra los [Icons] del instalador.
  // Si mañana alguien renombra un acceso directo, este test lo agarra antes que
  // un aula.
  const atajos = [...issAtajos.matchAll(/Name:\s*"\{autoprograms\}\\([^"]+)"/g)]
    .map((m) => m[1].replace(/\{#MyAppName\}/g, "Tecnia Bot"))

  assert.ok(atajos.length >= 3, `sólo encontré ${atajos.length} accesos directos`)

  const fuentes = [
    "opencode/tool/platformio.ts",
    "opencode/command/diagnostico.md",
    "installer/abrir-tecnia-bot.cmd",
  ].map((f) => readFileSync(join(REPO, f), "utf8"))

  // Todo lo que el producto nombra entre comillas como «algo de Tecnia Bot» en
  // el menú inicio tiene que estar en esa lista.
  for (const texto of fuentes) {
    for (const m of texto.matchAll(/[«'"]((?:Reparar|Diagnostico|Diagnóstico|Desinstalar)[^«»'"]{0,30}Tecnia Bot)[»'"]/g)) {
      const mencionado = m[1].normalize("NFD").replace(/[̀-ͯ]/g, "")
      const existe = atajos.some(
        (a) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === mencionado.toLowerCase(),
      )
      assert.ok(existe,
        `se le dice al docente que busque «${m[1]}» en el menú inicio, y ese acceso directo no existe.\n` +
        `Los que hay son: ${atajos.join(", ")}`)
    }
  }
})

test("existe una forma de REPARAR sin volver a bajar el .exe", () => {
  // El bootstrap siempre supo repararse —es lo que corre el lanzador cuando
  // detecta que falta algo— pero no había manera de pedírselo a propósito. La
  // única salida real era volver a bajar el instalador del sitio, que nadie
  // adivina.
  const atajos = [...issAtajos.matchAll(/Name:\s*"\{autoprograms\}\\[^"]+"[\s\S]{0,400}?Comment:[^\n]*/g)].map((m) => m[0])
  const reparar = atajos.find((a) => /Reparar/i.test(a))
  assert.ok(reparar, "no hay acceso directo para reparar la instalación")
  assert.match(reparar, /bootstrap\.ps1/, "el acceso 'Reparar' no corre el bootstrap, que es el que instala lo que falta")
  assert.match(reparar, /-NoExit/, "sin -NoExit la ventana se cierra sola y el docente no ve por qué falló")
})
