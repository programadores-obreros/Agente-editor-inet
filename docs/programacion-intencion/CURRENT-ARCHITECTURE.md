> **Origen de esta copia:** producida durante el freeze de Phase 0 de "Programación por
> Intención". `f272b0d9b6aaaf4dbd28bee297a99332be19af38eac1fdce4e1296b76badb24d` es el
> sha256 del **ZIP del freeze completo** de Phase 0 (el paquete con todos los
> documentos de esa fase, no de este archivo aislado). El sha256 de **este archivo
> puntual**, tal como quedó extraído de ese freeze, es
> `f236e463d88c723fe041fa865b600a3283112aa62d24313d52523310c7b699d8` — verificado con
> `sha256sum /home/manjarodesktop/tecnia-bot-docs/phase0/CURRENT-ARCHITECTURE.md` antes
> de traer esta copia. Describe el baseline auditado `b506e81` (commit
> `b506e81cedf89e4905af92be1415b077a600971f`). Fuente original:
> `/home/manjarodesktop/tecnia-bot-docs/phase0/CURRENT-ARCHITECTURE.md` (no versionada
> en ningún repo, preparada fuera del árbol). Esta copia se trae al repo en Gate 1 de
> Fase 1 tal como ya preveía su propio encabezado ("Ubicación prevista final:
> `docs/programacion-intencion/CURRENT-ARCHITECTURE.md`"). Contenido sin cambios
> respecto del original salvo esta nota.

---

# CURRENT-ARCHITECTURE.md — Tecnia Bot (baseline auditado)

> Ubicación prevista final: `docs/programacion-intencion/CURRENT-ARCHITECTURE.md` dentro del repo
> `tecnia-bot` (github.com/programadores-obreros/Agente-editor-inet). Este archivo se prepara
> **fuera** del repo, en `/home/manjarodesktop/tecnia-bot-docs/phase0/`, y **no está commiteado**
> al repo del producto. El commit al destino final es decisión posterior del equipo, fuera del
> alcance de esta integración.
>
> Objetivo del target contract (referencia, sin copiar contenido): brief maestro
> `BRIEF_MAESTRO_PROGRAMACION_POR_INTENCION_TECNIA_BOT_v5_FINAL.md` §24, §38. Este documento
> contiene **solo** arquitectura actual observada; el target se referencia por número de sección,
> nunca se transcribe.

**Baseline auditado:** commit `b506e81cedf89e4905af92be1415b077a600971f` (`Agente-editor-inet`,
merge de PR #36 `feat/skill-archify`), extraído read-only vía `git archive` a un scratch dir.
El checkout vivo del repo (`/home/manjarodesktop/hostshare/manajaro1/tecnia-bot`, HEAD
`0fa729871edca53e41688a2b1649125690641a2a`) está 10 commits adelante del baseline (docs, validador
de skills en CI, diagnóstico Node) y **no fue usado como evidencia** — ver `PHASE_0_AUDIT_REPORT.md`
§"Commits posteriores al baseline" para el detalle.

Convención de evidencia: **OBSERVED** = leído directamente del código/config en el baseline;
**INFERRED** = deducción razonable sin lectura directa del punto exacto; **UNKNOWN** = no
verificable con la evidencia disponible en Fase 0. Cada afirmación cita archivo:línea y el
identificador `E0xx` correspondiente en `PHASE_0_EVIDENCE_INDEX.md`.

---

## 1. Mapa de módulos

```
tecnia-bot/ (b506e81)
├── opencode/                          → carga útil instalada en ~/.config/opencode
│   ├── agent/tecnia-bot.md            → agente primario (frontmatter YAML: permisos por tool, modelo, steps:40)
│   ├── command/*.md (5)               → actualizar, ayuda, clave, diagnostico, reparar (prompts, no código)
│   ├── tool/*.ts (9)                  → actualizar, ayuda, circuito, clave, ficha, imprimible, memoria, perfil, platformio
│   ├── plugins/tecnia-logo.tsx        → plugin TUI (splash), no auditado en detalle (fuera de tool/)
│   ├── themes/tecnia-violet.json      → tema TUI
│   ├── skills/*/SKILL.md (20)         → prompts de dominio inyectados (educabot, placas, arduino, esp32, ...)
│   │   └── skills/archify/            → sub-paquete npm independiente (diagramas JSON-IR), no es skill de contenido
│   ├── tecniabot-web/                 → wokwi-bundle.js (6880L), componentes-extra.js, pinouts.json (33L),
│   │                                      2 plantillas HTML protoboard, sitio/ (micrositio estático de ayuda)
│   └── env.d.ts                       → vacío, comentario propio: "tools corren dentro del runtime de OpenCode (Bun)"
├── install/                           → install.sh/.ps1, update.sh/.ps1, uninstall.sh/.ps1, bootstrap.sh/.ps1,
│                                          diagnostico.ps1, chequear-clave.ps1, pines NODE/OPENCODE/PYTHON_VERSION
├── installer/                         → Inno Setup (tecnia-bot.iss), abrir-tecnia-bot.cmd, branding
├── tests/                             → 42 *.test.mjs planos, `node --test`
├── scripts/                           → fichas-manifest.mjs, notas-release.mjs, seguridad-proyectos.mjs
├── ejemplos/                          → 5 proyectos PlatformIO reales (platformio.ini + main.cpp)
├── docs/                              → ~20 .md (instalación, decisiones, rollback, rutas-no-ascii, ...)
├── .github/workflows/                 → ci.yml (jobs test/windows/skills), build-installer.yml
└── raíz                                → package.json (pnpm@11.3.0), pnpm-lock.yaml, tsconfig.json, VERSION (0.4.2)
```

No existe `opencode.json` ni `.opencode/` versionado en el repo (E-A§1). La "configuración de
OpenCode" es la convención de carpetas (`agent/, tool/, command/, plugins/, skills/, themes/`) que
`install.sh`/`install.ps1` copian literalmente a `~/.config/opencode` (`install/install.sh:19-30`,
OBSERVED).

## 2. Runtime híbrido Node/Bun

- **Dev/CI/test = Node + pnpm.** `package.json:4` `"packageManager": "pnpm@11.3.0"`; único
  lockfile `pnpm-lock.yaml`; scripts `"test": "node --test tests/*.test.mjs"`,
  `"typecheck": "tsc --noEmit -p tsconfig.json"`. CI (`ci.yml:53-70`) usa
  `actions/setup-node@v4` con Node 24, nunca Bun.
- **Runtime de producción de las tools = Bun, embebido en OpenCode.** `opencode/env.d.ts:2-3`
  (comentario propio, OBSERVED): *"Las tools corren dentro del runtime de OpenCode (Bun)"*. Uso
  directo de `Bun.spawn`/`Bun.which`/`Bun.write` en 7 de las 9 tools (`actualizar.ts`, `ayuda.ts`,
  `circuito.ts`, `clave.ts`, `ficha.ts`, `imprimible.ts`, `platformio.ts`), mezclado deliberadamente
  con `node:fs`/`node:os`/`node:path`/`node:crypto` en los mismos archivos — decisión comentada
  explícitamente línea por línea en `memoria.ts:109-116` y `perfil.ts:149-154` (por qué `node:fs`
  y no `Bun.write` para el rename atómico).
- No hay `bunfig.toml` ni segundo lockfile: el híbrido es real pero **unidireccional** — el repo
  se gestiona 100% con pnpm/Node; Bun solo aparece como runtime de ejecución consumido, nunca
  como gestor de paquetes del propio repo (A §2, E046).
- **Python:** `install/PYTHON_VERSION=3.14.7`, usado exclusivamente para instalar/ejecutar
  PlatformIO Core (bootstrap).

## 3. Ciclo de vida del proceso — quién arranca y qué queda vivo

```
Docente hace doble clic en el acceso directo (Inno Setup [Icons])
  → installer/abrir-tecnia-bot.cmd
       → espera si existe marca `.instalando` (instalación Inno en curso)
       → localiza opencode.exe (scoop\current\ → scoop\shims\ → PATH)
       → si falta la capa (~/.config/opencode/agent/tecnia-bot.md) → corre bootstrap.ps1 UNA vez (auto-reparación)
       → cd "%USERPROFILE%\Documents\Tecnia Bot"
       → install/chequear-clave.ps1 (aviso no bloqueante)
       → exec "opencode"  ← TUI LOCAL, proceso único, foreground, bloqueante
            [proceso opencode vivo — un solo proceso, sin socket TCP abierto]
              → arranque: escanea {tool,tools}/*.{js,ts} en Global.Path.config (~/.config/opencode)
                 e importa cada uno con `import()` dinámico, EN EL MISMO PROCESO Bun
              → carga opencode.json (default_agent=tecnia-bot, agent.tecnia-bot.model,
                 instructions=[tecnia-perfil.md, tecnia-memoria.md])
              → por turno de chat: el LLM decide llamar una tool → execute() corre EN PROCESO
                 (memoria/perfil/clave/actualizar) o hace Bun.spawn de un hijo síncrono y espera
                 su salida (platformio, circuito, actualizar→update.ps1/sh)
              → estado persiste en archivos bajo ~/.config/opencode y ~/.local/share/opencode;
                 ADEMÁS platformio.ts cachea en una variable de módulo (pioPathCache) que solo
                 vive en RAM del proceso y se pierde al reiniciar
       → al cerrar la ventana: exit code → .cmd muestra error o cierra limpio
       → reabrir = repetir todo el flujo desde cero (sin recuperación de estado en memoria)
```

- El único entrypoint documentado es `abrir-tecnia-bot.cmd`, apuntado por los accesos directos
  de `installer/tecnia-bot.iss:132,159`. En Linux/Mac el equivalente manual es
  `bash install/bootstrap.sh` (no hay `.cmd`/acceso directo Linux en el baseline).
- **El proceso que queda vivo es el TUI local de OpenCode (`opencode` sin argumentos), no
  `opencode serve`.** `rg -n "opencode serve|opencode attach"` sobre todo el repo → 0 resultados
  (E031). Es el único proceso persistente que Tecnia Bot lanza; no hay servidor HTTP, daemon, ni
  segundo runtime.
- Carga de tools (OBSERVED sobre upstream OpenCode 1.15.12, checkout de referencia — ver
  `install/OPENCODE_VERSION`=1.18.18, versión realmente pinneada, distinta de la auditada línea
  por línea; ver §7 más abajo): `packages/opencode/src/tool/registry.ts:~199-213`,
  `Glob.scanSync("{tool,tools}/*.{js,ts}", {cwd:dir, absolute:true})` seguido de
  `import(pathToFileURL(match).href)` — import dinámico ESM, en el mismo proceso, no un proceso
  hijo. `install/install.sh:9,22` copia literalmente `opencode/tool/*.ts` a
  `$XDG_CONFIG_HOME/opencode/tool/`, cerrando la cadena: los 9 archivos del repo terminan siendo
  escaneados e importados por OpenCode al arrancar.
- Sin hot-reload: `actualizar.ts:210-212` le pide explícitamente al usuario "Reiniciá OpenCode
  para que los cambios tomen efecto" tras actualizar la capa — no hay recarga ni reinicio
  automático de módulos de tool.

## 4. Contrato de las 9 tools

| Tool | Archivo:líneas | Acción vía `args` | Efecto de lado observado | Estado |
|---|---|---|---|---|
| `memoria` | `memoria.ts` (~133L exec) | `accion: leer\|guardar` | fs: `tecnia-memoria.md` (escritura atómica) | archivo |
| `perfil` | `perfil.ts` | modo personal/grupo/aula | fs: `tecnia-perfil.md` (mismo patrón) | archivo |
| `actualizar` | `actualizar.ts:139` | `verificar?: boolean` | red (GitHub API) + `Bun.spawn` de `update.{ps1,sh}` | archivo (`tecnia-bot.manifest`) |
| `clave` | `clave.ts` (798L) | gestión API key | fs: `auth.json` (chmod 0600) + `opencode.json` | archivo |
| `circuito` | `circuito.ts` (3274L) | genera/abre circuito (HTML) | escribe HTML en `ctx.directory` + `Bun.spawn` detached para abrir navegador | sin estado de módulo |
| `platformio` | `platformio.ts` (1217L) | `action`: compile/flash/both/monitor/diagnostico/reparar | `Bun.spawn` de `pio`/`platformio`, `ctx.abort` como señal de cancelación | **módulo**: `pioPathCache` |
| `ficha`, `imprimible`, `ayuda` | `tool/*.ts` | UNKNOWN (no auditados en detalle en Fase 0) | UNKNOWN | UNKNOWN |

Contexto inyectado por el host a cada `execute()` (OBSERVED, upstream `registry.ts:~159-169`):
`directory`, `worktree`, `ask`, `sessionID`, `messageID`, `agent`, `abort`/`callID`. `circuito.ts`
y `platformio.ts` consumen al menos `directory` y `abort`.

El agente `opencode/agent/tecnia-bot.md` declara `permission` allow/ask/deny por tool
(`bash: "deny"` — el LLM no ejecuta shell arbitrario, solo las 9 tools custom). Comandos
(`opencode/command/*.md`) y skills (`opencode/skills/*/SKILL.md`) son **prompts inyectados**, no
código: fuerzan tool-calling determinista sobre decisión libre del LLM (ejemplo documentado en
`command/diagnostico.md`: incidente real donde el modelo, sin esa instrucción, recomendó instalar
VS Code en vez de usar la tool ya instalada).

## 5. `circuito.ts` — vista física (Wokwi/HTML)

Responsabilidad: tool `@opencode-ai/plugin` que genera un `.html` autocontenido con piezas Wokwi
Elements animadas y lo guarda en `ctx.directory` (`circuito.ts:2828-2845`).

- **Board:** `idPlaca` derivado de `args.placa` (default `"esp32"`), resuelto contra `PLACAS`
  (`Record<PlacaId, Placa>`, `PlacaId = "esp32"|"uno"`, línea 213; objeto exportado línea 636).
  Shields se resuelven a su `base` vía `shieldDe()` (línea 587). Placa inexistente → rechazo
  explícito, nunca fallback silencioso.
- **Componentes:** string libre parseado por `parsearComponentes` → `Pedido[]`, validado contra
  `COMPONENTES`.
- **Pines:** `asignarGpios` (L1693-1843) reparte desde pools (`poolDigital/poolAnalogico/poolPwm`)
  por placa; pin manual del usuario se "siembra" primero. Colisiones vía `Set<string>` con clave
  `banco+n` (`clavePin`, L189).
- **100% determinista en la asignación/HTML** — cero llamadas a LLM dentro del tool. El LLM solo
  decide QUÉ pedir (placa/componentes/umbral) y redacta el texto de respuesta; el tool prohíbe
  explícitamente inventar HTML/SVG a mano (skill `circuitos-visuales/SKILL.md:10`).
- **`pinouts.json` NO se referencia en este archivo** (`rg -n "pinouts" opencode/tool/circuito.ts`
  → 0 resultados, ni en ninguna de las 9 tools). El mapeo pin↔Wokwi vive hardcodeado en `PLACAS`.
- **Entrega:** `file://` vía `comoUrl()` (L21-24); `abrirEnNavegador()` (L48-65) hace
  `Bun.spawn` detached (`proc.unref()`, L60) del comando nativo del SO (`start`/`open`/`xdg-open`),
  best-effort, nunca revienta la tool. Assets (`wokwi-bundle.js`, `componentes-extra.js`) se
  copian AL LADO del HTML en cada generación porque, cita textual del código (L2980-2982): *"el
  navegador bloquea que un `file://` cargue otro `file://` de otra carpeta (security origin)"*.
- **Cero servidor:** `rg -n "Bun.serve|http|WebSocket|EventSource"` sobre `circuito.ts` → 0
  resultados. No hay canal de vuelta navegador→proceso, ni `postMessage`/`localStorage`/
  `sessionStorage`/`indexedDB` (0 resultados). El HTML es un artefacto final, no un cliente
  conectado: no observable, no recuperable, no round-trip.
- **Identidad de componente:** `id = tipo+índice` (L2039, ej. `led0`), **posicional** dentro del
  array de esa ejecución — determinista si la lista y el orden no cambian, pero no sobrevive a
  una regeneración con otro pedido (no hay journal de ids previos).
- **Byte nulo en offset 172678** (línea 2929): `const PLACA_INVALIDA = "\x00placa-invalida"` — un
  sentinel de código fuente **deliberado** (el byte nulo garantiza que nunca colisione con una
  clave real de `PLACAS`, que viene de un string de usuario). No es dato embebido ni anomalía de
  encoding.
- El archivo mezcla 4 responsabilidades en un solo módulo de 3274 líneas: (a) catálogo de
  placas/pines, (b) catálogo de componentes+animaciones, (c) motor de armado/HTML, (d) I/O de
  archivo+proceso.

## 6. `platformio.ts` — compilación/carga

- Input: `{action, port, baud, environment, project_path}`; `cwd = args.project_path ?? ctx.directory`
  — el tool **no crea** `platformio.ini`/`main.cpp`, solo los lee (`readFileSync`, L753-760).
- Acciones: `compile` (`pio run`), `flash` (detecta puerto si falta, `pio run --target upload`),
  `both`, `monitor` (abre terminal nueva por SO, lee `monitor_speed` del `.ini` local),
  `diagnostico` (`pio --version` + `pio device list --json-output` + `Get-CimInstance` en Windows
  para drivers faltantes), `reparar` (solo ejecuta algo en Windows — `bootstrap.ps1`; Linux/Mac
  solo da instrucciones de texto).
- **No contiene conocimiento de placa/pin/framework** salvo `CHIPS_USB` (L478-507, VID:PID→chip
  de puerto serie CH340/CP2102/FTDI/Arduino-Espressif oficial — identidad de **puerto**, no de
  placa de programación). `board=`, `platform=`, `framework=` viven en `ejemplos/*/platformio.ini`
  y en las **instrucciones al LLM** (`tecnia-bot.md:227-229`, `skills/arduino/SKILL.md`,
  `skills/placas/SKILL.md`): generar `platformio.ini`/`main.cpp` es responsabilidad del LLM vía
  prompt/skill, no del tool.
- **100% determinista en compilar/cargar/detectar puerto/traducir error.** `traducirError()`
  (L347-452) es regex determinística (12 patrones fijos), sin LLM.
- Detección de puerto: `detectPort()` (L654-704) vía `pio device list --json-output` + regex
  fallback; filtra por `identificar()` (VID:PID) para descartar puertos no-placa.
- Resolución del binario `pio`: `pioCandidatos()` (L71-86), orden
  `PLATFORMIO_CORE_DIR`→`~/.platformio`→(Win) raíz de disco→PATH.
- **Estado de módulo:** `let pioPathCache: string | null = null` (línea 20) — **única**
  declaración `let` mutable a nivel de módulo entre las 9 tools (todas las demás son `const` de
  catálogos/mensajes inmutables). Bug histórico documentado en comentario L14-18: cachea también
  el fallback `"pio"` sin verificar; si `reparar` instala PlatformIO después, el caché queda
  "pegado" al valor incorrecto hasta reiniciar OpenCode — evidencia directa de que el runtime no
  ofrece a las tools ningún hook de invalidación de caché entre llamadas.
- Riesgo de shell-injection mitigado y documentado solo en rama macOS de `monitor`
  (`puertoValido()`, whitelist regex); Windows/Linux arman `Bun.spawn` con arrays, sin shell.

## 7. Duplicación de conocimiento de placa (3 vocabularios sin tabla de traducción)

| Vocabulario | Ubicación | Ejemplo | Traducción a los otros dos |
|---|---|---|---|
| `PlacaId` (circuito.ts) | `circuito.ts:213,636` | `"esp32"` \| `"uno"` | Ninguna en código |
| `board=` (PlatformIO) | `ejemplos/*/platformio.ini`, `skills/placas/SKILL.md` | `"uno"`, `"esp32dev"` | Ninguna en código |
| clave de `pinouts.json` | `opencode/tecniabot-web/pinouts.json` | `"esp32"`, `"uno"` (string libre) | Ninguna en código |

**No existe hoy ninguna tabla `PlacaId ↔ board(PlatformIO) ↔ tag(Wokwi) ↔ pinouts.json`** — la
traducción vive repartida e implícita en prosa/skills y en el juicio del LLM (confirmado
cruzadamente por 3 auditorías independientes de código, ver `V_contradicciones` fila 8 y
`CONTRADICTIONS_PHASE_0.md`). Detalle completo de campos en `BOARD_SCHEMA_EVIDENCE.md`.

## 8. `pinouts.json` / `tecniabot-web/`

- `opencode/tecniabot-web/pinouts.json` (33 líneas): schema `_meta{descripcion, verdad, campos}`
  + una entrada por proyecto `{titulo, esp32:{inicial:[...]}, uno:{inicial:[...]}}`. **Solo 1 de
  15 proyectos de `proyectos-inet` está poblado** (`01-semaforizacion`).
- `_meta.verdad` apunta a `proyectos_inet/src/hardware/<slug>/<placa>/nivel-<nivel>/*.ino` — ese
  árbol **no existe en este repo** (`fd proyectos_inet` sin resultados); es ruta de otro
  repo/entorno. No hay script en `scripts/` que lea/genere `pinouts.json`.
- **Ningún tool de runtime lo lee** (`rg -n "pinouts" opencode/tool/` → 0 resultados en las 9
  tools). El único consumidor real es `tests/pinouts.test.mjs` (compara el JSON contra la
  plantilla HTML y el skill del semáforo, solo para ese 1 proyecto) y `resistencia-led.test.mjs`
  (regex de texto). Es **fixture de test/documentación**, no dato operativo del runtime actual.
- `tecniabot-web/` tiene doble uso: (a) biblioteca de piezas Wokwi que `circuito.ts` consume en
  runtime (copiada desde `$XDG_CONFIG_HOME/opencode/tecniabot-web/`), y (b) `sitio/` — micrositio
  estático de onboarding sin relación funcional con Wokwi/pinouts, sin build step, offline vía
  `file://`, paths relativos.

## 9. Persistencia / estado

| Archivo:línea | API | Qué escribe | Ruta | Clasificación |
|---|---|---|---|---|
| `memoria.ts:118-131` | `mkdirSync`+`writeFileSync(temp)`+`renameSync`+`unlinkSync`(catch) | progreso pedagógico | `~/.config/opencode/tecnia-memoria.md` | CANONICAL_STATE, atómico |
| `perfil.ts:117-165` | patrón idéntico duplicado | perfil de usuario/aula | `~/.config/opencode/tecnia-perfil.md` | CANONICAL_STATE, atómico |
| `clave.ts:191-215` | ídem + `chmodSync(0o600)` pre-rename | credencial Google / override de modelo | `$XDG_DATA_HOME/opencode/auth.json`, `opencode.json` | CONFIG/credencial, atómico |
| `imprimible.ts:179` | `Bun.write` (NO atómico) | hoja HTML para imprimir | carpeta de trabajo del usuario | DERIVED_ARTIFACT |
| `circuito.ts:2587,2590` | `Bun.write` (NO atómico) | copia de bundle/extra (cache idempotente) | carpeta de trabajo | CACHE |
| `circuito.ts:2612` | `Bun.write` (NO atómico) | HTML del circuito generado | carpeta de trabajo | DERIVED_ARTIFACT — **TOCTOU**: `existsSync()` + `Bun.write()` no son atómicos entre sí en el dedupe de nombre |

- Patrón de escritura atómica (temp en el MISMO directorio + `renameSync`) duplicado
  **literalmente 3 veces** (`memoria.ts`, `perfil.ts`, `clave.ts`) por decisión (comentarios propios
  reconocen la duplicación, sin capa compartida). Justificación explícita del temp-en-mismo-dir:
  evitar `EXDEV` entre filesystems si se usara `os.tmpdir()`.
- **Sin locks/mutex/flock en ningún tool** — modelo implícito de single-writer, no declarado
  explícitamente como asunción en `memoria.ts` (sí en `clave.ts`, que explica el chmod).
- Sin `fsync`/`fdatasync` en ningún write atómico: durabilidad ante corte de luz depende del
  FS/OS, no mitigada por la app.
- `leerMemoria()`: si el archivo falla o no matchea los regex esperados, degrada a memoria vacía
  silenciosamente — sin distinción "corrupto" vs "vacío", sin backup de versión anterior.
- No hay caché de sesión ni "session store" propio más allá de lo listado. `circuito.ts` regenera
  el HTML completo cada vez, sin estado intermedio serializado.

## 10. Instalación / offline

- **Windows (target primario):** Inno Setup 6 (`installer/tecnia-bot.iss`), `x64compatible`,
  `MinVersion=10.0`, sin admin, `SetupMutex` (una instalación a la vez), `RedirectionGuard=no`
  (workaround: Inno≥6.7.0 rompe junctions de Scoop). Instala vía Scoop + `bootstrap.ps1` (1353L):
  OpenCode, Python 3.14.7, Node 24.20.0, PlatformIO Core.
- **Linux/macOS:** `install/bootstrap.sh` (175L) instala OpenCode vía
  `curl ... | bash -s -- --version 1.18.18` solo si `command -v opencode` falla. Versión FIJADA
  para evitar rate-limit de GitHub API (60 req/h/IP, crítico en aula de 20 PCs tras una IP).
- **PlatformIO:** buscado en 3 lugares, lógica duplicada a propósito en 5 scripts distintos
  (ningún dot-sourcing); instalado con `get-platformio.py` oficial; fallo no corta la instalación.
- **NO es offline para el chat de IA:** siempre depende de un proveedor LLM en la nube
  (`opencode/big-pickle` sin key, o `google/gemini-3.5-flash-lite` con key). Sin red, ninguno
  responde. Primer install SIEMPRE requiere red (~57-60MB OpenCode + PlatformIO).
- **Actualización SIEMPRE requiere internet** (`update.sh`/`update.ps1` consultan GitHub API
  releases/latest); si falla, no rompe nada. No hay ruta offline/USB documentada para distribuir
  actualizaciones entre PCs de un aula sin conectividad — gap de evidencia, no de diseño.
- **Desinstalación:** `uninstall.sh`/`.ps1` preguntan explícitamente antes de borrar
  `tecnia-perfil.md`/`tecnia-memoria.md`/key de Google (`--conservar` default / `--borrar`). No
  hay limpieza de procesos (si OpenCode está abierto, pide cerrarlo a mano).
- **Sin puertos, sin firewall, sin antivirus-vs-red:** con el mecanismo actual (`file://` +
  `Bun.spawn` de visor nativo), ninguna interacción de red — no hay regla de firewall que crear.
  `diagnostico.ps1` sí documenta interacción de antivirus con el binario OpenCode (falsos
  positivos), no relacionada a puertos.

## 11. Tests

42 archivos `tests/*.test.mjs`, `node --test`, corridos solo en el job `test` (ubuntu) de CI.
Cobertura fuerte y determinista en: generación HTML de circuito (144 casos), asignación de pines,
colisiones, identidad de componente, PlatformIO (compile/flash/monitor, mock de `Bun.spawn`),
persistencia atómica (incluye fallo a mitad de escritura), coherencia prompt↔tools↔skills. CI
tiene un job Windows real (PowerShell 5.1, PSScriptAnalyzer, ISCC real, `bootstrap.ps1` real,
compilación PlatformIO real de `ejemplos/_test-librerias`) que corre en paralelo pero **no**
ejecuta los 42 `*.test.mjs` (esos corren solo en Linux). Gaps confirmados: cero render real de
HTML en navegador/DOM (sin jsdom/puppeteer/playwright); `pinouts.json` probado solo para 1/15
proyectos; ningún test valida el contrato de tool contra el runtime real de `@opencode-ai/plugin`
(usa `mock-plugin.ts` inyectado); "offline" se prueba como fallo de `fetch` simulado, no como
ausencia real de red.

## 12. Comunicación navegador↔proceso — estado actual (respuesta a las 7 preguntas del brief §24)

No existe hoy ningún "Project Engine"; se responde con el análogo actual (`circuito.ts`, único
generador de contenido visual) y con el único precedente de servidor loopback del monorepo,
`opencode/skills/archify/bin/preview.mjs` (subsistema de diagramas `archify`, no relacionado al
Project Engine — se usa aquí solo como evidencia de patrón, no como recomendación):

| # | Pregunta (brief §24) | Estado actual (evidencia) |
|---|---|---|
| 1 | ¿Cómo arranca? | No existe. Análogo: `circuito.ts` no arranca proceso/servidor, genera un HTML estático (L2976-3220). |
| 2 | ¿Lifecycle, quién lo termina? | Sin lifecycle: es un archivo, no un proceso. `abrirEnNavegador()` lanza `Bun.spawn` detached y no vuelve a tocarlo; lo termina el usuario cerrando la pestaña. Contraste: `preview.mjs` sí modela lifecycle completo (`stopGraceMs`/`stopKillMs`, estados `stopping/stopped/serverClosing/serverClosed`). |
| 3 | ¿Puerto? | Ninguno hoy (`file://`). Precedente: `preview.mjs` usa `server.listen(0, loopbackHost)` (puerto efímero asignado por el SO). |
| 4 | ¿Binding loopback? | No aplica hoy. Precedente: `preview.mjs` fija `127.0.0.1` explícito y valida el header `Host` de cada request (403 si no matchea) — mitigación anti DNS-rebinding ya implementada y testeada en este monorepo. |
| 5 | ¿Firewall/antivirus? | Ninguna interacción hoy (sin socket). Si un futuro Engine abre `http.createServer`, Windows Firewall dispararía el diálogo estándar la primera vez — REQUIRES_CONTROLLED_RUNTIME_TEST. |
| 6 | ¿Caída y recuperación? | Hoy no hay canal que pueda caerse. Si `abrirEnNavegador()` falla, se captura y degrada a instrucción manual (`file://...`), sin reintento automático. |
| 7 | ¿Impacto en empaquetado? | `file://` actual: cero impacto. Un sidecar HTTP no agrega binarios nuevos (`node:http` nativo) pero sí superficie: puerto, posible diálogo de firewall, gestión de ciclo de vida de proceso hijo — no decidido en Fase 0. |

Restricción operativa que aplica a **cualquier** diseño futuro (no solo in-process): los tools
solo corren cuando el LLM decide invocarlos — no hay gancho para lógica que corra *entre* turnos;
no hay hot-reload; el proceso muere con la ventana; no hay supervisor de proceso.

## 13. Puntos de extensión observados

- El registro de tools (`import()` dinámico por convención de carpeta) es un punto de extensión
  ya usado por las 9 tools existentes — agregar un módulo adicional no exige runtime nuevo.
- El contexto `ctx` inyectado a `execute()` (`directory`, `ask`, `sessionID`, `abort`) es un canal
  host→tool ya reutilizable sin protocolo nuevo.
- El precedente de estado en memoria de módulo (`pioPathCache`) muestra que un módulo de tool
  puede sostener estado entre llamadas dentro de la misma sesión de proceso — con el riesgo ya
  documentado de invalidación no gestionada por el host.

## 14. Contradicciones encontradas entre repo y brief

Ver `CONTRADICTIONS_PHASE_0.md` para el detalle completo con evidencia de ambos lados. Resumen:
ninguna contradicción encontrada exige una decisión humana que bloquee el cierre de Fase 0; la más
próxima a ese territorio (premisa de `pinouts.json` como "fuente canónica derivada del .ino")
queda clasificada `CONTRACT_PREMISE_INACCURATE` sin impacto en el diseño de Fase 1, porque el
propio brief (§8.2, §18.6) ya ordena preservar el contrato actual sin generalizarlo.

---

*(Referencia al target: brief §24 exige este documento con mapa de módulos, flujo, responsabilidades,
fuentes de verdad actuales, código reutilizable, acoplamientos, riesgos, puntos de extensión,
respuesta a las 7 preguntas y comparación in-process/sidecar. Ver `PHASE_1_ENTRY_DECISIONS.md`,
`PROJECT_ENGINE_PLACEMENT_EVIDENCE.md` y `LOCAL_TRANSPORT_EVIDENCE.md` para las piezas que este
documento referencia sin repetir.)*
