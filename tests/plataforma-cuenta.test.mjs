// Cuenta (`opencode/plataforma/cuenta.ts`): vincular Tecnia Bot con la cuenta del
// docente en la plataforma Tecnia Lab. Es la lógica del futuro tool `cuenta`.
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// CÓMO SE PRUEBA. Con una PLATAFORMA SIMULADA: un servidor HTTP local que hace de
// API (`/vinculos/canje`, `/sesion`) y un «navegador» falso que, en vez de abrir
// una ventana, le pega a la vuelta local como haría el navegador del docente
// después de confirmar. El puerto de vuelta, el canje y el archivo de sesión son
// los reales: se ejercita el recorrido entero de este lado.
//
// EL CÓDIGO DE SEIS DÍGITOS. La plataforma simulada hace lo que hace la de verdad:
// sólo acepta el canje si el bot presenta el mismo código que el docente escribió
// en la página. Y el «docente» de estos tests saca el código de donde lo saca el
// de verdad: del mensaje que devolvió `vincular`, nunca del enlace. Por eso el
// navegador falso no vuelve apenas lo abren: espera a que el docente haya leído
// el mensaje. Si el código viajara en el enlace, o si el canje no lo mandara,
// estos tests no podrían vincular.
//
// QUÉ NO PRUEBA. Que la plataforma de verdad se comporte como la simulada, ni un
// navegador de verdad, ni Windows, ni Bun (acá no se abre ningún navegador: eso
// es `Bun.spawn`, que sólo existe dentro de OpenCode).
//
// La carpeta es temporal y propia de cada corrida (`mkdtempSync`), no una ruta
// fija, para no chocar con otra suite corriendo a la vez.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RAIZ = mkdtempSync(join(os.tmpdir(), "tecniabot-cuenta-"))
after(() => rmSync(RAIZ, { recursive: true, force: true }))

const { crearCuenta, direccionSegura, emailParcial } = await import(join(REPO, "opencode/plataforma/cuenta.ts"))
const vinculo = await import(join(REPO, "opencode/plataforma/vinculo.ts"))

const TOKEN = "token-secreto-de-la-plataforma"
const CUENTA = { nombre: "Marta Gómez", email: "marta.gomez@escuela.example" }
const WEB = "https://plataforma.example"
const POSIX = process.platform !== "win32"

// TODO LO QUE QUEDA ESCUCHANDO SE CIERRA AL FINAL, PASE LO QUE PASE. Sin esto, un
// test que fallaba antes de llegar a su `cerrar()` dejaba un servidor abierto y
// el proceso no terminaba nunca: el archivo entero daba rojo recién por el tope
// de tiempo, y un rojo por tiempo no dice qué se rompió. Lo mostraron las
// mutaciones del código de seis dígitos (2026-11-19): siete de quince «se
// detectaban» así. Los asserts fallaban bien; lo que estaba mal era la salida.
const servidoresAbiertos = new Set()
const cuentasArmadas = []
after(async () => {
  for (const cuenta of cuentasArmadas) await cuenta.ejecutar("cerrar").catch(() => {})
  for (const servidor of servidoresAbiertos) {
    servidor.closeAllConnections()
    servidor.close()
  }
})

/** Plataforma simulada. `comportamiento` permite romperla de a una cosa por test. */
async function crearPlataforma(comportamiento = {}, demoraCanjeMs = 0) {
  const estado = { canjes: [], sesionAbierta: false, cierres: 0, consultas: 0, autorizaciones: [], codigoEscrito: null }
  const servidor = http.createServer(async (req, res) => {
    let cuerpo = ""
    for await (const parte of req) cuerpo += parte
    const responder = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(json))
    }
    const ruta = `${req.method} ${req.url}`
    if (ruta in comportamiento) return responder(...comportamiento[ruta])
    if (req.headers.authorization) estado.autorizaciones.push(req.headers.authorization)

    if (ruta === "POST /vinculos/canje") {
      const canje = JSON.parse(cuerpo)
      estado.canjes.push(canje)
      if (demoraCanjeMs) await new Promise((r) => setTimeout(r, demoraCanjeMs))
      if (typeof canje.codigo !== "string" || !/^[0-9]{6}$/.test(canje.codigo)) return responder(400, { error: "pedido-invalido" })
      // Lo que el docente escribió en la página. Si no coincide, mismo error que un code vencido.
      if (canje.codigo !== estado.codigoEscrito) return responder(400, { error: "codigo-invalido" })
      estado.sesionAbierta = true
      return responder(200, { token: TOKEN, cuenta: CUENTA })
    }
    const conSesion = estado.sesionAbierta && req.headers.authorization === `Bearer ${TOKEN}`
    if (ruta === "GET /sesion") {
      estado.consultas++
      return conSesion ? responder(200, { cuenta: CUENTA }) : responder(401, { error: "sesion-invalida" })
    }
    if (ruta === "DELETE /sesion") {
      if (!conSesion) return responder(401, { error: "sesion-invalida" })
      estado.sesionAbierta = false
      estado.cierres++
      return responder(200, { cerrada: true })
    }
    responder(404, { error: "ruta-desconocida" })
  })
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve))
  servidoresAbiertos.add(servidor)
  const base = `http://127.0.0.1:${servidor.address().port}`
  const cerrar = () => {
    servidoresAbiertos.delete(servidor)
    return new Promise((resolve) => servidor.close(resolve))
  }
  return { base, estado, cerrar }
}

let n = 0
/** Arma un tool con su propia carpeta, su plataforma y un navegador falso. */
async function armar({ comportamiento, navegador = "confirma", modo, api, esperaMs = 5_000, demoraCanjeMs = 0, escribe = "el-del-chat" } = {}) {
  const plataforma = await crearPlataforma(comportamiento, demoraCanjeMs)
  const carpeta = join(RAIZ, `caso-${++n}`, "opencode")
  mkdirSync(carpeta, { recursive: true })
  if (modo) writeFileSync(join(carpeta, "tecnia-perfil.md"), `# Perfil\n\n- Modo: ${modo}\n- Rol: docente\n`)
  const abiertas = []
  const vueltas = []
  /** Pestañas abiertas donde el docente todavía no escribió el código ni confirmó. */
  const pendientes = []
  const cuenta = crearCuenta({
    fetch: (url, init) => fetch(url, init),
    api: api ?? plataforma.base,
    web: WEB,
    carpeta,
    etiqueta: "notebook-de-marta",
    esperaMs,
    abrirNavegador: (url) => {
      abiertas.push(url)
      if (navegador === "no-abre") return false
      if (navegador === "confirma") {
        const u = new URL(url)
        // Lo que haría el navegador del docente después de confirmar en la plataforma.
        pendientes.push(() =>
          fetch(`http://127.0.0.1:${u.searchParams.get("port")}/callback?code=codigo-de-un-uso&state=${u.searchParams.get("state")}`).then((r) => r.status),
        )
      }
      return true
    },
  })
  cuentasArmadas.push(cuenta)
  const rutaSesion = join(carpeta, "tecnia-sesion.json")
  return { cuenta, plataforma, carpeta, abiertas, vueltas, pendientes, rutaSesion, escribe }
}

/** El código que el tool le mostró al docente, como seis dígitos seguidos. `null` si no mostró ninguno. */
function codigoDelMensaje(mensaje) {
  const m = mensaje.match(/Es este: ([0-9]{3}) ([0-9]{3})$/m)
  return m ? m[1] + m[2] : null
}

/** El docente lee el código en el chat, lo escribe en la página y confirma. */
function docenteConfirma(caso, mensaje) {
  const delChat = codigoDelMensaje(mensaje)
  if (caso.escribe === "el-del-chat") caso.plataforma.estado.codigoEscrito = delChat
  // Un dígito distinto: el docente se equivocó al copiarlo.
  if (caso.escribe === "otro") caso.plataforma.estado.codigoEscrito = delChat.replace(/.$/, (d) => String((Number(d) + 1) % 10))
  for (const confirmar of caso.pendientes.splice(0)) caso.vueltas.push(confirmar())
}

/** Espera un centinela en el mundo (un archivo, un contador), no un tiempo a ciegas. */
async function hasta(condicion, queEspero) {
  const limite = Date.now() + 3_000
  while (!condicion()) {
    if (Date.now() > limite) assert.fail(`no llegó: ${queEspero}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Vincula y espera a que el navegador falso haya vuelto. El canje puede seguir en curso. */
async function vincularYEsperar(caso) {
  const mensaje = await caso.cuenta.ejecutar("vincular")
  docenteConfirma(caso, mensaje)
  await Promise.all(caso.vueltas)
  return mensaje
}

/**
 * Vincula y espera a que la sesión esté en disco.
 *
 * La primera versión de estos tests seguía apenas volvía el navegador, con el
 * canje todavía en curso, y cinco fallaban según quién llegara primero. De paso
 * mostraron un bug de verdad: `cerrar` decía «cancelé el vínculo» cuando el
 * vínculo ya se había completado (ver el test de «cerrar en medio de un canje»).
 */
async function vincularConSesion(caso) {
  const mensaje = await vincularYEsperar(caso)
  await hasta(() => existsSync(caso.rutaSesion), "la sesión guardada en disco")
  return mensaje
}

// ── apagado por defecto ─────────────────────────────────────────────────────

test("sin dirección de la plataforma el tool está apagado y no toca nada", async () => {
  for (const [api, web] of [[undefined, WEB], ["https://api.example", undefined], [undefined, undefined], ["http://api.example", WEB]]) {
    const carpeta = join(RAIZ, `apagado-${++n}`)
    let abrio = false
    const cuenta = crearCuenta({ fetch: () => assert.fail("no tiene que salir ningún pedido"), api, web, carpeta, etiqueta: "x", abrirNavegador: () => (abrio = true) })
    for (const accion of ["estado", "vincular", "cerrar"]) {
      assert.match(await cuenta.ejecutar(accion), /todavía no está disponible/, `${accion} con api=${api} web=${web}`)
    }
    assert.equal(abrio, false)
    assert.ok(!existsSync(carpeta))
  }
})

test("sólo sirve https, o http contra esta misma compu", () => {
  assert.equal(direccionSegura("https://api.example/botApi/"), "https://api.example/botApi")
  assert.equal(direccionSegura("http://127.0.0.1:18001/x"), "http://127.0.0.1:18001/x")
  assert.equal(direccionSegura("http://localhost:18001/x"), "http://localhost:18001/x")
  for (const mala of [undefined, "", "no es una url", "http://api.example", "http://192.168.0.10:8080", "ftp://api.example", "http://127.0.0.1.malo.example"]) {
    assert.equal(direccionSegura(mala), null, String(mala))
  }
})

test("del email se muestra la inicial y el dominio", () => {
  assert.equal(emailParcial("marta.gomez@escuela.example"), "m…@escuela.example")
  assert.equal(emailParcial("sin-arroba"), "…")
  assert.equal(emailParcial("@escuela.example"), "…")
})

// ── estado ──────────────────────────────────────────────────────────────────

test("estado: sin sesión dice que no hay cuenta vinculada, sin preguntarle a la plataforma", async () => {
  const caso = await armar()
  try {
    assert.match(await caso.cuenta.ejecutar("estado"), /No hay ninguna cuenta de Tecnia Lab vinculada/)
    assert.equal(caso.plataforma.estado.consultas, 0)
  } finally {
    await caso.plataforma.cerrar()
  }
})

// ── vincular ────────────────────────────────────────────────────────────────

test("vincular: abre la plataforma, no dice «vinculado», y estado lo confirma después", async () => {
  const caso = await armar()
  try {
    const mensaje = await vincularConSesion(caso)
    assert.match(mensaje, /TODAVÍA NO ESTÁ VINCULADO/)
    assert.match(mensaje, /NUNCA en este chat/)
    assert.ok(!/Tecnia Bot está vinculado/.test(mensaje))

    assert.equal(caso.abiertas.length, 1)
    const url = new URL(caso.abiertas[0])
    assert.equal(url.origin + url.pathname, `${WEB}/vincular-bot`)
    assert.deepEqual([...url.searchParams.keys()].sort(), ["challenge", "port", "state"])
    assert.deepEqual(await Promise.all(caso.vueltas), [200])

    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /está vinculado con la cuenta de Marta Gómez \(m…@escuela\.example\)/)
    assert.match(estado, /confirmé recién con la plataforma/)
    assert.equal(caso.plataforma.estado.consultas, 1, "estado tiene que haberle preguntado a la plataforma")

    // El canje llevó el code, el secreto que corresponde a la huella de la URL, el
    // código que se le mostró al docente y el nombre de la compu.
    const [canje] = caso.plataforma.estado.canjes
    assert.equal(canje.code, "codigo-de-un-uso")
    assert.equal(canje.codigo, codigoDelMensaje(mensaje))
    assert.equal(canje.etiqueta, "notebook-de-marta")
    assert.equal(vinculo.challengeDe(canje.verifier), url.searchParams.get("challenge"))

    // En disco quedó la sesión, contra la dirección con la que se vinculó.
    assert.deepEqual(JSON.parse(readFileSync(caso.rutaSesion, "utf8")), { token: TOKEN, cuenta: CUENTA, base: caso.plataforma.base })
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("ningún mensaje del tool trae el token ni el email entero", async () => {
  const caso = await armar()
  try {
    const mensajes = [await vincularConSesion(caso), await caso.cuenta.ejecutar("estado"), await caso.cuenta.ejecutar("vincular"), await caso.cuenta.ejecutar("cerrar")]
    for (const mensaje of mensajes) {
      assert.ok(!mensaje.includes(TOKEN), `el token salió en: ${mensaje}`)
      assert.ok(!mensaje.includes(CUENTA.email), `el email entero salió en: ${mensaje}`)
    }
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: si el navegador no se abre, entrega el enlace para abrirlo a mano", async () => {
  const caso = await armar({ navegador: "no-abre" })
  try {
    const mensaje = await caso.cuenta.ejecutar("vincular")
    assert.match(mensaje, /No pude abrir el navegador solo/)
    assert.ok(mensaje.includes(caso.abiertas[0]))
    assert.match(await caso.cuenta.ejecutar("estado"), /Sigo esperando que el docente confirme/)
    // Un segundo `vincular` no abre otro puerto ni otra pestaña: devuelve el mismo enlace.
    assert.ok((await caso.cuenta.ejecutar("vincular")).includes(caso.abiertas[0]))
    assert.equal(caso.abiertas.length, 1)
  } finally {
    await caso.cuenta.ejecutar("cerrar")
    await caso.plataforma.cerrar()
  }
})

test("vincular: en modo aula no vincula ni abre nada", async () => {
  const caso = await armar({ modo: "aula" })
  try {
    assert.match(await caso.cuenta.ejecutar("vincular"), /modo aula/)
    assert.equal(caso.abiertas.length, 0)
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
  // En los otros modos sí.
  const personal = await armar({ modo: "personal" })
  try {
    await vincularYEsperar(personal)
    assert.equal(personal.abiertas.length, 1)
  } finally {
    await personal.plataforma.cerrar()
  }
})

test("vincular: con una sesión ya guardada no abre otro vínculo", async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    await caso.cuenta.ejecutar("estado")
    assert.match(await caso.cuenta.ejecutar("vincular"), /ya hay una sesión guardada/)
    assert.equal(caso.abiertas.length, 1)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: si la plataforma rechaza el canje, estado lo dice y no queda sesión", async () => {
  const caso = await armar({ comportamiento: { "POST /vinculos/canje": [400, { error: "codigo-invalido" }] } })
  try {
    await vincularYEsperar(caso)
    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /la plataforma lo rechazó/)
    assert.match(estado, /No hay ninguna cuenta de Tecnia Lab vinculada/)
    assert.ok(!existsSync(caso.rutaSesion))
    // El fallo se dice una sola vez.
    assert.ok(!/lo rechazó/.test(await caso.cuenta.ejecutar("estado")))
  } finally {
    await caso.plataforma.cerrar()
  }
})

// ── el código de seis dígitos ───────────────────────────────────────────────

test("vincular: muestra un código de seis dígitos que NO está en el enlace", async () => {
  const caso = await armar({ navegador: "no-abre" })
  try {
    const mensaje = await caso.cuenta.ejecutar("vincular")
    const codigo = codigoDelMensaje(mensaje)
    assert.match(codigo ?? "", /^[0-9]{6}$/, `el mensaje no trae el código: ${mensaje}`)
    assert.match(mensaje, /La página le va a pedir un código/)
    assert.match(mensaje, /hay que cerrarla/)
    // El enlace lo puede armar cualquier programa de la compu: si el código fuera
    // en él, no probaría nada. Se mira el enlace que se abrió Y el texto entero,
    // sacando el renglón donde se muestra a propósito.
    assert.ok(!caso.abiertas[0].includes(codigo), "el código viajó en el enlace")
    const sinElRenglon = mensaje.replace(/^La página le va a pedir un código.*$/m, "")
    assert.ok(!sinElRenglon.includes(codigo), "el código aparece en otra parte del mensaje")
    assert.ok(!sinElRenglon.replaceAll(" ", "").includes(codigo), "el código aparece en otra parte del mensaje, con espacios")
  } finally {
    await caso.cuenta.ejecutar("cerrar")
    await caso.plataforma.cerrar()
  }
})

test("vincular: mientras el intento sigue en curso, el código que se muestra es el mismo", async () => {
  // Si cada mensaje mostrara uno nuevo, el docente escribiría el último y el
  // canje llevaría el primero.
  const caso = await armar({ navegador: "no-abre" })
  try {
    const codigo = codigoDelMensaje(await caso.cuenta.ejecutar("vincular"))
    assert.equal(codigoDelMensaje(await caso.cuenta.ejecutar("vincular")), codigo)
    assert.equal(codigoDelMensaje(await caso.cuenta.ejecutar("estado")), codigo)
  } finally {
    await caso.cuenta.ejecutar("cerrar")
    await caso.plataforma.cerrar()
  }
})

test("vincular: si el docente escribe otro código, no queda vinculado y estado dice por qué", async () => {
  const caso = await armar({ escribe: "otro" })
  try {
    const mensaje = await vincularYEsperar(caso)
    const estado = await caso.cuenta.ejecutar("estado")
    assert.notEqual(caso.plataforma.estado.codigoEscrito, codigoDelMensaje(mensaje), "el test necesita que el docente haya escrito otro")
    assert.equal(caso.plataforma.estado.canjes.length, 1, "el canje tiene que haberse intentado")
    assert.match(estado, /el código escrito en la página no fuera el que mostré acá/)
    assert.match(estado, /va a salir un código distinto/)
    assert.match(estado, /No hay ninguna cuenta de Tecnia Lab vinculada/)
    assert.ok(!existsSync(caso.rutaSesion))
    assert.equal(caso.plataforma.estado.sesionAbierta, false)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: un enlace que no salió de este chat no vincula, aunque alguien confirme en la página", async () => {
  // El caso que encontró la revisión: otro programa de la compu arma su enlace y
  // un docente con la sesión abierta aprieta «Sí, vincular». El docente no tiene
  // ningún código de ESE pedido: lo que escriba (acá, nada) no es lo que el bot
  // va a presentar.
  const caso = await armar({ escribe: "nada" })
  try {
    await vincularYEsperar(caso)
    await caso.cuenta.ejecutar("estado")
    assert.equal(caso.plataforma.estado.canjes.length, 1)
    assert.equal(caso.plataforma.estado.sesionAbierta, false)
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: después de un intento fallido, el siguiente trae un código nuevo y vincula", async () => {
  const caso = await armar({ escribe: "otro" })
  try {
    const primero = codigoDelMensaje(await vincularYEsperar(caso))
    await caso.cuenta.ejecutar("estado")
    caso.escribe = "el-del-chat"
    const mensaje = await vincularConSesion(caso)
    assert.match(await caso.cuenta.ejecutar("estado"), /está vinculado con la cuenta de Marta Gómez/)
    assert.equal(caso.plataforma.estado.canjes[1].codigo, codigoDelMensaje(mensaje))
    // Uno en un millón de que coincidan por azar: si este assert falla dos veces
    // seguidas, el código no se está sorteando en cada intento.
    assert.notEqual(codigoDelMensaje(mensaje), primero)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: si el canje falla por otra cosa, estado dice cuál", async () => {
  const caso = await armar({ comportamiento: { "POST /vinculos/canje": [500, { error: "interno", detalle: `explotó con ${TOKEN}` }] } })
  try {
    await vincularYEsperar(caso)
    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /la plataforma devolvió un error \(interno\)/)
    assert.ok(!estado.includes(TOKEN))
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: si nadie confirma, la espera vence y estado lo dice", async () => {
  const caso = await armar({ navegador: "no-confirma", esperaMs: 150 })
  try {
    await caso.cuenta.ejecutar("vincular")
    await new Promise((r) => setTimeout(r, 300))
    assert.match(await caso.cuenta.ejecutar("estado"), /venció: nadie confirmó/)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("vincular: si no se puede guardar la sesión, cierra la que abrió en la plataforma", { skip: !POSIX || process.getuid?.() === 0 }, async () => {
  const caso = await armar()
  chmodSync(caso.carpeta, 0o500)
  try {
    await vincularYEsperar(caso)
    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /no pude guardar la sesión en esta compu/)
    assert.match(estado, /ya la cerré/)
    assert.equal(caso.plataforma.estado.cierres, 1)
    assert.equal(caso.plataforma.estado.sesionAbierta, false)
  } finally {
    chmodSync(caso.carpeta, 0o700)
    await caso.plataforma.cerrar()
  }
})

// ── estado con sesión ───────────────────────────────────────────────────────

test("estado: si la plataforma ya no reconoce la sesión, lo dice y la borra de la compu", async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    caso.plataforma.estado.sesionAbierta = false // la cerraron desde la web
    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /la plataforma ya no la reconoce/)
    assert.match(estado, /La borré de esta compu/)
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("estado: sin conexión dice que hay una sesión guardada que NO pudo confirmar, y no la borra", async () => {
  const caso = await armar()
  await vincularConSesion(caso)
  await caso.cuenta.ejecutar("estado")
  await caso.plataforma.cerrar() // la plataforma deja de contestar
  const estado = await caso.cuenta.ejecutar("estado")
  assert.match(estado, /sesión guardada de Marta Gómez/)
  assert.match(estado, /NO pude confirmarla/)
  assert.ok(!/está vinculado/.test(estado))
  assert.ok(existsSync(caso.rutaSesion), "sin conexión no se borra la sesión")
})

test("estado: una sesión de otra dirección no se usa ni se le manda el token", async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    const otra = crearCuenta({ fetch: () => assert.fail("no tiene que mandar el token a otra dirección"), api: "https://otra.example", web: WEB, carpeta: caso.carpeta, etiqueta: "x", abrirNavegador: () => true })
    assert.match(await otra.ejecutar("estado"), /es de otra dirección de la plataforma/)
    const cierre = await otra.ejecutar("cerrar")
    assert.match(cierre, /era de otra dirección/)
    assert.match(cierre, /ya no queda ninguna sesión guardada/)
    assert.equal(caso.plataforma.estado.cierres, 0)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("estado: un archivo de sesión ilegible se informa, y cerrar lo borra", async () => {
  const caso = await armar()
  try {
    writeFileSync(caso.rutaSesion, "esto no es json")
    assert.match(await caso.cuenta.ejecutar("estado"), /no lo puedo leer/)
    assert.match(await caso.cuenta.ejecutar("vincular"), /ya hay una sesión guardada/)
    const cierre = await caso.cuenta.ejecutar("cerrar")
    assert.match(cierre, /no se podía leer/)
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
})

// ── cerrar ──────────────────────────────────────────────────────────────────

test("cerrar: cierra en la plataforma y borra de la compu, y dice las dos cosas", async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    const cierre = await caso.cuenta.ejecutar("cerrar")
    assert.match(cierre, /La plataforma confirmó que cerró la sesión/)
    assert.match(cierre, /ya no queda ninguna sesión guardada/)
    assert.equal(caso.plataforma.estado.cierres, 1)
    assert.ok(!existsSync(caso.rutaSesion))
    assert.match(await caso.cuenta.ejecutar("cerrar"), /No había ninguna cuenta vinculada/)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("cerrar: sin conexión borra de la compu y avisa que en la plataforma sigue abierta", async () => {
  const caso = await armar()
  await vincularConSesion(caso)
  await caso.plataforma.cerrar()
  const cierre = await caso.cuenta.ejecutar("cerrar")
  assert.match(cierre, /NO pude cerrar la sesión en la plataforma/)
  assert.match(cierre, /Sigue abierta de su lado/)
  assert.match(cierre, /ya no queda ninguna sesión guardada/)
  assert.ok(!existsSync(caso.rutaSesion))
})

test("cerrar: si la plataforma ya no la reconocía, igual la borra de la compu", async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    caso.plataforma.estado.sesionAbierta = false
    const cierre = await caso.cuenta.ejecutar("cerrar")
    assert.match(cierre, /ya no reconocía esa sesión/)
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("cerrar: si no puede borrar el archivo, dice que sigue ahí", { skip: !POSIX || process.getuid?.() === 0 }, async () => {
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    chmodSync(caso.carpeta, 0o500)
    const cierre = await caso.cuenta.ejecutar("cerrar")
    assert.match(cierre, /La plataforma confirmó que cerró la sesión/)
    assert.match(cierre, /NO pude borrar la sesión de esta compu/)
  } finally {
    chmodSync(caso.carpeta, 0o700)
    await caso.plataforma.cerrar()
  }
})

test("cerrar: cancela un vínculo en curso y libera el puerto", async () => {
  const caso = await armar({ navegador: "no-confirma" })
  try {
    await caso.cuenta.ejecutar("vincular")
    const puerto = new URL(caso.abiertas[0]).searchParams.get("port")
    assert.match(await caso.cuenta.ejecutar("cerrar"), /Cancelé el vínculo que estaba en curso/)
    await assert.rejects(fetch(`http://127.0.0.1:${puerto}/`))
    assert.match(await caso.cuenta.ejecutar("estado"), /No hay ninguna cuenta de Tecnia Lab vinculada/)
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("cerrar en medio de un canje: no dice «cancelé», y cierra la sesión que se llegó a abrir", async () => {
  // El docente confirmó en el navegador y, antes de que termine el canje, pide
  // cerrar. El vínculo ya no se puede cancelar: se completa y se cierra.
  const caso = await armar({ demoraCanjeMs: 150 })
  try {
    await vincularYEsperar(caso)
    await hasta(() => caso.plataforma.estado.canjes.length === 1, "el canje en curso")
    assert.ok(!existsSync(caso.rutaSesion), "el test necesita que el canje todavía no haya terminado")
    const cierre = await caso.cuenta.ejecutar("cerrar")
    assert.ok(!/Cancelé/.test(cierre), `dijo que canceló un vínculo que se completó: ${cierre}`)
    assert.match(cierre, /La plataforma confirmó que cerró la sesión/)
    assert.equal(caso.plataforma.estado.sesionAbierta, false, "la sesión no puede quedar abierta en la plataforma")
    assert.ok(!existsSync(caso.rutaSesion))
  } finally {
    await caso.plataforma.cerrar()
  }
})

test("estado: si la plataforma no reconoce la sesión y no se puede borrar de la compu, lo dice", { skip: !POSIX || process.getuid?.() === 0 }, async () => {
  // Sin este caso, «la borré de esta compu» se podía decir sin mirar el
  // resultado del borrado (lo mostró la mutación, que sobrevivía).
  const caso = await armar()
  try {
    await vincularConSesion(caso)
    caso.plataforma.estado.sesionAbierta = false
    chmodSync(caso.carpeta, 0o500)
    const estado = await caso.cuenta.ejecutar("estado")
    assert.match(estado, /la plataforma ya no la reconoce/)
    assert.match(estado, /No pude borrarla de esta compu/)
    assert.ok(!/La borré/.test(estado))
  } finally {
    chmodSync(caso.carpeta, 0o700)
    await caso.plataforma.cerrar()
  }
})
