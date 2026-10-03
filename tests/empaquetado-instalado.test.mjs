// Gate de instalación aislada — D12/D13/D14, Phase 2 Slice 1 hardening (writer
// W-INSTALL). PHASE_2_SLICE_1_HARDENING_DESIGN.md §1 (tabla D12-D14) y §4 ("Gate de
// instalación aislada"): la instalación temporal va FUERA del repo, con una ruta con
// espacio y Unicode; la copia fuente queda inaccesible después de instalar y todo se
// ejecuta desde otro cwd. Fuente de los hallazgos: informe ARCH-INSTALL
// (scratchpad/hardening/ARCH-INSTALL/ARCH_INSTALL_REPORT.md), que reprodujo con
// install.sh de HEAD que NINGUNA tool queda disponible (el registry de OpenCode
// aborta el loop entero en el primer `import()` que rechaza — registry.ts:199-212).
//
// Sólo Linux: instala DE VERDAD con `bash install/install.sh`. install.ps1 tiene su
// propia cobertura real en la matriz de Windows PowerShell 5.1 de `.github/workflows/
// ci.yml` (bootstrap.ps1 de punta a punta) — correrlo acá en un runner Linux sería
// simular PowerShell, no probarlo.
//
// Qué NO hace este archivo (deliberado, mismo criterio que el resto de Phase 2): no
// toca `tests/nucleo-*` ni el worktree real; toda la instalación vive bajo
// `os.tmpdir()` (que respeta $TMPDIR — el harness del writer lo exporta al
// scratchpad de la tarea) y se borra al final.
//
// @opencode-ai/plugin NO viaja en la instalación (nunca se copia — es una dependencia
// npm, no parte de la capa educativa): en producción, OpenCode se lo instala él mismo
// a CADA config dir al arrancar (`config.ts`, `npmSvc.install(dir, {add:
// ["@opencode-ai/plugin@<version>"]})`, `registry.ts:203`, `waitForDependencies`) y
// recién ahí el registry importa las tools. Ese paso necesita red y no lo vamos a
// reproducir acá: se SIMULA con un symlink al `node_modules/@opencode-ai/plugin` de
// ESTE worktree (ya resuelto por pnpm) dentro de `<configDir>/node_modules/`, que es
// exactamente donde Node/Bun lo buscarían subiendo desde `<configDir>/tool/*.ts`
// (documentado en ARCH_INSTALL_REPORT.md §1, fila `@opencode-ai/plugin`).

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync, symlinkSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { escanearArchivo } from "../scripts/escaneo-assets-offline.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const HIJO = join(dirname(fileURLToPath(import.meta.url)), "empaquetado-instalado-hijo.mjs")

// PATH restringido — MEDIDO en ARCH_INSTALL_REPORT.md §3.1 ("Real simulation"): con
// TECNIA_SIN_PROMPT=1 y sin key pegada, install.sh no llama curl/red (sólo prueba una
// key si alguien la pegó); no instala nada global; sólo agrega PlatformIO al PATH del
// shell del USUARIO si lo encuentra DENTRO de $HOME (no pasa acá, HOME es nuevo). Un
// PATH mínimo (sin ~/.platformio, sin el PATH real de la sesión) es justamente lo que
// impide que el test dependa de -- o contamine -- lo que haya instalado en esta compu.
const PATH_RESTRINGIDO = "/usr/bin:/bin"

function listarArchivos(dir) {
  const resultado = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules") continue // symlink simulado — no es parte de lo instalado
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) resultado.push(...listarArchivos(ruta))
    else if (entrada.isFile()) resultado.push(ruta)
  }
  return resultado
}

/** Cada archivo bajo nucleo/servidor/vista-fisica tiene que ser código (.ts) o, sólo
 * dentro de vista-fisica/web/, un asset servido (.js/.html) — PHASE_2_SLICE_1_
 * HARDENING_DESIGN.md §5 del informe ARCH-INSTALL: "la instalación no contenga
 * scratchpad, docs ni tests". Devuelve la lista de infracciones (vacía si todo OK). */
function verificarAllowlist(configDir) {
  const infracciones = []
  for (const carpeta of ["nucleo", "servidor"]) {
    const base = join(configDir, carpeta)
    for (const archivo of listarArchivos(base)) {
      const rel = relative(base, archivo)
      if (!/\.ts$/.test(rel)) infracciones.push(join(carpeta, rel))
    }
  }
  const baseVista = join(configDir, "vista-fisica")
  for (const archivo of listarArchivos(baseVista)) {
    const rel = relative(baseVista, archivo)
    const esWeb = rel.startsWith(`web${sep}`) && /\.(js|html)$/.test(rel)
    const esTs = /\.ts$/.test(rel) && !rel.startsWith(`web${sep}`)
    if (!esWeb && !esTs) infracciones.push(join("vista-fisica", rel))
  }
  return infracciones
}

/** Corre `install/install.sh` DE VERDAD (spawnSync, bash real) contra una copia
 * fuente ya extraída, con HOME/XDG nuevos. Nunca toca el worktree ni la sesión real
 * del que corre el test (PATH restringido, TECNIA_SIN_PROMPT=1: no pregunta nada). */
function instalar(fuenteDir, home) {
  const xdgConfig = join(home, ".config")
  const xdgData = join(home, ".local", "share")
  const env = { HOME: home, XDG_CONFIG_HOME: xdgConfig, XDG_DATA_HOME: xdgData, PATH: PATH_RESTRINGIDO, TECNIA_SIN_PROMPT: "1" }
  const run = spawnSync("bash", [join(fuenteDir, "install", "install.sh")], {
    cwd: fuenteDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000,
  })
  return { run, configDir: join(xdgConfig, "opencode"), xdgConfig, xdgData, env }
}

/** Corre el hijo (empaquetado-instalado-hijo.mjs) en modo NO interactivo (uno que
 * imprime una única línea JSON y termina solo), en OTRO cwd — nunca el del repo ni el
 * de la instalación. */
function correrHijo(modo, args, cwd) {
  const run = spawnSync(process.execPath, [HIJO, modo, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60_000 })
  let json = null
  try {
    json = JSON.parse((run.status === 0 ? run.stdout : run.stdout || run.stderr).trim())
  } catch {
    // se deja null — el assert de abajo reporta stdout/stderr crudos para debug
  }
  return { run, json }
}

// ── Protocolo LISTO/ABRIR/CERRAR para el candado — mismo patrón que
// tests/phase2-candado-proceso.test.mjs, contra el hijo "candado-hijo". ──────────────
function lanzarCandadoHastaListo(configDir, projectDir, idProyecto, etiqueta, cwd) {
  return new Promise((resolveListo, reject) => {
    const proc = spawn(process.execPath, [HIJO, "candado-hijo", configDir, projectDir, idProyecto, etiqueta], { cwd, stdio: ["pipe", "pipe", "inherit"] })
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
}
function enviar(proc, linea) {
  proc.stdin.write(`${linea}\n`)
}
async function lanzarCandadoUnaVez(configDir, projectDir, idProyecto, etiqueta, cwd) {
  const hijo = await lanzarCandadoHastaListo(configDir, projectDir, idProyecto, etiqueta, cwd)
  enviar(hijo.proc, "ABRIR")
  const resultado = await hijo.resultado
  if (resultado.abrio) enviar(hijo.proc, "CERRAR")
  await new Promise((r) => hijo.proc.on("close", r))
  return resultado
}

if (process.platform === "win32") {
  test("gate de instalación aislada (D12-D14): Linux only, ver ci.yml para Windows", { skip: "install.sh es Bash; install.ps1 corre de punta a punta en la matriz Windows PowerShell 5.1 de .github/workflows/ci.yml (windows-latest) — no en este runner" }, () => {})
} else {
  test("gate de instalación aislada (D12-D14): estructura, imports dinámicos, ciclo de vida real, candado, offline, D13 con servidor/ ausente, y limpieza de uninstall.sh", async () => {
    // ── Setup: fuente LIMPIA (git archive HEAD, nunca el worktree sucio) bajo una
    // ruta con espacio y Unicode, FUERA del repo. ──────────────────────────────────
    const raiz = mkdtempSync(join(tmpdir(), "tb-empaquetado-"))
    const base = join(raiz, "tb inst ñandú")
    mkdirSync(base, { recursive: true })
    const fuenteDir = join(base, "repo")
    mkdirSync(fuenteDir, { recursive: true })
    const home = join(base, "home")
    mkdirSync(home, { recursive: true })
    const otroCwd = join(raiz, "otro cwd")
    mkdirSync(otroCwd, { recursive: true })

    try {
      const archivo = spawnSync("git", ["archive", "HEAD", "--", "opencode", "install", "VERSION"], { cwd: REPO, maxBuffer: 256 * 1024 * 1024 })
      assert.equal(archivo.status, 0, `git archive HEAD falló: ${archivo.stderr}`)
      const tar = spawnSync("tar", ["-x", "-C", fuenteDir], { input: archivo.stdout })
      assert.equal(tar.status, 0, `tar -x falló: ${tar.stderr}`)

      // ── Instalar DE VERDAD. ───────────────────────────────────────────────────
      const { run: runInstall, configDir } = instalar(fuenteDir, home)
      assert.equal(runInstall.status, 0, `install.sh terminó con rc=${runInstall.status}:\n${runInstall.stdout}\n${runInstall.stderr}`)

      // Simula lo que hace OpenCode al arrancar (instalarse @opencode-ai/plugin en
      // cada config dir) — ver el comentario de cabecera de este archivo.
      mkdirSync(join(configDir, "node_modules", "@opencode-ai"), { recursive: true })
      symlinkSync(join(REPO, "node_modules", "@opencode-ai", "plugin"), join(configDir, "node_modules", "@opencode-ai", "plugin"), "dir")

      // ── D12: presencia de las piezas nuevas, como carpetas HERMANAS de tool/. ──
      assert.ok(existsSync(join(configDir, "nucleo", "composicion-raiz.ts")), "falta opencode/nucleo instalado")
      assert.ok(existsSync(join(configDir, "nucleo", "adaptadores", "hash-catalogo.node.ts")), "falta nucleo/adaptadores instalado")
      assert.ok(existsSync(join(configDir, "servidor", "servicio-con-vista.ts")), "falta opencode/servidor instalado")
      assert.ok(existsSync(join(configDir, "servidor", "servidor-proyecto.ts")), "falta servidor-proyecto.ts instalado")
      assert.ok(existsSync(join(configDir, "vista-fisica", "vista-real.ts")), "falta opencode/vista-fisica instalado")
      assert.ok(existsSync(join(configDir, "vista-fisica", "web", "index.html")), "falta vista-fisica/web instalado")
      for (const asset of ["app.js", "pintar.js", "plan-de-pintado.js", "estado-conexion.js", "cliente-http.js", "vista-logica.js", "adaptador-blockly.js", "vista-logica-ui.js"]) {
        assert.ok(existsSync(join(configDir, "vista-fisica", "web", asset)), `falta vista-fisica/web/${asset}`)
      }
      assert.ok(existsSync(join(configDir, "tool", "vista-fisica.ts")), "falta el tool en sí")
      assert.ok(existsSync(join(configDir, "tecniabot-web", "wokwi-bundle.js")), "faltan los assets Wokwi (ya se instalaban antes del fix)")
      // Nunca DENTRO de tool/ — D12 lo prohíbe explícitamente (el registry las
      // levantaría como tools si tuvieran .ts en el nivel superior de tool/).
      assert.ok(!existsSync(join(configDir, "tool", "nucleo")), "nucleo/ terminó DENTRO de tool/")
      assert.ok(!existsSync(join(configDir, "tool", "servidor")), "servidor/ terminó DENTRO de tool/")
      assert.ok(!existsSync(join(configDir, "tool", "vista-fisica")), "vista-fisica/ (carpeta) terminó DENTRO de tool/")

      const agenteMd = readFileSync(join(configDir, "agent", "tecnia-bot.md"), "utf8")
      assert.match(agenteMd, /vista-fisica:\s*"allow"/, 'falta el permiso vista-fisica: "allow" en el agente instalado')

      // ── Nada de scratchpad/docs/tests en la instalación. ──────────────────────
      const infraccionesAllowlist = verificarAllowlist(configDir)
      assert.deepEqual(infraccionesAllowlist, [], `hay archivos fuera del allowlist (.ts, o .js/.html sólo en vista-fisica/web/): ${infraccionesAllowlist.join(", ")}`)
      for (const carpetaProhibida of ["tests", "docs", "scratchpad", "evidencia"]) {
        assert.ok(!existsSync(join(configDir, carpetaProhibida)), `se instaló ${carpetaProhibida}/, no debería estar en la config de OpenCode`)
      }
      const todoLoInstalado = listarArchivos(configDir)
      const conNombreDeTest = todoLoInstalado.filter((f) => /\.test\.(mjs|ts|js)$/.test(f))
      assert.deepEqual(conNombreDeTest, [], `hay archivos de test instalados: ${conNombreDeTest.join(", ")}`)

      // ── Copia fuente inaccesible + todo lo que sigue desde OTRO cwd. ──────────
      chmodSync(fuenteDir, 0o000)

      // ── Import estático de CADA tool instalado, en loop — igual que hace el
      // registry de OpenCode (registry.ts:199-212), con un fallo por archivo
      // reportado en vez de abortar al primero. Con D12 aplicado, esto tiene que
      // dar CERO fallos — es la regresión exacta que documentó ARCH_INSTALL_
      // REPORT.md §0.2: "con el install de hoy, NINGUNA tool carga". ────────────
      const nombresTool = readdirSync(join(configDir, "tool")).filter((f) => /\.(ts|js)$/.test(f))
      assert.ok(nombresTool.length >= 5, `esperaba varias tools instaladas, hay ${nombresTool.length}`)
      const { json: resultadoImport, run: runImport } = correrHijo("importar-tools", [configDir], otroCwd)
      assert.equal(runImport.status, 0, `el hijo de import falló: ${runImport.stderr}`)
      assert.ok(resultadoImport, `no pude parsear la salida del hijo de import: ${runImport.stdout} ${runImport.stderr}`)
      assert.deepEqual(resultadoImport.fallos, [], `hay tools que no importan tras instalar: ${JSON.stringify(resultadoImport.fallos)}`)
      assert.deepEqual(resultadoImport.ok.sort(), nombresTool.sort(), "el loop de import no pasó por todas las tools instaladas")

      // ── Ciclo de vida real: arrancar el servidor, servir "/" y los 6 assets,
      // snapshot con "vista", POST AsignarPin (revisión +1), cerrar, reabrir
      // (recarga) y comprobar que el GPIO persistió. ────────────────────────────
      const proyectoDir = join(raiz, "proyecto-alumno")
      mkdirSync(proyectoDir, { recursive: true })
      const { json: r, run: runHappy } = correrHijo("servidor-happy", [configDir, proyectoDir], otroCwd)
      assert.equal(runHappy.status, 0, `el ciclo de vida real falló:\n${runHappy.stdout}\n${runHappy.stderr}`)
      assert.ok(r && r.ok, `el hijo del ciclo de vida no devolvió ok: ${JSON.stringify(r)} / stderr: ${runHappy.stderr}`)
      assert.equal(r.estadoIndex, 200, "GET / no dio 200")
      for (const [nombre, estado] of Object.entries(r.estadoAssets)) {
        assert.equal(estado, 200, `GET /assets/${nombre} no dio 200`)
      }
      assert.ok(r.tieneVistaAntes, "el snapshot servido no trae 'vista'")
      assert.equal(r.postOk, true, "el POST AsignarPin no fue aceptado")
      assert.equal(r.revisionDespuesPost, r.revisionAntes + 1, "la revisión no subió +1 tras AsignarPin")
      assert.equal(r.pinDespuesPost, "GPIO16", "el GET posterior al POST no refleja el nuevo pin")
      assert.equal(r.revisionReload, r.revisionDespuesPost, "la revisión no persistió tras reabrir (recarga)")
      assert.equal(r.pinReload, "GPIO16", "el GPIO no persistió en disco tras reabrir (recarga)")

      // ── El candado se toma y se libera: dos procesos de SO reales contra el
      // MISMO directorio+idProyecto — el segundo falla mientras el primero está
      // vivo, y puede abrir de nuevo apenas el primero cierra. Mismo criterio que
      // tests/phase2-candado-proceso.test.mjs (fix H5), sobre la instalación. ────
      const proyectoCandado = join(raiz, "proyecto-candado")
      mkdirSync(proyectoCandado, { recursive: true })
      const idProyectoCandado = "activo" // ID_PROYECTO_DEFAULT en opencode/tool/vista-fisica.ts
      const hijoA = await lanzarCandadoHastaListo(configDir, proyectoCandado, idProyectoCandado, "A", otroCwd)
      enviar(hijoA.proc, "ABRIR")
      const resultadoA = await hijoA.resultado
      assert.equal(resultadoA.abrio, true, `el primer proceso no pudo tomar el candado: ${JSON.stringify(resultadoA)}`)

      const resultadoB = await lanzarCandadoUnaVez(configDir, proyectoCandado, idProyectoCandado, "B", otroCwd)
      assert.equal(resultadoB.abrio, false, "el segundo proceso pudo abrir con el candado todavía tomado por el primero")

      enviar(hijoA.proc, "CERRAR")
      await new Promise((res) => hijoA.proc.on("close", res))

      const resultadoC = await lanzarCandadoUnaVez(configDir, proyectoCandado, idProyectoCandado, "C", otroCwd)
      assert.equal(resultadoC.abrio, true, "un tercer proceso no pudo tomar el candado después de que el primero lo liberó")

      // ── Offline: index.html y los assets servidos no piden nada por red. ──────
      const archivosOffline = [
        join(configDir, "vista-fisica", "web", "index.html"),
        join(configDir, "vista-fisica", "web", "app.js"),
        join(configDir, "vista-fisica", "web", "pintar.js"),
        join(configDir, "vista-fisica", "web", "plan-de-pintado.js"),
        join(configDir, "vista-fisica", "web", "estado-conexion.js"),
        join(configDir, "vista-fisica", "web", "cliente-http.js"),
        join(configDir, "vista-fisica", "web", "vista-logica.js"),
        join(configDir, "vista-fisica", "web", "adaptador-blockly.js"),
        join(configDir, "vista-fisica", "web", "vista-logica-ui.js"),
        join(configDir, "tecniabot-web", "wokwi-bundle.js"),
        join(configDir, "tecniabot-web", "componentes-extra.js"),
      ]
      for (const archivoOffline of archivosOffline) {
        const hallazgos = escanearArchivo(archivoOffline).filter((h) => h.clasificacion === "carga-real")
        assert.deepEqual(hallazgos, [], `${archivoOffline} pide algo por red: ${JSON.stringify(hallazgos)}`)
      }

      // ── D13: con servidor/ borrado de la instalación, el RESTO de las tools
      // (incluida vista-fisica.ts, que ya no importa ../servidor/* en el
      // top-level) siguen importando, y recién al intentar levantar el servidor
      // se rechaza con un mensaje explícito, comprensible y determinista — nunca
      // un catch vacío, nunca un fallback silencioso. ──────────────────────────
      rmSync(join(configDir, "servidor"), { recursive: true, force: true })
      const { json: resultadoAusente, run: runAusente } = correrHijo("servidor-ausente", [configDir, proyectoDir], otroCwd)
      assert.equal(runAusente.status, 0, `el hijo de servidor-ausente falló: ${runAusente.stderr}`)
      assert.ok(resultadoAusente, `no pude parsear la salida: ${runAusente.stdout} ${runAusente.stderr}`)
      assert.deepEqual(resultadoAusente.fallos, [], `con servidor/ ausente, estas tools dejaron de importar (el registry entero se caería): ${JSON.stringify(resultadoAusente.fallos)}`)
      assert.ok(resultadoAusente.ok.includes("vista-fisica.ts"), "vista-fisica.ts tiene que seguir importando aunque falte servidor/ (D13: import lazy)")
      assert.equal(resultadoAusente.seLevanto, false, "el servidor se levantó igual sin servidor/ instalado — no puede pasar")
      assert.ok(resultadoAusente.mensajeError, "obtenerServidorVistaFisica no rechazó con servidor/ ausente")
      assert.match(resultadoAusente.mensajeError, /servidor/i, "el mensaje de error no nombra la pieza que falta (servidor)")
      assert.match(resultadoAusente.mensajeError, /reinstal/i, "el mensaje de error no sugiere reinstalar Tecnia Bot")

      // ── uninstall.sh limpia las carpetas nuevas (D12). ─────────────────────────
      const { xdgConfig, xdgData } = { xdgConfig: join(home, ".config"), xdgData: join(home, ".local", "share") }
      chmodSync(fuenteDir, 0o700) // hace falta leer install/uninstall.sh
      const runUninstall = spawnSync("bash", [join(fuenteDir, "install", "uninstall.sh"), "--conservar"], {
        cwd: fuenteDir,
        env: { HOME: home, XDG_CONFIG_HOME: xdgConfig, XDG_DATA_HOME: xdgData, PATH: PATH_RESTRINGIDO },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 60_000,
      })
      assert.equal(runUninstall.status, 0, `uninstall.sh terminó con rc=${runUninstall.status}:\n${runUninstall.stdout}\n${runUninstall.stderr}`)
      assert.ok(!existsSync(join(configDir, "nucleo")), "uninstall.sh dejó nucleo/ instalado")
      assert.ok(!existsSync(join(configDir, "servidor")), "uninstall.sh dejó servidor/ instalado")
      assert.ok(!existsSync(join(configDir, "vista-fisica")), "uninstall.sh dejó vista-fisica/ instalado")
    } finally {
      // Nunca deja el chmod 000 pisado: sin esto, rmSync de abajo no podría ni
      // listar fuenteDir/ para borrarlo.
      try {
        chmodSync(fuenteDir, 0o700)
      } catch {
        // ya se restauró arriba, o fuenteDir no llegó a crearse — no hay nada que hacer
      }
      rmSync(raiz, { recursive: true, force: true })
    }
  })
}
