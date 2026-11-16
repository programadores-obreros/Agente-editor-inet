// `opencode/carga/candado.ts`: el candado en disco entre procesos, probado DIRECTO
// (Slice 2, gate único de carga — ADR-001 §10.4, decisión D4).
//
// El mecanismo se extrajo sin cambios de `servidor/servicio-con-vista.ts`. Los tests que
// ya lo cubrían por ese lado (`phase2-candado-atomicidad`, `phase2-candado-proceso`)
// siguen iguales; éstos fijan el contrato del módulo extraído, que ahora tiene dos
// dueños: el proyecto físico y el puerto de carga (`tests/carga-puertos.test.mjs`).
//
// Son deterministas: plantan a mano el estado exacto del disco y miran qué hace
// `tomarCandado`. No hay esperas.
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa):
// recuperar un candado ilegible en vez de rechazarlo; borrar sin comparar en
// `liberarCandadoSiPropio`; recuperar sin mirar el reclamo.

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const TMP = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-candado-"))
let candado
let n = 0
const nuevaRuta = () => join(TMP, `candado-${n++}.lock`)

before(async () => {
  candado = await import(join(REPO, "opencode/carga/candado.ts"))
})
after(() => rmSync(TMP, { recursive: true, force: true }))

/** El pid de un proceso que YA terminó: un dueño muerto de verdad, no un número inventado. */
function pidMuerto() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", "process.exit(0)"])
    proc.on("exit", () => resolve(proc.pid))
    proc.on("error", reject)
  })
}
const sobrantes = (ruta) => readdirSync(dirname(ruta)).filter((f) => f.startsWith(`${ruta.split("/").pop()}.`))

test("candado libre: se toma, queda escrito ENTERO con el dueño, y no deja temporales", () => {
  const ruta = nuevaRuta()
  const r = candado.tomarCandado(ruta)
  assert.equal(r.ok, true)
  assert.equal(r.rutaLock, ruta)
  const enDisco = JSON.parse(readFileSync(ruta, "utf8"))
  assert.deepEqual(enDisco, r.contenido)
  assert.equal(enDisco.pid, process.pid)
  assert.equal(enDisco.hostname, hostname())
  assert.ok(!Number.isNaN(Date.parse(enDisco.creado)))
  assert.deepEqual(Object.keys(enDisco).sort(), ["creado", "hostname", "pid"], "el candado no guarda nada más que eso")
  assert.deepEqual(sobrantes(ruta), [])
})

test("candado de un proceso VIVO: se rechaza como ocupado, dice quién lo tiene, y no se toca", () => {
  const ruta = nuevaRuta()
  const primero = candado.tomarCandado(ruta)
  const antes = readFileSync(ruta, "utf8")
  const segundo = candado.tomarCandado(ruta)
  assert.equal(segundo.ok, false)
  assert.equal(segundo.motivo, "ocupado")
  assert.deepEqual(segundo.existente, primero.contenido)
  assert.equal(readFileSync(ruta, "utf8"), antes)
  assert.deepEqual(sobrantes(ruta), [])
})

for (const [descripcion, contenido] of [
  ["vacío", ""],
  ["JSON cortado", '{"pid":12'],
  ["JSON sin los campos del dueño", '{"otra":"cosa"}'],
  ["no es JSON", "ocupado por juan"],
  ["JSON que es null", "null"],
]) {
  test(`candado ilegible (${descripcion}): NO está libre — se rechaza y el archivo queda byte a byte igual`, () => {
    const ruta = nuevaRuta()
    writeFileSync(ruta, contenido)
    const r = candado.tomarCandado(ruta)
    assert.equal(r.ok, false)
    assert.equal(r.motivo, "ilegible")
    assert.equal(readFileSync(ruta, "utf8"), contenido)
    assert.deepEqual(sobrantes(ruta), [], "ni temporales ni reclamo: no se intentó recuperar nada")
  })
}

test("candado de un dueño MUERTO: se recupera, queda propio, y el reclamo se retira", async () => {
  const ruta = nuevaRuta()
  writeFileSync(ruta, JSON.stringify({ pid: await pidMuerto(), hostname: hostname(), creado: new Date(0).toISOString() }))
  const r = candado.tomarCandado(ruta)
  assert.equal(r.ok, true)
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).pid, process.pid)
  assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")), r.contenido)
  assert.deepEqual(sobrantes(ruta), [], "quedó el reclamo .recuperando o un temporal")
})

test("dueño muerto pero OTRO ya lo está recuperando (reclamo presente): se rechaza y no se toca nada", async () => {
  const ruta = nuevaRuta()
  const vencido = JSON.stringify({ pid: await pidMuerto(), hostname: hostname(), creado: new Date(0).toISOString() })
  writeFileSync(ruta, vencido)
  const reclamo = JSON.stringify({ pid: process.pid, hostname: hostname(), creado: "2026-01-01T00:00:00.000Z" })
  writeFileSync(`${ruta}.recuperando`, reclamo)
  const r = candado.tomarCandado(ruta)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, "recuperando")
  assert.equal(r.rutaReclamo, `${ruta}.recuperando`)
  assert.equal(readFileSync(ruta, "utf8"), vencido)
  assert.equal(readFileSync(`${ruta}.recuperando`, "utf8"), reclamo, "el reclamo de otro no se toca")
})

test("límite heredado y declarado: un candado de OTRO host se trata como vencido y se recupera", () => {
  const ruta = nuevaRuta()
  writeFileSync(ruta, JSON.stringify({ pid: process.pid, hostname: `${hostname()}-otra-compu`, creado: new Date(0).toISOString() }))
  const r = candado.tomarCandado(ruta)
  assert.equal(r.ok, true)
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).hostname, hostname())
})

test("esLegible: el criterio extra endurece — un pid que no es número deja de recuperarse y pasa a rechazarse", () => {
  const raro = JSON.stringify({ pid: "doce", hostname: hostname(), creado: "x" })
  const estricto = (c) => Number.isSafeInteger(c.pid) && c.pid > 0

  const conCriterio = nuevaRuta()
  writeFileSync(conCriterio, raro)
  const r = candado.tomarCandado(conCriterio, { esLegible: estricto })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, "ilegible")
  assert.equal(readFileSync(conCriterio, "utf8"), raro)

  // Sin la opción, el comportamiento histórico de servicio-con-vista (no se cambió al
  // extraerlo): alcanza con que estén los campos, y un pid que no se puede señalar
  // cuenta como dueño muerto.
  const historico = nuevaRuta()
  writeFileSync(historico, raro)
  assert.equal(candado.tomarCandado(historico).ok, true)
})

test("un error de E/S que no es «ya existe» se LANZA: nunca vuelve como candado tomado", () => {
  const ruta = join(TMP, "carpeta-que-no-existe", "x.lock")
  assert.throws(() => candado.tomarCandado(ruta), (error) => error.code === "ENOENT")
  assert.equal(existsSync(ruta), false)
})

test("liberarCandadoSiPropio: borra el propio; el de otro (aunque sea del mismo pid, con otra fecha) queda", () => {
  const ruta = nuevaRuta()
  const r = candado.tomarCandado(ruta)
  // Otro dueño se quedó con el candado (lo recuperó) antes de que este proceso libere.
  const deOtro = JSON.stringify({ pid: r.contenido.pid, hostname: r.contenido.hostname, creado: "2031-05-05T05:05:05.000Z" })
  writeFileSync(ruta, deOtro)
  candado.liberarCandadoSiPropio(ruta, r.contenido)
  // Primero que EXISTA, como aserción: leer un archivo borrado tira ENOENT, y un test que
  // se pone rojo por una excepción no está afirmando la propiedad (lo mostró la mutación).
  assert.equal(existsSync(ruta), true, "borró el candado de otro dueño")
  assert.equal(readFileSync(ruta, "utf8"), deOtro, "tocó el candado de otro dueño")

  for (const ajeno of [{ ...r.contenido, pid: r.contenido.pid + 1 }, { ...r.contenido, hostname: "otra" }]) {
    writeFileSync(ruta, JSON.stringify(ajeno))
    candado.liberarCandadoSiPropio(ruta, r.contenido)
    assert.equal(existsSync(ruta), true)
  }

  writeFileSync(ruta, JSON.stringify(r.contenido))
  candado.liberarCandadoSiPropio(ruta, r.contenido)
  assert.equal(existsSync(ruta), false, "el propio sí se borra")
  // Y liberar algo que ya no está no tira.
  candado.liberarCandadoSiPropio(ruta, r.contenido)
})

test("liberarCandadoSiPropio: un candado ilegible tampoco se borra", () => {
  const ruta = nuevaRuta()
  const r = candado.tomarCandado(ruta)
  writeFileSync(ruta, "")
  candado.liberarCandadoSiPropio(ruta, r.contenido)
  assert.equal(existsSync(ruta), true, "borró un candado que no podía leer")
  assert.equal(readFileSync(ruta, "utf8"), "")
})

test("estaVivo: este proceso sí; uno que ya terminó, no", async () => {
  assert.equal(candado.estaVivo(process.pid), true)
  assert.equal(candado.estaVivo(await pidMuerto()), false)
})

test("leerCandado: devuelve el dueño, o null si no existe o no se puede interpretar", () => {
  const ruta = nuevaRuta()
  assert.equal(candado.leerCandado(ruta), null)
  const r = candado.tomarCandado(ruta)
  assert.deepEqual(candado.leerCandado(ruta), r.contenido)
  writeFileSync(ruta, '{"pid":1}')
  assert.equal(candado.leerCandado(ruta), null)
})
