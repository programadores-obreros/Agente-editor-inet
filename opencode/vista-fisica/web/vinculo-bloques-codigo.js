// El vínculo entre los bloques y el código (2026-11-26).
//
// Tocar un bloque marca sus líneas en «Mirá el código»; tocar una línea marca su bloque. Es lo
// que faltaba para que el alumno vea que el bloque y el programa dicen lo mismo: antes eran dos
// secciones sin nada que las uniera (los bloques decían «Pulsador»; el código, otra cosa).
//
// De dónde sale cada número: de la `estructura` que el servidor manda junto al programa
// (`/api/programa`), que a su vez sale del generador. Acá NO se busca nada en el texto del
// programa ni se cuenta ninguna línea: se lee el tramo que ya viene dicho.
//
// La regla dura es la de toda la ventana: nada de otra revisión. Quien llama pasa la estructura
// sólo si es la del programa que se está mostrando; cuando cambia (o deja de haberla), se borra lo
// marcado en los dos lados.
//
// Tres partes: funciones puras (qué tramo es de qué bloque, qué bloque es de qué línea, qué se
// dice), y un coordinador chico que guarda qué está marcado. Sin DOM ni red: lo que toca el mundo
// se inyecta.
//
// TEXTOS PENDIENTES DE APROBACIÓN DEL DUEÑO: todos los de `TEXTOS_DEL_VINCULO`.

export const TEXTOS_DEL_VINCULO = Object.freeze({
  // Las dos pistas se muestran SÓLO cuando hay programa con su estructura a la vista: sin eso,
  // tocar no marca nada, y un texto fijo que invite a tocar prometería lo que la página no hace.
  pistaJuntoALosBloques: "Tocá un bloque para ver sus líneas en el código.",
  pistaJuntoAlCodigo: "Tocá una línea para ver de qué bloque sale.",
  bloqueUnaLinea: "En el programa, este bloque es la línea {desde}.",
  bloqueVariasLineas: "En el programa, este bloque son las líneas {desde} a {hasta}.",
  lineaDeAlIniciar: "Esta línea sale del bloque «al iniciar».",
  lineaDePaso: "Esta línea sale de un renglón del bloque «al iniciar».",
  lineaDePorSiempre: "Esta línea sale del bloque «por siempre».",
  lineaDeLaRegla: "Esta línea sale de la regla.",
  lineaDeUnaRegla: "Esta línea sale de la regla {numero}.",
  lineaDeNingunBloque: "Esta línea no sale de un bloque: es parte de la preparación del programa.",
})

const esRango = (r) => r !== null && typeof r === "object" && Number.isInteger(r.desde) && Number.isInteger(r.hasta) && r.desde >= 1 && r.hasta >= r.desde
const contiene = (rango, numero) => esRango(rango) && numero >= rango.desde && numero <= rango.hasta

/** El tramo de líneas de un bloque, o `null` si la estructura no lo tiene. */
export function rangoDeLaClave(estructura, clave) {
  if (!estructura || !clave) return null
  let rango = null
  if (clave.bloque === "alIniciar") rango = estructura.alIniciar?.lineas
  else if (clave.bloque === "porSiempre") rango = estructura.porSiempre?.lineas
  else if (clave.bloque === "paso") rango = estructura.alIniciar?.pasos?.[clave.indice]?.lineas
  else if (clave.bloque === "regla") rango = estructura.reglas?.find((r) => r.id === clave.reglaId)?.lineas
  return esRango(rango) ? { desde: rango.desde, hasta: rango.hasta } : null
}

/**
 * El bloque del que sale una línea, o `null` si no sale de ninguno (los `#include`, las constantes
 * de los pines). El MÁS CHICO que la contiene: una línea de una regla está también adentro de
 * «por siempre», y lo que se quiere mostrar es la regla.
 */
export function claveDeLaLinea(estructura, numero) {
  if (!estructura || !Number.isInteger(numero)) return null
  const regla = estructura.reglas?.find((r) => contiene(r.lineas, numero))
  if (regla) return { bloque: "regla", reglaId: regla.id }
  const indice = estructura.alIniciar?.pasos?.findIndex((p) => contiene(p.lineas, numero)) ?? -1
  if (indice >= 0) return { bloque: "paso", indice }
  if (contiene(estructura.alIniciar?.lineas, numero)) return { bloque: "alIniciar" }
  if (contiene(estructura.porSiempre?.lineas, numero)) return { bloque: "porSiempre" }
  return null
}

/** Lo que se dice junto a los bloques cuando hay uno marcado. */
export function textoDelBloque(rango) {
  if (!esRango(rango)) return ""
  const plantilla = rango.desde === rango.hasta ? TEXTOS_DEL_VINCULO.bloqueUnaLinea : TEXTOS_DEL_VINCULO.bloqueVariasLineas
  return plantilla.replace("{desde}", String(rango.desde)).replace("{hasta}", String(rango.hasta))
}

/**
 * Lo que se dice junto al código cuando se tocó una línea. `reglasEnElLienzo` son los ids de las
 * reglas en el orden en que están dibujadas: «la regla 2» es la segunda de arriba abajo, igual
 * que en los avisos de los bloques (el programa las escribe en otro orden).
 */
export function textoDeLaLinea(clave, reglasEnElLienzo = []) {
  if (!clave) return TEXTOS_DEL_VINCULO.lineaDeNingunBloque
  if (clave.bloque === "alIniciar") return TEXTOS_DEL_VINCULO.lineaDeAlIniciar
  if (clave.bloque === "paso") return TEXTOS_DEL_VINCULO.lineaDePaso
  if (clave.bloque === "porSiempre") return TEXTOS_DEL_VINCULO.lineaDePorSiempre
  if (clave.bloque !== "regla") return ""
  if (reglasEnElLienzo.length <= 1) return TEXTOS_DEL_VINCULO.lineaDeLaRegla
  const lugar = reglasEnElLienzo.indexOf(clave.reglaId)
  // Una regla del programa que no está dibujada: no se le inventa un número.
  return lugar >= 0 ? TEXTOS_DEL_VINCULO.lineaDeUnaRegla.replace("{numero}", String(lugar + 1)) : TEXTOS_DEL_VINCULO.lineaDeLaRegla
}

/**
 * El coordinador. Recibe lo que pasa (se tocó un bloque, se tocó una línea, cambió el programa) y
 * dice qué marcar y qué escribir. No guarda nada del programa: sólo qué está marcado.
 *
 * @param {{
 *   marcarBloques: (clave: object | null) => unknown,
 *   marcarLineas: (rango: { desde: number, hasta: number } | null) => unknown,
 *   decirJuntoALosBloques: (texto: string, opciones: { hayLineas: boolean }) => void,
 *   decirJuntoAlCodigo: (texto: string, opciones: { hayBloque: boolean }) => void,
 * }} salidas
 */
export function crearVinculoBloquesCodigo({ marcarBloques, marcarLineas, decirJuntoALosBloques, decirJuntoAlCodigo }) {
  let estructura = null
  let reglasEnElLienzo = []
  /** De dónde vino lo que está marcado: `"bloque"`, `"linea"` o `null` (nada). */
  let origen = null

  /** Nada marcado. Si hay estructura queda la pista de qué se puede tocar; si no, no se dice nada. */
  function borrar() {
    origen = null
    marcarBloques(null)
    marcarLineas(null)
    decirJuntoALosBloques(estructura ? TEXTOS_DEL_VINCULO.pistaJuntoALosBloques : "", { hayLineas: false })
    decirJuntoAlCodigo(estructura ? TEXTOS_DEL_VINCULO.pistaJuntoAlCodigo : "", { hayBloque: false })
  }

  return {
    /**
     * La estructura del programa que se está mostrando (o `null`) y las reglas dibujadas. Si la
     * estructura es OTRA que la que había, lo marcado ya no vale y se borra. Si es la misma (un
     * repintado sin cambios), se deja como está.
     */
    actualizar(nueva, idsDeReglas = []) {
      reglasEnElLienzo = [...idsDeReglas]
      if (nueva === estructura) return
      estructura = nueva ?? null
      borrar()
    },

    /** Se tocó un bloque (`null`: se tocó el fondo del lienzo). */
    alTocarBloque(clave) {
      // El fondo del lienzo deshace lo que se marcó tocando un bloque, no lo que se marcó desde el código.
      if (!clave) {
        if (origen === "bloque") borrar()
        return
      }
      const rango = rangoDeLaClave(estructura, clave)
      if (!rango) return borrar()
      origen = "bloque"
      marcarBloques(clave)
      marcarLineas(rango)
      decirJuntoALosBloques(textoDelBloque(rango), { hayLineas: true })
      decirJuntoAlCodigo(TEXTOS_DEL_VINCULO.pistaJuntoAlCodigo, { hayBloque: false })
    },

    /** Se tocó una línea del código (`null`: se tocó el código fuera de una línea). */
    alTocarLinea(numero) {
      if (!estructura || !Number.isInteger(numero)) return borrar()
      const clave = claveDeLaLinea(estructura, numero)
      const rango = clave ? rangoDeLaClave(estructura, clave) : null
      origen = "linea"
      marcarBloques(clave)
      // Sin bloque, se marca la línea tocada sola: que se vea qué se tocó y por qué no hay bloque.
      marcarLineas(rango ?? { desde: numero, hasta: numero })
      decirJuntoALosBloques(rango ? textoDelBloque(rango) : TEXTOS_DEL_VINCULO.pistaJuntoALosBloques, { hayLineas: rango !== null })
      decirJuntoAlCodigo(textoDeLaLinea(clave, reglasEnElLienzo), { hayBloque: clave !== null })
    },

    /** Qué hay marcado ahora (para las pruebas y para quien quiera saber si hay algo). */
    origen: () => origen,
  }
}
