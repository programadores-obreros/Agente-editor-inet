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

export interface CuandoComportamiento {
  /** Componente.id del sensor — debe existir (verificado al cargar, R2). */
  readonly sensor: string
  /** Capacidad declarada por el catálogo del sensor (Gate 3/4 la valida). */
  readonly capacidad: string
  readonly comparador: ">" | "<" | ">=" | "<="
  readonly umbral: UmbralComportamiento
}

export interface EntoncesComportamiento {
  /** Componente.id del actuador — debe existir (verificado al cargar, R2). */
  readonly actuador: string
  readonly accion: "encender" | "apagar"
}

export interface ComportamientoRegla {
  /** "beh-<n>", mismo contador que cmp/conn. */
  readonly id: string
  readonly cuando: CuandoComportamiento
  readonly entonces: EntoncesComportamiento
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
  /** Identidad de contenido del catálogo vigente en el último commit exitoso (Gate 3/6). */
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
