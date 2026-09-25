/* ═══════════════════════════════════════════════════════════════════════════
   cables.js — el trazador de cables del ARMADOR LIBRE.

   QUÉ RESUELVE
   Hasta hoy el cable era un <span class="cable"> de CSS que crecía con flex y
   nacía de una barra gris al costado de la placa. Eso es una lista con líneas:
   no le dice al pibe DÓNDE PINCHAR. Acá el cable nace del agujero real del
   header, medido en el navegador.

   EL CONTRATO — es el de Wokwi, y no es casualidad
   ------------------------------------------------
       ["led1:A", "uno:13", "green", ["v10","h5","*","v-15"]]
          origen     destino  color   ruteo (OPCIONAL)

   1. REFERENCIAS POR NOMBRE, NUNCA POR COORDENADA. El HTML que genera el tool
      sólo dice `data-placa="3" data-pieza="A"`: nombres de pin. La coordenada
      se MIDE acá, del elemento que dibuja el agujero. Que en el HTML generado
      no quede ni una coordenada de cable es el requisito duro, y sale de un
      defecto real: plantilla-semaforo-protoboard.html tenía tres coordenadas
      escritas a mano y las tres apuntaban al agujero equivocado, con el rótulo
      correcto al lado. Dibujo impecable, circuito que no funciona.
   2. RUTEO ORTOGONAL. Tramos horizontales y verticales. Nada de diagonales.
   3. WAYPOINTS RELATIVOS Y OPCIONALES. `v10` = 10 px abajo, `h5` = 5 a la
      derecha. El default es `[]`: el router resuelve solo.
   4. EL `*` PARTE EL RUTEO: lo anterior sale del origen, lo posterior llega al
      destino en reversa.

   LA GARANTÍA QUE NO SE NEGOCIA
   El diseño viejo defendía esto, y es cierto: «el cable no tiene coordenadas:
   vive en la misma fila flex que su etiqueta, nunca se desalinea». Acá se
   conserva de otra manera: el cable NO tiene coordenadas propias tampoco — las
   dos puntas se miden del DOM en cada trazado (load, resize, beforeprint), y si
   una medición no cierra, ese cable NO se dibuja y queda el cable CSS de
   siempre. Falla cerrado. El fallback es POR CABLE, no por hoja: una hoja con 3
   cables trazados y 2 con la barra CSS tiene que verse bien.

   Y «tiene que verse bien» costó dos defectos, los dos del mismo tipo — el
   fallback es por fila pero el DIBUJO tiene partes que son de la escena entera:
     · la barra gris de dónde nacen los cables CSS es UNA para toda la escena, y
       se ocultaba en cuanto UN cable se trazaba. Los que habían caído al
       fallback quedaban naciendo del aire. 26 de las 79 hojas del catálogo. Hoy la
       barra se oculta sólo si NO quedó ningún cable CSS a la vista, y eso se
       cuenta del DOM (ver `cablesCSSVisibles`).
     · y una fila cuya PIEZA no se podía medir hacía `continue` sin devolver su
       cable CSS al layout: el cable no caía al fallback, desaparecía.
   La regla, entonces: todo camino que abandona una fila pasa por
   `devolverALaFila`, y lo que se decide para la escena entera se decide DESPUÉS
   de dibujar, contando lo que quedó.

   LA ETIQUETA VA EN SERIE SOBRE EL CABLE
   Superponer los cables al layout actual empeora el dibujo: cruzan por encima
   de las cajitas de etiqueta y las dejan huérfanas. Lo que funciona es lo que
   ya hace `<span class="res">` con la resistencia (circuito.ts:2062), extendido
   a la etiqueta: el cable ENTRA por el `.nodo` y SALE por el borde derecho de
   `.label`. Se lee «agujero → este nombre → este pin de la pieza».

   LAS TRAMPAS, YA MEDIDAS
   1. `getBoundingClientRect().left + pinInfo.x * ESCALA_DECLARADA` está MAL y
      falla en silencio: si el custom element queda `display:inline` el
      `transform` ni se aplica, y multiplicar por el 1,3 que dice el style te
      manda 102 px al costado. La escala se MIDE, no se lee: es
      `rect / caja de layout`, y `offsetWidth/offsetHeight` son justo la caja de
      layout SIN transform. Si la caja de layout miente (el `offsetHeight` de
      17 px de un inline vacío) las dos escalas no coinciden y falla cerrado.
   2. NO SE ANCLA EN EL <svg> HIJO. Parecía la opción robusta y está MEDIDO que
      rompe: `wokwi-buzzer` renderiza un <div> con DOS <svg> (un ícono de 8×8 y
      el cuerpo de 17 mm), y `querySelector("svg")` agarra el ícono. Su pinInfo
      (27,84 · 37,84) no es relativo a ninguno de los dos: es relativo al HOST.
      Medido en seis.html: con el <svg> el pin del buzzer cae en 1453,897 y el
      de verdad está en 1392,850 — 77 px de error, con el dibujo prolijo.
      En las otras 6 piezas las dos fórmulas coinciden dentro de 0,4 px, así
      que el error habría entrado en silencio y sólo en el buzzer.
   3. El viewBox de las piezas Wokwi está en MILÍMETROS (`width="72.58mm"`,
      viewBox `-4 0 72.58 53.34`) mientras `pinInfo` está en PÍXELES. Usar
      `rect.width / viewBox.width` da ×3,78 de error. `anchoIntrinsecoPx` lee la
      unidad del atributo `width` y convierte con 96/25.4 = 3,779528 — el mismo
      factor de componentes-extra.js:313. Nuestras `pb-*` traen `width` sin
      unidad, así que el mismo código sirve para las dos familias. Se usa como
      SEGUNDA OPINIÓN (ver `medidorDe`): si la pieza tiene un solo <svg> pegado
      al borde, su tamaño declarado tiene que dar la misma escala.
   4. Si las dos escalas (ancho y alto) no coinciden, la caja está estirada →
      `null` → fallback. La tolerancia NO es un 2% plano: es el redondeo entero
      de `offsetWidth/offsetHeight`, modelado (ver `escalaUniforme`). El 2%
      plano le perdonaba a la placa cuatro veces más de lo que el redondeo puede
      explicar y le negaba a las piezas chicas lo que el redondeo les impone:
      el `wokwi-neopixel` (caja de 21×24) desvía 2,274% por puro redondeo y
      quedaba afuera, con sus 3 cables al fallback en las tres placas, en
      silencio. Ese número no estaba medido y esta cabecera afirmaba que «el
      peor caso real es 0,91%»: era el del fotorresistor, y era el peor de los
      que alguien había mirado.
   5. Que el pin EXISTA en `pinInfo` no quiere decir que caiga adentro del
      dibujo. El `wokwi-membrane-keypad` publica sus 8 pines en y=338 sobre una
      caja de 263 px: 41 px por debajo del teclado. Los 8 cables terminaban en
      puntitos sobre el fondo. Es la única de las 36 piezas del catálogo así —
      el peor sobrepaso de las otras 35 es 0,5 px. Ver `pinAdentro`.
   6. `pinInfo` es getter de INSTANCIA, no estático, y las piezas pintan en
      `connectedCallback` → se corre en `load` + un tick, no en DOMContentLoaded.
   7. El GND se tapa: con 6 componentes, 6 cables caen en el MISMO agujero. Lo
      de acá es PALIATIVO (stubs escalonados + punto relleno más grande), no
      solución: la solución real es repartir las masas entre los agujeros que la
      placa tiene (el UNO tiene GND.1, GND.2 y GND.3), y eso se decide del lado
      del tool, no acá.

   EL LAYOUT, QUE ES DONDE ESTÁ LA PLATA — medido con 6 componentes
   `.circuito-libre` es un grid con `align-items:center`, así que la placa se
   centra en una columna tan alta como TODA la lista. Medido en seis.html
   (UNO, 1920px): la escena va de y=156 a y=1028, la placa de y=491 a y=697, y
   las filas de y=167 a y=1021. La primera fila nace 290 px POR ENCIMA de la
   placa y la última 240 px por debajo.

   Se midieron las tres salidas:
     · `align-items:start` (la placa arriba): la distancia media de cada fila al
       centro de la placa pasa de 214 px a 328 px. EMPEORA. El centrado de hoy
       ya es el óptimo. Descartada por número, no por gusto.
     · un solo carril compartido: la banda libre entre el borde derecho de la
       placa (x=755) y la columna de nodos (x=786) mide 31 px. Quince cables
       ahí adentro son un bulto, no quince cables.
     · lo que se hace acá: usar el espacio que SÍ está vacío. La columna de la
       placa mide 290 px de ancho y arriba y abajo de la placa quedan 324 px y
       324 px de alto COMPLETAMENTE VACÍOS. Un cable que sale del header de
       arriba y va a una fila que está arriba de la placa baja su vertical por
       ahí, con 274 px para repartir carriles en vez de 31.

   Así, de los 15 cables de seis.html, 6 bajan por la banda ancha y 9 por la
   angosta (los que cruzan de un lado al otro de la placa). No es gratis: los 9
   siguen apretados. Está dicho en el informe.

   LA IMPRESIÓN: LA ESCENA NO SE PARTE
   Estas hojas se imprimen, y el cambio de `<span>` a `<svg>` rompió eso sin que
   se notara: el cable vivía ADENTRO de su fila, así que el salto de página se
   llevaba fila y cable juntos. El `<svg>` es absoluto y cubre la escena entera,
   y el salto lo corta por donde caiga. Medido con `chromium --print-to-pdf`
   sobre `uno-lleno`: «Extremo 1», «Cursor» y «Extremo 2» caían en la página 2,
   los dos últimos sin NINGÚN cable y el primero con un muñón huérfano.
   No se arregla con un SVG por fila: la PLACA también es una sola, centrada
   sobre todas las filas, así que partida la escena no hay cable posible entre
   una fila de la página 2 y una placa que quedó en la página 1. Lo único que
   cierra es que la escena no se parta, y eso es una regla de impresión
   (`break-inside:avoid`) que se inyecta junto con la de la barra.
   LÍMITE CONOCIDO: si una escena no entra en una página, el navegador ignora
   `break-inside:avoid` y la parte igual. Las 79 hojas del catálogo entran; una
   escena con `alto` grande escrito a mano puede no entrar, y ahí vuelve el
   defecto. Eso no se arregla acá: se arregla no generando escenas más altas que
   una página, que se decide del lado del tool.

   LA HOJA ANGOSTA: EL CABLE NO SE DIBUJA DONDE NO SE PUEDE DIBUJAR
   Con la hoja angosta la columna de etiquetas se desborda del recuadro. Medido
   en `e-7segmentos` a 420 px: el borde derecho de la etiqueta «Segmentos A-G»
   queda en x=794 sobre una escena que termina en x=442. Rutear hasta ahí
   dibujaba siete cables que salían del recuadro, cruzaban la placa por arriba y
   pasaban por encima del título. El cable CSS vive ADENTRO de la fila: se
   desborda con la fila y no hace ese desastre. Por eso, si una punta —el
   agujero, el nodo, el borde de la etiqueta o el pin— no cae en la zona
   dibujable, ese cable no se traza y queda el CSS.
   El precio está medido y es en las hojas angostas: a 420 px vuelven al
   fallback 56 cables del catálogo (140 → 73 trazados), y a cambio los puntos de
   cable fuera del recuadro pasan de 95 a 6. A 800, 1000 y 1920 px no cambia
   nada: ahí las etiquetas entran.
   El desborde en sí no se arregla acá — es el grid de `.circuito-libre` — pero
   sí se deja de dibujar encima.

   LOS CRUCES Y LOS SOLAPES, DICHOS CON EL NÚMERO
   El ruteo garantiza no cruzar la PLACA. Entre cables NO garantiza nada: es la
   heurística de `repartirCarriles`, y el informe viejo decía «puede pasar»
   cuando la medida dice que es la norma. Medido sobre el catálogo (79 hojas,
   1920 px): 245 de 1022 pares de cables se cruzan — el 24% —, 92 de ellos del
   mismo color. Antes eran 254 de 1163 (22%). NO mejoró: se mantuvo mientras
   entraban 11 cables más.
   Un cruce se ve como dos cables y se entiende. Lo que NO se entiende es el
   SOLAPE COLINEAL —dos cables sobre la misma recta, donde el de arriba BORRA al
   de abajo, y donde el informe viejo no decía nada— y ese sí se persiguió:
   53.697 px en 38 hojas antes, 7.087 px en 25 después (−87%), y de esos sólo
   3.754 px son entre cables de distinto color, que son los que de verdad
   esconden información.
   El 58% de lo que queda es del `wokwi-7segment`, que trae SIETE cables
   colgando de una sola etiqueta de 40 px de alto: entran en abanico a 5 px uno
   de otro y el trazo mide 4. Repartirlos mejor pide más alto de etiqueta, y eso
   se decide del lado del tool, no acá.

   FUERA DE ALCANCE
   `armarProtoboard` y las PLANTILLAS_PROTOBOARD tienen su propio layout y su
   propio router. No se tocan: este archivo sólo mira `.escena .circuito-libre`.

   QUÉ SE PUEDE TESTEAR SIN NAVEGADOR
   Todo lo de la sección «PURO»: `rutear`, `anchoIntrinsecoPx` y
   `escalaUniforme`. Se exportan a propósito (globalThis.TecniaCables) para que
   tests/cables.test.mjs los ejercite con cajas de mentira.
   ═══════════════════════════════════════════════════════════════════════════ */
;(function (raiz) {
  "use strict"

  /* ═════════════════════════════ PURO (sin DOM) ═════════════════════════════
     Nada de acá toca `document`. Es lo único que se puede probar en Node, así
     que es donde vive TODA la geometría. La capa DOM de más abajo sólo mide y
     llama.
     ════════════════════════════════════════════════════════════════════════ */

  var EPS = 0.01

  // Unidades CSS absolutas → px. 96 dpi: el MISMO factor que usa
  // componentes-extra.js:313 para el shield y que usa wokwi-arduino-uno
  // (72,58 mm × 3,779528 = 274,3 px de ancho real).
  var PX_POR_UNIDAD = {
    px: 1,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    in: 96,
    pt: 96 / 72,
    pc: 16,
    q: 96 / 25.4 / 4,
  }

  /**
   * "72.58mm" → 274.318…  ·  "237.4" → 237.4  ·  "100%" → null  ·  "" → null
   *
   * Sin unidad = px (así vienen nuestras piezas pb-*). Porcentaje, unidades
   * relativas (em, rem, vw) y basura devuelven null a propósito: no se pueden
   * resolver sin el contexto de layout, y adivinar acá es exactamente el bug
   * que este archivo viene a evitar.
   */
  function medidaIntrinsecaPx(valor) {
    if (typeof valor === "number") return isFinite(valor) && valor > 0 ? valor : null
    if (typeof valor !== "string") return null
    var m = valor.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-zA-Z]*)$/)
    if (!m) return null
    var n = parseFloat(m[1])
    if (!isFinite(n) || n <= 0) return null
    var factor = PX_POR_UNIDAD[(m[2] || "px").toLowerCase()]
    return factor ? n * factor : null
  }

  // Acepta el <svg> (lee su atributo) o directamente el string, para poder
  // probar el parseo sin DOM.
  function atributoDe(x, nombre) {
    if (typeof x === "string" || typeof x === "number") return x
    if (x && typeof x.getAttribute === "function") return x.getAttribute(nombre)
    return null
  }
  function anchoIntrinsecoPx(svg) {
    return medidaIntrinsecaPx(atributoDe(svg, "width"))
  }
  function altoIntrinsecoPx(svg) {
    return medidaIntrinsecaPx(atributoDe(svg, "height"))
  }

  var TOL_BASE = 0.005

  /**
   * La escala REAL a la que se pintó la pieza, o null si la caja está estirada.
   *
   * `pinInfo` está en píxeles del tamaño intrínseco, así que la única
   * conversión válida es una escala UNIFORME. Si el ancho dice ×1,3 y el alto
   * dice ×1,9, alguien le puso width/height por CSS y las coordenadas de los
   * pines ya no valen: mejor no dibujar que dibujar en el agujero de al lado.
   *
   * LA TOLERANCIA NO ES UN NÚMERO REDONDO: ES EL REDONDEO, MODELADO.
   * `offsetWidth` y `offsetHeight` son ENTEROS —el navegador redondea la caja
   * de layout— así que con la escala verdadera `s` y la caja real W,
   *     k = s·W/round(W) ≈ s·(1 − e/W),  |e| ≤ 0,5
   * y lo mismo para el alto. Dos escalas medidas sobre cajas redondeadas se
   * separan, sin que nadie estire nada, hasta
   *     |kv − k| ≤ k · 0,5 · (1/ancho + 1/alto)
   * Una pieza CHICA tiene derecho a desviarse mucho más que una grande, y un
   * 2% plano no distingue: le perdona a la placa cuatro veces más de lo que el
   * redondeo puede explicar, y le niega a las piezas chicas lo que el redondeo
   * les impone. Medido sobre las 36 piezas del catálogo (1920 px, Chromium):
   *   · wokwi-neopixel  21×24 px de caja → 2,274% de desvío, cota 4,464%.
   *     Con el 2% plano quedaba AFUERA: sus 3 cables caían al cable CSS en las
   *     tres placas, en silencio, y la cabecera de este archivo afirmaba que
   *     «el peor caso real es 0,91%» — nunca se lo había medido.
   *   · wokwi-arduino-uno 274×207 → desvío 0,31%, cota 0,424%. El 2% plano le
   *     dejaba pasar una placa estirada 1,5%: 4 px de error en el agujero del
   *     pin 13, con el dibujo impecable.
   *   · wokwi-mpu6050 5,497% (cota 1,367%) y wokwi-tilt-switch 12,988% (cota
   *     1,388%) están de verdad estiradas y siguen afuera, como debe ser.
   * El `TOL_BASE` de 0,5% que se suma es el colchón sub-píxel del propio
   * `getBoundingClientRect` (el peor margen medido queda en el fotorresistor:
   * 0,91% contra una cota total de 1,545%).
   */
  function escalaUniforme(anchoRend, altoRend, anchoIntr, altoIntr, tolerancia) {
    var tol = typeof tolerancia === "number" ? tolerancia : TOL_BASE
    if (!(anchoIntr > 0) || !(altoIntr > 0)) return null
    if (!(anchoRend > 0) || !(altoRend > 0)) return null
    var k = anchoRend / anchoIntr
    var kv = altoRend / altoIntr
    var redondeo = 0.5 * (1 / anchoIntr + 1 / altoIntr)
    if (Math.abs(kv - k) > k * (tol + redondeo)) return null
    return k
  }

  /**
   * ¿El agujero que declara `pinInfo` cae DENTRO del dibujo de la pieza?
   *
   * Nadie lo chequeaba: `medidorDe` validaba la escala y daba por hecho la
   * posición. Medido sobre las 36 piezas del catálogo (1920 px, Chromium), 35
   * tienen todos sus pines adentro con 0,5 px de sobrepaso en el peor caso
   * (el pin «1» del wokwi-buzzer). La 36ª es `wokwi-membrane-keypad`: publica
   * sus 8 pines en y=338 sobre una caja de 263 px, o sea 41 px POR DEBAJO del
   * teclado. Los 8 cables terminaban en puntitos sobre el fondo, sin tocar la
   * pieza, donde antes había dos líneas que sí llegaban.
   * 2 px son cuatro veces el peor sobrepaso legítimo y la vigésima parte del
   * que no lo es: el corte separa los dos casos sin rozar ninguno.
   */
  var TOL_PIN = 2
  function pinAdentro(p, ancho, alto, tolerancia) {
    var t = typeof tolerancia === "number" ? tolerancia : TOL_PIN
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return false
    if (!(ancho > 0) || !(alto > 0)) return false
    return p.x >= -t && p.y >= -t && p.x <= ancho + t && p.y <= alto + t
  }

  // ── geometría chica ──────────────────────────────────────────────────────

  function comoPunto(p) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return null
    return { x: p.x, y: p.y }
  }
  function comoRect(r) {
    if (!r) return null
    if (!isFinite(r.left) || !isFinite(r.top) || !isFinite(r.right) || !isFinite(r.bottom)) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  function numero(v, porDefecto) {
    return isFinite(v) ? v : porDefecto
  }

  var LADOS = ["izq", "der", "arriba", "abajo"]

  /**
   * De qué borde de la placa está más cerca el agujero. Decide por dónde SALE
   * el cable, y sale perpendicular a ese borde — que es como sale un cable de
   * verdad de un header.
   *
   * Distancias con signo: si el punto ya está afuera, ese lado da negativo y
   * gana solo. Empates: gana el primero de LADOS (determinista a propósito, un
   * router que elige distinto en cada corrida es imposible de mirar).
   */
  function ladoMasCercano(p, r) {
    var d = { izq: p.x - r.left, der: r.right - p.x, arriba: p.y - r.top, abajo: r.bottom - p.y }
    var mejor = LADOS[0]
    for (var i = 1; i < LADOS.length; i++) if (d[LADOS[i]] < d[mejor]) mejor = LADOS[i]
    return mejor
  }

  /**
   * El punto donde termina el tramo de salida (el "stub"): `salida` px afuera
   * del borde elegido, sobre la perpendicular.
   *
   * `limites` (la caja de la escena) recorta el stub para que el cable no se
   * escape del recuadro. Si ni siquiera entra 1 px afuera del borde, devuelve
   * null → el cable no se traza → queda el cable CSS. Falla cerrado.
   */
  function puntoDeSalida(p, r, lado, salida, limites) {
    var v
    if (lado === "izq") {
      v = r.left - salida
      if (limites) v = Math.max(v, limites.left + 1)
      return v < r.left ? { x: v, y: p.y } : null
    }
    if (lado === "der") {
      v = r.right + salida
      if (limites) v = Math.min(v, limites.right - 1)
      return v > r.right ? { x: v, y: p.y } : null
    }
    if (lado === "arriba") {
      v = r.top - salida
      if (limites) v = Math.max(v, limites.top + 1)
      return v < r.top ? { x: p.x, y: v } : null
    }
    v = r.bottom + salida
    if (limites) v = Math.min(v, limites.bottom - 1)
    return v > r.bottom ? { x: p.x, y: v } : null
  }

  // El pasillo por arriba o por abajo de la placa, para los cables que salen
  // por un costado y tienen que ir al otro sin atravesarla.
  function corredor(r, lado, margen, limites) {
    var v
    if (lado === "arriba") {
      v = r.top - margen
      if (limites) v = Math.max(v, limites.top + 1)
      return v < r.top ? v : null
    }
    v = r.bottom + margen
    if (limites) v = Math.min(v, limites.bottom - 1)
    return v > r.bottom ? v : null
  }

  /**
   * Dónde tiene permiso de dibujarse el cable.
   *
   * Arranca siendo el recuadro de la escena, y esa es la regla: el cable no se
   * escapa de la hoja. Pero el recuadro tiene una altura fija y LA PLACA NO
   * SIEMPRE ENTRA. Medido en `e-servo` (ESP32, 1920 px): la escena va de y=125
   * a y=350 y la placa de y=108,8 a y=370,4 — sobresale 16,2 px por arriba y
   * 20,4 px por abajo. Con el recuadro como límite duro, `corredor()` no
   * encontraba pasillo NI por arriba NI por abajo, devolvía null en los dos
   * sentidos, y TODO el header izquierdo del ESP32 —el que necesita rodear la
   * placa para llegar a la columna de nodos— caía al cable CSS: 14 de 116
   * filas, 12 de 33 hojas. Y en silencio: los dos nombres de pin resolvían
   * bien. Lo insidioso es que el MISMO cable se dibujaba o no según cuántos
   * componentes tuviera la hoja, porque con más filas la escena crece y la
   * placa entra.
   *
   * La regla honesta no es «adentro del recuadro» sino «no más afuera que lo
   * que ya está dibujado afuera»: donde la placa se sale, el cable puede
   * acompañarla, más la `holgura` que necesita para bordearla. Donde la placa
   * entra —que es el caso normal— el límite sigue siendo el recuadro, exacto:
   * no se afloja nada que no haga falta aflojar.
   */
  function limitesUtiles(escena, placa, holgura) {
    var e = comoRect(escena)
    if (!e) return comoRect(placa)
    var p = comoRect(placa)
    if (!p) return e
    var h = Math.max(0, numero(holgura, 0))
    return {
      left: p.left < e.left ? p.left - h : e.left,
      top: p.top < e.top ? p.top - h : e.top,
      right: p.right > e.right ? p.right + h : e.right,
      bottom: p.bottom > e.bottom ? p.bottom + h : e.bottom,
    }
  }

  /** ¿El punto cae adentro del rectángulo? Con 1 px de gracia para los bordes. */
  function dentroDe(p, r) {
    if (!p || !r) return true
    return p.x >= r.left - 1 && p.x <= r.right + 1 && p.y >= r.top - 1 && p.y <= r.bottom + 1
  }

  /** ¿El segmento (a,b), que es horizontal o vertical, pisa el INTERIOR de r? */
  function cruza(a, b, r) {
    var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x)
    var y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
    return x1 > r.left + EPS && x0 < r.right - EPS && y1 > r.top + EPS && y0 < r.bottom - EPS
  }

  function esOrtogonal(pts) {
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1]
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return false
    }
    return true
  }

  /**
   * Libre de la placa DE LA SEGUNDA JUNTA EN ADELANTE.
   *
   * El primer segmento está exento por construcción: el agujero está DENTRO de
   * la placa (el pin 13 del UNO está a 9 px del borde de arriba), así que el
   * tramo de salida arranca adentro sí o sí. Es el camino más corto para salir
   * y es perpendicular: no hay nada que esquivar ahí.
   *
   * OJO — ESTO SE CORRE ANTES DE `compactar`, Y NO ES UN DETALLE.
   * Compactado, el tramo de salida se funde con el tramo siguiente cuando los
   * dos son verticales (pasa cuando el carril cae justo en la x del agujero).
   * El resultado era un solo segmento 0 de 205 px que bajaba desde el header de
   * arriba hasta 8 px por debajo de la placa, ATRAVESÁNDOLA ENTERA — y como era
   * el segmento 0, la exención lo dejaba pasar. Medido en seis.html: 5 de 15
   * cables cruzaban la placa por el medio, con el dibujo prolijo. Sin compactar,
   * ese tramo es el segmento 1, se lo revisa, y el candidato se descarta.
   */
  function libreDeLaPlaca(pts, r) {
    if (!r) return true
    for (var i = 1; i + 1 < pts.length; i++) if (cruza(pts[i], pts[i + 1], r)) return false
    return true
  }

  function largoDe(pts) {
    var t = 0
    for (var i = 0; i + 1 < pts.length; i++) t += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
    return t
  }

  /** Saca puntos repetidos y junta los colineales. Un codo de 0 px no es un codo. */
  function compactar(pts) {
    var out = []
    for (var i = 0; i < pts.length; i++) {
      var q = out[out.length - 1]
      if (q && Math.abs(q.x - pts[i].x) < EPS && Math.abs(q.y - pts[i].y) < EPS) continue
      out.push({ x: pts[i].x, y: pts[i].y })
    }
    for (var j = 1; j < out.length - 1; ) {
      var a = out[j - 1], b = out[j], c = out[j + 1]
      var colineal =
        (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
        (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)
      if (colineal) out.splice(j, 1)
      else j++
    }
    return out
  }

  // ── waypoints estilo Wokwi ───────────────────────────────────────────────

  /**
   * "v10" → {x:0,y:10} · "h-5" → {x:-5,y:0} · cualquier otra cosa → null.
   * En minúscula, como los escribe Wokwi. "V10" NO se acepta: un alias que
   * perdona el typo esconde el typo, y acá un typo es un cable mal puesto.
   */
  function desplazamiento(w) {
    if (typeof w !== "string") return null
    var m = w.trim().match(/^([hv])(-?(?:\d+\.?\d*|\.\d+))$/)
    if (!m) return null
    var n = parseFloat(m[2])
    if (!isFinite(n)) return null
    return m[1].toLowerCase() === "h" ? { x: n, y: 0 } : { x: 0, y: n }
  }

  /**
   * El `*` parte la lista: lo de antes se acumula DESDE el origen, lo de
   * después se acumula DESDE el destino y después se invierte, así que el
   * último punto sigue siendo el destino exacto. Si entre las dos puntas queda
   * una diagonal, se mete un codo: primero se sigue el sentido contrario al del
   * último tramo, para no encimar dos tramos en la misma recta.
   */
  function rutaPorWaypoints(o, d, ruta) {
    var corte = ruta.indexOf("*")
    var antes = corte < 0 ? ruta : ruta.slice(0, corte)
    var despues = corte < 0 ? [] : ruta.slice(corte + 1)
    var frente = [o], cola = [d], i, v, p

    for (i = 0; i < antes.length; i++) {
      v = desplazamiento(antes[i])
      if (!v) return null
      p = frente[frente.length - 1]
      frente.push({ x: p.x + v.x, y: p.y + v.y })
    }
    for (i = 0; i < despues.length; i++) {
      v = desplazamiento(despues[i])
      if (!v) return null
      p = cola[cola.length - 1]
      cola.push({ x: p.x + v.x, y: p.y + v.y })
    }
    cola.reverse()

    var a = frente[frente.length - 1], b = cola[0], medio = []
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      var prev = frente.length > 1 ? frente[frente.length - 2] : null
      var veniaVertical = prev ? Math.abs(prev.x - a.x) < EPS : false
      medio.push(veniaVertical ? { x: b.x, y: a.y } : { x: a.x, y: b.y })
    }
    return frente.concat(medio, cola)
  }

  // ── el router ────────────────────────────────────────────────────────────

  var SALIDA = 14 // px que el cable sale perpendicular antes de doblar
  var MARGEN = 8 // separación mínima al borde de la placa en los pasillos

  /**
   * rutear(geometria) → puntos[] | null      ← FUNCIÓN PURA, sin DOM.
   *
   * geometria = {
   *   origen:   {x,y}                el agujero del header (adentro de la placa)
   *   destino:  {x,y}                adonde tiene que llegar
   *   placa:    {left,top,right,bottom} | null
   *                                  con placa: sale perpendicular al borde más
   *                                  cercano y NINGÚN tramo intermedio la pisa.
   *                                  sin placa (tramo etiqueta→pieza): codo simple.
   *   carril:   number | null        x del tramo vertical largo. Sin él se elige
   *                                  pegado a la placa.
   *   limites:  {left,top,right,bottom} | null   la caja de la escena: los
   *                                  pasillos se recortan adentro para que el
   *                                  cable no se escape del recuadro.
   *   salida:   number (14)   margen: number (8)
   *   ruta:     ["v10","h5","*","v-15"]   waypoints Wokwi; default [] = automático
   * }
   *
   * Devuelve null cuando no hay camino válido. Eso NO es un error: es el
   * fallback por cable al <span class="cable"> de siempre.
   */
  function rutear(geometria) {
    var g = geometria || {}
    var o = comoPunto(g.origen)
    var d = comoPunto(g.destino)
    if (!o || !d) return null

    var placa = comoRect(g.placa)
    var limites = comoRect(g.limites)
    var salida = numero(g.salida, SALIDA)
    var margen = numero(g.margen, MARGEN)
    var ruta = Array.isArray(g.ruta) ? g.ruta : []

    // Ruteo a mano: el que escribió los waypoints manda. Se valida que sea
    // ortogonal y que las puntas sean las que se pidieron, nada más.
    if (ruta.length) {
      var manual = rutaPorWaypoints(o, d, ruta)
      if (!manual) return null
      manual = compactar(manual)
      return manual.length >= 2 && esOrtogonal(manual) ? manual : null
    }

    var cabecera = [o]
    if (placa) {
      var s = puntoDeSalida(o, placa, ladoMasCercano(o, placa), salida, limites)
      if (!s) return null
      cabecera.push(s)
    }
    var a = cabecera[cabecera.length - 1]

    var carril = isFinite(g.carril)
      ? g.carril
      : placa
        ? d.x >= placa.right
          ? placa.right + margen
          : placa.left - margen
        : (a.x + d.x) / 2

    // Candidato directo: [salida] → horizontal al carril → vertical → horizontal.
    var candidatos = [cabecera.concat([{ x: carril, y: a.y }, { x: carril, y: d.y }, d])]

    // Candidatos con rodeo: cuando el cable sale por un costado y el destino
    // está del otro lado, el directo atravesaría la placa. Se prueba el pasillo
    // de arriba y el de abajo y gana el más corto de los que NO la pisan.
    if (placa) {
      for (var i = 0; i < 2; i++) {
        var yb = corredor(placa, i === 0 ? "arriba" : "abajo", margen, limites)
        if (yb === null) continue
        candidatos.push(
          cabecera.concat([{ x: a.x, y: yb }, { x: carril, y: yb }, { x: carril, y: d.y }, d]),
        )
      }
    }

    var mejor = null, mejorLargo = Infinity
    for (var c = 0; c < candidatos.length; c++) {
      // El chequeo va sobre el candidato CRUDO (ver `libreDeLaPlaca`): recién
      // después se compacta, y sólo para dibujar.
      if (!libreDeLaPlaca(candidatos[c], placa)) continue

      // Y EL LARGO TAMBIÉN SE MIDE EN CRUDO. ACÁ ESTABA EL DEFECTO QUE MÁS
      // CABLES BORRÓ, y es de una sutileza que da rabia:
      //
      // el tramo de salida sale `salida` px del borde (14, 21, 28… escalonados)
      // y el pasillo del rodeo está a `margen` = 8 px. Cuando el cable sale por
      // el MISMO lado del pasillo, el candidato con rodeo RETROCEDE: sale hasta
      // borde−14 y vuelve a borde−8. Son tres puntos sobre la misma vertical, o
      // sea colineales, o sea que `compactar` borra el del medio — y con él los
      // 2×6 px que el cable de verdad recorre. Midiendo el camino COMPACTADO,
      // el rodeo "medía" 12 px menos que el directo y ganaba SIEMPRE.
      //
      // Y el rodeo pone su pasillo en `margen`, que es el mismo para todos: el
      // escalonado del stub desaparecía y los N cables de una fila salían a la
      // MISMA altura, uno encima del otro. Medido en `uno-simple`: los dos
      // cables del LED corrían solapados 499 px —se ve uno— y el 220Ω, que se
      // coloca en el medio del tramo horizontal más largo, quedaba montado
      // sobre el cable marrón de GND en vez del naranja del ánodo.
      //
      // Comparar caminos compactados es comparar largos que ningún cable tiene.
      // Se compacta para DIBUJAR, no para decidir.
      var L = largoDe(candidatos[c])
      var pts = compactar(candidatos[c])
      if (pts.length < 2) continue
      if (!esOrtogonal(pts)) continue
      if (L < mejorLargo - EPS) {
        mejor = pts
        mejorLargo = L
      }
    }
    return mejor
  }

  var API = {
    medidaIntrinsecaPx: medidaIntrinsecaPx,
    anchoIntrinsecoPx: anchoIntrinsecoPx,
    altoIntrinsecoPx: altoIntrinsecoPx,
    escalaUniforme: escalaUniforme,
    pinAdentro: pinAdentro,
    ladoMasCercano: ladoMasCercano,
    corredor: corredor,
    limitesUtiles: limitesUtiles,
    dentroDe: dentroDe,
    cruza: cruza,
    esOrtogonal: esOrtogonal,
    compactar: compactar,
    largoDe: largoDe,
    desplazamiento: desplazamiento,
    rutear: rutear,
    SALIDA: SALIDA,
    MARGEN: MARGEN,
    TOL_BASE: TOL_BASE,
    TOL_PIN: TOL_PIN,
  }
  raiz.TecniaCables = API
  if (typeof module === "object" && module && module.exports) module.exports = API

  /* ══════════════════════════ CAPA DOM (fina) ═══════════════════════════════
     Lo mínimo que no se puede probar sin navegador: buscar los elementos,
     MEDIR, y llamar a `rutear`. Cero geometría acá.
     ════════════════════════════════════════════════════════════════════════ */

  if (typeof document === "undefined" || typeof window === "undefined") return

  var NS = "http://www.w3.org/2000/svg"
  var CAPA = "cables-trazados"
  var GROSOR = 4 // igual que .conex .cable (height:4px)
  var PASO = 7 // escalonado entre cables que comparten agujero o pasillo
  var R_PUNTA = 3.6

  function primerElemento(cont) {
    if (!cont) return null
    for (var i = 0; i < cont.children.length; i++) {
      var n = cont.children[i]
      if (n.tagName && n.tagName.indexOf("-") > 0) return n // custom element
    }
    return cont.children[0] || null
  }

  /**
   * `data-placa="A B C"` → ["A","B","C"]. Los atributos son listas separadas
   * por espacios porque una fila puede consumir varios agujeros, y el generador
   * ya garantiza que las dos listas midan lo mismo (circuito.ts:889). Acá se
   * vuelve a chequear igual: si un día dejaran de coincidir, el cable número 3
   * terminaría en el agujero del 4 y la hoja se vería perfecta.
   */
  function nombresDe(attr) {
    if (typeof attr !== "string") return []
    var t = attr.trim()
    return t ? t.split(/\s+/) : []
  }

  /** `pinInfo` es getter de INSTANCIA. Exacto primero, después sin distinguir mayúsculas. */
  function buscarPin(el, nombre) {
    var lista = null
    try {
      lista = el.pinInfo
    } catch (_) {
      lista = null
    }
    if (!Array.isArray(lista)) return null
    var n = String(nombre), i
    for (i = 0; i < lista.length; i++) if (lista[i] && lista[i].name === n) return lista[i]
    var b = n.toLowerCase()
    for (i = 0; i < lista.length; i++)
      if (lista[i] && String(lista[i].name).toLowerCase() === b) return lista[i]
    return null
  }

  /**
   * El medidor de una pieza: de dónde sale cada agujero, en píxeles de pantalla.
   *
   * `pinInfo` está en píxeles desde el borde del ELEMENTO, a tamaño 1:1. O sea
   * que el ancla es el elemento y lo único que falta es la escala a la que se
   * terminó pintando. Y esa escala se MIDE:
   *
   *     k = rect.width / offsetWidth
   *
   * `getBoundingClientRect()` trae el transform aplicado; `offsetWidth` es la
   * caja de layout SIN transform. El cociente es la escala que de verdad pasó,
   * no la que dice el atributo style (trampa 1).
   *
   * Y el álgebra sale redonda: con `transform: scale(k)` y CUALQUIER
   * transform-origin `o`, un punto local `p` cae en
   *     borde_sin_transformar + o + k(p − o)
   * y `borde_sin_transformar = rect.left − o(1−k)`, así que todo se cancela y
   * queda `rect.left + k·p`. El transform-origin no entra en la cuenta — y por
   * eso no hace falta leerlo ni acertarle.
   *
   * SEGUNDA OPINIÓN (trampa 3): si la pieza tiene UN solo <svg> y arranca
   * pegada a su borde, el tamaño que ese <svg> declara (`width="72.58mm"`)
   * tiene que dar la misma escala. Si no, alguien le cambió el SVG sin tocar
   * `pinInfo` y las coordenadas ya no valen → null → fallback.
   * No se puede usar el <svg> como ancla: ver trampa 2 (el buzzer).
   */
  function medidorDe(el) {
    if (!el) return null
    var r = el.getBoundingClientRect()
    var k = escalaUniforme(r.width, r.height, el.offsetWidth, el.offsetHeight)
    if (k === null) return null

    var raizPieza = el.shadowRoot || el
    var svgs = raizPieza.querySelectorAll ? raizPieza.querySelectorAll("svg") : []
    if (svgs.length === 1) {
      var rs = svgs[0].getBoundingClientRect()
      var pegado = Math.abs(rs.left - r.left) < 1.5 && Math.abs(rs.top - r.top) < 1.5
      var ocupa = r.width > 0 && rs.width / r.width > 0.95
      if (pegado && ocupa) {
        var intr = anchoIntrinsecoPx(svgs[0])
        if (intr === null) return null
        if (Math.abs(rs.width / intr - k) > k * 0.02) return null
      }
    }

    return {
      caja: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      punto: function (nombre) {
        var p = buscarPin(el, nombre)
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return null
        // TERCERA OPINIÓN: el agujero tiene que caer DENTRO del dibujo. Ver
        // `pinAdentro` — el `wokwi-membrane-keypad` publica los 8 suyos 41 px
        // por debajo de su caja, y los 8 cables terminaban en el aire.
        if (!pinAdentro({ x: p.x * k, y: p.y * k }, r.width, r.height)) return null
        return { x: r.left + p.x * k, y: r.top + p.y * k }
      },
    }
  }

  /** Esquina interior (padding box) de un elemento: donde arranca un hijo `inset:0`. */
  function esquinaInterior(el) {
    var r = el.getBoundingClientRect()
    var cs = window.getComputedStyle(el)
    return {
      x: r.left + (parseFloat(cs.borderLeftWidth) || 0),
      y: r.top + (parseFloat(cs.borderTopWidth) || 0),
      ancho: el.clientWidth,
      alto: el.clientHeight,
    }
  }

  /**
   * El bloque contenedor real de un `position:absolute`. NO se asume: se
   * camina el árbol. Hoy da `.filas-libre` (que es position:relative), pero el
   * día que alguien posicione `.fila` o `.conex` la resistencia se iría a otro
   * lado sin que nadie se entere — que es el defecto que este archivo evita.
   */
  function bloqueContenedor(el) {
    var n = el.parentElement
    while (n && n !== document.documentElement) {
      var cs = window.getComputedStyle(n)
      if (cs.position !== "static") return n
      if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none") return n
      n = n.parentElement
    }
    return document.body
  }

  function centro(el) {
    var r = el.getBoundingClientRect()
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
  }
  function bordeDerecho(el) {
    var r = el.getBoundingClientRect()
    return { x: r.right, y: (r.top + r.bottom) / 2 }
  }

  // ── limpiar lo del trazado anterior ──────────────────────────────────────

  function devolverALaFila(cont) {
    var i, ns
    ns = cont.querySelectorAll("[data-cables-oculto]")
    for (i = 0; i < ns.length; i++) {
      ns[i].style.display = ""
      ns[i].removeAttribute("data-cables-oculto")
    }
    ns = cont.querySelectorAll("[data-cables-movido]")
    for (i = 0; i < ns.length; i++) {
      var s = ns[i].style
      s.position = ""
      s.left = ""
      s.top = ""
      s.margin = ""
      s.zIndex = ""
      s.transform = ""
      ns[i].removeAttribute("data-cables-movido")
    }
  }

  function restaurar(escena) {
    var capas = escena.querySelectorAll("." + CAPA)
    for (var i = 0; i < capas.length; i++) capas[i].remove()
    escena.removeAttribute("data-cables-trazados")
    escena.removeAttribute("data-cables-barra")
    devolverALaFila(escena)
  }

  /**
   * La barra gris vertical (`.filas-libre::before`) es de dónde "nacían" los
   * cables cuando eran CSS. Donde ya nacen del agujero de verdad, sobra: los
   * cables la cruzan y queda una raya sin significado en el medio del dibujo.
   * Se tapa por pseudo-elemento, así que no alcanza con tocar el style del
   * elemento: va una regla, una sola vez.
   *
   * PERO LA BARRA ES UNA SOLA PARA TODA LA ESCENA, Y EL FALLBACK ES POR FILA.
   * Ese era el defecto que más hojas rompía: la regla colgaba de
   * `[data-cables-trazados]`, o sea que alcanzaba con que UN cable se trazara
   * para que la barra desapareciera de la escena ENTERA — y los cables que
   * habían caído al fallback CSS se quedaban sin nada de dónde nacer: arrancan
   * 30 px a la derecha de su etiqueta, pegados al aire. Medido sobre el
   * catálogo (79 hojas × 3 placas, 1920 px): 26 hojas mixtas rotas, entre
   * ellas el preset `estacion-meteo` con los 4 cables del LCD como palitos de
   * colores flotando.
   *
   * La condición correcta no es «se trazó algo» sino «no quedó NINGÚN cable
   * CSS visible», y eso se cuenta del DOM, que es donde está la verdad: si
   * queda aunque sea uno, la barra se queda. El atributo que manda es
   * `data-cables-barra`, distinto de `data-cables-trazados` a propósito: el
   * segundo informa cuántos se trazaron, el primero decide el dibujo.
   */
  function reglasDeTrazado() {
    if (document.getElementById("cables-trazados-css")) return
    var st = document.createElement("style")
    st.id = "cables-trazados-css"
    st.textContent =
      '.escena[data-cables-barra="oculta"] .filas-libre::before{display:none}' +
      // IMPRESIÓN: el cable ya no vive adentro de su fila, es un <svg> absoluto
      // que cubre la escena entera, así que un salto de página lo corta por
      // donde caiga y del otro lado quedan filas sin ningún cable. La placa
      // también es UNA sola, centrada sobre todas las filas: partida la
      // escena, no hay cable que pueda unir una fila de la página 2 con una
      // placa que quedó en la página 1. Por eso la escena no se parte.
      '@media print{.escena[data-cables-trazados]{break-inside:avoid;page-break-inside:avoid}}'
    document.head.appendChild(st)
  }

  /**
   * ¿Quedó algún cable CSS a la vista en esta escena? Se pregunta al DOM
   * DESPUÉS de dibujar, porque el fallback ocurre en tres lugares distintos
   * (fila sin pieza, punta sin medir, ruteo sin camino) y contar en cada uno
   * es la clase de cuenta que un día se desincroniza sin que nadie se entere.
   */
  function cablesCSSVisibles(escena) {
    var todos = escena.querySelectorAll(".conex .cable")
    var n = 0
    for (var i = 0; i < todos.length; i++) if (!todos[i].hasAttribute("data-cables-oculto")) n++
    return n
  }

  // ── dibujo ───────────────────────────────────────────────────────────────

  function crearCapa(escena) {
    if (window.getComputedStyle(escena).position === "static") escena.style.position = "relative"
    var svg = document.createElementNS(NS, "svg")
    svg.setAttribute("class", CAPA)
    var s = svg.style
    s.position = "absolute"
    s.left = "0"
    s.top = "0"
    s.width = "100%"
    s.height = "100%"
    s.overflow = "visible"
    s.pointerEvents = "none"
    s.zIndex = "5"
    escena.appendChild(svg)
    return svg
  }

  function trazo(svg, pts, color, base) {
    var d = ""
    for (var i = 0; i < pts.length; i++) {
      d += (i ? "L" : "M") + (pts[i].x - base.x).toFixed(2) + " " + (pts[i].y - base.y).toFixed(2)
      if (i + 1 < pts.length) d += " "
    }
    var p = document.createElementNS(NS, "path")
    p.setAttribute("d", d)
    p.setAttribute("fill", "none")
    p.setAttribute("stroke", color)
    p.setAttribute("stroke-width", String(GROSOR))
    p.setAttribute("stroke-linecap", "round")
    p.setAttribute("stroke-linejoin", "round")
    svg.appendChild(p)
  }

  function punta(svg, p, color, base, radio, borde) {
    var c = document.createElementNS(NS, "circle")
    c.setAttribute("cx", (p.x - base.x).toFixed(2))
    c.setAttribute("cy", (p.y - base.y).toFixed(2))
    c.setAttribute("r", String(radio))
    c.setAttribute("fill", color)
    if (borde) {
      c.setAttribute("stroke", borde)
      c.setAttribute("stroke-width", "1.2")
    }
    svg.appendChild(c)
  }

  // ── el trazado de una escena ─────────────────────────────────────────────

  function clave(p) {
    return Math.round(p.x * 2) + ":" + Math.round(p.y * 2)
  }

  /**
   * Reparte n carriles en la banda [x0,x1]. El PRIMERO de la lista se lleva el
   * carril más lejos de la columna de nodos (el de x más chico), y ahí está la
   * razón, que es geométrica y no estética:
   *
   * dos cables que bajan por carriles distintos y después se van los dos a la
   * derecha se cruzan si el que llega MÁS LEJOS (la fila más alta, la que está
   * más arriba de todo) dobla en el carril de adentro: su tramo horizontal
   * final tiene que pasar por encima del carril del otro. Dándole el carril de
   * afuera al que va más lejos, su horizontal pasa por ARRIBA del codo del
   * otro, no a través.
   *
   * Es una HEURÍSTICA, no una garantía: con una pieza cuyos pines están al
   * revés que las filas, dos cables igual se pueden cruzar. Eso se mira, no se
   * asegura — está dicho en el informe.
   */
  function repartirCarriles(n, x0, x1) {
    var out = [], i
    if (n <= 0) return out
    if (!(x1 > x0 + 2)) {
      for (i = 0; i < n; i++) out.push(x1)
      return out
    }
    for (i = 0; i < n; i++) out.push(x0 + ((x1 - x0) * i) / n)
    return out
  }

  /**
   * ¿Este cable puede bajar por la banda ANCHA (la columna vacía de arriba o de
   * abajo de la placa) o tiene que ir por la angosta (los 31 px entre el borde
   * derecho de la placa y los nodos)?
   *
   * Puede por la ancha sólo si sale por el mismo lado al que va: si sale por el
   * header de arriba y su fila está arriba de la placa, todo el recorrido pasa
   * por encima de la placa y no la toca. Si sale por arriba y va a una fila de
   * abajo, tiene que bordearla sí o sí.
   */
  function bandaAncha(lado, destinoY, placa) {
    if (lado === "arriba") return destinoY < placa.top
    if (lado === "abajo") return destinoY > placa.bottom
    return false
  }

  function trazarEscena(escena) {
    restaurar(escena)
    var resultado = { candidatos: 0, trazados: 0 }

    var libre = escena.querySelector(".circuito-libre")
    if (!libre) return resultado // protoboard y plantillas a mano: fuera de alcance
    var placaEl = primerElemento(libre.querySelector(".esp-col"))
    if (!placaEl) return resultado

    // 1. QUIÉN SE PUEDE TRAZAR.
    //
    // Los dos atributos tienen que estar, tienen que tener la MISMA cantidad de
    // nombres, y todos los nombres tienen que existir en el `pinInfo` que
    // corresponda. Si algo de eso falla, esa fila queda como está hoy: el
    // fallback es por cable, no por hoja.
    //
    // Los atributos son LISTAS separadas por espacios, no un nombre suelto, y
    // no es un detalle: una fila puede consumir VARIOS agujeros. "Segmentos
    // A-G" del display de 7 segmentos es UNA etiqueta y SIETE cables. Leer sólo
    // el primero dibujaría un cable donde van siete, con el rótulo correcto al
    // lado — el mismo tipo de mentira que este archivo viene a sacar.
    var cand = [], filas = libre.querySelectorAll(".fila"), f, j, t
    for (f = 0; f < filas.length; f++) {
      var piezaEl = primerElemento(filas[f].querySelector(".pieza-cell"))
      if (!piezaEl) continue
      var pines = filas[f].querySelectorAll(".conex .pin")
      for (j = 0; j < pines.length; j++) {
        var lp = nombresDe(pines[j].getAttribute("data-placa"))
        var lz = nombresDe(pines[j].getAttribute("data-pieza"))
        if (!lp.length || lp.length !== lz.length) continue
        var completo = true
        for (t = 0; t < lp.length; t++) {
          if (!buscarPin(placaEl, lp[t]) || !buscarPin(piezaEl, lz[t])) completo = false
        }
        if (!completo) continue
        cand.push({ pinEl: pines[j], piezaEl: piezaEl, placa: lp, pieza: lz, fila: filas[f] })
      }
    }
    resultado.candidatos = cand.length
    if (!cand.length) return resultado

    // 2. SACAR DE LA FILA lo que el trazado reemplaza: el cable CSS y (si hay)
    //    la resistencia, que pasa a posicionarse sobre el tramo dibujado.
    for (j = 0; j < cand.length; j++) {
      var cables = cand[j].pinEl.querySelectorAll(".cable")
      for (f = 0; f < cables.length; f++) {
        cables[f].setAttribute("data-cables-oculto", "1")
        cables[f].style.display = "none"
      }
      var res = cand[j].pinEl.querySelector(".res")
      if (res) {
        cand[j].res = res
        res.setAttribute("data-cables-movido", "1")
        res.style.position = "absolute"
        res.style.margin = "0"
        res.style.zIndex = "6" // por encima de la capa de cables (z-index 5)
        res.style.transform = "translate(-50%,-50%)"
      }
    }

    // 3. MEDIR. Recién acá: ocultar los cables cambió el layout.
    var medPlaca = medidorDe(placaEl)
    if (!medPlaca) {
      restaurar(escena)
      return resultado
    }
    var esq = esquinaInterior(escena)
    var base = { x: esq.x, y: esq.y }
    // La holgura es lo que un cable necesita para bordear la placa por afuera:
    // el pasillo (MARGEN) más el tramo de salida (SALIDA) y un píxel de gracia.
    // Sólo se usa del lado por el que la placa YA se sale del recuadro.
    var limites = limitesUtiles(
      { left: esq.x, top: esq.y, right: esq.x + esq.ancho, bottom: esq.y + esq.alto },
      medPlaca.caja,
      MARGEN + SALIDA + 2,
    )

    // Un HILO por cable. Una fila con "Segmentos A-G" da siete hilos, todos con
    // la misma etiqueta y el mismo color: siete agujeros de la placa que van a
    // siete patas de la pieza, y una sola cajita en el medio que los nombra.
    var vivos = []
    for (j = 0; j < cand.length; j++) {
      var c = cand[j]
      var medPieza = medidorDe(c.piezaEl)
      var nodo = c.pinEl.querySelector(".nodo")
      var label = c.pinEl.querySelector(".label")
      // La pieza no se pudo medir (caja estirada, escala que no cierra): el
      // cable CSS de esta fila TIENE que volver. El `continue` pelado que había
      // acá dejaba el <span class="cable"> oculto del paso 2 y sin trazo que lo
      // reemplace: el cable no caía al fallback, DESAPARECÍA. Se veía sólo en
      // las hojas donde otra fila sí se trazaba, porque ahí no corre el
      // `restaurar()` del final.
      if (!medPieza || !nodo || !label) {
        devolverALaFila(c.pinEl)
        continue
      }
      var rLabel = label.getBoundingClientRect()
      var xNodo = centro(nodo).x
      var color = (window.getComputedStyle(c.pinEl).getPropertyValue("--c") || "#607d8b").trim()
      c.hilos = []
      for (t = 0; t < c.placa.length; t++) {
        var origen = medPlaca.punto(c.placa[t])
        var destino = medPieza.punto(c.pieza[t])
        if (!origen || !destino) {
          c.hilos = null
          break
        }
        // Las puntas de la etiqueta se reparten a lo alto de la cajita: con un
        // solo cable cae en el medio (o sea, en el centro del nodo), y con
        // siete entran y salen en abanico en vez de superponerse.
        var alto = rLabel.top + (rLabel.height * (t + 1)) / (c.placa.length + 1)
        c.hilos.push({
          fila: c.fila,
          pinEl: c.pinEl,
          res: t === 0 ? c.res : null,
          color: color,
          origen: origen,
          destino: destino,
          nodo: { x: xNodo, y: alto },
          salidaLabel: { x: rLabel.right, y: alto },
          lado: ladoMasCercano(origen, medPlaca.caja),
          cajaPieza: medPieza.caja,
        })
      }
      if (!c.hilos) {
        devolverALaFila(c.pinEl) // una punta sin medir: la fila entera vuelve al cable CSS
        continue
      }
      for (t = 0; t < c.hilos.length; t++) vivos.push(c.hilos[t])
    }
    if (!vivos.length) {
      restaurar(escena)
      return resultado
    }

    // 4. CARRILES. Acá se decide el dibujo entero, y es lo que el caso de 6
    //    componentes obliga: hay DOS bandas, no una.
    var minNodoX = Infinity
    for (j = 0; j < vivos.length; j++) minNodoX = Math.min(minNodoX, vivos[j].nodo.x)
    var angosta = [medPlaca.caja.right + MARGEN, Math.max(medPlaca.caja.right + MARGEN, minNodoX - 10)]

    var grupos = { ancha: [], angosta: [] }
    for (j = 0; j < vivos.length; j++) {
      var v0 = vivos[j]
      var cual = bandaAncha(v0.lado, v0.nodo.y, medPlaca.caja) ? "ancha" : "angosta"
      v0.banda = cual
      grupos[cual].push(v0)
    }

    // La banda ancha se usa para SEPARAR, no para pasear: se toma sólo lo que
    // hace falta (16 px por cable) y pegada a la columna de nodos. Repartir los
    // 274 px enteros mandaba el cable de la primera fila hasta el borde
    // izquierdo de la placa: separaba igual y dibujaba 230 px de desvío.
    var anchoNecesario = grupos.ancha.length * 16
    var ancha = [Math.max(medPlaca.caja.left + 12, angosta[1] - anchoNecesario), angosta[1]]

    // Dentro de cada banda, el que va MÁS LEJOS de la placa se lleva el carril
    // de afuera (ver repartirCarriles). "Más lejos" = más distancia vertical
    // entre su fila y el centro de la placa.
    var centroPlaca = (medPlaca.caja.top + medPlaca.caja.bottom) / 2
    var orden = []
    for (var b in grupos) {
      var g = grupos[b]
      if (!g.length) continue
      g.sort(function (p, q) {
        return Math.abs(q.nodo.y - centroPlaca) - Math.abs(p.nodo.y - centroPlaca)
      })
      var banda = b === "ancha" ? ancha : angosta
      var cs = repartirCarriles(g.length, banda[0], banda[1])
      for (j = 0; j < g.length; j++) {
        g[j].carril = cs[j]
        orden.push(g[j])
      }
    }

    // Escalonado del stub: el pasillo por el que el cable se aleja del header.
    // El que tiene que recorrer más horizontal (y por lo tanto cruza por encima
    // de más codos ajenos) sale MÁS AFUERA. De paso resuelve el caso GND: los 6
    // cables que salen del MISMO agujero doblan a 6 alturas distintas.
    // PALIATIVO, no solución — ver el encabezado.
    orden.sort(function (p, q) {
      return Math.abs(q.carril - q.origen.x) - Math.abs(p.carril - p.origen.x)
    })
    var porAgujero = {}, porLado = {}
    for (j = 0; j < orden.length; j++) {
      var k = clave(orden[j].origen)
      porAgujero[k] = (porAgujero[k] || 0) + 1
      // el escalonado se cuenta POR LADO: los pasillos de arriba y los de abajo
      // están en mitades distintas de la hoja y no se pisan entre sí.
      porLado[orden[j].lado] = (porLado[orden[j].lado] || 0) + 1
      orden[j].salida = SALIDA + (porLado[orden[j].lado] - 1) * PASO
      orden[j].compartido = k
    }

    // Tramo B (etiqueta → pieza): el carril se escalona POR FILA, para que dos
    // pines de la misma pieza no compartan la vertical.
    var porFila = {}
    for (j = 0; j < orden.length; j++) {
      var f = orden[j].fila
      if (!porFila[f.__cablesId || (f.__cablesId = "f" + j)]) porFila[f.__cablesId] = []
      porFila[f.__cablesId].push(orden[j])
    }
    for (var idf in porFila) {
      var pf = porFila[idf]
      pf.sort(function (p, q) {
        return p.salidaLabel.y - q.salidaLabel.y
      })
      for (j = 0; j < pf.length; j++) pf[j].ordenFila = j
    }

    // 5. RUTEAR. Todavía no se dibuja nada: una fila se dibuja ENTERA o no se
    //    dibuja. Media fila trazada y media con el cable CSS sería un dibujo
    //    que no dice ni una cosa ni la otra.
    for (j = 0; j < orden.length; j++) {
      var v = orden[j]

      // LAS PUNTAS TIENEN QUE CAER EN LA ZONA DIBUJABLE, y si no, falla cerrado.
      // Con la hoja angosta la columna de etiquetas se desborda del recuadro:
      // medido en `e-7segmentos` a 420 px, el borde derecho de la etiqueta
      // «Segmentos A-G» queda en x=794 sobre una escena que termina en x=442.
      // Rutear hasta ahí dibuja siete cables que salen del recuadro, cruzan la
      // placa por arriba y pasan por encima del título. El cable CSS, que vive
      // adentro de la fila, se desborda con la fila y no hace ese desastre.
      // Cuando la punta no está donde se puede dibujar, no se dibuja.
      if (!dentroDe(v.origen, limites) || !dentroDe(v.nodo, limites) || !dentroDe(v.salidaLabel, limites)) continue

      var tramoA = rutear({
        origen: v.origen,
        destino: v.nodo,
        placa: medPlaca.caja,
        carril: v.carril,
        limites: limites,
        salida: v.salida,
      })
      if (!tramoA) continue

      // Tramo B: del borde derecho de la etiqueta al pin de la pieza. Se rutea
      // AL REVÉS —desde el pin hacia la etiqueta— y después se da vuelta, para
      // que valga la misma regla que en la placa: el cable sale PERPENDICULAR
      // al borde de la pieza, que es como sale una pata de verdad.
      //
      // No es cosmético: el LED tiene sus dos pines a la MISMA altura
      // (A@25,42 y C@15,42), así que con una llegada horizontal los dos cables
      // se superponían casi todo el tramo y el 220Ω del ánodo quedaba pegado a
      // la etiqueta del cátodo, como si fuera de ella. Saliendo para abajo de
      // la pieza, cada uno corre a su propia altura y sólo se juntan en el
      // último centímetro, que es donde de verdad están juntos.
      //
      // EXCEPCIÓN MEDIDA: cuando el pin mira para el lado CONTRARIO a la
      // etiqueta (el `wokwi-photoresistor-sensor` tiene los cuatro pines
      // pegados a su borde derecho), salir perpendicular manda el cable a dar
      // la vuelta por afuera de la pieza, y afuera de la pieza está el borde de
      // la hoja: el cable se cortaba.
      //
      // ACÁ SE ENTRA DERECHO Y SE FRENA EN EL BORDE, QUE ES LO QUE HACE EL
      // CABLE CSS. La versión anterior decía que entraba «como el cable CSS de
      // hoy» y no era cierto: pasaba `placa:null`, con lo cual el camino
      // atravesaba el módulo ENTERO hasta el pin del borde opuesto, y como ese
      // pin está sobre el borde derecho de la pieza —que en las hojas angostas
      // es también el borde de la hoja— la punta terminaba dibujada afuera del
      // recuadro, sobre el fondo blanco. Medido: 17 de 79 hojas con cable
      // afuera a 1920 px, y las 15 con cable a 420 px. El cable CSS frena en el
      // borde IZQUIERDO del módulo; acá se hace lo mismo, y el punto de llegada
      // se corre a ese borde (`destinoB`) para que la punta tampoco mienta.
      var ladoPieza = ladoMasCercano(v.destino, v.cajaPieza)
      var daLaVuelta = ladoPieza === "der" && v.salidaLabel.x < v.cajaPieza.left
      if (daLaVuelta) v.destino = { x: v.cajaPieza.left, y: v.destino.y }
      if (!dentroDe(v.destino, limites)) continue

      // EL CARRIL DE ESTE TRAMO VA PEGADO A LA PIEZA, NO A LA ETIQUETA, y eso
      // decide cuál de los dos tramos largos es el que se ve.
      //
      // El camino tiene forma de Z: un horizontal a la altura de la ETIQUETA,
      // un vertical en el carril, y un horizontal a la altura del PIN. El
      // carril decide cuál de los dos horizontales es el largo. Con el carril
      // pegado a la etiqueta, el largo quedaba a la altura del PIN — y las
      // piezas tienen VARIOS pines a la MISMA altura: el `wokwi-rgb-led` pone
      // R, G y B en y=44 y el `wokwi-7segment` pone A, B, F y G en y=3,78.
      // Tres cables de colores distintos corriendo 485 px sobre la misma
      // recta: se ve UNO. Y no lo arregla el escalonado de `salida`, que
      // separa en la perpendicular al borde mientras que acá lo que se pisa es
      // la paralela.
      // Con el carril pegado a la pieza, el horizontal largo pasa a estar a la
      // altura de la ETIQUETA, y las etiquetas SIEMPRE están separadas (la
      // columna es un flex con gap de 9 px y cajas de 40 px de alto). Lo que
      // queda compartido a la altura del pin son los 9 px que el escalonado le
      // da a cada carril. De paso el cable corre alineado con su propio rótulo
      // en casi todo su recorrido, que es lo que se quiere leer.
      var carrilB = v.cajaPieza.left - 14 - (v.ordenFila || 0) * 9
      var minCarril = v.salidaLabel.x + 6
      if (carrilB < minCarril) carrilB = minCarril
      if (carrilB > v.destino.x - 8) carrilB = Math.max(minCarril, v.destino.x - 8)
      var tramoB = rutear({
        origen: v.destino,
        destino: v.salidaLabel,
        placa: daLaVuelta ? null : v.cajaPieza,
        carril: carrilB,
        salida: SALIDA + (v.ordenFila || 0) * PASO,
      })
      // Sin lugar para el carril (la etiqueta larguísima del display de 7
      // segmentos deja 20 px hasta la pieza cuando la hoja mide 800 px), se
      // entra derecho con el codo simple: perder la salida perpendicular es
      // mucho menos malo que perder la fila entera y volver al cable CSS.
      if (tramoB) tramoB = tramoB.slice().reverse()
      else tramoB = rutear({ origen: v.salidaLabel, destino: v.destino })
      if (!tramoB) continue
      v.tramoA = tramoA
      v.tramoB = tramoB
    }

    // 6. DIBUJAR, fila por fila.
    //
    // FALLBACK POR FILA: si a una fila le falta aunque sea un cable, todos sus
    // <span class="cable"> vuelven al layout y esa fila se ve como hoy. Sin
    // esto el cable desaparecía: oculto arriba, sin trazo acá. La hoja queda
    // mixta —13 trazados y 2 con el cable CSS— y está bien que quede así.
    var svg = crearCapa(escena)
    var dibujados = {}
    for (j = 0; j < cand.length; j++) {
      var hilos = cand[j].hilos
      if (!hilos || !hilos.length) continue
      var entera = true
      for (t = 0; t < hilos.length; t++) if (!hilos[t].tramoA || !hilos[t].tramoB) entera = false
      if (!entera) {
        devolverALaFila(cand[j].pinEl)
        continue
      }
      for (t = 0; t < hilos.length; t++) {
        var h = hilos[t]
        trazo(svg, h.tramoA, h.color, base)
        trazo(svg, h.tramoB, h.color, base)

        // La punta de la placa: el agujero donde hay que pinchar. Si varios
        // cables caen en el mismo, el punto se agranda (paliativo del GND).
        if (!dibujados[h.compartido]) {
          dibujados[h.compartido] = true
          var n = porAgujero[h.compartido]
          punta(svg, h.origen, h.color, base, R_PUNTA + (n > 1 ? 1.6 : 0), n > 1 ? "#37474f" : null)
        }
        punta(svg, h.destino, h.color, base, R_PUNTA - 0.6, null)

        // La resistencia, sobre el tramo largo del trazo B (y no en la fila
        // flex, donde quedaba a otra altura y el cable le pasaba de largo).
        if (h.res) colocarResistencia(h.res, h.tramoB)
        resultado.trazados++
      }
    }

    if (!resultado.trazados) {
      restaurar(escena)
    } else {
      reglasDeTrazado()
      escena.setAttribute("data-cables-trazados", String(resultado.trazados))
      // La barra sólo sobra cuando ya no nace ningún cable de ella.
      resultado.css = cablesCSSVisibles(escena)
      escena.setAttribute("data-cables-barra", resultado.css ? "visible" : "oculta")
    }
    return resultado
  }

  /** La pone en el medio del segmento HORIZONTAL más largo del tramo. */
  function colocarResistencia(res, pts) {
    var mejor = null, mejorLargo = -1
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1]
      if (Math.abs(a.y - b.y) > EPS) continue
      var L = Math.abs(b.x - a.x)
      if (L > mejorLargo) {
        mejorLargo = L
        mejor = { x: (a.x + b.x) / 2, y: a.y }
      }
    }
    if (!mejor) return
    var bloque = bloqueContenedor(res)
    var esq = esquinaInterior(bloque)
    res.style.left = (mejor.x - esq.x).toFixed(2) + "px"
    res.style.top = (mejor.y - esq.y).toFixed(2) + "px"
  }

  // ── cuándo se corre ──────────────────────────────────────────────────────

  function trazarTodo() {
    var escenas = document.querySelectorAll(".escena")
    var total = { candidatos: 0, trazados: 0 }
    for (var i = 0; i < escenas.length; i++) {
      var r = trazarEscena(escenas[i])
      total.candidatos += r.candidatos
      total.trazados += r.trazados
    }
    return total
  }
  API.trazarTodo = trazarTodo

  var pendiente = null
  function conDemora() {
    if (pendiente) clearTimeout(pendiente)
    pendiente = setTimeout(function () {
      pendiente = null
      trazarTodo()
    }, 120)
  }

  /**
   * `load` + un tick: las piezas pintan en `connectedCallback` y el bundle de
   * Wokwi define los custom elements mientras parsea. Con DOMContentLoaded se
   * mide una caja que todavía no existe.
   *
   * El tick es `setTimeout`, NO `requestAnimationFrame`, y está medido: en una
   * pestaña en segundo plano Chrome no corre NINGÚN rAF, así que la hoja
   * quedaba sin cables hasta que alguien la mirara. Con la primera pasada
   * síncrona sobre el `load` y un setTimeout de refuerzo, la hoja sale dibujada
   * aunque se abra en una pestaña que nunca se enfocó — que es exactamente lo
   * que pasa cuando el tool abre el archivo y la docente sigue en el chat.
   */
  function arrancar() {
    var r = trazarTodo()
    // Refuerzo: una pieza que upgradeó tarde cambia las medidas. Dos pasadas
    // acotadas, no un loop.
    setTimeout(trazarTodo, 0)
    if (r.candidatos > 0 && r.trazados === 0) setTimeout(trazarTodo, 250)
  }

  if (document.readyState === "complete") arrancar()
  else window.addEventListener("load", arrancar)
  window.addEventListener("resize", conDemora)
  window.addEventListener("beforeprint", trazarTodo) // estas hojas se imprimen
})(typeof globalThis !== "undefined" ? globalThis : this)
