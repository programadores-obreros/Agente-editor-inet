// Los .ps1 tienen que ser ASCII puro, o no arrancan en Windows.
//
// POR QUÉ ESTE ARCHIVO — y es la peor de todas las que pasaron hoy.
//
// Se agregó verificación de errores al bootstrap (algo bueno), y con ella
// entraron tres tildes y una raya larga en los mensajes nuevos. El archivo es un
// .ps1 SIN BOM, y Windows PowerShell 5.1 lo lee como cp1252: cada carácter
// multibyte de UTF-8 le desalinea el parser.
//
// Resultado: el script dejó de COMPILAR. Ni siquiera empezaba a correr:
//
//   Falta la cadena en el terminador: "
//   Process exit code: 1
//
// El instalador se veía normal, decía "instalación completa", y no instalaba
// NADA. Salió publicado en la v0.3.48 y lo encontró el usuario probando en una
// notebook real, después de un rato peleándola.
//
// Los tests de este repo no podían verlo: ninguno miraba los .ps1. Se probaba
// TypeScript, prompts y skills — todo lo que corre en Linux — y el instalador,
// que es lo primero que toca un docente, no tenía ni una línea de verificación.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
// Los .cmd tienen el MISMO problema por otra vía: cmd.exe lee los batch en la
// codepage OEM de la consola (850/437 en Windows en español), no en UTF-8. El
// lanzador ya estaba escrito sin tildes por esto mismo; ahora está verificado.
const DIRS = [join(REPO, "install"), join(REPO, "installer")]

const scripts = DIRS.flatMap((d) =>
  existsSync(d)
    ? readdirSync(d)
        .filter((f) => f.endsWith(".ps1") || f.endsWith(".cmd") || f.endsWith(".bat"))
        .map((f) => [d, f])
    : [],
)

test("hay scripts de Windows que verificar", () => {
  assert.ok(scripts.length > 0, "no encontré ningún .ps1 ni .cmd")
})

test("ningún .ps1 tiene caracteres fuera de ASCII", () => {
  // La alternativa sería guardarlos con BOM, pero mantenerlos en ASCII es más
  // robusto: sobrevive a que alguien reescriba el archivo con otro editor.
  const problemas = []
  for (const [dir, f] of scripts) {
    const texto = readFileSync(join(dir, f), "utf8")
    texto.split("\n").forEach((linea, i) => {
      const raros = [...new Set(linea.match(/[^\x00-\x7F]/g) ?? [])]
      if (raros.length) problemas.push(`${f}:${i + 1} → ${raros.join(" ")}  en: ${linea.trim().slice(0, 55)}`)
    })
  }
  assert.deepEqual(
    problemas,
    [],
    "Windows lee estos archivos en una codepage de un byte (cp1252 en PowerShell " +
      "5.1, OEM en cmd.exe). Escribí sin tildes:\n" + problemas.join("\n"),
  )
})

/*
 * NO hay test de sintaxis acá, y es a propósito.
 *
 * Un contador de llaves parece razonable y no lo es: PowerShell usa ${...},
 * @{...} y here-strings, así que un conteo ingenuo da falso positivo — lo probé
 * y marcó install.ps1 como roto estando sano.
 *
 * El parseo de verdad necesita PowerShell, que no está en esta máquina ni en el
 * runner de Linux del CI. Se verifica a mano en Windows con:
 *
 *   [System.Management.Automation.PSParser]::Tokenize((Get-Content x.ps1 -Raw), [ref]$null)
 *
 * El test de ASCII de arriba cubre la causa real del incidente. Un test que da
 * falso positivo es peor que no tenerlo: enseña a ignorar el rojo.
 */

test("ningún script lleva caracteres de control invisibles", () => {
  // Una ruta de PowerShell escrita desde un script mal escapado puede terminar
  // con un 0x07 (campana) en vez de "\\a": `scoop\\apps` se convierte en
  // `scoop<BEL>pps` y la ruta apunta a un lugar que no existe.
  //
  // No se ve. El archivo parece correcto en cualquier editor, el script parsea,
  // y falla en silencio en tiempo de ejecución. Pasó exactamente así, al escribir
  // el fallback de CPU sin AVX2 desde un heredoc de Python.
  const problemas = []
  for (const [dir, f] of scripts) {
    const texto = readFileSync(join(dir, f), "latin1")
    texto.split("\n").forEach((linea, i) => {
      const raros = linea.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g)
      if (raros) {
        problemas.push(
          `${f}:${i + 1} → ${raros.map((c) => "0x" + c.charCodeAt(0).toString(16)).join(" ")} en: ${linea.trim().slice(0, 55)}`,
        )
      }
    })
  }
  assert.deepEqual(problemas, [], "caracteres de control invisibles:\n" + problemas.join("\n"))
})
