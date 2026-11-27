// Por qué no hay programa, dicho en palabras — UNA sola explicación por causa, que usan la
// ventana (sección «Mirá el código») y la tool `programa`.
//
// POR QUÉ EXISTE (2026-11-26, prueba 9 en la notebook real). El docente armó un proyecto con una
// placa que esta versión todavía no programa. La ventana dijo «El proyecto está completo» y, al lado, «esta versión de Tecnia Bot
// no sabe programar este proyecto tal como está armado»: verdad, pero sin decir QUÉ no sabe. El
// asistente, preguntado, contestó con lo único que tenía: `CODEGEN_NO_ADMITIDO` y el id interno de la placa.
// La causa la sabe el generador (viene en `error.codigo` y `error.datos`); faltaba pasarla a
// palabras en un solo lugar, para que la ventana y el asistente digan lo mismo.
//
// QUÉ NO HACE. No decide nada: lee el error que ya devolvió `generarPrograma`. Los nombres de
// placas y piezas salen de Component Knowledge (`conocimiento.nombre`), y la lista de placas que
// sí se programan sale de `generabilidad` (el mismo gate): acá no hay ningún nombre escrito a mano.
// Ningún código interno ni id (`CODEGEN_*`, `cmp-…`, el id de una placa) llega al texto.
//
// Puro: sin I/O ni reloj.

import type { Proyecto } from "../nucleo/ir.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { generabilidad } from "./generabilidad.ts"
import type { ErrorCodegen } from "./programa.ts"

const INICIO = "Todavía no hay programa:"
/** Cierre común: que no haya programa no invalida lo armado. */
const SIGUE_VALIENDO = "El montaje y las reglas siguen valiendo."

/** El proyecto tiene algo que lo frena, y eso ya está dicho en palabras en la sección «Avisos».
 * (Hasta el rediseño del 2026-11-26 la sección se llamaba «Motivos»; el nombre de acá y el título
 * de `web/index.html` se cambiaron juntos, y `tests/ventana-pagina.test.mjs` los mantiene juntos.) */
// Estos textos se leen en DOS lugares: en la ventana y en el chat (el asistente los dice tal cual).
// Por eso nombran la ventana y no dicen «acá»: la revisión del 2026-11-26 encontró que «el programa
// aparece acá», dicho en el chat, era falso (en el chat el programa no aparece nunca).
export const TODAVIA_NO_ESTA_LISTO = `${INICIO} hay algo del proyecto que lo impide. Qué es, está en la sección «Avisos» de la ventana del proyecto.`

/** Al proyecto le falta armarse; no hay ningún motivo que mostrar (p. ej. recién empieza, sin placa). */
export const TODAVIA_FALTA_ARMAR = `${INICIO} al proyecto le falta completarse (la placa, las piezas o algún pin). Cuando esté completo, el programa se ve en la ventana del proyecto.`

/** El proyecto cierra, pero el generador de esta versión no lo sabe programar, y la causa no es
 * ninguna de las que acá tienen explicación propia. */
export const TODAVIA_NO_SE_SABE_PROGRAMAR = `${INICIO} esta versión de Tecnia Bot no sabe programar este proyecto tal como está armado. ${SIGUE_VALIENDO}`

/** Un pin que la regla necesita no está elegido, o no se puede manejar desde el programa en esa
 * placa: el generador no distingue los dos casos, así que el texto tampoco afirma cuál es. */
export const PIN_QUE_NO_SE_PUEDE_USAR = `${INICIO} hay un pin que falta elegir o que no se puede usar desde el programa en esta placa. Revisá los pines de las piezas. ${SIGUE_VALIENDO}`

export interface ContextoDeLaExplicacion {
  readonly proyecto: Proyecto
  readonly conocimiento: ComponentKnowledge
}

const entreComillas = (nombres: readonly string[]): string => {
  const con = nombres.map((n) => `«${n}»`)
  return con.length <= 1 ? (con[0] ?? "") : `${con.slice(0, -1).join(", ")} y ${con[con.length - 1]}`
}

function hayMotivoQueFrena(datos: Readonly<Record<string, unknown>>): boolean {
  const motivos = datos.motivos
  return Array.isArray(motivos) && motivos.some((m) => m !== null && typeof m === "object" && (m as { severidad?: unknown }).severidad === "blocking")
}

interface NoAdmitido {
  readonly kind: "placa" | "componente"
  readonly id: string
}

function noAdmitidosDe(datos: Readonly<Record<string, unknown>>): readonly NoAdmitido[] {
  const lista = datos.noAdmitidos
  if (!Array.isArray(lista)) return []
  return lista.filter((x): x is NoAdmitido => x !== null && typeof x === "object" && (x.kind === "placa" || x.kind === "componente") && typeof x.id === "string")
}

/** La placa o las piezas que esta versión todavía no programa, por su nombre. Sin nombre no se
 * inventa nada: se cae a la explicación general. */
function explicarNoAdmitido(datos: Readonly<Record<string, unknown>>, { proyecto, conocimiento }: ContextoDeLaExplicacion): string {
  const noAdmitidos = noAdmitidosDe(datos)
  const placaDelProyecto = proyecto.placa === null ? undefined : conocimiento.nombre("placa", proyecto.placa)
  if (noAdmitidos.some((x) => x.kind === "placa")) {
    if (placaDelProyecto === undefined) return TODAVIA_NO_SE_SABE_PROGRAMAR
    const queSi = generabilidad(conocimiento)
      .placas.filter((p) => p.admitida)
      .map((p) => conocimiento.nombre("placa", p.placa))
      .filter((n): n is string => n !== undefined)
    const porAhora = queSi.length === 0 ? "" : ` Por ahora programa: ${entreComillas(queSi)}.`
    return `${INICIO} esta versión de Tecnia Bot todavía no programa la placa «${placaDelProyecto}».${porAhora} ${SIGUE_VALIENDO}`
  }
  const piezas = noAdmitidos.map((x) => conocimiento.nombre("componente", x.id))
  if (piezas.length === 0 || piezas.some((n) => n === undefined) || placaDelProyecto === undefined) return TODAVIA_NO_SE_SABE_PROGRAMAR
  // «con la placa …» se dice SÓLO si alguna de esas piezas se programa con otra placa. Si no se
  // programa con ninguna, nombrar la placa sugiere que cambiándola anda, y es falso.
  const tipos = new Set(noAdmitidos.map((x) => x.id))
  const conOtraPlacaSi = generabilidad(conocimiento).componentes.some((c) => tipos.has(c.tipo) && c.generableEn.length > 0)
  const conEstaPlaca = conOtraPlacaSi ? ` con la placa «${placaDelProyecto}»` : ""
  return `${INICIO} esta versión de Tecnia Bot todavía no programa ${entreComillas(piezas as string[])}${conEstaPlaca}. ${SIGUE_VALIENDO}`
}

/** El nombre de la pieza que el error señala (`datos.componente` es el id de la pieza en el
 * proyecto), o `undefined` si no se puede saber. */
function piezaSenalada(datos: Readonly<Record<string, unknown>>, { proyecto, conocimiento }: ContextoDeLaExplicacion): string | undefined {
  const tipo = proyecto.componentes.find((c) => c.id === datos.componente)?.tipo
  return tipo === undefined ? undefined : conocimiento.nombre("componente", tipo)
}

/**
 * La explicación, en palabras, de por qué `generarPrograma` no devolvió un programa.
 * Sin `contexto` (no se sabe qué proyecto es) sólo distingue «no está listo» de «no se sabe
 * programar»: nunca inventa una causa.
 */
export function porQueNoHayPrograma(error: ErrorCodegen, contexto?: ContextoDeLaExplicacion): string {
  const { codigo, datos } = error
  // Se manda a «Avisos» SÓLO si ahí hay algo que frena. Un proyecto recién empezado no está
  // listo y no tiene ningún motivo: mandar al docente a una sección vacía sería mentirle.
  if (codigo === "CODEGEN_PROYECTO_NO_LISTO") return hayMotivoQueFrena(datos) ? TODAVIA_NO_ESTA_LISTO : TODAVIA_FALTA_ARMAR
  if (!contexto) return TODAVIA_NO_SE_SABE_PROGRAMAR
  switch (codigo) {
    case "CODEGEN_NO_ADMITIDO":
      return explicarNoAdmitido(datos, contexto)
    case "CODEGEN_SIN_LECTURA":
    case "CODEGEN_PROTOCOLO_SIN_BACKEND":
    case "CODEGEN_LECTURA_INCOHERENTE": {
      const pieza = piezaSenalada(datos, contexto)
      return pieza === undefined ? TODAVIA_NO_SE_SABE_PROGRAMAR : `${INICIO} esta versión de Tecnia Bot todavía no sabe leer «${pieza}» para la regla que la usa. ${SIGUE_VALIENDO}`
    }
    // Acá la pieza se sabe leer: lo que no se puede es llevar el número de la regla a lo que la pieza mide.
    case "CODEGEN_UMBRAL_NO_CONVERTIBLE":
    case "CODEGEN_CONVERSION_NO_MONOTONA": {
      const pieza = piezaSenalada(datos, contexto)
      return pieza === undefined ? TODAVIA_NO_SE_SABE_PROGRAMAR : `${INICIO} esta versión de Tecnia Bot no sabe comparar el número de la regla con lo que mide «${pieza}». Probá escribir la regla con otra unidad. ${SIGUE_VALIENDO}`
    }
    case "CODEGEN_SIN_ESCRITURA":
    case "CODEGEN_REPOSO_NO_DECLARADO": {
      const pieza = piezaSenalada(datos, contexto)
      return pieza === undefined ? TODAVIA_NO_SE_SABE_PROGRAMAR : `${INICIO} esta versión de Tecnia Bot todavía no sabe manejar «${pieza}» como lo pide la regla. ${SIGUE_VALIENDO}`
    }
    case "CODEGEN_PIN_NO_DERIVABLE":
      return PIN_QUE_NO_SE_PUEDE_USAR
    default:
      return TODAVIA_NO_SE_SABE_PROGRAMAR
  }
}
