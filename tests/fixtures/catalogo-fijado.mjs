// Expectativas FIJADAS del catálogo — Component Knowledge F2a (`component-knowledge/
// 18_F2A_SCOPE.md` §2 F2a-3). Una sola fuente para lo que antes estaba repetido en
// `componentes-admision.test.mjs`, `arquitectura-conocimiento.test.mjs` y
// `nucleo-catalogo.test.mjs`. Las aserciones no cambiaron: sólo de dónde sale el valor.
//
// Cambiar una línea de acá es un cambio EXPLÍCITO y revisado:
// - `version` + `hash`: la identidad semántica del catálogo (D-03). Si el significado
//   cambia, el hash cambia y la versión tiene que subir (test D de arquitectura).
// - `componentesShippeados`: los tipos que trae el catálogo, ordenados.
// - `oficiales`: los ids oficialmente soportados (placas y componentes), ordenados (D-17).
//   Entrar o salir de esta lista es una decisión, nunca un efecto colateral.
// - `anterior`: la identidad fijada INMEDIATAMENTE anterior. Un proyecto creado con ella
//   tiene que seguir recargando, sin reescribir `createdWith` y mostrando
//   `CATALOGO_CAMBIO_DETECTADO` (test genérico `catalogo-extensible.test.mjs`).
//
// 2.2.0 — Component Knowledge D0: se agrega `interruptor` (cambio menor).
// Post-D0 Electrical Review Hardening #1: con la revisión eléctrica HUMANA del par
// (interruptor, esp32-devkit-v1), `interruptor` entra a `oficiales` como resultado DERIVADO de
// la admisión. La revisión no es identidad semántica: versión y hash no cambian.
//
// 2.3.0 — CK-CG1: `Capacidad.lectura` + registro de protocolos en el hash, `pullUpExterno`, DATA
// del DHT22 bidireccional y GPIO12 con `strappingVddSdio` (cambio menor que cambia el significado
// de piezas existentes). Con la revisión eléctrica HUMANA del par (dht22, esp32-devkit-v1) de
// Alejandro Palestrini (2026-10-06), `dht22` entra a `oficiales` como resultado DERIVADO de la
// admisión. `anterior` pasa a ser 2.2.0.
//
// 2.4.0 — CK-CG2: se agrega `dht11` (módulo DFRobot Gravity) con el protocolo `bus-unico-dht11`
// (cambio menor: un tipo más, el registro de protocolos entra al hash). Con la revisión eléctrica
// HUMANA del par (dht11, esp32-devkit-v1) de Alejandro Palestrini (2026-10-12) y su representación
// propia `pb-dht11`, `dht11` entra a `oficiales` como resultado DERIVADO de la admisión. Sigue NO
// GENERABLE hasta Codegen S2b (sin backend para su protocolo). `anterior` pasa a ser 2.3.0.

export const CATALOGO_FIJADO = Object.freeze({
  version: "2.4.0",
  hash: "df364a3186afb53b64fe657b94c162ed7a346a989b175e24d86e84d9b59057c4",
  componentesShippeados: Object.freeze(["dht11", "dht22", "interruptor", "led", "ntc", "pulsador", "resistencia"]),
  oficiales: Object.freeze(["dht11", "dht22", "esp32-devkit-v1", "interruptor", "led", "pulsador", "resistencia"]),
  anterior: Object.freeze({ version: "2.3.0", hash: "b20d038cc39779213f902ca313d7e4e35a40fae8a66d9f21dadeb7285b19c901" }),
})
