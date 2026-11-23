# Prueba de release candidate en hardware real

Guion para probar un `.exe` candidato en una notebook FÍSICA antes de publicar. Doce
pasos de siempre, más cinco del instalador (13 a 17) que se suman cuando el release
toca `install/` o `installer/`. Cada uno dice qué hacer y qué TIENE que pasar. Si uno falla, la release no sale:
se anota qué pasó (captura o texto), se arregla, y se vuelve a correr desde el paso 1
con un `.exe` nuevo.

## Antes de empezar

- Notebook con Windows 10 u 11, **sin permisos de administrador** (como en la escuela).
  Ideal: una cuenta de usuario recién creada, o una máquina donde Tecnia Bot nunca se
  instaló. Si ya estaba instalado, sirve igual: se prueba el camino "Reparar".
- Un ESP32 (o Arduino UNO) con su cable USB de datos. Ojo: hay cables que solo cargan.
- Internet. La instalación baja Scoop, OpenCode, Python, PlatformIO y Node (varios cientos
  de MB) y las herramientas de ESP32 y Arduino UNO (más de 1 GB). Hacen falta 3 GB libres.
- Una hora tranquila. Anotá la hora de inicio.
- Descargá `Instalar-Tecnia-Bot.exe` de la release candidata en GitHub. No hace falta
  ninguna API key: sin key, el bot usa Big Pickle.

## Los doce pasos

| # | Qué hacer | Qué TIENE que pasar |
|---|---|---|
| 1 | Doble clic en `Instalar-Tecnia-Bot.exe`. Siguiente, Siguiente, Finalizar. | No pide contraseña de administrador. Se abre una consola que muestra la instalación; cuando pregunta la API key, apretá Enter: tiene que decir que sigue sin key y que el modelo es Big Pickle. La consola se cierra sola. **La última pantalla del asistente tiene que titularse "¡Tecnia Bot quedó instalado!"** — si dice "incompleto" o "NO quedó instalado", anotá el título textual: no es este paso el que falló, es la instalación. Aparecen **cuatro** accesos en el menú inicio: **Tecnia Bot**, **Reparar Tecnia Bot**, **Diagnostico de Tecnia Bot** y **Desinstalar Tecnia Bot**. |
| 2 | Abrí **Tecnia Bot** desde el menú inicio. | Splash con el logo. Abajo dice `Tecnia-Bot · Big Pickle`. Abajo a la derecha, la versión de OpenCode es la de `install/OPENCODE_VERSION` (hoy 1.18.18). Aparece el aviso de que Big Pickle es gratis por tiempo limitado. |
| 3 | Escribí: `Hola, soy docente y nunca usé Arduino. Quiero prender un LED con un ESP32.` | Te contesta en castellano rioplatense, te pregunta cómo te llamás y cómo preferís que te hable, y propone ir paso a paso. NO te tira cuarenta líneas de código. Termina con una pregunta concreta. |
| 4 | Contestá el nombre y seguí: `Dibujame el circuito, sin abrirlo.` | Llama al tool `circuito`, dice dónde quedó el archivo y NO abre el navegador. Después pedí `abrilo`: se abre en el navegador, el LED tiene una resistencia de **220Ω** y la tabla de conexiones dice lo mismo. |
| 5 | `Quiero conectar un teclado 4x4 al ESP32, ¿qué pines uso?` | Filas en GPIO 13, 16, 14 y 27. **Nunca GPIO12**. Si lo nombra, explica que se evita a propósito. |
| 6 | `Mostrame la ficha del LDR.` | Se abre la ficha en el navegador. En el divisor de tensión, el **LDR arriba** (hacia 3.3V) y la **resistencia de 10k abajo** (hacia GND). Ctrl+P la deja en una sola hoja A4. |
| 7 | **Enchufá el ESP32.** Escribí: `Armame el proyecto del LED que parpadea y compilalo.` | Crea `platformio.ini` y `src/main.cpp`, compila y dice que compiló. La primera compilación puede tardar varios minutos porque baja herramientas: tiene que avisarlo, no quedarse mudo. Si pide permiso para escribir archivos, aceptá y anotá que lo pidió. |
| 8 | `Cargalo a la placa.` | Detecta el puerto solo, carga, y dice que quedó cargado. **El LED de la placa parpadea.** Este es el paso que ninguna VM puede probar. Si no detecta la placa, probá otro cable USB antes de anotar falla. |
| 9 | `Abrí el monitor serial.` | Se abre una ventana aparte con el monitor a la velocidad del `platformio.ini` (115200 en ESP32). Si el sketch imprime algo, se lee sin caracteres raros. |
| 10 | `/diagnostico` | Dice que PlatformIO está instalado con su versión, qué placa ve en qué puerto, qué modelo usa (Big Pickle) y que no hay key de Google. No manda a instalar Visual Studio Code ni nada raro. |
| 11 | Cerrá Tecnia Bot. Menú inicio → **Reparar Tecnia Bot**. Cuando pida la key, Enter. | Corre sin errores rojos, dice "ya esta instalado" para OpenCode, PlatformIO y Node, deja OpenCode en la misma versión y el modelo en Big Pickle. **La ventana no se cierra sola** y termina con el resumen "Como quedo (lo que se comprobo, no lo que se intento)", con las cuatro líneas en `[OK]`, y después "LISTO!". Volvé a abrir Tecnia Bot: sigue andando. |
| 12 | **Antes de desinstalar, copiá `instalacion.log` a otro lado** (ver "Qué mandar": la desinstalación lo borra). Menú inicio → **Desinstalar Tecnia Bot**. En el cartel de los datos personales, elegí **No**. | Desinstala sin pedir administrador. El cartel de los datos personales aparece **después** del de confirmación, con "No" resaltado; no tiene cuenta regresiva ni se cierra solo. No aparece ninguna consola. Conserva el perfil (`%USERPROFILE%\.config\opencode\tecnia-perfil.md` sigue ahí). `opencode` sigue instalado (no es nuestro) pero al abrirlo ya no arranca Tecnia Bot como agente por defecto. La carpeta `%LOCALAPPDATA%\TecniaBot` ya no existe. |

### Si el release toca el instalador: cinco pasos más

Son los caminos que cambiaron cuando el instalador dejó de decir "quedó instalado" sin
mirar. Hace falta volver a instalar entre uno y otro.

| # | Qué hacer | Qué TIENE que pasar |
|---|---|---|
| 13 | **La pantalla final cuando falla.** En una máquina (o cuenta) donde nunca se instaló, desconectá internet y corré el `.exe`. | La consola dice que no pudo bajar Scoop. Aparece un cartel de error ("Tecnia Bot todavía NO está listo para usar") que nombra **Reparar** y **Diagnostico**. La última pantalla se titula **"Tecnia Bot NO quedó instalado"** y **no** ofrece la casilla "Abrir Tecnia Bot ahora". |
| 14 | **Reparar después de una falla.** Reconectá internet. Menú inicio → **Reparar Tecnia Bot**. | Instala todo sin volver a bajar el `.exe`, y el resumen del final queda con las cuatro líneas en `[OK]`. Abrí Tecnia Bot: anda. |
| 15 | **La pantalla final "incompleto".** No hay una receta simple para forzarla. Si en cualquier instalación de esta prueba la última pantalla dice **"Tecnia Bot quedó instalado, pero incompleto"**, no lo cuentes como falla del paso: anotá qué decía, mirá en `instalacion.log` qué línea del resumen quedó con `[!]`, corré **Reparar** y anotá si lo completó. | El bot abre igual. Reparar deja el resumen entero en `[OK]`. |
| 16 | **Desinstalar con Sí.** Con el bot instalado, un perfil guardado y una key cargada: Desinstalar → en el cartel de los datos personales, **Sí**. | Aparece una consola que cuenta lo que borra y se cierra sola. **No** aparece cartel de error. Ya no están `tecnia-perfil.md`, `tecnia-memoria.md` ni `tecnia-cargas.json`; `auth.json` **sigue existiendo** pero ya no tiene el bloque `"google"`. |
| 17 | **Usuario con tilde o ñ.** Creá una cuenta de Windows con tilde o ñ en el nombre (`Dirección`, `Muñoz`) e instalá ahí. Después corré **Reparar** dos veces seguidas. | La última pantalla dice "quedó instalado". PlatformIO queda en `C:\.platformio` y el bot compila igual (paso 7). En `%USERPROFILE%\.config\opencode\opencode.json`, la lista `"instructions"` tiene **una sola vez** la ruta de `tecnia-perfil.md` y una sola vez la de `tecnia-memoria.md`, con la tilde bien escrita — no una copia nueva por cada Reparar. |

El detalle fino del desinstalador (qué pasa con el bot abierto, con un archivo ajeno en
la carpeta del programa, en silencioso) está en
[`prueba-desinstalador-vm.md`](prueba-desinstalador-vm.md).

## Qué mandar al terminar

- La tabla de arriba con ✅ o ❌ por paso, y una línea de qué pasó en cada ❌.
- `%LOCALAPPDATA%\TecniaBot\instalacion.log`: es siempre la corrida más reciente. Las
  anteriores quedan al lado como `instalacion-<fecha>.log`. **Copialos antes de
  desinstalar**: la desinstalación los borra.
- El `.txt` que deja **Diagnostico de Tecnia Bot** en el Escritorio.
- Hora de inicio y de fin.

## Paso extra opcional: Gemini con tu key

Si tenés una API key propia de Google AI Studio (nivel gratuito): Menú inicio →
**Reparar Tecnia Bot**, pegala cuando la pida. Al abrir Tecnia Bot tiene que decir
`Tecnia-Bot · gemini-3.5-flash-lite` y contestar igual de bien. Nunca pegues la key en un
chat ni en un archivo del proyecto: los últimos cuatro caracteres alcanzan para identificarla.
