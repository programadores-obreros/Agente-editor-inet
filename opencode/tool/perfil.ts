/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

// Perfil persistente del usuario. Se guarda en ~/.config/opencode/tecnia-perfil.md
// y se carga en el contexto de CADA sesion via "instructions" de opencode.json.
//
// TRES MODOS (privacidad de menores — ver Ley 25.326):
// - "personal": 1 persona. Guarda su nombre y genero, no vuelve a preguntar.
// - "grupo": pocas personas CONOCIDAS que rotan (familia, docente + ayudantes).
//   Pregunta "quien sos" al arrancar y recuerda a CADA una (nombre, rol, genero,
//   placa) en su propio renglon. Guarda nombres: solo para grupos chicos y conocidos.
// - "aula": PC de escuela compartida por muchos chicos anonimos. El nombre y el
//   genero son EFIMEROS (se usan en la charla, NUNCA se escriben a disco). Rol y
//   placa (no identifican a nadie) si se conservan.
function perfilPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecnia-perfil.md")
}

const SIN_DEFINIR = "(sin definir)"

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
    if (m) personas.push({ nombre: m[1].trim(), rol: m[2].trim(), genero: m[3].trim(), placa: m[4].trim() })
  }
  return personas
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
  if (modo) perfil.modo = modo
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
  const base: Persona = i >= 0 ? personas[i] : { nombre, rol: SIN_DEFINIR, genero: SIN_DEFINIR, placa: SIN_DEFINIR }
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

export default tool({
  description: `Perfil persistente del usuario de Tecnia Bot, con tres modos segun quien usa la compu (privacidad de menores):
- "personal" (1 persona): guarda nombre y genero, no vuelve a preguntar.
- "grupo" (pocas personas conocidas que rotan): recuerda a CADA una; al arrancar preguntas "quien sos" y la buscas por nombre. Guardas cada persona pasando 'persona' (su nombre) + rol/genero/placa.
- "aula" (PC de escuela, muchos chicos anonimos): el nombre y el genero NO se guardan (privacidad). Rol y placa si.

Acciones:
- leer: devuelve el perfil actual (modo y, segun el modo, la persona o la lista de personas).
- guardar: persiste datos. Pasa 'modo' apenas lo sepas (preguntalo al primer arranque). En 'grupo' pasa 'persona' (el nombre) junto con rol/genero/placa. En 'personal' pasa 'nombre'/'genero'/rol/placa. En 'aula' el nombre y el genero se ignoran.`,
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
    placa: tool.schema
      .enum(["UNO", "ESP32", "no sé"])
      .optional()
      .describe("La placa con la que trabaja: Arduino UNO, ESP32, o 'no sé'. Solo para 'guardar'."),
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
    const actual = leerPerfil()
    if (args.modo) actual.modo = args.modo
    if (args.rol) actual.rol = args.rol
    if (args.placa) actual.placa = args.placa

    if (actual.modo === "grupo") {
      // Guardamos POR persona (upsert). El nombre "plano" no se usa en grupo.
      const quien = (args.persona || args.nombre || "").trim()
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
      // Compu compartida por muchos: nombre y genero EFIMEROS, nunca a disco.
      actual.nombre = SIN_DEFINIR
      actual.genero = SIN_DEFINIR
    } else {
      // personal (o todavia sin definir): campos "planos" de una sola persona.
      if (args.nombre && args.nombre.trim()) actual.nombre = args.nombre.trim()
      if (args.genero) actual.genero = args.genero
    }

    const ruta = perfilPath()
    try {
      // Bun.write escribe directo, sin depender del permiso 'write' del agente.
      await Bun.write(ruta, renderPerfil(actual))
    } catch (e) {
      return `No pude guardar el perfil (${e instanceof Error ? e.message : "error"}). Igual seguimos.`
    }

    if (actual.modo === "aula") {
      return "Listo. Compu del aula (compartida): guardo el modo, el rol y la placa, pero NO el nombre ni el género (privacidad). Cada sesión te pregunto cómo te digo."
    }
    if (actual.modo === "grupo") {
      const quien = (args.persona || args.nombre || "").trim()
      return quien
        ? `Anotado. En esta compu (grupo) me acuerdo de ${quien} y del resto. Cuando arranque una sesión pregunto quién está usándola.`
        : "Modo grupo guardado. Al arrancar voy a preguntar quién está usando la compu."
    }
    return "Listo, me lo guardo. La próxima ya te reconozco y no te lo pregunto de nuevo."
  },
})
