# BRIEF.md — referencia al contrato congelado

El contrato de producto de "Programación por Intención" es **FROZEN** (no se modifica ni
se toca desde este trabajo) y vive fuera del árbol de este repo:

```
/home/manjarodesktop/tecnia-bot-docs/BRIEF_MAESTRO_PROGRAMACION_POR_INTENCION_TECNIA_BOT_v5_FINAL.md
sha256: 86f12b521ebbef6f1f7735399e4a8bc0355bdfda6efb310558288601f18eb564
```

**Este archivo NO duplica el brief.** Todas las citas `§N` que aparecen en
`BOARD-CONTRACT.md`, `DECISIONS.md` y en los comentarios del código de
`opencode/nucleo/` refieren a las secciones de ese documento, por número de línea o de
sección, tal como se citó en `T_diseno_consolidado.md` (diseño consolidado de Fase 1,
agentes B/C/D + reconciliaciones del orquestador).

Verificación del hash, para quien retome este trabajo:

```bash
sha256sum /home/manjarodesktop/tecnia-bot-docs/BRIEF_MAESTRO_PROGRAMACION_POR_INTENCION_TECNIA_BOT_v5_FINAL.md
```

Si el hash no coincide, el brief cambió desde que se escribió este documento y hay que
frenar y preguntar — no asumir que la desviación es inocente.
