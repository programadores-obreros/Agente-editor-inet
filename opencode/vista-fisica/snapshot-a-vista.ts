// Adaptador IR → vista física — Phase 2, Slice 1 (ARCH-C, PHASE_2_SLICE_1_DESIGN.md
// §2.6). PURO: sin DOM, sin `node:`, sin I/O. `proyectarVista(proyecto, catalogo)`
// recibe la IR (`nucleo/ir.ts::Proyecto`) + el catálogo (`nucleo/catalogo.ts`) y
// devuelve un `ModeloDeVista` (`modelo-vista.ts`) — datos planos, serializables,
// deterministas.
//
// Reglas duras (BOARD-CONTRACT, PHASE_2_SLICE_1_DESIGN.md §2.6):
// - NUNCA reimplementa una regla eléctrica: los GPIO ofrecidos salen ÚNICAMENTE de
//   `asignarPin()` (`nucleo/catalogo.ts`), pin por pin — la MISMA función que usa el
//   Engine, nunca una copia.
// - Los backend ids (el tag de Wokwi) son datos OPACOS de render, nunca identidad —
//   se leen tal cual de `Placa.backends.wokwi.elemento`/`wokwi-render-datos.ts`.
// - Los motivos se proyectan TAL CUAL de `validarProyecto()`/`derivarReadiness()` —
//   la vista nunca inventa una causa ni reclasifica severidad.
// - `circuito.ts` NO se importa (prohibido en Fase 1) — sólo se reusan tablas de
//   datos ya PORTADAS en `wokwi-render-datos.ts`, con cita de origen.
// - `pinouts.json` NO es una fuente acá — no es un catálogo de placa (BOARD-CONTRACT
//   §5).
//
// Límite conocido, heredado y NO resuelto por este módulo (informe ARCH-C §7.1,
// diseño §2.6): `asignarPin()` filtra por `RegistroPin.capacidades`
// (salidaDigital/entradaDigital/pwm/adc) — eso SÍ excluye los pines `soloEntrada`
// (su `capacidades.salidaDigital` es `false`, `nucleo/placas.ts::crearPinEsp32`).
// Pero `asignarPin()` NUNCA mira `RegistroPin.restricciones`
// (flashReservado/strapping/uartUsb): ningún validador de Fase 1 consume ese campo
// hoy (verificado: `rg restriccion -i` sobre `validar-tecnico.ts`/`catalogo.ts` da
// cero resultados). Esta vista NO cierra ese gap por su cuenta — mostraría como
// "disponible para el ánodo" un GPIO reservado a flash (6-11) o de arranque
// (strapping: 0/2/12/15) si el catálogo lo acepta. Cerrarlo es una decisión de
// producto sobre `nucleo/catalogo.ts`, no de este adaptador.

import type { Proyecto, Componente } from "../nucleo/ir.ts"
import type { Catalogo, Terminal, Requisito } from "../nucleo/catalogo.ts"
import type { RegistroPin, Placa } from "../nucleo/placas.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import { asignarPin } from "../nucleo/catalogo.ts"
import { validarProyecto, derivarReadiness } from "../nucleo/validar.ts"
import { nombreWokwiDePin, ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO, ATRIBUTOS_POR_TIPO, ESCALA_WOKWI_POR_PLACA } from "./wokwi-render-datos.ts"
import { etiquetaDeTerminal } from "./etiquetas-terminales.ts"
import { explicacionDeMotivo, type ResolverNombreDeComponente } from "./explicaciones-motivos.ts"
import type { ModeloDeVista, ComponenteVista, TerminalVista, CableVista, ExtremoCableVista, OpcionGpioVista, PlacaVista, MotivoVista } from "./modelo-vista.ts"

/**
 * Candidatos de GPIO para UN terminal — consulta `asignarPin()` (`nucleo/catalogo.ts`)
 * pin por pin sobre TODOS los pines de la placa vigente. Nunca reimplementa la regla:
 * un pin queda afuera si y sólo si `asignarPin(terminal, pin) !== null` (rechazo
 * técnico), exactamente el mismo criterio que usa `validarTecnico()` para diagnosticar
 * `CAPACIDAD_PIN_INCOMPATIBLE` post-commit.
 *
 * Revisión post red-team (Hallazgo B1, MAJOR, P2-RED-B/INFORME.md): ADEMÁS, un pin
 * sólo se ofrece si `nombreWokwiDePin()` le da un nombre REAL (no `null`) — la
 * intersección entre "el Engine/catálogo lo acepta" y "el renderer lo puede
 * dibujar". Es una restricción de PRESENTACIÓN (no se puede dibujar un cable a un
 * pin que no existe en la pieza Wokwi), nunca una regla eléctrica nueva: el gap de
 * `asignarPin()` no filtrando `RegistroPin.restricciones` sigue siendo el mismo,
 * documentado y NO cerrado acá (`DECISIONS.md`, backlog de Fase 1).
 *
 * `placaId === null` (proyecto sin placa elegida) da SIEMPRE `[]` — no hay pines que
 * ofrecer todavía (mismo criterio que `detectarIncompleto`, `nucleo/validar.ts`).
 */
export function gpiosCandidatosPara(catalogo: Catalogo, placaId: string | null, terminal: Terminal): readonly OpcionGpioVista[] {
  if (placaId === null) return []
  const pines = catalogo.pinesDePlaca(placaId)
  if (!pines) return []
  const candidatos: OpcionGpioVista[] = []
  for (const pin of pines) {
    if (asignarPin(terminal, pin) !== null) continue // rechazo técnico del catálogo
    const nombreWokwi = nombreWokwiDePin(pin)
    if (nombreWokwi === null) continue // sin pin fisico real en el renderer — no se puede ofrecer
    candidatos.push({ pinSemantico: pin.id, nombreWokwi })
  }
  return candidatos
}

/**
 * Rol pedagógico Entrada/Salida — Fase 2, Slice 2 (§3.3, HD-S2-7). Función PURA,
 * despacha ÚNICAMENTE por `ComponenteCatalogo.clase` (`nucleo/catalogo.ts:88`:
 * `"sensor" | "actuador" | "pasivo" | "entrada"`), nunca por `tipo`/id de
 * componente. `"entrada"`/`"sensor"` → `"entrada"` (el pulsador es `clase:
 * "entrada"`, un sensor como el DHT22 es `clase: "sensor"` — ambos son entradas
 * pedagógicas); `"actuador"` → `"salida"` (el LED); `"pasivo"` → `null` (la
 * resistencia, sin rótulo). Una `clase` que este mapeo no reconoce todavía (Fase 2+)
 * también da `null` — NUNCA se inventa un rol para una clase desconocida. El browser
 * (`plan-de-pintado.js`/`pintar.js`) sólo recibe el resultado ya resuelto acá; nunca
 * repite este despacho ni ninguna tabla de clases/tipos por su cuenta.
 */
export function rolDeClase(clase: string): "entrada" | "salida" | null {
  if (clase === "entrada" || clase === "sensor") return "entrada"
  if (clase === "actuador") return "salida"
  return null
}

/**
 * Fase 2, Slice 2 (§3.4, HD-S2-8): resuelve un `nombreVisible` a partir de CUALQUIERA
 * de las dos formas que los `datos`/`entidad` de un `Motivo` usan (verificado contra
 * `nucleo/catalogo.ts`/`validar-tecnico.ts`, ver ARCH-S2-VALIDATION/INFORME.md):
 * - un `Componente.id` de INSTANCIA ("cmp-0" — ej. `PIN_OCUPADO.datos.ocupadoPor`,
 *   `Motivo.entidad.id`);
 * - un `ComponenteCatalogo.id` de TIPO ("led" — ej.
 *   `REQUISITO_INSATISFECHO.datos.componente`, que es `catalogoComponente.id`, no una
 *   instancia).
 *
 * Intenta primero como instancia (busca en `proyecto.componentes`); si no encuentra
 * ninguna, trata el valor DIRECTAMENTE como tipo de catálogo. Si tampoco hay
 * `ComponenteCatalogo` para ese tipo, devuelve el propio `idOTipo` sin cambios —
 * nunca inventa un nombre (briefing: "usá el valor crudo disponible o el id").
 */
function resolverNombreDeComponente(proyecto: Proyecto, catalogo: Catalogo): ResolverNombreDeComponente {
  return (idOTipo) => {
    const instancia = proyecto.componentes.find((c) => c.id === idOTipo)
    const tipo = instancia ? instancia.tipo : idOTipo
    return catalogo.obtenerComponente(tipo)?.nombreVisible ?? idOTipo
  }
}

/**
 * `datos` que le llegan a `explicacionDeMotivo` — `motivo.datos` TAL CUAL, salvo que
 * agrega `componente` = `motivo.entidad.id` cuando el motivo NO trae ya un campo
 * `componente` propio (ej. `CAPACIDAD_PIN_INCOMPATIBLE`/`PIN_SIN_PULLUP_INTERNO`: su
 * `datos` no tiene `componente`, sólo `entidad`) — nunca sobrescribe un
 * `datos.componente` que ya exista (ej. `REQUISITO_INSATISFECHO`, donde `componente`
 * es el TIPO de catálogo, no la instancia de `entidad`). Nunca inventa un campo que
 * ni `datos` ni `entidad` traen.
 */
function datosParaExplicacion(motivo: Motivo): Readonly<Record<string, unknown>> {
  const base = motivo.datos ?? {}
  if (motivo.entidad?.tipo === "componente" && base.componente === undefined) {
    return { ...base, componente: motivo.entidad.id }
  }
  return base
}

function resolverDestinoFijo(terminal: Terminal): string | undefined {
  if (terminal.destinoFijo === undefined) return undefined
  return typeof terminal.destinoFijo === "string" ? terminal.destinoFijo : terminal.destinoFijo.externo
}

/** Estado de UN terminal, proyectado desde la IR (`componente.pines`) + el catálogo
 * (`terminal.electrica`/`terminal.destinoFijo`) + la placa vigente (para resolver el
 * nombre Wokwi del pin asignado). Nunca inventa un pin/destino: si la IR no tiene el
 * dato, el estado es `sinAsignar`/`puente`.
 *
 * Fase 3, Wave 0 (F-09): `etiqueta` sale de `etiquetas-terminales.ts` (tabla de
 * PRESENTACIÓN), compartida por las cuatro variantes — nunca del nombre Wokwi
 * (`nombreWokwiPieza`, que para el pulsador es literalmente `"1.l"`/`"2.l"`, el pin
 * INTERNO del custom element, no un texto para un estudiante). */
function resolverTerminal(componente: Componente, terminal: Terminal, pinesDePlaca: readonly RegistroPin[], nombreWokwiPieza: string | null): TerminalVista {
  const etiqueta = etiquetaDeTerminal(terminal.id)
  if (terminal.electrica === "riel-fijo") {
    const destino = resolverDestinoFijo(terminal)
    if (destino === undefined) return { estado: "puente", nombreWokwiPieza, etiqueta }
    return { estado: "rielFijo", destino, nombreWokwiPieza, etiqueta }
  }
  const pinAsignado = componente.pines[terminal.id] ?? null
  if (pinAsignado === null) return { estado: "sinAsignar", nombreWokwiPieza, etiqueta }
  const pinReal = pinesDePlaca.find((p) => p.id === pinAsignado)
  // Si el pin asignado no está en la placa vigente (documento viejo tras un cambio de
  // placa, por ejemplo) no hay `RegistroPin` real que traducir — se muestra el propio
  // id semántico como último recurso, nunca se inventa un nombre Wokwi de la nada.
  const nombreWokwiPlaca = pinReal ? nombreWokwiDePin(pinReal) : pinAsignado
  return { estado: "asignado", pinSemantico: pinAsignado, nombreWokwiPlaca, nombreWokwiPieza, etiqueta }
}

// Las CUATRO variantes de `TerminalVista` (`modelo-vista.ts`) comparten el campo
// `nombreWokwiPieza` — accesible sin narrowing previo.
function extremoDeTerminal(componenteId: string, terminalId: string, terminalVista: TerminalVista): ExtremoCableVista {
  return { tipo: "terminal", componente: componenteId, terminal: terminalId, nombreWokwi: terminalVista.nombreWokwiPieza }
}

// ════════════════════════════════════════════════════════════════════════════════════
// HD-W0-B (PHASE_3_PRE_HUMAN_TEST_DESIGN.md §2, "la resistencia se ve en serie")
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Una pareja (terminal CON pin asignado, instancia que satisface su
 * `resistencia-serie`) que el contrato visual del diseño permite fusionar en una
 * cadena de 3 nodos. `ancla` = el terminal del componente que DECLARA el requisito
 * (`componenteId`/`terminalId`); `resistenciaId`/`terminalConectado`/`terminalLibre`
 * = la instancia que lo satisface, su pata unida por la `Conexion` real y su ÚNICA
 * otra pata. `ohmios` viaja TAL CUAL de `Requisito.spec.ohmios` — `unknown`, nunca
 * asumido numérico acá (eso lo decide quien lo consume, más abajo).
 */
interface FusionSerie {
  readonly componenteId: string
  readonly terminalId: string
  readonly resistenciaId: string
  readonly terminalConectado: string
  readonly terminalLibre: string
  readonly conexionId: string
  readonly ohmios: unknown
}

/**
 * PFX-2 (RED-PHT-AUDITABILITY F2): `evaluarRequisito` (`nucleo/catalogo.ts:189`)
 * tiene su PROPIO fallback a `"resistencia"` cuando `spec.tipoComponente` no es un
 * string — una decisión del NÚCLEO, fuera de este alcance (no se toca `nucleo/`).
 * Esta función NO lo copia: antes lo hacía (duplicando la misma decisión en dos
 * lugares, el riesgo real que F2 señaló — un cambio futuro al fallback del núcleo
 * podía divergir en silencio del de la vista). Acá, sin ese dato explícito, no hay
 * tipo que buscar — `null` fail-closed, nunca una fusión "porque total casi siempre
 * es una resistencia": `resolverFusionesSerie` nunca fusiona ante `null`.
 */
function tipoEsperadoDeRequisito(req: Requisito): string | null {
  return typeof req.spec.tipoComponente === "string" ? req.spec.tipoComponente : null
}

function claveAncla(componenteId: string, terminalId: string): string {
  return `${componenteId}\u0000${terminalId}`
}

/**
 * Deriva, para TODO el proyecto, qué parejas (terminal-con-pin, instancia-puente)
 * cumplen el contrato visual del diseño §2 — puro despacho por
 * `Requisito.tipo`/`enTerminal`/`spec.tipoComponente`, NUNCA por id/tipo de
 * componente literal ("led"/"resistencia"/"anodo" no aparecen acá abajo): cualquier
 * componente futuro que declare `resistencia-serie` sobre cualquier terminal entra
 * por el mismo camino.
 *
 * Fail-closed (briefing: "ante cualquier ambigüedad") — NINGUNA fusión si:
 * - el terminal que declara el requisito no tiene pin asignado todavía;
 * - hay CERO o MÁS DE UNA `Conexion` real entre ese terminal y una instancia del
 *   `spec.tipoComponente` esperado (ambiguo: ¿cuál es "la" serie?);
 * - la instancia candidata no tiene, en su catálogo, EXACTAMENTE un terminal además
 *   del conectado (una forma de "puente" de más de 2 patas no tiene una "libre"
 *   obvia — nunca se adivina cuál);
 * - esa instancia participa en alguna OTRA `Conexion` de CUALQUIER componente (una
 *   resistencia compartida por dos LEDs no es una serie clara para ninguno de los
 *   dos — diseño §2, "R no tiene otras conexiones").
 *
 * `terminalesDe` es el MISMO resolver que ya usa el resto de `proyectarVista` (abajo)
 * — nunca una segunda lectura de `Componente.pines`.
 */
function resolverFusionesSerie(proyecto: Proyecto, catalogo: Catalogo, terminalesDe: (componenteId: string) => Readonly<Record<string, TerminalVista>>): ReadonlyMap<string, FusionSerie> {
  const porAncla = new Map<string, FusionSerie>()
  for (const componente of proyecto.componentes) {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    if (!compCatalogo) continue
    for (const req of compCatalogo.requisitos) {
      if (req.tipo !== "resistencia-serie" || req.enTerminal === undefined) continue
      const terminalId = req.enTerminal
      const terminalVista = terminalesDe(componente.id)[terminalId]
      if (!terminalVista || terminalVista.estado !== "asignado") continue // sin pin, nada que fusionar

      const tipoEsperado = tipoEsperadoDeRequisito(req)
      if (tipoEsperado === null) continue // PFX-2: sin spec.tipoComponente declarado como string, fail-closed — nunca se asume "resistencia"
      const candidatas = proyecto.conexiones.filter((cx) => {
        const propio = cx.desde.componente === componente.id && cx.desde.terminal === terminalId ? cx.desde : cx.hasta.componente === componente.id && cx.hasta.terminal === terminalId ? cx.hasta : null
        if (!propio) return false
        const otro = propio === cx.desde ? cx.hasta : cx.desde
        const instanciaOtro = proyecto.componentes.find((c) => c.id === otro.componente)
        return instanciaOtro?.tipo === tipoEsperado
      })
      if (candidatas.length !== 1) continue // cero o ambiguo: fail-closed

      const conexion = candidatas[0]
      if (!conexion) continue // defensa en profundidad (candidatas.length === 1 ya lo garantiza)
      const extremoR = conexion.desde.componente === componente.id && conexion.desde.terminal === terminalId ? conexion.hasta : conexion.desde
      const instanciaR = proyecto.componentes.find((c) => c.id === extremoR.componente)
      if (!instanciaR) continue
      const catalogoR = catalogo.obtenerComponente(instanciaR.tipo)
      if (!catalogoR) continue

      const terminalesLibres = catalogoR.terminales.filter((t) => t.id !== extremoR.terminal)
      const terminalLibre = terminalesLibres.length === 1 ? terminalesLibres[0] : undefined
      if (!terminalLibre) continue // cero o más de una pata libre: forma de puente ambigua, fail-closed

      const otrasConexionesDeR = proyecto.conexiones.filter((cx) => cx.desde.componente === instanciaR.id || cx.hasta.componente === instanciaR.id)
      if (otrasConexionesDeR.length !== 1) continue // R comprometido con otra cosa: fail-closed

      porAncla.set(claveAncla(componente.id, terminalId), {
        componenteId: componente.id,
        terminalId,
        resistenciaId: instanciaR.id,
        terminalConectado: extremoR.terminal,
        terminalLibre: terminalLibre.id,
        conexionId: conexion.id,
        ohmios: req.spec.ohmios,
      })
    }
  }
  return porAncla
}

/**
 * Corrección pedagógica del orquestador sobre la primera entrega de HD-W0-B (diseño
 * §2: "si visualmente sigue pareciendo colgante → FAIL, aunque los tests estén en
 * verde") — ADYACENCIA: en el orden en que `plan-de-pintado.js` dibuja las piezas
 * (`ModeloDeVista.componentes`, el array completo, nunca uno nuevo), la instancia
 * fusionada se reubica INMEDIATAMENTE ANTES del componente al que sirve — nunca
 * después, nunca en su posición natural si esa posición la deja lejos (verificado
 * real en Chromium: antes de esto, un Pulsador en el medio de `Proyecto.componentes`
 * la dejaba pegada a OTRA pieza).
 *
 * Nunca toca el NOMBRE ("LED"/"LED 2"): ese ordinal sigue derivándose del orden
 * ORIGINAL de `Proyecto.componentes` (comentario de más arriba, F-09) — esta función
 * sólo reordena el ARRAY de salida, un paso puramente de PRESENTACIÓN, después de
 * que los nombres ya están resueltos. Sin fusiones, devuelve `componentes` tal cual
 * (misma referencia, cero trabajo de más).
 *
 * PFX-1 (RED-PHT-PHYSICAL-TRUTH F1): de paso, estampa `ComponenteVista.agrupadoCon`
 * en la pieza fusionada — el mismo dato que ya decide este reordenamiento (el id del
 * ancla), nunca un segundo cálculo. `plan-de-pintado.js`/`pintar.js` sólo lo leen
 * para agrupar visualmente (mismo contenedor, un único rótulo de rol — el del
 * ancla); esta función no sabe nada de DOM ni de `<figure>`.
 */
function reordenarParaAdyacencia(componentes: readonly ComponenteVista[], fusionesSerie: ReadonlyMap<string, FusionSerie>): readonly ComponenteVista[] {
  if (fusionesSerie.size === 0) return componentes
  const anclaPorResistencia = new Map<string, string>() // resistenciaId -> componenteId que la requiere
  for (const fusion of fusionesSerie.values()) anclaPorResistencia.set(fusion.resistenciaId, fusion.componenteId)

  const porId = new Map(componentes.map((c) => [c.id, c] as const))
  const resultado: ComponenteVista[] = []
  for (const componente of componentes) {
    // Una pieza fusionada NUNCA se dibuja en su posición natural — sólo se agrega
    // una vez, justo antes de su ancla (más abajo), sin importar si en la IR
    // aparecía antes, después o lejos de ella.
    if (anclaPorResistencia.has(componente.id)) continue
    for (const [resistenciaId, anclaId] of anclaPorResistencia) {
      if (anclaId !== componente.id) continue
      const pieza = porId.get(resistenciaId)
      if (pieza) resultado.push({ ...pieza, agrupadoCon: anclaId })
    }
    resultado.push(componente)
  }
  return resultado
}

export function proyectarVista(proyecto: Proyecto, catalogo: Catalogo): ModeloDeVista {
  const placaId = proyecto.placa
  const placaCatalogo: Placa | undefined = placaId !== null ? catalogo.placas.find((p) => p.id === placaId) : undefined
  const placa: PlacaVista | null = placaCatalogo
    ? { id: placaCatalogo.id, elementoWokwi: placaCatalogo.backends.wokwi.elemento, escala: ESCALA_WOKWI_POR_PLACA[placaCatalogo.id] ?? 1 }
    : null
  const pinesDePlaca: readonly RegistroPin[] = (placaId !== null ? catalogo.pinesDePlaca(placaId) : undefined) ?? []

  // Fase 3, Wave 0 (F-09): ordinal ESTABLE por tipo — el PRIMER componente de un tipo
  // dado nunca lleva sufijo ("LED"), el segundo del MISMO tipo sí ("LED 2"), etc. En
  // el orden de `Proyecto.componentes` (nunca reordenado): el mismo criterio
  // determinista que ya usa el resto del adaptador.
  const ocurrenciasPorTipo = new Map<string, number>()
  const componentes: ComponenteVista[] = proyecto.componentes.map((componente) => {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    const elementoWokwi = ELEMENTO_WOKWI_POR_TIPO[componente.tipo] ?? null
    const atributos = ATRIBUTOS_POR_TIPO[componente.tipo] ?? {}
    const rol = compCatalogo ? rolDeClase(compCatalogo.clase) : null
    const terminales: Record<string, TerminalVista> = {}
    if (compCatalogo) {
      const tablaPieza = TERMINAL_WOKWI_POR_TIPO[componente.tipo]
      for (const terminal of compCatalogo.terminales) {
        const nombreWokwiPieza = tablaPieza?.[terminal.id] ?? null
        terminales[terminal.id] = resolverTerminal(componente, terminal, pinesDePlaca, nombreWokwiPieza)
      }
    }
    const nombreBase = compCatalogo ? compCatalogo.nombreVisible : componente.tipo // fail-closed: nunca inventa un nombre
    const ocurrencia = (ocurrenciasPorTipo.get(componente.tipo) ?? 0) + 1
    ocurrenciasPorTipo.set(componente.tipo, ocurrencia)
    const nombre = ocurrencia === 1 ? nombreBase : `${nombreBase} ${ocurrencia}`
    // PFX-1: `agrupadoCon` se resuelve recién en `reordenarParaAdyacencia` (abajo,
    // necesita la fusión ya calculada) — acá siempre `null`, nunca una segunda
    // decisión de agrupamiento.
    return { id: componente.id, tipo: componente.tipo, nombre, elementoWokwi, atributos, rol, terminales, agrupadoCon: null }
  })

  function terminalesDe(componenteId: string): Readonly<Record<string, TerminalVista>> {
    return componentes.find((c) => c.id === componenteId)?.terminales ?? {}
  }

  // Mismo fallback que ya usaba el bucle de `Conexion` de abajo para un terminal que
  // el modelo no resolvió (no debería pasar en producción: todo cable sale de un
  // componente del MISMO modelo) — ahora compartido también por la fusión HD-W0-B,
  // nunca una segunda copia del objeto `"puente"` por defecto.
  function terminalVistaDe(componenteId: string, terminalId: string): TerminalVista {
    return terminalesDe(componenteId)[terminalId] ?? { estado: "puente", nombreWokwiPieza: null, etiqueta: etiquetaDeTerminal(terminalId) }
  }

  // HD-W0-B: qué parejas (terminal-con-pin, instancia-puente) fusionan en una cadena
  // de 3 nodos — ver `resolverFusionesSerie`.
  const fusionesSerie = resolverFusionesSerie(proyecto, catalogo, terminalesDe)

  // Corrección pedagógica del orquestador (diseño §2, "si visualmente sigue
  // pareciendo colgante → FAIL, aunque los tests estén en verde", verificado real en
  // Chromium): topológicamente correcta no alcanza — la cadena fusionada tiene que
  // leerse JUNTA. Cables: de asignaciones (pin↔terminal, incluido el riel fijo del
  // catálogo) + conexiones de la IR (terminal↔terminal) — nunca de un pin/riel
  // hardcodeado. CONTIGÜIDAD: cuando (componente,terminal) fusiona, la arista de la
  // `Conexion` real se emite ACÁ MISMO, inmediatamente después de la del pin —
  // mismo `cable-conexion-<id>` de siempre (nunca uno nuevo, la cantidad de aristas
  // no cambia), nunca al final del todo donde los cables de OTRO componente puedan
  // intercalarse en el medio. `conexionesFusionadasEmitidas` evita que el bucle de
  // abajo la vuelva a agregar.
  const cables: CableVista[] = []
  const conexionesFusionadasEmitidas = new Set<string>()
  for (const componente of proyecto.componentes) {
    for (const [terminalId, terminalVista] of Object.entries(terminalesDe(componente.id))) {
      const extremoTerminal = extremoDeTerminal(componente.id, terminalId, terminalVista)
      if (terminalVista.estado === "asignado") {
        const extremoPin: ExtremoCableVista = { tipo: "pinPlaca", pinSemantico: terminalVista.pinSemantico, nombreWokwi: terminalVista.nombreWokwiPlaca }
        // HD-W0-B: si este (componente,terminal) fusiona, el extremo del lado del
        // pin deja de ser el propio terminal y pasa a ser la pata LIBRE de la
        // instancia puente — corrección del orquestador sobre EXP-B: nunca la pata
        // conectada otra vez, siempre la que la IR deja sin usar.
        const fusion = fusionesSerie.get(claveAncla(componente.id, terminalId))
        const hastaPin = fusion ? extremoDeTerminal(fusion.resistenciaId, fusion.terminalLibre, terminalVistaDe(fusion.resistenciaId, fusion.terminalLibre)) : extremoTerminal
        cables.push({ id: `cable-pin-${componente.id}-${terminalId}`, desde: extremoPin, hasta: hastaPin })
        if (fusion) {
          const desde = extremoDeTerminal(fusion.resistenciaId, fusion.terminalConectado, terminalVistaDe(fusion.resistenciaId, fusion.terminalConectado))
          const hasta = extremoDeTerminal(fusion.componenteId, fusion.terminalId, terminalVistaDe(fusion.componenteId, fusion.terminalId))
          cables.push({ id: `cable-conexion-${fusion.conexionId}`, desde, hasta })
          conexionesFusionadasEmitidas.add(fusion.conexionId)
        }
      } else if (terminalVista.estado === "rielFijo") {
        cables.push({ id: `cable-riel-${componente.id}-${terminalId}`, desde: extremoTerminal, hasta: { tipo: "rielFijo", destino: terminalVista.destino } })
      }
      // "sinAsignar"/"puente": sin cable propio — un puente sólo se cablea si la IR
      // trae una `Conexion` real (bucle de abajo); inventar un cable para un terminal
      // sin dato sería mostrar una conexión que el estudiante nunca hizo.
    }
  }
  for (const conexion of proyecto.conexiones) {
    if (conexionesFusionadasEmitidas.has(conexion.id)) continue // ya se emitió arriba, contigua a su pin
    const desde = extremoDeTerminal(conexion.desde.componente, conexion.desde.terminal, terminalVistaDe(conexion.desde.componente, conexion.desde.terminal))
    const hasta = extremoDeTerminal(conexion.hasta.componente, conexion.hasta.terminal, terminalVistaDe(conexion.hasta.componente, conexion.hasta.terminal))
    cables.push({ id: `cable-conexion-${conexion.id}`, desde, hasta })
  }

  // GPIO ofrecidos: sólo para terminales que NO son riel-fijo (el catálogo declara
  // cuáles) — un terminal riel-fijo/puente nunca ofrece un selector, no tiene pin que
  // elegir.
  const gpiosDisponibles: Record<string, Record<string, readonly OpcionGpioVista[]>> = {}
  for (const componente of proyecto.componentes) {
    const compCatalogo = catalogo.obtenerComponente(componente.tipo)
    if (!compCatalogo) continue
    const porTerminal: Record<string, readonly OpcionGpioVista[]> = {}
    for (const terminal of compCatalogo.terminales) {
      if (terminal.electrica === "riel-fijo") continue
      porTerminal[terminal.id] = gpiosCandidatosPara(catalogo, placaId, terminal)
    }
    gpiosDisponibles[componente.id] = porTerminal
  }

  const motivosBase = validarProyecto(proyecto, catalogo)
  const readiness = derivarReadiness(proyecto, motivosBase)

  // Fase 2, Slice 2 (§3.4): cada motivo se proyecta TAL CUAL (mismo criterio de
  // siempre) MÁS una `explicacion` en texto llano — ver `explicarMotivos` más abajo.
  const motivos: readonly MotivoVista[] = explicarMotivos(motivosBase, proyecto, catalogo)

  // HD-W0-B (diseño §2, fila "Pieza"): el `value` (ohmios) de una instancia
  // FUSIONADA sale de `Requisito.spec.ohmios` — nunca un número fijo en
  // `ATRIBUTOS_POR_TIPO` (eso sería el mismo valor para CUALQUIER instancia del
  // tipo, aunque el catálogo declarara otro ohmiaje en otro requisito). Una
  // instancia que no fusiona con nada (huérfana o ambigua, fail-closed de arriba) no
  // tiene un ohmiaje conocido todavía — se deja SIN `value`: la pieza se dibuja
  // igual (gap cerrado), pero nunca se inventa el número.
  const ohmiosPorResistencia = new Map<string, string>()
  for (const fusion of fusionesSerie.values()) {
    if (typeof fusion.ohmios === "number" && Number.isFinite(fusion.ohmios)) ohmiosPorResistencia.set(fusion.resistenciaId, String(fusion.ohmios))
  }
  const componentesConValor: readonly ComponenteVista[] =
    ohmiosPorResistencia.size === 0
      ? componentes
      : componentes.map((c) => {
          const valor = ohmiosPorResistencia.get(c.id)
          return valor === undefined ? c : { ...c, atributos: { ...c.atributos, value: valor } }
        })

  // HD-W0-B (adyacencia): ver `reordenarParaAdyacencia` — sólo mueve piezas
  // fusionadas, justo antes de su ancla; el resto conserva su orden de siempre.
  const componentesOrdenados = reordenarParaAdyacencia(componentesConValor, fusionesSerie)

  return { placa, componentes: componentesOrdenados, cables, gpiosDisponibles, motivos, readiness }
}

/**
 * Fase 2, Slice 2 (W-S2-TOOL, §3.1 del diseño): la tool `proyecto-fisico`
 * (`opencode/tool/proyecto-fisico.ts`) necesita explicar los `Motivo[]` que devuelve
 * el motor DIRECTO (`servicio.aplicarTransaccion`/`servicio.proponer`) — un resultado
 * de transacción, no un `Snapshot` completo — sin pagar el costo de recalcular
 * cables/gpiosDisponibles/rol de `proyectarVista` (innecesario para ese caso de uso) y
 * SIN reimplementar el criterio de nombres/explicación en un segundo lugar.
 *
 * Reusa EXACTAMENTE los mismos dos helpers privados de este módulo
 * (`resolverNombreDeComponente`/`datosParaExplicacion`) que ya usa `proyectarVista` de
 * arriba — de hecho, `proyectarVista` llama a ESTA función para su propio campo
 * `motivos` (un solo lugar, nunca dos copias del mismo criterio).
 *
 * `proyecto` es el que da contexto para resolver `{componente}`/`{ocupadoPor}` —
 * para un lote recién aplicado/propuesto, el llamador pasa el `Proyecto` resultante
 * de la ÚLTIMA operación evaluada (incluye componentes creados EN el mismo lote); para
 * un rechazo de transporte (antes de tocar el motor), el llamador pasa el `Proyecto`
 * canónico vigente (`servicio.snapshot().proyecto`) — cualquiera de los dos alcanza
 * porque los códigos de rechazo de transporte/motor (`BASE_REVISION_INVALIDA`,
 * `BASE_REVISION_DESACTUALIZADA`, `ENTRADA_NO_ES_DATO_PLANO`, ...) no están en la
 * tabla de `explicaciones-motivos.ts` — dan `explicacion: null` sin mirar `nombres`.
 */
export function explicarMotivos(motivos: readonly Motivo[], proyecto: Proyecto, catalogo: Catalogo): readonly MotivoVista[] {
  const nombres = resolverNombreDeComponente(proyecto, catalogo)
  return motivos.map((motivo) => ({ ...motivo, explicacion: explicacionDeMotivo(motivo.codigo, datosParaExplicacion(motivo), nombres) }))
}
