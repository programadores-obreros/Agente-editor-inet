// H-02 — corpus de proyectos VÁLIDOS para probar que la corrección no cambió ni un byte de lo que
// el generador emite (no es un archivo de tests: lo importan `codegen-h02-inyeccion.test.mjs` y
// el script de evidencia que fijó los sha256 sobre 48ae491, antes de tocar el codegen).
//
// Recibe la raíz del repo para poder correr el MISMO corpus contra otra copia del código (la de
// base): así los sha256 de D1 no salieron de la versión corregida.
//
// Todos los proyectos se arman con las operaciones reales del Engine y el catálogo real. Cubren
// las dos lecturas (nivel y protocolo), los dos protocolos, las dos placas, los cuatro
// comparadores, las dos acciones, umbrales negativos, decimales, con exponente y convertidos de
// unidad e ids de dos dígitos. (El banco analógico del UNO no entra: en el catálogo real esos
// pines sólo son ADC y ningún proyecto LISTO los usa; `pinAnalogico` se prueba en
// `codegen-h02-emision.test.mjs`; extremo a extremo no hay cómo llegar, ver G8.)

import { join } from "node:path"

export async function corpusValido(repo) {
  const { CONOCIMIENTO_ACTIVO: K } = await import(join(repo, "opencode/conocimiento/conocimiento-activo.ts"))
  const { crearProyecto } = await import(join(repo, "opencode/nucleo/cargador.ts"))
  const { ejecutarOperacion } = await import(join(repo, "opencode/nucleo/operaciones.ts"))
  const { REVISIONES_DEL_ANEXO } = await import(join(repo, "opencode/conocimiento/admision.ts"))

  function construir(id, ops) {
    let p = crearProyecto({ catalogoVersion: K.catalogo.version, catalogoHash: K.catalogo.hash, generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z" })
    ops.forEach(([tipo, payload], i) => {
      const r = ejecutarOperacion(p, { idOperacion: `op-${i}`, actor: "agente", baseRevision: p.revision, tipo, payload }, K.catalogo)
      if (!r.ok) throw new Error(`corpus ${id}, ${tipo}: ${JSON.stringify(r.motivos)}`)
      p = r.proyecto
    })
    return p
  }

  const regla = (sensor, cuando, actuador, accion = "encender") => ["SetComportamiento", { comportamiento: { cuando: { sensor, ...cuando }, entonces: { actuador, accion } } }]
  const T = (valor, comparador = ">", unidad = "celsius") => ({ capacidad: "temperatura", comparador, umbral: { valor, unidad, magnitud: "temperatura" } })
  const H = (valor, comparador = ">") => ({ capacidad: "humedad", comparador, umbral: { valor, unidad: "porcentaje", magnitud: "humedad" } })
  const B = (valor, comparador = ">=") => ({ capacidad: "estadoBooleano", comparador, umbral: { valor, unidad: "ninguna", magnitud: "estadoBooleano" } })

  /** Placa + sensor (cmp-0) + LED (cmp-1) + resistencia (cmp-2) + conexión (conn-3). */
  const base = (placa, sensor, pinSensor, pinLed) => [
    ["SetPlaca", { placa }],
    ["AgregarComponente", { tipo: sensor }],
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: pinSensor }],
    ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: pinLed }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
  ]
  const esp32 = (sensor, ...reglas) => [...base("esp32-devkit-v1", sensor, "GPIO4", "GPIO18"), ...reglas]
  /** Un segundo LED (cmp-4) con su resistencia (cmp-5) y su conexión (conn-6). */
  const segundoLed = [
    ["AgregarComponente", { tipo: "led" }],
    ["AgregarComponente", { tipo: "resistencia" }],
    ["AsignarPin", { componente: "cmp-4", terminal: "anodo", pin: "GPIO19" }],
    ["Conectar", { desde: { componente: "cmp-5", terminal: "a" }, hasta: { componente: "cmp-4", terminal: "anodo" } }],
  ]
  const revisionesUno = {
    placas: [...REVISIONES_DEL_ANEXO.placas, { placa: "arduino-uno", revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }],
    componentes: [...REVISIONES_DEL_ANEXO.componentes, ...["led", "pulsador", "resistencia"].map((tipo) => ({ tipo, placa: "arduino-uno", revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }))],
  }

  const casos = [
    ["pulsador-encender", esp32("pulsador", regla("cmp-0", B(1), "cmp-1"))],
    ["pulsador-suelto-apagar", esp32("pulsador", regla("cmp-0", B(1, "<"), "cmp-1", "apagar"))],
    ["interruptor-encender", esp32("interruptor", regla("cmp-0", B(1), "cmp-1"))],
    ["dht22-temperatura-mayor-30", esp32("dht22", regla("cmp-0", T(30), "cmp-1"))],
    ["dht22-temperatura-menor-negativo-decimal", esp32("dht22", regla("cmp-0", T(-5.5, "<"), "cmp-1"))],
    ["dht22-temperatura-mayor-igual-fahrenheit", esp32("dht22", regla("cmp-0", T(86, ">=", "fahrenheit"), "cmp-1"))],
    ["dht22-humedad-menor-igual-apagar", esp32("dht22", regla("cmp-0", H(80, "<="), "cmp-1", "apagar"))],
    ["dht22-umbral-cero", esp32("dht22", regla("cmp-0", T(0), "cmp-1"))],
    ["dht22-umbral-cero-negativo", esp32("dht22", regla("cmp-0", T(-0), "cmp-1"))],
    ["dht22-umbral-exponente-chico", esp32("dht22", regla("cmp-0", T(1e-7), "cmp-1"))],
    ["dht22-umbral-exponente-grande", esp32("dht22", regla("cmp-0", T(1e21), "cmp-1"))],
    ["dht22-dos-leds-temperatura-y-humedad", [...esp32("dht22"), ...segundoLed, regla("cmp-0", T(30), "cmp-1"), regla("cmp-0", H(60), "cmp-4")]],
    ["dht11-temperatura-mayor-30", esp32("dht11", regla("cmp-0", T(30), "cmp-1"))],
    [
      "dht22-y-dht11-dos-drivers",
      [
        ...esp32("dht22"),
        ...segundoLed,
        ["AgregarComponente", { tipo: "dht11" }],
        ["AsignarPin", { componente: "cmp-7", terminal: "senal", pin: "GPIO5" }],
        regla("cmp-0", T(30), "cmp-1"),
        regla("cmp-7", H(40, "<"), "cmp-4"),
      ],
    ],
    [
      "ids-de-dos-digitos",
      [
        ["SetPlaca", { placa: "esp32-devkit-v1" }],
        ...Array.from({ length: 10 }, () => ["AgregarComponente", { tipo: "resistencia" }]),
        ["AgregarComponente", { tipo: "pulsador" }],
        ["AgregarComponente", { tipo: "led" }],
        ["AsignarPin", { componente: "cmp-10", terminal: "senal", pin: "GPIO4" }],
        ["AsignarPin", { componente: "cmp-11", terminal: "anodo", pin: "GPIO18" }],
        ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-11", terminal: "anodo" } }],
        regla("cmp-10", B(1), "cmp-11"),
      ],
    ],
    ["uno-pulsador-led", [...base("arduino-uno", "pulsador", "D2", "D7"), regla("cmp-0", B(1), "cmp-1")], { revisiones: revisionesUno }],
  ]
  return { K, casos: casos.map(([nombre, ops, opciones]) => ({ nombre, proyecto: construir(`corpus-${nombre}`, ops), opciones })) }
}
