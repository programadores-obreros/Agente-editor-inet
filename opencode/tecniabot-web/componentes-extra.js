/* ============================================================
   Componentes EXTRA dibujados por nosotros (SVG), estilo Wokwi.
   Para los que NO existen en Wokwi Elements: relay, bomba,
   electroválvula, higrómetro, sensor de lluvia, BMP180, protoboard.
   Se registran como custom elements: <pb-relay>, <pb-bomba>, etc.
   ============================================================ */
(function () {
  function definir(nombre, render) {
    if (customElements.get(nombre)) return;
    customElements.define(nombre, class extends HTMLElement {
      connectedCallback() {
        this.style.display = 'inline-block';
        this.innerHTML = render(this);
      }
    });
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
    </svg>`);

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
    </svg>`);

  // --- Electroválvula ---
  definir('pb-valvula', () => `
    <svg width="100" height="80" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="40" width="84" height="14" rx="2" fill="#7f8c8d"/>
      <rect x="34" y="14" width="32" height="32" rx="4" fill="#c0392b"/>
      <rect x="40" y="6" width="20" height="12" rx="2" fill="#922b21"/>
      <circle cx="50" cy="30" r="8" fill="#e74c3c"/>
      <text x="50" y="66" font-size="8" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">VÁLVULA</text>
    </svg>`);

  // --- Higrómetro de suelo (FC-28) ---
  definir('pb-higrometro', () => `
    <svg width="70" height="110" viewBox="0 0 70 110" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="2" width="30" height="16" rx="2" fill="#1565c0"/>
      <text x="35" y="13" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">FC-28</text>
      <rect x="22" y="18" width="26" height="62" rx="2" fill="#d4af37"/>
      <rect x="27" y="22" width="4" height="84" fill="#b8860b"/>
      <rect x="39" y="22" width="4" height="84" fill="#b8860b"/>
      <text x="35" y="52" font-size="6" fill="#7a5c00" text-anchor="middle" font-family="sans-serif" transform="rotate(90 35 52)">SUELO</text>
    </svg>`);

  // --- Sensor de lluvia ---
  definir('pb-lluvia', () => `
    <svg width="90" height="80" viewBox="0 0 90 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="20" width="62" height="44" rx="3" fill="#2c3e50"/>
      <g fill="#d4af37">
        ${Array.from({length:5},(_,i)=>Array.from({length:4},(_,j)=>`<rect x="${20+i*11}" y="${26+j*9}" width="8" height="5" rx="1"/>`).join('')).join('')}
      </g>
      <circle cx="45" cy="10" r="3" fill="#5dade2"><animate attributeName="cy" values="6;14;6" dur="1s" repeatCount="indefinite"/></circle>
      <text x="45" y="74" font-size="7" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">LLUVIA</text>
    </svg>`);

  // --- BMP180 (presión atmosférica) ---
  definir('pb-bmp180', () => `
    <svg width="70" height="60" viewBox="0 0 70 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="8" width="58" height="40" rx="4" fill="#5b2c6f"/>
      <rect x="40" y="16" width="18" height="18" rx="2" fill="#1a1a1a"/>
      <circle cx="49" cy="25" r="3" fill="#888"/>
      <text x="24" y="30" font-size="8" fill="#fff" text-anchor="middle" font-family="sans-serif">BMP180</text>
      <text x="35" y="56" font-size="7" fill="#7f8c8d" text-anchor="middle" font-family="sans-serif">presión</text>
    </svg>`);

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
  });

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
    </svg>`);

  // --- Driver ULN2003 (placa de motor paso a paso / DC) ---
  definir('pb-driver', () => `
    <svg width="110" height="64" viewBox="0 0 110 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="6" width="106" height="52" rx="4" fill="#0d6e4f"/>
      <rect x="64" y="16" width="30" height="14" rx="2" fill="#1a1a1a"/>
      <text x="79" y="26" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">ULN2003</text>
      <g fill="#27ae60">${Array.from({length:4},(_,i)=>`<circle cx="${14+i*5}" cy="44" r="2"><animate attributeName="opacity" values="0.2;1;0.2" dur="0.8s" begin="${i*0.2}s" repeatCount="indefinite"/></circle>`).join('')}</g>
      <text x="30" y="22" font-size="7" fill="#fff" text-anchor="middle" font-family="sans-serif">IN1-4</text>
    </svg>`);

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
  });

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
  });

  // --- Dron cuadricóptero (Tello) — hélices girando ---
  definir('pb-dron', () => `
    <svg width="140" height="110" viewBox="0 0 140 110" xmlns="http://www.w3.org/2000/svg">
      <line x1="40" y1="40" x2="100" y2="70" stroke="#34495e" stroke-width="6"/>
      <line x1="100" y1="40" x2="40" y2="70" stroke="#34495e" stroke-width="6"/>
      <rect x="56" y="42" width="28" height="26" rx="6" fill="#2c3e50"/>
      <circle cx="70" cy="80" r="3" fill="#e74c3c"><animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite"/></circle>
      ${[[40,40],[100,40],[40,70],[100,70]].map(([x,y])=>`<g transform="translate(${x},${y})"><ellipse rx="16" ry="3" fill="#5dade2" opacity="0.7"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.15s" repeatCount="indefinite"/></ellipse><circle r="3" fill="#1a252f"/></g>`).join('')}
    </svg>`);

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
    </svg>`);

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
    </svg>`);
})();
