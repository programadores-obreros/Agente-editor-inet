// Las hojas que viajan en el instalador son las que se escribieron.
//
// POR QUÉ EXISTE. `ficha.test.mjs` prueba que las 17 hojas existan y que el tool
// las encuentre. No prueba QUÉ VERSIÓN hay copiada, y las hojas son copias de
// otro repo: la fuente cambió cuatro fichas el 05/09 y el instalador siguió
// llevando las viejas; y al revés, la 09 se corrigió acá y la fuente no se
// enteró. Ningún test se puso rojo, porque una copia vieja no rompe nada.
//
// El manifiesto (`opencode/skills/fichas/MANIFEST.sha256`) fija qué bytes se
// reparten. Este archivo lo contrasta con la carpeta en cada corrida: si alguien
// toca una hoja a mano, o copia una nueva sin regenerar el manifiesto, acá se
// nombra el archivo. Y prueba que el chequeo DETECTA, mutando una copia en un
// directorio temporal: un verificador que no se probó fallando no se sabe si
// verifica.

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, appendFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

import { calcular, comparar, parsear, serializar, verificar, NOMBRE_MANIFIESTO } from "../scripts/fichas-manifest.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const FICHAS = join(REPO, "opencode", "skills", "fichas")
const HOJAS = join(FICHAS, "hojas")
const MANIFIESTO = join(FICHAS, NOMBRE_MANIFIESTO)

/** Cuántas hojas lleva el instalador. Si cambia, cambia acá y en el .iss a propósito. */
const HOJAS_QUE_VIAJAN = 17

const listado = () => parsear(readFileSync(MANIFIESTO, "utf8"))

test("existe el manifiesto y cada línea tiene forma de sha256sum", () => {
  assert.ok(existsSync(MANIFIESTO), `falta ${MANIFIESTO}; generalo con node scripts/fichas-manifest.mjs`)
  const texto = readFileSync(MANIFIESTO, "utf8")
  for (const linea of texto.split("\n").filter((l) => l.trim())) {
    assert.match(linea, /^[0-9a-f]{64}  hojas\/[^/\s]+\.html$/, `línea rara en el manifiesto: ${linea}`)
  }
  assert.ok(texto.endsWith("\n"), "el manifiesto tiene que terminar en salto de línea: sha256sum -c lo exige")
})

test("(a) cada hoja de hojas/ está en el manifiesto y su contenido coincide", () => {
  const real = calcular(FICHAS)
  const firmado = listado()
  for (const [ruta, hash] of Object.entries(real)) {
    assert.ok(ruta in firmado, `${ruta} está en la carpeta y NO en el manifiesto`)
    assert.equal(
      firmado[ruta],
      hash,
      `${ruta} no es la hoja que se firmó. Si el cambio es intencional, ` +
        `regenerá el manifiesto desde el repo de fichas (pnpm publicar).`,
    )
  }
})

test("(b) ninguna hoja listada falta en la carpeta", () => {
  const real = calcular(FICHAS)
  for (const ruta of Object.keys(listado())) {
    assert.ok(ruta in real, `${ruta} está en el manifiesto y NO en la carpeta`)
  }
})

test(`(c) son ${HOJAS_QUE_VIAJAN} hojas, en la carpeta y en el manifiesto`, () => {
  // El .iss promete «las 17 fichas A4». Si una se cae de la copia, el instalador
  // sale igual, más chico, y nadie lo nota hasta que un docente pide la que falta.
  assert.equal(readdirSync(HOJAS).length, HOJAS_QUE_VIAJAN, "hojas/ no tiene la cantidad esperada de archivos")
  assert.equal(Object.keys(listado()).length, HOJAS_QUE_VIAJAN, "el manifiesto no firma la cantidad esperada")
})

test("el manifiesto es exactamente lo que el script escribiría hoy", () => {
  // Orden, formato y contenido en una sola comparación: si esto pasa, regenerarlo
  // no cambia un byte. Es la misma pregunta que le hace `pnpm sincronia` al
  // SKILL.md: ¿qué DEBERÍA decir?
  assert.equal(readFileSync(MANIFIESTO, "utf8"), serializar(calcular(FICHAS)))
})

test("el comando --check pasa sobre el repo tal como está", () => {
  const salida = execFileSync(process.execPath, [join(REPO, "scripts", "fichas-manifest.mjs"), "--check"], {
    encoding: "utf8",
  })
  assert.match(salida, new RegExp(`${HOJAS_QUE_VIAJAN} hojas verificadas`))
})

test("el chequeo detecta un byte cambiado, una hoja borrada y una agregada, y nombra cada una", () => {
  // Se muta una COPIA. El repo no se toca.
  const tmp = join(os.tmpdir(), `tecniabot-manifiesto-${process.pid}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  cpSync(FICHAS, tmp, { recursive: true })
  try {
    assert.deepEqual(verificar(tmp), [], "la copia intacta tiene que pasar")

    appendFileSync(join(tmp, "hojas", "09-ldr.html"), " ")
    let problemas = verificar(tmp)
    assert.equal(problemas.length, 1)
    assert.match(problemas[0], /^hojas\/09-ldr\.html: .*no coincide/)

    rmSync(join(tmp, "hojas", "04-servo.html"))
    writeFileSync(join(tmp, "hojas", "99-inventada.html"), "<html></html>")
    problemas = verificar(tmp)
    assert.deepEqual(
      problemas.map((p) => p.split(":")[0]).sort(),
      ["hojas/04-servo.html", "hojas/09-ldr.html", "hojas/99-inventada.html"],
    )
    assert.ok(problemas.some((p) => p.startsWith("hojas/04-servo.html:") && /NO en la carpeta/.test(p)))
    assert.ok(problemas.some((p) => p.startsWith("hojas/99-inventada.html:") && /NO en el manifiesto/.test(p)))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("un manifiesto a medias no se interpreta: corta y dice qué línea", () => {
  assert.throws(() => parsear("abc  hojas/01.html\n"), /línea 1/)
  // Un solo espacio no es el formato de sha256sum (son dos); mejor rechazarlo
  // que aceptar algo que `sha256sum -c` no va a leer igual.
  assert.throws(() => parsear(`${"0".repeat(64)} hojas/01.html\n`), /línea 1/)
  assert.deepEqual(comparar({}, {}), [])
})
