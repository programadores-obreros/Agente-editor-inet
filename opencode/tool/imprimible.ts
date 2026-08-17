/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { join } from "node:path"

// Hoja para imprimir/repartir en el aula: materiales + conexiones + codigo,
// en una HTML optimizada para impresion. El docente la abre y hace Ctrl+P
// (Guardar como PDF o imprimir). SIN dependencias: el navegador hace el PDF,
// asi el .exe sigue siendo offline y de un doble clic (no traemos Typst/Docker).

// Abre el HTML en el navegador por defecto, sin bloquear la tool (best-effort).
function abrirEnNavegador(archivo: string): boolean {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", archivo]
        : process.platform === "darwin"
          ? ["open", archivo]
          : ["xdg-open", archivo]
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    proc.unref()
    return true
  } catch {
    return false
  }
}

/**
 * El atajo de imprimir, que NO es el mismo en todos lados: en macOS es Cmd+P.
 * Está duplicado en ficha.ts a propósito — una línea repetida cuesta menos que
 * un módulo compartido para dos usos. Si aparece un tercero, se comparte.
 */
function atajoImprimir(): string {
  return process.platform === "darwin" ? "Cmd + P" : "Ctrl + P"
}

// Escapa HTML para meter texto (codigo, materiales) sin romper el markup ni
// permitir inyeccion. Imprescindible para el bloque de codigo (tiene < > &).
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Nombre de archivo seguro a partir del titulo.
function nombreSeguro(titulo: string): string {
  const base = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base ? `hoja-${base}` : "hoja-proyecto"
}

// CSS: marca violeta Tecnia Lab, tipografia legible, y reglas @media print para
// que salga prolijo en A4 (sin cortar el codigo al medio, sin el banner de pantalla).
const CSS = `
  :root{ --violeta:#6d28d9; --tinta:#1f2430; --gris:#5b6472; --linea:#e6e8ec; }
  *{ box-sizing:border-box; }
  body{ margin:0; font:14px/1.5 'Segoe UI',system-ui,sans-serif; color:var(--tinta); background:#f3f4f7; }
  .hoja{ max-width:800px; margin:18px auto; background:#fff; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,.08); overflow:hidden; }
  .barra{ height:6px; background:var(--violeta); }
  .cab{ padding:20px 30px 8px; }
  .cab h1{ margin:0; font-size:22px; color:var(--tinta); }
  .cab .sub{ color:var(--gris); font-size:13px; margin-top:2px; }
  .cab .placa{ display:inline-block; margin-top:8px; padding:2px 10px; border:1px solid var(--violeta); color:var(--violeta); border-radius:99px; font-size:12px; font-weight:600; }
  .cont{ padding:8px 30px 26px; }
  h2{ font-size:15px; color:var(--violeta); border-bottom:2px solid var(--linea); padding-bottom:4px; margin:22px 0 10px; }
  ul.mat{ margin:0; padding-left:20px; } ul.mat li{ margin:3px 0; }
  table.conex{ width:100%; border-collapse:collapse; font-size:13px; }
  table.conex th,table.conex td{ text-align:left; padding:6px 8px; border-bottom:1px solid var(--linea); }
  table.conex th{ background:#f7f7fb; color:#34405a; }
  pre.codigo{ background:#0f1117; color:#e6e8ec; padding:14px 16px; border-radius:8px; font:12.5px/1.5 'Cascadia Code',Consolas,monospace; overflow-x:auto; white-space:pre-wrap; word-wrap:break-word; }
  .notas{ background:#fdf6ec; border-left:4px solid #e0a43b; padding:10px 14px; border-radius:6px; font-size:13px; }
  .pie{ color:var(--gris); font-size:11px; text-align:center; padding:14px; border-top:1px solid var(--linea); }
  .aviso-print{ background:var(--violeta); color:#fff; text-align:center; padding:9px; font-size:13px; }
  @media print{
    body{ background:#fff; }
    .hoja{ max-width:100%; margin:0; box-shadow:none; border-radius:0; }
    .aviso-print{ display:none; }
    h2{ break-after:avoid; }
    pre.codigo, table.conex, .notas{ break-inside:avoid; }
    pre.codigo{ background:#f4f5f7; color:#1f2430; border:1px solid #d9dce2; }
    @page{ margin:1.4cm; }
  }
`

export default tool({
  description: `Genera una HOJA para IMPRIMIR o repartir en el aula (materiales + conexiones + codigo) y la abre en el navegador para que el docente haga Ctrl+P —o Cmd+P en Mac— (guardar como PDF o imprimir). Usalo cuando pidan "materiales para imprimir", "hoja para el aula", "lista de materiales", "para repartir", "en PDF". El contenido lo armas vos (sacalo del skill proyectos-inet): pasas titulo, materiales, conexiones y codigo.`,
  args: {
    titulo: tool.schema.string().describe("Titulo del proyecto (ej: 'Semáforo con 3 LEDs — ESP32')."),
    placa: tool.schema.enum(["UNO", "ESP32"]).optional().describe("La placa del proyecto, para mostrarla en el encabezado."),
    materiales: tool.schema
      .array(tool.schema.string())
      .describe("Lista de materiales, uno por elemento con cantidad (ej: '3x LED (rojo, amarillo, verde)', '3x resistencia 330Ω', '1x protoboard')."),
    conexiones: tool.schema
      .array(tool.schema.string())
      .describe("Conexiones, una por elemento (ej: 'LED rojo (ánodo) → GPIO12 con 330Ω', 'LED rojo (cátodo) → GND'). Se muestran como tabla."),
    codigo: tool.schema.string().describe("El código comentado del proyecto (en español, línea por línea)."),
    notas: tool.schema.string().optional().describe("Notas de seguridad o tips (opcional): ej. los 3.3V del ESP32, polaridad, etc."),
  },
  async execute(args, ctx) {
    const placa = args.placa ? `<span class="placa">${esc(args.placa)}</span>` : ""
    const materiales = (args.materiales || []).map((m) => `<li>${esc(m)}</li>`).join("\n")
    const conexiones = (args.conexiones || [])
      .map((c) => {
        const partes = c.split(/\s*(?:→|->|:)\s*/, 2)
        return partes.length === 2
          ? `<tr><td>${esc(partes[0])}</td><td>${esc(partes[1])}</td></tr>`
          : `<tr><td colspan="2">${esc(c)}</td></tr>`
      })
      .join("\n")
    const notas = args.notas ? `<h2>Antes de prender</h2>\n<div class="notas">${esc(args.notas)}</div>` : ""

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(args.titulo)} — Tecnia Bot</title><style>${CSS}</style></head>
<body>
  <div class="aviso-print">🖨️ Para guardar como PDF o imprimir: apretá <strong>${atajoImprimir()}</strong> (este aviso no sale impreso).</div>
  <div class="hoja">
    <div class="barra"></div>
    <div class="cab">
      <h1>${esc(args.titulo)}</h1>
      <div class="sub">Hoja para el aula — Tecnia Bot</div>
      ${placa}
    </div>
    <div class="cont">
      <h2>Materiales</h2>
      <ul class="mat">${materiales}</ul>
      <h2>Conexiones</h2>
      <table class="conex"><thead><tr><th>Componente / pin</th><th>Va a</th></tr></thead><tbody>${conexiones}</tbody></table>
      <h2>Código</h2>
      <pre class="codigo">${esc(args.codigo)}</pre>
      ${notas}
    </div>
    <div class="pie">Tecnia Bot · tecnialab.net.ar — material educativo para escuelas técnicas (programa INET)</div>
  </div>
</body></html>`

    const archivo = join(ctx.directory, `${nombreSeguro(args.titulo)}.html`)
    try {
      await Bun.write(archivo, html)
    } catch (e) {
      return `No pude crear la hoja (${e instanceof Error ? e.message : "error"}).`
    }
    const abierto = abrirEnNavegador(archivo)
    const comoAbrir = abierto
      ? "**Te la abrí en el navegador.**"
      : `Abrila con doble clic: \`file://${archivo}\``
    return `Listo, armé la hoja para imprimir de **${args.titulo}**. ${comoAbrir} Para guardarla como PDF o imprimirla, apretá **${atajoImprimir()}**. Ideal para repartir en el aula.`
  },
})
