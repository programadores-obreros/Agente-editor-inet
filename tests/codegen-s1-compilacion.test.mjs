// Codegen MVP, Slice 1 — compilación REAL con PlatformIO (OD-CG-3 = A: opt-in).
//
// Sólo corre con `TECNIA_CODEGEN_PIO=1`: necesita PlatformIO y la plataforma fijada del registro
// instalados, y `pnpm test` tiene que seguir andando en máquinas sin PlatformIO.
//
// Prueba la cadena completa sin una sola línea de C++ escrita a mano:
//   proyecto armado con las operaciones del Engine → generarPrograma (codegen real) →
//   platformio.ini + src/main.cpp en un temporal → `pio run -e <env>` → firmware.
//
// Con `TECNIA_CODEGEN_EVIDENCIA=<carpeta>` copia ahí lo generado, el log, el comando, el código
// de salida y el sha256 del firmware: evidencia DECLARED para la revisión externa.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const ACTIVO = process.env.TECNIA_CODEGEN_PIO === "1"

test(
  "compilación real: IR (Engine) → generarPrograma → PlatformIO compila para esp32-devkit-v1",
  { skip: ACTIVO ? false : "opt-in: TECNIA_CODEGEN_PIO=1 (necesita PlatformIO instalado)", timeout: 15 * 60 * 1000 },
  async () => {
    const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
    const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
    const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
    const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
    const { condicionBooleanaCanonica } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
    const { pioCandidatos } = await import(join(REPO, "opencode/tool/platformio.ts"))

    // 1. Proyecto real, por las operaciones del Engine: «mientras el pulsador esté presionado, el LED está encendido».
    let proyecto = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => "proyecto-compilacion", ahora: () => "2026-01-01T00:00:00.000Z" })
    const ops = [
      ["SetPlaca", { placa: "esp32-devkit-v1" }],
      ["AgregarComponente", { tipo: "pulsador" }],
      ["AgregarComponente", { tipo: "led" }],
      ["AgregarComponente", { tipo: "resistencia" }],
      ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" }],
      ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }],
      ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
      ["SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", ...condicionBooleanaCanonica("estadoBooleano", "verdadero") }, entonces: { actuador: "cmp-1", accion: "encender" } } }],
    ]
    ops.forEach(([tipo, payload], i) => {
      const r = ejecutarOperacion(proyecto, { idOperacion: `op-${i}`, actor: "agente", baseRevision: proyecto.revision, tipo, payload }, K.catalogo)
      assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
      proyecto = r.proyecto
    })

    // 2. Generador real.
    const generado = generarPrograma(proyecto, K)
    assert.equal(generado.ok, true, JSON.stringify(generado.error ?? null))
    assert.equal(generado.environment, "esp32-devkit-v1")

    // 3. A un temporal, sólo los archivos generados.
    const dir = mkdtempSync(join(tmpdir(), "tecnia-codegen-s1-"))
    try {
      for (const [ruta, contenido] of Object.entries(generado.archivos)) {
        mkdirSync(join(dir, ruta, ".."), { recursive: true })
        writeFileSync(join(dir, ruta), contenido)
      }

      // 4-5. PlatformIO real, environment derivado.
      const pio = process.env.TECNIA_PIO_BIN ?? pioCandidatos().find((c) => existsSync(c)) ?? "pio"
      const argumentos = ["run", "-d", dir, "-e", generado.environment]
      const corrida = spawnSync(pio, argumentos, { encoding: "utf8", env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: "no" }, maxBuffer: 64 * 1024 * 1024 })
      const log = `${corrida.stdout ?? ""}${corrida.stderr ?? ""}`

      // 6-7. Exit 0 y firmware producido.
      const build = join(dir, ".pio", "build", generado.environment)
      const firmware = ["firmware.bin", "firmware.hex"].map((f) => join(build, f)).find((f) => existsSync(f))
      const evidencia = process.env.TECNIA_CODEGEN_EVIDENCIA
      if (evidencia) {
        mkdirSync(evidencia, { recursive: true })
        writeFileSync(join(evidencia, "platformio.ini"), generado.archivos["platformio.ini"])
        writeFileSync(join(evidencia, "main.cpp"), generado.archivos["src/main.cpp"])
        writeFileSync(join(evidencia, "pio-run.log"), log)
        const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex")
        const resumen = {
          comando: [pio.replace(homedir(), "~"), ...argumentos.map((a) => (a === dir ? "<temporal>" : a))].join(" "),
          environment: generado.environment,
          exitCode: corrida.status,
          error: corrida.error ? String(corrida.error) : null,
          archivos: Object.fromEntries(Object.entries(generado.archivos).map(([ruta, contenido]) => [ruta, createHash("sha256").update(contenido).digest("hex")])),
          firmware: firmware ? { archivo: firmware.slice(build.length + 1), bytes: statSync(firmware).size, sha256: sha(firmware) } : null,
          elf: existsSync(join(build, "firmware.elf")) ? { bytes: statSync(join(build, "firmware.elf")).size, sha256: sha(join(build, "firmware.elf")) } : null,
        }
        writeFileSync(join(evidencia, "resumen.json"), `${JSON.stringify(resumen, null, 2)}\n`)
      }
      assert.equal(corrida.error, undefined, String(corrida.error))
      assert.equal(corrida.status, 0, log.slice(-4000))
      assert.ok(firmware && statSync(firmware).size > 0, "no se produjo firmware")
      assert.ok(existsSync(join(build, "firmware.elf")), "no se produjo firmware.elf")
    } finally {
      // 8. Limpieza.
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
