#!/usr/bin/env node
// Launcher de demo — Phase 2, Slice 1 (writer W4, tarea 3, PHASE_2_SLICE_1_DESIGN.md
// §2.7: "Launcher de demo para desarrollo... Levanta la misma raíz y el mismo
// servidor sobre un proyecto de ejemplo y deja visible la URL. No es un segundo
// motor: es el mismo código en otro proceso de desarrollo.").
//
// Usa la MISMA raíz de composición (`servicio-con-vista.ts`, el único call site de
// producción autorizado a `obtenerServicioDeProyecto`) y el MISMO servidor HTTP+SSE
// (`servidor-proyecto.ts`) que la tool de OpenCode y el navegador — nunca un motor
// ni un transporte alternativo para este launcher.
//
// Uso:
//   node scripts/vista-fisica-demo.mjs --dir <directorio> [--id-proyecto <id>] [--una-vez]
//   TECNIA_VISTA_FISICA_DIR=<directorio> node scripts/vista-fisica-demo.mjs [--una-vez]
//
// `--dir` (o TECNIA_VISTA_FISICA_DIR) es OBLIGATORIO: a diferencia de la tool
// (`opencode/tool/vista-fisica.ts`, que usa `<ctx.directory>/.tecnia-vista-fisica`
// automáticamente), este launcher no tiene ningún "directorio de trabajo activo" de
// OpenCode del que derivar uno — así que NUNCA asume un default dentro del repo:
// quien lo corre tiene que decir dónde (un `os.tmpdir()`, o cualquier carpeta que
// indique), para no ensuciar el working tree con un `<id>.json` de prueba.
//
// Si el proyecto (`<idProyecto>.json`) todavía no existe en ese directorio, se
// siembra por OPERACIONES REALES DEL ENGINE — SetPlaca(esp32-devkit-v1) +
// AgregarComponente(led) + AsignarPin(anodo, GPIO4) — nunca escribiendo el JSON a
// mano: el fixture pasa por la misma validación que cualquier otra operación
// (mismo criterio que ya usa `tests/phase2-helpers.mjs::prepararProyectoConLed`).
//
// `--una-vez`: imprime la URL + el snapshot (JSON) y cierra — pensado para
// tests/CI, que necesitan un resultado determinista sin quedarse escuchando.

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const REPO = join(AQUI, "..")

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))

const ID_PROYECTO_POR_DEFECTO = "demo"
const GPIO_DEMO = "GPIO4" // mismo pin que ya usan los fixtures de Phase 2 (phase2-helpers.mjs, GPIO_X) — sin restricciones en el ESP32.
// Fase 2, Slice 2 (§3.6, HD-S2-1b): GPIO18 para el pulsador — un pin normal, fuera
// de las cuatro listas de restricción del ESP32 (flashReservado 6-11, strapping
// 0/2/12/15, soloEntrada 34/35/36/39, uartUsb 1/3 — nucleo/placas.ts), y distinto de
// GPIO_DEMO para no chocar con el LED (PIN_OCUPADO).
const GPIO_DEMO_PULSADOR = "GPIO18"

function leerArgs(argv) {
  const args = { dir: undefined, idProyecto: ID_PROYECTO_POR_DEFECTO, unaVez: false }
  for (let i = 0; i < argv.length; i++) {
    const actual = argv[i]
    if (actual === "--dir") args.dir = argv[++i]
    else if (actual === "--id-proyecto") args.idProyecto = argv[++i]
    else if (actual === "--una-vez") args.unaVez = true
  }
  return args
}

function fabricarGeneradorDeIds(prefijo) {
  let contador = 0
  return () => `${prefijo}-${contador++}`
}

/**
 * Siembra ESP32 + LED (ánodo en GPIO4) vía operaciones REALES del Engine — sólo si
 * el proyecto todavía no tiene placa (proyecto recién creado, vacío). Si ya tiene
 * placa (una corrida anterior de este mismo launcher, releyendo el mismo
 * directorio), no vuelve a sembrar — evita pisar cualquier cambio que el navegador
 * haya guardado en el medio.
 */
function sembrarSiHaceFalta(servicio) {
  if (servicio.snapshot().proyecto.placa) return

  const siguienteId = fabricarGeneradorDeIds("demo-seed")

  let r = servicio.aplicar({ idOperacion: siguienteId(), actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
  if (!r.ok) throw new Error(`vista-fisica-demo: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)

  r = servicio.aplicar({ idOperacion: siguienteId(), actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AgregarComponente", payload: { tipo: "led" } })
  if (!r.ok) throw new Error(`vista-fisica-demo: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id

  r = servicio.aplicar({ idOperacion: siguienteId(), actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: GPIO_DEMO } })
  if (!r.ok) throw new Error(`vista-fisica-demo: AsignarPin rechazado: ${JSON.stringify(r.motivos)}`)

  // Fase 2, Slice 2 (§3.6, HD-S2-1b): pulsador, con el mismo criterio de operaciones
  // reales, actor "agente" — nunca escribiendo el JSON a mano.
  r = servicio.aplicar({ idOperacion: siguienteId(), actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AgregarComponente", payload: { tipo: "pulsador" } })
  if (!r.ok) throw new Error(`vista-fisica-demo: AgregarComponente(pulsador) rechazado: ${JSON.stringify(r.motivos)}`)
  const idPulsador = servicio.snapshot().proyecto.componentes[1].id

  r = servicio.aplicar({ idOperacion: siguienteId(), actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: GPIO_DEMO_PULSADOR } })
  if (!r.ok) throw new Error(`vista-fisica-demo: AsignarPin(pulsador) rechazado: ${JSON.stringify(r.motivos)}`)
}

async function main() {
  const args = leerArgs(process.argv.slice(2))
  const directorioPedido = args.dir ?? process.env.TECNIA_VISTA_FISICA_DIR
  if (!directorioPedido) {
    console.error("uso: node scripts/vista-fisica-demo.mjs --dir <directorio> [--id-proyecto <id>] [--una-vez]")
    console.error("     (o la variable de entorno TECNIA_VISTA_FISICA_DIR=<directorio>)")
    console.error("Nunca hay un directorio por defecto dentro del repo: indicá uno (ej. un os.tmpdir()).")
    process.exitCode = 1
    return
  }
  const directorio = resolve(directorioPedido)

  // Fix H5 (red-team Phase 2 Slice 1): si OTRO proceso ya tiene este
  // directorio+idProyecto abierto (candado de propiedad, servicio-con-vista.ts),
  // obtenerServicioDeProyectoConVista lanza — se atrapa acá para un mensaje CLARO
  // en stderr y un exit code de error, en vez de un stack trace crudo o (peor) un
  // proceso que se cuelga esperando algo que nunca va a pasar.
  let servicio
  try {
    servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto: args.idProyecto })
  } catch (error) {
    console.error(`vista-fisica-demo: no se pudo abrir el proyecto — ${error.message}`)
    process.exitCode = 1
    return
  }
  sembrarSiHaceFalta(servicio)

  const servidor = await iniciarServidor({ servicio })
  console.log(`Vista física — ${servidor.url}`)

  if (args.unaVez) {
    console.log(JSON.stringify(servicio.snapshot(), null, 2))
    await servidor.cerrar()
    servicio.cerrar()
    return
  }

  let cerrando = false
  const cerrar = async () => {
    if (cerrando) return
    cerrando = true
    await servidor.cerrar()
    servicio.cerrar()
    process.exit(0)
  }
  process.on("SIGINT", cerrar)
  process.on("SIGTERM", cerrar)
  // Sin --una-vez, el proceso queda vivo mientras el servidor tenga el listener
  // abierto (el propio `http.Server` ya mantiene el event loop activo) — no hace
  // falta ningún setInterval/sleep para "esperar".
}

await main()
