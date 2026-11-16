// Codegen — emisión segura: cada dato entra al texto generado por la codificación de SU clase
// léxica, o no entra.
//
// H-02 (SEC-04 / BUG-04). El incidente: un `activo.json` con `"beh-7x\nvoid INYECTADO(){ } //"`
// como id de una regla generaba un `main.cpp` con esa función como código (evidencia:
// `inyeccion-ids.out`, `persistencia.out` caso P11, sobre b61d1eb).
//
// Causa raíz: `programa.ts` armaba el programa con plantillas de string comunes. Para una
// plantilla, un id de la IR, un número, el nombre de una unidad del catálogo y una línea de C++
// escrita por el generador son lo mismo: texto. Nada distinguía «esto va adentro de un comentario»
// de «esto es un identificador» de «esto es código»; el salto de línea del id era un dato para la
// IR y un fin de comentario para el compilador. Filtrar saltos de línea tapaba ese caso y dejaba
// la causa: cualquier interpolación nueva volvía a ser cruda.
//
// La corrección es de construcción, no de filtro. El programa ya no es una lista de strings: es
// una lista de `Linea`, y una `Linea` sólo se arma con `cpp` (o `lineaDeBackend`). `cpp` acepta
// como valores interpolados ÚNICAMENTE fragmentos hechos por los constructores de este archivo,
// uno por clase léxica:
//
//   clase                 constructor                      qué garantiza
//   ───────────────────   ──────────────────────────────   ─────────────────────────────────────
//   identificador         `Nombres.identificador`          forma fija + id de la IR + átomos del
//                         `Nombres.deBackend`              catálogo; sin colisiones en el programa
//   literal entero        `entero`, `pinAnalogico`         entero seguro dentro del rango del tipo
//   literal float         `flotante`                       finito y representable en `float`
//   palabra / operador    `palabra`                        pertenece a una tabla cerrada del backend
//   comentario de línea   `comentario` + `texto`/`numero`  una sola línea, ASCII visible, sin `\`
//                         /`idLocal`
//   código del backend    `lineaDeBackend`, `expresion…`   una sola línea, ASCII visible
//   valor de .ini         `valorIni`, `entornoIni`         alfabeto cerrado (sin `;`, `$`, `[`, …)
//
// Un string común interpolado en `cpp` no es un error de estilo: es un rechazo en tiempo de
// ejecución (los tipos de TypeScript se borran al correr; la marca que se chequea es un `WeakSet`
// privado de este módulo, que no se puede falsificar desde afuera) y además un error de tipos.
//
// Falla cerrado: ante un dato que no entra en su clase se lanza `RechazoDeEmision` y
// `generarPrograma` devuelve un `CODEGEN_*` SIN archivos. Nunca se «sanea»: un id al que se le
// saca un carácter es otro id, y un número recortado es otro número.
//
// No hay cadenas de texto ni directivas con datos: el backend no emite ningún literal `"…"` y el
// único `#include` es una línea fija. Si algún día hacen falta, se agrega SU constructor acá; no
// se interpola.
//
// Puro: sin I/O, sin reloj, sin estado entre llamadas (el registro de nombres es por programa).

import { esIdLocal, recorteDeId, type PrefijoIdLocal } from "../nucleo/id.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Rechazo
// ════════════════════════════════════════════════════════════════════════════════════

export type CodigoRechazoDeEmision =
  /** Un id de la IR o un id del catálogo no puede formar un identificador C++ del programa. */
  | "CODEGEN_IDENTIFICADOR_INVALIDO"
  /** Un dato no entra en la clase léxica en la que habría que escribirlo. */
  | "CODEGEN_DATO_NO_EMITIBLE"

export type ClaseLexica = "identificador" | "comentario" | "entero" | "flotante" | "palabra" | "codigo-backend" | "ini" | "linea"

export class RechazoDeEmision extends Error {
  readonly codigo: CodigoRechazoDeEmision
  readonly datos: Readonly<Record<string, unknown>>
  constructor(codigo: CodigoRechazoDeEmision, datos: Readonly<Record<string, unknown>>) {
    super(`${codigo} ${JSON.stringify(datos)}`)
    this.name = "RechazoDeEmision"
    this.codigo = codigo
    this.datos = datos
  }
}

/** Lo que se muestra de un valor rechazado, sin invocar nada suyo (ni `toString` ni getters). */
function muestra(valor: unknown): string {
  if (typeof valor === "string") return recorteDeId(valor)
  if (typeof valor === "number" || typeof valor === "boolean" || valor === null || valor === undefined) return String(valor)
  return `<${Array.isArray(valor) ? "array" : typeof valor}>`
}

function rechazar(codigo: CodigoRechazoDeEmision, clase: ClaseLexica, causa: string, campo: string, valor: unknown): never {
  throw new RechazoDeEmision(codigo, { clase, causa, campo, valor: muestra(valor), ...(typeof valor === "string" ? { largo: valor.length } : {}) })
}
const noEmitible = (clase: ClaseLexica, causa: string, campo: string, valor: unknown): never => rechazar("CODEGEN_DATO_NO_EMITIBLE", clase, causa, campo, valor)
const identificadorInvalido = (causa: string, campo: string, valor: unknown): never => rechazar("CODEGEN_IDENTIFICADOR_INVALIDO", "identificador", causa, campo, valor)

// ════════════════════════════════════════════════════════════════════════════════════
// Fragmentos: lo ÚNICO que se puede interpolar
// ════════════════════════════════════════════════════════════════════════════════════

declare const MARCA_CODIGO: unique symbol
declare const MARCA_COMENTARIO: unique symbol
declare const MARCA_DATO: unique symbol
declare const MARCA_LINEA: unique symbol

/** Un pedazo de C++ ya codificado: identificador, literal o palabra del backend. */
export interface Codigo {
  readonly texto: string
  readonly [MARCA_CODIGO]: true
}
/** Un comentario de línea completo (`// …`). Sólo puede ir al final de una `Linea`. */
export interface Comentario {
  readonly texto: string
  readonly [MARCA_COMENTARIO]: true
}
/** Un dato ya validado para ir ADENTRO de un comentario. No es código: `cpp` no lo acepta. */
export interface DatoDeComentario {
  readonly texto: string
  readonly [MARCA_DATO]: true
}
/** Una línea completa del programa. */
export interface Linea {
  readonly texto: string
  readonly [MARCA_LINEA]: true
}

// La marca real, en ejecución. Un objeto con la forma de un fragmento pero que no salió de un
// constructor de acá no está en estos conjuntos, y `cpp`/`comentario`/`unirLineas` lo rechazan.
const CODIGOS = new WeakSet<object>()
const COMENTARIOS = new WeakSet<object>()
const DATOS = new WeakSet<object>()
const LINEAS = new WeakSet<object>()

function marcar<T extends object>(conjunto: WeakSet<object>, texto: string): T {
  const fragmento = Object.freeze({ texto })
  conjunto.add(fragmento)
  return fragmento as unknown as T
}
const esDe = (conjunto: WeakSet<object>, valor: unknown): valor is { readonly texto: string } => typeof valor === "object" && valor !== null && conjunto.has(valor)

// ════════════════════════════════════════════════════════════════════════════════════
// Léxico
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * ASCII visible (del espacio a `~`), TODO el texto. En JS, sin la bandera `m`, `$` sólo matchea al
 * final de la entrada: `"x\n"` NO pasa (en Python pasaría). La clase tampoco incluye `\n`.
 */
const ASCII_VISIBLE = /^[\x20-\x7E]*$/
const esAsciiVisible = (t: string): boolean => ASCII_VISIBLE.test(t)

const BARRA_INVERTIDA = String.fromCharCode(0x5c)
/** Largo máximo de un dato de texto en un comentario, y de un átomo de identificador. */
const LARGO_MAXIMO_DE_TEXTO = 120
const LARGO_MAXIMO_DE_ATOMO = 64

/**
 * Por qué un texto NO puede ir adentro de un comentario de línea, o `undefined` si puede.
 * - una sola línea de ASCII visible: cualquier fin de línea (`\n`, `\r`, U+2028, U+2029, `\v`,
 *   `\f`, NEL) termina el comentario, y fuera de ASCII no se emite nada (el C++ generado es ASCII);
 * - sin barra invertida: al final de la línea la continúa en la siguiente, que pasaría a ser
 *   comentario (o dejaría de serlo); no hace falta en ningún dato legítimo, así que no se admite
 *   en ninguna posición;
 * - sin `??`: los trígrafos (`??/` es una barra invertida) siguen vivos con `-std=c++11`/`-trigraphs`;
 * - sin `/*` ni `*` + `/`: en un comentario de línea no hacen nada, pero un dato no tiene por qué
 *   traer delimitadores de comentario.
 */
function problemaDeTextoEnComentario(t: string): string | undefined {
  if (t.length === 0) return "vacio"
  if (t.length > LARGO_MAXIMO_DE_TEXTO) return "largo"
  if (!esAsciiVisible(t)) return "no-ascii-visible"
  if (t.includes(BARRA_INVERTIDA)) return "barra-invertida"
  if (t.includes("??")) return "trigrafo"
  if (t.includes("/*") || t.includes("*/")) return "delimitador-de-comentario"
  return undefined
}

// ════════════════════════════════════════════════════════════════════════════════════
// Datos de comentario
// ════════════════════════════════════════════════════════════════════════════════════

/** Un string (de la IR o del catálogo) para mostrar en un comentario. `campo` nombra de dónde sale. */
export function texto(valor: unknown, campo: string): DatoDeComentario {
  if (typeof valor !== "string") return noEmitible("comentario", "no-es-texto", campo, valor)
  const problema = problemaDeTextoEnComentario(valor)
  if (problema !== undefined) return noEmitible("comentario", problema, campo, valor)
  return marcar<DatoDeComentario>(DATOS, valor)
}

/** Un número finito para mostrar en un comentario, tal como lo escribe JS (`30`, `30.5`, `1e+21`). */
export function numero(valor: unknown, campo: string): DatoDeComentario {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return noEmitible("comentario", "no-es-numero-finito", campo, valor)
  return marcar<DatoDeComentario>(DATOS, String(valor))
}

/**
 * Comentario de línea: `comentario\`texto fijo ${dato} más texto fijo\`` → `// texto fijo … `.
 * El texto fijo es del generador; los valores sólo pueden ser `DatoDeComentario`.
 */
export function comentario(partes: TemplateStringsArray, ...datos: readonly DatoDeComentario[]): Comentario {
  let cuerpo = partes[0] ?? ""
  datos.forEach((dato, i) => {
    if (!esDe(DATOS, dato)) return noEmitible("comentario", "dato-sin-codificar", `comentario[${i}]`, dato)
    cuerpo += dato.texto + (partes[i + 1] ?? "")
  })
  // El texto fijo también es una sola línea de ASCII: lo escribe el generador, y un acento o un
  // salto de línea ahí es un error de quien edita el generador, no un dato.
  if (!esAsciiVisible(cuerpo) || cuerpo.includes(BARRA_INVERTIDA)) return noEmitible("comentario", "plantilla-no-ascii-visible", "comentario", cuerpo)
  return marcar<Comentario>(COMENTARIOS, cuerpo.length === 0 ? "//" : `// ${cuerpo}`)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Ids de la IR
// ════════════════════════════════════════════════════════════════════════════════════

declare const MARCA_ID: unique symbol
/** Un id local de la IR ya verificado: sirve como dato de comentario y como parte de un identificador. */
export interface IdLocal {
  readonly prefijo: PrefijoIdLocal
  readonly valor: string
  readonly dato: DatoDeComentario
  readonly [MARCA_ID]: true
}
const IDS = new WeakSet<object>()

/**
 * Segunda capa de H-02, independiente del cargador: el codegen NO supone que el proyecto entró
 * por `cargarProyecto`. Pregunta el formato (el mismo predicado de `id.ts`, una sola definición)
 * cada vez que va a escribir un id, y si no lo cumple no escribe nada.
 */
export function idLocal(prefijo: PrefijoIdLocal, valor: unknown, campo: string): IdLocal {
  if (!esIdLocal(prefijo, valor)) return identificadorInvalido("formato-de-id", campo, valor)
  const id = Object.freeze({ prefijo, valor, dato: texto(valor, campo) })
  IDS.add(id)
  return id as unknown as IdLocal
}

// ════════════════════════════════════════════════════════════════════════════════════
// Identificadores
// ════════════════════════════════════════════════════════════════════════════════════

/** Un id del catálogo (terminal, capacidad) como parte de un identificador. */
export interface Atomo {
  readonly atomo: unknown
  readonly campo: string
}
export const atomo = (valor: unknown, campo: string): Atomo => ({ atomo: valor, campo })

/**
 * Forma de un átomo: letras y dígitos ASCII en tramos unidos por UN `-` o UN `_`. Es lo que hace
 * que pasar `-` a `_` dé siempre un identificador válido (no empieza ni termina en `_`, no tiene
 * `__`). No lo hace inyectivo (`a-b` y `a_b` dan lo mismo): de eso se ocupa el registro.
 */
const FORMA_DE_ATOMO = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/
/** Nombre de una función que trae un backend: un identificador C++ común, sin `__`. */
const FORMA_DE_NOMBRE_DE_BACKEND = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/

function parteDeIdentificador(parte: IdLocal | Atomo): string {
  if (esDe(IDS, parte)) return (parte as IdLocal).valor.replace("-", "_")
  const { atomo: valor, campo } = parte as Atomo
  if (typeof valor !== "string") return identificadorInvalido("no-es-texto", campo, valor)
  if (valor.length > LARGO_MAXIMO_DE_ATOMO) return identificadorInvalido("largo", campo, valor)
  if (!FORMA_DE_ATOMO.test(valor)) return identificadorInvalido("forma-de-atomo", campo, valor)
  return valor.replaceAll("-", "_")
}

/**
 * Los identificadores de UN programa. Todo nombre que sale de datos tiene la forma
 *   <prefijo fijo del generador><id local con `_`>[_<átomo>…]
 * así que empieza con `cmp_<n>`/`beh_<n>` o con un prefijo del generador seguido de eso
 * (`PIN_CMP_<n>_…`, `leer_cmp_<n>_…`, `datos_cmp_<n>_…`). Ninguna palabra reservada de C++, ninguna
 * macro de Arduino y ninguna variable del propio programa (`ahora`, `setup`, `loop`) tiene esa
 * forma: por eso no hay una lista de nombres prohibidos que mantener (y que nunca estaría completa).
 *
 * Lo que la forma NO garantiza es que dos cosas DISTINTAS no terminen con el mismo nombre
 * (`a-b`/`a_b`; `anodo`/`ANODO` en una constante; un bus y una capacidad que se llaman igual). El
 * registro guarda de qué salió cada nombre y rechaza el programa si un nombre aparece para dos
 * orígenes distintos.
 */
export interface Nombres {
  /**
   * `rol` dice QUÉ es el nombre (`pin`, `lectura`, `bus-datos`…): entra en el origen, para que
   * dos roles con las mismas partes no se confundan con «el mismo nombre pedido dos veces».
   */
  identificador(rol: string, prefijo: string, partes: readonly (IdLocal | Atomo)[], opciones?: { readonly mayusculas?: boolean }): Codigo
  /** El nombre de una función que define el driver de un backend (`am2302_leer`). */
  deBackend(valor: unknown, campo: string): Codigo
}

export function crearNombres(): Nombres {
  const origenDe = new Map<string, string>()
  const fragmentoDe = new Map<string, Codigo>()
  function registrar(nombre: string, origen: string, campo: string): Codigo {
    const previo = origenDe.get(nombre)
    if (previo !== undefined && previo !== origen) return identificadorInvalido("colision", campo, nombre)
    origenDe.set(nombre, origen)
    let fragmento = fragmentoDe.get(nombre)
    if (!fragmento) {
      fragmento = marcar<Codigo>(CODIGOS, nombre)
      fragmentoDe.set(nombre, fragmento)
    }
    return fragmento
  }
  return {
    identificador(rol, prefijo, partes, opciones = {}) {
      const crudos = partes.map((p) => (esDe(IDS, p) ? (p as IdLocal).valor : (p as Atomo).atomo))
      const campo = partes.map((p) => (esDe(IDS, p) ? "id" : (p as Atomo).campo)).join("+")
      const base = prefijo + partes.map(parteDeIdentificador).join("_")
      return registrar(opciones.mayusculas ? base.toUpperCase() : base, JSON.stringify([rol, ...crudos]), campo)
    },
    deBackend(valor, campo) {
      if (typeof valor !== "string") return identificadorInvalido("no-es-texto", campo, valor)
      if (valor.length > LARGO_MAXIMO_DE_ATOMO) return identificadorInvalido("largo", campo, valor)
      if (!FORMA_DE_NOMBRE_DE_BACKEND.test(valor)) return identificadorInvalido("forma-de-nombre-de-backend", campo, valor)
      return registrar(valor, JSON.stringify(["backend", valor]), campo)
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Literales y palabras
// ════════════════════════════════════════════════════════════════════════════════════

export const UINT8_MAX = 255
export const UINT32_MAX = 4294967295

/**
 * Literal entero decimal. Para un entero seguro no negativo, `String` da sólo dígitos (la
 * notación exponencial de JS empieza en 1e21, fuera de los enteros seguros): por eso alcanza con
 * el rango, y un `1e21` o un `300` en un `uint8_t` se rechazan en vez de escribirse.
 */
export function entero(valor: unknown, campo: string, rango: { readonly min?: number; readonly max: number }): Codigo {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor)) return noEmitible("entero", "no-es-entero", campo, valor)
  if (valor < (rango.min ?? 0) || valor > rango.max) return noEmitible("entero", "fuera-de-rango", campo, valor)
  return marcar<Codigo>(CODIGOS, String(valor))
}

/** Constante analógica del core Arduino (`A0`…): la letra es del generador, el número pasa por `entero`. */
export function pinAnalogico(valor: unknown, campo: string): Codigo {
  return marcar<Codigo>(CODIGOS, `A${entero(valor, campo, { max: UINT8_MAX }).texto}`)
}

/**
 * Literal `float` de C++. Un número finito de JS se escribe como decimal (`30`, `30.5`) o con
 * exponente (`1e+21`, `1e-7`), y las dos formas son literales C++ válidos con el sufijo `f`.
 * Lo que NO es válido es el valor: fuera del rango de `float` el compilador lo convierte en
 * infinito (y `x > inf` no se cumple nunca), y uno demasiado chico se vuelve 0. En los dos casos
 * el firmware compararía contra OTRO número que el del proyecto, sin avisar: se rechaza.
 */
export function flotante(valor: unknown, campo: string): Codigo {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return noEmitible("flotante", "no-es-numero-finito", campo, valor)
  const comoFloat = Math.fround(valor)
  if (!Number.isFinite(comoFloat)) return noEmitible("flotante", "fuera-de-rango-de-float", campo, valor)
  if (valor !== 0 && comoFloat === 0) return noEmitible("flotante", "se-vuelve-cero-en-float", campo, valor)
  const escrito = String(valor)
  return marcar<Codigo>(CODIGOS, /[.e]/.test(escrito) ? `${escrito}f` : `${escrito}.0f`)
}

/**
 * Una palabra de una tabla CERRADA del backend (un operador, `HIGH`/`LOW`, un modo de pin). Lo
 * que se emite es el valor de la tabla, nunca el dato: el dato sólo elige la entrada. `hasOwn`,
 * no `in`: `"constructor"` no es una entrada de ninguna tabla.
 */
export function palabra(valor: unknown, tabla: Readonly<Record<string, string>>, campo: string): Codigo {
  if (typeof valor !== "string" || !Object.hasOwn(tabla, valor)) return noEmitible("palabra", "fuera-de-la-tabla", campo, valor)
  return marcar<Codigo>(CODIGOS, tabla[valor] as string)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Código del backend
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * El driver de un protocolo y sus expresiones SON código: los escribe el backend (`protocolos.ts`),
 * no salen de la IR ni del catálogo, y no hay codificación que los vuelva «seguros». Lo que se les
 * exige es la forma de UNA línea: ASCII visible, sin barra invertida final y sin trígrafos. Un
 * backend que trae un salto de línea adentro de una «línea» no se emite.
 */
function problemaDeCodigoDeBackend(valor: unknown): string | undefined {
  if (typeof valor !== "string") return "no-es-texto"
  if (!esAsciiVisible(valor)) return "no-ascii-visible"
  if (valor.endsWith(BARRA_INVERTIDA)) return "barra-invertida-final"
  if (valor.includes("??")) return "trigrafo"
  return undefined
}

export function lineaDeBackend(valor: unknown, campo: string): Linea {
  const problema = problemaDeCodigoDeBackend(valor)
  if (problema !== undefined) return noEmitible("codigo-backend", problema, campo, valor)
  return marcar<Linea>(LINEAS, valor as string)
}

/** Una expresión C++ que arma un backend (el valor de un campo del protocolo). Va dentro de una línea. */
export function expresionDeBackend(valor: unknown, campo: string): Codigo {
  const problema = problemaDeCodigoDeBackend(valor) ?? ((valor as string).length === 0 ? "vacio" : (valor as string).includes("//") ? "comentario" : undefined)
  if (problema !== undefined) return noEmitible("codigo-backend", problema, campo, valor)
  return marcar<Codigo>(CODIGOS, valor as string)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Líneas y programa
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Una línea de C++: `cpp\`static const uint8_t ${nombre} = ${pin};  ${comentario\`…\`}\``.
 * El texto fijo es del generador. Los valores sólo pueden ser `Codigo` o, en la ÚLTIMA posición y
 * sin nada después, un `Comentario`. Un string, un número o cualquier otra cosa se rechaza.
 */
export function cpp(partes: TemplateStringsArray, ...valores: readonly (Codigo | Comentario)[]): Linea {
  let linea = partes[0] ?? ""
  valores.forEach((valor, i) => {
    const despues = partes[i + 1] ?? ""
    if (esDe(COMENTARIOS, valor)) {
      if (i !== valores.length - 1 || despues !== "") return noEmitible("linea", "comentario-en-el-medio", `cpp[${i}]`, valor.texto)
    } else if (!esDe(CODIGOS, valor)) return noEmitible("linea", "valor-sin-codificar", `cpp[${i}]`, valor)
    linea += valor.texto + despues
  })
  if (!esAsciiVisible(linea)) return noEmitible("linea", "no-ascii-visible", "cpp", linea)
  return marcar<Linea>(LINEAS, linea)
}

/** El archivo: las líneas unidas con `\n`. Sólo acepta `Linea`s de este módulo. */
export function unirLineas(lineas: readonly Linea[]): string {
  return lineas
    .map((linea, i) => {
      if (!esDe(LINEAS, linea)) return noEmitible("linea", "linea-sin-codificar", `linea[${i}]`, linea)
      return linea.texto
    })
    .join("\n")
}

// ════════════════════════════════════════════════════════════════════════════════════
// platformio.ini
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Valor de una opción del `.ini` (`platform`, `board`, `framework`). Alfabeto cerrado: letras,
 * dígitos, `.`, `_`, `-` y `@` (la versión fijada: `espressif32@6.12.0`), empezando con letra o
 * dígito. Queda afuera todo lo que el formato interpreta: salto de línea (otra opción u otra
 * sección: `\n[env:x]`, `extra_scripts = …`), `;` y `#` (comentario), `$`/`{`/`}` (interpolación
 * `${…}`), `[`/`]`, `=`, espacios, y `:`/`/` (una plataforma por URL no se admite: el registro
 * fija plataforma y versión por nombre).
 */
const FORMA_DE_VALOR_INI = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/
/** Nombre del environment: además se pasa como argumento a `pio run -e`, así que no empieza con `-`. */
const FORMA_DE_ENTORNO_INI = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

declare const MARCA_INI: unique symbol
export interface ValorIni {
  readonly texto: string
  readonly [MARCA_INI]: true
}
const VALORES_INI = new WeakSet<object>()

function valorDeIni(forma: RegExp, valor: unknown, campo: string): ValorIni {
  if (typeof valor !== "string") return noEmitible("ini", "no-es-texto", campo, valor)
  if (!forma.test(valor)) return noEmitible("ini", "forma", campo, valor)
  return marcar<ValorIni>(VALORES_INI, valor)
}
export const valorIni = (valor: unknown, campo: string): ValorIni => valorDeIni(FORMA_DE_VALOR_INI, valor, campo)
export const entornoIni = (valor: unknown, campo: string): ValorIni => valorDeIni(FORMA_DE_ENTORNO_INI, valor, campo)

/** Una línea del `.ini`: texto fijo del generador y valores que sólo pueden ser `ValorIni`. */
export function ini(partes: TemplateStringsArray, ...valores: readonly ValorIni[]): string {
  let linea = partes[0] ?? ""
  valores.forEach((valor, i) => {
    if (!esDe(VALORES_INI, valor)) return noEmitible("ini", "valor-sin-codificar", `ini[${i}]`, valor)
    linea += valor.texto + (partes[i + 1] ?? "")
  })
  return linea
}
