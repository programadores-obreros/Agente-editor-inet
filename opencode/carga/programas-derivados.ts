// Dónde viven los programas DERIVADOS de los proyectos físicos (los que genera la tool `programa`).
//
// Un solo lugar que lo decide, porque lo usan dos tools que no se importan entre sí: `programa`
// (escribe ahí) y `platformio` (se niega a compilar o cargar desde ahí). Con la ruta repetida en
// cada una, la barrera podía quedar mirando una carpeta y el programa cayendo en otra.
//
// Es una carpeta del USUARIO, fuera de cualquier carpeta de trabajo: el agente no puede leer
// fuera de la suya, y eso es lo que impide que copie el programa a mano en el chat.
//
//   - Linux/macOS: `$XDG_CACHE_HOME` (o `~/.cache`) + `tecnia-bot-programas`
//   - Windows:     `%LOCALAPPDATA%` (o `~\AppData\Local`) + `TecniaBot-programas`
//
// NO va adentro de `TecniaBot\` en Windows a propósito: ésa es la carpeta donde se INSTALA el
// programa. El desinstalador lista lo que encuentra ahí y avisa «hay cosas que el instalador no
// había puesto, pueden ser proyectos guardados por error»: con los derivados adentro, ese cartel
// le hablaría al docente de carpetas que son nuestras (revisión independiente del 2026-11-26).

import { join } from "node:path"
import { baseDeCargas } from "./cargar-programa.ts"

export function raizDeProgramasDerivados(entorno: NodeJS.ProcessEnv = process.env): string {
  const { base, tramos } = baseDeCargas(entorno)
  return join(base, `${tramos[0]!}-programas`)
}
