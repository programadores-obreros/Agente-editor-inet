/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * CAMBIAR LA KEY DE GOOGLE DESDE ADENTRO DEL BOT, Y SABER SI ANDA.
 *
 * EL CASO REAL (escuela Juana Manso, 8 de septiembre de 2026). Varias docentes se
 * quedaron sin cuota de Google. Adentro del bot, al primer mensaje:
 *
 *     AI_APICallError: Resource has been exhausted (e.g. check quota).
 *
 * Corrieron "Reparar Tecnia Bot" esperando poder pegar una key nueva. El
 * instalador terminó bien y NUNCA se la pidió. Probaron con keys de otras
 * cuentas: el mismo error. Las keys nuevas nunca entraron.
 *
 * La causa está en `install/install.ps1`: la pregunta por la key vive adentro de
 * `elseif (-not $tieneGoogle)`, y el comentario de más arriba lo dice con todas
 * las letras — «es idempotente: si ya hay una key guardada, no se pregunta de
 * nuevo». O sea que en una compu que YA tiene key, Reparar nunca ofrece
 * cambiarla, y no importa cuántas veces se corra. Reproducido en la VM de
 * Windows 10: con key guardada no pregunta y `auth.json` ni se toca (misma fecha
 * de modificación antes y después). Está todo escrito en `docs/key-de-google.md`.
 *
 * Y hay un segundo defecto, de la misma prueba: con la key literal
 * `AIzaSyFALSA000…` el instalador imprime «Modelo configurado: Gemini, con tu key
 * de Google». LA KEY NUNCA SE VALIDA CONTRA GOOGLE. Una credencial muerta, o con
 * la cuota agotada, produce exactamente el mismo mensaje que una que funciona: el
 * docente lee que quedó todo bien y se entera de que no en el primer mensaje.
 *
 * Este tool resuelve las dos cosas, y por eso existe como TOOL y no como una
 * pregunta más del instalador: `/actualizar` y `/reparar` lanzan los scripts con
 * `Bun.spawn(..., { stdout: "pipe" })`. No hay consola donde tipear. Cualquier
 * pregunta que haga el instalador por esa vía se le hace al vacío. La docente que
 * se queda sin cuota está hablando con el bot EN ESE MOMENTO: que pegue la key
 * ahí. Es la misma lección que dio origen a `platformio action: "reparar"`,
 * cuando una docente contestó «vos tenés platformio, hacelo».
 *
 * DOS REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO:
 *
 * 1. LA KEY NO SE IMPRIME NUNCA. Ni entera, ni un fragmento, ni su longitud, ni
 *    en un mensaje de error. Es la misma regla que ya tiene `diagnostico.ps1`
 *    («ACA NO SE IMPRIME NADA DEL CONTENIDO DE auth.json. Nunca.»), y acá pesa
 *    todavía más: esto sale por el chat, que el docente copia y pega en un mail o
 *    en un WhatsApp cuando pide ayuda.
 *
 * 2. «NO PUDE PROBARLA» NO ES «ANDA». Si no se pudo verificar, se dice que no se
 *    pudo. Un OK falso es peor que un error: manda a buscar el problema al lugar
 *    equivocado y el docente se va tranquilo con todo roto. Es lo que persigue
 *    `opencode/command/reparar.md` («Nunca digas que algo quedó instalado si el
 *    tool no lo dijo») y lo que este tool viene a arreglar, así que sería
 *    grotesco repetirlo acá.
 */

// Los dos modelos, IGUAL que `install/install.ps1` ($ModeloConKey / $ModeloSinKey)
// e `install/install.sh` (MODELO_CON_KEY / MODELO_SIN_KEY). Si se cambian allá y
// no acá, guardar una key desde el bot dejaría al agente en un modelo distinto del
// que elige el instalador en la corrida siguiente, y el docente vería al producto
// cambiar de modelo solo. Hay un test que exige que los tres coincidan.
const MODELO_CON_KEY = "google/gemini-3.5-flash-lite"
const MODELO_SIN_KEY = "opencode/big-pickle"
const AGENTE = "tecnia-bot"

// El id que entiende la API de Google es la parte de la derecha: el "google/" de
// adelante es el proveedor, y es sintaxis de OpenCode, no de Google.
const MODELO_API = MODELO_CON_KEY.split("/")[1] ?? ""

export const VARIABLE_KEY = "GOOGLE_GENERATIVE_AI_API_KEY"

/**
 * La key compartida que traían las versiones ≤ 0.3.75, reconocida por su SHA-256.
 *
 * Hasta esa versión `install.ps1` traía una key de Google fija EMBEBIDA en el
 * script, que se usaba cuando nadie pegaba la suya (incluyendo a quien apretaba
 * Enter o dejaba pasar los 60 segundos del timeout). Se eliminó y se rotó: quedó
 * una credencial MUERTA en cada máquina que la tenía guardada. Se la reconoce por
 * el hash porque el literal no vuelve a este repo — hay un test que barre el árbol
 * entero buscando algo con forma de key.
 *
 * Es el mismo criterio de `Test-KeyVieja` en install.ps1 y en diagnostico.ps1: el
 * hash del string EXACTO en UTF-8, sin newline. No lo reinventes: si los tres
 * calcularan cosas distintas, la key muerta pasaría por alguno de los tres.
 */
export const HASH_KEY_VIEJA = "121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"

export function sha256Hex(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

export function esKeyVieja(clave: string): boolean {
  return clave.length > 0 && sha256Hex(clave) === HASH_KEY_VIEJA
}

// Dónde vive el archivo de credenciales de OpenCode. MISMO criterio que
// install.ps1 (`$env:XDG_DATA_HOME\opencode` y si no `~\.local\share\opencode`) y
// que install.sh. Si acá mirásemos otro lado, el tool escribiría una key en un
// archivo que OpenCode no lee, y el docente vería el mismo error de siempre
// después de que le dijimos que quedó todo bien.
function authPath(): string {
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(data, "opencode", "auth.json")
}

// La config de OpenCode, donde vive el override del modelo del agente. OpenCode
// acepta las dos extensiones (prueba `opencode.json` y después `opencode.jsonc`):
// preferimos .json si están las dos, igual que él y que el instalador.
function configPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const base = join(cfg, "opencode", "opencode")
  if (existsSync(`${base}.json`)) return `${base}.json`
  if (existsSync(`${base}.jsonc`)) return `${base}.jsonc`
  return `${base}.json`
}

type Lectura =
  | { estado: "no-existe" }
  | { estado: "no-parsea"; teniaBom: boolean }
  | { estado: "ok"; datos: Record<string, unknown>; teniaBom: boolean }

/**
 * Lee un JSON del disco SACÁNDOLE EL BOM, y contando si lo tenía.
 *
 * EL BOM ES EL BUG QUE DEJABA MÁQUINAS MUERTAS PARA SIEMPRE. Las instalaciones
 * anteriores a la 0.3.55 escribían `auth.json` con `Set-Content -Encoding UTF8`,
 * que en PowerShell 5.1 mete BOM. Y ahí se abre una asimetría letal:
 *
 *   PowerShell (Get-Content -Raw) → SACA el BOM solo. Ve una key perfecta.
 *   OpenCode   (JSON.parse)       → NO lo saca. Rechaza el archivo entero y se
 *                                   traga el error sin avisar.
 *
 * El instalador leía, veía una key sana, concluía «ya está configurado» y no
 * tocaba nada. Reinstalar no servía, actualizar tampoco: cada corrida confirmaba
 * que estaba bien. El bot abría perfecto y fallaba al primer mensaje.
 *
 * Por eso se leen los BYTES: es la única forma de ver lo que ve OpenCode. Y por
 * eso `escribirJsonSinBom()` reescribe sin BOM aunque el archivo lo tuviera — es
 * la misma cura que hace install.ps1 al arrancar, y con esto el tool la aplica
 * también desde adentro del bot.
 */
function leerJson(ruta: string): Lectura {
  if (!existsSync(ruta)) return { estado: "no-existe" }
  let texto = ""
  let teniaBom = false
  try {
    const bytes = readFileSync(ruta)
    teniaBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    texto = bytes.toString("utf8")
    if (teniaBom) texto = texto.slice(1)
  } catch {
    return { estado: "no-parsea", teniaBom }
  }
  if (!texto.trim()) return { estado: "no-existe" }
  try {
    const datos = JSON.parse(texto) as unknown
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return { estado: "no-parsea", teniaBom }
    return { estado: "ok", datos: datos as Record<string, unknown>, teniaBom }
  } catch {
    // Un .jsonc con comentarios cae acá, y está bien: no los sacamos nosotros.
    // install.ps1 sí los saca, pero él reescribe el archivo entero y se los come;
    // desde acá preferimos NO TOCAR y decirlo, antes que borrarle al docente los
    // comentarios que puso a mano.
    return { estado: "no-parsea", teniaBom }
  }
}

/**
 * Escribe JSON en UTF-8 PLANO, sin BOM (ver el comentario de leerJson).
 * `writeFileSync(..., "utf8")` de Node/Bun no agrega BOM: la trampa era de
 * PowerShell. Lo que sí hay que cuidar es no ARRASTRAR el BOM que ya estaba, y
 * eso lo resuelve la lectura de arriba, que lo saca del texto antes de parsear.
 */
function escribirJsonSinBom(ruta: string, datos: unknown): void {
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`, "utf8")
}

/** La key de Google guardada en auth.json, o "" si no hay. NUNCA se imprime. */
function claveGuardada(datos: Record<string, unknown>): string {
  const google = datos["google"]
  if (!google || typeof google !== "object") return ""
  const key = (google as Record<string, unknown>)["key"]
  return typeof key === "string" ? key : ""
}

type Escritura = { ok: true } | { ok: false; motivo: "no-parsea" | "no-escribio" | "no-verifico" }

/**
 * Guarda (o quita) la key de Google en auth.json PRESERVANDO los otros providers.
 *
 * Se toca SOLO la clave "google". El docente puede tener ahí credenciales de
 * OpenCode, de Anthropic o de lo que haya conectado con `/connect`: pisarlas
 * sería romperle otra cosa mientras le arreglamos ésta.
 *
 * Y se RELEE el archivo al final. Es el punto 5 del análisis de
 * `docs/key-de-google.md`: verificar la escritura releyendo, en vez de imprimir
 * «[OK] Key guardada» y confiar. Un disco lleno, un permiso denegado o un
 * antivirus que revierte el archivo son cosas que pasan en las compus de escuela,
 * y hasta ahora se enteraba el docente, al primer mensaje.
 */
function escribirClaveEnAuth(clave: string | null): Escritura {
  const ruta = authPath()
  const leido = leerJson(ruta)
  if (leido.estado === "no-parsea") return { ok: false, motivo: "no-parsea" }
  const datos: Record<string, unknown> = leido.estado === "ok" ? leido.datos : {}

  if (clave === null) delete datos["google"]
  else datos["google"] = { type: "api", key: clave }

  try {
    escribirJsonSinBom(ruta, datos)
  } catch {
    return { ok: false, motivo: "no-escribio" }
  }

  const relectura = leerJson(ruta)
  if (relectura.estado !== "ok") return { ok: false, motivo: "no-verifico" }
  const quedo = claveGuardada(relectura.datos)
  const esperado = clave ?? ""
  if (quedo !== esperado) return { ok: false, motivo: "no-verifico" }
  return { ok: true }
}

/**
 * Escribe el override del modelo del agente en opencode.json, preservando el
 * resto de la config (`agent` → `tecnia-bot` → `model`).
 *
 * SIN ESTO, GUARDAR UNA KEY NO CAMBIA NADA VISIBLE. El modelo del agente no sale
 * del frontmatter de `opencode/agent/tecnia-bot.md` —a propósito: OpenCode hace
 * mergeDeep(config.agent, agentes .md), o sea que un `model:` en el .md pisaría el
 * override y Big Pickle nunca correría—, sale de acá. Una compu que estaba en Big
 * Pickle se queda en Big Pickle aunque le pegues la mejor key del mundo.
 */
function escribirModelo(modelo: string): Escritura {
  const ruta = configPath()
  const leido = leerJson(ruta)
  if (leido.estado === "no-parsea") return { ok: false, motivo: "no-parsea" }
  const datos: Record<string, unknown> = leido.estado === "ok" ? leido.datos : {}

  const agentesCrudo = datos["agent"]
  const agentes: Record<string, unknown> =
    agentesCrudo && typeof agentesCrudo === "object" && !Array.isArray(agentesCrudo)
      ? (agentesCrudo as Record<string, unknown>)
      : {}
  const tecniaCrudo = agentes[AGENTE]
  const tecnia: Record<string, unknown> =
    tecniaCrudo && typeof tecniaCrudo === "object" && !Array.isArray(tecniaCrudo)
      ? (tecniaCrudo as Record<string, unknown>)
      : {}
  tecnia["model"] = modelo
  agentes[AGENTE] = tecnia
  datos["agent"] = agentes

  try {
    escribirJsonSinBom(ruta, datos)
  } catch {
    return { ok: false, motivo: "no-escribio" }
  }
  const relectura = leerJson(ruta)
  if (relectura.estado !== "ok" || modeloDe(relectura.datos) !== modelo) return { ok: false, motivo: "no-verifico" }
  return { ok: true }
}

/** El modelo que hoy tiene escrito el agente en la config, o "" si no hay. */
function modeloDe(datos: Record<string, unknown>): string {
  const agentes = datos["agent"]
  if (!agentes || typeof agentes !== "object") return ""
  const tecnia = (agentes as Record<string, unknown>)[AGENTE]
  if (!tecnia || typeof tecnia !== "object") return ""
  const modelo = (tecnia as Record<string, unknown>)["model"]
  return typeof modelo === "string" ? modelo : ""
}

// ---------------------------------------------------------------------------
// La variable de entorno GOOGLE_GENERATIVE_AI_API_KEY
// ---------------------------------------------------------------------------

/*
 * POR QUÉ IMPORTA. install.ps1 escribe la key en DOS lugares: auth.json y la
 * variable de usuario GOOGLE_GENERATIVE_AI_API_KEY. Y purga los dos cuando
 * encuentra la key vieja. Si acá guardáramos sólo auth.json, en una compu que ya
 * tenía la variable puesta quedaría una key vieja compitiendo con la nueva — y el
 * docente vería el mismo error después de que le dijimos que quedó todo bien, que
 * es exactamente el agujero que este tool viene a tapar.
 *
 * La key VIAJA POR EL ENTORNO DEL PROCESO HIJO, no por la línea de comandos. La
 * línea de comandos de un proceso la puede leer cualquier otro proceso de la
 * máquina (el Administrador de tareas la muestra, y los antivirus la loguean):
 * meter la key ahí sería filtrarla en el mismo acto de guardarla bien.
 */
async function escribirVariableUsuario(clave: string | null): Promise<"ok" | "fallo"> {
  const ps =
    `$v = $env:TECNIA_CLAVE_NUEVA; if (-not $v) { $v = $null }; ` +
    `[Environment]::SetEnvironmentVariable('${VARIABLE_KEY}', $v, 'User')`
  const cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]
  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TECNIA_CLAVE_NUEVA: clave ?? "" },
    })
    // El ORDEN importa, igual que en `correr()` de actualizar.ts y `run()` de
    // platformio.ts: se lee stdout/stderr ANTES de esperar `exited`. Al revés, un
    // proceso que llena el buffer del pipe se bloquea escribiendo y el tool se
    // queda esperando a un proceso que espera al tool.
    const [, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const code = await proc.exited
    // Del error NO se imprime el texto: se informa que falló y nada más. Es la
    // misma regla del `[regex]::Replace` de diagnostico.ps1 — un mensaje de error
    // se lleva puesto lo que tenga cerca, y acá lo que hay cerca es una key.
    return code === 0 && !err.trim() ? "ok" : "fallo"
  } catch {
    // PowerShell fuera del PATH, bloqueado por política o por el antivirus.
    return "fallo"
  }
}

// ---------------------------------------------------------------------------
// Probar la key CONTRA GOOGLE — la parte más importante de este archivo
// ---------------------------------------------------------------------------

/*
 * Cuatro resultados, y ninguno se puede confundir con otro:
 *
 *   anda      → Google contestó OK.
 *   cuota     → HTTP 429 / RESOURCE_EXHAUSTED. ES EL CASO DE LA ESCUELA: la key
 *               es real y de la docente, lo que se acabó es el cupo gratis.
 *   invalida  → HTTP 400/403 / API_KEY_INVALID. La key no sirve.
 *   modeloIdo → HTTP 404 / NOT_FOUND. La key puede estar perfecta: el que no está
 *               es el MODELO. Ver abajo por qué tiene rama propia.
 *   sinProbar → sin red, timeout, DNS, un 500 de Google, cualquier otra cosa.
 *
 * POR QUÉ EL 404 NO PUEDE CAER EN sinProbar.
 *
 * Sin esta rama, un modelo retirado o renombrado por Google terminaba en el cajón
 * de "no pude probarla", cuyo texto dice "suele ser la red: sin internet, o el
 * filtro de la escuela bloqueando a Google". Eso es FALSO y caro: la red anda
 * perfecto, y mandaríamos a la docente —o al referente técnico— a pelearse con el
 * proxy por un problema que no está ahí.
 *
 * Y es peor que un mensaje equivocado: si el modelo no existe, el bot entero está
 * roto, no sólo esta prueba. Ninguna key nueva lo va a arreglar. Lo único que
 * sirve es actualizar Tecnia Bot, y eso hay que decirlo.
 *
 * Se comprobó contra la API real (2026-09-09) que `gemini-3.5-flash-lite` existe
 * hoy: con una key inventada, Google contesta 400 API_KEY_INVALID y no 404. O sea
 * que esta rama es para el día que eso cambie -- que en el ritmo al que Google
 * rota modelos, va a pasar.
 *
 * La key va en el HEADER `x-goog-api-key`, no en el query string. Las dos formas
 * las acepta Google; con la del query string la key termina adentro de la URL, y
 * la URL termina adentro del texto de cualquier excepción de red. Este repo ya
 * tuvo esa fuga con el proxy de la escuela (por eso el `[regex]::Replace` de
 * diagnostico.ps1). El header la deja afuera de todo lo que se pueda imprimir por
 * accidente, que es más barato que acordarse de tapar la fuga en cada mensaje.
 *
 * Del cuerpo de la respuesta se sacan SOLO dos cosas: `error.status` y los
 * `reason` de `error.details`, que son tokens de una lista cerrada
 * (RESOURCE_EXHAUSTED, API_KEY_INVALID…). El cuerpo entero no se imprime nunca.
 */
export type ResultadoPrueba = "anda" | "cuota" | "invalida" | "modeloIdo" | "sinProbar"

// Cuánto se espera a Google antes de darse por vencido. En una escuela con la red
// filtrada el pedido no falla: se queda colgado, y el docente ve al bot "pensando"
// para siempre. Quince segundos alcanzan para cualquier red que ande. Se puede
// acortar por variable de entorno (lo usan los tests).
function timeoutMs(): number {
  const n = Number(process.env.TECNIA_CLAVE_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 15_000
}

export async function probarClave(clave: string): Promise<{ resultado: ResultadoPrueba; detalle: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_API}:generateContent`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": clave,
        "User-Agent": "tecnia-bot-clave",
      },
      // El pedido más chico que sirve de prueba: una palabra y un token de
      // respuesta. No es gratis (consume una llamada del cupo), pero preguntarle a
      // Google es la única forma de saber, y no preguntar es justamente el defecto
      // que estamos arreglando.
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal: AbortSignal.timeout(timeoutMs()),
    })

    if (res.ok) return { resultado: "anda", detalle: "" }

    let status = ""
    const razones: string[] = []
    try {
      const cuerpo = (await res.json()) as { error?: { status?: unknown; details?: unknown } }
      const err = cuerpo?.error
      if (typeof err?.status === "string") status = err.status
      if (Array.isArray(err?.details)) {
        for (const d of err.details) {
          const r = (d as Record<string, unknown>)?.["reason"]
          if (typeof r === "string") razones.push(r)
        }
      }
    } catch {
      // Un cuerpo que no es JSON (una página del proxy de la escuela, por ejemplo)
      // no aporta nada: el código HTTP alcanza para clasificar.
    }

    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") return { resultado: "cuota", detalle: "" }
    if (
      res.status === 400 ||
      res.status === 403 ||
      status === "INVALID_ARGUMENT" ||
      status === "PERMISSION_DENIED" ||
      status === "UNAUTHENTICATED" ||
      razones.includes("API_KEY_INVALID")
    ) {
      return { resultado: "invalida", detalle: "" }
    }
    // El modelo, no la key. Va ANTES del cajón de sinProbar a propósito: ahí el
    // texto culpa a la red, y acá la red anda.
    if (res.status === 404 || status === "NOT_FOUND") {
      return { resultado: "modeloIdo", detalle: "" }
    }
    // Un 500/503 de Google no dice NADA sobre la key: es de ellos, no de la
    // docente. Tratarlo como "no sirve" la mandaría a sacar una key nueva por un
    // problema que se arregla solo en diez minutos.
    return { resultado: "sinProbar", detalle: `Google contestó HTTP ${res.status}` }
  } catch (e) {
    // Timeout, DNS que no resuelve, el filtro de contenido de la escuela que corta.
    // Se informa el TIPO de excepción, nunca el mensaje: el mensaje se lleva puesta
    // la URL, el proxy con su usuario:clave adentro, o lo que tenga a mano.
    const tipo = e instanceof Error ? e.name : "error desconocido"
    return { resultado: "sinProbar", detalle: `no hubo respuesta (${tipo})` }
  }
}

// ---------------------------------------------------------------------------
// Los textos para la docente
// ---------------------------------------------------------------------------

const SACAR_KEY = "https://aistudio.google.com/apikey"

const CUOTA_AGOTADA =
  `**Se te agotó la cuota gratuita de Google.** No rompiste nada: tu key sigue siendo tuya y ` +
  `Tecnia Bot está entero. Google regala una cantidad de mensajes por día y esa cantidad se terminó.\n\n` +
  `Tenés tres salidas:\n\n` +
  `1. **Esperar.** El límite gratuito se renueva solo; mañana volvés a tener cupo.\n` +
  `2. **Usar una key de OTRO PROYECTO de Google.** Ojo con esto, que es lo que más confunde: ` +
  `**la cuota gratuita es por PROYECTO, no por key.** Si creás una key nueva adentro del mismo ` +
  `proyecto, comparte el mismo límite y vas a ver exactamente el mismo error. Tiene que ser de ` +
  `otro proyecto (o de otra cuenta de Google): ${SACAR_KEY}\n` +
  `3. **Seguir sin key**, con Big Pickle, el modelo gratuito de OpenCode. Pedime "quiero seguir sin key" ` +
  `y te lo dejo configurado.`

const AVISO_BIG_PICKLE =
  `Big Pickle es gratis por tiempo limitado y no pide cuenta ni tarjeta. **OJO:** mientras dure la ` +
  `etapa gratuita, OpenCode puede usar lo que se escribe en el chat para mejorar el modelo. No pongas ` +
  `datos personales ni nombres de alumnos en la conversación.`

const REINICIAR = "⚠️ **Cerrá y volvé a abrir Tecnia Bot** para que el cambio tome efecto."

const ALCANCE =
  "\n\n_Esto mira SOLO la key de Google y el modelo del agente. No dice nada sobre PlatformIO, " +
  "Python ni las dependencias: para eso está `/diagnostico`, y para instalarlas `/reparar`._"

/*
 * El modelo se fue, no la key. Este texto NO nombra a la red ni al filtro de la
 * escuela: la red anda: fue Google el que contestó "ese modelo no existe". Nombrar
 * la red acá manda a la docente a pelearse con el proxy por un problema que está
 * del otro lado, y ninguna key nueva lo arregla.
 */
const MODELO_IDO =
  `Probé la key contra Google y **la key no es el problema**: Google dice que el modelo que usa ` +
  `Tecnia Bot (\`${MODELO_API}\`) ya no está disponible. Pasa cuando Google retira o renombra un ` +
  `modelo.\n\n` +
  `**No es tu computadora, no es tu key y no es la red.** No hay key nueva que lo arregle: hace ` +
  `falta una versión de Tecnia Bot que apunte a un modelo vigente. Escribí \`/actualizar\`; si ` +
  `después de actualizar sigue igual, avisale al referente técnico que hay que reportarlo.\n\n` +
  `Mientras tanto podés seguir trabajando: pedime "quiero seguir sin key" y te dejo Big Pickle, el ` +
  `modelo gratuito de OpenCode, que no depende de Google.`

/** Cómo se ve la key vieja compartida cuando aparece. Nunca se guarda ni se usa. */
const KEY_VIEJA_RECHAZADA =
  `Esa es la **key de respaldo compartida** que traían las versiones anteriores de Tecnia Bot ` +
  `(hasta la 0.3.75). Se eliminó y se rotó: ya no funciona en ninguna computadora, así que no la ` +
  `guardé. Conseguí una key tuya —es gratis, con cualquier cuenta de Google y sin tarjeta— en ` +
  `${SACAR_KEY} y volvé a pegármela.`

/**
 * Cinturón y tirantes: por más que ningún mensaje interpole la key, antes de
 * devolver cualquier texto se la tapa. Si mañana alguien agrega un `return` y se
 * olvida de la regla 1, acá se corta. Cuesta tres líneas y evita que una key
 * termine en el WhatsApp del grupo de la escuela.
 */
function censurar(texto: string, clave: string): string {
  if (!clave || clave.length < 8) return texto
  return texto.split(clave).join("(tu key, tapada a propósito)")
}

/** Qué pasa con la variable de entorno, contado sin decir su valor. */
function estadoVariable(): string {
  const puesta = Boolean(process.env[VARIABLE_KEY])
  if (process.platform === "win32") {
    return puesta ? `La variable \`${VARIABLE_KEY}\` está puesta en esta compu.` : ""
  }
  if (!puesta) return ""
  // En Linux/Mac no hay "variable de usuario" persistente: la pone el shell (o un
  // .bashrc / .zshrc / .profile). No la tocamos —es el shell del docente— pero si
  // está, PISA a auth.json y hay que decirlo, porque explica el "cambié la key y
  // sigue igual".
  return (
    `La variable \`${VARIABLE_KEY}\` está definida en tu sesión y **le gana a la key guardada**. ` +
    `Si querés que mande la guardada, sacala con \`unset ${VARIABLE_KEY}\` y fijate si no está también ` +
    `en tu \`~/.bashrc\`, \`~/.zshrc\` o \`~/.profile\`. No la toco yo: es la configuración de tu shell.`
  )
}

/** Aplica la key en los tres lugares (auth.json, variable, modelo) y lo cuenta. */
async function aplicar(clave: string | null): Promise<string> {
  const auth = escribirClaveEnAuth(clave)
  if (!auth.ok) {
    if (auth.motivo === "no-parsea") {
      return (
        `Encontré el archivo de credenciales (\`${authPath()}\`) pero **no puedo leerlo**: no es un JSON ` +
        `válido. No lo toqué, para no perder lo que tengas guardado ahí de otros servicios. ` +
        `Mostrale este mensaje al referente técnico, o corré «Diagnostico de Tecnia Bot» desde el menú ` +
        `inicio: ese reporte dice si el archivo tiene BOM o por qué no parsea (sin mostrar ninguna clave).`
      )
    }
    return (
      `No pude ${clave === null ? "quitar la key de" : "guardar la key en"} \`${authPath()}\`. ` +
      `Puede ser un permiso del sistema o el antivirus. **No des por hecho que quedó guardada: no quedó.** ` +
      `Probá cerrar Tecnia Bot y correr «Reparar Tecnia Bot» desde el menú inicio.`
    )
  }

  const partes: string[] = []
  partes.push(
    clave === null
      ? "Listo: saqué la key de Google de esta compu."
      : "Listo: probé tu key contra Google, **respondió bien**, y la guardé en esta compu.",
  )

  if (process.platform === "win32") {
    const variable = await escribirVariableUsuario(clave)
    if (variable === "fallo") {
      partes.push(
        `No pude actualizar la variable \`${VARIABLE_KEY}\` de Windows (no pude lanzar PowerShell). ` +
          `Si adentro tenía una key vieja, esa le gana a la que acabo de guardar: corré «Reparar Tecnia Bot» ` +
          `desde el menú inicio para dejarlas iguales.`,
      )
    }
  } else {
    const aviso = estadoVariable()
    if (aviso) partes.push(aviso)
  }

  const modelo = clave === null ? MODELO_SIN_KEY : MODELO_CON_KEY
  const escrito = escribirModelo(modelo)
  if (escrito.ok) {
    partes.push(
      clave === null
        ? `El agente quedó en **${MODELO_SIN_KEY}** (Big Pickle). ${AVISO_BIG_PICKLE}`
        : `El agente quedó en **${MODELO_CON_KEY}** (Gemini, con tu key).`,
    )
  } else if (escrito.motivo === "no-parsea") {
    partes.push(
      `**Pero el modelo del agente NO cambió**: no pude leer \`${configPath()}\` (no parsea como JSON, ` +
        `puede tener comentarios). Lo dejé intacto para no borrarte nada. Agregale a mano: ` +
        `\`"agent": { "${AGENTE}": { "model": "${modelo}" } }\`, o corré «Reparar Tecnia Bot» desde el ` +
        `menú inicio, que lo escribe él.`,
    )
  } else {
    partes.push(
      `**Pero el modelo del agente NO cambió**: no pude escribir \`${configPath()}\`. Hasta que eso se ` +
        `arregle, el bot va a seguir usando el modelo de antes. Corré «Reparar Tecnia Bot» desde el menú inicio.`,
    )
  }

  partes.push(REINICIAR)
  return partes.join("\n\n")
}

export default tool({
  description: `Ve y cambia la API key de Google de ESTA computadora, y la PRUEBA contra Google antes de afirmar nada. Usalo cuando el usuario escriba /clave, pida cambiar o poner su key de Google, diga que se le agoto la cuota, o cuando el bot falle con "Resource has been exhausted", "quota", "API key not valid" o "Invalid API key".

Acciones:
- estado (la de /clave sin argumentos): dice si hay una key guardada, la prueba contra Google y cuenta el resultado (anda / cuota agotada / no sirve / no se pudo probar). NUNCA muestra la key.
- guardar: recibe la key en el parametro 'clave', LA PRUEBA, y solo si Google responde bien la guarda y pasa el agente a Gemini. Si no anda, no toca nada.
- quitar: deja la compu SIN key de Google y pasa el agente a Big Pickle, el modelo gratuito de OpenCode. Usalo cuando el usuario elija seguir sin key.`,
  args: {
    accion: tool.schema
      .enum(["estado", "guardar", "quitar"])
      .optional()
      .describe("'estado' (o vacio) para ver y probar la key guardada; 'guardar' para poner una nueva; 'quitar' para quedarse sin key y usar Big Pickle."),
    clave: tool.schema
      .string()
      .optional()
      .describe("La API key de Google que pego el usuario. Solo para accion 'guardar'. NUNCA la repitas en el chat."),
  },
  async execute(args) {
    const accion = args.accion ?? "estado"

    // -------------------------------------------------------------------
    // guardar: probar primero, guardar después. NUNCA al revés.
    // -------------------------------------------------------------------
    if (accion === "guardar") {
      const clave = (args.clave ?? "").trim()
      if (!clave) {
        // Sin key no se toca NADA. Un `guardar` con el parámetro vacío —un modelo
        // que llama al tool antes de que el docente conteste— no puede borrarle la
        // key que tiene funcionando. Para quedarse sin key está `quitar`, que es
        // una decisión explícita.
        return (
          `Para guardar necesito la key. Sacala en ${SACAR_KEY} (es gratis, con cualquier cuenta de ` +
          `Google y sin tarjeta) y pegámela acá. No toqué nada.` +
          ALCANCE
        )
      }
      if (esKeyVieja(clave)) {
        return censurar(KEY_VIEJA_RECHAZADA + ALCANCE, clave)
      }

      const { resultado, detalle } = await probarClave(clave)

      if (resultado === "cuota") {
        return censurar(
          `Probé esa key contra Google y **la cuota de ese proyecto ya está agotada**, así que no la ` +
            `guardé (guardártela te dejaría con el mismo error de siempre).\n\n${CUOTA_AGOTADA}` +
            ALCANCE,
          clave,
        )
      }
      if (resultado === "invalida") {
        return censurar(
          `Probé esa key contra Google y **Google la rechazó**: no es una key válida. No la guardé, así ` +
            `que quedó todo como estaba.\n\nFijate de copiarla entera (son largas y a veces se corta al ` +
            `copiar) o sacá una nueva en ${SACAR_KEY}. Después pegámela de nuevo.` +
            ALCANCE,
          clave,
        )
      }
      if (resultado === "modeloIdo") {
        return censurar(MODELO_IDO + ALCANCE, clave)
      }
      if (resultado === "sinProbar") {
        // ACÁ ES DONDE SE MIENTE FÁCIL. "No pude probarla" NO es "anda": si la
        // guardáramos igual, estaríamos haciendo lo mismo que el instalador —
        // afirmar que quedó configurada sin haberle preguntado nunca a Google.
        // Y si la red no deja llegar a Google, la key tampoco iba a andar adentro
        // del bot: el problema es el mismo.
        return censurar(
          `**No pude probar esa key**: ${detalle}. No es que no sirva — es que no pude preguntarle a ` +
            `Google, así que **no sé si anda y no la guardé**. Nada cambió en tu compu.\n\n` +
            `Suele ser la red: sin internet, o con el filtro de contenido de la escuela bloqueando a ` +
            `Google. Probá de nuevo en un rato o desde otra red. Si necesitás seguir trabajando ahora, ` +
            `pedime "quiero seguir sin key" y te dejo el modelo gratuito de OpenCode.` +
            ALCANCE,
          clave,
        )
      }

      return censurar((await aplicar(clave)) + ALCANCE, clave)
    }

    // -------------------------------------------------------------------
    // quitar: seguir sin key, con Big Pickle
    // -------------------------------------------------------------------
    if (accion === "quitar") {
      return (await aplicar(null)) + ALCANCE
    }

    // -------------------------------------------------------------------
    // estado: qué hay guardado y si anda de verdad
    // -------------------------------------------------------------------
    const ruta = authPath()
    const leido = leerJson(ruta)

    if (leido.estado === "no-parsea") {
      return (
        `Hay un archivo de credenciales en \`${ruta}\` pero **no puedo leerlo**: no es un JSON válido. ` +
        `No lo toco, para no perder lo que tengas guardado de otros servicios.\n\n` +
        `Corré «Diagnostico de Tecnia Bot» desde el menú inicio: ese reporte dice si el archivo tiene BOM ` +
        `o por qué no parsea, y no muestra ninguna clave. Ese es el dato que hace falta para arreglarlo.` +
        ALCANCE
      )
    }

    const cfg = leerJson(configPath())
    const modeloActual = cfg.estado === "ok" ? modeloDe(cfg.datos) : ""

    if (leido.estado === "no-existe" || !claveGuardada(leido.datos)) {
      const partes = [
        `**No hay ninguna key de Google guardada en esta compu.**`,
        modeloActual === MODELO_CON_KEY
          ? `Y ojo: el agente está apuntando a **${MODELO_CON_KEY}**, que necesita key. Así falla al ` +
            `primer mensaje. Pedime "quiero seguir sin key" y lo paso a Big Pickle, o pegame una key.`
          : `Tecnia Bot está usando **${MODELO_SIN_KEY}** (Big Pickle), el modelo gratuito de OpenCode. ` +
            `${AVISO_BIG_PICKLE}`,
        `Si querés usar Gemini, sacá una key gratis (con cualquier cuenta de Google, sin tarjeta) en ` +
          `${SACAR_KEY} y pegámela acá: la pruebo contra Google y recién si responde bien la guardo.`,
      ]
      const variable = estadoVariable()
      if (variable) partes.push(variable)
      return partes.join("\n\n") + ALCANCE
    }

    const clave = claveGuardada(leido.datos)

    if (esKeyVieja(clave)) {
      return (
        `La key guardada en esta compu es la **key de respaldo compartida** que traían las versiones ` +
        `anteriores (hasta la 0.3.75). Se rotó: está muerta, y es la que hace fallar al bot al primer ` +
        `mensaje.\n\nSacá una tuya —gratis, con cualquier cuenta de Google y sin tarjeta— en ${SACAR_KEY} ` +
        `y pegámela acá, o pedime "quiero seguir sin key" y te dejo el modelo gratuito de OpenCode.` +
        ALCANCE
      )
    }

    const { resultado, detalle } = await probarClave(clave)
    const partes: string[] = ["**Hay una key de Google guardada en esta compu.** (No te la muestro, ni en parte: es una credencial.)"]

    if (resultado === "anda") {
      partes.push("La probé contra Google y **anda bien**. 🎉")
      if (modeloActual && modeloActual !== MODELO_CON_KEY) {
        partes.push(
          `Pero el agente está en **${modeloActual}**, así que tu key no se está usando. Pedime "usá mi ` +
            `key de Google" y lo paso a ${MODELO_CON_KEY}.`,
        )
      }
    } else if (resultado === "cuota") {
      partes.push(`La probé contra Google y **la cuota de ese proyecto está agotada**. Es lo que hace fallar al bot.\n\n${CUOTA_AGOTADA}`)
    } else if (resultado === "invalida") {
      partes.push(
        `La probé contra Google y **Google la rechazó**: esa key ya no sirve (puede estar borrada, ` +
          `vencida o mal copiada). Sacá una nueva en ${SACAR_KEY} y pegámela acá, o pedime "quiero seguir ` +
          `sin key" y te dejo el modelo gratuito de OpenCode.`,
      )
    } else if (resultado === "modeloIdo") {
      // El `else` de abajo culpa a la red. Acá la red anda: contestó Google.
      partes.push(MODELO_IDO)
    } else {
      // Otra vez: no pude probarla NO es anda.
      partes.push(
        `**No pude probarla**: ${detalle}. Así que no sé si anda — no te digo que sí. Suele ser la red ` +
          `(sin internet, o el filtro de la escuela bloqueando a Google). Probá \`/clave\` de nuevo en un rato.`,
      )
    }

    const variable = estadoVariable()
    if (variable) partes.push(variable)
    return censurar(partes.join("\n\n") + ALCANCE, clave)
  },
})
