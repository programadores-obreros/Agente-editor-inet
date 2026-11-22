import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Falla, FetchLike } from "./api.ts"
import * as sesion from "./sesion-local.ts"
import { crearSincronizador } from "./sincronizar.ts"
import * as vuelta from "./servidor-vuelta.ts"
import type { ServidorDeVuelta } from "./servidor-vuelta.ts"
import * as vinculo from "./vinculo.ts"
import type { Intento } from "./vinculo.ts"

/**
 * VINCULAR TECNIA BOT CON LA CUENTA DEL DOCENTE EN LA PLATAFORMA TECNIA LAB.
 *
 * PARA QUÉ. La memoria del bot es de la compu (`memoria.ts`), no de la persona.
 * El docente que trabaja en su casa, en la escuela y en otra notebook arranca de
 * cero cada vez. Vinculando el bot con su cuenta de la plataforma, su memoria
 * puede viajar con él. Este archivo sólo hace el vínculo: ver si hay cuenta
 * vinculada, vincular y cerrar sesión. Llevar y traer la memoria está en
 * `sincronizar.ts`; acá sólo se reparten las acciones `subir` y `traer`.
 *
 * EL TOOL ES UN ENVOLTORIO. Acá está toda la lógica; `opencode/tool/cuenta.ts`
 * sólo le pasa lo que existe dentro de OpenCode (variables de entorno, nombre de
 * la compu, cómo abrir el navegador). Así esto se prueba entero bajo Node, sin Bun.
 *
 * CÓMO SE VINCULA. Por el navegador, nunca tipeando la contraseña en el chat: lo
 * que se escribe acá viaja al modelo. El bot abre la plataforma, el docente entra
 * como siempre, escribe el código de seis dígitos que le mostró el bot y confirma,
 * y el navegador vuelve a esta compu con un código de canje que el bot cambia por
 * un token. El código de seis dígitos es lo que prueba que el pedido salió de ESTE
 * bot y no de otro programa de la compu (ver `vinculo.ts`): por eso sólo se
 * muestra acá, en lo que devuelve `vincular`, y nunca va en el enlace. Ese token sólo sirve para la API del bot: no abre
 * el perfil del docente ni sus datos (ver `api.ts`).
 *
 * `vincular` NO ESPERA. Abre el navegador y devuelve enseguida; el resto pasa en
 * segundo plano, dentro del proceso de OpenCode. Esperar adentro del tool dejaría
 * al docente mirando una pantalla quieta, y si el navegador no se abrió no habría
 * forma de mostrarle el enlace. Por eso `vincular` nunca dice «vinculado»: lo
 * dice `estado`, y sólo después de preguntarle a la plataforma.
 *
 * TRES REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO:
 *
 * 1. NADA SE AFIRMA SIN COMPROBARLO. «Vinculado» sale de una respuesta de la
 *    plataforma, no de que exista un archivo. Si no se pudo preguntar, se dice
 *    que hay una sesión guardada y que no se pudo confirmar. Al cerrar, se dice
 *    por separado qué pasó en la plataforma y qué pasó en esta compu: si no hubo
 *    conexión, la sesión sigue abierta del otro lado y el docente tiene que
 *    saberlo.
 *
 * 2. EL TOKEN NO SE IMPRIME NUNCA, y del email sólo se muestra una parte. Lo que
 *    devuelve este tool lo lee el modelo y termina en el chat, que el docente
 *    copia y pega cuando pide ayuda.
 *
 * 3. EN MODO AULA NO SE VINCULA. La compu del aula la comparten muchos chicos:
 *    una cuenta de docente vinculada ahí queda al alcance del que se siente
 *    después.
 *
 * SIN DIRECCIÓN, ESTÁ APAGADO. Acá no hay valor por defecto: si no se le pasan
 * las dos, o alguna no es segura (ver `direccionSegura`), contesta que la función
 * no está disponible y no hace nada más. Las direcciones de producción y la regla
 * de cuándo se usan viven en el tool (`opencode/tool/cuenta.ts`, `direccionesDe`),
 * que es quien decide qué se le pasa a esto. `VARIABLE_API` y `VARIABLE_WEB` son
 * los nombres de las variables de entorno con las que se pisan en pruebas.
 */

export interface DependenciasCuenta {
  fetch: FetchLike
  /** URL base de la API del bot. Sin esto, el tool está apagado. */
  api: string | undefined
  /** URL de la plataforma web, donde está la página de vincular. */
  web: string | undefined
  /** Carpeta de configuración de OpenCode: ahí están el perfil y la sesión. */
  carpeta: string
  /** Nombre de esta compu, para que el docente la reconozca en su perfil web. */
  etiqueta: string
  abrirNavegador: (url: string) => boolean
  /** Cuánto se espera la vuelta del navegador, en milisegundos. */
  esperaMs?: number
}

export const VARIABLE_API = "TECNIA_PLATAFORMA_API"
export const VARIABLE_WEB = "TECNIA_PLATAFORMA_WEB"

const NO_DISPONIBLE = "Vincular la cuenta de Tecnia Lab todavía no está disponible en esta versión de Tecnia Bot."

/**
 * Una dirección sirve si es https, o http sólo contra esta misma compu (el
 * emulador). Por http a otra máquina el token viajaría sin cifrar.
 */
export function direccionSegura(direccion: string | undefined): string | null {
  if (!direccion) return null
  let url: URL
  try {
    url = new URL(direccion)
  } catch {
    return null
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null
  return direccion.replace(/\/+$/, "")
}

/** Muestra del email sólo la inicial y el dominio: alcanza para reconocer la cuenta. */
export function emailParcial(email: string): string {
  const arroba = email.lastIndexOf("@")
  if (arroba < 1) return "…"
  return `${email[0]}…${email.slice(arroba)}`
}

function decirCuenta(cuenta: { nombre: string; email: string }): string {
  const nombre = cuenta.nombre.trim()
  return nombre ? `${nombre} (${emailParcial(cuenta.email)})` : emailParcial(cuenta.email)
}

function decirFalla(falla: Falla): string {
  switch (falla.estado) {
    case "sin-conexion":
      return `no pude comunicarme con la plataforma (${falla.detalle})`
    case "sesion-invalida":
      return "la plataforma no reconoce la sesión"
    case "demasiados-pedidos":
      return "la plataforma pidió esperar un momento antes de volver a intentar"
    case "respuesta-invalida":
      return "la plataforma contestó algo que no entiendo"
    case "error":
      return `la plataforma devolvió un error (${falla.detalle})`
  }
}

/** Ver el comentario largo de la misma función en opencode/tool/perfil.ts: es una copia. */
function normalizarModo(crudo: string): string {
  const limpio = crudo.trim()
  const m = limpio.toLowerCase().match(/^(aula|grupo|personal)(?![a-záéíóúñ])/)
  return m ? m[1]! : limpio
}

/** Lee el modo del perfil de esta compu. Mismo archivo y mismo renglón que escribe `perfil.ts`. */
function modoDelPerfil(carpeta: string): string {
  const ruta = join(carpeta, "tecnia-perfil.md")
  if (!existsSync(ruta)) return ""
  try {
    return normalizarModo(readFileSync(ruta, "utf8").match(/^-\s*Modo:\s*(.*)$/m)?.[1] ?? "")
  } catch {
    return ""
  }
}

/** Cómo terminó el recorrido en segundo plano: lo cancelaron, o llegó hasta el final (bien o mal). */
type FinDelVinculo = "cancelado" | "terminado"

interface IntentoEnCurso {
  url: string
  /** Los seis dígitos que el docente tiene que escribir en la página. */
  codigo: string
  seAbrio: boolean
  flujo: Promise<FinDelVinculo>
  cancelar: () => void
}

export type Accion = "estado" | "vincular" | "cerrar" | "subir" | "traer"

export interface Opciones {
  /** Sólo para `subir` y `traer`: el docente ya vio las dos memorias y eligió pisar. */
  reemplazar?: boolean
}

export function crearCuenta(deps: DependenciasCuenta): { ejecutar(accion: Accion, opciones?: Opciones): Promise<string> } {
  const api = direccionSegura(deps.api)
  const web = direccionSegura(deps.web)

  // Uno solo por cuenta: recuerda qué memorias le mostró al docente antes de reemplazar.
  const sincronizador = api ? crearSincronizador({ fetch: deps.fetch, api, carpeta: deps.carpeta }) : null

  let enCurso: IntentoEnCurso | null = null
  /** Por qué falló el último intento. Se dice una vez, en el próximo `estado`. */
  let ultimoFallo: string | null = null

  function decirEspera(intento: IntentoEnCurso): string {
    const comoAbrir = intento.seAbrio
      ? "Abrí el navegador en la plataforma."
      : "No pude abrir el navegador solo. Hay que abrir este enlace a mano, en esta misma compu:"
    // En una Windows recién estrenada, Edge abre primero su bienvenida a pantalla
    // completa y la página de vincular queda detrás (visto en la VM win11 el
    // 21/11/2026). El docente cree que no se abrió nada. Sólo se dice cuando el
    // navegador se abrió: si no, no hay ninguna ventana que mirar.
    const bienvenida = intento.seAbrio
      ? `Si el navegador muestra primero una pantalla de bienvenida (pasa en una compu recién estrenada), hay que pasarla: la página de vincular está en esa misma ventana.\n`
      : ""
    return (
      `${comoAbrir}\n${intento.url}\n\n${bienvenida}` +
      `Ahí el docente entra con su cuenta de Tecnia Lab. La contraseña se escribe en el navegador, NUNCA en este chat.\n` +
      `La página le va a pedir un código. Es este: ${vinculo.codigoParaMostrar(intento.codigo)}\n` +
      `Ese código se escribe sólo en esa página, y sólo porque el docente acaba de pedir vincular desde este chat. Si una página pide un código sin que él lo haya pedido acá, no hay que escribir nada: hay que cerrarla.\n` +
      `TODAVÍA NO ESTÁ VINCULADO. Cuando el docente diga que confirmó, usá la acción 'estado' para comprobarlo.`
    )
  }

  async function seguirVinculo(
    servidor: ServidorDeVuelta,
    intento: Intento,
    base: string,
  ): Promise<FinDelVinculo> {
    const llegada = await servidor.vuelta
    if (llegada.estado === "cancelada") return "cancelado"
    if (llegada.estado === "sin-respuesta") {
      ultimoFallo = "El último intento de vincular venció: nadie confirmó en el navegador a tiempo."
      return "terminado"
    }
    const canje = await vinculo.canjearVinculo({ fetch: deps.fetch, base }, llegada.code, intento, deps.etiqueta)
    if (canje.estado === "codigo-invalido") {
      ultimoFallo = "El último intento de vincular no sirvió: la plataforma lo rechazó. Lo más probable es que el código escrito en la página no fuera el que mostré acá, o que se haya tardado demasiado. Hay que vincular de nuevo: va a salir un código distinto."
      return "terminado"
    }
    if (canje.estado !== "vinculado") {
      ultimoFallo = `El último intento de vincular falló: ${decirFalla(canje)}.`
      return "terminado"
    }
    const guardado = sesion.guardarSesionLocal({ token: canje.token, cuenta: canje.cuenta, base }, deps.carpeta)
    if (guardado.estado === "guardada") return "terminado"

    // La plataforma ya abrió la sesión y acá no se pudo guardar: quedaría una
    // sesión viva que esta compu no puede usar ni cerrar más adelante. Se intenta
    // cerrarla ahora, con el token que todavía está en memoria.
    const cierre = await vinculo.cerrarSesion({ fetch: deps.fetch, base, token: async () => canje.token })
    const resto =
      cierre.estado === "cerrada"
        ? "La sesión que se había abierto en la plataforma ya la cerré."
        : "Y no pude cerrar la sesión que se abrió en la plataforma: el docente tiene que cerrarla desde su perfil en la web."
    ultimoFallo = `El último intento de vincular falló: no pude guardar la sesión en esta compu (${guardado.ruta}). ${resto}`
    return "terminado"
  }

  async function estado(): Promise<string> {
    if (enCurso) {
      // Si el docente acaba de confirmar, el canje puede estar terminando: se le da un momento.
      const pausa = new Promise<void>((resolver) => {
        setTimeout(resolver, 2_000).unref()
      })
      await Promise.race([enCurso.flujo, pausa])
    }
    if (enCurso) return `Sigo esperando que el docente confirme en el navegador.\n\n${decirEspera(enCurso)}`

    const aviso = ultimoFallo ? `${ultimoFallo}\n\n` : ""
    ultimoFallo = null

    const local = sesion.leerSesionGuardada(deps.carpeta)
    if (local.estado === "sin-sesion") return `${aviso}No hay ninguna cuenta de Tecnia Lab vinculada en esta compu.`
    if (local.estado === "ilegible") {
      return `${aviso}Hay un archivo de sesión en esta compu pero no lo puedo leer (${local.ruta}). Usá la acción 'cerrar' para borrarlo y después vinculá de nuevo.`
    }
    if (local.sesion.base !== api) {
      return `${aviso}Hay una sesión guardada en esta compu, pero es de otra dirección de la plataforma y no la uso. Usá la acción 'cerrar' y después vinculá de nuevo.`
    }

    const cuenta = decirCuenta(local.sesion.cuenta)
    const remota = await vinculo.leerSesion({ fetch: deps.fetch, base: local.sesion.base, token: async () => local.sesion.token })
    if (remota.estado === "ok") {
      return `${aviso}Tecnia Bot está vinculado con la cuenta de ${decirCuenta(remota.cuenta)}. Lo confirmé recién con la plataforma.`
    }
    if (remota.estado === "sesion-invalida") {
      const borrado = sesion.borrarSesionGuardada(deps.carpeta)
      const local2 = borrado.estado === "sin-sesion" ? "La borré de esta compu." : `No pude borrarla de esta compu (${borrado.ruta}).`
      return `${aviso}Había una sesión de ${cuenta}, pero la plataforma ya no la reconoce (venció o se cerró desde la web). ${local2} Hay que vincular de nuevo.`
    }
    return `${aviso}En esta compu hay una sesión guardada de ${cuenta}, pero NO pude confirmarla: ${decirFalla(remota)}. No sé si sigue vigente.`
  }

  async function vincular(base: string, plataforma: string): Promise<string> {
    if (modoDelPerfil(deps.carpeta) === "aula") {
      return "Esta compu está en modo aula: la comparten muchos chicos, así que acá no se vincula ninguna cuenta. La cuenta del docente se vincula en su propia compu."
    }
    if (enCurso) return `Ya hay un vínculo en curso.\n\n${decirEspera(enCurso)}`

    const local = sesion.leerSesionGuardada(deps.carpeta)
    if (local.estado !== "sin-sesion") {
      return "En esta compu ya hay una sesión guardada. Usá la acción 'estado' para ver de quién es, o 'cerrar' para cerrarla antes de vincular otra cuenta."
    }

    const intento = vinculo.crearIntento()
    const abierto = await vuelta.abrirServidorDeVuelta(intento, deps.esperaMs)
    if (abierto.estado !== "escuchando") {
      return "No pude preparar esta compu para recibir la respuesta de la plataforma (no se pudo abrir un puerto local). No se vinculó nada."
    }
    const url = vinculo.urlDeVinculo(plataforma, intento, abierto.servidor.puerto)
    if (!url) {
      abierto.servidor.cancelar()
      return "No pude armar el enlace para vincular. No se vinculó nada."
    }

    ultimoFallo = null
    const nuevo: IntentoEnCurso = {
      url,
      codigo: intento.codigo,
      seAbrio: deps.abrirNavegador(url),
      cancelar: abierto.servidor.cancelar,
      flujo: seguirVinculo(abierto.servidor, intento, base)
        .catch((): FinDelVinculo => {
          // El detalle del error no se guarda: podría traer el token.
          ultimoFallo = "El último intento de vincular falló por un error inesperado."
          return "terminado"
        })
        .finally(() => {
          if (enCurso === nuevo) enCurso = null
        }),
    }
    enCurso = nuevo
    return decirEspera(nuevo)
  }

  async function cerrar(): Promise<string> {
    let cancelado = ""
    if (enCurso) {
      // Cancelar sólo corta la espera del navegador. Si el docente ya había
      // confirmado, el canje sigue hasta el final y la sesión que abrió se cierra
      // más abajo, como cualquier otra: decir «cancelé» ahí sería mentira.
      enCurso.cancelar()
      if ((await enCurso.flujo) === "cancelado") cancelado = "Cancelé el vínculo que estaba en curso. "
    }
    ultimoFallo = null

    const local = sesion.leerSesionGuardada(deps.carpeta)
    if (local.estado === "sin-sesion") return `${cancelado}No había ninguna cuenta vinculada en esta compu.`

    // En la plataforma: sólo se intenta si el token es para esta dirección. Un
    // token no se manda a otra dirección que aquella contra la que se obtuvo.
    let enPlataforma: string
    if (local.estado === "ilegible") {
      enPlataforma = "El archivo de sesión no se podía leer, así que no pude avisarle a la plataforma: si había una sesión, sigue abierta de su lado."
    } else if (local.sesion.base !== api) {
      enPlataforma = "La sesión era de otra dirección de la plataforma, así que no le avisé: si sigue abierta, hay que cerrarla desde el perfil en la web."
    } else {
      const cierre = await vinculo.cerrarSesion({ fetch: deps.fetch, base: local.sesion.base, token: async () => local.sesion.token })
      if (cierre.estado === "cerrada") enPlataforma = "La plataforma confirmó que cerró la sesión."
      else if (cierre.estado === "sesion-invalida") enPlataforma = "La plataforma ya no reconocía esa sesión (estaba vencida o cerrada)."
      else {
        enPlataforma = `NO pude cerrar la sesión en la plataforma: ${decirFalla(cierre)}. Sigue abierta de su lado: el docente tiene que cerrarla desde su perfil en la web.`
      }
    }

    const borrado = sesion.borrarSesionGuardada(deps.carpeta)
    const enCompu =
      borrado.estado === "sin-sesion"
        ? "En esta compu ya no queda ninguna sesión guardada."
        : `NO pude borrar la sesión de esta compu (${borrado.ruta}): sigue ahí.`
    // Lo que el docente no ve desde acá: cerrar sesión no toca la memoria que haya
    // guardado en la cuenta. En la primera prueba en Windows (21/11/2026) quien
    // probaba cerró la sesión, vio la memoria todavía en su perfil web y dudó de si
    // el cierre había andado. Se dice siempre que hubo una sesión, sin preguntarle a
    // la plataforma si hay memoria: sería un pedido más con un token que se acaba de cerrar.
    const memoria =
      "Cerrar la sesión no borra la memoria guardada en la cuenta: si el docente guardó alguna, sigue ahí, y se borra desde su perfil en la plataforma, pestaña «Tecnia Bot»."
    return `${cancelado}${enPlataforma} ${enCompu} ${memoria}`
  }

  return {
    async ejecutar(accion: Accion, opciones: Opciones = {}): Promise<string> {
      if (!api || !web || !sincronizador) return NO_DISPONIBLE
      if (accion === "subir") return sincronizador.subir(opciones.reemplazar === true)
      if (accion === "traer") return sincronizador.traer(opciones.reemplazar === true)
      if (accion === "vincular") return vincular(api, web)
      if (accion === "cerrar") return cerrar()
      return estado()
    },
  }
}
