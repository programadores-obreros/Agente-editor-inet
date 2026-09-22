# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Este repo está escrito en español y su público son docentes y alumnos de escuelas
técnicas argentinas. **Todo lo que escribas —código, comentarios, mensajes de commit,
skills, fichas— va en español rioplatense**, con el tono directo y calmo que ya tiene
el repo. No lo cambies por uno más neutro ni más solemne.

## Verificación — los tres comandos, siempre

```bash
pnpm test          # node --test tests/*.test.mjs
pnpm typecheck     # tsc --noEmit -p tsconfig.json
pnpm fichas:check  # las 17 hojas contra MANIFEST.sha256
pnpm seguridad:check   # bloque de seguridad en los proyectos INET
```

**Los tres primeros van en verde antes de cada commit. Si algo queda rojo, se para y se
reporta — no se commitea rojo.** El gestor es **pnpm** (`pnpm@11.3.0`), no npm ni yarn.

Los tests **no se pueden correr en paralelo entre sí**: usan rutas temporales con nombre
fijo (`os.tmpdir()/tecniabot-test-work` en `tests/circuito.test.mjs`, y otras análogas).
Dos corridas simultáneas se pisan y dan rojos falsos. Si delegás trabajo a varios agentes
a la vez, que editen en paralelo pero que la suite la corra uno solo, serializada.

## La regla que atraviesa todo el repo: un OK falso es peor que un error

Está aplicada en el código, no sólo declarada, y hay que mantenerla:

- `clave.ts` nunca guarda una key sin probarla antes contra Google.
- `uninstall.ps1` relee después de borrar y **sólo afirma lo que comprobó**.
- `bootstrap.ps1` no confía en un exit code: vuelve a mirar el disco.

Cuando escribas algo que informa un resultado al docente, preguntate si puede decir
"listo" sin haberlo verificado. Si puede, está mal.

## Los tests se verifican por mutación antes de darlos por buenos

En la v0.3.69 aparecieron **seis tests que pasaban en verde sin probar nada**
(`CHANGELOG.md:216`). Desde entonces la práctica es: rompé a propósito la línea que el
test dice proteger y confirmá que se pone **rojo**. Si sigue verde, el test es un adorno.

Varios archivos de `tests/` llevan en su encabezado la historia de cómo fallaron la
primera vez. Eso es a propósito: **cuando arregles un test hueco, dejá escrito por qué
era hueco**, o alguien lo va a "simplificar" de vuelta.

## Los guards se prueban a sí mismos

Un chequeo automático que nunca puede fallar es peor que no tenerlo, porque da falsa
tranquilidad. El caso testigo: `tests/modelo.test.mjs` barría el repo buscando keys con
prefijo `AQ.` y **en todo el árbol no había un solo literal con esa forma** — el guard
no pudo fallar ni una vez, mientras el formato que el repo documenta (`AIzaSy...`) le
pasaba por al lado.

Por eso todo guard nuevo viene con un test que prueba que **marca lo que tiene que
marcar**, no sólo que pasa sobre lo que ya está bien. Ver `tests/seguridad-proyectos.test.mjs`
como modelo.

## Seguridad física en los proyectos INET

Todo proyecto de `opencode/skills/proyectos-inet/proyectos/` que tenga **partes móviles,
calor o red eléctrica** lleva el bloque canónico, justo antes de `## Los niveles`:

```markdown
## Seguridad con <lo que sea> ⚠️
> ⚠️ **SEGURIDAD:** <mecanismo concreto>, <momento de peligro>, <acción que lo evita>.
```

Si el proyecto dispara el detector pero el riesgo **no existe de verdad** (por ejemplo,
menciona `Servo.h` sólo dentro de una lista de mitos de librerías), lleva una exención
explícita con su motivo:

```markdown
<!-- sin-riesgo-fisico: <por qué no aplica> -->
```

**Una exención sin motivo no cuenta** — sería un silenciador con otro nombre, y el guard
la rechaza. `pnpm seguridad:check` corta el PR si falta alguna de las dos cosas.

El molde de redacción es `11-brazo-robotico.md`: nombra el mecanismo, el momento y la
acción. Nada de "tené cuidado".

## `odd/` es andamio, no producto — POLÍTICA

Cuando un trabajo es sustancial (varios pasos coordinados, o progreso que valdría la
pena recuperar si se corta la sesión), se crea un documento de seguimiento en
`odd/tasks/<nombre-del-trabajo>.md` con el objetivo, el alcance autorizado, la lista de
tareas, la verificación de cada una y el próximo paso.

**Ese documento NO se commitea.** Está en `.gitignore` a propósito.

Por qué: es andamio del proceso, no producto. Lo que tiene que sobrevivir del trabajo es
**el código, sus tests y el mensaje del commit** — y por eso los mensajes de commit de
este repo son largos y cuentan el porqué, el incidente que originó el cambio y qué quedó
sin verificar. Esa es la memoria que se lee dentro de seis meses; un tablero de tareas a
medio tachar, no.

La copia de recuperación del documento va a Engram bajo el topic `odd/<nombre>/tasks`,
que es lo que permite retomar después de una interrupción sin depender del working tree.

**Esta decisión ya está tomada. No la vuelvas a discutir cada sesión.** Si alguna vez hay
que cambiarla, se cambia acá, con el motivo escrito al lado.

## Lo que no se toca sin poder probarlo

`installer/` es Inno Setup y PowerShell: **no se puede verificar desde Linux**. Un cambio
ahí se commitea con lo que sí se comprobó (sintaxis, balance de bloques, que los tests
que leen el `.iss` sigan pasando) y **queda retenido hasta probarlo en la VM win10 con el
`.exe` real**. Nunca se publica un cambio de instalador que nadie vio funcionar.

El criterio general, que vale para todo el repo: **la costura de las ramas va por
verificabilidad, no por tema ni por líneas. Lo probado avanza; lo no probado espera solo,
sin llevarse nada puesto.**

Hay una excepción acotada y vale entenderla: un validador **fail-closed** —una whitelist
que sólo puede rechazar entrada y nunca hace ejecutar algo distinto— sí se puede agregar
sin poder probarlo en la plataforma destino, porque el peor caso es rechazar algo válido.
Un "arreglo" que cambia lo que se ejecuta, no.

## Commits

Conventional commits **en español**, con el cuerpo contando el porqué: qué estaba mal,
qué incidente real lo originó si lo hubo, y **qué quedó sin verificar**. Si no lo probaste,
el commit dice "no lo probé", nunca "debería andar".

Nunca agregues `Co-Authored-By` ni ninguna atribución de IA.
