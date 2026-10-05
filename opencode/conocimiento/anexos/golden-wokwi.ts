// GOLDEN DE REPRESENTACIÓN WOKWI — Component Knowledge F2a (`component-knowledge/
// 18_F2A_SCOPE.md` §2 F2a-2).
//
// Los pines que el custom element Wokwi REAL expone (`el.pinInfo`, leído contra el bundle
// vendorizado del repo). Un ancla del anexo de representación que no esté acá no cuenta
// como verificada (check 9 de la admisión). Es dato de P2 (representación): no entra al hash.
//
// Antes vivía como `PINES_VERIFICADOS_WOKWI` dentro de `conocimiento/admision.ts`; se mudó
// sin cambios.
//
// Fuentes por elemento:
// - `wokwi-led`, `wokwi-pushbutton`: docs/wokwi-pinout-dump.md (:79, :82).
// - `wokwi-resistor`: `el.pinInfo` en Chromium headless contra el bundle (Fase 3, Wave 0,
//   EXP-B; ver la cabecera de `anexos/representacion.ts`).
// - `wokwi-esp32-devkit-v1`: los 30 pines de `el.pinInfo` (revisión post red-team B1; ver la
//   cabecera de `anexos/representacion.ts`).
// - `wokwi-arduino-uno`: docs/wokwi-pinout-dump.md (:17-63).
// - `wokwi-slide-switch`: `el.pinInfo` en Chromium headless contra el bundle del repo
//   (Component Knowledge D0, 2026-10-05) + docs.wokwi.com/parts/wokwi-slide-switch.

export const PINES_VERIFICADOS_WOKWI: Readonly<Record<string, readonly string[]>> = {
  "wokwi-led": ["A", "C"],
  "wokwi-pushbutton": ["1.l", "2.l", "1.r", "2.r"],
  "wokwi-resistor": ["1", "2"],
  "wokwi-slide-switch": ["1", "2", "3"],
  "wokwi-esp32-devkit-v1": [
    "3V3", "D12", "D13", "D14", "D15", "D18", "D19", "D2", "D21", "D22", "D23", "D25", "D26", "D27", "D32", "D33",
    "D34", "D35", "D4", "D5", "EN", "GND.1", "GND.2", "RX0", "RX2", "TX0", "TX2", "VIN", "VN", "VP",
  ],
  "wokwi-arduino-uno": [
    "A5.2", "A4.2", "AREF", "GND.1", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0",
    "IOREF", "RESET", "3.3V", "5V", "GND.2", "GND.3", "VIN", "A0", "A1", "A2", "A3", "A4", "A5",
  ],
}
