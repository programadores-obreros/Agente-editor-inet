// Phase 2, Slice 1 — cambio de GPIO del LED a través de la raíz de composición:
// N -> N+1, canónico en Y, persistido en Y, snapshot en Y; notificación de
// `suscribir` exactamente una vez con {revision: N+1}; un rechazo o un dry-run NUNCA
// notifican; invariante visual (diseño §2.6/prompt §22): sólo cambia la asignación
// de ese pin, la revisión y los efectos derivados explícitos.

import { test } from "node:test"
import assert from "node:assert/strict"
import { crearAlmacen, catalogo, canonicalizar, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

test("AsignarPin(anodo -> Y) con baseRevision N: ok, revision N+1, canonico en Y, persistido en Y, snapshot en Y", () => {
  const dir = nuevoDir("gpio-cambio")
  const id = nuevoIdProyecto()
  const { servicio, idComponente } = prepararProyectoConLed(dir, id)

  const n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true, `AsignarPin a GPIO_Y debe aceptarse: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, n + 1)

  const snap = servicio.snapshot()
  assert.equal(snap.revision, n + 1, "revision N+1 en el snapshot")
  const componente = snap.proyecto.componentes.find((c) => c.id === idComponente)
  assert.equal(componente.pines.anodo, GPIO_Y, "canonico (via snapshot) en Y")

  // Persistido en Y: se verifica con un Almacen FRESCO e INDEPENDIENTE (nunca a
  // través de la raíz de composición — mismo patrón que
  // tests/nucleo-persistible-recargable.test.mjs) — recarga real desde disco.
  const almacenFresco = crearAlmacen({ directorio: dir, catalogo })
  const recargado = almacenFresco.cargar(id)
  assert.equal(recargado.ok, true)
  assert.equal(recargado.proyecto.revision, n + 1, "revision persistida en Y")
  assert.equal(recargado.proyecto.componentes.find((c) => c.id === idComponente).pines.anodo, GPIO_Y, "pin persistido en Y")
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(snap.proyecto), "el disco es canonicamente equivalente al snapshot")

  servicio.cerrar()
})

test("la notificacion de suscribir se dispara EXACTAMENTE una vez con {revision: N+1}", () => {
  const dir = nuevoDir("gpio-notificacion")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  const eventos = []
  const desuscribir = servicio.suscribir((evento) => eventos.push(evento))

  const n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true)

  assert.equal(eventos.length, 1, "exactamente UNA notificacion")
  assert.deepEqual(eventos[0], { revision: n + 1 })

  desuscribir()
  servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_X }, n + 1))
  assert.equal(eventos.length, 1, "tras desuscribirse, no llegan mas eventos")

  servicio.cerrar()
})

test("un RECHAZO o un DRY-RUN (proponer) NUNCA notifican", () => {
  const dir = nuevoDir("gpio-sin-notificacion")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  const eventos = []
  servicio.suscribir((evento) => eventos.push(evento))

  const n = servicio.snapshot().revision
  assert.ok(n >= 1, "el fixture (SetPlaca+AgregarComponente+AsignarPin) ya commiteo al menos 3 veces, n-1 es siempre un baseRevision STALE valido")

  // Rechazo: baseRevision stale (n-1, ya superada).
  const rRechazo = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n - 1))
  assert.equal(rRechazo.ok, false)
  assert.ok(rRechazo.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
  assert.equal(eventos.length, 0, "un rechazo no notifica")

  // Dry-run: proponer() nunca persiste ni sube revision.
  const rPropuesta = servicio.proponer([op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n)])
  assert.equal(rPropuesta.ok, true, "el dry-run de una operacion valida es ok:true, pero NUNCA persiste")
  assert.equal(servicio.snapshot().revision, n, "proponer() no cambia la revision")
  assert.equal(eventos.length, 0, "un dry-run no notifica")

  servicio.cerrar()
})

test("invariante visual: cambiar el GPIO del LED cambia SOLO la asignacion de ese pin, la revision y los efectos derivados explicitos — diff semantico de la IR", () => {
  const dir = nuevoDir("gpio-invariante-visual")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  // Segundo componente, sin ninguna relacion con el LED — para demostrar que NO se
  // toca por el cambio de GPIO del primero.
  const n0 = servicio.snapshot().revision
  const rAgregar = servicio.aplicar(op("AgregarComponente", { tipo: "dht22" }, n0))
  assert.equal(rAgregar.ok, true)

  const antes = servicio.snapshot().proyecto
  const idNoRelacionado = antes.componentes.find((c) => c.id !== idComponente).id

  const n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true)
  const despues = servicio.snapshot().proyecto

  // Diff semantico POR VALOR (no por referencia): `snapshot()` construye una copia
  // JSON fresca en cada llamada, a propósito (tests/phase2-snapshot.test.mjs,
  // aislamiento del canonico) — comparar `===` entre dos snapshots siempre daria
  // falso, incluso para lo NO tocado. El invariante real (OPERATIONS.md §5,
  // `nucleo-operaciones.test.mjs`: "un aplicador sólo reconstruye lo que cambia") se
  // verifica acá por VALOR: qué claves de nivel superior cambiaron entre ambos
  // snapshots, y qué componentes cambiaron por valor dentro de `componentes`.
  function clavesQueCambiaron(a, b) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...claves].filter((clave) => JSON.stringify(a[clave]) !== JSON.stringify(b[clave])).sort()
  }

  assert.deepEqual(clavesQueCambiaron(antes, despues), ["componentes", "revision"], "solo componentes/revision cambian de valor — placa/conexiones/comportamientos/metadata intactos")

  const componenteNoRelacionadoAntes = antes.componentes.find((c) => c.id === idNoRelacionado)
  const componenteNoRelacionadoDespues = despues.componentes.find((c) => c.id === idNoRelacionado)
  assert.equal(JSON.stringify(componenteNoRelacionadoAntes), JSON.stringify(componenteNoRelacionadoDespues), "el componente NO tocado es idéntico por valor")

  const ledAntes = antes.componentes.find((c) => c.id === idComponente)
  const ledDespues = despues.componentes.find((c) => c.id === idComponente)
  assert.equal(ledAntes.pines.anodo, GPIO_X)
  assert.equal(ledDespues.pines.anodo, GPIO_Y)
  assert.equal(despues.revision, antes.revision + 1, "efecto derivado explicito: la revision avanza en uno")

  servicio.cerrar()
})
