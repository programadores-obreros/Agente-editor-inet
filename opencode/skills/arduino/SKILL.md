---
name: arduino
description: Programación Arduino UNO/Nano con LED, botón, analogRead, PWM, Serial y componentes básicos
---

# Arduino — Guía para principiantes

Este skill cubre programacion de Arduino UNO y Nano desde cero, en español.

## Estructura de un sketch

Todo sketch de Arduino tiene dos funciones obligatorias:

```cpp
void setup() {
  // Se ejecuta UNA sola vez cuando el Arduino arranca o se reinicia
  // Aqui configuramos los pines y iniciamos comunicaciones
}

void loop() {
  // Se ejecuta continuamente, una y otra vez, mientras el Arduino este encendido
  // Aqui va la logica principal del programa
}
```

**Tipos de pines:**
- **Digitales (D0-D13):** solo leen o escriben HIGH (5V) o LOW (0V)
- **Analogicos (A0-A5):** leen valores entre 0 y 1023 (0V a 5V)
- **PWM (marcados con ~):** simulan voltaje variable (pines 3, 5, 6, 9, 10, 11 en UNO)

**Voltaje de trabajo:** 5V. No conectes componentes de 3.3V sin un divisor de tension.

---

## Componentes basicos

### LED

**Para que sirve?**
Diodo que emite luz. Necesita una resistencia en serie (220-330 ohm) para no quemarse.

**Pines:**
| Pin del LED | Conexion |
|-------------|----------|
| Anodo (pata larga) | Resistencia → pin digital del Arduino |
| Catodo (pata corta) | GND |

**Codigo minimo:**
```cpp
const int PIN_LED = 13;  // Pin donde esta conectado el LED

void setup() {
  pinMode(PIN_LED, OUTPUT);  // Configuramos el pin como salida
}

void loop() {
  digitalWrite(PIN_LED, HIGH);  // Encendemos el LED (5V)
  delay(1000);                   // Esperamos 1 segundo (1000 milisegundos)
  digitalWrite(PIN_LED, LOW);   // Apagamos el LED (0V)
  delay(1000);                   // Esperamos 1 segundo
}
```

**Errores comunes:**
- LED no prende: revisa la polaridad (la pata larga va al positivo), la resistencia y que el pin sea el correcto
- LED siempre prendido o apagado: olvidaste llamar a `pinMode(pin, OUTPUT)` en setup

---

### Boton

**Para que sirve?**
Permite al usuario enviar una senal al Arduino. Usamos `INPUT_PULLUP` para no necesitar resistencia externa.

**Pines:**
| Pin del boton | Conexion |
|---------------|----------|
| Un lado | Pin digital del Arduino |
| El otro lado | GND |

**Codigo minimo:**
```cpp
const int PIN_BOTON = 2;  // Pin donde esta el boton
const int PIN_LED = 13;   // LED para mostrar el estado

void setup() {
  pinMode(PIN_BOTON, INPUT_PULLUP);  // Activa resistencia interna. Sin boton: HIGH. Con boton: LOW
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  int estado = digitalRead(PIN_BOTON);  // Leemos el boton
  if (estado == LOW) {                   // LOW significa que el boton esta presionado
    digitalWrite(PIN_LED, HIGH);         // Encendemos el LED
  } else {
    digitalWrite(PIN_LED, LOW);          // Apagamos el LED
  }
}
```

**Errores comunes:**
- El valor esta invertido (LOW = presionado): es correcto con INPUT_PULLUP, no es un error
- Lecturas inestables: agrega `delay(10)` para el rebote del boton (debounce)

---

### Potenciometro

**Para que sirve?**
Resistencia variable que permite ajustar un valor entre 0 y 1023 con una perilla.

**Pines:**
| Pin del potenciometro | Conexion |
|-----------------------|----------|
| Extremo izquierdo | GND |
| Extremo derecho | 5V |
| Pin central (cursor) | A0 (pin analogico) |

**Codigo minimo:**
```cpp
void setup() {
  Serial.begin(9600);  // Iniciamos la comunicacion serial para ver los valores
}

void loop() {
  int valor = analogRead(A0);               // Leemos el potenciometro (0 a 1023)
  int porcentaje = map(valor, 0, 1023, 0, 100);  // Convertimos a porcentaje (0 a 100)
  Serial.print("Valor: ");
  Serial.println(porcentaje);               // Mostramos el valor en el monitor serial
  delay(200);                               // Esperamos 200ms entre lecturas
}
```

---

### LED con PWM (brillo variable)

**Para que sirve?**
Con `analogWrite` podemos controlar el brillo de un LED usando modulacion por ancho de pulso. Solo funciona en pines PWM (marcados con ~).

**Codigo minimo:**
```cpp
const int PIN_LED = 9;  // Pin PWM (tiene ~ en la placa)

void setup() {
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  // Aumentamos el brillo gradualmente
  for (int brillo = 0; brillo <= 255; brillo++) {
    analogWrite(PIN_LED, brillo);  // 0 = apagado, 255 = maxima intensidad
    delay(10);
  }
  // Disminuimos el brillo gradualmente
  for (int brillo = 255; brillo >= 0; brillo--) {
    analogWrite(PIN_LED, brillo);
    delay(10);
  }
}
```

**Errores comunes:**
- No funciona el PWM: verificar que el pin tenga ~ en la placa. Los pines sin ~ solo admiten HIGH/LOW.

---

### Monitor serial

**Para que sirve?**
Permite enviar mensajes desde el Arduino a la computadora para depurar el codigo y ver valores en tiempo real.

**Codigo minimo:**
```cpp
void setup() {
  Serial.begin(9600);           // Iniciamos a 9600 baudios (velocidad de comunicacion)
  Serial.println("Hola!");      // Este mensaje aparece una sola vez al iniciar
}

void loop() {
  Serial.print("Temperatura: "); // print no agrega salto de linea
  Serial.println(25.3);          // println agrega salto de linea al final
  delay(1000);
}
```

Para ver los mensajes: Herramientas → Monitor serie (o Ctrl+Shift+M en Arduino IDE). Asegurate de que la velocidad sea **9600 baudios**.

---

## Funciones frecuentes

| Funcion | Que hace | Ejemplo |
|---------|----------|---------|
| `pinMode(pin, modo)` | Configura un pin como INPUT, OUTPUT o INPUT_PULLUP | `pinMode(13, OUTPUT)` |
| `digitalWrite(pin, valor)` | Escribe HIGH o LOW en un pin digital | `digitalWrite(13, HIGH)` |
| `digitalRead(pin)` | Lee el estado de un pin digital (HIGH o LOW) | `int v = digitalRead(2)` |
| `analogRead(pin)` | Lee un pin analogico (0 a 1023) | `int v = analogRead(A0)` |
| `analogWrite(pin, valor)` | Escribe un valor PWM (0 a 255) en pin ~ | `analogWrite(9, 128)` |
| `delay(ms)` | Pausa el programa por X milisegundos | `delay(500)` |
| `millis()` | Retorna el tiempo en ms desde que encendio | `unsigned long t = millis()` |

---

## Estructura PlatformIO para Arduino UNO

El sketch va en `src/main.cpp` (no en un archivo `.ino`).

**platformio.ini** minimo para Arduino UNO:
```ini
[env:uno]
platform = atmelavr          ; plataforma AVR (usado por Arduino UNO y Nano)
board = uno                  ; tipo de placa
framework = arduino          ; framework Arduino (setup/loop)
monitor_speed = 9600         ; velocidad del monitor serial
```

Para Arduino Nano:
```ini
[env:nano]
platform = atmelavr
board = nanoatmega328
framework = arduino
```
