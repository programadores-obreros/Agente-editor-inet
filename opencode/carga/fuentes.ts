// `carga/fuentes.ts` — ¿el analizador de pines miró TODO lo que PlatformIO va a compilar?
// (hallazgo SEC-02 de la auditoría; código canónico `ANALISIS_INCOMPLETO`, CONTRATOS-API §13).
//
// EL HUECO. El bloqueo de GPIO6–11 y el cartel del checklist salen de leer el código del
// proyecto. Pero el analizador (`tool/platformio.ts::leerFuentes`) y PlatformIO no tienen
// la misma idea de "qué se compila":
//   - el analizador no entra a carpetas llamadas `test`, `tests`, `docs`, `doc`,
//     `examples`, `example`, `extras`, ni a ninguna que empiece con punto, TAMPOCO dentro
//     de `src/`; PlatformIO compila todo `src/` (`SRC_FILTER_DEFAULT = +<*>`, y adentro de
//     cada carpeta recorre con `os.walk`, que sí entra a las que empiezan con punto:
//     `platformio/fs.py:156-175`);
//   - el analizador no lee `.c++`, `.S`, `.s`, `.sx`, `.spp`, `.asm`; PlatformIO los compila
//     (`builder/tools/piobuild.py:31-35`);
//   - un `#include "datos.inc"` mete en el firmware un archivo con cualquier extensión;
//   - y si el análisis da `null` (sin ini, sin fuentes), hoy se carga sin cartel ni bloqueo.
// Resultado, reproducido sin hardware: un `pinMode(6, OUTPUT)` en `src/test/malo.cpp` se
// carga, y el cartel que aprueba el docente no lo nombra.
//
// LA REGLA. Esta función NO intenta adivinar qué ignora el analizador: recibe la lista de
// archivos que el analizador LEYÓ de verdad y la compara contra lo que hay en disco.
//   1. Sin análisis (`null`) o con análisis incompleto → `ANALISIS_INCOMPLETO`.
//   2. Todo archivo compilable (por extensión, como la define PlatformIO) que esté en
//      `src/`, `include/` o `lib/` —en CUALQUIER subcarpeta, oculta o no— tiene que estar
//      en la lista de leídos. Se mira un SUPERCONJUNTO de lo que PlatformIO compila (no se
//      modela el filtro): sobra antes que falte.
//   3. Los archivos de ensamblador no se pueden analizar: si hay uno, incompleto.
//   4. Todo `#include` de un archivo que existe en esas carpetas y que el analizador no
//      leyó → incompleto. Un `#include` que no nombra un archivo entre `"…"` o `<…>` (armado
//      con una macro) → incompleto.
//   5. Un enlace simbólico, algo que no es ni archivo ni carpeta, una carpeta ilegible o
//      demasiado profunda → incompleto. No se siguen enlaces.
//   6. Un ini que mueve las fuentes (`src_dir`, `lib_dir`, `include_dir`,
//      `build_src_filter`, `src_filter`, `lib_extra_dirs`, `test_build_src`) o que no se
//      puede leer → incompleto.
//
// LO QUE NO CUBRE (dicho, no escondido): el código de las librerías BAJADAS
// (`.pio/libdeps/`) y el del framework. El analizador nunca los leyó; una librería bajada
// puede manejar un pin que el cartel no nombra. Eso no lo arregla esta función.
//
// ESTADO: lista y probada, sin integrar. `tool/platformio.ts` todavía no la llama ni
// expone la lista de archivos leídos; eso es de la Etapa 4.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parsearIni } from "./ini.ts"

export type CoberturaDeFuentes =
  | { ok: true; compilables: string[] }
  | { ok: false; codigo: "ANALISIS_INCOMPLETO"; motivos: string[] }

/**
 * Lo que PlatformIO compila, por extensión (`piobuild.py:31-35`). Allá la comparación
 * distingue mayúsculas; acá NO (`main.CPP` cuenta): se mira de más antes que de menos.
 */
const EXT_C = new Set(["c", "cc", "cpp", "cxx", "c++"])
const EXT_ASM = new Set(["s", "spp", "sx", "asm"])
/** Los `.ino`/`.pde` PlatformIO los convierte a `.cpp` y los compila. */
const EXT_SKETCH = new Set(["ino", "pde"])

const RAICES = ["src", "include", "lib"] as const
const MAX_PROFUNDIDAD = 16
const MAX_ARCHIVOS = 20_000
const MAX_TEXTO = 2 * 1024 * 1024
/** Opciones del ini que cambian qué fuentes entran al firmware respecto de `src/`, `include/` y `lib/`. */
const MUEVEN_LAS_FUENTES = new Set(["src_dir", "lib_dir", "include_dir", "build_src_filter", "src_filter", "lib_extra_dirs", "test_build_src", "test_dir"])

const extension = (nombre: string) => (nombre.includes(".") ? nombre.slice(nombre.lastIndexOf(".") + 1) : "")
const normal = (ruta: string) => ruta.replace(/\\/g, "/").replace(/^\.\//, "")

/**
 * Los archivos que nombra cada `#include` de un texto; `null` en el lugar de uno que no
 * nombra un archivo entre `"…"` o `<…>`.
 *
 * Mira DE MÁS a propósito: toma cualquier `#include` aunque no esté al principio de la
 * línea (en C, un comentario y después `#include "x"` en la misma línea es una directiva válida) y aunque esté dentro de un
 * comentario o de un texto. Un include de más sólo puede dar "incompleto"; uno de menos
 * deja pasar código sin analizar. Antes de mirar pega las líneas que terminan en `\`, y
 * `%:` vale por `#`. No entiende trigrafos (`??=`): el compilador de las placas del
 * producto no los activa por defecto, y los flags que los activarían no se admiten.
 */
export function includesDe(texto: string): Array<string | null> {
  const unido = texto.replace(/\\\r?\n/g, "")
  const salida: Array<string | null> = []
  for (const m of unido.matchAll(/(?:#|%:)(?:[ \t]|\/\*[\s\S]*?\*\/)*(?:include_next|include|import)\b([^\r\n]*)/g)) {
    const resto = m[1]!.trim()
    const nombre = resto.match(/^"([^"]+)"/) ?? resto.match(/^<([^>]+)>/)
    salida.push(nombre ? nombre[1]! : null)
  }
  return salida
}

/**
 * Dice si el conjunto de fuentes que PlatformIO compilaría es el que el analizador miró.
 *
 * `analizados`: los archivos que el analizador LEYÓ, relativos a `cwd` (como los nombra
 * `leerFuentes`: `src/main.cpp`). `null` = no hubo análisis.
 * `incompleto`: lo que el propio analizador declaró que no pudo leer.
 * `iniText`: el texto del `platformio.ini`.
 *
 * `cwd` tiene que venir canónico.
 */
export function coberturaDeFuentes(o: { cwd: string; iniText: string; analizados: readonly string[] | null; incompleto?: readonly string[] }): CoberturaDeFuentes {
  const motivos: string[] = []
  const falta = (m: string) => void (motivos.length < 40 && !motivos.includes(m) && motivos.push(m))

  if (o.analizados === null) falta("no hay análisis del código (sin platformio.ini o sin fuentes que leer)")
  for (const x of o.incompleto ?? []) falta(`el analizador no pudo leer: ${x}`)

  const ini = parsearIni(o.iniText)
  if (!ini.ok) falta("el platformio.ini no se pudo leer con certeza")
  else {
    for (const [seccion, opciones] of ini.ini.secciones) for (const clave of opciones.keys()) if (MUEVEN_LAS_FUENTES.has(clave)) falta(`[${seccion}] ${clave} cambia qué fuentes se compilan`)
  }

  const leidos = new Set((o.analizados ?? []).map(normal))
  /** Todos los archivos comunes que hay en las raíces, por ruta relativa. */
  const enDisco = new Set<string>()
  const porNombre = new Map<string, string[]>()
  let presupuesto = MAX_ARCHIVOS
  const recorrer = (rel: string, prof: number) => {
    if (prof > MAX_PROFUNDIDAD) return falta(`${rel} tiene más niveles de carpetas de los que se revisan`)
    let nombres: string[]
    try {
      nombres = readdirSync(join(o.cwd, rel)).sort()
    } catch {
      return falta(`no se pudo leer la carpeta ${rel}`)
    }
    for (const nombre of nombres) {
      if (--presupuesto < 0) return falta("hay más archivos de los que se revisan")
      const hijo = `${rel}/${nombre}`
      let st: ReturnType<typeof lstatSync>
      try {
        st = lstatSync(join(o.cwd, hijo))
      } catch {
        falta(`no se pudo mirar ${hijo}`)
        continue
      }
      if (st.isSymbolicLink()) falta(`${hijo} es un enlace simbólico (PlatformIO lo sigue; el análisis no)`)
      else if (st.isDirectory()) recorrer(hijo, prof + 1)
      else if (!st.isFile()) falta(`${hijo} no es ni archivo ni carpeta`)
      else {
        enDisco.add(hijo)
        porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), hijo])
      }
    }
  }
  for (const raiz of RAICES) {
    let st: ReturnType<typeof lstatSync> | null = null
    try {
      st = lstatSync(join(o.cwd, raiz))
    } catch {
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      falta(`${raiz}/ no es una carpeta común`)
      continue
    }
    recorrer(raiz, 0)
  }

  const compilables: string[] = []
  for (const rel of enDisco) {
    const ext = extension(rel).toLowerCase()
    if (EXT_ASM.has(ext)) falta(`${rel} es ensamblador: se compila y el análisis de pines no lo puede leer`)
    else if (EXT_C.has(ext) || EXT_SKETCH.has(ext)) {
      compilables.push(rel)
      if (!leidos.has(rel)) falta(`${rel} se compila y el analizador no lo leyó`)
    }
  }
  // Los leídos tienen que existir: una lista que nombra archivos que no están no describe este proyecto.
  for (const rel of leidos) if (!enDisco.has(rel)) falta(`el analizador dice haber leído ${rel}, que no está entre las fuentes del proyecto`)

  // Lo que se incluye: desde todo lo compilable y desde todo lo que el analizador leyó.
  for (const rel of new Set([...compilables, ...[...leidos].filter((r) => enDisco.has(r))])) {
    let texto: string
    try {
      const b = readFileSync(join(o.cwd, rel))
      if (b.length > MAX_TEXTO) {
        falta(`${rel} es demasiado grande para revisar sus #include`)
        continue
      }
      if (b.includes(0)) {
        falta(`${rel} no es texto plano (tiene bytes nulos): no se pueden revisar sus #include`)
        continue
      }
      texto = b.toString("latin1")
    } catch {
      falta(`no se pudo leer ${rel}`)
      continue
    }
    for (const incluido of includesDe(texto)) {
      if (incluido === null) {
        falta(`${rel} tiene un #include que no nombra un archivo (armado con una macro)`)
        continue
      }
      const base = normal(incluido).split("/").pop() ?? ""
      for (const candidato of porNombre.get(base) ?? []) if (!leidos.has(candidato)) falta(`${rel} incluye ${incluido}; ${candidato} existe y el analizador no lo leyó`)
    }
  }

  return motivos.length > 0 ? { ok: false, codigo: "ANALISIS_INCOMPLETO", motivos } : { ok: true, compilables: compilables.sort() }
}
