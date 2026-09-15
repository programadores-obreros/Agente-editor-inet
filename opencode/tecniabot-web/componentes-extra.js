/* ============================================================
   Componentes EXTRA dibujados por nosotros (SVG), estilo Wokwi.
   Para los que NO existen en Wokwi Elements: relay, bomba,
   electroválvula, higrómetro, sensor de lluvia, BMP180, protoboard.
   Se registran como custom elements: <pb-relay>, <pb-bomba>, etc.
   ============================================================ */
(function () {
  /* ── Pines (contrato Wokwi) ──────────────────────────────────────────────
     Las piezas de Wokwi exponen `pinInfo`: [{name, x, y, signals}], con x/y en
     PÍXELES DESDE EL BORDE DEL ELEMENTO, para que el que dibuja el cable lo
     pueda nacer en el pin y no en una barra al costado.

     Acá se imita igual:
       · es un getter de INSTANCIA (el consumidor hace `el.pinInfo`), no estático;
       · nuestros SVG son 1:1 (width/height == viewBox), así que las coordenadas
         del pin son LAS MISMAS unidades que se leen en el SVG de acá abajo;
       · medido en Chrome sobre este archivo: el <svg> arranca exactamente en el
         borde del elemento (dx=0, dy=0 entre los dos getBoundingClientRect),
         o sea que unidad de SVG == píxel desde el borde. Ojo que la CAJA del
         elemento sale 4 px MÁS ALTA que el SVG (el hueco de la línea base del
         inline-block): la caja no sirve para medir, el viewBox sí.

     Cada coordenada sale del elemento SVG del conector, citado en el comentario
     de al lado. Si una pieza NO tiene los conectores dibujados, va con un string
     explicando por qué en vez de una coordenada inventada: un cable que nace en
     un punto lindo pero falso le enseña a la docente a pinchar donde no va.
     ──────────────────────────────────────────────────────────────────────── */

  const ALIM = (signal) => ({ type: 'power', signal });

  /**
   * @param nombre  tag del custom element
   * @param render  (el) => string con el SVG
   * @param pines   array pinInfo, O un string con el motivo por el que la pieza
   *                todavía no tiene pines conectables (conectores sin dibujar).
   */
  function definir(nombre, render, pines) {
    if (customElements.get(nombre)) return;
    const lista = Array.isArray(pines) ? pines : [];
    const motivo = typeof pines === 'string' ? pines : null;
    class Pieza extends HTMLElement {
      connectedCallback() {
        this.style.display = 'inline-block';
        this.innerHTML = render(this);
      }
      // Getter de INSTANCIA, como Wokwi. Copia nueva en cada lectura para que
      // el consumidor no nos pise las coordenadas sin querer.
      get pinInfo() {
        return lista.map((p) => ({ ...p, signals: (p.signals || []).slice() }));
      }
    }
    // Por qué `pinInfo` viene vacío. Legible por máquina (lo mira un test) para
    // que una pieza sin pines sea una DECISIÓN declarada y no un olvido.
    Pieza.sinPinesDibujados = motivo;
    customElements.define(nombre, Pieza);
  }

  // --- Módulo Relay (placa azul con relé negro y LED) ---
  definir('pb-relay', () => `
    <svg width="110" height="80" viewBox="0 0 110 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="6" width="106" height="68" rx="6" fill="#1565c0"/>
      <rect x="58" y="16" width="42" height="44" rx="3" fill="#1a1a1a"/>
      <text x="79" y="42" font-size="8" fill="#fff" text-anchor="middle" font-family="sans-serif">RELAY</text>
      <circle cx="18" cy="22" r="5" fill="#27ae60"/><circle cx="18" cy="22" r="5" fill="#27ae60"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></circle>
      <rect x="10" y="40" width="40" height="26" rx="3" fill="#16a085"/>
      <text x="30" y="56" font-size="7" fill="#fff" text-anchor="middle" font-family="sans-serif">IN VCC GND</text>
      <circle cx="14" cy="63" r="2.5" fill="#0d5"/><circle cx="30" cy="63" r="2.5" fill="#e74c3c"/><circle cx="46" cy="63" r="2.5" fill="#333"/>
    </svg>`, [
    // Los tres <circle cy="63"> de la bornera: x = su cx (14 / 30 / 46).
    // Los nombres y el ORDEN salen del rótulo que dibuja la propia pieza dos
    // líneas más arriba, <text>IN VCC GND</text>, izquierda a derecha; el color
    // de cada círculo lo confirma (verde = señal, rojo = VCC, negro = GND).
    // No son los LED: el LED de esta placa es el <circle r="5" fill="#27ae60">
    // con <animate>, y estos son r="2.5", sin animación y de colores distintos.
    { name: 'IN', x: 14, y: 63, signals: [] },
    { name: 'VCC', x: 30, y: 63, signals: [ALIM('VCC')] },
    { name: 'GND', x: 46, y: 63, signals: [ALIM('GND')] },
  ]);

  // --- Bomba de agua sumergible ---
  definir('pb-bomba', () => `
    <svg width="90" height="100" viewBox="0 0 90 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="40" width="46" height="50" rx="8" fill="#2c3e50"/>
      <ellipse cx="45" cy="40" rx="23" ry="8" fill="#34495e"/>
      <circle cx="45" cy="62" r="14" fill="#1a252f"/>
      <g transform="translate(45,62)"><path d="M0,-10 L3,0 L0,10 L-3,0 Z M-10,0 L0,3 L10,0 L0,-3 Z" fill="#5dade2"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite"/></path></g>
      <rect x="40" y="6" width="10" height="36" fill="#5dade2"/>
      <ellipse cx="45" cy="6" rx="5" ry="3" fill="#85c1e9"/>
      <text x="45" y="84" font-size="8" fill="#85c1e9" text-anchor="middle" font-family="sans-serif">BOMBA</text>
    </svg>`,
    // sin conectores dibujados: la pieza es cuerpo + caño de agua (el <rect x="40" y="6"> azul es el
    // caño, no un cable). Los dos cables de potencia (+ y −) que pide el catálogo del tool no
    // existen en este SVG: para anclarlos hay que dibujarlos primero.
    'pb-bomba: los dos cables de potencia no están dibujados (el SVG es cuerpo, impulsor y caño de agua).');

  // --- Electroválvula ---
  definir('pb-valvula', () => `
    <svg width="100" height="80" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="40" width="84" height="14" rx="2" fill="#7f8c8d"/>
      <rect x="34" y="14" width="32" height="32" rx="4" fill="#c0392b"/>
      <rect x="40" y="6" width="20" height="12" rx="2" fill="#922b21"/>
      <circle cx="50" cy="30" r="8" fill="#e74c3c"/>
      <text x="50" y="66" font-size="8" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">VÁLVULA</text>
    </svg>`,
    // sin conectores dibujados: está el cuerpo del solenoide sobre el caño y su tapa
    // (<rect x="40" y="6" width="20" height="12">), pero la tapa es la carcasa de la bobina, no
    // dos terminales. Los dos cables (+ y −) no están dibujados.
    'pb-valvula: los dos cables de la bobina no están dibujados (sólo el cuerpo del solenoide sobre el caño).');

  // --- Higrómetro de suelo (FC-28) ---
  definir('pb-higrometro', () => `
    <svg width="70" height="110" viewBox="0 0 70 110" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="2" width="30" height="16" rx="2" fill="#1565c0"/>
      <text x="35" y="13" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">FC-28</text>
      <rect x="22" y="18" width="26" height="62" rx="2" fill="#d4af37"/>
      <rect x="27" y="22" width="4" height="84" fill="#b8860b"/>
      <rect x="39" y="22" width="4" height="84" fill="#b8860b"/>
      <text x="35" y="52" font-size="6" fill="#7a5c00" text-anchor="middle" font-family="sans-serif" transform="rotate(90 35 52)">SUELO</text>
    </svg>`,
    // sin conectores dibujados: los dos <rect> dorados son los ELECTRODOS que se clavan en la
    // tierra, no los pads donde se sueldan los cables. El header de la sonda y el módulo
    // comparador (VCC/GND/AO que pide el catálogo del tool) no están dibujados.
    'pb-higrometro: los pads/header donde se sueldan los cables no están dibujados (lo dorado son los electrodos que van en la tierra).');

  // --- Sensor de lluvia ---
  definir('pb-lluvia', () => `
    <svg width="90" height="80" viewBox="0 0 90 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="20" width="62" height="44" rx="3" fill="#2c3e50"/>
      <g fill="#d4af37">
        ${Array.from({length:5},(_,i)=>Array.from({length:4},(_,j)=>`<rect x="${20+i*11}" y="${26+j*9}" width="8" height="5" rx="1"/>`).join('')).join('')}
      </g>
      <circle cx="45" cy="10" r="3" fill="#5dade2"><animate attributeName="cy" values="6;14;6" dur="1s" repeatCount="indefinite"/></circle>
      <text x="45" y="74" font-size="7" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">LLUVIA</text>
    </svg>`,
    // sin conectores dibujados: la grilla dorada es el área sensible a las gotas, no pines. El
    // header de 2 pines que va al módulo, y el módulo con VCC/GND/AO, no están dibujados.
    'pb-lluvia: el header de 2 pines no está dibujado (la grilla dorada es el área sensible a las gotas).');

  // --- BMP180 (presión atmosférica) ---
  definir('pb-bmp180', () => `
    <svg width="70" height="60" viewBox="0 0 70 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="8" width="58" height="40" rx="4" fill="#5b2c6f"/>
      <rect x="40" y="16" width="18" height="18" rx="2" fill="#1a1a1a"/>
      <circle cx="49" cy="25" r="3" fill="#888"/>
      <text x="24" y="30" font-size="8" fill="#fff" text-anchor="middle" font-family="sans-serif">BMP180</text>
      <text x="35" y="56" font-size="7" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">presión</text>
    </svg>`,
    // sin conectores dibujados: está la placa y el chip, pero la tira de 4 pines
    // (VCC/GND/SDA/SCL, que es la que pide el catálogo del tool) no está dibujada.
    'pb-bmp180: la tira de 4 pines VCC/GND/SDA/SCL no está dibujada.');

  // --- Protoboard (mini, decorativa) ---
  definir('pb-protoboard', () => {
    let huecos = '';
    for (let f = 0; f < 6; f++) for (let c = 0; c < 24; c++)
      huecos += `<circle cx="${10+c*7}" cy="${22+f*9}" r="1.6" fill="#bbb"/>`;
    return `
    <svg width="186" height="90" viewBox="0 0 186 90" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="182" height="86" rx="4" fill="#f0f0eb" stroke="#ccc"/>
      <rect x="6" y="6" width="174" height="3" fill="#e74c3c"/>
      <rect x="6" y="81" width="174" height="3" fill="#2980b9"/>
      ${huecos}
    </svg>`;
  },
    // Los huecos son genéricos: no hay pin con nombre que valga como destino de un cable.
    'pb-protoboard: es el tablero, no un componente; sus huecos no tienen nombre de pin.');

  // --- Motor DC (con eje girando) ---
  definir('pb-motor', () => `
    <svg width="100" height="70" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="14" width="54" height="42" rx="8" fill="#566573"/>
      <ellipse cx="68" cy="35" rx="6" ry="21" fill="#34495e"/>
      <ellipse cx="14" cy="35" rx="6" ry="21" fill="#7f8c8d"/>
      <rect x="68" y="32" width="20" height="6" rx="2" fill="#bdc3c7"/>
      <g transform="translate(90,35)"><rect x="-3" y="-10" width="6" height="20" rx="2" fill="#e67e22"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.5s" repeatCount="indefinite"/></rect></g>
      <rect x="20" y="58" width="3" height="9" fill="#c0392b"/><rect x="30" y="58" width="3" height="9" fill="#2c3e50"/>
      <text x="41" y="38" font-size="9" fill="#fff" text-anchor="middle" font-family="sans-serif">M</text>
    </svg>`, [
    // Las dos lengüetas que asoman abajo del cuerpo:
    //   <rect x="20" y="58" width="3" height="9" fill="#c0392b"/>  (roja)
    //   <rect x="30" y="58" width="3" height="9" fill="#2c3e50"/>  (negra)
    // x = centro de la lengüeta (20+3/2 y 30+3/2); y = 58+9 = la PUNTA libre,
    // que es donde sigue el cable. Esa es la convención de Wokwi, verificada
    // contra wokwi-led del bundle: su pin cae en la punta de la pata
    // (rect y=20.382 h=9.8273 -> 30.209 en unidades de su viewBox, que escalado
    // da los y=42 que publica su pinInfo), no en el cuerpo del LED.
    // Nombres: el SVG no los rotula. Salen del color de cada lengüeta, que es
    // la convención del motor real y coincide con el catálogo del tool
    // ("+ (vía driver)" en rojo, "− (vía driver)" en marrón).
    { name: '+', x: 21.5, y: 67, signals: [] },
    { name: '-', x: 31.5, y: 67, signals: [] },
  ]);

  // --- Driver ULN2003 (placa de motor paso a paso / DC) ---
  definir('pb-driver', () => `
    <svg width="110" height="64" viewBox="0 0 110 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="6" width="106" height="52" rx="4" fill="#0d6e4f"/>
      <rect x="64" y="16" width="30" height="14" rx="2" fill="#1a1a1a"/>
      <text x="79" y="26" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">ULN2003</text>
      <g fill="#27ae60">${Array.from({length:4},(_,i)=>`<circle cx="${14+i*5}" cy="44" r="2"><animate attributeName="opacity" values="0.2;1;0.2" dur="0.8s" begin="${i*0.2}s" repeatCount="indefinite"/></circle>`).join('')}</g>
      <text x="30" y="22" font-size="7" fill="#fff" text-anchor="middle" font-family="sans-serif">IN1-4</text>
    </svg>`,
    // sin conectores dibujados: los cuatro <circle cy="44"> son los LED indicadores, no la tira
    // IN1..IN4. Se ve en el propio archivo: son #27ae60 con <animate> de opacidad encadenado,
    // la MISMA firma que el LED de pb-relay; los conectores de pb-relay, en cambio, son r="2.5",
    // de colores distintos y sin animación. El header IN1..IN4, el conector del motor y la
    // alimentación no están dibujados.
    'pb-driver: la tira IN1..IN4 no está dibujada (los cuatro círculos verdes son los LED indicadores).');

  // --- Lámpara / foco 220V (se enciende con .encendido) ---
  definir('pb-lampara', (el) => {
    const on = el.hasAttribute('encendido');
    return `
    <svg width="74" height="96" viewBox="0 0 74 96" xmlns="http://www.w3.org/2000/svg">
      ${on ? '<circle cx="37" cy="40" r="38" fill="#f1c40f" opacity="0.35"/>' : ''}
      <path d="M22 44 a15 15 0 1 1 30 0 c0 9 -6 13 -7 20 l-16 0 c-1 -7 -7 -11 -7 -20 Z" fill="${on ? '#fff7d6' : '#d6dbdf'}" stroke="#aeb6bd"/>
      ${on ? '<path d="M30 38 l4 8 l3 -12 l3 12 l4 -8" stroke="#e67e22" stroke-width="1.5" fill="none"/>' : '<path d="M30 38 l4 8 l3 -12 l3 12 l4 -8" stroke="#bdc3c7" stroke-width="1.5" fill="none"/>'}
      <rect x="29" y="64" width="16" height="6" fill="#95a5a6"/>
      <rect x="30" y="70" width="14" height="12" rx="2" fill="#7f8c8d"/>
      <rect x="30" y="74" width="14" height="2" fill="#566573"/><rect x="30" y="78" width="14" height="2" fill="#566573"/>
    </svg>`;
  },
    // sin conectores dibujados: lo de abajo es el casquillo de rosca E27 (<rect y="64"> + <rect
    // y="70">), que es lo que entra en un portalámparas — no terminales. Además acá los cables
    // son fase y neutro de 220 V, que en el catálogo del tool van "vía relé": si algún día se
    // anclan, que sea a un portalámparas dibujado, no a la lámpara pelada.
    'pb-lampara: no tiene terminales dibujados, tiene casquillo de rosca E27; además son 220 V y van vía relé.');

  // --- Radiador / calefactor ---
  definir('pb-calefactor', (el) => {
    const on = el.hasAttribute('encendido');
    const aletas = Array.from({length:6},(_,i)=>`<rect x="${12+i*13}" y="20" width="9" height="50" rx="2" fill="${on?'#e67e22':'#bdc3c7'}"/>`).join('');
    const ondas = on ? Array.from({length:3},(_,i)=>`<path d="M${20+i*22} 16 q4 -6 8 0 q4 6 8 0" stroke="#e74c3c" stroke-width="1.5" fill="none" opacity="0.7"><animate attributeName="opacity" values="0.1;0.8;0.1" dur="1.2s" begin="${i*0.3}s" repeatCount="indefinite"/></path>`).join('') : '';
    return `
    <svg width="110" height="82" viewBox="0 0 110 82" xmlns="http://www.w3.org/2000/svg">
      ${ondas}
      <rect x="6" y="18" width="98" height="56" rx="4" fill="#95a5a6"/>
      ${aletas}
      <text x="55" y="80" font-size="7" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">radiador</text>
    </svg>`;
  },
    // sin conectores dibujados: el radiador está dibujado sin bornera ni cable. Como la lámpara,
    // sus dos cables son fase y neutro de 220 V y van "vía relé" según el catálogo del tool.
    'pb-calefactor: no tiene bornera ni cables dibujados; además son 220 V y van vía relé.');

  // --- Dron cuadricóptero (Tello) — hélices girando ---
  definir('pb-dron', () => `
    <svg width="140" height="110" viewBox="0 0 140 110" xmlns="http://www.w3.org/2000/svg">
      <line x1="40" y1="40" x2="100" y2="70" stroke="#34495e" stroke-width="6"/>
      <line x1="100" y1="40" x2="40" y2="70" stroke="#34495e" stroke-width="6"/>
      <rect x="56" y="42" width="28" height="26" rx="6" fill="#2c3e50"/>
      <circle cx="70" cy="80" r="3" fill="#e74c3c"><animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite"/></circle>
      ${[[40,40],[100,40],[40,70],[100,70]].map(([x,y])=>`<g transform="translate(${x},${y})"><ellipse rx="16" ry="3" fill="#5dade2" opacity="0.7"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.15s" repeatCount="indefinite"/></ellipse><circle r="3" fill="#1a252f"/></g>`).join('')}
    </svg>`,
    'pb-dron: es la ilustración del proyecto terminado, no una pieza que se cablea.');

  // --- Robot móvil (auto con ruedas / orugas) ---
  definir('pb-robot', () => `
    <svg width="120" height="96" viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="34" width="76" height="34" rx="6" fill="#2980b9"/>
      <rect x="40" y="22" width="40" height="16" rx="4" fill="#1f618d"/>
      <circle cx="60" cy="30" r="4" fill="#5dade2"/>
      <rect x="16" y="62" width="88" height="18" rx="9" fill="#2c3e50"/>
      <circle cx="32" cy="71" r="10" fill="#1a1a1a"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite" additive="sum"/></circle>
      <circle cx="88" cy="71" r="10" fill="#1a1a1a"/>
      <circle cx="32" cy="71" r="3" fill="#7f8c8d"/><circle cx="88" cy="71" r="3" fill="#7f8c8d"/>
      <rect x="98" y="46" width="10" height="8" rx="2" fill="#27ae60"/>
      ${[0,1,2].map(i=>`<path d="M108 50 q${6+i*5} 0 ${6+i*5} 0" stroke="#27ae60" fill="none"/>`).join('')}
    </svg>`,
    'pb-robot: es la ilustración del proyecto terminado, no una pieza que se cablea.');

  // --- Brazo robótico (6 servos articulado) ---
  definir('pb-brazo', () => `
    <svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect x="34" y="100" width="52" height="14" rx="4" fill="#2c3e50"/>
      <g transform="translate(60,100)">
        <g><animateTransform attributeName="transform" type="rotate" values="-12;12;-12" dur="3s" repeatCount="indefinite"/>
          <rect x="-7" y="-46" width="14" height="48" rx="5" fill="#e67e22"/>
          <circle cy="-46" r="9" fill="#d35400"/>
          <g transform="translate(0,-46)"><animateTransform attributeName="transform" type="rotate" values="30;-20;30" dur="2.3s" repeatCount="indefinite"/>
            <rect x="-6" y="-42" width="12" height="44" rx="5" fill="#f39c12"/>
            <circle cy="-42" r="8" fill="#d35400"/>
            <g transform="translate(0,-42)"><path d="M-7 0 l-6 -10 M7 0 l6 -10" stroke="#7f8c8d" stroke-width="4" fill="none"><animateTransform attributeName="transform" type="rotate" values="-10;14;-10" dur="1.5s" repeatCount="indefinite"/></path></g>
          </g>
        </g>
        <circle r="11" fill="#34495e"/>
      </g>
    </svg>`,
    'pb-brazo: es la ilustración del proyecto terminado, no una pieza que se cablea.');

  /* ══ Arduino Sensor Shield v5.0 ═══════════════════════════════════════════
     POR QUÉ EXISTE. Cuando el docente tiene el shield montado, el pibe NO pincha
     en el header del UNO: pincha en la TERNA de tres pines del shield. Dibujar el
     UNO pelado es eléctricamente correcto y a la vez inservible en la mesa de
     trabajo. Wokwi no trae shields (para un SIMULADOR un shield es transparente);
     nosotros no simulamos, enseñamos a cablear, así que lo dibujamos.

     FUENTE DE TODOS LOS DATOS: «Arduino Sensor Shield v5.0 Functional Diagram»,
     el diagrama del fabricante
     <https://curtocircuito.com.br/datasheet/arduino_sensor_shield.pdf>,
     resumido en opencode/skills/placas/SKILL.md, entrada 02. Nada de acá está
     estimado a ojo: el orden de las ternas, los rótulos y qué zócalo va dónde
     salen del diagrama. Lo único aproximado es la POSICIÓN EN MILÍMETROS de los
     bloques que no son ternas (COM, IIC, LCD, APC220, Bluetooth, SD, bornera):
     el diagrama es funcional, no acotado, así que están puestos en el mismo
     lugar RELATIVO que muestra el dibujo, no medidos. Va dicho acá porque es lo
     único que un lector podría creer más exacto de lo que es.

     ESCALA — y por qué NO la empareja con el UNO.
     Uso 3,779528 px/mm (96 dpi), exactamente el mismo factor que
     wokwi-arduino-uno: su viewBox mide 72,58 × 53,34 mm y la pieza sale
     274,3 px de ancho (72,58 × 3,779528 = 274,3). Con ese factor el shield,
     que mide 57 × 57,5 mm (Specification del datasheet: "Dimension:
     57mm*57.5mm"), da 215,4 × 217,3 px. NO lo estiro a 274,3 para emparejar:
       · el shield MIDE menos que el UNO. En la hoja donde conviven, estirarlo
         enseña un tamaño falso justo en la pieza cuyo mensaje es "esto se apila
         encima y el conjunto no crece";
       · el paso del header es 0,1" = 2,54 mm = 9,6 px. Estirando, el paso deja
         de ser 9,6 y las 16 ternas dejan de contarse como en la placa real, que
         es LO ÚNICO que el pibe hace con el dibujo: contar columnas;
       · el tool reserva ancho de columna (anchoColumna), no lo exige: una pieza
         más angosta deja margen, no rompe la hoja.
     El SVG sale 237,4 px de ancho = 215,4 de placa + 22 px (5,8 mm) del UNO que
     asoma por la izquierda. El shield TAPA al UNO: se dibuja el shield, y del
     UNO sólo se insinúa lo que de verdad asoma por abajo (el USB y el jack),
     que es lo que le permite al docente reconocer el conjunto.

     EL ORDEN DE LA TERNA — el dato peligroso.
         G  ← GND     · fila de ARRIBA
         V  ← VCC     · fila del medio
         S  ← Señal   · fila de ABAJO   ← ésta lleva el número del pin
     La sigla engaña: todos dicen "SVG" y el orden impreso es G-V-S. Si se
     dibuja al revés, el pibe mete la señal del servo en la masa. Por eso las
     coordenadas de las tres filas y los círculos que se dibujan salen de las
     MISMAS constantes de acá abajo: no pueden separarse una de otra.
     ═══════════════════════════════════════════════════════════════════════ */

  const SH_PASO = 9.6 // 0,1" = 2,54 mm × 3,779528 px/mm. El paso del header.
  const SH_W = 237.4 // 22 px del UNO que asoma + 215,4 px de placa (57 mm)
  const SH_H = 217.3 // 57,5 mm × 3,779528
  const SH_BX = 22 // borde izquierdo de la PLACA dentro del SVG

  // Las 16 ternas digitales, en el orden impreso de izquierda a derecha, tal
  // como las agrupa el diagrama de a cuatro:
  //   AREF GND 13 12 · 11 10 9 8 · 7 6 5 4 · 3 2 1 0
  // Los nombres de señal son los del UNO en Wokwi: NÚMERO PELADO, sin "D"
  // (circuito.ts, pinWokwi del UNO: `if (p.banco === "D") return String(p.n)`;
  // docs/wokwi-pinout-dump.md: «Los digitales se llaman con el número pelado»).
  // Devolver "D3" no rompe nada visible: simplemente no engancha el cable.
  const SH_DIG = ['AREF', 'GND', '13', '12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0']
  const SH_ANA = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
  // PWM del UNO (skills/placas/SKILL.md, entrada 01: «PWM | 3, 5, 6, 9, 10, 11»).
  const SH_PWM = new Set(['3', '5', '6', '9', '10', '11'])
  // Zócalo URF01 del ultrasónico. El diagrama rotula sus cuatro contactos, de
  // izquierda a derecha, VCC · A0 · A1 · GND (callout "Ultrasonic Interface"),
  // con el contacto 1 marcado cuadrado y un "+" al costado. Ojo: el fabricante
  // dice A0/A1, NO dice cuál es Trig y cuál es Echo. Como el HC-SR04 entra
  // derecho, sus contactos caen en su propio orden (VCC-Trig-Echo-GND), pero eso
  // es una consecuencia, no un dato del diagrama, y por eso los pines se llaman
  // como el diagrama los rotula y no como uno querría que se llamaran.
  const SH_URF = ['VCC', 'A0', 'A1', 'GND']

  // Centro de cada columna. Grupo = 4 columnas de 9,6 px + la letra G/V/S del
  // costado + aire: 46 px de grupo a grupo.
  const shDigX = (i) => 49.1 + (i % 4) * SH_PASO + Math.floor(i / 4) * 46
  const shAnaX = (i) => 79.8 + i * SH_PASO
  const shUrfX = (i) => 191.8 + i * SH_PASO
  // Las tres filas. G arriba, V al medio, S ABAJO: y creciente = más abajo.
  const SH_DIG_Y = { G: 62, V: 71.6, S: 81.2 }
  const SH_ANA_Y = { G: 120, V: 129.6, S: 139.2 }
  const SH_URF_Y = 205

  // Un agujero del header. ES la figura de la que sale la coordenada del pin:
  // el <circle> que se dibuja y el {x, y} que se publica usan las mismas dos
  // funciones de arriba, así que no se pueden ir uno sin el otro.
  const shHueco = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1.75" fill="#f0c674"/>`
  const shTxt = (x, y, t, s, c, a) =>
    `<text x="${x}" y="${y}" font-size="${s}" fill="${c}" text-anchor="${a || 'middle'}" font-family="sans-serif">${t}</text>`
  // Carcasa negra de un header. A propósito NO es una "figura chica": el cuerpo
  // de un zócalo no puede servir para dar por buena una coordenada corrida.
  const shZocalo = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="#12161c"/>`

  definir('pb-sensor-shield', () => {
    const blanco = '#e8eef7'
    const tenue = '#9fb6d4'
    // Colores de las LETRAS de fila (anotación nuestra, no serigrafía): masa
    // gris, tensión roja, señal verde. Es la misma convención del cable.
    const colorFila = { G: '#cfd6e0', V: '#ff8a80', S: '#7ee787' }

    // — Ternas: carcasa, letras G/V/S por grupo, agujeros y rótulo debajo —
    let digital = ''
    for (let g = 0; g < 4; g++) {
      const x0 = shDigX(g * 4)
      digital += shZocalo(x0 - 4.8, SH_DIG_Y.G - 4.8, 4 * SH_PASO, 2 * SH_PASO + 9.6)
      for (const f of ['G', 'V', 'S'])
        digital += shTxt(x0 - 7.6, SH_DIG_Y[f] + 1.4, f, 4, colorFila[f])
    }
    for (let i = 0; i < SH_DIG.length; i++) {
      const x = shDigX(i)
      for (const f of ['G', 'V', 'S']) digital += shHueco(x, SH_DIG_Y[f])
      // El número va PEGADO ABAJO DE LA S, que es el agujero que nombra.
      digital += shTxt(x, 91, SH_DIG[i], SH_DIG[i].length > 2 ? 2.8 : 4, blanco)
    }

    let analogico = ''
    analogico += shZocalo(shAnaX(0) - 4.8, SH_ANA_Y.G - 4.8, 6 * SH_PASO, 2 * SH_PASO + 9.6)
    for (const f of ['G', 'V', 'S'])
      analogico += shTxt(shAnaX(0) - 7.6, SH_ANA_Y[f] + 1.4, f, 4, colorFila[f])
    for (let i = 0; i < SH_ANA.length; i++) {
      const x = shAnaX(i)
      for (const f of ['G', 'V', 'S']) analogico += shHueco(x, SH_ANA_Y[f])
      analogico += shTxt(x, 149, SH_ANA[i], 3.6, blanco)
    }

    // — Zócalo del ultrasónico, pegado abajo de ANALOG IN como en la placa —
    let urf = shZocalo(shUrfX(0) - 4.8, SH_URF_Y - 5, 4 * SH_PASO, 10)
    for (let i = 0; i < SH_URF.length; i++) urf += shHueco(shUrfX(i), SH_URF_Y)
    // Rótulos de contacto en el vocabulario de la propia placa (V/G, como las
    // ternas) en vez de "VCC": una sola palabra para la misma cosa en toda la pieza.
    urf += ['V', 'A0', 'A1', 'G'].map((t, i) => shTxt(shUrfX(i), 214.5, t, 3, tenue)).join('')

    // — Headers de tira (bloques rotulados, sin ternas) —
    const tira = (x, y, n, paso) => {
      let s = shZocalo(x - 4.8, y - 5, n * paso, 10)
      for (let i = 0; i < n; i++) s += `<circle cx="${x + i * paso}" cy="${y}" r="1.5" fill="#d9dde3"/>`
      return s
    }
    const tiraV = (x, y, n) => {
      let s = shZocalo(x - 5, y - 4.8, 10, n * SH_PASO)
      for (let i = 0; i < n; i++) s += `<circle cx="${x}" cy="${y + i * SH_PASO}" r="1.5" fill="#d9dde3"/>`
      return s
    }

    return `
    <svg width="${SH_W}" height="${SH_H}" viewBox="0 0 ${SH_W} ${SH_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="10" width="34" height="196" rx="2" fill="#0b6e74"/>
      <rect x="0" y="24" width="26" height="34" rx="2" fill="#b8bcc2" stroke="#8c9196" stroke-width="0.8"/>
      <rect x="0" y="150" width="24" height="28" rx="4" fill="#141414"/>
      <circle cx="7" cy="164" r="4" fill="#3a3a3a"/>
      <text x="11" y="112" font-size="4" fill="#bfe9ec" text-anchor="middle" font-family="sans-serif" transform="rotate(-90 11 112)">UNO abajo</text>

      <rect x="${SH_BX}" y="0" width="215.4" height="${SH_H}" rx="4" fill="#1b4f9c"/>
      <rect x="${SH_BX + 2}" y="2" width="211.4" height="213.3" rx="3" fill="none" stroke="#3a74c4" stroke-width="0.6"/>

      ${tira(64.8, 8, 8, SH_PASO)}
      ${tira(152.8, 8, 8, SH_PASO)}
      <rect x="56" y="15" width="103" height="36" rx="2" fill="#f2efe6" stroke="#2b2f36" stroke-width="1"/>
      <rect x="164" y="15" width="64" height="36" rx="2" fill="#f2efe6" stroke="#2b2f36" stroke-width="1"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${67 + i * 10}" cy="27" r="1.6" fill="#2b2f36"/><circle cx="${67 + i * 10}" cy="39" r="1.6" fill="#2b2f36"/>`).join('')}
      ${[0, 1, 2].map((i) => `<circle cx="${178 + i * 10}" cy="27" r="1.6" fill="#2b2f36"/><circle cx="${178 + i * 10}" cy="39" r="1.6" fill="#2b2f36"/>`).join('')}
      ${shTxt(107.5, 48, 'LCD 12864 paralelo', 3.6, '#2b2f36')}
      ${shTxt(196, 48, 'LCD 12864 serie', 3.6, '#2b2f36')}

      <rect x="31" y="35" width="18" height="13" rx="2" fill="#12161c"/>
      <circle cx="40" cy="41.5" r="2.6" fill="#ff7b6b"/>

      ${shTxt(41.5, 55.8, 'DIGITAL IO  D0~D13', 3.6, tenue, 'start')}
      ${digital}

      ${shTxt(26, 103, 'Arduino Sensor Shield v5.0', 7, blanco, 'start')}

      <rect x="31" y="128" width="32" height="36" rx="2" fill="#d8dde4"/>
      <circle cx="47" cy="146" r="8" fill="#2b2f36"/>
      ${[[37, 134], [57, 134], [37, 158], [57, 158]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#8d949c"/>`).join('')}
      ${shTxt(47, 124, 'RESET', 3.6, blanco)}

      ${shTxt(72.2, 112, 'ANALOG IO  A0~A5', 3.6, tenue, 'start')}
      ${analogico}

      ${shTxt(147, 112, 'COM · RX TX − +', 3, tenue, 'start')}
      ${tira(151.8, 119.5, 4, SH_PASO)}
      ${shTxt(147, 131, 'IIC · SCL SDA − +', 3, tenue, 'start')}
      ${tira(151.8, 138.5, 4, SH_PASO)}

      ${tiraV(208, 108.8, 6)}
      <text x="200" y="133" font-size="3.4" fill="${blanco}" text-anchor="middle" font-family="sans-serif" transform="rotate(-90 200 133)">APC220</text>
      ${tiraV(227, 108.8, 6)}
      <text x="219" y="133" font-size="3.4" fill="${blanco}" text-anchor="middle" font-family="sans-serif" transform="rotate(-90 219 133)">Bluetooth</text>

      <rect x="26" y="172" width="40" height="42" rx="2" fill="#2e7d32"/>
      <circle cx="36" cy="188" r="5" fill="#c9ccd1"/><circle cx="56" cy="188" r="5" fill="#c9ccd1"/>
      ${shTxt(36, 208, '+', 5, blanco)}${shTxt(56, 208, '−', 5, blanco)}
      ${shTxt(46, 170, 'ALIM. EXT', 3.2, blanco)}

      ${shTxt(85.4, 170, 'PWR', 3.4, blanco)}
      ${tira(75.8, 176.6, 3, SH_PASO)}
      <rect x="73" y="173.4" width="14.8" height="6.4" rx="1" fill="#1b6fd0"/>

      ${shTxt(104, 184, 'POWER', 3.4, tenue, 'start')}
      ${tira(108.8, 191, 6, SH_PASO)}
      ${shTxt(170, 184, 'ANALOG IN', 3.4, tenue, 'start')}
      ${tira(174.8, 191, 6, SH_PASO)}

      ${shTxt(80, 207, 'SD', 3.4, blanco, 'end')}
      ${tira(87.4, 205, 6, SH_PASO)}
      ${shTxt(185, 207, 'URF01', 3.4, blanco, 'end')}
      ${urf}
    </svg>`
  }, [
    // ── LOS PINES ──────────────────────────────────────────────────────────
    // El cable se engancha donde la docente PINCHA DE VERDAD: la S de cada
    // terna, la fila de ABAJO. Las otras dos filas se exponen con sufijo
    // (".V" tensión, ".G" masa) para que nunca compitan con el nombre del pin
    // de señal: "3" es la señal del 3; "3.V" y "3.G" son su tensión y su masa.
    //
    // Cada coordenada sale del <circle> que dibuja ESE agujero, porque el
    // dibujo y esta lista llaman a las mismas dos funciones (shDigX/shAnaX y
    // SH_DIG_Y/SH_ANA_Y). No hay forma de mover el dibujo sin mover el pin.
    ...SH_DIG.flatMap((nombre, i) => {
      const x = shDigX(i)
      const senal = SH_PWM.has(nombre) ? [{ type: 'pwm' }] : []
      return [
        { name: `${nombre}.G`, x, y: SH_DIG_Y.G, signals: [ALIM('GND')] },
        { name: `${nombre}.V`, x, y: SH_DIG_Y.V, signals: [ALIM('VCC')] },
        { name: nombre, x, y: SH_DIG_Y.S, signals: nombre === 'GND' ? [ALIM('GND')] : senal },
      ]
    }),
    ...SH_ANA.flatMap((nombre, i) => {
      const x = shAnaX(i)
      return [
        { name: `${nombre}.G`, x, y: SH_ANA_Y.G, signals: [ALIM('GND')] },
        { name: `${nombre}.V`, x, y: SH_ANA_Y.V, signals: [ALIM('VCC')] },
        { name: nombre, x, y: SH_ANA_Y.S, signals: [{ type: 'analog' }] },
      ]
    }),
    // El zócalo del ultrasónico: es lo que hace que la pieza valga la pena.
    // Con shield el HC-SR04 entra DERECHO acá en vez de cablearse a mano, y el
    // catálogo lo dice fuerte: "NO va a D4 y D5, por ejemplo".
    ...SH_URF.map((nombre, i) => ({
      name: `URF01.${nombre}`,
      x: shUrfX(i),
      y: SH_URF_Y,
      signals:
        nombre === 'VCC' ? [ALIM('VCC')] : nombre === 'GND' ? [ALIM('GND')] : [{ type: 'analog' }],
    })),
  ]);
})();
