# Phase 2 Slice 1 — gate de Windows real

Detalle del gate de Windows real (D16/D17,
`PHASE_2_SLICE_1_HARDENING_DESIGN.md` §5) citado desde
`PHASE_2_SLICE_1_HARDENING_REPORT.md` §6. Fuente principal:
`scratchpad/hardening/windows/RESUMEN-LOCK-Y-SUITE.md` y sus artefactos, más
`scratchpad/hardening/RED-WINDOWS/INFORME.md` y
`scratchpad/hardening/RED-WINDOWS-R2/INFORME.md`. Rutas de evidencia citadas relativas a
`scratchpad/hardening/`.

## 1. Entorno

| | |
|---|---|
| OS | Windows 10 Pro 10.0.19045 (22H2) x64, sesión de consola 1 |
| PowerShell | 5.1.19041.6456 |
| Node | v24.20.0 (scoop `nodejs-lts`) — el runtime real que fija el instalador, sin actualizar a 26 (D16) |
| OpenCode | 1.18.18 |
| bun | 1.3.14 (embebido en OpenCode; `BUN_BE_BUN=1 opencode.exe` para invocarlo directo) |
| Usuario | `win-vm` (estándar, sin admin) |
| Producto instalado antes del gate | Tecnia Bot 0.4.2 (sin Inno Setup) |

Código auditado en la VM: `git archive` sobre el HEAD correspondiente a cada corrida (ver
§4), en `C:\Users\win-vm\tb gate ñandú\repo` / `...\build ca16ce1` (ruta con espacio y
Unicode deliberados).

## 2. Método

Puente `virsh qemu-agent-command` + `schtasks /ru win-vm /it`
(`scratchpad/hardening/windows/vm.py`, push/pull/`sys`/`user`), sin simular ningún
resultado: cada comando corre de verdad dentro del guest y su salida se trae al host.
ISCC (Inno Setup) corre dentro de la VM, no en el host. Ningún paso de este gate fue
inferido ni reconstruido a partir de otra evidencia — RED-WINDOWS y RED-WINDOWS-R2
verificaron esto de forma independiente, incluyendo dos casos donde faltó o se perdió el
artefacto de respaldo de una corrida real (H-W2, H-W4, ver §5).

## 3. Qué se hizo con la VM

- Arrancada **tal como estaba** (D16, WIN=A): no se restauró `base-limpia` ni se destruyó
  estado existente sin una nueva autorización.
- Respaldo previo tomado dentro del guest antes de instalar:
  `C:\Users\win-vm\tb-respaldo-previo-0.4.2` (copia maestra 220 archivos, config 208
  archivos, `hkcu-uninstall.reg`).
- Snapshot en caliente **no soportado** por esta VM (backend `pflash`, requeriría nvram
  QCOW2) — no se intentó.
- `base-limpia` **no se tocó** durante todo el gate.
- Inno Setup 6.7.3 se agregó a la VM vía `scoop extras`, en scope de usuario (sin admin).

## 4. Resultados

### WIN-LOCK (`lock-matriz.json`, `cross-run.txt`, `lock83-run.txt`)
WIN-LOCK-01 (carrera de 2 procesos), 02 (dueño vivo, mismo usuario), 02b (dueño vivo de
OTRO usuario/SYSTEM → `process.kill(pid,0)` da EPERM → tratado como vivo → rechazado),
03 (`taskkill /F` del dueño → lock huérfano recuperado), 04 (cierre limpio), 05 (alias:
mayúsculas/minúsculas, `/`, separador final, `..`, junction `mklink /J`, y 8.3
`TBGATE~1\LOCK05~1`), 06/07 (espacios + Unicode bajo `tb gate ñandú\lock NN ñ`): **todos
PASS**. NOTE cosmético: el mensaje de rechazo muestra la ruta tal como la pasó el
llamador (alias), no la canónica.

### Almacén con fs real en NTFS (`almacen-real.json`)
**9/9 PASS**: guardar, temporal en el mismo directorio, sin `.tmp` huérfano, round-trip
canónico, rename sobre un archivo existente, JSON corrupto → `DOCUMENTO_MALFORMADO`, id
distinto → `ID_DOCUMENTO_NO_COINCIDE`, E3-07 fail-closed, inexistente →
`PROYECTO_INEXISTENTE`.

### Suite
- **Sin shim**: 633 tests, 342 fail. Causa: todos los tests importan con
  `await import(join(REPO, ...))`, que en `win32` produce un specifier `C:\...\` y Node
  lo rechaza con `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Ver §6 (hallazgo de portabilidad del
  harness).
- **Con el shim `shim-win-abs.mjs`** (harness, fuera del repo, por `NODE_OPTIONS` para
  que lo hereden los procesos hijo): primera corrida sobre `44664a5` — 1093 tests, 1067
  pass, 20 fail, 6 skip (clasificación completa en §6). Esa corrida es **anterior a todo
  el diff del gate** (H-W1, remediada).
- **Re-corrida sobre el HEAD real `ca16ce1`** (`suite-node24-win-ca16ce1.tap`, remediación
  H-W1): 1108 tests, 1081 pass, 20 fail (las mismas 20 ya clasificadas como harness o
  ambientales), 7 skip. `tests/phase2-hardening-pines.test.mjs` corrió completo, **14/14
  pass** (matriz de severidad D1/D2/D3/D7, D5 en GPIO34/35/36/39 y GPIO4, D9, D10, D11,
  D8, convergencia de los 4 caminos). El cambio D9 en `phase2-wokwi-pinout.test.mjs`
  también pasó. `tests/empaquetado-instalado.test.mjs` hace SKIP explícito en `win32`
  por diseño (usa Bash); la cobertura Windows de `install.ps1` vive en el job `windows`
  real de `.github/workflows/ci.yml` (PowerShell 5.1, `windows-latest`) — confirmado que
  ese job existe y corre `install.ps1`/`uninstall.ps1` de punta a punta, sin verificar
  su resultado para `ca16ce1` específicamente.

### Instalador real y producto instalado (HEAD `ca16ce1`)
Inno Setup 6.7.3, `ISCC /DMyAppVersion=0.4.2` desde `C:\Users\win-vm\tb gate ñandú\build
ca16ce1` → `Instalar-Tecnia-Bot.exe` (4 431 941 B, sha256
`D32BAFE0…4865CD`). Upgrade in-place sobre 0.4.2: `/VERYSILENT /SUPPRESSMSGBOXES
/NORESTART` → exit 0. Resultado: `nucleo`, `servidor`, `vista-fisica` (+`web/`),
`tool/vista-fisica.ts` y `wokwi-bundle.js` presentes en la copia maestra y en
`.config\opencode`; `vista-fisica: "allow"`; perfil y memoria preservados; Node y
OpenCode sin cambios.

### Tool instalado bajo bun (runtime real del producto)
`BUN_BE_BUN=1 opencode.exe` invocando `execute()` como lo hace OpenCode: devuelve "Vista
física abierta en el navegador: http://127.0.0.1:…"; `cmd /c start` abrió **Brave** (el
navegador por defecto de `win-vm`), ventana "Tecnia Bot - vista física"; GET `/` y el
bundle dan 200; Edge headless por CDP: ESP32+LED visibles, `<select>` GPIO4→GPIO16,
revisión 4→5, recarga OK, `"anodo":"GPIO16"` en disco, consola `[]`; `taskkill /F /T` →
lock huérfano → el reinicio (bajo bun) lo recupera con revisión 5 y GPIO16, consola `[]`.

### SSE
`GET /api/eventos` → 200 `text/event-stream`; suscripción abierta antes del `POST
AsignarPin` (toggle GPIO18↔GPIO19); revisión 5→6; llega el evento `revision:{revision:6}`
por el stream real (conexión `http.get` cruda, sin caché HTTP de por medio) —
verificado independientemente en RED-WINDOWS-R2 (A4) que no es una respuesta cacheada:
el número coincide exactamente con `snap.revision+1`, algo sólo posible con una
escritura y push reales entre la suscripción y el evento.

## 5. Remediación de evidencia (H-W1..H-W5)

RED-WINDOWS encontró 3 MAJOR + 2 MINOR, todos de **evidencia** (ninguno del producto).
Se remediaron re-corriendo y demostrando, sin cambiar código, y RED-WINDOWS-R2 (revisor
nuevo) cerró los cinco de forma independiente:

- **H-W1 (MAJOR, CERRADO)**: la "suite completa" original corrió sobre `44664a5`, el
  primer commit después de `b0b97d7` y **anterior a todo el diff del gate** — 0 tests de
  `phase2-hardening-pines`/`empaquetado-instalado` ejecutados en Windows. Remediación:
  re-corrida completa sobre `ca16ce1` (§4, "Suite"). R2/A1 confirmó que las 14 pruebas de
  `phase2-hardening-pines` y el cambio D9 corren y pasan, y que las 20 fallas restantes
  mapean exactamente a los mismos 9 archivos ya clasificados, ninguno tocado por el diff
  del gate.
- **H-W2 (MAJOR, CERRADO)**: el claim original de que "Creating directory …\opencode"
  demostraba el borrado previo por `[InstallDelete]` no tenía respaldo directo — el log
  de Inno (1402 líneas) no registra ninguna línea de borrado del árbol `opencode`.
  Remediación: experimento directo con marcadores
  (`{app}\opencode\ZZ-marcador-installdelete.txt`, una carpeta vieja
  `{app}\opencode\tool\zz-carpeta-vieja\`, y `.config\opencode\ZZ-marcador-usuario.txt`)
  antes de reinstalar. Resultado: el marcador y la carpeta vieja de `{app}\opencode`
  desaparecieron; el marcador del usuario sobrevivió; perfil y memoria idénticos
  (`08-installdelete.txt`). R2/A2 descartó explicaciones alternativas leyendo
  `bootstrap.ps1`/`install.ps1` completos: ningún otro `Remove-Item` toca
  `{app}\opencode`; el único mecanismo capaz de borrarlo antes de instalar es
  `[InstallDelete]`.
- **H-W3 (MAJOR, CERRADO)**: la lista "NO corrido" del RESUMEN original era honesta pero
  incompleta — dejaba 6 ítems/sub-casos de la matriz sin declarar ni como cubiertos ni
  como pendientes. Remediación: la matriz WIN-01..18 (§7) ahora declara cada hueco
  explícitamente como "PASS parcial" con el sub-caso faltante nombrado. R2/A3 confirmó
  que los 6 aparecen y que cada PASS restante tiene artefacto real de respaldo, con una
  única nota de rotulado (R2-N1, no un hallazgo nuevo): WIN-06/WIN-13 quedan "PASS" liso
  pese a mencionar el mismo tipo de hueco ("estrés con antivirus NO probado") que las
  filas parciales.
- **H-W4 (MINOR, CERRADO)**: el claim "GET / y el bundle dan 200" no tenía artefacto
  persistido — `06-funcional.txt` pesaba 0 bytes porque `vm.py::user()` reusaba siempre
  el mismo archivo remoto/local en cada invocación, pisando la salida real de
  `funcional.ps1` con la de la última invocación (`brave.ps1`). Remediación: `vm.py`
  genera un sufijo único por invocación (`uuid`), y los scripts de esta ronda
  (`installdelete.src.ps1`, `sse.src.ps1`) escriben además a un nombre remoto propio
  (`08-installdelete.txt` con GET/assets/`/api/proyecto` 200 y traversal 404;
  `09-sse.txt`). R2/A5 confirmó el fix en el código y en el filesystem de evidencia
  (varios `_run.cmd.*.out` con contenido propio coexistiendo).
- **H-W5 (MINOR, preexistente, CERRADO)**: el criterio `pass` de `lock-matriz.mjs`
  contaba cualquier `abrio:false` como éxito sin distinguir la causa — el sub-caso 8.3
  `corto83` fallaba por una ruta malformada (`ENOENT`) y aun así contaba como PASS.
  Remediación: ese sub-caso se excluyó explícitamente de la evidencia; el caso 8.3 real
  se re-verificó de forma independiente en `lock83-run.txt` (`TBGATE~1\LOCK05~1`
  resuelto vía `realpathSync.native`, B rechazado con `code:null`). El bug del script de
  harness no se corrigió (no reabre el contrato del gate).

## 6. Hallazgo de portabilidad del harness

Todos los tests del repo importan con `await import(join(REPO, ...))`. `join()` en
`win32` produce un specifier con unidad de disco (`C:\...`), que Node rechaza con
`ERR_UNSUPPORTED_ESM_URL_SCHEME` — 342 fallas de archivo completo sin el shim. Es un
problema del **harness** (Phase 1, congelado), no del producto: confirmado por
RED-WINDOWS (A3) leyendo el código de producción real
(`opencode/tool/vista-fisica.ts:115`, `import("../servidor/servicio-con-vista.ts")`;
`opencode/servidor/servidor-proyecto.ts:27`, `dirname(fileURLToPath(import.meta.url))`),
que usa siempre specifiers relativos o `fileURLToPath(import.meta.url)` — ambos
win32-seguros y sin necesidad del shim. El shim `shim-win-abs.mjs` sólo intercepta
specifiers `^[a-zA-Z]:[\\/]`, exactamente el patrón que generan los tests, nunca el
código de producción (verificado, A3: NO CONFIRMADO / negativo — el shim no enmascara
nada del producto). Con el shim, las 20 fallas restantes se agrupan en:

- `nucleo-almacen` (6) + `nucleo-adversarial` #10 (1): el fs falso del test usa claves
  POSIX (`/dir/x.json`) contra `path.join` nativo en `almacen.ts:69` — artefacto del
  harness; las mismas propiedades con fs real dan 9/9 PASS (§4).
- `phase2-candado-proceso` H5-tool (1) + `phase2-e2e` (1, archivo completo): falta
  `@opencode-ai/plugin` (la VM no tiene el `node_modules` del repo) — ambiental; el
  camino de la tool instalada se prueba en el gate del instalador.
- `phase2-directorio-canonico` H1(a) (1): `symlink` da `EPERM` sin admin/modo
  desarrollador — ambiental; el alias por junction está cubierto en WIN-LOCK-05.
- Legado, fuera del slice: `biblioteca-visual` (2, sin `.git` en la VM),
  `platformio-execute` (2) + `platformio-pio` (5, sin `pio.exe` real en el PATH del
  entorno de test), `ps1-variables` (1: `new URL(...).pathname` no es una ruta de
  Windows, test legado no tocado por el diff del gate).

Sin shim, la primera corrida se colgó en `phase2-candado-proceso` porque el hijo no
heredaba el shim (pasado sólo por `--import`) y el padre esperaba "LISTO" para siempre —
corregido pasándolo por `NODE_OPTIONS`, artefacto del harness.

## 7. Matriz WIN-01..18: estado real

| Ítem | Estado | Evidencia / qué falta |
|---|---|---|
| WIN-01 instalación limpia | **NO CORRIDO** | Sólo upgrade in-place sobre 0.4.2 (x2). Clean install desde `base-limpia` requiere una NUEVA autorización |
| WIN-02 espacios | PASS | suite, lock y almacén bajo `tb gate ñandú`; compilación ISCC desde una ruta con espacios |
| WIN-03 Unicode | PASS parcial | ñ/ú en todas las rutas; NFC vs NFD NO probado |
| WIN-04 canonicalización | PASS | mayúsculas, minúsculas, `/`, separador final, `..` (`lock-matriz`) |
| WIN-05 8.3 / junction | PASS | `lock83-run.txt`, `lock-matriz` (junction) |
| WIN-06 candado `wx` NTFS | PASS | WIN-LOCK-01/02; estrés con antivirus NO probado (rotulado "PASS" liso, ver R2-N1) |
| WIN-07 dueño muerto / vivo | PASS | `taskkill /F`, cross-user SYSTEM → EPERM → vivo |
| WIN-08 reinicio | PASS parcial | reinicio del PROCESO (`taskkill /F /T`) + recuperación; reinicio del SO NO probado |
| WIN-09 loopback + firewall | PASS parcial | loopback 127.0.0.1 funciona; prompt del firewall en instalación limpia NO observado/probado |
| WIN-10 abrir navegador | PASS | `execute` → `cmd /c start` → Brave, ventana "Tecnia Bot - vista física" |
| WIN-11 SSE | PASS parcial | evento `revision` (`09-sse.txt`); inactividad larga / reconexión NO probada |
| WIN-12 edición de GPIO | PASS parcial | Edge CDP GPIO4→16, rev 4→5, recarga; sub-caso `localhost`/IPv6 NO probado |
| WIN-13 persistencia NTFS | PASS | almacén real 9/9, rename sobre archivo existente; estrés con antivirus NO probado (rotulado "PASS" liso, ver R2-N1) |
| WIN-14 offline | PASS parcial | sin refs remotas + consola `[]`; red del guest cortada / proxy escolar NO probado |
| WIN-15 consola limpia | PASS parcial | consola del navegador `[]`; consola/terminal de OpenCode (mojibake) NO probada |
| WIN-16 desinstalar/reinstalar | PASS parcial | reinstalación encima x2 OK; desinstalación NO corrida (destruiría la instalación existente) |
| WIN-17 Node 24 / Bun | PASS | Node v24.20.0 (suite), bun 1.3.14 embebido en OpenCode 1.18.18 (tool instalado) |
| WIN-18 MAX_PATH | **NO CORRIDO** | — |

WIN-06 y WIN-13 quedan rotuladas "PASS" (no "PASS parcial") pese a mencionar el mismo
tipo de hueco ("estrés con antivirus NO probado") que las filas parciales —
inconsistencia de rotulado señalada por RED-WINDOWS-R2 (R2-N1), no de honestidad: el
hueco está igual de visible en el texto de cada fila.

## 8. Veredicto

**WINDOWS_GATE = PASS_WITH_DOCUMENTED_GAPS.**

Justificación (RED-WINDOWS-R2): los 5 hallazgos MAJOR/MINOR de evidencia están
remediados con evidencia ejecutable directa, verificada de forma independiente en la
ronda 2 (incluida la búsqueda activa de explicaciones alternativas para H-W2, sin
encontrar ninguna). El núcleo del contrato del gate (D1-D11 vía Engine/POST/snapshot/
recarga, D9, D14) sí corrió en Windows real sobre el HEAD correcto con resultado verde y
evidencia primaria. No es `PASS` liso porque 14 de los 18 ítems de la matriz tienen al
menos un sub-caso sin cerrar, declarados honestamente como "PASS parcial" o "NO
CORRIDO" (§7). No es `UNVERIFIED` porque esos huecos son de evidencia, no de criterio de
producto.

## 9. Pendiente con autorización humana

- **WIN-01, clean install desde `base-limpia`**: destruiría el estado actual del guest;
  requiere una nueva autorización explícita (D16, §13 del diseño).
- **WIN-16, desinstalación**: destruiría la instalación existente en la VM; requiere una
  nueva autorización explícita antes de correrla.
