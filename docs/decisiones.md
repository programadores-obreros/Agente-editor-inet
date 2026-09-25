# Decisiones que conviene poder revisar

Las decisiones que se toman con información incompleta, o que cambian si cambia
el contexto. No están acá para justificarse: están para **que alguien pueda
revisarlas más adelante sabiendo qué se pensó en su momento**.

Cada una dice **cuándo volver a mirarla**. Una decisión sin criterio de revisión
no se revisa nunca — se olvida, y después se cambia por la razón equivocada.

---

## D-01 · Las fichas viajan dentro del instalador

**17 de agosto de 2026 · v0.3.40 · abierta**

### Qué se decidió

Las 17 fichas A4 de Tecnia Lab van **adentro del `.exe`**, en
`opencode/skills/fichas/hojas/`. El docente instala y ya las tiene: no descarga
nada aparte, no necesita internet para imprimirlas, no hay un segundo paso donde
perderse.

### Qué cuesta

El instalador **casi se triplicó**:

| Versión | Peso del `.exe` |
|---|---|
| v0.3.39 | 2,63 MB |
| v0.3.40 | **7,44 MB** |

Son 4,81 MB más, que es lo que ocupan los 17 PDF comprimidos por Inno Setup.

### Por qué se decidió así igual

**El público es una escuela técnica, y ahí el problema no es el ancho de banda:
es que el material nunca llega al aula.** Un docente que tiene que bajar el
instalador *y además* encontrar las fichas *y además* descargarlas, en la
práctica se queda sin fichas.

Siete megas se bajan una vez. Un segundo paso se pierde todas las veces.

### Cuándo volver a mirarla

Cualquiera de estas tres alcanza para reabrirla:

1. **Alguien reporta que la descarga es un problema** — una escuela con conexión
   mala, un docente que abandonó a mitad de la bajada. Un caso real vale más que
   cualquier estimación de acá.
2. **El `.exe` pasa de 10 MB.** Con más fichas o más material, el número crece.
   Diez megas es el umbral donde deja de ser "un ratito" y pasa a ser "después lo
   bajo".
3. **Las fichas empiezan a cambiar más seguido que el bot.** Hoy no: son
   estables. Si pasaran a actualizarse todas las semanas, meterlas en el
   instalador obligaría a publicar una versión del producto por cada corrección
   de una hoja, que no tiene sentido.

### La salida, si hay que sacarlas

Concreta, para no tener que pensarla de nuevo:

1. En `installer/tecnia-bot.iss`, excluir la carpeta del `[Files]`:
   ```
   Source: "..\opencode\*"; DestDir: "{app}\opencode"; \
     Excludes: "skills\fichas\hojas\*"; Flags: recursesubdirs createallsubdirs ignoreversion
   ```
2. Publicar `fichas-tecnialab.zip` como **asset del release**, junto al `.exe`.
3. Que el skill `fichas` deje de apuntar a `hojas/` y ofrezca el link de descarga.
   El `SKILL.md` se genera desde `fichas-tecnialab/src/skill-tecnia-bot.mjs`: el
   cambio va ahí, no a mano.

**Lo que se pierde con eso** es lo que hoy la justifica: el docente sin internet
en el aula deja de tener las hojas. Vale la pena sólo si el costo de la descarga
resultó mayor que el de ese segundo paso — y eso se sabe cuando alguien lo
reporta, no antes.

### Un cabo suelto que no es de peso

Tres de las 17 hojas (02 Sensor Shield, 04 servo, 08 téster) usan **fotos de
catálogo comercial sin licencia documentada**, y ahora están en un repositorio
público bajo GPLv3. Se incluyeron por decisión explícita del dueño del proyecto,
con el riesgo planteado.

**No es la misma discusión que el peso**, pero se resuelve en el mismo lugar: si
alguna vez hay que tocar esas tres, la salida barata es cambiarles la foto por
los dibujos originales, que están preservados en el repo `fichas-tecnialab`.

---

## D-02 — El instalador se repara solo, y no le pregunta nada al docente

**Fecha:** 2026-08-17 · **Versión:** v0.3.50

### El problema

OpenCode puede quedar **instalado a medias**: el comando está en el PATH pero no
arranca. Lo deja una descarga cortada, un hash que no da, o un antivirus que
manda el `.exe` a cuarentena. En una escuela con internet flojo no es un caso
raro.

Hasta acá el instalador cortaba y le mostraba al docente dos líneas de PowerShell
para copiar y pegar:

```powershell
scoop uninstall opencode
scoop install opencode
```

Eso ya le pasó a una persona real, en una notebook real, y estuvo un rato largo
creyendo que el problema era su máquina.

### Por qué NO se le pregunta

Se evaluó preguntarle antes de reinstalar. Se descartó por tres razones, en orden
de peso:

1. **El instalador también corre en silencio.** Se lanza con `/VERYSILENT` desde
   Inno Setup. Ahí un prompt no espera respuesta: **cuelga para siempre**, sin
   ninguna ventana donde contestar.
2. **El docente no tiene con qué responder.** "¿Reinstalo OpenCode?" es una
   pregunta que necesita saber en qué estado quedó Scoop. Preguntar algo que la
   otra persona no puede responder no es respeto: es pasarle el problema.
3. **El que tiene la información decide.** El instalador sabe que OpenCode no
   corre. El docente no.

### Qué hace ahora

Un intento de reparación, automático: `scoop uninstall` + `scoop install`, y
vuelve a verificar. Si sigue roto, ahí sí corta con un mensaje que dice que ya se
intentó dos veces y a dónde pedir ayuda.

**Una vez, no en loop.** Un reintento sin techo no es persistencia: es colgarse
en la máquina de alguien que no puede hacer nada al respecto.

Reinstalar algo que **ya está roto** no destruye nada — si se llegó a esa rama,
es porque OpenCode no arranca.

### El cambio de fondo, que es el que importa

Se dejó de preguntar **"¿el archivo existe?"** y se pasó a **"¿el programa
corre?"** (`opencode --version`, 683 ms, exit 0).

No son lo mismo, y la diferencia la pagaba el docente: un shim que apunta a una
carpeta vacía existe igual, y el instalador imprimía `[OK]` sobre eso. El
problema aparecía tres pasos después, al abrir el bot, sin relación visible con
la causa.

De paso apareció que la verificación anterior miraba
`scoop\shims\opencode.cmd` — un archivo que **Scoop no crea nunca**. Siempre daba
falso. Era una verificación que no verificaba nada, y sólo se vio midiendo la VM,
no leyendo el código.

### Cuándo revisar esto

- Si alguien reporta que el instalador reinstaló OpenCode y **rompió** algo que
  antes andaba. Sería la señal de que `Test-OpenCode` da falso negativo en alguna
  máquina, y ahí el diagnóstico está mal, no la reparación.
- Si aparece un caso donde un solo reintento no alcanza y dos sí. Antes de subir
  el número: entender **por qué** falla el primero.

---

## D-03 — El acceso directo se puede abrir antes de que termine la instalación

**Fecha:** 2026-08-18 · **Versión:** v0.3.51

### Lo que pasaba

Inno Setup corre `[Icons]` **antes** que `[Run]`. Medido en la VM: el acceso
directo queda clickeable **a los 0,9 segundos**, cuando la instalación recién va
a empezar a bajar los **57,7 MB** de OpenCode.

En una notebook de escuela esa ventana no son segundos: son **minutos**. El
docente ve aparecer el ícono y lo abre. Es lo natural — no es un error de él.

Y lo que le decía el lanzador era peor que el error:

```
No se encontro OpenCode.
Volve a correr el instalador de Tecnia Bot
```

**Mientras el instalador estaba corriendo.** Ese consejo empuja a arrancar una
segunda instalación encima de la primera.

Le pasó a una persona real y pensó que el problema era su máquina.

### Qué hace ahora

El instalador deja una marca `{app}\.instalando` mientras trabaja. El lanzador,
si la encuentra, **espera** y abre el bot solo cuando termina:

```
Tecnia Bot se esta instalando en este momento.
Baja unos 60 MB, asi que puede tardar varios minutos.

No cierres esta ventana: el bot se abre solo cuando termine.
....
Listo, termino de instalarse. Abriendo...
```

### Dos decisiones adentro de esto

**La marca la maneja Inno, no el bootstrap.** Inno corre sus entradas de `[Run]`
en orden y con `waituntilterminated`, así que el borrado ocurre igual si el
bootstrap termina en 0, en 1, o se cae. Si la manejara el propio bootstrap, un
fallo dejaría la marca puesta y el lanzador esperando de gusto.

**La espera mira la marca, no si `opencode` ya existe.** OpenCode se instala en
el paso 2 de 4: arrancar ahí da un OpenCode pelado, sin Tecnia Bot. Ese es
exactamente el otro síntoma que ya se había reportado ("opencode me cargó pero no
tenía tecnia bot").

**Y la espera tiene techo** (20 minutos). Colgarse para siempre en la máquina de
alguien que no puede hacer nada al respecto no es una opción.

### Cuándo revisar esto

- Si alguien reporta que el lanzador esperó y **nunca** abrió. Sería marca
  huérfana: querría decir que Inno no llegó a correr su tercera entrada.
- Si los 20 minutos resultan cortos en alguna escuela real. Antes de subirlos:
  medir cuánto tarda de verdad ahí.

---

## D-04 — La marca se pone al empezar, y el instalador dice qué versión es

**Fecha:** 2026-08-18 · **Versión:** v0.3.52

### Por qué D-03 no alcanzó

En D-03 la marca `.instalando` se creaba en `[Run]`. Eso cubre una instalación
limpia, pero **no una actualización** — que es el caso más común.

En una máquina que ya tenía Tecnia Bot, el acceso directo de la instalación
anterior está vivo **desde el segundo cero**. Medido: el `.cmd` nuevo aparece a
los 0,81 s y la marca a los 0,94 s. En la VM es un segundo; en una notebook con
antivirus escaneando 5,6 MB de archivos chicos son decenas de segundos.

Y hay algo peor, que es lo que realmente pasó: **el lanzador que corre durante
una actualización es el que ya estaba en disco.** Al instalar la v0.3.51 —la que
traía el arreglo— el lanzador en disco todavía era el de la v0.3.50, que no sabía
nada de marcas. El arreglo no podía protegerse a sí mismo en su propia
instalación.

**Ahora la marca se crea en `[Code]`, en `CurStepChanged(ssInstall)`**: se dispara
al apretar "Instalar" y antes de copiar un solo archivo. Verificado con el
lanzador de la v0.3.51 en disco y el instalador de la v0.3.52: espera bien.

`DeinitializeSetup` la borra si se cancela a mitad; sin eso quedaría puesta y el
lanzador esperaría sus 20 minutos de gusto.

### El versionado del `.exe`

`AppVersion` sólo se ve en "Agregar o quitar programas". **No** aparece en las
Propiedades del archivo, que es donde la busca alguien que tiene el `.exe` en
Descargas y no sabe cuál bajó.

Se pagó: en una sesión de soporte real hubo que identificar la versión que tenía
un docente **contando los bytes** del archivo contra el asset del release.
Funcionó, pero es una vergüenza como método.

Ahora el `.exe` declara `VersionInfoVersion`, `ProductName` y `Description`, y
**el lanzador muestra la versión en todas sus pantallas, incluida la de error**.
Una captura de pantalla del docente ya alcanza para saber qué está corriendo.

### El mensaje de error dejó de ser dañino

Antes: *"Volvé a correr el instalador"* — a secas. Ahora aclara primero que si el
instalador está corriendo hay que esperarlo, y **no correrlo dos veces**.

---

## D-05 — Windows 7 no se soporta, y el instalador lo dice con nombre y apellido

**Fecha:** 2026-09-05 · **Versión:** sin publicar · **Issue:** [#5](https://github.com/programadores-obreros/Agente-editor-inet/issues/5)
· **Estado: decisión tomada, implementación PENDIENTE**

> **Esto NO es soporte de Windows 7. Es rechazo con explicación.** Windows 7 no va a
> correr Tecnia Bot nunca (ver la tabla de abajo). Lo que se decidió es cómo se le
> dice que no.
>
> **Qué pasa HOY en `main`:** `installer/tecnia-bot.iss` tiene `MinVersion=10.0`
> (línea 72) y `ArchitecturesAllowed=x64compatible`. En Windows 7 el `.exe` ya se
> niega a instalar, con el mensaje estándar de Inno en castellano (el `.iss` carga
> `Spanish.isl` y no lo sobreescribe): *"Este programa requiere Windows versión 10.0 o
> posterior."* No dice qué Windows detectó, ni por qué, ni qué hacer. La feature es
> reemplazar eso por un mensaje que lo explique, con las alternativas al lado.
>
> **Y hay un agujero que esta feature tapa, no sólo un cartel más lindo:**
> `MinVersion=10.0` deja pasar **cualquier** Windows 10, incluidos los anteriores a la
> versión 1809 (compilación 17763). Esas máquinas **instalan sin error y después
> OpenCode no arranca**, porque Bun exige 1809. El diseño de abajo lo corta en el
> instalador con `BuildMinimoWindows10 = 17763`.
>
> **Dónde está la implementación:** en el árbol de trabajo de la rama
> `feat/instalador-detecta-win7` (clon aparte), cien commits detrás de `main` y **sin**
> el trabajo del desinstalador (`CurUninstallStepChanged`, `PurgarDatosPersonales`).
> **No se puede traer tal cual**: los dos `.iss` difieren en 294 líneas y copiarlo
> revertiría la purga verificada en la VM. Hay que reimplementarla sobre el `.iss` de
> hoy, compilarla con ISCC y probarla.

### El problema

Una escuela pidió un instalador para Windows 7. No es un pedido raro: en las
escuelas técnicas hay máquinas de diez años que siguen prendiendo, y Windows 7
es lo que traen.

Hasta acá el `.exe` tenía `MinVersion=10.0`. En Windows 7 arrancaba y cortaba
con el cartel genérico de Inno Setup, que no dice qué Windows tiene la máquina,
ni por qué no sirve, ni qué hacer. La docente se quedaba con un "no es
compatible" y sin ningún dato para pedir ayuda.

### Qué se encontró

Tecnia Bot es OpenCode (el binario de Windows x64 que instala Scoop) más una
capa educativa. OpenCode se compila como un único ejecutable con Bun
(`Bun.build({ compile: { target: "bun-windows-x64" } })`), y la documentación
oficial de Bun es explícita: **"Bun requires Windows 10 version 1809 or
later"** — compilación 17763, octubre de 2018. En Windows 7, en Windows 8 y en
un Windows 10 anterior a 1809 el binario **no arranca**. No hay instalador que
lo arregle: no es un archivo que falta, es el ejecutable que no puede cargar.

Y aunque OpenCode corriera, el resto de la cadena también está muerto en
Windows 7:

| Eslabón | Lo que necesita | En Windows 7 |
|---|---|---|
| OpenCode (Bun) | Windows 10 1809 / compilación 17763, 64 bits | No arranca |
| Python | PlatformIO Core exige 3.9 o más nuevo | El último Python para Win7 es el 3.8 |
| PlatformIO Core | Python 3.9+ | Sin Python que lo corra |
| Scoop | PowerShell 5.1 + .NET 4.5 | Win7 trae PowerShell 2.0 |
| arduino-cli | Go 1.21, que dejó Windows 7 | Nada posterior a la 0.35.2 corre |
| Node | — | El último Node para Win7 es el 13.14 |

Windows 7 está fuera de soporte desde enero de 2020, y las actualizaciones de
seguridad extendidas terminaron en enero de 2023. Ninguna de esas herramientas
va a volver atrás.

### Qué se decidió

**No hay segundo instalador.** El mismo `.exe` detecta el Windows y, si no
sirve, lo explica con nombre y apellido.

La regla exacta:

- **64 bits.** OpenCode se distribuye sólo como `opencode-windows-x64.zip`.
- **Windows 10 versión 1809 (compilación 17763) o más nueva, o Windows 11.**
  Es el mínimo de Bun, sin margen agregado de nuestro lado.

Cómo **va a quedar** en `installer/tecnia-bot.iss` — es el diseño; en `main` todavía
no está (ver el bloque de estado, arriba):

- `MinVersion` bajó de `10.0` a `6.1sp1`, el mínimo que admite Inno Setup 6.3+.
  Suena al revés, pero es a propósito: así el `.exe` **arranca** en Windows 7
  SP1 y puede dar su propio mensaje en vez del de Inno.
- `ArchitecturesAllowed=x64compatible` se fue;
  `ArchitecturesInstallIn64BitMode=x64compatible` queda. La arquitectura ahora
  la verifica `[Code]`, por el mismo motivo.
- `InitializeSetup` llama a `GetWindowsVersionEx` e `IsX64Compatible`, nombra el
  Windows detectado (7 / 8 / 8.1 / 10 / 11, con la compilación) y rechaza tres
  casos: 32 bits, `Major < 10`, o Windows 10 con compilación menor a
  `BuildMinimoWindows10 = 17763`. El motivo va **siempre** al log de Setup
  (también en silencioso: es lo que llega a soporte) y, si hay ventana, se
  muestra como error crítico con la opción de abrir
  https://tecnialab.net.ar/tecnia-bot/ para ver qué opciones hay.
- Por debajo de `MinVersion` (Vista, Windows 7 sin SP1) `[Code]` no llega a
  correr y habla Inno: el `WindowsVersionNotSupported` de `[Messages]` dice el
  mismo requisito.

### Qué cuesta

A quien tiene Windows 10 o 11 de 64 bits, **nada**: pasa por `InitializeSetup`
sin ver ninguna diferencia.

A la escuela con Windows 7, **sigue sin poder usarlo**. Lo que cambió es que
ahora sabe por qué, y tiene a dónde ir. Es menos de lo que pidió, y más de lo
que tenía.

### Las alternativas, con su costo

Ninguna está implementada. Están acá para que la próxima vez no haya que
pensarlas de cero:

1. **Actualizar la PC a Windows 10 de 64 bits.** El único camino donde Tecnia
   Bot corre completo. Cuesta una licencia y que el hardware lo aguante; es una
   decisión de la escuela, no del instalador.
2. **Modo remoto.** Una PC con Windows 10 en el aula corre OpenCode como
   servidor y las de Windows 7 entran por el navegador (Chrome 109 o Firefox
   ESR 115 son los últimos que existen para Win7). Puede chatear, pero **no
   puede compilar ni cargar la placa enchufada en la PC de Windows 7**: el
   puerto serial queda del lado equivocado. Y la interfaz web no está
   verificada para esto.
3. **USB booteable con Linux** y el build de Linux de Tecnia Bot sobre el
   hardware viejo. Funciona en principio, pero es otra historia de instalación
   completa: drivers seriales, permisos del puerto, una docente que nunca vio
   Linux.
4. **"Tecnia Bot Lite" sin OpenCode para Windows 7.** Descartado: es un segundo
   producto con doble mantenimiento, y sin OpenCode no queda el bot, queda otra
   cosa.

### Cuándo volver a mirarla

Cualquiera de estas alcanza:

1. **Bun publica soporte para Windows 7.** Improbable: Windows 7 está fuera de
   soporte desde 2020, y no hay motivo para que un runtime nuevo vaya hacia
   atrás. Pero si pasa, el requisito de arriba cae solo.
2. **OpenCode cambia de runtime.** Si deja de compilarse con Bun, hay que
   volver a mirar toda la tabla: el mínimo lo pone el runtime, no nosotros.
3. **Una escuela con N máquinas de Windows 7 que no se pueden actualizar.**
   Un caso real, con un número. Ahí se evalúa el USB con Linux o el modo remoto
   como **piloto** en esa escuela, no como producto.
4. **Bun cambia la compilación mínima de Windows 10** en su documentación. La
   constante `BuildMinimoWindows10` en `installer/tecnia-bot.iss` y esta
   decisión tienen que moverse juntas.
