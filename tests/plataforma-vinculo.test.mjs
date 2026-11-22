// Vínculo del bot con la cuenta del docente (`opencode/plataforma/vinculo.ts`).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// QUÉ PRUEBA Y QUÉ NO. Prueba las piezas sueltas: el intento, la URL que se abre,
// la lectura de la vuelta del navegador, el canje y las consultas de sesión,
// todo contra un `fetch` falso. NO prueba el recorrido entero: ni el servidor
// local que recibe la vuelta, ni el navegador, ni la plataforma.
//
// El vector de `challengeDe` es el del Apéndice B de RFC 7636, para no comparar
// la función contra sí misma.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { crearIntento, challengeDe, codigoParaMostrar, urlDeVinculo, leerCallback, canjearVinculo, leerSesion, cerrarSesion } = await import(
  join(REPO, "opencode/plataforma/vinculo.ts")
)

const BASE = "http://127.0.0.1:18001/demo/region/botApi"
const PLATAFORMA = "https://plataforma.tecnialab.net.ar"
const TOKEN = "token-secreto-de-prueba"
const INTENTO = { verifier: "verifier-de-prueba", challenge: challengeDe("verifier-de-prueba"), state: "state-de-prueba", codigo: "482715" }
const CUENTA = { nombre: "Marta Gómez", email: "marta@example.com" }

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

const sinSesion = (fetchFalso) => ({ fetch: fetchFalso, base: BASE })
const conSesion = (fetchFalso) => ({ fetch: fetchFalso, base: BASE, token: async () => TOKEN })

// ── el intento ──────────────────────────────────────────────────────────────

test("challengeDe da el valor del ejemplo de RFC 7636", () => {
  assert.equal(challengeDe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
})

test("un intento trae un secreto de 32 bytes, su huella y una marca de 16", () => {
  const pedidos = []
  const azar = (n) => {
    pedidos.push(n)
    return new Uint8Array(n).fill(pedidos.length)
  }
  const intento = crearIntento(azar)
  assert.deepEqual(pedidos, [32, 16, 4])
  assert.equal(intento.verifier, Buffer.alloc(32, 1).toString("base64url"))
  assert.equal(intento.state, Buffer.alloc(16, 2).toString("base64url"))
  assert.equal(intento.challenge, createHash("sha256").update(intento.verifier).digest("base64url"))
  // Lo que la página de la plataforma exige antes de mostrar el botón.
  assert.match(intento.challenge, /^[A-Za-z0-9_-]{43}$/)
  assert.match(intento.state, /^[A-Za-z0-9_-]{16,128}$/)
})

// ── el código de seis dígitos ───────────────────────────────────────────────

/** Un azar que entrega, para el código, estos números de 32 bits en orden. */
function azarConCodigos(...numeros) {
  const cola = [...numeros]
  const pedidos = []
  const azar = (n) => {
    pedidos.push(n)
    if (n !== 4) return new Uint8Array(n).fill(7)
    const b = Buffer.alloc(4)
    b.writeUInt32BE(cola.shift())
    return new Uint8Array(b)
  }
  return { azar, pedidos }
}

test("el código son seis dígitos sacados de cuatro bytes de azar", () => {
  assert.equal(crearIntento(azarConCodigos(0x03030303).azar).codigo, "529027") // 50529027 mod 1e6
  assert.equal(crearIntento(azarConCodigos(482715).azar).codigo, "482715")
  assert.equal(crearIntento(azarConCodigos(1_482_715).azar).codigo, "482715")
})

test("un código bajo se completa con ceros a la izquierda: siempre son seis", () => {
  assert.equal(crearIntento(azarConCodigos(42).azar).codigo, "000042")
  assert.equal(crearIntento(azarConCodigos(0).azar).codigo, "000000")
  assert.equal(crearIntento(azarConCodigos(3_000_000).azar).codigo, "000000")
})

test("los números del sobrante se descartan, para que ningún código salga más que otro", () => {
  // 2^32 = 4294 vueltas enteras de un millón + 967296. Sin descartar, los códigos
  // 000000 a 967295 saldrían 4295 veces y el resto 4294.
  const ultimoParejo = 4_293_999_999
  assert.equal(crearIntento(azarConCodigos(ultimoParejo).azar).codigo, "999999")

  const { azar, pedidos } = azarConCodigos(4_294_000_000, 0xffffffff, 4_294_967_295, 123_456)
  assert.equal(crearIntento(azar).codigo, "123456")
  assert.deepEqual(pedidos, [32, 16, 4, 4, 4, 4], "tiene que haber pedido azar de nuevo por cada descarte")
})

test("con el azar de verdad el código es siempre de seis dígitos", () => {
  for (let i = 0; i < 200; i++) assert.match(crearIntento().codigo, /^[0-9]{6}$/)
})

test("el código se muestra partido en dos de a tres", () => {
  assert.equal(codigoParaMostrar("482715"), "482 715")
  assert.equal(codigoParaMostrar("000042"), "000 042")
})

test("dos intentos con el azar de verdad no se repiten", () => {
  const a = crearIntento()
  const b = crearIntento()
  assert.notEqual(a.verifier, b.verifier)
  assert.notEqual(a.state, b.state)
})

test("la URL del navegador lleva la huella, el puerto y la marca, y nunca el secreto ni el código", () => {
  const url = new URL(urlDeVinculo(PLATAFORMA, INTENTO, 43117))
  assert.equal(url.origin, PLATAFORMA)
  assert.equal(url.pathname, "/vincular-bot")
  assert.deepEqual(Object.fromEntries(url.searchParams), { challenge: INTENTO.challenge, port: "43117", state: INTENTO.state })
  assert.ok(!url.toString().includes(INTENTO.verifier))
  // El enlace lo puede armar otro programa: el código sólo sirve si no va en él.
  assert.ok(!url.toString().includes(INTENTO.codigo))
})

test("un puerto que no es válido no arma URL", () => {
  for (const puerto of [0, 80, 1023, 65536, 43117.5, Number.NaN, "43117"]) {
    assert.equal(urlDeVinculo(PLATAFORMA, INTENTO, puerto), null, String(puerto))
  }
  assert.ok(urlDeVinculo(PLATAFORMA, INTENTO, 1024))
  assert.ok(urlDeVinculo(PLATAFORMA, INTENTO, 65535))
})

// ── la vuelta del navegador ─────────────────────────────────────────────────

test("la vuelta con la marca de este intento entrega el código", () => {
  assert.deepEqual(leerCallback("/callback?code=abc123&state=state-de-prueba", INTENTO), { estado: "ok", code: "abc123" })
})

test("con otra marca no se entrega ningún código, aunque venga uno", () => {
  for (const ruta of ["/callback?code=abc123&state=otra-marca-distinta", "/callback?code=abc123", "/callback?code=abc123&state=", "/callback?code=abc123&state=state-de-prueb"]) {
    assert.deepEqual(leerCallback(ruta, INTENTO), { estado: "state-distinto" }, ruta)
  }
})

test("sólo se atiende la ruta exacta de la vuelta", () => {
  for (const ruta of ["/", "/favicon.ico", "/callback/otra?code=a&state=state-de-prueba", "/Callback?code=a&state=state-de-prueba"]) {
    assert.deepEqual(leerCallback(ruta, INTENTO), { estado: "ruta-desconocida" }, ruta)
  }
})

test("la vuelta sin código lo dice", () => {
  assert.deepEqual(leerCallback("/callback?state=state-de-prueba", INTENTO), { estado: "sin-codigo" })
  assert.deepEqual(leerCallback("/callback?code=&state=state-de-prueba", INTENTO), { estado: "sin-codigo" })
})

// ── el canje ────────────────────────────────────────────────────────────────

test("el canje manda el code, el secreto y el código de seis dígitos, sin token, y devuelve la sesión", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { token: TOKEN, cuenta: CUENTA } })
  const r = await canjearVinculo(sinSesion(fetchFalso), "abc123", INTENTO, "notebook-de-marta")
  assert.deepEqual(r, { estado: "vinculado", token: TOKEN, cuenta: CUENTA })
  assert.equal(pedidos[0].method, "POST")
  assert.equal(pedidos[0].url, `${BASE}/vinculos/canje`)
  assert.deepEqual(pedidos[0].headers, { "Content-Type": "application/json" })
  assert.deepEqual(pedidos[0].json, { code: "abc123", verifier: INTENTO.verifier, codigo: "482715", etiqueta: "notebook-de-marta" })
})

test("el canje recorta la etiqueta de la compu a 80 caracteres", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { token: TOKEN, cuenta: CUENTA } })
  await canjearVinculo(sinSesion(fetchFalso), "abc123", INTENTO, "x".repeat(200))
  assert.equal(pedidos[0].json.etiqueta.length, 80)
})

test("de la cuenta sólo salen nombre y email, aunque la plataforma mande más", async () => {
  const cuenta = { ...CUENTA, dni: "12345678", cuil: "20-12345678-9" }
  const { fetchFalso } = crearFetchFalso({ status: 200, cuerpo: { token: TOKEN, cuenta } })
  const r = await canjearVinculo(sinSesion(fetchFalso), "abc123", INTENTO, "compu")
  assert.deepEqual(r.cuenta, CUENTA)
})

test("un código que no sirve da un solo resultado, sin decir por qué", async () => {
  const { fetchFalso } = crearFetchFalso({ status: 400, cuerpo: { error: "codigo-invalido" } })
  assert.deepEqual(await canjearVinculo(sinSesion(fetchFalso), "abc123", INTENTO, "compu"), { estado: "codigo-invalido" })
  // Un 400 de otra cosa no es «el código no sirve»: es un pedido mal armado.
  const otro = crearFetchFalso({ status: 400, cuerpo: { error: "pedido-invalido" } })
  assert.deepEqual(await canjearVinculo(sinSesion(otro.fetchFalso), "abc123", INTENTO, "compu"), {
    estado: "error",
    http: 400,
    detalle: "pedido-invalido",
  })
})

test("un 200 que no trae token y cuenta NO es un vínculo", async () => {
  const casos = {
    "sin token": { cuenta: CUENTA },
    "token vacío": { token: "", cuenta: CUENTA },
    "token que no es texto": { token: 12345, cuenta: CUENTA },
    "sin cuenta": { token: TOKEN },
    "cuenta sin email": { token: TOKEN, cuenta: { nombre: "Marta" } },
    "cuenta con email vacío": { token: TOKEN, cuenta: { nombre: "Marta", email: "" } },
    "cuenta sin nombre": { token: TOKEN, cuenta: { email: "marta@example.com" } },
  }
  for (const [nombre, cuerpo] of Object.entries(casos)) {
    const { fetchFalso } = crearFetchFalso({ status: 200, cuerpo })
    const r = await canjearVinculo(sinSesion(fetchFalso), "abc123", INTENTO, "compu")
    assert.equal(r.estado, "respuesta-invalida", nombre)
    assert.ok(!JSON.stringify(r).includes(TOKEN), `el token no puede salir en la falla (${nombre})`)
  }
})

test("el canje sin red es sin conexión, y con 429 demasiados pedidos", async () => {
  const red = crearFetchFalso({ lanza: new TypeError("fetch failed") })
  assert.deepEqual(await canjearVinculo(sinSesion(red.fetchFalso), "abc123", INTENTO, "compu"), {
    estado: "sin-conexion",
    detalle: "no se pudo conectar",
  })
  const tope = crearFetchFalso({ status: 429, cuerpo: { error: "demasiados-pedidos" } })
  assert.deepEqual(await canjearVinculo(sinSesion(tope.fetchFalso), "abc123", INTENTO, "compu"), { estado: "demasiados-pedidos" })
})

// ── la sesión ───────────────────────────────────────────────────────────────

test("leer la sesión pregunta a la plataforma de quién es", async () => {
  const { fetchFalso, pedidos } = crearFetchFalso({ status: 200, cuerpo: { cuenta: CUENTA } })
  assert.deepEqual(await leerSesion(conSesion(fetchFalso)), { estado: "ok", cuenta: CUENTA })
  assert.equal(pedidos[0].method, "GET")
  assert.equal(pedidos[0].url, `${BASE}/sesion`)
  assert.deepEqual(pedidos[0].headers, { Authorization: `Bearer ${TOKEN}` })
})

test("una sesión que la plataforma no reconoce es inválida, y un 200 sin cuenta no es sesión", async () => {
  const vencida = crearFetchFalso({ status: 401, cuerpo: { error: "sesion-invalida" } })
  assert.deepEqual(await leerSesion(conSesion(vencida.fetchFalso)), { estado: "sesion-invalida" })
  const rara = crearFetchFalso({ status: 200, cuerpo: { cuenta: { nombre: "Marta" } } })
  assert.equal((await leerSesion(conSesion(rara.fetchFalso))).estado, "respuesta-invalida")
})

test("cerrar sesión sólo dice cerrada si la plataforma lo confirmó", async () => {
  const ok = crearFetchFalso({ status: 200, cuerpo: { cerrada: true } })
  assert.deepEqual(await cerrarSesion(conSesion(ok.fetchFalso)), { estado: "cerrada" })
  assert.equal(ok.pedidos[0].method, "DELETE")
  assert.equal(ok.pedidos[0].url, `${BASE}/sesion`)

  for (const cuerpo of [{}, { cerrada: false }, "ok"]) {
    const { fetchFalso } = crearFetchFalso({ status: 200, cuerpo })
    assert.equal((await cerrarSesion(conSesion(fetchFalso))).estado, "respuesta-invalida", JSON.stringify(cuerpo))
  }
  // Sin conexión el token sigue vivo del otro lado: no se puede decir «cerrada».
  const red = crearFetchFalso({ lanza: new TypeError("fetch failed") })
  assert.equal((await cerrarSesion(conSesion(red.fetchFalso))).estado, "sin-conexion")
})
