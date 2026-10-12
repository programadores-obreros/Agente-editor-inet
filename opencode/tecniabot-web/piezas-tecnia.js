/* ============================================================
   Piezas PROPIAS de Tecnia Bot para la vista física (SVG, estilo Wokwi).
   Para las piezas que Component Knowledge cubre y que el bundle de Wokwi
   Elements NO trae. Se registran como custom elements: <pb-dht11>, etc.

   Mismo contrato que `componentes-extra.js` (que sigue siendo del circuito
   legado y no se carga en la vista física): `pinInfo` de INSTANCIA,
   [{name, x, y, signals}], x/y en píxeles desde el borde del elemento, SVG 1:1
   (width/height == viewBox). Lo verifica `tests/pininfo-piezas.test.mjs`
   contra el archivo, y `tests/ck-cg2-dht11.test.mjs` contra el `pinInfo`
   leído en Chromium real (CK-CG2, 2026-10-12).

   Este archivo es un asset con procedencia propia
   (`conocimiento/anexos/procedencia.ts`, `tecnia-piezas-propias`): cada
   cambio acá cambia su sha256 y hay que actualizar ese registro a propósito.
   ============================================================ */
(function () {
  const ALIM = (signal) => ({ type: 'power', signal });

  function definir(nombre, render, pines) {
    if (customElements.get(nombre)) return;
    const lista = Array.isArray(pines) ? pines : [];
    const motivo = typeof pines === 'string' ? pines : null;
    class Pieza extends HTMLElement {
      connectedCallback() {
        this.style.display = 'inline-block';
        this.innerHTML = render(this);
      }
      // Copia nueva en cada lectura: el consumidor no nos pisa las coordenadas.
      get pinInfo() {
        return lista.map((p) => ({ ...p, signals: (p.signals || []).slice() }));
      }
    }
    Pieza.sinPinesDibujados = motivo;
    customElements.define(nombre, Pieza);
  }

  // --- DHT11, módulo DFRobot Gravity (SKU DFR0067, placa V2) ------------------
  // CK-CG2. Lo que se dibuja es el MÓDULO de tres cables, no el chip pelado de
  // cuatro patas ni el DHT22: placa azul con el sensor DHT11 (bloque celeste con
  // rejilla) y el conector Gravity PH2.0 de 3 posiciones abajo. El orden de los
  // pines sale del esquemático oficial "DHT11 Temperature & Humidity Sensor,
  // Revision V2, 2013-05-20" (J1: pin 1 = DATA, pin 2 = VCC, pin 3 = GND; sha256
  // 43010677fa259acd63b82464f6552db8616bb04ce19a186f321863451925afa7) y la
  // serigrafía de la placa real va con la letra «D» del lado de la señal (imagen
  // de conexión de la wiki de DFRobot). Es un dibujo esquemático, no una foto a
  // escala: la forma es reconocible, las proporciones no se midieron.
  definir('pb-dht11', () => `
    <svg width="90" height="120" viewBox="0 0 90 120" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="6" width="74" height="100" rx="5" fill="#1565c0"/>
      <circle cx="16" cy="14" r="2.5" fill="#dfe6ee"/>
      <circle cx="74" cy="14" r="2.5" fill="#dfe6ee"/>
      <rect x="25" y="18" width="40" height="48" rx="3" fill="#2e86c1"/>
      <rect x="29" y="22" width="32" height="32" rx="2" fill="#5dade2"/>
      <rect x="31" y="24" width="28" height="28" fill="none" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="31" y1="31" x2="59" y2="31" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="31" y1="38" x2="59" y2="38" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="31" y1="45" x2="59" y2="45" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="38" y1="24" x2="38" y2="52" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="45" y1="24" x2="45" y2="52" stroke="#2874a6" stroke-width="1.2"/>
      <line x1="52" y1="24" x2="52" y2="52" stroke="#2874a6" stroke-width="1.2"/>
      <text x="45" y="63" font-size="7" fill="#eaf2f8" text-anchor="middle" font-family="sans-serif">DHT11</text>
      <text x="45" y="76" font-size="6.5" fill="#fff" text-anchor="middle" font-family="sans-serif">Gravity DHT11 V2</text>
      <text x="27" y="84" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">D</text>
      <text x="45" y="84" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">VCC</text>
      <text x="63" y="84" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">GND</text>
      <rect x="18" y="86" width="54" height="18" rx="2" fill="#ecf0f1"/>
      <circle cx="27" cy="95" r="3" fill="#27ae60"/>
      <circle cx="45" cy="95" r="3" fill="#e74c3c"/>
      <circle cx="63" cy="95" r="3" fill="#333"/>
    </svg>`, [
    // Los tres <circle cy="95"> del conector Gravity: x = su cx (27 / 45 / 63).
    // El orden izquierda→derecha es el del esquemático V2 (DATA, VCC, GND) y el de
    // la serigrafía que dibuja la propia pieza (<text> D / VCC / GND). El color
    // repite la convención de los cables Gravity digitales de DFRobot (verde =
    // señal, rojo = VCC, negro = GND), pero la verdad es el rótulo, no el color.
    { name: 'DATA', x: 27, y: 95, signals: [] },
    { name: 'VCC', x: 45, y: 95, signals: [ALIM('VCC')] },
    { name: 'GND', x: 63, y: 95, signals: [ALIM('GND')] },
  ]);
})();
