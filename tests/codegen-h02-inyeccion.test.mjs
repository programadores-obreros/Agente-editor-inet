// H-02 — inyección de C++ por datos de la IR (SEC-04 / BUG-04).
//
// El incidente: un `activo.json` editado a mano con un `id` que trae un salto de línea hacía que
// `programa generar` devolviera `PROGRAMA GENERADO` con C++ arbitrario FUERA de comentario en
// `src/main.cpp` (evidencia: `inyeccion-ids.out` y `persistencia.out` caso P11, sobre b61d1eb).
// Causa raíz: el render armaba el programa concatenando strings crudos de la IR, y la frontera
// (`cargador.ts`) sólo pedía «string no vacío» para los ids.
//
// La corrección tiene DOS capas que no dependen una de la otra, y este archivo prueba cada una
// SIN la otra:
//   - frontera: `cargarProyecto` rechaza el documento (sección F). Los tests de codegen de acá
//     NO pasan por el cargador: le dan a `generarPrograma` un objeto armado a mano.
//   - codegen: `generarPrograma` no emite nada que no haya pasado por la codificación de su clase
//     léxica (sección G), aunque el proyecto no haya entrado por el cargador.
//
// Cómo falló la primera vez (corrida roja guardada en evidencia/H02/rojo/, sobre 48ae491): los
// cuatro casos de R1 cargaban y generaban, y `lineasFueraDeComentario` encontraba la función
// inyectada como línea de código. Por eso R1 afirma sobre el MUNDO (qué líneas de código hay en
// el archivo), no sólo sobre el código de error: un test que mirara sólo `ok === false` seguiría
// verde si alguien cambiara el rechazo por un «saneo» que deja pasar otra cosa.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearProyecto, cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures: proyectos VÁLIDOS armados con las operaciones reales del Engine
// ════════════════════════════════════════════════════════════════════════════════════

function construir(ops, id = "activo") {
  let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z" })
  ops.forEach(([tipo, payload], i) => {
    const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  })
  return p
}

/** ESP32 + sensor (cmp-0, GPIO4) + LED (cmp-1, GPIO18) + resistencia (cmp-2) + conexión (conn-3) + regla (beh-4). */
const ops = (sensor, cuando, accion = "encender") => [
  ["SetPlaca", { placa: "esp32-devkit-v1" }],
  ["AgregarComponente", { tipo: sensor }],
  ["AgregarComponente", { tipo: "led" }],
  ["AgregarComponente", { tipo: "resistencia" }],
  ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
  ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
  ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", ...cuando }, entonces: { actuador: "cmp-1", accion } } }],
]
const TEMPERATURA = (valor, comparador = ">") => ({ capacidad: "temperatura", comparador, umbral: { valor, unidad: "celsius", magnitud: "temperatura" } })
const PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

const DHT22 = construir(ops("dht22", TEMPERATURA(30)))
const PULSADOR = construir(ops("pulsador", PRESIONADO))

/** El documento del proyecto como lo guarda el almacén, ya parseado y editable. */
const documento = (proyecto) => JSON.parse(canonicalizar(proyecto))
/** Reemplaza un id de componente en TODO el documento (el componente y quien lo referencia). */
function renombrar(doc, viejo, nuevo) {
  Object.assign(doc, JSON.parse(JSON.stringify(doc).split(JSON.stringify(viejo)).join(JSON.stringify(nuevo))))
}

// Los separadores de línea se arman por código de carácter: escritos como escape en este archivo,
// un editor los puede convertir en el carácter real y romper la expresión regular.
const SEPARADORES_UNICODE = String.fromCharCode(0x2028, 0x2029, 0x0b, 0x0c, 0x85)
const FIN_DE_LINEA = new RegExp(`\\r\\n|[\\n\\r${SEPARADORES_UNICODE}]`)

/**
 * Las líneas del programa que el compilador ve como CÓDIGO y que contienen `marca`. Mide el
 * archivo, no lo que el generador dice de él. Un `\r` suelto también corta la línea para un
 * compilador, así que se parte por cualquier fin de línea.
 */
function lineasDeCodigoCon(cpp, marca) {
  return cpp.split(FIN_DE_LINEA).filter((l) => l.includes(marca) && !l.trimStart().startsWith("//"))
}

const HOSTIL = 'x\nvoid INYECTADO(){ system("x"); } //'

/** Los cuatro casos de la reproducción original (`scripts/inyeccion-ids.mjs`). */
const CASOS_DE_LA_REPRODUCCION = [
  ["id de regla con salto de línea", "comportamiento", (d) => { d.comportamientos[0].id = `beh-7${HOSTIL}` }],
  ["id de componente (actuador) con salto de línea", "componente", (d) => renombrar(d, "cmp-1", `cmp-1${HOSTIL}`)],
  ["id de componente (sensor) con salto de línea", "componente", (d) => renombrar(d, "cmp-0", `cmp-0${HOSTIL}`)],
  ["id de proyecto con salto de línea", "proyecto", (d) => { d.id = `activo${HOSTIL}` }],
]

// ════════════════════════════════════════════════════════════════════════════════════
// R — la reproducción del incidente
// ════════════════════════════════════════════════════════════════════════════════════

for (const [nombre, entidad, mutar] of CASOS_DE_LA_REPRODUCCION) {
  test(`R1 reproducción H-02 — ${nombre}: no queda C++ inyectado, ni entrando por el cargador ni salteándolo`, () => {
    for (const base of [DHT22, PULSADOR]) {
      const doc = documento(base)
      mutar(doc)

      // El mundo, primero: por NINGUNA de las dos puertas existe un `main.cpp` con la función inyectada.
      const carga = cargarProyecto(JSON.stringify(doc))
      const porElCargador = carga.ok ? generarPrograma(carga.proyecto, K) : undefined
      const salteandolo = generarPrograma(doc, K)
      for (const [puerta, g] of [["por el cargador", porElCargador], ["salteando el cargador", salteandolo]]) {
        if (!g?.ok) continue
        assert.deepEqual(lineasDeCodigoCon(g.archivos["src/main.cpp"], "INYECTADO"), [], `${puerta}: hay C++ inyectado fuera de comentario`)
      }

      // Capa 1 (frontera): el documento no carga.
      assert.equal(carga.ok, false, "el cargador aceptó un id hostil")
      assert.deepEqual(carga.motivos.map((m) => m.codigo), ["ID_MALFORMADO_AL_CARGAR"])
      assert.equal(carga.motivos[0].datos.entidad, entidad)

      // Capa 2 (codegen), sin la 1: falla cerrado y no devuelve archivos.
      assert.equal(salteandolo.ok, false, "el codegen generó un programa con un id hostil")
      assert.ok(!("archivos" in salteandolo), "un rechazo nunca devuelve archivos")
      assert.equal(salteandolo.error.codigo, entidad === "proyecto" ? "CODEGEN_DATO_NO_EMITIBLE" : "CODEGEN_IDENTIFICADOR_INVALIDO", JSON.stringify(salteandolo.error))
    }
  })
}

test("R2 el caso P11 (extremo a extremo): el id de regla de la evidencia, tal cual, ya no llega a main.cpp", () => {
  const doc = documento(PULSADOR)
  doc.comportamientos[0].id = "beh-7x\nvoid INYECTADO(){ }  //"
  const carga = cargarProyecto(JSON.stringify(doc))
  assert.equal(carga.ok, false)
  assert.equal(carga.motivos[0].codigo, "ID_MALFORMADO_AL_CARGAR")
  const g = generarPrograma(doc, K)
  assert.equal(g.ok, false)
  assert.equal(g.error.codigo, "CODEGEN_IDENTIFICADOR_INVALIDO")
})

test("R3 los proyectos válidos de los que salen los casos siguen generando (el test no prueba un generador muerto)", () => {
  for (const base of [DHT22, PULSADOR]) {
    const carga = cargarProyecto(canonicalizar(base))
    assert.equal(carga.ok, true, JSON.stringify(carga.motivos ?? null))
    const g = generarPrograma(carga.proyecto, K)
    assert.equal(g.ok, true, JSON.stringify(g.error ?? null))
    assert.match(g.archivos["src/main.cpp"], /^ {2}const bool beh_4 = /m)
    // Y el detector de inyección detecta: una línea de código con la marca se ve.
    assert.deepEqual(lineasDeCodigoCon(`// INYECTADO\nvoid INYECTADO(){}\r  x INYECTADO;\n`, "INYECTADO"), ["void INYECTADO(){}", "  x INYECTADO;"])
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// G — la capa del codegen, SIN el cargador: el proyecto es un objeto armado a mano
// ════════════════════════════════════════════════════════════════════════════════════

const { createHash } = await import("node:crypto")
const { spawnSync } = await import("node:child_process")
const { BACKENDS_DE_PROTOCOLO } = await import(join(REPO, "opencode/codegen/protocolos.ts"))
const { corpusValido } = await import("./codegen-h02-corpus.mjs")

/** `generarPrograma` rechaza, con ese código y esos datos, y NO devuelve archivos. */
function rechazaGeneracion(proyecto, codigo, esperado = {}, conocimiento = K, opciones = undefined, mensaje = "") {
  const g = generarPrograma(proyecto, conocimiento, opciones)
  assert.equal(g.ok, false, `generó un programa: ${mensaje}`)
  assert.ok(!("archivos" in g), "un rechazo nunca devuelve archivos")
  assert.equal(g.error.codigo, codigo, `${mensaje} ${JSON.stringify(g.error)}`)
  for (const [clave, valor] of Object.entries(esperado)) assert.equal(g.error.datos[clave], valor, `${mensaje} datos.${clave}: ${JSON.stringify(g.error.datos)}`)
  return g.error
}
function genera(proyecto, conocimiento = K, opciones = undefined) {
  const g = generarPrograma(proyecto, conocimiento, opciones)
  assert.equal(g.ok, true, JSON.stringify(g.error ?? null))
  return g
}

const c = (...codigos) => String.fromCharCode(...codigos)
const LS = c(0x2028)
const PS = c(0x2029)
const NEL = c(0x85)

/** Ids que nunca pueden llegar al programa, se los ponga quien se los ponga (p = prefijo de la entidad). */
const idsHostiles = (p) => [
  `${p}-7x\nvoid INYECTADO(){ system("x"); } //`, `${p}-7\n`, `${p}-7\r`, `${p}-7\r\nINYECTADO();`, `${p}-7${LS}INYECTADO();`, `${p}-7${PS}INYECTADO();`, `${p}-7${NEL}INYECTADO();`, `${p}-7\vINYECTADO();`, `${p}-7\fINYECTADO();`,
  `${p}-7\\`, `${p}-7 */ INYECTADO(); /*`, `${p}-7"`, `${p}-7??/`, `#include "/etc/passwd"`, `${p}-7; INYECTADO();`,
  `${p}_7`, `${p.toUpperCase()}-7`, `${p}-07`, ` ${p}-7`, `${p}-7 `, `${p}-`, `${p}`,
  "if", "7", "ahora", "PI", "setup", "loop", "HIGH", "digitalWrite", "__proto__", "constructor",
  `${p}-${"7".repeat(500)}`, `${p}-7${"x".repeat(100000)}`,
]

test("G1 ids de regla, de sensor y de actuador hostiles: CODEGEN_IDENTIFICADOR_INVALIDO, sin archivos y sin pasar por el cargador", () => {
  for (const base of [DHT22, PULSADOR]) {
    for (const id of idsHostiles("beh")) {
      const doc = documento(base)
      doc.comportamientos[0].id = id
      rechazaGeneracion(doc, "CODEGEN_IDENTIFICADOR_INVALIDO", { clase: "identificador", causa: "formato-de-id", campo: "comportamiento.id" }, K, undefined, JSON.stringify(id).slice(0, 50))
    }
    for (const viejo of ["cmp-0", "cmp-1"]) {
      for (const id of idsHostiles("cmp")) {
        const doc = documento(base)
        renombrar(doc, viejo, id)
        rechazaGeneracion(doc, "CODEGEN_IDENTIFICADOR_INVALIDO", { clase: "identificador", causa: "formato-de-id", campo: "componente.id" }, K, undefined, `${viejo} → ${JSON.stringify(id).slice(0, 50)}`)
      }
    }
  }
})

test("G2 un id hostil en algo que el programa NO nombra (una resistencia, una conexión) también corta la generación", () => {
  // El programa sólo nombra al sensor, al actuador y a la regla. Sin el chequeo de TODOS los ids al
  // principio de `generarPrograma`, estos proyectos generaban (el id hostil no se escribía en ningún
  // lado): no había inyección, pero el codegen estaba generando desde un proyecto que no es un proyecto.
  for (const id of ["cmp-2\nvoid INYECTADO(){} //", "cmp_2", "resistencia", "cmp-02"]) {
    const doc = documento(DHT22)
    renombrar(doc, "cmp-2", id)
    rechazaGeneracion(doc, "CODEGEN_IDENTIFICADOR_INVALIDO", { causa: "formato-de-id", campo: "componente.id" }, K, undefined, JSON.stringify(id))
  }
  for (const id of ["conn-3\nvoid INYECTADO(){} //", "conn_3", "cable", "cmp-3", "conn-03"]) {
    const doc = documento(DHT22)
    doc.conexiones[0].id = id
    rechazaGeneracion(doc, "CODEGEN_IDENTIFICADOR_INVALIDO", { causa: "formato-de-id", campo: "conexion.id" }, K, undefined, JSON.stringify(id))
  }
  // Control: los mismos documentos, sin tocar, generan.
  genera(documento(DHT22))
})

test("G3 id de proyecto y revisión hostiles: no entran al comentario de cabecera (CODEGEN_DATO_NO_EMITIBLE)", () => {
  const hostiles = [
    ['activox\nvoid INYECTADO(){ system("x"); } //', "no-ascii-visible"], ["activo\r", "no-ascii-visible"], [`activo${LS}INYECTADO();`, "no-ascii-visible"], [`activo${PS}`, "no-ascii-visible"], [`activo${NEL}`, "no-ascii-visible"], ["activo\v", "no-ascii-visible"], ["activo\f", "no-ascii-visible"],
    ["activo\\", "barra-invertida"], ["activo??/", "trigrafo"], ["activo */ x", "delimitador-de-comentario"], ["", "vacio"], ["a".repeat(121), "largo"],
  ]
  for (const [id, causa] of hostiles) {
    const doc = documento(DHT22)
    doc.id = id
    rechazaGeneracion(doc, "CODEGEN_DATO_NO_EMITIBLE", { clase: "comentario", causa, campo: "proyecto.id" }, K, undefined, JSON.stringify(id).slice(0, 50))
  }
  for (const id of [7, null, { toString: () => "activo" }, ["activo"]]) {
    const doc = documento(DHT22)
    doc.id = id
    rechazaGeneracion(doc, "CODEGEN_DATO_NO_EMITIBLE", { clase: "comentario", causa: "no-es-texto", campo: "proyecto.id" })
  }
  for (const revision of ["0\nvoid INYECTADO(){} //", "0", NaN, Infinity, null, [0]]) {
    const doc = documento(DHT22)
    doc.revision = revision
    rechazaGeneracion(doc, "CODEGEN_DATO_NO_EMITIBLE", { clase: "comentario", causa: "no-es-numero-finito", campo: "proyecto.revision" }, K, undefined, JSON.stringify(revision))
  }
})

test("G4 comparador que no es uno de los cuatro: no se interpola como código (antes daba `> 0; INYECTADO(); // 30.0f;`)", () => {
  // El cargador ya rechaza un comparador inventado; `validarProyecto` no lo mira. Sin el cargador,
  // el comparador llegaba crudo a una línea de CÓDIGO: era la inyección más directa de todas.
  for (const comparador of ["> 0; INYECTADO(); //", "==", "!=", ">\n", "constructor", "__proto__", "toString"]) {
    for (const base of [DHT22, PULSADOR]) {
      const doc = documento(base)
      doc.comportamientos[0].cuando.comparador = comparador
      const g = generarPrograma(doc, K)
      assert.equal(g.ok, false, `generó con comparador ${JSON.stringify(comparador)}`)
      assert.ok(!("archivos" in g))
      // Con `validarProyecto` más estricto el día de mañana podría frenar antes (NO_LISTO): también es un rechazo.
      assert.ok(["CODEGEN_DATO_NO_EMITIBLE", "CODEGEN_PROYECTO_NO_LISTO"].includes(g.error.codigo), JSON.stringify(g.error))
    }
  }
  // Hoy, exactamente: es la tabla cerrada de `palabra` la que lo frena.
  const doc = documento(DHT22)
  doc.comportamientos[0].cuando.comparador = "> 0; INYECTADO(); //"
  rechazaGeneracion(doc, "CODEGEN_DATO_NO_EMITIBLE", { clase: "palabra", causa: "fuera-de-la-tabla", campo: "cuando.comparador" })
  // Y los cuatro de verdad siguen saliendo tal cual.
  for (const comparador of [">", "<", ">=", "<="]) {
    const d = documento(DHT22)
    d.comportamientos[0].cuando.comparador = comparador
    assert.match(genera(d).archivos["src/main.cpp"], new RegExp(`^  const bool beh_4 = valida_cmp_0_temperatura && cmp_0_temperatura ${comparador} 30\\.0f;$`, "m"))
  }
})

test("G5 umbral que no sobrevive en un `float`: se rechaza en vez de comparar contra otro número (entrando por el cargador)", () => {
  // Esto NO lo frena la frontera (es un número finito y la IR lo admite): es del backend, que es
  // quien elige `float`. Antes generaba `> 3.5e+38f` (infinito para el compilador: la condición no
  // se cumple nunca) y `> 1e-50f` (cero).
  for (const [valor, causa] of [[3.5e38, "fuera-de-rango-de-float"], [-3.5e38, "fuera-de-rango-de-float"], [3.4e39, "fuera-de-rango-de-float"], [1e-50, "se-vuelve-cero-en-float"], [-1e-50, "se-vuelve-cero-en-float"]]) {
    const doc = documento(DHT22)
    doc.comportamientos[0].cuando.umbral.valor = valor
    const carga = cargarProyecto(JSON.stringify(doc))
    assert.equal(carga.ok, true, "la frontera no decide sobre el float del backend")
    rechazaGeneracion(carga.proyecto, "CODEGEN_DATO_NO_EMITIBLE", { clase: "flotante", causa, campo: "umbral" }, K, undefined, String(valor))
  }
  // Los que sí sobreviven se escriben como siempre.
  for (const [valor, literal] of [[-5, "-5.0f"], [-40, "-40.0f"], [30.5, "30.5f"], [0, "0.0f"], [-0, "0.0f"], [1e21, "1e+21f"], [1e-7, "1e-7f"], [3.4e38, "3.4e+38f"]]) {
    const doc = documento(DHT22)
    doc.comportamientos[0].cuando.umbral.valor = valor
    const cpp = genera(doc).archivos["src/main.cpp"]
    assert.ok(cpp.includes(`  const bool beh_4 = valida_cmp_0_temperatura && cmp_0_temperatura > ${literal};\n`), `${valor} → ${literal}`)
  }
})

// Un Component Knowledge de PRUEBA: el real, con un método cambiado (no son datos del producto).
// Sirve para lo que el catálogo real no tiene y un catálogo editado sí podría traer.
const conocimientoCon = (cambios) => Object.create(K, Object.fromEntries(Object.entries(cambios).map(([clave, value]) => [clave, { value, enumerable: true }])))
const placaCon = (cambiar) => conocimientoCon({ placa: (id) => { const p = K.placa(id); return p ? cambiar(p) : p } })
const conPlatformio = (campo, valor) => placaCon((p) => ({ ...p, backends: { ...p.backends, platformio: { ...p.backends.platformio, [campo]: valor } } }))
const conPin = (idPin, cambio) => placaCon((p) => ({ ...p, pines: p.pines.map((pin) => (pin.id === idPin ? { ...pin, ...cambio } : pin)) }))

test("G6 el control de G7–G9: el conocimiento de prueba sin cambios genera lo mismo que el real", () => {
  const real = genera(DHT22)
  assert.deepEqual(genera(DHT22, conocimientoCon({})).archivos, real.archivos)
  assert.deepEqual(genera(DHT22, placaCon((p) => ({ ...p }))).archivos, real.archivos)
})

test("G7 platformio.ini: un valor del registro de placas no puede abrir otra opción, otra sección ni interpolar", () => {
  const hostiles = [
    "uno\nextra_scripts = pre:malo.py", "esp32dev\n[env:otro]\nboard = uno", "esp32dev\r\nupload_port = /dev/ttyUSB9", `esp32dev${LS}x`, "esp32dev ; x", "esp32dev # x", "${sysenv.HOME}", "$PROJECT_DIR/x",
    "https://github.com/x/platform.git", "file:///tmp/x", "-esp32dev", "", "esp32 dev", "a=b", 7, null, undefined, ["esp32dev"],
  ]
  for (const campo of ["board", "platform", "framework"]) {
    for (const valor of hostiles) {
      const e = rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "ini", campo: `placa.backends.platformio.${campo}` }, conPlatformio(campo, valor), undefined, `${campo}=${JSON.stringify(valor)}`)
      assert.equal(e.datos.causa, typeof valor === "string" ? "forma" : "no-es-texto")
    }
  }
  // Y el .ini real tiene exactamente las líneas de siempre: una sección y tres opciones.
  assert.equal(genera(DHT22).archivos["platformio.ini"], "; Generado por Tecnia Bot (codegen) desde el registro de placas. No editar: se regenera desde el proyecto.\n\n[env:esp32-devkit-v1]\nplatform = espressif32@6.12.0\nboard = esp32dev\nframework = arduino\n")
})

test("G8 número de pin del registro: entra como literal `uint8_t` o no entra (antes: `= 1e+21;`)", () => {
  for (const [numero, causa] of [[256, "fuera-de-rango"], [300, "fuera-de-rango"], [1e21, "no-es-entero"], [2 ** 53, "no-es-entero"]]) {
    rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "entero", causa, campo: "pin.numero" }, conPin("GPIO18", { numero }), undefined, String(numero))
  }
  // Los que `derivaciones.ts` ya no nombraba siguen siendo «pin no derivable», como siempre.
  for (const numero of [-1, 1.5, NaN, "18; INYECTADO()"]) rechazaGeneracion(DHT22, "CODEGEN_PIN_NO_DERIVABLE", {}, conPin("GPIO18", { numero }), undefined, String(numero))
  // El banco analógico (`A<n>`) NO se prueba extremo a extremo: en el catálogo real esos pines sólo
  // son ADC, y con una placa de prueba la admisión corta antes (`CODEGEN_NO_ADMITIDO`: el pin no
  // mapea a la pieza de Wokwi). `pinAnalogico` queda probado sólo por unidad (E13).
  rechazaGeneracion(DHT22, "CODEGEN_NO_ADMITIDO", {}, conPin("GPIO18", { banco: "A", numero: 3 }))
  assert.match(genera(DHT22, conPin("GPIO18", { numero: 255 })).archivos["src/main.cpp"], /^static const uint8_t PIN_CMP_1_ANODO = 255;/m)
})

test("G9 tiempos de Component Knowledge: los milisegundos entran en un `uint32_t` o no se genera", () => {
  const conTiempos = (cambio) => conocimientoCon({ lecturaDeCapacidad: (tipo, capacidad) => { const l = K.lecturaDeCapacidad(tipo, capacidad); return l ? { ...l, ...cambio(l) } : l } })
  const segundos = (valor) => ({ valor, unidad: "segundo", magnitud: "tiempo" })
  // 4294968 s son 4294968000 ms: no entra en uint32_t (máximo 4294967295).
  rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "entero", causa: "fuera-de-rango", campo: "periodoMinimo (ms)" }, conTiempos(() => ({ periodoMinimo: segundos(4294968) })))
  rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "entero", causa: "fuera-de-rango", campo: "esperaTrasEncendido (ms)" }, conTiempos(() => ({ esperaTrasEncendido: segundos(1e10) })))
  rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "entero", causa: "no-es-entero" }, conTiempos(() => ({ periodoMinimo: segundos(1e30) })))
  // Control: un tiempo grande pero que entra, genera y se escribe exacto.
  const cpp = genera(DHT22, conTiempos(() => ({ periodoMinimo: segundos(4294967) }))).archivos["src/main.cpp"]
  assert.match(cpp, /^static const uint32_t PERIODO_MS_CMP_0_SENAL = 4294967000;$/m)
  assert.match(cpp, /periodo minimo 4294967 s\.$/m)
})

test("G10 backend de protocolo: su nombre de función, sus bytes, sus líneas y sus expresiones entran por su clase", () => {
  const AM2302 = BACKENDS_DE_PROTOCOLO["bus-unico-am2302"]
  const con = (cambio) => ({ protocolos: { ...BACKENDS_DE_PROTOCOLO, "bus-unico-am2302": { ...AM2302, ...cambio } } })
  assert.deepEqual(genera(DHT22, K, con({})).archivos, genera(DHT22).archivos, "control: el mismo backend, copiado, genera lo mismo")

  for (const funcion of ["am2302_leer(p, d); INYECTADO(); //", "am2302 leer", "leer\n", "", "1leer"]) rechazaGeneracion(DHT22, "CODEGEN_IDENTIFICADOR_INVALIDO", { causa: "forma-de-nombre-de-backend", campo: "backend.funcion" }, K, con({ funcion }), JSON.stringify(funcion))
  // La función del driver se llama como una variable que el programa ya declaró: colisión, no un programa que no compila.
  rechazaGeneracion(DHT22, "CODEGEN_IDENTIFICADOR_INVALIDO", { causa: "colision" }, K, con({ funcion: "valida_cmp_0_senal" }))
  rechazaGeneracion(DHT22, "CODEGEN_IDENTIFICADOR_INVALIDO", { causa: "colision" }, K, con({ funcion: "datos_cmp_0_senal" }))

  for (const [bytes, causa] of [[0, "fuera-de-rango"], [256, "fuera-de-rango"], [1e21, "no-es-entero"], [2.5, "no-es-entero"], ["5]; int INYECTADO[9", "no-es-entero"]]) rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "entero", causa, campo: "backend.bytes" }, K, con({ bytes }), String(bytes))

  for (const [linea, causa] of [["int x;\nvoid INYECTADO(){}", "no-ascii-visible"], ["// fin \\", "barra-invertida-final"], ["// ??/", "trigrafo"], [7, "no-es-texto"]]) {
    rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "codigo-backend", causa }, K, con({ driver: [...AM2302.driver, linea] }), JSON.stringify(linea))
  }
  for (const [expresion, causa] of [[() => "0.0f; // el resto se comenta", "comentario"], [() => "0.0f;\nINYECTADO()", "no-ascii-visible"], [() => "", "vacio"], [() => 7, "no-es-texto"]]) {
    const campos = AM2302.campos.map((campo) => ({ ...campo, expresion }))
    rechazaGeneracion(DHT22, "CODEGEN_DATO_NO_EMITIBLE", { clase: "codigo-backend", causa, campo: "backend.campo.expresion" }, K, con({ campos }), String(expresion()))
  }
})

test("G11 el orden del gate no cambió: un proyecto que no está listo sigue diciendo que no está listo, aunque traiga un id hostil", () => {
  const doc = documento(DHT22)
  doc.comportamientos[0].id = "beh-7\nvoid INYECTADO(){} //"
  delete doc.comportamientos[0].entonces
  const g = generarPrograma(doc, K)
  assert.equal(g.ok, false)
  assert.ok(!("archivos" in g))
  assert.equal(g.error.codigo, "CODEGEN_PROYECTO_NO_LISTO")
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — determinismo y bytes: para un proyecto válido la corrección no cambió NADA
// ════════════════════════════════════════════════════════════════════════════════════

const sha256 = (t) => createHash("sha256").update(t).digest("hex")
const CORPUS = await corpusValido(REPO)

/**
 * sha256 de `src/main.cpp` y `platformio.ini` de cada caso del corpus, tomados con el generador de
 * 48ae491 (ANTES de H-02) por `evidencia/H02/scripts/corpus-sha.mjs` sobre una copia de ese commit.
 * No salieron del código corregido: si este test está verde, lo corregido emite los mismos bytes.
 */
const INI_ESP32 = "b4ea2df4fc2401ec488b0254ff714176119e561447817a99631de64da7321fde"
const INI_UNO = "12a5e95e8526339e76320fabd999ec857f58202d9de48ae47e696a172c9d3c03"
const BYTES_EN_48AE491 = {
  "pulsador-encender": ["4545c112454ae6a419f905eb26dc78af7e00bafb279ad721d984eec146c6c723", INI_ESP32],
  "pulsador-suelto-apagar": ["446c786414fdfad3d7c8b25f64038957dca9733c6d0799d1a2311bee425c5b35", INI_ESP32],
  "interruptor-encender": ["9d4a7ada1222ad6b36dbc23b33f2f0f930a64893c74495f778bdebee375a67cf", INI_ESP32],
  "dht22-temperatura-mayor-30": ["723cd3daa82a9523637f89acc4991af474b95a2527c4246b90b670d16b9bb01e", INI_ESP32],
  "dht22-temperatura-menor-negativo-decimal": ["c0ae85381574069710fde09e5f30b459771378bf98ff7fcbb5382a93d92bf83d", INI_ESP32],
  "dht22-temperatura-mayor-igual-fahrenheit": ["0d84c84d03c242a1b4b626ee758c888729f2badb8e9f2ae365cc13c9058dfeed", INI_ESP32],
  "dht22-humedad-menor-igual-apagar": ["ff83ac142d4aff3f43572afe7f75bff3bb201baa9bdae31b7070843d05e2a9ab", INI_ESP32],
  "dht22-umbral-cero": ["e022574cfb41fe1c2b19d982296db8cfa55e439858ad628e9e2cdb2580f0c1ff", INI_ESP32],
  "dht22-umbral-cero-negativo": ["301c0cc8290bf60272511e8f41016d5c7b151d7685f170f5864d28b46e8183e5", INI_ESP32],
  "dht22-umbral-exponente-chico": ["8c24ada6fb1bf92d80d020c54655d7d15688662427ba5a59c13728e835e1c418", INI_ESP32],
  "dht22-umbral-exponente-grande": ["14a56e23ecf53015d7df409095d17d6a499387f17aca80e7f3b8f382b72625b4", INI_ESP32],
  "dht22-dos-leds-temperatura-y-humedad": ["da206dfde429104cdafe3b0dc44cfecf16c44eec75a7b0645550d8e8c6e62d8c", INI_ESP32],
  "dht11-temperatura-mayor-30": ["4883d70378caca2a7036552bc2d265dbda1ad7d9147e527761e2462d686cce1d", INI_ESP32],
  "dht22-y-dht11-dos-drivers": ["422f8a1850f89f370c4a91e41442f277b98ea00201856bd5a51b093d5ef1cb30", INI_ESP32],
  "ids-de-dos-digitos": ["f0f50cddb1f0cebb3e049c7488cbe8292c561405d51bd89e5d1d8b0d26c3d315", INI_ESP32],
  "uno-pulsador-led": ["26b8614577d23ae1e964da78b9d67836c5b82ecd1849cb1fe6451e8da53c40ed", INI_UNO],
}

test("D1 bytes: cada proyecto válido del corpus genera EXACTAMENTE lo que generaba antes de H-02 (sha256 tomados en 48ae491)", () => {
  assert.deepEqual(CORPUS.casos.map((x) => x.nombre).sort(), Object.keys(BYTES_EN_48AE491).sort(), "el corpus y la tabla de sha256 hablan de los mismos casos")
  assert.ok(CORPUS.casos.length >= 16)
  for (const { nombre, proyecto, opciones } of CORPUS.casos) {
    const g = genera(proyecto, CORPUS.K, opciones)
    assert.deepEqual([sha256(g.archivos["src/main.cpp"]), sha256(g.archivos["platformio.ini"])], BYTES_EN_48AE491[nombre], `${nombre}: la salida cambió`)
  }
})

test("D2 determinismo: misma IR → mismos bytes, generando dos veces, recargando el documento y barajando los arrays", () => {
  for (const { nombre, proyecto, opciones } of CORPUS.casos) {
    const a = genera(proyecto, CORPUS.K, opciones)
    const b = genera(proyecto, CORPUS.K, opciones)
    assert.deepEqual(a.archivos, b.archivos, `${nombre}: dos generaciones distintas`)
    // El registro de nombres es por programa: generar otra cosa en el medio no deja estado.
    genera(DHT22)
    assert.deepEqual(genera(proyecto, CORPUS.K, opciones).archivos, a.archivos, `${nombre}: quedó estado entre generaciones`)
    // Ida y vuelta por el cargador (la frontera nueva no cambia el proyecto).
    const carga = cargarProyecto(canonicalizar(proyecto))
    assert.equal(carga.ok, true, `${nombre}: ${JSON.stringify(carga.motivos ?? null)}`)
    assert.deepEqual(genera(carga.proyecto, CORPUS.K, opciones).archivos, a.archivos, `${nombre}: recargar cambió la salida`)
    // Arrays en otro orden, sin pasar por el cargador (que los reordenaría).
    const doc = documento(proyecto)
    doc.componentes.reverse()
    doc.conexiones.reverse()
    doc.comportamientos.reverse()
    assert.deepEqual(genera(doc, CORPUS.K, opciones).archivos, a.archivos, `${nombre}: el orden de los arrays cambió la salida`)
  }
})

test("D3 forma de lo generado: sólo ASCII visible y `\\n`, ninguna línea termina en barra invertida, y todo dato de la IR está en un comentario o es un identificador del generador", () => {
  for (const { nombre, proyecto, opciones } of CORPUS.casos) {
    const { archivos } = genera(proyecto, CORPUS.K, opciones)
    for (const [ruta, contenido] of Object.entries(archivos)) {
      assert.match(contenido, /^[\x20-\x7E\n]*$/, `${nombre} ${ruta}: hay algo que no es ASCII visible`)
      assert.ok(contenido.endsWith("\n"), `${nombre} ${ruta}: termina con salto de línea`)
      for (const linea of contenido.split("\n")) assert.ok(!linea.endsWith("\\"), `${nombre} ${ruta}: una línea termina en barra invertida`)
    }
    // El id de proyecto aparece UNA vez, y es en la segunda línea, que es un comentario.
    const lineas = archivos["src/main.cpp"].split("\n")
    assert.deepEqual(lineas.map((l, i) => (l.includes(proyecto.id) ? i : -1)).filter((i) => i >= 0), [1], nombre)
    assert.ok(lineas[1].startsWith("// proyecto: "))
    // Un id local con guion (`cmp-0`, `beh-4`) sólo aparece después de `//`: en código va con `_`.
    for (const linea of lineas) {
      const codigo = linea.includes("//") ? linea.slice(0, linea.indexOf("//")) : linea
      assert.doesNotMatch(codigo, /\b(?:cmp|beh|conn)-[0-9]/, `${nombre}: un id crudo en una línea de código: ${linea}`)
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — el programa generado sigue siendo C++ válido (compilador del host, sólo sintaxis y tipos)
// ════════════════════════════════════════════════════════════════════════════════════

const GXX = process.env.TECNIA_GXX ?? "g++"
const hayGxx = spawnSync(GXX, ["--version"], { encoding: "utf8" }).status === 0
const ARDUINO_MINIMO = join(REPO, "tests/fixtures/h02-arduino-minimo")
/** `g++ -fsyntax-only` sobre el texto dado (por stdin), contra el `Arduino.h` mínimo de los tests. */
function sintaxis(cpp, estandar) {
  return spawnSync(GXX, [`-std=${estandar}`, "-fsyntax-only", "-Wall", "-Wextra", "-Werror", "-pedantic", "-I", ARDUINO_MINIMO, "-x", "c++", "-"], { input: cpp, encoding: "utf8", timeout: 60_000 })
}

test(
  "C1 cada programa del corpus pasa `g++ -fsyntax-only -Wall -Wextra -Werror -pedantic` (gnu++11, gnu++17 y c++11 con trígrafos activos)",
  { skip: hayGxx ? false : `no hay ${GXX} en esta máquina: NO se probó que el programa generado compile (ver los tests opt-in TECNIA_CODEGEN_PIO=1)`, timeout: 5 * 60 * 1000 },
  () => {
    // El instrumento, antes de medir: el compilador RECHAZA un programa roto y uno con la inyección del incidente.
    assert.notEqual(sintaxis("#include <Arduino.h>\nvoid setup() { int x = ; }\nvoid loop() {}\n", "gnu++11").status, 0, "el compilador aceptó un programa roto: el instrumento no mide")
    assert.notEqual(sintaxis('#include <Arduino.h>\n// beh-7x\nvoid INYECTADO(){ system("x"); } //: cmp-0\nvoid setup() {}\nvoid loop() {}\n', "gnu++11").status, 0, "la inyección del incidente compila con este Arduino.h: el instrumento no la vería")
    assert.equal(sintaxis("#include <Arduino.h>\nvoid setup() { pinMode(4, INPUT_PULLUP); }\nvoid loop() { digitalWrite(4, digitalRead(4) == LOW ? HIGH : LOW); }\n", "gnu++11").status, 0, "el Arduino.h mínimo no alcanza ni para un programa trivial")
    for (const { nombre, proyecto, opciones } of CORPUS.casos) {
      const cpp = genera(proyecto, CORPUS.K, opciones).archivos["src/main.cpp"]
      for (const estandar of ["gnu++11", "gnu++17", "c++11"]) {
        const r = sintaxis(cpp, estandar)
        assert.equal(r.error, undefined, String(r.error))
        assert.equal(r.status, 0, `${nombre} (-std=${estandar}) no compila:\n${r.stderr}`)
      }
    }
  },
)
