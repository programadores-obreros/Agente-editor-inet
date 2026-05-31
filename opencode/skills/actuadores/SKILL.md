---
name: actuadores
description: Actuadores para Arduino y ESP32 - servo motor SG90, relay, buzzer, motor DC. Cómo conectarlos, código comentado en español, errores comunes y advertencias de voltaje.
---

# Actuadores — componentes que MUEVEN o ACCIONAN

Los actuadores son los componentes que hacen que pase algo en el mundo físico: mover un brazo, hacer sonar una alarma, encender una luz de 220V, girar un motor.

Cada componente de esta biblioteca sigue la **misma estructura** para que sea fácil de seguir: voltaje, dificultad, librería, para qué sirve, conexiones (con colores de cable), diagrama, código comentado, errores comunes y cómo probarlo.

Cuando muestres conexiones, usá también el skill `diagramas-conexion` (dibujo ASCII + colores de cable).

---

## Servo motor SG90

> ⚡ **Voltaje:** 4.8V–6V (alimentar con 5V). En ESP32: alimentá el servo de 5V (pin VIN/5V), la señal de control de 3.3V funciona bien.
> 📊 **Dificultad:** Básico
> 📦 **Librería:** `Servo.h` (Arduino) / `ESP32Servo.h` (ESP32)

### ¿Para qué sirve?

Es un motorcito que se mueve a un ángulo exacto entre 0° y 180° y se queda ahí. Sirve para brazos robóticos, barreras, timones, señalización de semáforos — todo lo que necesite moverse a una posición controlada.

### Conexiones

El SG90 tiene 3 cables con colores fijos de fábrica:

| Cable del servo | Color de fábrica | Va conectado a (Arduino UNO) |
|-----------------|------------------|------------------------------|
| GND             | ⚫ Marrón        | GND                          |
| Alimentación    | 🔴 Rojo          | 5V                           |
| Señal           | 🟡 Naranja       | pin 9 (debe ser PWM, con ~)  |

> En **ESP32**: el cable marrón a GND, el rojo a **5V/VIN** (NO a 3.3V, el servo necesita 5V para tener fuerza), el naranja a cualquier GPIO (ej: GPIO18).

### Diagrama

```
   Arduino UNO              Servo SG90
  ┌───────────┐            ┌─────────┐
  │      5V   ├───🔴───────┤ Rojo    │
  │      GND  ├───⚫───────┤ Marrón  │
  │      pin9 ├───🟡───────┤ Naranja │  (señal PWM)
  └───────────┘            └─────────┘
```

### Código mínimo (Arduino UNO)

```cpp
#include <Servo.h>          // Librería para controlar servos

Servo miServo;              // Creamos un objeto servo

void setup() {
  miServo.attach(9);        // El servo está conectado al pin 9
}

void loop() {
  miServo.write(0);         // Movemos el servo a 0 grados
  delay(1000);              // Esperamos 1 segundo
  miServo.write(90);        // Lo movemos a 90 grados (centro)
  delay(1000);
  miServo.write(180);       // Lo movemos a 180 grados
  delay(1000);
}
```

### Código mínimo (ESP32)

Casi igual, pero con la librería del ESP32:

```cpp
#include <ESP32Servo.h>     // Librería de servos para ESP32 (instalar desde el gestor de librerías)

Servo miServo;

void setup() {
  miServo.attach(18);       // El servo está en GPIO18
}

void loop() {
  miServo.write(0);
  delay(1000);
  miServo.write(180);
  delay(1000);
}
```

En `platformio.ini`, agregá la librería:
```ini
lib_deps =
    madhephaestus/ESP32Servo   ; para ESP32
    ; arduino-libraries/Servo  ; para Arduino UNO
```

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El servo tiembla o no llega bien al ángulo | Lo alimentás del pin de datos o de 3.3V | Alimentá el rojo de 5V, no de 3.3V |
| Se reinicia el Arduino/ESP32 al mover el servo | El servo consume mucho y baja la tensión | Alimentá el servo de una fuente externa de 5V, GND común con la placa |
| No se mueve nada | El cable de señal no está en un pin que sirva | En Arduino UNO usá un pin PWM (con ~); en ESP32 cualquier GPIO |
| `'Servo' was not declared` | Falta la librería | Agregá `#include <Servo.h>` (o `ESP32Servo.h`) y la dependencia en platformio.ini |

### Cómo probar que funciona

Subí el código y mirá el servo: debería moverse entre las posiciones cada segundo. Si se mueve y se queda firme en cada ángulo, está perfecto. Si tiembla, es casi siempre tema de alimentación (pasá a 5V o fuente externa).

### Para la clase

El servo es ideal para el primer proyecto "que se mueve". Proyectos típicos: barrera de estacionamiento, brazo que saluda, indicador de un medidor. Como se mueve a ángulos exactos, sirve para enseñar el concepto de `map()` (convertir un valor de sensor en un ángulo).

---

<!--
PLANTILLA para agregar nuevos actuadores (copiar y completar):

## Nombre del componente

> ⚡ Voltaje: ...
> 📊 Dificultad: Básico / Intermedio / Avanzado
> 📦 Librería: ...

### ¿Para qué sirve?
(1-2 líneas en español simple)

### Conexiones
(tabla con colores de cable 🔴 rojo=+, ⚫ negro=GND, 🟡🟢🔵 señal)

### Diagrama
(dibujo ASCII, ver skill diagramas-conexion)

### Código mínimo (Arduino UNO)
(comentado línea por línea en español)

### Código mínimo (ESP32)
(solo si hay diferencias)

### Errores comunes
(tabla síntoma / causa / solución — los 3-4 típicos del aula)

### Cómo probar que funciona
(cómo sabe el alumno que anduvo)

### Para la clase
(proyectos donde se usa, concepto que enseña)

Próximos actuadores a documentar: relay 5V (¡advertir 220V!), buzzer pasivo, motor DC + L298N.
-->
