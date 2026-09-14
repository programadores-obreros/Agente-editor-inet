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
})();
