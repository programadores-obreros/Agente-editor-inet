# Prueba de release candidate en hardware real

Guion para probar un `.exe` candidato en una notebook FÍSICA antes de publicar. Doce
pasos. Cada uno dice qué hacer y qué TIENE que pasar. Si uno falla, la release no sale:
se anota qué pasó (captura o texto), se arregla, y se vuelve a correr desde el paso 1
con un `.exe` nuevo.

## Antes de empezar

- Notebook con Windows 10 u 11, **sin permisos de administrador** (como en la escuela).
  Ideal: una cuenta de usuario recién creada, o una máquina donde Tecnia Bot nunca se
  instaló. Si ya estaba instalado, sirve igual: se prueba el camino "Reparar".
- Un ESP32 (o Arduino UNO) con su cable USB de datos. Ojo: hay cables que solo cargan.
- Internet. La instalación baja Scoop, OpenCode, Python y PlatformIO (varios cientos de MB).
- Una hora tranquila. Anotá la hora de inicio.
- Descargá `Instalar-Tecnia-Bot.exe` de la release candidata en GitHub. No hace falta
  ninguna API key: sin key, el bot usa Big Pickle.

## Los doce pasos

| # | Qué hacer | Qué TIENE que pasar |
|---|---|---|
| 1 | Doble clic en `Instalar-Tecnia-Bot.exe`. Siguiente, Siguiente, Finalizar. | No pide contraseña de administrador. La consola muestra la instalación y termina con "LISTO". Aparecen tres accesos en el menú inicio: **Tecnia Bot**, **Reparar Tecnia Bot**, **Diagnóstico de Tecnia Bot**. Cuando pregunta la API key, apretá Enter: tiene que decir que sigue con Big Pickle. |
| 2 | Abrí **Tecnia Bot** desde el menú inicio. | Splash con el logo. Abajo dice `Tecnia-Bot · Big Pickle`. Abajo a la derecha, la versión de OpenCode es la de `install/OPENCODE_VERSION` (hoy 1.18.18). Aparece el aviso de que Big Pickle es gratis por tiempo limitado. |
| 3 | Escribí: `Hola, soy docente y nunca usé Arduino. Quiero prender un LED con un ESP32.` | Te contesta en castellano rioplatense, te pregunta cómo te llamás y cómo preferís que te hable, y propone ir paso a paso. NO te tira cuarenta líneas de código. Termina con una pregunta concreta. |
| 4 | Contestá el nombre y seguí: `Dibujame el circuito, sin abrirlo.` | Llama al tool `circuito`, dice dónde quedó el archivo y NO abre el navegador. Después pedí `abrilo`: se abre en el navegador, el LED tiene una resistencia de **220Ω** y la tabla de conexiones dice lo mismo. |
| 5 | `Quiero conectar un teclado 4x4 al ESP32, ¿qué pines uso?` | Filas en GPIO 13, 16, 14 y 27. **Nunca GPIO12**. Si lo nombra, explica que se evita a propósito. |
| 6 | `Mostrame la ficha del LDR.` | Se abre la ficha en el navegador. En el divisor de tensión, el **LDR arriba** (hacia 3.3V) y la **resistencia de 10k abajo** (hacia GND). Ctrl+P la deja en una sola hoja A4. |
| 7 | **Enchufá el ESP32.** Escribí: `Armame el proyecto del LED que parpadea y compilalo.` | Crea `platformio.ini` y `src/main.cpp`, compila y dice que compiló. La primera compilación puede tardar varios minutos porque baja herramientas: tiene que avisarlo, no quedarse mudo. Si pide permiso para escribir archivos, aceptá y anotá que lo pidió. |
| 8 | `Cargalo a la placa.` | Detecta el puerto solo, carga, y dice que quedó cargado. **El LED de la placa parpadea.** Este es el paso que ninguna VM puede probar. Si no detecta la placa, probá otro cable USB antes de anotar falla. |
| 9 | `Abrí el monitor serial.` | Se abre una ventana aparte con el monitor a la velocidad del `platformio.ini` (115200 en ESP32). Si el sketch imprime algo, se lee sin caracteres raros. |
| 10 | `/diagnostico` | Dice que PlatformIO está instalado con su versión, qué placa ve en qué puerto, qué modelo usa (Big Pickle) y que no hay key de Google. No manda a instalar Visual Studio Code ni nada raro. |
| 11 | Cerrá Tecnia Bot. Menú inicio → **Reparar Tecnia Bot**. Cuando pida la key, Enter. | Corre sin errores rojos, dice "ya está instalado" para OpenCode y PlatformIO, deja OpenCode en la misma versión y el modelo en Big Pickle. Volvé a abrir Tecnia Bot: sigue andando. |
| 12 | Panel de control → Desinstalar Tecnia Bot. | Desinstala sin pedir administrador. Cuando pregunta por los datos personales, dejá que pasen los 20 segundos o contestá N: conserva el perfil. `opencode` sigue instalado (no es nuestro) pero al abrirlo ya no arranca Tecnia Bot como agente por defecto. |

## Qué mandar al terminar

- La tabla de arriba con ✅ o ❌ por paso, y una línea de qué pasó en cada ❌.
- `%LOCALAPPDATA%\TecniaBot\instalacion-<fecha>.log` (el más nuevo).
- El `.txt` que deja **Diagnóstico de Tecnia Bot** en el Escritorio.
- Hora de inicio y de fin.

## Paso extra opcional: Gemini con tu key

Si tenés una API key propia de Google AI Studio (nivel gratuito): Menú inicio →
**Reparar Tecnia Bot**, pegala cuando la pida. Al abrir Tecnia Bot tiene que decir
`Tecnia-Bot · gemini-3.5-flash-lite` y contestar igual de bien. Nunca pegues la key en un
chat ni en un archivo del proyecto: los últimos cuatro caracteres alcanzan para identificarla.
