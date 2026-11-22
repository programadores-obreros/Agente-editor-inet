// Sincronizar — llevar la memoria de esta compu a la cuenta del docente, y traerla.
//
// SIEMPRE A PEDIDO. Nada de esto corre solo: el docente dice «guardá mi memoria en
// mi cuenta» o «traé mi memoria», y el bot hace una de las dos cosas y cuenta lo
// que pasó. Fue una decisión de Alejandro (2026-11-19): la sincronización
// automática tiene que resolver sola qué hacer cuando dos compus tienen memorias
// distintas, y un error ahí pisa el progreso del docente sin que se entere.
//
// SUBIR Y TRAER REEMPLAZAN, NO MEZCLAN. Subir deja en la cuenta lo que hay en esta
// compu; traer deja en esta compu lo que hay en la cuenta. No se combinan listas.
// Mezclar parece más amable y es peor: un proyecto borrado a propósito en una
// compu volvería a aparecer desde la otra.
//
// CUATRO REGLAS DE ESTE ARCHIVO:
//
// 1. NUNCA SE PISA SIN QUE EL DOCENTE LO HAYA VISTO. Si del otro lado hay una
//    memoria distinta, la primera llamada no cambia nada: muestra las dos y
//    explica cómo seguir. Recién una segunda llamada con `reemplazar` pisa, y
//    sólo si lo que hay ahora en los dos lados es EXACTAMENTE lo que se mostró.
//    Si en el medio otra compu guardó algo, se vuelve a mostrar.
//
// 2. UNA MEMORIA VACÍA NO PISA A UNA QUE TIENE ALGO. Subir desde una compu sin
//    progreso no borra la memoria de la cuenta, y traer de una cuenta sin memoria
//    no borra la de la compu. Ni con `reemplazar`.
//
// 3. NADA SE AFIRMA SIN COMPROBARLO. «Guardé» sale de que la plataforma devolvió
//    la versión siguiente; «traje» sale de releer el archivo de esta compu.
//
// 4. EN MODO AULA NO SE SINCRONIZA. La memoria de la compu del aula es de un grupo
//    de chicos: no va a la cuenta personal de nadie.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Falla, FetchLike } from "./api.ts"
import * as local from "./memoria-local.ts"
import * as remota from "./memoria-remota.ts"
import type { MemoriaDocente } from "./memoria-remota.ts"
import * as sesion from "./sesion-local.ts"

export interface DependenciasSincronizar {
  fetch: FetchLike
  /** URL base de la API del bot, ya validada. */
  api: string
  /** Carpeta de configuración de OpenCode: ahí están la sesión, el perfil y la memoria. */
  carpeta: string
}

/** Lo que se le mostró al docente la última vez que hubo dos memorias distintas. */
interface Mostrado {
  sentido: "subir" | "traer"
  /**
   * La versión de la memoria de la cuenta que se mostró. Alcanza con el número:
   * la plataforma lo sube en cada guardado, así que misma versión es mismo
   * contenido. Comparar además el contenido era un chequeo que no podía fallar.
   */
  version: number
  enCompu: MemoriaDocente
}

function decirFalla(falla: Falla): string {
  switch (falla.estado) {
    case "sin-conexion":
      return `no pude comunicarme con la plataforma (${falla.detalle})`
    case "sesion-invalida":
      return "la plataforma no reconoce la sesión (venció o se cerró desde la web); usá la acción 'estado'"
    case "demasiados-pedidos":
      return "la plataforma pidió esperar un momento antes de volver a intentar"
    case "respuesta-invalida":
      return "la plataforma contestó algo que no entiendo"
    case "error":
      return `la plataforma devolvió un error (${falla.detalle})`
  }
}

const NOMBRE_DE_CAMPO: Record<remota.Campo, string> = {
  nivel: "el nivel",
  proyectos: `la lista de proyectos (hasta ${remota.MAX_PROYECTOS}, de hasta ${remota.MAX_LARGO_PROYECTO} caracteres cada uno)`,
  enCurso: `el proyecto en curso (hasta ${remota.MAX_LARGO_EN_CURSO} caracteres)`,
  esquema: "el formato de la memoria",
}

/** La memoria en renglones, para mostrársela al docente. */
export function decirMemoria(memoria: MemoriaDocente): string {
  return [
    `  - Nivel: ${memoria.nivel ?? "(sin definir)"}`,
    `  - Proyectos hechos: ${memoria.proyectos.length ? memoria.proyectos.join(", ") : "(ninguno)"}`,
    `  - En curso: ${memoria.enCurso ?? "(nada)"}`,
  ].join("\n")
}

function modoDelPerfil(carpeta: string): string {
  const ruta = join(carpeta, "tecnia-perfil.md")
  if (!existsSync(ruta)) return ""
  try {
    return readFileSync(ruta, "utf8").match(/^-\s*Modo:\s*(.*)$/m)?.[1]?.trim() ?? ""
  } catch {
    return ""
  }
}

export function crearSincronizador(deps: DependenciasSincronizar): {
  subir(reemplazar: boolean): Promise<string>
  traer(reemplazar: boolean): Promise<string>
} {
  let mostrado: Mostrado | null = null

  /** Devuelve con qué hablarle a la plataforma, o el mensaje de por qué no se puede. */
  function preparar(): { conSesion: { fetch: FetchLike; base: string; token: () => Promise<string> } } | { no: string } {
    if (modoDelPerfil(deps.carpeta) === "aula") {
      return { no: "Esta compu está en modo aula: su memoria es del grupo, no de una persona, así que no se lleva ni se trae de ninguna cuenta. No hice nada." }
    }
    const guardada = sesion.leerSesionGuardada(deps.carpeta)
    if (guardada.estado === "sin-sesion") {
      return { no: "No hay ninguna cuenta de Tecnia Lab vinculada en esta compu. Primero hay que vincularla con la acción 'vincular'. No hice nada." }
    }
    if (guardada.estado === "ilegible" || guardada.sesion.base !== deps.api) {
      return { no: "La sesión guardada en esta compu no se puede usar. Usá la acción 'estado' para ver qué pasa. No hice nada." }
    }
    const token = guardada.sesion.token
    return { conSesion: { fetch: deps.fetch, base: deps.api, token: async () => token } }
  }

  /** ¿Lo que hay ahora en los dos lados es exactamente lo que el docente vio? */
  function esLoMostrado(sentido: Mostrado["sentido"], version: number, enCompu: MemoriaDocente): boolean {
    return (
      mostrado !== null &&
      mostrado.sentido === sentido &&
      mostrado.version === version &&
      local.mismaMemoria(mostrado.enCompu, enCompu)
    )
  }

  function mostrarLasDos(sentido: Mostrado["sentido"], version: number, enCuenta: MemoriaDocente, enCompu: MemoriaDocente, cambio: boolean): string {
    mostrado = { sentido, version, enCompu }
    const encabezado = cambio
      ? "Lo que hay en la cuenta o en esta compu cambió desde la última vez que lo mostré, así que NO reemplacé nada. Ahora hay esto:"
      : "En la cuenta y en esta compu hay memorias DISTINTAS. No cambié nada todavía."
    const comoSeguir =
      sentido === "subir"
        ? "Si el docente quiere que la cuenta quede con la de ESTA COMPU (se pierde la que hay en la cuenta), repetí 'subir' con reemplazar en true. Si prefiere quedarse con la de la cuenta, usá 'traer'."
        : "Si el docente quiere que ESTA COMPU quede con la de la cuenta (se pierde la que hay en esta compu), repetí 'traer' con reemplazar en true. Si prefiere quedarse con la de esta compu, usá 'subir'."
    return `${encabezado}\n\nEn la cuenta:\n${decirMemoria(enCuenta)}\n\nEn esta compu:\n${decirMemoria(enCompu)}\n\nMostrale las dos al docente y preguntale cuál quiere. ${comoSeguir}`
  }

  async function subir(reemplazar: boolean): Promise<string> {
    const listo = preparar()
    if ("no" in listo) return listo.no

    const enCompu = local.leerMemoriaLocal(deps.carpeta)
    if (enCompu.estado === "ilegible") return `No pude leer la memoria de esta compu (${enCompu.ruta}). No subí nada.`
    if (enCompu.estado === "vacia") return "En esta compu todavía no hay progreso guardado, así que no hay nada para subir. No toqué la memoria de la cuenta."
    const noCabe = remota.revisarMemoria(enCompu.memoria)
    if (noCabe) return `La memoria de esta compu no entra en la cuenta: se pasa ${NOMBRE_DE_CAMPO[noCabe]}. No subí nada.`

    const enCuenta = await remota.leerMemoriaRemota(listo.conSesion)
    let versionAnterior: number
    if (enCuenta.estado === "vacia") {
      versionAnterior = 0
    } else if (enCuenta.estado === "ok") {
      if (local.mismaMemoria(enCuenta.memoria, enCompu.memoria)) {
        mostrado = null
        return `La cuenta ya tiene la misma memoria que esta compu. No hizo falta subir nada.\n\n${decirMemoria(enCompu.memoria)}`
      }
      const eraLoMostrado = esLoMostrado("subir", enCuenta.version, enCompu.memoria)
      if (!reemplazar || !eraLoMostrado) {
        return mostrarLasDos("subir", enCuenta.version, enCuenta.memoria, enCompu.memoria, reemplazar && mostrado !== null && !eraLoMostrado)
      }
      versionAnterior = enCuenta.version
    } else if (enCuenta.estado === "esquema-desconocido") {
      return "La memoria de la cuenta está en un formato más nuevo que el que conoce esta versión de Tecnia Bot. No la piso: actualizá Tecnia Bot y probá de nuevo. No subí nada."
    } else {
      return `No pude leer la memoria de la cuenta: ${decirFalla(enCuenta)}. No subí nada.`
    }

    const guardado = await remota.guardarMemoriaRemota(listo.conSesion, enCompu.memoria, versionAnterior)
    mostrado = null
    if (guardado.estado === "guardado") {
      return `Guardé en la cuenta la memoria de esta compu; la plataforma lo confirmó.\n\n${decirMemoria(enCompu.memoria)}`
    }
    if (guardado.estado === "conflicto") {
      return "Justo mientras subía, otra compu guardó una memoria en la cuenta. NO la pisé. Repetí 'subir' para ver cómo quedó y que el docente elija."
    }
    if (guardado.estado === "no-cabe") return `La plataforma no aceptó la memoria: se pasa ${NOMBRE_DE_CAMPO[guardado.campo]}. No se guardó nada.`
    return `No pude guardar la memoria en la cuenta: ${decirFalla(guardado)}. No doy nada por guardado.`
  }

  async function traer(reemplazar: boolean): Promise<string> {
    const listo = preparar()
    if ("no" in listo) return listo.no

    const enCuenta = await remota.leerMemoriaRemota(listo.conSesion)
    if (enCuenta.estado === "vacia") return "En la cuenta todavía no hay ninguna memoria guardada, así que no hay nada para traer. No toqué la memoria de esta compu."
    if (enCuenta.estado === "esquema-desconocido") {
      return "La memoria de la cuenta está en un formato más nuevo que el que conoce esta versión de Tecnia Bot. Actualizá Tecnia Bot y probá de nuevo. No toqué la memoria de esta compu."
    }
    if (enCuenta.estado !== "ok") return `No pude leer la memoria de la cuenta: ${decirFalla(enCuenta)}. No toqué la memoria de esta compu.`

    const enCompu = local.leerMemoriaLocal(deps.carpeta)
    if (enCompu.estado === "ilegible") {
      return `En esta compu hay un archivo de memoria que no puedo leer (${enCompu.ruta}). No lo piso sin saber qué tiene. No traje nada.`
    }
    if (enCompu.estado === "ok") {
      if (local.mismaMemoria(enCuenta.memoria, enCompu.memoria)) {
        mostrado = null
        return `Esta compu ya tiene la misma memoria que la cuenta. No hizo falta traer nada.\n\n${decirMemoria(enCompu.memoria)}`
      }
      const eraLoMostrado = esLoMostrado("traer", enCuenta.version, enCompu.memoria)
      if (!reemplazar || !eraLoMostrado) {
        return mostrarLasDos("traer", enCuenta.version, enCuenta.memoria, enCompu.memoria, reemplazar && mostrado !== null && !eraLoMostrado)
      }
    }

    const escrito = local.escribirMemoriaLocal(deps.carpeta, enCuenta.memoria)
    mostrado = null
    if (escrito.estado !== "escrita") {
      return `No pude dejar en esta compu la memoria de la cuenta (${escrito.ruta}): la escribí, la releí y no coincide, o no se pudo escribir. Revisá ese archivo antes de seguir.`
    }
    return (
      `Traje a esta compu la memoria de la cuenta; la releí del disco y coincide.\n\n${decirMemoria(enCuenta.memoria)}\n\n` +
      `Usá ESTA memoria de acá en adelante: la que tenías cargada al empezar la sesión quedó vieja.`
    )
  }

  return { subir, traer }
}
