// Validez ESTRUCTURAL de una `ComportamientoRegla` (parcial o completa) — Phase 3,
// vertical #1, contrato B2 (docs/programacion-intencion/PHASE_3_VERTICAL_1_CONTRACT.md).
//
// UNA sola función para las dos puertas: `operaciones.ts::validarFormaPayload`
// (`SetComportamiento`) y `cargador.ts::validarComportamiento` (carga de documento).
// Ésa es la garantía PERSISTIBLE ⇒ RECARGABLE (IR-SPEC.md §6.11): lo que la operación
// acepta, el cargador lo acepta; lo que el cargador rechaza, la operación también.
//
// Reglas (cada estado tiene UNA sola forma canónica):
// - clave AUSENTE = slot vacío; `null` explícito se rechaza;
// - un sub-objeto presente y vacío (`cuando:{}` / `entonces:{}`) se rechaza;
// - triada `capacidad` + `comparador` + `umbral`: los tres juntos o ninguno;
// - la regla tiene al menos UN slot presente;
// - claves desconocidas (regla, cuando, umbral, entonces) se rechazan;
// - todo campo presente se valida por TIPO acá. Los dominios de los enums
//   (`COMPARADORES`/`ACCIONES`) NO se comprueban acá: cada puerta los comprueba con su
//   propio código, contra el MISMO dominio normativo de `ir.ts`.
//
// Esta función nunca mira `id` (el loader lo exige, la operación lo admite ausente), ni
// referencias contra el proyecto, ni catálogo, ni finitud del umbral.

export interface FallaFormaRegla {
  /** Código existente que cada puerta traduce a su propio vocabulario. */
  readonly codigo: "CLAVE_DESCONOCIDA" | "CAMPO_REQUERIDO_FALTANTE"
  /** "cuando" | "cuando.umbral" | "entonces" (los mismos `campo` que ya emitía el loader). */
  readonly campo: string
  readonly claves?: readonly string[]
  /** Texto para `datos.razon` del rechazo de la operación. */
  readonly razon: string
}

/** Forma estructuralmente válida; `comparador`/`accion` siguen siendo `string` (su dominio lo comprueba cada puerta). */
export interface FormaReglaValida {
  readonly cuando?: {
    readonly sensor?: string
    readonly capacidad?: string
    readonly comparador?: string
    readonly umbral?: { readonly valor: number; readonly unidad: string; readonly magnitud: string }
  }
  readonly entonces?: { readonly actuador?: string; readonly accion?: string }
}

type Rechazada = { readonly ok: false; readonly falla: FallaFormaRegla }
export type ResultadoFormaRegla = { readonly ok: true; readonly valor: FormaReglaValida } | Rechazada

const CLAVES_REGLA = ["id", "cuando", "entonces"] as const
const CLAVES_CUANDO = ["sensor", "capacidad", "comparador", "umbral"] as const
const CLAVES_UMBRAL = ["valor", "unidad", "magnitud"] as const
const CLAVES_ENTONCES = ["actuador", "accion"] as const

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function desconocidas(obj: Record<string, unknown>, conocidas: readonly string[]): readonly string[] {
  return Object.keys(obj).filter((k) => !conocidas.includes(k))
}

function faltante(campo: string, razon: string): Rechazada {
  return { ok: false, falla: { codigo: "CAMPO_REQUERIDO_FALTANTE", campo, razon } }
}

function claveDesconocida(campo: string, claves: readonly string[]): Rechazada {
  return { ok: false, falla: { codigo: "CLAVE_DESCONOCIDA", campo, claves, razon: `claves desconocidas en ${campo}: ${claves.join(", ")}` } }
}

/** "Presente" = distinto de `undefined` (JSON no puede llevar `undefined`; `null` SÍ cuenta como presente y se rechaza por tipo). */
function presente(obj: Record<string, unknown>, clave: string): boolean {
  return obj[clave] !== undefined
}

function analizarCuando(cuando: unknown): { ok: true; valor: NonNullable<FormaReglaValida["cuando"]> } | Rechazada {
  if (!esObjeto(cuando)) return faltante("cuando", "comportamiento.cuando debe ser un objeto si está presente (un slot vacío es la clave ausente, nunca null)")
  const claves = desconocidas(cuando, CLAVES_CUANDO)
  if (claves.length > 0) return claveDesconocida("cuando", claves)
  if (CLAVES_CUANDO.every((k) => !presente(cuando, k))) return faltante("cuando", "comportamiento.cuando está vacío (un slot vacío es la clave ausente)")

  const { sensor, capacidad, comparador, umbral } = cuando
  if (presente(cuando, "sensor") && typeof sensor !== "string") return faltante("cuando", "comportamiento.cuando.sensor debe ser un string")

  const enTriada = [presente(cuando, "capacidad"), presente(cuando, "comparador"), presente(cuando, "umbral")]
  if (enTriada.some(Boolean) && !enTriada.every(Boolean)) {
    return faltante("cuando", "capacidad, comparador y umbral van los tres juntos o ninguno")
  }
  if (!enTriada[0]) return { ok: true, valor: presente(cuando, "sensor") ? { sensor: sensor as string } : {} }

  if (typeof capacidad !== "string" || typeof comparador !== "string") {
    return faltante("cuando", "comportamiento.cuando.capacidad y comparador deben ser strings")
  }
  if (!esObjeto(umbral)) return faltante("cuando.umbral", "comportamiento.cuando.umbral debe ser un objeto")
  const clavesUmbral = desconocidas(umbral, CLAVES_UMBRAL)
  if (clavesUmbral.length > 0) return claveDesconocida("cuando.umbral", clavesUmbral)
  if (typeof umbral.valor !== "number" || typeof umbral.unidad !== "string" || typeof umbral.magnitud !== "string") {
    return faltante("cuando.umbral", "comportamiento.cuando.umbral incompleto (se esperan valor numérico/unidad/magnitud)")
  }
  return {
    ok: true,
    valor: {
      ...(presente(cuando, "sensor") ? { sensor: sensor as string } : {}),
      capacidad,
      comparador,
      umbral: { valor: umbral.valor, unidad: umbral.unidad, magnitud: umbral.magnitud },
    },
  }
}

function analizarEntonces(entonces: unknown): { ok: true; valor: NonNullable<FormaReglaValida["entonces"]> } | Rechazada {
  if (!esObjeto(entonces)) return faltante("entonces", "comportamiento.entonces debe ser un objeto si está presente (un slot vacío es la clave ausente, nunca null)")
  const claves = desconocidas(entonces, CLAVES_ENTONCES)
  if (claves.length > 0) return claveDesconocida("entonces", claves)
  if (CLAVES_ENTONCES.every((k) => !presente(entonces, k))) return faltante("entonces", "comportamiento.entonces está vacío (un slot vacío es la clave ausente)")
  const { actuador, accion } = entonces
  if (presente(entonces, "actuador") && typeof actuador !== "string") return faltante("entonces", "comportamiento.entonces.actuador debe ser un string")
  if (presente(entonces, "accion") && typeof accion !== "string") return faltante("entonces", "comportamiento.entonces.accion debe ser un string")
  return {
    ok: true,
    valor: {
      ...(presente(entonces, "actuador") ? { actuador: actuador as string } : {}),
      ...(presente(entonces, "accion") ? { accion: accion as string } : {}),
    },
  }
}

/** Analiza la FORMA de una regla cruda (objeto ya materializado como dato plano). */
export function analizarFormaRegla(regla: Record<string, unknown>): ResultadoFormaRegla {
  const clavesRaiz = desconocidas(regla, CLAVES_REGLA)
  if (clavesRaiz.length > 0) return claveDesconocida("comportamiento", clavesRaiz)
  if (!presente(regla, "cuando") && !presente(regla, "entonces")) {
    return faltante("cuando", "la regla necesita al menos un slot presente (cuando o entonces)")
  }
  let cuando: FormaReglaValida["cuando"]
  let entonces: FormaReglaValida["entonces"]
  if (presente(regla, "cuando")) {
    const r = analizarCuando(regla.cuando)
    if (!r.ok) return r
    cuando = r.valor
  }
  if (presente(regla, "entonces")) {
    const r = analizarEntonces(regla.entonces)
    if (!r.ok) return r
    entonces = r.valor
  }
  return { ok: true, valor: { ...(cuando ? { cuando } : {}), ...(entonces ? { entonces } : {}) } }
}
