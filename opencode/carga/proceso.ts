// `carga/proceso.ts` — el runner de procesos de Tecnia Bot y lo que lo rodea.
//
// DE DÓNDE SALE. Todo esto vivía en `opencode/tool/platformio.ts`: dónde está `pio`,
// cuánto se espera a cada comando, `run()`, cómo se traduce un error y cómo se recorta
// una salida larga. Se movió acá en el Slice 2 del gate único de carga (ADR-001 §2.1,
// CONTRATOS-API §1) para que el gate pueda usarlo sin importar una tool.
// `tool/platformio.ts` lo re-exporta con los mismos nombres: `tool/programa.ts` y los
// tests que copian `platformio.ts` a un temporal siguen importando de ahí.
//
// DOS COSAS NUEVAS respecto de lo que se movió:
//
//   1. `run()` CONSERVA LO QUE EL PROCESO ALCANZÓ A ESCRIBIR cuando se corta por
//      timeout (124) o por cancelación (130). Antes devolvía `stdout: ""`: si la carga
//      se cortaba a mitad de escritura, no quedaba ni el último `Writing at 0x...` para
//      saber hasta dónde había llegado.
//
//   2. LA GUARDIA EN RUNTIME (CONTRATOS-API §14, ADR-001 §9.8b). `run()` mira el argv
//      YA RESUELTO y, si es un argv de carga (ver `argvEsDeCarga`), exige la capacidad
//      privada `CAPACIDAD_DE_CARGA`. Sin ella lanza `RUTA_DE_CARGA_NO_AUTORIZADA` y NO
//      lanza ningún proceso. La capacidad es un `Symbol` que este archivo no exporta:
//      se entrega UNA sola vez, a `carga/ejecutar.ts`. Una guardia léxica (buscar
//      "upload" en el código) se evade concatenando strings; ésta mira lo que de verdad
//      está por ejecutarse.
//
//   3. CORTAR UNA CARGA CORTA EL ÁRBOL ENTERO (Q-01 del QA de H1). Si el argv trae la
//      capacidad y hay que cortarlo (abort o timeout), se terminan el hijo y TODOS sus
//      descendientes con `./arbol.ts`, y `run()` vuelve recién cuando se comprobó que no
//      queda ninguno (o vencieron los topes). `procesosDeCargaTerminados` dice cuál de las
//      dos. Para lo que no es carga, el corte es el de siempre.
//
// Este módulo importa sólo `node:` y `./arbol.ts` — nunca `tool/` ni `@opencode-ai/plugin`.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, win32 } from "node:path"
import { inicioDe, terminarArbol, TOPE_KILL_MS } from "./arbol.ts"

/** En 124 (timeout) y 130 (cancelado), `stdout`/`stderr` traen lo capturado hasta el corte. */
export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /**
   * Sólo en una CARGA cortada (124/130): `true` si se comprobó que no queda vivo ningún
   * proceso del árbol de la carga (pio → scons → esptool/avrdude); `false` si no se pudo
   * confirmar. En cualquier otro caso no está.
   */
  procesosDeCargaTerminados?: boolean
}

// PlatformIO casi nunca queda en el PATH tras instalarse (ni en Linux ni en Windows).
// Buscamos el binario en las rutas de instalación conocidas antes de caer al PATH.
//
// Solo se cachea una ruta REAL. La primera version cacheaba tambien el fallback
// "pio": si el tool arrancaba sin PlatformIO, se quedaba con "pio" para siempre y
// despues de que `reparar` lo instalara seguia sin encontrarlo (y `compile`
// fallaba hasta reiniciar OpenCode).
let pioPathCache: string | null = null

/** Saca vacíos y repetidos preservando el orden: el primero que aparece manda. */
const unicos = (xs: Array<string | undefined>): string[] => [
  ...new Set(xs.filter((x): x is string => typeof x === "string" && x.trim() !== "")),
]

/**
 * TRES LUGARES DONDE BUSCAR, NO UNO — la misma lección que el lanzador aprendió
 * buscando OpenCode (`installer/abrir-tecnia-bot.cmd`) y que este comentario, en
 * plural, prometía sobre una lista de UN elemento durante meses.
 *
 * EL CASO REAL (escuela Juana Manso, 2026-09-08). La usuaria de Windows se llama
 * `Dirección310`, con `ó`, que no es ASCII. PlatformIO Core no soporta rutas con
 * caracteres no-ASCII —sus toolchains de gcc se rompen— así que en Windows, y a
 * propósito, RELOCALIZA su core_dir a la raíz del disco. El instalador oficial
 * dejó escrito en pantalla:
 *
 *     Creating a virtual environment at C:\.platformio\penv
 *     The full path to platformio.exe is C:\.platformio\penv\Scripts\platformio.exe
 *
 * Nosotros mirábamos SOLO `$HOME\.platformio` y le dijimos a una docente durante
 * TRES SEMANAS que PlatformIO no estaba instalado. Lo tenía, y andaba: `pio.exe
 * --version` contestaba «PlatformIO Core, version 6.2.0».
 *
 * Por eso esto es una LISTA ORDENADA, no una ruta:
 *   1. `PLATFORMIO_CORE_DIR` si está seteada (lo que el usuario mandó, gana)
 *   2. `$HOME\.platformio` (la instalación normal)
 *   3. la raíz del disco de $HOME (`C:\.platformio`) <- el caso de arriba
 *   4. `C:\.platformio` fijo, por si $HOME vive en otro disco
 *   5. el PATH, que lo resuelve `pioBin()`/`pioDisponible()` al final
 *
 * En cada carpeta se miran `pio.exe` Y `platformio.exe` (en Unix `pio` y
 * `platformio`): los dos suelen existir, pero el mensaje del instalador oficial
 * nombra `platformio.exe`, y no queremos depender de que exista justo el que
 * elegimos nosotros.
 *
 * La relocalización a la raíz del disco es SOLO de Windows: en Linux/macOS las
 * rutas del home no rompen a gcc y PlatformIO no mueve nada. No la inventamos.
 *
 * ACÁ NO SE PREGUNTA `--version`, Y ES A PROPÓSITO. Este código está en el camino
 * caliente del tool y ya cachea: alcanza con quedarse con el primero que EXISTE.
 * Un pio a medio armar se manifiesta igual en el primer comando de verdad, con su
 * error real. Los scripts de instalación y el diagnóstico sí le preguntan
 * `--version` al primer candidato, porque corren una sola vez y ahí ese segundo
 * de más compra la diferencia entre "está" y "anda". Si venís a "arreglar" esta
 * asimetría: es deliberada.
 *
 * Toma home/plataforma/entorno por parámetro para poder probar el caso de
 * `Dirección310` desde Linux; sin argumentos se comporta como siempre.
 */
export function pioCandidatos(
  home: string = homedir(),
  plataforma: string = process.platform,
  entorno: Record<string, string | undefined> = process.env,
): string[] {
  const core = entorno.PLATFORMIO_CORE_DIR
  if (plataforma === "win32") {
    // win32.parse("C:\\Users\\Dirección310").root === "C:\\" — y anda también
    // corriendo bajo Linux, que es como lo prueban los tests.
    const raiz = win32.parse(home).root
    const dirs = unicos([core, win32.join(home, ".platformio"), raiz && win32.join(raiz, ".platformio"), "C:\\.platformio"])
    return dirs.flatMap((d) => ["pio.exe", "platformio.exe"].map((n) => win32.join(d, "penv", "Scripts", n)))
  }
  const dirs = unicos([core, join(home, ".platformio")])
  return dirs.flatMap((d) => ["pio", "platformio"].map((n) => join(d, "penv", "bin", n)))
}

export function resetPioCache(): void {
  pioPathCache = null
}

export function pioBin(): string {
  if (pioPathCache) return pioPathCache
  for (const candidate of pioCandidatos()) {
    if (existsSync(candidate)) {
      pioPathCache = candidate
      return candidate
    }
  }
  return "pio" // fallback: confiar en el PATH del sistema (sin cachear)
}

// Resuelve de nuevo, sin cache: hay binario en las rutas conocidas o en el PATH.
// Nunca hace existsSync("pio"): eso mira un archivo relativo al cwd, no el PATH.
export function pioDisponible(): boolean {
  resetPioCache()
  // El PATH se prueba con los DOS nombres: el instalador oficial deja los dos y
  // hubo maquinas donde el shim del PATH era `platformio` y no `pio`.
  return (
    pioCandidatos().some((c) => existsSync(c)) || Bun.which("pio") !== null || Bun.which("platformio") !== null
  )
}

/*
 * CUANTO SE ESPERA A CADA COMANDO, y por que dos numeros distintos.
 *
 * La primera vez que se compila para una placa nueva, `pio run` baja el
 * toolchain entero (cientos de MB) con una barra de progreso que por el pipe no
 * se ve: minutos de silencio total. En el aula eso se leia como "se colgo", y
 * sin timeout la unica salida era cerrar OpenCode. Con 15 minutos alcanza para
 * cualquier red que anda; si no termina, se lo decimos en vez de esperar para
 * siempre. Lo mismo vale para la carga: `tool-avrdude`/`esptool` se bajan en
 * el PRIMER upload, no en el compile.
 *
 * Los comandos de consulta (`pio --version`, `pio device list`, PowerShell)
 * tardan segundos: si a los 60 s no contestaron, algo esta roto.
 *
 * Se puede cambiar por variable de entorno, `TECNIA_PIO_TIMEOUT_MS`: la usan los
 * tests para probar el camino del timeout sin esperar 15 minutos, y una escuela
 * con red lenta la puede subir. Un valor que no es un numero positivo ("abc",
 * "0") se ignora, como si no estuviera.
 */
const TIMEOUT_CORTO_MS = 60_000
const TIMEOUT_LARGO_MS = 15 * 60_000
/** Los ms que pidio `TECNIA_PIO_TIMEOUT_MS`, o null si no esta o no sirve. */
function timeoutPedidoMs(): number | null {
  const n = Math.floor(Number(process.env.TECNIA_PIO_TIMEOUT_MS))
  // AbortSignal.timeout exige un entero de 32 bits con signo: con decimales o con
  // mas de 2^31-1 tira ERR_OUT_OF_RANGE (o corta al instante) en vez de esperar.
  return process.env.TECNIA_PIO_TIMEOUT_MS && Number.isFinite(n) && n > 0 ? Math.min(n, 2 ** 31 - 1) : null
}
export function timeoutLargoMs(): number {
  return timeoutPedidoMs() ?? TIMEOUT_LARGO_MS
}

/*
 * Si las herramientas de la placa NO estan bajadas, compilar es en realidad bajar
 * mas de 1 GB. Desde 0.4.6 eso lo hace el instalador; si igual faltan, es que la
 * descarga del instalador no llego, y con la red del aula tampoco va a llegar
 * desde el bot: esperar 15 minutos para enterarse es lo que trabo a la docente
 * del taller. Se espera poco y se explica. Con buena red (en casa la descarga
 * entera tardo unos 3 minutos) puede llegar a terminar igual.
 *
 * Si `TECNIA_PIO_TIMEOUT_MS` esta, manda ELLA, tambien hacia arriba. La primera
 * version hacia `Math.min(variable, 3 min)` con faltantes: una escuela con red
 * lenta que la subia a 40 minutos para dejar terminar la descarga se quedaba
 * igual con 3, sin forma de cambiarlo. Quien setea la variable sabe lo que pide.
 * Sin la variable: 3 minutos si faltan herramientas, 15 si no.
 */
const TIMEOUT_SIN_HERRAMIENTAS_MS = 3 * 60_000
export function timeoutCompilarMs(faltaban: string[]): number {
  return timeoutPedidoMs() ?? (faltaban.length > 0 ? TIMEOUT_SIN_HERRAMIENTAS_MS : TIMEOUT_LARGO_MS)
}

/**
 * Cuanto se espera a una carga que NO compila (`-t nobuild`, la del gate): el tope
 * largo. La primera carga de una placa nueva baja la herramienta de carga
 * (esptool/avrdude, pocos MB) sin mostrar progreso, y eso no se puede distinguir de
 * una placa que no contesta hasta que termina. `TECNIA_PIO_TIMEOUT_MS` manda, como
 * en los demas.
 *
 * La carga heredada de `platformio flash` (que todavia compila adentro de la carga)
 * sigue pasando su propio tope a `lanzarCarga`.
 */
export function timeoutCarga(): number {
  return timeoutPedidoMs() ?? TIMEOUT_LARGO_MS
}

/** Lo que devuelve `run()` cuando el comando no termino a tiempo (mismo codigo que `timeout(1)`). */
export const CODIGO_TIMEOUT = 124
/** Lo que devuelve `run()` cuando el usuario corto la accion desde OpenCode (Ctrl+C: 128+SIGINT). */
export const CODIGO_CANCELADO = 130
/** Lo que devuelve `run()` cuando ni siquiera pudo lanzar el proceso (el binario no está). */
export const CODIGO_NO_LANZADO = 127
/**
 * Lo que devuelve `run()` cuando el programa EXISTE pero no se pudo lanzar (sin permiso de
 * ejecucion, por ejemplo). Es el codigo de las shells para "encontrado pero no ejecutable".
 * No es lo mismo que 127 ("no esta"): mandar a reinstalar algo que esta instalado no lo arregla.
 *
 * Viene de la línea publicada (0.4.x, PIO-01 de la auditoría del 2026-11-22), donde `run()`
 * vivía en tool/platformio.ts. Al unir las dos líneas se trajo acá, que es donde está `run()`.
 */
export const CODIGO_NO_LANZO = 126
/** Los errores de lanzamiento que quieren decir "el programa esta, pero no se pudo ejecutar". */
const EXISTE_Y_NO_SE_PUDO_LANZAR = new Set(["EACCES", "EPERM", "ENOEXEC", "ETXTBSY"])

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LA GUARDIA EN RUNTIME: NINGUNA CARGA SIN LA CAPACIDAD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cargar firmware es lo único que hace este producto que puede dejar una placa sin
 * arrancar o mover un actuador en el banco de un alumno. Por eso todo argv de carga
 * tiene que salir de UN solo lugar (`carga/ejecutar.ts::lanzarCarga`), que es el que
 * el gate controla. Esta guardia lo hace cumplir en el último punto posible: justo
 * antes del `spawn`.
 *
 * CÓMO SE ENTREGA LA CAPACIDAD. Un módulo ES no tiene "amigos": no hay forma de
 * exportar algo "sólo para ejecutar.ts". Lo que se hace es entregarla UNA sola vez:
 * `reclamarCapacidadDeCarga()` devuelve el `Symbol` al primero que la pide y `null` a
 * todos los demás. La pide `ejecutar.ts` al cargarse. Si otro módulo la pidiera antes,
 * `ejecutar.ts` se quedaría sin ella y TODA carga fallaría con
 * `RUTA_DE_CARGA_NO_AUTORIZADA`: falla cerrado y a la vista, nunca en silencio. Y
 * `tests/carga-proceso.test.mjs` revisa que nadie más la nombre en `opencode/`.
 *
 * LÍMITE DECLARADO. Esto protege contra ACCIDENTES (alguien arma un argv de carga en
 * otro archivo, a mano o por concatenación). No protege contra código que llame a
 * `Bun.spawn` directo sin pasar por `run()`: eso lo cubren la guardia léxica y la
 * guardia dinámica de suite, que son de etapas posteriores del slice.
 */
const CAPACIDAD_DE_CARGA: unique symbol = Symbol("tecnia-bot.capacidad-de-carga")

/** El TIPO de la capacidad se puede nombrar (lo necesitan la firma de `Run` y los dobles de los tests); el valor no se exporta. */
export type CapacidadDeCarga = typeof CAPACIDAD_DE_CARGA

/** La firma de `run()`. Los dobles de los tests reciben la misma, capacidad incluida. */
export type Run = (
  cmd: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  capacidad?: CapacidadDeCarga,
  /** Sólo cargas: la carpeta privada de la carga, para comprobar al cortar que nadie la usa (`arbol.ts`). */
  carpetaPrivada?: string,
  /** Sólo cargas (ciclo 5): la marca única de esta carga; va SÓLO al entorno del hijo, como `TECNIA_CARGA`. */
  marcaDeCarga?: string,
) => Promise<RunResult>

let capacidadEntregada = false

/**
 * Entrega la capacidad de carga UNA sola vez. El único que la pide es
 * `carga/ejecutar.ts`. A cualquier llamada posterior le devuelve `null`: no tira, para
 * que un módulo que se evalúa dos veces no rompa la carga del resto de las tools; el
 * que se quedó sin capacidad no puede cargar, y lo dice cuando lo intenta.
 */
export function reclamarCapacidadDeCarga(): CapacidadDeCarga | null {
  if (capacidadEntregada) return null
  capacidadEntregada = true
  return CAPACIDAD_DE_CARGA
}

/** Para los dobles de `run` en los tests: comprobar la capacidad no la entrega. */
export function esCapacidadDeCarga(x: unknown): x is CapacidadDeCarga {
  return x === CAPACIDAD_DE_CARGA
}

/** Un rechazo del módulo de carga, con su código canónico (CONTRATOS-API §13). */
export class ErrorDeCarga extends Error {
  readonly codigo: string
  constructor(codigo: string, detalle?: string) {
    super(detalle ? `${codigo}: ${detalle}` : codigo)
    this.name = "ErrorDeCarga"
    this.codigo = codigo
  }
}

const ES_PIO = /^(?:pio|platformio)(?:\.exe)?$/i
const HERRAMIENTA_DE_CARGA = /espota|esptool|avrdude/i
/** `-t upload`, `--target upload`, `--target=upload`, `-tupload`, y todo target que EMPIECE con upload (uploadfs, uploadfsota, uploadeep…). */
const OPCION_DE_TARGET = /^(?:-t|--target)$/i
const TARGET_PEGADO = /^(?:-t|--target)=?upload/i
/** Subcomandos de pio que también escriben en la placa aunque el argv no diga "upload". */
const SUBCOMANDOS_QUE_CARGAN = new Set(["test", "debug", "remote"])

const nombreDe = (ruta: string) => ruta.split(/[\\/]/).pop() ?? ruta

/**
 * ¿Este argv, tal como está por ejecutarse, puede escribir firmware en una placa?
 *
 * Se llama sobre el argv YA RESUELTO (con `pio` cambiado por su ruta real), elemento
 * por elemento: no importa cómo se armó el string, importa lo que dice.
 *
 * Es de carga si:
 *   - trae `--upload-port` (suelto o como `--upload-port=...`);
 *   - trae `-t`/`--target` seguido de algo que empieza con `upload`, o la forma pegada
 *     (`--target=upload`, `-tupload`);
 *   - nombra `espota`, `esptool` o `avrdude` en cualquier elemento;
 *   - es `pio test`, `pio debug` o `pio remote`: los tres suben firmware sin que el
 *     argv lo diga (hoy nadie los llama; quedan cerrados antes de que alguien lo haga).
 *
 * DOS EXCEPCIONES AL NOMBRE DE HERRAMIENTA, las dos por rutas de CARPETA, no de
 * comando: del ejecutable se mira sólo el nombre del archivo (un `pio` instalado en
 * `/opt/esptool-lab/.platformio/penv/bin/pio` sigue siendo `pio`), y en un argv de
 * `pio` no se mira el valor de `-d`/`--project-dir`, que es la carpeta del proyecto
 * (`pio run -d /home/profe/taller-esptool/...` es una compilación). Sin esto,
 * compilar dejaba de andar según cómo se llamara la carpeta del docente. El resto de
 * los elementos se mira entero: `sh -c "esptool.py write_flash ..."` es de carga.
 */
export function argvEsDeCarga(cmd: readonly string[]): boolean {
  const ejecutable = nombreDe(cmd[0] ?? "")
  const esPio = ES_PIO.test(ejecutable)
  if (HERRAMIENTA_DE_CARGA.test(ejecutable)) return true
  if (esPio && SUBCOMANDOS_QUE_CARGAN.has((cmd[1] ?? "").toLowerCase())) return true
  for (let i = 1; i < cmd.length; i++) {
    const a = cmd[i] ?? ""
    if (/^--upload-port(?:=|$)/i.test(a)) return true
    if (TARGET_PEGADO.test(a)) return true
    if (OPCION_DE_TARGET.test(a) && /^upload/i.test(cmd[i + 1] ?? "")) return true
    const anterior = cmd[i - 1] ?? ""
    const esCarpetaDelProyecto = esPio && (anterior === "-d" || anterior === "--project-dir")
    if (!esCarpetaDelProyecto && HERRAMIENTA_DE_CARGA.test(a)) return true
  }
  return false
}

/**
 * Lee un pipe hasta que se cierra, ACUMULANDO: lo leído hasta ahora queda en
 * `parcial.texto` aunque el proceso no termine nunca.
 *
 * Antes era `new Response(proc.stdout).text()`, que es todo o nada: si el comando se
 * cortaba por timeout, lo que ya había escrito se perdía. Los dobles de los tests
 * entregan un string en vez de un stream: para eso queda el camino de `Response`.
 */
async function leerAcumulando(flujo: unknown, parcial: { texto: string }): Promise<void> {
  if (typeof ReadableStream !== "undefined" && flujo instanceof ReadableStream) {
    const lector = (flujo as ReadableStream<Uint8Array>).getReader()
    const decodificador = new TextDecoder()
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      parcial.texto += decodificador.decode(value, { stream: true })
    }
    parcial.texto += decodificador.decode()
    return
  }
  parcial.texto = await new Response(flujo as BodyInit).text()
}

/**
 * Corre un comando y devuelve codigo + salida, sin colgarse.
 *
 * El ORDEN importa: stdout y stderr se leen ANTES de esperar `exited`. Al reves,
 * el proceso se bloquea al llenar el buffer del pipe y el tool espera a un
 * proceso que espera al tool.
 *
 * El timeout y el `ctx.abort` de OpenCode se combinan en una sola senal: se le
 * pasa a Bun (que mata el proceso) Y se corre una carrera contra la lectura,
 * porque si el proceso ignora la senal —o quedo colgado en una descarga— los
 * pipes no se cierran nunca y `await` no vuelve.
 *
 * Si se corta (124 o 130), `stdout` y `stderr` traen lo que el proceso alcanzo a
 * escribir; el aviso del corte va al final de `stderr`.
 *
 * Un argv de carga sin la capacidad NO se lanza: `RUTA_DE_CARGA_NO_AUTORIZADA`
 * (ver "LA GUARDIA EN RUNTIME", arriba). El unico que la tiene es
 * `carga/ejecutar.ts::lanzarCarga`.
 */
export async function run(
  cmd: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs: number = TIMEOUT_CORTO_MS,
  capacidad?: CapacidadDeCarga,
  carpetaPrivada?: string,
  marcaDeCarga?: string,
): Promise<RunResult> {
  // Resolvemos "pio" a la ruta real del binario (PATH-independiente)
  if (cmd[0] === "pio") cmd = [pioBin(), ...cmd.slice(1)]
  // La guardia mira el argv YA resuelto, y va antes que todo: ni siquiera una senal
  // ya abortada convierte un argv de carga sin capacidad en un resultado "normal".
  if (argvEsDeCarga(cmd) && capacidad !== CAPACIDAD_DE_CARGA) {
    throw new ErrorDeCarga(
      "RUTA_DE_CARGA_NO_AUTORIZADA",
      "este comando puede escribir firmware en una placa y no salió del gate de carga; no se lanzó",
    )
  }
  const porTiempo = AbortSignal.timeout(timeoutMs)
  const corte = combinarSignals(signal, porTiempo)
  const salida = { texto: "" }
  const errores = { texto: "" }
  const conAviso = (aviso: string) => (errores.texto.trim() ? `${errores.texto.trimEnd()}\n${aviso}` : aviso)
  const resultadoCorte = (): RunResult =>
    porTiempo.aborted
      ? {
          code: CODIGO_TIMEOUT,
          stdout: salida.texto,
          stderr: conAviso(`El comando no termino en ${describirDuracion(timeoutMs)} y se corto: ${cmd.join(" ")}`),
        }
      : { code: CODIGO_CANCELADO, stdout: salida.texto, stderr: conAviso("Cancelado por el usuario.") }

  if (corte.aborted) return resultadoCorte()

  // UNA CARGA NO LE PASA LA SEÑAL A `Bun.spawn` (Q-01): si se la pasara, Bun mataría al hijo
  // en el mismo instante del corte y sus descendientes (scons, esptool) quedarían colgando de
  // init antes de que se los pueda enumerar. El corte de una carga lo hace `terminarArbol`,
  // abajo. Para todo lo que no es carga, nada cambia.
  const esCarga = capacidad === CAPACIDAD_DE_CARGA
  // Ciclo 5: la marca de la carga va SÓLO en el entorno del hijo (una copia), nunca en
  // `process.env` de OpenCode: así la heredan pio, scons, esptool y cualquier nieto huérfano,
  // y `terminarArbol` los encuentra aunque ya no sean descendientes ni usen la carpeta.
  const entornoDeCarga = esCarga && marcaDeCarga ? { env: { ...process.env, TECNIA_CARGA: marcaDeCarga } } : {}
  const lanzar = () => Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", ...entornoDeCarga, ...(esCarga ? {} : { signal: corte }) })
  let proc: ReturnType<typeof lanzar>
  try {
    proc = lanzar()
  } catch (error) {
    // NO TODA EXCEPCION ES "NO ESTA INSTALADO". Antes cualquiera salia como 127 y
    // "command not found", y el tool contestaba "PlatformIO no esta instalado... llama a
    // reparar" tambien cuando pio estaba y lo que fallaba era ejecutarlo.
    //
    // Se distingue SOLO lo que el sistema dice sin ambiguedad que es "esta y no lo pude
    // lanzar". Todo lo demas sigue siendo 127, como siempre: es el caso comun (pio no
    // esta) y no se arriesga por un codigo de error que no se midio. MEDIDO en Bun 1.4.4
    // sobre Linux: programa que no existe -> code "ENOENT" (con el nombre pelado el mensaje
    // es "Executable not found in $PATH" y NO dice ENOENT: por eso se mira `code` y no el
    // texto); sin permiso de ejecucion, o una carpeta -> code "EACCES". En Windows no se midio.
    const codigo = String((error as { code?: unknown } | null)?.code ?? "")
    if (EXISTE_Y_NO_SE_PUDO_LANZAR.has(codigo)) {
      const motivo = error instanceof Error ? error.message : String(error)
      return { code: CODIGO_NO_LANZO, stdout: "", stderr: `No se pudo lanzar ${cmd[0]}: ${motivo}` }
    }
    return { code: CODIGO_NO_LANZADO, stdout: "", stderr: "command not found" }
  }
  // Ciclo 5: cuándo arrancó el hijo de la carga, para que el barrido por marca no cuente como
  // "ilegibles" a procesos que ya existían antes (ver `conMarcaEnProc` en `arbol.ts`).
  const pidDelHijo = (proc as { pid?: unknown }).pid
  const inicioDeLaCarga = esCarga && typeof pidDelHijo === "number" ? inicioDe(pidDelHijo) : undefined

  const lectura = (async (): Promise<RunResult> => {
    await Promise.all([leerAcumulando(proc.stdout, salida), leerAcumulando(proc.stderr, errores)])
    const code = await proc.exited
    return { code, stdout: salida.texto, stderr: errores.texto }
  })()
  // Nunca rechaza: si gana la carrera, el resultado se arma abajo.
  const cortado = new Promise<"cortado">((resolve) => corte.addEventListener("abort", () => resolve("cortado"), { once: true }))

  const ganador = await Promise.race([lectura, cortado])
  if (ganador !== "cortado") return ganador

  if (esCarga) {
    // Que la lectura pendiente no quede como rechazo sin atender cuando los pipes se cierran.
    lectura.catch(() => {})
    const pid = (proc as { pid?: unknown }).pid
    if (typeof pid !== "number") {
      // Sin pid no hay árbol que enumerar (los dobles de los tests): se mata lo que se puede
      // y se dice que no se pudo confirmar.
      try {
        proc.kill()
      } catch {
        /* ya estaba muerto */
      }
      return { ...resultadoCorte(), procesosDeCargaTerminados: false }
    }
    // Sin carpeta privada (la carga heredada de `flash`/`both`) el corte se hace igual, pero
    // no se puede confirmar: `arbol.ts` exige el barrido por carpeta para decir "confirmado".
    const fin = await terminarArbol(pid, carpetaPrivada, marcaDeCarga, undefined, undefined, inicioDeLaCarga)
    // El hijo directo también tiene que haber terminado para el runtime (con tope: si el árbol
    // ya se confirmó muerto, esto vuelve enseguida).
    let tope: ReturnType<typeof setTimeout> | undefined
    await Promise.race([proc.exited.catch(() => {}), new Promise((listo) => (tope = setTimeout(listo, TOPE_KILL_MS)))])
    clearTimeout(tope)
    const r = resultadoCorte()
    return { ...r, stderr: `${r.stderr}\n${fin.detalle}`, procesosDeCargaTerminados: fin.confirmado }
  }

  // Por si Bun no lo mato solo (o el mock de los tests no lo hace).
  try {
    proc.kill()
  } catch {
    /* ya estaba muerto */
  }
  // Que la lectura pendiente no quede como rechazo sin atender si el pipe revienta al matarlo.
  lectura.catch(() => {})
  return resultadoCorte()
}

/**
 * Una sola senal que se dispara si CUALQUIERA de las dos se dispara. Bun trae
 * `AbortSignal.any` en las versiones nuevas; si no esta, se compone a mano.
 */
function combinarSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const lista = signals.filter((s): s is AbortSignal => s !== undefined)
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === "function") return anyFn.call(AbortSignal, lista)
  const ctrl = new AbortController()
  for (const s of lista) {
    if (s.aborted) {
      ctrl.abort(s.reason)
      break
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true })
  }
  return ctrl.signal
}

/** «3 minutos», «50 segundos»: como se le dice una espera a una persona. La usan tambien los mensajes de timeout de la tool. */
export function describirDuracion(ms: number): string {
  if (ms >= 60_000) {
    const min = Math.round(ms / 60_000)
    return `${min} minuto${min === 1 ? "" : "s"}`
  }
  return `${Math.max(1, Math.round(ms / 1000))} segundo${ms >= 1500 ? "s" : ""}`
}

/**
 * Recorta una salida larga para que llegue al modelo lo que sirve.
 *
 * POR QUE. Un `pio run` con warnings tira 3000 lineas por stderr. Todo eso iba
 * al chat, y `traducirError()` solo mira la primera linea con `error:`. El
 * modelo recibia una pared de texto para encontrar una linea.
 *
 * Que se conserva: las 15 lineas antes y despues del PRIMER `error:` (o
 * `Error`), que es donde esta el contexto del error de compilacion, y las
 * ultimas 10, que es donde PlatformIO dice como termino (`*** [upload] Error 1`,
 * `[FAILED] Took 3.21 seconds`). Lo demas se marca como omitido, con el numero,
 * para que se sepa que falta algo y cuanto.
 *
 * Es una funcion pura para poder probarla sin compilar nada. Y hay que llamar a
 * `traducirError()` con el texto COMPLETO, antes de recortar.
 */
export function recortarSalida(texto: string, maxLineas = 40): string {
  const lineas = texto.replace(/\r\n?/g, "\n").trimEnd().split("\n")
  if (lineas.length <= maxLineas) return lineas.join("\n")

  const CONTEXTO = 15
  const COLA = 10
  const n = lineas.length
  const marcar = (omitidas: number) => `… (${omitidas} línea${omitidas === 1 ? "" : "s"} omitida${omitidas === 1 ? "" : "s"})`

  const iError = lineas.findIndex((l) => /error:|Error/.test(l))
  // Rangos [desde, hasta) a conservar, en orden, sin solaparse.
  const rangos: Array<[number, number]> = []
  if (iError >= 0) rangos.push([Math.max(0, iError - CONTEXTO), Math.min(n, iError + CONTEXTO + 1)])
  else rangos.push([0, CONTEXTO])
  const cola: [number, number] = [Math.max(0, n - COLA), n]
  const ultimo = rangos[rangos.length - 1]!
  if (cola[0] <= ultimo[1]) ultimo[1] = n
  else rangos.push(cola)

  const salida: string[] = []
  let cursor = 0
  for (const [desde, hasta] of rangos) {
    if (desde > cursor) salida.push(marcar(desde - cursor))
    salida.push(...lineas.slice(desde, hasta))
    cursor = hasta
  }
  if (cursor < n) salida.push(marcar(n - cursor))
  return salida.join("\n")
}

export function traducirError(stderr: string, stdout: string): string {
  const texto = stderr + "\n" + stdout
  type Patron = [RegExp, string | ((m: RegExpMatchArray) => string)]
  const patrones: Patron[] = [
    [
      /'(.+?)' was not declared in this scope/,
      (m) =>
        `Usaste la variable o funcion '${m[1]}' pero no la declaraste antes. Revisa si esta bien escrita o si le falta declarar el tipo (ej: 'int ${m[1]}').`,
    ],
    [/expected ';' before/, "Falta un punto y coma `;` antes de esa linea. En Arduino/C++ cada instruccion termina con `;`."],
    [
      /fatal error:.*\.h: No such file or directory/,
      "No se encontro el archivo de la libreria. En `platformio.ini` agregala en `lib_deps`.",
    ],
    [
      /Please specify upload_port|Could not find serial port/,
      "No pude detectar el puerto del Arduino/ESP32. Desconectalo y volvelo a conectar, o ejecuta `/diagnostico` para ver los puertos disponibles.",
    ],
    [
      /command not found|is not recognized as an internal|exit code 127/,
      "PlatformIO no esta instalado o no esta en el PATH. Ejecuta `/diagnostico` para mas informacion.",
    ],
    [
      /Permission denied:.*\/dev\/tty/,
      "Sin permiso para usar el puerto serial. En Linux agregate al grupo del puerto (el nombre cambia segun la distro): en Debian/Ubuntu `sudo usermod -a -G dialout $USER`, en Arch/Manjaro `sudo usermod -a -G uucp $USER`. Despues cerra sesion y volve a entrar.",
    ],
    /*
     * EL PUERTO NO SE PUDO ABRIR, y LA VERIFICACION FALLO (Slice 2, gate de carga).
     *
     * Van ANTES del patron generico de avrdude a proposito: la salida de avrdude
     * siempre nombra a avrdude, asi que el generico se los comia y contestaba
     * "revisa el cable" para cualquier cosa.
     *
     * Los textos son los que de verdad imprimen las herramientas (esptool
     * `loader.py`: "Could not open <puerto>, the port is busy or doesn't exist";
     * pyserial: "could not open port ...: [Errno 16] Device or resource busy" y
     * "PermissionError(13, 'Access is denied.')"; avrdude: "ser_open(): can't open
     * device"). "Access is denied" y "Device or resource busy" se reconocen SOLO
     * pegados a la apertura del puerto: sueltos tambien los escribe un compilador que
     * no pudo pisar un archivo, y ahi decir "cerra el monitor serial" seria mentira.
     */
    [
      /the port is busy or doesn't exist|could not open port[^\n]*(?:Device or resource busy|Access is denied)|Device or resource busy: '?(?:\/dev\/(?:tty|cu)|COM\d)|can't open device/i,
      "No pude abrir el puerto de la placa: lo esta usando otro programa, o la placa ya no esta en ese puerto. " +
        "Cerra el monitor serial y cualquier otro programa que use la placa (Arduino IDE, otra ventana de Tecnia Bot), " +
        "fijate que el cable siga enchufado y proba de nuevo.",
    ],
    [
      /verification error/i,
      "La carga termino pero la VERIFICACION fallo: lo que quedo grabado en la placa no coincide con el programa. " +
        "No la des por cargada. Proba con otro cable USB (corto, de datos, sin hub) y carga de nuevo.",
    ],
    [
      /avrdude|not in sync|programmer is not responding/,
      "Problema al subir el codigo al Arduino. Verifica que el cable USB este bien conectado y que no haya otro programa usando el puerto.",
    ],
    [
      /Failed to connect to ESP32|Timed out waiting for packet header/,
      "El ESP32 no respondio. Apreta el boton BOOT mientras empieza la carga, soltalo cuando aparezca 'Connecting...'.",
    ],
    [
      /expected '}'|expected unqualified-id/,
      "Falta cerrar una llave `}` o hay un bloque mal cerrado. Revisa que cada `{` tenga su `}` correspondiente.",
    ],
    [
      /invalid conversion from|undefined reference to/,
      "Problema de tipos o funcion no definida. Verifica los tipos de tus variables y que todas las funciones esten implementadas.",
    ],

    /*
     * EL PRIMERO QUE SE CHOCA CUALQUIERA, y no estaba traducido.
     *
     * PlatformIO no compila un archivo suelto: quiere una carpeta con
     * `platformio.ini` y el codigo en `src/main.cpp`. Si el docente abrio
     * OpenCode en su escritorio y pidio codigo, `pio run` corta con este error
     * en ingles y nadie le explica que falta armar el proyecto.
     */
    [
      /Not a PlatformIO project|NotPlatformIOProjectError|platformio\.ini.*has not been found/i,
      "**Todavia no hay un proyecto de PlatformIO en esta carpeta.** PlatformIO no compila un " +
        "archivo suelto: necesita un `platformio.ini` que diga que placa es, y el codigo en " +
        "`src/main.cpp`. Se arman los dos y se compila de nuevo — el `platformio.ini` cambia " +
        "segun la placa (`board = uno` para Arduino UNO, `board = esp32dev` para ESP32).",
    ],
    /*
     * LOS TRES DEL ESP32 QUE NO SON ERRORES DE COMPILACION.
     *
     * Salen por el monitor serial DESPUES de cargar, cuando el programa ya
     * corre, y son los que un docente pega en el chat sin saber que significan.
     * Ninguno de los tres estaba reconocido: el bot recibia el texto crudo y
     * tenia que improvisar.
     *
     * El del brownout es el mas importante de todos: es lo que escupe la placa
     * la primera vez que alguien le conecta un servo, o sea la semana dos o tres
     * de cualquier curso.
     */
    [
      /Brownout detector was triggered/,
      "**Le falta corriente a la placa.** El ESP32 se apaga solo cuando la tension le baja, " +
        "y eso pasa casi siempre al conectar un servo, un motor o un rele: el USB no da abasto. " +
        "No es un problema del codigo. Solucion: fuente externa de 5V para el componente que " +
        "consume, con el GND unido al de la placa. Si es un servo, calcula con el consumo de " +
        "BLOQUEO (unos 700 mA en un SG90), no con el de movimiento libre.",
    ],
    [
      /rst:0x[0-9a-f]+.*boot:0x/i,
      "**La placa se esta reiniciando en bucle.** Ese `rst:0x...` es el motivo del reinicio que " +
        "imprime el ESP32 al arrancar. Las dos causas mas comunes en el aula: (1) le falta " +
        "corriente — ver si tambien aparece 'Brownout'; (2) hay algo conectado a un pin de " +
        "arranque (GPIO0, GPIO2, GPIO12 o GPIO15) que lo deja en el nivel equivocado al " +
        "encender. Probá desconectando todo del circuito y encendiendo la placa sola: si asi " +
        "arranca bien, es el cableado y no el programa.",
    ],
    [
      /Guru Meditation Error/,
      "**El programa se cayo mientras corria** (no es un error de compilacion). Las causas " +
        "tipicas: usar un puntero o un objeto que todavia no se inicializo, leer de una " +
        "libreria que fallo en `begin()` sin chequear el resultado, o escribir fuera de un " +
        "arreglo. Miralo asi: el mensaje aparece DESPUES de que el programa arranco, " +
        "asi que fijate que hizo justo antes de caerse — un `Serial.print` antes de cada paso " +
        "te dice hasta donde llego.",
    ],
  ]

  for (const [patron, mensaje] of patrones) {
    const match = texto.match(patron)
    if (match) return typeof mensaje === "function" ? mensaje(match) : mensaje
  }

  const primeraLinea = texto.split("\n").find((l) => l.includes("error:")) ?? stderr.split("\n")[0] ?? ""
  return `Error de compilacion: ${primeraLinea}\n\nConsulta el skill 'errores-comunes' para mas ayuda.`
}
