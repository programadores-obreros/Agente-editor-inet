// Component System Foundation #1 — F8: guardias de arquitectura A–J (Decision Freeze,
// 08-ARCHITECTURE-GUARDS / D-01, D-03, D-04, D-05, D-09, D-10, D-17).
//
//  A. ComponentKnowledge es de sólo lectura (congelado, sin mutadores).
//  B. Una sola instancia del catálogo por runtime: la raíz de composición, la vista y
//     el conocimiento comparten la MISMA referencia.
//  C. Presentación (alias, toolchain, anexos) NO cambia el hash semántico.
//  D. Significado SÍ lo cambia; y cambiarlo sin subir la versión rompe un test.
//  E. createdWith no se reescribe al recargar ni al commitear con desfase.
//  F. El desfase llega al snapshot (motivo + catalogoActivo).
//  G. El desfase no bloquea: la readiness no cambia por él.
//  H. Terminales de potencia: conectables, nunca asignables.
//  I. La admisión pasa para el conjunto inicial.
//  J. Un componente sin representación se MARCA en la vista, nunca se omite en silencio.
//  +  Guardias estáticas de dependencias (núcleo sin conocimiento/vista/tool/Wokwi;
//     tools sin catálogo sacado de la vista) e identidad heredada.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto } from "./phase2-helpers.mjs"

const { CATALOGO_ACTIVO } = await import(join(REPO, "opencode/nucleo/catalogo-activo.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { oficialmenteSoportados } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { catalogoReal, vistaDeProyectoConCatalogoReal } = await import(join(REPO, "opencode/vista-fisica/vista-real.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { IDENTIDADES_HEREDADAS } = await import(join(REPO, "opencode/nucleo/identidad-catalogo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

const conocimiento = CONOCIMIENTO_ACTIVO
const HASH_HEREDADO = "708fe82235f66231afdb5a6040d7b903b4f80bb8473901df66889703e16c9870"
/** Par (versión, hash semántico) fijado: si el hash cambia, la versión tiene que subir. */
// Semantic Vertical #3: el complemento encender ↔ apagar (DEFINICIONES_ACCION) cambió el
// significado del catálogo → 2.1.0. La identidad 2.0.0 queda como destino de la tabla de
// identidades heredadas (Foundation #1), que NO se encadena: un proyecto 2.0.0 muestra desfase.
const IDENTIDAD_2_0_0 = { version: "2.0.0", hash: "878011f7ec8c586adc632db819e5bcb05fc7731237d21caf01de222574a3a2f6" }
const IDENTIDAD_FIJADA = { version: "2.1.0", hash: "8bc928045bdf5915756103ef67bdad7a5ef0acfeb15cf4f069a86ee7dd43ff9a" }

// ════════════════════════════════════════════════════════════════════════════════════
// A — sólo lectura
// ════════════════════════════════════════════════════════════════════════════════════

test("A: la fachada, su catálogo y lo que devuelve están congelados (no hay forma de mutarlos)", () => {
  assert.ok(Object.isFrozen(conocimiento))
  assert.ok(Object.isFrozen(conocimiento.catalogo))
  assert.throws(() => {
    conocimiento.catalogo = null
  }, TypeError)
  assert.throws(() => {
    conocimiento.nuevoMetodo = () => {}
  }, TypeError)
  const potencia = conocimiento.terminalesDePotencia("esp32-devkit-v1")
  assert.ok(Object.isFrozen(potencia) && potencia.every(Object.isFrozen))
  const pines = conocimiento.pinesPermitidos("esp32-devkit-v1", "led", "anodo")
  assert.ok(Object.isFrozen(pines) && pines.every(Object.isFrozen))
  assert.ok(Object.isFrozen(conocimiento.representacionWokwi("componente", "led")))
  assert.ok(Object.isFrozen(conocimiento.tipoComponente("led")))
})

test("A: la fachada no expone ningún verbo de mutación ni de proyecto", () => {
  const prohibidos = /^(aplicar|guardar|cargar|commit|set|agregar|quitar|borrar|mutar|actualizar|registrar)/i
  assert.deepEqual(Object.keys(conocimiento).filter((k) => prohibidos.test(k)), [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// B — una sola instancia
// ════════════════════════════════════════════════════════════════════════════════════

const ARCHIVOS_PRODUCCION = listarTs(join(REPO, "opencode"))

function listarTs(dir) {
  const resultado = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (nombre === "node_modules") continue
    if (statSync(ruta).isDirectory()) resultado.push(...listarTs(ruta))
    else if (/\.(ts|js)$/.test(nombre)) resultado.push(ruta)
  }
  return resultado
}

/** Código sin comentarios (sólo para guardias estáticas: quita // y bloques). */
function codigo(ruta) {
  return readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

test("B (estático): en producción, sólo nucleo/catalogo-activo.ts construye el catálogo real", () => {
  const llamadores = ARCHIVOS_PRODUCCION.filter((f) => /construirCatalogoMinimoReal\s*\(\s*\)/.test(codigo(f)) && !/export function construirCatalogoMinimoReal/.test(codigo(f)))
  assert.deepEqual(llamadores.map((f) => relative(REPO, f)), ["opencode/nucleo/catalogo-activo.ts"])
})

test("B: la raíz de composición inyecta en calcularVista la MISMA instancia que usa el conocimiento y la vista", () => {
  let recibido
  const servicio = obtenerServicioDeProyecto({
    directorio: nuevoDir("guardia-b"),
    idProyecto: nuevoIdProyecto("guardia-b"),
    calcularVista: (_proyecto, catalogo) => {
      recibido = catalogo
      return null
    },
  })
  try {
    servicio.snapshot()
    assert.equal(recibido, CATALOGO_ACTIVO)
    assert.equal(recibido, conocimiento.catalogo)
    assert.equal(catalogoReal(), conocimiento.catalogo)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// C/D — sensibilidad del hash semántico
// ════════════════════════════════════════════════════════════════════════════════════

function hashCon({ componentes = COMPONENTES_CATALOGO_MINIMO, placas = PLACAS_CATALOGO_MINIMO, version = VERSION_CATALOGO_MINIMO } = {}) {
  return construirCatalogo({ version, componentes, placas, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex).hash
}
const conPlaca = (id, cambio) => PLACAS_CATALOGO_MINIMO.map((p) => (p.id === id ? cambio(p) : p))
const conComponente = (id, cambio) => COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === id ? cambio(c) : c))

test("C: alias, backend de compilación, versión y anexos NO cambian el hash semántico", () => {
  const base = hashCon()
  assert.equal(base, CATALOGO_ACTIVO.hash)
  assert.equal(hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, alias: [...p.alias, "la placa azul"] })) }), base, "alias")
  assert.equal(hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, backends: { platformio: { ...p.backends.platformio, board: "otra" } } })) }), base, "platformio")
  assert.equal(hashCon({ version: "9.9.9" }), base, "versión")
  assert.equal(hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, pines: p.pines.map((pin) => ({ ...pin, etiquetas: [...pin.etiquetas, "X"] })) })) }), base, "etiquetas impresas")
})

test("C (estático): el núcleo no lee anexos ni datos de renderer: ningún import de conocimiento/vista/tool/servidor ni nombres Wokwi en código", () => {
  const nucleo = ARCHIVOS_PRODUCCION.filter((f) => relative(REPO, f).startsWith("opencode/nucleo/"))
  assert.ok(nucleo.length > 10)
  for (const f of nucleo) {
    // Excepción documentada (non-blocker del ledger): `PlacaNoSoportada.nombreVisible`
    // (ESP8266) no está en el catálogo ni en el hash; mudarla al anexo queda fuera de
    // Foundation #1. Se recorta SÓLO ese tipo, su dato y el motivo PLACA_NO_SOPORTADA que lo cita.
    const fuente = codigo(f)
      .replace(/export interface PlacaNoSoportada \{[\s\S]*?\n\}/, "")
      .replace(/export const PLACAS_NO_SOPORTADAS[\s\S]*?\n\]/, "")
      .replace("nombreVisible: noSoportada.nombreVisible", "")
    assert.doesNotMatch(fuente, /from\s+["'][^"']*\/(conocimiento|vista-fisica|tool|servidor)\//, `${relative(REPO, f)} importa fuera del núcleo`)
    assert.doesNotMatch(fuente, /import\(\s*["'][^"']*\/(conocimiento|vista-fisica|tool|servidor)\//, `${relative(REPO, f)} importa fuera del núcleo`)
    assert.doesNotMatch(fuente, /wokwi|nombreVisible|\bpedagogico\??\s*:|\.pedagogico\b/i, `${relative(REPO, f)} trae presentación al núcleo`)
  }
})

test("D: un cambio de significado SÍ cambia el hash (requisito, terminal, acción, pin, potencia, riel)", () => {
  const base = hashCon()
  const casos = {
    "valor del requisito": hashCon({ componentes: conComponente("led", (c) => ({ ...c, requisitos: [{ ...c.requisitos[0], spec: { ...c.requisitos[0].spec, valor: { valor: 330, unidad: "ohm", magnitud: "resistencia" } } }] })) }),
    "eléctrica de un terminal": hashCon({ componentes: conComponente("pulsador", (c) => ({ ...c, terminales: c.terminales.map((t) => (t.id === "senal" ? { ...t, electrica: "analogica" } : t)) })) }),
    "acciones": hashCon({ componentes: conComponente("led", (c) => ({ ...c, acciones: ["encender"] })) }),
    "capacidad de un pin": hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, pines: p.pines.map((pin) => (pin.id === "GPIO23" ? { ...pin, capacidades: { ...pin.capacidades, pwm: !pin.capacidades.pwm } } : pin)) })) }),
    "tensión de un terminal de potencia": hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, terminalesDePotencia: p.terminalesDePotencia.map((t) => (t.id === "3V3" ? { ...t, tension: { valor: 3.0, unidad: "volt", magnitud: "tension" } } : t)) })) }),
    "destino de riel": hashCon({ placas: conPlaca("esp32-devkit-v1", (p) => ({ ...p, destinosDeRiel: { ...p.destinosDeRiel, VLOGICA: "VIN" } })) }),
  }
  for (const [caso, hash] of Object.entries(casos)) assert.notEqual(hash, base, caso)
})

test("D: identidad fijada — si el hash semántico cambia, VERSION_CATALOGO_MINIMO tiene que subir", () => {
  if (VERSION_CATALOGO_MINIMO === IDENTIDAD_FIJADA.version) {
    assert.equal(CATALOGO_ACTIVO.hash, IDENTIDAD_FIJADA.hash, "el significado del catálogo cambió sin subir la versión: subila y actualizá IDENTIDAD_FIJADA")
  } else {
    assert.notEqual(CATALOGO_ACTIVO.hash, IDENTIDAD_FIJADA.hash, "se subió la versión pero el hash no cambió: un cambio de versión sin cambio semántico no hace falta")
  }
})

test("D/I-11: la tabla de identidades heredadas mapea el hash del dominio viejo al semántico fijado", () => {
  assert.ok(Object.isFrozen(IDENTIDADES_HEREDADAS))
  assert.deepEqual({ ...IDENTIDADES_HEREDADAS }, { [HASH_HEREDADO]: IDENTIDAD_2_0_0.hash })
})

// ════════════════════════════════════════════════════════════════════════════════════
// E/F/G — createdWith inmutable, desfase visible y no bloqueante
// ════════════════════════════════════════════════════════════════════════════════════

const OTRO_HASH = "f".repeat(64)
let opId = 0
const sobre = (servicio, tipo, payload) => ({ idOperacion: `guardia-op-${opId++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })

/** Proyecto real (placa + LED + resistencia + pulsador, pines asignados), guardado y
 * cerrado; después se reescribe SÓLO `catalogoHash` en el documento. */
function proyectoGuardado(hashGuardado) {
  const directorio = nuevoDir("guardia-efg")
  const idProyecto = nuevoIdProyecto("guardia-efg")
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  for (const [tipo, payload] of [
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "led" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO4" }],
  ]) {
    const r = servicio.aplicar(sobre(servicio, tipo, payload))
    assert.equal(r.ok, true, `fixture ${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  }
  servicio.cerrar()
  const ruta = join(directorio, `${idProyecto}.json`)
  if (hashGuardado !== undefined) writeFileSync(ruta, JSON.stringify({ ...JSON.parse(readFileSync(ruta, "utf8")), catalogoHash: hashGuardado }))
  return { directorio, idProyecto, ruta }
}

test("E: con desfase, recargar Y commitear una operación nunca reescribe catalogoHash (createdWith)", () => {
  const { directorio, idProyecto, ruta } = proyectoGuardado(OTRO_HASH)
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  try {
    assert.equal(servicio.snapshot().catalogoHash, OTRO_HASH)
    const r = servicio.aplicar(sobre(servicio, "AgregarComponente", { tipo: "pulsador" }))
    assert.equal(r.ok, true, JSON.stringify(r.motivos ?? r))
    assert.equal(servicio.snapshot().catalogoHash, OTRO_HASH)
  } finally {
    servicio.cerrar()
  }
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).catalogoHash, OTRO_HASH, "el documento en disco conserva el createdWith original")
})

test("F: el desfase llega al snapshot: CATALOGO_CAMBIO_DETECTADO (info) con ambos hashes + catalogoActivo", () => {
  const { directorio, idProyecto } = proyectoGuardado(OTRO_HASH)
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  try {
    const s = servicio.snapshot()
    assert.deepEqual(s.catalogoActivo, { version: CATALOGO_ACTIVO.version, hash: CATALOGO_ACTIVO.hash })
    const aviso = s.validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.ok(aviso, JSON.stringify(s.validacion.motivos))
    assert.equal(aviso.severidad, "info")
    assert.equal(aviso.datos.catalogoHashGuardado, OTRO_HASH)
    assert.equal(aviso.datos.catalogoHashActivo, CATALOGO_ACTIVO.hash)
    // Sigue visible después de un commit (no es un aviso de una sola carga).
    servicio.aplicar(sobre(servicio, "AgregarComponente", { tipo: "pulsador" }))
    assert.ok(servicio.snapshot().validacion.motivos.some((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO"))
  } finally {
    servicio.cerrar()
  }
})

test("G: el desfase NO bloquea: misma readiness que el mismo proyecto sin desfase", () => {
  const sin = proyectoGuardado(undefined)
  const con = proyectoGuardado(OTRO_HASH)
  const sSin = obtenerServicioDeProyecto({ directorio: sin.directorio, idProyecto: sin.idProyecto })
  const sCon = obtenerServicioDeProyecto({ directorio: con.directorio, idProyecto: con.idProyecto })
  try {
    assert.deepEqual(sCon.snapshot().validacion.readiness, sSin.snapshot().validacion.readiness)
    const aviso = sCon.snapshot().validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.equal(aviso?.severidad, "info", "el aviso existe y no es bloqueante")
    const bloqueantes = (s) => s.snapshot().validacion.motivos.filter((m) => m.severidad === "blocking").map((m) => m.codigo)
    assert.deepEqual(bloqueantes(sCon), bloqueantes(sSin))
  } finally {
    sSin.cerrar()
    sCon.cerrar()
  }
})

test("I-11: un proyecto con el hash del dominio VIEJO se reconoce como 2.0.0; con el catálogo 2.1.0 el desfase SE VE (no se encadena ni se oculta)", () => {
  // Antes de Semantic Vertical #3 este proyecto no mostraba desfase (2.0.0 = activo). El
  // complemento encender ↔ apagar es un cambio semántico real: ahora tiene que verse.
  const { directorio, idProyecto } = proyectoGuardado(HASH_HEREDADO)
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  try {
    const s = servicio.snapshot()
    assert.equal(s.catalogoHash, HASH_HEREDADO, "createdWith se conserva tal cual")
    const aviso = s.validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.ok(aviso, JSON.stringify(s.validacion.motivos))
    assert.equal(aviso.severidad, "info")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// H — terminales de potencia
// ════════════════════════════════════════════════════════════════════════════════════

test("H: ESP32 GND/3V3/VIN son conectables y no asignables; ninguno aparece entre los pines permitidos", () => {
  const potencia = conocimiento.terminalesDePotencia("esp32-devkit-v1")
  assert.deepEqual(potencia.map((t) => t.id), ["GND", "3V3", "VIN"])
  for (const t of potencia) {
    assert.equal(t.conectable, true)
    assert.equal(t.asignable, false)
  }
  const ids = new Set(potencia.map((t) => t.id))
  for (const c of conocimiento.catalogo.componentes) {
    for (const t of c.terminales) {
      const permitidos = conocimiento.pinesPermitidos("esp32-devkit-v1", c.id, t.id)
      assert.ok(!permitidos.some((p) => ids.has(p.id)), `${c.id}.${t.id}`)
      if (!t.asignable) assert.deepEqual(permitidos, [], `${c.id}.${t.id} no es asignable: no se le ofrece ningún pin`)
    }
  }
})

test("H: el cátodo del LED resuelve físicamente al GND de la placa, y el dht22.vcc (VLOGICA) al 3V3", () => {
  const terminal = (tipo, id) => conocimiento.terminales(tipo).find((t) => t.id === id)
  assert.deepEqual(conocimiento.resolverDestino("esp32-devkit-v1", terminal("led", "catodo")), { kind: "potencia", id: "GND" })
  assert.deepEqual(conocimiento.resolverDestino("esp32-devkit-v1", terminal("dht22", "vcc")), { kind: "potencia", id: "3V3" })
  assert.deepEqual(conocimiento.resolverDestino("arduino-uno", terminal("dht22", "vcc")), { kind: "potencia", id: "5V" })
})

test("H: AsignarPin a GND y AsignarPin del cátodo se rechazan con TERMINAL_NO_ASIGNABLE", () => {
  const catalogo = conocimiento.catalogo
  let p = { ...crearProyecto({ generadorId: () => "guardia-h", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash }), placa: "esp32-devkit-v1" }
  p = ejecutarOperacion(p, { idOperacion: "h-0", actor: "agente", baseRevision: p.revision, tipo: "AgregarComponente", payload: { tipo: "led" } }, catalogo).proyecto
  const asignar = (terminal, pin) => ejecutarOperacion(p, { idOperacion: `h-${terminal}-${pin}`, actor: "agente", baseRevision: p.revision, tipo: "AsignarPin", payload: { componente: "cmp-0", terminal, pin } }, catalogo)
  for (const pin of ["GND", "3V3", "VIN"]) {
    const r = asignar("anodo", pin)
    assert.equal(r.ok, false, pin)
    assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE", pin)
    assert.equal(r.motivos[0].datos.terminalDePotencia, true, pin)
  }
  assert.equal(asignar("catodo", "GPIO4").motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

// ════════════════════════════════════════════════════════════════════════════════════
// I — admisión
// ════════════════════════════════════════════════════════════════════════════════════

test("I: la admisión pasa para el conjunto inicial (ESP32, LED, resistencia, pulsador)", () => {
  assert.deepEqual(oficialmenteSoportados(conocimiento), ["esp32-devkit-v1", "led", "pulsador", "resistencia"])
})

// ════════════════════════════════════════════════════════════════════════════════════
// J — sin representación = marcado, nunca omitido en silencio
// ════════════════════════════════════════════════════════════════════════════════════

function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    textContent: "",
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
  }
}

test("J: un dht22 en el proyecto produce una instrucción visible y un aviso pintado con su nombre", () => {
  const catalogo = conocimiento.catalogo
  let p = { ...crearProyecto({ generadorId: () => "guardia-j", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash }), placa: "esp32-devkit-v1" }
  for (const tipo of ["led", "dht22"]) {
    const r = ejecutarOperacion(p, { idOperacion: `j-${tipo}`, actor: "agente", baseRevision: p.revision, tipo: "AgregarComponente", payload: { tipo } }, catalogo)
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    p = r.proyecto
  }
  const vista = vistaDeProyectoConCatalogoReal(p)
  const dht = vista.componentes.find((c) => c.tipo === "dht22")
  assert.ok(dht, "el dht22 sigue en la vista")
  const instrucciones = planDePintado(vista)
  const marca = instrucciones.find((i) => i.tipo === "piezaSinRepresentacion")
  assert.ok(marca, `falta la marca visible: ${JSON.stringify(instrucciones.map((i) => i.tipo))}`)
  assert.deepEqual(marca.entidad, { tipo: "componente", id: dht.id })
  assert.match(marca.texto, /DHT22/)
  assert.match(marca.texto, /no tiene dibujo/)
  assert.ok(!instrucciones.some((i) => i.tipo === "crearElemento" && i.entidad.id === dht.id), "nunca se dibuja con un tag inventado")

  const raiz = pintar({ createElement: elementoFake }, instrucciones)
  // Physical View UX #1: el aviso vive DENTRO de la zona de su pieza (el dht22 es un sensor: Entrada).
  const todos = (n) => [n, ...(n.hijos ?? []).flatMap(todos)]
  const aviso = todos(raiz.circuito).find((h) => h.atributos?.["data-sin-representacion"] === "true")
  assert.ok(aviso, "el aviso tiene que quedar en el circuito")
  const zonaEntrada = todos(raiz.circuito).find((h) => h.atributos?.["data-zona-piezas"] === "entrada")
  assert.ok(zonaEntrada?.hijos.includes(aviso), "el aviso queda en la zona Entrada, junto a donde estaría la pieza")
  assert.equal(aviso.atributos["data-entidad-id"], dht.id)
  assert.match(aviso.textContent, /DHT22/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Guardias estáticas de las tools
// ════════════════════════════════════════════════════════════════════════════════════

test("tools: ningún hecho de componente sale de la vista — de vista-real sólo se usa el texto de motivos", () => {
  for (const f of ARCHIVOS_PRODUCCION.filter((f) => relative(REPO, f).startsWith("opencode/tool/"))) {
    const fuente = codigo(f)
    assert.doesNotMatch(fuente, /\bcatalogoReal\b|vistaDeProyectoConCatalogoReal|CATALOGO_REAL/, `${relative(REPO, f)} saca el catálogo de la vista`)
    for (const [, miembro] of fuente.matchAll(/modVistaReal\.(\w+)/g)) assert.equal(miembro, "explicarMotivosConCatalogoReal", relative(REPO, f))
    // D13: las piezas pesadas (conocimiento, servidor, vista-real) sólo con import() perezoso.
    assert.doesNotMatch(fuente, /^import\s+(?!type)[^\n]*from\s+["']\.\.\/(conocimiento\/|servidor\/|vista-fisica\/vista-real)/m, `${relative(REPO, f)} importa en caliente (D13: tiene que ser perezoso)`)
  }
})
