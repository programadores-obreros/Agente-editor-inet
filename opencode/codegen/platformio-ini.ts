// Codegen MVP, Slice 1 — `platformio.ini` del programa generado.
//
// Sale SÓLO del registro de la placa (`placas.ts::backends.platformio`, con la versión de la
// plataforma fijada): ni la plantilla del prompt ni valores por defecto. El environment se
// llama como la placa (id semántico, estable), así el mismo proyecto siempre compila en el
// mismo environment. Puro: devuelve texto, no escribe nada.
//
// H-02: los cuatro valores vienen del catálogo y entran por `emision.ts` (`entornoIni`/`valorIni`),
// no por una plantilla de string. Un valor con un salto de línea abría otra opción u otra sección
// (`board = uno\nextra_scripts = x.py` hace que PlatformIO EJECUTE un script al compilar); con
// `${…}` interpolaba otra opción; con `;` comentaba el resto. Si un valor no tiene la forma
// cerrada, `renderizarPlatformioIni` lanza `RechazoDeEmision` y `generarPrograma` lo devuelve
// como `CODEGEN_DATO_NO_EMITIBLE`, sin archivos.

import type { Placa } from "../nucleo/placas.ts"
import { entornoIni, ini, valorIni } from "./emision.ts"

export interface PlatformioIni {
  readonly environment: string
  readonly contenido: string
}

export function renderizarPlatformioIni(placa: Placa): PlatformioIni {
  const { board, platform, framework } = placa.backends.platformio
  const environment = entornoIni(placa.id, "placa.id")
  const contenido = [
    "; Generado por Tecnia Bot (codegen) desde el registro de placas. No editar: se regenera desde el proyecto.",
    "",
    ini`[env:${environment}]`,
    ini`platform = ${valorIni(platform, "placa.backends.platformio.platform")}`,
    ini`board = ${valorIni(board, "placa.backends.platformio.board")}`,
    ini`framework = ${valorIni(framework, "placa.backends.platformio.framework")}`,
    "",
  ].join("\n")
  return { environment: environment.texto, contenido }
}
