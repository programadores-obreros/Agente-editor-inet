// Programa para la ventana — lo que la vista muestra en su sección «Código».
//
// POR QUÉ EXISTE (2026-11-24). En la notebook real el docente pidió «mostrame el código»: el
// asistente generó y compiló bien (94 líneas, dos reglas), leyó el archivo y lo REESCRIBIÓ en el
// chat con 25 líneas y una sola regla, diciendo que era el generado. La regla «mostralo tal cual»
// ya estaba en sus instrucciones y no alcanzó. Lo que tiene que ser exacto no puede pasar por el
// modelo: el código se muestra en la ventana, puesto por el programa, igual que el montaje.
//
// Este módulo es PURO: recibe el resultado del generador (el mismo `generarPrograma` que usa la
// tool `programa` para compilar y cargar) y lo deja en la forma que la página pinta. No genera
// nada, no lee disco y no conoce piezas ni placas: la causa en palabras se la pide a
// `codegen/por-que-no-hay-programa.ts`.
//
// Cuando no hay programa, la página NO muestra código: muestra por qué, en palabras. Los códigos
// internos del generador nunca van a la pantalla.

import type { ResultadoGeneracion } from "../codegen/programa.ts"
import { porQueNoHayPrograma, type ContextoDeLaExplicacion } from "../codegen/por-que-no-hay-programa.ts"

// Los textos viven en `codegen/por-que-no-hay-programa.ts` desde el 2026-11-26: son los mismos
// que dice la tool `programa`, y tenerlos en dos lugares era la manera de que se separaran.
export { TODAVIA_FALTA_ARMAR, TODAVIA_NO_ESTA_LISTO, TODAVIA_NO_SE_SABE_PROGRAMAR } from "../codegen/por-que-no-hay-programa.ts"

/** El archivo del programa que se muestra. El `platformio.ini` es configuración, no el programa. */
const ARCHIVO = "src/main.cpp"

export type ProgramaParaVista =
  | { readonly ok: true; readonly archivo: string; readonly codigo: string; readonly lineas: number }
  | { readonly ok: false; readonly porQue: string }

/** El generador falló por dentro: no es culpa del proyecto. */
export const FALLO_AL_GENERAR = "No se pudo generar el programa por una falla de Tecnia Bot. El proyecto no cambió."

/**
 * `contexto` (el proyecto y Component Knowledge) es lo que permite decir la causa con nombre
 * («todavía no programa la placa …»). Sin él la explicación es la general.
 */
export function programaParaVista(resultado: ResultadoGeneracion, contexto?: ContextoDeLaExplicacion): ProgramaParaVista {
  if (!resultado.ok) return { ok: false, porQue: porQueNoHayPrograma(resultado.error, contexto) }
  const codigo = resultado.archivos[ARCHIVO]
  // Las líneas se cuentan como las cuenta quien lee: un salto final no agrega una línea vacía.
  const lineas = codigo === "" ? 0 : codigo.replace(/\n$/, "").split("\n").length
  return { ok: true, archivo: ARCHIVO, codigo, lineas }
}
