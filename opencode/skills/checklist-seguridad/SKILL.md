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

- **Alimentación de componentes:** los que necesitan 5V (servo, PIR, HC-SR04, algunos relés) van al pin **VIN (5V)** del ESP32, **NUNCA a 3.3V**. (El LCD 16x2 con mochila I2C es el caso especial de todos — tiene su propia nota más abajo, leela ANTES de conectarlo.)
- **Señales que ENTRAN al ESP32:** si un sensor devuelve 5V (ej: el pin ECHO del HC-SR04), **no lo conectes directo a un GPIO** → necesitás un divisor de tensión (R1=1kΩ + R2=2kΩ) para bajarlo a ~3.3V. Directo, lo dañás.
- **En el UNO (5V) esto no es problema** — es tolerante a 5V. El salto de peligro es propio del ESP32.

**Para el alumno:** "El ESP32 es delicado con la electricidad: habla en 3.3 voltios. Si le metés 5 por un pin de datos, lo podés quemar y no vuelve. Los 5 voltios van SOLO al pin VIN, para alimentar cosas con hambre como el servo."

## ✅ El checklist (elegí los que apliquen)

1. **¿Alimentación correcta?** Los componentes de 5V (servo, PIR, HC-SR04) al **VIN**, no a 3.3V. Los de 3.3V a 3.3V. El **LCD I2C** tiene su nota aparte más abajo: no se resuelve con "VIN y listo".
2. **¿Polaridad del LED?** La pata larga (ánodo, +) va al lado de la señal/positivo; la corta (cátodo, −) a GND. Al revés no enciende (y no es lindo para el LED).
3. **¿Resistencia en serie con cada LED, y del valor correcto para ESTA fuente?** Siempre una resistencia entre el GPIO y el LED — sin ella, el LED y el pin sufren. Pero **el valor no es siempre 330Ω**: en 5V (UNO) 330Ω anda con cualquier LED, y en 3.3V (ESP32) un LED azul, blanco o verde InGaN con 330Ω recibe 0,3 mA y **no enciende**. El color del LED no dice su tensión: medila con el téster (modo diodo). Ver el skill `esp32` para el cálculo. Y en 3.3V nunca bajes de 100Ω.
4. **¿GND común?** Si usás una fuente externa (para el servo, tira de LEDs, etc.), el GND de ESA fuente tiene que estar unido al GND del ESP32. Sin GND común, no funciona o se comporta raro.
5. **¿Ningún cable pelado tocándose?** Un corto entre 5V/3.3V y GND puede resetear la placa o dañarla. Revisá que no haya cobres sueltos cruzándose.
6. **¿Señal de 5V entrando a un GPIO del ESP32?** (ej: ECHO del HC-SR04) → tiene que pasar por un divisor de tensión primero. Nunca directo.
7. **¿La placa correcta seleccionada?** Antes de cargar, que el proyecto apunte a tu placa (UNO / ESP32) y al puerto correcto. Cargar el binario equivocado no rompe el hardware, pero no va a andar.
8. **¿Strapping pins libres al arrancar?** En el ESP32, GPIO0, 2, 12 y 15 son "strapping": el chip les mira el nivel en el instante del encendido para decidir **cómo** arranca. El más peligroso es **GPIO12**: si está en HIGH al dar corriente, configura la memoria flash a 1,8V y la placa **no bootea** — sin mensaje de error, sin nada. Usá los pines seguros: **GPIO4, 5, 18, 19, 21, 22, 23, 25, 26, 27**.

## Por componente — quién necesita 5V (VIN)

| Componente | Alimentación | Ojo |
|---|---|---|
| LED | GPIO (3.3V) + resistencia **calculada** | polaridad + resistencia; en 3.3V **330Ω no sirve para todos los colores** (ver ítem 3) |
| Potenciómetro | 3.3V | salida analógica al GPIO (0-4095 en ESP32) |
| Servo SG90 | **VIN (5V)** | consume corriente; si tiembla, fuente externa + GND común |
| HC-SR04 (ultrasónico) | **VIN (5V)** | ECHO devuelve 5V → **divisor** antes del GPIO |
| PIR (movimiento) | **VIN (5V)** | salida suele ser 3.3V, OK directo |
| LCD 16x2 (I2C) | ⚠️ **no hay respuesta simple** — leé la nota de abajo | SDA/SCL **NO** son tolerantes a 5V en el ESP32 |
| DHT11/22 | 3.3V | la plaqueta de 3 pines **ya trae** su pull-up; sólo el sensor pelado de 4 patas necesita uno externo |
| Relé | según módulo (muchos 5V → VIN) | separá la potencia de la lógica |

## ⚠️ El LCD 16x2 con mochila I2C — el que parecía fácil y no lo es

Este es el único componente de la tabla que **no tiene una respuesta limpia**, y conviene decirlo antes de que el alumno conecte, no después.

El módulo son **dos cosas pegadas** con necesidades distintas:

- el **display HD44780**, que pide **5V**: el contraste del cristal se hace con esa tensión (hoja de datos Hitachi);
- la **mochila PCF8574**, que es la plaquita soldada atrás y la que habla I2C, y que tolera bastante menos.

**Si lo alimentás a 5V:** el display se ve perfecto — pero las resistencias de pull-up del bus I2C están **adentro de la mochila** y van a **su propio VCC**. O sea: alimentar la mochila a 5V pone **SDA y SCL en 5V**. Y GPIO21 / GPIO22 del ESP32 **no son tolerantes a 5V**, exactamente igual que en el caso del ECHO del HC-SR04 unos párrafos más arriba. Para hacerlo bien necesitás un **conversor de nivel bidireccional** en SDA y SCL.

**Y ojo con esto, que es el error que sigue al error:** el divisor de tensión de dos resistencias (R1=1kΩ + R2=2kΩ) que usás para el ECHO **NO sirve acá**. El I2C es un bus bidireccional: los dos extremos manejan la misma línea, y un divisor solo baja en un sentido. Tiene que ser un conversor bidireccional (los de dos MOSFET, que se venden hechos y son baratos).

**Si lo alimentás a 3.3V:** SDA y SCL quedan en 3.3V y el ESP32 está a salvo — pero el HD44780 **pierde contraste**. Se ve pálido, o directamente no se lee. La tensión mínima de trabajo declarada para este módulo es **4,5V**, y eso significa algo preciso: por debajo de ahí el fabricante **no promete nada**, y "nada" incluye que funcione a veces. Ese es el peor tipo de falla para el aula — el módulo se ve bien en la prueba del martes y falla en la entrega del jueves.

**Qué hacer en el aula, siendo honestos:**

- Con **Arduino UNO** no hay problema: la placa ya es de 5V, alimentación y bus van los dos a 5V y listo.
- Con **ESP32** hay que elegir a conciencia: **3.3V** si te alcanza con el contraste flojo (es la opción segura para la placa, y para una demo de clase suele alcanzar), o **5V + conversor de nivel bidireccional** si necesitás que se lea bien de lejos.
- **Lo que no se hace nunca:** mochila a 5V con SDA/SCL directo a GPIO21/22. Eso es meterle 5V a un pin de 3.3V, que es justo el error que este skill existe para evitar.

**Para el alumno:** "El LCD es dos aparatos en uno: la pantalla quiere 5 voltios para verse bien, y el chiquito que la maneja habla en el voltaje que vos le des. Si le das 5, la pantalla se ve hermosa pero le está gritando 5 voltios al ESP32 por los cables de datos. No hay opción mágica: o aceptás que se vea más pálido, o ponés un traductor de voltaje en el medio."

---

**Para cerrar, con el alumno:** "Antes de prender, pará 10 segundos y repasá esta listita conmigo. Es como ponerse el cinturón: no cuesta nada y te salva de un mal rato. Cuando esté todo tildado, le damos corriente tranquilos."
