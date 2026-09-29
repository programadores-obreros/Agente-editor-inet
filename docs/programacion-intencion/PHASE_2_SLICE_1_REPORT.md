# Phase 2 — Vertical Slice 1: reporte de cierre ("quiero ver el LED")

Estado: P2-T13 (docs + red team + fix loop + freeze). HEAD auditado: `4348c30`
(`docs(guardias): documentar la limitacion de las guardias lexicas (H4, red-team
Phase 2 Slice 1)`). Rama `feature/programacion-intencion-phase2`, base `8b43c59`
(Phase 1 mergeada). Fuente de verdad de progreso/decisiones:
`odd/tasks/programacion-intencion-phase2-slice1.md` (gitignored).

## A. Merge de Phase 1

Fast-forward `main` `0fa7298` → `8b43c59`, sin commit de merge. El tree de `main`
resultante es idéntico al auditado (`2826d94a…`, referencia previa del gate de Phase 1).
Verificación pre/post merge, en el checkout de `main` (`/home/manjarodesktop/hostshare/manajaro1/tecnia-bot`):

| Chequeo | Antes del merge | Después del merge |
|---|---|---|
| `pnpm test` | 983/983 | 983/983 |
| `pnpm typecheck` | limpio | limpio |
| `pnpm fichas:check` | 17 hojas verificadas contra `MANIFEST.sha256` | 17 hojas verificadas contra `MANIFEST.sha256` |
| `.gestor/config.json` (checksum) | `24b96125e2…369cd37` | idéntico (no tocado por el merge) |

Sin push ni PR (`refs_antes.txt`: sólo refs locales/`origin` ya existentes antes del
trabajo). `main` queda en `8b43c59` con `.gestor/` todavía como directorio no
versionado (`?? .gestor/` en `git status --short`, confirmado también al cierre de
este informe). Evidencia completa: `.../scratchpad/phase2/merge/` (`pre_test.txt`,
`post_test.txt`, `pre_typecheck.txt`, `post_typecheck.txt`, `pre_fichas:check.txt`,
`post_fichas:check.txt`, `gestor_antes.txt`, `main_antes_log.txt`, `merge_output.txt`,
`refs_antes.txt`). PHASE1_MERGE_STATUS = COMPLETE.

La rama de Phase 2, `feature/programacion-intencion-phase2`, se creó en el worktree
`tecnia-bot-intencion` sobre esa misma base `8b43c59`. Los 2 stashes de evidencia del
incidente de Phase 1.2 quedaron intactos, sin tocar, durante todo el slice.

## B. Diseño

Cuatro agentes de reconocimiento read-only en paralelo, sin desacuerdo material entre
ellos (sin adjudicador):

- **ARCH-A** (composition root): recomienda in-process — el Project Engine vive dentro
  del proceso Bun de OpenCode, con un listener HTTP propio y chico (no el servidor
  nativo de OpenCode, que expondría toda su superficie). Descarta un sidecar de
  proceso separado (gestión de proceso hijo y descubrimiento de puerto sin ganancia
  funcional para este slice). Propone el mecanismo mínimo de cierre de E3-04b:
  un único call site (`composicion-raiz.ts`) más un guardia estructural, sin DI ni
  proxies.
- **ARCH-B** (transporte): recomienda HTTP + SSE, un solo proceso, mismo origen para
  página/assets/API/eventos — nunca `file://` para la vista interactiva. Descarta
  polling (no cumple push nativo) y WebSocket (más superficie de protocolo sin
  necesidad demostrada). Precedente citado y reusado: `opencode/skills/archify/bin/preview.mjs`
  (puerto efímero, validación de `Host`, lifecycle con gracia).
- **ARCH-C** (adaptador IR → vista física): recomienda un módulo nuevo y puro
  (`opencode/vista-fisica/`), sin tocar `circuito.ts`. Confirma que `AsignarPin`
  alcanza sola para "cambiar el GPIO del LED" (no hace falta `Conectar`/`Desconectar`
  para eso). Señala que `asignarPin()` no valida `RegistroPin.restricciones`
  (gap heredado de Phase 1, no se inventa una regla eléctrica nueva en la vista) y dos
  formas de dibujar el cable (fila CSS esquemática vs. geometría real vía `pinInfo`),
  recomendando la primera para este slice.
- **ARCH-D** (plan de tests): 12 temas de aceptación, con la mitad ya GREEN a nivel
  Phase 1 (motor/almacén reales) y la otra mitad dependiente de las decisiones de
  diseño de ARCH-A/B/C. Ver `PHASE_2_SLICE_1_TEST_PLAN.md` para la correspondencia
  final contra los tests reales.

Síntesis congelada en `docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md`
(commit `8473f45`): composition root único (`opencode/nucleo/composicion-raiz.ts`),
transporte HTTP+SSE same-origin sobre loopback con puerto efímero, snapshot con
modelo de vista calculado del lado del servidor, `AsignarPin` como la operación de
edición, E3-04b cerrado por raíz de composición única. Decisiones explícitas del
orquestador: vista calculada server-side (pura, testeable sin DOM de test) más plan
de pintado JS puro testeado en node — la verificación DOM se hace en navegador real
en la demo; instaladores NO se tocan en este slice (el método exige VM Windows),
queda como tarea siguiente explícita.

## C. Implementación

Seis tandas de commits (`8b43c59..c910a3b` implementación, `c910a3b..4348c30` fixes
del red team), en orden:

1. **Raíz de composición y E3-04b** (`6ba16e4`, `75bb23f`) —
   `opencode/nucleo/composicion-raiz.ts`: factory idempotente
   `obtenerServicioDeProyecto({directorio, idProyecto, crearSiNoExiste?, calcularVista?})`,
   singleton por `(directorio, idProyecto)` en un `Map` de módulo. El servicio
   devuelto es angosto (`snapshot`/`aplicar`/`aplicarTransaccion`/`proponer`/
   `suscribir`/`cerrar`) y nunca expone el `Almacen` crudo. Cuatro guardias de
   contrato (superficie del módulo, superficie del servicio, guardia estructural
   `scripts/guardia-composicion-raiz.mjs`, singleton). **E3-04b: CERRADO** — ver
   `DECISIONS.md` ("Phase 2 Slice 1 — E3-04b: CERRADO por raíz de composición
   única"). `composicion-raiz.ts` no importa ningún módulo `node:` (invariante 29b
   de Phase 1, intocado).
2. **Snapshot y motor** (mismos commits) — `tests/phase2-snapshot.test.mjs` (forma,
   JSON plano, determinismo, no-contaminación) y `tests/phase2-motor-gpio.test.mjs`/
   `phase2-conflicto.test.mjs`/`phase2-paths.test.mjs`/`phase2-reload.test.mjs`
   ejercitan el escenario concreto ESP32+LED (GPIO4/16/18) contra un `Almacen` real.
3. **Adaptador IR → vista física, puro** (`9c7f8de`) —
   `opencode/vista-fisica/{modelo-vista.ts, snapshot-a-vista.ts, wokwi-render-datos.ts,
   vista-real.ts, web/plan-de-pintado.js}`. El hook `calcularVista` queda expuesto
   por la raíz pero SIN inyectar por defecto (el núcleo no depende de la vista).
   13 tests + un mutante de cable fijo (`tests/phase2-vista-fisica-mutante-cable-fijo.ts`).
4. **Servidor HTTP+SSE y único punto con vista** (`b539dbc`, `7363165`, `03b9b11`) —
   `opencode/servidor/servicio-con-vista.ts` (único call site de producción que
   inyecta `calcularVista: vistaDeProyectoConCatalogoReal`, con su propio guardia
   estructural) y `opencode/servidor/servidor-proyecto.ts` (`node:http`,
   `127.0.0.1:0`, rutas `GET /`, `GET /assets/<lista blanca>`, `GET /api/proyecto`,
   `POST /api/operaciones`, `GET /api/eventos` SSE). Protocolo completo documentado
   en `PHASE_2_SLICE_1_PROTOCOL.md`.
5. **Corrección del bundle Wokwi y la tool** (`95794ae`, `8ae49b8`, `c910a3b`) —
   `index.html` pasa a cargar `/assets/wokwi-bundle.js` (defecto detectado por el
   orquestador, ver §E) y aplica `vista.placa.escala`; `opencode/tool/vista-fisica.ts`
   (datos en `<ctx.directory>/.tecnia-vista-fisica/`, un servidor por proceso,
   permiso `vista-fisica: "allow"` agregado a `opencode/agent/tecnia-bot.md`);
   `scripts/vista-fisica-demo.mjs` (launcher `--dir`/`--una-vez`); suite e2e.
6. **Ronda única de fixes del red team** (`699ca9a`…`4348c30`) — ver §D.4.

Al cierre de la implementación (antes del red team): 1062/1062 tests, typecheck y
`fichas:check` limpios.

## D. Verificación

### D.1 Tests

| Hito | Tests | Fuente |
|---|---|---|
| Post-merge Phase 1 | 983/983 | `merge/post_test.txt` |
| P2-T1..T3 (W1: raíz + E3-04b) | 1005/1005 | commit `6ba16e4`/`75bb23f` |
| P2-T5/T6 puro (W2: vista física) | 1018/1018 | commit `9c7f8de` |
| W3 (servidor + único punto con vista) | 1059/1059 | commit `03b9b11` |
| W4 (bundle Wokwi, tool, e2e) | 1062/1062 | commit `c910a3b` |
| Ronda de fixes (W5, 7 commits) | 1100/1100 | commit `4348c30` |
| **Verificación final de este informe (HEAD `4348c30`)** | **1100/1100**, `pnpm typecheck` limpio, `pnpm fichas:check` (17 hojas) | corrido en este mismo worktree antes del commit de docs |

Detalle tema por tema (ARCH-D original + temas del red team, con archivo::nombre real):
`PHASE_2_SLICE_1_TEST_PLAN.md`. Los 983 tests de Phase 1 (`tests/nucleo-*.test.mjs`)
no tienen ningún diff en todo el rango `8b43c59..HEAD` (`git diff --name-only
8b43c59..HEAD -- 'tests/nucleo-*.test.mjs'` → vacío).

### Demo

Launcher de desarrollo: `scripts/vista-fisica-demo.mjs`. Usa la MISMA raíz de
composición (`opencode/servidor/servicio-con-vista.ts`) y el MISMO servidor HTTP+SSE
(`opencode/servidor/servidor-proyecto.ts`) que la tool de OpenCode
(`opencode/tool/vista-fisica.ts`) y el navegador — no es un segundo motor.

#### Levantar la demo interactiva

```
node scripts/vista-fisica-demo.mjs --dir /tmp/tecnia-vista-fisica-demo
```

(o con la variable de entorno: `TECNIA_VISTA_FISICA_DIR=/tmp/tecnia-vista-fisica-demo node scripts/vista-fisica-demo.mjs`)

- `--dir <directorio>` es OBLIGATORIO — nunca hay un default dentro del repo. Usar un
  directorio fuera del working tree (ej. un subdirectorio de `/tmp` o de
  `os.tmpdir()`), nunca una carpeta versionada.
- Si el proyecto (`demo.json`) todavía no existe en ese directorio, el launcher lo
  siembra con ESP32 + LED (ánodo en GPIO4) por OPERACIONES REALES del Engine
  (`SetPlaca`/`AgregarComponente`/`AsignarPin`) — nunca escribiendo el JSON a mano.
- Corriéndolo de nuevo sobre el MISMO directorio hace un reload real (releyendo el
  Almacén persistido): no vuelve a sembrar si el proyecto ya tiene placa.
- `--id-proyecto <id>` es opcional (default `"demo"`), para tener varios proyectos de
  prueba en el mismo directorio.
- El proceso imprime la URL (`Vista física — http://127.0.0.1:<puerto>/`) y queda
  escuchando: abrir esa URL en el navegador.

#### Cerrarla

`Ctrl+C` en la terminal donde corre (o `SIGTERM`/`SIGINT` al proceso) — cierra el
servidor HTTP+SSE (todas las conexiones abiertas) y el servicio, liberando el puerto,
antes de salir con código 0.

#### Modo `--una-vez` (para tests/CI)

```
node scripts/vista-fisica-demo.mjs --dir /tmp/tecnia-vista-fisica-demo --una-vez
```

Imprime la URL y el `Snapshot` completo (JSON, incluida la vista física) por stdout, y
cierra el servidor y el servicio inmediatamente después — sin quedarse escuchando.
Salida real capturada como evidencia en
`.../scratchpad/phase2/evidencia/W4/03-demo-una-vez.txt`.

#### Demo real con navegador (P2-T12, orquestador)

Ejecutada con Chromium headless real por CDP (`scratchpad/phase2/demo/cdp-demo.mjs`;
la extensión de Chrome no estaba conectada en la sesión, ver §E). Primera corrida,
sobre HEAD `c910a3b` (antes del fix de favicon/B2):

- Carga inicial: revisión 3, GPIO4, cable `D4 → A`, ESP32 y LED definidos y visibles
  (`<wokwi-esp32-devkit-v1>`/`<wokwi-led>` con `shadow:true`) — capturas
  `edit-1-carga.png`.
- Cambio con el `<select>` real (evento `change` nativo, no un fetch a mano) →
  revisión 4, GPIO16, cable `RX2 → A` — captura `edit-2-tras-cambio.png`.
- Recarga de la página → mismo estado — captura `edit-3-tras-recarga.png`.
- Reinicio del PROCESO del servidor (releyendo disco desde cero) → mismo estado
  (revisión 4, GPIO16) — `check-resultado.json`.
- Disco: `pines.anodo = "GPIO16"`, `revision: 4`.
- Host ajeno → 403.
- Observaciones de esa corrida: (1) `favicon.ico` 404 en consola (MINOR, corregido
  después por W5, ver §D.4); (2) el selector ofrecía GPIO1/3 (UART), 6-11 (flash),
  37/38 (no expuestos físicamente en el DevKit v1) — gap de datos/reglas de Phase 1,
  no parcheado en la vista (ver §D.7 y hallazgo B1); (3) la conexión se muestra como
  texto (cable esquemático por diseño, ARCH-C §3.4 opción A), visualmente débil.
  Error del propio orquestador durante esta corrida: un `TMPDIR` largo rompía los
  sockets de Chromium — el driver se corrió sin heredar ese `TMPDIR` (ver §E).

**Demo final, repetida sobre HEAD `4348c30`** (tras los 7 fixes de la ronda única),
directorio nuevo, evidencia en `.../scratchpad/phase2/demo/final/`:

- Carga: revisión 3 / GPIO4 / `D4 → A`.
- Cambio por `<select>` real → revisión 4 / GPIO16 / `RX2 → A`.
- Recarga → igual. Reinicio de proceso → igual.
- Consola: **vacía** (sin el 404 de favicon; `GET /favicon.ico` ahora da 204).
- Selector: **21 GPIO** ofrecidos (`GPIO1,2,3,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33`),
  todos con nombre Wokwi real, confirmado por `check-resultado.json`/`edit-resultado.json`
  (los 9 GPIO inventados de la corrida anterior — 0,6-11,37,38 — ya no aparecen).
- Disco: `pines.anodo = "GPIO16"`, `revision: 4`.

### D.3 Red team (P2-RED-A / P2-RED-B)

Dos agentes adversariales, read-only, sobre copias propias (`git archive HEAD | tar -x`),
nunca sobre el worktree real.

**P2-RED-A** (autoridad/persistencia/revisión/E3-04b), HEAD auditado `c910a3b`, 7
ataques:

| Hallazgo | Severidad | Resumen |
|---|---|---|
| H1 | CRITICAL | `normalizarDirectorio()` sólo recortaba una barra final: `dir` vs `dir//`, relativo vs absoluto y symlink vs destino daban servicios (motores) DISTINTOS sobre el mismo `<id>.json`. El caso relativo era el más grave: se resolvía contra `process.cwd()` en cada operación de disco. |
| H2 | CRITICAL | `cerrar()` sólo borraba la entrada del registro; el `ServicioDeProyecto` ya entregado seguía aplicando operaciones y notificando después de "cerrado" — dos motores vivos simultáneos sobre el mismo proyecto, sin ningún truco de claves. |
| H3 | MAJOR | Sin validación de `Origin`/`Content-Type`, cualquier pestaña de otro origen podía mandar un POST simple (`text/plain`, sin preflight) a `/api/operaciones` y ejecutar cualquier operación del motor (`QuitarComponente`, `SetPlaca`), no sólo `AsignarPin`. |
| H4 | MAJOR | Las dos guardias estructurales (`guardia-composicion-raiz.mjs`, `guardia-servicio-con-vista.mjs`) son heurísticas léxicas: un `import()` dinámico + acceso por concatenación de strings (`modulo["crear"+"Almacen"]`) evade ambos patrones, verificado ejecutablemente (el bypass obtiene las funciones reales). |
| H5 | CRITICAL | El CAS de disco de `almacen.ts` (E3-07) no tiene lock de archivo: entre DOS PROCESOS de sistema operativo reales compitiendo por el mismo directorio+idProyecto, en 3 de 4 corridas ambos recibieron `ok:true`, con pérdida silenciosa de uno de los dos commits — el proceso "perdedor" nunca se enteró. |

Se sostuvieron sin hallazgo: fallo de escritura sin notificación (ataque 4), reload +
Path A/Path B (ataque 7), y toda la batería de validación de forma del sobre HTTP
(ataque 3, casos 3.1-3.8).

**P2-RED-B** (navegador/proyección/recarga/corrección del estado físico), HEAD
auditado `c910a3b`, 7 ataques + 5 chequeos de seguridad/offline:

| Hallazgo | Severidad | Resumen |
|---|---|---|
| B1 | MAJOR | Contra el bundle Wokwi REAL (`el.pinInfo`, Chromium headless por CDP): 9 GPIO ofrecidos (0,6-11,37,38) no existen físicamente en la pieza; 2 (GPIO1/3) existen pero con nombre real distinto (`TX0`/`RX0`, no `D1`/`D3`). El fallback `D<n>` de `nombreWokwiDePin()` inventaba un dato no verificado. |
| B2 | MAJOR (borde de CRITICAL, sin corrupción de datos) | Con `listen(0)`, reiniciar el proceso del servidor da casi seguro un puerto nuevo. `app.js` no tenía listener `error` del `EventSource` ni ningún indicador de conexión: la pestaña vieja quedaba mostrando el último snapshot como si fuera vigente, indefinidamente, sin ninguna señal — contradice literalmente `PHASE_2_SLICE_1_DESIGN.md:87`. |

Se sostuvieron sin hallazgo: sincronización entre pestañas por SSE, conflicto stale
(el `<select>` termina en el valor canónico), Path A (`PIN_OCUPADO`, persistido y
editable), Path B (rechazo de dominio, sin estado optimista), reload desde snapshot,
invariante visual (3 de 63 nodos del DOM cambian), CSP (bloquea inline de verdad),
Host header, path traversal codificado, bind exclusivo a loopback, y offline (Network
de CDP sin requests fuera de `127.0.0.1`).

### D.4 Ronda de fixes (única, W5)

7 commits, `699ca9a..4348c30`, uno por hallazgo (más el commit de documentación de
H4):

| Commit | Hallazgo | Fix |
|---|---|---|
| `699ca9a` | H2 | Flag `cerrado` por servicio; `aplicar`/`aplicarTransaccion`/`proponer`/`suscribir` lo chequean y lanzan `SERVICIO_CERRADO`. `cerrar()` sigue idempotente. |
| `fd5715e` | H1 | `servicio-con-vista.ts` canonicaliza con `fs.mkdirSync`+`fs.realpathSync` antes de llamar a la raíz; `composicion-raiz.ts` (sin `node:`, por el invariante 29b) rechaza cualquier directorio no absoluto. La raíz cruda sigue permisiva a propósito (los tests de Phase 1/Phase 2 que fabrican varios motores en aislamiento no se tocan). |
| `b53cb07` | H5 | Candado de propiedad por proceso: `<directorio>/<idProyecto>.lock` con `fs.openSync(ruta, "wx")` (atómico por SO). Dueño vivo → falla claro; dueño muerto (PID) → se recupera. Se libera en `cerrar()` y al salir del proceso. Límites documentados, no cerrados: reuso de PID, filesystems de red. |
| `4f05e6f` | H3 | Exige `Content-Type: application/json` (415 si no) y `Origin` igual al propio (403 si no/ajeno) antes de leer el cuerpo. De paso, `GET /favicon.ico` → 204. |
| `ebd2681` | B1 | `ESP32_WOKWI_PIN` suma `1→TX0`/`3→RX0` (confirmados contra el bundle real); `nombreWokwiDePin()` ya no inventa `D<n>`, da `null` si no hay pin físico; `gpiosCandidatosPara()` ofrece la intersección Engine-acepta ∩ renderer-tiene-pin. |
| `866acb6` | B2 + favicon | `estado-conexion.js` (reductor puro); `app.js` escucha `error`/`open` del `EventSource` y actualiza un indicador visible; el selector se deshabilita sin conexión viva. |
| `4348c30` | H4 | Sin cambio de código — documenta la limitación (ver §D.6). |

### D.5 Regresión (P2-REG, ronda única)

Revisor nuevo, read-only, HEAD auditado `4348c30`. Ataques propios contra el camino de
producción real (no contra los ataques originales tal cual, sino reproducidos y, en
varios casos, extendidos):

| Hallazgo | Estado original | Estado tras la ronda de fixes |
|---|---|---|
| H1 | CRITICAL | **CLOSED** — incluida la variante más grave (cwd cambiante entre construcción y uso). Mayúsculas/minúsculas: no ejecutable en este FS (Linux/ext4, case-sensitive); sigue `WINDOWS_UNVERIFIED`, sin regresión. |
| H2 | CRITICAL | **CLOSED** |
| H5 | CRITICAL | **CLOSED** para el escenario que motivó la severidad (10/10 corridas, exactamente un ganador). Reuso de PID: residuo MINOR/NOTE, ya documentado por el propio fix, no reproducible determinísticamente. |
| H3 | MAJOR | **CLOSED**, sin sobre-rechazo (`application/json;charset=utf-8` se acepta). |
| H4 | MAJOR (según el auditor) | **OPEN — por decisión explícita, documentada** (ver §D.6). No es un fix incompleto. |
| B1 | MAJOR | **CLOSED** — las 21 opciones ofrecidas por el servidor de demo real coinciden 1:1 con `pinInfo` real. |
| B2 | MAJOR | **CLOSED**, incluida una variante que el writer no había probado en navegador real: reconexión al MISMO puerto (el `EventSource` reconecta solo y refetchea el snapshot fresco). |

Suite completa sobre la copia de REG: 1100 tests, 1098 pass, 2 fail — las 2 fallas son
ambientales y esperadas (`tests/biblioteca-visual.test.mjs` depende de `git ls-files`/
`.gitignore` real, ausentes en una copia sin `.git`). Ninguna otra falla. Regresión de
lo que ya funcionaba (flujo completo en navegador real: carga, cambio de GPIO,
invariante visual, reload, "reinicio de proceso", sync cross-tab, stale, Path A/B,
offline, consola sin errores, favicon 204): **sin hallazgos nuevos, CRITICAL ni
MAJOR**. Verificado también: el launcher de demo y las dos guardias estructurales
siguen dando el resultado esperado tras los 7 fixes.

### D.6 H4 — abierto por decisión, pendiente de confirmación del usuario

El hallazgo H4 (guardias estructurales léxicas evadibles con `import()` dinámico +
concatenación de strings) fue calificado **MAJOR por el auditor** (P2-RED-A) y
confirmado sin cambios por P2-REG. **La decisión de no cerrarlo con más regex —
documentar la limitación en vez de perseguirla con un patrón más específico— la tomó
el ORQUESTADOR de esta sesión, no un humano.** Queda registrada así, explícitamente,
en `DECISIONS.md` (sección H4) y en el propio encabezado de
`scripts/guardia-composicion-raiz.mjs`/`scripts/guardia-servicio-con-vista.mjs`. La
severidad MAJOR del auditor se mantiene tal cual — no fue relajada ni disputada.

**Esta decisión queda pendiente de confirmación del usuario humano.** El informe de
regresión (P2-REG) atribuyó, por error, esta decisión a un "humano" explícito (ver
§E, incidente de proceso) — el orquestador corrigió esa atribución para este
documento. Cerrarla de verdad requeriría un parser real (AST, la API de TypeScript/
`tsgo`) para detectar `import()` dinámico + acceso computado, un cambio de mecanismo
mayor que excede el alcance de "ronda única de fixes puntuales" de P2-T13.

**Resolución posterior (2026-09-29):** el HUMAN PRODUCT OWNER confirmó H4 como
`ACCEPTED_KNOWN_LIMITATION` (MAJOR original, no bloquea el slice). Registro y
condiciones de reapertura en `DECISIONS.md` (sección H4) y
`PHASE_2_SLICE_1_HARDENING_DESIGN.md` D15.

### D.7 Observaciones pendientes

- **Backlog heredado de Phase 1**: `asignarPin()` (`nucleo/catalogo.ts`) nunca
  consume `RegistroPin.restricciones` (flash/strapping/soloEntrada/uartUsb) — el
  Engine acepta hoy, sin `blocking`, una asignación a un pin reservado. Además,
  `placas.ts` incluye GPIO37/GPIO38 en `ESP32_GPIO_VALIDOS` sin ninguna restricción
  asociada (ni siquiera arreglar el gap de `restricciones` los sacaría de la lista
  de ofrecidos). Ninguno de los dos se resuelve en este slice — no reabre Phase 1.
- **Cables textuales/esquemáticos, no geométricos**: decisión de diseño de ARCH-C
  §3.4 (opción A, fila CSS con etiqueta de pin), documentada como límite conocido en
  `PHASE_2_SLICE_1_DESIGN.md` §2.6. La opción B (anclaje real vía `el.pinInfo`) queda
  como mejora futura, con el volcado de `docs/wokwi-pinout-dump.md` ya disponible.
- **Instaladores**: `install/install.sh`/`install/install.ps1` NO copian
  `opencode/nucleo/` ni las piezas nuevas (`opencode/servidor/`,
  `opencode/vista-fisica/`) a `~/.config/opencode/` — el slice se demuestra desde el
  repo. El método establecido para cambios de instalador exige verificarlos en la VM
  Windows con el `.exe` real (ver `CLAUDE.md`/memoria del proyecto, "Tecnia Bot:
  método VM primero"); queda como tarea siguiente explícita, no se hizo en este
  slice.
- **`.tecnia-vista-fisica/`**: la tool (`opencode/tool/vista-fisica.ts`) guarda sus
  datos en un subdirectorio oculto DENTRO de la carpeta de trabajo activa del
  alumno/docente (`<ctx.directory>/.tecnia-vista-fisica/`), decisión explícita
  registrada en el propio archivo — distinto de `~/.config/opencode/` (datos de
  máquina/persona) y del archivo del motor suelto en la raíz visible del proyecto.
- **La tool no aplica operaciones**: `opencode/tool/vista-fisica.ts` sólo obtiene el
  servicio, levanta el servidor si hace falta y abre el navegador — el flujo de
  edición completo (cambiar el GPIO) pasa siempre por el navegador vía
  `POST /api/operaciones`, nunca por la tool misma.
- **Reuso de PID** (candado de H5): límite real pero de probabilidad muy baja,
  documentado explícitamente por el propio fix (`b53cb07`) y confirmado sin cambios
  por P2-REG — no se cierra en este slice.
- **`WINDOWS_UNVERIFIED` y `NODE24`**: heredados de Phase 0/1, sin resolver en este
  slice. Ningún ataque ni verificación de esta ronda corrió en Windows real ni con
  Node 24 (no disponible en este entorno).

## E. Incidentes de proceso

Sin minimizar — registrados tal como ocurrieron:

1. **W2 escribió la implementación antes que el test** (vista física pura, commit
   `9c7f8de`): el RED se capturó DESPUÉS, moviendo el módulo fuera del árbol y
   confirmando `ERR_MODULE_NOT_FOUND`, en vez de escribir el test primero contra un
   módulo inexistente. Documentado por el propio writer en el mensaje del commit y en
   la entrada de progreso de la feature ("Desvíos declarados por W2").
2. **W2 movió archivos a la raíz de `/tmp` de forma transitoria** durante ese mismo
   mecanismo de captura de RED, restaurados en el mismo comando — también declarado
   por el propio writer, en vez de descubierto después.
3. **W4 dejó archivos sueltos en `/tmp` y los borró** durante su verificación —
   incidente menor de higiene de scratchpad, sin impacto en el worktree real.
4. **La extensión de Chrome no estaba conectada** en la sesión donde el orquestador
   corrió la demo real (P2-T12): se usó Chromium headless real por Chrome DevTools
   Protocol (`scratchpad/phase2/demo/cdp-demo.mjs`) en su lugar, no la extensión.
5. **El propio orquestador cometió un error de entorno**: un `TMPDIR` largo (el de
   este scratchpad de sesión) rompe los sockets de Chromium — el driver de la demo
   tuvo que correrse sin heredar ese `TMPDIR`. Documentado explícitamente en la
   entrada de progreso de la feature y en §D.2 de este informe.
6. **El defecto de `index.html` sin el bundle Wokwi lo detectó el ORQUESTADOR, no un
   test**: los tests de `pintar.js`/`plan-de-pintado.js` (con un `document` fake)
   nunca ejecutan `customElements` reales, así que no podían ver que
   `<wokwi-esp32-devkit-v1>`/`<wokwi-led>` quedaban indefinidos por falta de
   `<script src="/assets/wokwi-bundle.js">` en `index.html`. Sólo la demo real en
   Chromium (con custom elements de verdad) lo mostró. El fix (`95794ae`) agregó
   también un test de CONTRATO en `phase2-transporte-http.test.mjs` que exige que
   `GET /` referencie un asset que defina esos custom elements, sin hardcodear el
   nombre del bundle.
7. **P2-REG atribuyó por error la decisión de H4 a un "humano" explícito** ("por
   decisión humana explícita y ya documentada", `REG/INFORME.md`, veredicto final).
   Esa atribución es incorrecta: quien tomó y documentó la decisión de no perseguir
   H4 con más regex fue el ORQUESTADOR de la sesión, no un humano — el humano todavía
   no la confirmó. El orquestador corrige esa atribución en este documento (§D.6) y
   en `DECISIONS.md`.

## F. Definition of Done (prompt humano §51)

El texto literal del prompt humano que originó Phase 2 Slice 1 (numerado hasta §51 en
esa conversación) no está persistido en ningún archivo de este repo ni del scratchpad
de esta sesión — es una instrucción directa al orquestador, distinta del brief
congelado `BRIEF_MAESTRO_..._v5_FINAL.md` (que sólo llega hasta su sección 41 y no
contiene esa numeración). Esta sección no cita ese texto porque no hay una fuente
verificable de él; en su lugar, mapea cada criterio de aceptación conocido —el que
la propia feature document (`odd/tasks/programacion-intencion-phase2-slice1.md`)
registró como el checklist vigente de Phase 2 Slice 1— contra su evidencia concreta.

| Criterio | Evidencia |
|---|---|
| M — Merge controlado de Phase 1 | §A. Fast-forward `0fa7298→8b43c59`, 983/983 pre/post, `.gestor/` intacto, sin push. |
| D — Diseño (ARCH-A..D, sin adjudicador) | §B. `PHASE_2_SLICE_1_DESIGN.md` (commit `8473f45`). |
| P2-T1 — E3-04b + composition root (test-first) | §C.1. `composicion-raiz.ts`, 4 guardias, `DECISIONS.md` "E3-04b: CERRADO". |
| P2-T2 — Snapshot autoritativo (lectura) | §C.2. `tests/phase2-snapshot.test.mjs`. |
| P2-T3 — Envío de operaciones con `baseRevision` | §C.4. `POST /api/operaciones`, `tests/phase2-transporte-http.test.mjs`. |
| P2-T4 — Notificación de cambio de revisión | §C.4. SSE `revision`, `tests/phase2-motor-gpio.test.mjs` (una notificación exacta). |
| P2-T5 — Adaptador IR → vista física | §C.3. `opencode/vista-fisica/snapshot-a-vista.ts`. |
| P2-T6 — Render de ESP32 + LED | §C.3/§C.5. `wokwi-render-datos.ts`, `plan-de-pintado.js`, bundle Wokwi cargado (`95794ae`). |
| P2-T7 — Edición de GPIO | §C.4. `AsignarPin` vía `<select>`, `app.js`. |
| P2-T8 — Recarga/persistencia | `tests/phase2-reload.test.mjs`, demo real (§D.2, reinicio de proceso). |
| P2-T9 — Conflicto stale (UX mínima) | `tests/phase2-conflicto.test.mjs`, RED-B ataque A3 (`<select>` termina en el valor canónico). |
| P2-T10 — Path A/B en la UI | `tests/phase2-vista-fisica.test.mjs` (Path A), `tests/phase2-paths.test.mjs` (Path A/B), RED-B ataques A4/A5. |
| P2-T11 — Tests de integración | `tests/phase2-e2e.test.mjs`. |
| P2-T12 — Demo manual | §D.2, dos corridas reales (HEAD `c910a3b` y HEAD `4348c30`). |
| P2-T13 — Docs + red team + fix loop + freeze | Este documento, `PHASE_2_SLICE_1_TEST_PLAN.md`, `TARGET-ARCHITECTURE.md`, `DECISIONS.md`, y los 5 documentos fuera del repo (`~/tecnia-bot-docs/phase2-slice1/`). |
| 983 tests de Phase 1 intactos | §D.1. `git diff --name-only 8b43c59..HEAD -- 'tests/nucleo-*.test.mjs'` vacío. |
| Ronda única de regresión (no un red-team completo nuevo) | §D.5. P2-REG, un solo informe, sin CRITICAL/MAJOR nuevo. |
| Ningún CRITICAL abierto al cierre | §D.5. Veredicto final de P2-REG: "¿Queda algún CRITICAL abierto? NO." |
| Un MAJOR abierto, documentado y no relajado | §D.6. H4 — decisión del orquestador, pendiente de confirmación humana. |
