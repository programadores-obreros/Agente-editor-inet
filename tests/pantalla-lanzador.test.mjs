// ============================================================================
// El cartel del lanzador y la fuente de la consola (hallazgos W33 y W34).
//
// De dónde sale. En la prueba del 2026-11-26 en una notebook real, el cartel que
// se ve mientras abre el bot salió desarmado y sin tildes, y dentro de OpenCode
// el borde del cuadro de texto y el spinner salían como «?». El cartel pasó a
// dibujarlo `install/pantalla-lanzador.ps1`, que además mide la fuente de la
// ventana y la cambia a Consolas sólo si la que hay no puede dibujar el borde
// del cuadro de texto de OpenCode (U+2503).
//
// La primera versión cambiaba la fuente «sólo si no es TrueType». Medido después
// en la VM win10: Lucida Console es TrueType y tampoco trae U+2503, así que con
// esa fuente el script no hubiera hecho nada. Por eso ahora decide por el
// carácter y no por el tipo, y el test 5 custodia eso.
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
//   - que el script sólo cambie la fuente cuando la que hay NO puede dibujar el
//     borde, que no cambie a Consolas si Consolas tampoco puede, y que relea la
//     ventana después de cambiarla.
//
// Lo que no: que funcione. Ningún test de Node ejecuta PowerShell ni cmd. Eso se
// prueba en Windows, y hasta que no se pruebe este cambio queda retenido.
//
// Verificado por mutación (cada una pone rojo el test que dice): una tilde en el
// .ps1 → 1; un `goto` en el tramo → 2; un paréntesis en el cartel de reserva →
// 3; sacar la pregunta `if exist` de la segunda línea → 4; cambiar la fuente aunque
// pueda dibujar el borde → 5; cambiar aunque Consolas no pueda → 5; sacar la
// relectura → 5; decidir por otro carácter → 5; devolver `chcp 65001` a la
// segunda línea del lanzador → 8; cambiar una fila del robot del cartel → 9.
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

test("5. la fuente sólo se cambia si la que hay no puede dibujar el borde, y después se relee la ventana", () => {
  // El carácter que decide es el borde del cuadro de texto de OpenCode.
  assert.match(ps1Codigo, /\$Borde = \[char\]0x2503\b/, "el carácter que decide ya no es U+2503")
  // A una fuente de mapa de bits no se le pregunta: no puede. A una TrueType sí.
  assert.match(
    ps1Codigo,
    /\$puede = 0\n\s*if \(\$esTrueType\) \{ \$puede = \[TecniaConsola\]::TieneGlifo\(\$antes\.FaceName, \$Borde\) \}/,
    "ya no se le pregunta a Windows si la fuente actual tiene el borde",
  )
  assert.match(ps1Codigo, /\$consolas = \[TecniaConsola\]::TieneGlifo\("Consolas", \$Borde\)/, "ya no se comprueba que Consolas tenga el borde")

  // Las tres ramas, en orden: no tocar / no tocar / cambiar.
  const r1 = ps1Codigo.indexOf("if ($puede -ne 0) {")
  const r2 = ps1Codigo.indexOf("} elseif ($consolas -ne 1) {")
  const r3 = ps1Codigo.indexOf("} else {", r2)
  const cambio = ps1Codigo.indexOf("SetCurrentConsoleFontEx($salida")
  assert.ok(r1 > 0 && r2 > r1 && r3 > r2 && cambio > r3, "el cambio de fuente no está en la última rama")
  // «-ne 0» y no «-eq 1»: si no se pudo preguntar (-1), tampoco se toca.
  assert.doesNotMatch(ps1Codigo.slice(r1, r3), /SetCurrentConsoleFontEx/, "se cambia la fuente en una rama donde no corresponde")
  assert.equal([...ps1Codigo.matchAll(/SetCurrentConsoleFontEx\(\$salida/g)].length, 1, "hay más de un lugar que cambia la fuente")

  // El assert mide el mundo: después de pedir el cambio, se relee.
  const relectura = ps1Codigo.indexOf("GetCurrentConsoleFontEx($salida, $false, [ref]$despues)")
  assert.ok(relectura > cambio, "después de cambiar la fuente no se vuelve a leer la ventana")
  // Lo que falta vuelve como 0xFFFF sólo si se pide esa marca.
  assert.match(ps1Codigo, /GetGlyphIndicesW\(dc, c\.ToString\(\), 1, indices, 1\)/, "se pregunta por el glifo sin pedir la marca de «no existe»")
  // Si Windows ofreció otra fuente en lugar de la pedida, la respuesta no vale.
  assert.match(ps1Codigo, /String\.Equals\(real\.ToString\(\), fuente, StringComparison\.OrdinalIgnoreCase\)/, "no se comprueba qué fuente respondió")
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
  // 2503 no se dibuja: es el carácter por el que se le pregunta a la fuente.
  assert.deepEqual([...new Set(usados)].sort(), ["2503", "2580", "2584", "2588", "E9"], "hay un carácter nuevo: confirmá que esté en CP437 y CP850")
})

test("8. el lanzador no pasa la consola a UTF-8 antes de llamar a PowerShell", () => {
  // La causa de los «?» del hallazgo W33. Windows PowerShell 5.1, cuando arranca
  // en una consola que está en UTF-8, le cambia la fuente a una de mapa de bits;
  // y con esa fuente la consola convierte todo a la tabla OEM. El lanzador hacía
  // `chcp 65001` en su segunda línea y después llamaba a PowerShell: le pasaba a
  // todos. Medido en la VM win10 el 2026-11-27, fotografiando la ventana tras
  // cada paso.
  const codigo = lineas.filter((l) => !/^\s*rem\b/i.test(l))
  const utf8 = codigo.map((l, n) => (/\bchcp\s+65001\b/i.test(l) ? n : -1)).filter((n) => n >= 0)
  const ultimoPowershell = codigo.map((l, n) => (/\bpowershell\b/i.test(l) ? n : -1)).filter((n) => n >= 0).pop()
  assert.ok(ultimoPowershell > 0, "el lanzador ya no llama a PowerShell: revisá si este test sigue teniendo sentido")
  for (const n of utf8) {
    assert.ok(n > ultimoPowershell, `hay un \`chcp 65001\` antes de una llamada a PowerShell: «${codigo[n]}»`)
  }
  // El guardián se prueba a sí mismo.
  assert.match("chcp 65001 >nul", /\bchcp\s+65001\b/i)
  assert.match("  CHCP  65001", /\bchcp\s+65001\b/i)
  assert.doesNotMatch("chcp 850 >nul", /\bchcp\s+65001\b/i)
})

test("9. el robot del cartel es el MISMO del splash: los dos mapas de píxeles son idénticos", () => {
  // El primer robot del cartel era propio, de tres renglones, y en la notebook se
  // leía como «una E acostada». Ahora el cartel dibuja el mapa del splash. Si
  // alguien retoca uno y se olvida del otro, el docente vería dos robots.
  const plugin = readFileSync(join(raiz, "opencode", "plugins", "tecnia-logo.tsx"), "utf8")
  const mapa = (texto, re, nombre) => {
    const m = texto.match(re)
    assert.ok(m, `no encuentro el mapa de píxeles en ${nombre}`)
    return [...m[1].matchAll(/"([.VHEMG]+)"/g)].map((x) => x[1])
  }
  const delSplash = mapa(plugin, /const ROBOT_PX = \[([\s\S]*?)\n\]/, "el plugin")
  const delCartel = mapa(ps1Codigo, /\$RobotPx = @\(([\s\S]*?)\n\s*\)/, "el .ps1")
  assert.ok(delSplash.length >= 8, "el mapa del splash quedó vacío")
  assert.deepEqual(delCartel, delSplash, "el robot del cartel y el del splash ya no son el mismo")
  // Dos filas de píxeles hacen un renglón: con una cantidad impar el bucle lee una fila que no existe.
  assert.equal(delCartel.length % 2, 0)
  // Cada tinta del mapa tiene su color de consola, y es uno de los 16 que existen.
  const tintas = ps1Codigo.match(/\$Tinta = @\{([^}]*)\}/)
  assert.ok(tintas, "no encuentro la tabla de tintas")
  const pares = Object.fromEntries([...tintas[1].matchAll(/"([A-Z])" = "([A-Za-z]+)"/g)].map((x) => [x[1], x[2]]))
  const COLORES = ["Black", "DarkBlue", "DarkGreen", "DarkCyan", "DarkRed", "DarkMagenta", "DarkYellow", "Gray", "DarkGray", "Blue", "Green", "Cyan", "Red", "Magenta", "Yellow", "White"]
  for (const letra of new Set(delCartel.join("").replace(/\./g, ""))) {
    assert.ok(pares[letra], `la tinta ${letra} del mapa no tiene color`)
    assert.ok(COLORES.includes(pares[letra]), `«${pares[letra]}» no es un color de la consola`)
  }
  // La cabeza y la baldosa no pueden ser del mismo color: el robot desaparecería.
  assert.notEqual(pares.H, pares.V)
})
