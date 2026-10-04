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
import { ACCIONES, COMPARADORES } from "./ir.ts"
import { analizarFormaRegla } from "./regla-forma.ts"
import type { Catalogo } from "./catalogo.ts"
import { reemplazarSensor } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { formatearIdLocal } from "./id.ts"
import { validarProyecto } from "./validar.ts"
import { esAutoconexion, mismaConexion } from "./conexion.ts"
import { materializarDatosPlanos, motivoEntradaNoPlano } from "./datos-planos.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos del sobre (OPERATIONS.md §2). CrearProyecto NO participa de este dispatch
// (OPERATIONS.md §3): la crea directo `cargador.ts`, invocada por el motor (Gate 6).
// ════════════════════════════════════════════════════════════════════════════════════

export type TipoOperacion = "SetPlaca" | "AgregarComponente" | "QuitarComponente" | "AsignarPin" | "Conectar" | "Desconectar" | "SetComportamiento" | "QuitarComportamiento" | "CambiarComponente"

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

/** Phase 1.1 (RX4, hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial
 * independiente): `siguienteIdLocal` entra siempre como un entero SEGURO
 * (`esEnteroNoNegativo`, `cargador.ts`, ahora acotada con `Number.isSafeInteger`) —
 * el ÚNICO valor donde generar el PRÓXIMO id local (`+1`, los 3 aplicadores que lo
 * usan) dejaría de ser exacto es `siguienteIdLocal === Number.MAX_SAFE_INTEGER`.
 * "Lo mismo para el contador de ids" que el commit de revisión en `motor.ts`:
 * nunca un incremento silenciosamente inexacto — se rechaza ANTES de generar el id
 * o mutar el proyecto. */
function contadorExcedeEnteroSeguro(siguienteIdLocal: number): boolean {
  return !Number.isSafeInteger(siguienteIdLocal + 1)
}

function motivoContadorExcedeEnteroSeguro(siguienteIdLocal: number): Motivo {
  return rechazo("CONTADOR_ID_EXCEDE_ENTERO_SEGURO", { siguienteIdLocal, limite: Number.MAX_SAFE_INTEGER })
}

function terminalesNoRielFijo(catalogo: Catalogo, tipo: string): readonly string[] {
  const comp = catalogo.obtenerComponente(tipo)
  if (!comp) return []
  return comp.terminales.filter((t) => t.asignable).map((t) => t.id)
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
//
// Phase 1.2 (hallazgo externo REA-01, CRÍTICO — re-auditoría externa): el párrafo de
// arriba, para `comparador`/`accion`, describía una validación que en los hechos
// NUNCA existía — "la validación técnica/referencial existente" jamás comprobó esos
// dos campos, en ninguna puerta de Gate 5. `validarFormaPayload` SIGUE sin
// comprobarlos (sigue siendo sólo de FORMA/tipo, el comentario de arriba sigue siendo
// exacto para ella) — el chequeo real vive ahora dentro de `aplicarSetComportamiento`
// (más abajo), contra el MISMO dominio normativo que usa el loader (`ir.ts::
// COMPARADORES`/`ACCIONES`), con su propio código (`VALOR_ENUM_DESCONOCIDO`). Ver
// `docs/programacion-intencion/IR-SPEC.md` §6.11 y `OPERATIONS.md` §11.
// ════════════════════════════════════════════════════════════════════════════════════

const TIPOS_OPERACION_VALIDOS: readonly TipoOperacion[] = ["SetPlaca", "AgregarComponente", "QuitarComponente", "AsignarPin", "Conectar", "Desconectar", "SetComportamiento", "QuitarComportamiento", "CambiarComponente"]
const ACTORES_VALIDOS: readonly string[] = ["agente", "navegador"]
/** Claves conocidas del sobre (`SobreOperacion`, §2 de OPERATIONS.md) — mismo criterio
 * fail-closed que `CLAVES_PROYECTO` en `cargador.ts` (Gate 2, hallazgo E2-03). */
const CLAVES_SOBRE_VALIDAS: readonly string[] = ["idOperacion", "idTransaccion", "actor", "baseRevision", "tipo", "payload"]

// Phase 1.1 (RX4): exportada — `motor.ts` la reusa para validar la FORMA DEL LOTE
// (array denso de objetos no nulos) ANTES de leer ningun elemento, ver
// hallazgo externo RX4-01. Misma funcion, un solo lugar — nunca copiada.
export function esObjetoPlano(v: unknown): v is Record<string, unknown> {
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
      // Phase 3 (B2): UNA sola función de validez estructural, compartida con el
      // cargador (`regla-forma.ts`) — PERSISTIBLE ⇒ RECARGABLE. Admite reglas parciales.
      const forma = analizarFormaRegla(c)
      return forma.ok ? null : forma.falla.razon
    }
    case "QuitarComportamiento": {
      if (!esObjetoPlano(payload) || !esString(payload.comportamiento)) return "se espera {comportamiento: string}"
      const claves = Object.keys(payload).filter((k) => k !== "comportamiento")
      return claves.length > 0 ? `claves desconocidas en el payload: ${claves.join(", ")}` : null
    }
    case "CambiarComponente":
      return esObjetoPlano(payload) && esString(payload.componente) && esString(payload.tipoNuevo) ? null : "se espera {componente, tipoNuevo: string}"
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// aplicarOperacion — el dispatch, switch por tipo (nunca por id de componente)
// ════════════════════════════════════════════════════════════════════════════════════

export function aplicarOperacion(proyecto: Proyecto, operacionCruda: SobreOperacion, catalogo: Catalogo): ResultadoAplicacion {
  // Phase 1.1 (RX2, hallazgo externo RX2-01, CRÍTICO — revisión adversarial
  // independiente #2, reabre E2-02/RX-02): el fix anterior (RX-02, 6822c5a)
  // envolvía `analizarSobreOperacion`/`validarFormaPayload` en un único try/catch
  // — pero el `switch` de despacho, DEBAJO de ese try/catch, volvía a escribir
  // `operacion.payload as {...}` en CADA `case`: una SEGUNDA lectura, sin proteger,
  // del MISMO campo. Un getter válido en la 1ª lectura (pasa la validación de
  // forma) que lanza en la 2ª (el dispatch) atravesaba igual, crudo. El fix de
  // esta ronda no agrega una tercera lectura protegida más: materializa el sobre
  // COMPLETO (envoltorio + payload anidado) en datos planos, UNA sola vez, ANTES
  // de leer nada — `analizarSobreOperacion`, `validarFormaPayload` y el `switch`
  // de abajo trabajan TODOS sobre la MISMA copia (`operacion`, ya plana) — no hay
  // una "segunda lectura" que pueda divergir de la primera, porque no hay una
  // función (getter) que decida devolver algo distinto la segunda vez. Ver
  // `opencode/nucleo/datos-planos.ts` para el detalle completo (incluida la razón
  // por la que esto también cierra RX2-02: `payload.propiedades`, la bolsa
  // abierta de `AgregarComponente`, viaja de acá en más como copia plana, nunca
  // como el objeto vivo del llamador — `congelarProfundo`, en `motor.ts`, ya no
  // puede toparse con un Proxy que lanza).
  //
  // Phase 1.2 (hallazgo externo REA-03, MAYOR — re-auditoría externa AUD-B-01): esta
  // es ahora la ÚNICA materialización del sobre en TODO este módulo — la frontera
  // pública, corrida UNA sola vez, ANTES de leer nada. El núcleo de aplicación
  // (`aplicarOperacionMaterializada`, más abajo) recibe la copia YA MATERIALIZADA y
  // nunca vuelve a materializar — `ejecutarOperacion` (más abajo) también pasa por
  // esta MISMA disciplina: materializa UNA vez, en su propia frontera, y alimenta esa
  // única copia tanto al núcleo de aplicación como al eco. Antes de este fix,
  // `ejecutarOperacion` materializaba una SEGUNDA copia, independiente de la que esta
  // función calculaba puertas adentro, sólo para el eco — ver el comentario de
  // `ejecutarOperacion` para el detalle completo del defecto.
  const materializado = materializarDatosPlanos<SobreOperacion>(operacionCruda, "operacion")
  if (!materializado.ok) {
    return { proyecto, motivos: [motivoEntradaNoPlano("operacion", materializado)] }
  }
  return aplicarOperacionMaterializada(proyecto, materializado.valor, catalogo)
}

/**
 * Phase 1.2 (hallazgo externo REA-03, MAYOR): núcleo de aplicación — recibe el sobre
 * YA MATERIALIZADO (dato plano, leído una sola vez por el llamador) y NUNCA vuelve a
 * materializar. Tiene exactamente dos llamadores en todo el núcleo:
 * `aplicarOperacion` (arriba, frontera pública para quien sólo necesita el resultado
 * de aplicación) y `ejecutarOperacion` (más abajo, que además necesita esa MISMA
 * copia para el eco). Que ambos consuman la copia de su PROPIA materialización — nunca
 * una función interna que materialice por su cuenta una tercera vez — es lo que
 * garantiza, por construcción, que nunca puede haber dos pasadas independientes sobre
 * el mismo sobre crudo dentro de este módulo.
 */
function aplicarOperacionMaterializada(proyecto: Proyecto, operacion: SobreOperacion, catalogo: Catalogo): ResultadoAplicacion {
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
    case "QuitarComportamiento":
      return aplicarQuitarComportamiento(proyecto, operacion.payload as { comportamiento: string })
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
  if (contadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)) {
    return { proyecto, motivos: [motivoContadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)] }
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
    // Phase 3 (B2/B5, HD-P3D-4 = A): cualquier slot PRESENTE que referencie al componente
    // lo protege; una regla parcial sin ese slot no depende de él.
    proyecto.comportamientos.some((b) => b.cuando?.sensor === payload.componente || b.entonces?.actuador === payload.componente)
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
  // HD-W0-A (docs/programacion-intencion/PHASE_3_PRE_HUMAN_TEST_DESIGN.md §1): un
  // terminal que el catálogo declara `electrica: "riel-fijo"` (destino fijo — "va en
  // el medio del cable", nunca se conecta directo a un pin de la placa, ver
  // `catalogo-datos.ts`) nunca acepta `AsignarPin`, SIN excepción (incluido
  // `pin: null`). La fuente de "asignable" es EXCLUSIVAMENTE el catálogo — la MISMA
  // derivación que ya usan `terminalesNoRielFijo` (arriba) y
  // `vista-fisica/vocabulario.ts::asignable` — NUNCA el tipo/id del componente (nada
  // de hardcodear `"resistencia"`): el terminal real se busca en el catálogo por su
  // id, igual que `tieneTerminalDeclarado`. Camino B: rechazo, la IR no cambia. Un
  // documento HISTÓRICO que ya tenga este dato (de antes de esta decisión) sigue
  // CARGANDO igual — el loader (`cargador.ts`) y la validación continua
  // (`validar-tecnico.ts`, que sigue salteando `riel-fijo` a propósito) no cambian:
  // esta invariancia gobierna SÓLO la operación NUEVA (PERSISTIBLE ⇒ RECARGABLE).
  // Component System Foundation #1 (D-04): la fuente es `Terminal.asignable`, derivado
  // UNA vez en `construirCatalogo` — este archivo ya no interpreta `electrica`.
  const terminalCatalogo = catalogo.obtenerComponente(componente.tipo)?.terminales.find((t) => t.id === payload.terminal)
  if (terminalCatalogo && !terminalCatalogo.asignable) {
    return { proyecto, motivos: [rechazo("TERMINAL_NO_ASIGNABLE", { componente: payload.componente, terminal: payload.terminal, electrica: terminalCatalogo.electrica })] }
  }
  // D-05: GND/3V3/5V/VIN son terminales de potencia REALES de la placa (físicamente
  // conectables) pero no GPIO lógicos: asignarlos como pin se rechaza con el mismo
  // código, y no con `PIN_INEXISTENTE_EN_PLACA`, que sería falso (sí existen).
  const placaActual = proyecto.placa ? catalogo.placas.find((p) => p.id === proyecto.placa) : undefined
  if (payload.pin !== null && placaActual?.terminalesDePotencia?.some((t) => t.id === payload.pin)) {
    return { proyecto, motivos: [rechazo("TERMINAL_NO_ASIGNABLE", { componente: payload.componente, terminal: payload.terminal, pin: payload.pin, placa: proyecto.placa, terminalDePotencia: true })] }
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
  if (contadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)) {
    return { proyecto, motivos: [motivoContadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)] }
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
  // Phase 3 (B2): `cuando`/`entonces` y cada campo pueden estar ausentes (regla parcial) —
  // sólo se validan los campos PRESENTES. La forma ya la garantizó `analizarFormaRegla`.
  const { cuando, entonces } = payload.comportamiento
  // Phase 1.2 (hallazgo externo REA-01, CRÍTICO — re-auditoría externa,
  // PHASE_1_1_REGAUDIT_FINDINGS.md): `comparador`/`accion` son uniones LITERALES en
  // TypeScript (`ir.ts::Comparador`/`Accion`) — pero el cast de `aplicarOperacion`
  // (arriba) es sólo de compilación: en runtime, cualquier JSON crudo puede traer un
  // string SINTÁCTICAMENTE válido pero FUERA de ese dominio (`"mayorQue"`,
  // `"prender"`). Antes de este fix, ninguna puerta de Gate 5 lo comprobaba — la
  // operación commiteaba `ok:true`, y recién `cargador.ts` (el ÚNICO lugar que sí lo
  // comprobaba, con su propio dominio antes NO compartido) lo rechazaba AL RECARGAR:
  // un documento PERSISTIBLE que dejaba de ser RECARGABLE (`IR-SPEC.md` §6.11) — y,
  // peor, el compare-and-swap de `almacen.ts` (E3-07) necesita releer ese mismo
  // documento para verificar la revisión antes de CUALQUIER commit siguiente, así que
  // el proyecto entero quedaba inutilizable (`PERSIST_FAILED`), no sólo el
  // comportamiento roto. Se rechaza ACÁ, ANTES de tocar el estado (mismo criterio
  // "Camino B" que `UMBRAL_NO_FINITO` un poco más abajo), contra el MISMO dominio
  // normativo que usa el loader (`ir.ts::COMPARADORES`/`ACCIONES` — nunca una
  // segunda lista, esa divergencia silenciosa era la causa raíz exacta de REA-01).
  if (cuando?.comparador !== undefined && !(COMPARADORES as readonly string[]).includes(cuando.comparador)) {
    return { proyecto, motivos: [rechazo("VALOR_ENUM_DESCONOCIDO", { campo: "cuando.comparador", valorRecibido: cuando.comparador, dominioValido: COMPARADORES })] }
  }
  if (entonces?.accion !== undefined && !(ACCIONES as readonly string[]).includes(entonces.accion)) {
    return { proyecto, motivos: [rechazo("VALOR_ENUM_DESCONOCIDO", { campo: "entonces.accion", valorRecibido: entonces.accion, dominioValido: ACCIONES })] }
  }
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
  if (cuando?.umbral !== undefined && !Number.isFinite(cuando.umbral.valor)) {
    return { proyecto, motivos: [rechazo("UMBRAL_NO_FINITO", { valor: String(cuando.umbral.valor) })] }
  }
  const sensor = cuando?.sensor === undefined ? undefined : proyecto.componentes.find((c) => c.id === cuando.sensor)
  if (cuando?.sensor !== undefined && !sensor) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: cuando.sensor })] }
  const actuador = entonces?.actuador === undefined ? undefined : proyecto.componentes.find((c) => c.id === entonces.actuador)
  if (entonces?.actuador !== undefined && !actuador) return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { componente: entonces.actuador })] }
  // CAPACIDAD_NO_DECLARADA sólo cuando la capacidad está presente Y el sensor también
  // (sin sensor no hay catálogo contra el cual comprobarla: lo diagnostica `validar-tecnico.ts`).
  if (cuando?.capacidad !== undefined && sensor) {
    const capacidadDeclarada = catalogo.obtenerComponente(sensor.tipo)?.capacidades.some((cap) => cap.id === cuando.capacidad)
    if (!capacidadDeclarada) {
      return { proyecto, motivos: [rechazo("CAPACIDAD_NO_DECLARADA", { componente: sensor.id, capacidad: cuando.capacidad })] }
    }
  }
  const idExistente = payload.comportamiento.id
  const esReemplazo = idExistente !== undefined && proyecto.comportamientos.some((b) => b.id === idExistente)
  if (esReemplazo) {
    const nueva: ComportamientoRegla = { id: idExistente, ...(cuando ? { cuando } : {}), ...(entonces ? { entonces } : {}) }
    // Phase 1.1 (hallazgo externo RX-04, MENOR): un reemplazo (upsert sobre un id YA
    // existente) commiteaba con `motivos:[]` — ningún rastro de que la intención
    // ANTERIOR con ese id fue descartada (brief §12: "reasons[]... también documenta
    // decisiones deterministas exitosas"). Mismo patrón YA establecido en el núcleo
    // para una decisión determinista que SÍ cambia algo silenciosamente
    // (`UNIDAD_CONVERTIDA`, `catalogo.ts`/`reemplazarSensor`, severidad `info`, sin
    // `clasificacion` — reusado también dentro de `aplicarCambiarComponente` acá
    // mismo): "rama A" (nada cambia) no emite motivo, pero una decisión que SÍ
    // reemplaza algo, sí. La semántica upsert NO cambia — sigue commiteando igual.
    const motivoReemplazo: Motivo = { codigo: "COMPORTAMIENTO_REEMPLAZADO", categoria: "operacion", severidad: "info", datos: { comportamiento: idExistente } }
    return { proyecto: { ...proyecto, comportamientos: proyecto.comportamientos.map((b) => (b.id === idExistente ? nueva : b)) }, motivos: [motivoReemplazo] }
  }
  if (contadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)) {
    return { proyecto, motivos: [motivoContadorExcedeEnteroSeguro(proyecto.siguienteIdLocal)] }
  }
  const id = formatearIdLocal("beh", proyecto.siguienteIdLocal)
  const nueva: ComportamientoRegla = { id, ...(cuando ? { cuando } : {}), ...(entonces ? { entonces } : {}) }
  return {
    proyecto: { ...proyecto, siguienteIdLocal: proyecto.siguienteIdLocal + 1, comportamientos: [...proyecto.comportamientos, nueva] },
    motivos: [],
  }
}

// ── QuitarComportamiento ─────────────────────────────────────────────────────────────

function aplicarQuitarComportamiento(proyecto: Proyecto, payload: { comportamiento: string }): ResultadoAplicacion {
  const reglaQuitada = proyecto.comportamientos.find((b) => b.id === payload.comportamiento)
  if (!reglaQuitada) {
    return { proyecto, motivos: [rechazo("REFERENCIA_INEXISTENTE", { comportamiento: payload.comportamiento })] }
  }
  // Mismo patrón que `COMPORTAMIENTO_REEMPLAZADO`: info, sin `clasificacion`. Lleva la
  // regla COMPLETA para que un undo futuro pueda restaurarla.
  const motivoQuitado: Motivo = { codigo: "COMPORTAMIENTO_QUITADO", categoria: "operacion", severidad: "info", datos: { comportamiento: payload.comportamiento, reglaQuitada } }
  return { proyecto: { ...proyecto, comportamientos: proyecto.comportamientos.filter((b) => b.id !== payload.comportamiento) }, motivos: [motivoQuitado] }
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
    if (!t.asignable) continue
    pinesNuevos[t.id] = componente.pines[t.id] ?? null
  }
  const componenteCambiado: Componente = { ...componente, tipo: payload.tipoNuevo, pines: pinesNuevos }

  const motivos: Motivo[] = []
  const comportamientos = proyecto.comportamientos.map((b) => {
    if (b.cuando?.sensor !== payload.componente) return b // no relacionado (o sin slot `cuando`): MISMA referencia
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
  // Phase 1.2 (hallazgo externo REA-03, MAYOR — re-auditoría externa AUD-B-01,
  // `reaudit/AUD-B/scripts/04_toctou_eco_ejecutarOperacion.mjs`): materializa el sobre
  // UNA SOLA VEZ, ACÁ, en la frontera — la MISMA copia alimenta tanto el núcleo de
  // aplicación (`aplicarOperacionMaterializada`, que decide qué se aplica de VERDAD
  // al proyecto) como el eco (`idOperacion`/`idTransaccion`/`baseRevision`) más abajo.
  //
  // Antes de este fix, esta función llamaba a `aplicarOperacion` (que materializaba
  // su PROPIA copia puertas adentro, nunca expuesta) y LUEGO materializaba, de forma
  // INDEPENDIENTE, el MISMO parámetro `operacion` crudo una segunda vez, sólo para
  // leer estos tres campos del eco — dos pasadas de materialización sobre el mismo
  // objeto de entrada, nunca la misma copia reusada. Un sobre que es un Proxy cuyos
  // traps `ownKeys`/`getOwnPropertyDescriptor` son ESTATOSOS (devuelven algo distinto
  // en la 2ª pasada completa que en la 1ª) hacía que la pasada que decide la
  // aplicación divergiera de la pasada que arma el eco: el llamador veía un
  // `ResultadoOperacion.idOperacion`/`baseRevision` que NO correspondía a la
  // operación que realmente se aplicó — exactamente lo que la cabecera de
  // `datos-planos.ts` (IR-SPEC.md §6.6) prohíbe: "no puede existir una 'segunda
  // lectura' que diverja de la primera". Con la materialización UNIFICADA acá, no hay
  // ninguna segunda pasada que pueda divergir: `aplicarOperacionMaterializada` y el
  // eco de abajo leen exactamente el mismo objeto ya materializado.
  //
  // Si la materialización falla, no hay ningún campo seguro que ecoar: se usan los
  // mismos valores por defecto de siempre (Phase 1.1 RX2-01).
  // Phase 1.1 (RX4, hallazgo externo RX4-01, CRITICO — cuarta revision adversarial
  // independiente, RX4_REPORT.md): `materializarDatosPlanos` acepta legitimamente un
  // `null` (o cualquier otro dato plano no-objeto) como valor RAIZ — es JSON valido,
  // y este modulo nunca decide si esa es la forma correcta para el consumidor. El eco
  // sólo tiene sentido si el sobre materializado es, de hecho, un objeto plano — si no
  // lo es, no hay ningun campo real que ecoar (mismos valores por defecto que cuando
  // la materializacion falla del todo); el sobre no-objeto se deja pasar igual a
  // `aplicarOperacionMaterializada`, que lo clasifica con `SOBRE_OPERACION_INVALIDO`
  // vía `analizarSobreOperacion` (mismo camino que tomaba `aplicarOperacion` antes de
  // este fix).
  const materializado = materializarDatosPlanos<unknown>(operacion, "operacion")

  const { proyecto: proyectoAplicado, motivos: motivosPropios } = materializado.ok
    ? aplicarOperacionMaterializada(proyecto, materializado.valor as SobreOperacion, catalogo)
    : { proyecto, motivos: [motivoEntradaNoPlano("operacion", materializado)] }

  const sobreMaterializado = materializado.ok && esObjetoPlano(materializado.valor) ? materializado.valor : null
  const idOperacionEco = sobreMaterializado ? (sobreMaterializado.idOperacion as SobreOperacion["idOperacion"]) : ""
  const idTransaccionEco = sobreMaterializado ? (sobreMaterializado.idTransaccion as SobreOperacion["idTransaccion"]) : undefined
  const baseRevisionEco = sobreMaterializado ? (sobreMaterializado.baseRevision as SobreOperacion["baseRevision"]) : 0

  if (motivosPropios.some((m) => m.clasificacion === "rechazo")) {
    return {
      ok: false,
      idOperacion: idOperacionEco,
      idTransaccion: idTransaccionEco,
      baseRevision: baseRevisionEco,
      revisionActual: baseRevisionEco,
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
      idOperacion: idOperacionEco,
      idTransaccion: idTransaccionEco,
      baseRevision: baseRevisionEco,
      revisionActual: baseRevisionEco,
      motivos: [...motivosPropios, ...motivosValidacion],
      proyecto,
    }
  }

  return {
    ok: true,
    idOperacion: idOperacionEco,
    idTransaccion: idTransaccionEco,
    baseRevision: baseRevisionEco,
    revisionActual: baseRevisionEco,
    motivos: [...motivosPropios, ...motivosValidacion],
    proyecto: proyectoAplicado,
  }
}
