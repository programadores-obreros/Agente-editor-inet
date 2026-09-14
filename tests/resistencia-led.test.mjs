// La resistencia del LED: una sola respuesta en todo el repo, y los matices intactos.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El repo se contradecía a sí mismo sobre un dato
// que el docente lee antes de ir a comprar: cuánto vale la limitadora del LED.
// La ficha `03-led.html` decía "en 5 V, 220 ohm — es el valor de los kits", tres
// proyectos INET listaban 220 Ω en su lista de materiales, y al mismo tiempo seis
// skills y el pinouts.json decían 330 Ω "en 5V (UNO)". Las dos son eléctricamente
// correctas (220 → 13,6 mA, 330 → 9 mA, el pin aguanta 20), así que ningún test
// de seguridad las iba a atrapar: el daño era de coherencia. Si en la caja del kit
// vienen 220 y el bot dice 330, el docente sale a comprar lo que ya tiene.
//
// El dueño del producto unificó en 220 Ω. Estos tests fijan esa decisión y, sobre
// todo, protegen las DOS cosas que una unificación apurada rompe:
//
//  1. que la contradicción no vuelva por la puerta de atrás (alguien copia un
//     tutorial de 5 V y reinstala el "330 si es UNO" en un skill);
//  2. que al corregir no se haya barrido el matiz de 3,3 V — el aviso de que un
//     LED azul/blanco/InGaN (Vf ~3,2 V) NO prende sobre 3,3 V con ninguna
//     resistencia, y que ahí el piso es 100 Ω. Ese aviso es lo único que explica
//     un LED sano que no enciende, y desaparece fácil cuando se hace un
//     buscar-y-reemplazar de "330" por "220".
//
// Y fija la fuente escrita de los pines del UNO con letra chica (D0/D1/D13), que
// antes no existía en ningún lado: el tool `circuito` los manda al final del pool
// y avisa sobre ellos, pero la regla de la casa es que el tool no puede ser la
// fuente de un dato de hardware.
//
// Corre con: node --test tests/   (sin dependencias).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const SKILLS = join(REPO, "opencode/skills")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

/** Todos los .md bajo opencode/skills (incluidos proyectos-inet y diseño curricular). */
function mdsDeSkills() {
  const out = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (n.endsWith(".md")) out.push(p)
    }
  }
  walk(SKILLS)
  return out
}

/**
 * Normaliza para comparar VALOR + CONTEXTO sin depender de cómo se escribió el
 * ohm ni los espacios: "330Ω en 5V", "330 ohm en 5 V" y "330 Ω  en  5v" caen
 * todas en el mismo string "330en5v".
 */
function normalizar(texto) {
  return texto
    .toLowerCase()
    // Ojo: `toLowerCase()` convierte Ω (U+03A9) en ω (U+03C9). Hay que sacar las
    // dos formas o el filtro no borra nada y el test queda vacío — pasa siempre,
    // aunque la frase prohibida esté ahí. Fue exactamente lo que pasó al escribirlo.
    .replace(/[Ωω]|ohms?/g, "")
    .replace(/[\s.,]/g, "")
}

// Las formas EXACTAS en que el repo decía 330 para 5 V / UNO antes de unificar.
// Cada una es una frase que existió y que mandaba al docente a comprar de más.
const PROHIBIDAS = [
  "330en5v", // "330Ω en 5V (UNO)"      — gotchas-hardware, diagramas-conexion
  "330en5", // "330 Ω en 5 V"           — variante sin la V pegada
  "330siesuno", // "(330Ω si es UNO/5V)"— modulos-avanzados (7 seg y RGB)
  "330enuno", // "330Ω en UNO a 5V"     — modulos-avanzados
  "330unoa5v", // "330Ω UNO a 5V"
  "330paraeluno",
  "330paraununo",
]

/**
 * Y el mismo dato dicho al revés, que es como sobrevivía en la prosa:
 * "en 5V (UNO) 330Ω anda con cualquier LED" (checklist-seguridad),
 * "los 330Ω son una regla de 5V" (diagramas-conexion),
 * "Sobre 5 V los 330 Ω andan" (esp32).
 * La ventana corta (≤14 caracteres normalizados) es a propósito: ata el 330 al
 * 5V/UNO de la MISMA frase y no marca un párrafo que nombra las dos cosas
 * lejos una de otra para EXPLICAR la diferencia — que es justo lo que queremos
 * que se pueda seguir escribiendo. Ojo: "3,3V" normaliza a "33v", no a "5v".
 *
 * ── POR QUÉ LA CLASE DE CARACTERES ES ASÍ DE ANCHA ────────────────────────
 *
 * Era `[a-z()/]`, y esa clase cazaba las dos frases históricas y NADA MÁS. Dejaba
 * afuera tildes, ñ, dígitos y la puntuación de markdown (`*`, `|`, `-`, `:`, `_`),
 * o sea: la red estaba escrita en un castellano sin tildes y en texto plano,
 * mientras el repo está escrito en castellano rioplatense y en markdown, donde
 * `**negrita**`, las tablas con `|` y un "usá" son la NORMA, no la excepción.
 *
 * Medido: de estas cinco líneas, la red vieja cazaba UNA.
 *
 *   `los 330 ohm son la regla del UNO a 5V`      → cazada (la única)
 *   `En 5V (UNO) el LED va con **330 Ω** en serie.` → SOBREVIVÍA (negrita)
 *   `En 5V (UNO) usá 330 Ω.`                     → SOBREVIVÍA (la tilde de "usá")
 *   `| LED | UNO 5V | 330 Ω |`                   → SOBREVIVÍA (tabla)
 *   `- UNO (5 V): 330 Ω en serie con el LED`     → SOBREVIVÍA (viñeta y dos puntos)
 *
 * Las cinco están abajo como autoverificación del test, igual que hace el test 9.
 *
 * Lo que NO se toca es la ventana de 14: es la que impide marcar un párrafo que
 * nombra 3,3 V y 5 V lejos uno de otro para EXPLICAR la diferencia. Se amplía QUÉ
 * caracteres pueden estar en el medio, no CUÁNTOS.
 */
const ENTRE = "[a-z0-9áéíóúüñ()/*|:_-]"
const PROHIBIDAS_INVERTIDAS = [
  new RegExp(`5v${ENTRE}{0,14}330`),
  new RegExp(`330${ENTRE}{0,14}5v`),
  new RegExp(`uno${ENTRE}{0,14}330`),
  new RegExp(`330${ENTRE}{0,14}uno`),
]

test("1. ningún skill vuelve a decir «330Ω en 5V» ni «330Ω si es UNO»", () => {
  // SE ROMPÍA ASÍ: gotchas-hardware, diagramas-conexion, checklist-seguridad y
  // modulos-avanzados prescribían 330 Ω para el UNO mientras la ficha 03-led y
  // los proyectos 03/06/09 decían 220 Ω. El docente recibía las dos respuestas
  // según qué skill cargara el bot, y la del kit era la de 220.
  const hallazgos = []
  for (const archivo of mdsDeSkills()) {
    const rel = relative(REPO, archivo)
    for (const [i, linea] of readFileSync(archivo, "utf8").split("\n").entries()) {
      if (!linea.includes("330")) continue
      // El ÚNICO 330 Ω legítimo del repo no es de un LED: es la limitadora del
      // buzzer PASIVO de la cerradura (09-cerradura.md), y tiene su propia
      // derivación sourceada contra el límite de 20 mA del pin. No lo toques.
      if (/buzzer|piezo|zumbador/i.test(linea)) continue
      const n = normalizar(linea)
      const mala = PROHIBIDAS.find((p) => n.includes(p)) || PROHIBIDAS_INVERTIDAS.find((re) => re.test(n))
      if (mala) hallazgos.push(`${rel}:${i + 1} [${mala}] → ${linea.trim()}`)
    }
  }
  assert.deepEqual(hallazgos, [], "el valor de la limitadora en 5 V es 220 Ω (el de los kits): ver ficha hojas/03-led.html")

  // ── el test se prueba a sí mismo, igual que el test 9 ────────────────────
  //
  // La red vieja (`[a-z()/]`) cazaba SÓLO la primera de estas cinco. Las otras
  // cuatro son las formas en que este repo escribe de verdad: negrita markdown,
  // una tilde, una fila de tabla y una viñeta. Si alguien afloja la clase de
  // caracteres de arriba, salta acá y no en un skill que le miente al docente.
  const DEBE_CAZAR = [
    "los 330 ohm son la regla del UNO a 5V",
    "En 5V (UNO) el LED va con **330 Ω** en serie.",
    "En 5V (UNO) usá 330 Ω.",
    "| LED | UNO 5V | 330 Ω |",
    "- UNO (5 V): 330 Ω en serie con el LED",
  ]
  for (const linea of DEBE_CAZAR) {
    const n = normalizar(linea)
    const mala = PROHIBIDAS.find((p) => n.includes(p)) || PROHIBIDAS_INVERTIDAS.find((re) => re.test(n))
    assert.ok(mala, `el filtro dejó pasar una línea que prescribe 330 Ω para el UNO: ${linea}  (normalizada: "${n}")`)
  }

  // Y la contracara, que es la razón por la que la ventana sigue siendo de 14:
  // un párrafo que nombra las dos tensiones LEJOS una de otra para EXPLICAR la
  // diferencia se tiene que poder seguir escribiendo. Si esto se pone rojo, la
  // red se volvió tan ancha que ya no distingue prescribir de explicar.
  const DEBE_DEJAR_PASAR = [
    "En 3,3 V el LED rojo anda con 220 Ω. Sobre 5 V la cuenta da otra cosa, y por eso hay quien recomienda 330 Ω: nosotros usamos 220 Ω, que es el valor de los kits.",
    "La resistencia de 330 Ω que aparece en muchos tutoriales viene de una época en que el kit traía otra cosa; en este repo el valor es 220 Ω.",
  ]
  for (const linea of DEBE_DEJAR_PASAR) {
    if (/buzzer|piezo|zumbador/i.test(linea)) continue
    const n = normalizar(linea)
    const mala = PROHIBIDAS.find((p) => n.includes(p)) || PROHIBIDAS_INVERTIDAS.find((re) => re.test(n))
    assert.ok(!mala, `el filtro marcó un párrafo que EXPLICA la diferencia en vez de prescribir 330: ${linea}  [${mala}]`)
  }
})

test("2. pinouts.json no reintroduce el 330 en las notas del semáforo", () => {
  // SE ROMPÍA ASÍ: el pinouts.json se declara «fuente canonica» en su _meta y
  // anotaba "330 en serie" en los seis LED del proyecto 01 — contra la lista de
  // materiales de ese MISMO proyecto ("10× resistencia de 220 Ω"). La fuente
  // canónica contradecía al documento del que deriva.
  const crudo = leer("opencode/tecniabot-web/pinouts.json")
  const pinouts = JSON.parse(crudo)
  assert.doesNotMatch(crudo, /330\s+en\s+serie/, "ninguna nota de pinouts.json dice «330 en serie»")

  const notas = []
  for (const [slug, proyecto] of Object.entries(pinouts)) {
    if (slug === "_meta") continue
    for (const [placa, niveles] of Object.entries(proyecto)) {
      if (placa === "titulo") continue
      for (const [nivel, pines] of Object.entries(niveles)) {
        for (const p of pines) if (p.nota) notas.push(`${slug}/${placa}/${nivel}: ${p.nota}`)
      }
    }
  }
  const enSerie = notas.filter((n) => n.includes("en serie"))
  assert.ok(enSerie.length > 0, "el semáforo tiene notas de limitadora en serie")
  for (const n of enSerie) assert.match(n, /220 en serie/, `nota con otro valor: ${n}`)

  // Y el _meta, que se declara canónico, tiene que dar el ejemplo correcto:
  // si el ejemplo dice 330 mientras los datos dicen 220, el archivo se
  // contradice a sí mismo y el próximo que lo edite copia el ejemplo.
  assert.doesNotMatch(pinouts._meta.campos.nota, /330/, "el _meta ejemplifica con el valor de la casa, no con el viejo")
})

test("3. el matiz de 3,3 V sigue vivo: el LED azul que no prende y el piso de 100 Ω", () => {
  // SE ROMPÍA ASÍ (el riesgo de la corrección, no del bug original): unificar en
  // 220 con un buscar-y-reemplazar se come el aviso de que en 3,3 V un LED
  // azul/blanco/verde InGaN (Vf ~3,2 V) NO prende con NINGUNA resistencia —
  // porque no queda tensión, no porque el valor esté mal elegido. Sin ese
  // párrafo, el alumno cambia resistencias durante media clase contra la física.
  const esp32 = leer("opencode/skills/esp32/SKILL.md")
  assert.match(esp32, /NO PRENDE/, "esp32 conserva la fila del LED que no enciende en 3,3 V")
  assert.match(esp32, /InGaN/, "esp32 conserva el caso del verde InGaN (el color no dice la tensión)")
  assert.match(esp32, /100\s*Ω/, "esp32 conserva el piso de 100 Ω, que es específico de 3,3 V")
  assert.match(esp32, /no hay valor que sirva|no hay con que hacerlo andar/i,
    "esp32 dice que en 3,3 V no se arregla cambiando la resistencia")

  // Y el aviso no puede vivir sólo en el skill `esp32`: los dos skills que un
  // docente abre para cablear tienen que llevarlo también.
  for (const rel of [
    "opencode/skills/gotchas-hardware/SKILL.md",
    "opencode/skills/diagramas-conexion/SKILL.md",
    "opencode/skills/checklist-seguridad/SKILL.md",
  ]) {
    const md = leer(rel)
    assert.match(md, /InGaN/, `${rel} perdió el aviso del LED azul/blanco/InGaN en 3,3 V`)
    assert.match(md, /3[,.]3\s*V/, `${rel} perdió la distinción entre 3,3 V y 5 V`)
  }
  assert.match(leer("opencode/skills/checklist-seguridad/SKILL.md"), /100\s*Ω/,
    "el checklist perdió el piso de 100 Ω en 3,3 V")
})

test("4. el valor de 220 Ω está escrito como el de los kits, no suelto", () => {
  // SE ROMPÍA ASÍ: sin el PORQUÉ, el próximo que lea "220" y encuentre un
  // tutorial que dice 330 lo va a "corregir" de vuelta. El argumento que cerró
  // la discusión es el de la ficha 03-led: es el valor que viene en la caja.
  const ficha = leer("opencode/skills/fichas/hojas/03-led.html")
  assert.match(ficha, /220 ohm/, "la ficha 03-led sigue siendo la fuente del valor de 5 V")
  assert.match(ficha, /Es el valor de los kits/, "la ficha conserva el argumento que definió la decisión")

  for (const rel of [
    "opencode/skills/gotchas-hardware/SKILL.md",
    "opencode/skills/diagramas-conexion/SKILL.md",
    "opencode/skills/checklist-seguridad/SKILL.md",
    "opencode/skills/modulos-avanzados/SKILL.md",
  ]) {
    assert.match(leer(rel), /220\s*Ω/, `${rel} tiene que nombrar los 220 Ω`)
  }
  assert.match(leer("opencode/skills/gotchas-hardware/SKILL.md"), /kits?/i,
    "gotchas-hardware explica POR QUÉ son 220: es lo que viene en el kit")
})

test("5. gotchas-hardware documenta D0/D1 y D13 del UNO, con el motivo", () => {
  // SE ROMPÍA ASÍ: no había NINGUNA línea en el repo que explicara por qué el
  // tool `circuito` manda D0, D1 y D13 al final del pool de pines del UNO y
  // avisa sobre ellos. El dato de hardware vivía sólo dentro del tool, que es
  // justo lo que la regla de la casa prohíbe: el tool no es fuente de verdad.
  const md = leer("opencode/skills/gotchas-hardware/SKILL.md")

  // D0/D1: el qué y el porqué (serie por hardware = el mismo canal del USB).
  assert.match(md, /D0\s*\(RX\)/, "gotchas-hardware nombra D0 (RX)")
  assert.match(md, /D1\s*\(TX\)/, "gotchas-hardware nombra D1 (TX)")
  assert.match(md, /serie por hardware/i, "dice QUÉ son D0/D1: el serie por hardware")
  assert.match(md, /mismo canal del USB|mismo canal que el USB/i, "dice por qué duele: comparten el canal del USB")
  assert.match(md, /carga de sketches|no programa/i, "dice la consecuencia: no se puede cargar el sketch")
  assert.match(md, /Monitor Serie/, "dice la otra consecuencia: el Monitor Serie")
  // La fuente: el bug real del material de 2019, no una opinión.
  assert.match(md, /06-estacionamiento/, "cita la fuente del bug (proyecto 06)")

  // D13: LED «L» soldado + SCK de SPI + ya trae limitadora.
  assert.match(md, /D13/, "gotchas-hardware nombra D13")
  assert.match(md, /LED «L»|LED "L"/, "dice qué tiene D13 pegado: el LED «L»")
  assert.match(md, /SCK/, "dice que D13 es además SCK de SPI")
  assert.match(md, /limitadora incorporada|limitadora propia/i,
    "dice que el LED de placa ya trae su limitadora (no se le agrega resistencia)")
  assert.match(md, /12-calefaccion|placas|01-arduino-uno/, "cita alguna fuente del dato de D13")
})

test("6. el UNO tiene escrito lo que NO tiene: ni strapping, ni solo-entrada, ni flash", () => {
  // SE ROMPÍA ASÍ: las 33 advertencias del tool estaban escritas en clave ESP32
  // y 26 se arrastraban tal cual al UNO, donde varias son FALSAS. El dato de que
  // en el UNO no hay pines prohibidos sólo existía para la placa Educablocks
  // (`educabot`), o sea en el skill de otra placa: un lector del UNO pelado no
  // lo encontraba nunca.
  for (const rel of ["opencode/skills/gotchas-hardware/SKILL.md", "opencode/skills/placas/SKILL.md"]) {
    const md = leer(rel)
    assert.match(md, /strapping/i, `${rel} menciona los strapping pins`)
    assert.match(md, /no hay strapping pins|nada de esto existe|ninguno/i,
      `${rel} tiene que decir que en el UNO no hay strapping pins`)
    assert.match(md, /solo-entrada|sólo entrada|solo entrada/i, `${rel} habla de los pines de solo-entrada`)
  }
  assert.match(leer("opencode/skills/gotchas-hardware/SKILL.md"), /flash/i,
    "gotchas-hardware aclara que en el UNO tampoco hay pines de flash")
})

test("7. el divisor del HC-SR04 está marcado como cosa del ESP32 en TODAS las tablas", () => {
  // SE ROMPÍA ASÍ: `sensores` declara en su encabezado que está escrito en clave
  // ESP32, pero sus tablas decían "con divisor de tensión" a secas. Un docente
  // que abría SÓLO ese skill (el más natural para buscar el HC-SR04) se llevaba
  // dos resistencias de más y dos uniones más donde falla el cable. El único
  // lugar del repo que decía la verdad era `educabot`: el skill de otra placa.
  const sensores = leer("opencode/skills/sensores/SKILL.md")
  assert.match(sensores, /en UNO va directo|en UNO el ECHO va directo|entra directo al pin/i,
    "sensores tiene que decir que en UNO el ECHO va directo")
  assert.match(sensores, /sin divisor|NO va divisor|no hace falta/i, "sensores dice explícitamente que en UNO no va divisor")

  // Las tres tablas/renglones que lo PRESCRIBÍAN sin aclarar la placa. (Las
  // líneas que dicen "NO lleva divisor" —el PIR, por ejemplo— no son el defecto:
  // el defecto es mandar a ponerlo sin decir en cuál placa.)
  for (const linea of sensores.split("\n")) {
    if (!/ECHO|HC-SR04/i.test(linea)) continue // el divisor del LDR es otra cosa
    if (/\b(no|sin|NO)\s+(lleva|va|hace falta|necesita)\b|sin divisor/i.test(linea)) continue
    if (!/(con|\+|necesitás|necesita|pasar por (un|el))\s*\**\s*divisor/i.test(linea)) continue
    assert.match(linea, /ESP32|UNO/,
      `esta línea manda a poner divisor sin decir en qué placa: ${linea.trim()}`)
  }

  // Y el checklist, que es el skill que se carga JUSTO antes de dar corriente.
  const checklist = leer("opencode/skills/checklist-seguridad/SKILL.md")
  assert.match(checklist, /en\s+\*\*UNO va directo\*\*|en UNO va directo|sólo en ESP32/i,
    "checklist-seguridad tiene que acotar el divisor al ESP32")
})

test("8. el LCD I²C y el analogRead del UNO se encuentran desde el skill del UNO", () => {
  // SE ROMPÍA ASÍ: el dato de que en UNO el conversor de nivel del LCD I²C no
  // hace falta vivía en un párrafo largo al final de checklist-seguridad, fuera
  // de la tabla por componente que es lo que la gente lee. Y el 0-1023 vivía en
  // el skill `arduino` pero no en `sensores`, que es donde se lee un analógico.
  const checklist = leer("opencode/skills/checklist-seguridad/SKILL.md")
  const filaLcd = checklist.split("\n").find((l) => /^\|\s*LCD 16x2/.test(l))
  assert.ok(filaLcd, "checklist-seguridad tiene la fila del LCD 16x2 en la tabla por componente")
  assert.match(filaLcd, /UNO/, "la fila del LCD tiene que nombrar al UNO, no sólo al ESP32")
  assert.match(checklist, /Con \*\*Arduino UNO\*\* no hay problema/,
    "checklist conserva la conclusión del LCD en UNO (5V y listo)")

  const sensores = leer("opencode/skills/sensores/SKILL.md")
  assert.match(sensores, /0-1023/, "sensores tiene que decir cuánto da analogRead en UNO")
  assert.match(sensores, /0-4095/, "y seguir diciendo cuánto da en ESP32")
})

/**
 * Todos los .ts de `opencode/tool`, SIN comentarios.
 *
 * Sacar los comentarios no es cosmética: es la trampa en la que ya caímos dos
 * veces en este repo. El test que prohíbe el enum de placas en `perfil.ts` se
 * disparaba contra el comentario que EXPLICA por qué se sacó el enum, y un test
 * de acá se iba a disparar contra el comentario que explique por qué ya no
 * decimos 330. Lo que se prohíbe es lo que el tool AFIRMA, no lo que cuenta de
 * su propia historia — contar la historia es justamente lo que queremos.
 */
function tsDeTools() {
  const dir = join(REPO, "opencode/tool")
  return readdirSync(dir)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => {
      const crudo = readFileSync(join(dir, n), "utf8")
      // Reemplazo por espacios, no por vacío: así los números de línea se mantienen.
      const sinComentarios = crudo
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length))
      return { rel: `opencode/tool/${n}`, lineas: sinComentarios.split("\n") }
    })
}

test("9. los tools tampoco reinstalan el 330: sus textos van al prompt del modelo", () => {
  // SE ROMPÍA ASÍ: unificamos los nueve skills en 220 Ω y la contradicción seguía
  // entrando por la ventana. Los `.describe()` de un tool NO son documentación
  // interna: viajan en el schema, o sea en el prompt, o sea el modelo los copia.
  // `imprimible.ts` daba de ejemplo '3x resistencia 330Ω' y 'LED rojo → GPIO12
  // con 330Ω'. Un docente pedía la hoja para repartir en el aula y se llevaba
  // impreso, en papel, el valor que los skills acababan de desmentir.
  // Y `circuito.ts` afirmaba en la advertencia del LED que "los 330 ohm son la
  // regla del UNO a 5V" — el tool que DIBUJA, contradiciendo a los nueve skills.
  //
  // POR QUÉ LA REGLA ACÁ ES MÁS DURA QUE EN EL TEST 1. En un skill, un "330 Ω"
  // suelto puede ser prosa que EXPLICA la diferencia entre 3,3 V y 5 V, y eso se
  // tiene que poder seguir escribiendo: por eso el test 1 exige que el 330 esté
  // atado a un "5V"/"UNO" en la misma frase.
  // En un tool no hay prosa: hay ejemplos, y un ejemplo es una ORDEN. El modelo
  // no lee '3x resistencia 330Ω' como una comparación, lo copia a la hoja.
  // Por eso acá alcanza con que el 330 sea un valor de resistencia.
  //
  // Lo escribí primero con el filtro del test 1 y NO cazaba las dos líneas de
  // `imprimible.ts` — justo las que había que cazar, porque el ejemplo no nombra
  // ni al UNO ni a los 5 V. Un test que deja pasar el bug que lo motivó es peor
  // que no tenerlo. Queda la verificación abajo para que no vuelva a aflojarse.
  const esValorDeResistencia = /330\s*(Ω|ohms?)/i
  const hallazgos = []
  for (const { rel, lineas } of tsDeTools()) {
    for (const [i, linea] of lineas.entries()) {
      if (!esValorDeResistencia.test(linea)) continue
      if (/buzzer|piezo|zumbador/i.test(linea)) continue // el 330 legítimo (ver test 1)
      hallazgos.push(`${rel}:${i + 1} → ${linea.trim()}`)
    }
  }
  assert.deepEqual(hallazgos, [], "un tool no puede prescribir 330 Ω: sus ejemplos son órdenes para el modelo")

  // El test se prueba a sí mismo contra las dos líneas reales que motivaron esto.
  // Si alguien ablanda el filtro de arriba, esto se pone rojo acá y no en producción.
  const comoEstabaAntes = [
    "      .describe(\"Lista de materiales, uno por elemento con cantidad (ej: '3x LED (rojo, amarillo, verde)', '3x resistencia 330Ω', '1x protoboard').\"),",
    "      .describe(\"Conexiones, una por elemento (ej: 'LED rojo (ánodo) → GPIO12 con 330Ω', 'LED rojo (cátodo) → GND'). Se muestran como tabla.\"),",
  ]
  for (const linea of comoEstabaAntes) {
    assert.ok(esValorDeResistencia.test(linea), `el filtro tiene que cazar esta línea, que estuvo de verdad en imprimible.ts: ${linea.trim()}`)
  }
})

test("10. la placa QUE EL DOCENTE TIENE no vuelve a ser un enum en ningún tool", () => {
  // SE ROMPÍA ASÍ: `perfil.ts` tenía `enum(["UNO","ESP32","no sé"])` y se sacó
  // porque convertía al tool en una SEGUNDA fuente de verdad sobre qué placas
  // existen — el docente con una Educablocks, un Bhoot o una Mis Ladrillos no
  // tenía dónde caer. Se arregló ahí y SOBREVIVIÓ en `imprimible.ts`, con el
  // mismo enum de dos placas, en el tool que imprime el papel que el pibe se
  // lleva a la mesa de trabajo: le rotulábamos una placa que no es la suya.
  //
  // LA DISTINCIÓN QUE HACE ESTE TEST, y que es la parte que importa:
  //
  //  · `perfil` GUARDA y `imprimible` ROTULA la placa que el docente tiene en la
  //    mano. Eso es un hecho del mundo, y el mundo tiene diez placas en el
  //    catálogo y mañana once. Un enum ahí le dice al docente que su placa no
  //    existe. Va string, y valida el catálogo del skill `placas`.
  //
  //  · `circuito` DIBUJA. Lo que puede dibujar sí es un conjunto cerrado y chico,
  //    porque cada placa necesita su pool de pines, su riel y sus advertencias
  //    escritas a mano. Ahí el enum es correcto y además es lo que hace que pedir
  //    una placa no soportada falle con un mensaje en vez de dibujar otra cosa
  //    — que es exactamente el bug que estamos arreglando.
  //
  // O sea: el enum no está prohibido por ser enum. Está prohibido donde miente
  // sobre qué placas EXISTEN. Donde declara qué placas el tool SABE DIBUJAR, es
  // la herramienta correcta. Si mañana alguien agrega un tool que guarda o
  // muestra la placa del docente, este test lo caza.
  const DIBUJAN = new Set(["opencode/tool/circuito.ts"])
  const hallazgos = []
  for (const { rel, lineas } of tsDeTools()) {
    if (DIBUJAN.has(rel)) continue
    for (const [i, linea] of lineas.entries()) {
      if (/\bplaca\s*:\s*tool\.schema[\s\S]*?\.enum\(/.test(linea)) {
        hallazgos.push(`${rel}:${i + 1} → ${linea.trim()}`)
      }
    }
  }
  assert.deepEqual(hallazgos, [], "la placa del docente se valida contra el catálogo del skill `placas`, no contra un enum del tool")

  // Y la contracara: la excepción tiene que seguir siendo verdad. Si `circuito`
  // deja de ser el tool que dibuja, o si alguien mete acá la placa del docente,
  // la lista blanca de arriba deja de tener sentido y hay que rediscutirla.
  const circuito = leer("opencode/tool/circuito.ts")
  assert.match(circuito, /wokwi-/, "la excepción vale porque `circuito` renderiza piezas Wokwi; si eso cambia, revisar la lista blanca")
})
