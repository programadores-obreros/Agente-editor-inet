// ============================================================================
// El cartel del lanzador y la fuente de la consola (hallazgos W33 y W34).
//
// De dónde sale. En la prueba del 2026-11-26 en una notebook real, el cartel que
// se ve mientras abre el bot salió desarmado y sin tildes, y dentro de OpenCode
// el borde del cuadro de texto y el spinner salían como «?». El cartel pasó a
// dibujarlo `install/pantalla-lanzador.ps1`, que además mide la fuente de la
// ventana y la cambia sólo si es de mapa de bits.
//
// Qué custodia este archivo, y qué NO.
//
// Lo que sí: las cosas que se pueden romper sin que nadie lo note desde Linux.
//   - que el .ps1 siga en ASCII puro (PowerShell 5.1 lo lee en la tabla ANSI: una
//     tilde escrita ahí sale rota en la pantalla del docente);
//   - que nada de esto pueda impedir que el bot abra: ni un `goto` ni un
//     `exit /b` entre el cartel y OpenCode, y un cartel de reserva en el .cmd;
//   - que el cartel de reserva no tenga un carácter que cmd lea como otra cosa
//     (va dentro de un bloque: un paréntesis sin escapar corta el bloque y el
//     lanzador muere antes de abrir);
//   - que el script sólo cambie la fuente cuando la que hay NO es TrueType, y que
//     relea la ventana después de cambiarla.
//
// Lo que no: que funcione. Ningún test de Node ejecuta PowerShell ni cmd. Eso se
// prueba en Windows, y hasta que no se pruebe este cambio queda retenido.
//
// Verificado por mutación (cada una pone rojo el test que dice): una tilde en el
// .ps1 → 1; un `goto` en el tramo → 2; un paréntesis en el cartel de reserva →
// 3; sacar la pregunta `if exist` de la segunda línea → 4; sacar la condición
// TrueType → 5; sacar la relectura → 5.
// ============================================================================
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const ps1Bytes = readFileSync(join(raiz, "install", "pantalla-lanzador.ps1"))
const ps1 = ps1Bytes.toString("utf8")
const cmd = readFileSync(join(raiz, "installer", "abrir-tecnia-bot.cmd"), "utf8")
const lineas = cmd.split(/\r\n/)

// El código del .ps1 sin los comentarios de renglón entero.
const ps1Codigo = ps1
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n")

// Los renglones de cmd que no son comentario, entre dos marcas.
function tramo(desde, hasta) {
  const i = lineas.findIndex((l) => l.startsWith(desde))
  assert.ok(i >= 0, `no encuentro «${desde}» en el lanzador`)
  const j = lineas.findIndex((l, n) => n > i && l.startsWith(hasta))
  assert.ok(j > i, `no encuentro «${hasta}» después de «${desde}»`)
  return lineas.slice(i, j + 1).filter((l) => !/^\s*rem\b/i.test(l))
}

function noAscii(buf) {
  const malos = []
  buf.forEach((b, i) => {
    if (b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x09)) malos.push(`byte 0x${b.toString(16)} en la posición ${i}`)
  })
  return malos
}

test("1. el .ps1 va en ASCII puro, sin BOM y con LF", () => {
  assert.deepEqual(noAscii(ps1Bytes).slice(0, 5), [], "PowerShell 5.1 lee el .ps1 en la tabla ANSI: esto sale roto")
  // El guardián se prueba a sí mismo.
  assert.equal(noAscii(Buffer.from("técnica", "utf8")).length, 2, "no marca una tilde en UTF-8")
  assert.equal(noAscii(Buffer.from([0xef, 0xbb, 0xbf, 0x23])).length, 3, "no marca un BOM")
  assert.equal(noAscii(Buffer.from("a\r\nb")).length, 1, "no marca un CR")
  assert.deepEqual(noAscii(Buffer.from("# ok\n\tok\n")), [])
})

test("2. entre el cartel y OpenCode no hay ni un goto ni un exit: el bot abre igual", () => {
  const t = tramo(":listo2", '"%OC%"')
  assert.ok(t.some((l) => l.includes("pantalla-lanzador.ps1")), "el lanzador no llama a pantalla-lanzador.ps1 en este tramo")
  const cortes = t.filter((l) => /\b(goto|exit)\b/i.test(l))
  assert.deepEqual(cortes, [], "hay un corte entre el cartel y OpenCode")
  // El guardián se prueba a sí mismo.
  assert.match("  exit /b 1", /\b(goto|exit)\b/i)
  assert.match("if errorlevel 1 GOTO fin", /\b(goto|exit)\b/i)
  assert.doesNotMatch('echo   Abriendo... Si al cargar no aparece el agente', /\b(goto|exit)\b/i)
})

// Lo que cmd lee como otra cosa dentro de un bloque `( ... )`.
const PELIGROSOS = /[()|&<>^!]/

test("3. el cartel de reserva existe y no tiene caracteres que cmd lea como otra cosa", () => {
  const i = lineas.findIndex((l) => l === 'if "%CARTEL%"=="no" (')
  assert.ok(i >= 0, "no está el cartel de reserva")
  const j = lineas.findIndex((l, n) => n > i && l === ")")
  assert.ok(j > i, "el bloque del cartel de reserva no cierra")
  const cuerpo = lineas.slice(i + 1, j)
  assert.ok(cuerpo.length >= 4, "el cartel de reserva quedó vacío")
  for (const l of cuerpo) {
    assert.match(l, /^  echo(\.| )/, `en el cartel de reserva hay algo que no es un echo: «${l}»`)
    const texto = l.replace(/^  echo\.?/, "")
    assert.doesNotMatch(texto, PELIGROSOS, `cmd va a leer mal este renglón: «${l}»`)
  }
  assert.ok(cuerpo.some((l) => l.includes("TECNIA BOT v%VER%")), "el cartel de reserva no muestra la versión")
  assert.ok(cuerpo.some((l) => l.includes("https://tecnialab.net.ar/tecnia-bot/")), "el cartel de reserva no dice dónde hay ayuda")
  // El guardián se prueba a sí mismo: el cartel viejo no hubiera pasado.
  assert.match(" ^| ^|_^|        /^|_^|\\   Arduino", PELIGROSOS)
  assert.match("   Abriendo... (cuando cargue)", PELIGROSOS)
})

test("4. un .ps1 que no está no se lee como «ya dibujé el cartel»", () => {
  const t = tramo(":listo2", '"%OC%"')
  const llamada = t.findIndex((l) => /^if exist "%PANTALLA%" powershell .*-File "%PANTALLA%" "%VER%"$/.test(l))
  assert.ok(llamada >= 0, "la llamada al script no está protegida por `if exist`, o no le pasa la versión")
  // `set` deja ERRORLEVEL en 0: sin el segundo `if exist`, con el archivo borrado
  // el lanzador creería que el cartel se dibujó y no mostraría ninguno.
  assert.equal(t[llamada + 1], 'if not errorlevel 1 if exist "%PANTALLA%" set "CARTEL=si"', "la línea que decide si el cartel se dibujó cambió")
  const antes = t.slice(0, llamada)
  assert.ok(antes.includes('set "CARTEL=no"'), "CARTEL no arranca en «no»")
})

test("5. la fuente sólo se cambia si NO es TrueType, y después se vuelve a leer la ventana", () => {
  // La condición: el bit TMPF_TRUETYPE del campo FontFamily.
  assert.match(ps1Codigo, /\$BitTrueType = 4\b/)
  const cambio = ps1Codigo.indexOf("SetCurrentConsoleFontEx($salida")
  assert.ok(cambio > 0, "el script ya no cambia la fuente")
  const guarda = ps1Codigo.indexOf("if (($antes.FontFamily -band $BitTrueType) -ne 0) {")
  const sino = ps1Codigo.indexOf("} else {", guarda)
  assert.ok(guarda > 0 && sino > guarda && cambio > sino, "el cambio de fuente no está en la rama «no es TrueType»")
  // Entre la guarda y el else no se toca nada: la fuente que eligió el docente se respeta.
  assert.doesNotMatch(ps1Codigo.slice(guarda, sino), /SetCurrentConsoleFontEx/, "se cambia la fuente aunque ya sea TrueType")
  // El assert mide el mundo: después de pedir el cambio, se relee.
  const relectura = ps1Codigo.indexOf("GetCurrentConsoleFontEx($salida, $false, [ref]$despues)")
  assert.ok(relectura > cambio, "después de cambiar la fuente no se vuelve a leer la ventana")
  // No se toca el registro ni el acceso directo: el cambio es de esta ventana.
  assert.doesNotMatch(ps1Codigo, /HKCU:|HKLM:|Set-ItemProperty|New-ItemProperty|\.lnk/i, "el script escribe fuera de la ventana")
})

test("6. el script nunca sale con un código que el lanzador no espere", () => {
  const salidas = [...ps1Codigo.matchAll(/\bexit\s+(\S+)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(salidas)].sort(), ["0", "1"], "el lanzador sólo distingue 0 (dibujé) de 1 (no pude)")
  // Todo lo que puede fallar va dentro de un try.
  assert.ok(ps1Codigo.indexOf("try {") < ps1Codigo.indexOf("Add-Type"), "Add-Type está fuera de un try: en modo restringido tira y corta el script")
})

test("7. el cartel dice lo mismo que el splash y lleva la tilde armada por número", () => {
  assert.match(ps1Codigo, /Arduino y ESP32 para la escuela t" \+ \$e \+ "cnica/, "el lema cambió o perdió la tilde")
  assert.match(ps1Codigo, /\$e = \[string\]\[char\]0xE9\b/, "la é ya no se arma con su número")
  assert.match(ps1Codigo, /https:\/\/tecnialab\.net\.ar\/tecnia-bot\//)
  // Los tres bloques del dibujo son de los que están en CP437 y CP850.
  for (const cp of ["0x2588", "0x2580", "0x2584"]) assert.ok(ps1Codigo.includes(`[char]${cp}`), `falta el bloque ${cp}`)
  const usados = [...ps1Codigo.matchAll(/\[char\]0x([0-9A-Fa-f]+)/g)].map((m) => m[1].toUpperCase())
  assert.deepEqual([...new Set(usados)].sort(), ["2580", "2584", "2588", "E9"], "hay un carácter nuevo: confirmá que esté en CP437 y CP850")
})
