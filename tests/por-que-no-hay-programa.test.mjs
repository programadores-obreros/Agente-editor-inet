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
