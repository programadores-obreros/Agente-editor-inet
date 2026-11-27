// Por qué no hay programa, en palabras: la ventana y la tool `programa` dicen LO MISMO.
//
// POR QUÉ EXISTE (2026-11-26, prueba 9 en la notebook real). Con un Arduino UNO la ventana decía
// «El proyecto está completo» y «esta versión no sabe programar este proyecto tal como está
// armado», sin decir qué; y el asistente le contestó al docente con `CODEGEN_NO_ADMITIDO` y
// `arduino-uno`, que era lo único que le daba la tool.
//
// QUÉ MIRAN ESTAS PRUEBAS, Y POR QUÉ ASÍ.
//   - El proyecto se arma por la tool real `proyecto-fisico` y el rechazo sale del generador real:
//     no se le pasa a la explicación un error escrito a mano para el caso que importa (el UNO).
//   - La ventana se mira por `cargarProgramaDe`, que es lo que llama la tool `vista-fisica` en
//     producción: `programaParaVista` suelto acepta que no le pasen el proyecto y entonces da el
//     texto general, así que probarlo suelto no decía nada de lo que ve el docente.
//   - El texto esperado está ENTERO: una prueba que sólo buscara «Arduino UNO» seguiría verde si
//     la lista «Por ahora programa» nombrara también al UNO.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { default: proyectoFisico } = await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))
const { default: programaTool, ejecutarPrograma } = await import(join(REPO, "opencode/tool/programa.ts"))
const { cargarProgramaDe } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { porQueNoHayPrograma, TODAVIA_NO_SE_SABE_PROGRAMAR, TODAVIA_NO_ESTA_LISTO, TODAVIA_FALTA_ARMAR, PIN_QUE_NO_SE_PUEDE_USAR } = await import(join(REPO, "opencode/codegen/por-que-no-hay-programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

const PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const pulsadorPrendeLed = (placa, pines) => [
  { tipo: "SetPlaca", payload: { placa } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: pines[0] } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: pines[1] } },
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
  { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0", ...PRESIONADO }, entonces: { actuador: "cmp-1", accion: "encender" } } } },
]
const fisico = async (dir, args) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
async function armar(placa, pines) {
  const dir = nuevoDir("por-que-no")
  const { revision } = await fisico(dir, { accion: "leer" })
  const r = await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones: pulsadorPrendeLed(placa, pines) })
  assert.equal(r.ok, true, JSON.stringify(r))
  return dir
}
const snapshotDe = (dir) => obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto: "activo" }).snapshot()

/** Lo que NUNCA puede leer un docente: códigos del generador, ids de la IR o del catálogo, JSON. */
const INTERNO = /CODEGEN|cmp-|beh-|arduino-uno|esp32-devkit|[{}[\]]/

const DEL_UNO =
  "Todavía no hay programa: esta versión de Tecnia Bot todavía no programa la placa «Arduino UNO». Por ahora programa: «ESP32 DevKit». El montaje y las reglas siguen valiendo."

test("Arduino UNO (el caso de la notebook): la ventana dice qué placa no se programa y cuál sí, sin nada interno", async () => {
  const dir = await armar("arduino-uno", ["D2", "D3"])
  const snapshot = snapshotDe(dir)
  const generado = generarPrograma(snapshot.proyecto, K)
  assert.equal(generado.ok, false)
  assert.equal(generado.error.codigo, "CODEGEN_NO_ADMITIDO", "la precondición: el rechazo es el de la notebook")
  const programaDe = await cargarProgramaDe(K)
  assert.deepEqual(programaDe(snapshot), { ok: false, porQue: DEL_UNO })
  assert.doesNotMatch(DEL_UNO, INTERNO)
})

test("Arduino UNO: la tool `programa` le da al asistente la MISMA explicación que la ventana, y primera", async () => {
  const dir = await armar("arduino-uno", ["D2", "D3"])
  const enLaVentana = (await cargarProgramaDe(K))(snapshotDe(dir)).porQue
  for (const accion of ["generar", "compilar"]) {
    const r = JSON.parse(await programaTool.execute({ accion }, { directory: dir }))
    assert.equal(r.ok, false)
    assert.equal(r.explicacion, enLaVentana, `${accion}: la misma, letra por letra`)
    assert.equal(r.resultado, `NO SE GENERÓ EL PROGRAMA — ${enLaVentana}`)
    assert.doesNotMatch(r.resultado, INTERNO, "lo primero que lee el asistente no trae ningún código")
    assert.equal(Object.keys(r)[0], "resultado")
    assert.equal(r.codigo, "CODEGEN_NO_ADMITIDO", "el código sigue, para diagnosticar")
  }
})

test("una pieza que el generador no sabe leer: se la nombra como la nombra la ventana, no por su id", async () => {
  // El mismo fixture de `codegen-s1b` (caso 9): la entrada del pulsador sin pull-up interno.
  const componentes = COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? { ...c, terminales: c.terminales.map((t) => (t.id === "senal" ? { ...t, requierePullUpInterno: false } : t)) } : c))
  const fixture = crearConocimiento(construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex))
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const deps = async () => ({ obtenerServicioDeProyectoConVista, conocimiento: fixture, generarPrograma, porQueNoHayPrograma })
  const r = JSON.parse(await ejecutarPrograma({ accion: "compilar" }, { directory: dir }, deps))
  assert.equal(r.codigo, "CODEGEN_SIN_LECTURA", "la precondición")
  const nombre = fixture.nombre("componente", "pulsador")
  assert.equal(typeof nombre, "string")
  assert.equal(r.explicacion, `Todavía no hay programa: esta versión de Tecnia Bot todavía no sabe leer «${nombre}» para la regla que la usa. El montaje y las reglas siguen valiendo.`)
  assert.doesNotMatch(r.explicacion, INTERNO)
})

test("piezas que no se programan con una placa que sí: se nombran las piezas y la placa", async () => {
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const contexto = { proyecto: snapshotDe(dir).proyecto, conocimiento: K }
  const con = (noAdmitidos) => porQueNoHayPrograma({ codigo: "CODEGEN_NO_ADMITIDO", datos: { placa: "esp32-devkit-v1", noAdmitidos } }, contexto)
  assert.equal(
    con([{ kind: "componente", id: "led", problemas: ["electrico: x"] }, { kind: "componente", id: "pulsador", problemas: [] }]),
    `Todavía no hay programa: esta versión de Tecnia Bot todavía no programa «${K.nombre("componente", "led")}» y «${K.nombre("componente", "pulsador")}» con la placa «ESP32 DevKit». El montaje y las reglas siguen valiendo.`,
  )
  // Sin nombre no se inventa: ni se muestra el id ni se nombra la mitad.
  assert.equal(con([{ kind: "componente", id: "led", problemas: [] }, { kind: "componente", id: "pieza-sin-nombre", problemas: [] }]), TODAVIA_NO_SE_SABE_PROGRAMAR)
  assert.equal(con([]), TODAVIA_NO_SE_SABE_PROGRAMAR)
  assert.equal(con("no es una lista"), TODAVIA_NO_SE_SABE_PROGRAMAR)
})

test("lo que no tiene explicación propia cae a la general; ningún texto trae nada interno", async () => {
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const contexto = { proyecto: snapshotDe(dir).proyecto, conocimiento: K }
  const datos = { componente: "cmp-0", tipo: "pulsador", clase: "identificador", valor: "cmp-0" }
  const textos = [TODAVIA_NO_ESTA_LISTO, TODAVIA_FALTA_ARMAR, TODAVIA_NO_SE_SABE_PROGRAMAR, PIN_QUE_NO_SE_PUEDE_USAR]
  for (const codigo of ["CODEGEN_NO_ADMITIDO", "CODEGEN_SIN_LECTURA", "CODEGEN_PROTOCOLO_SIN_BACKEND", "CODEGEN_LECTURA_INCOHERENTE", "CODEGEN_UMBRAL_NO_CONVERTIBLE", "CODEGEN_CONVERSION_NO_MONOTONA", "CODEGEN_SIN_ESCRITURA", "CODEGEN_REPOSO_NO_DECLARADO", "CODEGEN_PIN_NO_DERIVABLE", "CODEGEN_IDENTIFICADOR_INVALIDO", "CODEGEN_DATO_NO_EMITIBLE", "CODEGEN_UNO_QUE_NO_EXISTE"]) {
    const texto = porQueNoHayPrograma({ codigo, datos }, contexto)
    textos.push(texto)
    assert.match(texto, /^Todavía no hay programa: /, codigo)
    // Sin el proyecto no se sabe de qué pieza se habla: no se inventa una causa.
    assert.equal(porQueNoHayPrograma({ codigo, datos }), TODAVIA_NO_SE_SABE_PROGRAMAR, codigo)
  }
  for (const codigo of ["CODEGEN_IDENTIFICADOR_INVALIDO", "CODEGEN_DATO_NO_EMITIBLE", "CODEGEN_UNO_QUE_NO_EXISTE"]) assert.equal(porQueNoHayPrograma({ codigo, datos }, contexto), TODAVIA_NO_SE_SABE_PROGRAMAR)
  // Una pieza que el error señala y el proyecto no tiene: general, no «undefined».
  assert.equal(porQueNoHayPrograma({ codigo: "CODEGEN_SIN_ESCRITURA", datos: { componente: "cmp-99" } }, contexto), TODAVIA_NO_SE_SABE_PROGRAMAR)
  assert.match(porQueNoHayPrograma({ codigo: "CODEGEN_SIN_ESCRITURA", datos }, contexto), /no sabe manejar «/)
  for (const texto of textos) assert.doesNotMatch(texto, /CODEGEN|cmp-|beh-|undefined|null|[{}[\]]/)
})

// ── agregadas por la revisión independiente del 2026-11-26 ──────────────────────────────────
// La revisión mutó y encontró que la prueba de arriba sólo exigía el prefijo «Todavía no hay
// programa: »: cinco códigos podían devolver la causa de OTRO (p. ej. la del pin) y seguía verde.
// Tampoco se probaban los «sin nombre no se inventa» (con el catálogo real toda placa tiene
// nombre, así que hace falta un conocimiento al que le falte), ni los textos que le dicen al
// asistente qué hacer con la explicación.

test("cada causa tiene SU texto: lectura, número de la regla, escritura y pin no se confunden", async () => {
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const contexto = { proyecto: snapshotDe(dir).proyecto, conocimiento: K }
  const pulsador = K.nombre("componente", "pulsador")
  const led = K.nombre("componente", "led")
  const de = (codigo, componente) => porQueNoHayPrograma({ codigo, datos: { componente } }, contexto)
  const LEER = `Todavía no hay programa: esta versión de Tecnia Bot todavía no sabe leer «${pulsador}» para la regla que la usa. El montaje y las reglas siguen valiendo.`
  const NUMERO = `Todavía no hay programa: esta versión de Tecnia Bot no sabe comparar el número de la regla con lo que mide «${pulsador}». Probá escribir la regla con otra unidad. El montaje y las reglas siguen valiendo.`
  const MANEJAR = `Todavía no hay programa: esta versión de Tecnia Bot todavía no sabe manejar «${led}» como lo pide la regla. El montaje y las reglas siguen valiendo.`
  for (const codigo of ["CODEGEN_SIN_LECTURA", "CODEGEN_PROTOCOLO_SIN_BACKEND", "CODEGEN_LECTURA_INCOHERENTE"]) assert.equal(de(codigo, "cmp-0"), LEER, codigo)
  for (const codigo of ["CODEGEN_UMBRAL_NO_CONVERTIBLE", "CODEGEN_CONVERSION_NO_MONOTONA"]) assert.equal(de(codigo, "cmp-0"), NUMERO, codigo)
  for (const codigo of ["CODEGEN_SIN_ESCRITURA", "CODEGEN_REPOSO_NO_DECLARADO"]) assert.equal(de(codigo, "cmp-1"), MANEJAR, codigo)
  assert.equal(de("CODEGEN_PIN_NO_DERIVABLE", "cmp-1"), PIN_QUE_NO_SE_PUEDE_USAR)
  // El generador da este error con el pin sin elegir Y con uno que no sirve: el texto no afirma cuál.
  assert.match(PIN_QUE_NO_SE_PUEDE_USAR, /falta elegir o que no se puede usar/)
  assert.equal(new Set([LEER, NUMERO, MANEJAR, PIN_QUE_NO_SE_PUEDE_USAR, TODAVIA_NO_SE_SABE_PROGRAMAR]).size, 5)
})

test("sin nombre no se inventa: una placa sin nombre nunca sale como «undefined» ni por su id", async () => {
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const proyecto = snapshotDe(dir).proyecto
  const sinNombreDePlaca = { ...K, nombre: (kind, id) => (kind === "placa" ? undefined : K.nombre(kind, id)) }
  const contexto = { proyecto, conocimiento: sinNombreDePlaca }
  const con = (noAdmitidos) => porQueNoHayPrograma({ codigo: "CODEGEN_NO_ADMITIDO", datos: { noAdmitidos } }, contexto)
  assert.equal(con([{ kind: "placa", id: proyecto.placa, problemas: [] }]), TODAVIA_NO_SE_SABE_PROGRAMAR)
  assert.equal(con([{ kind: "componente", id: "led", problemas: [] }]), TODAVIA_NO_SE_SABE_PROGRAMAR)
  // El control: con el conocimiento entero esos mismos datos SÍ dan una causa con nombre.
  const entero = { proyecto, conocimiento: K }
  assert.match(porQueNoHayPrograma({ codigo: "CODEGEN_NO_ADMITIDO", datos: { noAdmitidos: [{ kind: "placa", id: proyecto.placa, problemas: [] }] } }, entero), /la placa «ESP32 DevKit»/)
})

test("una pieza que no se programa con NINGUNA placa: no se nombra la placa (sugeriría que con otra anda)", async () => {
  const { generabilidad } = await import(join(REPO, "opencode/codegen/generabilidad.ts"))
  const enNinguna = generabilidad(K).componentes.find((c) => c.generableEn.length === 0 && K.nombre("componente", c.tipo) !== undefined)
  assert.ok(enNinguna, "la precondición: el catálogo tiene una pieza que hoy no llega a programa en ninguna placa")
  const dir = await armar("esp32-devkit-v1", ["GPIO4", "GPIO18"])
  const contexto = { proyecto: snapshotDe(dir).proyecto, conocimiento: K }
  const texto = porQueNoHayPrograma({ codigo: "CODEGEN_NO_ADMITIDO", datos: { noAdmitidos: [{ kind: "componente", id: enNinguna.tipo, problemas: [] }] } }, contexto)
  assert.equal(texto, `Todavía no hay programa: esta versión de Tecnia Bot todavía no programa «${K.nombre("componente", enNinguna.tipo)}». El montaje y las reglas siguen valiendo.`)
  // El control: una pieza que con esta placa sí se programa conserva «con la placa».
  assert.match(porQueNoHayPrograma({ codigo: "CODEGEN_NO_ADMITIDO", datos: { noAdmitidos: [{ kind: "componente", id: "led", problemas: [] }] } }, contexto), /» con la placa «ESP32 DevKit»\./)
})

test("los textos valen también dichos en el chat: nombran la ventana y ninguno dice «acá»", async () => {
  // El caso que encontró la revisión, por la tool real: proyecto vacío → `generar`.
  const dir = nuevoDir("por-que-no-vacio")
  const r = JSON.parse(await programaTool.execute({ accion: "generar" }, { directory: dir }))
  assert.equal(r.explicacion, TODAVIA_FALTA_ARMAR)
  assert.equal(r.resultado, `NO SE GENERÓ EL PROGRAMA — ${TODAVIA_FALTA_ARMAR}`)
  assert.match(TODAVIA_FALTA_ARMAR, /se ve en la ventana del proyecto\.$/)
  assert.match(TODAVIA_NO_ESTA_LISTO, /en la sección «Avisos» de la ventana del proyecto\.$/)
  for (const texto of [TODAVIA_FALTA_ARMAR, TODAVIA_NO_ESTA_LISTO, TODAVIA_NO_SE_SABE_PROGRAMAR, PIN_QUE_NO_SE_PUEDE_USAR]) assert.doesNotMatch(texto, /\bacá\b|\baquí\b/i)
})

test("lo que se le dice al asistente: la explicación va tal cual, sin códigos, y los motivos se cuentan", async () => {
  const { readFileSync } = await import("node:fs")
  const plano = (t) => t.replace(/\s+/g, " ")
  const descripcion = plano(programaTool.description)
  assert.match(descripcion, /`explicacion` trae la causa en palabras, la misma que muestra la ventana: decísela al docente TAL CUAL \(no la cambies ni le agregues causas\)/)
  assert.match(descripcion, /NUNCA le nombres al docente un código interno ni un identificador/)
  const agente = plano(readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8"))
  assert.match(agente, /\*\*Decísela al docente tal cual\*\*, sin cambiarla ni agregarle causas tuyas/)
  assert.match(agente, /contá además QUÉ le falta: son los motivos que da `proyecto-fisico`/)
  // La regla de generabilidad mandaba a decir «el `codigo` o los `problemas`»: justo lo que la otra prohíbe.
  assert.match(agente, /el `codigo` y los `problemas` que trae son para vos, no se los leas/)
  assert.doesNotMatch(agente, /por qué \(el `codigo` o los `problemas` que trae\)/)
})
