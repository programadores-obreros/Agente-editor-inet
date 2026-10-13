// ANEXO DE REVISIÓN ELÉCTRICA — Component Knowledge F2a (CK-04,
// `component-knowledge/18_F2A_SCOPE.md` §2 F2a-2).
//
// Revisión HUMANA de los hechos eléctricos (D-13): ningún flag la aprueba la IA ni un
// importador. La validez eléctrica depende del PAR (componente, placa), no del componente
// solo (un HC-SR04 es seguro en un UNO y daña un ESP32 sin adaptación), así que cada
// revisión de componente nombra la placa para la que se hizo.
//
// Antes vivía como `REVISION_ELECTRICA` (por id) dentro de `conocimiento/admision.ts`. Se
// mudó sin cambiar ningún resultado: las tres piezas del conjunto inicial se revisaron en el
// contexto ESP32 del Decision Freeze (su evidencia cita ese circuito), y el ESP32 tiene su
// propia revisión de placa.
//
// Dato de P5 (madurez): no entra al hash semántico.

export interface RevisionDeComponente {
  readonly tipo: string
  readonly placa: string
  readonly revisadoPor: string
  readonly evidencia: string
}

export interface RevisionDePlaca {
  readonly placa: string
  readonly revisadoPor: string
  readonly evidencia: string
}

const FREEZE = "revisión humana del Component System Decision Freeze (2026-10-04)"

export const REVISIONES_DE_PLACA: readonly RevisionDePlaca[] = Object.freeze([
  Object.freeze({
    placa: "esp32-devkit-v1",
    revisadoPor: FREEZE,
    evidencia: "nucleo/placas.ts (pines, restricciones y terminales de potencia contra circuito.ts:624-667 y docs/wokwi-pinout-dump.md)",
  }),
  // CK-PLACA-01: la placa completa con fuente primaria. Decisiones H-A1..H-A6 de Alejandro
  // Palestrini (2026-10-12, por chat; registradas en tecnia-bot-docs/esp32-completo/
  // DECISIONES-HUMANAS-2026-10-12.md). Cierra la deuda ESP-STRAP-05 (GPIO5 strapping).
  Object.freeze({
    placa: "esp32-devkit-v1",
    revisadoPor: "revisión humana de Alejandro Palestrini (2026-10-12, CK-PLACA-01, H-A1..H-A6)",
    evidencia:
      "nucleo/placas.ts (schemaVersion 1.1.0): strapping 0/2/5/12/15 y bancos ADC1/ADC2 (ESP32 Series Datasheet v5.3, Tabla 3-1 y Tabla 2-1); " +
      "ADC2 compartido con WiFi (ESP-IDF v4.4 adc.html y adc_oneshot.html actual); DAC 25/26, touch 0/2/4/12/13/14/15/27/32/33 y LED de placa en GPIO2 " +
      "(arduino-esp32 variants/doitESP32devkitV1/pins_arduino.h, Zephyr board doc); VIH máx VDD+0,3 V → tolerancia5V false (Datasheet Tabla 5-3). " +
      "Fuentes hasheadas en tecnia-bot-docs/esp32-completo/evidencia/fuentes/SHA256SUMS.txt. Polaridad del LED de placa verificada en la placa el 2026-10-13 (prende en alto; evidencia-v1/e2e/).",
  }),
])

export const REVISIONES_DE_COMPONENTE: readonly RevisionDeComponente[] = Object.freeze([
  Object.freeze({ tipo: "led", placa: "esp32-devkit-v1", revisadoPor: FREEZE, evidencia: "nucleo/catalogo-datos.ts::LED (circuito.ts:947-975, 220 ohm en serie)" }),
  Object.freeze({ tipo: "resistencia", placa: "esp32-devkit-v1", revisadoPor: FREEZE, evidencia: "nucleo/catalogo-datos.ts::RESISTENCIA (puente sin polaridad, circuito.ts:117)" }),
  Object.freeze({ tipo: "pulsador", placa: "esp32-devkit-v1", revisadoPor: FREEZE, evidencia: "nucleo/catalogo-datos.ts::PULSADOR (INPUT_PULLUP, circuito.ts:1089-1105)" }),
  // Post-D0 Electrical Review Hardening #1: aprobada por el product owner (humano) para ESTE
  // par y ESTE modelo, nada más. No vale para el UNO ni para cualquier producto llamado
  // "interruptor": un módulo con alimentación propia o salida activa es otro componente.
  Object.freeze({
    tipo: "interruptor",
    placa: "esp32-devkit-v1",
    revisadoPor: "revisión humana del product owner (Post-D0 Electrical Review Hardening #1, 2026-10-05)",
    evidencia:
      "nucleo/catalogo-datos.ts::INTERRUPTOR. Modelo aprobado: interruptor mecánico pasivo de estado mantenido, contacto seco; " +
      "senal a un GPIO del ESP32 con pull-up interno (≈45 kΩ típ., ESP32 Series Datasheet v5.3, Tabla 5-3) y gnd a GND; " +
      "abierto → GPIO en ALTO por el pull-up, cerrado → GPIO a GND; estadoBooleano verdadero = contacto cerrado; " +
      "un GPIO sin pull-up interno (GPIO34-39) sigue bloqueado por PIN_SIN_PULLUP_INTERNO. Corriente de contacto ≈73 µA (inferida). " +
      "Respaldo, NO especificación normativa: un interruptor deslizante representativo (C&K OS102011MS2QN1) declara 100 mA @ 12 V DC (ficha DigiKey).",
  }),
  // CK-CG1: aprobada por Alejandro Palestrini (humano) el 2026-10-06, con el texto literal de abajo
  // (R8 con sus dos correcciones finales). Vale para ESTE par y ESTE modelo, nada más: no cubre el
  // UNO ni el DHT11. Deudas abiertas que la revisión registra: DHT-PULLUP-01 (el pull-up requerido
  // no se verifica), H-01 (rango 0-60 °C contra −40-80 °C) y ESP-STRAP-05 (GPIO5 fuera del registro
  // de strapping, ver `nucleo/placas.ts`).
  Object.freeze({
    tipo: "dht22",
    placa: "esp32-devkit-v1",
    revisadoPor: "revisión humana de Alejandro Palestrini (CK-CG1, DHT22 en ESP32 DevKit V1, 2026-10-06)",
    evidencia:
      "nucleo/catalogo-datos.ts::DHT22 (CK-CG1). Modelo pedagógico aprobado en Tecnia Bot: DHT22/AM2302 representado mediante VCC, DATA y GND en ESP32 DevKit V1. " +
      "VCC al 3V3 del ESP32 (fabricante: 3,3–5,5 V; alimentado con 3,3 V, cable de no más de 100 cm — Aosong, Manual AM2302 v1.1, §4.2 y §7.1 nota 2). " +
      "DATA bidireccional: el microcontrolador lleva SDA a bajo al menos 800 µs (típico 1 ms) para iniciar cada lectura (§7.4 paso 2), " +
      "así que requiere un GPIO con entrada y salida digital; GPIO34–39 no son válidos. " +
      "El bus requiere un pull-up a VCC (el fabricante indica uno externo de aprox. 5,1 kΩ para cables de menos de 30 m, §7.1 nota 1 y §7.2); " +
      "esta revisión NO afirma la existencia de un pull-up incorporado; Tecnia Bot todavía no verifica la presencia ni el valor del pull-up requerido (deuda DHT-PULLUP-01). " +
      "GPIO12 (MTDI) no es válido para DATA: con el bus elevado durante el reset selecciona VDD_SDIO de 1,8 V " +
      "(Espressif, ESP32 Series Datasheet v5.3, §3.2); los demás pines de strapping mantienen la política vigente. " +
      "Intervalo mínimo entre lecturas: 2 s (§7.1 nota 3); después del encendido, esperar al menos 2 s antes de la primera instrucción (§7.4 paso 1). " +
      "El rango del catálogo (0–60 °C) difiere del indicado por el fabricante (−40–80 °C): deuda H-01, no se corrige en esta revisión. " +
      "Fuentes: Manual AM2302 v1.1 (sha256 615c668659e42c797e87226d7510f50c88e5b58998d2b6dc57fb747f611069bd), " +
      "Aosong DHT22 datasheet (sha256 c91441a385cdf58f5f0ae50b194f294d5d1f0faeaac9a010efacb7ecf21be448), " +
      "Espressif ESP32 Series Datasheet v5.3 (sha256 a7917e6b47528c9dcab06837a49d452e582751335797db879f1cf2d17cd29adf).",
  }),
  // CK-CG2: aprobada por Alejandro Palestrini (humano) el 2026-10-12, con el texto literal de abajo
  // (§9 de DHT11-ELECTRICAL-REVIEW.md, Design Gate DHT11; veredicto externo APPROVE_WITH_LIMITATIONS).
  // Vale para ESTE par y ESTE modelo, nada más: el módulo DFRobot Gravity DHT11 (DFR0067, placa V2)
  // sobre ESP32 DevKit V1. No cubre el UNO, el DHT11 pelado de 4 patas ni el DHT22. Deudas:
  // DHT-PULLUP-02 (el pull-up del módulo no se verifica físicamente) y DHT11-RANGO-01 (se declara
  // 0-50 °C / 20-90 %RH, el mínimo común de las revisiones del chip; la V1.3 indica -20-60 °C / 5-95 %RH).
  // El último párrafo («Addendum CK-CG2 …») NO es parte del texto aprobado: resuelve la observación del
  // revisor externo (el manual dice «> 2 s») de forma explícita, sin alterar el texto aprobado.
  Object.freeze({
    tipo: "dht11",
    placa: "esp32-devkit-v1",
    revisadoPor: "revisión humana de Alejandro Palestrini (CK-CG2, DHT11 DFRobot Gravity DFR0067 en ESP32 DevKit V1, 2026-10-12)",
    evidencia:
      "nucleo/catalogo-datos.ts::DHT11 (CK-CG2). Modelo pedagógico aprobado en Tecnia Bot: módulo DFRobot Gravity DHT11 (SKU DFR0067, placa V2) " +
      "representado mediante VCC, DATA y GND en ESP32 DevKit V1. " +
      "VCC al 3V3 del ESP32, nunca a VIN/5 V: el chip admite 3,3–5,5 V (Aosong, DHT11 Product Manual V1.3, 2017-03-31) y la tienda de DFRobot indica 3,3–5 V; " +
      "la wiki de DFRobot indica +5 V, contradicción documental resuelta a favor de 3,3 V porque el GPIO del ESP32 tolera 3,6 V como máximo " +
      "(Espressif, ESP32 Series Datasheet v5.3, Tabla 5-3; ESP-FAQ hardware design). A 3,3 V el cable del módulo debe ser corto (V1.3). " +
      "Conector Gravity J1 (PH2.0): pin 1 DATA, pin 2 VCC, pin 3 GND (DFRobot, esquemático DHT11 Temperature & Humidity Sensor Revision V2, 2013-05-20); " +
      "la asignación se verifica por la serigrafía del módulo, nunca por el color del cable. " +
      "El módulo trae un pull-up R1 entre DATA y VCC (5,1 kΩ en el esquemático V2; 4,7 kΩ visible en fotos de producto de 2025) y un condensador de 100 nF; no tiene LED ni regulador. " +
      "DATA bidireccional: el microcontrolador lleva el bus a bajo al menos 18 ms (máximo 30 ms) para iniciar cada lectura (V1.3), así que requiere un GPIO con entrada y salida digital; " +
      "GPIO34–39 no son válidos; GPIO12 (MTDI) no es válido para DATA (strapping VDD_SDIO); GPIO4 es I/O y no es pin de strapping (datasheet v5.3, Tabla 3-1). " +
      "Espera tras el encendido: 1 s; intervalo mínimo entre lecturas: 2 s; la lectura entrega la medición anterior (V1.3). " +
      "Rango declarado: 0–50 °C ±2 °C y 20–90 %RH ±5 %RH, resolución 1 °C / 1 %RH (DFRobot DFR0067; Aosong revisiones ≤ 2015). " +
      "Fuentes: Aosong DHT11 Product Manual V1.3 (sha256 1b7391fafd7fee7170be4c574dc609d7353f064043f2ea27cdbdf41d172f56fe), " +
      "DFRobot esquemático DFR0067 V2 (sha256 43010677fa259acd63b82464f6552db8616bb04ce19a186f321863451925afa7), " +
      "DFRobot wiki DFR0067 (sha256 41adc3959d85fb3c7295689928057cc2f60a6307394092d175f22653c1685239), " +
      "DFRobot tienda product-174 (sha256 a9c9803380d12f91e7080b04fe0a5b97e75db599456f485c411cdd417943ed64), " +
      "Espressif ESP32 Series Datasheet v5.3 (sha256 a7917e6b47528c9dcab06837a49d452e582751335797db879f1cf2d17cd29adf). " +
      "Addendum CK-CG2 (2026-10-12, observación del revisor externo, no forma parte del texto aprobado): el manual V1.3 indica un intervalo de lectura " +
      "estrictamente mayor que 2 s («> 2 s»); Component Knowledge declara periodoMinimo = 3 s para cumplirlo con margen (nucleo/catalogo-datos.ts::LECTURA_DHT11).",
  }),
])
