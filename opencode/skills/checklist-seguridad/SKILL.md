---
name: checklist-seguridad
description: Chequeo de seguridad ANTES de dar corriente o cargar código - los 3.3V del ESP32, polaridad del LED, componentes que van a 5V (VIN), cables pelados, GND común. Evita quemar la placa o los componentes. Es el "pará, revisemos antes de prender" que salva el hardware del aula.
---

# Checklist de seguridad — revisá ANTES de dar corriente

Este skill es PREVENTIVO: se usa **antes** de que el alumno conecte el USB, cargue el código o alimente el circuito. La otra cara del `gotchas-hardware` (que es para cuando algo YA falló). Acá el objetivo es que **no se queme nada** — una placa quemada frena la clase y cuesta plata que la escuela no siempre tiene.

**Cuándo activar este skill:**
- Cuando el alumno está por **cargar código a la placa** o **darle corriente** al circuito.
- Cuando pregunta "¿puedo prenderlo?", "¿está bien conectado?", "¿lo conecto?", "¿le doy USB?".
- Cuando terminan de armar un circuito (después de usar el tool `circuito`), antes de energizarlo.

**Cómo usarlo:** NO le tires las 8 verificaciones de golpe (lo abrumás). Armá un checklist CORTO y a medida del circuito que están haciendo — 3 o 4 ítems, los que apliquen a SUS componentes. Presentalo como una lista simple de "sí/no" y esperá que confirme antes de decir "dale, prendé". Con calidez: no es un examen, es cuidar el trabajo.

## ⚡ El check que MÁS quema placas: 3.3V vs 5V

**El ESP32 trabaja a 3.3V en sus pines (GPIO). El Arduino UNO, a 5V.** Meterle 5V a un GPIO del ESP32 lo puede **dañar de forma permanente**. Este es el error más caro y más común.

- **Alimentación de componentes:** los que necesitan 5V (servo, PIR, HC-SR04, LCD 16x2, algunos relés) van al pin **VIN (5V)** del ESP32, **NUNCA a 3.3V**.
- **Señales que ENTRAN al ESP32:** si un sensor devuelve 5V (ej: el pin ECHO del HC-SR04), **no lo conectes directo a un GPIO** → necesitás un divisor de tensión (R1=1kΩ + R2=2kΩ) para bajarlo a ~3.3V. Directo, lo dañás.
- **En el UNO (5V) esto no es problema** — es tolerante a 5V. El salto de peligro es propio del ESP32.

**Para el alumno:** "El ESP32 es delicado con la electricidad: habla en 3.3 voltios. Si le metés 5 por un pin de datos, lo podés quemar y no vuelve. Los 5 voltios van SOLO al pin VIN, para alimentar cosas con hambre como el servo."

## ✅ El checklist (elegí los que apliquen)

1. **¿Alimentación correcta?** Los componentes de 5V (servo, PIR, HC-SR04, LCD) al **VIN**, no a 3.3V. Los de 3.3V a 3.3V.
2. **¿Polaridad del LED?** La pata larga (ánodo, +) va al lado de la señal/positivo; la corta (cátodo, −) a GND. Al revés no enciende (y no es lindo para el LED).
3. **¿Resistencia en serie con cada LED?** Siempre una de 330Ω entre el GPIO y el LED. Sin ella, el LED (y el pin) sufren.
4. **¿GND común?** Si usás una fuente externa (para el servo, tira de LEDs, etc.), el GND de ESA fuente tiene que estar unido al GND del ESP32. Sin GND común, no funciona o se comporta raro.
5. **¿Ningún cable pelado tocándose?** Un corto entre 5V/3.3V y GND puede resetear la placa o dañarla. Revisá que no haya cobres sueltos cruzándose.
6. **¿Señal de 5V entrando a un GPIO del ESP32?** (ej: ECHO del HC-SR04) → tiene que pasar por un divisor de tensión primero. Nunca directo.
7. **¿La placa correcta seleccionada?** Antes de cargar, que el proyecto apunte a tu placa (UNO / ESP32) y al puerto correcto. Cargar el binario equivocado no rompe el hardware, pero no va a andar.
8. **¿Strapping pins libres al arrancar?** En el ESP32, GPIO0, 2, 12 y 15 son "strapping": si tienen algo conectado al momento de encender, la placa puede no arrancar o entrar en modo raro. Si podés, usá otros GPIO para esos componentes.

## Por componente — quién necesita 5V (VIN)

| Componente | Alimentación | Ojo |
|---|---|---|
| LED | GPIO (3.3V) + 330Ω | polaridad + resistencia en serie |
| Potenciómetro | 3.3V | salida analógica al GPIO (0-4095 en ESP32) |
| Servo SG90 | **VIN (5V)** | consume corriente; si tiembla, fuente externa + GND común |
| HC-SR04 (ultrasónico) | **VIN (5V)** | ECHO devuelve 5V → **divisor** antes del GPIO |
| PIR (movimiento) | **VIN (5V)** | salida suele ser 3.3V, OK directo |
| LCD 16x2 (I2C) | **VIN (5V)** | I2C: SDA/SCL, tolerante |
| DHT11/22 | 3.3V | pull-up de 10kΩ en DATA |
| Relé | según módulo (muchos 5V → VIN) | separá la potencia de la lógica |

**Para el alumno:** "Antes de prender, pará 10 segundos y repasá esta listita conmigo. Es como ponerse el cinturón: no cuesta nada y te salva de un mal rato. Cuando esté todo tildado, le damos corriente tranquilos."
