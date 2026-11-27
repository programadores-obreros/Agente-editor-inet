// Cliente HTTP de la vista — Phase 3, vertical #2 (T6). Extraído de app.js SIN cambiar su comportamiento:
// el POST de un sobre firmado + el manejo común de la respuesta (GPIO, frase y vista lógica comparten
// este camino). Nunca es optimista: SIEMPRE repinta desde un snapshot que ya vino del servidor. Todo lo
// que toca el mundo (fetch, estado de la página, texto de estado) se INYECTA, así que se prueba en Node.

/** Mensajes MÍNIMOS a partir de los códigos de motivo — nunca se inventa una causa
 * que `nucleo/motivos.ts` no produjo (PHASE_2_SLICE_1_DESIGN.md §2.8/§2.9). */
export function descripcionDeMotivos(motivos) {
  if (!motivos || motivos.length === 0) return "rechazado"
  return motivos.map((m) => m.codigo).join(", ")
}

/** El token de la sesión viene en el fragmento de la dirección (`#t=...`), que es como la tool le
 * pasa la página al navegador: el fragmento no viaja al servidor ni queda en un `Referer`.
 * `null` si la dirección no lo trae (alguien abrió la dirección pelada). */
export function tokenDeLaDireccion(fragmento) {
  const hallado = /(?:^#|&)t=([A-Za-z0-9_-]+)(?:&|$)/.exec(typeof fragmento === "string" ? fragmento : "")
  return hallado ? hallado[1] : null
}

/** Con qué nombre se guarda la llave en la pestaña. */
export const CLAVE_DE_LA_LLAVE = "tecnia-llave-de-la-sesion"

/**
 * La llave de la sesión de ESTA pestaña: la de la dirección si la trae y, si no, la que la pestaña
 * ya había recibido antes.
 *
 * POR QUÉ (2026-11-27). La llave vivía sólo en el fragmento de la dirección (`#t=…`), «para que
 * recargar no la pierda». Pero los enlaces de la propia página (el menú de arriba: «Mirá cómo se
 * conecta», «Decidí qué hace»…) también son fragmentos: un clic deja la dirección en
 * `#paso-reglas` y la llave ya no está. Mientras no se recarga, todo sigue andando (se leyó al
 * cargar); después de F5, cambiar una regla da 403 y la página dice que «se abrió sin la llave».
 * Reproducido en Chromium: abrir, tocar «Decidí qué hace», recargar, cambiar una regla → 403.
 * Lo encontró el especialista de calidad al revisar los enlaces nuevos del vínculo; los del menú
 * lo tenían desde el rediseño de la ventana.
 *
 * `almacen` es el `sessionStorage` de la pestaña (se inyecta). Si no está o tira (modo privado
 * estricto), vale lo de antes: la llave de la dirección, o ninguna.
 *
 * QUÉ CAMBIA PARA QUIEN PUEDE LEER LA LLAVE (corregido tras la revisión independiente; la primera
 * versión de este comentario decía «no amplía quién puede leerla», y no es exacto):
 *   - antes, después de un enlace del menú, la llave quedaba sólo en la memoria de la página y en
 *     el historial del navegador;
 *   - ahora, además, la puede leer cualquier script de este MISMO origen mientras viva la pestaña;
 *     una pestaña duplicada hereda una copia, y el navegador puede conservarla para restaurar la
 *     sesión (esto último no se comprobó).
 * El riesgo es bajo, no nulo: este origen (`127.0.0.1:<puerto>`) sólo sirve esta página, archivos
 * de una lista blanca y JSON con `nosniff`, y la política de la página es `script-src 'self'`.
 *
 * La de la dirección GANA siempre y pisa la guardada: Tecnia Bot abre la vista con la llave de la
 * sesión nueva, y una guardada de una sesión anterior no tiene que taparla. Si no se la puede
 * guardar, se intenta al menos sacar la que había: que no quede una vieja para la próxima recarga.
 */
export function llaveDeLaSesion(fragmento, almacen) {
  const deLaDireccion = tokenDeLaDireccion(fragmento)
  if (deLaDireccion !== null) {
    try {
      almacen?.setItem(CLAVE_DE_LA_LLAVE, deLaDireccion)
    } catch {
      try {
        almacen?.removeItem?.(CLAVE_DE_LA_LLAVE)
      } catch {
        /* tampoco se pudo sacar: la llave de la dirección vale igual para esta carga */
      }
    }
    return deLaDireccion
  }
  try {
    const guardada = almacen?.getItem(CLAVE_DE_LA_LLAVE)
    // Lo guardado es un dato, no se manda cualquier cosa en un header: misma forma que en la
    // dirección, tal cual (sin recortarle espacios) y con un tope de largo (una llave mide unos 43).
    return typeof guardada === "string" && FORMA_DE_LLAVE_GUARDADA.test(guardada) ? guardada : null
  } catch {
    return null
  }
}
const FORMA_DE_LLAVE_GUARDADA = /^[A-Za-z0-9_-]{1,200}$/

/**
 * La llave de esta pestaña, desde la ventana real: su dirección y su almacén. Existe para que el
 * camino ENTERO se pueda ejecutar en una prueba con una ventana de mentira; antes vivía repartido
 * en `app.js` y sólo se lo miraba como texto. El almacén se pide con cuidado: hay navegadores que
 * tiran con sólo nombrarlo.
 */
export function llaveDeEstaPestana(ventana) {
  let almacen = null
  try {
    almacen = ventana?.sessionStorage ?? null
  } catch {
    almacen = null
  }
  return llaveDeLaSesion(ventana?.location?.hash, almacen)
}

export const SIN_PERMISO = "Esta pestaña no puede cambiar el proyecto: se abrió sin la llave de la sesión. Pedile a Tecnia Bot que abra la vista de nuevo."
/** Se mandó una llave y el servidor dijo que no vale: casi siempre, Tecnia Bot se reinició y la
 * pestaña quedó con la de la sesión anterior. Antes decía «se abrió sin la llave», que acá es
 * falso. No afirma POR QUÉ no vale (eso el navegador no lo sabe): dice lo que pasó y lo más
 * probable, como posibilidad. TEXTO PENDIENTE DE QUE EL DUEÑO LO VEA. */
export const LLAVE_QUE_YA_NO_VALE = "Esta pestaña no puede cambiar el proyecto: Tecnia Bot no reconoce su llave (puede ser de una sesión anterior). Pedile a Tecnia Bot que abra la vista de nuevo."

/**
 * @param {{ fetch: Function, aplicarSnapshot: (snapshot: object) => void, repintar: () => void,
 *   mostrarEstado: (texto: string | null) => void, token?: string | null | (() => string | null) }} dependencias
 *   `token` puede ser la llave o una función que la da: la página la puede cambiar con la ventana
 *   abierta (alguien pega la dirección con la llave), y cada pedido usa la del momento.
 */
export function crearClienteHttp({ fetch, aplicarSnapshot, repintar, mostrarEstado, token = null }) {
  const llaveDeAhora = () => (typeof token === "function" ? token() : token)

  async function cargarSnapshot() {
    const respuesta = await fetch("/api/proyecto")
    aplicarSnapshot(await respuesta.json())
    repintar()
  }

  /** POST de un sobre + manejo común de la respuesta. SIEMPRE se repinta desde `cuerpo.snapshot` (la
   * respuesta del servidor) — nunca desde lo que el control mostraba antes del POST. `repintarAhora:
   * false` lo usan la frase y la vista lógica, que repintan ellas mismas al terminar.
   *
   * Si el pedido NO LLEGA o la respuesta no se puede leer (se cayó Tecnia Bot, se cortó la red), no
   * hay snapshot nuevo: se repinta desde el último que SÍ vino del servidor, para que ningún control
   * quede mostrando un valor que no se guardó, y el error se relanza para que quien llamó se entere.
   * `avisoSiFalla` es el texto que se muestra en ese caso (lo pasa quien llama: viene del servidor).
   * Antes de este arreglo (2026-11-26) la falla de red de un cambio de pin no avisaba nada y el
   * selector quedaba con el pin elegido, que nunca se había guardado. */
  async function enviarSobre(sobre, { repintarAhora, avisoSiFalla = null }) {
    let respuesta
    let cuerpoLeido = null
    const llave = llaveDeAhora()
    try {
      respuesta = await fetch("/api/operaciones", {
        method: "POST",
        headers: llave ? { "Content-Type": "application/json", "X-Tecnia-Token": llave } : { "Content-Type": "application/json" },
        body: JSON.stringify(sobre),
      })
      if (respuesta.status !== 403) cuerpoLeido = await respuesta.json()
    } catch (error) {
      if (avisoSiFalla) mostrarEstado(avisoSiFalla)
      repintar()
      throw error
    }
    if (respuesta.status === 403) {
      // El servidor rechazó el pedido antes de tocar el proyecto. El cuerpo es texto, no un
      // snapshot: no hay nada que aplicar. Se dice qué pasa y se repinta desde lo último que SÍ
      // vino del servidor, para que el control no quede mostrando un cambio que no se hizo.
      // El 403 puede ser por la llave o por otro chequeo (Origin, Host): sólo se nombra la llave
      // si el servidor dijo que fue la llave.
      const porLaLlave = /token/i.test(await respuesta.text())
      mostrarEstado(porLaLlave ? (llave ? LLAVE_QUE_YA_NO_VALE : SIN_PERMISO) : "El servidor no aceptó el cambio (403). Pedile a Tecnia Bot que abra la vista de nuevo.")
      repintar()
      return { resultado: { ok: false, rechazadoPor: "transporte", motivos: [{ codigo: porLaLlave ? "SIN_TOKEN_DE_SESION" : "PEDIDO_RECHAZADO_POR_EL_SERVIDOR" }] }, snapshot: null }
    }
    const cuerpo = cuerpoLeido
    aplicarSnapshot(cuerpo.snapshot)

    if (cuerpo.resultado.ok) {
      // Path A (blocking representable) también cae acá con ok:true — el motivo, si lo hay, ya se
      // muestra en el panel de motivos vía `planDePintado`/`pintar`.
      mostrarEstado(null)
      if (repintarAhora) repintar()
      return cuerpo
    }

    const desactualizada = cuerpo.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA")
    if (desactualizada) {
      // Conflicto stale: "otro cambio llegó primero" — se vuelve a pedir el snapshot (nunca se asume
      // que el de la respuesta del rechazo es el más reciente) y se repinta desde ahí.
      mostrarEstado("otro cambio llegó primero — se actualizó a la revisión vigente")
      await cargarSnapshot()
      return cuerpo
    }

    // Path B: rechazo de dominio (no stale) — la vista queda en el snapshot autoritativo que ya
    // trajo la respuesta (sin cambios); sólo se muestra el motivo.
    mostrarEstado(descripcionDeMotivos(cuerpo.resultado.motivos))
    if (repintarAhora) repintar()
    return cuerpo
  }

  return { cargarSnapshot, enviarSobre }
}
