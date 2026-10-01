// Phase 2, Slice 2 — W-S2-TOOL, §3.1/§4 del diseño (PHASE_2_SLICE_2_DESIGN.md):
// T-AG-01..12 — la tool `proyecto-fisico` NO es una segunda autoridad ni una vía de
// escape. Cada test reproduce una amenaza concreta de la tabla §4 con el Engine REAL
// (`servicio-con-vista.ts`, el mismo camino de producción), nunca un doble mock del
// motor.
//
// La tool se invoca EXACTAMENTE como lo hace OpenCode: `(await import(...)).default`
// y después `.execute(args, { directory })` — mismo mecanismo que ya usan
// `tests/phase2-e2e.test.mjs`/`tests/phase2-candado-proceso.test.mjs` para
// `tool/vista-fisica.ts` (esos tests ya prueban que `@opencode-ai/plugin` resuelve
// bajo `node --test`, así que esta tool tampoco necesita nada especial).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, readdirSync, symlinkSync, cpSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { directorioDeDatos, ID_PROYECTO_DEFAULT, obtenerServidorVistaFisica } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════════════

function ctx(directorioActivo) {
  return { directory: directorioActivo }
}

async function llamarTool(args, directorioActivo) {
  return proyectoFisico.execute(args, ctx(directorioActivo))
}

function parsearJson(texto) {
  return JSON.parse(texto)
}

/** Reemplaza un método de un `ServicioDeProyecto` REAL por un espía que cuenta
 * llamadas y delega en el original — nunca un mock del motor: el Engine sigue
 * siendo el mismo, sólo se cuenta si se lo invocó o no (T-AG-02/T-AG-11: "el Engine
 * no se invoca"). El wrapper de `servicio-con-vista.ts` es un objeto plano (no
 * congelado), así que reasignar una de sus propiedades es válido. */
function espiarMetodo(servicio, nombreMetodo) {
  const original = servicio[nombreMetodo]
  let llamadas = 0
  servicio[nombreMetodo] = (...args) => {
    llamadas += 1
    return original.apply(servicio, args)
  }
  return {
    contador: () => llamadas,
    restaurar: () => {
      servicio[nombreMetodo] = original
    },
  }
}

/** Cliente SSE mínimo sobre `fetch()` — mismo contrato que
 * `tests/phase2-e2e.test.mjs::conectarSSE`, reimplementado acá porque los archivos de
 * test no se importan entre sí (mismo criterio que el resto del repo). */
async function conectarSSE(urlEventos) {
  const respuesta = await fetch(urlEventos)
  assert.equal(respuesta.status, 200)
  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  let buffer = ""
  const eventos = []
  const esperando = []

  function procesarBloque(bloque) {
    let tipo = "message"
    let datos = null
    for (const linea of bloque.split("\n")) {
      if (linea.startsWith("event:")) tipo = linea.slice("event:".length).trim()
      else if (linea.startsWith("data:")) datos = linea.slice("data:".length).trim()
    }
    if (datos === null) return
    const evento = { tipo, datos: JSON.parse(datos) }
    if (esperando.length > 0) esperando.shift()(evento)
    else eventos.push(evento)
  }

  const bombeo = (async () => {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) return
      buffer += decodificador.decode(value, { stream: true })
      let indice
      while ((indice = buffer.indexOf("\n\n")) !== -1) {
        procesarBloque(buffer.slice(0, indice))
        buffer = buffer.slice(indice + 2)
      }
    }
  })()
  bombeo.catch(() => {})

  return {
    siguienteEvento() {
      if (eventos.length > 0) return Promise.resolve(eventos.shift())
      return new Promise((resolve) => esperando.push(resolve))
    },
    async cerrar() {
      await lector.cancel().catch(() => {})
    },
  }
}

function rutaDisco(dirDatos, idProyecto) {
  return join(dirDatos, `${idProyecto}.json`)
}

function leerDiscoCrudo(dirDatos, idProyecto) {
  const ruta = rutaDisco(dirDatos, idProyecto)
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-01 — Escribir la IR directo
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-01 (estático): proyecto-fisico.ts no escribe la IR directo ni referencia almacen/crearAlmacen/obtenerServicioDeProyecto crudo", () => {
  const crudo = readFileSync(join(REPO, "opencode/tool/proyecto-fisico.ts"), "utf8")
  // Mismo criterio que tests/update-scripts.test.mjs/robustez.test.mjs: se escanea el
  // CÓDIGO, nunca los comentarios (este mismo archivo documenta, en prosa, qué tiene
  // prohibido importar — esa mención en un comentario no es una referencia real).
  const codigo = crudo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  assert.ok(!/\bwriteFile(Sync)?\(/.test(codigo), "no debe escribir archivos directo")
  assert.ok(!/\brename(Sync)?\(/.test(codigo), "no debe renombrar archivos directo")
  assert.ok(!/\bopenSync\(/.test(codigo), "no debe abrir descriptores de archivo directo")
  assert.ok(!/["']\.\.\/nucleo\/almacen\.ts["']/.test(codigo), "no debe importar nucleo/almacen.ts")
  assert.ok(!/\bcrearAlmacen\b/.test(codigo), "no debe referenciar crearAlmacen")
  assert.ok(!/obtenerServicioDeProyecto(?!ConVista)/.test(codigo), "no debe referenciar obtenerServicioDeProyecto crudo (sólo ConVista)")
})

test("T-AG-01 (dinámico): tras 'aplicar', el disco coincide con la forma canónica del Engine y la revisión sube exactamente en 1", async () => {
  const dirActivo = nuevoDir("tool-t01")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)

  const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r.ok, true, `rechazado: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.baseRevision, 0)
  assert.equal(r.revisionActual, 1, "la revisión sube EXACTAMENTE en 1")

  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const snapshot = servicio.snapshot()
    assert.equal(snapshot.revision, 1)
    const disco = JSON.parse(leerDiscoCrudo(dirDatos, idProyecto))
    assert.equal(disco.revision, 1)
    assert.deepEqual(disco.placa, snapshot.proyecto.placa)
    assert.deepEqual(disco.componentes, snapshot.proyecto.componentes)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-02 — Operación fuera de la whitelist
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-02: tipo fuera de whitelist se rechaza EN LA TOOL, sin invocar el Engine, revisión y disco idénticos byte a byte", async () => {
  const dirActivo = nuevoDir("tool-t02")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const espiaAplicar = espiarMetodo(servicio, "aplicarTransaccion")
    const espiaProponer = espiarMetodo(servicio, "proponer")
    const revisionAntes = servicio.snapshot().revision
    const discoAntes = leerDiscoCrudo(dirDatos, idProyecto)

    const tiposInvalidos = ["SetComportamiento", "CambiarComponente", "CrearProyecto", "setplaca", "Foo", ""]
    for (const tipoInvalido of tiposInvalidos) {
      const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: revisionAntes, operaciones: [{ tipo: tipoInvalido, payload: {} }] }, dirActivo))
      assert.equal(r.ok, false, `tipo ${JSON.stringify(tipoInvalido)} tendría que rechazarse`)
      assert.equal(r.rechazadoPor, "tool")
      assert.equal(r.codigo, "OPERACION_FUERA_DE_WHITELIST")
      assert.equal(r.tipo, tipoInvalido)
    }
    assert.equal(espiaAplicar.contador(), 0, "el Engine (aplicarTransaccion) nunca se invocó")
    assert.equal(espiaProponer.contador(), 0, "el Engine (proponer) nunca se invocó")
    assert.equal(servicio.snapshot().revision, revisionAntes, "la revisión no cambió")
    assert.equal(leerDiscoCrudo(dirDatos, idProyecto), discoAntes, "el disco no cambió byte a byte")
    espiaAplicar.restaurar()
    espiaProponer.restaurar()
  } finally {
    servicio.cerrar()
  }
})

test("T-AG-02: un lote con UNA sola operación fuera de whitelist se rechaza ENTERO (nunca aplica la operación válida del mismo lote)", async () => {
  const dirActivo = nuevoDir("tool-t02b")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const r = parsearJson(
      await llamarTool(
        {
          accion: "aplicar",
          idProyecto,
          baseRevision: 0,
          operaciones: [
            { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
            { tipo: "SetComportamiento", payload: {} },
          ],
        },
        dirActivo,
      ),
    )
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "OPERACION_FUERA_DE_WHITELIST")
    assert.equal(r.tipo, "SetComportamiento")
    assert.equal(servicio.snapshot().revision, 0, "nada se aplicó, ni siquiera la SetPlaca válida del mismo lote")
    assert.equal(servicio.snapshot().proyecto.placa, null)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-03 — Saltear baseRevision
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-03: sin baseRevision -> rechazo DE LA TOOL, nunca invoca el Engine", async () => {
  const dirActivo = nuevoDir("tool-t03a")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const espiaAplicar = espiarMetodo(servicio, "aplicarTransaccion")
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
    assert.equal(r.ok, false)
    assert.equal(r.rechazadoPor, "tool")
    assert.equal(r.codigo, "BASE_REVISION_FALTANTE")
    assert.equal(espiaAplicar.contador(), 0)
    assert.equal(servicio.snapshot().revision, 0)
    espiaAplicar.restaurar()
  } finally {
    servicio.cerrar()
  }
})

test("T-AG-03: baseRevision desactualizado (pero con forma válida) -> BASE_REVISION_DESACTUALIZADA del ENGINE, sin mutación", async () => {
  const dirActivo = nuevoDir("tool-t03b")
  const idProyecto = nuevoIdProyecto()

  const r0 = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r0.ok, true)

  const r1 = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "led" } }] }, dirActivo))
  assert.equal(r1.ok, false)
  assert.notEqual(r1.rechazadoPor, "tool", "esto es un rechazo de DOMINIO (Engine), no de transporte")
  assert.ok(r1.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
  assert.equal(r1.revisionActual, 1, "sin mutación: sigue en 1")

  const lectura = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
  assert.equal(lectura.revision, 1)
  assert.equal(lectura.componentes.length, 0, "el AgregarComponente NUNCA entró")
})

test("T-AG-03: baseRevision no entero o negativo -> BASE_REVISION_INVALIDA del ENGINE (no de la tool)", async () => {
  const dirActivo = nuevoDir("tool-t03c")
  const idProyecto = nuevoIdProyecto()
  for (const valorInvalido of [1.5, -1]) {
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: valorInvalido, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
    assert.equal(r.ok, false, `valor ${valorInvalido}`)
    assert.notEqual(r.rechazadoPor, "tool", `valor ${valorInvalido}: tiene que ser un rechazo del Engine`)
    assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_INVALIDA"), `valor ${valorInvalido}: motivos ${JSON.stringify(r.motivos)}`)
  }
})

test("T-AG-03: la tool NUNCA completa baseRevision con snapshot().revision — pasa el valor del arg tal cual, aunque esté desactualizado", async () => {
  const dirActivo = nuevoDir("tool-t03d")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  const original = servicio.aplicarTransaccion
  let sobresCapturados = null
  servicio.aplicarTransaccion = (sobres) => {
    sobresCapturados = sobres
    return original.call(servicio, sobres)
  }
  try {
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 999, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
    assert.ok(sobresCapturados, "el Engine SÍ se invocó (999 es forma válida, la valida el motor, no la tool)")
    assert.equal(sobresCapturados[0].baseRevision, 999, "la tool pasó el baseRevision del arg TAL CUAL — nunca lo corrigió con snapshot().revision")
    assert.equal(r.ok, false)
    assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
  } finally {
    servicio.aplicarTransaccion = original
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-04 — Saltear la transacción (atomicidad del lote)
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-04: lote [válida, inválida] -> NADA aplicado, revisión y disco idénticos, motivos estructurados", async () => {
  const dirActivo = nuevoDir("tool-t04")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const discoAntes = leerDiscoCrudo(dirDatos, idProyecto)
    const r = parsearJson(
      await llamarTool(
        {
          accion: "aplicar",
          idProyecto,
          baseRevision: 0,
          operaciones: [
            { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
            { tipo: "AsignarPin", payload: { componente: "cmp-inexistente", terminal: "anodo", pin: GPIO_X } },
          ],
        },
        dirActivo,
      ),
    )
    assert.equal(r.ok, false)
    assert.ok(r.motivos.length > 0, "motivos estructurados, nunca vacío")
    assert.equal(servicio.snapshot().revision, 0)
    assert.equal(servicio.snapshot().proyecto.placa, null, "ni siquiera la SetPlaca (primera, válida) quedó aplicada")
    assert.equal(leerDiscoCrudo(dirDatos, idProyecto), discoAntes, "el disco no cambió")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-05 — Saltear la validación: convergencia de caminos (tool, navegador, Engine directo)
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-05: pulsador en GPIO34 da el MISMO PIN_SIN_PULLUP_INTERNO (código+severidad+explicación) por la tool, por POST del navegador y por el Engine directo", async () => {
  async function motivoViaEngineDirecto() {
    const dir = nuevoDir("t05-directo")
    const id = nuevoIdProyecto()
    const s = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
    try {
      let r = s.aplicar({ idOperacion: "a", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
      assert.equal(r.ok, true)
      r = s.aplicar({ idOperacion: "b", actor: "agente", baseRevision: 1, tipo: "AgregarComponente", payload: { tipo: "pulsador" } })
      assert.equal(r.ok, true)
      const idPulsador = s.snapshot().proyecto.componentes[0].id
      r = s.aplicar({ idOperacion: "c", actor: "agente", baseRevision: 2, tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO34" } })
      assert.equal(r.ok, true, "el commit entra igual: motivo representable, no rechazo")
      return s.snapshot().vista.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    } finally {
      s.cerrar()
    }
  }

  async function motivoViaNavegador() {
    const dir = nuevoDir("t05-navegador")
    const id = nuevoIdProyecto()
    const s = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
    const servidor = await iniciarServidor({ servicio: s })
    try {
      let r = s.aplicar({ idOperacion: "a", actor: "navegador", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
      assert.equal(r.ok, true)
      r = s.aplicar({ idOperacion: "b", actor: "navegador", baseRevision: 1, tipo: "AgregarComponente", payload: { tipo: "pulsador" } })
      assert.equal(r.ok, true)
      const idPulsador = s.snapshot().proyecto.componentes[0].id
      const rPost = await fetch(new URL("/api/operaciones", servidor.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin },
        body: JSON.stringify({ idOperacion: "c", actor: "navegador", baseRevision: 2, tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO34" } }),
      })
      const cuerpo = await rPost.json()
      assert.equal(cuerpo.resultado.ok, true)
      return s.snapshot().vista.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    } finally {
      await servidor.cerrar()
      s.cerrar()
    }
  }

  async function motivoViaTool() {
    const dirActivo = nuevoDir("t05-tool")
    const idProyecto = nuevoIdProyecto()
    let r = parsearJson(
      await llamarTool(
        { accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "pulsador" } }] },
        dirActivo,
      ),
    )
    assert.equal(r.ok, true)
    const lectura = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
    const idPulsador = lectura.componentes.find((c) => c.tipo === "pulsador").id
    r = parsearJson(
      await llamarTool({ accion: "aplicar", idProyecto, baseRevision: r.revisionActual, operaciones: [{ tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO34" } }] }, dirActivo),
    )
    assert.equal(r.ok, true, `el commit tiene que entrar igual (representable): ${JSON.stringify(r.motivos)}`)
    return r.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
  }

  const [directo, navegador, tool] = await Promise.all([motivoViaEngineDirecto(), motivoViaNavegador(), motivoViaTool()])
  assert.ok(directo && navegador && tool, `los tres caminos tienen que traer el motivo: ${JSON.stringify({ directo, navegador, tool })}`)
  assert.equal(tool.codigo, directo.codigo)
  assert.equal(tool.severidad, directo.severidad)
  assert.equal(tool.clasificacion, directo.clasificacion)
  assert.equal(tool.explicacion, directo.explicacion, "misma explicación determinista (deriva del catálogo, no de la instancia)")
  assert.equal(navegador.codigo, directo.codigo)
  assert.equal(navegador.severidad, directo.severidad)
  assert.equal(navegador.explicacion, directo.explicacion)
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-06 — Suplantar actor o sobre
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-06: elementos de 'operaciones' con claves extra (actor/idOperacion/idTransaccion/baseRevision) se rechazan EN LA TOOL", async () => {
  const dirActivo = nuevoDir("tool-t06")
  const idProyecto = nuevoIdProyecto()
  for (const clave of ["actor", "idOperacion", "idTransaccion", "baseRevision"]) {
    const operacion = { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" }, [clave]: "intruso" }
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [operacion] }, dirActivo))
    assert.equal(r.ok, false, `clave extra '${clave}' tendría que rechazarse`)
    assert.equal(r.rechazadoPor, "tool")
    assert.equal(r.codigo, "OPERACION_CON_CLAVES_INVALIDAS")
  }
})

test("T-AG-06: el sobre que construye la tool SIEMPRE tiene actor:'agente', sin importar qué venga en el arg", async () => {
  const dirActivo = nuevoDir("tool-t06b")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  const original = servicio.aplicarTransaccion
  let sobresCapturados = null
  servicio.aplicarTransaccion = (sobres) => {
    sobresCapturados = sobres
    return original.call(servicio, sobres)
  }
  try {
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
    assert.equal(r.ok, true)
    assert.ok(sobresCapturados)
    assert.ok(
      sobresCapturados.every((s) => s.actor === "agente"),
      "TODOS los sobres del lote tienen que llevar actor:'agente'",
    )
  } finally {
    servicio.aplicarTransaccion = original
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-07 — Segunda instancia del Engine
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-07: la tool y vista-fisica, en el mismo proceso, usan el MISMO servicio; una aplicación por la tool dispara el SSE 'revision' en el servidor HTTP abierto", async () => {
  const dirActivo = nuevoDir("tool-t07")
  const { servidor, servicio } = await obtenerServidorVistaFisica(dirActivo)
  try {
    const dirDatos = directorioDeDatos(dirActivo)
    const servicioPorLaViaDeProduccion = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto: ID_PROYECTO_DEFAULT })
    assert.equal(servicioPorLaViaDeProduccion, servicio, "mismo singleton que usa vista-fisica")

    const coleccionSSE = await conectarSSE(new URL("/api/eventos", servidor.url))
    try {
      const r = parsearJson(await llamarTool({ accion: "aplicar", baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
      assert.equal(r.ok, true, `rechazado: ${JSON.stringify(r.motivos)}`)

      const evento = await coleccionSSE.siguienteEvento()
      assert.equal(evento.tipo, "revision")
      assert.deepEqual(evento.datos, { revision: 1 })

      const rGet = await fetch(new URL("/api/proyecto", servidor.url))
      const snapshot = await rGet.json()
      assert.equal(snapshot.proyecto.placa, "esp32-devkit-v1", "la operación aplicada VÍA LA TOOL se ve en el GET del servidor (mismo Engine)")
      assert.equal(snapshot.revision, 1)
    } finally {
      await coleccionSSE.cerrar()
    }
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-08 — El dry-run muta
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-08: 'simular' NUNCA muta — revisión y disco iguales, sin notificación SSE", async () => {
  const dirActivo = nuevoDir("tool-t08")
  const idProyecto = nuevoIdProyecto()
  const { servidor, servicio } = await obtenerServidorVistaFisica(dirActivo, idProyecto)
  try {
    const coleccionSSE = await conectarSSE(new URL("/api/eventos", servidor.url))
    try {
      const dirDatos = directorioDeDatos(dirActivo)
      const revisionAntes = servicio.snapshot().revision
      const discoAntes = leerDiscoCrudo(dirDatos, idProyecto)

      const r = parsearJson(await llamarTool({ accion: "simular", idProyecto, baseRevision: revisionAntes, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
      assert.equal(r.ok, true, `un lote válido en dry-run tiene que dar ok:true: ${JSON.stringify(r.motivos)}`)
      assert.equal(servicio.snapshot().revision, revisionAntes, "simular nunca sube la revisión")
      assert.equal(leerDiscoCrudo(dirDatos, idProyecto), discoAntes, "simular nunca toca el disco")
      assert.equal(servicio.snapshot().proyecto.placa, null, "simular nunca aplica el cambio propuesto")

      const rReal = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: revisionAntes, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
      assert.equal(rReal.ok, true)
      const evento = await coleccionSSE.siguienteEvento()
      assert.deepEqual(evento.datos, { revision: revisionAntes + 1 }, "el ÚNICO evento SSE que llega es el del 'aplicar' real, nunca del 'simular' previo")
    } finally {
      await coleccionSSE.cerrar()
    }
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-09 — Candado
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-09: con OTRO proceso dueño del proyecto, la tool devuelve un mensaje claro (ninguna escritura, nunca se cuelga)", async () => {
  const dirActivo = nuevoDir("tool-t09")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const HIJO = join(REPO, "tests", "phase2-candado-proceso-hijo.mjs")

  const hijo = await new Promise((resolveListo, reject) => {
    const proc = spawn(process.execPath, [HIJO, dirDatos, idProyecto, "dueno"], { env: { ...process.env, REPO_OBJ: REPO }, stdio: ["pipe", "pipe", "inherit"] })
    let buffer = ""
    let lineasVistas = 0
    let resolverResultado
    const resultado = new Promise((r) => {
      resolverResultado = r
    })
    proc.stdout.on("data", (d) => {
      buffer += d.toString()
      let idx
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const linea = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!linea) continue
        lineasVistas += 1
        if (lineasVistas === 1) resolveListo({ proc, resultado })
        else if (lineasVistas === 2) resolverResultado(JSON.parse(linea))
      }
    })
    proc.on("error", reject)
  })
  hijo.proc.stdin.write("ABRIR\n")
  const resultadoHijo = await hijo.resultado
  assert.equal(resultadoHijo.abrio, true, "fixture: el hijo tiene que lograr abrir primero")

  const discoAntes = leerDiscoCrudo(dirDatos, idProyecto)
  const respuesta = await llamarTool({ accion: "leer", idProyecto }, dirActivo)
  // Cambia por contrato (FX-5, ronda de fixes, F-TRUTH-3): ANTES esta ruta devolvía
  // un string plano ("es un mensaje de texto de la tool, no un JSON de resultado del
  // Engine") — contradecía F-06 ("proyecto-fisico SIEMPRE arranca su respuesta con
  // una línea resultado"), y un agente que intentara parsear la respuesta como JSON
  // fallaba. Ahora es el MISMO sobre JSON que cualquier otro rechazo de la tool.
  assert.match(respuesta, /otro proceso/i, "el mensaje tiene que ser claro sobre por qué falló")
  const parsed = JSON.parse(respuesta)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.rechazadoPor, "tool")
  assert.equal(parsed.codigo, "PROYECTO_BLOQUEADO")
  assert.match(parsed.resultado, /^NO SE APLIC/, "sigue trayendo la línea 'resultado' inequívoca (F-06)")
  assert.equal(leerDiscoCrudo(dirDatos, idProyecto), discoAntes, "la tool no escribió nada")

  hijo.proc.stdin.write("CERRAR\n")
  await new Promise((r) => hijo.proc.on("close", r))
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-10 — Datos no planos
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-10: payload con prototipo alterado (__proto__/constructor) -> lo rechaza el ENGINE (ENTRADA_NO_ES_DATO_PLANO); la tool nunca lo 'limpia' en silencio", async () => {
  const dirActivo = nuevoDir("tool-t10")
  const idProyecto = nuevoIdProyecto()
  const payloadMalicioso = { placa: "esp32-devkit-v1" }
  Object.setPrototypeOf(payloadMalicioso, { constructor: "intruso", __proto__: "otro-intruso" })

  const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: payloadMalicioso }] }, dirActivo))
  assert.equal(r.ok, false, "el Engine tiene que rechazar un payload con prototipo alterado")
  assert.equal(r.rechazadoPor, undefined, "no es un rechazo de transporte de la tool -- la forma {tipo,payload} es válida, el CONTENIDO lo rechaza el Engine")
  assert.ok(r.motivos.some((m) => m.codigo === "ENTRADA_NO_ES_DATO_PLANO"), `motivos: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, 0, "nada se aplicó")
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-11 — Tamaño
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-11: más de 20 operaciones -> rechazo ESTRUCTURADO de la tool (nunca trunca, aplica parcial ni divide)", async () => {
  const dirActivo = nuevoDir("tool-t11")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    const espiaAplicar = espiarMetodo(servicio, "aplicarTransaccion")
    const operaciones21 = Array.from({ length: 21 }, () => ({ tipo: "AgregarComponente", payload: { tipo: "led" } }))
    const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: operaciones21 }, dirActivo))
    assert.equal(r.ok, false)
    assert.equal(r.rechazadoPor, "tool")
    assert.equal(r.codigo, "DEMASIADAS_OPERACIONES")
    assert.equal(r.limite, 20)
    assert.equal(r.recibidas, 21)
    assert.equal(espiaAplicar.contador(), 0, "el Engine nunca se invocó")
    assert.equal(servicio.snapshot().revision, 0, "nada se aplicó, ni truncado ni parcial")
    espiaAplicar.restaurar()
  } finally {
    servicio.cerrar()
  }
})

test("T-AG-11: exactamente 20 operaciones es válido (límite inclusive)", async () => {
  const dirActivo = nuevoDir("tool-t11b")
  const idProyecto = nuevoIdProyecto()
  const operaciones20 = [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, ...Array.from({ length: 19 }, () => ({ tipo: "AgregarComponente", payload: { tipo: "led" } }))]
  const r = parsearJson(await llamarTool({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: operaciones20 }, dirActivo))
  assert.equal(r.ok, true, `20 operaciones válidas tendrían que entrar: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, 1)
})

// ════════════════════════════════════════════════════════════════════════════════════
// T-AG-12 — Registry (con servidor/ ausente)
// ════════════════════════════════════════════════════════════════════════════════════

test("T-AG-12: con servidor/ ausente, proyecto-fisico.ts sigue importando (D13) y falla EXPLÍCITO recién al usarse; el resto de las tools también sigue cargando", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "tb-t12-"))
  try {
    cpSync(join(REPO, "opencode"), join(tmp, "opencode"), { recursive: true })
    rmSync(join(tmp, "opencode", "servidor"), { recursive: true, force: true })

    // Simula la resolución de @opencode-ai/plugin que hace el instalador real (ver
    // tests/empaquetado-instalado.test.mjs) — necesaria porque <tmp> está fuera del
    // árbol de node_modules del repo.
    mkdirSync(join(tmp, "opencode", "node_modules", "@opencode-ai"), { recursive: true })
    symlinkSync(join(REPO, "node_modules", "@opencode-ai", "plugin"), join(tmp, "opencode", "node_modules", "@opencode-ai", "plugin"), "dir")

    const dirTool = join(tmp, "opencode", "tool")
    const archivosTool = readdirSync(dirTool).filter((f) => /\.(ts|js)$/.test(f))
    assert.ok(archivosTool.includes("proyecto-fisico.ts"), "fixture: tiene que existir la tool nueva")
    assert.ok(archivosTool.includes("vista-fisica.ts"))

    const ok = []
    const fallos = []
    for (const archivo of archivosTool.sort()) {
      try {
        await import(pathToFileURL(join(dirTool, archivo)).href)
        ok.push(archivo)
      } catch (error) {
        fallos.push({ archivo, mensaje: error instanceof Error ? error.message : String(error) })
      }
    }
    assert.deepEqual(fallos, [], `con servidor/ ausente, estas tools dejaron de importar (el registry entero se caería): ${JSON.stringify(fallos)}`)
    assert.deepEqual(ok, archivosTool.sort(), "el loop de import no pasó por todas las tools")

    const modAusente = await import(pathToFileURL(join(dirTool, "proyecto-fisico.ts")).href)
    const dirActivo = nuevoDir("t12-uso")
    const respuesta = await modAusente.default.execute({ accion: "leer" }, { directory: dirActivo })
    assert.match(respuesta, /servidor/i, "el mensaje tiene que nombrar la pieza que falta (servidor)")
    assert.match(respuesta, /reinstal/i, "el mensaje tiene que sugerir reinstalar")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
