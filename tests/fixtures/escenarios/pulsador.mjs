// Escenarios dorados del pulsador, como DATOS — Component Knowledge F2a
// (`component-knowledge/18_F2A_SCOPE.md` §2 F2a-4). Los mismos dos casos que
// `componentes-admision.test.mjs` prueba a mano ("F7 dorado pulsador"), ejecutados por el
// runner único `tests/componentes-escenarios.test.mjs` con operaciones reales del Engine.
//
// Forma de un escenario:
// - `placa`: id de placa (se fija con una operación `SetPlaca` real).
// - `pasos`: operaciones `{ tipo, payload }` en orden. Los componentes agregados reciben
//   los ids deterministas del Engine (`cmp-0`, `cmp-1`, …).
// - `espera` (sobre el ÚLTIMO paso):
//   - `ok`: si la operación se acepta (`true`) o se rechaza (`false`);
//   - `primerMotivo`: código del primer motivo (un rechazo);
//   - `contiene`: motivos que tienen que aparecer, `{ codigo, severidad? }`;
//   - `noContiene`: códigos que no pueden aparecer.
// Todos los pasos anteriores al último tienen que aceptarse.

export const COMPONENTE = "pulsador"

export const ESCENARIOS = [
  {
    nombre: "en GPIO34 (sin pull-up interno) → PIN_SIN_PULLUP_INTERNO bloqueante",
    placa: "esp32-devkit-v1",
    pasos: [
      { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
      { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO34" } },
    ],
    espera: { ok: true, contiene: [{ codigo: "PIN_SIN_PULLUP_INTERNO", severidad: "blocking" }] },
  },
  {
    nombre: "su gnd no es asignable → TERMINAL_NO_ASIGNABLE",
    placa: "esp32-devkit-v1",
    pasos: [
      { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
      { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "gnd", pin: "GPIO23" } },
    ],
    espera: { ok: false, primerMotivo: "TERMINAL_NO_ASIGNABLE" },
  },
]
