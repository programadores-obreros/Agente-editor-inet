// STUB temporal (RED, Wave 0 F-09) — reemplazado en el commit GREEN por la tabla real
// de PHASE_3_WAVE_0_DESIGN.md ("anodo"->"ánodo (+)", etc.). Hoy sólo aplica el
// fallback (el propio id) para TODO terminal, a propósito: así el test de la tabla
// real falla por ASERCIÓN (compara contra el id crudo), nunca por import roto.
export function etiquetaDeTerminal(terminalId: string): string {
  return terminalId
}
