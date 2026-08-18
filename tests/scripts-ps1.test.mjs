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
const DIR = join(REPO, "install")

const scripts = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".ps1")) : []

test("hay scripts .ps1 que verificar", () => {
  assert.ok(scripts.length > 0, "no encontré ningún .ps1 en install/")
})

test("ningún .ps1 tiene caracteres fuera de ASCII", () => {
  // La alternativa sería guardarlos con BOM, pero mantenerlos en ASCII es más
  // robusto: sobrevive a que alguien reescriba el archivo con otro editor.
  const problemas = []
  for (const f of scripts) {
    const texto = readFileSync(join(DIR, f), "utf8")
    texto.split("\n").forEach((linea, i) => {
      const raros = [...new Set(linea.match(/[^\x00-\x7F]/g) ?? [])]
      if (raros.length) problemas.push(`${f}:${i + 1} → ${raros.join(" ")}  en: ${linea.trim().slice(0, 55)}`)
    })
  }
  assert.deepEqual(
    problemas,
    [],
    "Windows PowerShell 5.1 lee estos archivos como cp1252 y no los va a poder " +
      "parsear. Escribí sin tildes (así está el resto del archivo):\n" + problemas.join("\n"),
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
