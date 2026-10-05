// Runner único de escenarios dorados declarativos — Component Knowledge F2a
// (`component-knowledge/18_F2A_SCOPE.md` §2 F2a-4, S8 de 08_TEST_STRATEGY).
//
// Cada archivo de `tests/fixtures/escenarios/*.mjs` declara, como DATOS, escenarios de un
// componente (ver la cabecera de `escenarios/pulsador.mjs` para la forma). Este runner los
// ejecuta con la API pública del Engine (`crearProyecto` + `ejecutarOperacion`): no
// reimplementa ninguna validación ni conoce ningún componente. Un componente nuevo agrega su
// archivo de escenarios; este runner no cambia.
//
// Component Knowledge D0 agregó tres conceptos GENÉRICOS (valen para cualquier componente,
// ninguno nombra uno):
// - `{ $estadoDeEntrada: { sensor, estado } }` como `cuando` de un `SetComportamiento`: el
//   runner pide la condición canónica a `ComponentKnowledge.estadosDeEntrada` del tipo de ese
//   sensor, por rótulo. Los datos de un escenario nunca reescriben la tríada `>=1`/`<1`.
// - `ESTADOS_DE_ENTRADA` (export opcional del archivo): rótulo → valor booleano esperado
//   (`verdadero`/`falso`), verificado contra la fachada y contra `valorBooleanoDeCondicion`.
// - `espera.recarga: true`: el proyecto final se serializa a JSON, se vuelve a cargar con
//   `cargarProyecto` y tiene que dar el mismo documento y los mismos motivos de validación.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIR_ESCENARIOS = join(REPO, "tests/fixtures/escenarios")

const { CATALOGO_ACTIVO: catalogo } = await import(join(REPO, "opencode/nucleo/catalogo-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto, cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { valorBooleanoDeCondicion } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
const { CONOCIMIENTO_ACTIVO: conocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))

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

/** Resuelve `{ $estadoDeEntrada: { sensor, estado } }` con la condición canónica que la fachada
 * ofrece para el TIPO de ese sensor en el proyecto actual. */
function resolverPayload(payload, proyecto) {
  const cuando = payload?.comportamiento?.cuando
  if (!cuando || !Object.hasOwn(cuando, "$estadoDeEntrada")) return payload
  const { sensor, estado } = cuando.$estadoDeEntrada
  const tipo = proyecto.componentes.find((c) => c.id === sensor)?.tipo
  const ofrecido = tipo === undefined ? undefined : conocimiento.estadosDeEntrada(tipo).find((e) => e.etiqueta === estado)
  assert.ok(ofrecido, `el tipo ${tipo} de ${sensor} no ofrece el estado "${estado}"`)
  return { ...payload, comportamiento: { ...payload.comportamiento, cuando: { sensor, ...ofrecido.condicion } } }
}

function ejecutar(escenario, prefijo) {
  let contador = 0
  const sobre = (tipo, payload, baseRevision) => ({ idOperacion: `${prefijo}-op-${contador++}`, actor: "agente", baseRevision, tipo, payload })
  let proyecto = crearProyecto({ generadorId: () => `${prefijo}-proy`, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const pasos = [{ tipo: "SetPlaca", payload: { placa: escenario.placa } }, ...escenario.pasos]
  let resultado
  for (const [i, paso] of pasos.entries()) {
    resultado = ejecutarOperacion(proyecto, sobre(paso.tipo, resolverPayload(paso.payload, proyecto), proyecto.revision), catalogo)
    const esUltimo = i === pasos.length - 1
    if (!esUltimo) {
      assert.equal(resultado.ok, true, `paso previo ${i} (${paso.tipo}) rechazado: ${JSON.stringify(resultado.motivos)}`)
      proyecto = resultado.proyecto
    }
  }
  return resultado
}

const motivosOrdenados = (p) => validarProyecto(p, catalogo).map((m) => JSON.stringify(m)).sort()

for (const f of archivos) {
  const { COMPONENTE, ESCENARIOS, ESTADOS_DE_ENTRADA } = await import(pathToFileURL(join(DIR_ESCENARIOS, f)).href)
  if (ESTADOS_DE_ENTRADA !== undefined) {
    test(`escenario ${COMPONENTE}: estados de entrada (rótulo → valor booleano canónico)`, () => {
      const ofrecidos = conocimiento.estadosDeEntrada(COMPONENTE)
      assert.deepEqual(ofrecidos.map((e) => e.etiqueta).sort(), Object.keys(ESTADOS_DE_ENTRADA).sort())
      for (const e of ofrecidos) {
        assert.equal(e.valor, ESTADOS_DE_ENTRADA[e.etiqueta], e.etiqueta)
        assert.equal(valorBooleanoDeCondicion(e.condicion), ESTADOS_DE_ENTRADA[e.etiqueta], `${e.etiqueta}: la condición es la forma canónica`)
      }
    })
  }
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
      if (escenario.espera.recarga) {
        assert.equal(r.ok, true, "sólo se recarga un estado aceptado")
        const carga = cargarProyecto(JSON.stringify(r.proyecto))
        assert.equal(carga.ok, true, JSON.stringify(carga.motivos))
        assert.deepEqual(carga.proyecto, r.proyecto, "el documento recargado es el mismo")
        assert.deepEqual(motivosOrdenados(carga.proyecto), motivosOrdenados(r.proyecto), "misma validación después de recargar")
      }
    })
  }
}
