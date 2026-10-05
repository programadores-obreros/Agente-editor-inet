// Codegen MVP, Slice 1 — `platformio.ini` del programa generado.
//
// Sale SÓLO del registro de la placa (`placas.ts::backends.platformio`, con la versión de la
// plataforma fijada): ni la plantilla del prompt ni valores por defecto. El environment se
// llama como la placa (id semántico, estable), así el mismo proyecto siempre compila en el
// mismo environment. Puro: devuelve texto, no escribe nada.

import type { Placa } from "../nucleo/placas.ts"

export interface PlatformioIni {
  readonly environment: string
  readonly contenido: string
}

export function renderizarPlatformioIni(placa: Placa): PlatformioIni {
  const { board, platform, framework } = placa.backends.platformio
  const contenido = [
    "; Generado por Tecnia Bot (codegen) desde el registro de placas. No editar: se regenera desde el proyecto.",
    "",
    `[env:${placa.id}]`,
    `platform = ${platform}`,
    `board = ${board}`,
    `framework = ${framework}`,
    "",
  ].join("\n")
  return { environment: placa.id, contenido }
}
