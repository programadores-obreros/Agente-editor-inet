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
//
// Codegen S2b: dos protocolos comparten la capa física del bus de un solo cable (`driverDeBusUnico`)
// y difieren en lo que los define: la duración del pulso de inicio y el significado de los bytes.
// Cada backend emite SU driver con SU prefijo de funciones: si un proyecto tiene piezas de los dos
// protocolos, `programa.ts` emite los dos drivers en el mismo `main.cpp` sin colisión de nombres
// (deuda CG-DUP-01: primitivas duplicadas en ese caso, aceptada hasta que aparezca el caso real).

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

// ════════════════════════════════════════════════════════════════════════════════════
// Capa física compartida: bus de un solo cable, en reposo en alto (familia `bus-unico`)
// ════════════════════════════════════════════════════════════════════════════════════

interface ParametrosBusUnico {
  /** Id del protocolo en `PROTOCOLOS_DE_LECTURA`; el prefijo de las funciones C++ es su último segmento. */
  readonly protocolo: string
  /** Fuente del protocolo, tal como va en el comentario del driver. */
  readonly cita: string
  /** Microsegundos que el host mantiene el bus en bajo para iniciar la lectura (espera activa: bloquea el `loop`). */
  readonly pulsoInicioUs: number
  /** Comentarios del programa generado (una línea cada uno, sin acentos: el C++ generado es ASCII). */
  readonly comentarios: { readonly inicio: string; readonly respuesta: string; readonly bits: string }
}

/** Prefijo de las funciones del driver: el último segmento del id del protocolo (`bus-unico-am2302` → `am2302`). */
export function prefijoDeProtocolo(protocolo: string): string {
  return protocolo.slice(protocolo.lastIndexOf("-") + 1)
}

/**
 * Driver de un bus de un solo cable. El host lleva el bus a bajo `pulsoInicioUs` y lo suelta; el
 * sensor responde con un bajo y un alto y manda 40 bits, cada uno un bajo seguido de un alto corto
 * (0) o largo (1); al final baja el bus y lo suelta. El bit se decide comparando su alto con su
 * propio bajo (no contra una constante de reloj). Los 5 bytes se validan con la suma de control de
 * los primeros 4. Qué significan los bytes NO es de esta capa: lo dicen los `campos` del backend.
 */
function driverDeBusUnico({ protocolo, cita, pulsoInicioUs, comentarios }: ParametrosBusUnico): readonly string[] {
  const p = prefijoDeProtocolo(protocolo)
  return [
    `// Driver del protocolo ${protocolo} (lo elige el backend por el protocolo que declara`,
    `// Component Knowledge, no por el componente). ${cita}.`,
    "// Espera mientras el bus esta en `nivel`: devuelve los us que duro + 1, o 0 si paso el limite.",
    `static uint32_t ${p}_esperar(uint8_t pin, int nivel, uint32_t limite_us) {`,
    "  const uint32_t inicio = micros();",
    "  while (digitalRead(pin) == nivel) {",
    "    if (micros() - inicio > limite_us) return 0;",
    "  }",
    "  return micros() - inicio + 1;",
    "}",
    "",
    "// Una lectura completa: 5 bytes con suma de control. false = lectura invalida.",
    `static bool ${p}_leer(uint8_t pin, uint8_t datos[]) {`,
    "  for (int i = 0; i < 5; i++) datos[i] = 0;",
    `  // ${comentarios.inicio}`,
    "  pinMode(pin, OUTPUT);",
    "  digitalWrite(pin, LOW);",
    `  delayMicroseconds(${pulsoInicioUs});`,
    "  pinMode(pin, INPUT_PULLUP);",
    "  bool ok = true;",
    "  noInterrupts();",
    `  // ${comentarios.respuesta}`,
    `  if (${p}_esperar(pin, HIGH, 250) == 0) ok = false;`,
    `  if (ok && ${p}_esperar(pin, LOW, 150) == 0) ok = false;`,
    `  if (ok && ${p}_esperar(pin, HIGH, 150) == 0) ok = false;`,
    `  // ${comentarios.bits}`,
    "  for (int i = 0; ok && i < 40; i++) {",
    `    const uint32_t bajo = ${p}_esperar(pin, LOW, 150);`,
    `    const uint32_t alto = ${p}_esperar(pin, HIGH, 150);`,
    "    if (bajo == 0 || alto == 0) ok = false;",
    "    datos[i >> 3] = (datos[i >> 3] << 1) | (alto > bajo ? 1 : 0);",
    "  }",
    "  interrupts();",
    "  if (!ok) return false;",
    "  return ((datos[0] + datos[1] + datos[2] + datos[3]) & 0xFF) == datos[4];",
    "}",
  ]
}

// ════════════════════════════════════════════════════════════════════════════════════
// Backends
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * `bus-unico-am2302`: el host lleva el bus a bajo ≥ 800 µs (típico 1 ms) y lo suelta; el sensor
 * responde ~80 µs en bajo y ~80 µs en alto y manda 40 bits: cada uno empieza con ~50 µs en bajo y
 * sigue con ~26-28 µs en alto (0) o ~70 µs (1); al final baja el bus ~50 µs y lo suelta. Datos:
 * humedad (16 bits, ×0,1 %), temperatura (15 bits, ×0,1 °C, bit 15 = signo) y suma de control de
 * los 4 bytes (Aosong, Manual AM2302 v1.1, §7.3-§7.4).
 *
 * S2b: el driver sale de `driverDeBusUnico` con EXACTAMENTE las mismas líneas que antes del
 * refactor (test REG-2 de `codegen-s2b-dht11.test.mjs`: hash fijado en el baseline 4f53b65).
 */
const BUS_UNICO_AM2302: BackendDeProtocolo = {
  funcion: "am2302_leer",
  bytes: 5,
  driver: driverDeBusUnico({
    protocolo: "bus-unico-am2302",
    cita: "Aosong, Manual AM2302 v1.1, 7.3-7.4",
    pulsoInicioUs: 1100,
    comentarios: {
      inicio: "Senal de inicio: el host lleva el bus a bajo al menos 800 us (tipico 1 ms) y lo suelta.",
      respuesta: "Respuesta del sensor: baja el bus (~80 us) y lo sube (~80 us).",
      bits: "40 bits: ~50 us en bajo y despues ~26-28 us (0) o ~70 us (1) en alto.",
    },
  }),
  terminal: { electrica: "digital", direccion: "bidireccional" },
  campos: [
    { magnitud: "humedad", ucum: "%", expresion: (d) => `((${d}[0] << 8) | ${d}[1]) * 0.1f` },
    { magnitud: "temperatura", ucum: "Cel", expresion: (d) => `(((${d}[2] & 0x7F) << 8) | ${d}[3]) * ((${d}[2] & 0x80) ? -0.1f : 0.1f)` },
  ],
}

/**
 * `bus-unico-dht11` (Codegen S2b): el host lleva el bus a bajo al menos 18 ms y no más de 30 ms
 * (se usan 20 ms: espera activa que bloquea el `loop` esos 20 ms, una vez por período del catálogo);
 * el sensor responde ~83 µs en bajo y ~87 µs en alto y manda 40 bits: ~54 µs en bajo y ~24 µs (0)
 * o ~71 µs (1) en alto; al final baja el bus ~54 µs y lo suelta. Datos: humedad entera, humedad
 * decimal, temperatura entera, temperatura decimal y suma de control; el bit 7 del byte decimal de
 * temperatura es el signo (Aosong, DHT11 Product Manual V1.3, 2017-03-31, comunicación serie y
 * tabla 10). La misma capa física que el AM2302; OTRO significado de los bytes: por eso es otro
 * protocolo y otro decodificador, nunca una variante.
 *
 * Política ante fallas (D3 = A, igual que el AM2302): sin respuesta, bit fuera de tiempo o suma de
 * control incorrecta → `false`; `programa.ts` deja la lectura inválida y el actuador en su reposo.
 */
const BUS_UNICO_DHT11: BackendDeProtocolo = {
  funcion: `${prefijoDeProtocolo("bus-unico-dht11")}_leer`,
  bytes: 5,
  driver: driverDeBusUnico({
    protocolo: "bus-unico-dht11",
    cita: "Aosong, DHT11 Product Manual V1.3 (2017-03-31), comunicacion serie y tabla 10",
    pulsoInicioUs: 20000,
    comentarios: {
      inicio: "Senal de inicio: el host lleva el bus a bajo al menos 18 ms (maximo 30 ms); 20 ms, bloqueantes, una vez por periodo.",
      respuesta: "Respuesta del sensor: baja el bus (~83 us) y lo sube (~87 us).",
      bits: "40 bits: ~54 us en bajo y despues ~24 us (0) o ~71 us (1) en alto.",
    },
  }),
  terminal: { electrica: "digital", direccion: "bidireccional" },
  campos: [
    { magnitud: "humedad", ucum: "%", expresion: (d) => `${d}[0] + ${d}[1] * 0.1f` },
    { magnitud: "temperatura", ucum: "Cel", expresion: (d) => `(${d}[2] + (${d}[3] & 0x7F) * 0.1f) * ((${d}[3] & 0x80) ? -1.0f : 1.0f)` },
  ],
}

/** Registro protocolo → backend. Un protocolo de Component Knowledge sin entrada acá no se genera. */
export const BACKENDS_DE_PROTOCOLO: Readonly<Record<string, BackendDeProtocolo>> = Object.freeze({
  "bus-unico-am2302": BUS_UNICO_AM2302,
  "bus-unico-dht11": BUS_UNICO_DHT11,
})

export function backendDeProtocolo(backends: Readonly<Record<string, BackendDeProtocolo>>, protocolo: string): BackendDeProtocolo | undefined {
  return Object.hasOwn(backends, protocolo) ? backends[protocolo] : undefined
}
