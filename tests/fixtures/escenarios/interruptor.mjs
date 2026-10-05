// Escenarios dorados del interruptor, como DATOS — Component Knowledge D0 (canario "sólo
// datos"). Los ejecuta el runner único `tests/componentes-escenarios.test.mjs`, con
// operaciones reales del Engine. Forma: ver la cabecera de `escenarios/pulsador.mjs` y la del
// runner (`$estadoDeEntrada`, `ESTADOS_DE_ENTRADA`, `espera.recarga`).
//
// Ninguna condición booleana se escribe a mano: `$estadoDeEntrada` le pide al conocimiento la
// condición canónica que ofrece el tipo del sensor para ese rótulo.

export const COMPONENTE = "interruptor"

/** Rótulo para el alumno → valor booleano canónico (verdadero = contacto cerrado). */
export const ESTADOS_DE_ENTRADA = { cerrado: "verdadero", abierto: "falso" }

const ARMADO_REGLA = [
  { tipo: "AgregarComponente", payload: { tipo: "interruptor" } }, // cmp-0
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO23" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } }, // cmp-1
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO4" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } }, // cmp-2
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
]

/** Motivos que una regla canónica y bien armada nunca debe traer. */
const REGLA_SANA = ["SENSOR_INVALIDO", "ACTUADOR_INVALIDO", "CAPACIDAD_NO_DECLARADA", "CAPACIDAD_INEXISTENTE_EN_CATALOGO", "MAGNITUD_INCOMPATIBLE", "UMBRAL_FUERA_DE_RANGO", "COMPORTAMIENTO_INCOMPLETO", "ACCION_NO_SOPORTADA", "MULTIPLES_AUTORIDADES_ACTUADOR"]

export const ESCENARIOS = [
  {
    nombre: "ESP32: la señal en GPIO23 (con pull-up interno) se acepta sin avisos de pin, y recarga igual",
    placa: "esp32-devkit-v1",
    pasos: [
      { tipo: "AgregarComponente", payload: { tipo: "interruptor" } },
      { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO23" } },
    ],
    espera: { ok: true, noContiene: ["PIN_SIN_PULLUP_INTERNO", "CAPACIDAD_PIN_INCOMPATIBLE", "TERMINAL_NO_ASIGNABLE", "PIN_STRAPPING", "PIN_FLASH_RESERVADO"], recarga: true },
  },
  {
    nombre: "regla de nivel 'mientras el interruptor esté cerrado, el LED está encendido' (condición canónica), y recarga igual",
    placa: "esp32-devkit-v1",
    pasos: [...ARMADO_REGLA, { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { $estadoDeEntrada: { sensor: "cmp-0", estado: "cerrado" } }, entonces: { actuador: "cmp-1", accion: "encender" } } } }],
    espera: { ok: true, noContiene: REGLA_SANA, recarga: true },
  },
  {
    nombre: "regla de nivel con el estado 'abierto' (complemento canónico)",
    placa: "esp32-devkit-v1",
    pasos: [...ARMADO_REGLA, { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { $estadoDeEntrada: { sensor: "cmp-0", estado: "abierto" } }, entonces: { actuador: "cmp-1", accion: "encender" } } } }],
    espera: { ok: true, noContiene: REGLA_SANA },
  },
  {
    nombre: "en GPIO34 (sin pull-up interno) → PIN_SIN_PULLUP_INTERNO bloqueante",
    placa: "esp32-devkit-v1",
    pasos: [
      { tipo: "AgregarComponente", payload: { tipo: "interruptor" } },
      { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO34" } },
    ],
    espera: { ok: true, contiene: [{ codigo: "PIN_SIN_PULLUP_INTERNO", severidad: "blocking" }] },
  },
  {
    nombre: "su gnd no es asignable → TERMINAL_NO_ASIGNABLE",
    placa: "esp32-devkit-v1",
    pasos: [
      { tipo: "AgregarComponente", payload: { tipo: "interruptor" } },
      { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "gnd", pin: "GPIO23" } },
    ],
    espera: { ok: false, primerMotivo: "TERMINAL_NO_ASIGNABLE" },
  },
]
