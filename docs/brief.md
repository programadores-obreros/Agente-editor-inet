# Tecnia Bot — qué se construyó

> Estado al 26 de agosto de 2026 · v0.3.75 · Todos los números de este
> documento están medidos sobre el repositorio, no estimados.

Un asistente de electrónica para docentes de escuela técnica. Corre en la
computadora del docente, explica componentes, dibuja circuitos, compila y carga
código a placas Arduino y ESP32, y reparte fichas didácticas listas para
imprimir.

**Se instala con un doble clic y sin contraseña de administrador** — que es la
restricción que define casi todas las decisiones técnicas de abajo: en una
escuela, nadie tiene permisos de administrador sobre las máquinas del aula.

---

## En números

| | |
| --- | --- |
| Primer commit | 30 de mayo de 2026 |
| Commits | 202 |
| Versiones publicadas | 40 |
| Tests | 152, en 19 archivos |
| Líneas de test | 3.014 — más que las de los tools (3.180), casi 1:1 |
| Instalado en aula | Decenas de máquinas, 20 de agosto de 2026 |

---

## Las cuatro piezas

### 1. El agente

El prompt que define cómo se comporta: 6 reglas críticas, escritas cada una a
partir de un problema visto en uso real. Las tres que más cambiaron el producto:

- **Conversa antes de trabajar.** No se lanza solo. Reportado así: *«se pone a
  trabajar sin preguntar, se lanza solo, como que no interactúa y trabaja»*.
- **No pega el código: lo ofrece.** Una pared de cuarenta líneas de C++ no
  enseña, abruma.
- **Todo mensaje cierra con una pregunta o una acción concreta.** Y los cierres
  vacíos («¿alguna otra duda?») no cuentan.

### 2. Ocho herramientas

| Tool | Qué hace |
| --- | --- |
| `platformio` | Compila, carga a la placa, abre el monitor serie, diagnostica y **repara** la instalación |
| `circuito` | Genera un circuito visual interactivo en HTML, que abre sin internet |
| `ficha` | Abre una de las 17 fichas didácticas en el navegador, lista para imprimir |
| `imprimible` | Arma material de clase para repartir |
| `perfil` / `memoria` | Recuerdan con qué placa y qué proyecto trabaja cada docente |
| `actualizar` | Verifica y trae la última versión |
| `ayuda` | Orientación adentro del bot |

Más **cuatro comandos**: `/diagnostico`, `/reparar`, `/actualizar`, `/ayuda`.

### 3. Dieciséis skills · 16.684 líneas

El conocimiento de dominio: sensores, actuadores, Arduino, ESP32, comunicación
serial, librerías, diagramas de conexión, errores comunes, gotchas de hardware,
diseño curricular, proyectos del INET y checklist de seguridad.

### 4. Las fichas · repositorio aparte

Diecisiete hojas A4, una por componente o concepto, **generadas desde su fuente**
—no dibujadas a mano— con 14 módulos que producen los SVG. Cada una entra en una
sola página, verificado automáticamente. Promedio: 270 KB.

Catorce llevan el dibujo **animado**: el relé que cierra, el PIR que detecta, la
onda que avanza. Al imprimir se congelan en su primer cuadro, así que la hoja de
papel sale correcta.

Viajan **adentro del instalador**: el docente las tiene sin buscar nada.

---

## El instalador · 3.040 líneas

La pieza que más trabajo llevó, y la que menos se ve.

Instala Scoop, OpenCode, Python, PlatformIO Core y la capa educativa **en el
espacio del usuario**, sin permisos de administrador. Se compila en GitHub
Actions en cada versión, con una prueba de instalación silenciosa que corre
antes de publicar: si esa prueba falla, el `.exe` ni se adjunta.

Tres accesos directos en el menú inicio: **Tecnia Bot**, **Reparar** y
**Diagnóstico**.

**La regla que lo gobierna:** *puede fallar, pero no puede romper*. Se escribió
después de que una notebook que andaba quedara sin OpenCode por un
`scoop uninstall` puesto con buena intención. Hoy es un test.

---

## La prueba real

**20 de agosto de 2026.** Capacitación docente. Decenas de máquinas instalaron
la v0.3.69 desde el sitio oficial. Entró en todas.

En una sola quedó afuera PlatformIO — y el bot siguió sirviendo para explicar,
dibujar circuitos y repartir fichas, porque el instalador está diseñado para
tolerar esa falta en vez de abortar.

De ese único caso salieron seis versiones más en cuatro días.

---

## Lo que se aprendió, que vale más que el código

Tres defectos con la misma forma, encontrados en producción:

| Dónde | Qué decía | Qué pasó |
| --- | --- | --- |
| El `.describe()` del parámetro `abrir` | «Si es true (default)» — el código decía lo contrario | El bot abría el navegador en cada pedido |
| El comando `/diagnostico` | «Explicá los pasos para instalar en Windows» — sin decir cuáles | Le recetó **Visual Studio Code** a una directora de escuela |
| El resumen de `actualizar` | La tool devuelve sólo la versión | El bot afirmó «PlatformIO y todo al día» cuando PlatformIO no estaba |

**El modelo no adivina: ejecuta lo que se le escribe.** Donde queda un hueco, lo
llena con lo que sabe del mundo y no con lo que sabe del producto.

De ahí salió la decisión de arquitectura más importante del proyecto: **el
límite de lo que una herramienta sabe viaja en su respuesta, no en el prompt.**
El prompt se edita, se resume, queda atrás. La respuesta de la tool le llega al
modelo en el mismo turno en que tiene que decidir qué afirmar.

Y el corolario, que se aplica a los tests: **un OK falso es peor que un error.**
Un error manda a buscar. Un OK falso manda a casa tranquilo con el problema
intacto.

---

## Cómo se sostiene

152 tests, sin ejecutar el modelo: verifican el contenido del prompt, la
coherencia entre lo que un tool promete y lo que hace, la sintaxis del
instalador y que las fichas que se reparten sean las que se escribieron.

**Cada arreglo se verifica por mutación:** se vuelve a introducir el defecto y se
comprueba que el test se ponga rojo. Seis tests que pasaban en verde con el bug
puesto se detectaron así — incluido uno escrito para cazar un defecto, que no lo
cazaba.

---

## Estado y pendientes

**Andando:** v0.3.75 publicada, CI en verde, instalada en decenas de máquinas.

**Abierto:**

- Una netbook sin PlatformIO (escuela Juana Manso). Sin acceso a la máquina.
  Cuando lo haya: instalar y escribir `/reparar` — el error aparece en pantalla.
- Publicar los tres instructivos para docentes en el micro-sitio.
- Once observaciones técnicas de contenido en las fichas, de una auditoría contra
  hojas de datos primarias. Postergadas por decisión del equipo.
