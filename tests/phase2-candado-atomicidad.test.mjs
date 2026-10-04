// DR-53 (Engineering Baseline 2026, encontrado investigando el flaky G-10 de H5):
// el candado de proceso de `opencode/servidor/servicio-con-vista.ts` podía terminar con
// DOS dueños.
//
// POR QUÉ ERA HUECO. `tomarCandado` creaba el archivo con `openSync(ruta, "wx")` (eso
// sí es exclusivo) pero escribía el JSON DESPUÉS, con `writeSync`. Entre esas dos
// llamadas el candado existe y está VACÍO. Un segundo proceso que llegaba justo ahí
// recibía `EEXIST`, leía un archivo vacío, `JSON.parse` fallaba, `leerCandado`
// devolvía `null` ("corrupto") y el código lo "recuperaba" pisándolo con `"w"`. Los dos
// procesos quedaban convencidos de ser dueños. Se vio 1 vez en 80 corridas de H5 bajo
// carga: `abrio:true` en los dos hijos, y sólo el CAS de `almacen.ts` atajó el segundo
// commit.
//
// El contrato que fijan estos tests: un candado que EXISTE pero no se puede
// interpretar (vacío, cortado, JSON sin los campos del dueño) NO es prueba de que esté
// libre. Puede ser un dueño vivo a mitad de publicar. La duda no da permiso para
// pisarlo: se rechaza la apertura con un mensaje claro y el archivo queda intacto.
//
// Son deterministas: no dependen del scheduler. Plantan a mano el estado exacto que
// veía el competidor (lo mismo que hizo la demostración de G-10) y miran qué hace
// `obtenerServicioDeProyectoConVista`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))

const NO_INTERPRETABLES = [
  ["vacío (un dueño vivo entre crear el archivo y escribirlo)", ""],
  ["JSON cortado a mitad de escritura", '{"pid":12'],
  ["JSON válido sin los campos del dueño", '{"otra":"cosa"}'],
]

for (const [descripcion, contenido] of NO_INTERPRETABLES) {
  test(`DR-53: un candado existente pero no interpretable (${descripcion}) NO se pisa: la apertura se rechaza y el archivo queda intacto`, () => {
    const dir = nuevoDir("dr53-no-interpretable")
    const id = nuevoIdProyecto()
    const rutaLock = join(dir, `${id}.lock`)
    writeFileSync(rutaLock, contenido)

    assert.throws(
      () => obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id }),
      (error) => {
        assert.match(error.message, /candado/i, "el mensaje tiene que nombrar el candado")
        assert.ok(error.message.includes(rutaLock), "el mensaje tiene que dar la ruta del candado, para poder revisarlo a mano")
        return true
      },
      "un candado que no se puede leer no prueba que esté libre: abrir igual es exactamente el doble dueño de DR-53",
    )
    assert.equal(readFileSync(rutaLock, "utf8"), contenido, "el candado de otro (o uno a mitad de publicar) no se toca")
  })
}

test("DR-53: al tomar el candado nunca queda a la vista un archivo a medias, y no deja temporales", () => {
  const dir = nuevoDir("dr53-publicacion")
  const id = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  try {
    const contenido = JSON.parse(readFileSync(join(dir, `${id}.lock`), "utf8"))
    assert.equal(contenido.pid, process.pid)
    assert.equal(typeof contenido.hostname, "string")
    assert.equal(typeof contenido.creado, "string")
    const sobrantes = readdirSync(dir).filter((f) => f.includes(".lock") && f !== `${id}.lock`)
    assert.deepEqual(sobrantes, [], "la publicación del candado no deja archivos temporales en el directorio")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// DR-54: recuperar un candado VENCIDO también tiene que tener un solo ganador
// ════════════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ERA HUECO. Con un candado válido de un dueño muerto (S), la recuperación
// hacía `rename(temporal, candado)`: atómico, pero SIN condición. No verificaba que el
// candado siguiera siendo S. Si B leía S, A recuperaba S y quedaba dueño, y después B
// seguía con su decisión ("S está vencido"), el rename de B pisaba el candado VIVO de
// A. Los dos procesos recibían "abriste". Demostrado de forma determinista (3/3) con el
// hijo `phase2-candado-recuperacion-hijo.mjs`, que fuerza ese orden con un centinela.

const HIJO_RECUPERACION = join(dirname(fileURLToPath(import.meta.url)), "phase2-candado-recuperacion-hijo.mjs")

function pidMuerto() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", "process.exit(0)"])
    proc.on("exit", () => resolve(proc.pid))
    proc.on("error", reject)
  })
}

async function plantarCandadoVencido(dir, id) {
  const ruta = join(dir, `${id}.lock`)
  writeFileSync(ruta, JSON.stringify({ pid: await pidMuerto(), hostname: hostname(), creado: new Date(0).toISOString() }))
  return ruta
}

test("DR-54: dos procesos que recuperan el MISMO candado vencido, intercalados — gana exactamente uno y el dueño vivo no se pisa", async () => {
  const dir = nuevoDir("dr54-recuperacion")
  const id = nuevoIdProyecto()
  await plantarCandadoVencido(dir, id)

  const salida = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [HIJO_RECUPERACION, "b"], { env: { ...process.env, REPO_OBJ: REPO, DIR: dir, ID: id }, stdio: ["ignore", "pipe", "inherit"] })
    let texto = ""
    proc.stdout.on("data", (d) => (texto += d))
    proc.on("close", (codigo) => (codigo === 0 ? resolve(texto) : reject(new Error(`el hijo B terminó con código ${codigo}: ${texto}`))))
    proc.on("error", reject)
  })
  const r = JSON.parse(salida.trim().split("\n").pop())

  assert.ok(r.a, "fixture: B tiene que haber leído el candado y lanzado a A")
  assert.equal(r.a.abrio, true, `A recupera el candado vencido y queda dueño: ${JSON.stringify(r)}`)
  assert.equal(r.b.abrio, false, `B ya había leído S, pero cuando sigue S ya no está: NO puede abrir. Resultado: ${JSON.stringify(r)}`)
  assert.match(r.b.mensaje, /candado|otro proceso/i)
  assert.equal(r.candadoFinal?.pid, r.pidA, "el candado que queda es el del dueño vivo (A), no el que pisó B")
})

test("DR-54: si otro proceso está recuperando el candado (reclamo presente), la recuperación se rechaza y nada se toca", async () => {
  const dir = nuevoDir("dr54-reclamo")
  const id = nuevoIdProyecto()
  const rutaLock = await plantarCandadoVencido(dir, id)
  const vencido = readFileSync(rutaLock, "utf8")
  const rutaReclamo = `${rutaLock}.recuperando`
  const reclamo = JSON.stringify({ pid: process.pid, hostname: hostname(), creado: new Date().toISOString() })
  writeFileSync(rutaReclamo, reclamo)

  assert.throws(
    () => obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id }),
    (error) => {
      assert.match(error.message, /recuper/i)
      assert.ok(error.message.includes(rutaReclamo), "el mensaje da la ruta del reclamo, para poder revisarlo a mano")
      return true
    },
  )
  assert.equal(readFileSync(rutaLock, "utf8"), vencido, "el candado vencido queda como estaba")
  assert.equal(readFileSync(rutaReclamo, "utf8"), reclamo, "el reclamo de otro no se toca")
})
