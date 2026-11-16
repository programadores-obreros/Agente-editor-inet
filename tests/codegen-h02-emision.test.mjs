// H-02 (SEC-04 / BUG-04), capa 2 — `opencode/codegen/emision.ts`: cada dato entra al texto
// generado por la codificación de SU clase léxica, o no entra.
//
// Estos tests llaman a los constructores directamente: no pasan por el cargador ni por
// `generarPrograma`. Así un constructor roto se ve acá aunque otra defensa (el formato de ids de
// la frontera, el chequeo de ids al principio de `generarPrograma`) lo esté tapando extremo a
// extremo. Los tests de extremo a extremo están en `codegen-h02-inyeccion.test.mjs`.
//
// Cada «rechaza» mira el código del error, la clase léxica y la causa. Un `assert.throws` a secas
// seguía verde con cualquier excepción (un `TypeError` de un test mal escrito, por ejemplo): por
// eso `rechaza` de abajo exige que sea un `RechazoDeEmision` y compara los tres datos.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const E = await import(join(REPO, "opencode/codegen/emision.ts"))
const { RechazoDeEmision, texto, numero, comentario, idLocal, atomo, crearNombres, entero, pinAnalogico, flotante, palabra, lineaDeBackend, expresionDeBackend, cpp, unirLineas, valorIni, entornoIni, ini, UINT8_MAX, UINT32_MAX } = E

function rechaza(fn, codigo, clase, causa, mensaje = "") {
  let error
  try {
    fn()
  } catch (e) {
    error = e
  }
  assert.ok(error !== undefined, `no rechazó ${mensaje}`)
  assert.ok(error instanceof RechazoDeEmision, `lanzó otra cosa (${error}) ${mensaje}`)
  assert.equal(error.codigo, codigo, mensaje)
  assert.equal(error.datos.clase, clase, mensaje)
  assert.equal(error.datos.causa, causa, `${mensaje} ${JSON.stringify(error.datos)}`)
  return error
}
const DATO = "CODEGEN_DATO_NO_EMITIBLE"
const IDENT = "CODEGEN_IDENTIFICADOR_INVALIDO"

// Por código de carácter: escritos como escape en el fuente, un editor los puede volver el carácter real.
const c = (...codigos) => String.fromCharCode(...codigos)
const LS = c(0x2028)
const PS = c(0x2029)
const NEL = c(0x85)
const NUL = c(0)
const DEL = c(0x7f)
const ENIE = c(0xf1)

// ════════════════════════════════════════════════════════════════════════════════════
// E1 — texto en un comentario de línea
// ════════════════════════════════════════════════════════════════════════════════════

test("E1 texto: lo que el generador escribe hoy en comentarios pasa tal cual", () => {
  for (const t of ["cmp-0", "beh-12", "activo", "3f2b0c9e-7d1a-4c55-9a0e-1b2c3d4e5f60", "esp32-devkit-v1", "estadoBooleano", "celsius", "ninguna", "GPIO18", "A0", "bus-unico-am2302", ">=", "encender", "df364a3186afb53b64fe657b94c162ed7a346a989b175e24d86e84d9b59057c4", "a b", "x".repeat(120)]) {
    assert.equal(comentario`${texto(t, "t")}`.texto, `// ${t}`)
  }
})

test("E2 texto: ningún fin de línea, de ningún alfabeto, entra en un comentario", () => {
  const finales = [["\n", "LF"], ["\r", "CR"], ["\r\n", "CRLF"], [LS, "U+2028"], [PS, "U+2029"], [NEL, "U+0085"], ["\v", "VT"], ["\f", "FF"]]
  for (const [fin, nombre] of finales) {
    for (const t of [`cmp-0${fin}void INYECTADO(){} //`, `cmp-0${fin}`, `${fin}cmp-0`]) rechaza(() => texto(t, "id"), DATO, "comentario", "no-ascii-visible", nombre)
  }
})

test("E3 texto: control, no ASCII, barra invertida, trígrafo, delimitadores, vacío y largo", () => {
  for (const t of [`a${NUL}b`, "a\tb", `a${DEL}b`, `a${c(0x1b)}[2J`, `se${ENIE}al`, `a${c(0xa0)}b`, `${c(0xfeff)}a`, `a${c(0x200b)}b`, c(0xd83d, 0xde00)]) rechaza(() => texto(t, "x"), DATO, "comentario", "no-ascii-visible", JSON.stringify(t))
  // La barra invertida al FINAL es la que continúa la línea; no se admite en ninguna posición.
  for (const t of ["cmp-0\\", "\\", "a\\b", "cmp-0\\n"]) rechaza(() => texto(t, "x"), DATO, "comentario", "barra-invertida", t)
  for (const t of ["cmp-0??/", "??=include", "a??b"]) rechaza(() => texto(t, "x"), DATO, "comentario", "trigrafo", t)
  for (const t of ["a */ b", "a /* b", "*/", "/*"]) rechaza(() => texto(t, "x"), DATO, "comentario", "delimitador-de-comentario", t)
  rechaza(() => texto("", "x"), DATO, "comentario", "vacio")
  rechaza(() => texto("x".repeat(121), "x"), DATO, "comentario", "largo")
  for (const v of [undefined, null, 7, {}, ["cmp-0"], new String("cmp-0"), () => "cmp-0", Symbol("x")]) rechaza(() => texto(v, "x"), DATO, "comentario", "no-es-texto")
})

test("E4 el rechazo dice de dónde salió el dato y lo muestra recortado, sin invocar nada del valor", () => {
  const e = rechaza(() => texto(`${"x".repeat(500)}\n`, "proyecto.id"), DATO, "comentario", "largo")
  assert.equal(e.datos.campo, "proyecto.id")
  assert.equal(e.datos.largo, 501)
  assert.ok(e.datos.valor.length <= 81)
  // Un objeto con un `toString` que explota no hace explotar el rechazo.
  const bomba = { toString() { throw new Error("toString invocado") }, get x() { throw new Error("getter invocado") } }
  assert.equal(rechaza(() => texto(bomba, "x"), DATO, "comentario", "no-es-texto").datos.valor, "<object>")
  assert.equal(rechaza(() => texto(["a"], "x"), DATO, "comentario", "no-es-texto").datos.valor, "<array>")
})

test("E5 numero: sólo números finitos, escritos como los escribe JS", () => {
  for (const [n, t] of [[0, "0"], [-0, "0"], [30, "30"], [-5.5, "-5.5"], [1e21, "1e+21"], [1e-7, "1e-7"], [86, "86"]]) assert.equal(comentario`${numero(n, "n")}`.texto, `// ${t}`)
  for (const v of [NaN, Infinity, -Infinity, "30", "0\nvoid f(){} //", null, undefined, 30n, {}, [30]]) rechaza(() => numero(v, "n"), DATO, "comentario", "no-es-numero-finito")
})

test("E6 comentario: arma `// …`, sólo con datos codificados, y el texto fijo también es una línea ASCII", () => {
  assert.equal(comentario``.texto, "//")
  assert.equal(comentario`fijo`.texto, "// fijo")
  assert.equal(comentario`  ${texto("beh-4", "id")}: ${texto("cmp-0", "id")}.${texto("temperatura", "c")} ${numero(30, "u")} -> x`.texto, "//   beh-4: cmp-0.temperatura 30 -> x")
  // Un string crudo, un número crudo, un fragmento de código o un objeto con la FORMA de un dato: nada pasa.
  const nombres = crearNombres()
  const crudos = ["cmp-0", 30, entero(1, "n", { max: 9 }), nombres.identificador("lectura", "", [idLocal("cmp", "cmp-0", "id")]), Object.freeze({ texto: "cmp-0" }), { texto: "x\nvoid f(){} //" }, null, undefined]
  for (const crudo of crudos) rechaza(() => comentario`a ${crudo} b`, DATO, "comentario", "dato-sin-codificar")
  // Texto fijo con acento o salto de línea: error de quien edita el generador, se ve acá.
  rechaza(() => comentario(Object.assign([`se${ENIE}al`], { raw: [""] })), DATO, "comentario", "plantilla-no-ascii-visible")
  rechaza(() => comentario(Object.assign(["a\nb"], { raw: ["a\nb"] })), DATO, "comentario", "plantilla-no-ascii-visible")
  rechaza(() => comentario(Object.assign(["a\\"], { raw: ["a\\"] })), DATO, "comentario", "plantilla-no-ascii-visible")
})

// ════════════════════════════════════════════════════════════════════════════════════
// E7–E10 — ids de la IR e identificadores
// ════════════════════════════════════════════════════════════════════════════════════

test("E7 idLocal: la segunda capa pregunta el formato por su cuenta (no necesita al cargador)", () => {
  assert.equal(idLocal("cmp", "cmp-0", "id").dato.texto, "cmp-0")
  assert.equal(idLocal("beh", "beh-12", "id").valor, "beh-12")
  const hostiles = ["cmp-0\nvoid INYECTADO(){} //", "cmp-0\n", "cmp-0\r", `cmp-0${LS}`, "cmp-0\\", "cmp_0", "CMP-0", "cmp-00", "cmp-01", " cmp-0", "cmp-0 ", "cmp-", "cmp", "if", "7", "ahora", "PI", "setup", "loop", "HIGH", "__proto__", "beh-0", "conn-0", "", `cmp-${"9".repeat(40)}`]
  for (const id of hostiles) {
    const e = rechaza(() => idLocal("cmp", id, "componente.id"), IDENT, "identificador", "formato-de-id", JSON.stringify(id))
    assert.equal(e.datos.campo, "componente.id")
  }
  for (const v of [undefined, null, 0, {}, ["cmp-0"]]) rechaza(() => idLocal("cmp", v, "id"), IDENT, "identificador", "formato-de-id")
})

test("E8 identificador: los nombres de siempre, byte a byte", () => {
  const n = crearNombres()
  const cmp0 = idLocal("cmp", "cmp-0", "id")
  const cmp12 = idLocal("cmp", "cmp-12", "id")
  assert.equal(n.identificador("pin", "PIN_", [cmp12, atomo("anodo", "terminal")], { mayusculas: true }).texto, "PIN_CMP_12_ANODO")
  assert.equal(n.identificador("lectura", "", [cmp0, atomo("estadoBooleano", "capacidad")]).texto, "cmp_0_estadoBooleano")
  assert.equal(n.identificador("funcion-de-lectura", "leer_", [cmp0, atomo("estadoBooleano", "capacidad")]).texto, "leer_cmp_0_estadoBooleano")
  assert.equal(n.identificador("espera-de-bus", "ESPERA_MS_", [cmp0, atomo("senal", "terminal")], { mayusculas: true }).texto, "ESPERA_MS_CMP_0_SENAL")
  assert.equal(n.identificador("ultimo-intento-de-bus", "ultimo_intento_", [cmp0, atomo("senal", "terminal")]).texto, "ultimo_intento_cmp_0_senal")
  assert.equal(n.identificador("regla", "", [idLocal("beh", "beh-4", "id")]).texto, "beh_4")
  assert.equal(n.identificador("lectura", "", [cmp0, atomo("temperatura-v2", "capacidad")]).texto, "cmp_0_temperatura_v2")
  // Pedir el MISMO nombre para lo mismo, las veces que haga falta, no es una colisión.
  assert.equal(n.identificador("regla", "", [idLocal("beh", "beh-4", "id")]).texto, "beh_4")
  assert.equal(n.identificador("regla", "", [idLocal("beh", "beh-4", "id")]), n.identificador("regla", "", [idLocal("beh", "beh-4", "id")]))
})

test("E9 identificador: un átomo del catálogo que no forma un identificador se rechaza, no se normaliza", () => {
  const cmp0 = idLocal("cmp", "cmp-0", "id")
  const n = () => crearNombres()
  const malos = ["senal\nint x;", "se nal", "senal;", "a.b", "a__b", "a--b", "_a", "a_", "-a", "a-", "", `se${ENIE}al`, "a$b", "a\\", "a/b", "a(b)", "#define", 'a"b']
  for (const a of malos) {
    const e = rechaza(() => n().identificador("pin", "PIN_", [cmp0, atomo(a, "terminal")], { mayusculas: true }), IDENT, "identificador", "forma-de-atomo", JSON.stringify(a))
    assert.equal(e.datos.campo, "terminal")
  }
  rechaza(() => n().identificador("pin", "PIN_", [cmp0, atomo("a".repeat(65), "terminal")]), IDENT, "identificador", "largo")
  assert.equal(n().identificador("pin", "PIN_", [cmp0, atomo("a".repeat(64), "terminal")]).texto, `PIN_cmp_0_${"a".repeat(64)}`)
  for (const v of [undefined, null, 7, {}, ["a"]]) rechaza(() => n().identificador("pin", "PIN_", [cmp0, atomo(v, "terminal")]), IDENT, "identificador", "no-es-texto")
  // Un id de la IR sin verificar no puede colarse como «parte»: o es un IdLocal de acá, o es un átomo (y `cmp-0\n…` no lo es).
  rechaza(() => n().identificador("lectura", "", [{ prefijo: "cmp", valor: "cmp-0\nx", dato: { texto: "x" } }, atomo("a", "c")]), IDENT, "identificador", "no-es-texto")
})

test("E10 identificador: dos cosas distintas con el mismo nombre → colisión (no «la segunda pisa a la primera»)", () => {
  const cmp0 = idLocal("cmp", "cmp-0", "id")
  // a) `a-b` y `a_b` dan el mismo identificador.
  let n = crearNombres()
  n.identificador("lectura", "", [cmp0, atomo("t-x", "capacidad")])
  rechaza(() => n.identificador("lectura", "", [cmp0, atomo("t_x", "capacidad")]), IDENT, "identificador", "colision")
  // b) mayúsculas: `anodo` y `ANODO` dan la misma constante.
  n = crearNombres()
  n.identificador("pin", "PIN_", [cmp0, atomo("anodo", "terminal")], { mayusculas: true })
  rechaza(() => n.identificador("pin", "PIN_", [cmp0, atomo("ANODO", "terminal")], { mayusculas: true }), IDENT, "identificador", "colision")
  // c) dos ROLES con las mismas partes: la validez de un bus y la de una capacidad que se llama como el terminal.
  n = crearNombres()
  n.identificador("validez-de-bus", "valida_", [cmp0, atomo("senal", "terminal")])
  rechaza(() => n.identificador("validez-de-lectura", "valida_", [cmp0, atomo("senal", "capacidad")]), IDENT, "identificador", "colision")
  // d) la función de un backend contra un nombre del programa, en los dos órdenes.
  n = crearNombres()
  n.identificador("funcion-de-lectura", "leer_", [cmp0, atomo("x", "capacidad")])
  rechaza(() => n.deBackend("leer_cmp_0_x", "backend.funcion"), IDENT, "identificador", "colision")
  n = crearNombres()
  n.deBackend("leer_cmp_0_x", "backend.funcion")
  rechaza(() => n.identificador("funcion-de-lectura", "leer_", [cmp0, atomo("x", "capacidad")]), IDENT, "identificador", "colision")
  // e) el registro es por programa: otro programa empieza limpio.
  assert.equal(crearNombres().identificador("lectura", "", [cmp0, atomo("t_x", "capacidad")]).texto, "cmp_0_t_x")
})

test("E11 deBackend: el nombre de una función del driver es un identificador común", () => {
  const n = crearNombres()
  assert.equal(n.deBackend("am2302_leer", "f").texto, "am2302_leer")
  assert.equal(n.deBackend("am2302_leer", "f").texto, "am2302_leer")
  for (const f of ["am2302_leer(pin, d); system(1); //", "am2302 leer", "1leer", "_leer", "leer_", "a__b", "", "leer\n", "le-er", `le${ENIE}r`]) rechaza(() => crearNombres().deBackend(f, "backend.funcion"), IDENT, "identificador", "forma-de-nombre-de-backend", JSON.stringify(f))
  rechaza(() => crearNombres().deBackend("a".repeat(65), "f"), IDENT, "identificador", "largo")
  for (const v of [undefined, null, 7, () => "f"]) rechaza(() => crearNombres().deBackend(v, "f"), IDENT, "identificador", "no-es-texto")
})

// ════════════════════════════════════════════════════════════════════════════════════
// E12–E15 — literales y palabras
// ════════════════════════════════════════════════════════════════════════════════════

test("E12 entero: sólo dígitos, dentro del rango del tipo", () => {
  assert.equal(entero(0, "n", { max: UINT8_MAX }).texto, "0")
  assert.equal(entero(255, "n", { max: UINT8_MAX }).texto, "255")
  assert.equal(entero(4294967295, "n", { max: UINT32_MAX }).texto, "4294967295")
  assert.equal(entero(5, "n", { min: 1, max: 9 }).texto, "5")
  assert.equal(entero(-0, "n", { max: 9 }).texto, "0")
  for (const v of [256, 300, 4294967295]) rechaza(() => entero(v, "n", { max: UINT8_MAX }), DATO, "entero", "fuera-de-rango", String(v))
  rechaza(() => entero(4294967296, "n", { max: UINT32_MAX }), DATO, "entero", "fuera-de-rango")
  rechaza(() => entero(-1, "n", { max: 9 }), DATO, "entero", "fuera-de-rango")
  rechaza(() => entero(0, "n", { min: 1, max: 9 }), DATO, "entero", "fuera-de-rango")
  for (const v of [1.5, NaN, Infinity, 2 ** 53, "4", "4; system(1)", null, undefined, 4n, [4]]) rechaza(() => entero(v, "n", { max: UINT32_MAX }), DATO, "entero", "no-es-entero")
  // Lo que antes llegaba al programa como `1e+21`: Number.isInteger(1e21) es true.
  assert.equal(Number.isInteger(1e21), true)
  rechaza(() => entero(1e21, "pin.numero", { max: UINT8_MAX }), DATO, "entero", "no-es-entero")
})

test("E13 pinAnalogico: `A<n>` con el número acotado", () => {
  assert.equal(pinAnalogico(0, "pin").texto, "A0")
  assert.equal(pinAnalogico(5, "pin").texto, "A5")
  rechaza(() => pinAnalogico(256, "pin"), DATO, "entero", "fuera-de-rango")
  rechaza(() => pinAnalogico("0; system(1)", "pin"), DATO, "entero", "no-es-entero")
})

test("E14 flotante: literal `float` válido, y sólo si el valor sobrevive en un float", () => {
  for (const [n, t] of [[30, "30.0f"], [0, "0.0f"], [-0, "0.0f"], [-5, "-5.0f"], [30.5, "30.5f"], [-5.5, "-5.5f"], [1e21, "1e+21f"], [1e-7, "1e-7f"], [0.1, "0.1f"], [3.4e38, "3.4e+38f"], [-3.4e38, "-3.4e+38f"], [1e-40, "1e-40f"], [123456789012345680000, "123456789012345680000.0f"]]) {
    assert.equal(flotante(n, "u").texto, t)
    assert.match(flotante(n, "u").texto, /^-?(?:[0-9]+\.[0-9]+|[0-9]+(?:\.[0-9]+)?e[+-][0-9]+)f$/, "forma de literal float de C++")
  }
  // Fuera del rango de float el compilador lo vuelve infinito y `x > inf` nunca se cumple.
  for (const n of [3.5e38, -3.5e38, 1e39, 3.4e39, Number.MAX_VALUE]) rechaza(() => flotante(n, "u"), DATO, "flotante", "fuera-de-rango-de-float", String(n))
  // Demasiado chico: se vuelve 0, y `x > 1e-50` pasaría a ser `x > 0`.
  for (const n of [1e-50, -1e-50, Number.MIN_VALUE, 1e-46]) rechaza(() => flotante(n, "u"), DATO, "flotante", "se-vuelve-cero-en-float", String(n))
  for (const v of [NaN, Infinity, -Infinity, "30", "0; system(1); //", null, undefined, 30n, {}]) rechaza(() => flotante(v, "u"), DATO, "flotante", "no-es-numero-finito")
})

test("E15 palabra: se emite el valor de la tabla cerrada; el dato sólo elige (y `constructor` no es una entrada)", () => {
  const OPERADORES = { ">": ">", "<": "<", ">=": ">=", "<=": "<=" }
  for (const op of Object.keys(OPERADORES)) assert.equal(palabra(op, OPERADORES, "comparador").texto, op)
  assert.equal(palabra("alto", { alto: "HIGH" }, "nivel").texto, "HIGH")
  for (const v of ["> 0; INYECTADO(); //", "==", "!=", ">\n", " >", "constructor", "toString", "__proto__", "hasOwnProperty", "", 0, null, undefined, {}, [">"], () => ">"]) {
    rechaza(() => palabra(v, OPERADORES, "comparador"), DATO, "palabra", "fuera-de-la-tabla", JSON.stringify(v))
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// E16–E18 — líneas, código del backend y el archivo
// ════════════════════════════════════════════════════════════════════════════════════

test("E16 cpp: sólo acepta fragmentos codificados; un string crudo es un rechazo, no un descuido posible", () => {
  const n = crearNombres()
  const nombre = n.identificador("pin", "PIN_", [idLocal("cmp", "cmp-1", "id"), atomo("anodo", "terminal")], { mayusculas: true })
  assert.equal(cpp`static const uint8_t ${nombre} = ${entero(18, "pin", { max: UINT8_MAX })};  ${comentario`${texto("cmp-1", "id")} -> ${texto("GPIO18", "pin")}`}`.texto, "static const uint8_t PIN_CMP_1_ANODO = 18;  // cmp-1 -> GPIO18")
  assert.equal(cpp``.texto, "")
  assert.equal(cpp`void setup() {`.texto, "void setup() {")
  // Nada crudo: ni un string, ni un número, ni un dato de comentario (no es código), ni un objeto con la forma de un fragmento.
  const crudos = ["PIN_X", "x;\nvoid INYECTADO(){}", 18, texto("cmp-1", "id"), numero(3, "n"), Object.freeze({ texto: "x" }), { texto: "x;\nvoid f(){}" }, null, undefined, valorIni("uno", "board")]
  for (const crudo of crudos) rechaza(() => cpp`  pinMode(${crudo}, OUTPUT);`, DATO, "linea", "valor-sin-codificar")
  // Un comentario sólo puede cerrar la línea: en el medio comentaría el código que sigue.
  rechaza(() => cpp`  ${comentario`x`} digitalWrite(1, 1);`, DATO, "linea", "comentario-en-el-medio")
  rechaza(() => cpp`${comentario`x`}${nombre}`, DATO, "linea", "comentario-en-el-medio")
  // Texto fijo con acento: error de quien edita el generador.
  rechaza(() => cpp(Object.assign([`se${ENIE}al`], { raw: [""] })), DATO, "linea", "no-ascii-visible")
  rechaza(() => cpp(Object.assign(["a\nb"], { raw: [""] })), DATO, "linea", "no-ascii-visible")
})

test("E17 código del backend: una línea es UNA línea de ASCII visible", () => {
  assert.equal(lineaDeBackend("  if (micros() - inicio > limite_us) return 0;", "driver").texto, "  if (micros() - inicio > limite_us) return 0;")
  assert.equal(lineaDeBackend("", "driver").texto, "")
  for (const [l, causa] of [["a;\nvoid INYECTADO(){}", "no-ascii-visible"], ["a;\r", "no-ascii-visible"], [`// se${ENIE}al`, "no-ascii-visible"], ["\tint x;", "no-ascii-visible"], ["// fin \\", "barra-invertida-final"], ["// ??/", "trigrafo"]]) {
    rechaza(() => lineaDeBackend(l, "driver"), DATO, "codigo-backend", causa, JSON.stringify(l))
  }
  for (const v of [undefined, null, 7, ["a"], {}]) rechaza(() => lineaDeBackend(v, "driver"), DATO, "codigo-backend", "no-es-texto")
  // Una barra invertida que NO está al final es C++ común (un carácter escapado): pasa.
  assert.equal(lineaDeBackend("  char c = '\\n';", "driver").texto, "  char c = '\\n';")

  assert.equal(expresionDeBackend("((datos_cmp_0_senal[0] << 8) | datos_cmp_0_senal[1]) * 0.1f", "campo").texto, "((datos_cmp_0_senal[0] << 8) | datos_cmp_0_senal[1]) * 0.1f")
  for (const [x, causa] of [["", "vacio"], ["a // b", "comentario"], ["a\nb", "no-ascii-visible"], ["a \\", "barra-invertida-final"], ["a ??/", "trigrafo"]]) rechaza(() => expresionDeBackend(x, "campo"), DATO, "codigo-backend", causa, JSON.stringify(x))
  for (const v of [undefined, null, 7, {}]) rechaza(() => expresionDeBackend(v, "campo"), DATO, "codigo-backend", "no-es-texto")
})

test("E18 unirLineas: el archivo sólo se arma con líneas de este módulo", () => {
  assert.equal(unirLineas([cpp`a`, cpp``, lineaDeBackend("b", "driver"), cpp``]), "a\n\nb\n")
  assert.equal(unirLineas([]), "")
  for (const cruda of ["void INYECTADO(){}", { texto: "void INYECTADO(){}" }, Object.freeze({ texto: "x" }), entero(1, "n", { max: 9 }), comentario`x`, null, undefined]) rechaza(() => unirLineas([cpp`a`, cruda]), DATO, "linea", "linea-sin-codificar")
})

// ════════════════════════════════════════════════════════════════════════════════════
// E19–E20 — platformio.ini
// ════════════════════════════════════════════════════════════════════════════════════

test("E19 valorIni / entornoIni: los valores del registro real pasan; todo lo que el formato interpreta, no", () => {
  for (const v of ["esp32dev", "uno", "arduino", "espressif32@6.12.0", "atmelavr@5.2.0", "a", "A1", "a.b_c-d@1"]) assert.equal(valorIni(v, "x").texto, v)
  for (const v of ["esp32-devkit-v1", "arduino-uno", "a_b", "0"]) assert.equal(entornoIni(v, "x").texto, v)
  const malos = [
    "uno\nextra_scripts = pre:x.py", "uno\n[env:x]", "uno\r", "uno\r\nupload_port = /dev/x", `uno${LS}`, "uno ; comentario", "uno;x", "uno # x", "uno#x", "${env.board}", "$PROJECT_DIR", "uno{", "[env:x]", "a=b", "uno ", " uno", "u no",
    "https://github.com/x/y.git", "file:///x", "a/b", "a:b", "../x", "-e", "-uno", ".uno", "_uno", "@1", "", `u${ENIE}o`, "a\\", 'a"b', "a,b", "a".repeat(65),
  ]
  for (const v of malos) rechaza(() => valorIni(v, "board"), DATO, "ini", "forma", JSON.stringify(v))
  // El environment además va como argumento de `pio run -e`: ni `.` ni `@`, y nunca empieza con `-`.
  for (const v of [...malos, "a.b", "a@1", "esp32.v1"]) rechaza(() => entornoIni(v, "placa.id"), DATO, "ini", "forma", JSON.stringify(v))
  for (const v of [undefined, null, 7, {}, ["uno"]]) {
    rechaza(() => valorIni(v, "board"), DATO, "ini", "no-es-texto")
    rechaza(() => entornoIni(v, "placa.id"), DATO, "ini", "no-es-texto")
  }
  assert.equal(valorIni("a".repeat(64), "x").texto.length, 64)
})

test("E20 ini: una línea del .ini sólo interpola valores codificados", () => {
  assert.equal(ini`[env:${entornoIni("esp32-devkit-v1", "placa.id")}]`, "[env:esp32-devkit-v1]")
  assert.equal(ini`platform = ${valorIni("espressif32@6.12.0", "platform")}`, "platform = espressif32@6.12.0")
  for (const crudo of ["uno", "uno\nextra_scripts = x", Object.freeze({ texto: "uno" }), texto("uno", "x"), entero(1, "n", { max: 9 }), null, undefined]) rechaza(() => ini`board = ${crudo}`, DATO, "ini", "valor-sin-codificar")
})
