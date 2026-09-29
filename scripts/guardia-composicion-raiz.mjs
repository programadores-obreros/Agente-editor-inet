#!/usr/bin/env node
// Guardia estructural de E3-04b (Phase 2, Slice 1) — ver
// docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md §2.2 y el mecanismo que
// ARCH-A propuso en su informe (§5): el `Almacen` (`opencode/nucleo/almacen.ts`) es
// un puerto INTERNO de la raíz de composición (`opencode/nucleo/composicion-raiz.ts`,
// ÚNICO módulo de producción autorizado a construirlo) — nada más en el repo debe
// importar `almacen.ts` ni referenciar `crearAlmacen` directo. TypeScript no lo
// impide (es un contrato de USO, no de tipos — `motor.ts`/`almacen.ts` ya lo
// documentan); este script lo hace VERIFICABLE, sin agregar un linter de boundaries
// ni ESLint nuevo (`package.json` no tiene "lint": sólo `tsc --noEmit`) — mismo
// estilo/criterio que `scripts/seguridad-proyectos.mjs` (fs + regex en JS puro, sin
// `rg`/`grep` como dependencia externa).
//
// Uso:
//   node scripts/guardia-composicion-raiz.mjs               # escanea el repo real
//   node scripts/guardia-composicion-raiz.mjs --raiz <dir>   # escanea OTRA raíz
//
// El segundo modo es lo que usan los tests (tests/phase2-composicion-raiz.test.mjs)
// para probar, con un archivo trampa descartable dentro de un directorio temporal,
// que este guardia SÍ puede fallar — nunca apuntando al repo real.
//
// LIMITACIÓN CONOCIDA, documentada, NO cerrada (Hallazgo H4, MAJOR según el auditor,
// P2-RED-A/INFORME.md, ataque 5 — decisión del orquestador: se documenta la
// limitación, no se "arregla" con más regex): esta guardia es una heurística LÉXICA
// sobre texto, no un parser real de JS/TS. `import()` DINÁMICO (nunca matchea
// `from`/`require(`) combinado con acceso a la propiedad por CONCATENACIÓN DE
// STRINGS (`modulo["crear" + "Almacen"]`, que nunca hace aparecer la palabra
// `crearAlmacen` contigua en el texto) evade AMBOS patrones sin que el bypass deje
// de funcionar en runtime — verificado ejecutablemente por el red team (obtiene
// `crearAlmacen` como función invocable, sin que esta guardia lo detecte). Esta
// guardia protege contra ACCIDENTES (un import directo, la forma natural de
// escribir el código), NO contra ofuscación DELIBERADA de alguien que ya sepa que
// existe y quiera evadirla a propósito — ese es un problema de otra clase (análisis
// estático real, AST, o confianza en el proceso de revisión humano), fuera del
// alcance de "fs + regex en JS puro" que este script elige a propósito (ver arriba,
// "sin agregar un linter de boundaries ni ESLint nuevo"). Cerrar esto de verdad
// requeriría un parser real (ej. la propia API de TypeScript/`tsgo`) para detectar
// `import()` dinámico + acceso computado — evaluado y diferido, no resuelto en esta
// ronda de fixes (`docs/programacion-intencion/DECISIONS.md`).

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_POR_DEFECTO = join(SCRIPT_DIR, "..")

/** Subdirectorios de producción a escanear, relativos a la raíz. */
export const SUBDIRECTORIOS_POR_DEFECTO = ["opencode", "scripts"]

/** Extensiones consideradas código de producción. */
const EXTENSIONES = new Set([".ts", ".js", ".mjs"])

/** Nunca se escanea DENTRO de estos nombres de directorio. */
const DIRECTORIOS_EXCLUIDOS = new Set(["node_modules", ".git"])

/**
 * Un archivo cuya ruta (relativa a la raíz, separadores normalizados a "/") matchea
 * alguno de estos patrones queda exento — son fixtures de test que legítimamente
 * construyen un `Almacen` de prueba en aislamiento (mismo criterio que el informe
 * ARCH-A §5 y ARCH-D tema 1, test 1B: "tests/** son fixtures, no producción").
 */
const PATRONES_EXENTOS = [/(^|\/)tests\//, /\.test\.(ts|js|mjs)$/]

/** Los DOS únicos archivos de producción autorizados a importar `almacen.ts`/
 * referenciar `crearAlmacen` — rutas relativas a la raíz, separador "/". */
export const ARCHIVOS_AUTORIZADOS_POR_DEFECTO = ["opencode/nucleo/almacen.ts", "opencode/nucleo/composicion-raiz.ts"]

const PATRON_IMPORT_ALMACEN = /(?:from|require\()\s*["'][^"']*\/almacen(?:\.ts|\.js)?["']/
const PATRON_CREAR_ALMACEN = /\bcrearAlmacen\b/

/**
 * Este mismo archivo, escaneado sobre sí mismo: contiene el PATRÓN de búsqueda como
 * dato (el propio `PATRON_CREAR_ALMACEN`, y esta misma explicación en prosa) — nunca
 * un import de `almacen.ts` ni un llamado real a `crearAlmacen`. Exención explícita y
 * documentada (no una exención silenciosa): si algún día este archivo SÍ importara
 * `almacen.ts`/llamara `crearAlmacen` de verdad, sería un bug de este guardia, no algo
 * que la exención deba ocultar — por eso la exención es por RUTA exacta, no por
 * "cualquier archivo bajo scripts/guardia*".
 */
const RUTA_PROPIA = "scripts/guardia-composicion-raiz.mjs"

/**
 * Heurística léxica (no un parser real de JS/TS): quita bloques `/* ... *\/` y
 * comentarios de línea `//` hasta fin de línea, ANTES de aplicar los patrones de
 * arriba — así una mención en PROSA dentro de un comentario (ej. el JSDoc de
 * `motor.ts` que described el uso NO CONTRACTUAL de `crearAlmacen()` como ejemplo de
 * lo que NO hay que hacer) no cuenta como una referencia real. Límite conocido,
 * documentado (mismo criterio que el escaneo léxico de assets offline, informe
 * ARCH-D tema 9): puede sobre-quitar contenido si un string/regex literal contiene
 * literalmente `//` o `/*` — aceptable para un guardia barato de regresión, nunca
 * una prueba exhaustiva de un parser real.
 */
function quitarComentarios(codigo) {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

function listarArchivos(raizAbsoluta, subdirectorios) {
  const archivos = []
  function recorrer(dirAbsoluto) {
    let entradas
    try {
      entradas = readdirSync(dirAbsoluto, { withFileTypes: true })
    } catch {
      return // el subdirectorio declarado no existe en esta raíz (ej. "scripts" en
      // una raíz de test de un solo archivo trampa) — no es un error del guardia.
    }
    for (const entrada of entradas) {
      if (DIRECTORIOS_EXCLUIDOS.has(entrada.name)) continue
      const rutaAbsoluta = join(dirAbsoluto, entrada.name)
      if (entrada.isDirectory()) {
        recorrer(rutaAbsoluta)
        continue
      }
      if (!entrada.isFile()) continue
      const punto = entrada.name.lastIndexOf(".")
      const extension = punto === -1 ? "" : entrada.name.slice(punto)
      if (!EXTENSIONES.has(extension)) continue
      archivos.push(rutaAbsoluta)
    }
  }
  for (const sub of subdirectorios) recorrer(join(raizAbsoluta, sub))
  return archivos
}

function esRutaExenta(rutaRelativaNormalizada) {
  return PATRONES_EXENTOS.some((patron) => patron.test(rutaRelativaNormalizada))
}

/**
 * Escanea `raiz` (por defecto, el repo real) y devuelve las violaciones: archivos de
 * producción, fuera de `archivosAutorizados` y de `tests/**`, que importan
 * `almacen.ts` o referencian `crearAlmacen`.
 */
export function verificar(opciones = {}) {
  const raizAbsoluta = resolve(opciones.raiz ?? REPO_POR_DEFECTO)
  const subdirectorios = opciones.subdirectorios ?? SUBDIRECTORIOS_POR_DEFECTO
  const autorizados = new Set(opciones.archivosAutorizados ?? ARCHIVOS_AUTORIZADOS_POR_DEFECTO)

  const violaciones = []
  for (const rutaAbsoluta of listarArchivos(raizAbsoluta, subdirectorios)) {
    const rutaRelativa = relative(raizAbsoluta, rutaAbsoluta).split(sep).join("/")
    if (autorizados.has(rutaRelativa)) continue
    if (esRutaExenta(rutaRelativa)) continue
    if (rutaRelativa === RUTA_PROPIA) continue
    const contenidoCrudo = readFileSync(rutaAbsoluta, "utf8")
    const contenido = quitarComentarios(contenidoCrudo)
    const motivos = []
    if (PATRON_IMPORT_ALMACEN.test(contenido)) motivos.push("importa almacen.ts")
    if (PATRON_CREAR_ALMACEN.test(contenido)) motivos.push("referencia crearAlmacen")
    if (motivos.length > 0) violaciones.push({ archivo: rutaRelativa, motivos })
  }
  return { violaciones }
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  const indiceRaiz = process.argv.indexOf("--raiz")
  const raiz = indiceRaiz !== -1 ? process.argv[indiceRaiz + 1] : undefined
  const { violaciones } = verificar(raiz ? { raiz } : {})
  if (violaciones.length > 0) {
    console.error(`${violaciones.length} violacion(es) de E3-04b:`)
    for (const v of violaciones) console.error(`  - ${v.archivo}: ${v.motivos.join(", ")}`)
    process.exit(1)
  }
  console.log("OK: ningun archivo de produccion fuera de nucleo/almacen.ts y nucleo/composicion-raiz.ts importa almacen.ts ni referencia crearAlmacen.")
}
