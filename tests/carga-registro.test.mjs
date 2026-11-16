// `opencode/carga/registro.ts` y `opencode/carga/artefacto.ts` (Slice 2, gate único de
// carga — CONTRATOS-API §8 y las primitivas de §5).
//
// REGISTRO. Lo que se fija:
//   - sólo se anota una carga VERIFICADA; un registro que no se puede escribir se informa
//     (`ok: false`), no tira y no se calla;
//   - lo que queda en disco son hashes, fechas, números y códigos: ni MAC, ni serie, ni
//     hwid, ni puerto, ni rutas, aunque quien llama los meta en el objeto;
//   - no se escribe a través de un enlace simbólico, ni queda un JSON por la mitad.
//
// ARTEFACTO. Sólo las primitivas (qué archivos componen el artefacto de un ESP32 espera
// una decisión del owner): hashear una lista declarada sin seguir enlaces, y comparar dos
// huellas diciendo qué cambió.
//
// Todo en carpetas temporales; `XDG_CONFIG_HOME` apunta a una de ellas ANTES de importar,
// así ningún test toca el registro real de la compu.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RAIZ = mkdtempSync(join(tmpdir(), "tb-carga-registro-"))
const XDG_ORIGINAL = process.env.XDG_CONFIG_HOME
process.env.XDG_CONFIG_HOME = join(RAIZ, "config")
const reg = await import(join(REPO, "opencode/carga/registro.ts"))
const art = await import(join(REPO, "opencode/carga/artefacto.ts"))

after(() => {
  if (XDG_ORIGINAL === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = XDG_ORIGINAL
  rmSync(RAIZ, { recursive: true, force: true })
})

let n = 0
const carpeta = () => {
  const d = join(RAIZ, `p${++n}`)
  mkdirSync(d)
  return d
}
const sha = (s) => createHash("sha256").update(s).digest("hex")
const esRoot = typeof process.getuid === "function" && process.getuid() === 0

const CARGA = Object.freeze({ version: 4, origen: "programa", huella: sha("huella").slice(0, 16), placaFisica: sha("placa"), artefactoSha256: sha("artefacto"), verificado: true, macHash: sha("mac"), fechaUtc: "2026-11-15T12:00:00.000Z" })

// ── UltimaCarga ──────────────────────────────────────────────────────────────────────────

test("guardarUltimaCarga + leerUltimaCarga: ida y vuelta de una carga verificada, en .pio/tecnia/ultima-carga.json", () => {
  const d = carpeta()
  assert.equal(reg.rutaUltimaCarga(d), join(d, ".pio", "tecnia", "ultima-carga.json"))
  assert.equal(reg.leerUltimaCarga(d), null)
  assert.deepEqual(reg.guardarUltimaCarga(d, CARGA), { ok: true })
  assert.deepEqual(reg.leerUltimaCarga(d), { ...CARGA })
  assert.deepEqual(JSON.parse(readFileSync(reg.rutaUltimaCarga(d), "utf8")), { ...CARGA })
  // Sin temporales olvidados.
  assert.deepEqual(readdirSync(join(d, ".pio", "tecnia")), ["ultima-carga.json"])
})

test("una carga NO verificada no se anota como última carga, y la función lo dice", () => {
  const d = carpeta()
  for (const verificado of [false, undefined, "true", 1, null]) {
    const r = reg.guardarUltimaCarga(d, { ...CARGA, verificado })
    assert.equal(r.ok, false, `guardó con verificado = ${String(verificado)}`)
    assert.equal(r.codigo, "REGISTRO_NO_GUARDADO")
  }
  assert.equal(existsSync(reg.rutaUltimaCarga(d)), false, "quedó un archivo de una carga sin verificar")
  // Y si en disco hay un 4 con verificado false (lo escribió otro), no se lee como carga buena.
  mkdirSync(join(d, ".pio", "tecnia"), { recursive: true })
  writeFileSync(reg.rutaUltimaCarga(d), JSON.stringify({ ...CARGA, verificado: false }))
  assert.equal(reg.leerUltimaCarga(d), null)
})

test("PRIVACIDAD: un campo con forma de MAC, serie, hwid, puerto o ruta hace que no se escriba NADA", () => {
  const d = carpeta()
  const malos = {
    placaFisica: "1A86:7523#5322003872",
    huella: "/home/profe/proyecto",
    artefactoSha256: "COM5",
    macHash: "0c:b8:15:c1:63:dc",
    fechaUtc: "ayer",
    origen: "otro",
    version: 3,
  }
  for (const [campo, valor] of Object.entries(malos)) {
    const r = reg.guardarUltimaCarga(d, { ...CARGA, [campo]: valor })
    assert.equal(r.ok, false, `guardó con ${campo} = ${valor}`)
  }
  assert.equal(existsSync(join(d, ".pio")), false)
})

test("PRIVACIDAD: los campos de más no se copian al disco (lo que se escribe se arma campo por campo)", () => {
  const d = carpeta()
  const conExtras = { ...CARGA, mac: "0c:b8:15:c1:63:dc", serie: "5322003872", hwid: "USB VID:PID=1A86:55D4 SER=5322003872 LOCATION=1-2", puerto: "/dev/ttyACM0", ruta: d }
  assert.deepEqual(reg.guardarUltimaCarga(d, conExtras, "USB VID:PID=1A86:55D4 SER=5322003872 LOCATION=1-2"), { ok: true })
  const enDisco = readFileSync(reg.rutaUltimaCarga(d), "utf8")
  assert.deepEqual(Object.keys(JSON.parse(enDisco)).sort(), Object.keys(CARGA).sort())
  const global = readFileSync(reg.rutaCargasGlobal(), "utf8")
  for (const texto of [enDisco, global]) {
    for (const secreto of ["5322003872", "1A86", "55D4", "0c:b8", "ttyACM0", d, "LOCATION"]) assert.equal(texto.includes(secreto), false, `quedó ${secreto} en el registro`)
  }
})

test("leerUltimaCarga: un archivo roto, de otra versión o al que le falta algo es null; las versiones 2 y 3 vuelven con SU forma", () => {
  const d = carpeta()
  mkdirSync(join(d, ".pio", "tecnia"), { recursive: true })
  const escribir = (x) => writeFileSync(reg.rutaUltimaCarga(d), typeof x === "string" ? x : JSON.stringify(x))
  for (const roto of ["", "{", "[]", "null", "42", { version: 5 }, { ...CARGA, version: 1 }, { ...CARGA, huella: undefined }, { ...CARGA, placaFisica: "1A86:7523" }, { ...CARGA, fechaUtc: 0 }]) {
    escribir(roto)
    assert.equal(reg.leerUltimaCarga(d), null, JSON.stringify(roto))
  }
  escribir({ version: 3, placa: "esp32dev", entradas: ["a", 7, "b"], placaFisica: "abcd", marcaSal: "1234abcd", otra: "cosa" })
  assert.deepEqual(reg.leerUltimaCarga(d), { version: 3, placa: "esp32dev", entradas: ["a", "b"], placaFisica: "abcd", marcaSal: "1234abcd" })
  escribir({ version: 2, placa: "uno", entradas: [] })
  assert.deepEqual(reg.leerUltimaCarga(d), { version: 2, placa: "uno", entradas: [], placaFisica: null, marcaSal: null })
  // Un archivo enorme no se lee.
  escribir(JSON.stringify({ ...CARGA, relleno: "x".repeat(70_000) }))
  assert.equal(reg.leerUltimaCarga(d), null)
})

test("FALLO DE E/S: si no se puede escribir, devuelve ok:false con detalle — no tira y no dice que guardó", { skip: esRoot ? "como root los permisos no frenan la escritura" : false }, () => {
  const d = carpeta()
  chmodSync(d, 0o500)
  try {
    let r
    assert.doesNotThrow(() => (r = reg.guardarUltimaCarga(d, CARGA)))
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "REGISTRO_NO_GUARDADO")
    assert.match(r.detalle, /EACCES|EPERM/)
    assert.equal(reg.leerUltimaCarga(d), null)
  } finally {
    chmodSync(d, 0o700)
  }
  // La carpeta del proyecto no existe.
  const r = reg.guardarUltimaCarga(join(RAIZ, "no-existe"), CARGA)
  assert.equal(r.ok, false)
  assert.equal(existsSync(join(RAIZ, "no-existe")), false, "no se crea la carpeta del proyecto para anotar")
})

test("ENLACES: no se escribe a través de un enlace en .pio, en .pio/tecnia ni en el archivo, y tampoco se lee por uno", () => {
  const afuera = carpeta()
  for (const tramo of [[".pio"], [".pio", "tecnia"], [".pio", "tecnia", "ultima-carga.json"]]) {
    const d = carpeta()
    const destino = join(afuera, `destino-${tramo.length}`)
    if (tramo.length === 3) writeFileSync(destino, JSON.stringify(CARGA))
    else mkdirSync(destino, { recursive: true })
    mkdirSync(join(d, ...tramo.slice(0, -1)), { recursive: true })
    symlinkSync(destino, join(d, ...tramo))
    const r = reg.guardarUltimaCarga(d, { ...CARGA, fechaUtc: "2026-11-16T00:00:00Z" })
    assert.equal(r.ok, false, `escribió a través de un enlace en ${tramo.join("/")}`)
    if (tramo.length === 3) {
      assert.equal(JSON.parse(readFileSync(destino, "utf8")).fechaUtc, CARGA.fechaUtc, "pisó el archivo de afuera")
      assert.equal(reg.leerUltimaCarga(d), null, "leyó un registro a través de un enlace")
    } else assert.deepEqual(readdirSync(destino), [], "escribió afuera del proyecto")
  }
})

test("ATOMICIDAD: guardar pisa el registro anterior entero y no deja temporales", () => {
  const d = carpeta()
  assert.deepEqual(reg.guardarUltimaCarga(d, CARGA), { ok: true })
  const { macHash: _sinMac, ...sinMac } = CARGA
  const otra = { ...sinMac, artefactoSha256: sha("otro"), fechaUtc: "2026-11-16T08:30:00Z" }
  assert.deepEqual(reg.guardarUltimaCarga(d, otra), { ok: true })
  assert.deepEqual(reg.leerUltimaCarga(d), otra)
  assert.deepEqual(readdirSync(join(d, ".pio", "tecnia")), ["ultima-carga.json"])
})

test("registro de la compu: la sal se crea una vez y se guarda; la placa queda como hash con sal → hash del proyecto", () => {
  const d = carpeta()
  const antes = reg.leerCargasGlobal()
  assert.match(antes.sal, /^[0-9a-f]{32}$/)
  assert.equal(reg.leerCargasGlobal().sal, antes.sal, "la sal cambió entre dos lecturas")
  assert.equal(reg.rutaCargasGlobal(), join(RAIZ, "config", "opencode", "tecnia-cargas.json"))
  assert.deepEqual(reg.guardarUltimaCarga(d, CARGA, "USB VID:PID=10C4:EA60 SER=ABCD1234 LOCATION=1-1"), { ok: true })
  const despues = reg.leerCargasGlobal()
  assert.equal(despues.sal, antes.sal)
  const esperada = sha(`${antes.sal}|10C4:EA60|ABCD1234`).slice(0, 16)
  assert.equal(despues.placas[esperada], sha(`${antes.sal}|${d}`).slice(0, 16))
  // Sin identidad USB en el hwid, no se inventa una placa.
  const cuantas = Object.keys(despues.placas).length
  assert.deepEqual(reg.guardarUltimaCarga(d, CARGA, "n/a"), { ok: true })
  assert.equal(Object.keys(reg.leerCargasGlobal().placas).length, cuantas)
  // Un registro global con basura adentro: se conserva la sal y se tira la basura.
  writeFileSync(reg.rutaCargasGlobal(), JSON.stringify({ sal: antes.sal, placas: { [esperada]: "abcdef0123456789", "1A86:7523#SERIE": "x", bueno: 3 } }))
  assert.deepEqual(reg.leerCargasGlobal(), { sal: antes.sal, placas: { [esperada]: "abcdef0123456789" } })
})

test("registro de la compu SIN archivo: la sal se crea, se GUARDA en el acto y no cambia; si no se puede guardar, se recuerda para el proceso", () => {
  const anterior = process.env.XDG_CONFIG_HOME
  try {
    // Limpio: nadie escribió todavía.
    process.env.XDG_CONFIG_HOME = join(RAIZ, "config-limpio")
    const primera = reg.leerCargasGlobal()
    assert.ok(existsSync(reg.rutaCargasGlobal()), "la sal nueva no quedó guardada en disco")
    assert.deepEqual(JSON.parse(readFileSync(reg.rutaCargasGlobal(), "utf8")), { sal: primera.sal, placas: {} }, "la sal no quedó guardada al crearla")
    assert.equal(reg.leerCargasGlobal().sal, primera.sal)
    // Imposible de guardar: el "directorio" de configuración es un archivo.
    writeFileSync(join(RAIZ, "soy-un-archivo"), "x")
    process.env.XDG_CONFIG_HOME = join(RAIZ, "soy-un-archivo")
    const a = reg.leerCargasGlobal()
    assert.match(a.sal, /^[0-9a-f]{32}$/)
    assert.equal(reg.leerCargasGlobal().sal, a.sal, "sin poder guardarla, la sal cambió entre dos llamadas del mismo proceso")
    assert.notEqual(a.sal, primera.sal)
    // Y guardar una carga con hwid ahí dice que NO quedó anotado en la compu.
    const d = carpeta()
    const r = reg.guardarUltimaCarga(d, CARGA, "USB VID:PID=10C4:EA60 SER=ABCD1234")
    assert.equal(r.ok, false)
    assert.match(r.detalle, /no en el registro de la compu/)
    assert.deepEqual(reg.leerUltimaCarga(d), { ...CARGA }, "lo del proyecto sí quedó, y se dice por separado")
  } finally {
    process.env.XDG_CONFIG_HOME = anterior
  }
})

test("hashDeMac: depende de la sal, no distingue mayúsculas y no contiene la MAC", () => {
  const a = reg.hashDeMac("sal-uno", "0C:B8:15:C1:63:DC")
  assert.equal(a, reg.hashDeMac("sal-uno", " 0c:b8:15:c1:63:dc "))
  assert.notEqual(a, reg.hashDeMac("sal-dos", "0c:b8:15:c1:63:dc"))
  assert.match(a, /^[0-9a-f]{64}$/)
})

// ── Banco ────────────────────────────────────────────────────────────────────────────────

const BANCO = Object.freeze({
  placaFisica: sha("placa"),
  ultimaCompilacion: { revision: 7, catalogoHash: sha("catalogo").slice(0, 16), fuentesSha256: sha("fuentes"), sha256Conjunto: sha("conjunto"), fechaUtc: "2026-11-15T12:00:00Z" },
  ultimaCarga: { revision: 7, sha256Conjunto: sha("conjunto"), fechaUtc: "2026-11-15T12:01:00Z", origen: "programa" },
  ultimoIntento: { fechaUtc: "2026-11-15T12:02:00Z", codigo: "CARGA_SIN_VERIFICAR" },
})

test("Banco: ida y vuelta en .tecnia-vista-fisica/.banco.json, sin campos de más", () => {
  const d = carpeta()
  assert.equal(reg.leerBanco(d), null)
  assert.deepEqual(reg.guardarBanco(d, { ...BANCO, mac: "0c:b8:15:c1:63:dc", puerto: "COM5", ultimaCarga: { ...BANCO.ultimaCarga, ruta: d } }), { ok: true })
  assert.equal(reg.rutaBanco(d), join(d, ".tecnia-vista-fisica", ".banco.json"))
  assert.deepEqual(reg.leerBanco(d), { ...BANCO })
  const texto = readFileSync(reg.rutaBanco(d), "utf8")
  for (const secreto of ["0c:b8", "COM5", d]) assert.equal(texto.includes(secreto), false)
  assert.deepEqual(reg.guardarBanco(d, {}), { ok: true })
  assert.deepEqual(reg.leerBanco(d), {})
})

test("Banco: un campo con otra forma hace que no se escriba nada, y un archivo así en disco se lee como null", () => {
  const malos = [
    { placaFisica: "1A86:7523#SER" },
    { ultimaCompilacion: { ...BANCO.ultimaCompilacion, revision: -1 } },
    { ultimaCompilacion: { ...BANCO.ultimaCompilacion, revision: 1.5 } },
    { ultimaCompilacion: { ...BANCO.ultimaCompilacion, fuentesSha256: "/home/x/src" } },
    { ultimaCarga: { ...BANCO.ultimaCarga, origen: "a-mano" } },
    { ultimaCarga: { ...BANCO.ultimaCarga, fechaUtc: "hoy" } },
    { ultimoIntento: { fechaUtc: "2026-11-15T12:02:00Z", codigo: "no cargó: /dev/ttyACM0 ocupado" } },
    { ultimoIntento: "CARGA_FALLIDA" },
  ]
  for (const malo of malos) {
    const d = carpeta()
    const r = reg.guardarBanco(d, { ...BANCO, ...malo })
    assert.equal(r.ok, false, JSON.stringify(malo))
    assert.equal(existsSync(join(d, ".tecnia-vista-fisica")), false)
    mkdirSync(join(d, ".tecnia-vista-fisica"))
    writeFileSync(reg.rutaBanco(d), JSON.stringify({ ...BANCO, ...malo }))
    assert.equal(reg.leerBanco(d), null, JSON.stringify(malo))
  }
  assert.equal(reg.guardarBanco(join(RAIZ, "tampoco-existe"), BANCO).ok, false)
})

// ── Artefacto: primitivas ────────────────────────────────────────────────────────────────

test("hashearArchivos: sha256 y tamaño de cada archivo declarado, en orden, y un hash del conjunto", () => {
  const d = carpeta()
  writeFileSync(join(d, "a.bin"), "contenido de a")
  writeFileSync(join(d, "b.bin"), Buffer.alloc(3 * 1024 * 1024 + 5, 7))
  const r = art.hashearArchivos([join(d, "a.bin"), join(d, "b.bin")])
  assert.equal(r.ok, true)
  assert.deepEqual(r.huella.archivos, [
    { ruta: join(d, "a.bin"), bytes: 14, sha256: sha("contenido de a") },
    { ruta: join(d, "b.bin"), bytes: 3 * 1024 * 1024 + 5, sha256: sha(Buffer.alloc(3 * 1024 * 1024 + 5, 7)) },
  ])
  assert.match(r.huella.sha256Conjunto, /^[0-9a-f]{64}$/)
  // El conjunto depende del orden, de cuántos son y de cada contenido; no de las rutas.
  const alReves = art.hashearArchivos([join(d, "b.bin"), join(d, "a.bin")])
  assert.notEqual(alReves.huella.sha256Conjunto, r.huella.sha256Conjunto)
  assert.notEqual(art.hashearArchivos([join(d, "a.bin")]).huella.sha256Conjunto, r.huella.sha256Conjunto)
  writeFileSync(join(d, "copia-de-a.bin"), "contenido de a")
  assert.equal(art.hashearArchivos([join(d, "copia-de-a.bin")]).huella.sha256Conjunto, art.hashearArchivos([join(d, "a.bin")]).huella.sha256Conjunto)
})

test("hashearArchivos: error claro si falta, si no es un archivo común, si es un enlace, si está vacío o si la lista está mal", () => {
  const d = carpeta()
  writeFileSync(join(d, "real.bin"), "firmware")
  writeFileSync(join(d, "vacio.bin"), "")
  mkdirSync(join(d, "carpeta.bin"))
  symlinkSync(join(d, "real.bin"), join(d, "enlace.bin"))
  symlinkSync(join(d, "no-existe"), join(d, "enlace-roto.bin"))
  const caso = (rutas, ruta, motivo) => assert.deepEqual(art.hashearArchivos(rutas), { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta, motivo })
  caso([join(d, "no-esta.bin")], join(d, "no-esta.bin"), "FALTA")
  caso([join(d, "carpeta.bin")], join(d, "carpeta.bin"), "NO_ES_ARCHIVO_REGULAR")
  caso([join(d, "enlace.bin")], join(d, "enlace.bin"), "ES_ENLACE")
  caso([join(d, "enlace-roto.bin")], join(d, "enlace-roto.bin"), "ES_ENLACE")
  caso([join(d, "vacio.bin")], join(d, "vacio.bin"), "VACIO")
  caso([], "", "LISTA_VACIA")
  caso(["real.bin"], "real.bin", "RUTA_NO_ABSOLUTA")
  caso([join(d, "real.bin"), join(d, "real.bin")], join(d, "real.bin"), "RUTA_REPETIDA")
  // Uno malo entre varios buenos: no hay huella parcial.
  caso([join(d, "real.bin"), join(d, "no-esta.bin")], join(d, "no-esta.bin"), "FALTA")
  assert.equal(art.hashearArchivos(undefined).ok, false)
  assert.equal(art.hashearArchivos(join(d, "real.bin")).ok, false, "una ruta suelta no es una lista")
})

test("hashearArchivos: un archivo sin permiso de lectura es ILEGIBLE, no un hash de nada", { skip: esRoot ? "como root los permisos no frenan la lectura" : false }, () => {
  const d = carpeta()
  writeFileSync(join(d, "secreto.bin"), "x")
  chmodSync(join(d, "secreto.bin"), 0o000)
  try {
    assert.deepEqual(art.hashearArchivos([join(d, "secreto.bin")]), { ok: false, codigo: "ARTEFACTO_AUSENTE", ruta: join(d, "secreto.bin"), motivo: "ILEGIBLE" })
  } finally {
    chmodSync(join(d, "secreto.bin"), 0o600)
  }
})

test("compararHuellas: iguales es ok; y dice QUÉ cambió — contenido, tamaño, falta, sobra, orden", () => {
  const d = carpeta()
  const a = join(d, "firmware.bin")
  const b = join(d, "otra.bin")
  writeFileSync(a, "firmware v1")
  writeFileSync(b, "otra imagen")
  const aprobada = art.hashearArchivos([a, b]).huella
  assert.deepEqual(art.compararHuellas(aprobada, art.hashearArchivos([a, b]).huella), { ok: true })

  writeFileSync(a, "firmware v2")
  assert.deepEqual(art.compararHuellas(aprobada, art.hashearArchivos([a, b]).huella), { ok: false, codigo: "FIRMWARE_CAMBIO", cambios: [{ ruta: a, cambio: "CONTENIDO" }] })
  writeFileSync(a, "firmware v1 con algo más")
  assert.deepEqual(art.compararHuellas(aprobada, art.hashearArchivos([a, b]).huella).cambios, [{ ruta: a, cambio: "TAMANO" }])
  writeFileSync(a, "firmware v1")
  assert.deepEqual(art.compararHuellas(aprobada, art.hashearArchivos([a]).huella).cambios, [{ ruta: b, cambio: "FALTA" }])
  assert.deepEqual(art.compararHuellas(art.hashearArchivos([a]).huella, aprobada).cambios, [{ ruta: b, cambio: "SOBRA" }])
  assert.deepEqual(art.compararHuellas(aprobada, art.hashearArchivos([b, a]).huella).cambios, [{ ruta: a, cambio: "ORDEN" }, { ruta: b, cambio: "ORDEN" }])
  // No se le cree al sha256Conjunto que traiga la huella: se compara archivo por archivo.
  const mentirosa = { archivos: [{ ...aprobada.archivos[0], sha256: sha("otro") }, aprobada.archivos[1]], sha256Conjunto: aprobada.sha256Conjunto }
  assert.equal(art.compararHuellas(aprobada, mentirosa).ok, false)
})
