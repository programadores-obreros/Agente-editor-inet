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

### 1. Que el docente desinstale Tecnia Bot e instale la versión vieja

Es lo primero y casi siempre alcanza. Los releases viejos **no se borran**:

```
https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.69
```

Son dos pasos, en este orden:

1. Menú inicio → **"Desinstalar Tecnia Bot"**. Cuando pregunte por los datos
   personales, **"No"**: así se conservan el perfil, la memoria del aula y la key.
2. Bajar el `.exe` de esa dirección e instalarlo.

**Hay que desinstalar primero; instalar el `.exe` viejo encima no alcanza.** Este
documento decía las dos cosas a la vez —"no hace falta desinstalar nada" y, tres
renglones más abajo, "desinstalá primero"—, y la que vale es la segunda. Un
`.exe` viejo no sabe limpiar los archivos que sumó una versión más nueva: copia
lo suyo arriba y deja mezcladas piezas de las dos versiones. El instalador
**actual** borra su copia de `opencode` antes de copiar (`[InstallDelete]` en
`installer/tecnia-bot.iss`), pero eso protege cuando el `.exe` que
se corre es uno que ya trae esa línea — y en un rollback el que se corre es el
viejo, que no la tiene.

"Desinstalar Tecnia Bot" saca sólo Tecnia Bot. **No** toca OpenCode, Scoop,
Python ni PlatformIO, así que no es el "empezar limpio" que se desaconseja más
abajo.

Un costo a tener presente: volver a la 0.4.8 o a una anterior devuelve el
instalador de antes de la reparación. Su última pantalla dice "quedó instalado"
siempre, haya salido como haya salido, y su desinstalador no avisa si el borrado
de los datos personales falló.

**Nota (Phase 2, packaging, D14/INST-1=D):** para volver a una versión
anterior, desinstalá primero. Un `.exe` viejo no sabe limpiar las piezas que
sumó una versión más nueva (`opencode/nucleo`, `opencode/servidor`,
`opencode/vista-fisica`), así que instalarlo encima puede dejar mezcladas
piezas de las dos versiones. Desde el menú inicio: `Desinstalar Tecnia Bot`,
y recién ahí instalar el `.exe` de la versión vieja.

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
`/actualizar` —tenga la rota o una intermedia— queda con la capa de la v0.3.69.

**No es lo mismo que el paso 1**, y antes este documento decía que sí. Lo que
hace `/actualizar` hoy (`install/update.ps1`):

- Baja el fuente de ese release, verifica que sea esa versión y **reemplaza**
  las carpetas `opencode\` e `install\` de la copia del programa: no copia
  encima, así que no quedan archivos de la versión rota mezclados. Después corre
  el instalador de la capa **del release al que se volvió**.
- **No cambia** OpenCode, Python, PlatformIO ni Node: quedan en la versión que
  dejó la rota. Si lo que se rompió fue la versión fijada de alguno de esos,
  `/actualizar` no lo arregla: hace falta el paso 1.
- **No cambia** el desinstalador ni los accesos directos, que son del `.exe`. Y
  el lanzador (`abrir-tecnia-bot.cmd`) no lo reemplaza mientras haya una ventana
  de Tecnia Bot abierta con él: avisa y lo deja.
- `/actualizar` lo atiende el modelo. **Si la versión rota dejó al bot sin
  contestar, `/actualizar` tampoco contesta.** Ahí queda el paso 1, o correr el
  actualizador a mano: `powershell -NoProfile -ExecutionPolicy Bypass -File
  "%LOCALAPPDATA%\TecniaBot\install\update.ps1"`.

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
- **No desinstalar OpenCode, Scoop, Python ni PlatformIO de la máquina del
  docente para "empezar limpio".** La regla del instalador vale también acá:
  PUEDE FALLAR, PERO NO PUEDE ROMPER. Una notebook que andaba quedó sin OpenCode
  por un `scoop uninstall` puesto con buena intención. ("Desinstalar Tecnia Bot",
  el del paso 1, es otra cosa: saca sólo Tecnia Bot.)

## Cómo saber si la nueva está bien, sin esperar a que se queje alguien

CI corre un smoke test de instalación silenciosa en cada tag. Si ese falla, el
`.exe` ni se adjunta al release y no hay nada que revertir. Ojo con lo que ese
test mide: instala con `/skipdeps=1`, o sea que comprueba que el `.exe` copia
los archivos y crea el acceso directo, **no** que OpenCode y PlatformIO se
instalen. Eso lo corre aparte el job "Instalador real" de `ci.yml`.

```bash
gh run list --workflow=build-installer.yml --limit 3
```

Y en una máquina de verdad, lo mínimo:

1. La última pantalla del instalador dice **"¡Tecnia Bot quedó instalado!"** (y
   no "incompleto" ni "NO quedó instalado").
2. El acceso directo abre y el bot responde.
3. Probar **lo que esa versión dice que arregló**: está en su entrada del
   `CHANGELOG`. (Acá había un paso fijo —pedir la ficha «de corriente alterna»—
   que era lo que arreglaba la v0.3.69. Quedó escrito como si valiera para todas.)
4. Pedirle un circuito y confirmar que **no** abre el navegador solo.
5. Menú inicio → "Diagnostico de Tecnia Bot": tiene que dejar el `.txt` y
   decir dónde quedó.

El guion completo, con hardware, es [`prueba-rc.md`](prueba-rc.md).
