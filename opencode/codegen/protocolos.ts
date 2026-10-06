// Codegen MVP, Slice 2 — backends de lectura POR PROTOCOLO (D2 = A).
//
// Component Knowledge declara QUÉ protocolo habla la pieza (`Capacidad.lectura.protocolo`, del
// registro `PROTOCOLOS_DE_LECTURA`) y sus restricciones de uso (período mínimo, espera tras el
// encendido). Este registro dice CÓMO lo implementa el backend Arduino: el driver en C++ y cómo
// sale cada capacidad de los datos del protocolo. Se elige por el id del PROTOCOLO, nunca por el
// id del componente: cualquier pieza que declare el mismo protocolo usa el mismo driver.
//
// El driver lo emite el backend (sin librería externa ni `lib_deps`): el programa generado
// compila sin red y no depende de la versión de un paquete de terceros. Los tiempos del protocolo
// (pulso de inicio, duración de los bits) son del driver; los que Component Knowledge declara
// (período, espera) NO están acá: los aplica `programa.ts` desde `lecturaDeCapacidad`.
//
// Puro: sin I/O, sin reloj, sin estado. Las líneas usan un subconjunto chico de C++ (enteros,
// `for`, `while`, arreglos) que los tests traducen y ejecutan contra un sensor simulado.

/** Cómo sale una capacidad de los datos de una lectura del protocolo. */
export interface CampoDeProtocolo {
  /** Magnitud (vocabulario del catálogo) que entrega el campo. */
  readonly magnitud: string
  /** Unidad en que la entrega, por su código UCUM: el backend no conoce ids de unidades ni convierte. */
  readonly ucum: string
  /** Expresión C++ `float` del valor, sobre el arreglo de bytes `datos`. */
  readonly expresion: (datos: string) => string
}

export interface BackendDeProtocolo {
  /** Función C++ del driver: `bool <funcion>(uint8_t pin, uint8_t datos[])`; `false` = lectura inválida. */
  readonly funcion: string
  /** Bytes que deja en `datos` una lectura válida. */
  readonly bytes: number
  /** Definición C++ del driver (va una vez por programa, antes de `setup`). */
  readonly driver: readonly string[]
  /** Forma eléctrica que el driver necesita en el terminal: el host lo maneja Y lo lee. */
  readonly terminal: { readonly electrica: "digital"; readonly direccion: "bidireccional" }
  readonly campos: readonly CampoDeProtocolo[]
}

/**
 * `bus-unico-am2302`: un solo cable, en reposo en alto. El host lleva el bus a bajo ≥ 800 µs
 * (típico 1 ms) y lo suelta; el sensor responde ~80 µs en bajo y ~80 µs en alto y manda 40 bits:
 * cada uno empieza con ~50 µs en bajo y sigue con ~26-28 µs en alto (0) o ~70 µs (1); al final
 * baja el bus ~50 µs y lo suelta. Datos: humedad (16 bits, ×0,1 %), temperatura (15 bits,
 * ×0,1 °C, bit 15 = signo) y suma de control de los 4 bytes (Aosong, Manual AM2302 v1.1, §7.3-§7.4).
 * El bit se decide comparando su alto con su propio bajo (no contra una constante de reloj).
 */
const BUS_UNICO_AM2302: BackendDeProtocolo = {
  funcion: "am2302_leer",
  bytes: 5,
  driver: [
    "// Driver del protocolo bus-unico-am2302 (lo elige el backend por el protocolo que declara",
    "// Component Knowledge, no por el componente). Aosong, Manual AM2302 v1.1, 7.3-7.4.",
    "// Espera mientras el bus esta en `nivel`: devuelve los us que duro + 1, o 0 si paso el limite.",
    "static uint32_t am2302_esperar(uint8_t pin, int nivel, uint32_t limite_us) {",
    "  const uint32_t inicio = micros();",
    "  while (digitalRead(pin) == nivel) {",
    "    if (micros() - inicio > limite_us) return 0;",
    "  }",
    "  return micros() - inicio + 1;",
    "}",
    "",
    "// Una lectura completa: 5 bytes con suma de control. false = lectura invalida.",
    "static bool am2302_leer(uint8_t pin, uint8_t datos[]) {",
    "  for (int i = 0; i < 5; i++) datos[i] = 0;",
    "  // Senal de inicio: el host lleva el bus a bajo al menos 800 us (tipico 1 ms) y lo suelta.",
    "  pinMode(pin, OUTPUT);",
    "  digitalWrite(pin, LOW);",
    "  delayMicroseconds(1100);",
    "  pinMode(pin, INPUT_PULLUP);",
    "  bool ok = true;",
    "  noInterrupts();",
    "  // Respuesta del sensor: baja el bus (~80 us) y lo sube (~80 us).",
    "  if (am2302_esperar(pin, HIGH, 250) == 0) ok = false;",
    "  if (ok && am2302_esperar(pin, LOW, 150) == 0) ok = false;",
    "  if (ok && am2302_esperar(pin, HIGH, 150) == 0) ok = false;",
    "  // 40 bits: ~50 us en bajo y despues ~26-28 us (0) o ~70 us (1) en alto.",
    "  for (int i = 0; ok && i < 40; i++) {",
    "    const uint32_t bajo = am2302_esperar(pin, LOW, 150);",
    "    const uint32_t alto = am2302_esperar(pin, HIGH, 150);",
    "    if (bajo == 0 || alto == 0) ok = false;",
    "    datos[i >> 3] = (datos[i >> 3] << 1) | (alto > bajo ? 1 : 0);",
    "  }",
    "  interrupts();",
    "  if (!ok) return false;",
    "  return ((datos[0] + datos[1] + datos[2] + datos[3]) & 0xFF) == datos[4];",
    "}",
  ],
  terminal: { electrica: "digital", direccion: "bidireccional" },
  campos: [
    { magnitud: "humedad", ucum: "%", expresion: (d) => `((${d}[0] << 8) | ${d}[1]) * 0.1f` },
    { magnitud: "temperatura", ucum: "Cel", expresion: (d) => `(((${d}[2] & 0x7F) << 8) | ${d}[3]) * ((${d}[2] & 0x80) ? -0.1f : 0.1f)` },
  ],
}

/** Registro protocolo → backend. Un protocolo de Component Knowledge sin entrada acá no se genera. */
export const BACKENDS_DE_PROTOCOLO: Readonly<Record<string, BackendDeProtocolo>> = Object.freeze({
  "bus-unico-am2302": BUS_UNICO_AM2302,
})

export function backendDeProtocolo(backends: Readonly<Record<string, BackendDeProtocolo>>, protocolo: string): BackendDeProtocolo | undefined {
  return Object.hasOwn(backends, protocolo) ? backends[protocolo] : undefined
}
