# Brief para maquetar la web oficial de **Tecnia Bot**

> **Para la IA que va a construir esta web:** este documento es tu única fuente de verdad.
> Contiene el propósito, el público, el tono, la estructura y **los textos reales** de cada sección.
> No inventes datos, features, versiones ni fechas: si algo no está acá, dejalo como marcador claro
> y avisá al final qué falta. Los datos duros (repo, licencia, comandos) están verificados.

---

## 0. Qué te estoy pidiendo

Construir el **sitio oficial de Tecnia Bot**: la cara pública del proyecto y, a la vez, el lugar
donde viven las **versiones**, los **features**, el **roadmap** y el enlace al **repositorio de GitHub**.

Es un sitio **estático** (HTML + CSS + JS, sin backend), pensado para publicarse en **GitHub Pages**.

---

## 1. Datos duros del proyecto (verificados — usalos tal cual)

| Dato | Valor |
|------|-------|
| **Nombre** | **Tecnia Bot** (alternativa evaluada: *Tecnia Bot* — usar **Tecnia Bot**) |
| **Qué es** | Asistente educativo de IA para enseñar Arduino y ESP32 |
| **Para quién** | Docentes y estudiantes de escuelas técnicas argentinas (programa **INET**) |
| **Repositorio** | https://github.com/programadores-obreros/Agente-editor-inet |
| **Organización** | `programadores-obreros` |
| **Licencia del código** | GPLv3 |
| **Licencia del contenido educativo** | CC BY-SA 4.0 |
| **Construido sobre** | [OpenCode](https://opencode.ai) (agente de IA en terminal, open source) |
| **Costo** | **Gratis.** Sin licencias, sin API keys, sin cuentas pagas |
| **Sistemas** | Windows (principal), Linux, macOS |
| **Hardware que enseña** | Arduino UNO, ESP32, sensores y actuadores del kit escolar |
| **País** | Argentina 🇦🇷 |

### Comandos de instalación (reales, no los cambies)

**Windows** (no necesita permisos de administrador):
```powershell
powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
```

**Linux / macOS**:
```bash
bash install/bootstrap.sh
```

> El instalador instala **todo** solo: OpenCode + PlatformIO + Tecnia Bot. El usuario no necesita
> instalar nada antes. Este es un punto de venta MUY fuerte: destacalo.

---

## 2. A quién le habla la web (4 públicos, en este orden de prioridad)

1. 👩‍🏫 **El docente de escuela técnica** — no es programador, tiene miedo de no saber, poco tiempo.
   *Necesita saber:* "¿esto me va a servir? ¿lo puedo instalar sin ser experto? ¿es gratis?"
2. 🧑‍🎓 **El estudiante** — curioso, nunca programó.
   *Necesita:* que le den ganas. Ver algo que funciona, que se prende, que se mueve.
3. 🏛️ **Directivos, INET, autoridades educativas** — evalúan si adoptarlo.
   *Necesitan:* propósito claro, seriedad, licencias libres, roadmap, que sea sostenible.
4. 👩‍💻 **Colaboradores / desarrolladores** — quieren aportar.
   *Necesitan:* el link a GitHub, cómo contribuir, la licencia.

**El diseño debe funcionar para el docente PRIMERO.** Si el docente entiende y se anima, ganamos.

---

## 3. Objetivos de la web (en orden)

1. Que en **10 segundos** se entienda qué es y para quién.
2. Que en **1 minuto** el docente entienda que **puede instalarlo él mismo, gratis**.
3. Mostrar que **funciona de verdad** (proyectos reales, circuitos, hardware).
4. Ser el **lugar oficial** de versiones, features y roadmap.
5. Llevar a **GitHub** a quien quiera mirar el código o contribuir.

---

## 4. Tono y voz

- **Español argentino, cálido y directo.** Voseo natural ("podés", "vas a poder", "te acompaña").
- **Cero jerga técnica innecesaria.** Si aparece una palabra técnica, se explica al lado.
- **Nada de lenguaje corporativo frío.** Nada de "soluciones innovadoras", "sinergia", "empoderar".
- Tono de **compañero que te banca**, no de empresa que te vende.
- Honesto: no prometemos magia. Prometemos acompañamiento.

**Frase guía del proyecto (usala en el hero o cerca):**
> *"El conocimiento técnico no debería ser un privilegio. Debería ser un derecho."*

---

## 5. Identidad visual (dirección, con libertad creativa)

- **Sensación:** cálida, humana, escolar pero moderna. NO fría, NO "startup de Silicon Valley".
- **Paleta sugerida** (podés ajustarla, pero mantené la calidez):
  - Acento principal: un celeste/azul argentino (`#3a7bd5` o similar)
  - Acento secundario: naranja cálido (`#e67e22`) para llamadas a la acción
  - Tierra/neutros suaves de fondo (`#f7f9fb`, `#eef2f5`)
  - Verde para "funciona / listo" (`#27ae60`), rojo suave para advertencias (`#e74c3c`)
- **Tipografía:** sans-serif legible y sin costo (system fonts o una self-hosted). **No cargar fuentes de CDN.**
- **Iconografía:** emojis o SVG simples. Nada de ilustraciones corporativas de stock.
- **Fotos/visuales:** priorizá **capturas reales del producto** (circuitos, la terminal, el protoboard interactivo)
  por sobre imágenes decorativas. Si no hay capturas, dejá marcadores claros donde deberían ir.
- Guiño a Argentina, con sutileza (no bandera gigante).

---

## 6. Estructura de la web

**Formato recomendado:** una **landing de una sola página** con navegación por anclas,
**más una página aparte de Versiones (changelog)**. Es lo más fácil de mantener.

Navegación (sticky): `Qué es` · `Cómo funciona` · `Proyectos` · `Descargar` · `Roadmap` · `Versiones` · `GitHub`

---

### 6.1 · Hero (lo primero que se ve)

**Título:**
> Tecnia Bot

**Subtítulo:**
> Un profe de electrónica con paciencia infinita, que habla como vos, no se cansa nunca de explicar,
> y nunca te hace sentir un tonto por preguntar.

**Bajada:**
> Aprendé a programar Arduino y ESP32 de verdad, entendiendo lo que hacés.
> Para docentes y estudiantes de escuelas técnicas. **Gratis, libre y en español.**

**Botones:**
- Primario: **⬇ Descargar Tecnia Bot** (ancla a #descargar)
- Secundario: **Ver en GitHub** (link al repo)

**Chips de confianza** (chiquitos, debajo de los botones):
`Gratis` · `Sin cuentas ni API keys` · `Windows y Linux` · `Código abierto` · `Hecho en Argentina 🇦🇷`

---

### 6.2 · El problema (sección corta y honesta)

**Título:** No falta hardware. Falta quién enseñe.

**Copy:**
> En miles de escuelas técnicas del país hay placas, sensores y ganas. Pero el kit queda guardado en el armario.
>
> Porque el profe muchas veces aprende una semana antes que el alumno, a las apuradas, de tutoriales en inglés.
> Porque los manuales asumen que ya sabés. Porque los errores aparecen en inglés y en jerga, y ahí se bajan los brazos.
> Y porque no hay presupuesto: ni para licencias, ni para cursos, ni para cuentas pagas de inteligencia artificial.
>
> Así, la tecnología que debería igualar oportunidades termina agrandando la brecha.
>
> **Eso es lo que venimos a romper.**

---

### 6.3 · Qué es (y qué NO es)

**Título:** No es una IA que te hace la tarea. Es un profe.

Dos columnas contrastadas (visual de "esto sí / esto no"):

| ✅ Tecnia Bot es… | ❌ Tecnia Bot no es… |
|---|---|
| Un profe paciente que te explica el **porqué** antes del código | Una máquina de tirar código para copiar y pegar |
| Un compañero que te trata como alguien capaz de aprender | Un reemplazo del docente |
| Una herramienta que **vos dirigís** | Una caja negra que decide por vos |
| Gratis y libre, para siempre | Un producto con letra chica |

---

### 6.4 · Cómo funciona / Qué hace (los features)

**Título:** Lo que Tecnia Bot hace por vos

Grilla de tarjetas (icono + título + 1-2 líneas):

| Icono | Título | Descripción |
|---|---|---|
| 🗣️ | **Te habla en español** | Como hablás vos. Sin jerga innecesaria, sin asumir que ya sabés. |
| 💡 | **Explica el porqué, antes del código** | Porque entender vale más que copiar. |
| 🧩 | **Comenta cada línea** | Nunca te quedás con un programa mágico que no sabés qué hace. |
| 🌎 | **Traduce los errores** | Ese muro rojo en inglés se convierte en "pasó esto, se arregla así". |
| 🔌 | **Compila y carga a la placa** | Desde el mismo chat, paso a paso, al hardware de verdad. |
| 🧰 | **Dibuja los circuitos** | Esquemas visuales e interactivos: ves cómo se conecta cada cosa. |
| 🍞 | **Te enseña la protoboard** | Un explicador interactivo: tocás un agujero y ves qué está conectado. |
| 🎓 | **Se adapta a vos** | Te pregunta si sos docente o alumno, y ajusta cómo te explica. |
| 📚 | **Sabe de sensores y actuadores** | Voltajes, conexiones, errores típicos y advertencias de seguridad. |
| 🆓 | **Gratis y sin configurar nada** | Sin API keys, sin cuentas, sin tarjeta. Se instala y anda. |

---

### 6.5 · Proyectos (la prueba de que funciona)

**Título:** 15 proyectos reales del programa INET

**Copy:**
> Semáforos, riego automático, control de tanques, invernadero inteligente, estación meteorológica,
> cerradura con clave, brazo robótico, robot que esquiva obstáculos… Todos con sus componentes,
> su conexionado y su interacción, para entender cómo funcionan.

Mostralos como una grilla de tarjetas con emoji + nombre:

🚦 Semaforización · 💧 Riego automatizado · 🛢️ Control de tanques · 🌱 Invernadero inteligente ·
⛅ Estación meteorológica · 🅿️ Estacionamiento · 🔐 Cerradura automatizada · 🔥 Calefacción automática ·
💡 Sistema lumínico · 💨 Pulverizador · 🐟 Sistema acuapónico · 🦾 Brazo robótico ·
🤖 Robot móvil · 🚤 Dron acuático · 🚁 Dron de vuelo

> **Nota para la IA:** existe una web separada con estos 15 proyectos maquetados e interactivos.
> Dejá un botón **"Ver los proyectos"** apuntando a un marcador `#TODO-URL-PROYECTOS`
> y avisá al final que hay que completar esa URL.

---

### 6.6 · Descargar / Instalar ⭐ (la sección más importante para el docente)

**Título:** Instalalo en un solo paso

**Copy:**
> No necesitás instalar nada antes. El instalador se encarga de todo:
> descarga y configura OpenCode, PlatformIO y Tecnia Bot por vos.
> **En Windows ni siquiera necesita permisos de administrador** — funciona en las PCs de la escuela.

Dos tarjetas grandes, lado a lado:

**🪟 Windows**
1. Descargá el proyecto desde GitHub
2. Abrí PowerShell en esa carpeta
3. Pegá esto:
```powershell
powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
```

**🐧 Linux / macOS**
1. Descargá el proyecto desde GitHub
2. Abrí una terminal en esa carpeta
3. Pegá esto:
```bash
bash install/bootstrap.sh
```

**Después de instalar** (tarjeta abajo, con pasos numerados grandes):
1. Abrí una terminal en cualquier carpeta
2. Escribí `opencode`
3. Apretá **Tab** y elegí **`tecnia-bot`**
4. Escribí "hola" y dejate guiar

> Poné un botón de **copiar al portapapeles** en cada bloque de código. El docente no debería tener
> que seleccionar texto con el mouse.

---

### 6.7 · Roadmap

**Título:** Hacia dónde vamos

Presentalo en tres columnas o un timeline: **Listo** · **En camino** · **Más adelante**.
Usá exactamente estos ítems:

**✅ Listo**
- El agente educativo que explica en español y comenta el código
- Compilación y carga al hardware real (Arduino UNO y ESP32)
- Armador visual de circuitos con más de 30 componentes
- Explicador interactivo de la protoboard
- Bases de conocimiento: Arduino, ESP32, sensores, actuadores, errores comunes
- Instalador de un solo comando (Windows y Linux)

**🚧 En camino**
- Versiones publicadas y un comando para **actualizar Tecnia Bot desde el propio chat**
- Esta página de descarga oficial
- Instalador gráfico para Windows (doble clic, sin terminal)

**🔭 Más adelante**
- Versión **portable** (en un pendrive, sin instalar nada, para las PCs bloqueadas de la escuela)
- Más proyectos, más componentes y más bases de conocimiento
- Aportes de la comunidad docente

> **Nota para la IA:** no inventes fechas. El roadmap no tiene plazos comprometidos.

---

### 6.8 · Versiones (página aparte: `/versiones` o `versiones.html`)

**Título:** Versiones y novedades

Esta página es el **changelog oficial**. Diseñala como una lista cronológica (la más nueva arriba),
donde cada entrada tenga: **número de versión**, **fecha**, y una lista de cambios agrupados en
`Nuevo`, `Mejorado`, `Corregido`.

**Estado actual:** todavía **no hay versiones publicadas**. La primera será la `v0.1.0`.

> **Nota para la IA:** construí la estructura de la página y dejá **una entrada de ejemplo bien clara
> marcada como `PLACEHOLDER`**, más un texto que diga "Todavía no publicamos la primera versión.
> Muy pronto." No inventes números de versión ni fechas.
> Idealmente, que las entradas sean fáciles de agregar (un archivo de datos o bloques HTML simples).

Enlazá también a las **[Releases de GitHub](https://github.com/programadores-obreros/Agente-editor-inet/releases)**.

---

### 6.9 · Filosofía (la sección con corazón)

**Título:** En qué creemos

Cuatro bloques, cada uno con la frase destacada y una línea de explicación:

> **Conceptos antes que código.**
> No tocamos una sola línea hasta entender la idea. ¿De qué te sirve que ande, si no sabés por qué anda?

> **La IA es una herramienta. El humano siempre lidera.**
> Nosotros dirigimos, la IA ejecuta. Pero para dirigir bien hay que saber: qué pedir, y cuándo lo que te responde está mal.

> **Contra la inmediatez.**
> Nadie aprende de verdad en dos horas. Tecnia Bot no promete milagros: promete acompañarte el camino entero.

> **Primero aprendemos nosotros, después se lo enseñamos a Tecnia Bot.**
> Cada cosa que Tecnia Bot sabe, alguien la entendió y la probó con sus manos antes de enseñársela.

---

### 6.10 · Cierre emocional (antes del footer)

**Título:** El sueño

**Copy:**
> Una escuela técnica cualquiera, en un pueblo cualquiera de la Argentina. Una compu vieja,
> sin internet rápido, sin presupuesto. Un profe que hace un mes no sabía qué era un ESP32.
> Y un grupo de pibes que nunca pensaron que ellos podían hacer "eso de la programación".
>
> Abren Tecnia Bot. Y empiezan.
>
> A las semanas tienen un semáforo funcionando. Un riego que se prende solo cuando la tierra está seca.
> Un robot que esquiva paredes. **Cosas que ELLOS hicieron, que ELLOS entienden.**
>
> Y el profe, que aprendió junto a ellos, ya no le tiene miedo al armario con el kit. Lo abre todos los días.

**Frase final, grande y centrada:**
> **El conocimiento técnico no debería ser un privilegio. Debería ser un derecho.**

---

### 6.11 · Open source / Contribuir / Footer

**Título:** Es de todos, para siempre

**Copy:**
> Tecnia Bot es libre y abierto. Cualquier escuela lo puede usar, copiar, mejorar y compartir.
> Sin pedir permiso, sin pagar nada, para siempre.
>
> Y crece como crece el conocimiento: alguien aprende algo nuevo y se lo enseña a Tecnia Bot.
> Cada aporte queda para todos los que vengan después.

**Botones:** `Ver el código en GitHub` · `Cómo contribuir` (link al repo)

**Footer:**
- Código bajo **GPLv3** · Contenido educativo bajo **CC BY-SA 4.0**
- Construido sobre [OpenCode](https://opencode.ai)
- Piezas de circuito: [Wokwi Elements](https://github.com/wokwi/wokwi-elements) (MIT)
- Para el programa **INET** y las escuelas técnicas argentinas
- *Hecho en Argentina, con cariño. Para los que empiezan. Para los que más lo necesitan.* 🇦🇷

---

## 7. Requisitos técnicos (importantes, no los saltees)

- **Sitio estático puro.** HTML + CSS + JS. Sin backend, sin base de datos, sin framework pesado.
- **Sin paso de build** (o el mínimo posible). Se publica en **GitHub Pages**.
- ⚡ **Tiene que cargar rápido en conexiones malas y en computadoras viejas.**
  Es para escuelas del interior, no para nuestro monitor. Optimizá el peso.
- **Sin dependencias externas en tiempo de ejecución:** nada de fuentes de Google, CDNs de JS,
  ni imágenes remotas. Todo self-hosted.
- 📵 **Sin analytics, sin cookies, sin trackers, sin píxeles.**
  Es material educativo usado por **menores en escuelas**. Esto no se negocia.
- **Responsive de verdad**: muchos docentes van a entrar desde el celular.
- **Accesible**: contraste suficiente, texto que se puede agrandar, navegación por teclado,
  `alt` en las imágenes. Pensá en alguien con poca vista leyendo en una pantalla vieja.
- **Botón de copiar** en todos los bloques de comandos.
- Idioma: **español** (único). No hace falta traducir.

---

## 8. Qué NO hacer

- ❌ No inventar features, versiones, fechas, métricas ni testimonios.
- ❌ No usar lenguaje corporativo ni promesas de marketing ("revoluciona", "potencia tu futuro").
- ❌ No poner un chatbot, un popup de newsletter, ni ventanas emergentes.
- ❌ No pedir datos personales. La web no recolecta nada.
- ❌ No hacerla pesada ni cargada de animaciones. Elegante y liviana.
- ❌ No esconder el hecho de que es gratis y libre: eso es lo mejor que tenemos.

---

## 9. Marcadores a completar (avisá al entregar)

La IA que construya el sitio debe **listar al final** los puntos que quedaron pendientes.
Estos ya los sabemos:

- `#TODO-URL-PROYECTOS` — URL de la web de los 15 proyectos interactivos (todavía no publicada)
- **Versiones** — no hay releases publicadas aún; la sección va con estructura + placeholder
- **Capturas de pantalla** — ✅ YA ESTÁN PROVISTAS. Ver la sección 11. Usalas.

---

## 10. Entregable esperado

1. `index.html` — la landing completa con todas las secciones de arriba
2. `versiones.html` — el changelog oficial (estructura + placeholder)
3. `estilo.css` — estilos (uno solo, comentado)
4. `script.js` — lo mínimo indispensable (nav, botones de copiar)
5. Todo en una carpeta plana, lista para publicar en GitHub Pages
6. Un `README.md` corto explicando cómo actualizar la sección de Versiones cuando salga un release
7. La lista de marcadores pendientes (punto 9)

---

---

## 11. Capturas disponibles (usalas en la web)

Estas capturas son **reales**, generadas por el propio Tecnia Bot. Están en la carpeta
`docs/capturas/` del repositorio. Usalas en las secciones indicadas (podés recortarlas o
enmarcarlas en un "mockup" de ventana, pero no las alteres):

| Archivo | Qué muestra | Dónde usarla |
|---------|-------------|--------------|
| `docs/capturas/circuito-riego.png` | Un circuito generado por Tecnia Bot: higrómetro + relé + bomba conectados a un ESP32, con el slider interactivo de humedad. | Sección **Cómo funciona / features** (el "dibuja los circuitos") |
| `docs/capturas/protoboard-interactivo.png` | El explicador de protoboard: una fila resaltada mostrando qué agujeros están conectados por dentro. | Sección **features** (el "te enseña la protoboard") |
| `docs/capturas/proyectos-galeria.png` | La galería de los 15 proyectos del INET. | Sección **Proyectos** |
| `docs/capturas/proyecto-riego.png` | Un proyecto individual (riego) con su conexionado. | Sección **Proyectos** (detalle) |

> Todas están tomadas del producto real. Priorizá estas por sobre cualquier imagen decorativa.
> Si querés una captura de la terminal con Tecnia Bot explicando en el chat, avisá: hay que tomarla aparte.

---

*Este brief describe **Tecnia Bot**, un proyecto libre y sin fines de lucro para las escuelas técnicas
de la República Argentina. Si algo del brief te parece mal pensado, decilo: preferimos que salga bien
a que salga rápido.*
