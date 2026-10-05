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

export const CATALOGO_FIJADO = Object.freeze({
  version: "2.1.0",
  hash: "8bc928045bdf5915756103ef67bdad7a5ef0acfeb15cf4f069a86ee7dd43ff9a",
  componentesShippeados: Object.freeze(["dht22", "led", "ntc", "pulsador", "resistencia"]),
  oficiales: Object.freeze(["esp32-devkit-v1", "led", "pulsador", "resistencia"]),
})
