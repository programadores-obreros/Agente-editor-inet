// La pieza `pb-sensor-shield` es el Arduino con Sensor Shield v5.0 VISTO DESDE
// ARRIBA, que es como lo tiene el docente sobre la mesa.
//
// El dato que esta pieza existe para no equivocar: el orden de la terna es
// G-V-S y LA SEÑAL VA ABAJO. La sigla engaña —todos dicen "SVG"— y si el dibujo
// la pone al revés, el pibe mete la señal del servo en la masa. No da error de
// compilación: compila, cablea, y recién ahí se rompe algo.
//
// Los nombres NO están copiados acá: salen de `opencode/skills/placas/SKILL.md`,
// entrada 02, que a su vez sale del diagrama del fabricante. Si mañana el skill
// cambia, estos tests se enteran solos. Una lista copiada a mano en el test
// prueba que el test y la pieza dicen lo mismo, no que digan la verdad.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import vm from "node:vm"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_PIEZAS = "opencode/tecniabot-web/componentes-extra.js"
const ARCHIVO = join(REPO, RUTA_PIEZAS)
const SKILL = join(REPO, "opencode/skills/placas/SKILL.md")
const TAG = "pb-sensor-shield"

/* ── Cargar las piezas sin navegador ────────────────────────────────────────
   Mismo truco que tests/pininfo-piezas.test.mjs: un `customElements` postizo y
   el módulo real corriendo en un vm. `pinInfo` son datos, no medición.
   ────────────────────────────────────────────────────────────────────────── */
function cargarPiezas(fuente, etiqueta) {
  const registro = new Map()
  const contexto = {
    customElements: {
      get: (nombre) => registro.get(nombre),
      define: (nombre, clase) => registro.set(nombre, clase),
    },
    HTMLElement: class {},
  }
  vm.createContext(contexto)
  vm.runInContext(fuente, contexto, { filename: etiqueta })
  assert.ok(registro.size > 0, `${etiqueta}: no registró ninguna pieza`)
  return registro
}

function dibujar(Pieza) {
  const el = new Pieza()
  el.style = {}
  el.hasAttribute = () => false
  el.connectedCallback()
  return el
}

const PIEZAS = cargarPiezas(readFileSync(ARCHIVO, "utf8"), ARCHIVO)
const SHIELD = dibujar(PIEZAS.get(TAG) ?? assert.fail(`no existe la pieza <${TAG}>`))
const SVG = SHIELD.innerHTML
const PINES = SHIELD.pinInfo
const PIN = new Map(PINES.map((p) => [p.name, p]))

/* ── Lo que dice el skill, leído del skill ──────────────────────────────── */
const TEXTO_SKILL = readFileSync(SKILL, "utf8")
const SECCION =
  TEXTO_SKILL.split(/^## /m).find((s) => /^0?2 · Arduino UNO \+ Sensor Shield/.test(s)) ??
  assert.fail("el skill placas ya no tiene la entrada 02 del Sensor Shield")

/** Las 16 ternas digitales, en el orden impreso de izquierda a derecha. */
const DIGITALES = (() => {
  const linea = SECCION.split("\n").find((l) => /^\s*AREF[\s\dGND·]+$/.test(l) && /\bGND\b/.test(l))
  assert.ok(linea, "no encontré en el skill la fila 'AREF GND 13 12 · … · 3 2 1 0'")
  return linea.trim().split(/[\s·]+/).filter(Boolean)
})()

/** Las 6 ternas analógicas. */
const ANALOGICAS = (() => {
  const m = SECCION.match(/Las analógicas son iguales:[^\n]*sobre `([^`]+)`/)
  assert.ok(m, "no encontré en el skill la línea de las ternas analógicas")
  return m[1].trim().split(/[\s·]+/).filter(Boolean)
})()

/**
 * El orden de las filas, de ARRIBA hacia ABAJO, tal como lo dibuja el skill:
 *   G  │ ● │  ← GND    · fila de ARRIBA
 *   V  │ ● │  ← VCC    · fila del medio
 *   S  │ ● │  ← Señal  · fila de ABAJO
 * Sale del skill a propósito: si alguien algún día "corrige" la sigla a S-V-G,
 * este test cambia con él y la pieza tiene que cambiar también.
 */
const FILAS = (() => {
  const filas = SECCION.split("\n")
    .map((l) => l.match(/^\s*([GVS])\s.*←\s*(GND|VCC|Señal)/))
    .filter(Boolean)
    .map((m) => ({ letra: m[1], es: m[2] }))
  assert.equal(filas.length, 3, "el skill ya no dibuja las tres filas de la terna")
  return filas
})()

/** Los pines analógicos que el skill le asigna al zócalo del ultrasónico. */
const URF_ANALOGICOS = (() => {
  const linea = SECCION.split("\n").find((l) => /URF01/.test(l) && /\|/.test(l))
  assert.ok(linea, "el skill ya no tiene la fila del zócalo URF01")
  return [...linea.matchAll(/\bA(\d)\b/g)].map((m) => `A${m[1]}`)
})()

/* ── Ayudas para mirar el SVG que dibuja la pieza ───────────────────────── */
const atrib = (etiqueta, n) => {
  const m = etiqueta.match(new RegExp(`\\s${n}="([-\\d.]+)"`))
  return m ? Number(m[1]) : null
}
/** Todos los <circle> dibujados, en coordenadas del viewBox. */
const CIRCULOS = (SVG.match(/<circle[^>]*>/g) || []).map((c) => ({
  x: atrib(c, "cx"),
  y: atrib(c, "cy"),
}))
/** Todos los <text>, con su x y su contenido. */
const TEXTOS = (SVG.match(/<text[^>]*>[\s\S]*?<\/text>/g) || []).map((t) => ({
  x: atrib(t, "x"),
  texto: t.replace(/<[^>]*>/g, "").trim(),
}))
const TAMANO = (() => {
  const n = (k) => Number(SVG.match(new RegExp(`<svg[^>]*\\s${k}="([^"]+)"`))[1])
  return { w: n("width"), h: n("height") }
})()

/** Los tres pines de una terna: el de señal y sus sufijos .V y .G. */
const terna = (nombre) => ({
  G: PIN.get(`${nombre}.G`),
  V: PIN.get(`${nombre}.V`),
  S: PIN.get(nombre),
})

// ═══════════════════════════════════════════════════════════════════════════

test("1 · están las 16 ternas digitales y las 6 analógicas, con los nombres del diagrama", () => {
  // Qué vería la docente si esto se rompe: proyecta el shield, busca la terna
  // que le nombró el bot —"el 9"— y en el dibujo esa terna no está, o está con
  // otro nombre. El pibe cuenta columnas y pincha la de al lado.
  assert.equal(DIGITALES.length, 16, `el skill lista ${DIGITALES.length} ternas digitales, no 16`)
  assert.equal(ANALOGICAS.length, 6, `el skill lista ${ANALOGICAS.length} ternas analógicas, no 6`)

  for (const nombre of [...DIGITALES, ...ANALOGICAS]) {
    const t = terna(nombre)
    assert.ok(t.S, `falta la terna ${nombre}: el skill la nombra y la pieza no la dibuja`)
    assert.ok(t.V, `la terna ${nombre} no expone su fila de tensión (${nombre}.V)`)
    assert.ok(t.G, `la terna ${nombre} no expone su fila de masa (${nombre}.G)`)
  }

  // Y al revés: ninguna terna de más. Una terna inventada es un agujero que en
  // la placa de la escuela no existe.
  const declaradas = new Set([...DIGITALES, ...ANALOGICAS])
  for (const p of PINES) {
    if (/^URF01\./.test(p.name)) continue
    const base = p.name.replace(/\.(V|G)$/, "")
    assert.ok(declaradas.has(base), `la pieza dibuja la terna ${base}, que el skill no nombra`)
  }
})

test("2 · el orden es G-V-S y la SEÑAL VA ABAJO — la regresión que más duele", () => {
  // Qué vería la docente si esto se rompe: NADA. El dibujo sale igual de
  // prolijo. Lo ve el pibe media hora después, cuando el servo no se mueve
  // porque metió la señal en la masa, o cuando algo se calienta.
  // Por eso está escrito explícito y en tres frentes: el orden que dice el
  // skill, el orden de las `y`, y que la `y` de la señal sea la MÁS GRANDE
  // (en SVG, más grande = más abajo).
  assert.deepEqual(
    FILAS.map((f) => f.letra),
    ["G", "V", "S"],
    "el skill ya no dibuja las filas en el orden G-V-S",
  )
  assert.equal(FILAS[2].es, "Señal", "según el skill, la fila de ABAJO ya no es la de señal")

  for (const nombre of [...DIGITALES, ...ANALOGICAS]) {
    const t = terna(nombre)
    assert.ok(
      t.G.y < t.V.y,
      `terna ${nombre}: la masa (G, y=${t.G.y}) tendría que estar ARRIBA de la tensión (V, y=${t.V.y})`,
    )
    assert.ok(
      t.V.y < t.S.y,
      `terna ${nombre}: la SEÑAL (S, y=${t.S.y}) tendría que estar ABAJO de la tensión (V, y=${t.V.y}).\n` +
        `Así dibujada, el cable de señal nace en la fila de la tensión: el pibe pincha ahí.`,
    )
    assert.equal(
      t.S.y,
      Math.max(t.G.y, t.V.y, t.S.y),
      `terna ${nombre}: la señal no es la fila más baja de la terna`,
    )
    // Las tres filas son la MISMA columna: si una se corre, el cable nace al
    // lado del agujero.
    assert.ok(
      t.G.x === t.V.x && t.V.x === t.S.x,
      `terna ${nombre}: las tres filas no comparten la columna (${t.G.x} / ${t.V.x} / ${t.S.x})`,
    )
    // Paso uniforme: el header es de 0,1". Una fila fuera de paso significa que
    // alguien movió una sola de las tres.
    assert.equal(
      Number((t.V.y - t.G.y).toFixed(4)),
      Number((t.S.y - t.V.y).toFixed(4)),
      `terna ${nombre}: las tres filas no están al mismo paso`,
    )
  }

  // Y todas las ternas del mismo banco comparten las mismas tres alturas: una
  // sola terna dibujada al revés se vería derecha si sólo mirásemos de a una.
  for (const banco of [DIGITALES, ANALOGICAS]) {
    const alturas = banco.map((n) => [terna(n).G.y, terna(n).V.y, terna(n).S.y].join("/"))
    assert.equal(new Set(alturas).size, 1, `hay ternas con distinta altura de fila: ${[...new Set(alturas)].join(" vs ")}`)
  }
})

test("3 · cada pin cae en un agujero DIBUJADO, no al lado", () => {
  // Qué vería la docente si esto se rompe: un cable que nace seis píxeles al
  // costado del agujero. El dibujo queda lindo y le enseña al pibe a pinchar
  // donde no va. Ya pasó en este repo: un test de esto mismo pasaba con la
  // coordenada corrida, porque seguía cayendo sobre una figura grande.
  // Acá no alcanza con caer "encima de algo": tiene que ser el CENTRO EXACTO
  // de un <circle> del SVG.
  for (const p of PINES) {
    const hay = CIRCULOS.some((c) => c.x === p.x && c.y === p.y)
    assert.ok(hay, `el pin ${p.name} cae en (${p.x}, ${p.y}) y ahí no hay ningún agujero dibujado`)
  }
})

test("3b · nombres únicos, coordenadas finitas y dentro del dibujo", () => {
  // Qué vería la docente: con dos pines del mismo nombre, los dos cables salen
  // del mismo agujero y en la protoboard el pibe conecta cualquier cosa. Con
  // una coordenada NaN no sale el cable y nadie avisa: la hoja queda con una
  // conexión menos, en silencio.
  const nombres = PINES.map((p) => p.name)
  const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i)
  assert.deepEqual(Array.from(repetidos), [], `pines repetidos: ${repetidos.join(", ")}`)

  for (const p of PINES) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.name}: coordenada no finita (${p.x}, ${p.y})`)
    assert.ok(
      p.x >= 0 && p.x <= TAMANO.w && p.y >= 0 && p.y <= TAMANO.h,
      `${p.name} cae en (${p.x}, ${p.y}), fuera del SVG de ${TAMANO.w}x${TAMANO.h}`,
    )
  }
})

test("4 · los pines de señal usan la convención del UNO: número pelado, no D3", () => {
  // Qué vería la docente: nada raro en el dibujo — y el cable sin enganchar.
  // El UNO en Wokwi llama a sus digitales con el número pelado ("3", "13"); un
  // pin llamado "D3" simplemente no existe y el cable se queda sin anclar.
  // Está escrito así en circuito.ts (pinWokwi del UNO) y en
  // docs/wokwi-pinout-dump.md.
  for (const nombre of DIGITALES) {
    assert.ok(PIN.has(nombre), `falta el pin de señal ${nombre}`)
  }
  for (const p of PINES) {
    assert.ok(
      !/^D\d+(\.|$)/.test(p.name),
      `el pin ${p.name} usa la convención del ESP32 ("D<n>"). En el UNO el digital es el número pelado.`,
    )
  }
  // Los analógicos SÍ llevan la A: ahí las dos convenciones coinciden.
  for (const nombre of ANALOGICAS) {
    assert.match(nombre, /^A\d$/, `el skill nombra la terna analógica ${nombre} y no tiene forma de A<n>`)
    assert.ok(PIN.has(nombre), `falta el pin de señal ${nombre}`)
  }

  // El número impreso abajo de la terna tiene que ser el de ESE pin: es lo que
  // el pibe lee para contar columnas. Si el rótulo y el pin se despegan, el
  // dibujo miente sin que se note.
  for (const nombre of [...DIGITALES, ...ANALOGICAS]) {
    const p = PIN.get(nombre)
    const rotulo = TEXTOS.find((t) => t.texto === nombre && t.x === p.x)
    assert.ok(
      rotulo,
      `la terna ${nombre} está en x=${p.x} pero no hay ningún rótulo "${nombre}" en esa columna`,
    )
  }
})

test("5 · el zócalo del ultrasónico existe y tiene sus cuatro pines", () => {
  // Qué vería la docente si falta: el bot le dice "el ultrasónico va a D4 y D5"
  // y la hace cablear a mano una placa que YA le resolvía el problema — el
  // HC-SR04 entra derecho en el URF01. Es justo lo que esta pieza aporta.
  assert.match(SVG, /URF01/, "el dibujo no rotula el zócalo URF01")

  const contactos = PINES.filter((p) => p.name.startsWith("URF01."))
  assert.equal(contactos.length, 4, `el URF01 es un conector de cuatro y tiene ${contactos.length} pines`)

  // Los dos analógicos salen del skill ("URF01 — ultrasónico | A0 y A1").
  assert.deepEqual(Array.from(URF_ANALOGICOS), ["A0", "A1"], "el skill ya no dice que el URF01 va a A0 y A1")
  for (const a of URF_ANALOGICOS) {
    assert.ok(PIN.has(`URF01.${a}`), `el zócalo URF01 no expone su contacto ${a}`)
  }
  // Y su alimentación, que es la mitad de por qué el módulo entra derecho.
  const tiene = (signal) =>
    contactos.some((p) => p.signals.some((s) => s.type === "power" && s.signal === signal))
  assert.ok(tiene("VCC"), "el zócalo URF01 no declara tensión")
  assert.ok(tiene("GND"), "el zócalo URF01 no declara masa")
})

test("6 · las otras piezas del archivo quedaron intactas", () => {
  // Qué vería la docente si esto se rompe: cualquier otro circuito, de cualquier otra
  // clase, sale distinto sin que nadie lo haya pedido.
  //
  // POR QUÉ HUELLAS Y NO GIT. Este test comparó contra `HEAD` y contra la merge-base con
  // `origin/main`, y las dos referencias fallaron por motivos distintos:
  //
  //  · contra `HEAD`: en cuanto la pieza nueva se commitea, `HEAD` ya la tiene y la
  //    comparación deja de probar nada. El test lo detectaba SOLO y se ponía rojo —
  //    correcto, pero lo volvía imposible de mantener después del commit.
  //  · contra `merge-base` con `origin/main`: el checkout del CI es SHALLOW y no tiene
  //    `origin/main`. Verde acá, `fatal: Not a valid object name origin/main` allá.
  //
  // O sea: un test que depende del estado de git es frágil por diseño, y su fragilidad
  // aparece en el peor momento. La huella no depende de nada externo: corre igual en un
  // clon completo, en un checkout shallow y en la máquina de cualquiera.
  //
  // CÓMO SE ACTUALIZA, si algún día una pieza cambia A PROPÓSITO: se recalcula la huella
  // (mismo hash que arma este test) y se cambia acá. Eso es una FEATURE: obliga a que el
  // cambio sea deliberado y quede en el diff, para que un reviewer lo vea. Si una huella
  // cambia sin que nadie lo pidiera, eso es exactamente el bug que este test caza.
  const HUELLAS = {
    "pb-bmp180": "46925b1e34baa6b9",
    "pb-bomba": "43a3e7eacd953d00",
    "pb-brazo": "0f278569e52dcab4",
    "pb-calefactor": "a5f0e032a308e8da",
    "pb-driver": "f9589fafba3a7bd7",
    "pb-dron": "c524526c223f3b78",
    "pb-higrometro": "84eca6e4b97c00e4",
    "pb-lampara": "6fbc4de7f9c122b1",
    "pb-lluvia": "11da775e9c31775f",
    "pb-motor": "2ed199d12dac2c19",
    "pb-protoboard": "6d54c7e517c74304",
    "pb-relay": "4a8ed5d48b035adb",
    "pb-robot": "d8a2f9efd37d5b18",
    "pb-valvula": "b8eb53a3f1927a39",
  }

  const SEP = String.fromCharCode(0)
  const huellaDe = (nombre) => {
    const P = PIEZAS.get(nombre)
    const el = dibujar(P)
    return createHash("sha256")
      .update(el.innerHTML)
      .update(SEP)
      .update(JSON.stringify(Array.from(el.pinInfo ?? [])))
      .update(SEP)
      .update(String(P.sinPinesDibujados ?? ""))
      .digest("hex")
      .slice(0, 16)
  }

  // La huella cubre el DIBUJO, los PINES y el motivo declarado: si cambia cualquiera de
  // los tres, salta. Se compara de a una para que el mensaje diga CUÁL pieza cambió.
  for (const [nombre, esperada] of Object.entries(HUELLAS)) {
    assert.ok(PIEZAS.has(nombre), `desapareció la pieza <${nombre}>`)
    assert.equal(
      huellaDe(nombre),
      esperada,
      `cambió <${nombre}> (dibujo, pines o motivo). Si fue a propósito, recalculá la huella y dejala en el diff; si no, es el bug que este test caza.`,
    )
  }

  // Y ninguna pieza de más ni de menos: la única que se suma en esta tanda es el shield.
  const esperadas = new Set([...Object.keys(HUELLAS), TAG])
  const sobran = [...PIEZAS.keys()].filter((n) => !esperadas.has(n))
  assert.deepEqual(sobran, [], `aparecieron piezas sin huella: ${sobran.join(", ")}`)
})
