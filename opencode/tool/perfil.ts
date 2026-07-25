/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

// Perfil persistente del usuario. Se guarda en la config global de OpenCode
// (~/.config/opencode/tecnia-perfil.md) y se carga en el contexto de CADA sesion
// via la clave "instructions" de opencode.json (lo agrega el instalador). Asi el
// bot recuerda el nombre/rol/placa entre sesiones y NO vuelve a preguntar.
// Resolvemos la ruta igual que el plugin del logo lee su manifest.
function perfilPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecnia-perfil.md")
}

const SIN_DEFINIR = "(sin definir)"

interface Perfil {
  nombre: string
  rol: string
  placa: string
}

// Lee el perfil del disco. Si no existe o no se puede leer, devuelve todo
// "(sin definir)" (nunca rompe: es dato del usuario, se trata con cuidado).
function leerPerfil(): Perfil {
  const perfil: Perfil = { nombre: SIN_DEFINIR, rol: SIN_DEFINIR, placa: SIN_DEFINIR }
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
  if (nombre) perfil.nombre = nombre
  if (rol) perfil.rol = rol
  if (placa) perfil.placa = placa
  return perfil
}

// Arma el markdown legible del perfil (mismo formato que crea el instalador).
function renderPerfil(perfil: Perfil): string {
  return `# Perfil del usuario de Tecnia Bot
<!-- Lo mantiene Tecnia Bot. No editar a mano salvo que quieras cambiar tus datos. -->

- Nombre: ${perfil.nombre || SIN_DEFINIR}
- Rol: ${perfil.rol || SIN_DEFINIR}
- Placa preferida: ${perfil.placa || SIN_DEFINIR}
`
}

export default tool({
  description: `Perfil persistente del usuario de Tecnia Bot: recuerda el nombre, el rol y la placa entre sesiones para NO preguntarlos cada vez.

Acciones:
- leer: devuelve el perfil actual (nombre, rol, placa preferida). Usalo si tenes dudas de que datos ya estan guardados.
- guardar: guarda o actualiza los datos que te acaba de decir el usuario. Pasa solo lo que sepas (nombre, rol y/o placa); lo que no pases se conserva como estaba. Llamalo apenas el usuario te diga como se llama o si es docente/alumno, para no volver a preguntar en la proxima sesion.`,
  args: {
    accion: tool.schema
      .enum(["leer", "guardar"])
      .describe("'leer' para ver el perfil guardado; 'guardar' para persistir los datos que te dio el usuario."),
    nombre: tool.schema
      .string()
      .optional()
      .describe("Como quiere que le digas (ej: 'Marta'). Solo para accion 'guardar'."),
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
      const vacio = perfil.nombre === SIN_DEFINIR && perfil.rol === SIN_DEFINIR && perfil.placa === SIN_DEFINIR
      if (vacio) {
        return "El perfil todavía sin datos. Preguntale al usuario cómo quiere que le digas y si es docente o alumno, y guardalo con accion 'guardar'."
      }
      return `Perfil guardado del usuario:
- Nombre: ${perfil.nombre}
- Rol: ${perfil.rol}
- Placa preferida: ${perfil.placa}`
    }

    // accion === "guardar": leemos lo actual, mergeamos y reescribimos.
    // Preservamos los campos que ya tenian valor si no vienen de nuevo.
    const actual = leerPerfil()
    if (args.nombre && args.nombre.trim()) actual.nombre = args.nombre.trim()
    if (args.rol) actual.rol = args.rol
    if (args.placa) actual.placa = args.placa

    const ruta = perfilPath()
    try {
      // Bun.write escribe directo, sin depender del permiso 'write' del agente.
      await Bun.write(ruta, renderPerfil(actual))
    } catch (e) {
      return `No pude guardar el perfil (${e instanceof Error ? e.message : "error"}). Igual seguimos, se lo pregunto de nuevo mas adelante.`
    }

    return "Listo, me lo guardo. La próxima ya te reconozco y no te lo pregunto de nuevo."
  },
})
