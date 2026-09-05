// La API key de Google es opcional, y ninguna key vive en este repo.
//
// POR QUÉ ESTE ARCHIVO. Hasta la v0.3.75 el instalador traía una key de Google
// embebida (la de "respaldo") que se usaba cuando nadie pegaba la suya: pública en
// un repo público, rotada después, y muerta en cada máquina que la tenía guardada.
// Ahora sin key el agente corre en Big Pickle, el modelo gratuito de OpenCode; con
// key, en Gemini. El instalador escribe esa elección como override por agente en
// opencode.json y purga la key vieja reconociéndola por su SHA-256.
//
// Lo que se verifica acá es lo que no puede volver a pasar en silencio: que
// reaparezca una key en el código, que los dos instaladores dejen de coincidir entre
// sí (o que un frontmatter vuelva a declarar `model` y pise el override: OpenCode
// mezcla los .md ENCIMA de opencode.json), que la docs nombren un modelo que no existe,
// o que al usuario se le deje de decir con qué modelo quedó y qué pasa con sus datos.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (r) => readFileSync(join(REPO, r), "utf8")
/** Sin comentarios: los scripts explican los bugs citándolos, y la cita no es código. */
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

const ps1 = leer("install/install.ps1")
const sh = leer("install/install.sh")
const ps1Codigo = sinComentarios(ps1)
const shCodigo = sinComentarios(sh)
const diagnostico = leer("install/diagnostico.ps1")
const readme = leer("README.md")
const docsKey = leer("docs/api-key-google.md")

const BIG_PICKLE = "opencode/big-pickle"
/** Una key de Google AI Studio: prefijo "AQ." y una tira larga de base64url. */
const FORMA_DE_KEY = /AQ\.[A-Za-z0-9_-]{20,}/
/** SHA-256 de la key compartida rotada. En el repo vive el hash, nunca el literal. */
const HASH_KEY_VIEJA = "121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"

/**
 * Los ids que declara cada instalador. La fuente del modelo son los instaladores
 * (no el frontmatter del agente: ver "ningún .md de opencode/agent/ declara model").
 */
function modelosDe(nombre, codigo) {
  const conKey = codigo.match(nombre === "install.ps1" ? /\$ModeloConKey\s*=\s*"([^"]+)"/ : /^MODELO_CON_KEY="([^"]+)"/m)
  const sinKey = codigo.match(nombre === "install.ps1" ? /\$ModeloSinKey\s*=\s*"([^"]+)"/ : /^MODELO_SIN_KEY="([^"]+)"/m)
  assert.ok(conKey, `${nombre} no define el modelo con key`)
  assert.ok(sinKey, `${nombre} no define el modelo sin key`)
  return { conKey: conKey[1], sinKey: sinKey[1] }
}
/** El id de Gemini según install.ps1 (el test de abajo garantiza que install.sh diga lo mismo). */
const GEMINI = modelosDe("install.ps1", ps1Codigo).conKey

/** Todos los archivos del repo salvo .git y node_modules, como rutas relativas. */
function archivosDelRepo(dir = REPO, acum = []) {
  for (const nombre of readdirSync(dir)) {
    if (nombre === ".git" || nombre === "node_modules") continue
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) archivosDelRepo(ruta, acum)
    else acum.push(relative(REPO, ruta))
  }
  return acum
}

// ---------------------------------------------------------------------------
// 1. Ninguna key en install/, y el literal de la vieja en ningún lado del repo.
// ---------------------------------------------------------------------------

test("ningún archivo de install/ trae una key ni la nombra como respaldo hardcodeado", () => {
  // Se busca la FORMA de una key, no una key puntual: la próxima que alguien pegue
  // va a ser distinta. Y las palabras con que se la nombraba en el código, para
  // que no vuelva con otro valor bajo el mismo nombre de variable.
  //
  // "key de respaldo" a secas NO está prohibida: el mensaje que avisa que se quitó
  // la vieja la nombra así, y es el nombre con que la conocen los docentes.
  const prohibidos = [FORMA_DE_KEY, /KEY_RESPALDO/, /respaldo hardcodeada/i]
  const problemas = []
  for (const f of readdirSync(join(REPO, "install"))) {
    const texto = leer(join("install", f))
    for (const p of prohibidos) {
      const m = texto.match(p)
      if (m) problemas.push(`install/${f}: ${m[0]}`)
    }
  }
  assert.deepEqual(problemas, [], "hay una key (o su nombre) en el instalador:\n" + problemas.join("\n"))
})

test("el literal de la key vieja no aparece en ningún archivo del repo", () => {
  // Toda el árbol, no sólo install/: una key que se muda a la docs, a un test o a
  // un HTML sigue siendo una key pública. Un literal con esa forma que no sea la
  // key vieja también falla acá, y está bien: no hay motivo para que haya uno.
  const problemas = []
  for (const r of archivosDelRepo()) {
    const m = readFileSync(join(REPO, r), "latin1").match(FORMA_DE_KEY)
    if (m) problemas.push(`${r}: ${m[0].slice(0, 8)}...`)
  }
  assert.deepEqual(problemas, [], "hay algo con forma de key de Google en el repo:\n" + problemas.join("\n"))
})

// ---------------------------------------------------------------------------
// 2. Los dos instaladores conocen los dos modelos y escriben el override.
// ---------------------------------------------------------------------------

test("los dos instaladores conocen Big Pickle y Gemini", () => {
  for (const [nombre, codigo] of [["install.ps1", ps1Codigo], ["install.sh", shCodigo]]) {
    assert.ok(codigo.includes(BIG_PICKLE), `${nombre} no nombra ${BIG_PICKLE}: sin key no hay modelo`)
    assert.ok(codigo.includes(GEMINI), `${nombre} no nombra ${GEMINI}: con key no hay modelo`)
  }
})

test("install.ps1 e install.sh usan el MISMO id de Gemini y el MISMO de Big Pickle, y ninguno es un alias", () => {
  // Dos instaladores, una decisión. Si Windows y Linux escriben ids distintos, el
  // mismo bot corre con dos modelos según la máquina y nadie lo ve en el código.
  // Y la lección de la 0.3.63 sigue vigente: un alias `-latest` cambia solo.
  const ps1 = modelosDe("install.ps1", ps1Codigo)
  const sh = modelosDe("install.sh", shCodigo)
  assert.equal(sh.conKey, ps1.conKey, `con key: install.sh usa ${sh.conKey} e install.ps1 ${ps1.conKey}`)
  assert.equal(sh.sinKey, ps1.sinKey, `sin key: install.sh usa ${sh.sinKey} e install.ps1 ${ps1.sinKey}`)
  assert.equal(ps1.sinKey, BIG_PICKLE, `sin key el modelo tiene que ser ${BIG_PICKLE}`)
  assert.match(ps1.conKey, /^google\/gemini-[\d.]+-/, `modelo con key inesperado: ${ps1.conKey}`)
  assert.doesNotMatch(ps1.conKey, /latest$/, `el modelo con key es un alias (${ps1.conKey}): cambia solo`)
})

test("ningún .md de opencode/agent/ declara model: el modelo es del instalador", () => {
  // OpenCode hace mergeDeep(config.agent, agentes .md) en config.ts: los .md se
  // mezclan ENCIMA de opencode.json. Un `model:` en cualquier frontmatter gana
  // sobre el override que escribe el instalador, y Big Pickle nunca corre. Se vio
  // en una VM: override escrito, agente en Gemini igual.
  const conModel = []
  for (const f of readdirSync(join(REPO, "opencode/agent")).filter((f) => f.endsWith(".md"))) {
    const fm = leer(join("opencode/agent", f)).match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (fm && /^model:/m.test(fm[1])) conModel.push(f)
  }
  assert.deepEqual(conModel, [], "estos agentes declaran `model` en el frontmatter y pisan opencode.json: " + conModel.join(", "))
})

test("la elección es: key de Google -> Gemini, sin key -> Big Pickle", () => {
  // La regla, no sólo los nombres. En los dos scripts la decisión es un if sobre
  // "hay key" con el modelo con key en la rama verdadera y Big Pickle en la falsa.
  assert.match(
    ps1Codigo,
    /if \(\$tieneGoogle\) \{\s*\$ModeloElegido = \$ModeloConKey[\s\S]*?\} else \{\s*\$ModeloElegido = \$ModeloSinKey/,
    "install.ps1 no decide el modelo según $tieneGoogle",
  )
  assert.match(
    shCodigo,
    /if \[ "\$TIENE_GOOGLE" = "1" \]; then\s*MODELO_ELEGIDO="\$MODELO_CON_KEY"[\s\S]*?else\s*MODELO_ELEGIDO="\$MODELO_SIN_KEY"/,
    "install.sh no decide el modelo según TIENE_GOOGLE",
  )
})

test("install.ps1 escribe el override agent -> tecnia-bot -> model en opencode.json", () => {
  // Override POR AGENTE en la config del usuario: es la única fuente del modelo
  // (el frontmatter no lo declara, ver el test de arriba) y sobrevive a los
  // /actualizar, que pisan el .md con el del repo.
  assert.match(ps1Codigo, /Add-Member -NotePropertyName "model" -NotePropertyValue \$ModeloElegido/, "no pone `model` en el objeto del agente")
  assert.match(ps1Codigo, /Add-Member -NotePropertyName \$TecniaAgent -NotePropertyValue \$agenteTecnia/, "no cuelga el agente bajo `agent`")
  assert.match(ps1Codigo, /Add-Member -NotePropertyName "agent" -NotePropertyValue \$agentes/, "no escribe la clave `agent` en opencode.json")
  // Y si el archivo no parsea, se deja intacto y se dice cómo agregarlo a mano.
  assert.match(ps1Codigo, /lo dejo intacto[\s\S]{0,400}"model`": `"\$ModeloElegido`"/, "con opencode.json roto no dice cómo agregar el modelo a mano")
})

test("install.sh escribe el override por las tres vías (jq, python3, sin ninguna)", () => {
  // Tres caminos para escribir la config según qué tenga la máquina: los tres
  // tienen que escribir el modelo, o la elección depende de qué haya instalado.
  assert.match(shCodigo, /\.agent = \(\(\.agent \/\/ \{\}\) \| \.\[\$agent\] = \(\(\.\[\$agent\] \/\/ \{\}\) \| \.model = \$modelo\)\)/, "la vía jq no escribe el modelo")
  assert.match(shCodigo, /agente_tecnia\["model"\] = modelo[\s\S]*?oc\["agent"\] = agentes/, "la vía python3 no escribe el modelo")
  assert.match(shCodigo, /"agent": \{ "\$TECNIA_AGENT": \{ "model": "\$MODELO_ELEGIDO" \} \}/, "el opencode.json creado sin jq ni python3 no trae el modelo")
  assert.match(shCodigo, /No pude parsear %s: lo dejo intacto[\s\S]{0,400}\\"model\\": \\"%s\\"/, "con opencode.json roto no dice cómo agregar el modelo a mano")
})

// ---------------------------------------------------------------------------
// 3. Sin key no se guarda nada, y al usuario se le dice la verdad.
// ---------------------------------------------------------------------------

test("sin key no se escribe auth.json ni la variable de entorno", () => {
  // Antes, "sin key" significaba escribir la de respaldo en los dos lugares. Ahora
  // las dos escrituras viven adentro de la rama "pegó una key", y sólo ahí.
  const guardado = ps1Codigo.match(/\} elseif \(\$keyFinal\) \{([\s\S]*?)\} else \{/)
  assert.ok(guardado, "install.ps1 no tiene la rama `elseif ($keyFinal)` que guarda la key")
  const desde = guardado.index
  const hasta = desde + guardado[0].length
  const escrituras = [...ps1Codigo.matchAll(/(?:Add-Member -NotePropertyName "google"|SetEnvironmentVariable\("GOOGLE_GENERATIVE_AI_API_KEY", \$keyFinal)/g)]
  assert.ok(escrituras.length >= 2, "install.ps1 ya no guarda la key en auth.json y en la variable")
  for (const e of escrituras) {
    // Por POSICIÓN, no por texto: una copia de la misma línea fuera de la rama
    // tiene el mismo texto y pasaría un `includes`. Pasó al probar por mutación.
    assert.ok(e.index >= desde && e.index < hasta, `se escribe la key fuera de la rama "pegó una key": ${e[0]}`)
  }
  assert.match(shCodigo, /elif \[ -n "\$GEMINI_KEY" \]; then[\s\S]*?d\["google"\] = \{"type": "api", "key": key\}/, "install.sh guarda google sin que haya key")
  assert.doesNotMatch(shCodigo, /KEY_FINAL=/, "install.sh volvió a tener un KEY_FINAL con default")
})

test("el prompt dice que la key es opcional y qué pasa si se aprieta Enter", () => {
  for (const [nombre, codigo] of [["install.ps1", ps1Codigo], ["install.sh", shCodigo]]) {
    assert.match(codigo, /API key de Google \(OPCIONAL\)/, `${nombre} no dice que la key es opcional`)
    assert.match(codigo, /Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode/, `${nombre} no dice qué pasa con Enter`)
  }
})

test("el instalador dice con qué modelo quedó, y con Big Pickle avisa lo del tiempo limitado y los datos", () => {
  // Este producto lo usan menores. OpenCode documenta que Big Pickle es gratis por
  // tiempo limitado y que mientras tanto puede usar las conversaciones para
  // mejorar el modelo: eso se dice en la pantalla, no sólo en un doc que nadie abre.
  for (const [nombre, codigo] of [["install.ps1", ps1Codigo], ["install.sh", shCodigo]]) {
    assert.match(codigo, /Modelo configurado: \$Modelo(?:Elegido|ELEGIDO|_ELEGIDO)?/i, `${nombre} no imprime el modelo configurado`)
    assert.match(codigo, /tiempo limitado/, `${nombre} no avisa que Big Pickle es gratis por tiempo limitado`)
    assert.match(codigo, /mejorar el modelo/, `${nombre} no avisa que las conversaciones pueden usarse para mejorar el modelo`)
    assert.match(codigo, /Para pasar a Gemini/, `${nombre} no dice cómo cambiar de modelo después`)
  }
})

// ---------------------------------------------------------------------------
// 4. La key compartida vieja se purga por hash.
// ---------------------------------------------------------------------------

test("los dos instaladores reconocen la key vieja por su SHA-256 y la purgan antes de elegir modelo", () => {
  for (const [nombre, codigo] of [["install.ps1", ps1Codigo], ["install.sh", shCodigo]]) {
    assert.ok(codigo.includes(HASH_KEY_VIEJA), `${nombre} no tiene el hash de la key vieja: no puede reconocerla`)
    assert.match(codigo, /Se quit. la key de respaldo compartida que tra.an las versiones anteriores \(ya no es v.lida\)/, `${nombre} no avisa que quitó la key vieja`)
  }
  // PowerShell: sha256 del string exacto, quitar `google` de auth.json y la
  // variable de usuario; y todo eso ANTES del prompt (que es donde se decide).
  assert.match(ps1Codigo, /\[System\.Security\.Cryptography\.SHA256\]::Create\(\)[\s\S]*?ComputeHash\(\[System\.Text\.Encoding\]::UTF8\.GetBytes/, "install.ps1 no calcula SHA-256 en UTF-8")
  assert.match(ps1Codigo, /\$authData\.PSObject\.Properties\.Remove\("google"\)/, "install.ps1 no quita `google` de auth.json")
  assert.match(ps1Codigo, /SetEnvironmentVariable\("GOOGLE_GENERATIVE_AI_API_KEY", \$null, "User"\)/, "install.ps1 no borra la variable de usuario")
  assert.ok(ps1Codigo.indexOf('Properties.Remove("google")') < ps1Codigo.indexOf("API key de Google (OPCIONAL)"), "install.ps1 purga después del prompt: decide el modelo con la key muerta")
  // Bash: sha256 con printf '%s' (sin newline), y del(.google)/pop("google").
  assert.match(shCodigo, /printf '%s' "\$1" \| sha256sum/, "install.sh no calcula SHA-256 del string exacto")
  assert.match(shCodigo, /d\.pop\("google", None\)/, "install.sh (python3) no quita `google` de auth.json")
  assert.match(shCodigo, /jq 'del\(\.google\)'/, "install.sh (jq) no quita `google` de auth.json")
  assert.ok(shCodigo.indexOf("auth_quitar_google\n") < shCodigo.indexOf("API key de Google (OPCIONAL)"), "install.sh purga después del prompt")
})

test("si el usuario pega la key vieja en el prompt, se rechaza", () => {
  assert.match(ps1Codigo, /if \(\$keyFinal -and \(Test-KeyVieja \$keyFinal\)\) \{[\s\S]*?ya no es valida y no se guarda/, "install.ps1 guarda la key vieja si se la pegan")
  assert.match(shCodigo, /if es_key_vieja "\$GEMINI_KEY"; then[\s\S]*?ya no es v.lida y no se guarda/, "install.sh guarda la key vieja si se la pegan")
})

test("diagnostico.ps1 informa el modelo, si hay key, y si es la vieja", () => {
  const codigo = sinComentarios(diagnostico)
  assert.match(codigo, /modelo de tecnia-bot/, "no informa el modelo configurado")
  assert.match(codigo, /key de Google guardada/, "no informa si hay key de Google")
  assert.ok(codigo.includes(HASH_KEY_VIEJA), "no tiene el hash: no puede reconocer la key vieja")
  assert.match(codigo, /key de respaldo vieja[^\n]*ya invalida[^\n]*Reparar/, "no manda a correr Reparar cuando la key es la vieja")
  // Y sigue sin imprimir nada de la key (la regla de scripts-soporte, aplicada a lo nuevo).
  assert.doesNotMatch(codigo, /Write-Host[^\n]*\$authObj\.google/, "imprime algo de la key de auth.json")
})

// ---------------------------------------------------------------------------
// 5. La docs cuentan lo mismo que el instalador.
// ---------------------------------------------------------------------------

test("README y la guía de la key nombran Big Pickle y ya no el alias abandonado", () => {
  // `gemini-flash-lite-latest` se abandonó en la 0.3.63 y el README lo siguió
  // documentando durante doce versiones. Un doc que nombra un modelo que no existe
  // manda a buscar el problema al lugar equivocado.
  for (const [nombre, texto] of [["README.md", readme], ["docs/api-key-google.md", docsKey]]) {
    assert.ok(texto.includes("big-pickle"), `${nombre} no menciona big-pickle`)
    assert.ok(!texto.includes("gemini-flash-lite-latest"), `${nombre} sigue documentando gemini-flash-lite-latest, un alias abandonado en la 0.3.63`)
    assert.ok(texto.includes(GEMINI), `${nombre} no nombra el modelo real con key (${GEMINI})`)
    assert.match(texto, /tiempo limitado/, `${nombre} no dice que Big Pickle es gratis por tiempo limitado`)
    assert.match(texto, /mejorar el modelo/, `${nombre} no dice que las conversaciones pueden usarse para mejorar el modelo`)
  }
  assert.ok(!docsKey.includes("Nunca** vive en este repositorio"), "la guía vuelve a decir que la key nunca vivió en el repo: sí vivió, hasta la 0.3.75")
  assert.match(docsKey, /0\.3\.75/, "la guía no cuenta que hasta la 0.3.75 hubo una key embebida")
})

test("las guías de instalación y los bootstraps no dicen que la key es obligatoria", () => {
  // Las guías paso a paso y el mensaje final del bootstrap son lo primero que lee
  // un docente. Si ahí dice "necesita una API key", nadie se entera de que Enter
  // alcanza — y el que sí la pone tiene que enterarse de lo que pasa con sus datos
  // si no la pone.
  const OBLIGATORIA = /necesita una API key|API key obligatoria|obligatori[ao]|Falta un paso .nico: conectar una API key|ning.n instalador puede hacer solo[^\n]*API key/i
  for (const r of ["docs/instalacion-windows.md", "docs/instalacion-linux.md", "install/bootstrap.sh", "install/bootstrap.ps1"]) {
    const texto = leer(r)
    const m = texto.match(OBLIGATORIA)
    assert.equal(m, null, `${r} presenta la key como obligatoria: "${m?.[0]}"`)
    if (r.startsWith("docs/")) {
      assert.match(texto, /opcional/i, `${r} no dice que la key es opcional`)
      assert.match(texto, /Big Pickle/, `${r} no dice que sin key se usa Big Pickle`)
      assert.match(texto, /mejorar el modelo/, `${r} no avisa que el chat puede usarse para mejorar el modelo`)
    }
  }
  assert.match(leer("install/bootstrap.sh"), /opcional[\s\S]*Big Pickle[\s\S]*mejorar el modelo/, "bootstrap.sh no explica la opcionalidad ni Big Pickle")
})
