# Volver atrás una versión

Escrito **antes** de que algo salga mal (la primera vez, la víspera de la
v0.3.69), no después. Mañana hay veinte máquinas: si la versión nueva falla, lo
que importa es cuánto se tarda en volver, no de quién fue la culpa.

## La versión a la que se vuelve

| | |
|---|---|
| **Punto seguro: último release confirmado en máquina real** | **v0.3.69** — la instalaron decenas de docentes en la capacitación del 20/08, con un solo problema parcial (PlatformIO en una máquina) |
| Releases posteriores (v0.3.70 en adelante) | validados en la VM de Windows 10, **no** en una notebook de aula |

Ojo con la diferencia: "la anterior" no es lo mismo que "la segura". Todo lo
publicado después de la v0.3.69 se probó en una VM, no en una notebook de
verdad. Si hay que volver corriendo, el punto seguro es la **v0.3.69**, no
simplemente la versión anterior a la rota. (Hasta la v0.3.70 este documento
decía v0.3.62: era el punto seguro de antes de la capacitación del 20/08, y el
CHANGELOG de la v0.3.71 registra el cambio.)

### Lo que hay que saber de la v0.3.78 antes de volver atrás

La v0.3.78 es la primera que **fija la versión de Python con `scoop hold`**. Y
`scoop hold` es una marca en la app, no en Tecnia Bot: **volver a una versión
vieja NO la saca**. La máquina queda con `python 3.14.7 Held package` para
siempre, aunque el Tecnia Bot instalado sea la v0.3.69.

No rompe nada — las versiones anteriores hacen `scoop install python` a secas, y
Scoop contesta "already installed" y sigue. Pero conviene saberlo antes de pasar
media hora buscando por qué esa máquina no actualiza Python como las otras. Para
soltarlo:

```
scoop unhold python
```

Lo mismo vale para `opencode`, que se fija desde mucho antes.

Y al revés, hay un caso donde volver atrás **devuelve** un problema: las máquinas
cuyo usuario de Windows tiene tilde o ñ (`Dirección`, `Preceptoría`, un apellido
acentuado). Ahí PlatformIO se instala en la raíz del disco y las versiones
anteriores a la v0.3.78 no lo encuentran: el bot dice que falta PlatformIO
teniéndolo instalado, y no puede compilar. Es el caso real de la escuela Juana
Manso, contado en `docs/rutas-no-ascii.md`. En esas máquinas, el rollback tiene
costo: conviene agotar otras opciones antes.

## Qué hacer, en orden

### 1. Que el docente instale la versión vieja (30 segundos)

Es lo primero y casi siempre alcanza. Los releases viejos **no se borran**:

```
https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.69
```

Bajar el `.exe` de ahí e instalarlo encima. No hace falta desinstalar nada.

### 2. Sacar la versión rota de "Latest" (2 minutos)

Así el que entra a la página de releases no se lleva la mala (`vX.Y.Z` es la
que falló):

```bash
gh release edit vX.Y.Z --prerelease --latest=false
gh release edit v0.3.69 --latest
```

Esto **no borra** la vX.Y.Z: la saca de la vidriera. Borrar un release es
irreversible y no hace falta.

Y cubre también a los que actualizan desde el bot: `/actualizar` instala lo que
GitHub marca como **Latest** (nunca `main` ni prereleases) y compara la versión
instalada con ese tag, no con "mayor o menor". Después de este paso, quien corra
`/actualizar` —tenga la rota o una intermedia— queda en la v0.3.69. Es la misma
salida que el paso 1, sin bajar el `.exe`.

### 3. Recién ahí, revertir el código

```bash
git revert --no-edit <sha del commit malo>
git push origin main
```

`revert`, no `reset`: el historial queda contando qué pasó. Un `reset --hard`
sobre `main` publicado le rompe el clon a cualquiera que ya haya bajado.

## Lo que NO hay que hacer

- **No borrar el release viejo.** Es la única salida rápida que tiene el docente.
- **No `git push --force` a `main`.** El repo es público.
- **No desinstalar nada de la máquina del docente para "empezar limpio".** La
  regla del instalador vale también acá: PUEDE FALLAR, PERO NO PUEDE ROMPER.
  Una notebook que andaba quedó sin OpenCode por un `scoop uninstall` puesto con
  buena intención.

## Cómo saber si la nueva está bien, sin esperar a que se queje alguien

CI corre un smoke test de instalación silenciosa en cada tag. Si ese falla, el
`.exe` ni se adjunta al release y no hay nada que revertir:

```bash
gh run list --workflow=build-installer.yml --limit 3
```

Y en una máquina de verdad, lo mínimo:

1. El acceso directo abre y el bot responde.
2. Pedirle una ficha de nombre compuesto: **«dame la de corriente alterna»**.
   Es lo que arregló esta versión — si contesta que no la encuentra, volvió el bug.
3. Pedirle un circuito y confirmar que **no** abre el navegador solo.
4. Menú inicio → "Diagnostico de Tecnia Bot": tiene que dejar el `.txt` y
   decir dónde quedó.
