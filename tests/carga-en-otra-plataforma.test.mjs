// En Mac, `programa cargar` dice por qué no carga. No manda a escribir un comando que en esa
// compu no existe.
//
// ACTUALIZACIÓN (2026-11-23, después de la prueba en la notebook del owner): WINDOWS YA NO
// ESTÁ ACÁ. La carga se habilitó en Windows con la misma exigencia que en Linux
// (`tests/carga-en-windows.test.mjs`). Lo de abajo cuenta cómo era cuando Windows también
// rechazaba por plataforma; sigue valiendo, tal cual, para macOS.
//
// POR QUÉ EXISTE ESTE ARCHIVO. La carga del programa generado desde el proyecto físico sólo
// está habilitada en Linux: el control que la autoriza lee de /proc cómo se abrió OpenCode, y
// exige que se haya abierto con el lanzador `tecnia-bot`, que sólo instala install.sh.
//
// El gate miraba PRIMERO el lanzador y DESPUÉS la plataforma. En Windows nunca hay lanzador,
// así que la respuesta era siempre: «NO SE CARGÓ — OpenCode no se abrió con el lanzador de
// Tecnia Bot. Para cargar a la placa, cerrá OpenCode y abrí Tecnia Bot escribiendo
// `tecnia-bot` en la terminal». Ese comando no existe en Windows. El mensaje verdadero («sólo
// está habilitada en Linux») estaba escrito más abajo y era inalcanzable.
//
// Lo encontré el 2026-11-23 preparando la prueba del owner en una notebook con Windows. Y me
// obligó a corregir algo que yo le había dicho: que en Windows «la carga va por el camino
// viejo». No: la tool `platformio` rechaza a propósito la carpeta del programa generado. En
// Windows ESE programa no se puede cargar por ningún camino. El mensaje ahora lo dice.
//
// NO CAMBIA A QUIÉN SE LE PERMITE CARGAR: las dos ramas rechazan. Sólo cambia cuál de los dos
// motivos se dice primero cuando valen los dos.
//
// MUTACIONES que ponen rojo este archivo (ver el commit):
//   - mirar la plataforma después del lanzador (el orden viejo)      → rojo «Mac»
//   - que el mensaje mande a escribir `tecnia-bot`                   → rojo «Mac»
//   - aplicar el rechazo por plataforma también en Linux             → rojo «en Linux nada cambia»
//   - no decir que `platformio` tampoco carga esa carpeta            → rojo «Mac»
//
// Corre con: node --test tests/carga-en-otra-plataforma.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { porQueNoSePuedeCargar } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))

const VACIA = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-plataforma-"))

/** Lo que el gate necesita, con todo «bien» salvo lo que cada caso cambia. */
function herramientas({ plataforma, conLanzador }) {
  return {
    plataforma,
    agenteQueNoPuedeCargar: () => null,
    // Como en producción fuera de Linux: no hay forma de leer la línea de comando.
    lineaDeComando: () => (plataforma === "linux" ? { ok: true, argv: ["opencode"] } : { ok: false, codigo: "PLATAFORMA_NO_HABILITADA", detalle: `en ${plataforma} todavía no hay una forma verificada de leer cómo se abrió OpenCode` }),
    // Una carpeta vacía de verdad: sin configuración de OpenCode que el gate pueda objetar.
    configuracion: { cwd: () => VACIA, home: VACIA, entorno: {} },
    lanzador: conLanzador ? { marca: String(process.pid), pid: process.pid, ancestros: () => [], marcaCon: () => null } : { marca: undefined, pid: process.pid, ancestros: () => [], marcaCon: () => null },
  }
}
const ctx = { directory: VACIA, agent: "tecnia-bot" }

for (const [plataforma, nombre] of [["darwin", "macOS"]]) {
  test(`${nombre}: dice que la carga del programa generado es sólo en Linux, y no manda a abrir con tecnia-bot`, () => {
    // En esas plataformas nunca hay lanzador: es el caso real.
    const r = porQueNoSePuedeCargar(ctx, herramientas({ plataforma, conLanzador: false }))
    assert.ok(r, "en una plataforma no habilitada tiene que rechazar")
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "PLATAFORMA_NO_HABILITADA", `contestó ${r.codigo}: ${r.resultado}`)
    assert.match(r.resultado, /^NO SE CARGÓ/)
    assert.match(r.resultado, new RegExp(nombre), r.resultado)
    assert.match(r.resultado, /Linux y en Windows/, r.resultado)
    assert.doesNotMatch(r.resultado, /escribiendo `tecnia-bot`|abrí Tecnia Bot escribiendo|cerrá OpenCode/, `manda a hacer algo que en ${nombre} no existe:\n${r.resultado}`)
    assert.doesNotMatch(r.resultado, /lanzador/, r.resultado)
    // El modelo no puede concluir que hay otro camino: `platformio` rechaza esa carpeta.
    assert.match(r.resultado, /`platformio`[^.]*(?:no|tampoco)[^.]*carga/i, r.resultado)
    // Y sí tiene que decir qué funciona, para que no dé todo por roto.
    assert.match(r.resultado, /generar/i, r.resultado)
    assert.match(r.resultado, /compilar/i, r.resultado)
  })
}

test("en Linux nada cambia: sin el lanzador sigue siendo SIN_LANZADOR, con la instrucción de abrir con tecnia-bot", () => {
  const r = porQueNoSePuedeCargar(ctx, herramientas({ plataforma: "linux", conLanzador: false }))
  assert.equal(r?.codigo, "SIN_LANZADOR")
  assert.match(r.resultado, /escribiendo `tecnia-bot`/)
})

test("en Linux, abierto con el lanzador y sin nada raro, el gate deja seguir", () => {
  assert.equal(porQueNoSePuedeCargar(ctx, herramientas({ plataforma: "linux", conLanzador: true })), null)
})

test("sin inyectar la plataforma se usa la de la máquina", () => {
  // Este test corre en Linux en el CI y en desarrollo: tiene que dar lo mismo que pedirlo explícito.
  const h = herramientas({ plataforma: "linux", conLanzador: false })
  delete h.plataforma
  const r = porQueNoSePuedeCargar(ctx, h)
  assert.equal(r?.codigo, process.platform === "linux" || process.platform === "win32" ? "SIN_LANZADOR" : "PLATAFORMA_NO_HABILITADA")
})
