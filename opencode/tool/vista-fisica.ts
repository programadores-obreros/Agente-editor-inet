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
import { join } from "node:path"
import { obtenerServicioDeProyectoConVista } from "../servidor/servicio-con-vista.ts"
import { iniciarServidor } from "../servidor/servidor-proyecto.ts"
import type { ServicioDeProyecto } from "../nucleo/composicion-raiz.ts"
import type { ServidorProyecto } from "../servidor/servidor-proyecto.ts"

/**
 * Directorio de DATOS de la vista física para una carpeta de trabajo activa
 * (`ctx.directory`) — decisión registrada (briefing tarea 2, "decidí algo
 * razonable y documentalo").
 *
 * Se eligió un subdirectorio OCULTO DENTRO de la carpeta de trabajo activa
 * (`<ctx.directory>/.tecnia-vista-fisica/`), en vez de:
 * - `~/.config/opencode/` (lo que usan `memoria.ts`/`perfil.ts`/`clave.ts`): esos
 *   archivos son datos de LA MÁQUINA/persona (progreso pedagógico, perfil), no de
 *   un proyecto puntual — mezclar un `<idProyecto>.json` del motor ahí adentro
 *   rompería esa separación a propósito documentada en `memoria.ts`.
 * - Escribir `<idProyecto>.json` suelto en la raíz visible de `ctx.directory`:
 *   `crearAlmacen` (`nucleo/almacen.ts`) escribe el archivo DENTRO del
 *   `directorio` que se le pasa, tal cual — sin este subdirectorio, el archivo
 *   del motor quedaría mezclado con los sketches/fichas del alumno en la misma
 *   carpeta visible.
 *
 * Aislado por CARPETA DE TRABAJO (no por máquina ni por proceso): abrir Tecnia
 * Bot en dos carpetas de proyecto distintas da dos vistas físicas
 * independientes — mismo criterio "un directorio, un estado" que ya usa
 * `InstanceState` del host (informe ARCH-A, §1) y que la propia
 * `composicion-raiz.ts` documenta como su convención de aislamiento.
 */
export function directorioDeDatos(directorioActivo: string): string {
  return join(directorioActivo, ".tecnia-vista-fisica")
}

/** Un único proyecto de vista física por carpeta de trabajo — el slice 1 no pide
 * multi-proyecto por carpeta; `idProyecto` queda como argumento opcional para no
 * cerrar esa puerta más adelante. */
export const ID_PROYECTO_DEFAULT = "activo"

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
