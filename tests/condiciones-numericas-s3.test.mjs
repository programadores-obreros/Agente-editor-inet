// Numeric Conditions S3 — Slice 1 (Design Gate S3, GO; OD-S3-1 = B, OD-S3-2 = A, OD-S3-3 = A).
//
// El agente arma una condición numérica de NIVEL con el MISMO `SetComportamiento` que usan S1
// y S2: la tríada completa (`capacidad + comparador + umbral{valor, unidad, magnitud}`) en una
// sola operación. Para resolver la frase del alumno, `proyecto-fisico leer` le da
// `condicionesNumericas`: una proyección de la fachada REAL de Component Knowledge, sin tablas
// propias. El Engine sigue siendo la única autoridad.
//
// Contrato de tests = la matriz T1–T18 del Design Gate. `resolver()` (abajo) hace con los datos
// de `leer` lo que el prompt le pide al agente: demuestra que esos datos alcanzan para resolver
// sin conocimiento físico escrito en otro lado. Las palabras del alumno («temperatura», «°F»)
// son la ENTRADA de esos casos; los resultados esperados se comparan contra la fachada.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { COMPARADORES } = await import(join(REPO, "opencode/nucleo/ir.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { vocabularioDesdeCatalogo } = await import(join(REPO, "opencode/conocimiento/vocabulario.ts"))
const { ROTULO_COMPARADOR, disponibleParaCrear } = await import(join(REPO, "opencode/vista-fisica/condicion-numerica.ts"))
const { construirOperacionRegla } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { revalidarGrupo } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const TOOL = readFileSync(join(REPO, "opencode/tool/proyecto-fisico.ts"), "utf8")

const llamar = async (args, dir) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))

/** Placa + LED + los sensores pedidos, armados POR LA TOOL. Devuelve ids por tipo y `leer`. */
async function armar(sensores) {
  const dir = nuevoDir("numericas-s3")
  const idProyecto = nuevoIdProyecto("nc3")
  const operaciones = [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }, ...sensores.map((tipo) => ({ tipo: "AgregarComponente", payload: { tipo } }))]
  const r = await llamar({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones }, dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  const lectura = await llamar({ accion: "leer", idProyecto }, dir)
  const ids = (tipo) => lectura.componentes.filter((c) => c.tipo === tipo).map((c) => c.id)
  return { dir, idProyecto, lectura, led: ids("led")[0], ids }
}
const leer = (c) => llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
const aplicar = async (c, comportamiento) => {
  const { revision } = await leer(c)
  return llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento } }] }, c.dir)
}
const servicioDe = (c) => obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(c.dir), idProyecto: c.idProyecto })
const disco = (c) => {
  const ruta = join(directorioDeDatos(c.dir), `${c.idProyecto}.json`)
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

/**
 * Lo que el prompt («Regla de nivel con un número», paso 3) le pide al agente, hecho con los
 * datos de `condicionesNumericas` y nada más. `etiqueta`/`simbolo` son lo que dijo el alumno
 * (o `undefined`). Devuelve la condición, o `{ preguntar, opciones }` ante ambigüedad genuina.
 */
function resolver(cn, { etiqueta, simbolo, sensor } = {}) {
  const usables = (s) => s.capacidades.filter((c) => c.disponible)
  const candidatos = []
  for (const s of cn.sensores) {
    if (sensor !== undefined && s.id !== sensor) continue
    let caps = usables(s)
    if (etiqueta !== undefined) caps = caps.filter((c) => c.etiqueta === etiqueta || c.etiqueta.startsWith(`${etiqueta} `))
    else if (simbolo !== undefined) caps = caps.filter((c) => c.unidades.some((u) => u.simbolo === simbolo))
    for (const cap of caps) candidatos.push({ sensor: s, cap })
  }
  const sensores = new Set(candidatos.map((x) => x.sensor.id))
  if (sensores.size > 1) return { preguntar: "sensor", opciones: cn.sensores.filter((s) => sensores.has(s.id)).map((s) => s.nombre) }
  if (candidatos.length > 1) return { preguntar: "capacidad", opciones: candidatos.map((x) => x.cap.etiqueta) }
  if (candidatos.length === 0) return { preguntar: "nada-mide-eso", opciones: [] }
  const { sensor: s, cap } = candidatos[0]
  if (simbolo !== undefined && !cap.unidades.some((u) => u.simbolo === simbolo)) return { preguntar: "unidad", opciones: cap.unidades.map((u) => u.simbolo) }
  const unidad = simbolo === undefined ? cap.unidadCanonica : cap.unidades.find((u) => u.simbolo === simbolo).id
  return { sensor: s.id, capacidad: cap.capacidad, unidad, magnitud: cap.magnitud }
}
const condicion = (r, comparador, valor) => ({ sensor: r.sensor, capacidad: r.capacidad, comparador, umbral: { valor, unidad: r.unidad, magnitud: r.magnitud } })
const regla = (c, cuando) => ({ cuando, entonces: { actuador: c.led, accion: "encender" } })
const capacidadCK = (tipo, capacidad) => K.capacidadCuantitativa(tipo, capacidad).valor
const simboloCK = (tipo, capacidad, unidad) => capacidadCK(tipo, capacidad).unidades.find((u) => u.id === unidad).simbolo

/** El texto de la sección nueva del prompt (hasta el siguiente `###`). */
function seccion(titulo) {
  const i = PROMPT.indexOf(titulo)
  assert.ok(i >= 0, `no encontré «${titulo}» en el prompt`)
  const fin = PROMPT.indexOf("\n### ", i + titulo.length)
  return PROMPT.slice(i, fin < 0 ? undefined : fin)
}
const REGLA_NUMERO = seccion("### Regla de nivel con un número")

// ════════════════════════════════════════════════════════════════════════════════════
// T18 / T4: la proyección ES Component Knowledge (sin tablas propias)
// ════════════════════════════════════════════════════════════════════════════════════

const esperadoCK = (tipo) => {
  const r = K.capacidadesCuantitativas(tipo)
  return r.ok
    ? r.valor.map((c) => ({ capacidad: c.capacidad, etiqueta: c.etiqueta, magnitud: c.magnitud, unidadCanonica: c.unidadCanonica, unidades: c.unidades.map((u) => ({ id: u.id, simbolo: u.simbolo })), rango: c.rango, disponible: disponibleParaCrear(c) }))
    : []
}

test("T18 catalogo[]: exactamente los tipos con capacidades cuantitativas, iguales a capacidadesCuantitativas + disponibleParaCrear", async () => {
  const c = await armar(["dht22"])
  const { catalogo } = c.lectura.condicionesNumericas
  const tiposCK = K.catalogo.componentes.map((x) => x.id).filter((tipo) => esperadoCK(tipo).length > 0)
  assert.ok(tiposCK.length > 0, "el catálogo real tiene al menos un tipo cuantitativo")
  assert.deepEqual(catalogo.map((t) => t.tipo), tiposCK)
  for (const t of catalogo) {
    assert.deepEqual(t.capacidades, esperadoCK(t.tipo), t.tipo)
    assert.equal(t.nombre, K.nombre("componente", t.tipo) ?? t.tipo)
  }
})

test("T18 sensores[]: sólo los componentes del proyecto que miden algo, con las capacidades de su tipo", async () => {
  const c = await armar(["dht22", "pulsador", "ntc"])
  const { sensores } = c.lectura.condicionesNumericas
  const medibles = c.lectura.componentes.filter((x) => esperadoCK(x.tipo).length > 0)
  assert.deepEqual(sensores.map((s) => s.id), medibles.map((x) => x.id))
  for (const s of sensores) {
    const comp = c.lectura.componentes.find((x) => x.id === s.id)
    assert.equal(s.tipo, comp.tipo)
    assert.equal(s.nombre, comp.nombre)
    assert.deepEqual(s.capacidades, esperadoCK(s.tipo))
  }
  assert.ok(!sensores.some((s) => s.tipo === "pulsador"), "una entrada booleana no es un sensor cuantitativo")
})

test("T18 comparadores[]: los cuatro de la IR con el rótulo de S1, en el mismo orden", async () => {
  const c = await armar([])
  assert.deepEqual(c.lectura.condicionesNumericas.comparadores, COMPARADORES.map((comparador) => ({ comparador, significado: ROTULO_COMPARADOR[comparador] })))
  assert.deepEqual(c.lectura.condicionesNumericas.sensores, [])
})

test("T4 capacidad implícita: con una sola capacidad disponible se resuelve; con dos, hay que preguntar", async () => {
  const ntc = await armar(["ntc"])
  const cnNtc = ntc.lectura.condicionesNumericas
  assert.equal(cnNtc.sensores[0].capacidades.filter((x) => x.disponible).length, 1)
  const r = resolver(cnNtc, {})
  assert.equal(r.preguntar, undefined, JSON.stringify(r))
  assert.equal(r.capacidad, esperadoCK("ntc")[0].capacidad)

  const dht = await armar(["dht22"])
  const r2 = resolver(dht.lectura.condicionesNumericas, {})
  assert.equal(r2.preguntar, "capacidad")
  assert.deepEqual(r2.opciones, esperadoCK("dht22").map((x) => x.etiqueta))
})

// ════════════════════════════════════════════════════════════════════════════════════
// T1–T3, T5: crear con UN SetComportamiento por la tool; confirmar con `leer`
// ════════════════════════════════════════════════════════════════════════════════════

test("T1 °C explícito: un SetComportamiento con la tríada completa → APLICADO, la IR exacta y el texto de S1", async () => {
  const c = await armar(["dht22"])
  const dht = c.ids("dht22")[0]
  const unidadC = capacidadCK("dht22", "temperatura").unidades.find((u) => u.simbolo === "°C").id
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura", simbolo: "°C" })
  assert.deepEqual(r, { sensor: dht, capacidad: "temperatura", unidad: unidadC, magnitud: capacidadCK("dht22", "temperatura").magnitud })

  const antes = c.lectura.revision
  const res = await aplicar(c, regla(c, condicion(r, ">", 30)))
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.resultado, `APLICADO — revisión ${antes}→${antes + 1}`, "una sola operación, una sola revisión")
  const ir = JSON.parse(disco(c)).comportamientos
  assert.equal(ir.length, 1)
  assert.deepEqual(ir[0].cuando, { sensor: dht, capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: unidadC, magnitud: "temperatura" } })

  const lectura = await leer(c)
  assert.equal(lectura.reglas[0].texto, "Mientras la lectura de temperatura del DHT22 sea mayor a 30 °C, el LED está encendido.")
  assert.equal(lectura.reglas[0].completa, true)
  assert.ok(!lectura.motivos.some((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO"))
})

test("T2 °F explícito: 86 °F se guarda como 86 en la unidad elegida, sin convertir; sin aviso de rango", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { simbolo: "°F" })
  assert.equal(r.capacidad, "temperatura", "el símbolo identifica la única capacidad que lo declara")
  const res = await aplicar(c, regla(c, condicion(r, ">=", 86)))
  assert.equal(res.ok, true, JSON.stringify(res))
  const umbral = JSON.parse(disco(c)).comportamientos[0].cuando.umbral
  assert.deepEqual(umbral, { valor: 86, unidad: r.unidad, magnitud: "temperatura" })
  assert.equal(simboloCK("dht22", "temperatura", umbral.unidad), "°F")
  const lectura = await leer(c)
  assert.match(lectura.reglas[0].texto, /mayor o igual a 86 °F/)
  assert.ok(!lectura.motivos.some((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO"), "86 °F está dentro del rango declarado")
})

test("T3 unidad implícita (OD-S3-2 = A): se usa unidadCanonica de Component Knowledge y `leer` la muestra", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "humedad" })
  assert.equal(r.unidad, capacidadCK("dht22", "humedad").unidadCanonica)
  const res = await aplicar(c, regla(c, condicion(r, ">=", 70)))
  assert.equal(res.ok, true, JSON.stringify(res))
  const lectura = await leer(c)
  assert.equal(lectura.reglas[0].texto, `Mientras la lectura de humedad relativa del DHT22 sea mayor o igual a 70 ${simboloCK("dht22", "humedad", r.unidad)}, el LED está encendido.`)
  assert.match(REGLA_NUMERO, /usá `unidadCanonica`/)
  assert.match(REGLA_NUMERO, /volvé a `leer`[\s\S]*`reglas\[i\]\.texto`, TAL CUAL/)
  assert.match(REGLA_NUMERO, /No redactes\s+vos el número ni la unidad/)
})

test("T5 sensor implícito: con un único sensor compatible se resuelve sin preguntar", async () => {
  const c = await armar(["dht22", "pulsador"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  assert.equal(r.sensor, c.ids("dht22")[0])
  assert.match(REGLA_NUMERO, /\*\*Sensor:\*\* el ÚNICO de `sensores\[\]`/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// T6–T8, T10: ambigüedad e intención fuera de S3 → UNA pregunta, nada aplicado
// ════════════════════════════════════════════════════════════════════════════════════

test("T6 dos sensores compatibles: los datos lo muestran y el prompt pide preguntar, nunca «el primero»", async () => {
  const c = await armar(["dht22", "ntc"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  assert.equal(r.preguntar, "sensor")
  assert.deepEqual(r.opciones, c.lectura.condicionesNumericas.sensores.map((s) => s.nombre))
  assert.match(REGLA_NUMERO, /dos o más sensores tienen la capacidad nombrada: preguntá cuál/)
  assert.match(REGLA_NUMERO, /nunca\s+elijas "el primero"/)
  assert.match(REGLA_NUMERO, /UNA sola pregunta, y no apliques nada hasta la\s+respuesta/)
  assert.deepEqual(JSON.parse(disco(c)).comportamientos, [], "resolver no muta nada")
})

test("T7 varias capacidades posibles: el prompt pide preguntar con las etiquetas de Component Knowledge", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { sensor: c.ids("dht22")[0] })
  assert.equal(r.preguntar, "capacidad")
  assert.match(REGLA_NUMERO, /varias capacidades y la frase no permite elegir una:\s+preguntá cuál/)
})

test("T8 unidad incompatible: el prompt pide preguntar; si igual se manda, es un error REPRESENTABLE (no un rechazo)", async () => {
  const c = await armar(["dht22"])
  const cn = c.lectura.condicionesNumericas
  const humedad = resolver(cn, { etiqueta: "humedad" })
  assert.equal(resolver(cn, { etiqueta: "humedad", simbolo: "°C" }).preguntar, "unidad")
  assert.match(REGLA_NUMERO, /\*\*no está\*\* en las `unidades\[\]` de esa\s+capacidad: no la corrijas en silencio, preguntá/)

  const temperatura = resolver(cn, { etiqueta: "temperatura" })
  const res = await aplicar(c, regla(c, { ...condicion(humedad, ">", 70), umbral: { valor: 70, unidad: temperatura.unidad, magnitud: temperatura.magnitud } }))
  assert.equal(res.ok, true, "el Engine lo guarda: es representable")
  const comportamientos = JSON.parse(disco(c)).comportamientos
  assert.equal(comportamientos.length, 1)
  assert.equal(comportamientos[0].cuando.umbral.unidad, temperatura.unidad, "nada se corrige en silencio")
  const motivo = (await leer(c)).motivos.find((m) => m.codigo === "MAGNITUD_INCOMPATIBLE")
  assert.ok(motivo, "leer lo informa")
  assert.equal(motivo.severidad, "blocking")
  assert.equal(motivo.clasificacion, "representable")
})

test("T10 igualdad: fuera de S3 — el Engine la rechaza sin cambiar nada y el prompt pide aclarar, nunca aproximar", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  const antes = c.lectura.revision
  const res = await aplicar(c, regla(c, condicion(r, "=", 30)))
  assert.equal(res.ok, false)
  assert.match(res.resultado, /^NO SE APLICÓ NADA/)
  assert.equal(res.revisionActual, antes)
  assert.ok(res.motivos.some((m) => m.codigo === "VALOR_ENUM_DESCONOCIDO"), JSON.stringify(res.motivos))
  assert.deepEqual(JSON.parse(disco(c)).comportamientos, [])
  assert.ok(!COMPARADORES.includes("="))
  assert.match(REGLA_NUMERO, /\*\*igualdad\*\*/)
  assert.match(REGLA_NUMERO, /\*\*Nunca la cambies sola\*\* por «mayor o igual a» ni\s+por «menor o igual a»/)
  // Los significados que cita el prompt son exactamente los de la proyección (rótulos de S1).
  for (const significado of ["mayor a", "menor a", "mayor o igual a", "menor o igual a"]) assert.ok(Object.values(ROTULO_COMPARADOR).includes(significado), significado)
  assert.match(REGLA_NUMERO, /`comparadores\[\]` cuyo `significado` dice lo mismo que el alumno/)
})

test("T7b falta el umbral: el prompt prohíbe inventarlo (ni default, ni rango, ni el de un dibujo)", () => {
  assert.match(REGLA_NUMERO, /\*\*falta el número\*\*/)
  assert.match(REGLA_NUMERO, /\*\*Nunca inventes un umbral\*\*: ni un valor\s+por defecto, ni el `rango`, ni el default de un dibujo de `circuito`/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// T9, T11: lo representable se guarda como lo dijo el alumno
// ════════════════════════════════════════════════════════════════════════════════════

test("T9 fuera de rango: se guarda sin recortar y queda el warning UMBRAL_FUERA_DE_RANGO con su explicación", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  const max = capacidadCK("dht22", "temperatura").rango.max.valor
  const res = await aplicar(c, regla(c, condicion(r, ">", max * 10)))
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(JSON.parse(disco(c)).comportamientos[0].cuando.umbral.valor, max * 10, "sin clamp")
  const motivo = (await leer(c)).motivos.find((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO")
  assert.ok(motivo)
  assert.equal(motivo.severidad, "warning")
  assert.ok(typeof motivo.explicacion === "string" && motivo.explicacion.length > 0)
  assert.match(REGLA_NUMERO, /\*\*Un número fuera del `rango`\*\* se manda igual[\s\S]*no lo\s+recortes, no lo corrijas y no preguntes antes/)
})

test("T11 incompleta: la condición sin salida se guarda (B2) y `leer` dice qué falta", async () => {
  const c = await armar(["ntc"])
  const r = resolver(c.lectura.condicionesNumericas, {})
  const res = await aplicar(c, { cuando: condicion(r, "<", 20) })
  assert.equal(res.ok, true, JSON.stringify(res))
  const lectura = await leer(c)
  assert.equal(lectura.reglas[0].completa, false)
  assert.ok(lectura.reglas[0].faltan.length > 0)
  assert.equal(JSON.parse(disco(c)).comportamientos[0].entonces, undefined)
})

// ════════════════════════════════════════════════════════════════════════════════════
// T12–T14: recarga, interoperabilidad con S1/S2 y Multi-Rule Safety
// ════════════════════════════════════════════════════════════════════════════════════

test("T12 recarga: la regla del agente recarga idéntica y proyecta el mismo texto", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { simbolo: "°F" })
  assert.equal((await aplicar(c, regla(c, condicion(r, "<", 50)))).ok, true)
  const texto = (await leer(c)).reglas[0].texto
  const crudo = disco(c)
  const recargado = cargarProyecto(crudo)
  assert.equal(recargado.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(recargado.proyecto.comportamientos)), JSON.parse(crudo).comportamientos)
  assert.equal((await leer(c)).reglas[0].texto, texto)
})

test("T13 S1: la regla creada por el agente es indistinguible de la del navegador y se edita con los slots de S1", async () => {
  const c = await armar(["dht22"])
  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  assert.equal((await aplicar(c, regla(c, condicion(r, ">", 30)))).ok, true)
  const servicio = servicioDe(c)
  const s = servicio.snapshot()
  const vistaRegla = s.vista.reglas[0]
  assert.ok(vistaRegla.slots.some((x) => x.slot === "valor" && x.tipo === "numero"), "S1 la reconoce como numérica")

  const operacion = construirOperacionRegla({ regla: vistaRegla, slot: "valor", valor: "35", opcionesRegla: s.vista.opcionesRegla })
  const rEdit = servicio.aplicar({ idOperacion: `s3-edit-${Date.now()}`, actor: "navegador", baseRevision: s.revision, tipo: operacion.tipo, payload: operacion.payload })
  assert.equal(rEdit.ok, true, JSON.stringify(rEdit.motivos))
  const ir = JSON.parse(disco(c)).comportamientos
  assert.equal(ir.length, 1)
  assert.equal(ir[0].cuando.umbral.valor, 35)
  assert.equal(ir[0].cuando.umbral.unidad, r.unidad)
  assert.match((await leer(c)).reglas[0].texto, /mayor a 35 °C/)
})

test("T13 S2: si el agente completa la condición de una regla con borrador abierto, el borrador ya no tiene grupo (se descarta)", async () => {
  const c = await armar(["dht22"])
  const dht = c.ids("dht22")[0]
  assert.equal((await aplicar(c, { cuando: { sensor: dht } })).ok, true)
  const antes = servicioDe(c).snapshot().vista.reglas[0]
  const partes = { valor: "30" }
  assert.notEqual(revalidarGrupo(antes, partes), null, "con la regla en {sensor} hay grupo atómico")

  const r = resolver(c.lectura.condicionesNumericas, { etiqueta: "temperatura" })
  assert.equal((await aplicar(c, { id: antes.id, ...regla(c, condicion(r, ">", 30)) })).ok, true)
  const despues = servicioDe(c).snapshot().vista.reglas[0]
  assert.equal(despues.id, antes.id)
  assert.equal(revalidarGrupo(despues, partes), null, "S2 descarta el borrador: la condición ya está completa")
})

test("T14 Multi-Rule Safety: una segunda regla numérica sobre el mismo LED queda marcada; editar por id no", async () => {
  const c = await armar(["dht22"])
  const cn = c.lectura.condicionesNumericas
  assert.equal((await aplicar(c, regla(c, condicion(resolver(cn, { etiqueta: "temperatura" }), ">", 30)))).ok, true)
  const id = (await leer(c)).reglas[0].id
  assert.equal((await aplicar(c, { id, ...regla(c, condicion(resolver(cn, { etiqueta: "temperatura" }), ">", 32)) })).ok, true)
  assert.ok(!(await leer(c)).motivos.some((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR"), "editar por id no crea otra autoridad")

  assert.equal((await aplicar(c, regla(c, condicion(resolver(cn, { etiqueta: "humedad" }), ">", 70)))).ok, true)
  assert.ok((await leer(c)).motivos.some((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// T15–T17: guardas estáticas y regresión booleana
// ════════════════════════════════════════════════════════════════════════════════════

/** Todo lo físico que declara Component Knowledge para los tipos cuantitativos: lo que NO puede
 * aparecer escrito en el agente ni en la proyección (sale de la fachada en runtime). */
function terminosFisicos() {
  const terminos = new Set()
  for (const { id: tipo } of K.catalogo.componentes) {
    const caps = esperadoCK(tipo)
    if (caps.length === 0) continue
    terminos.add(tipo)
    for (const cap of caps) {
      for (const t of [cap.capacidad, cap.etiqueta, cap.magnitud, cap.unidadCanonica]) if (t) terminos.add(t)
      for (const u of cap.unidades) terminos.add(u.id).add(u.simbolo)
    }
  }
  return [...terminos]
}
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const aparece = (texto, termino) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(termino)}($|[^\\p{L}\\p{N}])`, "iu").test(texto)

test("T15 sin hardcodes físicos: ni la sección nueva del prompt, ni la frontera, ni la tool nombran tipos, capacidades, unidades o símbolos", () => {
  const terminos = terminosFisicos()
  assert.ok(terminos.length > 4, "la guarda se deriva del catálogo real")
  const frontera = PROMPT.slice(PROMPT.indexOf("**Una condición con un número sobre el proyecto físico**"), PROMPT.indexOf("### Los pines"))
  for (const [nombre, texto] of [["prompt: Regla de nivel con un número", REGLA_NUMERO], ["prompt: frontera de circuito", frontera], ["tool/proyecto-fisico.ts", TOOL]]) {
    for (const t of terminos) assert.ok(!aparece(texto, t), `${nombre} nombra «${t}»: tiene que salir de Component Knowledge`)
  }
  // Ningún número en la sección nueva (umbrales, rangos, factores), salvo la numeración de la lista.
  const sinNumeracion = REGLA_NUMERO.replace(/^\s*\d+\.\s/gm, "")
  assert.doesNotMatch(sinNumeracion, /\d/, "la sección nueva no escribe números")
})

test("T15 el ejemplo numérico de la tool es la tríada completa, toda en marcadores `<…>`", async () => {
  const c = await armar([])
  const ejemplo = c.lectura.condicionesNumericas.ejemplo.SetComportamiento.comportamiento
  assert.deepEqual(Object.keys(ejemplo.cuando).sort(), ["capacidad", "comparador", "sensor", "umbral"])
  assert.deepEqual(Object.keys(ejemplo.cuando.umbral).sort(), ["magnitud", "unidad", "valor"])
  const hojas = [ejemplo.cuando.sensor, ejemplo.cuando.capacidad, ejemplo.cuando.comparador, ...Object.values(ejemplo.cuando.umbral), ...Object.values(ejemplo.entonces)]
  for (const h of hojas) assert.match(h, /^<.+>$/, `«${h}» no es un marcador`)
})

test("T16 frontera: una condición con número sobre el proyecto físico va por proyecto-fisico, nunca por circuito.umbral", () => {
  const frontera = seccion("### Frontera de `circuito`")
  assert.match(frontera, /\*\*Una condición con un número sobre el proyecto físico\*\*[\s\S]*va SIEMPRE\s+por `proyecto-fisico`/)
  assert.match(frontera, /\*\*Nunca\*\* la\s+mandes como `umbral` de `circuito`/)
  assert.match(REGLA_NUMERO, /SIEMPRE por `proyecto-fisico`, \*\*nunca\*\* por el `umbral` del tool `circuito`/)
  // La regla de circuitos sigue explicando `umbral` y el slider (tests/circuitos-visuales), pero ya
  // no ofrece el ejemplo que mandaba ahí una condición del alumno.
  const circuitos = seccion("## REGLA CRÍTICA — circuitos visuales")
  const punto = circuitos.slice(circuitos.indexOf("**Sensor + actuador"))
  assert.match(punto, /`umbral`/)
  assert.doesNotMatch(punto, /umbral:\s*\d/, "el prompt ya no ejemplifica un umbral concreto para circuito")
  assert.match(punto, /si lo que piden es una condición con número sobre el proyecto físico del alumno, NO va acá, va por `proyecto-fisico`/)
})

test("T17 booleano sin cambios: el vocabulario y el ejemplo booleano son los de B; el paso booleano remite a la sección nueva", async () => {
  const c = await armar(["pulsador"])
  const { vocabulario } = c.lectura
  assert.deepEqual(vocabulario, vocabularioDesdeCatalogo(K.catalogo, Object.keys(vocabulario.operaciones), K), "leer sigue devolviendo el vocabulario de B tal cual")
  assert.ok(vocabulario.componentes.find((x) => x.tipo === "pulsador").estadosDeEntrada.length > 0)
  assert.match(PROMPT, /Nunca uses un estado que no\s+esté en esas listas\. Si la condición compara una medición con un número,\s+no sale de esta lista: seguí «Regla de nivel con un número»/)
})
