// El servidor local sólo acepta cambios de quien trae el token de la sesión.
//
// POR QUÉ EXISTE ESTE ARCHIVO. La auditoría de código del 2026-11-22 (VIS-04) mostró
// que un programa que no es un navegador podía cambiar pines y reglas del proyecto con
// sólo conocer el puerto: el servidor confiaba en el header `Origin`, y un programa
// manda el `Origin` que quiera. El 2026-11-23 el owner decidió sumar un token por sesión.
//
// QUÉ PROTEGE Y QUÉ NO (sin exagerar; está igual en servidor-proyecto.ts):
//   - SÍ: de otro usuario del sistema operativo en la misma máquina y de pedidos a ciegas.
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
//   - la tool abre `servidor.url` en vez de `urlParaAbrir`        → rojo «la tool» (en wave0-tool)
//
// Corre con: node --test tests/servidor-token-de-sesion.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor, CABECERA_TOKEN } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { crearClienteHttp, tokenDeLaDireccion, SIN_PERMISO } = await import(join(REPO, "opencode/vista-fisica/web/cliente-http.js"))

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
      assert.deepEqual(p.estados, [SIN_PERMISO])
      assert.match(SIN_PERMISO, /Tecnia Bot/, "el texto tiene que decir cómo seguir")
      assert.equal(p.snapshot(), antes, "el cliente pisó el último snapshot bueno con el cuerpo de un 403")
      assert.equal(p.repintadas(), repintadasAntes + 1, "tiene que repintar: el control no puede quedar mostrando un cambio que no se hizo")
      assert.equal(pinDelLed(servicio, led), GPIO_X)
    }
  })
})
