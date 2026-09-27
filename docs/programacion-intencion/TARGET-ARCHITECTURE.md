# TARGET-ARCHITECTURE.md — resumen implementable del target cerrado

Resume la arquitectura objetivo del brief congelado (`BRIEF.md` referencia el archivo
completo por path+sha256; este documento cita secciones, nunca transcribe el brief
completo) y separa explícitamente qué de eso **Fase 1 (`opencode/nucleo/`) ya
implementa** de qué queda para fases posteriores. No es un documento de diseño nuevo:
es la versión "qué hay hoy vs. qué falta" del §21 del brief.

## 1. El diagrama del brief (§21, literal)

```
estudiante
    │
┌───┴────────────┐
▼                ▼
chat/OpenCode    navegador local
    │ operaciones     │ operaciones
    └────────┬────────┘
             ▼
      PROJECT ENGINE (autoridad única: operaciones, transacciones,
                       revisions, validación, reason codes)
             ▼
            IR persistida
             │
   ┌─────────┼──────────────┐
   ▼         ▼               ▼
catálogo  vista física   vista lógica
semántico   Wokwi          Blockly
   │          ▲               ▲
   └──────────┴───ProjectChanged───┘
                    │
              proyecciones
              ┌─────┴──────┐
              ▼            ▼
           codegen    walkthrough
              │
              ▼
          PlatformIO
              │
              ▼
         hardware real
```

Reglas del brief (§21, citadas literal): navegador y agente son PRODUCTORES de
operaciones, nunca escritores directos del archivo; el Project Engine es la única
autoridad de mutación; toda mutación aceptada incrementa la revisión; las operaciones
se contrastan contra `baseRevision` para evitar lost updates; las vistas reciben
cambios aceptados por notificación (`ProjectChanged`), nunca reconstruyen estado
leyendo HTML/archivos por su cuenta; HTML, workspace Blockly y C++ generado son
proyecciones, NUNCA fuentes de verdad; el transporte y la ubicación física del Engine
quedan abiertos hasta que se decidan (Fase 0 ya cerró esa decisión — no es parte de
lo que implementa `nucleo/`, ver §2 más abajo).

## 2. Qué de esto implementa Fase 1 (`opencode/nucleo/`) — y qué NO

| Pieza del diagrama | Fase 1 (`nucleo/`) | Fase posterior |
|---|---|---|
| **IR persistida** | ✅ `ir.ts` + `cargador.ts` (Gate 2) — tipos, forma canónica, loader | — |
| **Project Engine — autoridad única de mutación** | ✅ `motor.ts` (Gate 6): `getProyecto`/`proponer`/`aplicar`/`aplicarTransaccion`, revisión, `baseRevision` | — |
| **Operaciones semánticas** | ✅ `operaciones.ts` (Gate 5): 8 operaciones puras, `reasons[]` en éxito y error | — |
| **Catálogo semántico** | ✅ `catalogo.ts` + `catalogo-datos.ts` (Gate 3): capacidades/cantidades/reglas genéricas | Editor de catálogo para docentes — explícitamente "no hacer todavía" (§25) |
| **Validación (estructural/técnica/semántica) + readiness** | ✅ `validar-estructural.ts`/`validar-tecnico.ts`/`validar.ts` (Gate 4) | Validación semántica de nivel 5 real (Fase 1 = passthrough `[]`, ver `DECISIONS.md`) |
| **Persistencia atómica** | ✅ `almacen.ts` (Gate 7) | `Almacen.list()`, detección de modificación externa (fuera de alcance, `DECISIONS.md`) |
| **Undo/redo protocolo preparado** | ✅ buffer de undo-readiness en memoria, acotado a 50, en `motor.ts` (§9.2/§36 del brief: "protocolo preparado... desde Fase 1") | Undo/redo funcional real (comando que revierte) — Fase 1 sólo prepara el buffer, no lo consume |
| **`ProjectChanged` / notificación a vistas** | ❌ fuera de `nucleo/` | Fase 2+ — es un consumidor del motor, no parte del núcleo semántico (§10, §21) |
| **Transporte (dónde vive el Engine, protocolo navegador↔proceso)** | ❌ | Fase 0 ya auditó el estado actual (`CURRENT-ARCHITECTURE.md` §12); la decisión de diseño del transporte es posterior a Fase 1 |
| **Vista física (Wokwi)** | ❌ — `circuito.ts` sigue siendo el único generador real, sin tocar (§25 "no hacer todavía: reescritura masiva de circuito.ts") | Fase 2 — Proyección física (§26) |
| **Vista lógica (Blockly)** | ❌ | Fase 3 (§27) |
| **Programación por intención (LLM → operaciones IR directo)** | ❌ | Fase 4 (§28) |
| **Codegen (IR → C++)** | ❌ | Fase 5 (§29) |
| **PlatformIO / hardware real** | Ya existe HOY vía `platformio.ts` (independiente de este núcleo) | Fase 6 conecta el codegen nuevo con ese flujo (§30) |
| **Prioridad/conflicto entre reglas de comportamiento (motor de reglas en vivo)** | ❌ | Fase 3 (§27) — ver `IR-SPEC.md` §3.1, `DECISIONS.md` |

## 3. Decisiones cerradas del brief que Fase 1 ya satisface (§20, tabla de trazabilidad)

Extracto de la tabla del brief §20, sólo las filas que `nucleo/` ya cierra con código
real (evidencia: gate y archivo):

| Decisión cerrada (brief §20) | Sección normativa | Evidencia en `nucleo/` |
|---|---|---|
| Proyectos incompletos son persistibles | §11, §25 | `almacen.ts` + demo contractual caso 1 |
| Magnitudes/unidades se propagan por variables | §8.1 | `catalogo.ts` (`propagarMagnitud`, `reemplazarSensor`) |
| `reasons[]` estructurados en éxito y error | §12, §33 | `motivos.ts` + toda la cadena de validadores/operaciones |
| Transacciones, dry-run y rollback semántico | §9, §25, §33 | `motor.ts` (`proponer`/`aplicarTransaccion`) |
| Protocolo preparado para undo/redo desde Fase 1 | §9, §25, §36 | buffer acotado en `motor.ts` (OD-21) |
| `schemaVersion` + `catalogVersion` + `catalogHash` | §11, §33 | `ir.ts`/`cargador.ts`/`catalogo.ts` |
| Catálogo declarativo/extensible por datos | §8, §36 | `catalogo-datos.ts` (componente sintético sin tocar código, Gate 3) |
| `pedagogicalLint` separado de validación técnica | §12 | `lint-pedagogico.ts` (Gate 4) |
| Project Engine es autoridad única de mutación | §10, §21 | `motor.ts` |
| Readiness derivado (IR + catálogo + validadores) | §10, §11 | `validar.ts` (`derivarReadiness`, nunca persistido) |
| Frontera IA/determinismo: regla objetiva → código determinista | §9 | Todo `nucleo/` es determinista y puro; el LLM nunca corre dentro de estos módulos |

## 4. Lo que el brief pide para Fase 1 y todavía NO cierra (abierto, con evidencia)

- **Prioridad/conflicto de reglas de comportamiento simultáneas** — diferido a Fase 3
  (§27), documentado en `IR-SPEC.md` §3.1 y `DECISIONS.md`.
- **`SetProperty`/`FijarPropiedad` con valor fuera de rango** — el brief mismo dice
  (§25 nota de orden) que la clasificación A/B de cada regla vive en `OPERATIONS.md`/
  `IR-SPEC.md`/`COMPONENT-CATALOG.md`, no en el brief. Como esa clasificación nunca se
  hizo para este caso puntual, la operación completa queda fuera de Fase 1 (decisión
  del orquestador, `OPERATIONS.md` §4).
- **`Almacen.list()` y detección de modificación externa** — marcados "incluido por
  utilidad"/"hardening opcional" en versiones previas del diseño, sin decisión de
  alcance; el orquestador los dejó fuera de Fase 1 explícitamente (`DECISIONS.md`).
- **`createdWithCatalogVersion`/`validatedWithCatalogVersion` separados** (OD-11) —
  Fase 1 persiste un solo par `catalogoVersion`/`catalogoHash`; sigue formalmente
  abierta para una fase posterior si hace falta separar los dos conceptos
  (`IR-SPEC.md` §4).

## 5. Qué significa "cerrado" acá

Este documento no declara Fase 1 "terminada" — eso lo dice el freeze de Fase 1 (Gate
9, todavía no ejecutado a la fecha de este documento). Lo que sí cierra es la
pregunta "¿el target del brief está bien entendido y mapeado contra lo que existe
hoy en `nucleo/`?" — sí, con la tabla de arriba como evidencia trazable gate por
gate, archivo por archivo.
