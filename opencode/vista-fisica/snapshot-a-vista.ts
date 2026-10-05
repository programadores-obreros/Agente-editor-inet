// Adaptador IR → vista física — Phase 2, Slice 1 (ARCH-C, PHASE_2_SLICE_1_DESIGN.md
// §2.6). PURO: sin DOM, sin `node:`, sin I/O. `proyectarVista(proyecto, catalogo)`
// recibe la IR (`nucleo/ir.ts::Proyecto`) + el catálogo (`nucleo/catalogo.ts`) y
// devuelve un `ModeloDeVista` (`modelo-vista.ts`) — datos planos, serializables,
// deterministas.
//
// Reglas duras (BOARD-CONTRACT, PHASE_2_SLICE_1_DESIGN.md §2.6):
// - NUNCA reimplementa una regla eléctrica: los GPIO ofrecidos salen ÚNICAMENTE de
//   `ComponentKnowledge.pinesPermitidos` (`conocimiento/conocimiento.ts`), que usa las
//   MISMAS funciones del núcleo que el Engine (`asignarPin` + `evaluarRestriccionesPin`).
//   La vista sólo agrega la restricción de representación (ver `gpiosCandidatosPara`).
// - Los backend ids (el tag de Wokwi) son datos OPACOS de render, nunca identidad —
//   se leen tal cual del anexo de representación (`conocimiento/anexos/representacion.ts`).
// - Los motivos se proyectan TAL CUAL de `validarProyecto()`/`derivarReadiness()` —
//   la vista nunca inventa una causa ni reclasifica severidad.
// - `circuito.ts` NO se importa (prohibido en Fase 1) — sólo se reusan tablas de
//   datos ya PORTADAS en `wokwi-render-datos.ts`, con cita de origen.
// - `pinouts.json` NO es una fuente acá — no es un catálogo de placa (BOARD-CONTRACT
//   §5).
//
// Component System Foundation #1 (RT-9/D8): el límite que antes se documentaba acá
// (la vista ofrecía pines que `evaluarRestriccionesPin` marca bloqueantes, como
// GPIO34–39 para el pulsador) quedó cerrado al derivar las opciones de
// `ComponentKnowledge`. Los pines con un aviso NO bloqueante (strapping 2/12/15, UART
// 1/3) se siguen ofreciendo: son válidos, el motivo se muestra al validar.

import type { Proyecto, Componente, ComportamientoRegla } from "../nucleo/ir.ts"
import type { Catalogo, Terminal, Requisito } from "../nucleo/catalogo.ts"
import type { RegistroPin, Placa } from "../nucleo/placas.ts"
import type { Motivo } from "../nucleo/motivos.ts"
import { crearConocimiento, type ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { validarProyecto, derivarReadiness } from "../nucleo/validar.ts"
import { valorBooleanoDeCondicion } from "../nucleo/estado-booleano.ts"
// Component System Foundation #1 (F5): datos de render y textos salen de los ANEXOS de
// `conocimiento/` (representación, pedagogía es-AR), no del núcleo semántico.
import { nombreWokwiDePin, ELEMENTO_WOKWI_POR_TIPO, ELEMENTO_WOKWI_POR_PLACA, TERMINAL_WOKWI_POR_TIPO, ATRIBUTOS_POR_TIPO, ESCALA_WOKWI_POR_PLACA, ANCLAS_EQUIVALENTES_WOKWI_POR_TIPO, POTENCIA_WOKWI_POR_PLACA } from "../conocimiento/anexos/representacion.ts"
import { etiquetaDeTerminal, nombreDeComponente, nombreDePlaca, ZONAS_DEL_CIRCUITO, ETIQUETA_DE_TERMINAL_DE_POTENCIA, explicacionDeRequisito, etiquetaDeEstadoObjetivo } from "../conocimiento/anexos/pedagogia-es-AR.ts"
import { explicacionDeMotivo, type ResolverNombreDeComponente } from "./explicaciones-motivos.ts"
import { cuantitativasParaCrear, reconocerCondicionNumerica, ROTULO_COMPARADOR, COMPLEMENTO_COMPARADOR, cantidadEnTexto, ayudaDeRango, rangoEnTexto, simboloDe, formatearNumero, type CondicionNumerica } from "./condicion-numerica.ts"
import { COMPARADORES } from "../nucleo/ir.ts"
import type { ModeloDeVista, ComponenteVista, TerminalVista, CableVista, ExtremoCableVista, OpcionGpioVista, PlacaVista, MotivoVista, ReglaVista, ZonaVista, FraseReglaVista, OpcionEstadoVista, OpcionSalidaVista, TrazaReglaVista, ReferenciaVista, OpcionesReglaVista, SlotFraseVista, OpcionSlotVista } from "./modelo-vista.ts"

/**
 * Candidatos de GPIO para UN terminal de UN tipo de componente.
 *
 * Component System Foundation #1 (RT-9/D8): la vista ya NO decide qué GPIO son válidos.
 * El conjunto sale ÚNICAMENTE de `ComponentKnowledge.pinesPermitidos` (eléctricamente
 * válido y lógicamente asignable para ESE uso: compatible con `asignarPin` y sin motivo
 * bloqueante de `evaluarRestriccionesPin` — p. ej. GPIO34–39 para el pulsador, sin
 * pull-up interno). Esta función sólo le aplica una restricción EXPLÍCITA de
 * REPRESENTACIÓN: `nombreWokwiDePin()` tiene que dar un pin real de la pieza
 * (`representableByCurrentRenderer`). Un GPIO válido que el renderer no puede dibujar
 * (GPIO0) queda afuera de las opciones de la vista, pero sigue siendo válido para el
 * conocimiento y para el Engine: nunca se lo redefine como inválido.
 *
 * El orden es una decisión de presentación: el de la placa (`placa.pines`), igual que
 * antes. El Engine sigue siendo la defensa final (`AsignarPin` + `validarProyecto`).
 *
 * `placaId === null` (proyecto sin placa elegida) da SIEMPRE `[]`.
 */
export function gpiosCandidatosPara(conocimiento: ComponentKnowledge, placaId: string | null, tipo: string, terminalId: string): readonly OpcionGpioVista[] {
  if (placaId === null) return []
  const pines = conocimiento.placa(placaId)?.pines
  if (!pines) return []
  const permitidos = new Set(conocimiento.pinesPermitidos(placaId, tipo, terminalId).map((p) => p.id))
  const candidatos: OpcionGpioVista[] = []
  for (const pin of pines) {
    if (!permitidos.has(pin.id)) continue // autoridad electrónica: ComponentKnowledge
    const nombreWokwi = nombreWokwiDePin(pin)
    if (nombreWokwi === null) continue // límite de representación, no eléctrico
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
    return catalogo.obtenerComponente(tipo) ? (nombreDeComponente(tipo) ?? idOTipo) : idOTipo
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
  const etiqueta = etiquetaDeTerminal(terminal.id, componente.tipo)
  if (!terminal.asignable) {
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
function extremoDeTerminal(componenteId: string, terminalId: string, terminalVista: TerminalVista, tipo?: string): ExtremoCableVista {
  // Physical View UX #1: anclas equivalentes (mismo nodo de la pieza, anexo de
  // representación); siempre empieza por el ancla de siempre.
  const ancla = terminalVista.nombreWokwiPieza
  const equivalentes = tipo !== undefined ? ANCLAS_EQUIVALENTES_WOKWI_POR_TIPO[tipo]?.[terminalId] : undefined
  const anclasWokwi = ancla === null ? [] : [ancla, ...(equivalentes ?? []).filter((a) => a !== ancla)]
  return { tipo: "terminal", componente: componenteId, terminal: terminalId, nombreWokwi: ancla, anclasWokwi }
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
  readonly requisito: Requisito["tipo"]
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
        // D-03/§4 del modelo normativo: el valor del requisito es una `Cantidad`; acá
        // sólo viaja el número si la unidad es ohm (si no, `undefined`: no se adivina).
        ohmios: req.spec.valor?.unidad === "ohm" ? req.spec.valor.valor : undefined,
        requisito: req.tipo,
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

/**
 * `conocimiento` es la fachada de Component Knowledge; por defecto, la del propio `catalogo`.
 * Sólo un test la inyecta (p. ej. la fachada de un catálogo de prueba): la vista nunca
 * construye conocimiento propio.
 */
export function proyectarVista(proyecto: Proyecto, catalogo: Catalogo, conocimientoInyectado?: ComponentKnowledge): ModeloDeVista {
  const placaId = proyecto.placa
  const placaCatalogo: Placa | undefined = placaId !== null ? catalogo.placas.find((p) => p.id === placaId) : undefined
  const placa: PlacaVista | null = placaCatalogo
    ? { id: placaCatalogo.id, elementoWokwi: ELEMENTO_WOKWI_POR_PLACA[placaCatalogo.id] ?? "", escala: ESCALA_WOKWI_POR_PLACA[placaCatalogo.id] ?? 1, nombre: nombreDePlaca(placaCatalogo.id) ?? placaCatalogo.id }
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
    const nombreBase = compCatalogo ? (nombreDeComponente(componente.tipo) ?? componente.tipo) : componente.tipo // fail-closed: nunca inventa un nombre
    const ocurrencia = (ocurrenciasPorTipo.get(componente.tipo) ?? 0) + 1
    ocurrenciasPorTipo.set(componente.tipo, ocurrencia)
    const nombre = ocurrencia === 1 ? nombreBase : `${nombreBase} ${ocurrencia}`
    // PFX-1: `agrupadoCon` se resuelve recién en `reordenarParaAdyacencia` (abajo,
    // necesita la fusión ya calculada) — acá siempre `null`, nunca una segunda
    // decisión de agrupamiento.
    return { id: componente.id, tipo: componente.tipo, nombre, elementoWokwi, atributos, rol, terminales, agrupadoCon: null, zona: rol ?? "otras", explicacion: null }
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
  const conocimiento = conocimientoInyectado ?? crearConocimiento(catalogo)
  const tipoDe = (componenteId: string): string | undefined => proyecto.componentes.find((c) => c.id === componenteId)?.tipo
  const extremo = (componenteId: string, terminalId: string): ExtremoCableVista => extremoDeTerminal(componenteId, terminalId, terminalVistaDe(componenteId, terminalId), tipoDe(componenteId))
  // Physical View UX #1: el camino de un cable es el grupo de su pieza; una resistencia
  // fusionada pertenece al camino del componente que la requiere.
  const anclaDeResistencia = new Map([...fusionesSerie.values()].map((f) => [f.resistenciaId, f.componenteId] as const))
  const caminoDe = (componenteId: string): string => anclaDeResistencia.get(componenteId) ?? componenteId
  function potenciaDe(componente: Componente, terminalId: string): { readonly id: string; readonly etiqueta: string; readonly anclasWokwi: readonly string[] } | null {
    const terminal = catalogo.obtenerComponente(componente.tipo)?.terminales.find((t) => t.id === terminalId)
    if (placaId === null || !terminal) return null
    const destino = conocimiento.resolverDestino(placaId, terminal)
    if (destino.kind !== "potencia") return null
    return { id: destino.id, etiqueta: ETIQUETA_DE_TERMINAL_DE_POTENCIA[destino.id] ?? destino.id, anclasWokwi: POTENCIA_WOKWI_POR_PLACA[placaId]?.[destino.id] ?? [] }
  }
  const cables: CableVista[] = []
  const conexionesFusionadasEmitidas = new Set<string>()
  for (const componente of proyecto.componentes) {
    for (const [terminalId, terminalVista] of Object.entries(terminalesDe(componente.id))) {
      const extremoTerminal = extremoDeTerminal(componente.id, terminalId, terminalVista, componente.tipo)
      const camino = caminoDe(componente.id)
      if (terminalVista.estado === "asignado") {
        const extremoPin: ExtremoCableVista = { tipo: "pinPlaca", pinSemantico: terminalVista.pinSemantico, nombreWokwi: terminalVista.nombreWokwiPlaca }
        // HD-W0-B: si este (componente,terminal) fusiona, el extremo del lado del
        // pin deja de ser el propio terminal y pasa a ser la pata LIBRE de la
        // instancia puente — corrección del orquestador sobre EXP-B: nunca la pata
        // conectada otra vez, siempre la que la IR deja sin usar.
        const fusion = fusionesSerie.get(claveAncla(componente.id, terminalId))
        const hastaPin = fusion ? extremo(fusion.resistenciaId, fusion.terminalLibre) : extremoTerminal
        cables.push({ id: `cable-pin-${componente.id}-${terminalId}`, desde: extremoPin, hasta: hastaPin, camino })
        if (fusion) {
          const desde = extremo(fusion.resistenciaId, fusion.terminalConectado)
          const hasta = extremo(fusion.componenteId, fusion.terminalId)
          cables.push({ id: `cable-conexion-${fusion.conexionId}`, desde, hasta, camino })
          conexionesFusionadasEmitidas.add(fusion.conexionId)
        }
      } else if (terminalVista.estado === "rielFijo") {
        cables.push({ id: `cable-riel-${componente.id}-${terminalId}`, desde: extremoTerminal, hasta: { tipo: "rielFijo", destino: terminalVista.destino, potencia: potenciaDe(componente, terminalId) }, camino })
      }
      // "sinAsignar"/"puente": sin cable propio — un puente sólo se cablea si la IR
      // trae una `Conexion` real (bucle de abajo); inventar un cable para un terminal
      // sin dato sería mostrar una conexión que el estudiante nunca hizo.
    }
  }
  for (const conexion of proyecto.conexiones) {
    if (conexionesFusionadasEmitidas.has(conexion.id)) continue // ya se emitió arriba, contigua a su pin
    const desde = extremo(conexion.desde.componente, conexion.desde.terminal)
    const hasta = extremo(conexion.hasta.componente, conexion.hasta.terminal)
    cables.push({ id: `cable-conexion-${conexion.id}`, desde, hasta, camino: caminoDe(conexion.desde.componente) })
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
      if (!terminal.asignable) continue
      porTerminal[terminal.id] = gpiosCandidatosPara(conocimiento, placaId, componente.tipo, terminal.id)
    }
    gpiosDisponibles[componente.id] = porTerminal
  }

  const motivosBase = validarProyecto(proyecto, catalogo)
  const readiness = derivarReadiness(proyecto, motivosBase)

  // Fase 2, Slice 2 (§3.4): cada motivo se proyecta TAL CUAL (mismo criterio de
  // siempre) MÁS una `explicacion` en texto llano — ver `explicarMotivos` más abajo.
  const motivos: readonly MotivoVista[] = explicarMotivos(motivosBase, proyecto, catalogo, conocimiento)

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
  const componentesOrdenados = reordenarParaAdyacencia(componentesConZona(componentesConValor, fusionesSerie, proyecto, catalogo), fusionesSerie)

  const { reglas, opcionesRegla } = proyectarReglas(proyecto, catalogo, componentes, motivos, conocimiento)

  return { placa, componentes: componentesOrdenados, cables, gpiosDisponibles, motivos, readiness, reglas, opcionesRegla, zonas: zonasDelEsquema(placa, componentesOrdenados) }
}

/**
 * Physical View UX #1: una resistencia (o la pieza que sea) que existe por el REQUISITO
 * de otra va a la zona de esa otra y explica para qué está (anexo de pedagogía). Lo
 * derivado no se persiste: sale de la IR + el catálogo en cada proyección (D-06).
 */
function componentesConZona(componentes: readonly ComponenteVista[], fusionesSerie: ReadonlyMap<string, FusionSerie>, proyecto: Proyecto, catalogo: Catalogo): readonly ComponenteVista[] {
  const porId = new Map(componentes.map((c) => [c.id, c] as const))
  const fusionDeResistencia = new Map([...fusionesSerie.values()].map((f) => [f.resistenciaId, f] as const))
  return componentes.map((c) => {
    const fusion = fusionDeResistencia.get(c.id)
    const relacion = fusion ? { anclaId: fusion.componenteId, requisito: fusion.requisito } : requisitoQueCumple(c.id, proyecto, catalogo)
    const ancla = relacion ? porId.get(relacion.anclaId) : undefined
    if (!relacion || !ancla) return c
    return { ...c, zona: ancla.zona, explicacion: explicacionDeRequisito(relacion.requisito, ancla.nombre) ?? null }
  })
}

/**
 * Physical View UX #1 (red-team #1): una pieza conectada (UNA sola conexión) al terminal
 * de otra que DECLARA un requisito por ese tipo de pieza en ese terminal (p. ej. el LED
 * pide `resistencia-serie` en el ánodo) pertenece a la zona de esa otra, aunque todavía
 * no haya pin asignado para fusionarlas en el dibujo. Sale de la IR + el requisito del
 * catálogo; nunca de un nombre ni de un tipo escrito acá.
 */
function requisitoQueCumple(componenteId: string, proyecto: Proyecto, catalogo: Catalogo): { readonly anclaId: string; readonly requisito: Requisito["tipo"] } | null {
  const instancia = proyecto.componentes.find((c) => c.id === componenteId)
  const conexiones = proyecto.conexiones.filter((cx) => cx.desde.componente === componenteId || cx.hasta.componente === componenteId)
  if (!instancia || conexiones.length !== 1) return null
  const cx = conexiones[0]
  if (!cx) return null
  const otro = cx.desde.componente === componenteId ? cx.hasta : cx.desde
  const tipoOtro = proyecto.componentes.find((c) => c.id === otro.componente)?.tipo
  const requisito = tipoOtro ? catalogo.obtenerComponente(tipoOtro)?.requisitos.find((r) => r.enTerminal === otro.terminal && tipoEsperadoDeRequisito(r) === instancia.tipo) : undefined
  return requisito ? { anclaId: otro.componente, requisito: requisito.tipo } : null
}

/** Zonas en orden de lectura; `otras` sólo si alguna pieza cae ahí. */
function zonasDelEsquema(placa: PlacaVista | null, componentes: readonly ComponenteVista[]): readonly ZonaVista[] {
  if (placa === null && componentes.length === 0) return []
  const roles: ZonaVista["rol"][] = ["entrada", "controlador", "salida"]
  if (componentes.some((c) => c.zona === "otras")) roles.push("otras")
  return roles.map((rol) => ({ rol, ...ZONAS_DEL_CIRCUITO[rol] }))
}

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3, vertical #1 (contrato B6): proyección de las reglas. Todo del lado del
// servidor, determinista, sin LLM; el navegador sólo pinta lo que recibe.
// ════════════════════════════════════════════════════════════════════════════════════

// Semantic Vertical #3: la forma canónica de "presionado"/"suelto" ya NO vive acá (antes
// `CONDICION_PRESIONADO`): sale de `nucleo/estado-booleano.ts` (única fuente normativa)
// y sus rótulos del anexo de pedagogía, a través de ComponentKnowledge
// (`estadosDeEntrada`/`estadosDeSalida`). Esta función sólo arma la proyección.

const ETIQUETA_TRAZA = "Explicación de la regla — no es una simulación ni lo que pasa en la placa."

/** La nota de condición avanzada nombra los estados que la frase SÍ sabe armar (los de
 * las opciones ofrecidas), nunca una lista escrita acá. */
function avisoCondicionAvanzada(estados: readonly { readonly etiqueta: string }[]): string {
  const nombres = estados.map((e) => `«${e.etiqueta}»`)
  const lista = nombres.length <= 1 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} o ${nombres[nombres.length - 1]}`
  return `Esta regla usa una condición avanzada: se puede mirar, pero esta frase sólo sabe armar ${lista}.`
}

function proyectarReglas(proyecto: Proyecto, catalogo: Catalogo, componentes: readonly ComponenteVista[], motivos: readonly MotivoVista[], conocimiento: ComponentKnowledge): { reglas: readonly ReglaVista[]; opcionesRegla: OpcionesReglaVista } {
  const etiquetaDe = (id: string): string => componentes.find((c) => c.id === id)?.nombre ?? "componente que ya no existe"
  const ref = (id: string): ReferenciaVista => ({ id, etiqueta: etiquetaDe(id) })
  const tipoDe = (id: string | undefined): string | undefined => (id === undefined ? undefined : proyecto.componentes.find((c) => c.id === id)?.tipo)

  // Opciones de la frase/Blockly: SALEN del conocimiento de las piezas del proyecto
  // (entradas con capacidad booleana rotulada o cuantitativa disponible; estados que cada
  // actuador declara).
  const sensores: ReferenciaVista[] = []
  const actuadores: ReferenciaVista[] = []
  const estados: OpcionEstadoVista[] = []
  const salidas: OpcionSalidaVista[] = []
  for (const c of componentes) {
    const cat = catalogo.obtenerComponente(c.tipo)
    if (!cat) continue
    const deEntrada = conocimiento.estadosDeEntrada(c.tipo)
    if (deEntrada.length > 0 || cuantitativasParaCrear(conocimiento, c.tipo).length > 0) sensores.push({ id: c.id, etiqueta: c.nombre })
    for (const e of deEntrada) if (!estados.some((x) => x.clave === e.etiqueta)) estados.push({ clave: e.etiqueta, etiqueta: e.etiqueta, condicion: e.condicion })
    if (cat.clase === "actuador") {
      actuadores.push({ id: c.id, etiqueta: c.nombre })
      for (const e of conocimiento.estadosDeSalida(c.tipo)) if (!salidas.some((x) => x.accion === e.accion)) salidas.push({ clave: e.etiqueta, etiqueta: e.etiqueta, accion: e.accion })
    }
  }

  const slotSensor: SlotFraseVista = { slot: "sensor", prefijo: "Mientras el", opciones: sensores.map((o) => ({ valor: o.id, etiqueta: o.etiqueta, parche: { cuando: { sensor: o.id } } })) }
  const slotEstado: SlotFraseVista = { slot: "estado", prefijo: "esté", opciones: estados.map((e) => ({ valor: e.clave, etiqueta: e.etiqueta, parche: { cuando: { ...e.condicion } } })) }
  const slotActuador: SlotFraseVista = { slot: "actuador", prefijo: ", el", opciones: actuadores.map((o) => ({ valor: o.id, etiqueta: o.etiqueta, parche: { entonces: { actuador: o.id } } })) }
  const slotSalida: SlotFraseVista = { slot: "salida", prefijo: "está", opciones: salidas.map((o) => ({ valor: o.clave, etiqueta: o.etiqueta, parche: { entonces: { accion: o.accion } } })) }
  const slots: SlotFraseVista[] = [slotSensor, slotEstado, slotActuador, slotSalida]

  const reglas: ReglaVista[] = proyecto.comportamientos.map((b) => {
    const delaRegla = motivos.filter((m) => m.entidad?.tipo === "comportamiento" && m.entidad.id === b.id)
    const incompleto = delaRegla.find((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO")
    const faltanCrudo = incompleto?.datos?.faltan
    const faltan: readonly string[] = Array.isArray(faltanCrudo) ? faltanCrudo.map(String) : []
    const completa = incompleto === undefined
    const accionNoSoportada = delaRegla.some((m) => m.codigo === "ACCION_NO_SOPORTADA")

    const cuando = b.cuando
    const entonces = b.entonces
    const tieneEstado = cuando?.capacidad !== undefined && cuando.comparador !== undefined && cuando.umbral !== undefined
    // Estado de la entrada: canónico (núcleo) + rótulo del tipo del sensor; sin sensor
    // elegido todavía, el rótulo de la opción ofrecida con esa misma condición.
    const valor = tieneEstado ? valorBooleanoDeCondicion(cuando) : undefined
    const tipoSensor = tipoDe(cuando?.sensor)
    const estadoEntrada =
      valor === undefined
        ? undefined
        : tipoSensor !== undefined
          ? conocimiento.estadosDeEntrada(tipoSensor).find((e) => e.capacidad === cuando?.capacidad && e.valor === valor)
          : estados.find((e) => e.condicion.capacidad === cuando?.capacidad && valorBooleanoDeCondicion(e.condicion) === valor)
    // Numeric Conditions S1: si no es un estado booleano canónico, ¿es una condición numérica que
    // Component Knowledge permite nombrar? Una regla YA guardada se reconoce aunque su capacidad
    // hoy no se ofrezca para crear (N-4): se muestra con una nota, nunca como «avanzada».
    const numerica = tieneEstado && estadoEntrada === undefined ? reconocerCondicionNumerica(cuando, tipoSensor, conocimiento) : undefined
    const salidaEtiqueta = entonces?.accion === undefined ? undefined : (etiquetaDeEstadoObjetivo(entonces.accion) ?? entonces.accion)
    const frase: FraseReglaVista = {
      ...(cuando?.sensor !== undefined ? { sensor: ref(cuando.sensor) } : {}),
      ...(tieneEstado ? { estado: estadoEntrada ? { clave: estadoEntrada.etiqueta, etiqueta: estadoEntrada.etiqueta } : numerica ? { clave: "numerica", etiqueta: textoDeCondicion(numerica, numerica.comparador) } : { clave: "avanzada", etiqueta: "condición avanzada" } } : {}),
      ...(numerica ? partesNumericas(numerica) : {}),
      ...(entonces?.actuador !== undefined ? { actuador: ref(entonces.actuador) } : {}),
      ...(salidaEtiqueta !== undefined ? { salida: { clave: salidaEtiqueta, etiqueta: salidaEtiqueta } } : {}),
    }

    // Una condición numérica con un problema bloqueante propio (unidad que no corresponde,
    // capacidad que ya no existe) se MUESTRA, pero no se lee como una oración verdadera.
    const condicionConProblema = numerica !== undefined && delaRegla.some((m) => CODIGOS_CONDICION_INVALIDA.includes(m.codigo))
    const lectura = estadoEntrada !== undefined ? lecturaBooleana(estadoEntrada.etiqueta) : numerica && !condicionConProblema ? lecturaNumerica(numerica) : undefined
    const canonica = completa && !accionNoSoportada && lectura !== undefined && frase.sensor !== undefined && frase.actuador !== undefined && frase.salida !== undefined
    const aviso = tieneEstado && estadoEntrada === undefined ? (numerica ? (numerica.disponible ? null : AVISO_CONDICION_NO_DISPONIBLE) : avisoCondicionAvanzada(estados)) : null
    const ayuda = numerica ? ayudaDeRango(numerica.capacidad, conocimiento) : null
    const forma = { ...(cuando ? { cuando: JSON.parse(JSON.stringify(cuando)) } : {}), ...(entonces ? { entonces: JSON.parse(JSON.stringify(entonces)) } : {}) }
    const slotsPropios = slotsDeRegla(b, numerica)
    const extra = { ...(slotsPropios ? { slots: slotsPropios } : {}), ...(ayuda !== null ? { ayuda } : {}) }
    if (!canonica || lectura === undefined || entonces?.accion === undefined) return { id: b.id, frase, texto: null, completa, faltan, motivos: delaRegla, forma, aviso, ...extra }

    const s = frase.sensor!.etiqueta
    const a = frase.actuador!.etiqueta
    const salida = frase.salida!.etiqueta
    const sujeto = lectura.sujeto(s)
    // Reposo (Semantic Vertical #3, supersede HD-P3D-1): el complemento DECLARADO del
    // estado objetivo. Derivado, nunca guardado; si el tipo no declara complemento, la
    // traza lo dice en vez de inventar un estado.
    const tipoActuador = tipoDe(entonces.actuador)
    const complemento = tipoActuador !== undefined ? conocimiento.complementoDe(tipoActuador, entonces.accion) : undefined
    const reposo = complemento !== undefined ? etiquetaDeEstadoObjetivo(complemento) : undefined
    const ramaFalsa =
      reposo !== undefined
        ? `Si ${sujeto} ${lectura.falsa} → la condición es falsa → el ${a} está ${reposo} (reposo).`
        : `Si ${sujeto} ${lectura.falsa} → la condición es falsa → la regla no dice cómo queda el ${a} (no tiene un estado opuesto declarado).`
    // Multi-Rule Safety (modelo B): si otra regla también reclama este actuador, la traza
    // NO afirma el reposo ni un estado como verdad (no hay ganador ni prioridad): dice lo
    // que esta regla pide y que, sola, no puede determinar cómo queda el actuador.
    const enConflicto = delaRegla.some((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR")
    const traza: TrazaReglaVista = enConflicto
      ? {
          etiqueta: ETIQUETA_TRAZA,
          ramas: [
            `Si ${sujeto} ${lectura.verdadera} → la condición es verdadera → esta regla pide que el ${a} esté ${salida}.`,
            `Esta regla no puede determinar por sí sola cómo queda el ${a}, porque otra regla también intenta gobernarlo.`,
          ],
          nota: `Cada salida puede tener una sola regla: dejá una sola regla para el ${a}.`,
        }
      : {
          etiqueta: ETIQUETA_TRAZA,
          ramas: [`Si ${sujeto} ${lectura.verdadera} → la condición es verdadera → el ${a} está ${salida}.`, ramaFalsa],
        }
    return { id: b.id, frase, texto: `Mientras ${sujeto} ${lectura.enFrase}, el ${a} está ${salida}.`, completa, faltan, motivos: delaRegla, traza, forma, aviso, ...extra }
  })

  /**
   * Numeric Conditions S1: los slots de UNA regla, cuando los globales no le sirven tal cual:
   * - su condición es numérica (capacidad, comparador, valor y unidad, en vez de «estado»), o
   * - el sensor elegido ofrece otros estados que la lista global (D0, L-3: dos entradas con la
   *   misma capacidad y rótulos distintos), o
   * - cambiar a otro sensor de la lista dejaría una condición que ese sensor no declara (N-10).
   * Todo sale de datos (catálogo y Component Knowledge); ningún tipo ni capacidad se nombra acá.
   */
  function slotsDeRegla(b: ComportamientoRegla, numerica: CondicionNumerica | undefined): readonly SlotFraseVista[] | undefined {
    const tipoSensor = tipoDe(b.cuando?.sensor)
    if (tipoSensor === undefined) return undefined
    const capacidadGuardada = b.cuando?.capacidad
    // N-10: el sensor nuevo conserva la condición sólo si declara la MISMA capacidad; si no, el
    // `cuando` se reemplaza por el sensor solo (regla incompleta, representable).
    const opcionesSensor = slotSensor.opciones.map((o) => {
      const tipoNuevo = tipoDe(o.valor)
      const conserva = capacidadGuardada === undefined || (tipoNuevo !== undefined && (catalogo.obtenerComponente(tipoNuevo)?.capacidades ?? []).some((c) => c.id === capacidadGuardada))
      return conserva ? o : { ...o, reemplazaCuando: true }
    })
    const sensorPropio = opcionesSensor.some((o) => o.reemplazaCuando === true)
    const estadosDelSensor = conocimiento.estadosDeEntrada(tipoSensor)
    const estadosPropios = estadosDelSensor.length !== estados.length || estadosDelSensor.some((e, i) => e.etiqueta !== estados[i]?.etiqueta)
    if (!numerica && !sensorPropio && !estadosPropios) return undefined

    const sensorEnRegla: SlotFraseVista = { ...slotSensor, opciones: opcionesSensor, grupo: "cuando" }
    const entonces: SlotFraseVista[] = [{ ...slotActuador, grupo: "entonces" }, { ...slotSalida, grupo: "entonces" }]
    // Numérica: se lee «Mientras la lectura de [capacidad] del [entrada] sea [comparador] [número]
    // [unidad], el …»; la capacidad va antes que la entrada, como en la frase.
    if (numerica) return [...slotsNumericos(b, numerica, tipoSensor, sensorEnRegla), ...entonces]
    return [sensorEnRegla, { slot: "estado", prefijo: "esté", opciones: estadosDelSensor.map((e) => ({ valor: e.etiqueta, etiqueta: e.etiqueta, parche: { cuando: { ...e.condicion } } })), grupo: "cuando" }, ...entonces]
  }

  function slotsNumericos(b: ComportamientoRegla, numerica: CondicionNumerica, tipoSensor: string, sensorEnRegla: SlotFraseVista): SlotFraseVista[] {
    const umbralGuardado = b.cuando!.umbral!
    return [
      // Capacidad: las que se pueden crear con ESTE sensor; la guardada, aunque ya no se ofrezca,
      // sigue visible como valor actual (el navegador la agrega a las opciones).
      { slot: "capacidad", prefijo: "Mientras la lectura de", opciones: cuantitativasParaCrear(conocimiento, tipoSensor).map((c) => ({ valor: c.capacidad, etiqueta: c.etiqueta!, parche: { cuando: { capacidad: c.capacidad, umbral: { magnitud: c.magnitud, unidad: c.unidadCanonica } } } })), grupo: "cuando" },
      { ...sensorEnRegla, prefijo: "del" },
      { slot: "comparador", prefijo: "sea", opciones: COMPARADORES.map((c) => ({ valor: c, etiqueta: ROTULO_COMPARADOR[c], parche: { cuando: { comparador: c } } })), grupo: "cuando" },
      { slot: "valor", prefijo: "", opciones: [], grupo: "cuando", tipo: "numero", destino: ["cuando", "umbral", "valor"] },
      // Unidad (N-3): cambiar SÓLO la unidad conserva la cantidad física. Cada unidad que la
      // capacidad ofrece trae como parche el umbral YA convertido por Component Knowledge
      // (`convertirParaCapacidad`, normalizado allá: acá no se redondea ni se recorta). Si la
      // conversión no es posible (sin conversión declarada, capacidad no disponible, unidad
      // guardada ajena), esa unidad no se ofrece: nunca se inventa una cantidad.
      { slot: "unidad", prefijo: "", opciones: opcionesDeUnidad(numerica, tipoSensor, umbralGuardado), grupo: "cuando" },
    ]
  }

  function opcionesDeUnidad(numerica: CondicionNumerica, tipoSensor: string, umbralGuardado: { readonly valor: number; readonly unidad: string; readonly magnitud: string }): OpcionSlotVista[] {
    const opciones: OpcionSlotVista[] = []
    for (const u of numerica.capacidad.unidades) {
      if (u.id === umbralGuardado.unidad) {
        opciones.push({ valor: u.id, etiqueta: u.simbolo, parche: {} })
        continue
      }
      const convertida = conocimiento.convertirParaCapacidad(tipoSensor, numerica.capacidad.capacidad, umbralGuardado, u.id)
      if (convertida.ok) opciones.push({ valor: u.id, etiqueta: u.simbolo, parche: { cuando: { umbral: { valor: convertida.valor.valor, unidad: convertida.valor.unidad, magnitud: convertida.valor.magnitud } } } })
    }
    return opciones
  }

  return { reglas, opcionesRegla: { slots, sensores, estados, actuadores, salidas } }
}

/** Numeric Conditions S1: motivos bloqueantes que hablan de la CONDICIÓN misma. */
const CODIGOS_CONDICION_INVALIDA: readonly string[] = ["MAGNITUD_INCOMPATIBLE", "CAPACIDAD_INEXISTENTE_EN_CATALOGO"]

/** N-4: texto pendiente de aprobación (N-11 aplica el mismo criterio). */
const AVISO_CONDICION_NO_DISPONIBLE = "Esta condición está guardada en el proyecto, pero todavía no se puede elegir para armar reglas nuevas."

/** Cómo se lee una condición en la frase y en la traza (sujeto + predicado). */
interface LecturaCondicion {
  sujeto(sensor: string): string
  readonly enFrase: string
  readonly verdadera: string
  readonly falsa: string
}

function lecturaBooleana(estado: string): LecturaCondicion {
  return { sujeto: (s) => `el ${s}`, enFrase: `esté ${estado}`, verdadera: `está ${estado}`, falsa: `no está ${estado}` }
}

function lecturaNumerica(n: CondicionNumerica): LecturaCondicion {
  const cantidad = cantidadEnTexto(n.valor, n.simbolo)
  return {
    // Component Knowledge da el rótulo como sustantivo sin artículo; «la lectura de» lo hace
    // gramatical para cualquier capacidad sin que A decida su género.
    sujeto: (s) => `la lectura de ${n.etiquetaCapacidad} del ${s}`,
    enFrase: `sea ${ROTULO_COMPARADOR[n.comparador]} ${cantidad}`,
    verdadera: `es ${ROTULO_COMPARADOR[n.comparador]} ${cantidad}`,
    falsa: `es ${ROTULO_COMPARADOR[COMPLEMENTO_COMPARADOR[n.comparador]]} ${cantidad}`,
  }
}

function textoDeCondicion(n: CondicionNumerica, comparador: keyof typeof ROTULO_COMPARADOR): string {
  return `lectura de ${n.etiquetaCapacidad} ${ROTULO_COMPARADOR[comparador]} ${cantidadEnTexto(n.valor, n.simbolo)}`
}

function partesNumericas(n: CondicionNumerica): Pick<FraseReglaVista, "capacidad" | "comparador" | "valor" | "unidad"> {
  return {
    capacidad: { clave: n.capacidad.capacidad, etiqueta: n.etiquetaCapacidad },
    comparador: { clave: n.comparador, etiqueta: ROTULO_COMPARADOR[n.comparador] },
    valor: { clave: String(n.valor), etiqueta: formatearNumero(n.valor) },
    unidad: { clave: n.unidad, etiqueta: n.simbolo },
  }
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
export function explicarMotivos(motivos: readonly Motivo[], proyecto: Proyecto, catalogo: Catalogo, conocimiento: ComponentKnowledge = crearConocimiento(catalogo)): readonly MotivoVista[] {
  const nombres = resolverNombreDeComponente(proyecto, catalogo)
  return motivos.map((motivo) => ({ ...motivo, explicacion: explicacionDeMotivo(motivo.codigo, { ...datosParaExplicacion(motivo), ...datosDeCondicionNumerica(motivo, proyecto, conocimiento) }, nombres) }))
}

/**
 * Numeric Conditions S1 (N-11): para un motivo sobre la condición de una regla, lo que la
 * explicación necesita nombrar y la IR/el motivo no traen en texto: el sensor de la regla y, si
 * Component Knowledge lo describe (CK-REQ-N1), el rótulo de la capacidad, la cantidad guardada y
 * el rango con sus símbolos. Sin ese contrato sólo se agrega el sensor; la plantilla que necesite
 * más no da explicación (nunca se inventa un rótulo ni una unidad).
 */
function datosDeCondicionNumerica(motivo: Motivo, proyecto: Proyecto, conocimiento: ComponentKnowledge): Readonly<Record<string, unknown>> {
  if (motivo.entidad?.tipo !== "comportamiento") return {}
  const cuando = proyecto.comportamientos.find((b) => b.id === motivo.entidad?.id)?.cuando
  if (!cuando?.sensor) return {}
  const base = { sensorDeRegla: cuando.sensor }
  const tipo = proyecto.componentes.find((c) => c.id === cuando.sensor)?.tipo
  if (tipo === undefined || !cuando.capacidad || !cuando.umbral) return base
  const r = conocimiento.capacidadCuantitativa(tipo, cuando.capacidad)
  if (!r.ok || r.valor.etiqueta === null) return base
  const capacidad = r.valor
  const cantidad = cantidadEnTexto(cuando.umbral.valor, simboloDe(capacidad, cuando.umbral.unidad, conocimiento))
  const rango = rangoEnTexto(capacidad, conocimiento)
  return { ...base, etiquetaCapacidad: capacidad.etiqueta, cantidadGuardada: cantidad, ...(rango !== null ? { rangoEnTexto: rango } : {}) }
}
