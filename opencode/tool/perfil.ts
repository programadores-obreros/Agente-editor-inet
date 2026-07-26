/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

// Perfil persistente del usuario. Se guarda en la config global de OpenCode
// (~/.config/opencode/tecnia-perfil.md) y se carga en el contexto de CADA sesion
// via la clave "instructions" de opencode.json (lo agrega el instalador).
//
// PRIVACIDAD DE MENORES: el campo "Modo" decide si el NOMBRE se persiste.
// - Modo "personal" (compu de una sola persona): guarda el nombre y no vuelve a
//   preguntar, como siempre.
// - Modo "aula" (PC de escuela compartida por muchos chicos): el nombre es
//   EFIMERO — se usa en la charla pero NUNCA se escribe a disco (Ley 25.326: no
//   guardamos datos personales de menores en una cuenta compartida). El rol y la
//   placa no identifican a nadie, asi que si se conservan.
function perfilPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecnia-perfil.md")
}

const SIN_DEFINIR = "(sin definir)"

interface Perfil {
  nombre: string
  rol: string
  placa: string
  modo: string // "aula" | "personal" | "(sin definir)"
}

// Lee el perfil del disco. Si no existe o no se puede leer, devuelve todo
// "(sin definir)" (nunca rompe: es dato del usuario, se trata con cuidado).
function leerPerfil(): Perfil {
  const perfil: Perfil = { nombre: SIN_DEFINIR, rol: SIN_DEFINIR, placa: SIN_DEFINIR, modo: SIN_DEFINIR }
  const ruta = perfilPath()
  if (!existsSync(ruta)) return perfil
  let texto = ""
  try {
    texto = readFileSync(ruta, "utf8")
  } catch {
    return perfil
  }
  const nombre = texto.match(/^-\s*Nombre:\s*(.*)$/m)?.[1]?.trim()
  const rol = texto.match(/^-\s*Rol:\s*(.*)$/m)?.[1]?.trim()
  const placa = texto.match(/^-\s*Placa preferida:\s*(.*)$/m)?.[1]?.trim()
  const modo = texto.match(/^-\s*Modo:\s*(.*)$/m)?.[1]?.trim()
  if (nombre) perfil.nombre = nombre
  if (rol) perfil.rol = rol
  if (placa) perfil.placa = placa
  if (modo) perfil.modo = modo
  return perfil
}

// Arma el markdown legible del perfil (mismo formato que crea el instalador).
function renderPerfil(perfil: Perfil): string {
  return `# Perfil del usuario de Tecnia Bot
<!-- Lo mantiene Tecnia Bot. No editar a mano salvo que quieras cambiar tus datos.
     Modo "aula" = compu compartida: el Nombre NO se guarda (privacidad de menores). -->

- Modo: ${perfil.modo || SIN_DEFINIR}
- Nombre: ${perfil.nombre || SIN_DEFINIR}
- Rol: ${perfil.rol || SIN_DEFINIR}
- Placa preferida: ${perfil.placa || SIN_DEFINIR}
`
}

export default tool({
  description: `Perfil persistente del usuario de Tecnia Bot: recuerda el modo (aula/personal), el rol y la placa entre sesiones. El NOMBRE solo se guarda en modo 'personal'; en modo 'aula' (compu compartida de escuela) el nombre NO se persiste, por privacidad de los menores.

Acciones:
- leer: devuelve el perfil actual (modo, nombre, rol, placa). Usalo si tenes dudas de que datos ya estan guardados.
- guardar: guarda o actualiza los datos. Pasa solo lo que sepas; lo que no pases se conserva. Guarda 'modo' apenas sepas si la compu es del aula o personal (preguntalo en el primer arranque). En modo 'aula' NO tiene sentido pasar 'nombre' (no se guarda igual).`,
  args: {
    accion: tool.schema
      .enum(["leer", "guardar"])
      .describe("'leer' para ver el perfil guardado; 'guardar' para persistir los datos que te dio el usuario."),
    modo: tool.schema
      .enum(["aula", "personal"])
      .optional()
      .describe("'aula' si la compu la usan varios chicos (PC de escuela compartida) o 'personal' si es de una sola persona. Decide si el nombre se guarda. Solo para accion 'guardar'."),
    nombre: tool.schema
      .string()
      .optional()
      .describe("Como quiere que le digas (ej: 'Marta'). Solo se PERSISTE en modo 'personal'; en modo 'aula' se ignora. Solo para accion 'guardar'."),
    rol: tool.schema
      .enum(["docente", "alumno"])
      .optional()
      .describe("Si es docente preparando clases o alumno aprendiendo. Solo para accion 'guardar'."),
    placa: tool.schema
      .enum(["UNO", "ESP32", "no sé"])
      .optional()
      .describe("La placa con la que trabaja: Arduino UNO, ESP32, o 'no sé' si todavia no sabe. Solo para accion 'guardar'."),
  },
  async execute(args) {
    if (args.accion === "leer") {
      const perfil = leerPerfil()
      const vacio =
        perfil.modo === SIN_DEFINIR &&
        perfil.nombre === SIN_DEFINIR &&
        perfil.rol === SIN_DEFINIR &&
        perfil.placa === SIN_DEFINIR
      if (vacio) {
        return "El perfil todavía sin datos. Preguntale al usuario si esta compu es del aula (compartida) o personal, cómo quiere que le digas y si es docente o alumno, y guardalo con accion 'guardar'."
      }
      return `Perfil guardado del usuario:
- Modo: ${perfil.modo}
- Nombre: ${perfil.nombre}
- Rol: ${perfil.rol}
- Placa preferida: ${perfil.placa}`
    }

    // accion === "guardar": leemos lo actual, mergeamos y reescribimos.
    // Preservamos los campos que ya tenian valor si no vienen de nuevo.
    const actual = leerPerfil()
    if (args.modo) actual.modo = args.modo
    if (args.rol) actual.rol = args.rol
    if (args.placa) actual.placa = args.placa
    // El nombre SOLO se persiste en modo 'personal'. En 'aula' es efimero.
    if (args.nombre && args.nombre.trim() && actual.modo !== "aula") {
      actual.nombre = args.nombre.trim()
    }
    // Modo 'aula' = compu compartida: nunca dejamos el nombre en disco (aunque
    // hubiera uno viejo de antes de definir el modo). Privacidad de menores.
    if (actual.modo === "aula") actual.nombre = SIN_DEFINIR

    const ruta = perfilPath()
    try {
      // Bun.write escribe directo, sin depender del permiso 'write' del agente.
      await Bun.write(ruta, renderPerfil(actual))
    } catch (e) {
      return `No pude guardar el perfil (${e instanceof Error ? e.message : "error"}). Igual seguimos, se lo pregunto de nuevo mas adelante.`
    }

    if (actual.modo === "aula") {
      return "Listo. Como es una compu del aula (compartida), guardo el modo, el rol y la placa, pero NO el nombre (privacidad). Cada sesión te pregunto cómo te digo."
    }
    return "Listo, me lo guardo. La próxima ya te reconozco y no te lo pregunto de nuevo."
  },
})
