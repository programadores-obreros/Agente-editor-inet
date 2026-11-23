// Memoria remota del docente (`opencode/plataforma/memoria-remota.ts` + `api.ts`).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// QUÉ PRUEBA Y QUÉ NO. Todo corre contra un `fetch` FALSO que responde lo que
// dice el contrato acordado con la plataforma. Prueba la lógica de este lado:
// qué pedido arma, cómo lee lo que vuelve y qué nombre le pone a cada falla.
// NO prueba que la plataforma responda así — eso se mide allá y en la integración.
//
// Cada test de falla existe porque esa falla, mal nombrada, termina en un
// «guardado» que es mentira o en una memoria pisada a ciegas.
//
// HISTORIA. La primera versión de este archivo probaba un cliente que le hablaba
// directo a Firestore. Al verificarla por mutación apareció un test hueco: el
// chequeo de «exactamente una escritura confirmada» no tenía guardián, porque
// todos los casos caían antes por otra condición. La lección quedó en el test de
// «un 200 que no confirma la versión»: cada caso de ahí rompe UNA sola condición.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { leerMemoriaRemota, guardarMemoriaRemota, borrarMemoriaRemota, deRespuesta, revisarMemoria } = await import(
  join(REPO, "opencode/plataforma/memoria-remota.ts")
)

const BASE = "http://127.0.0.1:18001/demo/region/botApi"
const TOKEN = "token-secreto-de-prueba"

/** `fetch` falso: anota cada pedido y responde lo que le digan, en orden. */
function crearFetchFalso(...respuestas) {
  const pedidos = []
  const cola = [...respuestas]
  const fetchFalso = async (url, init) => {
    pedidos.push({ url, ...init, json: init.body ? JSON.parse(init.body) : undefined })
    const r = cola.shift()
    if (!r) throw new Error("el test no esperaba otro pedido")
    if (r.lanza) throw r.lanza
    return { status: r.status, text: async () => (typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo)) }
  }
  return { fetchFalso, pedidos }
}

function deps(fetchFalso, extra = {}) {
  return { fetch: fetchFalso, base: BASE, token: async () => TOKEN, ...extra }
}

const MEMORIA = { nivel: "intermedio", proyectos: ["semáforo", "alarma con PIR"], enCurso: "riego — paso 2 de 5" }
const LEIDA = { status: 200, cuerpo: { esquema: 1, memoria: MEMORIA, version: 3 } }

// ── leer ────────────────────────────────────────────────────────────────────

test("leer: pide la memoria con el token de la sesión", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso(LEIDA)
  await leerMemoriaRemota(deps(fetchFalso))
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].method, "GET")
  assert.equal(pedidos[0].url, `${BASE}/memoria`)
  assert.deepEqual(pedidos[0].headers, { Authorization: `Bearer ${TOKEN}` })
  assert.equal(pedidos[0].body, undefined)
})

test("leer: devuelve la memoria y la versión sobre la que se va a escribir", async () => {
  const { fetchFalso } = crearFetchFalso(LEIDA)
  assert.deepEqual(await leerMemoriaRemota(deps(fetchFalso)), { estado: "ok", memoria: MEMORIA, version: 3 })
})

test("leer: sin opcionales devuelve sólo la lista", async () => {
  assert.deepEqual(deRespuesta({ esquema: 1, memoria: { proyectos: [] }, version: 1 }), {
    estado: "ok",
    memoria: { proyectos: [] },
    version: 1,
  })
})

test("leer: sólo es memoria vacía si la plataforma lo dice con su código", async () => {
  const dicho = crearFetchFalso({ status: 404, cuerpo: { error: "sin-memoria" } })
  assert.deepEqual(await leerMemoriaRemota(deps(dicho.fetchFalso)), { estado: "vacia" })

  // Un 404 de otra cosa (URL mal armada, proxy) NO es «no hay nada»: tomarlo así
  // invitaría a crear encima de una memoria que sí existe.
  const ruta = crearFetchFalso({ status: 404, cuerpo: { error: "ruta-desconocida" } })
  assert.deepEqual(await leerMemoriaRemota(deps(ruta.fetchFalso)), { estado: "error", http: 404, detalle: "ruta-desconocida" })
  const pelado = crearFetchFalso({ status: 404, cuerpo: "<html>Not Found</html>" })
  assert.deepEqual(await leerMemoriaRemota(deps(pelado.fetchFalso)), { estado: "error", http: 404, detalle: "HTTP 404" })
})

test("leer: un esquema que no es el nuestro se informa y no se interpreta", async () => {
  assert.deepEqual(deRespuesta({ esquema: 2, memoria: MEMORIA, version: 3 }), { estado: "esquema-desconocido", esquema: "2" })
})

test("leer: una respuesta que no cumple el contrato es inválida, no se rellena", async () => {
  const buena = { esquema: 1, memoria: MEMORIA, version: 3 }
  const casos = {
    "no es un objeto": [],
    "sin esquema": { ...buena, esquema: undefined },
    "sin versión": { ...buena, version: undefined },
    "versión cero": { ...buena, version: 0 },
    "versión con decimales": { ...buena, version: 1.5 },
    "versión como texto": { ...buena, version: "3" },
    "sin memoria": { ...buena, memoria: undefined },
    "sin proyectos": { ...buena, memoria: { nivel: "intermedio" } },
    "proyecto que no es texto": { ...buena, memoria: { proyectos: ["a", 7] } },
    "nivel fuera del contrato": { ...buena, memoria: { proyectos: [], nivel: "experto" } },
    "nivel que no es texto": { ...buena, memoria: { proyectos: [], nivel: 3 } },
    "en curso que no es texto": { ...buena, memoria: { proyectos: [], enCurso: true } },
  }
  for (const [nombre, json] of Object.entries(casos)) {
    assert.equal(deRespuesta(json).estado, "respuesta-invalida", nombre)
  }
})

test("leer: un 200 con cuerpo que no es JSON es respuesta inválida", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 200, cuerpo: "<html>portal de la escuela</html>" })
  assert.equal((await leerMemoriaRemota(deps(fetchFalso))).estado, "respuesta-invalida")
})

// ── guardar ─────────────────────────────────────────────────────────────────

test("guardar: manda la memoria, el esquema y la versión sobre la que escribe", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { version: 4 } })
  const r = await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3)
  assert.deepEqual(r, { estado: "guardado", version: 4 })
  assert.equal(pedidos[0].method, "PUT")
  assert.equal(pedidos[0].url, `${BASE}/memoria`)
  assert.deepEqual(pedidos[0].headers, { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" })
  assert.deepEqual(pedidos[0].json, { esquema: 1, memoria: MEMORIA, versionAnterior: 3 })
})

test("guardar: crear es escribir sobre la versión 0", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { version: 1 } })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), { proyectos: [] }, 0), { estado: "guardado", version: 1 })
  assert.deepEqual(pedidos[0].json, { esquema: 1, memoria: { proyectos: [] }, versionAnterior: 0 })
})

test("guardar: lo que no es del contrato no viaja, aunque venga en el objeto", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { version: 1 } })
  await guardarMemoriaRemota(deps(fetchFalso), { proyectos: ["a"], nombreDelAlumno: "no tiene que salir" }, 0)
  assert.deepEqual(pedidos[0].json.memoria, { proyectos: ["a"] })
})

test("guardar: un 200 que no confirma la versión nueva NO es guardado", async () => {
  // Cada caso rompe UNA sola condición (ver HISTORIA en el encabezado).
  const casos = {
    "cuerpo vacío": { status: 200, cuerpo: "" },
    "sin versión": { status: 200, cuerpo: {} },
    "la misma versión que había": { status: 200, cuerpo: { version: 3 } },
    "una versión que salta": { status: 200, cuerpo: { version: 5 } },
    "versión como texto": { status: 200, cuerpo: { version: "4" } },
  }
  for (const [nombre, respuesta] of Object.entries(casos)) {
    const { fetchFalso } = crearFetchFalso(respuesta)
    const r = await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3)
    assert.equal(r.estado, "respuesta-invalida", nombre)
  }
})

test("guardar: si otra compu escribió antes es conflicto, con la versión que hay", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 409, cuerpo: { error: "conflicto", version: 5 } })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3), { estado: "conflicto", version: 5 })
  assert.equal(pedidos.length, 1, "ante un conflicto no se reintenta solo")
})

test("guardar: un 409 que no es el del contrato no se toma por conflicto", async () => {
  const casos = [
    { status: 409, cuerpo: "<html>Conflict</html>" },
    { status: 409, cuerpo: { error: "conflicto" } },
    { status: 409, cuerpo: { error: "otra-cosa", version: 5 } },
    { status: 409, cuerpo: { error: "conflicto", version: -1 } },
  ]
  for (const respuesta of casos) {
    const { fetchFalso } = crearFetchFalso(respuesta)
    const r = await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3)
    assert.equal(r.estado, "error", JSON.stringify(respuesta))
    assert.equal(r.http, 409)
  }
})

test("guardar: lo que no entra en el contrato no se manda ni se recorta", async () => {
  const casos = [
    [{ proyectos: Array.from({ length: 9 }, (_, i) => `p${i}`) }, "proyectos"],
    [{ proyectos: ["x".repeat(201)] }, "proyectos"],
    [{ proyectos: ["a", 7] }, "proyectos"],
    [{ proyectos: [], enCurso: "x".repeat(501) }, "enCurso"],
    [{ proyectos: [], nivel: "experto" }, "nivel"],
  ]
  for (const [memoria, campo] of casos) {
    const { fetchFalso, pedidos } = crearFetchFalso()
    const r = await guardarMemoriaRemota(deps(fetchFalso), memoria, 0)
    assert.deepEqual(r, { estado: "no-cabe", campo })
    assert.equal(pedidos.length, 0, "no tiene que haber salido ningún pedido")
  }
})

test("guardar: justo en el tope entra", async () => {
  assert.equal(revisarMemoria({ proyectos: Array.from({ length: 8 }, () => "x".repeat(200)), enCurso: "x".repeat(500) }), null)
})

test("guardar: si la plataforma dice que no cabe, se informa el campo que dijo", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 422, cuerpo: { error: "no-cabe", campo: "esquema" } })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3), { estado: "no-cabe", campo: "esquema" })
  const raro = crearFetchFalso({ status: 422, cuerpo: { error: "no-cabe", campo: "inventado" } })
  assert.equal((await guardarMemoriaRemota(deps(raro.fetchFalso), MEMORIA, 3)).estado, "error")
})

test("guardar: una versión anterior que no es un entero válido no sale", async () => {
  for (const version of [-1, 1.5, Number.NaN, "3", undefined]) {
    const { fetchFalso, pedidos } = crearFetchFalso()
    const r = await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, version)
    assert.equal(r.estado, "respuesta-invalida", String(version))
    assert.equal(pedidos.length, 0)
  }
})

// ── borrar ──────────────────────────────────────────────────────────────────

test("borrar: sólo dice borrada si la plataforma lo confirmó", async () => {
  const ok = crearFetchFalso({ status: 200, cuerpo: { borrada: true } })
  assert.deepEqual(await borrarMemoriaRemota(deps(ok.fetchFalso)), { estado: "borrada" })
  assert.equal(ok.pedidos[0].method, "DELETE")
  assert.equal(ok.pedidos[0].url, `${BASE}/memoria`)

  for (const cuerpo of [{}, { borrada: false }, "ok"]) {
    const { fetchFalso } = crearFetchFalso({ status: 200, cuerpo })
    assert.equal((await borrarMemoriaRemota(deps(fetchFalso))).estado, "respuesta-invalida", JSON.stringify(cuerpo))
  }
})

// ── fallas comunes (api.ts) ─────────────────────────────────────────────────

test("un 401 es sesión inválida en las tres operaciones", async () => {
  const respuesta = { status: 401, cuerpo: { error: "sesion-invalida" } }
  const a = crearFetchFalso(respuesta)
  assert.deepEqual(await leerMemoriaRemota(deps(a.fetchFalso)), { estado: "sesion-invalida" })
  const b = crearFetchFalso(respuesta)
  assert.deepEqual(await guardarMemoriaRemota(deps(b.fetchFalso), MEMORIA, 3), { estado: "sesion-invalida" })
  const c = crearFetchFalso(respuesta)
  assert.deepEqual(await borrarMemoriaRemota(deps(c.fetchFalso)), { estado: "sesion-invalida" })
})

test("un 429 es demasiados pedidos", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 429, cuerpo: { error: "demasiados-pedidos" } })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3), { estado: "demasiados-pedidos" })
})

test("sin token no sale ningún pedido, y el error del token no se propaga", async () => {
  for (const token of [async () => "", async () => { throw new Error(`no pude leer ${TOKEN}`) }]) {
    const { fetchFalso, pedidos } = crearFetchFalso()
    assert.deepEqual(await leerMemoriaRemota(deps(fetchFalso, { token })), { estado: "sesion-invalida" })
    assert.equal(pedidos.length, 0)
  }
})

test("si la red falla es sin conexión, y el detalle no arrastra el error crudo", async () => {
  const { fetchFalso } = crearFetchFalso({ lanza: new TypeError(`fetch failed con ${TOKEN}`) })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3), { estado: "sin-conexion", detalle: "no se pudo conectar" })
})

test("si la plataforma no responde a tiempo, lo dice", async () => {
  const lento = Object.assign(new Error("timeout"), { name: "TimeoutError" })
  const { fetchFalso } = crearFetchFalso({ lanza: lento })
  assert.deepEqual(await leerMemoriaRemota(deps(fetchFalso)), { estado: "sin-conexion", detalle: "la plataforma no respondió a tiempo" })
})

test("un error informa el código de la plataforma, nunca su texto libre", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 500, cuerpo: { error: "interno", detalle: `falló con ${TOKEN}`, message: "stack…" } })
  assert.deepEqual(await leerMemoriaRemota(deps(fetchFalso)), { estado: "error", http: 500, detalle: "interno" })
  const html = crearFetchFalso({ status: 502, cuerpo: "<html>Bad Gateway del proxy de la escuela</html>" })
  assert.deepEqual(await leerMemoriaRemota(deps(html.fetchFalso)), { estado: "error", http: 502, detalle: "HTTP 502" })
})

test("un pedido mal armado de este lado se ve como error, con el código de la plataforma", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 400, cuerpo: { error: "pedido-invalido" } })
  assert.deepEqual(await guardarMemoriaRemota(deps(fetchFalso), MEMORIA, 3), { estado: "error", http: 400, detalle: "pedido-invalido" })
})
