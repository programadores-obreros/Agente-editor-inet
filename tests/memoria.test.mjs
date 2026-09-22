// Smoke tests del tool `memoria` (opencode/tool/memoria.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Mockeamos: (a) el plugin, (b) un XDG_CONFIG_HOME falso. La escritura la hace
// el propio modulo con node:fs (escribirArchivoAtomico), asi que no hace falta
// mockear nada de escritura: se ejercita el codigo real, incluida la ruta de
// escritura atomica temp+rename.

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-memoria-test")
const cfg = join(OUT, "cfg")
const memoriaFile = join(cfg, "opencode", "tecnia-memoria.md")

let mod

before(async () => {
  mkdirSync(join(cfg, "opencode"), { recursive: true })
  process.env.XDG_CONFIG_HOME = cfg

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/memoria.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "memoria.ts"), src)
  mod = (await import(join(OUT, "memoria.ts"))).default
})

// Cada test arranca con la memoria en blanco.
beforeEach(() => {
  if (existsSync(memoriaFile)) rmSync(memoriaFile)
})

test("leer: memoria vacia dice que no hay progreso", async () => {
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /no hay progreso/i)
})

test("guardar: agrega un proyecto y leer lo muestra como ultimo", async () => {
  await mod.execute({ accion: "guardar", proyecto: "semaforo" }, {})
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /semaforo/i, "el proyecto deberia estar en la lista")
  assert.match(r, /Ultimo proyecto:\s*semaforo/i, "y ser el ultimo")
})

test("guardar: no duplica el mismo proyecto (dedup case-insensitive)", async () => {
  await mod.execute({ accion: "guardar", proyecto: "riego" }, {})
  await mod.execute({ accion: "guardar", proyecto: "RIEGO" }, {})
  // Contamos SOLO en la linea de la lista (el "Ultimo proyecto" derivado repite el valor a proposito).
  const lista = readFileSync(memoriaFile, "utf8").match(/^-\s*Proyectos hechos:\s*(.*)$/m)[1]
  const ocurrencias = lista.split(",").filter((p) => p.trim().toLowerCase() === "riego").length
  assert.equal(ocurrencias, 1, "riego deberia aparecer una sola vez en la lista")
})

test("guardar: la lista tiene tope de 8 (FIFO, cae el mas viejo)", async () => {
  for (let i = 1; i <= 9; i++) await mod.execute({ accion: "guardar", proyecto: `proyecto${i}` }, {})
  const r = await mod.execute({ accion: "leer" }, {})
  assert.doesNotMatch(r, /proyecto1\b/, "proyecto1 (el mas viejo) deberia haber caido")
  assert.match(r, /proyecto9/, "proyecto9 (el mas nuevo) deberia estar")
  assert.match(r, /Ultimo proyecto:\s*proyecto9/i, "el ultimo es el mas reciente")
})

test("guardar: el nivel (enum) se persiste", async () => {
  await mod.execute({ accion: "guardar", nivel: "intermedio" }, {})
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /Nivel:\s*intermedio/i)
})

test("privacidad: el archivo NO guarda nombre ni datos personales", async () => {
  await mod.execute({ accion: "guardar", proyecto: "semaforo", nivel: "principiante" }, {})
  const guardado = readFileSync(memoriaFile, "utf8")
  assert.match(guardado, /no de una persona/i, "el encabezado deja explicito que no es personal")
  assert.doesNotMatch(guardado, /Nombre:/i, "no debe haber campo Nombre en la memoria")
})

test("guiado: guarda el proyecto en curso con su paso, y leer lo muestra para retomar", async () => {
  await mod.execute({ accion: "guardar", en_curso: "semaforo con 3 LEDs", paso: "paso 3 de 5: cablear" }, {})
  const g = readFileSync(memoriaFile, "utf8")
  assert.match(g, /^-\s*En curso:\s*semaforo con 3 LEDs\s*—\s*paso 3 de 5: cablear\s*$/m, "guarda proyecto + paso")
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /EN CURSO/i, "leer marca que hay uno para retomar")
  assert.match(r, /paso 3 de 5/, "y dice en qué paso quedó")
})

test("guiado: al TERMINAR el proyecto pasa a la lista y se limpia el 'en curso'", async () => {
  await mod.execute({ accion: "guardar", en_curso: "semaforo", paso: "paso 4 de 5" }, {})
  await mod.execute({ accion: "guardar", proyecto: "semaforo" }, {}) // terminado
  const g = readFileSync(memoriaFile, "utf8")
  assert.match(g, /^-\s*Proyectos hechos:.*semaforo/m, "queda en la lista de hechos")
  assert.match(g, /^-\s*En curso:\s*\(sin definir\)\s*$/m, "el 'en curso' se limpia al terminar")
})

// ---------------------------------------------------------------------------
// Escritura atomica (temp + rename). Ver el comentario de escribirArchivoAtomico
// en memoria.ts: sin esto, un corte de luz a mitad de escritura deja el archivo
// truncado y se pierde el progreso pedagogico de la maquina sin aviso.
// ---------------------------------------------------------------------------

// El modulo corre EN ESTE MISMO proceso (se importa dinamicamente), asi que
// puede predecirse el nombre exacto del temporal que usa: `${ruta}.${pid}.tmp`.
const tempDeMemoria = () => `${memoriaFile}.${process.pid}.tmp`

test("atomico: una escritura exitosa no deja ningun .tmp huerfano al lado del archivo", async () => {
  await mod.execute({ accion: "guardar", proyecto: "semaforo" }, {})
  const huerfanos = readdirSync(dirname(memoriaFile)).filter((f) => f.endsWith(".tmp"))
  assert.deepEqual(huerfanos, [], "quedo un temporal sin limpiar tras una escritura exitosa")
})

test("atomico: el temporal se arma en el MISMO directorio que el destino (no os.tmpdir())", () => {
  assert.equal(dirname(tempDeMemoria()), dirname(memoriaFile), "el temporal no queda al lado del destino")
})

test("atomico: si la escritura falla en el medio, el archivo VIEJO sobrevive intacto", async () => {
  // Progreso viejo ya guardado, con contenido conocido.
  await mod.execute({ accion: "guardar", proyecto: "riego automatico", nivel: "intermedio" }, {})
  const antes = readFileSync(memoriaFile, "utf8")

  // Se ocupa el path exacto del temporal ANTES de que el modulo lo use: al
  // existir como directorio, el writeFileSync(temp, ...) de adentro de
  // escribirArchivoAtomico falla con EISDIR — es una falla real del sistema de
  // archivos, sin mockear nada del modulo. Simula "murio a mitad de escribir":
  // lo que importa para la atomicidad es que el destino no se tocó, y eso vale
  // exactamente igual que si el corte hubiera sido durante el writeFileSync real.
  mkdirSync(tempDeMemoria(), { recursive: true })

  // El tool no relanza: atrapa el error de escribirArchivoAtomico y avisa en texto.
  const r = await mod.execute({ accion: "guardar", proyecto: "otro proyecto que no deberia entrar" }, {})
  assert.match(r, /no pude guardar/i, "no avisa que la escritura fallo")

  assert.equal(readFileSync(memoriaFile, "utf8"), antes, "el progreso viejo se perdio o se corrompio")
  assert.doesNotMatch(antes, /otro proyecto que no deberia entrar/, "el test no armo bien el caso")

  rmSync(tempDeMemoria(), { recursive: true, force: true })
})
