// `carga/ejecutar.ts` — el ÚNICO lugar del producto que arma y lanza un argv de carga.
//
// POR QUÉ UN SOLO LUGAR. Cargar firmware es lo único que hace Tecnia Bot que puede
// dejar una placa sin arrancar. Si el argv de carga se puede armar en cualquier
// archivo, alcanza con que UNO se saltee el checklist. Por eso (ADR-001 §2.1 y §9.8,
// CONTRATOS-API §9 y §14):
//   - este es el único archivo que escribe `upload` en un argv;
//   - este es el único módulo que tiene la capacidad privada que `run()` exige para
//     lanzar un argv de carga (`carga/proceso.ts`, "LA GUARDIA EN RUNTIME"). Cualquier
//     otro que lo intente recibe `RUTA_DE_CARGA_NO_AUTORIZADA` y no se lanza nada.
//
// ESTADO: TRANSICIÓN (Slice 2, etapa 1 de 5). El gate (`carga/gate.ts`) todavía no
// existe. Hasta que exista, la única ruta de carga del producto sigue siendo
// `tool/platformio.ts::cargar()`, con el checklist de 0.4.8 delante — y esa función
// pasa por acá: arma su argv con `argvDeCargaHeredada` y lo lanza con `lanzarCarga`.
// Así la guardia en runtime ya está puesta sin cambiar qué hace `flash`/`both`. Cuando
// el gate reemplace a `cargar()`, `argvDeCargaHeredada` se BORRA y `lanzarCarga` pasa a
// admitir únicamente el argv de `argvDeCarga`.
//
// Este módulo importa sólo `node:` y módulos de `carga/` — nunca `tool/` ni el plugin.

import { isAbsolute } from "node:path"
import { puertoValido } from "./identidad.ts"
import { ErrorDeCarga, reclamarCapacidadDeCarga, timeoutCarga, type Run, type RunResult } from "./proceso.ts"

// Se pide UNA vez, al cargarse el módulo. Si viene `null` es que otro módulo la pidió
// antes: este no puede cargar y lo dice en `lanzarCarga`, sin romper el import.
const CAPACIDAD = reclamarCapacidadDeCarga()

const ENTORNO_VALIDO = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/

const rechazo = (detalle: string) => new ErrorDeCarga("RUTA_DE_CARGA_NO_AUTORIZADA", detalle)

/**
 * El argv de carga del gate: sube el firmware YA COMPILADO, sin recompilar, del
 * environment indicado, al puerto indicado.
 *
 *   pio run -d <cwd> -e <environment> -t nobuild -t upload --upload-port <puerto>
 *
 * `-e` es obligatorio (sin él PlatformIO sube TODOS los environments del ini) y
 * `nobuild` también (lo que se sube es el artefacto que se autorizó, no uno nuevo).
 *
 * Ningún valor puede parecer una opción ni otra cosa que lo que dice ser: `cwd`
 * absoluto, `environment` con la forma de un nombre de environment y `puerto` con
 * forma de puerto serie (una IP o un hostname harían que PlatformIO cargue por red).
 * Si algo no cumple, tira y no devuelve argv: el gate valida antes con su propio
 * código; esto es la última barrera, no la primera.
 */
export function argvDeCarga(o: { cwd: string; environment: string; puerto: string }): string[] {
  if (typeof o.cwd !== "string" || !isAbsolute(o.cwd)) throw rechazo("la carpeta del proyecto no es una ruta absoluta")
  if (typeof o.environment !== "string" || !ENTORNO_VALIDO.test(o.environment)) throw rechazo("el environment no tiene forma de nombre de environment")
  if (typeof o.puerto !== "string" || !puertoValido(o.puerto)) throw rechazo("el puerto no tiene forma de puerto serie")
  return ["pio", "run", "-d", o.cwd, "-e", o.environment, "-t", "nobuild", "-t", "upload", "--upload-port", o.puerto]
}

/**
 * El argv de `programa` con `accion: "cargar"` (H1 del MVP): COMPILA Y GRABA en un solo paso,
 * desde la carpeta privada donde se acaba de escribir el programa generado.
 *
 *   pio run -d <cwd> -e <environment> -t upload --upload-port <puerto>
 *
 * Es `argvDeCarga` SIN `nobuild`: DESVÍO DECLARADO del contrato v1.2 (CONTRATOS-API §9),
 * decidido por el owner para el MVP — se compila y graba en un paso, como la ruta heredada
 * que ya funciona. Mismas validaciones que `argvDeCarga` y la misma última barrera en
 * `lanzarCarga`.
 */
export function argvDeCargaCompilando(o: { cwd: string; environment: string; puerto: string }): string[] {
  argvDeCarga(o) // valida y tira igual que el del gate; el argv que devuelve no se usa
  return ["pio", "run", "-d", o.cwd, "-e", o.environment, "-t", "upload", "--upload-port", o.puerto]
}

/**
 * TRANSICIÓN — el argv de carga de `tool/platformio.ts::cargar()`, idéntico al de
 * 0.4.8: compila adentro de la carga, sin `-d` (usa el `cwd` del proceso) y con `-e`
 * sólo si se pidió un environment. No valida el puerto ni el environment, igual que
 * hoy: cambiar eso es cambiar el comportamiento de `flash`, y eso es del gate.
 *
 * Se borra cuando el gate reemplace a `cargar()`. No la uses para nada nuevo.
 */
export function argvDeCargaHeredada(o: { puerto: string; environment?: string }): string[] {
  return ["pio", "run", "--target", "upload", "--upload-port", o.puerto, ...(o.environment ? ["-e", o.environment] : [])]
}

/** Las opciones que puede traer un argv de carga, y si llevan valor. Lista cerrada. */
const OPCIONES_ADMITIDAS = new Set(["-d", "-e", "-t", "--target", "--upload-port"])
const TARGETS_ADMITIDOS = new Set(["upload", "nobuild"])

/** `null` si `argv` es un argv de carga admitido; si no, por qué no. */
function porQueNoEsCargaAdmitida(argv: readonly string[]): string | null {
  if (argv[0] !== "pio" || argv[1] !== "run") return "no es `pio run`"
  let cargas = 0
  let puertos = 0
  for (let i = 2; i < argv.length; i += 2) {
    const opcion = argv[i] ?? ""
    const valor = argv[i + 1]
    if (!OPCIONES_ADMITIDAS.has(opcion)) return `trae algo que no es de una carga: ${opcion}`
    if (typeof valor !== "string" || valor === "") return `a ${opcion} le falta el valor`
    if (opcion === "-t" || opcion === "--target") {
      if (!TARGETS_ADMITIDOS.has(valor)) return `pide un target que no es cargar el programa: ${valor}`
      if (valor === "upload") cargas++
    }
    if (opcion === "--upload-port") puertos++
  }
  if (cargas !== 1) return "tiene que pedir el target upload exactamente una vez"
  if (puertos !== 1) return "tiene que traer --upload-port exactamente una vez"
  return null
}

/**
 * Lanza una carga. Es el único llamador de `run()` que le pasa la capacidad.
 *
 * `argv` tiene que ser un argv de carga de este módulo (`argvDeCarga` o, durante la
 * transición, `argvDeCargaHeredada`): `pio run` con `-d`, `-e`, `-t`/`--target`
 * (sólo `upload` y `nobuild`) y `--upload-port`, con `upload` y el puerto una vez
 * cada uno. Cualquier otra cosa —`uploadfs`, una opción suelta, otro comando— se
 * rechaza SIN lanzar nada: la capacidad no sirve para correr lo que sea.
 *
 * `timeoutMs` no está en CONTRATOS-API §9: se agregó porque la carga heredada
 * necesita conservar su propio tope (3 minutos si faltan herramientas). Sin
 * indicarlo se usa `timeoutCarga()`.
 *
 * `carpetaPrivada` (ciclo 2): la carpeta privada de `programa cargar`. Con ella, si hay que
 * cortar, `run()` puede comprobar que ningún proceso la sigue usando; sin ella (la carga
 * heredada) el corte nunca se da por confirmado.
 */
export async function lanzarCarga(run: Run, argv: string[], cwd: string, signal?: AbortSignal, timeoutMs: number = timeoutCarga(), carpetaPrivada?: string): Promise<RunResult> {
  if (CAPACIDAD === null) throw rechazo("este módulo de carga se quedó sin la capacidad: otro la pidió antes. No se puede cargar desde acá")
  const motivo = porQueNoEsCargaAdmitida(argv)
  if (motivo) throw rechazo(`el argv no es una carga admitida (${motivo}); no se lanzó`)
  return run(argv, cwd, signal, timeoutMs, CAPACIDAD, carpetaPrivada)
}
