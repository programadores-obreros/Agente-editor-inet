// Modo Vivo (protocolo v1, slices V1–V4) — la página del portal (`opencode/vivo/pagina-portal.ts`): una función
// pura de la lista de pines a un HTML ASCII, sin internet, que habla con `POST /comando` y muestra SOLO los pines
// que le dan. V4-6c (§9): los strapping van al final de "más pines", bajo un aviso, sólo si vienen en `salidasConAviso`.
// Corre solo: `node --test tests/vivo-pagina-portal.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { renderizarPaginaPortal, RUTA_COMANDO, AVISO_STRAPPING } = await import(join(REPO, "opencode/vivo/pagina-portal.ts"))

const PAGINA = Object.freeze({ salidas: [2, 18], salidasExtra: [5, 23], entradasDigitales: [4], entradasAnalogicas: [34, 35] })
const VACIA = Object.freeze({ salidas: [], salidasExtra: [], entradasDigitales: [], entradasAnalogicas: [] })

test("forma: ASCII, sin http(s)://, sin scripts externos, sin comillas simples ni // ni barras (el traductor del runtime la pasa intacta); nombra /comando y pide hola al cargar", () => {
  const html = renderizarPaginaPortal(PAGINA)
  assert.ok(/^[\x0a\x20-\x7e]*$/.test(html), "ASCII")
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /<script[^>]*src=|<link|@import|cdn|unpkg|jsdelivr/i)
  assert.doesNotMatch(html, /'|\/\/|\\/)
  assert.equal(RUTA_COMANDO, "/comando", "contrato sec. 8.2")
  assert.ok(html.includes(`var RUTA = "${RUTA_COMANDO}";`) && html.includes('fetch(RUTA, { method: "POST", body: linea })'))
  assert.ok(html.includes('enviar("hola")') && html.includes("o.wifi.ssid") && html.includes('id="placa"') && html.includes('id="runtime"'))
  assert.ok(html.includes('<meta charset="utf-8">') && html.includes('<meta name="viewport"') && html.includes('<html lang="es">'))
  assert.equal(renderizarPaginaPortal(PAGINA), html, "pura: mismos pines, mismos bytes")
  assert.ok(html.includes("&uacute;ltimas 10 l&iacute;neas") && html.includes("registro.length > 10"), "registro de las últimas 10 líneas")
  // Nunca inventa estado: lo que muestra por pin es la respuesta de la placa y la hora.
  assert.ok(html.includes('"respuesta: " + r.texto') && html.includes('"sin respuesta"') && html.includes("r.hora"))
})

test("muestra sólo los pines que le dan: salidas a la vista, salidasExtra detrás de 'más pines', digitales con entradaPullUp la primera vez, analógicas con analogico.leer, casilla 'cada 1 s'", () => {
  const html = renderizarPaginaPortal(PAGINA)
  assert.ok(html.includes("var SALIDAS = [2, 18];") && html.includes("var OTRAS = [5, 23];") && html.includes("var ENTRADAS_DIGITALES = [4];") && html.includes("var ENTRADAS_ANALOGICAS = [34, 35];"))
  assert.ok(html.includes('id="mas"') && html.includes("m&aacute;s pines") && html.includes('id="otras" class="oculto"'))
  for (const pin of [4, 34, 35]) assert.ok(html.includes(`id="leer-${pin}"`) && html.includes(`id="est-${pin}"`), `fila de lectura de GPIO${pin}`)
  assert.ok(html.includes("GPIO4</strong> digital (pull-up interno)") && html.includes("GPIO34</strong> anal&oacute;gica"))
  assert.ok(html.includes("modo=entradaPullUp") && html.includes("pullUpListo[pin] = true") && html.includes('"digital.leer pin=" + pin') && html.includes('"analogico.leer pin=" + pin'))
  assert.ok(html.includes('"digital.escribir pin=" + pin + " nivel=" + nivel') && html.includes('"pwm.escribir pin=" + pin + " porcentaje=" + rango.value'))
  assert.ok(html.includes('id="cada1s"') && html.includes("leer cada 1 s") && html.includes("setInterval(") && html.includes("clearInterval("))
  // Ningún pin que no le dieron.
  for (const pin of [0, 1, 6, 12, 13, 19, 36, 39]) assert.doesNotMatch(html, new RegExp(`GPIO${pin}\\b|leer-${pin}"|\\[${pin}[,\\]]|, ${pin}[,\\]]`), `GPIO${pin} no aparece`)
})

test("listas vacías: válidas, y la sección no se muestra (ni el botón de más pines, ni las entradas, ni la casilla); con todo vacío queda la cabecera y el registro", () => {
  const vacia = renderizarPaginaPortal(VACIA)
  assert.ok(!vacia.includes("<h2>Salidas</h2>") && !vacia.includes('id="mas"') && !vacia.includes("<h2>Entradas</h2>") && !vacia.includes('id="cada1s"'))
  assert.ok(vacia.includes('id="registro"') && vacia.includes('id="ssid"') && vacia.includes('enviar("hola")'))
  assert.ok(vacia.includes("var SALIDAS = [];") && vacia.includes("var ENTRADAS_ANALOGICAS = [];"))
  const soloSalidas = renderizarPaginaPortal({ ...VACIA, salidas: [18] })
  assert.ok(soloSalidas.includes("<h2>Salidas</h2>") && !soloSalidas.includes('id="mas"') && !soloSalidas.includes("<h2>Entradas</h2>"))
  const soloExtra = renderizarPaginaPortal({ ...VACIA, salidasExtra: [18] })
  assert.ok(soloExtra.includes("<h2>Salidas</h2>") && soloExtra.includes('id="mas"'))
  const soloAnalogica = renderizarPaginaPortal({ ...VACIA, entradasAnalogicas: [34] })
  assert.ok(!soloAnalogica.includes("<h2>Salidas</h2>") && soloAnalogica.includes("<h2>Entradas</h2>") && soloAnalogica.includes('id="cada1s"') && !soloAnalogica.includes("pull-up interno"))
  // El JS de cada variante es sintácticamente válido (el armado tolera que falten los elementos).
  for (const html of [vacia, soloSalidas, soloExtra, soloAnalogica, renderizarPaginaPortal(PAGINA)]) {
    const js = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"))
    assert.doesNotThrow(() => new Function(js))
  }
})

test("entrada inválida: no es lista, no entero, negativo → lanza; no conoce ninguna placa ni valida contra la política (eso es del generador)", () => {
  for (const mala of [{ ...VACIA, salidas: "18" }, { ...VACIA, salidas: [1.5] }, { ...VACIA, entradasDigitales: [-1] }, { ...VACIA, salidasExtra: [null] }]) {
    assert.throws(() => renderizarPaginaPortal(mala), /lista de numeros/)
  }
  assert.doesNotThrow(() => renderizarPaginaPortal({ ...VACIA, salidas: [6, 1, 200] }), "pines prohibidos o inexistentes no son asunto de la página")
  // La FORMA sí es asunto de la página (C-02: un solo lugar): falta una lista, un pin repetido, un pin en dos listas.
  assert.throws(() => renderizarPaginaPortal({ salidas: [18] }), /pagina\.salidasExtra: tiene que ser una lista/)
  assert.throws(() => renderizarPaginaPortal(null), /objeto PaginaPortal/)
  assert.throws(() => renderizarPaginaPortal({ ...VACIA, entradasDigitales: [4, 4] }), /pagina\.entradasDigitales: repite GPIO4/)
  assert.throws(() => renderizarPaginaPortal({ ...VACIA, salidas: [18], salidasExtra: [18] }), /GPIO18 esta en dos listas a la vez \(salidas y salidasExtra\)/)
  assert.throws(() => renderizarPaginaPortal({ ...VACIA, salidas: [32], entradasAnalogicas: [32] }), /GPIO32 esta en dos listas a la vez/, "la tool nunca ofrece un pin en dos roles (V4-6c)")
  const fuente = readFileSync(join(REPO, "opencode/vivo/pagina-portal.ts"), "utf8")
  assert.doesNotMatch(fuente, /from\s+["']node:/, "sin node: (también corre en el navegador)")
  assert.doesNotMatch(fuente, /from\s+["'][^"']*(codegen|tool|agent|nucleo)\//, "no importa codegen ni el núcleo")
})

test("V4-6c salidasConAviso: sin el campo (o vacío) el HTML es byte a byte el de antes; con él, los strapping van al final de 'más pines' bajo el aviso; un pin en dos listas lanza", () => {
  const sinCampo = renderizarPaginaPortal(PAGINA)
  assert.equal(renderizarPaginaPortal({ ...PAGINA, salidasConAviso: [] }), sinCampo, "vacío = ausente")
  assert.equal(renderizarPaginaPortal({ ...PAGINA, salidasConAviso: undefined }), sinCampo)
  assert.ok(!sinCampo.includes("CON_AVISO") && !sinCampo.includes("aviso") && !sinCampo.includes("deciden c&oacute;mo arranca"), "sin el campo no hay rastro del aviso")
  const con = renderizarPaginaPortal({ ...PAGINA, salidasConAviso: [0, 12, 15] })
  assert.ok(/^[\x0a\x20-\x7e]*$/.test(con) && !/'|\/\/|\\/.test(con), "sigue ASCII y apta para el traductor")
  assert.ok(con.includes("var CON_AVISO = [0, 12, 15];") && con.includes("var OTRAS = [5, 23];"))
  assert.ok(con.includes(`aviso.innerHTML = "${AVISO_STRAPPING}";`) && AVISO_STRAPPING.includes("Usalos s&oacute;lo si sab&eacute;s por qu&eacute;."), "el aviso, con sus tildes como entidades")
  // Orden dentro de "más pines": primero las filas de OTRAS, después el aviso, después las CON_AVISO; mismos botones.
  const js = con.slice(con.indexOf("<script>"), con.indexOf("</script>"))
  const posOtras = js.indexOf('porId("otras").appendChild(filaDeSalida(OTRAS[i]))')
  const posAviso = js.indexOf('porId("otras").appendChild(aviso)')
  const posConAviso = js.indexOf('porId("otras").appendChild(filaDeSalida(CON_AVISO[i]))')
  assert.ok(posOtras > 0 && posOtras < posAviso && posAviso < posConAviso, "otras < aviso < con aviso")
  assert.ok(con.includes(".aviso{") && con.includes('id="mas"'), "el botón de más pines y el estilo del aviso")
  assert.doesNotThrow(() => new Function(js.slice("<script>".length)))
  // Sólo strapping con aviso y sin extra: el botón "más pines" igual aparece (hay algo que esconder).
  const soloAviso = renderizarPaginaPortal({ ...VACIA, salidasConAviso: [2] })
  assert.ok(soloAviso.includes('id="mas"') && soloAviso.includes("var OTRAS = [];") && soloAviso.includes("var CON_AVISO = [2];"))
  // Un pin que ya está en otra lista: lanza (como lo no ASCII).
  assert.throws(() => renderizarPaginaPortal({ ...PAGINA, salidasConAviso: [2] }), /GPIO2 esta en dos listas a la vez \(salidas y salidasConAviso\)/)
  assert.throws(() => renderizarPaginaPortal({ ...PAGINA, salidasConAviso: [5] }), /GPIO5 esta en dos listas a la vez \(salidasExtra y salidasConAviso\)/)
  assert.throws(() => renderizarPaginaPortal({ ...PAGINA, salidasConAviso: [0, 0] }), /salidasConAviso: repite GPIO0/)
  assert.throws(() => renderizarPaginaPortal({ ...PAGINA, salidasConAviso: "0" }), /salidasConAviso: tiene que ser una lista/)
})
