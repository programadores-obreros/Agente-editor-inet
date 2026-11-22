// Con qué comando se abre el enlace del vínculo (`opencode/plataforma/navegador.ts`).
//
// POR QUÉ EXISTE ESTE ARCHIVO: el 21/11/2026, en la primera corrida del vínculo en
// una Windows 11 real, Edge abrió el enlace cortado en el primer `&` y la plataforma
// contestó «El enlace está incompleto». El tool lo abría con `cmd /c start`, y cmd
// toma `&` como separador de comandos. Hasta ese día el armado del comando estaba
// adentro del tool, pegado a `Bun.spawn`, y ningún test lo miraba: bajo Node no hay
// `Bun`, así que el único caso que lo tocaba caía siempre en el `catch`.
//
// Qué NO prueba esto: que el navegador se abra. Eso sólo se ve en una Windows de
// verdad. Prueba lo que falló: que el enlace llegue entero, en un solo argumento, a
// un programa que no interpreta nada.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const { comandoParaAbrir } = await import("../opencode/plataforma/navegador.ts")
const { urlDeVinculo, crearIntento } = await import("../opencode/plataforma/vinculo.ts")

// Un enlace como los de verdad: tres datos, dos `&`.
const ENLACE = "https://plataforma.tecnialab.net.ar/vincular-bot?challenge=hllfzkFj0jP5wk0ahWb8GB3u1TA-tIdsaAg63aJwH8s&port=39285&state=cLZVDjki_S0w7C0MumUPJg"
// Lo que cmd.exe trata como sintaxis. Si alguno de estos queda como primer
// programa del comando, el enlace vuelve a pasar por un intérprete.
const INTERPRETES = /^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|sh|bash)$/i

test("el enlace de prueba tiene de verdad dos «&» (si no, este archivo no prueba nada)", () => {
  assert.equal(ENLACE.split("&").length, 3)
})

for (const plataforma of ["win32", "darwin", "linux"]) {
  test(`${plataforma}: el enlace llega ENTERO y en un solo argumento`, () => {
    const cmd = comandoParaAbrir(plataforma, ENLACE, "C:\\Windows")
    assert.ok(Array.isArray(cmd))
    assert.equal(cmd.filter((a) => a === ENLACE).length, 1, `el enlace entero no es un argumento: ${JSON.stringify(cmd)}`)
    assert.equal(cmd.at(-1), ENLACE, "el enlace no es el último argumento")
    // Ningún otro argumento lleva un pedazo del enlace: no quedó partido.
    for (const a of cmd.slice(0, -1)) assert.ok(!/challenge=|port=|state=/.test(a), `un pedazo del enlace quedó en otro argumento: ${a}`)
  })

  test(`${plataforma}: el comando no pasa por un intérprete`, () => {
    const cmd = comandoParaAbrir(plataforma, ENLACE, "C:\\Windows")
    const programa = cmd[0].split(/[\\/]/).at(-1)
    assert.doesNotMatch(programa, INTERPRETES, `el enlace se le pasa a un intérprete: ${cmd[0]}`)
    assert.ok(!cmd.includes("/c") && !cmd.includes("-c") && !cmd.includes("-Command"), `hay una bandera de intérprete: ${JSON.stringify(cmd)}`)
  })
}

test("win32: usa rundll32 de la carpeta de Windows cuando la conoce, y por nombre cuando no", () => {
  assert.deepEqual(comandoParaAbrir("win32", ENLACE, "C:\\Windows"), ["C:\\Windows\\System32\\rundll32.exe", "url.dll,FileProtocolHandler", ENLACE])
  assert.deepEqual(comandoParaAbrir("win32", ENLACE, "D:\\WINNT\\"), ["D:\\WINNT\\System32\\rundll32.exe", "url.dll,FileProtocolHandler", ENLACE])
  assert.deepEqual(comandoParaAbrir("win32", ENLACE, undefined), ["rundll32.exe", "url.dll,FileProtocolHandler", ENLACE])
  assert.deepEqual(comandoParaAbrir("win32", ENLACE, ""), ["rundll32.exe", "url.dll,FileProtocolHandler", ENLACE])
})

test("darwin y linux: open y xdg-open", () => {
  assert.deepEqual(comandoParaAbrir("darwin", ENLACE), ["open", ENLACE])
  assert.deepEqual(comandoParaAbrir("linux", ENLACE), ["xdg-open", ENLACE])
})

test("lo que no es un enlace http(s) no se abre", () => {
  for (const malo of ["", "no es un enlace", "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "C:\\Windows\\System32\\calc.exe", "ms-settings:"]) {
    assert.equal(comandoParaAbrir("win32", malo, "C:\\Windows"), null, `abriría: ${malo}`)
    assert.equal(comandoParaAbrir("linux", malo), null, `abriría: ${malo}`)
  }
  // El emulador sí: es http contra esta misma compu.
  assert.ok(comandoParaAbrir("linux", "http://localhost:4210/vincular-bot?challenge=a&port=1&state=b"))
})

test("un enlace con espacios o comillas sale codificado: no puede cerrar un argumento", () => {
  const cmd = comandoParaAbrir("win32", 'https://plataforma.tecnialab.net.ar/vincular-bot?x=a b"c&y=1', "C:\\Windows")
  assert.ok(!/[ "]/.test(cmd.at(-1)), `quedó un espacio o una comilla en el argumento: ${cmd.at(-1)}`)
  assert.ok(cmd.at(-1).includes("&y=1"))
})

test("el enlace que arma el vínculo de verdad pasa entero", () => {
  const intento = crearIntento()
  const url = urlDeVinculo("https://plataforma.tecnialab.net.ar", intento, 39285)
  assert.equal(url.split("&").length, 3, "el enlace del vínculo ya no tiene tres datos: revisar este archivo")
  assert.equal(comandoParaAbrir("win32", url, "C:\\Windows").at(-1), url)
})

test("el tool no arma el comando por su cuenta: ni `cmd` ni `start` en opencode/tool/cuenta.ts", () => {
  // El guard del lado del tool. Sin esto, alguien puede «simplificar» y volver a
  // escribir el comando adentro de `abrirEnNavegador`, y los casos de arriba
  // seguirían verdes probando una función que ya nadie llama.
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "opencode", "tool", "cuenta.ts"), "utf8")
  const codigo = fuente.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n")
  assert.doesNotMatch(codigo, /"cmd"|"start"|"xdg-open"|"open"|rundll32/, "el tool volvió a armar el comando del navegador")
  assert.match(codigo, /navegador\.comandoParaAbrir\(process\.platform, url, process\.env\.SystemRoot\)/, "el tool no le pide el comando a plataforma/navegador.ts")
})
