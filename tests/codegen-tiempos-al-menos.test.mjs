// Los tiempos del programa generado se redondean HACIA ARRIBA: son un «al menos».
//
// POR QUÉ ESTE ARCHIVO. `milisegundos()` (opencode/codegen/programa.ts) convierte a
// milisegundos los dos tiempos que Component Knowledge declara para una lectura por
// protocolo: la espera tras el encendido y el período mínimo entre lecturas. Su
// comentario dice «redondeados hacia arriba: al menos», y está bien: son mínimos del
// sensor. Leerlo un milisegundo ANTES de lo que el fabricante pide es leer basura.
//
// Pero nada lo fijaba. La auditoría de código del 2026-11-22 lo midió por mutación
// (TST-05): cambiar `Math.ceil` por `Math.floor` dejaba en verde los siete archivos de
// test del codegen. Con los tiempos del catálogo de hoy (2 s y 1 s, enteros) redondear
// para arriba o para abajo da lo mismo. El día que se declare un tiempo con fracción de
// milisegundo, un cambio a `floor` o a `round` emitiría una espera MENOR que la mínima
// sin que nada se pusiera rojo.
//
// CÓMO MIDE. Arma un catálogo real donde el DHT22 declara tiempos con fracción de
// milisegundo y le pide la lectura a `resolverLectura`, que es quien llama a
// `milisegundos()`. Los valores están elegidos para que `ceil`, `floor` y `round` den
// tres resultados distintos.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - `Math.ceil(cantidad.valor * 1000)` → `Math.floor(…)`
//   - `Math.ceil(…)` → `Math.round(…)`
//   - `Math.ceil(…)` → `Math.trunc(…)`
//
// LÍMITE HONESTO: mide los milisegundos que resuelve el codegen, no el C++ emitido ni
// una placa esperando. Que esos números lleguen tal cual al programa lo cubren los
// tests de emisión; acá se cubre el redondeo.
//
// Corre con: node --test tests/codegen-tiempos-al-menos.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { resolverLectura } = await import(join(REPO, "opencode/codegen/programa.ts"))

const segundos = (valor) => ({ valor, unidad: "segundo", magnitud: "tiempo" })

/** El catálogo real, con el DHT22 declarando otros tiempos de lectura. */
function conocimientoConTiempos(esperaTrasEncendido, periodoMinimo) {
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) =>
    c.id === "dht22" ? { ...c, capacidades: c.capacidades.map((k) => ({ ...k, lectura: { ...k.lectura, esperaTrasEncendido: segundos(esperaTrasEncendido), periodoMinimo: segundos(periodoMinimo) } })) } : c,
  )
  return crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
}

function tiemposResueltos(espera, periodo) {
  const k = conocimientoConTiempos(espera, periodo)
  const sensor = k.catalogo.componentes.find((c) => c.id === "dht22")
  assert.ok(sensor, "el catálogo de prueba perdió el DHT22")
  const capacidad = sensor.capacidades.find((c) => c.id === "temperatura")
  const r = resolverLectura(k, sensor, capacidad)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.valor.kind, "protocolo")
  return [r.valor.esperaMs, r.valor.periodoMs]
}

test("con los tiempos de hoy (enteros) no hay nada que redondear (contrapeso)", () => {
  assert.deepEqual(tiemposResueltos(2, 2), [2000, 2000])
  assert.deepEqual(tiemposResueltos(1, 2), [1000, 2000])
})

test("un tiempo con fracción de milisegundo se redondea hacia ARRIBA, nunca por debajo del mínimo declarado", () => {
  // Cada par: [segundos declarados, ms esperados]. Al lado, lo que darían floor y round.
  const casos = [
    //  declarado   ceil   floor  round
    [1.2501, 1251], //   1250   1250
    [2.0001, 2001], //   2000   2000
    [0.00125, 2], //        1      1
    [0.0025, 3], //         2      3   ← round acierta de casualidad; los otros tres no
    [0.0004, 1], //         0      0   ← por debajo sería una espera de CERO
  ]
  for (const [declarado, esperado] of casos) {
    const [esperaMs, periodoMs] = tiemposResueltos(declarado, declarado)
    assert.equal(esperaMs, esperado, `espera tras encendido de ${declarado} s: se resolvió en ${esperaMs} ms`)
    assert.equal(periodoMs, esperado, `período mínimo de ${declarado} s: se resolvió en ${periodoMs} ms`)
    assert.ok(esperaMs >= declarado * 1000, `${esperaMs} ms es MENOS que los ${declarado * 1000} ms que pide el sensor`)
  }
})
