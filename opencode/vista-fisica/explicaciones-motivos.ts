// Explicación de motivos — Fase 2, Slice 2 (§3.4, HD-S2-8, A + C acotado, R-4).
//
// Tabla PURA `codigo → (datos, nombres) → string`. Sin LLM, sin inferir causas: sólo
// interpola `datos` DEL PROPIO motivo estructurado (`nucleo/motivos.ts::Motivo`) y el
// `nombreVisible` de catálogo (`nucleo/catalogo.ts:87`) que el llamador resuelve por
// `nombres`. Un código que esta tabla no conoce da `null` — el llamador
// (`snapshot-a-vista.ts`) nunca inventa un texto, y el browser muestra el código
// crudo tal cual (mismo criterio fail-closed que el resto del adaptador).
//
// Los ocho textos de acá son los APROBADOS por el HUMAN PRODUCT OWNER
// (PHASE_2_SLICE_2_DESIGN.md §3.4/§10, R-4) — no se reformulan libremente.
//
// `nombres` (un `ResolverNombreDeComponente`) es la ÚNICA vía para convertir un id
// (de instancia o de tipo de catálogo) en un nombre legible — esta tabla nunca
// importa `nucleo/catalogo-datos.ts` ni construye su propio catálogo paralelo.

/** `idOTipo`: o bien un `Componente.id` de instancia ("cmp-0"), o bien un
 * `ComponenteCatalogo.id` de tipo ("led") — el resolver decide cuál es (ver
 * `snapshot-a-vista.ts::resolverNombreDeComponente`). Nunca lanza: si no puede
 * resolver un nombre real, devuelve el propio `idOTipo` sin cambios — "no inventes:
 * usá el valor crudo disponible o el id" (briefing). */
export type ResolverNombreDeComponente = (idOTipo: string) => string

type Datos = Readonly<Record<string, unknown>>
type Plantilla = (datos: Datos, nombres: ResolverNombreDeComponente) => string

/** Valor crudo de `datos[clave]`, como string — si falta, se usa el propio NOMBRE de
 * la clave (nunca una oración inventada): no debería pasar con los ocho códigos de
 * abajo (sus `datos` siempre traen estos campos, ver `nucleo/catalogo.ts`/
 * `nucleo/validar-tecnico.ts`), pero esta función nunca lanza igual. */
function campo(datos: Datos, clave: string): string {
  const valor = datos[clave]
  return valor === undefined || valor === null ? clave : String(valor)
}

/** Como `campo`, pero además resuelve el nombre visible vía `nombres` — para
 * `{componente}`/`{ocupadoPor}`, que siempre refieren a UN componente (de instancia
 * o de tipo de catálogo, según el código — ver el comentario de cabecera). */
function nombreDe(datos: Datos, clave: string, nombres: ResolverNombreDeComponente): string {
  const valor = datos[clave]
  if (valor === undefined || valor === null) return clave
  return nombres(String(valor))
}

// ════════════════════════════════════════════════════════════════════════════════════
// Los 8 textos APROBADOS (§3.4/§10 R-4) — cita textual, sin parafrasear.
//
// Phase 3 — Pre-Human-Test Hardening, HD-W0-A (docs/programacion-intencion/
// PHASE_3_PRE_HUMAN_TEST_DESIGN.md §1) agrega una 9na entrada, `TERMINAL_NO_ASIGNABLE`
// — no es parte de los 8 textos ya aprobados por el Human Product Owner de Slice 2,
// es la explicación pedagógica nueva que esa decisión pide (fila "Explicación
// pedagógica" del diseño): mismo criterio de la tabla (`nombreDe`, nunca ids crudos),
// evitando un pronombre con género fijo (el `componente` referido puede ser masculino
// o femenino — "terminal" en español es siempre masculino, así que "lo" referido al
// terminal es correcto sin importar el componente).
// ════════════════════════════════════════════════════════════════════════════════════

const PLANTILLAS: Readonly<Record<string, Plantilla>> = {
  TERMINAL_NO_ASIGNABLE: (datos, nombres) =>
    `${nombreDe(datos, "componente", nombres)}: este terminal no se conecta directo a un pin de la placa, va en el medio del cable. Usá 'Conectar' para unirlo a la pieza que lo necesita.`,
  PIN_SIN_PULLUP_INTERNO: (datos, nombres) =>
    `El ${nombreDe(datos, "componente", nombres)} necesita la resistencia interna (pull-up) del pin, y ${campo(datos, "pin")} no la tiene: es sólo de entrada. Elegí otro pin.`,
  PIN_OCUPADO: (datos, nombres) =>
    `${campo(datos, "pin")} ya lo está usando otro componente (${nombreDe(datos, "ocupadoPor", nombres)}). Cada pin puede tener una sola conexión de señal.`,
  REQUISITO_INSATISFECHO: (datos, nombres) =>
    `Al ${nombreDe(datos, "componente", nombres)} le falta algo que necesita para funcionar sin riesgo (${campo(datos, "requisito")} en ${campo(datos, "terminal")}).`,
  PIN_STRAPPING: (datos) => `${campo(datos, "pin")} participa del arranque de la placa: puede molestar al encenderla.`,
  PIN_UART_USB: (datos) => `${campo(datos, "pin")} lo usa el USB: puede interferir con la carga del programa y con el Monitor Serie.`,
  PIN_FLASH_RESERVADO: (datos) => `${campo(datos, "pin")} está conectado a la memoria interna de la placa: no se puede usar.`,
  CAPACIDAD_PIN_INCOMPATIBLE: (datos, nombres) =>
    `${campo(datos, "pin")} no puede hacer lo que necesita el ${nombreDe(datos, "componente", nombres)} en ${campo(datos, "terminal")}.`,
  PIN_INEXISTENTE_EN_DOCUMENTO: (datos) => `${campo(datos, "pin")} no existe en esta placa. Elegí otro pin.`,
}

/**
 * `codigo` → texto llano, o `null` si el código no está en la tabla (fail-closed: el
 * browser muestra la fila cruda). `datos` es `motivo.datos`, ya combinado por el
 * llamador con `motivo.entidad` cuando corresponde (ver
 * `snapshot-a-vista.ts::datosParaExplicacion`) — esta función nunca mira `entidad`
 * directamente, sólo el objeto plano que ya le llega.
 */
export function explicacionDeMotivo(codigo: string, datos: Datos | undefined, nombres: ResolverNombreDeComponente): string | null {
  const plantilla = PLANTILLAS[codigo]
  if (!plantilla) return null
  return plantilla(datos ?? {}, nombres)
}
