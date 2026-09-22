// El guard de seguridad física de los proyectos: que un proyecto con servo, motor,
// calor o 220V no pueda quedar sin advertencia.
//
// POR QUÉ ESTE TEST NO SE ESCRIBE DE MEMORIA. Este repo ya se comió el bug de
// tests que pasan sin probar nada (CHANGELOG.md:216, v0.3.69): un test que sólo
// corre el guard sobre proyectos que YA están bien nunca prueba que el guard
// GUARDA — si el clasificador estuviera roto (por ejemplo, si nunca marcara nada
// como riesgoso), este mismo test pasaría en verde. Por eso la mitad de abajo
// arma proyectos sintéticos CON el problema y confirma que el guard los agarra,
// no sólo que los deja pasar cuando están bien.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

import {
  detectarRiesgos,
  errorGithub,
  exencionJustificada,
  PROYECTOS,
  tieneBloqueCanonico,
  verificar,
} from "../scripts/seguridad-proyectos.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

// Nombre propio: `circuito.test.mjs` ya usa "tecniabot-test-work" en os.tmpdir().
const TMP_BASE = join(os.tmpdir(), `tecniabot-seguridad-proyectos-${process.pid}`)

/** Un directorio temporal con un solo proyecto sintético adentro, listo para `verificar()`. */
function proyectoSintetico(nombreArchivo, contenido) {
  rmSync(TMP_BASE, { recursive: true, force: true })
  mkdirSync(TMP_BASE, { recursive: true })
  writeFileSync(join(TMP_BASE, nombreArchivo), contenido)
  return TMP_BASE
}

test.after(() => rmSync(TMP_BASE, { recursive: true, force: true }))

test("CON servo y SIN bloque de seguridad ni exención: el guard lo marca", () => {
  const dir = proyectoSintetico(
    "99-servo-sin-nada.md",
    "# Proyecto 99\n\nUn servo mueve la compuerta cuando llega un pedido.\n",
  )
  const { riesgosos, cubiertos, fallas } = verificar(dir)
  assert.deepEqual(riesgosos, ["99-servo-sin-nada.md"])
  assert.deepEqual(cubiertos, [])
  assert.equal(fallas.length, 1)
  assert.equal(fallas[0].archivo, "99-servo-sin-nada.md")
  assert.match(fallas[0].motivo, /partes móviles/)
  assert.match(fallas[0].motivo, /servo/)
})

test("el mismo proyecto CON el bloque canónico: no lo marca", () => {
  const dir = proyectoSintetico(
    "99-servo-con-bloque.md",
    [
      "# Proyecto 99",
      "",
      "> ⚠️ **SEGURIDAD:** el servo mueve la compuerta con fuerza suficiente para atrapar un dedo.",
      "",
      "Un servo mueve la compuerta cuando llega un pedido.",
      "",
    ].join("\n"),
  )
  const { riesgosos, cubiertos, fallas } = verificar(dir)
  assert.deepEqual(riesgosos, ["99-servo-con-bloque.md"])
  assert.deepEqual(cubiertos, ["99-servo-con-bloque.md"])
  assert.deepEqual(fallas, [])
})

test("el mismo proyecto CON exención justificada: no lo marca", () => {
  const dir = proyectoSintetico(
    "99-servo-con-exencion.md",
    [
      "# Proyecto 99",
      "",
      "<!-- sin-riesgo-fisico: la palabra servo aparece solo en un comentario de código, no hay actuador real -->",
      "",
      "Un servo mueve la compuerta cuando llega un pedido.",
      "",
    ].join("\n"),
  )
  const { riesgosos, cubiertos, fallas } = verificar(dir)
  assert.deepEqual(riesgosos, ["99-servo-con-exencion.md"])
  assert.deepEqual(cubiertos, ["99-servo-con-exencion.md"])
  assert.deepEqual(fallas, [])
})

test("una exención VACÍA no alcanza: poner la marca sin motivo no cuenta como justificación", () => {
  const dir = proyectoSintetico(
    "99-servo-exencion-vacia.md",
    [
      "# Proyecto 99",
      "",
      "<!-- sin-riesgo-fisico: -->",
      "",
      "Un servo mueve la compuerta cuando llega un pedido.",
      "",
    ].join("\n"),
  )
  assert.equal(exencionJustificada(
    "<!-- sin-riesgo-fisico: -->\n\nUn servo mueve la compuerta.",
  ), false)
  const { riesgosos, cubiertos, fallas } = verificar(dir)
  assert.deepEqual(riesgosos, ["99-servo-exencion-vacia.md"])
  assert.deepEqual(cubiertos, [])
  assert.equal(fallas.length, 1)
})

test("un proyecto sin ninguna señal de riesgo: no lo marca (ni riesgoso ni cubierto)", () => {
  const dir = proyectoSintetico(
    "99-sin-riesgo.md",
    "# Proyecto 99\n\nUn sensor de luz enciende un LED cuando oscurece.\n",
  )
  const { riesgosos, cubiertos, fallas } = verificar(dir)
  assert.deepEqual(riesgosos, [])
  assert.deepEqual(cubiertos, [])
  assert.deepEqual(fallas, [])
})

test("detectarRiesgos nombra la familia y la palabra que disparó, ignora tildes y mayúsculas", () => {
  assert.deepEqual(detectarRiesgos("acá hay un MOTOR que gira"), [
    { familia: "partes móviles", palabra: "motor" },
  ])
  assert.deepEqual(detectarRiesgos("cuidado, la superficie está CALIENTE"), [
    { familia: "calor", palabra: "caliente" },
  ])
  assert.deepEqual(detectarRiesgos("esto va a la Red Eléctrica de 220V"), [
    { familia: "red eléctrica", palabra: "red electrica" },
  ])
  // "220 V" sin tilde en "red eléctrica" alrededor: el patrón numérico dispara solo.
  assert.deepEqual(detectarRiesgos("la lámpara real es de 220 V"), [
    { familia: "red eléctrica", palabra: "220V" },
  ])
  // Ni "resistencia" sola ni "220 Ω" son la familia calor/red eléctrica.
  assert.deepEqual(detectarRiesgos("una resistencia de 220 Ω limita la corriente"), [])
})

test("tieneBloqueCanonico exige la forma exacta, no cualquier mención de 'seguridad'", () => {
  assert.equal(tieneBloqueCanonico("> ⚠️ **SEGURIDAD:** cuidado con el servo"), true)
  assert.equal(tieneBloqueCanonico("la seguridad es importante, dice el texto"), false)
  assert.equal(tieneBloqueCanonico("⚠️ **SEGURIDAD:** sin el '>' inicial no es el bloque"), false)
})

test("errorGithub arma el formato ::error que entiende Actions", () => {
  assert.equal(
    errorGithub("opencode/skills/proyectos-inet/proyectos/99.md", "motivo de prueba"),
    "::error file=opencode/skills/proyectos-inet/proyectos/99.md::motivo de prueba",
  )
})

test("el corpus REAL de los 15 proyectos: 0 fallas, y ni 01 ni 05 quedan marcados riesgosos", () => {
  const { riesgosos, cubiertos, fallas } = verificar(PROYECTOS)
  assert.deepEqual(fallas, [], `estos proyectos quedarían sin cobertura: ${fallas.map((f) => f.archivo).join(", ")}`)
  assert.ok(!riesgosos.includes("01-semaforizacion.md"), "01 sólo tiene LEDs, no es riesgoso")
  assert.ok(!riesgosos.includes("05-estacion-meteorologica.md"), "05 sólo tiene sensores, no es riesgoso")
  assert.ok(riesgosos.includes("04-invernadero.md"), "04 tiene que quedar riesgoso: para eso existe la exención")
  assert.equal(riesgosos.length, cubiertos.length, "todo riesgoso real tiene que estar cubierto")
  assert.equal(riesgosos.length, 13, "12 con bloque canónico + 04 con exención")
})

test("el comando ejecutable pasa en verde sobre el repo tal como está (exit 0)", () => {
  const salida = execFileSync(process.execPath, [join(REPO, "scripts", "seguridad-proyectos.mjs")], {
    encoding: "utf8",
  })
  assert.match(salida, /OK: \d+ proyecto\(s\) riesgoso\(s\), todos cubiertos\./)
})
