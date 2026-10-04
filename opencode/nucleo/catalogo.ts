// Catálogo — Gate 3 de "Programación por Intención".
//
// Tipos + reglas GENÉRICAS del core, traducidos de D_catalog_design.md y
// T_diseno_consolidado.md §4. Puro, sin I/O: el hashing real de catálogo vive
// ÚNICAMENTE en `adaptadores/hash-catalogo.node.ts` (único import de `node:crypto`),
// inyectado acá como `(texto: string) => string` — este archivo NUNCA importa
// `node:crypto` directo (R4).
//
// Las reglas (`evaluarRequisito`, `asignarPin`, `propagarMagnitud`, `validarConexion`,
// `reemplazarSensor`) despachan SIEMPRE por `tipo`/`rol`/`clase` genérico — nunca por
// id de componente. Es lo que permite el test
// `catalogo-sin-cambio-de-core-al-agregar-componente`: un componente sintético nuevo,
// agregado sólo como DATO en `catalogo-datos.ts` (o un fixture de test), se procesa
// sin tocar ningún `.ts` de este módulo.

import type { Placa, RegistroPin, Restriccion } from "./placas.ts"
import type { ComportamientoRegla } from "./ir.ts"
import type { Motivo } from "./motivos.ts"
import { canonicalizar, clonarProfundo, congelarProfundo } from "./canonico.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos (T_diseno_consolidado.md §4.1)
// ════════════════════════════════════════════════════════════════════════════════════

// Component System Foundation #1 (D-03/D-05 del Decision Freeze): `resistencia`/`ohm`
// para el valor del requisito del LED como `Cantidad` (nunca un número suelto) y
// `tension`/`volt` para los terminales de potencia de la placa.
export type Magnitud = "temperatura" | "distancia" | "humedad" | "estadoBooleano" | "porcentaje" | "resistencia" | "tension"
export type Unidad = "celsius" | "fahrenheit" | "cm" | "porcentaje" | "ninguna" | "ohm" | "volt"

export interface Cantidad {
  readonly valor: number
  readonly unidad: Unidad
  readonly magnitud: Magnitud
}

export interface Rango {
  readonly min: Cantidad
  readonly max: Cantidad
}

export type DestinoFijo = "V5" | "V3" | "VLOGICA" | "GND" | "SDA" | "SCL" | { readonly externo: string }

/**
 * Terminal tal como lo DECLARAN los datos (`catalogo-datos.ts`, fixtures). No trae
 * `asignable`: eso no es dato fuente, se deriva una sola vez en `construirCatalogo`
 * (D-04 del Decision Freeze) — ver `Terminal`, abajo.
 */
export interface TerminalDatos {
  readonly id: string
  readonly rol: "alimentacion" | "tierra" | "senal" | "anodo" | "catodo"
  readonly electrica: "digital" | "analogica" | "riel-fijo"
  readonly requierePwm?: boolean
  readonly destinoFijo?: DestinoFijo
  /**
   * Dato declarativo del catálogo (D5/H-4, `PHASE_2_SLICE_1_HARDENING_DESIGN.md` §1-2):
   * este terminal necesita un pull-up (o pull-down) INTERNO del pin para leer bien —
   * hoy sólo `pulsador.senal` lo declara (`catalogo-datos.ts`, INPUT_PULLUP,
   * `circuito.ts:1104`). Lo consume `evaluarRestriccionesPin` (más abajo): combinado
   * con `RegistroPin.restricciones.includes("soloEntrada")` (esos pines NO tienen
   * pull-up/pull-down real, `circuito.ts:339-343`) emite `PIN_SIN_PULLUP_INTERNO`.
   * `undefined`/`false` es "no lo necesita" (default) — nunca se infiere del `rol` ni
   * del nombre del componente, sólo del dato explícito del catálogo.
   */
  readonly requierePullUpInterno?: boolean
  /**
   * Sentido eléctrico real del terminal — NO se infiere del `rol` (un rol es un
   * nombre de dominio, no una propiedad eléctrica): un ánodo de LED necesariamente
   * empuja corriente ("salida"), pero un terminal "senal" puede ser cualquiera de
   * las tres según el componente (un pulsador LEE, un DHT22 también LEE por su pin
   * DATA). Sin declarar esto, `asignarPin` no puede distinguir "GPIO34 sirve para
   * leer un sensor" de "GPIO34 sirve para prender un LED" — y GPIO34 sólo sirve
   * para lo primero (circuito.ts: GPIO_SOLO_ENTRADA, Gate 1). `undefined` en un
   * terminal `riel-fijo` es correcto: no se le asigna un pin, va directo al riel.
   */
  readonly direccion?: "entrada" | "salida" | "bidireccional"
}

/**
 * Terminal tal como lo EXPONE un catálogo construido. `asignable` es la ÚNICA
 * derivación autorizada (D-04): `true` si el terminal acepta `AsignarPin` (un GPIO
 * lógico). Ningún consumidor vuelve a interpretar `electrica` por su cuenta — leen
 * este campo (o la fachada `conocimiento/`).
 *
 * `asignable: false` NO significa "no se puede conectar": un terminal `riel-fijo` es
 * físicamente real y se conecta (a un terminal de potencia de la placa o con
 * `Conectar`); lo que no tiene es un GPIO lógico propio. Físicamente conectable ≠
 * lógicamente asignable (D-05).
 */
export interface Terminal extends TerminalDatos {
  readonly asignable: boolean
}

/** La regla única de D-04. Sólo la usa `construirCatalogo`. */
function derivarAsignable(terminal: TerminalDatos): boolean {
  return terminal.electrica !== "riel-fijo"
}

export interface Capacidad {
  readonly id: string
  readonly magnitud?: Magnitud
  readonly unidad?: Unidad
  readonly rango?: Rango
  readonly resolucion?: Cantidad
}

/**
 * Relación determinista declarada por un componente (D-12/§4 del modelo normativo).
 * `spec.valor`, cuando existe, es una `Cantidad` (p. ej. 220 ohm), nunca un número
 * suelto. Un tipo de requisito sin evaluador en `evaluarRequisito` queda como
 * "no verificado por el motor" en la admisión (nunca se finge que se valida).
 */
export interface Requisito {
  readonly tipo: "resistencia-serie" | "capacidad-pin" | "resistencia-pull" | "componente-auxiliar"
  readonly enTerminal?: string
  readonly spec: Readonly<Record<string, unknown>> & { readonly tipoComponente?: string; readonly valor?: Cantidad }
}

/**
 * Componente tal como lo declaran los datos. Sin nombres visibles ni textos: eso es
 * pedagogía y vive en el anexo `conocimiento/anexos/pedagogia-es-AR.ts` (D-10). Sin
 * datos de renderer: anexo de representación (D-09).
 */
export interface ComponenteDatos {
  readonly id: string
  readonly clase: "sensor" | "actuador" | "pasivo" | "entrada"
  readonly terminales: readonly TerminalDatos[]
  readonly capacidades: readonly Capacidad[]
  readonly requisitos: readonly Requisito[]
  /** D-11: acciones que ESTE actuador ofrece (ids de `DEFINICIONES_ACCION`). */
  readonly acciones?: readonly string[]
  readonly compatibilidades?: { readonly placas?: readonly string[] }
}

/** Componente tal como lo expone un catálogo construido (terminales con `asignable`). */
export interface ComponenteCatalogo extends Omit<ComponenteDatos, "terminales"> {
  readonly terminales: readonly Terminal[]
}

/**
 * D-11: registro global de DEFINICIONES de acción. Cada actuador declara cuáles ofrece
 * (`ComponenteDatos.acciones`); una acción es aplicable a un componente si y sólo si su
 * tipo la declara. Sin parámetros todavía (servo y similares: pendiente ON-04).
 */
export interface DefinicionAccion {
  readonly id: string
}

export const DEFINICIONES_ACCION: readonly DefinicionAccion[] = [{ id: "encender" }, { id: "apagar" }]

export interface ConversionUnidad {
  readonly de: Unidad
  readonly a: Unidad
  readonly magnitud: Magnitud
  /** factor multiplicativo + offset: destino = valor*factor + offset (°F = °C*1.8+32). */
  readonly factor: number
  readonly offset: number
}

export interface Catalogo {
  readonly version: string
  readonly hash: string
  readonly componentes: readonly ComponenteCatalogo[]
  readonly placas: readonly Placa[]
  readonly unidades?: { readonly conversiones: readonly ConversionUnidad[] }
  obtenerComponente(tipo: string): ComponenteCatalogo | undefined
  tienePlaca(id: string): boolean
  pinesDePlaca(id: string): readonly RegistroPin[] | undefined
}

// ════════════════════════════════════════════════════════════════════════════════════
// Construcción — datos declarativos + hasher inyectado → Catalogo con métodos
// ════════════════════════════════════════════════════════════════════════════════════

export interface DatosCatalogo {
  readonly version: string
  readonly componentes: readonly ComponenteDatos[]
  readonly placas: readonly Placa[]
  readonly unidades?: { readonly conversiones: readonly ConversionUnidad[] }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Identidad semántica del catálogo (D-03 del Decision Freeze)
// ════════════════════════════════════════════════════════════════════════════════════
//
// `catalogoHash` representa lo que un proyecto SIGNIFICA, no cómo se muestra. Se
// calcula sobre una proyección con LISTA BLANCA explícita: un campo nuevo que alguien
// agregue a los datos NO entra al hash hasta que se lo agregue acá a propósito. Así un
// dato de presentación no puede colarse por accidente.
//
// ENTRA: ids de tipo, clase, terminales (rol, eléctrica, dirección, requisitos de pin,
// destinoFijo) con su `asignable` derivado, capacidades con magnitud/unidad/rango,
// requisitos con su `Cantidad`, acciones declaradas, compatibilidades, placas (pines
// con capacidades/restricciones/pool, terminales de potencia, destinos de riel, i2c,
// tensión lógica, tope ADC, schemaVersion), conversiones de unidad y definiciones de
// acción.
//
// NO ENTRA: nombres visibles y textos (anexo de pedagogía), alias de entrada,
// etiquetas serigrafiadas de pin, datos de renderer (anexo de representación),
// backend de compilación (PlatformIO: toolchain, no significado), procedencia,
// madurez, y la etiqueta `version` (legible; la identidad es el hash).

function sinIndefinidos<T extends Record<string, unknown>>(objeto: T): Partial<T> {
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(objeto)) if (valor !== undefined) salida[clave] = valor
  return salida as Partial<T>
}

function proyeccionSemanticaTerminal(terminal: TerminalDatos): unknown {
  return sinIndefinidos({
    id: terminal.id,
    rol: terminal.rol,
    electrica: terminal.electrica,
    direccion: terminal.direccion,
    requierePwm: terminal.requierePwm,
    requierePullUpInterno: terminal.requierePullUpInterno,
    destinoFijo: terminal.destinoFijo,
    asignable: derivarAsignable(terminal),
  })
}

function proyeccionSemanticaPlaca(placa: Placa): unknown {
  return {
    id: placa.id,
    schemaVersion: placa.schemaVersion,
    voltaje: placa.voltaje,
    adcMax: placa.adcMax,
    i2c: placa.i2c,
    pines: placa.pines.map((pin) => ({ id: pin.id, banco: pin.banco, numero: pin.numero, capacidades: pin.capacidades, restricciones: pin.restricciones, enPoolAutomatico: pin.enPoolAutomatico })),
    // `?? []`: fixtures de test viejos (placas sintéticas) pueden no declararlos.
    terminalesDePotencia: (placa.terminalesDePotencia ?? []).map((t) => sinIndefinidos({ id: t.id, rol: t.rol, tension: t.tension })),
    destinosDeRiel: placa.destinosDeRiel,
  }
}

/** La proyección exacta que identifica al catálogo semántico (exportada para tests). */
export function proyeccionSemanticaCatalogo(datos: DatosCatalogo): unknown {
  return {
    componentes: datos.componentes.map((c) =>
      sinIndefinidos({
        id: c.id,
        clase: c.clase,
        terminales: c.terminales.map(proyeccionSemanticaTerminal),
        capacidades: c.capacidades,
        requisitos: c.requisitos,
        acciones: c.acciones,
        compatibilidades: c.compatibilidades,
      }),
    ),
    placas: datos.placas.map(proyeccionSemanticaPlaca),
    unidades: datos.unidades,
    acciones: DEFINICIONES_ACCION,
  }
}

/** JSON canónico de la identidad SEMÁNTICA del catálogo (R4: sin el campo `hash`). */
export function canonicalizarCatalogo(datos: DatosCatalogo): string {
  return canonicalizar(proyeccionSemanticaCatalogo(datos))
}

export function construirCatalogo(datos: DatosCatalogo, hasher: (texto: string) => string): Catalogo {
  const hash = hasher(canonicalizarCatalogo(datos))

  // Phase 1.1 (hallazgo externo E3-03, MAJOR, evidencia/e3/scripts/e1_motor_flujo.mjs
  // TEST 2): antes, `componentes`/`placas` (y sus objetos anidados — `Terminal`,
  // `Capacidad`, `Requisito`, `RegistroPin`, ...) se exponían por REFERENCIA directa a
  // `datos`, sin congelar ni clonar. `catalogo-datos.ts` exporta constantes de módulo
  // (`LED`, `DHT22`, ...) que MUCHOS catálogos distintos importan y comparten — nada
  // impedía que un llamador retuviera esa referencia (la propia `datos`, o el objeto
  // que `obtenerComponente()` devuelve) y mutara un componente YA usado por un motor
  // en ejecución (`obtenerComponente('led').terminales.push(...)`): el motor lo veía
  // de inmediato en el próximo `validarProyecto`/`aplicarOperacion`, porque
  // `catalogo.obtenerComponente()` devolvía la MISMA referencia mutable — el catálogo
  // sólo era inmutable por convención documental, nunca de hecho.
  //
  // Fix: clon defensivo (`clonarProfundo`, `canonico.ts`) + `congelarProfundo` sobre
  // el CLON — mismo patrón que `motor.ts` usa para aislar su `canonico` de
  // `proyectoInicial` — nunca sobre `datos` en sí: el llamador conserva su propio
  // objeto intacto y mutable (los fixtures de test que reusan `LED`/`DHT22` para
  // construir VARIOS catálogos distintos siguen funcionando igual), pero el catálogo
  // construido queda TOTALMENTE aislado de cualquier mutación posterior, sea sobre
  // `datos` o sobre el objeto que devuelve `obtenerComponente()`/`pinesDePlaca()`. La
  // extensibilidad puramente declarativa (agregar un componente nuevo como DATO en
  // `datos.componentes` antes de llamar acá) sigue intacta: el freeze corre DESPUÉS,
  // sobre la copia completa, nunca antes.
  // D-04: `asignable` se deriva ACÁ, una sola vez, sobre la copia aislada — antes del
  // freeze. Es la única derivación autorizada del repo.
  const componentesConAsignable: readonly ComponenteCatalogo[] = clonarProfundo(datos.componentes).map((c) => ({
    ...c,
    terminales: c.terminales.map((t) => ({ ...t, asignable: derivarAsignable(t) })),
  }))
  const componentesAislados = congelarProfundo(componentesConAsignable)
  const placasAisladas = congelarProfundo(clonarProfundo(datos.placas))
  const unidadesAisladas = datos.unidades ? congelarProfundo(clonarProfundo(datos.unidades)) : undefined
  const porTipo = new Map(componentesAislados.map((c) => [c.id, c]))
  const porPlaca = new Map(placasAisladas.map((p) => [p.id, p]))
  // Component System Foundation #1 (guardia A): el objeto catálogo TAMBIÉN se congela —
  // antes sólo lo estaban sus colecciones, y `catalogo.hash` (la identidad semántica)
  // se podía reasignar en runtime.
  const catalogo: Catalogo = {
    version: datos.version,
    hash,
    componentes: componentesAislados,
    placas: placasAisladas,
    unidades: unidadesAisladas,
    obtenerComponente: (tipo) => porTipo.get(tipo),
    tienePlaca: (id) => porPlaca.has(id),
    pinesDePlaca: (id) => porPlaca.get(id)?.pines,
  }
  return Object.freeze(catalogo)
}

// ════════════════════════════════════════════════════════════════════════════════════
// evaluarRequisito — switch por Requisito.tipo, nunca por id de componente
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * `conectadosPorTerminal` es lo que el llamador (validar-tecnico.ts, Gate 4) ya
 * resolvió de la IR: para cada terminal del componente, la lista de TIPOS de
 * catálogo de los componentes conectados a ese terminal. Esta función no camina la
 * IR — es una regla pura, testeable sin proyecto real.
 */
/** Tipos de requisito con evaluador REAL en `evaluarRequisito` (abajo). La admisión de
 * componentes (`conocimiento/admision.ts`) no da por verificado un requisito cuyo tipo
 * no esté acá: nunca se finge una validación que el motor no hace. */
export const TIPOS_DE_REQUISITO_CON_EVALUADOR: ReadonlySet<Requisito["tipo"]> = new Set(["resistencia-serie"])

export function evaluarRequisito(catalogoComponente: ComponenteCatalogo, conectadosPorTerminal: Readonly<Record<string, readonly string[]>>): readonly Motivo[] {
  const motivos: Motivo[] = []
  for (const req of catalogoComponente.requisitos) {
    switch (req.tipo) {
      case "resistencia-serie": {
        const tipoEsperado = typeof req.spec.tipoComponente === "string" ? req.spec.tipoComponente : "resistencia"
        const conectados = (req.enTerminal ? conectadosPorTerminal[req.enTerminal] : undefined) ?? []
        if (!conectados.includes(tipoEsperado)) {
          motivos.push({
            codigo: "REQUISITO_INSATISFECHO",
            categoria: "componente",
            severidad: "blocking",
            clasificacion: "representable",
            datos: { componente: catalogoComponente.id, requisito: req.tipo, terminal: req.enTerminal, esperado: tipoEsperado },
          })
        }
        break
      }
      // "capacidad-pin"/"resistencia-pull"/"componente-auxiliar": sin evidencia real
      // hoy en el set mínimo de Fase 1 (ningún componente shippeado los declara) — el
      // caso queda en el vocabulario del tipo para no reinventarlo en Gate 4+, pero no
      // se implementa una rama sin un requisito real que la ejercite (mismo criterio
      // YAGNI que usa placas.ts para `aliases[]` como índice separado).
      default:
        break
    }
  }
  return motivos
}

// ════════════════════════════════════════════════════════════════════════════════════
// asignarPin — compatibilidad terminal↔pin, switch por rol/electrica genérico
// ════════════════════════════════════════════════════════════════════════════════════

export function asignarPin(terminal: Terminal, pin: RegistroPin): Motivo | null {
  if (terminal.electrica === "digital") {
    const puedeDigital =
      terminal.direccion === "salida"
        ? pin.capacidades.salidaDigital
        : terminal.direccion === "entrada"
          ? pin.capacidades.entradaDigital
          : pin.capacidades.entradaDigital || pin.capacidades.salidaDigital
    if (!puedeDigital || (terminal.requierePwm && !pin.capacidades.pwm)) {
      return {
        codigo: "CAPACIDAD_PIN_INCOMPATIBLE",
        categoria: "tecnica",
        severidad: "blocking",
        clasificacion: "representable",
        datos: { terminal: terminal.id, pin: pin.id, requierePwm: terminal.requierePwm ?? false },
      }
    }
  }
  if (terminal.electrica === "analogica" && !pin.capacidades.adc) {
    return {
      codigo: "CAPACIDAD_PIN_INCOMPATIBLE",
      categoria: "tecnica",
      severidad: "blocking",
      clasificacion: "representable",
      datos: { terminal: terminal.id, pin: pin.id },
    }
  }
  return null
}

// ════════════════════════════════════════════════════════════════════════════════════
// evaluarRestriccionesPin — D1/D2/D3/D5/D7 (PHASE_2_SLICE_1_HARDENING_DESIGN.md §1-2)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Severidad por CLASE de `RegistroPin.restricciones` (`placas.ts`) — tabla
 * declarativa del NÚCLEO, separada de `Restriccion` (que sigue siendo sólo la clase
 * técnica, enum cerrado, sin agregados). Decisiones del HUMAN PRODUCT OWNER del gate
 * final de hardening, normativas (`PHASE_2_SLICE_1_HARDENING_DESIGN.md` D1/D2/D7):
 * - `flashReservado` → `blocking` (D1, H-1=B): GPIO6-11 van a la flash SPI, usarlos
 *   "cuelga/rompe la placa" (`circuito.ts:335`) — compromete hardware real.
 * - `strapping` → `info` por DEFAULT (D2/D3, H-2=B/H-2b=A); GPIO12 es la ÚNICA
 *   excepción por pin (`severidadStrapping`, abajo).
 * - `uartUsb` → `warning` (D7, H-6=B): interfiere con la carga del programa y el
 *   Monitor Serie (`circuito.ts:348-351`), nunca impide seguir editando.
 *
 * `soloEntrada` NO tiene entrada acá: a diferencia de las otras tres, nunca dispara
 * un motivo por sí sola (un pin solo-entrada es perfecto para una analógica, ej. el
 * `ntc`) — sólo en combinación con `Terminal.requierePullUpInterno`, más abajo.
 */
const SEVERIDAD_POR_RESTRICCION: Readonly<Record<"flashReservado" | "strapping" | "uartUsb", "info" | "warning" | "blocking">> = {
  flashReservado: "blocking",
  strapping: "info",
  uartUsb: "warning",
}

/**
 * Excepción por pin de D2 (H-2=B): dentro de la clase `strapping`, GPIO12 (MTDI) es
 * el único que en HIGH al encender fija la flash a 1,8V y "la placa no bootea, sin
 * aviso" (`skills/checklist-seguridad/SKILL.md:58`) — el resto de la clase (GPIO0,
 * GPIO2, GPIO15) se queda en la severidad `info` de la tabla de arriba (D3, H-2b=A:
 * GPIO2 sigue en el pool automático y se sigue ofreciendo).
 */
function severidadStrapping(pin: RegistroPin): "info" | "warning" {
  return pin.numero === 12 ? "warning" : "info"
}

/**
 * Motivos de restricción de UN pin, para UN terminal — se llama desde el mismo bucle
 * que hoy llama `asignarPin` (`validar-tecnico.ts`), NUNCA reemplaza esa función: la
 * operación sigue sin rechazarse por restricciones (D1/D11 — `clasificacion:
 * "representable"` siempre, nunca `"rechazo"`; `motor.ts:358-360` rechazaría el
 * ESTADO INICIAL completo si esto fuera `"rechazo"`, rompiendo PERSISTIBLE ⇒
 * RECARGABLE para los proyectos que ya existen con estos pines).
 *
 * Terminal-aware por construcción, nunca por `if GPIO<n>`:
 * - `flashReservado`/`strapping`/`uartUsb` sólo miran `pin.restricciones` — aplican
 *   igual a cualquier terminal (LED, pulsador), porque `RegistroPin.capacidades`
 *   (`entradaDigital`) ya es `true` en esos pines (`placas.ts::crearPinEsp32`): el
 *   riesgo es del PIN, no del sentido del terminal.
 * - `PIN_SIN_PULLUP_INTERNO` (D5, H-4=A) SÍ depende del terminal: sólo dispara si
 *   `terminal.requierePullUpInterno` es `true` (hoy, únicamamente `pulsador.senal`)
 *   Y el pin tiene `soloEntrada`. Una terminal `analogica` (el `ntc`) nunca declara
 *   ese dato, así que GPIO34 sigue sin motivo para un sensor analógico — mismo
 *   fixture de Phase 1 (`nucleo-ir-cargador.test.mjs:706`).
 * - Nunca duplica `CAPACIDAD_PIN_INCOMPATIBLE`: un LED (salida) en GPIO34 ya lo
 *   recibe de `asignarPin`, y como su terminal no declara `requierePullUpInterno`,
 *   esta función no agrega nada más para ese caso.
 */
export function evaluarRestriccionesPin(terminal: Terminal, pin: RegistroPin): readonly Motivo[] {
  const motivos: Motivo[] = []

  if (pin.restricciones.includes("flashReservado")) {
    motivos.push({
      codigo: "PIN_FLASH_RESERVADO",
      categoria: "tecnica",
      severidad: SEVERIDAD_POR_RESTRICCION.flashReservado,
      clasificacion: "representable",
      datos: { pin: pin.id, terminal: terminal.id, restriccion: "flashReservado" satisfies Restriccion },
    })
  }

  if (pin.restricciones.includes("strapping")) {
    motivos.push({
      codigo: "PIN_STRAPPING",
      categoria: "tecnica",
      severidad: severidadStrapping(pin),
      clasificacion: "representable",
      datos: { pin: pin.id, terminal: terminal.id, restriccion: "strapping" satisfies Restriccion },
    })
  }

  if (pin.restricciones.includes("uartUsb")) {
    motivos.push({
      codigo: "PIN_UART_USB",
      categoria: "tecnica",
      severidad: SEVERIDAD_POR_RESTRICCION.uartUsb,
      clasificacion: "representable",
      // `datos` se limita a la evidencia de `circuito.ts:348-351`: la carga del
      // programa y el Monitor Serie, nunca más de lo que el repo respalda.
      datos: { pin: pin.id, terminal: terminal.id, restriccion: "uartUsb" satisfies Restriccion, impacto: "carga del programa y Monitor Serie" },
    })
  }

  if (terminal.requierePullUpInterno && pin.restricciones.includes("soloEntrada")) {
    motivos.push({
      codigo: "PIN_SIN_PULLUP_INTERNO",
      categoria: "tecnica",
      severidad: "blocking",
      clasificacion: "representable",
      datos: { pin: pin.id, terminal: terminal.id, restriccion: "soloEntrada" satisfies Restriccion },
    })
  }

  return motivos
}

// ════════════════════════════════════════════════════════════════════════════════════
// estaFueraDeRango — límite compartido de `Capacidad.rango`, SIEMPRE inclusivo
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Phase 1.2 (hallazgo externo REA-02, MAYOR — re-auditoría externa AUD-C-02):
 * antes de este fix, esta comparación vivía DUPLICADA (como closure local `fueraDeRango`)
 * únicamente dentro de `reemplazarSensor`, más abajo — la remediación mínima sugerida
 * por el hallazgo (`PHASE_1_1_EXTERNAL_FINDINGS.md`, REA-02) es exactamente extraerla acá
 * para que `validar-tecnico.ts` (Gate 4, validación CONTINUA de
 * `proyecto.comportamientos`, ver `IR-SPEC.md` §6.2) la reuse también — mismo criterio
 * que ya usa `propagarMagnitud` como oráculo COMPARTIDO de compatibilidad
 * magnitud/unidad, nunca una segunda regla divergente.
 *
 * `rango === undefined` (capacidad sin rango declarado en el catálogo, ej. una
 * capacidad booleana pura) nunca es "fuera de rango" por ausencia de dato — no hay
 * nada contra qué comparar. Límite SIEMPRE inclusivo: `valor === rango.min.valor` o
 * `valor === rango.max.valor` NO es fuera de rango, sólo estrictamente afuera lo es
 * (semántica ya fijada por el `reemplazarSensor` original, nunca redefinida acá).
 */
export function estaFueraDeRango(valor: number, rango: Rango | undefined): boolean {
  return rango !== undefined && (valor < rango.min.valor || valor > rango.max.valor)
}

// ════════════════════════════════════════════════════════════════════════════════════
// propagarMagnitud — conversión de unidad EXPLÍCITA, nunca silenciosa (§8.1)
// ════════════════════════════════════════════════════════════════════════════════════

export type ResultadoPropagacion = { readonly ok: true; readonly valor: Cantidad; readonly motivo?: Motivo } | { readonly ok: false; readonly motivo: Motivo }

export function propagarMagnitud(origen: Cantidad, magnitudDestino: Magnitud, unidadDestino: Unidad, catalogo: Pick<Catalogo, "unidades">): ResultadoPropagacion {
  if (origen.magnitud !== magnitudDestino) {
    return {
      ok: false,
      motivo: {
        codigo: "MAGNITUD_INCOMPATIBLE",
        categoria: "semantica",
        severidad: "blocking",
        clasificacion: "representable",
        datos: { origen: origen.magnitud, destino: magnitudDestino },
      },
    }
  }
  if (origen.unidad === unidadDestino) {
    return { ok: true, valor: origen }
  }
  const conversion = catalogo.unidades?.conversiones.find((c) => c.de === origen.unidad && c.a === unidadDestino && c.magnitud === origen.magnitud)
  if (!conversion) {
    return {
      ok: false,
      motivo: {
        codigo: "MAGNITUD_INCOMPATIBLE",
        categoria: "semantica",
        severidad: "blocking",
        clasificacion: "representable",
        datos: { origen: origen.unidad, destino: unidadDestino, razon: "sin conversión declarada" },
      },
    }
  }
  const valorConvertido = origen.valor * conversion.factor + conversion.offset
  return {
    ok: true,
    valor: { valor: valorConvertido, unidad: unidadDestino, magnitud: origen.magnitud },
    motivo: {
      codigo: "UNIDAD_CONVERTIDA",
      categoria: "semantica",
      severidad: "info",
      datos: { de: origen.unidad, a: unidadDestino, factor: conversion.factor, offset: conversion.offset, valorOriginal: origen.valor, valorConvertido },
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// validarConexion — compatibilidad eléctrica mínima entre dos terminales
// ════════════════════════════════════════════════════════════════════════════════════

export function validarConexion(desde: Terminal, hasta: Terminal): Motivo | null {
  // Regla mínima con evidencia hoy: un terminal con `destinoFijo` (riel: GND/V5/etc.)
  // sólo se conecta a otro terminal de rol compatible (tierra↔tierra,
  // alimentacion↔alimentacion) o a un terminal de señal (que es como circuito.ts
  // arma hoy los cables: rol distinto, mismo riel). Sin evidencia real todavía de un
  // caso que ESTE core deba rechazar por incompatibilidad eléctrica más fina
  // (§9 de T_diseno_consolidado.md deja auto-conexión/duplicado para Gate 4/5, no
  // acá) — esta función queda deliberadamente mínima: hoy nunca rechaza, es la
  // costura donde Gate 4+ agrega reglas cuando aparezca evidencia real.
  void desde
  void hasta
  return null
}

// ════════════════════════════════════════════════════════════════════════════════════
// reemplazarSensor — las 4 ramas de §8.1 (R1 lo integra a ComportamientoRegla real)
// ════════════════════════════════════════════════════════════════════════════════════

export interface ResultadoReemplazoSensor {
  readonly comportamiento: ComportamientoRegla
  readonly motivo: Motivo | null
}

/**
 * Reemplaza el sensor de UN `ComportamientoRegla` (su `cuando`) por el nuevo
 * catálogo. Nunca rechaza la operación (eso lo decide `CambiarComponente`, Gate 5) —
 * siempre devuelve un comportamiento (mutado o igual) + el motivo de la rama que
 * corresponda. El umbral NUNCA se recorta (rama C, a diferencia de `armarPuente:1903`
 * en `circuito.ts`, que sí recorta — divergencia intencional, T_diseno_consolidado.md §10.7).
 */
export function reemplazarSensor(comportamiento: ComportamientoRegla, catalogoNuevo: ComponenteCatalogo, catalogo: Pick<Catalogo, "unidades">): ResultadoReemplazoSensor {
  // Phase 3 (B2): sin `cuando`, o sin la triada capacidad/umbral (regla parcial), no hay
  // capacidad ni umbral que reevaluar contra el sensor nuevo: se devuelve la MISMA
  // referencia, sin motivo (la completitud es un diagnóstico semántico aparte).
  const cuando = comportamiento.cuando
  if (!cuando || cuando.capacidad === undefined || cuando.umbral === undefined) return { comportamiento, motivo: null }
  const capacidadNueva = catalogoNuevo.capacidades.find((c) => c.id === cuando.capacidad)

  // Rama D: el nuevo sensor no declara esa capacidad en absoluto (o con otra magnitud).
  if (!capacidadNueva || capacidadNueva.magnitud !== cuando.umbral.magnitud) {
    return {
      comportamiento,
      motivo: {
        codigo: "CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR",
        categoria: "semantica",
        severidad: "blocking",
        clasificacion: "representable",
        entidad: { tipo: "comportamiento", id: comportamiento.id },
        datos: { capacidad: cuando.capacidad, nuevoTipo: catalogoNuevo.id },
      },
    }
  }

  const unidadNueva = capacidadNueva.unidad ?? cuando.umbral.unidad
  // Phase 1.2 (REA-02): reusa `estaFueraDeRango` (arriba) — ya NO una closure local
  // duplicada acá. Mismo comportamiento exacto, ninguna regla nueva.
  const fueraDeRango = (valor: number): boolean => estaFueraDeRango(valor, capacidadNueva.rango)

  // Rama A/C comparten unidad — la diferencia es si el umbral cae dentro del rango
  // del sensor nuevo. Ojo con el orden: chequear el rango ANTES de "misma unidad
  // => éxito" es lo que distingue rama A de rama C (dos sensores en la misma unidad
  // pero con rangos distintos, ej. dht22 0-60°C reemplazado por un sensor 0-25°C).
  if (unidadNueva === cuando.umbral.unidad) {
    if (fueraDeRango(cuando.umbral.valor)) {
      return {
        comportamiento,
        motivo: {
          codigo: "RANGO_INCOMPATIBLE_AL_REEMPLAZAR",
          categoria: "semantica",
          severidad: "warning",
          clasificacion: "representable",
          entidad: { tipo: "comportamiento", id: comportamiento.id },
          datos: { umbral: cuando.umbral.valor, rango: capacidadNueva.rango },
        },
      }
    }
    // Rama A: misma unidad, dentro de rango — se preserva el umbral tal cual, sin
    // motivo (éxito silencioso no es "silencioso": no hay nada que avisar porque no
    // cambió nada).
    return { comportamiento, motivo: null }
  }

  // Rama B: unidad distinta con conversión EXPLÍCITA declarada en el catálogo.
  //
  // Cast documentado: `ComportamientoRegla.cuando.umbral` (ir.ts) declara
  // `unidad`/`magnitud` como `string` a propósito — ir.ts es una hoja del árbol de
  // dependencias (T_diseno_consolidado.md §1) y no conoce los enums cerrados de
  // catalogo.ts (evitaría exactamente la dirección de dependencia que el diseño fija:
  // catalogo.ts depende de ir.ts, nunca al revés). Que esos strings sean valores
  // REALES de `Magnitud`/`Unidad` ya fue confirmado por `validar-tecnico.ts` (Gate 4)
  // antes de que cualquier código de Gate 3 corra sobre un proyecto real — acá sólo
  // hace falta el cast para que TypeScript lo sepa en este límite de módulo.
  const propagacion = propagarMagnitud(cuando.umbral as Cantidad, capacidadNueva.magnitud ?? (cuando.umbral.magnitud as Magnitud), unidadNueva as Unidad, catalogo)
  if (propagacion.ok) {
    const comportamientoConvertido: ComportamientoRegla = {
      ...comportamiento,
      cuando: { ...cuando, umbral: propagacion.valor },
    }
    return { comportamiento: comportamientoConvertido, motivo: propagacion.motivo ?? null }
  }

  // Unidad distinta SIN conversión declarada: caso borde sin evidencia real en el
  // set mínimo de Fase 1 (sólo °C↔°F está declarado, y esas dos siempre tienen
  // conversión). Se preserva sin recortar, igual criterio que rama C, para no
  // rechazar la operación completa (R1: "D incompatible → representable blocking,
  // nunca la operación entera se rechaza por esto").
  if (fueraDeRango(cuando.umbral.valor)) {
    return {
      comportamiento,
      motivo: {
        codigo: "RANGO_INCOMPATIBLE_AL_REEMPLAZAR",
        categoria: "semantica",
        severidad: "warning",
        clasificacion: "representable",
        entidad: { tipo: "comportamiento", id: comportamiento.id },
        datos: { umbral: cuando.umbral.valor, rango: capacidadNueva.rango },
      },
    }
  }
  return { comportamiento, motivo: null }
}
