// Oráculo de oro (golden) para `canonicalizar()` — Phase 1.1, hallazgo M23.
//
// POR QUÉ EXISTE. Antes de este archivo, TODOS los tests que ejercitan
// `canonicalizar()` (nucleo-ir-cargador, nucleo-almacen, nucleo-catalogo,
// nucleo-adversarial, nucleo-demo-contractual) comparan `canonicalizar(X)` contra
// `canonicalizar(Y)` usando la MISMA función de los dos lados de la igualdad. Eso
// prueba idempotencia/estabilidad relativa, pero un mutante que invierta el
// criterio de orden de `ordenarClavesProfundo` (ascendente → descendente) sigue
// produciendo dos lados iguales entre sí — sobrevive sin que ningún test existente
// lo note, porque ninguno fija la forma EXACTA esperada contra un valor
// independiente del código bajo prueba.
//
// Este archivo fija esa forma exacta como LITERAL (no generada llamando a
// `canonicalizar()` dentro del test) — un oráculo de oro clásico — más su sha256,
// también literal, como segunda verificación independiente de la primera (bytes vs.
// digest, dos formas de comparar que un solo mutante no puede satisfacer a la vez
// por casualidad).
//
// Contrato que fija (IR-SPEC.md §3, `canonico.ts`):
// - Las CLAVES de cada objeto se ordenan alfabéticamente, recursivamente.
// - El orden se decide por CODE UNIT (`a < b` de JS sobre strings, UTF-16), NUNCA
//   por `localeCompare` — confirmado empíricamente en
//   evidencia/T7/M23_locale_probe.txt: con code-unit, "ID" < "Z" < "a"; con
//   `localeCompare` (en cualquier locale probada), "a" < "ID" < "Z". La fixture de
//   abajo incluye esas tres claves adentro de `propiedades` precisamente para que
//   una regresión a `localeCompare` cambie el string canónico y el test falle.
// - Los ARRAYS (`componentes`/`conexiones`/`comportamientos`) se preservan TAL CUAL
//   se reciben — `canonicalizar()` no los reordena por su cuenta (eso lo hace
//   `cargarProyecto()`, que acá NO se usa: este test llama a `canonicalizar()`
//   directo sobre un objeto armado a mano, para no depender de ese reordenamiento
//   ajeno). La fixture pone `cmp-1` ANTES que `cmp-0` en `componentes` a propósito:
//   si algo reordenara los arrays por id, este golden literal dejaría de coincidir.
// - Los números se serializan con la representación nativa de `JSON.stringify`:
//   un entero (`2`, `3`) sale sin punto decimal; un decimal (`0.75`, `30.5`) sale
//   con su parte fraccionaria, sin ceros de más.
// - Ausencia de campos derivados: la fixture NO incluye `listo`/`ready` — ese campo
//   nunca se persiste (IR-SPEC.md §5), por lo que tampoco puede aparecer en la
//   forma canónica de un `Proyecto`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))

// Fixture con forma de `Proyecto` (ir.ts), armada a mano con las claves de CADA
// nivel de anidamiento en un orden deliberadamente NO alfabético — si
// `canonicalizar()` no reordenara nada, el string de salida coincidiría con el
// orden de inserción de abajo, que NO es el orden esperado.
const proyectoGolden = {
  siguienteIdLocal: 3,
  schemaVersion: "1",
  revision: 2,
  placa: "uno-r3",
  metadata: { creadoEn: "2024-01-01T00:00:00.000Z" },
  id: "proy-golden-m23",
  catalogoVersion: "v1",
  catalogoHash: "hash-abc",
  componentes: [
    {
      pines: { catodo: null, anodo: "d13" },
      tipo: "led",
      id: "cmp-1",
      // "Z"/"ID"/"a" a propósito: divergen entre orden por code unit y localeCompare.
      propiedades: { Z: "zeta", brillo: 0.75, ID: "mayus", a: "letra", cantidad: 2 },
    },
    {
      id: "cmp-0",
      propiedades: {},
      tipo: "dht22",
      pines: { data: "d2" },
    },
  ],
  conexiones: [
    {
      hasta: { terminal: "anodo", componente: "cmp-1" },
      desde: { componente: "cmp-0", terminal: "data" },
      id: "conn-0",
    },
  ],
  comportamientos: [
    {
      entonces: { accion: "encender", actuador: "cmp-1" },
      id: "beh-0",
      cuando: {
        umbral: { magnitud: "temperatura", unidad: "C", valor: 30.5 },
        capacidad: "leerTemperatura",
        comparador: ">",
        sensor: "cmp-0",
      },
    },
  ],
}

// Literal fijo por especificación (IR-SPEC.md §3), NO generado con canonicalizar()
// acá. Claves ascendentes por code unit en cada nivel; arrays en el mismo orden de
// la fixture de arriba (cmp-1 antes que cmp-0); enteros sin punto, decimales con su
// fracción exacta; sin "listo"/"ready".
const CANONICO_ESPERADO =
  '{"catalogoHash":"hash-abc","catalogoVersion":"v1","componentes":[{"id":"cmp-1","pines":{"anodo":"d13","catodo":null},"propiedades":{"ID":"mayus","Z":"zeta","a":"letra","brillo":0.75,"cantidad":2},"tipo":"led"},{"id":"cmp-0","pines":{"data":"d2"},"propiedades":{},"tipo":"dht22"}],"comportamientos":[{"cuando":{"capacidad":"leerTemperatura","comparador":">","sensor":"cmp-0","umbral":{"magnitud":"temperatura","unidad":"C","valor":30.5}},"entonces":{"accion":"encender","actuador":"cmp-1"},"id":"beh-0"}],"conexiones":[{"desde":{"componente":"cmp-0","terminal":"data"},"hasta":{"componente":"cmp-1","terminal":"anodo"},"id":"conn-0"}],"id":"proy-golden-m23","metadata":{"creadoEn":"2024-01-01T00:00:00.000Z"},"placa":"uno-r3","revision":2,"schemaVersion":"1","siguienteIdLocal":3}'

// sha256 literal del string de arriba — segunda comprobación independiente
// (digest vs. bytes) sobre el mismo golden.
const SHA256_ESPERADO = "b98d97bcb0339828b576f9cce52f25c41dc363b2c2dc0238461783337d8fcfa7"

test("golden: canonicalizar(proyectoGolden) coincide byte a byte con el literal fijado por especificación", () => {
  const real = canonicalizar(proyectoGolden)
  assert.equal(real, CANONICO_ESPERADO)
})

test("golden: sha256(canonicalizar(proyectoGolden)) coincide con el digest fijado por especificación", () => {
  const real = canonicalizar(proyectoGolden)
  const digest = createHash("sha256").update(real).digest("hex")
  assert.equal(digest, SHA256_ESPERADO)
})

test("golden: el orden de claves es ascendente por CODE UNIT, no por localeCompare (ID < Z < a)", () => {
  // Prueba puntual, independiente del golden completo: si `ordenarClavesProfundo`
  // migrara a `localeCompare`, este subconjunto (dentro de `propiedades` del
  // primer componente) cambiaría de orden — code unit pone mayúsculas antes que
  // minúsculas ("ID" y "Z" antes que "a"); localeCompare (es-AR/en-US) pone "a"
  // primero.
  const real = canonicalizar(proyectoGolden)
  const propiedades = JSON.parse(real).componentes[0].propiedades
  assert.deepEqual(Object.keys(propiedades), ["ID", "Z", "a", "brillo", "cantidad"])
})
