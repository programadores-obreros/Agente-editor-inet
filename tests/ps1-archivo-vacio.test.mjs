// Un archivo de una línea VACÍO no puede matar a un script de PowerShell.
//
// POR QUÉ EXISTE. `(Get-Content $archivo -Raw).Trim()` parece inofensivo y no lo
// es: con el archivo vacío, `Get-Content -Raw` devuelve $null, y llamar a un
// método sobre $null tira una excepción. Con `$ErrorActionPreference = "Stop"`
// (lo que usan estos scripts) el script muere ahí.
//
// Visto el 2026-11-15 en la VM win10, instalando un .exe compilado a propósito
// con `install\OPENCODE_VERSION` vacío: en vez del mensaje que el bootstrap tiene
// escrito para ese caso ("El archivo falta o esta vacio. Volve a descargar el
// instalador."), el docente recibía
//   "No se puede llamar a un método en una expresión con valor NULL."
// con la línea y la columna del script. El mensaje bueno estaba a diez líneas y
// no se podía alcanzar nunca por el camino del archivo vacío.
//
// El arreglo es `([string](Get-Content $archivo -Raw)).Trim()`: `[string]$null`
// es "". Esta guarda mira el CÓDIGO sin comentarios: el comentario que explica el
// bug cita la forma mala y un test sobre el archivo crudo la encontraría ahí.
//
// MUTACIÓN que lo pone rojo (verificada): sacar el `[string]` de la lectura de
// OPENCODE_VERSION en install/bootstrap.ps1.
// No ejecuta PowerShell (acá no hay): que el mensaje bueno aparezca se ve en la VM.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

// Saca los comentarios de línea de PowerShell sin tocar un `#` que esté adentro
// de una cadena entre comillas.
function sinComentarios(texto) {
  return texto
    .split(/\r?\n/)
    .map((linea) => {
      let comilla = null
      for (let i = 0; i < linea.length; i++) {
        const c = linea[i]
        if (comilla) {
          if (c === comilla) comilla = null
        } else if (c === '"' || c === "'") comilla = c
        else if (c === "#") return linea.slice(0, i)
      }
      return linea
    })
    .join("\n")
}

const SCRIPTS = ["install", "installer"].flatMap((d) =>
  readdirSync(join(RAIZ, d))
    .filter((f) => f.endsWith(".ps1"))
    .map((f) => join(d, f)),
)

test("el guard encuentra los scripts que dice cuidar", () => {
  assert.ok(SCRIPTS.includes(join("install", "bootstrap.ps1")), `no encontré bootstrap.ps1 entre: ${SCRIPTS.join(", ")}`)
  assert.ok(SCRIPTS.length >= 6, `esperaba al menos seis .ps1 y hay ${SCRIPTS.length}`)
})

test("el quita-comentarios no se come el código ni deja pasar el comentario (el guard se prueba a sí mismo)", () => {
  const muestra = '$a = (Get-Content $f -Raw).Trim() # (Get-Content $g -Raw).Trim()\n# (Get-Content $h -Raw).Trim()\n$b = "#no"'
  const limpio = sinComentarios(muestra)
  assert.ok(limpio.includes("(Get-Content $f -Raw).Trim()"), "se comió el código")
  assert.ok(!limpio.includes("$g") && !limpio.includes("$h"), "dejó pasar un comentario")
  assert.ok(limpio.includes('"#no"'), "cortó un # que estaba adentro de una cadena")
})

test("ningún .ps1 llama a .Trim() directo sobre Get-Content -Raw: con el archivo vacío es $null y revienta", () => {
  const malos = []
  for (const s of SCRIPTS) {
    const lineas = sinComentarios(readFileSync(join(RAIZ, s), "utf8")).split("\n")
    lineas.forEach((l, i) => {
      // forma mala: `(Get-Content ... -Raw).Trim()` SIN un `[string]` pegado adelante
      if (/(?<!\[string\])\(Get-Content [^()\n]+ -Raw\)\.Trim\(\)/.test(l)) malos.push(`${s}:${i + 1}: ${l.trim()}`)
    })
  }
  assert.deepEqual(malos, [], `estas lecturas mueren con un archivo vacío:\n${malos.join("\n")}`)
})

test("las tres versiones fijadas del bootstrap se leen con el [string] puesto", () => {
  const codigo = sinComentarios(readFileSync(join(RAIZ, "install", "bootstrap.ps1"), "utf8"))
  for (const v of ["$ArchivoVersionOpenCode", "$ArchivoVersionPython", "$ArchivoVersionNode"]) {
    assert.ok(codigo.includes(`([string](Get-Content ${v} -Raw)).Trim()`), `la lectura de ${v} no lleva el [string]`)
  }
})
