// Subir y traer la memoria: `opencode/plataforma/sincronizar.ts` y `memoria-local.ts`.
//
// La plataforma es un servidor HTTP de verdad en esta compu que cumple el contrato
// de `/memoria` (versión, 404 sin-memoria, 409 conflicto). El disco es real: la
// sesión, el perfil y `tecnia-memoria.md` viven en una carpeta temporal.
//
// LO QUE ESTE ARCHIVO PROTEGE, en orden de gravedad:
//   1. que nunca se pise una memoria sin que el docente haya visto las dos;
//   2. que una memoria vacía no pise a una que tiene algo;
//   3. que «guardé» y «traje» sólo se digan cuando pasó.
// Por eso casi todos los casos miran DOS cosas: lo que dice el mensaje y lo que
// quedó de verdad en la plataforma y en el disco. Un caso que mirara sólo el
// mensaje se pondría verde con un tool que dice «no cambié nada» y cambia.
//
// La compatibilidad con el tool `memoria` (que el archivo que escribe uno lo lea
// el otro) está al final: es lo que impide que las dos copias del formato se separen.

import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { crearSincronizador } = await import("../opencode/plataforma/sincronizar.ts")
const { crearCuenta } = await import("../opencode/plataforma/cuenta.ts")
const localMod = await import("../opencode/plataforma/memoria-local.ts")
const { guardarSesionLocal } = await import("../opencode/plataforma/sesion-local.ts")

const TOKEN = "T".repeat(43)

/** Estado de la plataforma simulada. `null` = la cuenta no tiene memoria. */
let enCuenta = null
let pedidos = []
/** Si se setea, corre justo antes de atender el próximo PUT (para simular otra compu). */
let antesDelPut = null
let responderCon = null

let servidor
let api
let raiz
let carpeta

before(async () => {
  servidor = createServer((req, res) => {
    let cuerpo = ""
    req.on("data", (d) => (cuerpo += d))
    req.on("end", () => {
      pedidos.push(`${req.method} ${req.url}`)
      const json = (estado, objeto) => {
        res.writeHead(estado, { "content-type": "application/json" })
        res.end(JSON.stringify(objeto))
      }
      if (responderCon) return json(...responderCon)
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "sesion-invalida" })
      if (req.url !== "/memoria") return json(404, { error: "ruta-desconocida" })
      if (req.method === "GET") {
        if (!enCuenta) return json(404, { error: "sin-memoria" })
        return json(200, { esquema: enCuenta.esquema ?? 1, memoria: enCuenta.memoria, version: enCuenta.version })
      }
      if (req.method === "PUT") {
        if (antesDelPut) {
          antesDelPut()
          antesDelPut = null
        }
        const pedido = JSON.parse(cuerpo)
        const actual = enCuenta ? enCuenta.version : 0
        if (pedido.versionAnterior !== actual) return json(409, { error: "conflicto", version: actual })
        enCuenta = { memoria: pedido.memoria, version: actual + 1 }
        return json(200, { version: actual + 1 })
      }
      return json(405, { error: "metodo-no-permitido" })
    })
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  api = `http://127.0.0.1:${servidor.address().port}`
  raiz = mkdtempSync(join(tmpdir(), "tecnia-sincronizar-"))
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  rmSync(raiz, { recursive: true, force: true })
})

beforeEach(() => {
  enCuenta = null
  pedidos = []
  antesDelPut = null
  responderCon = null
  carpeta = mkdtempSync(join(raiz, "compu-"))
  guardarSesionLocal({ token: TOKEN, cuenta: { nombre: "Ana", email: "ana@escuela.test" }, base: api }, carpeta)
})

const sincronizador = () => crearSincronizador({ fetch, api, carpeta })
const archivo = () => join(carpeta, "tecnia-memoria.md")
const enCompu = () => localMod.leerMemoriaLocal(carpeta)
const ponerEnCompu = (memoria) => assert.equal(localMod.escribirMemoriaLocal(carpeta, memoria).estado, "escrita")
const puts = () => pedidos.filter((p) => p.startsWith("PUT")).length

const SEMAFORO = { nivel: "intermedio", proyectos: ["Semáforo"], enCurso: "Sensor DHT11 — paso 2" }
const DADO = { proyectos: ["Dado", "Alarma"] }

// ─── subir ──────────────────────────────────────────────────────────────────

test("subir: cuenta sin memoria → la crea, y lo dice porque la plataforma lo confirmó", async () => {
  ponerEnCompu(SEMAFORO)
  const r = await sincronizador().subir(false)
  assert.match(r, /Guardé en la cuenta/)
  assert.deepEqual(enCuenta, { memoria: SEMAFORO, version: 1 })
})

test("subir: compu sin progreso → no sube nada y NO toca la memoria de la cuenta, ni con reemplazar", async () => {
  enCuenta = { memoria: DADO, version: 3 }
  for (const reemplazar of [false, true]) {
    const r = await sincronizador().subir(reemplazar)
    assert.match(r, /no hay nada para subir/)
    assert.deepEqual(enCuenta, { memoria: DADO, version: 3 })
  }
  assert.deepEqual(pedidos, [], "sin nada para subir no hace falta hablarle a la plataforma")
})

test("subir: la cuenta ya tiene lo mismo → no escribe", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: SEMAFORO, version: 4 }
  const r = await sincronizador().subir(false)
  assert.match(r, /ya tiene la misma memoria/)
  assert.equal(puts(), 0)
  assert.equal(enCuenta.version, 4)
})

test("subir: memorias distintas → la primera llamada muestra las dos y NO cambia nada", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const r = await sincronizador().subir(false)
  assert.match(r, /memorias DISTINTAS/)
  assert.match(r, /En la cuenta:[\s\S]*Dado, Alarma[\s\S]*En esta compu:[\s\S]*Semáforo/)
  assert.equal(puts(), 0)
  assert.deepEqual(enCuenta, { memoria: DADO, version: 2 })
})

test("subir: reemplazar en la PRIMERA llamada no pisa (el docente todavía no vio nada)", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const r = await sincronizador().subir(true)
  assert.match(r, /memorias DISTINTAS/)
  assert.equal(puts(), 0)
  assert.deepEqual(enCuenta, { memoria: DADO, version: 2 })
})

test("subir: mostrar y después reemplazar → pisa la de la cuenta", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.subir(false)
  const r = await s.subir(true)
  assert.match(r, /Guardé en la cuenta/)
  assert.deepEqual(enCuenta, { memoria: SEMAFORO, version: 3 })
})

test("subir: si la cuenta cambió entre que se mostró y el reemplazar, NO pisa y vuelve a mostrar", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.subir(false)
  const otra = { proyectos: ["Riego"] }
  enCuenta = { memoria: otra, version: 3 } // otra compu guardó en el medio
  const r = await s.subir(true)
  assert.match(r, /cambió desde la última vez/)
  assert.match(r, /Riego/)
  assert.equal(puts(), 0)
  assert.deepEqual(enCuenta, { memoria: otra, version: 3 })
  // Y ahora que vio la nueva, sí puede reemplazar.
  assert.match(await s.subir(true), /Guardé en la cuenta/)
  assert.deepEqual(enCuenta, { memoria: SEMAFORO, version: 4 })
})

test("subir: si la COMPU cambió entre que se mostró y el reemplazar, tampoco pisa", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.subir(false)
  ponerEnCompu({ proyectos: ["Semáforo", "Otro"] })
  const r = await s.subir(true)
  assert.match(r, /cambió desde la última vez/)
  assert.equal(puts(), 0)
})

test("subir: lo mostrado para 'traer' no autoriza a pisar con 'subir'", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.traer(false)
  await s.subir(true)
  assert.equal(puts(), 0)
  assert.deepEqual(enCuenta, { memoria: DADO, version: 2 })
})

test("subir: otra compu guarda JUSTO durante el guardado → no pisa y no dice que guardó", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.subir(false)
  const otra = { proyectos: ["Riego"] }
  antesDelPut = () => (enCuenta = { memoria: otra, version: 3 })
  const r = await s.subir(true)
  assert.doesNotMatch(r, /Guardé/)
  assert.match(r, /NO la pisé/)
  assert.deepEqual(enCuenta, { memoria: otra, version: 3 })
})

test("subir: un proyecto que no entra en la cuenta → lo dice y no manda nada", async () => {
  ponerEnCompu({ proyectos: ["x".repeat(201)] })
  const r = await sincronizador().subir(false)
  assert.match(r, /no entra en la cuenta/)
  assert.match(r, /lista de proyectos/)
  assert.deepEqual(pedidos, [])
})

test("subir: la plataforma no contesta bien → no dice que guardó", async () => {
  ponerEnCompu(SEMAFORO)
  responderCon = [500, { error: "interno" }]
  const r = await sincronizador().subir(false)
  assert.doesNotMatch(r, /Guardé/)
  assert.match(r, /No subí nada/)
})

test("subir: la cuenta tiene un formato más nuevo → no lo pisa", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { esquema: 2, memoria: { proyectos: [], algoNuevo: true }, version: 5 }
  const s = sincronizador()
  for (const reemplazar of [false, true]) {
    assert.match(await s.subir(reemplazar), /formato más nuevo/)
  }
  assert.equal(puts(), 0)
})

test("subir: repetir SIN reemplazar no pisa nunca, aunque ya se hayan mostrado las dos", async () => {
  // Hueco que encontró la mutación: sin este caso, un 'subir' que pisara en la
  // segunda llamada sin que nadie pidiera reemplazar quedaba verde.
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const s = sincronizador()
  await s.subir(false)
  assert.match(await s.subir(false), /memorias DISTINTAS/)
  assert.equal(puts(), 0)
  assert.deepEqual(enCuenta, { memoria: DADO, version: 2 })
})

test("subir: si sólo cambia el nivel, o sólo lo que está en curso, ya son DISTINTAS", async () => {
  // Otro hueco de la mutación: «iguales» miraba de verdad sólo la lista de proyectos.
  enCuenta = { memoria: SEMAFORO, version: 1 }
  for (const distinta of [{ ...SEMAFORO, nivel: "avanzado" }, { ...SEMAFORO, enCurso: "Sensor DHT11 — paso 3" }]) {
    ponerEnCompu(distinta)
    assert.match(await sincronizador().subir(false), /memorias DISTINTAS/)
  }
  assert.equal(puts(), 0)
})

// ─── traer ──────────────────────────────────────────────────────────────────

test("traer: compu sin progreso → deja la de la cuenta, y lo dice porque la releyó", async () => {
  enCuenta = { memoria: SEMAFORO, version: 1 }
  const r = await sincronizador().traer(false)
  assert.match(r, /Traje a esta compu/)
  assert.deepEqual(enCompu(), { estado: "ok", memoria: SEMAFORO })
  assert.equal(puts(), 0, "traer nunca escribe en la cuenta")
})

test("traer: cuenta sin memoria → no toca la de la compu, ni con reemplazar", async () => {
  ponerEnCompu(DADO)
  const antes = readFileSync(archivo(), "utf8")
  for (const reemplazar of [false, true]) {
    assert.match(await sincronizador().traer(reemplazar), /no hay nada para traer/)
    assert.equal(readFileSync(archivo(), "utf8"), antes)
  }
})

test("traer: memorias distintas → muestra las dos y NO toca el archivo, ni con reemplazar en la primera llamada", async () => {
  ponerEnCompu(DADO)
  enCuenta = { memoria: SEMAFORO, version: 1 }
  const antes = readFileSync(archivo(), "utf8")
  for (const reemplazar of [false, true]) {
    const r = await sincronizador().traer(reemplazar) // sincronizador nuevo cada vez: nunca mostró nada
    assert.match(r, /memorias DISTINTAS/)
    assert.equal(readFileSync(archivo(), "utf8"), antes)
  }
})

test("traer: mostrar y después reemplazar → pisa la de la compu", async () => {
  ponerEnCompu(DADO)
  enCuenta = { memoria: SEMAFORO, version: 1 }
  const s = sincronizador()
  await s.traer(false)
  assert.match(await s.traer(true), /Traje a esta compu/)
  assert.deepEqual(enCompu(), { estado: "ok", memoria: SEMAFORO })
})

test("traer: repetir SIN reemplazar no pisa nunca, aunque ya se hayan mostrado las dos", async () => {
  ponerEnCompu(DADO)
  enCuenta = { memoria: SEMAFORO, version: 1 }
  const s = sincronizador()
  await s.traer(false)
  assert.match(await s.traer(false), /memorias DISTINTAS/)
  assert.deepEqual(enCompu(), { estado: "ok", memoria: DADO })
})

test("traer: si la cuenta cambió entre que se mostró y el reemplazar, NO pisa", async () => {
  ponerEnCompu(DADO)
  enCuenta = { memoria: SEMAFORO, version: 1 }
  const s = sincronizador()
  await s.traer(false)
  enCuenta = { memoria: { proyectos: ["Riego"] }, version: 2 }
  const r = await s.traer(true)
  assert.match(r, /cambió desde la última vez/)
  assert.deepEqual(enCompu(), { estado: "ok", memoria: DADO })
})

test("traer: ya son iguales → no escribe el archivo", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: SEMAFORO, version: 1 }
  writeFileSync(archivo(), readFileSync(archivo(), "utf8") + "<!-- marca -->\n")
  assert.match(await sincronizador().traer(false), /ya tiene la misma memoria/)
  assert.match(readFileSync(archivo(), "utf8"), /marca/, "reescribió el archivo sin necesidad")
})

test("traer: un proyecto con coma no se puede guardar igual en el archivo → NO dice que trajo", async () => {
  // El archivo separa los proyectos con comas: «Luz, cámara» se relee como dos.
  enCuenta = { memoria: { proyectos: ["Luz, cámara"] }, version: 1 }
  const r = await sincronizador().traer(false)
  assert.doesNotMatch(r, /Traje/)
  assert.match(r, /No toqué la memoria de esta compu/)
  assert.match(r, /coma/)
  assert.equal(existsSync(archivo()), false, "la compu no tenía memoria y ahora tiene un archivo con el proyecto partido")
})

// TCH-06 (auditoría del 2026-11-22). El test de arriba sólo probaba la compu SIN memoria
// previa, y ahí no se ve el daño: con una memoria ya guardada, `traer` con reemplazar la
// pisaba, la releía, veía que no coincidía y RECIÉN ENTONCES avisaba. El mensaje no mentía,
// pero la memoria anterior ya se había perdido, sin copia. Ahora se comprueba antes.
// Mutaciones que lo ponen rojo: sacar la comprobación previa de escribirMemoriaLocal; que
// la comprobación previa compare contra otra cosa que la memoria pedida.
test("traer: si la memoria de la cuenta no entra igual, la que había en la compu NO se toca", async () => {
  for (const proyectos of [["LED, botón y zumbador"], ["Semáforo", "Riego, con bomba"], ["Alarma\ncon salto"]]) {
    ponerEnCompu(SEMAFORO)
    const antes = readFileSync(archivo(), "utf8")
    enCuenta = { memoria: { nivel: "avanzado", proyectos }, version: 7 }
    await sincronizador().traer(false) // primero muestra las dos
    const s = sincronizador()
    await s.traer(false)
    const r = await s.traer(true)
    assert.doesNotMatch(r, /Traje/, r)
    assert.match(r, /No toqué la memoria de esta compu/, r)
    assert.equal(readFileSync(archivo(), "utf8"), antes, `con ${JSON.stringify(proyectos)} en la cuenta se pisó la memoria de la compu`)
    assert.deepEqual(readdirSync(dirname(archivo())).filter((f) => f.endsWith(".tmp")), [], "quedó un temporal")
  }
})

test("traer: el contrapeso — una memoria sin comas en los nombres se trae como siempre", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: { nivel: "avanzado", proyectos: ["LED y botón", "Riego con bomba"], enCurso: "Alarma, paso 2" }, version: 7 }
  const s = sincronizador()
  await s.traer(false)
  const r = await s.traer(true)
  assert.match(r, /Traje a esta compu/, r)
  // «En curso» tiene renglón propio: ahí la coma no rompe nada.
  assert.match(readFileSync(archivo(), "utf8"), /^- En curso: Alarma, paso 2$/m)
})

test("traer: la plataforma no contesta → no toca la compu", async () => {
  ponerEnCompu(DADO)
  const antes = readFileSync(archivo(), "utf8")
  responderCon = [500, { error: "interno" }]
  assert.match(await sincronizador().traer(true), /No toqué la memoria de esta compu/)
  assert.equal(readFileSync(archivo(), "utf8"), antes)
})

// ─── cuándo no se sincroniza ────────────────────────────────────────────────

// TCH-04 (auditoría del 2026-11-22): `=== "aula"` exacto, con un perfil que se edita a
// mano. Mutación: `normalizarModo(...)` → sin normalizar.
for (const modo of ["Aula", "AULA", "aula (compartida)"]) {
  test(`«- Modo: ${modo}» escrito a mano también es modo aula: no sube ni trae`, async () => {
    ponerEnCompu(SEMAFORO)
    enCuenta = { memoria: DADO, version: 1 }
    writeFileSync(join(carpeta, "tecnia-perfil.md"), `# Perfil\n\n- Modo: ${modo}\n`)
    const s = sincronizador()
    assert.match(await s.subir(false), /modo aula/)
    assert.match(await s.traer(false), /modo aula/)
    assert.deepEqual(pedidos, [])
  })
}

// Las tres lecturas del modo (perfil.ts, cuenta.ts y sincronizar.ts) son copias: los
// tools no se importan entre sí. Si una se separa, el modo aula vale en un lado y no en
// otro. Mutación: cambiar una letra de `normalizarModo` en cualquiera de los tres.
test("normalizarModo es la misma, letra por letra, en perfil.ts, cuenta.ts y sincronizar.ts", () => {
  const cuerpo = (ruta) => {
    const m = [...readFileSync(join(REPO, ruta), "utf8").matchAll(/^(?:export )?function normalizarModo\(crudo: string\): string \{\n([\s\S]*?)\n\}$/gm)]
    assert.equal(m.length, 1, `${ruta}: esperaba una sola normalizarModo y hay ${m.length}`)
    return m[0][1]
  }
  const dePerfil = cuerpo("opencode/tool/perfil.ts")
  assert.match(dePerfil, /aula\|grupo\|personal/)
  assert.equal(cuerpo("opencode/plataforma/cuenta.ts"), dePerfil, "cuenta.ts normaliza el modo distinto que perfil.ts")
  assert.equal(cuerpo("opencode/plataforma/sincronizar.ts"), dePerfil, "sincronizar.ts normaliza el modo distinto que perfil.ts")
})

test("modo aula: no sube ni trae, y no le habla a la plataforma", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 1 }
  writeFileSync(join(carpeta, "tecnia-perfil.md"), "# Perfil\n\n- Modo: aula\n")
  const s = sincronizador()
  assert.match(await s.subir(false), /modo aula/)
  assert.match(await s.traer(false), /modo aula/)
  assert.deepEqual(pedidos, [])
  assert.deepEqual(enCompu(), { estado: "ok", memoria: SEMAFORO })
})

test("sin cuenta vinculada: lo dice y no hace nada", async () => {
  rmSync(join(carpeta, "tecnia-sesion.json"))
  ponerEnCompu(SEMAFORO)
  const s = sincronizador()
  assert.match(await s.subir(false), /No hay ninguna cuenta/)
  assert.match(await s.traer(false), /No hay ninguna cuenta/)
  assert.deepEqual(pedidos, [])
})

test("una sesión de otra dirección no se usa: el token no sale hacia esta plataforma", async () => {
  guardarSesionLocal({ token: TOKEN, cuenta: { nombre: "Ana", email: "ana@escuela.test" }, base: "https://otra.test" }, carpeta)
  ponerEnCompu(SEMAFORO)
  assert.match(await sincronizador().subir(false), /no se puede usar/)
  assert.deepEqual(pedidos, [])
})

test("la plataforma ya no reconoce la sesión: lo dice, sin token en el mensaje", async () => {
  guardarSesionLocal({ token: "V".repeat(43), cuenta: { nombre: "Ana", email: "ana@escuela.test" }, base: api }, carpeta)
  ponerEnCompu(SEMAFORO)
  const r = await sincronizador().subir(false)
  assert.match(r, /no reconoce la sesión/)
  assert.ok(!r.includes("V".repeat(43)))
})

test("por la cuenta: 'subir' y 'traer' llegan al sincronizador y 'reemplazar' se respeta", async () => {
  ponerEnCompu(SEMAFORO)
  enCuenta = { memoria: DADO, version: 2 }
  const cuenta = crearCuenta({ fetch, api, web: api, carpeta, etiqueta: "test", abrirNavegador: () => false })
  assert.match(await cuenta.ejecutar("subir"), /memorias DISTINTAS/)
  // Dos veces sin `reemplazar`: si la cuenta lo mandara siempre en true, acá ya pisaba.
  assert.match(await cuenta.ejecutar("subir"), /memorias DISTINTAS/)
  assert.match(await cuenta.ejecutar("subir", {}), /memorias DISTINTAS/)
  assert.equal(puts(), 0)
  assert.match(await cuenta.ejecutar("subir", { reemplazar: true }), /Guardé en la cuenta/)
  assert.deepEqual(enCuenta, { memoria: SEMAFORO, version: 3 })
  ponerEnCompu(DADO)
  assert.match(await cuenta.ejecutar("traer"), /memorias DISTINTAS/)
  assert.match(await cuenta.ejecutar("traer", { reemplazar: true }), /Traje a esta compu/)
  assert.deepEqual(enCompu(), { estado: "ok", memoria: SEMAFORO })
})

test("por la cuenta, apagada (sin dirección): 'subir' y 'traer' dicen que no está disponible", async () => {
  const cuenta = crearCuenta({ fetch, api: undefined, web: undefined, carpeta, etiqueta: "test", abrirNavegador: () => false })
  assert.match(await cuenta.ejecutar("subir"), /todavía no está disponible/)
  assert.match(await cuenta.ejecutar("traer", { reemplazar: true }), /todavía no está disponible/)
})

// ─── memoria local: las dos copias del formato no se pueden separar ─────────

test("memoria local: sin archivo, o con todo sin definir, es 'vacia'", () => {
  assert.deepEqual(enCompu(), { estado: "vacia" })
  writeFileSync(archivo(), "- Nivel: (sin definir)\n- Proyectos hechos: (sin definir)\n- En curso: (sin definir)\n")
  assert.deepEqual(enCompu(), { estado: "vacia" })
})

test("memoria local: un archivo que no se puede leer es 'ilegible', no 'vacia'", async () => {
  mkdirSync(archivo()) // un directorio con ese nombre: existe y no se puede leer como archivo
  assert.equal(enCompu().estado, "ilegible")
  enCuenta = { memoria: SEMAFORO, version: 1 }
  assert.match(await sincronizador().traer(true), /no puedo leer/)
  assert.match(await sincronizador().subir(true), /No pude leer la memoria de esta compu/)
  assert.equal(puts(), 0)
})

test("memoria local: un nivel que la cuenta no acepta no viaja", () => {
  writeFileSync(archivo(), "- Nivel: experto total\n- Proyectos hechos: Semáforo\n- En curso: (sin definir)\n")
  assert.deepEqual(enCompu(), { estado: "ok", memoria: { proyectos: ["Semáforo"] } })
})

test("COMPATIBILIDAD con el tool memoria: lo que escribe uno lo lee el otro", async () => {
  // Mismo armado que tests/memoria.test.mjs: el tool real, con el plugin simulado.
  const dir = mkdtempSync(join(raiz, "tool-"))
  writeFileSync(
    join(dir, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const fuente = readFileSync(join(REPO, "opencode/tool/memoria.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(dir, "memoria.ts"), fuente)
  const tool = (await import(join(dir, "memoria.ts"))).default

  const previo = process.env.XDG_CONFIG_HOME
  const cfg = join(dir, "cfg")
  const carpetaTool = join(cfg, "opencode")
  process.env.XDG_CONFIG_HOME = cfg
  try {
    // 1. Escribe el tool, lee esta copia.
    await tool.execute({ accion: "guardar", proyecto: "Semáforo", nivel: "intermedio" }, {})
    await tool.execute({ accion: "guardar", en_curso: "Sensor DHT11", paso: "paso 2" }, {})
    assert.deepEqual(localMod.leerMemoriaLocal(carpetaTool), {
      estado: "ok",
      memoria: { nivel: "intermedio", proyectos: ["Semáforo"], enCurso: "Sensor DHT11 — paso 2" },
    })
    // 2. Escribe esta copia, lee el tool.
    assert.equal(localMod.escribirMemoriaLocal(carpetaTool, { nivel: "avanzado", proyectos: ["Dado", "Alarma"], enCurso: "Riego — paso 1" }).estado, "escrita")
    const leido = await tool.execute({ accion: "leer" }, {})
    assert.match(leido, /Nivel: avanzado/)
    assert.match(leido, /Proyectos hechos: Dado, Alarma/)
    assert.match(leido, /Ultimo proyecto: Alarma/)
    assert.match(leido, /EN CURSO \(retomá acá\): Riego — paso 1/)
    // 3. Y el archivo que deja esta copia es, byte a byte, el que dejaría el tool.
    const deEstaCopia = readFileSync(join(carpetaTool, "tecnia-memoria.md"), "utf8")
    await tool.execute({ accion: "guardar", nivel: "avanzado" }, {}) // el tool relee y reescribe lo mismo
    assert.equal(readFileSync(join(carpetaTool, "tecnia-memoria.md"), "utf8"), deEstaCopia)
    // 4. Una memoria vacía también: el tool la ve como «sin progreso».
    assert.equal(existsSync(join(carpetaTool, "tecnia-memoria.md")), true)
  } finally {
    if (previo === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previo
  }
})
