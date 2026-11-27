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
//   programa-instalado <configDir> <projectDir>
//     — Codegen MVP Slice 1b: arma un proyecto con la tool proyecto-fisico INSTALADA y
//       pide el programa a la tool programa INSTALADA (que importa ../codegen/ de la
//       instalación). Imprime UNA línea JSON con la salida de `generar`.
//   pagina-instalada <configDir> <projectDir>
//     — la tool pagina INSTALADA busca la hoja de estilos al lado de tool/, en
//       tecniabot-web/diseno/sistema.css de la instalación, y arma una página en <projectDir>.
//       Imprime UNA línea JSON con la ruta que usó, si la leyó, la respuesta y lo que quedó en disco.
//   pagina-sin-hoja <configDir> <projectDir>
//     — con tecniabot-web/diseno/ fuera de la instalación (lo mueve el test): todas las tools
//       siguen importando (la hoja se lee al ejecutar, nunca al importar) y pagina contesta con
//       un error explícito, sin escribir nada.
//   programa-sin-codegen <configDir> <projectDir>
//     — con codegen/ fuera de la instalación (lo mueve el test): todas las tools siguen
//       importando y `programa` contesta con un error explícito (nunca un C++ de otro lado).

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
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

    // 2026-11-26: se sumó `sistema.css`, la hoja de estilos compartida que la ventana carga como
    // archivo servido. Vive en `tecniabot-web/diseno/`, una carpeta que el servidor de la vista
    // no había leído nunca: si el instalador no la llevara, el servidor no arrancaría.
    const ASSETS = ["wokwi-bundle.js", "componentes-extra.js", "blockly_compressed.js", "blockly-es.js", "blockly/media/sprites.svg", "app.js", "pintar.js", "plan-de-pintado.js", "estado-conexion.js", "cliente-http.js", "vista-logica.js", "adaptador-blockly.js", "vista-logica-ui.js", "ruteo.js", "cableado.js", "sistema.css"]
    const estadoAssets = {}
    const tipoAssets = {}
    for (const nombre of ASSETS) {
      const r = await fetch(new URL(`/assets/${nombre}`, servidor.url))
      estadoAssets[nombre] = r.status
      tipoAssets[nombre] = r.headers.get("content-type")
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
      headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin, "X-Tecnia-Token": servidor.token },
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
        tipoAssets,
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

async function modoProgramaInstalado() {
  const [projectDir] = resto
  // La carpeta derivada va a la caché del usuario: acá, a una carpeta de esta prueba (hermana del
  // proyecto, o sea FUERA de él), nunca a la caché real de quien corre la suite.
  process.env.XDG_CACHE_HOME = join(projectDir, "..", "cache-de-usuario")
  process.env.LOCALAPPDATA = process.env.XDG_CACHE_HOME
  const fisico = (await import(urlDe(join(configDir, "tool", "proyecto-fisico.ts")))).default
  const moduloPrograma = await import(urlDe(join(configDir, "tool", "programa.ts")))
  const programa = moduloPrograma.default
  const ctx = { directory: projectDir }
  const operaciones = [
    { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
    { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
    { tipo: "AgregarComponente", payload: { tipo: "led" } },
    { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
    { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO4" } },
    { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" } },
    { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
    {
      tipo: "SetComportamiento",
      payload: { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
    },
  ]
  const aplicado = JSON.parse(await fisico.execute({ accion: "aplicar", baseRevision: 0, operaciones }, ctx))
  const generado = JSON.parse(await programa.execute({ accion: "generar" }, ctx))
  const carpeta = moduloPrograma.carpetaDelPrograma(projectDir, "activo")
  const enDisco = Object.fromEntries(["platformio.ini", "src/main.cpp"].map((ruta) => [ruta, readFileSync(join(carpeta, ruta), "utf8")]))
  console.log(JSON.stringify({ aplicado: aplicado.ok, generado, enDisco, fueraDelProyecto: !moduloPrograma.programaALaVistaDelAgente(projectDir, carpeta) }))
}

/** La tool pagina escribe con Bun.write; bajo Node se lo presta fs. No se abre ningún navegador. */
function prestarBunWrite() {
  globalThis.Bun = { write: async (ruta, contenido) => writeFileSync(ruta, contenido) }
}

const ARGS_DE_PAGINA = { titulo: "Página instalada", bloques: [{ tipo: "texto", texto: "Hola desde la instalación." }] }

async function modoPaginaInstalada() {
  const [projectDir] = resto
  prestarBunWrite()
  const modulo = await import(urlDe(join(configDir, "tool", "pagina.ts")))
  const hoja = modulo.leerSistemaCss()
  const salida = await modulo.default.execute(ARGS_DE_PAGINA, { directory: projectDir })
  const archivos = readdirSync(projectDir)
  const enDisco = archivos.length === 1 ? readFileSync(join(projectDir, archivos[0]), "utf8") : ""
  console.log(JSON.stringify({ ruta: modulo.rutaDelSistemaCss(), hojaLeida: hoja.ok, css: hoja.ok ? hoja.css : null, salida, archivos, enDisco }))
}

async function modoPaginaSinHoja() {
  const [projectDir] = resto
  prestarBunWrite()
  const importadas = await importarTodasLasTools(join(configDir, "tool"))
  const pagina = (await import(urlDe(join(configDir, "tool", "pagina.ts")))).default
  const salida = await pagina.execute(ARGS_DE_PAGINA, { directory: projectDir })
  console.log(JSON.stringify({ fallosImport: importadas.fallos, importadas: importadas.ok, salida, archivos: readdirSync(projectDir) }))
}

async function modoProgramaSinCodegen() {
  const [projectDir] = resto
  const importadas = await importarTodasLasTools(join(configDir, "tool"))
  const programa = (await import(urlDe(join(configDir, "tool", "programa.ts")))).default
  const salida = JSON.parse(await programa.execute({ accion: "generar" }, { directory: projectDir }))
  console.log(JSON.stringify({ fallosImport: importadas.fallos, salida }))
}

async function main() {
  if (modo === "programa-instalado") return modoProgramaInstalado()
  if (modo === "programa-sin-codegen") return modoProgramaSinCodegen()
  if (modo === "pagina-instalada") return modoPaginaInstalada()
  if (modo === "pagina-sin-hoja") return modoPaginaSinHoja()
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
