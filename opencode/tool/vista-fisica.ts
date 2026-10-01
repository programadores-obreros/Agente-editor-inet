/// <reference path="../env.d.ts" />
// Tool "vista física" — Phase 2, Slice 1 (writer W4, tarea 2,
// PHASE_2_SLICE_1_DESIGN.md §2.7). Abre en el navegador la vista física del
// proyecto activo (ESP32 + LED, este slice), servida por el MISMO servidor
// HTTP+SSE que usa cualquier otro consumidor (`opencode/servidor/servidor-proyecto.ts`).
//
// La tool NUNCA construye su propio motor ni cachea el estado del proyecto: sólo
// obtiene el `ServicioDeProyecto` a través de `obtenerServicioDeProyectoConVista`
// (`opencode/servidor/servicio-con-vista.ts`, el ÚNICO call site de producción
// autorizado a `obtenerServicioDeProyecto` — guardia estructural de W3,
// `scripts/guardia-servicio-con-vista.mjs`) y le pide a `iniciarServidor` que lo
// sirva. La tool y el navegador comparten el MISMO `MotorDeProyecto` en memoria
// (singleton por (directorio, idProyecto) de `composicion-raiz.ts`) — un solo
// Engine, sin importar quién lo pida primero.
import { tool } from "@opencode-ai/plugin"
import type { ServicioDeProyecto, Snapshot } from "../nucleo/composicion-raiz.ts"
import type { ServidorProyecto } from "../servidor/servidor-proyecto.ts"
import type { Catalogo } from "../nucleo/catalogo.ts"
import type { ModeloDeVista } from "../vista-fisica/modelo-vista.ts"

// Fase 2, Slice 2 (§3.1 del diseño, PHASE_2_SLICE_2_DESIGN.md, "Módulo compartido"):
// `directorioDeDatos`/`ID_PROYECTO_DEFAULT` vivían ACÁ (Slice 1, W4) — se mudaron a
// `../vista-fisica/ubicacion-proyecto.ts` porque la tool nueva
// (`opencode/tool/proyecto-fisico.ts`) necesita el MISMO cálculo de directorio (y "los
// tools no se importan entre sí"). Reexportadas tal cual, comportamiento IDÉNTICO —
// esta tool sigue siendo el único dueño histórico de la doc larga, que ahora vive en
// el módulo compartido.
export { directorioDeDatos, ID_PROYECTO_DEFAULT } from "../vista-fisica/ubicacion-proyecto.ts"
import { directorioDeDatos, ID_PROYECTO_DEFAULT, validarIdProyecto } from "../vista-fisica/ubicacion-proyecto.ts"

export interface ServidorYServicioVistaFisica {
  readonly servidor: ServidorProyecto
  readonly servicio: ServicioDeProyecto
}

/**
 * Un único servidor HTTP por (directorio de datos, idProyecto) EN ESTE PROCESO —
 * `Map` a nivel de módulo, mismo patrón de estado persistente ya usado en este
 * repo (`opencode/tool/platformio.ts:20`, `pioPathCache`, citado por el informe
 * ARCH-A §1 como precedente real). `servicio-con-vista.ts`/`composicion-raiz.ts`
 * YA memoizan el `ServicioDeProyecto` en sí (un solo Engine por proyecto, sin
 * importar quién lo pida) — este Map, en cambio, evita levantar un SEGUNDO
 * listener HTTP para ese mismo servicio si la tool se invoca más de una vez en
 * el mismo proceso.
 *
 * Deliberadamente cachea sólo la PROMESA del servidor — nunca la IR/el
 * snapshot. Cada consumidor sigue leyendo el estado siempre a través de
 * `servicio.snapshot()` (o del GET del servidor), nunca de un valor guardado
 * acá: si el proyecto cambia (por el navegador, por otra invocación de la
 * tool, o por cualquier actor), la PRÓXIMA lectura ya lo ve, porque nunca hay
 * una copia vieja escondida en este módulo (`tests/phase2-e2e.test.mjs`, "la
 * tool no cachea la IR").
 */
const registroServidores = new Map<string, Promise<ServidorYServicioVistaFisica>>()

function claveDeServidor(directorioDatos: string, idProyecto: string): string {
  return `${directorioDatos}::${idProyecto}`
}

type ModuloServicioConVista = typeof import("../servidor/servicio-con-vista.ts")
type ModuloServidorProyecto = typeof import("../servidor/servidor-proyecto.ts")

/**
 * Carga PEREZOSA de `../servidor/*` (D13, PHASE_2_SLICE_1_HARDENING_DESIGN.md,
 * decisión INST-2=A) — `await import()` acá adentro, y NUNCA como import de
 * valor en el top-level del archivo (los `import type` de arriba sí se quedan:
 * son sintaxis borrable, no generan ningún `import()` en runtime).
 *
 * Por qué: el registry de tools de OpenCode importa cada tool de `tool/` en un
 * loop SIN catch por archivo (`packages/opencode/src/tool/registry.ts:199-212`,
 * `for (match of matches) { const mod = yield* Effect.promise(() =>
 * import(...)) }`). Si este módulo importara `../servidor/*` como valor en el
 * top-level y esa carpeta faltara (instalación a medio copiar, actualización
 * interrumpida, o el rollback por overlay documentado en
 * ARCH_INSTALL_REPORT.md §4, escenario R), el `import()` de ESTA tool
 * rechazaría durante la carga del REGISTRO ENTERO — tirando abajo, con ella,
 * las otras nueve tools y los built-ins (reproducido: ARCH_INSTALL_REPORT.md
 * §0.2, "con el install de hoy, NINGUNA tool carga"). Con la carga acá adentro,
 * el import ESTÁTICO de `tool/vista-fisica.ts` no toca el disco de
 * `../servidor/` en absoluto — sólo lo hace la PRIMERA vez que alguien pide
 * abrir la vista física, y sólo ESTA tool se ve afectada si falta.
 *
 * El error, si falta la carpeta: NUNCA un catch vacío, NUNCA un fallback
 * simulado ni un "listo" que no se comprobó — se nombra la pieza que falta
 * (`servidor/`) y se sugiere reinstalar, determinista y comprensible.
 */
async function cargarServidor(): Promise<{
  obtenerServicioDeProyectoConVista: ModuloServicioConVista["obtenerServicioDeProyectoConVista"]
  iniciarServidor: ModuloServidorProyecto["iniciarServidor"]
}> {
  let modServicio: ModuloServicioConVista
  let modServidor: ModuloServidorProyecto
  try {
    ;[modServicio, modServidor] = await Promise.all([import("../servidor/servicio-con-vista.ts"), import("../servidor/servidor-proyecto.ts")])
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Falta la carpeta "servidor" de Tecnia Bot (no se pudo cargar ../servidor/ junto a esta tool: ${detalle}). ` +
        `Esto pasa con una instalación incompleta o interrumpida a mitad de una actualización. Reinstalá ` +
        `Tecnia Bot (o corré "Reparar Tecnia Bot" desde el menú inicio en Windows) para arreglarlo.`,
    )
  }
  return { obtenerServicioDeProyectoConVista: modServicio.obtenerServicioDeProyectoConVista, iniciarServidor: modServidor.iniciarServidor }
}

/**
 * Obtiene (o levanta, la primera vez en este proceso) el servidor de la vista
 * física para una carpeta de trabajo activa — función interna EXPORTADA para
 * que `tests/phase2-e2e.test.mjs` pueda verificar "la tool y el navegador
 * comparten el mismo Engine" sin pasar por `execute()` (que llama
 * `Bun.spawn`, sólo disponible bajo el runtime Bun de OpenCode — ver
 * `abrirEnNavegador` más abajo; importar este módulo entero SÍ funciona bajo
 * Node para testear, porque `@opencode-ai/plugin`/`tool()` no tiene efectos de
 * import — pero invocar la acción por defecto de la tool sí requeriría Bun).
 */
export async function obtenerServidorVistaFisica(directorioActivo: string, idProyecto: string = ID_PROYECTO_DEFAULT): Promise<ServidorYServicioVistaFisica> {
  const directorioDatos = directorioDeDatos(directorioActivo)
  const clave = claveDeServidor(directorioDatos, idProyecto)
  const existente = registroServidores.get(clave)
  if (existente) return existente

  const promesa = (async (): Promise<ServidorYServicioVistaFisica> => {
    const { obtenerServicioDeProyectoConVista, iniciarServidor } = await cargarServidor()
    const servicio = obtenerServicioDeProyectoConVista({ directorio: directorioDatos, idProyecto })
    const servidor = await iniciarServidor({ servicio })
    return { servidor, servicio }
  })()

  registroServidores.set(clave, promesa)
  try {
    return await promesa
  } catch (error) {
    // Si falló levantar el servidor (ej. puerto/FS), no dejar la entrada rota
    // para siempre en el Map: la próxima invocación reintenta desde cero.
    registroServidores.delete(clave)
    throw error
  }
}

/**
 * Abre una URL en el navegador por defecto del sistema, sin bloquear la tool
 * (proceso detached, best-effort). Devuelve `true` si lo lanzó sin excepción,
 * `false` si falló (nunca rompe la tool).
 *
 * CITA: misma lógica mínima que `opencode/tool/circuito.ts::abrirEnNavegador`
 * (líneas 48-65), replicada acá porque los tools de este repo no se importan
 * entre sí (mismo criterio que ya documenta `comoUrl` en
 * circuito.ts/ficha.ts/imprimible.ts/ayuda.ts: "cuatro copias de seis líneas es
 * más barato que inventar una capa de infraestructura para esto"). A
 * diferencia de `circuito.ts`, acá NUNCA hace falta `comoUrl` — esa función
 * arma una URL `file://` a partir de una ruta de archivo, y acá la URL YA es
 * `http://127.0.0.1:<puerto>/`, servida por `servidor-proyecto.ts`.
 */
function abrirEnNavegador(url: string): boolean {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : process.platform === "darwin"
          ? ["open", url]
          : ["xdg-open", url]
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    proc.unref()
    return true
  } catch {
    return false
  }
}

/** `Snapshot` (composicion-raiz.ts) nunca declara `vista` en su tipo estático — ver la
 * misma nota en `tool/proyecto-fisico.ts::SnapshotConVista`. Mismo criterio acá. */
type SnapshotConVista = Snapshot & { readonly vista?: ModeloDeVista }

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 3, Wave 0 (W-W0-TOOL, F-05/pestañas, PHASE_3_WAVE_0_DESIGN.md) — STUBS
// deliberados (RED genuino, TEST-FIRST obligatorio del briefing de la Wave 0):
// `debeAbrirNuevaPestana`/`resumenDelProyecto` todavía NO implementan la regla real —
// sólo tienen la forma mínima para que `tests/wave0-tool.test.mjs` importe y FALLE por
// una aserción semántica. La implementación real llega en el commit GREEN inmediato
// siguiente al commit `test(...): RED ...`.
// ════════════════════════════════════════════════════════════════════════════════════

/** Pura, sin Bun/navegador real — exportada para testear la decisión de "pestañas"
 * (F-05 continuación) sin depender de `Bun.spawn` (`abrirEnNavegador`, más abajo). */
export function debeAbrirNuevaPestana(_yaAbiertoEnEsteProceso: boolean, _reabrir: boolean | undefined): boolean {
  return true
}

/** Resumen en texto llano del snapshot vigente (F-05) — pura, derivada del `Proyecto`
 * (IR) y del catálogo, nunca de una tabla hardcodeada. */
export function resumenDelProyecto(_snapshot: SnapshotConVista, _catalogo: Catalogo): string {
  return ""
}

export default tool({
  description: `Abre en el navegador la vista física del circuito (ESP32 + LED, este slice) del proyecto activo: piezas Wokwi reales, con selectores de GPIO editables desde la propia página. A diferencia de \`circuito\` (que genera un HTML estático de una sola vez), esta vista queda VIVA — cualquier cambio que hagas sobre el proyecto (con otras tools, o el que haga el alumno desde el navegador) usa el MISMO motor, así que un GET/refresh posterior ya lo refleja.

Usala cuando el alumno/docente quiera VER y tocar el circuito en el navegador, no un archivo para imprimir o pegar en otro lado.`,
  args: {
    idProyecto: tool.schema
      .string()
      .optional()
      .describe(`Id del proyecto de vista física a abrir. Por defecto "${ID_PROYECTO_DEFAULT}" — un único proyecto activo por carpeta de trabajo; no hace falta pasarlo salvo que quieras separar varios proyectos en la misma carpeta.`),
  },
  async execute(args, ctx) {
    const idProyecto = args.idProyecto?.trim() || ID_PROYECTO_DEFAULT

    // Fix C-01 (CRITICAL, red team Phase 2 Slice 2, RED-S2-TOOL/INFORME.md — "mismo bug
    // preexistente de Slice 1"): `idProyecto` viajaba SIN VALIDAR hasta
    // `obtenerServicioDeProyectoConVista` (servidor/servicio-con-vista.ts, capa
    // PROTEGIDA), que arma la ruta final (y la del candado) sin chequear separadores de
    // ruta ni "..". Se rechaza ACÁ, ANTES de `obtenerServidorVistaFisica`: nunca abre un
    // servidor, nunca toca disco, nunca toma el candado con un id inválido.
    if (!validarIdProyecto(idProyecto)) {
      return `No pude abrir la vista física: idProyecto inválido (${JSON.stringify(idProyecto)}). Tiene que ser alfanumérico (con "-"/"_" opcionales, sin espacios ni "/", "\\" o ".."), de 1 a 64 caracteres.`
    }

    // Fix H5 (red-team Phase 2 Slice 1): si otro proceso (otra sesión de OpenCode)
    // ya tiene este proyecto abierto, obtenerServidorVistaFisica (vía
    // obtenerServicioDeProyectoConVista, candado de propiedad por proceso) lanza —
    // se devuelve un mensaje claro a la conversación en vez de dejar que la tool
    // termine en una excepción cruda.
    let servidor
    try {
      ;({ servidor } = await obtenerServidorVistaFisica(ctx.directory, idProyecto))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return `No pude abrir la vista física: ${mensaje}`
    }
    const abierto = abrirEnNavegador(servidor.url)
    return abierto
      ? `Vista física abierta en el navegador: ${servidor.url}`
      : `No pude abrir el navegador solo. Abrí esta URL a mano: ${servidor.url}`
  },
})
