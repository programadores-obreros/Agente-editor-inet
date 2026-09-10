// Los errores del PROPIO bot, traducidos: el skill `errores-del-bot` y el
// disparador del prompt.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El 8 de septiembre de 2026, en la escuela Juana
// Manso, una docente vio esto y el bot dejó de contestar:
//
//     AI_APICallError: Resource has been exhausted (e.g. check quota).
//
// Diez veces en tres minutos, y después un `Aborted`. Ese texto no aparecía en
// NINGÚN lado del repo: ni en un tool, ni en un comando, ni en una skill. Las
// skills eran todas de hardware y didáctica, y `errores-comunes` es de errores de
// ARDUINO. Así que la docente leyó el error crudo en inglés y Tecnia Bot no le
// dijo qué significaba, si era culpa suya, si se arreglaba solo, ni qué hacer.
//
// Lo que se custodia acá es lo que no puede volver a faltar:
//
//   1. que el texto de la cuota nombre lo del PROYECTO (una key nueva del mismo
//      proyecto da el MISMO error: es lo que les hizo perder la tarde probando
//      keys que no podían funcionar), ofrezca `/clave` y ofrezca Big Pickle;
//   2. que ese texto no CONTRADIGA al del tool `clave` — dos verdades sobre la
//      cuota son peor que ninguna (mismo criterio que `platformio-pio` con los
//      modelos del tool y del instalador);
//   3. que el 404 (el modelo que Google retiró) no la mande a mirar la red;
//   4. que el paquete nuevo NO autorice al modelo a afirmar lo que el tool no
//      dijo — el OK falso que ya nos costó caro con PlatformIO;
//   5. que el disparador viva en el PROMPT, que se lee siempre, y no dependa de
//      que la docente sepa que existe un comando llamado `/clave`.
//
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const skill = leer("opencode/skills/errores-del-bot/SKILL.md")
const prompt = leer("opencode/agent/tecnia-bot.md")
const claveSrc = leer("opencode/tool/clave.ts")

/**
 * El mismo texto con los espacios colapsados. Los .md van cortados a 80 columnas
 * y los .ts concatenan literales con `+`: una frase partida en dos renglones no
 * tiene que hacer fallar una regla por el formato, ni pasar de casualidad si
 * alguien reordena los renglones.
 */
const plano = (t) => t.replace(/\s+/g, " ")
const skillPlano = plano(skill)

/**
 * Una constante de texto de clave.ts, con sus `+` resueltos, sin comillas y con
 * las interpolaciones de OTRAS constantes del archivo ya reemplazadas — si no,
 * el link para sacar la key llega acá como `${SACAR_KEY}` y no se puede comparar
 * con el del skill, que es justo lo que hay que comparar.
 *
 * No se importa el módulo a propósito: `clave.ts` no se toca en este trabajo y
 * exportar estas constantes sería tocarlo. Leer el fuente alcanza, porque lo que
 * se compara son textos.
 */
function constanteDeClave(nombre) {
  const literal = (n) => {
    const m = claveSrc.match(new RegExp(`const ${n}\\s*=\\s*([\\s\\S]*?)\\n\\n`, "m"))
    assert.ok(m, `no encontré la constante ${n} en clave.ts`)
    return m[1]
  }
  let texto = literal(nombre)
  // Una sola pasada de sustitución: en clave.ts las constantes de texto sólo
  // interpolan constantes simples, nunca en cadena.
  texto = texto.replace(/\$\{([A-Z_]+)\}/g, (_, n) => literal(n).replace(/["`]/g, "").trim())
  return plano(texto.replace(/`/g, "").replace(/"/g, "").replace(/\s\+\s/g, ""))
}

/**
 * El cuerpo de la sección `##` que contiene `marca`, sin su encabezado.
 * Se busca por CONTENIDO y no por título: así renombrar el título no vuelve
 * verde un test que dejó de mirar nada.
 */
function seccionQueContiene(md, marca) {
  const partes = md.split(/^## /m).slice(1)
  const encontrada = partes.filter((p) => p.includes(marca))
  assert.equal(encontrada.length, 1,
    `esperaba exactamente una sección con "${marca}", encontré ${encontrada.length}`)
  return encontrada[0]
}

// ---------------------------------------------------------------------------
// 1. El texto de la cuota dice las tres cosas que la sacan del pozo
// ---------------------------------------------------------------------------

test("1. la cuota: el texto nombra lo del PROYECTO, ofrece /clave y ofrece Big Pickle", () => {
  // TODO se mide DENTRO de la sección de la cuota, no sobre el archivo entero.
  // Con el archivo entero, una mutación que vaciaba esta sección pasaba en verde
  // porque la frase seguía existiendo tres secciones más abajo, hablando de otra
  // cosa. Es el mismo defecto que este trabajo vino a arreglar en el test de
  // `actualizar`: un filtro que mira de más audita lo que ya estaba bien.
  const cuota = plano(seccionQueContiene(skill, "Resource has been exhausted"))

  // Lo del proyecto es EL dato. Sin esto, la salida "poné otra key" es una trampa:
  // la docente crea una key nueva en el mismo proyecto y ve exactamente el mismo
  // error, tres veces seguidas, convencida de que el problema es otro.
  assert.match(cuota, /por PROYECTO, no por key/i,
    "el skill no dice que la cuota gratuita es por proyecto y no por key")
  assert.match(cuota, /MISMO proyecto[\s\S]{0,200}mismo error/i,
    "el skill no dice que una key nueva del mismo proyecto da el mismo error")
  assert.match(cuota, /otro proyecto/i, "el skill no dice que la key tiene que ser de otro proyecto")
  assert.match(cuota, /otra cuenta/i, "el skill no ofrece la salida de otra cuenta de Google")

  // Que no rompió nada: es lo primero que la docente piensa que pasó.
  assert.match(cuota, /no rompiste nada|no rompió nada/i,
    "el skill no le dice que no rompió nada — es lo primero que cree")

  // Esperar: la salida que no cuesta trabajo.
  assert.match(cuota, /se renueva sol/i, "el skill no ofrece esperar a que se renueve la cuota")

  // Las dos salidas que se ejecutan con el tool. El tool se llama `clave`, y el
  // skill tiene que decir CON QUÉ ACCIÓN: "usá /clave" a secas deja al modelo
  // eligiendo, y el que elige mal borra la key que estaba funcionando.
  assert.match(cuota, /`clave` con `accion: "guardar"`/,
    "la sección de la cuota no dice cómo guardar la key nueva con el tool `clave`")
  assert.match(cuota, /`clave` con `accion: "quitar"`/,
    "la sección de la cuota no dice cómo dejar la compu sin key con el tool `clave`")

  // Big Pickle, con el aviso que ya da el instalador. Ofrecer el modelo gratis y
  // callarse que la conversación puede usarse para entrenar sería venderle algo
  // que no eligió.
  assert.match(cuota, /Big Pickle/, "la sección de la cuota no ofrece Big Pickle")
  assert.match(cuota, /modelo gratuito de OpenCode/i, "el skill no dice qué es Big Pickle")
  assert.match(cuota, /usar lo que se escribe en el chat para mejorar el modelo/i,
    "el skill ofrece Big Pickle sin el aviso de privacidad que sí da el instalador")
  assert.match(cuota, /nombres de alumnos/i,
    "el aviso de Big Pickle no nombra el caso concreto del aula (datos de alumnos)")

  // Y el error real, tal cual sale, para que el modelo lo reconozca cuando se lo
  // peguen en el chat.
  assert.match(cuota, /Resource has been exhausted/,
    "el skill no trae el error literal que ve la docente")
  assert.match(cuota, /RESOURCE_EXHAUSTED/, "el skill no trae el código de error de Google")
})

// ---------------------------------------------------------------------------
// 2. Y dice LO MISMO que el tool `clave`
// ---------------------------------------------------------------------------

test("2. la cuota: el skill y el tool `clave` no se contradicen", () => {
  // Mismo criterio que `platformio-pio.test.mjs` con los modelos del tool y del
  // instalador: dos textos sobre la misma cosa se separan solos con el tiempo, y
  // el día que se separan la docente recibe dos verdades y no sabe cuál seguir.
  //
  // El tool es la fuente: él es el que le preguntó a Google. El skill acompaña.
  const cuota = constanteDeClave("CUOTA_AGOTADA")
  const bigPickle = constanteDeClave("AVISO_BIG_PICKLE")

  // Los hechos que los DOS tienen que afirmar, escritos como pares de regex para
  // que se evalúe el mismo hecho contra las dos fuentes.
  const hechos = [
    ["la cuota es por proyecto, no por key", /por PROYECTO, no por key/i],
    ["una key del mismo proyecto da el mismo error", /mismo proyecto[\s\S]{0,200}mismo error/i],
    ["hay que ir a otro proyecto (o a otra cuenta)", /otro proyecto/i],
    ["no rompió nada", /no rompiste nada|no rompió nada/i],
    ["el límite se renueva solo", /se renueva sol/i],
    ["existe la salida de Big Pickle", /Big Pickle/],
  ]
  for (const [hecho, re] of hechos) {
    assert.match(cuota, re, `clave.ts (CUOTA_AGOTADA) ya no dice: ${hecho}`)
    assert.match(skillPlano, re, `el skill no dice lo mismo que clave.ts: ${hecho}`)
  }

  // El aviso de Big Pickle, palabra por palabra en lo que importa.
  assert.match(bigPickle, /usar lo que se escribe en el chat para mejorar el modelo/i,
    "clave.ts perdió el aviso de privacidad de Big Pickle")
  assert.match(skillPlano, /usar lo que se escribe en el chat para mejorar el modelo/i,
    "el skill no repite el aviso de privacidad de Big Pickle")

  // Los dos mandan al MISMO lugar a sacar la key. Dos direcciones distintas para
  // lo mismo es la clase de detalle que deja a alguien dando vueltas.
  assert.match(cuota, /https:\/\/aistudio\.google\.com\/apikey/,
    "clave.ts ya no manda a aistudio.google.com/apikey")
  assert.match(skillPlano, /https:\/\/aistudio\.google\.com\/apikey/,
    "el skill manda a otro lado que clave.ts a sacar la key")

  // Y la contradicción explícita: nada de "creá una key nueva" a secas, que es
  // exactamente lo que hicieron tres veces y no podía funcionar.
  assert.doesNotMatch(skillPlano, /la cuota (?:gratuita )?es por key/i,
    "el skill dice que la cuota es por key: es al revés, y es el error que costó la tarde")
  assert.doesNotMatch(skillPlano, /(?:crea|creá|sacá|conseguí) (?:una )?key nueva del mismo proyecto/i,
    "el skill manda a crear una key del mismo proyecto")
})

// ---------------------------------------------------------------------------
// 3. Las otras dos varadas: key rechazada y no llegar a Google
// ---------------------------------------------------------------------------

test("3. la key rechazada y la red cortada también están traducidas", () => {
  // Otra vez por sección: es la única forma de que se mida lo que se cree medir.

  // --- Key inválida o revocada -----------------------------------------------
  const invalida = plano(seccionQueContiene(skill, "API_KEY_INVALID"))
  assert.match(invalida, /API key not valid/, "el skill no trae el error literal de key inválida")
  assert.match(invalida, /mal copiada|se cortan|copiarla entera/i,
    "el skill no nombra la causa más común de una key rechazada (se corta al copiar)")
  assert.match(invalida, /no rompiste nada|no rompió nada|Tampoco rompió/i,
    "la sección de la key rechazada tampoco puede dejarla creyendo que arruinó algo")
  // La key compartida vieja, que hoy está muerta en cada máquina que la tenga.
  assert.match(invalida, /0\.3\.75/, "el skill no menciona la key compartida de las versiones viejas")
  assert.match(invalida, /https:\/\/aistudio\.google\.com\/apikey/,
    "la sección de la key rechazada no dice dónde sacar una nueva")

  // --- Sin internet, o el filtro de la escuela --------------------------------
  const red = plano(seccionQueContiene(skill, "ETIMEDOUT"))
  assert.match(red, /filtro de contenido/i,
    "la sección de la red no nombra el filtro de contenido de la escuela, que es la causa real")
  assert.match(red, /no avisa|sin avisar|silencio/i,
    "no explica lo peor del filtro: que no avisa que bloqueó, se queda colgado")
  assert.match(red, /referente técnico/i,
    "el skill no dice a quién recurrir cuando la red es el problema")
  // Acá el tool contesta «no pude probarla», que NO es «no sirve»: la diferencia
  // es toda la información que hay.
  assert.match(red, /no pude probarla/i,
    "la sección de la red no ata el síntoma con lo que devuelve el tool `clave`")
  // Y que casi todo el bot sigue andando sin Google: una docente a la que sólo le
  // contás lo que se rompió cree que se rompió todo.
  assert.match(red, /no necesita Google|sigue andando|seguir trabajando/i,
    "el skill no dice qué SÍ puede seguir haciendo mientras no llega a Google")
})

// ---------------------------------------------------------------------------
// 4. El 404 NO manda a mirar la red
// ---------------------------------------------------------------------------

test("4. el modelo retirado (404) no manda a mirar la red", () => {
  // Es la rama que `clave.ts` ya trata como caso propio, y por la misma razón: si
  // el 404 cayera en el cajón de "no pude probarla", el texto culparía a la red.
  // Y la red anda: contestó Google. Mandarla a pelearse con el proxy de la escuela
  // por esto es hacerle perder la tarde en el lugar equivocado, y encima ninguna
  // key nueva lo arregla.
  const seccion = seccionQueContiene(skill, "NOT_FOUND")
  const bloque = plano(seccion)

  assert.match(bloque, /NOT_FOUND/, "la sección del 404 no trae el error literal")
  assert.match(bloque, /`\/actualizar`|tool `actualizar`/,
    "la sección del 404 no manda a actualizar, que es lo único que lo arregla")
  assert.match(bloque, /no es la red|la red anda|la red funciona/i,
    "la sección del 404 no aclara que la red no es el problema")
  assert.match(bloque, /ninguna key nueva|no hay key nueva/i,
    "la sección del 404 no aclara que ninguna key nueva lo arregla")

  // Y lo que NO puede decir: mandarla a revisar internet, a probar desde otra red
  // o a pelearse con el filtro de la escuela.
  //
  // La sección NOMBRA esas tres cosas a propósito, para prohibirlas — es el
  // párrafo «Lo que NO hay que decir acá». Así que primero se exige que ese
  // párrafo exista y nombre la red (si alguien lo borra, rojo), y recién después
  // se busca el consejo prohibido en TODO EL RESTO de la sección, que es donde
  // aparecería si volviera como consejo de verdad.
  const iProhibicion = seccion.indexOf("Lo que NO hay que decir")
  assert.ok(iProhibicion > 0,
    "la sección del 404 perdió el párrafo que prohíbe mandar a mirar la red")
  const finProhibicion = seccion.indexOf("\n\n", iProhibicion)
  const prohibicion = plano(seccion.slice(iProhibicion, finProhibicion))
  assert.match(prohibicion, /internet|red|filtro/i,
    "el párrafo de prohibición ya no nombra la red: dejó de prohibir lo que tenía que prohibir")

  const consejo = plano(seccion.slice(0, iProhibicion) + seccion.slice(finProhibicion))
  assert.doesNotMatch(consejo, /(?:revis|fijate|prob)[a-zá]*\s+(?:si hay |tu |la )?(?:internet|conexión|red)\b/i,
    "la sección del 404 manda a revisar la red, y la red anda: contestó Google")
  assert.doesNotMatch(consejo, /desde otra red/i,
    "la sección del 404 manda a probar desde otra red")
  assert.doesNotMatch(consejo, /filtro de (?:contenido|la escuela)/i,
    "la sección del 404 culpa al filtro de la escuela")

  // Y clave.ts, la otra mitad de la misma verdad, tampoco.
  const modeloIdo = constanteDeClave("MODELO_IDO")
  assert.match(modeloIdo, /no es la red|la red anda/i, "clave.ts (MODELO_IDO) perdió el 'no es la red'")
  assert.match(modeloIdo, /\/actualizar/, "clave.ts (MODELO_IDO) ya no manda a `/actualizar`")
})

// ---------------------------------------------------------------------------
// 5. Nada de esto autoriza a afirmar lo que el tool no dijo
// ---------------------------------------------------------------------------

test("5. lo nuevo no autoriza al modelo a afirmar lo que el tool no dijo", () => {
  // Es la regla que ya custodian `/reparar` («Nunca digas que algo quedó instalado
  // si el tool no lo dijo») y `/clave` («No pude probarla NO es anda»). Un skill
  // que trae los textos lindos escritos es exactamente el lugar donde el modelo
  // podría recitarlos SIN haber llamado al tool, y quedarse tan tranquilo.
  for (const [donde, texto] of [["el skill", skillPlano], ["el prompt", plano(prompt)]]) {
    assert.match(texto, /no pude probarla.{0,20}no es.{0,20}anda/i,
      `${donde} no repite que «no pude probarla» NO es «anda»`)
    assert.match(texto, /no (?:lo )?(?:digas|afirmes)|Contá lo que dice el tool, no lo que suponés/i,
      `${donde} no le prohíbe al modelo afirmar por su cuenta`)
  }
  assert.match(skillPlano, /nunca para afirmar en su lugar|no lo que suponés/i,
    "el skill no acota su propio alcance: traducir lo que el tool devolvió, no reemplazarlo")

  // El skill manda a EJECUTAR el tool, no a describirlo.
  assert.match(skillPlano, /EJECUTÁ el tool `clave`|ejecutá el tool `clave`/,
    "el skill no le dice al modelo que ejecute el tool `clave`")

  // Y la regla de la key, que no se negocia: nunca en el chat.
  for (const [donde, texto] of [["el skill", skillPlano], ["el prompt", plano(prompt)]]) {
    assert.match(texto, /nunca repitas la key en el chat/i, `${donde} no prohíbe repetir la key en el chat`)
  }
})

// ---------------------------------------------------------------------------
// 6. El disparo: sin que la docente sepa que existe un comando
// ---------------------------------------------------------------------------

test("6. el prompt dispara solo, sin esperar a que la docente escriba /clave", () => {
  // El criterio del pedido, literal: «tiene que dispararse cuando la docente ve el
  // error, sin que ella sepa que existe un comando para eso». Por eso el
  // disparador vive en el PROMPT, que se lee siempre, y no sólo en el skill, que
  // se carga si algo lo activa.
  const promptPlano = plano(prompt)

  assert.match(prompt, /^##\s.*REGLA CRÍTICA.*(?:BOT|bot)/m,
    "el prompt no tiene una regla propia para los errores del propio bot")

  // Las señales por las que se reconoce el error, incluida la del caso real.
  for (const señal of ["Resource has been exhausted", "API key not valid", "AI_APICallError", "NOT_FOUND"]) {
    assert.ok(prompt.includes(señal), `el prompt no reconoce la señal \`${señal}\``)
  }

  // Que el skill exista para el modelo, y que la acción sea ejecutar el tool.
  assert.match(promptPlano, /`errores-del-bot`/, "el prompt nunca nombra el skill `errores-del-bot`")
  assert.match(promptPlano, /EJECUTÁ el tool `clave` con `accion: "estado"`/,
    "el prompt no manda a ejecutar el tool `clave` al ver el error")
  assert.match(promptPlano, /No esperes a que escriba `\/clave`/,
    "el prompt permite quedarse esperando un comando que la docente no sabe que existe")
  assert.match(promptPlano, /no sabe que ese comando existe/i,
    "el prompt no explica por qué no hay que esperar el comando")

  // Y que no se confunda con el skill de Arduino, que es de lo que hay hoy.
  assert.match(promptPlano, /`errores-comunes` es de Arduino/i,
    "el prompt no distingue los errores del bot de los errores de Arduino")
})
