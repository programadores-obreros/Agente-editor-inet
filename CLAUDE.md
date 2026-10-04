# CLAUDE.md — Tecnia Bot

Este repo está escrito en español y su público son docentes y alumnos de escuelas
técnicas argentinas. **Todo lo que escribas —código, comentarios, mensajes de commit,
skills, fichas— va en español rioplatense**, con el tono directo y calmo que ya tiene
el repo. No lo cambies por uno más neutro ni más solemne.

## Misión

Tecnia Bot es un agente conversacional (corre sobre OpenCode) que ayuda a armar
proyectos de electrónica/programación con alumnos y docentes: arma el circuito
(`proyecto-fisico`/`vista-fisica`), genera y compila el firmware (`platformio`), y
sostiene memoria de progreso por sesión. Este CLAUDE.md es la doctrina de **desarrollo**
del repo — no el prompt del bot (ese es `opencode/agent/tecnia-bot.md`, auditado aparte,
no se toca acá).

## Precedencia: una sola voz normativa

Las sesiones de desarrollo arrancan desde la raíz de `tecnia-bot/`. Si la sesión se abrió
desde otro repo (por ejemplo, el checkout de OpenCode), las reglas de ese repo no aplican acá.

| Fuente | Qué es | ¿Crea doctrina? |
|---|---|---|
| Código + tests + CI | La realidad ejecutable y el enforcement | Es lo que la doctrina describe y protege |
| Este `CLAUDE.md` | La única doctrina textual normativa del desarrollo | Sí |
| `.claude/rules/*.md` | El detalle, por ruta, de una regla de este archivo | Sólo el detalle de lo que este archivo ya establece |
| Docs de arquitectura (`docs/programacion-intencion/`) | Especificación y referencia | Sólo lo que este archivo o un test adopta |
| Skills de desarrollo (`.claude/skills/`) | Procedimientos | No |
| Engram, auto-memory, informes en `~/tecnia-bot-docs` | Memoria y evidencia | No |
| Gentle AI (SDD, judgment-day, revisores) | Herramientas opcionales, sólo si se invocan | No |
| Hooks | Enforcement de normas que ya están acá | No |
| Preferencias globales (`~/.claude/`) | Preferencias personales de trabajo | No para este repo |
| `opencode/agent/tecnia-bot.md` + `opencode/skills/` | Gobiernan la experiencia del alumno | No para el desarrollo: son código bajo prueba |

- Si el texto contradice al código, a los tests o a CI, no se elige en silencio: se corrige
  el texto o se abre la decisión. Una implementación vieja no se convierte en decisión de
  arquitectura por el solo hecho de existir.
- **Memoria no es norma.** Si una memoria contradice este archivo, una rule, un test o CI,
  la memoria está desactualizada.
- Cada regla vive en un solo lugar; en los demás va un puntero.
- Para probar el bot como lo ve el alumno, sin el contexto de desarrollo:
  `scripts/producto-local.sh` (perfil aislado).

## Arquitectura esencial

- **CURRENT** (verificado en código): el Project Engine vive en
  `opencode/nucleo/{ir.ts,motor.ts}` — IR puramente declarativa (`Componente`,
  `Conexion`, `ComportamientoRegla`, sin I/O), mutada transaccionalmente por
  `crearMotorDeProyecto` (clona → aplicadores puros → valida → commit persiste-primero).
  La vista física (`opencode/vista-fisica/*`) proyecta esa IR a HTML/canvas. El agente
  expone esto vía los tools `proyecto-fisico`/`vista-fisica`. `circuito.ts` (Wokwi/HTML
  standalone) es **LEGACY FROZEN**: sigue funcionando y es la única fuente de pines para
  las piezas que el catálogo de `nucleo` todavía no cubre (láminas y proyectos
  integradores incluidos); para las piezas que el catálogo sí cubre, la verdad es
  `proyecto-fisico`. No se le agregan piezas ni conocimiento nuevo; la convergencia con
  el catálogo es posterior e incremental.
  `platformio.ts` compila/flashea/diagnostica de forma determinista; **no genera**
  `platformio.ini`/`main.cpp` — eso es responsabilidad del LLM vía prompt/skill
  (`docs/programacion-intencion/CURRENT-ARCHITECTURE.md:213-216`). No hay daemon, ni
  WebSocket, ni segundo proceso: el único proceso persistente es el TUI local de
  OpenCode (`CURRENT-ARCHITECTURE.md:124-127`).
- **TARGET** (decidido, no todo implementado): ver
  `docs/programacion-intencion/TARGET-ARCHITECTURE.md` (resumen implementable del
  target cerrado), `IR-SPEC.md` (especificación formal de la IR) y `BOARD-CONTRACT.md`/
  `COMPONENT-CATALOG.md` (contrato de placas y catálogo de componentes).
- **PROPOSED / NOT IMPLEMENTED** ("Modo Vivo", comunicación en vivo con la placa): ver
  `docs/programacion-intencion/LIVE-MODE.md` — cada documento de esa serie lleva su
  propio banner de estado. No lo des por construido.

> **Nota de mantenimiento**: `CURRENT-ARCHITECTURE.md` describe la Fase 0, previa a
> `proyecto-fisico.ts`/`vista-fisica.ts`. Su §4 ("9 tools") ya no coincide con los 11
> archivos reales de `opencode/tool/` — es un desfasaje de documentación conocido, no
> un bug de código.

## Invariantes (no se recortan, son la tesis del repo)

**Un OK falso es peor que un error.** Está aplicado en código, no sólo declarado:
`clave.ts` nunca guarda una key sin probarla antes contra Google; `uninstall.ps1` relee
después de borrar y sólo afirma lo que comprobó; `bootstrap.ps1` no confía en un exit
code, vuelve a mirar el disco. Cuando algo informa un resultado al docente, preguntate
si puede decir "listo" sin haberlo verificado — si puede, está mal.

**El instrumento se revisa DOS veces**: antes de medir y antes de reportar.

| Momento | Pregunta | Qué se chequea |
|---|---|---|
| ANTES de medir | ¿el instrumento **PUEDE** medir? | las precondiciones |
| ANTES de reportar | ¿el instrumento **MINTIÓ**? | el resultado |

Precondiciones que más veces faltaron (generales; el detalle VM/Windows está en
`.claude/rules/vm-windows-precondiciones.md`, path-scoped): lo que empujaste a un
entorno de prueba sigue ahí, el caché está limpio, estás en el perfil correcto, el
estado inicial es el que creés, el usuario puede escribir donde le pedís, lo que vas a
descartar es descartable.

Mentiras típicas del instrumento, ya vistas en producción:

| Lo que medí | Lo que estaba midiendo en realidad |
|---|---|
| `cmd \| tail; echo $?` | el exit code del `tail`, no el del comando |
| `/^X$/.test("X\n")` | creí que `$` matchea antes de un newline final — eso es Python, no JS (en JS sin flag `m` da `false`) |
| `Test-Path auth.json` | el archivo sigue existiendo: lo correcto es mirar si quedó el bloque `google` |

Reglas concretas: exit codes sin pipe; nunca `sleep` a ciegas, esperar un centinela
escrito por el proceso; verificar QUÉ build se está probando antes de concluir; el
assert mide el mundo, no el reporte del mundo.

**Los tests se verifican por mutación**: rompé a propósito la línea que el test dice
proteger y confirmá que se pone rojo. Si sigue verde, el test es un adorno (antecedente:
seis tests huecos en v0.3.69, `CHANGELOG.md` sección `[0.3.69]`). Varios archivos de `tests/` llevan en
su encabezado la historia de cómo fallaron la primera vez. Eso es a propósito: **cuando
arregles un test hueco, dejá escrito por qué era hueco**, o alguien lo va a "simplificar"
de vuelta.

**Los guards se prueban a sí mismos**: un chequeo que nunca puede fallar da falsa
tranquilidad (antecedente: `tests/modelo.test.mjs` buscaba un prefijo de key que no
existía en todo el árbol). Todo guard nuevo viene con un test que prueba que marca lo
que tiene que marcar — ver `tests/seguridad-proyectos.test.mjs` como modelo.

**El número de artefactos no es la métrica** — lo que hay que minimizar es HALLAZGOS
FALSOS REPORTADOS, no la cantidad de cosas encontradas al mirar con cuidado.

**Leé el `--help` completo** antes de concluir que una herramienta no cumple lo que
promete — puede estar en un modo por defecto documentado (`--dry-run` en vez de
`--apply`).

## Workflow

### Verificación — los tres comandos, siempre

> `SOURCE INCONSISTENCY / HUMAN DECISION REQUIRED`: el título dice "los tres comandos"
> pero el bloque de abajo lista cuatro. Así está en el original
> (`tecnia-bot/CLAUDE.md:10`) — no se resuelve acá, se conserva tal cual el título.

```bash
pnpm test              # node --test tests/*.test.mjs
pnpm typecheck          # tsc --noEmit -p tsconfig.json
pnpm fichas:check       # las 17 hojas contra MANIFEST.sha256
pnpm seguridad:check    # bloque de seguridad en los proyectos INET
```

**Los tres primeros van en verde antes de cada commit. Si algo queda rojo, se para y se
reporta — no se commitea rojo.** `pnpm seguridad:check` es un chequeo de naturaleza
distinta: **corta el PR** (ver `.claude/rules/seguridad-fisica-inet.md`), no el commit
local — son dos mecanismos de enforcement distintos, no se fusionan. El gestor es
**pnpm** (`pnpm@11.3.0`), no npm ni yarn. Los tests no corren en paralelo entre sí (rutas
temporales fijas, ver `tests/circuito.test.mjs`); si delegás a varios agentes, que editen
en paralelo pero que la suite la corra uno solo, serializada.

### Antes de `git checkout`/`restore`/`clean`: mirá qué vas a descartar

Un `M` en `git status` es trabajo sin commitear, no ruido de fondo. La pregunta es
"¿por qué está sucio?", no "¿está sucio?". Commiteá antes de mutar archivos a propósito
(mutation testing) — sin un commit previo, restaurar y destruir son la misma
herramienta.

### `odd/` es andamio, no producto — POLÍTICA

El trabajo sustancial lleva un documento de seguimiento en `odd/tasks/<nombre>.md`, que
**no se commitea**. La regla completa vive en `.claude/rules/odd-andamio.md`.

### Costura de ramas: por verificabilidad, no por tema ni por líneas

El criterio general, que vale para todo el repo (no sólo `installer/`, ver
`.claude/rules/vm-windows-precondiciones.md` para el caso concreto): **la costura de las
ramas va por verificabilidad, no por tema ni por líneas. Lo probado avanza; lo no
probado espera solo, sin llevarse nada puesto.**

### Seguridad física, `installer/`, VM/Windows

Movidas a rules path-scoped — ver `.claude/rules/seguridad-fisica-inet.md`,
`.claude/rules/installer-iss.md`, `.claude/rules/vm-windows-precondiciones.md`. No
residentes salvo que estés tocando esas rutas.

### Publicar una versión / PRs encadenadas

Ver `docs/publicar-release.md`, `docs/prueba-rc.md`, `docs/rollback.md`. Para cadenas de
PRs: nunca `--delete-branch` hasta que toda la cadena esté mergeada (cierra las PRs que
tienen esa rama como base, no las reapunta) — ver skill global `chained-pr`.

## Commits

Conventional commits **en español**, con el cuerpo contando el porqué: qué estaba mal,
qué incidente real lo originó si lo hubo, y **qué quedó sin verificar**. Si no lo probaste,
el commit dice "no lo probé", nunca "debería andar".

Nunca agregues `Co-Authored-By` ni ninguna atribución de IA.

## Referencias

- `docs/programacion-intencion/` — documentación vigente (KEBAB-CASE) e histórica
  (`PHASE_N_...`, SNAKE_CASE).
- `.claude/rules/*.md` — reglas path-scoped (ver arriba).
- `.claude/skills/freeze-trazabilidad/`, `.claude/skills/validacion-vm-windows/` —
  workflows reutilizables extraídos de este documento.
- `opencode/agent/tecnia-bot.md` — auditado aparte; este CLAUDE.md no lo gobierna.
- Detalle completo (sin recortes): política de `odd/` → `.claude/rules/odd-andamio.md` (path `odd/**`); publicar versión y PRs encadenadas → `docs/OPERACIONES-REPO.md`; tabla completa "¿el instrumento mintió?" → skill `validacion-vm-windows` (anexo).
