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
])
