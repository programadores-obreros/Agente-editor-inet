// Arnés compartido de los tests de integración de la vista lógica (T6, T7): servidor HTTP REAL + Engine
// y Almacén reales + la misma composición que hace la página (cliente HTTP + controlador de reglas +
// vista lógica) con Blockly FALSO. Esto NO es un test (no termina en .test.mjs).

import http from "node:http"
import { join } from "node:path"
import assert from "node:assert/strict"
import { REPO, nuevoDir, nuevoIdProyecto, op, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { crearControladorReglas } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))

export const TRIADA = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
export { REPO, op }

/** ESP32 + LED (resistencia en serie, GPIO18) + segundo LED (GPIO17) + pulsador (GPIO4), servidor HTTP real. */
export async function prepararServidor() {
  const directorio = nuevoDir("p3-bl-int")
  const idProyecto = nuevoIdProyecto("p3-bl-int")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  const paso = (tipo, payload, overrides) => {
    const r = servicio.aplicar(op(tipo, payload, servicio.snapshot().revision, overrides))
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
  }
  paso("SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of ["led", "resistencia", "pulsador", "led"]) paso("AgregarComponente", { tipo })
  const cs = servicio.snapshot().proyecto.componentes
  const [led, resistencia, pulsador, led2] = [cs[0].id, cs[1].id, cs[2].id, cs[3].id]
  paso("Conectar", { desde: { componente: led, terminal: "anodo" }, hasta: { componente: resistencia, terminal: "a" } })
  paso("AsignarPin", { componente: led, terminal: "anodo", pin: "GPIO18" })
  paso("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_X })
  paso("AsignarPin", { componente: led2, terminal: "anodo", pin: "GPIO17" })
  const servidor = await iniciarServidor({ servicio })
  return { servicio, servidor, directorio, idProyecto, led, led2, resistencia, pulsador, paso }
}
export async function cerrar(ctx) {
  await ctx.servidor.cerrar()
  ctx.servicio.cerrar()
}

/** `fetch` mínimo hacia el servidor real (manda el Origin que mandaría un navegador). */
export function fetchHacia(ctx) {
  return (ruta, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const url = new URL(ruta, ctx.servidor.url)
      const h = { ...headers }
      if (body !== undefined) { h["Content-Length"] = Buffer.byteLength(body); h.Origin = `http://127.0.0.1:${ctx.servidor.puerto}` }
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: h }, (res) => {
        const trozos = []
        res.on("data", (t) => trozos.push(t))
        res.on("end", () => { const texto = Buffer.concat(trozos).toString("utf8"); resolve({ status: res.statusCode, text: async () => texto, json: async () => JSON.parse(texto) }) })
      })
      req.on("error", reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
}

/** La composición de la página: cliente HTTP + controlador de reglas + vista lógica (Blockly falso). */
export async function montarApp(ctx) {
  const { crearClienteHttp } = await import(join(REPO, "opencode/vista-fisica/web/cliente-http.js"))
  const { crearVistaLogica } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js"))
  const { Blockly, reg } = fabricarBlockly()
  const app = { snapshot: null, estados: [], posts: 0, gets: 0, reg }
  const base = fetchHacia(ctx)
  const fetchContado = (ruta, init) => { if (init?.method === "POST") app.posts++; else app.gets++; return base(ruta, init) }
  let contadorId = 0
  let vista
  const repintar = () => vista.repintar(app.snapshot, { deshabilitado: app.controlador.opciones().operacionPendiente })
  const cliente = crearClienteHttp({ fetch: fetchContado, aplicarSnapshot: (s) => { app.snapshot = s }, repintar, mostrarEstado: (t) => app.estados.push(t), siguienteIdOperacion: () => `bl-${contadorId++}` })
  app.controlador = crearControladorReglas({
    obtenerSnapshot: () => app.snapshot,
    enviar: ({ tipo, payload, baseRevision }) => cliente.enviarSobre({ idOperacion: `bl-${contadorId++}`, actor: "navegador", baseRevision, tipo, payload }, { repintarAhora: false }),
    alCambiar: repintar,
  })
  vista = crearVistaLogica({ Blockly, contenedor: {}, controlador: app.controlador })
  app.vista = vista
  app.cliente = cliente
  app.cargar = async () => { await cliente.cargarSnapshot() }
  app.campo = (slot) => reg.ws.bloques.map((b) => b.campos[slot]).find(Boolean)
  app.valores = () => ["sensor", "estado", "actuador", "salida"].map((s) => app.campo(s).getValue())
  app.esperar = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)) }
  return app
}
