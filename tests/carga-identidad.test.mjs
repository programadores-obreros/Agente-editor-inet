// `opencode/carga/identidad.ts`: qué placa hay del otro lado del cable y cuál se elige
// (Slice 2, gate único de carga — CONTRATOS-API §2, ADR-001 §2.5, §9.6 y §9.7,
// A4-IDENTIDAD-DISPOSITIVO §3–§6).
//
// Sin hardware y sin `pio`: los hwid son los REALES que ya están capturados (la prueba
// de hardware E2E #1b, la VM de Windows y los fixtures de `tests/placas.test.mjs`);
// `run` es un doble. Los hwid de Windows del CH9102 y del CH340 sin serie por pyserial
// NO están capturados: los que aparecen acá con esa forma salen de leer el código de
// pyserial (A4 §1.1) y están marcados "INFERIDO".
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa):
// aceptar una IP en `puertoValido`; tratar `0001` como serie fuerte; devolver la primera
// placa cuando hay varias; comparar la placa esperada sin hashear; sacar la fila del
// CH9102 o ponerla después de la genérica.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
let id

before(async () => {
  id = await import(join(REPO, "opencode/carga/identidad.ts"))
})

// ── hwid reales ──────────────────────────────────────────────────────────────────────
// hardware-e2e-1b/raw/fase3/puertos.txt (Linux, placa real):
const CH9102 = { port: "/dev/ttyACM0", description: "USB Single Serial", hwid: "USB VID:PID=1A86:55D4 SER=5322003872 LOCATION=3-4.2:1.0" }
const PL2303 = { port: "/dev/ttyUSB0", description: "USB-Serial Controller", hwid: "USB VID:PID=067B:2303 LOCATION=3-4.1" }
const TTYS = [0, 1, 2].map((n) => ({ port: `/dev/ttyS${n}`, description: "n/a", hwid: "n/a" }))
// tests/placas.test.mjs y tests/pines-codigo.test.mjs:
const CH340 = { port: "/dev/ttyUSB1", description: "USB2.0-Serial", hwid: "USB VID:PID=1A86:7523 LOCATION=1-1" }
const CP2102_0001 = { port: "/dev/ttyUSB2", description: "CP2102 USB to UART Bridge Controller", hwid: "USB VID:PID=10C4:EA60 SER=0001 LOCATION=1-2" }
const CP2102_0444 = { port: "/dev/ttyUSB3", description: "CP2102 USB to UART Bridge Controller", hwid: "USB VID:PID=10C4:EA60 SER=0444" }
const UNO = { port: "/dev/ttyACM1", description: "Arduino Uno", hwid: "USB VID:PID=2341:0043 SER=85736323833351F0E1D1" }
// VM de Windows, real:
const COM1_VM = { port: "COM1", description: "Puerto de comunicaciones (COM1)", hwid: "ACPI\\PNP0501\\1" }
const BLUETOOTH = { port: "COM7", description: "Serie estándar sobre el vínculo Bluetooth", hwid: "BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}" }

const SAL = "0123456789abcdef0123456789abcdef"
const linux = (...crudo) => id.clasificarPuertos(crudo, "linux")
const hashDe = (modelo, serie, sal = SAL) => id.hashDePlacaFisica(sal, modelo, serie)

// ═════════════════════════════════════════════════════════════════════════════════════
// puertoValido
// ═════════════════════════════════════════════════════════════════════════════════════

test("puertoValido: los puertos serie reales de las tres plataformas valen", () => {
  for (const p of ["COM5", "com5", "COM12", "/dev/ttyACM0", "/dev/ttyUSB0", "/dev/cu.usbserial-14140", "/dev/tty.usbserial-14140", "/dev/cu.SLAB_USBtoUART"]) {
    assert.equal(id.puertoValido(p), true, `debería valer: ${p}`)
  }
})

test("puertoValido: una IP o un hostname NO son un puerto (con eso PlatformIO cambia solo a carga por red)", () => {
  for (const p of ["192.168.1.20", "192.168.4.1", "esp32.local", "mi-esp.local", "localhost", "10.0.0.5:3232", "http://192.168.1.20", "[::1]"]) {
    assert.equal(id.puertoValido(p), false, `no debería valer: ${p}`)
  }
})

test("puertoValido: ni vacío, ni opciones, ni inyección, ni rutas fuera de /dev", () => {
  for (const p of ["", " ", "COM", "COM3 ", "COM3;calc", "--upload-port x", "-t", "$(id)", "/dev/ttyUSB0; rm -rf /", "/dev/../etc/passwd", "/tmp/ttyUSB0", "ttyUSB0", "/dev/", "/dev/sda", "COM3\n"]) {
    assert.equal(id.puertoValido(p), false, `no debería valer: ${JSON.stringify(p)}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════════════
// serieEsGenerica
// ═════════════════════════════════════════════════════════════════════════════════════

test("serieEsGenerica: lo que NO distingue una placa de otra", () => {
  const genericas = [null, undefined, "", "   ", "0", "0000", "00000000", "1", "01", "0001", "00000001", "A1", "123", "5&1D2A3B4C&0&2", "ABCD&EF", "None", "null", "undefined", "n/a"]
  for (const s of genericas) assert.equal(id.serieEsGenerica(s), true, `debería ser genérica: ${JSON.stringify(s)}`)
})

test("serieEsGenerica: las series de verdad no son genéricas", () => {
  for (const s of ["5322003872", "85736323833351F0E1D1", "A50285BI", "0444", "0002", "0010", "1000", "F4:12:FA:40:5F:A0"]) {
    assert.equal(id.serieEsGenerica(s), false, `no debería ser genérica: ${s}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════════════
// identidadDePlaca: niveles
// ═════════════════════════════════════════════════════════════════════════════════════

test("identidadDePlaca: serie de verdad → fuerte", () => {
  assert.deepEqual(id.identidadDePlaca(CH9102.hwid), { modelo: "1A86:55D4", serie: "5322003872", nivel: "fuerte" })
  assert.deepEqual(id.identidadDePlaca(UNO.hwid), { modelo: "2341:0043", serie: "85736323833351F0E1D1", nivel: "fuerte" })
  // Forma de Windows que entrega WMI (tests/pines-codigo.test.mjs:1023).
  assert.deepEqual(id.identidadDePlaca("USB\\VID_2341&PID_0043\\85735313233351D0E1F1"), { modelo: "2341:0043", serie: "85735313233351D0E1F1", nivel: "fuerte" })
})

test("identidadDePlaca: `SER=0001` (el de fábrica de los CP2102 clonados) NO es identidad fuerte", () => {
  assert.deepEqual(id.identidadDePlaca(CP2102_0001.hwid), { modelo: "10C4:EA60", serie: null, nivel: "posicional" })
  assert.deepEqual(id.identidadDePlaca("USB VID:PID=10C4:EA60 SER=0000"), { modelo: "10C4:EA60", serie: null, nivel: "posicional" })
  // Una serie corta pero distinta de la de fábrica sí cuenta.
  assert.deepEqual(id.identidadDePlaca(CP2102_0444.hwid), { modelo: "10C4:EA60", serie: "0444", nivel: "fuerte" })
})

test("identidadDePlaca: sin serie, con serie vacía o con la que inventa Windows → posicional", () => {
  assert.deepEqual(id.identidadDePlaca(CH340.hwid), { modelo: "1A86:7523", serie: null, nivel: "posicional" })
  assert.deepEqual(id.identidadDePlaca(PL2303.hwid), { modelo: "067B:2303", serie: null, nivel: "posicional" })
  // INFERIDO del código de pyserial en Windows: `SER=` vacío cuando no hay serie.
  assert.deepEqual(id.identidadDePlaca("USB VID:PID=1A86:7523 SER= LOCATION=1-3"), { modelo: "1A86:7523", serie: null, nivel: "posicional" })
  assert.deepEqual(id.identidadDePlaca("USB VID:PID=1A86:7523 SER="), { modelo: "1A86:7523", serie: null, nivel: "posicional" })
  // Real (WMI): el último tramo lo arma Windows con la ubicación.
  assert.deepEqual(id.identidadDePlaca("USB\\VID_1A86&PID_7523\\5&1D2A3B4C&0&2"), { modelo: "1A86:7523", serie: null, nivel: "posicional" })
})

test("identidadDePlaca: sin VID:PID no hay identidad → ninguna", () => {
  const nada = { modelo: null, serie: null, nivel: "ninguna" }
  for (const hwid of [undefined, "", "n/a", COM1_VM.hwid, BLUETOOTH.hwid, "USB VID_1A86", "cualquier cosa"]) {
    assert.deepEqual(id.identidadDePlaca(hwid), nada, `hwid: ${JSON.stringify(hwid)}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════════════
// CH9102 y la tabla de chips
// ═════════════════════════════════════════════════════════════════════════════════════

test("CH9102 (1A86:55D4): se lo reconoce como CH9102 y se le da SU driver (CH343SER), no el del CH340", () => {
  const r = id.identificar(CH9102.hwid, CH9102.description)
  assert.equal(r.esPlaca, true)
  assert.match(r.chip, /CH9102/)
  assert.doesNotMatch(r.chip, /CH340/)
  assert.match(r.driverWindows, /CH343SER/)
  assert.doesNotMatch(r.driverWindows, /CH341SER/)
  // También en el formato de Windows.
  assert.match(id.identificar("USB\\VID_1A86&PID_55D4\\5322003872").chip, /CH9102/)
})

test("el CH340 (1A86:7523) sigue siendo CH340 con el driver CH341SER", () => {
  const r = id.identificar(CH340.hwid)
  assert.match(r.chip, /CH340/)
  assert.match(r.driverWindows, /CH341SER/)
})

test("CHIPS_USB: la fila del CH9102 está ANTES que la genérica de su mismo VID (identificar toma la primera)", () => {
  const iCh9102 = id.CHIPS_USB.findIndex((c) => c.vid === "1A86" && c.pid === "55D4")
  const iGenerica = id.CHIPS_USB.findIndex((c) => c.vid === "1A86" && !c.pid)
  assert.ok(iCh9102 >= 0, "falta la fila del CH9102")
  assert.ok(iGenerica >= 0, "falta la fila genérica de WCH")
  assert.ok(iCh9102 < iGenerica, "la fila del CH9102 quedó después de la genérica: nunca se usaría")
  // Regla general: ninguna fila con pid después de la genérica de su mismo vid.
  id.CHIPS_USB.forEach((c, i) => {
    if (!c.pid) return
    const generica = id.CHIPS_USB.findIndex((g) => g.vid === c.vid && !g.pid)
    assert.ok(generica === -1 || i < generica, `la fila ${c.vid}:${c.pid} está tapada por la genérica de ${c.vid}`)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════
// clasificarPuertos
// ═════════════════════════════════════════════════════════════════════════════════════

test("clasificarPuertos: el banco real (CH9102 + adaptador PL2303 + puertos de la máquina)", () => {
  const d = linux(...TTYS, CH9102, PL2303)
  assert.equal(d.crudo.length, 5)
  assert.deepEqual(d.otros, TTYS)
  assert.deepEqual(d.placas, [
    {
      puerto: "/dev/ttyACM0",
      vid: "1A86",
      pid: "55D4",
      serie: "5322003872",
      ubicacion: "3-4.2:1.0",
      chip: "CH9102 (WCH)",
      descripcion: "USB Single Serial",
      driverWindows: "https://www.wch-ic.com/downloads/CH343SER_EXE.html",
      identidad: "1A86:55D4#5322003872@/dev/ttyACM0",
      nivel: "fuerte",
    },
    {
      puerto: "/dev/ttyUSB0",
      vid: "067B",
      pid: "2303",
      serie: null,
      ubicacion: "3-4.1",
      chip: "USB 067B:2303",
      descripcion: "USB-Serial Controller",
      identidad: "067B:2303@/dev/ttyUSB0",
      nivel: "posicional",
    },
  ])
})

test("clasificarPuertos: `SER=0001` queda posicional y su identidad no lleva la serie", () => {
  const [p] = linux(CP2102_0001).placas
  assert.equal(p.nivel, "posicional")
  assert.equal(p.serie, null)
  assert.equal(p.identidad, "10C4:EA60@/dev/ttyUSB2")
})

test("clasificarPuertos: dos placas con la MISMA serie (clones) bajan las dos a posicional", () => {
  const gemela = { ...UNO, port: "/dev/ttyACM2" }
  const d = linux(UNO, gemela, CH9102)
  assert.deepEqual(d.placas.map((p) => [p.puerto, p.nivel, p.serie]), [
    ["/dev/ttyACM1", "posicional", null],
    ["/dev/ttyACM2", "posicional", null],
    ["/dev/ttyACM0", "fuerte", "5322003872"],
  ])
  assert.equal(d.placas[0].identidad, "2341:0043@/dev/ttyACM1")
})

test("clasificarPuertos: el COM1 de una VM y el Bluetooth no son placas; en Windows valen los COM", () => {
  const ch340Windows = { port: "COM5", description: "USB-SERIAL CH340 (COM5)", hwid: "USB VID:PID=1A86:7523 SER= LOCATION=1-3" } // INFERIDO
  const d = id.clasificarPuertos([COM1_VM, BLUETOOTH, ch340Windows], "win32")
  assert.deepEqual(d.otros, [COM1_VM, BLUETOOTH])
  assert.deepEqual(d.placas.map((p) => [p.puerto, p.nivel, p.identidad]), [["COM5", "posicional", "1A86:7523@COM5"]])
})

test("clasificarPuertos: un puerto cuyo nombre no tiene la forma de la plataforma nunca es placa", () => {
  // Un `/dev/...` informado en Windows, un COM en Linux, y un nombre con inyección.
  assert.deepEqual(id.clasificarPuertos([CH9102], "win32").placas, [])
  assert.deepEqual(linux({ ...CH9102, port: "COM5" }).placas, [])
  const raro = { ...CH9102, port: "/dev/ttyACM0 --target uploadfs" }
  const d = linux(raro)
  assert.deepEqual(d.placas, [])
  assert.deepEqual(d.otros, [raro])
})

test("clasificarPuertos: con VID pero sin PID no es una placa a la que se pueda cargar", () => {
  const sinPid = { port: "/dev/ttyUSB5", hwid: "USB VID_1A86" }
  assert.deepEqual(linux(sinPid).placas, [])
  assert.deepEqual(linux(sinPid).otros, [sinPid])
})

// ═════════════════════════════════════════════════════════════════════════════════════
// elegirPuerto: los 13 casos de A4 §4
// ═════════════════════════════════════════════════════════════════════════════════════

const HASH_CH9102 = () => hashDe("1A86:55D4", "5322003872")
const HASH_UNO = () => hashDe("2341:0043", "85736323833351F0E1D1")
const HASH_CH340 = () => hashDe("1A86:7523", null)

/** Un rechazo trae SIEMPRE las candidatas y los otros, para poder contarle al docente qué hay. */
function rechazo(r, codigo, d) {
  assert.equal(r.ok, false, `tenía que rechazar con ${codigo} y eligió ${r.placa?.puerto}`)
  assert.equal(r.codigo, codigo)
  assert.deepEqual(r.candidatas, d.placas)
  assert.deepEqual(r.otros, d.otros)
}
function elige(r, puerto) {
  assert.equal(r.ok, true, `tenía que elegir ${puerto} y rechazó con ${r.codigo}`)
  assert.equal(r.placa.puerto, puerto)
}

test("caso 1: ninguna placa, sin puerto pedido → SIN_PLACA", () => {
  const d = linux(...TTYS)
  rechazo(id.elegirPuerto(d, { sal: SAL }), "SIN_PLACA", d)
  const vacio = linux()
  rechazo(id.elegirPuerto(vacio, { sal: SAL }), "SIN_PLACA", vacio)
})

test("caso 2: ninguna placa, con puerto pedido → PUERTO_NO_ESTA", () => {
  const d = linux()
  rechazo(id.elegirPuerto(d, { puertoPedido: "/dev/ttyUSB0", sal: SAL }), "PUERTO_NO_ESTA", d)
})

test("caso 3: una sola placa, sin pedir nada → esa (fuerte o posicional, con su nivel a la vista)", () => {
  const fuerte = id.elegirPuerto(linux(CH9102, ...TTYS), { sal: SAL })
  elige(fuerte, "/dev/ttyACM0")
  assert.equal(fuerte.placa.nivel, "fuerte")
  const posicional = id.elegirPuerto(linux(CH340), { sal: SAL })
  elige(posicional, "/dev/ttyUSB1")
  assert.equal(posicional.placa.nivel, "posicional")
})

test("caso 4: una sola placa y se pide SU puerto → esa", () => {
  elige(id.elegirPuerto(linux(CH9102), { puertoPedido: "/dev/ttyACM0", sal: SAL }), "/dev/ttyACM0")
})

test("caso 5: una sola placa y se pide OTRO puerto → PUERTO_NO_ESTA (no se cambia a la que sí hay)", () => {
  const d = linux(CH9102)
  rechazo(id.elegirPuerto(d, { puertoPedido: "/dev/ttyUSB9", sal: SAL }), "PUERTO_NO_ESTA", d)
})

test("caso 6: una sola placa y es la esperada → esa (también si es posicional: coincide el modelo)", () => {
  elige(id.elegirPuerto(linux(CH9102), { placaFisicaEsperada: HASH_CH9102(), sal: SAL }), "/dev/ttyACM0")
  // La misma placa en OTRO puerto sigue siendo la esperada: la serie no depende del puerto.
  elige(id.elegirPuerto(linux({ ...CH9102, port: "/dev/ttyACM3" }), { placaFisicaEsperada: HASH_CH9102(), sal: SAL }), "/dev/ttyACM3")
  elige(id.elegirPuerto(linux(CH340), { placaFisicaEsperada: HASH_CH340(), sal: SAL }), "/dev/ttyUSB1")
})

test("caso 7: una sola placa y NO es la esperada → PLACA_EQUIVOCADA", () => {
  const d = linux(CH9102)
  rechazo(id.elegirPuerto(d, { placaFisicaEsperada: HASH_UNO(), sal: SAL }), "PLACA_EQUIVOCADA", d)
  // Mismo modelo, otra serie: es otra placa.
  rechazo(id.elegirPuerto(d, { placaFisicaEsperada: hashDe("1A86:55D4", "9999999999"), sal: SAL }), "PLACA_EQUIVOCADA", d)
})

test("caso 8: varias placas, sin pedir nada → VARIAS_PLACAS. NUNCA la primera, en ningún orden", () => {
  for (const orden of [[CH9102, PL2303], [PL2303, CH9102], [CH340, UNO, CH9102]]) {
    const d = linux(...orden)
    rechazo(id.elegirPuerto(d, { sal: SAL }), "VARIAS_PLACAS", d)
  }
})

test("caso 9: varias placas y se pide un puerto de la lista → la pedida, aunque no sea la primera", () => {
  const d = linux(CH9102, PL2303, CH340)
  elige(id.elegirPuerto(d, { puertoPedido: "/dev/ttyUSB1", sal: SAL }), "/dev/ttyUSB1")
  elige(id.elegirPuerto(d, { puertoPedido: "/dev/ttyUSB0", sal: SAL }), "/dev/ttyUSB0")
  elige(id.elegirPuerto(d, { puertoPedido: "/dev/ttyACM0", sal: SAL }), "/dev/ttyACM0")
})

test("caso 10: varias placas y se pide un puerto que no está → PUERTO_NO_ESTA", () => {
  const d = linux(CH9102, PL2303)
  rechazo(id.elegirPuerto(d, { puertoPedido: "/dev/ttyUSB7", sal: SAL }), "PUERTO_NO_ESTA", d)
})

test("caso 11: varias placas y la esperada (fuerte) coincide con UNA sola → ésa, esté donde esté", () => {
  elige(id.elegirPuerto(linux(PL2303, CH340, CH9102), { placaFisicaEsperada: HASH_CH9102(), sal: SAL }), "/dev/ttyACM0")
  elige(id.elegirPuerto(linux(UNO, CH9102), { placaFisicaEsperada: HASH_UNO(), sal: SAL }), "/dev/ttyACM1")
})

test("caso 12: varias placas y la esperada es posicional (o coincide con más de una) → VARIAS_PLACAS", () => {
  // La esperada es un CH340 sin serie y hay UN solo CH340 entre varias: igual no alcanza.
  const d = linux(CH340, CH9102)
  rechazo(id.elegirPuerto(d, { placaFisicaEsperada: HASH_CH340(), sal: SAL }), "VARIAS_PLACAS", d)
  // Dos CH340: coinciden las dos.
  const dos = linux(CH340, { ...CH340, port: "/dev/ttyUSB4", hwid: "USB VID:PID=1A86:7523 LOCATION=1-4" })
  rechazo(id.elegirPuerto(dos, { placaFisicaEsperada: HASH_CH340(), sal: SAL }), "VARIAS_PLACAS", dos)
})

test("caso 13: varias placas y ninguna es la esperada → PLACA_EQUIVOCADA", () => {
  const d = linux(CH9102, PL2303)
  rechazo(id.elegirPuerto(d, { placaFisicaEsperada: HASH_UNO(), sal: SAL }), "PLACA_EQUIVOCADA", d)
})

// ── Lo que la tabla no numera ────────────────────────────────────────────────────────

test("puerto pedido con forma inválida → PUERTO_INVALIDO, aunque haya una sola placa y sea obvia", () => {
  const d = linux(CH9102)
  for (const p of ["192.168.1.20", "esp32.local", "", "--upload-port x", "/dev/ttyACM0; id"]) {
    rechazo(id.elegirPuerto(d, { puertoPedido: p, sal: SAL }), "PUERTO_INVALIDO", d)
  }
})

test("puerto pedido que está en la lista pero no es una placa → PUERTO_NO_ES_PLACA", () => {
  const d = linux(...TTYS, CH9102)
  rechazo(id.elegirPuerto(d, { puertoPedido: "/dev/ttyS0", sal: SAL }), "PUERTO_NO_ES_PLACA", d)
  const win = id.clasificarPuertos([COM1_VM], "win32")
  rechazo(id.elegirPuerto(win, { puertoPedido: "COM1", sal: SAL }), "PUERTO_NO_ES_PLACA", win)
})

test("en Windows el puerto pedido no distingue mayúsculas (com5 es COM5)", () => {
  const d = id.clasificarPuertos([{ port: "COM5", hwid: "USB VID:PID=10C4:EA60 SER=0444" }], "win32")
  elige(id.elegirPuerto(d, { puertoPedido: "com5", sal: SAL }), "COM5")
  // En Unix sí distingue: es otra ruta.
  rechazo(id.elegirPuerto(linux(CH9102), { puertoPedido: "/dev/ttyacm0", sal: SAL }), "PUERTO_NO_ESTA", linux(CH9102))
})

test("puerto pedido Y placa esperada: tienen que cumplirse las dos", () => {
  const d = linux(CH9102, UNO)
  elige(id.elegirPuerto(d, { puertoPedido: "/dev/ttyACM0", placaFisicaEsperada: HASH_CH9102(), sal: SAL }), "/dev/ttyACM0")
  rechazo(id.elegirPuerto(d, { puertoPedido: "/dev/ttyACM1", placaFisicaEsperada: HASH_CH9102(), sal: SAL }), "PLACA_EQUIVOCADA", d)
})

test("la placa esperada se compara por HASH CON SAL: la serie en claro no sirve, y otra sal tampoco", () => {
  const d = linux(CH9102)
  // Pasar la serie (o la identidad legible) en vez del hash nunca coincide.
  for (const enClaro of ["5322003872", "1A86:55D4#5322003872", "1A86:55D4#5322003872@/dev/ttyACM0", "1A86:55D4"]) {
    rechazo(id.elegirPuerto(d, { placaFisicaEsperada: enClaro, sal: SAL }), "PLACA_EQUIVOCADA", d)
  }
  // El hash de OTRA compu (otra sal) no es comparable: no coincide.
  rechazo(id.elegirPuerto(d, { placaFisicaEsperada: hashDe("1A86:55D4", "5322003872", "otra-sal-de-otra-compu-00000000"), sal: SAL }), "PLACA_EQUIVOCADA", d)
  // El hash es sha256 en hex y no contiene la serie.
  assert.match(HASH_CH9102(), /^[0-9a-f]{64}$/)
  assert.ok(!HASH_CH9102().includes("5322003872"))
})

test("hashDePlacaFisica: mismo formato que el registro de cargas de hoy (sal|modelo|serie, `sin-serie` sin serie)", async () => {
  const { createHash } = await import("node:crypto")
  const sha = (t) => createHash("sha256").update(t).digest("hex")
  assert.equal(hashDe("1A86:55D4", "5322003872"), sha(`${SAL}|1A86:55D4|5322003872`))
  assert.equal(hashDe("1A86:7523", null), sha(`${SAL}|1A86:7523|sin-serie`))
})

test("una placa con serie genérica (0001) se espera y se compara como «sin serie»: dos clones no se distinguen", () => {
  const otra0001 = { ...CP2102_0001, port: "/dev/ttyUSB6" }
  // Con una sola enchufada coincide por modelo…
  elige(id.elegirPuerto(linux(CP2102_0001), { placaFisicaEsperada: hashDe("10C4:EA60", null), sal: SAL }), "/dev/ttyUSB2")
  // …y con dos, no hay con qué desempatar.
  const dos = linux(CP2102_0001, otra0001)
  rechazo(id.elegirPuerto(dos, { placaFisicaEsperada: hashDe("10C4:EA60", null), sal: SAL }), "VARIAS_PLACAS", dos)
  // El hash «con 0001 como serie» ya no identifica a nadie.
  rechazo(id.elegirPuerto(linux(CP2102_0001), { placaFisicaEsperada: hashDe("10C4:EA60", "0001"), sal: SAL }), "PLACA_EQUIVOCADA", linux(CP2102_0001))
})

// ═════════════════════════════════════════════════════════════════════════════════════
// mismaIdentidad
// ═════════════════════════════════════════════════════════════════════════════════════

const unica = (...crudo) => linux(...crudo).placas[0]

test("mismaIdentidad (fuerte): misma serie y modelo, esté en el puerto que esté; otra serie u otro modelo, no", () => {
  const a = unica(CH9102)
  assert.equal(id.mismaIdentidad(a, unica(CH9102)), true)
  assert.equal(id.mismaIdentidad(a, unica({ ...CH9102, port: "/dev/ttyACM5" })), true, "la serie no depende del puerto")
  assert.equal(id.mismaIdentidad(a, unica({ ...CH9102, hwid: "USB VID:PID=1A86:55D4 SER=5322003873 LOCATION=3-4.2:1.0" })), false)
  assert.equal(id.mismaIdentidad(a, unica({ ...CH9102, hwid: "USB VID:PID=10C4:EA60 SER=5322003872" })), false, "misma serie, otro modelo")
})

test("mismaIdentidad (posicional): mismo modelo y mismo puerto; si cambia cualquiera de los dos, no", () => {
  const a = unica(CH340)
  assert.equal(id.mismaIdentidad(a, unica(CH340)), true)
  assert.equal(id.mismaIdentidad(a, unica({ ...CH340, port: "/dev/ttyUSB9" })), false, "cambió de puerto: no se sabe si es la misma")
  assert.equal(id.mismaIdentidad(a, unica({ ...PL2303, port: CH340.port })), false, "otro modelo en el mismo puerto")
})

test("mismaIdentidad: si cambia el NIVEL, no es la misma (antes tenía serie y ahora no, o al revés)", () => {
  const conSerie = unica({ ...CP2102_0444, port: "/dev/ttyUSB2" })
  const sinSerie = unica(CP2102_0001)
  assert.equal(conSerie.puerto, sinSerie.puerto)
  assert.equal(id.mismaIdentidad(conSerie, sinSerie), false)
  assert.equal(id.mismaIdentidad(sinSerie, conSerie), false)
})

// ═════════════════════════════════════════════════════════════════════════════════════
// descubrir (con `run` doble)
// ═════════════════════════════════════════════════════════════════════════════════════

function runQueContesta(respuesta) {
  const llamadas = []
  const run = async (...args) => {
    llamadas.push(args)
    return respuesta
  }
  return { run, llamadas }
}

test("descubrir: pide la lista en JSON, sin capacidad de carga, y la clasifica", async () => {
  const { run, llamadas } = runQueContesta({ code: 0, stdout: JSON.stringify([...TTYS, CH9102, PL2303]), stderr: "" })
  const signal = new AbortController().signal
  const d = await id.descubrir(run, "/proyecto", signal)
  assert.equal(llamadas.length, 1)
  assert.deepEqual(llamadas[0][0], ["pio", "device", "list", "--json-output"])
  assert.equal(llamadas[0][1], "/proyecto")
  assert.equal(llamadas[0][2], signal)
  assert.equal(llamadas[0].length, 3, "descubrir no pasa timeout ni capacidad: es una consulta")
  assert.equal(d.fallo, undefined)
  assert.equal(d.crudo.length, 5)
  // `descubrir` clasifica con la plataforma REAL: estos puertos son `/dev/...`, así que
  // fuera de Windows son dos placas y en Windows ninguna tiene forma de puerto.
  assert.deepEqual(d.placas.map((p) => p.puerto), process.platform === "win32" ? [] : ["/dev/ttyACM0", "/dev/ttyUSB0"])
})

test("descubrir: si la lista no se puede leer NO se adivina — sin placas y con el fallo a la vista", async () => {
  const casos = [
    ["pio terminó mal", { code: 1, stdout: JSON.stringify([CH9102]), stderr: "Error" }, 1],
    ["se cortó por timeout", { code: 124, stdout: "", stderr: "no termino" }, 124],
    ["se canceló", { code: 130, stdout: "", stderr: "Cancelado" }, 130],
    ["no es JSON (y nombra un puerto: la detección vieja lo sacaba con una regex)", { code: 0, stdout: "/dev/ttyUSB0\n----\nHardware ID: USB VID:PID=1A86:7523", stderr: "" }, 0],
    ["JSON que no es una lista", { code: 0, stdout: '{"port":"/dev/ttyUSB0"}', stderr: "" }, 0],
    ["salida vacía", { code: 0, stdout: "", stderr: "" }, 0],
  ]
  for (const [nombre, respuesta, code] of casos) {
    const d = await id.descubrir(runQueContesta(respuesta).run, "/p")
    assert.deepEqual(d.placas, [], nombre)
    assert.deepEqual(d.otros, [], nombre)
    assert.deepEqual(d.crudo, [], nombre)
    assert.equal(d.fallo?.code, code, nombre)
    assert.equal(typeof d.fallo?.detalle, "string", nombre)
    assert.equal(id.elegirPuerto(d, { sal: SAL }).codigo, "SIN_PLACA", nombre)
  }
})

test("descubrir: las filas mal formadas se ignoran; una lista vacía no es un fallo", async () => {
  const basura = [null, 7, "texto", {}, { port: 5 }, { port: "" }, { port: CH9102.port, hwid: 12, description: null }]
  const d = await id.descubrir(runQueContesta({ code: 0, stdout: JSON.stringify(basura), stderr: "" }).run, "/p")
  assert.deepEqual(d.crudo, [{ port: CH9102.port }], "sólo queda la fila con un puerto de texto, sin hwid ni descripción inventados")
  assert.deepEqual(d.placas, [])
  assert.equal(d.fallo, undefined)
  const vacia = await id.descubrir(runQueContesta({ code: 0, stdout: "[]", stderr: "" }).run, "/p")
  assert.equal(vacia.fallo, undefined)
  assert.deepEqual(vacia.crudo, [])
})
