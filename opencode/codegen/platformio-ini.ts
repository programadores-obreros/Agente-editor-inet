// Codegen MVP, Slice 1 — `platformio.ini` del programa generado.
//
// Sale SÓLO del registro de la placa (`placas.ts::backends.platformio`, con la versión de la
// plataforma fijada): ni la plantilla del prompt ni valores por defecto. El environment se
// llama como la placa (id semántico, estable), así el mismo proyecto siempre compila en el
// mismo environment. Puro: devuelve texto, no escribe nada.
//
// `opciones.buildFlags` (Modo Vivo, V4-7) agrega una línea `build_flags = ...` después del
// framework. `generarPrograma` no la pasa: su ini no cambia ni un byte.

import type { Placa } from "../nucleo/placas.ts"

export interface PlatformioIni {
  readonly environment: string
  readonly contenido: string
}

export interface OpcionesDePlatformioIni {
  /** Flags de compilación (`build_flags`), una por elemento, en el orden dado. Sin elementos no se emite la línea. */
  readonly buildFlags?: readonly string[]
}

const FORMA_DE_FLAG = /^-[A-Za-z][A-Za-z0-9_=.+-]*$/

export function renderizarPlatformioIni(placa: Placa, opciones: OpcionesDePlatformioIni = {}): PlatformioIni {
  const { board, platform, framework } = placa.backends.platformio
  const flags = opciones.buildFlags ?? []
  for (const flag of flags) if (!FORMA_DE_FLAG.test(flag)) throw new Error(`build flag invalida para platformio.ini: ${JSON.stringify(flag)}`)
  const contenido = [
    "; Generado por Tecnia Bot (codegen) desde el registro de placas. No editar: se regenera desde el proyecto.",
    "",
    `[env:${placa.id}]`,
    `platform = ${platform}`,
    `board = ${board}`,
    `framework = ${framework}`,
    ...(flags.length > 0 ? [`build_flags = ${flags.join(" ")}`] : []),
    "",
  ].join("\n")
  return { environment: placa.id, contenido }
}
