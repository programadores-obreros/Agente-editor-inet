// Semantic Vertical #3 — expresividad binaria mínima (modelo M1, Design Gate aprobado).
//
// Una regla de NIVEL: condición de nivel → ESTADO OBJETIVO sostenido del actuador. Para un
// actuador binario con complemento DECLARADO (DEFINICIONES_ACCION.complementaria), el
// reposo = complemento del objetivo: derivado, nunca persistido, no es un "si no".
//
// Casos de aceptación:
//   A  presionado (>=1) → encender   reposo apagado    (existente, mismo significado)
//   B  presionado (>=1) → apagar     reposo encendido  (Human Test #3: "prendido salvo cuando aprieto")
//   C  suelto     (<1)  → encender   reposo apagado
//   D  suelto     (<1)  → apagar     reposo encendido

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { vocabularioDesdeCatalogo } = await import(join(REPO, "opencode/conocimiento/vocabulario.ts"))
const { ETIQUETA_DE_ESTADO_OBJETIVO } = await import(join(REPO, "opencode/conocimiento/anexos/pedagogia-es-AR.ts"))
const { condicionBooleanaCanonica, valorBooleanoDeCondicion } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
const { construirCatalogo, complementoDeAccion, proyeccionSemanticaCatalogo, DEFINICIONES_ACCION } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirOperacionRegla } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { proyectarModeloLogico } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica.js"))

const K = CONOCIMIENTO_ACTIVO
const catalogo = K.catalogo
const PRESIONADO = condicionBooleanaCanonica("estadoBooleano", "verdadero")
const SUELTO = condicionBooleanaCanonica("estadoBooleano", "falso")
const HASH_2_0_0 = "878011f7ec8c586adc632db819e5bcb05fc7731237d21caf01de222574a3a2f6"

const CASOS = {
  A: { cuando: PRESIONADO, accion: "encender", texto: "Mientras el Pulsador esté presionado, el LED está encendido.", ramas: ["Si el Pulsador está presionado → la condición es verdadera → el LED está encendido.", "Si el Pulsador no está presionado → la condición es falsa → el LED está apagado (reposo)."] },
  B: { cuando: PRESIONADO, accion: "apagar", texto: "Mientras el Pulsador esté presionado, el LED está apagado.", ramas: ["Si el Pulsador está presionado → la condición es verdadera → el LED está apagado.", "Si el Pulsador no está presionado → la condición es falsa → el LED está encendido (reposo)."] },
  C: { cuando: SUELTO, accion: "encender", texto: "Mientras el Pulsador esté suelto, el LED está encendido.", ramas: ["Si el Pulsador está suelto → la condición es verdadera → el LED está encendido.", "Si el Pulsador no está suelto → la condición es falsa → el LED está apagado (reposo)."] },
  D: { cuando: SUELTO, accion: "apagar", texto: "Mientras el Pulsador esté suelto, el LED está apagado.", ramas: ["Si el Pulsador está suelto → la condición es verdadera → el LED está apagado.", "Si el Pulsador no está suelto → la condición es falsa → el LED está encendido (reposo)."] },
}

// ── fixtures ────────────────────────────────────────────────────────────────────────

let n = 0
function aplicar(servicio, tipo, payload) {
  const r = servicio.aplicar({ idOperacion: `v3-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  return r
}

/** Proyecto por el camino de producción: ESP32 + pulsador (cmp-0) + LED (cmp-1) + resistencia (cmp-2). */
function proyecto() {
  const directorio = nuevoDir("v3")
  const idProyecto = nuevoIdProyecto("v3")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of ["pulsador", "led", "resistencia"]) aplicar(servicio, "AgregarComponente", { tipo })
  aplicar(servicio, "AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" })
  aplicar(servicio, "AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" })
  aplicar(servicio, "Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } })
  return { servicio, directorio, idProyecto }
}
const regla = (caso) => ({ comportamiento: { cuando: { sensor: "cmp-0", ...CASOS[caso].cuando }, entonces: { actuador: "cmp-1", accion: CASOS[caso].accion } } })

function catalogoCon(cambio) {
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (cambio[c.id] ? { ...c, ...cambio[c.id] } : c))
  return construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1–4, 11–13: A/B/C/D por el Engine, frase, traza, persistencia y recarga
// ════════════════════════════════════════════════════════════════════════════════════

for (const caso of ["A", "B", "C", "D"]) {
  test(`CASE ${caso}: Engine → IR → frase + traza con reposo complementario → recarga idéntica`, () => {
    const { servicio, directorio, idProyecto } = proyecto()
    aplicar(servicio, "SetComportamiento", regla(caso))
    const s = servicio.snapshot()
    const [r] = s.vista.reglas
    assert.equal(r.texto, CASOS[caso].texto)
    assert.equal(r.texto.toLowerCase().includes("si no"), false, "la frase principal nunca dice 'si no' (HD-P3D-9)")
    assert.deepEqual(r.traza.ramas, CASOS[caso].ramas)
    assert.equal(r.completa, true)
    assert.equal(s.validacion.readiness.listo, true, "la regla es válida")
    // El IR guarda SÓLO la condición y el estado objetivo: ni reposo ni rama "si no".
    const guardada = s.proyecto.comportamientos[0]
    assert.deepEqual(Object.keys(guardada.entonces).sort(), ["accion", "actuador"])
    assert.deepEqual(guardada.cuando, { sensor: "cmp-0", ...CASOS[caso].cuando })
    const vistaAntes = s.vista
    servicio.cerrar()
    const documento = readFileSync(join(directorio, `${idProyecto}.json`), "utf8")
    assert.ok(!/reposo|siNo|"else"/.test(documento), "el reposo no se persiste")
    const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
    try {
      assert.deepEqual(reabierto.snapshot().proyecto.comportamientos, s.proyecto.comportamientos)
      assert.deepEqual(reabierto.snapshot().vista.reglas, vistaAntes.reglas)
    } finally {
      reabierto.cerrar()
    }
  })
}

test("Blockly: el modelo lógico (lo que dibuja Blockly) muestra A/B/C/D con los valores del servidor, sin lógica propia", () => {
  const esperado = { A: ["presionado", "encendido"], B: ["presionado", "apagado"], C: ["suelto", "encendido"], D: ["suelto", "apagado"] }
  for (const caso of ["A", "B", "C", "D"]) {
    const { servicio } = proyecto()
    try {
      aplicar(servicio, "SetComportamiento", regla(caso))
      const m = proyectarModeloLogico(servicio.snapshot().vista)
      assert.deepEqual(m.regla.campos.map((f) => f.valor), ["cmp-0", esperado[caso][0], "cmp-1", esperado[caso][1]], caso)
      assert.deepEqual(m.regla.campos[1].opciones.map((o) => o.etiqueta), ["presionado", "suelto"])
      assert.deepEqual(m.regla.campos[3].opciones.map((o) => o.etiqueta), ["encendido", "apagado"])
    } finally {
      servicio.cerrar()
    }
  }
})

test("1/19: CASE A conserva EXACTAMENTE el texto y la traza previos a Vertical #3", () => {
  const { servicio } = proyecto()
  try {
    aplicar(servicio, "SetComportamiento", regla("A"))
    const [r] = servicio.snapshot().vista.reglas
    assert.equal(r.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
    assert.deepEqual(r.traza, { etiqueta: "Explicación de la regla — no es una simulación ni lo que pasa en la placa.", ramas: CASOS.A.ramas })
    assert.deepEqual(r.frase.estado, { clave: "presionado", etiqueta: "presionado" })
    assert.deepEqual(r.frase.salida, { clave: "encendido", etiqueta: "encendido" })
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5–7: formas canónicas (una sola fuente) y condición avanzada
// ════════════════════════════════════════════════════════════════════════════════════

test("5/6: presionado = estadoBooleano >= 1, suelto = estadoBooleano < 1 (complementos exactos)", () => {
  assert.deepEqual({ ...PRESIONADO, umbral: { ...PRESIONADO.umbral } }, { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } })
  assert.deepEqual({ ...SUELTO, umbral: { ...SUELTO.umbral } }, { capacidad: "estadoBooleano", comparador: "<", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } })
  assert.equal(valorBooleanoDeCondicion(PRESIONADO), "verdadero")
  assert.equal(valorBooleanoDeCondicion(SUELTO), "falso")
  const [presionado, suelto] = K.estadosDeEntrada("pulsador")
  assert.deepEqual([presionado.etiqueta, presionado.condicion], ["presionado", PRESIONADO])
  assert.deepEqual([suelto.etiqueta, suelto.condicion], ["suelto", SUELTO])
})

test("7: otras tríadas equivalentes (<= 0, > 0) siguen representables como 'condición avanzada'", () => {
  const { servicio } = proyecto()
  try {
    for (const [comparador, valor] of [["<=", 0], [">", 0]]) {
      aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "estadoBooleano", comparador, umbral: { valor, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-1", accion: "encender" } } })
    }
    for (const r of servicio.snapshot().vista.reglas) {
      assert.deepEqual(r.frase.estado, { clave: "avanzada", etiqueta: "condición avanzada" })
      assert.equal(r.texto, null)
      assert.match(r.aviso, /«presionado» o «suelto»/)
    }
  } finally {
    servicio.cerrar()
  }
})

test("22 (estático): ninguna tríada booleana escrita a mano fuera de nucleo/estado-booleano.ts", () => {
  for (const archivo of ["opencode/vista-fisica/snapshot-a-vista.ts", "opencode/conocimiento/vocabulario.ts", "opencode/agent/tecnia-bot.md", "opencode/tool/proyecto-fisico.ts"]) {
    const fuente = readFileSync(join(REPO, archivo), "utf8")
    assert.doesNotMatch(fuente, /comparador:\s*"(>=|<)"[^\n]*estadoBooleano|valor:\s*1,\s*unidad:\s*"ninguna"/, archivo)
  }
  const v = vocabularioDesdeCatalogo(catalogo, ["SetComportamiento"])
  const { sensor, ...condicion } = v.operaciones.SetComportamiento.comportamiento.cuando
  assert.ok(sensor.startsWith("<"), "el sensor es un marcador, no un id inventado")
  assert.deepEqual(condicion, { ...PRESIONADO, umbral: { ...PRESIONADO.umbral } })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 8–10, 21: opciones desde el conocimiento y edición tipo Blockly por el Engine
// ════════════════════════════════════════════════════════════════════════════════════

test("8/9/10: los desplegables ofrecen presionado/suelto y encendido/apagado, derivados del conocimiento", () => {
  const { servicio } = proyecto()
  try {
    const slots = servicio.snapshot().vista.opcionesRegla.slots
    assert.deepEqual(slots[1].opciones.map((o) => o.etiqueta), ["presionado", "suelto"])
    assert.deepEqual(slots[3].opciones.map((o) => [o.etiqueta, o.parche.entonces.accion]), [["encendido", "encender"], ["apagado", "apagar"]])
    assert.deepEqual(slots[1].opciones[1].parche.cuando, { ...SUELTO, umbral: { ...SUELTO.umbral } })
    // Si el catálogo de un actuador declara sólo "encender", "apagado" deja de ofrecerse: sale del dato, no de la vista.
    const soloEncender = catalogoCon({ led: { acciones: ["encender"] } })
    const v = proyectarVista(servicio.snapshot().proyecto, soloEncender)
    assert.deepEqual(v.opcionesRegla.slots[3].opciones.map((o) => o.etiqueta), ["encendido"])
  } finally {
    servicio.cerrar()
  }
})

test("21: elegir 'apagado' en el desplegable arma una operación TIPADA que pasa por el Engine (nunca toca el IR directo)", () => {
  const { servicio } = proyecto()
  try {
    aplicar(servicio, "SetComportamiento", regla("A"))
    const vista = servicio.snapshot().vista
    const operacion = construirOperacionRegla({ regla: vista.reglas[0], slot: "salida", valor: "apagado", opcionesRegla: vista.opcionesRegla })
    assert.equal(operacion.tipo, "SetComportamiento")
    assert.equal(operacion.payload.comportamiento.entonces.accion, "apagar")
    const revisionAntes = servicio.snapshot().revision
    aplicar(servicio, "SetComportamiento", operacion.payload)
    const despues = servicio.snapshot()
    assert.equal(despues.revision, revisionAntes + 1, "una revisión del Engine")
    assert.equal(despues.vista.reglas[0].texto, CASOS.B.texto)
    assert.equal(despues.proyecto.comportamientos.length, 1, "reemplaza la misma regla (mismo id)")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 14–16: estado incompleto y ACCION_NO_SOPORTADA (blocking ≠ rechazo)
// ════════════════════════════════════════════════════════════════════════════════════

test("14: una regla incompleta con 'apagar' sigue siendo persistible y recargable", () => {
  const { servicio, directorio, idProyecto } = proyecto()
  aplicar(servicio, "SetComportamiento", { comportamiento: { entonces: { accion: "apagar" } } })
  const antes = servicio.snapshot()
  assert.ok(antes.validacion.motivos.some((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO"))
  assert.deepEqual(antes.vista.reglas[0].frase.salida, { clave: "apagado", etiqueta: "apagado" })
  servicio.cerrar()
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    assert.deepEqual(reabierto.snapshot().proyecto.comportamientos, antes.proyecto.comportamientos)
  } finally {
    reabierto.cerrar()
  }
})

test("15/16: ACCION_NO_SOPORTADA es blocking + representable: la operación commitea, se persiste, recarga y se corrige", () => {
  const soloEncender = catalogoCon({ led: { acciones: ["encender"] } })
  let p = { ...crearProyecto({ generadorId: () => "v3-ans", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: soloEncender.version, catalogoHash: soloEncender.hash }), placa: "esp32-devkit-v1" }
  const ejecutar = (tipo, payload) => {
    const r = ejecutarOperacion(p, { idOperacion: `v3a-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, soloEncender)
    assert.equal(r.ok, true, `${tipo} no debe rechazarse: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  }
  for (const tipo of ["pulsador", "led"]) ejecutar("AgregarComponente", { tipo })
  ejecutar("SetComportamiento", regla("B"))
  const motivos = validarProyecto(p, soloEncender)
  const ans = motivos.find((m) => m.codigo === "ACCION_NO_SOPORTADA")
  assert.ok(ans, JSON.stringify(motivos))
  assert.deepEqual([ans.severidad, ans.clasificacion, ans.entidad.tipo], ["blocking", "representable", "comportamiento"])
  assert.deepEqual(ans.datos, { componente: "cmp-1", accion: "apagar", soportadas: ["encender"] })
  assert.equal(derivarReadiness(p, motivos).listo, false)
  // Persistible ⇒ recargable con el mismo catálogo.
  const almacen = crearAlmacen({ directorio: nuevoDir("v3-ans"), catalogo: soloEncender })
  assert.equal(almacen.guardar(p).ok, true)
  const cargado = almacen.cargar(p.id)
  assert.equal(cargado.ok, true)
  assert.deepEqual(cargado.proyecto.comportamientos, p.comportamientos)
  // Se corrige editando la regla: el motivo desaparece.
  ejecutar("SetComportamiento", { comportamiento: { ...regla("A").comportamiento, id: p.comportamientos[0].id } })
  assert.ok(!validarProyecto(p, soloEncender).some((m) => m.codigo === "ACCION_NO_SOPORTADA"))
})

test("15: un Pulsador usado como actuador da ACTUADOR_INVALIDO y ACCION_NO_SOPORTADA, representables (no rollback)", () => {
  const { servicio, directorio, idProyecto } = proyecto()
  aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", ...PRESIONADO }, entonces: { actuador: "cmp-0", accion: "encender" } } })
  const s = servicio.snapshot()
  const codigos = s.validacion.motivos.map((m) => m.codigo)
  assert.ok(codigos.includes("ACTUADOR_INVALIDO") && codigos.includes("ACCION_NO_SOPORTADA"), JSON.stringify(codigos))
  assert.equal(s.validacion.readiness.listo, false)
  assert.equal(s.vista.reglas[0].texto, null, "una regla con un estado no soportado no se presenta como canónica")
  const explicacion = s.vista.motivos.find((m) => m.codigo === "ACCION_NO_SOPORTADA").explicacion
  assert.match(explicacion, /Pulsador no puede quedar encendido/)
  servicio.cerrar()
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    assert.ok(reabierto.snapshot().validacion.motivos.some((m) => m.codigo === "ACCION_NO_SOPORTADA"))
  } finally {
    reabierto.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 17–18: identidad del catálogo
// ════════════════════════════════════════════════════════════════════════════════════

test("17: la relación complementaria es semántica: está en la proyección del hash y quitarla cambia el hash", () => {
  const datos = { version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }
  const proyeccion = proyeccionSemanticaCatalogo(datos)
  assert.deepEqual(proyeccion.acciones, [{ id: "encender", complementaria: "apagar" }, { id: "apagar", complementaria: "encender" }])
  assert.equal(sha256Hex(canonicalizar(proyeccion)), catalogo.hash)
  const sinComplemento = { ...proyeccion, acciones: proyeccion.acciones.map(({ id }) => ({ id })) }
  assert.notEqual(sha256Hex(canonicalizar(sinComplemento)), catalogo.hash)
  assert.equal(catalogo.version, "2.1.0")
  assert.notEqual(catalogo.hash, HASH_2_0_0)
})

test("18: los rótulos pedagógicos (encendido/apagado) NO entran al hash", () => {
  const antes = catalogoCon({}).hash
  const original = ETIQUETA_DE_ESTADO_OBJETIVO.apagar
  try {
    ETIQUETA_DE_ESTADO_OBJETIVO.apagar = "APAGADÍSIMO"
    assert.equal(catalogoCon({}).hash, antes)
    assert.equal(createHash("sha256").update(canonicalizar(proyeccionSemanticaCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }))).digest("hex"), antes)
  } finally {
    ETIQUETA_DE_ESTADO_OBJETIVO.apagar = original
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 19–20: compatibilidad de documentos viejos (2.0.0)
// ════════════════════════════════════════════════════════════════════════════════════

function documentoViejo(caso) {
  const { servicio, directorio, idProyecto } = proyecto()
  aplicar(servicio, "SetComportamiento", regla(caso))
  servicio.cerrar()
  const ruta = join(directorio, `${idProyecto}.json`)
  const doc = JSON.parse(readFileSync(ruta, "utf8"))
  writeFileSync(ruta, JSON.stringify({ ...doc, catalogoVersion: "2.0.0", catalogoHash: HASH_2_0_0 }))
  return { directorio, idProyecto, ruta }
}

test("19: un proyecto 2.0.0 con 'encender' conserva su significado (reposo apagado), con el desfase visible", () => {
  const { directorio, idProyecto } = documentoViejo("A")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const s = servicio.snapshot()
    assert.ok(s.validacion.motivos.some((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO" && m.severidad === "info"))
    assert.deepEqual(s.vista.reglas[0].traza.ramas, CASOS.A.ramas, "mismo significado que con el contrato viejo")
  } finally {
    servicio.cerrar()
  }
})

test("20: un proyecto 2.0.0 con 'apagar' se recarga, muestra CATALOGO_CAMBIO_DETECTADO y el contrato nuevo, sin reescribir createdWith", () => {
  const { directorio, idProyecto, ruta } = documentoViejo("B")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const s = servicio.snapshot()
    const aviso = s.validacion.motivos.find((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO")
    assert.ok(aviso, "la reinterpretación nunca es silenciosa")
    assert.equal(aviso.datos.catalogoHashGuardado, HASH_2_0_0)
    assert.equal(aviso.datos.catalogoHashActivo, catalogo.hash)
    assert.deepEqual(s.vista.reglas[0].traza.ramas, CASOS.B.ramas, "antes: 'no cambia nada visible'; ahora: encendido fuera de la condición")
    aplicar(servicio, "AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO5" }) // un commit cualquiera
  } finally {
    servicio.cerrar()
  }
  const guardado = JSON.parse(readFileSync(ruta, "utf8"))
  assert.equal(guardado.catalogoHash, HASH_2_0_0, "createdWith no se reescribe")
  assert.equal(guardado.catalogoVersion, "2.0.0")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 23–24: "salvo cuando" sólo con complemento DECLARADO
// ════════════════════════════════════════════════════════════════════════════════════

test("23: 'quiero que el LED quede prendido salvo cuando aprieto el botón' → CASE B, usando el complemento DECLARADO", () => {
  // Lo que el agente recibe de `leer` (vocabulario tipado) — sin NLP: se ejercita el contrato.
  const v = vocabularioDesdeCatalogo(catalogo, ["SetComportamiento"])
  const led = v.componentes.find((c) => c.tipo === "led")
  const pulsador = v.componentes.find((c) => c.tipo === "pulsador")
  const encendido = led.estadosDeSalida.find((e) => e.estado === "encendido")
  assert.deepEqual(encendido.complemento, { estado: "apagado", accion: "apagar" }, "declarado por Tecnia Bot")
  const presionado = pulsador.estadosDeEntrada.find((e) => e.estado === "presionado")
  const payload = { comportamiento: { cuando: { sensor: "cmp-0", ...presionado.condicion }, entonces: { actuador: "cmp-1", accion: encendido.complemento.accion } } }
  const { servicio } = proyecto()
  try {
    aplicar(servicio, "SetComportamiento", payload)
    const [r] = servicio.snapshot().vista.reglas
    assert.equal(r.texto, CASOS.B.texto)
    assert.deepEqual(r.traza.ramas, CASOS.B.ramas)
  } finally {
    servicio.cerrar()
  }
})

test("24: sin complemento declarado no hay complemento: ni en el conocimiento, ni en el vocabulario, ni una negación genérica", () => {
  // Un actuador que ofrece sólo "encender": su complemento no existe aunque el registro lo tenga.
  const soloEncender = crearConocimiento(catalogoCon({ led: { acciones: ["encender"] } }))
  assert.equal(soloEncender.complementoDe("led", "encender"), undefined)
  assert.deepEqual(soloEncender.estadosDeSalida("led"), [{ accion: "encender", etiqueta: "encendido" }])
  const v = vocabularioDesdeCatalogo(soloEncender.catalogo, ["SetComportamiento"], soloEncender)
  assert.equal(v.componentes.find((c) => c.tipo === "led").estadosDeSalida[0].complemento, undefined)
  // Un registro sin relación declarada (o asimétrica) tampoco produce complemento.
  assert.equal(complementoDeAccion({ acciones: ["encender", "apagar"] }, "encender", [{ id: "encender" }, { id: "apagar" }]), undefined)
  assert.equal(complementoDeAccion({ acciones: ["encender", "apagar"] }, "encender", [{ id: "encender", complementaria: "apagar" }, { id: "apagar" }]), undefined)
  assert.equal(complementoDeAccion({ acciones: ["encender", "apagar"] }, "encender", DEFINICIONES_ACCION), "apagar")
  // La traza no inventa un reposo cuando no hay complemento.
  const p = proyectoDirectoConRegla(soloEncender.catalogo)
  const [r] = proyectarVista(p, soloEncender.catalogo).reglas
  assert.match(r.traza.ramas[1], /no dice cómo queda el LED/)
  // Y la guía del agente prohíbe inventarlo.
  const guia = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  assert.match(guia, /complemento.{0,40}declarado/i)
  assert.match(guia, /Si ese estado NO trae\s+`complemento`, no lo inventes/)
})

function proyectoDirectoConRegla(cat) {
  let p = { ...crearProyecto({ generadorId: () => "v3-sc", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: cat.version, catalogoHash: cat.hash }), placa: "esp32-devkit-v1" }
  for (const [tipo, payload] of [
    ["AgregarComponente", { tipo: "pulsador" }],
    ["AgregarComponente", { tipo: "led" }],
    ["SetComportamiento", regla("A")],
  ]) {
    const r = ejecutarOperacion(p, { idOperacion: `v3s-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, cat)
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    p = r.proyecto
  }
  return p
}
