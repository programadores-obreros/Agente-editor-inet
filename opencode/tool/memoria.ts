/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

// Memoria de progreso de ESTA computadora/grupo. NO es un perfil personal:
// no guarda el nombre ni nada que identifique a un alumno (Ley 25.326 — en las
// PCs de escuela una cuenta la comparten muchos chicos). Solo guarda el avance
// pedagogico de la maquina: nivel, proyectos hechos, ultimo proyecto.
// Se guarda en ~/.config/opencode/tecnia-memoria.md y se carga en cada sesion
// via la clave "instructions" de opencode.json (lo agrega el instalador), igual
// que el perfil. Archivo SEPARADO del perfil a proposito: lo personal (nombre)
// y lo pedagogico (progreso) no se mezclan.
function memoriaPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecnia-memoria.md")
}

const SIN_DEFINIR = "(sin definir)"
// Tope de la lista de proyectos: memoria acotada, no crece sin limite. Todo el
// juicio (tope, dedup, orden) vive aca en TypeScript, no lo decide el modelo.
const MAX_PROYECTOS = 8

interface Memoria {
  nivel: string
  proyectos: string[] // mas reciente al final
  enCurso: string // proyecto guiado en el que se esta trabajando ahora, con su paso
}

// Lee la memoria del disco. Si no existe o no se puede leer, devuelve vacia
// (nunca rompe: es dato del usuario, se trata con cuidado).
function leerMemoria(): Memoria {
  const memoria: Memoria = { nivel: SIN_DEFINIR, proyectos: [], enCurso: SIN_DEFINIR }
  const ruta = memoriaPath()
  if (!existsSync(ruta)) return memoria
  let texto = ""
  try {
    texto = readFileSync(ruta, "utf8")
  } catch {
    return memoria
  }
  const nivel = texto.match(/^-\s*Nivel:\s*(.*)$/m)?.[1]?.trim()
  const proyectos = texto.match(/^-\s*Proyectos hechos:\s*(.*)$/m)?.[1]?.trim()
  const enCurso = texto.match(/^-\s*En curso:\s*(.*)$/m)?.[1]?.trim()
  if (nivel && nivel !== SIN_DEFINIR) memoria.nivel = nivel
  if (proyectos && proyectos !== SIN_DEFINIR) {
    memoria.proyectos = proyectos
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  }
  if (enCurso && enCurso !== SIN_DEFINIR) memoria.enCurso = enCurso
  return memoria
}

// Agrega un proyecto a la lista SIN duplicar (dedup case-insensitive) y lo deja
// como el mas reciente (al final). Recorta al tope. Todo determinista, en TS.
function agregarProyecto(proyectos: string[], nuevo: string): string[] {
  const limpio = nuevo.trim()
  if (!limpio) return proyectos
  const sinDuplicado = proyectos.filter((p) => p.toLowerCase() !== limpio.toLowerCase())
  sinDuplicado.push(limpio)
  return sinDuplicado.slice(-MAX_PROYECTOS)
}

// El "ultimo proyecto" NO se guarda aparte: se deriva del ultimo de la lista,
// asi nunca queda desincronizado con "Proyectos hechos".
function ultimoProyecto(memoria: Memoria): string {
  return memoria.proyectos.length ? memoria.proyectos[memoria.proyectos.length - 1] : SIN_DEFINIR
}

// Arma el markdown legible (mismo formato que crea el instalador). El encabezado
// deja EXPLICITO que es memoria de la maquina, no de una persona.
function renderMemoria(memoria: Memoria): string {
  const proyectos = memoria.proyectos.length ? memoria.proyectos.join(", ") : SIN_DEFINIR
  return `# Memoria de ESTA compu (no de una persona)
<!-- Progreso pedagogico de esta maquina/grupo. Lo mantiene Tecnia Bot.
     NO guarda datos personales de ningun alumno (ni nombre ni nada que identifique
     a un menor): en las PCs de escuela una cuenta la comparten muchos chicos. -->

- Nivel: ${memoria.nivel || SIN_DEFINIR}
- Proyectos hechos: ${proyectos}
- Ultimo proyecto: ${ultimoProyecto(memoria)}
- En curso: ${memoria.enCurso || SIN_DEFINIR}
`
}

export default tool({
  description: `Memoria de progreso de ESTA computadora/grupo (NO es un perfil personal: no guarda nombre ni datos de ningun alumno). Recuerda entre sesiones el nivel, los proyectos hechos, el ultimo proyecto y el proyecto EN CURSO (uno guiado paso a paso), para adaptar como explicas y retomar exacto donde quedaron.

Acciones:
- leer: devuelve el progreso guardado (nivel, proyectos hechos, ultimo, y si hay un proyecto en curso con su paso). Usalo al arrancar para saber por donde venian en esta compu.
- guardar: actualiza el progreso. Para un proyecto GUIADO paso a paso: pasa 'en_curso' (el proyecto que estan haciendo) y 'paso' (en que paso van) a medida que avanzan; cuando lo TERMINAN, pasa 'proyecto' (se agrega a la lista de hechos y se limpia el en_curso). Tambien podes pasar 'nivel'. Lo que no pases se conserva.`,
  args: {
    accion: tool.schema
      .enum(["leer", "guardar"])
      .describe("'leer' para ver el progreso guardado; 'guardar' para persistir el avance."),
    proyecto: tool.schema
      .string()
      .optional()
      .describe("Nombre del proyecto que acaban de TERMINAR (ej: 'semaforo con 3 LEDs'). Se agrega a la lista sin duplicar y limpia el 'en curso'. Solo para accion 'guardar'."),
    en_curso: tool.schema
      .string()
      .optional()
      .describe("Proyecto guiado en el que estan trabajando AHORA, todavia sin terminar (ej: 'semaforo con 3 LEDs'). Para ir guardando el avance. Solo para 'guardar'."),
    paso: tool.schema
      .string()
      .optional()
      .describe("En que paso del proyecto en curso van (ej: 'paso 3 de 5: cablear los LEDs'). Solo para 'guardar', junto con 'en_curso'."),
    nivel: tool.schema
      .enum(["principiante", "intermedio", "avanzado"])
      .optional()
      .describe("Nivel observado del trabajo en esta compu. Solo para accion 'guardar', y solo si lo notas claramente."),
  },
  async execute(args) {
    if (args.accion === "leer") {
      const memoria = leerMemoria()
      const vacio = memoria.nivel === SIN_DEFINIR && memoria.proyectos.length === 0 && memoria.enCurso === SIN_DEFINIR
      if (vacio) {
        return "En esta compu todavia no hay progreso guardado. A medida que terminen proyectos, guardalos con accion 'guardar' (pasando 'proyecto')."
      }
      const enCurso =
        memoria.enCurso !== SIN_DEFINIR
          ? `\n- EN CURSO (retomá acá): ${memoria.enCurso}`
          : ""
      return `Progreso en ESTA compu (no es de una persona):
- Nivel: ${memoria.nivel}
- Proyectos hechos: ${memoria.proyectos.length ? memoria.proyectos.join(", ") : SIN_DEFINIR}
- Ultimo proyecto: ${ultimoProyecto(memoria)}${enCurso}`
    }

    // accion === "guardar": leemos lo actual, mergeamos y reescribimos.
    // El juicio (dedup, tope, orden) es del TS, no del modelo.
    const actual = leerMemoria()
    if (args.nivel) actual.nivel = args.nivel
    // Proyecto guiado EN CURSO: guardamos proyecto + paso mientras avanzan.
    if (args.en_curso && args.en_curso.trim()) {
      const paso = (args.paso || "").trim()
      actual.enCurso = paso ? `${args.en_curso.trim()} — ${paso}` : args.en_curso.trim()
    }
    // Proyecto TERMINADO: a la lista de hechos, y se limpia el "en curso".
    if (args.proyecto && args.proyecto.trim()) {
      actual.proyectos = agregarProyecto(actual.proyectos, args.proyecto)
      actual.enCurso = SIN_DEFINIR
    }

    const ruta = memoriaPath()
    try {
      // Bun.write escribe directo, sin depender del permiso 'write' del agente.
      await Bun.write(ruta, renderMemoria(actual))
    } catch (e) {
      return `No pude guardar el progreso (${e instanceof Error ? e.message : "error"}). Igual seguimos.`
    }

    if (actual.enCurso !== SIN_DEFINIR) {
      return `Anotado. En curso: ${actual.enCurso}. La próxima retomamos desde ahí.`
    }
    return `Anotado en la memoria de esta compu. Ultimo proyecto: ${ultimoProyecto(actual)}.`
  },
})
