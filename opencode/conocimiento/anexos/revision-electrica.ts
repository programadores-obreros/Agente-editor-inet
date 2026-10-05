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
])
