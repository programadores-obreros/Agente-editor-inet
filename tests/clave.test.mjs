// El tool `clave`: cambiar la key de Google desde adentro del bot, y saber si anda.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El 8 de septiembre de 2026, en una escuela, varias
// docentes se quedaron sin cuota de Google, intentaron cambiar la key —incluso con
// keys de otras cuentas— y siguieron viendo el mismo error. Las keys nuevas nunca
// entraron: `install/install.ps1` sólo pregunta por la key adentro de
// `elseif (-not $tieneGoogle)`, así que en una compu que ya tiene una guardada
// «Reparar» nunca ofrece cambiarla. Y aparte, la key jamás se validaba: con la key
// literal `AIzaSyFALSA000…` el instalador imprimía «Modelo configurado: Gemini, con
// tu key de Google». Está todo en `docs/key-de-google.md`.
//
// Lo que se custodia acá es lo que no puede volver a pasar en silencio:
//
//   1. que la key aparezca en el chat (entera o en pedazos) — se copia y se pega
//      en un mail o en un WhatsApp;
//   2. que un "no pude probarla" se cuente como "anda" — el OK falso que este tool
//      vino a arreglar;
//   3. que la key compartida vieja (rotada) vuelva a entrar;
//   4. que guardar la key pise los otros providers del docente;
//   5. que el archivo se escriba con BOM — el bug que dejaba máquinas muertas para
//      siempre, porque PowerShell lo saca al leer y OpenCode no;
//   6. que guardar una key no cambie el modelo del agente (y entonces no cambie
//      nada visible).
//
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-clave-test")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const fuente = leer("opencode/tool/clave.ts")
const comando = leer("opencode/command/clave.md")
/**
 * El mismo texto con los saltos de línea colapsados. El .md va cortado a 80
 * columnas: una frase que cruza dos líneas no tiene que hacer fallar una regla
 * por el formato (ni pasar por casualidad si alguien reordena los renglones).
 */
const comandoPlano = comando.replace(/\s+/g, " ")
const ps1 = leer("install/install.ps1")

/**
 * La key de prueba. NO tiene forma de key de Google a propósito: `tests/modelo.test.mjs`
 * barre el árbol entero buscando algo con forma de key (`AQ.` + base64url) y un
 * literal así acá lo pondría rojo, con razón. Lo que importa para estos tests es
 * que sea un string distintivo e imposible de confundir con otra cosa del texto.
 */
const KEY = "CLAVE-DE-PRUEBA-TECNIA-NO-REAL-987654321"
const OTRA_KEY = "CLAVE-DE-PRUEBA-TECNIA-SEGUNDA-123456789"

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex")

let mod // el tool tal cual está en el repo
let modHashMutado // idéntico, pero con el hash de la key vieja apuntando a KEY

let dataDir
let cfgDir
let llamadasAGoogle

// --- Respuestas de Google, las cuatro que el tool tiene que distinguir ---------
const respuestas = {
  anda: () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }),
  cuota: () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted" } }),
  }),
  invalida: () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: { status: "INVALID_ARGUMENT", message: "API key not valid", details: [{ reason: "API_KEY_INVALID" }] },
    }),
  }),
  caido: () => ({ ok: false, status: 503, json: async () => ({ error: { status: "UNAVAILABLE" } }) }),
  // Google retiró o renombró el modelo. La key puede estar perfecta.
  modeloIdo: () => ({
    ok: false,
    status: 404,
    json: async () => ({
      error: { status: "NOT_FOUND", message: "models/gemini-3.5-flash-lite is not found for API version v1beta" },
    }),
  }),
}

/** Google contesta lo que diga `tipo`; "corta" simula la red que no llega. */
function googleContesta(tipo) {
  globalThis.fetch = async (_url, opts = {}) => {
    llamadasAGoogle.push({ url: _url, opts })
    if (tipo === "corta") {
      const e = new Error("no debería imprimirse nunca: " + KEY)
      e.name = "TimeoutError"
      throw e
    }
    return respuestas[tipo]()
  }
}

// --- auth.json / opencode.json de mentira -------------------------------------
const authPath = () => join(dataDir, "opencode", "auth.json")
const configPath = () => join(cfgDir, "opencode", "opencode.json")

/** Escribe auth.json con el contenido dado. Con `bom: true`, con BOM (el bug). */
function escribirAuth(objOTexto, bom = false) {
  const texto = typeof objOTexto === "string" ? objOTexto : JSON.stringify(objOTexto, null, 2)
  mkdirSync(dirname(authPath()), { recursive: true })
  writeFileSync(authPath(), (bom ? "﻿" : "") + texto, "utf8")
}
function escribirConfig(obj) {
  mkdirSync(dirname(configPath()), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(obj, null, 2), "utf8")
}
const authBytes = () => readFileSync(authPath())
const authJson = () => JSON.parse(authBytes().toString("utf8").replace(/^﻿/, ""))
const configJson = () => JSON.parse(readFileSync(configPath(), "utf8"))
const tieneBom = (buf) => buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = fuente
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "clave.ts"), src)

  /*
   * LA COPIA CON EL HASH MUTADO, Y POR QUÉ HACE FALTA.
   *
   * La key compartida vieja se reconoce por su SHA-256 y el literal NO vuelve a
   * este repo (hay un test que barre el árbol entero buscándolo). SHA-256 no se
   * invierte: no hay forma de fabricar un string que hashee a ese valor, así que
   * la rama del rechazo no se puede ejercitar con la key de verdad.
   *
   * Entonces se ejercita con una copia del MISMO código donde el hash esperado es
   * el de KEY. Se prueba el comportamiento real —rechaza, no escribe nada, ni
   * siquiera le pregunta a Google— sin necesidad de la key rotada. Que el hash del
   * repo sea el que corresponde lo verifica aparte el test que lo compara contra
   * install.ps1.
   */
  writeFileSync(join(OUT, "clave-hash-mutado.ts"), src.replace(HASH_DEL_REPO(), sha256(KEY)))

  mod = (await import(join(OUT, "clave.ts"))).default
  modHashMutado = (await import(join(OUT, "clave-hash-mutado.ts"))).default
})

/** El hash de la key vieja tal cual está escrito hoy en el tool. */
function HASH_DEL_REPO() {
  const m = fuente.match(/export const HASH_KEY_VIEJA = "([0-9a-f]{64})"/)
  assert.ok(m, "clave.ts ya no declara HASH_KEY_VIEJA: sin eso no reconoce la key vieja")
  return m[1]
}

beforeEach(() => {
  // Un HOME de mentira nuevo para cada test: nada se arrastra de uno a otro.
  const base = join(OUT, "caso-" + Math.random().toString(36).slice(2))
  dataDir = join(base, "data")
  cfgDir = join(base, "cfg")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cfgDir, { recursive: true })
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = cfgDir
  process.env.TECNIA_CLAVE_TIMEOUT_MS = "500"
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  llamadasAGoogle = []
  // El tool sólo toca la variable de entorno en Windows (spawn de PowerShell).
  // Estos tests corren en Linux, pero el stub queda por si alguien los corre en
  // Windows: que no intente lanzar un proceso de verdad.
  globalThis.Bun = {
    spawn: () => ({ exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body }),
  }
  escribirConfig({ $schema: "https://opencode.ai/config.json", default_agent: "tecnia-bot" })
})

// ---------------------------------------------------------------------------
// 1. La key NUNCA aparece en la salida. En ningún camino.
// ---------------------------------------------------------------------------

test("la key no aparece en NINGUNA salida del tool (los ocho caminos)", async () => {
  /*
   * Cada escenario devuelve el texto que vería la docente. La lista se recorre
   * entera y después se AFIRMA SU LARGO.
   *
   * Ese assert del largo no es decorativo: hoy en este repo un test recolectaba
   * los `return` de un tool con el regex /return `Tenés[^`]*`/g —o sea, sólo los
   * que empiezan con la palabra "Tenés"— y revisaba 6 de 9 quedando en verde. Un
   * test que da falsa cobertura es peor que no tenerlo: si mañana alguien borra un
   * escenario de esta lista, el conteo lo agarra.
   */
  const escenarios = [
    ["guardar, y Google dice que anda", async () => (googleContesta("anda"), mod.execute({ accion: "guardar", clave: KEY }, {}))],
    ["guardar, con la cuota agotada", async () => (googleContesta("cuota"), mod.execute({ accion: "guardar", clave: KEY }, {}))],
    ["guardar, con la key rechazada", async () => (googleContesta("invalida"), mod.execute({ accion: "guardar", clave: KEY }, {}))],
    ["guardar, sin poder llegar a Google", async () => (googleContesta("corta"), mod.execute({ accion: "guardar", clave: KEY }, {}))],
    [
      "guardar la key vieja compartida",
      async () => (googleContesta("anda"), modHashMutado.execute({ accion: "guardar", clave: KEY }, {})),
    ],
    [
      "estado, con una key guardada que anda",
      async () => {
        escribirAuth({ google: { type: "api", key: KEY } })
        googleContesta("anda")
        return mod.execute({}, {})
      },
    ],
    [
      "estado, con la cuota agotada",
      async () => {
        escribirAuth({ google: { type: "api", key: KEY } })
        googleContesta("cuota")
        return mod.execute({ accion: "estado" }, {})
      },
    ],
    [
      "estado, sin poder llegar a Google",
      async () => {
        escribirAuth({ google: { type: "api", key: KEY } })
        googleContesta("corta")
        return mod.execute({ accion: "estado" }, {})
      },
    ],
  ]
  assert.equal(escenarios.length, 8, "cambió la cantidad de caminos cubiertos: revisá que no se haya borrado uno")

  for (const [nombre, correr] of escenarios) {
    const r = await correr()
    assert.equal(typeof r, "string", `${nombre}: el tool no devolvió texto`)
    assert.ok(!r.includes(KEY), `${nombre}: LA KEY APARECE EN LA RESPUESTA`)
    // Ni un pedazo: doce caracteres de una key ya alcanzan para reconocerla.
    assert.ok(!r.includes(KEY.slice(0, 12)), `${nombre}: aparece un FRAGMENTO de la key`)
    assert.ok(!/\b40 caracteres\b|longitud/i.test(r), `${nombre}: cuenta la longitud de la key`)
  }
})

test("ningún texto del tool interpola la key: la regla vale también para el código nuevo", () => {
  // Los tests de arriba prueban los caminos que existen HOY. Esto cubre los que
  // alguien agregue mañana: si un template literal interpola la clave, salta acá.
  const templates = [...fuente.matchAll(/`(?:\\.|[^`\\])*`/g)].map((m) => m[0])
  assert.ok(templates.length >= 15, `esperaba varios templates en clave.ts, encontré ${templates.length}`)

  // Se mira cada interpolación por separado, y lo que se busca es que el VALOR de
  // la key entre al texto: `${clave}`, `${args.clave}`, `${clave.slice(0, 4)}`,
  // `${clave.length}`. Una comparación (`${clave === null ? "a" : "b"}`) elige
  // entre dos textos fijos y no lleva nada adentro: se descuenta antes de mirar.
  const interpolaciones = templates.flatMap((t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]))
  assert.ok(interpolaciones.length >= 10, `esperaba varias interpolaciones, encontré ${interpolaciones.length}`)
  const culpables = interpolaciones
    .filter((e) => !/^[A-Z_]+$/.test(e.trim())) // constantes en mayúsculas: son nombres, no valores
    .filter((e) => {
      // Los textos fijos de adentro (las dos ramas de un ternario, por ejemplo)
      // no son valores: si no se sacaran, la palabra "key" ESCRITA en el mensaje
      // daría un falso positivo y el test dejaría de significar algo.
      const sinTextos = e.replace(/"[^"]*"|'[^']*'/g, '""')
      const sinComparaciones = sinTextos.replace(/\b(args\.)?(clave|key)\s*(===|!==|==|!=)\s*(null|"")/gi, "")
      return /\b(clave|key)\b/i.test(sinComparaciones)
    })
  assert.deepEqual(culpables, [], "estas interpolaciones se llevan la key al texto:\n" + culpables.join("\n"))
})

// ---------------------------------------------------------------------------
// 2. "No pude probarla" NUNCA es "anda".
// ---------------------------------------------------------------------------

test("si no se pudo probar la key, no se guarda nada y no se dice que anda", async () => {
  escribirAuth({ anthropic: { type: "api", key: "otra-cosa" } })
  const antes = authBytes()
  googleContesta("corta")

  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})

  assert.match(r, /no pude probar/i, "tiene que decir que NO pudo probarla")
  // El "la guardé" se mira con lookbehind: el texto correcto dice "no la guardé".
  assert.doesNotMatch(r, /respondió bien|anda bien|quedó guardada|(?<!no )la guardé/i, "se está reportando como éxito")
  assert.match(r, /no la guardé/i, "no dice que NO la guardó")
  assert.deepEqual(authBytes(), antes, "tocó auth.json después de no poder verificar")
  assert.equal(configJson().agent, undefined, "cambió el modelo del agente sin haber verificado la key")
})

test("un 503 de Google es «no pude probarla», no «la key no sirve»", async () => {
  // Un 500/503 es de ellos, no de la docente. Tratarlo como key inválida la manda
  // a sacar una key nueva por un problema que se arregla solo en diez minutos.
  escribirAuth({})
  googleContesta("caido")
  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.match(r, /no pude probar/i)
  assert.doesNotMatch(r, /rechaz|no es una key válida/i, "acusa a la key de un problema del servidor")
  assert.equal(authJson().google, undefined, "guardó una key que no pudo probar")
})

test("estado tampoco afirma que la key anda cuando no la pudo probar", async () => {
  escribirAuth({ google: { type: "api", key: KEY } })
  googleContesta("corta")
  const r = await mod.execute({ accion: "estado" }, {})
  assert.match(r, /no pude probarla/i)
  assert.doesNotMatch(r, /anda bien/i, "dice que anda sin haberla podido probar")
})

test("la cuota agotada se cuenta como cuota, con las tres salidas y lo del PROYECTO", async () => {
  escribirAuth({ google: { type: "api", key: KEY } })
  googleContesta("cuota")
  const r = await mod.execute({ accion: "estado" }, {})
  assert.match(r, /cuota/i, "no nombra la cuota")
  assert.match(r, /no rompiste nada|no se rompió nada/i, "no la tranquiliza: la docente cree que rompió algo")
  assert.match(r, /por PROYECTO, no por key/i, "no explica que la cuota gratuita es por proyecto")
  assert.match(r, /Big Pickle/, "no ofrece seguir sin key con el modelo gratuito")
  assert.match(r, /aistudio\.google\.com\/apikey/, "no dice dónde sacar una key de otro proyecto")
})

// EL 404 NO PUEDE CAER EN "no pude probarla".
//
// Ese cajón le dice a la docente "suele ser la red: sin internet, o el filtro de
// la escuela bloqueando a Google". Si Google retira el modelo, la red anda
// perfecto —contestó Google— y ese texto la manda a pelearse con el proxy por un
// problema que está del otro lado. Peor: con el modelo caído el bot entero está
// roto, y ninguna key nueva lo arregla.
test("si Google retiró el modelo, no se culpa a la red ni a la key", async () => {
  escribirAuth({ google: { type: "api", key: KEY } })
  googleContesta("modeloIdo")
  const r = await mod.execute({ accion: "estado" }, {})
  assert.doesNotMatch(r, /suele ser la red|sin internet|filtro de/i, "culpa a la red cuando fue Google el que contestó")
  assert.doesNotMatch(r, /no pude probarla/i, "lo manda al cajón de 'no pude probarla'")
  assert.match(r, /la key no es el problema/i, "no descarta la key: la docente va a probar keys nuevas al pedo")
  assert.match(r, /modelo/i, "no nombra al modelo, que es la causa")
  assert.match(r, /\/actualizar/, "no dice la única salida real: actualizar Tecnia Bot")
  assert.match(r, /Big Pickle/, "no ofrece seguir trabajando mientras tanto")
})

test("con el modelo retirado tampoco se guarda la key nueva", async () => {
  escribirAuth({ google: { type: "api", key: OTRA_KEY } })
  googleContesta("modeloIdo")
  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.equal(authJson().google.key, OTRA_KEY, "guardó una key que nunca pudo probar contra el modelo")
  assert.doesNotMatch(r, /suele ser la red|sin internet/i, "culpa a la red")
  assert.match(r, /\/actualizar/, "no dice la salida real")
})

test("una key rechazada por Google no se guarda", async () => {
  escribirAuth({ google: { type: "api", key: OTRA_KEY } })
  googleContesta("invalida")
  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.match(r, /rechaz/i)
  assert.equal(authJson().google.key, OTRA_KEY, "pisó la key que ya estaba con una que Google rechazó")
})

// ---------------------------------------------------------------------------
// 3. La key compartida vieja, reconocida por su SHA-256.
// ---------------------------------------------------------------------------

test("el tool usa EL MISMO hash de la key vieja que install.ps1", () => {
  // Si los dos calcularan distinto, la key muerta pasaría por alguno de los dos.
  const enPs1 = ps1.match(/\$HashKeyVieja\s*=\s*"([0-9a-f]{64})"/)
  assert.ok(enPs1, "install.ps1 ya no declara $HashKeyVieja")
  assert.equal(HASH_DEL_REPO(), enPs1[1], "el hash de clave.ts no es el de install.ps1")
})

test("el SHA-256 del tool es el de verdad (vector conocido) y no marca cualquier cosa", async () => {
  const { sha256Hex, esKeyVieja } = await import(join(OUT, "clave.ts"))
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  assert.equal(esKeyVieja(KEY), false, "marca como vieja una key cualquiera")
  assert.equal(esKeyVieja(""), false, "una key vacía no es la key vieja")
})

test("la key vieja compartida se rechaza: no se guarda, y ni se le pregunta a Google", async () => {
  escribirAuth({ anthropic: { type: "api", key: "otra-cosa" } })
  const antes = authBytes()
  googleContesta("anda")

  const r = await modHashMutado.execute({ accion: "guardar", clave: KEY }, {})

  assert.match(r, /respaldo compartida/i, "no explica por qué no se guarda")
  assert.match(r, /0\.3\.75/, "no dice desde qué versión ya no existe")
  assert.deepEqual(authBytes(), antes, "guardó la key vieja")
  assert.equal(llamadasAGoogle.length, 0, "le preguntó a Google por una key que ya sabe que está muerta")
})

test("si la key vieja es la que YA está guardada, estado lo dice y no la da por buena", async () => {
  escribirAuth({ google: { type: "api", key: KEY } })
  googleContesta("anda")
  const r = await modHashMutado.execute({ accion: "estado" }, {})
  assert.match(r, /respaldo compartida/i)
  assert.doesNotMatch(r, /anda bien/i, "da por buena la key rotada")
  assert.equal(llamadasAGoogle.length, 0, "gasta una llamada en una key muerta")
})

// ---------------------------------------------------------------------------
// 4. Los otros providers se preservan.
// ---------------------------------------------------------------------------

test("guardar la key NO pisa los otros providers de auth.json", async () => {
  escribirAuth({
    anthropic: { type: "api", key: "credencial-de-otro-servicio" },
    opencode: { type: "oauth", refresh: "token-del-docente" },
    google: { type: "api", key: OTRA_KEY },
  })
  googleContesta("anda")

  await mod.execute({ accion: "guardar", clave: KEY }, {})

  const auth = authJson()
  assert.equal(auth.anthropic.key, "credencial-de-otro-servicio", "borró la credencial de otro servicio")
  assert.equal(auth.opencode.refresh, "token-del-docente", "borró el token de OpenCode")
  assert.equal(auth.google.key, KEY, "no guardó la key nueva")
  assert.equal(auth.google.type, "api", "no escribió el bloque google como lo escribe el instalador")
})

test("quitar la key deja los otros providers intactos", async () => {
  escribirAuth({
    anthropic: { type: "api", key: "credencial-de-otro-servicio" },
    google: { type: "api", key: OTRA_KEY },
  })
  await mod.execute({ accion: "quitar" }, {})
  const auth = authJson()
  assert.equal(auth.google, undefined, "no quitó la key de Google")
  assert.equal(auth.anthropic.key, "credencial-de-otro-servicio", "se llevó puesto otro provider")
})

test("guardar sin clave no borra la que ya está: para eso está `quitar`", async () => {
  // Un modelo que llama al tool antes de que la docente conteste no puede dejarla
  // sin la key que tenía funcionando.
  escribirAuth({ google: { type: "api", key: OTRA_KEY } })
  const r = await mod.execute({ accion: "guardar", clave: "   " }, {})
  assert.match(r, /No toqué nada/i)
  assert.equal(authJson().google.key, OTRA_KEY, "borró la key con un `guardar` vacío")
  assert.equal(llamadasAGoogle.length, 0)
})

// ---------------------------------------------------------------------------
// 5. Sin BOM. Y si venía con BOM, se lo saca.
// ---------------------------------------------------------------------------

test("auth.json se escribe SIN BOM", async () => {
  escribirAuth({})
  googleContesta("anda")
  await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.equal(tieneBom(authBytes()), false, "escribió auth.json con BOM: OpenCode no va a poder leerlo")
})

test("un auth.json que YA tenía BOM se cura al escribir, sin perder nada", async () => {
  // El bug que dejaba máquinas muertas para siempre: PowerShell saca el BOM al
  // leer (ve una key perfecta) y OpenCode no (rechaza el archivo entero y se traga
  // el error). Si acá arrastráramos el BOM, la key nueva entraría a un archivo que
  // OpenCode sigue sin poder leer.
  escribirAuth({ anthropic: { type: "api", key: "credencial-de-otro-servicio" } }, true)
  assert.equal(tieneBom(authBytes()), true, "el test no preparó bien el caso")
  googleContesta("anda")

  await mod.execute({ accion: "guardar", clave: KEY }, {})

  assert.equal(tieneBom(authBytes()), false, "el BOM sobrevivió a la escritura")
  const auth = authJson()
  assert.equal(auth.google.key, KEY)
  assert.equal(auth.anthropic.key, "credencial-de-otro-servicio", "curó el BOM perdiendo el contenido")
})

test("un auth.json con BOM se puede LEER (no se reporta como ilegible)", async () => {
  escribirAuth({ google: { type: "api", key: KEY } }, true)
  googleContesta("anda")
  const r = await mod.execute({ accion: "estado" }, {})
  assert.match(r, /key de Google guardada/i, "no reconoció la key de un archivo con BOM")
  assert.doesNotMatch(r, /no puedo leerlo/i)
})

test("un auth.json que no parsea NO se pisa: se explica y se deja intacto", async () => {
  escribirAuth("{ esto no es json")
  const antes = authBytes()
  const estado = await mod.execute({ accion: "estado" }, {})
  assert.match(estado, /no puedo leerlo/i)
  assert.match(estado, /Diagnostico de Tecnia Bot/, "no manda al reporte que sí sabe decir por qué no parsea")

  googleContesta("anda")
  const guardado = await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.match(guardado, /no puedo leerlo/i)
  assert.deepEqual(authBytes(), antes, "pisó a ciegas un auth.json que no pudo leer")
})

// ---------------------------------------------------------------------------
// 6. El modelo del agente, en los dos sentidos.
// ---------------------------------------------------------------------------

test("con key el agente pasa a Gemini; sin key, a Big Pickle — preservando la config", async () => {
  escribirConfig({
    $schema: "https://opencode.ai/config.json",
    default_agent: "tecnia-bot",
    autoupdate: false,
    agent: { "otro-agente": { model: "algo/que-el-docente-puso" } },
    instructions: ["/home/docente/perfil.md"],
  })
  escribirAuth({})
  googleContesta("anda")

  await mod.execute({ accion: "guardar", clave: KEY }, {})
  let cfg = configJson()
  assert.equal(cfg.agent["tecnia-bot"].model, "google/gemini-3.5-flash-lite", "no pasó el agente a Gemini")
  assert.equal(cfg.agent["otro-agente"].model, "algo/que-el-docente-puso", "borró otro agente del docente")
  assert.equal(cfg.default_agent, "tecnia-bot", "se llevó puesta la config de OpenCode")
  assert.deepEqual(cfg.instructions, ["/home/docente/perfil.md"], "borró las instructions")
  assert.equal(cfg.autoupdate, false)

  await mod.execute({ accion: "quitar" }, {})
  cfg = configJson()
  assert.equal(cfg.agent["tecnia-bot"].model, "opencode/big-pickle", "sin key el agente tiene que quedar en Big Pickle")
  assert.equal(cfg.agent["otro-agente"].model, "algo/que-el-docente-puso")
})

test("los modelos del tool son los MISMOS que los de install.ps1", () => {
  // Si se cambian allá y no acá, guardar la key desde el bot dejaría al agente en
  // un modelo distinto del que elige el instalador en la corrida siguiente, y el
  // docente vería el producto cambiar de modelo solo.
  const conKey = ps1.match(/\$ModeloConKey\s*=\s*"([^"]+)"/)
  const sinKey = ps1.match(/\$ModeloSinKey\s*=\s*"([^"]+)"/)
  assert.ok(conKey && sinKey, "install.ps1 ya no declara los modelos")
  assert.ok(fuente.includes(`const MODELO_CON_KEY = "${conKey[1]}"`), `clave.ts no usa ${conKey[1]}`)
  assert.ok(fuente.includes(`const MODELO_SIN_KEY = "${sinKey[1]}"`), `clave.ts no usa ${sinKey[1]}`)
})

test("quitar avisa lo de Big Pickle: gratis por tiempo limitado y el chat puede usarse", async () => {
  // Este producto lo usan menores. Lo mismo que dice el instalador en pantalla.
  escribirAuth({ google: { type: "api", key: OTRA_KEY } })
  const r = await mod.execute({ accion: "quitar" }, {})
  assert.match(r, /tiempo limitado/, "no avisa que Big Pickle es gratis por tiempo limitado")
  assert.match(r, /mejorar el modelo/, "no avisa que el chat puede usarse para mejorar el modelo")
  assert.match(r, /datos personales|nombres de alumnos/i, "no advierte sobre los datos de los chicos")
})

test("si opencode.json no parsea, se dice que el modelo NO cambió (y no se pisa el archivo)", async () => {
  mkdirSync(dirname(configPath()), { recursive: true })
  writeFileSync(configPath(), "{ // un comentario que Node no parsea\n  }", "utf8")
  const antes = readFileSync(configPath())
  escribirAuth({})
  googleContesta("anda")

  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})

  assert.match(r, /modelo del agente NO cambió/i, "deja creer que el cambio quedó completo")
  assert.deepEqual(readFileSync(configPath()), antes, "pisó una config que no pudo leer")
  assert.equal(authJson().google.key, KEY, "la key sí tenía que quedar guardada")
})

test("guardar bien cuenta las tres cosas: probada, guardada y reiniciar", async () => {
  escribirAuth({})
  googleContesta("anda")
  const r = await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.match(r, /respondió bien/i, "no cuenta que la probó contra Google")
  assert.match(r, /google\/gemini/i, "no dice con qué modelo quedó")
  assert.match(r, /volvé a abrir Tecnia Bot/i, "no avisa que hay que reiniciar")
})

test("la key viaja en el header, no en la URL (una URL termina adentro de los errores)", async () => {
  escribirAuth({})
  googleContesta("anda")
  await mod.execute({ accion: "guardar", clave: KEY }, {})
  assert.equal(llamadasAGoogle.length, 1, "esperaba UNA sola llamada de prueba")
  const { url, opts } = llamadasAGoogle[0]
  assert.ok(!String(url).includes(KEY), "la key va en el query string: se filtra en cualquier mensaje de error")
  assert.equal(opts.headers["x-goog-api-key"], KEY, "la key no viaja en el header de Google")
  assert.ok(opts.signal, "sin AbortSignal el chat se cuelga esperando a Google")
})

// ---------------------------------------------------------------------------
// 7. El comando /clave.
// ---------------------------------------------------------------------------

test("clave.md tiene frontmatter con description, en español", () => {
  const fm = comando.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  assert.ok(fm, "clave.md no tiene frontmatter")
  assert.match(fm[1], /^description:\s*\S+/m, "clave.md no declara description")
  assert.doesNotMatch(comando, /\bkey de Google\b.*\bAPI key\b.*obligatori/i)
})

test("clave.md lleva la guarda del OK falso", () => {
  assert.match(comandoPlano, /Contá lo que dice el tool, no lo que suponés/i, "falta la guarda del OK falso")
  assert.match(comandoPlano, /«?No pude probarla»? NO es «?anda»?/i, "no dice que «no pude probarla» no es «anda»")
  assert.match(comandoPlano, /Nunca digas que la key quedó guardada.*si el tool no lo dijo/is)
})

test("clave.md le prohíbe al modelo repetir la key en el chat", () => {
  assert.match(comandoPlano, /NUNCA repitas la key/i, "no prohíbe repetir la key")
  assert.match(comandoPlano, /Ni entera, ni un pedazo/i, "no prohíbe repetirla parcialmente")
  assert.match(comandoPlano, /cuando te la acaban de pegar/i, "no cubre el caso de confirmarla al recibirla")
})

test("clave.md explica la cuota por proyecto y la salida de Big Pickle", () => {
  assert.match(comandoPlano, /por proyecto, no por key/i, "no explica lo de la cuota por proyecto")
  assert.match(comandoPlano, /Big Pickle/, "no ofrece el modelo gratuito")
  assert.match(comandoPlano, /mejorar el modelo/, "no avisa lo de los datos con Big Pickle")
  assert.match(comandoPlano, /accion: "quitar"/, "no dice cómo dejar la compu sin key")
})
