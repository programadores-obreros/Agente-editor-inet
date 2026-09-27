// Operaciones — Gate 5. Ver docs/programacion-intencion/OPERATIONS.md (contrato
// escrito antes de este código).
//
// Funciones PURAS: `aplicarOperacion` nunca muta `proyecto` — construye uno nuevo
// reusando por REFERENCIA cualquier entidad no tocada (`Array.prototype.map`, nunca
// `structuredClone` de todo el árbol). En rechazo, el `Proyecto` devuelto es la MISMA
// referencia de entrada, nunca un objeto parcialmente mutado.

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
// aplicarOperacion — el dispatch, switch por tipo (nunca por id de componente)
// ════════════════════════════════════════════════════════════════════════════════════

export function aplicarOperacion(proyecto: Proyecto, operacion: SobreOperacion, catalogo: Catalogo): ResultadoAplicacion {
  switch (operacion.tipo) {
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
