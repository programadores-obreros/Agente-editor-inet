// Sesión local y servidor de vuelta (`opencode/plataforma/sesion-local.ts` y
// `servidor-vuelta.ts`).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// QUÉ PRUEBA Y QUÉ NO. La sesión local se prueba contra disco real, en una
// carpeta temporal propia de cada corrida (`mkdtempSync`, no una ruta fija: así
// no choca con otra suite que corra a la vez). El servidor de vuelta se prueba
// hablándole con `fetch` al puerto real. NO prueba un navegador viniendo desde la
// plataforma, ni el permiso del archivo en Windows.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { leerSesionGuardada, guardarSesionLocal, borrarSesionGuardada, rutaSesion, carpetaPorDefecto } = await import(
  join(REPO, "opencode/plataforma/sesion-local.ts")
)
const { abrirServidorDeVuelta, PAGINA_LISTO } = await import(join(REPO, "opencode/plataforma/servidor-vuelta.ts"))

const RAIZ = mkdtempSync(join(os.tmpdir(), "tecniabot-sesion-"))
after(() => rmSync(RAIZ, { recursive: true, force: true }))

let n = 0
const carpetaNueva = () => join(RAIZ, `caso-${++n}`, "opencode")

const TOKEN = "token-secreto-de-prueba"
const SESION = { token: TOKEN, cuenta: { nombre: "Marta Gómez", email: "marta@example.com" }, base: "https://api.example/botApi" }
const POSIX = process.platform !== "win32"

// ── sesión local ────────────────────────────────────────────────────────────

test("sin archivo no hay sesión", () => {
  assert.deepEqual(leerSesionGuardada(carpetaNueva()), { estado: "sin-sesion" })
})

test("lo que se guarda es lo que se lee, y crea la carpeta si falta", () => {
  const carpeta = carpetaNueva()
  assert.deepEqual(guardarSesionLocal(SESION, carpeta), { estado: "guardada", ruta: rutaSesion(carpeta) })
  assert.deepEqual(leerSesionGuardada(carpeta), { estado: "ok", sesion: SESION })
})

test("el archivo queda legible sólo por el usuario, y no queda ningún temporal", { skip: !POSIX }, () => {
  const carpeta = carpetaNueva()
  guardarSesionLocal(SESION, carpeta)
  assert.equal(statSync(rutaSesion(carpeta)).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(carpeta), ["tecnia-sesion.json"])
})

test("guardar encima de una sesión vieja con permisos abiertos la deja cerrada", { skip: !POSIX }, () => {
  const carpeta = carpetaNueva()
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(rutaSesion(carpeta), "{}", { mode: 0o644 })
  guardarSesionLocal(SESION, carpeta)
  assert.equal(statSync(rutaSesion(carpeta)).mode & 0o777, 0o600)
})

test("un temporal viejo con permisos abiertos no le presta sus permisos a la sesión", { skip: !POSIX }, () => {
  // El permiso se pone dos veces: al crear el temporal y con un `chmod` después.
  // Al verificar por mutación, sacar cualquiera de las dos dejaba todo verde,
  // porque la otra lo tapaba. Este caso es el único donde el `chmod` hace falta:
  // `mode` no se aplica si el temporal ya existía (un corte a mitad de un guardado
  // anterior). El `mode` al crear queda sin test propio: lo que evita es un
  // instante con el token legible, y eso no se ve mirando el archivo después.
  const carpeta = carpetaNueva()
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(`${rutaSesion(carpeta)}.${process.pid}.tmp`, "resto de un guardado cortado", { mode: 0o644 })
  guardarSesionLocal(SESION, carpeta)
  assert.equal(statSync(rutaSesion(carpeta)).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(carpeta), ["tecnia-sesion.json"])
})

test("de la sesión sólo se guardan los campos del contrato", () => {
  const carpeta = carpetaNueva()
  guardarSesionLocal({ ...SESION, cuenta: { ...SESION.cuenta, dni: "12345678" }, otra: "cosa" }, carpeta)
  assert.deepEqual(JSON.parse(readFileSync(rutaSesion(carpeta), "utf8")), SESION)
})

test("una sesión incompleta no se guarda", () => {
  const casos = {
    "sin token": { ...SESION, token: "" },
    "sin base": { ...SESION, base: "" },
    "sin cuenta": { ...SESION, cuenta: undefined },
    "sin email": { ...SESION, cuenta: { nombre: "Marta", email: "" } },
  }
  for (const [nombre, sesion] of Object.entries(casos)) {
    const carpeta = carpetaNueva()
    assert.equal(guardarSesionLocal(sesion, carpeta).estado, "no-pude-guardar", nombre)
    assert.ok(!existsSync(rutaSesion(carpeta)), nombre)
  }
})

test("si no se puede escribir lo dice, y el resultado no trae el token", { skip: !POSIX || process.getuid?.() === 0 }, () => {
  const carpeta = carpetaNueva()
  mkdirSync(carpeta, { recursive: true })
  chmodSync(carpeta, 0o500)
  try {
    const r = guardarSesionLocal(SESION, carpeta)
    assert.equal(r.estado, "no-pude-guardar")
    assert.ok(!JSON.stringify(r).includes(TOKEN))
  } finally {
    chmodSync(carpeta, 0o700)
  }
})

test("un archivo que no se entiende es ilegible, no «sin sesión»", () => {
  const casos = {
    "no es JSON": "esto no es json",
    "vacío": "",
    "una lista": "[]",
    "sin token": JSON.stringify({ ...SESION, token: "" }),
    "token que no es texto": JSON.stringify({ ...SESION, token: 12345 }),
    "sin base": JSON.stringify({ token: TOKEN, cuenta: SESION.cuenta }),
    "sin cuenta": JSON.stringify({ token: TOKEN, base: SESION.base }),
    "cuenta sin email": JSON.stringify({ ...SESION, cuenta: { nombre: "Marta" } }),
  }
  for (const [nombre, contenido] of Object.entries(casos)) {
    const carpeta = carpetaNueva()
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(rutaSesion(carpeta), contenido)
    assert.deepEqual(leerSesionGuardada(carpeta), { estado: "ilegible", ruta: rutaSesion(carpeta) }, nombre)
  }
})

test("borrar deja el disco sin sesión, y borrar dos veces también", () => {
  const carpeta = carpetaNueva()
  guardarSesionLocal(SESION, carpeta)
  assert.deepEqual(borrarSesionGuardada(carpeta), { estado: "sin-sesion" })
  assert.ok(!existsSync(rutaSesion(carpeta)))
  assert.deepEqual(borrarSesionGuardada(carpeta), { estado: "sin-sesion" })
})

test("si el archivo sigue ahí después de borrar, no dice que no hay sesión", { skip: !POSIX || process.getuid?.() === 0 }, () => {
  const carpeta = carpetaNueva()
  guardarSesionLocal(SESION, carpeta)
  chmodSync(carpeta, 0o500)
  try {
    assert.deepEqual(borrarSesionGuardada(carpeta), { estado: "no-pude-borrar", ruta: rutaSesion(carpeta) })
  } finally {
    chmodSync(carpeta, 0o700)
  }
})

test("la carpeta por defecto es la de configuración de OpenCode", () => {
  const antes = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(RAIZ, "xdg")
  try {
    assert.equal(carpetaPorDefecto(), join(RAIZ, "xdg", "opencode"))
    assert.equal(rutaSesion(), join(RAIZ, "xdg", "opencode", "tecnia-sesion.json"))
  } finally {
    if (antes === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = antes
  }
})

// ── servidor de vuelta ──────────────────────────────────────────────────────

const INTENTO = { verifier: "verifier-de-prueba", challenge: "huella", state: "state-de-prueba", codigo: "482715" }

async function abrir(esperaMs = 5_000) {
  const r = await abrirServidorDeVuelta(INTENTO, esperaMs)
  assert.equal(r.estado, "escuchando")
  return r.servidor
}

const pedir = (puerto, ruta, init) => fetch(`http://127.0.0.1:${puerto}${ruta}`, init)

/** Pedido crudo, para poder mandar un `Host` que `fetch` no deja falsificar. */
function pedirConHost(puerto, ruta, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: "GET", headers: { Host: host } }, (res) => {
      res.resume()
      res.on("end", () => resolve(res.statusCode))
    })
    req.on("error", reject)
    req.end()
  })
}

test("la vuelta válida entrega el código, responde la página fija y libera el puerto", async () => {
  const servidor = await abrir()
  assert.ok(servidor.puerto >= 1024)
  const res = await pedir(servidor.puerto, "/callback?code=abc123&state=state-de-prueba")
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /volver a Tecnia Bot/)
  assert.ok(!html.includes("abc123"), "el código no puede volver en la página")
  assert.equal(res.headers.get("referrer-policy"), "no-referrer")
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'")
  assert.equal(html, PAGINA_LISTO, "la página que se sirve no es la que se prueba más abajo")
  assert.deepEqual(await servidor.vuelta, { estado: "ok", code: "abc123" })
  await assert.rejects(pedir(servidor.puerto, "/callback?code=abc123&state=state-de-prueba"), "el puerto tiene que haber quedado libre")
})

test("la página de vuelta NO dice que quedó vinculado, y manda al chat a confirmarlo", () => {
  // Cuando se muestra, el bot recién recibió el código: falta canjearlo y puede
  // fallar. Si esta página dijera «vinculado» sería un OK que nadie comprobó.
  const texto = PAGINA_LISTO.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ")
  assert.doesNotMatch(texto, /vinculad[oa]|qued[oó] conectad|conectad[oa] con [eé]xito|ya est[aá] conectad/i, `afirma un vínculo que todavía no se comprobó: ${texto}`)
  assert.match(texto, /volver a Tecnia Bot/)
  assert.match(texto, /Preguntale en el chat/, "no manda al docente a confirmar en el chat")
})

test("la página de vuelta no pide nada de afuera ni corre scripts", () => {
  // Se sirve desde 127.0.0.1 con el código del vínculo en la barra de direcciones.
  assert.doesNotMatch(PAGINA_LISTO, /https?:|\/\/[a-z0-9]/i, "la página nombra una dirección de afuera")
  assert.doesNotMatch(PAGINA_LISTO, /<script|<img|<link|<iframe|@import|url\(|\bon[a-z]+\s*=/i, "la página carga algo o corre código")
  assert.match(PAGINA_LISTO, /<html lang="es">/)
  assert.match(PAGINA_LISTO, /<meta charset="utf-8">/)
})

test("un pedido con otra marca se rechaza y el servidor sigue esperando la vuelta buena", async () => {
  const servidor = await abrir()
  const mala = await pedir(servidor.puerto, "/callback?code=robado&state=otra-marca-distinta")
  assert.equal(mala.status, 400)
  assert.ok(!(await mala.text()).includes("robado"))
  const sinCodigo = await pedir(servidor.puerto, "/callback?state=state-de-prueba")
  assert.equal(sinCodigo.status, 400)

  const buena = await pedir(servidor.puerto, "/callback?code=abc123&state=state-de-prueba")
  assert.equal(buena.status, 200)
  assert.deepEqual(await servidor.vuelta, { estado: "ok", code: "abc123" })
})

test("sólo atiende GET a la ruta exacta y con su propio Host", async () => {
  const servidor = await abrir()
  try {
    assert.equal((await pedir(servidor.puerto, "/")).status, 404)
    assert.equal((await pedir(servidor.puerto, "/callback?code=a&state=state-de-prueba", { method: "POST" })).status, 405)
    assert.equal(await pedirConHost(servidor.puerto, "/callback?code=a&state=state-de-prueba", "sitio-malo.example"), 403)
    assert.equal(await pedirConHost(servidor.puerto, "/callback?code=a&state=state-de-prueba", `sitio-malo.example:${servidor.puerto}`), 403)
    // Ninguno de esos pedidos terminó la espera.
    const carrera = await Promise.race([servidor.vuelta, new Promise((r) => setTimeout(() => r("sigue-esperando"), 100))])
    assert.equal(carrera, "sigue-esperando")
    assert.equal(await pedirConHost(servidor.puerto, "/", `localhost:${servidor.puerto}`), 404)
  } finally {
    servidor.cancelar()
  }
  assert.deepEqual(await servidor.vuelta, { estado: "cancelada" })
})

test("escucha sólo en 127.0.0.1", async () => {
  const servidor = await abrir()
  try {
    const externa = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)
    if (!externa) return // compu sin red: no hay otra interfaz contra la cual probar
    await assert.rejects(fetch(`http://${externa.address}:${servidor.puerto}/`, { signal: AbortSignal.timeout(2_000) }))
  } finally {
    servidor.cancelar()
  }
})

test("si nadie vuelve, la espera vence y lo dice", async () => {
  const servidor = await abrir(150)
  assert.deepEqual(await servidor.vuelta, { estado: "sin-respuesta" })
  await assert.rejects(pedir(servidor.puerto, "/"))
})

test("cancelar libera el puerto y no deja la espera colgada", async () => {
  const servidor = await abrir()
  servidor.cancelar()
  assert.deepEqual(await servidor.vuelta, { estado: "cancelada" })
  await assert.rejects(pedir(servidor.puerto, "/"))
  servidor.cancelar() // cancelar dos veces no rompe
})

test("al terminar corta también las conexiones que quedaron abiertas sin pedir nada", async () => {
  // Un navegador abre conexiones de más y las deja ociosas. Sin cortarlas, el
  // servidor no termina de cerrar y el proceso del bot queda con el puerto tomado.
  // Los demás tests no lo veían: `fetch` cierra sola su conexión. Lo protege el
  // `close()` del servidor; se comprobó sacándolo, que deja este test colgado.
  const servidor = await abrir()
  const ociosa = net.connect(servidor.puerto, "127.0.0.1")
  await new Promise((resolve, reject) => ociosa.once("connect", resolve).once("error", reject))
  const cortada = new Promise((resolve) => ociosa.once("close", () => resolve("cortada")))
  servidor.cancelar()
  const carrera = await Promise.race([cortada, new Promise((r) => setTimeout(() => r("sigue-abierta"), 1_000))])
  ociosa.destroy()
  assert.equal(carrera, "cortada")
})

test("dos servidores a la vez quedan en puertos distintos", async () => {
  const a = await abrir()
  const b = await abrir()
  try {
    assert.notEqual(a.puerto, b.puerto)
  } finally {
    a.cancelar()
    b.cancelar()
  }
})
