// Modo Vivo V4 — la página que sirve el runtime en `GET /` (PROTOCOLO-VIVO-V1.md sec. 8.3, "por pines").
//
// Vive en `vivo/` porque es INTERFAZ (lo que ve el alumno en el celular), no generación de firmware:
// `codegen/runtime*.ts` la importa como texto y la embebe en el C++. Es una función PURA de la lista de
// pines a un string ASCII: HTML + CSS + JS propios, sin frameworks, sin CDN, sin internet (la red del
// runtime no tiene salida). La página NUNCA inventa estado: cada texto que muestra sale de una respuesta
// de la placa, con la hora del celular en que llegó. Sin `node:`: también corre en el navegador.
//
// Qué pines mostrar lo decide quien llama (`PaginaPortal`): esta función no conoce ninguna placa ni ningún
// número de GPIO; el generador valida las listas contra la política de `placas.ts`.
//
// Restricciones de forma, todas con motivo:
// - Sólo ASCII (tildes y eñes con entidades HTML): `main.cpp` es ASCII.
// - Sin comillas simples, sin `//` y sin barras invertidas: el traductor C++ → JS de
//   `tests/vivo-runtime-cpp.test.mjs` convierte `'x'` en números y recorta `//` como comentario; la
//   página va embebida como literal de C++ y tiene que pasar por ahí intacta.
// - Sin `http://` ni `https://`: no hay nada afuera de la placa a lo que apuntar.
// - El JS es ES5 (var/function): el celular del aula puede ser viejo; `fetch` es lo único moderno.

/** Ruta del `POST` con una línea del formato plano (contrato sec. 8.2). */
export const RUTA_COMANDO = "/comando"

/** Los pines que la página ofrece. Listas vacías son válidas: la sección no se muestra. */
export interface PaginaPortal {
  /** Salidas a la vista: botones Alto/Bajo y deslizador PWM. */
  readonly salidas: readonly number[]
  /** Más salidas, escondidas detrás de "más pines". */
  readonly salidasExtra: readonly number[]
  /** Lecturas digitales: `pin.modo entradaPullUp` la primera vez, después `digital.leer`. */
  readonly entradasDigitales: readonly number[]
  /** Lecturas analógicas: `analogico.leer` (crudo, tal cual lo da la placa). */
  readonly entradasAnalogicas: readonly number[]
}

const lista = (numeros: readonly number[]): string => `[${numeros.join(", ")}]`

/** La página entera como texto ASCII con saltos de línea `\n`. Lanza si algo no es ASCII o rompe el traductor. */
export function renderizarPaginaPortal(pagina: PaginaPortal): string {
  for (const [nombre, numeros] of Object.entries(pagina)) {
    if (!Array.isArray(numeros) || numeros.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`pagina.${nombre}: tiene que ser una lista de numeros de GPIO`)
  }
  const haySalidas = pagina.salidas.length + pagina.salidasExtra.length > 0
  const hayEntradas = pagina.entradasDigitales.length + pagina.entradasAnalogicas.length > 0
  const l: string[] = []
  l.push("<!doctype html>")
  l.push('<html lang="es">')
  l.push("<head>")
  l.push('<meta charset="utf-8">')
  l.push('<meta name="viewport" content="width=device-width, initial-scale=1">')
  l.push("<title>Tecnia Bot - Modo Vivo</title>")
  l.push("<style>")
  l.push("body{font-family:sans-serif;margin:0;padding:12px 16px;background:#f3f3f3;color:#222;max-width:600px}")
  l.push("h1{font-size:1.25em;margin:0 0 4px}")
  l.push("h2{font-size:1em;margin:16px 0 6px;color:#444}")
  l.push(".cab{font-size:.9em;color:#555}")
  l.push(".pin{background:#fff;border:1px solid #ddd;border-radius:6px;padding:8px 10px;margin:6px 0}")
  l.push(".pin strong{display:inline-block;min-width:4.5em}")
  l.push("button{font-size:1em;padding:6px 14px;margin:2px 6px 2px 0}")
  l.push("input[type=range]{width:100%;margin-top:6px}")
  l.push(".est{font-size:.85em;color:#555;margin-top:4px;word-break:break-all}")
  l.push("#registro{font-family:monospace;font-size:.78em;background:#1e1e1e;color:#e8e8e8;padding:8px;border-radius:6px;min-height:5em;word-break:break-all}")
  l.push(".oculto{display:none}")
  l.push("</style>")
  l.push("</head>")
  l.push("<body>")
  l.push("<h1>Tecnia Bot &middot; Modo Vivo</h1>")
  l.push('<div class="cab">placa <span id="placa">?</span> &middot; runtime <span id="runtime">?</span> &middot; red <span id="ssid">?</span></div>')
  if (haySalidas) {
    l.push("<h2>Salidas</h2>")
    l.push('<div id="salidas"></div>')
    if (pagina.salidasExtra.length > 0) {
      l.push('<button type="button" id="mas">m&aacute;s pines</button>')
      l.push('<div id="otras" class="oculto"></div>')
    }
  }
  if (hayEntradas) {
    l.push("<h2>Entradas</h2>")
    for (const pin of pagina.entradasDigitales) {
      l.push(`<div class="pin"><strong>GPIO${pin}</strong> digital (pull-up interno) <button type="button" id="leer-${pin}">leer</button><div class="est" id="est-${pin}">sin lectura todav&iacute;a</div></div>`)
    }
    for (const pin of pagina.entradasAnalogicas) {
      l.push(`<div class="pin"><strong>GPIO${pin}</strong> anal&oacute;gica (valor crudo del conversor) <button type="button" id="leer-${pin}">leer</button><div class="est" id="est-${pin}">sin lectura todav&iacute;a</div></div>`)
    }
    l.push('<label><input type="checkbox" id="cada1s"> leer cada 1 s</label>')
  }
  l.push("<h2>Registro: las &uacute;ltimas 10 l&iacute;neas, tal cual van por el cable</h2>")
  l.push('<div id="registro"></div>')
  l.push("<script>")
  l.push(`var RUTA = "${RUTA_COMANDO}";`)
  l.push(`var SALIDAS = ${lista(pagina.salidas)};`)
  l.push(`var OTRAS = ${lista(pagina.salidasExtra)};`)
  l.push(`var ENTRADAS_DIGITALES = ${lista(pagina.entradasDigitales)};`)
  l.push(`var ENTRADAS_ANALOGICAS = ${lista(pagina.entradasAnalogicas)};`)
  l.push("var cola = Promise.resolve();")
  l.push("var registro = [];")
  l.push("var enVuelo = 0;")
  l.push("var pullUpListo = {};")
  l.push("var temporizador = null;")
  l.push('function dos(n) { return (n < 10 ? "0" : "") + n; }')
  l.push('function hora() { var d = new Date(); return dos(d.getHours()) + ":" + dos(d.getMinutes()) + ":" + dos(d.getSeconds()); }')
  l.push("function porId(id) { return document.getElementById(id); }")
  l.push("function anotar(marca, linea) {")
  l.push('  registro.push(hora() + " " + marca + " " + linea);')
  l.push("  if (registro.length > 10) registro.shift();")
  l.push('  var caja = porId("registro");')
  l.push('  caja.textContent = "";')
  l.push("  for (var i = 0; i < registro.length; i++) {")
  l.push('    var fila = document.createElement("div");')
  l.push("    fila.textContent = registro[i];")
  l.push("    caja.appendChild(fila);")
  l.push("  }")
  l.push("}")
  l.push("function enviar(linea) {")
  l.push("  enVuelo++;")
  l.push("  var paso = cola.then(function () {")
  l.push('    anotar(">>", linea);')
  l.push('    return fetch(RUTA, { method: "POST", body: linea }).then(function (r) { return r.text(); }).then(function (texto) {')
  l.push('      anotar("<<", texto);')
  l.push("      var objeto = null;")
  l.push("      try { objeto = JSON.parse(texto); } catch (e) { objeto = null; }")
  l.push("      return { texto: texto, objeto: objeto, hora: hora() };")
  l.push("    }, function (e) {")
  l.push('      anotar("!!", "sin respuesta de la placa");')
  l.push('      return { texto: "", objeto: null, hora: hora() };')
  l.push("    });")
  l.push("  }).then(function (r) { enVuelo--; return r; });")
  l.push("  cola = paso;")
  l.push("  return paso;")
  l.push("}")
  l.push("function mostrar(pin, r) {")
  l.push('  var est = porId("est-" + pin);')
  l.push("  if (!est) return;")
  l.push('  est.textContent = (r.texto ? "respuesta: " + r.texto : "sin respuesta") + " (" + r.hora + ")";')
  l.push("}")
  l.push("function mandarYMostrar(linea, pin) { return enviar(linea).then(function (r) { mostrar(pin, r); return r; }); }")
  l.push("function filaDeSalida(pin) {")
  l.push('  var fila = document.createElement("div");')
  l.push('  fila.className = "pin";')
  l.push('  var nombre = document.createElement("strong");')
  l.push('  nombre.textContent = "GPIO" + pin;')
  l.push("  fila.appendChild(nombre);")
  l.push('  var niveles = ["alto", "bajo"];')
  l.push("  for (var i = 0; i < niveles.length; i++) {")
  l.push("    (function (nivel) {")
  l.push('      var boton = document.createElement("button");')
  l.push('      boton.type = "button";')
  l.push('      boton.textContent = nivel === "alto" ? "Alto" : "Bajo";')
  l.push('      boton.addEventListener("click", function () { mandarYMostrar("digital.escribir pin=" + pin + " nivel=" + nivel, pin); });')
  l.push("      fila.appendChild(boton);")
  l.push("    })(niveles[i]);")
  l.push("  }")
  l.push('  var rango = document.createElement("input");')
  l.push('  rango.type = "range";')
  l.push('  rango.min = "0";')
  l.push('  rango.max = "100";')
  l.push('  rango.value = "0";')
  l.push('  rango.title = "PWM 0 a 100";')
  l.push('  rango.addEventListener("change", function () { mandarYMostrar("pwm.escribir pin=" + pin + " porcentaje=" + rango.value, pin); });')
  l.push("  fila.appendChild(rango);")
  l.push('  var est = document.createElement("div");')
  l.push('  est.className = "est";')
  l.push('  est.id = "est-" + pin;')
  l.push('  est.textContent = "sin respuesta todavia";')
  l.push("  fila.appendChild(est);")
  l.push("  return fila;")
  l.push("}")
  l.push("function leerDigital(pin) {")
  l.push('  var lectura = "digital.leer pin=" + pin;')
  l.push("  if (pullUpListo[pin]) return mandarYMostrar(lectura, pin);")
  l.push('  return enviar("pin.modo pin=" + pin + " modo=entradaPullUp").then(function (r) {')
  l.push('    if (!(r.objeto && r.objeto.tipo === "ok")) { mostrar(pin, r); return r; }')
  l.push("    pullUpListo[pin] = true;")
  l.push("    return mandarYMostrar(lectura, pin);")
  l.push("  });")
  l.push("}")
  l.push('function leerAnalogico(pin) { return mandarYMostrar("analogico.leer pin=" + pin, pin); }')
  l.push("function leerTodo() {")
  l.push("  var i;")
  l.push("  for (i = 0; i < ENTRADAS_DIGITALES.length; i++) leerDigital(ENTRADAS_DIGITALES[i]);")
  l.push("  for (i = 0; i < ENTRADAS_ANALOGICAS.length; i++) leerAnalogico(ENTRADAS_ANALOGICAS[i]);")
  l.push("}")
  l.push("function armar() {")
  l.push("  var i;")
  l.push('  for (i = 0; i < SALIDAS.length; i++) porId("salidas").appendChild(filaDeSalida(SALIDAS[i]));')
  l.push('  for (i = 0; i < OTRAS.length; i++) porId("otras").appendChild(filaDeSalida(OTRAS[i]));')
  l.push('  if (porId("mas")) porId("mas").addEventListener("click", function () {')
  l.push('    var otras = porId("otras");')
  l.push('    otras.classList.toggle("oculto");')
  l.push('    porId("mas").innerHTML = otras.classList.contains("oculto") ? "m&aacute;s pines" : "menos pines";')
  l.push("  });")
  l.push("  for (i = 0; i < ENTRADAS_DIGITALES.length; i++) {")
  l.push('    (function (pin) { porId("leer-" + pin).addEventListener("click", function () { leerDigital(pin); }); })(ENTRADAS_DIGITALES[i]);')
  l.push("  }")
  l.push("  for (i = 0; i < ENTRADAS_ANALOGICAS.length; i++) {")
  l.push('    (function (pin) { porId("leer-" + pin).addEventListener("click", function () { leerAnalogico(pin); }); })(ENTRADAS_ANALOGICAS[i]);')
  l.push("  }")
  l.push('  if (porId("cada1s")) porId("cada1s").addEventListener("change", function () {')
  l.push("    if (this.checked) {")
  l.push("      temporizador = setInterval(function () { if (enVuelo === 0) leerTodo(); }, 1000);")
  l.push("    } else {")
  l.push("      clearInterval(temporizador);")
  l.push("      temporizador = null;")
  l.push("    }")
  l.push("  });")
  l.push('  enviar("hola").then(function (r) {')
  l.push("    var o = r.objeto;")
  l.push('    if (!(o && o.tipo === "hola")) return;')
  l.push('    porId("placa").textContent = o.placa;')
  l.push('    porId("runtime").textContent = o.runtime;')
  l.push('    porId("ssid").textContent = o.wifi ? o.wifi.ssid : "(no anunciada)";')
  l.push("  });")
  l.push("}")
  l.push("armar();")
  l.push("</script>")
  l.push("</body>")
  l.push("</html>")
  const html = l.join("\n")
  if (!/^[\x0a\x20-\x7e]*$/.test(html)) throw new Error("la pagina embebida tiene que ser ASCII (tildes con entidades HTML)")
  if (html.includes("'") || html.includes("//") || html.includes("\\")) throw new Error("la pagina embebida no puede llevar comillas simples, // ni barras invertidas (ver el traductor del test)")
  return html
}
