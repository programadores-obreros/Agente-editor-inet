// `opencode/carga/esptool.ts`: qué dice la salida de la herramienta de carga y qué se
// puede afirmar con eso (CONTRATOS-API §7, ADR-001 §10.5 «D5», decisión ND-3).
//
// LOS FIXTURES, Y QUÉ ES CADA UNO (no se mezclan):
//   - REAL: `tests/fixtures/carga/esptool-carga-real-4-regiones.log` es la salida de una
//     carga física a una ESP32 (`hardware-e2e-1b/raw/fase4/upload.log`, esptool 4.9.0),
//     byte a byte salvo UNA línea: la MAC de la placa se reemplazó por `02:00:00:00:00:01`
//     para no publicar el identificador de un equipo. La última línea (`rc=0`) la agregó
//     quien capturó el log, no esptool.
//   - DERIVADOS DEL REAL: el mismo log con líneas quitadas o cambiadas, para los casos
//     que no se pueden provocar sin romper una placa. Cada uno dice qué se le tocó.
//   - SINTÉTICOS: todo lo de avrdude (no hay NINGUNA salida real de una carga a una UNO) y
//     los mensajes de error de esptool, armados con las cadenas de formato del código
//     instalado. Un fixture sintético no es evidencia física.
//   - NO HAY salida real de una carga con `-t nobuild` (una sola región): el caso de una
//     región está derivado del real.
//
// LO QUE SE FIJA: nada da `ok: true` por un rc 0; una región sin su hash no está
// verificada; lo que se grabó tiene que ser lo que se autorizó; y con una UNO el
// resultado es SIEMPRE `CARGA_SIN_VERIFICAR`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const e = await import(join(REPO, "opencode/carga/esptool.ts"))

const REAL = readFileSync(join(REPO, "tests/fixtures/carga/esptool-carga-real-4-regiones.log"), "utf8")
const CUATRO = [
  { offset: 0x1000, bytes: 17536 },
  { offset: 0x8000, bytes: 3072 },
  { offset: 0xe000, bytes: 8192 },
  { offset: 0x10000, bytes: 240816 },
]

/** DERIVADO DEL REAL: saca la N-ésima línea `Hash of data verified.` (desde 0). */
function sinElHash(n) {
  let i = -1
  return REAL.split("\n").filter((l) => !(l === "Hash of data verified." && ++i === n)).join("\n")
}

/** DERIVADO DEL REAL: sólo la región de la aplicación (lo que deja una carga con `nobuild`, según R-01). */
const UNA_REGION = REAL.split("\n").filter((l) => !/0x0000(1000|8000|e000)|^Compressed (17536|3072|8192) /.test(l)).filter((l, i, t) => !(l === "Hash of data verified." && !/^Wrote 240816 /.test(t[i - 1]))).join("\n")

// ── leerSalidaEsptool ────────────────────────────────────────────────────────────────────

test("REAL: la carga física de la fase 4 — cuatro regiones, las cuatro con hash, chip, MAC, puerto y reset", () => {
  const r = e.leerSalidaEsptool(REAL, "")
  assert.deepEqual(r.regiones, CUATRO.map((x) => ({ ...x, hashVerificado: true })))
  assert.equal(r.exito, true)
  assert.equal(r.chip, "ESP32-D0WDQ6 (revision v1.0)")
  assert.equal(r.mac, "02:00:00:00:00:01")
  assert.equal(r.puertoUsado, "/dev/ttyACM0")
  assert.equal(r.resetFinal, true)
  assert.equal(r.marcaSuccess, true)
  assert.equal(r.sintoma, null)
  assert.equal(r.ultimoOffset, 0x4a309)
  // Da igual si llega por stdout o por stderr, y con `\r` de progreso en vez de `\n`.
  assert.deepEqual(e.leerSalidaEsptool("", REAL).regiones, r.regiones)
  assert.deepEqual(e.leerSalidaEsptool(REAL.replace(/\n/g, "\r"), "").regiones, r.regiones)
  assert.deepEqual(e.leerSalidaEsptool(REAL.replace(/\n/g, "\r\n"), "").regiones, r.regiones)
})

for (let n = 0; n < 4; n++) {
  test(`DERIVADO: sin el hash de la región ${n}, ESA región queda sin verificar (el hash de la siguiente no se le atribuye) y no hay éxito`, () => {
    const r = e.leerSalidaEsptool(sinElHash(n), "")
    assert.deepEqual(r.regiones.map((x) => x.hashVerificado), [0, 1, 2, 3].map((i) => i !== n))
    assert.equal(r.exito, false)
    assert.equal(r.marcaSuccess, true, "la marca [SUCCESS] de PlatformIO sigue estando: por eso no cuenta")
  })
}

test("un `Hash of data verified.` sin región antes, o dos seguidos, no verifica nada de más", () => {
  const r = e.leerSalidaEsptool("Hash of data verified.\nWrote 100 bytes (50 compressed) at 0x00010000 in 0.1 seconds...\n", "")
  assert.deepEqual(r.regiones, [{ offset: 0x10000, bytes: 100, hashVerificado: false }])
  const dos = e.leerSalidaEsptool("Wrote 100 bytes at 0x00010000 in 0.1 seconds...\nHash of data verified.\nHash of data verified.\nWrote 8 bytes at 0x00020000 in 0.1 seconds...\n", "")
  assert.deepEqual(dos.regiones.map((x) => x.hashVerificado), [true, false])
  assert.equal(dos.exito, false)
})

test("la línea del hash tiene que ser ESA línea: un texto parecido no cuenta", () => {
  for (const falso of ["Hash of data verified", "hash of data verified.", "Hash of data verified. (no)", "No Hash of data verified.", "Hash of data NOT verified."]) {
    const r = e.leerSalidaEsptool(`Wrote 100 bytes at 0x00010000 in 0.1 seconds...\n${falso}\n`, "")
    assert.equal(r.regiones[0].hashVerificado, false, `tomó por hash: ${falso}`)
    assert.equal(r.exito, false)
  }
})

test("sin regiones no hay éxito, aunque la salida termine con [SUCCESS]", () => {
  for (const salida of ["", "========================= [SUCCESS] Took 1.00 seconds =========================\n", "Hash of data verified.\nLeaving...\nHard resetting via RTS pin...\n"]) {
    const r = e.leerSalidaEsptool(salida, "")
    assert.deepEqual(r.regiones, [])
    assert.equal(r.exito, false)
  }
})

test("DERIVADO: la carga se cortó a mitad de la última región — queda dicho hasta dónde llegó, y no hay éxito", () => {
  const corte = REAL.slice(0, REAL.indexOf("Writing at 0x00037443"))
  const r = e.leerSalidaEsptool(corte, "")
  assert.equal(r.regiones.length, 3)
  assert.equal(r.ultimoOffset, 0x2edcc)
  assert.equal(r.resetFinal, false)
  assert.equal(e.veredictoDeCarga({ herramienta: "esptool", code: 124, stdout: corte, stderr: "", imagenes: CUATRO }).codigo, "ESTADO_DESCONOCIDO")
})

const SINTOMAS = [
  ["A fatal error occurred: Failed to connect to ESP32: No serial data received.", "PLACA_NO_RESPONDE"],
  ["A fatal error occurred: Could not open /dev/ttyUSB0, the port is busy or doesn't exist.", "PUERTO_NO_DISPONIBLE"],
  ["A serial exception error occurred: device reports readiness to read but returned no data", "DESCONEXION_DURANTE_CARGA"],
  ["A fatal error occurred: The chip stopped responding.", "DESCONEXION_DURANTE_CARGA"],
  ["A fatal error occurred: MD5 of file does not match data in flash!", "CABLE_O_ALIMENTACION"],
  ["A fatal error occurred: Invalid head of packet (0x1B): Possible serial noise or corruption.", "CABLE_O_ALIMENTACION"],
]

for (const [linea, sintoma] of SINTOMAS) {
  test(`SINTÉTICO (cadenas del esptool instalado): «${linea.slice(0, 60)}…» → ${sintoma}, y nunca éxito`, () => {
    const r = e.leerSalidaEsptool("", linea)
    assert.equal(r.sintoma, sintoma)
    assert.equal(r.exito, false)
    // Aunque ANTES del error haya regiones verificadas: un error fatal gana.
    const mezclado = e.leerSalidaEsptool(`${REAL}\n${linea}\n`, "")
    assert.equal(mezclado.regiones.every((x) => x.hashVerificado), true)
    assert.equal(mezclado.exito, false)
  })
}

// ── veredictoDeCarga con esptool ─────────────────────────────────────────────────────────

const conEsptool = (extra) => e.veredictoDeCarga({ herramienta: "esptool", code: 0, stdout: REAL, stderr: "", imagenes: CUATRO, ...extra })

test("REAL: rc 0 + las cuatro regiones autorizadas + los cuatro hashes = ok, con las tres condiciones nombradas", () => {
  const v = conEsptool({})
  assert.equal(v.ok, true)
  assert.equal(v.codigo, undefined)
  assert.deepEqual(v.verificacion, { platformio: "ok", escritura: "reportada", dispositivo: "hash_en_chip" })
  assert.equal(v.texto, "CARGADO — PlatformIO terminó bien, esptool escribió 4 regiones, la placa verificó el hash")
})

test("DERIVADO: una sola región (carga con nobuild) autorizada y verificada = ok, y el texto dice 1 región", () => {
  const v = e.veredictoDeCarga({ herramienta: "esptool", code: 0, stdout: UNA_REGION, stderr: "", imagenes: [CUATRO[3]] })
  assert.deepEqual(e.leerSalidaEsptool(UNA_REGION, "").regiones, [{ ...CUATRO[3], hashVerificado: true }])
  assert.equal(v.ok, true)
  assert.match(v.texto, /esptool escribió 1 región,/)
})

test("NADA es ok por rc 0: rc 0 sin salida, con salida vacía de regiones o sólo con [SUCCESS] → CARGA_SIN_VERIFICAR con el texto de ND-3", () => {
  for (const stdout of ["", "Leaving...\nHard resetting via RTS pin...\n", "========================= [SUCCESS] Took 6.25 seconds =========================\n"]) {
    const v = conEsptool({ stdout })
    assert.equal(v.ok, false)
    assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
    assert.equal(v.verificacion.platformio, "ok")
    assert.equal(v.verificacion.escritura, "no_reportada")
    assert.equal(v.verificacion.dispositivo, "sin_verificar")
    assert.equal(v.texto, "PlatformIO terminó correctamente, pero no pude verificar la escritura del firmware en la placa")
  }
})

for (let n = 0; n < 4; n++) {
  test(`DERIVADO: rc 0 con la región ${n} sin hash → CARGA_SIN_VERIFICAR (N-51): escritura reportada, dispositivo sin verificar`, () => {
    const v = conEsptool({ stdout: sinElHash(n) })
    assert.equal(v.ok, false)
    assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
    assert.deepEqual(v.verificacion, { platformio: "ok", escritura: "reportada", dispositivo: "sin_verificar" })
  })
}

test("lo que se grabó tiene que ser lo que se autorizó: una región de más, de menos, en otro lugar o de otro tamaño no es ok", () => {
  const casos = {
    "se autorizó una y se grabaron cuatro": [CUATRO[3]],
    "se autorizaron cuatro y la lista trae tres": CUATRO.slice(0, 3),
    "otro offset": [...CUATRO.slice(0, 3), { offset: 0x20000, bytes: 240816 }],
    "otro tamaño": [...CUATRO.slice(0, 3), { offset: 0x10000, bytes: 240000 }],
    "un byte de más": [...CUATRO.slice(0, 3), { offset: 0x10000, bytes: 240817 }],
    "ninguna imagen declarada": [],
    "tamaño cero": [...CUATRO.slice(0, 3), { offset: 0x10000, bytes: 0 }],
  }
  for (const [nombre, imagenes] of Object.entries(casos)) {
    const v = conEsptool({ imagenes })
    assert.equal(v.ok, false, nombre)
    assert.equal(v.codigo, "CARGA_SIN_VERIFICAR", nombre)
    assert.equal(v.verificacion.escritura, "no_reportada", nombre)
    assert.equal(v.verificacion.dispositivo, "sin_verificar", `${nombre}: sin coincidencia, el hash no se cuenta como verificación de lo autorizado`)
  }
})

test("ninguna imagen declarada y ninguna región escrita NO es 'coinciden': escritura no reportada", () => {
  for (const stdout of ["", "Leaving...\n"]) {
    const v = conEsptool({ stdout, imagenes: [] })
    assert.equal(v.ok, false)
    assert.equal(v.verificacion.escritura, "no_reportada")
    assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
  }
})

test("esptool alinea la imagen a 4 bytes: un archivo de 240813 a 240816 bytes se reporta como 240816; uno de 240812, no", () => {
  for (const bytes of [240813, 240814, 240815, 240816]) assert.equal(conEsptool({ imagenes: [...CUATRO.slice(0, 3), { offset: 0x10000, bytes }] }).ok, true, String(bytes))
  assert.equal(conEsptool({ imagenes: [...CUATRO.slice(0, 3), { offset: 0x10000, bytes: 240812 }] }).ok, false)
})

test("el orden en que se declaran las imágenes no importa; el contenido de la lista sí", () => {
  assert.equal(conEsptool({ imagenes: [...CUATRO].reverse() }).ok, true)
})

test("rc ≠ 0 con una salida perfecta → CARGA_FALLIDA; 124 y 130 → ESTADO_DESCONOCIDO; ninguno es ok", () => {
  for (const [code, codigo, platformio] of [[1, "CARGA_FALLIDA", "fallo"], [2, "CARGA_FALLIDA", "fallo"], [127, "CARGA_FALLIDA", "fallo"], [-1, "CARGA_FALLIDA", "fallo"], [124, "ESTADO_DESCONOCIDO", "desconocido"], [130, "ESTADO_DESCONOCIDO", "desconocido"]]) {
    const v = conEsptool({ code })
    assert.equal(v.ok, false, `rc ${code}`)
    assert.equal(v.codigo, codigo, `rc ${code}`)
    assert.equal(v.verificacion.platformio, platformio)
    assert.notEqual(v.texto, e.TEXTO_CARGA_SIN_VERIFICAR, "el texto de 'PlatformIO terminó correctamente' no va cuando no terminó correctamente")
  }
  for (const code of [NaN, undefined, null, "0", true]) assert.equal(conEsptool({ code }).ok, false, `un rc que no es el número 0 no es éxito: ${String(code)}`)
})

test("rc 0 con un error fatal en la salida no es ok, aunque estén los cuatro hashes", () => {
  const v = conEsptool({ stderr: "A fatal error occurred: MD5 of file does not match data in flash!" })
  assert.equal(v.ok, false)
  assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
  assert.equal(v.detalle, "CABLE_O_ALIMENTACION")
})

test("una herramienta desconocida nunca es ok", () => {
  for (const herramienta of ["dfu-util", "", undefined, "ESPTOOL"]) {
    const v = e.veredictoDeCarga({ herramienta, code: 0, stdout: REAL, stderr: "", imagenes: CUATRO })
    assert.equal(v.ok, false, String(herramienta))
    assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
  }
})

// ── avrdude: TODO SINTÉTICO ──────────────────────────────────────────────────────────────

// SINTÉTICO — sin validación con hardware. Armado con las cadenas de formato de
// `tool-avrdude 1.60300.200527` (`%s: %d bytes of %s written`, `%s: %d bytes of %s
// verified`, `%s: verification error, first mismatch at byte 0x%04x`). No es la salida de
// ninguna carga real.
const AVRDUDE_SINTETICO_BIEN = [
  "avrdude: AVR device initialized and ready to accept instructions",
  "avrdude: Device signature = 0x1e950f (probably m328p)",
  "avrdude: reading input file \".pio/build/uno/firmware.hex\"",
  "avrdude: writing flash (924 bytes):",
  "avrdude: 924 bytes of flash written",
  "avrdude: verifying flash memory against .pio/build/uno/firmware.hex:",
  "avrdude: 924 bytes of flash verified",
  "avrdude done.  Thank you.",
  "",
].join("\n")

test("SINTÉTICO: leerSalidaAvrdude separa escrito de verificado", () => {
  assert.deepEqual(e.leerSalidaAvrdude("", AVRDUDE_SINTETICO_BIEN), { escrito: true, bytesEscritos: 924, verificado: true, bytesVerificados: 924, sintoma: null })
  const sinVerificar = AVRDUDE_SINTETICO_BIEN.replace("avrdude: 924 bytes of flash verified\n", "")
  assert.deepEqual(e.leerSalidaAvrdude("", sinVerificar), { escrito: true, bytesEscritos: 924, verificado: false, bytesVerificados: null, sintoma: null })
  // Verificó MENOS de lo que escribió: no es verificar lo escrito.
  assert.equal(e.leerSalidaAvrdude("", AVRDUDE_SINTETICO_BIEN.replace("924 bytes of flash verified", "900 bytes of flash verified")).verificado, false)
  // Un error de verificación gana aunque después aparezca un "verified".
  const conError = AVRDUDE_SINTETICO_BIEN.replace("avrdude: 924 bytes of flash verified", "avrdude: verification error, first mismatch at byte 0x0040\navrdude: 924 bytes of flash verified")
  const r = e.leerSalidaAvrdude("", conError)
  assert.equal(r.verificado, false)
  assert.equal(r.sintoma, "VERIFICACION_FALLIDA")
  assert.equal(e.leerSalidaAvrdude("", "avrdude: verification error; content mismatch").sintoma, "VERIFICACION_FALLIDA")
  // La EEPROM no es el firmware.
  assert.equal(e.leerSalidaAvrdude("", "avrdude: 10 bytes of eeprom written\navrdude: 10 bytes of eeprom verified").escrito, false)
  assert.equal(e.leerSalidaAvrdude("", "avrdude: stk500_getsync() attempt 1 of 10: not in sync: resp=0x00").sintoma, "PLACA_NO_RESPONDE")
  assert.equal(e.leerSalidaAvrdude("", "avrdude: ser_open(): can't open device \"/dev/ttyACM0\": Device or resource busy").sintoma, "PUERTO_NO_DISPONIBLE")
  assert.deepEqual(e.leerSalidaAvrdude("", ""), { escrito: false, bytesEscritos: null, verificado: false, bytesVerificados: null, sintoma: null })
})

test("ND-3: el punto de activación de avrdude está APAGADO", () => {
  assert.equal(e.VERIFICACION_AVRDUDE_HABILITADA, false)
})

test("ND-3: con una UNO el resultado es SIEMPRE CARGA_SIN_VERIFICAR, ok false y el texto exacto — con la mejor salida posible y rc 0", () => {
  const TEXTO = "PlatformIO terminó correctamente, pero no pude verificar la escritura del firmware en la placa"
  assert.equal(e.TEXTO_CARGA_SIN_VERIFICAR, TEXTO)
  const salidas = [AVRDUDE_SINTETICO_BIEN, "", "========================= [SUCCESS] Took 2.00 seconds =========================", REAL]
  for (const salida of salidas) {
    for (const imagenes of [[{ offset: 0, bytes: 924 }], [], CUATRO]) {
      const v = e.veredictoDeCarga({ herramienta: "avrdude", code: 0, stdout: salida, stderr: salida, imagenes })
      assert.equal(v.ok, false)
      assert.equal(v.codigo, "CARGA_SIN_VERIFICAR")
      assert.equal(v.texto, TEXTO)
      assert.equal(v.verificacion.platformio, "ok")
      assert.equal(v.verificacion.dispositivo, "sin_verificar", "con la verificación apagada, lo que diga avrdude no cuenta")
    }
  }
  // Y si PlatformIO no terminó bien, tampoco es ok: es falla o estado desconocido.
  assert.equal(e.veredictoDeCarga({ herramienta: "avrdude", code: 1, stdout: "", stderr: AVRDUDE_SINTETICO_BIEN, imagenes: [{ offset: 0, bytes: 924 }] }).codigo, "CARGA_FALLIDA")
  assert.equal(e.veredictoDeCarga({ herramienta: "avrdude", code: 124, stdout: "", stderr: AVRDUDE_SINTETICO_BIEN, imagenes: [{ offset: 0, bytes: 924 }] }).codigo, "ESTADO_DESCONOCIDO")
})

test("SINTÉTICO, trabajo preparatorio: lo que la salida de avrdude permitiría afirmar SI se habilitara (no decide nada hoy)", () => {
  const una = [{ offset: 0, bytes: 2600 }]
  const bien = e.leerSalidaAvrdude("", AVRDUDE_SINTETICO_BIEN)
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara(bien, una), { escritura: "reportada", dispositivo: "lectura_avrdude" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara({ ...bien, verificado: false }, una), { escritura: "reportada", dispositivo: "sin_verificar" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara({ ...bien, sintoma: "VERIFICACION_FALLIDA" }, una), { escritura: "reportada", dispositivo: "sin_verificar" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara({ ...bien, escrito: false }, una), { escritura: "no_reportada", dispositivo: "sin_verificar" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara({ ...bien, bytesEscritos: 0 }, una), { escritura: "no_reportada", dispositivo: "sin_verificar" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara(bien, []), { escritura: "no_reportada", dispositivo: "sin_verificar" })
  assert.deepEqual(e.verificacionAvrdudeSiSeHabilitara(bien, [...una, ...una]), { escritura: "no_reportada", dispositivo: "sin_verificar" })
})
