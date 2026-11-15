// Hijo de proceso real para tests/carga-puertos.test.mjs: un proceso de sistema
// operativo APARTE que intenta reservar un puerto con `opencode/carga/puertos.ts`.
//
// NO es `*.test.mjs`: `node --test tests/*.test.mjs` no lo corre como suite.
//
// Protocolo por stdin/stdout, DETERMINISTA y sin esperas a ciegas (el mismo de
// tests/phase2-candado-proceso-hijo.mjs):
//
//   1. importa el módulo y recién entonces escribe "LISTO";
//   2. espera "RESERVAR" — así la carrera entre dos hijos empieza cuando el test manda
//      la orden a los dos, no cuando a cada uno se le ocurre terminar de arrancar;
//   3. escribe UNA línea JSON con el resultado de `reservarPuerto`;
//   4. si reservó, se queda vivo, dueño del puerto, hasta la próxima orden:
//        "LIBERAR" → llama a `liberar()` y termina bien;
//        "MORIR"   → se mata con SIGKILL SIN liberar (un proceso que se cayó: el
//                    `process.on("exit")` no llega a correr y el candado queda).
//
// Nunca toca un puerto serie de verdad: `reservarPuerto` sólo escribe un archivo bajo
// `XDG_CONFIG_HOME`, que el test fija a un temporal.
import { join } from "node:path"

const [, , puerto, etiqueta] = process.argv
const REPO = process.env.REPO_OBJ
if (!process.env.XDG_CONFIG_HOME) throw new Error("carga-puertos-hijo: falta XDG_CONFIG_HOME (no se escribe nunca en la config real)")

const { reservarPuerto } = await import(join(REPO, "opencode/carga/puertos.ts"))

function esperarLinea() {
  return new Promise((resolve) => {
    process.stdin.once("data", (d) => resolve(d.toString().trim()))
  })
}

console.log("LISTO")
await esperarLinea() // "RESERVAR"

const reserva = reservarPuerto(puerto, etiqueta)
console.log(JSON.stringify({ etiqueta, pid: process.pid, ok: reserva.ok, codigo: reserva.ok ? null : reserva.codigo, detalle: reserva.ok ? null : reserva.detalle }))

if (reserva.ok) {
  const orden = await esperarLinea()
  if (orden === "MORIR") process.kill(process.pid, "SIGKILL")
  reserva.liberar()
}
process.exit(0)
