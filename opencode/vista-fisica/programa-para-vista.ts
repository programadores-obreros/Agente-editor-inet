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
// nada, no lee disco y no conoce piezas ni placas.
//
// Cuando no hay programa, la página NO muestra código: muestra por qué, en palabras. Los códigos
// internos del generador nunca van a la pantalla.

import type { ResultadoGeneracion } from "../codegen/programa.ts"

/** El archivo del programa que se muestra. El `platformio.ini` es configuración, no el programa. */
const ARCHIVO = "src/main.cpp"

export type ProgramaParaVista =
  | { readonly ok: true; readonly archivo: string; readonly codigo: string; readonly lineas: number }
  | { readonly ok: false; readonly porQue: string }

/** El proyecto tiene algo que lo frena, y eso ya está dicho en palabras en la sección «Avisos».
 * (Hasta el rediseño del 2026-11-26 la sección se llamaba «Motivos»; el nombre de acá y el título
 * de `web/index.html` se cambiaron juntos, y `tests/ventana-pagina.test.mjs` los mantiene juntos.) */
export const TODAVIA_NO_ESTA_LISTO =
  "Todavía no hay programa: hay algo del proyecto que lo impide. Qué es, está en la sección «Avisos»."

/** Al proyecto le falta armarse; no hay ningún motivo que mostrar (p. ej. recién empieza, sin placa). */
export const TODAVIA_FALTA_ARMAR =
  "Todavía no hay programa: al proyecto le falta completarse (la placa, las piezas o algún pin). Cuando esté completo, el programa aparece acá."

/** El proyecto cierra, pero el generador de esta versión no lo sabe programar. */
export const TODAVIA_NO_SE_SABE_PROGRAMAR =
  "Todavía no hay programa: esta versión de Tecnia Bot no sabe programar este proyecto tal como está armado. El montaje y las reglas siguen valiendo."

/** El generador falló por dentro: no es culpa del proyecto. */
export const FALLO_AL_GENERAR = "No se pudo generar el programa por una falla de Tecnia Bot. El proyecto no cambió."

function hayMotivoQueFrena(datos: Readonly<Record<string, unknown>>): boolean {
  const motivos = datos.motivos
  return Array.isArray(motivos) && motivos.some((m) => m !== null && typeof m === "object" && (m as { severidad?: unknown }).severidad === "blocking")
}

export function programaParaVista(resultado: ResultadoGeneracion): ProgramaParaVista {
  if (!resultado.ok) {
    if (resultado.error.codigo !== "CODEGEN_PROYECTO_NO_LISTO") return { ok: false, porQue: TODAVIA_NO_SE_SABE_PROGRAMAR }
    // Se manda a «Avisos» SÓLO si ahí hay algo que frena. Un proyecto recién empezado no está
    // listo y no tiene ningún motivo: mandar al docente a una sección vacía sería mentirle.
    return { ok: false, porQue: hayMotivoQueFrena(resultado.error.datos) ? TODAVIA_NO_ESTA_LISTO : TODAVIA_FALTA_ARMAR }
  }
  const codigo = resultado.archivos[ARCHIVO]
  // Las líneas se cuentan como las cuenta quien lee: un salto final no agrega una línea vacía.
  const lineas = codigo === "" ? 0 : codigo.replace(/\n$/, "").split("\n").length
  return { ok: true, archivo: ARCHIVO, codigo, lineas }
}
