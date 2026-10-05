// Conocimiento CUANTITATIVO — CK-REQ-N1 (Component Knowledge).
//
// Responde, de forma determinista y genérica, qué capacidades cuantitativas expone un tipo
// de componente (magnitud, unidad canónica, unidades ofrecidas con su símbolo, rango y
// resolución declarados, disponibilidad semántica) y convierte una cantidad física entre
// unidades CONOCIDAS. Es conocimiento del mundo físico: no sabe de reglas, de la IR de
// comportamiento, de Blockly ni de frases.
//
// Genérico por construcción: ningún id de componente, capacidad, magnitud ni unidad aparece
// en este archivo (guardia en `tests/conocimiento-cuantitativo.test.mjs`). Todo sale de:
// - el catálogo semántico (capacidades, rangos, resoluciones y conversiones declaradas);
// - los registros de vocabulario (`nucleo/registros/vocabulario.ts`: unidades válidas por
//   magnitud, símbolo y código UCUM);
// - la forma canónica booleana (`nucleo/estado-booleano.ts`: qué magnitud es booleana, y por
//   lo tanto NO cuantitativa);
// - el anexo de pedagogía (rótulo de la capacidad).
//
// Contrato completo: `component-knowledge/CK_REQ_N1_IMPLEMENTED_CONTRACT.md`.

import type { Cantidad, Capacidad, Catalogo, ConversionUnidad, Magnitud, Rango, Unidad } from "../nucleo/catalogo.ts"
import { propagarMagnitud } from "../nucleo/catalogo.ts"
import { MAGNITUD_BOOLEANA } from "../nucleo/estado-booleano.ts"
import { MAGNITUDES, UNIDADES, unidadesDeMagnitud } from "../nucleo/registros/vocabulario.ts"
import { congelarProfundo } from "../nucleo/canonico.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos públicos
// ════════════════════════════════════════════════════════════════════════════════════

/** Errores de consulta/conversión: códigos estables, nunca prosa. */
export type CodigoErrorCuantitativo =
  | "COMPONENTE_INEXISTENTE"
  | "CAPACIDAD_INEXISTENTE"
  | "CAPACIDAD_NO_CUANTITATIVA"
  | "CAPACIDAD_NO_DISPONIBLE"
  | "MAGNITUD_DESCONOCIDA"
  | "UNIDAD_DESCONOCIDA"
  | "UNIDAD_INCOMPATIBLE_CON_MAGNITUD"
  | "MAGNITUD_DISTINTA_DE_LA_CAPACIDAD"
  | "UNIDAD_NO_OFRECIDA_POR_LA_CAPACIDAD"
  | "CONVERSION_NO_DECLARADA"
  | "VALOR_NO_FINITO"
  | "RESULTADO_NO_FINITO"

export type ResultadoCuantitativo<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly error: { readonly codigo: CodigoErrorCuantitativo; readonly datos: Readonly<Record<string, unknown>> } }

/** Por qué una capacidad cuantitativa NO está semánticamente disponible. */
export type MotivoNoDisponible = "UNIDAD_INCOMPATIBLE_CON_MAGNITUD" | "RANGO_INVALIDO" | "RESOLUCION_INVALIDA"

export interface DisponibilidadSemantica {
  /** `true` si el conocimiento de ESA capacidad es completo y coherente para escribir y
   * validar una condición sobre ella. NO es `officiallySupported` (ver contrato §4). */
  readonly disponible: boolean
  readonly motivos: readonly MotivoNoDisponible[]
}

export interface UnidadConocida {
  readonly id: string
  /** Símbolo para mostrar (SI: "°C", "%"). Presentación, fuera del hash. */
  readonly simbolo: string
  /** Código UCUM (unitsofmeasure.org). Atributo, no id (CK-06). */
  readonly ucum: string
}

export interface UnidadDeCapacidad extends UnidadConocida {
  /** La unidad en que el catálogo declara la capacidad (y su rango/resolución). */
  readonly canonica: boolean
}

export interface CapacidadCuantitativa {
  readonly tipo: string
  readonly capacidad: string
  /** Rótulo para el alumno (anexo de pedagogía, es-AR); `null` si el anexo no lo tiene. */
  readonly etiqueta: string | null
  readonly magnitud: string
  readonly unidadCanonica: string
  /** Canónica primero; después, cada unidad de la misma magnitud con conversión DECLARADA
   * en los dos sentidos desde/hacia la canónica. Nunca una conversión inventada. */
  readonly unidades: readonly UnidadDeCapacidad[]
  /** Rango declarado en el catálogo, en la unidad canónica; `null` si no hay. */
  readonly rango: Rango | null
  /** Resolución declarada, en la unidad canónica; `null` si no hay. */
  readonly resolucion: Cantidad | null
  readonly disponibilidadSemantica: DisponibilidadSemantica
}

export interface CantidadFisica {
  readonly valor: number
  readonly unidad: string
  readonly magnitud: string
}

// ════════════════════════════════════════════════════════════════════════════════════
// Normalización numérica de conversiones (contrato §7)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Cifras significativas que se conservan, medidas en la ESCALA DE LA CUENTA: el mayor valor
 * absoluto entre el dato de entrada, el producto `valor × factor`, el `offset` y el resultado.
 *
 * Por qué así: una conversión afín (`valor × factor + offset`) en doble precisión acumula un
 * error de unos pocos ulps del MAYOR término de la cuenta, no del resultado. Cerca de cero,
 * después de restar un offset, el resultado puede ser chico y el error relativo a él, enorme
 * (0,1 °C → 32,18 °F → 0,10000000000000142 °C). Redondear relativo al resultado no limpia ese
 * error; redondear a decimales fijos rompe las unidades muy chicas o muy grandes. Medir en la
 * escala de la cuenta es invariante a la unidad y deja ~3 cifras de margen sobre las ~15,9
 * que da un double.
 */
export const CIFRAS_SIGNIFICATIVAS_DE_ESCALA = 12

/** Exponente decimal de |x| (x ≠ 0), exacto por especificación (toExponential, no log10). */
function exponenteDecimal(x: number): number {
  return Number(x.toExponential().split("e")[1])
}

/**
 * Redondea `resultado` al cuanto 10^(E − 11), con E = exponente decimal de la escala.
 * Determinista (toPrecision está especificado en ECMA-262); nunca devuelve -0.
 */
export function normalizarResultado(resultado: number, escala: number): number {
  if (resultado === 0 || escala === 0) return 0
  const cuanto = exponenteDecimal(Math.abs(escala)) - (CIFRAS_SIGNIFICATIVAS_DE_ESCALA - 1)
  const cifras = exponenteDecimal(Math.abs(resultado)) - cuanto + 1
  // Más chico que un cuanto: se redondea a 0 o a ±1 cuanto (nunca se devuelve ruido crudo).
  if (cifras < 1) {
    const unCuanto = Number(`1e${cuanto}`)
    return Math.abs(resultado) * 2 < unCuanto ? 0 : Math.sign(resultado) * unCuanto
  }
  const normalizado = Number(resultado.toPrecision(Math.min(cifras, 100)))
  return Object.is(normalizado, -0) ? 0 : normalizado
}

// ════════════════════════════════════════════════════════════════════════════════════
// Consultas
// ════════════════════════════════════════════════════════════════════════════════════

const error = <T>(codigo: CodigoErrorCuantitativo, datos: Record<string, unknown>): ResultadoCuantitativo<T> => congelarProfundo({ ok: false as const, error: { codigo, datos } })
const exito = <T>(valor: T): ResultadoCuantitativo<T> => congelarProfundo({ ok: true as const, valor })

function esMagnitudRegistrada(magnitud: string): magnitud is Magnitud {
  return Object.hasOwn(MAGNITUDES, magnitud)
}

function esUnidadRegistrada(unidad: string): unidad is Unidad {
  return Object.hasOwn(UNIDADES, unidad)
}

/** Cuantitativa = magnitud registrada que no es la magnitud booleana canónica. */
function esCuantitativa(capacidad: Capacidad): boolean {
  return capacidad.magnitud !== undefined && esMagnitudRegistrada(capacidad.magnitud) && capacidad.magnitud !== MAGNITUD_BOOLEANA
}

function esCantidadDe(c: Cantidad | undefined, magnitud: string, unidad: string): boolean {
  return c !== undefined && Number.isFinite(c.valor) && c.magnitud === magnitud && c.unidad === unidad
}

function disponibilidad(capacidad: Capacidad): DisponibilidadSemantica {
  const motivos: MotivoNoDisponible[] = []
  const magnitud = capacidad.magnitud as string
  const unidad = capacidad.unidad
  if (unidad === undefined || !unidadesDeMagnitud(magnitud).includes(unidad)) motivos.push("UNIDAD_INCOMPATIBLE_CON_MAGNITUD")
  else {
    const r = capacidad.rango
    if (r !== undefined && !(esCantidadDe(r.min, magnitud, unidad) && esCantidadDe(r.max, magnitud, unidad) && r.min.valor <= r.max.valor)) motivos.push("RANGO_INVALIDO")
    const res = capacidad.resolucion
    if (res !== undefined && !(esCantidadDe(res, magnitud, unidad) && res.valor > 0)) motivos.push("RESOLUCION_INVALIDA")
  }
  return { disponible: motivos.length === 0, motivos }
}

function conversionDeclarada(catalogo: Catalogo, de: string, a: string, magnitud: string): ConversionUnidad | undefined {
  return catalogo.unidades?.conversiones.find((c) => c.de === de && c.a === a && c.magnitud === magnitud)
}

function unidadConocida(id: string): UnidadConocida {
  const u = UNIDADES[id as Unidad]
  return { id, simbolo: u.simbolo, ucum: u.ucum }
}

function describir(catalogo: Catalogo, tipo: string, capacidad: Capacidad, etiqueta: (capacidad: string) => string | undefined): CapacidadCuantitativa {
  const magnitud = capacidad.magnitud as string
  const canonica = capacidad.unidad
  const unidades: UnidadDeCapacidad[] = []
  if (canonica !== undefined && esUnidadRegistrada(canonica)) {
    unidades.push({ ...unidadConocida(canonica), canonica: true })
    for (const otra of unidadesDeMagnitud(magnitud)) {
      if (otra === canonica || !esUnidadRegistrada(otra)) continue
      if (conversionDeclarada(catalogo, canonica, otra, magnitud) && conversionDeclarada(catalogo, otra, canonica, magnitud)) unidades.push({ ...unidadConocida(otra), canonica: false })
    }
  }
  return {
    tipo,
    capacidad: capacidad.id,
    etiqueta: etiqueta(capacidad.id) ?? null,
    magnitud,
    unidadCanonica: canonica ?? "",
    unidades,
    rango: capacidad.rango ?? null,
    resolucion: capacidad.resolucion ?? null,
    disponibilidadSemantica: disponibilidad(capacidad),
  }
}

export function capacidadesCuantitativas(catalogo: Catalogo, tipo: string, etiqueta: (capacidad: string) => string | undefined): ResultadoCuantitativo<readonly CapacidadCuantitativa[]> {
  const componente = catalogo.obtenerComponente(tipo)
  if (!componente) return error("COMPONENTE_INEXISTENTE", { tipo })
  return exito(componente.capacidades.filter(esCuantitativa).map((c) => describir(catalogo, tipo, c, etiqueta)))
}

export function capacidadCuantitativa(catalogo: Catalogo, tipo: string, capacidad: string, etiqueta: (capacidad: string) => string | undefined): ResultadoCuantitativo<CapacidadCuantitativa> {
  const componente = catalogo.obtenerComponente(tipo)
  if (!componente) return error("COMPONENTE_INEXISTENTE", { tipo })
  const declarada = componente.capacidades.find((c) => c.id === capacidad)
  if (!declarada) return error("CAPACIDAD_INEXISTENTE", { tipo, capacidad })
  if (!esCuantitativa(declarada)) return error("CAPACIDAD_NO_CUANTITATIVA", { tipo, capacidad, magnitud: declarada.magnitud ?? null })
  return exito(describir(catalogo, tipo, declarada, etiqueta))
}

export function unidad(id: string): ResultadoCuantitativo<UnidadConocida> {
  return esUnidadRegistrada(id) ? exito(unidadConocida(id)) : error("UNIDAD_DESCONOCIDA", { unidad: id })
}

// ════════════════════════════════════════════════════════════════════════════════════
// Conversión (N-3: cambiar sólo la unidad conserva la CANTIDAD FÍSICA)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Convierte `cantidad` a `unidadDestino` usando SÓLO una conversión directa declarada en el
 * catálogo (nunca encadena ni inventa). La aritmética es la del núcleo (`propagarMagnitud`,
 * única fórmula del repo); acá se valida la entrada, se clasifica el error y se normaliza.
 * Misma unidad → el mismo valor, normalizado.
 */
export function convertirCantidad(catalogo: Catalogo, cantidad: CantidadFisica, unidadDestino: string): ResultadoCuantitativo<Cantidad> {
  const { valor, unidad: origen, magnitud } = cantidad
  if (typeof valor !== "number" || !Number.isFinite(valor)) return error("VALOR_NO_FINITO", { valor: String(valor) })
  if (!esMagnitudRegistrada(magnitud)) return error("MAGNITUD_DESCONOCIDA", { magnitud })
  if (!esUnidadRegistrada(origen)) return error("UNIDAD_DESCONOCIDA", { unidad: origen })
  if (!esUnidadRegistrada(unidadDestino)) return error("UNIDAD_DESCONOCIDA", { unidad: unidadDestino })
  for (const u of [origen, unidadDestino]) if (!unidadesDeMagnitud(magnitud).includes(u)) return error("UNIDAD_INCOMPATIBLE_CON_MAGNITUD", { unidad: u, magnitud })
  if (origen === unidadDestino) return exito({ valor: normalizarResultado(valor, valor), unidad: unidadDestino, magnitud })
  const conversion = conversionDeclarada(catalogo, origen, unidadDestino, magnitud)
  if (!conversion) return error("CONVERSION_NO_DECLARADA", { de: origen, a: unidadDestino, magnitud })
  const propagado = propagarMagnitud({ valor, unidad: origen, magnitud }, magnitud, unidadDestino, catalogo)
  if (!propagado.ok) return error("CONVERSION_NO_DECLARADA", { de: origen, a: unidadDestino, magnitud })
  const crudo = propagado.valor.valor
  if (!Number.isFinite(crudo)) return error("RESULTADO_NO_FINITO", { valor, de: origen, a: unidadDestino })
  const escala = Math.max(Math.abs(valor), Math.abs(valor * conversion.factor), Math.abs(conversion.offset), Math.abs(crudo))
  return exito({ valor: normalizarResultado(crudo, escala), unidad: unidadDestino, magnitud })
}

/**
 * Conversión en el contexto de una capacidad: además de lo anterior, exige que la capacidad
 * exista, sea cuantitativa, esté semánticamente disponible, que la cantidad sea de su magnitud
 * y que la unidad destino sea una de las que la capacidad ofrece.
 */
export function convertirParaCapacidad(
  catalogo: Catalogo,
  tipo: string,
  capacidad: string,
  cantidad: CantidadFisica,
  unidadDestino: string,
  etiqueta: (capacidad: string) => string | undefined,
): ResultadoCuantitativo<Cantidad> {
  const descripcion = capacidadCuantitativa(catalogo, tipo, capacidad, etiqueta)
  if (!descripcion.ok) return descripcion
  const c = descripcion.valor
  if (!c.disponibilidadSemantica.disponible) return error("CAPACIDAD_NO_DISPONIBLE", { tipo, capacidad, motivos: c.disponibilidadSemantica.motivos })
  if (cantidad.magnitud !== c.magnitud) return error("MAGNITUD_DISTINTA_DE_LA_CAPACIDAD", { tipo, capacidad, magnitud: cantidad.magnitud, esperada: c.magnitud })
  for (const u of [cantidad.unidad, unidadDestino]) {
    if (!esUnidadRegistrada(u)) return error("UNIDAD_DESCONOCIDA", { unidad: u })
    if (!c.unidades.some((x) => x.id === u)) return error("UNIDAD_NO_OFRECIDA_POR_LA_CAPACIDAD", { tipo, capacidad, unidad: u })
  }
  return convertirCantidad(catalogo, cantidad, unidadDestino)
}
