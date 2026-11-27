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
// TEXTOS (todos los de `TEXTOS_DEL_VINCULO`): aprobados para la prueba por el dueño el 2026-11-27,
// pendientes de verlos en pantalla. Los ajusta en la notebook; no es la aprobación final.

export const TEXTOS_DEL_VINCULO = Object.freeze({
  // Las dos pistas se muestran SÓLO cuando hay programa con su estructura a la vista: sin eso,
  // tocar no marca nada, y un texto fijo que invite a tocar prometería lo que la página no hace.
  //
  // REVISIÓN DEL 2026-11-27, tras la prueba en la notebook. El dueño no descubrió el vínculo solo:
  // la pista daba la instrucción («tocá un bloque») sin la idea (el bloque y el código son lo
  // mismo). Ahora cada texto dice la idea: la pista, y lo que se lee al tocar. Cambios puntuales:
  //   - «código» y no «programa» para el lugar donde están las líneas: así lo llama la ventana;
  //   - al tocar el «mientras» o el «hacer» de una regla se marcan LOS DOS y las líneas incluyen
  //     la condición: decía «este bloque son las líneas…»; ahora dice «esta regla»;
  //   - «…es parte de la preparación del programa» chocaba con «al iniciar», que es justamente lo
  //     que el programa prepara, y el alumno leía que «al iniciar» no salía de ningún bloque;
  //   - ninguno afirma «quedó marcado»: eso lo dice la pantalla, no el texto.
  // No dicen «cada bloque» ni «cada línea» (lo decían, y la revisión a ciegas lo marcó): una regla
  // a medio armar no tiene líneas, y un `#include` no sale de ningún bloque. La idea general está
  // en el párrafo fijo de «Con bloques»; acá va sólo lo que pasa al tocar.
  pistaJuntoALosBloques: "Tocá un bloque y se marcan sus líneas en el código.",
  pistaJuntoAlCodigo: "Tocá una línea y se marca el bloque del que sale.",
  bloqueSinLineas: "Este bloque todavía no está en el programa.",
  bloqueUnaLinea: "Este bloque es lo mismo que la línea {desde} del código.",
  bloqueVariasLineas: "Este bloque es lo mismo que las líneas {desde} a {hasta} del código.",
  reglaUnaLinea: "Esta regla es lo mismo que la línea {desde} del código.",
  reglaVariasLineas: "Esta regla es lo mismo que las líneas {desde} a {hasta} del código.",
  lineaDeAlIniciar: "Esta línea es parte de «al iniciar».",
  lineaDePaso: "Esta línea es de un renglón de «al iniciar».",
  // Sale en las líneas del `loop` que no son de ninguna regla (una lectura compartida, las llaves).
  lineaDePorSiempre: "Esta línea es de «por siempre», pero no de una regla.",
  lineaDeLaRegla: "Esta línea es parte de la regla.",
  lineaDeUnaRegla: "Esta línea es parte de la regla {numero}.",
  lineaDeNingunBloque: "Esta línea no sale de ningún bloque: es de lo que el código necesita tener escrito aparte, como los nombres de los pines.",
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

/**
 * Lo que se dice junto a los bloques cuando hay algo marcado. Si lo marcado es una regla (sus dos
 * bloques), se habla de «esta regla»; si no, de «este bloque».
 */
export function textoDelBloque(rango, clave = null) {
  if (!esRango(rango)) return ""
  const unaLinea = rango.desde === rango.hasta
  const deRegla = clave?.bloque === "regla"
  const plantilla = deRegla ? (unaLinea ? TEXTOS_DEL_VINCULO.reglaUnaLinea : TEXTOS_DEL_VINCULO.reglaVariasLineas) : unaLinea ? TEXTOS_DEL_VINCULO.bloqueUnaLinea : TEXTOS_DEL_VINCULO.bloqueVariasLineas
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
 * `marcarBloques` y `marcarLineas` devuelven si de verdad quedó algo marcado, y eso se USA
 * (revisión a ciegas, 2026-11-27): la primera versión armaba el texto y ofrecía el enlace sólo con
 * el dato de la estructura. Sin Blockly, o con una regla del programa que no está dibujada, decía
 * «Ir a los bloques» sin ningún bloque marcado.
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
  /** ¿Hay bloques dibujados? Sin ellos (sin Blockly, o sin nada que armar) no se invita a tocarlos. */
  let hayBloques = true
  /** De dónde vino lo que está marcado: `"bloque"`, `"linea"` o `null` (nada). */
  let origen = null
  /** El bloque marcado, para volver a marcarlo si el lienzo se rearma (los bloques nuevos nacen sin marca). */
  let claveMarcada = null

  const sePuedeTocar = () => estructura !== null && hayBloques

  /** Nada marcado. Si se puede tocar algo, queda la pista; si no, no se dice nada. */
  function borrar(juntoALosBloques = null) {
    origen = null
    claveMarcada = null
    marcarBloques(null)
    marcarLineas(null)
    decirJuntoALosBloques(juntoALosBloques ?? (sePuedeTocar() ? TEXTOS_DEL_VINCULO.pistaJuntoALosBloques : ""), { hayLineas: false })
    decirJuntoAlCodigo(sePuedeTocar() ? TEXTOS_DEL_VINCULO.pistaJuntoAlCodigo : "", { hayBloque: false })
  }

  return {
    /**
     * La estructura del programa que se está mostrando (o `null`), las reglas dibujadas y si hay
     * bloques en el lienzo. Si la estructura es OTRA que la que había, lo marcado ya no vale y se
     * borra. Si es la misma (un repintado), lo marcado sigue, y el bloque se vuelve a marcar: el
     * lienzo pudo haberse rearmado entero sin que cambie el programa (cambian las opciones de un
     * casillero al armar una condición), y los bloques nuevos nacen sin marca mientras el código
     * seguía diciendo «Esta regla es lo mismo que las líneas…».
     */
    actualizar(nueva, idsDeReglas = [], { hayBloques: ahoraHayBloques = true } = {}) {
      reglasEnElLienzo = [...idsDeReglas]
      const cambiaronLosBloques = ahoraHayBloques !== hayBloques
      hayBloques = ahoraHayBloques
      if ((nueva ?? null) !== estructura) {
        estructura = nueva ?? null
        return borrar()
      }
      if (origen === null) {
        if (cambiaronLosBloques) borrar()
        return
      }
      // Si el bloque marcado ya no se puede marcar (no está dibujado), lo marcado desde él no vale.
      if (claveMarcada && marcarBloques(claveMarcada) !== true && origen === "bloque") borrar()
    },

    /** Se tocó un bloque (`null`: se tocó el fondo del lienzo). */
    alTocarBloque(clave) {
      // El fondo del lienzo deshace lo que se marcó tocando un bloque, no lo que se marcó desde el código.
      if (!clave) {
        if (origen === "bloque") borrar()
        return
      }
      const rango = rangoDeLaClave(estructura, clave)
      // Un bloque que el programa no tiene (una regla a medio armar): se dice eso, no la pista
      // general, que justo ahí sería falsa.
      if (!rango) return borrar(estructura ? TEXTOS_DEL_VINCULO.bloqueSinLineas : "")
      origen = "bloque"
      claveMarcada = clave
      marcarBloques(clave)
      const hayLineas = marcarLineas(rango) === true
      decirJuntoALosBloques(hayLineas ? textoDelBloque(rango, clave) : "", { hayLineas })
      decirJuntoAlCodigo(sePuedeTocar() ? TEXTOS_DEL_VINCULO.pistaJuntoAlCodigo : "", { hayBloque: false })
    },

    /** Se tocó una línea del código (`null`: se tocó el código fuera de una línea). */
    alTocarLinea(numero) {
      if (!estructura || !Number.isInteger(numero)) return borrar()
      const clave = claveDeLaLinea(estructura, numero)
      const rango = clave ? rangoDeLaClave(estructura, clave) : null
      origen = "linea"
      claveMarcada = clave
      const hayBloque = clave !== null && marcarBloques(clave) === true
      if (clave === null) marcarBloques(null)
      // Sin bloque, se marca la línea tocada sola: que se vea qué se tocó y por qué no hay bloque.
      marcarLineas(rango ?? { desde: numero, hasta: numero })
      decirJuntoALosBloques(rango && hayBloque ? textoDelBloque(rango, clave) : sePuedeTocar() ? TEXTOS_DEL_VINCULO.pistaJuntoALosBloques : "", { hayLineas: rango !== null && hayBloque })
      decirJuntoAlCodigo(textoDeLaLinea(clave, reglasEnElLienzo), { hayBloque })
    },

    /** ¿Hay estructura? Sin ella, tocar una línea no marca nada (y las flechas no se usan para eso). */
    hayEstructura: () => estructura !== null,
    /** Qué hay marcado ahora (para las pruebas y para quien quiera saber si hay algo). */
    origen: () => origen,
  }
}
