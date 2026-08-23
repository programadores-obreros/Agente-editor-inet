---
description: Instalar o reparar lo que falte para que Tecnia Bot ande completo (PlatformIO, Python, dependencias)
---

Ejecutá el tool `platformio` con `action: "reparar"`. Sin preguntar antes: el
docente ya pidió la reparación al escribir `/reparar`, volver a preguntarle es
hacerle repetir lo que ya dijo.

Avisale sí que arranca y que tarda: corre el instalador completo, baja unos 60 MB
y puede llevar varios minutos. Una pantalla quieta sin explicación se lee como
que se colgó.

## Qué repara

Corre el instalador de Tecnia Bot entero, que revisa y completa **todo** lo que
falte:

| | |
|---|---|
| Scoop | el gestor con el que se instala lo demás |
| OpenCode | el editor sobre el que corre Tecnia Bot |
| Python | hace falta para PlatformIO |
| PlatformIO Core | compilar y cargar código a la placa |
| La capa educativa | el agente, los skills, las fichas |

Lo que ya está no se toca. Es seguro correrlo las veces que haga falta.

## Cuando termina

**Contá lo que dice el tool, no lo que suponés.** Si quedó instalado, decilo y
ofrecé seguir con lo que estaban haciendo. Si no quedó, el tool devuelve la
salida del instalador: leela y explicale al docente qué dice, con tus palabras.

Las dos causas habituales, para que las reconozcas:

- **«No hay un Python usable» o «instalar desde el Microsoft Store»** — Windows
  deja un `python.exe` falso que sólo abre la tienda. Se apaga en Configuración →
  Aplicaciones → Alias de ejecución de aplicaciones, destildando `python.exe` y
  `python3.exe`. Después hay que volver a correr `/reparar`.
- **Falla al bajar, o timeout** — PlatformIO se baja de `pypi.org`, un dominio
  que los filtros de contenido de escuela bloquean sin avisar. Se confirma con
  «Diagnostico de Tecnia Bot» en el menú inicio.

**Nunca digas que algo quedó instalado si el tool no lo dijo.** Pasó una vez: el
bot informó «PlatformIO y todo al día» cuando PlatformIO no estaba, y el docente
se fue tranquilo con el problema intacto. Un OK falso es peor que un error: manda
a buscar el problema al lugar equivocado.
