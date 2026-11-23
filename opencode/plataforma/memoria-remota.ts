// Memoria remota — la memoria del docente guardada en la plataforma Tecnia Lab.
//
// QUÉ ES Y QUÉ NO ES. Este módulo sabe leer, guardar y borrar la memoria del
// docente a través de la API del bot (`api.ts`). No sabe vincularse, no guarda
// el token, no toca el disco y no decide cuándo sincronizar: todo eso se le
// inyecta o vive en otro lado. Por eso se prueba entero con un `fetch` falso.
//
// NO ES la memoria de la compu (`opencode/tool/memoria.ts`). Aquélla es anónima a
// propósito —en la PC del aula una cuenta la comparten muchos chicos— y sigue
// siendo la que manda cuando no hay sesión. Ésta es la del DOCENTE que vinculó
// el bot con su cuenta de la plataforma, que sólo valida adultos.
//
// EL CONTRATO (acordado con el repo de la plataforma; allá vive la autoridad,
// esto es el espejo del lado del bot):
//   nivel        "principiante" | "intermedio" | "avanzado"   (opcional)
//   proyectos    hasta 8 strings de hasta 200 caracteres, el más reciente al final
//   enCurso      string de hasta 500 caracteres               (opcional)
//   version      la lleva el servidor: 1 al crear, +1 por escritura
//
// TRES REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO:
//
// 1. «NO PUDE GUARDAR» NO ES «GUARDADO». Cada cosa que puede pasar tiene un
//    resultado con nombre. Sólo hay `guardado` cuando el servidor devolvió la
//    versión nueva y es exactamente la anterior + 1.
//
// 2. NUNCA SE PISA LO QUE NO SE LEYÓ. Guardar exige decir sobre qué versión se
//    escribe. Si otra compu del mismo docente escribió antes, el servidor
//    contesta `conflicto` y acá no se reintenta solo: quien llama relee y decide.
//
// 3. LO QUE NO SE ENTIENDE NO SE TOCA. Una memoria con otro `esquema` o con otra
//    forma se informa y no se interpreta: puede ser de una versión más nueva.
//
// HISTORIA. La primera versión de este archivo le hablaba directo a Firestore
// por REST. Se cambió por dos motivos que salieron de probarlo contra el
// emulador de la plataforma: una sesión de Firebase le daba al bot el mismo
// alcance que la web (DNI y CUIL incluidos), y el conflicto de dos compus volvía
// como un 403 que no se distinguía de cualquier otro rechazo de las reglas.
//
// LO QUE ESTE ARCHIVO TODAVÍA NO PROBÓ: nada de acá corrió contra la API real ni
// contra el emulador; del otro lado todavía no está implementada. Los tests
// ejercitan este código contra un `fetch` falso que responde lo que dice el
// contrato.

import { esObjeto, fallaComun, pedir } from "./api.ts"
import type { DependenciasConSesion, Falla } from "./api.ts"

export const ESQUEMA = 1
export const MAX_PROYECTOS = 8
export const MAX_LARGO_PROYECTO = 200
export const MAX_LARGO_EN_CURSO = 500
export const NIVELES = ["principiante", "intermedio", "avanzado"] as const

export type Nivel = (typeof NIVELES)[number]
export type Campo = "nivel" | "proyectos" | "enCurso" | "esquema"

export interface MemoriaDocente {
  nivel?: Nivel
  proyectos: string[]
  enCurso?: string
}

export type ResultadoLeer =
  | { estado: "ok"; memoria: MemoriaDocente; version: number }
  | { estado: "vacia" }
  | { estado: "esquema-desconocido"; esquema: string }
  | Falla

export type ResultadoGuardar =
  | { estado: "guardado"; version: number }
  | { estado: "conflicto"; version: number }
  | { estado: "no-cabe"; campo: Campo }
  | Falla

export type ResultadoBorrar = { estado: "borrada" } | Falla

const CAMPOS: readonly string[] = ["nivel", "proyectos", "enCurso", "esquema"]

function esVersion(x: unknown, minimo: number): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= minimo
}

/**
 * Revisa la memoria contra los topes del contrato ANTES de mandarla.
 *
 * No recorta ni «arregla»: si algo no entra, lo dice. Recortar en silencio haría
 * que el docente lea «guardado» sobre algo que no es lo que tenía.
 */
export function revisarMemoria(memoria: MemoriaDocente): Campo | null {
  if (memoria.nivel !== undefined && !NIVELES.includes(memoria.nivel)) return "nivel"
  if (memoria.proyectos.length > MAX_PROYECTOS) return "proyectos"
  if (memoria.proyectos.some((p) => typeof p !== "string" || p.length > MAX_LARGO_PROYECTO)) return "proyectos"
  if (memoria.enCurso !== undefined && memoria.enCurso.length > MAX_LARGO_EN_CURSO) return "enCurso"
  return null
}

/**
 * Lee la memoria del cuerpo de una respuesta.
 *
 * Es estricta a propósito: ante cualquier cosa que no sea la forma del contrato
 * devuelve `respuesta-invalida` en vez de rellenar con valores por defecto. Una
 * memoria leída «a medias» y vuelta a guardar borraría lo que no se entendió.
 */
export function deRespuesta(json: unknown): ResultadoLeer {
  if (!esObjeto(json)) return { estado: "respuesta-invalida", detalle: "la respuesta no es un objeto" }
  if (json.esquema !== ESQUEMA) {
    if (typeof json.esquema === "number") return { estado: "esquema-desconocido", esquema: String(json.esquema) }
    return { estado: "respuesta-invalida", detalle: "falta el esquema" }
  }
  if (!esVersion(json.version, 1)) return { estado: "respuesta-invalida", detalle: "falta la versión" }
  if (!esObjeto(json.memoria)) return { estado: "respuesta-invalida", detalle: "falta la memoria" }
  const cruda = json.memoria

  if (!Array.isArray(cruda.proyectos) || !cruda.proyectos.every((p) => typeof p === "string")) {
    return { estado: "respuesta-invalida", detalle: "la lista de proyectos no es una lista de textos" }
  }
  const memoria: MemoriaDocente = { proyectos: [...cruda.proyectos] }

  if (cruda.nivel !== undefined) {
    if (typeof cruda.nivel !== "string" || !(NIVELES as readonly string[]).includes(cruda.nivel)) {
      return { estado: "respuesta-invalida", detalle: "el nivel guardado no es uno de los tres del contrato" }
    }
    memoria.nivel = cruda.nivel as Nivel
  }
  if (cruda.enCurso !== undefined) {
    if (typeof cruda.enCurso !== "string") return { estado: "respuesta-invalida", detalle: "el proyecto en curso no es texto" }
    memoria.enCurso = cruda.enCurso
  }
  return { estado: "ok", memoria, version: json.version }
}

/**
 * Lee la memoria del docente.
 *
 * Que todavía no exista es `vacia`, pero SÓLO si la plataforma lo dice con su
 * código (`sin-memoria`). Un 404 pelado —una URL mal armada, un proxy— es un
 * error: tomarlo por «no hay nada» invitaría a crear encima de lo que sí hay.
 */
export async function leerMemoriaRemota(deps: DependenciasConSesion): Promise<ResultadoLeer> {
  const res = await pedir(deps, "GET", "/memoria")
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  if (r.status === 404 && r.codigo === "sin-memoria") return { estado: "vacia" }
  if (r.status !== 200) return fallaComun(r)
  return deRespuesta(r.json)
}

/**
 * Guarda la memoria del docente sobre la versión que se leyó.
 *
 * `versionAnterior` es la versión de la última lectura, o 0 si la lectura dio
 * `vacia`. Reemplaza la memoria entera: lo que no venga en `memoria` deja de
 * estar. Quien llama parte siempre de una lectura, así que eso es lo que quiere.
 */
export async function guardarMemoriaRemota(
  deps: DependenciasConSesion,
  memoria: MemoriaDocente,
  versionAnterior: number,
): Promise<ResultadoGuardar> {
  const noCabe = revisarMemoria(memoria)
  if (noCabe) return { estado: "no-cabe", campo: noCabe }
  if (!esVersion(versionAnterior, 0)) {
    return { estado: "respuesta-invalida", detalle: "la versión anterior no es un entero válido" }
  }

  // Se arma campo por campo: lo que viaje de más lo rechaza el servidor.
  const cuerpoMemoria: MemoriaDocente = { proyectos: memoria.proyectos }
  if (memoria.nivel !== undefined) cuerpoMemoria.nivel = memoria.nivel
  if (memoria.enCurso !== undefined) cuerpoMemoria.enCurso = memoria.enCurso

  const res = await pedir(deps, "PUT", "/memoria", { esquema: ESQUEMA, memoria: cuerpoMemoria, versionAnterior })
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  const json = esObjeto(r.json) ? r.json : {}

  if (r.status === 409 && r.codigo === "conflicto" && esVersion(json.version, 0)) {
    return { estado: "conflicto", version: json.version }
  }
  if (r.status === 422 && r.codigo === "no-cabe" && typeof json.campo === "string" && CAMPOS.includes(json.campo)) {
    return { estado: "no-cabe", campo: json.campo as Campo }
  }
  if (r.status !== 200) return fallaComun(r)

  // Un 200 solo no alcanza. La versión que vuelve es la base de la próxima
  // escritura; si no es la anterior + 1, algo no es lo que este código cree y
  // decir «guardado» sería afirmar algo que no se comprobó.
  if (json.version !== versionAnterior + 1) {
    return { estado: "respuesta-invalida", detalle: "la plataforma no confirmó la versión nueva" }
  }
  return { estado: "guardado", version: versionAnterior + 1 }
}

/** Borra la memoria del docente en la plataforma. Es su derecho de supresión. */
export async function borrarMemoriaRemota(deps: DependenciasConSesion): Promise<ResultadoBorrar> {
  const res = await pedir(deps, "DELETE", "/memoria")
  if (res.tipo === "falla") return res.falla
  const r = res.respuesta
  if (r.status === 200 && esObjeto(r.json) && r.json.borrada === true) return { estado: "borrada" }
  return fallaComun(r)
}
