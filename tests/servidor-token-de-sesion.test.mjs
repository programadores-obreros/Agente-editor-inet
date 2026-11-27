// El servidor local sólo acepta cambios de quien trae el token de la sesión.
//
// POR QUÉ EXISTE ESTE ARCHIVO. La auditoría de código del 2026-11-22 (VIS-04) mostró
// que un programa que no es un navegador podía cambiar pines y reglas del proyecto con
// sólo conocer el puerto: el servidor confiaba en el header `Origin`, y un programa
// manda el `Origin` que quiera. El 2026-11-23 el owner decidió sumar un token por sesión.
//
// QUÉ PROTEGE Y QUÉ NO (sin exagerar; está igual en servidor-proyecto.ts):
//   - SÍ: de pedidos a ciegas contra el puerto.
//   - A MEDIAS: de otro usuario del sistema operativo. En Linux la línea de comandos del
//     lanzador, que lleva la dirección con el token, la puede leer cualquier usuario
//     mientras el lanzador viva. Lo marcó la revisión independiente; mi primera versión
//     de este encabezado decía que protegía de otro usuario sin más.
//   - NO: de un programa del MISMO usuario, que puede leer la dirección con el token o
//     editar el archivo del proyecto directamente.
//   - NO cierra las lecturas: `/api/proyecto` y `/api/eventos` siguen abiertas. Hay un
//     test que lo fija, para que el día que se cierren sea una decisión y no un descuido.
//
// QUÉ NO PRUEBA: un navegador real. La parte de la página se prueba con el cliente HTTP
// y un `fetch` falso; que el navegador conserve el fragmento `#t=` al abrir la dirección
// con xdg-open, `open` o `start` no está probado en ninguna plataforma.
//
// MUTACIONES que ponen rojo este archivo (ver el commit):
//   - sacar el chequeo del token en manejarOperaciones          → rojos «sin token», «token equivocado» y «el ataque»
//   - `tokenValido` que acepta cualquier string no vacío          → rojo «token equivocado»
//   - comparar sólo el largo                                      → rojo «token equivocado» (mismo largo)
//   - token fijo o derivado del puerto                            → rojo «dos servidores»
//   - `urlParaAbrir` sin el token                                 → rojo «la dirección que se abre»
//   - exigir el token también en las lecturas                     → rojo «las lecturas»
//   - el cliente no manda el header                               → rojo «el cliente manda la llave»
//   - el cliente trata el 403 como una respuesta normal           → rojo «sin llave, el cliente lo dice»
//   - el cliente le atribuye a la llave cualquier 403             → rojo «un 403 que NO es por la llave»
//   - exigir el token en /api/eventos                             → rojo «las lecturas»
//   - la tool abre `servidor.url` en vez de `urlParaAbrir`        → rojo «la tool» (en wave0-tool)
//
// Corre con: node --test tests/servidor-token-de-sesion.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor, CABECERA_TOKEN } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { crearClienteHttp, tokenDeLaDireccion, llaveDeLaSesion, llaveDeEstaPestana, CLAVE_DE_LA_LLAVE, SIN_PERMISO, LLAVE_QUE_YA_NO_VALE } = await import(join(REPO, "opencode/vista-fisica/web/cliente-http.js"))

let n = 0
const op = (tipo, payload, baseRevision) => ({ idOperacion: `tok-${n++}`, actor: "navegador", baseRevision, tipo, payload })

async function conServidor(nombre, cuerpo) {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir(nombre), idProyecto: nuevoIdProyecto() })
  for (const [tipo, payload] of [["SetPlaca", { placa: "esp32-devkit-v1" }], ["AgregarComponente", { tipo: "led" }]]) {
    const r = servicio.aplicar(op(tipo, payload, servicio.snapshot().revision))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
  }
  const led = servicio.snapshot().proyecto.componentes[0].id
  const r = servicio.aplicar(op("AsignarPin", { componente: led, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const servidor = await iniciarServidor({ servicio })
  try {
    await cuerpo({ servicio, servidor, led })
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
}

/** POST crudo (sin fetch): un programa cualquiera, que manda los headers que quiere. */
function postear(servidor, sobre, cabeceras) {
  return new Promise((resolve, reject) => {
    const cuerpo = JSON.stringify(sobre)
    const req = http.request(
      { hostname: "127.0.0.1", port: servidor.puerto, path: "/api/operaciones", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo), ...cabeceras } },
      (res) => {
        const trozos = []
        res.on("data", (t) => trozos.push(t))
        res.on("end", () => resolve({ estado: res.statusCode, cuerpo: Buffer.concat(trozos).toString("utf8") }))
      },
    )
    req.on("error", reject)
    req.end(cuerpo)
  })
}

const origen = (servidor) => `http://127.0.0.1:${servidor.puerto}`
const cambiarPin = (servicio, led) => op("AsignarPin", { componente: led, terminal: "anodo", pin: GPIO_Y }, servicio.snapshot().revision)
const pinDelLed = (servicio, led) => servicio.snapshot().proyecto.componentes.find((c) => c.id === led).pines.anodo

test("el ataque de la auditoría: un programa que copia el Origin ya no cambia el proyecto", async () => {
  await conServidor("token-ataque", async ({ servicio, servidor, led }) => {
    const antes = servicio.snapshot().revision
    const r = await postear(servidor, cambiarPin(servicio, led), { Origin: origen(servidor) })
    assert.equal(r.estado, 403, r.cuerpo)
    assert.equal(servicio.snapshot().revision, antes, "el proyecto cambió sin token")
    assert.equal(pinDelLed(servicio, led), GPIO_X)
  })
})

test("con el token de la sesión, el mismo pedido sí cambia el proyecto", async () => {
  await conServidor("token-ok", async ({ servicio, servidor, led }) => {
    const r = await postear(servidor, cambiarPin(servicio, led), { Origin: origen(servidor), [CABECERA_TOKEN]: servidor.token })
    assert.equal(r.estado, 200, r.cuerpo)
    assert.equal(JSON.parse(r.cuerpo).resultado.ok, true)
    assert.equal(pinDelLed(servicio, led), GPIO_Y)
  })
})

test("token equivocado: 403 y nada cambia, aunque tenga el mismo largo o sea parecido", async () => {
  await conServidor("token-mal", async ({ servicio, servidor, led }) => {
    const bueno = servidor.token
    const otraLetra = (bueno[0] === "A" ? "B" : "A") + bueno.slice(1)
    const ultima = bueno.slice(0, -1) + (bueno.at(-1) === "A" ? "B" : "A")
    // No va el caso «un espacio adelante»: HTTP recorta los espacios del valor de un header,
    // así que por el cable es el mismo token. Lo había puesto y daba 200, con razón.
    for (const malo of ["", "x", "x".repeat(bueno.length), otraLetra, ultima, bueno + "x", bueno.slice(0, -1), bueno.toUpperCase() === bueno ? bueno.toLowerCase() : bueno.toUpperCase()]) {
      if (malo === bueno) continue
      const antes = servicio.snapshot().revision
      const r = await postear(servidor, cambiarPin(servicio, led), { Origin: origen(servidor), [CABECERA_TOKEN]: malo })
      assert.equal(r.estado, 403, `aceptó el token ${JSON.stringify(malo)}`)
      assert.equal(servicio.snapshot().revision, antes)
    }
    // El token en la URL del POST o en el cuerpo no cuenta: sólo el header.
    const enCuerpo = await postear(servidor, { ...cambiarPin(servicio, led), token: bueno, t: bueno }, { Origin: origen(servidor) })
    assert.equal(enCuerpo.estado, 403)
    assert.equal(pinDelLed(servicio, led), GPIO_X)
  })
})

test("el token no reemplaza a los chequeos de antes: con token y Origin ajeno sigue siendo 403", async () => {
  await conServidor("token-origen", async ({ servicio, servidor, led }) => {
    const r = await postear(servidor, cambiarPin(servicio, led), { Origin: "http://evil.example.com", [CABECERA_TOKEN]: servidor.token })
    assert.equal(r.estado, 403)
    assert.match(r.cuerpo, /Origin/)
    const sinOrigen = await postear(servidor, cambiarPin(servicio, led), { [CABECERA_TOKEN]: servidor.token })
    assert.equal(sinOrigen.estado, 403)
    assert.equal(pinDelLed(servicio, led), GPIO_X)
  })
})

test("dos servidores no comparten token, y el token no sale del puerto", async () => {
  await conServidor("token-a", async ({ servidor: a }) => {
    await conServidor("token-b", async ({ servicio, servidor: b, led }) => {
      assert.notEqual(a.token, b.token)
      for (const t of [a.token, b.token]) {
        assert.match(t, /^[A-Za-z0-9_-]{43}$/, "32 bytes en base64url son 43 caracteres")
        assert.ok(!t.includes(String(a.puerto)) && !t.includes(String(b.puerto)))
      }
      // El token de un servidor no sirve en el otro.
      const r = await postear(b, cambiarPin(servicio, led), { Origin: origen(b), [CABECERA_TOKEN]: a.token })
      assert.equal(r.estado, 403)
    })
  })
})

test("la dirección que se abre lleva el token en el fragmento, y la base no lo lleva", async () => {
  await conServidor("token-url", async ({ servidor }) => {
    assert.equal(servidor.url, `http://127.0.0.1:${servidor.puerto}/`)
    assert.ok(!servidor.url.includes(servidor.token))
    assert.equal(servidor.urlParaAbrir, `${servidor.url}#t=${servidor.token}`)
    // En el fragmento, no en la consulta: el fragmento no viaja al servidor.
    const u = new URL(servidor.urlParaAbrir)
    assert.equal(u.search, "")
    assert.equal(tokenDeLaDireccion(u.hash), servidor.token, "la página no puede leer el token que la tool le pasó")
  })
})

test("las lecturas siguen abiertas sin token (límite declarado, no descuido)", async () => {
  await conServidor("token-lecturas", async ({ servidor }) => {
    const r = await fetch(new URL("/api/proyecto", servidor.url))
    assert.equal(r.status, 200)
    assert.equal(typeof (await r.json()).revision, "number")
    // /api/eventos también: se abre el stream sin token y contesta 200. (La primera versión
    // de este test decía fijar «las lecturas» y sólo pedía /api/proyecto.)
    const estadoEventos = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: "127.0.0.1", port: servidor.puerto, path: "/api/eventos" }, (res) => {
        resolve(res.statusCode)
        req.destroy()
      })
      req.on("error", reject)
    })
    assert.equal(estadoEventos, 200)
    const pagina = await fetch(servidor.url)
    assert.equal(pagina.status, 200)
    assert.ok(!(await pagina.text()).includes(servidor.token), "la página servida trae el token adentro: cualquiera que la pida lo lee")
  })
})

test("tokenDeLaDireccion: lee «#t=…» y no inventa", () => {
  assert.equal(tokenDeLaDireccion("#t=abc-DEF_123"), "abc-DEF_123")
  assert.equal(tokenDeLaDireccion("#otra=1&t=abc"), "abc")
  assert.equal(tokenDeLaDireccion("#t=abc&otra=1"), "abc")
  for (const sin of ["", "#", "#t=", "#x=abc", "#ot=abc", "t=abc", "#t=a b", undefined, null]) {
    assert.equal(tokenDeLaDireccion(sin), null, JSON.stringify(sin))
  }
})

test("un 403 que NO es por la llave no se le atribuye a la llave", async () => {
  // El servidor también contesta 403 por Origin o por Host. Decirle al alumno «se abrió sin
  // la llave» en ese caso sería nombrar una causa que no se midió.
  await conServidor("token-otro-403", async ({ servicio, servidor, led }) => {
    const estados = []
    let repintadas = 0
    const cliente = crearClienteHttp({
      fetch: (ruta, opciones = {}) => fetch(new URL(ruta, servidor.url), { ...opciones, headers: { ...opciones.headers, Origin: "http://evil.example.com" } }),
      aplicarSnapshot: () => assert.fail("no hay snapshot que aplicar en un 403"),
      repintar: () => repintadas++,
      mostrarEstado: (t) => estados.push(t),
      token: servidor.token,
    })
    const cuerpo = await cliente.enviarSobre(cambiarPin(servicio, led), { repintarAhora: true })
    assert.equal(cuerpo.resultado.ok, false)
    assert.equal(cuerpo.resultado.motivos[0].codigo, "PEDIDO_RECHAZADO_POR_EL_SERVIDOR")
    assert.equal(estados.length, 1)
    assert.notEqual(estados[0], SIN_PERMISO)
    assert.match(estados[0], /no aceptó/i)
    assert.equal(repintadas, 1)
    assert.equal(pinDelLed(servicio, led), GPIO_X)
  })
})

// El cliente de la página, con el servidor REAL detrás: `fetch` relativo resuelto contra
// la base, con el Origin que pondría el navegador.
function clienteDeLaPagina(servidor, token) {
  const estados = []
  let snapshot = null
  let repintadas = 0
  const cliente = crearClienteHttp({
    fetch: (ruta, opciones = {}) => fetch(new URL(ruta, servidor.url), { ...opciones, headers: { ...opciones.headers, Origin: origen(servidor) } }),
    aplicarSnapshot: (s) => (snapshot = s),
    repintar: () => repintadas++,
    mostrarEstado: (t) => estados.push(t),
    token,
  })
  return { cliente, estados, snapshot: () => snapshot, repintadas: () => repintadas }
}

test("el cliente manda la llave: con el token de la dirección, el cambio entra", async () => {
  await conServidor("token-cliente", async ({ servicio, servidor, led }) => {
    const p = clienteDeLaPagina(servidor, tokenDeLaDireccion(new URL(servidor.urlParaAbrir).hash))
    const cuerpo = await p.cliente.enviarSobre(cambiarPin(servicio, led), { repintarAhora: true })
    assert.equal(cuerpo.resultado.ok, true, JSON.stringify(cuerpo.resultado))
    assert.equal(pinDelLed(servicio, led), GPIO_Y)
    assert.deepEqual(p.estados, [null])
  })
})

test("sin llave, el cliente lo dice con palabras y no rompe la página", async () => {
  await conServidor("token-cliente-sin", async ({ servicio, servidor, led }) => {
    for (const token of [null, "equivocado"]) {
      const p = clienteDeLaPagina(servidor, token)
      await p.cliente.cargarSnapshot()
      const antes = p.snapshot()
      const repintadasAntes = p.repintadas()
      const cuerpo = await p.cliente.enviarSobre(cambiarPin(servicio, led), { repintarAhora: true })
      assert.equal(cuerpo.resultado.ok, false)
      // 2026-11-27: con una llave equivocada el aviso ya no es «se abrió sin la llave» (la tenía):
      // dice que Tecnia Bot no la reconoce. Sin llave, el de siempre.
      assert.deepEqual(p.estados, [token === null ? SIN_PERMISO : LLAVE_QUE_YA_NO_VALE])
      assert.equal(cuerpo.resultado.motivos[0].codigo, "SIN_TOKEN_DE_SESION")
      for (const texto of [SIN_PERMISO, LLAVE_QUE_YA_NO_VALE]) assert.match(texto, /Tecnia Bot/, "el texto tiene que decir cómo seguir")
      assert.equal(p.snapshot(), antes, "el cliente pisó el último snapshot bueno con el cuerpo de un 403")
      assert.equal(p.repintadas(), repintadasAntes + 1, "tiene que repintar: el control no puede quedar mostrando un cambio que no se hizo")
      assert.equal(pinDelLed(servicio, led), GPIO_X)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// La llave sobrevive a los enlaces de la propia página (2026-11-27)
//
// La llave vivía sólo en el fragmento de la dirección. Los enlaces del menú de arriba también son
// fragmentos (`#paso-reglas`): un clic la sacaba de la dirección y, tras recargar, cambiar una
// regla daba 403 con «se abrió sin la llave de la sesión». Reproducido en Chromium antes del
// arreglo: abrir (revisión 15→16 al editar), tocar «Decidí qué hace» (16→17, todavía anda: la
// llave se leyó al cargar), recargar, editar: 17→17 y 403.
//
// MUTACIONES que ponen rojo lo de abajo (una por vez, con el cambio ya commiteado):
//   - no guardar la llave de la dirección                         → «un enlace del menú…»
//   - leer primero la guardada y después la de la dirección       → «la de la dirección gana…»
//   - devolver lo guardado sin mirar su forma                     → «lo guardado es un dato…»
//   - recortarle los espacios a lo guardado antes de mirarlo      → «lo guardado es un dato…»
//   - sin tope de largo                                           → «lo guardado es un dato…»
//   - sin `try` al guardar o al leer                              → «si el almacén tira…»
//   - no sacar la guardada vieja cuando no se puede guardar       → «si no se puede guardar la nueva…»
//   - `llaveDeEstaPestana` sin `try` al pedir el almacén          → «desde la ventana…»
//   - `llaveDeEstaPestana` pasando `null` como almacén            → «desde la ventana…»
//   - el aviso de «sin llave» cuando se mandó una vencida         → «una llave vencida…»
//   - el cliente leyendo la llave una sola vez                    → «la llave se puede cambiar…»
//
// LO QUE ESTOS TESTS NO VEN, y por qué (revisión independiente, 2026-11-27). La primera versión
// tenía un test, «app.js toma la llave por `llaveDeLaSesion`…», que era una expresión regular sobre
// el texto de `app.js`. El revisor lo dejó verde con dos roturas ejecutadas: forzar `enNavegador`
// a `false`, y vaciar el almacén justo después de crear el cliente. El test miraba cómo estaba
// escrito, no qué hacía. Lo que se podía ejecutar se movió a `llaveDeEstaPestana(ventana)`, que
// ahora se prueba con una ventana de mentira. Lo que queda en `app.js` (una línea que la llama,
// y el oyente de `hashchange`) sigue sin ejecutarse acá: `app.js` no corre en Node como en el
// navegador. Esa parte se comprobó en Chromium headless contra el servidor real (abrir, enlace
// del menú, recargar, cambiar una regla), y hay que repetirlo a mano si se toca.
// ════════════════════════════════════════════════════════════════════════════════════

/** Un `sessionStorage` de mentira: lo que la pestaña recuerda mientras está abierta. */
function pestana(inicial = {}) {
  const datos = new Map(Object.entries(inicial))
  return { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => void datos.set(k, String(v)), datos }
}

test("un enlace del menú saca la llave de la dirección; la pestaña la recuerda y sigue valiendo tras recargar", () => {
  const almacen = pestana()
  // 1. Tecnia Bot abre la vista con la llave en la dirección.
  assert.equal(llaveDeLaSesion("#t=abc-DEF_123", almacen), "abc-DEF_123")
  assert.equal(almacen.datos.get(CLAVE_DE_LA_LLAVE), "abc-DEF_123")
  // 2. Un clic en «Decidí qué hace» deja la dirección en `#paso-reglas`, y después se recarga.
  assert.equal(tokenDeLaDireccion("#paso-reglas"), null, "precondición: la dirección ya no trae la llave")
  assert.equal(llaveDeLaSesion("#paso-reglas", almacen), "abc-DEF_123")
  assert.equal(llaveDeLaSesion("", almacen), "abc-DEF_123")
})

test("la de la dirección gana y pisa la guardada: una sesión nueva no queda tapada por la anterior", () => {
  const almacen = pestana({ [CLAVE_DE_LA_LLAVE]: "vieja" })
  assert.equal(llaveDeLaSesion("#t=nueva", almacen), "nueva")
  assert.equal(almacen.datos.get(CLAVE_DE_LA_LLAVE), "nueva")
  assert.equal(llaveDeLaSesion("#paso-avisos", almacen), "nueva")
})

test("una pestaña que nunca recibió la llave sigue sin tenerla", () => {
  assert.equal(llaveDeLaSesion("#paso-reglas", pestana()), null)
  assert.equal(llaveDeLaSesion("", pestana()), null)
  for (const sinAlmacen of [null, undefined]) {
    assert.equal(llaveDeLaSesion("#paso-reglas", sinAlmacen), null)
    assert.equal(llaveDeLaSesion("#t=abc", sinAlmacen), "abc", "sin almacén vale lo de antes: la de la dirección")
  }
})

test("lo guardado es un dato: si no tiene forma de llave, no se manda (ni recortado, ni si es larguísimo)", () => {
  for (const raro of ["", "con espacio", " abc ", "abc\n", "a\nX-Otro: 1", "<script>", "ñ", "a;b", "x".repeat(201)]) {
    assert.equal(llaveDeLaSesion("#paso-reglas", pestana({ [CLAVE_DE_LA_LLAVE]: raro })), null, JSON.stringify(raro.slice(0, 20)))
  }
  assert.equal(llaveDeLaSesion("#paso-reglas", pestana({ [CLAVE_DE_LA_LLAVE]: "x".repeat(200) })), "x".repeat(200), "el tope deja pasar una llave de verdad con mucho margen")
  assert.equal(llaveDeLaSesion("#paso-reglas", { getItem: () => 7, setItem() {} }), null)
})

test("si el almacén tira (modo privado estricto), la llave de la dirección vale igual y sin ella no hay ninguna", () => {
  const roto = { getItem() { throw new Error("SecurityError") }, setItem() { throw new Error("QuotaExceededError") }, removeItem() { throw new Error("SecurityError") } }
  assert.equal(llaveDeLaSesion("#t=abc", roto), "abc")
  assert.equal(llaveDeLaSesion("#paso-reglas", roto), null)
})

// Revisión independiente: si no se podía guardar la llave nueva y había una vieja guardada, la
// vieja quedaba, y la próxima recarga sin llave en la dirección mandaba ésa.
test("si no se puede guardar la nueva, se saca la que había: no queda una vieja para la próxima recarga", () => {
  const almacen = pestana({ [CLAVE_DE_LA_LLAVE]: "vieja" })
  almacen.setItem = () => { throw new Error("QuotaExceededError") }
  almacen.removeItem = (k) => void almacen.datos.delete(k)
  assert.equal(llaveDeLaSesion("#t=nueva", almacen), "nueva")
  assert.equal(almacen.datos.has(CLAVE_DE_LA_LLAVE), false)
  assert.equal(llaveDeLaSesion("#paso-reglas", almacen), null)
})

test("desde la ventana: dirección + almacén de la pestaña, y un navegador que tira al nombrar el almacén no rompe", () => {
  const almacen = pestana()
  const ventana = { location: { hash: "#t=llave-1" }, sessionStorage: almacen }
  assert.equal(llaveDeEstaPestana(ventana), "llave-1")
  // Un enlace del menú y recargar: la MISMA pestaña, la dirección sin llave.
  ventana.location.hash = "#paso-reglas"
  assert.equal(llaveDeEstaPestana(ventana), "llave-1", "es el recorrido que fallaba: enlace, recargar")
  // Otra pestaña (otro almacén) con esa dirección no la tiene.
  assert.equal(llaveDeEstaPestana({ location: { hash: "#paso-reglas" }, sessionStorage: pestana() }), null)
  // Hay navegadores que tiran con sólo leer `sessionStorage`.
  const queTira = { location: { hash: "#t=abc" }, get sessionStorage() { throw new Error("SecurityError") } }
  assert.equal(llaveDeEstaPestana(queTira), "abc")
  queTira.location.hash = "#paso-reglas"
  assert.equal(llaveDeEstaPestana(queTira), null)
  for (const rara of [null, undefined, {}, { location: null }]) assert.equal(llaveDeEstaPestana(rara), null)
})

function clienteCon(token, respuesta) {
  const pedidos = []
  const estados = []
  const cliente = crearClienteHttp({ fetch: async (ruta, opciones) => { pedidos.push(opciones); return respuesta }, aplicarSnapshot() {}, repintar() {}, mostrarEstado: (t) => estados.push(t), token })
  return { cliente, pedidos, estados }
}
const ACEPTADO = { status: 200, json: async () => ({ resultado: { ok: true }, snapshot: { revision: 2 } }) }
const RECHAZADO_POR_LA_LLAVE = { status: 403, text: async () => "token de sesión inválido" }

test("la llave se puede cambiar con la ventana abierta: cada pedido usa la del momento", async () => {
  let llave = null
  const m = clienteCon(() => llave, ACEPTADO)
  await m.cliente.enviarSobre({ tipo: "AsignarPin" }, { repintarAhora: false })
  assert.equal("X-Tecnia-Token" in m.pedidos[0].headers, false, "sin llave no se manda el header")
  llave = "pegada-despues" // alguien pegó la dirección con la llave en esta pestaña
  await m.cliente.enviarSobre({ tipo: "AsignarPin" }, { repintarAhora: false })
  assert.equal(m.pedidos[1].headers["X-Tecnia-Token"], "pegada-despues")
  // Y la forma de siempre (la llave como valor) sigue andando.
  const fijo = clienteCon("fija", ACEPTADO)
  await fijo.cliente.enviarSobre({ tipo: "AsignarPin" }, { repintarAhora: false })
  assert.equal(fijo.pedidos[0].headers["X-Tecnia-Token"], "fija")
})

// Revisión independiente: tras reiniciar Tecnia Bot en el mismo puerto, la pestaña manda la llave
// de la sesión anterior, el servidor la rechaza y el aviso decía «se abrió sin la llave». Falso:
// la tenía, vencida.
test("una llave vencida no se avisa como «sin llave»: se dice que es de una sesión anterior", async () => {
  const vencida = clienteCon("de-la-sesion-anterior", RECHAZADO_POR_LA_LLAVE)
  await vencida.cliente.enviarSobre({ tipo: "AsignarPin" }, { repintarAhora: false })
  assert.deepEqual(vencida.estados, [LLAVE_QUE_YA_NO_VALE])
  const sinLlave = clienteCon(null, RECHAZADO_POR_LA_LLAVE)
  await sinLlave.cliente.enviarSobre({ tipo: "AsignarPin" }, { repintarAhora: false })
  assert.deepEqual(sinLlave.estados, [SIN_PERMISO])
  assert.notEqual(LLAVE_QUE_YA_NO_VALE, SIN_PERMISO)
  assert.match(LLAVE_QUE_YA_NO_VALE, /no reconoce su llave \(puede ser de una sesión anterior\)/, "dice lo que pasó y lo probable, sin afirmar la causa")
  assert.match(LLAVE_QUE_YA_NO_VALE, /Pedile a Tecnia Bot que abra la vista de nuevo/, "dice cómo seguir")
  assert.doesNotMatch(LLAVE_QUE_YA_NO_VALE, /sin la llave/)
})

// Lo único que sigue siendo texto: que `app.js` use el camino probado arriba y no otro. No prueba
// que funcione (ver el encabezado de esta sección).
test("app.js toma la llave por `llaveDeEstaPestana(window)` y la vuelve a tomar si cambia el fragmento", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  assert.match(app, /let llaveDeLaPestana = enNavegador \? llaveDeEstaPestana\(window\) : null/)
  assert.match(app, /token: \(\) => llaveDeLaPestana,/)
  assert.match(app, /window\.addEventListener\("hashchange", \(\) => \{\n\s+const nueva = llaveDeEstaPestana\(window\)\n\s+if \(nueva !== null\) llaveDeLaPestana = nueva/)
  assert.doesNotMatch(app, /tokenDeLaDireccion\(|localStorage/)
})
