# Material de Educabot

Fuentes primarias usadas para el skill `educabot`. Permiso de uso: `docs/permisos/educabot.md`.

## Libro de actividades Educabot (PDF, 180 páginas)

No está en git (22 MB; `/docs/educabot/*.pdf` en `.gitignore`). Copiarlo acá con el nombre
`libro-de-actividades-educabot.pdf`. Índice útil:

| Páginas | Contenido |
|---|---|
| 10-23 | Plataforma Educablocks (registro, categorías de bloques, versión offline) |
| 28 | Inventario del kit electrónico |
| 29 | La placa Educablocks UNO y el **diagrama de señales de cada conector RJ12** |
| 30 | Código de colores (rosa, celeste, azul, verde, violeta, amarillo, rojo) |
| 31 | Analógico vs digital (LM335 y DHT11) |
| 32-73 | Un módulo por doble página con «¡A CONECTAR!» y «¡A PROGRAMAR!» |
| 72 | Puente H: 4 motores (2 MI + 2 MD), 2 señales digitales o 3 con PWM (ambos jumpers) |
| 76-77 | Kit mecánico (largueros, ángulos, soportes) |
| 80-83 | Cómo están planteadas las actividades; rúbrica de evaluación |
| 86-179 | 17 proyectos de 4.º a 6.º grado (Diseño Curricular PBA) con puertos exactos |

Todo lo que el skill toma del libro está citado con página. Lo que el libro **no** dice:
la posición física de cada señal en los 6 contactos del RJ12 (se mide con tester), el
chip USB-serie, y cómo se conectan la matriz RGB, el sensor de gesto y el Makey Makey.

## educablocks-uno-conectores.png

Recorte del diagrama de la p. 29: qué señales lleva cada conector. Puertos simples:
señal, 5V, GND. Especiales: E3 = D11~, D2, D3~, VIN, 5V, GND · E4 = D9~, D5, D4, VIN,
5V, GND · E6 = D10~, D7, D6, VIN, 5V, GND. COM = RX, TX, 5V, GND. IIC = SCL, SDA, 5V, GND.

## Pendiente

- Medir con tester el orden de los contactos del RJ12 en una placa real y anotarlo acá.
- Completar `docs/permisos/educabot.md`.
- Fotos oficiales del centro de ayuda (placa Bhoot v1.0, portapilas) si el permiso las cubre.
