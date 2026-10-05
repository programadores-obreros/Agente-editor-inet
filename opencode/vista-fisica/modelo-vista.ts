// Modelo de vista física — Phase 2, Slice 1 (ARCH-C, adaptador IR → vista).
//
// Tipos PUROS, sin DOM, sin `node:`, sin dependencia de Wokwi en runtime: son datos
// planos y serializables (JSON), construidos por `snapshot-a-vista.ts` a partir de
// `Proyecto` (IR, `nucleo/ir.ts`) + `Catalogo` (`nucleo/catalogo.ts`). Éste es el ÚNICO
// punto de dependencia hacia el núcleo desde `vista-fisica/` — nunca al revés: el
// núcleo (`opencode/nucleo/**`) no importa nada de acá (ver PHASE_2_SLICE_1_DESIGN.md
// §2.6 y la decisión de integración registrada en PHASE_2_SLICE_1_PROTOCOL.md).
//
// `Motivo`/`Readiness` se REUSAN tal cual del núcleo — la vista nunca inventa su
// propio vocabulario de error ni su propia noción de "listo".

import type { Motivo } from "../nucleo/motivos.ts"
import type { Readiness } from "../nucleo/validar.ts"

export interface PlacaVista {
  /** `Placa.id` (nucleo/placas.ts) — identidad semántica, NUNCA el tag de Wokwi. */
  readonly id: string
  /** `Placa.backends.wokwi.elemento` — dato OPACO de render (BOARD-CONTRACT §4/§6),
   * nunca una segunda identidad. */
  readonly elementoWokwi: string
  /** Cosmético (`wokwi-render-datos.ts`, portado de `circuito.ts`) — nunca afecta
   * ninguna regla eléctrica. */
  readonly escala: number
  /** Physical View UX #1: nombre para el estudiante (anexo de pedagogía), p. ej. "ESP32 DevKit". */
  readonly nombre: string
}

/**
 * Estado de UN terminal de UN componente, proyectado desde la IR + el catálogo —
 * nunca inventado. Las cuatro variantes existen porque el catálogo real (Fase 1) las
 * distingue de verdad:
 * - `asignado`: terminal `electrica: "digital"|"analogica"` CON un pin de placa
 *   asignado (`Componente.pines[terminal.id]`, `nucleo/ir.ts`). `nombreWokwiPlaca`
 *   es `null` (revisión post red-team, B1) cuando el pin asignado NO tiene
 *   representación física en el custom element Wokwi de la placa (ej. un GPIO de
 *   flash/reservado que un actor "agente" asignó directo, sin pasar por el
 *   selector) — la vista lo muestra HONESTAMENTE (el `pinSemantico` real sigue
 *   presente, nunca se oculta la asignación), nunca inventa un nombre de pin que
 *   no existe (`wokwi-render-datos.ts::nombreWokwiDePin`).
 * - `sinAsignar`: mismo tipo de terminal, sin pin todavía (`null` en la IR).
 * - `rielFijo`: terminal `electrica: "riel-fijo"` CON `Terminal.destinoFijo`
 *   declarado (ej. el cátodo del LED, GND — `catalogo-datos.ts:23`).
 * - `puente`: terminal `electrica: "riel-fijo"` SIN `destinoFijo` (ej. los dos
 *   terminales de la resistencia, `catalogo-datos.ts:40-43`: "es un puente, no tiene
 *   polaridad") — su cableado sale ÚNICAMENTE de `Proyecto.conexiones`, nunca de un
 *   destino fijo que no existe.
 *
 * `etiqueta` (Fase 3, Wave 0, F-09, PHASE_3_WAVE_0_DESIGN.md): texto de PRESENTACIÓN
 * para un humano ("ánodo (+)", "señal", "GND", "pata A"...), de la tabla de
 * `etiquetas-terminales.ts` — compartido por las CUATRO variantes (igual que
 * `nombreWokwiPieza`) porque es presentación pura, no depende de si el terminal tiene
 * pin asignado. El id crudo del terminal (`senal`, `1.l` de Wokwi, etc.) queda fuera
 * del texto primario que ve el estudiante: eso es justamente lo que F-09 cierra.
 */
export type TerminalVista =
  | { readonly estado: "asignado"; readonly pinSemantico: string; readonly nombreWokwiPlaca: string | null; readonly nombreWokwiPieza: string | null; readonly etiqueta: string }
  | { readonly estado: "sinAsignar"; readonly nombreWokwiPieza: string | null; readonly etiqueta: string }
  | { readonly estado: "rielFijo"; readonly destino: string; readonly nombreWokwiPieza: string | null; readonly etiqueta: string }
  | { readonly estado: "puente"; readonly nombreWokwiPieza: string | null; readonly etiqueta: string }

export interface ComponenteVista {
  /** `Componente.id` ("cmp-0", nucleo/ir.ts). */
  readonly id: string
  /** `Componente.tipo` — id de catálogo ("led"), un dato, nunca una rama de TS acá. */
  readonly tipo: string
  /** Fase 3, Wave 0 (F-09): `ComponenteCatalogo.nombreVisible` ("LED", "Pulsador") más
   * un ordinal ESTABLE si hay más de una instancia del MISMO tipo en el proyecto
   * ("LED", "LED 2", "LED 3"...), calculado del lado del servidor
   * (`snapshot-a-vista.ts`, en el orden de `Proyecto.componentes` — nunca
   * recalculado ni reordenado en el browser). `componente.tipo` crudo como
   * fallback si el catálogo no tiene ese tipo (mismo criterio fail-closed que el
   * resto del adaptador: nunca inventa un nombre). */
  readonly nombre: string
  /** `wokwi-render-datos.ts` — `null` si el tipo no tiene tabla de render todavía
   * (gap documentado: hoy sólo "led" la tiene; agregar un componente nuevo con
   * render es sumar una entrada a esa tabla, nunca tocar este módulo). */
  readonly elementoWokwi: string | null
  /** Presentación pura (ej. `{color:"red"}`) — Fase 1 no modela color como dato
   * semántico; ver `wokwi-render-datos.ts`. */
  readonly atributos: Readonly<Record<string, string>>
  /** Fase 2, Slice 2 (§3.3, HD-S2-7): "entrada" | "salida" | `null`, derivado de
   * `ComponenteCatalogo.clase` (`nucleo/catalogo.ts:88`) por una función PURA del
   * lado del servidor (`snapshot-a-vista.ts::rolDeClase`) — aditivo, nunca afecta
   * ninguna regla eléctrica ni de validación. `null` para `clase: "pasivo"` (la
   * resistencia) y para cualquier `clase` que la función no reconozca todavía: el
   * browser (`plan-de-pintado.js`/`pintar.js`) sólo capitaliza este texto YA
   * resuelto, nunca mira `tipo` ni ninguna clase de catálogo por su cuenta. */
  readonly rol: "entrada" | "salida" | null
  /** `terminal.id` (catálogo) → su estado proyectado. Incluye SIEMPRE los terminales
   * riel-fijo del catálogo (el cátodo del LED nunca falta acá, aunque
   * `Componente.pines` ni siquiera tenga esa clave — `operaciones.ts`,
   * `terminalesNoRielFijo`). */
  readonly terminales: Readonly<Record<string, TerminalVista>>
  /**
   * PFX-1 (RED-PHT-PHYSICAL-TRUTH F1, criterio pedagógico del diseño §2 — verificado
   * real en Chromium): `Componente.id` del ancla con la que esta pieza tiene que
   * dibujarse en el MISMO contenedor (fila), ella primero — SÓLO cuando esta
   * instancia es la resistencia de una fusión HD-W0-B
   * (`snapshot-a-vista.ts::resolverFusionesSerie`/`reordenarParaAdyacencia`); `null`
   * para TODO lo demás (el ancla misma, cualquier componente sin fusión, una
   * resistencia huérfana o ambigua). Puramente de PRESENTACIÓN — nunca afecta
   * `cables`/`gpiosDisponibles`/`motivos`. `plan-de-pintado.js`/`pintar.js` sólo
   * OBEDECEN este dato (lo agrupan si viene seteado); nunca deciden de nuevo cuál
   * pieza va con cuál. */
  readonly agrupadoCon: string | null
  /**
   * Physical View UX #1: zona del esquema. `entrada`/`salida` salen de la `clase` del
   * catálogo (`rolDeClase`); una pieza que existe por el REQUISITO de otra (la
   * resistencia en serie de un LED, `agrupadoCon`) va a la zona de esa otra; lo demás
   * va a `otras`. Nunca se omite una pieza: siempre tiene zona.
   */
  readonly zona: "entrada" | "salida" | "otras"
  /** Physical View UX #1: para qué está la pieza, si existe por un requisito de otra
   * (anexo de pedagogía, `explicacionDeRequisito`). `null` si no hay nada que explicar. */
  readonly explicacion: string | null
}

/**
 * Fase 2, Slice 2 (§3.4, HD-S2-8): un `Motivo` del núcleo, MÁS una explicación en
 * texto llano — aditivo, calculado SÓLO del lado del servidor
 * (`explicaciones-motivos.ts`, vía `snapshot-a-vista.ts`). La vista NUNCA reinventa
 * `codigo`/`categoria`/`severidad`/`clasificacion`/`entidad`/`datos`: los reusa TAL
 * CUAL de `nucleo/motivos.ts::Motivo`, exactamente como ya hacía antes de este
 * campo. `explicacion: null` cuando el código no está en la tabla de
 * `explicaciones-motivos.ts` — el browser muestra la fila cruda tal cual (mismo
 * criterio fail-closed que el resto del adaptador).
 */
export type MotivoVista = Motivo & { readonly explicacion: string | null }

/** Un extremo de un cable esquemático — nunca un punto geométrico (eso queda fuera
 * del slice, PHASE_2_SLICE_1_DESIGN.md §2.6/§3.4 de ARCH-C). `nombreWokwi` de
 * `pinPlaca` es `string | null` (revisión post red-team, B1) por el mismo motivo que
 * `TerminalVista.asignado.nombreWokwiPlaca` — ver esa nota. */
export type ExtremoCableVista =
  | { readonly tipo: "pinPlaca"; readonly pinSemantico: string; readonly nombreWokwi: string | null }
  | {
      readonly tipo: "terminal"
      readonly componente: string
      readonly terminal: string
      readonly nombreWokwi: string | null
      /** Physical View UX #1: pines de la pieza que son el MISMO nodo que `nombreWokwi`
       * (anexo de representación). El esquema elige el del lado de su destino. Siempre
       * empieza por `nombreWokwi` (o es `[]` si no hay ancla). */
      readonly anclasWokwi: readonly string[]
    }
  | {
      readonly tipo: "rielFijo"
      readonly destino: string
      /** Physical View UX #1: a qué terminal de potencia de la placa va ese riel, resuelto
       * por `ComponentKnowledge.resolverDestino` (D-05: físicamente conectable, nunca un
       * GPIO asignable), con su etiqueta pedagógica y los pines de la pieza Wokwi de la
       * placa que lo representan. `null` si no hay placa o no resuelve. */
      readonly potencia: { readonly id: string; readonly etiqueta: string; readonly anclasWokwi: readonly string[] } | null
    }

export interface CableVista {
  readonly id: string
  readonly desde: ExtremoCableVista
  readonly hasta: ExtremoCableVista
  /** Physical View UX #1: a qué grupo del esquema pertenece este cable (id del componente
   * ancla: el LED para el camino GPIO→resistencia→LED→GND). Sirve para resaltar el
   * camino completo; es identidad del proyecto, no una nueva. */
  readonly camino: string | null
}

export interface OpcionGpioVista {
  /** `RegistroPin.id` ("GPIO5") — lo que entiende el motor/la IR. */
  readonly pinSemantico: string
  /** Nombre real del pin en el custom element Wokwi de la PLACA ("D5") — SIEMPRE un
   * pin que existe de verdad en el renderer (revisión post red-team, B1:
   * `snapshot-a-vista.ts::gpiosCandidatosPara` sólo ofrece un GPIO si, ADEMÁS de
   * pasar `asignarPin()`, `wokwi-render-datos.ts::nombreWokwiDePin` le da un nombre
   * real, no `null`) — nunca `string | null` acá: un candidato SIN representación
   * física simplemente no aparece en esta lista. */
  readonly nombreWokwi: string
}

/**
 * Salida de `proyectarVista`/`vistaDeProyectoConCatalogoReal` — todo dato plano,
 * determinista, serializable. Nunca referencias compartidas con el `Proyecto`/
 * `Catalogo` de entrada (los consumidores pueden mutarla sin que le vuelva al
 * canónico del motor).
 */
export interface ModeloDeVista {
  /** `null` = todavía no se eligió placa (`Proyecto.placa === null`). */
  readonly placa: PlacaVista | null
  readonly componentes: readonly ComponenteVista[]
  /** Generados SÓLO a partir de asignaciones (pin↔terminal) y de
   * `Proyecto.conexiones` (terminal↔terminal) — nunca de un pin/riel hardcodeado. */
  readonly cables: readonly CableVista[]
  /** `componente.id` → `terminal.id` → candidatos, sólo para terminales que NO son
   * riel-fijo. Cada candidato ya pasó `asignarPin()` (`nucleo/catalogo.ts`) — la
   * vista consulta esa única regla, nunca la reimplementa (ver el límite conocido en
   * `wokwi-render-datos.ts`/`snapshot-a-vista.ts` sobre `RegistroPin.restricciones`).
   * Revisión post red-team (B1): además, sólo quedan los candidatos con un nombre
   * Wokwi REAL confirmado — la intersección Engine∩pin-físico-del-renderer, nunca
   * una regla eléctrica nueva (es que NO SE PUEDE DIBUJAR un cable a un pin que no
   * existe en la pieza, una restricción de presentación). */
  readonly gpiosDisponibles: Readonly<Record<string, Readonly<Record<string, readonly OpcionGpioVista[]>>>>
  /** Tal cual `validarProyecto()` los produjo (mismo orden estable,
   * `nucleo/motivos.ts::compararMotivos`) — la vista NUNCA inventa una causa nueva ni
   * reclasifica severidad/clasificación. Fase 2, Slice 2: cada motivo lleva además
   * `explicacion` (`MotivoVista`, aditivo) — ver ese tipo. */
  readonly motivos: readonly MotivoVista[]
  /** Tal cual `derivarReadiness()` — la vista nunca decide por su cuenta si el
   * proyecto está "listo". */
  readonly readiness: Readiness
  /** Phase 3, vertical #1 (contrato B6): una entrada por regla del IR, en el orden de
   * `Proyecto.comportamientos`. Aditivo. */
  readonly reglas: readonly ReglaVista[]
  /** Phase 3, vertical #1: qué puede elegir la frase editable, derivado del catálogo. */
  readonly opcionesRegla: OpcionesReglaVista
  /** Physical View UX #1: las zonas del esquema físico, en orden de lectura (entrada →
   * controlador → salida → otras), con sus textos del anexo de pedagogía. `otras` sólo
   * aparece si hay alguna pieza ahí. Vacío si el proyecto no tiene placa ni piezas. */
  readonly zonas: readonly ZonaVista[]
}

/** `id` = valor (nunca se muestra); `etiqueta` = nombre humano con ordinal estable ("LED 2"). */
export interface ReferenciaVista {
  readonly id: string
  readonly etiqueta: string
}

export interface OpcionVista {
  readonly clave: string
  readonly etiqueta: string
}

/** Opción del slot "estado": `condicion` es el payload canónico que el navegador copia tal cual
 * al armar la regla entera (el navegador no conoce capacidades ni comparadores). */
export interface OpcionEstadoVista extends OpcionVista {
  readonly condicion: {
    readonly capacidad: string
    readonly comparador: string
    readonly umbral: { readonly valor: number; readonly unidad: string; readonly magnitud: string }
  }
}

/** Opción del slot "salida": `accion` es el valor que el navegador copia a `entonces.accion`. */
export interface OpcionSalidaVista extends OpcionVista {
  readonly accion: string
}

/** Los cuatro slots de la frase "Mientras el <sensor> esté <estado>, el <actuador> está <salida>."
 * Un slot AUSENTE = vacío. `estado.clave: "avanzada"` = cualquier condición que no es
 * exactamente "presionado" (la frase no la edita, sólo la nombra). */
export interface FraseReglaVista {
  readonly sensor?: ReferenciaVista
  /** Semantic Vertical #3: `clave` = rótulo del estado de la entrada (anexo de pedagogía:
   * "presionado"/"suelto") o "avanzada". Es un identificador de la vista; la semántica
   * es la tríada canónica (`nucleo/estado-booleano.ts`), nunca este texto. */
  readonly estado?: { readonly clave: string; readonly etiqueta: string }
  readonly actuador?: ReferenciaVista
  /** Semantic Vertical #3: `clave` = rótulo del estado objetivo ("encendido"/"apagado"),
   * identificador de la vista; la semántica es `entonces.accion`. */
  readonly salida?: { readonly clave: string; readonly etiqueta: string }
  /** Numeric Conditions S1: partes de una condición NUMÉRICA reconocida (sólo con el contrato
   * cuantitativo de Component Knowledge, CK-REQ-N1). `clave` es el valor que viaja en una edición
   * (id de capacidad, comparador del dominio, número, id de unidad); `etiqueta`, lo que se lee. */
  readonly capacidad?: { readonly clave: string; readonly etiqueta: string }
  readonly comparador?: { readonly clave: string; readonly etiqueta: string }
  readonly valor?: { readonly clave: string; readonly etiqueta: string }
  readonly unidad?: { readonly clave: string; readonly etiqueta: string }
}

/** Explicación textual determinista de una regla completa con la condición "presionado".
 * NO es una simulación ni un runtime. El reposo apagado es el contrato derivado (HD-P3D-1). */
export interface TrazaReglaVista {
  readonly etiqueta: string
  readonly ramas: readonly string[]
  readonly nota?: string
}

export interface ReglaVista {
  readonly id: string
  readonly frase: FraseReglaVista
  /** Oración en texto llano; `null` salvo regla completa con la condición canónica "presionado". */
  readonly texto: string | null
  readonly completa: boolean
  /** `COMPORTAMIENTO_INCOMPLETO.datos.faltan` (fuente única: el validador), `[]` si completa. */
  readonly faltan: readonly string[]
  /** Los motivos cuya entidad es esta regla. */
  readonly motivos: readonly MotivoVista[]
  readonly traza?: TrazaReglaVista
  /** La regla guardada (sin `id`), tal cual está en el IR: el navegador la reenvía ENTERA
   * (con un slot cambiado) en cada edición — un único `SetComportamiento`. */
  readonly forma: { readonly cuando?: unknown; readonly entonces?: unknown }
  /** Nota para una condición avanzada (la frase sólo edita "presionado"); `null` en cualquier otro caso. */
  readonly aviso: string | null
  /** Numeric Conditions S1: los slots de ESTA regla cuando no son los globales (opciones que
   * dependen del sensor elegido). Ausente = usar `opcionesRegla.slots`. */
  readonly slots?: readonly SlotFraseVista[]
  /** Numeric Conditions S1 (N-6): ayuda contextual que NO es parte de la frase («Mide de X a Y.»). */
  readonly ayuda?: string
}

/** Una opción de un slot de la frase. `parche` es lo que esa opción le agrega a la regla guardada
 * (`cuando`/`entonces` parciales): el navegador lo mezcla sin saber qué significa. */
export interface OpcionSlotVista {
  readonly valor: string
  readonly etiqueta: string
  readonly parche: { readonly cuando?: Readonly<Record<string, unknown>>; readonly entonces?: Readonly<Record<string, unknown>> }
  /** Numeric Conditions S1 (N-10): `true` = el `cuando` del parche REEMPLAZA al guardado en vez de
   * mezclarse (cambiar a un sensor que no declara la capacidad de la regla deja sólo el sensor). */
  readonly reemplazaCuando?: boolean
}

/** Un slot de la frase, en orden: `prefijo` es el texto fijo que va antes del selector. */
export interface SlotFraseVista {
  readonly slot: "sensor" | "estado" | "actuador" | "salida" | "capacidad" | "comparador" | "valor" | "unidad"
  readonly prefijo: string
  readonly opciones: readonly OpcionSlotVista[]
  /** Numeric Conditions S1: parte del bloque «mientras» (`cuando`) o del «hacer» (`entonces`). */
  readonly grupo?: "cuando" | "entonces"
  /** Numeric Conditions S1: `"numero"` = valor libre (no una opción). El navegador sólo lo
   * interpreta como número y lo coloca en `destino` (camino dentro de la regla); el Engine decide. */
  readonly tipo?: "opciones" | "numero"
  readonly destino?: readonly string[]
  /** Numeric Conditions S2: el slot es parte de un GRUPO que la IR sólo acepta completo (la
   * tríada de la condición). Mientras el grupo no esté completo, lo elegido vive en un borrador
   * efímero del navegador; nunca llega al Engine por partes. */
  readonly grupoAtomico?: string
  /** Numeric Conditions S2: valor elegido de antemano porque la fuente normativa lo declara (p.
   * ej. la única capacidad disponible). Nunca un valor semántico inventado. */
  readonly predeterminado?: string
  /** Numeric Conditions S2: las opciones de este slot dependen del valor de OTRO slot del grupo
   * (`depende`): una lista, con su predeterminado, por cada valor posible de ese slot. */
  readonly opcionesPor?: { readonly depende: string; readonly listas: Readonly<Record<string, { readonly opciones: readonly OpcionSlotVista[]; readonly predeterminado?: string }>> }
  /** Numeric Conditions S2 (OD-2): si el valor de este slot cambia en el borrador, estos otros
   * slots del grupo se vacían (p. ej. cambiar la unidad vacía el número). */
  readonly vaciaAlCambiar?: readonly string[]
}

export interface OpcionesReglaVista {
  /** Los cuatro slots de la frase, en orden, con sus opciones y parches (fuente única para el navegador). */
  readonly slots: readonly SlotFraseVista[]
  readonly sensores: readonly ReferenciaVista[]
  readonly estados: readonly OpcionEstadoVista[]
  readonly actuadores: readonly ReferenciaVista[]
  readonly salidas: readonly OpcionSalidaVista[]
}

/** Physical View UX #1: una zona del esquema físico (texto del anexo de pedagogía). */
export interface ZonaVista {
  readonly rol: "entrada" | "controlador" | "salida" | "otras"
  readonly titulo: string
  readonly descripcion: string
}
