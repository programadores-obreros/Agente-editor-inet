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

import type { MapaDelPrograma, RangoDeLineas, ResultadoGeneracion } from "../codegen/programa.ts"
import { porQueNoHayPrograma, type ContextoDeLaExplicacion } from "../codegen/por-que-no-hay-programa.ts"
import { textoDePasoDeInicio } from "../conocimiento/anexos/pedagogia-es-AR.ts"

// Los textos viven en `codegen/por-que-no-hay-programa.ts` desde el 2026-11-26: son los mismos
// que dice la tool `programa`, y tenerlos en dos lugares era la manera de que se separaran.
export { TODAVIA_FALTA_ARMAR, TODAVIA_NO_ESTA_LISTO, TODAVIA_NO_SE_SABE_PROGRAMAR } from "../codegen/por-que-no-hay-programa.ts"

/** El archivo del programa que se muestra. El `platformio.ini` es configuración, no el programa. */
const ARCHIVO = "src/main.cpp"

/**
 * La estructura del programa, para los bloques de la ventana (2026-11-26): qué hace «al iniciar»
 * (el `setup`), dónde está «por siempre» (el `loop`) y qué líneas son de cada regla. Los números
 * son los del mapa del generador, sin tocar; acá sólo se agregan las palabras de cada paso.
 */
export interface EstructuraParaVista {
  readonly alIniciar: { readonly lineas: RangoDeLineas; readonly pasos: readonly { readonly texto: string; readonly lineas: RangoDeLineas }[] }
  readonly porSiempre: { readonly lineas: RangoDeLineas }
  readonly reglas: readonly { readonly id: string; readonly lineas: RangoDeLineas }[]
  /**
   * Las piezas que el programa nombra, con el nombre que tienen en la ventana (2026-11-27,
   * hallazgo W38 de la notebook real). El programa las llama por su id (`cmp-12`, `PIN_CMP_12_…`)
   * y el alumno no tenía cómo saber cuál de los cuatro LED era. Con esto la ventana arma una
   * clave al lado del código. Son las piezas de los pasos de «al iniciar» (las que el programa
   * lee o maneja), una vez cada una, en ese orden. El programa no cambia: sigue siendo ASCII.
   */
  readonly piezas: readonly { readonly id: string; readonly nombre: string }[]
}

export type ProgramaParaVista =
  | { readonly ok: true; readonly archivo: string; readonly codigo: string; readonly lineas: number; readonly estructura?: EstructuraParaVista }
  | { readonly ok: false; readonly porQue: string }

/** Además de lo que hace falta para explicar por qué no hay programa, cómo se llama cada pieza en la ventana. */
export interface ContextoDelPrograma extends ContextoDeLaExplicacion {
  /**
   * El nombre con que la ventana muestra una pieza («LED», «LED 2»), por su id. Llega de afuera
   * (del modelo de la vista) para que el bloque y el esquema digan EL MISMO nombre: calcularlo acá
   * sería una segunda cuenta de «cuál es el LED 2».
   */
  readonly nombreDePieza?: (id: string) => string | undefined
}

/**
 * Pasa el mapa a la forma que pinta la ventana, o `undefined` si no se puede decir ENTERA: sin
 * nombres, con una pieza sin nombre o con un paso sin texto. Media estructura mostraría un
 * «al iniciar» al que le faltan renglones sin avisar; sin estructura, la ventana muestra el
 * código igual y los bloques dicen que todavía no la tienen.
 */
export function estructuraParaVista(mapa: MapaDelPrograma | undefined, nombreDePieza: ContextoDelPrograma["nombreDePieza"]): EstructuraParaVista | undefined {
  if (!mapa || !nombreDePieza) return undefined
  const pasos: { texto: string; lineas: RangoDeLineas }[] = []
  const piezas = new Map<string, string>()
  for (const paso of mapa.alIniciar.pasos) {
    const pieza = nombreDePieza(paso.componente)
    if (typeof pieza !== "string" || pieza === "") return undefined
    const texto = textoDePasoDeInicio({ papel: paso.papel, pieza, pin: paso.pin, ...(paso.reposo === undefined ? {} : { reposo: paso.reposo }) })
    if (texto === undefined) return undefined
    pasos.push({ texto, lineas: paso.lineas })
    piezas.set(paso.componente, pieza)
  }
  return {
    alIniciar: { lineas: mapa.alIniciar.lineas, pasos },
    porSiempre: { lineas: mapa.porSiempre.lineas },
    reglas: mapa.reglas.map((r) => ({ id: r.regla, lineas: r.lineas })),
    piezas: [...piezas].map(([id, nombre]) => ({ id, nombre })),
  }
}

/** El generador falló por dentro: no es culpa del proyecto. */
export const FALLO_AL_GENERAR = "No se pudo generar el programa por una falla de Tecnia Bot. El proyecto no cambió."

/**
 * `contexto` (el proyecto y Component Knowledge) es lo que permite decir la causa con nombre
 * («todavía no programa la placa …»). Sin él la explicación es la general.
 */
export function programaParaVista(resultado: ResultadoGeneracion, contexto?: ContextoDelPrograma): ProgramaParaVista {
  if (!resultado.ok) return { ok: false, porQue: porQueNoHayPrograma(resultado.error, contexto) }
  const codigo = resultado.archivos[ARCHIVO]
  // Las líneas se cuentan como las cuenta quien lee: un salto final no agrega una línea vacía.
  const lineas = codigo === "" ? 0 : codigo.replace(/\n$/, "").split("\n").length
  const estructura = estructuraParaVista(resultado.mapa, contexto?.nombreDePieza)
  return { ok: true, archivo: ARCHIVO, codigo, lineas, ...(estructura ? { estructura } : {}) }
}
