// Phase 2, Slice 2 — W-S2-FIX (ronda de fixes autorizada, RED-S2-TOOL/INFORME.md).
//
// C-01 (CRITICAL): `idProyecto` sin validar viajaba hasta `nucleo/almacen.ts`/
// `servidor/servicio-con-vista.ts` (capas PROTEGIDAS, §6 del diseño), que arman la
// ruta final con `join(directorio, \`${id}.json\`)` sin chequear separadores de ruta
// ni "..". Un id con path traversal (p. ej. "../../../fuga") escribe fuera de
// `.tecnia-vista-fisica` y hasta fuera de `ctx.directory` (reproducido, confirmado por
// el orquestador: `.../s2impl/repro-c01/repro2.mjs`). El fix agrega una función pura
// (`validarIdProyecto`, `opencode/vista-fisica/ubicacion-proyecto.ts`) y la aplica
// ANTES de tocar disco o tomar el candado, en las dos tools
// (`opencode/tool/proyecto-fisico.ts`, `opencode/tool/vista-fisica.ts`) y en el
// launcher de demo (`scripts/vista-fisica-demo.mjs`).
//
// M-01 (MINOR): `operaciones` con el prototipo alterado
// (`Object.setPrototypeOf(arr, {length:999})`) rompía `.entries()` (heredado de
// `Array.prototype`, que el prototipo alterado ya no ofrece) con un `TypeError` crudo,
// sin capturar, fuera de `execute()`.
//
// N-01 (NOTE, defensa en profundidad): una `accion` desconocida caía en el dry-run por
// el fallthrough implícito del ternario (`args.accion === "aplicar" ? ... : ...`) en
// vez de un rechazo explícito.
//
// Este archivo prueba el BORDE de la tool — nunca reimplementa el catálogo T-AG-01..12
// (`tests/phase2-s2-tool-agente.test.mjs`) ni el recorrido de aceptación
// (`tests/phase2-s2-recorrido.test.mjs`): esos dos siguen en verde SIN CAMBIOS.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const vistaFisica = (await import(join(REPO, "opencode/tool/vista-fisica.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { directorioDeDatos, ID_PROYECTO_DEFAULT } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))

function parsearJson(texto) {
  return JSON.parse(texto)
}

/**
 * Árbol recursivo (archivos Y directorios, ruta relativa a `raiz`, orden estable) —
 * para probar "ningún archivo creado" DE VERDAD: compara el árbol ANTES/DESPUÉS de
 * invocar la tool con un `idProyecto` malicioso tiene que dar EXACTAMENTE lo mismo, sin
 * importar a qué altura del árbol un traversal pudiera aterrizar (nunca alcanza con
 * mirar sólo `<ctx.directory>/.tecnia-vista-fisica/`, mismo criterio que el informe de
 * red team usa para confirmar C-01: "existe fuera del proyecto? true").
 */
function listarArbol(raiz) {
  const salida = []
  function recorrer(actual, prefijo) {
    const entradas = readdirSync(actual, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entrada of entradas) {
      const rel = prefijo ? `${prefijo}/${entrada.name}` : entrada.name
      salida.push(entrada.isDirectory() ? `${rel}/` : rel)
      if (entrada.isDirectory()) recorrer(join(actual, entrada.name), rel)
    }
  }
  recorrer(raiz, "")
  return salida
}

/**
 * Sandbox EXCLUSIVO y anidado (nunca compartido con otra suite corriendo en paralelo —
 * mismo criterio de aislamiento que `nuevoDir`, cada llamada tiene su propio contador):
 * `ctx.directory` ("trabajo") queda CUATRO niveles bajo la raíz del sandbox — headroom
 * de sobra para cualquier profundidad de "../" de este archivo (máximo 3, "../../../x"),
 * así que un escape "exitoso" queda de cualquier forma DENTRO del sandbox y
 * `listarArbol(raiz)` lo detecta.
 */
function nuevoSandbox(nombre) {
  const raiz = nuevoDir(nombre)
  const dirActivo = join(raiz, "n1", "n2", "n3", "n4", "trabajo")
  mkdirSync(dirActivo, { recursive: true })
  return { raiz, dirActivo }
}

// Lista de la tarea: traversal relativo (dos profundidades), ruta absoluta literal,
// separador POSIX suelto, separador Windows suelto, "." y ".." pelados, un id que ya
// trae la extensión, percent-encoded, un homoglyph/unicode que evoca "..", y 65
// caracteres (uno más que el límite de 64).
const IDS_INVALIDOS = ["../x", "../../../x", "/abs", "a/b", "a\\b", ".", "..", "x.json", "%2e%2e", "proyecto‥secreto", "a".repeat(65)]

// ════════════════════════════════════════════════════════════════════════════════════
// C-01 — proyecto-fisico.ts
// ════════════════════════════════════════════════════════════════════════════════════

for (const idMalicioso of IDS_INVALIDOS) {
  test(`C-01 proyecto-fisico: idProyecto ${JSON.stringify(idMalicioso)} se rechaza EN LA TOOL, sin tocar disco (árbol idéntico antes/después)`, async () => {
    const { raiz, dirActivo } = nuevoSandbox("borde-c01-pf")
    const arbolAntes = listarArbol(raiz)

    const respuesta = await proyectoFisico.execute(
      { accion: "aplicar", idProyecto: idMalicioso, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] },
      { directory: dirActivo },
    )
    const r = parsearJson(respuesta)
    assert.equal(r.ok, false, `idProyecto ${JSON.stringify(idMalicioso)} tendría que rechazarse: ${respuesta}`)
    assert.equal(r.rechazadoPor, "tool")
    assert.equal(r.codigo, "ID_PROYECTO_INVALIDO")

    assert.deepEqual(listarArbol(raiz), arbolAntes, `ningún archivo/directorio nuevo en todo el sandbox para idProyecto ${JSON.stringify(idMalicioso)}`)
  })
}

test("C-01 proyecto-fisico: idProyecto vacío o sólo espacios sigue cayendo en el default ('activo'), como antes del fix", async () => {
  const { dirActivo } = nuevoSandbox("borde-c01-default")
  for (const idVacio of ["", "   "]) {
    const r = parsearJson(await proyectoFisico.execute({ accion: "leer", idProyecto: idVacio }, { directory: dirActivo }))
    assert.equal(r.idProyecto, ID_PROYECTO_DEFAULT, `idProyecto ${JSON.stringify(idVacio)} tiene que caer en el default`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// C-01 — vista-fisica.ts (mismo bug preexistente de Slice 1, misma función compartida)
// ════════════════════════════════════════════════════════════════════════════════════

for (const idMalicioso of IDS_INVALIDOS) {
  test(`C-01 vista-fisica: idProyecto ${JSON.stringify(idMalicioso)} da un mensaje claro, sin abrir nada (árbol idéntico antes/después)`, async () => {
    const { raiz, dirActivo } = nuevoSandbox("borde-c01-vf")
    const arbolAntes = listarArbol(raiz)

    const respuesta = await vistaFisica.execute({ idProyecto: idMalicioso }, { directory: dirActivo })
    assert.equal(typeof respuesta, "string")
    assert.match(respuesta, /inv[aá]lid/i, `el mensaje tiene que explicar que el id es inválido: ${respuesta}`)
    assert.doesNotMatch(respuesta, /https?:\/\//, "nunca llega a levantar un servidor/URL con un id inválido")

    assert.deepEqual(listarArbol(raiz), arbolAntes, `ningún archivo/directorio nuevo en todo el sandbox para idProyecto ${JSON.stringify(idMalicioso)}`)
  })
}

// ════════════════════════════════════════════════════════════════════════════════════
// C-01 — scripts/vista-fisica-demo.mjs (CLI)
// ════════════════════════════════════════════════════════════════════════════════════

function correrDemo(dir, idProyecto) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(REPO, "scripts/vista-fisica-demo.mjs"), "--dir", dir, "--id-proyecto", idProyecto, "--una-vez"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => (stdout += d.toString()))
    proc.stderr.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => resolve({ code, stdout, stderr }))
    proc.on("error", reject)
  })
}

for (const idMalicioso of IDS_INVALIDOS) {
  test(`C-01 CLI demo: --id-proyecto ${JSON.stringify(idMalicioso)} termina con exit != 0, sin escribir nada (árbol idéntico antes/después)`, async () => {
    const { raiz, dirActivo } = nuevoSandbox("borde-c01-cli")
    const arbolAntes = listarArbol(raiz)

    const resultado = await correrDemo(dirActivo, idMalicioso)
    assert.notEqual(resultado.code, 0, `tendría que fallar; stdout: ${resultado.stdout} / stderr: ${resultado.stderr}`)
    assert.match(resultado.stderr, /inv[aá]lid/i, `stderr tiene que explicar el id inválido: ${resultado.stderr}`)

    assert.deepEqual(listarArbol(raiz), arbolAntes, `ningún archivo/directorio nuevo en todo el sandbox para --id-proyecto ${JSON.stringify(idMalicioso)}`)
  })
}

// ════════════════════════════════════════════════════════════════════════════════════
// C-01 — ids válidos siguen funcionando de punta a punta
// ════════════════════════════════════════════════════════════════════════════════════

test("C-01: 'activo' y 'mi-proyecto_2' son idProyecto válidos y funcionan de punta a punta (por la tool y por el CLI)", async () => {
  for (const idValido of ["activo", "mi-proyecto_2"]) {
    const { dirActivo } = nuevoSandbox(`borde-validos-${idValido}`)
    const respuesta = await proyectoFisico.execute(
      { accion: "aplicar", idProyecto: idValido, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] },
      { directory: dirActivo },
    )
    const r = parsearJson(respuesta)
    assert.equal(r.ok, true, `idProyecto ${JSON.stringify(idValido)} tendría que aceptarse: ${respuesta}`)
    assert.equal(r.revisionActual, 1)

    const dirDatos = directorioDeDatos(dirActivo)
    const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto: idValido })
    try {
      assert.equal(servicio.snapshot().proyecto.placa, "esp32-devkit-v1")
    } finally {
      servicio.cerrar()
    }
  }

  const { dirActivo: dirCli } = nuevoSandbox("borde-validos-cli")
  const resultado = await correrDemo(dirCli, "mi-proyecto_2")
  assert.equal(resultado.code, 0, `el CLI con un id válido tiene que terminar en 0; stderr: ${resultado.stderr}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// M-01 — 'operaciones' con prototipo alterado no puede tirar una excepción cruda
// ════════════════════════════════════════════════════════════════════════════════════

test("M-01: 'operaciones' con el prototipo alterado (repro del informe RED-S2-TOOL) -> rechazo ESTRUCTURADO, nunca una excepción cruda", async () => {
  const { dirActivo } = nuevoSandbox("borde-m01")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)

  const operacionesFalsas = [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }]
  Object.setPrototypeOf(operacionesFalsas, { length: 999 })

  const respuesta = await proyectoFisico.execute({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: operacionesFalsas }, { directory: dirActivo })
  const r = parsearJson(respuesta)
  assert.equal(r.ok, false)
  assert.equal(r.rechazadoPor, "tool")
  assert.equal(typeof r.codigo, "string")

  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    assert.equal(servicio.snapshot().revision, 0, "nada se aplicó")
    assert.equal(servicio.snapshot().proyecto.placa, null)
  } finally {
    servicio.cerrar()
  }
})

test("M-01: un objeto array-like con prototipo Array.prototype removido (sin 'length' propio de array real) se rechaza igual, con forma inválida", async () => {
  const { dirActivo } = nuevoSandbox("borde-m01b")
  const idProyecto = nuevoIdProyecto()

  const operacionesFalsas = { 0: { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, length: 1 }
  const respuesta = await proyectoFisico.execute({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: operacionesFalsas }, { directory: dirActivo })
  const r = parsearJson(respuesta)
  assert.equal(r.ok, false)
  assert.equal(r.rechazadoPor, "tool")
  assert.equal(r.codigo, "OPERACION_CON_FORMA_INVALIDA", "un objeto que no es un Array de verdad se rechaza por forma, nunca se lo trata como lote")
})

// ════════════════════════════════════════════════════════════════════════════════════
// N-01 — accion desconocida (defensa en profundidad)
// ════════════════════════════════════════════════════════════════════════════════════

test("N-01: una 'accion' desconocida se rechaza EXPLÍCITO (ACCION_DESCONOCIDA), nunca cae en el dry-run por default implícito", async () => {
  const { dirActivo } = nuevoSandbox("borde-n01")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)

  const respuesta = await proyectoFisico.execute(
    { accion: "borrarTodo", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] },
    { directory: dirActivo },
  )
  const r = parsearJson(respuesta)
  assert.equal(r.ok, false)
  assert.equal(r.rechazadoPor, "tool")
  assert.equal(r.codigo, "ACCION_DESCONOCIDA")

  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    assert.equal(servicio.snapshot().revision, 0, "nada se aplicó -- no cayó en el dry-run silencioso")
    assert.equal(servicio.snapshot().proyecto.placa, null)
  } finally {
    servicio.cerrar()
  }
})
