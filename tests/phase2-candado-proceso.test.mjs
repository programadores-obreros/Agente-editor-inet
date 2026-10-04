// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo H5 (CRITICAL,
// P2-RED-A/INFORME.md, ataque 6): dos procesos de SISTEMA OPERATIVO reales sobre el
// mismo directorio+idProyecto sólo tenían al CAS de disco (E3-07, `almacen.ts`) como
// defensa — un patrón leer-decidir-escribir SIN lock de archivo, con una ventana de
// carrera real: en 3 de 4 corridas del red team (y 3 de 3 en la reproducción de este
// writer, ver `.../evidencia/W5/H5/antes-*.txt`), AMBOS procesos recibían `ok:true`,
// con pérdida silenciosa de uno de los dos commits.
//
// Fix (`opencode/servidor/servicio-con-vista.ts`, NUNCA `almacen.ts` ni
// `composicion-raiz.ts` — los tests de Phase 1 crean varios almacenes sobre el mismo
// directorio y no se pueden romper): un candado de propiedad por proyecto, A NIVEL
// PROCESO, con un archivo `<directorio>/<idProyecto>.lock` creado con
// `fs.openSync(ruta, "wx")` (atómico a nivel de sistema operativo — a diferencia del
// CAS de `almacen.ts`, acá no hay ventana leer-luego-escribir). Si el candado ya
// existe: dueño vivo (mismo hostname, pid vivo) → falla con un error claro; dueño
// muerto (ESRCH) → se recupera, el reemplazo queda registrado en el propio archivo.
// `cerrar()` libera el candado (verificando que el contenido sea el propio antes de
// borrar) y también se libera al salir del proceso (`process.on("exit")`).
//
// Límites documentados (NO cerrados acá): reuso de PID (un candado "vivo" podría en
// teoría pertenecer a un proceso nuevo que reusó el mismo PID que el dueño original
// — ventana muy angosta en la práctica, no eliminada) y filesystems de red (NFS
// antiguo puede no garantizar `O_EXCL` atómico entre hosts distintos).

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const HIJO = join(TESTS_DIR, "phase2-candado-proceso-hijo.mjs")

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))

/** Lanza un hijo real y lo lleva hasta "LISTO" (módulo ya importado) — recién
 * después de esto el orquestador dispara "ABRIR". Devuelve el proceso, una promesa
 * del resultado (la línea JSON post-"ABRIR") y una promesa del CIERRE del proceso.
 *
 * G-10 — POR QUÉ EL CIERRE SE ESCUCHA ACÁ, DESDE EL SPAWN. Antes cada test agregaba
 * `proc.on("close")` al final, después de mandar CERRAR. Si el hijo ya había cerrado
 * (el perdedor sale apenas informa), ese evento no vuelve a dispararse y el test se
 * quedaba esperando para siempre: se vio colgado ~29 min bajo carga. Y si un hijo se
 * cae antes de informar, el test tiene que FALLAR con el motivo, no colgarse: por eso
 * el cierre temprano rechaza las promesas pendientes. */
function lanzarHijoHastaListo(directorio, idProyecto, etiqueta) {
  const proc = spawn(process.execPath, [HIJO, directorio, idProyecto, etiqueta], { env: { ...process.env, REPO_OBJ: REPO }, stdio: ["pipe", "pipe", "inherit"] })
  const cerrado = new Promise((resolve) => proc.on("close", (codigo, senal) => resolve({ codigo, senal })))
  return new Promise((resolveListo, reject) => {
    let buffer = ""
    let lineasVistas = 0
    let resolverResultado
    let rechazarResultado
    const resultado = new Promise((resolve, rechazar) => {
      resolverResultado = resolve
      rechazarResultado = rechazar
    })
    resultado.catch(() => {}) // quien lo espera recibe igual el rechazo; esto sólo evita el "unhandled" mientras nadie lo espera todavía
    cerrado.then(({ codigo, senal }) => {
      const motivo = `el hijo "${etiqueta}" terminó (código ${codigo}, señal ${senal})`
      if (lineasVistas < 1) reject(new Error(`${motivo} antes de anunciar LISTO`))
      else if (lineasVistas < 2) rechazarResultado(new Error(`${motivo} antes de informar su resultado`))
    })
    proc.stdout.on("data", (d) => {
      buffer += d.toString()
      let idx
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const linea = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!linea) continue
        lineasVistas += 1
        if (lineasVistas === 1) {
          // "LISTO"
          resolveListo({ proc, resultado, cerrado })
        } else if (lineasVistas === 2) {
          resolverResultado(JSON.parse(linea))
        }
      }
    })
    proc.on("error", reject)
  })
}

function enviar(proc, linea) {
  proc.stdin.write(`${linea}\n`)
}

/** Ciclo de vida completo de UN hijo, sin carrera (uso secuencial): LISTO -> ABRIR ->
 * resultado -> (si abrió) CERRAR -> el proceso termina. */
async function lanzarHijoUnaVez(directorio, idProyecto, etiqueta) {
  const hijo = await lanzarHijoHastaListo(directorio, idProyecto, etiqueta)
  enviar(hijo.proc, "ABRIR")
  const resultado = await hijo.resultado
  if (resultado.abrio) enviar(hijo.proc, "CERRAR")
  await hijo.cerrado
  return resultado
}

// ════════════════════════════════════════════════════════════════════════════════════
// Reproducción del ataque 6: DOS procesos de SO reales, mismo directorio+idProyecto
// ════════════════════════════════════════════════════════════════════════════════════

test("H5: dos procesos de SO reales sobre el MISMO directorio+idProyecto — el SEGUNDO falla al abrir, NUNCA hay dos 'abrio:true'", async () => {
  const dir = nuevoDir("h5-dos-procesos")
  const id = nuevoIdProyecto()

  // Ambos hijos importan su módulo (trabajo pesado: catálogo real) ANTES de anunciar
  // "LISTO" — recién cuando LOS DOS están listos se dispara "ABRIR" a los dos, lo más
  // simultáneo posible (dos escrituras sincrónicas seguidas, sin ningún await en el
  // medio). Esto crea la carrera real en el intento de ABRIR, determinista — nunca
  // depende de cuánto tarda cada proceso en arrancar.
  const [hijoA, hijoB] = await Promise.all([lanzarHijoHastaListo(dir, id, "proceso-A"), lanzarHijoHastaListo(dir, id, "proceso-B")])
  enviar(hijoA.proc, "ABRIR")
  enviar(hijoB.proc, "ABRIR")
  const [r1, r2] = await Promise.all([hijoA.resultado, hijoB.resultado])

  const abrieron = [r1, r2].filter((r) => r.abrio === true)
  const fallaron = [r1, r2].filter((r) => r.abrio === false)

  // El que ganó sigue vivo sosteniendo el candado (esperando "CERRAR") — hay que
  // liberarlo para que el proceso termine limpio, sin importar cuál haya ganado.
  //
  // G-10 — POR QUÉ SÓLO AL QUE ABRIÓ. Antes se mandaba CERRAR a LOS DOS. El perdedor
  // no espera nada: sale apenas informa su resultado, así que escribirle a un stdin
  // ya cerrado daba EPIPE (1 de cada ~40 corridas bajo carga). El protocolo del hijo
  // dice que sólo el que abrió espera CERRAR, igual que `lanzarHijoUnaVez`. Si los dos
  // abrieran (el bug que este test existe para atrapar), los dos reciben CERRAR, los
  // dos cierran, y la aserción de "exactamente uno" de abajo falla igual.
  for (const [hijo, resultado] of [[hijoA, r1], [hijoB, r2]]) if (resultado.abrio) enviar(hijo.proc, "CERRAR")
  await Promise.all([hijoA.cerrado, hijoB.cerrado])

  assert.equal(abrieron.length, 1, `EXACTAMENTE uno de los dos procesos tiene que abrir el servicio — resultado: ${JSON.stringify([r1, r2])}`)
  assert.equal(fallaron.length, 1, "el otro tiene que fallar al abrir (nunca al commitear con un resultado ok:true silenciosamente perdido)")
  assert.match(fallaron[0].mensaje, /otro proceso/i, "el mensaje de error tiene que ser claro sobre POR QUÉ falló")
  assert.equal(abrieron[0].ok, true, "el que SI abrio, commitea sin problema — es la unica autoridad")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Candado con pid muerto → se recupera
// ════════════════════════════════════════════════════════════════════════════════════

test("H5: un candado con un PID ya muerto se RECUPERA (no bloquea para siempre)", async () => {
  const dir = nuevoDir("h5-pid-muerto")
  const id = nuevoIdProyecto()

  // Un proceso hijo real que termina INMEDIATAMENTE — su pid queda garantizado
  // muerto para cuando lo usamos.
  const pidMuerto = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", "process.exit(0)"])
    proc.on("exit", () => resolve(proc.pid))
    proc.on("error", reject)
  })

  // Fabricamos a mano un candado "viejo" con ese pid, en el MISMO formato que escribe
  // el fix (ver servicio-con-vista.ts): { pid, hostname, creado }.
  mkdirSync(dir, { recursive: true })
  const os = await import("node:os")
  writeFileSync(join(dir, `${id}.lock`), JSON.stringify({ pid: pidMuerto, hostname: os.hostname(), creado: new Date(0).toISOString() }))

  // No debe lanzar: el pid esta muerto (ESRCH), asi que el candado se recupera.
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const r = servicio.aplicar({ idOperacion: "recuperado-op", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
  assert.equal(r.ok, true, "el candado con pid muerto se recupera y el servicio funciona normalmente")

  const contenido = JSON.parse(readFileSync(join(dir, `${id}.lock`), "utf8"))
  assert.equal(contenido.pid, process.pid, "el reemplazo del candado queda registrado con el pid del proceso ACTUAL")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// cerrar() libera el candado — otro "proceso" (otra llamada, mismo criterio) puede abrir
// ════════════════════════════════════════════════════════════════════════════════════

test("H5: cerrar() libera el candado — un hijo real puede abrir DESPUES de que este proceso cierre", async () => {
  const dir = nuevoDir("h5-cerrar-libera")
  const id = nuevoIdProyecto()

  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const r0 = servicio.aplicar({ idOperacion: "op-0", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
  assert.equal(r0.ok, true)

  // Antes de cerrar: un hijo real NO puede abrir (el candado sigue vivo, dueño = este proceso).
  const antesDeCerrar = await lanzarHijoUnaVez(dir, id, "hijo-antes")
  assert.equal(antesDeCerrar.abrio, false, "mientras este proceso tiene el candado, otro proceso no puede abrir")

  servicio.cerrar()

  // Despues de cerrar: el hijo SI puede abrir.
  const despuesDeCerrar = await lanzarHijoUnaVez(dir, id, "hijo-despues")
  assert.equal(despuesDeCerrar.abrio, true, "cerrar() libero el candado — otro proceso ya puede abrir")
  assert.equal(despuesDeCerrar.ok, true)
})

// ════════════════════════════════════════════════════════════════════════════════════
// En el MISMO proceso, llamadas repetidas para la misma clave NO se autobloquean
// ════════════════════════════════════════════════════════════════════════════════════

test("H5: EN EL MISMO PROCESO, dos llamadas para la misma clave NO se autobloquean (el candado es por PROCESO, no por llamada)", () => {
  const dir = nuevoDir("h5-mismo-proceso")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const b = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  assert.equal(a, b, "mismo proceso, misma clave -> mismo singleton, sin pasar de nuevo por el candado")
  a.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// Tool y demo launcher: fallan con un mensaje claro y no se cuelgan
// ════════════════════════════════════════════════════════════════════════════════════

test("H5: el launcher de demo, con OTRO proceso dueño del candado, falla con un mensaje claro (no cuelga)", async () => {
  const dir = nuevoDir("h5-launcher-otro-dueno")
  const id = nuevoIdProyecto()

  // Este PROPIO proceso de test toma el candado primero (simula "otra sesion de
  // OpenCode ya tiene el proyecto abierto").
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })

  const resultado = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(REPO, "scripts/vista-fisica-demo.mjs"), "--dir", dir, "--id-proyecto", id, "--una-vez"], {
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

  assert.notEqual(resultado.code, 0, "el launcher tiene que terminar con codigo de error, nunca colgarse ni fingir exito")
  assert.match(resultado.stderr, /otro proceso/i, "el mensaje de error en stderr tiene que ser claro sobre la causa")

  servicio.cerrar()
})

test("H5: la tool (opencode/tool/vista-fisica.ts), con OTRO proceso dueño del candado, falla con un mensaje claro (no cuelga)", async () => {
  const { obtenerServidorVistaFisica, directorioDeDatos, ID_PROYECTO_DEFAULT } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
  const dirActivo = nuevoDir("h5-tool-otro-dueno")

  // Otro proceso real toma el candado para el directorio de datos que usaria la tool.
  const dirDatos = directorioDeDatos(dirActivo)
  const hijo = await lanzarHijoHastaListo(dirDatos, ID_PROYECTO_DEFAULT, "hijo-dueno")
  enviar(hijo.proc, "ABRIR")
  const resultadoHijo = await hijo.resultado
  assert.equal(resultadoHijo.abrio, true, "fixture: el hijo tiene que lograr abrir primero")

  // La tool (misma via de produccion, obtenerServidorVistaFisica) intenta abrir el
  // MISMO directorio+idProyecto mientras el hijo sigue vivo sosteniendo el candado.
  await assert.rejects(
    () => obtenerServidorVistaFisica(dirActivo, ID_PROYECTO_DEFAULT),
    (error) => {
      assert.match(error.message, /otro proceso/i)
      return true
    },
    "obtenerServidorVistaFisica tiene que rechazar con un mensaje claro, nunca colgarse esperando el candado de otro proceso",
  )

  enviar(hijo.proc, "CERRAR")
  await hijo.cerrado
})
