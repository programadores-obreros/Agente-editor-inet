---
name: simulide
description: Simular circuitos Arduino sin placa física con SimulIDE (simulador open source). Instalación, armado del circuito, cargar el firmware .hex de PlatformIO y correr la simulación. Para alumnos sin hardware.
---

# SimulIDE — simular Arduino sin placa física

SimulIDE es un simulador de circuitos **open source y gratuito**. Sirve para que un alumno **pruebe su código Arduino sin tener la placa física** — ideal cuando hay una sola placa para toda el aula, o cuando el alumno quiere practicar en casa.

## ⚠️ Qué simula bien y qué no (importante)

SimulIDE usa internamente `simavr`, que simula muy bien los chips **AVR**:

| Placa | ¿Simula bien? |
|-------|---------------|
| Arduino UNO | ✅ Sí, muy bien |
| Arduino Nano | ✅ Sí, muy bien |
| Arduino Mega | ✅ Sí |
| **ESP32** | ❌ NO confiable — para ESP32 usá la placa real |

> **Regla práctica:** SimulIDE es para los primeros pasos con **Arduino UNO/Nano**. Para ESP32, siempre placa real. No le prometas al alumno simular un ESP32 con WiFi: no va a funcionar bien.

## Cómo funciona (el flujo completo)

La idea es combinar lo que ya hacemos con PlatformIO + SimulIDE:

```
1. El alumno escribe el código (con ayuda de Profe Bot)
2. Profe Bot compila con PlatformIO  →  genera firmware.hex
3. El alumno abre SimulIDE
4. Arma el circuito (o abre uno ya armado)
5. Carga el firmware.hex en el chip simulado
6. Aprieta Play y ve el circuito funcionando en pantalla
```

El archivo clave es el **`firmware.hex`** que genera PlatformIO. Está en:
```
<tu-proyecto>/.pio/build/uno/firmware.hex
```

## Instalación

SimulIDE es **portable**: no se instala, se descomprime y se ejecuta. Esto es una gran ventaja para las computadoras de escuela con restricciones.

### Windows
1. Descargá el `.zip` de Windows desde https://simulide.com/p/downloads/
2. Descomprimí la carpeta donde quieras (ej: Escritorio)
3. Entrá a la carpeta y hacé doble clic en `SimulIDE.exe`

### Linux
1. Descargá el `.tar.gz` de Linux 64-bit desde https://simulide.com/p/downloads/
2. Descomprimilo: `tar -xzf SimulIDE_*.tar.gz`
3. Entrá a la carpeta y ejecutá el binario (`./simulide` o el archivo dentro de `bin/`)

Versión recomendada: **1.1.0-SR2** o superior (la última estable).

## Armar el circuito en SimulIDE (paso a paso)

1. Abrí SimulIDE
2. En el panel de la izquierda, buscá los componentes:
   - **Micro → Arduino → Arduino Uno** (arrastralo al centro)
   - **Outputs → Led** (arrastrá un LED)
   - **Passive → Resistor** (arrastrá una resistencia)
3. Conectá haciendo clic en un pin y arrastrando hasta el otro:
   - Pin 13 del Arduino → resistencia → ánodo del LED (pata larga)
   - Cátodo del LED (pata corta) → GND del Arduino
4. Hacé clic derecho sobre la resistencia → ponele un valor (ej: 220 ohm)

## Cargar el firmware .hex

1. Hacé **clic derecho sobre el Arduino** simulado
2. Elegí **"Load firmware"** (cargar firmware)
3. Buscá y seleccioná el archivo `firmware.hex` de tu proyecto
   (está en `.pio/build/uno/firmware.hex`)
4. Opcional: activá **"Reload hex at Simulation Start"** para que recargue solo cada vez que apretás Play

## Correr la simulación

1. Apretá el botón **Play** (triángulo) arriba
2. El circuito cobra vida: el LED debería empezar a parpadear si cargaste el blink
3. Para parar, apretá **Stop**

## Errores comunes en SimulIDE

| Problema | Solución |
|----------|----------|
| El LED no prende en la simulación | Verificá la polaridad (ánodo/cátodo) y que cargaste el .hex correcto |
| "No firmware loaded" | Hacé clic derecho en el Arduino → Load firmware → elegí el .hex |
| El .hex no aparece | Compilá primero con PlatformIO; el .hex se crea en `.pio/build/uno/` |
| Quiero simular un ESP32 y se comporta raro | SimulIDE no simula bien ESP32. Usá la placa real. |
| La simulación va muy lenta | Es normal en compus viejas; bajá la complejidad del circuito |

## Cómo lo usa Profe Bot

Cuando un alumno no tiene la placa, Profe Bot puede:
1. Ayudarlo a escribir el código
2. Compilarlo con el tool `platformio` (acción `compile`) para generar el `.hex`
3. Indicarle dónde quedó el `.hex` (`.pio/build/uno/firmware.hex`)
4. Guiarlo paso a paso para armar el circuito en SimulIDE y cargar ese `.hex`

Así el alumno ve su código funcionando aunque no tenga hardware.
