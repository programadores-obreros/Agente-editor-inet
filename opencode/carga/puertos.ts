// `carga/puertos.ts` — un puerto serie, una sola carga a la vez, también entre procesos.
//
// POR QUÉ. Dos ventanas de OpenCode son dos procesos. Sin candado, las dos pueden
// mostrar el cartel de carga sobre la misma placa y cargar una encima de la otra
// (ADR-001 §10.4, decisión D4 del owner; riesgo R16). El candado es un archivo por
// puerto, tomado con el mecanismo de `./candado.ts` (el mismo que protege un proyecto
// físico abierto): creación exclusiva atómica, recuperación de un dueño muerto con
// reclamo, y liberación sólo de lo propio.
//
// LA REGLA QUE NO SE NEGOCIA: ante la duda, el puerto está OCUPADO. Un candado que no
// se puede leer, un directorio que no se puede crear, un disco lleno: todo eso es
// `PUERTO_OCUPADO`, con el detalle. Nunca se pisa un candado ajeno y nunca se sigue
// "porque seguramente está libre".
//
// DÓNDE: `XDG_CONFIG_HOME/opencode/tecnia-candados/<puerto saneado>.lock`, al lado de
// `tecnia-cargas.json`. Adentro va `{pid, hostname, creado}` y nada más: ni la ruta
// del proyecto, ni la serie de la placa, ni quién pidió la carga.
//
// ESTADO: todavía no lo usa ninguna tool. Lo cablea el gate (`carga/gate.ts`), que lo
// toma después de elegir el puerto y ANTES del cartel, y lo libera en `finally`.
//
// LÍMITES (heredados de `./candado.ts`, ver ahí): reuso de PID, filesystems de red
// viejos, `hostname` sin normalizar. Y uno propio: si el proceso muere de golpe
// (SIGKILL, corte de luz) el archivo queda, y la próxima carga lo recupera porque su
// dueño ya no vive. Windows: NO VERIFICADO (QA en la VM).

import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { leerCandado, liberarCandadoSiPropio, tomarCandado, type ContenidoCandado } from "./candado.ts"
import { PUERTO_WINDOWS, puertoValido } from "./identidad.ts"

/** La carpeta de los candados de puerto. Se calcula en cada llamada: los tests fijan `XDG_CONFIG_HOME`. */
const carpetaDeCandados = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "tecnia-candados")

/**
 * El archivo de candado de un puerto.
 *
 *   /dev/ttyACM0  →  dev-ttyACM0.lock
 *   COM5, com5    →  COM5.lock   (en Windows es el mismo puerto: se normaliza)
 *
 * El nombre es SIEMPRE un solo segmento adentro de la carpeta de candados: las barras
 * pasan a guion y cualquier otro caracter raro a `_`. Un "puerto" inventado no puede
 * hacer que se escriba en otra carpeta.
 */
export function rutaCandado(puerto: string): string {
  const normalizado = PUERTO_WINDOWS.test(puerto) ? puerto.toUpperCase() : puerto
  const saneado = normalizado
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "_")
  return join(carpetaDeCandados(), `${saneado || "_"}.lock`)
}

/** Un candado de puerto que este proceso puede interpretar: pid entero positivo, hostname y fecha como texto. */
function esDuenoLegible(c: ContenidoCandado): boolean {
  return Number.isSafeInteger(c.pid) && c.pid > 0 && typeof c.hostname === "string" && c.hostname !== "" && typeof c.creado === "string"
}

/** Los candados de puerto que ESTE proceso tiene ahora, por ruta de candado. */
interface ReservaPropia {
  readonly contenido: ContenidoCandado
  readonly dueno: string
  /** Ya se liberó (por su `liberar()` o por `liberarTodosLosPuertos`): no vuelve a tocar el archivo. */
  liberada: boolean
}
const propios = new Map<string, ReservaPropia>()

let limpiezaAlSalirRegistrada = false
function asegurarLimpiezaAlSalir(): void {
  if (limpiezaAlSalirRegistrada) return
  limpiezaAlSalirRegistrada = true
  // `process.on("exit")` sólo corre código síncrono: liberar lo es.
  process.on("exit", liberarTodosLosPuertos)
}

type Reserva = { ok: true; liberar: () => void } | { ok: false; codigo: "PUERTO_OCUPADO"; detalle: string }

const ocupado = (detalle: string): Reserva => ({ ok: false, codigo: "PUERTO_OCUPADO", detalle })

/**
 * Reserva `puerto` para una carga, o dice que está ocupado.
 *
 * `dueno` es una etiqueta de quién lo pide (el origen o el id de la operación). Se
 * guarda sólo en la memoria de este proceso, para poder decir "ya lo tiene tal carga"
 * si se pide dos veces; NO se escribe en el archivo.
 *
 * `liberar()` se puede llamar más de una vez y nunca tira: está pensado para un
 * `finally`. Sólo borra el candado si sigue siendo el de esta reserva.
 */
export function reservarPuerto(puerto: string, dueno: string): Reserva {
  if (typeof puerto !== "string" || !puertoValido(puerto)) {
    return ocupado("eso no tiene forma de puerto serie: no se reserva ni se usa")
  }
  const ruta = rutaCandado(puerto)
  const mio = propios.get(ruta)
  if (mio) return ocupado(`ya hay una carga en curso en ${puerto} desde esta misma ventana de Tecnia Bot (${mio.dueno})`)

  let resultado: ReturnType<typeof tomarCandado>
  try {
    mkdirSync(dirname(ruta), { recursive: true })
    resultado = tomarCandado(ruta, { esLegible: esDuenoLegible })
  } catch (error) {
    // Falla de E/S (no se puede crear la carpeta o el archivo, sin permiso, disco lleno).
    // No se sabe si el puerto está libre: no se carga.
    const codigo = (error as NodeJS.ErrnoException).code ?? "error"
    return ocupado(`no pude tomar el candado de ${puerto} (${codigo}): sin candado no cargo`)
  }

  if (!resultado.ok) {
    switch (resultado.motivo) {
      case "ocupado":
        return ocupado(`otro proceso de esta compu está cargando en ${puerto} (pid ${resultado.existente.pid})`)
      case "ilegible":
        return ocupado(`el candado de ${puerto} existe pero no se puede leer: puede estar tomándolo otro proceso. Si no hay ninguna otra carga en curso, borrá a mano ${resultado.rutaLock}`)
      case "recuperando":
        return ocupado(`otro proceso está recuperando el candado de ${puerto}. Si no hay ninguna otra carga en curso, borrá a mano ${resultado.rutaReclamo}`)
      case "cambio":
        return ocupado(`otro proceso tomó ${puerto} mientras yo lo estaba por tomar`)
    }
  }

  const reserva: ReservaPropia = { contenido: resultado.contenido, dueno, liberada: false }
  propios.set(ruta, reserva)
  asegurarLimpiezaAlSalir()
  return {
    ok: true,
    liberar() {
      // Una reserva ya liberada no toca nada: el archivo puede ser ahora de OTRA reserva.
      if (reserva.liberada) return
      reserva.liberada = true
      if (propios.get(ruta) === reserva) propios.delete(ruta)
      liberarCandadoSiPropio(ruta, reserva.contenido)
    },
  }
}

/**
 * Quién tiene el candado de `puerto`, según el archivo. `null` si no hay candado o si
 * no se puede interpretar. OJO: `null` NO significa "libre" — un candado ilegible
 * también da `null`, y `reservarPuerto` lo trata como ocupado. Esto es para informar.
 */
export function duenoDelPuerto(puerto: string): { pid: number; hostname: string; creado: string } | null {
  const c = leerCandado(rutaCandado(puerto))
  if (!c || !esDuenoLegible(c)) return null
  return { pid: c.pid, hostname: c.hostname, creado: c.creado }
}

/** Libera todos los candados de puerto de ESTE proceso (y sólo ésos). La usan `process.on("exit")` y los tests. */
export function liberarTodosLosPuertos(): void {
  for (const [ruta, reserva] of propios) {
    reserva.liberada = true
    liberarCandadoSiPropio(ruta, reserva.contenido)
  }
  propios.clear()
}
