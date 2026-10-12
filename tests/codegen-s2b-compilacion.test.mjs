// Codegen S2b — compilación REAL de la vertical numérica del DHT11 por el camino del agente
// (opt-in, como en S2): «mientras la temperatura del DHT11 sea mayor a 30 °C, el LED está
// encendido» en ESP32.
//
// Sólo corre con `TECNIA_CODEGEN_PIO=1` (necesita PlatformIO y la plataforma fijada instalados;
// el driver del protocolo lo emite el backend, así que no hace falta ninguna librería ni red).
//
//   tool proyecto-fisico (aplicar) → IR del Engine → tool programa (compilar) →
//   generarPrograma (Component Knowledge: lecturaDeCapacidad → backend bus-unico-dht11) →
//   carpeta derivada → runner real de platformio.ts → `pio run` → firmware
//
// `platformio.ts::run` lanza procesos con `Bun.spawn` (OpenCode corre sobre Bun). Bajo `node
// --test` no hay Bun, así que este test le da un `Bun.spawn` mínimo que lanza el proceso REAL
// con `child_process`: PlatformIO corre de verdad, con el comando que armó la tool.
//
// Con `TECNIA_CODEGEN_EVIDENCIA=<carpeta>` deja ahí la salida de la tool, lo compilado y los
// hashes (evidencia DECLARED para la revisión externa).

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const ACTIVO = process.env.TECNIA_CODEGEN_PIO === "1"

/** `Bun.spawn` sobre un proceso real (sólo lo que usa `platformio.ts::run`). */
function bunReal() {
  const comandos = []
  return {
    comandos,
    which: () => null,
    spawn(cmd, opciones) {
      comandos.push([...cmd])
      const hijo = spawn(cmd[0], cmd.slice(1), { cwd: opciones.cwd, signal: opciones.signal, env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: "no" } })
      hijo.on("error", () => {})
      return {
        stdout: Readable.toWeb(hijo.stdout),
        stderr: Readable.toWeb(hijo.stderr),
        exited: new Promise((resolve) => hijo.on("close", (codigo) => resolve(codigo ?? 1))),
        kill: () => hijo.kill(),
      }
    },
  }
}

test(
  "compilación real de la vertical numérica del DHT11: temperatura > 30 °C → LED, por la tool programa, PlatformIO compila esp32-devkit-v1 (S2b)",
  { skip: ACTIVO ? false : "opt-in: TECNIA_CODEGEN_PIO=1 (necesita PlatformIO instalado)", timeout: 15 * 60 * 1000 },
  async () => {
    const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
    const programa = (await import(join(REPO, "opencode/tool/programa.ts"))).default
    const { carpetaDelPrograma } = await import(join(REPO, "opencode/tool/programa.ts"))
    const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
    const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
    const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
    const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))

    const dir = nuevoDir("codegen-s2b-pio")
    const ctx = { directory: dir }
    try {
      // 1. «Mientras la temperatura del DHT11 sea mayor a 30 °C, el LED está encendido», por la tool del agente.
      const operaciones = [
        { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
        { tipo: "AgregarComponente", payload: { tipo: "dht11" } },
        { tipo: "AgregarComponente", payload: { tipo: "led" } },
        { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
        { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO4" } },
        { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" } },
        { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
        {
          tipo: "SetComportamiento",
          payload: { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
        },
      ]
      const aplicado = JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: 0, operaciones }, ctx))
      assert.equal(aplicado.ok, true, JSON.stringify(aplicado))

      // 2. Compilar por la tool programa, con PlatformIO real.
      const bun = bunReal()
      const anterior = globalThis.Bun
      globalThis.Bun = bun
      let salida
      try {
        salida = JSON.parse(await programa.execute({ accion: "compilar" }, ctx))
      } finally {
        globalThis.Bun = anterior
      }

      // 3. Lo compilado es exactamente lo que genera generarPrograma para esa revisión.
      const proyecto = obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto: "activo" }).snapshot().proyecto
      const esperado = generarPrograma(proyecto, K)
      const carpeta = carpetaDelPrograma(dir, "activo")
      const compilado = Object.fromEntries(Object.keys(esperado.archivos).map((ruta) => [ruta, readFileSync(join(carpeta, ruta), "utf8")]))
      const build = join(carpeta, ".pio", "build", esperado.environment)
      const firmware = join(build, "firmware.bin")
      const sha = (contenido) => createHash("sha256").update(contenido).digest("hex")

      const evidencia = process.env.TECNIA_CODEGEN_EVIDENCIA
      if (evidencia) {
        mkdirSync(evidencia, { recursive: true })
        writeFileSync(join(evidencia, "salida-programa-compilar.json"), `${JSON.stringify(salida, null, 2)}\n`)
        writeFileSync(join(evidencia, "main.cpp"), compilado["src/main.cpp"])
        writeFileSync(join(evidencia, "platformio.ini"), compilado["platformio.ini"])
        const resumen = {
          comandos: bun.comandos.map((c) => c.map((p) => p.replace(dir, "<proyecto>").replace(homedir(), "~")).join(" ")),
          etapa: salida.etapa,
          ok: salida.ok,
          revision: salida.revision,
          vigente: salida.vigente,
          environment: salida.environment,
          firmware: salida.firmware,
          compiladoIgualAGenerado: JSON.stringify(compilado) === JSON.stringify(esperado.archivos),
          sha256: {
            "platformio.ini": sha(compilado["platformio.ini"]),
            "src/main.cpp": sha(compilado["src/main.cpp"]),
            "firmware.bin": existsSync(firmware) ? sha(readFileSync(firmware)) : null,
          },
        }
        writeFileSync(join(evidencia, "resumen.json"), `${JSON.stringify(resumen, null, 2)}\n`)
      }

      assert.equal(salida.ok, true, JSON.stringify(salida))
      assert.equal(salida.etapa, "compilacion")
      assert.equal(salida.environment, "esp32-devkit-v1")
      assert.equal(salida.vigente, true)
      assert.match(salida.resultado, /^COMPILADO — revisión \d+, environment esp32-devkit-v1$/)
      assert.equal(bun.comandos.length, 1, "un solo proceso: pio run")
      assert.deepEqual(bun.comandos[0].slice(1), ["run", "-d", carpeta, "-e", "esp32-devkit-v1"])
      assert.deepEqual(compilado, esperado.archivos, "PlatformIO compiló exactamente lo que generó el codegen")
      // Lo compilado es el programa numérico por protocolo, sin librerías externas.
      assert.match(compilado["src/main.cpp"], /valida_cmp_0_senal = dht11_leer\(PIN_CMP_0_SENAL, datos_cmp_0_senal\);/)
      assert.match(compilado["src/main.cpp"], /const bool beh_\d+ = valida_cmp_0_temperatura && cmp_0_temperatura > 30\.0f;/)
      assert.doesNotMatch(compilado["platformio.ini"], /lib_deps/)
      assert.ok(existsSync(firmware) && salida.firmware?.archivo === "firmware.bin" && salida.firmware.bytes > 0, "no se produjo firmware")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
