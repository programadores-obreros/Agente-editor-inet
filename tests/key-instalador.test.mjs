// La key de Google DEL LADO DEL INSTALADOR: que se pueda cambiar, y que no se
// afirme lo que no se verificó.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El 8 de septiembre de 2026, en una escuela, varias
// docentes se quedaron sin cuota de Google. Corrieron «Reparar Tecnia Bot»
// esperando poder pegar una key nueva y el instalador NUNCA se la pidió: la
// pregunta vivía adentro de `elseif (-not $tieneGoogle)`, así que en una compu que
// ya tiene una key guardada la rama que pregunta no se ejecuta, corras Reparar las
// veces que corras. Probaron con keys de otras cuentas: mismo error. Las keys
// nuevas nunca entraron. Reproducido en la VM de Windows 10: con key guardada no
// pregunta y `auth.json` ni se toca — misma fecha de modificación antes y después,
// que es el dato con el que se diagnosticó a distancia.
//
// Y en la misma prueba salió el segundo defecto: con la key literal
// `AIzaSyFALSA000…` el instalador imprimía «Modelo configurado:
// google/gemini-3.5-flash-lite (Gemini, con tu key de Google)». LA KEY NUNCA SE
// VALIDABA. Una credencial muerta producía exactamente el mismo mensaje que una
// que anda. Está todo en `docs/key-de-google.md`.
//
// `opencode/tool/clave.ts` resolvió las dos cosas del lado del bot. Estos tests
// custodian que los DOS instaladores hagan lo mismo, con los mismos criterios y
// los mismos textos:
//
//   1. que exista el tercer camino ("hay key → ofrecer cambiarla");
//   2. QUE EL DEFAULT SEA CONSERVAR — Enter, timeout o consola sin nadie no borran
//      ni pisan nada. Es el test más importante del archivo: un bug acá le borra la
//      key a una escuela entera sin que nadie haya pedido nada;
//   3. que `TECNIA_SIN_PROMPT` saltee también la pregunta nueva;
//   4. que la key se pruebe contra Google y se clasifiquen los CINCO resultados;
//   5. que la key viaje en el HEADER y nunca en el query string;
//   6. que "no pude probarla" NUNCA se cuente como "anda";
//   7. que el 404 (modelo retirado) no le eche la culpa a la red;
//   8. que el instalador y `/clave` no se contradigan.
//
// Son tests de FORMA sobre scripts que la CI de Linux no puede ejecutar (PowerShell)
// o que no se pueden correr sin tocar la compu (bash). Miran el código SIN
// comentarios: este repo cita los bugs en los comentarios, y una cita no es código.
//
// Corre con: node --test tests/*.test.mjs
//
// ── Regla que nos mordió en este mismo repo ──────────────────────────────────
// Un test recolectaba `return`s con el regex /return `Tenés[^`]*`/g — sólo los que
// empiezan con esa palabra. Revisaba 6 de 9 y pasaba en verde. Por eso acá, CADA
// VEZ que se recolecta por regex, se afirma también sobre el CONTEO TOTAL
// esperado: si aparece uno nuevo (o desaparece uno), el test se pone rojo y alguien
// tiene que mirarlo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (r) => readFileSync(join(REPO, r), "utf8")

const ps1 = leer("install/install.ps1")
const sh = leer("install/install.sh")
const claveTs = leer("opencode/tool/clave.ts")

/** Sin comentarios: los scripts explican los bugs citándolos, y la cita no es código. */
const sinComentariosPs = (t) => t.replace(/^\s*#.*$/gm, "")
const sinComentariosTs = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
// En bash `#` también abre comentario, pero `"#..."` adentro de un string no. Los
// scripts de este repo no tienen `#` dentro de strings en las partes que miramos,
// y sacar sólo las líneas que EMPIEZAN con `#` es conservador: nunca borra código.
const sinComentariosSh = (t) => t.replace(/^\s*#.*$/gm, "")

const ps1Codigo = sinComentariosPs(ps1)
const shCodigo = sinComentariosSh(sh)
const claveCodigo = sinComentariosTs(claveTs)

/** Los dos instaladores, para los tests que valen para los dos. */
const INSTALADORES = [
  ["install.ps1", ps1Codigo],
  ["install.sh", shCodigo],
]

/**
 * El cuerpo de un `if (...) { ... }` de PowerShell indentado a 4 espacios: desde la
 * cabecera hasta la línea que cierra con `    }`. Los bloques que miramos son de
 * puro Write-Host y no anidan llaves, así que alcanza y sobra; si alguien anida
 * algo adentro, el bloque queda corto y el test lo dice en vez de mentir.
 */
function bloquePs1(cabecera) {
  const i = ps1Codigo.indexOf(cabecera)
  assert.ok(i >= 0, `install.ps1 no tiene el bloque: ${cabecera}`)
  const j = ps1Codigo.indexOf("\n    }", i)
  assert.ok(j > i, `install.ps1: no encuentro el cierre del bloque ${cabecera}`)
  return ps1Codigo.slice(i, j)
}

/** El cuerpo de una rama de `case` de bash: desde la etiqueta hasta su `;;`. */
function bloqueSh(etiqueta) {
  const i = shCodigo.indexOf(etiqueta)
  assert.ok(i >= 0, `install.sh no tiene la rama: ${etiqueta}`)
  const j = shCodigo.indexOf("\n      ;;", i)
  assert.ok(j > i, `install.sh: no encuentro el ;; de la rama ${etiqueta}`)
  return shCodigo.slice(i, j)
}

// ---------------------------------------------------------------------------
// 1. El tercer camino: hay key -> ofrecer cambiarla
// ---------------------------------------------------------------------------

test("los dos instaladores OFRECEN cambiar la key cuando ya hay una guardada", () => {
  // El bug entero: antes había dos caminos ("no hay key -> preguntar" y "hay key ->
  // no hacer nada") y el segundo era una trampa sin salida justo para el caso en
  // que HAY que rotar la key, que es el de la cuota agotada.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.match(codigo, /Ya hay una key de Google guardada en esta compu/, `${nombre} no avisa que ya hay una key guardada`)
    assert.match(
      codigo,
      /Enter para dejarla como esta, o pega una nueva para reemplazarla \[60s\]/,
      `${nombre} no ofrece cambiar la key que ya está guardada: «Reparar» vuelve a ser una trampa sin salida`,
    )
  }
  // Y la pregunta vieja SIGUE existiendo para la compu que no tiene key.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.match(
      codigo,
      /Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode/,
      `${nombre} perdió la pregunta para la compu sin key`,
    )
  }
})

test("la pregunta por la key ya NO vive adentro de la rama «no hay key»", () => {
  // Éste es el test que habría atajado el bug original. En PowerShell la pregunta
  // vivía en `elseif (-not $tieneGoogle)`; en bash, adentro de
  // `if [ "$TIENE_GOOGLE" != "1" ]`. Que esas condiciones no envuelvan a la
  // pregunta es exactamente lo que se arregló.
  assert.doesNotMatch(
    ps1Codigo,
    /elseif \(-not \$tieneGoogle\)/,
    "install.ps1 volvió a meter la pregunta adentro de `elseif (-not $tieneGoogle)`: con key guardada no pregunta nunca",
  )
  assert.doesNotMatch(
    shCodigo,
    /if \[ "\$TIENE_GOOGLE" != "1" \]; then/,
    'install.sh volvió a envolver la pregunta en `if [ "$TIENE_GOOGLE" != "1" ]`: con key guardada no pregunta nunca',
  )
})

// ---------------------------------------------------------------------------
// 2. EL DEFAULT ES CONSERVAR. El test más importante del archivo.
// ---------------------------------------------------------------------------

test("Enter, timeout o consola sin nadie NO borran ni pisan la key guardada (install.ps1)", () => {
  // La rama del "no contestó nadie" tiene que ser SÓLO mensajes. Si algún día
  // alguien mete ahí una escritura, este test se pone rojo antes de que le borre la
  // key a un aula.
  const i = ps1Codigo.indexOf("} else {\n")
  const desde = ps1Codigo.indexOf("} else {", ps1Codigo.indexOf('} elseif ($keyFinal) {'))
  assert.ok(i >= 0 && desde > 0, "install.ps1 ya no tiene la cadena de ramas de la key")
  const hasta = ps1Codigo.indexOf("\n}", desde)
  assert.ok(hasta > desde, "no encuentro el final de la rama «nadie contestó»")
  const ramaSilencio = ps1Codigo.slice(desde, hasta)

  for (const [patron, que] of [
    [/WriteAllText\(\$AuthFile/, "escribe auth.json"],
    [/SetEnvironmentVariable/, "toca la variable de entorno con la key"],
    [/Properties\.Remove\("google"\)/, "saca la key de auth.json"],
    [/\$tieneGoogle\s*=/, "cambia la decisión del modelo"],
  ]) {
    assert.doesNotMatch(ramaSilencio, patron, `install.ps1: la rama «nadie contestó» ${que}. El silencio NO puede tocar la key.`)
  }
  // Y dice lo que hizo, que es nada.
  assert.match(ramaSilencio, /Se deja la key de Google que ya estaba guardada/, "no avisa que dejó la key como estaba")

  // El mensaje del timeout tampoco puede sugerir que se perdió algo.
  assert.match(
    ps1Codigo,
    /Sin respuesta en 60s -- se deja la key que ya estaba guardada/,
    "install.ps1: cuando se cumplen los 60 s con una key guardada, no dice que la deja",
  )
})

test("Enter, timeout o consola sin nadie NO borran ni pisan la key guardada (install.sh)", () => {
  // En bash el silencio llega solo: `read -t 60` contra /dev/null (que es lo que le
  // da Bun.spawn desde /actualizar) vuelve vacío al toque y con exit != 0, por eso
  // el `|| true`. Lo que se custodia es que con GEMINI_KEY vacío no se escriba nada.
  assert.match(
    shCodigo,
    /read -r -t 60 -p "    Enter para dejarla como esta[^\n]*" GEMINI_KEY \|\| true/,
    "install.sh: la pregunta nueva no tiene timeout o no tolera un `read` sin terminal (con set -e, eso corta el instalador)",
  )
  const desde = shCodigo.indexOf("\nelse\n", shCodigo.indexOf('elif [ -n "$GEMINI_KEY" ]; then'))
  assert.ok(desde > 0, "install.sh ya no tiene la cadena de ramas de la key")
  const hasta = shCodigo.indexOf("\nfi\n", desde)
  assert.ok(hasta > desde, "no encuentro el final de la rama «nadie contestó»")
  const ramaSilencio = shCodigo.slice(desde, hasta)

  for (const [patron, que] of [
    [/auth_quitar_google/, "saca la key de auth.json"],
    [/AUTH_FILE/, "escribe el archivo de credenciales"],
    [/TIENE_GOOGLE=/, "cambia la decisión del modelo"],
    [/\bjq\b|python3/, "invoca una herramienta que escribe JSON"],
  ]) {
    assert.doesNotMatch(ramaSilencio, patron, `install.sh: la rama «nadie contestó» ${que}. El silencio NO puede tocar la key.`)
  }
  assert.match(ramaSilencio, /Se deja la key de Google que ya estaba guardada/, "no avisa que dejó la key como estaba")
})

test("install.ps1 conserva la lectura con timeout Y la salida por pipe (las dos, o se cuelga)", () => {
  // La mecánica estaba resuelta con cuidado y se extrajo a una función para que la
  // usen los DOS prompts. Las dos mitades tienen que seguir estando:
  //   - el sondeo de [Console]::KeyAvailable con cronómetro (consola real, nadie
  //     tipeando: sin esto se cuelga para siempre);
  //   - el catch de InvalidOperationException que cae a ReadLine (consola
  //     redirigida: KeyAvailable tira excepción y un pipe nunca se cuelga).
  const fn = ps1Codigo.slice(ps1Codigo.indexOf("function Leer-KeyConTimeout"))
  assert.ok(fn.length > 0, "install.ps1 ya no tiene Leer-KeyConTimeout: la lectura se duplicó o se reescribió")
  const cuerpo = fn.slice(0, fn.indexOf("\n}\n") + 3)
  assert.match(cuerpo, /\[Console\]::KeyAvailable/, "se perdió el sondeo de teclado: con una consola sin nadie se cuelga")
  assert.match(cuerpo, /catch \[System\.InvalidOperationException\]/, "se perdió el fallback de consola redirigida")
  assert.match(cuerpo, /\[Console\]::In\.ReadLine\(\)/, "el fallback ya no lee la línea del pipe")
  assert.match(cuerpo, /\$sw\.Elapsed\.TotalSeconds -lt \$segundos/, "el cronómetro ya no acota la espera")
  // Y hay UNA sola copia de la mecánica: si aparece una segunda, las dos preguntas
  // se van a ir separando y una va a quedar sin arreglar.
  const sondeos = ps1Codigo.match(/\[Console\]::KeyAvailable/g) ?? []
  assert.equal(sondeos.length, 1, `hay ${sondeos.length} copias del sondeo de teclado en install.ps1: tiene que haber una sola`)
  // Los dos prompts la usan, con los mismos 60 s.
  const usos = ps1Codigo.match(/Leer-KeyConTimeout 60/g) ?? []
  assert.equal(usos.length, 1, `Leer-KeyConTimeout se llama ${usos.length} veces: se comparte entre los dos prompts, tiene que ser una`)
})

// ---------------------------------------------------------------------------
// 3. TECNIA_SIN_PROMPT saltea TAMBIÉN la pregunta nueva
// ---------------------------------------------------------------------------

test("TECNIA_SIN_PROMPT saltea la pregunta nueva igual que la vieja, y no borra nada", () => {
  // La CI y cualquier despliegue desatendido la definen. Si sólo salteara la
  // pregunta vieja, con una key guardada el instalador esperaría 60 s por corrida.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.match(codigo, /TECNIA_SIN_PROMPT/, `${nombre} no mira TECNIA_SIN_PROMPT`)
    // El atajo tiene que cubrir los DOS casos y decir qué hizo en cada uno.
    assert.match(
      codigo,
      /TECNIA_SIN_PROMPT esta definida: no se pregunta nada y se deja la key de Google que ya estaba/,
      `${nombre}: con TECNIA_SIN_PROMPT y una key guardada no dice que la deja (o directamente pregunta)`,
    )
    assert.match(
      codigo,
      /TECNIA_SIN_PROMPT esta definida: no se pregunta la key de Google, se sigue sin key/,
      `${nombre}: con TECNIA_SIN_PROMPT y sin key no dice que sigue sin key`,
    )
  }
  // Y la condición que saltea NO puede depender de que no haya key: ése era el bug.
  assert.doesNotMatch(
    ps1Codigo,
    /if \(-not \$tieneGoogle -and \$env:TECNIA_SIN_PROMPT\)/,
    "install.ps1: TECNIA_SIN_PROMPT vuelve a saltear sólo cuando no hay key",
  )
})

// ---------------------------------------------------------------------------
// 4. La validación existe y clasifica los CINCO casos, en los dos lenguajes
// ---------------------------------------------------------------------------

/**
 * Las tres implementaciones de la clasificación: PowerShell, el python3 embebido en
 * install.sh y el fallback de bash con curl. Están repetidas A PROPÓSITO (ningún
 * script hace dot-sourcing de otro: cada uno se copia y corre solo), igual que la
 * búsqueda de PlatformIO. Lo que las mantiene honestas es este test.
 */
const CLASIFICADORES = [
  ["install.ps1 (PowerShell)", ps1Codigo.slice(ps1Codigo.indexOf("function Clasificar-RespuestaGoogle"), ps1Codigo.indexOf("function Probar-KeyGoogle"))],
  ["install.sh (python3)", shCodigo.slice(shCodigo.indexOf("def clasificar(codigo, cuerpo)"), shCodigo.indexOf("cuerpo = json.dumps"))],
  ["install.sh (bash + curl)", shCodigo.slice(shCodigo.indexOf("clasificar_respuesta_google() {"), shCodigo.indexOf("probar_key_google() {"))],
  ["opencode/tool/clave.ts", claveCodigo.slice(claveCodigo.indexOf("if (res.ok) return"), claveCodigo.indexOf("} catch (e) {"))],
]

test("hay TRES clasificaciones en los instaladores (más la del tool) y ninguna se perdió", () => {
  // El conteo total, por la regla de arriba: si mañana alguien agrega una cuarta vía
  // (¿wget?) o borra una, este test lo dice en vez de revisar sólo las que quedan.
  assert.equal(CLASIFICADORES.length, 4, "cambió la cantidad de clasificaciones: revisá que todas sigan diciendo lo mismo")
  for (const [nombre, bloque] of CLASIFICADORES) {
    assert.ok(bloque && bloque.length > 100, `no encontré el clasificador de ${nombre} (¿se renombró?)`)
  }
})

test("las cuatro clasificaciones distinguen los CINCO resultados con los mismos criterios", () => {
  for (const [nombre, bloque] of CLASIFICADORES) {
    // cuota: 429 o RESOURCE_EXHAUSTED
    assert.match(bloque, /429/, `${nombre}: no reconoce el HTTP 429 (cuota agotada)`)
    assert.match(bloque, /RESOURCE_EXHAUSTED/, `${nombre}: no reconoce error.status RESOURCE_EXHAUSTED`)
    // invalida: 400/403 + los tres status + el reason
    assert.match(bloque, /\b400\b/, `${nombre}: no reconoce el HTTP 400`)
    assert.match(bloque, /\b403\b/, `${nombre}: no reconoce el HTTP 403`)
    assert.match(bloque, /INVALID_ARGUMENT/, `${nombre}: no reconoce INVALID_ARGUMENT`)
    assert.match(bloque, /PERMISSION_DENIED/, `${nombre}: no reconoce PERMISSION_DENIED`)
    assert.match(bloque, /UNAUTHENTICATED/, `${nombre}: no reconoce UNAUTHENTICATED`)
    assert.match(bloque, /API_KEY_INVALID/, `${nombre}: no reconoce el reason API_KEY_INVALID (es el que manda Google con una key falsa)`)
    // modeloIdo: 404 o NOT_FOUND
    assert.match(bloque, /\b404\b/, `${nombre}: no reconoce el HTTP 404 (modelo retirado)`)
    assert.match(bloque, /NOT_FOUND/, `${nombre}: no reconoce NOT_FOUND`)
    // sinProbar: el cajón del final
    assert.match(bloque, /sinProbar/, `${nombre}: no tiene el resultado sinProbar`)

    // EL ORDEN IMPORTA, y es la parte que se rompe sin que se note: si el 404
    // cayera después del cajón de sinProbar, un modelo retirado le echaría la culpa
    // a la red. Y si RESOURCE_EXHAUSTED cayera después de INVALID_ARGUMENT, una
    // cuota agotada se contaría como "tu key no sirve" y mandaría a sacar una nueva.
    const cuota = bloque.indexOf("RESOURCE_EXHAUSTED")
    const invalida = bloque.indexOf("API_KEY_INVALID")
    const modelo = bloque.indexOf("NOT_FOUND")
    const cajon = bloque.lastIndexOf("sinProbar")
    assert.ok(cuota < invalida, `${nombre}: la cuota se clasifica DESPUÉS de "no sirve"`)
    assert.ok(invalida < modelo, `${nombre}: el 404 se clasifica antes que "no sirve"`)
    assert.ok(modelo < cajon, `${nombre}: el 404 cae en el cajón de "no pude probarla", que le echa la culpa a la red`)
  }
})

test("la prueba tiene timeout en los tres lados (una red filtrada no cuelga, cuelga corto)", () => {
  // En una escuela con la red filtrada el pedido no falla: se queda colgado. Sin
  // timeout, el instalador se planta y el docente no sabe si esperar.
  assert.match(ps1Codigo, /\$TimeoutPruebaKey = 15\b/, "install.ps1 no acota la prueba a 15 s")
  assert.match(ps1Codigo, /-TimeoutSec \$TimeoutPruebaKey/, "install.ps1 no le pasa el timeout a Invoke-WebRequest")
  assert.match(shCodigo, /TIMEOUT_PRUEBA_KEY=15\b/, "install.sh no acota la prueba a 15 s")
  assert.match(shCodigo, /--max-time "\$TIMEOUT_PRUEBA_KEY"/, "install.sh (curl) no usa el timeout")
  assert.match(shCodigo, /timeout=espera/, "install.sh (python3) no usa el timeout")
  assert.match(claveCodigo, /15_000/, "clave.ts cambió su timeout: los tres tienen que esperar lo mismo")
})

test("si no hay con qué probar, se avisa y la instalación SIGUE (nada de dependencias nuevas)", () => {
  // Que una red caída —o una compu pelada— no deje sin Tecnia Bot a un aula.
  assert.match(shCodigo, /command -v python3/, "install.sh (prueba) no chequea python3 antes de usarlo")
  assert.match(shCodigo, /command -v curl/, "install.sh (prueba) no chequea curl antes de usarlo")
  assert.match(
    shCodigo,
    /sinProbar\|no hay python3 ni curl en esta compu para probarla/,
    "install.sh: sin python3 ni curl tiene que decir que no pudo probar, no fallar ni mentir",
  )
  // Y nada de herramientas que este script no use ya.
  assert.doesNotMatch(shCodigo, /command -v (wget|http|xh)\b/, "install.sh inventó una dependencia nueva para probar la key")
})

// ---------------------------------------------------------------------------
// 5. La key va en el HEADER, nunca en el query string
// ---------------------------------------------------------------------------

test("la key viaja SIEMPRE en el header x-goog-api-key y NUNCA en la URL", () => {
  // Google acepta las dos formas. Con la del query string la key termina adentro de
  // la URL, y la URL termina adentro del texto de cualquier excepción de red. Este
  // repo YA tuvo esa fuga con el proxy de la escuela (por eso el [regex]::Replace de
  // diagnostico.ps1). Si alguien mueve la key a la URL, esto se pone rojo.
  //
  // OJO CON CÓMO SE MIRA. La primera versión de este test recorría sólo el LITERAL
  // de la URL (`/generativelanguage\.googleapis\.com[^\s"'`]*/`) y una mutación real
  // se le escapó: en PowerShell la URL se arma concatenando, así que
  // `"...models/" + $ModeloApi + ":generateContent?key=" + $clave` deja el `key=`
  // FUERA del literal que el regex captura. Por eso ahora se mira la LÍNEA entera
  // que arma la URL, y además se barre el archivo completo buscando cualquier
  // `?key=` / `&key=`.
  const fuentes = [
    ["install.ps1", ps1Codigo],
    ["install.sh", shCodigo],
    ["opencode/tool/clave.ts", claveCodigo],
  ]
  const VARIABLES_CON_KEY = ["$clave", "$keyFinal", "$keyEfectiva", "$GEMINI_KEY", "$GOOGLE_KEY_ACTUAL", "${clave}", "clave}"]
  let headers = 0
  let lineasDeUrl = 0
  for (const [nombre, codigo] of fuentes) {
    const propios = codigo.match(/x-goog-api-key/g) ?? []
    assert.ok(propios.length >= 1, `${nombre} no manda la key en el header x-goog-api-key`)
    headers += propios.length

    // 1. Ningún parámetro `key` en ninguna URL, en ninguna parte del archivo.
    assert.doesNotMatch(
      codigo,
      /[?&]key=/i,
      `${nombre}: hay una URL con la key en el query string. De ahí se filtra en el texto de cualquier excepción de red.`,
    )

    // 2. La LÍNEA que arma la URL no puede tocar ninguna variable con la key.
    const lineas = codigo.split("\n").filter((l) => l.includes("generativelanguage.googleapis.com"))
    assert.equal(lineas.length, 1, `${nombre}: esperaba UNA línea que arme la URL de la prueba y encontré ${lineas.length}`)
    lineasDeUrl += lineas.length
    for (const variable of VARIABLES_CON_KEY) {
      assert.ok(
        !lineas[0].includes(variable),
        `${nombre}: la URL de la prueba se arma con la key adentro (${variable}): ${lineas[0].trim()}`,
      )
    }
  }
  // CONTEO TOTAL: uno en install.ps1, dos en install.sh (python3 y curl) y uno en
  // clave.ts. Si aparece un quinto lugar que manda la key, alguien tiene que mirarlo.
  assert.equal(headers, 4, `hay ${headers} lugares que mandan la key en un header; se esperaban 4 (ps1 + sh python3 + sh curl + clave.ts)`)
  assert.equal(lineasDeUrl, 3, `hay ${lineasDeUrl} líneas que arman una URL de Google; se esperaban 3 (una por archivo)`)
})

test("la key nunca se imprime: ningún mensaje del instalador la interpola", () => {
  // Es la regla 1 de clave.ts y la de diagnostico.ps1 («ACA NO SE IMPRIME NADA DEL
  // CONTENIDO DE auth.json. Nunca.»). Acá pesa igual: la salida del instalador queda
  // en instalacion.log, que el docente manda por mail cuando pide ayuda.
  const salidasPs = ps1Codigo.match(/^\s*Write-Host .*$/gm) ?? []
  assert.ok(salidasPs.length > 20, `esperaba muchos Write-Host en install.ps1 y encontré ${salidasPs.length}: ¿cambió el estilo?`)
  for (const linea of salidasPs) {
    for (const variable of ["$keyFinal", "$keyEfectiva", "$key", "$authData.google"]) {
      assert.ok(!linea.includes(variable), `install.ps1 imprime la key: ${linea.trim()}`)
    }
  }
  const salidasSh = shCodigo.match(/^\s*echo .*$/gm) ?? []
  assert.ok(salidasSh.length > 20, `esperaba muchos echo en install.sh y encontré ${salidasSh.length}: ¿cambió el estilo?`)
  for (const linea of salidasSh) {
    for (const variable of ["$GEMINI_KEY", "$GOOGLE_KEY_ACTUAL", "$KEY_EFECTIVA"]) {
      assert.ok(!linea.includes(variable), `install.sh imprime la key: ${linea.trim()}`)
    }
  }
  // Y del error de red se informa el TIPO, nunca el mensaje (que se lleva puesta la
  // URL, o el proxy con su usuario:clave adentro).
  assert.match(ps1Codigo, /\$ex\.GetType\(\)\.Name/, "install.ps1 ya no informa sólo el tipo de la excepción")
  assert.doesNotMatch(ps1Codigo, /\$ex\.Message|\$_\.Exception\.Message/, "install.ps1 imprime el mensaje de la excepción: ahí viaja la URL y el proxy")
  assert.match(shCodigo, /type\(e\)\.__name__/, "install.sh (python3) ya no informa sólo el tipo de la excepción")
})

// ---------------------------------------------------------------------------
// 6. No se afirma lo que no se verificó
// ---------------------------------------------------------------------------

test("ya no se dice «con tu key de Google» sin haberla probado", () => {
  // El mensaje exacto que imprimía con la key literal AIzaSyFALSA000… en la VM.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.doesNotMatch(
      codigo,
      /Gemini, con tu key de Google/,
      `${nombre} volvió a afirmar «Gemini, con tu key de Google» sin mirar nada: una key muerta imprime lo mismo que una que anda`,
    )
  }
})

test("la ÚNICA rama que dice que la key anda es la que recibió un OK de Google", () => {
  // Acá es donde se miente fácil. Se recolectan TODAS las afirmaciones de que anda y
  // se cuentan: tiene que haber exactamente una por instalador, y adentro del caso
  // "anda". Si alguien copia esa frase a otra rama, el conteo se rompe.
  const afirmacionesPs = ps1Codigo.match(/respondio bien/g) ?? []
  assert.equal(afirmacionesPs.length, 1, `install.ps1 afirma ${afirmacionesPs.length} veces que la key anda; tiene que ser una sola`)
  const bloqueAnda = bloquePs1('if ($resultadoKey -eq "anda") {')
  assert.match(bloqueAnda, /respondio bien/, "install.ps1: la afirmación de que anda no está en la rama del OK de Google")

  const afirmacionesSh = shCodigo.match(/respondio bien/g) ?? []
  assert.equal(afirmacionesSh.length, 1, `install.sh afirma ${afirmacionesSh.length} veces que la key anda; tiene que ser una sola`)
  assert.match(bloqueSh("\n    anda)"), /respondio bien/, "install.sh: la afirmación de que anda no está en la rama del OK de Google")
})

test("«no pude probarla» NUNCA se cuenta como «anda»", () => {
  // Un OK falso es peor que un error: manda a buscar el problema al lugar
  // equivocado y el docente se va tranquilo con todo roto.
  const cajonPs = bloquePs1('if ($resultadoKey -ne "anda" -and')
  const cajonSh = bloqueSh("\n    *)")
  for (const [nombre, cajon] of [["install.ps1", cajonPs], ["install.sh", cajonSh]]) {
    assert.match(cajon, /NO pude probar la key contra Google/, `${nombre}: el cajón de «no pude probarla» no lo dice`)
    assert.match(cajon, /NO se si anda/, `${nombre}: no aclara que no sabe si la key anda`)
    assert.doesNotMatch(cajon, /respondio bien|quedo andando|anda bien/, `${nombre}: el cajón de «no pude probarla» afirma que anda`)
    // Y no puede sugerir que se perdió la key: si no llegamos a Google, no sabemos
    // nada, y una key que no se pudo probar NO se borra ni se rechaza.
    assert.match(cajon, /no se toco nada/, `${nombre}: no aclara que la key quedó donde estaba`)
  }
  // El cajón es el ÚLTIMO: cualquier resultado inesperado cae ahí, y ahí no se
  // afirma nada. Es la red de seguridad de todo esto.
  assert.ok(ps1Codigo.indexOf('$resultadoKey -ne "anda" -and') > ps1Codigo.indexOf('$resultadoKey -eq "modeloIdo"'), "install.ps1: el cajón no es la última rama")
  assert.ok(shCodigo.indexOf("\n    *)") > shCodigo.indexOf("\n    modeloIdo)"), "install.sh: el cajón no es la última rama del case")
})

test("una key que no se pudo probar se GUARDA igual; sólo un rechazo explícito la frena", () => {
  // Si no llegamos a Google no sabemos nada de la key: rechazarla dejaría a una
  // escuela con el proxy filtrado sin poder configurar nada. Lo único que frena el
  // guardado es que Google la rechace de verdad.
  assert.match(ps1Codigo, /\$rechazada = \(\$pruebaNueva\.resultado -eq "invalida"\)/, "install.ps1: cambió la condición que frena el guardado")
  assert.doesNotMatch(ps1Codigo, /\$rechazada = \(\$pruebaNueva\.resultado -ne "anda"\)/, "install.ps1: ahora sólo guarda si Google contestó OK, y una red caída deja al aula sin nada")
  assert.match(shCodigo, /if \[ "\$\{PRUEBA_NUEVA%%\|\*\}" = "invalida" \]; then/, "install.sh: cambió la condición que frena el guardado")
  // Y cuando se frena, se dice que no se pisó nada.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.match(codigo, /la RECHAZO: no es una key valida, asi que no la guarde/, `${nombre}: no explica que no guardó la key rechazada`)
    assert.match(codigo, /Quedo la key que ya estaba guardada: no se piso nada/, `${nombre}: no aclara que la key anterior sigue ahí`)
  }
})

// ---------------------------------------------------------------------------
// 7. El 404 no le echa la culpa a la red
// ---------------------------------------------------------------------------

test("con el modelo retirado (404) NO se culpa a la red ni a la compu del docente", () => {
  // Sin rama propia, un modelo retirado caía en «no pude probarla», cuyo texto dice
  // que suele ser la red. Eso es FALSO y caro: la red anda perfecto y mandaríamos al
  // docente —o al referente técnico— a pelearse con el proxy de la escuela por un
  // problema que está del otro lado y que ninguna key nueva arregla.
  const bloques = [
    ["install.ps1", bloquePs1('if ($resultadoKey -eq "modeloIdo") {')],
    ["install.sh", bloqueSh("\n    modeloIdo)")],
    ["opencode/tool/clave.ts", claveCodigo.slice(claveCodigo.indexOf("const MODELO_IDO ="), claveCodigo.indexOf("function censurar"))],
  ]
  assert.equal(bloques.length, 3, "cambió la cantidad de mensajes de «modelo retirado»")
  for (const [nombre, bloque] of bloques) {
    assert.ok(bloque && bloque.length > 50, `${nombre}: no encontré el mensaje del modelo retirado`)
    assert.match(bloque, /no es la red|NO es la red/, `${nombre}: no aclara que NO es la red`)
    assert.match(bloque, /no hay key nueva que lo arregle|No hay key nueva/i, `${nombre}: no dice que ninguna key lo arregla`)
    assert.match(bloque, /actualizar/i, `${nombre}: no manda a actualizar Tecnia Bot, que es lo único que sirve`)
    // Los culpables falsos del cajón de sinProbar no pueden aparecer acá.
    assert.doesNotMatch(bloque, /sin internet|filtro de (contenido de )?la escuela|bloqueando a Google/i,
      `${nombre}: el mensaje del modelo retirado culpa a la red`)
  }
  // Y el cajón de sinProbar SÍ nombra a la red: la distinción tiene que ser real,
  // no un descuido que quedó igual de los dos lados.
  for (const [nombre, cajon] of [["install.ps1", bloquePs1('if ($resultadoKey -ne "anda" -and')], ["install.sh", bloqueSh("\n    *)")]]) {
    assert.match(cajon, /Suele ser la red/, `${nombre}: el cajón de «no pude probarla» ya no explica que suele ser la red`)
  }
})

// ---------------------------------------------------------------------------
// 8. El instalador y /clave cuentan LA MISMA historia
// ---------------------------------------------------------------------------

test("el modelo que se prueba contra Google se DERIVA del modelo configurado, en los tres", () => {
  // Si la URL de la prueba tuviera el id escrito a mano, el día que cambie el modelo
  // la prueba seguiría preguntando por el viejo: Google contestaría 404 y el
  // instalador diría «actualizá Tecnia Bot» con Tecnia Bot al día.
  assert.match(ps1Codigo, /\$ModeloApi = \(\$ModeloConKey -split "\/"\)\[-1\]/, "install.ps1 no deriva el id de la API de $ModeloConKey")
  assert.match(shCodigo, /MODELO_API="\$\{MODELO_CON_KEY##\*\/\}"/, "install.sh no deriva el id de la API de MODELO_CON_KEY")
  assert.match(claveCodigo, /const MODELO_API = MODELO_CON_KEY\.split\("\/"\)\[1\]/, "clave.ts no deriva el id de la API de MODELO_CON_KEY")
  // Y ninguno escribe un id de gemini a mano en la URL.
  for (const [nombre, codigo] of [["install.ps1", ps1Codigo], ["install.sh", shCodigo], ["clave.ts", claveCodigo]]) {
    for (const m of codigo.matchAll(/generativelanguage\.googleapis\.com[^\s"'`]*/g)) {
      assert.doesNotMatch(m[0], /gemini/i, `${nombre}: la URL de la prueba tiene el modelo escrito a mano: ${m[0]}`)
    }
  }
})

test("los tres explican la cuota igual: es por PROYECTO, no por key", () => {
  // Es lo que más confunde y lo que hizo perder una tarde entera en la escuela: dos
  // keys del mismo proyecto de Google comparten el límite, así que crear una key
  // nueva ahí adentro da exactamente el mismo error. Si el instalador y el bot lo
  // explicaran distinto, el docente probaría dos veces lo mismo.
  const fuentes = [["install.ps1", ps1Codigo], ["install.sh", shCodigo], ["opencode/tool/clave.ts", claveCodigo]]
  for (const [nombre, codigo] of fuentes) {
    assert.match(codigo, /por PROYECTO, no por key/, `${nombre} no explica que la cuota gratuita es por proyecto, no por key`)
    assert.match(codigo, /https:\/\/aistudio\.google\.com\/apikey/, `${nombre} no dice dónde sacar una key`)
  }
  // La MISMA URL en todos: si una apunta a otro lado, la mitad de los docentes
  // termina en la página equivocada.
  const urls = new Set()
  for (const [, codigo] of fuentes) {
    for (const m of codigo.matchAll(/https:\/\/aistudio\.google\.com\/\S*?(?=["'`\s)])/g)) urls.add(m[0])
  }
  assert.deepEqual([...urls], ["https://aistudio.google.com/apikey"], `hay más de una URL para sacar la key: ${[...urls].join(", ")}`)
})

test("con la cuota agotada, los instaladores mandan a /clave (que es donde se cambia desde el bot)", () => {
  // El docente que se queda sin cuota está hablando con el bot en ese momento: que
  // pueda pegar la key ahí, sin PowerShell ni menú inicio. Es la misma lección que
  // dio origen a la acción `reparar` del tool platformio.
  for (const [nombre, codigo] of INSTALADORES) {
    const bloque = nombre === "install.ps1" ? bloquePs1('if ($resultadoKey -eq "cuota") {') : bloqueSh("\n    cuota)")
    assert.match(bloque, /\/clave/, `${nombre}: con la cuota agotada no manda a /clave`)
    assert.match(bloque, /por PROYECTO, no por key/, `${nombre}: con la cuota agotada no explica que la cuota es por proyecto`)
    assert.match(bloque, /Big Pickle/, `${nombre}: no ofrece la salida de seguir con el modelo gratuito`)
  }
})

test("la key vieja compartida se sigue rechazando TAMBIÉN en el camino nuevo", () => {
  // Quien la pega de un apunte viejo tiene que ver el mismo rechazo, tenga o no una
  // key guardada: es una credencial rotada y muerta en todas las máquinas.
  for (const [nombre, codigo] of INSTALADORES) {
    assert.match(codigo, /es_key_vieja "\$GEMINI_KEY"|Test-KeyVieja \$keyFinal/, `${nombre} ya no reconoce la key vieja en el prompt`)
    // El rechazo se evalúa ANTES de guardar y ANTES de probar: no se le manda una
    // key muerta a Google ni se la escribe en ningún lado.
    const rechazo = nombre === "install.ps1"
      ? codigo.indexOf("Test-KeyVieja $keyFinal")
      : codigo.indexOf('es_key_vieja "$GEMINI_KEY"')
    const prueba = codigo.indexOf("Probando la key contra Google")
    assert.ok(rechazo >= 0 && prueba > rechazo, `${nombre}: la key vieja se prueba contra Google antes de rechazarla`)
    // Y con una key guardada, rechazarla NO puede dejar a la compu sin key.
    assert.match(codigo, /Se deja la key que ya estaba guardada: no se piso nada/, `${nombre}: al rechazar la key vieja no aclara que la anterior sigue ahí`)
  }
})

// ---------------------------------------------------------------------------
// Y el costo del prompt nuevo: 60 segundos por maquina, regalados.
//
// Lo destapo la compuerta de QA, no los tests: ninguno de los 368 mira el reloj.
// Corriendo el .exe /VERYSILENT en la VM, una reinstalacion sobre una maquina YA
// configurada paso de instantanea a 63 segundos -- 60 de ellos esperando a nadie
// frente a la oferta de cambiar la key. En una escuela con veinte maquinas son
// veinte minutos de reloj.
//
// Y NO se puede deducir desde el script: por /VERYSILENT hay una consola REAL
// (vacia, pero real), asi que el sondeo de teclado no falla y espera hasta el
// final. El unico que sabe que nadie va a contestar es el instalador de Inno.
// Por eso la senal baja desde el .iss y se traduce a TECNIA_SIN_PROMPT, que es la
// variable que install.ps1 YA sabia mirar: un solo mecanismo, no dos que digan lo
// mismo.
// ---------------------------------------------------------------------------

test("en modo silencioso el instalador no espera 60s a nadie", () => {
  const iss = leer("installer/tecnia-bot.iss")

  // El .iss tiene que consultar WizardSilent() y pasar la bandera al bootstrap.
  assert.match(
    iss,
    /function BanderaSilencio/,
    "el .iss no define BanderaSilencio: el bootstrap no se entera de que corre en silencio",
  )
  assert.match(iss, /WizardSilent\(\)/, "BanderaSilencio no consulta WizardSilent(): la bandera saldria siempre o nunca")
  assert.match(iss, /-SinPrompt/, "el .iss no pasa -SinPrompt")

  // Y la linea que lanza el bootstrap tiene que llevarla. Se mira ESA linea, no
  // el archivo entero: definir la funcion y olvidarse de usarla deja todo verde.
  //
  // HAY DOS lugares que lanzan bootstrap.ps1 y NO llevan la misma bandera:
  //   [Run]   -> la instalacion. Puede correr desatendida: lleva la bandera.
  //   [Icons] -> el acceso directo "Reparar Tecnia Bot". Ahi HAY alguien que hizo
  //              clic a proposito y que quiere que le pregunten: NO la lleva.
  // La primera version de este test agarraba la del menu inicio y fallaba contra
  // codigo sano. Por eso se recorta la seccion, en vez de barrer el archivo.
  const seccion = (nombre) => {
    const desde = iss.indexOf(`[${nombre}]`)
    assert.ok(desde >= 0, `el .iss no tiene seccion [${nombre}]`)
    const resto = iss.slice(desde + nombre.length + 2)
    const hasta = resto.search(/^\[/m)
    return hasta === -1 ? resto : resto.slice(0, hasta)
  }

  const enRun = seccion("Run")
    .split("\n")
    .filter((l) => l.includes("bootstrap.ps1") && l.includes("Parameters:"))
  assert.equal(enRun.length, 1, "esperaba exactamente una linea en [Run] que lance bootstrap.ps1")
  assert.match(
    enRun[0],
    /\{code:BanderaSilencio\}/,
    "la linea de [Run] que lanza bootstrap.ps1 no usa {code:BanderaSilencio}: la funcion existe y no la llama nadie",
  )

  const enIcons = seccion("Icons")
    .split("\n")
    .filter((l) => l.includes("bootstrap.ps1") && l.includes("Parameters:"))
  assert.equal(enIcons.length, 1, "esperaba exactamente una linea en [Icons] que lance bootstrap.ps1 (Reparar)")
  assert.doesNotMatch(
    enIcons[0],
    /BanderaSilencio|-SinPrompt/,
    "el acceso directo 'Reparar' no debe saltear la pregunta: ahi hay un docente que hizo clic para cambiar la key",
  )
})

test("bootstrap.ps1 acepta -SinPrompt y lo traduce a la variable que ya existia", () => {
  const ps1 = leer("install/bootstrap.ps1")

  assert.match(ps1, /param\(\[switch\]\$SinPrompt\)/, "bootstrap.ps1 no acepta -SinPrompt")

  // Se traduce a TECNIA_SIN_PROMPT: install.ps1 corre como hijo y la hereda. Si
  // alguien inventa un segundo mecanismo, quedan dos verdades que se desincronizan.
  assert.match(
    ps1,
    /\$env:TECNIA_SIN_PROMPT\s*=/,
    "bootstrap.ps1 no define TECNIA_SIN_PROMPT: install.ps1 no se entera y sigue esperando 60s",
  )
  const iSet = ps1.indexOf("$env:TECNIA_SIN_PROMPT =")
  const iSwitch = ps1.indexOf("if ($SinPrompt)")
  assert.ok(iSwitch >= 0 && iSet > iSwitch, "TECNIA_SIN_PROMPT se define sin mirar el switch: la definiria SIEMPRE")

  // param() tiene que ser la primera instruccion ejecutable, o PowerShell no parsea.
  const ejecutables = ps1
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
  assert.match(
    ejecutables[0],
    /^param\(/,
    "param() no es la primera instruccion ejecutable: PowerShell no va a poder parsear el archivo",
  )
})
