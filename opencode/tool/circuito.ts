/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { existsSync, readFileSync, statSync } from "node:fs"

/**
 * La ruta del archivo como URL `file://` bien formada.
 *
 * EN WINDOWS LA RUTA CRUDA NO ES UNA URL. `C:\\Users\\Maria Jose\\hoja.html`
 * interpolado en `file://` da `file://C:\\Users\\Maria Jose\\hoja.html`: barras
 * invertidas, falta la tercera barra, y el espacio sin escapar. Pegado en el
 * navegador no abre nada — y esto aparece justo cuando el auto-open ya falló,
 * o sea en el peor momento posible.
 *
 * Está duplicada en ficha.ts, imprimible.ts, ayuda.ts y circuito.ts: los tools
 * de OpenCode no se importan entre sí (ninguno lo hace hoy) y no hay carpeta
 * para código compartido. Cuatro copias de seis líneas es más barato que
 * inventar una capa de infraestructura para esto.
 */
export function comoUrl(archivo: string): string {
  const barras = archivo.replace(/\\/g, "/")
  return "file://" + (barras.startsWith("/") ? "" : "/") + encodeURI(barras).replace(/#/g, "%23")
}

// Ruta del bundle de piezas Wokwi Elements (se instala con Tecnia Bot).
function bundlePath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecniabot-web", "wokwi-bundle.js")
}

// Componentes dibujados por nosotros (pb-relay, pb-bomba, etc.) que no existen en Wokwi.
function extraPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecniabot-web", "componentes-extra.js")
}

// Plantillas HTML pre-armadas y validadas (ej: circuito montado sobre protoboard).
function plantillaPath(nombre: string): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecniabot-web", nombre)
}

// Abre el HTML generado en el navegador por defecto del sistema, sin bloquear la
// tool (proceso detached, best-effort). Pensado para el docente NO técnico: no
// tiene que buscar el archivo ni hacer doble clic — se le abre solo.
// Devuelve true si lo lanzó sin excepción, false si falló (nunca rompe la tool).
function abrirEnNavegador(archivo: string): boolean {
  try {
    // Windows: `start "" "<archivo>"` — el "" es el título vacío de start (si no,
    // start toma la ruta entre comillas como título y no abre nada). El archivo va
    // como elemento del array: Bun lo quotea solo aunque tenga espacios (Tecnia Bot\...).
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

// CSS común a todos los circuitos.
const ESTILO = `
  /* Design system Tecnia Lab — marca violeta. Solo colores/tipografia/acentos: el layout no se toca. */
  :root {
    --violeta:#6d28d9; --violeta-2:#7c3aed; --violeta-soft:#f4f1fe; --violeta-line:#e3dcfb;
    --ink:#1e293b; --muted:#64748b; --line:#e8ecf2;
  }
  body { font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; background:#eef2f5; margin:0; padding:24px; color:var(--ink); }
  /* firma de marca: barra violeta arriba de la hoja */
  .hoja { position:relative; overflow:hidden; max-width:960px; margin:0 auto; background:#fff; border-radius:16px; box-shadow:0 6px 28px rgba(0,0,0,.10); padding:28px 34px; }
  .hoja::before { content:""; position:absolute; top:0; left:0; right:0; height:5px; background:linear-gradient(90deg,var(--violeta),var(--violeta-2)); }
  h1 { font-size:23px; margin:0 0 2px; color:var(--ink); font-weight:800; }
  .sub { color:var(--muted); font-size:14px; margin-bottom:18px; }
  .escena { position:relative; height:300px; margin:6px 0 14px; background:linear-gradient(180deg,#faf9fe,#f2f0fb); border:1px solid var(--violeta-line); border-radius:12px; }
  .pieza { position:absolute; transform:scale(1.4); transform-origin:top left; }
  .izq { left:30px; top:40px; }
  .der { left:660px; top:80px; }
  svg.cables { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5; }
  .et { font:600 12px 'Segoe UI'; fill:#2c3e50; }
  .aviso { background:var(--violeta-soft); border-left:4px solid var(--violeta); padding:11px 15px; border-radius:8px; font-size:14px; margin:16px 0; }
  .aviso b { color:var(--violeta); }
  .badge { display:inline-block; background:var(--violeta-soft); color:var(--violeta); border:1px solid var(--violeta-line); font-size:12px; padding:3px 10px; border-radius:20px; margin-left:8px; }
  table { width:100%; border-collapse:collapse; margin-top:14px; font-size:14px; }
  th,td { text-align:left; padding:9px 11px; border-bottom:1px solid var(--line); }
  th { background:var(--violeta-soft); color:var(--violeta); text-transform:uppercase; font-size:11.5px; letter-spacing:.4px; font-weight:700; }
  .dot{display:inline-block;width:13px;height:13px;border-radius:50%;margin-right:7px;vertical-align:middle;border:1px solid rgba(0,0,0,.15);}
  /* layout del ARMADOR LIBRE: ESP32 a la izquierda + una fila por componente, con cables CSS */
  .circuito-libre{display:grid;grid-template-columns:230px 1fr;gap:0;align-items:center;margin:10px 0 6px;}
  .esp-col{display:flex;justify-content:center;align-items:center;}
  /* bus vertical UNICO (no por fila): un carril continuo del que "nacen" los cables */
  .filas-libre{display:flex;flex-direction:column;position:relative;}
  .filas-libre::before{content:"";position:absolute;left:6px;top:0;bottom:0;width:6px;border-radius:3px;background:linear-gradient(#cbd2d9,#aeb6bd);}
  /* fila: [carril bus 22px] [conexiones+cables, elastico] [pieza, ancho segun contenido] */
  .fila{display:grid;grid-template-columns:22px minmax(0,1fr) max-content;align-items:center;gap:0;padding:10px 0;border-bottom:1px dashed #eef0f2;}
  .fila:last-child{border-bottom:none;}
  /* conexiones: una linea flex por pin = nodo + etiqueta en cajita + cable que crece */
  .conex{display:flex;flex-direction:column;justify-content:center;gap:9px;padding:4px 0;}
  .conex .pin{display:flex;align-items:center;min-width:0;--c:#607d8b;}
  .conex .nodo{flex:0 0 auto;width:12px;height:12px;border-radius:50%;background:var(--c);margin-right:8px;}
  .conex .label{flex:0 0 auto;display:inline-flex;flex-direction:column;line-height:1.15;background:#fff;border:1px solid #eef0f2;border-radius:6px;padding:3px 9px;}
  .conex .label .nom{font:600 12.5px 'Segoe UI',system-ui,sans-serif;color:#2c3e50;}
  .conex .label .gpio{font:500 11px 'Segoe UI',system-ui,sans-serif;color:#7a8794;}
  /* el cable: SIN coordenadas, crece con flex hasta la pieza. Imposible desalinear. */
  .conex .cable{flex:1 1 auto;min-width:14px;height:4px;border-radius:99px;background:var(--c);margin-left:6px;}
  /* resistencia en serie DIBUJADA en el medio del cable: cuerpo beige (como la real),
     el cable de color entra y sale de ella → se ve la SERIE. Sin bandas de colores
     (dibujar bandas incorrectas mentiria: un docente podria leerlas). */
  .conex .res{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;height:16px;padding:0 7px;margin-left:6px;background:linear-gradient(180deg,#f0ddb6,#e2c78d);border:1px solid #bda269;border-radius:4px;font:600 9.5px 'Segoe UI',system-ui,sans-serif;color:#5a481f;letter-spacing:.2px;white-space:nowrap;box-shadow:0 1px 1.5px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.45);}
  .pieza-cell{display:flex;align-items:center;min-height:80px;justify-content:flex-start;padding-left:4px;}
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

type ClasePin = "digital" | "analogico" | "fijo"

interface Pin {
  nombre: string
  color: string
  clase: ClasePin
  rol: string
  destino?: string
  /**
   * Cuántos GPIO consume ESTA fila de la tabla. Default 1.
   *
   * FIX auditoría B6 (pines fantasma): el display de 7 segmentos y el teclado 4x4
   * declaran UNA fila ("Segmentos A-G", "Filas R1-R4") que en la placa real son
   * varios pines. Antes el rol no tenía placeholder, así que el pin se consumía
   * del pool igual pero NO se imprimía: pedías "7segmentos, led, led" y el display
   * se comía GPIO4 sin figurar en ningún lado, mientras el primer LED arrancaba en
   * GPIO5. La docente contaba los pines del dibujo y le faltaba uno — el peor tipo
   * de error, porque el dibujo se ve perfecto.
   */
  cantidad?: number
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
    // FIX auditoría B10/B9: el ciclo era ["red","green","yellow","blue"] y el 4º LED
    // de CUALQUIER circuito salía AZUL. skills/esp32/SKILL.md es taxativo: un LED que
    // cae 3 V o más (azul, blanco) sobre 3,3 V "no hay con qué hacerlo andar decente,
    // y no es un problema de elegir mejor la resistencia: no queda tensión". O sea que
    // dibujábamos un circuito IMPOSIBLE de armar, y el alumno lo iba a intentar igual.
    // Ahora el ciclo es rojo → amarillo → verde: son los tres colores de LED comunes de
    // 5 mm que SÍ andan a 3,3 V con 220 Ω (el verde común es GaP, ~2,1 V; el verde
    // InGaN del SKILL es otra pieza, la de alto brillo), y de paso es el orden del
    // semáforo, que es el proyecto de 3 LEDs que más se pide.
    attrs: (i) => `color="${["red", "yellow", "green"][i % 3]}"`,
    pines: [
      { nombre: "Ánodo (+)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0} (con 220Ω)" },
      { nombre: "Cátodo (−)", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "cada LED siempre con su resistencia de 220Ω en serie: es el valor para los 3.3V del ESP32 (los 330 ohm son la regla del UNO a 5V; acá un LED azul o blanco casi no prende con esos).",
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
    anim: (id) => `const s=document.getElementById('${id}');let a=0,d=1;setInterval(()=>{a+=d*3;if(a>=180||a<=0)d*=-1;if(s)s.angle=a;},30);`,
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
    anim: (id) => `const p=document.getElementById('${id}');if(p){p.addEventListener('input',()=>{const v=Math.round(((p.value??0)/1023)*100);document.title='Potenciometro: '+v+'%';});}`,
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
    advertencia: "el DHT22 funciona a 3.3V. Módulo de 3 pines (plaqueta): ya trae el pull-up, no agregues nada. Sensor pelado de 4 patas: 10kΩ entre DATA y VCC.",
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
    advertencia: "el PIR se alimenta de 5V (VIN), pero OUT = 3.3V en el HC-SR501 (trae regulador a bordo): va directo al GPIO, sin divisor. Sólo módulos mini sin regulador pueden dar 5V en OUT: si el tuyo no es un HC-SR501, medí OUT con el téster antes de conectarlo (el ESP32 tolera máx 3.6V).",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 12px #27ae60)':'none';},800);`,
  },

  lcd: {
    tag: "wokwi-lcd1602",
    etiqueta: "LCD I2C",
    voltaje: "5V",
    attrs: () => `text="Hola Tecnia Bot!" backlight`,
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", rol: "GPIO21", destino: "GPIO21" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", rol: "GPIO22", destino: "GPIO22" },
    ],
    advertencia: "el LCD por I2C usa SDA=GPIO21 y SCL=GPIO22 (fijos en el ESP32). ¡OJO con los 5V! La mochila I2C tiene sus pull-ups a su propio VCC: alimentada a 5V pone SDA y SCL en 5V, y GPIO21/22 NO toleran 5V. Opciones: alimentarla a 3.3V (segura, con menos contraste) o 5V + conversor de nivel bidireccional en SDA/SCL (el divisor de resistencias NO sirve: I2C es bidireccional). Nunca mochila a 5V con SDA/SCL directo al ESP32.",
    anim: (id) => `const l=document.getElementById('${id}');const m=["Hola Tecnia Bot!","Escuela tecnica","Arduino + ESP32"];let i=0;setInterval(()=>{i=(i+1)%m.length;if(l)l.text=m[i];},1800);`,
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

  "rgb-led": {
    tag: "wokwi-rgb-led",
    etiqueta: "LED RGB",
    voltaje: "3.3V",
    pines: [
      { nombre: "Rojo (R)", color: CABLE.rojo, clase: "digital", rol: "GPIO{0} (con 220Ω)" },
      { nombre: "Verde (G)", color: CABLE.verde, clase: "digital", rol: "GPIO{1} (con 220Ω)" },
      { nombre: "Azul (B)", color: CABLE.azul, clase: "digital", rol: "GPIO{2} (con 220Ω)" },
      { nombre: "Común (−)", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el LED RGB combina 3 colores. Cada pin con su resistencia de 220Ω. Con analogWrite (PWM) mezclás cualquier color.",
    anim: (id) => `const e=document.getElementById('${id}');let h=0;setInterval(()=>{h=(h+8)%360;const c=h/60,x=1-Math.abs(c%2-1);let r=0,g=0,b=0;if(c<1){r=1;g=x}else if(c<2){r=x;g=1}else if(c<3){g=1;b=x}else if(c<4){g=x;b=1}else if(c<5){r=x;b=1}else{r=1;b=x}if(e){e.ledRed=r>0.3;e.ledGreen=g>0.3;e.ledBlue=b>0.3}},120);`,
  },

  ldr: {
    tag: "wokwi-photoresistor-sensor",
    etiqueta: "Sensor de luz (LDR)",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "OUT / AO", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
    ],
    advertencia: "el LDR mide luz. Su salida va a un pin analógico (GPIO34/35). analogRead da 0-4095 en ESP32 (0=oscuro, 4095=mucha luz).",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  oled: {
    tag: "wokwi-ssd1306",
    etiqueta: "Display OLED",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", rol: "GPIO21", destino: "GPIO21" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", rol: "GPIO22", destino: "GPIO22" },
    ],
    advertencia: "el OLED SSD1306 es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x3C). Librerías: Adafruit_SSD1306 + Adafruit_GFX.",
    anim: (id) => `const o=document.getElementById('${id}');`,
  },

  "7segmentos": {
    tag: "wokwi-7segment",
    etiqueta: "Display 7 segmentos",
    voltaje: "3.3V",
    pines: [
      { nombre: "Segmentos A-G", color: CABLE.naranja, clase: "digital", rol: "{0-6} (cada segmento con 220Ω)", cantidad: 7 },
      { nombre: "Común", color: CABLE.marron, clase: "fijo", rol: "GND (cátodo común)", destino: "GND" },
    ],
    advertencia: "el display de 7 segmentos muestra un dígito. Cada segmento (A-G) va a un GPIO con su resistencia de 220Ω. Conviene la librería SevSeg para no gastar tantos pines.",
    anim: (id) => `const d=document.getElementById('${id}');const digs=[[1,1,1,1,1,1,0,0],[0,1,1,0,0,0,0,0],[1,1,0,1,1,0,1,0],[1,1,1,1,0,0,1,0],[0,1,1,0,0,1,1,0]];let i=0;setInterval(()=>{i=(i+1)%digs.length;if(d)d.values=digs[i];},800);`,
  },

  neopixel: {
    tag: "wokwi-neopixel",
    etiqueta: "NeoPixel (LED inteligente)",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "DIN (datos)", color: CABLE.verde, clase: "digital", rol: "GPIO{0}" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el NeoPixel (WS2812) es un LED RGB direccionable: con UN solo pin de datos controlás muchos en cadena. Librería: Adafruit_NeoPixel. Mejor alimentarlo de 5V.",
    anim: (id) => `const n=document.getElementById('${id}');let h=0;setInterval(()=>{h=(h+10)%360;const c=h/60,x=Math.round((1-Math.abs(c%2-1))*255);let r=0,g=0,b=0;if(c<1){r=255;g=x}else if(c<2){r=x;g=255}else if(c<3){g=255;b=x}else if(c<4){g=x;b=255}else if(c<5){r=x;b=255}else{r=255;b=x}if(n){n.r=r;n.g=g;n.b=b;}},120);`,
  },

  joystick: {
    tag: "wokwi-analog-joystick",
    etiqueta: "Joystick analógico",
    voltaje: "3.3V",
    interactivo: true,
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "VRx (eje X)", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
      { nombre: "VRy (eje Y)", color: CABLE.azul, clase: "analogico", rol: "GPIO{1} (analógico)" },
      { nombre: "SW (botón)", color: CABLE.verde, clase: "digital", rol: "GPIO{2}" },
    ],
    advertencia: "el joystick tiene 2 ejes analógicos (X, Y) que se leen con analogRead, y un botón al apretarlo. Ideal para mover algo en 2 direcciones (un robot, un juego).",
    anim: (id) => `const j=document.getElementById('${id}');`,
  },

  mpu6050: {
    tag: "wokwi-mpu6050",
    etiqueta: "Acelerómetro MPU6050",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", rol: "GPIO21", destino: "GPIO21" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", rol: "GPIO22", destino: "GPIO22" },
    ],
    advertencia: "el MPU6050 mide aceleración (3 ejes) y giro (3 ejes) — detecta inclinación, movimiento, caídas. Es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x68; si conectás AD0 a 3.3V pasa a 0x69). Librería: Adafruit_MPU6050 + Adafruit_Sensor. Proyectos: nivel digital, dron, control por gestos.",
    anim: (id) => `const m=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(m)m.style.transform='scale(1) rotate('+(Math.sin(t)*8)+'deg)';},60);`,
  },

  stepper: {
    tag: "wokwi-stepper-motor",
    etiqueta: "Motor paso a paso",
    voltaje: "5V",
    // FIX auditoría B2: estos cuatro pines eran clase:"digital", así que el asignador
    // les daba 4 GPIO reales y el dibujo salía con CUATRO CABLES del ESP32 directo a
    // las bobinas — mientras la advertencia de abajo decía "se conecta por el driver
    // ULN2003". El texto y el dibujo se contradecían, y el alumno cablea lo que VE:
    // las bobinas del 28BYJ-48 chupan ~240 mA por fase y el GPIO da 12 mA. Se quema.
    // Ahora replica el patrón del motor DC (pines "fijo" que terminan en el driver):
    // el único que manda señales al ESP32 es el driver, que ya tiene sus IN1-IN4.
    pines: [
      { nombre: "Bobinas (4 hilos)", color: CABLE.naranja, clase: "fijo", rol: "Driver ULN2003 (OUT)", destino: "Driver ULN2003 (OUT)" },
      { nombre: "Común (hilo rojo)", color: CABLE.rojo, clase: "fijo", rol: "Driver ULN2003 (5V)", destino: "Driver ULN2003 (5V)" },
    ],
    advertencia: "el motor paso a paso (28BYJ-48) gira en pasos exactos, ideal para posición precisa (impresora, reloj, persiana). NO se conecta al ESP32: su conector de 5 hilos va al driver ULN2003, y son los IN1-IN4 del driver los que van a los GPIO. El motor se alimenta de 5V desde el driver. Librería: Stepper o AccelStepper.",
    anim: (id) => `const s=document.getElementById('${id}');let a=0;setInterval(()=>{a=(a+6)%360;if(s)s.angle=a;},40);`,
  },

  teclado: {
    tag: "wokwi-membrane-keypad",
    etiqueta: "Teclado matricial 4x4",
    voltaje: "3.3V",
    pines: [
      { nombre: "Filas (R1-R4)", color: CABLE.naranja, clase: "digital", rol: "{0-3}", cantidad: 4 },
      { nombre: "Columnas (C1-C4)", color: CABLE.verde, clase: "digital", rol: "{4-7}", cantidad: 4 },
    ],
    advertencia: "el teclado 4x4 tiene 16 teclas pero usa solo 8 pines (4 filas + 4 columnas) gracias a la lectura matricial. Para ingresar claves, menús, números. Librería: Keypad.",
    anim: (id) => `const k=document.getElementById('${id}');`,
  },

  llama: {
    tag: "wokwi-flame-sensor",
    etiqueta: "Sensor de llama",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "DO (digital)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
    ],
    advertencia: "el sensor de llama detecta fuego/luz infrarroja cercana. Salida digital DO (hay fuego o no) o analógica AO (nivel). Alarma de incendio, robot bombero. Tiene un potenciómetro para ajustar la sensibilidad.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 10px #e74c3c)':'none';},700);`,
  },

  sonido: {
    tag: "wokwi-small-sound-sensor",
    etiqueta: "Sensor de sonido",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "DO (digital)", color: CABLE.verde, clase: "digital", rol: "GPIO{0}" },
    ],
    advertencia: "el sensor de sonido detecta ruido (un aplauso, un golpe). Salida digital DO (umbral ajustable con el potenciómetro). Aplauso que prende la luz, alarma de ruido.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.opacity=on?'1':'0.7';},400);`,
  },

  ntc: {
    tag: "wokwi-ntc-temperature-sensor",
    etiqueta: "Sensor de temperatura NTC",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "OUT (analógico)", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
    ],
    advertencia: "el NTC es un termistor: su resistencia cambia con la temperatura. Salida analógica (analogRead, 0-4095). Más simple que el DHT pero mide solo temperatura. Termómetro, control de ventilador.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  "ir-receptor": {
    tag: "wokwi-ir-receiver",
    etiqueta: "Receptor infrarrojo (IR)",
    voltaje: "3.3V",
    pines: [
      { nombre: "OUT (señal)", color: CABLE.amarillo, clase: "digital", rol: "GPIO{0}" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
    ],
    advertencia: "el receptor IR lee los códigos de un control remoto (TV, aire). Cada botón manda un código distinto. Librería: IRremote. Controlar el ESP32 con un control remoto común.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 8px #f1c40f)':'none';},600);`,
  },

  tilt: {
    tag: "wokwi-tilt-switch",
    etiqueta: "Sensor de inclinación",
    voltaje: "3.3V",
    pines: [
      { nombre: "Pata 1", color: CABLE.verde, clase: "digital", rol: "GPIO{0} (INPUT_PULLUP)" },
      { nombre: "Pata 2", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
    ],
    advertencia: "el sensor de inclinación (tilt) es como un interruptor que se activa al inclinarlo (una bolita adentro cierra el contacto). Detecta si algo se volcó o se movió. Usalo con INPUT_PULLUP.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.transform='scale(1) rotate('+(on?12:-12)+'deg)';},800);`,
  },

  // ============ COMPONENTES DIBUJADOS POR NOSOTROS (SVG, no existen en Wokwi) ============
  // Vienen de componentes-extra.js (tags pb-*). Cubren los proyectos del INET:
  // riego, tanques, calefacción, invernadero, lumínico, acuapónico, estación meteo.

  relay: {
    tag: "pb-relay",
    etiqueta: "Módulo Relé",
    voltaje: "5V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "VIN (5V)", destino: "VIN (5V)" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "IN (señal)", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
    ],
    advertencia:
      "el módulo relé es un interruptor que el ESP32 controla con un GPIO (pin IN). Sirve para prender/apagar cosas de POTENCIA (bomba, lámpara, motor). La bobina suele necesitar 5V (VCC a VIN). ⚡ El lado de 220V lo conecta SIEMPRE un adulto con todo apagado: nunca toques la red eléctrica con el ESP32.",
    anim: (id) => `const e=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(e)e.style.filter=on?'drop-shadow(0 0 9px #16a085)':'none';},900);`,
  },

  bomba: {
    tag: "pb-bomba",
    etiqueta: "Bomba de agua",
    voltaje: "5V",
    pines: [
      { nombre: "+ (potencia)", color: CABLE.rojo, clase: "fijo", rol: "Relé / fuente externa", destino: "Relé / fuente externa" },
      { nombre: "− (potencia)", color: CABLE.marron, clase: "fijo", rol: "GND fuente", destino: "GND fuente" },
    ],
    advertencia:
      "la bomba de agua consume mucha corriente: NO se conecta directo al ESP32 (lo quemaría). Va por un relé o un driver, con su propia fuente (5V o 12V). El ESP32 solo manda la orden al relé.",
    anim: () => ``,
  },

  valvula: {
    tag: "pb-valvula",
    etiqueta: "Electroválvula",
    voltaje: "5V",
    pines: [
      { nombre: "+ (potencia)", color: CABLE.rojo, clase: "fijo", rol: "Relé / fuente 12V", destino: "Relé / fuente 12V" },
      { nombre: "− (potencia)", color: CABLE.marron, clase: "fijo", rol: "GND fuente", destino: "GND fuente" },
    ],
    advertencia:
      "la electroválvula abre o cierra el paso de agua con electricidad. Suele ser de 12V: va por un relé con fuente externa, nunca directa al ESP32.",
    anim: () => ``,
  },

  higrometro: {
    tag: "pb-higrometro",
    etiqueta: "Higrómetro de suelo",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "AO (analógico)", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
    ],
    advertencia:
      "el higrómetro mide la humedad de la tierra. Su salida analógica AO va a un pin ADC (GPIO34/35): suelo seco da un valor, suelo húmedo otro (analogRead 0-4095). ⚠️ La sonda se corroe si queda siempre energizada: alimentala desde un GPIO y prendela solo al medir.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  lluvia: {
    tag: "pb-lluvia",
    etiqueta: "Sensor de lluvia",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "AO (analógico)", color: CABLE.violeta, clase: "analogico", rol: "GPIO{0} (analógico)" },
    ],
    advertencia:
      "el sensor de lluvia detecta gotas sobre su placa. Salida analógica AO (cuánta agua hay) o digital DO (llueve / no llueve). Funciona a 3.3V. Útil en estación meteorológica.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.07;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  bmp180: {
    tag: "pb-bmp180",
    etiqueta: "Sensor de presión BMP180",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", rol: "3.3V", destino: "3.3V" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", rol: "GND", destino: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", rol: "GPIO21", destino: "GPIO21" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", rol: "GPIO22", destino: "GPIO22" },
    ],
    advertencia:
      "el BMP180 mide presión atmosférica y temperatura. Es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x77). Sirve para estación meteorológica y como altímetro. Librería: Adafruit_BMP085.",
    anim: () => ``,
  },

  motor: {
    tag: "pb-motor",
    etiqueta: "Motor DC",
    voltaje: "5V",
    pines: [
      { nombre: "+ (vía driver)", color: CABLE.rojo, clase: "fijo", rol: "Driver (L298N/ULN2003)", destino: "Driver (L298N/ULN2003)" },
      { nombre: "− (vía driver)", color: CABLE.marron, clase: "fijo", rol: "Driver", destino: "Driver" },
    ],
    advertencia:
      "el motor DC NO se conecta directo al ESP32 (lo quemaría por la corriente). Va por un driver (L298N, ULN2003) que recibe la señal del GPIO y le da potencia desde una fuente externa.",
    anim: () => ``,
  },

  driver: {
    tag: "pb-driver",
    etiqueta: "Driver ULN2003",
    voltaje: "5V",
    pines: [
      { nombre: "IN1", color: CABLE.naranja, clase: "digital", rol: "GPIO{0}" },
      { nombre: "IN2", color: CABLE.amarillo, clase: "digital", rol: "GPIO{1}" },
      { nombre: "IN3", color: CABLE.verde, clase: "digital", rol: "GPIO{2}" },
      { nombre: "IN4", color: CABLE.azul, clase: "digital", rol: "GPIO{3}" },
    ],
    advertencia:
      "el driver ULN2003 amplifica las señales del ESP32 para mover lo que el GPIO no puede solo (motores DC, paso a paso, relés). IN1-IN4 van a GPIOs; la potencia sale a 5V desde su fuente.",
    anim: (id) => `const e=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(e)e.style.filter=on?'drop-shadow(0 0 8px #27ae60)':'none';},700);`,
  },

  lampara: {
    tag: "pb-lampara",
    etiqueta: "Lámpara 220V",
    voltaje: "5V",
    attrs: () => `encendido`,
    pines: [
      { nombre: "Fase (vía relé)", color: CABLE.rojo, clase: "fijo", rol: "Relé ← Red 220V", destino: "Relé ← Red 220V" },
      { nombre: "Neutro", color: CABLE.marron, clase: "fijo", rol: "Red 220V", destino: "Red 220V" },
    ],
    advertencia:
      "⚡ PELIGRO 220V: la lámpara de red NUNCA se conecta al ESP32. El ESP32 manda un relé, y el relé conmuta los 220V. La parte de red la conecta un adulto/profesor con todo apagado.",
    anim: () => ``,
  },

  calefactor: {
    tag: "pb-calefactor",
    etiqueta: "Radiador / Calefactor",
    voltaje: "5V",
    attrs: () => `encendido`,
    pines: [
      { nombre: "Fase (vía relé)", color: CABLE.rojo, clase: "fijo", rol: "Relé ← Red 220V", destino: "Relé ← Red 220V" },
      { nombre: "Neutro", color: CABLE.marron, clase: "fijo", rol: "Red 220V", destino: "Red 220V" },
    ],
    advertencia:
      "⚡ PELIGRO 220V: el radiador eléctrico va por un relé, igual que la lámpara. El ESP32 solo controla el relé; los 220V los maneja un adulto.",
    anim: () => ``,
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
  rgb: "rgb-led", "rgb-led": "rgb-led", "led-rgb": "rgb-led", "rgbled": "rgb-led",
  ldr: "ldr", luz: "ldr", fotorresistencia: "ldr", fotorresistor: "ldr",
  oled: "oled", ssd1306: "oled", "oled-display": "oled",
  "7segmentos": "7segmentos", "7seg": "7segmentos", "7-segmentos": "7segmentos", display7: "7segmentos", "siete-segmentos": "7segmentos",
  neopixel: "neopixel", ws2812: "neopixel", "led-inteligente": "neopixel",
  joystick: "joystick", "joystick-analogico": "joystick", palanca: "joystick",
  mpu6050: "mpu6050", acelerometro: "mpu6050", giroscopio: "mpu6050", mpu: "mpu6050",
  stepper: "stepper", "paso-a-paso": "stepper", "motor-paso-a-paso": "stepper", "28byj": "stepper", "28byj-48": "stepper",
  teclado: "teclado", keypad: "teclado", "teclado-matricial": "teclado", "4x4": "teclado",
  llama: "llama", fuego: "llama", "sensor-llama": "llama", flame: "llama",
  sonido: "sonido", ruido: "sonido", micro: "sonido", microfono: "sonido", ky038: "sonido",
  ntc: "ntc", termistor: "ntc", "ntc-temperatura": "ntc",
  ir: "ir-receptor", "ir-receptor": "ir-receptor", infrarrojo: "ir-receptor", "control-remoto": "ir-receptor",
  tilt: "tilt", inclinacion: "tilt", "sensor-inclinacion": "tilt",
  // --- componentes dibujados (INET) ---
  relay: "relay", rele: "relay", "relé": "relay", "modulo-relay": "relay", "modulo-rele": "relay", "módulo-relé": "relay",
  bomba: "bomba", "bomba-agua": "bomba", "bomba-de-agua": "bomba", pump: "bomba",
  valvula: "valvula", "válvula": "valvula", electrovalvula: "valvula", "electroválvula": "valvula", solenoide: "valvula", "valvula-solenoide": "valvula",
  higrometro: "higrometro", "higrómetro": "higrometro", "humedad-suelo": "higrometro", "higrometro-suelo": "higrometro", fc28: "higrometro", "fc-28": "higrometro", "sensor-humedad-suelo": "higrometro",
  lluvia: "lluvia", "sensor-lluvia": "lluvia", rain: "lluvia",
  bmp180: "bmp180", bmp: "bmp180", presion: "bmp180", "presión": "bmp180", "sensor-presion": "bmp180", barometro: "bmp180", "barómetro": "bmp180",
  motor: "motor", "motor-dc": "motor", motordc: "motor", "motor-cc": "motor", motorcc: "motor",
  driver: "driver", uln2003: "driver", "uln-2003": "driver", "driver-motor": "driver",
  lampara: "lampara", "lámpara": "lampara", foco: "lampara", bombilla: "lampara", luz220: "lampara",
  calefactor: "calefactor", radiador: "calefactor", calefaccion: "calefactor", "calefacción": "calefactor", estufa: "calefactor", heater: "calefactor",
}

/**
 * Lleva lo que escribió el modelo a la clave real del catálogo.
 *
 * SACA LAS TILDES, y no es un detalle. El ALIAS ya trae formas acentuadas para
 * varios componentes —`lámpara`, `válvula`, `higrómetro`, `presión`— así que
 * cubrir tildes siempre fue la intención; el problema es que había que agregar
 * CADA variante a mano, y tres quedaron afuera: `botón`, `potenciómetro` y
 * `ultrasónico`. Justo los tres que el prompt del agente escribe acentuados.
 *
 * El resultado era: el modelo pide "botón", el tool contesta "No conozco:
 * botón", y el bot improvisa. Sacando la tilde acá, cualquier forma acentuada
 * anda sin que nadie tenga que preverla — y las entradas acentuadas que YA
 * están en ALIAS siguen funcionando porque se consultan primero.
 */
// Busca la definición de un componente ya validado. Los desconocidos se filtran
// antes (el tool contesta "No conozco: ..."), así que llegar acá con uno que no
// existe es un bug: se corta con un mensaje claro en vez de un TypeError sobre
// undefined. Con `noUncheckedIndexedAccess`, COMPONENTES[x] es `Componente | undefined`.
function componenteDe(tipo: string): Componente {
  const def = COMPONENTES[normalizarTipo(tipo)]
  if (!def) throw new Error(`Componente desconocido: ${tipo}`)
  return def
}

export function normalizarTipo(t: string): string {
  const k = t.trim().toLowerCase()
  if (ALIAS[k]) return ALIAS[k]
  const sinTildes = k.normalize("NFD").replace(/[̀-ͯ]/g, "")
  return ALIAS[sinTildes] ?? sinTildes
}


// FIX auditoría #1/#3/#10: GPIO seguros primero. Sin 12 (strapping peligroso),
// sin 16/17 (PSRAM). GPIO2 (LED onboard + strapping) y 15 al final, bajo riesgo.
const POOL_DIGITAL = [4, 5, 18, 19, 23, 25, 26, 27, 33, 13, 14, 15, 2]
const POOL_ANALOGICO = [34, 35, 36, 39, 32, 33]

// Validación de GPIO manual (el alumno puede forzar un pin con "led:5").
// GPIOs que EXISTEN en el ESP32 DevKit.
const GPIO_VALIDOS = new Set([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39])
// GPIO6–11 están cableados a la memoria flash SPI: usarlos CUELGA/rompe la placa.
const GPIO_FLASH = new Set([6, 7, 8, 9, 10, 11])
// Pines "strapping": funcionan, pero pueden complicar el arranque si tienen algo conectado.
const GPIO_STRAPPING = new Set([0, 2, 12, 15])
// FIX auditoría B4: GPIO34/35/36/39 NO tienen driver de salida (son ADC/entrada pura)
// y TAMPOCO tienen pull-up/pull-down interno. O sea: no sirven ni para encender algo
// ni para un botón con INPUT_PULLUP. "led:34" se aceptaba sin chistar y el LED no
// prendía nunca — y el alumno revisa el cable, la resistencia y la soldadura antes de
// sospechar del pin, porque el diagrama se lo dio el bot.
const GPIO_SOLO_ENTRADA = new Set([34, 35, 36, 39])
// GPIO1 (TX) y GPIO3 (RX) van al chip USB-serie de la placa: con algo colgado ahí, la
// carga del sketch falla y el Monitor Serie escupe basura. Clase perdida buscando por qué
// "no anda el Arduino" cuando el circuito estaba bien.
const GPIO_UART_USB = new Set([1, 3])

/**
 * Por qué NO se puede usar el GPIO que pidió el usuario ("led:34"), o null si se puede.
 *
 * Un solo lugar con los motivos: lo llama la siembra previa (para reservar el pin) y
 * el asignador (para avisar). Si se separaran, el pin se reservaría y el aviso diría
 * otra cosa.
 */
function motivoGpioRechazado(g: number, clase: ClasePin, etiqueta: string): string | null {
  if (GPIO_FLASH.has(g))
    return `⚠️ GPIO${g} está cableado a la memoria flash del ESP32 (GPIO6 a GPIO11): usarlo cuelga la placa. Le asigné un pin seguro.`
  if (!GPIO_VALIDOS.has(g)) return `⚠️ GPIO${g} no existe en el ESP32. Le asigné un pin válido.`
  if (GPIO_UART_USB.has(g))
    return `⚠️ GPIO${g} es el puerto serie del USB (GPIO1=TX, GPIO3=RX): con algo conectado ahí la placa no acepta la carga del programa. Le asigné otro pin.`
  if (clase !== "analogico" && GPIO_SOLO_ENTRADA.has(g))
    return `⚠️ GPIO${g} es SOLO ENTRADA en el ESP32 (34, 35, 36 y 39): no puede encender nada ni tiene pull-up interno, así que ${etiqueta} ahí no funcionaría nunca. Le asigné un pin que sí sirve. Esos cuatro son ideales para sensores analógicos.`
  return null
}

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
  umbralAplicado: boolean // si el arg `umbral` se llegó a usar (ver armarPuente)
  avisoUmbral: string | null // si se usó PERO recortado al rango del sensor (ver armarPuente)
  notas: string[] // lo que el CHAT tiene que decir: "no te di lo que pediste" (ver asignarGpios)
  sinPin: string[] // componentes que quedaron sin pin: el circuito está INCOMPLETO
  conexiones: string[] // la tabla de pines en texto plano, para devolvérsela al modelo
}

// FIX auditoría #1: g >= 0 evita imprimir "GPIO-1" cuando se agota el pool.
// FIX auditoría B8: devolvía "GPIO?" y el rol YA trae el literal "GPIO" delante
// ("GPIO{0}"), así que al agotarse el pool imprimía "GPIOGPIO?" en la tabla de
// conexiones. Se lee como un error del programa, no como "acá falta un pin".
// FIX auditoría B6: {a-b} es una fila que consume VARIOS pines (7 segmentos,
// teclado) y los imprime todos: el pin reservado tiene que verse en la tabla.
function rellenarRol(rol: string, gpios: number[]): string {
  const uno = (i: number): string => {
    const g = gpios[i]
    return g != null && g >= 0 ? String(g) : "?"
  }
  return rol
    .replace(/\{(\d+)-(\d+)\}/g, (_, a: string, b: string) => {
      const lista: string[] = []
      for (let i = Number(a); i <= Number(b); i++) lista.push("GPIO" + uno(i))
      return lista.join(", ")
    })
    .replace(/\{(\d+)\}/g, (_, i: string) => uno(Number(i)))
}

/**
 * Reparte los GPIO, y devuelve los avisos por CANALES SEPARADOS, a propósito.
 *
 * FIX auditoría A: hasta acá esta función tenía un solo canal (`avisos`) y todo
 * terminaba en el `<div class="aviso">` del HTML. O sea: en la HOJA. El chat no se
 * enteraba de nada. "lcd, led:21" contestaba «Listo! Generé el circuito visual y
 * animado.» y punto, con el "No pude usar GPIO21" enterrado en la página, entre las
 * advertencias generales de cada componente.
 *
 * Eso ya era así antes de la ronda anterior. Lo que hizo la ronda anterior fue crear
 * `notas` en execute con un contrato explícito —«todo lo que el docente TIENE que
 * saber porque no le dimos EXACTAMENTE lo que pidió; van al final de la respuesta,
 * nunca en silencio»— y dejar la mitad de los avisos de esta función del otro lado.
 * Misma función, dos contratos.
 *
 * - `avisos` → la HOJA. Sin cambios: es lo que el docente tiene delante al cablear.
 * - `notas`  → el CHAT, y SÓLO lo que significa "no te di lo que pediste". El aviso
 *              de strapping NO entra acá a propósito: ese pin sí se te dio y anda, es
 *              una sugerencia. Si el chat avisa de todo, la docente aprende a
 *              saltearse los ⚠️ y el aviso que sí importa deja de existir.
 * - `sinPin` → los componentes que quedaron SIN pin (pool agotado). No es una nota
 *              más: es un circuito INCOMPLETO, y cambia cómo se anuncia el resultado.
 */
function asignarGpios(pedidos: Pedido[]): {
  gpios: number[][]
  avisos: string[]
  notas: string[]
  sinPin: string[]
} {
  const usados = new Set<number>()
  const avisos: string[] = []
  const notas: string[] = []
  const sinPin: string[] = []
  // "no te di lo que pediste" va a los DOS lados: la hoja y el chat.
  const avisar = (texto: string): void => {
    avisos.push(texto)
    notas.push(texto)
  }
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
        const nro = m?.[1]
        if (nro != null) usados.add(parseInt(nro, 10))
      }
    }
  }

  /*
   * FIX auditoría B13: sembrar TAMBIÉN los GPIO que el usuario pidió a mano, igual
   * que arriba con los fijos del I2C.
   *
   * Sin esto el resultado dependía del ORDEN de la lista: "led, servo:4" le daba el
   * GPIO4 al LED automático (es el primero del pool) y el servo recibía "ya ocupado,
   * le asigné otro"; "servo:4, led" andaba perfecto. El mismo circuito, dos dibujos
   * distintos, y el aviso culpaba al usuario por un pin que nadie más había pedido.
   *
   * Se reserva sólo lo que DE VERDAD se va a poder usar (misma función de motivos que
   * usa el aviso de abajo): un pin de flash o uno solo-entrada no se reserva, se
   * rechaza igual que antes. Si dos componentes piden el mismo pin, gana el primero
   * y el segundo recibe el "ya ocupado" — que ahí sí es cierto.
   */
  const manual = new Map<Pedido, number>()
  for (const ped of pedidos) {
    if (ped.gpio == null) continue
    const def = COMPONENTES[normalizarTipo(ped.tipo)]
    const primero = def?.pines.find((p) => p.clase !== "fijo")
    if (!def || !primero || (primero.cantidad ?? 1) > 1) continue
    if (motivoGpioRechazado(ped.gpio, primero.clase, def.etiqueta)) continue
    if (usados.has(ped.gpio)) continue
    usados.add(ped.gpio)
    manual.set(ped, ped.gpio)
  }

  const sacar = (pool: number[]): number | null => {
    while (pool.length) {
      const g = pool.shift()!
      if (!usados.has(g)) return g
    }
    return null
  }

  for (const ped of pedidos) {
    const def = componenteDe(ped.tipo)
    const asignados: number[] = []
    const pinesGpio = def.pines.filter((p) => p.clase !== "fijo")

    pinesGpio.forEach((pin, idx) => {
      // Una fila puede consumir varios pines (7 segmentos: 7, teclado: 4+4).
      const cuantos = pin.cantidad ?? 1

      // gpio manual del alumno para el primer pin digital O analógico.
      // Ya quedó reservado (o rechazado) en la siembra de arriba: acá sólo se
      // usa, o se explica por qué no se pudo.
      if (idx === 0 && ped.gpio != null) {
        const reservado = manual.get(ped)
        if (reservado != null) {
          asignados.push(reservado)
          if (GPIO_STRAPPING.has(reservado)) {
            avisos.push(`Nota: GPIO${reservado} es un pin "strapping" del ESP32 — funciona, pero puede complicar el arranque si tiene algo conectado al encender. Si podés, elegí otro.`)
          }
          return
        }
        if (cuantos > 1) {
          avisar(`${def.etiqueta} usa ${cuantos} pines, no uno: el GPIO${ped.gpio} que pediste no alcanza, así que se los asigné yo.`)
        } else {
          avisar(
            motivoGpioRechazado(ped.gpio, pin.clase, def.etiqueta) ??
              `No pude usar GPIO${ped.gpio} para ${def.etiqueta} (ya ocupado): le asigné otro.`,
          )
        }
      }

      for (let n = 0; n < cuantos; n++) {
        const g = pin.clase === "analogico" ? sacar(poolAna) : sacar(poolDig)
        if (g == null) {
          avisar(`No quedan GPIO ${pin.clase} libres para ${def.etiqueta}: revisalo a mano.`)
          if (!sinPin.includes(def.etiqueta)) sinPin.push(def.etiqueta)
          asignados.push(-1)
          continue
        }
        usados.add(g)
        asignados.push(g)
      }
    })

    resultado.push(asignados)
  }

  return { gpios: resultado, avisos, notas, sinPin }
}


// FIX auditoría #2: armarPuente devuelve también el id del actuador gobernado,
// para NO ejecutar su animación autónoma (que pelearía con el puente).
// Sensores que se pueden "simular" con un slider de magnitud física.
// El alumno mueve el slider = simula acercar calor/luz/un objeto → dispara el actuador.
const SENSOR_SIM: Record<string, { magnitud: string; unidad: string; min: number; max: number; umbral: number; emoji: string }> = {
  dht22: { magnitud: "Temperatura", unidad: "°C", min: 0, max: 60, umbral: 35, emoji: "🌡️" },
  ntc: { magnitud: "Temperatura", unidad: "°C", min: 0, max: 60, umbral: 35, emoji: "🌡️" },
  ultrasonico: { magnitud: "Distancia", unidad: "cm", min: 2, max: 200, umbral: 20, emoji: "📏" },
  pir: { magnitud: "Movimiento", unidad: "", min: 0, max: 1, umbral: 1, emoji: "🚶" },
  llama: { magnitud: "Fuego cerca", unidad: "%", min: 0, max: 100, umbral: 50, emoji: "🔥" },
  sonido: { magnitud: "Nivel de ruido", unidad: "%", min: 0, max: 100, umbral: 60, emoji: "🔊" },
  higrometro: { magnitud: "Humedad del suelo", unidad: "%", min: 0, max: 100, umbral: 35, emoji: "💧" },
  lluvia: { magnitud: "Lluvia", unidad: "%", min: 0, max: 100, umbral: 50, emoji: "🌧️" },
}

// `usaUmbral` dice si el arg `umbral` de la tool llegó a usarse (sólo el puente
// sensor→actuador lo mira). Lo necesita execute para avisar cuando se ignoró:
// FIX auditoría B11 — pedir "que prenda a 20 grados" y que el circuito salga con
// el default sin decir nada es peor que rechazar el pedido.
//
// `avisoUmbral` es el caso de al lado, que B11 no había cubierto: el umbral SÍ se
// aplica, pero no el que se pidió. El Math.max/Math.min que lo acota al rango del
// sensor era mudo y usaUmbral seguía en true, así que el aviso de arriba tampoco
// disparaba: se pedía 200, la hoja decía "≥ 60 °C" y el chat no decía nada. Ése es el
// que se ve bien y miente, que es peor que el que se ve roto.
function armarPuente(
  pedidos: Pedido[],
  umbral?: number,
): { js: string; idActuador: string; usaUmbral: boolean; avisoUmbral: string | null } | null {
  const idx = (pred: (t: string) => boolean): number =>
    pedidos.findIndex((p) => pred(normalizarTipo(p.tipo)))

  // 1) sensor (dht22/ultrasonico/pir/higrometro/lluvia…) + actuador → slider de magnitud con umbral
  // Actuadores: los lógicos (led/servo/buzzer) responden con su propiedad; los de potencia
  // (relay/bomba/valvula/lampara/calefactor/motor) se "encienden" con un glow visual.
  const ESACTU = (t: string) =>
    ["led", "servo", "buzzer", "relay", "bomba", "valvula", "lampara", "calefactor", "motor"].includes(t)
  const iSens = idx((t) => SENSOR_SIM[t] != null)
  const iActS = idx(ESACTU)
  const pSens = pedidos[iSens], pActS = pedidos[iActS]
  const s = pSens ? SENSOR_SIM[normalizarTipo(pSens.tipo)] : undefined
  if (pSens && pActS && s) {
    const tSens = normalizarTipo(pSens.tipo)
    const tActu = normalizarTipo(pActS.tipo)
    const idSens = `${tSens}${iSens}`, idActu = `${tActu}${iActS}`
    // qué le hace al actuador cuando se dispara
    const onAct =
      tActu === "led" ? "act.value=disparado;act.brightness=disparado?1:0;" :
      tActu === "servo" ? "act.angle=disparado?180:0;" :
      tActu === "buzzer" ? "act.hasSignal=disparado;" :
      "act.style.filter=disparado?'drop-shadow(0 0 13px #f39c12)':'none';act.style.opacity=disparado?'1':'0.45';"
    // dirección del umbral: ultrasónico/higrómetro disparan con valor BAJO (cerca/seco).
    // Si hay un calefactor en el circuito, también dispara con FRÍO (temp baja). El resto, al SUPERAR.
    // (miramos TODO el pedido, no solo el actuador gobernado, que suele ser el relé.)
    const hayCalefactor = pedidos.some((p) => normalizarTipo(p.tipo) === "calefactor")
    const disparaBajo = tSens === "ultrasonico" || tSens === "higrometro" || hayCalefactor
    // umbral: el que pidió el usuario (si vino), o el default del sensor. Lo acotamos al rango del slider.
    const umbralUsado = umbral != null ? Math.max(s.min, Math.min(s.max, umbral)) : s.umbral
    // …y si al acotarlo quedó otro número, se dice. Recortar en silencio es la misma
    // falta que B11 vino a arreglar: la hoja sale prolija mostrando un valor que nadie pidió.
    const conUnidad = (v: number): string => `${v} ${s.unidad}`.trim() // hay sensores sin unidad (PIR)
    const avisoUmbral =
      umbral != null && umbral !== umbralUsado
        ? `El umbral que pediste (${umbral}) queda fuera de lo que mide el sensor (${s.magnitud.toLowerCase()}: de ${conUnidad(s.min)} a ${conUnidad(s.max)}): lo recorté a ${conUnidad(umbralUsado)}, que es lo que vas a ver en la hoja. Si el número era otro, pedímelo de nuevo.`
        : null
    const cmp = disparaBajo ? `m<=${umbralUsado}` : `m>=${umbralUsado}`
    // texto claro de cuándo se activa (ej: "el LED se prende con ≥ 20 °C")
    const nombreActu = COMPONENTES[tActu]?.etiqueta ?? "el actuador"
    const signo = disparaBajo ? "≤" : "≥"
    const avisoDisparo = `${nombreActu} se activa con ${signo} ${umbralUsado} ${s.unidad}`.trim()
    const js = `(() => {
      const sen=document.getElementById('${idSens}'), act=document.getElementById('${idActu}');
      if(!sen||!act)return;
      const ctrl=document.createElement('div');
      ctrl.style.cssText='display:flex;flex-direction:column;align-items:center;gap:5px;background:#fff4e5;border:1px solid #f0d9b8;border-radius:10px;padding:9px 13px;margin-top:8px;max-width:220px';
      ctrl.innerHTML='<label style="font:600 12px sans-serif;color:#b9770e">${s.emoji} Simulá ${s.magnitud.toLowerCase()} 👇</label><input type="range" min="${s.min}" max="${s.max}" value="${s.min}" style="width:170px;accent-color:#e67e22;cursor:pointer"><span style="font:700 14px sans-serif;color:#e67e22">${s.min} ${s.unidad}</span><small style="font:600 11px sans-serif;color:#b9770e">${avisoDisparo}</small>';
      const sl=ctrl.querySelector('input'), lbl=ctrl.querySelector('span');
      sen.parentElement.appendChild(ctrl);
      function aplicar(m){
        const disparado = ${cmp};
        ${onAct}
        lbl.textContent = m + ' ${s.unidad}' + (disparado ? ' ⚠️' : '');
        // resaltar el sensor cuando se dispara
        sen.style.filter = disparado ? 'drop-shadow(0 0 10px #e67e22)' : 'none';
      }
      sl.addEventListener('input',()=>aplicar(+sl.value));
      aplicar(${s.min});
    })();`
    return { js, idActuador: idActu, usaUmbral: true, avisoUmbral }
  }

  const iInter = idx((t) => COMPONENTES[t]?.interactivo === true)
  const iAct = idx((t) => t === "led" || t === "servo" || t === "buzzer")
  if (iInter < 0 || iAct < 0) return null

  const pInter = pedidos[iInter], pAct = pedidos[iAct]
  if (!pInter || !pAct) return null
  const tInter = normalizarTipo(pInter.tipo)
  const tAct = normalizarTipo(pAct.tipo)
  const idInter = `${tInter}${iInter}`
  const idAct = `${tAct}${iAct}`

  // El potenciómetro Wokwi detecta el giro con geometría SVG que se rompe al abrir con file://.
  // Por eso INYECTAMOS un slider de control visible: el alumno lo mueve, y eso gira la perilla
  // visual Y mueve el actuador. Robusto, obvio, no depende de arrastrar la perilla.
  // efecto(v) recibe el value 0-1023 y debe actualizar el actuador.
  let js = ""
  if (tInter === "potenciometro") {
    let efecto = ""
    if (tAct === "led") efecto = `const pc=(v/1023)*100;a.brightness=pc/100;a.value=pc>2;`
    else if (tAct === "servo") efecto = `s.angle=Math.round((v/1023)*180);`
    else if (tAct === "buzzer") efecto = `b.hasSignal=(v/1023)*100>50;`
    if (efecto) {
      const ref = tAct === "led" ? "a" : tAct === "servo" ? "s" : "b"
      js = `(() => {
        const p=document.getElementById('${idInter}'), ${ref}=document.getElementById('${idAct}');
        if(!p||!${ref})return;
        // slider de control inyectado bajo el potenciómetro
        const ctrl=document.createElement('div');
        ctrl.style.cssText='display:flex;flex-direction:column;align-items:center;gap:5px;background:#f7f9fb;border:1px solid #e3e8ee;border-radius:10px;padding:9px 13px;margin-top:8px;max-width:200px';
        ctrl.innerHTML='<label style="font:600 12px sans-serif;color:#34495e">Mové para girar 👇</label><input type="range" min="0" max="1023" value="0" style="width:160px;accent-color:#9b59b6;cursor:pointer"><span style="font:700 14px sans-serif;color:#9b59b6">0%</span>';
        const sl=ctrl.querySelector('input'), lbl=ctrl.querySelector('span');
        p.parentElement.appendChild(ctrl);
        function aplicar(v){ p.value=v; ${efecto} lbl.textContent=Math.round((v/1023)*100)+'%'; }
        sl.addEventListener('input',()=>aplicar(+sl.value));
        p.addEventListener('input',()=>{ sl.value=p.value; aplicar(p.value); });
        aplicar(0);
      })();`
    }
  } else if (tInter === "boton") {
    const onP = tAct === "servo" ? "a.angle=180" : tAct === "buzzer" ? "a.hasSignal=true" : "a.value=true"
    const onR = tAct === "servo" ? "a.angle=0" : tAct === "buzzer" ? "a.hasSignal=false" : "a.value=false"
    js = `(() => { const btn=document.getElementById('${idInter}'),a=document.getElementById('${idAct}'); if(!btn||!a)return; btn.addEventListener('button-press',()=>{${onP};}); btn.addEventListener('button-release',()=>{${onR};}); })();`
  } else if (tInter === "joystick") {
    // el joystick mueve el eje X con un slider; ese valor controla el actuador
    const ref = tAct === "led" ? "a" : tAct === "servo" ? "sv" : "bz"
    const efecto = tAct === "led" ? "const pc=(v/100)*100;a.brightness=v/100;a.value=v>2;" : tAct === "servo" ? "sv.angle=Math.round((v/100)*180);" : "bz.hasSignal=v>50;"
    js = `(() => {
      const j=document.getElementById('${idInter}'), ${ref}=document.getElementById('${idAct}');
      if(!j||!${ref})return;
      const ctrl=document.createElement('div');
      ctrl.style.cssText='display:flex;flex-direction:column;align-items:center;gap:5px;background:#eef6ff;border:1px solid #bcd9f5;border-radius:10px;padding:9px 13px;margin-top:8px;max-width:200px';
      ctrl.innerHTML='<label style="font:600 12px sans-serif;color:#2471a3">🕹️ Mové el eje X 👇</label><input type="range" min="0" max="100" value="50" style="width:160px;accent-color:#2980b9;cursor:pointer"><span style="font:700 14px sans-serif;color:#2980b9">centro</span>';
      const sl=ctrl.querySelector('input'), lbl=ctrl.querySelector('span');
      j.parentElement.appendChild(ctrl);
      function aplicar(v){ if(j.xValue!==undefined)j.xValue=Math.round((v/100)*1023); ${efecto} lbl.textContent=(v<40?'◀ izq':v>60?'der ▶':'centro'); }
      sl.addEventListener('input',()=>aplicar(+sl.value));
      aplicar(50);
    })();`
  }
  if (!js) return null
  return { js, idActuador: idAct, usaUmbral: false, avisoUmbral: null }
}

// Escala visual por tipo de pieza para que ninguna quede gigante ni minúscula.
const ESCALA: Record<string, number> = {
  led: 1.3, servo: 1.0, potenciometro: 1.15, buzzer: 1.3, ultrasonico: 1.0,
  dht22: 1.2, pir: 1.0, lcd: 0.9, boton: 1.3,
  "rgb-led": 1.3, ldr: 1.1, oled: 0.9,
  "7segmentos": 1.0, neopixel: 1.4, joystick: 1.0,
  mpu6050: 1.2, stepper: 1.0, teclado: 0.9,
  llama: 1.1, sonido: 1.1, ntc: 1.1, "ir-receptor": 1.2, tilt: 1.2,
  relay: 1.0, bomba: 1.0, valvula: 1.0, higrometro: 1.0, lluvia: 1.0,
  bmp180: 1.3, motor: 1.0, driver: 1.0, lampara: 0.9, calefactor: 1.0,
}

// LAYOUT POR FILAS (robusto): ESP32 fija a la izquierda + una fila por componente.
// Sin coordenadas globales en SVG estirado → las piezas y sus conexiones NUNCA se desalinean.
function armarCircuito(pedidos: Pedido[], umbral?: number): ResultadoArmado {
  const { gpios: gpiosPorComp, avisos: avisosGpio, notas: notasGpio, sinPin } = asignarGpios(pedidos)
  const puente = armarPuente(pedidos, umbral)
  const gobernado = puente ? puente.idActuador : null

  const filas: string[] = []
  const filasTabla: string[] = []
  const conexiones: string[] = []
  const anims: string[] = []
  const advertencias = new Set<string>()
  let hay5V = false
  let interactivo = false

  pedidos.forEach((ped, i) => {
    const tipo = normalizarTipo(ped.tipo)
    const def = componenteDe(tipo)
    const id = `${tipo}${i}`
    const gpios = gpiosPorComp[i] ?? []

    if (def.voltaje === "5V") hay5V = true
    if (def.interactivo) interactivo = true
    if (def.advertencia) advertencias.add(def.advertencia)

    // columna de conexiones: cada pin = nodo + etiqueta en cajita + cable CSS (flex).
    // El cable no tiene coordenadas: vive en la misma fila flex que su etiqueta, nunca se desalinea.
    const conex = def.pines
      .map((pin) => {
        const destino = pin.clase === "fijo" ? pin.destino! : rellenarRol(pin.rol, gpios)
        // R en serie: solo cuando "(con XΩ)" CIERRA la etiqueta (LED, RGB). El caso
        // "7 pines (cada segmento con 220Ω)" no matchea a proposito (una sola R para 7 pines mentiria).
        const conR = pin.clase !== "fijo" && destino.match(/^(.*?)\s*\(con\s*([\d.]+\s*[kKmM]?)\s*Ω\)\s*$/)
        const etiqueta = conR ? conR[1] : destino
        const valorR = conR ? (conR[2] ?? "").replace(/\s+/g, "") : null
        const cable = valorR
          ? `<span class="cable"></span><span class="res" title="Resistencia de ${valorR}Ω en serie">${valorR}Ω</span><span class="cable"></span>`
          : `<span class="cable"></span>`
        return `          <div class="pin" style="--c:${pin.color}">
            <span class="nodo"></span>
            <span class="label"><span class="nom">${pin.nombre}</span><span class="gpio">${etiqueta}</span></span>
            ${cable}
          </div>`
      })
      .join("\n")

    // la pieza Wokwi, con su escala propia
    const escala = ESCALA[tipo] ?? 1.0
    const attrs = def.attrs ? def.attrs(i) : ""
    const pieza = `<${def.tag} id="${id}" ${attrs} style="transform:scale(${escala});transform-origin:left center"></${def.tag}>`

    filas.push(
      `      <div class="fila">
        <div></div>
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

    // La MISMA tabla, en texto plano, para devolvérsela al modelo (FIX auditoría A).
    // Se arma acá y no aparte para que no puedan divergir: si algún día la fila de la
    // hoja cambia, esta línea cambia con ella.
    conexiones.push(
      `${def.etiqueta}: ` +
        def.pines
          .map((pin) => `${pin.nombre} → ${pin.clase === "fijo" ? pin.destino! : rellenarRol(pin.rol, gpios)}`)
          .join(", "),
    )

    if (id !== gobernado) {
      anims.push(`(() => { ${def.anim(id)} })();`)
    }
  })

  if (puente) {
    anims.push(puente.js)
    interactivo = true // si hay puente (incluido sensor→actuador con slider), es interactivo
  }

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
  const notas = [...notasGpio]
  for (const choque of avisosI2cRepetido(pedidos)) {
    advertencias.add(choque)
    notas.push(choque)
  }
  const aviso = cabecera + Array.from(advertencias).map((f) => "• " + f).join(" ")

  const tabla = `
      <tr><th>Componente</th><th>Cables</th><th>Conexiones al ESP32</th></tr>
${filasTabla.join("\n")}`

  // alto: no se usa para layout (las filas crecen solas), pero lo dejamos por compatibilidad
  return {
    escena,
    tabla,
    aviso,
    alto: 0,
    animacion: anims.join("\n"),
    interactivo,
    umbralAplicado: puente?.usaUmbral === true,
    avisoUmbral: puente?.avisoUmbral ?? null,
    notas,
    sinPin,
    conexiones,
  }
}

/**
 * FIX auditoría F: dos dispositivos I2C del MISMO tipo en el mismo bus.
 *
 * "oled, oled" salía con los dos colgados de SDA=GPIO21 / SCL=GPIO22 y sin una
 * palabra. En el papel se ve impecable —es literalmente cómo se cablea el I2C, todos
 * en paralelo— y por eso es de los que más engañan: el bus está bien, lo que está mal
 * es que los dos módulos vienen de fábrica con la MISMA dirección (el SSD1306 en
 * 0x3C, la mochila del LCD en 0x27, el MPU6050 en 0x68). El ESP32 no tiene forma de
 * hablarle a uno sin hablarle al otro: en la práctica anda uno solo, o ninguno.
 *
 * Se avisa y no se corta: el circuito es armable —cambiándole la dirección a uno, que
 * es un jumper en la plaquita— y decirle a la docente "no puedo" en el medio de la
 * clase no la ayuda. Pero enterarse DESPUÉS de cablear dos displays que no prenden sí
 * que no la ayuda.
 *
 * Sólo se mira el mismo tipo repetido: un OLED (0x3C) y un LCD (0x27) conviven
 * perfecto en el mismo bus, que es justamente la gracia del I2C. Avisar de eso sería
 * ruido, y el ⚠️ que grita siempre no lo lee nadie.
 */
function avisosI2cRepetido(pedidos: Pedido[]): string[] {
  const esI2c = (tipo: string): boolean =>
    (COMPONENTES[tipo]?.pines ?? []).some((p) => p.clase === "fijo" && p.destino === "GPIO21")

  const cuenta = new Map<string, number>()
  for (const ped of pedidos) {
    const t = normalizarTipo(ped.tipo)
    if (esI2c(t)) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  }

  return [...cuenta.entries()]
    .filter(([, n]) => n > 1)
    .map(
      ([t, n]) =>
        `Pediste ${n} unidades de "${componenteDe(t).etiqueta}" y las ${n} van al MISMO bus I2C (SDA=GPIO21, SCL=GPIO22) con la MISMA dirección de fábrica: el ESP32 no las puede distinguir, así que en la placa real va a andar una sola. Para usar ${n} hay que cambiarle la dirección a las demás (es un puente/jumper en la plaquita, o el pin de dirección) o poner un multiplexor I2C TCA9548A. El cableado del dibujo está bien: lo que choca son las direcciones.`,
    )
}

// Sanitiza el nombre de archivo que pide el usuario: evita que un "../../.." escriba
// FUERA de la carpeta de trabajo, y que un nombre vacío cree un archivo oculto ".html".
// Deja solo letras, números, guión, guión bajo y punto (sin separadores de ruta).
// FIX auditoría B11: además del nombre, dice cuándo el pedido NO se pudo respetar. Un
// nombre en otro alfabeto ("電路図") se convertía entero en guiones, caía al default y
// nadie se enteraba: la docente después buscaba un archivo con el nombre que había
// pedido y no estaba. Pedir algo y recibir otra cosa sin enterarse es el peor default
// que puede tener una herramienta.
//
// FIX auditoría C: "riego.html" salía como "riego.html.html". El punto sobrevivía al
// saneamiento (es un carácter permitido, y tiene que serlo), el nombre quedaba igual
// al pedido —así que tampoco había aviso— y después execute le pegaba la extensión de
// nuevo. Pedir el archivo con su extensión es lo más natural del mundo, y el modelo lo
// hace todo el tiempo. La extensión se saca ANTES de comparar: "riego.html" y "riego"
// son el mismo pedido, y ninguno de los dos merece un ⚠️.
//
// FIX auditoría D: ya NO devuelve el aviso armado, sólo el nombre que no se pudo usar.
// El aviso lo arma execute DESPUÉS de guardar, porque antes de guardar el nombre final
// todavía no se decidió: si el archivo ya existía, el de verdad es "…-2.html". Esta
// función afirmaba uno y rutaDeSalida afirmaba otro, en la misma respuesta. La docente
// que leía la primera línea abría el archivo viejo.
function nombreSeguro(
  raw: string | undefined,
  fallback: string,
): { nombre: string; pedidoNoUsado: string | null } {
  if (!raw || !raw.trim()) return { nombre: fallback, pedidoNoUsado: null }
  const pedido = raw.trim()
  const sinExtension = pedido.replace(/\.html?$/i, "") // "riego.html" == "riego"
  const limpio = sinExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "-") // saca "/", "\", espacios y cualquier cosa rara
    .replace(/\.{2,}/g, ".") // colapsa ".." (evita traversal aunque no haya "/")
    .replace(/^[.\-]+|[.\-]+$/g, "") // sin punto/guión al principio o al final
  const nombre = limpio.length > 0 ? limpio : fallback
  return { nombre, pedidoNoUsado: nombre === sinExtension ? null : pedido }
}

// FIX auditoría B11: "led:abc" se parseaba como un pedido sin GPIO y el tool le
// asignaba otro pin en silencio. El alumno pidió un pin, el dibujo muestra otro, y
// el cable termina en el agujero equivocado.
function parsearComponentes(raw: string): { pedidos: Pedido[]; avisos: string[] } {
  const avisos: string[] = []
  const pedidos = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const [tipo, g] = tok.split(":").map((x) => x.trim())
      if (g != null && !/^\d+$/.test(g)) {
        avisos.push(`En "${tok}" el GPIO tiene que ser un número (así: "${tipo}:4"). Como "${g}" no lo es, le asigné un pin automático.`)
      }
      const gpio = g != null && /^\d+$/.test(g) ? parseInt(g, 10) : undefined
      return { tipo: normalizarTipo(tipo ?? tok), gpio }
    })
  return { pedidos, avisos }
}

/**
 * Actuadores de POTENCIA → quién los tiene que gobernar.
 *
 * FIX auditoría B3: no había ninguna validación de esto. "higrometro, bomba" se
 * generaba sin chistar, y el HTML mostraba el sensor encendiendo la bomba DIRECTO —
 * justo el error que el prompt del bot y todos los skills tratan de sacarle de la
 * cabeza al alumno. Un GPIO del ESP32 da 12 mA; una bomba chica pide 500 mA o más.
 * Si lo arma, quema la placa.
 *
 * Se INYECTA el mando en vez de cortar con un mensaje, y es a propósito: el docente
 * que pide "riego" necesita el circuito de riego, no una clase de electrónica en el
 * medio de la clase. El bot entrega lo que hace falta y AVISA qué agregó y por qué
 * (que es exactamente lo que un profesor haría). Si además se le dice "no puedo",
 * el modelo reintenta solo y termina dibujando cualquier cosa.
 */
const POTENCIA: Record<string, "relay" | "driver"> = {
  bomba: "relay",
  valvula: "relay",
  lampara: "relay",
  calefactor: "relay",
  motor: "driver",
  stepper: "driver",
}

/*
 * OJO: el guard se mira POR FAMILIA, y eso es el arreglo.
 *
 * Antes era `if (tipos.some(t => t === "relay" || t === "driver")) return`: con
 * CUALQUIER mando en la lista la inyección se apagaba ENTERA, sin preguntar si ese
 * mando gobernaba a alguien ni si era de la familia que hacía falta. El motor pide
 * DRIVER, no relé. "dht22, relay, calefactor, motor" salía sin un solo driver
 * dibujado, y la tabla del motor igual mandaba a cablear contra "Driver
 * (L298N/ULN2003)": una flecha que apunta a un componente que no está en la hoja.
 *
 * Lo que se conserva de la idea original: si el pedido YA trae el mando de la familia
 * correcta, se respeta el criterio de quien lo pidió y no se toca nada.
 */
/*
 * FIX auditoría E: UNO POR CARGA, no uno por circuito.
 *
 * Antes se buscaba la PRIMERA carga de la familia y se inyectaba UN mando, y listo:
 * "ldr, lampara, calefactor" salía con un solo relé para las dos cargas, y el aviso
 * nombraba nada más que la lámpara. Un módulo relé de un canal tiene UN contacto: no
 * conmuta dos cargas independientes. El dibujo mandaba a la docente a armar algo que
 * en la mesa no se puede armar — y encima el aviso ni mencionaba al calefactor, así
 * que no tenía de dónde sospechar.
 *
 * Se elige INYECTAR uno por carga (y no avisar que se comparte) porque el pedido
 * "lámpara y calefactor" son dos cosas que se prenden por separado: si fueran una
 * sola, sería una sola carga. Un relé por carga es el circuito que la docente quería;
 * compartir uno es un circuito distinto, que ella no pidió.
 *
 * PERO si el mando lo trajo EL USUARIO, no se toca la cuenta: ahí hay una decisión
 * tomada (puede tener un módulo de 2 o 4 canales, que existe y es lo más común de
 * comprar) y el criterio de la ronda anterior —no borrar ni pisar lo que el usuario
 * pidió— sigue valiendo. Lo que no se puede es callarse: si su único relé tiene que
 * gobernar dos cargas, se lo decimos y que decida él.
 *
 * Y ese aviso se cuenta CONTRA LA CANTIDAD, no contra "trajo alguno". Con
 * "relay, lampara, relay, calefactor" el usuario trajo DOS relés para DOS cargas: el
 * circuito está perfecto y avisarle que se comparten sería decirle algo falso — que es
 * la categoría de error que esta ronda vino a sacar, no a mover de lugar.
 */
function inyectarMando(pedidos: Pedido[]): { pedidos: Pedido[]; avisos: string[] } {
  const avisos: string[] = []
  const salida: Pedido[] = []
  // Cuántos mandos de cada familia trajo el pedido. Si trajo alguno no inyectamos
  // nada (la decisión es suya); si trajo MENOS que cargas, se lo decimos.
  const cuantosTrajo = (mando: "relay" | "driver"): number =>
    pedidos.filter((p) => normalizarTipo(p.tipo) === mando).length

  const inyectadas: Record<"relay" | "driver", string[]> = { relay: [], driver: [] }
  const compartiendo: Record<"relay" | "driver", string[]> = { relay: [], driver: [] }

  for (const ped of pedidos) {
    const mando = POTENCIA[normalizarTipo(ped.tipo)]
    if (mando) {
      const etiqueta = componenteDe(ped.tipo).etiqueta.toLowerCase()
      if (cuantosTrajo(mando) > 0) {
        compartiendo[mando].push(etiqueta)
      } else {
        // entra JUSTO ANTES de SU carga: el circuito se lee sensor → mando → potencia
        salida.push({ tipo: mando })
        inyectadas[mando].push(etiqueta)
      }
    }
    salida.push(ped)
  }

  for (const mando of ["relay", "driver"] as const) {
    const nombre = mando === "relay" ? "relé" : "driver"
    const cargas = inyectadas[mando]
    if (cargas.length === 1) {
      avisos.push(
        `Le agregué ${componenteDe(mando).etiqueta} al circuito: ${cargas[0]} no se puede conectar directo al ESP32 (el GPIO entrega 12 mA y esto pide bastante más: lo quema). El ESP32 manda la señal al ${nombre}, y el ${nombre} mueve la potencia con su propia fuente.`,
      )
    } else if (cargas.length > 1) {
      avisos.push(
        `Le agregué un ${componenteDe(mando).etiqueta} POR CADA carga de potencia (${cargas.length} en total: ${cargas.join(" y ")}): ninguna se puede conectar directo al ESP32 (el GPIO entrega 12 mA y esto pide bastante más: lo quema). Va uno por carga y no uno solo para todas porque un ${nombre} de un canal conmuta UNA sola cosa: con uno compartido, ${cargas.join(" y ")} se prenderían y apagarían siempre juntos. El ESP32 manda la señal a cada ${nombre}, y cada ${nombre} mueve su potencia con su propia fuente.`,
      )
    }

    // El usuario trajo SUS mandos, pero menos que cargas: algunas van a compartir.
    // Si trajo uno por carga (o de más) el circuito está bien y no hay nada que decir.
    const trajo = cuantosTrajo(mando)
    const cargasPropias = compartiendo[mando]
    if (cargasPropias.length > trajo) {
      avisos.push(
        `Respeté ${trajo === 1 ? `el ${nombre}` : `los ${trajo} ${nombre}s`} que pediste y no agregué otro, pero ojo: en este circuito hay ${cargasPropias.length} cargas de potencia (${cargasPropias.join(" y ")}) y cada módulo de un canal conmuta UNA sola. Así como está, no alcanzan: ${trajo === 1 ? `las ${cargasPropias.length} van a prenderse y apagarse juntas` : `algunas van a prenderse y apagarse juntas`}. Si las querés independientes necesitás ${cargasPropias.length} canales (un módulo de ${cargasPropias.length}, o uno por carga), o pedímelo sin el ${nombre} en la lista y te pongo uno por carga.`,
      )
    }
  }

  return { pedidos: salida, avisos }
}

/**
 * La lista de ejemplo que se ofrece cuando el mando inyectado se pasa del tope de 6.
 *
 * Era `pedidos.slice(0, 6)` sobre la lista YA INYECTADA — y el mando entra JUSTO ANTES
 * de la potencia, así que el que se caía por el borde era SIEMPRE el actuador.
 * "higrometro, lluvia, bmp180, lcd, led, bomba" sugería "…led, relay": un riego sin
 * bomba, con un relé que no gobierna nada. Y el modelo copia esa lista tal cual,
 * porque va entre comillas y con formato de comando.
 *
 * Ahora se recorta sobre lo que pidió la persona (no sobre lo inyectado), se protege
 * la potencia —que es el punto del circuito, no el accesorio— y antes de ofrecerla se
 * la vuelve a pasar por inyectarMando para garantizar que lo sugerido ENTRA.
 */
function sugerenciaQueEntra(crudo: Pedido[]): string {
  const entra = (lista: Pedido[]): boolean => lista.length > 0 && inyectarMando(lista).pedidos.length <= 6
  const lista = [...crudo]
  // 1) se sacan los accesorios, de atrás para adelante; los actuadores de potencia no se tocan
  for (let i = lista.length - 1; i >= 0 && !entra(lista); i--) {
    if (POTENCIA[normalizarTipo(lista[i]!.tipo)]) continue
    lista.splice(i, 1)
  }
  // 2) si quedó sólo potencia y todavía no entra, recién ahí se recortan actuadores
  while (lista.length > 1 && !entra(lista)) lista.pop()
  return inyectarMando(lista)
    .pedidos.map((p) => normalizarTipo(p.tipo))
    .join(", ")
}

/**
 * FIX auditoría B1: el HTML SIEMPRE emite <script src="componentes-extra.js">, pero
 * ese archivo se copiaba sólo si existía. Sin él, los <pb-*> son custom elements que
 * nadie define: el navegador los deja como spans de tamaño cero. Ni error, ni 404
 * visible. La docente abría una página con la tabla de conexiones y CERO piezas,
 * después de que el bot le dijera "Listo! Generé el circuito".
 *
 * Y son justo los 10 componentes de los proyectos del INET (relé, bomba, válvula,
 * higrómetro, lluvia, BMP180, motor, driver, lámpara, calefactor). El guard de
 * wokwi-bundle.js existía desde el día uno; a éste nunca se lo hizo.
 */
function faltanPiezasDibujadas(pedidos: Pedido[]): string | null {
  const dibujadas = pedidos.filter((p) => componenteDe(p.tipo).tag.startsWith("pb-"))
  if (dibujadas.length === 0 || existsSync(extraPath())) return null
  const nombres = [...new Set(dibujadas.map((p) => componenteDe(p.tipo).etiqueta))].join(", ")
  return `Me falta el archivo de piezas dibujadas (componentes-extra.js) y este circuito lo necesita para: ${nombres}. Si lo genero igual te sale una página con la tabla de conexiones y NINGUNA pieza dibujada, así que no lo genero. Reinstalá Tecnia Bot con el instalador (es el que copia la biblioteca visual) y pedímelo de nuevo. Mientras tanto puedo armarte circuitos con las piezas que sí tengo: led, servo, buzzer, potenciómetro, botón, ultrasónico, DHT22, PIR, LCD, OLED y varias más.`
}

/**
 * FIX auditoría B5: antes era `Bun.write(archivo, html)` a secas, y el nombre lo elige
 * el MODELO, no la persona. Dos pedidos parecidos en la misma clase ("circuito.html")
 * y el trabajo de la docente desaparecía sin dejar rastro.
 *
 * Se versiona en vez de cortar con un error: la docente está en el medio de una clase
 * y quiere su circuito, no un cartel. Pierde cero, y se le dice qué archivo quedó.
 *
 * OJO con la asimetría, que es deliberada: sólo se versiona cuando el nombre vino
 * EXPLÍCITO. El nombre por defecto es determinista a propósito (regenerar el mismo
 * circuito tiene que pisar el anterior, si no la carpeta se llena de copias iguales).
 */
function rutaDeSalida(
  dir: string,
  base: string,
  explicito: boolean,
): { archivo: string; aviso: string | null } | { error: string } {
  const primera = join(dir, `${base}.html`)
  if (!explicito || !existsSync(primera)) return { archivo: primera, aviso: null }
  for (let n = 2; n < 100; n++) {
    const otra = join(dir, `${base}-${n}.html`)
    if (!existsSync(otra)) {
      return {
        archivo: otra,
        aviso: `Ya había un "${base}.html" en la carpeta y no lo toqué: este quedó como "${base}-${n}.html".`,
      }
    }
  }
  // Acá abajo vivía el bug que esta misma función dice haber matado. El fallback era
  // `${base}-${Date.now()}` a secas: el ÚNICO camino de rutaDeSalida que no preguntaba
  // existsSync. Dos llamadas en el mismo milisegundo devolvían el mismo nombre y la
  // segunda pisaba a la primera — con un aviso que juraba que no había tocado nada.
  // El borde tiene que ser tan ruidoso como el centro: se pregunta igual que arriba, y
  // si de verdad no queda lugar se corta, en vez de pisar y decir que no se pisó.
  for (let n = 0; n < 100; n++) {
    const sello = n === 0 ? `${base}-${Date.now()}` : `${base}-${Date.now()}-${n}`
    const otra = join(dir, `${sello}.html`)
    if (!existsSync(otra)) {
      return {
        archivo: otra,
        aviso: `Ya había un "${base}.html" y 98 copias numeradas: este quedó como "${sello}.html". Convendría ordenar esa carpeta.`,
      }
    }
  }
  return {
    error: `No guardé nada, y es a propósito: en esa carpeta ya hay un "${base}.html", las 98 copias numeradas ("${base}-2" … "${base}-99") y encima los nombres con sello de tiempo están ocupados. No me queda un nombre libre, y antes que pisarte un archivo prefiero avisarte. Ordená esa carpeta (o pedímelo con otro nombre) y te lo armo de nuevo.`,
  }
}

/**
 * FIX auditoría B12: antes se copiaba la biblioteca sólo `if (!existsSync(local))`.
 * Cuando la docente actualizaba Tecnia Bot, en su carpeta de trabajo seguía el bundle
 * VIEJO para siempre: la pieza nueva que el tool ya sabe dibujar salía como una caja
 * vacía, y el circuito parecía roto justo después de actualizar.
 */
function hayQueCopiar(origen: string, destino: string): boolean {
  if (!existsSync(destino)) return true
  try {
    const o = statSync(origen)
    const d = statSync(destino)
    return o.size !== d.size || o.mtimeMs > d.mtimeMs
  } catch {
    return true // si no podemos comparar, copiamos: es barato y la copia vieja es cara
  }
}

async function copiarBiblioteca(dir: string, bundle: string): Promise<void> {
  const bundleLocal = join(dir, "wokwi-bundle.js")
  if (hayQueCopiar(bundle, bundleLocal)) await Bun.write(bundleLocal, Bun.file(bundle))
  const extra = extraPath()
  const extraLocal = join(dir, "componentes-extra.js")
  if (existsSync(extra) && hayQueCopiar(extra, extraLocal)) await Bun.write(extraLocal, Bun.file(extra))
}

/**
 * Escribe el HTML y deja la biblioteca de piezas al lado.
 *
 * FIX auditoría B7: execute no tenía un solo try/catch. Con la carpeta de trabajo sin
 * permiso de escritura (o en OneDrive sincronizando, que es lo común en las netbooks
 * de la escuela) subía un ENOENT/EACCES crudo hasta el modelo, que improvisaba una
 * explicación. Un stack trace no le sirve a nadie; menos a una docente.
 */
async function guardarSalida(
  dir: string,
  base: string,
  html: string,
  explicito: boolean,
  bundle: string,
): Promise<{ archivo: string; avisos: string[] } | { error: string }> {
  try {
    const ruta = rutaDeSalida(dir, base, explicito)
    if ("error" in ruta) return ruta
    const { archivo, aviso } = ruta
    await Bun.write(archivo, html)
    await copiarBiblioteca(dir, bundle)
    return { archivo, avisos: aviso ? [aviso] : [] }
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    return {
      error: `No pude guardar el circuito en la carpeta "${dir}". Suele pasar cuando la carpeta no existe, es de sólo lectura, o está sincronizando con OneDrive/Drive. Probá abrir Tecnia Bot desde otra carpeta (el Escritorio anda siempre) y pedímelo de nuevo. Si seguís sin poder, esto es lo que dijo el sistema: ${detalle}`,
    }
  }
}

// ============================================================================
// EXPLICADOR DE PROTOBOARD — HTML interactivo para ENTENDER la placa de pruebas.
// No es un circuito con pines: es la placa misma. Tocás un agujero y se iluminan
// todos los que están unidos por dentro (el momento "ajá"). Más un ejemplo armado.
//
// NOTA TERMINOLOGICA: las descripciones de conectividad de mas abajo (leyenda,
// tooltip, aviso, tabla) NO usan "fila" ni "columna". El material de catedra
// usa esos dos terminos al reves entre si (lo que un texto llama fila el otro
// lo llama columna, y cada uno marca al otro como "el error tipico"), asi que
// cualquiera de las dos palabras termina contradiciendo a alguien. Ademas la
// orientacion de ESTE dibujo (el grupo de 5 conectados sale en horizontal, via
// la clase .pbx-fila de abajo) es arbitraria y no coincide con como el alumno
// ve la placa fisica en la mano. Por eso se describe por marcas fijas, que no
// dependen de como este girado el dibujo: "grupo de 5" (los agujeros unidos de
// un mismo lado del canal), "canal" (separa las dos mitades) y "buses" (los
// bordes, recorren toda la placa a lo largo).
// Los nombres internos (variable "filas", clase CSS "pbx-fila") se dejaron
// como estaban: son de layout puro (describen una fila visual del grid, cosa
// que es cierta) y no aparecen en ningun texto visible, asi que renombrarlos
// no corrige nada y solo suma riesgo en un archivo con 79 versiones publicadas.
// ============================================================================
function armarProtoboard(): Plantilla {
  const FILAS = 8
  const cols = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
  const hoyo = (grp: string) => `<span class="pbx-hole" data-grp="${grp}"></span>`
  const lado = (grp: string) => `<div class="pbx-holes">${[0, 1, 2, 3, 4].map(() => hoyo(grp)).join("")}</div>`

  // bus: 5 hoyos + canal + 5 hoyos, todos del MISMO grupo (riel continuo)
  const bus = (grp: string, clase: string, simbolo: string) =>
    `<div class="pbx-fila"><span class="pbx-rail ${clase}">${simbolo}</span>${lado(grp)}<span class="pbx-canal"></span>${lado(grp)}<span class="pbx-rail ${clase}">${simbolo}</span></div>`

  // filas numeradas: lado izq (a-e) un grupo, lado der (f-j) otro grupo, separados por el canal
  let filas = ""
  for (let n = 1; n <= FILAS; n++) {
    filas += `<div class="pbx-fila"><span class="pbx-num">${n}</span>${lado(`rL${n}`)}<span class="pbx-canal"></span>${lado(`rR${n}`)}<span class="pbx-num">${n}</span></div>`
  }
  const header = `<div class="pbx-hdr">${cols.slice(0, 5).map((c) => `<span>${c}</span>`).join("")}<span class="pbx-gap"></span>${cols.slice(5).map((c) => `<span>${c}</span>`).join("")}</div>`

  const escena = `
<style>
  .pbx-cab{display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;}
  .pbx-board{background:#f3efe6;border:1px solid #d8d2c4;border-radius:12px;padding:14px 18px;box-shadow:inset 0 0 0 2px #e8e2d6;}
  .pbx-fila{display:flex;align-items:center;gap:9px;margin:3px 0;}
  .pbx-rail{font:700 13px monospace;width:16px;text-align:center;}
  .pbx-rail.mas{color:#e74c3c;} .pbx-rail.menos{color:#2980b9;}
  .pbx-num{font:600 12px monospace;color:#9a9182;width:16px;text-align:center;}
  .pbx-holes{display:flex;gap:8px;}
  .pbx-canal{width:24px;align-self:stretch;background:repeating-linear-gradient(90deg,#d8d0bd 0 5px,transparent 5px 10px);border-radius:2px;}
  .pbx-gap{width:24px;display:inline-block;}
  .pbx-hdr{display:flex;gap:8px;margin:0 0 4px 25px;font:600 11px monospace;color:#a39a89;}
  .pbx-hdr span{width:16px;text-align:center;}
  .pbx-hole{width:16px;height:16px;border-radius:50%;background:#c9cfd6;cursor:pointer;border:1px solid #b3bcc4;transition:transform .08s,box-shadow .08s,background .08s;}
  .pbx-hole:hover{background:#aeb6bd;}
  .pbx-hole.hl{background:#e67e22;box-shadow:0 0 9px #e67e22;border-color:#d35400;transform:scale(1.28);}
  .pbx-rail-mas-bg{}
  .pbx-msg{background:#fff4e5;border:1px solid #f0d9b8;border-radius:10px;padding:11px 15px;font-size:14px;color:#7a5c00;margin-top:14px;min-height:22px;}
  .pbx-ley{list-style:none;padding:0;margin:0;font-size:13.5px;max-width:310px;color:#34495e;}
  .pbx-ley li{margin:9px 0;line-height:1.4;}
  .pbx-chip{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:middle;margin-right:7px;}
</style>
<div class="pbx-cab">
  <div>
    ${header}
    <div class="pbx-board" id="pbxBoard">
      ${bus("busTopPlus", "mas", "+")}
      ${bus("busTopMinus", "menos", "−")}
      <div style="height:8px"></div>
      ${filas}
      <div style="height:8px"></div>
      ${bus("busBotMinus", "menos", "−")}
      ${bus("busBotPlus", "mas", "+")}
    </div>
  </div>
  <ul class="pbx-ley">
    <li><span class="pbx-chip" style="background:#e74c3c"></span><b>Buses + y −</b> (los bordes): recorren TODA la placa a lo largo. Acá llevás la alimentación (+) y la tierra (−) y las repartís a todo el circuito.</li>
    <li><span class="pbx-chip" style="background:#27ae60"></span><b>Grupos de 5 (a cada lado del canal):</b> los 5 agujeros de un mismo lado están unidos entre sí: los de a-e por un lado, los de f-j por el otro.</li>
    <li><span class="pbx-chip" style="background:#95a5a6"></span><b>El canal del medio:</b> separa los dos lados (a-e NO toca f-j). Ahí se montan los chips, a caballo.</li>
    <li>👆 <b>Tocá cualquier agujero</b> y mirá qué se ilumina: eso es lo que queda conectado entre sí por dentro.</li>
  </ul>
</div>
<div class="pbx-msg" id="pbxMsg">👆 Pasá el mouse (o tocá) por un agujero para ver qué agujeros están conectados entre sí por dentro.</div>`

  const animacion = `(() => {
    var board=document.getElementById('pbxBoard'), msg=document.getElementById('pbxMsg');
    if(!board) return;
    var holes=[].slice.call(board.querySelectorAll('.pbx-hole'));
    var DEF='👆 Pasá el mouse (o tocá) por un agujero para ver qué agujeros están conectados entre sí por dentro.';
    function nombre(g){
      if(g.indexOf('rL')===0) return 'el grupo marcado '+g.slice(2)+', lado a-e (a un lado del canal)';
      if(g.indexOf('rR')===0) return 'el grupo marcado '+g.slice(2)+', lado f-j (al otro lado del canal)';
      if(g==='busTopPlus'||g==='busBotPlus') return 'el bus + (positivo), de punta a punta';
      return 'el bus − (negativo/GND), de punta a punta';
    }
    function pintar(g){
      var n=0;
      holes.forEach(function(h){ var on=h.dataset.grp===g; h.classList.toggle('hl',on); if(on)n++; });
      msg.innerHTML='🔌 Estos <b>'+n+' agujeros</b> están unidos por dentro: <b>'+nombre(g)+'</b>. Lo que pinches en cualquiera de ellos, queda conectado a los demás.';
    }
    function limpiar(){ holes.forEach(function(h){h.classList.remove('hl');}); msg.innerHTML=DEF; }
    holes.forEach(function(h){
      h.addEventListener('mouseenter',function(){pintar(h.dataset.grp);});
      h.addEventListener('click',function(){pintar(h.dataset.grp);});
    });
    board.addEventListener('mouseleave',limpiar);
  })();`

  return {
    titulo: "🧰 La protoboard por dentro",
    sub: "tocá un agujero y mirá qué está conectado con qué — así se entiende la placa de pruebas",
    escena,
    aviso:
      "💡 <strong>La protoboard es tu mesa de trabajo:</strong> conectás componentes <strong>sin soldar</strong>, solo pinchando. El secreto es saber qué agujeros están unidos por dentro. ⚠️ El error más común: pensar que se conecta todo lo que queda ENFRENTADO a los dos lados del canal — no, lo que se une es el GRUPO DE 5 que está del MISMO lado del canal. Y nunca te olvides de llevar GND de tu placa al bus −.",
    tabla: `
      <tr><th>Zona de la protoboard</th><th>Qué agujeros se conectan</th><th>Para qué se usa</th></tr>
      <tr><td>Buses laterales (+ y −)</td><td>Toda la línea, de punta a punta</td><td>Repartir alimentación (+) y tierra (−)</td></tr>
      <tr><td>Grupos de 5 (centro)</td><td>Los 5 de un mismo lado del canal (a-e) o del otro (f-j)</td><td>Conectar las patas de los componentes</td></tr>
      <tr><td>Canal central</td><td>Nada — separa los dos lados</td><td>Montar chips (cada pata en su grupo)</td></tr>`,
    animacion,
    alto: 0,
    interactivo: true,
  }
}

function construirHTML(p: Plantilla, scriptSrc: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Tecnia Bot — ${p.titulo}</title>
<script src="${scriptSrc}"></script>
<script src="componentes-extra.js"></script>
<style>${ESTILO}</style>
</head>
<body>
<div class="hoja">
  <h1>${p.titulo} <span class="badge">${p.interactivo ? "✋ interactivo" : "▶ animado"}</span></h1>
  <div class="sub">Esquema de conexión — Tecnia Bot · piezas reales, ${p.sub}</div>
  <div class="escena"${p.alto && p.alto > 0 ? ` style="height:${p.alto}px"` : ` style="height:auto"`}>${p.escena}</div>
  <div class="aviso">${p.aviso}</div>
  <table>${p.tabla}</table>
</div>
<script>${p.animacion}</script>
</body>
</html>`
}

// Mapeo de cada preset → lista de componentes, para generarlos con el ARMADOR
// (layout de filas + cables CSS, prolijo) en vez del SVG viejo. Un solo sistema visual.
const PRESET_COMPONENTES: Record<string, string[]> = {
  "servo-esp32": ["servo"],
  "led-esp32": ["led"],
  "ultrasonico-esp32": ["ultrasonico"],
  "buzzer-esp32": ["buzzer"],
  "potenciometro-esp32": ["potenciometro", "led"], // interactivo: la perilla controla el LED
  "dht22-esp32": ["dht22"],
  "pir-esp32": ["pir"],
  "lcd-esp32": ["lcd"],
  "boton-esp32": ["boton", "led"], // interactivo: el botón enciende el LED
  "estacion-meteo": ["dht22", "lcd"],
  "alarma": ["pir", "buzzer", "led"],
  "semaforo": ["led", "led", "led"],
}

/**
 * Animación propia de un preset, para cuando la suma de las animaciones sueltas NO
 * representa el circuito que el preset promete.
 *
 * FIX auditoría B9: "semaforo" son tres LEDs, y cada LED trae su propia animación
 * (un setInterval de 600 ms). Los tres arrancaban en el mismo tick, así que el
 * "semáforo" eran tres luces parpadeando JUNTAS — que es exactamente lo que un
 * semáforo no hace. Encima el preset hermano `semaforo-protoboard` (plantilla hecha
 * a mano) sí hacía la secuencia bien: el mismo pedido daba dos cosas distintas según
 * qué palabra usara el docente. Los tiempos de acá son los MISMOS de esa plantilla,
 * a propósito: tienen que ser el mismo objeto contado dos veces, no dos objetos.
 */
const PRESET_ANIMACION: Record<string, (ids: string[]) => string> = {
  semaforo: (ids) => {
    // El ciclo de color del LED es rojo → amarillo → verde (ver attrs de `led`),
    // así que led0=rojo, led1=amarillo, led2=verde.
    const rojo = ids[0] ?? "", amarillo = ids[1] ?? "", verde = ids[2] ?? ""
    return `(() => {
      const R=document.getElementById('${rojo}'), A=document.getElementById('${amarillo}'), V=document.getElementById('${verde}');
      if(!R||!A||!V) return;
      // mismas fases y tiempos que plantilla-semaforo-protoboard.html
      const fases=[[false,false,true,2600],[false,true,false,900],[true,false,false,2600]];
      let i=0;
      (function tick(){ const f=fases[i]; R.value=f[0]; A.value=f[1]; V.value=f[2]; i=(i+1)%fases.length; setTimeout(tick,f[3]); })();
    })();`
  },
}

// Circuitos MONTADOS SOBRE UNA PROTOBOARD: plantillas HTML pre-armadas y validadas
// (viven como asset en tecniabot-web/, las copia el instalador). Para agregar un
// circuito nuevo sobre protoboard: sumás la plantilla ahí + una entrada acá.
const PLANTILLAS_PROTOBOARD: Record<string, { archivo: string; que: string }> = {
  "boton-led-protoboard": {
    archivo: "plantilla-boton-led-protoboard.html",
    que: "un ESP32 con un botón y un LED (con resistencia 220Ω). Apretás el botón rojo y el LED se enciende",
  },
  "semaforo-protoboard": {
    archivo: "plantilla-semaforo-protoboard.html",
    que: "un semáforo: tres LEDs (verde, amarillo, rojo) con sus resistencias 220Ω, encendiéndose en secuencia solos",
  },
}

export default tool({
  description: `ÚNICO método aprobado para generar cualquier circuito visual, esquema, diagrama animado o "circuito bonito" de Arduino/ESP32. Genera un HTML con piezas REALES (Wokwi Elements) y animación (el servo gira, el LED parpadea) que el alumno abre en el navegador SIN internet.

USALO SIEMPRE que pidan un circuito visual/animado/bonito/esquema/"para mostrar". NUNCA dibujes vos un SVG o HTML a mano: este tool ya tiene todo hecho, solo elegís el circuito.

⚠️ TODOS LOS PRESETS SON PARA ESP32. No hay ninguno de Arduino UNO todavía. Los pines que dibuja (GPIO 2, 4, 18...) NO existen en un UNO, y su tensión es 3,3 V contra los 5 V del UNO. Si el docente trabaja con un Arduino UNO, DECÍSELO antes de mostrarle el diagrama: "el esquema que te puedo dibujar es para ESP32; en el UNO los pines son otros". Nunca se lo muestres como si fuera el suyo.

Componentes sueltos: servo-esp32, led-esp32, ultrasonico-esp32, buzzer-esp32, dht22-esp32, pir-esp32, lcd-esp32.
INTERACTIVOS (el alumno controla con el mouse): potenciometro-esp32 (girá la perilla y cambia el brillo del LED), boton-esp32 (apretá el botón y se prende el LED).
Proyectos integradores (varios componentes): estacion-meteo (DHT22+LCD), alarma (PIR+buzzer+LED), semaforo (3 LEDs).
EXPLICADOR: circuito=protoboard genera un HTML interactivo para ENTENDER la protoboard/breadboard (tocás un agujero y se iluminan los que están conectados por dentro: filas, buses y canal central). Usalo cuando pidan ver/entender/cómo funciona el protoboard.
CIRCUITOS SOBRE PROTOBOARD (componentes reales pinchados en la placa + jumpers de colores): circuito=boton-led-protoboard (ESP32 + botón + LED, interactivo: apretás el botón y prende el LED) y circuito=semaforo-protoboard (3 LEDs verde/amarillo/rojo en secuencia de semáforo, animado). ⚠️ IMPORTANTE: si el pedido menciona "protoboard", "breadboard" o "placa de pruebas", usá SIEMPRE la versión -protoboard correspondiente, NO el esquema con cables (boton-esp32/semaforo).

ARMADOR LIBRE (combinaciones libres): si el pedido NO coincide con un preset (ej "ESP32 + 2 LEDs + potenciómetro + servo"), usá el arg 'componentes' con la lista separada por comas. Tipos: led, rgb-led, servo, stepper (motor paso a paso), motor (motor DC, va por driver), driver (ULN2003), potenciometro, joystick, buzzer, ultrasonico, dht22, ntc, pir, ldr, llama, sonido, ir (infrarrojo), tilt (inclinacion), lcd, oled, 7segmentos, neopixel, mpu6050 (acelerometro), teclado, boton, relay, bomba, valvula (electrovalvula), higrometro, lluvia, bmp180 (presion), lampara, calefactor. GPIO opcional con dos puntos: "led:2, led:4". El motor asigna pines, dibuja cables y combina animaciones solo. De 1 a 6 componentes.

PROYECTOS DEL INET: para riego usá "higrometro, relay, bomba" (movés la humedad y se enciende el riego); tanques "ultrasonico, relay, bomba"; calefacción "dht22, relay, calefactor"; lumínico "ldr, pir, relay, lampara"; estación meteo "dht22, lluvia, bmp180, lcd". Los actuadores de potencia (bomba, válvula, lámpara, calefactor, motor, stepper) van SIEMPRE por un relé o driver, nunca directos al ESP32: si te olvidás de incluirlo, el tool lo agrega solo y te avisa qué agregó (contáselo al docente, es parte de la explicación).`,
  args: {
    circuito: tool.schema
      .enum(["servo-esp32", "led-esp32", "ultrasonico-esp32", "buzzer-esp32", "potenciometro-esp32", "dht22-esp32", "pir-esp32", "lcd-esp32", "boton-esp32", "estacion-meteo", "alarma", "semaforo", "protoboard", "boton-led-protoboard", "semaforo-protoboard"])
      .optional()
      .describe("Preset validado. Usalo si el pedido coincide con uno de la lista. 'protoboard' genera un EXPLICADOR interactivo de la placa de pruebas (tocás un agujero y se iluminan los conectados) — usalo cuando pidan entender/ver el protoboard o breadboard. Para combinaciones libres usá 'componentes'."),
    componentes: tool.schema
      .string()
      .optional()
      .describe("ARMADOR LIBRE: lista de componentes separada por comas, ej 'led, led, potenciometro, servo'. Tipos: led, rgb-led, servo, stepper (motor paso a paso), motor (motor DC, va por driver), driver (ULN2003), potenciometro, joystick, buzzer, ultrasonico, dht22, ntc, pir, ldr, llama, sonido, ir (infrarrojo), tilt (inclinacion), lcd, oled, 7segmentos, neopixel, mpu6050 (acelerometro), teclado, boton, relay, bomba, valvula (electrovalvula), higrometro, lluvia, bmp180 (presion), lampara, calefactor. GPIO opcional con dos puntos: 'led:2, led:4'. El motor calcula posiciones y cables solo."),
    nombre_archivo: tool.schema
      .string()
      .optional()
      .describe("Nombre del archivo HTML (sin extensión). Por defecto usa el nombre del circuito."),
    umbral: tool.schema
      .number()
      .optional()
      .describe("SOLO para armador libre con un sensor + actuador (ej: dht22+led): el valor a partir del cual el actuador se activa. Ej: si piden 'que el LED prenda a 20 grados', pasá umbral=20. Sin esto usa el default del sensor (temperatura 35, distancia 20cm, etc.). Se muestra en pantalla ('se activa con ≥ 20 °C')."),
    abrir: tool.schema
      .boolean()
      .optional()
      .describe("POR DEFECTO NO SE ABRE NADA (default: false). Pasá true SOLO si el docente pidió verlo ahora —«mostrámelo», «abrilo», «quiero verlo»—. Si no lo pidió, dejalo sin pasar y ofrecéselo: abrir una ventana que nadie pidió le tapa lo que estaba haciendo."),
  },
  async execute(args, ctx) {
    /*
     * POR DEFECTO NO SE ABRE, y esto cambió después de verlo en uso.
     *
     * Antes abría el navegador en CADA pedido. La idea era buena --el docente no
     * técnico no tiene que buscar el archivo ni hacer doble clic-- pero en la
     * práctica una ventana que salta sola cada vez que preguntás algo interrumpe
     * lo que estabas haciendo. El reporte fue textual: "cada vez que le pido algo
     * me abre esto, toda una desprolijidad".
     *
     * Ahora el bot genera, cuenta en una línea qué se ve, y OFRECE abrirlo. Es la
     * misma regla que ya rige para el código: hacer y ofrecer, no imponer.
     */
    const abrir = args.abrir === true
    const bundle = bundlePath()
    if (!existsSync(bundle)) {
      return "No encontré la biblioteca de piezas (wokwi-bundle.js). Reinstalá Tecnia Bot con el instalador para que copie la biblioteca visual."
    }
    // El navegador bloquea que un file:// cargue otro file:// de otra carpeta (security origin).
    // Por eso copiamos el bundle AL LADO del HTML y lo referenciamos con ruta relativa.
    const scriptSrc = "wokwi-bundle.js"

    // ¿el nombre lo eligió alguien, o lo ponemos nosotros? Cambia la política de pisado
    // (ver rutaDeSalida): el default es determinista y pisa; el explícito se versiona.
    const explicito = !!(args.nombre_archivo && args.nombre_archivo.trim())
    // Todo lo que el docente TIENE que saber porque no le dimos EXACTAMENTE lo que pidió.
    // Van al final de la respuesta, nunca en silencio (FIX auditoría A/B3/B5/B11).
    const notas: string[] = []
    let umbralAplicado = false
    // FIX auditoría D: el nombre final NO se sabe hasta después de guardar (si el
    // archivo ya existía, el de verdad es "…-2.html"). Se guarda el pedido y el aviso
    // se arma al final, con el nombre que quedó de verdad.
    let pedidoNoUsado: string | null = null

    // Cada rama arma el HTML y decide cómo se lo contamos; el guardado es uno solo
    // para todas (FIX auditoría B5/B7/B12: antes había tres copias de esa lógica).
    let html: string
    let base: string
    let encabezado: string
    let cierre: string
    // La tabla de pines en texto: el prompt del agente le ORDENA al modelo describir
    // las conexiones "leyendo la tabla que muestra el propio circuito", y hasta acá la
    // respuesta no traía ninguna tabla (FIX auditoría A).
    let conexiones: string[] = []

    if (args.componentes && args.componentes.trim()) {
      const { pedidos: pedidoCrudo, avisos: avisosParseo } = parsearComponentes(args.componentes)
      notas.push(...avisosParseo)
      if (pedidoCrudo.length < 1 || pedidoCrudo.length > 6) {
        return "El armador libre maneja de 1 a 6 componentes. Si son más, dividilo en dos circuitos."
      }
      const desconocidos = pedidoCrudo.filter((p) => !COMPONENTES[normalizarTipo(p.tipo)])
      if (desconocidos.length) {
        return `No conozco: ${desconocidos.map((d) => d.tipo).join(", ")}. Tengo: ${Object.keys(COMPONENTES).join(", ")}.`
      }

      // Seguridad eléctrica ANTES que el dibujo: nada de potencia colgado del GPIO.
      const { pedidos, avisos: avisosMando } = inyectarMando(pedidoCrudo)
      notas.push(...avisosMando)
      if (pedidos.length > 6) {
        return `Para que el circuito sea seguro le tengo que sumar un relé (o un driver): los actuadores de potencia nunca van directo al ESP32. Con eso pasa de 6 componentes, que es mi tope. Sacá uno y lo armo — por ejemplo: "${sugerenciaQueEntra(pedidoCrudo)}".`
      }

      // Sin componentes-extra.js las piezas pb-* no se dibujan: mejor no generar nada.
      const falta = faltanPiezasDibujadas(pedidos)
      if (falta) return falta

      const r = armarCircuito(pedidos, args.umbral)
      umbralAplicado = r.umbralAplicado
      // El umbral se aplicó, pero no el que se pidió: eso también se cuenta.
      if (r.avisoUmbral) notas.push(r.avisoUmbral)
      // Pines rechazados, reasignados, pool agotado, choque de direcciones I2C: todo
      // eso vivía SOLO en la hoja. Ahora también llega al chat (FIX auditoría A/F).
      notas.push(...r.notas)
      conexiones = r.conexiones
      const nombres = pedidos.map((p) => componenteDe(p.tipo).etiqueta).join(" + ")
      html = construirHTML(
        {
          titulo: `🔧 ${nombres} + ESP32`,
          sub: "armado libre — piezas reales conectadas al ESP32",
          escena: r.escena,
          aviso: r.aviso,
          tabla: r.tabla,
          animacion: r.animacion,
          alto: r.alto,
          interactivo: r.interactivo,
        },
        scriptSrc,
      )
      const nom = nombreSeguro(args.nombre_archivo, `circuito-armado-${pedidos.map((p) => normalizarTipo(p.tipo)).join("-")}`)
      pedidoNoUsado = nom.pedidoNoUsado
      base = nom.nombre
      /*
       * FIX auditoría B: un componente sin pin NO se anuncia como "Listo!".
       *
       * "teclado, led, joystick, joystick, ldr, ntc" son 6 componentes, o sea un pedido
       * perfectamente legal, y el pool analógico no alcanza para el último: el NTC sale
       * con "GPIO?" en la hoja. Hasta acá el chat contestaba «Listo! Generé el circuito
       * visual y animado.» sin un solo ⚠️.
       *
       * Que el aviso llegue al chat (arriba) es la mitad del arreglo. La otra mitad es
       * ésta: un circuito al que le falta un pin NO está terminado, y el encabezado es
       * lo primero —a veces lo único— que la docente lee. Anunciar como éxito algo que
       * después se cablea es exactamente la categoría de error que no nos podemos
       * permitir en este tool.
       *
       * Se genera igual y no se corta: los otros cinco componentes están bien y la hoja
       * sirve. Lo que cambia es que se dice.
       */
      encabezado =
        r.sinPin.length > 0
          ? `Generé el circuito, pero quedó INCOMPLETO: me quedé sin pines libres para ${r.sinPin.join(" y ")}, así que en la hoja ${r.sinPin.length > 1 ? "esas filas dicen" : "esa fila dice"} "GPIO?" en vez de un número. NO lo cablees así: sacá un componente de la lista y te lo armo completo.`
          : "Listo! Generé el circuito visual y animado."
      cierre = `Vas a ver las piezas reales conectadas con cables de colores, y la animación funcionando. Todo sin internet.
(Se copió la biblioteca de piezas al lado del archivo — no la borres.)`
    } else if (args.circuito === "protoboard") {
      // Caso especial: NO es un circuito con pines, es la placa misma explicada.
      const nom = nombreSeguro(args.nombre_archivo, "protoboard-explicador")
      pedidoNoUsado = nom.pedidoNoUsado
      base = nom.nombre
      html = construirHTML(armarProtoboard(), scriptSrc)
      encabezado = "Listo! Generé el explicador interactivo de la protoboard."
      cierre =
        "Tocá (o pasá el mouse por) cualquier agujero y vas a ver iluminarse TODOS los que están conectados con él por dentro. Así se entiende de una qué se une con qué: las filas, los buses y el canal del medio."
    } else if (args.circuito && PLANTILLAS_PROTOBOARD[args.circuito]) {
      // Circuito MONTADO sobre una protoboard: plantilla validada (componentes Wokwi
      // reales pinchados en la placa + jumpers). Se lee del asset instalado.
      const def = PLANTILLAS_PROTOBOARD[args.circuito]
      const plantillaFile = def ? plantillaPath(def.archivo) : ""
      if (!def || !existsSync(plantillaFile)) {
        return "No encontré la plantilla del circuito en protoboard. Reinstalá Tecnia Bot con el instalador."
      }
      const nom = nombreSeguro(args.nombre_archivo, args.circuito)
      pedidoNoUsado = nom.pedidoNoUsado
      base = nom.nombre
      try {
        html = readFileSync(plantillaFile, "utf8")
      } catch {
        return "No pude leer la plantilla del circuito en protoboard (está instalada pero no se deja leer). Reinstalá Tecnia Bot con el instalador."
      }
      encabezado = `Listo! Generé un circuito montado sobre una protoboard: ${def.que}.`
      cierre =
        "Vas a ver el circuito armado en la placa de pruebas, con los componentes reales (Wokwi) y los cables de colores conectados a los agujeros."
    } else if (args.circuito) {
      // Los presets ahora se generan con el ARMADOR (filas + cables CSS, prolijo).
      const tipos = PRESET_COMPONENTES[args.circuito]
      if (!tipos) {
        return `No tengo ese circuito todavía. Disponibles: ${Object.keys(PRESET_COMPONENTES).join(", ")}.`
      }
      const pedidos = tipos.map((t) => ({ tipo: t }))
      // Hoy ningún preset usa piezas pb-*, pero el día que se agregue uno (riego,
      // calefacción) el guard tiene que estar acá también: es la misma página vacía.
      const faltaPreset = faltanPiezasDibujadas(pedidos)
      if (faltaPreset) return faltaPreset
      const r = armarCircuito(pedidos)
      // Un preset no puede tener pines pedidos a mano, pero SÍ puede chocar direcciones
      // I2C o agotar el pool el día que se agregue uno grande. El canal es el mismo.
      notas.push(...r.notas)
      conexiones = r.conexiones
      const nombres = pedidos.map((p) => componenteDe(p.tipo).etiqueta).join(" + ")
      // Algunos presets tienen coreografía propia (el semáforo es una secuencia, no
      // tres LEDs parpadeando por su cuenta). FIX auditoría B9.
      const coreografia = PRESET_ANIMACION[args.circuito]
      const ids = pedidos.map((p, i) => `${normalizarTipo(p.tipo)}${i}`)
      html = construirHTML(
        {
          titulo: `🔧 ${nombres} + ESP32`,
          sub: "piezas reales conectadas al ESP32",
          escena: r.escena,
          aviso: r.aviso,
          tabla: r.tabla,
          animacion: coreografia ? coreografia(ids) : r.animacion,
          alto: r.alto,
          interactivo: r.interactivo,
        },
        scriptSrc,
      )
      const nom = nombreSeguro(args.nombre_archivo, `circuito-${args.circuito}`)
      pedidoNoUsado = nom.pedidoNoUsado
      base = nom.nombre
      encabezado = "Listo! Generé el circuito visual y animado."
      cierre = `Vas a ver las piezas reales conectadas con cables de colores, y la animación funcionando. Todo sin internet.
(Se copió la biblioteca de piezas al lado del archivo — no la borres.)`
    } else {
      return "Decime qué circuito armar: un preset (arg 'circuito') o una lista libre (arg 'componentes', ej 'led, servo')."
    }

    if (args.umbral != null && !umbralAplicado) {
      notas.push(
        `El umbral (${args.umbral}) quedó sin usar: sólo se aplica en el armador libre cuando hay un sensor simulable + un actuador (ej "dht22, led" o "higrometro, relay, bomba"). En este circuito no hay dónde aplicarlo.`,
      )
    }

    const guardado = await guardarSalida(ctx.directory, base, html, explicito, bundle)
    if ("error" in guardado) return guardado.error

    const archivo = guardado.archivo
    /*
     * FIX auditoría D: este aviso se arma ACÁ y no en nombreSeguro, y el orden importa.
     *
     * Antes nombreSeguro afirmaba el nombre final ("lo guardé como X.html") ANTES de que
     * se decidiera, y si el archivo ya existía rutaDeSalida lo versionaba a "X-2.html".
     * Salían los dos avisos juntos, contradiciéndose, en la misma respuesta:
     *   ⚠️ No pude usar "電路図" … lo guardé como "circuito-led-esp32.html".
     *   ⚠️ Ya había un "circuito-led-esp32.html" … este quedó como "…-2.html".
     * La docente que lee la primera línea abre el archivo VIEJO, que es de otra clase.
     * Ahora el nombre sale de `archivo`, que es el que se escribió de verdad.
     */
    if (pedidoNoUsado) {
      notas.push(
        `No pude usar "${pedidoNoUsado}" como nombre de archivo (van solo letras sin tilde, números, guiones y puntos): lo guardé como "${basename(archivo)}".`,
      )
    }
    notas.push(...guardado.avisos)

    const abierto = abrir && abrirEnNavegador(archivo)
    /*
     * FIX auditoría A: la tabla de pines vuelve al modelo.
     *
     * opencode/agent/tecnia-bot.md le ordena al modelo "describí las conexiones leyendo
     * la tabla que muestra el propio circuito — NO inventes pines", y hasta acá la
     * respuesta del tool no traía ninguna tabla. Le pedíamos leer algo que nunca
     * recibía: o se callaba, o inventaba. Y lo que el modelo dice en el chat es lo que
     * el pibe cablea, igual que el dibujo.
     *
     * Va DESPUÉS del cierre y ANTES de los ⚠️, que cierran siempre la respuesta.
     */
    const tablaPines = conexiones.length
      ? "\n\n**Conexiones (ésta es la tabla que dibuja la hoja — usá estos pines, no inventes otros):**\n" +
        conexiones.map((c) => "- " + c).join("\n")
      : ""
    // El `.replace` no es cosmético: varios motivos de `motivoGpioRechazado` ya traen
    // su propio "⚠️ " adelante (nacieron para la hoja, donde no hay prefijo), así que
    // sin esto la línea salía «⚠️ ⚠️ GPIO34 es SOLO ENTRADA…». Un aviso que se ve mal
    // formateado se lee como un error del programa, no como algo que hay que atender.
    const aclaraciones = notas.length
      ? "\n\n" + notas.map((n) => "⚠️ " + n.replace(/^⚠️\s*/, "")).join("\n")
      : ""
    return `${encabezado}

${abierto
  ? `**Te lo abrí en el navegador.** (Si no apareció, doble clic en el archivo: \`${comoUrl(archivo)}\`)`
  : `**Abrilo en tu navegador (doble clic o pegá esto):**\n${comoUrl(archivo)}`}

${cierre}${tablaPines}${aclaraciones}`
  },
})
