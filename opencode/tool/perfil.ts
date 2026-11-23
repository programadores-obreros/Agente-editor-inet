/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"

// Perfil persistente del usuario. Se guarda en ~/.config/opencode/tecnia-perfil.md
// y se carga en el contexto de CADA sesion via "instructions" de opencode.json.
//
// TRES MODOS (privacidad de menores — ver Ley 25.326):
// - "personal": 1 persona. Guarda su nombre y genero, no vuelve a preguntar.
// - "grupo": pocas personas CONOCIDAS que rotan (familia, docente + ayudantes).
//   Pregunta "quien sos" al arrancar y recuerda a CADA una (nombre, rol, genero,
//   placa) en su propio renglon. Guarda nombres: solo para grupos chicos y conocidos.
// - "aula": PC de escuela compartida por muchos chicos anonimos. El nombre y el
//   genero son EFIMEROS (se usan en la charla, NUNCA se escriben a disco). El rol
//   si se conserva. La placa TAMPOCO: la compu la comparten personas con placas
//   distintas, y servirle a uno la placa del anterior es darle pines que no existen.
function perfilPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecnia-perfil.md")
}

const SIN_DEFINIR = "(sin definir)"
// Los únicos modos con los que se guarda el nombre o el género de alguien. «(sin definir)»
// y cualquier texto escrito a mano que no sea uno de estos tres no es un modo elegido.
const MODOS_ELEGIBLES = new Set(["personal", "grupo", "aula"])

interface Persona {
  nombre: string
  rol: string
  genero: string
  placa: string
}

interface Perfil {
  modo: string // personal | grupo | aula | (sin definir)
  // Para personal/aula (una sola persona):
  nombre: string
  rol: string
  genero: string
  placa: string
  // Para grupo (varias personas conocidas):
  personas: Persona[]
}

// Parsea la seccion "## Personas": un renglon por persona con "nombre | rol | genero | placa".
function parsearPersonas(texto: string): Persona[] {
  const bloque = texto.split(/^##\s*Personas\s*$/m)[1]
  if (!bloque) return []
  const personas: Persona[] = []
  for (const linea of bloque.split("\n")) {
    const m = linea.match(/^-\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/)
    if (!m) continue
    // Los cuatro grupos son obligatorios en la regex; el default vacío es sólo para el tipo.
    const [, nombre = "", rol = "", genero = "", placa = ""] = m
    personas.push({ nombre: nombre.trim(), rol: rol.trim(), genero: genero.trim(), placa: placa.trim() })
  }
  return personas
}

/**
 * El modo tal como lo entiende el código, aunque en el archivo esté escrito de otra forma.
 *
 * El perfil se puede editar a mano (su encabezado lo dice), y las comparaciones eran
 * `=== "aula"` exactas. Con «- Modo: Aula», «AULA» o «aula (compartida)» dejaba de ser
 * modo aula: `perfil` guardaba el nombre del alumno y `cuenta` dejaba vincular la cuenta
 * del docente en una compu compartida por los chicos (auditoría del 2026-11-22, TCH-04).
 *
 * Se reconoce la palabra al principio, sin importar mayúsculas ni lo que siga. NO se
 * adivina por parecido: «aulas» o «jaula» no son el modo aula, y un texto que no es
 * ninguno de los tres se devuelve tal cual.
 *
 * Está copiada en perfil.ts, plataforma/cuenta.ts y plataforma/sincronizar.ts, porque los
 * tools no se importan entre sí. Que las tres sean iguales letra por letra lo custodia
 * tests/plataforma-sincronizar.test.mjs.
 */
function normalizarModo(crudo: string): string {
  const limpio = crudo.trim()
  const m = limpio.toLowerCase().match(/^(aula|grupo|personal)(?![a-záéíóúñ])/)
  return m ? m[1]! : limpio
}

/**
 * Los campos de texto libre van en UN renglón. El archivo se lee por renglones y se carga
 * como instrucciones en cada sesión: un nombre con un salto de línea adentro agregaba
 * renglones propios («Ana\n- Modo: aula» dejaba un segundo «- Modo:»). Devuelve el nombre
 * del primer campo que no cumple, o null.
 */
function campoConSaltoDeLinea(campos: Record<string, unknown>): string | null {
  for (const [nombre, valor] of Object.entries(campos)) {
    if (typeof valor === "string" && /[\r\n\u2028\u2029]/.test(valor)) return nombre
  }
  return null
}

// Lee el perfil del disco. Si no existe o no se puede leer, devuelve todo
// "(sin definir)" (nunca rompe: es dato del usuario, se trata con cuidado).
function leerPerfil(): Perfil {
  const perfil: Perfil = {
    modo: SIN_DEFINIR,
    nombre: SIN_DEFINIR,
    rol: SIN_DEFINIR,
    genero: SIN_DEFINIR,
    placa: SIN_DEFINIR,
    personas: [],
  }
  const ruta = perfilPath()
  if (!existsSync(ruta)) return perfil
  let texto = ""
  try {
    texto = readFileSync(ruta, "utf8")
  } catch {
    return perfil
  }
  const modo = texto.match(/^-\s*Modo:\s*(.*)$/m)?.[1]?.trim()
  const nombre = texto.match(/^-\s*Nombre:\s*(.*)$/m)?.[1]?.trim()
  const rol = texto.match(/^-\s*Rol:\s*(.*)$/m)?.[1]?.trim()
  const genero = texto.match(/^-\s*Género:\s*(.*)$/m)?.[1]?.trim()
  const placa = texto.match(/^-\s*Placa preferida:\s*(.*)$/m)?.[1]?.trim()
  if (modo) perfil.modo = normalizarModo(modo)
  if (nombre) perfil.nombre = nombre
  if (rol) perfil.rol = rol
  if (genero) perfil.genero = genero
  if (placa) perfil.placa = placa
  perfil.personas = parsearPersonas(texto)
  return perfil
}

// Upsert de una persona en la lista (match por nombre, case-insensitive). Los
// campos que no vengan se conservan del que ya estaba.
function upsertPersona(personas: Persona[], nombre: string, datos: Partial<Persona>): void {
  const i = personas.findIndex((p) => p.nombre.toLowerCase() === nombre.toLowerCase())
  const base: Persona = personas[i] ?? { nombre, rol: SIN_DEFINIR, genero: SIN_DEFINIR, placa: SIN_DEFINIR }
  const actualizada: Persona = {
    nombre,
    rol: datos.rol ?? base.rol,
    genero: datos.genero ?? base.genero,
    placa: datos.placa ?? base.placa,
  }
  if (i >= 0) personas[i] = actualizada
  else personas.push(actualizada)
}

// Arma el markdown legible del perfil (mismo formato que crea el instalador).
function renderPerfil(perfil: Perfil): string {
  let md = `# Perfil del usuario de Tecnia Bot
<!-- Lo mantiene Tecnia Bot. No editar a mano salvo que quieras cambiar tus datos.
     Modo "aula" = compu compartida por muchos: el Nombre NO se guarda (privacidad de menores).
     Modo "grupo" = pocas personas conocidas: se guarda a cada una en "## Personas". -->

- Modo: ${perfil.modo || SIN_DEFINIR}
- Nombre: ${perfil.nombre || SIN_DEFINIR}
- Rol: ${perfil.rol || SIN_DEFINIR}
- Género: ${perfil.genero || SIN_DEFINIR}
- Placa preferida: ${perfil.placa || SIN_DEFINIR}
`
  if (perfil.modo === "grupo" && perfil.personas.length) {
    md += `\n## Personas\n`
    for (const p of perfil.personas) {
      md += `- ${p.nombre} | ${p.rol || SIN_DEFINIR} | ${p.genero || SIN_DEFINIR} | ${p.placa || SIN_DEFINIR}\n`
    }
  }
  return md
}

/**
 * Escribe un archivo de texto de forma ATÓMICA: pasa por un temporal y un
 * `renameSync`, nunca un `writeFileSync` directo sobre `ruta`.
 *
 * POR QUÉ. `writeFileSync` sola trunca el archivo y lo va llenando de a poco.
 * Si el proceso muere en el medio (notebook de escuela que se queda sin
 * batería, tapa que se cierra, corte de luz) `tecnia-perfil.md` queda A
 * MEDIAS — y acá adentro puede haber nombres de personas. `rename()` es
 * atómico en POSIX y en NTFS: en el destino siempre queda el archivo VIEJO
 * entero o el NUEVO entero, nunca una mezcla.
 *
 * Está duplicada, igual que `escribirJsonSinBom` en `clave.ts` y que
 * `comoUrl` en `ayuda.ts`/`ficha.ts`/`imprimible.ts`/`circuito.ts`: este repo
 * no tiene carpeta de código compartido entre tools, y una docena de líneas
 * repetidas sale más barato que inventar esa capa.
 *
 * EL TEMPORAL VA AL LADO DEL DESTINO, EN EL MISMO DIRECTORIO — nunca
 * `os.tmpdir()`. `rename()` entre sistemas de archivos distintos tira EXDEV
 * (falla), y ahí se pierde justo el archivo que se quería proteger.
 *
 * Se usa `node:fs` y no `Bun.write`: la razón de `Bun.write` en este archivo
 * era escribir sin pasar por el permiso 'write' del AGENTE (el gate de
 * OpenCode para las tools del modelo), y `node:fs` llamado desde acá adentro
 * lo evita exactamente igual — es código del tool, no una invocación del tool
 * `write`. Lo que sí hace falta acá es `renameSync`, que Bun no ofrece con un
 * nombre propio: mezclar `Bun.write` para el temporal y `node:fs` para el
 * rename sería dos APIs para una sola operación, sin ninguna ventaja.
 */
function escribirArchivoAtomico(ruta: string, contenido: string): void {
  mkdirSync(dirname(ruta), { recursive: true })
  const temp = `${ruta}.${process.pid}.tmp` // ← mismo directorio que `ruta`, ver comentario de arriba
  try {
    writeFileSync(temp, contenido, "utf8")
    renameSync(temp, ruta)
  } catch (e) {
    try {
      unlinkSync(temp) // no dejar basura en la carpeta de config si algo falló en el medio
    } catch {
      // el temporal ni llegó a crearse, o ya no está: no hay nada que limpiar.
    }
    throw e
  }
}

export default tool({
  description: `Perfil persistente del usuario de Tecnia Bot, con tres modos segun quien usa la compu (privacidad de menores):
- "personal" (1 persona): guarda nombre y genero, no vuelve a preguntar.
- "grupo" (pocas personas conocidas que rotan): recuerda a CADA una; al arrancar preguntas "quien sos" y la buscas por nombre. Guardas cada persona pasando 'persona' (su nombre) + rol/genero/placa.
- "aula" (PC de escuela, muchos chicos anonimos): el nombre y el genero NO se guardan (privacidad), y la placa TAMPOCO (la comparten personas con placas distintas: se pregunta cada sesion). Solo el rol.

Acciones:
- leer: devuelve el perfil actual (modo y, segun el modo, la persona o la lista de personas).
- guardar: persiste datos. Pasa 'modo' apenas lo sepas (preguntalo al primer arranque): mientras la compu no tenga un modo elegido, NO se guarda el nombre ni el genero de nadie. En 'grupo' pasa 'persona' (el nombre) junto con rol/genero/placa. En 'personal' pasa 'nombre'/'genero'/rol/placa. En 'aula' el nombre, el genero y la placa se ignoran (solo se guarda el rol).

La 'placa' se escribe como la nombra el catalogo del skill \`placas\`, con la variante incluida si la placa tiene (ej: 'Educabot Bhoot v1.0', 'Mis Ladrillos R10 v1.1'). El catalogo es la unica lista de placas: este tool guarda lo que le pasan, no valida contra una lista propia.`,
  args: {
    accion: tool.schema
      .enum(["leer", "guardar"])
      .describe("'leer' para ver el perfil guardado; 'guardar' para persistir datos."),
    modo: tool.schema
      .enum(["personal", "grupo", "aula"])
      .optional()
      .describe("'personal' (1 persona), 'grupo' (pocas conocidas que rotan, se guarda a cada una) o 'aula' (muchos anonimos, no se guardan nombres). Solo para 'guardar'."),
    persona: tool.schema
      .string()
      .optional()
      .describe("En modo 'grupo': el nombre de la persona que esta usando la compu ahora, para guardar/actualizar SUS datos. Solo para 'guardar'."),
    nombre: tool.schema
      .string()
      .optional()
      .describe("En modo 'personal': como quiere que le digas (ej: 'Marta'). En 'aula' se ignora; en 'grupo' usa 'persona'. Solo para 'guardar'."),
    genero: tool.schema
      .enum(["varón", "mujer", "no binario"])
      .optional()
      .describe("Genero de la persona, para hablarle con la concordancia correcta (bienvenido/bienvenida/bienvenide). Guardalo solo si te lo dice. Solo para 'guardar'."),
    rol: tool.schema
      .enum(["docente", "alumno"])
      .optional()
      .describe("Si es docente preparando clases o alumno aprendiendo. Solo para 'guardar'."),
    /**
     * POR QUE ES UN STRING Y NO UN ENUM.
     *
     * Era `enum(["UNO", "ESP32", "no sé"])`, y eso convertia al tool en una
     * SEGUNDA fuente de verdad sobre que placas existen — que se desincronizo
     * con la primera apenas el catalogo crecio. El docente con una Educablocks
     * UNO, un Bhoot o una Mis Ladrillos no tenia donde caer: el enum le decia
     * que su placa no existe.
     *
     * La lista de placas vive en UN solo lugar, el skill `placas`. Ampliarla
     * tiene que ser editar ese markdown, no tocar TypeScript y sacar version.
     *
     * Y la validacion no se pierde, cambia de lugar: al leer el perfil, la placa
     * se busca en el catalogo. Si no esta (porque se escribio mal, o porque el
     * catalogo cambio), el bot vuelve a preguntar. El catalogo valida, el enum no.
     *
     * La VARIANTE va en el mismo string a proposito. Meterla en un campo aparte
     * obligaba a sumar una quinta columna al renglon `nombre | rol | genero |
     * placa` de "## Personas", que se parsea con una regex de cuatro grupos: los
     * perfiles que ya existen en las compus de las escuelas dejarian de leerse.
     */
    placa: tool.schema
      .string()
      .optional()
      .describe("La placa con la que trabaja, tal como la nombra el catalogo del skill `placas`, con la variante si tiene (ej: 'Arduino UNO', 'ESP32 DevKit', 'Educabot Bhoot v1.0', 'Mis Ladrillos R10 v1.1'). Si no sabe cual es, 'no sé'. Solo para 'guardar'. En modo 'aula' se ignora: ahi la placa se pregunta cada sesion."),
  },
  async execute(args) {
    if (args.accion === "leer") {
      const perfil = leerPerfil()
      const vacio =
        perfil.modo === SIN_DEFINIR &&
        perfil.nombre === SIN_DEFINIR &&
        perfil.rol === SIN_DEFINIR &&
        perfil.personas.length === 0
      if (vacio) {
        return "El perfil todavía sin datos. Preguntale al usuario si la compu es del aula (muchos), de un grupo chico conocido, o personal, y guardá el modo."
      }
      if (perfil.modo === "grupo") {
        const lista = perfil.personas.length
          ? perfil.personas.map((p) => `  - ${p.nombre} (${p.rol}, ${p.genero}, ${p.placa})`).join("\n")
          : "  (todavía sin personas)"
        return `Perfil en modo grupo. Personas conocidas de esta compu:\n${lista}\nCuando alguien te diga su nombre, buscalo acá; si no está, es nuevo (preguntale rol y género y guardalo con 'persona').`
      }
      return `Perfil guardado del usuario:
- Modo: ${perfil.modo}
- Nombre: ${perfil.nombre}
- Rol: ${perfil.rol}
- Género: ${perfil.genero}
- Placa preferida: ${perfil.placa}`
    }

    // accion === "guardar": leemos lo actual, mergeamos y reescribimos.
    const roto = campoConSaltoDeLinea({ nombre: args.nombre, persona: args.persona, placa: args.placa })
    if (roto) {
      return `No guardé nada: '${roto}' vino con un salto de línea adentro, y en el perfil cada dato va en un solo renglón. Pasámelo de nuevo en un solo renglón.`
    }
    const actual = leerPerfil()
    if (args.modo) actual.modo = args.modo
    if (args.rol) actual.rol = args.rol
    // La placa se persiste en personal y grupo. En aula NO (ver arriba): se
    // ignora en silencio, y la respuesta le recuerda al modelo que la pregunte.
    if (args.placa && actual.modo !== "aula") actual.placa = args.placa

    // Sin un modo ELEGIDO no se escribe el nombre ni el género de nadie. Toda instalación
    // nueva arranca con «- Modo: (sin definir)», y hasta el 2026-11-23 ese estado se
    // trataba como «personal»: en la notebook del aula recién instalada, que el nombre de
    // un alumno no fuera a disco dependía sólo de que el modelo obedeciera el prompt y
    // preguntara el modo primero. Decisión del owner (TCH-04): lo impide el código.
    // No se guarda NADA de la llamada (ni el rol ni la placa que vinieran con ella): una
    // respuesta «guardé una parte» es más fácil de leer mal que «no guardé nada».
    // Lo que ya estaba en el archivo no se toca: no se borra un nombre de una instalación
    // vieja, anterior a los modos.
    if (!MODOS_ELEGIBLES.has(actual.modo) && (args.nombre?.trim() || args.persona?.trim() || args.genero)) {
      return "No guardé nada: todavía no sé de quién es esta compu, y sin eso no guardo el nombre ni el género de nadie. Preguntale al usuario si la compu es del aula (la usan muchos), de un grupo chico conocido, o personal, y volvé a llamarme pasando también 'modo'."
    }

    if (actual.modo === "grupo") {
      // Guardamos POR persona (upsert). El nombre "plano" no se usa en grupo.
      const quien = (args.persona || args.nombre || "").trim()
      // En la lista de personas la barra separa las columnas: adentro de un dato la rompe.
      if (quien.includes("|") || (args.placa ?? "").includes("|")) {
        return "No guardé nada: en modo grupo el nombre y la placa no pueden llevar la barra «|», que es la que separa las columnas de cada persona. Pasámelos sin la barra."
      }
      if (quien) {
        upsertPersona(actual.personas, quien, {
          rol: args.rol,
          genero: args.genero,
          placa: args.placa,
        })
      }
      actual.nombre = SIN_DEFINIR
      actual.genero = SIN_DEFINIR
    } else if (actual.modo === "aula") {
      // Compu compartida por muchos: nombre, genero y placa EFIMEROS, nunca a disco.
      // Tambien se borra una placa que hubiera quedado de un modo anterior.
      actual.nombre = SIN_DEFINIR
      actual.genero = SIN_DEFINIR
      actual.placa = SIN_DEFINIR
    } else {
      // personal: campos "planos" de una sola persona. (Sin modo elegido no se llega
      // acá con nombre ni género: lo corta la guarda de arriba.)
      if (args.nombre && args.nombre.trim()) actual.nombre = args.nombre.trim()
      if (args.genero) actual.genero = args.genero
    }

    const ruta = perfilPath()
    try {
      escribirArchivoAtomico(ruta, renderPerfil(actual))
    } catch (e) {
      return `No pude guardar el perfil (${e instanceof Error ? e.message : "error"}). Igual seguimos.`
    }

    if (actual.modo === "aula") {
      return "Listo. Compu del aula (compartida): guardo el modo y el rol, pero NO el nombre ni el género (privacidad), ni la placa (acá trabajan personas con placas distintas). Cada sesión te pregunto cómo te digo y con qué placa estás."
    }
    if (actual.modo === "grupo") {
      const quien = (args.persona || args.nombre || "").trim()
      return quien
        ? `Anotado. En esta compu (grupo) me acuerdo de ${quien} y del resto. Cuando arranque una sesión pregunto quién está usándola.`
        : "Modo grupo guardado. Al arrancar voy a preguntar quién está usando la compu."
    }
    if (!MODOS_ELEGIBLES.has(actual.modo)) {
      // Se guardó el rol o la placa, pero no hay a quién reconocer: decir «ya te reconozco»
      // sería afirmar algo que no pasó.
      return "Guardé eso. Todavía falta saber de quién es esta compu: preguntale al usuario si es del aula, de un grupo chico conocido, o personal, y guardá el 'modo'."
    }
    return "Listo, me lo guardo. La próxima ya te reconozco y no te lo pregunto de nuevo."
  },
})
