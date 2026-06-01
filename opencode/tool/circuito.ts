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
  /* layout del ARMADOR LIBRE: ESP32 fija a la izquierda + una fila por componente */
  .circuito-libre{display:grid;grid-template-columns:230px 1fr;gap:0;align-items:center;margin:10px 0 6px;}
  .esp-col{display:flex;justify-content:center;align-items:center;}
  .filas-libre{display:flex;flex-direction:column;}
  .fila{display:grid;grid-template-columns:240px 170px;align-items:center;gap:14px;padding:12px 0;border-bottom:1px dashed #eef0f2;}
  .fila:last-child{border-bottom:none;}
  .conex{font-size:13px;line-height:1.8;}
  .conex .pin{white-space:nowrap;}
  .pieza-cell{display:flex;align-items:center;min-height:80px;}
`

interface Plantilla {
  titulo: string
  sub: string
  escena: string
  aviso: string
  tabla: string
  animacion: string
  alto?: number // alto de la escena en px (default 300; proyectos usan más)
  interactivo?: boolean // si el alumno controla algo con el mouse
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
    titulo: "🎛️ Potenciómetro controla un LED + ESP32",
    sub: "girá la perilla con el mouse y mirá cómo cambia el brillo del LED",
    interactivo: true,
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,100 C400,100 430,135 560,135" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,150 C400,150 430,160 560,160" stroke="#9b59b6" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,200 C400,200 430,185 560,185" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="285" y="92">🔴 3.3V</text>
        <text class="et" x="285" y="142">🟣 cursor → GPIO34 (entrada analógica)</text>
        <text class="et" x="285" y="222">🟤 GND</text>
        <path d="M650,150 C720,150 740,140 800,140" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="6 4"/>
        <text class="et" x="650" y="125">el ESP32 enciende el LED según el valor</text>
      </svg>
      <wokwi-potentiometer id="pot" class="pieza" style="left:30px;top:90px"></wokwi-potentiometer>
      <wokwi-esp32-devkit-v1 class="pieza" style="left:380px;top:40px;transform:scale(1.0)"></wokwi-esp32-devkit-v1>
      <wokwi-led id="led" color="red" class="pieza" style="left:800px;top:70px"></wokwi-led>
      <div id="valor" style="position:absolute;left:30px;top:255px;font:700 16px 'Segoe UI';color:#2c3e50">Brillo: 0%</div>`,
    aviso:
      "✋ <strong>¡Probalo!</strong> arrastrá la perilla del potenciómetro con el mouse hacia un lado y el otro. El LED cambia de brillo en tiempo real. Así funciona <code>analogRead()</code> (lee la perilla, 0 a 4095) + <code>analogWrite()</code> (enciende el LED). En el ESP32 usá un pin analógico como GPIO34.",
    tabla: `
      <tr><th>Pin del potenciómetro</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>Extremo 1</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>3.3V</td></tr>
      <tr><td>Cursor (centro)</td><td><span class="dot" style="background:#9b59b6"></span>Violeta</td><td>GPIO34</td></tr>
      <tr><td>Extremo 2</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const pot = document.getElementById('pot');
      const led = document.getElementById('led');
      const valor = document.getElementById('valor');
      function actualizar(){
        const pct = pot.percent ?? 0;
        led.brightness = pct/100;
        led.value = pct > 2;
        valor.textContent = 'Brillo: ' + Math.round(pct) + '%';
      }
      pot.addEventListener('input', actualizar);
      pot.percent = 0; actualizar();`,
  },

  "dht22-esp32": {
    titulo: "🌡️ Sensor de temperatura DHT22 + ESP32",
    sub: "mide temperatura y humedad (el sensor late)",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,110 C440,110 470,145 700,145" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,150 C440,150 470,165 700,165" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C440,190 470,185 700,185" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="102">🔴 VCC (3.3V)</text>
        <text class="et" x="300" y="142">🟡 DATA → GPIO15</text>
        <text class="et" x="300" y="212">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-dht22 id="sensor" class="pieza der"></wokwi-dht22>`,
    aviso:
      "💡 <strong>Tip:</strong> el DHT22 funciona a 3.3V en el ESP32 (también acepta 5V). Necesita la librería DHT. A veces conviene una resistencia pull-up de 10kΩ entre DATA y VCC.",
    tabla: `
      <tr><th>Pin del sensor</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>VCC (+)</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>3.3V</td></tr>
      <tr><td>DATA</td><td><span class="dot" style="background:#f39c12"></span>Naranja</td><td>GPIO15</td></tr>
      <tr><td>GND (-)</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const s = document.getElementById('sensor');
      let t = 0;
      setInterval(() => { t += 0.08; if (s) s.style.opacity = (0.75 + 0.25*Math.abs(Math.sin(t))).toFixed(2); }, 60);`,
  },

  "pir-esp32": {
    titulo: "🚶 Sensor de movimiento PIR + ESP32",
    sub: "detecta movimiento (el sensor pulsa como si detectara)",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,110 C440,110 470,145 700,145" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,150 C440,150 470,165 700,165" stroke="#27ae60" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C440,190 470,185 700,185" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="102">🔴 VCC (5V / VIN)</text>
        <text class="et" x="300" y="142">🟢 OUT → GPIO13</text>
        <text class="et" x="300" y="212">🟤 GND</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-pir-motion-sensor id="sensor" class="pieza der"></wokwi-pir-motion-sensor>`,
    aviso:
      "💡 <strong>Tip:</strong> el PIR se alimenta de 5V (VIN). Su salida OUT da 3.3V, así que se conecta directo a un GPIO. Tarda unos 30-60 segundos en 'calibrarse' al encender.",
    tabla: `
      <tr><th>Pin del sensor</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>VCC</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>VIN (5V)</td></tr>
      <tr><td>OUT</td><td><span class="dot" style="background:#27ae60"></span>Verde</td><td>GPIO13</td></tr>
      <tr><td>GND</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const s = document.getElementById('sensor');
      let on = false;
      setInterval(() => { on = !on; if (s) s.style.filter = on ? 'drop-shadow(0 0 12px #27ae60)' : 'none'; }, 800);`,
  },

  "lcd-esp32": {
    titulo: "📟 Display LCD 16x2 (I2C) + ESP32",
    sub: "muestra texto en pantalla, solo 4 cables con I2C",
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,100 C420,100 450,135 660,135" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,135 C420,135 450,150 660,150" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,170 C420,170 450,165 660,165" stroke="#3498db" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,205 C420,205 450,180 660,180" stroke="#9b59b6" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="295" y="92">🔴 VCC (5V)</text>
        <text class="et" x="295" y="128">🟤 GND</text>
        <text class="et" x="295" y="200">🔵 SDA → GPIO21</text>
        <text class="et" x="295" y="226">🟣 SCL → GPIO22</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
      <wokwi-lcd1602 id="lcd" text="Hola Profe Bot!  Escuela tecnica" backlight class="pieza der" style="left:600px;"></wokwi-lcd1602>`,
    aviso:
      "💡 <strong>Tip:</strong> el módulo I2C reduce el LCD a solo 4 cables (sin él serían 16). En el ESP32, SDA=GPIO21 y SCL=GPIO22 por defecto. Necesita la librería LiquidCrystal_I2C.",
    tabla: `
      <tr><th>Pin del LCD (I2C)</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>VCC</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>VIN (5V)</td></tr>
      <tr><td>GND</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>
      <tr><td>SDA</td><td><span class="dot" style="background:#3498db"></span>Azul</td><td>GPIO21</td></tr>
      <tr><td>SCL</td><td><span class="dot" style="background:#9b59b6"></span>Violeta</td><td>GPIO22</td></tr>`,
    animacion: `
      const lcd = document.getElementById('lcd');
      const msgs = ["Hola Profe Bot!  Escuela tecnica", "Temperatura:     25.3 grados C", "Programando con  Arduino y ESP32"];
      let i = 0;
      setInterval(() => { i = (i+1) % msgs.length; if (lcd) lcd.text = msgs[i]; }, 1800);`,
  },

  "boton-esp32": {
    titulo: "🔘 Botón enciende un LED + ESP32",
    sub: "apretá el botón con el mouse y se prende el LED",
    interactivo: true,
    escena: `
      <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
        <path d="M250,150 C380,150 400,160 470,160" stroke="#27ae60" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M250,200 C380,200 400,185 470,185" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
        <text class="et" x="270" y="142">🟢 GPIO14 (INPUT_PULLUP)</text>
        <text class="et" x="270" y="222">🟤 GND</text>
        <path d="M600,150 C700,150 720,140 800,140" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="6 4"/>
        <text class="et" x="610" y="125">al apretar, el ESP32 enciende el LED</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza" style="left:30px;top:40px"></wokwi-esp32-devkit-v1>
      <wokwi-pushbutton id="boton" color="green" class="pieza" style="left:400px;top:110px"></wokwi-pushbutton>
      <wokwi-led id="led" color="red" class="pieza" style="left:800px;top:70px"></wokwi-led>
      <div id="estado" style="position:absolute;left:30px;top:255px;font:700 16px 'Segoe UI';color:#2c3e50">LED apagado</div>`,
    aviso:
      "✋ <strong>¡Probalo!</strong> hacé clic y mantené apretado el botón verde: el LED se prende. Soltalo y se apaga. Así funciona <code>digitalRead()</code> con <code>INPUT_PULLUP</code>: sin apretar lee HIGH, al apretar lee LOW.",
    tabla: `
      <tr><th>Pata del botón</th><th>Cable</th><th>Va al ESP32</th></tr>
      <tr><td>Una pata</td><td><span class="dot" style="background:#27ae60"></span>Verde</td><td>GPIO14 (INPUT_PULLUP)</td></tr>
      <tr><td>Otra pata</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>`,
    animacion: `
      const b = document.getElementById('boton');
      const led = document.getElementById('led');
      const estado = document.getElementById('estado');
      function set(on){ if(led){ led.value = on; } if(estado){ estado.textContent = on ? '¡LED encendido!' : 'LED apagado'; } }
      b.addEventListener('button-press', () => set(true));
      b.addEventListener('button-release', () => set(false));
      set(false);`,
  },

  // ============ PROYECTOS INTEGRADORES (varios componentes) ============

  "estacion-meteo": {
    titulo: "🌦️ Estación meteorológica",
    sub: "ESP32 + DHT22 + LCD — mide temperatura y humedad y las muestra en pantalla",
    alto: 460,
    escena: `
      <svg class="cables" viewBox="0 0 980 460" preserveAspectRatio="none">
        <path d="M250,120 C400,120 430,95 640,95" stroke="#e74c3c" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,155 C400,155 430,115 640,115" stroke="#f39c12" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,190 C400,190 430,135 640,135" stroke="#5d4037" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,230 C400,230 430,300 600,300" stroke="#3498db" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,265 C400,265 430,320 600,320" stroke="#9b59b6" stroke-width="4" fill="none" stroke-linecap="round"/>
        <text class="et" x="285" y="88">🔴🟡🟤 DHT22 → 3.3V, GPIO15, GND</text>
        <text class="et" x="285" y="295">🔵🟣 LCD I2C → SDA=GPIO21, SCL=GPIO22</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza" style="left:20px;top:60px"></wokwi-esp32-devkit-v1>
      <wokwi-dht22 class="pieza" style="left:640px;top:55px"></wokwi-dht22>
      <wokwi-lcd1602 id="lcd" text="Temp: 25.3 C     Hum: 60%" backlight class="pieza" style="left:560px;top:280px"></wokwi-lcd1602>`,
    aviso:
      "💡 <strong>Proyecto integrador:</strong> el DHT22 mide, el LCD muestra. El DHT22 va a 3.3V; el LCD por I2C usa solo 4 cables (VCC, GND, SDA=GPIO21, SCL=GPIO22). Librerías: DHT y LiquidCrystal_I2C.",
    tabla: `
      <tr><th>Componente</th><th>Pin</th><th>Va al ESP32</th></tr>
      <tr><td>DHT22</td><td>VCC / DATA / GND</td><td>3.3V / GPIO15 / GND</td></tr>
      <tr><td>LCD I2C</td><td>VCC / GND / SDA / SCL</td><td>VIN / GND / GPIO21 / GPIO22</td></tr>`,
    animacion: `
      const lcd = document.getElementById('lcd');
      const m = ["Temp: 25.3 C     Hum: 60%", "Temp: 26.1 C     Hum: 58%", "Profe Bot listo!  Estacion meteo"];
      let i = 0;
      setInterval(() => { i = (i+1)%m.length; if (lcd) lcd.text = m[i]; }, 1800);`,
  },

  "alarma": {
    titulo: "🚨 Alarma de movimiento",
    sub: "ESP32 + PIR + buzzer + LED — detecta movimiento y avisa con sonido y luz",
    alto: 460,
    escena: `
      <svg class="cables" viewBox="0 0 980 460" preserveAspectRatio="none">
        <path d="M250,110 C400,110 430,85 660,85" stroke="#27ae60" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,200 C400,200 430,250 700,250" stroke="#f39c12" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,280 C400,280 430,370 700,370" stroke="#e74c3c" stroke-width="4" fill="none" stroke-linecap="round"/>
        <text class="et" x="290" y="78">🟢 PIR OUT → GPIO13</text>
        <text class="et" x="290" y="245">🟡 Buzzer → GPIO4</text>
        <text class="et" x="290" y="365">🔴 LED → GPIO2 (con 330Ω)</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza" style="left:20px;top:60px"></wokwi-esp32-devkit-v1>
      <wokwi-pir-motion-sensor id="pir" class="pieza" style="left:660px;top:45px"></wokwi-pir-motion-sensor>
      <wokwi-buzzer id="buzzer" class="pieza" style="left:700px;top:210px"></wokwi-buzzer>
      <wokwi-led id="led" color="red" class="pieza" style="left:700px;top:330px"></wokwi-led>`,
    aviso:
      "🚨 <strong>Proyecto integrador:</strong> cuando el PIR detecta movimiento, el ESP32 enciende el buzzer y el LED. El PIR se alimenta de 5V (VIN); el LED siempre con resistencia de 330Ω.",
    tabla: `
      <tr><th>Componente</th><th>Pin</th><th>Va al ESP32</th></tr>
      <tr><td>PIR</td><td>VCC / OUT / GND</td><td>VIN / GPIO13 / GND</td></tr>
      <tr><td>Buzzer</td><td>+ / -</td><td>GPIO4 / GND</td></tr>
      <tr><td>LED</td><td>ánodo / cátodo</td><td>GPIO2 (330Ω) / GND</td></tr>`,
    animacion: `
      const pir = document.getElementById('pir'), bz = document.getElementById('buzzer'), led = document.getElementById('led');
      let on = false;
      setInterval(() => {
        on = !on;
        if (pir) pir.style.filter = on ? 'drop-shadow(0 0 12px #27ae60)' : 'none';
        if (bz) bz.hasSignal = on;
        if (led) led.value = on;
      }, 900);`,
  },

  "semaforo": {
    titulo: "🚦 Semáforo",
    sub: "ESP32 + 3 LEDs (rojo, amarillo, verde) — el clásico, con la secuencia real",
    alto: 460,
    escena: `
      <svg class="cables" viewBox="0 0 980 460" preserveAspectRatio="none">
        <path d="M250,120 C420,120 450,100 720,100" stroke="#e74c3c" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,200 C420,200 450,220 720,220" stroke="#f1c40f" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M250,280 C420,280 450,340 720,340" stroke="#27ae60" stroke-width="4" fill="none" stroke-linecap="round"/>
        <text class="et" x="300" y="92">🔴 LED rojo → GPIO13</text>
        <text class="et" x="300" y="214">🟡 LED amarillo → GPIO12</text>
        <text class="et" x="300" y="334">🟢 LED verde → GPIO14</text>
      </svg>
      <wokwi-esp32-devkit-v1 class="pieza" style="left:20px;top:60px"></wokwi-esp32-devkit-v1>
      <wokwi-led id="rojo" color="red" class="pieza" style="left:720px;top:70px"></wokwi-led>
      <wokwi-led id="amarillo" color="yellow" class="pieza" style="left:720px;top:190px"></wokwi-led>
      <wokwi-led id="verde" color="green" class="pieza" style="left:720px;top:310px"></wokwi-led>`,
    aviso:
      "🚦 <strong>Proyecto integrador:</strong> tres LEDs, cada uno a su pin, cada uno con su resistencia de 330Ω. El código enciende uno por vez siguiendo la secuencia del semáforo (rojo → verde → amarillo → rojo).",
    tabla: `
      <tr><th>LED</th><th>Pin</th><th>Resistencia</th></tr>
      <tr><td>🔴 Rojo</td><td>GPIO13</td><td>330Ω</td></tr>
      <tr><td>🟡 Amarillo</td><td>GPIO12</td><td>330Ω</td></tr>
      <tr><td>🟢 Verde</td><td>GPIO14</td><td>330Ω</td></tr>`,
    animacion: `
      const r = document.getElementById('rojo'), a = document.getElementById('amarillo'), v = document.getElementById('verde');
      const sec = [[1,0,0],[0,0,1],[0,1,0]]; // rojo / verde / amarillo
      let i = 0;
      setInterval(() => {
        const s = sec[i % sec.length];
        if (r) r.value = !!s[0];
        if (a) a.value = !!s[1];
        if (v) v.value = !!s[2];
        i++;
      }, 1200);`,
  },
}

// ============================================================================
// ARMADOR LIBRE — motor determinista de circuitos con combinación libre.
// El modelo de IA NO calcula nada: solo nombra componentes. El código arma todo.
// ============================================================================

const CABLE = {
  rojo: "#e74c3c",
  marron: "#5d4037",
  naranja: "#f39c12",
  verde: "#27ae60",
  azul: "#2980b9",
  violeta: "#9b59b6",
  amarillo: "#f1c40f",
} as const

const PUNTO: Record<string, string> = {
  [CABLE.rojo]: "🔴",
  [CABLE.marron]: "🟤",
  [CABLE.naranja]: "🟡",
  [CABLE.verde]: "🟢",
  [CABLE.azul]: "🔵",
  [CABLE.violeta]: "🟣",
  [CABLE.amarillo]: "🟡",
}

type ClasePin = "digital" | "analogico" | "fijo"

interface Pin {
  nombre: string
  color: string
  clase: ClasePin
  rol: string
  destino?: string
}

interface Componente {
  tag: string
  etiqueta: string
  voltaje: "3.3V" | "5V"
  interactivo?: boolean
  attrs?: (i: number) => string
  pines: Pin[]
  advertencia: string | null
  anim: (id: string) => string
}

const COMPONENTES: Record<string, Componente> = {
  led: {
    tag: "wokwi-led",
    etiqueta: "LED",
    voltaje: "3.3V",
    attrs: (i) => `color="${["red", "green", "yellow", "blue"][i % 4]}"`,
    pines: [
      { nombre: "Ánodo (+)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0} (con 330Ω)" },
      { nombre: "Cátodo (−)", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "cada LED siempre con su resistencia de 330Ω en serie (por los 3.3V del ESP32).",
    anim: (id) => `const e=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(e)e.value=on;},600);`,
  },

  servo: {
    tag: "wokwi-servo",
    etiqueta: "Servo SG90",
    voltaje: "5V",
    pines: [
      { nombre: "Alimentación", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "Señal (PWM)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
      { nombre: "Tierra", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el servo necesita 5V: cable rojo a VIN, nunca a 3.3V.",
    anim: (id) => `const s=document.getElementById('${id}');let a=0,d=1;setInterval(()=>{a+=d*3;if(a>=180||a<=0)d*=-1;if(s)s.hornAngle=a;},30);`,
  },

  potenciometro: {
    tag: "wokwi-potentiometer",
    etiqueta: "Potenciómetro",
    voltaje: "3.3V",
    interactivo: true,
    pines: [
      { nombre: "Extremo 1", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "Cursor", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
      { nombre: "Extremo 2", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el potenciómetro usa una entrada analógica. Usá GPIO34 o GPIO35 (solo-entrada, ideales para ADC). GPIO32/33 también sirven.",
    anim: (id) => `const p=document.getElementById('${id}');if(p){p.percent=p.percent??0;p.addEventListener('input',()=>{const v=Math.round(p.percent??0);document.title='Potenciometro: '+v+'%';});}`,
  },

  buzzer: {
    tag: "wokwi-buzzer",
    etiqueta: "Buzzer",
    voltaje: "3.3V",
    pines: [
      { nombre: "Positivo (+)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
      { nombre: "Negativo (−)", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el buzzer tiene polaridad: la pata larga (+) al pin, la corta (−) a GND.",
    anim: (id) => `const b=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(b)b.hasSignal=on;},400);`,
  },

  ultrasonico: {
    tag: "wokwi-hc-sr04",
    etiqueta: "HC-SR04",
    voltaje: "5V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "TRIG", color: CABLE.verde, clase: "digital", rol: "GPIO{0}" },
      { nombre: "ECHO", color: CABLE.azul, clase: "digital", rol: "GPIO{1} (¡con divisor!)" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el HC-SR04 va a 5V (VIN); el pin ECHO entrega 5V — si lo conectás directo al ESP32 lo dañás. Divisor: R1=1kΩ entre ECHO y el GPIO, R2=2kΩ entre el GPIO y GND.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.1;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  dht22: {
    tag: "wokwi-dht22",
    etiqueta: "DHT22",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "DATA", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el DHT22 funciona a 3.3V; conviene un pull-up de 10kΩ entre DATA y VCC.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.08;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  pir: {
    tag: "wokwi-pir-motion-sensor",
    etiqueta: "Sensor PIR",
    voltaje: "5V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "OUT", color: CABLE.verde, clase: "digital", rol: "GPIO{0}" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el PIR se alimenta de 5V (VIN). ¡OJO! Muchos módulos PIR dan 5V en la salida OUT: verificá el tuyo antes de conectarlo directo al ESP32 (tolera máx 3.6V). Si da 5V, usá un divisor de tensión como el HC-SR04.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 12px #27ae60)':'none';},800);`,
  },

  lcd: {
    tag: "wokwi-lcd1602",
    etiqueta: "LCD I2C",
    voltaje: "5V",
    attrs: () => `text="Hola Profe Bot!" backlight`,
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", rol: "GPIO21", destino: "GPIO21" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", rol: "GPIO22", destino: "GPIO22" },
    ],
    advertencia: "el LCD por I2C usa SDA=GPIO21 y SCL=GPIO22 (fijos en el ESP32).",
    anim: (id) => `const l=document.getElementById('${id}');const m=["Hola Profe Bot!","Escuela tecnica","Arduino + ESP32"];let i=0;setInterval(()=>{i=(i+1)%m.length;if(l)l.text=m[i];},1800);`,
  },

  boton: {
    tag: "wokwi-pushbutton",
    etiqueta: "Botón",
    voltaje: "3.3V",
    interactivo: true,
    attrs: () => `color="green"`,
    pines: [
      { nombre: "Una pata", color: CABLE.verde, clase: "digital", rol: "GPIO{0} (INPUT_PULLUP)" },
      { nombre: "Otra pata", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el botón usa INPUT_PULLUP: sin apretar lee HIGH, al apretar LOW. La conexión es GPIO + GND, nunca a 3.3V con esta config.",
    anim: (id) => `const b=document.getElementById('${id}');if(b)b.addEventListener('button-press',()=>{});`,
  },
}

const ALIAS: Record<string, string> = {
  pot: "potenciometro", potenciometro: "potenciometro", potentiometer: "potenciometro",
  ultrasonido: "ultrasonico", ultrasonico: "ultrasonico", "hc-sr04": "ultrasonico", hcsr04: "ultrasonico", hc_sr04: "ultrasonico",
  movimiento: "pir", pir: "pir",
  temperatura: "dht22", dht: "dht22", dht22: "dht22", dht11: "dht22",
  pantalla: "lcd", display: "lcd", lcd: "lcd", lcd1602: "lcd",
  boton: "boton", pulsador: "boton", button: "boton", pushbutton: "boton",
  led: "led", servo: "servo", buzzer: "buzzer", zumbador: "buzzer",
}

function normalizarTipo(t: string): string {
  const k = t.trim().toLowerCase()
  return ALIAS[k] ?? k
}

// ---- Constantes de layout (calibradas con los presets validados) ----
const LIENZO_W = 980
const X_ESP = 250
const X_COMP = 660
const X_COMP_ANCHO = 560
const ENTRADA = 30
const MARGEN_SUP = 95     // FIX visual: aire arriba para que el 1er componente no toque el título
const MARGEN_INF = 70
const SEP_PIN = 20

// FIX auditoría #1/#3/#10: GPIO seguros primero. Sin 12 (strapping peligroso),
// sin 16/17 (PSRAM). GPIO2 (LED onboard + strapping) y 15 al final, bajo riesgo.
const POOL_DIGITAL = [4, 5, 18, 19, 23, 25, 26, 27, 33, 13, 14, 15, 2]
const POOL_ANALOGICO = [34, 35, 36, 39, 32, 33]

interface Pedido {
  tipo: string
  gpio?: number
}

interface ResultadoArmado {
  escena: string
  tabla: string
  aviso: string
  alto: number
  animacion: string
  interactivo: boolean
}

// FIX auditoría #1: g >= 0 evita imprimir "GPIO-1" cuando se agota el pool.
function rellenarRol(rol: string, gpios: number[]): string {
  return rol.replace(/\{(\d+)\}/g, (_, i) => {
    const g = gpios[Number(i)]
    return g != null && g >= 0 ? String(g) : "GPIO?"
  })
}

function asignarGpios(pedidos: Pedido[]): { gpios: number[][]; avisos: string[] } {
  const usados = new Set<number>()
  const avisos: string[] = []
  const poolDig = [...POOL_DIGITAL]
  const poolAna = [...POOL_ANALOGICO]
  const resultado: number[][] = []

  // FIX auditoría #7: sembrar los GPIO fijos (I2C del LCD) en 'usados'.
  for (const ped of pedidos) {
    const def = COMPONENTES[normalizarTipo(ped.tipo)]
    if (!def) continue
    for (const pin of def.pines) {
      if (pin.clase === "fijo" && pin.destino) {
        const m = pin.destino.match(/GPIO(\d+)/)
        if (m) usados.add(parseInt(m[1], 10))
      }
    }
  }

  const sacar = (pool: number[]): number | null => {
    while (pool.length) {
      const g = pool.shift()!
      if (!usados.has(g)) return g
    }
    return null
  }

  for (const ped of pedidos) {
    const def = COMPONENTES[normalizarTipo(ped.tipo)]
    const asignados: number[] = []
    const pinesGpio = def.pines.filter((p) => p.clase !== "fijo")

    pinesGpio.forEach((pin, idx) => {
      // FIX auditoría #3: gpio manual del alumno para el primer pin digital O analógico
      if (idx === 0 && pin.clase !== "fijo" && ped.gpio != null) {
        if (!usados.has(ped.gpio)) {
          usados.add(ped.gpio)
          asignados.push(ped.gpio)
          return
        }
        avisos.push(`No pude usar GPIO${ped.gpio} para ${def.etiqueta} (ya ocupado): le asigné otro.`)
      }
      const g = pin.clase === "analogico" ? sacar(poolAna) : sacar(poolDig)
      if (g == null) {
        avisos.push(`No quedan GPIO ${pin.clase} libres para ${def.etiqueta}: revisalo a mano.`)
        asignados.push(-1)
        return
      }
      usados.add(g)
      asignados.push(g)
    })

    resultado.push(asignados)
  }

  return { gpios: resultado, avisos }
}

function pathCable(x0: number, y0: number, x1: number, y1: number): string {
  const dx = x1 - x0
  const c1x = x0 + dx * 0.45
  const c2x = x0 + dx * 0.62
  return `M${x0},${y0} C${c1x.toFixed(0)},${y0} ${c2x.toFixed(0)},${y1} ${x1},${y1}`
}

// FIX auditoría #2: armarPuente devuelve también el id del actuador gobernado,
// para NO ejecutar su animación autónoma (que pelearía con el puente).
function armarPuente(pedidos: Pedido[]): { js: string; idActuador: string } | null {
  const idx = (pred: (t: string) => boolean): number =>
    pedidos.findIndex((p) => pred(normalizarTipo(p.tipo)))

  const iInter = idx((t) => COMPONENTES[t]?.interactivo === true)
  const iAct = idx((t) => t === "led" || t === "servo" || t === "buzzer")
  if (iInter < 0 || iAct < 0) return null

  const tInter = normalizarTipo(pedidos[iInter].tipo)
  const tAct = normalizarTipo(pedidos[iAct].tipo)
  const idInter = `${tInter}${iInter}`
  const idAct = `${tAct}${iAct}`

  let js = ""
  if (tInter === "potenciometro") {
    if (tAct === "led")
      js = `(() => { const p=document.getElementById('${idInter}'),a=document.getElementById('${idAct}'); if(!p||!a)return; const f=()=>{const v=p.percent??0;a.brightness=v/100;a.value=v>2;}; p.addEventListener('input',f); f(); })();`
    else if (tAct === "servo")
      js = `(() => { const p=document.getElementById('${idInter}'),s=document.getElementById('${idAct}'); if(!p||!s)return; const f=()=>{s.hornAngle=Math.round((p.percent??0)*1.8);}; p.addEventListener('input',f); f(); })();`
    else if (tAct === "buzzer")
      js = `(() => { const p=document.getElementById('${idInter}'),b=document.getElementById('${idAct}'); if(!p||!b)return; const f=()=>{b.hasSignal=(p.percent??0)>50;}; p.addEventListener('input',f); f(); })();`
  } else if (tInter === "boton") {
    const onP = tAct === "servo" ? "a.hornAngle=180" : tAct === "buzzer" ? "a.hasSignal=true" : "a.value=true"
    const onR = tAct === "servo" ? "a.hornAngle=0" : tAct === "buzzer" ? "a.hasSignal=false" : "a.value=false"
    js = `(() => { const btn=document.getElementById('${idInter}'),a=document.getElementById('${idAct}'); if(!btn||!a)return; btn.addEventListener('button-press',()=>{${onP};}); btn.addEventListener('button-release',()=>{${onR};}); })();`
  }
  if (!js) return null
  return { js, idActuador: idAct }
}

// Escala visual por tipo de pieza para que ninguna quede gigante ni minúscula.
const ESCALA: Record<string, number> = {
  led: 1.3, servo: 1.0, potenciometro: 1.15, buzzer: 1.3, ultrasonico: 1.0,
  dht22: 1.2, pir: 1.0, lcd: 0.9, boton: 1.3,
}

// LAYOUT POR FILAS (robusto): ESP32 fija a la izquierda + una fila por componente.
// Sin coordenadas globales en SVG estirado → las piezas y sus conexiones NUNCA se desalinean.
function armarCircuito(pedidos: Pedido[]): ResultadoArmado {
  const { gpios: gpiosPorComp, avisos: avisosGpio } = asignarGpios(pedidos)
  const puente = armarPuente(pedidos)
  const gobernado = puente ? puente.idActuador : null

  const filas: string[] = []
  const filasTabla: string[] = []
  const anims: string[] = []
  const advertencias = new Set<string>()
  let hay5V = false
  let interactivo = false

  pedidos.forEach((ped, i) => {
    const tipo = normalizarTipo(ped.tipo)
    const def = COMPONENTES[tipo]
    const id = `${tipo}${i}`
    const gpios = gpiosPorComp[i]

    if (def.voltaje === "5V") hay5V = true
    if (def.interactivo) interactivo = true
    if (def.advertencia) advertencias.add(def.advertencia)

    // columna de conexiones (una línea por pin, con su dot de color)
    const conex = def.pines
      .map((pin) => {
        const destino = pin.clase === "fijo" ? pin.destino! : rellenarRol(pin.rol, gpios)
        return `          <div class="pin"><span class="dot" style="background:${pin.color}"></span>${pin.nombre} → ${destino}</div>`
      })
      .join("\n")

    // la pieza Wokwi, con su escala propia
    const escala = ESCALA[tipo] ?? 1.0
    const attrs = def.attrs ? def.attrs(i) : ""
    const pieza = `<${def.tag} id="${id}" ${attrs} style="transform:scale(${escala});transform-origin:left center"></${def.tag}>`

    filas.push(
      `      <div class="fila">
        <div class="conex">
${conex}
        </div>
        <div class="pieza-cell">${pieza}</div>
      </div>`,
    )

    // fila de la tabla resumen
    const resumen = def.pines
      .map((pin) => (pin.clase === "fijo" ? pin.destino! : rellenarRol(pin.rol, gpios)))
      .join(" · ")
    const dots = def.pines
      .map((pin) => `<span class="dot" style="background:${pin.color}"></span>`)
      .join("")
    filasTabla.push(`      <tr><td>${def.etiqueta}</td><td>${dots}</td><td>${resumen}</td></tr>`)

    if (id !== gobernado) {
      anims.push(`(() => { ${def.anim(id)} })();`)
    }
  })

  if (puente) anims.push(puente.js)

  // escena = grid [ESP32 | columna de filas]
  const escena = `
      <div class="circuito-libre">
        <div class="esp-col"><wokwi-esp32-devkit-v1 style="transform:scale(1.25);transform-origin:center"></wokwi-esp32-devkit-v1></div>
        <div class="filas-libre">
${filas.join("\n")}
        </div>
      </div>`

  const cabecera = interactivo
    ? "✋ <strong>¡Probalo con el mouse!</strong> "
    : "💡 <strong>Atención:</strong> "
  if (hay5V) advertencias.add("los componentes de 5V (servo, PIR, HC-SR04, LCD) van a VIN, NO a 3.3V.")
  avisosGpio.forEach((a) => advertencias.add(a))
  const aviso = cabecera + Array.from(advertencias).map((f) => "• " + f).join(" ")

  const tabla = `
      <tr><th>Componente</th><th>Cables</th><th>Conexiones al ESP32</th></tr>
${filasTabla.join("\n")}`

  // alto: no se usa para layout (las filas crecen solas), pero lo dejamos por compatibilidad
  return { escena, tabla, aviso, alto: 0, animacion: anims.join("\n"), interactivo }
}

function parsearComponentes(raw: string): Pedido[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const [tipo, g] = tok.split(":").map((x) => x.trim())
      const gpio = g != null && /^\d+$/.test(g) ? parseInt(g, 10) : undefined
      return { tipo: normalizarTipo(tipo), gpio }
    })
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
  <h1>${p.titulo} <span class="badge">${p.interactivo ? "✋ interactivo" : "▶ animado"}</span></h1>
  <div class="sub">Esquema de conexión — Profe Bot · piezas reales, ${p.sub}</div>
  <div class="escena" style="height:${p.alto ?? 300}px">${p.escena}</div>
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

Componentes sueltos: servo-esp32, led-esp32, ultrasonico-esp32, buzzer-esp32, dht22-esp32, pir-esp32, lcd-esp32.
INTERACTIVOS (el alumno controla con el mouse): potenciometro-esp32 (girá la perilla y cambia el brillo del LED), boton-esp32 (apretá el botón y se prende el LED).
Proyectos integradores (varios componentes): estacion-meteo (DHT22+LCD), alarma (PIR+buzzer+LED), semaforo (3 LEDs).

ARMADOR LIBRE (combinaciones libres): si el pedido NO coincide con un preset (ej "ESP32 + 2 LEDs + potenciómetro + servo"), usá el arg 'componentes' con la lista separada por comas. Tipos: led, servo, potenciometro, buzzer, ultrasonico, dht22, pir, lcd, boton. GPIO opcional con dos puntos: "led:2, led:4". El motor asigna pines, dibuja cables y combina animaciones solo. De 1 a 6 componentes.`,
  args: {
    circuito: tool.schema
      .enum(["servo-esp32", "led-esp32", "ultrasonico-esp32", "buzzer-esp32", "potenciometro-esp32", "dht22-esp32", "pir-esp32", "lcd-esp32", "boton-esp32", "estacion-meteo", "alarma", "semaforo"])
      .optional()
      .describe("Preset validado. Usalo si el pedido coincide con uno de la lista. Para combinaciones libres usá 'componentes'."),
    componentes: tool.schema
      .string()
      .optional()
      .describe("ARMADOR LIBRE: lista de componentes separada por comas, ej 'led, led, potenciometro, servo'. Tipos: led, servo, potenciometro, buzzer, ultrasonico, dht22, pir, lcd, boton. GPIO opcional con dos puntos: 'led:2, led:4'. El motor calcula posiciones y cables solo."),
    nombre_archivo: tool.schema
      .string()
      .optional()
      .describe("Nombre del archivo HTML (sin extensión). Por defecto usa el nombre del circuito."),
  },
  async execute(args, ctx) {
    const bundle = bundlePath()
    if (!existsSync(bundle)) {
      return "No encontré la biblioteca de piezas (wokwi-bundle.js). Reinstalá Profe Bot con el instalador para que copie la biblioteca visual."
    }
    const scriptSrc = `file://${bundle}`

    let plantilla: Plantilla
    let base: string

    if (args.componentes && args.componentes.trim()) {
      const pedidos = parsearComponentes(args.componentes)
      if (pedidos.length < 1 || pedidos.length > 6) {
        return "El armador libre maneja de 1 a 6 componentes. Si son más, dividilo en dos circuitos."
      }
      const desconocidos = pedidos.filter((p) => !COMPONENTES[normalizarTipo(p.tipo)])
      if (desconocidos.length) {
        return `No conozco: ${desconocidos.map((d) => d.tipo).join(", ")}. Tengo: ${Object.keys(COMPONENTES).join(", ")}.`
      }
      const r = armarCircuito(pedidos)
      const nombres = pedidos.map((p) => COMPONENTES[normalizarTipo(p.tipo)].etiqueta).join(" + ")
      plantilla = {
        titulo: `🔧 ${nombres} + ESP32`,
        sub: "armado libre — piezas reales conectadas al ESP32",
        escena: r.escena,
        aviso: r.aviso,
        tabla: r.tabla,
        animacion: r.animacion,
        alto: r.alto,
        interactivo: r.interactivo,
      }
      base = args.nombre_archivo ?? `circuito-armado-${pedidos.map((p) => normalizarTipo(p.tipo)).join("-")}`
    } else if (args.circuito) {
      const preset = PLANTILLAS[args.circuito]
      if (!preset) {
        return `No tengo ese circuito todavía. Disponibles: ${Object.keys(PLANTILLAS).join(", ")}.`
      }
      plantilla = preset
      base = args.nombre_archivo ?? `circuito-${args.circuito}`
    } else {
      return "Decime qué circuito armar: un preset (arg 'circuito') o una lista libre (arg 'componentes', ej 'led, servo')."
    }

    const html = construirHTML(plantilla, scriptSrc)

    const archivo = join(ctx.directory, `${base}.html`)
    await Bun.write(archivo, html)

    return `Listo! Generé el circuito visual y animado.

**Abrilo en tu navegador (doble clic o pegá esto):**
file://${archivo}

Vas a ver las piezas reales conectadas con cables de colores, y la animación funcionando. Todo sin internet.`
  },
})
