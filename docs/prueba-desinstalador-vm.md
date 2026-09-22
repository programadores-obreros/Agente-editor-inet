# Probar el desinstalador en la VM win10 — protocolo

Este documento existe porque el commit del desinstalador (`fix/desinstalador-purga`)
está **retenido a propósito**: el código quedó escrito y revisado, pero nadie vio su
comportamiento funcionar. Inno Setup es de Windows y la máquina de desarrollo es Linux.

**Entre "commiteado" y "publicado" está esta prueba.** Hasta que los cuatro escenarios
de abajo den lo esperado, la rama no se mergea.

## Qué se está probando

`installer/tecnia-bot.iss` ahora pregunta, al desinstalar por el camino estándar de
Windows, si además de Tecnia Bot se borran los **datos personales**: el perfil del
aula, la memoria y la API key de Google. Antes llamaba siempre a `uninstall.ps1`
con `-Conservar` y nunca ofrecía la alternativa.

Los tres archivos que están en juego:

| Qué | Dónde |
|---|---|
| Perfil del aula | `%USERPROFILE%\.config\opencode\tecnia-perfil.md` |
| Memoria del aula | `%USERPROFILE%\.config\opencode\tecnia-memoria.md` |
| API key de Google | `%USERPROFILE%\.local\share\opencode\auth.json` |

(Si `XDG_CONFIG_HOME` está seteado, los dos primeros cuelgan de ahí.)

## Preparación, una sola vez

1. Compilar el instalador **dentro de la VM** (ISCC no corre en Linux):

   ```
   ISCC installer\tecnia-bot.iss
   ```

   Si ISCC tira un error de sintaxis Pascal, **pará acá**: el bloque `[Code]` nuevo
   no compila y no tiene sentido seguir. Anotá el error textual y volvé con eso.

2. Instalar el `.exe` resultante con una cuenta **sin privilegios de administrador**
   (es el caso real de la escuela).

3. Dejar los tres archivos existiendo y con contenido reconocible, para poder
   distinguir "se borró" de "nunca estuvo":
   - abrir Tecnia Bot y hacer que guarde perfil y memoria (`/perfil`, y avanzar
     un proyecto para que escriba memoria);
   - cargar una API key con `/clave` (sirve una key de prueba inválida: lo que
     importa es que el archivo exista).

4. Antes de cada escenario, **verificar que los tres archivos están**. Si no están,
   el escenario no prueba nada.

## Los cuatro escenarios

### (a) Panel de Control → Desinstalar → "Sí"

Esperado:
- aparece el cartel preguntando por los datos personales, **después** del cartel
  de confirmación propio de Inno, no antes;
- el botón resaltado por default es **"No"**;
- al elegir "Sí" se ve una **consola de PowerShell visible** (a propósito: es la que
  informa qué se pudo borrar y qué no);
- **los tres archivos ya no están.**

Si la consola no aparece: el `Flags: runhidden` se coló en la rama equivocada.
Si los archivos siguen: la rama de purga no corrió → mirar lo del `RunOnceId` más abajo.

### (b) Panel de Control → Desinstalar → "No"

Esperado:
- mismo cartel;
- al elegir "No" **no aparece consola** (esa rama sí va oculta);
- **los tres archivos siguen estando.**

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

**Con esto la matriz queda completa: (a), (b) y (d) probados; (c) inalcanzable.**

### (d) Desinstalación silenciosa

```
"%LOCALAPPDATA%\TecniaBot\unins000.exe" /VERYSILENT
```

Esperado:
- **no aparece ningún cartel**;
- **los tres archivos siguen estando.**

Este es el escenario que protege el caso "IT de la escuela limpia veinte notebooks
con un script": un despliegue desatendido no puede terminar borrando datos de
menores porque nadie estaba mirando la pantalla.

## Lo que específicamente hay que mirar con lupa

**1. ¿Corrió la rama de purga?** (escenario (a))
Las dos entradas de `[UninstallRun]` tienen `RunOnceId` **distinto**
(`quitarcapa` y `quitarcapaborrar`) justamente porque Inno ejecuta una sola entrada
por `RunOnceId`. Si en (a) los archivos siguen ahí y no viste consola, este es el
primer lugar donde mirar.

**2. ¿El script existía todavía cuando lo llamaron?**
`[UninstallDelete]` barre `{app}`, que es donde vive `install\uninstall.ps1`.
Que `[UninstallRun]` corra antes es comportamiento **documentado** de Inno, pero
no comprobado acá. Si en (a) o (b) aparece un error tipo "no se encontró
uninstall.ps1", el orden está al revés y hay que replantear el mecanismo.

**3. ¿El cartel sale en el momento correcto?**
Tiene que salir **después** de que el docente ya confirmó que quiere desinstalar.
Si sale antes, está enganchado en `InitializeUninstall` en vez de en
`CurUninstallStepChanged(usUninstall)`.

## Qué reportar

Para cada escenario: qué se vio en pantalla y el estado de los tres archivos
después. Si alguno de los cuatro no da lo esperado, **la rama no se mergea** —
se corrige y se vuelve a probar entera, no sólo el escenario que falló.
