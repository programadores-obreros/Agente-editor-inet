# Phase 2 Slice 2: registro del merge verificado

Este documento es POSTERIOR al freeze. Al agregarlo, el tree de `main` cambia. El producto auditado es:

- `FROZEN_PRODUCT_HEAD = cc6794cfe522f90ed9566940cff22def149220f6`
- `FROZEN_PRODUCT_TREE = e335f89f8b209eafe6e61825919c3328750652d9`

No es el commit que agrega este archivo.

| Campo | Valor |
|---|---|
| Fecha | 2026-09-30 16:30 -03:00 |
| Base pre-merge (`main`) | `74e06741adab343d1b62374acce9a6b623ba5175` |
| Freeze | `TECNIA_BOT_PHASE_2_SLICE_2_FREEZE.zip`, SHA-256 `13196245867cc77c4aca4ab256c94e7b46c3a7bac36da0fc3a50b6428beece9b`. Antes del merge se verificó de forma independiente: 157 entradas, testzip OK, 156 hashes internos verificados, `FULL.diff` byte-idéntico a `git diff 74e0674..cc6794c`, 15 patches, reportes sin referencias obsoletas |
| Rama | `feature/programacion-intencion-phase2-slice2` (se conserva) |
| Commits integrados | 15 |
| Método | `git merge --ff-only`, local. `main` era ancestro del HEAD congelado (`merge-base --is-ancestor`: exit 0) |
| `main` inmediatamente post-merge | HEAD `cc6794c…`, tree `e335f89f…`: **idéntico al producto congelado** |
| Tests | 1207/1207 (0 fail, 0 cancelled, 0 skipped) |
| Typecheck / Fichas | exit 0 / exit 0 |
| Capas protegidas (`nucleo/`, `servidor/`, `circuito.ts`, `platformio.ts`, `tests/nucleo-*`, instaladores, `package.json`, lock) | sin cambios respecto de `74e0674`; `tests/nucleo-*` sin cambios respecto de Phase 1 (`8b43c59`); ningún test eliminado |
| E2E navegador real | 14/14, según el freeze (no se repitió en este merge) |
| Windows short run R-5 | 5/5, según el freeze (no se repitió; la VM no se tocó en este merge) |
| Red team | 0 CRITICAL / 0 MAJOR abiertos (RED-S2-TOOL + una ronda de fixes + VERIF-S2-FIX) |
| Backlog conocido y aceptado | M-02 (MINOR, in-process: el catch externo relee `args`); titular de D13 ("servidor"); ids internos `cmp-N / senal` en los selectores; los tests de W-S2-TOOL no fueron test-first (el RED reconstruido no es TDD genuino); H4 (ACCEPTED_KNOWN_LIMITATION, Slice 1) |
| Test pedagógico con estudiante | **NO EJECUTADO** (protocolo en `PHASE_2_SLICE_2_PROTOCOLO_ESTUDIANTE.md`) |
| `origin/main` | `0fa729871edca53e41688a2b1649125690641a2a` (sin modificar) |
| Push / PR | NO / NO |
| Estado | **PHASE_2_SLICE_2_MERGED_LOCALLY_AND_VERIFIED** |
