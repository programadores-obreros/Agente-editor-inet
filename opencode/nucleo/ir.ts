// IR mínima — Gate 2 de "Programación por Intención".
//
// Tipos puros, sin I/O, sin dependencia de ningún runtime (Node/Bun). Traducidos al
// español rioplatense per T_diseno_consolidado.md §0/§2 (decisión OD-01, ya registrada
// en docs/programacion-intencion/DECISIONS.md).
//
// `ComportamientoRegla` es la versión MÍNIMA que R1 (reconciliación del orquestador)
// exige para que `CambiarComponente` (Gate 5) tenga algo persistido contra qué correr
// `reemplazarSensor` (Gate 3): nada de Blockly, nada de eventos/temporizadores, nada de
// expresiones compuestas — ver T_diseno_consolidado.md §2.4.

export interface Componente {
  /** "cmp-<n>", nunca reusado (contador único en Proyecto.siguienteIdLocal). */
  readonly id: string
  /** Id de catálogo (Gate 3). Un dato, nunca una rama de TypeScript acá. */
  readonly tipo: string
  /** terminal → pin de placa (referencia a `RegistroPin.id` de placas.ts) | null = incompleto. */
  readonly pines: Readonly<Record<string, string | null>>
  /** Bolsa abierta; el catálogo (Gate 3/4) valida forma y rango, la IR no. */
  readonly propiedades: Readonly<Record<string, unknown>>
}

export interface ExtremoConexion {
  readonly componente: string
  readonly terminal: string
}

export interface Conexion {
  /** "conn-<n>". */
  readonly id: string
  readonly desde: ExtremoConexion
  readonly hasta: ExtremoConexion
}

export interface UmbralComportamiento {
  readonly valor: number
  readonly unidad: string
  readonly magnitud: string
}

// Phase 1.2 (hallazgo externo REA-01, CRÍTICO — re-auditoría externa,
// PHASE_1_1_REGAUDIT_FINDINGS.md): `comparador`/`accion` son uniones LITERALES en
// TypeScript ("sintaxis borrable" — sin protección en runtime), pero ANTES de este
// fix el dominio real (los 4/2 valores de abajo) sólo existía como un `Set` LOCAL,
// privado, dentro de `cargador.ts` — nada obligaba a `operaciones.ts` (Gate 5,
// `aplicarSetComportamiento`) a usar el MISMO dominio. Resultado: una operación podía
// aceptar y commitear un valor sintácticamente válido pero INVENTADO
// (`comparador:"mayorQue"`), y recién `cargador.ts` lo rechazaba AL RECARGAR — un
// documento PERSISTIBLE que no era RECARGABLE (ver
// `docs/programacion-intencion/IR-SPEC.md`, invariante "PERSISTIBLE ⇒ RECARGABLE").
// Estas dos constantes son la ÚNICA definición normativa de ambos dominios —
// `cargador.ts` (Gate 2) y `operaciones.ts` (Gate 5) las IMPORTAN, ninguno de los dos
// vuelve a declarar su propia lista. Los dos tipos de abajo (`Comparador`/`Accion`) se
// DERIVAN de estas constantes (nunca al revés) para que agregar un valor nuevo sólo
// tenga un lugar de edición.
export const COMPARADORES = [">", "<", ">=", "<="] as const
export type Comparador = (typeof COMPARADORES)[number]

/** Mismo criterio que `COMPARADORES` — ver comentario de arriba. */
export const ACCIONES = ["encender", "apagar"] as const
export type Accion = (typeof ACCIONES)[number]

// Phase 3 (vertical #1, contrato B2): una regla puede estar INCOMPLETA y seguir siendo
// representable. `cuando?`/`entonces?` son slots opcionales y, dentro de cada uno, cada
// campo es opcional por slot semántico (sensor | estado = capacidad+comparador+umbral |
// actuador | salida = accion). Clave AUSENTE = slot vacío (nunca `null`); un sub-objeto
// presente y vacío no es válido. La completitud NO se guarda: es un diagnóstico derivado
// (validador). La forma es un superconjunto aditivo: toda regla completa anterior sigue
// siendo válida y `schemaVersion` no cambia. La validez estructural vive en
// `regla-forma.ts` (una sola función para la operación y el cargador).

/**
 * Condición de NIVEL (el nombre `cuando` es heredado del IR; la semántica es "mientras").
 * Significado: en todo instante en que "sensor está en el estado" es verdadero, el
 * actuador ESTÁ en `entonces.accion`. No hay eventos, flancos, latch ni memoria.
 * La triada `capacidad` + `comparador` + `umbral` va completa o ausente.
 */
export interface CuandoComportamiento {
  /** Componente.id del sensor — debe existir (verificado al cargar, R2). */
  readonly sensor?: string
  /** Capacidad declarada por el catálogo del sensor (Gate 3/4 la valida). */
  readonly capacidad?: string
  readonly comparador?: Comparador
  readonly umbral?: UmbralComportamiento
}

export interface EntoncesComportamiento {
  /** Componente.id del actuador — debe existir (verificado al cargar, R2). */
  readonly actuador?: string
  /**
   * Estado SOSTENIDO del actuador mientras la condición de nivel es verdadera (no una
   * acción puntual). Estado de REPOSO (condición falsa, HD-P3D-1): apagado — es
   * DERIVADO de este contrato, nunca se guarda en el IR.
   */
  readonly accion?: Accion
}

export interface ComportamientoRegla {
  /** "beh-<n>", mismo contador que cmp/conn. */
  readonly id: string
  readonly cuando?: CuandoComportamiento
  readonly entonces?: EntoncesComportamiento
}

export interface MetadataProyecto {
  /** Única auditoría humana, se fija una sola vez en `crearProyecto` y nunca se reescribe. */
  readonly creadoEn: string
}

export interface Proyecto {
  readonly id: string
  readonly schemaVersion: string
  /** Legible por humanos (§11 del brief). Ver `catalogoHash` para identidad de contenido. */
  readonly catalogoVersion: string
  /** createdWith (Component System Foundation #1, D-03): identidad SEMÁNTICA del
   * catálogo con el que se CREÓ el proyecto. Inmutable: ni la carga, ni el commit, ni
   * una revalidación o migración futura la reescriben. El catálogo activo se expone en
   * runtime (`Snapshot.catalogoActivo`), no acá. */
  readonly catalogoHash: string
  /** Monotónica, sube +1 sólo en commit (Gate 6), nunca por operación individual dentro de un lote. */
  readonly revision: number
  /** Contador persistido para ids locales (cmp/conn/beh) — vive EN el proyecto, no en el motor. */
  readonly siguienteIdLocal: number
  /** Referencia semántica a `Placa.id` (placas.ts, Gate 1). `null` = todavía no elegida. */
  readonly placa: string | null
  readonly componentes: readonly Componente[]
  readonly conexiones: readonly Conexion[]
  readonly comportamientos: readonly ComportamientoRegla[]
  readonly metadata: MetadataProyecto
}
