// Tipos de ambiente para las herramientas de Tecnia Bot.
//
// Las tools corren dentro del runtime de OpenCode (Bun). Antes este archivo
// declaraba a mano un `Bun` minimo, y quedo incompleto: le faltaban `which`,
// `stdin`, `unref` y `signal`, asi que `pnpm typecheck` daba 88 errores y nadie
// lo corria. Ahora los tipos reales vienen de `@types/bun` (tsconfig.json ->
// "types": ["node", "bun"]) y de `@opencode-ai/plugin`, fijado en la misma
// version que install/OPENCODE_VERSION. Este archivo queda vacio a proposito:
// las tools todavia lo referencian con `/// <reference path>` y borrarlo las
// rompe; sacar esas lineas es una limpieza aparte.
export {}
