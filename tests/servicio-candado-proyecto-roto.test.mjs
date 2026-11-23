// Si el proyecto no se puede cargar, el candado no queda tomado.
//
// EL DEFECTO (auditoría de código del 2026-11-22, VIS-02; reproducido por QA).
// `obtenerServicioDeProyectoConVista` toma el candado del proyecto y RECIÉN DESPUÉS
// construye el servicio. Si construirlo fallaba —el archivo del proyecto cortado, o un
// JSON válido con la forma mal— tiraba el error correcto la primera vez, pero dejaba
// `<id>.lock` con el pid del propio proceso y no registraba nada. Desde la segunda
// llamada, `proyecto-fisico`, `vista-fisica` y `programa` contestaban:
//
//   «el proyecto "activo" … ya está abierto en otro proceso (pid <el propio>) —
//    cerralo ahí antes de abrirlo acá»
//
// Mandaba a buscar una segunda ventana que no existe y tapaba la causa real. Arreglar o
// borrar el archivo no alcanzaba: quedaba bloqueado hasta cerrar OpenCode. El defecto ya
// estaba nombrado en un comentario de `opencode/carga/puertos.ts` («defecto H-01 de
// servicio-con-vista.ts»), sin arreglar.
//
// CAPA PROTEGIDA. `opencode/servidor/` es capa protegida en los documentos de esta línea
// (tocarla pide decisión humana). El owner la habilitó el 2026-11-22 para este arreglo y
// nada más: son las líneas que sueltan el candado cuando la construcción falla.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - sacar el `liberarCandadoSiPropio` del catch            → rojos los tres
//   - sacar el try/catch entero (volver al defecto)          → rojos los tres
//   - tragarse el error en vez de volver a tirarlo           → rojos los tres
//   - soltar el candado también cuando SÍ se construyó       → rojos los dos primeros (el contrapeso)
//
// LO QUE NINGÚN TEST DISTINGUE: sacar sólo el `candadosPropios.delete(clave)` del catch.
// Esa entrada sirve para soltar el candado al salir del proceso, y `liberarCandadoSiPropio`
// sólo borra un candado cuyo contenido coincide con el anotado: con la entrada vieja de más,
// no borra nada que no deba. Se deja el `delete` por prolijidad, no porque un test lo exija.
//
// Corre con: node --test tests/servicio-candado-proyecto-roto.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default

const ROTOS = [
  ["un JSON cortado", '{ "id": "x", "placa": '],
  ["un JSON válido con la forma mal", "{}"],
]

for (const [que, contenido] of ROTOS) {
  test(`con ${que}: el error es el del archivo, el candado se suelta, y al arreglarlo se abre`, () => {
    const dir = nuevoDir("candado-roto")
    const id = nuevoIdProyecto("roto")
    const archivo = join(dir, `${id}.json`)
    const lock = join(dir, `${id}.lock`)
    writeFileSync(archivo, contenido)

    // Primera llamada: falla por el archivo…
    assert.throws(() => obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id }), (e) => {
      assert.doesNotMatch(String(e?.message ?? e), /ya está abierto en otro proceso/, "la primera falla ya habla de otro proceso")
      return true
    })
    // …y NO deja el candado.
    assert.ok(!existsSync(lock), `quedó ${id}.lock con el pid de este proceso: ${existsSync(lock) ? readFileSync(lock, "utf8") : ""}`)

    // Segunda llamada con el archivo todavía roto: el MISMO error, no «otro proceso».
    assert.throws(() => obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id }), (e) => {
      assert.doesNotMatch(String(e?.message ?? e), /ya está abierto en otro proceso/, `la segunda vez tapó la causa real con «otro proceso»: ${e?.message}`)
      return true
    })
    assert.ok(!existsSync(lock), "la segunda falla dejó el candado")

    // Se arregla (se borra el archivo roto): ahora abre, en la misma sesión.
    rmSync(archivo)
    const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
    try {
      assert.equal(servicio.snapshot().revision, 0, "abrió, pero no es un proyecto nuevo")
      assert.ok(existsSync(lock), "con el proyecto abierto el candado SÍ tiene que estar (contrapeso)")
    } finally {
      servicio.cerrar()
    }
    assert.ok(!existsSync(lock), "cerrar no soltó el candado")
  })
}

test("por la tool proyecto-fisico: con el proyecto roto nunca dice «ya está abierto en otro proceso»", async () => {
  const dirActivo = nuevoDir("candado-roto-tool")
  const id = nuevoIdProyecto("rototool")
  const dirDatos = directorioDeDatos(dirActivo)
  const archivo = join(dirDatos, `${id}.json`)
  // La carpeta de datos la crea el servicio; acá se arma a mano para dejar el archivo roto.
  const { mkdirSync } = await import("node:fs")
  mkdirSync(dirDatos, { recursive: true })
  writeFileSync(archivo, '{ "roto": ')

  const leer = async () => proyectoFisico.execute({ accion: "leer", idProyecto: id }, { directory: dirActivo })
  const primera = await leer()
  const segunda = await leer()
  for (const [cual, r] of [["primera", primera], ["segunda", segunda]]) {
    assert.doesNotMatch(r, /ya está abierto en otro proceso/, `la ${cual} llamada manda a cerrar otra ventana que no existe:\n${r.slice(0, 400)}`)
  }
  assert.ok(!existsSync(join(dirDatos, `${id}.lock`)), "quedó el candado tomado por este proceso")

  rmSync(archivo)
  const tercera = await leer()
  assert.doesNotMatch(tercera, /ya está abierto en otro proceso/, tercera.slice(0, 400))
  const leido = JSON.parse(tercera)
  assert.match(leido.resultado, /SÓLO LECTURA/, `arreglado el archivo, la tool tiene que leer:\n${tercera.slice(0, 400)}`)
  assert.equal(leido.revision, 0)
  // Y las dos primeras dijeron la causa real, no un bloqueo.
  for (const r of [primera, segunda]) assert.match(r, /DOCUMENTO_MALFORMADO/, `no dice por qué no pudo abrir:\n${r.slice(0, 400)}`)
  obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto: id }).cerrar()
})
