/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readdirSync } from "node:fs"

// Abre una ficha didáctica de Tecnia Lab en el navegador, lista para Ctrl+P.
//
// POR QUÉ EXISTE ESTA HERRAMIENTA. La skill `fichas` le da al agente el índice y
// la ruta de cada hoja, pero sin una herramienta para abrirlas el modelo hace lo
// único que puede: pegar la ruta y pedirle al docente que navegue hasta
// `.config\opencode\skills\fichas\hojas\`. Nadie hace eso. Es el mismo "segundo
// paso" por el que las fichas viajan adentro del instalador (ver
// docs/decisiones.md, D-01) — y se estaba perdiendo en el último metro.
//
// La capacidad ya existía: `imprimible` y `ayuda` abren archivos locales con
// esta misma función. Lo que faltaba era exponerla para las fichas.

/** Dónde quedan las hojas después de instalar la capa. */
function carpetaHojas(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "skills", "fichas", "hojas")
}

/**
 * La ruta del archivo como URL `file://`, que es lo que manda al navegador.
 *
 * En Windows hay que dar vuelta las barras y anteponer una tercera: la ruta
 * `C:\Users\x\f.pdf` tiene que viajar como `file:///C:/Users/x/f.pdf`.
 */
export function comoUrl(archivo: string): string {
  const barras = archivo.replace(/\\/g, "/")
  return "file://" + (barras.startsWith("/") ? "" : "/") + encodeURI(barras).replace(/#/g, "%23")
}

/**
 * Abre el PDF, sin bloquear (best-effort).
 *
 * VA AL NAVEGADOR PRIMERO, y la razón principal no es técnica: `imprimible` ya
 * abre sus hojas en el navegador. Si las fichas abrieran en otro lado, el
 * docente tendría dos experiencias distintas para la misma acción —imprimir algo
 * del aula— y el Ctrl+P que ya aprendió dejaría de servirle igual.
 *
 * Y ADEMÁS ES MÁS SEGURO: un navegador hay siempre, y todos traen visor de PDF.
 * Un lector dedicado puede no estar instalado en la PC de una escuela.
 *
 * El segundo intento entrega el archivo al programa asociado del sistema. Sirve
 * para quien SÍ tiene un lector dedicado y lo prefiere.
 */
function abrir(archivo: string): boolean {
  const intentos =
    process.platform === "win32"
      ? [
          ["cmd", "/c", "start", "", comoUrl(archivo)],
          ["cmd", "/c", "start", "", archivo],
        ]
      : process.platform === "darwin"
        ? [
            ["open", comoUrl(archivo)],
            ["open", archivo],
          ]
        : [
            ["xdg-open", comoUrl(archivo)],
            ["xdg-open", archivo],
          ]

  for (const cmd of intentos) {
    try {
      const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      proc.unref()
      return true
    } catch {
      /* probamos el siguiente */
    }
  }
  return false
}

/** Saca tildes y deja minúsculas, para que "potenciómetro" encuentre a "potenciometro". */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Encuentra el PDF que corresponde a lo que pidieron.
 *
 * Acepta el número ("09", "9"), el nombre ("ldr", "potenciometro") o las dos
 * cosas, porque el agente le pasa lo que el docente dijo y eso varía.
 * Exportada para poder probarla sin abrir nada.
 */
export function buscarFicha(pedido: string, archivos: string[]): string | null {
  const q = normalizar(pedido).replace(/\.pdf$/, "")
  if (!q) return null

  // 1. Coincidencia exacta de nombre de archivo.
  const exacto = archivos.find((a) => normalizar(a).replace(/\.pdf$/, "") === q)
  if (exacto) return exacto

  // 2. Por número, con o sin cero adelante: "9" y "09" son la misma ficha.
  const num = q.match(/^\d{1,2}$/)
  if (num) {
    const dosDigitos = num[0].padStart(2, "0")
    const porNumero = archivos.find((a) => a.startsWith(dosDigitos + "-"))
    if (porNumero) return porNumero
  }

  // 3. Por texto contenido en el nombre del archivo. El más corto gana, así
  //    "led" no se lleva puesto a un archivo más largo que también lo contenga.
  const candidatos = archivos
    .filter((a) => normalizar(a).includes(q))
    .sort((a, b) => a.length - b.length)
  return candidatos[0] ?? null
}

export default tool({
  description: `ABRE una ficha didáctica de Tecnia Lab en el navegador, lista para imprimir (Ctrl+P). Usalo SIEMPRE que quieras entregarle una ficha al docente. NO leas el PDF con read ni con bash —es binario, tarda y no sirve— y NO le pegues la ruta del archivo para que la busque a mano: abrísela con esta herramienta. Pasá el número ("09") o el nombre ("ldr", "servo", "rele"). Las fichas que hay están listadas en la skill \`fichas\`.`,
  args: {
    ficha: tool.schema
      .string()
      .describe(
        `Qué ficha abrir: el número ("09") o el nombre del componente ("ldr", "potenciometro", "ultrasonico", "pir", "dht11", "led", "servo", "rele", "zumbador", "arduino-uno", "tester", "tecnia-bot", "corriente-continua", "corriente-alterna", "entradas-y-salidas", "sensor-shield").`,
      ),
  },
  async execute(args) {
    const dir = carpetaHojas()

    if (!existsSync(dir)) {
      return (
        `No encuentro la carpeta de fichas (\`${dir}\`). ` +
        `Suele pasar cuando la capa se instaló con una versión anterior a la 0.3.40: ` +
        `corré \`/actualizar\` y reiniciá OpenCode.`
      )
    }

    const archivos = readdirSync(dir).filter((a) => a.toLowerCase().endsWith(".pdf"))
    if (archivos.length === 0) {
      return `La carpeta de fichas está vacía (\`${dir}\`). Corré \`/actualizar\` y reiniciá OpenCode.`
    }

    const elegida = buscarFicha(args.ficha, archivos)
    if (!elegida) {
      const lista = archivos.sort().map((a) => `- ${a.replace(/\.pdf$/, "")}`).join("\n")
      return `No tengo una ficha de "${args.ficha}". Las que hay son:\n\n${lista}`
    }

    const ruta = join(dir, elegida)
    const nombre = elegida.replace(/\.pdf$/, "")

    if (abrir(ruta)) {
      return (
        `Abrí la ficha **${nombre}** en el navegador. ` +
        `Para imprimirla o guardarla, apretá **Ctrl + P**.`
      )
    }

    // Si el sistema no la pudo abrir, la ruta es lo único que queda — pero
    // recién acá, como último recurso y no como primera respuesta.
    return (
      `No pude abrirla solo, pero está acá: \`${ruta}\`\n\n` +
      `Hacele doble clic para abrirla.`
    )
  },
})
