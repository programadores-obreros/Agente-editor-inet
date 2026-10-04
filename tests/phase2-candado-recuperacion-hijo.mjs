// Hijo de proceso real para el test de DR-54 en tests/phase2-candado-atomicidad.test.mjs.
// Dos papeles, elegidos por argv[2]:
//
//   "a": toma el candado completo (sin ganchos), escribe su resultado en el centinela
//        $CENTINELA y se queda vivo, dueño, hasta recibir CERRAR por stdin.
//   "b": abre el servicio con un gancho de test sobre `fs.readFileSync`. La PRIMERA vez
//        que lee el candado (la lectura con la que decide "vencido"), y antes de
//        devolver ese contenido, lanza al hijo "a" y espera su centinela. Así se fuerza,
//        sin depender del scheduler, el orden de DR-54: B ya leyó el candado vencido S,
//        A recupera S y queda dueño, y recién ahí B sigue con su decisión.
//
// El gancho usa `module.syncBuiltinESMExports()`, que actualiza los imports nombrados
// de `node:fs` que ya tomó `servicio-con-vista.ts`. Es sólo de test: producción no
// tiene ningún punto de entrada para esto.
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const { REPO_OBJ, DIR, ID } = process.env
const papel = process.argv[2]
const { obtenerServicioDeProyectoConVista } = await import(join(REPO_OBJ, "opencode/servidor/servicio-con-vista.ts"))

function abrir() {
  try {
    return { servicio: obtenerServicioDeProyectoConVista({ directorio: DIR, idProyecto: ID }), resultado: { abrio: true } }
  } catch (error) {
    return { servicio: null, resultado: { abrio: false, mensaje: error.message } }
  }
}

if (papel === "a") {
  const { servicio, resultado } = abrir()
  fs.writeFileSync(process.env.CENTINELA, JSON.stringify(resultado))
  if (servicio) {
    await new Promise((listo) => process.stdin.once("data", listo)) // CERRAR
    servicio.cerrar()
  }
  process.exit(0)
}

// papel "b"
const rutaLock = join(fs.realpathSync(DIR), `${ID}.lock`)
const centinela = join(DIR, "centinela-a.json")
let hijoA = null
const leerReal = fs.readFileSync
fs.readFileSync = function (ruta, ...resto) {
  const datos = leerReal.call(this, ruta, ...resto)
  if (hijoA === null && String(ruta) === rutaLock) {
    hijoA = spawn(process.execPath, [fileURLToPath(import.meta.url), "a"], { env: { ...process.env, CENTINELA: centinela }, stdio: ["pipe", "inherit", "inherit"] })
    const espera = new Int32Array(new SharedArrayBuffer(4))
    while (!fs.existsSync(centinela)) Atomics.wait(espera, 0, 0, 10) // espera el centinela que escribe A, no un tiempo fijo
  }
  return datos
}
syncBuiltinESMExports()
const { servicio, resultado } = abrir()
fs.readFileSync = leerReal
syncBuiltinESMExports()

const resultadoA = hijoA ? JSON.parse(leerReal(centinela, "utf8")) : null
const candadoFinal = fs.existsSync(rutaLock) ? JSON.parse(leerReal(rutaLock, "utf8")) : null
console.log(JSON.stringify({ a: resultadoA, b: resultado, pidA: hijoA?.pid ?? null, pidB: process.pid, candadoFinal }))
if (hijoA) {
  hijoA.stdin.write("CERRAR\n")
  await new Promise((listo) => hijoA.on("close", listo))
}
if (servicio) servicio.cerrar()
process.exit(0)
