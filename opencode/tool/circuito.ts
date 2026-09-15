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

/*
 * El trazador de cables: dibuja cada cable del agujero REAL del header al pin REAL de
 * la pieza, leyendo `pinInfo` en el navegador del docente.
 *
 * Va en un archivo aparte y NO inline, por tres motivos que valen para cualquier asset
 * de estos: inline hay que escaparlo, no se puede testear, y se duplica en cada HTML
 * que el tool genera. Acá se testea (`tests/cables.test.mjs`) y se copia una vez.
 *
 * Es OPCIONAL a propósito: si el archivo no está, la hoja sale con los cables CSS de
 * siempre. Una instalación vieja no se rompe, se queda sin la mejora.
 */
function cablesPath(): string {
  const cfg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(cfg, "opencode", "tecniabot-web", "cables.js")
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
  /* layout del ARMADOR LIBRE: la placa a la izquierda + una fila por componente, con cables CSS.
     Los 230px son el FALLBACK (la medida del ESP32): el ancho real lo pisa inline el
     armador, porque cada placa ocupa lo suyo. Y ojo con la trampa, que costó encontrarla:
     transform:scale() NO cambia la caja de layout. El ESP32 reserva 106,6px aunque se
     pinte a 133, y por eso acá le sobraba lugar; el UNO reserva 274,3px de verdad y en
     230px se monta 22px sobre la columna de conexiones. Con overflow:hidden en .hoja no
     se ve salir: se ve el texto pisado, que es peor porque parece un dibujo válido. */
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

// ============================================================================
// LAS PLACAS — qué pin existe, cómo se llama, y a qué riel llega cada cable.
//
// Hasta acá este archivo dibujaba UNA placa. Los pines eran números pelados (4,
// 33), el prefijo "GPIO" estaba escrito a mano en los 37 roles, y los destinos
// fijos eran literales ("VIN (5V)", "GPIO21"). Con una sola placa eso alcanzaba.
//
// Con dos no: las escuelas técnicas argentinas usan Arduino UNO con Sensor Shield
// más que ESP32, y hasta hoy el docente que pedía SU circuito recibía uno de otra
// placa, con pines que en la suya no existen. Cada uno de esos tres atajos —el
// número pelado, el prefijo a mano, el destino literal— es una forma distinta de
// dibujar la placa equivocada, así que los tres se van juntos.
// ============================================================================

/**
 * El banco al que pertenece un pin. NO es decoración: es parte de su IDENTIDAD.
 *
 * En el ESP32 hay un solo banco ("GPIO") y el número alcanza para nombrar el pin.
 * Por eso el pool digital y el analógico podían compartir un `Set<number>`: el
 * GPIO33 está en los dos porque ES EL MISMO PIN, y el Set evitaba repartirlo dos
 * veces. Una auditoría generó 40.169 circuitos y confirmó cero colisiones.
 *
 * En un Arduino UNO eso es FALSO. D4 y A4 son dos pines distintos, en dos filas
 * distintas de la placa, que apenas comparten el número 4. Con pools numéricos,
 * asignar D4 bloquearía A4 y el tool diría "no quedan analógicos" con A4 libre.
 * Peor todavía: asignar A5 bloquearía D5, que es PWM, que es donde va el servo.
 *
 * Por eso un pin es {banco, n} y el Set de ocupados se lleva por `clavePin`.
 */
type Banco = "GPIO" | "D" | "A"
interface PinId {
  banco: Banco
  n: number
}
/** La clave con la que un pin entra al Set de ocupados. "D4" y "A4" son distintas. */
const clavePin = (p: PinId): string => `${p.banco}${p.n}`
const mismoPin = (a: PinId, b: PinId): boolean => a.banco === b.banco && a.n === b.n

/**
 * Los destinos que NO son un pin de señal: los rieles de la placa.
 *
 * Antes eran literales adentro de cada componente (`destino: "VIN (5V)"`,
 * `destino: "GPIO21"`): la placa escrita a mano en 27 lugares. El componente ahora
 * dice a QUÉ riel va —una idea que vale para cualquier placa— y cada placa dice
 * cómo se llama ese riel en ella.
 *
 * - `VLOGICA` es la alimentación propia de la placa, la que le da de comer a los
 *   módulos de lógica y la que le sirve de referencia al ADC: 3.3V en el ESP32,
 *   5V en el UNO. Un módulo analógico alimentado con OTRA tensión que la del ADC
 *   lee mal aunque el cable esté bien puesto, así que esto no es cosmético.
 * - `V3` es 3,3 V DE VERDAD: el módulo lo pide sí o sí, esté en la placa que esté
 *   (el OLED, el MPU6050 y el BMP180 son de 3,3 V en las dos).
 * - `V5` son 5 V para un módulo de potencia/5 V (servo, LCD, NeoPixel).
 *
 * Si una placa no tiene ese riel, su valor es `null` y el tool se NIEGA a dibujar.
 * Un cable que termina en la nada es peor que un "no puedo": se ve perfecto.
 */
type Riel = "V5" | "V3" | "VLOGICA" | "GND" | "SDA" | "SCL"

type PlacaId = "esp32" | "uno"

interface Placa {
  id: PlacaId
  /** Como se la nombra delante del docente: "ESP32 DevKit", "Arduino UNO". */
  etiqueta: string
  /** El custom element del bundle de Wokwi que la dibuja. */
  tag: string
  /**
   * `transform:scale()` de la pieza. MEDIDO en Chrome sobre el bundle real, no
   * estimado: el ESP32 mide 106,6 × 208,3 px naturales y el UNO 274,3 × 205,6.
   * El ESP32 se pinta a 1.25 (133 px) desde siempre; el UNO ya entra a 1.0.
   */
  escala: number
  /**
   * Ancho en px de la columna de la placa en `.circuito-libre`.
   *
   * OJO, que es la parte contraintuitiva: `transform:scale()` NO cambia la caja de
   * layout. El ESP32 reserva sus 106,6 px aunque se pinte a 133, y por eso entraba
   * en la columna de 230 px del CSS con 48 px de aire a cada lado. El UNO reserva
   * 274,3 px de verdad: en esa misma columna se monta 22 px SOBRE la columna de
   * conexiones y le pisa el texto (`.hoja` tiene overflow:hidden, así que no se
   * ve salir: se ve encimado). Achicarlo a 0.78 lo metería adentro, pero lo
   * dejaría a 3,0 px/mm contra los 4,7 px/mm del ESP32 — 36% menos letra justo en
   * la placa que más serigrafía tiene. Se ensancha la columna, no se achica la
   * placa: 290 px deja 7,8 px de aire por lado y le saca a las filas 60 px de 730
   * (un 8%), sobre una columna `minmax(0,1fr)` con el cable elástico.
   */
  anchoColumna: number
  poolDigital: PinId[]
  poolAnalogico: PinId[]
  /**
   * Los pines que hacen PWM, cuando NO son todos.
   *
   * `undefined` significa "cualquier salida de esta placa hace PWM" (el ESP32 lo
   * resuelve por `ledc`), y entonces un pin que pide PWM sale del pool digital
   * como cualquier otro: nada cambia.
   */
  poolPwm?: PinId[]
  i2c: { sda: PinId; scl: PinId }
  riel: Record<Riel, string | null>
  /** El tope de `analogRead`: 4095 en el ESP32, 1023 en el UNO. */
  adcMax: number
  /** La resistencia en serie de un LED. 220Ω en las dos (decisión del producto). */
  resistenciaLed: string
  /** Cómo se escribe el aviso de "me quedé sin pines" para cada pool. */
  nombreDePool: { digital: string; analogico: string }
  /**
   * El aviso general de 5V de la hoja, o null si en esta placa no significa nada.
   * En el UNO TODO es de 5V: repetirlo sería ruido, y nombrar "VIN" sería mentir.
   */
  avisoCincoVolt: string | null
  /** "GPIO4" · "D4" · "A0". El prefijo lo pone la placa, no el rol. */
  etiquetaPin(p: PinId): string
  /**
   * El MISMO pin, pero como lo llama la PIEZA de Wokwi. `null` = no lo expone.
   *
   * `etiquetaPin` es para el ojo del docente; ésta es para el navegador. Hoy los
   * cables salen de una barra gris al costado de la placa: el dibujo no le dice
   * al pibe dónde pinchar. La pieza publica `el.pinInfo` con la coordenada de
   * cada agujero del header, así que para anclar el cable al pin de verdad sólo
   * falta el NOMBRE con el que preguntarle — y los nombres NO coinciden con los
   * nuestros, de forma distinta en cada placa (ver NOMBRES DE WOKWI, más abajo).
   *
   * `null` no es un error ni un caso a tapar con una suposición: es "esta pieza
   * no saca ese pin al header con un nombre que podamos nombrar". Un cable
   * anclado a un nombre inventado se dibuja igual de prolijo y va al agujero
   * equivocado, que es PEOR que la barra gris de hoy. Ante `null`, el que
   * dibuje deja ese cable como está.
   */
  pinWokwi(p: PinId): string | null
  /**
   * El riel, como lo llama la pieza de Wokwi. `null` = esta placa no lo tiene.
   *
   * `ref` es el pin de SEÑAL del mismo componente, y no es decorativo: en
   * NINGUNA de las dos placas existe un pin llamado `GND`. El UNO tiene tres
   * masas y el ESP32 dos, en headers distintos, así que "cuál es la masa" sólo
   * tiene respuesta EN RELACIÓN A ALGO. Ver LAS MASAS, más abajo.
   */
  rielWokwi(r: Riel, ref?: PinId | null): string | null
  /**
   * Por qué NO se puede usar el pin que pidió el usuario ("led:34"), o null.
   *
   * Es un MÉTODO de la placa y no una tabla compartida a propósito. En el ESP32
   * son cinco reglas con cinco mensajes distintos (flash, strapping, solo-entrada,
   * UART, existencia) y TRES de esos conceptos no existen en el UNO: un ATmega328P
   * no tiene flash SPI externa colgada de pines, ni pines de strapping, ni pines
   * de solo entrada. Una tabla con columnas vacías para media placa no es una
   * abstracción, es un formulario.
   */
  motivoRechazo(p: PinId, clase: ClasePin, etiqueta: string): string | null
  /**
   * El pin se puede usar, pero hay algo que conviene saber. Va SÓLO a la hoja.
   *
   * No entra al canal del chat a propósito (ver `asignarGpios`): ese pin SÍ se dio
   * y funciona, es una sugerencia. Si el chat avisa de todo, la docente aprende a
   * saltearse los ⚠️ y el aviso que sí importa deja de existir.
   */
  notaDePin?(p: PinId): string | null
}

const pinD = (n: number): PinId => ({ banco: "D", n })
const pinA = (n: number): PinId => ({ banco: "A", n })
const pinG = (n: number): PinId => ({ banco: "GPIO", n })

// ── ESP32 DevKit ────────────────────────────────────────────────────────────
//
// Estas constantes se quedan SIN prefijo de placa (POOL_DIGITAL, GPIO_VALIDOS…)
// aunque las del UNO sí lo lleven, y no es un descuido: tests/circuitos-visuales
// las lee POR NOMBRE del código fuente para defender la regla de GPIO16/17 (el
// pool no los reparte, pero la ficha de semaforización los pide, y el prompt tiene
// que explicar esa excepción). Además "GPIO" ya es vocabulario del ESP32, así que
// el nombre igual dice de qué placa habla.
//
// FIX auditoría #1/#3/#10: GPIO seguros primero. Sin 12 (strapping peligroso),
// sin 16/17 (PSRAM). GPIO2 (LED onboard + strapping) y 15 al final, bajo riesgo.
export const POOL_DIGITAL = [4, 5, 18, 19, 23, 25, 26, 27, 33, 13, 14, 15, 2]
const POOL_ANALOGICO = [34, 35, 36, 39, 32, 33]

// Validación de GPIO manual (el alumno puede forzar un pin con "led:5").
// GPIOs que EXISTEN en el ESP32 DevKit.
export const GPIO_VALIDOS = new Set([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39])
// GPIO6–11 están cableados a la memoria flash SPI: usarlos CUELGA/rompe la placa.
export const GPIO_FLASH = new Set([6, 7, 8, 9, 10, 11])
// Pines "strapping": funcionan, pero pueden complicar el arranque si tienen algo conectado.
export const GPIO_STRAPPING = new Set([0, 2, 12, 15])
// FIX auditoría B4: GPIO34/35/36/39 NO tienen driver de salida (son ADC/entrada pura)
// y TAMPOCO tienen pull-up/pull-down interno. O sea: no sirven ni para encender algo
// ni para un botón con INPUT_PULLUP. "led:34" se aceptaba sin chistar y el LED no
// prendía nunca — y el alumno revisa el cable, la resistencia y la soldadura antes de
// sospechar del pin, porque el diagrama se lo dio el bot.
export const GPIO_SOLO_ENTRADA = new Set([34, 35, 36, 39])
// GPIO1 (TX) y GPIO3 (RX) van al chip USB-serie de la placa: con algo colgado ahí, la
// carga del sketch falla y el Monitor Serie escupe basura. Clase perdida buscando por qué
// "no anda el Arduino" cuando el circuito estaba bien.
export const GPIO_UART_USB = new Set([1, 3])

// ── Arduino UNO ─────────────────────────────────────────────────────────────
// Los digitales son D0-D13 (skills/arduino/SKILL.md:27). El orden del pool NO es
// el orden de la placa, es el de menor riesgo primero:
//   1º los digitales pelados (2, 4, 7, 8, 12): no le quitan nada a nadie;
//   2º los PWM (3, 5, 6, 9, 10, 11): entran recién cuando no queda otra, para no
//      gastar en un LED el pin que el servo necesita sí o sí;
//   3º D13, D0 y D1 al final — igual que hoy el GPIO2 del ESP32 — porque entran al
//      pool por decisión del producto pero con un pero, que cuenta `notaDePin`.
const UNO_POOL_DIGITAL = [2, 4, 7, 8, 12, 3, 5, 6, 9, 10, 11, 13, 0, 1]
// PWM: 3, 5, 6, 9, 10, 11 (skills/placas/SKILL.md:130 + skills/arduino/SKILL.md:29).
// Confirmado por segunda vía, sin copiarse: la serigrafía de la pieza wokwi-arduino-uno
// del bundle dice «13 · 12 · ~11 · ~10 · ~9 · 8 | 7 · ~6 · ~5 · 4 · ~3 · 2 · TX→1 · RX←0».
const UNO_POOL_PWM = [3, 5, 6, 9, 10, 11]
// A0-A5, analogRead 0-1023 (skills/placas/SKILL.md:129). A4 y A5 van últimas porque
// son el bus I2C (SDA/SCL): un sensor analógico cualquiera no tiene por qué gastarlas.
const UNO_POOL_ANALOGICO = [0, 1, 2, 3, 4, 5]

// ════════════════════════════════════════════════════════════════════════════
// NOMBRES DE WOKWI — el mapeo entre cómo llamamos al pin y cómo lo llama la pieza
// ════════════════════════════════════════════════════════════════════════════
//
// Acá se hardcodea EL NOMBRE, y NADA MÁS que el nombre. La coordenada del pin NO
// vive en este archivo y no tiene que llegar nunca: los cables se van a dibujar
// en el navegador de la docente preguntándole a la pieza en vivo por
// `el.pinInfo`, que es quien sabe dónde cae cada agujero. Si alguna vez ves un
// `x` o un `y` en este bloque, alguien se fue de alcance.
//
// LOS NOMBRES NO COINCIDEN, y de forma distinta en cada placa:
//
//   nosotros          Wokwi
//   ────────          ─────
//   GPIO13            `D13`        (ESP32: cambia el prefijo)
//   D2                `"2"`        (UNO digital: el número PELADO, sin la D)
//   A0                `A0`         (UNO analógico: la única que coincide)
//   5V                `5V`         (UNO: coincide)
//   3.3V              `3.3V`       (UNO: coincide) … pero en el ESP32 es `3V3`
//   GND               NO EXISTE    (ninguna de las dos tiene un pin así)
//
// Fuente: `docs/wokwi-pinout-dump.md`, medido sobre la pieza real del bundle
// (`opencode/tecniabot-web/wokwi-bundle.js`). El test NO copia esta tabla: vuelve
// a extraer los nombres DEL BUNDLE y compara contra lo de acá. Un test que
// compara el mapeo contra una copia del mapeo no prueba nada; la fuente tiene
// que ser externa, o el día que Wokwi renombre un pin al actualizar el bundle
// nos enteramos por la pantalla de la docente.
//
// ── LAS MASAS ───────────────────────────────────────────────────────────────
//
// No existe ningún pin llamado `GND`. El UNO tiene TRES (`GND.1` en el header de
// arriba, `GND.2` y `GND.3` en el de abajo) y el ESP32 DOS (`GND.2` en la
// columna izquierda, `GND.1` en la derecha). O sea que "¿cuál es la masa?" NO
// tiene respuesta sola: sólo la tiene EN RELACIÓN al pin de señal del mismo
// componente. Por eso `rielWokwi` pide `ref` — no es un parámetro de más, es que
// la pregunta sin él está mal formulada.
//
// EL CRITERIO: la masa más cercana al pin de señal DE ESE componente. Un cable
// que sale de un pin del header de arriba y cruza la placa entera hasta `GND.2`
// se dibuja igual de prolijo y le enseña a cablear mal.
//
// Y sale del MISMO header, que es lo que el pibe tiene que ver:
//   · UNO, señal digital  → `GND.1`, el único del header de arriba.
//   · UNO, señal analógica→ `GND.3`, no `GND.2`: las dos están en el header de
//     abajo, pero A0..A5 caen a la DERECHA de las dos, y `GND.3` es la de más a
//     la derecha. `GND.2` no la elige nadie, y está bien que así sea.
//   · ESP32, columna izq. → `GND.2`; columna der. → `GND.1`.
// Esto vale para las DOS placas, así que el `ref` no es un parche del UNO.

/**
 * GPIO del ESP32 → nombre en `wokwi-esp32-devkit-v1`. Lo que NO está, no está.
 *
 * Los 19 `D<n>` salen del volcado. Los dos de abajo son la excepción, y NO es
 * una suposición: la DevKit v1 no imprime "16" ni "17" en ningún lado, imprime
 * el nombre del segundo puerto serie. Está escrito en la ficha del INET que
 * justamente los usa — skills/proyectos-inet/proyectos/06-estacionamiento.md:42:
 * «Los GPIO 16 y 17 … aparecen como RX2/TX2 … buscá el rótulo RX2/TX2, no un
 * "16"/"17" que la plaquita no imprime». Y hacen falta de verdad: el pool
 * automático los saltea, pero la ficha de semaforización los pide a mano
 * (`led:16, led:17`), así que el tool SÍ los reparte.
 *
 * NO ESTÁN GPIO36 NI GPIO39, y eso es un HALLAZGO, no un olvido: los reparte
 * `POOL_ANALOGICO` reparte GPIO36 y GPIO39, y la pieza NO expone ningún `D36`/`D39`:
 * los llama `VP` y `VN`, que es como vienen serigrafiados en la placa de verdad.
 *
 * Eso no se dedujo de que "son los dos que sobran en el header" — así se mete un cable
 * en el agujero de al lado con el dibujo viéndose perfecto. Está confirmado contra el
 * fabricante: ESP32 Series Datasheet, tabla *Pin Definitions*, donde `SENSOR_VP` es el
 * pin físico 5 (GPIO36, ADC1_CH0) y `SENSOR_VN` el 8 (GPIO39, ADC1_CH3), los dos de
 * tipo I — solo entrada. Queda escrito con la cita en `skills/esp32` (sección "Cuando
 * la placa NO dice GPIO"), que es donde tiene que vivir un dato de hardware: el tool
 * no puede ser su fuente.
 * <https://documentation.espressif.com/esp32_datasheet_en.html>
 */
/**
 * SHIELDS DE EXPANSIÓN: son la MISMA placa, no una placa nueva.
 *
 * Un shield se apila sobre el controlador y saca cada pin a un conector de tres vías
 * (señal · V · GND). **No cambia ni un número**: `skills/placas/SKILL.md` (entrada 02)
 * lo dice con todas las letras para el Sensor Shield v5.0, y de la variante DFRobot
 * dice que "funciona igual: apila sobre el UNO, agrupa señal+VCC+GND por servo, mismos
 * pines". Los dos son formato UNO — "no entra en un ESP32".
 *
 * POR QUÉ ESTO EXISTE. Antes, un `placa: "uno con sensor shield"` REBOTABA con el
 * mensaje de placa desconocida, y el docente —que acababa de leer que los pines son
 * los mismos— no entendía nada. Funcionaba sólo si el modelo adivinaba mandar "uno";
 * adivinar no es una garantía, y el día que mande la placa literal el rechazo llega al
 * aula. Esto lo vuelve determinista.
 *
 * Lo que el shield SÍ cambia es DÓNDE se pincha: el pibe no mete el cable en el header
 * de la placa, lo mete en la terna de colores. Por eso normalizar no alcanza y viene
 * con un aviso. El dibujo sigue mostrando la placa pelada hasta que exista la pieza.
 */
/**
 * UN ZÓCALO DEDICADO DEL SHIELD: el módulo entra derecho, no se cablea pin por pin.
 *
 * DE DÓNDE SALE ESTE DATO. No de acá. Sale de `skills/placas/SKILL.md`, entrada 02,
 * sección "Los otros conectores, que evitan cablear a mano", que lo cita del *Arduino
 * Sensor Shield v5.0 Functional Diagram* del fabricante. El tool NO puede ser la fuente
 * de un dato de hardware: esta tabla lo REFLEJA. Hay un test que lee el skill y compara,
 * para que las dos no se separen en silencio.
 *
 * POR QUÉ EXISTE. Un docente con Sensor Shield pidió ultrasónico + LED + servo en UNO.
 * El tool rebotó bien el HC-SR04 (todavía no está portado), pero el rechazo no decía
 * NADA más, y el modelo llenó el hueco en el chat: "Trig → D4 (por ejemplo), Echo → D5
 * (por ejemplo)". Tres cosas mal en una línea: pines inventados, uno de ellos PWM
 * gastado al pedo, y el shield ya tenía el problema resuelto con un zócalo. Lo que el
 * modelo dice en el chat es lo que el pibe cablea, igual que el dibujo — así que el
 * rechazo tiene que ENSEÑAR lo que sí sabemos, no sólo negarse. Un hueco en la
 * respuesta no queda vacío: lo llena el modelo.
 */
interface ZocaloShield {
  /** Tipo de componente del tool (ya normalizado) que entra en este zócalo. */
  tipo: string
  /** El rótulo serigrafiado, tal cual lo nombra el skill. */
  zocalo: string
  /** Los pines de la placa de abajo a los que está cableado. */
  pines: readonly string[]
  /** Qué tiene al lado, para que el docente lo encuentre sin el datasheet. */
  referencia: string
  /** El orden físico de los contactos del zócalo, como los rotula la serigrafía. */
  contactos: readonly string[]

  /**
   * Desde qué versión del shield existe este zócalo. NO es un adorno.
   *
   * El zócalo de ultrasónico (`RB URF v1.1`) es un AGREGADO de la v5.0: las fuentes lo
   * listan entre lo que "la V5.0 suma sobre la V4.0", junto con el I2C, el Bluetooth,
   * el SD y el conector de alimentación externa. O sea que **una v4 no lo trae**.
   *
   * Y el docente real que disparó esto escribió "shield sensor v4". Mandarlo a un
   * conector que su placa no tiene es el mismo error que este tool vino a matar.
   */
  desde: string
}

/**
 * Los zócalos del Sensor Shield que hoy le sirven a un rechazo. HOY es uno solo.
 *
 * El skill lista ocho (`URF01`, `IIC`, `SD Card`, `Bluetooth`, `APC220`, `COM`, y los
 * dos de LCD 12864). Acá está sólo el que corresponde a un componente que el tool
 * REBOTA en UNO, que es el único caso en el que este texto llega al docente. Copiar los
 * otros siete sería mudar el catálogo del skill adentro del tool para que no los lea
 * nadie — y cada copia es un lugar más donde el dato se puede desincronizar.
 */
export const ZOCALOS_SENSOR_SHIELD: readonly ZocaloShield[] = [
  {
    tipo: "ultrasonico",
    zocalo: "URF01",
    pines: ["A0", "A1"],
    // El orden FÍSICO de los cuatro contactos, tal como los rotula el diagrama. No es
    // redundante con `pines`: esos dos son los que van al código, éstos son los que el
    // docente ve al enchufar. Sin el orden, el módulo entra al revés y no lee nada.
    contactos: ["VCC", "A0", "A1", "GND"],
    referencia: "ANALOG IN",
    desde: "v5.0",
  },
]

/**
 * `zocalos` va POR SHIELD, y está vacío en dos de los tres a propósito.
 *
 * Del IO Expansion DFRobot V7.1 el skill dice que "funciona igual: apila sobre el UNO,
 * agrupa señal+VCC+GND por servo, mismos pines" — y NO documenta ningún zócalo de
 * ultrasónico. Del genérico ("shield") no sabemos ni cuál es. Mandar a un docente con
 * DFRobot al `URF01` porque "los shields son todos parecidos" es exactamente el bug que
 * esto vino a matar, con otro disfraz: un dato de hardware inventado que suena igual de
 * seguro que el verdadero. Si alguien confirma esos zócalos contra el fabricante, se
 * escriben PRIMERO en `skills/placas` con la cita, y recién después entran acá.
 */
/**
 * `pieza` es la cara del shield, y sólo la CARA.
 *
 * Un shield no cambia un pin: cambia dónde se pincha. Por eso no es una `Placa` nueva —
 * sería duplicar los pools, los rieles y las 33 advertencias para que digan lo mismo, y
 * cada copia es un lugar donde el dato se desincroniza. Es la MISMA placa con otra cara:
 * se clona cambiándole `tag`, `escala` y `anchoColumna`, y nada más.
 *
 * `base` existe porque la cara no sirve para cualquier placa: `pb-sensor-shield` dibuja
 * un shield formato UNO. Si alguien pide "esp32 con sensor shield", se dibuja el ESP32
 * pelado — mostrarle la cara de un shield que no le entra sería el mismo bug de siempre.
 *
 * Los otros dos shields NO tienen pieza, y eso es correcto: del DFRobot y del genérico
 * no tenemos dibujo ni datos, y prestarles la cara del v5.0 "porque son parecidos" es
 * inventar hardware con cara de dato verificado.
 */
const SHIELDS: ReadonlyArray<{
  patron: RegExp
  nombre: string
  zocalos: readonly ZocaloShield[]
  pieza?: { base: PlacaId; tag: string; escala: number; anchoColumna: number }
}> = [
  {
    patron: /sensor\s*shield/i,
    nombre: "Sensor Shield",
    zocalos: ZOCALOS_SENSOR_SHIELD,
    // 237,4 px medidos en el navegador (57 × 57,5 mm a 3,779528 px/mm, el mismo factor
    // que usa `wokwi-arduino-uno`). En 260 px de columna entra con 11 px de aire por
    // lado; a escala 1.0 porque el paso de las ternas tiene que seguir siendo el real —
    // contarlas en el dibujo es lo único que el pibe hace con esto.
    pieza: { base: "uno", tag: "pb-sensor-shield", escala: 1.0, anchoColumna: 260 },
  },
  { patron: /io\s*expansion|dfrobot/i, nombre: "IO Expansion Shield DFRobot", zocalos: [] },
  { patron: /\bshields?\b/i, nombre: "shield de expansión", zocalos: [] },
]

/**
 * La placa que el docente NOMBRA manda sobre el shield.
 *
 * Este orden es un fix, no un detalle. La primera versión resolvía cualquier shield a
 * `uno` porque el Sensor Shield v5.0 es formato UNO — y con eso, un `placa: "ESP32 con
 * sensor shield"` dibujaba un ARDUINO UNO, con pines D2/D3 que en un ESP32 no existen.
 * Es el mismo bug que este tool vino a matar, dado vuelta: darle al docente una placa
 * que no es la suya. Se encontró probándolo, no leyéndolo.
 *
 * Así que primero se busca la placa por nombre y sólo después se mira el shield. Si no
 * nombra ninguna, el default es UNO, porque el shield de las escuelas es formato UNO
 * ("no entra en un ESP32", `skills/placas`) — pero eso se AVISA, no se asume en silencio.
 */
function shieldDe(
  texto: string,
): {
  base: PlacaId
  nombre: string
  baseAsumida: boolean
  zocalos: readonly ZocaloShield[]
  version: string | null
  pieza?: { base: PlacaId; tag: string; escala: number; anchoColumna: number }
} | null {
  const shield = SHIELDS.find((sh) => sh.patron.test(texto))
  if (!shield) return null
  const nombrada = (Object.keys(PLACAS) as PlacaId[]).find((id) =>
    new RegExp(`\\b${id}\\b`, "i").test(texto),
  )
  /*
   * La VERSIÓN del shield, si el docente la dijo.
   *
   * No es un capricho: el zócalo de ultrasónico es un agregado de la v5.0, así que
   * "sensor shield v4" y "sensor shield v5" NO tienen los mismos conectores. El docente
   * que disparó todo esto escribió, textual, "un shield sensor v4".
   *
   * Se normaliza a "vN.M" para poder comparar con `<` contra el `desde` del zócalo:
   * "v4", "V4.0", "v 4" y "version 4" caen todos en "v4.0". `null` = no la dijo, y ahí
   * el dato se da CON su versión al lado en vez de asumir cuál tiene.
   */
  const m = texto.match(/v(?:ersi[oó]n)?\s*\.?\s*(\d+)(?:\s*\.\s*(\d+))?/i)
  const version = m ? `v${m[1]}.${m[2] ?? "0"}` : null
  return {
    base: nombrada ?? "uno",
    nombre: shield.nombre,
    baseAsumida: nombrada === undefined,
    zocalos: shield.zocalos,
    version,
    pieza: shield.pieza,
  }
}

const ESP32_WOKWI_PIN = new Map<number, string>([
  ...[2, 4, 5, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35].map((n): [number, string] => [n, `D${n}`]),
  // Los cuatro que la placa NO rotula "GPIO". Cada uno con su fuente:
  [16, "RX2"], // skills/proyectos-inet/proyectos/06-estacionamiento.md:42
  [17, "TX2"], // idem
  [36, "VP"], // SENSOR_VP — ESP32 Series Datasheet, Pin Definitions, pin físico 5
  [39, "VN"], // SENSOR_VN — idem, pin físico 8
])

/** Los GPIO de la columna IZQUIERDA de la pieza: su masa más cercana es `GND.2`. */
const ESP32_WOKWI_IZQUIERDA = new Set([12, 13, 14, 25, 26, 27, 32, 33, 34, 35, 36, 39])

export const PLACAS: Record<PlacaId, Placa> = {
  esp32: {
    id: "esp32",
    etiqueta: "ESP32 DevKit",
    tag: "wokwi-esp32-devkit-v1",
    escala: 1.25,
    anchoColumna: 230,
    poolDigital: POOL_DIGITAL.map(pinG),
    poolAnalogico: POOL_ANALOGICO.map(pinG),
    // poolPwm ausente: en el ESP32 cualquier salida hace PWM por `ledc`.
    i2c: { sda: pinG(21), scl: pinG(22) },
    riel: { V5: "VIN (5V)", V3: "3.3V", VLOGICA: "3.3V", GND: "GND", SDA: "GPIO21", SCL: "GPIO22" },
    adcMax: 4095,
    resistenciaLed: "220Ω",
    nombreDePool: { digital: "GPIO digital", analogico: "GPIO analogico" },
    avisoCincoVolt: "los componentes de 5V (servo, PIR, HC-SR04, LCD) van a VIN, NO a 3.3V.",
    etiquetaPin: (p) => `GPIO${p.n}`,
    // En el ESP32 el banco es siempre "GPIO", pero se pregunta igual: un PinId de
    // otra placa que se colara acá tiene que dar `null`, no un nombre plausible.
    pinWokwi: (p) => (p.banco === "GPIO" ? (ESP32_WOKWI_PIN.get(p.n) ?? null) : null),
    rielWokwi(r, ref) {
      switch (r) {
        // "VIN" a secas: el "(5V)" de `riel.V5` es para el ojo del docente, y la
        // pieza no tiene ningún pin que se llame así.
        case "V5":
          return "VIN"
        // Nosotros lo escribimos "3.3V" (riel.V3) y la pieza lo llama `3V3`.
        case "V3":
        case "VLOGICA":
          return "3V3"
        case "GND":
          return ref != null && ESP32_WOKWI_IZQUIERDA.has(ref.n) ? "GND.2" : "GND.1"
        // Derivados de `i2c` y no escritos a mano: si mañana el bus se mueve, se
        // mueve en UN lugar. Dos tablas que dicen el mismo pin se desincronizan.
        case "SDA":
          return this.pinWokwi(this.i2c.sda)
        case "SCL":
          return this.pinWokwi(this.i2c.scl)
      }
    },
    motivoRechazo(p, clase, etiqueta) {
      const g = p.n
      if (GPIO_FLASH.has(g))
        return `⚠️ GPIO${g} está cableado a la memoria flash del ESP32 (GPIO6 a GPIO11): usarlo cuelga la placa. Le asigné un pin seguro.`
      if (!GPIO_VALIDOS.has(g)) return `⚠️ GPIO${g} no existe en el ESP32. Le asigné un pin válido.`
      if (GPIO_UART_USB.has(g))
        return `⚠️ GPIO${g} es el puerto serie del USB (GPIO1=TX, GPIO3=RX): con algo conectado ahí la placa no acepta la carga del programa. Le asigné otro pin.`
      if (clase !== "analogico" && GPIO_SOLO_ENTRADA.has(g))
        return `⚠️ GPIO${g} es SOLO ENTRADA en el ESP32 (34, 35, 36 y 39): no puede encender nada ni tiene pull-up interno, así que ${etiqueta} ahí no funcionaría nunca. Le asigné un pin que sí sirve. Esos cuatro son ideales para sensores analógicos.`
      return null
    },
    notaDePin: (p) =>
      GPIO_STRAPPING.has(p.n)
        ? `Nota: GPIO${p.n} es un pin "strapping" del ESP32 — funciona, pero puede complicar el arranque si tiene algo conectado al encender. Si podés, elegí otro.`
        : null,
  },

  uno: {
    id: "uno",
    etiqueta: "Arduino UNO",
    tag: "wokwi-arduino-uno",
    escala: 1.0,
    anchoColumna: 290,
    poolDigital: UNO_POOL_DIGITAL.map(pinD),
    poolAnalogico: UNO_POOL_ANALOGICO.map(pinA),
    poolPwm: UNO_POOL_PWM.map(pinD),
    // I2C: SDA=A4, SCL=A5 (skills/educabot/SKILL.md:52 y :102, skills/sensores/SKILL.md:381).
    i2c: { sda: pinA(4), scl: pinA(5) },
    // El UNO trabaja a 5V (skills/placas/SKILL.md:128) y su riel se rotula "5V"
    // (skills/arduino/SKILL.md:66). El de 3,3 V también existe (skills/sensores/SKILL.md:379).
    riel: { V5: "5V", V3: "3.3V", VLOGICA: "5V", GND: "GND", SDA: "A4", SCL: "A5" },
    adcMax: 1023,
    resistenciaLed: "220Ω",
    nombreDePool: { digital: "pines digitales (D0 a D13)", analogico: "entradas analógicas (A0 a A5)" },
    // En el UNO TODO es de 5V: no hay dos mundos que confundir. El aviso del ESP32
    // ("van a VIN, NO a 3.3V") acá no aplica y nombraría un pin que no existe.
    avisoCincoVolt: null,
    etiquetaPin: (p) => `${p.banco}${p.n}`,
    // El UNO es la placa donde los dos nombres MÁS se parecen y por eso más
    // engaña: `A0` es igual en las dos, pero el digital pierde la "D" y queda el
    // número pelado. Devolver "D2" acá no rompe nada visible — simplemente no
    // existe ese pin, y el cable se queda sin anclar sin que nadie se entere.
    pinWokwi: (p) => {
      if (p.banco === "A") return p.n >= 0 && p.n <= 5 ? `A${p.n}` : null
      if (p.banco === "D") return p.n >= 0 && p.n <= 13 ? String(p.n) : null
      return null
    },
    rielWokwi(r, ref) {
      switch (r) {
        case "V5":
        case "VLOGICA":
          return "5V"
        // Ojo: acá sí es "3.3V" con punto. El `3V3` es el del ESP32.
        case "V3":
          return "3.3V"
        // Las tres masas. El header de abajo tiene dos (`GND.2` en x=169,5 y
        // `GND.3` en x=179) y las analógicas arrancan en x=208: `GND.3` es la de
        // más a la derecha, o sea la más cercana a A0..A5. `GND.1` es la única
        // del header de arriba, donde viven los digitales.
        case "GND":
          return ref?.banco === "A" ? "GND.3" : "GND.1"
        case "SDA":
          return this.pinWokwi(this.i2c.sda)
        case "SCL":
          return this.pinWokwi(this.i2c.scl)
      }
    },
    motivoRechazo(p) {
      // El UNO no tiene flash SPI colgada de pines, ni strapping, ni solo-entrada
      // (skills/educabot/SKILL.md:341). Lo único que se puede pedir mal es un pin
      // que no existe. D0/D1 y D13 SÍ existen y entran al pool: llevan nota, no rechazo.
      if (p.banco === "A")
        return p.n >= 0 && p.n <= 5
          ? null
          : `⚠️ A${p.n} no existe en el Arduino UNO: las entradas analógicas van de A0 a A5. Le asigné una válida.`
      return p.n >= 0 && p.n <= 13
        ? null
        : `⚠️ D${p.n} no existe en el Arduino UNO: los pines digitales van de D0 a D13. Le asigné un pin válido.`
    },
    notaDePin: (p) => {
      if (p.banco !== "D") return null
      if (p.n === 0 || p.n === 1)
        return `Nota: D0 y D1 son el puerto serie que comparte el cable USB — en la placa están rotulados "RX←0" y "TX→1". El circuito funciona, pero mientras haya algo conectado ahí la carga del programa puede fallar y el Monitor Serie escupe basura. Si podés, dejalos libres.`
      if (p.n === 13)
        return `Nota: D13 tiene el LED de la placa soldado en paralelo (skills/placas: "LED de placa, pin 13"). Como salida funciona igual, pero vas a ver ese LED acompañando; como entrada, esa carga te puede falsear la lectura. Si podés, elegí otro.`
      return null
    },
  },
}

/** El banco del que sale un pin de esta clase en esta placa. */
function bancoDe(placa: Placa, clase: ClasePin): Banco {
  const pool = clase === "analogico" ? placa.poolAnalogico : placa.poolDigital
  return pool[0]?.banco ?? "GPIO"
}

/**
 * Lo que la hoja escribe DE VERDAD donde faltó un pin: "GPIO?" en el ESP32, "D?"
 * o "A?" (o las dos) en el UNO, según qué pool se haya agotado.
 *
 * Sale de los pines que quedaron sin asignar, no de la placa entera, y por eso
 * recibe la lista y no sólo la placa: el encabezado del chat le dice a la docente
 * qué texto va a encontrar en la hoja, y mandarla a buscar "D? o A?" cuando la
 * hoja dice sólo "D?" es la misma clase de error que B8 vino a matar. Si no faltó
 * ninguno, cae a los bancos de la placa (nadie lo lee en ese caso, pero el campo
 * nunca queda vacío).
 */
function marcaSinPin(placa: Placa, pines: (PinId | null)[][]): string {
  const faltantes = pines.flat().filter((p): p is PinId => p != null && p.n < 0)
  const bancos = faltantes.length
    ? [...new Set(faltantes.map((p) => p.banco))]
    : [...new Set([bancoDe(placa, "digital"), bancoDe(placa, "analogico")])]
  return bancos.map((b) => `${b}?`).join(" o ")
}
/**
 * El mismo pin, pero DEL LADO DE LA PIEZA: el nombre con el que `el.pinInfo` lo
 * publica, o el motivo por el que no hay ninguno.
 *
 * `placa.pinWokwi`/`rielWokwi` resuelven la punta de la PLACA. Ésta es la otra
 * punta, y es la que más engaña, porque los nombres casi coinciden: el servo
 * dice "Señal (PWM)" y la pieza dice `PWM`; el DHT22 dice "DATA" y la pieza dice
 * `SDA`; el OLED dice "VCC" y la pieza tiene DOS candidatos (`3V3` y `VIN`).
 *
 * Un array cuando la fila consume VARIOS pines (`cantidad`): "Segmentos A-G" es
 * UNA etiqueta y SIETE agujeros. El largo tiene que dar igual que `cantidad`.
 *
 * `{ sinAnclaje }` NO es un hueco a llenar después: es la respuesta correcta
 * cuando la pieza dibujada no tiene ese contacto. Un nombre inventado se dibuja
 * igual de prolijo y manda al pibe al agujero equivocado, que es PEOR que la
 * barra gris de hoy — es el bug de `plantilla-semaforo-protoboard.html`, tres
 * coordenadas a mano y las tres mal, con el rótulo correcto al lado.
 */
type AnclajePieza = string | readonly string[] | { sinAnclaje: string }

/**
 * Los nombres de pieza de una fila, o `null` si está declarada sin anclaje.
 *
 * Se exporta porque el barrido de tests la usa para comparar contra el `pinInfo`
 * REAL del bundle, que es una fuente externa. Si esto fuera una tabla aparte del
 * catálogo, el día que alguien agregue un pin la tabla no diría nada: por eso el
 * anclaje es un campo OBLIGATORIO de cada pin y no un diccionario al costado.
 */
export function anclajesDe(pin: { pinPieza: AnclajePieza }): readonly string[] | null {
  const a = pin.pinPieza
  if (typeof a === "string") return [a]
  if (Array.isArray(a)) return a
  return null
}

/** El motivo declarado por el que esta fila no se ancla, o `null` si sí se ancla. */
export function motivoSinAnclaje(pin: { pinPieza: AnclajePieza }): string | null {
  const a = pin.pinPieza
  return typeof a === "object" && !Array.isArray(a) ? (a as { sinAnclaje: string }).sinAnclaje : null
}

/**
 * Qué posiciones del array de pines asignados le tocan a cada FILA de la tabla.
 *
 * Es la MISMA cuenta que `rellenarRol` hace con `{0}` y `{0-6}`, pero derivada
 * del catálogo en vez de leída del texto: las filas fijas no consumen nada y
 * cada fila de señal se lleva `cantidad` posiciones, en orden. Se saca acá
 * afuera y se exporta porque si esta cuenta y la de los `{…}` se separan, los
 * cables se anclan a un pin y la etiqueta dice otro — con los dos textos bien
 * escritos. Un test aparea las dos y muere si se desincronizan.
 */
export function indicesDeFila(pines: readonly Pin[]): (readonly number[] | null)[] {
  let k = 0
  return pines.map((p) => {
    if (p.clase === "fijo") return null
    const n = p.cantidad ?? 1
    const r = Array.from({ length: n }, (_, j) => k + j)
    k += n
    return r
  })
}

/**
 * Las DOS puntas de los cables de una fila, con los nombres que entiende el
 * navegador: `placa` es dónde pinchar en la placa, `pieza` dónde en el componente.
 *
 * Cada punta se resuelve SOLA y puede salir `null` sin arrastrar a la otra: el
 * fallback es por atributo. Lo que NO puede pasar es que salgan dos listas de
 * largo distinto — ahí el que dibuja aparearía el cable 2 con el agujero 3 — así
 * que ese caso se trata como si no hubiera anclaje y no como "algo es mejor que
 * nada". Ante la duda, el cable se queda como está hoy.
 */
export function anclajesDeCable(
  pin: Pin,
  indices: readonly number[] | null,
  asignados: readonly (PinId | null)[],
  placa: Placa,
): { placa: readonly string[] | null; pieza: readonly string[] | null } {
  const pieza = anclajesDe(pin) ?? null
  let enPlaca: string[] | null = null
  if (pin.clase === "fijo") {
    // Un destino de afuera de la placa (un driver, la red de 220 V) no tiene
    // punta de placa: no es un riel que falte, es que el cable no llega ahí.
    if (typeof pin.destino === "string") {
      // `ref` = el primer pin de señal del componente. No es decorativo: ninguna
      // de las dos placas tiene un pin llamado `GND`, y cuál de las tres masas es
      // "la de al lado" sólo se puede contestar en relación a algo.
      const n = placa.rielWokwi(pin.destino, asignados.find((p) => p != null) ?? null)
      enPlaca = n == null ? null : [n]
    }
  } else if (indices) {
    const nombres = indices.map((i) => {
      const p = asignados[i]
      // n < 0 es el pin que no se pudo asignar (pool agotado): la hoja escribe
      // "GPIO?" y acá no hay nada que anclar.
      return p == null || p.n < 0 ? null : placa.pinWokwi(p)
    })
    enPlaca = nombres.every((n) => n != null) ? (nombres as string[]) : null
  }
  if (enPlaca && pieza && enPlaca.length !== pieza.length) return { placa: null, pieza: null }
  return { placa: enPlaca, pieza }
}

interface PinBase {
  nombre: string
  color: string
  /**
   * OBLIGATORIO a propósito: sin `?`, agregar un pin sin decidir su anclaje no
   * compila. El test de completitud es la segunda red; ésta es la primera, y
   * corre antes de que el archivo llegue a un test.
   */
  pinPieza: AnclajePieza
}

/** Un pin de SEÑAL: el asignador le busca un pin libre en la placa. */
interface PinSenal extends PinBase {
  clase: "digital" | "analogico"
  /**
   * La etiqueta de la conexión, con huecos.
   *
   * `{0}`, `{1}`… es el n-ésimo pin que se le asignó a este componente, y `{a-b}`
   * es una fila que consume VARIOS (7 segmentos, teclado) y los imprime a todos.
   * `{R}` es la resistencia en serie del LED, que la pone la placa.
   *
   * Ojo con el prefijo: antes acá decía "GPIO{0}" y el "GPIO" estaba escrito a
   * mano 37 veces. Ahora lo pone `placa.etiquetaPin`, que es la única que sabe si
   * este pin se llama GPIO4, D4 o A4.
   */
  rol: string
  /**
   * Este pin necesita PWM de verdad (el servo, cada color del RGB).
   *
   * En el ESP32 no cambia nada: `poolPwm` es undefined porque cualquier salida
   * hace PWM por `ledc`. En el UNO sólo lo hacen 3, 5, 6, 9, 10 y 11 — los
   * marcados con `~` — y el skill `actuadores` es explícito (`:104`): «En Arduino
   * UNO usá un pin PWM (con ~); en ESP32 cualquier GPIO».
   */
  requierePwm?: boolean
  /**
   * Cuántos pines consume ESTA fila de la tabla. Default 1.
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

/** Un destino que NO es la placa: un driver, un relé, una fuente externa, la red. */
const afuera = (texto: string): { afuera: string } => ({ afuera: texto })

/** Un pin FIJO: va siempre al mismo lado, y el asignador no lo toca. */
interface PinFijo extends PinBase {
  clase: "fijo"
  /**
   * Un símbolo de `Riel` (lo resuelve la placa: V5 es "VIN (5V)" en el ESP32 y
   * "5V" en el UNO) o un destino de afuera de la placa, que es texto y punto.
   *
   * Antes esto era un literal: `destino: "GPIO21"`. O sea, la placa escrita a mano
   * 27 veces adentro del catálogo de componentes. El día que apareció la segunda
   * placa, esos 27 literales eran 27 cables mal dibujados.
   */
  destino: Riel | { afuera: string }
}

type Pin = PinSenal | PinFijo

/**
 * La advertencia de un componente, POR PLACA.
 *
 * `esp32` es obligatorio. Si falta la clave de la placa que se pidió, el tool NO
 * dibuja: se niega y lo dice. NUNCA cae a la de ESP32 — ese fallback silencioso es
 * exactamente el bug que esta tanda vino a matar. Un docente con un UNO leyendo
 * "usá GPIO34 o GPIO35" no tiene forma de darse cuenta de que le contestaron sobre
 * otra placa: el texto suena igual de seguro que el correcto.
 *
 * Un string pelado es la forma corta de "este componente todavía existe sólo en
 * ESP32": equivale a `{ esp32: <ese texto> }` y a ninguna otra placa, así que
 * pedirlo con otra placa se rechaza igual. Se deja como forma corta porque los 10
 * componentes que faltan portar se leen de un vistazo — y porque
 * tests/skills-coherencia.test.mjs lee la advertencia del PIR del código fuente
 * (`advertencia: "…"`) para chequear que no diga que OUT es de 5V.
 */
type AvisoPorPlaca = { esp32: string | null } & Partial<Record<PlacaId, string | null>>
type Aviso = string | AvisoPorPlaca

/**
 * El texto para esta placa, o `null` si el componente NO la soporta.
 *
 * Devuelve `{ texto: null }` cuando la placa está soportada pero no hay nada que
 * advertir, que es distinto de no soportarla. Confundir esas dos cosas es volver
 * al fallback silencioso por la puerta de atrás.
 *
 * LA FORMA CORTA SE NORMALIZA ANTES DE DECIDIR, y eso lo encontró una prueba de
 * mutación, no el diseño. La primera versión tenía dos ramas —una para el string
 * pelado y otra para el objeto— y cada una repetía la regla de "si falta la clave de
 * esa placa, no se dibuja". El detalle es que HOY los 10 componentes sin portar usan
 * la forma corta y los 23 portados traen las dos claves: la rama del objeto no la
 * ejercía NADIE, y se le podía meter el fallback a ESP32 sin que se pusiera roja una
 * sola línea de la suite. Una regla, un lugar: así el test del invariante mata las dos.
 *
 * SE EXPORTA PARA PODER PROBAR LA RAMA QUE NADIE EJERCE. El guard de arriba
 * (`!(placa in porPlaca)`) lo matan 4 tests de punta a punta, pero la segunda
 * mitad —el `?? null` del return— no la mataba ninguno: hoy NO existe ningún
 * componente escrito con `uno: null`, así que ese camino no se recorre dibujando.
 * Y `uno: null` es una forma que el contrato de arriba BENDICE explícitamente
 * ("la placa está soportada pero no hay nada que advertir"). El día que alguien
 * la use, un `?? porPlaca.esp32` acá imprimiría el texto del ESP32 en la hoja del
 * UNO en silencio — el bug exacto que esta tanda vino a matar, a un `??` de
 * distancia. No se puede probar por el render, así que se prueba por la función.
 */
export function avisoDe(aviso: Aviso, placa: PlacaId): { texto: string | null } | null {
  const porPlaca: AvisoPorPlaca = typeof aviso === "string" ? { esp32: aviso } : aviso
  if (!(placa in porPlaca)) return null
  return { texto: porPlaca[placa] ?? null }
}

/**
 * El bloque de avisos de la hoja: el encabezado y las viñetas, o NADA.
 *
 * SIN AVISOS NO HAY ENCABEZADO DE AVISOS. Antes esto vivía suelto en el render y
 * era `cabecera + …join(" ")` a secas, así que con la lista vacía la hoja salía
 * con un "💡 Atención:" y NADA atrás. Un cartel de atención vacío se lee como un
 * error del programa, y se lee justo en el papel que el pibe tiene delante
 * mientras cablea.
 *
 * Ese estado es INALCANZABLE dibujando —los 23 componentes portados traen su
 * advertencia— pero es exactamente el estado al que llega la hoja el día que a
 * alguien se le vacía un aviso en un refactor, que es un camino que esta tanda ya
 * vio abrirse. Por eso está acá afuera y exportada: un invariante que no se puede
 * ejercer por el render se prueba por la función, o no se prueba.
 *
 * "✋ ¡Probalo con el mouse!" NO se cae con la lista vacía, y es a propósito: ése
 * no encabeza avisos, es una invitación que se sostiene sola.
 */
export function bloqueDeAvisos(advertencias: string[], interactivo: boolean): string {
  const cabecera = interactivo
    ? "✋ <strong>¡Probalo con el mouse!</strong> "
    : "💡 <strong>Atención:</strong> "
  const cuerpo = advertencias.map((f) => "• " + f).join(" ")
  if (cuerpo) return cabecera + cuerpo
  return interactivo ? cabecera.trimEnd() : ""
}

interface Componente {
  tag: string
  etiqueta: string
  voltaje: "3.3V" | "5V"
  interactivo?: boolean
  attrs?: (i: number) => string
  pines: Pin[]
  advertencia: Aviso
  /**
   * La animación de la pieza. Recibe la placa porque alguna la NOMBRA en pantalla:
   * el LCD hace desfilar un mensaje, y decía "Arduino + ESP32" en el display de un
   * circuito de UNO. Es texto chiquito y es la pieza que el alumno mira de frente.
   * Las que no la usan declaran un solo parámetro y listo.
   */
  anim: (id: string, placa: Placa) => string
}

export const COMPONENTES: Record<string, Componente> = {
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
      { nombre: "Ánodo (+)", color: CABLE.naranja, clase: "digital", rol: "{0} (con {R})", pinPieza: "A" },
      { nombre: "Cátodo (−)", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "C" },
    ],
    advertencia: {
      // Antes esta advertencia explicaba los 220Ω "porque son los 3.3V del ESP32" y
      // remataba con "los 330 ohm son la regla del UNO a 5V". Con el UNO dibujándose
      // de verdad eso pasó de ser impreciso a ser una contradicción de la propia
      // herramienta: la hoja del UNO dice 220Ω. Y la fuente del repo es clara —
      // fichas/hojas/03-led.html:488, "En 5 V: 220 ohm… es el valor de los kits".
      esp32:
        "cada LED siempre con su resistencia de 220Ω en serie: es el valor de los kits, y el mismo que este tool dibuja en las dos placas. Ojo con el color: un LED azul o blanco cae 3 V o más y sobre los 3.3V del ESP32 casi no prende — no es cuestión de elegir otra resistencia, no queda tensión.",
      uno: "cada LED siempre con su resistencia de 220Ω en serie, y el cátodo (la pata corta) a GND. Es el valor de los kits escolares. Sin la resistencia el LED se destruye en el primer encendido: el LED no limita su propia corriente, la limita la resistencia que le pongas o nada.",
    },
    anim: (id) => `const e=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(e)e.value=on;},600);`,
  },

  servo: {
    tag: "wokwi-servo",
    etiqueta: "Servo SG90",
    voltaje: "5V",
    pines: [
      { nombre: "Alimentación", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: "V+" },
      { nombre: "Señal (PWM)", color: CABLE.naranja, clase: "digital", rol: "{0}", requierePwm: true, pinPieza: "PWM" },
      { nombre: "Tierra", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
    ],
    advertencia: {
      esp32: "el servo necesita 5V: cable rojo a VIN, nunca a 3.3V.",
      uno: "el servo necesita 5V: el cable rojo va al riel de 5V de la placa y el marrón a GND. La señal (el cable naranja) va a un pin PWM, de los marcados con ~ en la serigrafía: 3, 5, 6, 9, 10 u 11 — es lo que dice el skill de actuadores para UNO, y es donde te lo pongo. Librería: Servo.h.",
    },
    anim: (id) => `const s=document.getElementById('${id}');let a=0,d=1;setInterval(()=>{a+=d*3;if(a>=180||a<=0)d*=-1;if(s)s.angle=a;},30);`,
  },

  potenciometro: {
    tag: "wokwi-potentiometer",
    etiqueta: "Potenciómetro",
    voltaje: "3.3V",
    interactivo: true,
    pines: [
      { nombre: "Extremo 1", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "Cursor", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: "SIG" },
      { nombre: "Extremo 2", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
    ],
    advertencia: {
      esp32: "el potenciómetro usa una entrada analógica. Usá GPIO34 o GPIO35 (solo-entrada, ideales para ADC). GPIO32/33 también sirven.",
      uno: `el potenciómetro usa una entrada analógica: cualquiera de A0 a A5. El cursor (la pata del medio) es el que va a la placa; los dos extremos van uno a la alimentación y el otro a GND — si los invertís no se rompe nada, se invierte el sentido. analogRead devuelve de 0 a ${PLACAS.uno.adcMax}.`,
    },
    anim: (id) => `const p=document.getElementById('${id}');if(p){p.addEventListener('input',()=>{const v=Math.round(((p.value??0)/1023)*100);document.title='Potenciometro: '+v+'%';});}`,
  },

  buzzer: {
    tag: "wokwi-buzzer",
    etiqueta: "Buzzer",
    voltaje: "3.3V",
    pines: [
      // EL "1" ES EL NEGATIVO, y no al revés. La pieza llama a sus patas `1` y `2`
      // y no publica ni descripción ni `signals`, así que el número NO dice la
      // polaridad. Lo dice el SVG que dibuja la propia pieza: de las dos patas,
      // `<path d="m7.23 16.5v3.5" stroke="#000">` es negra y
      // `<path d="m9.77 16.5v3.5" fill="#f00" stroke="#f00">` es ROJA. El viewBox
      // es de 17 mm y `pinInfo` publica píxeles (3.78 px/mm): 7.23·3.78 = 27.3 → el
      // pin `1`, y 9.77·3.78 = 36.9 → el pin `2`. O sea que la pata roja, la
      // positiva, es el `2`. Mapear "Positivo" a "1" porque suena a primero es
      // exactamente el error que se dibuja perfecto y nadie nota.
      { nombre: "Positivo (+)", color: CABLE.naranja, clase: "digital", rol: "{0}", pinPieza: "2" },
      { nombre: "Negativo (−)", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "1" },
    ],
    advertencia: {
      esp32: "el buzzer tiene polaridad: la pata larga (+) al pin, la corta (−) a GND.",
      uno: "el buzzer tiene polaridad: la pata larga (+) al pin, la corta (−) a GND. Con tone(pin, frecuencia) le sacás notas y con noTone(pin) lo callás.",
    },
    anim: (id) => `const b=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(b)b.hasSignal=on;},400);`,
  },

  ultrasonico: {
    tag: "wokwi-hc-sr04",
    etiqueta: "HC-SR04",
    voltaje: "5V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: "VCC" },
      { nombre: "TRIG", color: CABLE.verde, clase: "digital", rol: "{0}", pinPieza: "TRIG" },
      { nombre: "ECHO", color: CABLE.azul, clase: "digital", rol: "{1} (¡con divisor!)", pinPieza: "ECHO" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
    ],
    advertencia: "el HC-SR04 va a 5V (VIN); el pin ECHO entrega 5V — si lo conectás directo al ESP32 lo dañás. Divisor: R1=1kΩ entre ECHO y el GPIO, R2=2kΩ entre el GPIO y GND.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.1;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  dht22: {
    tag: "wokwi-dht22",
    etiqueta: "DHT22",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      // La pieza le dice `SDA` al pin de datos del DHT22. No es un bus I2C — el
      // DHT22 habla su protocolo propio de un hilo — pero el nombre es el que hay.
      { nombre: "DATA", color: CABLE.naranja, clase: "digital", rol: "{0}", pinPieza: "SDA" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
    ],
    advertencia: "el DHT22 funciona a 3.3V. Módulo de 3 pines (plaqueta): ya trae el pull-up, no agregues nada. Sensor pelado de 4 patas: 10kΩ entre DATA y VCC.",
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.08;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  pir: {
    tag: "wokwi-pir-motion-sensor",
    etiqueta: "Sensor PIR",
    voltaje: "5V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: "VCC" },
      { nombre: "OUT", color: CABLE.verde, clase: "digital", rol: "{0}", pinPieza: "OUT" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
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
      // LOS CUATRO SIN ANCLAJE, y no es un olvido: es que el tool y la pieza modelan
      // DOS COSAS DISTINTAS. Acá arriba está el LCD CON MOCHILA I2C (4 cables). La
      // pieza `wokwi-lcd1602` que se instancia es el display PARALELO: sus 16 pines
      // son `VSS VDD V0 RS RW E D0..D7 A K`, que son los del display pelado, los que
      // en el módulo real están SOLDADOS a la mochila y nunca se cablean.
      //
      // (La pieza SÍ sabe hacer I2C: con `pins="i2c"` su `pinInfo` pasa a ser
      // `GND VCC SDA SCL`. Pero `attrs` no le pone ese atributo, así que lo que se
      // dibuja hoy son los 16. Anclar a los 16 es el camino: mientras no esté,
      // anclar "VCC" a `VDD` sería mandar al pibe al pin 2 del header paralelo,
      // que NO es donde está el VCC de la mochila.)
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: { sinAnclaje: "el tool dibuja el LCD con mochila I2C y la pieza instanciada es el display paralelo: no publica ningún VCC (su alimentación es VDD, del header que la mochila tapa)." } },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: { sinAnclaje: "mismo caso: la pieza paralela llama VSS a su masa, y es la del display, no la del borne de la mochila." } },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", destino: "SDA", pinPieza: { sinAnclaje: "la pieza paralela NO tiene bus I2C: no hay ningún pin SDA al que anclar." } },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", destino: "SCL", pinPieza: { sinAnclaje: "la pieza paralela NO tiene bus I2C: no hay ningún pin SCL al que anclar." } },
    ],
    advertencia: {
      esp32:
        "el LCD por I2C usa SDA=GPIO21 y SCL=GPIO22 (fijos en el ESP32). ¡OJO con los 5V! La mochila I2C tiene sus pull-ups a su propio VCC: alimentada a 5V pone SDA y SCL en 5V, y GPIO21/22 NO toleran 5V. Opciones: alimentarla a 3.3V (segura, con menos contraste) o 5V + conversor de nivel bidireccional en SDA/SCL (el divisor de resistencias NO sirve: I2C es bidireccional). Nunca mochila a 5V con SDA/SCL directo al ESP32.",
      // En el UNO desaparece TODO el problema de niveles del ESP32: la mochila y la
      // placa hablan el mismo idioma. Lo que sí hay que decir es el costo oculto del
      // bus, que en el ESP32 no existe: A4 y A5 dejan de estar disponibles como
      // entradas analógicas, y quedan A0-A3 para sensores.
      uno: "el LCD por I2C usa SDA=A4 y SCL=A5, que en el UNO son fijos. La mochila y la placa trabajan a la misma tensión, así que van directo: sin conversor y sin nada en el medio. El costo es que A4 y A5 dejan de servir como entradas analógicas mientras el display esté conectado: te quedan A0 a A3 para sensores. Si no muestra nada pero la luz de fondo prende, es el contraste (el potenciómetro azul de la mochila) o la dirección: 0x27 en las del PCF8574 y 0x3F en las del PCF8574A. Librería: LiquidCrystal_I2C.",
    },
    anim: (id, placa) => `const l=document.getElementById('${id}');const m=["Hola Tecnia Bot!","Escuela tecnica","${placa.etiqueta}"];let i=0;setInterval(()=>{i=(i+1)%m.length;if(l)l.text=m[i];},1800);`,
  },

  boton: {
    tag: "wokwi-pushbutton",
    etiqueta: "Botón",
    voltaje: "3.3V",
    interactivo: true,
    attrs: () => `color="green"`,
    pines: [
      // La pieza publica CUATRO contactos: `1.l` `2.l` `1.r` `2.r`. El punto es la
      // convención de Wokwi para "el mismo nodo, sacado dos veces" — la misma que
      // usa el UNO en `GND.1/.2/.3` y en `A4`/`A4.2`. O sea que hay DOS nodos,
      // `1` y `2`, y cada uno asoma a izquierda y a derecha (lo confirma la
      // geometría: `1.l` y `1.r` comparten y=13, `2.l` y `2.r` comparten y=32).
      // Las dos patas del catálogo tienen que salir de nodos DISTINTOS, así que se
      // eligen los dos de la izquierda; los `.r` son los mismos nodos y andan igual.
      { nombre: "Una pata", color: CABLE.verde, clase: "digital", rol: "{0} (INPUT_PULLUP)", pinPieza: "1.l" },
      { nombre: "Otra pata", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "2.l" },
    ],
    advertencia: {
      esp32: "el botón usa INPUT_PULLUP: sin apretar lee HIGH, al apretar LOW. La conexión es GPIO + GND, nunca a 3.3V con esta config.",
      // El "nunca a 3.3V" del ESP32 no se traduce cambiando el número: lo que la
      // regla dice es "con INPUT_PULLUP, la otra pata va a GND y no a la
      // alimentación". Eso vale igual en las dos placas, y es lo que se dice.
      uno: "el botón usa INPUT_PULLUP: sin apretar lee HIGH, al apretar LOW. Con esa configuración las dos patas son el pin y GND — nunca la alimentación, porque el pull-up ya lo pone el micro por dentro y no hace falta ninguna resistencia externa. Ojo con el rebote: un pulsador mecánico cierra y abre varias veces en unos pocos milisegundos.",
    },
    anim: (id) => `const b=document.getElementById('${id}');if(b)b.addEventListener('button-press',()=>{});`,
  },

  "rgb-led": {
    tag: "wokwi-rgb-led",
    etiqueta: "LED RGB",
    voltaje: "3.3V",
    pines: [
      { nombre: "Rojo (R)", color: CABLE.rojo, clase: "digital", rol: "{0} (con {R})", requierePwm: true, pinPieza: "R" },
      { nombre: "Verde (G)", color: CABLE.verde, clase: "digital", rol: "{1} (con {R})", requierePwm: true, pinPieza: "G" },
      { nombre: "Azul (B)", color: CABLE.azul, clase: "digital", rol: "{2} (con {R})", requierePwm: true, pinPieza: "B" },
      { nombre: "Común (−)", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "COM" },
    ],
    advertencia: {
      esp32: "el LED RGB combina 3 colores. Cada pin con su resistencia de 220Ω. Con analogWrite (PWM) mezclás cualquier color.",
      // 3 de los 6 pines PWM del UNO se van en un solo RGB: eso hay que decirlo
      // antes, no cuando el servo del mismo circuito se queda sin dónde ir.
      //
      // OJO CON LO QUE *NO* DICE, que es la mitad del arreglo: la salvedad del azul
      // (que sobre 3,3 V casi no prende porque su Vf ronda esa misma tensión) es un
      // problema del ESP32 y acá no existe — con 5 V el azul enciende bien. La
      // escribí igual "por las dudas" en el primer borrador y la cazó el test que
      // barre la jerga de la otra placa. Copiar el matiz ajeno es exactamente el
      // fallback silencioso que esta tanda vino a matar, sólo que a mano.
      uno: "el LED RGB combina 3 colores y cada pata lleva su resistencia de 220Ω. Para mezclar colores con analogWrite, los tres van a pines PWM — los marcados con ~ — así que este solo componente se lleva 3 de los 6 que tiene el UNO: si además querés un servo, planificá los pines.",
    },
    anim: (id) => `const e=document.getElementById('${id}');let h=0;setInterval(()=>{h=(h+8)%360;const c=h/60,x=1-Math.abs(c%2-1);let r=0,g=0,b=0;if(c<1){r=1;g=x}else if(c<2){r=x;g=1}else if(c<3){g=1;b=x}else if(c<4){g=x;b=1}else if(c<5){r=x;b=1}else{r=1;b=x}if(e){e.ledRed=r>0.3;e.ledGreen=g>0.3;e.ledBlue=b>0.3}},120);`,
  },

  ldr: {
    tag: "wokwi-photoresistor-sensor",
    etiqueta: "Sensor de luz (LDR)",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "OUT / AO", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: "AO" },
    ],
    advertencia: {
      esp32: "el LDR mide luz. Su salida va a un pin analógico (GPIO34/35). analogRead da 0-4095 en ESP32 (0=oscuro, 4095=mucha luz).",
      uno: `el LDR mide luz. Su salida analógica va a cualquiera de A0 a A5, y analogRead devuelve de 0 a ${PLACAS.uno.adcMax}. No te fijes en el número absoluto: cambia con la lámpara del aula y con el módulo. Medí primero a oscuras y con luz, y recién ahí elegís el umbral.`,
    },
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  oled: {
    tag: "wokwi-ssd1306",
    etiqueta: "Display OLED",
    voltaje: "3.3V",
    pines: [
      // `3V3` y NO `VIN`: la pieza saca DOS pines de alimentación y hay que elegir
      // el que corresponde al riel que pide esta fila. El destino de acá es `V3`, y
      // los `signals` de la pieza desempatan sin opinión de nadie: `3V3` declara
      // `{type:"power",signal:"VCC",voltage:3.3}` y `VIN` declara VCC sin voltaje.
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V3", pinPieza: "3V3" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      // El OLED es la pieza donde MENOS coinciden los nombres: el bus I2C se llama
      // `DATA`/`CLK`, no `SDA`/`SCL`. Los `signals` lo confirman (i2c SDA / i2c SCL).
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", destino: "SDA", pinPieza: "DATA" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", destino: "SCL", pinPieza: "CLK" },
    ],
    advertencia: {
      esp32: "el OLED SSD1306 es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x3C). Librerías: Adafruit_SSD1306 + Adafruit_GFX.",
      // La alimentación se DICE, no se manda a mirar la tabla. La versión anterior
      // ("la que muestra la tabla de acá abajo") estaba escrita para esquivar el
      // barrido de jerga del test, que prohibía "3,3 V" en toda la prosa de UNO.
      // El UNO TIENE riel de 3,3 V (skills/sensores/SKILL.md, columna "En Arduino
      // UNO" del BMP180), así que nombrarlo es lo correcto, no la jerga de la otra
      // placa. El módulo es de 3,3 V y a 3,3 V es a donde lo dibuja este tool.
      uno: "el OLED SSD1306 es I2C: en el UNO va a SDA=A4 y SCL=A5, dirección 0x3C. Mientras esté conectado, A4 y A5 dejan de servir como entradas analógicas: te quedan A0 a A3. El módulo es de 3,3 V, así que el cable rojo va al riel de 3,3 V del UNO y NO a los 5 V. Librerías: Adafruit_SSD1306 + Adafruit_GFX. Si no aparece nada, casi siempre falta el oled.display() del final.",
    },
    anim: (id) => `const o=document.getElementById('${id}');`,
  },

  "7segmentos": {
    tag: "wokwi-7segment",
    etiqueta: "Display 7 segmentos",
    voltaje: "3.3V",
    pines: [
      // UNA etiqueta, SIETE agujeros: por eso el anclaje es una lista y su largo
      // tiene que dar igual que `cantidad`. El orden es el de la etiqueta (A→G) y
      // el mismo con el que `{0-6}` reparte los pines de la placa, así que el que
      // dibuja puede aparear las dos listas por índice.
      { nombre: "Segmentos A-G", color: CABLE.naranja, clase: "digital", rol: "{0-6} (cada segmento con {R})", cantidad: 7, pinPieza: ["A", "B", "C", "D", "E", "F", "G"] },
      // La pieza saca el común dos veces (`COM.1` abajo, `COM.2` arriba), que es el
      // display de verdad: los dos comunes están unidos adentro. Punto = mismo nodo,
      // igual que `GND.1/.2/.3` del UNO. Se elige el de abajo, que es el header
      // donde también caen C, D, E y DP.
      { nombre: "Común", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "COM.1" },
    ],
    advertencia: {
      esp32: "el display de 7 segmentos muestra un dígito. Cada segmento (A-G) va a un GPIO con su resistencia de 220Ω. Conviene la librería SevSeg para no gastar tantos pines.",
      uno: "el display de 7 segmentos muestra un dígito. Cada segmento (A-G) va a un pin digital con su resistencia de 220Ω — el mismo valor en las dos placas. Son 7 pines de los 14 del UNO para UN dígito: si querés más de uno, la librería SevSeg los multiplexa y te ahorra pines.",
    },
    anim: (id) => `const d=document.getElementById('${id}');const digs=[[1,1,1,1,1,1,0,0],[0,1,1,0,0,0,0,0],[1,1,0,1,1,0,1,0],[1,1,1,1,0,0,1,0],[0,1,1,0,0,1,1,0]];let i=0;setInterval(()=>{i=(i+1)%digs.length;if(d)d.values=digs[i];},800);`,
  },

  neopixel: {
    tag: "wokwi-neopixel",
    etiqueta: "NeoPixel (LED inteligente)",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: "VDD" },
      { nombre: "DIN (datos)", color: CABLE.verde, clase: "digital", rol: "{0}", pinPieza: "DIN" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "VSS" },
    ],
    advertencia: {
      esp32: "el NeoPixel (WS2812) es un LED RGB direccionable: con UN solo pin de datos controlás muchos en cadena. Librería: Adafruit_NeoPixel. Mejor alimentarlo de 5V.",
      // OJO: el NeoPixel NO usa analogWrite, así que NO pide un pin PWM. Su dato es
      // un tren de pulsos con tiempos propios que arma la librería. Marcarlo como
      // PWM le comería al UNO uno de sus seis pines ~ sin ninguna razón.
      uno: "el NeoPixel (WS2812) es un LED RGB direccionable: con UN solo pin de datos controlás muchos en cadena, y ese pin puede ser cualquier digital (no hace falta que sea PWM: la librería arma los tiempos ella misma). Se alimenta de 5V. Librería: Adafruit_NeoPixel.",
    },
    anim: (id) => `const n=document.getElementById('${id}');let h=0;setInterval(()=>{h=(h+10)%360;const c=h/60,x=Math.round((1-Math.abs(c%2-1))*255);let r=0,g=0,b=0;if(c<1){r=255;g=x}else if(c<2){r=x;g=255}else if(c<3){g=255;b=x}else if(c<4){g=x;b=255}else if(c<5){r=x;b=255}else{r=255;b=x}if(n){n.r=r;n.g=g;n.b=b;}},120);`,
  },

  joystick: {
    tag: "wokwi-analog-joystick",
    etiqueta: "Joystick analógico",
    voltaje: "3.3V",
    interactivo: true,
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      // OJO EL CRUCE: la pieza no dice X/Y, dice HORZ/VERT. El eje X es el
      // horizontal y el Y el vertical, así que van cruzados respecto del orden en
      // que la pieza los publica (VERT primero, HORZ después).
      { nombre: "VRx (eje X)", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: "HORZ" },
      { nombre: "VRy (eje Y)", color: CABLE.azul, clase: "analogico", rol: "{1} (analógico)", pinPieza: "VERT" },
      { nombre: "SW (botón)", color: CABLE.verde, clase: "digital", rol: "{2}", pinPieza: "SEL" },
    ],
    advertencia: {
      esp32: "el joystick tiene 2 ejes analógicos (X, Y) que se leen con analogRead, y un botón al apretarlo. Ideal para mover algo en 2 direcciones (un robot, un juego).",
      uno: `el joystick se lleva DOS entradas analógicas (los ejes X e Y, con analogRead de 0 a ${PLACAS.uno.adcMax}) más un pin digital para el botón. En reposo cada eje queda cerca de la mitad, no en cero. Ideal para mover algo en 2 direcciones (un robot, un juego); en el UNO, con A0 a A5, dos joysticks ya te dejan sólo dos analógicas libres.`,
    },
    anim: (id) => `const j=document.getElementById('${id}');`,
  },

  mpu6050: {
    tag: "wokwi-mpu6050",
    etiqueta: "Acelerómetro MPU6050",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V3", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", destino: "SDA", pinPieza: "SDA" },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", destino: "SCL", pinPieza: "SCL" },
    ],
    advertencia: {
      esp32: "el MPU6050 mide aceleración (3 ejes) y giro (3 ejes) — detecta inclinación, movimiento, caídas. Es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x68; si conectás AD0 a 3.3V pasa a 0x69). Librería: Adafruit_MPU6050 + Adafruit_Sensor. Proyectos: nivel digital, dron, control por gestos.",
      // Misma corrección que el OLED: el aviso decía "alimentalo como dice la tabla"
      // sólo porque el test prohibía escribir "3,3 V" en la prosa de UNO.
      uno: "el MPU6050 mide aceleración (3 ejes) y giro (3 ejes) — detecta inclinación, movimiento, caídas. En el UNO es I2C por SDA=A4 y SCL=A5, y mientras esté conectado esas dos dejan de servir como entradas analógicas. La dirección es 0x68 con AD0 suelto o a GND. El módulo es de 3,3 V, así que VCC va al riel de 3,3 V del UNO y NO a los 5 V. Librería: Adafruit_MPU6050 + Adafruit_Sensor. Proyectos: nivel digital, dron, control por gestos.",
    },
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
      // LA PIEZA ES BIPOLAR Y EL CATÁLOGO ES UNIPOLAR: no es un nombre que falte, es
      // otro motor. `wokwi-stepper-motor` publica `A-` `A+` `B+` `B-`, los cuatro
      // extremos de dos bobinas sueltas. Acá arriba está el 28BYJ-48 de los kits:
      // cinco hilos, con el rojo que es el PUNTO MEDIO de las dos bobinas y va al
      // ULN2003. Ese hilo no existe en una bipolar, y los otros cuatro no van a la
      // placa sino al driver, así que tampoco hay punta de placa que anclar.
      { nombre: "Bobinas (4 hilos)", color: CABLE.naranja, clase: "fijo", destino: afuera("Driver ULN2003 (OUT)"), pinPieza: { sinAnclaje: "la pieza dibuja un paso a paso BIPOLAR (A-/A+/B+/B-) y el catálogo modela el 28BYJ-48 unipolar de 5 hilos: los cuatro hilos no se corresponden uno a uno, y además van al driver y no a la placa." } },
      { nombre: "Común (hilo rojo)", color: CABLE.rojo, clase: "fijo", destino: afuera("Driver ULN2003 (5V)"), pinPieza: { sinAnclaje: "el hilo rojo es el punto medio de las bobinas del 28BYJ-48 unipolar; una bipolar no tiene punto medio, así que la pieza no publica ningún contacto equivalente." } },
    ],
    advertencia: "el motor paso a paso (28BYJ-48) gira en pasos exactos, ideal para posición precisa (impresora, reloj, persiana). NO se conecta al ESP32: su conector de 5 hilos va al driver ULN2003, y son los IN1-IN4 del driver los que van a los GPIO. El motor se alimenta de 5V desde el driver. Librería: Stepper o AccelStepper.",
    anim: (id) => `const s=document.getElementById('${id}');let a=0;setInterval(()=>{a=(a+6)%360;if(s)s.angle=a;},40);`,
  },

  teclado: {
    tag: "wokwi-membrane-keypad",
    etiqueta: "Teclado matricial 4x4",
    voltaje: "3.3V",
    pines: [
      { nombre: "Filas (R1-R4)", color: CABLE.naranja, clase: "digital", rol: "{0-3}", cantidad: 4, pinPieza: ["R1", "R2", "R3", "R4"] },
      { nombre: "Columnas (C1-C4)", color: CABLE.verde, clase: "digital", rol: "{4-7}", cantidad: 4, pinPieza: ["C1", "C2", "C3", "C4"] },
    ],
    advertencia: {
      esp32: "el teclado 4x4 tiene 16 teclas pero usa solo 8 pines (4 filas + 4 columnas) gracias a la lectura matricial. Para ingresar claves, menús, números. Librería: Keypad.",
      uno: "el teclado 4x4 tiene 16 teclas pero usa solo 8 pines (4 filas + 4 columnas) gracias a la lectura matricial. En el UNO eso es 8 de los 14 digitales: queda poco para lo demás, y si el circuito lleva servo conviene mirar qué pines ~ quedaron libres. Librería: Keypad.",
    },
    anim: (id) => `const k=document.getElementById('${id}');`,
  },

  llama: {
    tag: "wokwi-flame-sensor",
    etiqueta: "Sensor de llama",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "DO (digital)", color: CABLE.naranja, clase: "digital", rol: "{0}", pinPieza: "DOUT" },
    ],
    advertencia: {
      esp32: "el sensor de llama detecta fuego/luz infrarroja cercana. Salida digital DO (hay fuego o no) o analógica AO (nivel). Alarma de incendio, robot bombero. Tiene un potenciómetro para ajustar la sensibilidad.",
      uno: "el sensor de llama detecta fuego/luz infrarroja cercana. Acá se usa su salida digital DO (hay fuego o no), que va a cualquier pin digital; si querés el nivel, el módulo también trae AO y ahí va a una entrada analógica. El potenciómetro de la plaquita ajusta a partir de qué nivel dispara el DO: calibralo con la llama a la distancia de trabajo, no en el escritorio.",
    },
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 10px #e74c3c)':'none';},700);`,
  },

  sonido: {
    tag: "wokwi-small-sound-sensor",
    etiqueta: "Sensor de sonido",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "DO (digital)", color: CABLE.verde, clase: "digital", rol: "{0}", pinPieza: "DOUT" },
    ],
    advertencia: {
      esp32: "el sensor de sonido detecta ruido (un aplauso, un golpe). Salida digital DO (umbral ajustable con el potenciómetro). Aplauso que prende la luz, alarma de ruido.",
      uno: "el sensor de sonido detecta ruido (un aplauso, un golpe). Su salida digital DO va a cualquier pin digital, y el umbral lo ajustás con el potenciómetro de la plaquita. No mide cuán fuerte es el ruido: avisa que pasó de un nivel. Aplauso que prende la luz, alarma de ruido.",
    },
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.opacity=on?'1':'0.7';},400);`,
  },

  ntc: {
    tag: "wokwi-ntc-temperature-sensor",
    etiqueta: "Sensor de temperatura NTC",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "OUT (analógico)", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: "OUT" },
    ],
    advertencia: {
      esp32: "el NTC es un termistor: su resistencia cambia con la temperatura. Salida analógica (analogRead, 0-4095). Más simple que el DHT pero mide solo temperatura. Termómetro, control de ventilador.",
      uno: `el NTC es un termistor: su resistencia cambia con la temperatura. Su salida va a una entrada analógica (A0 a A5) y analogRead devuelve de 0 a ${PLACAS.uno.adcMax}. Ese número no son grados: hay que convertirlo. Más simple que el DHT pero mide solo temperatura. Termómetro, control de ventilador.`,
    },
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  "ir-receptor": {
    tag: "wokwi-ir-receiver",
    etiqueta: "Receptor infrarrojo (IR)",
    voltaje: "3.3V",
    pines: [
      { nombre: "OUT (señal)", color: CABLE.amarillo, clase: "digital", rol: "{0}", pinPieza: "DAT" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: "VCC" },
    ],
    advertencia: "el receptor IR lee los códigos de un control remoto (TV, aire). Cada botón manda un código distinto. Librería: IRremote. Controlar el ESP32 con un control remoto común.",
    anim: (id) => `const s=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(s)s.style.filter=on?'drop-shadow(0 0 8px #f1c40f)':'none';},600);`,
  },

  tilt: {
    tag: "wokwi-tilt-switch",
    etiqueta: "Sensor de inclinación",
    voltaje: "3.3V",
    pines: [
      // OTRA VEZ DOS COSAS DISTINTAS. Acá arriba hay un tilt PELADO: dos patas, una
      // al GPIO con INPUT_PULLUP y la otra a masa. La pieza `wokwi-tilt-switch`
      // publica `GND` `VCC` `OUT`, o sea el MÓDULO con comparador, que necesita
      // alimentación propia. Anclar "Pata 1" a `OUT` dibujaría un módulo sin VCC:
      // un circuito que no puede andar, con los cables saliendo prolijos de los
      // agujeros equivocados. Se declara hasta que uno de los dos lados se mueva.
      { nombre: "Pata 1", color: CABLE.verde, clase: "digital", rol: "{0} (INPUT_PULLUP)", pinPieza: { sinAnclaje: "la pieza es el MÓDULO de tilt (GND/VCC/OUT, con comparador) y el catálogo modela el interruptor pelado de dos patas: OUT no es una pata del switch, y el módulo además pide un VCC que este circuito no cablea." } },
      { nombre: "Pata 2", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: { sinAnclaje: "misma discordancia: el GND de la pieza es la masa de alimentación del módulo, no la segunda pata del interruptor." } },
    ],
    advertencia: {
      esp32: "el sensor de inclinación (tilt) es como un interruptor que se activa al inclinarlo (una bolita adentro cierra el contacto). Detecta si algo se volcó o se movió. Usalo con INPUT_PULLUP.",
      uno: "el sensor de inclinación (tilt) es como un interruptor que se activa al inclinarlo (una bolita adentro cierra el contacto). Detecta si algo se volcó o se movió. Va con INPUT_PULLUP: una pata al pin y la otra a GND, sin resistencia externa. Rebota como un pulsador, así que filtralo igual.",
    },
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
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V5", pinPieza: "VCC" },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: "GND" },
      { nombre: "IN (señal)", color: CABLE.naranja, clase: "digital", rol: "{0}", pinPieza: "IN" },
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
      { nombre: "+ (potencia)", color: CABLE.rojo, clase: "fijo", destino: afuera("Relé / fuente externa"), pinPieza: { sinAnclaje: "pb-bomba declara `sinPinesDibujados`: el SVG es cuerpo, impulsor y caño, los dos cables de potencia no están dibujados." } },
      { nombre: "− (potencia)", color: CABLE.marron, clase: "fijo", destino: afuera("GND fuente"), pinPieza: { sinAnclaje: "pb-bomba declara `sinPinesDibujados`: el SVG es cuerpo, impulsor y caño, los dos cables de potencia no están dibujados." } },
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
      { nombre: "+ (potencia)", color: CABLE.rojo, clase: "fijo", destino: afuera("Relé / fuente 12V"), pinPieza: { sinAnclaje: "pb-valvula declara `sinPinesDibujados`: está el cuerpo del solenoide sobre el caño, los dos cables de la bobina no están dibujados." } },
      { nombre: "− (potencia)", color: CABLE.marron, clase: "fijo", destino: afuera("GND fuente"), pinPieza: { sinAnclaje: "pb-valvula declara `sinPinesDibujados`: está el cuerpo del solenoide sobre el caño, los dos cables de la bobina no están dibujados." } },
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
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: { sinAnclaje: "pb-higrometro declara `sinPinesDibujados`: lo dorado son los electrodos que se clavan en la tierra; los pads/header donde se sueldan los cables no están dibujados." } },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: { sinAnclaje: "pb-higrometro declara `sinPinesDibujados`: los pads/header no están dibujados." } },
      { nombre: "AO (analógico)", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: { sinAnclaje: "pb-higrometro declara `sinPinesDibujados`: el módulo comparador con VCC/GND/AO no está dibujado." } },
    ],
    advertencia: {
      esp32:
        "el higrómetro mide la humedad de la tierra. Su salida analógica AO va a un pin ADC (GPIO34/35): suelo seco da un valor, suelo húmedo otro (analogRead 0-4095). ⚠️ La sonda se corroe si queda siempre energizada: alimentala desde un GPIO y prendela solo al medir.",
      uno: `el higrómetro mide la humedad de la tierra. Su salida analógica AO va a una entrada analógica (A0 a A5): suelo seco da un valor, suelo húmedo otro, y analogRead devuelve de 0 a ${PLACAS.uno.adcMax}. Calibralo con la tierra del maceta real, seca y regada, antes de fijar el umbral. ⚠️ La sonda se corroe si queda siempre energizada: alimentala desde un pin digital y prendela sólo al medir.`,
    },
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.05;if(s)s.style.opacity=(0.7+0.3*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  lluvia: {
    tag: "pb-lluvia",
    etiqueta: "Sensor de lluvia",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "VLOGICA", pinPieza: { sinAnclaje: "pb-lluvia declara `sinPinesDibujados`: la grilla dorada es el área sensible a las gotas; el header de 2 pines no está dibujado." } },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: { sinAnclaje: "pb-lluvia declara `sinPinesDibujados`: el header de 2 pines no está dibujado." } },
      { nombre: "AO (analógico)", color: CABLE.violeta, clase: "analogico", rol: "{0} (analógico)", pinPieza: { sinAnclaje: "pb-lluvia declara `sinPinesDibujados`: el módulo con VCC/GND/AO no está dibujado." } },
    ],
    advertencia: {
      esp32:
        "el sensor de lluvia detecta gotas sobre su placa. Salida analógica AO (cuánta agua hay) o digital DO (llueve / no llueve). Funciona a 3.3V. Útil en estación meteorológica.",
      uno: `el sensor de lluvia detecta gotas sobre su placa. Acá se usa su salida analógica AO (cuánta agua hay), que va a una entrada analógica y devuelve de 0 a ${PLACAS.uno.adcMax}; el módulo también trae una salida digital DO si sólo te interesa llueve/no llueve. Útil en estación meteorológica.`,
    },
    anim: (id) => `const s=document.getElementById('${id}');let t=0;setInterval(()=>{t+=0.07;if(s)s.style.opacity=(0.75+0.25*Math.abs(Math.sin(t))).toFixed(2);},60);`,
  },

  bmp180: {
    tag: "pb-bmp180",
    etiqueta: "Sensor de presión BMP180",
    voltaje: "3.3V",
    pines: [
      { nombre: "VCC", color: CABLE.rojo, clase: "fijo", destino: "V3", pinPieza: { sinAnclaje: "pb-bmp180 declara `sinPinesDibujados`: está la placa y el chip, la tira de 4 pines VCC/GND/SDA/SCL no está dibujada." } },
      { nombre: "GND", color: CABLE.marron, clase: "fijo", destino: "GND", pinPieza: { sinAnclaje: "pb-bmp180 declara `sinPinesDibujados`: la tira de 4 pines no está dibujada." } },
      { nombre: "SDA", color: CABLE.azul, clase: "fijo", destino: "SDA", pinPieza: { sinAnclaje: "pb-bmp180 declara `sinPinesDibujados`: la tira de 4 pines no está dibujada." } },
      { nombre: "SCL", color: CABLE.violeta, clase: "fijo", destino: "SCL", pinPieza: { sinAnclaje: "pb-bmp180 declara `sinPinesDibujados`: la tira de 4 pines no está dibujada." } },
    ],
    advertencia: {
      esp32:
        "el BMP180 mide presión atmosférica y temperatura. Es I2C (SDA=GPIO21, SCL=GPIO22, dirección 0x77). Sirve para estación meteorológica y como altímetro. Librería: Adafruit_BMP085.",
      // Éste es el único de los tres que tiene columna "En Arduino UNO" propia en el
      // repo (skills/sensores/SKILL.md, tabla del BMP180): VCC → 3.3V, igual que en
      // el ESP32. Por eso se dibuja a 3,3 V y el texto lo dice.
      //
      // El mismo skill aclara que "los módulos GY traen regulador y toleran 5V en
      // VCC, pero el chip es de 3.3V". TOLERAR no es DONDE VA: la tabla del propio
      // skill manda 3.3V en las dos placas, y el pibe cablea lo que lee. La
      // tolerancia se nombra como dato tranquilizador, no como instrucción.
      uno: "el BMP180 mide presión atmosférica y temperatura. En el UNO es I2C por SDA=A4 y SCL=A5 (dirección 0x77), y mientras esté conectado esas dos dejan de servir como entradas analógicas. VCC va al riel de 3,3 V del UNO: el chip es de 3,3 V. Si el módulo es de los GY, el regulador que trae aguanta 5 V en VCC sin romperse, pero igual conviene los 3,3 V, que es lo que dibuja esta hoja. Sirve para estación meteorológica y como altímetro. Librería: Adafruit_BMP085.",
    },
    anim: () => ``,
  },

  motor: {
    tag: "pb-motor",
    etiqueta: "Motor DC",
    voltaje: "5V",
    pines: [
      // pb-motor SÍ tiene sus dos lengüetas dibujadas y publicadas (`+` y `-`), así
      // que se anclan aunque la otra punta caiga afuera de la placa: el que dibuja
      // resuelve cada punta por separado.
      { nombre: "+ (vía driver)", color: CABLE.rojo, clase: "fijo", destino: afuera("Driver (L298N/ULN2003)"), pinPieza: "+" },
      { nombre: "− (vía driver)", color: CABLE.marron, clase: "fijo", destino: afuera("Driver"), pinPieza: "-" },
    ],
    advertencia: {
      esp32:
        "el motor DC NO se conecta directo al ESP32 (lo quemaría por la corriente). Va por un driver (L298N, ULN2003) que recibe la señal del GPIO y le da potencia desde una fuente externa.",
      uno: "el motor DC NO se conecta directo al Arduino UNO (lo quemaría por la corriente: un pin del micro no da ni de cerca lo que pide un motor). Va por un driver (L298N, ULN2003) que recibe la señal de la placa y le da potencia desde una fuente externa. Si además querés controlar la VELOCIDAD, la entrada de habilitación del driver tiene que ir a un pin PWM (los del ~). Y la tierra en común entre placa, driver y fuente: sin eso no anda nada.",
    },
    anim: () => ``,
  },

  driver: {
    tag: "pb-driver",
    etiqueta: "Driver ULN2003",
    voltaje: "5V",
    // OJO: IN1-IN4 NO piden PWM. El ULN2003 con un 28BYJ-48 se maneja con pasos
    // digitales, no con analogWrite (skills/modulos-avanzados: "⚡ 5V · Stepper o
    // AccelStepper · driver ULN2003"). Marcarlos `requierePwm` le comería al UNO
    // CUATRO de sus seis pines ~ para nada, y el servo del mismo circuito se
    // quedaría sin dónde ir con seis pines PWM libres.
    pines: [
      { nombre: "IN1", color: CABLE.naranja, clase: "digital", rol: "{0}", pinPieza: { sinAnclaje: "pb-driver declara `sinPinesDibujados`: los cuatro círculos verdes son los LED indicadores, la tira IN1..IN4 no está dibujada." } },
      { nombre: "IN2", color: CABLE.amarillo, clase: "digital", rol: "{1}", pinPieza: { sinAnclaje: "pb-driver declara `sinPinesDibujados`: la tira IN1..IN4 no está dibujada." } },
      { nombre: "IN3", color: CABLE.verde, clase: "digital", rol: "{2}", pinPieza: { sinAnclaje: "pb-driver declara `sinPinesDibujados`: la tira IN1..IN4 no está dibujada." } },
      { nombre: "IN4", color: CABLE.azul, clase: "digital", rol: "{3}", pinPieza: { sinAnclaje: "pb-driver declara `sinPinesDibujados`: la tira IN1..IN4 no está dibujada." } },
    ],
    advertencia: {
      esp32:
        "el driver ULN2003 amplifica las señales del ESP32 para mover lo que el GPIO no puede solo (motores DC, paso a paso, relés). IN1-IN4 van a GPIOs; la potencia sale a 5V desde su fuente.",
      uno: "el driver ULN2003 amplifica las señales del Arduino UNO para mover lo que un pin del micro no puede solo (motores DC, paso a paso, relés). IN1-IN4 van a cuatro pines digitales cualquiera —no hace falta que sean PWM— y la potencia sale a 5V desde su propia fuente. Acordate de unir las tierras.",
    },
    anim: (id) => `const e=document.getElementById('${id}');let on=false;setInterval(()=>{on=!on;if(e)e.style.filter=on?'drop-shadow(0 0 8px #27ae60)':'none';},700);`,
  },

  lampara: {
    tag: "pb-lampara",
    etiqueta: "Lámpara 220V",
    voltaje: "5V",
    attrs: () => `encendido`,
    pines: [
      { nombre: "Fase (vía relé)", color: CABLE.rojo, clase: "fijo", destino: afuera("Relé ← Red 220V"), pinPieza: { sinAnclaje: "pb-lampara declara `sinPinesDibujados`: no tiene terminales dibujados, tiene casquillo de rosca E27." } },
      { nombre: "Neutro", color: CABLE.marron, clase: "fijo", destino: afuera("Red 220V"), pinPieza: { sinAnclaje: "pb-lampara declara `sinPinesDibujados`: casquillo E27, sin terminales dibujados." } },
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
      { nombre: "Fase (vía relé)", color: CABLE.rojo, clase: "fijo", destino: afuera("Relé ← Red 220V"), pinPieza: { sinAnclaje: "pb-calefactor declara `sinPinesDibujados`: no tiene bornera ni cables dibujados." } },
      { nombre: "Neutro", color: CABLE.marron, clase: "fijo", destino: afuera("Red 220V"), pinPieza: { sinAnclaje: "pb-calefactor declara `sinPinesDibujados`: no tiene bornera ni cables dibujados." } },
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


/**
 * Por qué ese pin NO sirve para ESTE componente, aunque exista en la placa.
 *
 * Vive aparte de `placa.motivoRechazo` a propósito: son dos preguntas distintas.
 * "D14 no existe en el UNO" es un problema del pin; "D4 existe, anda perfecto, pero
 * no hace PWM y el servo lo necesita" es un problema del PAR pin+componente.
 * Mezclarlas daría mensajes que mienten sobre uno de los dos lados.
 *
 * En el ESP32 devuelve siempre null: `poolPwm` es undefined porque cualquier salida
 * hace PWM por `ledc`.
 */
function motivoSinPwm(placa: Placa, p: PinId, etiqueta: string): string | null {
  const pwm = placa.poolPwm
  if (!pwm || pwm.some((q) => mismoPin(q, p))) return null
  return `⚠️ ${placa.etiquetaPin(p)} no hace PWM en ${placa.etiqueta} y ${etiqueta} lo necesita para funcionar. Los únicos que hacen PWM (los marcados con ~) son ${pwm.map((q) => placa.etiquetaPin(q)).join(", ")}: le asigné uno de ésos.`
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
  marcaSinPin: string // "GPIO?" / "D? o A?": lo que la hoja escribe donde falta un pin
}

// FIX auditoría #1: sólo se imprime un pin de verdad; si no, "?" — nunca "GPIO-1".
// FIX auditoría B8: devolvía "GPIO?" y el rol YA traía el literal "GPIO" delante
// ("GPIO{0}"), así que al agotarse el pool imprimía "GPIOGPIO?" en la tabla de
// conexiones. Se lee como un error del programa, no como "acá falta un pin".
// FIX auditoría B6: {a-b} es una fila que consume VARIOS pines (7 segmentos,
// teclado) y los imprime todos: el pin reservado tiene que verse en la tabla.
//
// OJO CON EL ORDEN: `{R}` se expande PRIMERO, antes que los pines. Tiene que ser
// así porque el render de la resistencia (ver `armarCircuito`) corre un regex
// `(con XΩ)` sobre la etiqueta YA RESUELTA: si `{R}` llegara sin expandir, ese
// regex no matchearía y la resistencia dejaría de dibujarse en serie sobre el
// cable — en silencio, con la hoja saliendo igual de prolija.
function rellenarRol(rol: string, pines: (PinId | null)[], placa: Placa): string {
  const uno = (i: number): string => {
    const p = pines[i]
    if (p == null) return "?"
    // n < 0 es el pin que no se pudo asignar: se imprime con su banco igual
    // ("GPIO?", "D?") para que la hoja y el aviso del chat digan lo mismo.
    return p.n < 0 ? `${p.banco}?` : placa.etiquetaPin(p)
  }
  return rol
    .replace(/\{R\}/g, placa.resistenciaLed)
    .replace(/\{(\d+)-(\d+)\}/g, (_, a: string, b: string) => {
      const lista: string[] = []
      for (let i = Number(a); i <= Number(b); i++) lista.push(uno(i))
      return lista.join(", ")
    })
    .replace(/\{(\d+)\}/g, (_, i: string) => uno(Number(i)))
}

/**
 * Reparte los pines, y devuelve los avisos por CANALES SEPARADOS, a propósito.
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
 * - `notas`  → el CHAT, y SÓLO lo que significa "no te di lo que pediste". La nota
 *              de pin (strapping en el ESP32, D0/D1/D13 en el UNO) NO entra acá a
 *              propósito: ese pin sí se te dio y anda, es una sugerencia. Si el chat
 *              avisa de todo, la docente aprende a saltearse los ⚠️ y el aviso que
 *              sí importa deja de existir.
 * - `sinPin` → los componentes que quedaron SIN pin (pool agotado). No es una nota
 *              más: es un circuito INCOMPLETO, y cambia cómo se anuncia el resultado.
 *
 * EL SET DE OCUPADOS VA POR CLAVE, NO POR NÚMERO, y ésa es la parte que había que
 * cambiar para que exista la segunda placa. En el ESP32 un `Set<number>` estaba
 * bien: el GPIO33 aparece en el pool digital y en el analógico porque ES EL MISMO
 * PIN. En el UNO, D4 y A4 son dos pines distintos que comparten el número: con un
 * Set numérico, asignar D4 bloquearía A4 y el tool diría "no quedan analógicas" con
 * A4 libre; y asignar A5 bloquearía D5, que es PWM, que es donde va el servo.
 */
function asignarGpios(
  pedidos: Pedido[],
  placa: Placa,
): {
  pines: (PinId | null)[][]
  avisos: string[]
  notas: string[]
  sinPin: string[]
} {
  const usados = new Set<string>()
  const avisos: string[] = []
  const notas: string[] = []
  const sinPin: string[] = []
  // "no te di lo que pediste" va a los DOS lados: la hoja y el chat.
  //
  // SIN REPETIR, y eso es un fix. La hoja deduplica sola porque `advertencias` es un
  // `Set`; el chat no, porque `notas` es un array. Con un componente que agota el
  // mismo pool DOS veces (el clásico: "joystick, joystick, joystick, lcd") la misma
  // línea de ⚠️ salía repetida en la respuesta mientras la hoja la mostraba una vez.
  // Dos canales que cuentan lo mismo tienen que contarlo igual.
  const avisar = (texto: string): void => {
    if (!avisos.includes(texto)) avisos.push(texto)
    if (!notas.includes(texto)) notas.push(texto)
  }
  // La nota del pin va SÓLO a la hoja (ver el contrato de arriba).
  const anotarPin = (p: PinId): void => {
    const nota = placa.notaDePin?.(p)
    if (nota && !avisos.includes(nota)) avisos.push(nota)
  }
  const poolDig = [...placa.poolDigital]
  const poolAna = [...placa.poolAnalogico]
  const poolPwm = placa.poolPwm ? [...placa.poolPwm] : null
  const resultado: (PinId | null)[][] = []

  // FIX auditoría #7: sembrar los pines fijos del bus I2C en 'usados'.
  //
  // Antes esto se hacía con un regex sobre el literal del destino (/GPIO(\d+)/), y
  // ahí había un bug mudo esperando a la segunda placa: en el UNO el SDA se llama
  // "A4", ese regex no matchea, y los dos pines del bus quedaban SIN reservar. El
  // asignador después le daba A4 al primer sensor analógico y el LCD se quedaba sin
  // bus, con la hoja mostrando los dos cables en el mismo agujero. Ahora se pregunta
  // por el SÍMBOLO (SDA/SCL) y el pin lo dice la placa, así que no hay nada que
  // parsear ni nada que se pueda escribir distinto.
  for (const ped of pedidos) {
    const def = COMPONENTES[normalizarTipo(ped.tipo)]
    if (!def) continue
    for (const pin of def.pines) {
      if (pin.clase !== "fijo" || typeof pin.destino !== "string") continue
      if (pin.destino === "SDA") usados.add(clavePin(placa.i2c.sda))
      if (pin.destino === "SCL") usados.add(clavePin(placa.i2c.scl))
    }
  }

  /*
   * FIX auditoría B13: sembrar TAMBIÉN los pines que el usuario pidió a mano, igual
   * que arriba con los fijos del I2C.
   *
   * Sin esto el resultado dependía del ORDEN de la lista: "led, servo:4" le daba el
   * GPIO4 al LED automático (es el primero del pool) y el servo recibía "ya ocupado,
   * le asigné otro"; "servo:4, led" andaba perfecto. El mismo circuito, dos dibujos
   * distintos, y el aviso culpaba al usuario por un pin que nadie más había pedido.
   *
   * Se reserva sólo lo que DE VERDAD se va a poder usar (mismas funciones de motivos
   * que usa el aviso de abajo): un pin de flash, uno solo-entrada o uno que no hace
   * PWM no se reserva, se rechaza igual que antes. Si dos componentes piden el mismo
   * pin, gana el primero y el segundo recibe el "ya ocupado" — que ahí sí es cierto.
   */
  const manual = new Map<Pedido, PinId>()
  for (const ped of pedidos) {
    if (ped.gpio == null) continue
    const def = COMPONENTES[normalizarTipo(ped.tipo)]
    const primero = def?.pines.find((p): p is PinSenal => p.clase !== "fijo")
    if (!def || !primero) continue
    if ((primero.cantidad ?? 1) > 1) continue
    // El número que escribió el usuario ("led:4") no dice el banco: lo pone la clase
    // del pin. En el ESP32 hay uno solo; en el UNO, un pin digital es D4 y uno
    // analógico es A4, que son dos pines distintos con el mismo número.
    const pedido: PinId = { banco: bancoDe(placa, primero.clase), n: ped.gpio }
    if (placa.motivoRechazo(pedido, primero.clase, def.etiqueta)) continue
    if (primero.requierePwm && motivoSinPwm(placa, pedido, def.etiqueta)) continue
    if (usados.has(clavePin(pedido))) continue
    usados.add(clavePin(pedido))
    manual.set(ped, pedido)
  }

  const sacar = (pool: PinId[]): PinId | null => {
    while (pool.length) {
      const p = pool.shift()!
      if (!usados.has(clavePin(p))) return p
    }
    return null
  }

  for (const ped of pedidos) {
    const def = componenteDe(ped.tipo)
    const asignados: (PinId | null)[] = []
    const pinesSenal = def.pines.filter((p): p is PinSenal => p.clase !== "fijo")

    pinesSenal.forEach((pin, idx) => {
      // Una fila puede consumir varios pines (7 segmentos: 7, teclado: 4+4).
      const cuantos = pin.cantidad ?? 1

      // pin manual del alumno para el primer pin digital O analógico.
      // Ya quedó reservado (o rechazado) en la siembra de arriba: acá sólo se
      // usa, o se explica por qué no se pudo.
      if (idx === 0 && ped.gpio != null) {
        const reservado = manual.get(ped)
        if (reservado != null) {
          asignados.push(reservado)
          anotarPin(reservado)
          return
        }
        const pedido: PinId = { banco: bancoDe(placa, pin.clase), n: ped.gpio }
        if (cuantos > 1) {
          avisar(`${def.etiqueta} usa ${cuantos} pines, no uno: el ${placa.etiquetaPin(pedido)} que pediste no alcanza, así que se los asigné yo.`)
        } else {
          avisar(
            placa.motivoRechazo(pedido, pin.clase, def.etiqueta) ??
              (pin.requierePwm ? motivoSinPwm(placa, pedido, def.etiqueta) : null) ??
              `No pude usar ${placa.etiquetaPin(pedido)} para ${def.etiqueta} (ya ocupado): le asigné otro.`,
          )
        }
      }

      for (let n = 0; n < cuantos; n++) {
        // El orden importa: un pin que pide PWM sale del pool PWM aunque también
        // esté en el digital. Como los dos pools comparten el Set de ocupados por
        // clave, D5 no se puede entregar dos veces por venir en dos listas.
        const usaPwm = pin.requierePwm === true && poolPwm != null
        const g = usaPwm ? sacar(poolPwm!) : pin.clase === "analogico" ? sacar(poolAna) : sacar(poolDig)
        if (g == null) {
          avisar(
            usaPwm
              ? `No quedan pines PWM libres para ${def.etiqueta}: en ${placa.etiqueta} los únicos que hacen PWM son ${placa.poolPwm!.map((q) => placa.etiquetaPin(q)).join(", ")}. Revisalo a mano.`
              : `No quedan ${placa.nombreDePool[pin.clase]} libres para ${def.etiqueta}: revisalo a mano.`,
          )
          if (!sinPin.includes(def.etiqueta)) sinPin.push(def.etiqueta)
          asignados.push({ banco: bancoDe(placa, pin.clase), n: -1 })
          continue
        }
        usados.add(clavePin(g))
        anotarPin(g)
        asignados.push(g)
      }
    })

    resultado.push(asignados)
  }

  return { pines: resultado, avisos, notas, sinPin }
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

// LAYOUT POR FILAS (robusto): la placa fija a la izquierda + una fila por componente.
// Sin coordenadas globales en SVG estirado → las piezas y sus conexiones NUNCA se desalinean.
function armarCircuito(pedidos: Pedido[], placa: Placa, umbral?: number): ResultadoArmado {
  const { pines: pinesPorComp, avisos: avisosGpio, notas: notasGpio, sinPin } = asignarGpios(pedidos, placa)
  const puente = armarPuente(pedidos, umbral)
  const gobernado = puente ? puente.idActuador : null

  const filas: string[] = []
  const filasTabla: string[] = []
  const conexiones: string[] = []
  const anims: string[] = []
  const advertencias = new Set<string>()
  let hay5V = false
  let interactivo = false

  // Un pin fijo dice a qué RIEL va (V5, GND, SDA…) y la placa dice cómo se llama ese
  // riel en ella; los destinos de afuera de la placa (un driver, una fuente) son
  // texto y punto. El `??` de acá no puede dispararse: `motivoNoDibujable` ya rechazó
  // el circuito si la placa no tiene el riel, y se corre ANTES de llegar acá.
  const destinoFijo = (pin: PinFijo): string =>
    typeof pin.destino === "string" ? (placa.riel[pin.destino] ?? "?") : pin.destino.afuera
  const etiquetaDe = (pin: Pin, pines: (PinId | null)[]): string =>
    pin.clase === "fijo" ? destinoFijo(pin) : rellenarRol(pin.rol, pines, placa)

  pedidos.forEach((ped, i) => {
    const tipo = normalizarTipo(ped.tipo)
    const def = componenteDe(tipo)
    const id = `${tipo}${i}`
    const pines = pinesPorComp[i] ?? []

    if (def.voltaje === "5V") hay5V = true
    if (def.interactivo) interactivo = true
    // El texto de la placa que se pidió. Si el componente no la soportara, no
    // llegaríamos hasta acá: `motivoNoDibujable` corta antes. NUNCA cae al de ESP32.
    const aviso = avisoDe(def.advertencia, placa.id)
    if (aviso?.texto) advertencias.add(aviso.texto)

    // columna de conexiones: cada pin = nodo + etiqueta en cajita + cable CSS (flex).
    // El cable no tiene coordenadas: vive en la misma fila flex que su etiqueta, nunca se desalinea.
    // Las dos puntas de cada cable, con los nombres que la PIEZA y la PLACA usan
    // en el navegador. Acá sólo se emiten como atributos: el que dibuja los lee de
    // `el.pinInfo` y le pregunta a la pieza viva dónde cae ese agujero. Si un
    // atributo no está, ese cable se dibuja como hoy — el fallback es por cable.
    const filasIdx = indicesDeFila(def.pines)
    const conex = def.pines
      .map((pin, fila) => {
        const anclas = anclajesDeCable(pin, filasIdx[fila] ?? null, pines, placa)
        const dPlaca = anclas.placa ? ` data-placa="${anclas.placa.join(" ")}"` : ""
        const dPieza = anclas.pieza ? ` data-pieza="${anclas.pieza.join(" ")}"` : ""
        const destino = etiquetaDe(pin, pines)
        // R en serie: solo cuando "(con XΩ)" CIERRA la etiqueta (LED, RGB). El caso
        // "7 pines (cada segmento con 220Ω)" no matchea a proposito (una sola R para 7 pines mentiria).
        // OJO: este regex corre sobre la etiqueta YA RESUELTA, así que `rellenarRol`
        // tiene que haber expandido `{R}` antes (lo hace primero, ver allá).
        const conR = pin.clase !== "fijo" && destino.match(/^(.*?)\s*\(con\s*([\d.]+\s*[kKmM]?)\s*Ω\)\s*$/)
        const etiqueta = conR ? conR[1] : destino
        const valorR = conR ? (conR[2] ?? "").replace(/\s+/g, "") : null
        const cable = valorR
          ? `<span class="cable"></span><span class="res" title="Resistencia de ${valorR}Ω en serie">${valorR}Ω</span><span class="cable"></span>`
          : `<span class="cable"></span>`
        return `          <div class="pin" style="--c:${pin.color}"${dPlaca}${dPieza}>
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
    const resumen = def.pines.map((pin) => etiquetaDe(pin, pines)).join(" · ")
    const dots = def.pines
      .map((pin) => `<span class="dot" style="background:${pin.color}"></span>`)
      .join("")
    filasTabla.push(`      <tr><td>${def.etiqueta}</td><td>${dots}</td><td>${resumen}</td></tr>`)

    // La MISMA tabla, en texto plano, para devolvérsela al modelo (FIX auditoría A).
    // Se arma acá y no aparte para que no puedan divergir: si algún día la fila de la
    // hoja cambia, esta línea cambia con ella.
    conexiones.push(
      `${def.etiqueta}: ` + def.pines.map((pin) => `${pin.nombre} → ${etiquetaDe(pin, pines)}`).join(", "),
    )

    if (id !== gobernado) {
      anims.push(`(() => { ${def.anim(id, placa)} })();`)
    }
  })

  if (puente) {
    anims.push(puente.js)
    interactivo = true // si hay puente (incluido sensor→actuador con slider), es interactivo
  }

  // escena = grid [placa | columna de filas]
  //
  // El ancho de la primera columna sale de la placa y NO del CSS estático, y no es
  // cosmético: `transform:scale()` no cambia la caja de layout. El ESP32 ocupa 106,6
  // px reales aunque se pinte a 133, así que le sobraba lugar en los 230 px de
  // `.circuito-libre`; el UNO ocupa 274,3 px de verdad y en esa misma columna se
  // montaría 22 px sobre las conexiones, pisándole el texto a la docente.
  const escena = `
      <div class="circuito-libre" style="grid-template-columns:${placa.anchoColumna}px 1fr">
        <div class="esp-col"><${placa.tag} style="transform:scale(${placa.escala});transform-origin:center"></${placa.tag}></div>
        <div class="filas-libre">
${filas.join("\n")}
        </div>
      </div>`

  // El aviso de los 5V es de la placa: en el ESP32 hay dos mundos de tensión que se
  // pueden confundir, en el UNO hay uno solo y repetirlo sería ruido (además de
  // nombrar un pin, VIN, que en el UNO no se usa así).
  if (hay5V && placa.avisoCincoVolt) advertencias.add(placa.avisoCincoVolt)
  avisosGpio.forEach((a) => advertencias.add(a))
  const notas = [...notasGpio]
  for (const choque of avisosI2cRepetido(pedidos, placa)) {
    advertencias.add(choque)
    notas.push(choque)
  }
  const aviso = bloqueDeAvisos(Array.from(advertencias), interactivo)

  const tabla = `
      <tr><th>Componente</th><th>Cables</th><th>Conexiones al ${placa.etiqueta}</th></tr>
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
    marcaSinPin: marcaSinPin(placa, pinesPorComp),
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
function avisosI2cRepetido(pedidos: Pedido[], placa: Placa): string[] {
  // "es I2C" se pregunta por el SÍMBOLO del riel, no por el literal del pin. Antes
  // era `p.destino === "GPIO21"`, o sea: el detector reconocía dispositivos I2C sólo
  // si el bus se llamaba como en el ESP32. En el UNO el SDA es A4, ese literal no
  // matchea, y "oled, oled" se habría dibujado con los dos en el mismo bus, con la
  // misma dirección de fábrica, y SIN una palabra — el mismo bug F que este aviso
  // vino a matar, reencarnado en la segunda placa.
  const esI2c = (tipo: string): boolean =>
    (COMPONENTES[tipo]?.pines ?? []).some((p) => p.clase === "fijo" && p.destino === "SDA")

  const cuenta = new Map<string, number>()
  for (const ped of pedidos) {
    const t = normalizarTipo(ped.tipo)
    if (esI2c(t)) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  }

  const sda = placa.riel.SDA ?? "SDA"
  const scl = placa.riel.SCL ?? "SCL"
  return [...cuenta.entries()]
    .filter(([, n]) => n > 1)
    .map(
      ([t, n]) =>
        `Pediste ${n} unidades de "${componenteDe(t).etiqueta}" y las ${n} van al MISMO bus I2C (SDA=${sda}, SCL=${scl}) con la MISMA dirección de fábrica: ${placa.etiqueta} no las puede distinguir, así que en la placa real va a andar una sola. Para usar ${n} hay que cambiarle la dirección a las demás (es un puente/jumper en la plaquita, o el pin de dirección) o poner un multiplexor I2C TCA9548A. El cableado del dibujo está bien: lo que choca son las direcciones.`,
    )
}

/**
 * La cola del rechazo: "no te lo dibujo, PERO en tu shield va acá".
 *
 * Devuelve "" cuando no hay nada honesto que agregar — sin shield, o con un shield al
 * que no le conocemos zócalo para ese componente. Y ese "" es la mitad que importa: si
 * el docente NO tiene shield, mandarlo a un conector que su placa no tiene lo confunde
 * más que el rechazo pelado. Un aviso que sale siempre no es un aviso.
 *
 * Los pines NO se inventan acá ni se deducen: salen de `ZOCALOS_SENSOR_SHIELD`, que
 * refleja `skills/placas/SKILL.md` (entrada 02) y su cita al diagrama del fabricante.
 */
function avisoDeZocalos(
  tipos: string[],
  shield?: { nombre: string; zocalos: readonly ZocaloShield[]; version: string | null } | null,
): string {
  if (!shield) return ""
  const aplican = shield.zocalos.filter((z) => tipos.includes(z.tipo))
  if (!aplican.length) return ""

  // Si el docente NOMBRÓ una versión anterior a la que trae el zócalo, no lo mandamos
  // ahí: se lo decimos. Una v4 no tiene el URF01 — es un agregado de la v5.0.
  const viejas = aplican.filter((z) => shield.version !== null && shield.version < z.desde)
  if (viejas.length) {
    const z = viejas[0]!
    return ` Y ojo con una: el zócalo de ${componenteDe(z.tipo).etiqueta} (\`${z.zocalo}\`, a ${z.pines.join("/")}) es un agregado de la **${z.desde}** — tu ${shield.nombre} ${shield.version} NO lo trae, así que ahí sí va cableado a mano. Fijate el número impreso en la placa antes de buscar el conector.`
  }

  const frases = aplican.map(
    (z) =>
      `el ${componenteDe(z.tipo).etiqueta} NO se cablea pin por pin — tiene zócalo propio, \`${z.zocalo}\` (está pegado a ${z.referencia}), cableado a ${z.pines.join(" y ")}, y el módulo entra derecho ahí. El conector es \`${z.contactos.join(" · ")}\` en ese orden, así que fijate de no darlo vuelta`,
  )
  // Si NO nos dijo la versión, el dato se da con su versión al lado: el zócalo existe
  // desde la v5.0, y el docente tiene el número impreso en su placa para chequearlo.
  const cual = shield.version === null ? ` (esto es del **${aplican[0]!.desde}** — mirá el número impreso en tu placa)` : ""
  // El "igual" es literal: el docente se va sin el dibujo, pero CON la respuesta.
  return ` Ahora, una cosa sí te la puedo decir igual, y es la que te resuelve la mesa de trabajo: en tu ${shield.nombre}, ${frases.join("; y ")}${cual}. Así que no busques un par de pines digitales sueltos para eso — el shield ya te lo resolvió. (Lo tenés en el skill \`placas\`, entrada 02, con el diagrama del fabricante.)`
}

/**
 * Por qué este circuito NO se puede dibujar en esta placa, o null si se puede.
 *
 * El tool se NIEGA en vez de improvisar, y ésa es la decisión central de esta tanda.
 * Antes `advertencia` era un solo texto y se imprimía siempre; el día que apareció la
 * segunda placa, "usá GPIO34 o GPIO35 (solo-entrada)" se le iba a mostrar tal cual al
 * docente del UNO. Un fallback silencioso acá no es "algo es mejor que nada": el
 * texto equivocado suena exactamente igual de seguro que el correcto, y la docente no
 * tiene con qué darse cuenta. Prefiere no dibujar y decir qué falta.
 *
 * Cubre las dos formas de no soportar una placa:
 *  - el componente no tiene advertencia para ella (todavía no se portó), y
 *  - el componente necesita un riel que esa placa no tiene (`riel[x] === null`), que
 *    sería un cable dibujado hacia un pin inexistente.
 *
 * Y NEGARSE NO ES LO MISMO QUE CALLARSE. Si el docente pidió la placa CON shield, el
 * rechazo suma lo que sí sabemos: que ese componente tiene zócalo propio y no se cablea
 * pin por pin. No es un extra amable — es el hueco por el que se coló el bug. Ver
 * `ZOCALOS_SENSOR_SHIELD`.
 */
function motivoNoDibujable(
  pedidos: Pedido[],
  placa: Placa,
  shield?: { nombre: string; zocalos: readonly ZocaloShield[]; version: string | null } | null,
): string | null {
  if (placa.id === "esp32") return null
  const sinAviso: string[] = []
  const sinAvisoTipos: string[] = []
  const sinRiel: string[] = []
  for (const ped of pedidos) {
    const tipo = normalizarTipo(ped.tipo)
    const def = COMPONENTES[tipo]
    if (!def) continue
    if (!avisoDe(def.advertencia, placa.id) && !sinAviso.includes(def.etiqueta)) {
      sinAviso.push(def.etiqueta)
      sinAvisoTipos.push(tipo)
    }
    for (const pin of def.pines) {
      if (pin.clase !== "fijo" || typeof pin.destino !== "string") continue
      if (placa.riel[pin.destino] == null && !sinRiel.includes(def.etiqueta)) sinRiel.push(def.etiqueta)
    }
  }
  if (sinRiel.length) {
    return `No te lo dibujo, y es a propósito: ${sinRiel.join(" y ")} necesita${sinRiel.length > 1 ? "n" : ""} una alimentación que ${placa.etiqueta} no tiene en la placa. Si lo dibujara, el cable terminaría en un pin que no existe y la hoja se vería perfecta igual. Pedímelo con otra placa, o sacá ${sinRiel.length > 1 ? "esos componentes" : "ese componente"} de la lista.`
  }
  if (sinAviso.length) {
    return `Todavía no sé dibujar ${sinAviso.join(" y ")} en ${placa.etiqueta}: me falta la parte que explica cómo se conecta en ESA placa, y sin eso lo único que puedo hacer es mostrarte el texto del ESP32 como si fuera el tuyo — que es justo lo que no quiero hacer. En ESP32 sí lo tengo (pedímelo con placa="esp32"). En ${placa.etiqueta} puedo armarte el circuito con el resto de la lista si sacás ${sinAviso.length > 1 ? "esos" : "ése"}.${avisoDeZocalos(sinAvisoTipos, shield)}`
  }
  return null
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
function inyectarMando(pedidos: Pedido[], placa: Placa): { pedidos: Pedido[]; avisos: string[] } {
  const avisos: string[] = []
  // El "12 mA" es un dato del ESP32, y no se traduce a otra placa inventando otra
  // cifra: en el UNO se dice el HECHO (un pin del micro no da esa corriente) sin
  // ponerle un número que nadie verificó. Un dato preciso y falso es peor que uno
  // general y cierto, porque se copia al pizarrón.
  const porQueQuema =
    placa.id === "esp32"
      ? `directo al ${placa.etiqueta} (el GPIO entrega 12 mA y esto pide bastante más: lo quema)`
      : `directo al ${placa.etiqueta} (un pin del micro no entrega ni de cerca la corriente que esto pide: lo quema)`
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
        `Le agregué ${componenteDe(mando).etiqueta} al circuito: ${cargas[0]} no se puede conectar ${porQueQuema}. El ${placa.etiqueta} manda la señal al ${nombre}, y el ${nombre} mueve la potencia con su propia fuente.`,
      )
    } else if (cargas.length > 1) {
      avisos.push(
        `Le agregué un ${componenteDe(mando).etiqueta} POR CADA carga de potencia (${cargas.length} en total: ${cargas.join(" y ")}): ninguna se puede conectar ${porQueQuema}. Va uno por carga y no uno solo para todas porque un ${nombre} de un canal conmuta UNA sola cosa: con uno compartido, ${cargas.join(" y ")} se prenderían y apagarían siempre juntos. El ${placa.etiqueta} manda la señal a cada ${nombre}, y cada ${nombre} mueve su potencia con su propia fuente.`,
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
function sugerenciaQueEntra(crudo: Pedido[], placa: Placa): string {
  const entra = (lista: Pedido[]): boolean => lista.length > 0 && inyectarMando(lista, placa).pedidos.length <= 6
  const lista = [...crudo]
  // 1) se sacan los accesorios, de atrás para adelante; los actuadores de potencia no se tocan
  for (let i = lista.length - 1; i >= 0 && !entra(lista); i--) {
    if (POTENCIA[normalizarTipo(lista[i]!.tipo)]) continue
    lista.splice(i, 1)
  }
  // 2) si quedó sólo potencia y todavía no entra, recién ahí se recortan actuadores
  while (lista.length > 1 && !entra(lista)) lista.pop()
  return inyectarMando(lista, placa)
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
  // Mismo criterio que `componentes-extra.js`: si no está, la hoja sale con los cables
  // CSS de siempre. El <script> queda igual y el 404 no rompe nada — es el único asset
  // que se puede perder sin consecuencias, y por eso no entra en `faltanPiezasDibujadas`.
  const cables = cablesPath()
  const cablesLocal = join(dir, "cables.js")
  if (existsSync(cables) && hayQueCopiar(cables, cablesLocal)) await Bun.write(cablesLocal, Bun.file(cables))
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
<script src="cables.js"></script>
<style>${ESTILO}</style>
</head>
<body>
<div class="hoja">
  <h1>${p.titulo} <span class="badge">${p.interactivo ? "✋ interactivo" : "▶ animado"}</span></h1>
  <div class="sub">Esquema de conexión — Tecnia Bot · piezas reales, ${p.sub}</div>
  <div class="escena"${p.alto && p.alto > 0 ? ` style="height:${p.alto}px"` : ` style="height:auto"`}>${p.escena}</div>
  ${p.aviso ? `<div class="aviso">${p.aviso}</div>` : ""}
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

PLACA: el arg 'placa' elige qué placa se DIBUJA. "esp32" (default, ESP32 DevKit) o "uno" (Arduino UNO, que es la que más se usa con Sensor Shield en las escuelas técnicas). Preguntale al docente con cuál trabaja ANTES de dibujar; si te dice UNO, pasá placa="uno" y los pines salen D0-D13, A0-A5, PWM en los ~ y el I2C en A4/A5, como en su placa. Si el componente que pide todavía no está portado a esa placa, el tool NO dibuja: te dice cuál falta, y eso se lo contás — nunca le muestres el dibujo de otra placa como si fuera el suyo. Y cuando el tool rebota un componente, NO completes el hueco inventando pines en el chat: lo que vos escribís es lo que el pibe cablea, igual que el dibujo. Si el docente tiene shield, varios módulos tienen ZÓCALO propio y no van pin por pin (el HC-SR04 del Sensor Shield entra en el zócalo URF01, NO en un par de pines digitales elegidos "por ejemplo"); el rechazo del tool ya te manda al zócalo cuando lo sabe, y el resto lo tenés en el skill 'placas', entrada 02. Si no lo tenés escrito en ningún lado, decí que no lo sabés — no lo estimes.

⚠️ TODOS LOS PRESETS SON PARA ESP32: los nombres con "-esp32" y también estacion-meteo, alarma, semaforo y los -protoboard. Pedir un preset con placa="uno" se rechaza a propósito (sería una contradicción explícita), y el tool te dice qué lista de 'componentes' pedir en su lugar. El armador libre ('componentes') SÍ dibuja las dos placas.

Componentes sueltos: servo-esp32, led-esp32, ultrasonico-esp32, buzzer-esp32, dht22-esp32, pir-esp32, lcd-esp32.
INTERACTIVOS (el alumno controla con el mouse): potenciometro-esp32 (girá la perilla y cambia el brillo del LED), boton-esp32 (apretá el botón y se prende el LED).
Proyectos integradores (varios componentes): estacion-meteo (DHT22+LCD), alarma (PIR+buzzer+LED), semaforo (3 LEDs).
EXPLICADOR: circuito=protoboard genera un HTML interactivo para ENTENDER la protoboard/breadboard (tocás un agujero y se iluminan los que están conectados por dentro: filas, buses y canal central). Usalo cuando pidan ver/entender/cómo funciona el protoboard.
CIRCUITOS SOBRE PROTOBOARD (componentes reales pinchados en la placa + jumpers de colores): circuito=boton-led-protoboard (ESP32 + botón + LED, interactivo: apretás el botón y prende el LED) y circuito=semaforo-protoboard (3 LEDs verde/amarillo/rojo en secuencia de semáforo, animado). ⚠️ IMPORTANTE: si el pedido menciona "protoboard", "breadboard" o "placa de pruebas", usá SIEMPRE la versión -protoboard correspondiente, NO el esquema con cables (boton-esp32/semaforo).

ARMADOR LIBRE (combinaciones libres): si el pedido NO coincide con un preset (ej "ESP32 + 2 LEDs + potenciómetro + servo"), usá el arg 'componentes' con la lista separada por comas. Tipos: led, rgb-led, servo, stepper (motor paso a paso), motor (motor DC, va por driver), driver (ULN2003), potenciometro, joystick, buzzer, ultrasonico, dht22, ntc, pir, ldr, llama, sonido, ir (infrarrojo), tilt (inclinacion), lcd, oled, 7segmentos, neopixel, mpu6050 (acelerometro), teclado, boton, relay, bomba, valvula (electrovalvula), higrometro, lluvia, bmp180 (presion), lampara, calefactor. GPIO opcional con dos puntos: "led:2, led:4". El motor asigna pines, dibuja cables y combina animaciones solo. De 1 a 6 componentes.

PROYECTOS DEL INET: para riego usá "higrometro, relay, bomba" (movés la humedad y se enciende el riego); tanques "ultrasonico, relay, bomba"; calefacción "dht22, relay, calefactor"; lumínico "ldr, pir, relay, lampara"; estación meteo "dht22, lluvia, bmp180, lcd". Los actuadores de potencia (bomba, válvula, lámpara, calefactor, motor, stepper) van SIEMPRE por un relé o driver, nunca directos a la placa: si te olvidás de incluirlo, el tool lo agrega solo y te avisa qué agregó (contáselo al docente, es parte de la explicación). Estos proyectos hoy salen sólo en ESP32: el relé, la bomba, la válvula, la lámpara, el calefactor, el HC-SR04, el DHT22, el PIR, el IR y el motor paso a paso todavía no están portados al UNO, y el tool te lo dice si los pedís con placa="uno".`,
  args: {
    circuito: tool.schema
      .enum(["servo-esp32", "led-esp32", "ultrasonico-esp32", "buzzer-esp32", "potenciometro-esp32", "dht22-esp32", "pir-esp32", "lcd-esp32", "boton-esp32", "estacion-meteo", "alarma", "semaforo", "protoboard", "boton-led-protoboard", "semaforo-protoboard"])
      .optional()
      .describe("Preset validado. Usalo si el pedido coincide con uno de la lista. 'protoboard' genera un EXPLICADOR interactivo de la placa de pruebas (tocás un agujero y se iluminan los conectados) — usalo cuando pidan entender/ver el protoboard o breadboard. Para combinaciones libres usá 'componentes'."),
    componentes: tool.schema
      .string()
      .optional()
      .describe("ARMADOR LIBRE: lista de componentes separada por comas, ej 'led, led, potenciometro, servo'. Tipos: led, rgb-led, servo, stepper (motor paso a paso), motor (motor DC, va por driver), driver (ULN2003), potenciometro, joystick, buzzer, ultrasonico, dht22, ntc, pir, ldr, llama, sonido, ir (infrarrojo), tilt (inclinacion), lcd, oled, 7segmentos, neopixel, mpu6050 (acelerometro), teclado, boton, relay, bomba, valvula (electrovalvula), higrometro, lluvia, bmp180 (presion), lampara, calefactor. GPIO opcional con dos puntos: 'led:2, led:4'. El motor calcula posiciones y cables solo."),
    // String libre, NO enum, POR DECISIÓN DE DISEÑO — y ojo, que acá NO hay test.
    //
    // Este comentario decía "hay un test que lo exige (tests/resistencia-led:10)" y
    // era FALSO. El test 10 hace exactamente lo contrario: tiene a `circuito.ts` en
    // su lista blanca `DIBUJAN` y argumenta, con todas las letras, que acá el enum
    // sería CORRECTO — porque este arg declara qué placas el tool SABE DIBUJAR, no
    // cuáles EXISTEN, y eso sí es un conjunto cerrado y chico. Lo que el test 10
    // prohíbe es el enum en `perfil` y en `imprimible`, que GUARDAN y ROTULAN la
    // placa que el docente tiene en la mano. Convertir esto en enum deja la suite
    // entera en verde. Inventar una red que no existe es peor que no tenerla: el
    // que venga detrás confía en ella y no la escribe.
    //
    // Entonces, ¿por qué sigue siendo string? Porque el que valida es `execute` y es
    // lo ÚNICO que corre cuando los tests llaman al tool directo, sin pasar por el
    // schema — y porque el rechazo que escribe a mano dice "no la sé dibujar" y
    // manda al skill `placas`, en vez del error seco de un enum, que suena a "tu
    // placa no existe". Es una decisión de mensaje, no un invariante defendido.
    //
    // Si algún día merece red propia, hay que ESCRIBIRLA y recién ahí nombrarla acá.
    placa: tool.schema
      .string()
      .optional()
      .describe("Qué placa se dibuja: 'esp32' (default, ESP32 DevKit) o 'uno' (Arduino UNO). Preguntale al docente con cuál trabaja antes de generar: con 'uno' los pines salen D0-D13 / A0-A5, el PWM en los marcados con ~ y el I2C en A4/A5. Si algún componente del pedido todavía no está portado a esa placa, el tool no dibuja y te dice cuál falta — no le muestres el dibujo de otra placa como si fuera el suyo. SHIELDS: si el docente tiene un Sensor Shield o un IO Expansion, pasá el texto tal como te lo dijo ('uno con sensor shield') — el tool lo resuelve solo a la placa de abajo, porque un shield NO cambia ni un pin, y agrega el aviso de que en el shield se pincha en la terna de tres vías y no en el header. Lo que SÍ importa es nombrar la placa: 'esp32 con sensor shield' dibuja el ESP32, no el UNO. Y si con shield el tool rebota un componente, leé el rechazo entero antes de contestar: cuando ese módulo tiene zócalo dedicado te lo nombra con sus pines, y ESO es lo que le decís al docente — no improvises un par de pines digitales para tapar el hueco."),
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

    /*
     * QUÉ PLACA SE DIBUJA, y se valida acá adentro a propósito.
     *
     * El schema del arg es un string libre (ver el comentario de `placa` más arriba:
     * el catálogo de placas que EXISTEN es del skill `placas`, no de este tool), así
     * que el único que puede decir "esa no la sé dibujar" es execute. Y tiene que
     * poder: los tests llaman a execute directo, sin pasar por el schema, y un modelo
     * puede mandar cualquier cosa igual.
     *
     * El default es "esp32" y eso NO cambia: los tests que ya había se escribieron
     * contra el ESP32 y tienen que seguir dando exactamente lo mismo. La segunda placa
     * se pide, no se adivina.
     *
     * AUSENTE ≠ BASURA, y esto es un fix: la versión anterior era un solo ternario
     * (`typeof args.placa === "string" && args.placa.trim() ? … : "esp32"`), así que
     * un `placa: 123`, un `{}` o un `["uno"]` caían al ESP32 EN SILENCIO. Justo lo
     * que el comentario de arriba dice que no puede pasar ("un modelo puede mandar
     * cualquier cosa igual"): para no-strings, no lo hacía. Y el modo silencioso es
     * el peor de los dos, porque el docente recibe una hoja de ESP32 impecable.
     *
     * Ahora: no venir es el default; venir mal se RECHAZA con el mismo mensaje que
     * una placa que no sabemos dibujar.
     */
    const PLACA_INVALIDA = " placa-invalida" // no existe en PLACAS: cae al rechazo de abajo
    // Un shield es la MISMA placa con los pines sacados a ternas (ver SHIELDS): se
    // resuelve a su base y se avisa, en vez de rebotar una placa que sí sabemos dibujar.
    const shieldPedido = typeof args.placa === "string" ? shieldDe(args.placa) : null
    const idPlaca =
      args.placa === undefined || args.placa === null
        ? "esp32"
        : typeof args.placa === "string"
          ? args.placa.trim()
            ? (shieldPedido?.base ?? args.placa.trim().toLowerCase())
            : "esp32" // string vacío o de puros espacios = "no me la dijeron"
          : PLACA_INVALIDA
    const placaBase = (PLACAS as Record<string, Placa | undefined>)[idPlaca]
    /*
     * Con shield se dibuja la CARA del shield, y nada más cambia.
     *
     * No es una placa nueva: los pines, los rieles, el pool PWM, el I2C y las 33
     * advertencias son EXACTAMENTE los mismos — el shield "no cambia ni un número"
     * (`skills/placas`, entrada 02). Lo único que cambia es qué ve el docente, y por eso
     * se clona cambiándole `tag`, `escala` y `anchoColumna`.
     *
     * `pieza.base === idPlaca` no es paranoia: `pb-sensor-shield` dibuja un shield
     * formato UNO. Si alguien pide "esp32 con sensor shield", se dibuja el ESP32 pelado
     * — ponerle la cara de un shield que no le entra es el mismo bug de siempre con
     * otro disfraz. Y del DFRobot y el genérico no tenemos dibujo: ésos van pelados y
     * el aviso de texto sigue siendo su respuesta.
     */
    const placa =
      placaBase && shieldPedido?.pieza && shieldPedido.pieza.base === idPlaca
        ? {
            ...placaBase,
            tag: shieldPedido.pieza.tag,
            escala: shieldPedido.pieza.escala,
            anchoColumna: shieldPedido.pieza.anchoColumna,
          }
        : placaBase
    const shieldDibujado = placa !== placaBase
    if (!placa) {
      // Un `["uno"]` interpolado da "uno" a secas, y el rechazo saldría diciendo que
      // no sabe dibujar una placa que SÍ dibuja. Los no-strings se muestran como lo
      // que son, o el mensaje confunde más de lo que aclara.
      const comoLoPidio = typeof args.placa === "string" ? args.placa : JSON.stringify(args.placa)
      return `No sé DIBUJAR una "${comoLoPidio}" todavía. Las que sé dibujar son: ${Object.values(PLACAS)
        .map((p) => `${p.id} (${p.etiqueta})`)
        .join(" y ")}. Ojo que eso NO quiere decir que tu placa no exista ni que no la conozca: el catálogo de placas vive en el skill \`placas\` y te la puedo explicar con su tabla de pines aunque todavía no le tenga el dibujo. Decime si querés el circuito en una de las dos que dibujo, o preguntame por la tuya.`
    }

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

      // Seguridad eléctrica ANTES que el dibujo: nada de potencia colgado de un pin.
      const { pedidos, avisos: avisosMando } = inyectarMando(pedidoCrudo, placa)
      notas.push(...avisosMando)
      if (pedidos.length > 6) {
        return `Para que el circuito sea seguro le tengo que sumar un relé (o un driver): los actuadores de potencia nunca van directo a la placa. Con eso pasa de 6 componentes, que es mi tope. Sacá uno y lo armo — por ejemplo: "${sugerenciaQueEntra(pedidoCrudo, placa)}".`
      }

      // ¿Se puede dibujar ESTE circuito en ESTA placa? Se pregunta DESPUÉS de inyectar
      // el mando, porque el relé o el driver que agregamos nosotros también tienen que
      // estar portados: ofrecer un riego en UNO con un relé que todavía no existe sería
      // prometer algo que no podemos entregar.
      // `shieldPedido` viaja hasta acá porque el rechazo se va POR SU CUENTA: corta
      // antes de armar nada, así que el aviso de shield del final (el de las ternas)
      // nunca se ejecuta. Si el dato del zócalo no entra en ESTE texto, no entra en
      // ninguno, y el docente con shield se queda con un "no" a secas.
      const noDibujable = motivoNoDibujable(pedidos, placa, shieldPedido)
      if (noDibujable) return noDibujable

      // Sin componentes-extra.js las piezas pb-* no se dibujan: mejor no generar nada.
      const falta = faltanPiezasDibujadas(pedidos)
      if (falta) return falta

      const r = armarCircuito(pedidos, placa, args.umbral)
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
          titulo: `🔧 ${nombres} + ${placa.etiqueta}`,
          sub: `armado libre — piezas reales conectadas al ${placa.etiqueta}`,
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
          ? `Generé el circuito, pero quedó INCOMPLETO: me quedé sin pines libres para ${r.sinPin.join(" y ")}, así que en la hoja ${r.sinPin.length > 1 ? "esas filas dicen" : "esa fila dice"} "${r.marcaSinPin}" en vez de un número. NO lo cablees así: sacá un componente de la lista y te lo armo completo.`
          : "Listo! Generé el circuito visual y animado."
      cierre = `Vas a ver las piezas reales conectadas con cables de colores, y la animación funcionando. Todo sin internet.
(Se copió la biblioteca de piezas al lado del archivo — no la borres.)`
    } else if (args.circuito && args.circuito !== "protoboard" && placa.id !== "esp32") {
      /*
       * UN PRESET ES DE ESP32 Y SE LLAMA ASÍ: pedirlo con otra placa es una
       * contradicción explícita, y se rechaza con un motivo que dice QUÉ pedir.
       *
       * Los presets NO se renombran ni se traducen: "led-esp32" con placa="uno" no es
       * un pedido ambiguo que se pueda resolver eligiendo uno de los dos, es un pedido
       * que se contradice a sí mismo. Elegir por el docente acá es exactamente el bug
       * que esta tanda vino a matar, sólo que al revés.
       *
       * La sugerencia tiene que poder ARMARSE de verdad: si el equivalente lleva algún
       * componente que todavía no está portado, se lo decimos en vez de mandarla a un
       * pedido que va a rebotar. Una sugerencia que vuelve a chocar es la peor forma de
       * decir que no (ver `sugerenciaQueEntra`, mismo criterio).
       */
      const tipos = PRESET_COMPONENTES[args.circuito]
      const equivalente = tipos?.map((t) => ({ tipo: t }))
      const armable = equivalente && !motivoNoDibujable(inyectarMando(equivalente, placa).pedidos, placa)
      return (
        `El preset "${args.circuito}" es de ESP32 — el nombre lo dice, y los pines que dibuja son los de esa placa. No te lo voy a dibujar rotulado como ${placa.etiqueta}, porque eso es justo lo que hace que un circuito se vea bien y esté mal. ` +
        (armable
          ? `Para ${placa.etiqueta} pedímelo con el armador libre: componentes="${tipos!.join(", ")}", placa="${placa.id}". Sale el mismo circuito con los pines de tu placa.`
          : tipos
            ? `Y el equivalente libre ("${tipos.join(", ")}") todavía no lo puedo armar en ${placa.etiqueta}: hay componentes de esa lista que me faltan portar. Pedímelo en ESP32, o decime qué componentes querés y te armo lo que sí tengo.`
            : `Ese circuito está montado sobre una plantilla hecha a mano para ESP32 y todavía no tengo la de ${placa.etiqueta}. Pedímelo en ESP32, o armémoslo con el arg "componentes" y los pines de tu placa.`)
      )
    } else if (args.circuito === "protoboard") {
      // Caso especial: NO es un circuito con pines, es la placa misma explicada.
      // No dibuja NINGUNA placa —es la protoboard por dentro— así que vale igual para
      // las dos y no se rechaza por `placa`. Su layout es propio (ver armarProtoboard)
      // y no usa la columna de `.circuito-libre`, así que el ancho de la placa no lo toca.
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
      const r = armarCircuito(pedidos, placa)
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
          titulo: `🔧 ${nombres} + ${placa.etiqueta}`,
          sub: `piezas reales conectadas al ${placa.etiqueta}`,
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
    // El shield no cambia un pin, pero cambia DÓNDE se pincha: el pibe no mete el cable
    // en el header de la placa, lo mete en la terna de colores. Un dibujo de la placa
    // pelada, sin decir esto, es correcto y a la vez inservible en la mesa de trabajo.
    //
    // Va acá, al final, y no donde se resuelve la placa: el ejemplo sale del PRIMER pin
    // que se repartió de VERDAD, así el docente lee un número que está en SU tabla y no
    // uno sacado del pool que a lo mejor no le tocó.
    // (Cuando exista la pieza `pb-sensor-shield`, este aviso lo reemplaza el dibujo.)
    if (shieldPedido) {
      const primero = conexiones.join(" ").match(/→ ((?:GPIO|[DA])\d+)/)
      const conEjemplo = primero
        ? ` Donde la tabla dice **${primero[1]}**, en tu placa es la **S** de la terna ${primero[1]}.`
        : ""
      notas.push(
        shieldDibujado
          ? // Ya no hay que pedirle que se imagine el shield: lo está viendo. Lo que
            // sigue haciendo falta es decirle CUÁL de las tres filas lleva el número,
            // porque el dibujo muestra las tres y la sigla "SVG" engaña — el orden
            // impreso es G · V · S y la señal va ABAJO.
            `Dibujé tu ${shieldPedido.nombre}${shieldPedido.baseAsumida ? ", y como no me dijiste sobre qué placa va, asumí el Arduino UNO — que es el formato de ese shield; si tu controlador es otro, decímelo" : ""}: los pines son los mismos que los del ${placaBase!.etiqueta} de abajo, el shield **no cambia ni un número**. Cada pin sale a un conector de **tres vías** — arriba la masa (**G**), al medio la tensión (**V**) y **abajo la señal (S)**, que es la que lleva el número de la tabla.${conEjemplo}`
          : // Sin pieza propia (DFRobot, shield genérico): se dibuja la placa pelada, y
            // se dice. No les prestamos la cara del v5.0 porque no sabemos cómo son.
            `Tenés ${shieldPedido.nombre}${shieldPedido.baseAsumida ? " y no me dijiste sobre qué placa, así que asumí el Arduino UNO, que es el formato de ese shield — si tu controlador es otro, decímelo" : ""}, así que dibujé el ${placa.etiqueta} **pelado**: el shield se apila encima y **no cambia ni un número** de los pines de la tabla. Lo que cambia es dónde pinchás — en el shield cada pin sale a un conector de **tres vías**, y la que lleva el número es la de **señal** (la **S**); las otras dos son tensión y masa.${conEjemplo}`,
      )
    }

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
