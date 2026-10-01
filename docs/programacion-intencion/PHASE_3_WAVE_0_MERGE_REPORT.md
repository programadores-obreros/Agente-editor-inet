# Phase 3 Wave 0: merge controlado a main local

> Merge local fast-forward. Sin push, sin PR. REAL STUDENT/TEACHER TEST = NOT EXECUTED (§26 NO satisfecha).

## Identidad

| | Valor |
|---|---|
| main antes | `9b290a1e436c4fee178e05006284db7682a3bd32` |
| **PRODUCT HEAD auditado** | `c092bce7efcd1b3981fc1cd1f1a97a7d351803e5` |
| **PRODUCT TREE auditado** | `259848189656c6898d9702185942c1a3208a027c` |
| Rama | `feature/programacion-intencion-wave0` (17 commits) |
| Freeze | `TECNIA_BOT_PHASE_3_WAVE_0_FREEZE.zip`, sha256 `eff5118404dc0bfc0e6a5a03cac33974dc187f214f906d41a743c88f35abb3eb` |
| Manifest | sha256 `4c8c2dd6e8379fe327b3bc128887f6347827097659a7fb793c566312e085ce15` |
| origin/main | `0fa7298` (sin cambios; nunca se hizo push) |

Este documento entra en un commit **docs-only** posterior. Su HEAD y su árbol NO son el producto congelado: el producto auditado es el árbol `2598481…`.

## Verificación previa del freeze (independiente)

Los 14 checks dieron PASS:
1. SHA-256 del ZIP;
2. SHA-256 del MANIFEST;
3. `testzip` (218 entradas);
4. HEAD;
5. árbol;
6. base y ancestría;
7. 17 commits;
8. `FULL.diff` igual byte a byte a `git diff 9b290a1..c092bce`;
9. las 217 filas del manifest coinciden con el contenido extraído;
10. 0 secretos (búsqueda de patrones de claves);
11. main = `9b290a1` con `?? .gestor/`;
12. 2 stashes preexistentes;
13. `.gestor/` presente y sin tocar;
14. origin/main = `0fa7298`.

## Merge
- `git merge --ff-only c092bce`: ancestro verificado, 17 commits por delante y 0 por detrás. Sin merge commit, sin rebase, sin cherry-pick y sin squash.
- Después del merge: `HEAD = c092bce7…`, árbol `2598481…`, 0 merge commits en `9b290a1..HEAD`, status `?? .gestor/`, los 2 stashes intactos.

## Gates después del merge (en main)
- `pnpm test`: 1272/1272 (0 fallas).
- `pnpm typecheck`: 0. `pnpm fichas:check`: 0.
- `guardia-composicion-raiz` y `guardia-servicio-con-vista`: 0.

## Estado contractual heredado del freeze (sin cambios)
- CRITICAL abiertos: 0. MAJOR abiertos dentro del alcance: 0.
- IR_SEMANTICS_CHANGED = NO, BLOCKLY = NO, NEW_CODEGEN = NO, PULSADOR_LED_LOGIC = NO, W_P3_NUCLEO_STARTED = NO.
- HD-W0-A/B/C: decididas por el humano después del freeze (A = SÍ, B = SERIE VISIBLE, C = MINOR/BACKLOG). Se implementan en la mini-etapa Pre-Human-Test Hardening, NO en este merge.
