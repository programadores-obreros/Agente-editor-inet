// `diagnostico.ps1` es el script que corre un docente CUANDO YA ALGO FALLÓ.
// Ciento setenta líneas sin una sola prueba.
//
// Eran DOS: `reportar.ps1` hacía casi lo mismo y no lo invocaba nadie —el acceso
// directo del menú inicio siempre apuntó a `diagnostico.ps1`—, así que se
// fusionaron. Un segundo script de soporte que nadie puede correr no es una red
// de seguridad: es código que envejece sin que nadie lo mire.
//
// Son distintos del resto: su salida no la lee una máquina, la lee una persona y
// después nos la manda. Eso les agrega una obligación que el resto no tiene —no
// pueden filtrar la clave de la API— y les saca otra: no importa que sean lindos.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPTS = ["install/diagnostico.ps1"]

const leer = (r) => readFileSync(join(REPO, r), "utf8")
/** Sin comentarios: acá se explican los bugs citándolos, y la cita no es código. */
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

test("el script de soporte existe, y es UNO solo", () => {
  for (const r of SCRIPTS) assert.ok(existsSync(join(REPO, r)), `falta ${r}`)
  // Que no vuelva a aparecer un segundo script de soporte sin quién lo llame.
  assert.ok(!existsSync(join(REPO, "install/reportar.ps1")),
    "volvió reportar.ps1: si hace falta, va adentro de diagnostico.ps1, que es el que tiene botón")
})

test("el script de soporte lo puede correr un docente: tiene acceso directo", () => {
  // ESTE TEST EXISTE PORQUE FALTÓ. `reportar.ps1` se copiaba a la máquina de cada
  // docente y no lo llamaba NADIE: para correrlo había que abrir PowerShell y
  // tipear la ruta. Ciento once líneas instaladas y muertas, envejeciendo.
  //
  // Un script de soporte sin botón no es soporte.
  const iss = readFileSync(join(REPO, "installer/tecnia-bot.iss"), "utf8")
  const issCodigo = iss.replace(/^\s*;.*$/gm, "")
  for (const r of SCRIPTS) {
    const nombre = r.split("/").pop()
    assert.match(issCodigo, new RegExp(`\\[Icons\\][\\s\\S]*${nombre.replace(".", "\\.")}`),
      `${nombre} se instala pero no tiene acceso directo: ningún docente va a poder correrlo`)
  }
})

test("son ASCII puro, como el resto de los .ps1", () => {
  // PowerShell 5.1 lee un .ps1 SIN BOM como cp1252. Un acento rompe el parser
  // entero, y el script muere sin ejecutar una línea.
  //
  // Ya pasó: la v0.3.48 publicó un instalador que no instalaba NADA porque
  // entraron tres acentos en un mensaje nuevo de bootstrap.ps1.
  //
  // En estos dos duele más que en ningún otro: son los que se corren para
  // averiguar por qué algo no anda. Si mueren, el docente se queda sin la única
  // herramienta que tenía para contarnos qué pasó.
  for (const r of SCRIPTS) {
    const bytes = Buffer.from(leer(r), "utf8")
    const malos = [...bytes].map((b, i) => [i, b]).filter(([, b]) => b > 127 || (b < 32 && ![9, 10, 13].includes(b)))
    assert.equal(malos.length, 0, `${r} tiene ${malos.length} bytes no-ASCII o de control (offset ${malos[0]?.[0]})`)
  }
})

test("el reporte NO puede llevarse la clave de la API", () => {
  // El docente manda este archivo por mail o por WhatsApp. `auth.json` tiene la
  // clave adentro.
  //
  // El agujero que había no era imprimir la clave —eso nadie lo escribe— sino
  // imprimir el MENSAJE DE ERROR de ConvertFrom-Json cuando el JSON está roto:
  // ese mensaje suele citar el fragmento que no pudo leer, y el fragmento sale
  // del archivo. Justo en el caso de falla, que es el único en que alguien lo
  // manda.
  const codigo = sinComentarios(leer("install/diagnostico.ps1"))

  // Nada del contenido de auth.json se imprime: ni crudo, ni parseado, ni por
  // mensaje de excepción.
  assert.doesNotMatch(codigo, /Exception\.Message/,
    "imprime el mensaje de una excepción, y puede citar el contenido del archivo")
  assert.doesNotMatch(codigo, /Get-Content[^\n]*auth\.json/i,
    "lee auth.json con Get-Content y eso termina en el reporte")

  // Y lo que SÍ tiene que hacer, para que arreglarlo no sea borrarlo: el reporte
  // sigue diciendo si el archivo está, si tiene BOM y si parsea. Eso alcanza para
  // diagnosticar y no lleva nada adentro.
  for (const dato of [/Test-Path \$auth/, /bom/i, /parsea/i]) {
    assert.match(codigo, dato, `el reporte dejó de informar ${dato} y así no sirve para nada`)
  }
})

test("no se imprime el valor de la variable con la clave", () => {
  // La clave también puede estar en una variable de entorno del usuario. Informar
  // que ESTÁ es útil; informar CUÁL es, no.
  for (const r of SCRIPTS) {
    const codigo = sinComentarios(leer(r))
    const menciones = [...codigo.matchAll(/GOOGLE_GENERATIVE_AI_API_KEY/g)]
    for (const m of menciones) {
      const linea = codigo.slice(codigo.lastIndexOf("\n", m.index) + 1, codigo.indexOf("\n", m.index))
      assert.doesNotMatch(linea, /Write-Output[^\n]*\$env:GOOGLE|Write-Host[^\n]*\$env:GOOGLE/,
        `${r} imprime el valor de la clave: ${linea.trim()}`)
    }
  }
})

test("el reporte se puede encontrar: dice dónde lo dejó", () => {
  // Un diagnóstico que el docente no encuentra es un diagnóstico que no existe.
  // Atado al COMPORTAMIENTO, no al nombre de la variable. La primera versión
  // buscaba `$out` literal y se puso roja cuando la variable pasó a llamarse
  // `$Reporte` —sin que el script cambiara en nada de lo que importa—. Un rojo
  // sin defecto atrás enseña a ignorar el rojo.
  const codigo = leer("install/diagnostico.ps1")

  // 1. Guarda a un archivo.
  assert.match(codigo, /Start-Transcript/, "no guarda el reporte en ningún archivo")

  // 2. Y le dice al docente dónde quedó: se imprime la MISMA variable que se le
  //    pasó a Start-Transcript, sea cual sea su nombre.
  const m = codigo.match(/Start-Transcript\s+-Path\s+\$(\w+)/)
  assert.ok(m, "Start-Transcript no recibe una variable con la ruta")
  const variable = m[1]
  assert.match(codigo, new RegExp(`Write-(?:Host|Output)[^\n]*\\$${variable}\\b`),
    `guarda el reporte en $${variable} pero nunca le dice al docente dónde quedó`)

  // 3. Y si NO pudo guardarlo, lo dice y le pide que copie la pantalla: un
  //    diagnóstico que se pierde en silencio es peor que no tenerlo.
  assert.match(codigo, /No se pudo guardar/i,
    "si falla el guardado no avisa, y el docente cree que mandó algo que no existe")
})
