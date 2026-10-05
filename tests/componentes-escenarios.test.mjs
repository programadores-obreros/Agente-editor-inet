// Runner único de escenarios dorados declarativos — Component Knowledge F2a
// (`component-knowledge/18_F2A_SCOPE.md` §2 F2a-4, S8 de 08_TEST_STRATEGY).
//
// Cada archivo de `tests/fixtures/escenarios/*.mjs` declara, como DATOS, escenarios de un
// componente (ver la cabecera de `escenarios/pulsador.mjs` para la forma). Este runner los
// ejecuta con la API pública del Engine (`crearProyecto` + `ejecutarOperacion`): no
// reimplementa ninguna validación ni conoce ningún componente. Un componente nuevo agrega su
// archivo de escenarios; este runner no cambia.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIR_ESCENARIOS = join(REPO, "tests/fixtures/escenarios")

const { CATALOGO_ACTIVO: catalogo } = await import(join(REPO, "opencode/nucleo/catalogo-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

const archivos = readdirSync(DIR_ESCENARIOS).filter((f) => f.endsWith(".mjs")).sort()

test("escenarios: hay al menos un archivo y cada uno declara un componente del catálogo", async () => {
  assert.ok(archivos.length > 0)
  for (const f of archivos) {
    const { COMPONENTE, ESCENARIOS } = await import(pathToFileURL(join(DIR_ESCENARIOS, f)).href)
    assert.equal(typeof COMPONENTE, "string", f)
    assert.ok(catalogo.obtenerComponente(COMPONENTE), `${f}: "${COMPONENTE}" no está en el catálogo`)
    assert.ok(Array.isArray(ESCENARIOS) && ESCENARIOS.length > 0, `${f}: sin escenarios`)
  }
})

function ejecutar(escenario, prefijo) {
  let contador = 0
  const sobre = (tipo, payload, baseRevision) => ({ idOperacion: `${prefijo}-op-${contador++}`, actor: "agente", baseRevision, tipo, payload })
  let proyecto = crearProyecto({ generadorId: () => `${prefijo}-proy`, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const pasos = [{ tipo: "SetPlaca", payload: { placa: escenario.placa } }, ...escenario.pasos]
  let resultado
  for (const [i, paso] of pasos.entries()) {
    resultado = ejecutarOperacion(proyecto, sobre(paso.tipo, paso.payload, proyecto.revision), catalogo)
    const esUltimo = i === pasos.length - 1
    if (!esUltimo) {
      assert.equal(resultado.ok, true, `paso previo ${i} (${paso.tipo}) rechazado: ${JSON.stringify(resultado.motivos)}`)
      proyecto = resultado.proyecto
    }
  }
  return resultado
}

for (const f of archivos) {
  const { COMPONENTE, ESCENARIOS } = await import(pathToFileURL(join(DIR_ESCENARIOS, f)).href)
  for (const [n, escenario] of ESCENARIOS.entries()) {
    test(`escenario ${COMPONENTE}: ${escenario.nombre}`, () => {
      const r = ejecutar(escenario, `esc-${COMPONENTE}-${n}`)
      const detalle = JSON.stringify(r.motivos)
      const { ok, primerMotivo, contiene = [], noContiene = [] } = escenario.espera
      if (ok !== undefined) assert.equal(r.ok, ok, detalle)
      if (primerMotivo !== undefined) assert.equal(r.motivos[0]?.codigo, primerMotivo, detalle)
      for (const esperado of contiene) {
        assert.ok(
          r.motivos.some((m) => m.codigo === esperado.codigo && (esperado.severidad === undefined || m.severidad === esperado.severidad)),
          `falta ${JSON.stringify(esperado)}: ${detalle}`,
        )
      }
      for (const codigo of noContiene) assert.ok(!r.motivos.some((m) => m.codigo === codigo), `sobra ${codigo}: ${detalle}`)
    })
  }
}
