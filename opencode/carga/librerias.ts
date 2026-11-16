// `carga/librerias.ts` — la auditoría de las librerías del proyecto (decisión ND-2 del owner).
//
// POR QUÉ EXISTE. Un `platformio.ini` impecable no alcanza: una librería trae su propio
// manifiesto y PlatformIO lo obedece al compilar. Medido (H-03) y leído en PlatformIO Core
// 6.1.19, `builder/tools/piolib.py`:
//   - `library.json` → `build.extraScript`: un script de Python que se ejecuta (`:299-305`,
//     `:852-855`).
//   - `library.json` → `build.flags` y `build.unflags`: van al MISMO analizador de flags que
//     ejecuta lo que empieza con `!` (`:298`, `:306`, `:840-849`).
//   - `library.json` → `build.builder`: elige por nombre la clase que construye la librería
//     (`:64-69`).
//   - `library.json` → `build.srcDir` / `build.includeDir`: rutas que pueden salir de la
//     librería (`:795-826`).
//   - `library.json` → `scripts`: comandos que el gestor de paquetes corre al instalar o
//     desinstalar (`package/manager/base.py:319-328`).
//   - `library.properties` → `ldflags` y `precompiled`: terminan como flags (`:620-637`).
//   - `module.json` (mbed): arma macros e includes desde el manifiesto (`:640-760`).
//
// LA POLÍTICA (ND-2):
//   - `lib/*/` del proyecto (lo escribe el alumno o el modelo): se rechaza todo lo de la
//     lista de arriba. No hay excepción.
//   - `.pio/libdeps/<env>/*/` (lo bajó `lib_deps`, transitivas incluidas): lo mismo, salvo
//     que un `build.extraScript` figure en `LIBRERIAS_CON_SCRIPT_ADMITIDAS` con su nombre,
//     su versión y el sha256 del script. Esa lista NACE VACÍA: que una librería venga del
//     registro no la hace confiable, y no se habilita ninguna sola.
//   - PRIMERA COMPILACIÓN. Si el ini declara un `lib_deps` que todavía no está bajado,
//     `pio run` lo bajaría y ejecutaría su script en la misma corrida, sin dar lugar a
//     auditar nada. No hay una separación descarga/compilación VERIFICADA, así que se falla
//     cerrado: lo declarado tiene que estar ya en `.pio/libdeps/<env>/`, y lo que cada
//     librería declara como dependencia también. Si falta algo: `LIBRERIA_NO_ADMITIDA`.
//
// LO QUE ESTO DEJA AFUERA (es el costo de fallar cerrado, y está dicho en el informe):
// todo proyecto con `lib_deps` que nunca se compiló —o sea, la primera compilación de
// cualquier proyecto con una librería bajada— no pasa esta auditoría.
//
// LO QUE NO SE EJECUTA. Acá no se corre código de ninguna librería ni se lanza `pio` para
// "ver qué hace": se leen manifiestos.
//
// ENLACES. PlatformIO sigue los enlaces simbólicos al recorrer una librería
// (`os.walk(..., followlinks=True)`). Acá no se siguen: un enlace adentro de `lib/` o de
// `.pio/libdeps/` es un rechazo.
//
// Este módulo importa sólo `node:` y módulos de `carga/`.

import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { auditarIni, leerFlags, LIB_DEP } from "./ini.ts"

export interface ScriptAdmitido {
  /** Nombre de la librería, como figura en su `.piopm`. */
  nombre: string
  /** Versión exacta instalada. */
  version: string
  /** sha256 (hex) del archivo que nombra `build.extraScript`. */
  sha256: string
}

/**
 * Las librerías bajadas cuyo `build.extraScript` se admite. NACE VACÍA (ND-2). Para sumar
 * una entrada hace falta una decisión del owner: nombre, versión y hash del script.
 */
export const LIBRERIAS_CON_SCRIPT_ADMITIDAS: readonly ScriptAdmitido[] = Object.freeze([])

export type MotivoLibreria =
  | "INI_NO_ADMITIDO"
  | "ENVIRONMENT_INVALIDO"
  | "ENLACE_SIMBOLICO"
  | "ENTRADA_NO_ADMITIDA"
  | "CARPETA_ILEGIBLE"
  | "DEMASIADO_GRANDE"
  | "MANIFIESTO_NO_ENTENDIDO"
  | "SCRIPT_DE_COMPILACION"
  | "FLAGS_NO_ADMITIDOS"
  | "CLAVE_NO_ADMITIDA"
  | "RUTA_FUERA_DE_LA_LIBRERIA"
  | "LIB_DEPS_SIN_DESCARGAR"
  | "DEPENDENCIA_SIN_DESCARGAR"
  | "VERSION_NO_VERIFICABLE"

export interface RechazoLibreria {
  donde: "lib" | "libdeps" | "proyecto"
  libreria: string
  motivo: MotivoLibreria
  detalle: string
}

export interface LibreriaVista {
  donde: "lib" | "libdeps"
  /** Nombre de la carpeta. */
  carpeta: string
  nombre: string
  version: string | null
  /** `dueño` del registro si la librería trae `.piopm`; si no, `null` (origen desconocido). */
  dueno: string | null
}

export type ResultadoLibrerias =
  | { ok: true; librerias: LibreriaVista[] }
  | { ok: false; codigo: "LIBRERIA_NO_ADMITIDA"; rechazos: RechazoLibreria[] }

const MAX_ENTRADAS = 20_000
const MAX_PROFUNDIDAD = 16
const MAX_MANIFIESTO = 512 * 1024
const ENTORNO = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/
/** Las claves de `build` de un `library.json` que no ejecutan ni inyectan nada. */
const BUILD_INOCUAS = new Set(["libArchive", "libLDFMode", "libCompatMode", "srcFilter"])

type Stat = ReturnType<typeof lstatSync>
const mirar = (ruta: string): Stat | null => {
  try {
    return lstatSync(ruta)
  } catch {
    return null
  }
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

/** Una ruta relativa que se queda adentro: sin `..`, sin raíz, sin unidad de Windows. */
const rutaInterna = (x: unknown): x is string => typeof x === "string" && x !== "" && !/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)|[\u0000-\u001f]/.test(x)

interface Dependencia {
  nombre: string
  dueno: string | null
  requisito: string | null
}

interface Manifiestos {
  nombre: string | null
  version: string | null
  dependencias: Dependencia[]
}

/** `1.2.3` → [1,2,3]; con otra forma, `null`. */
function partesDeVersion(v: string): [number, number, number] | null {
  const m = v.match(/^(\d{1,5})(?:\.(\d{1,5}))?(?:\.(\d{1,5}))?$/)
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null
}

/**
 * Si una versión instalada cumple un requisito. Sólo entiende `*`, `1.2.3` (exacta),
 * `^1.2.3`, `~1.2.3` y `>=1.2.3`. `null` = no lo sabe decir (y quien llama rechaza): no
 * se adivina, porque si PlatformIO decide que NO cumple, baja otra versión y la ejecuta.
 */
export function cumpleVersion(instalada: string, requisito: string): boolean | null {
  const req = requisito.trim()
  if (req === "" || req === "*") return true
  const v = partesDeVersion(instalada)
  const m = req.match(/^(\^|~|>=|=)?\s?(\d{1,5}(?:\.\d{1,5}){0,2})$/)
  const r = m ? partesDeVersion(m[2]!) : null
  if (!v || !m || !r) return null
  const cmp = v[0] - r[0] || v[1] - r[1] || v[2] - r[2]
  const op = m[1] ?? "="
  if (op === "=") return cmp === 0
  if (op === ">=") return cmp >= 0
  if (op === "~") return cmp >= 0 && v[0] === r[0] && v[1] === r[1]
  // `^`: no cambia el primer número distinto de cero.
  if (r[0] > 0) return cmp >= 0 && v[0] === r[0]
  if (r[1] > 0) return cmp >= 0 && v[0] === 0 && v[1] === r[1]
  return cmp === 0
}

/**
 * Audita las librerías de `cwd` para el environment `environment`. Precondición de todo
 * `pio run` sobre una carpeta de usuario, junto con `auditarIni` (ND-2: "la auditoría de
 * librerías es parte de la misma precondición").
 *
 * `cwd` tiene que venir canónico. Lee el `platformio.ini` por su cuenta (con `auditarIni`)
 * para saber qué `lib_deps` declara ese environment: no se le cree a quien llama.
 */
export function auditarLibrerias(cwd: string, environment: string): ResultadoLibrerias {
  return auditarLibreriasCon(cwd, environment, LIBRERIAS_CON_SCRIPT_ADMITIDAS)
}

/**
 * Lo mismo, con la lista de scripts admitidos por parámetro. Existe para poder probar el
 * mecanismo de la lista sin tocar la del producto: el producto llama a `auditarLibrerias`.
 */
export function auditarLibreriasCon(cwd: string, environment: string, admitidos: readonly ScriptAdmitido[]): ResultadoLibrerias {
  const rechazos: RechazoLibreria[] = []
  const rechazar = (donde: RechazoLibreria["donde"], libreria: string, motivo: MotivoLibreria, detalle: string) => void rechazos.push({ donde, libreria, motivo, detalle })
  const fallo = (): ResultadoLibrerias => ({ ok: false, codigo: "LIBRERIA_NO_ADMITIDA", rechazos })

  if (typeof environment !== "string" || !ENTORNO.test(environment)) {
    rechazar("proyecto", "", "ENVIRONMENT_INVALIDO", "el environment no tiene forma de nombre de environment")
    return fallo()
  }
  const ini = auditarIni(cwd, "compilacion")
  if (!ini.ok) {
    rechazar("proyecto", "platformio.ini", "INI_NO_ADMITIDO", `no se puede saber qué librerías declara el proyecto: ${ini.claves.join(", ")}`)
    return fallo()
  }
  if (!ini.environments.includes(environment)) {
    rechazar("proyecto", "platformio.ini", "ENVIRONMENT_INVALIDO", `el ini no tiene [env:${environment}]`)
    return fallo()
  }
  const declaradas = ini.libDeps[environment] ?? []

  let presupuesto = MAX_ENTRADAS
  /** Recorre una librería sin seguir enlaces. Devuelve `false` si encontró algo que no admite. */
  const recorrer = (donde: "lib" | "libdeps", libreria: string, dir: string, prof: number): boolean => {
    if (prof > MAX_PROFUNDIDAD) return rechazar(donde, libreria, "DEMASIADO_GRANDE", "tiene más niveles de carpetas de los que se revisan"), false
    let nombres: string[]
    try {
      nombres = readdirSync(dir)
    } catch {
      return rechazar(donde, libreria, "CARPETA_ILEGIBLE", "no se pudo leer una de sus carpetas"), false
    }
    for (const nombre of nombres) {
      if (--presupuesto < 0) return rechazar(donde, libreria, "DEMASIADO_GRANDE", "hay más archivos de los que se revisan"), false
      const st = mirar(join(dir, nombre))
      if (!st) return rechazar(donde, libreria, "CARPETA_ILEGIBLE", `no se pudo mirar ${nombre}`), false
      if (st.isSymbolicLink()) return rechazar(donde, libreria, "ENLACE_SIMBOLICO", `${nombre} es un enlace simbólico`), false
      if (st.isDirectory()) {
        if (!recorrer(donde, libreria, join(dir, nombre), prof + 1)) return false
      } else if (!st.isFile()) return rechazar(donde, libreria, "ENTRADA_NO_ADMITIDA", `${nombre} no es ni archivo ni carpeta`), false
    }
    return true
  }

  /** Lee un manifiesto de la raíz de la librería. `undefined` = no está; `null` = está y no se pudo leer. */
  const leer = (dir: string, archivo: string): string | null | undefined => {
    const st = mirar(join(dir, archivo))
    if (!st) return undefined
    if (!st.isFile() || st.size > MAX_MANIFIESTO) return null
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(dir, archivo)))
    } catch {
      return null
    }
  }

  const revisarManifiestos = (donde: "lib" | "libdeps", carpeta: string, dir: string, instalada: { nombre: string | null; version: string | null }): Manifiestos | null => {
    const m: Manifiestos = { nombre: null, version: null, dependencias: [] }
    let bien = true
    const mal = (motivo: MotivoLibreria, detalle: string) => {
      rechazar(donde, carpeta, motivo, detalle)
      bien = false
    }

    if (leer(dir, "module.json") !== undefined) mal("CLAVE_NO_ADMITIDA", "trae `module.json` (mbed): arma macros e includes desde el manifiesto y no se audita")

    const json = leer(dir, "library.json")
    if (json === null) mal("MANIFIESTO_NO_ENTENDIDO", "`library.json` no es un archivo de texto legible")
    else if (json !== undefined) {
      let datos: unknown
      try {
        datos = JSON.parse(json)
      } catch {
        datos = undefined
      }
      if (!esObjeto(datos)) mal("MANIFIESTO_NO_ENTENDIDO", "`library.json` no es un objeto JSON")
      else {
        if (typeof datos.name === "string") m.nombre = datos.name
        if (typeof datos.version === "string") m.version = datos.version
        if ("scripts" in datos) mal("SCRIPT_DE_COMPILACION", "`scripts` en `library.json`: comandos que PlatformIO corre al instalar o desinstalar")
        if ("build" in datos) {
          const build = datos.build
          if (!esObjeto(build)) mal("MANIFIESTO_NO_ENTENDIDO", "`build` de `library.json` no es un objeto")
          else {
            for (const [clave, valor] of Object.entries(build)) {
              if (BUILD_INOCUAS.has(clave)) continue
              if (clave === "extraScript") {
                const script = rutaInterna(valor) ? leerBytes(join(dir, valor)) : null
                const sha = script ? createHash("sha256").update(script).digest("hex") : null
                // La identidad sale de `.piopm` (lo que anotó el gestor al bajarla), no de lo que la librería dice de sí misma.
                const admitido = donde === "libdeps" && sha !== null && instalada.nombre !== null && instalada.version !== null && admitidos.some((a) => a.nombre === instalada.nombre && a.version === instalada.version && a.sha256 === sha)
                if (!admitido) mal("SCRIPT_DE_COMPILACION", `\`build.extraScript\` (${JSON.stringify(String(valor).slice(0, 60))}): Python que se ejecuta al compilar${donde === "libdeps" ? "; no figura en la lista de scripts admitidos" : ""}`)
              } else if (clave === "flags" || clave === "unflags") {
                const lineas = typeof valor === "string" ? [valor] : Array.isArray(valor) && valor.every((x): x is string => typeof x === "string") ? valor : null
                const r = lineas ? leerFlags(lineas.flatMap((l) => l.split(/\r\n|\r|\n/))) : null
                if (!r || !r.ok || clave === "unflags") mal("FLAGS_NO_ADMITIDOS", `\`build.${clave}\`: ${r && !r.ok ? `${JSON.stringify(r.flag)} — ${r.detalle}` : clave === "unflags" ? "sacar flags no tiene prueba que lo respalde" : "no es texto ni lista de textos"}`)
              } else if (clave === "srcDir" || clave === "includeDir") {
                if (!rutaInterna(valor)) mal("RUTA_FUERA_DE_LA_LIBRERIA", `\`build.${clave}\` no es una ruta relativa dentro de la librería`)
              } else mal("CLAVE_NO_ADMITIDA", `\`build.${clave}\` de \`library.json\` no está entre las claves admitidas`)
            }
          }
        }
        if ("dependencies" in datos) {
          const deps = dependenciasDeJson(datos.dependencies)
          if (!deps) mal("MANIFIESTO_NO_ENTENDIDO", "`dependencies` de `library.json` tiene una forma que no se entiende")
          else m.dependencias.push(...deps)
        }
      }
    }

    const props = leer(dir, "library.properties")
    if (props === null) mal("MANIFIESTO_NO_ENTENDIDO", "`library.properties` no es un archivo de texto legible")
    else if (props !== undefined) {
      for (const linea of props.split(/\r\n|\r|\n/)) {
        const kv = linea.match(/^\s*([A-Za-z_.]+)\s*=\s*(.*)$/)
        if (!kv) continue
        const clave = kv[1]!.toLowerCase()
        const valor = kv[2]!.trim()
        if (clave === "ldflags" && valor !== "") mal("FLAGS_NO_ADMITIDOS", "`ldflags` en `library.properties`: va al analizador de flags")
        else if (clave === "precompiled" && valor !== "" && valor.toLowerCase() !== "false") mal("CLAVE_NO_ADMITIDA", "`precompiled` en `library.properties`: linkea binarios que no se compilan acá")
        else if (clave === "name" && m.nombre === null) m.nombre = valor
        else if (clave === "version" && m.version === null) m.version = valor
        else if (clave === "depends" && json === undefined && valor !== "") {
          // Sólo cuenta si no hay `library.json` (si lo hay, PlatformIO usa las de ahí).
          for (const item of valor.split(",")) {
            const d = item.trim().match(/^([A-Za-z0-9][A-Za-z0-9 _.-]{0,62}?)(?:\s*\(([^()]{1,30})\))?$/)
            if (!d) mal("MANIFIESTO_NO_ENTENDIDO", `\`depends\` de \`library.properties\`: ${JSON.stringify(item.trim().slice(0, 60))} no se entiende`)
            else m.dependencias.push({ nombre: d[1]!, dueno: null, requisito: d[2]?.trim() ?? null })
          }
        }
      }
    }
    return bien ? m : null
  }

  const vistas: LibreriaVista[] = []
  /** Lo que hay bajado, por nombre en minúsculas. */
  const bajadas = new Map<string, LibreriaVista>()
  const dependencias: Array<{ de: LibreriaVista; dep: Dependencia }> = []

  const auditarCarpetaDeLibrerias = (donde: "lib" | "libdeps", raiz: string) => {
    const st = mirar(raiz)
    if (!st) return
    if (st.isSymbolicLink()) return rechazar(donde, "", "ENLACE_SIMBOLICO", `la carpeta de librerías es un enlace simbólico`)
    if (!st.isDirectory()) return rechazar(donde, "", "ENTRADA_NO_ADMITIDA", `la carpeta de librerías no es una carpeta`)
    let nombres: string[]
    try {
      nombres = readdirSync(raiz).sort()
    } catch {
      return rechazar(donde, "", "CARPETA_ILEGIBLE", "no se pudo leer la carpeta de librerías")
    }
    for (const carpeta of nombres) {
      const dir = join(raiz, carpeta)
      const e = mirar(dir)
      if (!e) {
        rechazar(donde, carpeta, "CARPETA_ILEGIBLE", "no se pudo mirar")
        continue
      }
      if (e.isSymbolicLink()) {
        rechazar(donde, carpeta, "ENLACE_SIMBOLICO", "es un enlace simbólico")
        continue
      }
      if (e.isFile()) continue // `lib/README`, `integrity.dat`: no son librerías
      if (!e.isDirectory()) {
        rechazar(donde, carpeta, "ENTRADA_NO_ADMITIDA", "no es ni archivo ni carpeta")
        continue
      }
      if (!recorrer(donde, carpeta, dir, 0)) continue
      // `.piopm`: lo que el gestor de paquetes anotó al bajarla (nombre, versión, dueño).
      let dueno: string | null = null
      let version: string | null = null
      let nombreInstalado: string | null = null
      const piopm = leer(dir, ".piopm")
      if (typeof piopm === "string") {
        try {
          const d: unknown = JSON.parse(piopm)
          if (esObjeto(d)) {
            if (typeof d.name === "string") nombreInstalado = d.name
            if (typeof d.version === "string") version = d.version
            if (esObjeto(d.spec) && typeof d.spec.owner === "string") dueno = d.spec.owner
          }
        } catch {
          /* sin `.piopm` legible: origen desconocido */
        }
      }
      const m = revisarManifiestos(donde, carpeta, dir, { nombre: nombreInstalado, version })
      if (!m) continue
      const vista: LibreriaVista = { donde, carpeta, nombre: nombreInstalado ?? m.nombre ?? carpeta, version: version ?? m.version, dueno }
      vistas.push(vista)
      if (donde === "libdeps") bajadas.set(vista.nombre.toLowerCase(), vista)
      for (const dep of m.dependencias) dependencias.push({ de: vista, dep })
    }
  }

  auditarCarpetaDeLibrerias("lib", join(cwd, "lib"))
  // `.pio` y `.pio/libdeps` tampoco pueden ser enlaces: si lo son, lo que se revisa no es lo que PlatformIO usa.
  let cadenaSana = true
  for (const tramo of [join(cwd, ".pio"), join(cwd, ".pio", "libdeps")]) {
    const st = mirar(tramo)
    if (st && !st.isDirectory()) {
      rechazar("libdeps", "", st.isSymbolicLink() ? "ENLACE_SIMBOLICO" : "ENTRADA_NO_ADMITIDA", "`.pio` o `.pio/libdeps` no es una carpeta común")
      cadenaSana = false
    }
  }
  if (cadenaSana) auditarCarpetaDeLibrerias("libdeps", join(cwd, ".pio", "libdeps", environment))

  // PRIMERA COMPILACIÓN: todo lo declarado tiene que estar ya bajado, en una versión que cumpla.
  for (const declarada of declaradas) {
    const d = declarada.match(LIB_DEP)
    if (!d) {
      rechazar("proyecto", declarada, "LIB_DEPS_SIN_DESCARGAR", "no tiene la forma `dueño/librería`")
      continue
    }
    const [, dueno, nombre, operador, numero] = d
    const bajada = bajadas.get(nombre!.toLowerCase())
    if (!bajada || bajada.dueno === null || bajada.dueno.toLowerCase() !== dueno!.toLowerCase()) {
      rechazar("proyecto", declarada, "LIB_DEPS_SIN_DESCARGAR", "está en `lib_deps` y no está bajada: `pio run` la bajaría y ejecutaría lo que traiga en la misma corrida, sin poder auditarla antes")
      continue
    }
    if (numero !== undefined && (bajada.version === null || cumpleVersion(bajada.version, `${operador ?? ""}${numero}`) !== true)) {
      rechazar("proyecto", declarada, "VERSION_NO_VERIFICABLE", `la versión bajada (${bajada.version ?? "desconocida"}) no cumple lo pedido o no se puede comparar: \`pio run\` bajaría otra`)
    }
  }
  // Y lo que cada librería declara como dependencia, también.
  for (const { de, dep } of dependencias) {
    const bajada = bajadas.get(dep.nombre.toLowerCase())
    if (!bajada || (dep.dueno !== null && (bajada.dueno ?? "").toLowerCase() !== dep.dueno.toLowerCase())) {
      rechazar(de.donde, de.carpeta, "DEPENDENCIA_SIN_DESCARGAR", `depende de \`${dep.nombre}\`, que no está bajada`)
      continue
    }
    if (dep.requisito !== null && (bajada.version === null || cumpleVersion(bajada.version, dep.requisito) !== true)) {
      rechazar(de.donde, de.carpeta, "VERSION_NO_VERIFICABLE", `pide \`${dep.nombre}\` ${JSON.stringify(dep.requisito.slice(0, 40))} y la bajada es ${bajada.version ?? "desconocida"}: no cumple o no se puede comparar`)
    }
  }

  return rechazos.length > 0 ? fallo() : { ok: true, librerias: vistas }
}

/** Los bytes de un archivo regular (sin seguir un enlace en el último tramo), o `null`. */
function leerBytes(ruta: string): Buffer | null {
  const st = mirar(ruta)
  if (!st || !st.isFile() || st.size > MAX_MANIFIESTO) return null
  try {
    return readFileSync(ruta)
  } catch {
    return null
  }
}

/**
 * `dependencies` de un `library.json`: una lista de `{ owner?, name, version? }` o un objeto
 * `{ "dueño/nombre": "requisito" }`. Cualquier otra forma (una URL como versión, un texto
 * suelto) → `null`: no se entiende, y quien llama rechaza.
 */
function dependenciasDeJson(x: unknown): Dependencia[] | null {
  const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/
  const DUENO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/
  const salida: Dependencia[] = []
  const sumar = (dueno: unknown, nombre: unknown, requisito: unknown): boolean => {
    if (typeof nombre !== "string" || !NOMBRE.test(nombre)) return false
    if (dueno !== undefined && dueno !== null && (typeof dueno !== "string" || !DUENO.test(dueno))) return false
    if (requisito !== undefined && requisito !== null && typeof requisito !== "string") return false
    salida.push({ nombre, dueno: typeof dueno === "string" ? dueno : null, requisito: typeof requisito === "string" ? requisito : null })
    return true
  }
  if (Array.isArray(x)) {
    for (const d of x) if (!esObjeto(d) || !sumar(d.owner, d.name, d.version)) return null
    return salida
  }
  if (esObjeto(x)) {
    for (const [clave, requisito] of Object.entries(x)) {
      const partes = clave.split("/")
      if (partes.length > 2 || !sumar(partes.length === 2 ? partes[0] : undefined, partes[partes.length - 1], requisito)) return null
    }
    return salida
  }
  return null
}
