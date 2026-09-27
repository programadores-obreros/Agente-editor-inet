// Operaciones — Gate 5. Ver docs/programacion-intencion/OPERATIONS.md (contrato
// escrito antes de este código).
//
// Funciones PURAS: `aplicarOperacion` nunca muta `proyecto` — construye uno nuevo
// reusando por REFERENCIA cualquier entidad no tocada (`Array.prototype.map`, nunca
// `structuredClone` de todo el árbol). En rechazo, el `Proyecto` devuelto es la MISMA
// referencia de entrada, nunca un objeto parcialmente mutado.
//
// Phase 1.1 (hallazgo externo E2-02, CRÍTICO, PHASE_1_EXTERNAL_FINDINGS.md): el
// `switch` de `aplicarOperacion` no tenía `default`, y no existía ninguna validación
// de FORMA en runtime del sobre (`SobreOperacion`) ni del `payload` antes del
// despacho — el cast `operacion.payload as {...}` de cada rama es sólo de
// compilación (TypeScript, "sintaxis borrable"): en runtime, cualquier JSON crudo
// (agente LLM, futuro transporte HTTP, brief §37) llega tal cual. Un `tipo`
// desconocido caía por el switch sin `default` y devolvía `undefined` en vez de un
// `ResultadoAplicacion`, que el llamador (`ejecutarOperacion`/`motor.ts`)
// desestructuraba crudo (`TypeError: Cannot destructure property 'proyecto' of
// undefined`); un `payload` null/undefined/con forma incorrecta hacía explotar un
// `TypeError` leyendo una propiedad de `null`/`undefined` dentro del `aplicarXxx`
// correspondiente. Ninguno de los dos devolvía un `Motivo` estructurado — violaba
// brief §12 ("resultado estructurado tanto en éxito como en error") — y el crash se
// propagaba SIN capturar hasta `motor.aplicar()` (evidencia/e2/
// exp2_malformed_operations.mjs, exp2b_motor_crash_propagation.mjs). `analizarSobreOperacion`/
// `validarFormaPayload` (más abajo) cierran esto ANTES del switch — que además suma un
// `default` de defensa en profundidad (mismo criterio de "doble defensa" que E1-03/
// E2-01) — para las 3 puertas públicas del motor (`proponer`/`aplicar`/
// `aplicarTransaccion`, que llaman a `aplicarOperacion` una vez por operación dentro
// del lote) y para quien invoque `aplicarOperacion`/`ejecutarOperacion` directo. Ver
// `docs/programacion-intencion/OPERATIONS.md` §9 para el contrato completo, incluida
// la decisión de E2-03 (campo extra desconocido en el sobre).

import type { Componente, ComportamientoRegla, Conexion, Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import { reemplazarSensor } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { formatearIdLocal } from "./id.ts"
import { validarProyecto } from "./validar.ts"
import { esAutoconexion, mismaConexion } from "./conexion.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos del sobre (OPERATIONS.md §2). CrearProyecto NO participa de este dispatch
// (OPERATIONS.md §3): la crea directo `cargador.ts`, invocada por el motor (Gate 6).
// ════════════════════════════════════════════════════════════════════════════════════

export type TipoOperacion = "SetPlaca" | "AgregarComponente" | "QuitarComponente" | "AsignarPin" | "Conectar" | "Desconectar" | "SetComportamiento" | "CambiarComponente"

export type SobreOperacion<P = unknown> = {
  readonly idOperacion: string
  readonly idTransaccion?: string
  readonly actor: "agente" | "navegador"
  readonly baseRevision: number
  readonly tipo: TipoOperacion
  readonly payload: P
}

export interface ResultadoAplicacion {
  readonly proyecto: Proyecto
  readonly motivos: readonly Motivo[]
}

export interface ResultadoOperacion {
  readonly ok: boolean
  readonly idOperacion: string
  readonly idTransaccion?: string
  readonly baseRevision: number
  /** Gate 5 siempre la deja igual a `baseRevision` — el motor (Gate 6) la sube tras commitear. */
  readonly revisionActual: number
  readonly motivos: readonly Motivo[]
  /** Extensión práctica sobre OPERATIONS.md: el motor (Gate 6) necesita el `Proyecto`
   * resultante para encadenar commit/persistencia, no sólo un resumen de "cambios". */
  readonly proyecto: Proyecto
  readonly cambios?: Readonly<Record<string, unknown>>
}

// ════════════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════════════

function rechazo(codigo: string, datos?: Record<string, unknown>, entidad?: Motivo["entidad"]): Motivo {
  return { codigo, categoria: "operacion", severidad: "blocking", clasificacion: "rechazo", entidad, datos }
}

function terminalesNoRielFijo(catalogo: Catalogo, tipo: string): readonly string[] {
  const comp = catalogo.obtenerComponente(tipo)
  if (!comp) return []
  return comp.terminales.filter((t) => t.electrica !== "riel-fijo").map((t) => t.id)
}

function tieneTerminalDeclarado(catalogo: Catalogo, tipoComponente: string, terminalId: string): boolean {
  const comp = catalogo.obtenerComponente(tipoComponente)
  if (!comp) return true // catálogo desconocido: eso lo valida validar-tecnico.ts, no acá
  return comp.terminales.some((t) => t.id === terminalId)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Validación de FORMA del sobre y del payload — Phase 1.1, hallazgo externo E2-02
// (CRÍTICO). Corre ANTES del switch/dispatch. Nunca valida referencias contra
// `proyecto`/`catalogo` (eso lo siguen haciendo los `aplicarXxx` de siempre) ni
// valores de enum sintácticamente válidos pero inventados (`comparador`/`accion`/
// `pin` con un string no vacío que no es uno de los valores reales — eso es
// responsabilidad de la validación técnica/referencial existente, no de acá): sólo
// la forma mínima que cada `aplicarXxx` necesita para no explotar en runtime.
// ════════════════════════════════════════════════════════════════════════════════════

const TIPOS_OPERACION_VALIDOS: readonly TipoOperacion[] = ["SetPlaca", "AgregarComponente", "QuitarComponente", "AsignarPin", "Conectar", "Desconectar", "SetComportamiento", "CambiarComponente"]
const ACTORES_VALIDOS: readonly string[] = ["agente", "navegador"]
/** Claves conocidas del sobre (`SobreOperacion`, §2 de OPERATIONS.md) — mismo criterio
 * fail-closed que `CLAVES_PROYECTO` en `cargador.ts` (Gate 2, hallazgo E2-03). */
const CLAVES_SOBRE_VALIDAS: readonly string[] = ["idOperacion", "idTransaccion", "actor", "baseRevision", "tipo", "payload"]

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function esStringNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

/** Sólo TIPO — a diferencia de `esStringNoVacio`, un string VACÍO pasa. Se usa para
 * los identificadores DENTRO de `payload` (`componente`/`terminal`/`conexion`/
 * `placa`/`tipo`/`sensor`/`capacidad`/...): un string vacío ahí nunca explota (es un
 * valor leído, no destructurado más), sólo falla la búsqueda referencial que el
 * `aplicarXxx` correspondiente ya hace (`REFERENCIA_INEXISTENTE`/
 * `TERMINAL_NO_DECLARADO`/`PLACA_DESCONOCIDA`/etc., ver `tests/nucleo-adversarial.
 * test.mjs`, "AsignarPin con terminal vacío"/"Conectar con componente vacío") — exigir
 * acá no-vacío sería sobre-rechazar un caso que el resto del pipeline YA diagnostica
 * bien, con un código más específico. `esStringNoVacio` queda sólo para el SOBRE
 * (`idOperacion`/`idTransaccion`, más abajo), donde no hay ninguna otra defensa. */
function esString(v: unknown): v is string {
  return typeof v === "string"
}

function esExtremoConexion(v: unknown): v is { componente: string; terminal: string } {
  return esObjetoPlano(v) && esString(v.componente) && esString(v.terminal)
}

/**
 * Valida la FORMA del sobre (`idOperacion`/`idTransaccion`/`actor`/`tipo` — nunca
 * `baseRevision`, que sigue siendo exclusivamente responsabilidad de `motor.ts`, ver
 * OPERATIONS.md §2/§9) y devuelve el primer `Motivo` de rechazo, o `null` si es
 * válido.
 *
 * Phase 1.1 (hallazgo externo E2-03, MENOR): una clave desconocida en el sobre (ej.
 * `extraField`) se rechaza con `CLAVE_DESCONOCIDA` — MISMO código que ya usa
 * `cargador.ts` para un documento con claves desconocidas, categoría `operacion` acá
 * en vez de `estructural` (mismo criterio ya establecido por `AUTOCONEXION_INVALIDA`/
 * `UMBRAL_NO_FINITO`: mismo código, dos categorías según quién lo emite) — cierra la
 * inconsistencia fail-closed entre las dos puertas de entrada del núcleo sin inventar
 * un código nuevo para lo mismo.
 */
function analizarSobreOperacion(operacion: unknown): Motivo | null {
  if (!esObjetoPlano(operacion)) {
    return rechazo("SOBRE_OPERACION_INVALIDO", { razon: "el sobre de operación no es un objeto" })
  }
  const clavesDesconocidas = Object.keys(operacion).filter((k) => !CLAVES_SOBRE_VALIDAS.includes(k))
  if (clavesDesconocidas.length > 0) {
    return rechazo("CLAVE_DESCONOCIDA", { claves: clavesDesconocidas })
  }
  if (!esStringNoVacio(operacion.idOperacion)) {
    return rechazo("SOBRE_OPERACION_INVALIDO", { razon: "idOperacion ausente o no es un string no vacío" })
  }
  if ("idTransaccion" in operacion && operacion.idTransaccion !== undefined && !esStringNoVacio(operacion.idTransaccion)) {
    return rechazo("SOBRE_OPERACION_INVALIDO", { razon: "idTransaccion presente pero no es un string no vacío" })
  }
  if (!ACTORES_VALIDOS.includes(operacion.actor as string)) {
    return rechazo("SOBRE_OPERACION_INVALIDO", { razon: "actor ausente o no es 'agente'/'navegador'", actorRecibido: operacion.actor })
  }
  if (!esStringNoVacio(operacion.tipo) || !TIPOS_OPERACION_VALIDOS.includes(operacion.tipo as TipoOperacion)) {
    return rechazo("TIPO_OPERACION_DESCONOCIDO", { tipoRecibido: operacion.tipo })
  }
  return null
}

/**
 * Valida que `payload` tenga, como mínimo, la forma que el `aplicarXxx` de `tipo`
 * necesita para no explotar leyendo una propiedad de `null`/`undefined`/un array.
 * Devuelve una razón en texto (para `datos.razon`) o `null` si la forma alcanza.
 */
function validarFormaPayload(tipo: TipoOperacion, payload: unknown): string | null {
  switch (tipo) {
    case "SetPlaca":
      return esObjetoPlano(payload) && esString(payload.placa) ? null : "se espera {placa: string}"
    case "AgregarComponente": {
      if (!esObjetoPlano(payload) || !esString(payload.tipo)) return "se espera {tipo: string}"
      if (payload.propiedades !== undefined && !esObjetoPlano(payload.propiedades)) return "propiedades debe ser un objeto si está presente"
      return null
    }
    case "QuitarComponente":
      return esObjetoPlano(payload) && esString(payload.componente) ? null : "se espera {componente: string}"
    case "AsignarPin": {
      if (!esObjetoPlano(payload) || !esString(payload.componente) || !esString(payload.terminal)) return "se espera {componente, terminal: string}"
      if (payload.pin !== null && !esString(payload.pin)) return "pin debe ser string o null"
      return null
    }
    case "Conectar":
      return esObjetoPlano(payload) && esExtremoConexion(payload.desde) && esExtremoConexion(payload.hasta) ? null : "se espera {desde, hasta: {componente, terminal}}"
    case "Desconectar":
      return esObjetoPlano(payload) && esString(payload.conexion) ? null : "se espera {conexion: string}"
    case "SetComportamiento": {
      if (!esObjetoPlano(payload) || !esObjetoPlano(payload.comportamiento)) return "se espera {comportamiento: {...}}"
      const c = payload.comportamiento
      if (c.id !== undefined && !esString(c.id)) return "comportamiento.id debe ser string si está presente"
      if (!esObjetoPlano(c.cuando) || !esString(c.cuando.sensor) || !esString(c.cuando.capacidad) || !esString(c.cuando.comparador)) {
        return "comportamiento.cuando incompleto (se esperan sensor/capacidad/comparador)"
      }
      if (!esObjetoPlano(c.cuando.umbral) || typeof c.cuando.umbral.valor !== "number" || !esString(c.cuando.umbral.unidad) || !esString(c.cuando.umbral.magnitud)) {
        return "comportamiento.cuando.umbral incompleto (se esperan valor numérico/unidad/magnitud)"
      }
      if (!esObjetoPlano(c.entonces) || !esString(c.entonces.actuador) || !esString(c.entonces.accion)) {
        return "comportamiento.entonces incompleto (se esperan actuador/accion)"
      }
      return null
    }
    case "CambiarComponente":
      return esObjetoPlano(payload) && esString(payload.componente) && esString(payload.tipoNuevo) ? null : "se espera {componente, tipoNuevo: string}"
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// aplicarOperacion — el dispatch, switch por tipo (nunca por id de componente)
// ════════════════════════════════════════════════════════════════════════════════════

export function aplicarOperacion(proyecto: Proyecto, operacion: SobreOperacion, catalogo: Catalogo): ResultadoAplicacion {
  const motivoSobre = analizarSobreOperacion(operacion)
  if (motivoSobre) return { proyecto, motivos: [motivoSobre] }

  const tipo = operacion.tipo
  const razonPayload = validarFormaPayload(tipo, operacion.payload)
  if (razonPayload) return { proyecto, motivos: [rechazo("PAYLOAD_OPERACION_INVALIDO", { tipo, razon: razonPayload })] }

  switch (tipo) {
    case "SetPlaca":
      return aplicarSetPlaca(proyecto, operacion.payload as { placa: string }, catalogo)
    case "AgregarComponente":
      return aplicarAgregarComponente(proyecto, operacion.payload as { tipo: string; propiedades?: Record<string, unknown> }, catalogo)
    case "QuitarComponente":
      return aplicarQuitarComponente(proyecto, operacion.payload as { componente: string })
    case "AsignarPin":
      return aplicarAsignarPin(proyecto, operacion.payload as { componente: string; terminal: string; pin: string | null }, catalogo)
    case "Conectar":
      return aplicarConectar(proyecto, operacion.payload as { desde: { componente: string; terminal: string }; hasta: { componente: string; terminal: string } }, catalogo)
    case "Desconectar":
      return aplicarDesconectar(proyecto, operacion.payload as { conexion: string })
    case "SetComportamiento":
      return aplicarSetComportamiento(proyecto, operacion.payload as { comportamiento: Omit<ComportamientoRegla, "id"> & { id?: string } }, catalogo)
    case "CambiarComponente":
      return aplicarCambiarComponente(proyecto, operacion.payload as { componente: string; tipoNuevo: string }, catalogo)
    default:
      // Defensa en profundidad (nunca alcanzable hoy: `analizarSobreOperacion` ya
      // rechazó cualquier `tipo` fuera de `TIPOS_OPERACION_VALIDOS` más arriba) —
      // mismo criterio de "doble defensa" que E1-03/E2-01: si una regla futura
      // agranda `TipoOperacion` sin agregar su rama acá, esto sigue devolviendo un
      // `Motivo` estructurado en vez de `undefined`.
      return { proyecto, motivos: [rechazo("TIPO_OPERACION_DESCONOCIDO", { tipoRecibido: tipo })] }
  }
}

// ── SetPlaca ─────────────────────────────────────────────────────────────────────────

function aplicarSetPlaca(proyecto: Proyecto, payload: { placa: string }, catalogo: Catalogo): ResultadoAplicacion {
  if (!catalogo.tienePlaca(payload.placa)) {
    return { proyecto, motivos: [rechazo("PLACA_DESCONOCIDA", { placa: payload.placa })] }
  }
  return { proyecto: { ...proyecto, placa: payload.placa }, motivos: [] }
}

// ── AgregarComponente ────────────────────────────────────────────────────────────────

function aplicarAgregarComponente(proyecto: Proyecto, payload: { tipo: string; propiedades?: Record<string, unknown> }, catalogo: Catalogo): ResultadoAplicacion {
  if (!catalogo.obtenerComponente(payload.tipo)) {
    return { proyecto, motivos: [rechazo("TIPO_CATALOGO_DESCONOCIDO", { tipo: payload.tipo })] }
  }
  const id = formatearIdLocal("cmp", proyecto.siguienteIdLocal)
  const pines: Record<string, string | null> = {}
  for (const terminalId of terminalesNoRielFijo(catalogo, payload.tipo)) pines[terminalId] = null
  const nuevo: Componente = { id, tipo: payload.tipo, pines, propiedades: payload.propiedades ?? {} }
  return {
    proyecto: { ...proyecto, siguienteIdLocal: proyecto.siguienteIdLocal + 1, componentes: [...proyecto.componentes, nuevo] },
    motivos: [],
  }
}

// ── QuitarComponente ─────────────────────────────────────────────────────────────────

function aplicarQuitarComponente(proyecto: Proyecto, payload: { componente: string }): ResultadoAplicacion {
  if (!proyecto.componentes.some((c) => c.id === payload.componente)) {
    return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: payload.componente })] }
  }
  const tieneDependientes =
    proyecto.conexiones.some((cx) => cx.desde.componente === payload.componente || cx.hasta.componente === payload.componente) ||
    proyecto.comportamientos.some((b) => b.cuando.sensor === payload.componente || b.entonces.actuador === payload.componente)
  if (tieneDependientes) {
    return { proyecto, motivos: [rechazo("REMOCION_CON_DEPENDIENTES", { componente: payload.componente })] }
  }
  return { proyecto: { ...proyecto, componentes: proyecto.componentes.filter((c) => c.id !== payload.componente) }, motivos: [] }
}

// ── AsignarPin ───────────────────────────────────────────────────────────────────────

function aplicarAsignarPin(proyecto: Proyecto, payload: { componente: string; terminal: string; pin: string | null }, catalogo: Catalogo): ResultadoAplicacion {
  const componente = proyecto.componentes.find((c) => c.id === payload.componente)
  if (!componente) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: payload.componente })] }
  if (!tieneTerminalDeclarado(catalogo, componente.tipo, payload.terminal)) {
    return { proyecto, motivos: [rechazo("TERMINAL_NO_DECLARADO", { componente: payload.componente, terminal: payload.terminal })] }
  }
  if (payload.pin !== null) {
    const pines = proyecto.placa ? catalogo.pinesDePlaca(proyecto.placa) : undefined
    if (!pines?.some((p) => p.id === payload.pin)) {
      return { proyecto, motivos: [rechazo("PIN_INEXISTENTE_EN_PLACA", { pin: payload.pin, placa: proyecto.placa })] }
    }
  }
  // Ojo: NO se chequea acá si el pin ya está ocupado por otro componente, ni si es
  // eléctricamente compatible — eso es PIN_OCUPADO/CAPACIDAD_PIN_INCOMPATIBLE,
  // representable, lo detecta validarProyecto() en ejecutarOperacion (§6/§7 de
  // OPERATIONS.md). La operación ASIGNA igual.
  const componentes = proyecto.componentes.map((c) => (c.id === payload.componente ? { ...c, pines: { ...c.pines, [payload.terminal]: payload.pin } } : c))
  return { proyecto: { ...proyecto, componentes }, motivos: [] }
}

// ── Conectar ─────────────────────────────────────────────────────────────────────────

function aplicarConectar(proyecto: Proyecto, payload: { desde: { componente: string; terminal: string }; hasta: { componente: string; terminal: string } }, catalogo: Catalogo): ResultadoAplicacion {
  for (const extremo of [payload.desde, payload.hasta]) {
    const comp = proyecto.componentes.find((c) => c.id === extremo.componente)
    if (!comp) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: extremo.componente })] }
    if (!tieneTerminalDeclarado(catalogo, comp.tipo, extremo.terminal)) {
      return { proyecto, motivos: [rechazo("TERMINAL_NO_DECLARADO", { componente: extremo.componente, terminal: extremo.terminal })] }
    }
  }
  // Phase 1.1 (hallazgo externo E2-01, CRÍTICO): `esAutoconexion`/`mismaConexion`
  // (`conexion.ts`) son la ÚNICA implementación de este invariante — reusada también
  // por `cargador.ts` (Gate 2) y `validar-estructural.ts` (Gate 4, corre en
  // `validarProyecto`, incluida la construcción del motor sobre `proyectoInicial`).
  // Antes de Phase 1.1 esta era la ÚNICA puerta que lo chequeaba: un documento/
  // `proyectoInicial` con self-loop o duplicado bypaseaba esta defensa por completo.
  if (esAutoconexion(payload.desde, payload.hasta)) {
    return { proyecto, motivos: [rechazo("AUTOCONEXION_INVALIDA", { componente: payload.desde.componente, terminal: payload.desde.terminal })] }
  }
  if (proyecto.conexiones.some((cx) => mismaConexion(cx, payload))) {
    return { proyecto, motivos: [rechazo("CONEXION_DUPLICADA", { desde: payload.desde, hasta: payload.hasta })] }
  }
  const id = formatearIdLocal("conn", proyecto.siguienteIdLocal)
  const nueva: Conexion = { id, desde: payload.desde, hasta: payload.hasta }
  return {
    proyecto: { ...proyecto, siguienteIdLocal: proyecto.siguienteIdLocal + 1, conexiones: [...proyecto.conexiones, nueva] },
    motivos: [],
  }
}

// ── Desconectar ──────────────────────────────────────────────────────────────────────

function aplicarDesconectar(proyecto: Proyecto, payload: { conexion: string }): ResultadoAplicacion {
  if (!proyecto.conexiones.some((cx) => cx.id === payload.conexion)) {
    return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { conexion: payload.conexion })] }
  }
  return { proyecto: { ...proyecto, conexiones: proyecto.conexiones.filter((cx) => cx.id !== payload.conexion) }, motivos: [] }
}

// ── SetComportamiento ────────────────────────────────────────────────────────────────

function aplicarSetComportamiento(proyecto: Proyecto, payload: { comportamiento: Omit<ComportamientoRegla, "id"> & { id?: string } }, catalogo: Catalogo): ResultadoAplicacion {
  const { cuando, entonces } = payload.comportamiento
  // Phase 1.1 (hallazgo externo E1-03, CRÍTICO): un `umbral.valor` NaN/±Infinity
  // nunca es representable en el documento JSON persistido (`JSON.stringify` de
  // cualquiera de los tres da `null` — ver `canonico.ts`/`cargador.ts`), así que
  // aceptar la operación dejaría la memoria (con el número real) desincronizada del
  // disco (con `null`) apenas se persistiera una vez. Se rechaza ACÁ, ANTES de tocar
  // el estado, en vez de esperar a que `validarProyecto` (Gate 4, en
  // `ejecutarOperacion`/`motor.ts`) lo agarre recién después de aplicar la
  // operación — a diferencia de una capacidad/magnitud/unidad incompatible con el
  // catálogo (eso SÍ se deja pasar y se diagnostica representable/blocking más
  // abajo, categoría A del brief §8.1/§9.1, mismo criterio que `PIN_OCUPADO` en
  // `AsignarPin`).
  if (!Number.isFinite(cuando.umbral.valor)) {
    return { proyecto, motivos: [rechazo("UMBRAL_NO_FINITO", { valor: String(cuando.umbral.valor) })] }
  }
  const sensor = proyecto.componentes.find((c) => c.id === cuando.sensor)
  if (!sensor) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: cuando.sensor })] }
  const actuador = proyecto.componentes.find((c) => c.id === entonces.actuador)
  if (!actuador) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: entonces.actuador })] }
  const capacidadDeclarada = catalogo.obtenerComponente(sensor.tipo)?.capacidades.some((cap) => cap.id === cuando.capacidad)
  if (!capacidadDeclarada) {
    return { proyecto, motivos: [rechazo("CAPACIDAD_NO_DECLARADA", { componente: sensor.id, capacidad: cuando.capacidad })] }
  }
  const idExistente = payload.comportamiento.id
  const esReemplazo = idExistente !== undefined && proyecto.comportamientos.some((b) => b.id === idExistente)
  if (esReemplazo) {
    const nueva: ComportamientoRegla = { id: idExistente, cuando, entonces }
    return { proyecto: { ...proyecto, comportamientos: proyecto.comportamientos.map((b) => (b.id === idExistente ? nueva : b)) }, motivos: [] }
  }
  const id = formatearIdLocal("beh", proyecto.siguienteIdLocal)
  const nueva: ComportamientoRegla = { id, cuando, entonces }
  return {
    proyecto: { ...proyecto, siguienteIdLocal: proyecto.siguienteIdLocal + 1, comportamientos: [...proyecto.comportamientos, nueva] },
    motivos: [],
  }
}

// ── CambiarComponente ────────────────────────────────────────────────────────────────

function aplicarCambiarComponente(proyecto: Proyecto, payload: { componente: string; tipoNuevo: string }, catalogo: Catalogo): ResultadoAplicacion {
  const componente = proyecto.componentes.find((c) => c.id === payload.componente)
  if (!componente) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: payload.componente })] }
  const catalogoNuevo = catalogo.obtenerComponente(payload.tipoNuevo)
  if (!catalogoNuevo) return { proyecto, motivos: [rechazo("TIPO_CATALOGO_DESCONOCIDO", { tipo: payload.tipoNuevo })] }

  // Nuevos pines: preserva la asignación por id de terminal cuando el terminal nuevo
  // existe con el mismo id; terminales que no existían antes arrancan sin asignar.
  const pinesNuevos: Record<string, string | null> = {}
  for (const t of catalogoNuevo.terminales) {
    if (t.electrica === "riel-fijo") continue
    pinesNuevos[t.id] = componente.pines[t.id] ?? null
  }
  const componenteCambiado: Componente = { ...componente, tipo: payload.tipoNuevo, pines: pinesNuevos }

  const motivos: Motivo[] = []
  const comportamientos = proyecto.comportamientos.map((b) => {
    if (b.cuando.sensor !== payload.componente) return b // no relacionado: MISMA referencia
    const r = reemplazarSensor(b, catalogoNuevo, catalogo)
    if (r.motivo) motivos.push(r.motivo)
    return r.comportamiento
  })

  const componentes = proyecto.componentes.map((c) => (c.id === payload.componente ? componenteCambiado : c))
  return { proyecto: { ...proyecto, componentes, comportamientos }, motivos }
}

// ════════════════════════════════════════════════════════════════════════════════════
// ejecutarOperacion — combina rechazo propio + validación del estado resultante
// ════════════════════════════════════════════════════════════════════════════════════

export function ejecutarOperacion(proyecto: Proyecto, operacion: SobreOperacion, catalogo: Catalogo): ResultadoOperacion {
  const { proyecto: proyectoAplicado, motivos: motivosPropios } = aplicarOperacion(proyecto, operacion, catalogo)

  if (motivosPropios.some((m) => m.clasificacion === "rechazo")) {
    return {
      ok: false,
      idOperacion: operacion.idOperacion,
      idTransaccion: operacion.idTransaccion,
      baseRevision: operacion.baseRevision,
      revisionActual: operacion.baseRevision,
      motivos: motivosPropios,
      proyecto,
    }
  }

  const motivosValidacion = validarProyecto(proyectoAplicado, catalogo)

  // Defensa en profundidad (revisión de arquitectura Gate 8, §77 — misma clase de
  // gap que tenía motor.ts antes de su fix, ver DECISIONS.md): un motivo
  // `clasificacion:"rechazo"` que aparezca recién en la validación POST-aplicación
  // (hoy sólo `validar-estructural.ts` puede emitir uno así) tumba el resultado
  // igual que un rechazo por la operación misma — nunca se devuelve un
  // `proyectoAplicado` como aceptado si la validación del estado resultante lo
  // rechaza.
  if (motivosValidacion.some((m) => m.clasificacion === "rechazo")) {
    return {
      ok: false,
      idOperacion: operacion.idOperacion,
      idTransaccion: operacion.idTransaccion,
      baseRevision: operacion.baseRevision,
      revisionActual: operacion.baseRevision,
      motivos: [...motivosPropios, ...motivosValidacion],
      proyecto,
    }
  }

  return {
    ok: true,
    idOperacion: operacion.idOperacion,
    idTransaccion: operacion.idTransaccion,
    baseRevision: operacion.baseRevision,
    revisionActual: operacion.baseRevision,
    motivos: [...motivosPropios, ...motivosValidacion],
    proyecto: proyectoAplicado,
  }
}
