/// <reference path="../env.d.ts" />
// Tool "cuenta" — vincular Tecnia Bot con la cuenta del docente en la plataforma Tecnia Lab.
//
// Este archivo es sólo el envoltorio. Toda la lógica, sus reglas y sus porqués
// están en `opencode/plataforma/cuenta.ts`; acá se le dan las cosas que sólo
// existen dentro de OpenCode: las variables de entorno, el nombre de la compu y
// cómo abrir el navegador.
//
// LAS DOS DIRECCIONES VIENEN PUESTAS. Sin configurar nada, el tool habla con la
// plataforma de producción (`API_POR_DEFECTO`, `WEB_POR_DEFECTO`). Las variables
// `TECNIA_PLATAFORMA_API` y `TECNIA_PLATAFORMA_WEB` quedan sólo para pisarlas en
// pruebas (el emulador), y van LAS DOS O NINGUNA: con una sola el tool no hace
// nada y dice cuál falta. Ver `direccionesDe`.
//
// Antes era al revés: sin las dos variables el tool estaba apagado, porque la
// plataforma no estaba publicada. Se cambió cuando se publicó, por tres motivos
// que salieron de la auditoría del instalador de Windows: una variable de
// usuario la tiene que escribir el instalador, sobrevive a la desinstalación, y
// si queda una sola de las dos la función se apagaba sin que nadie supiera por qué.

import { tool } from "@opencode-ai/plugin"
import { hostname } from "node:os"

type ModuloCuenta = typeof import("../plataforma/cuenta.ts")
type ModuloSesion = typeof import("../plataforma/sesion-local.ts")
type ModuloNavegador = typeof import("../plataforma/navegador.ts")
type Cuenta = ReturnType<ModuloCuenta["crearCuenta"]>
type Accion = Parameters<Cuenta["ejecutar"]>[0]

// Los nombres están repetidos acá a propósito: leerlos de `plataforma/cuenta.ts`
// obligaría a cargar la carpeta antes de saber si el tool está prendido.
// `tests/tool-cuenta.test.mjs` comprueba que coinciden con los de allá.
export const VARIABLE_API = "TECNIA_PLATAFORMA_API"
export const VARIABLE_WEB = "TECNIA_PLATAFORMA_WEB"

/** La plataforma publicada. Cambiarlas obliga a publicar una versión nueva de Tecnia Bot. */
export const API_POR_DEFECTO = "https://southamerica-east1-sgi-cenet-prod.cloudfunctions.net/botApi"
export const WEB_POR_DEFECTO = "https://plataforma.tecnialab.net.ar"

export type Direcciones =
  | { estado: "ok"; api: string; web: string }
  /** Está definida una sola de las dos variables. `falta` es el nombre de la otra. */
  | { estado: "a-medias"; definida: string; falta: string }

/**
 * De dónde salen las dos direcciones. Ninguna variable: producción. Las dos: las
 * de las variables. Una sola: NO se completa con la de producción.
 *
 * Por qué no se completa: mezclar es peor que no andar. Con la API del emulador
 * y la web de producción, el docente confirmaría en la plataforma real un
 * vínculo que después se canjea contra otra máquina.
 *
 * Una variable vacía o con sólo espacios cuenta como no definida.
 */
export function direccionesDe(env: Record<string, string | undefined>): Direcciones {
  const api = env[VARIABLE_API]?.trim() || undefined
  const web = env[VARIABLE_WEB]?.trim() || undefined
  if (api === undefined && web === undefined) return { estado: "ok", api: API_POR_DEFECTO, web: WEB_POR_DEFECTO }
  if (api === undefined) return { estado: "a-medias", definida: VARIABLE_WEB, falta: VARIABLE_API }
  if (web === undefined) return { estado: "a-medias", definida: VARIABLE_API, falta: VARIABLE_WEB }
  return { estado: "ok", api, web }
}

export function decirAMedias(d: { definida: string; falta: string }): string {
  return (
    `Tecnia Bot está mal configurado para la cuenta de Tecnia Lab: está definida la variable ${d.definida} pero falta ${d.falta}. ` +
    `Tienen que estar las dos o ninguna. No hice nada.`
  )
}

/**
 * Lanza el comando que arma `plataforma/navegador.ts`. El comando NO se arma acá:
 * en Windows un intérprete en el medio partía el enlace en cada `&` (ver ese archivo).
 */
function abrirEnNavegador(navegador: ModuloNavegador, url: string): boolean {
  try {
    const cmd = navegador.comandoParaAbrir(process.platform, url, process.env.SystemRoot)
    if (!cmd) return false
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    proc.unref()
    return true
  } catch {
    // Si no se pudo abrir, `vincular` le muestra el enlace al docente para que lo abra a mano.
    return false
  }
}

// Import perezoso (mismo criterio que `programa.ts`): si falta la carpeta en la
// instalación, sólo este tool se entera, y recién cuando se usa.
async function cargarModulos(): Promise<{ cuenta: ModuloCuenta; sesion: ModuloSesion; navegador: ModuloNavegador }> {
  try {
    const [cuenta, sesion, navegador] = await Promise.all([
      import("../plataforma/cuenta.ts"),
      import("../plataforma/sesion-local.ts"),
      import("../plataforma/navegador.ts"),
    ])
    return { cuenta, sesion, navegador }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Falta la carpeta "plataforma" de Tecnia Bot junto a esta tool (no se pudo cargar: ${detalle}). ` +
        `Reinstalá Tecnia Bot (o corré "Reparar Tecnia Bot" desde el menú inicio en Windows) para arreglarlo.`,
    )
  }
}

// Una sola instancia por proceso: el vínculo en curso vive entre una llamada y la
// siguiente (`vincular` devuelve enseguida y el canje pasa en segundo plano).
//
// Va atada a las direcciones con las que se creó: si cambiaran (sólo pasa en las
// pruebas), se arma otra en vez de seguir hablando con la dirección anterior.
let instancia: Promise<Cuenta> | null = null
let instanciaDe = ""

function obtenerCuenta(api: string, web: string): Promise<Cuenta> {
  const clave = `${api}\n${web}`
  if (instancia && instanciaDe === clave) return instancia
  instanciaDe = clave
  const nueva = cargarModulos().then(({ cuenta, sesion, navegador }) =>
    cuenta.crearCuenta({
      fetch: (url, init) => fetch(url, init),
      api,
      web,
      carpeta: sesion.carpetaPorDefecto(),
      etiqueta: hostname(),
      abrirNavegador: (url) => abrirEnNavegador(navegador, url),
    }),
  )
  instancia = nueva
  // Si la carga falló, la próxima llamada vuelve a intentar en vez de quedarse con el error.
  nueva.catch(() => {
    if (instancia === nueva) instancia = null
  })
  return nueva
}

export default tool({
  description: `Cuenta de Tecnia Lab del DOCENTE vinculada a Tecnia Bot en esta compu. Sirve para que el docente (un adulto, con su cuenta de la plataforma Tecnia Lab) vincule el bot con su cuenta. NO es para alumnos, y en modo aula no vincula.

NUNCA le pidas al docente su contraseña ni su email en el chat: se vincula por el navegador.

Acciones:
- estado: dice si hay una cuenta vinculada y de quién es, preguntándole a la plataforma. Es la ÚNICA acción que puede confirmar que el vínculo quedó hecho.
- vincular: abre el navegador en la plataforma para que el docente entre, escriba el código de seis dígitos que devuelve esta acción y confirme. Mostrale ese código tal cual. Devuelve enseguida y TODAVÍA NO está vinculado: cuando el docente diga que confirmó, llamá a 'estado'. No digas que quedó vinculado hasta que 'estado' lo diga.
- cerrar: cierra la sesión en la plataforma y la borra de esta compu. Leé bien lo que devuelve: dice por separado qué pasó en la plataforma y qué pasó en la compu.
- subir: guarda en la cuenta la memoria de progreso de ESTA compu. Sólo cuando el docente lo pide ("guardá mi memoria en mi cuenta").
- traer: deja en esta compu la memoria guardada en la cuenta. Sólo cuando el docente lo pide ("traé mi memoria").

'subir' y 'traer' REEMPLAZAN, no mezclan. Si en la cuenta y en la compu hay memorias distintas, la primera llamada NO cambia nada: devuelve las dos. Mostráselas al docente, preguntale cuál quiere, y recién con su respuesta repetí la acción con reemplazar en true. NUNCA mandes reemplazar en true en la primera llamada ni sin que el docente haya elegido.

Repetile al docente lo que devuelve el tool tal como viene, sin agregar que algo salió bien si el tool no lo dijo.`,
  args: {
    accion: tool.schema
      .enum(["estado", "vincular", "cerrar", "subir", "traer"])
      .describe("'estado' para ver si hay cuenta vinculada; 'vincular' para empezar el vínculo por el navegador; 'cerrar' para cerrar sesión; 'subir' para guardar en la cuenta la memoria de esta compu; 'traer' para dejar en esta compu la memoria de la cuenta."),
    reemplazar: tool.schema
      .boolean()
      .optional()
      .describe("Sólo para 'subir' y 'traer', y sólo DESPUÉS de que el tool mostró dos memorias distintas y el docente eligió con cuál quedarse. Nunca en la primera llamada."),
  },
  async execute(args) {
    // Antes de cargar nada: una configuración a medias no llega a tocar la carpeta ni la red.
    const direcciones = direccionesDe(process.env)
    if (direcciones.estado === "a-medias") return decirAMedias(direcciones)
    let cuenta: Cuenta
    try {
      cuenta = await obtenerCuenta(direcciones.api, direcciones.web)
    } catch (error) {
      // Acá sólo puede fallar la carga de la carpeta: ese mensaje sí se muestra.
      return error instanceof Error ? error.message : "No pude cargar la cuenta de Tecnia Lab."
    }
    try {
      return await cuenta.ejecutar(args.accion as Accion, { reemplazar: args.reemplazar === true })
    } catch {
      // El detalle no se muestra: un error de acá adentro podría traer el token.
      return "No pude completar la acción por un error inesperado. No doy nada por hecho: usá la acción 'estado' para ver cómo quedó."
    }
  },
})
