// Fixtures compartidas de Phase 2 Slice 1 (composicion-raiz + snapshot).
//
// NO es `*.test.mjs` — el glob de `node --test` (`package.json:9`,
// `"test": "node --test tests/*.test.mjs"`) no lo corre como suite, sólo lo importan
// los archivos `phase2-*.test.mjs`. El ÚNICO import de la API pública de
// `composicion-raiz.ts` vive ACÁ (docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md
// §3, mismo criterio que ya usó ARCH-D en su plan de tests): si el nombre/forma de la
// factory cambiara, sólo este archivo se editaría.
//
// Mismo estilo de fixtures que `tests/nucleo-persistible-recargable.test.mjs`/
// `tests/nucleo-demo-contractual.test.mjs` (Almacen REAL sobre `os.tmpdir()`, nunca un
// almacén falso — Phase 2 Slice 1 es, otra vez, la única capa de integración nueva).

import { mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
export const DIR_BASE = join(os.tmpdir(), "tecniabot-test-phase2")

export const { obtenerServicioDeProyecto } = await import(join(REPO, "opencode/nucleo/composicion-raiz.ts"))
export const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
export const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
export const { canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
export const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

// El MISMO catálogo real que usa la raíz de composición internamente
// (adaptadores/hash-catalogo.node.ts) — necesario para que los tests puedan construir
// un `Almacen`/validar por su cuenta (verificación independiente de lo persistido en
// disco, mismo patrón que Phase 1) sin duplicar datos de catálogo.
export const catalogo = construirCatalogoMinimoReal()

// GPIO del escenario del slice ("ESP32 + LED", diseño §1): tres pines válidos para
// `salidaDigital` en `esp32-devkit-v1`, ninguno con restricciones (verificado contra
// `opencode/nucleo/placas.ts`: ESP32_GPIO_FLASH=[6..11], ESP32_GPIO_STRAPPING=
// [0,2,12,15], ESP32_GPIO_SOLO_ENTRADA=[34,35,36,39], ESP32_GPIO_UART_USB=[1,3] — ni
// GPIO4 ni GPIO16 ni GPIO18 caen en ninguna de las cuatro listas).
export const GPIO_X = "GPIO4"
export const GPIO_Y = "GPIO16"
export const GPIO_Z = "GPIO18"

let contadorOp = 0
export function op(tipo, payload, baseRevision, overrides) {
  return { idOperacion: `phase2-op-${contadorOp++}`, actor: "navegador", baseRevision, tipo, payload, ...overrides }
}

export function readiness(proyecto) {
  return derivarReadiness(proyecto, validarProyecto(proyecto, catalogo))
}

let contadorDir = 0
export function nuevoDir(nombre) {
  const dir = join(DIR_BASE, `${nombre}-${contadorDir++}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

let contadorId = 0
export function nuevoIdProyecto(prefijo = "phase2") {
  return `${prefijo}-${contadorId++}`
}

/**
 * Arma, a través del composition root REAL (`obtenerServicioDeProyecto`), un
 * proyecto ESP32 + un LED con el ánodo en `GPIO_X` — mismo escenario concreto que
 * `tests/nucleo-demo-contractual.test.mjs` (ESP32+LED), ahora pasando por la raíz de
 * composición en vez de construir el motor a mano. Devuelve el servicio y el id real
 * del componente (siempre "cmp-0" en un proyecto fresco — `SetPlaca` no consume el
 * contador de ids locales, `AgregarComponente` es la primera operación que sí lo
 * hace).
 */
export function prepararProyectoConLed(directorio, idProyecto) {
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })

  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)

  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id

  r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AsignarPin rechazado: ${JSON.stringify(r.motivos)}`)

  return { servicio, idComponente }
}
