// Frontera de datos planos — Phase 1.1 (RX2), IR-SPEC.md §6.6.
//
// Revisión adversarial independiente #2 (RX2_REPORT.md) reabrió tres CRÍTICOS que
// comparten una única causa raíz: una entrada que es un objeto JS EXÓTICO
// construible in-process (getter, Proxy) atraviesa una frontera pública del núcleo
// y explota con una excepción cruda, o — peor, RX2-03(b) — pasa una validación
// leyendo un valor y termina persistiendo OTRO valor distinto, leído después, en el
// mismo campo (TOCTOU: time-of-check / time-of-use). Ninguno de los tres es
// alcanzable con JSON real (`JSON.parse` sólo produce datos planos) — todos
// requieren que el llamador construya el objeto a mano, in-process (brief §37: un
// adaptador futuro, un ORM con propiedades lazy, un wrapper de test).
//
// Los fixes puntuales de la ronda anterior (RX-01 `motor.ts`, RX-02 `operaciones.ts`)
// envolvían la lectura peligrosa en un `try/catch`, UNA vez — RX2-01 encontró que
// `operaciones.ts` volvía a leer el MISMO campo una segunda vez, sin protección,
// más abajo (el switch de despacho). Un `try/catch` puntual protege una lectura;
// nunca puede probar que no hay una SEGUNDA lectura en otro lugar del archivo, y
// mucho menos en un archivo distinto (RX2-02, `congelarProfundo` en `motor.ts`, una
// superficie que ningún fix anterior tocó). Parchear lectura por lectura es
// whack-a-mole por diseño: cierra el ataque de HOY y dejar abierta la MISMA clase de
// grieta en el próximo lugar que alguien agregue.
//
// La solución de esta ronda es de CLASE, no de instancia: `materializarDatosPlanos`
// hace UNA sola pasada sobre la entrada, ANTES de que cualquier otro código del
// núcleo la toque, y produce una copia PROFUNDA hecha ÚNICAMENTE de datos planos
// compatibles con JSON (objetos con prototipo `Object.prototype`/`null`, arrays
// densos, strings, booleans, `null`, numbers — incluidos NaN/±Infinity/-0, que
// SIGUEN siendo responsabilidad de los validadores existentes, `UMBRAL_NO_FINITO`
// etc. — este módulo nunca decide finitud). Cada propiedad se lee EXACTAMENTE una
// vez, y NUNCA invocando un getter: se lee por DESCRIPTOR
// (`Object.getOwnPropertyDescriptor`), no por acceso (`v.campo`/`v[i]`) — si el
// descriptor es un accessor (`get`/`set`), se rechaza SIN invocarlo. Esto tiene un
// efecto secundario deliberado y correcto: un Proxy cuyo ÚNICO trap "malicioso" es
// `get` (el patrón de los ataques RX2-02/RX2-03a/b) nunca dispara ese trap, porque
// nunca se llama a `get` — la materialización lee el descriptor real del target
// (comportamiento default de un Proxy sin `getOwnPropertyDescriptor` propio) y
// termina ACEPTANDO el dato real, intacto, sin ejecutar el trap. Un Proxy cuyo
// `ownKeys`/`getOwnPropertyDescriptor` SÍ miente o lanza, en cambio, sí se atrapa —
// esos son los traps que este módulo efectivamente invoca.
//
// Con esto, no puede existir una "segunda lectura" que diverja de la primera: el
// switch de despacho, los aplicadores, `congelarProfundo` y el eco del resultado
// (Phase 1.1, `operaciones.ts`/`motor.ts`) trabajan SIEMPRE sobre la copia — nunca
// sobre el objeto original — así que no hay NADA que releer.
//
// Reglas de rechazo (fail-closed, nunca reparación silenciosa — regla dura del
// brief):
// - Prototipo: sólo `Object.prototype` o `null` (objetos) / `Array.prototype`
//   (arrays). Cualquier otro prototipo (instancia de clase, `Date`, `Map`, ...) se
//   rechaza — nunca se intenta "adivinar" su forma.
// - Claves Symbol: rechazadas (nunca representables en JSON).
// - Claves NO enumerables: rechazadas — fail-closed (RX2-04): antes se ignoraban en
//   silencio (ni se copiaban ni se reportaban); acá directamente cierran la puerta,
//   nunca un dato "invisible" que sobrevive sin que nadie lo haya decidido.
// - Propiedades accessor (`get`/`set`): rechazadas SIN invocarlas (ver arriba).
// - Arrays: sólo densos (cada índice de `0..length-1` tiene descriptor propio,
//   nunca accessor) y sin propiedades propias fuera de los índices/`length` (un
//   array con una clave extra tipo `arr.foo = 1` se rechaza).
// - `undefined`: como valor de una propiedad de OBJETO se preserva tal cual — mismo
//   criterio que ya usa el resto del núcleo (`payload.propiedades === undefined` es
//   "ausente", `validarFormaPayload`/`aplicarAgregarComponente` ya lo tratan así;
//   `JSON.stringify({a:undefined})` simplemente omite la clave, un comportamiento
//   YA conocido y aceptado del serializador de disco, no algo que esta ronda deba
//   cambiar). Como ELEMENTO DE ARRAY, en cambio, se RECHAZA: ahí
//   `JSON.stringify([undefined])` no omite nada — lo CONVIERTE en `null` sin
//   avisar, un cambio de VALOR silencioso (no sólo de forma), que sí viola la regla
//   dura de "nunca reparar/alterar en silencio". Como valor RAÍZ (el `valor` de la
//   llamada externa), se acepta — cada frontera pública ya decide qué hacer con un
//   documento/operación `undefined` (ej. `esObjeto(undefined) === false` →
//   `DOCUMENTO_MALFORMADO`) y no es este módulo el que debe imponer esa forma.
// - Funciones, `bigint`, `symbol` (como VALOR, no sólo como clave), ciclos: rechazados.
//
// Límites (documentados, no arbitrarios): `LIMITE_PROFUNDIDAD` acota la recursión
// para no reventar la pila con una entrada adversarial anidada a propósito;
// `LIMITE_NODOS` acota el trabajo total (nodos visitados, y el `length` declarado de
// cualquier array) para que una entrada con un `length` enorme pero mintiendo sobre
// su contenido real no fuerce un recorrido cuasi-infinito antes de rechazar. Ambos
// son generosos para cualquier documento/operación real del dominio (un `Proyecto`
// legítimo, incluso grande, nunca se acerca a estos números) y arbitrariamente
// chicos frente a un ataque de denegación de servicio.
//
// TODO el recorrido corre dentro de un único `try/catch` (acá abajo, en
// `materializarDatosPlanos`) porque un Proxy puede mentir o lanzar en CUALQUIER
// trap que este módulo invoca (`ownKeys`, `getOwnPropertyDescriptor`) — nunca
// propaga una excepción cruda: siempre un `ResultadoMaterializacion` estructurado.
//
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — revisión adversarial independiente
// #3, RX3_REPORT.md): reabre, en forma PEOR (alcanzable con JSON PURO, sin Proxies ni
// getters in-process), la MISMA clase que RX2 (arriba) declaró cerrada. La rama objeto
// construía la copia con `copia[clave] = recorrer(...)` sobre un `Record<string,
// unknown> = {}` — un objeto PLANO que HEREDA el accessor
// `Object.prototype.__proto__` (un setter mágico, no una propiedad de datos común).
// Cuando `clave === "__proto__"`, esa asignación por corchetes NO crea una propiedad
// propia: dispara el setter heredado y reemplaza el PROTOTIPO INTERNO de `copia` por
// el valor recorrido — el propio postcondicional de este módulo ("el resultado tiene
// `Object.prototype`") quedaba falso para su propia salida. Es el gotcha clásico
// "`JSON.parse` es inmune a la contaminación de prototipo, pero un bucle `obj[k]=v`
// sobre esas mismas claves NO lo es" — y esta función era exactamente ese bucle.
// Consecuencias observadas (RX3_REPORT.md): la clave desaparecía de `Object.keys` de
// la copia (bypaseando `CLAVE_DESCONOCIDA` en la raíz del documento, `cargador.ts`),
// y dentro de `propiedades` (bolsa abierta, forma libre a propósito) el dato se
// perdía en silencio — la "reparación silenciosa" que el brief prohíbe.
//
// FIX DE RAÍZ (revisión de arquitectura post-RX3-01, ver `docs/programacion-intencion/
// DECISIONS.md` para el razonamiento completo con evidencia): el defecto real no es
// "la clave `__proto__` es peligrosa" — es que el CONTENEDOR RECEPTOR (`copia = {}`)
// tiene semántica mágica por nombre de clave. La corrección ataca esa causa: la copia
// se construye SIEMPRE con `Object.defineProperty` (semántica `[[DefineOwnProperty]]`),
// NUNCA con asignación por corchetes (`[[Set]]`) — inmune a CUALQUIER setter heredado
// de `Object.prototype`, conocido HOY (`__proto__`) o agregado en el futuro por el
// motor JS/una librería. El MISMO fix de raíz se aplicó en todos los demás lugares del
// núcleo que copiaban una clave de USUARIO con `obj[k] = v` sobre un objeto fresco:
// `canonico.ts` (`ordenarClavesProfundo`, RX3-04) y `cargador.ts` (`pinesCopiados[clave]
// = valorPin`, mismo patrón, encontrado en la misma revisión). El spread (`{...x}`,
// `cargador.ts: propiedades: {...propiedades}`) y las claves COMPUTADAS dentro de un
// OBJECT LITERAL (`{ ...c.pines, [payload.terminal]: payload.pin }`, `operaciones.ts`)
// usan semántica `CreateDataProperty` — nunca `[[Set]]` — así que son seguros por
// construcción, sin necesitar ningún cambio (verificado empíricamente, no sólo por
// lectura de spec — ver evidencia/RX3fix/causa.md).
//
// Con el CONTENEDOR seguro en todos los puntos de copia, una clave `"__proto__"` deja
// de tener CUALQUIER efecto especial: sobrevive como una propiedad PROPIA normal, con
// `Object.getPrototypeOf(copia) === Object.prototype` intacto — exactamente igual que
// cualquier otra clave string. Por eso este módulo YA NO rechaza `"__proto__"` por
// NOMBRE (una versión anterior de este fix sí lo hacía, como capa adicional — ver nota
// de decisión abajo): con el contenedor corregido, esa capa se volvió redundante Y,
// peor, INCORRECTA para `propiedades` (bolsa abierta, `ir.ts`, forma libre a
// propósito) — rechazar `"__proto__"` ahí violaba el contrato explícito de esa bolsa
// sin ninguna razón técnica, ya que la clave es, con el contenedor seguro, un dato
// tan inofensivo como `"constructor"`/`"prototype"`/`"toString"`/`"hasOwnProperty"`
// (que este módulo NUNCA rechazó por nombre, y siguen sin rechazarse — ver batería de
// ataque, `RX3/scripts/05_bateria_controles.mjs`). En la RAÍZ del documento y en
// cualquier entidad de forma CERRADA (`Componente`/`Conexion`/`ComportamientoRegla`,
// `cargador.ts`), una clave `"__proto__"` sobrevive como propiedad propia y cae en
// `CLAVE_DESCONOCIDA` exactamente igual que cualquier otra clave no declarada — el
// mecanismo EXISTENTE de fail-closed por forma cerrada, sin necesitar un segundo
// mecanismo especial para este nombre en particular.
//
// Decisión registrada con evidencia (mutantes, tests de round-trip por las 4 puertas):
// `docs/programacion-intencion/DECISIONS.md`, entrada RX3-01. `evidencia/RX3fix/
// causa.md` documenta el análisis completo (por qué ocurre, qué invariante rompe, qué
// puertas afecta, entrada de reproducción, resultado incorrecto) hecho ANTES de fijar
// este fix de raíz.

import type { CategoriaMotivo, Motivo } from "./motivos.ts"

/** Generoso para cualquier IR real (Proyecto/SobreOperacion legítimos no se acercan
 * ni de lejos); acota la recursión para que una entrada adversarial anidada a
 * propósito nunca reviente la pila. */
export const LIMITE_PROFUNDIDAD = 64

/** Acota el trabajo TOTAL (nodos visitados, incluido el `length` declarado de
 * cualquier array) — cierra el caso de una entrada que declara un `length` enorme
 * (mintiendo o no sobre su contenido real) y fuerza un recorrido cuasi-infinito
 * antes de que cualquier otro chequeo llegue a rechazarla. */
export const LIMITE_NODOS = 50_000

export type ResultadoMaterializacion<T = unknown> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly ruta: string; readonly razon: string }

class RechazoMaterializacion extends Error {
  readonly ruta: string
  readonly razonRechazo: string
  constructor(ruta: string, razon: string) {
    super(`${ruta}: ${razon}`)
    this.name = "RechazoMaterializacion"
    this.ruta = ruta
    this.razonRechazo = razon
  }
}

/**
 * Recorre `valor` y produce una copia profunda hecha ÚNICAMENTE de datos planos
 * compatibles con JSON, o un rechazo estructurado — nunca lanza (ver comentario de
 * cabecera para el detalle completo de las reglas). `ruta` es el nombre de raíz que
 * aparece en `datos.ruta` de un rechazo (ej. "operacion", "proyecto") — cada nivel
 * de anidamiento agrega su propio segmento (`.campo` / `[indice]`).
 */
export function materializarDatosPlanos<T = unknown>(valor: unknown, ruta: string): ResultadoMaterializacion<T> {
  let nodosVisitados = 0

  function recorrer(v: unknown, rutaActual: string, profundidad: number, ancestros: readonly unknown[], permiteUndefinedAca: boolean): unknown {
    nodosVisitados++
    if (nodosVisitados > LIMITE_NODOS) {
      throw new RechazoMaterializacion(rutaActual, `excede el limite de ${LIMITE_NODOS} nodos visitados`)
    }
    if (profundidad > LIMITE_PROFUNDIDAD) {
      throw new RechazoMaterializacion(rutaActual, `excede el limite de profundidad (${LIMITE_PROFUNDIDAD})`)
    }

    if (v === null) return null
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") return v
    if (typeof v === "undefined") {
      if (permiteUndefinedAca) return undefined
      throw new RechazoMaterializacion(rutaActual, "undefined como elemento de array — JSON.stringify lo convertiria en null silenciosamente")
    }
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") {
      throw new RechazoMaterializacion(rutaActual, `tipo '${typeof v}' no es un dato plano representable en JSON`)
    }
    // typeof v === "object" (y no null, ya cubierto arriba) a partir de acá.
    if (ancestros.includes(v)) {
      throw new RechazoMaterializacion(rutaActual, "ciclo detectado (el valor se referencia a si mismo)")
    }
    const siguientesAncestros = [...ancestros, v]

    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) {
        throw new RechazoMaterializacion(rutaActual, "prototipo de array no estandar")
      }
      const claves = Reflect.ownKeys(v)
      if (claves.some((k) => typeof k === "symbol")) {
        throw new RechazoMaterializacion(rutaActual, "array con clave Symbol")
      }
      const descLongitud = Object.getOwnPropertyDescriptor(v, "length")
      if (!descLongitud || typeof descLongitud.value !== "number" || !Number.isInteger(descLongitud.value) || descLongitud.value < 0) {
        throw new RechazoMaterializacion(rutaActual, "array sin 'length' valido")
      }
      const longitud = descLongitud.value
      if (longitud > LIMITE_NODOS) {
        throw new RechazoMaterializacion(rutaActual, `array excede el limite de ${LIMITE_NODOS} elementos`)
      }
      const clavesEsperadas = new Set<string>(["length"])
      for (let i = 0; i < longitud; i++) clavesEsperadas.add(String(i))
      const clavesString = claves.filter((k): k is string => typeof k === "string")
      if (clavesString.length !== clavesEsperadas.size || clavesString.some((k) => !clavesEsperadas.has(k))) {
        throw new RechazoMaterializacion(rutaActual, "array con huecos o con propiedades extra fuera de indices/length")
      }
      const copia: unknown[] = []
      for (let i = 0; i < longitud; i++) {
        const desc = Object.getOwnPropertyDescriptor(v, i)
        if (!desc || desc.get || desc.set) {
          throw new RechazoMaterializacion(`${rutaActual}[${i}]`, "propiedad accessor (getter/setter) o descriptor inconsistente")
        }
        // Elemento de array: `undefined` NO se permite acá (ver comentario de
        // cabecera — JSON.stringify lo convertiria en `null` silenciosamente).
        copia.push(recorrer(desc.value, `${rutaActual}[${i}]`, profundidad + 1, siguientesAncestros, false))
      }
      return copia
    }

    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) {
      throw new RechazoMaterializacion(rutaActual, "prototipo no es Object.prototype ni null (instancia de clase u objeto exotico)")
    }
    const claves = Reflect.ownKeys(v)
    const copia: Record<string, unknown> = {}
    for (const clave of claves) {
      if (typeof clave === "symbol") {
        throw new RechazoMaterializacion(rutaActual, "clave Symbol no es un dato plano")
      }
      // Phase 1.1 (RX3-01): NINGÚN nombre de clave (incluido "__proto__") se rechaza
      // por sí solo acá — ver cabecera del módulo para el razonamiento completo. El
      // fix de raíz es que `copia` (más abajo) es un contenedor SEGURO por
      // construcción (`Object.defineProperty`): ninguna clave, sin importar su
      // nombre, puede disparar un comportamiento especial al copiarla.
      const desc = Object.getOwnPropertyDescriptor(v, clave)
      if (!desc) {
        throw new RechazoMaterializacion(`${rutaActual}.${clave}`, "descriptor de propiedad inconsistente (posible Proxy que miente)")
      }
      if (!desc.enumerable) {
        throw new RechazoMaterializacion(`${rutaActual}.${clave}`, "propiedad no enumerable (RX2-04: fail-closed, nunca se ignora en silencio)")
      }
      if (desc.get || desc.set) {
        throw new RechazoMaterializacion(`${rutaActual}.${clave}`, "propiedad accessor (getter/setter)")
      }
      // Valor de propiedad de OBJETO: `undefined` SÍ se permite acá (ver comentario
      // de cabecera — mismo criterio que el resto del núcleo ya usa para "ausente").
      const valorRecorrido = recorrer(desc.value, `${rutaActual}.${String(clave)}`, profundidad + 1, siguientesAncestros, true)
      // Phase 1.1 (RX3-01): `Object.defineProperty` (semántica `[[DefineOwnProperty]]`)
      // en vez de `copia[clave] = ...` (semántica `[[Set]]`) — defensa en profundidad,
      // inmune a CUALQUIER setter heredado de `Object.prototype`, conocido o futuro,
      // no sólo a `__proto__`. Mismos atributos que produciría la asignación normal
      // (enumerable/writable/configurable), así que no cambia la forma de la copia
      // para ninguna entrada que ya aceptaba este módulo.
      Object.defineProperty(copia, clave, { value: valorRecorrido, enumerable: true, writable: true, configurable: true })
    }
    return copia
  }

  try {
    const materializado = recorrer(valor, ruta, 0, [], true)
    return { ok: true, valor: materializado as T }
  } catch (error) {
    if (error instanceof RechazoMaterializacion) {
      return { ok: false, ruta: error.ruta, razon: error.razonRechazo }
    }
    // Un Proxy puede lanzar cualquier cosa en `ownKeys`/`getOwnPropertyDescriptor` —
    // nunca una excepción cruda hacia el llamador, siempre un rechazo estructurado.
    return { ok: false, ruta, razon: `excepcion inesperada durante la materializacion: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Envuelve un rechazo de `materializarDatosPlanos` en un `Motivo` con el código
 * único y estable `ENTRADA_NO_ES_DATO_PLANO` — mismo criterio ya establecido en
 * todo el núcleo (`CLAVE_DESCONOCIDA`/`AUTOCONEXION_INVALIDA`/`UMBRAL_NO_FINITO`):
 * un solo código, la `categoria` la decide quién lo emite (cargador.ts:
 * "estructural", operaciones.ts/motor.ts: "operacion"/"motor").
 */
export function motivoEntradaNoPlano(categoria: CategoriaMotivo, resultado: { readonly ruta: string; readonly razon: string }): Motivo {
  return { codigo: "ENTRADA_NO_ES_DATO_PLANO", categoria, severidad: "blocking", clasificacion: "rechazo", datos: { ruta: resultado.ruta, razon: resultado.razon } }
}
