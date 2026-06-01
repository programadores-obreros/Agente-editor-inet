/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"

// Ruta del bundle de piezas Wokwi Elements (se instala con Profe Bot).
function bundlePath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "profebot-web", "wokwi-bundle.js")
}

// CSS común a todos los circuitos.
const ESTILO = `
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#eef2f5; margin:0; padding:24px; color:#1a2733; }
  .hoja { max-width:960px; margin:0 auto; background:#fff; border-radius:16px; box-shadow:0 6px 28px rgba(0,0,0,.10); padding:28px 34px; }
  h1 { font-size:23px; margin:0 0 2px; color:#2c3e50; }
  .sub { color:#7f8c8d; font-size:14px; margin-bottom:18px; }
  .escena { position:relative; height:300px; margin:6px 0 14px; }
  .pieza { position:absolute; transform:scale(1.4); transform-origin:top left; }
  .izq { left:30px; top:40px; }
  .der { left:660px; top:80px; }
  svg.cables { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5; }
  .et { font:600 12px 'Segoe UI'; fill:#2c3e50; }
  .aviso { background:#fff4e5; border-left:4px solid #f39c12; padding:11px 15px; border-radius:8px; font-size:14px; margin:16px 0; }
  .badge { display:inline-block; background:#27ae60; color:#fff; font-size:12px; padding:3px 10px; border-radius:20px; margin-left:8px; }
  table { width:100%; border-collapse:collapse; margin-top:14px; font-size:14px; }
  th,td { text-align:left; padding:9px 11px; border-bottom:1px solid #eef0f2; }
  th { background:#f7f9fb; color:#34495e; }
  .dot{display:inline-block;width:13px;height:13px;border-radius:50%;margin-right:7px;vertical-align:middle;border:1px solid rgba(0,0,0,.15);}
`

interface Plantilla {
  titulo: string
  sub: string
  escena: string
  aviso: string
  tabla: string
  animacion: string
}

// Cada circuito es una plantilla VALIDADA a mano (piezas reales + cables + animación).
// El modelo NO calcula nada: solo elige la clave.
const PLANTILLAS: Record<string, Plantilla> = {
  "servo-esp32": {
    titulo: "🔌 Servo SG90 + ESP32",
    sub: "el servo gira de 0° a 180° como en la vida real",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,110 C440,110 470,150 690,150" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,150 C440,150 470,168 690,168" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C440,190 470,186 690,186" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="100">🔴 5V (VIN)</text>
        <text class="et" x="300" y="142">🟡 GPIO18 (señal)</text>
        <text class="et" x="300" y="212">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-servo id="servo" class="pieza der"></wokwi-servo>`,
    aviso:
      "⚠️ <strong>Atención (ESP32):</strong> el SG90 necesita 5V. Conectá el cable rojo a <strong>VIN (5V)</strong>, nunca a 3.3V. La señal (naranja) a un GPIO funciona bien a 3.3V.",
    tabla: `
      <tr><th>Cable del servo</th><th>Color</th><th>Va al ESP32</th></tr>
      <tr><td>Alimentación</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>VIN (5V)</td></tr>
      <tr><td>Señal</td><td><span class="dot" style="background:#f39c12"></span>Naranja</td><td>GPIO18</td></tr>
      <tr><td>Tierra</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const servo = document.getElementById('servo');
      let a = 0, dir = 1;
      setInterval(() => { a += dir*3; if (a>=180||a<=0) dir*=-1; if (servo) servo.hornAngle = a; }, 30);`,
  },

  "led-esp32": {
    titulo: "💡 LED + ESP32",
    sub: "el LED parpadea como con el código Blink",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,140 C440,140 470,150 700,150" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C440,190 470,180 700,180" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="320" y="132">🟡 GPIO2 (con resistencia 330Ω)</text>
        <text class="et" x="320" y="212">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-led id="led" color="red" class="pieza der"></wokwi-led>`,
    aviso:
      "⚠️ <strong>Atención:</strong> el LED siempre va con una resistencia de 330Ω en serie (en ESP32, por los 3.3V). Respetá la polaridad: la pata larga (ánodo) al pin, la corta (cátodo) a GND.",
    tabla: `
      <tr><th>Pata del LED</th><th>Color cable</th><th>Va al ESP32</th></tr>
      <tr><td>Ánodo (larga)</td><td><span class="dot" style="background:#f39c12"></span>Naranja</td><td>GPIO2 (con 330Ω)</td></tr>
      <tr><td>Cátodo (corta)</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const led = document.getElementById('led');
      let on = false;
      setInterval(() => { on = !on; if (led) led.value = on; }, 600);`,
  },

  "ultrasonico-esp32": {
    titulo: "📏 Sensor ultrasónico HC-SR04 + ESP32",
    sub: "mide distancia, como un radar (el sensor late)",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,100 C440,100 470,140 690,140" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,135 C440,135 470,155 690,155" stroke="#27ae60" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,170 C440,170 470,170 690,170" stroke="#2980b9" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,205 C440,205 470,185 690,185" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="92">🔴 VCC (5V / VIN)</text>
        <text class="et" x="300" y="128">🟢 TRIG → GPIO5</text>
        <text class="et" x="300" y="200">🔵 ECHO → GPIO18 (¡con divisor!)</text>
        <text class="et" x="300" y="226">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-hc-sr04 id="sensor" class="pieza der"></wokwi-hc-sr04>`,
    aviso:
      "⚠️ <strong>Atención (ESP32):</strong> el HC-SR04 funciona a 5V (alimentalo de VIN). El pin ECHO entrega 5V — conectalo al ESP32 con un <strong>divisor de tensión</strong> (dos resistencias) para bajarlo a 3.3V, o podés dañar el ESP32.",
    tabla: `
      <tr><th>Pin del sensor</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>VCC</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>VIN (5V)</td></tr>
      <tr><td>TRIG</td><td><span class="dot" style="background:#27ae60"></span>Verde</td><td>GPIO5</td></tr>
      <tr><td>ECHO</td><td><span class="dot" style="background:#2980b9"></span>Azul</td><td>GPIO18 (con divisor)</td></tr>
      <tr><td>GND</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const s = document.getElementById('sensor');
      let t = 0;
      setInterval(() => { t += 0.1; if (s) s.style.opacity = (0.7 + 0.3*Math.abs(Math.sin(t))).toFixed(2); }, 60);`,
  },

  "buzzer-esp32": {
    titulo: "🔊 Buzzer + ESP32",
    sub: "suena cuando el pin se activa (el buzzer vibra)",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,140 C440,140 470,150 700,150" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C440,190 470,180 700,180" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="320" y="132">🟡 + → GPIO4</text>
        <text class="et" x="320" y="212">🟤 - → GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-buzzer id="buzzer" class="pieza der"></wokwi-buzzer>`,
    aviso:
      "⚠️ <strong>Atención:</strong> el buzzer tiene polaridad. La pata larga (+) va al pin, la corta (-) a GND. Para que suene se usa la función <code>tone()</code> en el código.",
    tabla: `
      <tr><th>Pata del buzzer</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>Positivo (+)</td><td><span class="dot" style="background:#f39c12"></span>Naranja</td><td>GPIO4</td></tr>
      <tr><td>Negativo (-)</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const b = document.getElementById('buzzer');
      let on = false;
      setInterval(() => { on = !on; if (b) b.hasSignal = on; }, 400);`,
  },

  "potenciometro-esp32": {
    titulo: "🎛️ Potenciómetro + ESP32",
    sub: "la perilla gira sola para mostrar cómo varía el valor",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,100 C440,100 470,140 700,140" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,150 C440,150 470,165 700,165" stroke="#9b59b6" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,200 C440,200 470,190 700,190" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="92">🔴 3.3V</text>
        <text class="et" x="300" y="142">🟣 cursor → GPIO34 (entrada analógica)</text>
        <text class="et" x="300" y="222">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-potentiometer id="pot" class="pieza der"></wokwi-potentiometer>`,
    aviso:
      "💡 <strong>Tip:</strong> en el ESP32 usá un pin de entrada analógica (GPIO32 a GPIO39). GPIO34 es solo entrada, ideal para esto. El valor se lee con <code>analogRead()</code> (0 a 4095 en ESP32).",
    tabla: `
      <tr><th>Pin del potenciómetro</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>Extremo 1</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>3.3V</td></tr>
      <tr><td>Cursor (centro)</td><td><span class="dot" style="background:#9b59b6"></span>Violeta</td><td>GPIO34</td></tr>
      <tr><td>Extremo 2</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const p = document.getElementById('pot');
      let v = 0, dir = 1;
      setInterval(() => { v += dir*4; if (v>=100||v<=0) dir*=-1; if (p) p.percent = v; }, 40);`,
  },
}

function construirHTML(p: Plantilla, scriptSrc: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Profe Bot — ${p.titulo}</title>
<script src="${scriptSrc}"></script>
<style>${ESTILO}</style>
</head>
<body>
<div class="hoja">
  <h1>${p.titulo} <span class="badge">▶ animado</span></h1>
  <div class="sub">Esquema de conexión — Profe Bot · piezas reales, ${p.sub}</div>
  <div class="escena">${p.escena}</div>
  <div class="aviso">${p.aviso}</div>
  <table>${p.tabla}</table>
</div>
<script>${p.animacion}</script>
</body>
</html>`
}

export default tool({
  description: `ÚNICO método aprobado para generar cualquier circuito visual, esquema, diagrama animado o "circuito bonito" de Arduino/ESP32. Genera un HTML con piezas REALES (Wokwi Elements) y animación (el servo gira, el LED parpadea) que el alumno abre en el navegador SIN internet.

USALO SIEMPRE que pidan un circuito visual/animado/bonito/esquema/"para mostrar". NUNCA dibujes vos un SVG o HTML a mano: este tool ya tiene todo hecho, solo elegís el circuito.

Circuitos disponibles: servo-esp32, led-esp32, ultrasonico-esp32, buzzer-esp32, potenciometro-esp32.`,
  args: {
    circuito: tool.schema
      .enum(["servo-esp32", "led-esp32", "ultrasonico-esp32", "buzzer-esp32", "potenciometro-esp32"])
      .describe("Qué circuito generar"),
    nombre_archivo: tool.schema
      .string()
      .optional()
      .describe("Nombre del archivo HTML (sin extensión). Por defecto usa el nombre del circuito."),
  },
  async execute(args, ctx) {
    const plantilla = PLANTILLAS[args.circuito]
    if (!plantilla) {
      return `No tengo ese circuito todavía. Disponibles: ${Object.keys(PLANTILLAS).join(", ")}.`
    }

    const bundle = bundlePath()
    if (!existsSync(bundle)) {
      return "No encontré la biblioteca de piezas (wokwi-bundle.js). Reinstalá Profe Bot con el instalador para que copie la biblioteca visual."
    }

    const scriptSrc = `file://${bundle}`
    const html = construirHTML(plantilla, scriptSrc)

    const base = args.nombre_archivo ?? `circuito-${args.circuito}`
    const archivo = join(ctx.directory, `${base}.html`)
    await Bun.write(archivo, html)

    return `Listo! Generé el circuito visual y animado.

**Abrilo en tu navegador (doble clic o pegá esto):**
file://${archivo}

Vas a ver las piezas reales conectadas con cables de colores, y la animación funcionando. Todo sin internet.`
  },
})
