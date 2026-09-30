# Phase 2 Slice 1 — reporte del gate final de hardening

Reporte de cierre del gate de hardening final (packaging, GPIO, Windows) descrito en
`PHASE_2_SLICE_1_HARDENING_DESIGN.md`. Complementa ese diseño y
`PHASE_2_SLICE_1_INSTALL_CONTRACT.md`; no repite su contenido, sólo lo referencia y
reporta el resultado del gate contra él. Detalle de Windows en
`PHASE_2_SLICE_1_WINDOWS_REPORT.md`.

## 1. Identidad

| | |
|---|---|
| Base del gate | `b0b97d7` (`feature/programacion-intencion-phase2`) |
| HEAD final | `ca16ce1` |
| Phase 1 / `main` | `8b43c59` |
| Freeze anterior (checksum sha256) | `130298ec81bb6b8cdf56fb9aede6e97d8c021d516291197ccc960ae305f458ce` (`TECNIA_BOT_PHASE_2_SLICE_1_FREEZE.zip`) |

Fuente: `scratchpad/hardening/preflight/identidad.txt`. Ese mismo preflight registró la
baseline previa al gate: 1100/1100 tests, typecheck 0, `fichas:check` 0.

## 2. Decisiones humanas

Las 17 decisiones normativas del gate (D1–D17) están congeladas en
`PHASE_2_SLICE_1_HARDENING_DESIGN.md` §1 (tabla de decisiones), tomadas por el HUMAN
PRODUCT OWNER el 2026-09-29 a partir de los cuatro informes ARCH read-only
(ARCH-PINS, ARCH-INSTALL, ARCH-WIN, ARCH-GATE). Este reporte no las reinterpreta;
sólo documenta su resultado.

## 3. Commits del gate

`git log --oneline b0b97d7..ca16ce1` (9 commits):

| Commit | Propósito |
|---|---|
| `44664a5` | docs: congela `PHASE_2_SLICE_1_HARDENING_DESIGN.md` (D1–D17) y registra la resolución de H4 |
| `9016b47` | feat(nucleo): gate de pines (D1–D11) — `evaluarRestriccionesPin`: flash (D1), strapping por pin (D2/D3), sin pull-up interno por dato de terminal (D5), uartUsb (D7), quita GPIO37/38 de `ESP32_GPIO_VALIDOS` (D9), `PIN_INEXISTENTE_EN_DOCUMENTO` (D10) |
| `84f1f7c` | docs: actualiza COMPONENT-CATALOG/OPERATIONS/IR-SPEC/DECISIONS con los códigos y el dato `requierePullUpInterno` nuevos |
| `c424ea3` | test(install): `tests/empaquetado-instalado{.test.mjs,-hijo.mjs}` en RED, escritos antes de tocar los instaladores (D12–D13) |
| `7786831` | feat(install): `install.sh`/`install.ps1` copian `nucleo`/`servidor`/`vista-fisica` como hermanas de `tool/`; se suman al manifiesto y a la limpieza de `uninstall.*` (D12) |
| `1f3d42c` | fix(test): corrige el offset de argv del proceso hijo del test de packaging |
| `02bc088` | feat(vista-fisica): `tool/vista-fisica.ts` carga `../servidor/*` con `await import()` dentro de `cargarServidor()`, nunca en el nivel superior del archivo (D13) |
| `8eb6144` | fix(vista-fisica): el mensaje de `servidor/` ausente sugiere explícitamente reinstalar |
| `ca16ce1` | feat(installer): `[InstallDelete] Type: filesandordirs; Name: "{app}\opencode"` en `tecnia-bot.iss` + `docs/rollback.md` (D14) |

`git diff --stat b0b97d7..ca16ce1`: 23 archivos, +1573/-19. Toca
`opencode/nucleo/{catalogo-datos,catalogo,placas,validar-tecnico}.ts`,
`opencode/tool/vista-fisica.ts`, `install/install.{sh,ps1}`, `install/uninstall.{sh,ps1}`,
`installer/tecnia-bot.iss`, `docs/rollback.md`, los docs semánticos, y agrega/actualiza
`tests/phase2-hardening-pines.test.mjs`, `tests/empaquetado-instalado{.test.mjs,-hijo.mjs}`
y `tests/phase2-wokwi-pinout.test.mjs`. `opencode/tool/circuito.ts`, `opencode/tool/platformio.ts`
y `pinouts.json` no aparecen en el diff (D9 documenta la divergencia con `circuito.ts` como
aceptada, ver §8).

## 4. Contrato de GPIO final (W-PINS, D1–D11)

Función pura en el núcleo (`catalogo.ts::evaluarRestriccionesPin`), llamada desde el bucle
de terminales de `validar-tecnico.ts`. Nunca dispara por `if GPIO<n>`: deriva de
`pin.restricciones` (dato de `placas.ts`) y `terminal.requierePullUpInterno` (dato de
`catalogo-datos.ts`). Verificado por lectura y por 10 ataques del red team
(`RED-AUTHORITY`, ver §7).

| Pin / condición | Motivo | Severidad | Clasificación | Decisión |
|---|---|---|---|---|
| GPIO6–11 (flash) | `PIN_FLASH_RESERVADO` | blocking | representable | D1 |
| GPIO12 (strapping) | `PIN_STRAPPING` | warning | representable | D2 |
| GPIO0, GPIO15 (strapping) | `PIN_STRAPPING` | info | representable | D2 |
| GPIO2 (strapping) | `PIN_STRAPPING` | info | representable | D3 (sigue `listo:true`, sigue en el pool automático) |
| GPIO5 | sin motivo | — | — | D4, sin regresión |
| GPIO1, GPIO3 (uartUsb) | `PIN_UART_USB` | warning | representable | D7 |
| Terminal con `requierePullUpInterno:true` (ej. `pulsador.senal`) asignado a un pin `soloEntrada` (GPIO34/35/36/39) | `PIN_SIN_PULLUP_INTERNO` | blocking | representable | D5 |
| GPIO34 con terminal analógico (`ntc.senal`, sin `requierePullUpInterno`) | sin motivo | — | — | D5 (la regla no nombra el pin) |
| GPIO37/38 (asignación) | quitados de `ESP32_GPIO_VALIDOS`; produce el rechazo ya existente `PIN_INEXISTENTE_EN_PLACA` | — | rechazo (preexistente) | D9 |
| Pin ausente en `pinesDePlaca` de la placa actual, cargado por cualquier camino (operación o documento en disco, ej. un histórico con GPIO37) | `PIN_INEXISTENTE_EN_DOCUMENTO` | blocking | representable | D10 |

D11: ninguna regla nueva del validador emite `rechazo`; las cinco son siempre
`representable` — PERSISTIBLE ⇒ RECARGABLE, confirmado con fixtures que cargan proyectos
persistidos con GPIO6/1/12/37. No se duplica `CAPACIDAD_PIN_INCOMPATIBLE` (un LED en
GPIO34 sigue dando sólo ese motivo). El Engine directo, POST `/api/operaciones`, el
snapshot/tool y la recarga desde disco dan el mismo diagnóstico por construcción.

Verificación independiente del orquestador (sonda sobre el LED,
`scratchpad/hardening/pingate/sonda.out`): la matriz coincide exactamente con la tabla de
arriba; el documento con GPIO37 recarga con `PIN_INEXISTENTE_EN_DOCUMENTO`/blocking;
reasignar a GPIO16 limpia el motivo y sube la revisión (rev 5). PIN_GATE = **PASS**
(`odd/tasks/programacion-intencion-phase2-hardening.md`, T4).

## 5. Packaging (D12–D14) y gate de instalación aislada

Contrato completo en `PHASE_2_SLICE_1_INSTALL_CONTRACT.md`. Resumen:

- **D12**: `install.sh`/`install.ps1` publican `opencode/nucleo`, `opencode/servidor` y
  `opencode/vista-fisica` (con `web/`) a `$CONFIG_DIR`, como carpetas hermanas de `tool/`
  — nunca adentro, porque el registry de tools levanta cualquier `.ts`/`.js` del nivel
  superior de `tool/`. Se suman al manifiesto y a la limpieza de `uninstall.*`.
- **D13**: `tool/vista-fisica.ts` carga `../servidor/*` con `await import()` dentro de
  `cargarServidor()`, nunca en el nivel superior del módulo, para que un `import()` que
  falla no tire abajo el registry entero — sólo esta tool falla, con un mensaje que nombra
  la pieza ausente y sugiere reinstalar.
- **D14**: `[InstallDelete] Type: filesandordirs; Name: "{app}\opencode"` en
  `tecnia-bot.iss` + `docs/rollback.md`. Cada instalación deja `{app}\opencode` como una
  foto exacta del `.exe` corrido; cierra el escenario de rollback por overlay. Límite
  documentado: sólo protege instalaciones hechas con un `.exe` que ya trae esta línea; un
  downgrade a un `.exe` anterior requiere desinstalar primero.

**Gate de instalación aislada** (`PHASE_2_SLICE_1_HARDENING_DESIGN.md` §4), verificado de
forma independiente por el orquestador
(`scratchpad/hardening/instgate/gate.log`, HEAD `ca16ce1`): `install.sh` real, `$HOME`
con espacio y `ñ`, fuente `git archive` con `chmod 000` tras instalar, todo desde otro
cwd. Presencia de `nucleo`/`servidor`/`vista-fisica`/`tool/vista-fisica.ts`/
`tecniabot-web`/assets Wokwi y el permiso `vista-fisica: "allow"`; las carpetas nuevas
sólo traen `.ts`/`.js`/`.html` (allowlist); scan offline limpio (`[]` por asset servido);
Chromium real por CDP: ESP32+LED visibles, cambio GPIO4→GPIO16 por `<select>`, revisión
4→5, recarga OK, `"anodo":"GPIO16"` persistido en disco; `kill -9` deja el lock huérfano
y el reinicio del proceso lo recupera con revisión 5 y GPIO16; consola del navegador
`[]`; 0 módulos de `opencode/` resueltos fuera de la instalación (97 módulos totales, 24
desde la instalación). PACKAGING_GATE = **PASS**
(`odd/tasks/programacion-intencion-phase2-hardening.md`, T5).

## 6. Windows

Gate completo en `PHASE_2_SLICE_1_WINDOWS_REPORT.md`. Resumen: VM win10 real (22H2,
Node v24.20.0, OpenCode 1.18.18, bun 1.3.14), WIN-LOCK-01..07 + cross-user + alias 8.3
todo PASS, almacén real 9/9 PASS, instalador `.exe` compilado en la VM con Inno Setup
6.7.3 y probado con upgrade in-place sobre 0.4.2 (`[InstallDelete]` demostrado con
marcadores), tool instalado ejercitado bajo el runtime real del producto (bun) con
edición de GPIO por CDP y SSE verificados. **WINDOWS_GATE = PASS_WITH_DOCUMENTED_GAPS**
(ver ese documento para la matriz WIN-01..18 completa y los huecos declarados).

## 7. Tests

| | tests | pass | fail |
|---|---|---|---|
| Baseline preflight (antes del gate) | 1100 | 1100 | 0 |
| T4 (W-PINS) | 1114 | 1114 | 0 |
| T5 (W-INSTALL) / HEAD `ca16ce1` | 1115 | 1115 | 0 |
| Verificación final de este documento | 1115 | 1115 | 0 |

`git diff 8b43c59..ca16ce1 --stat -- 'tests/nucleo-*'` está vacío: los tests de Phase 1
quedan sin diff en todo el gate.

## 8. Red team

Orden del proceso (`PHASE_2_SLICE_1_HARDENING_DESIGN.md` §6): RED-PACKAGE ≥8 ataques,
RED-AUTHORITY ≥8, RED-WINDOWS, como máximo una ronda de fixes, una regresión focal.

### RED-AUTHORITY (`scratchpad/hardening/RED-AUTHORITY/INFORME.md`)
10 ataques nuevos contra el Engine real, el servidor HTTP y la recarga desde disco.
**10/10 pass, sin CRITICAL ni MAJOR.** 3 NOTE preexistentes, ninguno reabre el contrato
(ver §9, backlog).

### RED-PACKAGE (`scratchpad/hardening/RED-PACKAGE/INFORME.md`)
8 ataques (`$HOME` hostil, D13 con `nucleo/` borrado, D13 con un solo archivo de
`vista-fisica/` borrado, copia interrumpida y su self-heal, `uninstall.sh` con datos
reales de usuario, lectura completa de `.iss`+`bootstrap.ps1`, compatibilidad
PowerShell 5.1, symlink de `node_modules`). **Sin CRITICAL ni MAJOR.** 1 hallazgo nuevo:
**H1 (MINOR)** — el titular del mensaje de D13 (`tool/vista-fisica.ts:108-124`,
`cargarServidor`) siempre dice "Falta la carpeta 'servidor'" aunque la pieza realmente
ausente sea `nucleo/` o `vista-fisica/` (el `detalle` sí trae la ruta real). No rompe el
registry ni da un catch vacío; la sugerencia de reinstalar sigue siendo correcta en los
tres casos. No dispara la ronda de fixes (backlog, ver §9).

### RED-WINDOWS (`scratchpad/hardening/RED-WINDOWS/INFORME.md`)
6 ataques sobre la evidencia ya capturada, sin operar la VM. **3 MAJOR + 2 MINOR, los
cinco de EVIDENCIA (ninguno del producto):**
- H-W1 (MAJOR): la "suite completa" corrió sobre `44664a5` (commit sólo-docs, anterior a
  todo el diff del gate) — 0 tests de `phase2-hardening-pines`/`empaquetado-instalado`
  ejecutados en Windows.
- H-W2 (MAJOR): el claim de que `[InstallDelete]` se demostró por el log de Inno no
  tenía respaldo directo en ese log.
- H-W3 (MAJOR): la lista "NO corrido" del RESUMEN, honesta pero incompleta — faltaban 6
  ítems/sub-casos de la matriz sin declarar.
- H-W4 (MINOR): el claim "GET / y el bundle dan 200" sin artefacto persistido
  (`06-funcional.txt` de 0 bytes, pisado por invocaciones posteriores del puente).
- H-W5 (MINOR, preexistente): el criterio `pass` de `lock-matriz.mjs` contaba un
  sub-caso 8.3 roto por ruta malformada como éxito.

Ninguno señaló un defecto del producto; los cinco se remediaron **re-corriendo y
demostrando, sin cambiar código** (detalle en `PHASE_2_SLICE_1_WINDOWS_REPORT.md` §5).

### RED-WINDOWS-R2 (`scratchpad/hardening/RED-WINDOWS-R2/INFORME.md`)
Regresión focal, revisor nuevo, sobre la remediación de H-W1..H-W5. **Los 5 CERRADOS**,
cada uno con verificación independiente (incluida la búsqueda activa de explicaciones
alternativas para H-W2). 1 NOTE cosmético nuevo (R2-N1): las filas WIN-06/WIN-13 quedan
rotuladas "PASS" en vez de "PASS parcial" pese a mencionar el mismo tipo de hueco
("estrés con antivirus NO probado") que las demás filas parciales — inconsistencia de
rotulado, no de honestidad. Veredicto global:
**WINDOWS_GATE = PASS_WITH_DOCUMENTED_GAPS.**

## 9. H4

`PHASE_2_SLICE_1_HARDENING_DESIGN.md` D15: **H4 = ACCEPTED_KNOWN_LIMITATION.**
Severidad original MAJOR, `accepted_by = HUMAN_PRODUCT_OWNER`, no bloquea el slice. Las
guardias léxicas existentes son controles contra bypass ACCIDENTAL, no una frontera de
seguridad; sin AST, sin regex nueva, sin sandbox, sin loader. Se reabre si cambia el
modelo de amenazas o aparece un bypass desde input externo o código no confiable. Los
tests del bypass accidental y la evidencia W5/H4 del bypass ofuscado se conservan sin
reescribir la historia.

## 10. Backlog (no bloquea el slice)

- **MINOR H1 (RED-PACKAGE)**: el titular del mensaje de D13 siempre dice "servidor"
  aunque falte `nucleo/` o `vista-fisica/` (el detalle sí trae la ruta real).
  `opencode/tool/vista-fisica.ts:108-124`.
- **DHT22 sin `requierePullUpInterno`**: dato pendiente en el catálogo
  (`opencode/nucleo/catalogo-datos.ts`, terminal `senal` de `DHT22`), ya señalado como
  backlog explícito por D5.
- **Divergencia `circuito.ts` con GPIO37/38**: `opencode/tool/circuito.ts:332`
  (`GPIO_VALIDOS` legado, todavía incluye 37/38) diverge de
  `opencode/nucleo/placas.ts:126-128` (sin 37/38 desde D9). Documentada y aceptada por
  D9; `circuito.ts` no se toca en este slice.
- **Los tests del repo no son portables a Windows**: todos importan con
  `await import(join(REPO, ...))`, que en `win32` produce un specifier `C:\...` y Node
  lo rechaza con `ERR_UNSUPPORTED_ESM_URL_SCHEME`; además el fs falso de
  `nucleo-almacen.test.mjs` usa claves POSIX (`/dir/x.json`) contra `path.join` nativo, y
  `tests/ps1-variables.test.mjs` usa `new URL(...).pathname` (no es una ruta de
  Windows). Es un problema del harness (Phase 1, congelado), no del producto — el
  código de producción usa siempre specifiers relativos o `fileURLToPath(import.meta.url)`.
- **Ítems WIN no corridos**: WIN-01 (instalación limpia desde `base-limpia`), el
  sub-caso NFC/NFD de WIN-03, WIN-08 (reinicio real del SO), el prompt de firewall en
  instalación limpia de WIN-09, la inactividad larga de WIN-11, el sub-caso
  localhost/IPv6 de WIN-12, la red del guest cortada de WIN-14, la consola/terminal de
  OpenCode (mojibake) de WIN-15, WIN-16 (desinstalar), y WIN-18 (MAX_PATH). Detalle
  completo en `PHASE_2_SLICE_1_WINDOWS_REPORT.md`.
- **NODE24 en CI Linux no reproducido**: en Linux el runtime Node 24 contractual no está
  disponible (`NODE24_CI_NOT_REPRODUCED`, D17); sí se verificó en la VM Windows real con
  el runtime que fija el instalador, Node v24.20.0.
- **Reuso de PID (NOTE)**: límite ya documentado del candado de proceso — no se
  encontró evidencia de que Windows agrave la ventana ya conocida en Linux
  (`RED-WINDOWS` A5).
- **Acumulación de motivos sin ejercitar (NOTE, RED-AUTHORITY N3)**: con los datos
  actuales del ESP32, ningún pin real dispara más de un motivo de clase a la vez;
  `evaluarRestriccionesPin` sí soporta acumularlos (diseño defensivo), pero ese camino
  queda sin cobertura real hoy.

## 11. Estado final

- PIN_GATE = **PASS**.
- PACKAGING_GATE = **PASS**.
- WINDOWS_GATE = **PASS_WITH_DOCUMENTED_GAPS**.
- Red team: **sin CRITICAL ni MAJOR abierto**, remediación de evidencia Windows
  verificada de forma independiente (RED-WINDOWS-R2).
- H4 = **ACCEPTED_KNOWN_LIMITATION** (D15).
- Tests: **1115/1115**, typecheck 0, `fichas:check` 0; `tests/nucleo-*` (Phase 1) sin
  diff contra `8b43c59`.
- Backlog documentado en §10, ninguno bloquea el slice.
- Pendiente de autorización humana antes de cerrar por completo la matriz Windows: clean
  install desde `base-limpia` (WIN-01) y desinstalación (WIN-16) — ver
  `PHASE_2_SLICE_1_WINDOWS_REPORT.md` §7.
