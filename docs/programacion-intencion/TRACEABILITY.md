# Trazabilidad: decisión → diseño → test → evidencia

Tabla mínima, sin herramientas nuevas. Es el primer paso hacia un futuro `pnpm audit:trace`, que NO está implementado.

**Calidad de evidencia:**
- `RED` = RED genuino en un commit separado, reproducido por el orquestador en su árbol exacto;
- `RED*` = RED que discrimina, pero con PROCESS_DEVIATION declarada (implementación tocada antes del test);
- `MOD` = test modificado después del RED, con la modificación justificada;
- `SIM` = simulación del orquestador;
- `BRW` = navegador real (Chromium o Edge por CDP);
- `VM` = Windows real con el producto instalado;
- `IND` = revisión independiente (verificación del orquestador y/o red team);
- `HUM` = prueba humana real;
- `LIM` = limitación conocida.

| ID | Decisión | Diseño | Commits | Tests | Evidencia | Estado | Calidad |
|---|---|---|---|---|---|---|---|
| W0-ROUTING | Flujo natural → proyecto-fisico; afirmaciones sólo después de APLICADO; comportamiento sin pedido → sin C++ | `PHASE_3_WAVE_0_DESIGN.md` (F-03/04/05/15) | RED `d38d0e1` → `e7e50b7`; FX-2 `61a7b65`, FX-2b `28ea49a` → `c092bce` | `tests/wave0-routing.test.mjs` | Freeze Wave 0 (`eff51184…`): `WINDOWS_SIMULATED_REPORT`; smoke PHT (`ev-pht`) | Hecho; en main | RED, IND, SIM, VM. FX-2 se completó tras la verificación |
| W0-VOCAB | La tool expone vocabulario y `valoresValidos`; línea `resultado` | `PHASE_3_WAVE_0_DESIGN.md` (F-06/F-07) | RED `882f073` → `a98532e`; FX-5 `dd4a469`/`505639d`; FX-6 `164fdc2` | `tests/wave0-tool.test.mjs` | Docente simulado: 0 llamadas fallidas por vocabulario (~16 antes) | Hecho; en main | **RED\*** (vocabulario.ts escrito antes del test, declarado), IND, SIM, VM |
| F-11 | Coalescer de GPIO: 1 POST en vuelo, cola por selector, foco | `PHASE_3_WAVE_0_DESIGN.md` (F-11) | RED `d9950c2` → `fda3f51`; FX-1 `290e099` | `tests/wave0-view.test.mjs` | BRW base contra HEAD; VM Edge: 3 flechas → 1 revisión, 0 stale | Hecho; en main | RED, MOD (test de 2 selectores ajustado post-RED, justificado), BRW, VM, IND |
| HD-W0-A | Terminal `asignable:false` → `AsignarPin` rechazado (Camino B) | `PHASE_3_PRE_HUMAN_TEST_DESIGN.md` §1, §7 | `d94649d` → `c9fb79c`; `2312f3f` (tests de Wave 0 por contrato) | `tests/pht-engine.test.mjs` (A1–A10) | RED reproducido (8 aserciones); VM: rechazo en el producto instalado, rev 2→2, IR idéntico | Hecho; rama PHT | **RED\*** (fix antes del test; declarado en el mensaje de `d94649d`), IND, VM. LIM: catálogo desconocido (H1) |
| HD-W0-B | La resistencia se ve en serie (proyección derivada de IR + catálogo) | `PHASE_3_PRE_HUMAN_TEST_DESIGN.md` §2, §7 | `da4f2ca` → `188fc2a`; `5a44116` → `fb047ae`; `75feeb5` → `a569f36` | `tests/pht-view.test.mjs` (B1–B8, contigüidad/adyacencia, grupo visual, fail-closed) | BRW a 800/1280/1920; VM (captura `ev-pht/v-escritorio.png`); 2 FAIL pedagógicos corregidos | Hecho; rama PHT | RED (+ desviación menor declarada en `5a44116` para `da4f2ca`), BRW, VM, IND |
| HD-W0-C | "LED 2" → "LED" aceptado; id interno estable | `PHASE_3_PRE_HUMAN_TEST_DESIGN.md` §3 | — (no se implementa) | — | `scratchpad/pht/hdw0c/resultado.txt`: `cmp-1` se conserva | ACCEPTED_MINOR_BACKLOG | IND |
| §26 | Prueba humana real (alumno y docente) | `PHASE_3_REAL_HUMAN_TEST_PROTOCOL.md` | — | — | — | **NOT EXECUTED** | — (HUM pendiente) |
