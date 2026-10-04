// Proceso hijo real para tests/empaquetado-instalado.test.mjs (D12-D14, "gate de
// instalación aislada" — PHASE_2_SLICE_1_HARDENING_DESIGN.md §4). Corre en un cwd
// DISTINTO al repo y a la instalación, con la copia fuente ya inaccesible: mismo
// criterio que tests/phase2-candado-proceso-hijo.mjs (protocolo LISTO/ABRIR/CERRAR
// por stdin/stdout, sin sleep) y que ARCH-INSTALL/probe*.mjs (import dinámico por
// ruta absoluta vía pathToFileURL, igual que el registry.ts real de OpenCode:
// `Glob.scanSync("{tool,tools}/*.{js,ts}")` + `import(pathToFileURL(match).href)`).
//
// NO es `*.test.mjs` — `node --test` (package.json, "tests/*.test.mjs") no lo corre
// como suite, sólo lo spawnea el test principal. Mismo patrón que
// tests/phase2-candado-proceso-hijo.mjs.
//
// Modos (primer argv):
//   importar-tools <configDir>
//     — importa CADA archivo de <configDir>/tool en loop (como el registry.ts real,
//       pero SIN abortar al primer fallo: un fallo POR ARCHIVO, para poder ver todos
//       a la vez). Imprime UNA línea JSON: {ok:[...nombres], fallos:[{archivo,
//       mensaje}]}.
//   servidor-happy <configDir> <projectDir>
//     — ciclo de vida completo contra la vista física instalada: import, arrancar
//       servidor, GET "/", GET de los 6 assets, snapshot con "vista", POST
//       AsignarPin (revisión +1), cerrar, y reabrir (raíz nueva sobre el MISMO
//       directorio de datos) para comprobar que el GPIO y la revisión persistieron
//       (recarga). Imprime UNA línea JSON.
//   servidor-ausente <configDir> <projectDir>
//     — con opencode/servidor/ borrado de la instalación (lo hace el test antes de
//       lanzar este modo): el resto de las tools (incluida vista-fisica.ts, que con
//       D13 ya no importa `../servidor/*` en el top-level) tienen que seguir
//       importando, y recién AHÍ, al intentar levantar el servidor,
//       obtenerServidorVistaFisica tiene que rechazar con un mensaje explícito.
//       Imprime UNA línea JSON: {fallosImport:[...], mensajeError}.
//   candado-hijo <configDir> <projectDir> <idProyecto> <etiqueta>
//     — mismo protocolo LISTO/ABRIR/CERRAR que tests/phase2-candado-proceso-hijo.mjs,
//       pero contra servidor-con-vista.ts de la instalación (no del repo).

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// process.argv = [node, ESTE_ARCHIVO, modo, configDir, ...resto] — se saltean los
// DOS primeros (el ejecutable de node y la ruta de este script), no uno solo.
const [, , modo, configDir, ...resto] = process.argv

function urlDe(rutaAbsoluta) {
  return pathToFileURL(rutaAbsoluta).href
}

/** Importa cada tool de <dirTool> en loop, un fallo POR ARCHIVO reportado — nunca
 * aborta al primero (a diferencia de la semántica real de registry.ts, que sí
 * aborta: acá queremos ver el panorama completo en una sola corrida). */
async function importarTodasLasTools(dirTool) {
  const ok = []
  const fallos = []
  for (const archivo of readdirSync(dirTool).sort()) {
    if (!/\.(ts|js)$/.test(archivo)) continue
    try {
      await import(urlDe(join(dirTool, archivo)))
      ok.push(archivo)
    } catch (error) {
      fallos.push({ archivo, mensaje: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ok, fallos }
}

function esperarLinea() {
  return new Promise((resolve) => {
    process.stdin.once("data", (d) => resolve(d.toString().trim()))
  })
}

async function modoImportarTools() {
  const resultado = await importarTodasLasTools(join(configDir, "tool"))
  console.log(JSON.stringify(resultado))
}

async function modoServidorHappy() {
  const [projectDir] = resto
  const m = await import(urlDe(join(configDir, "tool", "vista-fisica.ts")))
  let servidor
  let servicio
  try {
    ;({ servidor, servicio } = await m.obtenerServidorVistaFisica(projectDir))

    const rIndex = await fetch(new URL("/", servidor.url))
    const estadoIndex = rIndex.status
    await rIndex.arrayBuffer()

    const ASSETS = ["wokwi-bundle.js", "componentes-extra.js", "blockly_compressed.js", "blockly-es.js", "blockly/media/sprites.svg", "app.js", "pintar.js", "plan-de-pintado.js", "estado-conexion.js", "cliente-http.js", "vista-logica.js", "adaptador-blockly.js", "vista-logica-ui.js", "ruteo.js", "cableado.js"]
    const estadoAssets = {}
    for (const nombre of ASSETS) {
      const r = await fetch(new URL(`/assets/${nombre}`, servidor.url))
      estadoAssets[nombre] = r.status
      await r.arrayBuffer()
    }

    // Fixture mínimo (ESP32 + LED en GPIO4), vía la MISMA superficie que usa la
    // tool (servicio.aplicar) — ninguna de las dos GPIO usadas acá (4, 16) tiene
    // restricción (ni flash, ni strapping, ni sólo-entrada, ni uartUsb, ver
    // opencode/nucleo/placas.ts).
    let r = servicio.aplicar({ idOperacion: "pkg-op-1", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
    if (!r.ok) throw new Error(`fixture SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
    r = servicio.aplicar({ idOperacion: "pkg-op-2", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AgregarComponente", payload: { tipo: "led" } })
    if (!r.ok) throw new Error(`fixture AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
    const idComponente = servicio.snapshot().proyecto.componentes[0].id
    r = servicio.aplicar({ idOperacion: "pkg-op-3", actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO4" } })
    if (!r.ok) throw new Error(`fixture AsignarPin rechazado: ${JSON.stringify(r.motivos)}`)

    const rGet = await fetch(new URL("/api/proyecto", servidor.url))
    const snapshotAntes = await rGet.json()
    const tieneVistaAntes = Object.prototype.hasOwnProperty.call(snapshotAntes, "vista") && snapshotAntes.vista != null

    const n = snapshotAntes.revision
    const rPost = await fetch(new URL("/api/operaciones", servidor.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin },
      body: JSON.stringify({ idOperacion: "pkg-op-post", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO16" } }),
    })
    const cuerpoPost = await rPost.json()

    await servidor.cerrar()
    servicio.cerrar()
    servidor = undefined
    servicio = undefined

    // Recarga: raíz NUEVA sobre el MISMO directorio de datos — se importa
    // servicio-con-vista.ts directo (no via el Map de módulo de la tool, que
    // devolvería el mismo handle) para forzar una raíz de verdad nueva, igual que
    // tests/phase2-e2e.test.mjs.
    const modServidor = await import(urlDe(join(configDir, "servidor", "servicio-con-vista.ts")))
    const dirDatos = m.directorioDeDatos(projectDir)
    const servicio2 = modServidor.obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto: m.ID_PROYECTO_DEFAULT })
    const snapshotReload = servicio2.snapshot()
    servicio2.cerrar()

    console.log(
      JSON.stringify({
        ok: true,
        estadoIndex,
        estadoAssets,
        tieneVistaAntes,
        postOk: cuerpoPost.resultado.ok,
        revisionAntes: n,
        revisionDespuesPost: cuerpoPost.resultado.revisionActual,
        pinDespuesPost: cuerpoPost.snapshot.proyecto.componentes[0].pines.anodo,
        revisionReload: snapshotReload.revision,
        pinReload: snapshotReload.proyecto.componentes[0].pines.anodo,
      }),
    )
  } finally {
    if (servidor) await servidor.cerrar().catch(() => {})
    if (servicio) servicio.cerrar()
  }
}

async function modoServidorAusente() {
  const [projectDir] = resto
  const { ok, fallos } = await importarTodasLasTools(join(configDir, "tool"))
  let mensajeError = null
  let seLevanto = false
  try {
    const m = await import(urlDe(join(configDir, "tool", "vista-fisica.ts")))
    const { servidor, servicio } = await m.obtenerServidorVistaFisica(projectDir)
    seLevanto = true
    await servidor.cerrar().catch(() => {})
    servicio.cerrar()
  } catch (error) {
    mensajeError = error instanceof Error ? error.message : String(error)
  }
  console.log(JSON.stringify({ ok, fallos, mensajeError, seLevanto }))
}

async function modoCandadoHijo() {
  const [projectDir, idProyecto, etiqueta] = resto
  const m = await import(urlDe(join(configDir, "tool", "vista-fisica.ts")))
  const modServidor = await import(urlDe(join(configDir, "servidor", "servicio-con-vista.ts")))
  const dirDatos = m.directorioDeDatos(projectDir)

  console.log("LISTO")
  await esperarLinea() // "ABRIR"

  let servicio = null
  try {
    servicio = modServidor.obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
    console.log(JSON.stringify({ etiqueta, abrio: true }))
  } catch (error) {
    console.log(JSON.stringify({ etiqueta, abrio: false, mensaje: error instanceof Error ? error.message : String(error) }))
  }

  if (servicio) {
    await esperarLinea() // "CERRAR"
    servicio.cerrar()
  }
  process.exit(0)
}

async function main() {
  if (modo === "importar-tools") return modoImportarTools()
  if (modo === "servidor-happy") return modoServidorHappy()
  if (modo === "servidor-ausente") return modoServidorAusente()
  if (modo === "candado-hijo") return modoCandadoHijo()
  throw new Error(`modo desconocido: ${modo}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  },
)
