// El instalador de Windows no puede cerrar con «Listo!» y exit 0 después de avisar
// que NO pudo escribir la configuración.
//
// POR QUÉ ESTE ARCHIVO. Con un `opencode.json` que no parsea, `install/install.ps1`
// imprimía `[AVISO] No pude parsear ...: lo dejo intacto` y, un renglón después,
// `==> Listo! Tecnia Bot v... instalado.`, y salía por 0. Con ese archivo sin
// tocar, el agente por defecto y el modelo NO quedaron escritos: el bot abre como
// un OpenCode pelado, o con el modelo de la corrida anterior. `bootstrap.ps1`
// leía el 0 y cerraba con su «LISTO!» verde. Un OK falso de punta a punta.
//
// Ahora el cierre dice «instalado CON AVISOS», lista qué falta, y el script sale
// con un código propio (3), documentado en su encabezado. El 3 NO es gratis: quien
// lo consume tiene que saber leerlo — `bootstrap.ps1` (que hoy trata cualquier
// código distinto de 0 como «la capa no se instaló»), `update.ps1` y
// `actualizar.ts`. Ese contrato está en el informe de la tarea; acá se custodia
// la mitad que le toca a install.ps1.
//
// LÍMITE HONESTO: guardas de FORMA sobre el código SIN comentarios, verificadas
// por mutación (anotadas arriba de cada test). Acá no hay PowerShell.
//
// Corre con: node --test tests/instalador-avisos.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const PS = sinComentarios(readFileSync(join(REPO, "install/install.ps1"), "utf8"))

// Mutación que lo puso rojo: borrar la línea
// `[void]$AvisosInstalacion.Add("el agente por defecto y el modelo ...")` → exit code 1.
test("cada «lo dejo intacto» queda anotado como aviso (no alcanza con imprimirlo)", () => {
  const intactos = [...PS.matchAll(/^.*lo dejo intacto.*$/gm)]
  assert.equal(intactos.length, 2, `esperaba DOS «lo dejo intacto» (tui y opencode) y hay ${intactos.length}`)
  for (const m of intactos) {
    // La anotación está en la línea inmediatamente anterior, adentro del mismo `if`.
    const antes = PS.slice(PS.lastIndexOf("\n", m.index - 2) + 1, m.index)
    assert.match(antes, /^\s*\[void\]\$AvisosInstalacion\.Add\(/, `este aviso se imprime y no se anota (saldría por 0): ${m[0].trim()}`)
  }
  // Y los de la key, que se juntan antes del cierre: cada bandera, su aviso.
  for (const bandera of ["$AuthIlegible", "$PurgaFallida", "$KeyNoGuardada", "$VariableDesfasada"]) {
    const b = bandera.replace("$", "\\$")
    assert.match(PS, new RegExp(`^if \\(${b}\\) \\{ \\[void\\]\\$AvisosInstalacion\\.Add\\(`, "m"), `la bandera ${bandera} no se convierte en aviso`)
  }
  // Las banderas de la key se prenden donde corresponde (no son decorado).
  assert.match(PS, /if \(-not \$guardadaVerificada\) \{\s*\n\s*\$KeyNoGuardada = \$true/, "una key que no quedó guardada no prende $KeyNoGuardada")
})

// Mutación que lo puso rojo: dejar el `Write-Host "==> Listo! ..."` suelto, fuera
// de `if ($AvisosInstalacion.Count -eq 0) { }` → exit code 1.
test("«Listo! instalado» sale sólo sin avisos; con avisos el cierre dice CON AVISOS y los lista", () => {
  const listos = [...PS.matchAll(/^.*==> Listo! Tecnia Bot.*$/gm)]
  assert.equal(listos.length, 1, `esperaba UN «Listo!» y hay ${listos.length}`)
  assert.match(PS, /if \(\$AvisosInstalacion\.Count -eq 0\) \{\s*\n\s*Write-Host "==> Listo! Tecnia Bot v\$Version instalado\."\s*\n\}/,
    "el «Listo!» no cuelga de que no haya avisos")
  const i = PS.indexOf("function Mostrar-AvisosInstalacion")
  assert.ok(i > 0, "no existe Mostrar-AvisosInstalacion")
  const fn = PS.slice(i, PS.indexOf("\n}\n", i))
  assert.match(fn, /instalado CON AVISOS/, "el cierre con avisos no dice CON AVISOS")
  assert.match(fn, /foreach \(\$av in \$AvisosInstalacion\) \{ Write-Host/, "el cierre con avisos no lista qué falta")
  // Se muestra dos veces (en el cierre y al final, después de la descarga larga),
  // y las dos cuelgan de que HAYA avisos.
  const usos = [...PS.matchAll(/if \(\$AvisosInstalacion\.Count -gt 0\) \{\s*\n(?:\s*\n)*\s*Mostrar-AvisosInstalacion\s*\n\s*\}/g)]
  assert.equal(usos.length, 2, `Mostrar-AvisosInstalacion se llama bajo guarda ${usos.length} veces; se esperaban 2`)
  assert.equal((PS.match(/^\s*Mostrar-AvisosInstalacion\s*$/gm) ?? []).length, 2, "hay una llamada a Mostrar-AvisosInstalacion sin guarda")
  // La invitación a «empezar» no sale si quedó algo sin configurar.
  assert.match(PS, /if \(\$AvisosInstalacion\.Count -eq 0\) \{\s*\n\s*Write-Host "Para empezar:/, "invita a empezar aunque haya quedado algo sin configurar")
})

// Mutaciones que lo pusieron rojo: `{ exit 0 }` en la línea del 3 → exit code 1;
// invertir el orden de las dos últimas líneas → exit code 1.
test("el código de salida: 3 con avisos, 1 si se cortó (y el corte gana), 0 si no", () => {
  assert.match(PS, /if \(-not \$FalloInstalacion -and \$AvisosInstalacion\.Count -gt 0\) \{ exit 3 \}\s*\nif \(\$FalloInstalacion\) \{ exit 1 \}\s*$/,
    "install.ps1 no termina con el 3 de «con avisos» seguido del 1 de «se cortó»")
  const salidas = [...PS.matchAll(/\bexit (\d+)/g)].map((m) => m[1])
  assert.deepEqual(salidas, ["3", "1"], `cambiaron los códigos de salida de install.ps1: ${salidas.join(", ")}`)
  // La lista se crea ANTES del try: tiene que existir cuando el script llega al
  // final aunque el cuerpo se haya cortado en la primera línea.
  const iLista = PS.indexOf("$AvisosInstalacion = New-Object System.Collections.ArrayList")
  assert.ok(iLista > 0 && iLista < PS.indexOf("\ntry {"), "$AvisosInstalacion no se crea antes del try")
  // Y el contrato está escrito donde lo va a buscar quien consuma el código (acá sí
  // se mira el archivo CON comentarios: el encabezado es un comentario).
  const cabecera = readFileSync(join(REPO, "install/install.ps1"), "utf8").slice(0, 2500)
  assert.match(cabecera, /CODIGOS DE SALIDA/, "el encabezado no documenta los códigos de salida")
  assert.match(cabecera, /#\s+3\s+instalado CON AVISOS/, "el encabezado no documenta el 3")
})
