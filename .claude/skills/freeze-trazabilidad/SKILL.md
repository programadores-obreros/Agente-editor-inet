---
name: freeze-trazabilidad
description: Workflow de freeze y trazabilidad estilo Wave 0 — cerrar una fase/slice con manifest+zip en ~/tecnia-bot-docs, fila nueva en TRACEABILITY.md y entrada append-only en DECISIONS.md. Usar al cerrar una fase, un slice o cualquier trabajo que Wave 0 exige dejar congelado y trazable.
---

# Freeze y trazabilidad (Wave 0)

Cuándo usar esta skill: al cerrar una fase o slice de `docs/programacion-intencion/`
que Wave 0 (o el proceso vigente) exige dejar congelado — no para cada commit.

## Pasos

1. **Confirmá que el gate de integración está en verde** antes de congelar: suite de
   tests en verde + (si aplica) validación en VM + red team, según lo que el diseño de
   esa fase haya fijado (ver `PHASE_3_WAVE_0_DESIGN.md` como ejemplo de contrato: suite
   en verde + VM + red team antes de freeze).
2. **Agregá la fila en `TRACEABILITY.md`**: REQ → DECISIÓN → DISEÑO → COMMITS → TEST →
   EVIDENCIA → ESTADO → CALIDAD, usando el vocabulario de calidad de evidencia que ya
   usa el doc (RED/RED*/MOD/SIM/BRW/VM/IND/HUM/LIM). No inventes una fila sin evidencia
   real en cada columna.
3. **Agregá la entrada en `DECISIONS.md`** (append-only, nunca reescribas una entrada
   vieja): número de orden siguiente (`OD-xx` o el que corresponda a la fase), qué se
   decidió, qué hallazgo adversarial (si hubo) motivó la decisión, con cita de línea de
   código.
4. **Generá el freeze**: `*_MANIFEST.txt` + `.zip` de los artefactos de la fase, en
   `~/tecnia-bot-docs/phaseN*/` — **no** dentro del repo de código. El manifest lista
   archivo+hash de cada artefacto congelado.
5. **Si la fase cerró con prueba humana real pendiente**, decilo explícitamente en
   `TRACEABILITY.md` con el nivel `HUM` marcado como `NOT EXECUTED` — nunca lo marques
   como hecho si no se ejecutó.

## Qué NO hacer

- No uses esta skill para cerrar un commit cualquiera — es para cierres de fase/slice.
- No congeles sin que el gate de integración de esa fase esté realmente en verde.
- No reescribas `DECISIONS.md`: es append-only.
