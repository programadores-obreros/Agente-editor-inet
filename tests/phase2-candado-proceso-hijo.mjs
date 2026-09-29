// Hijo de proceso real para tests/phase2-candado-proceso.test.mjs (H5). Construye su
// PROPIA raíz de composición (su propio proceso de SO) vía `servicio-con-vista.ts` —
// el camino de PRODUCCIÓN real (tool de OpenCode, servidor HTTP, demo launcher) —
// sobre el MISMO directorio+idProyecto que otro proceso hermano.
//
// Protocolo por stdin/stdout, DETERMINISTA (sin sleep — mismo criterio que el resto
// del slice): el módulo (importe pesado: catálogo real, hash-catalogo.node.ts) se
// carga ANTES de anunciar "LISTO", así que la carrera real ocurre recién cuando el
// orquestador manda "ABRIR" a los dos hijos, lo más simultáneo posible — nunca antes,
// nunca dependiendo de cuánto tarda cada proceso en arrancar/importar. Si este hijo
// GANA el candado, se queda vivo (sosteniendo el candado) hasta recibir "CERRAR" por
// stdin — así el hermano que pierde la carrera ve el candado REALMENTE tomado en el
// momento de su propio intento, en vez de una condición de carrera del harness donde
// el ganador ya terminó y liberó antes de que el perdedor llegara a intentar.
import { join } from "node:path"
const REPO = process.env.REPO_OBJ
const [, , directorio, idProyecto, etiqueta] = process.argv

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))

function esperarLinea() {
  return new Promise((resolve) => {
    process.stdin.once("data", (d) => resolve(d.toString().trim()))
  })
}

console.log("LISTO")
await esperarLinea() // "ABRIR"

let servicio = null
try {
  servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  const r = servicio.aplicar({ idOperacion: `${etiqueta}-op`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
  console.log(JSON.stringify({ etiqueta, abrio: true, ok: r.ok, motivos: r.ok ? null : r.motivos }))
} catch (error) {
  console.log(JSON.stringify({ etiqueta, abrio: false, mensaje: error.message, code: error.code }))
}

if (servicio) {
  await esperarLinea() // "CERRAR" — recien ahi libera el candado y termina.
  servicio.cerrar()
}
process.exit(0)
