// Generabilidad para el agente: lo que el producto ya sabe sobre qué llega HOY a un programa
// compilable (admisión eléctrica + soporte del backend) se expone en `proyecto-fisico leer`
// ANTES de planificar. Motivación: en el E2E de intención #1 el agente eligió la Arduino UNO y
// recién se enteró en `programa compilar` (CODEGEN_NO_ADMITIDO).
//
// Contrato:
//   - la proyección es el MISMO gate de `generarPrograma` (pasos 2 y 3), sin una tabla aparte;
//   - no cambia `disponible` ni el vocabulario (son otra pregunta);
//   - es guía, nunca autorización: `programa` sigue validando y fallando cerrado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { REPO, DIR_BASE, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { generabilidad } = await import(join(REPO, "opencode/codegen/generabilidad.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { BACKENDS_DE_PROTOCOLO } = await import(join(REPO, "opencode/codegen/protocolos.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { REVISIONES_DEL_ANEXO } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { vocabularioDesdeCatalogo } = await import(join(REPO, "opencode/conocimiento/vocabulario.ts"))
const { disponibleParaCrear } = await import(join(REPO, "opencode/vista-fisica/condicion-numerica.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const llamar = async (args, dir) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
const leerVacio = async () => llamar({ accion: "leer", idProyecto: nuevoIdProyecto("gen") }, nuevoDir("generabilidad"))

// Los ids salen SIEMPRE de los datos (catálogo, Component Knowledge), nunca de una lista del test.
const PLACAS = K.catalogo.placas.map((p) => p.id)
const tiposConCapacidad = (capacidad) => K.catalogo.componentes.filter((c) => c.capacidades.some((k) => k.id === capacidad)).map((c) => c.id)
const deTipo = (g, tipo) => g.componentes.find((c) => c.tipo === tipo)
const capDe = (g, tipo, capacidad) => deTipo(g, tipo).capacidades.find((c) => c.capacidad === capacidad)
/** El tipo del catálogo que declara la temperatura por protocolo, y el que la tiene sin mecanismo. */
const CON_PROTOCOLO = tiposConCapacidad("temperatura").find((t) => K.lecturaDeCapacidad(t, "temperatura") !== undefined)
const SIN_MECANISMO = tiposConCapacidad("temperatura").find((t) => K.lecturaDeCapacidad(t, "temperatura") === undefined)

const revisionesSin = (tipo) => ({ placas: REVISIONES_DEL_ANEXO.placas, componentes: REVISIONES_DEL_ANEXO.componentes.filter((r) => r.tipo !== tipo) })
const revisionesConPlaca = (placa) => ({
  placas: [...REVISIONES_DEL_ANEXO.placas, { placa, revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }],
  componentes: [...REVISIONES_DEL_ANEXO.componentes, ...K.catalogo.componentes.map((c) => ({ tipo: c.id, placa, revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }))],
})

/** Proyecto por las operaciones reales del Engine: sensor de temperatura + LED + resistencia en la placa. */
function proyectoBase(tipoSensor, placa) {
  let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => "proyecto-gen", ahora: () => "2026-01-01T00:00:00.000Z" })
  for (const [tipo, payload] of [["SetPlaca", { placa }], ["AgregarComponente", { tipo: tipoSensor }], ["AgregarComponente", { tipo: "led" }], ["AgregarComponente", { tipo: "resistencia" }]]) p = aplicar(p, tipo, payload)
  return p
}
function aplicar(p, tipo, payload) {
  const r = ejecutarOperacion(p, { idOperacion: `op-${p.revision}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
  return r.proyecto
}
const bloqueaA = (p, componente) => validarProyecto(p, K.catalogo).some((m) => m.severidad === "blocking" && m.entidad?.id === componente)
/** Con pines que el propio Engine acepta (el primero sin motivo bloqueante), la resistencia en serie y la regla numérica. */
function proyectoListo(tipoSensor, placa) {
  let p = proyectoBase(tipoSensor, placa)
  const senal = K.terminales(tipoSensor).find((t) => t.asignable).id
  const elegir = (componente, terminal, ocupado) => {
    for (const pin of K.placa(placa).pines.map((x) => x.id).filter((x) => x !== ocupado)) {
      const r = ejecutarOperacion(p, { idOperacion: "pin", actor: "agente", baseRevision: p.revision, tipo: "AsignarPin", payload: { componente, terminal, pin } }, K.catalogo)
      if (r.ok && !bloqueaA(r.proyecto, componente)) return ((p = r.proyecto), pin)
    }
    throw new Error(`sin pin válido para ${componente}.${terminal} en ${placa}`)
  }
  // La resistencia en serie primero: sin ella el LED tiene un motivo bloqueante en cualquier pin.
  p = aplicar(p, "Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } })
  const pinSensor = elegir("cmp-0", senal)
  elegir("cmp-1", "anodo", pinSensor)
  p = aplicar(p, "SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } })
  return p
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1/2 — `disponible` y el vocabulario no cambian; la generabilidad es otra pregunta
// ════════════════════════════════════════════════════════════════════════════════════

test("1 el vocabulario y `disponible` siguen iguales: el sensor sin mecanismo de lectura sigue ofrecido como disponible", async () => {
  const lectura = await leerVacio()
  assert.deepEqual(lectura.vocabulario, JSON.parse(JSON.stringify(vocabularioDesdeCatalogo(K.catalogo, ["SetPlaca", "AgregarComponente", "QuitarComponente", "AsignarPin", "Conectar", "Desconectar", "SetComportamiento", "QuitarComportamiento"], K))))
  for (const t of lectura.condicionesNumericas.catalogo)
    for (const c of t.capacidades) assert.equal(c.disponible, disponibleParaCrear(K.capacidadCuantitativa(t.tipo, c.capacidad).valor), `${t.tipo}.${c.capacidad}`)
  assert.ok(lectura.condicionesNumericas.catalogo.find((t) => t.tipo === SIN_MECANISMO).capacidades.every((c) => c.disponible === true), "se puede armar la regla")
})

test("2 `leer` trae `generabilidad` y distingue: disponible para la regla ≠ generable", async () => {
  const lectura = await leerVacio()
  const g = lectura.generabilidad
  assert.match(g.nota, /no autorización/)
  assert.deepEqual(Object.keys(g).sort(), ["componentes", "nota", "placas"])
  assert.deepEqual(g.placas.map((p) => p.placa), PLACAS)
  assert.deepEqual(g.componentes.map((c) => c.tipo), K.catalogo.componentes.map((c) => c.id))
  const sinMecanismo = capDe(g, SIN_MECANISMO, "temperatura")
  assert.equal(sinMecanismo.lectura.soportada, false)
  assert.deepEqual(sinMecanismo.generableEn, [])
  assert.deepEqual(deTipo(g, SIN_MECANISMO).generableEn, [])
  // La salida del tool es la de la consulta, más los nombres para mostrar.
  const directa = generabilidad(K)
  assert.deepEqual(g.componentes.map(({ nombre, ...resto }) => resto), JSON.parse(JSON.stringify(directa.componentes)))
  for (const c of g.componentes) assert.equal(c.nombre, K.nombre("componente", c.tipo) ?? c.tipo)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3–5 — lo que hoy es verdad, sacado de las autoridades
// ════════════════════════════════════════════════════════════════════════════════════

test("3 temperatura por protocolo: soportada por el backend del protocolo que declara Component Knowledge, generable en las placas admitidas", () => {
  const g = generabilidad(K)
  const cap = capDe(g, CON_PROTOCOLO, "temperatura")
  const declarada = K.lecturaDeCapacidad(CON_PROTOCOLO, "temperatura")
  assert.deepEqual({ soportada: cap.lectura.soportada, mecanismo: cap.lectura.mecanismo, protocolo: cap.lectura.protocolo }, { soportada: true, mecanismo: "protocolo", protocolo: declarada.protocolo })
  assert.ok(Object.hasOwn(BACKENDS_DE_PROTOCOLO, declarada.protocolo))
  const admitidas = g.placas.filter((p) => p.admitida).map((p) => p.placa)
  assert.ok(admitidas.length > 0)
  assert.deepEqual(cap.generableEn, admitidas.filter((placa) => deTipo(g, CON_PROTOCOLO).porPlaca.find((a) => a.placa === placa).admitido))
  assert.ok(cap.generableEn.length > 0, "hoy existe una ruta ejecutable para medir temperatura")
  // El actuador y el pasivo de la vertical también son generables en esas placas.
  for (const placa of cap.generableEn) {
    assert.ok(deTipo(g, "led").acciones.find((a) => a.accion === "encender").generableEn.includes(placa))
    assert.ok(deTipo(g, "resistencia").generableEn.includes(placa))
  }
})

test("4 una placa sin revisión eléctrica no aparece como equivalente: admitida false con su problema, y fuera de todo generableEn", () => {
  const g = generabilidad(K)
  const noAdmitidas = g.placas.filter((p) => !p.admitida)
  assert.ok(noAdmitidas.length > 0, "el catálogo tiene hoy una placa sin admisión")
  for (const p of noAdmitidas) {
    assert.ok(p.problemas.some((x) => /electrico/.test(x)), p.problemas.join(" | "))
    for (const c of g.componentes) {
      assert.ok(!c.generableEn.includes(p.placa), `${c.tipo} en ${p.placa}`)
      for (const k of [...c.capacidades, ...c.acciones]) assert.ok(!k.generableEn.includes(p.placa))
    }
  }
})

test("5 el sensor sin mecanismo declarado sigue en el catálogo, pero no anuncia soporte: CODEGEN_SIN_LECTURA y sin admisión", () => {
  const g = generabilidad(K)
  const c = deTipo(g, SIN_MECANISMO)
  assert.equal(capDe(g, SIN_MECANISMO, "temperatura").lectura.codigo, "CODEGEN_SIN_LECTURA")
  assert.ok(c.porPlaca.every((a) => !a.admitido && a.problemas.length > 0))
  assert.ok(K.catalogo.obtenerComponente(SIN_MECANISMO), "sigue en el catálogo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6 — derivada de las autoridades, sin tabla aparte ni ids escritos
// ════════════════════════════════════════════════════════════════════════════════════

test("6 sin ids de placas, componentes ni protocolos escritos en la proyección ni en el tool; compone el gate de generarPrograma", () => {
  const prohibidos = [...K.catalogo.componentes.map((c) => c.id), ...PLACAS, ...Object.keys(BACKENDS_DE_PROTOCOLO)]
  for (const archivo of ["opencode/codegen/generabilidad.ts", "opencode/tool/proyecto-fisico.ts"]) {
    const codigo = sinComentarios(readFileSync(join(REPO, archivo), "utf8"))
    for (const id of prohibidos) assert.ok(!new RegExp(`["'\`]${id.replace(/[-]/g, "\\-")}["'\`]`).test(codigo), `${archivo} nombra «${id}»`)
  }
  const fuente = sinComentarios(readFileSync(join(REPO, "opencode/codegen/generabilidad.ts"), "utf8"))
  for (const f of ["admitirPlaca(", "admisionDeTipoEnPlaca(", "resolverLectura(", "resolverEscritura("]) assert.ok(fuente.includes(f), f)
  const programa = sinComentarios(readFileSync(join(REPO, "opencode/codegen/programa.ts"), "utf8"))
  for (const f of ["admisionDeTipoEnPlaca(conocimiento, tipo, placa.id, revisiones)", "resolverLectura(conocimiento, catSensor, capacidad, backends)", "resolverEscritura(catActuador, entonces.accion)"]) assert.ok(programa.includes(f), `generarPrograma usa ${f}`)
})

test("6b equivalencia con el gate final: para cada (sensor de temperatura, placa), generableEn coincide con lo que hace generarPrograma", () => {
  const g = generabilidad(K)
  for (const tipo of tiposConCapacidad("temperatura")) {
    for (const placa of PLACAS) {
      const t = proyectoListo(tipo, placa)
      assert.equal(derivarReadiness(t, validarProyecto(t, K.catalogo)).listo, true, `${tipo} en ${placa}: el proyecto de prueba tiene que estar listo`)
      const resultado = generarPrograma(t, K)
      const predicho = capDe(g, tipo, "temperatura").generableEn.includes(placa)
      assert.equal(resultado.ok, predicho, `${tipo} en ${placa}: la proyección dice ${predicho} y generarPrograma ${resultado.ok ? "genera" : resultado.error.codigo}`)
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7/8 — cambia sola si cambian las autoridades
// ════════════════════════════════════════════════════════════════════════════════════

test("7 sin la revisión eléctrica humana del sensor, deja de ser generable (y vuelve con una revisión de la placa)", () => {
  const sin = generabilidad(K, { revisiones: revisionesSin(CON_PROTOCOLO) })
  assert.deepEqual(capDe(sin, CON_PROTOCOLO, "temperatura").generableEn, [])
  assert.ok(deTipo(sin, CON_PROTOCOLO).porPlaca.every((a) => !a.admitido))
  const noAdmitida = generabilidad(K).placas.find((p) => !p.admitida).placa
  const con = generabilidad(K, { revisiones: revisionesConPlaca(noAdmitida) })
  assert.equal(con.placas.find((p) => p.placa === noAdmitida).admitida, true)
  assert.ok(capDe(con, CON_PROTOCOLO, "temperatura").generableEn.includes(noAdmitida))
})

test("8 sin el backend del protocolo, la lectura no está soportada (CODEGEN_PROTOCOLO_SIN_BACKEND) y nada que dependa de ella es generable", () => {
  const sin = generabilidad(K, { protocolos: {} })
  const cap = capDe(sin, CON_PROTOCOLO, "temperatura")
  assert.equal(cap.lectura.soportada, false)
  assert.equal(cap.lectura.codigo, "CODEGEN_PROTOCOLO_SIN_BACKEND")
  assert.equal(cap.lectura.datos.protocolo, K.lecturaDeCapacidad(CON_PROTOCOLO, "temperatura").protocolo)
  assert.deepEqual(cap.generableEn, [])
  assert.deepEqual(deTipo(sin, CON_PROTOCOLO).generableEn, [])
  // La admisión no cambió: lo que falta es el backend.
  assert.ok(deTipo(sin, CON_PROTOCOLO).porPlaca.some((a) => a.admitido))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 9 — guía, no autorización
// ════════════════════════════════════════════════════════════════════════════════════

test("9 aunque la proyección diga generable, el gate final decide: un proyecto no listo y una placa sin revisión siguen fallando cerrado", () => {
  const g = generabilidad(K)
  const placa = capDe(g, CON_PROTOCOLO, "temperatura").generableEn[0]
  const r = generarPrograma(proyectoBase(CON_PROTOCOLO, placa), K)
  assert.equal(r.ok, false)
  assert.equal(r.error.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  // generarPrograma no consulta la proyección: no la importa.
  assert.doesNotMatch(readFileSync(join(REPO, "opencode/codegen/programa.ts"), "utf8"), /from\s+["'][^"']*generabilidad/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 11/12 — sin C++ en Component Knowledge, sin verdad física en el prompt
// ════════════════════════════════════════════════════════════════════════════════════

test("11 Component Knowledge no tiene implementación de backend", () => {
  const dir = join(REPO, "opencode/conocimiento")
  for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))) {
    const codigo = sinComentarios(readFileSync(join(dir, f), "utf8"))
    assert.doesNotMatch(codigo, /#include|digitalRead|digitalWrite|pinMode|lib_deps|BACKENDS_DE_PROTOCOLO|codegen\//, f)
  }
})

test("12 el prompt manda a consultar `generabilidad` y no trae la respuesta escrita: sin placas, componentes ni protocolos en ese párrafo", () => {
  const i = PROMPT.indexOf("**Antes de elegir placa y piezas, mirá `generabilidad`")
  assert.ok(i >= 0)
  const parrafo = PROMPT.slice(i, PROMPT.indexOf("\n\n", i))
  assert.match(parrafo, /`generableEn`/)
  assert.match(parrafo, /no un permiso/)
  assert.match(parrafo, /No lo deduzcas de lo que sabés de electrónica/)
  const nombres = [
    ...K.catalogo.componentes.flatMap((c) => [c.id, K.nombre("componente", c.id)]),
    ...K.catalogo.placas.flatMap((p) => [p.id, K.nombre("placa", p.id), ...(p.alias ?? [])]),
    ...Object.keys(BACKENDS_DE_PROTOCOLO),
  ].filter(Boolean)
  for (const n of nombres) assert.ok(!parrafo.toLowerCase().includes(String(n).toLowerCase()), `el párrafo nombra «${n}»`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Sin fallback silencioso
// ════════════════════════════════════════════════════════════════════════════════════

test("sin codegen/ instalado, `leer` sigue andando y dice que no pudo consultar la generabilidad (nunca inventa datos)", async () => {
  const raiz = join(DIR_BASE, `sin-codegen-${process.pid}`)
  rmSync(raiz, { recursive: true, force: true })
  mkdirSync(join(raiz, "opencode"), { recursive: true })
  try {
    for (const d of readdirSync(join(REPO, "opencode"))) if (d !== "codegen") cpSync(join(REPO, "opencode", d), join(raiz, "opencode", d), { recursive: true })
    symlinkSync(join(REPO, "node_modules"), join(raiz, "node_modules"), "dir")
    const tool = (await import(pathToFileURL(join(raiz, "opencode/tool/proyecto-fisico.ts")).href)).default
    const r = JSON.parse(await tool.execute({ accion: "leer", idProyecto: nuevoIdProyecto("sincg") }, { directory: nuevoDir("sin-codegen") }))
    assert.equal(r.resultado, "SÓLO LECTURA — no cambió nada")
    assert.ok(r.vocabulario && r.condicionesNumericas, "el resto de leer no se rompe")
    assert.equal(r.generabilidad.placas, null)
    assert.equal(r.generabilidad.componentes, null)
    assert.match(r.generabilidad.nota, /No se pudo consultar la generabilidad/)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})
