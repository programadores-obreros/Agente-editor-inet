// El corte de una carga CONGELA el árbol antes de matarlo, y eso es lo que lo hace completo.
//
// POR QUÉ ESTE ARCHIVO. El encabezado de opencode/carga/arbol.ts presenta el congelado
// (SIGSTOP) como la defensa contra un árbol que sigue lanzando hijos mientras se lo
// enumera: «un proceso congelado no puede lanzar otro». Sin eso, entre la foto y el
// SIGKILL nace un hijo que nadie vio, queda huérfano y sigue grabando la placa después
// de que Tecnia Bot dijo «cancelado».
//
// Pero ningún test lo protegía. La auditoría de código del 2026-11-22 lo midió por
// mutación (TST-02): sacando el SIGSTOP inicial, y también sacando LOS TRES envíos de
// SIGSTOP, tests/carga-arbol.test.mjs quedaba 17 de 17. El test «B-2» de ese archivo pasa
// igual porque el producto ya no manda SIGTERM, así que el handler del proceso de prueba
// nunca corre, con o sin congelado. Y el caso «N-5» usa un sistema donde SIGSTOP no hace nada.
//
// CÓMO MIDE. Con un sistema SIMULADO, inyectado por la misma interfaz `Sistema` que el
// producto ya expone para probar los caminos raros. En ese sistema hay procesos que
// lanzan un hijo nuevo CADA VEZ que alguien saca una foto, salvo que estén congelados
// o muertos. Es el peor árbol posible: uno que nunca deja de crecer mientras lo miran.
// Con el congelado, el árbol se queda quieto y el corte lo mata entero. Sin el congelado,
// no hay forma de alcanzarlo.
//
// POR QUÉ SIMULADO Y NO CON PROCESOS DE VERDAD. Con procesos reales esto es una carrera:
// depende de cuántos hijos llegue a lanzar el proceso entre dos lecturas de /proc, y un
// test así pasa o falla según la carga de la máquina. Acá el árbol crece siempre, en
// cada foto, sin azar. Los procesos de verdad están en tests/carga-arbol.test.mjs.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - sacar el SIGSTOP inicial del árbol (`for (const pid of arbol) sis.senal(pid, "SIGSTOP")`)
//   - sacar el SIGSTOP de los procesos que aparecen en cada vuelta (rojo «crece UNA vez más»)
//   - sacar los dos
//   - mandar SIGKILL antes de congelar (invertir el orden)
//   - mandar SIGCONT o SIGTERM en cualquier momento
//
// LÍMITE HONESTO: prueba el ALGORITMO contra un modelo del sistema. No prueba que el
// kernel congele de verdad con SIGSTOP (eso es Linux), ni lo que pasa en macOS o Windows.
//
// Corre con: node --test tests/carga-arbol-congelado.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { terminarArbol } = await import(join(REPO, "opencode/carga/arbol.ts"))

const CARPETA = "/tmp/carga-de-prueba"
const MARCA = "c".repeat(64)

/**
 * Un sistema donde los procesos «lanzadores» tienen un hijo nuevo en cada foto, mientras
 * estén vivos y sin congelar. Los hijos también son lanzadores (el árbol crece a lo ancho
 * y a lo hondo). `senales` anota todo lo que se mandó, en orden.
 */
function sistemaQueNoParaDeCrecer({ raiz = 100, congelable = true, naceUnoAlCongelar = false } = {}) {
  const procesos = new Map([[raiz, { ppid: 1, estado: "vivo", lanzador: true }]])
  let siguiente = raiz + 1
  const senales = []
  const sis = {
    plataforma: "linux",
    procesos,
    senales,
    foto() {
      // Antes de mostrarse, cada lanzador vivo y sin congelar tuvo tiempo de lanzar un hijo.
      for (const [pid, p] of [...procesos]) {
        if (p.lanzador && p.estado === "vivo") procesos.set(siguiente++, { ppid: pid, estado: "vivo", lanzador: true })
      }
      return [...procesos].map(([pid, p]) => ({ pid, ppid: p.ppid, zombi: p.estado === "muerto", inicio: pid }))
    },
    referencian: () => [],
    conMarca: () => ({ pids: [], ilegibles: 0 }),
    senal(pid, senal) {
      senales.push([pid, senal])
      const p = procesos.get(pid)
      if (!p || p.estado === "muerto") return
      if (senal === "SIGKILL") p.estado = "muerto"
      else if (senal === "SIGSTOP" && congelable) {
        // La carrera de verdad: el proceso ya había lanzado un hijo en el instante en que
        // le llega el SIGSTOP. Ese hijo NO estaba en la foto anterior, y nace vivo.
        if (naceUnoAlCongelar && p.estado === "vivo" && p.lanzador) procesos.set(siguiente++, { ppid: pid, estado: "vivo", lanzador: true })
        p.estado = "congelado"
      }
      else if (senal === "SIGCONT" && p.estado === "congelado") p.estado = "vivo"
    },
    taskkill: () => false,
  }
  return sis
}
const sobrevivientes = (sis) => [...sis.procesos].filter(([, p]) => p.estado !== "muerto").map(([pid]) => pid)

test("un árbol que no para de crecer: congelado queda quieto, y el corte lo mata ENTERO y lo confirma", async () => {
  const sis = sistemaQueNoParaDeCrecer()
  const fin = await terminarArbol(100, CARPETA, MARCA, sis, { kill: 200 })
  assert.equal(fin.confirmado, true, `no confirmó el corte de un árbol que el congelado tenía que dejar quieto: ${fin.detalle}`)
  assert.deepEqual(sobrevivientes(sis), [], "quedaron procesos vivos después del corte: alguno nació entre la foto y el SIGKILL")
  assert.ok(sis.procesos.size > 1, `el árbol de prueba no llegó a crecer (${sis.procesos.size} proceso): el test no está midiendo nada`)
})

test("un árbol que deja un hijo nuevo en CADA congelado: no se confirma, y a cada uno que aparece se lo congela antes de matarlo", async () => {
  // El caso de arriba se resuelve con el congelado INICIAL: todo el árbol está en la primera
  // foto. Éste no: cada proceso deja un hijo nuevo en el momento en que lo congelan, así que
  // siempre hay alguno que la foto anterior no vio. Sólo se alcanza si a los que aparecen en
  // cada vuelta también se los congela. Sin ese segundo SIGSTOP este test quedaba verde con
  // el de arriba solo: lo destapó una mutación al escribirlo.
  const sis = sistemaQueNoParaDeCrecer({ naceUnoAlCongelar: true })
  const fin = await terminarArbol(100, CARPETA, MARCA, sis, { kill: 200 })
  assert.equal(fin.confirmado, false, "un árbol que deja un hijo nuevo en CADA congelado no se puede dar por quieto: confirmarlo sería un OK falso")
  assert.match(fin.detalle, /siguió cambiando/, fin.detalle)
  // Pero lo que SÍ tiene que pasar: todo lo que se vio se congeló antes de morir.
  const congelados = new Set(sis.senales.filter(([, s]) => s === "SIGSTOP").map(([p]) => p))
  const matados = new Set(sis.senales.filter(([, s]) => s === "SIGKILL").map(([p]) => p))
  assert.ok(congelados.size >= 4, `sólo congeló ${congelados.size} procesos: no persiguió a los que fueron apareciendo`)
  for (const pid of matados) assert.ok(congelados.has(pid), `al proceso ${pid} lo mató sin haberlo congelado`)
})

test("los que aparecen después de la primera foto se congelan: un árbol que crece UNA vez más se alcanza", async () => {
  // Un solo hijo tardío (el del proceso raíz) y después nada más: con el SIGSTOP de la
  // vuelta, el árbol queda quieto en la segunda pasada y se confirma.
  const sis = sistemaQueNoParaDeCrecer({ naceUnoAlCongelar: true })
  const original = sis.senal
  let yaNacio = false
  sis.senal = (pid, senal) => {
    // Sólo el PRIMER congelado deja un hijo; desde ahí, congelar es congelar.
    if (senal === "SIGSTOP" && yaNacio) {
      sis.senales.push([pid, senal])
      const p = sis.procesos.get(pid)
      if (p && p.estado !== "muerto") p.estado = "congelado"
      return
    }
    if (senal === "SIGSTOP") yaNacio = true
    original(pid, senal)
  }
  const fin = await terminarArbol(100, CARPETA, MARCA, sis, { kill: 200 })
  assert.equal(fin.confirmado, true, `no alcanzó a un hijo que nació una sola vez después de la primera foto: ${fin.detalle}`)
  assert.deepEqual(sobrevivientes(sis), [], "quedó vivo el hijo que nació después de la primera foto")
})

test("el orden: primero se congela, después se mata, y nunca se reanuda", async () => {
  const sis = sistemaQueNoParaDeCrecer()
  await terminarArbol(100, CARPETA, MARCA, sis, { kill: 200 })
  const nombres = sis.senales.map(([, s]) => s)
  assert.ok(!nombres.includes("SIGCONT"), "reanudó un proceso congelado: puede lanzar un hijo que nadie ve")
  assert.ok(!nombres.includes("SIGTERM"), "mandó SIGTERM: un proceso con handler vuelve a correr")
  // Cada proceso recibió SIGSTOP antes que su SIGKILL.
  for (const pid of new Set(sis.senales.filter(([, s]) => s === "SIGKILL").map(([p]) => p))) {
    const iStop = sis.senales.findIndex(([p, s]) => p === pid && s === "SIGSTOP")
    const iKill = sis.senales.findIndex(([p, s]) => p === pid && s === "SIGKILL")
    assert.ok(iStop >= 0 && iStop < iKill, `al proceso ${pid} lo mató sin congelarlo antes`)
  }
  // Y ningún SIGKILL salió antes de que el árbol entero estuviera congelado.
  const primerKill = nombres.indexOf("SIGKILL")
  assert.ok(primerKill > 0)
  assert.ok(!nombres.slice(primerKill).includes("SIGSTOP") || nombres.slice(primerKill).every((s) => s !== "SIGSTOP"),
    "siguió congelando procesos después de empezar a matar: el árbol no estaba quieto cuando empezó")
})

test("contrapeso: si el sistema NO deja congelar, el árbol no se alcanza y el corte NO se confirma", async () => {
  // Esto es lo que pasaría sin SIGSTOP. Tiene que dar «no confirmado», nunca un OK.
  const sis = sistemaQueNoParaDeCrecer({ congelable: false })
  const fin = await terminarArbol(100, CARPETA, MARCA, sis, { kill: 100 })
  assert.equal(fin.confirmado, false, "confirmó el corte de un árbol que seguía creciendo")
  assert.match(fin.detalle, /siguió cambiando|quedan \d+ proceso/, fin.detalle)
})
