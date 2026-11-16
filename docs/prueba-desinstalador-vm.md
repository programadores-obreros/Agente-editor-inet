# Probar el desinstalador en la VM win10 — protocolo

Inno Setup es de Windows y la máquina de desarrollo es Linux: lo que hace el
desinstalador **no se puede ver** desde donde se escribe. Entre "commiteado" y
"publicado" está esta prueba.

**Se corre entera cada vez que cambia `installer/tecnia-bot.iss` o
`install/uninstall.ps1`.** Si alguno de los escenarios no da lo esperado, el
cambio no se publica: se corrige y se vuelve a probar todo, no sólo el escenario
que falló.

> **Este documento describía un mecanismo que ya no existe.** La primera versión
> hablaba de dos entradas en `[UninstallRun]` con `RunOnceId` distinto, de un
> `Flags: runhidden`, de un `[UninstallDelete]` que barría `{app}` entera, y de
> una rama "retenida, que no se mergea". Nada de eso es así hoy: el mecanismo se
> mudó a `[Code]` (justamente porque la rama de borrar **nunca corría**), el
> código está integrado, y la carpeta del programa se borra por lista. Abajo
> está lo que hay ahora. Lo que se conserva de la versión vieja es lo que se
> **comprobó en la VM** y sigue valiendo: el escenario (c).

## Qué se está probando

`installer/tecnia-bot.iss` pregunta, al desinstalar por el camino estándar de
Windows, si además de Tecnia Bot se borran los **datos personales**. Según la
respuesta lanza `install\uninstall.ps1` con `-Borrar` o con `-Conservar`, **lee
el código con que terminó**, y después **mira el disco** por su cuenta.

Lo que está en juego:

| Qué | Dónde | Cómo se comprueba que se borró |
|---|---|---|
| Perfil del aula | `%USERPROFILE%\.config\opencode\tecnia-perfil.md` | El archivo no está |
| Memoria del aula | `%USERPROFILE%\.config\opencode\tecnia-memoria.md` | El archivo no está |
| Registro de cargas | `%USERPROFILE%\.config\opencode\tecnia-cargas.json` | El archivo no está |
| API key de Google | `%USERPROFILE%\.local\share\opencode\auth.json` | **El archivo sigue estando**: lo que tiene que faltar es el bloque `"google"` adentro. Mirar que el archivo no esté es medir otra cosa |
| API key (segunda copia) | la variable de usuario `GOOGLE_GENERATIVE_AI_API_KEY` | `[Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY","User")` devuelve vacío |

(Si `XDG_CONFIG_HOME` o `XDG_DATA_HOME` están seteadas, las rutas cuelgan de ahí.)

## Preparación, una sola vez

1. Compilar el instalador **dentro de la VM** (ISCC no corre en Linux):

   ```
   powershell -ExecutionPolicy Bypass -File installer\compilar-en-windows.ps1
   ```

   `ISCC installer\tecnia-bot.iss` a secas **no compila**: el `.iss` exige la
   versión por `/DMyAppVersion` y no tiene valor por defecto, a propósito. El
   script de arriba se la pasa.

   Si ISCC tira un error, **pará acá**. Anotá el error textual y volvé con eso.
   Ojo con una trampa que ya mordió tres veces: en un `.iss` ningún renglón
   puede empezar con `#` ni con `[`, ni siquiera adentro de un comentario del
   bloque `[Code]`.

2. Instalar el `.exe` resultante con una cuenta **sin privilegios de administrador**
   (es el caso real de la escuela).

3. Dejar los archivos existiendo y con contenido reconocible, para poder
   distinguir "se borró" de "nunca estuvo":
   - abrir Tecnia Bot y hacer que guarde perfil y memoria (decirle quién sos y en
     qué modo se usa la compu, y avanzar un proyecto para que escriba memoria).
     Mirar los dos archivos: tienen que haber dejado de decir "(sin definir)";
   - cargar una API key (sirve una de prueba inválida escrita a mano en
     `auth.json`: lo que importa es que el bloque `"google"` exista).

4. Antes de cada escenario, **verificar que todo eso está**. Si no está, el
   escenario no prueba nada. Y **cerrar Tecnia Bot**, salvo en el escenario (e).

## Los escenarios

### (a) Desinstalar → "Sí"

Esperado:
- aparece el cartel preguntando por los datos personales, **después** del cartel
  de confirmación propio de Inno, no antes;
- el botón resaltado por default es **"No"**;
- al elegir "Sí" se ve una **consola de PowerShell visible** (a propósito: es la
  que cuenta qué se pudo borrar y qué no). Se cierra sola al terminar;
- **no aparece ningún cartel de error**;
- los tres archivos de la carpeta de configuración ya no están, `auth.json` ya
  no tiene el bloque `"google"`, y la variable de usuario quedó vacía;
- la carpeta `%LOCALAPPDATA%\TecniaBot` ya no existe.

### (b) Desinstalar → "No"

Esperado:
- mismo cartel;
- al elegir "No" **no aparece consola** (esa rama va oculta);
- **todo lo personal sigue estando**;
- la capa de Tecnia Bot sí se fue: `%USERPROFILE%\.config\opencode\agent\tecnia-bot.md`
  ya no está, y `opencode.json` ya no nombra a `tecnia-bot`.

### (c) Cerrar el cartel con la X — INALCANZABLE POR DISEÑO, no lo busques

**Este escenario no se puede ejecutar, y está bien así.** Comprobado en la VM el
2026-09-22: la **✕ del cartel aparece en gris**, y ni `Esc` ni `Alt+F4` lo cierran.

El motivo es Windows, no nuestro código: el `MsgBox` se arma con `MB_YESNO`, que
**no tiene botón Cancelar**, y sin Cancelar el sistema deshabilita el cierre del
cuadro de diálogo. No hay forma de salir del cartel sin elegir "Sí" o "No".

Eso es **mejor** que el comportamiento que este documento esperaba originalmente
(que la ✕ conservara): el camino del accidente directamente no existe. Nadie
cierra el cartel sin querer y se va creyendo que decidió algo. La elección es
obligatoriamente explícita.

El código igual está escrito a prueba de eso: compara contra `IDYES` y no contra
`<> IDNO`, así que si algún día el cartel cambia a `MB_YESNOCANCEL` y la ✕ se
habilita, cerrar sin elegir seguiría conservando. La defensa está, sólo que hoy
es inalcanzable.

### (d) Desinstalación silenciosa

```
"%LOCALAPPDATA%\TecniaBot\unins000.exe" /VERYSILENT
```

Esperado:
- **no aparece ningún cartel**;
- **todo lo personal sigue estando.**

Este es el escenario que protege el caso "IT de la escuela limpia veinte notebooks
con un script": un despliegue desatendido no puede terminar borrando datos de
menores porque nadie estaba mirando la pantalla.

### (e) "Sí" con Tecnia Bot abierto — el borrado que falla

Dejar Tecnia Bot **abierto** y desinstalar eligiendo "Sí".

Esperado:
- la consola aparece y se cierra;
- aparece un **cartel de error** que dice que la desinstalación quedó incompleta
  y, si quedaron datos personales, **lista los archivos que siguen en la compu
  con su ruta entera**;
- lo que el cartel dice coincide con lo que hay en el disco.

Este escenario es el que más importa y el que la versión vieja no tenía: antes
el desinstalador no miraba el código de `uninstall.ps1`, y quien elegía borrar
se iba convencido de que los datos ya no estaban. Si acá **no** aparece cartel y
los archivos siguen, volvió ese defecto.

*No está comprobado que OpenCode abierto tome siempre esos archivos en Windows:
si el borrado igual funciona, anotalo — entonces este escenario hay que forzarlo
de otro modo (por ejemplo, abriendo `tecnia-perfil.md` con un programa que lo
bloquee).*

### (f) Algo ajeno en la carpeta del programa

Antes de desinstalar, crear un archivo cualquiera en `%LOCALAPPDATA%\TecniaBot`
(por ejemplo `mi-proyecto.txt`).

Esperado:
- al terminar aparece un cartel: *"Tecnia Bot se desinstaló, pero su carpeta no
  quedó vacía"*, que nombra `mi-proyecto.txt` entre las cosas que el instalador
  **no había puesto** y dice dónde está;
- `mi-proyecto.txt` **sigue ahí**; `install\` y `opencode\` ya no.

Es la prueba de que la carpeta del programa se borra por lista y no se barre:
en máquinas con versiones viejas pudo haber proyectos de alumnos ahí adentro.

## Lo que específicamente hay que mirar con lupa

**1. ¿Corrió la rama de purga?** (escenario (a))
La ejecución vive en `[Code]`, en `CurUninstallStepChanged`, paso `usUninstall`.
**No hay sección `[UninstallRun]`**, y no hay que volver a ponerla: Inno resuelve
esa sección *al instalar*, cuando todavía nadie contestó nada, y por eso la rama
de borrar no quedaba grabada. Si en (a) los archivos siguen y no viste consola,
lo primero es confirmar que nadie reintrodujo `[UninstallRun]`.

**2. ¿El script existía todavía cuando lo llamaron?**
`uninstall.ps1` vive en `{app}\install`, que `[UninstallDelete]` borra. Corre en
`usUninstall`, que es **anterior** a que Inno borre los archivos. Si aparece un
cartel de *"No pude iniciar el script que desinstala Tecnia Bot"*, o uno que
habla de un error del script, el orden no es el que se cree y hay que replantearlo.

**3. ¿El cartel sale en el momento correcto?**
Tiene que salir **después** de que el docente ya confirmó que quiere desinstalar.
Si sale antes, está enganchado en `InitializeUninstall` en vez de en
`CurUninstallStepChanged(usUninstall)`.

**4. ¿El código de salida de `uninstall.ps1` dice la verdad?**
Corriéndolo a mano con Tecnia Bot abierto:

```
powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\TecniaBot\install\uninstall.ps1" -Borrar
echo %ERRORLEVEL%
```

Tiene que dar `3` si quedó algo sin borrar y `0` si no. Y al final tiene que
listar lo que **no** saca (Scoop, OpenCode, Python, Node, PlatformIO, la carpeta
de proyectos, el historial de OpenCode), nombrando sólo lo que encontró en el disco.

## Qué reportar

Para cada escenario: qué se vio en pantalla (los carteles, textuales) y el
estado de cada cosa de la tabla de arriba después. Y la fecha: este documento no
dice cuándo se corrió por última vez la matriz completa con el mecanismo actual,
porque quien lo reescribió no lo corrió.
