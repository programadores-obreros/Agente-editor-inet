---
name: errores-comunes
description: Catálogo de errores comunes de PlatformIO y Arduino traducidos al español con soluciones paso a paso
---

# Errores comunes en Arduino y PlatformIO

Guia en español para entender y resolver los errores mas frecuentes al programar Arduino y ESP32 con PlatformIO.

---

## Errores de compilacion

### Error: Variable o funcion no declarada

**Que dice el compilador:**
```
'nombreVariable' was not declared in this scope
```

**Que significa:**
Usaste una variable o funcion que no existe en ese punto del programa. Puede ser un error de tipeo, que la declaraste en otro lugar donde no se ve, o que olvidaste declararla.

**Como solucionarlo:**
1. Revisa que el nombre este bien escrito (mayusculas/minusculas importan: `Led` es distinto de `led`)
2. Si es una variable, declarala antes de usarla: `int nombreVariable = 0;`
3. Si es una funcion, declarala antes del `setup()` o agrega su prototipo al principio

---

### Error: Falta punto y coma

**Que dice el compilador:**
```
expected ';' before '}'
expected ';' before 'return'
```

**Que significa:**
En C++ (el lenguaje de Arduino), cada instruccion termina con `;`. Si falta uno, el compilador se confunde.

**Como solucionarlo:**
1. Fijate en la linea indicada por el error (o la linea anterior)
2. Agrega el `;` al final de la instruccion
3. Ejemplo: `digitalWrite(13, HIGH)` → `digitalWrite(13, HIGH);`

---

### Error: Libreria no encontrada

**Que dice el compilador:**
```
fatal error: NombreLibreria.h: No such file or directory
```

**Que significa:**
El codigo usa una libreria que no esta instalada en el proyecto PlatformIO.

**Como solucionarlo:**
1. Busca el nombre exacto de la libreria en el Registry de PlatformIO: https://registry.platformio.org
2. En `platformio.ini`, agrega la libreria en `lib_deps`:
```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
lib_deps =
  adafruit/DHT sensor library@^1.4.4  ; ejemplo para el sensor DHT
```
3. Guarda el archivo — PlatformIO la descarga automaticamente

---

### Error: Tipo incorrecto

**Que dice el compilador:**
```
invalid conversion from 'int' to 'const char*'
error: cannot convert 'String' to 'char*'
```

**Que significa:**
Estas usando un valor de un tipo donde se espera otro tipo. Por ejemplo, pasas un numero donde se espera texto, o viceversa.

**Como solucionarlo:**
1. Revisa que tipo de dato espera la funcion (podes buscarla en la documentacion de Arduino)
2. Convierte el valor: `String(miVariable)` convierte a texto, `miString.toInt()` convierte texto a numero

---

### Error: Funcion no definida

**Que dice el compilador:**
```
undefined reference to 'miFuncion'
```

**Que significa:**
Llamas a una funcion que declaraste pero nunca implementaste, o que esta en un archivo que no esta incluido.

**Como solucionarlo:**
1. Verifica que la funcion este implementada (no solo declarada)
2. Si la implementacion esta en otro archivo, incluilo con `#include "miArchivo.h"`

---

### Error: Llave o parentesis sin cerrar

**Que dice el compilador:**
```
expected '}'
expected unqualified-id before '}'
```

**Que significa:**
Falta cerrar una llave `}` o hay una llave de mas. Cada `{` necesita su `}` correspondiente.

**Como solucionarlo:**
1. Revisa que cada `if`, `while`, `for`, `void setup()` y `void loop()` tenga su `{` y su `}`
2. Cuenta las llaves: el numero de `{` debe ser igual al numero de `}`

---

## Errores al cargar el codigo

### Error: Puerto no detectado

**Que dice el compilador:**
```
Error: Please specify `upload_port` for environment
Could not find serial port
```

**Que significa:**
PlatformIO no pudo detectar en que puerto USB esta conectado el Arduino/ESP32.

**Como solucionarlo:**
1. Desconecta el cable USB y volvelo a conectar
2. Ejecuta `/diagnostico` para ver los puertos disponibles
3. En Windows: revisa el Administrador de dispositivos → Puertos (COM y LPT)
4. Si ves el puerto, podes especificarlo en `platformio.ini`: `upload_port = COM3`

---

### Error: AVRDude — fallo al subir al Arduino

**Que dice el compilador:**
```
avrdude: stk500_recv(): programmer is not responding
avrdude: stk500_getsync() attempt 10 of 10: not in sync
```

**Que significa:**
Hubo un problema al comunicarse con el Arduino para cargar el codigo.

**Como solucionarlo:**
1. Verifica que el cable USB este bien conectado (prueba otro cable)
2. Cierra el monitor serial si esta abierto — no pueden usarse al mismo tiempo
3. Desconecta y reconecta el Arduino
4. Intenta presionar el boton RESET del Arduino justo antes de que empiece la carga

---

### Error: ESP32 no responde al cargar

**Que dice el compilador:**
```
Failed to connect to ESP32: Timed out waiting for packet header
```

**Que significa:**
El ESP32 no entro en modo de programacion a tiempo.

**Como solucionarlo:**
1. Mientras PlatformIO muestra "Connecting...", apreta y sostene el boton **BOOT** de la placa
2. Solta el boton cuando aparezca "Connecting..." o cuando empiece a subir
3. Algunas placas necesitan tambien apretar RESET mientras sostes BOOT

---

### Error: Driver no instalado en Windows (ESP32)

**Que dice el compilador:**
No hay mensaje de compilador — el dispositivo no aparece en el sistema.

**Que significa:**
Windows no tiene el driver para el chip USB del modulo ESP32. Hay dos chips comunes: CH340 y CP2102.

**Como solucionarlo:**
1. Conecta el ESP32 y abre el Administrador de dispositivos
2. Si ves un dispositivo con signo de advertencia (!) en "Otros dispositivos":
   - Si dice "CH340": descarga el driver de https://www.wch-ic.com/downloads/CH341SER_ZIP.html
   - Si dice "CP210x": descarga de https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers
3. Instala el driver y reinicia Windows
4. Vuelve a conectar el ESP32

---

### Error: Permiso denegado en Linux

**Que dice el compilador:**
```
could not open port /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0'
```

**Que significa:**
En Linux, los puertos seriales pertenecen a un grupo y tu usuario no esta en ese grupo. **El nombre del grupo depende de tu distribucion:**
- **Debian, Ubuntu, Mint:** el grupo es `dialout`
- **Arch, Manjaro, EndeavourOS:** el grupo es `uucp`

**Como solucionarlo:**
1. Averigua a que grupo pertenece tu puerto:
```bash
stat -c '%G' /dev/ttyUSB0
```
2. Agregate a ese grupo (con el nombre que devolvio el paso anterior):
```bash
# Debian/Ubuntu:
sudo usermod -a -G dialout $USER
# Arch/Manjaro:
sudo usermod -a -G uucp $USER
```
3. **Cerra sesion y volve a entrar** (es obligatorio para que el cambio surta efecto)
4. Verifica con `groups` que aparezca el grupo en la lista

**Solucion rapida (temporal, hasta desconectar la placa):**
```bash
sudo chmod a+rw /dev/ttyUSB0
```

---

### Error: platformio.ini mal configurado o ausente

**Que dice el compilador:**
```
Error: No project config file found
project configuration file `.pio` is invalid
```

**Que significa:**
No hay archivo `platformio.ini` en el directorio del proyecto, o tiene errores de sintaxis.

**Como solucionarlo:**
1. Verifica que estes en el directorio correcto del proyecto
2. Si no existe, crea un `platformio.ini` basico:
```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
```
3. Para ESP32:
```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
```

---

## Problemas de hardware (sin mensaje de error)

### El LED no prende

**Como verificarlo:**
1. Revisa la polaridad: la pata larga del LED (anodo) va al positivo, la corta (catodo) va a GND
2. Verifica que haya una resistencia de 220-330 ohm en serie
3. Confirma que el pin en el codigo coincide con el pin fisico donde conectaste el LED
4. Prueba el pin con otro LED o con un multimetro

### El codigo sube bien pero nada pasa

**Como verificarlo:**
1. Compara el numero de pin en el codigo con el numero impreso en la placa
2. En el ESP32, los pines se llaman GPIO. El numero impreso en la placa es el numero GPIO.
3. Abre el monitor serial — quizas hay mensajes de error en tiempo de ejecucion

### El Arduino se reinicia solo

**Causas posibles:**
1. **Problema de alimentacion:** si usas muchos componentes, el puerto USB puede no dar suficiente corriente. Prueba conectar el Arduino a una fuente externa (7-12V en el pin Vin)
2. **Cortocircuito:** verifica que no haya cables tocandose donde no deben
3. **Watchdog timer:** si el programa se cuelga en un loop muy largo, el Arduino puede reiniciarse
