// Sección «Código» de la ventana — el programa lo muestra el PROGRAMA, no el asistente.
//
// HISTORIA (2026-11-24, notebook real del dueño). El docente pidió «mostrame el código». El
// asistente generó y compiló bien (94 líneas, dos reglas), leyó el archivo y lo reescribió en el
// chat: 25 líneas, UNA regla, y dijo que era el generado. Ninguna de las 3.699 pruebas de ese día
// podía verlo: todas prueban por debajo del modelo. La salida fue sacar el dato de sus manos: el
// código se ve en la ventana, puesto por el servidor desde el mismo generador que compila y carga.
//
// Lo que estas pruebas custodian, en orden de gravedad:
//   1. lo que sirve `/api/programa` es BYTE A BYTE lo que da `generarPrograma` para ese proyecto;
//   2. la revisión y el programa salen del mismo estado;
//   3. la página NUNCA deja a la vista un programa de otra revisión;
//   4. cuando no hay programa, no hay código en pantalla y sí el porqué, sin códigos internos.
//
// SEGUNDA VUELTA (2026-11-25). Una revisión independiente encontró que la primera versión de este
// archivo dejaba pasar doce roturas. Las más serias: el panel se actualizaba al FINAL del
// repintado (si algo cortaba antes, quedaba el programa viejo bajo una cabecera nueva); el caso
// "otra revisión" sólo se probaba con una revisión MAYOR; el cableado de app.js se miraba con una
// sola expresión regular; y dos textos prometían de más ("lo que falta está en Motivos" con
// Motivos vacío, "es el que se carga"). Cada prueba agregada por eso lo dice.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor, PROGRAMA_NO_DISPONIBLE } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { programaParaVista, TODAVIA_NO_ESTA_LISTO, TODAVIA_FALTA_ARMAR, TODAVIA_NO_SE_SABE_PROGRAMAR } = await import(join(REPO, "opencode/vista-fisica/programa-para-vista.ts"))
const web = await import(join(REPO, "opencode/vista-fisica/web/vista-codigo.js"))

// ── el proyecto del caso real: pulsador → LED y DHT22 > 35 °C → LED 2 ─────────────────────────
let n = 0
function aplicar(servicio, tipo, payload) {
  const r = servicio.aplicar({ idOperacion: `vc-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
}
const idDe = (servicio, tipo, k = 0) => servicio.snapshot().proyecto.componentes.filter((c) => c.tipo === tipo)[k].id
function ledConResistencia(servicio, k, pin) {
  aplicar(servicio, "AgregarComponente", { tipo: "led" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", k), terminal: "anodo", pin })
  aplicar(servicio, "AgregarComponente", { tipo: "resistencia" })
  aplicar(servicio, "Conectar", { desde: { componente: idDe(servicio, "resistencia", k), terminal: "a" }, hasta: { componente: idDe(servicio, "led", k), terminal: "anodo" } })
}
function proyectoDelCaso({ listo = true } = {}) {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("vista-codigo"), idProyecto: nuevoIdProyecto("vista-codigo") })
  aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  if (listo) ledConResistencia(servicio, 0, "GPIO4")
  else {
    aplicar(servicio, "AgregarComponente", { tipo: "led" })
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led"), terminal: "anodo", pin: "GPIO4" })
  }
  aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
  aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led"), accion: "encender" } } })
  if (listo) {
    ledConResistencia(servicio, 1, "GPIO19")
    aplicar(servicio, "AgregarComponente", { tipo: "dht22" })
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "dht22"), terminal: "senal", pin: "GPIO13" })
    aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "dht22"), capacidad: "temperatura", comparador: ">", umbral: { valor: 35, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: idDe(servicio, "led", 1), accion: "encender" } } })
  }
  return servicio
}
const programaDe = (snapshot) => programaParaVista(generarPrograma(snapshot.proyecto, K))

function pedir(servidor, ruta, { metodo = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(ruta, servidor.url)
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: metodo }, (res) => {
      const trozos = []
      res.on("data", (t) => trozos.push(t))
      res.on("end", () => resolve({ estado: res.statusCode, cabeceras: res.headers, texto: Buffer.concat(trozos).toString("utf8") }))
    })
    req.on("error", reject)
    req.end()
  })
}
async function conServidor(servicio, opciones, cuerpo) {
  const servidor = await iniciarServidor({ servicio, ...opciones })
  try {
    return await cuerpo(servidor)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
}

// ═══ 1. el programa para la vista (puro) ══════════════════════════════════════════════════════

test("programa para la vista: con el proyecto del caso, el código es el main.cpp generado, entero, con sus DOS reglas", () => {
  const servicio = proyectoDelCaso()
  const generado = generarPrograma(servicio.snapshot().proyecto, K)
  assert.equal(generado.ok, true)
  const p = programaParaVista(generado)
  assert.equal(p.ok, true)
  assert.equal(p.codigo, generado.archivos["src/main.cpp"], "ni una letra distinta")
  assert.equal(p.archivo, "src/main.cpp")
  assert.equal(p.lineas, generado.archivos["src/main.cpp"].replace(/\n$/, "").split("\n").length)
  assert.equal(p.lineas, 94, "el mismo tamaño que tenía el archivo en la notebook")
  const reglas = servicio.snapshot().proyecto.comportamientos.map((c) => c.id.replace("-", "_"))
  assert.equal(reglas.length, 2)
  for (const id of reglas) assert.ok(p.codigo.includes(`const bool ${id} =`), `falta la regla ${id}: es justo lo que el asistente se salteó`)
  servicio.cerrar()
})

test("programa para la vista: proyecto que todavía no cierra → sin código, manda a Motivos, sin códigos internos", () => {
  const servicio = proyectoDelCaso({ listo: false })
  const generado = generarPrograma(servicio.snapshot().proyecto, K)
  assert.equal(generado.ok, false)
  assert.equal(generado.error.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  const p = programaParaVista(generado)
  assert.deepEqual(p, { ok: false, porQue: TODAVIA_NO_ESTA_LISTO })
  assert.match(p.porQue, /Motivos/)
  servicio.cerrar()
})

// Lo vio la revisión: con el proyecto recién empezado (sin placa) el generador también dice "no
// listo", pero la sección Motivos está VACÍA. Mandar al docente ahí era mentirle.
test("programa para la vista: no listo y sin ningún motivo que frene → NO manda a Motivos", () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("vista-codigo-vacio"), idProyecto: nuevoIdProyecto("vista-codigo-vacio") })
  const generado = generarPrograma(servicio.snapshot().proyecto, K)
  assert.equal(generado.ok, false)
  assert.equal(generado.error.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  assert.deepEqual(servicio.snapshot().vista.motivos, [], "el caso: Motivos está vacío")
  assert.deepEqual(programaParaVista(generado), { ok: false, porQue: TODAVIA_FALTA_ARMAR })
  assert.doesNotMatch(TODAVIA_FALTA_ARMAR, /Motivos/)
  servicio.cerrar()
  // Un motivo que sólo informa (no frena) tampoco alcanza para mandar a Motivos.
  const soloInforma = { ok: false, error: { codigo: "CODEGEN_PROYECTO_NO_LISTO", datos: { motivos: [{ codigo: "PIN_STRAPPING", severidad: "info" }] } } }
  assert.equal(programaParaVista(soloInforma).porQue, TODAVIA_FALTA_ARMAR)
  for (const datos of [{}, { motivos: null }, { motivos: "x" }, { motivos: [null, 3] }]) {
    assert.equal(programaParaVista({ ok: false, error: { codigo: "CODEGEN_PROYECTO_NO_LISTO", datos } }).porQue, TODAVIA_FALTA_ARMAR)
  }
})

test("programa para la vista: cualquier otro rechazo del generador → 'todavía no se sabe programar', nunca el código interno", () => {
  for (const codigo of ["CODEGEN_NO_ADMITIDO", "CODEGEN_SIN_LECTURA", "CODEGEN_PROTOCOLO_SIN_BACKEND", "CODEGEN_DATO_NO_EMITIBLE"]) {
    const p = programaParaVista({ ok: false, error: { codigo, datos: { tipo: "ntc", cmp: "cmp-3" } } })
    assert.deepEqual(p, { ok: false, porQue: TODAVIA_NO_SE_SABE_PROGRAMAR })
  }
  for (const texto of [TODAVIA_NO_ESTA_LISTO, TODAVIA_FALTA_ARMAR, TODAVIA_NO_SE_SABE_PROGRAMAR, PROGRAMA_NO_DISPONIBLE]) assert.doesNotMatch(texto, /CODEGEN|cmp-|beh-|[{}]/)
})

test("programa para la vista: cuenta líneas como quien lee (el salto final no suma una vacía)", () => {
  const con = (codigo) => programaParaVista({ ok: true, archivos: { "platformio.ini": "", "src/main.cpp": codigo }, environment: "x", advertencias: [] }).lineas
  assert.equal(con("a\nb\n"), 2)
  assert.equal(con("a\nb"), 2)
  assert.equal(con("a\n\nb\n"), 3)
  assert.equal(con(""), 0)
})

// ═══ 2. la ruta del servidor ══════════════════════════════════════════════════════════════════

test("GET /api/programa: byte a byte lo que da el generador para ESE proyecto, con la revisión de /api/proyecto", async () => {
  const servicio = proyectoDelCaso()
  await conServidor(servicio, { programaDe }, async (servidor) => {
    const r = await pedir(servidor, "/api/programa")
    assert.equal(r.estado, 200)
    assert.match(r.cabeceras["content-type"], /application\/json/)
    assert.equal(r.cabeceras["cache-control"], "no-store")
    const cuerpo = JSON.parse(r.texto)
    const proyecto = JSON.parse((await pedir(servidor, "/api/proyecto")).texto)
    assert.equal(cuerpo.revision, proyecto.revision)
    assert.equal(cuerpo.programa.codigo, generarPrograma(servicio.snapshot().proyecto, K).archivos["src/main.cpp"])
  })
})

test("GET /api/programa: después de un cambio en el proyecto, cambian la revisión Y el programa (no queda guardado el anterior)", async () => {
  const servicio = proyectoDelCaso()
  await conServidor(servicio, { programaDe }, async (servidor) => {
    const antes = JSON.parse((await pedir(servidor, "/api/programa")).texto)
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", 1), terminal: "anodo", pin: "GPIO18" })
    const despues = JSON.parse((await pedir(servidor, "/api/programa")).texto)
    assert.equal(despues.revision, antes.revision + 1)
    assert.notEqual(despues.programa.codigo, antes.programa.codigo)
    assert.match(despues.programa.codigo, /= 18;/)
    assert.doesNotMatch(despues.programa.codigo, /= 19;/)
    assert.match(despues.programa.codigo, new RegExp(`revision: ${despues.revision} `), "el propio archivo dice de qué revisión es")
  })
})

test("GET /api/programa: la revisión y el programa salen del MISMO estado, aunque el proyecto cambie mientras se arma", async () => {
  const servicio = proyectoDelCaso()
  // Un `programaDe` que cambia el proyecto mientras lo arman: si el servidor tomara la revisión
  // DESPUÉS de armar el programa (o de otro snapshot), devolvería programa viejo con revisión nueva.
  const programaQueMueveElProyecto = (snapshot) => {
    const p = programaDe(snapshot)
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", 1), terminal: "anodo", pin: "GPIO18" })
    return p
  }
  await conServidor(servicio, { programaDe: programaQueMueveElProyecto }, async (servidor) => {
    const cuerpo = JSON.parse((await pedir(servidor, "/api/programa")).texto)
    assert.match(cuerpo.programa.codigo, new RegExp(`revision: ${cuerpo.revision} `), "la revisión que se informa es la del programa que se manda")
    assert.match(cuerpo.programa.codigo, /= 19;/)
  })
})

test("/api/programa: sólo lectura (POST → 405), HEAD sin cuerpo, y sin generador inyectado la ruta no existe (404)", async () => {
  // Por mutación se vio que mirar sólo "HEAD sin cuerpo" no prueba nada: Node le saca el cuerpo a
  // toda respuesta de un HEAD. Lo que distingue la rama es que un HEAD NO manda a generar.
  let generados = 0
  const contando = (snapshot) => { generados += 1; return programaDe(snapshot) }
  await conServidor(proyectoDelCaso(), { programaDe: contando }, async (servidor) => {
    const post = await pedir(servidor, "/api/programa", { metodo: "POST" })
    assert.equal(post.estado, 405)
    const head = await pedir(servidor, "/api/programa", { metodo: "HEAD" })
    assert.equal(head.estado, 200)
    assert.equal(head.texto, "")
    assert.equal(generados, 0, "ni el POST rechazado ni el HEAD generan el programa")
    await pedir(servidor, "/api/programa")
    assert.equal(generados, 1)
  })
  await conServidor(proyectoDelCaso(), {}, async (servidor) => {
    assert.equal((await pedir(servidor, "/api/programa")).estado, 404)
  })
})

test("/api/programa: si armar el programa tira una excepción, responde un error llano y el servidor sigue atendiendo", async () => {
  const servicio = proyectoDelCaso()
  await conServidor(servicio, { programaDe: () => { throw new Error("explotó cmp-9 adentro") } }, async (servidor) => {
    const r = await pedir(servidor, "/api/programa")
    assert.equal(r.estado, 500)
    const cuerpo = JSON.parse(r.texto)
    assert.deepEqual(cuerpo, { revision: servicio.snapshot().revision, programa: { ok: false, porQue: PROGRAMA_NO_DISPONIBLE } })
    assert.doesNotMatch(r.texto, /explotó|cmp-9/, "el detalle interno no viaja")
    assert.equal((await pedir(servidor, "/api/proyecto")).estado, 200, "el pedido no quedó colgado ni tiró el servidor")
  })
})

// La red general del servidor (revisión del 2026-11-25): antes, una excepción fuera del try de la
// ruta dejaba el pedido colgado para siempre. Estos pedidos llevan su propio límite de tiempo: un
// cuelgue tiene que dar ROJO, no trabar la corrida.
const conLimite = (promesa, ms = 3000) => Promise.race([promesa, new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("el pedido quedó colgado")), ms).unref())])

test("servidor: una respuesta que no se puede serializar contesta 500 en vez de colgar el pedido", async () => {
  const ciclico = {}
  ciclico.yo = ciclico
  await conServidor(proyectoDelCaso(), { programaDe: () => ciclico }, async (servidor) => {
    const r = await conLimite(pedir(servidor, "/api/programa"))
    assert.equal(r.estado, 500)
    assert.equal(r.texto, "Error interno", "el detalle de la falla no viaja")
    assert.equal((await conLimite(pedir(servidor, "/api/proyecto"))).estado, 200, "y sigue atendiendo")
  })
})

test("servidor: si leer el proyecto tira (servicio cerrado), contesta 500 en las dos lecturas en vez de colgar", async () => {
  const servicio = proyectoDelCaso()
  const servidor = await iniciarServidor({ servicio, programaDe })
  try {
    servicio.cerrar()
    assert.throws(() => servicio.snapshot(), "el caso: snapshot() tira con el servicio cerrado")
    for (const ruta of ["/api/programa", "/api/proyecto"]) {
      const r = await conLimite(pedir(servidor, ruta))
      assert.equal(r.estado, 500, ruta)
      assert.equal(r.texto, "Error interno", `${ruta}: el detalle de la falla no viaja`)
    }
    // La otra rama de la red: en el flujo de eventos las cabeceras YA salieron cuando el servicio
    // tira, así que no se puede contestar 500. La conexión se tiene que CORTAR (antes quedaba
    // abierta para siempre) y el servidor seguir atendiendo.
    const eventos = await conLimite(new Promise((resolver) => {
      const url = new URL("/api/eventos", servidor.url)
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "GET" }, (res) => {
        res.on("data", () => {})
        res.on("close", () => resolver({ estado: res.statusCode, cerrada: true }))
        res.on("error", () => {})
      })
      req.on("error", () => resolver({ estado: null, cerrada: true }))
      req.end()
    }))
    assert.equal(eventos.cerrada, true, "el flujo de eventos no queda colgado")
    assert.equal((await conLimite(pedir(servidor, "/"))).estado, 200, "y el servidor sigue atendiendo")
  } finally {
    await servidor.cerrar()
  }
})

// ═══ 3. el panel de la página ═════════════════════════════════════════════════════════════════

const elemento = () => ({ textContent: "", hidden: true })
/** Un `fetch` que se resuelve a mano: cada pedido queda pendiente hasta que el test lo contesta. */
function fetchManual() {
  const pedidos = []
  const fetch = (ruta) => new Promise((resolver, rechazar) => pedidos.push({ ruta, resolver, rechazar }))
  const contestar = (i, cuerpo, status = 200) => pedidos[i].resolver({ status, json: async () => cuerpo })
  return { fetch, pedidos, contestar }
}
const PROG = (revision, codigo = `// revision: ${revision}\nvoid x();\n`) => ({ revision, programa: { ok: true, archivo: "src/main.cpp", codigo, lineas: 2 } })
function montar() {
  const f = fetchManual()
  const el = { codigo: elemento(), aviso: elemento() }
  const panel = web.crearPanelCodigo({ fetch: f.fetch, elementoCodigo: el.codigo, elementoAviso: el.aviso })
  return { ...f, el, panel }
}

test("panel: pinta el código tal cual llegó, con textContent, y dice de qué revisión es", async () => {
  const m = montar()
  const listo = m.panel.actualizar({ revision: 7 })
  assert.equal(m.pedidos[0].ruta, "/api/programa")
  assert.equal(m.el.aviso.textContent, web.TEXTO_ACTUALIZANDO)
  assert.equal(m.el.codigo.hidden, true)
  m.contestar(0, PROG(7, "linea <b>uno</b>\nlinea dos\n"))
  await listo
  assert.equal(m.el.codigo.textContent, "linea <b>uno</b>\nlinea dos\n", "sin tocar: ni recorte ni formato")
  assert.equal(m.el.codigo.hidden, false)
  assert.equal(m.el.aviso.textContent, web.pieDelPrograma({ revision: 7, archivo: "src/main.cpp", lineas: 2 }))
  assert.match(m.el.aviso.textContent, /revisión 7/)
  assert.match(m.el.aviso.textContent, /no lo escribe el asistente/)
  // El pie afirma sólo lo que el código garantiza. "Es el que se carga" no lo garantiza nadie:
  // la carga tiene sus propios frenos y esto no sabe qué hay en la placa.
  assert.match(m.el.aviso.textContent, /No dice qué programa tiene hoy la placa/)
  assert.doesNotMatch(m.el.aviso.textContent, /se carga|cargad|desde las reglas/)
})

test("panel: al cambiar la revisión, el programa anterior se BORRA antes de que llegue el nuevo", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  assert.equal(m.el.codigo.hidden, false)
  const b = m.panel.actualizar({ revision: 8 })
  assert.equal(m.el.codigo.textContent, "", "con la revisión 8 en la cabecera no puede quedar el programa de la 7")
  assert.equal(m.el.codigo.hidden, true)
  assert.equal(m.el.aviso.textContent, web.TEXTO_ACTUALIZANDO)
  m.contestar(1, PROG(8))
  await b
  assert.match(m.el.codigo.textContent, /revision: 8/)
})

test("panel: una respuesta de otra revisión NO se pinta, y el próximo repintado vuelve a pedir", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 8 })
  m.contestar(0, PROG(9))
  await a
  assert.equal(m.el.codigo.textContent, "")
  assert.equal(m.el.codigo.hidden, true)
  assert.equal(m.el.aviso.textContent, web.TEXTO_ACTUALIZANDO)
  const b = m.panel.actualizar({ revision: 8 })
  assert.equal(m.pedidos.length, 2, "reintenta: no se queda para siempre en 'actualizando'")
  m.contestar(1, PROG(8))
  await b
  assert.match(m.el.codigo.textContent, /revision: 8/)
})

// La primera versión sólo probaba una respuesta con revisión MAYOR. Con `>` en vez de `!==` se
// pintaba un programa más VIEJO con pie de la revisión nueva, y la suite seguía verde.
test("panel: una respuesta de una revisión ANTERIOR tampoco se pinta", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 8 })
  m.contestar(0, PROG(7))
  await a
  assert.equal(m.el.codigo.textContent, "")
  assert.equal(m.el.codigo.hidden, true)
  assert.equal(m.el.aviso.textContent, web.TEXTO_ACTUALIZANDO)
})

test("panel: la FALLA tardía de un pedido viejo no borra el programa nuevo", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  const b = m.panel.actualizar({ revision: 8 })
  m.contestar(1, PROG(8))
  await b
  m.pedidos[0].rechazar(new Error("se cortó el pedido viejo"))
  await a
  assert.match(m.el.codigo.textContent, /revision: 8/)
  assert.equal(m.el.codigo.hidden, false)
  await m.panel.actualizar({ revision: 8 })
  assert.equal(m.pedidos.length, 2, "y no deja marcado un reintento que no corresponde")
})

test("panel: después de un reintento que salió bien, la misma revisión no se vuelve a pedir", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.pedidos[0].rechazar(new Error("sin red"))
  await a
  const b = m.panel.actualizar({ revision: 7 })
  m.contestar(1, PROG(7))
  await b
  await m.panel.actualizar({ revision: 7 })
  await m.panel.actualizar({ revision: 7 })
  assert.equal(m.pedidos.length, 2, "si no, cada repintado borraría y volvería a pedir para siempre")
  assert.equal(m.el.codigo.hidden, false)
})

test("panel: una falla de Tecnia Bot (500) muestra el porqué del servidor, no 'esta instalación no trae…', y se reintenta", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, { revision: 7, programa: { ok: false, porQue: PROGRAMA_NO_DISPONIBLE } }, 500)
  await a
  assert.equal(m.el.aviso.textContent, PROGRAMA_NO_DISPONIBLE)
  assert.equal(m.el.codigo.hidden, true)
  const b = m.panel.actualizar({ revision: 7 })
  assert.equal(m.pedidos.length, 2)
  m.contestar(1, PROG(7))
  await b
  assert.equal(m.el.codigo.hidden, false)
})

test("panel: un snapshot sin revisión no pide nada ni toca lo que hay", async () => {
  const m = montar()
  for (const snapshot of [null, undefined, {}, { revision: "7" }]) await m.panel.actualizar(snapshot)
  assert.equal(m.pedidos.length, 0)
  assert.equal(m.el.aviso.textContent, "")
})

test("panel: desconectada SIN programa a la vista no dice 'este programa puede no ser el actual'", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 }, { conectado: false })
  m.contestar(0, { revision: 7, programa: { ok: false, porQue: TODAVIA_FALTA_ARMAR } })
  await a
  assert.equal(m.el.aviso.textContent, TODAVIA_FALTA_ARMAR)
})

test("panel: una respuesta que llega tarde (de un pedido viejo) se descarta", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  const b = m.panel.actualizar({ revision: 8 })
  m.contestar(1, PROG(8))
  await b
  m.contestar(0, PROG(7))
  await a
  assert.match(m.el.codigo.textContent, /revision: 8/, "la respuesta vieja no pisa a la nueva")
  assert.match(m.el.aviso.textContent, /revisión 8/)
})

test("panel: la misma revisión no vuelve a pedir (se repinta muy seguido)", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  await m.panel.actualizar({ revision: 7 })
  await m.panel.actualizar({ revision: 7 })
  assert.equal(m.pedidos.length, 1)
  assert.equal(m.el.codigo.hidden, false)
})

test("panel: sin programa → no hay código en pantalla y se lee el porqué que mandó el servidor", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  const b = m.panel.actualizar({ revision: 8 })
  m.contestar(1, { revision: 8, programa: { ok: false, porQue: TODAVIA_NO_ESTA_LISTO } })
  await b
  assert.equal(m.el.codigo.textContent, "")
  assert.equal(m.el.codigo.hidden, true)
  assert.equal(m.el.aviso.textContent, TODAVIA_NO_ESTA_LISTO)
  await m.panel.actualizar({ revision: 8 })
  assert.equal(m.pedidos.length, 2, "un 'no hay programa' firme no se reintenta en cada repintado")
})

test("panel: instalación sin la parte que genera (404) → lo dice; pedido que falla → lo dice y reintenta", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, null, 404)
  await a
  assert.equal(m.el.aviso.textContent, web.TEXTO_SIN_SECCION)
  assert.equal(m.el.codigo.hidden, true)

  const n = montar()
  const b = n.panel.actualizar({ revision: 7 })
  n.pedidos[0].rechazar(new Error("sin red"))
  await b
  assert.equal(n.el.aviso.textContent, web.TEXTO_NO_SE_PUDO_PEDIR)
  assert.equal(n.el.codigo.hidden, true)
  const c = n.panel.actualizar({ revision: 7 })
  assert.equal(n.pedidos.length, 2)
  n.contestar(1, PROG(7))
  await c
  assert.equal(n.el.codigo.hidden, false)
})

test("panel: una respuesta rara (sin código, o que no es texto) nunca se pinta como programa", async () => {
  for (const programa of [{ ok: true }, { ok: true, codigo: 42 }, null, { ok: "true", codigo: "x" }]) {
    const m = montar()
    const a = m.panel.actualizar({ revision: 7 })
    m.contestar(0, { revision: 7, programa })
    await a
    assert.equal(m.el.codigo.textContent, "")
    assert.equal(m.el.codigo.hidden, true)
    assert.equal(m.el.aviso.textContent, web.TEXTO_NO_SE_PUDO_PEDIR)
  }
})

test("panel: desconectada con un programa a la vista → avisa que puede no ser el actual; al reconectar se va el aviso", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  await m.panel.actualizar({ revision: 7 }, { conectado: false })
  assert.ok(m.el.aviso.textContent.startsWith(web.TEXTO_DESCONECTADA))
  assert.match(m.el.aviso.textContent, /revisión 7/)
  await m.panel.actualizar({ revision: 7 }, { conectado: true })
  assert.ok(!m.el.aviso.textContent.includes(web.TEXTO_DESCONECTADA))
})

// ═══ 4. la página y el enganche ═══════════════════════════════════════════════════════════════

test("index.html: sección «Código» después de la Vista lógica, con su <pre> oculto de entrada y su aviso", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  assert.match(html, /<h2>Código<\/h2>/)
  assert.match(html, /<pre id="vista-codigo-texto"[^>]*\bhidden\b/)
  assert.match(html, /id="vista-codigo-aviso"/)
  assert.ok(html.indexOf("<h2>Vista lógica</h2>") < html.indexOf("<h2>Código</h2>"))
  assert.ok(html.indexOf("<h2>Código</h2>") < html.indexOf("<h2>Motivos</h2>"))
  // El texto fijo se ve también sin programa: no puede hablar de "estas líneas" ni prometer una
  // relación regla → bloque → líneas que la página todavía no muestra.
  assert.match(html, /<p id="vista-codigo-etiqueta">Es el programa que sale del montaje y de las reglas de arriba\.<\/p>/)
})

// La primera versión miraba el cableado con UNA expresión regular: se podía no crear el panel,
// pedirle un elemento que no existe o pasarle la conexión al revés, y seguía verde.
test("app.js: el panel se crea, con elementos que EXISTEN en la página, y recibe la conexión al derecho", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const creacion = /\n  panelCodigo = crearPanelCodigo\(\{([\s\S]*?)\n  \}\)/.exec(app)
  assert.ok(creacion, "el panel se asigna a `panelCodigo` (no se crea y se tira)")
  const ids = [...creacion[1].matchAll(/getElementById\("([^"]+)"\)/g)].map((x) => x[1])
  assert.deepEqual(ids, ["vista-codigo-texto", "vista-codigo-aviso"])
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `index.html no tiene #${id}`)
  assert.match(creacion[1], /elementoCodigo: document\.getElementById\("vista-codigo-texto"\)/)
  assert.match(creacion[1], /elementoAviso: document\.getElementById\("vista-codigo-aviso"\)/)
  // Todo id que app.js busca tiene que existir en la página (vale para todas las secciones).
  for (const [, id] of app.matchAll(/getElementById\("([^"]+)"\)/g)) assert.match(html, new RegExp(`id="${id}"`), `app.js busca #${id} y index.html no lo tiene`)
})

// El defecto más serio que encontró la primera revisión: el panel se actualizaba en la ÚLTIMA línea
// de `repintar()`. La cabecera ya decía "revisión N+1" y, si algo cortaba en el medio (el `return`
// de un snapshot sin vista, o un pintado que tira), quedaba a la vista el programa de la N.
//
// La primera prueba de ese arreglo comparaba POSICIONES en el texto de la fuente. La segunda
// revisión mostró que dejaba pasar un `if (false)` delante de la llamada, o un `return` escrito de
// otra forma. Ahora la cabecera y el panel viven en `repintarCabecera`, que se prueba ejecutándola.
const { repintarCabecera } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const LISTO = { listo: true, invalido: false }
function cabecera(panelCodigo) {
  const el = { revision: { textContent: "" }, readiness: { textContent: "" } }
  const pintar = (snapshot, conectado = true) => repintarCabecera({ snapshot, elementoRevision: el.revision, elementoReadiness: el.readiness, panelCodigo, conectado })
  return { el, pintar }
}

test("cabecera: escribe la revisión y, en la misma pasada, le avisa al panel de código con ESE snapshot", () => {
  const llamadas = []
  const c = cabecera({ actualizar: (snapshot, opciones) => llamadas.push({ snapshot, opciones }) })
  const snapshot = { revision: 14, vista: { readiness: LISTO } }
  c.pintar(snapshot, false)
  assert.equal(c.el.revision.textContent, "revisión: 14")
  assert.equal(c.el.readiness.textContent, "listo")
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].snapshot, snapshot)
  assert.deepEqual(llamadas[0].opciones, { conectado: false })
})

test("cabecera: un snapshot SIN vista también actualiza el panel (era el camino que dejaba el programa viejo)", () => {
  const revisiones = []
  const c = cabecera({ actualizar: (snapshot) => revisiones.push(snapshot.revision) })
  c.pintar({ revision: 15, validacion: { readiness: { listo: false, invalido: false } } })
  assert.equal(c.el.revision.textContent, "revisión: 15")
  assert.equal(c.el.readiness.textContent, "incompleto")
  assert.deepEqual(revisiones, [15])
})

test("cabecera: si el panel de código tira, no corta el repintado (ni la cabecera)", () => {
  const c = cabecera({ actualizar: () => { throw new TypeError("Cannot set properties of null") } })
  assert.doesNotThrow(() => c.pintar({ revision: 16, vista: { readiness: { listo: false, invalido: true } } }))
  assert.equal(c.el.revision.textContent, "revisión: 16")
  assert.equal(c.el.readiness.textContent, "inválido")
  assert.doesNotThrow(() => cabecera(null).pintar({ revision: 1, vista: { readiness: LISTO } }), "sin panel (página sin la sección) tampoco rompe")
})

// Esto SÍ es una comprobación sobre el texto, y sólo dice lo que dice: que `repintar()` empieza
// por la cabecera, sin nada en el medio que pueda saltearla. No reemplaza a las tres de arriba.
test("app.js: repintar() empieza, sin nada antes, por repintarCabecera con el snapshot y el panel de la página", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  const cuerpo = /\nfunction repintar\(\) \{\n([\s\S]*?)\n\}\n/.exec(app)[1]
  const esperado = [
    "  if (!ultimoSnapshot) return",
    '  repintarCabecera({ snapshot: ultimoSnapshot, elementoRevision, elementoReadiness, panelCodigo, conectado: estadoConexion === "conectado" })',
  ]
  assert.deepEqual(cuerpo.split("\n").slice(0, 2), esperado)
  assert.equal(app.split("panelCodigo?.actualizar(").length, 2, "el panel se actualiza en un solo lugar: la cabecera")
})

test("app.js: el panel nunca arma ni transforma el programa", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  assert.match(app, /panelCodigo\?\.actualizar\(snapshot, \{ conectado \}\)/)
  const panel = readFileSync(join(REPO, "opencode/vista-fisica/web/vista-codigo.js"), "utf8")
  assert.match(panel, /elementoCodigo\.textContent = programa\.codigo\n/, "el código se pone entero y sin transformar")
  assert.doesNotMatch(panel, /innerHTML|\.slice\(|\.substring\(|\.replace\(/, "ni HTML ni recortes sobre el programa")
})

test("tool vista-fisica: el servidor que levanta sirve el programa con el generador de siempre; el generador se carga perezoso y aparte", async () => {
  const fuente = readFileSync(join(REPO, "opencode/tool/vista-fisica.ts"), "utf8")
  assert.doesNotMatch(fuente, /^import\s+(?!type)[^\n]*codegen\//m, "codegen nunca en caliente: si falta, la tool tiene que importar igual")
  const enCargarServidor = /async function cargarServidor\(\)[\s\S]*?\n}\n/.exec(fuente)[0]
  assert.doesNotMatch(enCargarServidor, /codegen/, "fuera del Promise.all de la vista: sin codegen/ la vista abre igual, sin la sección")
  // Instalación sin `codegen/`: el import falla y la vista tiene que abrir igual, sin la sección.
  const { cargarProgramaDe } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
  assert.equal(await cargarProgramaDe(K, () => Promise.reject(new Error("Cannot find module ../codegen/programa.ts"))), null)
  assert.equal(typeof (await cargarProgramaDe(K)), "function")
  const { obtenerServidorVistaFisica, directorioDeDatos, ID_PROYECTO_DEFAULT } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
  const dir = nuevoDir("vista-codigo-tool")
  const { servidor, servicio } = await obtenerServidorVistaFisica(dir, ID_PROYECTO_DEFAULT)
  try {
    assert.ok(directorioDeDatos(dir))
    aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
    ledConResistencia(servicio, 0, "GPIO4")
    aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
    aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led"), accion: "encender" } } })
    const cuerpo = JSON.parse((await pedir(servidor, "/api/programa")).texto)
    assert.equal(cuerpo.revision, servicio.snapshot().revision)
    assert.equal(cuerpo.programa.codigo, generarPrograma(servicio.snapshot().proyecto, K).archivos["src/main.cpp"])
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})
