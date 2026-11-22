// Las listas de carpetas de los instaladores dicen lo mismo que el árbol de `opencode/`.
//
// POR QUÉ ESTE ARCHIVO. Qué carpetas de `opencode/` se instalan está escrito A MANO
// en ocho lugares de cuatro scripts: en `install.sh` y en `install.ps1`, la lista de
// carpetas que se crean, la de las que se copian y la del manifest; en `uninstall.sh`
// y en `uninstall.ps1`, la de las que se limpian si quedaron vacías. Nada las ataba
// entre sí ni con el disco. Si una carpeta nueva falta en UNA sola:
//
//   - falta en la copia        → la tool queda instalada sin el módulo que importa,
//                                 y el instalador termina igual en LISTO;
//   - falta en el manifest     → se copia, pero ni el borrado de huérfanos ni el
//                                 desinstalador saben que existe: queda para siempre;
//   - sobra (ya no existe)     → `cp`/`find`/`Get-ChildItem` fallan sobre una carpeta
//                                 que no está.
//
// El riesgo concreto que lo originó (auditoría integral del 2026-11-21): hay dos
// líneas del producto que tocan estas mismas listas. Una suma `plataforma`; la otra
// suma `nucleo`, `servidor`, `vista-fisica`, `conocimiento`, `codegen` y `carga`.
// Unirlas es resolver ocho conflictos a mano, y perder un nombre en uno solo no
// rompe ningún otro test.
//
// CÓMO MIDE. La verdad no es otra lista escrita acá: es el disco. Se leen las
// carpetas que hay en `opencode/` y se exige que cada lista las nombre.
//
// LÍMITE HONESTO: es una guarda de FORMA sobre el texto de los scripts, sin
// comentarios. No ejecuta ningún instalador. Prueba que las listas coinciden con el
// árbol, no que la copia funcione en una máquina real.
//
// Corre con: node --test tests/instalador-listas-carpetas.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

// Sin comentarios: una lista comentada no instala nada.
const leerScript = (ruta) => readFileSync(join(REPO, ruta), "utf8").replace(/^\s*#.*$/gm, "")
const SH = leerScript("install/install.sh")
const PS = leerScript("install/install.ps1")
const UNSH = leerScript("install/uninstall.sh")
const UNPS = leerScript("install/uninstall.ps1")

// La verdad: las carpetas que hay en opencode/. `node_modules` y las ocultas no son
// producto (aparecen en un checkout de desarrollo, no en lo que se instala).
const CARPETAS = readdirSync(join(REPO, "opencode"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
  .map((e) => e.name)
  .sort()

// Carpetas que los desinstaladores NO limpian cuando quedan vacías. Así está hoy en
// los dos; este test no decide si está bien, sólo impide que la excepción crezca sola:
// una carpeta nueva tiene que entrar a la limpieza o sumarse acá a propósito.
const SIN_LIMPIEZA_DE_VACIAS = ["agent", "command", "tool"]

const ordenar = (lista) => [...lista].sort()

// Exige UNA sola aparición: si el script cambia de forma y la expresión deja de
// encontrar la lista, el test se pone rojo en vez de comparar contra nada.
function unicaCaptura(texto, expresion, que) {
  const hallados = [...texto.matchAll(expresion)]
  assert.equal(hallados.length, 1, `esperaba encontrar una sola vez ${que} y la encontré ${hallados.length} veces: el script cambió de forma y este test ya no lo está mirando`)
  return hallados[0][1]
}

const nombresEntreComillas = (texto) => [...texto.matchAll(/"([^"]+)"/g)].map((m) => m[1])

function exigirIguales(lista, que) {
  assert.deepEqual(ordenar(lista), CARPETAS,
    `${que} no coincide con las carpetas de opencode/.\n` +
    `  faltan: ${CARPETAS.filter((c) => !lista.includes(c)).join(", ") || "ninguna"}\n` +
    `  sobran: ${lista.filter((c) => !CARPETAS.includes(c)).join(", ") || "ninguna"}`)
  assert.equal(new Set(lista).size, lista.length, `${que} nombra una carpeta dos veces`)
}

function exigirQueCubra(lista, que) {
  const faltan = CARPETAS.filter((c) => !SIN_LIMPIEZA_DE_VACIAS.includes(c) && !lista.includes(c))
  assert.deepEqual(faltan, [], `${que} no limpia estas carpetas de opencode/: ${faltan.join(", ")}`)
}

test("la medición no está vacía: opencode/ tiene carpetas y las de siempre están", () => {
  for (const base of ["agent", "tool", "skills", "command", "tecniabot-web"]) {
    assert.ok(CARPETAS.includes(base), `no encontré opencode/${base}: o el test mira otro lado, o el producto perdió una carpeta básica`)
  }
  for (const exenta of SIN_LIMPIEZA_DE_VACIAS) {
    assert.ok(CARPETAS.includes(exenta), `la excepción «${exenta}» ya no es una carpeta de opencode/: sacala de SIN_LIMPIEZA_DE_VACIAS`)
  }
})

// Mutación que lo puso rojo: sacar `plataforma` de las llaves del `mkdir -p`.
test("install.sh crea todas las carpetas de opencode/", () => {
  const llaves = unicaCaptura(SH, /^mkdir -p "\$CONFIG_DIR"\/\{([^}\n]+)\}$/gm, "el `mkdir -p \"$CONFIG_DIR\"/{...}` de install.sh").split(",")
  const sueltas = [...SH.matchAll(/^mkdir -p "\$CONFIG_DIR\/([a-z-]+)"$/gm)].map((m) => m[1])
  exigirIguales([...llaves, ...sueltas], "lo que install.sh crea con mkdir")
})

// Mutación que lo puso rojo: borrar el renglón `cp -r "$SRC/plataforma/."`.
test("install.sh copia todas las carpetas de opencode/, cada una a la suya", () => {
  const copias = [...SH.matchAll(/^cp -r "\$SRC\/([a-z-]+)\/\."\s+"\$CONFIG_DIR\/([a-z-]+)\/"$/gm)]
  for (const [, origen, destino] of copias) {
    assert.equal(destino, origen, `install.sh copia opencode/${origen} adentro de ${destino}`)
  }
  exigirIguales(copias.map((m) => m[1]), "lo que install.sh copia con cp -r")
})

// Mutación que lo puso rojo: sacar `plataforma` del `find` de NUEVOS.
test("install.sh anota en el manifest todas las carpetas de opencode/", () => {
  const lista = unicaCaptura(SH, /^NUEVOS="\$\(cd "\$SRC" && find ([a-z\- ]+) -type f /gm, "el `find` que arma NUEVOS en install.sh").trim().split(/\s+/)
  exigirIguales(lista, "el manifest que escribe install.sh (NUEVOS)")
})

// Mutación que lo puso rojo: sacar "plataforma" del foreach que hace New-Item.
test("install.ps1 crea todas las carpetas de opencode/", () => {
  const delForeach = nombresEntreComillas(unicaCaptura(PS,
    /foreach \(\$sub in @\(([^)\n]*)\)\) \{\s*New-Item -ItemType Directory -Force -Path \(Join-Path \$ConfigDir \$sub\)/g,
    "el foreach que crea las carpetas en install.ps1"))
  const sueltas = [...PS.matchAll(/^\$WebDir = Join-Path \$ConfigDir "([a-z-]+)"\s*\nNew-Item -ItemType Directory -Force -Path \$WebDir/gm)].map((m) => m[1])
  exigirIguales([...delForeach, ...sueltas], "lo que install.ps1 crea con New-Item")
})

// Mutación que lo puso rojo: borrar el renglón `Copy-Item (Join-Path $Src "plataforma\*")`.
test("install.ps1 copia todas las carpetas de opencode/, cada una a la suya", () => {
  const web = unicaCaptura(PS, /^\$WebDir = Join-Path \$ConfigDir "([a-z-]+)"$/gm, "la definición de $WebDir en install.ps1")
  const copias = [...PS.matchAll(/^Copy-Item \(Join-Path \$Src "([a-z-]+)\\\*"\)\s+(?:\(Join-Path \$ConfigDir "([a-z-]+)\\"\)|(\$WebDir))\s+-Recurse -Force$/gm)]
  for (const [, origen, destino, aWebDir] of copias) {
    assert.equal(aWebDir ? web : destino, origen, `install.ps1 copia opencode\\${origen} adentro de ${aWebDir ? web : destino}`)
  }
  exigirIguales(copias.map((m) => m[1]), "lo que install.ps1 copia con Copy-Item")
})

// Mutación que lo puso rojo: sacar "plataforma" del foreach de $Nuevos.
test("install.ps1 anota en el manifest todas las carpetas de opencode/", () => {
  const lista = nombresEntreComillas(unicaCaptura(PS, /^\$Nuevos = foreach \(\$sub in @\(([^)\n]*)\)\) \{$/gm, "el foreach que arma $Nuevos en install.ps1"))
  exigirIguales(lista, "el manifest que escribe install.ps1 ($Nuevos)")
})

// Mutación que lo puso rojo: sacar "$CONFIG_DIR/plataforma" del find de uninstall.sh.
test("uninstall.sh limpia las carpetas vacías de todo lo que se instaló", () => {
  const renglon = unicaCaptura(UNSH, /^find ((?:"\$CONFIG_DIR\/[a-z-]+" )+)-type d -empty -delete/gm, "el `find ... -type d -empty -delete` de uninstall.sh")
  exigirQueCubra([...renglon.matchAll(/"\$CONFIG_DIR\/([a-z-]+)"/g)].map((m) => m[1]), "uninstall.sh")
})

// Mutación que lo puso rojo: sacar "plataforma" del foreach de uninstall.ps1.
test("uninstall.ps1 limpia las carpetas vacías de todo lo que se instaló", () => {
  const lista = nombresEntreComillas(unicaCaptura(UNPS,
    /foreach \(\$d in @\(([^)\n]*)\)\) \{\s*\$path = Join-Path \$ConfigDir \$d/g,
    "el foreach que limpia carpetas vacías en uninstall.ps1"))
  exigirQueCubra(lista, "uninstall.ps1")
})

// El .exe no tiene lista propia: se lleva opencode/ entero y después corre
// install.ps1, que es el que elige. Si alguien lo cambia por una lista, hay una
// novena que atar. Mutación que lo puso rojo: cambiar `..\opencode\*` por `..\opencode\tool\*`.
test("el instalador de Windows empaqueta opencode/ entero, sin lista propia", () => {
  const iss = readFileSync(join(REPO, "installer/tecnia-bot.iss"), "utf8").replace(/^\s*;.*$/gm, "")
  const fuentes = [...iss.matchAll(/^Source: "\.\.\\opencode\\([^"]*)"; DestDir: "\{app\}\\opencode"; Flags: ([^\n]*)$/gm)]
  assert.equal(fuentes.length, 1, "installer/tecnia-bot.iss ya no trae opencode/ con un solo renglón Source")
  assert.equal(fuentes[0][1], "*", "installer/tecnia-bot.iss dejó de empaquetar opencode/ entero")
  assert.match(fuentes[0][2], /\brecursesubdirs\b/, "installer/tecnia-bot.iss empaqueta opencode/ sin sus subcarpetas")
})
