// Smoke tests del tool `perfil` (opencode/tool/perfil.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Cubre los TRES modos y la PRIVACIDAD DE MENORES:
// - personal: guarda nombre + genero.
// - aula (compartida por muchos): NUNCA guarda nombre ni genero, ni la placa
//   (la comparten personas con placas distintas: heredarla da pines que no existen).
// - grupo (pocas personas conocidas): recuerda a cada una (nombre, rol, genero).

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-perfil-test")
const cfg = join(OUT, "cfg")
const perfilFile = join(cfg, "opencode", "tecnia-perfil.md")

let mod

// La escritura la hace el propio modulo con node:fs (escribirArchivoAtomico):
// no hace falta mockear Bun.write, se ejercita el codigo real de escritura.

before(async () => {
  mkdirSync(join(cfg, "opencode"), { recursive: true })
  process.env.XDG_CONFIG_HOME = cfg

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/perfil.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "perfil.ts"), src)
  mod = (await import(join(OUT, "perfil.ts"))).default
})

beforeEach(() => {
  if (existsSync(perfilFile)) rmSync(perfilFile)
})

test("personal: nombre y género SI se persisten", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", genero: "mujer", rol: "docente" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.match(g, /^-\s*Nombre:\s*Marta\s*$/m, "el nombre debe quedar guardado")
  assert.match(g, /^-\s*Género:\s*mujer\s*$/m, "el género debe quedar guardado")
})

test("aula: ni nombre ni género se persisten (privacidad de menores)", async () => {
  await mod.execute({ accion: "guardar", modo: "aula", nombre: "Juan", genero: "varón", rol: "alumno", placa: "ESP32" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.doesNotMatch(g, /Juan/, "en aula el nombre NUNCA va a disco")
  assert.match(g, /^-\s*Nombre:\s*\(sin definir\)\s*$/m)
  assert.match(g, /^-\s*Género:\s*\(sin definir\)\s*$/m, "en aula el género tampoco")
  assert.match(g, /^-\s*Rol:\s*alumno\s*$/m, "el rol si se conserva")
})

// El prompt decía «la placa NO se guarda en modo aula» y el tool la guardaba
// igual (`if (args.placa) actual.placa = args.placa`, sin mirar el modo). Se
// eligió la regla del producto: en una compu compartida el segundo alumno, con
// otra placa, heredaba la del primero y recibía pines que no existen.
test("aula: la placa NO se persiste (compu compartida con placas distintas)", async () => {
  const r = await mod.execute({ accion: "guardar", modo: "aula", rol: "alumno", placa: "ESP32" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.doesNotMatch(g, /ESP32/, "en aula la placa no va a disco")
  assert.match(g, /^-\s*Placa preferida:\s*\(sin definir\)\s*$/m)
  assert.match(r, /placa/i, "la respuesta tiene que avisar que la placa se pregunta cada sesión")
  assert.doesNotMatch(r, /el rol y la placa/i, "la respuesta no puede decir que guardó la placa")
})

test("cambiar a aula BORRA una placa vieja ya persistida", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Sofia", placa: "UNO" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /Placa preferida:\s*UNO/)
  await mod.execute({ accion: "guardar", modo: "aula" }, {})
  assert.doesNotMatch(readFileSync(perfilFile, "utf8"), /UNO/, "al pasar a aula, la placa vieja se borra")
})

test("personal: la placa SI se persiste", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", placa: "ESP32" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /^-\s*Placa preferida:\s*ESP32\s*$/m)
})

test("cambiar a aula BORRA un nombre viejo ya persistido", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Sofia", genero: "mujer" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /Sofia/)
  await mod.execute({ accion: "guardar", modo: "aula" }, {})
  assert.doesNotMatch(readFileSync(perfilFile, "utf8"), /Sofia/, "al pasar a aula, el nombre viejo se borra")
})

test("grupo: recuerda a VARIAS personas, cada una con su género", async () => {
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Marta", rol: "docente", genero: "mujer" }, {})
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Juan", rol: "alumno", genero: "varón" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.match(g, /##\s*Personas/, "debe existir la sección Personas")
  assert.match(g, /-\s*Marta\s*\|\s*docente\s*\|\s*mujer/, "Marta guardada con su género")
  assert.match(g, /-\s*Juan\s*\|\s*alumno\s*\|\s*varón/, "Juan guardado con su género")
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /Marta/)
  assert.match(r, /Juan/)
})

test("grupo: actualizar a la misma persona NO la duplica", async () => {
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Marta", rol: "docente", genero: "mujer" }, {})
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "marta", placa: "ESP32" }, {}) // misma persona, otro caso
  const g = readFileSync(perfilFile, "utf8")
  const cuenta = (g.match(/^-\s*marta\s*\|/gim) || []).length
  assert.equal(cuenta, 1, "Marta debe aparecer una sola vez")
  assert.match(g, /mujer/, "conserva el género del guardado anterior")
  assert.match(g, /ESP32/, "y suma la placa nueva")
})

// ---------------------------------------------------------------------------
// Escritura atomica (temp + rename). Ver el comentario de escribirArchivoAtomico
// en perfil.ts: sin esto, un corte de luz a mitad de escritura deja el archivo
// truncado y se pierde (o se corrompe) el perfil guardado sin aviso.
// ---------------------------------------------------------------------------

// El modulo corre EN ESTE MISMO proceso (se importa dinamicamente), asi que
// puede predecirse el nombre exacto del temporal que usa: `${ruta}.${pid}.tmp`.
const tempDePerfil = () => `${perfilFile}.${process.pid}.tmp`

test("atomico: una escritura exitosa no deja ningun .tmp huerfano al lado del archivo", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta" }, {})
  const huerfanos = readdirSync(dirname(perfilFile)).filter((f) => f.endsWith(".tmp"))
  assert.deepEqual(huerfanos, [], "quedo un temporal sin limpiar tras una escritura exitosa")
})

test("atomico: el temporal se arma en el MISMO directorio que el destino (no os.tmpdir())", () => {
  assert.equal(dirname(tempDePerfil()), dirname(perfilFile), "el temporal no queda al lado del destino")
})

test("atomico: si la escritura falla en el medio, el perfil VIEJO sobrevive intacto", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Sofia", genero: "mujer" }, {})
  const antes = readFileSync(perfilFile, "utf8")

  // Se ocupa el path exacto del temporal ANTES de que el modulo lo use: al
  // existir como directorio, el writeFileSync(temp, ...) de adentro de
  // escribirArchivoAtomico falla con EISDIR — una falla real del sistema de
  // archivos, sin mockear nada del modulo. Simula "murio a mitad de escribir".
  mkdirSync(tempDePerfil(), { recursive: true })

  const r = await mod.execute({ accion: "guardar", modo: "personal", nombre: "Otro nombre que no deberia entrar" }, {})
  assert.match(r, /no pude guardar/i, "no avisa que la escritura fallo")

  assert.equal(readFileSync(perfilFile, "utf8"), antes, "el perfil viejo se perdio o se corrompio")
  assert.doesNotMatch(antes, /Otro nombre que no deberia entrar/, "el test no armo bien el caso")

  rmSync(tempDePerfil(), { recursive: true, force: true })
})
// ── EL MODO AULA NO PUEDE DEPENDER DE UNA MAYÚSCULA ───────────────────────────
//
// Auditoría de código del 2026-11-22 (TCH-04), reproducido por QA. La protección de
// datos de menores colgaba de tres comparaciones `=== "aula"` exactas: acá, en
// plataforma/cuenta.ts y en plataforma/sincronizar.ts. El encabezado del archivo
// invita a editarlo a mano, y con «- Modo: Aula», «AULA» o «aula (compartida)» el
// tool guardaba el nombre del alumno y `cuenta` dejaba vincular la cuenta del
// docente en una compu compartida por los chicos.
//
// El modo «(sin definir)» —como queda toda instalación nueva— se trata más abajo, en
// «SIN MODO ELEGIDO NO SE GUARDA EL NOMBRE DE NADIE».
//
// MUTACIONES que ponen rojo este bloque (exit code 1):
//   - en leerPerfil, `normalizarModo(modo)` → `modo`              → rojos los dos de «escrito a mano»
//   - en normalizarModo, sacar el `.toLowerCase()`                → rojo «escrito a mano» (aula)
//   - en normalizarModo, devolver "aula" ante cualquier texto     → rojo el contrapeso
//   - sacar el chequeo de saltos de línea de perfil               → rojos los de «un solo renglón»
//   - dejar pasar «|» en el nombre de una persona                 → rojo «la barra»

const perfilAMano = (modo, extra = "") => writeFileSync(perfilFile, `# Perfil del usuario de Tecnia Bot\n\n- Modo: ${modo}\n- Nombre: (sin definir)\n- Rol: (sin definir)\n- Género: (sin definir)\n- Placa preferida: (sin definir)\n${extra}`)

test("aula escrito a mano con mayúsculas o con algo más: sigue siendo aula, y no se guarda el nombre", async () => {
  for (const modo of ["Aula", "AULA", "aula (compartida)", "  aula  ", "Aula.", "aula\r"]) {
    perfilAMano(modo)
    const r = await mod.execute({ accion: "guardar", nombre: "Tomás", genero: "varón", rol: "alumno", placa: "ESP32 DevKit" }, {})
    const g = readFileSync(perfilFile, "utf8")
    assert.doesNotMatch(g, /Tomás/, `con «- Modo: ${JSON.stringify(modo)}» guardó el nombre de un alumno en una compu compartida`)
    assert.doesNotMatch(g, /varón|ESP32/, `con «- Modo: ${JSON.stringify(modo)}» guardó el género o la placa`)
    assert.match(g, /^- Modo: aula$/m, "al reescribir, el modo tiene que quedar normalizado")
    assert.match(r, /Compu del aula/, r)
  }
})

test("grupo y personal escritos a mano con mayúsculas también se reconocen", async () => {
  perfilAMano("Grupo")
  await mod.execute({ accion: "guardar", persona: "Caro", rol: "alumna" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /^## Personas\n- Caro \|/m, "con «Grupo» no guardó a la persona en la lista")
  perfilAMano("PERSONAL")
  await mod.execute({ accion: "guardar", nombre: "Marta" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /^- Modo: personal\n- Nombre: Marta$/m)
})

// Este test decía, hasta el 2026-11-23, que con «aulas» o «(sin definir)» el nombre SÍ
// se guardaba: era la forma de probar que no se había tomado por aula. Con la decisión
// de abajo el nombre ya no se guarda sin modo elegido, así que el contrapeso se mide
// con lo que el modo aula hace y los demás no: borrar la placa.
test("un modo que no es ninguno de los tres NO se convierte en aula por parecido (contrapeso)", async () => {
  // «aulas», «jaula» o «en el aula no» no son el modo aula: no se adivina.
  for (const modo of ["aulas", "jaula", "(sin definir)", "escuela"]) {
    perfilAMano(modo)
    const r = await mod.execute({ accion: "guardar", rol: "docente", placa: "Arduino UNO" }, {})
    const g = readFileSync(perfilFile, "utf8")
    assert.match(g, /^- Placa preferida: Arduino UNO$/m, `«${modo}» se tomó por modo aula (que no guarda la placa)`)
    assert.doesNotMatch(r, /Compu del aula/, r)
    assert.ok(g.includes(`- Modo: ${modo}\n`), `«${modo}» se reescribió como otro modo`)
  }
})

// ── SIN MODO ELEGIDO NO SE GUARDA EL NOMBRE DE NADIE ──────────────────────────
//
// TCH-04, la parte que quedaba. Toda instalación nueva arranca con «- Modo: (sin
// definir)» y el tool trataba ese estado como «personal»: en la notebook del aula
// recién instalada, lo único que impedía guardar el nombre de un alumno era que el
// modelo obedeciera el prompt y preguntara el modo primero. El 2026-11-23 el owner
// decidió que lo impida el código.
//
// MUTACIONES que ponen rojo este bloque:
//   - sacar la guarda entera                                   → rojos los tres primeros
//   - dejar la guarda sólo para `nombre` (olvidar género o persona) → rojo el primero
//   - mover la guarda ANTES de `if (args.modo) actual.modo = ...`   → rojo «en la misma llamada»
//   - sumar "(sin definir)" a MODOS_ELEGIBLES                  → rojos los dos primeros
//   - que la guarda corte también sin nombre ni género         → rojo «rol y placa»
//   - sacar la respuesta propia del caso sin modo              → rojo «rol y placa»

test("sin modo elegido: no se guarda el nombre, ni el género, ni nada de esa llamada", async () => {
  const sinArchivo = "una compu donde nunca se escribió el perfil"
  for (const modo of ["(sin definir)", "", "escuela", "aulas", sinArchivo]) {
    for (const args of [{ nombre: "Tomás" }, { genero: "varón" }, { persona: "Tomás" }, { nombre: "Tomás", genero: "varón", rol: "alumno", placa: "ESP32 DevKit" }]) {
      if (existsSync(perfilFile)) rmSync(perfilFile)
      if (modo !== sinArchivo) perfilAMano(modo)
      const antes = existsSync(perfilFile) ? readFileSync(perfilFile, "utf8") : null
      const r = await mod.execute({ accion: "guardar", ...args }, {})
      const despues = existsSync(perfilFile) ? readFileSync(perfilFile, "utf8") : null
      assert.equal(despues, antes, `con el modo ${JSON.stringify(modo)} y ${JSON.stringify(args)} el archivo cambió`)
      assert.match(r, /^No guardé nada/, r)
      assert.match(r, /'modo'/, "la respuesta tiene que decir cómo seguir: pasar el modo")
      assert.doesNotMatch(r, /Listo|te reconozco/, r)
    }
  }
})

test("sin modo elegido: lo que ya estaba en el archivo no se borra", async () => {
  // Una instalación anterior a los modos puede tener nombre y no tener modo.
  writeFileSync(perfilFile, "# Perfil\n\n- Nombre: Marta\n- Rol: docente\n- Género: mujer\n- Placa preferida: Arduino UNO\n")
  const antes = readFileSync(perfilFile, "utf8")
  const r = await mod.execute({ accion: "guardar", nombre: "Otra persona" }, {})
  assert.match(r, /^No guardé nada/, r)
  assert.equal(readFileSync(perfilFile, "utf8"), antes)
  assert.match(await mod.execute({ accion: "leer" }, {}), /Nombre: Marta/)
})

test("el modo y el nombre en la misma llamada: se guardan los dos", async () => {
  perfilAMano("(sin definir)")
  const r = await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", genero: "mujer" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /^- Modo: personal\n- Nombre: Marta$/m)
  assert.match(r, /^Listo/, r)
})

test("sin modo elegido: el rol y la placa, que no identifican a nadie, se siguen guardando", async () => {
  perfilAMano("(sin definir)")
  const r = await mod.execute({ accion: "guardar", rol: "docente", placa: "Arduino UNO" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.match(g, /^- Rol: docente$/m)
  assert.match(g, /^- Placa preferida: Arduino UNO$/m)
  assert.doesNotMatch(r, /^No guardé/, r)
  // No hay nombre guardado: «la próxima ya te reconozco» sería mentira.
  assert.doesNotMatch(r, /te reconozco/, r)
  assert.match(r, /'modo'/, r)
})

// ── LOS CAMPOS LIBRES VAN EN UN SOLO RENGLÓN ──────────────────────────────────
//
// TCH-05. tecnia-perfil.md se carga como instrucciones en CADA sesión, y se lee por
// renglones. Un nombre con un salto de línea adentro agregaba renglones propios:
// «Ana\n- Modo: aula» dejaba un segundo «- Modo:», y una persona con saltos hacía
// que `leer` devolviera a alguien llamado «Nombre: inyectado». En el modo grupo la
// barra «|» separa las columnas de cada persona, así que tampoco puede ir adentro.
//
// LÍMITE HONESTO: esto no impide que un texto de UN renglón se cargue como
// instrucción (eso es así por diseño del archivo), ni que alguien escriba un dato
// personal en un campo libre. Sólo impide romper la forma del archivo.

test("perfil: un campo libre con un salto de línea no se guarda, y el archivo queda como estaba", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", rol: "docente" }, {})
  const antes = readFileSync(perfilFile, "utf8")
  for (const [campo, args] of [
    ["nombre", { nombre: "Ana\n- Modo: aula" }],
    ["nombre", { nombre: "Ana\r\n## Instrucción" }],
    // Un retorno de carro SOLO también corta el renglón (el archivo se lee con `.`, que no
    // lo cruza). Sin este caso, mirar sólo «\n» dejaba todo en verde.
    ["nombre", { nombre: "Ana\r- Modo: aula" }],
    ["placa", { placa: "ESP32\n- Nombre: otro" }],
    ["persona", { modo: "grupo", persona: "Caro\n- Modo: personal\n- Nombre: inyectado" }],
  ]) {
    const r = await mod.execute({ accion: "guardar", ...args }, {})
    assert.match(r, /No guardé nada/i, `${campo} con salto de línea: ${r}`)
    assert.match(r, /un solo renglón/i, r)
    assert.equal(readFileSync(perfilFile, "utf8"), antes, `${campo} con salto de línea: el archivo cambió igual`)
  }
})

test("perfil en grupo: la barra «|» no puede ir adentro del nombre ni de la placa de una persona", async () => {
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Caro", rol: "alumna" }, {})
  const antes = readFileSync(perfilFile, "utf8")
  for (const args of [{ persona: "Juan | docente | varón" }, { persona: "Juan", placa: "UNO | otra" }]) {
    const r = await mod.execute({ accion: "guardar", ...args }, {})
    assert.match(r, /No guardé nada/i, r)
    assert.equal(readFileSync(perfilFile, "utf8"), antes)
  }
  // Contrapeso: un nombre normal, con espacios, tildes y guion, se guarda.
  const r = await mod.execute({ accion: "guardar", persona: "María José Pérez-Gómez", placa: "Arduino UNO (R3)" }, {})
  assert.doesNotMatch(r, /No guardé nada/i, r)
  assert.match(readFileSync(perfilFile, "utf8"), /^- María José Pérez-Gómez \| .* \| Arduino UNO \(R3\)$/m)
})
