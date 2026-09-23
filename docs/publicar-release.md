# Publicar una versión

**Empezá acá.** Este documento es la secuencia completa; los otros dos son las puntas:

| Cuándo | Documento |
|---|---|
| **Antes** de publicar, probar el `.exe` en una notebook real | [`prueba-rc.md`](prueba-rc.md) — 12 pasos |
| Si el cambio toca el **instalador o el desinstalador** | [`prueba-desinstalador-vm.md`](prueba-desinstalador-vm.md) |
| **Después**, si salió mal | [`rollback.md`](rollback.md) |

El medio —el bump, el commit, el tag— vivía sólo en la memoria de quien lo hizo la vez
anterior. Está acá para que no dependa de eso.

## Qué número le toca

No hay política escrita más allá de esto, y alcanza:

- **patch** (`0.4.1` → `0.4.2`): arreglos, correcciones de documentación, cosas internas.
- **minor** (`0.4.2` → `0.5.0`): el bot aprendió a hacer algo que antes no hacía.
  El precedente es la 0.4.0, cuyo commit lo dice: *"salto de minor porque el bot aprendió
  a dibujar una placa nueva"*.

## Los cuatro archivos, y nada más

**`VERSION` es la fuente de verdad**, porque es la que lee el workflow que produce el
`.exe` que instala el docente. Las otras tres la copian:

| Archivo | Qué cambiar |
|---|---|
| `VERSION` | el número solo |
| `package.json` | el campo `version` |
| `README.md` | el anuncio que empieza con 🚀 **vX.Y.Z**, reescrito entero |
| `CHANGELOG.md` | entrada nueva debajo de `## [Unreleased]`, que queda vacío |

`tests/version.test.mjs` verifica que las cuatro digan lo mismo. **Existe porque en agosto
de 2026 había cuatro fuentes y tres mentían durante siete versiones**, sin romper nada —
el workflow siempre pasó la buena. Un defecto que no rompe nada no se arregla solo.

**Lo que NO hay que tocar, y por qué:**

- `installer/tecnia-bot.iss` — recibe la versión por `/DMyAppVersion`. No tiene default a
  propósito: un default se queda viejo en silencio y produce un `.exe` que miente.
- `.github/workflows/build-installer.yml` — lee `VERSION` en runtime.
- `install/OPENCODE_VERSION` y `install/PYTHON_VERSION` — son pines de OpenCode y de
  Python, independientes de la versión del bot. Sólo se tocan si se decide subirlos.
- El badge de versión del README — es dinámico de shields.io, se actualiza solo.

## La entrada del CHANGELOG es lo que lee el docente

No es un registro interno: **es el texto que termina en la página de versiones del sitio
público**, porque el sitio lee las notas de la release desde la API de GitHub y esas notas
salen de acá (ver más abajo).

Escribila para el docente, no para el repo:

- Una frase en negrita arriba con **qué cambió para él**, no qué archivo se tocó.
- `### Agregado` y `### Corregido` con el **porqué**: qué pasaba antes, por qué importaba.
- Los números y las fuentes cuando los haya.
- Lo interno va al final, en su propia sección, y se nombra como interno.

Mirá la entrada de la `[0.4.2]` como referencia de tono y de largo.

## La secuencia

```bash
# 1. rama y commit — UN commit, los cuatro archivos
git checkout main && git pull
git checkout -b release/0.4.2
#    ... editar los cuatro archivos ...
pnpm test && pnpm typecheck && pnpm fichas:check && pnpm seguridad:check
git add CHANGELOG.md VERSION package.json README.md
git commit    # chore(release): 0.4.2 — <gancho corto, con emoción, no changelog seco>

# 2. PR y merge
git push -u origin release/0.4.2
gh pr create --base main --head release/0.4.2 --title "<el mismo del commit>"
gh pr merge <N> --merge

# 3. TAG, pegado al merge — y sobre el COMMIT DE MERGE, no sobre el chore(release)
git checkout main && git pull
git tag -a v0.4.2 -m "v0.4.2 — <el mismo gancho>"
git push origin v0.4.2

# 4. mirar que el CI haya quedado verde
gh run list --workflow=build-installer.yml --limit 3
gh release view v0.4.2      # tienen que estar el .exe, el SHA256SUMS.txt y LAS NOTAS
```

> **Si `gh` dice *"No default remote repository has been set"***: `gh repo set-default
> programadores-obreros/Agente-editor-inet`. Queda guardado en el `.git/config` local.

### El tag va sobre el commit de merge

Verificable en el historial: el tag `v0.4.1` apunta al merge, no al `chore(release)`. Es
la convención del repo y conviene sostenerla para que el tag señale lo que realmente
quedó en `main`.

### Y va PEGADO al merge. Esto no es prolijidad

El splash del bot lee `VERSION` **de la rama `main`** y avisa *"Hay una version nueva
(vX.Y.Z) — escribi /actualizar"*. Pero `/actualizar` sigue el **release marcado Latest**.

**Entre el merge y el tag, el docente ve "hay una versión nueva" y `/actualizar` le
contesta "ya estás en la última".** En la 0.4.1 el tag salió siete segundos después del
merge; esa ventana es la que hay que mantener corta. Si por algo no vas a taguear en el
momento, no mergees todavía.

## Qué hace el CI al ver el tag

`build-installer.yml` se dispara con cualquier tag `v*` y:

1. Lee `VERSION` y **falla si el tag no coincide**.
2. Compila el `.exe` con Inno Setup pasándole `/DMyAppVersion`.
3. **Smoke test real**: instalación silenciosa, y verifica que queden el agente y el acceso directo.
4. Verifica que la copia **instalada** —no la del repo— parsee en PowerShell 5.1 real.
5. Calcula el SHA256 y lo escribe en `SHA256SUMS.txt`. **Esto hace falta porque el
   instalador no está firmado**: es la única forma que tiene el docente de verificar
   integridad.
6. Genera las notas con `node scripts/notas-release.mjs`, que extrae del `CHANGELOG` la
   sección de esa versión, y **adjunta `.exe` + `SHA256SUMS.txt` + notas** al release.

**El `.exe` no está firmado.** En Windows 11 con Control Inteligente de Aplicaciones
activado, eso bloquea la instalación sin opción de saltear. Solicitud a SignPath
Foundation en trámite.

## Las notas del release: por qué son automáticas

Hasta la 0.4.2, **todos los releases salieron con el cuerpo vacío**. Comprobable:

```bash
gh api repos/programadores-obreros/Agente-editor-inet/releases/tags/v0.4.1 --jq '.body'
```

Y eso no era sólo una página de GitHub fea: **el sitio público lee las notas desde la API
de GitHub en el build**. El `CHANGELOG` estaba bien escrito y no viajaba a ningún lado que
el docente viera.

Por eso las notas **no dependen de que alguien se acuerde de pegarlas**: el workflow las
extrae del `CHANGELOG` y falla si no encuentra la sección de esa versión. Preferimos no
publicar antes que publicar mudo.

Para verlas antes de taguear: `pnpm notas:release`.

## El sitio público, después

El sitio vive en otro repo (`sgi-plataforma/tecnialab-web`, Astro) y **lee las versiones de
la API de GitHub en el build** — ahí no se escribe ninguna versión a mano, y el botón de
descarga apunta a `releases/latest/download/...`, así que se actualiza solo.

Lo único que hay que hacer es **volver a publicarlo después de que exista el release**:

```bash
cd ../sgi-plataforma/tecnialab-web
pnpm deploy     # build + verificar-versiones + firebase deploy
```

El orden importa: `pnpm deploy` corre `scripts/verificar-versiones.mjs`, que **corta el
deploy** si la página de versiones salió vacía porque no pudo leer las releases. Si
desplegás antes de publicar el release, no rompés nada — simplemente no se despliega.

## Si algo salió mal

[`rollback.md`](rollback.md). El orden de ahí importa: **primero** que el docente pueda
instalar la versión vieja, **después** sacar la rota de "Latest" (con eso `/actualizar`
deja de ofrecerla), y **recién ahí** revertir el código con `git revert` — nunca
`reset --hard` ni force-push.
