# Phase 2 Slice 1: diseño del hardening final (packaging, GPIO, Windows)

Estado: **CONGELADO** para el gate final de hardening de Phase 2 Slice 1.

Identidad:
- base del gate: `b0b97d7` (rama `feature/programacion-intencion-phase2`);
- Phase 1: `8b43c59` (`main`);
- baseline: 1100/1100, typecheck 0, fichas 0.

Fuentes de este diseño:
- los cuatro informes ARCH, read-only y en paralelo: ARCH-PINS, ARCH-INSTALL, ARCH-WIN y ARCH-GATE;
- el **DECISION GATE del HUMAN PRODUCT OWNER** del 2026-09-29, que es normativo para este gate.

Los ARCH no tuvieron desacuerdos materiales, así que no hizo falta un adjudicador.

Fuera de alcance: no hay features nuevas; no Blockly, pulsador como feature, codegen, PlatformIO nuevo, cable geométrico, componentes nuevos, refactor general, guardián AST, frameworks, DB ni nube; no hay push, PR, merge ni Slice 2.

## 1. Tabla de decisiones

| # | DECISION | SOURCE | FINAL CONTRACT | IMPLEMENTATION OWNER | TESTS | ACCEPTANCE CRITERION |
|---|---|---|---|---|---|---|
| D1 | H-1 flash GPIO6-11 | Humano (H-1=B); ARCH-PINS §3/§7 | Motivo `PIN_FLASH_RESERVADO`: `blocking`, `representable`. La operación NO se rechaza por esto. Persistible, recargable, editable y not-ready | W-PINS (validador del núcleo) | `phase2-hardening-pines` por Engine, POST, snapshot/tool y recarga | Los 4 caminos dan el mismo motivo; `listo:false`; el proyecto recarga; reasignar a un pin normal lo limpia |
| D2 | H-2 strapping por pin | Humano (H-2=B) | Motivo `PIN_STRAPPING`: GPIO12 `warning`; GPIO0 `info`; GPIO15 `info`. Severidad POR PIN, tomada de una tabla declarativa del núcleo, separada de la clase técnica | W-PINS | ídem | Severidad exacta por pin; ninguno cambia `listo` |
| D3 | H-2b GPIO2 | Humano (H-2b=A) | `PIN_STRAPPING` `info` para GPIO2. Se sigue ofreciendo y sigue en el pool automático | W-PINS | ídem, más el pool | GPIO2 queda `listo:true` con un motivo info |
| D4 | H-3 GPIO5 | Humano (H-3=A) | Sin restricción nueva | nadie (sin cambio) | test de no-regresión: GPIO5 sin motivos | GPIO5 sin motivos de restricción |
| D5 | H-4 sólo-entrada + pull-up interno | Humano (H-4=A); ARCH-PINS §7 | Dato declarativo en el terminal del catálogo, `requierePullUpInterno: true` (sólo en `pulsador.senal`). Motivo `PIN_SIN_PULLUP_INTERNO`: `blocking`, `representable`, cuando el terminal lo requiere y el pin tiene la restricción `soloEntrada`. Nada de `if GPIO34`. Un pin sólo-entrada no es inválido en sí mismo: el `ntc` analógico en GPIO34 sigue sin motivo. DHT22 → BACKLOG | W-PINS (catálogo + validador) | pulsador en 34/35/36/39 → blocking; ntc en 34 → sin motivo; pulsador en GPIO4 → sin motivo | La regla no nombra ningún pin; deriva de datos |
| D6 | H-5 GPIO0 y flash sin pin físico | Humano (H-5=A) | Siguen en el registro. Sin restricción `sinPinFisico` y sin reabrir el enum. La vista deriva qué puede dibujar (`nombreWokwiDePin`) | nadie (sin cambio) | tests de Phase 1 intactos | `tests/nucleo-*` sin diff |
| D7 | H-6 uartUsb GPIO1/3 | Humano (H-6=B) | Motivo `PIN_UART_USB`: `warning`, `representable`. El texto/`datos` se limita a la evidencia del repo (`circuito.ts:348-351`): interfiere con la carga del programa y con el Monitor Serie | W-PINS | ídem | warning; `listo` no cambia |
| D8 | H-7 filtro de capacidad en `<select>` | Humano (H-7=A) | Se mantiene `gpiosCandidatosPara`, que deriva de `asignarPin` del catálogo. El browser JS no tiene ninguna tabla eléctrica. Los pines con restricciones representables (2, 12, 15, 1, 3) se siguen ofreciendo | W-PINS (verificación; sin cambio en la UI) | test: `web/*.js` sin literales de restricciones ni listas de GPIO eléctricas | El scan del browser JS da 0 tablas; los candidatos salen de la función del núcleo |
| D9 | GPIO37/38 | Humano (§2); ARCH-PINS (evidencia: `SKILL.md:82-85`, `circuito.test.mjs:2524-2527`) | Se quitan de `ESP32_GPIO_VALIDOS` (`placas.ts`). Asignarlos por operación da el rechazo que ya existe, `PIN_INEXISTENTE_EN_PLACA`. Un estado histórico con GPIO37 se carga con D10. `circuito.ts` NO se toca: la divergencia con el tool legado queda documentada | W-PINS | se actualiza `phase2-wokwi-pinout.test.mjs:84-86` (Phase 2); `tests/nucleo-*` intactos (verificado: `nucleo-placas.test.mjs:162-205` no compara `GPIO_VALIDOS`) | El registro ya no tiene 37/38; un documento con 37 recarga con blocking |
| D10 | Pin inexistente en documento | Humano (§3); precedente `PLACA_DESCONOCIDA_EN_DOCUMENTO` (`validar-tecnico.ts:46-55`) | Motivo `PIN_INEXISTENTE_EN_DOCUMENTO`: `blocking`, `representable`, cuando una asignación no existe en el registro de la placa actual, por cualquier camino (`SetPlaca`, documento en disco). Carga, conserva el estado, diagnostica, queda not-ready y editable | W-PINS | `SetPlaca` esp32→uno con GPIO4; un documento en disco con GPIO20 y otro con GPIO37 | Mismo diagnóstico por operación-luego-estado y por recarga; nunca `ESTADO_NO_RECARGABLE` |
| D11 | Rechazo vs representable | ARCH-PINS §5 (`motor.ts:358-360`) | Ninguna regla nueva del validador emite `rechazo`. Todas son `representable`. Así ya hay proyectos persistidos con GPIO6/1/12/37 y se siguen abriendo | W-PINS | recarga de fixtures con esos pines | PERSISTIBLE ⇒ RECARGABLE |
| D12 | INST: piezas nuevas en el instalador | ARCH-INSTALL §6.1 | `install.sh`/`install.ps1` copian `opencode/nucleo`, `opencode/servidor` y `opencode/vista-fisica` (con `web/`) a la config de OpenCode, como carpetas hermanas de `tool/`, nunca dentro. Se suman al manifiesto NUEVOS y a la limpieza de `uninstall.*`. No se copian scratchpad, docs, tests ni evidencia. El `.iss` ya empaqueta `opencode\*` | W-INSTALL | `tests/empaquetado-instalado.test.mjs`, sobre una instalación temporal real fuera del repo | Gate §4 |
| D13 | INST-2 import lazy | Humano (INST-2=A) | `tool/vista-fisica.ts` carga `../servidor/*` con `await import()` dentro de `execute`. Si falta una pieza, el error es explícito, comprensible y determinista: nombra la pieza que falta y sugiere reinstalar. Sin catch vacío, sin fallback falso, sin éxito simulado. Los `import type` se quedan | W-INSTALL | test: con `servidor/` ausente, el resto de las tools cargan y vista-fisica falla con un mensaje explícito | El registro de tools no se cae |
| D14 | INST-1 rollback | Humano (INST-1=D) | D13 + `[InstallDelete] Type: filesandordirs; Name: "{app}\opencode"` en el `.iss` + `docs/rollback.md`: desinstalar antes de instalar una versión anterior. SIN staging/swap en `update.*` | W-INSTALL | revisión estática del `.iss`; la VM si aplica | Doc y línea presentes |
| D15 | H4 | Humano (§5) | `ACCEPTED_KNOWN_LIMITATION`: severidad original MAJOR, `accepted_by` = HUMAN_PRODUCT_OWNER, no bloquea el slice. Las guardias léxicas son controles contra bypass ACCIDENTAL, no una frontera de seguridad. Sin AST, sin regex nueva, sin sandbox, sin loader. Se reabre si cambia el modelo de amenazas o aparece un bypass desde input externo o código no confiable | este commit (docs) | se mantienen los tests del bypass accidental; se conserva la evidencia W5/H4 del bypass ofuscado | Docs con la resolución agregada; la historia no se reescribe |
| D16 | Windows real | Humano (WIN=A, §6-8, §13) | Se arranca la VM win10 TAL COMO ESTÁ. Antes de cualquier operación se registran el estado, los snapshots, el runtime y la instalación existente. No se restaura `base-limpia` ni se destruye estado sin una nueva autorización. Se registra el Node real (se espera 24.20.0, sin asumirlo) y NO se actualiza a 26. WIN-LOCK-01..07 van primero y en forma experimental; el lock no se cambia en forma preventiva | orquestador (runner); W-WINDOWS sólo si la evidencia demuestra un bug | matriz WIN-01..18 + WIN-LOCK-01..07 | Informe con OS, runtime, comandos, exit codes y capturas; sin nada simulado |
| D17 | Node 24 | ARCH-WIN (WIN-17) | En Linux no está disponible → `NODE24_CI_NOT_REPRODUCED`. En la VM se prueba el runtime contractual real | orquestador | la VM | Versión exacta registrada |

## 2. Diseño de la regla de pines (W-PINS)

- **Dónde vive.** Hay una función pura nueva en el núcleo, llamada desde el bucle de terminales de `validar-tecnico.ts`, en el mismo lugar donde hoy se llama a `asignarPin`. Recibe el terminal del catálogo y el `RegistroPin`, y devuelve los motivos. No se modifica `asignarPin`, porque la operación no se rechaza por restricciones.
- **Tabla de severidad.** Es una única tabla declarativa del núcleo (clase → severidad, con la excepción por pin de strapping: GPIO12 warning, resto info). Queda separada de `Restriccion`, que es la clase técnica. No se agregan restricciones al enum.
- **Pin inexistente por estado.** Una asignación cuyo pin no está en `pinesDePlaca` produce `PIN_INEXISTENTE_EN_DOCUMENTO`. Hoy ese caso se saltea en silencio (`validar-tecnico.ts:93`, `if (pinReal)`).
- **Duplicación.** No se duplica `CAPACIDAD_PIN_INCOMPATIBLE`: un LED en GPIO34 sigue dando sólo ese motivo, no además `PIN_SIN_PULLUP_INTERNO`. Las analógicas no disparan restricciones de pines digitales.
- **Consistencia por camino.** Como la regla vive en el validador, el Engine directo, POST `/api/operaciones`, el snapshot/tool y la recarga desde disco dan el mismo diagnóstico por construcción, y un test lo cruza.
- **Browser.** No se agrega ninguna tabla. Los motivos llegan en `validacion.motivos` del snapshot, que la vista ya muestra.
- **Docs semánticos.** Se actualizan COMPONENT-CATALOG (dato `requierePullUpInterno`) y OPERATIONS/IR-SPEC si corresponde, con la tabla de severidad y los códigos nuevos.

## 3. Gate intermedio de pines (después de W-PINS)

Todo esto tiene que cumplirse antes de pasar al packaging:
- un pin normal funciona;
- GPIO6-11 → blocking representable;
- GPIO12 → warning;
- GPIO0, 15 y 2 → info;
- GPIO5 → sin motivo;
- GPIO1/3 → warning;
- pulsador en un pin sólo-entrada → blocking;
- ntc en GPIO34 → sin motivo;
- GPIO37/38 resueltos;
- un documento histórico con un pin inexistente carga con blocking;
- PERSISTIBLE ⇒ RECARGABLE;
- la operación y la recarga dan el mismo diagnóstico;
- el browser sin tabla eléctrica;
- Path A, Path B y stale;
- suite completa en verde;
- `tests/nucleo-*` sin diff.

## 4. Gate de instalación aislada (después de W-INSTALL)

La instalación temporal va FUERA del repo, con una ruta con espacio y Unicode. La copia del repo queda inaccesible después de instalar, y todo se ejecuta desde otro cwd.

Hay que comprobar:
- presencia de `nucleo`, `servidor`, `vista-fisica`, el tool, los assets Wokwi y el permiso del agente;
- que el tool carga como lo hace el registry;
- que el servidor arranca;
- que el navegador real (CDP) abre y se ven el ESP32 y el LED;
- cambio de GPIO → revisión +1, persistencia, recarga, reinicio del proceso y recuperación del lock;
- offline;
- que la instalación no contenga scratchpad, docs ni tests.

Si algo funciona sólo desde el repo, el resultado es `PACKAGING_GATE = FAIL`.

## 5. Gate de Windows real

La VM local win10 (22H2, usuario `win-vm`) se usa a través del puente `virsh qemu-agent-command` + `schtasks /ru win-vm /it`. ISCC corre dentro de la VM. La matriz es la de `ARCH_WINDOWS_MATRIX.md` (WIN-01..18), más WIN-LOCK-01..07, que tienen prioridad alta.

Si `process.kill(pid,0)` falsea liveness, eso es EVIDENCIA NUEVA: se clasifica la severidad antes de diseñar un fix, y si es un MAJOR arquitectónico se consulta al humano.

Una instalación limpia desde `base-limpia` requiere una NUEVA autorización.

## 6. Orden y reglas de proceso

1. SYNTHESIS → DESIGN FREEZE (este documento).
2. W-PINS → gate de pines.
3. W-INSTALL → gate de instalación aislada.
4. Gate de Windows real (W-WINDOWS sólo si hay un bug demostrado).
5. Red team final (RED-PACKAGE ≥8, RED-AUTHORITY ≥8, RED-WINDOWS) → como máximo UNA ronda de fixes → UNA regresión focal.
6. DOCS → FREEZE → STOP.

Reglas:
- un solo writer por vez;
- los writers no usan Agent/fork ni stash, reset, checkout, restore, clean, rebase, merge o push;
- los 2 stashes existentes son evidencia y no se tocan;
- `.gestor/` no se toca.
