## Entregas para Tecnia Review — protocolo tecnia-delivery v1

Toda entrega que deba auditar Tecnia Review se declara con el productor externo
`tecnia-deliver` (repo `~/hostshare/manajaro1/tecnia-dev-loop`). El protocolo
completo vive en su `docs/PRODUCER-PROTOCOL.md` y el contrato de datos en Tecnia
Review; esta regla sólo fija cuándo y cómo se usa, no copia el schema.

- **Empieza** antes de tocar código del slice:
  `node ~/hostshare/manajaro1/tecnia-dev-loop/bin/tecnia-deliver.mjs start --track <slug> --scope-summary "<qué>" --scope-path <ruta> [...]`
  (worktree limpio; baseline = HEAD; para una corrección tras un REJECT, `--fix-of <head rechazado>`).
  El scope queda fijo: si el trabajo lo excede, se divide o se pide decisión, nunca se ensancha.
- **Termina** con el slice commiteado (el commit respeta la verificación previa de este
  repo, sección "Verificación" de `CLAUDE.md`): `… tecnia-deliver.mjs ready --track <slug>`.
  Después del commit vuelve a correr las verificaciones obligatorias que define el
  protocolo canónico y publica `READY_FOR_REVIEW` sólo si todas pasaron.
- **Si responde `NOT_READY`**: no publiques a mano ni edites evidencia; corregí la causa
  con un commit nuevo y repetí, o pedí decisión. Sin reintentos en bucle para "conseguir verde".
- **Decisión humana pendiente**: `… tecnia-deliver.mjs decision --track <slug> --decision-file <json>`
  y frená lo bloqueado; con la decisión tomada, `resume`.
- **Después de `READY_FOR_REVIEW`** no se edita ni se commitea hasta el veredicto.
- **`READY_FOR_REVIEW` no es aprobación.** Claude nunca escribe `REVIEWED` ni un veredicto:
  Tecnia Review verifica y el revisor externo decide.
