// Phase 3 — T5: guardia estática del navegador. `web/*.js` pinta lo que el servidor
// le da: nada de lógica de hardware ni tablas de clase/capacidad/estado.
//
// Cada patrón apunta a una violación REAL y evita falsos positivos:
// - `loop(`/`delay(`/`millis(`/`digitalRead`/`digitalWrite`/`pinMode`: código de placa;
// - `estadoBooleano`: la capacidad vive en el servidor (opcionesRegla.estados[i].condicion);
// - un literal de comparador entre comillas (">=", etc.): la condición no se arma acá
//   (el operador JS `>=` suelto, en una comparación numérica, es legítimo y NO matchea);
// - `.clase` / `clase ===` / `"clase"`: el navegador no mira clases de catálogo;
// - `clase|rol|tipo === "actuador"|"entrada"|...`: clasificar un COMPONENTE por su clase en
//   el navegador. Comparar el NOMBRE de un slot de la frase (`slot === "actuador"`) es
//   legítimo y no matchea (el slot es vocabulario de la frase, no clasificación de hardware).

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const dirWeb = join(REPO, "opencode/vista-fisica/web")
const archivos = readdirSync(dirWeb).filter((f) => f.endsWith(".js"))

const PATRONES = [
  [/\bloop\s*\(/, "loop("],
  [/\bdelay\s*\(/, "delay("],
  [/\bmillis\s*\(/, "millis("],
  [/digitalRead/, "digitalRead"],
  [/digitalWrite/, "digitalWrite"],
  [/pinMode/, "pinMode"],
  [/estadoBooleano/, "estadoBooleano (la capacidad es del servidor)"],
  [/["'`](>=|<=|>|<)["'`]/, "literal de comparador (la condición es del servidor)"],
  [/\.clase\b|\bclase\s*===|["']clase["']/, "mirar la clase de catálogo"],
  [/\b(clase|rol|tipo)\s*(===|!==)\s*["'](actuador|entrada|sensor|pasivo|salida)["']/, "clasificar un componente por su clase/rol"],
]

test("T5 guardia: web/*.js no contiene código de placa ni tablas de clase/capacidad/estado", () => {
  assert.ok(archivos.length > 0)
  for (const archivo of archivos) {
    const contenido = readFileSync(join(dirWeb, archivo), "utf8")
    for (const [patron, nombre] of PATRONES) {
      assert.ok(!patron.test(contenido), `${archivo} no puede contener ${nombre}`)
    }
  }
})

test("T5 guardia: web/*.js sigue sin button-press/button-release (la pieza nunca escucha eventos)", () => {
  for (const archivo of archivos) {
    const contenido = readFileSync(join(dirWeb, archivo), "utf8")
    assert.ok(!/button-press/i.test(contenido) && !/button-release/i.test(contenido), archivo)
  }
})

test("T5 guardia: el navegador sí manda SetComportamiento/QuitarComportamiento (y ningún otro tipo nuevo)", () => {
  const app = readFileSync(join(dirWeb, "app.js"), "utf8")
  assert.match(app, /SetComportamiento/)
  assert.match(app, /QuitarComportamiento/)
  // (sólo tipos de OPERACIÓN, que empiezan en mayúscula; `{tipo: "error"}` es un evento del EventSource)
  const tipos = [...app.matchAll(/tipo:\s*"([A-Z][A-Za-z]+)"/g)].map((m) => m[1])
  for (const t of tipos) assert.ok(["AsignarPin", "SetComportamiento", "QuitarComportamiento"].includes(t), `tipo no permitido en el navegador: ${t}`)
})
