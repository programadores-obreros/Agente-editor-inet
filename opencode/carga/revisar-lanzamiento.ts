// `carga/revisar-lanzamiento.ts` — la revisión que corre el lanzador `tecnia-bot` ANTES de abrir
// OpenCode (ciclo 4). Es un programa chico: usa la MISMA función que la tool
// (`configuracionDeOpenCodeQueNoSeAdmite` de `./cargar-programa.ts`), sin duplicar reglas.
//
//   node revisar-lanzamiento.ts      → revisa process.cwd(), sus ancestros (también por la
//                                      ruta real), `$HOME/.opencode` y el entorno
//
// Sale con 0 si está limpio. Con 1 si no, y escribe en la salida estándar el motivo en una
// línea (lo muestra el lanzador). Cualquier otra cosa (no pudo cargar el módulo, otro error)
// es distinta de 0: el lanzador abre SIN marca. Falla cerrado.

import { configuracionDeOpenCodeQueNoSeAdmite, ENTORNO_DE_CONFIGURACION_REAL } from "./cargar-programa.ts"

const motivo = configuracionDeOpenCodeQueNoSeAdmite(process.cwd(), ENTORNO_DE_CONFIGURACION_REAL)
if (motivo) {
  process.stdout.write(`${motivo}\n`)
  process.exitCode = 1
} else {
  process.exitCode = 0
}
