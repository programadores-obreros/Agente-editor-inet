// Tabla de PRESENTACIÓN — Fase 3, Wave 0 (F-09, PHASE_3_WAVE_0_DESIGN.md: "TerminalVista.etiqueta:
// de una tabla DE PRESENTACIÓN en vista-fisica/"). PURA, sin I/O, sin dependencia del
// núcleo: traduce el `Terminal.id` del catálogo (`nucleo/catalogo-datos.ts`) a un texto
// legible para un estudiante — nunca una regla eléctrica, nunca el nombre Wokwi
// interno de la pieza (ese es `wokwi-render-datos.ts::TERMINAL_WOKWI_POR_TIPO`, un
// dato de RENDER, no de presentación textual: ver la nota de cabecera de ese archivo,
// "pulsador.senal -> '1.l'" — exactamente el texto que esta tabla existe para no
// mostrar).
//
// Claves verificadas contra `nucleo/catalogo-datos.ts`: LED (`anodo`/`catodo`),
// Pulsador (`senal`/`gnd`), Resistencia (`a`/`b`, "es un puente, no tiene polaridad",
// catalogo-datos.ts:40-43). Un terminal que esta tabla no conoce todavía usa su propio
// id como etiqueta — fail-closed, mismo criterio que el resto de `vista-fisica/`
// (`resolverNombreDeComponente`, `nombreWokwiDePin`...): nunca inventa un texto que no
// esté citado acá.
export const ETIQUETA_POR_TERMINAL: Readonly<Record<string, string>> = {
  anodo: "ánodo (+)",
  catodo: "cátodo (−)",
  senal: "señal",
  gnd: "GND",
  a: "pata A",
  b: "pata B",
}

export function etiquetaDeTerminal(terminalId: string): string {
  return ETIQUETA_POR_TERMINAL[terminalId] ?? terminalId
}
