// Raíz de composición — Phase 2, Slice 1. Cierra E3-04b (condición de entrada de
// Phase 2, `DECISIONS.md` "Almacen es un puerto interno del composition root",
// `motor.ts`/`almacen.ts` ya avisan sobre esta frontera en su propio JSDoc).
//
// Ver docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md §2.1/§2.2 y el informe
// ARCH-A (composition root, in-process, singleton por proyecto).
//
// ÚNICO módulo de producción, además de `almacen.ts` mismo, autorizado a importar
// `crearAlmacen` — verificado por `scripts/guardia-composicion-raiz.mjs` (guardia
// estructural (c) de E3-04b, `tests/phase2-composicion-raiz.test.mjs`). Sin DI, sin
// proxies, sin frameworks de inyección (ya descartado en Phase 1.1,
// `DECISIONS.md:354-357`): el cierre es un único call site de producción más un
// test que lo hace verificable — nunca un wrapper con permisos.
//
// Qué expone: `obtenerServicioDeProyecto(...)` construye el catálogo real (el MISMO
// que usa Phase 1 en producción, `adaptadores/hash-catalogo.node.ts`), crea el
// `Almacen` internamente (nunca lo devuelve), carga el proyecto si ya existe en
// disco o lo crea con `crearProyecto`, arma el `MotorDeProyecto` (`motor.ts`, la
// ÚNICA autoridad de mutación) y devuelve un `ServicioDeProyecto` angosto:
// `snapshot()`, `aplicar()`/`aplicarTransaccion()`/`proponer()` (delegan íntegro en
// el motor), `suscribir()` (cambios de revisión) y `cerrar()`. Nunca expone
// `guardar`/`cargar`/`existe` ni una referencia al `Almacen` o al motor crudo.
//
// Singleton por (directorio, idProyecto), memoizado en un `Map` a nivel de módulo —
// no es DI, es memoización simple (mismo criterio que ARCH-A §4.1 y el precedente ya
// real de estado de módulo en este mismo repo, `opencode/tool/platformio.ts:20`,
// `pioPathCache`). Garantiza que la tool de OpenCode y el servidor HTTP del
// navegador (writers siguientes) comparten el MISMO `MotorDeProyecto` en memoria —
// nunca dos motores compitiendo por el mismo `Almacen` (REA-N5,
// `DECISIONS.md:706-724`, `INVARIANTES-ENTRYPOINTS.md:742`): el CAS de `almacen.ts`
// (E3-07) sigue siendo la defensa de último recurso, no el diseño deseado.
// `cerrar()` saca la entrada del `Map` — la siguiente llamada con el mismo
// (directorio, idProyecto) construye una raíz nueva, releyendo disco (Phase 2,
// tests/phase2-reload.test.mjs).

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import type { Readiness } from "./validar.ts"
import type { ResultadoTransaccion } from "./motor.ts"
import type { SobreOperacion } from "./operaciones.ts"
import { crearMotorDeProyecto } from "./motor.ts"
import { crearAlmacen } from "./almacen.ts"
import { crearProyecto } from "./cargador.ts"
import { validarProyecto, derivarReadiness } from "./validar.ts"
import { canonicalizar } from "./canonico.ts"
import { construirCatalogoMinimoReal } from "./adaptadores/hash-catalogo.node.ts"

/**
 * DTO plano del proyecto — lo que la vista (writer siguiente) y cualquier otro
 * consumidor necesitan, en datos serializables sin referencias compartidas con el
 * canónico en memoria del motor (Phase 2, PHASE_2_SLICE_1_DESIGN.md §2.5).
 *
 * `vista` (el modelo de vista física, §2.6 del diseño) TODAVÍA NO EXISTE en este
 * slice — lo agrega el writer de la vista física. Esta raíz deja el hook mínimo para
 * eso (`OpcionesServicioDeProyecto.calcularVista`, más abajo): si nadie lo inyecta,
 * `snapshot()` simplemente NO incluye la clave `vista` — nunca se inventa su forma
 * acá.
 */
export interface Snapshot {
  readonly idProyecto: string
  readonly revision: number
  readonly catalogoVersion: string
  readonly catalogoHash: string
  readonly proyecto: Proyecto
  readonly validacion: {
    readonly motivos: readonly Motivo[]
    readonly readiness: Readiness
  }
}

/**
 * Superficie pública angosta — a propósito la MISMA forma de operaciones que
 * `MotorDeProyecto` (`getProyecto`→`snapshot`, `proponer`/`aplicar`/
 * `aplicarTransaccion` delegan íntegro), más `suscribir`/`cerrar` (ciclo de vida de
 * la raíz). NUNCA `guardar`/`cargar`/`existe`/`obtenerBufferUndo`/el `Almacen`/el
 * `MotorDeProyecto` crudo — ver tests/phase2-composicion-raiz.test.mjs, guardia (b).
 */
export interface ServicioDeProyecto {
  snapshot(): Snapshot
  aplicar(sobre: SobreOperacion): ResultadoTransaccion
  aplicarTransaccion(sobres: readonly SobreOperacion[]): ResultadoTransaccion
  /** Dry-run: nunca persiste, nunca sube revisión, nunca notifica `suscribir`. */
  proponer(sobres: readonly SobreOperacion[]): ResultadoTransaccion
  /** `listener` se llama con `{revision}` sólo cuando una operación commitea
   * (`ok:true`) Y la revisión efectivamente cambió — nunca en un rechazo ni en un
   * dry-run (un lote vacío es `ok:true` pero no sube revisión: tampoco notifica).
   * Devuelve la función de desuscripción. */
  suscribir(listener: (evento: { readonly revision: number }) => void): () => void
  /** Saca esta entrada del singleton del módulo. La próxima llamada con el mismo
   * (directorio, idProyecto) arma una raíz nueva, releyendo disco. */
  cerrar(): void
}

export interface OpcionesServicioDeProyecto {
  readonly directorio: string
  readonly idProyecto: string
  /** Default `true`: si el proyecto no existe todavía en `directorio`, se crea
   * vacío (`crearProyecto`). Con `false`, ausencia en disco es un error — para un
   * consumidor que quiere distinguir "abrir uno existente" de "crear uno nuevo". */
  readonly crearSiNoExiste?: boolean
  /** Hook interno para el writer de la vista física (siguiente tarea): función PURA
   * `(proyecto plano, catálogo) => vista` que, si se inyecta, agrega la clave
   * `vista` al `Snapshot`. Deliberadamente sin tipo de retorno propio todavía — esta
   * raíz no inventa la forma de la vista. Se fija en el momento de construcción del
   * servicio (primera llamada para ese (directorio, idProyecto)); llamadas
   * posteriores que reusan el singleton la ignoran. */
  readonly calcularVista?: (proyecto: Proyecto, catalogo: Catalogo) => unknown
}

// El catálogo real de producción — el MISMO que usa Phase 1 (adaptadores/
// hash-catalogo.node.ts). Se calcula una única vez por proceso: es puro y
// determinista (mismos datos, mismo hash), y todos los proyectos de Slice 1
// comparten el mismo catálogo activo — la raíz no agrega reglas de dominio propias,
// todo pasa por el motor con este catálogo.
const CATALOGO_REAL: Catalogo = construirCatalogoMinimoReal()

const registro = new Map<string, ServicioDeProyecto>()

/**
 * Normaliza SIN `node:path` — el núcleo (`opencode/nucleo/**`) sólo permite
 * `node:`* en `almacen.ts`/`adaptadores/hash-catalogo.node.ts`
 * (`tests/nucleo-adversarial.test.mjs`, "29b. grep: node:fs/node:crypto SOLO en
 * almacen.ts y adaptadores/hash-catalogo.node.ts" — invariante de Phase 1, no se
 * toca). Recorta sólo una barra final, para que "dir" y "dir/" no colisionen por
 * accidente — nunca resuelve contra `process.cwd()` ni normaliza `.`/`..`: el
 * llamador (la tool de OpenCode, el servidor HTTP, los tests) siempre pasa la MISMA
 * representación de un directorio dado.
 */
function normalizarDirectorio(directorio: string): string {
  return directorio.endsWith("/") ? directorio.slice(0, -1) : directorio
}

function claveDelServicio(directorio: string, idProyecto: string): string {
  return `${normalizarDirectorio(directorio)}::${idProyecto}`
}

function construirProyectoInicial(almacen: ReturnType<typeof crearAlmacen>, idProyecto: string, crearSiNoExiste: boolean): Proyecto {
  if (almacen.existe(idProyecto)) {
    const cargado = almacen.cargar(idProyecto)
    if (!cargado.ok) {
      throw new Error(`composicion-raiz: el proyecto "${idProyecto}" existe en disco pero no se pudo cargar: ${JSON.stringify(cargado.motivos)}`)
    }
    return cargado.proyecto
  }
  if (!crearSiNoExiste) {
    throw new Error(`composicion-raiz: el proyecto "${idProyecto}" no existe y crearSiNoExiste=false`)
  }
  return crearProyecto({ generadorId: () => idProyecto, catalogoVersion: CATALOGO_REAL.version, catalogoHash: CATALOGO_REAL.hash })
}

function construirServicio(clave: string, directorio: string, idProyecto: string, crearSiNoExiste: boolean, calcularVista: OpcionesServicioDeProyecto["calcularVista"]): ServicioDeProyecto {
  // El Almacen se construye ACÁ, una única vez, y se inyecta al motor — nunca se
  // retiene por fuera para llamar guardar()/cargar() directo (mismo contrato que
  // motor.ts/almacen.ts ya documentan sobre "Almacen es un puerto interno").
  const almacen = crearAlmacen({ directorio, catalogo: CATALOGO_REAL })
  const proyectoInicial = construirProyectoInicial(almacen, idProyecto, crearSiNoExiste)
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo: CATALOGO_REAL, almacen })

  const listeners = new Set<(evento: { readonly revision: number }) => void>()

  function notificarSiCorresponde(resultado: ResultadoTransaccion, revisionAntes: number): ResultadoTransaccion {
    if (resultado.ok && motor.getProyecto().revision !== revisionAntes) {
      const evento = { revision: motor.getProyecto().revision }
      for (const listener of listeners) listener(evento)
    }
    return resultado
  }

  function snapshot(): Snapshot {
    const proyecto = motor.getProyecto()
    // Copia PLANA e independiente del canónico: `canonicalizar` da el mismo criterio
    // de orden de claves que ya certifica `nucleo-canonico-golden.test.mjs`,
    // `JSON.parse` sobre ese string da un objeto NUEVO y mutable en cada llamada —
    // mutar lo devuelto nunca toca el canónico congelado del motor, y dos llamadas
    // sin operación en el medio dan JSON idéntico (determinismo).
    const proyectoPlano: Proyecto = JSON.parse(canonicalizar(proyecto))
    const motivos: readonly Motivo[] = validarProyecto(proyecto, CATALOGO_REAL)
    const readiness = derivarReadiness(proyecto, motivos)
    const base: Snapshot = {
      idProyecto: proyectoPlano.id,
      revision: proyectoPlano.revision,
      catalogoVersion: proyectoPlano.catalogoVersion,
      catalogoHash: proyectoPlano.catalogoHash,
      proyecto: proyectoPlano,
      // JSON.parse(JSON.stringify(...)) por el mismo motivo: motivos[] no sale de
      // congelarProfundo (son objetos frescos de validarProyecto), pero el
      // round-trip de snapshot() completo tiene que ser JSON-plano de punta a punta.
      validacion: { motivos: JSON.parse(JSON.stringify(motivos)), readiness },
    }
    if (!calcularVista) return base
    return { ...base, vista: calcularVista(proyectoPlano, CATALOGO_REAL) } as Snapshot
  }

  const servicio: ServicioDeProyecto = {
    snapshot,
    aplicar(sobre) {
      const revisionAntes = motor.getProyecto().revision
      return notificarSiCorresponde(motor.aplicar(sobre), revisionAntes)
    },
    aplicarTransaccion(sobres) {
      const revisionAntes = motor.getProyecto().revision
      return notificarSiCorresponde(motor.aplicarTransaccion(sobres), revisionAntes)
    },
    proponer(sobres) {
      // Dry-run: el motor nunca persiste ni sube revisión acá — nada que notificar.
      return motor.proponer(sobres)
    },
    suscribir(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cerrar() {
      registro.delete(clave)
      listeners.clear()
    },
  }
  return servicio
}

/**
 * Factory idempotente: devuelve el MISMO `ServicioDeProyecto` para el mismo
 * (directorio, idProyecto) mientras el proceso viva — garantiza un único
 * `MotorDeProyecto` vivo por proyecto (REA-N5). `directorio` se normaliza
 * (recorte de barra final, `normalizarDirectorio` — sin `node:path`, ver esa
 * función) para que "dir" y "dir/" resuelvan a la misma entrada.
 */
export function obtenerServicioDeProyecto(opciones: OpcionesServicioDeProyecto): ServicioDeProyecto {
  const clave = claveDelServicio(opciones.directorio, opciones.idProyecto)
  const existente = registro.get(clave)
  if (existente) return existente
  const servicio = construirServicio(clave, opciones.directorio, opciones.idProyecto, opciones.crearSiNoExiste ?? true, opciones.calcularVista)
  registro.set(clave, servicio)
  return servicio
}
