# Phase 2 Slice 1 — contrato de instalación (D12-D14)

Complemento de `PHASE_2_SLICE_1_HARDENING_DESIGN.md` (§1, tabla D12-D14; §4, gate de
instalación aislada) y del informe `ARCH-INSTALL/ARCH_INSTALL_REPORT.md`. Corto, a
propósito: describe el CONTRATO de instalación resultante, no repite el análisis.

## Qué se instala, y dónde

`install/install.sh`/`install.ps1` publican `opencode/` a la config global de OpenCode
(`$XDG_CONFIG_HOME/opencode` o `$HOME/.config/opencode`, `%USERPROFILE%\.config\opencode`
en Windows). Con D12, esa publicación incluye tres carpetas nuevas, **hermanas de
`tool/`, nunca adentro**:

```
$CONFIG_DIR/
├── agent/  tool/  skills/  command/  plugins/  themes/  tecniabot-web/   (ya existían)
├── nucleo/           ← opencode/nucleo/**       (incluye nucleo/adaptadores/)
├── servidor/         ← opencode/servidor/**
└── vista-fisica/      ← opencode/vista-fisica/** (incluye vista-fisica/web/)
```

Por qué hermanas y no dentro de `tool/`: el registry de tools de OpenCode
(`packages/opencode/src/tool/registry.ts`) levanta como tool CUALQUIER `.ts`/`.js` que
encuentre en el nivel superior de `tool/`. Si `nucleo`/`servidor`/`vista-fisica`
quedaran ahí adentro, el registry trataría sus módulos internos como tools propias.

Las dos carpetas se suman al manifiesto (`NUEVOS`/`$Nuevos` en install.sh/install.ps1)
y a la limpieza de directorios vacíos de `uninstall.sh`/`uninstall.ps1`. El borrado de
archivo por archivo ya era manifest-driven (recorre el manifest línea por línea), así
que no necesitó cambios — sólo la limpieza de las carpetas que quedan vacías.

`update.sh`/`update.ps1` y `bootstrap.sh`/`bootstrap.ps1` no enumeran carpetas: delegan
en `install.*`, así que heredan el cambio solos.

`installer/tecnia-bot.iss` ya empaquetaba `opencode/*` completo (incluidas estas tres
carpetas) dentro de `{app}\opencode` — esa copia es la fuente MAESTRA desde la que
`install.ps1` publica a `$CONFIG_DIR`, no la instalación en sí. No necesitó ningún
cambio para D12.

## Qué NO se instala

- Nada fuera de `opencode/`: `docs/`, `tests/`, `scripts/`, evidencia, scratchpad.
  Ni `install.*` ni el `.iss` los tocan.
- Dentro de `nucleo/`/`servidor/`/`vista-fisica/`: sólo lo que ya vive en esas
  carpetas del repo (código `.ts`, y en `vista-fisica/web/` los assets `.js`/`.html`
  servidos). El test de packaging (`tests/empaquetado-instalado.test.mjs`) verifica
  esto con un allowlist de extensiones sobre una instalación real.
- `<proyecto>/.tecnia-vista-fisica/`: dato del ALUMNO (estado persistido del motor),
  nunca se instala ni se toca al desinstalar.
- `@opencode-ai/plugin`: es una dependencia npm, no capa educativa — nunca se copia.
  OpenCode se la instala solo a cada `$CONFIG_DIR/node_modules` al arrancar
  (`config.ts`, `npmSvc.install`) y recién ahí el registry importa las tools.

## Cómo se resuelven los imports y los assets

Todo, siempre, con rutas RELATIVAS al propio módulo — nunca al cwd, nunca al repo:

- `tool/vista-fisica.ts` importa `../servidor/*` (ver "Comportamiento lazy" abajo) y
  `../nucleo/composicion-raiz.ts` (sólo como tipo — se borra en runtime).
- `servidor/servicio-con-vista.ts`/`servidor-proyecto.ts` importan `../nucleo/**`.
- `servidor-proyecto.ts` resuelve `vista-fisica/web/` y `tecniabot-web/` con
  `fileURLToPath(import.meta.url)` — portable a Windows (unidad de disco, `%20`,
  Unicode), a diferencia de `new URL().pathname`.
- Ninguna de estas piezas importa nada del `node_modules` del repo salvo
  `@opencode-ai/plugin` (sólo en `tool/vista-fisica.ts`) — todo lo demás son
  builtins de `node:` y rutas relativas propias.

Consecuencia: mientras las tres carpetas queden instaladas como hermanas de `tool/`
dentro del MISMO `$CONFIG_DIR`, la resolución funciona sin importar dónde esté el repo,
con qué cwd se abrió OpenCode, o si el repo sigue existiendo.

## Comportamiento lazy (D13)

`tool/vista-fisica.ts` NO importa `../servidor/*` como valor en el nivel superior del
archivo — lo carga con `await import()`, adentro de una función (`cargarServidor()`),
recién cuando alguien pide abrir la vista física (`obtenerServidorVistaFisica`). Los
`import type` de `ServicioDeProyecto`/`ServidorProyecto` sí se quedan en el top-level:
son sintaxis borrable, no generan ningún `import()` en runtime.

Por qué: el registry de OpenCode importa cada tool de `tool/` en un loop sin `catch`
por archivo. Un `import()` que rechaza en el top-level de UNA tool tira abajo la carga
del registro ENTERO — ninguna tool queda disponible, no sólo la que falló (reproducido
en `ARCH_INSTALL_REPORT.md` §0.2 contra el install de antes de D12). Con la carga
adentro de la función, el import estático de `tool/vista-fisica.ts` nunca toca el disco
de `servidor/`: si esa carpeta falta (instalación incompleta, actualización
interrumpida, o el rollback por overlay del próximo párrafo), sólo esta tool falla, en
el momento en que alguien intenta usarla — con un mensaje que nombra la pieza que falta
("servidor") y sugiere reinstalar, nunca un catch vacío ni un fallback simulado.

## Rollback / downgrade (D14, INST-1=D)

Se adoptó la combinación D13 (arriba) + `[InstallDelete] Type: filesandordirs; Name:
"{app}\opencode"` en `installer/tecnia-bot.iss` + una nota en `docs/rollback.md`.

`[InstallDelete]` borra `{app}\opencode` ENTERO antes de recopiarlo desde `[Files]`, en
cada instalación (nueva o encima de una existente). Es seguro: `{app}\opencode` es sólo
la copia maestra del fuente, nunca donde vive el trabajo del docente (perfil, memoria,
key de Google, y el `nucleo`/`servidor`/`vista-fisica` publicados quedan todos en
`$CONFIG_DIR`, fuera de `{app}` por completo — verificado leyendo el `.iss` y
`install/bootstrap.ps1`). Con esto, cada instalación deja `{app}\opencode` como una
foto exacta del `.exe` que se corrió, nunca una mezcla de versiones — cierra el
escenario "R" de `ARCH_INSTALL_REPORT.md` §4 (rollback por overlay: un `.exe` viejo
instalado encima de uno nuevo dejaba atrás un `tool/vista-fisica.ts` desactualizado
mientras el `NUEVOS`/orphan-cleanup del install viejo borraba `nucleo/servidor/`).

Límite conocido: sólo protege instalaciones hechas CON un `.exe` que ya trae esta
línea. Un downgrade a un `.exe` publicado ANTES de este cambio corre las secciones de
ESE `.exe`, que no tiene `[InstallDelete]`. Por eso `docs/rollback.md` agrega: para
volver a una versión anterior, desinstalá primero.

Deliberadamente NO se construyó staging/swap en `update.*` (opción B del informe
ARCH-INSTALL, descartada por el humano): D13 ya neutraliza el efecto dominó de una
copia a medio actualizar (sólo cae `vista-fisica`, nunca el resto del registry), y el
costo de una migración a staging/swap no se justificaba para lo que queda.

## Cómo se prueba

`tests/empaquetado-instalado.test.mjs` (Linux; en Windows hace skip con un motivo
explícito — `install.ps1` tiene su propia cobertura real en la matriz Windows
PowerShell 5.1 de `.github/workflows/ci.yml`). Instala DE VERDAD con
`bash install/install.sh`, contra una copia fuente `git archive HEAD` (nunca el
worktree sucio), en un `$HOME` temporal con espacio y Unicode, fuera del repo. Después
de instalar, la copia fuente queda inaccesible (`chmod 000`) y todo lo que sigue corre
desde otro cwd. Cubre: presencia y allowlist de las tres carpetas nuevas; import
dinámico de cada tool instalada en loop (como hace el registry real de OpenCode, con un
fallo por archivo reportado); un ciclo de vida real del servidor (GET del HTML y los 6
assets, snapshot con `vista`, POST `AsignarPin` con revisión +1, cierre, recarga y
persistencia en disco); el candado tomado y liberado entre dos procesos de sistema
operativo reales; un escaneo de que `index.html` y los assets no piden nada por red
(D13/offline); el comportamiento con `servidor/` borrado de la instalación (D13); y que
`uninstall.sh` limpia las carpetas nuevas.
