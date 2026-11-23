// Memoria local — leer y escribir `tecnia-memoria.md` desde la carpeta `plataforma/`.
//
// El dueño de ese archivo es el tool `memoria` (`opencode/tool/memoria.ts`). Acá
// hay una SEGUNDA copia del lector y del escritor, a propósito, para poder llevar
// la memoria de esta compu a la cuenta del docente y traerla de vuelta.
//
// POR QUÉ UNA COPIA Y NO UN IMPORT:
// - Si el tool `memoria` importara de acá, dejaría de andar en toda instalación
//   que no traiga la carpeta `plataforma/` (hoy, Windows). El tool `memoria` se
//   usa en todas las sesiones; la sincronización, en casi ninguna.
// - Si esto importara del tool, arrastraría `@opencode-ai/plugin` a un módulo que
//   se prueba bajo Node sin OpenCode.
// Es el mismo criterio que `escribirArchivoAtomico` y `comoUrl`, duplicadas entre
// tools. El riesgo de una copia es que se separen: `tests/plataforma-sincronizar.test.mjs`
// («COMPATIBILIDAD con el tool memoria») escribe con el tool y lee con esto, y al revés. Si cambiás el formato en un
// lado y no en el otro, ese test se pone rojo.
//
// QUÉ SE PIERDE AL PASAR DE UN FORMATO AL OTRO, y es a propósito:
// - El nivel local es texto libre; la cuenta sólo acepta tres valores. Un nivel
//   local que no sea uno de los tres no viaja.
// - «Último proyecto» no viaja: se deriva del último de la lista en los dos lados.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NIVELES } from "./memoria-remota.ts"
import type { MemoriaDocente, Nivel } from "./memoria-remota.ts"

const ARCHIVO = "tecnia-memoria.md"
const SIN_DEFINIR = "(sin definir)"

export function rutaMemoriaLocal(carpeta: string): string {
  return join(carpeta, ARCHIVO)
}

export type ResultadoLeerLocal =
  | { estado: "ok"; memoria: MemoriaDocente }
  /** No hay archivo, o está pero no tiene ningún progreso anotado. */
  | { estado: "vacia" }
  | { estado: "ilegible"; ruta: string }

function esNivel(x: string): x is Nivel {
  return (NIVELES as readonly string[]).includes(x)
}

/** Una memoria sin nivel, sin proyectos y sin nada en curso no tiene nada que llevar. */
export function estaVacia(memoria: MemoriaDocente): boolean {
  return memoria.nivel === undefined && memoria.proyectos.length === 0 && memoria.enCurso === undefined
}

/** Lee la memoria de esta compu, en la forma en que la guarda la cuenta. */
export function leerMemoriaLocal(carpeta: string): ResultadoLeerLocal {
  const ruta = rutaMemoriaLocal(carpeta)
  if (!existsSync(ruta)) return { estado: "vacia" }
  let texto: string
  try {
    texto = readFileSync(ruta, "utf8")
  } catch {
    // Acá NO se hace como el tool `memoria`, que ante un archivo que no puede leer
    // sigue como si estuviera vacío. Para conversar eso alcanza; para sincronizar,
    // «vacía» significaría «no hay nada que perder» y se pisaría sin avisar.
    return { estado: "ilegible", ruta }
  }
  const memoria = memoriaDelTexto(texto)
  return estaVacia(memoria) ? { estado: "vacia" } : { estado: "ok", memoria }
}

/** La memoria que dice un texto con la forma del archivo. Pura: no toca el disco. */
function memoriaDelTexto(texto: string): MemoriaDocente {
  const campo = (nombre: string) => texto.match(new RegExp(`^-\\s*${nombre}:\\s*(.*)$`, "m"))?.[1]?.trim()
  const nivel = campo("Nivel")
  const proyectos = campo("Proyectos hechos")
  const enCurso = campo("En curso")

  const memoria: MemoriaDocente = { proyectos: [] }
  if (nivel && esNivel(nivel)) memoria.nivel = nivel
  if (proyectos && proyectos !== SIN_DEFINIR) {
    memoria.proyectos = proyectos
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  }
  if (enCurso && enCurso !== SIN_DEFINIR) memoria.enCurso = enCurso
  return memoria
}

/** Mismo texto que arma `renderMemoria` en el tool `memoria`. */
function render(memoria: MemoriaDocente): string {
  const proyectos = memoria.proyectos.length ? memoria.proyectos.join(", ") : SIN_DEFINIR
  return `# Memoria de ESTA compu (no de una persona)
<!-- Progreso pedagogico de esta maquina/grupo. Lo mantiene Tecnia Bot.
     Aca NO van datos personales de ningun alumno (ni nombre ni nada que identifique
     a un menor): en las PCs de escuela una cuenta la comparten muchos chicos.
     Es una regla para quien escribe: el archivo guarda el texto que le pasen, sin revisarlo. -->

- Nivel: ${memoria.nivel ?? SIN_DEFINIR}
- Proyectos hechos: ${proyectos}
- Ultimo proyecto: ${memoria.proyectos.at(-1) ?? SIN_DEFINIR}
- En curso: ${memoria.enCurso ?? SIN_DEFINIR}
`
}

/** Dos memorias son la misma si tienen el mismo nivel, los mismos proyectos en el mismo orden y lo mismo en curso. */
export function mismaMemoria(a: MemoriaDocente, b: MemoriaDocente): boolean {
  return (
    a.nivel === b.nivel &&
    a.enCurso === b.enCurso &&
    a.proyectos.length === b.proyectos.length &&
    a.proyectos.every((p, i) => p === b.proyectos[i])
  )
}

export type ResultadoEscribirLocal =
  | { estado: "escrita" }
  | { estado: "no-pude-escribir"; ruta: string }
  /** La memoria tiene algo que el formato del archivo no puede guardar igual. NO se tocó el disco. */
  | { estado: "no-entra-igual"; ruta: string }

/**
 * Reemplaza la memoria de esta compu, de forma atómica (temporal vecino + rename,
 * ver `escribirArchivoAtomico` en el tool `memoria`), y dice «escrita» sólo si al
 * RELEER el archivo sale la misma memoria que se quiso guardar.
 *
 * Lo que el formato no puede guardar igual (un nombre de proyecto con una coma se parte
 * en dos al leer, un salto de línea corta el renglón) se detecta ANTES de escribir y
 * devuelve «no-entra-igual» sin tocar el disco.
 *
 * La relectura de después queda para un disco que no devuelve lo que se le escribió.
 * LÍMITE HONESTO: desde que la comprobación de formato se hace antes, ningún test ejecuta
 * esa rama (el caso que la ejercitaba era justamente el de la coma).
 */
export function escribirMemoriaLocal(carpeta: string, memoria: MemoriaDocente): ResultadoEscribirLocal {
  const ruta = rutaMemoriaLocal(carpeta)
  // ANTES de tocar el disco: ¿este texto, leído, da la misma memoria? Hasta el 2026-11-23 la
  // comprobación de abajo era la única, y llegaba después del rename: con un proyecto con coma
  // en la cuenta, la memoria que había en la compu ya estaba reemplazada y sin copia cuando el
  // tool contestaba «no coincide» (auditoría del 2026-11-22, TCH-06). El mensaje no mentía,
  // pero el daño ya estaba hecho.
  if (!mismaMemoria(memoriaDelTexto(render(memoria)), memoria)) return { estado: "no-entra-igual", ruta }
  const temp = `${ruta}.${process.pid}.tmp`
  try {
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(temp, render(memoria), "utf8")
    renameSync(temp, ruta)
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // El temporal no llegó a crearse o ya no está.
    }
    return { estado: "no-pude-escribir", ruta }
  }
  const releida = leerMemoriaLocal(carpeta)
  const quedo: MemoriaDocente = releida.estado === "ok" ? releida.memoria : { proyectos: [] }
  if (releida.estado === "ilegible" || !mismaMemoria(quedo, memoria)) return { estado: "no-pude-escribir", ruta }
  return { estado: "escrita" }
}
