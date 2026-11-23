// El tool `cuenta`: el envoltorio de `opencode/plataforma/cuenta.ts`.
//
// La lógica se prueba en `plataforma-cuenta.test.mjs`. Acá se prueba sólo lo que
// agrega el envoltorio: de dónde saca las dos direcciones (producción por defecto,
// las variables sólo para pisarlas, las dos o ninguna), que con una sola no carga
// nada ni sale a la red, y que le pasa a la lógica la carpeta y las direcciones
// correctas.
//
// NINGÚN CASO DE ESTE ARCHIVO PUEDE SALIR A LA RED. Desde que las direcciones de
// producción vienen por defecto, llamar al tool sin variables es hablarle a la
// plataforma de verdad. Los casos que lo llaman así lo hacen dentro de
// `conFetchFalso`, que reemplaza el `fetch` global y anota a dónde se quiso ir.
//
// Corre bajo Node: `Bun.spawn` no existe acá, así que `abrirEnNavegador` cae en su
// `catch` y devuelve false. Eso NO prueba que el navegador se abra en OpenCode;
// prueba que, si no se abre, el docente recibe el enlace igual.

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const tool = (await import("../opencode/tool/cuenta.ts")).default
const envoltorio = await import("../opencode/tool/cuenta.ts")
const logica = await import("../opencode/plataforma/cuenta.ts")

let servidor
let base
// La web y la API con direcciones DISTINTAS (localhost y 127.0.0.1): si el envoltorio las cruzara, se nota.
let web
let pedidos = []
let carpetaXdg
const previo = {}

before(async () => {
  for (const v of ["TECNIA_PLATAFORMA_API", "TECNIA_PLATAFORMA_WEB", "XDG_CONFIG_HOME"]) previo[v] = process.env[v]
  delete process.env.TECNIA_PLATAFORMA_API
  delete process.env.TECNIA_PLATAFORMA_WEB
  carpetaXdg = mkdtempSync(join(tmpdir(), "tecnia-tool-cuenta-"))
  process.env.XDG_CONFIG_HOME = carpetaXdg
  servidor = createServer((req, res) => {
    pedidos.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`)
    res.writeHead(200, { "content-type": "application/json" })
    // Para `subir`: la cuenta tiene una memoria (versión 1) y acepta el guardado siguiente.
    if (req.url === "/memoria" && req.method === "GET") return res.end(JSON.stringify({ esquema: 1, memoria: { proyectos: ["Dado"] }, version: 1 }))
    if (req.url === "/memoria" && req.method === "PUT") return res.end(JSON.stringify({ version: 2 }))
    res.end(JSON.stringify({ cuenta: { nombre: "Ana Docente", email: "ana@escuela.test" } }))
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${servidor.address().port}`
  web = `http://localhost:${servidor.address().port}`
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  for (const [v, valor] of Object.entries(previo)) {
    if (valor === undefined) delete process.env[v]
    else process.env[v] = valor
  }
  rmSync(carpetaXdg, { recursive: true, force: true })
})

test("los nombres de las variables son los mismos que usa la lógica", () => {
  assert.equal(envoltorio.VARIABLE_API, logica.VARIABLE_API)
  assert.equal(envoltorio.VARIABLE_WEB, logica.VARIABLE_WEB)
})

/** Corre `fn` con el `fetch` global reemplazado: nada sale a la red y queda anotado a dónde se quiso ir. */
async function conFetchFalso(fn) {
  const real = globalThis.fetch
  const llamadas = []
  globalThis.fetch = async (url, init) => {
    llamadas.push(`${init?.method ?? "GET"} ${url}`)
    return new Response(JSON.stringify({ cuenta: { nombre: "Ana Docente", email: "ana@escuela.test" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  try {
    return await fn(llamadas)
  } finally {
    globalThis.fetch = real
  }
}

test("direcciones: sin variables son las de producción, y las dos pasan el filtro de la lógica", () => {
  const d = envoltorio.direccionesDe({})
  assert.deepEqual(d, {
    estado: "ok",
    api: "https://southamerica-east1-sgi-cenet-prod.cloudfunctions.net/botApi",
    web: "https://plataforma.tecnialab.net.ar",
  })
  // Si alguna no pasara `direccionSegura` (http, barra final que se recorta distinto),
  // la lógica contestaría «no disponible» en TODAS las instalaciones.
  assert.equal(logica.direccionSegura(d.api), d.api)
  assert.equal(logica.direccionSegura(d.web), d.web)
  assert.equal(d.api, envoltorio.API_POR_DEFECTO)
  assert.equal(d.web, envoltorio.WEB_POR_DEFECTO)
})

test("direcciones: con las dos variables se usan las de las variables, sin cruzarlas", () => {
  assert.deepEqual(
    envoltorio.direccionesDe({ TECNIA_PLATAFORMA_API: "http://127.0.0.1:1/api", TECNIA_PLATAFORMA_WEB: "http://localhost:2" }),
    { estado: "ok", api: "http://127.0.0.1:1/api", web: "http://localhost:2" },
  )
})

test("direcciones: con una sola variable NO se completa con la de producción", () => {
  // El caso peligroso: la API del emulador con la web de producción. El docente
  // confirmaría en la plataforma real un vínculo que se canjea contra otra máquina.
  assert.deepEqual(envoltorio.direccionesDe({ TECNIA_PLATAFORMA_API: "http://127.0.0.1:1" }), {
    estado: "a-medias",
    definida: "TECNIA_PLATAFORMA_API",
    falta: "TECNIA_PLATAFORMA_WEB",
  })
  assert.deepEqual(envoltorio.direccionesDe({ TECNIA_PLATAFORMA_WEB: "http://localhost:2" }), {
    estado: "a-medias",
    definida: "TECNIA_PLATAFORMA_WEB",
    falta: "TECNIA_PLATAFORMA_API",
  })
})

test("direcciones: una variable vacía o con sólo espacios cuenta como no definida", () => {
  assert.equal(envoltorio.direccionesDe({ TECNIA_PLATAFORMA_API: "", TECNIA_PLATAFORMA_WEB: "   " }).api, envoltorio.API_POR_DEFECTO)
  assert.equal(envoltorio.direccionesDe({ TECNIA_PLATAFORMA_API: " ", TECNIA_PLATAFORMA_WEB: "http://localhost:2" }).estado, "a-medias")
})

test("con una sola variable: dice cuál falta, en todas las acciones, y no sale a la red", async () => {
  await conFetchFalso(async (llamadas) => {
    pedidos = []
    process.env.TECNIA_PLATAFORMA_API = base
    try {
      for (const accion of ["estado", "vincular", "cerrar", "subir", "traer"]) {
        const r = await tool.execute({ accion }, {})
        assert.match(r, /mal configurado/, accion)
        assert.match(r, /falta TECNIA_PLATAFORMA_WEB/, accion)
        assert.match(r, /No hice nada/, accion)
      }
    } finally {
      delete process.env.TECNIA_PLATAFORMA_API
    }
    process.env.TECNIA_PLATAFORMA_WEB = web
    try {
      assert.match(await tool.execute({ accion: "estado" }, {}), /falta TECNIA_PLATAFORMA_API/)
    } finally {
      delete process.env.TECNIA_PLATAFORMA_WEB
    }
    assert.deepEqual(pedidos, [], "le pidió algo al servidor de prueba")
    assert.deepEqual(llamadas, [], "quiso salir a la red")
  })
})

test("sin variables está prendido: sin sesión lo dice, y no sale a la red", async () => {
  await conFetchFalso(async (llamadas) => {
    const r = await tool.execute({ accion: "estado" }, {})
    assert.match(r, /No hay ninguna cuenta de Tecnia Lab vinculada/)
    assert.deepEqual(llamadas, [])
  })
})

test("sin variables, con sesión: la confirma contra la API de PRODUCCIÓN y contra ninguna otra", async () => {
  // Es el único caso que prueba que la dirección por defecto LLEGA a la lógica: sin
  // él, `direccionesDe` podría devolver lo correcto y el envoltorio pasar otra cosa.
  const { guardarSesionLocal, rutaSesion } = await import("../opencode/plataforma/sesion-local.ts")
  const carpeta = join(carpetaXdg, "opencode")
  const token = "P".repeat(43)
  assert.equal(
    guardarSesionLocal({ token, cuenta: { nombre: "Ana Docente", email: "ana@escuela.test" }, base: envoltorio.API_POR_DEFECTO }, carpeta).estado,
    "guardada",
  )
  try {
    await conFetchFalso(async (llamadas) => {
      pedidos = []
      const r = await tool.execute({ accion: "estado" }, {})
      assert.match(r, /vinculado con la cuenta de Ana Docente/)
      assert.deepEqual(llamadas, ["GET https://southamerica-east1-sgi-cenet-prod.cloudfunctions.net/botApi/sesion"])
      assert.deepEqual(pedidos, [])
    })
  } finally {
    rmSync(rutaSesion(carpeta), { force: true })
  }
})

test("al cambiar las direcciones no sigue hablando con la anterior", async () => {
  // El envoltorio guarda una sola cuenta por proceso. El caso de arriba la creó
  // contra producción; si no la atara a sus direcciones, todo lo que sigue en este
  // archivo (que usa el servidor de prueba) le hablaría a producción.
  await conFetchFalso(async (llamadas) => {
    process.env.TECNIA_PLATAFORMA_API = base
    process.env.TECNIA_PLATAFORMA_WEB = web
    const { guardarSesionLocal, rutaSesion } = await import("../opencode/plataforma/sesion-local.ts")
    const carpeta = join(carpetaXdg, "opencode")
    guardarSesionLocal({ token: "Q".repeat(43), cuenta: { nombre: "Ana Docente", email: "ana@escuela.test" }, base }, carpeta)
    try {
      assert.match(await tool.execute({ accion: "estado" }, {}), /vinculado con la cuenta de Ana Docente/)
      assert.deepEqual(llamadas, [`GET ${base}/sesion`])
    } finally {
      rmSync(rutaSesion(carpeta), { force: true })
      delete process.env.TECNIA_PLATAFORMA_API
      delete process.env.TECNIA_PLATAFORMA_WEB
    }
  })
})

test("prendido, sin sesión guardada: lo dice y no le pide nada a la plataforma", async () => {
  pedidos = []
  process.env.TECNIA_PLATAFORMA_API = base
  process.env.TECNIA_PLATAFORMA_WEB = web
  const r = await tool.execute({ accion: "estado" }, {})
  assert.match(r, /No hay ninguna cuenta de Tecnia Lab vinculada/)
  assert.deepEqual(pedidos, [])
})

test("prendido, con sesión en la carpeta de OpenCode: la confirma contra la dirección de la variable", async () => {
  // La sesión va donde la busca `carpetaPorDefecto()`: $XDG_CONFIG_HOME/opencode.
  // Si el envoltorio le pasara otra carpeta a la lógica, acá diría «no hay cuenta».
  const { guardarSesionLocal, rutaSesion } = await import("../opencode/plataforma/sesion-local.ts")
  const carpeta = join(carpetaXdg, "opencode")
  const token = "T".repeat(43)
  assert.equal(guardarSesionLocal({ token, cuenta: { nombre: "Ana Docente", email: "ana@escuela.test" }, base }, carpeta).estado, "guardada")
  assert.ok(existsSync(rutaSesion(carpeta)))

  pedidos = []
  const r = await tool.execute({ accion: "estado" }, {})
  assert.match(r, /vinculado con la cuenta de Ana Docente \(a…@escuela\.test\)/)
  assert.deepEqual(pedidos, [`GET /sesion Bearer ${token}`])
  assert.ok(!r.includes(token), "el token salió en el mensaje")
  assert.ok(!r.includes("ana@escuela.test"), "el email entero salió en el mensaje")
})

test("subir: el envoltorio sólo manda 'reemplazar' cuando el modelo lo manda en true", async () => {
  // Sigue del caso anterior: hay una sesión guardada en la carpeta de OpenCode.
  const carpeta = join(carpetaXdg, "opencode")
  writeFileSync(join(carpeta, "tecnia-memoria.md"), "- Nivel: (sin definir)\n- Proyectos hechos: Semáforo\n- En curso: (sin definir)\n")
  const puts = () => pedidos.filter((p) => p.startsWith("PUT")).length
  pedidos = []
  assert.match(await tool.execute({ accion: "subir" }, {}), /memorias DISTINTAS/)
  assert.match(await tool.execute({ accion: "subir" }, {}), /memorias DISTINTAS/)
  assert.match(await tool.execute({ accion: "subir", reemplazar: false }, {}), /memorias DISTINTAS/)
  assert.equal(puts(), 0, "pisó la memoria de la cuenta sin que nadie pidiera reemplazar")
  assert.match(await tool.execute({ accion: "subir", reemplazar: true }, {}), /Guardé en la cuenta/)
  assert.equal(puts(), 1)
  rmSync(join(carpeta, "tecnia-memoria.md"))
})

test("en modo aula no vincula, y si no se abre el navegador no dice que lo abrió", async () => {
  const carpeta = join(carpetaXdg, "opencode")
  rmSync(join(carpeta, "tecnia-sesion.json"), { force: true })
  // Si un assert falla con el servidor de vuelta escuchando, el proceso del test
  // queda colgado en vez de ponerse rojo (pasó: tapó siete mutaciones como si
  // estuvieran en rojo, y después una más). Por eso TODO el caso va en un `try`
  // y el cierre va en `finally`.
  try {
    writeFileSync(join(carpeta, "tecnia-perfil.md"), "- Modo: aula\n")
    const aula = await tool.execute({ accion: "vincular" }, {})
    assert.match(aula, /aula/i)
    assert.ok(!aula.includes("vincular-bot"), `en modo aula dio un enlace: ${aula}`)

    writeFileSync(join(carpeta, "tecnia-perfil.md"), "- Modo: personal\n")
    const r = await tool.execute({ accion: "vincular" }, {})
    // Bajo Node no hay `Bun.spawn`: el navegador NO se abrió y el tool tiene que decirlo y dar el enlace.
    assert.ok(!/^Abrí el navegador/.test(r), `dijo que abrió el navegador sin abrirlo: ${r}`)
    assert.ok(r.includes(`${web}/vincular-bot?challenge=`), `el enlace no apunta a la web: ${r}`)
  } finally {
    await tool.execute({ accion: "cerrar" }, {})
  }
})

test("en una instalación sin la carpeta plataforma: a medias no la carga; con direcciones dice qué falta", async () => {
  // Una copia del tool SIN `../plataforma` al lado, como una instalación rota.
  // Sirve para ver el ORDEN: con la configuración a medias no llega a cargar la
  // carpeta (si la cargara, acá diría «Falta la carpeta»). Con direcciones, sean
  // las de producción o las de las variables, dice qué falta y cómo arreglarlo.
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..")
  const raiz = mkdtempSync(join(tmpdir(), "tecnia-tool-sin-plataforma-"))
  try {
    mkdirSync(join(raiz, "tool"))
    copyFileSync(join(repo, "opencode", "tool", "cuenta.ts"), join(raiz, "tool", "cuenta.ts"))
    symlinkSync(join(repo, "node_modules"), join(raiz, "node_modules"), "dir")
    const suelto = (await import(pathToFileURL(join(raiz, "tool", "cuenta.ts")).href)).default

    delete process.env.TECNIA_PLATAFORMA_WEB
    process.env.TECNIA_PLATAFORMA_API = base
    assert.match(await suelto.execute({ accion: "estado" }, {}), /mal configurado/)

    // Sin variables: las de producción. No sale a la red porque no hay con qué.
    delete process.env.TECNIA_PLATAFORMA_API
    await conFetchFalso(async (llamadas) => {
      assert.match(await suelto.execute({ accion: "estado" }, {}), /Falta la carpeta "plataforma"/)
      assert.deepEqual(llamadas, [])
    })

    process.env.TECNIA_PLATAFORMA_API = base
    process.env.TECNIA_PLATAFORMA_WEB = web
    const r = await suelto.execute({ accion: "estado" }, {})
    assert.match(r, /Falta la carpeta "plataforma"/)
    assert.match(r, /Reinstalá Tecnia Bot/)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test("los cuatro instaladores llevan plataforma/ en sus listas de carpetas", () => {
  // Estático, mismo criterio que el test 17 de codegen-s1b: lo dinámico de Linux está en
  // empaquetado-instalado, y PowerShell no corre acá. Sin este caso, sacar `plataforma`
  // de install.ps1 o de uninstall.ps1 no ponía nada rojo: en Windows el tool quedaba
  // instalado sin su carpeta, o la carpeta vacía quedaba tirada al desinstalar.
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..")
  const leer = (f) => readFileSync(join(repo, "install", f), "utf8")
  const installSh = leer("install.sh")
  assert.match(installSh, /mkdir -p "\$CONFIG_DIR"\/\{[^}]*\bplataforma\b[^}]*\}/)
  assert.match(installSh, /cp -r "\$SRC\/plataforma\/\." "\$CONFIG_DIR\/plataforma\/"/)
  assert.match(installSh, /find agent tool [^|]*\bplataforma\b[^|]* -type f/)
  assert.match(leer("uninstall.sh"), /"\$CONFIG_DIR\/plataforma"[^\n]* -type d -empty -delete/)
  const installPs1 = leer("install.ps1")
  // Dos listas en install.ps1: la de carpetas a crear y la del manifest.
  assert.equal((installPs1.match(/@\([^)]*"plataforma"[^)]*\)\)/g) ?? []).length, 2, "install.ps1: lista de carpetas y lista del manifest")
  assert.match(installPs1, /Copy-Item \(Join-Path \$Src "plataforma\\\*"\) \(Join-Path \$ConfigDir "plataforma\\"\) -Recurse -Force/)
  assert.match(leer("uninstall.ps1"), /foreach \(\$d in @\([^)]*"plataforma"[^)]*\)\) \{/)
})
