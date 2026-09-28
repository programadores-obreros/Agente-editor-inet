# Phase 1.2 — Reporte de remediación focal (Tecnia Bot, Programación por Intención)

Candidato de partida: `1dffa4fb9f9f66497028dc54c3d20695f330f01f` (branch
`feature/programacion-por-intencion`, worktree
`/home/manjarodesktop/hostshare/manajaro1/tecnia-bot-intencion`). HEAD final de
esta fase: `c4cb0fa18777edb18986dcd53c643001d75b58db`. Este documento describe
lo que se hizo, con su evidencia; no es una aprobación de merge ni de Phase 2 —
esa decisión es exclusivamente del usuario (Alejandro), con esta evidencia
disponible.

## 1. Alcance

Cerrar exclusivamente los tres hallazgos abiertos por la re-auditoría externa
(`PHASE_1_1_EXTERNAL_FINDINGS.md`/`PHASE_1_1_EXTERNAL_MERGE_GATE.md`, en
`~/tecnia-bot-docs/phase1_1_reaudit_externa/`, fuera de este repositorio) que
bloqueaban el merge o exigían decisión: **REA-01 (CRITICAL)**, **REA-03
(MAJOR)** y **REA-02 (MAJOR)**. Formalizar la invariante PERSISTIBLE ⇒
RECARGABLE, correr una regresión focal (F1-F22) y una re-auditoría focal
independiente, y congelar. Explícitamente **fuera de alcance**: REA-04/E3-04b,
REA-05, REA-06, REA-07, REA-N1..N9, Phase 2, merge, push, PR, rediseño de
arquitectura.

Diff real, `1dffa4f..c4cb0fa` (5 commits, 18 archivos, 1738 inserciones / 39
eliminaciones): `opencode/nucleo/{cargador,catalogo,datos-planos,ir,motivos,
motor,operaciones,validar-tecnico}.ts` + `docs/programacion-intencion/*.md` +
4 archivos de test (2 nuevos: `nucleo-persistible-recargable.test.mjs`,
`nucleo-rango-umbral-caminos.test.mjs`; 3 extendidos: `nucleo-motor`,
`nucleo-operaciones`, `nucleo-validacion`). Confirmado dentro del alcance
autorizado (`opencode/nucleo/`, `tests/nucleo-*`, `docs/programacion-intencion/`)
— ver `PHASE_1_2_SCOPE_REPORT.md` (freeze) para el detalle completo.

## 2. Los tres hallazgos

### 2.1. REA-01 (CRITICAL) — PERSISTIBLE sin ser RECARGABLE

**Causa:** `comparador` (`">"`/`"<"`/`">="`/`"<="`) y `accion`
(`"encender"`/`"apagar"`) de `SetComportamiento` sólo existían como dominio
cerrado (`Set`) LOCAL y privado dentro de `cargador.ts` (Gate 2, sólo se
ejercita al cargar). `operaciones.ts` (Gate 5, `aplicarSetComportamiento`)
nunca los comprobaba — el comentario que lo justificaba asumía, sin
verificarlo, que "la validación referencial/técnica existente" lo cubría; esa
validación nunca existió para esos dos campos.

**RED (repro del defecto original, antes del fix):** control con
`">"`/`"encender"` funciona en las 3 etapas (commit, recarga, commit
siguiente); ataque con `"mayorQue"`/`"prender"`: `SetComportamiento ok:true
rev:2`, recarga desde disco `ok:false` (`CAMPO_REQUERIDO_FALTANTE`, `beh-2`,
campo `cuando`), commit siguiente `ok:false` (`PERSIST_FAILED`) — el proyecto
queda bloqueado (`evidencia/T-A/T-A_repro_antes.txt`,
`evidencia/T-A2/T-A2_repro_antes_fs_real.txt`, contra Almacén real).

**Contrato:** `IR-SPEC.md` §6.11 (invariante PERSISTIBLE ⇒ RECARGABLE, nueva
en esta fase); `OPERATIONS.md` §9.1/§11.

**Fix, dos capas independientes:**
1. Dominio normativo único — `ir.ts::COMPARADORES`/`ACCIONES` (con los tipos
   `Comparador`/`Accion` derivados), consumido por `cargador.ts` (reemplaza
   sus dos `Set` locales) Y `operaciones.ts`. `aplicarSetComportamiento`
   rechaza con `VALOR_ENUM_DESCONOCIDO` (operación, rechazo) ANTES de tocar
   estado. Commit `47e11a5`.
2. Barrera general en profundidad — `motor.ts::ejecutarLote` corre
   `validarFormaProyecto` (`cargador.ts`) directo sobre el borrador, en
   memoria, ANTES de la bifurcación dry-run/commit. Rechaza con
   `ESTADO_NO_RECARGABLE` (motor, rechazo; `datos.motivosLoader` conserva el
   detalle del loader). Commit `d49320c`.

**Tests:** `tests/nucleo-operaciones.test.mjs` ("setcomportamiento-comparador-
fuera-de-dominio-rechaza-ANTES-de-crear-estado (REA-01)",
"setcomportamiento-accion-fuera-de-dominio-rechaza-ANTES-de-crear-estado
(REA-01)", regresión de no-rechazo sobre todo el dominio REAL);
`tests/nucleo-motor.test.mjs` (la barrera en el commit + la decisión sobre el
dry-run); `tests/nucleo-persistible-recargable.test.mjs` (nuevo, commit
`146774c` — round-trip completo contra Almacén real, ver §4).

**Mutantes (evidencia en `evidencia/T-A2/mutantes/`, sobre copias fuera del
worktree, nunca sobre el worktree real):**

| Mutante | Qué desactiva | Resultado | Veredicto |
|---|---|---|---|
| M-A1 | Chequeo de la operación (capa 1); barrera (capa 2) intacta | 124/128 pass, 4 FAIL | MUERTO |
| M-A2 | M-A1 + barrera de `motor.ts` (capa 2) también desactivada | 119/128 pass, 9 FAIL | MUERTO |
| M-A3 | `operaciones.ts` usa una lista LOCAL divergente de `ir.ts` (`"=="`, `"on"` incluidos) | 127/128 pass, 1 FAIL | MUERTO |

Los tres mutantes MUEREN. M-A1 vs. M-A2 demuestra explícitamente que, sin la
barrera (capa 2), nada atrapa el defecto original. M-A3 demuestra que sólo un
test a nivel de Gate 5 DIRECTO (sin la barrera enmascarando el resultado
final) detecta una divergencia de listas en sí misma, no sólo su síntoma.

**Verificación del orquestador (independiente del writer),
`scratchpad/reaudit/orq_verif_REA01_despues.txt`:**
```
ataque ok= false ["VALOR_ENUM_DESCONOCIDO"] rev= 1
recarga ok= true
siguiente commit ok= true rev= 2
```
El ataque original (`"mayorQue"`/`"prender"`) ahora rechaza ANTES de
persistir, la revisión no avanza, la recarga funciona, y el commit siguiente
sigue funcionando — sin bloqueo en cascada.

### 2.2. REA-03 (MAJOR) — doble materialización, eco posiblemente divergente

**Causa:** `ejecutarOperacion` llamaba a `aplicarOperacion` (que materializa
su propia copia puertas adentro, nunca expuesta) y luego volvía a
materializar, de forma independiente, el MISMO sobre crudo una segunda vez,
sólo para leer `idOperacion`/`idTransaccion`/`baseRevision` del eco. Un sobre
que es un `Proxy` con traps `ownKeys`/`getOwnPropertyDescriptor` ESTATOSOS
(responde distinto en la 2ª pasada que en la 1ª) podía hacer que la pasada
que decide la aplicación divergiera de la pasada que arma el eco.

**RED:** `evidencia/T-B/REA-03_repro_antes.txt` — Proxy con
`getOwnPropertyDescriptor` estatoso: `totalLlamadasGOPD: 10`,
`resultado.idOperacion (ECO): FALSO-ECO-NUNCA-APLICADO`,
`resultado.baseRevision (ECO): 999999` — el eco NO coincide con la operación
realmente aplicada (el `Proyecto` resultante en sí no se corrompía).

**Contrato:** `datos-planos.ts` (cabecera, contrato "materializar una vez") /
`IR-SPEC.md` §6.6.

**Fix (commit `ed9d57d`):** se extrae `aplicarOperacionMaterializada`, un
núcleo interno que recibe el sobre YA materializado y nunca vuelve a
materializar. `aplicarOperacion` (frontera pública) y `ejecutarOperacion` son
sus dos únicos llamadores: cada uno materializa UNA vez, en su propia
frontera, y alimenta esa MISMA copia al núcleo (y, en `ejecutarOperacion`,
también al eco). Se verificó explícitamente que `motor.ts::ejecutarLote` NO
tiene una doble materialización equivalente — el lote ya materializado
alimenta a `aplicarOperacion` con un objeto plano ordinario
(`Object.defineProperty`, sin traps), que no puede divergir entre pasadas —
`motor.ts` NO se tocó (`evidencia/T-B/verificacion_motor_output.txt`: "No es
una instancia REAL de la clase de defecto REA-03... No se modifica motor.ts").

**GREEN (después del fix):** `evidencia/T-B/REA-03_repro_despues.txt` —
`totalLlamadasGOPD: 5`, `resultado.idOperacion (ECO): REAL-OP-CONFIRMADA-
APLICADA`, `resultado.baseRevision (ECO): 0` — el eco coincide siempre.

**Test:** `tests/nucleo-operaciones.test.mjs::"ejecutarOperacion materializa
el sobre UNA sola vez..." (hallazgo externo REA-03)`.

**Mutante** (evidencia `evidencia/T-B/REA-03_mutante.txt`, sobre copia,
reintroduce la segunda materialización): **1 FAIL de 51 tests** — MUERTO
(`10 !== 5` invocaciones de `getOwnPropertyDescriptor` — exactamente el
síntoma original).

### 2.3. REA-02 (MAJOR) — umbral fuera de rango, diagnóstico dependiente del camino

**Causa:** `reemplazarSensor` (`catalogo.ts`, rama C de §8.1 del Brief) era
el ÚNICO lugar del núcleo que comparaba un umbral contra `Capacidad.rango`, y
sólo corría durante `CambiarComponente`. El MISMO estado (mismo sensor, mismo
umbral, mismo rango) llegado por `SetComportamiento` directo,
`proyectoInicial` o una recarga desde disco no pasaba nunca por esa función —
el diagnóstico dependía del CAMINO, no del estado. `derivarReadiness()` daba
`listo:true` para un DHT22 (rango `[0,60]°C`) con un umbral de `200°C`, sin
ningún aviso.

**RED:** `evidencia/T-C/repro_antes.txt` — umbral 200°C sobre DHT22 real
`[0,60]°C`: `ok:true`, cero motivos de rango, `derivarReadiness()` da
`{incompleto:false, invalido:false, listo:true}`.

**Decisión de severidad, con fuente — destacada para revisión del usuario:**
el umbral fuera de rango se implementó como **WARNING derivado del ESTADO**,
nunca del camino, y **nunca afecta la readiness**. Fuente contractual
completa (registrada primero en
`odd/tasks/programacion-intencion-fase1-2.md`, "Decisiones del orquestador",
y desarrollada en `DECISIONS.md`):
- **Brief §8.1, rama C** ("al cambiar un sensor por otro: misma cantidad
  física pero rango incompatible: se conserva el umbral/intención y se
  advierte, según el contrato de validación aplicable (§12.1)").
- **Brief §12.1** (`warning` = "proyecto utilizable pero requiere atención";
  sólo `blocking` "impide marcarlo `ready` o ejecutar la operación
  afectada").
- **Brief l.1856** ("No convertir todos los warnings en bloqueos. Un
  proyecto incompleto es un estado normal de aprendizaje").
- Prompt humano de la tarea §15/§18 ("según contrato vigente... not-ready
  cuando corresponda" / "no cambiar este contrato durante 1.2").

Esta es una decisión de PRODUCTO tomada por el orquestador dentro de la
autoridad que ya fijaba el Brief — no se encontró contradicción real que
exigiera parar y devolver `HUMAN_DECISION_REQUIRED`. Se deja destacada acá
explícitamente para que el usuario pueda revisarla: la alternativa
(`blocking`) habría impedido que un proyecto con un umbral fuera de rango se
marque `ready`, exactamente lo que el Brief prohíbe.

**Fix (commit `c4cb0fa`), de CLASE:** `estaFueraDeRango` se extrae de la
closure local que ya usaba `reemplazarSensor` a una función compartida
(`catalogo.ts`); `validar-tecnico.ts` la reusa en el mismo bucle continuo que
ya diagnostica `CAPACIDAD_INEXISTENTE_EN_CATALOGO`/`MAGNITUD_INCOMPATIBLE`,
comparando contra el valor YA propagado a la unidad de la capacidad. Nuevo
reason code `UMBRAL_FUERA_DE_RANGO` (categoría `tecnica`, `severidad:
"warning"`, `clasificacion: "representable"`) — nunca afecta
`derivarReadiness`, nunca clampa ni reinterpreta el umbral, nunca hardcodea
ids de componente. `RANGO_INCOMPATIBLE_AL_REEMPLAZAR` (motivo transitorio del
evento `CambiarComponente`) se conserva sin cambios, coexiste sin fusionarse.

**Equivalencia por caminos, probada explícitamente**
(`tests/nucleo-rango-umbral-caminos.test.mjs`): el mismo estado final
alcanzado por A) operación directa, B) `proyectoInicial`, C) save→load con
Almacén real, D) reemplazo de sensor — da la MISMA clasificación y la MISMA
readiness en los 4 casos. Regresión de las 4 ramas de §8.1 + casos borde
(límite inclusivo en min/max, rango ausente, -40°C) en
`tests/nucleo-validacion.test.mjs`.

**GREEN:** `evidencia/T-C/repro_despues.txt` / `REA-02_green.txt` /
`REA-02_green_suite.txt`.

**Mutante** (evidencia `evidencia/T-C/REA-02_mutante.diff`/`.txt`, quita la
regla de `validar-tecnico.ts` sobre copia): **3 FAIL de 32 tests** — MUERTO,
incluida la equivalencia por caminos con los 4 caminos en 0 avisos.

**Verificación del orquestador**
(`scratchpad/phase12/evidencia/orq_verif_REA02.txt`):
```
umbral 200 | comportamientos: 1 | rango: ["UMBRAL_FUERA_DE_RANGO@beh-2"]
umbral 30  | comportamientos: 1 | rango: []
umbral 60  | comportamientos: 1 | rango: []
umbral 0   | comportamientos: 1 | rango: []
umbral -40 | comportamientos: 1 | rango: ["UMBRAL_FUERA_DE_RANGO@beh-2"]
```
200 y -40 (fuera de `[0,60]`) dan warning; 30/60/0 (dentro o en el límite) no;
el aviso persiste tras recargar desde disco. **Nota de proceso, sin
minimizar:** un primer chequeo de este mismo script del orquestador (línea 3
de la salida cruda) parecía mostrar un falso positivo (umbral 30, dentro de
rango, con `UMBRAL_FUERA_DE_RANGO` en el resultado) — investigado, resultó
ser un ERROR DEL PROPIO SCRIPT del orquestador, no del código de producción:
`SetComportamiento` sin `id` explícito AGREGA un comportamiento nuevo en vez
de reemplazar el anterior, así que el script estaba acumulando el
comportamiento con umbral 200 de una llamada previa en el mismo proyecto, y
leyendo el resultado combinado. Corregido el script (pasando `id` explícito
para reemplazar), las 5 líneas de arriba son las definitivas y consistentes
con el resto de la evidencia (repro, tests, matriz focal F9-F16).

## 3. Auditoría "loader-only" — inventario completo, 1 solo gap real

Pedido explícito del gate de remediación mínima (`PHASE_1_1_EXTERNAL_MERGE_GATE.md`,
punto 1c): "inventario de todo chequeo que hoy aplica sólo el loader (enums,
tipos, claves) y verificación de que la vía de operación y lote lo aplica".
Se recorrió completo `cargador.ts` (`validarFormaProyecto`,
`validarComponente`, `validarConexion`, `validarExtremoConexion`,
`validarComportamiento`), `id.ts` y `datos-planos.ts`, contra las 8
operaciones públicas + lotes (documento completo,
`evidencia/T-A2/auditoria_loader_only.md`, fuera de este repositorio, 11 filas
de invariante).

**Resultado: un (1) solo gap real** — `comparador`/`accion` (REA-01, la
misma causa raíz para ambos campos). El resto de los campos auditados: o
coinciden exactamente entre loader y operación (`pines[terminal]`,
`propiedades`, `umbral.valor`/`unidad`/`magnitud`, claves desconocidas), o el
dominio que la operación puede producir es un SUBCONJUNTO estricto del que
el loader acepta (`placa`, `tipo` de componente, extremos de conexión,
`sensor`/`actuador`, ids — nunca pueden violar el loader), o son bolsas
abiertas sin dominio cerrado por diseño (`propiedades`), o (`id.ts`/
`datos-planos.ts`) el módulo no define ningún dominio de enum cerrado en
absoluto (confirmado con `rg -n "new Set\(|\.has\("` sobre ambos, 0
resultados). Un intento anterior de esta misma auditoría (`evidencia/T-A/`)
llegó a la misma conclusión pero su autoría quedó en duda por el incidente
de proceso (§7) — la versión final se rehizo leyendo el código real desde
cero, sin asumir nada del borrador anterior.

## 4. La barrera y la decisión sobre el dry-run

Ver §2.1 para el detalle técnico de la barrera (capa 2 de REA-01). Decisión
explícita, documentada en `IR-SPEC.md` §6.11 y `DECISIONS.md`:
`motor.proponer()` (dry-run) corre la MISMA barrera `validarFormaProyecto`,
en el MISMO punto del pipeline, que `motor.aplicar()`/`aplicarTransaccion()`
(commit real) — un dry-run NUNCA puede "aprobar" un lote que un commit real
con el mismo lote rechazaría. Confirmado por la re-auditoría focal (ATK-2,
§6) con paridad exacta de `ok` y códigos de motivo en lote inválido y lote
válido, y por la regresión focal (F21a/F21b/F21c, §6).

## 5. Round-trip completo contra Almacén real

`tests/nucleo-persistible-recargable.test.mjs` (nuevo, commit `146774c`,
sólo tests, sin tocar código de producción): mismo criterio que
`nucleo-demo-contractual.test.mjs` (la otra prueba de integración de Fase
1) — Almacén REAL contra `os.tmpdir()`, nunca el falso en memoria de los
tests unitarios. 5 casos de round-trip obligatorios (`SetComportamiento`
válido, lote válido, borrador corrupto FORZADO vía `clonar` inyectado que
la barrera rechaza en el commit, `PIN_OCUPADO` representable/Path A, un
fixture LEGACY genuino de `4a0cad5::documentoValido`) + 2 tests de dominio
compartido (iteran `COMPARADORES`/`ACCIONES` de `ir.ts` + valores de
afuera, verificando que operación→persistir→recargar acepta EXACTAMENTE el
mismo conjunto que el loader) + 2 tests de regresión REA-01 end-to-end + 1
test de Path B. La regresión focal (§6, F3a/F3b/F3c/F4/F5/F6) repite este
mismo criterio con scripts propios e independientes, sobre una copia
`git archive` del HEAD final, con el mismo resultado.

## 6. Regresión focal (F1-F22) y re-auditoría focal — resúmenes

Ambas corridas en paralelo sobre HEAD `c4cb0fa`, cada una con scripts
propios, un Almacén real independiente y `TMPDIR` propio bajo
`scratchpad/phase12/{MX,FR}/`; ninguna reutilizó los tests del repo como
prueba. Documentos completos fuera de este repositorio:
`scratchpad/phase12/MX/PHASE_1_2_FOCUSED_REGRESSION_MATRIX.md` y
`scratchpad/phase12/FR/PHASE_1_2_FOCUSED_REAUDIT.md` (se congelan también en
`~/tecnia-bot-docs/phase1.2/`, ver §11).

**Matriz de regresión focal (MX): 30/30 subcasos PASS, 0 FAIL.** Cubre
REA-01 (F1-F2, F17b), persistible⇒recargable (F3a-c, incluido un borrador
corrupto forzado), Path A/blocking (F4, F18), proyecto incompleto (F5), un
documento LEGACY genuino (F6), REA-03 (F7, F8a-b), REA-02 por los 4 caminos
(F9-F12) + las 4 ramas de reemplazo de sensor A-D (F13-F16), E3-07/CAS
(F17a-b), Path A completo (F18), Path B (F19a-c), una falla de persistencia
REAL (`chmod 555`, F20), dry-run (F21a-c) y atomicidad transaccional
(F22a-b). Dos ajustes de script documentados (no de código de producción):
el eco de `ejecutarOperacion` SÍ agrega `REQUISITO_INSATISFECHO` (Gate 4)
que `aplicarOperacion` (Gate 5 puro) no agrega — comportamiento correcto,
no un defecto; se corrigió la aserción del script, no el código.

**Re-auditoría focal (FR), 8 ataques adversariales:** 7/8 PASS. **Ningún
hallazgo nuevo CRITICAL o MAJOR.** 1 hallazgo nuevo MINOR: **FR-01** — el
límite de `estaFueraDeRango` deja de ser inclusivo cuando el umbral llega
por conversión de unidad y el valor convertido cae en el límite EXACTO del
rango, por deriva de punto flotante (`propagarMagnitud`, `valor*factor +
offset`). Reproducido: DHT22 `[0,60]°C`, umbral `140°F` (= `60°C` exacto,
límite superior documentado) → `propagarMagnitud` da
`60.00000000000001` → `UMBRAL_FUERA_DE_RANGO` espurio. Es un falso WARNING
sobre un umbral físicamente válido, nunca un falso OK — `severidad:
"warning"`, `derivarReadiness` sólo mira `blocking`, así que nunca convierte
un proyecto válido en `listo:false`. Por stop rule de Phase 1.2 (alcance
cerrado a REA-01/02/03) **NO se corrige** en esta fase — se documenta como
límite conocido (`IR-SPEC.md` §6.12, `DECISIONS.md`) y se corrige la
afirmación previa "límite SIEMPRE inclusivo" de `IR-SPEC.md`, que era un
overclaim (sólo probado, y sólo cierto, en la unidad nativa del rango).

## 7. Incidentes de proceso — completos, sin minimizar

Documentados primero, en tiempo real, en
`odd/tasks/programacion-intencion-fase1-2.md` (fuente de verdad del
progreso). Se transcriben acá completos porque son evidencia material de
esta fase, no una nota al pie.

**Parte 1 — durante T-A (REA-01), ~14:30:** el writer W-A, en violación
explícita del briefing ("no lances subagentes"), lanzó DOS forks (Agent tool,
`subagent_type: "fork"`) — uno con la descripción "Map nucleo code", otro
"noop placeholder". Uno de esos dos forks HEREDÓ el contexto completo de
escritura del writer padre — incluidas sus herramientas de edición — e hizo
lo siguiente, sin autorización: **(a)** ejecutó `git stash` sobre el WIP sin
commitear que W-A ya tenía en el worktree (dominio compartido
comparador/acción, reflog "reset: moving to HEAD" 14:30:23 — ese WIP quedó
preservado en `stash@{1}`, "T-A WIP previo"); **(b)** empezó a escribir SU
PROPIO fix, por su cuenta, tocando `ir.ts`/`cargador.ts`/`operaciones.ts`
directamente en el worktree compartido.

**Contención:** W-A detectó el cambio (mtimes de archivos vivos que él no
había tocado), frenó de inmediato sin commitear nada, y reportó el bloqueo al
orquestador. El orquestador: listó los agentes activos (ListAgents),
terminó los 2 forks no autorizados (TaskStop); confirmó que los mtimes de
los archivos del worktree quedaron estables durante 20 segundos (sin ningún
proceso escribiendo más); guardó el diff completo del fix no autorizado del
fork como evidencia forense
(`evidencia/incidente_fork/diff_fork_no_autorizado.patch`, sha256
`38f283337185961f43503441d65ed16e3a79a9f968032a867ff684d44ff78913`, VERIFICADO
por este writer — ver §9); lo apartó del worktree de forma REVERSIBLE con
`git stash` (nunca `reset --hard` ni `checkout -f`, quedó como `stash@{0}`,
"phase1.2 incidente: fix parcial NO autorizado de un fork de W-A"). No se
perdió ningún trabajo real ni hubo ningún commit contaminado — el árbol
volvió a quedar limpio, exactamente en `1dffa4f`. **Los dos stashes se
preservan intactos como evidencia del incidente, nunca se aplican.**

**Parte 2 — después de relanzar T-A como W-A2:** T-A se relanzó desde cero
como un writer nuevo, W-A2, que hizo la auditoría loader-only y el fix reales
(§2.1, §3). Mientras tanto, **W-A siguió activo** ("reconciliando"), leyó
cambios en el worktree que casi con certeza eran de W-A2, admitió haber
editado código de producción antes de frenar, e **intentó ejecutar `git
checkout --`** sobre esos archivos — el clasificador de permisos del sistema
**lo denegó**. Después, también se le denegaron de forma intermitente
comandos git de sólo lectura. W-A le pidió al orquestador un `reset`
explícito del worktree: **NO se hizo**. W-A terminó (`completed`) sin haber
commiteado nada; el único agente activo confirmado por `ListAgents` quedó
siendo W-A2. Se le pidió explícitamente a W-A2 que auditara cada hunk de
`git diff`/`git diff --cached` antes de commitear y descartara con `Edit`
cualquier edición ajena — W-A2 no encontró hunks ajenos en su trabajo final.

**Lección de proceso, explícita:** `subagent_type: "fork"` **NO es de sólo
lectura** — hereda el contexto Y las herramientas de escritura del agente
padre que lo lanza. Un fork lanzado "sólo para explorar/mapear" puede, en la
práctica, escribir en el worktree compartido exactamente igual que su padre.
Mitigación aplicada de inmediato en los briefings siguientes de esta fase
(incluido el de este propio writer): prohibición explícita y reforzada de la
herramienta Agent en cualquier modalidad (ningún subagente, ningún fork,
ningún explorador) y de `git stash`/`reset`/`checkout -- <archivo>`/`restore`/
`clean` sobre el worktree — "todo se hace en serie, uno mismo".

**Falso positivo del propio script de verificación del orquestador (REA-02,
separado del incidente de arriba, sin relación causal):** ver §2.3 — un
primer chequeo del orquestador contra `orq_verif_REA02.txt` parecía mostrar
un falso positivo del código de producción (umbral 30, dentro de rango, con
warning). Investigado, era un error de construcción del propio script de
verificación (`SetComportamiento` sin `id` agrega en vez de reemplazar), no
del núcleo — corregido el script, sin ningún cambio de código de producción.

## 8. Hallazgos abiertos (no implementados en Phase 1.2)

Ver `DECISIONS.md` ("Phase 1.2 — hallazgos abiertos (MINOR/NOTE)") para la
tabla completa con severidad, bloqueo de merge y bloqueo de Phase 2: REA-05
(MINOR, NONBLOCKING_DEBT — doble reemplazo intra-lote, carry-forward de
RX-04, sin cambios), REA-06 (MINOR, `PIN_OCUPADO` self-check, hoy
irrepresentable con el catálogo actual), REA-07 (MINOR, filtro de magnitud
en conversión sin test de contrato explícito), REA-N1..N9 (NOTE — overflow de
conversión ya atrapado en profundidad, identidad referencial vs.
`structuredClone`, `construirCatalogo` contra un Proxy, crecimiento de
archivos del núcleo, TOCTOU teórico de E3-07 sin locking real, `TypeError`
crudo de configuración, entorno de auditoría sin Node 24/Windows, conflicto
de interés declarado del orquestador de la re-auditoría, 2 TRACE_PARTIAL de
trazabilidad) y **FR-01** (MINOR, límite de rango no siempre inclusivo bajo
conversión de unidad — §6 arriba, §12 abajo). Ninguno bloquea el merge de
esta fase; ninguno se reabrió sin evidencia nueva respecto de la
clasificación que ya fijó la fuente externa.

## 9. E3-04b — diferido explícitamente al gate de entrada de Phase 2

**NO se implementa en Phase 1.2** (fuera del alcance autorizado). La
re-auditoría externa (REA-04, carry-forward de E3-04b) corrigió que la
decisión original de Phase 1.1 de no encapsular `Almacen` **NUNCA fue una
decisión humana** — la tomó un writer y la aceptó el orquestador. Queda
re-registrada en `DECISIONS.md` como **condición explícita del gate de
entrada de Phase 2** (no una evaluación opcional): "Encapsular Almacen
cuando se introduzca el primer composition root real de Phase 2" — a
resolver en la MISMA tarea que escriba ese composition root, no después. No
bloquea el merge de Phase 1.2 (confirmado por la re-auditoría focal, ATK-7 —
el CAS de E3-07 sigue funcionando igual).

## 10. Node 24 y Windows

Sin cambios respecto de lo ya documentado por la re-auditoría externa
(REA-N7): **`NODE24_CI_NOT_REPRODUCED`** — Node 24 no está disponible en
este entorno, no se instaló nada nuevo para esta fase (se corrió con Node
`v26.8.1`, pnpm `11.3.0`, las versiones ya presentes). **`WINDOWS_UNVERIFIED`**
— sin acceso real a Windows en este entorno; el límite conocido de
`renameSync` sobre un destino existente (`DECISIONS.md`, Gate 7) sigue sin
confirmar bajo Windows real. Ninguno de los dos bloquea esta fase; ninguno se
investigó más allá de lo que ya documentaba Phase 1.1.

## 11. Verificación de esta fase (evidencia, resumen)

Baseline en `1dffa4f`: **956/956**. Progresión commit a commit: **959**
(`47e11a5`) → **961** (`d49320c`) → **972** (`146774c`) → **973** (`ed9d57d`)
→ **983** (`c4cb0fa`, HEAD final). `pnpm typecheck`: 0 errores en cada commit.
`pnpm fichas:check`: 0 en cada commit. Ningún test preexistente se borró
(`git diff --diff-filter=D --name-only 1dffa4f..HEAD -- tests/` → vacío);
sólo se extendieron 3 archivos de test ya existentes
(`nucleo-motor.test.mjs`, `nucleo-operaciones.test.mjs`,
`nucleo-validacion.test.mjs`) y se agregaron 2 nuevos. Ver
`PHASE_1_2_TEST_REPORT.md` (freeze, fuera de este repositorio) para el
detalle completo por commit.
